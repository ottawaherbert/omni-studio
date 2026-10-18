import { getIndustryStandardMetrics } from "../config/industryStandards";
import { Episode, Project } from "../types/project";

const SCENE_DURATION_TOLERANCE_RATIO = 0.15;
const SCENE_DURATION_MIN_TOLERANCE_MINUTES = 0.15;

export const getSceneDurationRange = (targetDuration: number) => {
  const tolerance = Math.max(
    SCENE_DURATION_MIN_TOLERANCE_MINUTES,
    targetDuration * SCENE_DURATION_TOLERANCE_RATIO
  );

  return {
    min: Math.max(0.1, targetDuration - tolerance),
    max: targetDuration + tolerance,
  };
};

export const getExpectedSceneRange = (projectType: Project["type"], targetDuration: number) => {
  const metrics = getIndustryStandardMetrics(projectType, targetDuration);
  if (!metrics) return null;
  const { scenes } = metrics;
  let minScenes = scenes.min;
  let maxScenes = scenes.max;

  if (maxScenes > 15) {
    maxScenes = 15;
    if (minScenes > 15) minScenes = 10;
  }

  return { minScenes, maxScenes };
};

export const validateGeneratedSceneOption = (
  option: any,
  currentProject: Project,
  activeEpisode: Episode
) => {
  const scenes = Array.isArray(option?.scenes) ? option.scenes : [];
  const reasons: string[] = [];

  if (scenes.length === 0) {
    reasons.push("未返回任何场景");
  }

  if (activeEpisode.targetDuration) {
    const range = getExpectedSceneRange(currentProject.type, activeEpisode.targetDuration);
    if (range && (scenes.length < range.minScenes || scenes.length > range.maxScenes)) {
      reasons.push(`场景数 ${scenes.length} 不在建议范围 ${range.minScenes}-${range.maxScenes} 内`);
    }

    const totalDuration = scenes.reduce((sum: number, scene: any) => {
      const duration = Number(scene?.targetDuration);
      return Number.isFinite(duration) ? sum + duration : sum;
    }, 0);
    const { min, max } = getSceneDurationRange(activeEpisode.targetDuration);
    if (totalDuration < min || totalDuration > max) {
      reasons.push(
        `场景时长合计 ${totalDuration.toFixed(2)} 分钟，不在 ${min.toFixed(2)}-${max.toFixed(2)} 分钟范围内`
      );
    }

    scenes.forEach((scene: any, index: number) => {
      const duration = Number(scene?.targetDuration);
      if (!Number.isFinite(duration) || duration <= 0) {
        reasons.push(`场景 ${index + 1} 缺少有效 targetDuration`);
      }
    });
  }

  scenes.forEach((scene: any, index: number) => {
    if (!String(scene?.title || "").trim()) reasons.push(`场景 ${index + 1} 缺少标题`);
    if (!String(scene?.description || "").trim()) reasons.push(`场景 ${index + 1} 缺少描述`);
  });

  return {
    valid: reasons.length === 0,
    reasons,
  };
};
