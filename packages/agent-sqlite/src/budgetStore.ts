import { randomUUID } from 'node:crypto';
import { AgentError, assertSamePayload, hashValue, stableJson, type BudgetLimits, type BudgetSnapshot } from '../../agent-core/src';
import { AgentSqliteStore } from './store';

type ReservationKind = 'INVOCATION' | 'TOOL' | 'TURN' | 'REPAIR';
const limitKey = { INVOCATION: 'maxInvocations', TOOL: 'maxToolCalls', TURN: 'maxTurns', REPAIR: 'maxRepairRounds' } as const;
export class SqliteBudgetStore {
  constructor(private readonly store: AgentSqliteStore) {}
  ensureSchema() {
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS agent_budgets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,limits_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_budget_entries(budget_id TEXT NOT NULL REFERENCES agent_budgets(id),kind TEXT NOT NULL,operation_id TEXT NOT NULL,data_json TEXT NOT NULL,PRIMARY KEY(budget_id,kind,operation_id));
      CREATE TABLE IF NOT EXISTS agent_budget_activity(budget_id TEXT NOT NULL,run_id TEXT NOT NULL,owner_key TEXT NOT NULL,started_at INTEGER NOT NULL,lease_until INTEGER NOT NULL,PRIMARY KEY(run_id,owner_key));
      CREATE TABLE IF NOT EXISTS agent_budget_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,response_json TEXT NOT NULL,PRIMARY KEY(owner_id,request_id));`);
  }
  private validate(limits: BudgetLimits) {
    const required = Object.values(limitKey);
    if (!limits || required.some(key => !Number.isSafeInteger(limits[key]) || limits[key] < (key === 'maxRepairRounds' ? 0 : 1) || limits[key] > 1000000) || Object.keys(limits).some(key => ![...required, 'maxActiveMs', 'deadlineAt'].includes(key)) || limits.maxActiveMs !== undefined && (!Number.isSafeInteger(limits.maxActiveMs) || limits.maxActiveMs < 1) || limits.deadlineAt !== undefined && (!Number.isSafeInteger(limits.deadlineAt) || limits.deadlineAt < 1)) throw new AgentError('INVALID_BUDGET', '委托总预算必须是有界非负整数', 400);
  }
  create(input: { ownerId: string; budgetId: string; limits: BudgetLimits }): BudgetSnapshot {
    this.validate(input.limits);
    if (!input.ownerId || !input.budgetId) throw new AgentError('INVALID_BUDGET', '预算缺少身份', 400);
    return this.store.atomic(() => {
      const old = this.store.db.prepare('SELECT owner_id,limits_json FROM agent_budgets WHERE id=?').get(input.budgetId) as any;
      if (old) { if (old.owner_id !== input.ownerId) throw new AgentError('BUDGET_NOT_FOUND', '预算不存在', 404); assertSamePayload(hashValue(JSON.parse(old.limits_json)), hashValue(input.limits)); }
      else this.store.db.prepare('INSERT INTO agent_budgets(id,owner_id,limits_json) VALUES(?,?,?)').run(input.budgetId, input.ownerId, stableJson(input.limits));
      return this.read(input.budgetId, input.ownerId);
    });
  }
  read(id: string, ownerId: string): BudgetSnapshot {
    return this.store.atomic(() => {
    const row = this.store.db.prepare('SELECT * FROM agent_budgets WHERE id=? AND owner_id=?').get(id, ownerId) as any;
    if (!row) throw new AgentError('BUDGET_NOT_FOUND', '预算不存在或不属于当前作者', 404);
    const entries = this.store.db.prepare('SELECT kind,data_json FROM agent_budget_entries WHERE budget_id=?').all(id) as any[];
    const used = { invocations: 0, toolCalls: 0, turns: 0, repairRounds: 0, attempts: 0, inputTokens: 0, outputTokens: 0, unknownUsageAttempts: 0, activeMs: 0 };
    for (const entry of entries) {
      if (entry.kind === 'INVOCATION') used.invocations++;
      else if (entry.kind === 'TOOL') used.toolCalls++;
      else if (entry.kind === 'TURN') used.turns++;
      else if (entry.kind === 'REPAIR') used.repairRounds++;
      else if (entry.kind === 'ACTIVE') used.activeMs += JSON.parse(entry.data_json).durationMs;
      else if (entry.kind === 'ATTEMPT') used.attempts++;
      else if (entry.kind === 'USAGE') { const data = JSON.parse(entry.data_json); used.inputTokens += data.inputTokens ?? 0; used.outputTokens += data.outputTokens ?? 0; }
    }
    const now = Date.now();
    for (const active of this.store.db.prepare('SELECT started_at,lease_until FROM agent_budget_activity WHERE budget_id=?').all(id) as any[]) used.activeMs += Math.max(0, Math.min(now, active.lease_until) - active.started_at);
    const known = entries.filter(entry => entry.kind === 'USAGE' && JSON.parse(entry.data_json).inputTokens !== undefined && JSON.parse(entry.data_json).outputTokens !== undefined).length;
    used.unknownUsageAttempts = Math.max(0, used.attempts - known);
    return { id, ownerId, version: row.version, limits: JSON.parse(row.limits_json), used };
    });
  }
  increase(input: { ownerId: string; budgetId: string; expectedVersion: number; requestId: string; limits: BudgetLimits }): BudgetSnapshot {
    this.validate(input.limits);
    return this.store.atomic(() => {
      const hash = hashValue(input), old = this.store.db.prepare('SELECT * FROM agent_budget_commands WHERE owner_id=? AND request_id=?').get(input.ownerId, input.requestId) as any;
      if (old) { assertSamePayload(old.payload_hash, hash); return JSON.parse(old.response_json); }
      const current = this.read(input.budgetId, input.ownerId);
      if (!input.requestId || current.version !== input.expectedVersion) throw new AgentError('BUDGET_VERSION_CONFLICT', '预算版本已更新');
      if ((Object.keys(input.limits) as Array<keyof BudgetLimits>).some(key => input.limits[key] < current.limits[key])) throw new AgentError('BUDGET_DECREASE_DENIED', '增加额度不能抹去此前授权或消费账');
      if ((input.limits.maxActiveMs ?? 3600000) < (current.limits.maxActiveMs ?? 3600000) || (input.limits.deadlineAt ?? Infinity) < (current.limits.deadlineAt ?? Infinity)) throw new AgentError('BUDGET_DECREASE_DENIED', '增加额度不能缩短活动时间或截止时间');
      this.store.db.prepare('UPDATE agent_budgets SET version=version+1,limits_json=? WHERE id=?').run(stableJson(input.limits), input.budgetId);
      const result = this.read(input.budgetId, input.ownerId);
      this.store.db.prepare('INSERT INTO agent_budget_commands VALUES(?,?,?,?)').run(input.ownerId, input.requestId, hash, stableJson(result));
      return result;
    });
  }
  tryReserve(input: { budgetId: string; kind: ReservationKind; operationId: string }): boolean {
    return this.store.atomic(() => {
      if (!limitKey[input.kind] || !input.operationId) throw new AgentError('INVALID_BUDGET_ENTRY', '预算账项无效', 400);
      if (this.store.db.prepare('SELECT 1 FROM agent_budget_entries WHERE budget_id=? AND kind=? AND operation_id=?').get(input.budgetId, input.kind, input.operationId)) return true;
      const row = this.store.db.prepare('SELECT limits_json FROM agent_budgets WHERE id=?').get(input.budgetId) as any;
      if (!row) throw new AgentError('BUDGET_NOT_FOUND', '预算不存在', 404);
      if (!this.timeAvailable(input.budgetId)) return false;
      const count = (this.store.db.prepare('SELECT count(*) n FROM agent_budget_entries WHERE budget_id=? AND kind=?').get(input.budgetId, input.kind) as any).n;
      if (count >= JSON.parse(row.limits_json)[limitKey[input.kind]]) return false;
      this.store.db.prepare('INSERT INTO agent_budget_entries VALUES(?,?,?,?)').run(input.budgetId, input.kind, input.operationId, '{}');
      return true;
    });
  }
  timeAvailable(budgetId: string): boolean {
    const row = this.store.db.prepare('SELECT owner_id FROM agent_budgets WHERE id=?').get(budgetId) as any;
    if (!row) throw new AgentError('BUDGET_NOT_FOUND', '预算不存在', 404);
    const budget = this.read(budgetId, row.owner_id);
    return budget.used.activeMs < (budget.limits.maxActiveMs ?? 3600000) && (budget.limits.deadlineAt === undefined || Date.now() < budget.limits.deadlineAt);
  }
  activity(budgetId: string, runId: string, ownerKey: string, leaseUntil: number | null, now: number, renew = false) {
    this.store.atomic(() => {
      const old = this.store.db.prepare('SELECT * FROM agent_budget_activity WHERE run_id=? AND owner_key=?').get(runId, ownerKey) as any;
      if (old && renew) { this.store.db.prepare('UPDATE agent_budget_activity SET lease_until=? WHERE run_id=? AND owner_key=?').run(leaseUntil, runId, ownerKey); return; }
      if (old) {
        this.append(budgetId, 'ACTIVE', `activity:${randomUUID()}`, { durationMs: Math.max(0, Math.min(now, old.lease_until) - old.started_at) });
        this.store.db.prepare('DELETE FROM agent_budget_activity WHERE run_id=? AND owner_key=?').run(runId, ownerKey);
      }
      if (leaseUntil !== null) this.store.db.prepare('INSERT INTO agent_budget_activity VALUES(?,?,?,?,?)').run(budgetId, runId, ownerKey, now, leaseUntil);
    });
  }
  stopActivity(budgetId: string, runId: string, now: number) {
    for (const row of this.store.db.prepare('SELECT owner_key FROM agent_budget_activity WHERE run_id=?').all(runId) as any[]) this.activity(budgetId, runId, row.owner_key, null, now);
  }
  private append(budgetId: string, kind: string, operationId: string, data: unknown) {
    return this.store.atomic(() => {
      const old = this.store.db.prepare('SELECT data_json FROM agent_budget_entries WHERE budget_id=? AND kind=? AND operation_id=?').get(budgetId, kind, operationId) as any;
      if (old) { assertSamePayload(hashValue(JSON.parse(old.data_json)), hashValue(data)); return; }
      this.store.db.prepare('INSERT INTO agent_budget_entries VALUES(?,?,?,?)').run(budgetId, kind, operationId, stableJson(data));
    });
  }
  recordAttempt(input: { budgetId: string; attemptId: string; invocationId: string }) { this.append(input.budgetId, 'ATTEMPT', input.attemptId, { invocationId: input.invocationId }); }
  recordUsage(input: { budgetId: string; attemptId: string; usage?: { inputTokens?: number; outputTokens?: number } }) {
    const usage = input.usage ?? {};
    if (Object.values(usage).some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) throw new AgentError('INVALID_BUDGET_USAGE', '模型用量无效', 400);
    if (!this.store.db.prepare("SELECT 1 FROM agent_budget_entries WHERE budget_id=? AND kind='ATTEMPT' AND operation_id=?").get(input.budgetId, input.attemptId)) throw new AgentError('BUDGET_ATTEMPT_MISSING', '用量缺少对应发送记录');
    this.append(input.budgetId, 'USAGE', input.attemptId, usage);
  }
}
