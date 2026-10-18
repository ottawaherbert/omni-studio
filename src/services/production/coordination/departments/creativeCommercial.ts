import type { Scene } from "../../../../types/project";
import type { ProductionDepartmentFinding, ProductionQAIssue } from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import {
  asArray,
  coordinationIssue,
  departmentFindingFromIssues,
  isNonEmpty,
  refsForSnapshot,
} from "../shared";

export const runCreativeCommercialCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => {
  const issues: ProductionQAIssue[] = [];
  if (!isNonEmpty(snapshot.project.logline)) {
    issues.push(coordinationIssue(
      "project.logline",
      "项目缺少 logline，商业/创作统筹无法判断核心承诺。",
      "warning",
      undefined,
      { issueType: "creative_commercial_coordination" },
    ));
  }
  if (!isNonEmpty(snapshot.project.coreConflict)) {
    issues.push(coordinationIssue(
      "project.coreConflict",
      "项目缺少 coreConflict，商业/创作统筹无法判断冲突引擎。",
      "warning",
      undefined,
      { issueType: "creative_commercial_coordination" },
    ));
  }
  const vision = snapshot.project.creativeVision;
  if (vision && (!isNonEmpty(vision.want) || !isNonEmpty(vision.need) || !isNonEmpty(vision.stakes))) {
    issues.push(coordinationIssue(
      "project.creativeVision",
      "creativeVision 缺少 want/need/stakes 中的一个或多个字段，商业统筹难以验收爽点、情绪推进和代价。",
      "warning",
      "补齐主角想要什么、真正需要什么、失败代价是什么。",
      { issueType: "creative_commercial_coordination" },
    ));
  }
  if ((snapshot.project.type === "short-drama" || snapshot.project.type === "micro-short-drama") &&
    snapshot.scope !== "stage_exit" &&
    snapshot.episodes.length > 0) {
    for (const episode of snapshot.episodes) {
      const hasHook = asArray<Scene>(episode.scenes).some((scene) => isNonEmpty(scene.hook));
      const hasCliffhanger = asArray<Scene>(episode.scenes).some((scene) => isNonEmpty(scene.cliffhanger));
      if (!hasHook) {
        issues.push(coordinationIssue(
          `episodes.${episode.id}.hook`,
          `短剧分集 ${episode.title || episode.id} 缺少明确开场钩子。`,
          "warning",
          "补充前三秒钩子或强冲突开场。",
          { issueType: "creative_commercial_coordination" },
        ));
      }
      if (!hasCliffhanger) {
        issues.push(coordinationIssue(
          `episodes.${episode.id}.cliffhanger`,
          `短剧分集 ${episode.title || episode.id} 缺少明确尾钩/付费点。`,
          "warning",
          "补充尾部悬念、情绪偿付或下一集追看理由。",
          { issueType: "creative_commercial_coordination" },
        ));
      }
    }
  }
  for (const episode of snapshot.episodes) {
    if (!isNonEmpty(episode.title) || !isNonEmpty(episode.inspiration)) {
      issues.push(coordinationIssue(
        `episodes.${episode.id}`,
        `分集 ${episode.id || "(unknown)"} 缺少 title 或 inspiration。`,
        "warning",
        "补齐分集标题和本集创作意图，便于全局 QA 判断承诺是否兑现。",
        { issueType: "creative_commercial_coordination" },
      ));
    }
  }

  return departmentFindingFromIssues({
    department: "creative_commercial",
    issues,
    passedMessage: "商业/创作统筹未发现当前范围的结构性缺口。",
    target: "coordination.creative_commercial",
    ownerAgentId: "linear.concept.producer",
    suggestedStageType: "concept",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
