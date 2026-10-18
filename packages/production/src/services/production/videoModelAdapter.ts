import type {
  VideoGenerationIntent,
  VideoReferenceBinding,
  VideoTimelineBeat,
} from "./videoGenerationIntent";
import { evaluateVideoVisualRecipeRuntimeContract } from "./videoGenerationIntent";
import type {
  VisualCompileManifest,
  VisualRecipeRuntimeContract,
  VisualRecipeRuntimeEnforcement,
} from "../../../../domain/src/visualArtifact";
import {
  assertVisualRecipeRuntimeContractReady,
  attachVisualRecipeContractToManifest,
  renderVisualRecipeRuntimeInstruction,
} from "./visualTaskRecipes";

export type VideoReferenceMediaKind = "image" | "video" | "audio";

export interface VideoAudioModeOption {
  id: "provider_native" | "reuse_dialogue" | "post_dub";
  label: string;
}

export const videoAudioModeOptionsForCapabilities = (
  capabilities: Pick<VideoModelAdapterDefinition['capabilities'], 'nativeAudio' | 'referenceAudios'>,
  allowPostDub = true,
): VideoAudioModeOption[] => [
  ...(capabilities.nativeAudio ? [{ id: 'provider_native' as const, label: '模型生成原生声音' }] : []),
  ...(capabilities.referenceAudios ? [{ id: 'reuse_dialogue' as const, label: '提交已有完整配音作为参考' }] : []),
  ...(allowPostDub ? [{ id: 'post_dub' as const, label: '后期另行配音' }] : []),
];

export interface VideoReferenceManifestEntry {
  bindingId: string;
  mediaKind: VideoReferenceMediaKind;
  orderedIndex: number;
  providerLabel: string;
  logicalSubjectId?: string;
  semanticEntityId?: string;
  sourceAssetId: string;
  sourceVariantId?: string;
  mediaUrl: string;
  contentHash?: string;
  displayName?: string;
  description?: string;
  mediaDurationSeconds?: number;
  fileSizeBytes?: number;
  speakerId?: string;
  audioUsage?: VideoReferenceBinding["audioUsage"];
  purpose: VideoReferenceBinding["purpose"];
  preservation: VideoReferenceBinding["preservation"];
  sourceType: VideoReferenceBinding["sourceType"];
}

export interface VideoAdapterIssue {
  severity: "blocking" | "warning";
  code: string;
  message: string;
  bindingId?: string;
  field?: string;
}

export interface VideoGenerationAdapterPlan {
  schemaVersion: "video-generation-adapter-plan.v1";
  adapterId: string;
  adapterVersion: string;
  modelConfigId: string;
  mode: string;
  resolution?: string;
  referenceManifest: VideoReferenceManifestEntry[];
  timelinePlan: VideoTimelineBeat[];
  canonicalPrompt: string;
  adapterPrompt: string;
  finalConfirmedPrompt?: string;
  visualRecipeContract: VisualRecipeRuntimeContract;
  visualStyleCompileManifest?: VisualCompileManifest;
  requestPreview: {
    imageCount: number;
    videoCount: number;
    audioCount: number;
    durationSeconds: number;
    nativeAudioExpected: boolean;
  };
  issues: VideoAdapterIssue[];
  sourceHash: string;
}

export interface VideoAdapterModeDefinition {
  id: string;
  displayName: string;
  requiresStartFrame: boolean;
  requiresEndFrame?: boolean;
  acceptsStartFrame?: boolean;
  acceptsEndFrame: boolean;
  nativeAudioExpected: boolean;
}

export interface VideoModelAdapterDefinition {
  id: string;
  version: string;
  displayName: string;
  matches: Array<{ channelType?: string; modelIdPattern: RegExp }>;
  /** Modes offered after a model is selected. Falls back to `matches`. */
  selectableMatches?: Array<{ channelType?: string; modelIdPattern: RegExp }>;
  modes: VideoAdapterModeDefinition[];
  limits: {
    minDurationSeconds: number;
    maxDurationSeconds: number;
    aspectRatios: string[];
    resolutions: string[];
    maxReferenceImages: number;
    maxReferenceVideos: number;
    maxReferenceAudios: number;
    maxPromptCharacters?: number;
  };
  capabilities: {
    firstFrame: boolean;
    lastFrame: boolean;
    referenceImages: boolean;
    referenceVideos: boolean;
    referenceAudios: boolean;
    nativeAudio: boolean;
    dialogueVoiceReference: boolean;
    multiShot: boolean;
  };
  compile(input: {
    intent: VideoGenerationIntent;
    modelConfigId: string;
    mode?: string;
    resolution?: string;
    /** Preview compilers use draft; the provider boundary uses formal. */
    contractEnforcement?: VisualRecipeRuntimeEnforcement;
  }): VideoGenerationAdapterPlan;
}

const PROJECT_VISUAL_STYLE_OPEN = "<project_visual_style>";
const PROJECT_VISUAL_STYLE_CLOSE = "</project_visual_style>";
const projectVisualStyleBlockPattern = /<project_visual_style>[\s\S]*?<\/project_visual_style>/g;
const VISUAL_RECIPE_CONTRACT_OPEN = "<visual_recipe_contract>";
const VISUAL_RECIPE_CONTRACT_CLOSE = "</visual_recipe_contract>";
const visualRecipeContractBlockPattern = /<visual_recipe_contract>[\s\S]*?<\/visual_recipe_contract>/g;

const tokenCount = (value: string, token: string) => value.split(token).length - 1;

export const buildVideoVisualRecipeBoundary = ({
  intent,
  adapterId,
  enforcement = "draft",
}: {
  intent: VideoGenerationIntent;
  adapterId: string;
  enforcement?: VisualRecipeRuntimeEnforcement;
}) => {
  const contract = evaluateVideoVisualRecipeRuntimeContract({ intent, enforcement, adapterId });
  if (enforcement === "formal") assertVisualRecipeRuntimeContractReady(contract);
  const instruction = renderVisualRecipeRuntimeInstruction(contract);
  const promptBlock = `${VISUAL_RECIPE_CONTRACT_OPEN}\n${instruction}\n${VISUAL_RECIPE_CONTRACT_CLOSE}`;
  const manifestMatchesRecipe = Boolean(intent.visualStyleCompileManifest
    && intent.visualStyleCompileManifest.intent === contract.intent
    && intent.visualStyleCompileManifest.recipeId === contract.recipeId
    && intent.visualStyleCompileManifest.recipeVersion === contract.recipeVersion);
  const visualStyleCompileManifest = intent.visualStyleCompileManifest && manifestMatchesRecipe
    ? attachVisualRecipeContractToManifest({
        manifest: intent.visualStyleCompileManifest,
        contract,
        blockId: "video.recipe_contract",
      })
    : intent.visualStyleCompileManifest;
  return { contract, promptBlock, visualStyleCompileManifest };
};

/**
 * The author may refine the provider prompt, but the approved project visual
 * contract is compiler-owned and must survive byte-for-byte exactly once.
 */
export const assertFinalVideoPromptPreservesVisualStyleContract = (
  intent: VideoGenerationIntent,
  plan: Pick<VideoGenerationAdapterPlan, "adapterId" | "adapterPrompt" | "visualRecipeContract">,
  finalConfirmedPrompt: string,
) => {
  const contract = intent.visualStyleContract?.trim();
  const expectedBlock = contract
    ? `${PROJECT_VISUAL_STYLE_OPEN}\n${contract}\n${PROJECT_VISUAL_STYLE_CLOSE}`
    : "";
  const assertSingleExactBlock = (prompt: string, source: "adapter" | "confirmed") => {
    if (!contract) return;
    const blocks = prompt.match(projectVisualStyleBlockPattern) || [];
    const valid = tokenCount(prompt, PROJECT_VISUAL_STYLE_OPEN) === 1
      && tokenCount(prompt, PROJECT_VISUAL_STYLE_CLOSE) === 1
      && blocks.length === 1
      && blocks[0] === expectedBlock;
    if (valid) return;
    throw new Error(source === "adapter"
      ? "视频适配器未能唯一、完整地编译项目视觉风格合同。"
      : "最终视频提示词删除、修改或重复了项目视觉风格合同，请恢复系统生成的完整视觉规范块。");
  };
  assertSingleExactBlock(plan.adapterPrompt, "adapter");
  assertSingleExactBlock(finalConfirmedPrompt, "confirmed");

  const formalBoundary = buildVideoVisualRecipeBoundary({
    intent,
    adapterId: plan.adapterId,
    enforcement: "formal",
  });
  if (
    plan.visualRecipeContract.intent !== formalBoundary.contract.intent
    || plan.visualRecipeContract.recipeId !== formalBoundary.contract.recipeId
    || plan.visualRecipeContract.recipeVersion !== formalBoundary.contract.recipeVersion
  ) {
    throw new Error("视频适配器计划中的 Recipe 合同与当前视频任务不一致。");
  }
  const expectedRecipeBlock = formalBoundary.promptBlock;
  const assertSingleExactRecipeBlock = (prompt: string, source: "adapter" | "confirmed") => {
    const blocks = prompt.match(visualRecipeContractBlockPattern) || [];
    const valid = tokenCount(prompt, VISUAL_RECIPE_CONTRACT_OPEN) === 1
      && tokenCount(prompt, VISUAL_RECIPE_CONTRACT_CLOSE) === 1
      && blocks.length === 1
      && blocks[0] === expectedRecipeBlock;
    if (valid) return;
    throw new Error(source === "adapter"
      ? "视频适配器未能唯一、完整地编译视觉任务 Recipe 合同。"
      : "最终视频提示词删除、修改或重复了视觉任务 Recipe 合同，请恢复系统生成的完整合同块。");
  };
  assertSingleExactRecipeBlock(plan.adapterPrompt, "adapter");
  assertSingleExactRecipeBlock(finalConfirmedPrompt, "confirmed");
};
