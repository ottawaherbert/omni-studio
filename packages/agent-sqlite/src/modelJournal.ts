import { parseModelJson } from '../../model-output/src';
import { randomUUID } from 'node:crypto';
import { AgentError, ExecutionSuspended, assertSamePayload, hashCommand, hashValue, stableJson, type AgentEvent, type AgentRun, type ExecutionToken, type ExternalRequest, type Invocation, type ModelJournal, type ModelRequest, type ModelResult } from '../../agent-core/src';
import { AgentSqliteStore } from './store';
import { formatCorrectionRequest } from '../../agent-core/src/model';

// Logical invocation != physical attempt. Adapted from duilang's invocation /
// replay policy, without its wallet, Prisma or novel-specific owner types.
export class SqliteModelJournal implements ModelJournal {
  constructor(private readonly store: AgentSqliteStore, private readonly inputGuard?: (request: ModelRequest, run: AgentRun, phase: 'CONSUME' | 'VIEW') => void,
    private readonly validationBatch: <T>(read: () => T) => T = read => read()) {}
  ensureSchema() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_invocations (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id),
        input_revision INTEGER NOT NULL, owner_key TEXT NOT NULL, operation_key TEXT NOT NULL,
        status TEXT NOT NULL, input_hash TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT,
        UNIQUE(run_id,input_revision,owner_key,operation_key)
      );
      CREATE TABLE IF NOT EXISTS agent_attempts (
        id TEXT PRIMARY KEY, invocation_id TEXT NOT NULL REFERENCES agent_invocations(id),
        attempt_no INTEGER NOT NULL, status TEXT NOT NULL, result_hash TEXT, result_json TEXT,
        UNIQUE(invocation_id,attempt_no)
      );
      CREATE TABLE IF NOT EXISTS agent_external_requests (
        id TEXT PRIMARY KEY, invocation_id TEXT NOT NULL UNIQUE REFERENCES agent_invocations(id),
        run_id TEXT NOT NULL REFERENCES agent_runs(id), status TEXT NOT NULL,
        result_hash TEXT, result_json TEXT
      );
      CREATE INDEX IF NOT EXISTS agent_external_run_status ON agent_external_requests(run_id,status);
    `);
  }
  assertExecution(token: ExecutionToken) { this.store.assertExecution(token); }
  private guard(request: ModelRequest, run: AgentRun, phase: 'CONSUME' | 'VIEW' = 'CONSUME') {
    if (request.formatCorrection) {
      const source = this.read(request.formatCorrection.sourceInvocationId);
      if (source.runId !== run.id || (phase === 'CONSUME' && source.inputRevision !== run.generation) || hashValue(formatCorrectionRequest(source)) !== hashValue(request))
        throw new AgentError('MODEL_CORRECTION_DENIED', '格式纠正改变了原请求或不属于当前执行');
    }
    if (request.contextRef && !this.inputGuard) throw new AgentError('CONTEXT_GUARD_MISSING', '冻结上下文缺少有效的宿主校验');
    this.inputGuard?.(request, run, phase);
  }
  /** Combine a response's independent guarded views in one synchronous read
   * snapshot. The host's validator discards its memo at this boundary. */
  withViewBatch<T>(read:()=>T):T { return this.validationBatch(read); }
  assertInput(token: ExecutionToken, request: ModelRequest, phase: 'CONSUME' | 'VIEW' = 'CONSUME') {
    this.validationBatch(() => {
      this.assertCorrectionOwner(token, request);
      this.store.assertOwnerDecisionInput(token, phase);
      this.guard(request, this.store.assertExecution(token), phase);
      this.store.assertExecution(token);
    });
  }
  private assertCorrectionOwner(token: ExecutionToken, request: ModelRequest) {
    if (request.formatCorrection && this.read(request.formatCorrection.sourceInvocationId).ownerKey !== (token.stepId || 'run'))
      throw new AgentError('MODEL_CORRECTION_DENIED', '格式纠正不属于当前步骤');
  }
  assertRunInput(request: ModelRequest, run: AgentRun, phase: 'CONSUME' | 'VIEW' = 'CONSUME') { this.guard(request, run, phase); }
  private decode(row: any): Invocation {
    return { id: row.id, runId: row.run_id, inputRevision: row.input_revision, ownerKey: row.owner_key, operationKey: row.operation_key, status: row.status, inputHash: row.input_hash, request: JSON.parse(row.request_json), result: row.result_json ? JSON.parse(row.result_json) : null };
  }
  read(invocationId: string): Invocation {
    const row = this.store.db.prepare('SELECT * FROM agent_invocations WHERE id=?').get(invocationId);
    if (!row) throw new AgentError('INVOCATION_NOT_FOUND', '模型请求不存在', 404);
    return this.decode(row);
  }
  /** Original results stay immutable. Consumers explicitly resolve a successful
   * correction and persist its invocation ID alongside their domain artifact. */
  resolvedResult(invocationId: string): ModelResult | null {
    const source = this.read(invocationId);
    const row = this.store.db.prepare('SELECT * FROM agent_invocations WHERE run_id=? AND input_revision=? AND owner_key=? AND operation_key=?')
      .get(source.runId, source.inputRevision, source.ownerKey, `${source.operationKey}:format-correction`);
    if (!row) return source.result;
    const correction = this.decode(row);
    assertSamePayload(hashValue(formatCorrectionRequest(source)), correction.inputHash);
    assertSamePayload(correction.inputHash, hashValue(correction.request));
    if (correction.status !== 'RECEIVED' || !correction.result) throw new AgentError('MODEL_CORRECTION_PENDING', '格式纠正尚未完成');
    if (correction.result.failure || correction.result.validationErrors?.length) throw new AgentError('MODEL_OUTPUT_INVALID', '格式纠正没有返回可用内容');
    parseModelJson(correction.result.text, source.request.outputSchema);
    return { ...correction.result, correctionInvocationId: correction.id };
  }
  prepare(token: ExecutionToken, request: ModelRequest): Invocation {
    if (!request.operationKey || !request.routeRef || typeof request.prompt !== 'string' || !request.prompt.trim() || !['api', 'external'].includes(request.channel)) throw new AgentError('INVALID_MODEL_REQUEST', '模型请求缺少稳定标识、路由或提示词', 400);
    const hash = hashValue(request);
    const result = this.validationBatch(() => this.store.atomic(() => {
      const run = this.store.assertExecution(token);
      this.store.assertOwnerDecisionInput(token, 'CONSUME');
      this.assertCorrectionOwner(token, request);
      this.guard(request, run);
      this.store.assertExecution(token);
      const ownerKey = this.ownerKey(token);
      const existing = this.store.db.prepare('SELECT * FROM agent_invocations WHERE run_id=? AND input_revision=? AND owner_key=? AND operation_key=?').get(run.id, token.inputRevision, ownerKey, request.operationKey);
      if (existing) { const previous = this.decode(existing); assertSamePayload(previous.inputHash, hash); return previous; }
      if (!this.store.hasSharedBudget(run.id) && run.invocationCount >= run.maxInvocations) {
        this.store.finish(token, 'PARTIAL', { remainingWork: ['模型调用预算已用尽'] }, 'BUDGET_EXHAUSTED');
        return null;
      }
      const invocationId = `invocation_${randomUUID()}`;
      if (!this.store.reserveBudget(run, 'INVOCATION', invocationId)) {
        this.store.finish(token, 'PARTIAL', { remainingWork: ['委托共享模型预算已用尽'] }, 'BUDGET_EXHAUSTED');
        return null;
      }
      this.store.db.prepare('UPDATE agent_runs SET invocation_count=invocation_count+1 WHERE id=?').run(run.id);
      this.store.db.prepare("INSERT INTO agent_invocations(id,run_id,input_revision,owner_key,operation_key,status,input_hash,request_json) VALUES(?,?,?,?,?,'PREPARED',?,?)").run(invocationId, run.id, token.inputRevision, ownerKey, request.operationKey, hash, stableJson(request));
      this.store.recordSystemEvent(run.id, 'model.prepared', { invocationId, inputHash: hash, channel: request.channel });
      return this.read(invocationId);
    }));
    if (!result) throw new ExecutionSuspended('BUDGET_EXHAUSTED', '模型调用预算已用尽，已有成果已保留');
    return result;
  }
  private ownerKey(token: ExecutionToken) {
    if (!token.stepId) return 'run';
    if (this.store.db.prepare('SELECT 1 FROM agent_step_leases WHERE step_id=?').get(token.stepId) && token.leaseKind !== 'step') throw new AgentError('MODEL_OWNER_MISMATCH', '耐久步骤模型请求需要子执行身份');
    const step = this.store.db.prepare("SELECT id FROM agent_steps WHERE id=? AND run_id=? AND generation=? AND status='PREPARED'").get(token.stepId, token.runId, token.inputRevision);
    if (!step) throw new AgentError('MODEL_OWNER_MISMATCH', '模型请求不属于当前能力步骤');
    return token.stepId;
  }
  startAttempt(token: ExecutionToken, invocationId: string) {
    const result = this.validationBatch(() => this.store.atomic(() => {
      const run = this.store.assertExecution(token);
      this.store.assertOwnerDecisionInput(token, 'CONSUME');
      const invocation = this.read(invocationId);
      if (invocation.runId !== run.id || invocation.inputRevision !== token.inputRevision || invocation.ownerKey !== this.ownerKey(token) || invocation.status !== 'PREPARED' || invocation.request.channel !== 'api') throw new AgentError('INVOCATION_NOT_SENDABLE', '模型请求不能重复发送');
      this.guard(invocation.request, run);
      this.store.assertExecution(token);
      if (!this.store.budgetTimeAvailable(run.id)) { this.store.finish(token, 'PARTIAL', { remainingWork: ['活动时间或截止时间预算已用尽'] }, 'BUDGET_EXHAUSTED'); return null; }
      const attemptId = `attempt_${randomUUID()}`;
      this.store.db.prepare("INSERT INTO agent_attempts(id,invocation_id,attempt_no,status) VALUES(?,?,1,'SENT')").run(attemptId, invocationId);
      this.store.db.prepare("UPDATE agent_invocations SET status='SENT' WHERE id=?").run(invocationId);
      this.store.recordBudgetAttempt(run.id, invocationId, attemptId);
      this.store.recordSystemEvent(run.id, 'model.sent', { invocationId, attemptId });
      return { attemptId, request: invocation.request };
    }));
    if (!result) throw new ExecutionSuspended('BUDGET_EXHAUSTED', '活动时间或截止时间预算已用尽'); return result;
  }
  private validateResult(result: ModelResult) {
    if (typeof result?.text !== 'string' || !result.provenance || !['provider', 'external-return'].includes(result.provenance.channel)) throw new AgentError('INVALID_MODEL_RESULT', '返回缺少原文或执行渠道', 400);
    for (const value of Object.values(result.usage ?? {})) if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new AgentError('INVALID_MODEL_USAGE', '模型用量无效', 400);
    if (result.failure && (!['HTTP', 'REFUSAL', 'INCOMPLETE', 'INVALID_RESPONSE'].includes(result.failure.kind) || typeof result.failure.code !== 'string' || !result.failure.code || typeof result.failure.message !== 'string')) throw new AgentError('INVALID_MODEL_RESULT', '模型错误状态无效', 400);
    return stableJson(result);
  }
  recordResult(invocationId: string, attemptId: string, result: ModelResult) {
    let saved = result;
    try { this.validateResult(result); }
    catch (error) {
      // A malformed usage/envelope is not grounds for losing returned prose.
      // Persist evidence first; the driver rejects consumption on every replay.
      let metadataSnapshot: string;
      try { metadataSnapshot = JSON.stringify(result, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value) ?? 'undefined'; }
      catch { metadataSnapshot = '[unserializable provider envelope]'; }
      saved = { text: typeof result?.text === 'string' ? result.text : '', provenance: { channel: 'provider' }, metadataSnapshot, validationErrors: [error instanceof Error ? error.message : '返回元数据无效'] };
    }
    const raw = stableJson(saved), hash = hashValue(saved);
    return this.store.atomic(() => {
      const invocation = this.read(invocationId);
      const attempt = this.store.db.prepare('SELECT * FROM agent_attempts WHERE id=? AND invocation_id=?').get(attemptId, invocationId) as any;
      if (!attempt) throw new AgentError('ATTEMPT_NOT_FOUND', '物理请求记录不存在', 404);
      if (attempt.result_hash) { assertSamePayload(attempt.result_hash, hash); return JSON.parse(attempt.result_json) as ModelResult; }
      this.store.db.prepare("UPDATE agent_attempts SET status='RECEIVED',result_hash=?,result_json=? WHERE id=?").run(hash, raw, attemptId);
      this.store.db.prepare("UPDATE agent_invocations SET status=CASE WHEN status='SUPERSEDED' THEN status ELSE 'RECEIVED' END,result_json=? WHERE id=?").run(raw, invocationId);
      this.store.recordBudgetUsage(invocation.runId, attemptId, saved);
      this.store.recordSystemEvent(invocation.runId, 'model.received', { invocationId, attemptId, resultHash: hash });
      return JSON.parse(raw) as ModelResult;
    });
  }
  markUnknown(token: ExecutionToken, invocationId: string, reason: string) {
    this.store.atomic(() => {
      const invocation = this.read(invocationId);
      if (invocation.runId !== token.runId || invocation.ownerKey !== (token.stepId || 'run') || invocation.inputRevision !== token.inputRevision) throw new AgentError('INVOCATION_SCOPE_CONFLICT', '请求不属于此运行');
      if (invocation.status === 'SENT') this.store.db.prepare("UPDATE agent_invocations SET status='UNKNOWN' WHERE id=?").run(invocationId);
      this.store.db.prepare("UPDATE agent_attempts SET status='UNKNOWN' WHERE invocation_id=? AND status='SENT'").run(invocationId);
      // Late evidence remains recorded even when pause/cancel/takeover has
      // fenced the child. Only its currently valid token may alter wait state.
      try { this.store.wait(token, 'RECONCILIATION_REQUIRED', reason.slice(0, 600)); }
      catch (error) { if (!(error instanceof AgentError && error.code === 'LEASE_LOST')) throw error; }
    });
  }
  waitExternal(token: ExecutionToken, invocationId: string): ExternalRequest {
    return this.store.atomic(() => {
      const run = this.store.assertExecution(token);
      const invocation = this.read(invocationId);
      if (invocation.runId !== run.id || invocation.inputRevision !== token.inputRevision || invocation.ownerKey !== this.ownerKey(token) || invocation.request.channel !== 'external' || !['PREPARED', 'WAITING_EXTERNAL'].includes(invocation.status)) throw new AgentError('INVALID_EXTERNAL_REQUEST', '回填请求与当前执行不匹配');
      this.guard(invocation.request, run);
      this.store.assertExecution(token);
      let row = this.store.db.prepare('SELECT id FROM agent_external_requests WHERE invocation_id=?').get(invocationId) as any;
      if (!row) {
        row = { id: `external_${randomUUID()}` };
        this.store.db.prepare("INSERT INTO agent_external_requests(id,invocation_id,run_id,status) VALUES(?,?,?,'WAITING')").run(row.id, invocationId, run.id);
      }
      this.store.db.prepare("UPDATE agent_invocations SET status='WAITING_EXTERNAL' WHERE id=?").run(invocationId);
      this.store.wait(token, 'WAITING_EXTERNAL', '等待外部返回');
      this.store.recordSystemEvent(run.id, 'external.waiting', { requestId: row.id, invocationId });
      return { id: row.id, invocationId, runId: run.id, status: 'WAITING', request: invocation.request, inputHash: invocation.inputHash };
    });
  }
  private rawExternalRequest(requestId: string, ownerId: string): ExternalRequest {
    const row = this.store.db.prepare('SELECT * FROM agent_external_requests WHERE id=?').get(requestId) as any;
    if (!row) throw new AgentError('EXTERNAL_REQUEST_NOT_FOUND', '回填请求不存在', 404);
    this.store.readRun(row.run_id, ownerId);
    const invocation = this.read(row.invocation_id);
    return { id: row.id, invocationId: invocation.id, runId: row.run_id, status: row.status, request: invocation.request, inputHash: invocation.inputHash };
  }
  externalRequest(requestId: string, ownerId: string): ExternalRequest {
    const external = this.rawExternalRequest(requestId, ownerId);
    try { this.guard(external.request, this.store.readRun(external.runId, ownerId), 'VIEW'); return external; }
    catch (error) { if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return { ...external, redacted: true, contextError: error instanceof AgentError ? error.code : 'CONTEXT_UNAVAILABLE', request: { operationKey: external.request.operationKey, channel: external.request.channel, routeRef: external.request.routeRef, prompt: '此请求的上下文已撤回或不可访问。原返回仍可存为受限证据，请使用当前资料重新准备。' } }; }
  }
  private viewError(run: AgentRun) {
    const rows = this.store.db.prepare('SELECT request_json FROM agent_invocations WHERE run_id=?').all(run.id) as { request_json: string }[];
    try { for (const row of rows) this.guard(JSON.parse(row.request_json), run, 'VIEW'); return null; }
    catch (error) { if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return error instanceof AgentError ? error.code : 'CONTEXT_UNAVAILABLE'; }
  }
  viewRun(run: AgentRun): AgentRun {
    const reason = this.validationBatch(() => this.viewError(run));
    return reason ? { ...run, input: { redacted: true, reason }, result: { redacted: true, reason } } : run;
  }
  /** Polling needs lifecycle fields, never historical prompts or results. */
  stateRun(run:AgentRun):AgentRun {
    const resultReason=(run.result as {reason?:unknown}|null)?.reason;
    return {...run,input:null,result:resultReason==='DECISION_INVALID'?{reason:'DECISION_INVALID'}:null};
  }
  viewEvents(events: AgentEvent[]): AgentEvent[] {
    const reasons = new Map<string, string | null>();
    return events.map(event => {
      if (!reasons.has(event.runId)) reasons.set(event.runId, this.viewError(this.store.readRun(event.runId)));
      const reason = reasons.get(event.runId);
      return reason ? { ...event, data: { redacted: true, reason } } : event;
    });
  }
  listExternal(runId: string, ownerId: string, status?:'WAITING'): ExternalRequest[] {
    return this.validationBatch(() => {
      this.store.readRun(runId, ownerId);
      const rows=status==='WAITING'
        ?this.store.db.prepare("SELECT id FROM agent_external_requests WHERE run_id=? AND status='WAITING' ORDER BY rowid").all(runId)
        :this.store.db.prepare('SELECT id FROM agent_external_requests WHERE run_id=? ORDER BY rowid').all(runId);
      return (rows as { id: string }[])
        .map(row => this.externalRequest(row.id, ownerId));
    });
  }
  /** An operator may continue only after exact attempt evidence has arrived.
   * This is not permission to blindly retry an unknown physical request. */
  reconcileReceived(runId: string, ownerId: string, expectedVersion: number, requestId: string): AgentRun {
    if (!requestId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new AgentError('INVALID_RECONCILIATION', '核对命令无效', 400);
    const payloadHash = hashCommand('RECONCILE_RECEIVED', { runId, expectedVersion });
    return this.store.atomic(() => {
      const previous = this.store.db.prepare('SELECT * FROM agent_commands WHERE owner_id=? AND request_id=?').get(ownerId, requestId) as any;
      if (previous) { assertSamePayload(previous.payload_hash, payloadHash); return JSON.parse(previous.response_json); }
      const run = this.store.readRun(runId, ownerId);
      if (run.version !== expectedVersion) throw new AgentError('RUN_VERSION_CONFLICT', '任务状态已更新，请刷新后重试');
      if (run.status !== 'RECONCILIATION_REQUIRED') throw new AgentError('INVALID_RECONCILIATION', '任务当前不在等待核对');
      const invocations = (this.store.db.prepare("SELECT * FROM agent_invocations WHERE run_id=? AND input_revision=? AND status!='SUPERSEDED'").all(runId, run.generation) as any[]).map(row => this.decode(row));
      if (!invocations.length || invocations.some(item => ['SENT', 'UNKNOWN'].includes(item.status))) throw new AgentError('EVIDENCE_MISSING', '仍有已发送请求的结果未知，不能继续');
      if (invocations.some(item => item.result?.validationErrors?.length)) throw new AgentError('INVALID_RECONCILIATION', '返回元数据仍有异常，请保留证据后处理');
      invocations.forEach(item => this.guard(item.request, run));
      this.store.wakeModelOwner(runId, run.generation, run.activeStepId || invocations[invocations.length - 1].ownerKey);
      this.store.recordSystemEvent(runId, 'model.reconciled', { invocationIds: invocations.filter(item => item.status === 'RECEIVED').map(item => item.id) });
      const response = this.store.readRun(runId, ownerId);
      this.store.db.prepare('INSERT INTO agent_commands(owner_id,request_id,payload_hash,run_id,response_json) VALUES(?,?,?,?,?)').run(ownerId, requestId, payloadHash, runId, stableJson(response));
      return response;
    });
  }
  submitExternal(requestId: string, ownerId: string, expectedInputHash: string, text: string, producer?: { name: string; model?: string }) {
    if (typeof text !== 'string' || !text.trim()) throw new AgentError('EMPTY_EXTERNAL_RESULT', '返回原文不能为空', 400);
    if (producer !== undefined && (!producer || typeof producer.name !== 'string' || !producer.name.trim() || producer.name.length > 200 || (producer.model !== undefined && (typeof producer.model !== 'string' || producer.model.length > 200)))) throw new AgentError('INVALID_PRODUCER', '返回来源说明无效', 400);
    this.store.atomic(() => {
      const external = this.rawExternalRequest(requestId, ownerId);
      assertSamePayload(external.inputHash, expectedInputHash);
      const result: ModelResult = { text, provenance: { channel: 'external-return', ...(producer ? { producer: producer.name, ...(producer.model ? { model: producer.model } : {}), producerVerified: false } : {}) } };
      const raw = this.validateResult(result), hash = hashValue(result);
      const previous = this.store.db.prepare('SELECT result_hash FROM agent_external_requests WHERE id=?').get(requestId) as { result_hash: string | null };
      if (previous.result_hash) { assertSamePayload(previous.result_hash, hash); return; }
      this.store.db.prepare("UPDATE agent_external_requests SET result_hash=?,result_json=?,status=CASE WHEN status='SUPERSEDED' THEN status ELSE 'RECEIVED' END WHERE id=?").run(hash, raw, requestId);
      this.store.db.prepare("UPDATE agent_invocations SET result_json=?,status=CASE WHEN status='SUPERSEDED' THEN status ELSE 'RECEIVED' END WHERE id=?").run(raw, external.invocationId);
      const invocation = this.read(external.invocationId);
      const run = this.store.readRun(external.runId);
      if (external.status !== 'SUPERSEDED' && run.status === 'WAITING_EXTERNAL' && run.generation === invocation.inputRevision && (!run.activeStepId || run.activeStepId === invocation.ownerKey)) {
        let invalid: string | null = null;
        try { this.guard(invocation.request, run); } catch (error) { invalid = error instanceof AgentError ? error.code : 'CONTEXT_UNAVAILABLE'; }
        if (!invalid) this.store.wakeModelOwner(run.id, invocation.inputRevision, invocation.ownerKey);
        else this.store.invalidateWaiting(run.id, invalid);
      }
      this.store.recordSystemEvent(run.id, 'external.received', { requestId, invocationId: invocation.id, resultHash: hash });
      // Do not perform the optional VIEW projection inside the receipt commit.
      // A transient VIEW deadline must not roll back a known returned body.
    });
    return this.externalRequest(requestId, ownerId);
  }
}
