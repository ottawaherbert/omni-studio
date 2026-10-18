import { formatPromptValue, formatVisualCreativeVision } from "../../utils/projectUtils";

type ProjectWithCreativeVision = {
  creativeVision?: unknown;
};

const visualDepartments = new Set([
  "cinematography",
  "lighting",
  "production_design",
  "wardrobe",
  "makeup_hair",
  "props",
]);

export const productionDepartmentCreativeVision = (
  project: ProjectWithCreativeVision,
  departmentId: string,
) => {
  const rawVision = project.creativeVision;
  if (!rawVision) return "";
  if (typeof rawVision === "string") return formatPromptValue(rawVision);
  if (typeof rawVision !== "object") return "";

  const vision = rawVision as Record<string, unknown>;
  const line = (label: string, value: unknown) => {
    const content = formatPromptValue(value);
    return content ? `- ${label}：${content}` : "";
  };

  if (visualDepartments.has(departmentId)) {
    return [
      line("类型", vision.genre),
      formatVisualCreativeVision(vision),
    ].filter(Boolean).join("\n");
  }

  if (departmentId === "sound_music") {
    return [
      line("类型", vision.genre),
      line("叙事风格", vision.narrativeStyle),
      line("主题问题", vision.themeQuestion),
      line("情感回报", vision.emotionalReward),
    ].filter(Boolean).join("\n");
  }

  return [
    line("类型", vision.genre),
    line("叙事风格", vision.narrativeStyle),
    line("外部目标", vision.want),
    line("内在需求", vision.need),
    line("失败代价", vision.stakes),
    line("对抗力量", vision.oppositionForce),
    line("主角弧线", vision.protagonistArc),
    line("情感回报", vision.emotionalReward),
  ].filter(Boolean).join("\n");
};
