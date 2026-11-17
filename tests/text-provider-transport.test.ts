import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { stableJson } from '../packages/domain/src/contentIdentity';
import { TextProviderError as AgentError, type ModelRequest } from '../apps/api/src/providers/textTransportTypes';
import { createTextModelTransport, type TextProviderAccess } from '../apps/api/src/providers/textModelTransport';
import { AI_CONFIG_SCHEMA_VERSION, defaultRouting, type AIConfigSnapshot, type ChannelType } from '../src/config/aiConfigDefaults';

// All credentials, text and responses here are mechanical protocol fixtures.
// The existing policy/parsers use their own database module: isolate it BEFORE
// dynamic import. Every transport receives a fake fetch; no provider is called.
const directory = mkdtempSync(path.join(tmpdir(), 'agent-provider-transport-'));
process.env.OMNI_DB_PATH = path.join(directory, 'isolated-policy.sqlite');
const { db, dbHelpers } = await import('../src/server/db');
const utils = await import('../src/server/routes/providerProxyUtils');
const { normalizeCredentialedProviderTarget } = await import('../src/server/routes/providerTargetPolicy');
const { parseOpenAICompatibleProviderText } = await import('../src/server/routes/openAICompatibleEventStream');
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

const endpoints: Partial<Record<ChannelType, string>> = {
  openai: 'https://api.openai.com/v1', deepseek: 'https://api.deepseek.com', doubao: 'https://ark.cn-beijing.volces.com/api/v3',
  kie: 'https://api.kie.ai/api/v1', llamacpp: 'http://127.0.0.1:8080/v1', gemini: 'https://generativelanguage.googleapis.com', minimax: 'https://api.minimaxi.com/anthropic',
};
function configuration(provider: ChannelType = 'openai'): AIConfigSnapshot {
  return {
    schemaVersion: AI_CONFIG_SCHEMA_VERSION,
    channels: [{ id: 'protocol-channel', name: 'Protocol', type: provider, baseUrl: endpoints[provider] || 'https://unsupported.example', apiKey: provider === 'llamacpp' ? '' : 'protocol-key-old' }],
    models: [{ id: 'protocol-model', channelId: 'protocol-channel', alias: 'Protocol', modelId: provider === 'kie' ? 'gpt-4o-openai' : 'protocol-model-v1', capabilities: ['text'], reasoningEffort: 'low' }],
    routing: { ...defaultRouting, scriptGen: 'protocol-model' }, visualQcEnabled: false, comfyWorkflows: [],
  };
}
const access: TextProviderAccess = {
  normalizeOpenAIBaseUrl: utils.normalizeOpenAICompatibleBaseUrl,
  normalizeCredentialedTarget: normalizeCredentialedProviderTarget,
  resolveCredential: (provider, configuredKey, channelId) => {
    if (provider === 'gemini') return utils.resolveGeminiProxyClient(configuredKey, channelId)?.apiKey || '';
    if (provider === 'minimax') return utils.resolveMiniMaxApiKey(configuredKey, channelId);
    return utils.resolveOpenAICompatibleApiKey(provider, configuredKey, channelId);
  },
  parseOpenAIResponse: parseOpenAICompatibleProviderText, parseResponse: utils.parseProviderText,
};
const errorCode = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;
function fixtureResponse(provider: ChannelType): Response {
  const payload = provider === 'gemini'
    ? { responseId: 'protocol-gemini-id', candidates: [{ content: { parts: [{ text: 'private thought', thought: true }, { text: 'protocol result' }, { text: 'second part' }] } }], usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 2 } }
    : provider === 'minimax'
      ? { id: 'protocol-minimax-id', content: [{ type: 'thinking', thinking: 'private thought' }, { type: 'text', text: 'protocol result' }, { type: 'text', text: 'second part' }], usage: { input_tokens: 0, output_tokens: 2 } }
      : { id: 'protocol-openai-id', choices: [{ message: { content: [{ type: 'text', text: 'protocol result' }, { type: 'text', text: 'second part' }], reasoning_content: 'private thought' } }], usage: { prompt_tokens: 0, completion_tokens: 2 } };
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}
function harness(provider: ChannelType = 'openai', overrides: Partial<TextProviderAccess> = {}, timeoutMs?: number) {
  let config = configuration(provider), calls: Array<{ url: string; init: RequestInit }> = [], credentialReads = 0;
  let response = async (_url: string, _init: RequestInit) => fixtureResponse(provider);
  const set = (next: AIConfigSnapshot) => { config = structuredClone(next); dbHelpers.saveAIConfig(config); };
  set(config);
  const providerAccess: TextProviderAccess = { ...access, ...overrides, resolveCredential: (...args) => { credentialReads++; return (overrides.resolveCredential || access.resolveCredential)(...args); } };
  const transport = createTextModelTransport({ getConfig: () => structuredClone(config), providerAccess, timeoutMs, fetch: (async (url, init) => { calls.push({ url: String(url), init: init! }); return response(String(url), init!); }) as typeof fetch });
  const request = (): ModelRequest => ({ ...transport.resolveRoute(), operationKey: 'protocol-operation', prompt: 'mechanical protocol prompt', systemInstruction: 'mechanical protocol system', outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });
  const send = (input: ModelRequest, signal = new AbortController().signal) => transport.sendOnce(input, { attemptId: 'protocol-attempt', signal });
  return { transport, request, send, calls, set, get config() { return structuredClone(config); }, get credentialReads() { return credentialReads; }, respondWith: (fn: typeof response) => { response = fn; } };
}

test('importing the pure transport never opens the application database', () => {
  const filename = path.join(directory, 'must-not-be-opened.sqlite');
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "await import('./apps/api/src/providers/textModelTransport.ts')"], { cwd: path.resolve('.'), env: { ...process.env, OMNI_DB_PATH: filename }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(existsSync(filename), false);
});

test('accepted routing/reasoning stays frozen, key rotation is resolved only at send, no secret is serialized', async () => {
  const h = harness(), initial = h.config;
  initial.models[0].apiKeyOverride = 'protocol-override-old';
  initial.channels[0].baseUrl += '?token=protocol-query-secret#secret'; h.set(initial);
  const request = h.request();
  assert.equal(h.credentialReads, 0);
  const snapshot = JSON.parse(Buffer.from(request.routeRef.split(':').at(-1)!, 'base64url').toString('utf8'));
  assert.equal(snapshot.modelId, 'protocol-model-v1');
  assert.equal(snapshot.baseUrl, endpoints.openai);
  assert.doesNotMatch(JSON.stringify(snapshot), /protocol-(?:override|key|query)|apiKey|token=/);
  const changed = h.config;
  changed.routing.scriptGen = 'another-model'; changed.models[0].apiKeyOverride = 'protocol-override-rotated'; changed.models[0].reasoningEffort = 'xhigh'; h.set(changed);
  h.transport.preflight(request); assert.equal(h.calls.length, 0);
  const result = await h.send(request);
  assert.equal(h.calls.length, 1); assert.equal(h.credentialReads, 2);
  const sent = h.calls[0], body = JSON.parse(sent.init.body as string);
  assert.equal(sent.url, `${endpoints.openai}/chat/completions`); assert.equal(sent.init.redirect, 'error');
  assert.equal((sent.init.headers as any).Authorization, 'Bearer protocol-override-rotated');
  assert.equal(body.model, 'protocol-model-v1'); assert.equal(body.chat_template_kwargs.reasoning_effort, 'low');
  assert.deepEqual(body.response_format.json_schema.schema, request.outputSchema);
  assert.equal(body.stream, true); assert.equal(result.provenance.model, 'protocol-model-v1');
  assert.doesNotMatch(JSON.stringify({ request, result, body }), /protocol-(?:override|key|query)/);
});

test('all configured text providers use exactly one fetch and their existing endpoint/parsing contracts', async t => {
  for (const provider of ['openai', 'deepseek', 'doubao', 'kie', 'llamacpp', 'gemini', 'minimax'] as const) {
    await t.test(provider, async () => {
      const h = harness(provider), request = h.request(), result = await h.send(request);
      assert.equal(h.calls.length, 1); assert.equal(result.text, 'protocol result\nsecond part');
      assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 2 });
      assert.equal(result.provenance.producer, provider);
      const sent = h.calls[0], body = JSON.parse(sent.init.body as string), headers = sent.init.headers as Record<string, string>;
      assert.equal(sent.init.method, 'POST'); assert.equal(sent.init.redirect, 'error'); assert.ok(sent.init.signal instanceof AbortSignal);
      assert.doesNotMatch(sent.url + JSON.stringify(body), /protocol-key/);
      if (provider === 'kie') { assert.equal(sent.url, 'https://api.kie.ai/gpt-4o-openai/v1/chat/completions'); assert.equal(body.model, undefined); assert.equal(body.chat_template_kwargs, undefined); assert.equal(body.stream, true); }
      else if (provider === 'gemini') { assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/models/protocol-model-v1:generateContent'); assert.equal(headers['x-goog-api-key'], 'protocol-key-old'); assert.equal(body.generationConfig.responseMimeType, 'application/json'); }
      else if (provider === 'minimax') { assert.equal(sent.url, 'https://api.minimaxi.com/anthropic/v1/messages'); assert.equal(headers['x-api-key'], 'protocol-key-old'); assert.equal(headers['anthropic-version'], '2023-06-01'); assert.equal(body.max_tokens, 8192); }
      else { assert.equal(body.model, 'protocol-model-v1'); assert.equal(headers.Authorization, provider === 'llamacpp' ? undefined : 'Bearer protocol-key-old'); }
    });
  }
});

test('OpenAI event-stream output uses the existing parser without a second request', async () => {
  const h = harness();
  h.respondWith(async () => new Response('data: {"choices":[{"delta":{"content":"protocol "}}]}\n\ndata: {"choices":[{"delta":{"content":"result"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'stream-id' } }));
  const result = await h.send(h.request());
  assert.equal(result.text, 'protocol result'); assert.equal(result.providerRequestId, 'stream-id'); assert.equal(h.calls.length, 1);
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
});

test('KIE HTTP 200 with service error is retained as failure, not empty model content', async () => {
  const h = harness('kie');
  h.respondWith(async () => new Response(JSON.stringify({code:500,msg:'internal error'}), {headers:{'content-type':'application/json'}}));
  const result = await h.send(h.request());
  assert.equal(result.failure?.code, 'TEXT_PROVIDER_SERVICE_ERROR');
  assert.match(result.failure!.message, /500/);
  assert.match(result.text, /internal error/);
  assert.equal(h.calls.length, 1);
});

test('missing, non-text and unsupported routes reject explicitly without a fallback', () => {
  const h = harness();
  assert.throws(() => h.transport.resolveRoute('unknown-route'), errorCode('TEXT_PROVIDER_ROUTE_MISSING'));
  const config = h.config; config.routing.scriptGen = 'missing'; h.set(config);
  assert.throws(() => h.transport.resolveRoute(), errorCode('TEXT_PROVIDER_MODEL_MISSING'));
  for (const provider of ['custom', 'comfyui'] as const) { h.set(configuration(provider)); assert.throws(() => h.transport.resolveRoute(), errorCode('TEXT_PROVIDER_UNSUPPORTED')); }
  const nontext = configuration(); nontext.models[0].capabilities = ['image']; h.set(nontext);
  assert.throws(() => h.transport.resolveRoute(), errorCode('TEXT_PROVIDER_MODEL_MISSING'));
  assert.equal(h.calls.length, 0); assert.equal(h.credentialReads, 0);
});

test('changed endpoint, provider, model or credential association cannot reuse the frozen route', async () => {
  const h = harness(), request = h.request();
  for (const change of [
    (c: AIConfigSnapshot) => { c.channels[0].baseUrl = 'https://new-provider.example/v1?token=protocol-secret'; },
    (c: AIConfigSnapshot) => { c.channels[0].type = 'deepseek'; c.channels[0].baseUrl = endpoints.deepseek!; },
    (c: AIConfigSnapshot) => { c.models[0].modelId = 'changed-model'; },
    (c: AIConfigSnapshot) => { c.channels[0].id = 'new-channel'; c.models[0].channelId = 'new-channel'; },
  ]) {
    const config = configuration(); change(config); h.set(config);
    assert.throws(() => h.transport.preflight(request), errorCode('TEXT_PROVIDER_ROUTE_CHANGED'));
    await assert.rejects(h.send(request), errorCode('TEXT_PROVIDER_ROUTE_CHANGED'));
  }
  assert.equal(h.calls.length, 0); assert.equal(h.credentialReads, 0);
});

test('preflight reuses the provider target policy and never returns credential-bearing diagnostics', async () => {
  const h = harness();
  for (const [provider, baseUrl] of [
    ['openai', 'https://user:protocol-password@api.openai.com/v1?token=protocol-query-secret'],
    ['gemini', 'https://unapproved.example/?token=protocol-query-secret'],
    ['kie', 'https://unapproved.example/?token=protocol-query-secret'],
    ['llamacpp', 'http://169.254.169.254/latest/meta-data'],
  ] as const) {
    const config = configuration(provider); config.channels[0].baseUrl = baseUrl; h.set(config);
    assert.throws(() => h.transport.resolveRoute(), (error: any) => { assert.equal(error.code, 'TEXT_PROVIDER_TARGET_INVALID'); assert.doesNotMatch(error.message, /protocol-|password|token=|169\.254/); return true; });
  }
  h.set(configuration());
  const original = h.request(), snapshot = JSON.parse(Buffer.from(original.routeRef.split(':').at(-1)!, 'base64url').toString());
  snapshot.apiKey = 'protocol-illegal-embedded-key';
  const changed = { ...original, routeRef: 'agent-text-route:v1:' + Buffer.from(JSON.stringify(snapshot)).toString('base64url') };
  await assert.rejects(h.send(changed), (error: any) => { assert.equal(error.code, 'TEXT_PROVIDER_ROUTE_INVALID'); assert.doesNotMatch(error.message, /protocol-/); return true; });
  assert.equal(h.calls.length, 0);
});

test('credential errors are preflight-only and a later send rechecks credentials and target identity', async () => {
  let credential = '';
  const h = harness('openai', { resolveCredential: () => credential }), request = h.request();
  assert.throws(() => h.transport.preflight(request), errorCode('TEXT_PROVIDER_KEY_MISSING'));
  assert.equal(h.calls.length, 0);
  credential = 'protocol-current-key'; h.transport.preflight(request);
  const changed = h.config; changed.channels[0].baseUrl = 'https://new-endpoint.example/v1'; h.set(changed);
  await assert.rejects(h.send(request), errorCode('TEXT_PROVIDER_ROUTE_CHANGED'));
  assert.equal(h.calls.length, 0);
  const failing = harness('openai', { resolveCredential: () => { throw new Error('protocol-private-key ?token=protocol-query-secret'); } });
  assert.throws(() => failing.transport.preflight(failing.request()), (error: any) => { assert.equal(error.code, 'TEXT_PROVIDER_CREDENTIAL_INVALID'); assert.doesNotMatch(error.message, /protocol-|token=/); return true; });
});

test('network and HTTP failures are each one attempt with sanitized errors', async () => {
  const cases = [
    { code: 'TEXT_PROVIDER_NETWORK_UNKNOWN', response: async () => { throw new Error('fetch https://endpoint/?token=protocol-secret Authorization: Bearer protocol-private-key'); } },
    { code: 'TEXT_PROVIDER_HTTP_FAILED', response: async () => new Response('protocol-private-key ?token=protocol-secret', { status: 429 }) },
    { code: 'TEXT_PROVIDER_HTTP_FAILED', response: async () => new Response('protocol-private-key', { status: 503 }) },
  ];
  for (const value of cases) {
    const h = harness(); h.respondWith(value.response);
    await assert.rejects(h.send(h.request()), (error: any) => { assert.equal(error.code, value.code); assert.doesNotMatch(error.message, /protocol-|token=|Bearer/); return true; });
    assert.equal(h.calls.length, 1);
  }
});

test('explicit provider token truncation is retained but not consumed', async () => {
  for (const [provider, payload] of [
    ['openai', { choices: [{ message: { content: 'protocol partial' }, finish_reason: 'length' }] }],
    ['gemini', { candidates: [{ content: { parts: [{ text: 'protocol partial' }] }, finishReason: 'MAX_TOKENS' }] }],
    ['minimax', { content: [{ type: 'text', text: 'protocol partial' }], stop_reason: 'max_tokens' }],
  ] as const) {
    const h = harness(provider), raw = JSON.stringify(payload);
    h.respondWith(async () => new Response(raw));
    const result = await h.send(h.request());
    assert.equal(result.text, raw); assert.equal(result.validationErrors?.length, 1); assert.equal(h.calls.length, 1);
  }
});

test('abort and timeout reach the sole fetch; already aborted requests do not dispatch', async () => {
  const h = harness(), controller = new AbortController(); let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  h.respondWith(async (_url, init) => { entered(); return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('protocol-abort-secret')), { once: true })); });
  const pending = h.send(h.request(), controller.signal); await started; controller.abort();
  await assert.rejects(pending, errorCode('TEXT_PROVIDER_NETWORK_UNKNOWN')); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init.signal!.aborted, true);
  await assert.rejects(h.send(h.request(), controller.signal)); assert.equal(h.calls.length, 1);
  const timed = harness('openai', {}, 10);
  timed.respondWith(async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timed.send(timed.request()), errorCode('TEXT_PROVIDER_NETWORK_UNKNOWN')); } finally { clearTimeout(keepAlive); }
  assert.equal(timed.calls.length, 1); assert.equal(timed.calls[0].init.signal!.aborted, true);
});

test('output mode is frozen per request while later requests can change modes', async () => {
  const h = harness(); const first = h.request();
  const changed = h.config; changed.models[0].textOutputMode = 'prompt-json'; h.set(changed);
  await h.send(first); await h.send(h.request());
  const bodies = h.calls.map(call => JSON.parse(call.init.body as string));
  assert.equal(bodies[0].response_format.type, 'json_schema');
  assert.equal(bodies[1].response_format, undefined);
  assert.match(bodies[1].messages[0].content, /JSON Schema/);
  assert.equal(h.transport.outputPolicy!(first).maxFormatCorrections, 1);
});

test('stream refusal and truncation retain exact evidence with actionable classification', async () => {
  for (const [delta, finish, expected] of [[{ refusal: 'fixture refusal' }, 'stop', 'REFUSAL'], [{ content: '{' }, 'length', 'INCOMPLETE']] as const) {
    const h = harness();
    const raw = `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: ${JSON.stringify({ choices: [{ finish_reason: finish }] })}\n\ndata: [DONE]\n\n`;
    h.respondWith(async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }));
    const result = await h.send(h.request());
    assert.equal(result.text, raw); assert.equal(result.failure?.kind, expected); assert.equal(h.calls.length, 1);
  }
});

test('generic server entry shares strict parsing, provider profile, usage metadata and one-send failure handling', async () => {
  const { generateServerGenericAIJson, parseGenericAIJson } = await import('../apps/api/src/providers/genericAIProvider');
  assert.deepEqual(parseGenericAIJson('```json\n{"text":"ok"}\n```'), { text: 'ok' });
  assert.throws(() => parseGenericAIJson('explanation {"text":"ok"}'));
  assert.throws(() => parseGenericAIJson('{"text":"partial'));
  const config = configuration('deepseek'); config.models[0].textOutputMode = 'prompt-json'; dbHelpers.saveAIConfig(config);
  const previous = globalThis.fetch; let calls = 0; let content = '{"text":"ok"}';
  globalThis.fetch = (async (_url, init) => {
    calls++; const body = JSON.parse(init!.body as string);
    assert.equal(body.response_format, undefined); assert.match(body.messages[0].content, /JSON Schema/);
    return new Response(JSON.stringify({ id: 'mechanical-request', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
  }) as typeof fetch;
  try {
    const input = { prompt: 'Protocol output only', responseSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } };
    const result = await generateServerGenericAIJson(input);
    assert.deepEqual(result, { text: 'ok' });
    assert.equal((result as any)[Symbol.for('writing.modelCallMetadata')].inputTokens, 7);
    content = '{"text":7}'; await assert.rejects(generateServerGenericAIJson(input), /不符合约定/);
    assert.equal(calls, 2); // one request per explicit invocation, no untracked correction
  } finally { globalThis.fetch = previous; }
});


test('explicit generic model selection uses the requested model rather than changing global routing', async()=>{
 const {generateServerGenericAIJson}=await import('../apps/api/src/providers/genericAIProvider');
 const config=configuration('deepseek');const other={...config.models[0],id:'explicit-world-model',modelId:'world-model'};config.models.push(other);dbHelpers.saveAIConfig(config);const prior=globalThis.fetch;let used='';
 globalThis.fetch=(async (_url,init)=>{used=JSON.parse(init!.body as string).model;return new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]}));}) as typeof fetch;
 try{await generateServerGenericAIJson({prompt:'Return JSON',modelConfigId:other.id});assert.equal(used,'world-model');assert.notEqual(dbHelpers.getAIConfig().config.routing.scriptGen,other.id);await assert.rejects(generateServerGenericAIJson({prompt:'Return JSON',modelConfigId:'missing'}),/不存在/);}finally{globalThis.fetch=prior;}
});

 test('schema-capable channels stream long JSON tasks even without an output schema', async()=>{
 const h=harness();const request=h.request();delete request.outputSchema;request.outputFormat='json';await h.send(request);const body=JSON.parse(h.calls[0].init.body as string);assert.equal(body.stream,true);assert.equal(body.response_format.type,'json_object');assert.equal(h.calls.length,1);
 });

test('deadline also ends a stalled fetch or response body that ignores abort signals', async()=>{
 const c=configuration();dbHelpers.saveAIConfig(c);
 for(const bodyStalls of [false,true]){
  const transport=createTextModelTransport({getConfig:()=>c,providerAccess:access,timeoutMs:25,fetch:async()=>bodyStalls?new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));}}),{headers:{'content-type':'text/event-stream'}}):await new Promise<Response>(()=>{})});
  const start=performance.now();await assert.rejects(transport.sendOnce({...transport.resolveRoute(),operationKey:'deadline',prompt:'protocol-only'},{attemptId:'one',signal:new AbortController().signal}),errorCode('TEXT_PROVIDER_NETWORK_UNKNOWN'));assert.ok(performance.now()-start<1000);
 }
});

test('terminal SSE event completes even when the provider leaves the HTTP body open',async()=>{
 const h=harness();let canceled=false;h.respondWith(async()=>new Response(new ReadableStream({start(c){for(const chunk of ['data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n','data: [DO','NE]\n\n'])c.enqueue(new TextEncoder().encode(chunk));},cancel(){canceled=true;}}),{headers:{'content-type':'text/event-stream'}}));const r=await h.send(h.request());assert.equal(r.text,'done');assert.equal(canceled,true);
});

test('explicit thinking toggle survives config normalization and stays frozen for the request',async()=>{
 const h=harness(),c=h.config;c.models[0].enableThinking=false;c.models[0].maxOutputTokens=16384;h.set(c);assert.equal(dbHelpers.getAIConfig().config.models[0].enableThinking,false);const r=h.request();c.models[0].enableThinking=true;h.set(c);await h.send(r);assert.equal(JSON.parse(h.calls[0].init.body as string).chat_template_kwargs.enable_thinking,false);assert.equal(JSON.parse(h.calls[0].init.body as string).max_tokens,16384);
});
