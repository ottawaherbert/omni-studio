import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { AgentError, invokeModel, stableJson, type ModelRequest } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { createAgentModelTransport, type AgentProviderAccess } from '../apps/api/src/providers/agentModelTransport';
import { withDirectHistoryRead } from '../apps/api/src/agent/scriptChatHistoryResolve';
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
const access: AgentProviderAccess = {
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
function harness(provider: ChannelType = 'openai', overrides: Partial<AgentProviderAccess> = {}, timeoutMs?: number) {
  let config = configuration(provider), calls: Array<{ url: string; init: RequestInit }> = [], credentialReads = 0;
  let response = async (_url: string, _init: RequestInit) => fixtureResponse(provider);
  const set = (next: AIConfigSnapshot) => { config = structuredClone(next); dbHelpers.saveAIConfig(config); };
  set(config);
  const providerAccess: AgentProviderAccess = { ...access, ...overrides, resolveCredential: (...args) => { credentialReads++; return (overrides.resolveCredential || access.resolveCredential)(...args); } };
  const transport = createAgentModelTransport({ getConfig: () => structuredClone(config), providerAccess, timeoutMs, fetch: (async (url, init) => { calls.push({ url: String(url), init: init! }); return response(String(url), init!); }) as typeof fetch });
  const request = (): ModelRequest => ({ ...transport.resolveRoute(), operationKey: 'protocol-operation', prompt: 'mechanical protocol prompt', systemInstruction: 'mechanical protocol system', outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } });
  const send = (input: ModelRequest, signal = new AbortController().signal) => transport.sendOnce(input, { attemptId: 'protocol-attempt', signal });
  return { transport, request, send, calls, set, get config() { return structuredClone(config); }, get credentialReads() { return credentialReads; }, respondWith: (fn: typeof response) => { response = fn; } };
}

test('importing the pure transport never opens the application database', () => {
  const filename = path.join(directory, 'must-not-be-opened.sqlite');
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "await import('./apps/api/src/providers/agentModelTransport.ts')"], { cwd: path.resolve('.'), env: { ...process.env, OMNI_DB_PATH: filename }, encoding: 'utf8' });
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

test('direct history choice is sent to OpenAI as a strict object-root schema',async()=>{
  const h=harness(),request=h.request();
  request.outputSchema=withDirectHistoryRead(request.outputSchema as Record<string,unknown>);
  await h.send(request);
  const body=JSON.parse(h.calls[0].init.body as string),format=body.response_format.json_schema;
  assert.equal(format.strict,true);assert.equal(format.schema.type,'object');
  assert.deepEqual(format.schema.required,['response']);
  assert.equal(format.schema.properties.response.anyOf.length,2);
  assert.equal(format.schema.oneOf,undefined);
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
      if (provider === 'kie') { assert.equal(sent.url, 'https://api.kie.ai/gpt-4o-openai/v1/chat/completions'); assert.equal(body.model, undefined); assert.equal(body.chat_template_kwargs, undefined); }
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

test('missing, non-text and unsupported routes reject explicitly without a fallback', () => {
  const h = harness();
  assert.throws(() => h.transport.resolveRoute('unknown-route'), errorCode('AGENT_PROVIDER_ROUTE_MISSING'));
  const config = h.config; config.routing.scriptGen = 'missing'; h.set(config);
  assert.throws(() => h.transport.resolveRoute(), errorCode('AGENT_PROVIDER_MODEL_MISSING'));
  for (const provider of ['custom', 'comfyui'] as const) { h.set(configuration(provider)); assert.throws(() => h.transport.resolveRoute(), errorCode('AGENT_PROVIDER_UNSUPPORTED')); }
  const nontext = configuration(); nontext.models[0].capabilities = ['image']; h.set(nontext);
  assert.throws(() => h.transport.resolveRoute(), errorCode('AGENT_PROVIDER_MODEL_MISSING'));
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
    assert.throws(() => h.transport.preflight(request), errorCode('AGENT_PROVIDER_ROUTE_CHANGED'));
    await assert.rejects(h.send(request), errorCode('AGENT_PROVIDER_ROUTE_CHANGED'));
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
    assert.throws(() => h.transport.resolveRoute(), (error: any) => { assert.equal(error.code, 'AGENT_PROVIDER_TARGET_INVALID'); assert.doesNotMatch(error.message, /protocol-|password|token=|169\.254/); return true; });
  }
  h.set(configuration());
  const original = h.request(), snapshot = JSON.parse(Buffer.from(original.routeRef.split(':').at(-1)!, 'base64url').toString());
  snapshot.apiKey = 'protocol-illegal-embedded-key';
  const changed = { ...original, routeRef: 'agent-text-route:v1:' + Buffer.from(JSON.stringify(snapshot)).toString('base64url') };
  await assert.rejects(h.send(changed), (error: any) => { assert.equal(error.code, 'AGENT_PROVIDER_ROUTE_INVALID'); assert.doesNotMatch(error.message, /protocol-/); return true; });
  assert.equal(h.calls.length, 0);
});

test('credential errors are preflight-only and a later send rechecks credentials and target identity', async () => {
  let credential = '';
  const h = harness('openai', { resolveCredential: () => credential }), request = h.request();
  assert.throws(() => h.transport.preflight(request), errorCode('AGENT_PROVIDER_KEY_MISSING'));
  assert.equal(h.calls.length, 0);
  credential = 'protocol-current-key'; h.transport.preflight(request);
  const changed = h.config; changed.channels[0].baseUrl = 'https://new-endpoint.example/v1'; h.set(changed);
  await assert.rejects(h.send(request), errorCode('AGENT_PROVIDER_ROUTE_CHANGED'));
  assert.equal(h.calls.length, 0);
  const failing = harness('openai', { resolveCredential: () => { throw new Error('protocol-private-key ?token=protocol-query-secret'); } });
  assert.throws(() => failing.transport.preflight(failing.request()), (error: any) => { assert.equal(error.code, 'AGENT_PROVIDER_CREDENTIAL_INVALID'); assert.doesNotMatch(error.message, /protocol-|token=/); return true; });
});

test('network and HTTP failures are each one attempt with sanitized errors', async () => {
  const cases = [
    { code: 'AGENT_PROVIDER_NETWORK_UNKNOWN', response: async () => { throw new Error('fetch https://endpoint/?token=protocol-secret Authorization: Bearer protocol-private-key'); } },
    { code: 'AGENT_PROVIDER_HTTP_FAILED', response: async () => new Response('protocol-private-key ?token=protocol-secret', { status: 429 }) },
    { code: 'AGENT_PROVIDER_HTTP_FAILED', response: async () => new Response('protocol-private-key', { status: 503 }) },
  ];
  for (const value of cases) {
    const h = harness(); h.respondWith(value.response);
    await assert.rejects(h.send(h.request()), (error: any) => { assert.equal(error.code, value.code); assert.doesNotMatch(error.message, /protocol-|token=|Bearer/); return true; });
    assert.equal(h.calls.length, 1);
  }
});

function journalHost(t: any) {
  const database = new Database(':memory:'); t.after(() => database.close());
  const store = new AgentSqliteStore(database); store.ensureSchema();
  const journal = new SqliteModelJournal(store); journal.ensureSchema();
  store.accept({ requestId: 'protocol-command', ownerId: 'protocol-author', scopeId: 'protocol', kind: 'CHAT', input: {}, policyRevision: '1', maxInvocations: 1 });
  const claim = store.claim('protocol-worker', 30000)!;
  return { database, store, journal, claim };
}

test('provider returns without optional metadata commit to SQLite and replay without consulting config or resending', async t => {
  const h = harness(), j = journalHost(t), request = h.request();
  h.respondWith(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"protocol result without usage"}' } }] })));
  const result = await invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal);
  assert.equal(result.usage, undefined); assert.doesNotThrow(() => stableJson(result));
  assert.equal((j.database.prepare('SELECT status FROM agent_invocations').get() as any).status, 'RECEIVED');
  const changed = h.config; changed.models = []; h.set(changed);
  assert.deepEqual(await invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), result);
  assert.equal(h.calls.length, 1); assert.equal((j.database.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1);
});

test('HTTP 200 malformed/empty final responses preserve exact received evidence and remain non-consumable on replay', async t => {
  for (const [raw, contentType] of [
    ['data: {"error":{"message":"protocol diagnostic"}}\n\n', 'text/event-stream'],
    [JSON.stringify({ choices: [{ message: { reasoning_content: 'protocol thought, no final answer' } }] }), 'application/json'],
    ['', 'application/json'],
  ]) {
    const h = harness(), j = journalHost(t), request = h.request();
    h.respondWith(async () => new Response(raw, { headers: { 'content-type': contentType } }));
    await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode('MODEL_RESULT_METADATA_INVALID'));
    const saved = j.database.prepare('SELECT status,result_json FROM agent_invocations').get() as any;
    assert.equal(saved.status, 'RECEIVED'); assert.equal(JSON.parse(saved.result_json).text, raw);
    assert.equal(JSON.parse(saved.result_json).validationErrors.length, 1);
    assert.equal((j.database.prepare('SELECT status FROM agent_attempts').get() as any).status, 'RECEIVED');
    await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode('MODEL_RESULT_METADATA_INVALID'));
    assert.equal(h.calls.length, 1);
  }
});

test('200 HTML, plain text and fake text envelopes cannot become consumable provider results', async t => {
  for (const provider of ['openai', 'gemini', 'minimax'] as const) {
    for (const raw of ['<html>upstream maintenance</html>', 'upstream unavailable', '{"text":"not a provider envelope"}']) {
      const h = harness(provider), j = journalHost(t), request = h.request();
      h.respondWith(async () => new Response(raw, { headers: { 'content-type': 'text/html' } }));
      await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode('MODEL_RESULT_METADATA_INVALID'));
      const saved = j.database.prepare('SELECT status,result_json FROM agent_invocations').get() as any;
      assert.equal(saved.status, 'RECEIVED'); assert.equal(JSON.parse(saved.result_json).text, raw);
      assert.equal(JSON.parse(saved.result_json).validationErrors.length, 1);
      await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode('MODEL_RESULT_METADATA_INVALID'));
      assert.equal(h.calls.length, 1);
    }
  }
});

test('truncated or malformed streams preserve raw evidence instead of consuming partial model output', async t => {
  const prefix = 'data: {"choices":[{"delta":{"content":"protocol partial output"}}]}\n\n';
  for (const raw of [prefix, prefix + 'data: not-json\n\ndata: [DONE]\n\n', prefix + 'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n']) {
    const h = harness(), j = journalHost(t), request = h.request();
    h.respondWith(async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }));
    await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode(raw.includes('length') ? 'MODEL_INCOMPLETE' : 'MODEL_RESULT_METADATA_INVALID'));
    const saved = j.database.prepare('SELECT status,result_json FROM agent_invocations').get() as any;
    assert.equal(saved.status, 'RECEIVED'); assert.equal(JSON.parse(saved.result_json).text, raw); assert.equal(h.calls.length, 1);
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

test('real provider preflight failure records no physical attempt and network uncertainty records exactly one', async t => {
  const h = harness('openai', { resolveCredential: () => '' }), j = journalHost(t), request = h.request();
  await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode('AGENT_PROVIDER_KEY_MISSING'));
  assert.equal((j.database.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 0);
  assert.equal((j.database.prepare('SELECT status FROM agent_invocations').get() as any).status, 'PREPARED');
  const network = harness(); network.respondWith(async () => { throw new Error('protocol network uncertainty'); });
  await assert.rejects(invokeModel(j.journal, network.transport, j.claim.token, request, new AbortController().signal), errorCode('RECONCILIATION_REQUIRED'));
  assert.equal((j.database.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1);
  assert.equal((j.database.prepare('SELECT status FROM agent_invocations').get() as any).status, 'UNKNOWN');
  assert.equal(network.calls.length, 1);
});

test('abort and timeout reach the sole fetch; already aborted requests do not dispatch', async () => {
  const h = harness(), controller = new AbortController(); let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  h.respondWith(async (_url, init) => { entered(); return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('protocol-abort-secret')), { once: true })); });
  const pending = h.send(h.request(), controller.signal); await started; controller.abort();
  await assert.rejects(pending, errorCode('AGENT_PROVIDER_NETWORK_UNKNOWN')); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init.signal!.aborted, true);
  await assert.rejects(h.send(h.request(), controller.signal)); assert.equal(h.calls.length, 1);
  const timed = harness('openai', {}, 10);
  timed.respondWith(async (_url, init) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true })));
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timed.send(timed.request()), errorCode('AGENT_PROVIDER_NETWORK_UNKNOWN')); } finally { clearTimeout(keepAlive); }
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

test('complete HTTP 400 is recorded as failure, not an unknown invocation', async t => {
  const h = harness(), j = journalHost(t), request = h.request();
  h.respondWith(async () => new Response('{"error":{"message":"unsupported format"}}', { status: 400 }));
  for (let i = 0; i < 2; i++) await assert.rejects(invokeModel(j.journal, h.transport, j.claim.token, request, new AbortController().signal), errorCode('AGENT_PROVIDER_HTTP_FAILED'));
  assert.equal(h.calls.length, 1);
  const row = j.database.prepare('SELECT status,result_json FROM agent_invocations').get() as any;
  assert.equal(row.status, 'RECEIVED'); assert.equal(JSON.parse(row.result_json).failure.httpStatus, 400);
  assert.notEqual(j.store.readRun(j.claim.run.id).status, 'RECONCILIATION_REQUIRED');
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
