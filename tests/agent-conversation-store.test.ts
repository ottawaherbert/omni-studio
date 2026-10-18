import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentError } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { SqliteConversationStore } from '../packages/agent-sqlite/src/conversationStore';

const code = (value: string) => (error: unknown) => error instanceof AgentError && error.code === value;
function host(db: InstanceType<typeof Database>) {
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const journal = new SqliteModelJournal(store); journal.ensureSchema();
  const conversations = new SqliteConversationStore(store); conversations.ensureSchema();
  return { store, journal, conversations };
}
function setup(t: any) { const db = new Database(':memory:'); t.after(() => db.close()); return { db, ...host(db) }; }
function command(threadId: string, expectedVersion = 1, requestId = 'message-1', ownerId = 'owner') {
  const requestEnvelope = { requestId, expectedVersion, text: 'protocol input', methodIds: ['method'] };
  return { threadId, ownerId, requestId, expectedVersion, requestEnvelope, payload: { text: requestEnvelope.text, methods: [{ id: 'method', version: '1', content: 'frozen method' }] }, capabilityId: 'script.converse', maxInvocations: 1 };
}

test('conversation acceptance replays the client envelope, preserves frozen Skill and rejects changed identity', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home');
  const first = h.conversations.accept(command(opened.id));
  const replayed = h.conversations.accept({ ...command(opened.id), payload: { methods: [] }, capabilityId: 'changed.host.default', maxInvocations: 9 });
  assert.equal(replayed.turnId, first.turnId);
  assert.deepEqual(replayed.conversation.turns[0].input, command(opened.id).payload);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_runs').get() as any).n, 1);
  assert.throws(() => h.conversations.received({ ...command(opened.id), requestEnvelope: { ...command(opened.id).requestEnvelope, text: 'different' } }), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => h.conversations.received({ ...command(opened.id), requestId: '' }), code('INVALID_CONVERSATION_COMMAND'));
  assert.throws(() => h.conversations.accept(command(opened.id, 2, 'foreign', 'someone-else')), code('CONVERSATION_NOT_FOUND'));
});

test('two database connections enforce turn CAS and reopening keeps command and history snapshots', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'conversation-cas-')), filename = path.join(dir, 'isolated.sqlite');
  const firstDb = new Database(filename), secondDb = new Database(filename);
  t.after(() => { if (firstDb.open) firstDb.close(); if (secondDb.open) secondDb.close(); rmSync(dir, { recursive: true, force: true }); });
  const first = host(firstDb), second = host(secondDb);
  const opened = first.conversations.open('owner', 'scope', 'home', [{ role: 'user', text: 'archived seed' }]);
  const accepted = first.conversations.accept(command(opened.id));
  assert.throws(() => second.conversations.accept(command(opened.id, 1, 'stale-tab')), code('CONVERSATION_VERSION_CONFLICT'));
  assert.equal((firstDb.prepare('SELECT count(*) n FROM agent_runs').get() as any).n, 1);
  const history = { messages: [{ role: 'user', text: 'frozen history' }], contextRefs: [] };
  const ref = first.conversations.captureHistory(opened.id, accepted.turnId, 'owner', history);
  assert.deepEqual(second.conversations.captureHistory(opened.id, accepted.turnId, 'owner', history), ref);
  assert.throws(() => second.conversations.captureHistory(opened.id, accepted.turnId, 'owner', { messages: [] }), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(second.conversations.sourceAllowed(ref, 'owner', 'scope', () => true), true);
  assert.equal(second.conversations.sourceAllowed(ref, 'other', 'scope', () => true), false);
  assert.equal(second.conversations.sourceAllowed(ref, 'owner', 'other-scope', () => true), false);
  assert.equal(second.conversations.sourceAllowed({ ...ref, uri: ref.uri.replace('resource:', 'https:') }, 'owner', 'scope', () => true), false);
  assert.equal(second.conversations.sourceAllowed({ ...ref, uri: 'invalid' }, 'owner', 'scope', () => true), false);
  assert.deepEqual(second.conversations.received(command(opened.id))?.turnId, accepted.turnId);
  assert.deepEqual(second.conversations.open('owner', 'scope', 'home', []).seed, opened.seed);
  firstDb.close(); secondDb.close();
  const reopenedDb = new Database(filename);
  try {
    const reopened = host(reopenedDb);
    assert.equal(reopened.conversations.received(command(opened.id))?.turnId, accepted.turnId);
    assert.deepEqual(reopened.conversations.captureHistory(opened.id, accepted.turnId, 'owner', history), ref);
    assert.equal(reopened.conversations.sourceAllowed(ref, 'owner', 'scope', () => true), true);
    assert.deepEqual(reopened.conversations.read(opened.id, 'owner').turns[0].input, command(opened.id).payload);
  } finally { reopenedDb.close(); }
});

test('response, conversation version and false-valued idempotency commit atomically', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home');
  const accepted = h.conversations.accept(command(opened.id));
  h.db.exec("CREATE TRIGGER reject_conversation_version BEFORE UPDATE ON agent_conversations BEGIN SELECT RAISE(ABORT,'injected version failure'); END;");
  assert.throws(() => h.conversations.writeResponse(opened.id, accepted.turnId, 'owner', { text: 'saved response' }), /injected version failure/);
  assert.equal(h.conversations.read(opened.id, 'owner').turns[0].response, null);
  assert.equal(h.conversations.read(opened.id, 'owner').version, 2);
  h.db.exec('DROP TRIGGER reject_conversation_version');
  h.conversations.writeResponse(opened.id, accepted.turnId, 'owner', false);
  h.conversations.writeResponse(opened.id, accepted.turnId, 'owner', false);
  assert.equal(h.conversations.read(opened.id, 'owner').version, 3);
  assert.equal(h.conversations.read(opened.id, 'owner').turns[0].response, false);
  assert.throws(() => h.conversations.writeResponse(opened.id, accepted.turnId, 'owner', { text: 'overwrite' }), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => h.conversations.writeResponse(opened.id, accepted.turnId, 'other', false), code('CONVERSATION_NOT_FOUND'));
});

test('UNKNOWN cannot be bypassed with a new request or conversation key, and received evidence still needs reconciliation', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home');
  const accepted = h.conversations.accept(command(opened.id));
  const runId = accepted.conversation.turns[0].runId, claim = h.store.claim('test', 30000, runId)!;
  const invocation = h.journal.prepare(claim.token, { operationKey: 'reply', channel: 'api', routeRef: 'fixture:protocol', prompt: 'mechanical protocol fixture' });
  const attempt = h.journal.startAttempt(claim.token, invocation.id);
  h.journal.markUnknown(claim.token, invocation.id, 'simulated uncertain response');
  assert.equal(h.conversations.received(command(opened.id))!.turnId, accepted.turnId);
  assert.throws(() => h.conversations.accept(command(opened.id, 2, 'retry-new-id')), code('CONVERSATION_RESULT_UNRESOLVED'));
  const reset = h.conversations.open('owner', 'scope', 'new-conversation');
  assert.throws(() => h.conversations.accept(command(reset.id, 1, 'retry-new-thread')), code('CONVERSATION_RESULT_UNRESOLVED'));
  h.journal.recordResult(invocation.id, attempt.attemptId, { text: 'mechanical saved evidence', provenance: { channel: 'provider' } });
  assert.throws(() => h.conversations.accept(command(opened.id, 2, 'retry-without-reconcile')), code('CONVERSATION_RESULT_UNRESOLVED'));
  const waiting = h.store.readRun(runId);
  h.journal.reconcileReceived(runId, 'owner', waiting.version, 'explicit-reconcile');
  assert.ok(h.conversations.accept(command(opened.id, 2, 'next-after-reconcile')));
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1);
});

test('canceling an uncertain turn preserves the UNKNOWN barrier while other owners and scopes stay independent', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home');
  const accepted = h.conversations.accept(command(opened.id)), runId = accepted.conversation.turns[0].runId;
  const claim = h.store.claim('test', 30000, runId)!;
  const invocation = h.journal.prepare(claim.token, { operationKey: 'reply', channel: 'api', routeRef: 'fixture:protocol', prompt: 'mechanical fixture' });
  h.journal.startAttempt(claim.token, invocation.id);
  const running = h.store.readRun(runId); h.store.control(runId, 'owner', running.version, 'cancel', 'cancel');
  assert.throws(() => h.conversations.accept(command(opened.id, 2, 'retry-after-cancel')), code('CONVERSATION_RESULT_UNRESOLVED'));
  const otherOwner = h.conversations.open('other', 'scope', 'home');
  assert.ok(h.conversations.accept(command(otherOwner.id, 1, 'other-message', 'other')));
  const otherScope = h.conversations.open('owner', 'other-scope', 'home');
  assert.ok(h.conversations.accept(command(otherScope.id, 1, 'different-scope')));
});

test('new client keys preserve old conversations and repeated opens never replace the original seed', t => {
  const h = setup(t), first = h.conversations.open('owner', 'scope', 'first', [{ text: 'old seed' }]);
  h.conversations.accept(command(first.id));
  const next = h.conversations.open('owner', 'scope', 'reset-key');
  assert.notEqual(first.id, next.id); assert.equal(next.turns.length, 0);
  assert.equal(h.conversations.read(first.id, 'owner').turns.length, 1);
  assert.equal(h.conversations.open('owner', 'scope', 'reset-key').id, next.id);
  assert.deepEqual(h.conversations.open('owner', 'scope', 'first', [{ text: 'new seed' }]).seed, first.seed);
  for (const key of ['', ' ', 'x'.repeat(201), 3]) assert.throws(() => h.conversations.open('owner', 'scope', key as string), code('INVALID_CONVERSATION'));
});

test('active Goal rejects new chat atomically, but receipt replay and other threads remain usable', t => {
  const h = setup(t), conversation = h.conversations.open('owner', 'scope', 'home');
  const accepted = h.conversations.accept(command(conversation.id));
  const goal = h.store.accept({ownerId:'owner',scopeId:'scope',threadId:conversation.id,requestId:'goal',kind:'GOAL',input:{},policyRevision:'test',maxInvocations:1});
  for(const status of ['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','RECONCILIATION_REQUIRED']) {
    h.db.prepare('UPDATE agent_runs SET status=? WHERE id=?').run(status,goal.runId);
    assert.throws(()=>h.conversations.accept(command(conversation.id,2,'blocked')),code('CONVERSATION_GOAL_ACTIVE'));
    assert.equal(h.conversations.accept(command(conversation.id)).turnId,accepted.turnId);
    assert.equal(h.conversations.read(conversation.id,'owner').version,2);
    assert.equal(h.conversations.read(conversation.id,'owner').turns.length,1);
  }
  const other = h.conversations.open('owner','scope','other');
  assert.ok(h.conversations.accept(command(other.id,1,'other')));
  const run=h.store.readRun(goal.runId);
  h.store.control(run.id,'owner',run.version,'pause','pause-goal');
  assert.ok(h.conversations.accept(command(conversation.id,2,'blocked')));
});

test('explicit restart retires UNKNOWN dialogue atomically, keeps evidence and permits only new dialogue work', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home', [{ text: 'old seed' }]);
  const accepted = h.conversations.accept(command(opened.id)), runId = accepted.conversation.turns[0].runId;
  const history = { messages: [{ role: 'user', text: 'old frozen history' }], contextRefs: [] };
  const ref = h.conversations.captureHistory(opened.id, accepted.turnId, 'owner', history);
  const claim = h.store.claim('test', 30000, runId)!;
  const invocation = h.journal.prepare(claim.token, { operationKey: 'reply', channel: 'api', routeRef: 'fixture:restart', prompt: 'mechanical fixture' });
  const attempt = h.journal.startAttempt(claim.token, invocation.id);
  h.journal.markUnknown(claim.token, invocation.id, 'simulated unknown result');
  const goal = h.store.accept({ ownerId: 'owner', scopeId: 'scope', threadId: opened.id, requestId: 'old-goal', kind: 'GOAL', input: {}, policyRevision: 'test', maxInvocations: 1 });
  const restart = { threadId: opened.id, ownerId: 'owner', requestId: 'explicit-restart', expectedVersion: 2, clientKey: 'fresh-dialogue' };
  const next = h.conversations.restart(restart).conversation;
  assert.notEqual(next.id, opened.id); assert.equal(next.version, 1);
  assert.deepEqual(next.seed, []); assert.deepEqual(next.turns, []); assert.equal(next.restartedTo, null);
  const old = h.conversations.read(opened.id, 'owner');
  assert.equal(old.restartedTo, next.id); assert.equal(old.version, 3);
  assert.deepEqual(old.seed, opened.seed); assert.equal(old.turns.length, 1); assert.equal(old.turns[0].response, null);
  assert.equal(h.store.readRun(runId).status, 'CANCELED'); assert.equal(h.store.readRun(goal.runId).status, 'CANCELED');
  assert.equal(h.journal.read(invocation.id).status, 'UNKNOWN');
  assert.equal(h.conversations.sourceAllowed(ref, 'owner', 'scope', () => true), true);
  assert.equal(h.conversations.accept(command(opened.id)).turnId, accepted.turnId, 'original accepted message remains an audit receipt');
  assert.throws(() => h.conversations.accept(command(opened.id, old.version, 'late-old-message')), code('CONVERSATION_RESTARTED'));
  assert.throws(() => h.conversations.writeResponse(opened.id, accepted.turnId, 'owner', { text: 'late reply' }), code('CONVERSATION_RESTARTED'));
  const newTurn = h.conversations.accept(command(next.id, next.version, 'fresh-message'));
  assert.equal(newTurn.conversation.turns.length, 1);
  assert.equal(h.conversations.restart(restart).conversation.id, next.id);
  assert.equal(h.conversations.restart(restart).conversation.turns[0].id, newTurn.turnId);
  assert.throws(() => h.conversations.restart({ ...restart, clientKey: 'changed-body' }), code('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => h.conversations.restart({ ...restart, requestId: 'second-restart' }), code('CONVERSATION_RESTARTED'));
  h.journal.recordResult(invocation.id, attempt.attemptId, { text: 'late mechanical evidence', provenance: { channel: 'provider' } });
  assert.equal(h.journal.read(invocation.id).result!.text, 'late mechanical evidence');
  assert.equal(h.store.readRun(runId).status, 'CANCELED');
  assert.equal(h.store.claim('old-worker', 30000, runId), null);
  assert.equal(h.store.claimChild('old-child-worker', 30000, runId), null);
  assert.throws(() => h.journal.reconcileReceived(runId, 'owner', h.store.readRun(runId).version, 'late-reconcile'), code('INVALID_RECONCILIATION'));
  assert.equal(h.conversations.read(next.id, 'owner').turns.length, 1);
  assert.equal(h.conversations.read(opened.id, 'owner').turns[0].response, null);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n, 1);
});

test('restart fences a SENT token before its late result can commit and preserves an already saved reply', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home');
  const accepted = h.conversations.accept(command(opened.id)), runId = accepted.conversation.turns[0].runId;
  const claim = h.store.claim('running-worker', 30000, runId)!;
  const prepared = {
    request: { capabilityId: 'script.converse', capabilityVersion: '1', callId: accepted.turnId, input: {} },
    implementationDigest: 'mechanical', contractDigest: 'mechanical', inputDigest: 'mechanical',
    binding: { ownerId: 'owner', scopeId: 'scope', commandRevision: String(claim.run.generation), policyRevision: claim.run.policyRevision },
    sources: [], targets: [], preparedDigest: 'mechanical',
  };
  h.store.savePrepared(claim.token, prepared);
  const invocation = h.journal.prepare(claim.token, { operationKey: 'reply', channel: 'api', routeRef: 'fixture:restart-sent', prompt: 'mechanical fixture' });
  const attempt = h.journal.startAttempt(claim.token, invocation.id);
  const before = h.store.readRun(runId);
  const next = h.conversations.restart({ threadId: opened.id, ownerId: 'owner', requestId: 'restart-sent', expectedVersion: 2, clientKey: 'fresh' }).conversation;
  const canceled = h.store.readRun(runId);
  assert.ok(canceled.fence > before.fence); assert.ok(canceled.controlGeneration > before.controlGeneration);
  assert.equal(canceled.leaseOwner, null); assert.equal(canceled.leaseUntil, null);
  assert.equal(h.journal.read(invocation.id).status, 'SENT');
  h.journal.recordResult(invocation.id, attempt.attemptId, { text: 'late evidence', provenance: { channel: 'provider' } });
  let applied = 0;
  assert.throws(() => h.store.commitStep(claim.token, accepted.turnId, { status: 'SUCCEEDED', summary: 'mechanical', data: {}, evidence: [], artifacts: [], effectState: 'EFFECT_VERIFIED', retry: 'NEVER' }, () => { applied++; h.conversations.writeResponse(opened.id, accepted.turnId, 'owner', { text: 'late evidence' }); }), code('LEASE_LOST'));
  assert.equal(applied, 0); assert.equal(h.conversations.read(opened.id, 'owner').turns[0].response, null);
  assert.deepEqual(h.conversations.read(next.id, 'owner').turns, []);

  const completed = h.conversations.open('owner', 'scope', 'completed');
  const savedTurn = h.conversations.accept(command(completed.id, 1, 'completed-message'));
  h.conversations.writeResponse(completed.id, savedTurn.turnId, 'owner', { text: 'already saved' });
  h.conversations.restart({ threadId: completed.id, ownerId: 'owner', requestId: 'restart-completed', expectedVersion: 3, clientKey: 'completed-fresh' });
  h.conversations.writeResponse(completed.id, savedTurn.turnId, 'owner', { text: 'already saved' });
  assert.equal(h.conversations.read(completed.id, 'owner').turns[0].response.text, 'already saved');
});

test('restart validates author/version/key and rolls back cancellation and retirement if a lifecycle fails', t => {
  const h = setup(t), opened = h.conversations.open('owner', 'scope', 'home');
  const accepted = h.conversations.accept(command(opened.id)), runId = accepted.conversation.turns[0].runId;
  const restart = { threadId: opened.id, ownerId: 'owner', requestId: 'restart', expectedVersion: 2, clientKey: 'fresh' };
  assert.throws(() => h.conversations.restart({ ...restart, ownerId: 'other' }), code('CONVERSATION_NOT_FOUND'));
  assert.throws(() => h.conversations.restart({ ...restart, expectedVersion: 1 }), code('CONVERSATION_VERSION_CONFLICT'));
  assert.throws(() => h.conversations.restart({ ...restart, clientKey: 'home' }), code('CONVERSATION_RESTART_KEY_CONFLICT'));
  for (const changed of [{ requestId: '' }, { requestId: 10 }, { expectedVersion: 0 }, { expectedVersion: 1.5 }, { clientKey: '' }, { clientKey: 'a'.repeat(201) }])
    assert.throws(() => h.conversations.restart({ ...restart, ...changed } as any), code('INVALID_CONVERSATION_RESTART'));
  assert.equal(h.store.readRun(runId).status, 'QUEUED');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversations').get() as any).n, 1);
  h.store.addLifecycleParticipant({ transition: (_old, next) => { if (next.status === 'CANCELED') throw new Error('injected cancellation failure'); } });
  assert.throws(() => h.conversations.restart(restart), /injected cancellation failure/);
  assert.equal(h.conversations.read(opened.id, 'owner').version, 2);
  assert.equal(h.conversations.read(opened.id, 'owner').restartedTo, null);
  assert.equal(h.store.readRun(runId).status, 'QUEUED');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversations').get() as any).n, 1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_conversation_restarts').get() as any).n, 0);
  assert.equal(h.store.events(opened.id, 'owner').some(event => event.type === 'run.cancel'), false);
});

test('restart receipt survives reopening while budget recovery cannot revive a retired terminal run', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'conversation-restart-')), filename = path.join(dir, 'isolated.sqlite');
  const db = new Database(filename); t.after(() => { if (db.open) db.close(); rmSync(dir, { recursive: true, force: true }); });
  const first = host(db), old = first.conversations.open('owner', 'scope', 'home');
  const accepted = first.conversations.accept(command(old.id)), runId = accepted.conversation.turns[0].runId;
  const claim = first.store.claim('test', 30000, runId)!;
  first.store.finish(claim.token, 'PARTIAL', { remainingWork: ['mechanical budget stop'] }, 'BUDGET_EXHAUSTED');
  const terminal = first.store.readRun(runId);
  const restart = { threadId: old.id, ownerId: 'owner', requestId: 'persisted-restart', expectedVersion: 2, clientKey: 'fresh' };
  const next = first.conversations.restart(restart).conversation; db.close();
  const reopenedDb = new Database(filename);
  try {
    const reopened = host(reopenedDb);
    assert.equal(reopened.conversations.restart(restart).conversation.id, next.id);
    assert.equal(reopened.conversations.read(old.id, 'owner').restartedTo, next.id);
    assert.throws(() => reopened.store.recoverBudgetStopped(runId, 'owner', terminal.version, null), code('CONVERSATION_RESTARTED'));
    assert.equal(reopened.store.readRun(runId).status, 'PARTIAL');
    assert.equal(reopened.store.readRun(runId).version, terminal.version);
    assert.equal(reopened.store.claim('restarted-worker', 30000, runId), null);
    assert.equal(reopened.conversations.accept(command(next.id, 1, 'new-after-reopen')).conversation.turns.length, 1);
  } finally { reopenedDb.close(); }
});

test('restart exempts only its explicitly retired thread and keeps another UNKNOWN dialogue barrier', t => {
  const h = setup(t), old = h.conversations.open('owner', 'scope', 'old'), other = h.conversations.open('owner', 'scope', 'other');
  const accepted = [h.conversations.accept(command(old.id, 1, 'old-message')), h.conversations.accept(command(other.id, 1, 'other-message'))];
  for (const turn of accepted) {
    const claim = h.store.claim('test', 30000, turn.conversation.turns[0].runId)!;
    const invocation = h.journal.prepare(claim.token, { operationKey: 'reply', channel: 'api', routeRef: 'fixture:unknown', prompt: 'mechanical fixture' });
    h.journal.startAttempt(claim.token, invocation.id); h.journal.markUnknown(claim.token, invocation.id, 'unknown evidence');
  }
  const next = h.conversations.restart({ threadId: old.id, ownerId: 'owner', requestId: 'restart-only-old', expectedVersion: 2, clientKey: 'fresh' }).conversation;
  assert.throws(() => h.conversations.accept(command(next.id, 1, 'still-blocked')), code('CONVERSATION_RESULT_UNRESOLVED'));
  assert.equal(h.conversations.read(other.id, 'owner').restartedTo, null);
  assert.equal(h.store.readRun(accepted[1].conversation.turns[0].runId).status, 'RECONCILIATION_REQUIRED');
  assert.deepEqual(h.conversations.read(next.id, 'owner').turns, []);
});

test('restart cancels a running child lease and late evidence cannot commit its reply', t => {
  const h = setup(t), old = h.conversations.open('owner', 'scope', 'old');
  const accepted = h.conversations.accept(command(old.id)), runId = accepted.conversation.turns[0].runId;
  const parent = h.store.claim('parent', 30000, runId)!;
  const step = h.store.savePrepared(parent.token, {
    request: { capabilityId: 'mechanical.child', capabilityVersion: '1', callId: accepted.turnId, input: {} },
    implementationDigest: 'mechanical', contractDigest: 'mechanical', inputDigest: 'mechanical', preparedDigest: 'mechanical',
    binding: { ownerId: 'owner', scopeId: 'scope', commandRevision: '1', policyRevision: parent.run.policyRevision }, sources: [], targets: [],
  });
  h.store.handoff(parent.token, step.id);
  const child = h.store.claimChild('child', 30000, runId)!;
  const invocation = h.journal.prepare(child.token, { operationKey: 'reply', channel: 'api', routeRef: 'fixture:child', prompt: 'mechanical fixture' });
  const attempt = h.journal.startAttempt(child.token, invocation.id);
  const next = h.conversations.restart({ threadId: old.id, ownerId: 'owner', requestId: 'restart-child', expectedVersion: 2, clientKey: 'fresh' }).conversation;
  const lease = h.db.prepare('SELECT status,fence,lease_owner,lease_until FROM agent_step_leases WHERE step_id=?').get(step.id) as any;
  assert.equal(lease.status, 'CANCELED'); assert.ok(lease.fence > child.token.fence);
  assert.equal(lease.lease_owner, null); assert.equal(lease.lease_until, null);
  h.journal.recordResult(invocation.id, attempt.attemptId, { text: 'late child evidence', provenance: { channel: 'provider' } });
  let applied = 0;
  assert.throws(() => h.store.commitStep(child.token, accepted.turnId, { status: 'SUCCEEDED', summary: 'mechanical', data: {}, evidence: [], artifacts: [], effectState: 'EFFECT_VERIFIED', retry: 'NEVER' }, () => { applied++; }), code('LEASE_LOST'));
  assert.equal(applied, 0); assert.equal(h.store.claimChild('late-child', 30000, runId), null);
  assert.equal(h.journal.read(invocation.id).result!.text, 'late child evidence');
  assert.equal(h.conversations.read(old.id, 'owner').turns[0].response, null);
  assert.deepEqual(h.conversations.read(next.id, 'owner').turns, []);
});
