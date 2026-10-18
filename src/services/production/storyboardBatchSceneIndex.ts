import type { Episode, Project, Scene } from "../../types/project";
import {
  manualFilmTeamRequiredDepartmentsForScene,
} from "./manualFilmTeam";
import {
  buildManualFilmTeamReadModel,
  type ManualFilmTeamReadModel,
} from "./manualFilmTeamReadModel";
import {
  buildManualProductionAssetReadModel,
  type ManualProductionAssetReadModel,
} from "./manualProductionAssets";
import { buildManualStoryboardReadModel } from "./manualStoryboard";
import { buildManualVideoStoryboardReadModel } from "./manualVideoStoryboard";
import { buildProductionPreparationGate } from "./productionPreparationGate";
import type { StoryboardAssetScope } from "./storyboardShotAgent";
import { buildProductionSceneContext } from "./productionSceneContext";

export interface StoryboardBatchSceneReadModel {
  scene: Scene;
  productionReady: boolean;
  shotPlanComplete: boolean;
  imagePromptReady: boolean;
  imagePromptComplete: boolean;
  videoPromptReady: boolean;
  videoPromptComplete: boolean;
  /** @deprecated Use the independent image/video prompt fields. */
  visualPromptReady: boolean;
  /** @deprecated Use the independent image/video prompt fields. */
  visualPromptComplete: boolean;
  boardDraftReady: boolean;
  boardFormalReady: boolean;
  boardBlockReason?: string;
  boardVisualBlockReason?: string;
  boardComplete: boolean;
  boardApproved: boolean;
  storyboardSourceHash: string;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
  filmTeamContext: string;
  assetContext: string;
  boardAllowedAssetIds: string[];
  sourceHash: string;
  manualTeamContext: string;
  manualAssetContext: string;
  allowedAssetIds: StoryboardAssetScope;
}

export const buildStoryboardTeamPromptContext = (episode: Episode, scene: Scene, project: Partial<Project> = {}) => {
  const workspace = episode as Episode & {
    __workspaceProductionTeamSummaryOnly?: boolean;
  };
  if (workspace.__workspaceProductionTeamSummaryOnly || episode.scenes.some(item => (item as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary)) return "";
  return JSON.stringify(buildProductionSceneContext(episode, scene, [], project), null, 2);
};

export const buildStoryboardAssetPromptContext = (
  project: Project,
  readModel: ManualProductionAssetReadModel,
) => {
  const characterById = new Map((project.characters || []).map((character) => [character.id, character]));
  const assetById = new Map((project.assets || []).map((asset) => [asset.id, asset]));
  const sceneStateByAssetId = new Map(readModel.sceneStates.map((state) => [state.assetId, state]));
  return JSON.stringify({
    assetPolicy: "本场已绑定资产优先。项目资产目录仅用于匹配原文中的角色、场景、道具和交通工具，不代表都要出场；不得把无关资产加入镜头。没有匹配身份时保留原文称呼，不编造 ID。",
    availableProjectAssets: [
      ...(project.characters || []).map(item => ({ assetId: item.id, assetType: "character", assetName: item.name, variants: (item.variants || []).map(v => ({ id: v.id, name: v.name, description: v.description, appearanceFields: v.appearanceFields })) })),
      ...(project.assets || []).filter(item => ["location", "prop", "vehicles"].includes(item.type)).map(item => ({ assetId: item.id, assetType: item.type, assetName: item.name, variants: (item.variants || []).map(v => ({ id: v.id, name: v.name, description: v.description, appearanceFields: v.appearanceFields })) })),
    ],
    sceneStates: readModel.sceneStates,
    formalAssets: readModel.assetBoards.map((board) => ({
      assetId: board.assetId,
      assetType: board.assetType,
      assetName: board.assetName,
      variantId: board.variantId,
      variantName: board.variantName,
      identityAnchor: board.assetType === "character"
        ? characterById.get(board.assetId)?.visualIdentity
        : assetById.get(board.assetId)?.description,
      sceneState: sceneStateByAssetId.get(board.assetId)?.stateSummary,
      referenceImageUrl: board.referenceImageUrl,
      referenceStatus: board.referenceImageUrl ? "available" : "missing",
    })),
  }, null, 2);
};

export const buildStoryboardAllowedAssetIds = (
  readModel: ManualProductionAssetReadModel,
  project?: Project,
): StoryboardAssetScope => {
  const ids = (assetType: "character" | "location" | "prop" | "vehicles") => Array.from(new Set(
    [
      ...readModel.assetBoards.filter((board) => board.assetType === assetType).map((board) => board.assetId),
      ...(assetType === "character" ? project?.characters || [] : (project?.assets || []).filter(asset => asset.type === assetType)).map(asset => asset.id),
    ],
  ));
  return { character: ids("character"), location: ids("location"), prop: ids("prop"), vehicles: ids("vehicles") };
};

export const buildStoryboardBatchSceneReadModel = ({
  project,
  episode,
  episodes,
  scene,
}: {
  project: Project;
  episode: Episode;
  episodes: Episode[];
  scene: Scene;
}): StoryboardBatchSceneReadModel => {
  const filmTeam = buildManualFilmTeamReadModel({
    project,
    episode,
    requiredDepartments: manualFilmTeamRequiredDepartmentsForScene(scene),
  });
  const assets = buildManualProductionAssetReadModel({
    project,
    episode,
    scene,
    episodes,
    filmTeam,
  });
  const gate = buildProductionPreparationGate({ scene, filmTeam, assets });
  const storyboard = buildManualStoryboardReadModel({ scene, filmTeam, assets });
  const boardBlockReason = storyboard.readyForStoryboardDraftGeneration
    ? undefined
    : !scene.shots?.length
      ? "本场尚未划分镜头，不能生成故事板。"
      : !storyboard.shotPlanAccepted
        ? "本场镜头方案需要重新确认后，才能生成故事板。"
        : "本场分镜尚未满足故事板草案条件。";
  const boardVisualBlockReason = !storyboard.readyForStoryboardDraftGeneration
    ? boardBlockReason
    : !storyboard.imagePromptAccepted
      ? "请先在“分镜”页签生成并确认图片提示词，再生成故事板或宫格画面。"
      : !assets.readyForStoryboardGeneration
        ? "正式资产参考尚未满足故事板画面生成条件。"
        : undefined;
  const boardReadModels = (scene.shots || []).map((shot) => buildManualVideoStoryboardReadModel({
    workflows: scene.manualStoryboard?.boards,
    shot,
    storyboardSourceHash: storyboard.sourceHash,
    project,
    assets,
    scene,
  }));
  const boardComplete = boardReadModels.length > 0 && boardReadModels.every((readModel) =>
    readModel.visualPageCount > 0
      && (readModel.boardVisualStatus === "ready" || readModel.boardVisualStatus === "needs_review"));
  const boardApproved = boardReadModels.length > 0
    && boardReadModels.every((readModel) => readModel.readyForStudio);
  const filmTeamContext = buildStoryboardTeamPromptContext(episode, scene, project);
  const assetContext = buildStoryboardAssetPromptContext(project, assets);

  return {
    scene,
    productionReady: gate.readyForShotPlanning,
    shotPlanComplete: storyboard.shotPlanAccepted,
    imagePromptReady: storyboard.readyForImagePromptGeneration,
    imagePromptComplete: storyboard.imagePromptAccepted,
    videoPromptReady: storyboard.readyForVideoPromptGeneration,
    videoPromptComplete: storyboard.videoPromptAccepted,
    visualPromptReady: storyboard.readyForImagePromptGeneration && storyboard.readyForVideoPromptGeneration,
    visualPromptComplete: storyboard.imagePromptAccepted && storyboard.videoPromptAccepted,
    boardDraftReady: storyboard.readyForStoryboardDraftGeneration,
    boardFormalReady: gate.readyForStoryboard && storyboard.readyForStoryboardFormalAdoption,
    boardBlockReason,
    boardVisualBlockReason,
    boardComplete,
    boardApproved,
    storyboardSourceHash: storyboard.sourceHash,
    filmTeam,
    assets,
    filmTeamContext,
    assetContext,
    boardAllowedAssetIds: Array.from(new Set(assets.assetBoards.map((board) => board.assetId))),
    sourceHash: storyboard.sourceHash,
    manualTeamContext: filmTeamContext,
    manualAssetContext: assetContext,
    allowedAssetIds: buildStoryboardAllowedAssetIds(assets, project),
  };
};

const yieldToMainThread = async () => {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler?.yield) {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

export const buildStoryboardBatchSceneIndex = async ({
  project,
  episode,
  episodes,
  scenes,
  signal,
  yieldControl = yieldToMainThread,
}: {
  project: Project;
  episode: Episode;
  episodes: Episode[];
  scenes: Scene[];
  signal?: AbortSignal;
  yieldControl?: () => Promise<void>;
}): Promise<StoryboardBatchSceneReadModel[]> => {
  const readModels: StoryboardBatchSceneReadModel[] = [];
  for (const scene of scenes) {
    if (signal?.aborted) {
      const error = new Error("Storyboard batch indexing was cancelled.");
      error.name = "AbortError";
      throw error;
    }
    readModels.push(buildStoryboardBatchSceneReadModel({
      project,
      episode,
      episodes,
      scene,
    }));
    if (readModels.length < scenes.length) await yieldControl();
  }
  return readModels;
};
