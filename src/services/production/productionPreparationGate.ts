import type { Scene } from "../../types/project";
import { manualFilmTeamSceneSource, manualFilmTeamScriptHash } from "./manualFilmTeam";
import type { ManualFilmTeamReadModel } from "./manualFilmTeamReadModel";
import type { ManualProductionAssetReadModel } from "./manualProductionAssets";

export interface ProductionPreparationGate {
  breakdownReady: boolean;
  breakdownSourceChanged: boolean;
  departmentsReady: boolean;
  continuityReady: boolean;
  assetsReady: boolean;
  assetReferencesReady: boolean;
  assetPackConfirmed: boolean;
  assetPackSourceChanged: boolean;
  coordinationConfirmed: boolean;
  coordinationSourceChanged: boolean;
  readyForShotPlanning: boolean;
  readyForStoryboard: boolean;
  advisories: string[];
  shotPlanningReason?: string;
  storyboardReason?: string;
  /** Compatibility alias for consumers whose final action still needs the full storyboard gate. */
  reason?: string;
}

export const buildProductionPreparationGate = ({
  scene,
  filmTeam,
  assets,
}: {
  scene: Scene;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
}): ProductionPreparationGate => {
  const breakdown = scene.productionPreparation?.breakdown;
  const sceneSourceHash = manualFilmTeamScriptHash(manualFilmTeamSceneSource(scene).text);
  const breakdownSourceChanged = Boolean(
    breakdown
    && (breakdown.status === "stale" || breakdown.sourceHash !== sceneSourceHash),
  );
  const breakdownReady = Boolean(
    scene.breakdown
    && breakdown
    && (breakdown.status === "confirmed" || breakdown.status === "stale"),
  );
  const departmentsReady = filmTeam.directorCockpit.blockedDepartments === 0
    && filmTeam.directorCockpit.needsReviewDepartments === 0
    && filmTeam.directorCockpit.confirmedDepartments === filmTeam.coverage.length;
  const continuityReady = (filmTeam.directorCockpit.continuityBlocked ?? 0) === 0;
  const assetsReady = assets.readyForShotPlanning;
  const assetReferencesReady = assets.readyForStoryboardGeneration;
  const assetPackConfirmed = Boolean(scene.productionPreparation?.assetPack);
  const assetPackSourceChanged = Boolean(
    scene.productionPreparation?.assetPack
    && scene.productionPreparation.assetPack.sourceHash !== assets.assetPackHash,
  );
  const coordinationConfirmed = Boolean(scene.productionPreparation?.coordination);
  const coordinationSourceChanged = Boolean(
    scene.productionPreparation?.coordination
    && scene.productionPreparation.coordination.sourceHash !== assets.assetPackHash,
  );
  const readyForShotPlanning = Boolean(manualFilmTeamSceneSource(scene).text.trim() || scene.shots?.length);
  const readyForStoryboard = Boolean(scene.shots?.length);
  const referenceAdvice = assets.issues?.find(issue => issue.severity === "blocking")?.message
    || (!assetReferencesReady && assets.missingReferenceCount
      ? `本场还有 ${assets.missingReferenceCount} 项资产未提供参考图，可按需要补充。`
      : undefined);
  const shotPlanningReason = readyForShotPlanning ? undefined : "请先填写场景内容，或手动添加镜头。";
  const storyboardReason = readyForStoryboard ? undefined : "当前场景还没有镜头，可手动添加或让 AI 起草。";
  const unconfirmedAssetCount = Math.max(
    0,
    (assets.assetBoards?.length || 0) - (assets.confirmedBoardCount || 0),
  );
  const advisories = [
    ...(referenceAdvice ? [referenceAdvice] : []),
    ...(breakdownSourceChanged ? ["场次正文有更新；已保留原拆解确认，可按需复核。"] : []),
    ...(unconfirmedAssetCount
      ? [`${unconfirmedAssetCount} 个资产身份尚未确认；不影响继续，可按需处理。`]
      : []),
    ...(coordinationSourceChanged ? ["部门统筹所依据的资产包有更新；原确认仍保留，请复核本场统筹。"] : []),
    ...(!breakdownReady ? ["本场尚无已确认拆解，可继续草拟并按需补充。"] : []),
    ...filmTeam.coverage.filter(row => row.outputStatus !== "missing" && row.readiness !== "ready").map(row => `${row.name}已有资料待复核：${row.reasons.join("；") || "来源有变化"}。`),
    ...(!continuityReady ? ["本场连续性检查存在待补项，请核对筹备页记录。"] : []),
    ...(assetPackSourceChanged ? ["资产内容有更新；已保留本场资产包确认，可按需复核。"] : []),
  ];

  return {
    breakdownReady,
    breakdownSourceChanged,
    departmentsReady,
    continuityReady,
    assetsReady,
    assetReferencesReady,
    assetPackConfirmed,
    assetPackSourceChanged,
    coordinationConfirmed,
    coordinationSourceChanged,
    readyForShotPlanning,
    readyForStoryboard,
    advisories: Array.from(new Set(advisories)),
    shotPlanningReason,
    storyboardReason,
    reason: storyboardReason,
  };
};
