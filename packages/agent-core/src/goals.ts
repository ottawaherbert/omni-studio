import type { AgentRun, RunStatus } from './execution';
import type { ModelRequest } from './model';
import type { ExecutionToken, Observation, ResourceRef } from './protocol';

export type BudgetLimits = { maxInvocations: number; maxToolCalls: number; maxTurns: number; maxRepairRounds: number; maxActiveMs?: number; deadlineAt?: number };
export type BudgetSnapshot = { id: string; ownerId: string; version: number; limits: BudgetLimits; used: { invocations: number; toolCalls: number; turns: number; repairRounds: number; attempts: number; inputTokens: number; outputTokens: number; unknownUsageAttempts: number; activeMs: number } };
export type TurnLimits = { maxDecisions: number; maxToolCalls: number };
export type DomainGoalContract = { pluginId: string; version: string; value: unknown; digest: string };
export type GoalAnswerInput = { decisionId: string; text: string; choiceId?: string };
export type GoalAuthorAnswer = GoalAnswerInput & { runId: string; goalRevision: number };
export type GoalQuestion = { decisionId: string; runId: string; goalRevision: number; message: string; choices: Array<{ id: string; text: string }> };
export type GoalRevisionInput = {
  objective: string; contract: DomainGoalContract; authorizationRef: string;
  authorAnswers?: GoalAuthorAnswer[];
  workspaceRef: ResourceRef; sourceRefs: ResourceRef[]; skillManifest: unknown;
  route: { channel: 'api' | 'external'; routeRef: string };
  stopPolicy: 'CONTRACT_COMPLETE' | 'WAIT_FOR_AUTHOR'; turnLimits: TurnLimits;
};
export type GoalRevision = GoalRevisionInput & { goalId: string; revision: number; authorCommandId: string; budgetId: string; supersedesRevision: number | null };
export type GoalSnapshot = { id: string; ownerId: string; threadId: string; scopeId: string; version: number; activeRevision: number; activeRunId: string | null; revision: GoalRevision };
export type RunLink = {
  runId: string; goalId: string | null; goalRevision: number | null;
  role: 'GOAL_CONTROLLER' | 'MANUAL_STEP' | 'STANDALONE';
  workspaceRef: ResourceRef | null; authorizationRef: string; budgetId: string;
  activeTurnId: string | null; activePlanRef: string | null;
  noProgressStreak: number;
  lastFeedback: string[];
};
export type PlanRevision = { id: string; goalId: string; goalRevision: number; revision: number; summary: string; intentions: Array<{ id: string; description: string; evidenceRefs: ResourceRef[] }>; supersedes: string | null; decisionId: string | null };
export type PlanUpdate = Pick<PlanRevision, 'summary' | 'intentions'>;
export type Decision =
  | { kind: 'CALL'; capabilityId: string; capabilityVersion: string; arguments: unknown; planUpdate: PlanUpdate | null }
  | { kind: 'ASK'; message: string; choices: Array<{ id: string; text: string }> }
  | { kind: 'FINISH'; artifactRefs: ResourceRef[]; summary: string }
  | { kind: 'STOP'; reason: string; remainingWork: string[] };
export type ExecutionTurn = {
  id: string; runId: string; ordinal: number; inputGeneration: number;
  source: 'AUTHOR_COMMAND' | 'CONTINUATION' | 'CONTROL'; sourceCommandId: string | null; planRef: string | null;
  state: 'OPEN' | 'WAITING_TOOL' | 'WAITING_INPUT' | 'YIELDED' | 'CLOSED' | 'SUPERSEDED';
  nextDecisionIndex: number; decisionsUsed: number; toolsUsed: number;
  pendingDecisionId: string | null; limits: TurnLimits;
};
export type DecisionReceipt = { id: string; samplingId: string; turnId: string; decision: Decision; callId: string | null; stepId: string | null; consumed: boolean };
export type Sampling = {
  id: string; turnId: string; index: number; inputGeneration: number;
  modelRequest: ModelRequest; allowedToolsDigest: string;
  progressFingerprint: string | null;
  acceptedDecision: DecisionReceipt | null;
};
export type SamplingPreparation = { turnId: string; index: number; modelRequest: ModelRequest; allowedToolsDigest: string; progressFingerprint?: string };
export type ProgressComparison = { before: string; after: string };
export type GoalExecution = { token: ExecutionToken; run: AgentRun; link: RunLink; goal: GoalSnapshot; revision: GoalRevision; budget: BudgetSnapshot };
export type GoalReceipt = { goalId: string; goalRevision: number; runId: string; threadId: string; budgetId: string; workspaceRef: ResourceRef };
export type GoalAcceptance = GoalRevisionInput & { requestId: string; requestEnvelope: unknown; ownerId: string; scopeId: string; threadId?: string; policyRevision: string; budgetLimits: BudgetLimits };
export type GoalRevisionCommand = { goalId: string; ownerId: string; expectedVersion: number; expectedRunVersion: number; requestId: string; requestEnvelope: unknown; revision: GoalRevisionInput };
export type GoalContinueCommand = Omit<GoalRevisionCommand, 'revision'> & { revision?: GoalRevisionInput; answer?: GoalAnswerInput };
export type ManualRunBinding = { runId: string; ownerId: string; goalId: string; expectedGoalVersion: number; authorizationRef?: string; workspaceRef?: ResourceRef };
/** Synchronous participants run on the store's connection inside the same short
 * transaction as every claim/wait/control/finish. They must not call a model. */
export interface RunLifecycleParticipant {
  canClaim?(run: AgentRun): boolean;
  transition(previous: AgentRun, next: AgentRun, cause: string): void;
}
export interface GoalStorePort {
  execution(token: ExecutionToken): GoalExecution;
  openTurn(token: ExecutionToken): ExecutionTurn;
  readSampling(turnId: string, index: number): Sampling | null;
  saveSampling(token: ExecutionToken, input: SamplingPreparation): Sampling;
  acceptDecision(token: ExecutionToken, samplingId: string, decision: Decision): DecisionReceipt;
  linkStep(token: ExecutionToken, decisionId: string, stepId: string): void;
  /** Resolve callId to its real COMMITTED Step when stepId is omitted. Advances
   * the decision pointer atomically, and returns only the stored observation. */
  consumeReceipt(token: ExecutionToken, decisionId: string, stepId?: string, progress?: ProgressComparison): Observation;
  advanceDecision(token: ExecutionToken, decisionId: string, progress?: ProgressComparison, feedback?: string[]): void;
  awaitDecision(token: ExecutionToken, decisionId: string, progress?: ProgressComparison): void;
  finishDecision(token: ExecutionToken, decisionId: string, outcome: { status: 'SUCCEEDED' | 'PARTIAL'; result: unknown }, progress?: ProgressComparison, proof?: unknown): void;
  yieldTurn(token: ExecutionToken): void;
}
export type RunOutcome =
  | { kind?: 'TERMINAL'; status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'; result: unknown }
  | { kind: 'YIELD' }
  | { kind: 'SETTLED' }
  | { kind: 'WAIT'; status: Extract<RunStatus, 'WAITING_INPUT' | 'NEEDS_REBASE'>; reason: string };
