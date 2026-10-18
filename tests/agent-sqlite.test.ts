import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { AgentError, type AgentCommand } from '../packages/agent-core/src';
import { AgentSqliteStore } from '../packages/agent-sqlite/src';
import { preparedFixture, observationFixture } from './fixtures/agent-store-fixture';

function harness(t: any) {
  const directory = mkdtempSync(path.join(tmpdir(), 'agent-store-'));
  const filename = path.join(directory, 'isolated.sqlite');
  const db = new Database(filename);
  const store = new AgentSqliteStore(db);
  store.ensureSchema();
  db.exec('CREATE TABLE test_domain_effects(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL)');
  t.after(() => { if (db.open) db.close(); rmSync(directory, { recursive: true, force: true }); });
  return { db, store, filename };
}
const command = (requestId = 'request-1'): AgentCommand => ({ requestId, ownerId: 'owner-1', scopeId: 'scope-1', kind: 'CHAT', input: { message: '纯聊天事务测试' }, policyRevision: '1', maxInvocations: 4 });
const code = (name: string) => (error: unknown) => error instanceof AgentError && error.code === name;

test('accepted commands survive reopening; duplicate receipt is stable and different payload conflicts', t => {
  const { db, store, filename } = harness(t);
  const accepted = store.accept(command());
  db.close();
  const reopened = new Database(filename);
  t.after(() => reopened.close());
  const next = new AgentSqliteStore(reopened);
  next.ensureSchema();
  assert.deepEqual(next.accept(command()), accepted);
  assert.throws(() => next.accept({ ...command(), input: { message: 'changed' } }), code('IDEMPOTENCY_CONFLICT'));
  assert.equal(next.readRun(accepted.runId, 'owner-1').status, 'QUEUED');
  assert.throws(() => next.readRun(accepted.runId, 'owner-2'), code('RUN_NOT_FOUND'));
  assert.throws(() => next.accept({ ...command('other'), threadId: accepted.threadId, ownerId: 'owner-2' }), code('THREAD_NOT_FOUND'));
  assert.equal(next.events(accepted.threadId, 'owner-1').length, 1);
});

test('one thread is ordered while other threads can progress independently', t => {
  const { store } = harness(t);
  const first = store.accept(command());
  const second = store.accept({ ...command('request-2'), threadId: first.threadId });
  const independent = store.accept(command('request-3'));
  assert.equal(store.claim('worker', 30000, second.runId), null);
  const claim = store.claim('worker', 30000, first.runId)!;
  assert.ok(store.claim('other', 30000, independent.runId));
  assert.equal(store.claim('other', 30000, first.runId), null);
  store.finish(claim.token, 'SUCCEEDED', { reply: 'saved' });
  assert.ok(store.claim('other', 30000, second.runId));
});

test('lease takeover fences the previous worker and renewal never revives expired ownership', t => {
  const { db, store } = harness(t);
  const accepted = store.accept(command());
  const first = store.claim('worker-a', 30000)!;
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(accepted.runId);
  assert.equal(store.renew(first.token, 30000), null);
  const replacement = store.claim('worker-b', 30000)!;
  assert.ok(replacement.token.fence > first.token.fence);
  assert.throws(() => store.finish(first.token, 'SUCCEEDED', {}), code('LEASE_LOST'));
  assert.equal(store.assertExecution(replacement.token).leaseOwner, 'worker-b');
});

test('a periodic short renewal cannot shorten a confirmed extended lease', t => {
  const { store } = harness(t);
  const accepted = store.accept(command('extended-lease'));
  const parent = store.claim('parent', 1000, accepted.runId)!;
  const parentExtended = store.renew(parent.token, 2000)!;
  assert.ok(store.renew(parent.token, 1000)! >= parentExtended);
  const prepared = preparedFixture(parent.run);
  const step = store.savePrepared(parent.token, prepared); store.handoff(parent.token, step.id);
  const child = store.claimChild('child', 1000, accepted.runId)!;
  const childExtended = store.renew(child.token, 2000)!;
  assert.ok(store.renew(child.token, 1000)! >= childExtended);
});

test('preparing a step cannot commit after its decision guard expires the lease', t => {
  const { db, store } = harness(t);
  const accepted = store.accept(command('guard-expires'));
  const claimed = store.claim('worker', 30000, accepted.runId)!;
  const prepared = preparedFixture(claimed.run);
  store.setBudgetAccounting({
    bound: () => false, timeAvailable: () => true, activity: () => {}, stopActivity: () => {},
    guardDecision: () => { db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(claimed.run.id); },
    reserve: () => true, attempt: () => {}, usage: () => {},
  });
  assert.throws(() => store.savePrepared(claimed.token, prepared), code('LEASE_LOST'));
  assert.equal(store.getStep(claimed.run.id, claimed.run.generation, prepared.request.callId), null);
});

test('repeated expired coordinator claims stop durably without repeating work', t => {
  const { db, store } = harness(t);
  const accepted=store.accept(command('stalled-coordinator'));
  const first=store.claim('worker-a',30000,accepted.runId)!;
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(accepted.runId);
  const second=store.claim('worker-b',30000,accepted.runId)!;
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(accepted.runId);
  assert.equal(store.claim('worker-c',30000,accepted.runId),null);
  const stopped=store.readRun(accepted.runId,'owner-1');
  assert.equal(stopped.status,'NEEDS_REBASE');
  assert.equal(stopped.reason,'LEASE_STALL_LIMIT');
  assert.equal(store.claim('worker-d',30000,accepted.runId),null);
  assert.throws(()=>store.assertExecution(first.token),code('LEASE_LOST'));
  assert.throws(()=>store.assertExecution(second.token),code('LEASE_LOST'));
  assert.equal(store.events(accepted.threadId,'owner-1').filter(event=>event.type==='run.waiting').length,1);
});

test('durable coordinator progress resets the expired-claim limit', t => {
  const {db,store}=harness(t);
  const accepted=store.accept(command('stalled-with-progress'));
  store.claim('worker-a',30000,accepted.runId);
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(accepted.runId);
  store.claim('worker-b',30000,accepted.runId);
  store.recordSystemEvent(accepted.runId,'goal.sampling_saved',{samplingId:'mechanical-sampling'});
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(accepted.runId);
  const resumed=store.claim('worker-c',30000,accepted.runId);
  assert.ok(resumed);
  assert.equal(resumed.run.status,'RUNNING');
  assert.equal(store.readRun(accepted.runId).reason,null);
});

test('repeated expired child claims preserve the prepared step and stop takeover', t => {
  const { db, store }=harness(t);
  const accepted=store.accept(command('stalled-child'));
  const parent=store.claim('parent',30000,accepted.runId)!;
  const step=store.savePrepared(parent.token,preparedFixture(parent.run));
  store.handoff(parent.token,step.id);
  const first=store.claimChild('child-a',30000,accepted.runId)!;
  db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(step.id);
  const second=store.claimChild('child-b',30000,accepted.runId)!;
  db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(step.id);
  assert.equal(store.claimChild('child-c',30000,accepted.runId),null);
  const stopped=store.readRun(accepted.runId,'owner-1');
  assert.equal(stopped.status,'NEEDS_REBASE');
  assert.equal(stopped.reason,'LEASE_STALL_LIMIT');
  assert.equal(store.getStep(accepted.runId,parent.run.generation,'call-1')?.status,'PREPARED');
  assert.throws(()=>store.assertExecution(first.token),code('LEASE_LOST'));
  assert.throws(()=>store.assertExecution(second.token),code('LEASE_LOST'));
});

test('a child cannot acknowledge a committed effect after deep VIEW validation outlives its lease',t=>{
  const {db,store}=harness(t),accepted=store.accept(command('committed-ack-expiry'));
  const parent=store.claim('parent',30000,accepted.runId)!;
  const step=store.savePrepared(parent.token,preparedFixture(parent.run));
  store.handoff(parent.token,step.id);
  const child=store.claimChild('child',30000,accepted.runId)!;
  store.commitStep(child.token,step.prepared.request.callId,observationFixture,()=>{});
  const original=store.assertDecisionInput.bind(store);
  store.assertDecisionInput=(token,callId,phase)=>{
    original(token,callId,phase);
    if(phase==='VIEW')db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(step.id);
  };
  assert.throws(()=>store.completeChild(child.token),code('LEASE_LOST'));
  assert.equal(store.readRun(accepted.runId).status,'WAITING_STEP');
  assert.equal((db.prepare('SELECT status FROM agent_step_leases WHERE step_id=?').get(step.id) as any).status,'RUNNING');
  assert.equal(store.getStep(accepted.runId,parent.run.generation,step.prepared.request.callId)?.status,'COMMITTED');
});

test('resuming an older run cannot deadlock recovery of the current manual owner', t => {
  const { db, store } = harness(t);
  const delegated = store.accept(command());
  const first = store.claim('agent', 30000)!;
  const paused = store.control(first.run.id, 'owner-1', first.run.version, 'pause', 'pause');
  const manual = store.accept({ ...command('manual'), threadId: delegated.threadId });
  const active = store.claim('manual', 30000, manual.runId)!;
  assert.ok(active);
  store.control(first.run.id, 'owner-1', paused.version, 'resume', 'resume');
  db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(manual.runId);
  const recovered = store.claim('recovery', 30000)!;
  assert.equal(recovered.run.id, manual.runId);
  assert.throws(() => store.finish(active.token, 'SUCCEEDED', {}), code('LEASE_LOST'));
  store.finish(recovered.token, 'SUCCEEDED', {});
  assert.equal(store.claim('agent-resumed', 30000)!.run.id, first.run.id);
});

test('domain writes, receipts and event cursor commit once in the same transaction', t => {
  const { db, store } = harness(t);
  const accepted = store.accept(command());
  const claim = store.claim('worker', 30000)!;
  store.savePrepared(claim.token, preparedFixture(claim.run));
  const apply = () => db.prepare('INSERT INTO test_domain_effects(run_id) VALUES(?)').run(accepted.runId);
  store.commitStep(claim.token, 'call-1', observationFixture, apply);
  store.commitStep(claim.token, 'call-1', observationFixture, apply);
  assert.equal((db.prepare('SELECT count(*) AS count FROM test_domain_effects').get() as any).count, 1);
  const events = store.events(accepted.threadId, 'owner-1');
  assert.equal(events.filter(event => event.type === 'step.committed').length, 1);
  assert.deepEqual(events.map(event => event.seq), [1, 2, 3, 4]);
  assert.deepEqual(store.events(accepted.threadId, 'owner-1', 2).map(event => event.seq), [3, 4]);
  assert.throws(() => store.events(accepted.threadId, 'owner-2'), code('THREAD_NOT_FOUND'));
});

test('effect failure and accidental async callback roll back all domain writes and receipts', t => {
  const { db, store } = harness(t);
  store.accept(command());
  const claim = store.claim('worker', 30000)!;
  store.savePrepared(claim.token, preparedFixture(claim.run));
  const before = store.events(claim.run.threadId, 'owner-1').length;
  assert.throws(() => store.commitStep(claim.token, 'call-1', observationFixture, () => {
    db.prepare('INSERT INTO test_domain_effects(run_id) VALUES(?)').run(claim.run.id);
    throw new Error('injected process boundary failure');
  }), /injected/);
  assert.throws(() => store.commitStep(claim.token, 'call-1', observationFixture, () => {
    db.prepare('INSERT INTO test_domain_effects(run_id) VALUES(?)').run(claim.run.id);
    return Promise.resolve();
  }), code('ASYNC_TRANSACTION'));
  let enteredAsync = false;
  assert.throws(() => store.commitStep(claim.token, 'call-1', observationFixture, async () => {
    enteredAsync = true;
    await Promise.resolve();
    db.prepare('INSERT INTO test_domain_effects(run_id) VALUES(?)').run(claim.run.id);
  }), code('ASYNC_TRANSACTION'));
  assert.equal(enteredAsync, false);
  assert.equal((db.prepare('SELECT count(*) AS count FROM test_domain_effects').get() as any).count, 0);
  assert.equal(store.getStep(claim.run.id, claim.run.generation, 'call-1')?.status, 'PREPARED');
  assert.equal(store.events(claim.run.threadId, 'owner-1').length, before);
});

test('pause/cancel revoke old tokens; pause preserves frozen input for explicit resume', t => {
  const { db, store } = harness(t);
  store.accept(command());
  const claim = store.claim('worker', 30000)!;
  const step = store.savePrepared(claim.token, preparedFixture(claim.run));
  const paused = store.control(claim.run.id, 'owner-1', claim.run.version, 'pause', 'pause-1');
  assert.equal(paused.status, 'PAUSED');
  assert.ok(paused.controlGeneration > claim.run.controlGeneration);
  assert.deepEqual(store.control(claim.run.id, 'owner-1', claim.run.version, 'pause', 'pause-1'), paused);
  assert.throws(() => store.commitStep(claim.token, 'call-1', observationFixture, () => db.prepare('INSERT INTO test_domain_effects(run_id) VALUES(?)').run(claim.run.id)), code('LEASE_LOST'));
  store.control(claim.run.id, 'owner-1', paused.version, 'resume', 'resume-1');
  const resumed = store.claim('new-worker', 30000)!;
  assert.equal(store.getStep(resumed.run.id, resumed.run.generation, 'call-1')?.id, step.id);
  const canceled = store.control(resumed.run.id, 'owner-1', resumed.run.version, 'cancel', 'cancel-1');
  assert.equal(canceled.status, 'CANCELED');
  assert.throws(() => store.finish(resumed.token, 'SUCCEEDED', {}), code('LEASE_LOST'));
  assert.throws(() => store.control(resumed.run.id, 'owner-1', canceled.version, 'resume', 'resume-2'), code('INVALID_CONTROL'));
});

function child(filename: string, worker: string, operation = 'claim') {
  return fork(path.resolve('tests/fixtures/agent-store-process.ts'), [filename, worker, operation], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
}
function message(proc: ChildProcess): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Isolated worker timed out')); }, 10000);
    const done = (data: unknown) => { cleanup(); resolve(data); };
    const failed = (error: unknown) => { cleanup(); reject(error); };
    const exited = (code: number | null) => failed(new Error(`Isolated worker exited before receipt: ${code}`));
    const cleanup = () => { clearTimeout(timeout); proc.off('message', done); proc.off('error', failed); proc.off('exit', exited); };
    proc.once('message', done); proc.once('error', failed); proc.once('exit', exited);
  });
}
test('two real worker processes competing for one run obtain exactly one valid lease', async t => {
  const { store, filename } = harness(t);
  store.accept(command());
  const workers = [child(filename, 'process-a'), child(filename, 'process-b')];
  t.after(() => workers.forEach(proc => proc.kill()));
  await Promise.all(workers.map(message));
  const results = workers.map(message);
  workers.forEach(proc => proc.send({ start: true }));
  const claims = (await Promise.all(results)).map(item => item.result).filter(Boolean);
  assert.equal(claims.length, 1);
  assert.equal(store.assertExecution(claims[0].token).leaseOwner, claims[0].token.workerId);
});

test('kill after domain commit, reopen and recover receipt without applying the effect again', async t => {
  const { db, store, filename } = harness(t);
  store.accept(command());
  const proc = child(filename, 'crashing-worker', 'commit');
  t.after(() => proc.kill());
  await message(proc);
  const receipt = message(proc);
  proc.send({ start: true });
  const { result: claim } = await receipt;
  const exited = once(proc, 'exit');
  proc.kill('SIGKILL');
  await exited;
  db.close();
  const reopened = new Database(filename);
  t.after(() => reopened.close());
  const recovered = new AgentSqliteStore(reopened);
  recovered.ensureSchema();
  let reapplied = false;
  assert.deepEqual(recovered.commitStep(claim.token, 'call-1', observationFixture, () => { reapplied = true; }), observationFixture);
  assert.equal(reapplied, false);
  assert.equal((reopened.prepare('SELECT count(*) AS count FROM test_domain_effects').get() as any).count, 1);
});
