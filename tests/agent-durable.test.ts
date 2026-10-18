import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { AgentError, type AccessContext } from '../packages/agent-core/src';
import { durableFixture, durableCommand } from './fixtures/agent-durable-fixture';

const code = (value: string) => (error: unknown) => error instanceof AgentError && error.code === value;
const raw = readFileSync(new URL('./fixtures/agent-sol-rewrite-result.json', import.meta.url), 'utf8').trim();
const replay = { text: raw, provenance: { channel: 'provider' as const, producer: 'Attributed GPT-6 Sol fixture replay', model: 'gpt-6-sol' } };
function setup(t: any, options: Parameters<typeof durableFixture>[1] = {}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = durableFixture(db, options), accepted = host.store.accept(durableCommand());
  const context = (claim: NonNullable<ReturnType<typeof host.store.claimChild>>): AccessContext => ({ ownerId: 'owner', scopeId: 'document', commandRevision: String(claim.run.generation), policyRevision: claim.run.policyRevision, execution: claim.token, signal: new AbortController().signal });
  const effects = () => (db.prepare('SELECT count(*) AS n FROM test_child_effects').get() as any).n;
  return { db, ...host, accepted, context, effects };
}

test('durable handoff revokes parent lease; competing child claim, expiry and completion use only child fence', async t => {
  const h = setup(t);
  await h.worker.runOnce(h.accepted.runId);
  const waiting = h.store.readRun(h.accepted.runId);
  assert.equal(waiting.status, 'WAITING_STEP'); assert.equal(waiting.leaseOwner, null);
  assert.equal(h.store.claim('cannot-reclaim-parent', 30000, waiting.id), null);
  const first = h.store.claimChild('first', 30000, waiting.id)!;
  assert.ok(first); assert.equal(h.store.claimChild('second', 30000, waiting.id), null);
  assert.equal(h.store.assertExecution(first.token).leaseUntil, null);
  assert.throws(() => h.store.assertExecution({ ...first.token, leaseKind: undefined }), code('LEASE_LOST'));
  h.db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(first.step.id);
  const second = h.store.claimChild('second', 30000, waiting.id)!;
  assert.ok(second.token.fence > first.token.fence);
  assert.equal(h.store.renew(first.token, 30000), null);
  assert.throws(() => h.store.completeChild(first.token), code('LEASE_LOST'));
  await assert.rejects(h.registry.execute(first.step.prepared, h.context(first)), code('LEASE_LOST'));
  await h.registry.execute(second.step.prepared, h.context(second));
  assert.equal(h.store.readRun(waiting.id).status, 'WAITING_STEP');
  assert.equal(h.effects(), 1);
  h.store.completeChild(second.token);
  assert.equal(h.store.readRun(waiting.id).status, 'QUEUED');
  await h.worker.runOnce(waiting.id);
  assert.equal(h.store.readRun(waiting.id).status, 'SUCCEEDED');
  assert.equal(h.effects(), 1);
});

test('a child returning from external wait reclaims a released thread after a bypassed chat finishes', async t => {
  const h=setup(t);
  h.store.addThreadReleaseOnWait((run,status)=>run.id===h.accepted.runId&&status==='WAITING_EXTERNAL');
  h.store.addSchedulingBypass((candidate,earlier)=>candidate.kind==='CHAT'&&earlier.id===h.accepted.runId&&earlier.status==='WAITING_EXTERNAL');
  await h.worker.runOnce(h.accepted.runId);
  const first=h.store.claimChild('first-child',30000,h.accepted.runId)!;
  h.store.wait(first.token,'WAITING_EXTERNAL','mechanical external child');
  assert.equal((h.db.prepare('SELECT active_run_id FROM agent_threads WHERE id=?').get(first.run.threadId) as any).active_run_id,null);
  const chat=h.store.accept({ownerId:'owner',threadId:first.run.threadId,scopeId:'document',kind:'CHAT',requestId:'bypassed-chat',
    policyRevision:'test-policy-v1',maxInvocations:1,input:{text:'mechanical chat'}});
  const chatLease=h.store.claim('chat-worker',30000,chat.runId)!;
  h.store.wakeModelOwner(first.run.id,first.run.generation,first.step.id);
  assert.equal(h.store.claimChild('blocked-child',30000,first.run.id),null);
  h.store.finish(chatLease.token,'SUCCEEDED',{summary:'mechanical chat complete'});
  const resumed=h.store.claimChild('resumed-child',30000,first.run.id);
  assert.ok(resumed);
  assert.equal(resumed.step.id,first.step.id);
  assert.equal((h.db.prepare('SELECT active_run_id FROM agent_threads WHERE id=?').get(first.run.threadId) as any).active_run_id,first.run.id);
});

test('a changed implementation leaves a frozen child pending rebase with its evidence intact', async t => {
  const h=setup(t);
  await h.worker.runOnce(h.accepted.runId);
  const frozen=h.store.getStep(h.accepted.runId,1,'append')!;
  const restarted=durableFixture(h.db,{channel:'external',workerId:'changed-implementation'});
  await restarted.childWorker.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status,'NEEDS_REBASE');
  assert.equal(h.store.getStep(h.accepted.runId,1,'append')?.id,frozen.id);
  assert.equal(h.store.getStep(h.accepted.runId,1,'append')?.status,'PREPARED');
  assert.equal(h.effects(),0);
});

test('pause after receipt but before acknowledgement preserves effect and blocks old ack; resume consumes receipt without writing twice', async t => {
  const h = setup(t);
  await h.worker.runOnce(h.accepted.runId);
  const child = h.store.claimChild('first', 30000)!;
  await h.registry.execute(child.step.prepared, h.context(child));
  const run = h.store.readRun(child.run.id);
  const paused = h.store.control(run.id, 'owner', run.version, 'pause', 'pause');
  assert.throws(() => h.store.completeChild(child.token), code('LEASE_LOST'));
  assert.equal(h.effects(), 1);
  h.store.control(run.id, 'owner', paused.version, 'resume', 'resume');
  // A subsequent author edit does not undo the v2 fact or require rerunning it.
  h.db.prepare("UPDATE test_child_documents SET revision=3,text='author-newer' WHERE id='document'").run();
  await h.worker.runOnce(run.id); await h.childWorker.runOnce(run.id); await h.worker.runOnce(run.id);
  assert.equal(h.store.readRun(run.id).status, 'SUCCEEDED');
  assert.equal(h.effects(), 1);
  assert.equal((h.db.prepare('SELECT text FROM test_child_documents').get() as any).text, 'author-newer');
});

test('revocation after committed effect stops downstream consumption but retains the receipt and effect', async t => {
  const h = setup(t);
  await h.worker.runOnce(h.accepted.runId);
  const child = h.store.claimChild('first', 30000)!;
  await h.registry.execute(child.step.prepared, h.context(child));
  h.db.prepare('UPDATE test_child_policy SET allowed=0').run();
  h.db.prepare('UPDATE agent_step_leases SET lease_until=0').run();
  await h.childWorker.runOnce(child.run.id);
  assert.equal(h.store.readRun(child.run.id).status, 'NEEDS_REBASE');
  assert.equal(h.store.getStep(child.run.id, 1, 'append')!.status, 'COMMITTED');
  assert.equal(h.effects(), 1);
});

test('child waiting for external return releases its lease; paused late return is retained and resumes only its exact step', async t => {
  const h = setup(t, { channel: 'external' });
  await h.worker.runOnce(h.accepted.runId); await h.childWorker.runOnce(h.accepted.runId);
  const waiting = h.store.readRun(h.accepted.runId), external = h.journal.listExternal(waiting.id, 'owner')[0];
  assert.equal(waiting.status, 'WAITING_EXTERNAL'); assert.ok(waiting.activeStepId);
  assert.equal((h.db.prepare('SELECT lease_owner FROM agent_step_leases').get() as any).lease_owner, null);
  const paused = h.store.control(waiting.id, 'owner', waiting.version, 'pause', 'pause');
  h.journal.submitExternal(external.id, 'owner', external.inputHash, raw, { name: 'GPT-6 Sol fixture replay', model: 'gpt-6-sol' });
  assert.equal(h.store.readRun(waiting.id).status, 'PAUSED'); assert.equal(h.effects(), 0);
  h.store.control(waiting.id, 'owner', paused.version, 'resume', 'resume');
  await h.worker.runOnce(waiting.id); await h.childWorker.runOnce(waiting.id); await h.worker.runOnce(waiting.id);
  assert.equal(h.store.readRun(waiting.id).status, 'SUCCEEDED');
  assert.equal(h.store.readRun(waiting.id).invocationCount, 1); assert.equal(h.effects(), 1);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_steps').get() as any).n, 1);
});

test('unknown child attempt pauses for evidence, then reconciles its exact child without sending twice', async t => {
  let calls = 0;
  const h = setup(t, { channel: 'api', transport: { async sendOnce() { calls++; throw new Error('Unknown transport completion'); } } });
  await h.worker.runOnce(h.accepted.runId); await h.childWorker.runOnce(h.accepted.runId);
  const waiting = h.store.readRun(h.accepted.runId);
  assert.equal(waiting.status, 'RECONCILIATION_REQUIRED'); assert.equal(calls, 1);
  assert.throws(() => h.journal.reconcileReceived(waiting.id, 'owner', waiting.version, 'early'), code('EVIDENCE_MISSING'));
  const attempt = h.db.prepare('SELECT id,invocation_id FROM agent_attempts').get() as any;
  h.journal.recordResult(attempt.invocation_id, attempt.id, replay);
  h.journal.reconcileReceived(waiting.id, 'owner', waiting.version, 'evidence');
  assert.equal(h.store.readRun(waiting.id).status, 'WAITING_STEP');
  await h.childWorker.runOnce(waiting.id); await h.worker.runOnce(waiting.id);
  assert.equal(h.store.readRun(waiting.id).status, 'SUCCEEDED'); assert.equal(calls, 1); assert.equal(h.effects(), 1);
});

test('canceled child stores late provider evidence but cannot commit an effect or wake the parent', async t => {
  let cancel!: () => void;
  const h = setup(t, { channel: 'api', transport: { async sendOnce() { cancel(); return replay; } } });
  cancel = () => { const run = h.store.readRun(h.accepted.runId); h.store.control(run.id, 'owner', run.version, 'cancel', 'cancel'); };
  await h.worker.runOnce(h.accepted.runId); await h.childWorker.runOnce(h.accepted.runId);
  assert.equal(h.store.readRun(h.accepted.runId).status, 'CANCELED'); assert.equal(h.effects(), 0);
  assert.equal(JSON.parse((h.db.prepare('SELECT result_json FROM agent_invocations').get() as any).result_json).text, raw);
  assert.equal(h.store.claimChild('late', 30000), null);
});

test('child budget exhaustion preserves a partial parent and releases all execution ownership', async t => {
  const h = setup(t, { channel: 'api', transport: { async sendOnce() { throw new Error('must not send'); } } });
  await h.worker.runOnce(h.accepted.runId);
  // Controlled fault setup: all accepted logical-call allowance already spent.
  h.db.prepare('UPDATE agent_runs SET invocation_count=max_invocations WHERE id=?').run(h.accepted.runId);
  await h.childWorker.runOnce(h.accepted.runId);
  const run = h.store.readRun(h.accepted.runId);
  assert.equal(run.status, 'PARTIAL'); assert.equal(run.activeStepId, null); assert.equal(run.reason, 'BUDGET_EXHAUSTED');
  assert.equal(h.effects(), 0); assert.equal(h.store.claimChild('late', 30000), null);
});

test('child cannot commit another call under its step token, including forged parent leaseKind', async t => {
  const h = setup(t);
  const parent = h.store.claim('parent', 30000)!;
  const context: AccessContext = { ownerId: 'owner', scopeId: 'document', commandRevision: '1', policyRevision: parent.run.policyRevision, execution: parent.token, signal: new AbortController().signal };
  const request = durableCommand().input.request;
  const a = h.store.savePrepared(parent.token, await h.registry.prepare(request, context));
  const b = h.store.savePrepared(parent.token, await h.registry.prepare({ ...request, callId: 'other' }, context));
  h.store.handoff(parent.token, a.id);
  assert.throws(() => h.store.assertExecution(parent.token), code('LEASE_LOST'));
  const child = h.store.claimChild('child', 30000)!;
  assert.throws(() => h.store.assertExecution({ ...parent.token, stepId: a.id, leaseKind: 'step' }), code('LEASE_LOST'));
  assert.throws(() => h.store.assertExecution({ ...child.token, stepId: b.id }), code('LEASE_LOST'));
  assert.throws(() => h.store.commitStep(child.token, 'other', {} as any, () => {}), code('CHILD_LEASE_REQUIRED'));
  assert.equal(h.effects(), 0);
});

test('two durable calls in one run resume from receipts across bounded coordinator passes', async t => {
  const { AgentWorker } = await import('../packages/agent-core/src');
  const h = setup(t);
  const coordinator = new AgentWorker(h.store, h.registry, { workerId: 'multi-step', handlers: { CAPABILITY: async context => {
    const first = await context.call(durableCommand().input.request);
    const second = await context.call({ ...durableCommand().input.request, callId: 'append-next', input: { text: `after-revision-${(first.data as any).revision}` } });
    return { status: 'SUCCEEDED', result: second };
  } } });
  await coordinator.runOnce(); await h.childWorker.runOnce();
  await coordinator.runOnce(); await h.childWorker.runOnce();
  await coordinator.runOnce();
  assert.equal(h.store.readRun(h.accepted.runId).status, 'SUCCEEDED'); assert.equal(h.effects(), 2);
  assert.equal((h.db.prepare('SELECT revision FROM test_child_documents').get() as any).revision, 3);
});

test('post-commit validation failure produces NEEDS_REBASE with the effect preserved', async t => {
  const h = setup(t);
  await h.worker.runOnce();
  h.registry.validateObservation = () => { throw new AgentError('INVALID_OBSERVATION', 'injected post-commit schema rejection'); };
  await h.childWorker.runOnce();
  assert.equal(h.effects(), 1);
  assert.equal(h.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(h.store.getStep(h.accepted.runId, 1, 'append')!.status, 'COMMITTED');
  assert.equal(h.store.claimChild('must-not-retry', 30000), null);
});

test('failure within child effect transaction rolls back write and receipt, then stops the parent explicitly', async t => {
  const h = setup(t);
  h.db.exec("CREATE TRIGGER reject_test_effect BEFORE INSERT ON test_child_effects BEGIN SELECT RAISE(ABORT,'injected effect rollback'); END;");
  await h.worker.runOnce(); await h.childWorker.runOnce();
  assert.equal(h.effects(), 0);
  assert.equal((h.db.prepare('SELECT revision FROM test_child_documents').get() as any).revision, 1);
  assert.equal(h.store.getStep(h.accepted.runId, 1, 'append')!.status, 'PREPARED');
  assert.equal(h.store.readRun(h.accepted.runId).status, 'FAILED');
  assert.equal(h.store.claimChild('must-not-loop', 30000), null);
});

function launch(filename: string, workerId: string, operation: string) {
  const proc = fork(path.resolve('tests/fixtures/agent-durable-process.ts'), [filename, workerId, operation], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  return proc;
}
async function next(proc: ReturnType<typeof launch>): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Child test process timeout')); }, 10000);
    const message = (value: any) => { cleanup(); value.error ? reject(new Error(value.error)) : resolve(value); };
    const exit = (code: number | null) => { cleanup(); reject(new Error(`Child test exited: ${code}`)); };
    const cleanup = () => { clearTimeout(timer); proc.off('message', message); proc.off('exit', exit); };
    proc.once('message', message); proc.once('exit', exit);
  });
}
async function invoke(proc: ReturnType<typeof launch>) { const result = next(proc); proc.send({ go: true }); return result; }

test('real process crash after child receipt before ack recovers once, even after author advances document', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-child-crash-')), filename = path.join(directory, 'isolated.sqlite');
  const db = new Database(filename), h = durableFixture(db); const accepted = h.store.accept(durableCommand());
  const procs: ReturnType<typeof launch>[] = [];
  t.after(async () => { for (const proc of procs) if (proc.exitCode === null && proc.signalCode === null) { const ended = once(proc, 'exit'); proc.kill('SIGKILL'); await ended; } db.close(); rmSync(directory, { recursive: true, force: true }); });
  const dispatch = launch(filename, 'parent-process', 'handoff'); procs.push(dispatch); await next(dispatch);
  assert.equal((await invoke(dispatch)).result.status, 'WAITING_STEP');
  const commit = launch(filename, 'child-process', 'commit'); procs.push(commit); await next(commit);
  const received = await invoke(commit); assert.equal(received.result.committed, true);
  const killed = once(commit, 'exit'); commit.kill('SIGKILL'); await killed;
  assert.equal(h.store.readRun(accepted.runId).status, 'WAITING_STEP');
  assert.equal(h.store.getStep(accepted.runId, 1, 'append')!.status, 'COMMITTED');
  db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(received.result.stepId);
  db.prepare("UPDATE test_child_documents SET revision=3,text='author-after-effect'").run();
  const recover = launch(filename, 'recovery-process', 'recover'); procs.push(recover); await next(recover);
  assert.equal((await invoke(recover)).result.status, 'SUCCEEDED');
  assert.equal((db.prepare('SELECT count(*) AS n FROM test_child_effects').get() as any).n, 1);
  assert.equal((db.prepare('SELECT text FROM test_child_documents').get() as any).text, 'author-after-effect');
  assert.equal(h.store.events(accepted.threadId, 'owner').filter(event => event.type === 'step.completed').length, 1);
});

test('two independent processes compete for one child lease with a single winner', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-child-race-')), filename = path.join(directory, 'isolated.sqlite');
  const db = new Database(filename), h = durableFixture(db); h.store.accept(durableCommand()); await h.worker.runOnce();
  const procs = [launch(filename, 'claim-a', 'claim'), launch(filename, 'claim-b', 'claim')];
  t.after(async () => { for (const proc of procs) if (proc.exitCode === null && proc.signalCode === null) { const ended = once(proc, 'exit'); proc.kill('SIGKILL'); await ended; } db.close(); rmSync(directory, { recursive: true, force: true }); });
  await Promise.all(procs.map(next)); const results = await Promise.all(procs.map(invoke));
  assert.equal(results.filter(value => value.result).length, 1);
});

test('cancel after domain commit preserves its receipt but forbids stale commit replay and scheduler acknowledgement', async t => {
  const h = setup(t);
  await h.worker.runOnce();
  const child = h.store.claimChild('child', 30000)!;
  const observation = await h.registry.execute(child.step.prepared, h.context(child));
  const run = h.store.readRun(child.run.id);
  h.store.control(run.id, 'owner', run.version, 'cancel', 'cancel-after-effect');
  assert.throws(() => h.store.commitStep(child.token, 'append', observation, () => { throw new Error('must never reapply'); }), code('LEASE_LOST'));
  assert.throws(() => h.store.completeChild(child.token), code('LEASE_LOST'));
  assert.equal(h.store.getStep(run.id, 1, 'append')!.status, 'COMMITTED');
  assert.equal(h.store.readRun(run.id).status, 'CANCELED'); assert.equal(h.effects(), 1);
});

test('parent receipt replay validation failure also preserves committed work as NEEDS_REBASE', async t => {
  const h = setup(t);
  await h.worker.runOnce(); await h.childWorker.runOnce();
  h.registry.validateObservation = () => { throw new AgentError('INVALID_OBSERVATION', 'injected parent receipt validation error'); };
  await h.worker.runOnce();
  assert.equal(h.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(h.effects(), 1); assert.equal(h.store.getStep(h.accepted.runId, 1, 'append')!.status, 'COMMITTED');
});


test('multi-step resume acknowledges a previously committed child before dispatching the next child', async t => {
  const { AgentWorker } = await import('../packages/agent-core/src');
  const h = setup(t);
  const coordinator = new AgentWorker(h.store, h.registry, { workerId: 'multi-step-resume', handlers: { CAPABILITY: async context => {
    await context.call(durableCommand().input.request);
    const next = await context.call({ ...durableCommand().input.request, callId: 'second', input: { text: 'second mechanical value' } });
    return { status: 'SUCCEEDED', result: next };
  } } });
  await coordinator.runOnce();
  const child = h.store.claimChild('before-pause', 30000)!;
  await h.registry.execute(child.step.prepared, h.context(child));
  const run = h.store.readRun(child.run.id);
  const paused = h.store.control(run.id, 'owner', run.version, 'pause', 'pause-between-effect-and-ack');
  h.store.control(run.id, 'owner', paused.version, 'resume', 'resume-multiple');
  await coordinator.runOnce(); await h.childWorker.runOnce();
  assert.equal(h.store.readRun(run.id).activeStepId, null);
  await coordinator.runOnce(); await h.childWorker.runOnce(); await coordinator.runOnce();
  assert.equal(h.store.readRun(run.id).status, 'SUCCEEDED'); assert.equal(h.effects(), 2);
  assert.equal(h.store.events(run.threadId, 'owner').filter(event => event.type === 'step.completed').length, 2);
});
