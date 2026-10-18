import type { Episode, Project, Scene, Shot } from "../../types/project";
import type {
  CoordinationRepairTicket,
  HumanInterventionTask,
  ProductionCoordinationReport,
  ProductionCoordinationScope,
  ProductionDepartmentFinding,
  ProductionGateVerdict,
  ProductionQAReport,
  ProductionRun,
  ProductionStageRun,
  ProductionStageType,
  QAIssueResolutionClass,
} from "../../types/production";
import type { OperatorArtifactEnvelope } from "../operator/types";
import type { CreativeChangeRequest, PendingAsset, VariantRequest } from "./creativeChange";
import type { ContentLockPackage, ProductionBlockLock, ScriptLockPackage } from "./productionLock";
import type {
  CastingRequirement,
  DepartmentPrepPackage,
  ProductionBreakdownReport,
  ProductionPrepDepartment,
} from "./productionPrep";
import type { ProductionSeriesGovernanceSnapshot, SeriesChangeOrder } from "./productionChangeOrder";
import type { CastingCandidate, CastingDecision, RoleSlot } from "./productionCasting";
import type { SceneAssetVariantPack } from "./productionAssetPackage";
import type { ContinuityMatrix } from "./productionContinuity";
import {
  buildProductionCoordinationStageGate,
  buildProductionCoordinationWrapQA,
  collectProductionCoordinationArtifacts,
} from "./productionCoordination";
import { buildProductionSeriesGovernanceSnapshot } from "./productionChangeOrder";
import { buildContinuityMatrix } from "./productionContinuity";
import {
  buildStoryboardStrategyImpactPlan,
  type StoryboardStrategyImpactPlan,
} from "./storyboardStrategyImpact";

type CockpitEnvironment = "test" | "production" | "development";
type CockpitActionPriority = "high" | "medium" | "low";
type CockpitActionType =
  | "proceed"
  | "repair"
  | "human_review"
  | "resolve_soft_hold"
  | "promote_pending_asset"
  | "save_coordination_report";

export interface ProductionCockpitInput {
  project: Project;
  episodes?: Episode[];
  operatorArtifacts?: OperatorArtifactEnvelope[];
  productionRuns?: ProductionRun[];
  productionRunId?: string;
  operatorRunId?: string;
  scope?: ProductionCoordinationScope;
  stageType?: ProductionStageType;
  environment?: CockpitEnvironment;
  capturedAt?: number;
}

export interface ProductionCockpitAction {
  id: string;
  actionType: CockpitActionType;
  priority: CockpitActionPriority;
  label: string;
  reason: string;
  ownerAgentId?: string;
  suggestedStageType?: ProductionStageType;
  targetPath?: string;
  ticketId?: string;
  findingId?: string;
  artifactId?: string;
}

export interface ProductionCockpitSnapshot {
  schemaVersion: "production-cockpit.v1";
  projectId: string;
  generatedAt: number;
  scope: {
    coordinationScope: ProductionCoordinationScope;
    environment: CockpitEnvironment;
    productionRunId?: string;
    operatorRunId?: string;
    stageType?: ProductionStageType;
    episodeIds: string[];
    sceneIds: string[];
    shotIds: string[];
  };
  currentStage: {
    source: "production_run" | "query" | "unknown";
    productionRunId?: string;
    stageId?: string;
    stageType?: ProductionStageType;
    title?: string;
    status?: string;
    productionRunStatus?: string;
    updatedAt?: number;
  };
  counts: {
    productionRuns: number;
    operatorArtifacts: number;
    episodes: number;
    scenes: number;
    shots: number;
    departmentFindings: number;
    hardBlocks: number;
    autoRepairable: number;
    softHolds: number;
    advisory: number;
    repairTickets: number;
    openRepairTickets: number;
    blockedRepairTickets: number;
    coordinationTraceLinks: number;
    coordinationTraceUnresolved: number;
    humanInterventionTasks: number;
    pendingCreativeChanges: number;
    seriesChangeOrders: number;
    openSeriesChangeOrders: number;
    pendingAssets: number;
    pendingVariantRequests: number;
    continuityRows: number;
    continuityNeedsReview: number;
    continuityBlocked: number;
    missingDepartmentPackages: number;
    departmentCoverageReady: number;
    departmentCoverageNeedsReview: number;
    departmentCoverageBlocked: number;
  };
  coordination: {
    report: ProductionCoordinationReport;
    gate: {
      blocking: boolean;
      canProceed: boolean;
      nextAction: "proceed" | "repair" | "human_review" | "blocked";
      reason: string;
      circuitBreakerStatus: string;
      humanInterventionRequired: boolean;
    };
    trace: ProductionCoordinationReport["coordinationTrace"];
  };
  departmentFindings: ProductionDepartmentFinding[];
  hardBlocks: ProductionDepartmentFinding[];
  autoRepairableFindings: ProductionDepartmentFinding[];
  softHolds: ProductionDepartmentFinding[];
  advisoryFindings: ProductionDepartmentFinding[];
  repairTickets: CoordinationRepairTicket[];
  coordinationTrace: ProductionCoordinationReport["coordinationTrace"];
  humanInterventionTasks: HumanInterventionTask[];
  handoffManifest: ProductionCoordinationReport["handoffManifest"];
  departmentCoverage: ProductionCoordinationReport["departmentCoverage"];
  missingDepartmentPackages: ProductionCoordinationReport["missingDepartmentPackages"];
  departmentQaSummary: ProductionCoordinationReport["departmentQaSummary"];
  styleStrategy: {
    styleLockVersion?: string;
    styleLockApprovalState?: string;
    styleSourceRefCount: number;
    candidateCount: number;
    openCandidateCount: number;
    changeOrderCount: number;
    pendingChangeOrderCount: number;
    approvedUncommittedChangeOrderCount: number;
    storyboardBoardCount: number;
    assetReferencePackCount: number;
    videoGenerationUnitCount: number;
    boardsWithStyleVersion: number;
    packsWithStyleVersion: number;
    unitsWithStyleVersion: number;
    customStrategyBoardCount: number;
    strategyDraftCount: number;
    approvedStrategyDraftCount: number;
    strategyTrialCount: number;
    passedStrategyTrialCount: number;
    promotionCandidateCount: number;
    styleStrategyFindings: ProductionDepartmentFinding[];
    impactPlan: StoryboardStrategyImpactPlan;
  };
  creativeBackflow: {
    openChangeCount: number;
    pendingAssetCount: number;
    pendingVariantRequestCount: number;
    formalDeliveryBlockers: string[];
    changes: Array<{
      artifactId: string;
      changeRequestId: string;
      title: string;
      status: CreativeChangeRequest["status"];
      kind: CreativeChangeRequest["kind"];
      department: CreativeChangeRequest["department"];
      pendingAssets: PendingAsset[];
      variantRequests: VariantRequest[];
      localResyncPlanId?: string;
      formalDeliveryBlockers: string[];
    }>;
  };
  productionGovernance: ProductionSeriesGovernanceSnapshot;
  productionSchedule: {
    schemaVersion: "production-schedule-read-model.v1";
    mode: string;
    lockStatus: string;
    currentBlockId?: string;
    scope: string;
    targetEpisodeCount: number;
    existingEpisodeCount: number;
    lockedEpisodeCount: number;
    missingEpisodeCount: number;
    lockedNodeCount: number;
    breakdownCoverageRatio: number;
    currentBlockReady: boolean;
    fullSeriesReady: boolean;
    openChangeOrderCount: number;
    departmentReadiness: Array<{
      department: ProductionPrepDepartment;
      ready: number;
      needsReview: number;
      blocked: number;
    }>;
    blockers: string[];
    nextActions: string[];
  };
  productionPrep: {
    latestBreakdown?: {
      artifactId?: string;
      id: string;
      blockId?: string;
      mode?: string;
      sceneCount: number;
      nodeCount: number;
      characterCount: number;
      locationCount: number;
      propCount: number;
      variantCount: number;
      departmentCounts: Partial<Record<ProductionPrepDepartment, number>>;
    };
    sceneMatrix: Array<{
      sourceType: "scene" | "node";
      episodeId?: string;
      sceneId?: string;
      nodeId?: string;
      title: string;
      locationName?: string;
      timeOfDay?: string;
      characterCount: number;
      propCount: number;
      variantCount: number;
      shotCount: number;
    }>;
    roleSlots: Array<{
      artifactId?: string;
      id: string;
      displayName: string;
      narrativeFunction: string;
      source: RoleSlot["source"];
      priority: RoleSlot["priority"];
      status: RoleSlot["status"];
      characterId?: string;
      castingRequirementId?: string;
      lockedRefCount: number;
      candidateCount: number;
      latestCandidateId?: string;
      latestCandidateStatus?: CastingCandidate["candidateStatus"];
    }>;
    castingRequirements: Array<{
      artifactId?: string;
      id: string;
      productionBreakdownReportId: string;
      roleSlotId: string;
      characterId?: string;
      displayName: string;
      priority: CastingRequirement["priority"];
      status: CastingRequirement["status"];
      sceneCount: number;
      episodeIds: string[];
      sceneIds: string[];
      nodeIds: string[];
      sceneAppearances: CastingRequirement["sceneAppearances"];
      performanceRange: string[];
      costumeConstraints: string[];
      stuntNeeds: string[];
      latestDecisionStatus?: CastingDecision["status"];
      latestDecisionType?: CastingDecision["decisionType"];
      latestDecisionId?: string;
      candidateCount: number;
      latestCandidateId?: string;
      latestCandidateStatus?: CastingCandidate["candidateStatus"];
    }>;
    castingCandidates: Array<{
      artifactId?: string;
      id: string;
      roleSlotId: string;
      castingRequirementId?: string;
      displayName: string;
      source: CastingCandidate["source"];
      candidateStatus: CastingCandidate["candidateStatus"];
      characterId?: string;
      identityBoardArtifactId?: string;
      referenceAssetCount: number;
      suitabilityNoteCount: number;
      riskNoteCount: number;
    }>;
    castingDecisions: Array<{
      artifactId?: string;
      id: string;
      castingRequirementId: string;
      roleSlotId: string;
      displayName: string;
      decisionType: CastingDecision["decisionType"];
      status: CastingDecision["status"];
      candidateName: string;
      identityBoardArtifactId?: string;
      requiredFollowupCount: number;
      affectedEpisodeIds: string[];
      affectedSceneIds: string[];
      affectedNodeIds: string[];
    }>;
    departmentPrepPackages: Array<{
      artifactId?: string;
      id: string;
      department: ProductionPrepDepartment;
      ownerAgentId: string;
      readiness: DepartmentPrepPackage["readiness"];
      requiredAssetCount: number;
      variantCount: number;
      continuityCount: number;
      openQuestionCount: number;
      episodeIds: string[];
      sceneIds: string[];
      nodeIds: string[];
      sampleAssets: Array<{
        assetId?: string;
        name: string;
        type: string;
        sceneCount: number;
        nodeCount: number;
        shotCount: number;
      }>;
    }>;
    totals: {
      breakdownReports: number;
      sceneMatrixRows: number;
      roleSlots: number;
      castingRequirements: number;
      castingCandidates: number;
      castingDecisions: number;
      approvedCastingDecisions: number;
      departmentPrepPackages: number;
      readyDepartments: number;
      blockedDepartments: number;
      needsReviewDepartments: number;
    };
  };
  productionContinuity: {
    latestMatrix?: {
      artifactId?: string;
      id: string;
      rowCount: number;
      blocked: number;
      needsReview: number;
      clear: number;
    };
    rows: Array<{
      id: string;
      sourceType: "scene" | "node";
      episodeId?: string;
      sceneId?: string;
      nodeId?: string;
      title: string;
      sequenceIndex: number;
      targetType: string;
      targetId?: string;
      targetName: string;
      department: ProductionPrepDepartment;
      visibleState: string;
      continuityIn: string;
      continuityOut: string;
      previousRowId?: string;
      nextRowId?: string;
      variantIds: string[];
      sceneAssetVariantPackIds: string[];
      riskLevel: string;
      riskNotes: string[];
    }>;
    issues: Array<{
      id: string;
      severity: string;
      target: string;
      message: string;
      rowIds: string[];
    }>;
    totals: ContinuityMatrix["totals"];
  };
  deliveryMode: {
    draftExploration: {
      allowed: true;
      canCreateCreativeChanges: boolean;
      reason: string;
    };
    formalDelivery: {
      canRequestStageExit: boolean;
      requiredGate: ProductionCoordinationScope;
      nextAction: "proceed" | "repair" | "human_review" | "blocked";
      blockers: string[];
      reason: string;
    };
  };
  storyboardChain: {
    scriptBlocks: number;
    shots: number;
    artifactCounts: {
      performanceBeats: number;
      storyboardBoards: number;
      sceneVisualPacks: number;
      assetReferencePacks: number;
      videoGenerationUnits: number;
      generationPlans: number;
    };
    generationStatus: {
      status: "not_planned" | "ready";
      videoUnitCount: number;
      reason: string;
    };
  };
  artifactRefs: Array<{
    id: string;
    kind: string;
    status: string;
    targetPath: string;
    runId: string;
    updatedAt: number;
    latestQaStatus?: string;
    latestQaNextAction?: string;
  }>;
  latestCoordinationReport?: {
    artifactId: string;
    reportId: string;
    approvalState: ProductionCoordinationReport["approvalState"];
    capturedAt: number;
  };
  nextActions: ProductionCockpitAction[];
}

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const scenesFromEpisodes = (episodes: Episode[]): Scene[] =>
  episodes.flatMap((episode) => asArray<Scene>(episode.scenes));

const shotsFromScenes = (scenes: Scene[]): Shot[] =>
  scenes.flatMap((scene) => asArray<Shot>(scene.shots));

const latestByUpdatedAt = <T extends { updatedAt?: number }>(items: T[]): T | undefined =>
  [...items].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];

const latestQa = (artifact: OperatorArtifactEnvelope) =>
  artifact.qaVerdicts && artifact.qaVerdicts.length
    ? artifact.qaVerdicts[artifact.qaVerdicts.length - 1]
    : undefined;

const styleLockVersionForProject = (project: Project) =>
  String(project.visualStyleLock?.version || "").trim() ||
  (project.visualStyleLock?.lockedAt ? `visual-style-lock.${project.visualStyleLock.lockedAt}` : undefined);

const unwrapCoordinationReport = (artifact: OperatorArtifactEnvelope): ProductionCoordinationReport | undefined => {
  const data: any = artifact.data;
  const report = data?.productionCoordinationReport || data?.coordinationReport || data?.report ||
    (artifact.kind === "production_coordination_report" ? data : undefined);
  return report?.schemaVersion === "production-coordination-report.v1" ? report as ProductionCoordinationReport : undefined;
};

const unwrapCoordinationRepairTickets = (artifact: OperatorArtifactEnvelope): CoordinationRepairTicket[] => {
  const data: any = artifact.data;
  if (Array.isArray(data?.repairTickets)) return data.repairTickets;
  if (Array.isArray(data?.coordinationRepairTickets)) return data.coordinationRepairTickets;
  const ticket = data?.coordinationRepairTicket || (artifact.kind === "coordination_repair_ticket" ? data : undefined);
  return ticket?.id ? [ticket as CoordinationRepairTicket] : [];
};

const unwrapCreativeChangeRequest = (artifact: OperatorArtifactEnvelope): CreativeChangeRequest | undefined => {
  const data: any = artifact.data;
  const change = data?.creativeChangeRequest || (artifact.kind === "creative_change_request" ? data : undefined);
  return change?.schemaVersion === "creative-change-request.v1" ? change as CreativeChangeRequest : undefined;
};

const unwrapSeriesChangeOrder = (artifact: OperatorArtifactEnvelope): SeriesChangeOrder | undefined => {
  const data: any = artifact.data;
  const order = data?.seriesChangeOrder || data?.changeOrder || (artifact.kind === "series_change_order" ? data : undefined);
  return order?.schemaVersion === "series-change-order.v1" ? order as SeriesChangeOrder : undefined;
};

const unwrapVisualStyleLockCandidate = (artifact: OperatorArtifactEnvelope): any | undefined => {
  const data: any = artifact.data;
  const candidate = data?.visualStyleLockCandidate || data?.styleLockCandidate ||
    (artifact.kind === "visual_style_lock_candidate" ? data?.candidate || data : undefined);
  return candidate?.schemaVersion === "visual-style-lock-candidate.v1" ? candidate : undefined;
};

const unwrapStyleLockChangeOrder = (artifact: OperatorArtifactEnvelope): any | undefined => {
  const data: any = artifact.data;
  const order = data?.styleLockChangeOrder || data?.changeOrder || data?.order ||
    (artifact.kind === "style_lock_change_order" ? data : undefined);
  return order?.schemaVersion === "style-lock-change-order.v1" ? order : undefined;
};

const unwrapStoryboardStrategyDraft = (artifact: OperatorArtifactEnvelope): any | undefined => {
  const data: any = artifact.data;
  const draft = data?.storyboardStrategyDraft || data?.strategyDraft || data?.draft ||
    (artifact.kind === "storyboard_strategy_draft" ? data : undefined);
  return draft?.schemaVersion === "storyboard-strategy-draft.v1" ? draft : undefined;
};

const unwrapStoryboardStrategyTrial = (artifact: OperatorArtifactEnvelope): any | undefined => {
  const data: any = artifact.data;
  const trial = data?.storyboardStrategyDraftTrial || data?.strategyTrial || data?.trial ||
    (artifact.kind === "storyboard_strategy_draft_trial" ? data : undefined);
  return trial?.schemaVersion === "storyboard-strategy-draft-trial.v1" ? trial : undefined;
};

const unwrapScriptLockPackage = (artifact: OperatorArtifactEnvelope): ScriptLockPackage | undefined => {
  const data: any = artifact.data;
  const lock = data?.scriptLockPackage || data?.scriptLock || (artifact.kind === "script_lock_package" ? data : undefined);
  return lock?.schemaVersion === "script-lock-package.v1" ? lock as ScriptLockPackage : undefined;
};

const unwrapContentLockPackage = (artifact: OperatorArtifactEnvelope): ContentLockPackage | undefined => {
  const data: any = artifact.data;
  const lock = data?.contentLockPackage || data?.contentLock || (artifact.kind === "content_lock_package" ? data : undefined);
  return lock?.schemaVersion === "content-lock-package.v1" ? lock as ContentLockPackage : undefined;
};

const unwrapProductionBlockLock = (artifact: OperatorArtifactEnvelope): ProductionBlockLock | undefined => {
  const data: any = artifact.data;
  const lock = data?.productionBlockLock || data?.blockLock || (artifact.kind === "production_block_lock" ? data : undefined);
  return lock?.schemaVersion === "production-block-lock.v1" ? lock as ProductionBlockLock : undefined;
};

const unwrapProductionBreakdownReport = (artifact: OperatorArtifactEnvelope): ProductionBreakdownReport | undefined => {
  const data: any = artifact.data;
  const report = data?.productionBreakdownReport || data?.breakdownReport || (artifact.kind === "production_breakdown_report" ? data : undefined);
  return report?.schemaVersion === "production-breakdown-report.v1" ? report as ProductionBreakdownReport : undefined;
};

const unwrapContinuityMatrix = (artifact: OperatorArtifactEnvelope): ContinuityMatrix | undefined => {
  const data: any = artifact.data;
  const matrix = data?.continuityMatrix || data?.matrix || (artifact.kind === "continuity_matrix" ? data : undefined);
  return matrix?.schemaVersion === "continuity-matrix.v1" ? matrix as ContinuityMatrix : undefined;
};

const unwrapSceneAssetVariantPacks = (artifact: OperatorArtifactEnvelope): SceneAssetVariantPack[] => {
  const data: any = artifact.data;
  const candidates = data?.sceneAssetVariantPacks || data?.sceneAssetVariantPack || (artifact.kind === "scene_asset_variant_pack" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "scene-asset-variant-pack.v1") as SceneAssetVariantPack[];
};

const unwrapRoleSlots = (artifact: OperatorArtifactEnvelope): RoleSlot[] => {
  const data: any = artifact.data;
  const candidates = data?.roleSlots || data?.roleSlot || (artifact.kind === "role_slot" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "role-slot.v1") as RoleSlot[];
};

const unwrapCastingCandidates = (artifact: OperatorArtifactEnvelope): CastingCandidate[] => {
  const data: any = artifact.data;
  const candidates = data?.castingCandidates || data?.castingCandidate || (artifact.kind === "casting_candidate" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "casting-candidate.v1") as CastingCandidate[];
};

const unwrapCastingDecision = (artifact: OperatorArtifactEnvelope): CastingDecision | undefined => {
  const data: any = artifact.data;
  const decision = data?.castingDecision || data?.decision || (artifact.kind === "casting_decision" ? data : undefined);
  return decision?.schemaVersion === "casting-decision.v1" ? decision as CastingDecision : undefined;
};

const unwrapCastingRequirements = (artifact: OperatorArtifactEnvelope): CastingRequirement[] => {
  const data: any = artifact.data;
  const candidates = data?.castingRequirements || data?.castingRequirement || (artifact.kind === "casting_requirement" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "casting-requirement.v1") as CastingRequirement[];
};

const unwrapDepartmentPrepPackages = (artifact: OperatorArtifactEnvelope): DepartmentPrepPackage[] => {
  const data: any = artifact.data;
  const candidates = data?.departmentPrepPackages || data?.departmentPrepPackage || (artifact.kind === "department_prep_package" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "department-prep-package.v1") as DepartmentPrepPackage[];
};

const collectStageFacts = (productionRuns: ProductionRun[], stageType?: ProductionStageType) => {
  const stageMatches = (stage: ProductionStageRun) => !stageType || stage.stageType === stageType;
  const stages = productionRuns.flatMap((run) => asArray<ProductionStageRun>(run.stages).filter(stageMatches));
  return {
    qaReports: stages.flatMap((stage) => asArray<ProductionQAReport>(stage.qaReports)),
    gateVerdicts: stages.flatMap((stage) => asArray<ProductionGateVerdict>(stage.gateVerdicts)),
  };
};

const resolveCurrentStage = (
  productionRuns: ProductionRun[],
  productionRunId?: string,
  stageType?: ProductionStageType,
): ProductionCockpitSnapshot["currentStage"] => {
  const sortedRuns = [...productionRuns].sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  const run = productionRunId
    ? sortedRuns.find((item) => item.id === productionRunId)
    : sortedRuns[0];
  const stages = asArray<ProductionStageRun>(run?.stages);
  const stage = stages.find((item) => item.id === run?.currentStageId) ||
    (stageType ? stages.find((item) => item.stageType === stageType) : undefined) ||
    stages.find((item) => ["running", "qa_running", "retrying", "needs_human_review", "awaiting_prompt_approval"].includes(item.status)) ||
    stages[0];

  if (run && stage) {
    return {
      source: "production_run",
      productionRunId: run.id,
      stageId: stage.id,
      stageType: stage.stageType,
      title: stage.title,
      status: stage.status,
      productionRunStatus: run.status,
      updatedAt: run.updatedAt,
    };
  }
  if (stageType) {
    return {
      source: "query",
      stageType,
    };
  }
  return { source: "unknown" };
};

const resolutionClass = (finding: ProductionDepartmentFinding): QAIssueResolutionClass =>
  finding.resolutionClass || (finding.severity === "warning" ? "soft_hold" : finding.severity === "info" ? "advisory" : "hard_blocking");

const artifactCount = (artifacts: OperatorArtifactEnvelope[], kind: string) =>
  artifacts.filter((artifact) => artifact.kind === kind).length;

const checkpointArtifact = (
  run: ProductionRun,
  checkpoint: NonNullable<ProductionRun["checkpoints"]>[number],
  kind: OperatorArtifactEnvelope["kind"],
  data: unknown,
  entityIds: string[] = [],
): OperatorArtifactEnvelope => ({
  id: `production-run:${run.id}:${checkpoint.id}:${kind}`,
  runId: run.id,
  projectId: run.projectId,
  kind,
  targetPath: `productionRun.${checkpoint.stageId}.${kind}`,
  entityIds: uniq([run.projectId, ...entityIds]),
  status: "approved",
  data,
  qaVerdicts: [],
  provenance: {
    provider: "other",
    handbookVersion: "production-run-checkpoint",
    source: "operator",
    generatedAt: checkpoint.createdAt,
  },
  createdAt: checkpoint.createdAt,
  updatedAt: checkpoint.createdAt,
});

const operatorArtifactsFromProductionRuns = (productionRuns: ProductionRun[]): OperatorArtifactEnvelope[] => {
  const artifacts: OperatorArtifactEnvelope[] = [];
  for (const run of productionRuns) {
    for (const checkpoint of asArray<ProductionRun["checkpoints"][number]>(run.checkpoints)) {
      if (checkpoint.kind !== "output" || !checkpoint.snapshot || typeof checkpoint.snapshot !== "object") continue;
      const snapshot = checkpoint.snapshot as Record<string, any>;
      if (snapshot.scriptLockPackage) {
        artifacts.push(checkpointArtifact(run, checkpoint, "script_lock_package", { scriptLockPackage: snapshot.scriptLockPackage }, snapshot.scriptLockPackage.episodeIds));
      }
      if (snapshot.contentLockPackage) {
        artifacts.push(checkpointArtifact(run, checkpoint, "content_lock_package", { contentLockPackage: snapshot.contentLockPackage }, snapshot.contentLockPackage.nodeIds));
      }
      if (snapshot.productionBlockLock) {
        artifacts.push(checkpointArtifact(run, checkpoint, "production_block_lock", { productionBlockLock: snapshot.productionBlockLock }, [
          ...(snapshot.productionBlockLock.episodeIds || []),
          ...(snapshot.productionBlockLock.sceneIds || []),
          ...(snapshot.productionBlockLock.nodeIds || []),
        ]));
      }
      if (snapshot.productionBreakdownReport) {
        artifacts.push(checkpointArtifact(run, checkpoint, "production_breakdown_report", { productionBreakdownReport: snapshot.productionBreakdownReport }, [
          ...(snapshot.productionBreakdownReport.scope?.episodeIds || []),
          ...(snapshot.productionBreakdownReport.scope?.sceneIds || []),
          ...(snapshot.productionBreakdownReport.scope?.nodeIds || []),
        ]));
      }
      if (snapshot.continuityMatrix) {
        artifacts.push(checkpointArtifact(run, checkpoint, "continuity_matrix", { continuityMatrix: snapshot.continuityMatrix }));
      }
      if (Array.isArray(snapshot.roleSlots) && snapshot.roleSlots.length) {
        artifacts.push(checkpointArtifact(run, checkpoint, "role_slot", { roleSlots: snapshot.roleSlots }, snapshot.roleSlots.map((slot: RoleSlot) => slot.id)));
      }
      if (Array.isArray(snapshot.castingRequirements) && snapshot.castingRequirements.length) {
        artifacts.push(checkpointArtifact(run, checkpoint, "casting_requirement", { castingRequirements: snapshot.castingRequirements }, snapshot.castingRequirements.map((requirement: CastingRequirement) => requirement.id)));
      }
      if (Array.isArray(snapshot.castingDecisions) && snapshot.castingDecisions.length) {
        for (const decision of snapshot.castingDecisions as CastingDecision[]) {
          artifacts.push(checkpointArtifact(run, checkpoint, "casting_decision", { castingDecision: decision }, [
            decision.id,
            decision.castingRequirementId,
            decision.roleSlotId,
            ...(decision.affectedEpisodeIds || []),
            ...(decision.affectedSceneIds || []),
            ...(decision.affectedNodeIds || []),
          ]));
        }
      }
      if (Array.isArray(snapshot.departmentPrepPackages) && snapshot.departmentPrepPackages.length) {
        artifacts.push(checkpointArtifact(run, checkpoint, "department_prep_package", { departmentPrepPackages: snapshot.departmentPrepPackages }, snapshot.departmentPrepPackages.map((item: DepartmentPrepPackage) => item.id)));
      }
      if (Array.isArray(snapshot.sceneAssetVariantPacks) && snapshot.sceneAssetVariantPacks.length) {
        artifacts.push(checkpointArtifact(run, checkpoint, "scene_asset_variant_pack", { sceneAssetVariantPacks: snapshot.sceneAssetVariantPacks }, snapshot.sceneAssetVariantPacks.map((pack: SceneAssetVariantPack) => pack.id)));
      }
    }
  }
  return artifacts;
};

const actionFromTicket = (ticket: CoordinationRepairTicket): ProductionCockpitAction => ({
  id: `repair:${ticket.id}`,
  actionType: ticket.status === "blocked" ? "human_review" : "repair",
  priority: ticket.status === "blocked" ? "high" : "medium",
  label: ticket.status === "blocked" ? "请求人工处理统筹阻断" : "执行统筹返工单",
  reason: ticket.status === "blocked" ? ticket.humanEscalationReason || ticket.reason : ticket.repairInstruction,
  ownerAgentId: ticket.ownerAgentId,
  suggestedStageType: ticket.suggestedStageType,
  targetPath: ticket.targetPath,
  ticketId: ticket.id,
});

const actionFromSoftHold = (finding: ProductionDepartmentFinding): ProductionCockpitAction => ({
  id: `soft_hold:${finding.id}`,
  actionType: "resolve_soft_hold",
  priority: "low",
  label: "确认或升级 soft hold",
  reason: finding.message,
  ownerAgentId: finding.ownerAgentId,
  suggestedStageType: finding.suggestedStageType,
  targetPath: finding.target,
  findingId: finding.id,
});

export const buildProductionCockpit = ({
  project,
  episodes,
  operatorArtifacts = [],
  productionRuns = [],
  productionRunId,
  operatorRunId,
  scope = "stage_exit",
  stageType,
  environment = "production",
  capturedAt = Date.now(),
}: ProductionCockpitInput): ProductionCockpitSnapshot => {
  const scopedEpisodes = episodes?.length ? episodes : asArray<Episode>((project as any).episodes);
  const scenes = scenesFromEpisodes(scopedEpisodes);
  const shots = shotsFromScenes(scenes);
  const currentStage = resolveCurrentStage(productionRuns, productionRunId, stageType);
  const effectiveStageType = stageType || currentStage.stageType;
  const scopedProductionRuns = productionRunId
    ? productionRuns.filter((run) => run.id === productionRunId)
    : operatorRunId
      ? []
      : productionRuns;
  const productionRunArtifacts = operatorArtifactsFromProductionRuns(scopedProductionRuns);
  const relevantArtifacts = operatorRunId
    ? [
        ...operatorArtifacts.filter((artifact) => artifact.runId === operatorRunId),
        ...productionRunArtifacts,
      ]
    : [...operatorArtifacts, ...productionRunArtifacts];
  const reports = relevantArtifacts
    .map((artifact) => ({ artifact, report: unwrapCoordinationReport(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; report: ProductionCoordinationReport } => !!item.report);
  const previousReports = reports.map((item) => item.report);
  const previousRepairTickets = relevantArtifacts.flatMap(unwrapCoordinationRepairTickets);
  const stageFacts = collectStageFacts(productionRuns, effectiveStageType);
  const gate = scope === "episode_wrap" || scope === "phase_wrap"
    ? buildProductionCoordinationWrapQA({
        project,
        episodes: scopedEpisodes,
        operatorArtifacts: relevantArtifacts,
        runId: operatorRunId || productionRunId,
        stageType: effectiveStageType,
        environment,
        capturedAt,
        previousReports,
        previousRepairTickets,
        qaReports: stageFacts.qaReports,
        gateVerdicts: stageFacts.gateVerdicts,
        scope,
      })
    : buildProductionCoordinationStageGate({
        project,
        episodes: scopedEpisodes,
        operatorArtifacts: relevantArtifacts,
        runId: operatorRunId || productionRunId,
        stageType: effectiveStageType,
        environment,
        capturedAt,
        previousReports,
        previousRepairTickets,
        qaReports: stageFacts.qaReports,
        gateVerdicts: stageFacts.gateVerdicts,
      });
  const findings = gate.report.departmentFindings;
  const hardBlocks = findings.filter((finding) => resolutionClass(finding) === "hard_blocking");
  const autoRepairableFindings = findings.filter((finding) => resolutionClass(finding) === "auto_repairable");
  const softHolds = findings.filter((finding) => resolutionClass(finding) === "soft_hold");
  const advisoryFindings = findings.filter((finding) => resolutionClass(finding) === "advisory");
  const coordinationArtifacts = collectProductionCoordinationArtifacts(relevantArtifacts);
  const videoUnits = coordinationArtifacts.videoGenerationUnits;
  const styleCandidates = relevantArtifacts
    .map((artifact) => ({ artifact, candidate: unwrapVisualStyleLockCandidate(artifact) }))
    .filter((item) => item.candidate);
  const styleChangeOrders = relevantArtifacts
    .map((artifact) => ({ artifact, order: unwrapStyleLockChangeOrder(artifact) }))
    .filter((item) => item.order);
  const strategyDrafts = relevantArtifacts
    .map((artifact) => ({ artifact, draft: unwrapStoryboardStrategyDraft(artifact) }))
    .filter((item) => item.draft);
  const strategyTrials = relevantArtifacts
    .map((artifact) => ({ artifact, trial: unwrapStoryboardStrategyTrial(artifact) }))
    .filter((item) => item.trial);
  const styleStrategyFindings = findings.filter((finding) => finding.department === "style_strategy");
  const storyboardStrategyImpactPlan = buildStoryboardStrategyImpactPlan({
    projectId: project.id,
    artifacts: relevantArtifacts,
    scope: {
      episodeIds: scopedEpisodes.map((episode) => episode.id),
      sceneIds: scenes.map((scene) => scene.id),
      shotIds: shots.map((shot) => shot.id),
    },
  });
  const creativeChanges = relevantArtifacts
    .map((artifact) => ({ artifact, change: unwrapCreativeChangeRequest(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; change: CreativeChangeRequest } => !!item.change);
  const seriesChangeOrders = relevantArtifacts
    .map(unwrapSeriesChangeOrder)
    .filter((order): order is SeriesChangeOrder => !!order);
  const productionBreakdownReportItems = relevantArtifacts
    .map((artifact) => ({ artifact, report: unwrapProductionBreakdownReport(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; report: ProductionBreakdownReport } => !!item.report);
  const productionBreakdownReports = productionBreakdownReportItems.map((item) => item.report);
  const roleSlotItems = relevantArtifacts.flatMap((artifact) =>
    unwrapRoleSlots(artifact).map((slot) => ({ artifact, slot })),
  );
  const castingRequirementItems = relevantArtifacts.flatMap((artifact) =>
    unwrapCastingRequirements(artifact).map((requirement) => ({ artifact, requirement })),
  );
  const castingCandidateItems = relevantArtifacts.flatMap((artifact) =>
    unwrapCastingCandidates(artifact).map((candidate) => ({ artifact, candidate })),
  );
  const castingDecisionItems = relevantArtifacts
    .map((artifact) => ({ artifact, decision: unwrapCastingDecision(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; decision: CastingDecision } => !!item.decision);
  const candidateCountByRequirement = new Map<string, number>();
  const candidateCountByRoleSlot = new Map<string, number>();
  const latestCandidateByRequirement = new Map<string, { artifact: OperatorArtifactEnvelope; candidate: CastingCandidate }>();
  const latestCandidateByRoleSlot = new Map<string, { artifact: OperatorArtifactEnvelope; candidate: CastingCandidate }>();
  for (const item of [...castingCandidateItems].sort((a, b) => Number(a.candidate.updatedAt || a.candidate.createdAt || a.artifact.updatedAt || 0) - Number(b.candidate.updatedAt || b.candidate.createdAt || b.artifact.updatedAt || 0))) {
    if (item.candidate.castingRequirementId) {
      candidateCountByRequirement.set(item.candidate.castingRequirementId, (candidateCountByRequirement.get(item.candidate.castingRequirementId) || 0) + 1);
      latestCandidateByRequirement.set(item.candidate.castingRequirementId, item);
    }
    if (item.candidate.roleSlotId) {
      candidateCountByRoleSlot.set(item.candidate.roleSlotId, (candidateCountByRoleSlot.get(item.candidate.roleSlotId) || 0) + 1);
      latestCandidateByRoleSlot.set(item.candidate.roleSlotId, item);
    }
  }
  const latestDecisionByRequirement = new Map<string, { artifact: OperatorArtifactEnvelope; decision: CastingDecision }>();
  for (const item of [...castingDecisionItems].sort((a, b) => Number(a.decision.updatedAt || a.artifact.updatedAt || 0) - Number(b.decision.updatedAt || b.artifact.updatedAt || 0))) {
    latestDecisionByRequirement.set(item.decision.castingRequirementId, item);
  }
  const departmentPrepItems = relevantArtifacts.flatMap((artifact) =>
    unwrapDepartmentPrepPackages(artifact).map((prepPackage) => ({ artifact, prepPackage })),
  );
  const continuityMatrixItems = relevantArtifacts
    .map((artifact) => ({ artifact, matrix: unwrapContinuityMatrix(artifact) }))
    .filter((item): item is { artifact: OperatorArtifactEnvelope; matrix: ContinuityMatrix } => !!item.matrix);
  const sceneAssetVariantPacks = relevantArtifacts.flatMap(unwrapSceneAssetVariantPacks);
  const latestBreakdownItem = [...productionBreakdownReportItems]
    .sort((a, b) => Number(b.report.createdAt || b.artifact.updatedAt || 0) - Number(a.report.createdAt || a.artifact.updatedAt || 0))[0];
  const latestBreakdown = latestBreakdownItem?.report;
  const sceneMatrixRows = asArray<ProductionBreakdownReport["sceneMatrix"][number]>(latestBreakdown?.sceneMatrix);
  const latestContinuityMatrixItem = [...continuityMatrixItems]
    .sort((a, b) => Number(b.matrix.createdAt || b.artifact.updatedAt || 0) - Number(a.matrix.createdAt || a.artifact.updatedAt || 0))[0];
  const continuityMatrix = latestContinuityMatrixItem?.matrix || (latestBreakdown
    ? buildContinuityMatrix({
        project,
        episodes: scopedEpisodes,
        productionBreakdownReport: latestBreakdown,
        departmentPrepPackages: departmentPrepItems.map((item) => item.prepPackage),
        sceneAssetVariantPacks,
        createdAt: capturedAt,
      })
    : undefined);
  const productionGovernance = buildProductionSeriesGovernanceSnapshot({
    project,
    episodes: scopedEpisodes,
    scriptLockPackages: relevantArtifacts.map(unwrapScriptLockPackage).filter((lock): lock is ScriptLockPackage => !!lock),
    contentLockPackages: relevantArtifacts.map(unwrapContentLockPackage).filter((lock): lock is ContentLockPackage => !!lock),
    productionBlockLocks: relevantArtifacts.map(unwrapProductionBlockLock).filter((lock): lock is ProductionBlockLock => !!lock),
    productionBreakdownReports,
    seriesChangeOrders,
  });
  const pendingCreativeChanges = creativeChanges.filter(({ change }) => !["resolved", "rejected"].includes(change.status));
  const pendingAssets = creativeChanges.flatMap(({ change }) => change.pendingAssets || []).filter((asset) => asset.status === "pending");
  const pendingVariantRequests = creativeChanges.flatMap(({ change }) => change.variantRequests || []).filter((variant) => variant.status === "pending");
  const formalDeliveryBlockers = uniq(creativeChanges.flatMap(({ change }) => change.formalDeliveryBlockers || []));
  const formalStageExitBlockers = uniq([
    ...formalDeliveryBlockers,
    ...(gate.canProceed ? [] : [`coordination_gate:${gate.nextAction}`]),
    ...(gate.circuitBreaker.humanInterventionRequired ? ["circuit_breaker:human_intervention_required"] : []),
    ...hardBlocks.map((finding) => `hard_block:${finding.id}`),
  ]);
  const generationStatus = videoUnits.length === 0
    ? {
        status: "not_planned" as const,
        reason: "当前还没有 video_generation_unit，媒体生成计划尚未就绪。",
      }
    : {
        status: "ready" as const,
        reason: `${videoUnits.length} 个 video_generation_unit 已就绪，可直接开始生成。`,
      };
  const latestReport = reports
    .sort((a, b) => Number(b.report.capturedAt || b.artifact.updatedAt || 0) - Number(a.report.capturedAt || a.artifact.updatedAt || 0))[0];
  const nextActions: ProductionCockpitAction[] = [
    ...gate.repairTickets.map(actionFromTicket),
    ...softHolds.map(actionFromSoftHold),
    ...pendingAssets.slice(0, 5).map((asset) => ({
      id: `pending_asset:${asset.id}`,
      actionType: "promote_pending_asset" as const,
      priority: "medium" as const,
      label: "转正、合并、废弃或豁免 pending asset",
      reason: asset.description || asset.name,
      suggestedStageType: asset.requiredBeforeStages[0],
      targetPath: `pendingAssets.${asset.id}`,
    })),
    ...productionGovernance.changeOrders.openChangeOrderIds.slice(0, 5).map((id) => ({
      id: `series_change_order:${id}`,
      actionType: "human_review" as const,
      priority: "high" as const,
      label: "审批并应用锁后变更单",
      reason: "open series_change_order 会让锁定包、生产拆解、正式资产板和场次视觉包过期。",
      targetPath: `seriesChangeOrders.${id}`,
    })),
  ];
  if (gate.nextAction === "proceed") {
    nextActions.unshift({
      id: "coordination:proceed",
      actionType: "proceed",
      priority: "low",
      label: scope === "episode_wrap" || scope === "phase_wrap" ? "标记当前生产批次可完成" : "进入下一阶段",
      reason: gate.reason,
      suggestedStageType: effectiveStageType,
    });
  }
  if (gate.humanInterventionTasks.length > 0) {
    nextActions.unshift(...gate.humanInterventionTasks.map((task) => ({
      id: `human_review:${task.id}`,
      actionType: "human_review" as const,
      priority: "high" as const,
      label: "等待人工统筹决策",
      reason: task.reason,
      targetPath: task.workflowStepId,
    })));
  }
  if (!latestReport) {
    nextActions.push({
      id: "coordination:save_report",
      actionType: "save_coordination_report",
      priority: "low",
      label: "保存 production_coordination_report artifact",
      reason: "当前 cockpit 快照来自只读聚合；正式阶段出口仍应保存统筹报告并自动 QA。",
      suggestedStageType: effectiveStageType,
      targetPath: "operator.productionCoordinationReports",
    });
  }
  return {
    schemaVersion: "production-cockpit.v1",
    projectId: project.id,
    generatedAt: capturedAt,
    scope: {
      coordinationScope: gate.report.scope,
      environment,
      productionRunId,
      operatorRunId,
      stageType: effectiveStageType,
      episodeIds: scopedEpisodes.map((episode) => episode.id).filter(Boolean),
      sceneIds: scenes.map((scene) => scene.id).filter(Boolean),
      shotIds: shots.map((shot) => shot.id).filter(Boolean),
    },
    currentStage,
    counts: {
      productionRuns: productionRuns.length,
      operatorArtifacts: relevantArtifacts.length,
      episodes: scopedEpisodes.length,
      scenes: scenes.length,
      shots: shots.length,
      departmentFindings: findings.length,
      hardBlocks: hardBlocks.length,
      autoRepairable: autoRepairableFindings.length,
      softHolds: softHolds.length,
      advisory: advisoryFindings.length,
      repairTickets: gate.repairTickets.length,
      openRepairTickets: gate.repairTickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length,
      blockedRepairTickets: gate.repairTickets.filter((ticket) => ticket.status === "blocked").length,
      coordinationTraceLinks: gate.coordinationTrace.links.length,
      coordinationTraceUnresolved: gate.coordinationTrace.recoverySummary.unresolvedFindings,
      humanInterventionTasks: gate.humanInterventionTasks.length,
      pendingCreativeChanges: pendingCreativeChanges.length,
      seriesChangeOrders: seriesChangeOrders.length,
    openSeriesChangeOrders: productionGovernance.changeOrders.openCount,
    pendingAssets: pendingAssets.length,
    pendingVariantRequests: pendingVariantRequests.length,
      continuityRows: continuityMatrix?.totals.rows || 0,
      continuityNeedsReview: continuityMatrix?.totals.needsReview || 0,
      continuityBlocked: continuityMatrix?.totals.blocked || 0,
      missingDepartmentPackages: gate.report.missingDepartmentPackages.length,
      departmentCoverageReady: gate.report.departmentCoverage.totals.readyDepartments,
      departmentCoverageNeedsReview: gate.report.departmentCoverage.totals.needsReviewDepartments,
      departmentCoverageBlocked: gate.report.departmentCoverage.totals.blockedDepartments,
    },
    coordination: {
      report: gate.report,
      gate: {
        blocking: gate.blocking,
        canProceed: gate.canProceed,
        nextAction: gate.nextAction,
        reason: gate.reason,
        circuitBreakerStatus: gate.circuitBreaker.status,
        humanInterventionRequired: gate.circuitBreaker.humanInterventionRequired,
      },
      trace: gate.coordinationTrace,
    },
    departmentFindings: findings,
    hardBlocks,
    autoRepairableFindings,
    softHolds,
    advisoryFindings,
    repairTickets: gate.repairTickets,
    coordinationTrace: gate.coordinationTrace,
    humanInterventionTasks: gate.humanInterventionTasks,
    handoffManifest: gate.report.handoffManifest,
    departmentCoverage: gate.report.departmentCoverage,
    missingDepartmentPackages: gate.report.missingDepartmentPackages,
    departmentQaSummary: gate.report.departmentQaSummary,
    styleStrategy: {
      styleLockVersion: styleLockVersionForProject(project),
      styleLockApprovalState: project.visualStyleLock?.humanApprovalState,
      styleSourceRefCount: Array.isArray(project.visualStyleLock?.styleSourceRefs) ? project.visualStyleLock!.styleSourceRefs!.length : 0,
      candidateCount: styleCandidates.length,
      openCandidateCount: styleCandidates.filter(({ candidate }) => !["rejected"].includes(String(candidate?.approvalState || ""))).length,
      changeOrderCount: styleChangeOrders.length,
      pendingChangeOrderCount: styleChangeOrders.filter(({ order }) => order?.approvalState === "pending_review").length,
      approvedUncommittedChangeOrderCount: styleChangeOrders.filter(({ artifact, order }) => order?.approvalState === "approved" && artifact.status !== "committed").length,
      storyboardBoardCount: coordinationArtifacts.storyboardBoards.length,
      assetReferencePackCount: coordinationArtifacts.assetReferencePacks.length,
      videoGenerationUnitCount: coordinationArtifacts.videoGenerationUnits.length,
      boardsWithStyleVersion: coordinationArtifacts.storyboardBoards.filter((board) => !!board.styleLockVersion).length,
      packsWithStyleVersion: coordinationArtifacts.assetReferencePacks.filter((pack) => !!pack.styleLockVersion).length,
      unitsWithStyleVersion: coordinationArtifacts.videoGenerationUnits.filter((unit) => !!unit.styleLockVersion).length,
      customStrategyBoardCount: coordinationArtifacts.storyboardBoards.filter((board) => board.strategyOrigin && board.strategyOrigin !== "built_in").length,
      strategyDraftCount: strategyDrafts.length,
      approvedStrategyDraftCount: strategyDrafts.filter(({ draft }) => ["approved", "promoted"].includes(String(draft?.status || ""))).length,
      strategyTrialCount: strategyTrials.length,
      passedStrategyTrialCount: strategyTrials.filter(({ trial }) => trial?.status === "passed").length,
      promotionCandidateCount: strategyDrafts.filter(({ draft }) => draft?.scope === "global_candidate").length,
      styleStrategyFindings,
      impactPlan: storyboardStrategyImpactPlan,
    },
    creativeBackflow: {
      openChangeCount: pendingCreativeChanges.length,
      pendingAssetCount: pendingAssets.length,
      pendingVariantRequestCount: pendingVariantRequests.length,
      formalDeliveryBlockers,
      changes: creativeChanges.map(({ artifact, change }) => ({
        artifactId: artifact.id,
        changeRequestId: change.id,
        title: change.title,
        status: change.status,
        kind: change.kind,
        department: change.department,
        pendingAssets: change.pendingAssets || [],
        variantRequests: change.variantRequests || [],
        localResyncPlanId: change.localResyncPlan?.id,
        formalDeliveryBlockers: change.formalDeliveryBlockers || [],
      })),
    },
    productionGovernance,
    productionSchedule: {
      schemaVersion: "production-schedule-read-model.v1",
      mode: productionGovernance.mode,
      lockStatus: productionGovernance.lockStatus,
      currentBlockId: productionGovernance.currentBlock?.blockId,
      scope: productionGovernance.assetPrepReadiness.scope,
      targetEpisodeCount: productionGovernance.scriptCoverage.targetEpisodeCount,
      existingEpisodeCount: productionGovernance.scriptCoverage.existingEpisodeCount,
      lockedEpisodeCount: productionGovernance.scriptCoverage.lockedEpisodeCount,
      missingEpisodeCount: productionGovernance.scriptCoverage.missingEpisodeCount,
      lockedNodeCount: productionGovernance.contentCoverage.lockedNodeCount,
      breakdownCoverageRatio: productionGovernance.breakdownCoverage.coverageRatio,
      currentBlockReady: productionGovernance.assetPrepReadiness.currentBlockReady,
      fullSeriesReady: productionGovernance.assetPrepReadiness.fullSeriesReady,
      openChangeOrderCount: productionGovernance.changeOrders.openCount,
      departmentReadiness: Object.values(departmentPrepItems.reduce((acc, { prepPackage }) => {
        const key = prepPackage.department;
        acc[key] = acc[key] || { department: key, ready: 0, needsReview: 0, blocked: 0 };
        if (prepPackage.readiness === "ready_for_department_review") acc[key].ready += 1;
        if (prepPackage.readiness === "needs_review") acc[key].needsReview += 1;
        if (prepPackage.readiness === "blocked") acc[key].blocked += 1;
        return acc;
      }, {} as Record<ProductionPrepDepartment, { department: ProductionPrepDepartment; ready: number; needsReview: number; blocked: number }>)),
      blockers: productionGovernance.assetPrepReadiness.blockers,
      nextActions: productionGovernance.nextActions,
    },
    productionPrep: {
      latestBreakdown: latestBreakdown ? {
        artifactId: latestBreakdownItem?.artifact.id,
        id: latestBreakdown.id,
        blockId: latestBreakdown.scope?.blockId,
        mode: latestBreakdown.scope?.mode,
        sceneCount: sceneMatrixRows.filter((row) => row.sourceType === "scene").length,
        nodeCount: sceneMatrixRows.filter((row) => row.sourceType === "node").length,
        characterCount: asArray(latestBreakdown.characterAppearances).length,
        locationCount: asArray(latestBreakdown.locationAppearances).length,
        propCount: asArray(latestBreakdown.propAppearances).length,
        variantCount: asArray(latestBreakdown.variantNeeds).length,
        departmentCounts: latestBreakdown.departmentCounts || {},
      } : undefined,
      sceneMatrix: sceneMatrixRows.map((row) => ({
        sourceType: row.sourceType,
        episodeId: row.episodeId,
        sceneId: row.sceneId,
        nodeId: row.nodeId,
        title: row.title,
        locationName: row.locationName,
        timeOfDay: row.timeOfDay,
        characterCount: asArray(row.characterIds).length || asArray(row.characterNames).length,
        propCount: asArray(row.propIds).length || asArray(row.propNames).length,
        variantCount: asArray(row.variantRefs).length,
        shotCount: asArray(row.shotIds).length,
      })),
      roleSlots: roleSlotItems.map(({ artifact, slot }) => {
        const latestCandidate = latestCandidateByRoleSlot.get(slot.id);
        return {
          artifactId: artifact.id,
          id: slot.id,
          displayName: slot.displayName,
          narrativeFunction: slot.narrativeFunction,
          source: slot.source,
          priority: slot.priority,
          status: slot.status,
          characterId: slot.characterId,
          castingRequirementId: slot.castingRequirementId,
          lockedRefCount: asArray<RoleSlot["lockedRefs"][number]>(slot.lockedRefs).length,
          candidateCount: candidateCountByRoleSlot.get(slot.id) || 0,
          latestCandidateId: latestCandidate?.candidate.id,
          latestCandidateStatus: latestCandidate?.candidate.candidateStatus,
        };
      }),
      castingRequirements: castingRequirementItems.map(({ artifact, requirement }) => {
        const appearances = asArray<CastingRequirement["sceneAppearances"][number]>(requirement.sceneAppearances);
        const latestDecision = latestDecisionByRequirement.get(requirement.id);
        const latestCandidate = latestCandidateByRequirement.get(requirement.id) ||
          (requirement.roleSlotId ? latestCandidateByRoleSlot.get(requirement.roleSlotId) : undefined);
        return {
          artifactId: artifact.id,
          id: requirement.id,
          productionBreakdownReportId: requirement.productionBreakdownReportId,
          roleSlotId: requirement.roleSlotId,
          characterId: requirement.characterId,
          displayName: requirement.displayName,
          priority: requirement.priority,
          status: requirement.status,
          sceneCount: appearances.length,
          episodeIds: uniq(appearances.map((item) => item.episodeId)),
          sceneIds: uniq(appearances.map((item) => item.sceneId)),
          nodeIds: uniq(appearances.map((item) => item.nodeId)),
          sceneAppearances: appearances,
          performanceRange: requirement.performanceRange || [],
          costumeConstraints: requirement.costumeConstraints || [],
          stuntNeeds: requirement.stuntNeeds || [],
          latestDecisionStatus: latestDecision?.decision.status,
          latestDecisionType: latestDecision?.decision.decisionType,
          latestDecisionId: latestDecision?.decision.id,
          candidateCount: candidateCountByRequirement.get(requirement.id) ||
            (requirement.roleSlotId ? candidateCountByRoleSlot.get(requirement.roleSlotId) : 0) ||
            0,
          latestCandidateId: latestCandidate?.candidate.id,
          latestCandidateStatus: latestCandidate?.candidate.candidateStatus,
        };
      }),
      castingCandidates: castingCandidateItems.map(({ artifact, candidate }) => ({
        artifactId: artifact.id,
        id: candidate.id,
        roleSlotId: candidate.roleSlotId,
        castingRequirementId: candidate.castingRequirementId,
        displayName: candidate.displayName,
        source: candidate.source,
        candidateStatus: candidate.candidateStatus,
        characterId: candidate.characterId,
        identityBoardArtifactId: candidate.identityBoardArtifactId,
        referenceAssetCount: asArray<string>(candidate.referenceAssetIds).length,
        suitabilityNoteCount: asArray<string>(candidate.suitabilityNotes).length,
        riskNoteCount: asArray<string>(candidate.riskNotes).length,
      })),
      castingDecisions: castingDecisionItems.map(({ artifact, decision }) => ({
        artifactId: artifact.id,
        id: decision.id,
        castingRequirementId: decision.castingRequirementId,
        roleSlotId: decision.roleSlotId,
        displayName: decision.displayName,
        decisionType: decision.decisionType,
        status: decision.status,
        candidateName: decision.candidate?.name || decision.displayName,
        identityBoardArtifactId: decision.candidate?.identityBoardArtifactId,
        requiredFollowupCount: asArray<CastingDecision["requiredFollowups"][number]>(decision.requiredFollowups).length,
        affectedEpisodeIds: decision.affectedEpisodeIds || [],
        affectedSceneIds: decision.affectedSceneIds || [],
        affectedNodeIds: decision.affectedNodeIds || [],
      })),
      departmentPrepPackages: departmentPrepItems.map(({ artifact, prepPackage }) => {
        const requiredAssets = asArray<DepartmentPrepPackage["requiredAssets"][number]>(prepPackage.requiredAssets);
        return {
          artifactId: artifact.id,
          id: prepPackage.id,
          department: prepPackage.department,
          ownerAgentId: prepPackage.ownerAgentId,
          readiness: prepPackage.readiness,
          requiredAssetCount: requiredAssets.length,
          variantCount: asArray<DepartmentPrepPackage["variants"][number]>(prepPackage.variants).length,
          continuityCount: asArray<DepartmentPrepPackage["continuityInOut"][number]>(prepPackage.continuityInOut).length,
          openQuestionCount: asArray<string>(prepPackage.openQuestions).length,
          episodeIds: prepPackage.episodeIds || [],
          sceneIds: prepPackage.sceneIds || [],
          nodeIds: prepPackage.nodeIds || [],
          sampleAssets: requiredAssets.slice(0, 8).map((asset) => ({
            assetId: asset.assetId,
            name: asset.name,
            type: asset.type,
            sceneCount: asArray<string>(asset.sceneIds).length,
            nodeCount: asArray<string>(asset.nodeIds).length,
            shotCount: asArray<string>(asset.shotIds).length,
          })),
        };
      }),
      totals: {
        breakdownReports: productionBreakdownReports.length,
        sceneMatrixRows: sceneMatrixRows.length,
        roleSlots: roleSlotItems.length,
        castingRequirements: castingRequirementItems.length,
        castingCandidates: castingCandidateItems.length,
        castingDecisions: castingDecisionItems.length,
        approvedCastingDecisions: castingDecisionItems.filter((item) => item.decision.status === "approved").length,
        departmentPrepPackages: departmentPrepItems.length,
        readyDepartments: departmentPrepItems.filter((item) => item.prepPackage.readiness === "ready_for_department_review").length,
        blockedDepartments: departmentPrepItems.filter((item) => item.prepPackage.readiness === "blocked").length,
        needsReviewDepartments: departmentPrepItems.filter((item) => item.prepPackage.readiness === "needs_review").length,
      },
    },
    productionContinuity: {
      latestMatrix: continuityMatrix ? {
        artifactId: latestContinuityMatrixItem?.artifact.id,
        id: continuityMatrix.id,
        rowCount: continuityMatrix.totals.rows,
        blocked: continuityMatrix.totals.blocked,
        needsReview: continuityMatrix.totals.needsReview,
        clear: continuityMatrix.totals.clear,
      } : undefined,
      rows: asArray<ContinuityMatrix["rows"][number]>(continuityMatrix?.rows).map((row) => ({
        id: row.id,
        sourceType: row.sourceType,
        episodeId: row.episodeId,
        sceneId: row.sceneId,
        nodeId: row.nodeId,
        title: row.title,
        sequenceIndex: row.sequenceIndex,
        targetType: row.targetType,
        targetId: row.targetId,
        targetName: row.targetName,
        department: row.department,
        visibleState: row.visibleState,
        continuityIn: row.continuityIn,
        continuityOut: row.continuityOut,
        previousRowId: row.previousRowId,
        nextRowId: row.nextRowId,
        variantIds: row.variantIds,
        sceneAssetVariantPackIds: row.sceneAssetVariantPackIds,
        riskLevel: row.riskLevel,
        riskNotes: row.riskNotes,
      })),
      issues: asArray<ContinuityMatrix["issues"][number]>(continuityMatrix?.issues).map((item) => ({
        id: item.id,
        severity: item.severity,
        target: item.target,
        message: item.message,
        rowIds: item.rowIds,
      })),
      totals: continuityMatrix?.totals || {
        rows: 0,
        blocked: 0,
        needsReview: 0,
        clear: 0,
        byTargetType: {},
        byDepartment: {},
      },
    },
    deliveryMode: {
      draftExploration: {
        allowed: true,
        canCreateCreativeChanges: true,
        reason: "draft_exploration 允许导演继续试镜头、补灵感并创建 creative_change_request；它不等同于阶段正式交付。",
      },
      formalDelivery: {
        canRequestStageExit: formalStageExitBlockers.length === 0,
        requiredGate: scope,
        nextAction: gate.nextAction,
        blockers: formalStageExitBlockers,
        reason: formalStageExitBlockers.length === 0
          ? "formal_delivery 可请求 stage exit；正式推进仍必须经过 QA、gate 和 commit。"
          : "formal_delivery 仍有 gate、creative backflow 或硬阻断问题，不能绕过 QA/gate/commit。",
      },
    },
    storyboardChain: {
      scriptBlocks: scenes.reduce((sum, scene) => sum + asArray(scene.scriptBlocks).length, 0),
      shots: shots.length,
      artifactCounts: {
        performanceBeats: artifactCount(relevantArtifacts, "performance_beats"),
        storyboardBoards: artifactCount(relevantArtifacts, "storyboard_board"),
        sceneVisualPacks: artifactCount(relevantArtifacts, "scene_visual_pack"),
        assetReferencePacks: artifactCount(relevantArtifacts, "asset_reference_pack"),
        videoGenerationUnits: videoUnits.length,
        generationPlans: artifactCount(relevantArtifacts, "generation_plan"),
      },
      generationStatus: {
        ...generationStatus,
        videoUnitCount: videoUnits.length,
      },
    },
    artifactRefs: relevantArtifacts.map((artifact) => {
      const verdict = latestQa(artifact);
      return {
        id: artifact.id,
        kind: artifact.kind,
        status: artifact.status,
        targetPath: artifact.targetPath,
        runId: artifact.runId,
        updatedAt: artifact.updatedAt,
        latestQaStatus: verdict?.status,
        latestQaNextAction: verdict?.nextAction,
      };
    }),
    latestCoordinationReport: latestReport ? {
      artifactId: latestReport.artifact.id,
      reportId: latestReport.report.id,
      approvalState: latestReport.report.approvalState,
      capturedAt: latestReport.report.capturedAt,
    } : undefined,
    nextActions,
  };
};

export const buildProductionCockpitSystem = () => ({
  status: "production_cockpit_read_model_available",
  schemaVersion: "production-cockpit.v1",
  readModelFunction: "buildProductionCockpit",
  operatorApi: "GET /api/operator/projects/:projectId/production-cockpit?stageType=storyboard&scope=stage_exit&episodeIds=ep-1",
  sourceOfTruth: [
    "persisted project episodes/scenes/shots",
    "production_runs stages, QA reports, gate verdicts, and policy",
    "operator_artifacts including production_coordination_report, coordination_repair_ticket, creative_change_request, scene_visual_pack, storyboard_board, asset_reference_pack, and video_generation_unit",
    "operator_artifacts including style_reference_analysis, visual_style_lock_candidate, style_lock_change_order, storyboard_strategy_draft, and storyboard_strategy_draft_trial for style/strategy provenance",
    "operator_artifacts including script_lock_package, content_lock_package, production_block_lock, production_breakdown_report, continuity_matrix, role_slot, casting_candidate, casting_requirement, casting_decision, department_prep_package, formal_asset_package, asset_identity_board, scene_asset_variant_pack, asset_variant_fingerprint, and series_change_order for production governance",
  ],
  includes: [
    "currentStage",
    "productionGovernance",
    "productionSchedule",
    "productionPrep",
    "productionContinuity",
    "departmentCoverage",
    "missingDepartmentPackages",
    "departmentQaSummary",
    "roleSlots",
    "castingCandidates",
    "lockStatus",
    "scriptCoverage",
    "breakdownCoverage",
    "assetPrepReadiness",
    "changeOrders",
    "departmentFindings",
    "hardBlocks",
    "autoRepairableFindings",
    "softHolds",
    "repairTickets",
    "handoffManifest",
    "creativeBackflow",
    "deliveryMode",
    "storyboardChain",
    "styleStrategy",
    "styleStrategy.impactPlan",
    "nextActions",
  ],
  requiredBehavior: [
    "Use the cockpit API before building director, storyboard, wardrobe, props, location, or continuity workbench UI.",
    "Do not recompute department findings in the frontend; render the cockpit read model.",
    "Treat soft_hold as visible risk, not a circuit breaker.",
    "Treat hard_blocking and blocked repair tickets as human-review requirements.",
    "Show current-block readiness separately from full-series readiness; a 100 episode project locked for 1-10 is current_block_only, not full_series ready.",
    "Surface open series_change_order artifacts as high-priority nextActions before trusting lock, breakdown, or formal asset prep.",
    "Distinguish draft_exploration from formal_delivery; formal_delivery must still pass QA, stage gate, and commit.",
    "Render the storyboard chain from scriptBlocks through performance beats, storyboard board, scene visual pack, asset reference pack, video unit, and media generation readiness.",
    "Render styleStrategy counts and its bounded impactPlan for source refs, candidates, change orders, storyboard_strategy_draft, storyboard_strategy_draft_trial, and global candidates instead of recomputing stale propagation in the frontend.",
    "Render casting as role_slot -> casting_requirement -> casting_candidate -> casting_decision, not as direct global character selection.",
    "Render script supervisor continuity from productionContinuity; do not recompute in the frontend.",
    "Render production scheduling from productionSchedule so full-series readiness and current-block readiness stay separate.",
  ],
});
