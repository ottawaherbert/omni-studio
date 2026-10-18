import type { AssistantProjectRef } from "./assistantCore";
import type { ProductionDepartmentId } from "./assistantProduction";

export type AssistantRunStatus =
  | "understanding"
  | "planning"
  | "waiting_approval"
  | "queued"
  | "running"
  | "qa"
  | "repairing"
  | "needs_decision"
  | "ready_to_adopt"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled"
  | "rolled_back";

export interface AssistantRunEvent {
  id: string;
  runId: string;
  type: string;
  status?: AssistantRunStatus;
  title: string;
  detail?: string;
  departmentId?: ProductionDepartmentId;
  progress?: number;
  data?: Record<string, unknown>;
  createdAt: number;
}

export interface AssistantRun {
  id: string;
  threadId: string;
  projectRef?: AssistantProjectRef;
  goal: string;
  mode: "read" | "deterministic_write" | "agent_batch" | "high_risk";
  capabilityId?: string;
  status: AssistantRunStatus;
  planId: string;
  planVersion: number;
  authorizationId?: string;
  contextSnapshotId?: string;
  currentStepId?: string;
  progress: number;
  summary?: string;
  output?: Record<string, unknown>;
  error?: string;
  events: AssistantRunEvent[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface AssistantAuthorization {
  id: string;
  runId: string;
  projectRef?: AssistantProjectRef;
  planHash: string;
  allowedCapabilityIds: string[];
  allowedEntityIds: string[];
  promptManifestHash: string;
  repairLimit: number;
  status: "pending" | "approved" | "expired" | "revoked" | "consumed";
  approvedAt?: number;
  expiresAt: number;
}

export interface AssistantChangeSet {
  id: string;
  runId: string;
  projectRef: AssistantProjectRef;
  beforeRevision: number;
  afterRevision?: number;
  beforeHash: string;
  afterHash?: string;
  beforeSnapshot: unknown;
  afterSnapshot?: unknown;
  invalidationImpact: Array<{ kind: string; id: string; label?: string }>;
  summary: string;
  status: "preview" | "committed" | "rolled_back" | "conflicted";
  createdAt: number;
  committedAt?: number;
  rolledBackAt?: number;
}
