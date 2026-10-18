import type {
  ProductionDepartmentFinding,
  ProductionQAIssue,
  ProductionStageType,
} from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import type {
  StoryboardBoardPanel,
  VideoStoryboardPlan,
} from "../../videoStoryboardArtifacts";
import {
  validateAssetReferencePack,
  validatePerformanceBeats,
  validateStoryboardBoard,
  validateVideoGenerationUnit,
  validateVideoStoryboardPlan,
} from "../../videoStoryboardArtifacts";
import {
  collectProductionCoordinationArtifacts,
  type ProductionCoordinationArtifactBundle,
} from "../artifacts";
import { stageRequires } from "../stageRequirements";
import {
  asArray,
  coordinationIssue,
  departmentFindingFromIssues,
  isNonEmpty,
  refsForSnapshot,
} from "../shared";
import { videoStoryboardIssueToProductionIssue } from "../videoStoryboardIssues";

const storyboardStageTypes = new Set<ProductionStageType>([
  "storyboard",
  "prompt",
  "expensive_generation_planning",
]);

const artifactBundlePlan = (bundle: ProductionCoordinationArtifactBundle): Partial<VideoStoryboardPlan> => ({
  performanceBeats: bundle.performanceBeats,
  storyboardBoards: bundle.storyboardBoards,
  sceneVisualPacks: bundle.sceneVisualPacks,
  assetReferencePacks: bundle.assetReferencePacks,
  videoGenerationUnits: bundle.videoGenerationUnits,
});

export const runStoryboardVideoUnitCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => {
  const bundle = collectProductionCoordinationArtifacts(snapshot.operatorArtifacts);
  const issues: ProductionQAIssue[] = [];
  const requiredKinds = new Set(stageRequires(snapshot.stageType));

  if (snapshot.stageType && storyboardStageTypes.has(snapshot.stageType) && snapshot.shots.length === 0 && bundle.storyboardBoards.length === 0) {
    issues.push(coordinationIssue(
      "episodes.scenes.shots",
      "当前阶段缺少 shots 或 storyboard_board，故事板统筹无法验收可生成片段。",
      "warning",
      "先在 storyboard 阶段补齐镜头表或故事板页，再进入提示词/生成计划。",
      { issueType: "storyboard_video_unit_coordination" },
    ));
  }
  for (const kind of requiredKinds) {
    if (kind === "performance_beats" && bundle.performanceBeats.length === 0) {
      issues.push(coordinationIssue(
        "operatorArtifacts.performance_beats",
        "当前阶段缺少 performance_beats，故事板无法判断 10-15 秒节拍。",
        "warning",
        undefined,
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
    if (kind === "storyboard_board" && bundle.storyboardBoards.length === 0) {
      issues.push(coordinationIssue(
        "operatorArtifacts.storyboard_board",
        "当前阶段缺少 storyboard_board。",
        "warning",
        undefined,
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
    if (kind === "asset_reference_pack" && bundle.assetReferencePacks.length === 0) {
      issues.push(coordinationIssue(
        "operatorArtifacts.asset_reference_pack",
        "当前阶段缺少 asset_reference_pack。",
        "warning",
        undefined,
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
    if (kind === "video_generation_unit" && bundle.videoGenerationUnits.length === 0) {
      issues.push(coordinationIssue(
        "operatorArtifacts.video_generation_unit",
        "当前阶段缺少 video_generation_unit。",
        "warning",
        undefined,
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
  }

  if (bundle.performanceBeats.length) {
    issues.push(...validatePerformanceBeats(bundle.performanceBeats)
      .map((item) => videoStoryboardIssueToProductionIssue(item, "storyboard_video_unit_coordination")));
  }
  for (const board of bundle.storyboardBoards) {
    issues.push(...validateStoryboardBoard(board)
      .map((item) => videoStoryboardIssueToProductionIssue(item, "storyboard_video_unit_coordination")));
  }
  for (const pack of bundle.assetReferencePacks) {
    issues.push(...validateAssetReferencePack(pack)
      .map((item) => videoStoryboardIssueToProductionIssue(item, "storyboard_video_unit_coordination")));
  }
  for (const unit of bundle.videoGenerationUnits) {
    const pack = bundle.assetReferencePacks.find((item) => item.id === unit.assetReferencePackId);
    issues.push(...validateVideoGenerationUnit(unit, pack)
      .filter((item) => item.code !== "VIDEO_UNIT_NEEDS_HUMAN_APPROVAL_FLAG")
      .map((item) => videoStoryboardIssueToProductionIssue(item, "storyboard_video_unit_coordination")));
  }

  if (bundle.performanceBeats.length || bundle.storyboardBoards.length || bundle.assetReferencePacks.length || bundle.videoGenerationUnits.length) {
    issues.push(...validateVideoStoryboardPlan(artifactBundlePlan(bundle))
      .filter((item) => item.code !== "VIDEO_UNIT_NEEDS_HUMAN_APPROVAL_FLAG")
      .map((item) => videoStoryboardIssueToProductionIssue(item, "storyboard_video_unit_coordination")));
  }

  const beatsById = new Map(bundle.performanceBeats.map((beat) => [beat.id, beat]));
  const boardsById = new Map(bundle.storyboardBoards.map((board) => [board.id, board]));
  for (const unit of bundle.videoGenerationUnits) {
    const board = boardsById.get(unit.storyboardBoardId);
    if (board) {
      const panelDuration = asArray<StoryboardBoardPanel>(board.panels).reduce((total, panel) => total + Number(panel.durationSeconds || 0), 0);
      if (panelDuration > 0 && Math.abs(panelDuration - unit.durationSeconds) > 2) {
        issues.push(coordinationIssue(
          `videoGenerationUnit.${unit.id}.durationSeconds`,
          `视频单元 ${unit.id} 时长 ${unit.durationSeconds}s 与故事板 panel 合计 ${panelDuration}s 偏差超过 2 秒。`,
          "warning",
          "调整 panel.durationSeconds、performanceBeat.durationSeconds 或 videoGenerationUnit.durationSeconds，让时长可拍可生成。",
          { issueType: "storyboard_video_unit_coordination" },
        ));
      }
    }
    const beatDuration = asArray<string>(unit.performanceBeatIds).reduce((total, beatId) => total + Number(beatsById.get(beatId)?.durationSeconds || 0), 0);
    if (beatDuration > 0 && Math.abs(beatDuration - unit.durationSeconds) > 2) {
      issues.push(coordinationIssue(
        `videoGenerationUnit.${unit.id}.performanceBeatIds`,
        `视频单元 ${unit.id} 时长 ${unit.durationSeconds}s 与绑定 performanceBeats 合计 ${beatDuration}s 偏差超过 2 秒。`,
        "warning",
        "统一 performanceBeats、storyboardBoard 和 videoGenerationUnit 的目标时长。",
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
    const dialogueCount = asArray<string>(unit.performanceBeatIds).reduce((total, beatId) => total + Number(beatsById.get(beatId)?.dialogueLineCount || 0), 0);
    const actionCount = asArray<string>(unit.performanceBeatIds).reduce((total, beatId) => total + Number(beatsById.get(beatId)?.actionBeatCount || 0) + Number(beatsById.get(beatId)?.combatBeatCount || 0), 0);
    if (unit.durationSeconds >= 8 && dialogueCount === 0 && actionCount === 0 && !isNonEmpty(unit.audioPlan)) {
      issues.push(coordinationIssue(
        `videoGenerationUnit.${unit.id}.performance`,
        `视频单元 ${unit.id} 接近或超过 8 秒，但没有对白、动作或声音计划支撑。`,
        "warning",
        "补充对白、动作、情绪反应、环境声或明确的静默表演设计，避免生成空镜。",
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
  }

  for (const shot of snapshot.shots) {
    if (Number(shot.duration || 0) >= 8 &&
      !asArray(shot.dialogueLines).length &&
      !isNonEmpty(shot.visualAction) &&
      !isNonEmpty(shot.microExpression)) {
      issues.push(coordinationIssue(
        `shots.${shot.id}.duration`,
        `镜头 ${shot.id} 时长较长，但缺少对白、动作或微表情设计。`,
        "warning",
        "补充 visualAction、dialogueLines 或 microExpression，确认镜头时长由表演和动作支撑。",
        { issueType: "storyboard_video_unit_coordination" },
      ));
    }
  }

  return departmentFindingFromIssues({
    department: "storyboard_video_unit",
    issues,
    passedMessage: "故事板/视频单元统筹未发现当前范围的结构性缺口。",
    target: "coordination.storyboard_video_unit",
    ownerAgentId: "linear.storyboard.board_planner",
    suggestedStageType: "storyboard",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
