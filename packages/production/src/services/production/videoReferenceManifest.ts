import type {
  VideoGenerationReferencePurpose,
  VideoGenerationReferenceSourceType,
  VideoReferenceBinding,
} from "./videoGenerationIntent";
import type {
  VideoReferenceManifestEntry,
  VideoReferenceMediaKind,
} from "./videoModelAdapter";

const purposeOrder: Record<VideoGenerationReferencePurpose, number> = {
  identity: 0,
  appearance: 1,
  environment: 2,
  prop_identity: 3,
  composition: 4,
  motion: 5,
  editing_rhythm: 6,
  voice_timbre: 7,
  audio_copy: 8,
};

export const videoReferenceMediaKind = (
  sourceType: VideoGenerationReferenceSourceType,
): VideoReferenceMediaKind => {
  if (sourceType === "motion_reference_video" || sourceType === "editing_reference_video") return "video";
  if (sourceType === "voice_reference_audio" || sourceType === "final_dialogue_audio") return "audio";
  return "image";
};

export const stableSortVideoReferenceBindings = (
  bindings: VideoReferenceBinding[],
): VideoReferenceBinding[] => [...bindings].sort((left, right) => {
  if (left.required !== right.required) return left.required ? -1 : 1;
  const purposeDelta = purposeOrder[left.purpose] - purposeOrder[right.purpose];
  if (purposeDelta !== 0) return purposeDelta;
  if (left.priority !== right.priority) return right.priority - left.priority;
  return [left.sourceAssetId, left.sourceVariantId || "", left.sourceType, left.id]
    .join("\u0000")
    .localeCompare([right.sourceAssetId, right.sourceVariantId || "", right.sourceType, right.id].join("\u0000"));
});

export const buildVideoReferenceManifest = (
  bindings: VideoReferenceBinding[],
): VideoReferenceManifestEntry[] => {
  const counters: Record<VideoReferenceMediaKind, number> = { image: 0, video: 0, audio: 0 };
  const subjectLabels = new Map<string, string>();
  let subjectCount = 0;
  return stableSortVideoReferenceBindings(bindings).map((binding, index) => {
    const mediaKind = videoReferenceMediaKind(binding.sourceType);
    counters[mediaKind] += 1;
    const prefix = mediaKind === "image" ? "Picture" : mediaKind === "video" ? "Video" : "Audio";
    let logicalSubjectId: string | undefined;
    if (binding.semanticEntityId) {
      logicalSubjectId = subjectLabels.get(binding.semanticEntityId);
      if (!logicalSubjectId) {
        subjectCount += 1;
        logicalSubjectId = `Subject ${subjectCount}`;
        subjectLabels.set(binding.semanticEntityId, logicalSubjectId);
      }
    }
    return {
      bindingId: binding.id,
      mediaKind,
      orderedIndex: index + 1,
      providerLabel: `${prefix} ${counters[mediaKind]}`,
      logicalSubjectId,
      semanticEntityId: binding.semanticEntityId,
      sourceAssetId: binding.sourceAssetId,
      sourceVariantId: binding.sourceVariantId,
      mediaUrl: binding.mediaUrl,
      contentHash: binding.contentHash,
      displayName: binding.displayName,
      description: binding.description,
      mediaDurationSeconds: binding.mediaDurationSeconds,
      fileSizeBytes: binding.fileSizeBytes,
      speakerId: binding.speakerId,
      audioUsage: binding.audioUsage,
      purpose: binding.purpose,
      preservation: binding.preservation,
      sourceType: binding.sourceType,
    };
  });
};
