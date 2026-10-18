import { AgentError, ExecutionInvalidated } from './errors';
import { hashValue } from './identity';
import { ExecutionSuspended, invokeModel, type ModelJournal, type ModelRequest, type ModelTransport } from './model';
import type { CapabilityRequest, ResourceRef } from './protocol';
import type { Decision, ExecutionTurn, GoalExecution, GoalStorePort, PlanUpdate, RunOutcome, Sampling } from './goals';
import type { RunContext } from './worker';
import { parseModelJson } from '../../model-output/src';

/** The domain supplies only tools currently authorized for this Goal revision.
 * Input schemas are frozen with the Sampling and checked again by the domain
 * before a new CALL is accepted. No domain object is imported by this module. */
export type GoalTool = { id: string; version: string; description: string; inputSchema: Record<string, unknown> };
export type DecisionInput = {
  prompt: string;
  systemInstruction?: string;
  contextRef?: ModelRequest['contextRef'];
  inputManifest?: Record<string, unknown>;
  allowedTools: GoalTool[];
};
export type GoalProgress = { fingerprint: string; remainingWork: string[] };
export type CompletionAssessment = {
  complete: boolean;
  gaps: string[];
  verifiedArtifactRefs: ResourceRef[];
  evidence: ResourceRef[];
  /** Revalidated synchronously by GoalStore inside the finish transaction. */
  completionProof?: unknown;
};
export interface DomainGoalPlugin {
  buildDecisionInput(execution: GoalExecution, turn: ExecutionTurn, signal: AbortSignal): Promise<DecisionInput>;
  /** Must validate the frozen tool arguments, current scope, resources and
   * authorization. It runs before accepting a new decision, never as a second
   * authorization for an already committed receipt. */
  authorizeCall(execution: GoalExecution, decision: Extract<Decision, { kind: 'CALL' }>, sampling: Sampling, signal: AbortSignal): Promise<void>;
  /** Pure deterministic read of actual artifacts, coverage and unresolved
   * issues. Plan prose and model claims must not change this fingerprint. */
  projectProgress(execution: GoalExecution, signal: AbortSignal): Promise<GoalProgress>;
  /** A FINISH is only a proposal; this check reads domain facts and must not
   * mutate the workspace. The host still fences final state changes. */
  assessCompletion(execution: GoalExecution, decision: Extract<Decision, { kind: 'FINISH' }>, signal: AbortSignal): Promise<CompletionAssessment>;
}

const refSchema = { type: 'object', additionalProperties: false, required: ['uri', 'version', 'contentHash', 'branch'], properties: {
  uri: { type: 'string' }, version: { type: 'string' }, contentHash: { type: 'string' }, branch: { type: 'string' },
} } as const;
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const stringSchema = { type: 'string' };
const stringArraySchema = { type: 'array', items: stringSchema };
const planSchema = { type: 'object', additionalProperties: false, required: ['summary', 'intentions'], properties: {
  summary: stringSchema,
  intentions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'description', 'evidenceRefs'], properties: {
    id: stringSchema, description: stringSchema, evidenceRefs: { type: 'array', items: refSchema },
  } } },
} };

/** Root-object strict schema accepted by structured-output transports. Branches
 * have nullable unused fields; parseDecision enforces the discriminated union. */
export function decisionOutputSchema(tools: GoalTool[]): Record<string, unknown> {
  const argumentSchemas = tools.map(tool => tool.inputSchema);
  return { type: 'object', additionalProperties: false,
    required: ['kind', 'capabilityId', 'capabilityVersion', 'arguments', 'planUpdate', 'message', 'choices', 'artifactRefs', 'summary', 'reason', 'remainingWork'],
    properties: {
      kind: { type: 'string', enum: ['CALL', 'ASK', 'FINISH', 'STOP'] },
      capabilityId: nullable(stringSchema), capabilityVersion: nullable(stringSchema),
      arguments: { anyOf: [...argumentSchemas, { type: 'null' }] },
      planUpdate: nullable(planSchema), message: nullable(stringSchema),
      choices: nullable({ type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: stringSchema, text: stringSchema } } }),
      artifactRefs: nullable({ type: 'array', items: refSchema }), summary: nullable(stringSchema),
      reason: nullable(stringSchema), remainingWork: nullable(stringArraySchema),
    },
  };
}

const fields = ['kind', 'capabilityId', 'capabilityVersion', 'arguments', 'planUpdate', 'message', 'choices', 'artifactRefs', 'summary', 'reason', 'remainingWork'];
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const resourceRef = (value: unknown): value is ResourceRef => object(value) && Object.keys(value).sort().join() === 'branch,contentHash,uri,version' &&
  nonempty(value.uri) && nonempty(value.version) && nonempty(value.contentHash) && nonempty(value.branch);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();
const fail = (message: string): never => { throw new AgentError('DECISION_INVALID', message, 422); };
const unusedNull = (value: Record<string, unknown>, used: string[]) => fields.every(key => used.includes(key) || value[key] === null);

export function parseDecision(raw: string): Decision {
  let value: unknown;
  try { value = parseModelJson(raw); } catch { return fail('模型决策不是有效 JSON'); }
  if (!object(value) || !exact(value, fields)) return fail('模型决策字段不符合冻结 schema');
  if (value.kind === 'CALL') {
    if (!unusedNull(value, ['kind', 'capabilityId', 'capabilityVersion', 'arguments', 'planUpdate']) || !nonempty(value.capabilityId) || !nonempty(value.capabilityVersion) || !object(value.arguments)) return fail('CALL 缺少有效工具身份或参数');
    let planUpdate: PlanUpdate | null = null;
    if (value.planUpdate !== null) {
      if (!object(value.planUpdate) || !exact(value.planUpdate, ['summary', 'intentions']) || typeof value.planUpdate.summary !== 'string' || !Array.isArray(value.planUpdate.intentions) ||
        !value.planUpdate.intentions.every(item => object(item) && exact(item, ['id', 'description', 'evidenceRefs']) && nonempty(item.id) && nonempty(item.description) && Array.isArray(item.evidenceRefs) && item.evidenceRefs.every(resourceRef))) return fail('CALL 计划修订格式无效');
      planUpdate = value.planUpdate as PlanUpdate;
    }
    return { kind: 'CALL', capabilityId: value.capabilityId, capabilityVersion: value.capabilityVersion, arguments: value.arguments, planUpdate };
  }
  if (value.kind === 'ASK') {
    if (!unusedNull(value, ['kind', 'message', 'choices']) || !nonempty(value.message) || !Array.isArray(value.choices) || value.choices.length > 10 ||
      !value.choices.every(choice => object(choice) && exact(choice, ['id', 'text']) && nonempty(choice.id) && nonempty(choice.text)) ||
      new Set(value.choices.map(choice => choice.id)).size !== value.choices.length) return fail('ASK 消息或选项无效');
    return { kind: 'ASK', message: value.message, choices: value.choices as Array<{ id: string; text: string }> };
  }
  if (value.kind === 'FINISH') {
    if (!unusedNull(value, ['kind', 'artifactRefs', 'summary']) || !Array.isArray(value.artifactRefs) || !value.artifactRefs.every(resourceRef) || !nonempty(value.summary)) return fail('FINISH 交付引用或摘要无效');
    return { kind: 'FINISH', artifactRefs: value.artifactRefs, summary: value.summary };
  }
  if (value.kind === 'STOP') {
    if (!unusedNull(value, ['kind', 'reason', 'remainingWork']) || !nonempty(value.reason) || !stringArray(value.remainingWork)) return fail('STOP 原因或剩余事项无效');
    return { kind: 'STOP', reason: value.reason, remainingWork: value.remainingWork };
  }
  return fail('未知模型决策种类');
}

function frozenTools(sampling: Sampling): GoalTool[] {
  const tools = sampling.modelRequest.inputManifest?.allowedGoalTools;
  if (!Array.isArray(tools) || hashValue(tools) !== sampling.allowedToolsDigest) throw new AgentError('DECISION_TOOLS_INVALID', '模型可用工具清单与冻结采样不一致');
  return tools as GoalTool[];
}
function verifyTools(tools: GoalTool[]) {
  if (tools.length > 64 || new Set(tools.map(tool => `${tool.id}@${tool.version}`)).size !== tools.length ||
    tools.some(tool => !nonempty(tool.id) || !nonempty(tool.version) || !nonempty(tool.description) || !object(tool.inputSchema) || tool.inputSchema.type !== 'object' || tool.inputSchema.additionalProperties !== false)) {
    throw new AgentError('DECISION_TOOLS_INVALID', '可用工具缺少唯一身份或严格参数 schema');
  }
}

export class DecisionDriver {
  constructor(private readonly goals: GoalStorePort, private readonly journal: ModelJournal, private readonly transport: ModelTransport,
    private readonly plugin: DomainGoalPlugin, private readonly options: { maxNoProgressStreak?: number } = {}) {
    const limit = options.maxNoProgressStreak ?? 3;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new AgentError('DECISION_LIMIT_INVALID', '无进展上限必须为正整数');
  }

  async handle(context: RunContext): Promise<RunOutcome> {
    const { token, signal } = context;
    const heartbeatBoundary = async () => {
      await context.checkpoint();
      signal.throwIfAborted();
    };
    for (;;) {
      signal.throwIfAborted();
      const execution = this.goals.execution(token);
      if (execution.run.id !== context.run.id || execution.link.role !== 'GOAL_CONTROLLER' || execution.link.goalId !== execution.goal.id) throw new AgentError('GOAL_BINDING_INVALID', '运行未绑定当前目标');
      const turn = this.goals.openTurn(token);
      if (turn.runId !== context.run.id || turn.inputGeneration !== token.inputRevision || turn.state === 'SUPERSEDED') throw new AgentError('GOAL_TURN_INVALID', '执行回合不属于当前输入版本');
      if (turn.state === 'WAITING_INPUT') return { kind: 'WAIT', status: 'WAITING_INPUT', reason: '等待作者输入' };
      if (turn.state !== 'OPEN' && turn.state !== 'WAITING_TOOL') throw new AgentError('GOAL_TURN_INVALID', '当前回合不能继续选择工具');
      const index = turn.nextDecisionIndex;
      let sampling = this.goals.readSampling(turn.id, index);
      if (!sampling) {
        if (execution.link.noProgressStreak >= (this.options.maxNoProgressStreak ?? 3)) {
          const progress = await this.plugin.projectProgress(execution, signal);
          return { status: 'PARTIAL', result: { reason: 'NO_PROGRESS_LIMIT', remainingWork: execution.link.lastFeedback.length ? execution.link.lastFeedback : progress.remainingWork } };
        }
        if (turn.decisionsUsed >= turn.limits.maxDecisions || turn.toolsUsed >= turn.limits.maxToolCalls) {
          if (execution.budget.used.turns >= execution.budget.limits.maxTurns) return { status: 'PARTIAL', result: { reason: 'TURN_BUDGET_EXHAUSTED', remainingWork: (await this.plugin.projectProgress(execution, signal)).remainingWork } };
          this.goals.yieldTurn(token);
          return { kind: 'YIELD' };
        }
        const progress = await this.plugin.projectProgress(execution, signal);
        // Domain projections may contain a long synchronous source check. Let
        // the lease heartbeat run between independent validation snapshots.
        await heartbeatBoundary();
        const input = await this.plugin.buildDecisionInput(execution, turn, signal);
        await heartbeatBoundary();
        if (!nonempty(input.prompt) || !nonempty(progress.fingerprint) || !stringArray(progress.remainingWork)) throw new AgentError('DECISION_INPUT_INVALID', '决策输入或进展投影无效');
        verifyTools(input.allowedTools);
        const request: ModelRequest = {
          operationKey: `decision:${turn.id}:${index}`,
          channel: execution.revision.route.channel,
          routeRef: execution.revision.route.routeRef,
          prompt: input.prompt,
          ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
          ...(input.contextRef ? { contextRef: input.contextRef } : {}),
          outputSchema: decisionOutputSchema(input.allowedTools),
          inputManifest: { ...input.inputManifest, allowedGoalTools: input.allowedTools },
        };
        sampling = this.goals.saveSampling(token, { turnId: turn.id, index, modelRequest: request, allowedToolsDigest: hashValue(input.allowedTools), progressFingerprint: progress.fingerprint });
        await heartbeatBoundary();
      }
      if (sampling.turnId !== turn.id || sampling.index !== index || sampling.inputGeneration !== token.inputRevision || !nonempty(sampling.progressFingerprint)) throw new AgentError('SAMPLING_IDENTITY_INVALID', '持久采样与当前回合不匹配');
      const tools = frozenTools(sampling);
      let accepted = sampling.acceptedDecision;
      if (accepted?.consumed) throw new AgentError('DECISION_POINTER_INVALID', '已消费决策仍占据当前执行指针');
      if (!accepted) {
        const result = await invokeModel(this.journal, this.transport, token, sampling.modelRequest, signal);
        await heartbeatBoundary();
        let decision: Decision;
        try {
          decision = parseDecision(result.text);
          if (decision.kind === 'CALL') {
            const callDecision = decision;
            if (!tools.some(tool => tool.id === callDecision.capabilityId && tool.version === callDecision.capabilityVersion)) throw new AgentError('DECISION_TOOL_DENIED', '模型请求的工具不在冻结可用清单中');
            await this.plugin.authorizeCall(execution, callDecision, sampling, signal);
            await heartbeatBoundary();
          }
        } catch (error) {
          if (error instanceof ExecutionInvalidated) throw error;
          if (error instanceof AgentError && !(error instanceof ExecutionSuspended) && !['LEASE_LOST', 'LEASE_RENEWAL_UNAVAILABLE'].includes(error.code)) return { status: 'PARTIAL', result: { reason: error.code, message: error.message, rawInvocationRetained: true } };
          throw error;
        }
        accepted = this.goals.acceptDecision(token, sampling.id, decision);
      }
      await heartbeatBoundary();
      const decision = accepted.decision;
      if (decision.kind === 'CALL') {
        if (!accepted.callId) throw new AgentError('DECISION_CALL_ID_MISSING', '已接受工具决策缺少稳定调用身份');
        const request: CapabilityRequest = { capabilityId: decision.capabilityId, capabilityVersion: decision.capabilityVersion, input: decision.arguments, callId: accepted.callId };
        await context.call(request, () => {
          try { this.journal.assertInput(token, sampling.modelRequest); }
          catch (error) { throw new ExecutionInvalidated(error instanceof AgentError ? error.code : 'DECISION_INPUT_REVOKED',
            error instanceof Error ? error.message : '决策依赖的输入已不可消费'); }
        });
        await heartbeatBoundary();
        // The store resolves this stable call ID to an actual COMMITTED step and
        // atomically records the observation, pointer and progress comparison.
        const after = await this.plugin.projectProgress(this.goals.execution(token), signal);
        await heartbeatBoundary();
        this.goals.consumeReceipt(token, accepted.id, undefined, { before: sampling.progressFingerprint, after: after.fingerprint });
        await heartbeatBoundary();
        continue;
      }
      const after = await this.plugin.projectProgress(this.goals.execution(token), signal);
      await heartbeatBoundary();
      const progress = { before: sampling.progressFingerprint, after: after.fingerprint };
      if (decision.kind === 'ASK') {
        this.goals.awaitDecision(token, accepted.id, progress);
        return { kind: 'SETTLED' };
      }
      if (decision.kind === 'STOP') {
        this.goals.finishDecision(token, accepted.id, { status: 'PARTIAL', result: { reason: decision.reason, remainingWork: decision.remainingWork } }, progress);
        return { kind: 'SETTLED' };
      }
      const assessment = await this.plugin.assessCompletion(this.goals.execution(token), decision, signal);
      await heartbeatBoundary();
      if (!assessment.complete || assessment.gaps.length || assessment.completionProof === undefined ||
        decision.artifactRefs.some(ref => !assessment.verifiedArtifactRefs.some(verified => hashValue(ref) === hashValue(verified)))) {
        const gaps = assessment.gaps.length ? assessment.gaps : ['交付引用或完成证明未通过领域完成校验'];
        this.goals.advanceDecision(token, accepted.id, progress, gaps);
        await heartbeatBoundary();
        continue;
      }
      this.goals.finishDecision(token, accepted.id, { status: 'SUCCEEDED', result: {
        summary: decision.summary, artifactRefs: assessment.verifiedArtifactRefs, evidence: assessment.evidence,
      } }, progress, assessment.completionProof);
      return { kind: 'SETTLED' };
    }
  }
}
