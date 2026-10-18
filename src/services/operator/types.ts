export const OPERATOR_HANDBOOK_VERSION = "2026-09-20.operator-v48";

export type OperatorProvider = "codex" | "claude_desktop" | "cursor" | "chatgpt_desktop" | "other";

export type OperatorRunMode =
  | "produce"
  | "qa"
  | "repair"
  | "asset_generation"
  | "research";

export type OperatorRunStatus =
  | "running"
  | "completed"
  | "needs_human_review"
  | "failed"
  | "cancelled";

export type OperatorEventType =
  | "context_read"
  | "plan_created"
  | "artifact_generated"
  | "qa_started"
  | "qa_passed"
  | "qa_failed"
  | "asset_generated"
  | "db_write"
  | "repair_applied"
  | "blocked"
  | "user_decision_required"
  | "completed";

export type OperatorArtifactKind =
  | "project_patch"
  | "episode_patch"
  | "scene_patch"
  | "storyboard_shots"
  | "shot_patch"
  | "character_patch"
  | "asset_patch"
  | "media_reference"
  | "performance_beats"
  | "storyboard_board"
  | "scene_visual_pack"
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
  | "production_coordination_report"
  | "coordination_repair_ticket"
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
  | "qa_report"
  | "custom";

export type OperatorArtifactStatus =
  | "draft"
  | "qa_failed"
  | "approved"
  | "committed"
  | "quarantined";

export type OperatorQAStatus = "passed" | "warning" | "failed";

export type OperatorQANextAction =
  | "commit"
  | "retry"
  | "human_review"
  | "waiveable"
  | "blocked";

export interface OperatorRunScope {
  projectId: string;
  episodeIds?: string[];
  sceneIds?: string[];
  shotIds?: string[];
  assetIds?: string[];
}

export interface OperatorEvent {
  id: string;
  type: OperatorEventType;
  message: string;
  targetPath?: string;
  entityIds?: string[];
  data?: unknown;
  createdAt: number;
}

export interface OperatorOutputRef {
  kind: string;
  targetPath: string;
  entityIds?: string[];
  artifactId?: string;
  mediaPath?: string;
}

export interface OperatorQASummary {
  passed: number;
  warnings: number;
  failed: number;
  blocked: number;
}

export interface OperatorRun {
  id: string;
  projectId: string;
  provider: OperatorProvider;
  providerSessionId?: string;
  handbookVersion: string;
  mode: OperatorRunMode;
  status: OperatorRunStatus;
  userRequest: string;
  scope: OperatorRunScope;
  events: OperatorEvent[];
  outputs: OperatorOutputRef[];
  qaSummary: OperatorQASummary;
  startedAt: number;
  updatedAt: number;
}

export interface OperatorQAVerdict {
  qaAgentId: string;
  status: OperatorQAStatus;
  blocking: boolean;
  score: number;
  issues: OperatorIssue[];
  nextAction: OperatorQANextAction;
  createdAt: number;
}

export interface OperatorArtifactEnvelope<T = unknown> {
  id: string;
  runId: string;
  projectId: string;
  kind: OperatorArtifactKind;
  targetPath: string;
  entityIds: string[];
  status: OperatorArtifactStatus;
  data: T;
  qaVerdicts: OperatorQAVerdict[];
  provenance: {
    provider: OperatorProvider;
    handbookVersion: string;
    source: "operator";
    inputContextHash?: string;
    userRequestHash?: string;
    generatedAt: number;
  };
  commitResult?: {
    committedAt: number;
    changedPaths: string[];
    summary: string;
  };
  createdAt: number;
  updatedAt: number;
}

export type OperatorRegisteredAsset = DomainOperatorRegisteredAsset;

export interface OperatorIssue {
  id: string;
  severity: string;
  target?: string;
  message: string;
  sourceRunId?: string;
  createdAt?: number;
}

export interface OperatorProjectContext {
  handbookVersion: string;
  operatorModeBoundary: {
    entryMode: "external_operator";
    preservesTraditionalMode: true;
    preservesProductionDetail: true;
    requiredInstruction: string;
  };
  project: {
    id: string;
    title: string;
    type?: string;
    projectModel?: string;
    targetEpisodeCount?: number;
    durationMinutes?: number;
    aspectRatio?: string;
    logline?: string;
    coreConflict?: string;
    seasonArc?: string;
  };
  productionState: {
    currentWorkflow?: string;
    currentStage?: string;
    completedStages: string[];
    blockedIssues: OperatorIssue[];
    lastRuns: Array<{
      id: string;
      source: "production_run" | "operator_run";
      status?: string;
      mode?: string;
      updatedAt?: number;
      summary?: string;
    }>;
  };
  creativeMemory: {
    originalInspiration?: string;
    refinedInspiration?: string;
    creativeVision?: unknown;
    premiumProduction?: {
      commercialMemory?: unknown;
      skeletonMemory?: unknown;
      continuityMemory?: unknown;
      qaCouncil?: unknown;
      updatedAt?: number;
    };
    longFormMemory?: unknown;
    assetContinuity?: unknown;
    worldRules: unknown[];
    characters: unknown[];
    locations: unknown[];
    props: unknown[];
    relationships: unknown[];
    universalSkillRefs: unknown[];
    extractedDNAs: unknown[];
  };
  structureMemory: {
    episodes: unknown[];
    scenes: unknown[];
    shots: unknown[];
  };
  qaPolicy: {
    visualPromptLanguage: "project_language_chinese_first";
    requiredChecks: string[];
    forbiddenActions: string[];
  };
}
import type { OperatorRegisteredAsset as DomainOperatorRegisteredAsset } from "../../../packages/domain/src/operatorApi";
