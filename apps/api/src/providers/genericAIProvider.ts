import { parseModelJson, assertModelSchema } from '../../../../packages/model-output/src';
import { ModelResponseError } from '../../../../packages/agent-core/src/model';
import { createAgentModelTransport } from './agentModelTransport';
interface TextJsonInput { prompt: string; systemInstruction?: string; role: string; requireJson?: boolean; responseSchema?: Record<string, unknown>; modelRoute?: string; }
import { requestManualAIText } from "../../../../src/server/manualAI";
import type { AIChannel, AIModel } from "../../../../src/config/aiConfigDefaults";
import { dbHelpers } from "../../../../src/server/db";
import {
  normalizeOpenAICompatibleBaseUrl,
  parseProviderText,
  resolveDatabaseChannelApiKey,
  resolveGeminiProxyClient,
  resolveMiniMaxApiKey,
  resolveOpenAICompatibleApiKey,
  type OpenAICompatibleProvider,
} from "../../../../src/server/routes/providerProxyUtils";
import { normalizeCredentialedProviderTarget } from "../../../../src/server/routes/providerTargetPolicy";
import { parseOpenAICompatibleProviderText } from "../../../../src/server/routes/openAICompatibleEventStream";
import {
  composePromptBlocks,
  markPromptBlocksDuplicatedByManifest,
  promptBlocksFromText,
  promptContentHash,
  type PromptCompositionManifest,
} from "../../../../src/services/production/promptComposition";
import {
  getServerTextProviderCapability,
  isServerOpenAICompatibleProvider,
} from "./textProviderCapabilities";

const isOpenAICompatible = (type: AIChannel["type"]): type is OpenAICompatibleProvider =>
  isServerOpenAICompatibleProvider(type);

interface GeneratedModelText {
  text: string;
  metadata: {
    provider: string;
    modelId: string;
    providerRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    promptCompositionManifest?: PromptCompositionManifest;
  };
}

export const parseGenericAIJson = (raw: string, schema?: Record<string, unknown>): Record<string, unknown> => {
  const value = parseModelJson(raw, schema);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型返回需要 JSON 对象');
  return value as Record<string, unknown>;
};

const resolveTextRoute = (requestedRoute = "scriptGen") => {
  const { config } = dbHelpers.getAIConfig();
  const routeKey = requestedRoute in config.routing
    ? requestedRoute as keyof typeof config.routing
    : "scriptGen";
  const modelForRoute = (key: keyof typeof config.routing) => {
    const model = config.models.find((item) => item.id === config.routing[key]);
    const channel = model && config.channels.find((item) => item.id === model.channelId);
    return model && channel ? { model, channel } : undefined;
  };
  const hasCredentials = ({ model, channel }: { model: AIModel; channel: AIChannel }) => {
    try {
      const capability = getServerTextProviderCapability(channel.type);
      if (capability?.transport === "openai_compatible" && isOpenAICompatible(channel.type)) {
        if (capability.apiKeyOptional) {
          normalizeOpenAICompatibleBaseUrl(channel.type, channel.baseUrl, channel.id);
          return true;
        }
        return Boolean(resolveOpenAICompatibleApiKey(channel.type, modelKey(model, channel), channel.id));
      }
      if (channel.type === "gemini") return Boolean(resolveGeminiProxyClient(modelKey(model, channel), channel.id));
      if (channel.type === "minimax") return Boolean(resolveMiniMaxApiKey(modelKey(model, channel), channel.id));
      return false;
    } catch {
      return false;
    }
  };
  const preferred = modelForRoute(routeKey);
  if (preferred && hasCredentials(preferred)) return preferred;
  const scriptFallback = routeKey === "scriptGen" ? undefined : modelForRoute("scriptGen");
  if (scriptFallback && hasCredentials(scriptFallback)) return scriptFallback;
  const model = preferred?.model || config.models.find((item) => item.capabilities.includes("text"));
  if (!model) throw new Error(`TEXT_PROVIDER_MODEL_MISSING: No text model configured for ${routeKey}.`);
  const channel = preferred?.channel || config.channels.find((item) => item.id === model.channelId);
  if (!channel) throw new Error(`TEXT_PROVIDER_CHANNEL_MISSING: ${model.channelId}`);
  return { model, channel };
};

const modelKey = (model: AIModel, channel: AIChannel) =>
  model.apiKeyOverride || channel.apiKey || "";

const generateText = async (input: TextJsonInput) => {
  let reviewedManifest: PromptCompositionManifest | undefined;
  const manual = requestManualAIText({ prompt: input.prompt, systemInstruction: input.systemInstruction, requireJson: input.requireJson, schema: input.responseSchema }, review => {
    if (review.prompt !== input.prompt || (review.systemInstruction || "") !== (input.systemInstruction || "")) {
      reviewedManifest = composePromptBlocks([
        { blockId: "manual_review.system", source: "manual_prompt_review", purpose: "本步确认的系统要求", content: review.systemInstruction, required: false },
        { blockId: "manual_review.prompt", source: "manual_prompt_review", purpose: "本步确认的任务提示词", content: review.prompt, required: true },
      ]).manifest;
      input = { ...input, ...review };
    }
  });
  if (manual) {
    const text = await manual;
    if (text !== undefined) return { text, metadata: { provider: "manual_external", modelId: "external-chat", promptCompositionManifest: reviewedManifest } } satisfies GeneratedModelText;
  }
  const { model, channel } = resolveTextRoute(input.modelRoute);
  const config = structuredClone(dbHelpers.getAIConfig().config);
  config.routing.scriptGen = model.id;
  const transport = createAgentModelTransport({ getConfig: () => config, providerAccess: {
    normalizeOpenAIBaseUrl: normalizeOpenAICompatibleBaseUrl,
    normalizeCredentialedTarget: normalizeCredentialedProviderTarget,
    parseOpenAIResponse: parseOpenAICompatibleProviderText,
    parseResponse: parseProviderText,
    resolveCredential: (provider, configured, channelId) => provider === 'gemini'
      ? (configured.trim() || resolveDatabaseChannelApiKey(channelId, 'gemini') || process.env.GEMINI_API_KEY || '').trim()
      : provider === 'minimax' ? resolveMiniMaxApiKey(configured, channelId)
      : resolveOpenAICompatibleApiKey(provider, configured, channelId),
  } });
  const request = { ...transport.resolveRoute(), operationKey: input.role, prompt: input.prompt,
    systemInstruction: input.systemInstruction, outputSchema: input.responseSchema,
    outputFormat: input.requireJson ? 'json' as const : 'text' as const };
  const result = await transport.sendOnce(request, { attemptId: crypto.randomUUID(), signal: new AbortController().signal });
  if (result.failure) throw new ModelResponseError(result);
  if (result.validationErrors?.length) throw new Error(result.validationErrors.join('；'));
  return { text: result.text, metadata: { provider: channel.type, modelId: model.modelId,
    providerRequestId: result.providerRequestId, ...result.usage, promptCompositionManifest: reviewedManifest } } satisfies GeneratedModelText;
};

const serverGenericJsonContractPattern = /(?<!不要)(?<!禁止)(?<!不得)只(?:能|需|返回).{0,16}JSON|输出(?:必须|严格)?\s*(?:为|是)?\s*(?:合法|严格|纯)?\s*JSON|(?<!不要)(?<!禁止)(?<!不得)(?:请|必须|严格|直接)?\s*只?返回[^\n。]{0,160}JSON|(?:^|\n)\s*返回[^\n。]{0,160}JSON|JSON\s*结构(?:示例)?|JSON\s*Schema/iu;

export const composeServerGenericJsonRequest = (
  input: { prompt: string; systemInstruction?: string },
  options: { nativeJsonFormatContract?: boolean } = {},
) => {
  const existingContractText = `${input.systemInstruction || ""}\n${input.prompt || ""}`;
  const hasJsonContract = serverGenericJsonContractPattern.test(existingContractText);
  const systemComposition = composePromptBlocks([{
    blockId: "server.generic.system",
    source: "generateServerGenericAIJson.systemInstruction",
    purpose: "系统角色与任务边界",
    content: input.systemInstruction,
    required: false,
  }]);
  const promptComposition = composePromptBlocks(markPromptBlocksDuplicatedByManifest([
    ...promptBlocksFromText({
      prompt: input.prompt,
      blockIdPrefix: "server.generic.task",
      source: "generateServerGenericAIJson.prompt",
      purpose: "服务端通用 JSON 任务",
    }),
    {
      blockId: "server.generic.output_contract",
      source: "generateServerGenericAIJson.structuredOutput",
      purpose: "本次任务唯一 JSON 输出合同",
      content: hasJsonContract || options.nativeJsonFormatContract
        ? ""
        : "【输出合同】\n只返回合法 JSON，不要输出 Markdown 或解释文字。",
      required: false,
      ...(hasJsonContract
        ? { omissionReason: "already_declared_by_business_prompt" }
        : options.nativeJsonFormatContract
          ? { omissionReason: "provider_native_structured_output" }
          : {}),
    },
  ], systemComposition.manifest));
  if (promptComposition.manifest.issues.some((issue) => issue.code === "EMPTY_REQUIRED_BLOCK")) {
    throw new Error("服务端 AI 请求缺少必需任务提示词，已在发送前阻断。");
  }
  const combined = [systemComposition.prompt, promptComposition.prompt].filter(Boolean).join("\n\n");
  const manifest: PromptCompositionManifest = {
    version: "prompt-composition/v1",
    blocks: [...systemComposition.manifest.blocks, ...promptComposition.manifest.blocks],
    finalCharCount: Array.from(combined).length,
    finalHash: promptContentHash(combined),
    issues: [...systemComposition.manifest.issues, ...promptComposition.manifest.issues],
  };
  return {
    prompt: promptComposition.prompt,
    systemInstruction: systemComposition.prompt,
    manifest,
  };
};

export const generateServerGenericAIJson = async (input: { prompt: string; systemInstruction?: string; responseSchema?: Record<string, unknown>; modelRoute?: string }) => {
  if (input.responseSchema) assertModelSchema(input.responseSchema);
  const composition = composeServerGenericJsonRequest(input);
  const generated = await generateText({ ...input, prompt: composition.prompt, systemInstruction: composition.systemInstruction, role: 'generic_json', requireJson: true });
  // Non-durable callers have no invocation budget or replay journal. Surface an
  // invalid result rather than performing an untracked extra model request.
  const parsed = parseGenericAIJson(generated.text, input.responseSchema);
  Object.defineProperty(parsed, Symbol.for('writing.modelCallMetadata'), { value: {
    ...generated.metadata, promptCompositionManifest: generated.metadata.promptCompositionManifest || composition.manifest,
  }, enumerable: false });
  return parsed;
};
