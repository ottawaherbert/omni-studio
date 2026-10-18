import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { parseModelJson, ModelOutputError, assertModelSchema, providerCompletionFailure, jsonTransportMode } from '../packages/model-output/src';
import { resolveTextOutputProfile } from '../src/config/textModelOutput';
import { AgentError, ModelResponseError, formatCorrectionRequest, invokeModel, type ModelRequest, type ModelResult, type ModelTransport } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteModelJournal } from '../packages/agent-sqlite/src';

const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const request: ModelRequest = { operationKey: 'task', channel: 'api', routeRef: 'mock:frozen', prompt: 'Protocol only', outputSchema: schema };
const receipt = (text: string): ModelResult => ({ text, provenance: { channel: 'provider', model: 'mechanical-fixture' }, usage: { inputTokens: 10, outputTokens: 2 } });
const code = (expected: string) => (error: unknown) => error instanceof AgentError && error.code === expected;
const signal = () => new AbortController().signal;
function setup(t: any, maxInvocations = 3, guard?: ConstructorParameters<typeof SqliteModelJournal>[1]) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const journal = new SqliteModelJournal(store, guard); journal.ensureSchema();
  store.accept({ requestId: 'request', ownerId: 'author', scopeId: 'test', kind: 'CHAT', input: {}, policyRevision: '1', maxInvocations });
  const claim = store.claim('worker', 30000)!;
  return { db, store, journal, claim };
}
function transportFor(outputs: (ModelResult | Error)[]) {
  const requests: ModelRequest[] = [];
  const transport: ModelTransport = { outputPolicy: () => ({ validateSchema: true, maxFormatCorrections: 1 }), sendOnce: async req => {
    requests.push(structuredClone(req));
    const output = outputs[requests.length - 1];
    assert.ok(output, 'unexpected additional model call');
    if (output instanceof Error) throw output;
    return output;
  } };
  return { transport, requests };
}

test('shared JSON boundary only removes an entire code fence; rejects ambiguity and incomplete data', () => {
  for (const raw of ['{"text":"ok"}', '\uFEFF  {"text":"ok"} ', '```json\n{"text":"ok"}\n```', '```\r\n{"text":"ok"}\r\n```'])
    assert.deepEqual(parseModelJson(raw, schema), { text: 'ok' });
  for (const raw of ['', 'explanation {"text":"ok"}', '{"text":"ok"} trailing', '{"text":"ok",}', '{"text":"ok"', '{"text":"a"}{"text":"b"}', '```json\n{}\n```\n```json\n{}\n```'])
    assert.throws(() => parseModelJson(raw), (e: any) => e instanceof ModelOutputError && e.kind === 'SYNTAX');
});

test('schema boundary neither coerces fields, drops unknown keys nor inserts defaults', () => {
  for (const value of [{ text: 1 }, {}, { text: 'ok', tool: 'delete' }]) {
    const before = structuredClone(value);
    assert.throws(() => parseModelJson(JSON.stringify(value), schema), (e: any) => e.kind === 'SCHEMA');
    assert.deepEqual(value, before);
  }
  assert.throws(() => assertModelSchema({ type: 'not-a-type' }), (e: any) => e.kind === 'CONTRACT');
  assert.equal(jsonTransportMode('json-schema', schema), 'json-schema');
  assert.equal(jsonTransportMode('json-schema', { type: 'array', items: schema }), 'prompt-json');
  assert.equal(jsonTransportMode('json-schema', { type: 'object', properties: { text: { type: 'string' } } }), 'json-object');
});

test('capability selection uses endpoint/configuration and defaults unknown gateways to prompt JSON', () => {
  assert.equal(resolveTextOutputProfile({ provider: 'openai', endpoint: 'https://proxy.example/v1', modelId: 'gpt-any' }).mode, 'prompt-json');
  assert.equal(resolveTextOutputProfile({ provider: 'openai', endpoint: 'https://api.openai.com/v1', modelId: 'fixture' }).mode, 'json-schema');
  assert.equal(resolveTextOutputProfile({ provider: 'openai', endpoint: 'https://proxy.example/v1', modelId: 'fixture', mode: 'json-object' }).source, 'configured');
  assert.throws(() => resolveTextOutputProfile({ provider: 'minimax', endpoint: 'https://api.minimaxi.com', modelId: 'fixture', mode: 'json-schema' }));
});

for (const invalid of ['not-json', '{"text":123}']) test(`one recorded correction for ${invalid}, immutable source and deterministic replay`, async t => {
  const h = setup(t), m = transportFor([receipt(invalid), receipt('{"text":"ok"}')]);
  const result = await invokeModel(h.journal, m.transport, h.claim.token, request, signal());
  assert.equal(m.requests.length, 2); assert.equal(result.text, '{"text":"ok"}'); assert.ok(result.correctionInvocationId);
  assert.equal(m.requests[1].prompt, request.prompt); assert.deepEqual(m.requests[1].outputSchema, schema);
  assert.equal(m.requests[1].formatCorrection?.invalidText, invalid);
  const source = h.journal.prepare(h.claim.token, request);
  assert.equal(source.result?.text, invalid); assert.deepEqual(h.journal.resolvedResult(source.id), result);
  assert.deepEqual(await invokeModel(h.journal, m.transport, h.claim.token, request, signal()), result);
  assert.equal(m.requests.length, 2); assert.equal(h.store.readRun(h.claim.run.id).invocationCount, 2);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 2);
});

test('valid JSON fences need no correction; plain text tasks do not require JSON', async t => {
  const h = setup(t), m = transportFor([receipt('```json\n{"text":"ok"}\n```'), receipt('plain prose')]);
  await invokeModel(h.journal, m.transport, h.claim.token, request, signal());
  await invokeModel(h.journal, m.transport, h.claim.token, { ...request, operationKey: 'text', outputSchema: undefined }, signal());
  assert.equal(m.requests.length, 2);
});

test('bad correction stops at two calls, and replay or direct resolution cannot accept it', async t => {
  const h = setup(t), m = transportFor([receipt('bad'), receipt('{"text":42}')]);
  for (let i = 0; i < 2; i++) await assert.rejects(invokeModel(h.journal, m.transport, h.claim.token, request, signal()), code('MODEL_OUTPUT_INVALID'));
  assert.equal(m.requests.length, 2);
  assert.throws(() => h.journal.resolvedResult(h.journal.prepare(h.claim.token, request).id));
});

test('correction cannot evade invocation budget', async t => {
  const h = setup(t, 1), m = transportFor([receipt('bad')]);
  await assert.rejects(invokeModel(h.journal, m.transport, h.claim.token, request, signal()), code('BUDGET_EXHAUSTED'));
  assert.equal(m.requests.length, 1); assert.equal(h.store.readRun(h.claim.run.id).status, 'PARTIAL');
});

test('unknown correction is preserved and never resent', async t => {
  const h = setup(t), m = transportFor([receipt('bad'), new Error('connection lost')]);
  await assert.rejects(invokeModel(h.journal, m.transport, h.claim.token, request, signal()), code('RECONCILIATION_REQUIRED'));
  assert.equal(m.requests.length, 2); assert.equal(h.store.readRun(h.claim.run.id).status, 'RECONCILIATION_REQUIRED');
  const rows = h.db.prepare('SELECT status FROM agent_invocations ORDER BY operation_key').all() as any[];
  assert.deepEqual(rows.map(r => r.status), ['RECEIVED', 'UNKNOWN']);
  assert.throws(() => h.journal.resolvedResult((h.db.prepare("SELECT id FROM agent_invocations WHERE operation_key='task'").get() as any).id), code('MODEL_CORRECTION_PENDING'));
});

test('HTTP rejection is received evidence and replay never retries it', async t => {
  const h = setup(t), error = new ModelResponseError({ ...receipt(''), failure: { kind: 'HTTP', code: 'HTTP_BAD_REQUEST', message: 'HTTP 400', httpStatus: 400 } });
  const m = transportFor([error]);
  for (let i = 0; i < 2; i++) await assert.rejects(invokeModel(h.journal, m.transport, h.claim.token, request, signal()), code('HTTP_BAD_REQUEST'));
  assert.equal(m.requests.length, 1); assert.notEqual(h.store.readRun(h.claim.run.id).status, 'RECONCILIATION_REQUIRED');
  assert.equal((h.db.prepare('SELECT status FROM agent_attempts').get() as any).status, 'RECEIVED');
});

for (const kind of ['REFUSAL', 'INCOMPLETE'] as const) test(`${kind} does not trigger format correction even for valid JSON`, async t => {
  const h = setup(t), m = transportFor([{ ...receipt('{"text":"ok"}'), failure: { kind, code: kind, message: kind } }]);
  await assert.rejects(invokeModel(h.journal, m.transport, h.claim.token, request, signal()), code(kind));
  assert.equal(m.requests.length, 1);
});

test('correction never changes frozen context, route, schema or source reference', async t => {
  const h = setup(t), source = h.journal.prepare(h.claim.token, request), attempt = h.journal.startAttempt(h.claim.token, source.id);
  h.journal.recordResult(source.id, attempt.attemptId, receipt('bad'));
  const correction = formatCorrectionRequest(h.journal.read(source.id));
  for (const patch of [{ prompt: 'new goal' }, { routeRef: 'different' }, { outputSchema: { type: 'string' } }, { formatCorrection: { ...correction.formatCorrection!, invalidText: 'forged' } }])
    assert.throws(() => h.journal.prepare(h.claim.token, { ...correction, ...patch }), code('MODEL_CORRECTION_DENIED'));
  const foreign = h.store.accept({ requestId: 'other', ownerId: 'author', scopeId: 'other', kind: 'CHAT', input: {}, policyRevision: '1', maxInvocations: 3 });
  const other = h.store.claim('other-worker', 30000, foreign.runId)!;
  assert.throws(() => h.journal.prepare(other.token, correction), code('MODEL_CORRECTION_DENIED'));
});

test('context changes and cancellation after source return prevent correction dispatch', async t => {
  for (const cancel of [false, true]) {
    let allowed = true;
    const h = setup(t, 3, () => { if (!allowed) throw new AgentError('CONTEXT_CHANGED', 'changed'); });
    let calls = 0;
    const transport: ModelTransport = { outputPolicy: () => ({ validateSchema: true, maxFormatCorrections: 1 }), sendOnce: async () => {
      calls++;
      if (cancel) h.store.control(h.claim.run.id, 'author', h.store.readRun(h.claim.run.id).version, 'cancel', 'cancel');
      else allowed = false;
      return receipt('bad');
    } };
    await assert.rejects(invokeModel(h.journal, transport, h.claim.token, request, signal()), code(cancel ? 'LEASE_LOST' : 'CONTEXT_CHANGED'));
    assert.equal(calls, 1); assert.equal((h.db.prepare('SELECT status FROM agent_invocations').get() as any).status, 'RECEIVED');
  }
});

test('provider completion classification covers refusals and all supported token-limit spellings', () => {
  assert.equal(providerCompletionFailure({ choices: [{ message: { refusal: 'no' } }] })?.kind, 'REFUSAL');
  assert.equal(providerCompletionFailure({ promptFeedback: { blockReason: 'SAFETY' } })?.kind, 'REFUSAL');
  for (const reason of ['length', 'MAX_TOKENS', 'max_tokens']) assert.equal(providerCompletionFailure({ stop_reason: reason })?.kind, 'INCOMPLETE');
  assert.equal(providerCompletionFailure({ error: { message: 'bad' } })?.kind, 'INVALID_RESPONSE');
});

test('historical correction stays viewable after input advances, but cannot be consumed as new work', t => {
  const h = setup(t), source = h.journal.prepare(h.claim.token, request), attempt = h.journal.startAttempt(h.claim.token, source.id);
  h.journal.recordResult(source.id, attempt.attemptId, receipt('bad'));
  const correction = formatCorrectionRequest(h.journal.read(source.id));
  const later = { ...h.store.readRun(h.claim.run.id), generation: 2 };
  assert.doesNotThrow(() => h.journal.assertRunInput(correction, later, 'VIEW'));
  assert.throws(() => h.journal.assertRunInput(correction, later, 'CONSUME'), code('MODEL_CORRECTION_DENIED'));
});

test('oversized malformed output is retained without an unbounded correction prompt',async t=>{
  const h=setup(t),m=transportFor([receipt('x'.repeat(128001))]);
  await assert.rejects(invokeModel(h.journal,m.transport,h.claim.token,request,signal()),code('MODEL_CORRECTION_LIMIT'));
  assert.equal(m.requests.length,1);
  assert.equal(h.journal.prepare(h.claim.token,request).result?.text.length,128001);
});
