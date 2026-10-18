import type { AudioTrack, ManualStudioAudioAudit } from "../../types/project";
import { createAIGeneratedMediaReference } from "../../utils/mediaProvenance";
import { isGeneralSkill } from "../../../packages/domain/src/creativeDirection";
import type { UniversalSkillReference } from "../../types/project";

/** The current editable music request owns content; timeline position is not lead-in silence. */
export function buildBgmGenerationPrompt(input: { prompt: string; description?: string; tags?: string[]; skills?: UniversalSkillReference[]; track?: Pick<AudioTrack, "startTime" | "duration"> }): string {
  const content = [input.prompt.trim(), input.description?.trim(), input.tags?.length ? `风格标签：${input.tags.join('、')}` : '',
    ...(input.skills || []).filter(isGeneralSkill).map(skill => `【Skill：${skill.title}】\n${skill.content.trim()}`)].filter(Boolean).join('\n\n');
  if (!content) return '';
  const timing = input.track ? `本次音乐供 ${input.track.duration} 秒的段落使用；本场 ${input.track.startTime} 秒的入场点由时间线处理，生成素材从自身起点开始，不为入场点添加前置静音。` : '';
  return [timing, content].filter(Boolean).join('\n\n');
}

export interface BgmGovernedContext {
  sourceHash: string;
  trackId: string;
  shotId?: string;
  contextSummary: string;
  generationAllowed: boolean;
  blockedReason?: string;
}

export interface BgmGenerationResult {
  audioUrl: string;
  finalPrompt: string;
  promptHash: string;
  modelId: string;
  provider: "gemini" | "custom" | "manual_external";
  selectedSkillIds: string[];
  selectedSkillTitles: string[];
  governedContext?: BgmGovernedContext;
  createdAt: number;
}

export const buildGovernedBgmTrackUpdate = (
  result: BgmGenerationResult,
  latestContext: BgmGovernedContext | undefined,
): Partial<AudioTrack> | null => {
  const sourceContext = result.governedContext;
  if (!sourceContext || !latestContext
    || !latestContext.generationAllowed
    || latestContext.sourceHash !== sourceContext.sourceHash
    || latestContext.trackId !== sourceContext.trackId) return null;
  const generationAudit: ManualStudioAudioAudit = {
    action: "generate_bgm",
    sourceHash: sourceContext.sourceHash,
    promptHash: result.promptHash,
    modelId: result.modelId,
    provider: result.provider,
    trackId: sourceContext.trackId,
    shotId: sourceContext.shotId,
    contextSummary: sourceContext.contextSummary,
    selectedSkillIds: result.selectedSkillIds,
    selectedSkillTitles: result.selectedSkillTitles,
    authorConfirmedAt: result.createdAt,
    createdAt: result.createdAt,
  };
  return {
    linkedAssetId: undefined,
    url: result.audioUrl,
    audioMedia: createAIGeneratedMediaReference("audio", result.audioUrl, result.modelId),
    generationAudit,
  };
};
