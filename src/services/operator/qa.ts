import type { Episode, Project } from "../../types/project";
import type { CoordinationRepairTicket, ProductionCoordinationReport, ProductionQAIssue } from "../../types/production";
import type { OperatorArtifactEnvelope, OperatorArtifactKind, OperatorIssue, OperatorQAVerdict } from "./types";
import { validateLongFormMemoryRules } from "../production/longFormMemory";
import { validateCoordinationRepairTickets, validateProductionCoordinationReport } from "../production/productionCoordination";
import {
  CreativeChangeRequest,
  LocalResyncPlan,
  PendingAsset,
  validateCreativeChangeRequest,
  validateLocalResyncPlan,
  validatePendingAsset,
  validateVariantRequest,
  VariantRequest,
} from "../production/creativeChange";
import type { SeriesChangeOrder } from "../production/productionChangeOrder";
import { validateSeriesChangeOrder } from "../production/productionChangeOrder";
import type { CastingCandidate, CastingDecision, RoleSlot } from "../production/productionCasting";
import { validateCastingCandidates, validateCastingDecision, validateRoleSlots } from "../production/productionCasting";
import {
  ContentLockPackage,
  DevelopmentAssetBrief,
  ProductionBlockLock,
  ScriptLockPackage,
  validateContentLockPackage,
  validateDevelopmentAssetBrief,
  validateProductionBlockLock,
  validateScriptLockPackage,
} from "../production/productionLock";
import {
  CastingRequirement,
  DepartmentPrepPackage,
  ProductionBreakdownReport,
  validateCastingRequirements,
  validateDepartmentPrepPackages,
  validateProductionBreakdownReport,
} from "../production/productionPrep";
import type { FormalAssetPackage, SceneAssetVariantPack } from "../production/productionAssetPackage";
import { validateFormalAssetPackage, validateSceneAssetVariantPacks } from "../production/productionAssetPackage";
import type { ContinuityMatrix } from "../production/productionContinuity";
import { validateContinuityMatrix } from "../production/productionContinuity";
import type { StoryboardStrategySelectionContext } from "../production/videoStoryboardSystem";
import {
  AssetReferencePack,
  PerformanceBeat,
  SceneVisualPack,
  StoryboardBoard,
  validateAssetReferencePack,
  validatePerformanceBeats,
  validateSceneVisualPack,
  validateStoryboardBoard,
  validateVideoGenerationUnit,
  validateVideoStoryboardPlan,
  VideoGenerationUnit,
  VideoStoryboardArtifactIssue,
  VideoStoryboardPlan,
} from "../production/videoStoryboardArtifacts";
import {
  validateAssetRules,
  validatePromptRules,
  validateScriptRules,
  validateStoryboardRules,
} from "../production/ruleQa";
import type {
  StyleLockChangeOrder,
  StyleReferenceAnalysis,
  VisualStyleLockCandidate,
} from "../production/styleReference";
import {
  validateStyleLockChangeOrder,
  validateStyleReferenceAnalysis,
  validateVisualStyleLockCandidate,
} from "../production/styleReference";
import type { StoryboardStrategyDraft } from "../production/storyboardStrategyDraft";
import { validateStoryboardStrategyDraft } from "../production/storyboardStrategyDraft";
import type { StoryboardStrategyDraftTrial } from "../production/storyboardStrategyTrial";
import { validateStoryboardStrategyDraftTrial } from "../production/storyboardStrategyTrial";

export type OperatorQACheck =
  | "schema"
  | "asset-refs"
  | "script"
  | "storyboard"
  | "visual-prompts"
  | "full";

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const videoStoryboardArtifactKinds = new Set<OperatorArtifactKind>([
  "performance_beats",
  "storyboard_board",
  "scene_visual_pack",
  "asset_reference_pack",
  "video_generation_unit",
]);

const normalizeProjectEpisodes = (project: Project, episodes?: Episode[]) =>
  Array.isArray(episodes) && episodes.length > 0
    ? episodes
    : (((project as any).episodes || []) as Episode[]);

const unwrapData = <T>(data: any, keys: string[]): T | undefined => {
  for (const key of keys) {
    if (data?.[key] !== undefined) return data[key] as T;
  }
  return data as T | undefined;
};

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const videoStoryboardIssueToOperatorIssue = (
  issue: VideoStoryboardArtifactIssue,
): OperatorIssue => ({
  id: nowId(`operator_video_storyboard_${issue.code.toLowerCase()}`),
  severity: issue.severity,
  target: issue.target,
  message: `${issue.code}: ${issue.message}`,
  createdAt: Date.now(),
});

const productionIssueToOperatorIssue = (
  issue: ProductionQAIssue,
): OperatorIssue => ({
  id: issue.id || nowId("operator_production_coordination_issue"),
  severity: issue.severity,
  target: issue.target,
  message: issue.message,
  createdAt: Date.now(),
});

const verdictFromVideoStoryboardIssues = (
  qaAgentId: string,
  issues: VideoStoryboardArtifactIssue[],
  nextActionWhenPassed: OperatorQAVerdict["nextAction"] = "commit",
): OperatorQAVerdict => {
  const blocking = issues.some((issue) => issue.severity === "blocking");
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    qaAgentId,
    status: blocking ? "failed" : issues.length ? "warning" : "passed",
    blocking,
    score: blocking ? 0 : Math.max(60, 100 - warnings * 5),
    issues: issues.map(videoStoryboardIssueToOperatorIssue),
    nextAction: blocking ? "retry" : nextActionWhenPassed,
    createdAt: Date.now(),
  };
};

const verdictFromProductionIssues = (
  qaAgentId: string,
  issues: ProductionQAIssue[],
  nextActionWhenPassed: OperatorQAVerdict["nextAction"] = "commit",
): OperatorQAVerdict => {
  const blocking = issues.some((issue) => issue.severity === "blocking" || issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    qaAgentId,
    status: blocking ? "failed" : issues.length ? "warning" : "passed",
    blocking,
    score: blocking ? 0 : Math.max(60, 100 - warnings * 5),
    issues: issues.map(productionIssueToOperatorIssue),
    nextAction: blocking ? "retry" : nextActionWhenPassed,
    createdAt: Date.now(),
  };
};

const collectVideoStoryboardPlanFromArtifacts = (
  artifacts: OperatorArtifactEnvelope[] = [],
): Partial<VideoStoryboardPlan> => ({
  performanceBeats: artifacts.flatMap((artifact) => extractPerformanceBeats(artifact.data)),
  storyboardBoards: artifacts.flatMap((artifact) => {
    const board = extractStoryboardBoard(artifact.data);
    return board ? [board] : [];
  }),
  assetReferencePacks: artifacts.flatMap((artifact) => {
    const pack = extractAssetReferencePack(artifact.data);
    return pack ? [pack] : [];
  }),
  sceneVisualPacks: artifacts.flatMap((artifact) => {
    const pack = extractSceneVisualPack(artifact.data);
    return pack ? [pack] : [];
  }),
  videoGenerationUnits: artifacts.flatMap((artifact) => {
    const unit = extractVideoGenerationUnit(artifact.data);
    return unit ? [unit] : [];
  }),
});

const extractPerformanceBeats = (data: any): PerformanceBeat[] =>
  asArray<PerformanceBeat>(unwrapData(data, ["performanceBeats", "beats"]));

const extractStoryboardBoard = (data: any): StoryboardBoard | undefined =>
  unwrapData<StoryboardBoard>(data, ["storyboardBoard", "board"]);

const extractAssetReferencePack = (data: any): AssetReferencePack | undefined =>
  unwrapData<AssetReferencePack>(data, ["assetReferencePack", "pack"]);

const extractSceneVisualPack = (data: any): SceneVisualPack | undefined =>
  unwrapData<SceneVisualPack>(data, ["sceneVisualPack", "visualPack", "pack"]);

const extractVideoGenerationUnit = (data: any): VideoGenerationUnit | undefined =>
  unwrapData<VideoGenerationUnit>(data, ["videoGenerationUnit", "unit"]);

const extractProductionCoordinationReport = (data: any): Partial<ProductionCoordinationReport> | undefined =>
  unwrapData<Partial<ProductionCoordinationReport>>(data, ["productionCoordinationReport", "coordinationReport", "report"]);

const extractCoordinationRepairTickets = (data: any): Partial<CoordinationRepairTicket>[] =>
  asArray<Partial<CoordinationRepairTicket>>(data?.repairTickets || data?.coordinationRepairTickets || (
    data?.repairTicket ? [data.repairTicket] : Array.isArray(data) ? data : []
  ));

const extractCreativeChangeRequest = (data: any): Partial<CreativeChangeRequest> | undefined =>
  unwrapData<Partial<CreativeChangeRequest>>(data, ["creativeChangeRequest", "changeRequest", "change"]);

const extractSeriesChangeOrder = (data: any): Partial<SeriesChangeOrder> | undefined =>
  unwrapData<Partial<SeriesChangeOrder>>(data, ["seriesChangeOrder", "changeOrder", "order"]);

const extractPendingAsset = (data: any): Partial<PendingAsset> | undefined =>
  unwrapData<Partial<PendingAsset>>(data, ["pendingAsset", "asset"]);

const extractVariantRequest = (data: any): Partial<VariantRequest> | undefined =>
  unwrapData<Partial<VariantRequest>>(data, ["variantRequest", "variant"]);

const extractLocalResyncPlan = (data: any): Partial<LocalResyncPlan> | undefined =>
  unwrapData<Partial<LocalResyncPlan>>(data, ["localResyncPlan", "resyncPlan", "plan"]);

const extractDevelopmentAssetBrief = (data: any): Partial<DevelopmentAssetBrief> | undefined =>
  unwrapData<Partial<DevelopmentAssetBrief>>(data, ["developmentAssetBrief", "assetBrief", "brief"]);

const extractScriptLockPackage = (data: any): Partial<ScriptLockPackage> | undefined =>
  unwrapData<Partial<ScriptLockPackage>>(data, ["scriptLockPackage", "scriptLock", "lock"]);

const extractContentLockPackage = (data: any): Partial<ContentLockPackage> | undefined =>
  unwrapData<Partial<ContentLockPackage>>(data, ["contentLockPackage", "contentLock", "lock"]);

const extractProductionBlockLock = (data: any): Partial<ProductionBlockLock> | undefined =>
  unwrapData<Partial<ProductionBlockLock>>(data, ["productionBlockLock", "blockLock", "lock"]);

const extractProductionBreakdownReport = (data: any): Partial<ProductionBreakdownReport> | undefined =>
  unwrapData<Partial<ProductionBreakdownReport>>(data, ["productionBreakdownReport", "breakdownReport", "report"]);

const extractContinuityMatrix = (data: any): Partial<ContinuityMatrix> | undefined =>
  unwrapData<Partial<ContinuityMatrix>>(data, ["continuityMatrix", "matrix"]);

const extractRoleSlots = (data: any): Partial<RoleSlot>[] =>
  asArray<Partial<RoleSlot>>(data?.roleSlots || data?.slots || (
    data?.roleSlot ? [data.roleSlot] : Array.isArray(data) ? data : []
  ));

const extractCastingCandidates = (data: any): Partial<CastingCandidate>[] =>
  asArray<Partial<CastingCandidate>>(data?.castingCandidates || data?.candidates || (
    data?.castingCandidate ? [data.castingCandidate] : Array.isArray(data) ? data : []
  ));

const extractCastingRequirements = (data: any): Partial<CastingRequirement>[] =>
  asArray<Partial<CastingRequirement>>(data?.castingRequirements || data?.requirements || (
    data?.castingRequirement ? [data.castingRequirement] : Array.isArray(data) ? data : []
  ));

const extractCastingDecision = (data: any): Partial<CastingDecision> | undefined =>
  unwrapData<Partial<CastingDecision>>(data, ["castingDecision", "decision"]);

const extractDepartmentPrepPackages = (data: any): Partial<DepartmentPrepPackage>[] =>
  asArray<Partial<DepartmentPrepPackage>>(data?.departmentPrepPackages || data?.prepPackages || (
    data?.departmentPrepPackage ? [data.departmentPrepPackage] : Array.isArray(data) ? data : []
  ));

const extractFormalAssetPackage = (data: any): Partial<FormalAssetPackage> | undefined =>
  unwrapData<Partial<FormalAssetPackage>>(data, ["formalAssetPackage", "assetPackage", "package"]);

const extractSceneAssetVariantPacks = (data: any): Partial<SceneAssetVariantPack>[] =>
  asArray<Partial<SceneAssetVariantPack>>(data?.sceneAssetVariantPacks || data?.variantPacks || (
    data?.sceneAssetVariantPack ? [data.sceneAssetVariantPack] : Array.isArray(data) ? data : []
  ));

const extractStyleReferenceAnalysis = (data: any): Partial<StyleReferenceAnalysis> | undefined =>
  unwrapData<Partial<StyleReferenceAnalysis>>(data, ["styleReferenceAnalysis", "analysis"]);

const extractVisualStyleLockCandidate = (data: any): Partial<VisualStyleLockCandidate> | undefined =>
  unwrapData<Partial<VisualStyleLockCandidate>>(data, ["visualStyleLockCandidate", "styleLockCandidate", "candidate"]);

const extractStyleLockChangeOrder = (data: any): Partial<StyleLockChangeOrder> | undefined =>
  unwrapData<Partial<StyleLockChangeOrder>>(data, ["styleLockChangeOrder", "changeOrder", "order"]);

const extractStoryboardStrategyDraft = (data: any): Partial<StoryboardStrategyDraft> | undefined =>
  unwrapData<Partial<StoryboardStrategyDraft>>(data, ["storyboardStrategyDraft", "strategyDraft", "draft"]);

const extractStoryboardStrategyDraftTrial = (data: any): Partial<StoryboardStrategyDraftTrial> | undefined =>
  unwrapData<Partial<StoryboardStrategyDraftTrial>>(data, ["storyboardStrategyDraftTrial", "strategyTrial", "trial"]);

const extractVideoStoryboardPlan = (data: any): Partial<VideoStoryboardPlan> =>
  data?.videoStoryboardPlan && typeof data.videoStoryboardPlan === "object"
    ? data.videoStoryboardPlan
    : data;

const deriveStoryboardStrategyContext = (
  board: StoryboardBoard,
  relatedArtifacts: OperatorArtifactEnvelope[] = [],
): StoryboardStrategySelectionContext => {
  const explicitContext = (board as any).strategySelectionContext;
  if (explicitContext && typeof explicitContext === "object") return explicitContext;
  const plan = collectVideoStoryboardPlanFromArtifacts(relatedArtifacts);
  const beatIds = new Set(board.performanceBeatIds || []);
  const beats = asArray<PerformanceBeat>(plan.performanceBeats).filter((beat) => beatIds.has(beat.id));
  const pack = asArray<AssetReferencePack>(plan.assetReferencePacks).find((item) => item.id === board.assetReferencePackId);
  const durationFromBeats = beats.reduce((total, beat) => total + (Number.isFinite(beat.durationSeconds) ? beat.durationSeconds : 0), 0);
  return {
    dialogueLineCount: beats.reduce((total, beat) => total + Number(beat.dialogueLineCount || 0), 0) || undefined,
    actionBeatCount: beats.reduce((total, beat) => total + Number(beat.actionBeatCount || 0), 0) || undefined,
    combatBeatCount: beats.reduce((total, beat) => total + Number(beat.combatBeatCount || 0), 0) || undefined,
    expectedVideoUnitDurationSeconds: durationFromBeats || board.strategyDecision?.expectedVideoUnitDurationSeconds,
    expectedReferenceImageCount: pack?.items?.filter((item) => item.referenceAssetId || item.referenceImageUrl).length,
    expectedReferenceVideoCount: board.strategyDecision?.expectedReferenceVideoCount,
    modelProfileId: board.strategyDecision?.selectedModelProfileId,
  };
};

const createSchemaIssues = (project: Project, episodes: Episode[]): OperatorIssue[] => {
  const issues: OperatorIssue[] = [];
  if (!project?.id) {
    issues.push({
      id: nowId("operator_schema_issue"),
      severity: "blocking",
      target: "project.id",
      message: "项目缺少 id，不能作为 Operator 写回目标。",
      createdAt: Date.now(),
    });
  }
  if (!project?.title) {
    issues.push({
      id: nowId("operator_schema_issue"),
      severity: "warning",
      target: "project.title",
      message: "项目缺少标题，页面审计和人工接管会难以识别。",
      createdAt: Date.now(),
    });
  }
  episodes.forEach((episode) => {
    if (!episode.id) {
      issues.push({
        id: nowId("operator_schema_issue"),
        severity: "blocking",
        target: "episode.id",
        message: "分集缺少 id，不能安全提交场景或分镜。",
        createdAt: Date.now(),
      });
    }
    (episode.scenes || []).forEach((scene) => {
      if (!scene.id) {
        issues.push({
          id: nowId("operator_schema_issue"),
          severity: "blocking",
          target: `episode.${episode.id}.scene.id`,
          message: "场景缺少 id，不能安全提交剧本或分镜。",
          createdAt: Date.now(),
        });
      }
    });
  });
  return issues;
};

export const runOperatorQA = ({
  check,
  project,
  episodes,
}: {
  check: OperatorQACheck;
  project: Project;
  episodes?: Episode[];
}): OperatorQAVerdict => {
  const scopedEpisodes = normalizeProjectEpisodes(project, episodes);
  const issues = [
    ...(check === "schema" || check === "full" ? createSchemaIssues(project, scopedEpisodes) : []),
    ...(check === "schema" || check === "full" ? validateLongFormMemoryRules(project, scopedEpisodes) : []),
    ...(check === "asset-refs" || check === "full" ? validateAssetRules(project) : []),
    ...(check === "script" || check === "full" ? validateScriptRules(scopedEpisodes, project) : []),
    ...(check === "storyboard" || check === "full" ? validateStoryboardRules(scopedEpisodes, project) : []),
    ...(check === "visual-prompts" || check === "full" ? validatePromptRules(scopedEpisodes, project) : []),
  ];
  const blocking = issues.some((issue) => issue.severity === "blocking");
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  return {
    qaAgentId: `operator.qa.${check}`,
    status: blocking ? "failed" : issues.length ? "warning" : "passed",
    blocking,
    score: blocking ? 0 : Math.max(60, 100 - warnings * 5),
    issues: issues.map((issue) => ({
      id: issue.id || nowId("operator_qa_issue"),
      severity: issue.severity,
      target: issue.target,
      message: issue.message,
      createdAt: Date.now(),
    })),
    nextAction: blocking ? "retry" : "commit",
    createdAt: Date.now(),
  };
};

export const runOperatorArtifactQA = ({
  artifact,
  relatedArtifacts = [],
}: {
  artifact: OperatorArtifactEnvelope;
  relatedArtifacts?: OperatorArtifactEnvelope[];
}): OperatorQAVerdict | undefined => {
  const data: any = artifact.data || {};

  if (artifact.kind === "performance_beats") {
    return verdictFromVideoStoryboardIssues(
      "operator.artifact.performance_beats.qa",
      validatePerformanceBeats(extractPerformanceBeats(data)),
    );
  }

  if (artifact.kind === "storyboard_board") {
    const board = extractStoryboardBoard(data);
    return verdictFromVideoStoryboardIssues(
      "operator.artifact.storyboard_board.qa",
      board ? validateStoryboardBoard(board, deriveStoryboardStrategyContext(board, relatedArtifacts)) : [{
        severity: "blocking",
        code: "STORYBOARD_BOARD_DATA_MISSING",
        target: artifact.targetPath,
        message: "storyboard_board artifact 必须包含 data.storyboardBoard。",
      }],
    );
  }

  if (artifact.kind === "asset_reference_pack") {
    const pack = extractAssetReferencePack(data);
    return verdictFromVideoStoryboardIssues(
      "operator.artifact.asset_reference_pack.qa",
      pack ? validateAssetReferencePack(pack) : [{
        severity: "blocking",
        code: "ASSET_REFERENCE_PACK_DATA_MISSING",
        target: artifact.targetPath,
        message: "asset_reference_pack artifact 必须包含 data.assetReferencePack。",
      }],
    );
  }

  if (artifact.kind === "scene_visual_pack") {
    const pack = extractSceneVisualPack(data);
    const plan = collectVideoStoryboardPlanFromArtifacts(relatedArtifacts);
    const relatedPacks = [
      ...asArray<SceneVisualPack>(plan.sceneVisualPacks),
      ...(pack ? [pack] : []),
    ];
    return verdictFromVideoStoryboardIssues(
      "operator.artifact.scene_visual_pack.qa",
      pack ? validateSceneVisualPack(pack, relatedPacks) : [{
        severity: "blocking",
        code: "SCENE_VISUAL_PACK_DATA_MISSING",
        target: artifact.targetPath,
        message: "scene_visual_pack artifact 必须包含 data.sceneVisualPack。",
      }],
    );
  }

  if (artifact.kind === "video_generation_unit") {
    const unit = extractVideoGenerationUnit(data);
    const plan = collectVideoStoryboardPlanFromArtifacts(relatedArtifacts);
    const pack = unit
      ? asArray<AssetReferencePack>(plan.assetReferencePacks).find((item) => item.id === unit.assetReferencePackId)
      : undefined;
    return verdictFromVideoStoryboardIssues(
      "operator.artifact.video_generation_unit.qa",
      unit ? validateVideoGenerationUnit(unit, pack) : [{
        severity: "blocking",
        code: "VIDEO_UNIT_DATA_MISSING",
        target: artifact.targetPath,
        message: "video_generation_unit artifact 必须包含 data.videoGenerationUnit。",
      }],
      "human_review",
    );
  }

  if (artifact.kind === "style_reference_analysis") {
    return verdictFromProductionIssues(
      "operator.artifact.style_reference_analysis.qa",
      validateStyleReferenceAnalysis(extractStyleReferenceAnalysis(data)),
      "human_review",
    );
  }

  if (artifact.kind === "visual_style_lock_candidate") {
    return verdictFromProductionIssues(
      "operator.artifact.visual_style_lock_candidate.qa",
      validateVisualStyleLockCandidate(extractVisualStyleLockCandidate(data)),
      "human_review",
    );
  }

  if (artifact.kind === "style_lock_change_order") {
    return verdictFromProductionIssues(
      "operator.artifact.style_lock_change_order.qa",
      validateStyleLockChangeOrder(extractStyleLockChangeOrder(data)),
      "human_review",
    );
  }

  if (artifact.kind === "storyboard_strategy_draft") {
    return verdictFromProductionIssues(
      "operator.artifact.storyboard_strategy_draft.qa",
      validateStoryboardStrategyDraft(extractStoryboardStrategyDraft(data)),
      "human_review",
    );
  }

  if (artifact.kind === "storyboard_strategy_draft_trial") {
    return verdictFromProductionIssues(
      "operator.artifact.storyboard_strategy_draft_trial.qa",
      validateStoryboardStrategyDraftTrial(extractStoryboardStrategyDraftTrial(data)),
      "human_review",
    );
  }

  if (artifact.kind === "production_coordination_report") {
    return verdictFromProductionIssues(
      "operator.artifact.production_coordination_report.qa",
      validateProductionCoordinationReport(extractProductionCoordinationReport(data)),
      "human_review",
    );
  }

  if (artifact.kind === "coordination_repair_ticket") {
    return verdictFromProductionIssues(
      "operator.artifact.coordination_repair_ticket.qa",
      validateCoordinationRepairTickets(extractCoordinationRepairTickets(data)),
      "human_review",
    );
  }

  if (artifact.kind === "development_asset_brief") {
    return verdictFromProductionIssues(
      "operator.artifact.development_asset_brief.qa",
      validateDevelopmentAssetBrief(extractDevelopmentAssetBrief(data)),
      "human_review",
    );
  }

  if (artifact.kind === "script_lock_package") {
    return verdictFromProductionIssues(
      "operator.artifact.script_lock_package.qa",
      validateScriptLockPackage(extractScriptLockPackage(data)),
      "human_review",
    );
  }

  if (artifact.kind === "content_lock_package") {
    return verdictFromProductionIssues(
      "operator.artifact.content_lock_package.qa",
      validateContentLockPackage(extractContentLockPackage(data)),
      "human_review",
    );
  }

  if (artifact.kind === "production_block_lock") {
    return verdictFromProductionIssues(
      "operator.artifact.production_block_lock.qa",
      validateProductionBlockLock(extractProductionBlockLock(data)),
      "human_review",
    );
  }

  if (artifact.kind === "production_breakdown_report") {
    return verdictFromProductionIssues(
      "operator.artifact.production_breakdown_report.qa",
      validateProductionBreakdownReport(extractProductionBreakdownReport(data)),
      "human_review",
    );
  }

  if (artifact.kind === "continuity_matrix") {
    return verdictFromProductionIssues(
      "operator.artifact.continuity_matrix.qa",
      validateContinuityMatrix(extractContinuityMatrix(data)),
      "human_review",
    );
  }

  if (artifact.kind === "role_slot") {
    return verdictFromProductionIssues(
      "operator.artifact.role_slot.qa",
      validateRoleSlots(extractRoleSlots(data)),
      "human_review",
    );
  }

  if (artifact.kind === "casting_candidate") {
    return verdictFromProductionIssues(
      "operator.artifact.casting_candidate.qa",
      validateCastingCandidates(extractCastingCandidates(data)),
      "human_review",
    );
  }

  if (artifact.kind === "casting_requirement") {
    return verdictFromProductionIssues(
      "operator.artifact.casting_requirement.qa",
      validateCastingRequirements(extractCastingRequirements(data)),
      "human_review",
    );
  }

  if (artifact.kind === "casting_decision") {
    return verdictFromProductionIssues(
      "operator.artifact.casting_decision.qa",
      validateCastingDecision(extractCastingDecision(data)),
      "human_review",
    );
  }

  if (artifact.kind === "department_prep_package") {
    return verdictFromProductionIssues(
      "operator.artifact.department_prep_package.qa",
      validateDepartmentPrepPackages(extractDepartmentPrepPackages(data)),
      "human_review",
    );
  }

  if (artifact.kind === "formal_asset_package") {
    return verdictFromProductionIssues(
      "operator.artifact.formal_asset_package.qa",
      validateFormalAssetPackage(extractFormalAssetPackage(data)),
      "human_review",
    );
  }

  if (artifact.kind === "asset_identity_board") {
    const packageLike = data?.formalAssetPackage
      ? data.formalAssetPackage
      : {
          schemaVersion: "formal-asset-package.v1",
          id: data?.formalAssetPackageId || data?.packageId || artifact.id,
          projectId: artifact.projectId,
          productionReadiness: data?.productionReadiness || "formal_ready",
          sourceRefs: data?.sourceRefs || {},
          identityBoards: data?.assetIdentityBoards || data?.identityBoards || (data?.assetIdentityBoard ? [data.assetIdentityBoard] : Array.isArray(data) ? data : []),
          packageBlockers: data?.packageBlockers || [],
        };
    return verdictFromProductionIssues(
      "operator.artifact.asset_identity_board.qa",
      validateFormalAssetPackage(packageLike),
      "human_review",
    );
  }

  if (artifact.kind === "scene_asset_variant_pack") {
    return verdictFromProductionIssues(
      "operator.artifact.scene_asset_variant_pack.qa",
      validateSceneAssetVariantPacks(extractSceneAssetVariantPacks(data)),
      "human_review",
    );
  }

  if (artifact.kind === "asset_variant_fingerprint") {
    const packs = extractSceneAssetVariantPacks(data);
    const fallbackPack: Partial<SceneAssetVariantPack>[] = packs.length
      ? packs
      : [{
          schemaVersion: "scene-asset-variant-pack.v1",
          id: data?.sceneAssetVariantPackId || artifact.id,
          projectId: artifact.projectId,
          formalAssetPackageId: data?.formalAssetPackageId || "unknown",
          visualFingerprint: data?.visualFingerprint || "unknown",
          linkedSceneIds: data?.linkedSceneIds || [],
          usageRefs: data?.usageRefs || [],
          variantFingerprints: data?.assetVariantFingerprints || data?.variantFingerprints || (data?.assetVariantFingerprint ? [data.assetVariantFingerprint] : Array.isArray(data) ? data : []),
        }];
    return verdictFromProductionIssues(
      "operator.artifact.asset_variant_fingerprint.qa",
      validateSceneAssetVariantPacks(fallbackPack),
      "human_review",
    );
  }

  if (artifact.kind === "creative_change_request") {
    return verdictFromProductionIssues(
      "operator.artifact.creative_change_request.qa",
      validateCreativeChangeRequest(extractCreativeChangeRequest(data), {
        targetStageType: data?.targetStageType,
        formalDeliveryCheck: data?.formalDeliveryCheck === true,
      }),
      "human_review",
    );
  }

  if (artifact.kind === "series_change_order") {
    return verdictFromProductionIssues(
      "operator.artifact.series_change_order.qa",
      validateSeriesChangeOrder(extractSeriesChangeOrder(data)),
      "human_review",
    );
  }

  if (artifact.kind === "pending_asset") {
    return verdictFromProductionIssues(
      "operator.artifact.pending_asset.qa",
      validatePendingAsset(extractPendingAsset(data)),
      "human_review",
    );
  }

  if (artifact.kind === "variant_request") {
    return verdictFromProductionIssues(
      "operator.artifact.variant_request.qa",
      validateVariantRequest(extractVariantRequest(data)),
      "human_review",
    );
  }

  if (artifact.kind === "local_resync_plan") {
    return verdictFromProductionIssues(
      "operator.artifact.local_resync_plan.qa",
      validateLocalResyncPlan(extractLocalResyncPlan(data)),
      "human_review",
    );
  }

  const maybePlan = extractVideoStoryboardPlan(data);
  const looksLikeVideoStoryboardPlan = artifact.kind === "custom" &&
    (artifact.targetPath === "videoStoryboardPlan" ||
      Array.isArray((maybePlan as any).performanceBeats) ||
      Array.isArray((maybePlan as any).storyboardBoards) ||
      Array.isArray((maybePlan as any).assetReferencePacks) ||
      Array.isArray((maybePlan as any).videoGenerationUnits));
  if (looksLikeVideoStoryboardPlan) {
    return verdictFromVideoStoryboardIssues(
      "operator.artifact.video_storyboard_plan.qa",
      validateVideoStoryboardPlan(maybePlan),
      "human_review",
    );
  }

  if (videoStoryboardArtifactKinds.has(artifact.kind)) {
    return verdictFromVideoStoryboardIssues(
      `operator.artifact.${artifact.kind}.qa`,
      [{
        severity: "blocking",
        code: "VIDEO_STORYBOARD_ARTIFACT_UNSUPPORTED",
        target: artifact.targetPath,
        message: `无法识别 ${artifact.kind} artifact 的数据结构。`,
      }],
    );
  }

  return undefined;
};
