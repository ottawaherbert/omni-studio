/**
 * VisualPromptLanguageProfile & VideoMotionContract Adapter
 * Manages language policies (zh / en / provider_default / bilingual) based on model capabilities
 * instead of browser navigator.language, and maps universal motion contracts to provider options.
 */

import { composePromptBlocks, type PromptCompositionManifest } from "./promptComposition";
import type {
  VisualCompileManifest,
  VisualRecipeRuntimeContract,
} from "../../../packages/domain/src/visualArtifact";

export type VisualPromptLanguagePolicy = "provider_default" | "zh" | "en" | "bilingual";

export interface VisualPromptLanguageProfile {
  providerId: string;
  modelId: string;
  policy: VisualPromptLanguagePolicy;
  preserveTechnicalTerms: boolean;
  bilingualSeparator?: string;
}

export interface VideoMotionContract {
  motionStrength?: number; // 1 ~ 10
  cameraPan?: number;      // -5 ~ 5
  cameraTilt?: number;     // -5 ~ 5
  cameraZoom?: number;     // -5 ~ 5
  cameraMotion?: string;
  subjectMotion?: string;
  startState?: string;
  endState?: string;
  durationSeconds?: number;
  loop?: boolean;
}

export type VideoProviderType =
  | "kie_grok"
  | "gemini"
  | "kling"
  | "runway"
  | "default";

export interface VideoProviderPromptAudit {
  authorPrompt: string;
  finalProviderPrompt: string;
  profile: VisualPromptLanguageProfile;
  providerType: VideoProviderType;
  motionContract?: VideoMotionContract;
  technicalDeltas: string[];
  nativeOptions: Record<string, unknown>;
  manifest: PromptCompositionManifest;
  /** Present when a production artifact, rather than the standalone playground, supplied a visual contract. */
  visualStyleCompileManifest?: VisualCompileManifest;
  visualRecipeContract?: VisualRecipeRuntimeContract;
}

export function resolveVisualPromptLanguageProfile(input: {
  providerId?: string;
  modelId?: string;
  policy?: VisualPromptLanguagePolicy;
}): VisualPromptLanguageProfile {
  const modelId = input.modelId || "";
  if (input.policy) {
    return {
      providerId: input.providerId || "default",
      modelId,
      policy: input.policy,
      preserveTechnicalTerms: true,
    };
  }

  // Gemini/Kling/Runway/Midjourney capability defaults
  if (/veo|gemini/i.test(modelId)) {
    return { providerId: input.providerId || "gemini", modelId, policy: "en", preserveTechnicalTerms: true };
  }
  if (/kling|kuaishou/i.test(modelId)) {
    return { providerId: input.providerId || "kling", modelId, policy: "zh", preserveTechnicalTerms: true };
  }
  if (/runway|gen3/i.test(modelId)) {
    return { providerId: input.providerId || "runway", modelId, policy: "en", preserveTechnicalTerms: true };
  }

  return {
    providerId: input.providerId || "default",
    modelId,
    policy: "provider_default",
    preserveTechnicalTerms: true,
  };
}

export function formatVisualPromptForModel(input: {
  authorPrompt: string;
  profile: VisualPromptLanguageProfile;
  technicalDeltas?: string[];
}): { authorPrompt: string; finalProviderPrompt: string } {
  const deltasText = input.technicalDeltas?.length ? input.technicalDeltas.join(" ") : "";
  let finalPrompt = input.authorPrompt;

  if (deltasText) {
    finalPrompt = `${input.authorPrompt}\n${deltasText}`;
  }

  return {
    authorPrompt: input.authorPrompt,
    finalProviderPrompt: finalPrompt,
  };
}

export function mapVideoMotionContractToProvider(input: {
  contract: VideoMotionContract;
  providerType: VideoProviderType;
}): Record<string, unknown> {
  const { contract, providerType } = input;
  const result: Record<string, unknown> = {};

  if (providerType === "kling") {
    if (contract.motionStrength !== undefined) result.motion_magnitude = contract.motionStrength;
    if (contract.cameraPan !== undefined || contract.cameraTilt !== undefined || contract.cameraZoom !== undefined) {
      result.camera_control = {
        pan: contract.cameraPan ?? 0,
        tilt: contract.cameraTilt ?? 0,
        zoom: contract.cameraZoom ?? 0,
      };
    }
  } else if (providerType === "runway") {
    if (contract.motionStrength !== undefined) result.motion = contract.motionStrength;
  }

  return result;
}

const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();

export const resolveVideoProviderType = (
  channelType: string,
  modelId: string,
): VideoProviderType => {
  if (channelType === "kie" && /grok-imagine-video/i.test(modelId)) return "kie_grok";
  if (channelType === "gemini") return "gemini";
  if (/kling|kuaishou/i.test(`${channelType} ${modelId}`)) return "kling";
  if (/runway|gen3/i.test(`${channelType} ${modelId}`)) return "runway";
  return "default";
};

export const videoMotionContractTechnicalDeltas = (
  contract: VideoMotionContract,
  profile: VisualPromptLanguageProfile,
  authorPrompt = "",
) => {
  const english = profile.policy === "en";
  const normalizedAuthorPrompt = clean(authorPrompt).toLocaleLowerCase();
  const absentFromAuthorPrompt = (value: unknown) => {
    const normalized = clean(value).toLocaleLowerCase();
    return Boolean(normalized && !normalizedAuthorPrompt.includes(normalized));
  };
  const durationAlreadyDeclared = Number.isFinite(contract.durationSeconds)
    && new RegExp(`(?:^|\\D)${contract.durationSeconds}\\s*(?:s|秒)(?:\\D|$)`, "i").test(normalizedAuthorPrompt);
  const entries = [
    absentFromAuthorPrompt(contract.cameraMotion)
      ? `${english ? "Camera motion" : "镜头运动"}: ${clean(contract.cameraMotion)}.`
      : "",
    absentFromAuthorPrompt(contract.subjectMotion)
      ? `${english ? "Subject motion" : "主体运动"}: ${clean(contract.subjectMotion)}.`
      : "",
    absentFromAuthorPrompt(contract.startState)
      ? `${english ? "Start state" : "起始状态"}: ${clean(contract.startState)}.`
      : "",
    absentFromAuthorPrompt(contract.endState)
      ? `${english ? "End state" : "结束状态"}: ${clean(contract.endState)}.`
      : "",
    Number.isFinite(contract.motionStrength)
      ? `${english ? "Motion strength" : "运动强度"}: ${contract.motionStrength}/10.`
      : "",
    Number.isFinite(contract.cameraPan)
      ? `${english ? "Camera pan" : "水平摇摄"}: ${contract.cameraPan}.`
      : "",
    Number.isFinite(contract.cameraTilt)
      ? `${english ? "Camera tilt" : "垂直摇摄"}: ${contract.cameraTilt}.`
      : "",
    Number.isFinite(contract.cameraZoom)
      ? `${english ? "Camera zoom" : "镜头变焦"}: ${contract.cameraZoom}.`
      : "",
    Number.isFinite(contract.durationSeconds) && !durationAlreadyDeclared
      ? `${english ? "Duration" : "时长"}: ${contract.durationSeconds}s.`
      : "",
    contract.loop === undefined
      ? ""
      : `${english ? "Loopable ending" : "可循环结束"}: ${contract.loop ? "yes" : "no"}.`,
  ].filter(Boolean);
  return entries.length
    ? [`${english ? "Motion contract" : "运动合同"}: ${entries.join(" ")}`]
    : [];
};

export const compileVideoProviderPrompt = (input: {
  authorPrompt: string;
  profile: VisualPromptLanguageProfile;
  providerType: VideoProviderType;
  motionContract?: VideoMotionContract;
}): VideoProviderPromptAudit => {
  const technicalDeltas = input.motionContract
    ? videoMotionContractTechnicalDeltas(input.motionContract, input.profile, input.authorPrompt)
    : [];
  const composition = composePromptBlocks([
    {
      blockId: "video.task",
      source: "VideoGenerationRequest.authorPrompt",
      purpose: "视频动作、摄影与连续性任务",
      content: input.authorPrompt,
      required: true,
    },
    {
      blockId: "video.motion_contract",
      source: "VideoGenerationRequest.motionContract",
      purpose: "作者提示词尚未声明的结构化运动约束",
      content: technicalDeltas.join(" "),
      required: false,
    },
  ]);
  if (composition.manifest.issues.some((issue) => issue.code === "EMPTY_REQUIRED_BLOCK")) {
    throw new Error("视频生成提示词不能为空。");
  }
  return {
    authorPrompt: input.authorPrompt,
    finalProviderPrompt: composition.prompt,
    profile: input.profile,
    providerType: input.providerType,
    motionContract: input.motionContract,
    technicalDeltas,
    nativeOptions: input.motionContract
      ? mapVideoMotionContractToProvider({
        contract: input.motionContract,
        providerType: input.providerType,
      })
      : {},
    manifest: composition.manifest,
  };
};
