import type { AssistantPromptExecutionPreview, AssistantPromptExecutionRecord } from "./assistantCore";
import type { AssistantRunStatus } from "./assistantRuntime";

export type ProductionDepartmentId =
  | "directing"
  | "production_coordination"
  | "cinematography"
  | "lighting"
  | "production_design"
  | "wardrobe"
  | "makeup_hair"
  | "performance_directing"
  | "action_choreography"
  | "props"
  | "continuity"
  | "sound_music";

export type ProductionPreparationDepartmentStatus =
  | "not_required"
  | "queued"
  | "generating"
  | "qa"
  | "repairing"
  | "rechecking"
  | "passed"
  | "needs_decision"
  | "failed"
  | "cancelled";

export interface ProductionPreparationDepartmentStep {
  id: string;
  batchRunId: string;
  departmentId: ProductionDepartmentId;
  departmentName: string;
  sceneIds: string[];
  dependsOn: string[];
  status: ProductionPreparationDepartmentStatus;
  candidate?: unknown;
  qa?: unknown;
  promptExecutionIds: string[];
  retryCount: number;
  blockingIssueIds: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface ProductionPreparationQualityDimension {
  id: string;
  label: string;
  score: number;
  confidence: "low" | "medium" | "high";
  evidence: string[];
  issues: string[];
}

export interface ProductionPreparationQualityGate {
  verdict: "not_ready" | "needs_decision" | "ready_for_storyboard";
  score: number;
  summary: string;
  blockingIssues: string[];
  dimensions: ProductionPreparationQualityDimension[];
  assetContinuity: {
    status: "pass" | "warning" | "blocked";
    summary: string;
    issues: string[];
  };
}

export interface ProductionPreparationBatchRun {
  manualResponseOnly?: boolean;
  id: string;
  assistantRunId?: string;
  projectId: string;
  sourceSnapshotId: string;
  workUnit: { kind: "episode" | "segment"; id: string; title: string };
  sceneIds: string[];
  sceneLabels?: Record<string, string>;
  status: AssistantRunStatus;
  authorizationId?: string;
  promptPreviews: AssistantPromptExecutionPreview[];
  promptExecutions: AssistantPromptExecutionRecord[];
  breakdownCandidates: Record<string, {
    breakdown: unknown;
    qa: unknown;
    promptExecutionIds: string[];
    status: "passed" | "needs_decision";
  }>;
  departmentSteps: ProductionPreparationDepartmentStep[];
  qualityGate?: ProductionPreparationQualityGate;
  changeSetId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
