import type { VideoGenerationIntent } from "./videoGenerationIntent";
import {
  buildVideoVisualRecipeBoundary,
  type VideoGenerationAdapterPlan,
} from "./videoModelAdapter";
import type { PromptCompositionManifest } from "./promptComposition";

export const buildVideoGenerationTaskAudit = <Extra extends Record<string, unknown> = Record<string, unknown>>({
  intent,
  plan,
  promptCompositionManifest,
  extra,
}: {
  intent: VideoGenerationIntent;
  plan: VideoGenerationAdapterPlan & { finalConfirmedPrompt: string };
  promptCompositionManifest: PromptCompositionManifest;
  extra?: Extra;
}) => {
  const recipeBoundary = buildVideoVisualRecipeBoundary({
    intent,
    adapterId: plan.adapterId,
    enforcement: "formal",
  });
  return {
    ...(extra || {}),
    projectId: intent.projectId,
    episodeId: intent.episodeId,
    sceneId: intent.sceneId,
    videoGenerationUnitId: intent.videoGenerationUnitId,
    sourceHash: intent.sourceHash,
    adapterId: plan.adapterId,
    adapterVersion: plan.adapterVersion,
    finalConfirmedPrompt: plan.finalConfirmedPrompt,
    promptCompositionManifest,
    referenceManifest: plan.referenceManifest,
    audioPolicy: intent.audioPolicy,
    visualStyleCompileManifest: recipeBoundary.visualStyleCompileManifest,
    visualRecipeContract: recipeBoundary.contract,
  };
};
