import type {
  AssetReferencePackItem,
} from "../../videoStoryboardArtifacts";
import type { ProductionDepartmentFinding, ProductionQAIssue } from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import { collectProductionCoordinationArtifacts } from "../artifacts";
import {
  asArray,
  coordinationIssue,
  departmentFindingFromIssues,
  refsForSnapshot,
} from "../shared";

export const runMediaReadinessCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => {
  const bundle = collectProductionCoordinationArtifacts(snapshot.operatorArtifacts);
  const issues: ProductionQAIssue[] = [];
  if (snapshot.stageType === "expensive_generation_planning" && bundle.videoGenerationUnits.length === 0) {
    issues.push(coordinationIssue(
      "operatorArtifacts.video_generation_unit",
      "媒体生成规划阶段缺少 video_generation_unit。",
      "warning",
      "先生成 video_generation_unit 队列，再进入实际视频生成。",
      { issueType: "media_readiness_coordination" },
    ));
  }
  for (const pack of bundle.assetReferencePacks) {
    const requiredMissingRefs = asArray<AssetReferencePackItem>(pack.items)
      .filter((item) => item.required && !item.referenceImageUrl && !item.referenceAssetId);
    if (requiredMissingRefs.length) {
      issues.push(coordinationIssue(
        `assetReferencePack.${pack.id}.items`,
        `资产参考包 ${pack.id} 有 ${requiredMissingRefs.length} 个 required item 未绑定 referenceImageUrl/referenceAssetId。`,
        "warning",
        "补齐必需参考图或 referenceAssetId；如果模型不支持参考图，则降低 required 或更换模型 profile。",
        { issueType: "media_readiness_coordination" },
      ));
    }
  }
  if (bundle.videoGenerationUnits.length > 0 && bundle.assetReferencePacks.length === 0) {
    issues.push(coordinationIssue(
      "operatorArtifacts.asset_reference_pack",
      "存在视频生成单元，但缺少资产参考包，生成前无法核算参考资产准备度。",
      "warning",
      "先生成 asset_reference_pack，再进入视频生成。",
      { issueType: "media_readiness_coordination" },
    ));
  }

  return departmentFindingFromIssues({
    department: "media_readiness",
    issues,
    passedMessage: "媒体生成准备未发现当前范围的结构性缺口。",
    target: "coordination.media_readiness",
    ownerAgentId: "linear.expensive_generation.video_unit_planner",
    suggestedStageType: "expensive_generation_planning",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
