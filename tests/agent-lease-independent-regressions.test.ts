import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentWorker, AgentChildWorker, ExecutionInvalidated } from '../packages/agent-core/src';
import { AgentSqliteStore } from '../packages/agent-sqlite/src';
import { preparedFixture, observationFixture } from './fixtures/agent-store-fixture';

const busy = (ms: number) => { const until = Date.now() + ms; while (Date.now() < until) { /* mechanical validator */ } };
const request = { capabilityId: 'checklist.save', capabilityVersion: '1', input: { text: 'transaction fixture' }, callId: 'call-1' };
function setup(t: any, kind: 'CAPABILITY' | 'CHAT' = 'CHAT') {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const accepted = store.accept({ requestId: 'mechanical', ownerId: 'owner', scopeId: 'scope', kind,
    input: { request }, policyRevision: 'p1', maxInvocations: 2 });
  return { db, store, accepted };
}

test('parent INLINE does not commit a result if its source is revoked at the post execute checkpoint', async t => {
  const { store, accepted } = setup(t, 'CAPABILITY');
  const prepared = preparedFixture(store.readRun(accepted.runId)); let revoked = false;
  const attest = async () => { if (revoked) throw new ExecutionInvalidated('SOURCE_REVOKED', 'mechanical source revoked'); };
  const registry = { prepare: async () => prepared, attest, attestReceipt: attest,
    execute: async () => { setTimeout(() => { revoked = true; }, 0); return observationFixture; },
    describe: () => [{ id: request.capabilityId, version: '1', dispatch: 'INLINE', effect: 'READ' }] } as any;
  await new AgentWorker(store, registry, { workerId: 'parent' }).runOnce(accepted.runId);
  assert.equal(revoked, true);
  assert.equal(store.readRun(accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(store.getStep(accepted.runId, 1, request.callId)?.status, 'PREPARED');
});

test('DURABLE child does not commit a result if its source is revoked at the post execute checkpoint', async t => {
  const { store, accepted } = setup(t);
  const parent = store.claim('parent', 30000, accepted.runId)!;
  const step = store.savePrepared(parent.token, preparedFixture(parent.run)); store.handoff(parent.token, step.id);
  let revoked = false;
  const attest = async () => { if (revoked) throw new ExecutionInvalidated('SOURCE_REVOKED', 'mechanical source revoked'); };
  const registry = { attest, attestReceipt: attest,
    execute: async () => { setTimeout(() => { revoked = true; }, 0); return observationFixture; },
    describe: () => [{ id: request.capabilityId, version: '1', dispatch: 'DURABLE', effect: 'READ' }] } as any;
  await new AgentChildWorker(store, registry, { workerId: 'child' }).runOnce(accepted.runId);
  assert.equal(revoked, true);
  assert.equal(store.readRun(accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(store.getStep(accepted.runId, 1, request.callId)?.status, 'PREPARED');
});

test('COMMITTED child with 35ms lease acknowledges two independent 20ms guards without replaying effect', async t => {
  const { db, store, accepted } = setup(t);
  const parent = store.claim('parent', 30000, accepted.runId)!;
  const step = store.savePrepared(parent.token, preparedFixture(parent.run)); store.handoff(parent.token, step.id);
  const first = store.claimChild('first', 30000, accepted.runId)!;
  store.commitStep(first.token, request.callId, observationFixture, () => {});
  db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(step.id);
  let attestCount = 0;
  store.setBudgetAccounting({ bound: () => false, timeAvailable: () => true, activity: () => {}, stopActivity: () => {},
    guardDecision: () => busy(20), reserve: () => true, attempt: () => {}, usage: () => {} });
  const registry = { describe: () => [{ id: request.capabilityId, version: '1', dispatch: 'DURABLE', effect: 'READ' }],
    attestReceipt: async () => { attestCount++; busy(20); }, validateObservation: () => observationFixture,
    execute: async () => { throw new Error('COMMITTED effect must never execute again'); } } as any;
  await new AgentChildWorker(store, registry, { workerId: 'replay', leaseMs: 35 }).runOnce(accepted.runId);
  assert.equal(attestCount, 2);
  assert.equal(store.getStep(accepted.runId, 1, request.callId)?.status, 'COMMITTED');
  assert.equal((db.prepare('SELECT status FROM agent_step_leases WHERE step_id=?').get(step.id) as any).status, 'COMPLETED');
  assert.equal(store.readRun(accepted.runId).status, 'QUEUED');
});

test('a short periodic renewal cannot shorten a same fence 2x lease checkpoint', t => {
  const { store, accepted } = setup(t);
  const claimed = store.claim('worker', 35, accepted.runId)!;
  const long = store.renew(claimed.token, 70)!;
  busy(10);
  const short = store.renew(claimed.token, 35)!;
  assert.ok(short >= long, `short renewal ${short} shortened extended deadline ${long}`);
  assert.equal(store.readRun(accepted.runId).leaseUntil, short);
});

test('a short child renewal cannot shorten a same fence 2x lease checkpoint', t => {
  const { db, store, accepted } = setup(t);
  const parent = store.claim('parent', 30000, accepted.runId)!;
  const step = store.savePrepared(parent.token, preparedFixture(parent.run)); store.handoff(parent.token, step.id);
  const child = store.claimChild('child', 35, accepted.runId)!;
  const long = store.renew(child.token, 70)!;
  busy(10);
  const short = store.renew(child.token, 35)!;
  assert.ok(short >= long, `short child renewal ${short} shortened extended deadline ${long}`);
  assert.equal((db.prepare('SELECT lease_until FROM agent_step_leases WHERE step_id=?').get(step.id) as any).lease_until, short);
});
