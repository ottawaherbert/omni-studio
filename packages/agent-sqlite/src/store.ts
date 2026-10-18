import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AgentError, ExecutionSuspended, assertSamePayload, hashCommand, hashValue, jsonCopy, stableJson, type AgentCommand, type AgentEvent, type AgentRun, type AgentStep, type ClaimedRun, type ClaimedChild, type ExecutionToken, type Observation, type PreparedCall, type RunStatus, type RunLifecycleParticipant, type ModelResult } from '../../agent-core/src';

type DB = InstanceType<typeof Database>;
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const terminals = new Set<RunStatus>(['SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELED']);

// duilang's durable acceptance, event cursor, fencing and receipt semantics,
// adapted to synchronous SQLite transactions. No global DB or domain import.
export class AgentSqliteStore {
  constructor(readonly db: DB) {}
  private readonly lifecycle: RunLifecycleParticipant[] = [];
  private readonly schedulingBypass: Array<(candidate:AgentRun,earlier:AgentRun)=>boolean> = [];
  private readonly threadReleaseOnWait: Array<(run:AgentRun,status:RunStatus)=>boolean> = [];
  private accounting: {
    bound(runId: string): boolean;
    timeAvailable(runId: string): boolean;
    activity(runId: string, ownerKey: string, leaseUntil: number | null, now: number, renew?: boolean): void;
    stopActivity(runId: string, now: number): void;
    guardDecision(run: AgentRun, callId: string, phase: 'CONSUME' | 'VIEW'): void;
    reserve(run: AgentRun, kind: 'INVOCATION' | 'TOOL', operationId: string, callId?: string): boolean;
    attempt(runId: string, invocationId: string, attemptId: string): void;
    usage(runId: string, attemptId: string, result: ModelResult): void;
  } | null = null;
  addLifecycleParticipant(participant: RunLifecycleParticipant) { if (!this.lifecycle.includes(participant)) this.lifecycle.push(participant); }
  /** A host may let a strictly read-only run pass a suspended earlier run.
   * Active execution still serializes through agent_threads.active_run_id. */
  addSchedulingBypass(policy:(candidate:AgentRun,earlier:AgentRun)=>boolean){
    if(!this.schedulingBypass.includes(policy))this.schedulingBypass.push(policy);
  }
  addThreadReleaseOnWait(policy:(run:AgentRun,status:RunStatus)=>boolean){
    if(!this.threadReleaseOnWait.includes(policy))this.threadReleaseOnWait.push(policy);
  }
  setBudgetAccounting(accounting: NonNullable<AgentSqliteStore['accounting']>) {
    if (this.accounting && this.accounting !== accounting) throw new AgentError('ACCOUNTING_ALREADY_REGISTERED', '执行账本已注册');
    this.accounting = accounting;
  }
  reserveBudget(run: AgentRun, kind: 'INVOCATION' | 'TOOL', operationId: string, callId?: string) { return this.accounting?.reserve(run, kind, operationId, callId) ?? true; }
  hasSharedBudget(runId: string) { return this.accounting?.bound(runId) ?? false; }
  budgetTimeAvailable(runId: string) { return this.accounting?.timeAvailable(runId) ?? true; }
  assertDecisionInput(token: ExecutionToken, callId: string, phase: 'CONSUME' | 'VIEW') {
    this.accounting?.guardDecision(this.assertExecution(token), callId, phase);
    this.assertExecution(token);
  }
  assertOwnerDecisionInput(token: ExecutionToken, phase: 'CONSUME' | 'VIEW') {
    if (!token.stepId) return;
    const row = this.db.prepare('SELECT call_id FROM agent_steps WHERE id=? AND run_id=? AND generation=?').get(token.stepId, token.runId, token.inputRevision) as any;
    if (!row) throw new AgentError('MODEL_OWNER_MISMATCH', '请求不属于当前工具步骤');
    this.assertDecisionInput(token, row.call_id, phase);
  }
  recordBudgetAttempt(runId: string, invocationId: string, attemptId: string) { this.accounting?.attempt(runId, invocationId, attemptId); }
  recordBudgetUsage(runId: string, attemptId: string, result: ModelResult) { this.accounting?.usage(runId, attemptId, result); }
  private changed(previous: AgentRun, cause: string) {
    const next = this.readRun(previous.id);
    if (next.status === 'RUNNING' && cause === 'claim') this.accounting?.activity(next.id, 'run', next.leaseUntil, this.now());
    else if (next.status !== 'RUNNING') this.accounting?.stopActivity(next.id, this.now());
    for (const participant of this.lifecycle) {
      const result = participant.transition(previous, next, cause) as unknown;
      if (result && typeof (result as any).then === 'function') throw new AgentError('ASYNC_TRANSACTION', '生命周期钩子必须同步');
    }
    return next;
  }

  ensureSchema() {
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_threads (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope_id TEXT NOT NULL,
        last_seq INTEGER NOT NULL DEFAULT 0, active_run_id TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES agent_threads(id),
        owner_id TEXT NOT NULL, scope_id TEXT NOT NULL, kind TEXT NOT NULL,
        input_json TEXT NOT NULL, policy_revision TEXT NOT NULL,
        status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        generation INTEGER NOT NULL DEFAULT 1, control_generation INTEGER NOT NULL DEFAULT 1, fence INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT, lease_until INTEGER,
        max_invocations INTEGER NOT NULL, invocation_count INTEGER NOT NULL DEFAULT 0,
        result_json TEXT, reason TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_runs_ready ON agent_runs(status, lease_until, created_at);
      CREATE TABLE IF NOT EXISTS agent_commands (
        owner_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES agent_runs(id), response_json TEXT NOT NULL,
        PRIMARY KEY(owner_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS agent_engine_bindings (
        owner_id TEXT NOT NULL, request_id TEXT NOT NULL, engine_owner TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES agent_runs(id), PRIMARY KEY(owner_id, request_id)
      );
      CREATE TABLE IF NOT EXISTS agent_steps (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id),
        generation INTEGER NOT NULL, call_id TEXT NOT NULL,
        status TEXT NOT NULL, request_hash TEXT NOT NULL, prepared_json TEXT NOT NULL, observation_json TEXT,
        UNIQUE(run_id, generation, call_id)
      );
      CREATE TABLE IF NOT EXISTS agent_step_leases (
        step_id TEXT PRIMARY KEY REFERENCES agent_steps(id), run_id TEXT NOT NULL REFERENCES agent_runs(id),
        status TEXT NOT NULL, control_generation INTEGER NOT NULL, fence INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT, lease_until INTEGER
      );
      CREATE INDEX IF NOT EXISTS agent_step_leases_ready ON agent_step_leases(status,lease_until);
      CREATE TABLE IF NOT EXISTS agent_events (
        thread_id TEXT NOT NULL REFERENCES agent_threads(id), seq INTEGER NOT NULL,
        run_id TEXT NOT NULL REFERENCES agent_runs(id), type TEXT NOT NULL, data_json TEXT NOT NULL,
        PRIMARY KEY(thread_id, seq)
      );
    `);
    if (!(this.db.prepare('PRAGMA table_info(agent_runs)').all() as { name: string }[]).some(column => column.name === 'active_step_id')) this.db.exec('ALTER TABLE agent_runs ADD COLUMN active_step_id TEXT');
  }

  private now() { return (this.db.prepare("SELECT CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) AS now").get() as { now: number }).now; }
  /** A synchronous validator can outlive its JS heartbeat. Stop automatic
   * lease takeovers after three consecutive claims without a durable event. */
  private repeatedClaims(runId: string, type: 'run.claimed' | 'step.claimed', stepId?: string): boolean {
    const rows=this.db.prepare('SELECT type,data_json FROM agent_events WHERE run_id=? ORDER BY seq DESC LIMIT 3').all(runId) as Array<{type:string;data_json:string}>;
    return rows.length===3&&rows.every(row=>row.type===type&&(!stepId||JSON.parse(row.data_json).stepId===stepId));
  }
  private transaction<T>(action: () => T): T {
    return this.db.transaction(() => {
      const result = action();
      if (result && typeof (result as any).then === 'function') throw new AgentError('ASYNC_TRANSACTION', '领域事务不能包含异步操作');
      return result;
    }).immediate();
  }
  /** Trusted host adapters only; never expose the DB or this callback as a model tool. */
  atomic<T>(action: () => T): T { return this.transaction(action); }
  recordSystemEvent(runId: string, type: string, data: unknown) { this.event(this.readRun(runId), type, data); }
  wait(token: ExecutionToken, status: 'WAITING_EXTERNAL' | 'RECONCILIATION_REQUIRED' | 'NEEDS_REBASE' | 'WAITING_INPUT', reason: string) {
    return this.transaction(() => {
      const run = this.assertExecution(token);
      if (token.leaseKind === 'step') this.db.prepare('UPDATE agent_step_leases SET status=?,lease_owner=NULL,lease_until=NULL WHERE step_id=?').run(status, token.stepId!);
      this.db.prepare('UPDATE agent_runs SET status=?,reason=?,version=version+1,lease_owner=NULL,lease_until=NULL WHERE id=?').run(status, reason, run.id);
      if (status === 'NEEDS_REBASE' || status === 'WAITING_INPUT' ||
        this.threadReleaseOnWait.some(policy=>policy(run,status)))
        this.db.prepare('UPDATE agent_threads SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.threadId, run.id);
      this.changed(run, `wait:${status}`);
      this.event(run, 'run.waiting', { status, reason });
    });
  }
  private decode(row: any): AgentRun {
    return {
      id: row.id, threadId: row.thread_id, ownerId: row.owner_id, scopeId: row.scope_id,
      kind: row.kind, input: JSON.parse(row.input_json), policyRevision: row.policy_revision,
      status: row.status, version: row.version, generation: row.generation, controlGeneration: row.control_generation, fence: row.fence,
      leaseOwner: row.lease_owner, leaseUntil: row.lease_until, maxInvocations: row.max_invocations,
      invocationCount: row.invocation_count, result: row.result_json === null ? null : JSON.parse(row.result_json), reason: row.reason, activeStepId: row.active_step_id ?? null,
    };
  }
  readRun(runId: string, ownerId?: string): AgentRun {
    const row = ownerId === undefined
      ? this.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(runId)
      : this.db.prepare('SELECT * FROM agent_runs WHERE id=? AND owner_id=?').get(runId, ownerId);
    if (!row) throw new AgentError('RUN_NOT_FOUND', '执行任务不存在', 404);
    return this.decode(row);
  }
  private event(run: AgentRun, type: string, data: unknown) {
    const result = this.db.prepare('UPDATE agent_threads SET last_seq=last_seq+1 WHERE id=? RETURNING last_seq').get(run.threadId) as { last_seq: number };
    this.db.prepare('INSERT INTO agent_events(thread_id,seq,run_id,type,data_json) VALUES(?,?,?,?,?)').run(run.threadId, result.last_seq, run.id, type, stableJson(data));
  }

  accept(command: AgentCommand): { runId: string; threadId: string } {
    if (!command.ownerId || !command.scopeId || !command.requestId || !command.policyRevision
      || !['CAPABILITY', 'CHAT', 'GOAL'].includes(command.kind)
      || !Number.isSafeInteger(command.maxInvocations) || command.maxInvocations < 1 || command.maxInvocations > 10000) throw new AgentError('INVALID_COMMAND', '任务缺少身份、范围或有效预算', 400);
    const hash = hashCommand('ACCEPT', command);
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM agent_commands WHERE owner_id=? AND request_id=?').get(command.ownerId, command.requestId) as any;
      if (previous) { assertSamePayload(previous.payload_hash, hash); return JSON.parse(previous.response_json); }
      const threadId = command.threadId || id('thread');
      if (command.threadId) {
        const thread = this.db.prepare('SELECT * FROM agent_threads WHERE id=? AND owner_id=? AND scope_id=?').get(threadId, command.ownerId, command.scopeId);
        if (!thread) throw new AgentError('THREAD_NOT_FOUND', '会话不存在或不属于当前范围', 404);
      } else this.db.prepare('INSERT INTO agent_threads(id,owner_id,scope_id) VALUES(?,?,?)').run(threadId, command.ownerId, command.scopeId);
      const runId = id('run');
      this.db.prepare(`INSERT INTO agent_runs(id,thread_id,owner_id,scope_id,kind,input_json,policy_revision,status,max_invocations,created_at)
        VALUES(?,?,?,?,?,?,?,'QUEUED',?,?)`).run(runId, threadId, command.ownerId, command.scopeId, command.kind, stableJson(command.input), command.policyRevision, command.maxInvocations, this.now());
      const response = { runId, threadId };
      this.db.prepare('INSERT INTO agent_commands(owner_id,request_id,payload_hash,run_id,response_json) VALUES(?,?,?,?,?)').run(command.ownerId, command.requestId, hash, runId, stableJson(response));
      this.db.prepare("INSERT INTO agent_engine_bindings(owner_id,request_id,engine_owner,run_id) VALUES(?,?,'foundation',?)").run(command.ownerId, command.requestId, runId);
      this.event(this.readRun(runId), 'command.accepted', { kind: command.kind, requestId: command.requestId });
      return response;
    });
  }

  claim(workerId: string, leaseMs: number, runId?: string): ClaimedRun | null {
    if (!workerId || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300000) throw new AgentError('INVALID_LEASE', '执行租约无效', 400);
    return this.transaction(() => {
      const now = this.now();
      const rows = this.db.prepare(`SELECT r.*,t.active_run_id AS thread_active_run_id FROM agent_runs r JOIN agent_threads t ON t.id=r.thread_id
        WHERE (? IS NULL OR r.id=?) AND (r.status='QUEUED' OR (r.status='RUNNING' AND r.lease_until<=?))
          AND (t.active_run_id IS NULL OR t.active_run_id=r.id)
        ORDER BY r.created_at,r.rowid`).all(runId ?? null, runId ?? null, now) as any[];
      const row = rows.find(candidate => {
        const run=this.decode(candidate);
        if(candidate.thread_active_run_id===run.id)return this.lifecycle.every(participant=>participant.canClaim?.(run)!==false);
        const earlier=this.db.prepare(`SELECT * FROM agent_runs WHERE thread_id=? AND rowid<(SELECT rowid FROM agent_runs WHERE id=?)
          AND status IN ('QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','RECONCILIATION_REQUIRED') ORDER BY rowid`)
          .all(run.threadId,run.id) as any[];
        return earlier.every(item=>this.schedulingBypass.some(policy=>policy(run,this.decode(item))))&&
          this.lifecycle.every(participant=>participant.canClaim?.(run)!==false);
      });
      if (!row) return null;
      const updated = this.db.prepare(`UPDATE agent_runs SET status='RUNNING',version=version+1,fence=fence+1,lease_owner=?,lease_until=?
        WHERE id=? AND version=? RETURNING *`).get(workerId, now + leaseMs, row.id, row.version);
      if (!updated) return null;
      this.db.prepare('UPDATE agent_threads SET active_run_id=? WHERE id=?').run(row.id, row.thread_id);
      const run = this.decode(updated);
      this.changed(this.decode(row), 'claim');
      this.event(run, 'run.claimed', { fence: run.fence, generation: run.generation });
      const token = { runId: run.id, workerId, fence: run.fence, generation: run.controlGeneration, inputRevision: run.generation };
      if (this.accounting?.timeAvailable(run.id) === false) { this.finish(token, 'PARTIAL', { remainingWork: ['活动时间或截止时间预算已用尽'] }, 'BUDGET_EXHAUSTED'); return null; }
      if(row.status==='RUNNING'&&this.repeatedClaims(run.id,'run.claimed')){
        this.wait(token,'NEEDS_REBASE','LEASE_STALL_LIMIT');
        return null;
      }
      return { run, token };
    });
  }
  assertExecution(token: ExecutionToken): AgentRun {
    const run = this.readRun(token.runId);
    if (token.leaseKind === 'step') {
      const lease = this.db.prepare('SELECT * FROM agent_step_leases WHERE step_id=? AND run_id=?').get(token.stepId ?? '', run.id) as any;
      const step = this.db.prepare('SELECT generation FROM agent_steps WHERE id=? AND run_id=?').get(token.stepId ?? '', run.id) as any;
      if (!lease || !step || step.generation !== token.inputRevision || run.status !== 'WAITING_STEP' || run.activeStepId !== token.stepId || lease.status !== 'RUNNING' || lease.lease_owner !== token.workerId || lease.fence !== token.fence || lease.control_generation !== token.generation || run.controlGeneration !== token.generation || run.generation !== token.inputRevision || lease.lease_until === null || lease.lease_until <= this.now()) throw new AgentError('LEASE_LOST', '子执行权已失效，旧结果不会修改稿件');
      return run;
    }
    if (run.status !== 'RUNNING' || run.leaseOwner !== token.workerId || run.fence !== token.fence || run.controlGeneration !== token.generation || run.generation !== token.inputRevision || run.leaseUntil === null || run.leaseUntil <= this.now()) throw new AgentError('LEASE_LOST', '执行权已失效，旧结果不会修改稿件');
    return run;
  }
  renew(token: ExecutionToken, leaseMs: number): number | null {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300000) throw new AgentError('INVALID_LEASE', '执行租约无效', 400);
    return this.transaction(() => {
      try { this.assertExecution(token); } catch (error) { if (error instanceof AgentError && error.code === 'LEASE_LOST') return null; throw error; }
      if (this.accounting?.timeAvailable(token.runId) === false) { this.finish(token, 'PARTIAL', { remainingWork: ['活动时间或截止时间预算已用尽'] }, 'BUDGET_EXHAUSTED'); return null; }
      const now = this.now();
      const current = token.leaseKind === 'step'
        ? (this.db.prepare('SELECT lease_until FROM agent_step_leases WHERE step_id=?').get(token.stepId!) as { lease_until: number }).lease_until
        : this.readRun(token.runId).leaseUntil!;
      const until = Math.max(current, now + leaseMs);
      this.accounting?.activity(token.runId, token.leaseKind === 'step' ? token.stepId! : 'run', until, now, true);
      if (token.leaseKind === 'step') this.db.prepare('UPDATE agent_step_leases SET lease_until=? WHERE step_id=?').run(until, token.stepId!);
      else this.db.prepare('UPDATE agent_runs SET lease_until=? WHERE id=?').run(until, token.runId);
      return until;
    });
  }
  getStep(runId: string, generation: number, callId: string): AgentStep | null {
    const row = this.db.prepare('SELECT * FROM agent_steps WHERE run_id=? AND generation=? AND call_id=?').get(runId, generation, callId) as any;
    return row ? { id: row.id, runId: row.run_id, generation: row.generation, requestHash: row.request_hash, status: row.status, prepared: JSON.parse(row.prepared_json), observation: row.observation_json ? JSON.parse(row.observation_json) : null } : null;
  }
  savePrepared(token: ExecutionToken, prepared: PreparedCall, requestHash = hashValue(prepared.request)): AgentStep {
    const result = this.transaction(() => {
      const run = this.assertExecution(token);
      if (token.leaseKind === 'step') throw new AgentError('CHILD_NESTING_DENIED', '子执行不能代替父运行派发步骤');
      if (prepared.binding.ownerId !== run.ownerId || prepared.binding.scopeId !== run.scopeId || prepared.binding.commandRevision !== String(run.generation) || prepared.binding.policyRevision !== run.policyRevision) throw new AgentError('INPUT_BINDING_CHANGED', '能力输入与执行范围不一致');
      const existing = this.getStep(run.id, token.inputRevision, prepared.request.callId);
      this.assertDecisionInput(token, prepared.request.callId, existing?.status === 'COMMITTED' ? 'VIEW' : 'CONSUME');
      if (existing) { assertSamePayload(hashValue(existing.prepared), hashValue(prepared)); assertSamePayload(existing.requestHash, requestHash); return existing; }
      const stepId = id('step');
      if (!this.reserveBudget(run, 'TOOL', stepId, prepared.request.callId)) {
        this.finish(token, 'PARTIAL', { remainingWork: ['工具调用总预算已用尽'] }, 'BUDGET_EXHAUSTED');
        return null;
      }
      this.db.prepare("INSERT INTO agent_steps(id,run_id,generation,call_id,status,request_hash,prepared_json) VALUES(?,?,?,?,'PREPARED',?,?)").run(stepId, run.id, token.inputRevision, prepared.request.callId, requestHash, stableJson(prepared));
      this.event(run, 'step.prepared', { stepId, capabilityId: prepared.request.capabilityId });
      return this.getStep(run.id, token.inputRevision, prepared.request.callId)!;
    });
    if (!result) throw new ExecutionSuspended('BUDGET_EXHAUSTED', '工具预算已用尽，已有成果已保留');
    return result;
  }
  commitStep(token: ExecutionToken, callId: string, observation: Observation, applyEffect: () => unknown): Observation {
    if (Object.prototype.toString.call(applyEffect) === '[object AsyncFunction]') throw new AgentError('ASYNC_TRANSACTION', '稿件写入不能使用异步函数');
    return this.transaction(() => {
      const step = this.getStep(token.runId, token.inputRevision, callId);
      this.assertDecisionInput(token, callId, step?.status === 'COMMITTED' ? 'VIEW' : 'CONSUME');
      if (!step) throw new AgentError('STEP_NOT_FOUND', '执行步骤不存在', 404);
      if ((token.stepId && token.stepId !== step.id) || (this.db.prepare('SELECT 1 FROM agent_step_leases WHERE step_id=?').get(step.id) && (token.leaseKind !== 'step' || token.stepId !== step.id))) throw new AgentError('CHILD_LEASE_REQUIRED', '步骤副作用需要对应的子执行身份');
      const run = this.assertExecution(token);
      if (step.status === 'COMMITTED') { assertSamePayload(hashValue(step.observation), hashValue(observation)); return step.observation!; }
      if (step.status !== 'PREPARED') throw new AgentError('STEP_SUPERSEDED', '该步骤已被替代');
      const result = applyEffect();
      if (result && typeof (result as any).then === 'function') throw new AgentError('ASYNC_TRANSACTION', '稿件写入必须在同步事务中完成');
      this.assertExecution(token);
      this.db.prepare("UPDATE agent_steps SET status='COMMITTED',observation_json=? WHERE id=?").run(stableJson(observation), step.id);
      this.event(run, 'step.committed', { stepId: step.id, observation });
      return jsonCopy(observation);
    });
  }
  finish(token: ExecutionToken, status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED', result: unknown, reason: string | null = null) {
    if (!['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(status)) throw new AgentError('INVALID_STATUS', '执行终态无效', 400);
    return this.transaction(() => {
      const run = this.assertExecution(token);
      this.db.prepare("UPDATE agent_step_leases SET status='CANCELED',fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE run_id=? AND status!='COMPLETED'").run(run.id);
      this.db.prepare('UPDATE agent_runs SET status=?,version=version+1,result_json=?,reason=?,lease_owner=NULL,lease_until=NULL,active_step_id=NULL WHERE id=?').run(status, stableJson(result), reason, run.id);
      this.db.prepare('UPDATE agent_threads SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.threadId, run.id);
      this.changed(run, `finish:${status}`);
      this.event(run, 'run.finished', { status, reason });
      return this.readRun(run.id);
    });
  }
  /** Trusted Goal recovery after a budget-only halt. The old generation and
   * frozen step stay intact; a new fenced child must attest them again. */
  recoverBudgetStopped(runId: string, ownerId: string, expectedVersion: number, stepId: string | null): AgentRun {
    return this.transaction(() => {
      const run=this.readRun(runId,ownerId);
      if(run.version!==expectedVersion)throw new AgentError('RUN_VERSION_CONFLICT','执行状态已更新');
      if(run.status!=='PARTIAL'||run.reason!=='BUDGET_EXHAUSTED'||run.activeStepId)throw new AgentError('BUDGET_RECOVERY_INVALID','只有预算中止的原运行可恢复');
      if(this.accounting?.timeAvailable(run.id)===false)throw new AgentError('BUDGET_EXHAUSTED','活动时间或截止时间预算仍不足');
      if(stepId){
        const step=this.db.prepare("SELECT s.status,l.status lease_status FROM agent_steps s JOIN agent_step_leases l ON l.step_id=s.id WHERE s.id=? AND s.run_id=? AND s.generation=?").get(stepId,run.id,run.generation) as {status:string;lease_status:string}|undefined;
        if(!step||!['PREPARED','COMMITTED'].includes(step.status)||step.lease_status!=='CANCELED')throw new AgentError('BUDGET_RECOVERY_INVALID','原步骤不能安全接回');
      }else if(this.db.prepare("SELECT 1 FROM agent_steps s JOIN agent_step_leases l ON l.step_id=s.id WHERE s.run_id=? AND s.generation=? AND s.status IN ('PREPARED','COMMITTED') AND l.status='CANCELED' LIMIT 1").get(run.id,run.generation))
        throw new AgentError('BUDGET_RECOVERY_INVALID','存在未接回的子步骤');
      const nextGeneration=run.controlGeneration+1;
      this.db.prepare("UPDATE agent_runs SET status=?,version=version+1,control_generation=?,fence=fence+1,result_json=NULL,reason=NULL,active_step_id=?,lease_owner=NULL,lease_until=NULL WHERE id=?")
        .run(stepId?'WAITING_STEP':'QUEUED',nextGeneration,stepId,run.id);
      if(stepId)this.db.prepare("UPDATE agent_step_leases SET status='QUEUED',control_generation=?,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE step_id=?")
        .run(nextGeneration,stepId);
      this.changed(run,'budget:recover');
      this.event(run,'run.budget_recovered',{stepId,previousVersion:run.version});
      return this.readRun(run.id,ownerId);
    });
  }
  /** Author-requested retry after bounded synchronous validation or lease loss. Preserve the
   * exact frozen input and any received result; the next worker must attest it. */
  recoverLeaseStall(runId: string, ownerId: string, expectedVersion: number, stepId: string | null): AgentRun {
    return this.transaction(()=>{
      const run=this.readRun(runId,ownerId);
      if(run.version!==expectedVersion)throw new AgentError('RUN_VERSION_CONFLICT','执行状态已更新');
      if(!['NEEDS_REBASE','PAUSED'].includes(run.status)||!['LEASE_STALL_LIMIT','CONTEXT_VALIDATION_LIMIT'].includes(run.reason??'')||run.activeStepId!==stepId)
        throw new AgentError('LEASE_STALL_RECOVERY_INVALID','原运行不是可重试的同步校验停机状态');
      if(stepId){
        const step=this.db.prepare("SELECT s.status,l.status lease_status FROM agent_steps s JOIN agent_step_leases l ON l.step_id=s.id WHERE s.id=? AND s.run_id=? AND s.generation=?").get(stepId,run.id,run.generation) as {status:string;lease_status:string}|undefined;
        if(!step||!['PREPARED','COMMITTED'].includes(step.status)||!['NEEDS_REBASE','PAUSED'].includes(step.lease_status))
          throw new AgentError('LEASE_STALL_RECOVERY_INVALID','原子步骤不能安全接回');
      }else if(this.db.prepare("SELECT 1 FROM agent_step_leases WHERE run_id=? AND status='NEEDS_REBASE' LIMIT 1").get(run.id))
        throw new AgentError('LEASE_STALL_RECOVERY_INVALID','存在未接回的子步骤');
      const nextGeneration=run.controlGeneration+1;
      this.db.prepare("UPDATE agent_runs SET status=?,version=version+1,control_generation=?,fence=fence+1,reason=NULL,lease_owner=NULL,lease_until=NULL WHERE id=?")
        .run(stepId?'WAITING_STEP':'QUEUED',nextGeneration,run.id);
      if(stepId)this.db.prepare("UPDATE agent_step_leases SET status='QUEUED',control_generation=?,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE step_id=?")
        .run(nextGeneration,stepId);
      this.changed(run,'validation-stop:recover');
      this.event(run,'run.validation_stop_recovered',{stepId,previousVersion:run.version,reason:run.reason});
      return this.readRun(run.id,ownerId);
    });
  }
  control(runId: string, ownerId: string, expectedVersion: number, action: 'pause' | 'resume' | 'cancel', requestId: string) {
    if (!requestId || !['pause', 'resume', 'cancel'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AgentError('INVALID_CONTROL', '控制命令无效', 400);
    const hash = hashCommand('CONTROL', { runId, expectedVersion, action });
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM agent_commands WHERE owner_id=? AND request_id=?').get(ownerId, requestId) as any;
      if (previous) { assertSamePayload(hash, previous.payload_hash); return JSON.parse(previous.response_json) as AgentRun; }
      const run = this.readRun(runId, ownerId);
      if (run.version !== expectedVersion) throw new AgentError('RUN_VERSION_CONFLICT', '任务状态已更新，请刷新后重试');
      if (terminals.has(run.status) || (action === 'resume' && !['PAUSED','WAITING_INPUT','NEEDS_REBASE'].includes(run.status))) throw new AgentError('INVALID_CONTROL', '当前任务状态不能执行此操作');
      this.db.prepare("UPDATE agent_step_leases SET status=?,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE run_id=? AND status!='COMPLETED'").run(action === 'cancel' ? 'CANCELED' : 'PAUSED', run.id);
      const status = action === 'pause' ? 'PAUSED' : action === 'cancel' ? 'CANCELED' : 'QUEUED';
      this.db.prepare('UPDATE agent_runs SET status=?,version=version+1,control_generation=control_generation+1,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE id=?').run(status, run.id);
      this.db.prepare('UPDATE agent_threads SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.threadId, run.id);
      this.changed(run, `control:${action}`);
      const response = this.readRun(run.id);
      this.event(response, `run.${action}`, { status });
      this.db.prepare('INSERT INTO agent_commands(owner_id,request_id,payload_hash,run_id,response_json) VALUES(?,?,?,?,?)').run(ownerId, requestId, hash, run.id, stableJson(response));
      return response;
    });
  }
  /** Transfer coordination to exactly one frozen child. No model I/O in here. */
  handoff(token: ExecutionToken, stepId: string) {
    return this.transaction(() => {
      const run = this.assertExecution(token);
      if (token.leaseKind === 'step') throw new AgentError('CHILD_NESTING_DENIED', '子执行不能再派发子步骤');
      const row = this.db.prepare("SELECT * FROM agent_steps WHERE id=? AND run_id=? AND generation=? AND status IN ('PREPARED','COMMITTED')").get(stepId, run.id, run.generation) as any;
      if (!row || run.activeStepId && run.activeStepId !== stepId) throw new AgentError('INVALID_HANDOFF', '交接必须对应当前未完成步骤');
      this.db.prepare("INSERT INTO agent_step_leases(step_id,run_id,status,control_generation) VALUES(?,?,'QUEUED',?) ON CONFLICT(step_id) DO UPDATE SET status='QUEUED',control_generation=excluded.control_generation,fence=fence+1,lease_owner=NULL,lease_until=NULL").run(stepId, run.id, run.controlGeneration);
      this.db.prepare("UPDATE agent_runs SET status='WAITING_STEP',active_step_id=?,version=version+1,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE id=?").run(stepId, run.id);
      this.changed(run, 'handoff');
      this.event(run, 'step.handed_off', { stepId });
    });
  }
  claimChild(workerId: string, leaseMs: number, runId?: string): ClaimedChild | null {
    if (!workerId || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300000) throw new AgentError('INVALID_LEASE', '子执行租约无效', 400);
    return this.transaction(() => {
      const now = this.now();
      const rows = this.db.prepare(`SELECT l.*,s.call_id,s.generation,t.active_run_id AS thread_active_run_id FROM agent_step_leases l JOIN agent_steps s ON s.id=l.step_id JOIN agent_runs r ON r.id=l.run_id JOIN agent_threads t ON t.id=r.thread_id
        WHERE (? IS NULL OR r.id=?) AND r.status='WAITING_STEP' AND r.active_step_id=s.id AND r.generation=s.generation AND r.control_generation=l.control_generation AND (t.active_run_id IS NULL OR t.active_run_id=r.id)
          AND s.status IN ('PREPARED','COMMITTED') AND (l.status='QUEUED' OR (l.status='RUNNING' AND l.lease_until<=?)) ORDER BY r.created_at,r.rowid`).all(runId ?? null, runId ?? null, now) as any[];
      const row = rows.find(candidate => {
        const run=this.readRun(candidate.run_id);
        if(candidate.thread_active_run_id!==run.id){
          const earlier=this.db.prepare(`SELECT * FROM agent_runs WHERE thread_id=? AND rowid<(SELECT rowid FROM agent_runs WHERE id=?)
            AND status IN ('QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','RECONCILIATION_REQUIRED') ORDER BY rowid`)
            .all(run.threadId,run.id) as any[];
          if(!earlier.every(item=>this.schedulingBypass.some(policy=>policy(run,this.decode(item)))))return false;
        }
        return this.lifecycle.every(participant=>participant.canClaim?.(run)!==false);
      });
      if (!row) return null;
      const run = this.readRun(row.run_id);
      const until = now + leaseMs;
      this.db.prepare("UPDATE agent_step_leases SET status='RUNNING',fence=fence+1,lease_owner=?,lease_until=? WHERE step_id=?").run(workerId, until, row.step_id);
      this.db.prepare('UPDATE agent_threads SET active_run_id=? WHERE id=? AND (active_run_id IS NULL OR active_run_id=?)').run(run.id,run.threadId,run.id);
      const token: ExecutionToken = { runId: run.id, stepId: row.step_id, leaseKind: 'step', workerId, fence: row.fence + 1, generation: run.controlGeneration, inputRevision: run.generation };
      this.accounting?.activity(run.id, row.step_id, until, now);
      if (this.accounting?.timeAvailable(run.id) === false) { this.finish(token, 'PARTIAL', { remainingWork: ['活动时间或截止时间预算已用尽'] }, 'BUDGET_EXHAUSTED'); return null; }
      this.event(run, 'step.claimed', { stepId: row.step_id, fence: token.fence });
      if(row.status==='RUNNING'&&this.repeatedClaims(run.id,'step.claimed',row.step_id)){
        this.wait(token,'NEEDS_REBASE','LEASE_STALL_LIMIT');
        return null;
      }
      return { run, token, step: this.getStep(run.id, run.generation, row.call_id)!, leaseUntil: until };
    });
  }
  /** Receipt replay and scheduler acknowledgement are separate. A committed
   * domain effect is never repeated if a worker dies before this atomic wake. */
  completeChild(token: ExecutionToken) {
    return this.transaction(() => {
      const run = this.assertExecution(token);
      if (token.leaseKind !== 'step') throw new AgentError('CHILD_LEASE_REQUIRED', '子执行完成需要独立租约');
      const step = this.db.prepare("SELECT id FROM agent_steps WHERE id=? AND run_id=? AND status='COMMITTED'").get(token.stepId!, run.id);
      if (!step) throw new AgentError('MISSING_EFFECT_RECEIPT', '子执行尚无已提交结果');
      const call = this.db.prepare('SELECT call_id FROM agent_steps WHERE id=?').get(token.stepId!) as any;
      this.assertDecisionInput(token, call.call_id, 'VIEW');
      this.assertExecution(token);
      this.db.prepare("UPDATE agent_step_leases SET status='COMPLETED',lease_owner=NULL,lease_until=NULL WHERE step_id=?").run(token.stepId!);
      this.db.prepare("UPDATE agent_runs SET status='QUEUED',active_step_id=NULL,version=version+1,reason=NULL WHERE id=?").run(run.id);
      this.changed(run, 'child:ack');
      this.event(run, 'step.completed', { stepId: token.stepId! });
    });
  }
  /** Called only with received evidence or explicit reconciliation. Resume the
   * exact child if there is one; never queue the parent over an unfinished child. */
  wakeModelOwner(runId: string, inputRevision: number, ownerKey: string) {
    return this.transaction(() => {
      const run = this.readRun(runId);
      if (run.generation !== inputRevision || !['WAITING_EXTERNAL', 'RECONCILIATION_REQUIRED'].includes(run.status)) throw new AgentError('MODEL_OWNER_MISMATCH', '模型结果不属于当前等待执行');
      if (run.activeStepId) {
        if (run.activeStepId !== ownerKey) throw new AgentError('MODEL_OWNER_MISMATCH', '返回不属于当前子步骤');
        const changed = this.db.prepare("UPDATE agent_step_leases SET status='QUEUED',control_generation=?,fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE step_id=? AND run_id=? AND status IN ('WAITING_EXTERNAL','RECONCILIATION_REQUIRED')").run(run.controlGeneration, ownerKey, runId);
        if (changed.changes !== 1) throw new AgentError('MODEL_OWNER_MISMATCH', '子步骤不在等待状态');
      }
      this.db.prepare('UPDATE agent_runs SET status=?,version=version+1,reason=NULL,lease_owner=NULL,lease_until=NULL WHERE id=?').run(run.activeStepId ? 'WAITING_STEP' : 'QUEUED', runId);
      this.changed(run, 'model:wake');
    });
  }
  yieldRun(token: ExecutionToken) {
    this.transaction(() => {
      const run = this.assertExecution(token);
      if (token.leaseKind === 'step' || run.activeStepId) throw new AgentError('INVALID_YIELD', '仅协调回合可让出推进');
      this.db.prepare("UPDATE agent_runs SET status='QUEUED',version=version+1,lease_owner=NULL,lease_until=NULL WHERE id=?").run(run.id);
      this.changed(run, 'yield'); this.event(run, 'run.yielded', {});
    });
  }
  invalidateWaiting(runId: string, reason: string) {
    this.transaction(() => {
      const run = this.readRun(runId);
      if (!['WAITING_EXTERNAL', 'RECONCILIATION_REQUIRED'].includes(run.status)) throw new AgentError('INVALID_CONTROL', '任务不在等待模型返回');
      this.db.prepare("UPDATE agent_runs SET status='NEEDS_REBASE',version=version+1,reason=?,lease_owner=NULL,lease_until=NULL WHERE id=?").run(reason, run.id);
      if (run.activeStepId) this.db.prepare("UPDATE agent_step_leases SET status='NEEDS_REBASE',lease_owner=NULL,lease_until=NULL WHERE step_id=?").run(run.activeStepId);
      this.db.prepare('UPDATE agent_threads SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.threadId, run.id);
      this.changed(run, 'wait:NEEDS_REBASE');
    });
  }
  /** Accepted author revision only. The caller persists its immutable revision
   * and this generation change in the same outer transaction. */
  reviseInput(runId: string, ownerId: string, expectedVersion: number) {
    return this.transaction(() => {
      const run = this.readRun(runId, ownerId);
      if (run.version !== expectedVersion || terminals.has(run.status)) throw new AgentError('RUN_VERSION_CONFLICT', '任务状态已改变');
      this.db.prepare("UPDATE agent_steps SET status='SUPERSEDED' WHERE run_id=? AND status='PREPARED'").run(runId);
      this.db.prepare("UPDATE agent_step_leases SET status='CANCELED',fence=fence+1,lease_owner=NULL,lease_until=NULL WHERE run_id=? AND status!='COMPLETED'").run(runId);
      this.db.prepare("UPDATE agent_runs SET generation=generation+1,control_generation=control_generation+1,fence=fence+1,status='QUEUED',version=version+1,lease_owner=NULL,lease_until=NULL,active_step_id=NULL WHERE id=?").run(runId);
      this.db.prepare('UPDATE agent_threads SET active_run_id=NULL WHERE id=? AND active_run_id=?').run(run.threadId, runId);
      this.changed(run, 'revise'); this.event(run, 'run.revised', {});
      return this.readRun(runId);
    });
  }
  events(threadId: string, ownerId: string, after = 0, limit = 100): AgentEvent[] {
    const thread = this.db.prepare('SELECT id FROM agent_threads WHERE id=? AND owner_id=?').get(threadId, ownerId);
    if (!thread) throw new AgentError('THREAD_NOT_FOUND', '会话不存在', 404);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AgentError('INVALID_CURSOR', '事件游标或数量无效', 400);
    return (this.db.prepare('SELECT * FROM agent_events WHERE thread_id=? AND seq>? ORDER BY seq LIMIT ?').all(threadId, after, limit) as any[])
      .map(row => ({ threadId: row.thread_id, seq: row.seq, runId: row.run_id, type: row.type, data: JSON.parse(row.data_json) }));
  }
}
