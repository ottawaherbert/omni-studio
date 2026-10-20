import { interactiveDescription } from "../interactiveVideoInstructions";
import type { VideoGenerationIntent } from "../videoGenerationIntent";
import {
  assertFinalVideoPromptPreservesVisualStyleContract,
  buildVideoVisualRecipeBoundary,
  type VideoAdapterIssue,
  type VideoGenerationAdapterPlan,
  type VideoModelAdapterDefinition,
} from "../videoModelAdapter";
import { buildVideoReferenceManifest } from "../videoReferenceManifest";

export const GENERIC_I2V_ADAPTER_ID = "video.generic.i2v.v1";
export const GENERIC_FL2V_ADAPTER_ID = "video.generic.fl2v.v1";
export const KIE_GROK_I2V_ADAPTER_ID = "video.kie.grok.i2v.v1";

const adapterLimits = {
  minDurationSeconds: 1,
  maxDurationSeconds: 15,
  aspectRatios: ["16:9", "9:16"],
  resolutions: ["480p", "720p"],
  maxReferenceImages: 2,
  maxReferenceVideos: 0,
  maxReferenceAudios: 0,
};

const validateGenericIntent = (
  intent: VideoGenerationIntent,
  acceptsEndFrame: boolean,
): VideoAdapterIssue[] => {
  const issues: VideoAdapterIssue[] = [];
  if (intent.referenceBindings.some(binding => binding.sourceType === 'voice_reference_audio' || binding.sourceType === 'final_dialogue_audio')
    || intent.audioPolicy.mode === 'reuse_final_dialogue_audio' || intent.audioPolicy.mode === 'generate_with_voice_reference') {
    issues.push({ severity: 'blocking', code: 'VIDEO_AUDIO_REFERENCE_UNSUPPORTED', field: 'audioPolicy', message: '当前视频接口不接收参考音频。请保留声音资产，待视频生成后另行替换配音或在时间线混音。' });
  }
  const startFrame = intent.referenceBindings.find((binding) => binding.sourceType === "start_frame");
  const endFrame = intent.referenceBindings.find((binding) => binding.sourceType === "end_frame");
  if (!intent.directorIntent.trim()) {
    issues.push({ severity: "blocking", code: "VIDEO_PROMPT_EMPTY", field: "directorIntent", message: "视频生成提示词不能为空。" });
  }
  if (!startFrame?.mediaUrl.trim()) {
    issues.push({ severity: "blocking", code: "VIDEO_START_FRAME_MISSING", field: "referenceBindings", message: "当前生成方式需要一张已采用的首帧图片。" });
  }
  if (endFrame && !acceptsEndFrame) {
    issues.push({ severity: "blocking", code: "VIDEO_END_FRAME_UNSUPPORTED", bindingId: endFrame.id, message: "当前生成方式只支持首帧，不能发送尾帧。" });
  }
  if (!Number.isFinite(intent.durationSeconds) || intent.durationSeconds <= 0) {
    issues.push({ severity: "blocking", code: "VIDEO_DURATION_INVALID", field: "durationSeconds", message: "视频时长必须是正数。" });
  }
  return issues;
};

export const compileGenericVideoAdapterPlan = ({
  intent,
  modelConfigId,
  adapterId,
  mode,
  resolution,
  contractEnforcement,
}: {
  intent: VideoGenerationIntent;
  modelConfigId: string;
  adapterId: string;
  mode?: string;
  resolution?: string;
  contractEnforcement?: "draft" | "formal";
}): VideoGenerationAdapterPlan => {
  const acceptsEndFrame = adapterId === GENERIC_FL2V_ADAPTER_ID;
  const manifest = buildVideoReferenceManifest(intent.referenceBindings);
  const recipeBoundary = buildVideoVisualRecipeBoundary({
    intent,
    adapterId,
    enforcement: contractEnforcement,
  });
  const adapterPrompt = [
    intent.directorIntent.trim(),
    interactiveDescription(intent),
    intent.visualStyleContract?.trim()
      ? `<project_visual_style>\n${intent.visualStyleContract.trim()}\n</project_visual_style>`
      : "",
    recipeBoundary.promptBlock,
  ].filter(Boolean).join("\n\n");
  return {
    schemaVersion: "video-generation-adapter-plan.v1",
    adapterId,
    adapterVersion: "v1",
    modelConfigId,
    mode: mode || (acceptsEndFrame ? "start_end_frames" : "start_frame"),
    resolution,
    referenceManifest: manifest,
    timelinePlan: intent.timelineBeats,
    canonicalPrompt: intent.directorIntent,
    adapterPrompt,
    visualRecipeContract: recipeBoundary.contract,
    visualStyleCompileManifest: recipeBoundary.visualStyleCompileManifest,
    requestPreview: {
      imageCount: manifest.filter((entry) => entry.mediaKind === "image").length,
      videoCount: manifest.filter((entry) => entry.mediaKind === "video").length,
      audioCount: manifest.filter((entry) => entry.mediaKind === "audio").length,
      durationSeconds: intent.durationSeconds,
      nativeAudioExpected: false,
    },
    issues: validateGenericIntent(intent, acceptsEndFrame),
    sourceHash: intent.sourceHash,
  };
};

const genericDefinition = ({
  id,
  displayName,
  matches,
  acceptsEndFrame,
}: {
  id: string;
  displayName: string;
  matches: VideoModelAdapterDefinition["matches"];
  acceptsEndFrame: boolean;
}): VideoModelAdapterDefinition => ({
  id,
  version: "v1",
  displayName,
  matches,
  modes: [{
    id: acceptsEndFrame ? "start_end_frames" : "start_frame",
    displayName: acceptsEndFrame ? "首帧/首尾画面" : "首帧画面",
    requiresStartFrame: true,
    acceptsEndFrame,
    nativeAudioExpected: false,
  }],
  limits: adapterLimits,
  capabilities: {
    firstFrame: true,
    lastFrame: acceptsEndFrame,
    referenceImages: false,
    referenceVideos: false,
    referenceAudios: false,
    nativeAudio: false,
    dialogueVoiceReference: false,
    multiShot: false,
  },
  compile: (input) => compileGenericVideoAdapterPlan({ ...input, adapterId: id }),
});

export const GENERIC_VIDEO_ADAPTERS: VideoModelAdapterDefinition[] = [
  genericDefinition({ id: KIE_GROK_I2V_ADAPTER_ID, displayName: "KIE Grok 视频", matches: [{ channelType: "kie", modelIdPattern: /grok-imagine(?:\/-|[-/])?video|grok-imagine\/image-to-video/i }], acceptsEndFrame: false }),
  genericDefinition({ id: GENERIC_FL2V_ADAPTER_ID, displayName: "通用首尾画面", matches: [], acceptsEndFrame: true }),
  genericDefinition({ id: GENERIC_I2V_ADAPTER_ID, displayName: "通用首帧", matches: [], acceptsEndFrame: false }),
];

export interface LegacyGenericVideoRequest {
  prompt: string;
  imageUrl: string;
  durationSeconds: number;
  endImageUrl?: string;
  aspectRatio: "16:9" | "9:16";
}

export const buildLegacyGenericVideoRequest = (
  intent: VideoGenerationIntent,
  plan: VideoGenerationAdapterPlan,
): LegacyGenericVideoRequest => {
  const blockingIssue = plan.issues.find((issue) => issue.severity === "blocking");
  if (blockingIssue) throw new Error(blockingIssue.message);
  const finalPrompt = plan.finalConfirmedPrompt?.trim() || plan.adapterPrompt;
  assertFinalVideoPromptPreservesVisualStyleContract(intent, plan, finalPrompt);
  const startFrame = plan.referenceManifest.find((entry) => entry.sourceType === "start_frame");
  const endFrame = plan.referenceManifest.find((entry) => entry.sourceType === "end_frame");
  if (!startFrame) throw new Error("当前生成方式需要一张已采用的首帧图片。");
  return {
    prompt: finalPrompt,
    imageUrl: startFrame.mediaUrl,
    durationSeconds: intent.durationSeconds,
    ...(endFrame ? { endImageUrl: endFrame.mediaUrl } : {}),
    aspectRatio: intent.aspectRatio === "9:16" ? "9:16" : "16:9",
  };
};
