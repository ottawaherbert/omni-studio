import { ProjectType } from "../types/project";

export interface IndustryStandard {
  wordsPerMinute: { min: number; max: number };
  scenesPerMinute: { min: number; max: number };
  shotsPerMinute: { min: number; max: number };
  averageShotSeconds: { min: number; max: number };
}

export const INDUSTRY_STANDARDS: Partial<Record<ProjectType, IndustryStandard>> = {
  "micro-short-drama": {
    wordsPerMinute: { min: 160, max: 190 },
    scenesPerMinute: { min: 0.8, max: 1.5 },
    shotsPerMinute: { min: 7, max: 10 },
    averageShotSeconds: { min: 1.5, max: 3.5 },
  },
  "short-drama": {
    wordsPerMinute: { min: 180, max: 220 },
    scenesPerMinute: { min: 1.2, max: 2.0 },
    shotsPerMinute: { min: 8, max: 12 },
    averageShotSeconds: { min: 2, max: 4.5 },
  },
  "tv-series": {
    wordsPerMinute: { min: 150, max: 170 },
    scenesPerMinute: { min: 0.5, max: 0.9 },
    shotsPerMinute: { min: 6, max: 8 },
    averageShotSeconds: { min: 4, max: 7.5 },
  },
  "movie": {
    wordsPerMinute: { min: 110, max: 130 },
    scenesPerMinute: { min: 0.4, max: 1.2 },
    shotsPerMinute: { min: 4, max: 6 },
    averageShotSeconds: { min: 6, max: 12 },
  },
};

export function getIndustryStandardMetrics(type: ProjectType, durationInMinutes: number) {
  const std = INDUSTRY_STANDARDS[type];
  if (!std) return null;
  return {
    words: {
      min: Math.floor(std.wordsPerMinute.min * durationInMinutes),
      max: Math.ceil(std.wordsPerMinute.max * durationInMinutes),
    },
    scenes: {
      min: Math.max(1, Math.floor(std.scenesPerMinute.min * durationInMinutes)),
      max: Math.max(1, Math.ceil(std.scenesPerMinute.max * durationInMinutes)),
    },
    shots: {
      min: Math.max(1, Math.floor(std.shotsPerMinute.min * durationInMinutes)),
      max: Math.max(1, Math.ceil(std.shotsPerMinute.max * durationInMinutes)),
    },
    wordsPerMinute: std.wordsPerMinute,
    scenesPerMinute: std.scenesPerMinute,
    shotsPerMinute: std.shotsPerMinute,
    averageShotSeconds: std.averageShotSeconds,
  };
}

export function getShotPacingWarning(
  type: ProjectType,
  durationInMinutes: number,
  shotCount: number,
  totalDurationSeconds?: number,
) {
  if (!durationInMinutes || durationInMinutes <= 0 || shotCount <= 0) return null;

  const metrics = getIndustryStandardMetrics(type, durationInMinutes);
  if (!metrics) return null;
  const expectedTotalSeconds = durationInMinutes * 60;
  const measuredTotalSeconds = totalDurationSeconds && totalDurationSeconds > 0
    ? totalDurationSeconds
    : expectedTotalSeconds;
  const averageShotSeconds = measuredTotalSeconds / shotCount;

  if (
    shotCount < metrics.shots.min &&
    averageShotSeconds > metrics.averageShotSeconds.max * 1.25
  ) {
    return "镜头数偏少可能节奏拖沓";
  }

  if (
    shotCount > metrics.shots.max * 1.5 &&
    averageShotSeconds < metrics.averageShotSeconds.min * 0.85
  ) {
    return "镜头数远超标准可能过碎";
  }

  return null;
}

export function translateWordsPerMinuteToPrompt(type: ProjectType): string {
  switch (type) {
    case "micro-short-drama":
      return "【语速与对白密度】要求：节奏较快，张力十足，适合中等长度的单集叙事。对白需要有梗且紧凑，但可以在关键情绪节点提供有限的留白。";
    case "short-drama":
      return "【语速与对白密度】要求：台词密集，节奏极快，没有废话和多余的寒暄。对白要直白有力，情绪饱满。请尽量压榨每一句台词的信息量。";
    case "tv-series":
      return "【语速与对白密度】要求：正常电视剧语速。在推进剧情的同时，留出适当的表演空间、停顿和呼吸感。人物对话要有来回拉扯和潜台词的余地。";
    case "movie":
      return "【语速与对白密度】要求：高度克制，靠画面讲故事。对话必须精炼、富有潜台词。大幅增加视觉动作、环境交互和表情细节的描写，减少说教或直白的嘴部动作。";
    default:
      return "";
  }
}
