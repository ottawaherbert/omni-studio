import { buildVideoContinuityContext } from "../../../packages/production/src/services/production/videoContinuityContext";
import { resolveProductionCreativeVisual, creativeExecutionManifest, hasShotVisualDirection, renderProductionCreativeContext, type ProductionCreativeScope } from "../../../packages/production/src/services/production/creativeDirection";
import { appearancePrompt, appearanceSummary } from "./productionAppearance";
import type { Episode, ManualStoryboardBoard, Project, Scene, Shot, StoryboardVisualReferenceMode } from "../../types/project";
import type { VisualProjectionTarget } from "../../../packages/domain/src/visualArtifact";
import type { VisualLocalOverride } from "../../../packages/domain/src/visualOverride";
import type { ManualProductionAssetBoard } from "./manualProductionAssets";
import type {
  VideoGenerationIntent,
  VideoDialogueLine,
  VideoNativeAudioPolicy,
  VideoReferenceBinding,
  VideoTimelineBeat,
} from "./videoGenerationIntent";
import {
  MINIMAX_H3_FL2VA_ADAPTER_ID,
  MINIMAX_H3_I2VA_ADAPTER_ID,
  MINIMAX_H3_L2VA_ADAPTER_ID,
  MINIMAX_H3_REF2VA_ADAPTER_ID,
  MINIMAX_H3_T2VA_ADAPTER_ID,
} from "./minimaxH3Adapter";
import { manualStoryboardHash } from "./manualStoryboard";
import {
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
} from "./visualStyleProjection";
import { assertVisualStyleReadyForExecution } from "./visualMediumProfiles";

export const resolveManualStudioUnitPlaybackRange = ({
  shotPositions,
  shotIds,
}: {
  shotPositions: Array<{ id: string; start: number; duration: number }>;
  shotIds: string[];
}) => {
  const unitShotIds = new Set(shotIds);
  const unitPositions = shotPositions.filter((shot) => unitShotIds.has(shot.id));
  if (!unitPositions.length) return null;
  return {
    start: Math.min(...unitPositions.map((shot) => shot.start)),
    end: Math.max(...unitPositions.map((shot) => shot.start + shot.duration)),
  };
};

/**
 * Produces the recipe-scoped visual contract for video providers. This remains
 * a text constraint and never expands the current shot's media reference pack.
 */
export const buildManualStudioProjectVisualStyleProjection = (
  project: Project,
  options: {
    creativeScope?: ProductionCreativeScope;
    targets?: VisualProjectionTarget[];
    shotOverride?: VisualLocalOverride;
  } = {},
) => {
  const styleLock = resolveProductionCreativeVisual(project, options.creativeScope);
  assertVisualStyleReadyForExecution(styleLock, "video_clip");
  const projection = projectVisualStyleForArtifact({
    styleLock: styleLock?.humanApprovalState === "rejected" ? undefined : styleLock,
    intent: "video_clip",
    targets: options.targets,
    shotOverride: options.shotOverride,
  });
  const assignmentTargetLabels = Object.fromEntries(projection.mediumAssignments.map((assignment) => {
    const target = assignment.target;
    if (target.scope === "whole") return [assignment.id, "整个视频画面"];
    if (target.scope === "layer") return [assignment.id, `图层“${target.label}”：${target.description}`];
    const targetName = target.entityType === "character"
      ? project.characters.find((entry) => entry.id === target.entityId)?.name
      : project.assets.find((entry) => entry.id === target.entityId)?.name;
    return [assignment.id, targetName || "当前镜头主体"];
  }));
  const rendered = renderVisualStyleProjectionInstruction(projection, { assignmentTargetLabels });
  const creativeDirection = creativeExecutionManifest(project, options.creativeScope, "video");
  return { projection, rendered: { ...rendered, manifest: { ...rendered.manifest, ...(creativeDirection ? { creativeDirection } : {}) } } };
};

export const buildManualStudioProjectVisualStyleContract = (
  project: Project,
  options: {
    creativeScope?: ProductionCreativeScope;
    targets?: VisualProjectionTarget[];
    shotOverride?: VisualLocalOverride;
  } = {},
) => buildManualStudioProjectVisualStyleProjection(project, options).rendered.instruction;

const visualProjectionTargetsForVideo = (
  project: Project,
  shot: Shot,
  boards: ManualProductionAssetBoard[],
): VisualProjectionTarget[] => {
  const assetIds = Array.from(new Set([
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
    ...boards.map((board) => board.assetId),
  ].filter((assetId): assetId is string => Boolean(assetId))));
  const entityTargets = assetIds.flatMap<VisualProjectionTarget>((assetId) => {
    if (project.characters.some((character) => character.id === assetId)) {
      return [{ entityType: "character" as const, entityId: assetId }];
    }
    const asset = project.assets.find((entry) => entry.id === assetId);
    if (!asset) return [];
    return [{
      entityType: asset.type === "location" ? "location" as const : asset.type === "vfx" ? "vfx" as const : "prop" as const,
      entityId: assetId,
    }];
  });
  const layerTargets = Array.from(new Set(shot.activeVisualLayerIds || []))
    .map((layerId) => layerId.trim())
    .filter(Boolean)
    .map((layerId) => ({ layerId }));
  return [...entityTargets, ...layerTargets];
};

export const selectMiniMaxH3GenerationWay = ({
  startFrameUrl,
  endFrameUrl,
}: {
  startFrameUrl?: string;
  endFrameUrl?: string;
}) => startFrameUrl && endFrameUrl
  ? MINIMAX_H3_FL2VA_ADAPTER_ID
  : startFrameUrl
    ? MINIMAX_H3_I2VA_ADAPTER_ID
    : endFrameUrl
      ? MINIMAX_H3_L2VA_ADAPTER_ID
      : MINIMAX_H3_REF2VA_ADAPTER_ID;

export interface ManualStudioVideoTimelineInput {
  id: string;
  shotId: string;
  panelId?: string;
  startSeconds: number;
  endSeconds: number;
  visibleAction: string;
  performance?: string;
  camera?: string;
  dialogue?: string;
  speakerCharacterId?: string;
  dialogueLines?: VideoDialogueLine[];
  soundCues?: string[];
  continuityIn?: string;
  continuityOut?: string;
}

export interface ManualStudioVideoIntentTarget {
  shotId: string;
  boardId?: string;
  panelId?: string;
  pageId?: string;
  storyboardImageUrl?: string;
  videoReferenceImageUrl?: string;
  storyboardReferenceMode?: StoryboardVisualReferenceMode;
  includeStoryboardReference?: boolean;
  selectedReferenceImages?: Array<{
    takeId: string;
    shotId: string;
    mediaUrl: string;
    displayName: string;
  }>;
  selectedReferenceVideos?: Array<{
    takeId: string;
    shotId: string;
    mediaUrl: string;
    displayName: string;
    durationSeconds: number;
  }>;
  selectedDialogueTrackIds?: string[];
  selectedVoiceReferenceIds?: string[];
  durationSeconds: number;
  videoPrompt: string;
  videoGenerationUnitId?: string;
  shotIds?: string[];
  startState?: string;
  endState?: string;
  timeline?: ManualStudioVideoTimelineInput[];
  interactiveContentSlot?: "entry" | "main" | "choice_hold" | "exit";
  interactiveNodeId?: string;
}

export const resolveManualStudioStoryboardReferenceUrl = (
  target: Pick<ManualStudioVideoIntentTarget, "storyboardImageUrl" | "videoReferenceImageUrl" | "storyboardReferenceMode" | "includeStoryboardReference">,
) => target.includeStoryboardReference === true
  ? target.storyboardReferenceMode === "director_board"
    ? target.storyboardImageUrl
    : target.videoReferenceImageUrl
  : undefined;

export const resolveManualStudioInteractiveContext = (
  project: Project,
  scene: Scene,
  target: Pick<ManualStudioVideoIntentTarget, "interactiveNodeId" | "interactiveContentSlot" | "videoPrompt">,
): VideoGenerationIntent["interactiveContext"] => {
  const metadata = scene.interactiveMetadata;
  const scenario = metadata?.visualScenarios?.find((item) => item.id === metadata.activeVisualScenarioId)
    || metadata?.visualScenarios?.[0];
  if (!scenario || !metadata?.nodeIds?.length) return undefined;
  const contentSlot = target.interactiveContentSlot || "main";
  return {
    experienceId: project.interactiveProductionPrepProfile?.experienceId || project.id,
    graphVersionId: metadata.graphVersionId || project.interactiveProductionPrepProfile?.graphVersionId || "current",
    nodeId: target.interactiveNodeId || metadata.nodeIds[0],
    contentSlot,
    visualScenarioId: scenario.id,
    visualStateFingerprint: scenario.stateFingerprint,
    visualReuseFingerprint: scenario.reuseFingerprint,
    visibleStateFacts: scenario.observableFacts,
    incomingPhysicalResult: metadata.incomingContext || "",
    outgoingChoices: (metadata.outboundChoices || []).map((choice, index) => ({
      choiceId: `${scene.id}-choice-${index + 1}`,
      text: choice.label,
      targetNodeId: choice.targetNodeId,
      timeoutSeconds: choice.timeoutSeconds,
      isDefaultTimeout: choice.defaultTimeoutTargetNodeId === choice.targetNodeId,
    })),
    uiSafeArea: "center_clear",
    requiresIdleLoop: contentSlot === "choice_hold",
  };
};

const boardSourceType = (board: ManualProductionAssetBoard): VideoReferenceBinding["sourceType"] => {
  if (board.assetType === "character") return board.variantId ? "character_variant" : "character_board";
  if (board.assetType === "location") return "scene_board";
  return "prop_board";
};

const boardPurpose = (board: ManualProductionAssetBoard): VideoReferenceBinding["purpose"] => {
  if (board.assetType === "location") return "environment";
  if (board.assetType === "prop") return "prop_identity";
  return board.variantId ? "appearance" : "identity";
};

const compactBoardDescription = ({
  project,
  scene,
  board,
}: {
  project: Project;
  scene: Scene;
  board: ManualProductionAssetBoard;
}) => {
  const canonicalDescription = board.assetType === "character"
    ? project.characters.find((item) => item.id === board.assetId)?.visualIdentity
    : project.assets.find((item) => item.id === board.assetId)?.description;
  const characterState = scene.breakdown?.characters?.find((item) => (
    typeof item === "object" && item.name === board.assetName
  ));
  const propState = scene.breakdown?.props?.find((item) => (
    typeof item === "object" && item.name === board.assetName
  ));
  const locationState = scene.breakdown?.location;
  const sceneState = board.assetType === "character"
    ? typeof characterState === "object" ? characterState.state : undefined
    : board.assetType === "prop"
      ? typeof propState === "object" ? propState.state : undefined
      : typeof locationState === "object" && locationState.name === board.assetName
        ? locationState.state
        : undefined;
  return [
    `${board.assetName}的已确认${board.assetType === "character" ? "人物" : board.assetType === "location" ? "场景" : "道具"}参考图`,
    canonicalDescription,
    board.variantName ? `当前版本：${board.variantName}` : undefined,
    board.boardItemId.startsWith("appearance:") ? board.prompt : sceneState ? `本场状态：${sceneState}` : undefined,
  ].filter(Boolean).join("；");
};

export const buildManualStudioStoryboardTimeline = (board: ManualStoryboardBoard, shots: Shot[]): ManualStudioVideoTimelineInput[] => {
  let cursor = 0;
  return shots.map((shot) => {
    const panels = board.panels.filter((panel) => panel.shotId === shot.id);
    const startSeconds = cursor;
    cursor += Math.max(0, Number(shot.duration || 0) || panels.reduce((sum, panel) => sum + Number(panel.durationSeconds || 0), 0));
    const dialogueLines = (shot.dialogueLines || []).filter((line) => line.text.trim()).map((line) => ({ ...line }));
    return {
      id: `timeline-${shot.id}`,
      shotId: shot.id,
      startSeconds,
      endSeconds: cursor,
      visibleAction: Array.from(new Set(panels.map((panel) => panel.visualBeat || panel.subjectAction || panel.framePurpose).filter(Boolean))).join(" -> ") || shot.visualAction,
      performance: Array.from(new Set([...panels.flatMap((panel) => [panel.blocking, panel.emotionCue]), shot.microExpression].filter(Boolean))).join(" "),
      camera: [shot.shotSize, shot.cameraAngle, shot.cameraMovement, shot.focalLength].filter(Boolean).join(", "),
      dialogueLines,
      soundCues: Array.from(new Set(panels.flatMap((panel) => [panel.soundCue, !dialogueLines.length ? panel.dialogueOrSoundCue : undefined]).filter(Boolean))) as string[],
      continuityIn: panels[0]?.continuityIn || board.startState,
      continuityOut: panels[panels.length - 1]?.continuityOut || board.endState,
    };
  });
};

const timelineFor = (shot: Shot, target: ManualStudioVideoIntentTarget): VideoTimelineBeat[] => {
  if (target.timeline?.length) {
    return target.timeline.map((beat) => ({
      id: beat.id,
      shotId: beat.shotId,
      panelId: beat.panelId,
      startSeconds: beat.startSeconds,
      endSeconds: beat.endSeconds,
      visibleAction: beat.visibleAction,
      performance: beat.performance || "",
      camera: beat.camera || "",
      dialogue: beat.dialogue,
      speakerCharacterId: beat.speakerCharacterId,
      dialogueLines: beat.dialogueLines?.map((line) => ({ ...line })),
      soundCues: beat.soundCues || [],
      continuityIn: beat.continuityIn || target.startState || "",
      continuityOut: beat.continuityOut || target.endState || "",
    }));
  }
  return [{
    id: `beat-${shot.id}`,
    shotId: shot.id,
    startSeconds: 0,
    endSeconds: target.durationSeconds,
    visibleAction: shot.visualAction || target.videoPrompt,
    performance: [shot.blocking, shot.microExpression].filter(Boolean).join(" "),
    camera: [shot.shotSize, shot.cameraAngle, shot.cameraMovement, shot.focalLength].filter(Boolean).join(", "),
    dialogueLines: (shot.dialogueLines || []).map((line) => ({ ...line })),
    soundCues: shot.soundDesign ? [shot.soundDesign] : [],
    continuityIn: shot.appearance?.states.filter(s => s.decision === "accepted").map(s => `${s.assetName}：${appearanceSummary(s.start)}`).join("；") || target.startState || shot.continuityNote || "沿用当前故事板起始状态",
    continuityOut: shot.appearance?.states.filter(s => s.decision === "accepted").map(s => `${s.assetName}：${appearanceSummary(s.end)}`).join("；") || target.endState || shot.continuityNote || "完成当前镜头动作",
  }];
};

const referenceBindingsFor = ({
  project,
  scene,
  shot,
  target,
  boards,
  generationMode,
  referenceCapabilities,
  audioMode,
  startFrameUrl,
  endFrameUrl,
}: {
  project: Project;
  scene: Scene;
  shot: Shot;
  target: ManualStudioVideoIntentTarget;
  boards: ManualProductionAssetBoard[];
  generationMode?: string;
  referenceCapabilities?: { images: boolean; videos: boolean; audios: boolean };
  audioMode: "provider_native" | "reuse_dialogue" | "post_dub";
  startFrameUrl?: string;
  endFrameUrl?: string;
}) => {
  if (generationMode === "text_only") return [];
  const multimodalReferenceMode = generationMode === "multimodal_reference";
  if (!multimodalReferenceMode) {
    const result: VideoReferenceBinding[] = [];
    const includeStartFrame = generationMode !== "last_frame";
    const includeEndFrame = ["first_last_frame", "last_frame", "start_end_frames"].includes(generationMode || "");
    if (includeStartFrame && startFrameUrl) result.push({
      id: `start-frame-${shot.id}`,
      sourceType: "start_frame",
      sourceAssetId: `take-image-${shot.id}`,
      mediaUrl: startFrameUrl,
      displayName: "采用的首帧画面",
      purpose: "composition",
      preservation: "required",
      required: true,
      priority: 100,
    });
    if (includeEndFrame && endFrameUrl) result.push({
      id: `end-frame-${shot.id}`,
      sourceType: "end_frame",
      sourceAssetId: `take-image-end-${shot.id}`,
      mediaUrl: endFrameUrl,
      displayName: "选择的尾帧画面",
      purpose: "composition",
      preservation: "required",
      required: true,
      priority: 99,
    });
    return result;
  }

  const result: VideoReferenceBinding[] = (referenceCapabilities?.images === false ? [] : boards)
    .filter((board) => Boolean(board.referenceImageUrl)).map((board) => ({
    id: `board-${board.boardItemId}`,
    sourceType: boardSourceType(board),
    sourceAssetId: board.assetId,
    sourceVariantId: board.variantId,
    semanticEntityId: board.assetId,
    mediaUrl: board.referenceImageUrl!,
    displayName: board.variantName ? `${board.assetName} / ${board.variantName}` : board.assetName,
    description: compactBoardDescription({ project, scene, board }),
    purpose: boardPurpose(board),
    preservation: "required",
    required: true,
    priority: board.assetType === "character" ? 100 : board.assetType === "location" ? 90 : 80,
  }));
  const multiPanelReferenceUrl = referenceCapabilities?.images === false
    ? undefined
    : resolveManualStudioStoryboardReferenceUrl(target);
  if (multiPanelReferenceUrl) result.push({
    id: `storyboard-${target.pageId || target.panelId || target.boardId || shot.id}`,
    sourceType: target.pageId || target.boardId ? "storyboard_board" : "storyboard_panel",
    sourceAssetId: target.pageId || target.panelId || target.boardId || shot.id,
    mediaUrl: multiPanelReferenceUrl,
    displayName: target.storyboardReferenceMode === "director_board" ? "当前导演故事板" : "当前分镜宫格图",
    description: target.storyboardReferenceMode === "director_board"
      ? "创作者选用的导演故事板，负责构图、人物站位、动作顺序和摄影机规划。"
      : "仅含分镜序号的纯净宫格画面，只负责构图、人物站位、动作顺序和摄影机规划，不替代角色、场景或道具身份板。",
    purpose: "composition",
    preservation: "strong",
    required: true,
    priority: 95,
  });

  for (const reference of referenceCapabilities?.images === false ? [] : target.selectedReferenceImages || []) result.push({
    id: `shot-image-${reference.takeId}`,
    sourceType: "storyboard_panel",
    sourceAssetId: reference.takeId,
    semanticEntityId: reference.shotId,
    mediaUrl: reference.mediaUrl,
    displayName: reference.displayName,
    description: "创作者明确选中的已采用分镜画面。",
    purpose: "composition",
    preservation: "strong",
    required: true,
    priority: 94,
  });
  for (const reference of referenceCapabilities?.videos === false ? [] : target.selectedReferenceVideos || []) result.push({
    id: `prior-video-${reference.takeId}`,
    sourceType: "motion_reference_video",
    sourceAssetId: reference.takeId,
    semanticEntityId: reference.shotId,
    mediaUrl: reference.mediaUrl,
    mediaDurationSeconds: reference.durationSeconds,
    displayName: reference.displayName,
    description: "创作者明确选中的历史视频 Take，仅用于动作和运动参考。",
    purpose: "motion",
    preservation: "strong",
    required: true,
    priority: 93,
  });

  if (referenceCapabilities?.audios !== false && audioMode === "reuse_dialogue") {
    const selectedTrackIds = new Set(target.selectedDialogueTrackIds || []);
    for (const track of (scene.audioTracks || []).filter((item) => selectedTrackIds.has(item.id) && item.type === "dialogue" && item.url)) {
      result.push({
        id: `dialogue-${track.id}`,
        sourceType: "final_dialogue_audio",
        sourceAssetId: track.id,
        semanticEntityId: track.characterId,
        mediaUrl: track.url,
        mediaDurationSeconds: track.duration,
        displayName: `${project.characters.find((item) => item.id === track.characterId)?.name || "人物"}的完整配音`,
        description: track.text,
        speakerId: track.characterId,
        audioUsage: "full_copy",
        purpose: "audio_copy",
        preservation: "required",
        required: true,
        priority: 100,
      });
    }
  } else if (referenceCapabilities?.audios !== false && audioMode === "provider_native") {
    const selectedVoiceReferenceIds = new Set(target.selectedVoiceReferenceIds || []);
    for (const character of project.characters) {
      for (const reference of character.voiceReferences || []) {
        if (!selectedVoiceReferenceIds.has(reference.id) || !reference.url || reference.usage !== "voice_timbre") continue;
        result.push({
          id: `voice-${reference.id}`,
          sourceType: "voice_reference_audio",
          sourceAssetId: reference.id,
          semanticEntityId: character.id,
          mediaUrl: reference.url,
          mediaDurationSeconds: reference.durationSeconds,
          displayName: `${character.name}的人物声音`,
          description: reference.description,
          speakerId: character.id,
          audioUsage: "voice_timbre",
          purpose: "voice_timbre",
          preservation: "required",
          required: true,
          priority: 95,
        });
      }
    }
  }
  return result;
};

const audioPolicyFor = (
  bindings: VideoReferenceBinding[],
  audioMode: "provider_native" | "reuse_dialogue" | "post_dub",
  target: ManualStudioVideoIntentTarget,
  generationMode?: string,
): VideoNativeAudioPolicy => {
  const fullDialogue = bindings.filter((item) => item.sourceType === "final_dialogue_audio");
  if (fullDialogue.length) return { mode: "reuse_final_dialogue_audio", dialogueAudioAssetIds: fullDialogue.map((item) => item.sourceAssetId) };
  if (audioMode === "reuse_dialogue") {
    return {
      mode: "reuse_final_dialogue_audio",
      dialogueAudioAssetIds: generationMode === "multimodal_reference" ? [...(target.selectedDialogueTrackIds || [])] : [],
    };
  }
  const voices = bindings.filter((item) => item.sourceType === "voice_reference_audio" && item.semanticEntityId);
  if (voices.length) return {
    mode: "generate_with_voice_reference",
    speakerBindings: voices.map((item) => ({ characterId: item.semanticEntityId!, voiceReferenceAssetId: item.sourceAssetId })),
  };
  if (audioMode === "post_dub") return { mode: "post_dub", stripProviderAudio: true };
  return { mode: "provider_native" };
};

export const buildManualStudioVideoIntent = ({
  project,
  episode,
  scene,
  shot,
  target,
  boards,
  adapterId,
  generationMode,
  referenceCapabilities,
  audioMode,
  startFrameUrl,
  endFrameUrl,
  directorIntent,
  sourceHash,
  visualProjectionTargets,
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  shot: Shot;
  target: ManualStudioVideoIntentTarget;
  boards: ManualProductionAssetBoard[];
  adapterId: string;
  generationMode?: string;
  referenceCapabilities?: { images: boolean; videos: boolean; audios: boolean };
  audioMode: "provider_native" | "reuse_dialogue" | "post_dub";
  startFrameUrl?: string;
  endFrameUrl?: string;
  directorIntent: string;
  sourceHash: string;
  visualProjectionTargets?: VisualProjectionTarget[];
}): VideoGenerationIntent => {
  const referenceBindings = referenceBindingsFor({ project, scene, shot, target, boards, generationMode, referenceCapabilities, audioMode, startFrameUrl, endFrameUrl });
  const timelineBeats = timelineFor(shot, target);
  const visualStyle = buildManualStudioProjectVisualStyleProjection(project, {
    creativeScope: { episode, scene: { ...scene, shots: (scene.shots || []).filter(item => (target.shotIds?.length ? target.shotIds : [shot.id]).includes(item.id)) }, shot: !target.shotIds || target.shotIds.length <= 1 ? shot : undefined },
    targets: visualProjectionTargets || visualProjectionTargetsForVideo(project, shot, boards),
    shotOverride: !target.shotIds || target.shotIds.length <= 1 ? shot.visualOverride : undefined,
  });
  const visualStyleContract = visualStyle.rendered.instruction;
  const audioPolicy = audioPolicyFor(referenceBindings, audioMode, target, generationMode);
  const interactiveContext = resolveManualStudioInteractiveContext(project, scene, target);
  const creativeIntent = (scene.shots || []).filter(s => (target.shotIds?.length ? target.shotIds : [shot.id]).includes(s.id)).map(s => `镜头 ${s.id}：\n${renderProductionCreativeContext(project, { episode, scene, shot: s }, "video", false) + ((target.shotIds?.length || 1) > 1 && hasShotVisualDirection(project, s) ? "\n本镜视觉规范：\n" + buildManualStudioProjectVisualStyleProjection(project, { creativeScope: { episode, scene, shot: s }, targets: visualProjectionTargetsForVideo(project, s, boards), shotOverride: s.visualOverride }).rendered.instruction : "")}`).join("\n\n");
  const continuityContext = buildVideoContinuityContext({ sceneId: scene.id, shots: scene.shots || [], unitShotIds: target.shotIds?.length ? target.shotIds : [shot.id] });
  const intentSourceHash = manualStoryboardHash({
    continuityContext,
    creativeIntent,
    sourceHash,
    adapterId,
    directorIntent,
    visualStyleContract,
    durationSeconds: target.durationSeconds,
    aspectRatio: project.aspectRatio || "16:9",
    startState: target.startState,
    endState: target.endState,
    timelineBeats,
    references: referenceBindings.map((item) => [
      item.id,
      item.mediaUrl,
      item.semanticEntityId,
      item.audioUsage,
      item.mediaDurationSeconds,
    ]),
    audioPolicy,
    interactiveContext,
  });
  return {
    schemaVersion: "video-generation-intent.v1",
    id: `video-intent-${intentSourceHash}`,
    projectId: project.id,
    episodeId: episode.id,
    sceneId: scene.id,
    videoGenerationUnitId: target.videoGenerationUnitId || target.boardId || target.panelId || shot.id,
    storyboardBoardId: target.boardId || target.panelId || shot.id,
    shotIds: target.shotIds?.length ? target.shotIds : [shot.id],
    durationSeconds: target.durationSeconds,
    aspectRatio: project.aspectRatio || "16:9",
    startState: target.startState || timelineBeats[0]?.continuityIn || "沿用当前故事板起始状态",
    endState: target.endState || timelineBeats[timelineBeats.length - 1]?.continuityOut || "完成当前视频单元动作",
    directorIntent: [creativeIntent, continuityContext, directorIntent.trim() || target.videoPrompt.trim(), ...(scene.shots || []).filter(s => (target.shotIds?.length ? target.shotIds : [shot.id]).includes(s.id)).map(s => appearancePrompt(s, "video"))].filter(Boolean).join("\n\n"),
    ...(visualStyleContract ? { visualStyleContract } : {}),
    visualStyleCompileManifest: visualStyle.rendered.manifest,
    timelineBeats,
    referenceBindings,
    audioPolicy,
    ...(interactiveContext ? { interactiveContext } : {}),
    sourceHash: intentSourceHash,
  };
};

export const isMiniMaxH3AdapterId = (adapterId: string) =>
  [
    MINIMAX_H3_REF2VA_ADAPTER_ID,
    MINIMAX_H3_T2VA_ADAPTER_ID,
    MINIMAX_H3_I2VA_ADAPTER_ID,
    MINIMAX_H3_FL2VA_ADAPTER_ID,
    MINIMAX_H3_L2VA_ADAPTER_ID,
  ].includes(adapterId);
