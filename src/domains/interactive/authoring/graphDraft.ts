/**
 * Interactive Graph Draft Schema & Types
 * Current architecture and boundaries: doc/design.md.
 */

import {
  NarrativeNode,
  NarrativeTransition,
  NodeBrief,
  NodeInteractionContract,
  NarrativeGraphVersion,
  StateSchema,
  StoryArchitecture,
} from '../types/schema';

export type DraftScope =
  | { type: 'whole_graph' }
  | { type: 'from_node'; nodeId: string }
  | { type: 'repair'; issueIds: string[] };

export type GraphPatchOperation =
  | { type: 'add_node'; node: NarrativeNode }
  | { type: 'update_node_brief'; nodeId: string; brief: NodeBrief }
  | { type: 'update_node_interaction'; nodeId: string; interaction: NodeInteractionContract }
  | { type: 'remove_node'; nodeId: string }
  | { type: 'add_transition'; transition: NarrativeTransition }
  | { type: 'update_transition'; transitionId: string; patch: Partial<NarrativeTransition> }
  | { type: 'remove_transition'; transitionId: string }
  | { type: 'set_entry'; nodeId: string };

export type GraphDraftStatus = 'candidate' | 'adopted' | 'rejected' | 'stale';

export interface GraphDraftImpact {
  addedNodeIds: string[];
  updatedNodeIds: string[];
  removedNodeIds: string[];
  addedChoiceIds: string[];
  updatedChoiceIds: string[];
  removedChoiceIds: string[];
  p50DurationDeltaSec: number;
  p90DurationDeltaSec: number;
  uniqueMediaDeltaSec: number;
}

export interface GraphDraftQA {
  blocking: string[];
  warnings: string[];
  coverageIncomplete: boolean;
  checkerId?: string;
  issueFingerprints?: string[];
}

export interface GraphDraftAuditEvent {
  type: 'generated' | 'adopted' | 'rejected';
  at: string;
}

export interface GraphDraftAudit {
  promptTemplate: string;
  inputGraphVersionId: string;
  inputGraphVersionIndex: number;
  provider?: string;
  modelId?: string;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  events: GraphDraftAuditEvent[];
}

export interface InteractiveGraphDraft {
  id: string;
  /** Candidate whose complete proposal was used as feedback context. */
  revisionOfDraftId?: string;
  experienceId: string;
  baseGraphVersionId: string;
  baseGraphVersionIndex: number;
  scope: DraftScope;
  authorIntent: string;
  summary: string;
  operations: GraphPatchOperation[];
  proposedStateSchema?: StateSchema;
  proposedStoryArchitecture?: StoryArchitecture;
  suggestedLayout?: Record<string, { x: number; y: number }>;
  impact: GraphDraftImpact;
  qa: GraphDraftQA;
  audit: GraphDraftAudit;
  status: GraphDraftStatus;
  createdAt: string;
}
