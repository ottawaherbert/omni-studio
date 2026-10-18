import type {
  VisualCompileManifest,
  VisualRecipeRequiredInput,
  VisualRecipeRuntimeContract,
  VisualRecipeRuntimeEnforcement,
  VisualRecipeRuntimeEvidence,
} from "../../../../domain/src/visualArtifact";
import {
  evaluateVisualRecipeRuntimeContract,
  type VisualRecipeRuntimeEvidenceMap,
} from "./visualTaskRecipes";

export type VideoGenerationReferenceSourceType =
  | "character_board"
  | "character_variant"
  | "scene_board"
  | "prop_board"
  | "style_reference"
  | "storyboard_board"
  | "storyboard_panel"
  | "start_frame"
  | "end_frame"
  | "motion_reference_video"
  | "editing_reference_video"
  | "voice_reference_audio"
  | "final_dialogue_audio";

export type VideoGenerationReferencePurpose =
  | "identity"
  | "appearance"
  | "environment"
  | "prop_identity"
  | "composition"
  | "motion"
  | "editing_rhythm"
  | "voice_timbre"
  | "audio_copy";

export interface VideoDialogueLine {
  characterId?: string;
  delivery?: "on_screen" | "off_screen" | "voice_over" | "phone";
  speakerName?: string;
  text: string;
  language?: string;
}

export interface VideoTimelineBeat {
  id: string;
  shotId: string;
  panelId?: string;
  startSeconds: number;
  endSeconds: number;
  visibleAction: string;
  performance: string;
  camera: string;
  dialogue?: string;
  speakerCharacterId?: string;
  dialogueLines?: VideoDialogueLine[];
  soundCues: string[];
  continuityIn: string;
  continuityOut: string;
}

export const videoBeatDialogueLines = (beat: Pick<VideoTimelineBeat, "dialogueLines" | "dialogue" | "speakerCharacterId">): VideoDialogueLine[] =>
  beat.dialogueLines !== undefined
    ? beat.dialogueLines.filter((line) => Boolean(line.text.trim()))
    : beat.dialogue?.trim() ? [{ characterId: beat.speakerCharacterId, text: beat.dialogue }] : [];

export interface VideoReferenceBinding {
  id: string;
  sourceType: VideoGenerationReferenceSourceType;
  sourceAssetId: string;
  sourceVariantId?: string;
  semanticEntityId?: string;
  mediaUrl: string;
  contentHash?: string;
  displayName?: string;
  description?: string;
  mediaDurationSeconds?: number;
  fileSizeBytes?: number;
  speakerId?: string;
  audioUsage?: "voice_timbre" | "full_copy";
  purpose: VideoGenerationReferencePurpose;
  preservation: "required" | "strong" | "flexible";
  required: boolean;
  priority: number;
}

export type VideoNativeAudioPolicy =
  | {
      mode: "provider_native";
    }
  | {
      mode: "generate_with_voice_reference";
      speakerBindings: Array<{
        characterId: string;
        voiceReferenceAssetId: string;
      }>;
    }
  | {
      mode: "reuse_final_dialogue_audio";
      dialogueAudioAssetIds: string[];
    }
  | {
      mode: "post_dub";
      stripProviderAudio: boolean;
    };

export interface InteractiveVideoContext {
  experienceId: string;
  graphVersionId: string;
  nodeId: string;
  contentSlot: "entry" | "main" | "choice_hold" | "exit";
  incomingChoiceId?: string;
  visualScenarioId: string;
  visualStateFingerprint: string;
  visualReuseFingerprint: string;
  visibleStateFacts: string[];
  incomingPhysicalResult: string;
  outgoingChoices: Array<{
    choiceId: string;
    text: string;
    targetNodeId: string;
    timeoutSeconds?: number;
    isDefaultTimeout?: boolean;
  }>;
  uiSafeArea?: "left" | "right" | "top" | "bottom" | "center_clear";
  requiresIdleLoop: boolean;
}

export interface VideoGenerationIntent {
  schemaVersion: "video-generation-intent.v1";
  id: string;
  projectId: string;
  episodeId: string;
  sceneId: string;
  videoGenerationUnitId: string;
  storyboardBoardId: string;
  shotIds: string[];
  durationSeconds: number;
  aspectRatio: string;
  startState: string;
  endState: string;
  directorIntent: string;
  /** Project-wide visual rules that every generated shot must preserve. */
  visualStyleContract?: string;
  /** Audit-only lineage for the style contract compiled at the execution boundary. */
  visualStyleCompileManifest?: VisualCompileManifest;
  timelineBeats: VideoTimelineBeat[];
  referenceBindings: VideoReferenceBinding[];
  audioPolicy: VideoNativeAudioPolicy;
  interactiveContext?: InteractiveVideoContext;
  sourceHash: string;
}

const recipeEvidence = (source: string, summary?: string): VisualRecipeRuntimeEvidence => ({
  source,
  ...(summary ? { summary } : {}),
});

/**
 * Uses the video's real structured fields rather than trying to infer task
 * readiness from mutable role prose in the provider prompt.
 */
export const evaluateVideoVisualRecipeRuntimeContract = ({
  intent,
  enforcement,
  adapterId,
}: {
  intent: VideoGenerationIntent;
  enforcement: VisualRecipeRuntimeEnforcement;
  adapterId?: string;
}): VisualRecipeRuntimeContract => {
  const timelineEvidence = intent.timelineBeats.length
    ? [recipeEvidence("VideoGenerationIntent.timelineBeats", `${intent.timelineBeats.length} beats`)]
    : [];
  const nonEmptyMotionBeats = intent.timelineBeats.filter((beat) => (
    beat.visibleAction.trim() || beat.performance.trim() || beat.camera.trim()
  ));
  const continuityBeats = intent.timelineBeats.filter((beat) => (
    beat.continuityIn.trim() && beat.continuityOut.trim()
  ));
  const inputEvidence: VisualRecipeRuntimeEvidenceMap<VisualRecipeRequiredInput> = {
    start_state: intent.startState.trim()
      ? [recipeEvidence("VideoGenerationIntent.startState")]
      : [],
    end_state: intent.endState.trim()
      ? [recipeEvidence("VideoGenerationIntent.endState")]
      : [],
    motion_intent: intent.directorIntent.trim() && nonEmptyMotionBeats.length
      ? [
          recipeEvidence("VideoGenerationIntent.directorIntent"),
          recipeEvidence("VideoGenerationIntent.timelineBeats.visibleAction", `${nonEmptyMotionBeats.length} beats`),
        ]
      : [],
    continuity: intent.timelineBeats.length && continuityBeats.length === intent.timelineBeats.length
      ? [
          recipeEvidence("VideoGenerationIntent.timelineBeats.continuityIn"),
          recipeEvidence("VideoGenerationIntent.timelineBeats.continuityOut"),
        ]
      : [],
  };
  return evaluateVisualRecipeRuntimeContract({
    intent: "video_clip",
    enforcement,
    inputEvidence,
    stageEvidence: {
      deconstruct: [
        recipeEvidence("VideoGenerationIntent.structuredStates"),
        ...timelineEvidence,
      ],
      diagnose: [recipeEvidence("VideoGenerationIntent.referenceBindings", `${intent.referenceBindings.length} bindings`)],
      develop: intent.directorIntent.trim()
        ? [recipeEvidence("VideoGenerationAdapter.canonicalPrompt")]
        : [],
      ...(enforcement === "formal" && adapterId
        ? { deliver: [recipeEvidence(`VideoGenerationAdapter.${adapterId}.providerPayload`)] }
        : {}),
    },
    manifest: intent.visualStyleCompileManifest,
  });
};

const textFingerprint = (value: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export interface LegacyVideoGenerationIntentInput {
  prompt: string;
  imageUrl: string;
  durationSeconds: number;
  endImageUrl?: string;
  aspectRatio?: "16:9" | "9:16";
  projectId?: string;
  episodeId?: string;
  sceneId?: string;
  shotId?: string;
  videoGenerationUnitId?: string;
}

export const createLegacyVideoGenerationIntent = (
  input: LegacyVideoGenerationIntentInput,
): VideoGenerationIntent => {
  const prompt = input.prompt.trim();
  const imageUrl = input.imageUrl.trim();
  const endImageUrl = input.endImageUrl?.trim();
  const shotId = input.shotId || "legacy-shot";
  const fingerprintSource = JSON.stringify({
    prompt,
    imageUrl,
    endImageUrl: endImageUrl || "",
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio || "16:9",
  });
  const sourceHash = `legacy-video-${textFingerprint(fingerprintSource)}`;
  const referenceBindings: VideoReferenceBinding[] = [
    {
      id: "legacy-start-frame",
      sourceType: "start_frame",
      sourceAssetId: "legacy-start-frame",
      mediaUrl: imageUrl,
      contentHash: textFingerprint(imageUrl),
      purpose: "composition",
      preservation: "required",
      required: true,
      priority: 100,
    },
  ];
  if (endImageUrl) {
    referenceBindings.push({
      id: "legacy-end-frame",
      sourceType: "end_frame",
      sourceAssetId: "legacy-end-frame",
      mediaUrl: endImageUrl,
      contentHash: textFingerprint(endImageUrl),
      purpose: "composition",
      preservation: "required",
      required: true,
      priority: 99,
    });
  }
  return {
    schemaVersion: "video-generation-intent.v1",
    id: `intent-${sourceHash}`,
    projectId: input.projectId || "legacy-project",
    episodeId: input.episodeId || "legacy-episode",
    sceneId: input.sceneId || "legacy-scene",
    videoGenerationUnitId: input.videoGenerationUnitId || `legacy-unit-${shotId}`,
    storyboardBoardId: "legacy-storyboard",
    shotIds: [shotId],
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio || "16:9",
    startState: "采用的首帧画面",
    endState: endImageUrl ? "采用的尾帧画面" : "按当前镜头提示词完成动作",
    directorIntent: prompt,
    timelineBeats: [{
      id: `legacy-beat-${shotId}`,
      shotId,
      startSeconds: 0,
      endSeconds: input.durationSeconds,
      visibleAction: prompt,
      performance: "",
      camera: "",
      soundCues: [],
      continuityIn: "采用的首帧画面",
      continuityOut: endImageUrl ? "采用的尾帧画面" : "按当前镜头提示词完成动作",
    }],
    referenceBindings,
    audioPolicy: { mode: "post_dub", stripProviderAudio: false },
    sourceHash,
  };
};
