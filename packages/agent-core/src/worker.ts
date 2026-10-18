import { AgentError, ExecutionInvalidated } from './errors';
import { assertSamePayload, hashValue } from './identity';
import type { AgentRun, AgentStep, ClaimedRun, ClaimedChild } from './execution';
import { createLeaseGuard } from './leaseGuard';
import { ExecutionSuspended } from './model';
import type { AccessContext, CapabilityRequest, ExecutionToken, Observation, PreparedCall } from './protocol';
import { CapabilityRegistry } from './registry';
import type { RunOutcome } from './goals';

export interface WorkerStore {
  handoff(token: ExecutionToken, stepId: string): void;
  claimChild(workerId: string, leaseMs: number, runId?: string): ClaimedChild | null;
  completeChild(token: ExecutionToken): void;
  claim(workerId: string, leaseMs: number, runId?: string): ClaimedRun | null;
  renew(token: ExecutionToken, leaseMs: number): number | null;
  assertExecution(token: ExecutionToken): AgentRun;
  assertDecisionInput?(token: ExecutionToken, callId: string, phase: 'CONSUME' | 'VIEW'): void;
  getStep(runId: string, generation: number, callId: string): AgentStep | null;
  savePrepared(token: ExecutionToken, call: PreparedCall, requestHash?: string): AgentStep;
  commitStep(token: ExecutionToken, callId: string, observation: Observation, effect: () => unknown): Observation;
  finish(token: ExecutionToken, status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED', result: unknown, reason?: string | null): AgentRun;
  wait(token: ExecutionToken, status: 'NEEDS_REBASE' | 'WAITING_INPUT', reason: string): void;
}
export type RunContext = { run: AgentRun; token: ExecutionToken; signal: AbortSignal; checkpoint(): Promise<void>; call(request: CapabilityRequest, beforeExecute?: () => void): Promise<Observation> };
export type RunHandler = (context: RunContext) => Promise<RunOutcome>;

/** Host-driven coordination independent of UI lifetimes. INLINE retains the Run
 * lease; DURABLE freezes the step then transfers it to an independent lease. */
export class AgentWorker {
  constructor(private readonly store: WorkerStore, private readonly registry: CapabilityRegistry, private readonly options: {
    workerId: string; leaseMs?: number; handlers?: Partial<Record<AgentRun['kind'], RunHandler>>;
    reportError?: (error: unknown) => void;
  }) {}

  async runOnce(runId?: string, parentSignal?: AbortSignal): Promise<boolean> {
    if (parentSignal?.aborted) return false;
    const leaseMs = this.options.leaseMs ?? 30000;
    const claimed = this.store.claim(this.options.workerId, leaseMs, runId);
    if (!claimed) return false;
    const { run, token } = claimed;
    const guard = createLeaseGuard({ leaseUntil: run.leaseUntil!, heartbeatMs: Math.max(1, Math.floor(leaseMs / 3)), parentSignal,
      renew: async minimumLeaseMs => this.store.renew(token, minimumLeaseMs ?? leaseMs), onHeartbeatError: error => this.options.reportError?.(error) });
    const access: AccessContext = { ownerId: run.ownerId, scopeId: run.scopeId, commandRevision: String(run.generation), policyRevision: run.policyRevision, execution: token, signal: guard.signal };
    const heartbeatBoundary = async () => {
      await guard.checkpoint();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      guard.signal.throwIfAborted();
      this.store.assertExecution(token);
    };
    const call = async (request: CapabilityRequest, beforeExecute?: () => void): Promise<Observation> => {
      this.store.assertExecution(token);
      let step = this.store.getStep(run.id, run.generation, request.callId);
      this.store.assertDecisionInput?.(token, request.callId, step?.status === 'COMMITTED' ? 'VIEW' : 'CONSUME');
      await heartbeatBoundary();
      if (!step) {
        beforeExecute?.();
        await heartbeatBoundary();
        const prepared = await this.registry.prepare(request, access);
        await heartbeatBoundary();
        beforeExecute?.();
        await heartbeatBoundary();
        step = this.store.savePrepared(token, prepared, hashValue(request));
        await heartbeatBoundary();
      }
      if (step.status !== 'COMMITTED') { beforeExecute?.(); await heartbeatBoundary(); }
      assertSamePayload(step.requestHash, hashValue(request));
      const execution = { ...token, stepId: step.id };
      const context = { ...access, execution };
      // Never silently execute a different request under a committed call ID.
      if (step.prepared.request.capabilityId !== request.capabilityId || step.prepared.request.capabilityVersion !== request.capabilityVersion) throw new AgentError('STEP_REQUEST_CONFLICT', '步骤标识已经绑定另一能力');
      try {
        if (step.status === 'COMMITTED') await this.registry.attestReceipt(step.prepared, context);
        else await this.registry.attest(step.prepared, context);
        if (step.status !== 'COMMITTED') await heartbeatBoundary();
        if (step.status === 'COMMITTED') {
          const result = this.registry.validateObservation(step.prepared, step.observation!);
          // Pause may have fenced a child after its effect receipt but before
          // scheduler acknowledgement. Reacquire that child to acknowledge it
          // before dispatching the next step; don't leave its active slot stuck.
          if (this.store.assertExecution(token).activeStepId === step.id) {
            this.store.handoff(token, step.id);
            throw new ExecutionSuspended('WAITING_STEP', '恢复已提交子步骤的调度确认');
          }
          return result;
        }
      } catch (error) {
        if (step.status === 'COMMITTED' && !(error instanceof ExecutionSuspended) && !(error instanceof AgentError && error.code === 'LEASE_LOST')) throw new ExecutionInvalidated(error instanceof AgentError ? error.code : 'COMMITTED_RESULT_UNAVAILABLE', error instanceof Error ? error.message : '已提交效果的结果暂不可消费');
        throw error;
      }
      const spec = this.registry.describe().find(item => item.id === request.capabilityId && item.version === request.capabilityVersion)!;
      if (spec.dispatch === 'DURABLE') { this.store.handoff(token, step.id); throw new ExecutionSuspended('WAITING_STEP', '已交接独立子执行'); }
      const observation = await this.registry.execute(step.prepared, context);
      await heartbeatBoundary();
      // Mutation providers commit domain changes + this receipt in their host
      // transaction. Reads/pure observations need only this no-effect commit.
      const committed = this.store.getStep(run.id, run.generation, request.callId);
      if (committed?.status !== 'COMMITTED' && !['READ', 'PROPOSE'].includes(spec.effect)) throw new AgentError('MISSING_EFFECT_RECEIPT', '写入能力未原子保存副作用回执');
      // Capability reattestation and the store's own guarded receipt commit
      // are one no-yield section. Each synchronous guard is bounded by the
      // host, but together they can exceed the normal lease interval.
      await guard.checkpoint(Math.min(300000, leaseMs * 2));
      if (committed?.status === 'COMMITTED') await this.registry.attestReceipt(step.prepared, context);
      else await this.registry.attest(step.prepared, context);
      return this.store.commitStep(execution, request.callId, observation, () => {});
    };
    try {
      const handler = this.options.handlers?.[run.kind];
      const singleCapability = async (): Promise<RunOutcome> => {
        const observation = await call((run.input as { request: CapabilityRequest }).request);
        return { status: observation.status === 'SUCCEEDED' ? 'SUCCEEDED' as const : 'FAILED' as const, result: observation };
      };
      const outcome = handler ? await handler({ run, token, signal: guard.signal, checkpoint: heartbeatBoundary, call })
        : run.kind === 'CAPABILITY' ? await singleCapability()
        : (() => { throw new AgentError('RUN_HANDLER_MISSING', '此运行类型尚未接入执行器'); })();
      if (outcome.kind === 'SETTLED') return true;
      guard.signal.throwIfAborted();
      if (outcome.kind === 'YIELD') return true; // Handler persisted the checkpoint and requeued atomically.
      if (outcome.kind === 'WAIT') { this.store.wait(token, outcome.status, outcome.reason); return true; }
      this.store.finish(token, outcome.status, outcome.result);
    } catch (error) {
      if (error instanceof ExecutionSuspended) return true;
      if (error instanceof AgentError && ['LEASE_LOST','LEASE_RENEWAL_UNAVAILABLE'].includes(error.code)) return true;
      try { this.store.assertExecution(token); }
      catch (lost) { if (lost instanceof AgentError && lost.code === 'LEASE_LOST') return true; throw lost; }
      if (error instanceof ExecutionInvalidated) { this.store.wait(token, 'NEEDS_REBASE', error.code); return true; }
      if (parentSignal?.aborted) return true; // Lease expiry lets another worker recover frozen work.
      this.store.finish(token, 'FAILED', { error: error instanceof Error ? error.message : '执行失败' }, error instanceof AgentError ? error.code : 'EXECUTION_ERROR');
      this.options.reportError?.(error);
    } finally { guard.dispose(); }
    return true;
  }
}

/** Only executes frozen DURABLE steps; no goal interpretation or nested dispatch. */
export class AgentChildWorker {
  constructor(private readonly store: WorkerStore, private readonly registry: CapabilityRegistry, private readonly options: { workerId: string; leaseMs?: number; reportError?: (error: unknown) => void }) {}
  async runOnce(runId?: string, parentSignal?: AbortSignal): Promise<boolean> {
    if (parentSignal?.aborted) return false;
    const leaseMs = this.options.leaseMs ?? 30000;
    const claimed = this.store.claimChild(this.options.workerId, leaseMs, runId);
    if (!claimed) return false;
    const { run, token, step } = claimed;
    const guard = createLeaseGuard({ leaseUntil: claimed.leaseUntil, heartbeatMs: Math.max(1, Math.floor(leaseMs / 3)), parentSignal, renew: async minimumLeaseMs => this.store.renew(token, minimumLeaseMs ?? leaseMs), onHeartbeatError: error => this.options.reportError?.(error) });
    const context: AccessContext = { ownerId: run.ownerId, scopeId: run.scopeId, commandRevision: String(run.generation), policyRevision: run.policyRevision, execution: token, signal: guard.signal };
    const heartbeatBoundary = async () => {
      await guard.checkpoint();
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      guard.signal.throwIfAborted();
      this.store.assertExecution(token);
    };
    try {
      this.store.assertDecisionInput?.(token, step.prepared.request.callId, step.status === 'COMMITTED' ? 'VIEW' : 'CONSUME');
      await heartbeatBoundary();
      const spec = this.registry.describe().find(item => item.id === step.prepared.request.capabilityId && item.version === step.prepared.request.capabilityVersion);
      if (spec?.dispatch !== 'DURABLE') throw new AgentError('INVALID_HANDOFF', '子执行不是耐久能力');
      if (step.status === 'COMMITTED') {
        await this.registry.attestReceipt(step.prepared, context);
        // This only acknowledges scheduling. The parent reattests the receipt
        // before consuming it, so a source revoked during this boundary cannot
        // turn an old committed observation into a successful final result.
        await heartbeatBoundary();
      }
      else await this.registry.attest(step.prepared, context);
      if (step.status === 'COMMITTED') this.registry.validateObservation(step.prepared, step.observation!);
      else {
        // The next phase attests again. Let a due heartbeat renew the child
        // lease after a synchronous source-graph attestation.
        await heartbeatBoundary();
        const result = await this.registry.execute(step.prepared, context);
        await heartbeatBoundary();
        const current = this.store.getStep(run.id, run.generation, step.prepared.request.callId);
        if (current?.status !== 'COMMITTED' && !['READ', 'PROPOSE'].includes(spec.effect)) throw new AgentError('MISSING_EFFECT_RECEIPT', '子步骤写入缺少原子副作用回执');
        await guard.checkpoint(Math.min(300000, leaseMs * 2));
        if (current?.status === 'COMMITTED') await this.registry.attestReceipt(step.prepared, context);
        else await this.registry.attest(step.prepared, context);
        this.store.commitStep(token, step.prepared.request.callId, result, () => {});
      }
      if (step.status !== 'COMMITTED') await heartbeatBoundary();
      await guard.checkpoint(Math.min(300000, leaseMs * 2));
      await this.registry.attestReceipt(step.prepared, context);
      guard.signal.throwIfAborted();
      this.store.completeChild(token);
    } catch (error) {
      if (error instanceof ExecutionSuspended) return true;
      if (error instanceof AgentError && ['LEASE_LOST','LEASE_RENEWAL_UNAVAILABLE'].includes(error.code)) return true;
      try { this.store.assertExecution(token); }
      catch (lost) { if (lost instanceof AgentError && lost.code === 'LEASE_LOST') return true; throw lost; }
      // A committed effect is fact even if its result can no longer be consumed.
      // Never report it as unexecuted or repeat it to satisfy a stale baseline.
      const committed = this.store.getStep(run.id, run.generation, step.prepared.request.callId)?.status === 'COMMITTED';
      if (error instanceof ExecutionInvalidated || committed) { this.store.wait(token, 'NEEDS_REBASE', error instanceof AgentError ? error.code : 'COMMITTED_RESULT_UNAVAILABLE'); return true; }
      if (parentSignal?.aborted) return true;
      this.store.finish(token, 'FAILED', { error: error instanceof Error ? error.message : '子执行失败', stepId: step.id }, error instanceof AgentError ? error.code : 'CHILD_EXECUTION_ERROR');
      this.options.reportError?.(error);
    } finally { guard.dispose(); }
    return true;
  }
}
