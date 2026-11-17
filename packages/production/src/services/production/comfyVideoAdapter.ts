import type { ComfyCapabilities } from '../../../../domain/src/comfyWorkflow';
import { interactiveDescription } from './interactiveVideoInstructions';
import { buildVideoReferenceManifest } from './videoReferenceManifest';
import { buildVideoVisualRecipeBoundary, type VideoModelAdapterDefinition } from './videoModelAdapter';

export function createComfyVideoAdapter(api: ComfyCapabilities): VideoModelAdapterDefinition {
  const id = 'video.comfyui.api.v1';
  return {
    id, version: 'v1', displayName: `ComfyUI ${api.operation}`, matches: [],
    modes: [{ id: api.operation === 't2v' ? 'text_only' : api.operation === 'i2v' ? 'first_frame' : 'multimodal_reference', displayName: api.operation === 't2v' ? '文生视频' : api.operation === 'i2v' ? '图生视频' : '素材参考视频', requiresStartFrame: api.operation === 'i2v', acceptsStartFrame: api.operation === 'i2v', acceptsEndFrame: false, nativeAudioExpected: api.nativeAudio }],
    limits: { minDurationSeconds: api.minDuration, maxDurationSeconds: api.maxDuration, aspectRatios: api.aspectRatios || ['16:9', '9:16', '1:1'], resolutions: [], maxReferenceImages: api.imageInputs, maxReferenceVideos: api.videoInputs, maxReferenceAudios: api.audioInputs },
    capabilities: { firstFrame: api.operation === 'i2v', lastFrame: false, referenceImages: api.operation === 'reference_video' && api.imageInputs > 0, referenceVideos: api.videoInputs > 0, referenceAudios: api.audioInputs > 0, nativeAudio: api.nativeAudio, dialogueVoiceReference: api.audioInputs > 0, multiShot: api.multiShot === true },
    compile: ({ intent, modelConfigId, contractEnforcement }) => {
      const manifest = buildVideoReferenceManifest(intent.referenceBindings);
      const boundary = buildVideoVisualRecipeBoundary({ intent, adapterId: id, enforcement: contractEnforcement });
      const counts = { image: api.imageInputs, video: api.videoInputs, audio: api.audioInputs };
      const issues = (Object.keys(counts) as Array<keyof typeof counts>).flatMap(kind => manifest.filter(m => m.mediaKind === kind).length === counts[kind] ? [] : [{ severity: 'blocking' as const, code: 'COMFY_REFERENCE_COUNT', message: `所选工作流需要 ${counts[kind]} 个 ${kind} 素材，不能忽略或补造输入。` }]);
      if (intent.durationSeconds < api.minDuration || intent.durationSeconds > api.maxDuration) issues.push({ severity: 'blocking', code: 'COMFY_DURATION', message: `视频时长须在 ${api.minDuration}–${api.maxDuration} 秒内。` });
      if (intent.referenceBindings.some(b => b.sourceType === 'end_frame')) issues.push({ severity: 'blocking', code: 'COMFY_END_FRAME', message: '此工作流没有声明尾帧输入，请选择已配置对应能力的工作流。' });
      const adapterPrompt = [intent.directorIntent.trim(), interactiveDescription(intent), intent.visualStyleContract?.trim() ? `<project_visual_style>\n${intent.visualStyleContract.trim()}\n</project_visual_style>` : '', boundary.promptBlock].filter(Boolean).join('\n\n');
      return { schemaVersion: 'video-generation-adapter-plan.v1', adapterId: id, adapterVersion: 'v1', modelConfigId, mode: api.operation === 't2v' ? 'text_only' : api.operation === 'i2v' ? 'first_frame' : 'multimodal_reference', referenceManifest: manifest, timelinePlan: intent.timelineBeats, canonicalPrompt: intent.directorIntent, adapterPrompt, visualRecipeContract: boundary.contract, visualStyleCompileManifest: boundary.visualStyleCompileManifest, requestPreview: { imageCount: api.imageInputs, videoCount: api.videoInputs, audioCount: api.audioInputs, durationSeconds: intent.durationSeconds, nativeAudioExpected: api.nativeAudio }, issues, sourceHash: intent.sourceHash };
    },
  };
}
