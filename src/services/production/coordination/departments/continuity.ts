import type { Shot } from "../../../../types/project";
import type { ProductionDepartmentFinding, ProductionQAIssue } from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import type { SceneVisualPackProp, VideoGenerationUnit } from "../../videoStoryboardArtifacts";
import { collectProductionCoordinationArtifacts } from "../artifacts";
import {
  asArray,
  compact,
  coordinationIssue,
  departmentFindingFromIssues,
  isNonEmpty,
  refsForSnapshot,
} from "../shared";

const statesAreCompatible = (left?: string, right?: string) => {
  const a = compact(left);
  const b = compact(right);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
};

export const runContinuityCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => {
  const bundle = collectProductionCoordinationArtifacts(snapshot.operatorArtifacts);
  const issues: ProductionQAIssue[] = [];
  const scenesWithoutContinuity = snapshot.scenes.filter((scene) => {
    const sceneText = `${scene.valueShift?.from || ""} ${scene.valueShift?.to || ""} ${scene.interactiveMetadata?.incomingContext || ""} ${scene.interactiveMetadata?.outgoingContext || ""}`;
    const shotText = asArray<Shot>(scene.shots).map((shot) => shot.continuityNote || "").join(" ");
    return !isNonEmpty(sceneText) && !isNonEmpty(shotText);
  });
  if (snapshot.scenes.length > 0 && scenesWithoutContinuity.length === snapshot.scenes.length) {
    issues.push(coordinationIssue(
      "episodes.scenes.continuity",
      "当前范围内所有场景都缺少连续性/场记线索。",
      "warning",
      "至少补齐场景 valueShift、入出场状态、道具状态、伤势/服化道变化或镜头 continuityNote。",
      { issueType: "continuity_coordination" },
    ));
  }

  const shotsWithoutContinuity = snapshot.shots.filter((shot) => !isNonEmpty(shot.continuityNote));
  if (snapshot.shots.length >= 3 && shotsWithoutContinuity.length / snapshot.shots.length > 0.8) {
    issues.push(coordinationIssue(
      "episodes.scenes.shots.continuityNote",
      "大多数镜头缺少 continuityNote，后续故事板难以保证动作、视线和道具承接。",
      "warning",
      "为关键转折镜头补充 continuityNote，至少覆盖入场、出场、道具交接、伤势/服化道变化和轴线规则。",
      { issueType: "continuity_coordination" },
    ));
  }

  for (const pack of bundle.sceneVisualPacks) {
    if (!isNonEmpty(pack.continuityIn) || !isNonEmpty(pack.continuityOut)) {
      issues.push(coordinationIssue(
        `sceneVisualPack.${pack.id}.continuity`,
        `场景视觉包 ${pack.id} 缺少 continuityIn/continuityOut。`,
        "blocking",
        "补齐该场入场状态和出场状态，否则后续参考包和视频单元无法稳定承接。",
        { issueType: "continuity_coordination", retryable: true },
      ));
    }
  }

  const unitsById = new Map(bundle.videoGenerationUnits.map((unit) => [unit.id, unit]));
  for (const board of bundle.storyboardBoards) {
    const unit = board.videoGenerationUnitId ? unitsById.get(board.videoGenerationUnitId) : undefined;
    if (unit && (!statesAreCompatible(board.startState, unit.startState) || !statesAreCompatible(board.endState, unit.endState))) {
      issues.push(coordinationIssue(
        `storyboardBoard.${board.id}.state`,
        `故事板 ${board.id} 的首尾状态与视频单元 ${unit.id} 不一致。`,
        "warning",
        "统一 storyboardBoard.start/endState 与 videoGenerationUnit.start/endState，再进入生成计划。",
        { issueType: "continuity_coordination" },
      ));
    }
  }

  const unitsByScene = new Map<string, VideoGenerationUnit[]>();
  for (const unit of bundle.videoGenerationUnits) {
    unitsByScene.set(unit.sceneId, [...(unitsByScene.get(unit.sceneId) || []), unit]);
  }
  for (const [sceneId, units] of unitsByScene) {
    if (units.length <= 1) continue;
    const weakLinks = units.filter((unit, index) =>
      (index > 0 && !unit.previousUnitId) || (index < units.length - 1 && !unit.nextUnitId),
    );
    if (weakLinks.length) {
      issues.push(coordinationIssue(
        `videoGenerationUnits.${sceneId}.links`,
        `场景 ${sceneId} 存在多个视频生成单元，但部分单元缺少 previousUnitId/nextUnitId。`,
        "warning",
        "补齐相邻视频单元链路，便于首尾帧、动作承接和返工定位。",
        { issueType: "continuity_coordination" },
      ));
    }
  }

  const propOwners = new Map<string, Set<string>>();
  for (const pack of bundle.sceneVisualPacks) {
    for (const prop of asArray<SceneVisualPackProp>(pack.props)) {
      if (!prop.assetId || !prop.ownerCharacterId) continue;
      propOwners.set(prop.assetId, new Set([...(propOwners.get(prop.assetId) || []), prop.ownerCharacterId]));
      if (propOwners.get(prop.assetId)!.size > 1 && !/交接|转交|夺|失去|拿回|归还/.test(prop.continuityState || "")) {
        issues.push(coordinationIssue(
          `sceneVisualPack.${pack.id}.props.${prop.assetId}.ownerCharacterId`,
          `道具 ${prop.assetId} 在多个视觉包中出现持有人变化，但当前包未说明交接原因。`,
          "warning",
          "在 continuityState 中说明道具交接、夺取、遗失或归还原因。",
          { issueType: "continuity_coordination" },
        ));
      }
    }
  }

  return departmentFindingFromIssues({
    department: "continuity",
    issues,
    passedMessage: "连续性/场记统筹未发现当前范围的结构性缺口。",
    target: "coordination.continuity",
    ownerAgentId: "linear.storyboard.continuity_planner",
    suggestedStageType: "storyboard",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
