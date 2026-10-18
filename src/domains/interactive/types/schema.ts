/**
 * Interactive Domain Core Types
 * Current architecture and boundaries: doc/design.md.
 */

export interface ArtifactRef {
  artifactId: string;
  versionId: string;
  kind: 'script_scene' | 'asset_profile' | 'shot_plan' | 'storyboard_board' | 'media_take';
  checksum: string;
}

export type InteractiveExperienceStatus =
  | 'development'
  | 'graph_locked'
  | 'content_production'
  | 'runtime_qa'
  | 'playtest'
  | 'release_candidate'
  | 'released';

export type InteractiveVersionStatus =
  | 'draft'
  | 'qa_failed'
  | 'approved'
  | 'locked'
  | 'stale';

export interface InteractionFormatProfile {
  format: 'branching_fmv' | 'interactive_series' | 'narrative_game';
  aspectRatio: '16:9' | '9:16' | '1:1';
  platforms: Array<'web' | 'mobile' | 'tv' | 'desktop' | 'console'>;
  primaryLanguage: string;
  targetSessionMinutes: number;
  targetCompleteMinutes: number;
}

export interface ExperienceSpec {
  playerRole: string;
  playerPersona: string;
  interactionPromise: string;
  coreVerbs: string[];
  dramaticContract: {
    genre: string;
    theme: string;
    centralConflict: string;
  };
  choiceCadence: {
    targetChoicesPerTenMinutes: number;
    maxMinutesWithoutChoice: number;
  };
  consequenceHorizon: Array<'immediate' | 'delayed' | 'chapter' | 'ending'>;
  failStatePolicy: 'retry' | 'rollback' | 'checkpoint' | 'game_over';
  savePolicy: 'auto_checkpoint' | 'manual_save' | 'chapter_only';
  accessibilitySettings: {
    closedCaptions: boolean;
    timedChoiceOption: 'standard' | 'extended' | 'infinite';
    colorBlindSafe: boolean;
  };
}

export interface StorySourceBinding {
  mode: 'scratch' | 'bind_writing' | 'import';
  writingProjectId?: string;
  importedSourceName?: string;
}

export interface ProductionBoundary {
  maxBranchDepth: number;
  maxParallelBranches: number;
  exclusiveContentPercent: number;
  maxAutomaticRepairAttempts: number;
}

export type StoryBeatKind = 'mandatory' | 'variable' | 'ending';
export type ProductionBlockStatus = 'draft' | 'approved' | 'locked' | 'in_production' | 'complete' | 'stale';

/** Author-facing story navigation. It is independent from production batching. */
export interface StoryEpisode {
  id: string;
  title: string;
  storyChapterIds: string[];
  order: number;
}

/** A stable story chapter shown consistently on the whiteboard and downstream read models. */
export interface StoryChapter {
  id: string;
  title: string;
  summary: string;
  storyBeatIds: string[];
  targetDurationRangeSec: [number, number];
  order: number;
  episodeId?: string;
}

/**
 * A dramatic event, not a node and not a script scene. It may later map to
 * zero, one, or many routing nodes depending on the interaction design.
 */
export interface StoryBeat {
  id: string;
  title: string;
  dramaticPurpose: string;
  kind: StoryBeatKind;
  durationRangeSec: [number, number];
  storyChapterId?: string;
  productionBlockId?: string;
  endingContractId?: string;
}

export interface EndingContract {
  id: string;
  title: string;
  promise: string;
  requiredBeatIds: string[];
}

export interface DurationBudget {
  /** Typical first-playthrough target. */
  p50TargetSec: number;
  /** Long-path / completion target. */
  p90TargetSec: number;
  /** Maximum time between meaningful choices during authored play. */
  maxSecondsWithoutChoice: number;
  tolerancePercent: number;
}

/** The smallest independently lockable and producible slice of the experience. */
export interface ProductionBlock {
  id: string;
  title: string;
  storyBeatIds: string[];
  targetDurationRangeSec: [number, number];
  status: ProductionBlockStatus;
}

export interface StoryArchitecture {
  premise: string;
  protagonistGoal: string;
  thematicQuestion: string;
  /** Legacy outline labels, retained only for older saved projects. */
  mandatoryNodes: string[];
  variableNodes: string[];
  endings: Array<{
    id: string;
    title: string;
    description: string;
  }>;
  branchBudget: {
    maxDepth: number;
    maxParallelBranches: number;
  };
  storyBeats?: StoryBeat[];
  /** Author-facing hierarchy. Chapters must never be inferred from UI layout. */
  storyChapters?: StoryChapter[];
  /** Present for episodic interactive series; feature-length work may omit it. */
  storyEpisodes?: StoryEpisode[];
  endingContracts?: EndingContract[];
  durationBudget?: DurationBudget;
  /** Backstage production scope; deliberately not an author-facing chapter. */
  productionBlocks?: ProductionBlock[];
}

export const normalizeStoryArchitecture = (architecture: StoryArchitecture): StoryArchitecture => {
  const productionBlocks = architecture.productionBlocks || [];
  const explicitChapters = architecture.storyChapters || [];
  // Saved projects before the story-hierarchy split used Production Blocks as
  // chapter-like buckets. Project them into stable story chapters on read, but
  // keep the two identities separate for every subsequent revision.
  const storyChapters = (explicitChapters.length
    ? explicitChapters
    : productionBlocks.map((block, index): StoryChapter => ({
      id: `story-chapter-${block.id}`,
      title: block.title,
      summary: '',
      storyBeatIds: [...block.storyBeatIds],
      targetDurationRangeSec: [...block.targetDurationRangeSec] as [number, number],
      order: index + 1,
    })))
    .map((chapter, index) => ({
      ...chapter,
      summary: chapter.summary || '',
      storyBeatIds: chapter.storyBeatIds || [],
      order: Number.isFinite(chapter.order) && chapter.order > 0 ? chapter.order : index + 1,
    }))
    .sort((left, right) => left.order - right.order);
  const chapterIdByBeatId = new Map(
    storyChapters.flatMap((chapter) => chapter.storyBeatIds.map((beatId) => [beatId, chapter.id] as const)),
  );
  const storyBeats = (architecture.storyBeats || []).map((beat) => ({
    ...beat,
    storyChapterId: beat.storyChapterId || chapterIdByBeatId.get(beat.id),
  }));
  const storyEpisodes = (architecture.storyEpisodes || [])
    .map((episode, index) => ({
      ...episode,
      storyChapterIds: episode.storyChapterIds || [],
      order: Number.isFinite(episode.order) && episode.order > 0 ? episode.order : index + 1,
    }))
    .sort((left, right) => left.order - right.order);
  return {
    ...architecture,
    mandatoryNodes: architecture.mandatoryNodes || [],
    variableNodes: architecture.variableNodes || [],
    endings: architecture.endings || [],
    storyBeats,
    storyChapters,
    storyEpisodes,
    endingContracts: architecture.endingContracts || (architecture.endings || []).map((ending) => ({
      id: ending.id,
      title: ending.title,
      promise: ending.description,
      requiredBeatIds: [],
    })),
    productionBlocks,
  };
};

export interface InteractiveExperience {
  id: string;
  projectId: string;
  title: string;
  genre: string;
  status: InteractiveExperienceStatus;
  formatProfile: InteractionFormatProfile;
  storySource: StorySourceBinding;
  productionBoundary: ProductionBoundary;
  currentExperienceSpecVersionId: string;
  currentStoryArchitectureVersionId: string;
  currentStateSchemaVersionId: string;
  currentGraphVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionedInteractiveArtifact<T> {
  id: string;
  experienceId: string;
  versionIndex: number;
  status: InteractiveVersionStatus;
  data: T;
  createdAt: string;
  updatedAt: string;
}

export interface InteractiveExperienceAggregate {
  experience: InteractiveExperience;
  experienceSpec: VersionedInteractiveArtifact<ExperienceSpec>;
  storyArchitecture: VersionedInteractiveArtifact<StoryArchitecture>;
  stateSchema: VersionedInteractiveArtifact<StateSchema>;
  graph: NarrativeGraphVersion;
  bindings: NodeContentBinding[];
}

/** Presentation settings frozen separately from the shared Production media. */
export interface InteractiveMediaPlaybackSnapshot {
  ref: ArtifactRef;
  label: string;
  durationSeconds: number;
  contentSlot: 'entry' | 'main' | 'choice_hold' | 'exit';
  mediaKind: 'video' | 'image';
  embeddedAudio: boolean;
  visualScenarioId?: string;
  visualStateFingerprint?: string;
  visualReuseFingerprint?: string;
}

/** Immutable graph, state, binding and playback parameters for one preview. */
export interface InteractiveRuntimeBuild {
  id: string;
  experienceId: string;
  /** Legacy builds omit kind and are read as formal builds. */
  kind?: 'formal' | 'structure_preview';
  status: 'ready_for_preview' | 'waiting_for_media' | 'ready_for_player' | 'stale';
  graphVersionId: string;
  graphVersionIndex: number;
  stateSchemaVersionId: string;
  stateSchemaVersionIndex: number;
  /**
   * The player executes these immutable snapshots, never the experience's
   * current authoring aggregate. Builds created before this contract are
   * intentionally treated as stale by the repository.
   */
  graphSnapshot?: NarrativeGraphVersion;
  stateSchemaSnapshot?: StateSchema;
  /** Frozen player rules; older builds use the player's stable legacy defaults. */
  experienceSpecSnapshot?: ExperienceSpec;
  /** Chapter identity frozen for save policy evaluation. */
  nodeChapterIds?: Record<string, string>;
  /** Nonblocking QA limitations retained with this immutable build. */
  qaWarnings?: string[];
  nodeManifests: Array<{
    nodeId: string;
    title: string;
    /** Ordered Writing scenes frozen into this playable node. */
    scriptSceneRefs: ArtifactRef[];
    /** @deprecated Compatibility projection for old RuntimeBuild readers. */
    scriptSceneRef?: ArtifactRef;
    /** Whether this node must have adopted media before the Build is playable. */
    requiresMedia: boolean;
    mediaTakeRefs: ArtifactRef[];
    /** Playback parameters at build creation; media URLs and files remain in Production. */
    mediaPlaybackSnapshots?: InteractiveMediaPlaybackSnapshot[];
    /**
     * Frozen visual-state alternatives. The player evaluates these predicates
     * against the Build's state snapshot and never guesses from take labels.
     */
    mediaScenarios?: Array<{
      scenarioId: string;
      label: string;
      entryPredicate: PredicateAST | null;
      reuseFingerprint: string;
      mediaTakeRefs: ArtifactRef[];
    }>;
  }>;
  missingMediaNodeIds: string[];
  pendingMediaReviewNodeIds: string[];
  /** Structure previews use node summaries only when no approved Writing scene is available. */
  previewTextByNodeId?: Record<string, string>;
  warningNodeIds?: string[];
  staleReason?: string;
  createdAt: string;
}

/**
 * The author's latest persisted path-preview state. This is intentionally a
 * small Interactive-domain snapshot: it never copies script, asset, or media
 * content and can only be restored against the exact graph/state versions.
 */
export interface InteractivePlaytestCheckpoint {
  id: string;
  experienceId: string;
  runtimeBuildId?: string;
  /** Structure previews and formal playtests keep independent save slots. */
  kind: 'formal' | 'structure_preview';
  graphVersionId: string;
  stateSchemaVersionId: string;
  currentNodeId: string;
  state: {
    variables: Record<string, boolean | number | string>;
    facts: string[];
    visitedNodes: Record<string, number>;
    /** Author-facing route history used by the game HUD and ending summary. */
    playedNodes?: Array<{ nodeId: string; choiceText?: string }>;
    /** Real wall-clock test time accumulated before this save. */
    elapsedSeconds?: number;
    /** Reversible path states for retry/rollback after refresh. */
    nodeStates?: Array<{
      nodeId: string;
      variables: Record<string, boolean | number | string>;
      facts: string[];
      visitedNodes: Record<string, number>;
    }>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateInteractiveExperienceInput {
  title: string;
  genre: string;
  executionPolicy?: 'autopilot' | 'guided';
  /**
   * The exact prompt confirmed in the shared prompt editor. This is request
   * context for the initial AI run and is not persisted as Interactive domain
   * data.
   */
  authoringPrompt?: string;
  formatProfile: InteractionFormatProfile;
  experienceSpec: ExperienceSpec;
  storyArchitecture: StoryArchitecture;
  storySource: StorySourceBinding;
  productionBoundary: ProductionBoundary;
}

export interface StateVariableSchema {
  key: string;
  type: 'boolean' | 'number' | 'string' | 'enum';
  scope: 'global' | 'chapter' | 'session';
  defaultValue: boolean | number | string;
  min?: number;
  max?: number;
  enumValues?: string[];
}

export interface StateSchema {
  variables: StateVariableSchema[];
  /** Facts that may be referenced by predicates/effects. */
  factDefinitions?: string[];
  /** Facts the player owns before the entry node is played. */
  initialFactIds?: string[];
  /** @deprecated Read-only compatibility for schemas written before N0. */
  facts?: string[];
}

export const getFactDefinitions = (schema?: StateSchema): string[] => (
  schema?.factDefinitions ?? schema?.facts ?? []
);

export const getInitialFactIds = (schema?: StateSchema): string[] => (
  schema?.initialFactIds ?? []
);

/** Writes the N0 schema shape while accepting legacy read-only data. */
export const normalizeStateSchema = (schema: StateSchema): StateSchema => ({
  variables: schema.variables,
  factDefinitions: getFactDefinitions(schema),
  initialFactIds: getInitialFactIds(schema),
});

export type PredicateAST =
  | { op: 'always' }
  | { op: 'never' }
  | { op: 'all'; predicates: PredicateAST[] }
  | { op: 'any'; predicates: PredicateAST[] }
  | { op: 'not'; predicate: PredicateAST }
  | { op: 'has_fact'; fact: string }
  | { op: 'visited'; nodeId: string; minTimes?: number }
  | {
      op: 'compare';
      variable: string;
      comparator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
      value: boolean | number | string;
    };

export type StateEffectAST =
  | { type: 'set'; variable: string; value: boolean | number | string }
  | { type: 'increment'; variable: string; amount: number }
  | { type: 'decrement'; variable: string; amount: number }
  | { type: 'add_fact'; fact: string }
  | { type: 'remove_fact'; fact: string };

export interface StateContract {
  readVariables: string[];
  writeVariables: string[];
  requiredFacts: string[];
  producedFacts: string[];
}

/** Stable runtime behavior; dramatic function remains a separate creative decision. */
export type NodeCapability =
  | 'play_content'
  | 'present_choice'
  | 'evaluate_condition'
  | 'apply_state_effect'
  | 'converge'
  | 'checkpoint'
  | 'fail_or_retry'
  | 'terminal'
  | 'interaction_hold';

/** Whether a node needs new shared production work, not what it means dramatically. */
export type NodeContentPolicy =
  | 'no_new_content'
  | 'bind_existing'
  | 'create_shared_content'
  | 'compatible_state_reuse'
  | 'exclusive_branch_content';

export interface NodeInteractionContract {
  capabilities: NodeCapability[];
  contentPolicy: NodeContentPolicy;
  durationRangeSec: [number, number];
  playerKnowledgeIn: string[];
  playerKnowledgeOut: string[];
}

export type ChoiceConsequenceHorizon = 'immediate' | 'delayed' | 'chapter' | 'ending';
export type ChoiceConvergenceStrategy = 'diverge' | 'soft_converge' | 'hard_converge' | 'terminal';

export interface ChoiceInteractionContract {
  /** What the player has been shown that makes this decision legible. */
  playerKnowledge: string;
  /** What the player sees or hears immediately after taking it. */
  immediateFeedback: string;
  consequenceHorizon: ChoiceConsequenceHorizon;
  thematicMeaning: string;
  convergenceStrategy: ChoiceConvergenceStrategy;
  estimatedUniqueMediaSec: number;
  replayValue: string;
}

export interface NodeBrief {
  nodeId: string;
  title: string;
  intent: string;
  dramaticFunction: 'exposition' | 'inciting_incident' | 'choice_point' | 'climax' | 'resolution' | 'ending';
  narrativeSummary: string;
}

export interface NodeContentBinding {
  id?: string;
  /** Monotonic revision of this node/slot binding head. */
  versionIndex?: number;
  experienceId?: string;
  nodeId: string;
  slot: 'entry' | 'main' | 'choice_hold' | 'exit';
  /** Ordered Writing scenes played by this content slot. */
  scriptSceneRefs?: ArtifactRef[];
  /** @deprecated Read-only compatibility input. New writes use scriptSceneRefs. */
  scriptSceneRef?: ArtifactRef;
  shotPlanRef?: ArtifactRef;
  storyboardRef?: ArtifactRef;
  /** @deprecated Compatibility pointer for integrations that can only consume one take. */
  mediaTakeRef?: ArtifactRef;
  /** Ordered shared-production takes used by this node. They remain references, never copied media rows. */
  mediaTakeRefs?: ArtifactRef[];
  /** Formal media grouped by the visible state it was produced for. */
  mediaScenarios?: Array<{
    scenarioId: string;
    stateFingerprint?: string;
    reuseFingerprint: string;
    mediaTakeRefs: ArtifactRef[];
  }>;
  lockedAt?: string;
  checksum?: string;
  /**
   * A human-readable confirmation that the locked Writing scene fulfils this
   * node's dramatic and state contract. This is deliberately not inferred
   * from keyword similarity: it is a reviewable production decision.
   */
  contentFitReview?: {
    verdict: 'pass';
    rationale: string;
    reviewedAt: string;
    /** Checksums of every ordered Writing scene covered by this decision. */
    sceneChecksums?: string[];
    /** @deprecated Compatibility checksum for a legacy single-scene binding. */
    scriptChecksum?: string;
  };
  visibleStateSignature?: string;
  reusePolicy?: 'exclusive' | 'compatible_states_only' | 'unrestricted';
  adoption?: {
    proposalId: string;
    adoptedAt: string;
  };
  /** Explicit author decision that the selected shared takes cover this node's dramatic contract. */
  mediaFitReview?: {
    verdict: 'pass';
    rationale: string;
    reviewedAt: string;
    mediaChecksums: string[];
  };
  /**
   * Advisory lineage marker. Upstream edits never revoke an adopted binding;
   * they ask the author to review only the affected content or media again.
   */
  sourceReview?: {
    status: 'current' | 'review_recommended';
    reasons: Array<
      | 'story_source_updated'
      | 'story_architecture_updated'
      | 'graph_updated'
      | 'state_schema_updated'
      | 'binding_source_updated'
      | 'visual_projection_updated'
    >;
    /** Latest content-affecting event. Older rows fall back to detectedAt. */
    contentDetectedAt?: string;
    /** Latest media-affecting event. Older rows fall back to detectedAt. */
    mediaDetectedAt?: string;
    detectedAt: string;
  };
  status?: 'draft' | 'approved' | 'stale';
  updatedAt?: string;
}

export interface NodeContentBindingVersion extends NodeContentBinding {
  id: string;
  experienceId: string;
  versionIndex: number;
  updatedAt: string;
}

export interface InteractiveChoice {
  id: string;
  text: string;
  intent: string;
  condition?: PredicateAST;
  effects: StateEffectAST[];
  targetNodeId: string;
  /** Required by semantic-contract graph revisions; absent only on legacy revisions. */
  interaction?: ChoiceInteractionContract;
  timeoutSeconds?: number;
  defaultTimeoutTargetNodeId?: string;
}

/**
 * Canonical semantic edge in contract-versioned graphs. Node.choices remains a
 * read projection for the runtime and legacy callers, never a second write
 * source once `semanticContractVersion` is 2.
 */
export interface NarrativeTransition extends InteractiveChoice {
  sourceNodeId: string;
}

export interface NarrativeNode {
  id: string;
  brief: NodeBrief;
  contract: StateContract;
  choices: InteractiveChoice[];
  /**
   * @deprecated Read-only compatibility for graphs written before binding
   * ownership moved to `interactive_node_content_bindings`. New graph
   * revisions strip this field; `InteractiveExperienceAggregate.bindings` is
   * the single binding owner.
   */
  bindings?: NodeContentBinding[];
  /** Explicit dramatic provenance. One Beat may fan out to several nodes. */
  storyBeatIds?: string[];
  /** Required by semantic-contract graph revisions; separate from StateContract. */
  interaction?: NodeInteractionContract;
}

export interface NarrativeGraphVersion {
  id: string;
  experienceId: string;
  versionIndex: number;
  nodes: NarrativeNode[];
  transitions?: NarrativeTransition[];
  entryNodeId: string;
  locked: boolean;
  /** Version 2 enables capability/content/choice contracts without rewriting legacy graphs. */
  semanticContractVersion?: 2;
  status?: InteractiveVersionStatus;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Authoring-only canvas state. It intentionally does not participate in a
 * RuntimeBuild: moving a card must never invalidate an approved graph or a
 * playable build.
 */
export interface GraphLayoutRevision {
  id: string;
  experienceId: string;
  versionIndex: number;
  nodes: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
  createdAt: string;
  updatedAt?: string;
}

export const normalizeNarrativeGraph = (graph: NarrativeGraphVersion): NarrativeGraphVersion => {
  const nodesWithoutLegacyBindings = graph.nodes.map(({ bindings: _legacyBindings, ...node }) => node);
  if (!graph.transitions) return { ...graph, nodes: nodesWithoutLegacyBindings };
  const choicesBySource = new Map<string, InteractiveChoice[]>();
  graph.transitions.forEach(({ sourceNodeId, ...choice }) => {
    choicesBySource.set(sourceNodeId, [...(choicesBySource.get(sourceNodeId) || []), choice]);
  });
  return {
    ...graph,
    nodes: nodesWithoutLegacyBindings.map((node) => ({
      ...node,
      choices: choicesBySource.get(node.id) || [],
    })),
  };
};

/** Persists transitions as the sole edge owner for semantic-contract graphs. */
export const graphForPersistence = (
  graph: Pick<NarrativeGraphVersion, 'semanticContractVersion' | 'entryNodeId' | 'nodes' | 'transitions'>,
): Pick<NarrativeGraphVersion, 'semanticContractVersion' | 'entryNodeId' | 'nodes' | 'transitions'> => {
  if (graph.semanticContractVersion !== 2) return graph;
  const transitions = graph.nodes.flatMap((node) => node.choices.map((choice) => ({
    ...choice,
    sourceNodeId: node.id,
  })));
  return {
    semanticContractVersion: 2,
    entryNodeId: graph.entryNodeId,
    nodes: graph.nodes.map(({ bindings: _legacyBindings, ...node }) => ({ ...node, choices: [] })),
    transitions,
  };
};
