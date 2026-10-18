import type { ProductionQAIssue } from "../../types/production";
import type { VideoStoryboardArtifactIssue } from "./videoStoryboardArtifacts";
import { makeIssue } from "./runnerArtifacts";

export const toVideoStoryboardProductionIssues = (
  issues: VideoStoryboardArtifactIssue[],
): ProductionQAIssue[] =>
  issues.map((issue) =>
    makeIssue(
      issue.target,
      `${issue.code}: ${issue.message}`,
      issue.severity === "blocking" ? "blocking" : "warning",
      "检查故事板策略选择、panel 数、箭头 legend、镜头/资产/连续性引用后再进入 prompt 或媒体生成计划。",
    ),
  );
