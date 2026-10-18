import { GameProjectData } from "./game";
import { Episode, Project } from "./project";

export type ProductionMode = "linear" | "interactive";

export type ProductionRunStatus =
  | "draft"
  | "running"
  | "paused"
  | "needs_human_review"
  | "failed"
  | "completed"
  | "cancelled";

export type ProductionStageStatus =
  | "pending"
  | "running"
  | "awaiting_prompt_approval"
  | "qa_running"
  | "retrying"
  | "needs_human_review"
  | "approved"
  | "failed"
  | "skipped"
  | "completed";

export type ProductionStageType =
  | "intake"
  | "concept"
  | "context_planning"
  | "bible"
  | "asset_detail"
  | "structure"
  | "scene"
  | "script"
  | "script_lock"
  | "content_lock"
  | "production_breakdown"
  | "production_asset_detail"
  | "asset_sync"
  | "storyboard"
  | "prompt"
  | "expensive_generation_planning"
  | "interactive_bible"
  | "game_blueprint"
  | "graph_generation"
  | "interactive_graph_qa"
  | "node_to_scene"
  | "interactive_script"
  | "interactive_storyboard"
  | "playtest_simulation";

export type ProductionArtifactType =
  | "concept"
  | "bible"
  | "character"
  | "location"
  | "prop"
  | "episode"
  | "scene"
  | "script"
  | "performance_beats"
  | "breakdown"
  | "storyboard"
  | "storyboard_board"
  | "scene_visual_pack"
  | "image_prompt"
  | "video_prompt"
  | "asset_board_plan"
  | "formal_asset_package"
  | "asset_identity_board"
  | "scene_asset_variant_pack"
  | "asset_variant_fingerprint"
  | "asset_reference_pack"
  | "video_generation_unit"
  | "style_reference_analysis"
  | "visual_style_lock_candidate"
  | "style_lock_change_order"
  | "storyboard_strategy_draft"
  | "storyboard_strategy_draft_trial"
  | "development_asset_brief"
  | "script_lock_package"
  | "content_lock_package"
  | "production_block_lock"
  | "production_breakdown_report"
  | "continuity_matrix"
  | "role_slot"
  | "casting_candidate"
  | "casting_requirement"
  | "casting_decision"
  | "department_prep_package"
  | "creative_change_request"
  | "series_change_order"
  | "pending_asset"
  | "variant_request"
  | "local_resync_plan"
  | "game_graph"
  | "qa_report"
  | "generation_plan";

export type QAStatus = "passed" | "warning" | "failed";

export type ProductionReviewMode = "full" | "lean" | "fast";

export type ProductionModelTaskType = "scriptGen" | "storyboardGen" | "qcAnalyzer";

export type QAIssueResolutionClass =
  | "hard_blocking"
  | "auto_repairable"
  | "soft_hold"
  | "advisory";

export type AgentRole = "producer" | "qa" | "planner" | "committer" | "tool";

export type WorkflowTrigger = "auto" | "manual";

export type ArtifactEnvelopeStatus =
  | "draft"
  | "qa_failed"
  | "approved"
  | "committed"
  | "quarantined";

export type ProductionArtifactLifecycleStatus =
  | "draft"
  | "qa_failed"
  | "approved"
  | "locked"
  | "committed"
  | "revision"
  | "stale"
  | "quarantined";

export type AgentNextAction =
  | "commit"
  | "retry"
  | "model_fallback"
  | "human_review"
  | "waiveable"
  | "blocked";

export type ProductionGateId =
  | "CONTRACT"
  | "CREATIVE_QUALITY"
  | "TRANSPARENCY"
  | "FORMAT_STANDARDS"
  | "CONCEPT"
  | "CONTEXT"
  | "BIBLE"
  | "ASSET"
  | "STRUCTURE"
  | "SCENE"
  | "SCRIPT"
  | "ASSET_LIFECYCLE"
  | "STORYBOARD"
  | "PROMPT"
  | "GRAPH"
  | "PLAYTEST"
  | "MEDIA";

export interface ProductionPolicy {
  reviewMode: ProductionReviewMode;
  manualGates: ProductionStageType[];
  autoApproveLowRisk: boolean;
  allowAutoRewrite: boolean;
  maxRetriesPerStage: number;
  modelFallbackOrder: ProductionModelTaskType[];
  maxStoredTextChars: number;
  runtimeControls: ProductionRuntimeControls;
}

export interface ProductionRuntimeControls {
  creativeTemperature: number;
  shotDensity: "low" | "medium" | "high";
  dialogueDensity: "sparse" | "balanced" | "dense";
  shortDramaBeatFrequency: "low" | "medium" | "high";
  interactiveBranchDepth: number;
}

export interface ContextPlan {
  globalSkills: string[];
  scriptSkills: string[];
  visualSkills: string[];
  dialogueSkills: string[];
  pacingDNAs: string[];
  shotDNAs: string[];
  forbiddenSkills: string[];
  skillScores?: Record<string, number>;
  fieldLanguagePolicy: Record<string, "project_language" | "english" | "bilingual">;
  tokenBudgetEstimate: Partial<Record<ProductionStageType, number>>;
  reason: string;
}

export interface ProductionQAIssue {
  id: string;
  severity: "info" | "warning" | "error" | "blocking";
  target: string;
  message: string;
  suggestion?: string;
  fingerprint?: string;
  retryable?: boolean;
  repairInstruction?: string;
  issueType?: string;
  resolutionClass?: QAIssueResolutionClass;
  severityPolicyId?: string;
}

export interface RetryPolicy {
  id: string;
  maxAutoRetries: number;
  maxModelFallbacks: number;
  issueFingerprintWindow: number;
  outputSimilarityThreshold: number;
  minScoreDelta: number;
  retryableIssueTypes: string[];
  nonWaiveableGates: ProductionGateId[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: AgentRole;
  owns: string;
  inputContractId: string;
  outputContractId: string;
  allowedTools: string[];
  retryPolicyId: string;
  description: string;
  stageTypes?: ProductionStageType[];
  modelRoute?: ProductionModelTaskType;
}

export interface WorkflowStepDefinition {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  producerAgentId: string;
  qaAgentIds: string[];
  commitPolicyId: string;
  humanGatePolicyId: string;
  dependsOn: string[];
  stageType?: ProductionStageType;
  artifactTypes: ProductionArtifactType[];
}

export interface ArtifactEnvelope<T = unknown> {
  id: string;
  kind: string;
  targetPath: string;
  entityIds: string[];
  status: ArtifactEnvelopeStatus;
  data: T;
  provenance: {
    agentRunId: string;
    promptReviewId?: string;
    modelRoute?: string;
    templateId?: string;
    contextFingerprint: string;
  };
  createdAt: number;
}

export interface QAVerdict {
  qaAgentId: string;
  status: QAStatus;
  blocking: boolean;
  score: number;
  issues: ProductionQAIssue[];
  nextAction: AgentNextAction;
  createdAt: number;
}

export interface AgentRetryAttempt {
  id: string;
  attempt: number;
  score?: number;
  issueFingerprints: string[];
  draftFingerprint?: string;
  modelRoute?: ProductionModelTaskType;
  createdAt: number;
}

export interface RetryDecision {
  nextAction: AgentNextAction;
  shouldRetry: boolean;
  humanInterventionRequired: boolean;
  retryable: boolean;
  reason: string;
  stuckReason?: string;
  issueFingerprints: string[];
  retryCount: number;
  modelFallbackCount: number;
}

export interface HumanInterventionTask {
  id: string;
  workflowStepId: string;
  agentRunId: string;
  reason: string;
  issueFingerprints: string[];
  repairOptions: string[];
  status: "open" | "resolved" | "waived" | "blocked";
  createdAt: number;
}

export type ProductionCoordinationScope =
  | "stage_exit"
  | "episode_wrap"
  | "phase_wrap"
  | "manual_audit";

export type ProductionCoordinationDepartment =
  | "asset"
  | "continuity"
  | "storyboard_video_unit"
  | "style_strategy"
  | "creative_commercial"
  | "media_readiness"
  | "department_coverage"
  | "operator_governance";

export type ProductionDepartmentCoverageReadiness =
  | "ready"
  | "needs_review"
  | "blocked"
  | "missing"
  | "not_required";

export type ProductionRepairMode =
  | "test_fix_code_prompt_qa_or_workflow"
  | "production_content_draft"
  | "manual_intervention"
  | "waiver_request";

export type ProductionRepairClassification =
  | "content"
  | "code"
  | "prompt"
  | "qa"
  | "workflow"
  | "schema"
  | "manual"
  | "waiver";

export type ProductionCoordinationApprovalState =
  | "draft"
  | "blocked"
  | "needs_repair"
  | "ready_for_human_review"
  | "approved";

export interface ProductionCoordinationSourceRef {
  kind:
    | ProductionArtifactType
    | "operator_artifact"
    | "project"
    | "episode"
    | "scene"
    | "shot"
    | "production_memory"
    | "asset_continuity"
    | "qa_report"
    | "gate_verdict";
  id?: string;
  targetPath: string;
  stageType?: ProductionStageType;
  artifactKind?: string;
}

export interface ProductionDepartmentFinding {
  id: string;
  department: ProductionCoordinationDepartment;
  status: QAStatus;
  severity: ProductionQAIssue["severity"];
  target: string;
  message: string;
  evidenceRefs: ProductionCoordinationSourceRef[];
  ownerAgentId?: string;
  suggestedStageType?: ProductionStageType;
  repairInstruction?: string;
  retryable?: boolean;
  resolutionClass?: QAIssueResolutionClass;
  severityPolicyId?: string;
}

export interface CoordinationRepairTicket {
  id: string;
  issueId: string;
  ownerAgentId: string;
  suggestedStageType: ProductionStageType;
  targetArtifactId?: string;
  targetPath: string;
  repairMode: ProductionRepairMode;
  repairClassification: ProductionRepairClassification;
  issueFingerprint: string;
  sourceArtifactIds: string[];
  sourceStageType?: ProductionStageType;
  reason: string;
  repairInstruction: string;
  maxRetries: number;
  retryCount: number;
  resolutionClass?: QAIssueResolutionClass;
  severityPolicyId?: string;
  autoRepairAttempted?: boolean;
  lastRepairDiff?: string;
  waiverCandidate?: boolean;
  humanEscalationReason?: string;
  status: "open" | "in_progress" | "resolved" | "blocked";
  createdAt: number;
  updatedAt?: number;
}

export type ProductionCoordinationRecoveryState =
  | "clear"
  | "soft_hold"
  | "repair_open"
  | "repair_in_progress"
  | "human_review_required"
  | "blocked"
  | "resolved";

export interface ProductionCoordinationTraceLink {
  issueId: string;
  issueFingerprint: string;
  findingId: string;
  department: ProductionCoordinationDepartment;
  findingStatus: QAStatus;
  severity: ProductionQAIssue["severity"];
  resolutionClass?: QAIssueResolutionClass;
  targetPath: string;
  ownerAgentId?: string;
  suggestedStageType?: ProductionStageType;
  sourceStageType?: ProductionStageType;
  sourceArtifactIds: string[];
  evidenceRefs: ProductionCoordinationSourceRef[];
  repairTicketIds: string[];
  humanInterventionTaskIds: string[];
  recoveryState: ProductionCoordinationRecoveryState;
  repairMode?: ProductionRepairMode;
  repairClassification?: ProductionRepairClassification;
  retryCount: number;
  maxRetries: number;
  autoRepairAttempted: boolean;
  updatedAt?: number;
}

export interface ProductionCoordinationTraceIndex {
  schemaVersion: "production-coordination-trace.v1";
  runId?: string;
  stageId?: string;
  stageType?: ProductionStageType;
  sourceArtifactIds: string[];
  sourceQaReportIds: string[];
  sourceGateIds: string[];
  handoffManifestId?: string;
  handoffAllowedArtifactIds: string[];
  handoffBlockedArtifactIds: string[];
  findingIds: string[];
  repairTicketIds: string[];
  humanInterventionTaskIds: string[];
  links: ProductionCoordinationTraceLink[];
  recoverySummary: Record<ProductionCoordinationRecoveryState, number> & {
    totalFindings: number;
    unresolvedFindings: number;
    sourceArtifactCount: number;
  };
}

export interface DepartmentHandoffManifest {
  id: string;
  fromStageType?: ProductionStageType;
  toStageType?: ProductionStageType;
  allowedArtifactRefs: ProductionCoordinationSourceRef[];
  allowedAssetRefs: ProductionCoordinationSourceRef[];
  blockedRefs: ProductionCoordinationSourceRef[];
  missingRefs: Array<{
    targetPath: string;
    reason: string;
    requiredBeforeStageType?: ProductionStageType;
  }>;
  notes: string[];
}

export interface ProductionMissingDepartmentPackage {
  department: string;
  targetPath: string;
  reason: string;
  severity: ProductionQAIssue["severity"];
  resolutionClass: QAIssueResolutionClass;
  requiredBeforeStageType?: ProductionStageType;
  sceneIds: string[];
  nodeIds: string[];
  shotIds: string[];
}

export interface ProductionDepartmentQaSummary {
  department: string;
  status: QAStatus;
  severity: ProductionQAIssue["severity"];
  readiness: ProductionDepartmentCoverageReadiness;
  resolutionClass: QAIssueResolutionClass;
  packageIds: string[];
  artifactIds: string[];
  ownerAgentIds: string[];
  issueCount: number;
  messages: string[];
  target: string;
}

export interface ProductionDepartmentSceneReadiness {
  sourceType: "scene" | "node";
  episodeId?: string;
  sceneId?: string;
  nodeId?: string;
  title: string;
  readyDepartments: string[];
  needsReviewDepartments: string[];
  blockedDepartments: string[];
  missingDepartments: string[];
  packageIds: string[];
}

export interface ProductionDepartmentCoverageItem {
  department: string;
  required: boolean;
  readiness: ProductionDepartmentCoverageReadiness;
  reason: string;
  requiredBeforeStageTypes: ProductionStageType[];
  packageIds: string[];
  artifactIds: string[];
  directPackageIds: string[];
  legacyAliasPackageIds: string[];
  ownerAgentIds: string[];
  readyPackageCount: number;
  needsReviewPackageCount: number;
  blockedPackageCount: number;
  requiredAssetCount: number;
  variantCount: number;
  continuityCount: number;
  sceneIds: string[];
  nodeIds: string[];
  shotIds: string[];
  hasSpecialistPayload: boolean;
  missingSpecialistPayload: boolean;
}

export interface ProductionDepartmentCoverageReport {
  schemaVersion: "production-department-coverage.v1";
  policyId: string;
  coverageMode: "not_started" | "active";
  projectMode: string;
  stageType?: ProductionStageType;
  trackedDepartments: string[];
  requiredDepartments: string[];
  coveredDepartments: string[];
  readyDepartments: string[];
  needsReviewDepartments: string[];
  blockedDepartments: string[];
  missingRequiredDepartments: string[];
  optionalMissingDepartments: string[];
  departments: ProductionDepartmentCoverageItem[];
  missingDepartmentPackages: ProductionMissingDepartmentPackage[];
  departmentQaSummary: ProductionDepartmentQaSummary[];
  perSceneReadiness: ProductionDepartmentSceneReadiness[];
  legacyAliasCoverage: Array<{
    aliasDepartment: string;
    canonicalDepartments: string[];
    packageIds: string[];
  }>;
  totals: {
    trackedDepartments: number;
    requiredDepartments: number;
    coveredDepartments: number;
    readyDepartments: number;
    needsReviewDepartments: number;
    blockedDepartments: number;
    missingRequiredDepartments: number;
    perSceneRows: number;
  };
  notes: string[];
}

export interface ProductionCoordinationReport {
  schemaVersion: "production-coordination-report.v1";
  id: string;
  scope: ProductionCoordinationScope;
  projectId: string;
  runId?: string;
  stageId?: string;
  stageType?: ProductionStageType;
  episodeIds: string[];
  sceneIds: string[];
  shotIds: string[];
  capturedAt: number;
  sourceArtifactIds: string[];
  sourceRefs: ProductionCoordinationSourceRef[];
  departmentFindings: ProductionDepartmentFinding[];
  blockingIssues: ProductionQAIssue[];
  repairTickets: CoordinationRepairTicket[];
  coordinationTrace: ProductionCoordinationTraceIndex;
  departmentCoverage: ProductionDepartmentCoverageReport;
  missingDepartmentPackages: ProductionMissingDepartmentPackage[];
  departmentQaSummary: ProductionDepartmentQaSummary[];
  handoffManifest: DepartmentHandoffManifest;
  approvalState: ProductionCoordinationApprovalState;
  environmentPolicy: {
    environment: "test" | "production" | "development";
    preferredRepairMode: ProductionRepairMode;
    rationale: string;
  };
  qaChecklist: string[];
  summary: string;
}

export interface QAWarningWaiver {
  id: string;
  artifactId?: string;
  stageId: string;
  issueFingerprint: string;
  reason: string;
  downstreamRisk: string;
  waivedBy: "author" | "system";
  expiresOnUpstreamChange: boolean;
  createdAt: number;
}

export interface ArtifactApprovalRecord {
  id: string;
  artifactId: string;
  stageId: string;
  action: "approve" | "lock" | "request_revision" | "waive" | "rollback";
  actor: "author" | "system" | "qa";
  reason?: string;
  waiverId?: string;
  createdAt: number;
}

export interface ArtifactDependencyEdge {
  id: string;
  sourceArtifactId: string;
  targetArtifactId: string;
  relation: "derived_from" | "overwrites" | "references" | "requires_review";
  createdAt: number;
}

export interface ArtifactRollbackRecord {
  id: string;
  artifactId: string;
  targetArtifactId: string;
  fieldPath?: string;
  reason: string;
  createdAt: number;
}

export interface ProductionAuthoritySnapshot {
  schemaVersion: "production-authority-snapshot.v1";
  capturedAt: number;
  project: Project | null;
  activeEpisodeId: string | null;
  activeEpisode: Episode | null;
  fullEpisodes: Episode[];
  gameProjectId?: string | null;
  gameEpisodeId?: string | null;
  gameData?: GameProjectData;
}

export type ProductionAuthoritySnapshotStatus =
  | "none"
  | "draft_captured"
  | "committed"
  | "discarded";

export interface ProductionGateVerdict {
  gateId: ProductionGateId;
  label: string;
  status: QAStatus | "skipped";
  blocking: boolean;
  score?: number;
  issues?: ProductionQAIssue[];
  summary: string;
  modeApplied: ProductionReviewMode;
  createdAt: number;
}

export interface ProductionQAReport {
  id: string;
  stageId: string;
  checkerId: string;
  status: QAStatus;
  score?: number;
  issues: ProductionQAIssue[];
  fixInstructions?: string;
  blocking: boolean;
  rawOutput?: string;
  createdAt: number;
}

export interface ProductionArtifact {
  id: string;
  projectId: string;
  runId: string;
  stageId: string;
  artifactType: ProductionArtifactType;
  targetPath: string;
  entityIds: string[];
  version: number;
  lifecycleStatus?: ProductionArtifactLifecycleStatus;
  draftEnvelopeId?: string;
  previousArtifactId?: string;
  changeSummary?: string;
  summary: string;
  qaReportIds?: string[];
  gateIds?: ProductionGateId[];
  approvalRecords?: ArtifactApprovalRecord[];
  waiverIds?: string[];
  dependencyIds?: string[];
  locked?: boolean;
  approvedAt?: number;
  lockedAt?: number;
  committedAt?: number;
  revisionOfArtifactId?: string;
  stale?: boolean;
  staleReason?: string;
  staleSince?: number;
  createdAt: number;
}

export interface ProductionCheckpoint {
  id: string;
  stageId: string;
  kind: "input" | "output" | "qa" | "human_review" | "revision" | "skip" | "error";
  snapshot: unknown;
  productionManifest?: ProductionManifest;
  note?: string;
  createdAt: number;
}

export interface ProductionTemplateTrace {
  id: string;
  name?: string;
  source: "runner.inline" | "config.defaultTemplates" | "server.prompt" | "manual.custom" | "unknown";
  version?: string;
  path?: string;
  metadata?: ProductionTemplateMetadata;
  metadataWarnings?: string[];
}

export interface ProductionTemplateMetadata {
  stageType: ProductionStageType;
  inputFields: string[];
  requiredVariables: string[];
  outputSchema: string[];
  allowedReferenceInputs: string[];
  languagePolicy: string;
  qaRules: string[];
}

export interface ProductionReferenceInfluence {
  sourceId: string;
  sourceName: string;
  sourceType?: string;
  category?: string;
  influenceAxes: string[];
  appliedAs: string[];
  limitations: string[];
}

export interface ProductionFormatProfileSnapshot {
  id: string;
  label: string;
  mode: ProductionMode;
  unitName: string;
  defaultSkeletonId: string;
  defaultBeatId: string;
  defaultSceneTemplateId: string;
  qaGates: string[];
  generationPolicy: {
    pilotFirst: boolean;
    maxGeneratedEpisodesPerBatch: number;
    notes: string[];
  };
}

export interface ProductionManifest {
  schemaVersion: "production-manifest.v1";
  createdAt: number;
  runId: string;
  projectId: string;
  projectTitle: string;
  mode: ProductionMode;
  stageId: string;
  stageType: ProductionStageType;
  stageTitle: string;
  modelUsed?: string;
  provider: {
    routingTask?: string;
    modelLabel?: string;
    modelId?: string;
    modelRegistryId?: string;
    channelId?: string;
    channelName?: string;
    channelType?: string;
    baseUrl?: string;
    apiKeyConfigured?: boolean;
    apiKeySource?: "modelOverride" | "channel" | "serverEnv" | "env" | "missing" | "not-applicable";
    resolutionStatus?: "resolved" | "not-used" | "missing-route" | "missing-model" | "missing-channel";
    providerLabel: string;
    disclosure: string;
  };
  template: ProductionTemplateTrace;
  prompt: {
    stored: boolean;
    charCount: number;
    tokenEstimate?: number;
    truncatedForStorage: boolean;
    preview: {
      available: boolean;
      text: string;
      charCount: number;
      truncated: boolean;
      reviewStatus: "auto_recorded" | "manual_review_required" | "missing";
    };
    originalPrompt?: string;
    editedPrompt?: string;
    reviewStatus?: "pending" | "approved" | "edited" | "rejected" | "stale";
    authorNote?: string;
  };
  outputContract: {
    schemaFields: string[];
    qaRules: string[];
    languagePolicy?: string;
    metadataWarnings: string[];
  };
  context: {
    fieldScope: string[];
    skillIds: string[];
    dnaIds: string[];
    forbiddenSkillIds: string[];
    omittedProjectContext: string[];
    contextInventory: Partial<Record<"universalSkillRefs" | "worldBuildingRules" | "relationships" | "characters" | "creativeVisionFields", number>>;
    tokenBudget?: number;
    languagePolicy?: ContextPlan["fieldLanguagePolicy"];
  };
  parameters: {
    reviewMode: ProductionReviewMode;
    autoApproveLowRisk: boolean;
    maxRetriesPerStage: number;
    requiresHumanReview: boolean;
    revisionInstructions?: string;
    modelFallbackOrder: ProductionModelTaskType[];
    maxStoredTextChars: number;
    runtimeControls: ProductionRuntimeControls & {
      pilotFirst: boolean;
      maxGeneratedEpisodesPerBatch: number;
    };
    runtimeControlSource: "run_default" | "stage_override";
    runtimeControlOverrides: Partial<ProductionRuntimeControls>;
    pilotPlan: {
      enabled: boolean;
      batchPolicy: "pilot_then_expand" | "profile_batch";
      pilotUnitName: string;
      firstBatchLimit: number;
      scope: string;
      expansionGate: string;
      nextBatchCondition: string;
    };
    formatProfile?: ProductionFormatProfileSnapshot;
  };
  references: {
    activeSkillIds: string[];
    activeDnaIds: string[];
    influences: ProductionReferenceInfluence[];
    fieldEvidence: {
      sourceId: string;
      sourceName: string;
      influenceAxes: string[];
      targetPaths: string[];
      fieldPaths: string[];
      evidenceSummary: string;
    }[];
    missingReferenceTraceWarning: boolean;
  };
  artifacts: {
    artifactType: ProductionArtifactType;
    targetPath: string;
    entityIds: string[];
    version: number;
    summary: string;
  }[];
  qa: {
    reportCount: number;
    blocking: boolean;
    gateCount: number;
    blockingGateCount: number;
  };
  diff: {
    targetPath: string;
    artifactType: ProductionArtifactType;
    entityIds: string[];
    version: number;
    previousVersion?: number;
    changeSummary?: string;
    previousArtifactId?: string;
    fieldLevelSummary: string;
    structuredChanges?: {
      path: string;
      changeType: "added" | "removed" | "changed" | "unchanged" | "unknown";
      before?: string;
      after?: string;
    }[];
    entityChangeSummary?: {
      added: number;
      removed: number;
      changed: number;
      unchanged: number;
      sampledEntityIds: string[];
    };
  }[];
  authorControl: {
    promptVisible: boolean;
    contextVisible: boolean;
    parametersVisible: boolean;
    referencesVisible: boolean;
    diffVisible: boolean;
  };
  explainability: {
    summary: string;
    used: string[];
    notUsed: string[];
  };
  transparencyWarnings: string[];
}

export interface ProductionRunMetrics {
  modelCallCount: number;
  modelFailureCount: number;
  qaFailureTypes: Partial<Record<string, number>>;
  gateRevisionRequests: Partial<Record<ProductionStageType, number>>;
  stageRetryCount: Partial<Record<ProductionStageType, number>>;
}

export interface ProductionStageExecutionResult {
  summary: string;
  artifacts: Omit<
    ProductionArtifact,
    "id" | "projectId" | "runId" | "stageId" | "createdAt"
  >[];
  qaReports: Omit<ProductionQAReport, "id" | "stageId" | "createdAt">[];
  contextPlan?: ContextPlan;
  promptUsed?: string;
  rawOutput?: string;
  modelUsed?: ProductionModelTaskType;
  contextUsed?: unknown;
  templateUsed?: ProductionTemplateTrace;
  outputSnapshot?: unknown;
}

export interface PromptReview {
  id: string;
  status: "pending" | "approved" | "edited" | "rejected" | "stale";
  originalPrompt: string;
  editedPrompt?: string;
  finalPrompt?: string;
  templateId?: string;
  templateVersion?: string;
  contextFingerprint: string;
  tokenEstimate: number;
  createdAt: number;
  approvedAt?: number;
  authorNote?: string;
}

export interface ProductionStageRun {
  id: string;
  runId: string;
  stageType: ProductionStageType;
  title: string;
  description: string;
  agentId: string;
  status: ProductionStageStatus;
  inputSnapshot?: unknown;
  outputArtifactIds: string[];
  qaReports: ProductionQAReport[];
  promptUsed?: string;
  modelUsed?: string;
  productionManifest?: ProductionManifest;
  contextUsed?: unknown;
  runtimeControlOverrides?: Partial<ProductionRuntimeControls>;
  rawOutput?: string;
  recoverySuggestions?: string[];
  inputConflictWarning?: string;
  tokenEstimate?: number;
  retryCount: number;
  maxRetries: number;
  startedAt?: number;
  finishedAt?: number;
  errorMessage?: string;
  failureType?: "model" | "json" | "qa" | "data" | "user" | "unknown";
  revisionInstructions?: string;
  schemaVersion?: string;
  stale?: boolean;
  staleReason?: string;
  gateVerdicts?: ProductionGateVerdict[];
  nextAction?: string;
  requiresHumanReview: boolean;
  promptReview?: PromptReview;
  draftAuthoritySnapshot?: ProductionAuthoritySnapshot;
  authoritySnapshotStatus?: ProductionAuthoritySnapshotStatus;
}

export interface ProductionRun {
  id: string;
  revision?: number;
  name: string;
  projectId: string;
  projectTitle: string;
  mode: ProductionMode;
  status: ProductionRunStatus;
  currentStageId: string;
  stages: ProductionStageRun[];
  artifacts: ProductionArtifact[];
  artifactDependencies?: ArtifactDependencyEdge[];
  artifactApprovals?: ArtifactApprovalRecord[];
  qaWaivers?: QAWarningWaiver[];
  rollbackRecords?: ArtifactRollbackRecord[];
  interventionTasks?: HumanInterventionTask[];
  checkpoints: ProductionCheckpoint[];
  policy: ProductionPolicy;
  contextPlan: ContextPlan;
  formatProfile?: ProductionFormatProfileSnapshot;
  metrics: ProductionRunMetrics;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ProductionStageDefinition {
  stageType: ProductionStageType;
  title: string;
  description: string;
  agentId: string;
  defaultRequiresHumanReview: boolean;
  artifactTypes: ProductionArtifactType[];
}

export interface CreateProductionRunOptions {
  name?: string;
  policy?: Partial<ProductionPolicy>;
  contextPlan?: Partial<ContextPlan>;
}

export type ProductionRunProjectInput = Pick<
  Project,
  | "id"
  | "title"
  | "projectModel"
  | "type"
  | "originalInspiration"
  | "refinedInspiration"
  | "interactiveConfig"
  | "interactiveTemplate"
  | "targetEpisodeCount"
  | "productionMemory"
  | "operatorProductionMemory"
  | "appliedVADnaProjectId"
  | "extractedDNAs"
  | "universalSkillRefs"
>;
