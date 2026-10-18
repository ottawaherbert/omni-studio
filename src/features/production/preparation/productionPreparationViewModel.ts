import type { Episode, ManualFilmTeamDepartment, Scene } from "../../../types/project";
import type { ManualFilmTeamReadModel } from "../../../services/production/manualFilmTeamReadModel";
import type { ManualProductionAssetReadModel } from "../../../services/production/manualProductionAssets";
import {
  manualFilmTeamRequiredDepartmentsForScene,
  manualFilmTeamSceneSource,
  manualFilmTeamScriptHash,
} from "../../../services/production/manualFilmTeam";

export type ProductionPreparationTab = "overview" | "breakdown" | "departments" | "assets" | "review";

export const productionPreparationTabs: Array<{ id: ProductionPreparationTab; label: string }> = [
  { id: "overview", label: "剧本总览" },
  { id: "breakdown", label: "场次信息" },
  { id: "assets", label: "本场资产" },
];

/** Uses only the confirmed structured breakdown, never text heuristics. */
export const recommendedDepartmentsForScene = manualFilmTeamRequiredDepartmentsForScene;

export const breakdownSourceChanged = (scene: Scene) => {
  const record = scene.productionPreparation?.breakdown;
  return Boolean(
    record
    && (
      record.status === "stale"
      || record.sourceHash !== manualFilmTeamScriptHash(manualFilmTeamSceneSource(scene).text)
    ),
  );
};

export const breakdownStatus = (scene: Scene) => {
  if (!scene.breakdown) return "待拆解";
  const record = scene.productionPreparation?.breakdown;
  if (!record) return "待确认";
  if (record.status === "needs_revision") return "需优化";
  return "已确认";
};

export const hasProductionSceneSource = (scene: Scene) => Boolean(manualFilmTeamSceneSource(scene).text.trim());

/** Episode navigation is limited to units that contain a real production scene. */
export const hasProductionEpisodeSource = (episode: Episode) => Boolean(
  episode.sourceDocumentId || episode.scenes.some(hasProductionSceneSource),
);

export type PreparationStepState = "complete" | "attention" | "pending";

export interface PreparationStepSummary {
  id: ProductionPreparationTab;
  label: string;
  state: PreparationStepState;
}

export interface ProductionPreparationTabStatus {
  id: ProductionPreparationTab;
  label: string;
  state: PreparationStepState;
}

export interface ProductionPreparationCurrentTask {
  tab: ProductionPreparationTab;
  title: string;
  detail: string;
  state: "attention" | "complete";
  department?: ManualFilmTeamDepartment;
}

/**
 * Projects scene and asset facts into the visible editing tabs. It does not persist UI-only progress or infer facts from free text.
 */
export const buildProductionPreparationTabStatuses = ({
  scene,
  filmTeam,
  assets,
}: {
  scene: Scene;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
}): ProductionPreparationTabStatus[] => {
  const breakdown = breakdownStatus(scene);
  const breakdownReady = breakdown === "已确认";
  const assetPackConfirmed = Boolean(scene.productionPreparation?.assetPack);
  return [
    { id: "overview", label: "已导入", state: "complete" },
    { id: "breakdown", label: breakdown, state: breakdownReady ? "complete" : breakdown === "待拆解" ? "pending" : "attention" },
    { id: "assets", label: assetPackConfirmed ? "已确认" : assets.issues?.some(issue => issue.severity === "blocking") ? "有引用问题" : "可编辑", state: assetPackConfirmed ? "complete" : "attention" },
  ];
};

/**
 * Picks the next author-owned task from the same confirmed facts as the gate.
 * This is navigation guidance only; it never starts a model action or writes state.
 */
export const buildProductionPreparationCurrentTask = ({
  scene,
  filmTeam,
  assets,
}: {
  scene: Scene;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
}): ProductionPreparationCurrentTask => {
  const issue = assets.issues?.find(item => item.severity === "blocking");
  if (issue) return { tab: "assets", title: "核对本场资产引用", detail: issue.message, state: "attention" };
  return { tab: "assets", title: "进入分镜制作", detail: "可直接根据本场原文制作分镜，资产按需补充。", state: "complete" };
};

/** Finds the next unfinished scene without changing the current scene or any author-owned facts. */
export const nextIncompleteProductionSceneId = (
  scenes: Scene[],
  activeSceneId: string | null,
  isIncomplete: (scene: Scene) => boolean,
) => {
  if (scenes.length < 2) return undefined;
  const activeIndex = Math.max(0, scenes.findIndex((scene) => scene.id === activeSceneId));
  const ordered = [...scenes.slice(activeIndex + 1), ...scenes.slice(0, activeIndex)];
  return ordered.find(isIncomplete)?.id;
};

export const preparationStepSummaries = (scene: Scene, _episode?: Episode): PreparationStepSummary[] => {
  const breakdown = breakdownStatus(scene);
  return [
    { id: "breakdown", label: "场", state: breakdown === "已确认" ? "complete" : scene.breakdown ? "attention" : "pending" },
    { id: "assets", label: "资", state: scene.productionPreparation?.assetPack ? "complete" : "pending" },
  ];
};

export const preparationStartTab = (scene: Scene, _episode?: Episode): ProductionPreparationTab => scene.breakdown ? "assets" : "breakdown";

/** Preserve old bookmarked URLs while removing obsolete workflow steps. */
export const resolveProductionSceneTab = (tab: string | null, scene?: Scene, episode?: Episode): ProductionPreparationTab => {
  if (!scene) return "overview";
  if (tab === "departments" || tab === "review") return "assets";
  if (productionPreparationTabs.some(item => item.id === tab)) return tab as ProductionPreparationTab;
  return scene ? preparationStartTab(scene, episode) : "overview";
};
