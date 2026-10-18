export type AssistantProjectNamespace = "writing" | "production" | "interactive";

export interface AssistantProjectRef {
  namespace: AssistantProjectNamespace;
  projectId: string;
}

export interface AssistantEntityRef {
  type: "project" | "episode" | "segment" | "scene" | "shot" | "asset" | "node" | "source";
  id: string;
  label?: string;
}

export interface AssistantPageFocus {
  module: AssistantProjectNamespace | "shared";
  route: string;
  projectRef?: AssistantProjectRef;
  episodeId?: string;
  sceneId?: string;
  shotId?: string;
  nodeId?: string;
  selectedEntityIds?: string[];
  capturedAt: number;
}

export type AssistantThreadStatus = "active" | "archived" | "deleted";

export interface AssistantThread {
  id: string;
  projectRef?: AssistantProjectRef;
  title: string;
  status: AssistantThreadStatus;
  pinned: boolean;
  lastPageFocus?: AssistantPageFocus;
  latestCheckpointId?: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export type AssistantMessageBlock =
  | { type: "text"; text: string }
  | { type: "plan"; planId: string; summary: string; steps: string[]; risk: AssistantRiskLevel }
  | { type: "run"; runId: string; summary: string }
  | { type: "result"; runId: string; title: string; summary: string }
  | { type: "decision"; runId: string; decisionId: string; title: string; options: string[] }
  | { type: "system_event"; title: string; detail?: string };

export interface AssistantMessage {
  id: string;
  threadId: string;
  projectRef?: AssistantProjectRef;
  role: "user" | "assistant" | "system" | "tool";
  blocks: AssistantMessageBlock[];
  contextSnapshotId?: string;
  runIds: string[];
  parentMessageId?: string;
  createdAt: number;
}

export interface AssistantConversationCheckpoint {
  id: string;
  threadId: string;
  projectRef?: AssistantProjectRef;
  coveredMessageIds: string[];
  goal: string;
  decisions: Array<{ text: string; sourceMessageIds: string[] }>;
  constraints: Array<{ text: string; sourceMessageIds: string[] }>;
  openLoops: Array<{ text: string; runId?: string; stepId?: string }>;
  entityRefs: AssistantEntityRef[];
  runRefs: string[];
  userPreferences: Array<{ text: string; sourceMessageIds: string[] }>;
  summary: string;
  sourceHash: string;
  prompt?: string;
  promptHash?: string;
  estimatedInputTokens?: number;
  createdAt: number;
}

export type AssistantRiskLevel = "read" | "low" | "medium" | "high" | "forbidden";
export type AssistantCapabilityKind = "read" | "navigate" | "deterministic_write" | "agent_run" | "qa" | "export";

export interface AssistantCapabilityManifest {
  id: string;
  version: string;
  module: AssistantProjectNamespace | "shared";
  title: string;
  description: string;
  kind: AssistantCapabilityKind;
  risk: AssistantRiskLevel;
  projectScope: "required" | "optional" | "global_only";
  preconditions: string[];
  sideEffects: string[];
  invalidates: string[];
  supportsPreview: boolean;
  supportsUndo: boolean;
  promptPolicy?: {
    workflowStepIds: string[];
    skillSlots: string[];
    batchAuthorizable: boolean;
  };
}

export interface AssistantPromptExecutionPreview {
  id: string;
  capabilityId: string;
  agentId?: string;
  title: string;
  templateId: string;
  prompt: string;
  promptHash: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  contextSources: Array<{ id: string; label: string; hash?: string }>;
  editable: boolean;
}

export interface AssistantPromptCompositionManifest {
  version: "prompt-composition/v1";
  blocks: Array<{
    blockId: string;
    source: string;
    purpose: string;
    charCount: number;
    hash: string;
    required: boolean;
    optional: boolean;
    included: boolean;
    omissionReason?: string;
    duplicateOf?: string;
  }>;
  finalCharCount: number;
  finalHash: string;
  issues: Array<{ code: string; blockId: string; message: string }>;
}

export interface AssistantPromptExecutionRecord extends AssistantPromptExecutionPreview {
  runId: string;
  stepId: string;
  status: "running" | "succeeded" | "failed";
  provider?: string;
  modelId?: string;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  promptCompositionManifest?: AssistantPromptCompositionManifest;
  resultHash?: string;
  result?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface AssistantPlan {
  id: string;
  threadId: string;
  projectRef?: AssistantProjectRef;
  goal: string;
  summary: string;
  capabilityId?: string;
  risk: AssistantRiskLevel;
  steps: Array<{
    id: string;
    title: string;
    capabilityId: string;
    dependsOn: string[];
  }>;
  promptPreviews: AssistantPromptExecutionPreview[];
  input: Record<string, unknown>;
  requiresConfirmation: boolean;
  planHash: string;
  status: "draft" | "approved" | "cancelled" | "executed";
  createdAt: number;
  updatedAt: number;
}
