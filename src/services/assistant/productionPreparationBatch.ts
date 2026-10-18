import { currentManualAISessionId, trackManualAIWork } from "../../server/manualAI";
import { createHash } from "node:crypto";

import type {
  AssistantAuthorization,
  AssistantChangeSet,
  AssistantPlan,
  AssistantPromptExecutionPreview,
  AssistantPromptExecutionRecord,
  AssistantRun,
  AssistantRunEvent,
  ProductionDepartmentId,
  ProductionPreparationBatchRun,
  ProductionPreparationDepartmentStep,
  ProductionPreparationQualityDimension,
  ProductionPreparationQualityGate,
} from "../../../packages/domain/src/assistant";
import type { Episode, ManualFilmTeamOutput, ManualFilmTeamPromptAudit, ManualFilmTeamQA, Project, Scene } from "../../types/project";
import { breakdownTemplates } from "../../config/prompts/breakdown";
import { productionTeamTemplates } from "../../config/prompts/productionTeam";
import { renderPromptTemplate } from "../production/promptUtils";
import {
  PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS,
  bindProductionBreakdownAssetsToCanonicalRegistry,
  normalizeProductionBreakdown,
  parseProductionBreakdownQaResult,
  productionBreakdownAdoptionUpdates,
  productionBreakdownPromptContext,
  productionBreakdownQaChecklistPrompt,
  productionBreakdownRequiredSourceRefs,
  projectProductionBreakdownRepairQa,
} from "../production/manualSceneBreakdown";
import {
  MANUAL_FILM_TEAM_DEPARTMENTS,
  MANUAL_FILM_TEAM_MIN_PASS_SCORE,
  combineManualFilmTeamQAParts,
  manualFilmTeamBreakdownHash,
  manualFilmTeamDepartment,
  manualFilmTeamFullScriptHash,
  manualFilmTeamQaOutputContext,
  manualFilmTeamQaEvidenceCatalog,
  manualFilmTeamQaOutputBatches,
  projectManualFilmTeamRepairQa,
  manualFilmTeamScriptHash,
  manualFilmTeamUnitScenes,
  manualFilmTeamUnitSource,
  normalizeManualFilmTeamDraft,
  normalizeManualFilmTeamQA,
  upsertManualFilmTeamOutput,
} from "../production/manualFilmTeam";
import {
  MANUAL_FILM_TEAM_DEPARTMENT_ORDER,
  manualFilmTeamCollaborationContext,
  manualFilmTeamCollaborationSnapshot,
  manualFilmTeamDependencies,
  manualFilmTeamPendingCollaborationReviews,
  normalizeManualFilmTeamHandoffs,
} from "../production/manualFilmTeamCommunication";
import { productionDepartmentContinuityContext } from "../production/productionSourceDocuments";
import { productionDepartmentCreativeVision } from "../production/productionDepartmentPromptProjection";
import { composePromptBlocks, promptBlocksFromText } from "../production/promptComposition";
import { applyProductionSceneManualAssetBindingsToBreakdown } from "../production/productionProjectAssets";
import { productionWritingUnitSourceContext } from "../production/writingSourceContext";
import { assistantRepository, type AssistantRepository } from "../../server/assistantRepository";
import { dbHelpers } from "../../server/db";

export interface AssistantJsonGenerator {
  (input: { prompt: string; systemInstruction?: string }): Promise<Record<string, unknown>>;
}

export interface SelectedAssistantSkill {
  id: string;
  title: string;
  content: string;
}

const CURRENT_BREAKDOWN_MARKER = "__ASSISTANT_CURRENT_BREAKDOWN__";
const BREAKDOWN_CONTEXT_MARKER = "__ASSISTANT_BREAKDOWN_CONTEXT__";
const CURRENT_OUTPUT_MARKER = "__ASSISTANT_CURRENT_OUTPUT__";
const QA_CONTEXT_MARKER = "__ASSISTANT_QA_CONTEXT__";
const UPSTREAM_CONTEXT_MARKER = "__ASSISTANT_UPSTREAM_DEPARTMENT_CONTEXT__";
const COLLABORATION_CONTEXT_MARKER = "__ASSISTANT_DEPARTMENT_COLLABORATION_CONTEXT__";
const MAX_AUTOMATIC_COLLABORATION_REVIEW_ROUNDS = 2;

export const productionPreparationCollaborationReviewLimit = (repairLimit: number) =>
  Math.max(0, Math.min(
    MAX_AUTOMATIC_COLLABORATION_REVIEW_ROUNDS,
    Math.floor(repairLimit),
  ));

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
const createId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
const text = (value: unknown) => String(value || "").trim();
const list = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const modelCallMetadataSymbol = Symbol.for("writing.modelCallMetadata");
const modelCallMetadataFor = (value: Record<string, unknown>) =>
  (value as Record<PropertyKey, unknown>)[modelCallMetadataSymbol] as {
    provider?: string;
    modelId?: string;
    providerRequestId?: string;
    inputTokens?: number;
    outputTokens?: number;
  } | undefined;

export const productionPreparationQaStartAttempt = (
  retryCount: number,
  repairLimit: number,
  collaborationReview = false,
) => collaborationReview ? 0 : Math.max(0, Math.min(repairLimit, retryCount));

const skillText = (skills: SelectedAssistantSkill[]) => skills.length ? [
  "【本批次选择的通用 Skill】",
  "以下 Skill 由创作者在批次确认前选择。若与剧本事实、任务目标或输出合同冲突，以事实和合同为准。",
  ...skills.map((skill) => `【Skill：${skill.title}】\n${skill.content}`),
  "【Skill 结束】",
].join("\n\n") : "";

const projectAndEpisode = (projectId: string, episodeId: string) => {
  const project = dbHelpers.getProjectById(projectId) as Project | null;
  if (!project) throw new Error("导演制片项目不存在。");
  const episode = project.episodes.find((item) => item.id === episodeId) as Episode | undefined;
  if (!episode) throw new Error("当前分集或分段不存在。");
  const source = manualFilmTeamUnitSource(project, episode);
  const scenes = manualFilmTeamUnitScenes(episode);
  if (!source.text.trim()) throw new Error("当前分集或分段没有完整剧本来源。");
  if (!scenes.length) throw new Error("当前分集或分段还没有正式制片场次。");
  return { project, episode, source, scenes };
};

const breakdownContextForEpisode = (episode: Episode) => JSON.stringify(
  manualFilmTeamUnitScenes(episode).map((scene, index) => ({
    sceneId: scene.id,
    order: index + 1,
    title: scene.title,
    goal: scene.sceneGoal || scene.description || "",
    sourceEvidence: scene.sourceEvidence || "",
    environment: scene.environment || "",
    timeOfDay: scene.timeOfDay || "",
    breakdown: scene.breakdown || null,
  })),
  null,
  2,
);

const outputContext = (output?: ManualFilmTeamOutput) => output ? JSON.stringify({
  taskSummary: output.taskSummary,
  content: output.content,
  scenePlans: output.scenePlans || [],
  openQuestions: output.openQuestions,
  handoffNotes: output.handoffNotes,
  handoffs: (output.handoffs || []).map(({ id: _id, ...handoff }) => handoff),
}, null, 2) : "";

const departmentDependencies = Object.fromEntries(
  MANUAL_FILM_TEAM_DEPARTMENT_ORDER.map((department) => [department, manualFilmTeamDependencies(department)]),
) as Record<ProductionDepartmentId, ProductionDepartmentId[]>;

const orderedDepartments = MANUAL_FILM_TEAM_DEPARTMENT_ORDER as ProductionDepartmentId[];

const renderBreakdownPrompt = (
  action: "generate" | "qa" | "optimize",
  project: Project,
  episode: Episode,
  scene: Scene,
  skills: SelectedAssistantSkill[],
) => {
  const context = productionBreakdownPromptContext(project, episode, scene);
  const template = action === "qa"
    ? breakdownTemplates.productionBreakdownQa
    : action === "optimize" ? breakdownTemplates.productionBreakdownOptimize : breakdownTemplates.breakdown;
  const rendered = renderPromptTemplate(template.template, {
    ...context.variables,
    selectedContext: "",
    skills: skillText(skills),
    userIntent: "",
    currentBreakdown: CURRENT_BREAKDOWN_MARKER,
    qaContext: QA_CONTEXT_MARKER,
    qaChecklist: productionBreakdownQaChecklistPrompt(PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS),
  });
  return composePromptBlocks(promptBlocksFromText({
    prompt: rendered,
    source: `assistant.productionPreparation.${template.id}`,
    purpose: "制片拆解任务",
  })).prompt;
};

const departmentPromptVariables = (
  project: Project,
  episode: Episode,
  departmentId: ProductionDepartmentId,
  skills: SelectedAssistantSkill[],
) => {
  const source = manualFilmTeamUnitSource(project, episode);
  const department = manualFilmTeamDepartment(departmentId);
  return {
    departmentName: department.name,
    departmentResponsibility: department.responsibility,
    departmentTask: department.task,
    projectTitle: project.title,
    projectType: project.type,
    creativeVision: productionDepartmentCreativeVision(project, departmentId),
    sourceUnitTitle: source.title,
    sourceUnitScript: source.text,
    fullScriptContext: productionDepartmentContinuityContext(project, source.sourceDocumentId),
    sourceWritingContext: productionWritingUnitSourceContext(project, episode),
    breakdownContext: BREAKDOWN_CONTEXT_MARKER,
    collaborationContext: COLLABORATION_CONTEXT_MARKER,
    selectedContext: UPSTREAM_CONTEXT_MARKER,
    currentOutput: CURRENT_OUTPUT_MARKER,
    qaContext: QA_CONTEXT_MARKER,
    userIntent: "",
    skills: skillText(skills),
  };
};

const preview = (
  id: string,
  capabilityId: string,
  title: string,
  templateId: string,
  prompt: string,
  contextSources: AssistantPromptExecutionPreview["contextSources"],
  agentId?: string,
  selectedSkills: SelectedAssistantSkill[] = [],
): AssistantPromptExecutionPreview => ({
  id,
  capabilityId,
  agentId,
  title,
  templateId,
  prompt,
  promptHash: hash(prompt),
  selectedSkillIds: selectedSkills.map((skill) => skill.id),
  selectedSkillTitles: selectedSkills.map((skill) => skill.title),
  contextSources,
  editable: true,
});

export const buildProductionPreparationPromptPreviews = (
  projectId: string,
  episodeId: string,
  selectedSkills: SelectedAssistantSkill[] = [],
) => {
  const { project, episode, source, scenes } = projectAndEpisode(projectId, episodeId);
  const contextSources = [
    { id: source.sourceDocumentId || episode.id, label: `完整剧本来源：${source.title}`, hash: hash(source.text) },
    { id: episode.id, label: `制片范围：${episode.title}`, hash: hash(scenes.map((scene) => scene.id)) },
  ];
  const prompts: AssistantPromptExecutionPreview[] = [];
  scenes.forEach((scene) => {
    (["generate", "qa", "optimize"] as const).forEach((action) => {
      const templateId = action === "generate" ? "breakdown" : action === "qa" ? "productionBreakdownQa" : "productionBreakdownOptimize";
      prompts.push(preview(
        `breakdown:${scene.id}:${action}`,
        "production.auto_prepare_unit",
        `${scene.title} · ${action === "generate" ? "场次拆解" : action === "qa" ? "拆解质检" : "拆解修复"}`,
        templateId,
        renderBreakdownPrompt(action, project, episode, scene, selectedSkills),
        contextSources,
        action === "qa" ? "production-breakdown-qa" : "production-breakdown-agent",
        selectedSkills,
      ));
    });
  });
  orderedDepartments.forEach((departmentId) => {
    const department = manualFilmTeamDepartment(departmentId);
    const variables = departmentPromptVariables(project, episode, departmentId, selectedSkills);
    (["generate", "qa", "optimize"] as const).forEach((action) => {
      const template = action === "generate"
        ? productionTeamTemplates.productionTeamGenerate
        : action === "qa" ? productionTeamTemplates.productionTeamQa : productionTeamTemplates.productionTeamOptimize;
      prompts.push(preview(
        `department:${departmentId}:${action}`,
        "production.auto_prepare_unit",
        `${department.name} · ${action === "generate" ? "生成" : action === "qa" ? "质检" : "修复"}`,
        template.id,
        composePromptBlocks(promptBlocksFromText({
          prompt: renderPromptTemplate(template.template, variables),
          source: `assistant.productionPreparation.${template.id}`,
          purpose: "制片部门任务",
        })).prompt,
        contextSources,
        action === "qa" ? `${departmentId}-qa` : `${departmentId}-agent`,
        selectedSkills,
      ));
    });
  });
  return { project, episode, source, scenes, prompts };
};

export const createProductionPreparationBatch = (
  run: AssistantRun,
  authorization: AssistantAuthorization,
  plan: AssistantPlan,
  repository: AssistantRepository = assistantRepository,
): ProductionPreparationBatchRun => {
  const projectId = run.projectRef?.projectId;
  const episodeId = text(plan.input.episodeId);
  if (run.projectRef?.namespace !== "production" || !projectId || !episodeId) {
    throw new Error("整集筹备任务缺少 Production 项目或工作单元。");
  }
  const { episode, source, scenes } = projectAndEpisode(projectId, episodeId);
  const now = Date.now();
  const batchId = createId("production-preparation-batch");
  const departmentSteps: ProductionPreparationDepartmentStep[] = orderedDepartments.map((departmentId) => ({
    id: `department-step:${departmentId}`,
    batchRunId: batchId,
    departmentId,
    departmentName: manualFilmTeamDepartment(departmentId).name,
    sceneIds: scenes.map((scene) => scene.id),
    dependsOn: departmentDependencies[departmentId].map((id) => `department-step:${id}`),
    status: "queued",
    promptExecutionIds: [],
    retryCount: 0,
    blockingIssueIds: [],
    updatedAt: now,
  }));
  return repository.savePreparationBatch({
    id: batchId,
    manualResponseOnly: Boolean(currentManualAISessionId()),
    assistantRunId: run.id,
    projectId,
    sourceSnapshotId: source.sourceDocumentId || episode.sourceDocumentId || episode.id,
    workUnit: { kind: run.projectRef.namespace === "production" && (plan.input.workUnitKind === "segment" || plan.input.workUnitKind === "episode") ? plan.input.workUnitKind : "episode", id: episode.id, title: episode.title },
    sceneIds: scenes.map((scene) => scene.id),
    sceneLabels: Object.fromEntries(scenes.map((scene, index) => [scene.id, `${String(index + 1).padStart(2, "0")} · ${scene.title}`])),
    status: "queued",
    authorizationId: authorization.id,
    promptPreviews: plan.promptPreviews,
    promptExecutions: [],
    breakdownCandidates: {},
    departmentSteps,
    createdAt: now,
    updatedAt: now,
  });
};

const replaceRuntimeMarkers = (prompt: string, values: Record<string, string>) => Object.entries(values)
  .reduce((result, [marker, value]) => result.replaceAll(marker, value), prompt);

const appendRunEvent = (
  repository: AssistantRepository,
  runId: string | undefined,
  input: Omit<AssistantRunEvent, "id" | "runId" | "createdAt" | "type"> & { type?: string },
) => {
  if (!runId) return;
  const run = repository.getRun(runId);
  if (!run) return;
  const event: AssistantRunEvent = { id: createId("assistant-event"), runId, type: input.type || "status", createdAt: Date.now(), ...input };
  repository.saveRun({ ...run, status: input.status || run.status, progress: input.progress ?? run.progress, events: [...run.events, event], updatedAt: Date.now() });
};

const promptById = (batch: ProductionPreparationBatchRun, id: string) => {
  const prompt = batch.promptPreviews.find((item) => item.id === id);
  if (!prompt) throw new Error(`批次缺少已确认 Prompt：${id}`);
  return prompt;
};

class ProductionPreparationCancelledError extends Error {
  constructor() {
    super("整集筹备任务已取消。");
    this.name = "ProductionPreparationCancelledError";
  }
}

const assertBatchCanContinue = (
  batch: ProductionPreparationBatchRun,
  repository: AssistantRepository,
) => {
  const authorization = batch.authorizationId ? repository.getAuthorization(batch.authorizationId) : null;
  if (batch.status === "cancelled" || authorization?.status === "revoked") {
    throw new ProductionPreparationCancelledError();
  }
};

const executePrompt = async (
  batch: ProductionPreparationBatchRun,
  stepId: string,
  promptId: string,
  runtimeValues: Record<string, string>,
  generator: AssistantJsonGenerator,
  repository: AssistantRepository,
) => {
  const currentBatch = repository.getPreparationBatch(batch.id) || batch;
  assertBatchCanContinue(currentBatch, repository);
  const source = promptById(currentBatch, promptId);
  const runtimePrompt = replaceRuntimeMarkers(source.prompt, runtimeValues);
  const promptComposition = composePromptBlocks(promptBlocksFromText({
    prompt: runtimePrompt,
    source: `assistant.productionPreparation.${source.templateId}`,
    purpose: source.title,
  }));
  if (promptComposition.manifest.issues.some((issue) => issue.code === "EMPTY_REQUIRED_BLOCK")) {
    throw new Error(`制片任务 ${source.title} 缺少必需提示词，已在发送前阻断。`);
  }
  const finalPrompt = promptComposition.prompt;
  const execution: AssistantPromptExecutionRecord = {
    ...source,
    id: createId("assistant-prompt-execution"),
    runId: batch.assistantRunId || batch.id,
    stepId,
    prompt: finalPrompt,
    promptHash: hash(finalPrompt),
    promptCompositionManifest: promptComposition.manifest,
    status: "running",
    startedAt: Date.now(),
  };
  let nextBatch = repository.savePreparationBatch({
    ...currentBatch,
    promptExecutions: [...currentBatch.promptExecutions, execution],
    updatedAt: Date.now(),
  });
  let result: Record<string, unknown>;
  try {
    result = await generator({
      systemInstruction: "你是 O.M.N.I. 制片 Agent。严格依据可见 Prompt 和结构化来源工作，不得把推断伪装成剧本事实。",
      prompt: finalPrompt,
    });
  } catch (error) {
    const failed = { ...execution, status: "failed" as const, error: error instanceof Error ? error.message : String(error), completedAt: Date.now() };
    const latestBatch = repository.getPreparationBatch(batch.id) || nextBatch;
    repository.savePreparationBatch({
      ...latestBatch,
      promptExecutions: latestBatch.promptExecutions.map((item) => item.id === failed.id ? failed : item),
      updatedAt: Date.now(),
    });
    throw error;
  }
  const completed = {
    ...execution,
    ...modelCallMetadataFor(result),
    status: "succeeded" as const,
    result,
    resultHash: hash(result),
    completedAt: Date.now(),
  };
  const latestBatch = repository.getPreparationBatch(batch.id) || nextBatch;
  nextBatch = repository.savePreparationBatch({
    ...latestBatch,
    promptExecutions: latestBatch.promptExecutions.map((item) => item.id === completed.id ? completed : item),
    updatedAt: Date.now(),
  });
  assertBatchCanContinue(nextBatch, repository);
  return { result, execution: completed, batch: nextBatch };
};

interface SimpleQa {
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  issues: Array<{ severity: "blocking" | "warning" | "advisory"; description: string; suggestion: string }>;
}

const updateDepartmentStep = (
  batch: ProductionPreparationBatchRun,
  departmentId: ProductionDepartmentId,
  updates: Partial<ProductionPreparationDepartmentStep>,
  repository: AssistantRepository,
) => {
  const current = repository.getPreparationBatch(batch.id) || batch;
  return repository.savePreparationBatch({
    ...current,
    departmentSteps: current.departmentSteps.map((step) => step.departmentId === departmentId ? { ...step, ...updates, updatedAt: Date.now() } : step),
    updatedAt: Date.now(),
  });
};

const buildPromptAudit = (
  action: ManualFilmTeamPromptAudit["action"],
  preview: AssistantPromptExecutionPreview,
  execution: AssistantPromptExecutionRecord,
): ManualFilmTeamPromptAudit => ({
  action,
  templateId: preview.templateId,
  promptHash: execution.promptHash,
  selectedSkillIds: preview.selectedSkillIds,
  selectedSkillTitles: preview.selectedSkillTitles,
  selectedContextIds: preview.contextSources.map((item) => item.id),
  createdAt: execution.completedAt || execution.startedAt,
});

const upstreamDepartmentContext = (batch: ProductionPreparationBatchRun, step: ProductionPreparationDepartmentStep) => JSON.stringify(
  step.dependsOn.map((dependencyId) => {
    const dependency = batch.departmentSteps.find((item) => item.id === dependencyId);
    const output = dependency?.candidate as ManualFilmTeamOutput | undefined;
    return output ? {
      department: dependency?.departmentName,
      taskSummary: output.taskSummary,
      content: output.content,
      scenePlans: output.scenePlans,
      openQuestions: output.openQuestions,
      handoffNotes: output.handoffNotes,
    } : null;
  }).filter(Boolean),
  null,
  2,
);

const qualityGateFor = (batch: ProductionPreparationBatchRun): ProductionPreparationQualityGate => {
  const passed = batch.departmentSteps.filter((step) => step.status === "passed");
  const outputs = passed.map((step) => step.candidate as ManualFilmTeamOutput).filter(Boolean);
  const qaScores = outputs.map((output) => output.qa?.score || 0);
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  const ids = (values: ProductionDepartmentId[]) => batch.departmentSteps.filter((step) => values.includes(step.departmentId)).map((step) => (step.candidate as ManualFilmTeamOutput | undefined)?.qa?.score || 0);
  const missingCoverage = outputs.flatMap((output) => batch.sceneIds.filter((sceneId) => !output.scenePlans?.some((plan) => plan.sceneId === sceneId)).map((sceneId) => `${manualFilmTeamDepartment(output.department).name}未覆盖场次 ${sceneId}`));
  const stepFailures = batch.departmentSteps.filter((step) => step.status !== "passed").map((step) => `${step.departmentName}尚未通过：${step.error || step.status}`);
  const blockingIssues = [...stepFailures, ...missingCoverage];
  const outputsWithOpenQuestions = outputs.filter((output) => output.openQuestions.length > 0);
  const openQuestions = outputsWithOpenQuestions.flatMap((output) => output.openQuestions.map((question) => `${manualFilmTeamDepartment(output.department).name}：${question}`));
  const dimension = (id: string, label: string, scores: number[], evidence: string[], issues: string[] = []): ProductionPreparationQualityDimension => ({
    id,
    label,
    score: average(scores),
    confidence: scores.length >= 3 ? "high" : scores.length ? "medium" : "low",
    evidence,
    issues,
  });
  const dimensions = [
    dimension("script_fidelity", "剧本忠实与事实边界", qaScores, outputs.map((output) => output.qa?.summary || "").filter(Boolean)),
    dimension("scene_coverage", "场次覆盖与执行完整度", outputs.map((output) => batch.sceneIds.every((sceneId) => output.scenePlans?.some((plan) => plan.sceneId === sceneId)) ? 100 : 0), [`${outputs.length}/${batch.departmentSteps.length} 个部门形成完整候选`], missingCoverage),
    dimension("visual_direction", "导演、摄影、灯光与美术统一性", ids(["directing", "cinematography", "lighting", "production_design"]), ["导演、摄影、灯光、美术部门 QA"]),
    dimension("performance_action_sound", "表演、动作与声音可执行性", ids(["performance_directing", "action_choreography", "sound_music"]), ["表演、动作、声音部门 QA"]),
    dimension("asset_continuity", "人物、服化道与资产连续性", ids(["production_design", "wardrobe", "makeup_hair", "props", "continuity"]), ["美术、服装、化妆、道具、场记部门 QA"]),
    dimension("coordination", "跨部门交接与制片统筹", ids(["continuity", "production_coordination"]), ["场记与制片统筹 QA"]),
  ];
  const score = average(dimensions.map((item) => item.score));
  const allPassed = !blockingIssues.length && passed.length === batch.departmentSteps.length;
  const verdict = !allPassed ? "not_ready" : openQuestions.length ? "needs_decision" : "ready_for_storyboard";
  const assetDimension = dimensions.find((item) => item.id === "asset_continuity")!;
  return {
    verdict,
    score,
    summary: verdict === "ready_for_storyboard"
      ? "全部部门通过质检与复检，整集筹备已具备进入分镜的条件。"
      : verdict === "needs_decision" ? `专业筹备已通过，${outputsWithOpenQuestions.length} 个部门仍有待确认事项；不同部门可能指向同一个创作或制作决定。` : `仍有 ${blockingIssues.length} 个阻断项，不能进入分镜。`,
    blockingIssues,
    dimensions,
    assetContinuity: {
      status: assetDimension.score >= MANUAL_FILM_TEAM_MIN_PASS_SCORE && !assetDimension.issues.length ? "pass" : assetDimension.issues.length ? "blocked" : "warning",
      summary: assetDimension.score >= MANUAL_FILM_TEAM_MIN_PASS_SCORE ? "人物、场景、服化道和道具状态已通过相关部门复检。" : "资产连续性仍需处理。",
      issues: assetDimension.issues,
    },
  };
};

class ProductionPreparationNeedsDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionPreparationNeedsDecisionError";
  }
}

export class ProductionPreparationBatchRuntime {
  private running = new Set<string>();

  constructor(
    private readonly generator: AssistantJsonGenerator,
    private readonly repository: AssistantRepository = assistantRepository,
  ) {}

  start() {
    this.repository.listRecoverableBatches().filter((batch) => !batch.manualResponseOnly).forEach((batch) => this.enqueue(batch.id));
  }

  enqueue(batchId: string) {
    if (this.running.has(batchId)) return;
    this.running.add(batchId);
    void trackManualAIWork(new Promise<void>((resolve) => {
      setTimeout(() => { void this.execute(batchId).finally(() => { this.running.delete(batchId); resolve(); }); }, 0);
    }));
  }

  private async executeBreakdowns(batch: ProductionPreparationBatchRun, project: Project, episode: Episode, repairLimit: number) {
    let nextBatch = batch;
    let workingEpisode = { ...episode, scenes: episode.scenes.map((scene) => ({ ...scene })) };
    for (const scene of manualFilmTeamUnitScenes(workingEpisode)) {
      const current = workingEpisode.scenes.find((item) => item.id === scene.id)!;
      const sourceHash = manualFilmTeamScriptHash(productionBreakdownPromptContext(project, workingEpisode, current).source.text);
      if (current.breakdown && current.productionPreparation?.breakdown?.status === "confirmed" && current.productionPreparation.breakdown.sourceHash === sourceHash) {
        nextBatch = this.repository.savePreparationBatch({
          ...nextBatch,
          breakdownCandidates: {
            ...nextBatch.breakdownCandidates,
            [scene.id]: { breakdown: current.breakdown, qa: { score: 100, verdict: "pass", summary: "使用已确认且未过期的场次拆解。", issues: [] }, promptExecutionIds: [], status: "passed" },
          },
          updatedAt: Date.now(),
        });
        continue;
      }
      appendRunEvent(this.repository, nextBatch.assistantRunId, { status: "running", title: `正在拆解：${scene.title}`, detail: "生成场次制片拆解", progress: 3 });
      const generated = await executePrompt(nextBatch, `breakdown:${scene.id}`, `breakdown:${scene.id}:generate`, {
        [CURRENT_BREAKDOWN_MARKER]: current.breakdown ? JSON.stringify(current.breakdown, null, 2) : "",
        [QA_CONTEXT_MARKER]: "",
      }, this.generator, this.repository);
      nextBatch = generated.batch;
      let candidate = normalizeProductionBreakdown(generated.result);
      let qa: SimpleQa = { score: 0, verdict: "revise", summary: "等待质检", issues: [] };
      const executionIds = [generated.execution.id];
      for (let attempt = 0; attempt <= repairLimit; attempt += 1) {
        const qaCall = await executePrompt(nextBatch, `breakdown:${scene.id}`, `breakdown:${scene.id}:qa`, {
          [CURRENT_BREAKDOWN_MARKER]: JSON.stringify(candidate, null, 2),
          [QA_CONTEXT_MARKER]: "",
        }, this.generator, this.repository);
        nextBatch = qaCall.batch;
        executionIds.push(qaCall.execution.id);
        const parsedQa = parseProductionBreakdownQaResult(qaCall.result, {
          requiredSourceRefs: productionBreakdownRequiredSourceRefs(current).map((entry) => entry.ref),
          requiredChecks: PRODUCTION_BREAKDOWN_CURRENT_SCENE_QA_CHECKS,
        });
        qa = {
          score: parsedQa.score,
          verdict: parsedQa.verdict,
          summary: parsedQa.summary,
          issues: parsedQa.issues,
        };
        if (qa.verdict === "pass") break;
        if (attempt >= repairLimit) break;
        appendRunEvent(this.repository, nextBatch.assistantRunId, { status: "repairing", title: `正在修复拆解：${scene.title}`, detail: qa.summary, progress: 5 });
        const repairCall = await executePrompt(nextBatch, `breakdown:${scene.id}`, `breakdown:${scene.id}:optimize`, {
          [CURRENT_BREAKDOWN_MARKER]: JSON.stringify(candidate, null, 2),
          [QA_CONTEXT_MARKER]: JSON.stringify(projectProductionBreakdownRepairQa(qa), null, 2),
        }, this.generator, this.repository);
        nextBatch = repairCall.batch;
        executionIds.push(repairCall.execution.id);
        candidate = normalizeProductionBreakdown(repairCall.result);
      }
      const status = qa.verdict === "pass" ? "passed" : "needs_decision";
      nextBatch = this.repository.savePreparationBatch({
        ...nextBatch,
        breakdownCandidates: { ...nextBatch.breakdownCandidates, [scene.id]: { breakdown: candidate, qa, promptExecutionIds: executionIds, status } },
        updatedAt: Date.now(),
      });
      if (status === "needs_decision") {
        throw new ProductionPreparationNeedsDecisionError(`${scene.title} 的场次拆解经过自动修复后仍未通过。`);
      }
      workingEpisode = {
        ...workingEpisode,
        scenes: workingEpisode.scenes.map((item) => item.id === scene.id ? { ...item, ...productionBreakdownAdoptionUpdates({ scene: item, breakdown: candidate, prompt: promptById(nextBatch, `breakdown:${scene.id}:generate`).prompt }) } : item),
      };
    }
    return { batch: nextBatch, episode: workingEpisode };
  }

  private async executeDepartment(
    batch: ProductionPreparationBatchRun,
    project: Project,
    episode: Episode,
    departmentId: ProductionDepartmentId,
    repairLimit: number,
    forceCollaborationReview = false,
  ) {
    const existingStep = batch.departmentSteps.find((item) => item.departmentId === departmentId)!;
    let nextBatch = batch;
    let step = existingStep;
    const runtime = {
      [BREAKDOWN_CONTEXT_MARKER]: breakdownContextForEpisode(episode),
      [UPSTREAM_CONTEXT_MARKER]: upstreamDepartmentContext(nextBatch, step),
      [COLLABORATION_CONTEXT_MARKER]: manualFilmTeamCollaborationContext(episode, departmentId),
      [CURRENT_OUTPUT_MARKER]: "",
      [QA_CONTEXT_MARKER]: "",
    };
    let output = step.candidate as ManualFilmTeamOutput | undefined;
    let executionIds = [...step.promptExecutionIds];
    if (!output) {
      nextBatch = updateDepartmentStep(nextBatch, departmentId, { status: "generating", startedAt: Date.now(), error: undefined }, this.repository);
      appendRunEvent(this.repository, nextBatch.assistantRunId, { status: "running", departmentId, title: `${manualFilmTeamDepartment(departmentId).name}正在生成`, progress: 12 });
      step = nextBatch.departmentSteps.find((item) => item.departmentId === departmentId)!;
      const generated = await executePrompt(nextBatch, step.id, `department:${departmentId}:generate`, runtime, this.generator, this.repository);
      nextBatch = generated.batch;
      const generationPreview = promptById(nextBatch, `department:${departmentId}:generate`);
      const draft = normalizeManualFilmTeamDraft(generated.result, manualFilmTeamUnitScenes(episode));
      if (!draft.content || draft.scenePlans.length !== manualFilmTeamUnitScenes(episode).length) {
        throw new Error(`${step.departmentName}没有返回覆盖全部正式场次的候选。`);
      }
      const collaboration = manualFilmTeamCollaborationSnapshot(episode, departmentId);
      output = {
        department: departmentId,
        sourceScriptHash: manualFilmTeamScriptHash(manualFilmTeamUnitSource(project, episode).text),
        sourceBreakdownHash: manualFilmTeamBreakdownHash(episode),
        fullScriptHash: manualFilmTeamFullScriptHash(project),
        sourceSceneIds: manualFilmTeamUnitScenes(episode).map((scene) => scene.id),
        ...draft,
        handoffs: normalizeManualFilmTeamHandoffs(generated.result.handoffs, departmentId, 1),
        collaborationSourceHash: collaboration.hash,
        collaborationSourceVersions: collaboration.peerVersions,
        collaborationHandoffIds: collaboration.incomingHandoffs.map((handoff) => handoff.id),
        status: "draft",
        version: 1,
        audit: buildPromptAudit("generate", generationPreview, generated.execution),
        updatedAt: Date.now(),
      };
      executionIds = [generated.execution.id];
    } else if (forceCollaborationReview) {
      nextBatch = updateDepartmentStep(nextBatch, departmentId, { status: "repairing", startedAt: Date.now(), error: undefined }, this.repository);
      const isFinalCoordination = departmentId === "production_coordination";
      appendRunEvent(this.repository, nextBatch.assistantRunId, {
        status: "repairing",
        departmentId,
        title: isFinalCoordination ? `${step.departmentName}正在汇总各部门做最终统筹` : `${step.departmentName}正在处理最新跨部门交接`,
        progress: 82,
      });
      const reconcileCall = await executePrompt(nextBatch, step.id, `department:${departmentId}:optimize`, {
        ...runtime,
        [CURRENT_OUTPUT_MARKER]: outputContext(output),
        [QA_CONTEXT_MARKER]: isFinalCoordination
          ? "各专业部门已完成筹备。请吸收最新协作上下文，解决冲突、更新依赖与风险，并形成进入场记收口前的最终统筹版本。此时不要再向已完成专业部门发送 blocking/review 返工交接；无法裁决的问题必须保留为 openQuestions，交给创作者决定。"
          : "相关部门版本或发给本部门的定向交接已经变化。请只处理最新协作上下文影响的内容，保留仍然正确的专业决定，并明确回应收到的交接。",
      }, this.generator, this.repository);
      nextBatch = reconcileCall.batch;
      executionIds.push(reconcileCall.execution.id);
      const reconciled = normalizeManualFilmTeamDraft(reconcileCall.result, manualFilmTeamUnitScenes(episode));
      if (!reconciled.content || reconciled.scenePlans.length !== manualFilmTeamUnitScenes(episode).length) throw new Error(`${step.departmentName}协作复核结果缺少正式场次覆盖。`);
      const version = output.version + 1;
      const collaboration = manualFilmTeamCollaborationSnapshot(episode, departmentId);
      output = {
        ...output,
        ...reconciled,
        handoffs: normalizeManualFilmTeamHandoffs(reconcileCall.result.handoffs, departmentId, version),
        collaborationSourceHash: collaboration.hash,
        collaborationSourceVersions: collaboration.peerVersions,
        collaborationHandoffIds: collaboration.incomingHandoffs.map((handoff) => handoff.id),
        version,
        qa: undefined,
        status: "draft",
        confirmedAt: undefined,
        audit: buildPromptAudit("optimize", promptById(nextBatch, `department:${departmentId}:optimize`), reconcileCall.execution),
        updatedAt: Date.now(),
      };
    } else {
      output = { ...output, status: "draft", updatedAt: Date.now() };
      nextBatch = updateDepartmentStep(nextBatch, departmentId, { status: "qa", startedAt: Date.now(), error: undefined, candidate: output }, this.repository);
      appendRunEvent(this.repository, nextBatch.assistantRunId, { status: "qa", departmentId, title: `${step.departmentName}从已保存候选继续质检`, progress: 20 });
    }
    let qa: ManualFilmTeamQA | undefined;
    const firstAttempt = productionPreparationQaStartAttempt(step.retryCount, repairLimit, forceCollaborationReview);
    for (let attempt = firstAttempt; attempt <= repairLimit; attempt += 1) {
      nextBatch = updateDepartmentStep(nextBatch, departmentId, { status: attempt ? "rechecking" : "qa", candidate: output, promptExecutionIds: executionIds, retryCount: attempt }, this.repository);
      appendRunEvent(this.repository, nextBatch.assistantRunId, { status: "qa", departmentId, title: `${step.departmentName}正在${attempt ? "复检" : "质检"}`, progress: 20 });
      const outputBatches = manualFilmTeamQaOutputBatches(output);
      const qaParts: Array<ReturnType<typeof normalizeManualFilmTeamQA>> = [];
      const qaExecutions: AssistantPromptExecutionRecord[] = [];
      const validationAttemptLimit = Math.max(2, repairLimit + 2);
      for (let batchIndex = 0; batchIndex < outputBatches.length; batchIndex += 1) {
        const outputBatch = outputBatches[batchIndex];
        let validationError = "";
        let invalidResult: Record<string, unknown> | undefined;
        let validatedPart: ReturnType<typeof normalizeManualFilmTeamQA> | undefined;
        for (let validationAttempt = 0; validationAttempt < validationAttemptLimit; validationAttempt += 1) {
          const qaCall = await executePrompt(nextBatch, step.id, `department:${departmentId}:qa`, {
            ...runtime,
            [CURRENT_OUTPUT_MARKER]: manualFilmTeamQaOutputContext(outputBatch.output, outputBatch.evidenceIds),
            [QA_CONTEXT_MARKER]: [
              `【分批质检边界】\n这是同一次部门质检的第 ${batchIndex + 1}/${outputBatches.length} 个语义批次。只审查本批列出的证据，并逐项返回本批全部 coverage；不得评价未出现在本批的结果。系统会在全部批次完成后合并裁决。`,
              ...(validationError ? [
                `上一次本批质检结构校验失败：${validationError}`,
                "【上一次未通过结构校验的质检结果】",
                JSON.stringify(invalidResult || {}, null, 2),
                "请保留有效判断，只修正本批 coverage 与 issues 的逐项对应、原样 itemId 和原样 outputEvidence；完整返回本批全部证据项，不要省略。",
              ] : []),
            ].join("\n\n"),
          }, this.generator, this.repository);
          nextBatch = qaCall.batch;
          executionIds.push(qaCall.execution.id);
          // Persist every call, including invalid replies, before proceeding to
          // the next batch so a later failure cannot orphan its audit trail.
          nextBatch = updateDepartmentStep(nextBatch, departmentId, { promptExecutionIds: [...executionIds] }, this.repository);
          try {
            validatedPart = normalizeManualFilmTeamQA(qaCall.result, outputBatch.output, outputBatch.evidenceIds);
            qaExecutions.push(qaCall.execution);
            break;
          } catch (error) {
            validationError = error instanceof Error ? error.message : String(error);
            invalidResult = qaCall.result;
          }
        }
        if (!validatedPart) throw new Error(`${step.departmentName}第 ${batchIndex + 1}/${outputBatches.length} 批质检连续返回无法验证的证据结构：${validationError}`);
        qaParts.push(validatedPart);
      }
      const lastQaExecution = qaExecutions[qaExecutions.length - 1];
      if (!lastQaExecution) throw new Error(`${step.departmentName}没有可审查的结果证据。`);
      qa = {
        ...combineManualFilmTeamQAParts(qaParts, manualFilmTeamQaEvidenceCatalog(output).length),
        audit: {
          ...buildPromptAudit("qa", promptById(nextBatch, `department:${departmentId}:qa`), lastQaExecution),
          promptHash: qaExecutions.length === 1 ? lastQaExecution.promptHash : hash(qaExecutions.map((execution) => execution.promptHash)),
        },
        reviewedAt: Date.now(),
      };
      output = { ...output, qa, status: qa.verdict === "pass" ? "confirmed" : "needs_revision", updatedAt: Date.now(), ...(qa.verdict === "pass" ? { confirmedAt: Date.now() } : {}) };
      if (qa.verdict === "pass") break;
      if (attempt >= repairLimit) break;
      nextBatch = updateDepartmentStep(nextBatch, departmentId, { status: "repairing", candidate: output, qa, promptExecutionIds: executionIds, retryCount: attempt + 1 }, this.repository);
      appendRunEvent(this.repository, nextBatch.assistantRunId, { status: "repairing", departmentId, title: `${step.departmentName}正在按质检修改`, detail: qa.summary, progress: 28 });
      const repairCall = await executePrompt(nextBatch, step.id, `department:${departmentId}:optimize`, {
        ...runtime,
        [CURRENT_OUTPUT_MARKER]: outputContext(output),
        [QA_CONTEXT_MARKER]: JSON.stringify(projectManualFilmTeamRepairQa(qa), null, 2),
      }, this.generator, this.repository);
      nextBatch = repairCall.batch;
      executionIds.push(repairCall.execution.id);
      const repaired = normalizeManualFilmTeamDraft(repairCall.result, manualFilmTeamUnitScenes(episode));
      if (!repaired.content || repaired.scenePlans.length !== manualFilmTeamUnitScenes(episode).length) throw new Error(`${step.departmentName}修复结果缺少正式场次覆盖。`);
      const version = output.version + 1;
      const collaboration = manualFilmTeamCollaborationSnapshot(episode, departmentId);
      output = {
        ...output,
        ...repaired,
        handoffs: normalizeManualFilmTeamHandoffs(repairCall.result.handoffs, departmentId, version),
        collaborationSourceHash: collaboration.hash,
        collaborationSourceVersions: collaboration.peerVersions,
        collaborationHandoffIds: collaboration.incomingHandoffs.map((handoff) => handoff.id),
        version,
        status: "draft",
        audit: buildPromptAudit("optimize", promptById(nextBatch, `department:${departmentId}:optimize`), repairCall.execution),
        updatedAt: Date.now(),
      };
    }
    if (!qa || qa.verdict !== "pass") {
      return updateDepartmentStep(nextBatch, departmentId, {
        status: "needs_decision",
        candidate: output,
        qa,
        promptExecutionIds: executionIds,
        blockingIssueIds: qa?.issues.filter((issue) => issue.severity === "blocking" || issue.severity === "warning").map((_, index) => `${departmentId}-issue-${index + 1}`) || [],
        error: `${step.departmentName}自动修复后仍未通过质检。`,
        completedAt: Date.now(),
      }, this.repository);
    }
    return updateDepartmentStep(nextBatch, departmentId, { status: "passed", candidate: output, qa, promptExecutionIds: executionIds, blockingIssueIds: [], completedAt: Date.now() }, this.repository);
  }

  async execute(batchId: string) {
    let batch = this.repository.getPreparationBatch(batchId);
    if (!batch || batch.status === "completed" || batch.status === "cancelled") return;
    if (batch.manualResponseOnly && !currentManualAISessionId()) {
      this.repository.savePreparationBatch({ ...batch, status: "failed", error: "此批次需要手动返回，请从提示词入口恢复。", updatedAt: Date.now() });
      return;
    }
    const authorization = batch.authorizationId ? this.repository.getAuthorization(batch.authorizationId) : null;
    if (!authorization || authorization.status !== "approved" || authorization.expiresAt <= Date.now()) {
      batch = this.repository.savePreparationBatch({ ...batch, status: "failed", error: "批次授权不存在、已失效或已撤销。", updatedAt: Date.now() });
      appendRunEvent(this.repository, batch.assistantRunId, { status: "failed", title: "批次授权失效", detail: batch.error, progress: 0 });
      return;
    }
    try {
      const recoveredAt = Date.now();
      batch = this.repository.savePreparationBatch({
        ...batch,
        status: "running",
        error: undefined,
        promptExecutions: batch.promptExecutions.map((execution) => execution.status === "running" ? {
          ...execution,
          status: "failed",
          error: "服务恢复后已从最近持久状态重新执行该步骤。",
          completedAt: recoveredAt,
        } : execution),
        departmentSteps: batch.departmentSteps.map((step) => ["generating", "qa", "repairing", "rechecking"].includes(step.status)
          ? { ...step, status: "queued", error: undefined, updatedAt: recoveredAt }
          : step),
        updatedAt: recoveredAt,
      });
      appendRunEvent(this.repository, batch.assistantRunId, { status: "running", title: "整集自动筹备已开始", detail: `${batch.workUnit.title} · ${batch.sceneIds.length} 个场次 · ${batch.departmentSteps.length} 个部门`, progress: 1 });
      const { project, episode } = projectAndEpisode(batch.projectId, batch.workUnit.id);
      const breakdownResult = await this.executeBreakdowns(batch, project, episode, authorization.repairLimit);
      batch = breakdownResult.batch;
      let workingEpisode = breakdownResult.episode;
      batch.departmentSteps.filter((step) => step.status === "passed" && step.candidate).forEach((step) => {
        workingEpisode = {
          ...workingEpisode,
          productionTeam: upsertManualFilmTeamOutput(project, workingEpisode, step.candidate as ManualFilmTeamOutput),
        };
      });
      let pending = new Set(orderedDepartments.filter((departmentId) => batch!.departmentSteps.find((step) => step.departmentId === departmentId)?.status !== "passed"));
      let coordinationReconciled = false;
      let collaborationReviewRounds = 0;
      const collaborationReviewLimit = productionPreparationCollaborationReviewLimit(authorization.repairLimit);
      while (pending.size) {
        const closingDependencies = departmentDependencies.continuity.filter((departmentId) => departmentId !== "production_coordination");
        if (
          pending.has("continuity")
          && closingDependencies.every((departmentId) => batch!.departmentSteps.find((step) => step.departmentId === departmentId)?.status === "passed")
        ) {
          let staleDepartments = manualFilmTeamPendingCollaborationReviews(workingEpisode, orderedDepartments);
          while (staleDepartments.length && collaborationReviewRounds < collaborationReviewLimit) {
            collaborationReviewRounds += 1;
            for (const departmentId of staleDepartments) {
              batch = await this.executeDepartment(batch, project, workingEpisode, departmentId, authorization.repairLimit, true);
              const reviewedStep = batch.departmentSteps.find((step) => step.departmentId === departmentId)!;
              if (reviewedStep.status !== "passed") {
                batch = this.repository.savePreparationBatch({ ...batch, status: "needs_decision", error: reviewedStep.error, updatedAt: Date.now() });
                appendRunEvent(this.repository, batch.assistantRunId, { status: "needs_decision", departmentId, title: `${reviewedStep.departmentName}协作复核需要创作者决定`, detail: reviewedStep.error, progress: 88 });
                return;
              }
              workingEpisode = {
                ...workingEpisode,
                productionTeam: upsertManualFilmTeamOutput(project, workingEpisode, reviewedStep.candidate as ManualFilmTeamOutput),
              };
              appendRunEvent(this.repository, batch.assistantRunId, {
                status: "running",
                departmentId,
                title: departmentId === "production_coordination" ? "制片统筹已完成最终复核" : `${reviewedStep.departmentName}已完成定向交接复核`,
                detail: `协作复核第 ${collaborationReviewRounds} 轮`,
                progress: 89,
              });
            }
            staleDepartments = manualFilmTeamPendingCollaborationReviews(workingEpisode, orderedDepartments);
          }
          if (staleDepartments.length) {
            const names = staleDepartments.map((departmentId) => manualFilmTeamDepartment(departmentId).name).join("、");
            batch = this.repository.savePreparationBatch({ ...batch, status: "needs_decision", error: collaborationReviewLimit
              ? `跨部门交接在 ${collaborationReviewLimit} 轮自动复核后仍未收敛：${names}`
              : `自动返修次数已用完，以下跨部门交接需要人工裁决：${names}`, updatedAt: Date.now() });
            appendRunEvent(this.repository, batch.assistantRunId, { status: "needs_decision", title: "跨部门交接需要人工裁决", detail: batch.error, progress: 90 });
            return;
          }
          if (!coordinationReconciled) {
            batch = await this.executeDepartment(batch, project, workingEpisode, "production_coordination", authorization.repairLimit, true);
            const coordinationStep = batch.departmentSteps.find((step) => step.departmentId === "production_coordination")!;
            if (coordinationStep.status !== "passed") {
              batch = this.repository.savePreparationBatch({ ...batch, status: "needs_decision", error: coordinationStep.error, updatedAt: Date.now() });
              appendRunEvent(this.repository, batch.assistantRunId, { status: "needs_decision", departmentId: "production_coordination", title: "制片统筹最终复核需要创作者决定", detail: coordinationStep.error, progress: 90 });
              return;
            }
            const coordinationOutput = coordinationStep.candidate as ManualFilmTeamOutput;
            const unresolvedBackHandoffs = (coordinationOutput.handoffs || []).filter((handoff) =>
              handoff.priority !== "advisory" && handoff.toDepartments.some((departmentId) => departmentId !== "continuity"),
            );
            if (unresolvedBackHandoffs.length) {
              const topics = unresolvedBackHandoffs.map((handoff) => handoff.topic).join("、");
              batch = this.repository.savePreparationBatch({ ...batch, status: "needs_decision", error: `最终制片统筹仍要求已完成部门返工：${topics}`, updatedAt: Date.now() });
              appendRunEvent(this.repository, batch.assistantRunId, { status: "needs_decision", departmentId: "production_coordination", title: "最终统筹仍有未裁决冲突", detail: batch.error, progress: 90 });
              return;
            }
            workingEpisode = {
              ...workingEpisode,
              productionTeam: upsertManualFilmTeamOutput(project, workingEpisode, coordinationOutput),
            };
            coordinationReconciled = true;
            appendRunEvent(this.repository, batch.assistantRunId, { status: "running", departmentId: "production_coordination", title: "制片统筹已完成最终复核", progress: 90 });
          }
        }
        const ready = [...pending].filter((departmentId) => departmentDependencies[departmentId].every((dependency) => batch!.departmentSteps.find((step) => step.departmentId === dependency)?.status === "passed"));
        if (!ready.length) break;
        const settled = await Promise.allSettled(ready.map((departmentId) =>
          this.executeDepartment(batch!, project, workingEpisode, departmentId, authorization.repairLimit),
        ));
        batch = this.repository.getPreparationBatch(batch.id) || batch;
        const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (rejected) throw rejected.reason;
        for (const departmentId of ready) {
          pending.delete(departmentId);
          const step = batch.departmentSteps.find((item) => item.departmentId === departmentId)!;
          if (step.status !== "passed") {
            batch = this.repository.savePreparationBatch({ ...batch, status: "needs_decision", error: step.error, updatedAt: Date.now() });
            appendRunEvent(this.repository, batch.assistantRunId, { status: "needs_decision", departmentId, title: `${step.departmentName}需要创作者决定`, detail: step.error, progress: Math.round((orderedDepartments.length - pending.size) / orderedDepartments.length * 90) });
            return;
          }
          workingEpisode = {
            ...workingEpisode,
            productionTeam: upsertManualFilmTeamOutput(project, workingEpisode, step.candidate as ManualFilmTeamOutput),
          };
          const completed = orderedDepartments.length - pending.size;
          appendRunEvent(this.repository, batch.assistantRunId, { status: "running", departmentId, title: `${step.departmentName}已通过`, progress: 10 + Math.round(completed / orderedDepartments.length * 78) });
        }
      }
      if (pending.size) {
        throw new Error(`部门依赖无法继续：${[...pending].map((departmentId) => manualFilmTeamDepartment(departmentId).name).join("、")}`);
      }
      const qualityGate = qualityGateFor(batch);
      const finalStatus = qualityGate.verdict === "ready_for_storyboard" ? "ready_to_adopt" : qualityGate.verdict === "needs_decision" ? "needs_decision" : "failed";
      batch = this.repository.savePreparationBatch({ ...batch, qualityGate, status: finalStatus, error: qualityGate.blockingIssues[0], updatedAt: Date.now(), completedAt: Date.now() });
      appendRunEvent(this.repository, batch.assistantRunId, { status: finalStatus, title: finalStatus === "ready_to_adopt" ? "整集筹备结果已准备" : finalStatus === "needs_decision" ? "整集筹备需要少量决定" : "整集质量门未通过", detail: qualityGate.summary, progress: finalStatus === "ready_to_adopt" ? 100 : 95, data: { batchId: batch.id, qualityGate } });
    } catch (error) {
      if (error instanceof ProductionPreparationCancelledError) return;
      const message = error instanceof Error ? error.message : String(error);
      const current = this.repository.getPreparationBatch(batchId) || batch;
      const needsDecision = error instanceof ProductionPreparationNeedsDecisionError;
      batch = this.repository.savePreparationBatch({ ...current, status: needsDecision ? "needs_decision" : "failed", error: message, updatedAt: Date.now() });
      appendRunEvent(this.repository, batch.assistantRunId, { status: needsDecision ? "needs_decision" : "failed", title: needsDecision ? "自动修复达到上限" : "整集筹备执行失败", detail: message, progress: 0 });
    }
  }
}

export const adoptProductionPreparationBatch = (
  batchId: string,
  repository: AssistantRepository = assistantRepository,
): { batch: ProductionPreparationBatchRun; changeSet: AssistantChangeSet; project: Project } => {
  const batch = repository.getPreparationBatch(batchId);
  if (!batch) throw new Error("筹备批次不存在。");
  if (batch.status !== "ready_to_adopt" || batch.qualityGate?.verdict !== "ready_for_storyboard") throw new Error("整集筹备结果尚未通过质量门，不能采用。");
  const run = batch.assistantRunId ? repository.getRun(batch.assistantRunId) : null;
  if (!run) throw new Error("筹备批次缺少助手 Run 审计。");
  const before = dbHelpers.getProjectById(batch.projectId) as Project | null;
  if (!before) throw new Error("导演制片项目不存在。");
  const episode = before.episodes.find((item) => item.id === batch.workUnit.id) as Episode | undefined;
  if (!episode) throw new Error("分集或分段不存在。");
  const adoptedScenePlan = before.productionScenePlans
    ?.filter((plan) => plan.sourceDocumentId === episode.sourceDocumentId && plan.status === "adopted")
    .sort((left, right) => right.adoptedAt - left.adoptedAt)[0];
  const formalScenes = episode.scenes.length
    ? episode.scenes
    : adoptedScenePlan?.adoptedSceneSnapshot || [];
  const missingSceneIds = batch.sceneIds.filter((sceneId) => !formalScenes.some((scene) => scene.id === sceneId));
  if (missingSceneIds.length) {
    throw new Error(`正式场次快照不完整，无法采用整集筹备结果：${missingSceneIds.join("、")}`);
  }
  const breakdownEntries = batch.sceneIds.map((sceneId) => ({
    sceneId,
    breakdown: batch.breakdownCandidates[sceneId]?.breakdown,
  })).filter((item) => item.breakdown).map((item) => ({ sceneId: item.sceneId, breakdown: item.breakdown as Scene["breakdown"] }));
  const bound = bindProductionBreakdownAssetsToCanonicalRegistry(before, breakdownEntries);
  const boundProject = { ...before, characters: bound.characters, assets: bound.assets };
  let nextEpisode: Episode = {
    ...episode,
    scenes: formalScenes.map((scene) => {
      const entry = bound.entries.find((item) => item.sceneId === scene.id);
      if (!entry) return scene;
      const prompt = promptById(batch, `breakdown:${scene.id}:generate`).prompt;
      const breakdown = applyProductionSceneManualAssetBindingsToBreakdown({ project: boundProject, scene, breakdown: entry.breakdown });
      return { ...scene, ...productionBreakdownAdoptionUpdates({ scene, breakdown, prompt }) };
    }),
  };
  batch.departmentSteps.forEach((step) => {
    const output = step.candidate as ManualFilmTeamOutput | undefined;
    if (step.status === "passed" && output) nextEpisode = { ...nextEpisode, productionTeam: upsertManualFilmTeamOutput({ ...before, characters: bound.characters, assets: bound.assets }, nextEpisode, { ...output, status: "confirmed", confirmedAt: output.confirmedAt || Date.now() }) };
  });
  const beforeRevision = Number((before as Project & { updatedAt?: number }).updatedAt || 0);
  const afterRevision = Date.now();
  const after = {
    ...before,
    characters: bound.characters,
    assets: bound.assets,
    episodes: before.episodes.map((item) => item.id === nextEpisode.id ? nextEpisode : item),
    updatedAt: afterRevision,
  } as Project & { updatedAt: number };
  const now = Date.now();
  const changeSet: AssistantChangeSet = {
    id: createId("assistant-change-set"),
    runId: run.id,
    projectRef: { namespace: "production", projectId: before.id },
    beforeRevision,
    afterRevision,
    beforeHash: hash(before),
    afterHash: hash(after),
    beforeSnapshot: before,
    afterSnapshot: after,
    invalidationImpact: [
      { kind: "production_asset_package", id: episode.id, label: "旧资产确认包需要重新核对" },
      { kind: "storyboard", id: episode.id, label: "依赖旧部门方案的分镜和故事板需要刷新" },
    ],
    summary: `采用 ${batch.workUnit.title} 的整集筹备结果，写入 ${batch.departmentSteps.length} 个部门和 ${batch.sceneIds.length} 个场次拆解。`,
    status: "committed",
    createdAt: now,
    committedAt: now,
  };
  dbHelpers.saveProject(after);
  repository.saveChangeSet(changeSet);
  if (run.authorizationId) {
    const authorization = repository.getAuthorization(run.authorizationId);
    if (authorization) repository.saveAuthorization({ ...authorization, status: "consumed" });
  }
  const completedBatch = repository.savePreparationBatch({ ...batch, status: "completed", changeSetId: changeSet.id, updatedAt: now, completedAt: now });
  repository.saveRun({ ...run, status: "completed", progress: 100, summary: changeSet.summary, output: { ...(run.output || {}), batchId: batch.id, changeSetId: changeSet.id }, updatedAt: now, completedAt: now });
  return { batch: completedBatch, changeSet, project: after };
};

export const rollbackAssistantChangeSet = (
  changeSetId: string,
  repository: AssistantRepository = assistantRepository,
): AssistantChangeSet => {
  const changeSet = repository.getChangeSet(changeSetId);
  if (!changeSet) throw new Error("改动记录不存在。");
  if (changeSet.status !== "committed") throw new Error("该改动当前不能撤销。");
  if (changeSet.projectRef.namespace !== "production") throw new Error("当前只支持撤销导演制片 ChangeSet。");
  const current = dbHelpers.getProjectById(changeSet.projectRef.projectId);
  if (!current || hash(current) !== changeSet.afterHash) {
    const conflicted = { ...changeSet, status: "conflicted" as const };
    repository.saveChangeSet(conflicted);
    throw new Error("项目在本次操作后又发生了变化，不能直接覆盖；请先查看冲突和依赖影响。");
  }
  if (changeSet.beforeSnapshot === null || changeSet.beforeSnapshot === undefined) dbHelpers.deleteProject(changeSet.projectRef.projectId);
  else dbHelpers.saveProject(changeSet.beforeSnapshot as Project);
  const rolledBack = { ...changeSet, status: "rolled_back" as const, rolledBackAt: Date.now() };
  repository.saveChangeSet(rolledBack);
  const run = repository.getRun(changeSet.runId);
  if (run) repository.saveRun({ ...run, status: "rolled_back", summary: `已撤销：${changeSet.summary}`, updatedAt: Date.now() });
  return rolledBack;
};
