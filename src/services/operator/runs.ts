import {
  OPERATOR_HANDBOOK_VERSION,
  OperatorEvent,
  OperatorEventType,
  OperatorProvider,
  OperatorRun,
  OperatorRunMode,
  OperatorRunScope,
  OperatorRunStatus,
} from "./types";

const validProviders: OperatorProvider[] = ["codex", "claude_desktop", "cursor", "chatgpt_desktop", "other"];
const validModes: OperatorRunMode[] = ["produce", "qa", "repair", "asset_generation", "research"];
const validStatuses: OperatorRunStatus[] = ["running", "completed", "needs_human_review", "failed", "cancelled"];
const validEventTypes: OperatorEventType[] = [
  "context_read",
  "plan_created",
  "artifact_generated",
  "qa_started",
  "qa_passed",
  "qa_failed",
  "asset_generated",
  "db_write",
  "repair_applied",
  "blocked",
  "user_decision_required",
  "completed",
];

const toId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map((item) => String(item || "").trim()).filter(Boolean);
  return normalized.length ? normalized : undefined;
};

export const normalizeOperatorScope = (value: any, projectId: string): OperatorRunScope => ({
  projectId,
  episodeIds: normalizeStringArray(value?.episodeIds),
  sceneIds: normalizeStringArray(value?.sceneIds),
  shotIds: normalizeStringArray(value?.shotIds),
  assetIds: normalizeStringArray(value?.assetIds),
});

export const createOperatorRunRecord = (
  input: any,
  handbookVersion = OPERATOR_HANDBOOK_VERSION,
): OperatorRun => {
  const now = Date.now();
  const projectId = String(input?.projectId || input?.scope?.projectId || "").trim();
  if (!projectId) {
    throw new Error("OperatorRun requires projectId.");
  }
  const provider = validProviders.includes(input?.provider) ? input.provider : "other";
  const mode = validModes.includes(input?.mode) ? input.mode : "produce";
  const status = validStatuses.includes(input?.status) ? input.status : "running";
  return {
    id: String(input?.id || toId("operator_run")),
    projectId,
    provider,
    providerSessionId: input?.providerSessionId ? String(input.providerSessionId) : undefined,
    handbookVersion,
    mode,
    status,
    userRequest: String(input?.userRequest || "").trim(),
    scope: normalizeOperatorScope(input?.scope, projectId),
    events: Array.isArray(input?.events) ? input.events.map(createOperatorEvent) : [],
    outputs: Array.isArray(input?.outputs) ? input.outputs : [],
    qaSummary: {
      passed: Number(input?.qaSummary?.passed || 0),
      warnings: Number(input?.qaSummary?.warnings || 0),
      failed: Number(input?.qaSummary?.failed || 0),
      blocked: Number(input?.qaSummary?.blocked || 0),
    },
    startedAt: Number(input?.startedAt || now),
    updatedAt: Number(input?.updatedAt || now),
  };
};

export const mergeOperatorRunPatch = (existing: OperatorRun, patch: any): OperatorRun => {
  const merged = createOperatorRunRecord(
    {
      ...existing,
      ...patch,
      id: existing.id,
      projectId: existing.projectId,
      provider: patch?.provider || existing.provider,
      mode: patch?.mode || existing.mode,
      status: patch?.status || existing.status,
      scope: {
        ...existing.scope,
        ...(patch?.scope || {}),
        projectId: existing.projectId,
      },
      events: patch?.events || existing.events,
      outputs: patch?.outputs || existing.outputs,
      startedAt: existing.startedAt,
      updatedAt: Date.now(),
    },
    patch?.handbookVersion || existing.handbookVersion,
  );
  return merged;
};

export const createOperatorEvent = (input: any): OperatorEvent => {
  const type = validEventTypes.includes(input?.type) ? input.type : "context_read";
  return {
    id: String(input?.id || toId("operator_event")),
    type,
    message: String(input?.message || "").trim(),
    targetPath: input?.targetPath ? String(input.targetPath) : undefined,
    entityIds: normalizeStringArray(input?.entityIds),
    data: input?.data,
    createdAt: Number(input?.createdAt || Date.now()),
  };
};

export const appendOperatorEvent = (run: OperatorRun, eventInput: any): OperatorRun => ({
  ...run,
  events: [...(run.events || []), createOperatorEvent(eventInput)],
  updatedAt: Date.now(),
});
