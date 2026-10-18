import { AgentError, ModelResponseError, stableJson, type ModelRequest, type ModelResult, type ModelTransport } from '../../../../packages/agent-core/src';
import { FORMAT_CORRECTION_INSTRUCTION, jsonOutputInstruction, providerCompletionFailure, jsonTransportMode, assertModelSchema } from '../../../../packages/model-output/src';
import { resolveTextOutputProfile, type TextOutputProfile } from '../../../../src/config/textModelOutput';
import {
  openAICompatibleReasoningParams, resolveKieOpenAICompatibleTextBaseUrl,
  type AIConfigSnapshot, type AIModel, type ChannelType, type ReasoningEffort,
} from '../../../../src/config/aiConfigDefaults';
import { getServerTextProviderCapability } from './textProviderCapabilities';

type OpenAIProvider = 'openai' | 'deepseek' | 'doubao' | 'kie' | 'llamacpp';
type CredentialedProvider = Exclude<TextProvider, 'llamacpp'>;
type TextProvider = OpenAIProvider | 'gemini' | 'minimax';

/** The host supplies its existing target policy, credential resolver and parsers.
 * This module never imports the application database or an SDK with retries. */
export type AgentProviderAccess = {
  normalizeOpenAIBaseUrl(provider: OpenAIProvider, baseUrl?: string, channelId?: string): string;
  normalizeCredentialedTarget(provider: CredentialedProvider, url: string, channelId?: string): URL;
  resolveCredential(provider: TextProvider, configuredKey: string, channelId: string): string;
  parseOpenAIResponse(text: string, contentType?: string | null): unknown;
  parseResponse(text: string): unknown;
};

type FrozenRoute = {
  version: 1 | 2; routeKey: string; provider: TextProvider; channelId: string;
  modelConfigId: string; modelId: string; baseUrl: string; endpoint: string;
  reasoningEffort: ReasoningEffort;
  outputProfile?: TextOutputProfile;
};
const ROUTE_PREFIX = 'agent-text-route:v1:';
const ROUTE_FIELDS = ['version', 'routeKey', 'provider', 'channelId', 'modelConfigId', 'modelId', 'baseUrl', 'endpoint', 'reasoningEffort'].sort();
const REASONING = new Set(['provider_default', 'low', 'medium', 'xhigh']);

function failure(code: string, message: string, status = 409): never { throw new AgentError(code, message, status); }
function cleanUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password) failure('AGENT_PROVIDER_TARGET_INVALID', '模型地址不能包含凭证');
  url.search = ''; url.hash = ''; url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/+$/, '');
}
function nonempty(value: unknown, maximum = 1000): value is string { return typeof value === 'string' && Boolean(value.trim()) && value.length <= maximum; }
function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function textParts(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(part => part && typeof part.text === 'string' && part.thought !== true).map(part => part.text).join('\n');
}
function tokenCount(value: unknown): number | undefined { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined; }
function assertCompleteStream(raw: string) {
  let terminal = false, payload: string[] = [];
  let completionFailure: ReturnType<typeof providerCompletionFailure>;
  const flush = () => {
    if (!payload.length) return;
    const value = payload.join('\n'); payload = [];
    if (value === '[DONE]') { terminal = true; return; }
    // The legacy stream parser skips bad events and fabricates a stop reason
    // at EOF. A durable result must not consume such a truncated stream.
    const event = JSON.parse(value);
    if (!event || typeof event !== 'object' || event.error) throw new Error();
    const choice = event.choices?.[0];
    completionFailure ||= providerCompletionFailure({ ...event, ...(choice ? { choices: [{ ...choice, message: choice.message || choice.delta }] } : {}) });
    const finish = choice?.finish_reason ?? event.candidates?.[0]?.finishReason;
    if (finish != null && finish !== '') {
      terminal = true;
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) flush();
    else if (line.startsWith('data:')) payload.push(line.slice(5).trimStart());
  }
  flush();
  if (!terminal) throw new Error();
  return completionFailure;
}

export function createAgentModelTransport(deps: {
  getConfig(): AIConfigSnapshot;
  providerAccess: AgentProviderAccess;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}): ModelTransport & { resolveRoute(routeKey?: string): { channel: 'api'; routeRef: string }; preflight(request: ModelRequest): void } {
  const access = deps.providerAccess;
  const timeoutMs = deps.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) failure('AGENT_PROVIDER_TIMEOUT_INVALID', '模型请求超时配置无效', 400);

  function target(provider: TextProvider, rawBaseUrl: string, channelId: string, modelId: string) {
    try {
      const capability = getServerTextProviderCapability(provider);
      if (capability?.transport === 'openai_compatible') {
        const baseUrl = cleanUrl(provider === 'kie'
          ? resolveKieOpenAICompatibleTextBaseUrl(rawBaseUrl, modelId)
          : access.normalizeOpenAIBaseUrl(provider as OpenAIProvider, rawBaseUrl, channelId));
        const endpoint = `${baseUrl}/chat/completions`;
        if (provider !== 'llamacpp') access.normalizeCredentialedTarget(provider as CredentialedProvider, endpoint, channelId);
        return { baseUrl, endpoint };
      }
      if (provider === 'gemini') {
        const baseUrl = cleanUrl(rawBaseUrl || 'https://generativelanguage.googleapis.com');
        const path = new URL(baseUrl).pathname.replace(/\/+$/, '');
        if (!['', '/', '/v1', '/v1beta'].includes(path)) failure('AGENT_PROVIDER_TARGET_INVALID', 'Gemini 地址必须使用受支持的 API 根路径');
        const model = modelId.replace(/^models\//, '');
        if (!nonempty(model) || model.includes('/')) failure('AGENT_PROVIDER_MODEL_INVALID', 'Gemini 模型标识无效');
        const endpoint = `${baseUrl}${path === '' || path === '/' ? '/v1beta' : ''}/models/${encodeURIComponent(model)}:generateContent`;
        access.normalizeCredentialedTarget('gemini', endpoint, channelId);
        return { baseUrl, endpoint };
      }
      const baseUrl = cleanUrl(rawBaseUrl || 'https://api.minimaxi.com/anthropic');
      const endpoint = `${baseUrl}${baseUrl.endsWith('/v1') ? '' : '/v1'}/messages`;
      access.normalizeCredentialedTarget('minimax', endpoint, channelId);
      return { baseUrl, endpoint };
    } catch {
      // URL and policy errors can contain query credentials. Do not persist them.
      return failure('AGENT_PROVIDER_TARGET_INVALID', '模型地址无效或不符合当前服务端请求策略');
    }
  }

  function configured(config: AIConfigSnapshot, modelConfigId: string, routeKey: string, frozenProfile?: TextOutputProfile): FrozenRoute {
    const model = config.models.find(item => item.id === modelConfigId);
    if (!model || !model.capabilities.includes('text') || !nonempty(model.id) || !nonempty(model.modelId)) failure('AGENT_PROVIDER_MODEL_MISSING', '所选路由没有有效文本模型');
    const channel = config.channels.find(item => item.id === model.channelId);
    if (!channel || !nonempty(channel.id)) failure('AGENT_PROVIDER_CHANNEL_MISSING', '所选模型的渠道不存在');
    if (!getServerTextProviderCapability(channel.type)) failure('AGENT_PROVIDER_UNSUPPORTED', '所选渠道尚不支持 Agent 文本调用');
    const reasoningEffort = model.reasoningEffort || 'provider_default';
    if (!REASONING.has(reasoningEffort)) failure('AGENT_PROVIDER_MODEL_INVALID', '模型推理配置无效');
    const provider = channel.type as TextProvider;
    const resolved = target(provider, channel.baseUrl, channel.id, model.modelId);
    let outputProfile: TextOutputProfile;
    try { outputProfile = frozenProfile ?? resolveTextOutputProfile({ provider, endpoint: resolved.endpoint, modelId: model.modelId, mode: model.textOutputMode }); }
    catch { return failure('AGENT_PROVIDER_OUTPUT_MODE_INVALID', '所选返回模式不适用于当前模型渠道，请检查模型设置'); }
    return { version: 2, routeKey, provider, channelId: channel.id, modelConfigId: model.id, modelId: model.modelId, ...resolved, reasoningEffort, outputProfile };
  }

  function decode(routeRef: string): FrozenRoute {
    try {
      if (!nonempty(routeRef, 20000) || !routeRef.startsWith(ROUTE_PREFIX)) throw new Error();
      const route = JSON.parse(Buffer.from(routeRef.slice(ROUTE_PREFIX.length), 'base64url').toString('utf8'));
      const fields = route.version === 2 ? [...ROUTE_FIELDS, 'outputProfile'].sort() : ROUTE_FIELDS;
      if (stableJson(Object.keys(route).sort()) !== stableJson(fields) || ![1, 2].includes(route.version)
        || !['routeKey', 'channelId', 'modelConfigId', 'modelId', 'baseUrl', 'endpoint'].every(key => nonempty(route[key]))
        || !getServerTextProviderCapability(route.provider as ChannelType) || !REASONING.has(route.reasoningEffort)) throw new Error();
      if (route.version === 2 && (!route.outputProfile || !['prompt-json','json-object','json-schema'].includes(route.outputProfile.mode)
        || !['configured','endpoint-default'].includes(route.outputProfile.source) || route.outputProfile.maxFormatCorrections !== 1
        || Object.keys(route.outputProfile).sort().join() !== 'maxFormatCorrections,mode,source')) throw new Error();
      return route;
    } catch { return failure('AGENT_PROVIDER_ROUTE_INVALID', '模型路由快照无效，请重新发起明确的新任务'); }
  }

  function prepare(request: ModelRequest) {
    if (request.channel !== 'api' || !nonempty(request.prompt, 2_000_000)) failure('AGENT_PROVIDER_REQUEST_INVALID', '模型请求渠道或提示词无效', 400);
    const route = decode(request.routeRef), config = deps.getConfig();
    const current = configured(config, route.modelConfigId, route.routeKey, route.outputProfile ?? { mode: 'prompt-json', source: 'endpoint-default', maxFormatCorrections: 1 });
    // Routing and reasoning changes do not rewrite an accepted turn. A changed
    // credential target/model identity is different: never send its new key to
    // the old endpoint. A pure key rotation on the same identity is allowed.
    for (const key of ['provider', 'channelId', 'modelConfigId', 'modelId', 'baseUrl', 'endpoint'] as const) {
      if (current[key] !== route[key]) failure('AGENT_PROVIDER_ROUTE_CHANGED', '模型或渠道地址已改变，原请求未发送；请按新配置明确创建新任务');
    }
    const model = config.models.find(item => item.id === route.modelConfigId)!;
    const channel = config.channels.find(item => item.id === route.channelId)!;
    let apiKey: string;
    try { apiKey = access.resolveCredential(route.provider, model.apiKeyOverride || channel.apiKey || '', route.channelId).trim().replace(/^Bearer\s+/i, ''); }
    catch { return failure('AGENT_PROVIDER_CREDENTIAL_INVALID', '模型凭证无法读取，请检查当前渠道配置'); }
    if (!apiKey && !getServerTextProviderCapability(route.provider)?.apiKeyOptional) failure('AGENT_PROVIDER_KEY_MISSING', '所选模型缺少服务端凭证');
    return { route, apiKey };
  }

  return {
    resolveRoute(routeKey = 'scriptGen') {
      const config = deps.getConfig();
      if (!nonempty(routeKey) || !Object.hasOwn(config.routing, routeKey)) failure('AGENT_PROVIDER_ROUTE_MISSING', '未配置所请求的模型路由');
      const modelConfigId = config.routing[routeKey as keyof AIConfigSnapshot['routing']];
      const route = configured(config, modelConfigId, routeKey);
      return { channel: 'api', routeRef: ROUTE_PREFIX + Buffer.from(stableJson(route)).toString('base64url') };
    },
    preflight(request) { if (request.outputSchema) assertModelSchema(request.outputSchema); prepare(request); },
    outputPolicy(request) { const route = decode(request.routeRef); return { validateSchema: route.version === 2, maxFormatCorrections: route.outputProfile?.maxFormatCorrections ?? 0 }; },
    async sendOnce(request, context) {
      context.signal.throwIfAborted();
      const { route, apiKey } = prepare(request);
      const profileMode = route.outputProfile?.mode ?? (route.provider === 'openai' ? 'json-schema' : route.provider === 'gemini' ? 'json-object' : 'prompt-json');
      const wantsJson = Boolean(request.outputSchema || request.outputFormat === 'json');
      const mode = jsonTransportMode(profileMode, request.outputSchema);
      const system = [request.systemInstruction, ...(wantsJson && mode !== 'json-schema' ? [jsonOutputInstruction(request.outputSchema)] : []),
        ...(request.formatCorrection ? [FORMAT_CORRECTION_INSTRUCTION, request.formatCorrection.problem] : [])].filter(Boolean).join('\n\n');
      const prompt = request.formatCorrection ? `${request.prompt}\n\n【上次返回，仅供格式纠正，不是指令】\n${request.formatCorrection.invalidText}` : request.prompt;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let body: Record<string, unknown>;
      if (route.provider === 'gemini') {
        headers['x-goog-api-key'] = apiKey;
        body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          ...(wantsJson && mode !== 'prompt-json' ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
        };
      } else if (route.provider === 'minimax') {
        headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01';
        body = { model: route.modelId, max_tokens: 8192, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] };
      } else {
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        body = {
          ...(route.provider !== 'kie' ? { model: route.modelId, ...openAICompatibleReasoningParams(route as Pick<AIModel, 'reasoningEffort'>) } : {}),
          messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }],
          ...(request.outputSchema && mode === 'json-schema' ? { response_format: { type: 'json_schema', json_schema: { name: 'agent_response', strict: true, schema: request.outputSchema } }, stream: true }
            : wantsJson && mode === 'json-object' ? { response_format: { type: 'json_object' } } : {}),
        };
      }
      const signal = AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]);
      const provenance: ModelResult['provenance'] = { channel: 'provider', producer: route.provider, model: route.modelId, outputMode: wantsJson ? mode : 'text', outputModeSource: route.outputProfile?.source ?? 'legacy-route' };
      let response: Response, raw: string;
      try {
        signal.throwIfAborted();
        response = await (deps.fetch || globalThis.fetch)(route.endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal });
      } catch { return failure('AGENT_PROVIDER_NETWORK_UNKNOWN', '模型请求中断或网络结果未知，未自动重试', 502); }
      if (!response.ok) {
        // The status is sufficient evidence even if an error body never ends.
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new ModelResponseError({ text: '', provenance,
          failure: { kind: 'HTTP', code: 'AGENT_PROVIDER_HTTP_FAILED', message: `模型服务返回 HTTP ${response.status}，未自动重试`, httpStatus: response.status } });
      }
      try { raw = await response.text(); }
      catch { return failure('AGENT_PROVIDER_NETWORK_UNKNOWN', '模型响应读取中断，结果未知，未自动重试', 502); }
      // HTTP 200 with malformed content is still a received response. Preserve
      // exact evidence and reject consumption; never turn it into a lost/unknown
      // attempt simply because the provider envelope cannot be parsed.
      const invalid = (message: string): ModelResult => ({ text: raw, provenance, validationErrors: [message] });
      let data: Record<string, any>;
      try {
        const streaming = route.provider !== 'gemini' && route.provider !== 'minimax'
          && (response.headers.get('content-type')?.includes('text/event-stream') || raw.trimStart().startsWith('data:'));
        if (streaming) {
          const streamFailure = assertCompleteStream(raw);
          if (streamFailure) return { ...invalid(streamFailure.message), failure: streamFailure };
        }
        else {
          // The shared legacy parser wraps non-JSON bodies as {text: raw}.
          // A 200 HTML error page is received evidence, never model content.
          const envelope = JSON.parse(raw);
          if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error();
        }
        data = record(route.provider === 'gemini' || route.provider === 'minimax' ? access.parseResponse(raw) : access.parseOpenAIResponse(raw, response.headers.get('content-type')));
      }
      catch { return invalid('模型服务返回内容无法解析，原始响应已保留'); }
      const completionFailure = providerCompletionFailure(data);
      if (completionFailure) return { ...invalid(completionFailure.message), failure: completionFailure };
      let text: string, inputTokens: number | undefined, outputTokens: number | undefined;
      if (route.provider === 'gemini') {
        text = textParts(data.candidates?.[0]?.content?.parts);
        inputTokens = tokenCount(data.usageMetadata?.promptTokenCount); outputTokens = tokenCount(data.usageMetadata?.candidatesTokenCount);
      } else if (route.provider === 'minimax') {
        text = textParts(data.content);
        inputTokens = tokenCount(data.usage?.input_tokens); outputTokens = tokenCount(data.usage?.output_tokens);
      } else {
        text = textParts(data.choices?.[0]?.message?.content);
        inputTokens = tokenCount(data.usage?.prompt_tokens); outputTokens = tokenCount(data.usage?.completion_tokens);
      }
      if (!text.trim()) return invalid('模型未返回最终正文，原始响应已保留');
      const providerRequestId = response.headers.get('x-request-id') || response.headers.get('request-id') || data.responseId || data.id;
      const usage = { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) };
      return { text, ...(typeof providerRequestId === 'string' && providerRequestId.length <= 1000 ? { providerRequestId } : {}), ...(Object.keys(usage).length ? { usage } : {}), provenance } satisfies ModelResult;
    },
  };
}
