import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { durableFixture, durableCommand } from './fixtures/agent-durable-fixture';
import { AgentWorker, ExecutionSuspended, hashValue, invokeModel, type ModelRequest } from '../packages/agent-core/src';
import { DecisionDriver, decisionOutputSchema, type GoalTool } from '../packages/agent-core/src/decisionDriver';
import { compileContext, memorySection } from '../packages/agent-context/src';
import { SqliteBudgetStore, SqliteContextStore, SqliteGoalStore, SqliteModelJournal } from '../packages/agent-sqlite/src';

// Independent fault regression. No creative generation or network transport.
test('a denied durable child does not starve another eligible thread or gain a lease', async () => {
  const db = new Database(':memory:');
  try {
    const h = durableFixture(db);
    const first = h.store.accept(durableCommand('review-first'));
    const second = h.store.accept(durableCommand('review-second'));
    await h.worker.runOnce(first.runId);
    await h.worker.runOnce(second.runId);
    assert.notEqual(first.threadId, second.threadId);
    const before = db.prepare('SELECT * FROM agent_step_leases WHERE run_id=?').get(first.runId);
    h.store.addLifecycleParticipant({ canClaim(run) { return run.id !== first.runId; }, transition() {} });
    assert.equal(h.store.claimChild('scheduler', 30000)?.run.id, second.runId);
    assert.deepEqual(db.prepare('SELECT * FROM agent_step_leases WHERE run_id=?').get(first.runId), before);
    assert.equal(h.store.claimChild('scheduler', 30000, first.runId), null);
  } finally { db.close(); }
});

function decisionContextFixture(t: any, guarded = true, decisionKind: 'CALL' | 'ASK' = 'CALL') {
  const db = new Database(':memory:'); t.after(() => db.close());
  const h = durableFixture(db), access = { ownerId: 'owner', scopeId: 'document', branch: 'author' };
  const source = { uri: 'resource://documents/document', version: '1', contentHash: hashValue('mechanical-original'), branch: 'author' };
  const contexts = new SqliteContextStore(h.store, dependency => dependency.freshness === 'EXACT' ||
    String((db.prepare('SELECT revision FROM test_child_documents').get() as any).revision) === dependency.ref.version);
  contexts.ensureSchema();
  const memory = contexts.createMemory(access, 'model', 'remember', { key: 'derived.test', kind: 'DOMAIN_DERIVED',
    content: { label: 'Mechanical source', value: 'mechanical input, no creative generation' }, dependencies: [{ ref: source, freshness: 'CURRENT' }] });
  const journal = new SqliteModelJournal(h.store, (request, _run, phase) => {
    assert.ok(request.contextRef);
    const bundle = phase === 'VIEW' ? contexts.assertVisible(request.contextRef, access) : contexts.assertAllowed(request.contextRef, access);
    assert.equal(request.prompt, bundle.prompt);
    assert.equal(hashValue(request.outputSchema), hashValue(bundle.outputSchema));
  }); journal.ensureSchema();
  const goals = new SqliteGoalStore(h.store, new SqliteBudgetStore(h.store), undefined,
    guarded ? (request, run, phase) => journal.assertRunInput(request, run, phase) : undefined); goals.ensureSchema();
  const tool: GoalTool = { id: 'document.append', version: '1', description: 'Mechanical fixture write', inputSchema: {
    type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } },
  } };
  let sends = 0, frozen: ModelRequest['contextRef'];
  const driver = new DecisionDriver(goals, journal, { async sendOnce() { sends++; return {
    text: JSON.stringify({ kind: decisionKind, capabilityId: decisionKind === 'CALL' ? tool.id : null,
      capabilityVersion: decisionKind === 'CALL' ? tool.version : null, arguments: decisionKind === 'CALL' ? { text: 'mechanical-effect' } : null,
      planUpdate: null, message: decisionKind === 'ASK' ? 'mechanical private source question' : null,
      choices: decisionKind === 'ASK' ? [] : null, artifactRefs: null, summary: null, reason: null, remainingWork: null }),
    provenance: { channel: 'provider', producer: 'mechanical protocol test' },
  }; } }, {
    async buildDecisionInput() {
      const bundle = compileContext({ systemInstruction: 'Mechanical protocol', sections: [memorySection(contexts.getMemory(memory.id, access))],
        skills: [], outputSchema: decisionOutputSchema([tool]) });
      frozen = contexts.capture(access, bundle);
      return { prompt: bundle.prompt, systemInstruction: bundle.systemInstruction, contextRef: frozen, allowedTools: [tool] };
    },
    async authorizeCall() {},
    async projectProgress() { return { fingerprint: 'state:1', remainingWork: ['mechanical work'] }; },
    async assessCompletion() { return { complete: false, gaps: ['mechanical pending'], verifiedArtifactRefs: [], evidence: [] }; },
  });
  const accepted = goals.accept({ ownerId: 'owner', scopeId: 'document', requestId: 'review', requestEnvelope: { test: 'review' },
    policyRevision: 'p1', objective: 'mechanical protocol', contract: { pluginId: 'test', version: '1', value: {}, digest: hashValue({}) },
    authorizationRef: 'grant', workspaceRef: source, sourceRefs: [], skillManifest: [], route: { channel: 'api', routeRef: 'mock:fixed' },
    stopPolicy: 'CONTRACT_COMPLETE', turnLimits: { maxDecisions: 2, maxToolCalls: 2 },
    budgetLimits: { maxInvocations: 3, maxToolCalls: 3, maxTurns: 3, maxRepairRounds: 1 } });
  const parent = new AgentWorker(h.store, h.registry, { workerId: 'parent', handlers: { GOAL: c => driver.handle(c) } });
  return { ...h, db, access, contexts, goals, journal, accepted, parent,
    forget: () => contexts.updateMemory(access, 'forget', memory.id, 1, 'DELETE'),
    effects: () => (db.prepare('SELECT count(*) n FROM test_child_effects').get() as any).n,
    get frozen() { return frozen!; }, get sends() { return sends; } };
}

test('decision memory forgotten after durable handoff prevents child effect using real frozen context', async t => {
  const h = decisionContextFixture(t);
  await h.parent.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status, 'WAITING_STEP');
  h.forget(); await h.childWorker.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(h.effects(), 0); assert.equal(h.sends, 1);
});

test('decision memory forgotten immediately before commit prevents effect and receipt atomically', async t => {
  const h = decisionContextFixture(t);
  await h.parent.runOnce(h.accepted.runId);
  const commit = h.store.commitStep.bind(h.store);
  h.store.commitStep = (...args) => { h.forget(); return commit(...args); };
  await h.childWorker.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(h.effects(), 0);
  assert.equal((h.db.prepare("SELECT count(*) n FROM agent_steps WHERE status='COMMITTED'").get() as any).n, 0);
});

for (const revoke of [false, true]) test(`committed child uses VIEW after its own CURRENT change; withdrawal=${revoke}`, async t => {
  const h = decisionContextFixture(t);
  await h.parent.runOnce(h.accepted.runId);
  const child = h.store.claimChild('manual-child', 30000, h.accepted.runId)!;
  await h.registry.execute(child.step.prepared, { ...h.access, commandRevision: String(child.run.generation), policyRevision: child.run.policyRevision,
    execution: child.token, signal: new AbortController().signal });
  assert.equal(h.effects(), 1);
  assert.throws(() => h.contexts.assertAllowed(h.frozen, h.access));
  if (revoke) h.forget();
  h.db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(child.step.id);
  await h.childWorker.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status, revoke ? 'NEEDS_REBASE' : 'QUEUED');
  assert.equal(h.effects(), 1); assert.equal(h.sends, 1);
  if (!revoke) {
    const parent = h.store.claim('resume-parent', 30000, h.accepted.runId)!;
    const sampling = JSON.parse((h.db.prepare('SELECT data_json FROM agent_samplings').get() as any).data_json);
    h.goals.consumeReceipt(parent.token, sampling.acceptedDecision.id);
    assert.equal(h.goals.openTurn(parent.token).nextDecisionIndex, 1);
  }
});

test('context-bound Goal cannot create a Step when persistent decision guard is missing', async t => {
  const h = decisionContextFixture(t, false);
  await h.parent.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(h.store.readRun(h.accepted.runId).reason, 'CONTEXT_GUARD_MISSING');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_steps').get() as any).n, 0);
  assert.equal(h.effects(), 0);
});

test('accepted ASK cannot publish a withdrawn source after lease recovery', async t => {
  const h = decisionContextFixture(t, true, 'ASK');
  const accept = h.goals.acceptDecision.bind(h.goals);
  h.goals.acceptDecision = (...args) => {
    const result = accept(...args); h.forget();
    throw new ExecutionSuspended('WAITING_STEP', `mechanical crash after accepting ${result.id}`);
  };
  await h.parent.runOnce(h.accepted.runId);
  h.goals.acceptDecision = accept;
  h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(h.accepted.runId);
  await h.parent.runOnce(h.accepted.runId);
  const run = h.store.readRun(h.accepted.runId);
  assert.equal(run.status, 'NEEDS_REBASE'); assert.equal(run.reason, 'CONTEXT_REVOKED');
  assert.equal(run.result, null); assert.equal(h.sends, 1);
});

test('child model dispatch inherits parent decision sources even with an independent valid child context', async t => {
  const h = decisionContextFixture(t);
  await h.parent.runOnce(h.accepted.runId);
  const child = h.store.claimChild('manual-child', 30000, h.accepted.runId)!;
  const bundle = compileContext({ systemInstruction: 'Mechanical child request', sections: [], skills: [], outputSchema: {} });
  const ref = h.contexts.capture(h.access, bundle);
  let sends = 0;
  await assert.rejects(invokeModel(h.journal, {
    preflight() { h.db.prepare('UPDATE test_child_documents SET revision=2').run(); },
    async sendOnce() { sends++; throw new Error('must not dispatch'); },
  }, child.token, { operationKey: 'independent-child-request', channel: 'api', routeRef: 'mock:fixed', prompt: bundle.prompt,
    systemInstruction: bundle.systemInstruction, outputSchema: {}, contextRef: ref }, new AbortController().signal));
  assert.doesNotThrow(() => h.contexts.assertAllowed(ref, h.access), 'child snapshot alone remains valid');
  assert.equal(sends, 0);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1, 'only original decision attempt exists');
});
