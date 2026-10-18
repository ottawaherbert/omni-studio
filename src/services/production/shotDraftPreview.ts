import type { MediaAssetReference, Shot, VisualCompileManifest } from "../../types/project";

export interface ShotDraftPreviewInput {
  imageUrl: string;
  imageMedia?: MediaAssetReference;
  sourceHash: string;
  promptHash: string;
  modelId: string;
  referenceImageUrls: string[];
  visualStyleCompileManifest?: VisualCompileManifest;
  createdAt: number;
}

export interface ShotDraftPreviewReference {
  imageUrl: string;
  sourceHash: string;
  promptHash: string;
}

export function applyShotDraftPreview(shot: Shot, input: ShotDraftPreviewInput): Shot {
  return {
    ...shot,
    draftPreview: {
      ...input,
      referenceImageUrls: [...input.referenceImageUrls],
      isProvisional: true,
    },
  };
}

export function resolveShotDraftPreviewReference(
  shot: Shot,
  currentSourceHash: string,
): ShotDraftPreviewReference | null {
  const preview = shot.draftPreview;
  if (!preview || !currentSourceHash || preview.sourceHash !== currentSourceHash) return null;
  return {
    imageUrl: preview.imageUrl,
    sourceHash: preview.sourceHash,
    promptHash: preview.promptHash,
  };
}
