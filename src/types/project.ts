import type { CreativeDirectionBindings, CreativeStyleVersion } from "../../packages/domain/src/creativeDirection";
import type { SceneDirectorPlan, ShotDirecting } from "../../packages/domain/src/directorPlan";
import type { ReferenceGovernanceMetadata } from "./referenceGovernance";
import type { ScriptExportPackage } from "../../packages/domain/src/scriptDelivery";
import type { VisualCompileManifest } from "../../packages/domain/src/visualArtifact";
import type { VisualLocalOverride } from "../../packages/domain/src/visualOverride";
import type { VisualStyleLockV3Fields } from "../../packages/domain/src/visualStyle";

export type {
  VisualImplementationOverride,
  VisualLocalOverride,
  VisualOverrideValue,
  VisualRequiredOverrideValue,
  VisualTreatmentOverride,
} from "../../packages/domain/src/visualOverride";
export type { VisualCompileManifest } from "../../packages/domain/src/visualArtifact";
export type {
  Animation2DVisualSpecification,
  Animation3DVisualSpecification,
  ConcreteVisualImplementationMedium,
  ConcreteVisualProductionMode,
  LiveActionVisualSpecification,
  MixedMediaVisualSpecification,
  StopMotionVisualSpecification,
  VisualAppearance,
  VisualEntityType,
  VisualImplementationMedium,
  VisualMediumAssignment,
  VisualMediumAssignmentTarget,
  VisualMediumProfileDefinition,
  VisualModeSpecification,
  VisualProductionMode,
  VisualStyleLockV3,
  VisualStyleLockV3Fields,
  VisualStyleSourceReview,
  VisualStyleTreatment,
} from "../../packages/domain/src/visualStyle";

export type DeepReadonly<T> = T extends (...args: any[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export interface ProductionWritingSourceSnapshot {
  readonly schemaVersion: "production-script-source-snapshot.v1";
  readonly sourceType: "writing_export";
  readonly importId: string;
  readonly sourceWritingProjectId: string;
  readonly sourceExportedAt: number;
  readonly importedAt: number;
  readonly sourceHash: string;
  readonly package: DeepReadonly<ScriptExportPackage>;
}

export interface ProductionMagicImportSourcePayload {
  sourceText: string;
  sourceFormat: "novel" | "outline" | "script" | "other";
  targetFormat: "short-drama" | "tv-series" | "movie";
  // Legacy imports may carry these. New director-production intake deliberately
  // keeps visual settings out of source import.
  aspectRatio?: string;
  adaptationTone?: "faithful" | "dramatic";
  sourceArtifact?: unknown;
  sourceGovernance?: unknown;
  sourceEnvelope?: unknown;
}

export interface ProductionMagicImportSourceSnapshot {
  readonly schemaVersion: "production-script-source-snapshot.v1";
  readonly sourceType: "magic_import";
  readonly importId: string;
  readonly importedAt: number;
  readonly sourceHash: string;
  readonly payload: DeepReadonly<ProductionMagicImportSourcePayload>;
}

export type ProductionScriptSourceSnapshot =
  | ProductionWritingSourceSnapshot
  | ProductionMagicImportSourceSnapshot;

export interface ProductionNarrativeEntitySyncState {
  schemaVersion: "production-narrative-entity-sync.v1";
  sourceWritingProjectId: string;
  acknowledgedRemovedSourceKeys: string[];
  lastCheckedExportedAt: number;
  lastAppliedAt: number;
}

export type ProductionSourceDocumentKind = "whole" | "episode" | "segment" | "adapted_script";

/**
 * A lossless, read-only source work range. It is intentionally distinct from a
 * production Scene: source import never creates production scenes by itself.
 */
export interface ProductionSourceDocument {
  id: string;
  order: number;
  kind: ProductionSourceDocumentKind;
  title: string;
  /** Short story-purpose summary preserved from Writing for stable sync diffs. */
  summary?: string;
  content: string;
  sourceHash: string;
  targetDurationMinutes?: number;
  continuityMode?: "continue" | "standalone";
  // A raw novel source is retained for audit, but only its adopted script may
  // receive production scene planning. Existing documents default to true.
  isWorkRange?: boolean;
  sourceWritingUnitId?: string;
  originalSourceDocumentId?: string;
  createdAt: number;
}

/**
 * The production project keeps the imported source immutable, but authors work
 * on a separately versioned current screenplay. This prevents a production
 * revision from silently rewriting the import evidence.
 */
export type ProductionScriptAuthority = "writing" | "production";

export type ProductionCanonicalScriptUnitKind = "episode" | "segment";

export interface ProductionCanonicalScriptUnit {
  /** Stable identity. Reordering a unit must never change this id. */
  id: string;
  sourceDocumentId: string;
  kind: ProductionCanonicalScriptUnitKind;
  order: number;
  title: string;
  summary?: string;
  targetDurationMinutes?: number;
  continuityMode?: "continue" | "standalone";
  content: string;
  contentHash: string;
  status: "current" | "archived";
  sourceWritingUnitId?: string;
  originalSourceDocumentId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProductionScriptRevision {
  id: string;
  revision: number;
  kind: "initial" | "writing_sync" | "manual_edit" | "scope_change" | "production_override" | "restore";
  authority: ProductionScriptAuthority;
  message: string;
  sourceHash: string;
  units: ProductionCanonicalScriptUnit[];
  createdAt: number;
}

export interface ProductionScriptWorkspace {
  schemaVersion: "production-canonical-script.v1";
  authority: ProductionScriptAuthority;
  sourceKind: "writing_project" | "magic_import" | "production_created";
  writingProjectId?: string;
  /** Revision currently used for all production source projections. */
  currentRevisionId: string;
  revisions: ProductionScriptRevision[];
  /** The original import remains readable and never becomes an editable draft. */
  originalRevisionId?: string;
  syncPolicy: "safe_auto" | "manual";
  syncStatus: "current" | "update_available" | "conflict" | "blocked";
  updatedAt: number;
}

export interface ProductionScenePlanCandidate {
  id: string;
  order: number;
  title: string;
  description: string;
  purpose?: string;
  sourceEvidence: string;
  /**
   * Exact screenplay blocks resolved from the locked Writing scene. Unit-level
   * prose may be projected here when the planning card itself has no blocks.
   */
  scriptBlocks?: Array<Pick<ScriptBlock, "type" | "content">>;
  continuityIn?: string;
  continuityOut?: string;
  targetDurationMinutes?: number;
  /**
   * Read-only references to locked interactive nodes that use this shared
   * production scene. They never create a second scene or asset record.
   */
  interactiveNodeIds?: string[];
}

export interface ProductionScenePlanVersion {
  id: string;
  sourceDocumentId: string;
  sourceHash: string;
  status: "adopted" | "superseded" | "rolled_back";
  /** Source text changed after this plan was adopted. Keep the plan for audit, never silently overwrite it. */
  sourceStatus?: "current" | "needs_review" | "stale";
  candidateScenes: ProductionScenePlanCandidate[];
  // Keeps every adopted production-scene version recoverable. The active
  // episode only projects the currently adopted snapshot.
  adoptedSceneSnapshot: Scene[];
  replacedSceneSnapshot?: Scene[];
  promptAudit: ProductionPreparationPromptAudit;
  qa?: ProductionScenePlanQA;
  adoptedAt: number;
  supersededAt?: number;
  rolledBackAt?: number;
}

export interface InteractiveProductionPlanDraft {
  id: string;
  experienceId: string;
  sourceHash: string;
  sourceWritingRevision: number;
  status: 'candidate' | 'adopted' | 'rejected' | 'stale';
  units: Array<{
    episodeId: string;
    sourceDocumentId: string;
    scenes: ProductionScenePlanCandidate[];
  }>;
  impact: {
    productionSceneCount: number;
    reusedSceneCount: number;
    affectedNodeCount: number;
    estimatedUniqueDurationSeconds: number;
    nodesWithoutMedia: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface InteractiveMediaPlanDraft {
  id: string;
  experienceId: string;
  productionProjectId: string;
  status: 'candidate' | 'adopted' | 'rejected' | 'stale';
  selections: Array<{
    nodeId: string;
    scenarioId?: string;
    scenarioLabel?: string;
    stateFingerprint?: string;
    reuseFingerprint?: string;
    takeRefs: Array<{
      artifactId: string;
      versionId: string;
      kind: 'media_take';
      checksum: string;
    }>;
    labels: string[];
  }>;
  missingNodeIds: string[];
  missingScenarioIds?: string[];
  missingScenarios?: Array<{
    nodeId: string;
    scenarioId: string;
    label?: string;
  }>;
  missingContentSlots?: Array<{
    nodeId: string;
    scenarioId?: string;
    contentSlot: "entry" | "main" | "choice_hold" | "exit";
  }>;
  estimatedDurationSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface InteractiveVisualRefinementDraft {
  id: string;
  experienceId: string;
  productionProjectId: string;
  productionSceneId: string;
  visualProjectionId: string;
  visualScenarioId: string;
  sourceFingerprint: string;
  /** Exact projection snapshot reviewed by the author; prevents stale refinements from winning later. */
  projectionSnapshotHash?: string;
  status: 'candidate' | 'adopted' | 'rejected' | 'stale';
  proposal: {
    label: string;
    environmentChanges: string[];
    performanceConstraints: string[];
    rationale: string;
  };
  promptAudit: {
    templateId: 'interactiveVisualRefinement/v1';
    promptHash: string;
    modelId?: string;
    selectedSkillIds: string[];
    selectedSkillTitles: string[];
    selectedContextIds: string[];
    createdAt: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface InteractiveMediaFeedbackRequest {
  id: string;
  nodeId: string;
  scenarioId?: string;
  feedback: string;
  rejectedTakeChecksums: string[];
  createdAt: number;
}

export interface ProductionScenePlanQA {
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  issues: Array<{
    severity: "blocking" | "warning" | "advisory";
    description: string;
    suggestion: string;
  }>;
  audit: ProductionPreparationPromptAudit;
  reviewedAt: number;
}

/**
 * Read-only interactive context attached to a shared production project.
 * It carries graph constraints into shared preparation without copying script,
 * asset, shot, storyboard, or media facts into the interactive domain.
 */
export interface ProductionInteractivePrepProfile {
  schemaVersion: "interactive-production-prep.v1" | "interactive-production-prep.v2";
  experienceId: string;
  graphVersionId: string;
  entryNodeId: string;
  sourceWritingProjectId: string;
  sourceWritingRevision: number;
  sourceHash: string;
  createdAt: number;
  nodes: Array<{
    nodeId: string;
    title: string;
    dramaticFunction: string;
    /** Author-facing story placement, independent from this project's Episode container. */
    storyEpisodeId?: string;
    storyEpisodeTitle?: string;
    storyEpisodeOrder?: number;
    storyChapterId?: string;
    storyChapterTitle?: string;
    storyChapterOrder?: number;
    /** Omitted for pure routing, convergence, checkpoint and state nodes. */
    sourceDocumentId?: string;
    sourceWritingUnitId?: string;
    sourceSceneRef?: {
      artifactId: string;
      versionId: string;
      checksum: string;
    };
    /** Ordered Writing scenes for v2; v1 readers project sourceSceneRef into this list. */
    sourceSceneRefs?: Array<{
      artifactId: string;
      versionId: string;
      checksum: string;
    }>;
    orderedContentSlots?: Array<{
      slot: "entry" | "main" | "choice_hold" | "exit";
      sourceSceneRefs: Array<{
        artifactId: string;
        versionId: string;
        checksum: string;
      }>;
    }>;
    /** Content nodes enter shared preparation; control nodes remain graph-only. */
    requiresSharedProduction: boolean;
    readVariables: string[];
    writeVariables: string[];
    requiredFacts: string[];
    producedFacts: string[];
    choices: Array<{
      choiceId: string;
      text: string;
      intent: string;
      targetNodeId: string;
      timeoutSeconds?: number;
      defaultTimeoutTargetNodeId?: string;
    }>;
    isEnding: boolean;
  }>;
}

export interface UniversalSkillReference {
  kind?: "general" | "director" | "visual_style";
  id: string;
  title: string;
  content: string;
  categoryId?: string;
  source?: "manual" | "ai" | "legacy" | "video-analysis";
  sourceProjectId?: string;
  referenceGovernance?: ReferenceGovernanceMetadata;
  createdAt?: number;
  updatedAt?: number;
}

export type AppearanceFields = Partial<Record<"clothing" | "dirt" | "injury" | "hair" | "makeup" | "other", string>>;
export interface ShotAppearanceState {
  assetId: string;
  assetName: string;
  timelineKey: string;
  event: string;
  evidence: string;
  origin: "script" | "proposal";
  continuity: "new" | "continue" | "uncertain";
  inheritFromShotId?: string;
  startChanges: AppearanceFields;
  endChanges: AppearanceFields;
  start: AppearanceFields;
  end: AppearanceFields;
  imageMoment: "start" | "end";
  referenceNeed: "text" | "image";
  existingVariantId?: string;
  startVariantId?: string;
  endVariantId?: string;
  decision: "accepted" | "pending" | "dismissed";
  issues: string[];
  sourceHash: string;
  inheritedFingerprint?: string;
}
export interface ShotAppearance {
  analysis: "complete" | "unreviewed";
  states: ShotAppearanceState[];
}

export interface AssetVariant {
  appearanceFields?: AppearanceFields;
  appearanceFingerprint?: string;
  id: string;
  name: string;
  description: string;
  promptModifiers: string;
  /**
   * Optional sibling state board used as the visual parent for sequential changes.
   * When omitted, generation inherits from the canonical asset board.
   */
  referenceVariantId?: string;
  /** Editable prompt for the production state board. */
  boardPrompt?: string;
  /** Adopted production state-board image used by downstream reference packs. */
  boardImageUrl?: string;
  /** Text-free state reference preferred by image and video generation models. */
  cleanReferenceImageUrl?: string;
  /** Editable prompt for the text-free model reference. */
  cleanReferencePrompt?: string;
  imageUrl?: string;
}

export interface VisualImageCandidate {
  id: string;
  kind: "base" | "multiview" | "variant";
  variantId?: string;
  imageUrl: string;
  imageMedia?: MediaAssetReference;
  prompt: string;
  promptHash: string;
  modelId: string;
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  promptCompositionManifest?: PromptCompositionManifestAudit;
  visualStyleCompileManifest?: VisualCompileManifest;
  /** Exact owner identity/state/reference/style inputs captured before generation. */
  sourceContentHash?: string;
  createdAt: number;
}

export interface VisualImageAdoptionAudit extends VisualImageCandidate {
  /** Canonical destination changed by the explicit adoption action. */
  slot: "base" | "multiview" | `variant:${string}`;
  sourceReview?: {
    status: "current" | "review_recommended";
    reasons: Array<"source_updated" | "source_fingerprint_missing">;
    detectedAt: number;
  };
  adoptedAt: number;
}

export interface Character {
  aliases?: string[];
  visualFacts?: ProductionAssetVisualFact[];
  visualDesignNeedsReview?: boolean;
  creativeDirection?: CreativeDirectionBindings;
  creativeStyleVersions?: CreativeStyleVersion[];
  activeCreativeStyleVersionId?: string;
  id: string;
  name: string;
  /** Voice-only characters participate in script/audio continuity without requiring a visual identity board. */
  visualPresence?: "onscreen" | "voice_only";
  /** Stable visible identity facts; board layout instructions belong in boardPrompt. */
  visualIdentity?: string;
  psychologicalProfile?: string;
  mbti?: string;
  enneagram?: string;
  internalDesire?: string;
  externalGoal?: string;
  flaw?: string;
  actingStyle?: string; // e.g., Method Acting, Meisner, Noir Detective
  vocalQuirk?: string;
  sliders?: Record<string, number>;
  voiceName?: string;
  voiceSettings?: import('../../packages/domain/src/speech').VoiceSettings;
  /** Author-owned voice material. Timbre samples and finished dialogue remain distinct. */
  voiceReferences?: Array<{
    id: string;
    url: string;
    language?: string;
    durationSeconds?: number;
    usage: "voice_timbre" | "full_dialogue";
    description?: string;
    isDefault?: boolean;
    createdAt?: number;
  }>;
  referenceImageUrl?: string;
  /** Generated previews awaiting an explicit human adoption action. */
  visualImageCandidates?: VisualImageCandidate[];
  /** Immutable audit snapshots retained after a generated candidate is adopted. */
  visualImageAdoptionAudits?: VisualImageAdoptionAudit[];
  /** Editable prompt for the canonical character board. */
  boardPrompt?: string;
  /** Adopted canonical character-board image used by downstream reference packs. */
  boardImageUrl?: string;
  /** Text-free turnaround reference preferred by image and video generation models. */
  cleanReferenceImageUrl?: string;
  /** Editable prompt for the text-free turnaround reference. */
  cleanReferencePrompt?: string;
  multiViewPrompt?: string;
  multiViewUrl?: string;
  model3dUrl?: string; // 3D Low-Poly Model URL
  variants?: AssetVariant[];
  defaultVariantId?: string;
  globalAssetId?: string;
  voiceMap?: Record<string, string>;
  defaultReferenceUrl?: string;
  /** Sparse visual execution choices; canonical identity fields remain authoritative. */
  visualOverride?: VisualLocalOverride;
}

export interface AudioTrack {
  directorCue?: { planId?: string; cueId?: string; lineIndex?: number };
  id: string;
  type: 'dialogue' | 'bgm' | 'sfx';
  url: string;
  startTime: number; // in seconds
  sourceStartSeconds?: number; // source media in-point; timeline position is independent
  duration: number; // in seconds
  volume?: number; // 0-1, defaults to full volume
  muted?: boolean;
  characterId?: string; // For dialogue
  speakerName?: string; // Scene-local speaker without a formal character asset
  text?: string; // For dialogue
  shotId?: string; // Link to the shot that generated this audio
  linkedAssetId?: string; // Link to the global asset
  audioMedia?: MediaAssetReference;
  generationAudit?: ManualStudioAudioAudit;
  /** Only per-line differences from the character defaults; absent fields inherit. */
  voiceDirection?: Pick<import('../../packages/domain/src/speech').VoiceSettings, 'language' | 'instructions' | 'speed'>;
  /** Previously used recordings are retained when another recording is generated. */
  voiceHistory?: Array<{
    url: string;
    text?: string;
    duration: number;
    sourceStartSeconds?: number;
    characterId?: string;
    shotId?: string;
    audioMedia?: MediaAssetReference;
    generationAudit?: ManualStudioAudioAudit;
    voiceDirection?: AudioTrack['voiceDirection'];
    archivedAt: number;
  }>;
}

export interface ManualStudioVoiceAudit {
  action: "generate_voice";
  sourceHash: string;
  textHash: string;
  modelId: string;
  provider?: 'api' | 'manual_external';
  voiceName: string;
  language?: string;
  instructions?: string;
  speed?: number;
  shotId?: string;
  characterId?: string;
  createdAt: number;
}

export interface ManualStudioBgmAudit {
  action: "generate_bgm";
  sourceHash: string;
  promptHash: string;
  modelId: string;
  provider: "gemini" | "custom" | "manual_external";
  trackId: string;
  shotId?: string;
  contextSummary: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  authorConfirmedAt: number;
  createdAt: number;
}

export type ManualStudioAudioAudit = ManualStudioVoiceAudit | ManualStudioBgmAudit;

export interface GenerationMetadata {
  templateId?: string;
  templateVersion?: string;
  modelId?: string;
  promptSummary?: string;
  timestamp?: number;
}

export type MediaAssetKind = "image" | "video" | "audio";
export type MediaAssetSource = "ai_generation" | "upload" | "asset_library" | "manual" | "legacy";
export type MediaAssetStatus = "pending" | "ready" | "failed" | "stale";

export type ImageGenerationReferenceRole =
  | "character_identity"
  | "wardrobe_state"
  | "location_design"
  | "prop_design"
  | "vehicle_design"
  | "composition_anchor"
  | "continuity_frame"
  | "style_reference"
  | "source_edit"
  | "previous_output_repair";

export interface ImageGenerationReferenceAudit {
  index: number;
  imageUrl: string;
  label: string;
  role: ImageGenerationReferenceRole;
  preserve: string[];
  allowChange: string[];
  exclude: string[];
}

export interface PromptCompositionManifestAudit {
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

export interface MediaAssetReference {
  url?: string;
  kind: MediaAssetKind;
  source: MediaAssetSource;
  status: MediaAssetStatus;
  generationJobId?: string;
  modelId?: string;
  createdAt: number;
  updatedAt?: number;
  errorMessage?: string;
  note?: string;
}

export interface SpatialComposition {
  imageUrl: string; // 3D 画布的截图
  cameraState: { position: number[], target: number[], fov: number };
  entities: Array<{
    id: string; // 关联的 characterId 或 propId
    type: 'character' | 'prop';
    position?: number[]; // 3D 坐标 [x, y, z]
    rotationY?: number; // 旋转角度
    scale?: number[]; // 缩放 [x, y, z]
    screenBox?: { x: number, y: number, w: number, h: number }; // 在截图中的 2D 区域
  }>;
}

export interface Shot {
  directing?: ShotDirecting;
  creativeDirection?: CreativeDirectionBindings;
  appearance?: ShotAppearance;
  imagePromptAppearanceHash?: string;
  videoPromptAppearanceHash?: string;
  id: string;
  soundDesign?: string;
  editingNote?: string;
  // Director's Brain (Storyboard)
  shotSize?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  focalLength?: string;
  lighting?: string;
  composition?: string;
  blocking?: string;
  continuityNote?: string;
  visualAction?: string;
  lightingAtmo?: string;
  duration?: number;
  /** Required when an editorial shot shorter than the normal standalone generation minimum is intentional. */
  shortDurationOverride?: {
    purpose: "flash_cut" | "insert" | "impact_frame" | "transition";
    reason: string;
  };
  motivation?: string;
  microExpression?: string; // High-density director's acting intent: precise physical muscle movements, eye focus and reactions
  /** Structured storyboard needs declared by upstream director/prep agents. */
  storyboardCapabilityIds?: string[];
  
  // Cinematographer's Brain (Prompts)
  imagePrompt?: string;
  videoPrompt?: string;
  visualSummary?: string;
  
  // Generated Assets & Metadata
  imageUrl?: string;
  videoUrl?: string;
  imageMedia?: MediaAssetReference;
  videoMedia?: MediaAssetReference;
  sourceStartSeconds?: number; // source media in-point, defaults to zero
  transition?: 'none' | 'fade' | 'black';
  characterIdsInShot?: string[];
  locationId?: string;
  propIds?: string[];
  vehicleIds?: string[];
  /** Project mixed-media layers intentionally active in this shot. */
  activeVisualLayerIds?: string[];
  dialogueLines?: {
    characterId?: string;
    delivery?: "on_screen" | "off_screen" | "voice_over" | "phone";
  speakerName?: string;
    text: string;
  }[];
  compositionData?: SpatialComposition;
  takes?: {
    id: string;
    imageUrl?: string;
    videoUrl?: string;
    imageMedia?: MediaAssetReference;
    videoMedia?: MediaAssetReference;
    generationAudit?: ManualStudioTakeAudit;
    appearanceSnapshot?: ShotAppearance;
    createdAt: number;
  }[];
  activeTakeId?: string;
  /**
   * A disposable direction preview. It is intentionally kept outside `takes`
   * so an unapproved image can never become formal production media by accident.
   */
  draftPreview?: {
    imageUrl: string;
    imageMedia?: MediaAssetReference;
    sourceHash: string;
    promptHash: string;
    modelId: string;
    referenceImageUrls: string[];
    /** Reproducible recipe, profile, source-revision, and target-selection audit. */
    visualStyleCompileManifest?: VisualCompileManifest;
    isProvisional: true;
    createdAt: number;
  };
  assetOverrides?: Record<string, string>; // Maps assetId to overrideReferenceUrl
  /** Sparse presentation/style override. It never replaces shot facts or asset identity. */
  visualOverride?: VisualLocalOverride;
  generationMetadata?: GenerationMetadata;
}

export interface ManualStudioTakeAudit {
  /** Source ranges at creation; later storyboard edits must not retime an existing take. */
  timeline?: { shotId: string; startSeconds: number; endSeconds: number }[];
  action: "generate_image" | "generate_video" | "import_image" | "import_video";
  targetKind: "shot" | "storyboard_panel" | "storyboard_board";
  shotId: string;
  boardId?: string;
  panelId?: string;
  pageId?: string;
  storyboardVisualTakeId?: string;
  sourceHash: string;
  /** A generated candidate stays reviewable when its source changes; it is never auto-adopted. */
  sourceReview?: {
    status: "current" | "review_recommended";
    reasons: Array<"project_source_updated" | "visual_style_updated">;
    detectedAt: number;
  };
  /** Prompt confirmed in the author-facing Prompt editor. */
  authorPrompt?: string;
  upstreamPromptSourceKind?: "shot" | "storyboard_unit";
  upstreamPromptSourceId?: string;
  upstreamPromptHash?: string;
  /** Exact prompt submitted after provider-specific motion compilation. */
  finalProviderPrompt?: string;
  promptHash: string;
  providerPromptHash?: string;
  /** How the provider prompt was prepared before the author confirmed it. */
  modelPromptSource?: "adapter" | "llm" | "author_edited";
  promptAuthoringModelLabel?: string;
  /**
   * A matching direction preview may guide a later formal image generation,
   * but remains provenance only and is never promoted into `takes`.
   */
  draftPreviewReference?: {
    imageUrl: string;
    sourceHash: string;
    promptHash: string;
  };
  providerType?: string;
  visualPromptLanguagePolicy?: "provider_default" | "zh" | "en" | "bilingual";
  videoMotionContract?: {
    motionStrength?: number;
    cameraPan?: number;
    cameraTilt?: number;
    cameraZoom?: number;
    cameraMotion?: string;
    subjectMotion?: string;
    startState?: string;
    endState?: string;
    durationSeconds?: number;
    loop?: boolean;
  };
  providerNativeVideoOptions?: Record<string, unknown>;
  videoAdapterId?: string;
  videoAdapterVersion?: string;
  videoGenerationMode?: string;
  videoResolution?: string;
  videoTaskId?: string;
  videoTaskProvider?: "minimax_h3" | "kie_grok" | "comfyui_h3";
  videoProviderTaskId?: string;
  videoTaskStatus?: "submitting" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
  videoIdempotencyKey?: string;
  videoCandidateIndex?: number;
  referenceManifest?: Array<{
    bindingId: string;
    providerLabel: string;
    mediaKind: "image" | "video" | "audio";
    sourceAssetId: string;
    semanticEntityId?: string;
    displayName?: string;
    purpose: string;
    mediaUrl: string;
    mediaDurationSeconds?: number;
  }>;
  /** Exact ordered image inputs and their declared responsibilities at provider submission time. */
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  /** Exact included/omitted prompt blocks submitted for image generation. */
  promptCompositionManifest?: PromptCompositionManifestAudit;
  /** Structured visual-style compilation used for this exact take. */
  visualStyleCompileManifest?: VisualCompileManifest;
  audioProvenance?: {
    source: "provider_native" | "reference_voice" | "full_dialogue_master" | "post_dub" | "imported" | "none";
    embeddedAudio: boolean;
    masterAudioAssetIds: string[];
    mustNotAutoDub: boolean;
  };
  audioRevision?: {
    operation: "stripped" | "replaced";
    originalVideoUrl: string;
    replacementAudioUrl?: string;
    createdAt: number;
  };
  interactiveVideoContext?: {
    graphVersionId: string;
    nodeId: string;
    contentSlot: "entry" | "main" | "choice_hold" | "exit";
    visualScenarioId: string;
    visualStateFingerprint: string;
    visualReuseFingerprint: string;
  };
  videoSegments?: Array<{
    url: string;
    durationSeconds: number;
    startFrameUrl?: string;
    endFrameUrl?: string;
  }>;
  modelId: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  selectedAssetIds: string[];
  selectedAssetBoardItemIds: string[];
  referenceImageUrls: string[];
  startFrameTakeId?: string;
  endFrameTakeId?: string;
  startFrameUrl?: string;
  endFrameUrl?: string;
  /** Interactive visual state frozen into this generated take. */
  visualScenarioId?: string;
  visualStateFingerprint?: string;
  visualReuseFingerprint?: string;
  createdAt: number;
}

export interface ScriptBlock {
  id: string;
  type: "scene_heading" | "action" | "character" | "dialogue" | "parenthetical" | "transition";
  content: string;
  emotion?: string; // Legacy or transitioned emotion tag. Use 'acting' for physical actions.
  acting?: string; // Physical acting instructions: e.g., "eyes darting, hands trembling"
  camera?: string; // For action/scene_heading
  linkedAssetId?: string; // ID of the linked asset from the library
  locationId?: string; // ID of the linked location asset
  propIds?: string[]; // IDs of the linked prop assets
  audioUrl?: string; // For TTS preview
  overrideVoiceId?: string;
  overrideVoiceParams?: Record<string, any>;
}

export interface ScriptBreakdown {
  assetVisualFacts?: Array<Omit<ProductionAssetVisualFact, 'sceneId'> & { assetType: 'character' | 'location' | 'prop'; name: string; assetId?: string }>;
  setting: "INT." | "EXT." | "INT./EXT.";
  location: string | { name: string; state?: string; assetId?: string };
  time: "DAY" | "NIGHT" | "DAWN" | "DUSK" | "CONTINUOUS";
  characters: (string | { name: string; state?: string; assetId?: string })[]; // Keep for backward compatibility or raw names
  props: (string | {
    name: string;
    state?: string;
    /** Only key cross-scene or identity-critical props become formal project assets. */
    requiresAsset?: boolean;
    assetReason?: string;
    assetId?: string;
  })[]; // Keep for backward compatibility or raw names
  characterIds?: string[];
  propIds?: string[];
  vehicleIds?: string[];
  locationId?: string;
  vfx?: string[];
  sfx?: string[];
  wardrobe?: string[];
  makeupHair?: string[];
  vehicles?: string[];
  extrasAtmosphere?: string[];
  specialEquipment?: string[];
  bgm?: { prompt: string; linkedAssetId?: string; description?: string }[];
  assetVariantMap?: Record<string, string>; // Maps assetId to variantId
}

export type ManualFilmTeamDepartment =
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

export interface ManualFilmTeamPromptAudit {
  action: "generate" | "regenerate" | "qa" | "optimize";
  templateId: string;
  promptHash: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  createdAt: number;
}

export interface ManualFilmTeamQA {
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  strengths: string[];
  coverage?: Array<{
    itemId: string;
    judgment: "grounded_fact" | "marked_proposal" | "marked_pending" | "boundary_clear" | "issue";
    outputEvidence: string;
    sourceEvidence: string;
    note: string;
  }>;
  issues: Array<{
    severity: "blocking" | "warning" | "advisory";
    sceneId?: string;
    description: string;
    suggestion: string;
    /** Stable locator for one independent field or array item in the reviewed output. */
    outputEvidenceId?: string;
    outputEvidence?: string;
    sourceEvidence?: string;
  }>;
  audit: ManualFilmTeamPromptAudit;
  reviewedAt: number;
}

export type ManualFilmTeamHandoffPriority = "blocking" | "review" | "advisory";

/** A directed request between specialist departments, not a user-facing loose note. */
export interface ManualFilmTeamHandoff {
  id: string;
  fromDepartment: ManualFilmTeamDepartment;
  toDepartments: ManualFilmTeamDepartment[];
  sceneId?: string;
  topic: string;
  request: string;
  priority: ManualFilmTeamHandoffPriority;
}

export interface ManualFilmTeamOutput {
  department: ManualFilmTeamDepartment;
  /** Adopted from a combined preparation plan; no departmental QA score is implied. */
  preparationOrigin?: "simple";
  /** Initial coordination establishes dependencies; a wrap coordination pass only closes explicit handoffs. */
  coordinationPhase?: "planning" | "wrap";
  /** Hash of the immutable script text for the selected episode or film segment. */
  sourceScriptHash: string;
  /** Hash of the formal scene list and confirmed structured breakdowns in this unit. */
  sourceBreakdownHash?: string;
  /** Hash of the whole imported script used as cross-unit continuity context. */
  fullScriptHash?: string;
  sourceSceneIds?: string[];
  taskSummary: string;
  /** Department-wide plan for the selected episode or film segment. */
  content: string;
  scenePlans?: ManualFilmTeamScenePlan[];
  openQuestions: string[];
  handoffNotes: string[];
  /** Structured handoffs routed to named departments. Legacy handoffNotes remain readable. */
  handoffs?: ManualFilmTeamHandoff[];
  /** Snapshot of relevant confirmed peer outputs used when this result was generated. */
  collaborationSourceHash?: string;
  collaborationSourceVersions?: Partial<Record<ManualFilmTeamDepartment, number>>;
  /** Stable semantic handoff ids already consumed by this department. */
  collaborationHandoffIds?: string[];
  status: "draft" | "ready_for_confirmation" | "needs_revision" | "confirmed";
  version: number;
  audit: ManualFilmTeamPromptAudit;
  qa?: ManualFilmTeamQA;
  updatedAt: number;
  confirmedAt?: number;
}

export interface ManualFilmTeamScenePlan {
  sceneId: string;
  sceneTitle: string;
  summary: string;
  executionNotes: string[];
  assetNeeds: string[];
  continuityNotes: string[];
  handoffNotes: string[];
}

/** Legacy scene-owned workspace retained only for existing imported projects. */
export interface ManualFilmTeamSceneWorkspace {
  schemaVersion: "manual-film-team.v1";
  sceneId: string;
  sourceScriptHash: string;
  outputs: ManualFilmTeamOutput[];
  updatedAt: number;
}

export interface ManualFilmTeamWorkspace {
  schemaVersion: "manual-film-team.v2";
  episodeId: string;
  sourceDocumentId?: string;
  sourceScriptHash: string;
  sourceBreakdownHash: string;
  fullScriptHash: string;
  sourceSceneIds: string[];
  outputs: ManualFilmTeamOutput[];
  updatedAt: number;
}

export type SimplePreparationKind = "creative" | "assets" | "action";

export interface SimplePreparationScenePlan {
  sceneId: string;
  notes: Record<string, string[]>;
  assetIds: string[];
}

export interface SimplePreparationPlan {
  kind: SimplePreparationKind;
  shared: Record<string, string[]>;
  scenes: SimplePreparationScenePlan[];
  openQuestions: string[];
  audit: ManualFilmTeamPromptAudit;
  updatedAt: number;
}

export interface SimplePreparationReview {
  summary: string;
  reviewedSceneIds: string[];
  issues: Array<{
    id: string;
    kind: SimplePreparationKind;
    sceneIds: string[];
    severity: "blocking" | "warning" | "advisory";
    description: string;
    suggestion: string;
    sourceEvidence: string;
    dismissed?: boolean;
    stale?: boolean;
  }>;
  sourceFingerprint: string;
  audit: ManualFilmTeamPromptAudit;
  updatedAt: number;
}

export interface SimplePreparationWorkspace {
  plans: Partial<Record<SimplePreparationKind, SimplePreparationPlan>>;
  review?: SimplePreparationReview;
  /** Previous adopted data remains recoverable when combined plans replace it. */
  history: Array<{ at: number; kind: SimplePreparationKind; plan?: SimplePreparationPlan; outputs: ManualFilmTeamOutput[] }>;
}

export interface ManualProductionAssetApproval {
  boardItemId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  variantId?: string;
  promptHash: string;
  status: "confirmed";
  sourceSceneIds: string[];
  sourceDepartmentPackageIds: string[];
  confirmedAt: number;
  updatedAt: number;
}

/** Per-call provenance; requestedModelId is configuration intent, never evidence of execution. */
export interface AIExecutionProvenance {
  source: "manual_external" | "api";
  provider: string;
  modelId: string;
  requestedModelId?: string;
}

export interface ManualProductionAssetReferenceAudit {
  candidateId?: string;
  boardItemId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  variantId?: string;
  imageUrl: string;
  source: "ai_generation" | "upload" | "existing";
  sourceRunId?: string;
  promptHash?: string;
  finalPrompt?: string;
  modelId?: string;
  executionProvenance?: AIExecutionProvenance;
  inputReferenceUrl?: string;
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  promptCompositionManifest?: PromptCompositionManifestAudit;
  visualStyleCompileManifest?: VisualCompileManifest;
  /** Exact canonical board, identity/variant, and visual-style inputs used when this image became a candidate. */
  sourceContentHash?: string;
  /** Adoption remains explicit when the source changed; this audit records the review recommendation without blocking it. */
  sourceReview?: {
    status: "current" | "review_recommended";
    reasons: Array<"source_updated" | "source_fingerprint_missing">;
    candidateSourceContentHash?: string;
    currentSourceContentHash: string;
    detectedAt: number;
  };
  selectedSkillIds: string[];
  selectedSkillTitles?: string[];
  selectedContextIds: string[];
  layoutContractId?: string;
  referenceMode?: "production_board" | "clean_reference";
  quality?: ManualStoryboardAgentQuality;
  review?: {
    executionProvenance?: AIExecutionProvenance;
    mode: "automatic" | "manual";
    status: "approved" | "pending";
    reviewedAt?: number;
  };
  sourceSceneIds: string[];
  generatedAt?: number;
  adoptedAt?: number;
  adoptedBy?: "user";
  createdAt: number;
  updatedAt: number;
}

export interface ManualProductionAssetReferenceCandidate extends Omit<
  ManualProductionAssetReferenceAudit,
  "candidateId" | "generatedAt" | "adoptedAt" | "adoptedBy" | "sourceReview" | "createdAt" | "updatedAt"
> {
  id: string;
  status: "pending_review";
  createdAt: number;
  updatedAt: number;
}

export interface ManualProductionAssetVariantAudit {
  variantId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  sourceSceneId: string;
  sourceSceneIds?: string[];
  preparationBatchId?: string;
  stateSummaryHash: string;
  promptHash: string;
  finalPrompt?: string;
  modelId?: string;
  reason?: string;
  evidence?: string;
  selectedSkillIds: string[];
  selectedSkillTitles?: string[];
  selectedContextIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ManualProductionAssetPreparationDecisionAudit {
  sceneId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  use: "base" | "variant";
  variantId?: string;
  variantKey?: string;
  reason: string;
  evidence: string;
}

export interface ManualProductionAssetPreparationBatchAudit {
  id: string;
  episodeIds: string[];
  templateId: "productionAssetPreparationBatch";
  workflowStepId?: string;
  sourceHash: string;
  promptHash: string;
  finalPrompt: string;
  modelId: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  changedProfileAssetIds: string[];
  variantIds: string[];
  decisions: ManualProductionAssetPreparationDecisionAudit[];
  reviewScore: number;
  reviewVerdict: "pass" | "needs_revision";
  reviewSummary: string;
  reviewIssues: Array<{
    severity: "blocking" | "warning" | "advisory";
    targetType: "profile" | "state" | "continuity" | "coverage";
    targetId: string;
    description: string;
    suggestion: string;
  }>;
  reviewAttempts: Array<{
    attempt: number;
    promptHash: string;
    finalPrompt: string;
    modelId: string;
    score: number;
    verdict: "pass" | "needs_revision";
    summary: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface ManualProductionAssetProfileRevisionAudit {
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  templateId: string;
  workflowStepId?: string;
  promptHash: string;
  finalPrompt: string;
  modelId: string;
  executionProvenance?: AIExecutionProvenance;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  changedFields: string[];
  beforeValues: Record<string, unknown>;
  adoptedValues: Record<string, unknown>;
  evidence?: string[];
  assumptions?: string[];
  reviewScore?: number;
  reviewVerdict?: "pass" | "needs_revision";
  reviewSummary?: string;
  reviewIssues?: Array<{
    severity: "blocking" | "warning" | "advisory";
    field: string;
    description: string;
    suggestion: string;
  }>;
  reviewAttempts?: Array<{
    attempt: number;
    promptHash: string;
    finalPrompt: string;
    modelId: string;
    executionProvenance?: AIExecutionProvenance;
    score: number;
    verdict: "pass" | "needs_revision";
    summary: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

export interface ManualProductionAssetRegistry {
  schemaVersion: "manual-production-assets.v1";
  approvals: ManualProductionAssetApproval[];
  references?: ManualProductionAssetReferenceAudit[];
  pendingReferences?: ManualProductionAssetReferenceCandidate[];
  variants?: ManualProductionAssetVariantAudit[];
  profileRevisions?: ManualProductionAssetProfileRevisionAudit[];
  preparationBatches?: ManualProductionAssetPreparationBatchAudit[];
  updatedAt: number;
}

export type ManualStoryboardAction =
  | "generate_shots"
  | "generate_image_prompts"
  | "generate_video_prompts"
  | "qa_shots"
  | "qa_image_prompts"
  | "qa_video_prompts"
  | "select_board_strategy"
  | "generate_board"
  | "qa_board";

export type ManualStoryboardAgentExecutionAction = "generate" | "qa" | "repair";

export interface ManualStoryboardAgentExecutionAudit {
  action: ManualStoryboardAgentExecutionAction;
  prompt: string;
  promptHash: string;
  modelId: string;
  status: "succeeded" | "failed";
  resultHash?: string;
  issueSummary?: string[];
  score?: number;
  verdict?: "pass" | "revise";
  startedAt: number;
  completedAt: number;
  error?: string;
}

export interface ManualStoryboardAgentQuality {
  /** Absent on legacy independent model reviews. Author review never counts as independent QA. */
  reviewKind?: "independent" | "author_self_review";
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  strengths: string[];
  issues: Array<{
    severity: "blocking" | "warning" | "advisory";
    targetShotId?: string;
    targetPanelId?: string;
    description: string;
    suggestion: string;
  }>;
}

export interface ManualStoryboardPromptAudit {
  id?: string;
  action: ManualStoryboardAction;
  templateId: string;
  promptHash: string;
  modelId: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  createdAt: number;
  confirmedPrompt?: string;
  promptExecutions?: ManualStoryboardAgentExecutionAudit[];
  agentQuality?: ManualStoryboardAgentQuality;
}

export interface ManualStoryboardStepRecord {
  sourceHash: string;
  outputHash: string;
  audit: ManualStoryboardPromptAudit;
  qa?: ManualStoryboardAgentQuality;
  adoptedAt: number;
  confirmedAt?: number;
}

export interface ManualStoryboardStrategyResolution {
  mode: "built_in_preset" | "composed_recipe" | "project_local_draft_required";
  primaryStrategyId: string;
  modifierStrategyIds: string[];
  requiredCapabilityIds: string[];
  coveredCapabilityIds: string[];
  uncoveredCapabilityIds: string[];
  fallbackStrategyId: string;
  confidence: number;
  requiresHumanApproval: boolean;
  maxAutomaticRevisionAttempts: 1;
}

export interface ManualStoryboardStrategyDecision {
  selectedStrategyId: string;
  selectedStrategyVersion: string;
  selectedModelProfileId: string;
  rationale: string;
  rejectedStrategyIds: string[];
  riskNotes: string[];
  expectedBoardShape: string;
  expectedVideoUnitDurationSeconds: number;
  expectedReferenceImageCount: number;
  expectedReferenceVideoCount: number;
  arrowLegendIds: string[];
  qaChecklist: string[];
  strategyResolution?: ManualStoryboardStrategyResolution;
}

export interface ManualStoryboardBoardPanel {
  id: string;
  panelNumber: number;
  shotId: string;
  durationSeconds?: number;
  framePurpose: string;
  shotType?: string;
  visualBeat?: string;
  cameraNote?: string;
  framing?: string;
  lens?: string;
  angle?: string;
  cameraMove?: string;
  subjectAction?: string;
  blocking?: string;
  lightingCue?: string;
  soundCue?: string;
  emotionCue?: string;
  compositionNote?: string;
  continuityIn?: string;
  continuityOut?: string;
  assetRefs: string[];
  annotationLegendIds: string[];
  actionArrowLegendIds: string[];
  dialogueOrSoundCue?: string;
  renderInstruction?: string;
  visualTakes?: ManualStoryboardPanelVisualTake[];
  activeVisualTakeId?: string;
}

export interface ManualStoryboardPanelVisualTake {
  id: string;
  imageUrl: string;
  imageMedia?: MediaAssetReference;
  sourceHash: string;
  prompt: string;
  promptHash: string;
  modelId: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  selectedAssetBoardItemIds: string[];
  referenceImageUrls: string[];
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  promptCompositionManifest?: PromptCompositionManifestAudit;
  visualStyleCompileManifest?: VisualCompileManifest;
  attempt: number;
  status: "candidate" | "adopted" | "rejected" | "stale";
  quality?: ManualStoryboardAgentQuality;
  review?: {
    mode: "automatic" | "manual";
    status: "pending" | "approved" | "rejected";
    reviewer?: "creator";
    notes?: string;
    reviewedAt?: number;
  };
  executions: ManualStoryboardAgentExecutionAudit[];
  createdAt: number;
  adoptedAt?: number;
}

/**
 * A visual take for a complete multi-panel storyboard page. Panel-level takes
 * remain readable for legacy workspaces, but only page-level takes can become
 * the formal storyboard control image used by a VideoGenerationUnit.
 */
export interface ManualStoryboardBoardVisualTake {
  id: string;
  /** Raw model output without deterministic headers, footers, labels, or overlays. */
  sourceImageUrl?: string;
  sourceImageMedia?: MediaAssetReference;
  /** Clean multi-panel model input containing only the deterministic panel numbers. */
  videoReferenceImageUrl?: string;
  /** Source of the adopted Shot images used for the deterministic grid. */
  videoReferenceSourceHash?: string;
  videoReferenceImageMedia?: MediaAssetReference;
  imageUrl: string;
  imageMedia?: MediaAssetReference;
  sourceHash: string;
  prompt: string;
  promptHash: string;
  modelId: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  selectedAssetBoardItemIds: string[];
  referenceImageUrls: string[];
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  promptCompositionManifest?: PromptCompositionManifestAudit;
  visualStyleCompileManifest?: VisualCompileManifest;
  panelIds: string[];
  attempt: number;
  status: "candidate" | "adopted" | "rejected" | "stale";
  quality?: ManualStoryboardAgentQuality;
  review?: {
    mode: "automatic" | "manual";
    status: "pending" | "approved" | "rejected";
    reviewer?: "creator";
    notes?: string;
    reviewedAt?: number;
  };
  executions: ManualStoryboardAgentExecutionAudit[];
  createdAt: number;
  adoptedAt?: number;
}

export interface ManualStoryboardBoardVisualPage {
  id: string;
  pageIndex: number;
  pageCount: number;
  layout: string;
  annotationMode: "director_annotated_sheet" | "model_control_sheet";
  panelIds: string[];
  visualTakes?: ManualStoryboardBoardVisualTake[];
  activeVisualTakeId?: string;
  /** Deterministic grids composed from adopted Shot images, independent of director-board reviews. */
  shotGridTakes?: ManualStoryboardShotGridTake[];
  activeShotGridTakeId?: string;
}

export interface ManualStoryboardShotGridTake {
  id: string;
  imageUrl: string;
  imageMedia?: MediaAssetReference;
  sourceHash: string;
  layout: string;
  cells: ManualStoryboardShotCell[];
  source: "adopted_shot_composition";
  createdAt: number;
}

export interface ManualStoryboardShotCell {
  shotId: string;
  order: number;
  imageUrl?: string;
  imageTakeId?: string;
  contentHash?: string;
  status: "ready" | "missing";
}

export type StoryboardVisualReferenceMode = "shot_grid" | "director_board";

export interface ManualStoryboardPerformanceBeat {
  id: string;
  episodeId: string;
  sceneId: string;
  shotId: string;
  scriptBlockIds: string[];
  beatType: "dialogue" | "action" | "combat" | "emotion" | "reveal" | "transition" | "interactive_idle";
  summary: string;
  visibleChange: string;
  startState: string;
  endState: string;
  durationSeconds: number;
  characterIds: string[];
  locationId?: string;
  propIds: string[];
  soundCues: string[];
  continuityIn: string;
  continuityOut: string;
}

export interface ManualStoryboardBoard {
  id: string;
  episodeId: string;
  sceneId: string;
  shotId: string;
  strategyDecision: ManualStoryboardStrategyDecision;
  boardMode: string;
  layout: string;
  lineArtPrompt: string;
  arrowLegendIds: string[];
  performanceBeatIds: string[];
  scriptBlockIds: string[];
  shotIds: string[];
  videoGenerationUnitId?: string;
  /** Creator-selected reference representation; never inferred from a provider or model id. */
  visualReferenceMode?: StoryboardVisualReferenceMode;
  /** One deterministic clean-grid cell per Shot, in unit reading order. */
  shotCellManifest?: ManualStoryboardShotCell[];
  visualPages?: ManualStoryboardBoardVisualPage[];
  strategyOrigin: "built_in";
  panels: ManualStoryboardBoardPanel[];
  startState: string;
  endState: string;
}

export interface ManualStoryboardBoardQA {
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  strengths: string[];
  issues: Array<{
    severity: "blocking" | "warning" | "advisory";
    description: string;
    suggestion: string;
  }>;
  sourceHash: string;
  audit: ManualStoryboardPromptAudit;
  reviewedAt: number;
}

export interface ManualStoryboardQA {
  /** Distinguishes automated QA from an explicit creator save/approval. */
  reviewOrigin?: "agent" | "author_confirmation";
  score: number;
  verdict: "pass" | "revise";
  summary: string;
  strengths: string[];
  issues: Array<{
    severity: "blocking" | "warning" | "advisory";
    targetShotId?: string;
    description: string;
    suggestion: string;
  }>;
  sourceHash: string;
  audit: ManualStoryboardPromptAudit;
  reviewedAt: number;
  confirmedAt?: number;
}

export interface ManualStoryboardUnitVideoPrompt {
  text: string;
  /** Structural lineage; effective stale state is computed against the current source hash. */
  sourceHash: string;
  source: "derived" | "author_edited" | "ai_rewritten";
  status: "ready" | "stale";
  audit?: ManualStoryboardPromptAudit;
  confirmedAt?: number;
  updatedAt: number;
}

export interface ManualStoryboardBoardWorkflow {
  id: string;
  unitSchema?: "storyboard_unit.v1";
  /** Stable StoryboardUnit board identity. */
  boardId?: string;
  /** One workflow maps to one video generation unit and may cover many shots. */
  videoGenerationUnitId?: string;
  /** Execution preference only. Changing it must not rewrite or stale the storyboard. */
  targetVideoModelConfigId?: string;
  shotIds?: string[];
  /** Primary Shot used for existing shot-scoped planning and editing APIs. */
  shotId: string;
  strategyDecision?: ManualStoryboardStrategyDecision;
  strategyRecord?: ManualStoryboardStepRecord;
  performanceBeat?: ManualStoryboardPerformanceBeat;
  /** Complete beat set for composite video units. */
  performanceBeats?: ManualStoryboardPerformanceBeat[];
  board?: ManualStoryboardBoard;
  boardRecord?: ManualStoryboardStepRecord;
  qa?: ManualStoryboardBoardQA;
  /** Model-independent canonical prompt for this ordered StoryboardUnit. */
  unitVideoPrompt?: ManualStoryboardUnitVideoPrompt;
  /** Generation attempts for this persisted StoryboardUnit. */
  takes?: Array<{
    id: string;
    imageUrl?: string;
    videoUrl?: string;
    imageMedia?: MediaAssetReference;
    videoMedia?: MediaAssetReference;
    generationAudit?: ManualStudioTakeAudit;
    createdAt: number;
  }>;
  activeTakeId?: string;
  /** Retains provenance when an author explicitly merges or splits units. */
  unitLineage?: {
    sourceUnitIds: string[];
    sourceTakeIds: string[];
  };
  confirmedAt?: number;
  updatedAt: number;
}

export interface ManualStoryboardWorkspace {
  directorPlan?: SceneDirectorPlan;
  schemaVersion: "manual-storyboard.v1";
  /** Creator-selected default for StoryboardUnits created in this scene. */
  defaultVisualReferenceMode?: StoryboardVisualReferenceMode;
  shotPlan?: ManualStoryboardStepRecord;
  imagePrompts?: ManualStoryboardStepRecord;
  videoPrompts?: ManualStoryboardStepRecord;
  /** @deprecated Old combined prompt lineage is ignored by the current read model. */
  visualPrompts?: ManualStoryboardStepRecord;
  qa?: ManualStoryboardQA;
  boards?: ManualStoryboardBoardWorkflow[];
  batchAudits?: ManualStoryboardPromptAudit[];
  updatedAt: number;
}

export interface ProductionPreparationPromptAudit {
  templateId: string;
  promptHash: string;
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  selectedContextIds: string[];
  createdAt: number;
}

export interface ProductionPreparationPromptExecutionAudit extends ProductionPreparationPromptAudit {
  action: "generate" | "qa" | "repair" | "recheck";
  prompt: string;
  status: "succeeded" | "failed";
  resultHash?: string;
  completedAt: number;
  error?: string;
}

export interface ProductionPreparationStageRecord {
  status: "confirmed" | "stale" | "needs_revision";
  sourceHash: string;
  promptAudit?: ProductionPreparationPromptAudit;
  promptExecutions?: ProductionPreparationPromptExecutionAudit[];
  qa?: {
    score: number;
    verdict: "pass" | "revise";
    summary: string;
    checks?: Array<{
      checkId?: string;
      dimension: string;
      subject: string;
      status: "pass" | "blocking" | "warning" | "advisory";
      sourceEvidence: string;
      candidateEvidence: string;
      sourceRefs?: string[];
      coveredSubjects?: string[];
    }>;
    issues: Array<{ severity: "blocking" | "warning" | "advisory"; description: string; suggestion: string; checkIds?: string[] }>;
    audit: ProductionPreparationPromptAudit;
    reviewedAt: number;
  };
  confirmedAt?: number;
}

export type ProductionPreparationAssetType = "character" | "location" | "prop" | "vehicles";

/** Author-owned scene binding that takes precedence over automatic name matching. */
export interface ProductionPreparationAssetBinding {
  assetType: ProductionPreparationAssetType;
  sourceAssetId: string;
  sourceAssetName: string;
  targetAssetId: string;
  targetAssetName: string;
  boundAt: number;
}

export interface ProductionPreparationWorkspace {
  schemaVersion: "production-preparation.v1";
  sceneId: string;
  assetBindings?: ProductionPreparationAssetBinding[];
  breakdown?: ProductionPreparationStageRecord;
  assetPack?: { sourceHash: string; confirmedAt: number };
  coordination?: { sourceHash: string; confirmedAt: number };
  updatedAt: number;
}

export interface Scene {
  creativeDirection?: CreativeDirectionBindings;
  id: string;
  shotHistory?: Array<{ at: number; shots: Shot[]; audioTracks?: AudioTrack[]; manualStoryboard?: ManualStoryboardWorkspace }>;
  // Stable provenance for a system-writing export. Production uses this only to
  // surface structured upstream facts; it never writes back to the Writing copy.
  sourceWritingUnitId?: string;
  sourceWritingSceneId?: string;
  sourceDocumentId?: string;
  sourceEvidence?: string;
  sourceNodeId?: string; // 继承自互动模式的原始 GameNode，保证逻辑链路追踪
  sceneNumber?: string; // Formal scene numbering (e.g., "1", "1A", "2")
  revision?: string; // Revision tracking (e.g., "White Draft", "Blue Draft")
  title: string;
  description: string;
  valueCharge: "positive" | "negative" | "neutral";
  valueShift?: {
    from: string;
    to: string;
    reason: string;
  };
  hook?: string;
  cliffhanger?: string; // For Short Drama paywall/cliffhanger
  targetDuration?: number; // Target duration in minutes
  storyLine?: 'A-Story' | 'B-Story' | 'C-Story'; // For TV Series multi-thread narrative
  script?: string;
  scriptBlocks?: ScriptBlock[];
  shots?: Shot[];
  audioTracks?: AudioTrack[];
  breakdown?: ScriptBreakdown;
  productionPreparation?: ProductionPreparationWorkspace;
  /** @deprecated Department preparation is now owned by the source unit. */
  productionTeam?: ManualFilmTeamSceneWorkspace;
  manualStoryboard?: ManualStoryboardWorkspace;
  sceneGoal?: string;
  /** Scene-level storyboard needs; shot-level declarations may add narrower controls. */
  storyboardCapabilityIds?: string[];
  sceneAssets?: string;
  environment?: "INT." | "EXT." | "INT./EXT."; // 空间属性 (内景/外景)
  timeOfDay?: "DAY" | "NIGHT" | "DAWN" | "DUSK" | "CONTINUOUS" | string; // 时间属性
  generationMetadata?: GenerationMetadata;
  interactiveMetadata?: {
    /** Locked graph nodes served by this shared production scene. */
    nodeIds?: string[];
    storyEpisodeIds?: string[];
    storyEpisodeTitles?: string[];
    storyChapterIds?: string[];
    storyChapterTitles?: string[];
    incomingContext?: string;
    outgoingContext?: string;
    outboundChoices?: {
      label: string;
      targetNodeId: string;
      intent?: string;
      timeoutSeconds?: number;
      defaultTimeoutTargetNodeId?: string;
    }[];
    readVariables?: string[];
    writeVariables?: string[];
    requiredFacts?: string[];
    producedFacts?: string[];
    isEnding?: boolean;
    graphVersionId?: string;
    visualProjectionId?: string;
    visualProjectionFingerprint?: string;
    activeVisualScenarioId?: string;
    visualScenarios?: Array<{
      id: string;
      label: string;
      shotPromptDelta: string;
      reuseFingerprint: string;
      stateFingerprint: string;
      observableFacts: string[];
      observableVariables?: Record<string, boolean | number | string>;
      canonicalAssetRefs: string[];
      characterVariantRefs: string[];
      assetVariantRefs: string[];
      environmentChanges: string[];
      performanceConstraints: string[];
    }>;
  };
  overrideSkills?: UniversalSkillReference[]; // Scene-level universal Skill prompt text.
  multiGrid?: {
    prompt?: string;
    imageUrl?: string;
    videoUrl?: string;
    videoPrompt?: string;
    shotIds?: string[];
  };
  diagnosisResults?: NarrativeHealthReport;
  qcReport?: ResonanceQCReport;
}

export interface Arc {
  id: string;
  name: string;
  description: string;
}

export interface EpisodeMeta {
  creativeDirection?: CreativeDirectionBindings;
  id: string;
  /** Persistent production content version used by conditional episode saves. */
  productionRevision?: number;
  title: string;
  inspiration: string;
  /** Stable Writing provenance retained independently from the production source document. */
  sourceWritingUnitId?: string;
  arcId?: string;
  targetDuration?: number;
  sceneCount?: number;
  characterIds?: string[];
  locationIds?: string[];
  sourceDocumentId?: string;
}

export interface Episode extends EpisodeMeta {
  scenes: Scene[];
  /** Episode or film-segment department preparation package. */
  productionTeam?: ManualFilmTeamWorkspace;
  preparationMode?: "simple" | "professional";
  simplePreparation?: SimplePreparationWorkspace;
  gameData?: any; // To store GameProjectData when orchestrating this episode in interactive mode
}

export interface ProductionAssetVisualFact {
  sceneId: string;
  description: string;
  evidence: string;
  scope: 'identity' | 'scene';
}

export interface Asset {
  aliases?: string[];
  visualFacts?: ProductionAssetVisualFact[];
  visualDesignNeedsReview?: boolean;
  creativeDirection?: CreativeDirectionBindings;
  creativeStyleVersions?: CreativeStyleVersion[];
  activeCreativeStyleVersionId?: string;
  id: string;
  type: "character" | "location" | "prop" | "vfx" | "sfx" | "wardrobe" | "makeupHair" | "vehicles" | "extrasAtmosphere" | "specialEquipment" | "bgm";
  name: string;
  description: string;
  prompt?: string;
  imageUrl?: string;
  /** Generated previews awaiting an explicit human adoption action. */
  visualImageCandidates?: VisualImageCandidate[];
  /** Immutable audit snapshots retained after a generated candidate is adopted. */
  visualImageAdoptionAudits?: VisualImageAdoptionAudit[];
  /** Editable prompt for the canonical scene/prop board. */
  boardPrompt?: string;
  /** Adopted canonical scene/prop-board image used by downstream reference packs. */
  boardImageUrl?: string;
  /** Text-free model reference preferred by image and video generation models. */
  cleanReferenceImageUrl?: string;
  /** Editable prompt for the text-free model reference. */
  cleanReferencePrompt?: string;
  panoramaPrompt?: string;
  panoramaUrl?: string;
  multiViewPrompt?: string;
  multiViewUrl?: string;
  model3dUrl?: string; // 3D Low-Poly Model URL
  tags?: string[];
  variants?: AssetVariant[];
  defaultVariantId?: string;
  globalAssetId?: string;
  defaultReferenceUrl?: string;
  /** Sparse visual execution choices; character mirror assets must not duplicate this field. */
  visualOverride?: VisualLocalOverride;
}

export type AssetRefSource = "character" | "character_mirror_asset" | "asset" | "legacy_name";

export interface AssetRef {
  type: Asset["type"];
  id: string;
  canonicalId: string;
  source: AssetRefSource;
  displayName: string;
  rawId?: string;
  mirroredAssetId?: string;
}

export interface GlobalLook {
  baseTexture: string[];
  colorGrading: string[];
  conditionalEffects: {
    tag: string;
    condition: string;
  }[];
}

export interface VisualStyleLock extends VisualStyleLockV3Fields {
  renderingMode?: string; // e.g. live_action, photoreal, 2d_animation, 3d_animation, anime, comic, stylized
  stylePrompt?: string;
  styleKeywords?: string[];
  referenceWorks?: string;
  colorPalette?: string[];
  allowedHex?: string[];
  forbiddenColors?: string[];
  colorTemperature?: string[];
  saturation?: string;
  contrast?: string;
  texture?: string[];
  mediumSurface?: string[];
  finalRenderIntent?: string;
  linework?: string[];
  sketchDensity?: string;
  strokeWeight?: string;
  finishLevel?: string;
  lighting?: string[];
  lightSourceLogic?: string[];
  conditionalLighting?: string[];
  practicalLightRules?: string[];
  cameraLanguage?: string;
  lensBias?: string[];
  movementBias?: string[];
  framingBias?: string[];
  depthOfField?: string;
  grain?: string[];
  noiseFloor?: string;
  materialRendering?: string[];
  compositionRules?: string[];
  negativeSpaceRules?: string[];
  foregroundRules?: string[];
  readabilityRules?: string[];
  annotationLegend?: {
    id: string;
    marker: string;
    meaning: string;
    appliesTo?: string[];
  }[];
  boardAnnotationPolicy?: string;
  assetBoardStylePolicy?: string;
  storyboardStylePolicy?: string;
  effectLookPolicy?: string;
  noSourceCopyRules?: string[];
  driftGuards?: string[];
  styleSourceRefs?: string[];
  analysisConfidence?: number;
  humanApprovalState?: "draft" | "pending_review" | "approved" | "rejected";
  version?: string;
  negativeStyleRules?: string[];
  source?: "project_creation" | "creative_vision" | "style_skill" | "video_analysis" | "style_reference_analysis" | "manual" | "operator";
  lockedAt?: number;
}

export type ProjectProductionMode = ProjectType | "interactive" | "ai-video-sample";

export type ProjectLockStrategy =
  | "full_script"
  | "full_series"
  | "episode_block"
  | "scene_range"
  | "sequence"
  | "node_block"
  | "chapter_block";

export interface ProjectTargetScale {
  label?: string;
  episodeCount?: number;
  sceneCount?: number;
  nodeCount?: number;
  durationMinutes?: number;
  productionBlockSize?: number;
}

export interface StyleVariantPolicy {
  allowLocalStyleVariants?: boolean;
  requiresStyleVariantId?: boolean;
  allowedScopes?: Array<"project" | "episode" | "scene" | "node" | "sequence" | "sample">;
  fallbackRule?: string;
}

export interface CreativeVision {
  genre: string[];
  visualStyle: string;
  narrativeStyle: string;
  referenceWorks: string;
  want?: string;
  need?: string;
  stakes?: string;
  oppositionForce?: string;
  themeQuestion?: string;
  protagonistArc?: string;
  emotionalReward?: string;
  globalLookTags?: string; // Legacy
  globalLook?: GlobalLook;
}

export interface BeatTemplate {
  id: string;
  name: string;
  description: string;
  instruction: string;
  fixedCount?: number;
  applicableFormats?: string[];
  applicableStages?: Array<"skeleton" | "beat" | "scene">;
  createdForProjectType?: string;
  createdForProjectModel?: "linear" | "interactive";
  referenceWork?: string;
  referenceDnaRelation?: "hard" | "soft" | "disabled" | "unspecified";
  outputSchemaSummary?: string;
  variables?: string[];
  topicKeywords?: string[];
  createdAt?: number;
}

// 1. 扩展后的叙事节拍模板 (由拉片引擎生成)
export interface ExtractedBeatTemplate {
  id: string;
  sourceVideoName: string;
  globalTone: string; // 整体基调 (如: 压抑后爆发)
  plugins?: any[];
  
  // 核心节拍轴 (时间切片)
  beats: Array<{
    timeRange: string;
    beatName: string;
    
    // 【通用基座指标】
    baseMetrics: {
      emotionStart: number; // -10 到 10
      emotionEnd: number;   // -10 到 10
      conflictType: "physical" | "verbal" | "psychological";
      pacingSpeed: "slow" | "fast" | "frenetic";
    };
    
    // 【高级插件区】(可能为空)
    appliedTechniques?: Array<{
      name: "Inside" | "TickingClock" | "MacGuffin" | "Irony";
      description: string; // 原片如何使用该技巧的简述
    }>;
  }>;
  
  // 剥离出来的纯视觉参考 (传给 Visual Brain)
  directingReference?: {
    colorPalette?: string;
    cameraMovement?: string;
    shotSizePreference?: string;
    lightingStyle?: string;
  };
  referenceGovernance?: ReferenceGovernanceMetadata;
}

// 2. 质检法官返回的数据协议 (用于 UI 高亮)
export interface ResonanceQCReport {
  overallResonanceScore: number; // 0-100 相似度得分
  failedBaseMetrics: boolean; // 是否存在没有情绪起伏的废戏
  
  issues: Array<{
    severity: "warning" | "error";
    type: "基座失效(流水账)" | "节拍偏移(太拖沓)" | "插件缺失(未触发 Inside)";
    exactQuote: string; // 必须是剧本原文，用于前端精准高亮
    diagnosticReason: string; // 为什么不像？
    actionableSuggestion: string; // 建议怎么改？
  }>;
}

export interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description: string;
  dynamics?: Record<string, string | number>;
}

export interface WorldBuildingRule {
  id: string;
  category: string;
  content: string;
}

export interface StoryCard {
  id: string;
  title: string;
  content: string;
  type: 'action' | 'character' | 'theme' | 'climax' | 'twist';
  position: { x: number; y: number };
  act: 1 | 2 | 3;
  connectedCardIds: string[];
  color?: string;
  linkedSceneId?: string;
}

export interface Hook {
  id: string;
  setupSceneId: string;
  setupContent: string;
  payoffSceneId?: string;
  payoffContent?: string;
  isResolved: boolean;
  type: 'prop' | 'dialogue' | 'event';
}

export interface ScriptConstraint {
  id: string;
  description: string;
  impactedCharacters: string[];
  impactedLocations: string[];
  status: 'active' | 'solved';
  solution?: string;
}

export interface AudienceReport {
  timestamp: number;
  segments: {
    name: string;
    score: number; // 0-100
    feedback: string[];
  }[];
  overallImpact: number;
}

export interface DiagnosticIssue {
  level: 'warning' | 'error';
  type: string;
  exactQuote: string;
  suggestion: string;
}

export interface NarrativeHealthReport {
  score: string | number;
  level: string;
  issues: (string | DiagnosticIssue)[];
  compliments: string[];
  summary: string;
}

export interface NarrativeEnhancementOption {
  direction: string;
  content: string;
  pitch: string;
}

export interface NarrativeEnhancementResult {
  options: NarrativeEnhancementOption[];
}

export interface InteractiveGameConfig {
  scale: 'light' | 'standard' | '3a';
  playDurationMin: number;
  explorationDurationMin: number;
  targetNodeCount: number;
  targetEndingCount: number;
}

export interface PlannedAsset {
  id: string;
  name: string;
  type: 'location' | 'prop';
  brief: string;
  isDetailed: boolean;
}

export interface PlannedCharacter {
  id: string; // 唯一ID
  name: string; // 暂定名称或代号 (如：“神秘的反派”)
  roleType: 'lead' | 'supporting' | 'extra';
  brief: string; // 大致描述/画像特质
  isDetailed: boolean; // 是否已经为其生成过详细的 Character 档案
}

export interface LongFormMemoryPhase {
  id: string;
  episodes: string;
  title: string;
  promise: string;
  status?: string;
  entryState?: string;
  exitState?: string;
  requiredPayoffs?: string[];
}

export interface LongFormProductionMemory {
  handbookVersion?: string;
  updatedAt?: number;
  commercialMemory?: Record<string, any>;
  skeletonMemory?: {
    seriesPromise100?: string;
    seasonPromise?: string;
    actMap?: string[];
    phaseMap?: LongFormMemoryPhase[];
    relationshipArc?: string;
    payoffMap?: string[];
    finaleContract?: string;
    [key: string]: any;
  };
  continuityMemory?: {
    currentPhase?: string;
    protagonistState?: string;
    partnerState?: string;
    relationshipStage?: string;
    sectState?: string;
    powerLedger?: Record<string, any>;
    propOwnership?: Record<string, any>;
    forbiddenContradictions?: string[];
    shotContinuityRule?: string;
    [key: string]: any;
  };
  episodeMemory?: Record<string, any>;
  sceneMemory?: Record<string, any>;
  shotMemory?: Record<string, any>;
  qaCouncil?: Record<string, any>;
  [key: string]: any;
}

export type ProjectType = "single-work" | "series-work" | "movie" | "tv-series" | "short-drama" | "micro-short-drama";

export interface Project {
  creativeDirection?: CreativeDirectionBindings;
  id: string;
  title: string;
  type: ProjectType;
  workType?: string;
  /** The interactive domain owns graph, state, bindings and runtime builds. */
  domain?: "linear" | "interactive";
  interactiveExperienceId?: string;
  durationMinutes?: number;
  pacingPreference?: 'fast' | 'medium' | 'slow';
  characterCountConfig?: {
    leads: number; // 核心主角数量
    supporting: number; // 常驻/主要配角数量
    extras: number; // 龙套/客串/边缘角色数量
  };
  assetCountConfig?: {
    locations: number;
    props: number;
    reasoning?: string;
  };
  projectModel?: 'linear' | 'interactive'; // Dictates the core structure of the project data (Default: linear)
  productionMode?: ProjectProductionMode;
  targetScale?: ProjectTargetScale;
  lockStrategy?: ProjectLockStrategy;
  styleVariantPolicy?: StyleVariantPolicy;
  interactiveTemplate?: string; // e.g. Black Mirror, Detroit, Invisible Guardian
  interactiveConfig?: InteractiveGameConfig;
  gameData?: any; // To store GameProjectData when in interactive mode (or import the type)
  /** Quarantined fixed sample files from pre-capability builds. Never usable as production media. */
  legacyDemoAssets?: Array<{
    ownerId: string;
    ownerType: "character" | "asset";
    field: "model3dUrl" | "panoramaUrl";
    url: string;
    source: "legacy_demo";
  }>;
  aspectRatio: string;
  
  // The creator's original inputs from the home page
  originalInspiration?: string;
  refinedInspiration?: string;
  characterRosterPlan?: string;
  plannedCharacters?: PlannedCharacter[];
  plannedLocations?: PlannedAsset[];
  plannedProps?: PlannedAsset[];
  originalStyleReference?: {
    mode: 'region' | 'director-actor' | 'skill';
    text: string;
  };
  visualStyleLock?: VisualStyleLock;
  styleLockChangeLog?: Array<{
    id: string;
    sourceCandidateId?: string;
    artifactId?: string;
    approvedBy?: string;
    approvedAt: number;
    scope?: string;
    affectedArtifactKinds?: string[];
    requiredReruns?: string[];
    rollbackPlan?: string;
  }>;

  globalGenerationParams?: {
    qualityPrompt?: string;
    negativePrompt?: string;
    globalAppendedPrompt?: string;
  };
  logline: string;
  coreConflict: string;
  seasonArc?: string; // For TV Series: The overarching goal/arc for the season
  arcs?: Arc[]; // For Short Dramas: Macro-structure arcs
  targetEpisodeCount?: number; // Target number of episodes for short dramas/tv series
  creativeVision?: CreativeVision;
  worldBuildingRules?: WorldBuildingRule[];
  characters: Character[];
  relationships?: Relationship[];
  scenes?: Scene[]; // Keep for backward compatibility
  episodes: EpisodeMeta[];
  assets: Asset[];
  customTemplates?: BeatTemplate[];
  extractedDNAs?: ExtractedBeatTemplate[];
  universalSkillRefs?: UniversalSkillReference[]; // Snapshot of universal Skill prompt text selected for this project.
  appliedVADnaProjectId?: string; // Reference to a VideoAnalysisProject DNA
  productionMemory?: LongFormProductionMemory; // Canonical long-form memory ledger for multi-episode projects.
  operatorProductionMemory?: LongFormProductionMemory; // Legacy Operator alias; read as fallback and mirrored by Operator tools.
  manualProductionAssets?: ManualProductionAssetRegistry;
  productionSourceSnapshot?: ProductionScriptSourceSnapshot;
  productionNarrativeEntitySync?: ProductionNarrativeEntitySyncState;
  /** Current, editable screenplay revisions used by production. Import evidence stays in productionSourceSnapshot/documents. */
  productionScriptWorkspace?: ProductionScriptWorkspace;
  productionSourceDocuments?: ProductionSourceDocument[];
  productionScenePlans?: ProductionScenePlanVersion[];
  interactiveProductionPlanDrafts?: InteractiveProductionPlanDraft[];
  interactiveMediaPlanDrafts?: InteractiveMediaPlanDraft[];
  interactiveVisualRefinementDrafts?: InteractiveVisualRefinementDraft[];
  interactiveMediaFeedbackRequests?: InteractiveMediaFeedbackRequest[];
  interactiveProductionPrepProfile?: ProductionInteractivePrepProfile;
  // Director-production projects use a soft delete so the project library can restore them.
  productionTrashedAt?: number | null;
  isFromAdaptation?: boolean;
  adaptationData?: any; // Preserve historical imported source and adaptation artifacts.
  // New proposal fields
  storyCards?: StoryCard[];
  hooks?: Hook[];
  constraints?: ScriptConstraint[];
  audienceReports?: AudienceReport[];
  diagnosticReport?: NarrativeHealthReport;
  enhancementResult?: NarrativeEnhancementResult;
}
