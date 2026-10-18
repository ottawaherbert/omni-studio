import { createHash } from "node:crypto";

import type {
  AssistantAuthorization,
  AssistantChangeSet,
  AssistantMessage,
  AssistantPlan,
  AssistantPromptExecutionPreview,
  AssistantRun,
  ProductionPreparationBatchRun,
} from "../../../packages/domain/src/assistant";
import { createScriptDelivery } from "../../../packages/script/src/exporters";
import { scriptRepository } from "../../../apps/api/src/repositories/scriptRepository";
import { assistantRepository, type AssistantRepository } from "../../server/assistantRepository";
import { dbHelpers } from "../../server/db";
import { createLegacyProductionProjectFromWritingSource } from "../production/writingExportLegacyAdapter";
import { createAssistantRunForPlan, updateAssistantPlanPrompts } from "./plans";
import { adoptProductionPreparationBatch, createProductionPreparationBatch, ProductionPreparationBatchRuntime } from "./productionPreparationBatch";

const id = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
  return value;
};
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stableValue(value))).digest("hex");
const hasOpenQuestions = (candidate: unknown) => Boolean(
  candidate
  && typeof candidate === "object"
  && Array.isArray((candidate as { openQuestions?: unknown }).openQuestions)
  && (candidate as { openQuestions: unknown[] }).openQuestions.length,
);

const saveRunMessage = (run: AssistantRun, repository: AssistantRepository) => {
  const message: AssistantMessage = {
    id: id("assistant-message"),
    threadId: run.threadId,
    projectRef: run.projectRef,
    role: "assistant",
    blocks: [{ type: "run", runId: run.id, summary: "任务已进入后台执行。你可以关闭助手或切换页面，任务状态会持续保存。" }],
    runIds: [run.id],
    createdAt: Date.now(),
  };
  repository.saveMessage(message);
};

const completeAuthorization = (authorization: AssistantAuthorization, repository: AssistantRepository) =>
  repository.saveAuthorization({ ...authorization, status: "consumed" });

const completeRun = (
  run: AssistantRun,
  authorization: AssistantAuthorization,
  summary: string,
  output: Record<string, unknown>,
  repository: AssistantRepository,
) => {
  completeAuthorization(authorization, repository);
  const completed = repository.saveRun({ ...run, status: "completed", progress: 100, summary, output, updatedAt: Date.now(), completedAt: Date.now() });
  repository.saveMessage({
    id: id("assistant-message"),
    threadId: completed.threadId,
    projectRef: completed.projectRef,
    role: "assistant",
    blocks: [{ type: "result", runId: completed.id, title: "任务已完成", summary }],
    runIds: [completed.id],
    createdAt: Date.now(),
  });
  return completed;
};

const importWritingProject = (
  run: AssistantRun,
  authorization: AssistantAuthorization,
  plan: AssistantPlan,
  repository: AssistantRepository,
) => {
  const sourceWritingProjectId = String(plan.input.sourceWritingProjectId || "").trim();
  if (!sourceWritingProjectId) throw new Error("导入计划缺少唯一 Writing 项目 ID。");
  const writingProject = scriptRepository.getProject(sourceWritingProjectId);
  if (!writingProject) throw new Error("要导入的剧本项目不存在。");
  const existingSummary = dbHelpers.getProjectSummaries().find((project: any) =>
    project.productionSourceSnapshot?.sourceType === "writing_export"
    && project.productionSourceSnapshot.sourceWritingProjectId === sourceWritingProjectId,
  );
  const existing = existingSummary
    ? dbHelpers.getProjectById(existingSummary.id)
    : undefined;
  if (existing) {
    let changeSet: AssistantChangeSet | undefined;
    if (existing.productionTrashedAt) {
      const restored = { ...existing, productionTrashedAt: null };
      dbHelpers.saveProject(restored);
      const now = Date.now();
      changeSet = repository.saveChangeSet({
        id: id("assistant-change-set"),
        runId: run.id,
        projectRef: { namespace: "production", projectId: existing.id },
        beforeRevision: Number(existing.updatedAt || 0),
        afterRevision: now,
        beforeHash: hash(existing),
        afterHash: hash(restored),
        beforeSnapshot: existing,
        afterSnapshot: restored,
        invalidationImpact: [],
        summary: `从垃圾箱恢复导演制片项目《${existing.title}》。`,
        status: "committed",
        createdAt: now,
        committedAt: now,
      });
    }
    const completed = completeRun(run, authorization, `已找到《${existing.title}》的导演制片项目，可以继续筹备。`, {
      productionProjectId: existing.id,
      navigateTo: "/production/preparation",
      reused: true,
      ...(changeSet ? { changeSetId: changeSet.id } : {}),
    }, repository);
    return { plan, run: completed, authorization: repository.getAuthorization(authorization.id)!, changeSet };
  }
  const exported = createScriptDelivery(writingProject);
  const projectId = String(plan.input.productionProjectId || `production-${Date.now()}-${crypto.randomUUID()}`);
  const productionProject = createLegacyProductionProjectFromWritingSource({
    package: exported,
    productionProjectId: projectId,
    importId: crypto.randomUUID(),
  });
  if (!productionProject.productionSourceDocuments?.length) throw new Error("该剧本还没有可导入的正式正文单元。");
  dbHelpers.saveProject(productionProject);
  const now = Date.now();
  const changeSet: AssistantChangeSet = repository.saveChangeSet({
    id: id("assistant-change-set"),
    runId: run.id,
    projectRef: { namespace: "production", projectId: productionProject.id },
    beforeRevision: 0,
    afterRevision: now,
    beforeHash: hash(null),
    afterHash: hash(productionProject),
    beforeSnapshot: null,
    afterSnapshot: productionProject,
    invalidationImpact: [],
    summary: `从 Writing 正式导出包创建导演制片项目《${productionProject.title}》。`,
    status: "committed",
    createdAt: now,
    committedAt: now,
  });
  const completed = completeRun(run, authorization, `《${productionProject.title}》已导入导演制片，完整剧本来源保持只读。`, {
    productionProjectId: productionProject.id,
    navigateTo: "/production/preparation",
    changeSetId: changeSet.id,
  }, repository);
  return { plan, run: completed, authorization: repository.getAuthorization(authorization.id)!, changeSet };
};

export interface ApproveAssistantPlanInput {
  promptPreviews?: AssistantPromptExecutionPreview[];
  repairLimit?: number;
}

export interface ApproveAssistantPlanResult {
  plan: AssistantPlan;
  run: AssistantRun;
  authorization: AssistantAuthorization;
  batch?: ProductionPreparationBatchRun;
  changeSet?: AssistantChangeSet;
  project?: unknown;
}

export const approveAssistantPlan = (
  planId: string,
  input: ApproveAssistantPlanInput,
  batchRuntime: ProductionPreparationBatchRuntime,
  repository: AssistantRepository = assistantRepository,
): ApproveAssistantPlanResult => {
  const existing = repository.getPlan(planId);
  if (!existing) throw new Error("执行计划不存在。");
  if (existing.status !== "draft") throw new Error("该计划已经确认、取消或执行。");
  let plan: AssistantPlan = input.promptPreviews ? updateAssistantPlanPrompts(existing, input.promptPreviews) : existing;
  plan = repository.savePlan({ ...plan, status: "approved", updatedAt: Date.now() });
  let run = createAssistantRunForPlan(plan, repository);
  const now = Date.now();
  const authorization: AssistantAuthorization = repository.saveAuthorization({
    id: id("assistant-authorization"),
    runId: run.id,
    projectRef: run.projectRef,
    planHash: plan.planHash,
    allowedCapabilityIds: Array.from(new Set(plan.steps.map((step) => step.capabilityId))),
    allowedEntityIds: [String(plan.input.episodeId || ""), String(plan.input.sceneId || "")].filter(Boolean),
    promptManifestHash: hash(plan.promptPreviews.map((prompt) => ({ id: prompt.id, promptHash: prompt.promptHash, selectedSkillIds: prompt.selectedSkillIds }))),
    repairLimit: Math.max(0, Math.min(5, Math.floor(input.repairLimit ?? 2))),
    status: "approved",
    approvedAt: now,
    expiresAt: now + 24 * 60 * 60 * 1000,
  });
  run = repository.saveRun({ ...run, authorizationId: authorization.id, status: "queued", updatedAt: now });
  if (plan.capabilityId === "production.auto_prepare_unit") {
    const batch = createProductionPreparationBatch(run, authorization, plan, repository);
    run = repository.saveRun({ ...run, output: { batchId: batch.id }, summary: `正在自动筹备 ${batch.workUnit.title}`, updatedAt: Date.now() });
    saveRunMessage(run, repository);
    batchRuntime.enqueue(batch.id);
    return { plan, run, authorization, batch };
  }
  if (plan.capabilityId === "writing.export_script_package") {
    const sourceProjectId = String(plan.input.sourceWritingProjectId || run.projectRef?.projectId || "");
    const writingProject = sourceProjectId ? scriptRepository.getProject(sourceProjectId) : null;
    if (!writingProject) throw new Error("导出计划缺少有效的 Writing 项目。");
    const exported = createScriptDelivery(writingProject);
    const completed = completeRun(run, authorization, `《${writingProject.title}》正式剧本包已生成。`, { package: exported }, repository);
    return { plan, run: completed, authorization: repository.getAuthorization(authorization.id)! };
  }
  if (plan.capabilityId === "production.import_writing_script") {
    return importWritingProject(run, authorization, plan, repository);
  }
  if (plan.capabilityId === "production.adopt_preparation_batch") {
    const batchId = String(plan.input.batchId || "");
    if (!batchId) throw new Error("采用计划缺少筹备批次 ID。");
    const adopted = adoptProductionPreparationBatch(batchId, repository);
    const completed = completeRun(run, authorization, adopted.changeSet.summary, {
      batchId: adopted.batch.id,
      changeSetId: adopted.changeSet.id,
      productionProjectId: adopted.batch.projectId,
      navigateTo: "/production/preparation",
    }, repository);
    return {
      plan,
      run: completed,
      authorization: repository.getAuthorization(authorization.id) || authorization,
      ...adopted,
    };
  }
  run = repository.saveRun({ ...run, status: "failed", error: "该能力已注册，但当前执行适配器尚未接入。", updatedAt: Date.now() });
  saveRunMessage(run, repository);
  return { plan, run, authorization };
};

export const cancelAssistantRun = (
  runId: string,
  repository: AssistantRepository = assistantRepository,
) => {
  const run = repository.getRun(runId);
  if (!run) throw new Error("任务不存在。");
  if (["completed", "failed", "cancelled", "rolled_back"].includes(run.status)) return run;
  if (run.authorizationId) {
    const authorization = repository.getAuthorization(run.authorizationId);
    if (authorization) repository.saveAuthorization({ ...authorization, status: "revoked" });
  }
  const batchId = String(run.output?.batchId || "");
  if (batchId) {
    const batch = repository.getPreparationBatch(batchId);
    if (batch) repository.savePreparationBatch({
      ...batch,
      status: "cancelled",
      departmentSteps: batch.departmentSteps.map((step) => ["passed", "failed", "needs_decision"].includes(step.status) ? step : { ...step, status: "cancelled", updatedAt: Date.now() }),
      updatedAt: Date.now(),
    });
  }
  return repository.saveRun({ ...run, status: "cancelled", summary: "任务已取消；已产生的候选和审计仍然保留。", updatedAt: Date.now(), completedAt: Date.now() });
};

export const resumeAssistantRun = (
  runId: string,
  instruction: string,
  batchRuntime: ProductionPreparationBatchRuntime,
  repository: AssistantRepository = assistantRepository,
) => {
  const run = repository.getRun(runId);
  if (!run) throw new Error("任务不存在。");
  const batchId = String(run.output?.batchId || "");
  const batch = batchId ? repository.getPreparationBatch(batchId) : null;
  if (!batch) throw new Error("任务没有可恢复的筹备批次。");
  if (run.authorizationId) {
    const authorization = repository.getAuthorization(run.authorizationId);
    if (!authorization) throw new Error("任务授权不存在。");
    repository.saveAuthorization({ ...authorization, status: "approved", expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  }
  const suffix = instruction.trim() ? `\n\n【创作者决定】\n${instruction.trim()}` : "";
  const resolvingDecision = batch.status === "needs_decision" && Boolean(instruction.trim());
  const nextBatch = repository.savePreparationBatch({
    ...batch,
    status: "queued",
    error: undefined,
    promptPreviews: batch.promptPreviews.map((prompt) => prompt.id.includes(":optimize") || prompt.id.includes(":generate") || prompt.id.includes(":qa")
      ? { ...prompt, prompt: `${prompt.prompt}${suffix}`, promptHash: hash(`${prompt.prompt}${suffix}`) }
      : prompt),
    departmentSteps: batch.departmentSteps.map((step) => step.status === "needs_decision" || step.status === "failed" || (resolvingDecision && hasOpenQuestions(step.candidate))
      ? {
        ...step,
        status: "queued",
        error: undefined,
        blockingIssueIds: [],
        retryCount: resolvingDecision ? 0 : step.retryCount,
        updatedAt: Date.now(),
      }
      : step),
    updatedAt: Date.now(),
  });
  const nextRun = repository.saveRun({
    ...run,
    status: "queued",
    summary: instruction.trim() ? "已记录创作者决定，任务将从未通过步骤继续。" : "正在重试未完成的技术步骤，已通过结果保持不变。",
    updatedAt: Date.now(),
  });
  batchRuntime.enqueue(nextBatch.id);
  return { run: nextRun, batch: nextBatch };
};
