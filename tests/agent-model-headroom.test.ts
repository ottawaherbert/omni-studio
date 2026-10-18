import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentChildWorker, invokeModel } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { observationFixture, preparedFixture } from './fixtures/agent-store-fixture';

const busy = (ms: number) => { const until = Date.now() + ms; while (Date.now() < until) { /* synchronous source validation */ } };

for (const channel of ['external', 'api'] as const) {
  test(`${channel} model path renews the child lease between independent source transactions`, async t => {
    const db = new Database(':memory:'); t.after(() => db.close());
    const store = new AgentSqliteStore(db); store.ensureSchema();
    const accepted = store.accept({ requestId: 'mechanical-model', ownerId: 'owner', scopeId: 'scope', kind: 'CHAT', input: { message: 'MECHANICAL' }, policyRevision: '1', maxInvocations: 1 });
    const parent = store.claim('parent', 30000, accepted.runId)!;
    const prepared = preparedFixture(parent.run);
    const step = store.savePrepared(parent.token, prepared); store.handoff(parent.token, step.id);
    let checks = 0, sends = 0;
    const journal = new SqliteModelJournal(store, () => { checks++; busy(checks === 1 ? 285 : 755); }); journal.ensureSchema();
    const request = { operationKey: 'mechanical:check', channel, routeRef: 'mechanical-only', prompt: 'MECHANICAL_NO_STORY' };
    const registry = {
      describe: () => [{ id: prepared.request.capabilityId, version: '1', dispatch: 'DURABLE', effect: 'READ' }],
      attest: async () => {},
      attestReceipt: async () => {},
      execute: async (_call: unknown, context: any) => {
        await invokeModel(journal, { sendOnce: async () => { sends++; return { text: 'MECHANICAL', provenance: { channel: 'provider' as const, producer: 'protocol-test' } }; } }, context.execution, request, context.signal);
        return observationFixture;
      },
    } as any;
    const worker = new AgentChildWorker(store, registry, { workerId: 'child', leaseMs: 1000 });
    await worker.runOnce(accepted.runId);
    const invocation = db.prepare('SELECT status FROM agent_invocations').get() as { status: string };
    assert.equal(checks >= 2, true);
    if (channel === 'external') {
      assert.equal(store.readRun(accepted.runId).status, 'WAITING_EXTERNAL');
      assert.equal(invocation.status, 'WAITING_EXTERNAL');
      assert.equal(sends, 0);
    } else {
      assert.equal(sends, 1);
      assert.equal(invocation.status, 'RECEIVED');
      assert.equal(store.getStep(accepted.runId, parent.run.generation, prepared.request.callId)?.status, 'COMMITTED');
      assert.equal(store.readRun(accepted.runId).status, 'QUEUED');
    }
  });
}
