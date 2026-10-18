import type { Express, Request, Response } from "express";

import type {
  AssistantPageFocus,
  AssistantProjectNamespace,
  AssistantProjectRef,
  AssistantPromptExecutionPreview,
  AssistantThread,
} from "../../packages/domain/src/assistant";
import { assistantCapabilityRegistry } from "../services/assistant/capabilities";
import { buildAssistantContextSnapshot, ensureAssistantProjectThread, getAssistantProjectSummary } from "../services/assistant/context";
import { createAssistantTurn, type AssistantPlannerGenerator } from "../services/assistant/plans";
import {
  adoptProductionPreparationBatch,
  ProductionPreparationBatchRuntime,
  rollbackAssistantChangeSet,
  type SelectedAssistantSkill,
} from "../services/assistant/productionPreparationBatch";
import { approveAssistantPlan, cancelAssistantRun, resumeAssistantRun } from "../services/assistant/runtime";
import { assistantRepository, AssistantRepositoryError } from "./assistantRepository";

export interface AssistantRoutesOptions {
  generator: AssistantPlannerGenerator;
  batchRuntime: ProductionPreparationBatchRuntime;
  assertProjectAccess?: (projectId?: string) => void;
}

const namespaces = new Set<AssistantProjectNamespace>(["writing", "production", "interactive"]);

const projectRefFrom = (value: { namespace?: unknown; projectId?: unknown }): AssistantProjectRef | undefined => {
  const namespace = String(value.namespace || "").trim() as AssistantProjectNamespace;
  const projectId = String(value.projectId || "").trim();
  if (!namespace && !projectId) return undefined;
  if (!namespaces.has(namespace) || !projectId) throw new AssistantRepositoryError(400, "assistant_project_scope_invalid", "Assistant project scope is invalid.");
  return { namespace, projectId };
};

const sendError = (res: Response, error: unknown, fallback: string) => {
  const typed = error as { statusCode?: number; code?: string; message?: string };
  res.status(typed.statusCode || 400).json({ error: typed.message || fallback, code: typed.code });
};

const assertScope = (ref: AssistantProjectRef | undefined, assertProjectAccess?: (projectId?: string) => void) => {
  if (ref?.namespace === "production" || ref?.namespace === "interactive") assertProjectAccess?.(ref.projectId);
};

const updateThread = (thread: AssistantThread, input: Record<string, unknown>): AssistantThread => ({
  ...thread,
  title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : thread.title,
  status: input.status === "archived" || input.status === "deleted" || input.status === "active" ? input.status : thread.status,
  pinned: typeof input.pinned === "boolean" ? input.pinned : thread.pinned,
  lastPageFocus: input.lastPageFocus && typeof input.lastPageFocus === "object" ? input.lastPageFocus as AssistantPageFocus : thread.lastPageFocus,
  updatedAt: Date.now(),
  lastOpenedAt: Date.now(),
});

export const registerAssistantRoutes = (
  app: Express,
  { generator, batchRuntime, assertProjectAccess }: AssistantRoutesOptions,
) => {
  app.get("/api/assistant/capabilities", (_req, res) => {
    res.json({ version: "2026-07-14.v1", capabilities: assistantCapabilityRegistry });
  });

  app.get("/api/assistant/threads", (req, res) => {
    try {
      const projectRef = projectRefFrom(req.query);
      assertScope(projectRef, assertProjectAccess);
      res.json({ threads: assistantRepository.listThreads(projectRef, req.query.includeArchived === "true") });
    } catch (error) {
      sendError(res, error, "Failed to list assistant threads.");
    }
  });

  app.post("/api/assistant/threads", (req, res) => {
    try {
      const projectRef = projectRefFrom(req.body || {});
      assertScope(projectRef, assertProjectAccess);
      const now = Date.now();
      const thread = assistantRepository.saveThread({
        id: `assistant-thread-${now}-${crypto.randomUUID()}`,
        projectRef,
        title: String(req.body?.title || "").trim() || (projectRef ? "新对话" : "全局会话"),
        status: "active",
        pinned: false,
        lastPageFocus: req.body?.pageFocus,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      });
      res.status(201).json({ thread });
    } catch (error) {
      sendError(res, error, "Failed to create assistant thread.");
    }
  });

  app.post("/api/assistant/threads/default", (req, res) => {
    try {
      const projectRef = projectRefFrom(req.body || {});
      assertScope(projectRef, assertProjectAccess);
      const thread = ensureAssistantProjectThread(projectRef, { title: req.body?.title, pageFocus: req.body?.pageFocus }, assistantRepository);
      res.json({ thread });
    } catch (error) {
      sendError(res, error, "Failed to open assistant thread.");
    }
  });

  app.get("/api/assistant/threads/:threadId", (req, res) => {
    try {
      const thread = assistantRepository.getThread(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "Assistant thread not found." });
      assertScope(thread.projectRef, assertProjectAccess);
      res.json({ thread });
    } catch (error) {
      sendError(res, error, "Failed to read assistant thread.");
    }
  });

  app.patch("/api/assistant/threads/:threadId", (req, res) => {
    try {
      const thread = assistantRepository.getThread(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "Assistant thread not found." });
      assertScope(thread.projectRef, assertProjectAccess);
      res.json({ thread: assistantRepository.saveThread(updateThread(thread, req.body || {})) });
    } catch (error) {
      sendError(res, error, "Failed to update assistant thread.");
    }
  });

  app.get("/api/assistant/threads/:threadId/messages", (req, res) => {
    try {
      const thread = assistantRepository.getThread(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "Assistant thread not found." });
      assertScope(thread.projectRef, assertProjectAccess);
      res.json({ messages: assistantRepository.listMessages(thread.id, Number(req.query.limit) || 200) });
    } catch (error) {
      sendError(res, error, "Failed to read assistant messages.");
    }
  });

  app.get("/api/assistant/threads/:threadId/checkpoints", (req, res) => {
    try {
      const thread = assistantRepository.getThread(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "Assistant thread not found." });
      assertScope(thread.projectRef, assertProjectAccess);
      res.json({ checkpoints: assistantRepository.listCheckpoints(thread.id, Number(req.query.limit) || 20) });
    } catch (error) {
      sendError(res, error, "Failed to read assistant checkpoints.");
    }
  });

  app.post("/api/assistant/threads/:threadId/messages", async (req, res) => {
    try {
      const thread = assistantRepository.getThread(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "Assistant thread not found." });
      assertScope(thread.projectRef, assertProjectAccess);
      const result = await createAssistantTurn({
        threadId: thread.id,
        goal: String(req.body?.goal || ""),
        pageFocus: req.body?.pageFocus,
        capabilityId: req.body?.capabilityId,
        input: req.body?.input,
        selectedSkills: Array.isArray(req.body?.selectedSkills) ? req.body.selectedSkills as SelectedAssistantSkill[] : [],
      }, generator, assistantRepository);
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error, "Failed to run assistant turn.");
    }
  });

  app.get("/api/assistant/plans/:planId", (req, res) => {
    try {
      const plan = assistantRepository.getPlan(req.params.planId);
      if (!plan) return res.status(404).json({ error: "Assistant plan not found." });
      assertScope(plan.projectRef, assertProjectAccess);
      res.json({ plan });
    } catch (error) {
      sendError(res, error, "Failed to read assistant plan.");
    }
  });

  app.post("/api/assistant/plans/:planId/approve", (req, res) => {
    try {
      const plan = assistantRepository.getPlan(req.params.planId);
      if (!plan) return res.status(404).json({ error: "Assistant plan not found." });
      assertScope(plan.projectRef, assertProjectAccess);
      const result = approveAssistantPlan(req.params.planId, {
        promptPreviews: Array.isArray(req.body?.promptPreviews) ? req.body.promptPreviews as AssistantPromptExecutionPreview[] : undefined,
        repairLimit: req.body?.repairLimit,
      }, batchRuntime, assistantRepository);
      res.status(201).json(result);
    } catch (error) {
      sendError(res, error, "Failed to approve assistant plan.");
    }
  });

  app.post("/api/assistant/plans/:planId/cancel", (req, res) => {
    try {
      const plan = assistantRepository.getPlan(req.params.planId);
      if (!plan) return res.status(404).json({ error: "Assistant plan not found." });
      assertScope(plan.projectRef, assertProjectAccess);
      if (plan.status !== "draft") throw new AssistantRepositoryError(409, "assistant_plan_not_draft", "该计划已经确认、取消或执行。");
      const now = Date.now();
      const cancelled = assistantRepository.savePlan({ ...plan, status: "cancelled", updatedAt: now });
      assistantRepository.saveMessage({
        id: `assistant-message-${now}-${crypto.randomUUID()}`,
        threadId: plan.threadId,
        projectRef: plan.projectRef,
        role: "system",
        blocks: [{ type: "system_event", title: "计划已取消", detail: plan.summary }],
        runIds: [],
        createdAt: now,
      });
      res.json({ plan: cancelled });
    } catch (error) {
      sendError(res, error, "Failed to cancel assistant plan.");
    }
  });

  app.get("/api/assistant/runs", (req, res) => {
    try {
      const projectRef = projectRefFrom(req.query);
      assertScope(projectRef, assertProjectAccess);
      res.json({ runs: assistantRepository.listRuns(projectRef) });
    } catch (error) {
      sendError(res, error, "Failed to list assistant runs.");
    }
  });

  app.get("/api/assistant/runs/:runId", (req, res) => {
    try {
      const run = assistantRepository.getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: "Assistant run not found." });
      assertScope(run.projectRef, assertProjectAccess);
      const batchId = String(run.output?.batchId || "");
      res.json({ run, batch: batchId ? assistantRepository.getPreparationBatch(batchId) : undefined });
    } catch (error) {
      sendError(res, error, "Failed to read assistant run.");
    }
  });

  app.post("/api/assistant/runs/:runId/cancel", (req, res) => {
    try {
      const run = assistantRepository.getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: "Assistant run not found." });
      assertScope(run.projectRef, assertProjectAccess);
      res.json({ run: cancelAssistantRun(req.params.runId, assistantRepository) });
    } catch (error) {
      sendError(res, error, "Failed to cancel assistant run.");
    }
  });

  app.post("/api/assistant/runs/:runId/resume", (req, res) => {
    try {
      const run = assistantRepository.getRun(req.params.runId);
      if (!run) return res.status(404).json({ error: "Assistant run not found." });
      assertScope(run.projectRef, assertProjectAccess);
      res.json(resumeAssistantRun(req.params.runId, String(req.body?.instruction || ""), batchRuntime, assistantRepository));
    } catch (error) {
      sendError(res, error, "Failed to resume assistant run.");
    }
  });

  app.get("/api/assistant/context-snapshots/:snapshotId", (req, res) => {
    try {
      const snapshot = assistantRepository.getContextSnapshot(req.params.snapshotId);
      if (!snapshot) return res.status(404).json({ error: "Assistant context snapshot not found." });
      assertScope(snapshot.projectRef, assertProjectAccess);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, "Failed to read assistant context snapshot.");
    }
  });

  app.get("/api/assistant/projects/:namespace/:projectId/context", (req, res) => {
    try {
      const projectRef = projectRefFrom(req.params)!;
      assertScope(projectRef, assertProjectAccess);
      const thread = ensureAssistantProjectThread(projectRef, {}, assistantRepository);
      res.json({ project: getAssistantProjectSummary(projectRef), snapshot: buildAssistantContextSnapshot(thread, undefined, assistantRepository) });
    } catch (error) {
      sendError(res, error, "Failed to read assistant project context.");
    }
  });

  app.get("/api/production/projects/:projectId/preparation-batch-runs", (req, res) => {
    try {
      assertProjectAccess?.(req.params.projectId);
      res.json({ batches: assistantRepository.listPreparationBatches(req.params.projectId, req.query.episodeId ? String(req.query.episodeId) : undefined) });
    } catch (error) {
      sendError(res, error, "Failed to list preparation batch runs.");
    }
  });

  app.get("/api/production/preparation-batch-runs/:batchRunId", (req, res) => {
    try {
      const batch = assistantRepository.getPreparationBatch(req.params.batchRunId);
      if (!batch) return res.status(404).json({ error: "Preparation batch run not found." });
      assertProjectAccess?.(batch.projectId);
      res.json({ batch });
    } catch (error) {
      sendError(res, error, "Failed to read preparation batch.");
    }
  });

  app.post("/api/production/preparation-batch-runs/:batchRunId/adopt", (req, res) => {
    try {
      const batch = assistantRepository.getPreparationBatch(req.params.batchRunId);
      if (!batch) return res.status(404).json({ error: "Preparation batch run not found." });
      assertProjectAccess?.(batch.projectId);
      res.json(adoptProductionPreparationBatch(req.params.batchRunId, assistantRepository));
    } catch (error) {
      sendError(res, error, "Failed to adopt preparation batch.");
    }
  });

  app.post("/api/assistant/change-sets/:changeSetId/rollback", (req, res) => {
    try {
      const changeSet = assistantRepository.getChangeSet(req.params.changeSetId);
      if (!changeSet) return res.status(404).json({ error: "Assistant change set not found." });
      assertScope(changeSet.projectRef, assertProjectAccess);
      res.json({ changeSet: rollbackAssistantChangeSet(req.params.changeSetId, assistantRepository) });
    } catch (error) {
      sendError(res, error, "Failed to roll back assistant change set.");
    }
  });

  app.get("/api/assistant/change-sets/:changeSetId", (req, res) => {
    try {
      const changeSet = assistantRepository.getChangeSet(req.params.changeSetId);
      if (!changeSet) return res.status(404).json({ error: "Assistant change set not found." });
      assertScope(changeSet.projectRef, assertProjectAccess);
      res.json({ changeSet });
    } catch (error) {
      sendError(res, error, "Failed to read assistant change set.");
    }
  });
};
