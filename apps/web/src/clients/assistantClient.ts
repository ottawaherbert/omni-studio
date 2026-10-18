import { aiAwareFetch } from "./manualAIClient";
import type {
  AssistantAuthorization,
  AssistantChangeSet,
  AssistantMessage,
  AssistantPageFocus,
  AssistantPlan,
  AssistantProjectRef,
  AssistantPromptExecutionPreview,
  AssistantRun,
  AssistantThread,
  ProductionPreparationBatchRun,
} from "./domainTypes";

const readJson = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const writeJson = <T,>(url: string, method: "POST" | "PATCH", body: unknown) => aiAwareFetch(url, {
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}).then((response) => readJson<T>(response));

const projectQuery = (projectRef?: AssistantProjectRef) => projectRef
  ? `?namespace=${encodeURIComponent(projectRef.namespace)}&projectId=${encodeURIComponent(projectRef.projectId)}`
  : "";

export interface AssistantTurnResponse {
  userMessage: AssistantMessage;
  assistantMessage: AssistantMessage;
  plan?: AssistantPlan;
}

export interface AssistantApproveResponse {
  plan: AssistantPlan;
  run: AssistantRun;
  authorization: AssistantAuthorization;
  batch?: ProductionPreparationBatchRun;
  changeSet?: AssistantChangeSet;
}

export const assistantClient = {
  listThreads: (projectRef?: AssistantProjectRef) => aiAwareFetch(`/api/assistant/threads${projectQuery(projectRef)}`)
    .then((response) => readJson<{ threads: AssistantThread[] }>(response)),

  openDefaultThread: (projectRef: AssistantProjectRef | undefined, pageFocus?: AssistantPageFocus) => writeJson<{ thread: AssistantThread }>(
    "/api/assistant/threads/default",
    "POST",
    { ...projectRef, pageFocus },
  ),

  createThread: (projectRef: AssistantProjectRef | undefined, pageFocus?: AssistantPageFocus) => writeJson<{ thread: AssistantThread }>(
    "/api/assistant/threads",
    "POST",
    { ...projectRef, pageFocus, title: "新对话" },
  ),

  listMessages: (threadId: string) => aiAwareFetch(`/api/assistant/threads/${encodeURIComponent(threadId)}/messages`)
    .then((response) => readJson<{ messages: AssistantMessage[] }>(response)),

  sendMessage: (threadId: string, body: {
    goal: string;
    pageFocus?: AssistantPageFocus;
    capabilityId?: string;
    input?: Record<string, unknown>;
    selectedSkills?: Array<{ id: string; title: string; content: string }>;
  }) => writeJson<AssistantTurnResponse>(`/api/assistant/threads/${encodeURIComponent(threadId)}/messages`, "POST", body),

  getPlan: (planId: string) => aiAwareFetch(`/api/assistant/plans/${encodeURIComponent(planId)}`)
    .then((response) => readJson<{ plan: AssistantPlan }>(response)),

  approvePlan: (planId: string, body: {
    promptPreviews?: AssistantPromptExecutionPreview[];
    repairLimit?: number;
  }) => writeJson<AssistantApproveResponse>(`/api/assistant/plans/${encodeURIComponent(planId)}/approve`, "POST", body),

  cancelPlan: (planId: string) => writeJson<{ plan: AssistantPlan }>(`/api/assistant/plans/${encodeURIComponent(planId)}/cancel`, "POST", {}),

  getRun: (runId: string) => aiAwareFetch(`/api/assistant/runs/${encodeURIComponent(runId)}`)
    .then((response) => readJson<{ run: AssistantRun; batch?: ProductionPreparationBatchRun }>(response)),

  getChangeSet: (changeSetId: string) => aiAwareFetch(`/api/assistant/change-sets/${encodeURIComponent(changeSetId)}`)
    .then((response) => readJson<{ changeSet: AssistantChangeSet }>(response)),

  cancelRun: (runId: string) => writeJson<{ run: AssistantRun }>(`/api/assistant/runs/${encodeURIComponent(runId)}/cancel`, "POST", {}),

  resumeRun: (runId: string, instruction: string) => writeJson<{ run: AssistantRun; batch: ProductionPreparationBatchRun }>(
    `/api/assistant/runs/${encodeURIComponent(runId)}/resume`,
    "POST",
    { instruction },
  ),

  adoptPreparationBatch: (batchId: string) => writeJson<{
    batch: ProductionPreparationBatchRun;
    changeSet: AssistantChangeSet;
  }>(`/api/production/preparation-batch-runs/${encodeURIComponent(batchId)}/adopt`, "POST", {}),

  rollbackChangeSet: (changeSetId: string) => writeJson<{ changeSet: AssistantChangeSet }>(
    `/api/assistant/change-sets/${encodeURIComponent(changeSetId)}/rollback`,
    "POST",
    {},
  ),
};
