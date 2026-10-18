import { createHash } from "node:crypto";

import type {
  AssistantContextSnapshot,
  AssistantConversationCheckpoint,
  AssistantMessage,
  AssistantPageFocus,
  AssistantProjectRef,
  AssistantRun,
  AssistantThread,
} from "../../../packages/domain/src/assistant";
import { scriptRepository } from "../../../apps/api/src/repositories/scriptRepository";
import { assistantRepository, type AssistantRepository } from "../../server/assistantRepository";
import { dbHelpers } from "../../server/db";

const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const id = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 3.2);

const projectSummary = (projectRef?: AssistantProjectRef): Record<string, unknown> => {
  if (!projectRef) return {
    mode: "global",
    summary: "未绑定项目的全局会话",
    writingProjects: scriptRepository.listProjects().map((project) => ({
      id: project.id,
      title: project.title,
      format: project.format,
      writtenUnitCount: project.writtenUnitCount,
      updatedAt: project.updatedAt,
    })),
    productionProjects: dbHelpers.getProjectSummaries()
      .filter((project: any) => (
        project.domain !== "interactive"
        && project.projectModel !== "interactive"
        && !project.interactiveTemplate
      ))
      .map((project: any) => ({
        id: project.id,
        title: project.title,
        type: project.type,
        sourceWritingProjectId: project.productionSourceSnapshot?.sourceWritingProjectId,
        trashed: Boolean(project.productionTrashedAt),
      })),
  };
  if (projectRef.namespace === "writing") {
    const project = scriptRepository.getProject(projectRef.projectId);
    if (!project) throw new Error("Writing project not found.");
    return {
      id: project.id,
      namespace: "writing",
      title: project.title,
      format: project.profile.workType,
      revision: project.revision,
      targetUnitCount: project.profile.plannedUnits,
      units: project.units.map((unit) => ({
        id: unit.id,
        index: project.units.indexOf(unit)+1,
        title: unit.title,
        summary: unit.summary,
        hasScript: unit.scenes.some(scene=>scene.blocks.some(block=>block.text.trim())),
      })),

    };
  }
  const project = dbHelpers.getProjectById(projectRef.projectId);
  if (!project) throw new Error("Project not found.");
  return {
    id: project.id,
    namespace: projectRef.namespace,
    title: project.title,
    type: project.type,
    projectModel: project.projectModel,
    sourceImportId: project.sourceImportId,
    sourceProjectId: project.sourceProjectId,
    episodes: (project.episodes || []).map((episode: any) => ({
      id: episode.id,
      title: episode.title,
      sourceDocumentId: episode.sourceDocumentId,
      sceneCount: episode.scenes?.length || 0,
      confirmedBreakdowns: (episode.scenes || []).filter((scene: any) => scene.productionPreparation?.breakdown?.status === "confirmed").length,
      departmentStates: (episode.productionTeam?.outputs || []).map((output: any) => ({
        department: output.department,
        status: output.status,
        score: output.qa?.score,
        verdict: output.qa?.verdict,
      })),
    })),
  };
};

export const ensureAssistantProjectThread = (
  projectRef: AssistantProjectRef | undefined,
  options: { title?: string; pageFocus?: AssistantPageFocus } = {},
  repository: AssistantRepository = assistantRepository,
): AssistantThread => {
  const existing = repository.listThreads(projectRef).find((thread) => thread.status === "active");
  if (existing) {
    const next = {
      ...existing,
      lastPageFocus: options.pageFocus || existing.lastPageFocus,
      lastOpenedAt: Date.now(),
      updatedAt: Math.max(existing.updatedAt, Date.now()),
    };
    return repository.saveThread(next);
  }
  const now = Date.now();
  return repository.saveThread({
    id: id("assistant-thread"),
    projectRef,
    title: options.title?.trim() || (projectRef ? "项目主会话" : "全局会话"),
    status: "active",
    pinned: true,
    lastPageFocus: options.pageFocus,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  });
};

export const buildAssistantContextSnapshot = (
  thread: AssistantThread,
  pageFocus?: AssistantPageFocus,
  repository: AssistantRepository = assistantRepository,
): AssistantContextSnapshot => {
  const messages = repository.listMessages(thread.id, 80);
  const latestCheckpoint = repository.getLatestCheckpoint(thread.id) || undefined;
  const activeRuns = repository.listRuns(thread.projectRef, ["waiting_approval", "queued", "running", "qa", "repairing", "needs_decision", "ready_to_adopt"])
    .filter((run) => run.threadId === thread.id);
  const summary = projectSummary(thread.projectRef);
  const recentMessages = messages.slice(-24);
  const snapshotBase = {
    threadId: thread.id,
    projectRef: thread.projectRef,
    pageFocus: pageFocus || thread.lastPageFocus,
    projectSummary: summary,
    latestCheckpoint,
    recentMessages,
    activeRuns,
  };
  const snapshot: AssistantContextSnapshot = {
    id: id("assistant-context"),
    ...snapshotBase,
    estimatedTokens: estimateTokens(snapshotBase),
    sourceHash: hash(snapshotBase),
    createdAt: Date.now(),
  };
  return repository.saveContextSnapshot(snapshot);
};

export interface AssistantCheckpointGenerator {
  (input: { prompt: string; systemInstruction?: string; responseSchema?: Record<string, unknown> }): Promise<Record<string, unknown>>;
}

const checkpointPrompt = (messages: AssistantMessage[], runs: AssistantRun[]) => [
  "请把以下助手会话压缩为可恢复的结构化检查点。不要把聊天主张当作项目正式事实。",
  "必须保留：当前目标、用户已明确决定、不可违反约束、未完成事项、实体引用、运行任务引用和稳定用户偏好。",
  "所有 decisions、constraints、userPreferences 都必须引用 sourceMessageIds；不确定的信息不要写成决定。",
  "返回 JSON：",
  JSON.stringify({
    goal: "当前目标",
    decisions: [{ text: "决定", sourceMessageIds: ["message-id"] }],
    constraints: [{ text: "约束", sourceMessageIds: ["message-id"] }],
    openLoops: [{ text: "未完成事项", runId: "可选", stepId: "可选" }],
    entityRefs: [{ type: "episode|segment|scene|shot|asset|node|source", id: "id", label: "可选" }],
    runRefs: ["run-id"],
    userPreferences: [{ text: "偏好", sourceMessageIds: ["message-id"] }],
    summary: "压缩摘要",
  }, null, 2),
  "会话消息：",
  JSON.stringify(messages.map((message) => ({ id: message.id, role: message.role, blocks: message.blocks })), null, 2),
  "当前任务：",
  JSON.stringify(runs.map((run) => ({ id: run.id, goal: run.goal, status: run.status, summary: run.summary, currentStepId: run.currentStepId })), null, 2),
].join("\n\n");

const validSourceIds = (messages: AssistantMessage[]) => new Set(messages.map((message) => message.id));

export const compactAssistantConversation = async (
  thread: AssistantThread,
  generator: AssistantCheckpointGenerator,
  repository: AssistantRepository = assistantRepository,
): Promise<AssistantConversationCheckpoint | null> => {
  const messages = repository.listMessages(thread.id, 500);
  const maxContextTokens = Math.max(16_000, Number(process.env.ASSISTANT_MAX_CONTEXT_TOKENS) || 64_000);
  const triggerRatio = Math.min(0.9, Math.max(0.5, Number(process.env.ASSISTANT_COMPACTION_TRIGGER_RATIO) || 0.7));
  if (estimateTokens(messages) < maxContextTokens * triggerRatio || messages.length < 12) return null;
  const coveredMessages = messages.slice(0, -8);
  if (!coveredMessages.length) return null;
  const runs = repository.listRuns(thread.projectRef).filter((run) => run.threadId === thread.id);
  const prompt = checkpointPrompt(coveredMessages, runs);
  const result = await generator({
    systemInstruction: "你是会话记忆管理员。只压缩用户明确表达和可引用的任务事实，不推断项目正式事实。",
    prompt,
  });
  const sources = validSourceIds(coveredMessages);
  const rows = <T extends { sourceMessageIds?: unknown }>(value: unknown) => Array.isArray(value)
    ? value.filter((item): item is T => Boolean(item && typeof item === "object")).map((item) => ({
        ...item,
        sourceMessageIds: Array.isArray(item.sourceMessageIds) ? item.sourceMessageIds.filter((messageId): messageId is string => typeof messageId === "string" && sources.has(messageId)) : [],
      })).filter((item) => item.sourceMessageIds.length)
    : [];
  const checkpoint: AssistantConversationCheckpoint = {
    id: id("assistant-checkpoint"),
    threadId: thread.id,
    projectRef: thread.projectRef,
    coveredMessageIds: coveredMessages.map((message) => message.id),
    goal: String(result.goal || "").trim(),
    decisions: rows(result.decisions) as AssistantConversationCheckpoint["decisions"],
    constraints: rows(result.constraints) as AssistantConversationCheckpoint["constraints"],
    openLoops: Array.isArray(result.openLoops) ? result.openLoops as AssistantConversationCheckpoint["openLoops"] : [],
    entityRefs: Array.isArray(result.entityRefs) ? result.entityRefs as AssistantConversationCheckpoint["entityRefs"] : [],
    runRefs: Array.isArray(result.runRefs) ? result.runRefs.map(String).filter((runId) => runs.some((run) => run.id === runId)) : [],
    userPreferences: rows(result.userPreferences) as AssistantConversationCheckpoint["userPreferences"],
    summary: String(result.summary || "").trim(),
    sourceHash: hash(coveredMessages),
    prompt,
    promptHash: hash(prompt),
    estimatedInputTokens: estimateTokens(prompt),
    createdAt: Date.now(),
  };
  const saved = repository.saveCheckpoint(checkpoint);
  repository.saveMessage({
    id: id("assistant-message"),
    threadId: thread.id,
    projectRef: thread.projectRef,
    role: "system",
    blocks: [{
      type: "system_event",
      title: "会话上下文已压缩",
      detail: `已把 ${coveredMessages.length} 条旧消息整理为可恢复检查点；原始消息和压缩 Prompt 均保留。`,
    }],
    runIds: saved.runRefs,
    createdAt: Date.now(),
  });
  return saved;
};

export const getAssistantProjectSummary = projectSummary;
