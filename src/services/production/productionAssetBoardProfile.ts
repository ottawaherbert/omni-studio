import type {
  Asset,
  AssetVariant,
  Character,
  ManualProductionAssetReferenceAudit,
  Project,
  Scene,
} from "../../types/project";
import { manualFilmTeamScriptHash } from "./manualFilmTeam";
import {
  buildVideoStoryboardAssetBoardPlan,
  type VideoStoryboardAssetBoardItem,
} from "./videoStoryboardAssetBoards";
import {
  resolveProductionAssetReferenceModeSpec,
  type ProductionAssetReferenceMode,
} from "./productionAssetReferenceMode";

const allBoardItems = (project: Project): VideoStoryboardAssetBoardItem[] => {
  const plan = buildVideoStoryboardAssetBoardPlan(project);
  return [
    ...plan.characterBoards,
    ...plan.sceneBoards,
    ...plan.propBoards,
    ...plan.vehicleBoards,
    ...plan.variantBoards,
  ];
};

export interface ProductionAssetBoardGenerationReference {
  boardItemId?: string;
  imageUrl?: string;
  label: string;
  explicitVariantSource: boolean;
  issue?: string;
}

export const resolveProductionAssetBoardGenerationReference = (
  project: Project,
  board: VideoStoryboardAssetBoardItem,
): ProductionAssetBoardGenerationReference => {
  const boards = allBoardItems(project);
  if (board.variantId) {
    const owner = board.assetType === "character"
      ? project.characters.find((item) => item.id === board.assetId)
      : project.assets.find((item) => item.id === board.assetId);
    const variant = owner?.variants?.find((item) => item.id === board.variantId);
    if (variant?.referenceVariantId) {
      const sourceVariant = owner?.variants?.find((item) => item.id === variant.referenceVariantId);
      const sourceBoard = boards.find((item) =>
        item.assetId === board.assetId && item.variantId === variant.referenceVariantId
      );
      if (!sourceVariant || !sourceBoard) {
        return {
          label: "无效的变体继承来源",
          explicitVariantSource: true,
          issue: `状态变体「${variant.name}」引用的上游变体不存在，请重新选择继承参考板。`,
        };
      }
      if (!sourceBoard.referenceImageUrl) {
        return {
          boardItemId: sourceBoard.id,
          label: `${sourceVariant.name} · 状态变体板`,
          explicitVariantSource: true,
          issue: `请先完成上游状态变体板「${sourceVariant.name}」，再生成「${variant.name}」。`,
        };
      }
      return {
        boardItemId: sourceBoard.id,
        imageUrl: sourceBoard.referenceImageUrl,
        label: `${sourceVariant.name} · 状态变体板`,
        explicitVariantSource: true,
      };
    }

    const baseBoard = boards.find((item) => item.assetId === board.assetId && !item.variantId);
    return {
      boardItemId: baseBoard?.id,
      imageUrl: baseBoard?.referenceImageUrl,
      label: "基础身份板",
      explicitVariantSource: false,
      ...(!baseBoard?.referenceImageUrl ? { issue: `请先完成「${board.assetName}」基础身份板。` } : {}),
    };
  }

  if (board.referenceImageUrl) {
    return {
      boardItemId: board.id,
      imageUrl: board.referenceImageUrl,
      label: "当前正式资产板",
      explicitVariantSource: false,
    };
  }
  if (board.assetType === "character") {
    const character = project.characters.find((item) => item.id === board.assetId);
    const imageUrl = character?.referenceImageUrl || character?.defaultReferenceUrl || character?.multiViewUrl;
    return {
      imageUrl,
      label: imageUrl ? "角色身份参考" : "无参考图",
      explicitVariantSource: false,
    };
  }
  const asset = project.assets.find((item) => item.id === board.assetId);
  const imageUrl = asset?.imageUrl || asset?.defaultReferenceUrl || asset?.multiViewUrl || asset?.panoramaUrl;
  return {
    imageUrl,
    label: imageUrl ? "资产生产参考" : "无参考图",
    explicitVariantSource: false,
  };
};

export const findProductionAssetBoard = (
  project: Project,
  assetId: string,
  variantId?: string,
) => allBoardItems(project).find((item) =>
  item.assetId === assetId && (variantId ? item.variantId === variantId : !item.variantId)
);

const updateVariant = (
  variants: AssetVariant[] | undefined,
  variantId: string,
  updates: Partial<AssetVariant>,
) => (variants || []).map((variant) => variant.id === variantId ? { ...variant, ...updates } : variant);

export const buildProductionAssetBoardPromptUpdate = ({
  project,
  assetId,
  variantId,
  prompt,
  referenceMode = "production_board",
}: {
  project: Project;
  assetId: string;
  variantId?: string;
  prompt: string;
  referenceMode?: ProductionAssetReferenceMode;
}): Pick<Project, "characters" | "assets"> => {
  if (!findProductionAssetBoard(project, assetId, variantId)) {
    throw new Error("找不到对应的角色板、场景板、道具板或变体板。");
  }
  const normalizedPrompt = prompt.trim();
  const promptUpdate = referenceMode === "clean_reference"
    ? { cleanReferencePrompt: normalizedPrompt }
    : { boardPrompt: normalizedPrompt };
  return {
    characters: project.characters.map((character) => character.id !== assetId ? character : variantId
      ? { ...character, variants: updateVariant(character.variants, variantId, promptUpdate) }
      : { ...character, ...promptUpdate }),
    assets: project.assets.map((asset) => asset.id !== assetId ? asset : variantId
      ? { ...asset, variants: updateVariant(asset.variants, variantId, promptUpdate) }
      : { ...asset, ...promptUpdate }),
  };
};

const sceneUsesBoard = (scene: Scene, board: VideoStoryboardAssetBoardItem) => {
  const breakdown = scene.breakdown;
  if (board.assetType === "character") {
    return Boolean(breakdown?.characterIds?.includes(board.assetId)
      || scene.shots?.some((shot) => shot.characterIdsInShot?.includes(board.assetId)));
  }
  if (board.assetType === "location") {
    return Boolean(breakdown?.locationId === board.assetId
      || scene.shots?.some((shot) => shot.locationId === board.assetId));
  }
  if (board.assetType === "vehicles") return Boolean(breakdown?.vehicleIds?.includes(board.assetId)
    || scene.shots?.some((shot) => shot.vehicleIds?.includes(board.assetId))
    || scene.manualStoryboard?.boards?.some((workflow) => workflow.board?.panels.some((panel) => panel.assetRefs.includes(board.assetId))));
  return Boolean(breakdown?.propIds?.includes(board.assetId)
    || scene.shots?.some((shot) => shot.propIds?.includes(board.assetId)));
};

export const projectSceneIdsForBoard = (project: Project, board: VideoStoryboardAssetBoardItem) =>
  (project.episodes || []).flatMap((episode) => {
    const scenes = "scenes" in episode && Array.isArray(episode.scenes) ? episode.scenes : [];
    return scenes.filter((scene) => sceneUsesBoard(scene, board)).map((scene) => scene.id);
  });

export const buildProductionAssetBoardReferenceUpdate = ({
  project,
  boardItemId,
  imageUrl,
  source,
  sourceRunId,
  finalPrompt,
  modelId,
  executionProvenance,
  inputReferenceUrl,
  imageReferenceManifest,
  promptCompositionManifest,
  visualStyleCompileManifest,
  sourceContentHash,
  sourceReview,
  selectedSkillIds = [],
  selectedSkillTitles = [],
  selectedContextIds = [],
  quality,
  review,
  referenceMode = "production_board",
  candidateId,
  generatedAt,
  createdAt = Date.now(),
}: {
  project: Project;
  boardItemId: string;
  imageUrl: string;
  source: ManualProductionAssetReferenceAudit["source"];
  sourceRunId?: string;
  finalPrompt: string;
  modelId?: string;
  executionProvenance?: ManualProductionAssetReferenceAudit["executionProvenance"];
  inputReferenceUrl?: string;
  imageReferenceManifest?: ManualProductionAssetReferenceAudit["imageReferenceManifest"];
  promptCompositionManifest?: ManualProductionAssetReferenceAudit["promptCompositionManifest"];
  visualStyleCompileManifest?: ManualProductionAssetReferenceAudit["visualStyleCompileManifest"];
  sourceContentHash?: string;
  sourceReview?: ManualProductionAssetReferenceAudit["sourceReview"];
  selectedSkillIds?: string[];
  selectedSkillTitles?: string[];
  selectedContextIds?: string[];
  quality?: ManualProductionAssetReferenceAudit["quality"];
  review?: ManualProductionAssetReferenceAudit["review"];
  referenceMode?: ProductionAssetReferenceMode;
  candidateId?: string;
  generatedAt?: number;
  createdAt?: number;
}): Pick<Project, "characters" | "assets" | "manualProductionAssets"> => {
  const board = allBoardItems(project).find((item) => item.id === boardItemId);
  if (!board) throw new Error("找不到当前资产板，无法采用参考图。");
  if (!imageUrl.trim()) throw new Error("参考图为空，无法采用。");

  let characters: Character[] = project.characters;
  let assets: Asset[] = project.assets;
  if (board.assetType === "character") {
    characters = project.characters.map((character) => character.id !== board.assetId ? character : board.variantId
      ? {
          ...character,
          variants: updateVariant(character.variants, board.variantId, {
            ...(referenceMode === "clean_reference"
              ? { cleanReferenceImageUrl: imageUrl, imageUrl }
              : { boardImageUrl: imageUrl, ...(!character.variants?.find((item) => item.id === board.variantId)?.cleanReferenceImageUrl ? { imageUrl } : {}) }),
          }),
        }
      : referenceMode === "clean_reference"
        ? { ...character, cleanReferenceImageUrl: imageUrl, multiViewUrl: imageUrl }
        : {
            ...character,
            boardImageUrl: imageUrl,
            ...(!character.cleanReferenceImageUrl ? { multiViewUrl: imageUrl } : {}),
          });
    const updatedCharacter = characters.find((character) => character.id === board.assetId);
    if (updatedCharacter) {
      assets = project.assets.map((asset) => asset.id !== `char-${board.assetId}` ? asset : {
        ...asset,
        boardImageUrl: updatedCharacter.boardImageUrl,
        cleanReferenceImageUrl: updatedCharacter.cleanReferenceImageUrl,
        multiViewUrl: updatedCharacter.multiViewUrl,
        variants: updatedCharacter.variants || [],
      });
    }
  } else {
    assets = project.assets.map((asset) => asset.id !== board.assetId ? asset : board.variantId
      ? {
          ...asset,
          variants: updateVariant(asset.variants, board.variantId, {
            ...(referenceMode === "clean_reference"
              ? { cleanReferenceImageUrl: imageUrl, imageUrl }
              : { boardImageUrl: imageUrl, ...(!asset.variants?.find((item) => item.id === board.variantId)?.cleanReferenceImageUrl ? { imageUrl } : {}) }),
          }),
        }
      : referenceMode === "clean_reference"
        ? {
            ...asset,
            cleanReferenceImageUrl: imageUrl,
            ...(board.assetType === "location" ? { panoramaUrl: imageUrl } : { multiViewUrl: imageUrl }),
          }
        : {
            ...asset,
            boardImageUrl: imageUrl,
            ...(!asset.cleanReferenceImageUrl
              ? board.assetType === "location" ? { panoramaUrl: imageUrl } : { multiViewUrl: imageUrl }
              : {}),
          });
  }

  const modeSpec = resolveProductionAssetReferenceModeSpec(board, referenceMode);

  const audit: ManualProductionAssetReferenceAudit = {
    candidateId,
    boardItemId: board.id,
    assetId: board.assetId,
    assetType: board.assetType,
    variantId: board.variantId,
    imageUrl,
    source,
    sourceRunId,
    promptHash: finalPrompt ? manualFilmTeamScriptHash(finalPrompt) : undefined,
    finalPrompt: finalPrompt || undefined,
    modelId,
    executionProvenance,
    inputReferenceUrl,
    imageReferenceManifest,
    promptCompositionManifest,
    visualStyleCompileManifest,
    sourceContentHash,
    sourceReview,
    selectedSkillIds,
    selectedSkillTitles,
    selectedContextIds,
    layoutContractId: modeSpec.contractId,
    referenceMode,
    quality,
    review,
    sourceSceneIds: projectSceneIdsForBoard(project, board),
    generatedAt: generatedAt || createdAt,
    adoptedAt: createdAt,
    adoptedBy: "user",
    createdAt,
    updatedAt: createdAt,
  };
  return {
    characters,
    assets,
    manualProductionAssets: {
      schemaVersion: "manual-production-assets.v1",
      approvals: project.manualProductionAssets?.approvals || [],
      references: [
        ...(project.manualProductionAssets?.references || []).filter((item) => item.boardItemId !== board.id
          || (item.referenceMode || "production_board") !== referenceMode),
        audit,
      ],
      pendingReferences: project.manualProductionAssets?.pendingReferences || [],
      variants: project.manualProductionAssets?.variants || [],
      profileRevisions: project.manualProductionAssets?.profileRevisions || [],
      preparationBatches: project.manualProductionAssets?.preparationBatches || [],
      updatedAt: createdAt,
    },
  };
};
