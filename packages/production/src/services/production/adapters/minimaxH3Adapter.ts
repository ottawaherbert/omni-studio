import type {
  VideoGenerationIntent,
  VideoDialogueLine,
  VideoTimelineBeat,
} from "../videoGenerationIntent";
import { videoBeatDialogueLines } from "../videoGenerationIntent";
import {
  assertFinalVideoPromptPreservesVisualStyleContract,
  buildVideoVisualRecipeBoundary,
  type VideoAdapterIssue,
  type VideoGenerationAdapterPlan,
  type VideoModelAdapterDefinition,
  type VideoReferenceManifestEntry,
} from "../videoModelAdapter";
import { buildVideoReferenceManifest } from "../videoReferenceManifest";

export const MINIMAX_H3_MODEL_ID = "MiniMax-H3";
export const MINIMAX_H3_REF2VA_ADAPTER_ID = "video.minimax.h3.ref2va.v1";
export const MINIMAX_H3_T2VA_ADAPTER_ID = "video.minimax.h3.t2va.v1";
export const MINIMAX_H3_I2VA_ADAPTER_ID = "video.minimax.h3.i2va.v1";
export const MINIMAX_H3_FL2VA_ADAPTER_ID = "video.minimax.h3.fl2va.v1";
export const MINIMAX_H3_L2VA_ADAPTER_ID = "video.minimax.h3.l2va.v1";
export const MINIMAX_H3_RESOLUTIONS = ["768P", "2K"] as const;
export const MINIMAX_H3_RATIOS = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

export type MiniMaxH3GenerationMode =
  | "text_only"
  | "first_frame"
  | "first_last_frame"
  | "last_frame"
  | "multimodal_reference";

export const miniMaxH3GenerationModeForAdapter = (adapterId: string): MiniMaxH3GenerationMode | undefined => {
  if (adapterId === MINIMAX_H3_T2VA_ADAPTER_ID) return "text_only";
  if (adapterId === MINIMAX_H3_I2VA_ADAPTER_ID) return "first_frame";
  if (adapterId === MINIMAX_H3_FL2VA_ADAPTER_ID) return "first_last_frame";
  if (adapterId === MINIMAX_H3_L2VA_ADAPTER_ID) return "last_frame";
  if (adapterId === MINIMAX_H3_REF2VA_ADAPTER_ID) return "multimodal_reference";
  return undefined;
};

export const miniMaxH3AdapterForGenerationMode = (mode: MiniMaxH3GenerationMode) => ({
  text_only: MINIMAX_H3_T2VA_ADAPTER_ID,
  first_frame: MINIMAX_H3_I2VA_ADAPTER_ID,
  first_last_frame: MINIMAX_H3_FL2VA_ADAPTER_ID,
  last_frame: MINIMAX_H3_L2VA_ADAPTER_ID,
  multimodal_reference: MINIMAX_H3_REF2VA_ADAPTER_ID,
})[mode];

const timecode = (seconds: number) => {
  const totalMilliseconds = Math.round(Math.max(0, seconds) * 1000);
  const minutes = Math.floor(totalMilliseconds / 60000);
  const wholeSeconds = Math.floor(totalMilliseconds / 1000) % 60;
  const milliseconds = totalMilliseconds % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

const dialogueLanguage = (dialogue: string) => /[\u3400-\u9fff]/.test(dialogue) ? "Chinese" : "English";

const speakerKey = (line: VideoDialogueLine) => line.characterId || (line.speakerName ? `name:${line.speakerName}` : undefined);

const speakerMapForIntent = (intent: VideoGenerationIntent) => {
  const result = new Map<string, string>();
  for (const line of intent.timelineBeats.flatMap(videoBeatDialogueLines)) {
    const key = speakerKey(line);
    if (key && !result.has(key)) {
      result.set(key, `S${result.size + 1}`);
    }
  }
  return result;
};

const visibleDescription = (entry: VideoReferenceManifestEntry) =>
  entry.description?.trim() || `${entry.displayName || entry.semanticEntityId || entry.sourceAssetId}`;

const subjectDefinitions = (
  manifest: VideoReferenceManifestEntry[],
  speakers: Map<string, string>,
) => {
  const subjectGroups = new Map<string, VideoReferenceManifestEntry[]>();
  for (const entry of manifest) {
    if (!entry.logicalSubjectId || entry.mediaKind === "audio") continue;
    const group = subjectGroups.get(entry.logicalSubjectId) || [];
    group.push(entry);
    subjectGroups.set(entry.logicalSubjectId, group);
  }
  const lines: string[] = [];
  for (const [subjectId, entries] of subjectGroups) {
    const primary = entries[0];
    const pictures = entries.filter((entry) => entry.mediaKind === "image").map((entry) => `<${entry.providerLabel}>`);
    const videos = entries.filter((entry) => entry.mediaKind === "video").map((entry) => `<${entry.providerLabel}>`);
    const sources = [...pictures, ...videos].join(" and ");
    lines.push(`<${subjectId}> is ${primary.displayName || primary.semanticEntityId || primary.sourceAssetId}, defined by ${sources || "the referenced material"}. Preserve ${visibleDescription(primary)}.`);
  }
  for (const entry of manifest) {
    if (entry.mediaKind === "image" && !entry.logicalSubjectId) {
      const duty = visibleDescription(entry);
      lines.push(`<${entry.providerLabel}> is ${duty}.`);
    }
    if (entry.mediaKind === "video" && !entry.logicalSubjectId) {
      lines.push(`<${entry.providerLabel}> provides ${visibleDescription(entry)}.`);
    }
    if (entry.mediaKind === "audio") {
      const speakerId = entry.semanticEntityId ? speakers.get(entry.semanticEntityId) : undefined;
      const subject = entry.logicalSubjectId ? `<${entry.logicalSubjectId}>` : entry.displayName || entry.semanticEntityId;
      const usage = entry.audioUsage === "full_copy" || entry.purpose === "audio_copy"
        ? "the complete dialogue signal to reuse and synchronize"
        : "the voice-timbre reference; copy the vocal character but not the original spoken words";
      lines.push(`<${entry.providerLabel}> is ${usage} for ${subject || "the named speaker"}${speakerId ? ` (${speakerId})` : ""}.`);
    }
  }
  return lines.join("\n");
};

const retentionValue = (entry: VideoReferenceManifestEntry) => {
  if (entry.mediaKind === "audio") {
    return entry.audioUsage === "full_copy" || entry.purpose === "audio_copy" ? "fully_copy" : "reference";
  }
  if (entry.purpose === "composition" && entry.preservation === "flexible") return "weak_reference";
  return entry.preservation === "flexible" ? "partially_preserved" : "fully_preserved";
};

const timelineDescription = (
  beats: VideoTimelineBeat[],
  speakers: Map<string, string>,
  manifest: VideoReferenceManifestEntry[],
) => beats.map((beat, index) => {
  const header = index === 0 ? "[Shot 1]" : `[Shot ${index + 1}] At ${timecode(beat.startSeconds)}, the camera cuts to the next planned view.`;
  const storyboardLabels = index === 0
    ? manifest.filter((entry) => entry.sourceType === "storyboard_board" || entry.sourceType === "storyboard_panel").map((entry) => `<${entry.providerLabel}>`).join(" and ")
    : "";
  const parts = [
    header,
    storyboardLabels ? `Follow ${storyboardLabels} for the planned viewpoint, placement, and action order. Do not reproduce storyboard grid lines, arrows, panel numbers, or production annotations; preserve authored text that belongs inside the scene.` : "",
    beat.visibleAction.trim(),
    beat.performance.trim(),
    beat.camera.trim() ? `Camera: ${beat.camera.trim()}.` : "",
  ].filter(Boolean);
  for (const line of videoBeatDialogueLines(beat)) {
    const key = speakerKey(line);
    const speaker = key ? speakers.get(key) : undefined;
    const subject = manifest.find((entry) => entry.semanticEntityId === line.characterId && entry.logicalSubjectId);
    const identity = subject ? `<${subject.logicalSubjectId}>` : line.speakerName || manifest.find(entry => entry.mediaKind === "audio" && entry.semanticEntityId === line.characterId)?.displayName || "The speaker";
    const audio = manifest.find((entry) => entry.mediaKind === "audio" && entry.semanticEntityId === line.characterId);
    const audioDirection = audio
      ? audio.audioUsage === "full_copy" || audio.purpose === "audio_copy"
        ? `Reuse and synchronize the spoken signal from <${audio.providerLabel}>. `
        : `Use the voice timbre from <${audio.providerLabel}>, not its original words. `
      : "";
    const deliveryDirection = line.delivery && line.delivery !== "on_screen"
      ? `${line.delivery === "phone" ? "Telephone voice" : line.delivery === "voice_over" ? "Voice-over" : "Off-screen voice"}; keep the speaker off camera and do not assign lip movement to visible characters. ` : "";
    parts.push(`${deliveryDirection}${audioDirection}${identity}${speaker ? ` (${speaker})` : ""} says: <d>[${line.language || dialogueLanguage(line.text)}] ${line.text}</d>`);
  }
  return parts.join(" ");
}).join("\n\n");

const interactiveDescription = (intent: VideoGenerationIntent) => {
  const context = intent.interactiveContext;
  if (!context) return "";
  const state = context.visibleStateFacts.length
    ? `Keep these visible state facts: ${context.visibleStateFacts.join("; ")}.`
    : "";
  if (context.contentSlot === "entry") {
    return [
      "Interactive entry: show the visible result carried in from the previous choice before the node's main action begins.",
      context.incomingPhysicalResult ? `Incoming result: ${context.incomingPhysicalResult}.` : "",
      "Do not replay the player's choice and do not render interface text or buttons.",
      state,
    ].filter(Boolean).join(" ");
  }
  if (context.contentSlot === "choice_hold") {
    return [
      "Interactive choice wait: create a seamless idle loop that can hold while the player decides.",
      "Do not perform any outgoing choice, consequence, transition, selection gesture, interface text, or button inside the video.",
      context.uiSafeArea === "center_clear"
        ? "Keep the central interaction area visually clear while preserving the subject at a readable edge-safe position."
        : "Keep the declared interface-safe area clear.",
      "Use only small repeatable breathing, eye, cloth, light, smoke, dust, or environmental motion; make the first and last pose and sound bed loop cleanly.",
      state,
    ].filter(Boolean).join(" ");
  }
  if (context.contentSlot === "exit") {
    return [
      "Interactive exit: complete the current node's visible action and prepare a clean continuity handoff without showing the next choice result.",
      state,
    ].filter(Boolean).join(" ");
  }
  return ["Interactive main content: play the node's authored action without rendering interface text or buttons.", state].filter(Boolean).join(" ");
};

const projectVisualStyleDescription = (intent: VideoGenerationIntent) => {
  const contract = intent.visualStyleContract?.trim();
  return contract ? `<project_visual_style>\n${contract}\n</project_visual_style>` : "";
};

const authoredSoundscapeFallback = "Follow the authored sound directions and scene context. Preserve explicitly requested silence; do not invent dialogue, vocalizations, or sound effects.";
const authoredMusicFallback = "Follow any explicit non-diegetic music direction above; otherwise N/A. Do not add a score by default.";

const compileH3ReferencePrompt = (
  intent: VideoGenerationIntent,
  manifest: VideoReferenceManifestEntry[],
) => {
  const speakers = speakerMapForIntent(intent);
  const audios = manifest.filter((entry) => entry.mediaKind === "audio");
  const isAudioCopy = (entry: VideoReferenceManifestEntry) => entry.audioUsage === "full_copy" || entry.purpose === "audio_copy";
  const audioRelation = [audios.some(isAudioCopy) ? " + audio reuse" : "", audios.some((entry) => !isAudioCopy(entry)) ? " + audio reference" : ""].join("");
  const soundscape = intent.timelineBeats.flatMap((beat) => beat.soundCues).filter(Boolean);
  const projectVisualStyle = projectVisualStyleDescription(intent);
  return [
    "subject_definitions:",
    subjectDefinitions(manifest, speakers),
    "",
    projectVisualStyle,
    "",
    "summary:",
    `[reference generation${audioRelation}] ${intent.directorIntent.trim()}`,
    "",
    "retention_analysis:",
    Array.from(new Set(manifest.map((entry) => `<${entry.mediaKind !== "audio" && entry.logicalSubjectId ? entry.logicalSubjectId : entry.providerLabel}>: ${retentionValue(entry)}`))).join("\n"),
    "",
    "detailed_description:",
    timelineDescription(intent.timelineBeats, speakers, manifest),
    interactiveDescription(intent),
    "",
    "overall_soundscape:",
    soundscape.length > 0 ? soundscape.join("; ") : authoredSoundscapeFallback,
    "",
    "non_diegetic_music:",
    authoredMusicFallback,
  ].join("\n");
};

const compileH3FramePrompt = (
  intent: VideoGenerationIntent,
  manifest: VideoReferenceManifestEntry[],
) => {
  const speakers = speakerMapForIntent(intent);
  const soundscape = intent.timelineBeats.flatMap((beat) => beat.soundCues).filter(Boolean);
  const projectVisualStyle = projectVisualStyleDescription(intent);
  const startFrame = manifest.find((entry) => entry.sourceType === "start_frame");
  const endFrame = manifest.find((entry) => entry.sourceType === "end_frame");
  const finalShot = intent.timelineBeats.length || 1;
  const frameAlignment = startFrame && endFrame
    ? `How the reference pictures align with the target video: <${startFrame.providerLabel}> (from Shot 1) aligns with the 0.00-second mark; <${endFrame.providerLabel}> (from Shot ${finalShot}) aligns with the ${intent.durationSeconds.toFixed(2)}-second mark of the target video.`
    : startFrame
      ? `For the target video, at 0.00 seconds into the target video, <${startFrame.providerLabel}> (from Shot 1) is fully referenced.`
      : endFrame
        ? `How the reference pictures align with the target video: <${endFrame.providerLabel}> (from Shot ${finalShot}) aligns with the ${intent.durationSeconds.toFixed(2)}-second mark of the target video.`
        : "";
  return [
    ...(frameAlignment ? [frameAlignment, ""] : []),
    "integrated_multimodal_description:",
    projectVisualStyle,
    intent.directorIntent.trim(),
    timelineDescription(intent.timelineBeats, speakers, []),
    interactiveDescription(intent),
    "",
    "overall_soundscape:",
    soundscape.length > 0 ? soundscape.join("; ") : authoredSoundscapeFallback,
    "",
    "non_diegetic_music:",
    authoredMusicFallback,
  ].join("\n");
};

const durationIssues = (intent: VideoGenerationIntent): VideoAdapterIssue[] => {
  if (Number.isInteger(intent.durationSeconds) && intent.durationSeconds >= 4 && intent.durationSeconds <= 15) return [];
  return [{ severity: "blocking", code: "H3_DURATION_INVALID", field: "durationSeconds", message: "MiniMax H3 单次时长必须是 4-15 秒整数，请先在故事板中调整当前视频单元。" }];
};

const mediaLimitIssues = (
  manifest: VideoReferenceManifestEntry[],
): VideoAdapterIssue[] => {
  const issues: VideoAdapterIssue[] = [];
  const images = manifest.filter((entry) => entry.mediaKind === "image");
  const videos = manifest.filter((entry) => entry.mediaKind === "video");
  const audios = manifest.filter((entry) => entry.mediaKind === "audio");
  if (images.length > 9) issues.push({ severity: "blocking", code: "H3_IMAGE_LIMIT_EXCEEDED", message: `MiniMax H3 最多接收 9 张参考图片，当前为 ${images.length} 张；不能静默丢弃素材。` });
  if (videos.length > 3) issues.push({ severity: "blocking", code: "H3_VIDEO_LIMIT_EXCEEDED", message: `MiniMax H3 最多接收 3 段参考视频，当前为 ${videos.length} 段。` });
  if (audios.length > 3) issues.push({ severity: "blocking", code: "H3_AUDIO_LIMIT_EXCEEDED", message: `MiniMax H3 最多接收 3 段参考声音，当前为 ${audios.length} 段；请拆分视频单元。` });
  if (manifest.length > 12) issues.push({ severity: "blocking", code: "H3_MEDIA_LIMIT_EXCEEDED", message: `MiniMax H3 混合参考素材最多 12 份，当前为 ${manifest.length} 份。` });
  if (audios.length > 0 && images.length + videos.length === 0) issues.push({ severity: "blocking", code: "H3_AUDIO_WITHOUT_VISUAL_REFERENCE", message: "MiniMax H3 参考声音不能单独提交，至少需要一张参考图片或一段参考视频。" });
  for (const entry of [...videos, ...audios]) {
    if (entry.mediaDurationSeconds !== undefined && (entry.mediaDurationSeconds < 2 || entry.mediaDurationSeconds > 15)) {
      issues.push({ severity: "blocking", code: "H3_REFERENCE_DURATION_INVALID", bindingId: entry.bindingId, message: `${entry.displayName || entry.providerLabel} 必须是 2-15 秒。` });
    }
  }
  for (const entries of [videos, audios]) {
    const durations = entries.map((entry) => entry.mediaDurationSeconds);
    if (durations.length > 0 && durations.every((value) => value !== undefined)) {
      const total = durations.reduce((sum, value) => sum + Number(value), 0);
      if (total > 15) issues.push({ severity: "blocking", code: "H3_REFERENCE_TOTAL_DURATION_EXCEEDED", message: `同类参考素材总时长不能超过 15 秒，当前为 ${total} 秒。` });
    }
  }
  return issues;
};

const relationshipIssues = (
  intent: VideoGenerationIntent,
  manifest: VideoReferenceManifestEntry[],
): VideoAdapterIssue[] => {
  const issues: VideoAdapterIssue[] = [];
  const lines = intent.timelineBeats.flatMap(videoBeatDialogueLines);
  const isVoiceOnly = (id: string) => {
    const spoken = lines.filter(line => line.characterId === id);
    return spoken.length > 0 && spoken.every(line => line.delivery && line.delivery !== "on_screen");
  };
  const visualEntityIds = new Set(manifest.filter((entry) => entry.mediaKind !== "audio" && entry.semanticEntityId).map((entry) => entry.semanticEntityId));
  for (const entry of manifest.filter((item) => item.mediaKind === "audio")) {
    if (!entry.semanticEntityId) {
      issues.push({ severity: "blocking", code: "H3_AUDIO_SPEAKER_MISSING", bindingId: entry.bindingId, message: `${entry.displayName || entry.providerLabel} 没有明确绑定人物。` });
    } else if (!visualEntityIds.has(entry.semanticEntityId) && !isVoiceOnly(entry.semanticEntityId)) {
      issues.push({ severity: "blocking", code: "H3_AUDIO_SUBJECT_MISSING", bindingId: entry.bindingId, message: `${entry.displayName || entry.providerLabel} 绑定的人物没有出现在当前最小参考包中。` });
    }
  }
  const timelineSpeakerIds = new Set(intent.timelineBeats.flatMap(videoBeatDialogueLines).map((line) => line.characterId).filter(Boolean));
  for (const speakerId of timelineSpeakerIds) {
    if (intent.audioPolicy.mode === "generate_with_voice_reference" && !manifest.some((entry) => entry.mediaKind === "audio" && entry.semanticEntityId === speakerId)) {
      issues.push({ severity: "blocking", code: "H3_SPEAKER_VOICE_MISSING", message: `说话人物 ${speakerId} 缺少明确的人物声音绑定。` });
    }
  }
  return issues;
};

const compilePlan = ({
  intent,
  modelConfigId,
  adapterId,
  resolution,
  contractEnforcement,
}: {
  intent: VideoGenerationIntent;
  modelConfigId: string;
  adapterId: string;
  resolution?: string;
  contractEnforcement?: "draft" | "formal";
}): VideoGenerationAdapterPlan => {
  const generationMode = miniMaxH3GenerationModeForAdapter(adapterId);
  if (!generationMode) throw new Error(`Unsupported MiniMax H3 adapter: ${adapterId}`);
  const isReferenceMode = generationMode === "multimodal_reference";
  const isTextMode = generationMode === "text_only";
  const manifest = buildVideoReferenceManifest(intent.referenceBindings);
  const referenceEntries = manifest.filter((entry) => entry.sourceType !== "start_frame" && entry.sourceType !== "end_frame");
  const frameEntries = manifest.filter((entry) => entry.sourceType === "start_frame" || entry.sourceType === "end_frame");
  const effectiveManifest = isReferenceMode ? referenceEntries : isTextMode ? [] : frameEntries;
  const issues = durationIssues(intent);
  if (intent.audioPolicy.mode === "reuse_final_dialogue_audio" && intent.audioPolicy.dialogueAudioAssetIds.length === 0) {
    issues.push({ severity: "blocking", code: "H3_DIALOGUE_MASTER_MISSING", message: "已选择使用现有完整配音，但当前视频单元没有可用的完整配音母带。" });
  }
  if (isReferenceMode) {
    if (frameEntries.length > 0) issues.push({ severity: "blocking", code: "H3_REFERENCE_FRAME_MODE_CONFLICT", message: "“参考多份素材”和“严格从这张画面开始”不能混在同一次 MiniMax H3 请求中，请选择一种生成方式。" });
    issues.push(...mediaLimitIssues(referenceEntries), ...relationshipIssues(intent, referenceEntries));
    if (!referenceEntries.some((entry) => entry.mediaKind === "image" || entry.mediaKind === "video")) {
      issues.push({ severity: "blocking", code: "H3_REFERENCE_MISSING", message: "MiniMax H3 多素材参考方式至少需要一份作者明确选择的图片或视频参考。" });
    }
  } else if (isTextMode) {
    if (manifest.length > 0) issues.push({ severity: "blocking", code: "H3_TEXT_REFERENCE_MODE_CONFLICT", message: "纯文本方式不能发送首尾帧、资产、故事板或参考声音。" });
    if (intent.aspectRatio === "adaptive" || !MINIMAX_H3_RATIOS.includes(intent.aspectRatio as (typeof MINIMAX_H3_RATIOS)[number])) {
      issues.push({ severity: "blocking", code: "H3_TEXT_RATIO_REQUIRED", field: "aspectRatio", message: "MiniMax H3 纯文本生成需要明确画幅，请选择 16:9、9:16 等画幅，不能使用自动画幅。" });
    }
  } else {
    if (referenceEntries.length > 0) issues.push({ severity: "blocking", code: "H3_FRAME_REFERENCE_MODE_CONFLICT", message: "严格首帧/首尾画面方式不能同时发送角色板、场景板、道具板或参考声音。" });
    const startFrames = frameEntries.filter((entry) => entry.sourceType === "start_frame");
    const endFrames = frameEntries.filter((entry) => entry.sourceType === "end_frame");
    if (startFrames.length > 1 || endFrames.length > 1) issues.push({ severity: "blocking", code: "H3_FRAME_COUNT_INVALID", message: "每次 MiniMax H3 请求最多只能包含一张首帧和一张尾帧。" });
    if (generationMode === "first_frame" && (startFrames.length !== 1 || endFrames.length !== 0)) issues.push({ severity: "blocking", code: "H3_I2VA_FRAME_INVALID", message: "图生视频方式需要且只能发送一张首帧。" });
    if (generationMode === "first_last_frame" && (startFrames.length !== 1 || endFrames.length !== 1)) issues.push({ severity: "blocking", code: "H3_FL2VA_FRAME_INVALID", message: "首尾帧方式需要各一张首帧和尾帧。" });
    if (generationMode === "last_frame" && (startFrames.length !== 0 || endFrames.length !== 1)) issues.push({ severity: "blocking", code: "H3_L2VA_FRAME_INVALID", message: "尾帧驱动方式需要且只能发送一张尾帧。" });
  }
  if (!isReferenceMode && intent.audioPolicy.mode === "generate_with_voice_reference") {
    issues.push({ severity: "blocking", code: "H3_BASE_MODE_AUDIO_REFERENCE_CONFLICT", message: "文本或关键帧方式不能发送参考声音；请改用多素材参考，或选择模型原生声音/后期配音。" });
  }
  const recipeBoundary = buildVideoVisualRecipeBoundary({
    intent,
    adapterId,
    enforcement: contractEnforcement,
  });
  const modelPrompt = isReferenceMode
    ? compileH3ReferencePrompt(intent, effectiveManifest)
    : compileH3FramePrompt(intent, effectiveManifest);
  const prompt = [modelPrompt, recipeBoundary.promptBlock].join("\n\n");
  if (prompt.length > 7000) issues.push({ severity: "blocking", code: "H3_PROMPT_TOO_LONG", field: "adapterPrompt", message: `MiniMax H3 模型提示词最多 7000 字符，当前为 ${prompt.length} 字符。` });
  const selectedResolution = MINIMAX_H3_RESOLUTIONS.includes(resolution as (typeof MINIMAX_H3_RESOLUTIONS)[number]) ? resolution! : "768P";
  return {
    schemaVersion: "video-generation-adapter-plan.v1",
    adapterId,
    adapterVersion: "v1",
    modelConfigId,
    mode: generationMode,
    resolution: selectedResolution,
    referenceManifest: effectiveManifest,
    timelinePlan: intent.timelineBeats,
    canonicalPrompt: intent.directorIntent,
    adapterPrompt: prompt,
    visualRecipeContract: recipeBoundary.contract,
    visualStyleCompileManifest: recipeBoundary.visualStyleCompileManifest,
    requestPreview: {
      imageCount: effectiveManifest.filter((entry) => entry.mediaKind === "image").length,
      videoCount: effectiveManifest.filter((entry) => entry.mediaKind === "video").length,
      audioCount: effectiveManifest.filter((entry) => entry.mediaKind === "audio").length,
      durationSeconds: intent.durationSeconds,
      nativeAudioExpected: true,
    },
    issues,
    sourceHash: intent.sourceHash,
  };
};

const limits = {
  minDurationSeconds: 4,
  maxDurationSeconds: 15,
  aspectRatios: [...MINIMAX_H3_RATIOS],
  resolutions: [...MINIMAX_H3_RESOLUTIONS],
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
  maxPromptCharacters: 7000,
};

export const MINIMAX_H3_VIDEO_ADAPTERS: VideoModelAdapterDefinition[] = [
  {
    id: MINIMAX_H3_REF2VA_ADAPTER_ID,
    version: "v1",
    displayName: "MiniMax H3 多素材参考",
    matches: [{ channelType: "minimax", modelIdPattern: /^MiniMax-H3$/i }],
    modes: [{ id: "multimodal_reference", displayName: "多素材参考", requiresStartFrame: false, acceptsStartFrame: false, acceptsEndFrame: false, nativeAudioExpected: true }],
    limits,
    capabilities: { firstFrame: false, lastFrame: false, referenceImages: true, referenceVideos: true, referenceAudios: true, nativeAudio: true, dialogueVoiceReference: true, multiShot: true },
    compile: (input) => compilePlan({ ...input, adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID }),
  },
  {
    id: MINIMAX_H3_T2VA_ADAPTER_ID,
    version: "v1",
    displayName: "MiniMax H3 纯文本",
    matches: [],
    selectableMatches: [{ channelType: "minimax", modelIdPattern: /^MiniMax-H3$/i }],
    modes: [{ id: "text_only", displayName: "纯文本", requiresStartFrame: false, acceptsStartFrame: false, acceptsEndFrame: false, nativeAudioExpected: true }],
    limits: { ...limits, maxReferenceImages: 0, maxReferenceVideos: 0, maxReferenceAudios: 0 },
    capabilities: { firstFrame: false, lastFrame: false, referenceImages: false, referenceVideos: false, referenceAudios: false, nativeAudio: true, dialogueVoiceReference: false, multiShot: true },
    compile: (input) => compilePlan({ ...input, adapterId: MINIMAX_H3_T2VA_ADAPTER_ID }),
  },
  {
    id: MINIMAX_H3_I2VA_ADAPTER_ID,
    version: "v1",
    displayName: "MiniMax H3 图生视频",
    matches: [],
    selectableMatches: [{ channelType: "minimax", modelIdPattern: /^MiniMax-H3$/i }],
    modes: [{ id: "first_frame", displayName: "图生视频", requiresStartFrame: true, acceptsStartFrame: true, acceptsEndFrame: false, nativeAudioExpected: true }],
    limits: { ...limits, maxReferenceImages: 1, maxReferenceVideos: 0, maxReferenceAudios: 0 },
    capabilities: { firstFrame: true, lastFrame: false, referenceImages: false, referenceVideos: false, referenceAudios: false, nativeAudio: true, dialogueVoiceReference: false, multiShot: true },
    compile: (input) => compilePlan({ ...input, adapterId: MINIMAX_H3_I2VA_ADAPTER_ID }),
  },
  {
    id: MINIMAX_H3_FL2VA_ADAPTER_ID,
    version: "v1",
    displayName: "MiniMax H3 首帧/首尾画面",
    matches: [],
    selectableMatches: [{ channelType: "minimax", modelIdPattern: /^MiniMax-H3$/i }],
    modes: [{ id: "first_last_frame", displayName: "首尾帧", requiresStartFrame: true, requiresEndFrame: true, acceptsStartFrame: true, acceptsEndFrame: true, nativeAudioExpected: true }],
    limits: { ...limits, maxReferenceImages: 2, maxReferenceVideos: 0, maxReferenceAudios: 0 },
    capabilities: { firstFrame: true, lastFrame: true, referenceImages: false, referenceVideos: false, referenceAudios: false, nativeAudio: true, dialogueVoiceReference: false, multiShot: true },
    compile: (input) => compilePlan({ ...input, adapterId: MINIMAX_H3_FL2VA_ADAPTER_ID }),
  },
  {
    id: MINIMAX_H3_L2VA_ADAPTER_ID,
    version: "v1",
    displayName: "MiniMax H3 尾帧驱动",
    matches: [],
    selectableMatches: [{ channelType: "minimax", modelIdPattern: /^MiniMax-H3$/i }],
    modes: [{ id: "last_frame", displayName: "尾帧驱动", requiresStartFrame: false, requiresEndFrame: true, acceptsStartFrame: false, acceptsEndFrame: true, nativeAudioExpected: true }],
    limits: { ...limits, maxReferenceImages: 1, maxReferenceVideos: 0, maxReferenceAudios: 0 },
    capabilities: { firstFrame: false, lastFrame: true, referenceImages: false, referenceVideos: false, referenceAudios: false, nativeAudio: true, dialogueVoiceReference: false, multiShot: true },
    compile: (input) => compilePlan({ ...input, adapterId: MINIMAX_H3_L2VA_ADAPTER_ID }),
  },
];

export type MiniMaxH3ContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role: "first_frame" | "last_frame" | "reference_image" }
  | { type: "video_url"; video_url: { url: string }; role: "reference_video" }
  | { type: "audio_url"; audio_url: { url: string }; role: "reference_audio" };

export interface MiniMaxH3VideoRequest {
  model: typeof MINIMAX_H3_MODEL_ID;
  content: MiniMaxH3ContentItem[];
  resolution: "768P" | "2K";
  duration: number;
  ratio: (typeof MINIMAX_H3_RATIOS)[number];
}

const promptMatches = (value: string, pattern: RegExp) => Array.from(new Set(value.match(pattern) || []));

export const validateMiniMaxH3FinalPrompt = (
  plan: VideoGenerationAdapterPlan,
  promptValue: string,
): VideoAdapterIssue[] => {
  const prompt = promptValue.trim();
  const issues: VideoAdapterIssue[] = [];
  if (!prompt) return [{ severity: "blocking", code: "H3_FINAL_PROMPT_EMPTY", field: "finalConfirmedPrompt", message: "MiniMax H3 模型提示词不能为空。" }];
  if (prompt.length > 7000) {
    issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_TOO_LONG", field: "finalConfirmedPrompt", message: `MiniMax H3 模型提示词最多 7000 字符，当前为 ${prompt.length} 字符。` });
  }

  const headings = plan.adapterId === MINIMAX_H3_REF2VA_ADAPTER_ID
    ? ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]
    : ["integrated_multimodal_description:", "overall_soundscape:", "non_diegetic_music:"];
  let previousIndex = -1;
  for (const heading of headings) {
    const firstIndex = prompt.indexOf(heading);
    const lastIndex = prompt.lastIndexOf(heading);
    if (firstIndex < 0 || firstIndex !== lastIndex || firstIndex <= previousIndex) {
      issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_STRUCTURE_INVALID", field: "finalConfirmedPrompt", message: `MiniMax H3 模型提示词中的 ${heading} 缺失、重复或顺序不正确。` });
    }
    previousIndex = Math.max(previousIndex, firstIndex);
  }

  const tokenPattern = /<(?:Subject|Picture|Video|Audio) \d+>/g;
  const baselineTokens = promptMatches(plan.adapterPrompt, tokenPattern);
  const finalTokens = promptMatches(prompt, tokenPattern);
  const missingTokens = baselineTokens.filter((token) => !finalTokens.includes(token));
  const unknownTokens = finalTokens.filter((token) => !baselineTokens.includes(token));
  if (missingTokens.length > 0 || unknownTokens.length > 0) {
    issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_REFERENCE_MISMATCH", field: "finalConfirmedPrompt", message: "MiniMax H3 模型提示词中的人物或引用素材标签与本次最小素材包不一致。" });
  }

  const shotPattern = /\[Shot \d+\](?: At \d{2}:\d{2}\.\d{3})?/g;
  const baselineShots = plan.adapterPrompt.match(shotPattern) || [];
  const finalShots = prompt.match(shotPattern) || [];
  if (baselineShots.length !== finalShots.length || baselineShots.some((shot, index) => shot !== finalShots[index])) {
    issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_TIMELINE_MISMATCH", field: "finalConfirmedPrompt", message: "MiniMax H3 模型提示词修改了故事板已经确认的镜头顺序或切换时间。" });
  }

  const dialoguePattern = /<d>\[[^\]]+\][\s\S]*?<\/d>/g;
  const baselineDialogue = plan.adapterPrompt.match(dialoguePattern) || [];
  const finalDialogue = prompt.match(dialoguePattern) || [];
  if (baselineDialogue.length !== finalDialogue.length || baselineDialogue.some((dialogue, index) => dialogue !== finalDialogue[index])) {
    issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_DIALOGUE_MISMATCH", field: "finalConfirmedPrompt", message: "MiniMax H3 模型提示词修改了故事板已经确认的对白或语言标签。" });
  }

  const alignment = plan.adapterPrompt.split("\n")[0];
  if ((alignment.startsWith("For the target video, at") || alignment.startsWith("How the reference pictures align")) && prompt.split("\n")[0] !== alignment) {
    issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_FRAME_ALIGNMENT_MISMATCH", field: "finalConfirmedPrompt", message: "MiniMax H3 提示词的首尾帧位置与本次所选画面或时长不一致。" });
  }

  const styleContractPattern = /<project_visual_style>[\s\S]*?<\/project_visual_style>/g;
  const baselineStyleContracts = plan.adapterPrompt.match(styleContractPattern) || [];
  const finalStyleContracts = prompt.match(styleContractPattern) || [];
  if (
    baselineStyleContracts.length > 0
    && (baselineStyleContracts.length !== finalStyleContracts.length
      || baselineStyleContracts.some((contract, index) => contract !== finalStyleContracts[index]))
  ) {
    issues.push({ severity: "blocking", code: "H3_FINAL_PROMPT_STYLE_CONTRACT_MISMATCH", field: "finalConfirmedPrompt", message: "MiniMax H3 模型提示词修改或删除了项目已经确认的视觉风格约束。" });
  }
  return issues;
};

export const buildMiniMaxH3VideoRequest = (
  intent: VideoGenerationIntent,
  plan: VideoGenerationAdapterPlan,
): MiniMaxH3VideoRequest => {
  const blockingIssue = plan.issues.find((issue) => issue.severity === "blocking");
  if (blockingIssue) throw new Error(blockingIssue.message);
  const prompt = plan.finalConfirmedPrompt?.trim() || plan.adapterPrompt.trim();
  assertFinalVideoPromptPreservesVisualStyleContract(intent, plan, prompt);
  const finalPromptIssue = validateMiniMaxH3FinalPrompt(plan, prompt).find((issue) => issue.severity === "blocking");
  if (finalPromptIssue) throw new Error(finalPromptIssue.message);
  const referenceMode = plan.adapterId === MINIMAX_H3_REF2VA_ADAPTER_ID;
  const generationMode = miniMaxH3GenerationModeForAdapter(plan.adapterId);
  const content: MiniMaxH3ContentItem[] = [{ type: "text", text: prompt }];
  for (const entry of plan.referenceManifest) {
    if (referenceMode) {
      if (entry.mediaKind === "image") content.push({ type: "image_url", image_url: { url: entry.mediaUrl }, role: "reference_image" });
      if (entry.mediaKind === "video") content.push({ type: "video_url", video_url: { url: entry.mediaUrl }, role: "reference_video" });
      if (entry.mediaKind === "audio") content.push({ type: "audio_url", audio_url: { url: entry.mediaUrl }, role: "reference_audio" });
    } else if (entry.sourceType === "start_frame") {
      content.push({ type: "image_url", image_url: { url: entry.mediaUrl }, role: "first_frame" });
    } else if (entry.sourceType === "end_frame") {
      content.push({ type: "image_url", image_url: { url: entry.mediaUrl }, role: "last_frame" });
    }
  }
  return {
    model: MINIMAX_H3_MODEL_ID,
    content,
    resolution: plan.resolution === "2K" ? "2K" : "768P",
    duration: intent.durationSeconds,
    ratio: (referenceMode || generationMode === "text_only") && MINIMAX_H3_RATIOS.includes(intent.aspectRatio as (typeof MINIMAX_H3_RATIOS)[number])
      ? intent.aspectRatio as (typeof MINIMAX_H3_RATIOS)[number]
      : "adaptive",
  };
};
