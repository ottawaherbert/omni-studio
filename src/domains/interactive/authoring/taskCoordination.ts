import type { InteractiveContentWritingRequest } from '../contentPlanning/contentPlan';

export type InteractiveExecutionPolicy = 'autopilot' | 'guided';

export type InteractiveTaskOwner =
  | 'interactive_graph'
  | 'writing'
  | 'content_plan'
  | 'production'
  | 'runtime';

export type InteractiveTaskStatus =
  | 'working'
  | 'review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'stale';

export type InteractiveTaskRetryContext =
  | {
      kind: 'interactive_graph';
      action: 'initial' | 'blueprint' | 'golden_path' | 'extend' | 'strategy' | 'repair' | 'revise';
      authorIntent: string;
      revisionOfDraftId?: string;
      scopeNodeId?: string;
      strategy?: 'foldback' | 'parallel' | 'failure';
      issueIds?: string[];
    }
  | {
      kind: 'writing';
      authorFeedback?: string;
      confirmedCheckpoint?: 'blueprint' | 'structure' | 'script';
      writingRequests?: InteractiveContentWritingRequest[];
      sourceWritingRevision?: number;
    }
  | { kind: 'content_plan'; authorIntent: string }
  | { kind: 'production_plan' }
  | { kind: 'media_plan' }
  | { kind: 'media_revision'; planId: string; nodeId: string; scenarioId?: string; feedback: string }
  | { kind: 'runtime'; buildKind: 'structure' | 'formal' };

export interface InteractiveTaskRef {
  owner: InteractiveTaskOwner;
  taskId: string;
  purpose: string;
  dependsOn: string[];
  inputFingerprint: string;
  idempotencyKey: string;
  status?: InteractiveTaskStatus;
  attempt?: number;
  error?: string;
  updatedAt?: string;
  /** Internal, persisted input required to retry only this task after refresh. */
  retryContext?: InteractiveTaskRetryContext;
}

export type InteractiveProposalKind = 'interactive_graph' | 'content_plan' | 'production_plan' | 'media_plan';

export interface InteractiveProposalAdoptionResult {
  kind: InteractiveProposalKind;
  candidateId: string;
  status: 'adopted' | 'skipped' | 'failed';
  message: string;
}

export interface InteractiveProposalAdoptionRun {
  idempotencyKey: string;
  candidateRefs: Array<{ kind: InteractiveProposalKind; candidateId: string }>;
  results: InteractiveProposalAdoptionResult[];
  status: 'working' | 'complete' | 'partial';
  updatedAt: string;
}

export interface InteractiveTaskCoordination {
  experienceId: string;
  executionPolicy: InteractiveExecutionPolicy;
  taskRefs: InteractiveTaskRef[];
  adoptionRuns: InteractiveProposalAdoptionRun[];
  paused: boolean;
  updatedAt: string;
}

const taskStatus = (task: InteractiveTaskRef): InteractiveTaskStatus =>
  task.status || 'working';

/**
 * Provider work remains active until the provider, author, or durable worker
 * records a terminal status. Elapsed wall time alone must not manufacture a
 * failed model result.
 */
export const recoverInterruptedInteractiveTaskRefs = (
  taskRefs: InteractiveTaskRef[],
): InteractiveTaskRef[] => taskRefs;

export const upsertInteractiveTaskRef = (
  taskRefs: InteractiveTaskRef[],
  taskRef: InteractiveTaskRef,
): InteractiveTaskRef[] => {
  const existing = taskRefs.find((item) => item.idempotencyKey === taskRef.idempotencyKey);
  if (
    existing
    && existing.inputFingerprint === taskRef.inputFingerprint
    && ['working', 'review', 'completed'].includes(taskStatus(existing))
  ) {
    return taskRefs;
  }
  const next = {
    ...taskRef,
    status: taskRef.status || 'working',
    attempt: taskRef.attempt || 1,
    updatedAt: taskRef.updatedAt || new Date().toISOString(),
  };
  return [
    ...taskRefs.filter((item) => item.idempotencyKey !== taskRef.idempotencyKey),
    next,
  ];
};

export const transitionInteractiveTaskRef = (
  taskRefs: InteractiveTaskRef[],
  taskId: string,
  status: InteractiveTaskStatus,
  options: { error?: string; replacementTaskId?: string } = {},
): InteractiveTaskRef[] => taskRefs.map((task) => {
  if (task.taskId !== taskId) return task;
  if (taskStatus(task) === 'cancelled' && status !== 'cancelled') return task;
  return {
    ...task,
    taskId: options.replacementTaskId || task.taskId,
    status,
    error: status === 'failed' ? options.error || '任务失败' : undefined,
    updatedAt: new Date().toISOString(),
  };
});

export const retryInteractiveTaskRef = (
  taskRefs: InteractiveTaskRef[],
  taskId: string,
  replacementTaskId: string,
): InteractiveTaskRef[] => {
  const task = taskRefs.find((item) => item.taskId === taskId);
  if (!task) throw new Error('任务不存在');
  if (!['failed', 'cancelled', 'stale'].includes(taskStatus(task))) {
    throw new Error('只有失败、已取消或已过期的任务可以局部重试');
  }
  return taskRefs.map((item) => item.taskId === taskId ? {
    ...item,
    taskId: replacementTaskId,
    status: 'working',
    attempt: (item.attempt || 1) + 1,
    error: undefined,
    updatedAt: new Date().toISOString(),
  } : item);
};

export const failedTaskDependencies = (
  task: InteractiveTaskRef,
  taskRefs: InteractiveTaskRef[],
): InteractiveTaskRef[] => {
  const dependencies = new Set(task.dependsOn);
  return taskRefs.filter((candidate) => (
    dependencies.has(candidate.taskId)
    && ['failed', 'cancelled', 'stale'].includes(taskStatus(candidate))
  ));
};
