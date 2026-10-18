import {
  ArtifactEnvelope,
  QAVerdict,
  WorkflowTrigger,
} from "./production";

export type SourceArtifactKind =
  | "adaptation_source"
  | "video_analysis_segment"
  | "video_dna_source"
  | "skill_source"
  | "reference_text";

export type SourceAuthorizationStatus =
  | "owned_or_licensed"
  | "public_domain"
  | "analysis_only"
  | "unknown";

export type ReferenceQAStatus = "passed" | "warning" | "failed";

export type ReferenceTargetStage =
  | "concept"
  | "context_planning"
  | "bible"
  | "asset_detail"
  | "structure"
  | "scene"
  | "script"
  | "storyboard"
  | "prompt"
  | "interactive_bible"
  | "game_blueprint"
  | "graph_generation"
  | "interactive_script"
  | "interactive_storyboard";

export interface SourceArtifact {
  id: string;
  kind: SourceArtifactKind;
  sourceType: string;
  title?: string;
  sourceHash: string;
  textPreview: string;
  textCharCount: number;
  truncated: boolean;
  truncationStrategy: string;
  authorizationStatus: SourceAuthorizationStatus;
  rightsBoundary: string;
  adaptationBoundary: string;
  abstractionStrategy: string;
  createdAt: number;
}

export interface ReferenceGovernanceMetadata {
  sourceArtifactId: string;
  sourceHash: string;
  sourceType: string;
  authorizationStatus: SourceAuthorizationStatus;
  rightsBoundary: string;
  adaptationBoundary: string;
  abstractionStrategy: string;
  noSourceCopyQaStatus: ReferenceQAStatus;
  structureQaStatus: ReferenceQAStatus;
  formatConflictQaStatus: ReferenceQAStatus;
  routingQaStatus: ReferenceQAStatus;
  allowedStages: ReferenceTargetStage[];
  blockedStages: ReferenceTargetStage[];
  contaminationBoundary: string;
  qaIssueFingerprints: string[];
  provenanceAgentRunIds: string[];
  createdAt: number;
}

export interface GovernedDraft<T = unknown> {
  sourceArtifact: SourceArtifact;
  envelope: ArtifactEnvelope<T>;
  qaVerdicts: QAVerdict[];
  governance: ReferenceGovernanceMetadata;
}

export interface UpstreamGovernanceRun<T = unknown> {
  workflowStepId: string;
  trigger: WorkflowTrigger;
  draft: GovernedDraft<T>;
}
