import type { AIExecutionProvenance } from "../types/project";

/** Legacy model configuration is not evidence that an API actually ran. */
export const formatAIExecutionProvenance = (
  provenance?: AIExecutionProvenance,
  legacyModelId?: string,
  source?: "ai_generation" | "upload" | "existing",
): string => {
  if (provenance?.source === "manual_external" || legacyModelId === "manual_external") return "手动外部返回（未调用 API）";
  if (provenance?.source === "api") return `接口 ${provenance.provider} · ${provenance.modelId}`;
  if (source === "upload") return "本地导入（未调用生成接口）";
  if (source === "existing") return "沿用既有素材";
  return legacyModelId && legacyModelId !== "unknown"
    ? `历史模型记录 ${legacyModelId}（执行来源未记录）`
    : "执行来源未记录";
};
