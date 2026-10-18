import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentError, hashValue, invokeModel, type ModelRequest, type ModelTransport } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteContextStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { preparedFixture } from './fixtures/agent-store-fixture';

// Protocol constants only. Creative/model acceptance returns are produced by
// the user-authorized GPT-6 Sol subagent and injected through the real API.
const request: ModelRequest = { operationKey: 'protocol-1', channel: 'api', routeRef: 'test:no-network', prompt: 'protocol sentinel', outputSchema: { type: 'string' } };
const result = { text: 'protocol-receipt', provenance: { channel: 'provider' as const, producer: 'mechanical transport stub' } };
const signal = () => new AbortController().signal;
const code = (value: string) => (error: unknown) => error instanceof AgentError && error.code === value;
function setup(t: any, maxInvocations = 3) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-model-'));
  const filename = path.join(dir, 'isolated.sqlite');
  const db = new Database(filename);
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const journal = new SqliteModelJournal(store); journal.ensureSchema();
  const accepted = store.accept({ requestId: 'command', ownerId: 'author', scopeId: 'test', kind: 'CHAT', input: {}, policyRevision: '1', maxInvocations });
  const claim = store.claim('worker', 30000)!;
  t.after(() => { if (db.open) db.close(); rmSync(dir, { force: true, recursive: true }); });
  return { db, filename, store, journal, accepted, claim };
}
const neverSend: ModelTransport = { sendOnce: async () => { throw new Error('Transport must not be entered'); } };

test('one model preparation shares a bounded source validation window across owner and request guards', t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const contexts = new SqliteContextStore(store, () => true, () => '', () => true, 25); contexts.ensureSchema();
  const accepted = store.accept({ requestId: 'bounded-model', ownerId: 'author', scopeId: 'test', kind: 'CHAT', input: {}, policyRevision: '1', maxInvocations: 3 });
  const parent = store.claim('parent', 30000, accepted.runId)!;
  const step = store.savePrepared(parent.token, preparedFixture(parent.run)); store.handoff(parent.token, step.id);
  const child = store.claimChild('child', 30000, accepted.runId)!;
  const busy = () => { const until = Date.now() + 18; while (Date.now() < until) { /* bounded mechanical validation */ } };
  store.setBudgetAccounting({ bound: () => false, timeAvailable: () => true, activity: () => {}, stopActivity: () => {},
    guardDecision: () => busy(), reserve: () => true, attempt: () => {}, usage: () => {} });
  const journal = new SqliteModelJournal(store, () => busy(), read => contexts.withValidationBatch(read)); journal.ensureSchema();
  assert.throws(() => journal.prepare(child.token, request), code('CONTEXT_VALIDATION_LIMIT'));
  assert.equal((db.prepare('SELECT count(*) n FROM agent_invocations').get() as any).n, 0);
  assert.equal(store.readRun(accepted.runId).invocationCount, 0);
});

test('one physical send, raw result survives replay and logical budget counts once', async t => {
  const { store, journal, claim } = setup(t);
  let sent = 0;
  const transport: ModelTransport = { sendOnce: async () => { sent++; return result; } };
  assert.deepEqual(await invokeModel(journal, transport, claim.token, request, signal()), result);
  assert.deepEqual(await invokeModel(journal, neverSend, claim.token, request, signal()), result);
  assert.equal(sent, 1);
  assert.equal(store.readRun(claim.run.id).invocationCount, 1);
  await assert.rejects(invokeModel(journal, transport, claim.token, { ...request, prompt: 'changed' }, signal()), code('IDEMPOTENCY_CONFLICT'));
});

test('process-loss boundary after SENT becomes unknown on takeover; never automatically sends again', async t => {
  const { db, journal, claim, store } = setup(t);
  const invocation = journal.prepare(claim.token, request);
  journal.startAttempt(claim.token, invocation.id);
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(claim.run.id);
  const replacement = store.claim('replacement', 30000)!;
  await assert.rejects(invokeModel(journal, neverSend, replacement.token, request, signal()), code('RECONCILIATION_REQUIRED'));
  assert.equal(store.readRun(claim.run.id).status, 'RECONCILIATION_REQUIRED');
  assert.equal(journal.read(invocation.id).status, 'UNKNOWN');
  assert.equal((db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n, 1);
});

test('network timeout retains an unknown physical attempt without retry', async t => {
  const { store, journal, claim } = setup(t);
  let sent = 0;
  await assert.rejects(invokeModel(journal, { sendOnce: async () => { sent++; throw new Error('simulated timeout after send'); } }, claim.token, request, signal()), code('RECONCILIATION_REQUIRED'));
  assert.equal(sent, 1);
  assert.equal(store.readRun(claim.run.id).status, 'RECONCILIATION_REQUIRED');
});

test('late result is evidence after cancellation, never permission to consume or resume', async t => {
  const { store, journal, claim } = setup(t);
  await assert.rejects(invokeModel(journal, { sendOnce: async () => {
    store.control(claim.run.id, 'author', store.readRun(claim.run.id).version, 'cancel', 'cancel');
    return result;
  } }, claim.token, request, signal()), code('LEASE_LOST'));
  const events = store.events(claim.run.threadId, 'author');
  const invocationId = (events.find(e => e.type === 'model.prepared')!.data as any).invocationId;
  assert.deepEqual(journal.read(invocationId).result, result);
  assert.equal(store.readRun(claim.run.id).status, 'CANCELED');
  assert.equal(store.claim('next', 30000), null);
});

test('external request survives DB reopen, guards owner/hash and consumes the exact saved return', async t => {
  const { db, filename, journal, claim } = setup(t);
  const externalInput = { ...request, channel: 'external' as const };
  await assert.rejects(invokeModel(journal, neverSend, claim.token, externalInput, signal()), code('WAITING_EXTERNAL'));
  const id = (db.prepare('SELECT id FROM agent_external_requests').get() as any).id;
  db.close();
  const reopened = new Database(filename); t.after(() => reopened.close());
  const store = new AgentSqliteStore(reopened); store.ensureSchema();
  const next = new SqliteModelJournal(store); next.ensureSchema();
  const saved = next.externalRequest(id, 'author');
  assert.deepEqual(saved.request, externalInput);
  assert.throws(() => next.externalRequest(id, 'another'), code('RUN_NOT_FOUND'));
  assert.throws(() => next.submitExternal(id, 'author', 'incorrect', 'sentinel'), code('IDEMPOTENCY_CONFLICT'));
  next.submitExternal(id, 'author', saved.inputHash, 'sentinel', { name: 'mechanical protocol stub' });
  next.submitExternal(id, 'author', saved.inputHash, 'sentinel', { name: 'mechanical protocol stub' });
  assert.throws(() => next.submitExternal(id, 'author', saved.inputHash, 'different'), code('IDEMPOTENCY_CONFLICT'));
  const resumed = store.claim('resumed', 30000)!;
  const returned = await invokeModel(next, neverSend, resumed.token, externalInput, signal());
  assert.equal(returned.text, 'sentinel');
  assert.equal(returned.provenance.producerVerified, false);
  assert.equal(store.readRun(claim.run.id).invocationCount, 1);
});

test('external return while paused waits for explicit resume; canceled runs remain canceled', async t => {
  for (const action of ['pause', 'cancel'] as const) {
    const { db, store, journal, claim } = setup(t);
    await assert.rejects(invokeModel(journal, neverSend, claim.token, { ...request, channel: 'external' }, signal()), code('WAITING_EXTERNAL'));
    const id = (db.prepare('SELECT id FROM agent_external_requests').get() as any).id;
    const changed = store.control(claim.run.id, 'author', store.readRun(claim.run.id).version, action, action);
    const external = journal.externalRequest(id, 'author');
    journal.submitExternal(id, 'author', external.inputHash, 'sentinel');
    assert.equal(store.readRun(claim.run.id).status, action === 'pause' ? 'PAUSED' : 'CANCELED');
    assert.equal(store.claim('worker', 30000), null);
    if (action === 'pause') {
      store.control(claim.run.id, 'author', changed.version, 'resume', 'resume');
      const resumed = store.claim('worker', 30000)!;
      assert.equal((await invokeModel(journal, neverSend, resumed.token, { ...request, channel: 'external' }, signal())).text, 'sentinel');
    }
  }
});

test('budget limit persists a partial outcome and retains previous receipts', async t => {
  const { store, journal, claim } = setup(t, 1);
  await invokeModel(journal, { sendOnce: async () => result }, claim.token, request, signal());
  await assert.rejects(invokeModel(journal, neverSend, claim.token, { ...request, operationKey: 'second' }, signal()), code('BUDGET_EXHAUSTED'));
  const run = store.readRun(claim.run.id);
  assert.equal(run.status, 'PARTIAL');
  assert.equal(run.invocationCount, 1);
  assert.equal(run.reason, 'BUDGET_EXHAUSTED');
});

test('different steps cannot alias a model operation key, even with identical model input', t => {
  const { store, journal, claim } = setup(t);
  const first = preparedFixture(claim.run);
  const second = structuredClone(first); second.request.callId = 'second';
  const { preparedDigest: _, ...payload } = second; second.preparedDigest = hashValue(payload);
  const a = store.savePrepared(claim.token, first), b = store.savePrepared(claim.token, second);
  const ia = journal.prepare({ ...claim.token, stepId: a.id }, request);
  const ib = journal.prepare({ ...claim.token, stepId: b.id }, request);
  assert.notEqual(ia.id, ib.id);
  assert.throws(() => journal.startAttempt({ ...claim.token, stepId: b.id }, ia.id), code('INVOCATION_NOT_SENDABLE'));
  assert.throws(() => journal.prepare({ ...claim.token, stepId: 'not-a-step' }, request), code('MODEL_OWNER_MISMATCH'));
  assert.equal(store.readRun(claim.run.id).invocationCount, 2);
});

test('invalid provider metadata preserves returned text and diagnostics before rejecting consumption', async t => {
  const { db, journal, claim } = setup(t);
  await assert.rejects(invokeModel(journal, { sendOnce: async () => ({ ...result, usage: { inputTokens: NaN } }) }, claim.token, request, signal()), code('MODEL_RESULT_METADATA_INVALID'));
  const row = db.prepare('SELECT status,result_json FROM agent_invocations').get() as any;
  assert.equal(row.status, 'RECEIVED');
  assert.equal(JSON.parse(row.result_json).text, result.text);
  assert.match(JSON.parse(row.result_json).metadataSnapshot, /NaN/);
  await assert.rejects(invokeModel(journal, neverSend, claim.token, request, signal()), code('MODEL_RESULT_METADATA_INVALID'));
  assert.equal((db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n, 1);
});

test('unknown attempts require exact received evidence and explicit reconciliation before continuing', async t => {
  const { store, journal, claim } = setup(t);
  const invocation = journal.prepare(claim.token, request);
  const attempt = journal.startAttempt(claim.token, invocation.id);
  journal.markUnknown(claim.token, invocation.id, 'sent then disconnected');
  const waiting = store.readRun(claim.run.id);
  assert.throws(() => journal.reconcileReceived(waiting.id, 'author', waiting.version, 'reconcile'), code('EVIDENCE_MISSING'));
  journal.recordResult(invocation.id, attempt.attemptId, result);
  assert.equal(store.readRun(waiting.id).status, 'RECONCILIATION_REQUIRED');
  const queued = journal.reconcileReceived(waiting.id, 'author', waiting.version, 'reconcile');
  assert.equal(queued.status, 'QUEUED');
  assert.deepEqual(journal.reconcileReceived(waiting.id, 'author', waiting.version, 'reconcile'), queued);
  const resumed = store.claim('recovery', 30000)!;
  assert.deepEqual(await invokeModel(journal, neverSend, resumed.token, request, signal()), result);
  assert.equal(store.readRun(waiting.id).invocationCount, 1);
});

test('local model preflight failure is not a sent/unknown attempt and replay never revalidates credentials', async t => {
  const { db, journal, claim } = setup(t);
  let sent = 0;
  await assert.rejects(invokeModel(journal, { preflight: () => { throw new AgentError('PROVIDER_CONFIG_CHANGED', '模型配置需要更新', 409); }, sendOnce: async () => { sent++; return result; } }, claim.token, request, signal()), code('PROVIDER_CONFIG_CHANGED'));
  assert.equal(sent, 0);
  assert.equal((db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n, 0);
  assert.equal((db.prepare('SELECT status FROM agent_invocations').get() as any).status, 'PREPARED');
  await invokeModel(journal, { sendOnce: async () => result }, claim.token, request, signal());
  assert.deepEqual(await invokeModel(journal, { preflight: () => { throw new Error('saved result must not consult provider'); }, ...neverSend }, claim.token, request, signal()), result);
});

test('author cancellation during async local preflight prevents physical dispatch', async t => {
  const { db, journal, claim, store } = setup(t);
  let sent = 0;
  await assert.rejects(invokeModel(journal, { preflight: async () => { store.control(claim.run.id, 'author', store.readRun(claim.run.id).version, 'cancel', 'cancel-preflight'); }, sendOnce: async () => { sent++; return result; } }, claim.token, request, signal()), code('LEASE_LOST'));
  assert.equal(sent,0); assert.equal((db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n,0);
});
