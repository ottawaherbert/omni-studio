/**
 * A node's read-only route into the shared preparation workspace. It stops the
 * interactive shell from guessing by title/order and always opens the source
 * unit that contains the exact locked Writing scene for the selected node.
 */
export interface InteractiveProductionPrepNodeTarget {
  nodeId: string;
  sourceDocumentId: string;
  sourceWritingUnitId: string;
  productionEpisodeId: string;
  /** A node can span more than one adopted production scene. */
  productionSceneIds: string[];
  /** Whether this node's exact source and visual projections still match the Interactive head. */
  isCurrentForNode?: boolean;
}

/**
 * Shared-production boundary for Interactive. The Interactive aggregate keeps
 * only this link; all preparation artifacts continue to belong to Production.
 */
export interface InteractiveProductionPrepTarget {
  experienceId: string;
  productionProjectId: string;
  sourceWritingProjectId: string;
  sourceWritingRevision: number;
  sourceHash: string;
  status: "created" | "reused";
  /** Computed from the shared project's read-only interactive prep profile. */
  nodeTargets?: InteractiveProductionPrepNodeTarget[];
  /** Latest author direction for affected nodes; Production owns the persisted request. */
  nodeFeedback?: Array<{ nodeId: string; feedback: string; createdAt: number }>;
}

/**
 * Read-only projection of an active, provenance-verified video take from the
 * shared production project. The URL stays outside the interactive aggregate;
 * authors bind only `ref`.
 */
export interface InteractiveProductionMediaTakeOption {
  ref: ArtifactRef;
  nodeId: string;
  productionProjectId: string;
  productionEpisodeId: string;
  productionSceneId: string;
  shotId: string;
  takeId: string;
  /** Whether Production has explicitly adopted this take for the Shot. */
  isActive: boolean;
  createdAt: number;
  label: string;
  durationSeconds: number;
  contentSlot: "entry" | "main" | "choice_hold" | "exit";
  mediaKind: "video" | "image";
  embeddedAudio: boolean;
  visualScenarioId?: string;
  visualStateFingerprint?: string;
  visualReuseFingerprint?: string;
  /** Ephemeral shared-production playback URL; never persisted in the Interactive aggregate. */
  url?: string;
}

export interface InteractiveRuntimeMediaClip extends InteractiveProductionMediaTakeOption {
  /** Selected by this build; independent of the current Production selection. */
  isActive: boolean;
  url: string;
}

/**
 * A read-only player projection. It resolves a RuntimeBuild's immutable media
 * references back to the shared Production takes instead of duplicating files
 * into the Interactive domain.
 */
export interface InteractiveRuntimeMediaManifest {
  buildId: string;
  experienceId: string;
  nodes: Array<{
    nodeId: string;
    clips: Array<InteractiveRuntimeMediaClip>;
    scenarios?: Array<{
      scenarioId: string;
      label: string;
      entryPredicate: import('../types/schema').PredicateAST | null;
      reuseFingerprint: string;
      clips: Array<InteractiveRuntimeMediaClip>;
    }>;
  }>;
}

export interface InteractiveProductionPrepPort {
  getTarget(experienceId: string): InteractiveProductionPrepTarget | null;
  ensureTarget(experienceId: string): InteractiveProductionPrepTarget;
  listMediaTakes(experienceId: string, nodeId: string): InteractiveProductionMediaTakeOption[];
  resolveRuntimeMediaManifest(experienceId: string, runtimeBuildId?: string): InteractiveRuntimeMediaManifest;
  getLatestPlan(experienceId: string): import('../../../types/project').InteractiveProductionPlanDraft | null;
  createPlan(experienceId: string): import('../../../types/project').InteractiveProductionPlanDraft;
  adoptPlan(experienceId: string, planId: string): {
    plan: import('../../../types/project').InteractiveProductionPlanDraft;
    target: InteractiveProductionPrepTarget;
  };
  rejectPlan(experienceId: string, planId: string): import('../../../types/project').InteractiveProductionPlanDraft;
  getLatestMediaPlan(experienceId: string): import('../../../types/project').InteractiveMediaPlanDraft | null;
  createMediaPlan(experienceId: string): import('../../../types/project').InteractiveMediaPlanDraft;
  adoptMediaPlan(experienceId: string, planId: string): {
    plan: import('../../../types/project').InteractiveMediaPlanDraft;
    aggregate: import('../types/schema').InteractiveExperienceAggregate;
  };
  requestMediaRevision(
    experienceId: string,
    planId: string,
    nodeId: string,
    feedback: string,
    scenarioId?: string,
  ): import('../../../types/project').InteractiveMediaPlanDraft;
  getLatestVisualRefinement(
    experienceId: string,
    productionSceneId: string,
    visualScenarioId: string,
  ): import('../../../types/project').InteractiveVisualRefinementDraft | null;
  createVisualRefinement(
    experienceId: string,
    input: {
      productionSceneId: string;
      visualScenarioId: string;
      finalPrompt: string;
      selectedSkillIds?: string[];
      selectedSkillTitles?: string[];
      selectedContextIds?: string[];
    },
  ): Promise<import('../../../types/project').InteractiveVisualRefinementDraft>;
  adoptVisualRefinement(
    experienceId: string,
    draftId: string,
  ): {
    draft: import('../../../types/project').InteractiveVisualRefinementDraft;
    projection: import('../projection/interactiveVisualContextProjection').InteractiveVisualContextProjection;
  };
  rejectVisualRefinement(
    experienceId: string,
    draftId: string,
  ): import('../../../types/project').InteractiveVisualRefinementDraft;
}
import type { ArtifactRef } from '../types/schema';
