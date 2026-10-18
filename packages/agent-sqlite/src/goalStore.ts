import { randomUUID } from 'node:crypto';
import { AgentError, ExecutionInvalidated, ExecutionSuspended, assertSamePayload, hashValue, stableJson, type AgentRun, type Decision, type DecisionReceipt, type ExecutionToken, type ExecutionTurn, type GoalAcceptance, type GoalAnswerInput, type GoalAuthorAnswer, type GoalQuestion, type GoalContinueCommand, type GoalExecution, type GoalReceipt, type GoalRevision, type GoalRevisionCommand, type GoalRevisionInput, type GoalSnapshot, type GoalStorePort, type ManualRunBinding, type ModelRequest, type Observation, type PlanRevision, type ProgressComparison, type RunLink, type Sampling, type SamplingPreparation } from '../../agent-core/src';
import { AgentSqliteStore } from './store';
import { SqliteBudgetStore } from './budgetStore';
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const terminal = (run: AgentRun) => ['SUCCEEDED','PARTIAL','FAILED','CANCELED'].includes(run.status);

/** Domain-neutral durable goal state. All compound mutations share the same
 * SQLite connection/transaction with the scheduler and host writer participant. */
export class SqliteGoalStore implements GoalStorePort {
  constructor(readonly store: AgentSqliteStore, readonly budgets: SqliteBudgetStore, private readonly verifyCompletion?: (run: AgentRun, proof: unknown) => void, private readonly decisionGuard?: (request: ModelRequest, run: AgentRun, phase: 'CONSUME' | 'VIEW') => void) {
    store.addLifecycleParticipant({ canClaim: run => {
      const link = this.link(run.id);
      if (link?.role !== 'GOAL_CONTROLLER') return true;
      const goal = this.read(link.goalId!, run.ownerId);
      return goal.activeRunId === run.id && goal.activeRevision === link.goalRevision;
    }, transition: (previous, next) => this.transition(previous, next) });
    store.setBudgetAccounting({ bound: runId => this.link(runId) !== null,
      timeAvailable: runId => { const link = this.link(runId); return !link || budgets.timeAvailable(link.budgetId); },
      activity: (runId, ownerKey, until, now, renew) => { const link = this.link(runId); if (link) budgets.activity(link.budgetId, runId, ownerKey, until, now, renew); },
      stopActivity: (runId, now) => { const link = this.link(runId); if (link) budgets.stopActivity(link.budgetId, runId, now); },
      guardDecision: (run, callId, phase) => {
        const sampling = this.decisionForCall(run.id, run.generation, callId); if (!sampling) return;
        this.guardSampling(sampling, run, phase);
      },
      reserve: (run, kind, operationId, callId) => {
      const link = this.link(run.id); if (!link) return true;
      if (kind === 'INVOCATION' && link.goalId) this.assertNoUnknown(link.goalId);
      if (kind === 'TOOL' && link.role === 'GOAL_CONTROLLER') {
        const row = this.store.db.prepare('SELECT data_json FROM agent_samplings WHERE call_id=? AND run_id=? AND generation=?').get(callId ?? '', run.id, run.generation) as any;
        const sampling: Sampling | null = row ? JSON.parse(row.data_json) : null;
        if (!sampling?.acceptedDecision || sampling.acceptedDecision.consumed || sampling.turnId !== link.activeTurnId) throw new AgentError('GOAL_CALL_NOT_ACCEPTED', '工具调用没有对应当前已接受决策');
      }
      return this.budgets.tryReserve({ budgetId: link.budgetId, kind, operationId });
    }, attempt: (runId, invocationId, attemptId) => {
      const link = this.link(runId); if (link) this.budgets.recordAttempt({ budgetId: link.budgetId, invocationId, attemptId });
    }, usage: (runId, attemptId, result) => {
      const link = this.link(runId); if (link) this.budgets.recordUsage({ budgetId: link.budgetId, attemptId, usage: result.validationErrors?.length ? {} : result.usage });
    } });
  }
  ensureSchema() {
    this.budgets.ensureSchema();
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_goals(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,thread_id TEXT NOT NULL,scope_id TEXT NOT NULL,version INTEGER NOT NULL,active_revision INTEGER NOT NULL,active_run_id TEXT,last_run_id TEXT NOT NULL,budget_id TEXT NOT NULL,no_progress_streak INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS agent_goal_revisions(goal_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(goal_id,revision));
      CREATE TABLE IF NOT EXISTS agent_run_links(run_id TEXT PRIMARY KEY,goal_id TEXT,goal_revision INTEGER,role TEXT NOT NULL,data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_execution_turns(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,ordinal INTEGER NOT NULL,data_json TEXT NOT NULL,UNIQUE(run_id,ordinal));
      CREATE TABLE IF NOT EXISTS agent_samplings(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,turn_id TEXT NOT NULL,idx INTEGER NOT NULL,generation INTEGER NOT NULL,input_hash TEXT NOT NULL,decision_id TEXT UNIQUE,call_id TEXT UNIQUE,data_json TEXT NOT NULL,progress_json TEXT,UNIQUE(turn_id,idx));
      CREATE TABLE IF NOT EXISTS agent_plan_revisions(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL,UNIQUE(goal_id,revision));
      CREATE TABLE IF NOT EXISTS agent_goal_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,receipt_json TEXT NOT NULL,PRIMARY KEY(owner_id,request_id));
    `);
  }
  link(runId: string): RunLink | null {
    const row = this.store.db.prepare('SELECT data_json FROM agent_run_links WHERE run_id=?').get(runId) as any;
    if (!row) return null;
    const link: RunLink = JSON.parse(row.data_json);
    if (link.goalId) link.noProgressStreak = (this.store.db.prepare('SELECT no_progress_streak FROM agent_goals WHERE id=?').get(link.goalId) as any)?.no_progress_streak ?? 0;
    return link;
  }
  readRunLink(runId: string) { return this.link(runId); }
  /** Read-only progress evidence for the current controller after an effect
   * commits and before consumeReceipt advances the decision pointer. This is
   * not a history source and never exposes an uncommitted proposal as a fact. */
  readPendingCommittedStep(token:ExecutionToken){
    const execution=this.execution(token);if(!execution.link.activeTurnId)return null;
    const turn=this.turn(execution.link.activeTurnId),sampling=this.readSampling(turn.id,turn.nextDecisionIndex),accepted=sampling?.acceptedDecision;
    if(!sampling||!accepted||accepted.consumed||accepted.decision.kind!=='CALL'||!accepted.callId)return null;
    const step=this.store.getStep(token.runId,token.inputRevision,accepted.callId);if(!step||step.status!=='COMMITTED'||!step.observation)return null;
    const decision=accepted.decision,{preparedDigest,...prepared}=step.prepared;
    if(step.requestHash!==hashValue({capabilityId:decision.capabilityId,capabilityVersion:decision.capabilityVersion,input:decision.arguments,callId:accepted.callId})||
      preparedDigest!==hashValue(prepared)||step.prepared.inputDigest!==hashValue(step.prepared.request.input)||step.prepared.request.capabilityId!==decision.capabilityId||
      step.prepared.request.capabilityVersion!==decision.capabilityVersion||step.prepared.binding.ownerId!==execution.run.ownerId||step.prepared.binding.commandRevision!==String(token.inputRevision))throw new AgentError('GOAL_PROGRESS_INVALID','当前已提交事实与接受的决策不一致');
    this.guardSampling(sampling,execution.run,'VIEW');return structuredClone(step);
  }
  /** Domain repair rounds reserve inside the same transaction as their effect.
   * false means no new repair may be dispatched; the host reports PARTIAL. */
  reserveRepair(token: ExecutionToken, operationId: string): boolean {
    return this.store.atomic(() => { this.store.assertExecution(token); const link = this.link(token.runId); if (!link) throw new AgentError('GOAL_BINDING_INVALID', '返修缺少委托预算'); return this.budgets.tryReserve({ budgetId: link.budgetId, kind: 'REPAIR', operationId }); });
  }
  private saveLink(link: RunLink) { this.store.db.prepare('INSERT INTO agent_run_links VALUES(?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET goal_revision=excluded.goal_revision,data_json=excluded.data_json').run(link.runId, link.goalId, link.goalRevision, link.role, stableJson(link)); }
  read(goalId: string, ownerId: string): GoalSnapshot {
    const row = this.store.db.prepare('SELECT * FROM agent_goals WHERE id=? AND owner_id=?').get(goalId, ownerId) as any;
    if (!row) throw new AgentError('GOAL_NOT_FOUND', '委托不存在或不属于当前作者', 404);
    const revision = JSON.parse((this.store.db.prepare('SELECT data_json FROM agent_goal_revisions WHERE goal_id=? AND revision=?').get(goalId, row.active_revision) as any).data_json);
    return { id: goalId, ownerId, threadId: row.thread_id, scopeId: row.scope_id, version: row.version, activeRevision: row.active_revision, activeRunId: row.active_run_id, revision };
  }
  /** Only the last consumed ASK of the live controller may solicit an answer.
   * Source checks are VIEW checks: an author edit may advance CURRENT, while
   * withdrawal must still hide the question and reject its answer. */
  pendingQuestion(goalId: string, ownerId: string): GoalQuestion | null {
    return this.store.atomic(() => {
      const goal = this.read(goalId, ownerId);
      if (!goal.activeRunId) return null;
      const run = this.store.readRun(goal.activeRunId, ownerId), link = this.link(run.id);
      if (!['WAITING_INPUT','PAUSED'].includes(run.status) || !link?.activeTurnId || link.goalRevision !== goal.activeRevision) return null;
      const turn = this.turn(link.activeTurnId);
      if (turn.state !== 'WAITING_INPUT' || turn.inputGeneration !== run.generation || turn.nextDecisionIndex < 1) return null;
      const sampling = this.readSampling(turn.id, turn.nextDecisionIndex - 1), receipt = sampling?.acceptedDecision;
      if (!sampling || !receipt?.consumed || receipt.decision.kind !== 'ASK') return null;
      this.guardSampling(sampling, run, 'VIEW');
      return { decisionId: receipt.id, runId: run.id, goalRevision: goal.activeRevision,
        message: receipt.decision.message, choices: structuredClone(receipt.decision.choices) };
    });
  }
  checkedAnswer(goalId: string, ownerId: string, answer: GoalAnswerInput): GoalAuthorAnswer {
    const question = this.pendingQuestion(goalId, ownerId);
    if (!question || question.decisionId !== answer.decisionId)
      throw new AgentError('GOAL_ANSWER_STALE', '这个问题已不再等待回答，请读取当前委托', 409);
    if (typeof answer.text !== 'string' || !answer.text.trim() || answer.text.length > 20000 ||
      Object.keys(answer).some(key => !['decisionId','text','choiceId'].includes(key)))
      throw new AgentError('GOAL_ANSWER_INVALID', '请填写有效的作者回答', 400);
    if (answer.choiceId !== undefined && !question.choices.some(choice => choice.id === answer.choiceId && choice.text === answer.text))
      throw new AgentError('GOAL_ANSWER_INVALID', '所选答案与本次问题不一致', 400);
    // Only the author's explicit text is carried forward. The model's old
    // question and prompt remain in their original protected sampling record.
    return { decisionId: question.decisionId, runId: question.runId, goalRevision: question.goalRevision,
      text: answer.text, ...(answer.choiceId !== undefined ? { choiceId: answer.choiceId } : {}) };
  }
  private validate(input: GoalRevisionInput) {
    if (!input.objective?.trim() || !input.authorizationRef || !input.workspaceRef?.uri || !input.workspaceRef.version || !input.workspaceRef.contentHash || !input.workspaceRef.branch || !Array.isArray(input.sourceRefs) || !input.contract?.pluginId || !input.contract.version || input.contract.digest !== hashValue(input.contract.value) || !['api','external'].includes(input.route?.channel) || !input.route.routeRef || !['CONTRACT_COMPLETE','WAIT_FOR_AUTHOR'].includes(input.stopPolicy) || !input.turnLimits || Object.values(input.turnLimits).length !== 2 || Object.values(input.turnLimits).some(value => !Number.isSafeInteger(value) || value < 1 || value > 1000)) throw new AgentError('INVALID_GOAL', '委托缺少冻结范围、完成约定、授权或有界回合', 400);
    stableJson(input);
    if (Object.keys(input.turnLimits).sort().join() !== 'maxDecisions,maxToolCalls' || input.sourceRefs.some(ref => !ref || !ref.uri || !ref.version || !ref.contentHash || !ref.branch)) throw new AgentError('INVALID_GOAL', '回合限制或来源引用无效', 400);
  }
  /** Replay identity is the original author envelope, not today's resolved Skill/config. */
  received(ownerId: string, requestId: string, requestEnvelope: unknown): GoalReceipt | null {
    if (!ownerId || !requestId || requestId.length > 200) throw new AgentError('INVALID_GOAL_COMMAND', '委托命令缺少作者或幂等身份', 400);
    const row = this.store.db.prepare('SELECT * FROM agent_goal_commands WHERE owner_id=? AND request_id=?').get(ownerId, requestId) as any;
    if (!row) return null;
    assertSamePayload(row.payload_hash, hashValue(requestEnvelope)); return JSON.parse(row.receipt_json);
  }
  private receipt(goal: GoalSnapshot, runId: string): GoalReceipt { return { goalId: goal.id, goalRevision: goal.activeRevision, runId, threadId: goal.threadId, budgetId: goal.revision.budgetId, workspaceRef: goal.revision.workspaceRef }; }
  private command(ownerId: string, requestId: string, envelope: unknown, receipt: GoalReceipt) { this.store.db.prepare('INSERT INTO agent_goal_commands VALUES(?,?,?,?)').run(ownerId, requestId, hashValue(envelope), stableJson(receipt)); }
  private revision(input: GoalRevisionInput, goalId: string, revision: number, requestId: string, budgetId: string): GoalRevision {
    // Explicit projection prevents envelope/config and credentials leaking into a revision.
    const { objective, contract, authorizationRef, workspaceRef, sourceRefs, skillManifest, route, stopPolicy, turnLimits, authorAnswers } = input;
    return { objective, contract, authorizationRef, workspaceRef, sourceRefs, skillManifest, route, stopPolicy, turnLimits, ...(authorAnswers?.length ? { authorAnswers: structuredClone(authorAnswers) } : {}), goalId, revision, authorCommandId: requestId, budgetId, supersedesRevision: revision === 1 ? null : revision - 1 };
  }
  private insertRevision(revision: GoalRevision) { this.store.db.prepare('INSERT INTO agent_goal_revisions VALUES(?,?,?)').run(revision.goalId, revision.revision, stableJson(revision)); }
  private bind(runId: string, revision: GoalRevision, role: RunLink['role'] = 'GOAL_CONTROLLER') {
    this.saveLink({ runId, goalId: revision.goalId, goalRevision: revision.revision, role, workspaceRef: revision.workspaceRef, authorizationRef: revision.authorizationRef, budgetId: revision.budgetId, activeTurnId: null, activePlanRef: null, noProgressStreak: 0, lastFeedback: [] });
  }
  accept(input: GoalAcceptance): GoalReceipt {
    return this.store.atomic(() => {
      const replay = this.received(input.ownerId, input.requestId, input.requestEnvelope);
      if (replay) { if (this.read(replay.goalId, input.ownerId).scopeId !== input.scopeId) throw new AgentError('IDEMPOTENCY_CONFLICT', '同一委托命令不能更换范围'); return replay; }
      this.validate(input);
      const goalId = id('goal'), budgetId = id('budget');
      this.budgets.create({ ownerId: input.ownerId, budgetId, limits: input.budgetLimits });
      const accepted = this.store.accept({ requestId: `goal:${input.requestId}`, ...(input.threadId ? { threadId: input.threadId } : {}), ownerId: input.ownerId, scopeId: input.scopeId, kind: 'GOAL', input: { goalId }, policyRevision: input.policyRevision, maxInvocations: Math.min(input.budgetLimits.maxInvocations, 10000) });
      const revision = this.revision(input, goalId, 1, input.requestId, budgetId); this.insertRevision(revision);
      this.store.db.prepare('INSERT INTO agent_goals(id,owner_id,thread_id,scope_id,version,active_revision,active_run_id,last_run_id,budget_id) VALUES(?,?,?,?,1,1,?,?,?)').run(goalId, input.ownerId, accepted.threadId, input.scopeId, accepted.runId, accepted.runId, budgetId);
      this.bind(accepted.runId, revision);
      const receipt = this.receipt(this.read(goalId, input.ownerId), accepted.runId); this.command(input.ownerId, input.requestId, input.requestEnvelope, receipt); return receipt;
    });
  }
  private assertNoUnknown(goalId: string) {
    if (!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_invocations'").get()) return;
    if (this.store.db.prepare("SELECT 1 FROM agent_invocations i JOIN agent_run_links l ON l.run_id=i.run_id WHERE l.goal_id=? AND i.status IN ('SENT','UNKNOWN') LIMIT 1").get(goalId)) throw new AgentError('RECONCILIATION_REQUIRED', '先核对已发送而结果未知的请求，不能换回合绕过');
  }
  private retireRequests(runId: string) {
    if (!this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_invocations'").get()) return;
    this.store.db.prepare("UPDATE agent_external_requests SET status='SUPERSEDED' WHERE invocation_id IN (SELECT id FROM agent_invocations WHERE run_id=? AND status IN ('PREPARED','WAITING_EXTERNAL'))").run(runId);
    this.store.db.prepare("UPDATE agent_invocations SET status='SUPERSEDED' WHERE run_id=? AND status IN ('PREPARED','WAITING_EXTERNAL')").run(runId);
  }
  private retirePendingReceived(run: AgentRun, nextRevision: number) {
    const row=this.store.db.prepare('SELECT data_json FROM agent_execution_turns WHERE run_id=? ORDER BY ordinal DESC LIMIT 1').get(run.id) as {data_json:string}|undefined;
    if(!row)return;
    const turn=JSON.parse(row.data_json) as ExecutionTurn;
    const sampling=this.readSampling(turn.id,turn.nextDecisionIndex);
    if(!sampling||sampling.acceptedDecision?.consumed)return;
    const accepted=sampling.acceptedDecision;
    const step=accepted?.decision.kind==='CALL'&&accepted.callId?this.store.getStep(run.id,run.generation,accepted.callId):null;
    // An unacknowledged COMMITTED step is already a domain fact. Its received
    // model evidence remains a valid source even when its coordinator rebases.
    if(step?.status==='COMMITTED')return;
    const rows=step
      ?this.store.db.prepare("SELECT id FROM agent_invocations WHERE run_id=? AND input_revision=? AND owner_key=? AND status='RECEIVED'").all(run.id,run.generation,step.id) as Array<{id:string}>
      :!accepted?this.store.db.prepare("SELECT id FROM agent_invocations WHERE run_id=? AND input_revision=? AND owner_key='run' AND operation_key IN (?,?) AND status='RECEIVED'").all(run.id,run.generation,sampling.modelRequest.operationKey,`${sampling.modelRequest.operationKey}:format-correction`) as Array<{id:string}>:[];
    if(!rows.length)return;
    for(const {id:invocationId} of rows){
      this.store.db.prepare("UPDATE agent_invocations SET status='SUPERSEDED' WHERE id=? AND status='RECEIVED'").run(invocationId);
      this.store.db.prepare("UPDATE agent_external_requests SET status='SUPERSEDED' WHERE invocation_id=? AND status='RECEIVED'").run(invocationId);
    }
    this.store.recordSystemEvent(run.id,'goal.received_result_rebased',{invocationIds:rows.map(item=>item.id),fromGeneration:run.generation,toGoalRevision:nextRevision,reason:run.reason});
  }
  revise(input: GoalRevisionCommand): GoalReceipt { return this.transitionGoal(input, true); }
  continue(input: GoalContinueCommand): GoalReceipt { return this.transitionGoal(input, false); }
  /** Reopen a budget-stopped run instead of creating a successor over its
   * frozen, possibly already received model result. No revision is signed. */
  recoverBudgetStopped(input: GoalContinueCommand): GoalReceipt {
    return this.store.atomic(() => {
      const replay=this.received(input.ownerId,input.requestId,input.requestEnvelope);
      if(replay){if(replay.goalId!==input.goalId)throw new AgentError('IDEMPOTENCY_CONFLICT','同一命令不能更换目标');return replay;}
      if(input.revision)throw new AgentError('BUDGET_RECOVERY_INVALID','预算恢复不能同时更换冻结委托');
      const goal=this.read(input.goalId,input.ownerId);
      if(goal.version!==input.expectedVersion||goal.activeRunId)throw new AgentError('GOAL_VERSION_CONFLICT','委托已更新');
      const lastId=(this.store.db.prepare('SELECT last_run_id FROM agent_goals WHERE id=?').get(goal.id) as {last_run_id:string}).last_run_id;
      const run=this.store.readRun(lastId,input.ownerId);
      if(run.version!==input.expectedRunVersion)throw new AgentError('RUN_VERSION_CONFLICT','执行状态已更新');
      if(run.status!=='PARTIAL'||run.reason!=='BUDGET_EXHAUSTED')throw new AgentError('BUDGET_RECOVERY_INVALID','原运行不是预算中止状态');
      const link=this.link(run.id);
      if(!link||link.role!=='GOAL_CONTROLLER'||link.goalId!==goal.id||link.goalRevision!==goal.activeRevision)
        throw new AgentError('GOAL_BINDING_INVALID','原运行不属于当前委托版本');
      this.assertNoUnknown(goal.id);
      const row=this.store.db.prepare('SELECT data_json FROM agent_execution_turns WHERE run_id=? ORDER BY ordinal DESC LIMIT 1').get(run.id) as {data_json:string}|undefined;
      const turn=row?JSON.parse(row.data_json) as ExecutionTurn:null;
      if(turn&&turn.inputGeneration!==run.generation)throw new AgentError('BUDGET_RECOVERY_INVALID','冻结回合与原输入版本不同');
      const sampling=turn?this.readSampling(turn.id,turn.nextDecisionIndex):null;
      if(sampling?.acceptedDecision?.consumed)throw new AgentError('BUDGET_RECOVERY_INVALID','已消费的决策不能再次执行');
      const call=sampling?.acceptedDecision;
      const step=call?.decision.kind==='CALL'&&call.callId?this.store.getStep(run.id,run.generation,call.callId):null;
      const lease=step?this.store.db.prepare('SELECT status FROM agent_step_leases WHERE step_id=? AND run_id=?').get(step.id,run.id) as {status:string}|undefined:undefined;
      // INLINE steps have no child lease. A durable step may also have been
      // frozen immediately before handoff. Both resume on the original parent.
      if(step&&(!['PREPARED','COMMITTED'].includes(step.status)||lease&&!['CANCELED','COMPLETED'].includes(lease.status)))
        throw new AgentError('BUDGET_RECOVERY_INVALID','原步骤状态不能安全恢复');
      if(step&&lease?.status==='COMPLETED'&&step.status!=='COMMITTED')throw new AgentError('BUDGET_RECOVERY_INVALID','原步骤完成回执缺失');
      const stepId=step&&lease?.status==='CANCELED'?step.id:null;
      if(stepId&&(!turn||turn.pendingDecisionId!==call?.id||link.activeTurnId))
        throw new AgentError('BUDGET_RECOVERY_INVALID','子步骤与当前决策指针不一致');
      // The scheduler and Goal pointer are restored in one transaction. A new
      // fence prevents a pre-halt worker from committing after this point.
      this.store.db.prepare('UPDATE agent_goals SET active_run_id=?,version=version+1 WHERE id=?').run(run.id,goal.id);
      this.store.recoverBudgetStopped(run.id,input.ownerId,run.version,stepId);
      if(turn&&turn.state==='CLOSED'){
        turn.state=turn.pendingDecisionId?'WAITING_TOOL':'OPEN';
        this.saveTurn(turn);link.activeTurnId=turn.id;this.saveLink(link);
      }else if(stepId)throw new AgentError('BUDGET_RECOVERY_INVALID','原回合未能恢复');
      const receipt=this.receipt(this.read(goal.id,input.ownerId),run.id);
      this.command(input.ownerId,input.requestId,input.requestEnvelope,receipt);
      return receipt;
    });
  }
  recoverLeaseStall(input: GoalContinueCommand): GoalReceipt {
    return this.store.atomic(()=>{
      const replay=this.received(input.ownerId,input.requestId,input.requestEnvelope);
      if(replay){if(replay.goalId!==input.goalId)throw new AgentError('IDEMPOTENCY_CONFLICT','同一命令不能更换目标');return replay;}
      if(input.revision)throw new AgentError('LEASE_STALL_RECOVERY_INVALID','失租恢复不能同时更换冻结委托');
      const goal=this.read(input.goalId,input.ownerId);
      if(goal.version!==input.expectedVersion||!goal.activeRunId)throw new AgentError('GOAL_VERSION_CONFLICT','委托已更新');
      const run=this.store.readRun(goal.activeRunId,input.ownerId);
      if(run.version!==input.expectedRunVersion)throw new AgentError('RUN_VERSION_CONFLICT','执行状态已更新');
      if(!['NEEDS_REBASE','PAUSED'].includes(run.status)||!['LEASE_STALL_LIMIT','CONTEXT_VALIDATION_LIMIT'].includes(run.reason??''))throw new AgentError('LEASE_STALL_RECOVERY_INVALID','原运行不是可重试的同步校验停机状态');
      const link=this.link(run.id);
      if(!link||link.role!=='GOAL_CONTROLLER'||link.goalId!==goal.id||link.goalRevision!==goal.activeRevision)
        throw new AgentError('GOAL_BINDING_INVALID','原运行不属于当前委托版本');
      this.assertNoUnknown(goal.id);
      if(run.activeStepId){
        if(!link.activeTurnId)throw new AgentError('LEASE_STALL_RECOVERY_INVALID','子步骤没有可恢复的原回合');
        const turn=this.turn(link.activeTurnId),sampling=this.readSampling(turn.id,turn.nextDecisionIndex),call=sampling?.acceptedDecision;
        const step=call?.decision.kind==='CALL'&&call.callId?this.store.getStep(run.id,run.generation,call.callId):null;
        if(turn.inputGeneration!==run.generation||turn.pendingDecisionId!==call?.id||step?.id!==run.activeStepId||call?.consumed)
          throw new AgentError('LEASE_STALL_RECOVERY_INVALID','子步骤与原冻结决策不一致');
      }
      this.store.db.prepare('UPDATE agent_goals SET version=version+1 WHERE id=?').run(goal.id);
      this.store.recoverLeaseStall(run.id,input.ownerId,run.version,run.activeStepId);
      const receipt=this.receipt(this.read(goal.id,input.ownerId),run.id);
      this.command(input.ownerId,input.requestId,input.requestEnvelope,receipt);
      return receipt;
    });
  }
  private transitionGoal(input: GoalContinueCommand, authorRevised: boolean): GoalReceipt {
    return this.store.atomic(() => {
      const replay = this.received(input.ownerId, input.requestId, input.requestEnvelope);
      if (replay) { if (replay.goalId !== input.goalId) throw new AgentError('IDEMPOTENCY_CONFLICT', '同一委托命令不能更换目标'); return replay; }
      const goal = this.read(input.goalId, input.ownerId);
      if (goal.version !== input.expectedVersion) throw new AgentError('GOAL_VERSION_CONFLICT', '委托已更新');
      const lastId = (this.store.db.prepare('SELECT last_run_id FROM agent_goals WHERE id=?').get(goal.id) as any).last_run_id;
      const run = this.store.readRun(goal.activeRunId ?? lastId, input.ownerId);
      if (run.version !== input.expectedRunVersion) throw new AgentError('RUN_VERSION_CONFLICT', '执行状态已更新');
      const answer = input.answer ? this.checkedAnswer(goal.id, input.ownerId, input.answer) : null;
      if (!authorRevised && !answer && (run.status === 'WAITING_INPUT' || this.pendingQuestion(goal.id, input.ownerId)))
        throw new AgentError('GOAL_ANSWER_REQUIRED', '请先回答 Agent 当前的问题，再继续委托', 409);
      if(!authorRevised&&run.status==='PARTIAL'&&run.reason==='BUDGET_EXHAUSTED')
        throw new AgentError('BUDGET_RECOVERY_REQUIRED','预算中止须先接回原运行，不能新建运行绕过已接收结果');
      if(!authorRevised&&['LEASE_STALL_LIMIT','CONTEXT_VALIDATION_LIMIT'].includes(run.reason??''))
        throw new AgentError('LEASE_STALL_RECOVERY_REQUIRED','同步校验停机须先接回原冻结步骤，不能重签绕过已接收结果');
      this.assertNoUnknown(goal.id);
      let runId = run.id;
      if (terminal(run) || input.revision || answer) {
        const source = { ...(input.revision ?? goal.revision), authorAnswers: [...(goal.revision.authorAnswers ?? []), ...(answer ? [answer] : [])] }; this.validate(source);
        if (source.workspaceRef.uri !== goal.revision.workspaceRef.uri || source.workspaceRef.branch !== goal.revision.workspaceRef.branch) throw new AgentError('GOAL_WORKSPACE_MISMATCH', '修改目标不能暗中换用另一份工作稿');
        const revision = this.revision(source, goal.id, goal.activeRevision + 1, input.requestId, goal.revision.budgetId); this.insertRevision(revision);
        if(run.status==='NEEDS_REBASE'||run.status==='PARTIAL'&&run.reason==='BUDGET_EXHAUSTED'||run.reason==='LEASE_STALL_LIMIT')this.retirePendingReceived(run,revision.revision);
        if (terminal(run)) {
          const budget = this.budgets.read(revision.budgetId, input.ownerId);
          runId = this.store.accept({ requestId: `goal:${input.requestId}`, threadId: goal.threadId, ownerId: goal.ownerId, scopeId: goal.scopeId, kind: 'GOAL', input: { goalId: goal.id }, policyRevision: run.policyRevision, maxInvocations: Math.min(budget.limits.maxInvocations, 10000) }).runId;
        } else { this.retireRequests(run.id); this.store.reviseInput(run.id, run.ownerId, run.version); }
        this.bind(runId, revision);
        this.store.db.prepare('UPDATE agent_goals SET active_revision=?,active_run_id=?,last_run_id=?,version=version+1 WHERE id=?').run(revision.revision, runId, runId, goal.id);
        // Re-signing an authorization creates a revision without changing the
        // author's goal. Only an explicit, materially changed revise may reset
        // the stop bound. The shared budget ledger never resets.
        if(authorRevised){
          if(!input.revision || input.revision.objective===goal.revision.objective &&
            input.revision.contract.digest===goal.revision.contract.digest &&
            hashValue(input.revision.sourceRefs)===hashValue(goal.revision.sourceRefs) &&
            hashValue(input.revision.skillManifest)===hashValue(goal.revision.skillManifest) &&
            hashValue(input.revision.route)===hashValue(goal.revision.route))
            throw new AgentError('GOAL_REVISION_UNCHANGED','作者修订没有改变目标、来源或方法',400);
          this.store.db.prepare('UPDATE agent_goals SET no_progress_streak=0 WHERE id=?').run(goal.id);
        }
      } else {
        this.store.control(run.id, run.ownerId, run.version, 'resume', `goal:${input.requestId}`);
        this.store.db.prepare('UPDATE agent_goals SET version=version+1 WHERE id=?').run(goal.id);
      }
      const receipt = this.receipt(this.read(goal.id, goal.ownerId), runId); this.command(input.ownerId, input.requestId, input.requestEnvelope, receipt); return receipt;
    });
  }
  attachManualRun(input: ManualRunBinding): RunLink {
    return this.store.atomic(() => {
      const goal = this.read(input.goalId, input.ownerId), run = this.store.readRun(input.runId, input.ownerId);
      const commandAuthorization = (run.input as { authorizationRef?: string } | null)?.authorizationRef;
      const authorizationRef = input.authorizationRef ?? commandAuthorization ?? goal.revision.authorizationRef;
      const workspaceRef = input.workspaceRef ?? goal.revision.workspaceRef;
      if (!authorizationRef || commandAuthorization && commandAuthorization !== authorizationRef || workspaceRef.uri !== goal.revision.workspaceRef.uri || workspaceRef.branch !== goal.revision.workspaceRef.branch || !workspaceRef.version || !workspaceRef.contentHash) throw new AgentError('MANUAL_BINDING_CONFLICT', '手动授权或工作稿身份不匹配');
      if (goal.version !== input.expectedGoalVersion || run.scopeId !== goal.scopeId || run.status !== 'QUEUED') throw new AgentError('MANUAL_BINDING_CONFLICT', '手动任务范围或目标版本已改变');
      if (goal.activeRunId && !['PAUSED','WAITING_INPUT','NEEDS_REBASE'].includes(this.store.readRun(goal.activeRunId).status)) throw new AgentError('GOAL_STILL_ACTIVE', '先暂停委托再由作者接管');
      const old = this.link(run.id); if (old) { if (old.goalId !== goal.id || old.role !== 'MANUAL_STEP' || old.goalRevision !== goal.activeRevision || old.authorizationRef !== authorizationRef || hashValue(old.workspaceRef) !== hashValue(workspaceRef)) throw new AgentError('MANUAL_BINDING_CONFLICT', '手动任务已绑定其他委托、授权或稿件版本'); return old; }
      this.bind(run.id, goal.revision, 'MANUAL_STEP'); const link = this.link(run.id)!; link.authorizationRef = authorizationRef; link.workspaceRef = workspaceRef; this.saveLink(link); return link;
    });
  }
  execution(token: ExecutionToken): GoalExecution {
    const run = this.store.assertExecution(token), link = this.link(run.id);
    if (!link?.goalId || link.role !== 'GOAL_CONTROLLER') throw new AgentError('GOAL_BINDING_INVALID', '运行不是委托协调者');
    const goal = this.read(link.goalId, run.ownerId);
    if (goal.activeRevision !== link.goalRevision || goal.activeRunId !== run.id) throw new AgentError('GOAL_BINDING_INVALID', '运行已经不属于当前目标版本');
    return { token: {...token}, run, link, goal, revision: goal.revision, budget: this.budgets.read(link.budgetId, run.ownerId) };
  }
  private turn(id: string): ExecutionTurn {
    const row = this.store.db.prepare('SELECT data_json FROM agent_execution_turns WHERE id=?').get(id) as any;
    if (!row) throw new AgentError('TURN_NOT_FOUND', '执行回合不存在'); return JSON.parse(row.data_json);
  }
  private saveTurn(turn: ExecutionTurn) { this.store.db.prepare('INSERT INTO agent_execution_turns VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json').run(turn.id, turn.runId, turn.ordinal, stableJson(turn)); }
  private transition(previous: AgentRun, next: AgentRun) {
    const link = this.link(next.id); if (!link?.goalId || link.role !== 'GOAL_CONTROLLER') return;
    if (link.activeTurnId) {
      const turn = this.turn(link.activeTurnId);
      if (turn.state === 'WAITING_INPUT' && next.status === 'QUEUED' && next.generation === previous.generation)
        throw new AgentError('GOAL_ANSWER_REQUIRED', '请通过当前问题提交回答，不能直接恢复绕过作者决定', 409);
      if (next.generation !== previous.generation || terminal(next)) {
        turn.state = terminal(next) ? 'CLOSED' : 'SUPERSEDED'; this.saveTurn(turn); link.activeTurnId = null; this.saveLink(link);
      } else if (next.status === 'WAITING_INPUT') { turn.state = 'WAITING_INPUT'; this.saveTurn(turn); }
      else if (next.status === 'RUNNING' && turn.state === 'WAITING_INPUT') { turn.state = turn.pendingDecisionId ? 'WAITING_TOOL' : 'OPEN'; this.saveTurn(turn); }
    }
    if (terminal(next)) this.store.db.prepare('UPDATE agent_goals SET active_run_id=NULL,version=version+1 WHERE id=? AND active_run_id=?').run(link.goalId, next.id);
  }
  openTurn(token: ExecutionToken): ExecutionTurn {
    const result = this.store.atomic(() => {
      const execution = this.execution(token), { link, run } = execution;
      if (token.leaseKind === 'step') throw new AgentError('GOAL_COORDINATOR_REQUIRED', '子步骤不能选择下一步');
      if (link.activeTurnId) return this.turn(link.activeTurnId);
      const ordinal = (this.store.db.prepare('SELECT coalesce(max(ordinal),0)+1 n FROM agent_execution_turns WHERE run_id=?').get(run.id) as any).n;
      if (!this.budgets.tryReserve({ budgetId: link.budgetId, kind: 'TURN', operationId: `${run.id}:${ordinal}` })) { this.store.finish(token, 'PARTIAL', { remainingWork: ['委托执行回合总预算已用尽'] }, 'BUDGET_EXHAUSTED'); return null; }
      const turn: ExecutionTurn = { id: id('turn'), runId: run.id, ordinal, inputGeneration: run.generation, source: ordinal === 1 ? 'AUTHOR_COMMAND' : 'CONTINUATION', sourceCommandId: ordinal === 1 ? execution.revision.authorCommandId : null, planRef: link.activePlanRef, state: 'OPEN', nextDecisionIndex: 0, decisionsUsed: 0, toolsUsed: 0, pendingDecisionId: null, limits: execution.revision.turnLimits };
      this.saveTurn(turn); link.activeTurnId = turn.id; this.saveLink(link);
      this.store.recordSystemEvent(run.id,'goal.turn_opened',{turnId:turn.id,ordinal});
      return turn;
    });
    if (!result) throw new ExecutionSuspended('BUDGET_EXHAUSTED', '委托执行回合总预算已用尽'); return result;
  }
  readSampling(turnId: string, index: number): Sampling | null { const row = this.store.db.prepare('SELECT data_json FROM agent_samplings WHERE turn_id=? AND idx=?').get(turnId,index) as any; return row ? JSON.parse(row.data_json) : null; }
  decisionForCall(runId: string, generation: number, callId: string): Sampling | null {
    const row = this.store.db.prepare('SELECT data_json FROM agent_samplings WHERE run_id=? AND generation=? AND call_id=?').get(runId, generation, callId) as any;
    return row ? JSON.parse(row.data_json) : null;
  }
  private current(token: ExecutionToken, turnId: string) {
    const execution = this.execution(token), turn = this.turn(turnId);
    if (token.leaseKind === 'step' || execution.link.activeTurnId !== turnId || turn.runId !== token.runId || turn.inputGeneration !== token.inputRevision || !['OPEN','WAITING_TOOL'].includes(turn.state)) throw new AgentError('GOAL_TURN_INVALID', '执行回合不属于当前输入版本');
    return { execution, turn };
  }
  saveSampling(token: ExecutionToken, input: SamplingPreparation): Sampling {
    return this.store.atomic(() => {
      const { execution, turn } = this.current(token, input.turnId), old = this.readSampling(turn.id, input.index);
      if (old) { const row = this.store.db.prepare('SELECT input_hash FROM agent_samplings WHERE id=?').get(old.id) as any; assertSamePayload(row.input_hash, hashValue(input)); return old; }
      if (input.index !== turn.nextDecisionIndex || turn.pendingDecisionId) throw new AgentError('DECISION_POINTER_INVALID', '决策指针已改变');
      if (turn.decisionsUsed >= turn.limits.maxDecisions) throw new AgentError('TURN_DECISION_LIMIT', '本回合决策上限已到');
      if (turn.toolsUsed >= turn.limits.maxToolCalls) throw new AgentError('TURN_TOOL_LIMIT', '本回合工具上限已到');
      if (input.modelRequest.channel !== execution.revision.route.channel || input.modelRequest.routeRef !== execution.revision.route.routeRef || input.modelRequest.operationKey !== `decision:${turn.id}:${input.index}` || !input.modelRequest.prompt?.trim() || !/^[a-f0-9]{64}$/.test(input.allowedToolsDigest)) throw new AgentError('SAMPLING_INPUT_INVALID', '采样路由或输入身份不符合冻结委托');
      const sampling: Sampling = { id: id('sampling'), turnId: turn.id, index: input.index, inputGeneration: token.inputRevision, modelRequest: input.modelRequest, allowedToolsDigest: input.allowedToolsDigest, progressFingerprint: input.progressFingerprint ?? null, acceptedDecision: null };
      this.store.db.prepare('INSERT INTO agent_samplings(id,run_id,turn_id,idx,generation,input_hash,data_json) VALUES(?,?,?,?,?,?,?)').run(sampling.id, token.runId, turn.id, input.index, token.inputRevision, hashValue(input), stableJson(sampling));
      turn.decisionsUsed++; this.saveTurn(turn);
      this.store.recordSystemEvent(token.runId,'goal.sampling_saved',{samplingId:sampling.id,turnId:turn.id,index:input.index});
      return sampling;
    });
  }
  private sampling(id: string, field: 'id' | 'decision_id' = 'id'): Sampling {
    const row = this.store.db.prepare(`SELECT data_json FROM agent_samplings WHERE ${field}=?`).get(id) as any;
    if (!row) throw new AgentError('SAMPLING_NOT_FOUND', '持久决策不存在'); return JSON.parse(row.data_json);
  }
  private guardSampling(sampling: Sampling, run: AgentRun, phase: 'CONSUME' | 'VIEW') {
    try {
      if (sampling.modelRequest.contextRef && !this.decisionGuard) throw new AgentError('CONTEXT_GUARD_MISSING', '决策冻结上下文缺少宿主校验');
      this.decisionGuard?.(sampling.modelRequest, run, phase);
    } catch (error) { throw new ExecutionInvalidated(error instanceof AgentError ? error.code : 'DECISION_CONTEXT_UNAVAILABLE', error instanceof Error ? error.message : '决策来源不可用'); }
  }
  private saveSamplingRow(sampling: Sampling) { this.store.db.prepare('UPDATE agent_samplings SET data_json=?,decision_id=?,call_id=? WHERE id=?').run(stableJson(sampling), sampling.acceptedDecision?.id ?? null, sampling.acceptedDecision?.callId ?? null, sampling.id); }
  acceptDecision(token: ExecutionToken, samplingId: string, decision: Decision): DecisionReceipt {
    return this.store.atomic(() => {
      const sampling = this.sampling(samplingId), { execution, turn } = this.current(token, sampling.turnId);
      if (sampling.acceptedDecision) { assertSamePayload(hashValue(sampling.acceptedDecision.decision), hashValue(decision)); return sampling.acceptedDecision; }
      this.guardSampling(sampling, execution.run, 'CONSUME');
      this.store.assertExecution(token);
      if (!['CALL','ASK','FINISH','STOP'].includes(decision.kind) || turn.nextDecisionIndex !== sampling.index || turn.pendingDecisionId) throw new AgentError('DECISION_INVALID', '决策类型或执行指针无效');
      stableJson(decision);
      if (decision.kind === 'CALL') {
        if (!decision.capabilityId || !decision.capabilityVersion || decision.arguments === undefined) throw new AgentError('DECISION_INVALID', '工具决策缺少身份或参数');
        if (turn.toolsUsed >= turn.limits.maxToolCalls) throw new AgentError('TURN_TOOL_LIMIT', '本回合工具上限已到');
        turn.toolsUsed++;
      }
      const receipt: DecisionReceipt = { id: id('decision'), samplingId, turnId: turn.id, decision, callId: decision.kind === 'CALL' ? `call:${sampling.id}` : null, stepId: null, consumed: false };
      sampling.acceptedDecision = receipt;
      if (decision.kind === 'CALL' && decision.planUpdate) {
        const ordinal = (this.store.db.prepare('SELECT coalesce(max(revision),0)+1 n FROM agent_plan_revisions WHERE goal_id=?').get(execution.goal.id) as any).n;
        const plan: PlanRevision = { ...decision.planUpdate, id: id('plan'), goalId: execution.goal.id, goalRevision: execution.goal.activeRevision, revision: ordinal, supersedes: execution.link.activePlanRef, decisionId: receipt.id };
        this.store.db.prepare('INSERT INTO agent_plan_revisions VALUES(?,?,?,?)').run(plan.id, plan.goalId, plan.revision, stableJson(plan)); execution.link.activePlanRef = plan.id; this.saveLink(execution.link); turn.planRef = plan.id;
      }
      turn.pendingDecisionId = receipt.id; if (decision.kind === 'CALL') turn.state = 'WAITING_TOOL'; this.saveTurn(turn); this.saveSamplingRow(sampling);
      this.store.recordSystemEvent(execution.run.id, 'decision.accepted', { decisionId: receipt.id, kind: decision.kind, callId: receipt.callId });
      return receipt;
    });
  }
  linkStep(token: ExecutionToken, decisionId: string, stepId: string) {
    this.store.atomic(() => { const sampling = this.sampling(decisionId, 'decision_id'); this.current(token, sampling.turnId); const receipt = sampling.acceptedDecision!, step = this.store.getStep(token.runId, token.inputRevision, receipt.callId ?? ''); if (!step || step.id !== stepId) throw new AgentError('DECISION_STEP_MISMATCH', '步骤不属于此工具决策'); if (receipt.stepId && receipt.stepId !== stepId) throw new AgentError('DECISION_STEP_MISMATCH', '决策已绑定其他步骤'); receipt.stepId = stepId; this.saveSamplingRow(sampling); });
  }
  private consume(token: ExecutionToken, decisionId: string, call: boolean, stepId?: string, progress?: ProgressComparison): Observation | null {
    const sampling = this.sampling(decisionId, 'decision_id'), { execution, turn } = this.current(token, sampling.turnId), receipt = sampling.acceptedDecision!;
    if ((receipt.decision.kind === 'CALL') !== call) throw new AgentError('DECISION_KIND_MISMATCH', '此决策不能按指定方式消费');
    if (!call) this.guardSampling(sampling, execution.run, 'CONSUME');
    if (call) this.store.assertDecisionInput(token, receipt.callId!, 'VIEW');
    this.store.assertExecution(token);
    const step = call ? this.store.getStep(token.runId, token.inputRevision, receipt.callId!) : null;
    if (call && (!step || step.status !== 'COMMITTED' || !step.observation || stepId && step.id !== stepId || receipt.stepId && receipt.stepId !== step.id)) throw new AgentError('MISSING_EFFECT_RECEIPT', '工具尚无可消费的真实提交回执');
    if (progress && (typeof progress.before !== 'string' || typeof progress.after !== 'string' || !progress.after || progress.before !== sampling.progressFingerprint)) throw new AgentError('PROGRESS_MISMATCH', '进展比较不属于冻结采样');
    if (receipt.consumed) {
      const row = this.store.db.prepare('SELECT progress_json FROM agent_samplings WHERE id=?').get(sampling.id) as any;
      if (progress) assertSamePayload(hashValue(row.progress_json ? JSON.parse(row.progress_json) : null), hashValue(progress)); return step?.observation ?? null;
    }
    if (turn.pendingDecisionId !== decisionId || turn.nextDecisionIndex !== sampling.index) throw new AgentError('DECISION_POINTER_INVALID', '决策不在当前消费位置');
    receipt.consumed = true; receipt.stepId = step?.id ?? null; this.saveSamplingRow(sampling);
    if (progress) { this.store.db.prepare('UPDATE agent_samplings SET progress_json=? WHERE id=?').run(stableJson(progress), sampling.id); this.store.db.prepare('UPDATE agent_goals SET no_progress_streak=CASE WHEN ?=? THEN no_progress_streak+1 ELSE 0 END WHERE id=?').run(progress.before, progress.after, execution.goal.id); }
    turn.pendingDecisionId = null; turn.nextDecisionIndex++; turn.state = 'OPEN'; this.saveTurn(turn); return step?.observation ?? null;
  }
  consumeReceipt(token: ExecutionToken, decisionId: string, stepId?: string, progress?: ProgressComparison): Observation { return this.store.atomic(() => this.consume(token, decisionId, true, stepId, progress)!); }
  advanceDecision(token: ExecutionToken, decisionId: string, progress?: ProgressComparison, feedback?: string[]): void {
    this.store.atomic(() => { this.consume(token, decisionId, false, undefined, progress); if (feedback) { const link = this.link(token.runId)!; link.lastFeedback = feedback; this.saveLink(link); } });
  }
  awaitDecision(token: ExecutionToken, decisionId: string, progress?: ProgressComparison): void {
    this.store.atomic(() => { const sampling = this.sampling(decisionId, 'decision_id'); const decision = sampling.acceptedDecision!.decision; if (decision.kind !== 'ASK') throw new AgentError('DECISION_KIND_MISMATCH', '仅作者问题可以等待输入'); this.consume(token, decisionId, false, undefined, progress); this.store.wait(token, 'WAITING_INPUT', decision.message); });
  }
  finishDecision(token: ExecutionToken, decisionId: string, outcome: { status: 'SUCCEEDED' | 'PARTIAL'; result: unknown }, progress?: ProgressComparison, proof?: unknown): void {
    this.store.atomic(() => {
      const execution = this.execution(token), sampling = this.sampling(decisionId, 'decision_id'), decision = sampling.acceptedDecision!.decision;
      if (decision.kind !== 'FINISH' && decision.kind !== 'STOP' || outcome.status === 'SUCCEEDED' && decision.kind !== 'FINISH') throw new AgentError('DECISION_KIND_MISMATCH', '完成状态不属于此决策');
      if (outcome.status === 'SUCCEEDED') { if (!this.verifyCompletion || proof === undefined) throw new AgentError('COMPLETION_PROOF_REQUIRED', '完成提交缺少领域事务校验'); try { const value = this.verifyCompletion(execution.run, proof) as unknown; if (value === false) throw new AgentError('COMPLETION_PROOF_STALE', '完成依据未通过领域校验'); if (value && typeof (value as any).then === 'function') throw new AgentError('ASYNC_TRANSACTION', '完成校验必须同步'); } catch (error) { throw new ExecutionInvalidated(error instanceof AgentError ? error.code : 'COMPLETION_PROOF_STALE', error instanceof Error ? error.message : '完成依据已改变'); } }
      this.consume(token, decisionId, false, undefined, progress); this.store.finish(token, outcome.status, outcome.result);
    });
  }
  yieldTurn(token: ExecutionToken) {
    this.store.atomic(() => { const execution = this.execution(token); if (!execution.link.activeTurnId) throw new AgentError('TURN_NOT_FOUND', '没有可让出的回合'); const turn = this.turn(execution.link.activeTurnId); if (turn.pendingDecisionId) throw new AgentError('DECISION_PENDING', '先消费当前决策再让出回合'); turn.state = 'YIELDED'; this.saveTurn(turn); execution.link.activeTurnId = null; this.saveLink(execution.link); this.store.yieldRun(token); });
  }
}
