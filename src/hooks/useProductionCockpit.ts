import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProductionDepartmentCoverageReport,
  ProductionDepartmentQaSummary,
  ProductionMissingDepartmentPackage,
  ProductionCoordinationScope,
  ProductionStageType,
} from "../clients/domainTypes";
import { getProductionCockpit } from "../clients/operatorClient";

export type CockpitEnvironment = "test" | "production" | "development";

export interface ProductionCockpitFinding {
  id?: string;
  department?: string;
  status?: string;
  severity?: string;
  target?: string;
  message?: string;
  ownerAgentId?: string;
  suggestedStageType?: string;
  repairInstruction?: string;
  retryable?: boolean;
  resolutionClass?: string;
}

export interface ProductionCockpitRepairTicket {
  id?: string;
  issueId?: string;
  ownerAgentId?: string;
  suggestedStageType?: string;
  targetArtifactId?: string;
  targetPath?: string;
  repairMode?: string;
  reason?: string;
  repairInstruction?: string;
  maxRetries?: number;
  retryCount?: number;
  resolutionClass?: string;
  humanEscalationReason?: string;
  status?: string;
}

export interface ProductionCockpitAction {
  id?: string;
  actionType?: string;
  priority?: "high" | "medium" | "low" | string;
  label?: string;
  reason?: string;
  ownerAgentId?: string;
  suggestedStageType?: string;
  targetPath?: string;
}

export type ProductionPrepDepartment =
  | "directing"
  | "cinematography"
  | "lighting"
  | "production_design"
  | "wardrobe"
  | "makeup_hair"
  | "performance_directing"
  | "action_choreography"
  | "casting"
  | "wardrobe_makeup"
  | "props"
  | "location_art"
  | "continuity"
  | "vfx_sfx"
  | "ui_interaction"
  | "sound_music"
  | "extras_stunts"
  | "production";

export interface ProductionSeriesGovernanceSnapshot {
  schemaVersion?: "production-series-governance.v1";
  projectId?: string;
  mode?: string;
  lockStatus?: "legacy_unlocked" | "unlocked" | "partially_locked" | "fully_locked" | "interactive_content_locked";
  currentBlock?: {
    id?: string;
    blockId?: string;
    lockType?: string;
    episodeIds?: string[];
    sceneIds?: string[];
    nodeIds?: string[];
    status?: string;
  };
  scriptCoverage?: {
    targetEpisodeCount?: number;
    existingEpisodeCount?: number;
    lockedEpisodeCount?: number;
    knownUnlockedEpisodeIds?: string[];
    missingEpisodeCount?: number;
    coverageRatio?: number;
    fullSeriesLocked?: boolean;
  };
  contentCoverage?: {
    lockedNodeCount?: number;
    knownNodeCount?: number;
    knownUnlockedNodeIds?: string[];
    coverageRatio?: number;
  };
  breakdownCoverage?: {
    productionBreakdownReportIds?: string[];
    lockedSceneCount?: number;
    breakdownSceneCount?: number;
    lockedNodeCount?: number;
    breakdownNodeCount?: number;
    coverageRatio?: number;
  };
  assetPrepReadiness?: {
    scope?: "not_ready" | "current_block_only" | "full_series" | "interactive_node_block";
    currentBlockReady?: boolean;
    fullSeriesReady?: boolean;
    blockers?: string[];
  };
  changeOrders?: {
    openCount?: number;
    approvedCount?: number;
    appliedCount?: number;
    pendingReviewCount?: number;
    changeOrderIds?: string[];
    openChangeOrderIds?: string[];
  };
  nextActions?: string[];
}

export interface ProductionScheduleSummary {
  schemaVersion?: "production-schedule-read-model.v1";
  mode?: string;
  lockStatus?: string;
  currentBlockId?: string;
  scope?: string;
  targetEpisodeCount?: number;
  existingEpisodeCount?: number;
  lockedEpisodeCount?: number;
  missingEpisodeCount?: number;
  lockedNodeCount?: number;
  breakdownCoverageRatio?: number;
  currentBlockReady?: boolean;
  fullSeriesReady?: boolean;
  openChangeOrderCount?: number;
  departmentReadiness?: Array<{
    department?: ProductionPrepDepartment;
    ready?: number;
    needsReview?: number;
    blocked?: number;
  }>;
  blockers?: string[];
  nextActions?: string[];
}

export interface ProductionContinuitySummary {
  latestMatrix?: {
    artifactId?: string;
    id?: string;
    rowCount?: number;
    blocked?: number;
    needsReview?: number;
    clear?: number;
  };
  rows?: Array<{
    id?: string;
    sourceType?: "scene" | "node";
    episodeId?: string;
    sceneId?: string;
    nodeId?: string;
    title?: string;
    sequenceIndex?: number;
    targetType?: string;
    targetId?: string;
    targetName?: string;
    department?: ProductionPrepDepartment;
    visibleState?: string;
    continuityIn?: string;
    continuityOut?: string;
    previousRowId?: string;
    nextRowId?: string;
    variantIds?: string[];
    sceneAssetVariantPackIds?: string[];
    riskLevel?: "clear" | "needs_review" | "blocked" | string;
    riskNotes?: string[];
  }>;
  issues?: Array<{
    id?: string;
    severity?: string;
    target?: string;
    message?: string;
    rowIds?: string[];
  }>;
  totals?: {
    rows?: number;
    blocked?: number;
    needsReview?: number;
    clear?: number;
    byTargetType?: Record<string, number>;
    byDepartment?: Record<string, number>;
  };
}

export interface ProductionPrepSummary {
  latestBreakdown?: {
    artifactId?: string;
    id?: string;
    blockId?: string;
    mode?: string;
    sceneCount?: number;
    nodeCount?: number;
    characterCount?: number;
    locationCount?: number;
    propCount?: number;
    variantCount?: number;
    departmentCounts?: Partial<Record<ProductionPrepDepartment, number>>;
  };
  sceneMatrix?: Array<{
    sourceType?: "scene" | "node";
    episodeId?: string;
    sceneId?: string;
    nodeId?: string;
    title?: string;
    locationName?: string;
    timeOfDay?: string;
    characterCount?: number;
    propCount?: number;
    variantCount?: number;
    shotCount?: number;
  }>;
  roleSlots?: Array<{
    artifactId?: string;
    id?: string;
    displayName?: string;
    narrativeFunction?: string;
    source?: "bible" | "structure" | "production_breakdown" | "interactive_graph";
    priority?: "lead" | "supporting" | "day_player" | "extra";
    status?: "development_only" | "ready_for_casting" | "consumed_by_casting_requirement";
    characterId?: string;
    castingRequirementId?: string;
    lockedRefCount?: number;
    candidateCount?: number;
    latestCandidateId?: string;
    latestCandidateStatus?: "draft" | "ready_for_director_review" | "approved_for_decision" | "rejected";
  }>;
  castingRequirements?: Array<{
    artifactId?: string;
    id?: string;
    productionBreakdownReportId?: string;
    roleSlotId?: string;
    characterId?: string;
    displayName?: string;
    priority?: "lead" | "supporting" | "day_player" | "extra";
    status?: "draft" | "ready_for_director_review" | "approved";
    sceneCount?: number;
    episodeIds?: string[];
    sceneIds?: string[];
    nodeIds?: string[];
    sceneAppearances?: Array<{
      episodeId?: string;
      sceneId?: string;
      nodeId?: string;
      title?: string;
    }>;
    performanceRange?: string[];
    costumeConstraints?: string[];
    stuntNeeds?: string[];
    latestDecisionStatus?: "draft" | "pending_director_review" | "approved" | "rejected" | "needs_revision";
    latestDecisionType?: "approve_identity_board" | "reject_identity_board" | "request_identity_generation" | "assign_existing_character" | "needs_human_casting";
    latestDecisionId?: string;
    candidateCount?: number;
    latestCandidateId?: string;
    latestCandidateStatus?: "draft" | "ready_for_director_review" | "approved_for_decision" | "rejected";
  }>;
  castingCandidates?: Array<{
    artifactId?: string;
    id?: string;
    roleSlotId?: string;
    castingRequirementId?: string;
    displayName?: string;
    source?: "existing_character" | "generated_identity_board" | "human_casting" | "reference_image" | "placeholder";
    candidateStatus?: "draft" | "ready_for_director_review" | "approved_for_decision" | "rejected";
    characterId?: string;
    identityBoardArtifactId?: string;
    referenceAssetCount?: number;
    suitabilityNoteCount?: number;
    riskNoteCount?: number;
  }>;
  castingDecisions?: Array<{
    artifactId?: string;
    id?: string;
    castingRequirementId?: string;
    roleSlotId?: string;
    displayName?: string;
    decisionType?: "approve_identity_board" | "reject_identity_board" | "request_identity_generation" | "assign_existing_character" | "needs_human_casting";
    status?: "draft" | "pending_director_review" | "approved" | "rejected" | "needs_revision";
    candidateName?: string;
    identityBoardArtifactId?: string;
    requiredFollowupCount?: number;
    affectedEpisodeIds?: string[];
    affectedSceneIds?: string[];
    affectedNodeIds?: string[];
  }>;
  departmentPrepPackages?: Array<{
    artifactId?: string;
    id?: string;
    department?: ProductionPrepDepartment;
    ownerAgentId?: string;
    readiness?: "blocked" | "needs_review" | "ready_for_department_review";
    requiredAssetCount?: number;
    variantCount?: number;
    continuityCount?: number;
    openQuestionCount?: number;
    episodeIds?: string[];
    sceneIds?: string[];
    nodeIds?: string[];
    sampleAssets?: Array<{
      assetId?: string;
      name?: string;
      type?: string;
      sceneCount?: number;
      nodeCount?: number;
      shotCount?: number;
    }>;
  }>;
  totals?: {
    breakdownReports?: number;
    sceneMatrixRows?: number;
    roleSlots?: number;
    castingRequirements?: number;
    castingCandidates?: number;
    castingDecisions?: number;
    approvedCastingDecisions?: number;
    departmentPrepPackages?: number;
    readyDepartments?: number;
    blockedDepartments?: number;
    needsReviewDepartments?: number;
  };
}

export interface ProductionCockpitSnapshot {
  schemaVersion?: "production-cockpit.v1";
  projectId?: string;
  generatedAt?: number;
  scope?: {
    coordinationScope?: ProductionCoordinationScope;
    environment?: CockpitEnvironment;
    productionRunId?: string;
    operatorRunId?: string;
    stageType?: ProductionStageType;
    episodeIds?: string[];
    sceneIds?: string[];
    shotIds?: string[];
  };
  currentStage?: {
    source?: string;
    productionRunId?: string;
    stageId?: string;
    stageType?: ProductionStageType;
    title?: string;
    status?: string;
    productionRunStatus?: string;
    updatedAt?: number;
  };
  counts?: {
    productionRuns?: number;
    operatorArtifacts?: number;
    episodes?: number;
    scenes?: number;
    shots?: number;
    departmentFindings?: number;
    hardBlocks?: number;
    autoRepairable?: number;
    softHolds?: number;
    advisory?: number;
    repairTickets?: number;
    openRepairTickets?: number;
    blockedRepairTickets?: number;
    humanInterventionTasks?: number;
    pendingCreativeChanges?: number;
    seriesChangeOrders?: number;
    openSeriesChangeOrders?: number;
    pendingAssets?: number;
    pendingVariantRequests?: number;
    missingDepartmentPackages?: number;
    departmentCoverageReady?: number;
    departmentCoverageNeedsReview?: number;
    departmentCoverageBlocked?: number;
  };
  coordination?: {
    gate?: {
      blocking?: boolean;
      canProceed?: boolean;
      nextAction?: "proceed" | "repair" | "human_review" | "blocked";
      reason?: string;
      circuitBreakerStatus?: string;
      humanInterventionRequired?: boolean;
    };
  };
  departmentFindings?: ProductionCockpitFinding[];
  hardBlocks?: ProductionCockpitFinding[];
  autoRepairableFindings?: ProductionCockpitFinding[];
  softHolds?: ProductionCockpitFinding[];
  advisoryFindings?: ProductionCockpitFinding[];
  repairTickets?: ProductionCockpitRepairTicket[];
  humanInterventionTasks?: Array<{ id?: string; reason?: string; workflowStepId?: string }>;
  departmentCoverage?: ProductionDepartmentCoverageReport;
  missingDepartmentPackages?: ProductionMissingDepartmentPackage[];
  departmentQaSummary?: ProductionDepartmentQaSummary[];
  styleStrategy?: {
    styleLockVersion?: string;
    styleLockApprovalState?: string;
    styleSourceRefCount?: number;
    candidateCount?: number;
    openCandidateCount?: number;
    changeOrderCount?: number;
    pendingChangeOrderCount?: number;
    approvedUncommittedChangeOrderCount?: number;
    storyboardBoardCount?: number;
    assetReferencePackCount?: number;
    videoGenerationUnitCount?: number;
    boardsWithStyleVersion?: number;
    packsWithStyleVersion?: number;
    unitsWithStyleVersion?: number;
    customStrategyBoardCount?: number;
    strategyDraftCount?: number;
    approvedStrategyDraftCount?: number;
    strategyTrialCount?: number;
    passedStrategyTrialCount?: number;
    promotionCandidateCount?: number;
    styleStrategyFindings?: ProductionCockpitFinding[];
    impactPlan?: {
      schemaVersion?: "storyboard-strategy-impact.v1";
      id?: string;
      status?: "no_change" | "planned" | "blocked";
      sourceArtifactId?: string;
      sourceDraftId?: string;
      targetStrategyId?: string;
      scope?: {
        episodeIds?: string[];
        sceneIds?: string[];
        shotIds?: string[];
      };
      rerunPlan?: {
        executionMode?: "human_approved_local_rerun";
        requiresHumanApproval?: boolean;
        automaticRetryBudget?: number;
        affectedBoardIds?: string[];
        affectedAssetReferencePackIds?: string[];
        affectedVideoGenerationUnitIds?: string[];
        preservedBoardIds?: string[];
        preservedAssetReferencePackIds?: string[];
        preservedVideoGenerationUnitIds?: string[];
        preservedArtifactKinds?: string[];
        requiredStageReruns?: string[];
        requiredQaChecks?: string[];
        stopConditions?: string[];
      };
      blockers?: string[];
      summary?: string;
    };
  };
  creativeBackflow?: {
    openChangeCount?: number;
    pendingAssetCount?: number;
    pendingVariantRequestCount?: number;
    formalDeliveryBlockers?: string[];
    changes?: Array<{
      artifactId?: string;
      changeRequestId?: string;
      title?: string;
      status?: string;
      kind?: string;
      department?: string;
      pendingAssets?: unknown[];
      variantRequests?: unknown[];
      localResyncPlanId?: string;
      formalDeliveryBlockers?: string[];
    }>;
  };
  productionGovernance?: ProductionSeriesGovernanceSnapshot;
  productionSchedule?: ProductionScheduleSummary;
  productionPrep?: ProductionPrepSummary;
  productionContinuity?: ProductionContinuitySummary;
  deliveryMode?: {
    draftExploration?: {
      allowed?: boolean;
      canCreateCreativeChanges?: boolean;
      reason?: string;
    };
    formalDelivery?: {
      canRequestStageExit?: boolean;
      requiredGate?: ProductionCoordinationScope;
      nextAction?: "proceed" | "repair" | "human_review" | "blocked";
      blockers?: string[];
      reason?: string;
    };
  };
  storyboardChain?: {
    scriptBlocks?: number;
    shots?: number;
    artifactCounts?: {
      performanceBeats?: number;
      storyboardBoards?: number;
      sceneVisualPacks?: number;
      assetReferencePacks?: number;
      videoGenerationUnits?: number;
      generationPlans?: number;
    };
    generationStatus?: {
      status?: "not_planned" | "ready";
      videoUnitCount?: number;
      reason?: string;
    };
  };
  artifactRefs?: Array<{
    id?: string;
    kind?: string;
    status?: string;
    targetPath?: string;
    runId?: string;
    updatedAt?: number;
    latestQaStatus?: string;
    latestQaNextAction?: string;
  }>;
  latestCoordinationReport?: {
    artifactId?: string;
    reportId?: string;
    approvalState?: string;
    capturedAt?: number;
  };
  nextActions?: ProductionCockpitAction[];
}

interface UseProductionCockpitOptions {
  projectId?: string;
  episodeId?: string;
  stageType?: ProductionStageType;
  scope?: ProductionCoordinationScope;
  environment?: CockpitEnvironment;
  enabled?: boolean;
}

export const useProductionCockpit = ({
  projectId,
  episodeId,
  stageType = "storyboard",
  scope = "stage_exit",
  environment = "development",
  enabled = true,
}: UseProductionCockpitOptions) => {
  const [cockpit, setCockpit] = useState<ProductionCockpitSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      stageType,
      scope,
      environment,
    });
    if (episodeId) params.set("episodeIds", episodeId);
    return params.toString();
  }, [environment, episodeId, scope, stageType]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !projectId) {
      setCockpit(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    getProductionCockpit<ProductionCockpitSnapshot>(projectId, {
      environment,
      stageType,
      scope,
      episodeIds: episodeId ? [episodeId] : undefined,
      init: { signal: controller.signal },
    })
      .then((snapshot) => setCockpit(snapshot))
      .catch((fetchError) => {
        if (fetchError?.name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Production cockpit 载入失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [enabled, environment, episodeId, projectId, queryString, refreshToken, scope, stageType]);

  return {
    cockpit,
    isLoading,
    error,
    refresh,
  };
};
