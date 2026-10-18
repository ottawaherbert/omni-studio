import { assetVisualDescription } from "./productionAssetDesign";
import type {
  Asset,
  AssetVariant,
  Episode,
  ProductionPreparationAssetBinding,
  ProductionPreparationAssetType,
  Project,
  Scene,
  ScriptBreakdown,
} from "../../types/project";

export type ProductionProjectAssetGroup = "character" | "location" | "prop" | "vehicles" | "other";

export interface ProductionProjectAssetUsage {
  episodeId: string;
  episodeTitle: string;
  sceneId: string;
  sceneTitle: string;
  variantId?: string;
  shotIds: string[];
}

export interface ProductionProjectAssetRecord {
  id: string;
  source: "project_character" | "project_asset";
  type: Asset["type"];
  group: ProductionProjectAssetGroup;
  name: string;
  description: string;
  boardImageUrl?: string;
  cleanReferenceImageUrl?: string;
  sourceImageUrl?: string;
  referenceImageUrl?: string;
  variants: AssetVariant[];
  defaultVariantId?: string;
  usageRefs: ProductionProjectAssetUsage[];
  missingReferenceCount: number;
}

export interface ProductionProjectAssetReadModel {
  projectId: string;
  assets: ProductionProjectAssetRecord[];
  totalAssetCount: number;
  totalVariantCount: number;
  linkedSceneCount: number;
  missingReferenceCount: number;
}

const assetGroup = (type: Asset["type"]): ProductionProjectAssetGroup => {
  if (type === "character" || type === "location" || type === "prop" || type === "vehicles") return type;
  return "other";
};

const sceneAssetIds = (scene: Scene) => {
  const characterIds = new Set(scene.breakdown?.characterIds || []);
  const locationIds = new Set(scene.breakdown?.locationId ? [scene.breakdown.locationId] : []);
  const propIds = new Set(scene.breakdown?.propIds || []);
  const vehicleIds = new Set(scene.breakdown?.vehicleIds || []);
  for (const shot of scene.shots || []) {
    for (const characterId of shot.characterIdsInShot || []) characterIds.add(characterId);
    if (shot.locationId) locationIds.add(shot.locationId);
    for (const propId of shot.propIds || []) propIds.add(propId);
    for (const vehicleId of shot.vehicleIds || []) vehicleIds.add(vehicleId);
  }
  return { characterIds, locationIds, propIds, vehicleIds };
};

const usageFor = (
  assetId: string,
  group: ProductionProjectAssetGroup,
  episodes: Episode[],
): ProductionProjectAssetUsage[] => episodes.flatMap((episode) => (episode.scenes || []).flatMap((scene) => {
  const ids = sceneAssetIds(scene);
  const isUsed = group === "character"
    ? ids.characterIds.has(assetId)
    : group === "location"
      ? ids.locationIds.has(assetId)
      : group === "prop"
        ? ids.propIds.has(assetId)
        : group === "vehicles"
          ? ids.vehicleIds.has(assetId)
        : false;
  if (!isUsed) return [];
  const shotIds = (scene.shots || []).filter((shot) => group === "character"
    ? shot.characterIdsInShot?.includes(assetId)
    : group === "location"
      ? shot.locationId === assetId
      : group === "vehicles"
        ? shot.vehicleIds?.includes(assetId)
      : shot.propIds?.includes(assetId)).map((shot) => shot.id);
  return [{
    episodeId: episode.id,
    episodeTitle: episode.title,
    sceneId: scene.id,
    sceneTitle: scene.title,
    variantId: scene.breakdown?.assetVariantMap?.[assetId],
    shotIds,
  }];
}));

const missingReferenceCount = (boardImageUrl: string | undefined, variants: AssetVariant[]) =>
  Number(!boardImageUrl) + variants.filter((variant) => !(variant.cleanReferenceImageUrl || variant.boardImageUrl || variant.imageUrl)).length;

export const buildProductionProjectAssetReadModel = (
  project: Project,
  episodes: Episode[],
): ProductionProjectAssetReadModel => {
  const characterRecords: ProductionProjectAssetRecord[] = (project.characters || [])
    .filter((character) => character.visualPresence !== "voice_only")
    .map((character) => {
    const variants = character.variants || [];
    const boardImageUrl = character.boardImageUrl || (!character.cleanReferenceImageUrl ? character.multiViewUrl : undefined);
    const cleanReferenceImageUrl = character.cleanReferenceImageUrl;
    const sourceImageUrl = character.referenceImageUrl || character.defaultReferenceUrl;
    return {
      id: character.id,
      source: "project_character",
      type: "character",
      group: "character",
      name: character.name,
      description: assetVisualDescription(character),
      boardImageUrl,
      cleanReferenceImageUrl,
      sourceImageUrl,
      referenceImageUrl: cleanReferenceImageUrl || boardImageUrl || sourceImageUrl,
      variants,
      defaultVariantId: character.defaultVariantId,
      usageRefs: usageFor(character.id, "character", episodes),
      missingReferenceCount: missingReferenceCount(cleanReferenceImageUrl || boardImageUrl, variants),
    };
    });

  const characterIds = new Set((project.characters || []).map((character) => character.id));
  const assetRecords: ProductionProjectAssetRecord[] = (project.assets || [])
    .filter((asset) => {
      if (asset.type !== "character") return true;
      const mirroredCharacterId = asset.id.startsWith("char-") ? asset.id.slice(5) : asset.id;
      return !characterIds.has(mirroredCharacterId);
    })
    .map((asset) => {
      const group = assetGroup(asset.type);
      const variants = asset.variants || [];
      const boardImageUrl = asset.boardImageUrl || (!asset.cleanReferenceImageUrl ? (asset.type === "location" ? asset.panoramaUrl : asset.multiViewUrl) : undefined);
      const cleanReferenceImageUrl = asset.cleanReferenceImageUrl;
      const sourceImageUrl = asset.imageUrl || asset.defaultReferenceUrl;
      return {
        id: asset.id,
        source: "project_asset",
        type: asset.type,
        group,
        name: asset.name,
        description: assetVisualDescription(asset),
        boardImageUrl,
        cleanReferenceImageUrl,
        sourceImageUrl,
        referenceImageUrl: cleanReferenceImageUrl || boardImageUrl || sourceImageUrl,
        variants,
        defaultVariantId: asset.defaultVariantId,
        usageRefs: usageFor(asset.id, group, episodes),
        missingReferenceCount: missingReferenceCount(cleanReferenceImageUrl || boardImageUrl, variants),
      };
    });

  const assets = [...characterRecords, ...assetRecords];
  return {
    projectId: project.id,
    assets,
    totalAssetCount: assets.length,
    totalVariantCount: assets.reduce((total, asset) => total + asset.variants.length, 0),
    linkedSceneCount: new Set(assets.flatMap((asset) => asset.usageRefs.map((usage) => `${usage.episodeId}:${usage.sceneId}`))).size,
    missingReferenceCount: assets.reduce((total, asset) => total + asset.missingReferenceCount, 0),
  };
};

export const buildProductionSceneAssetVariantBindingUpdate = ({
  project,
  scene,
  assetId,
  variantId,
}: {
  project: Project;
  scene: Scene;
  assetId: string;
  variantId?: string;
}): Pick<Scene, "breakdown"> => {
  if (!scene.breakdown) throw new Error("当前场景尚未完成拆解，不能绑定资产状态。");
  const boundAssetIds = new Set([
    ...(scene.breakdown.characterIds || []),
    ...(scene.breakdown.locationId ? [scene.breakdown.locationId] : []),
    ...(scene.breakdown.propIds || []),
    ...(scene.breakdown.vehicleIds || []),
  ]);
  if (!boundAssetIds.has(assetId)) throw new Error("该资产不在当前场的正式拆解中，不能直接绑定。");

  if (variantId) {
    const character = project.characters.find((item) => item.id === assetId);
    const asset = project.assets.find((item) => item.id === assetId);
    const variants = character?.variants || asset?.variants || [];
    if (!variants.some((variant) => variant.id === variantId)) throw new Error("所选状态变体不属于该项目资产。");
  }

  const assetVariantMap = { ...(scene.breakdown.assetVariantMap || {}) };
  if (variantId) assetVariantMap[assetId] = variantId;
  else delete assetVariantMap[assetId];
  return { breakdown: { ...scene.breakdown, assetVariantMap } };
};

/** Explicitly bind a project vehicle to this scene and its current shot/board references. */
export const buildProductionSceneVehicleSelectionUpdate = ({
  project,
  scene,
  vehicleId,
  selected,
}: {
  project: Project;
  scene: Scene;
  vehicleId: string;
  selected: boolean;
}): Partial<Scene> => {
  if (!scene.breakdown) throw new Error("当前场景尚未完成拆解，不能绑定交通工具。");
  if (!project.assets.some((asset) => asset.id === vehicleId && asset.type === "vehicles")) throw new Error("所选交通工具不在项目资产库中。");
  const nextIds = (ids: string[] | undefined) => selected
    ? Array.from(new Set([...(ids || []), vehicleId]))
    : (ids || []).filter((id) => id !== vehicleId);
  return {
    breakdown: { ...scene.breakdown, vehicleIds: nextIds(scene.breakdown.vehicleIds) },
    shots: (scene.shots || []).map((shot) => ({ ...shot, vehicleIds: nextIds(shot.vehicleIds) })),
    ...(scene.manualStoryboard ? { manualStoryboard: {
      ...scene.manualStoryboard,
      boards: scene.manualStoryboard.boards?.map((workflow) => workflow.board ? {
        ...workflow,
        board: {
          ...workflow.board,
          panels: workflow.board.panels.map((panel) => ({ ...panel, assetRefs: nextIds(panel.assetRefs) })),
        },
      } : workflow),
    } } : {}),
  };
};

const normalizedAssetName = (value: string) => Array.from(value.trim().toLocaleLowerCase())
  .filter((character) => character.trim())
  .join("");

const namedBreakdownValue = (value: ScriptBreakdown["location"] | ScriptBreakdown["characters"][number] | ScriptBreakdown["props"][number]) =>
  typeof value === "object" && value ? String(value.name || "").trim() : String(value || "").trim();

const projectAssetIdentity = (
  project: Project,
  assetId: string,
): { id: string; name: string; type: ProductionPreparationAssetType; variants: AssetVariant[] } | undefined => {
  const character = project.characters.find((item) => item.id === assetId);
  if (character) return { id: character.id, name: character.name, type: "character", variants: character.variants || [] };
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset || (asset.type !== "location" && asset.type !== "prop" && asset.type !== "vehicles")) return undefined;
  return { id: asset.id, name: asset.name, type: asset.type, variants: asset.variants || [] };
};

const uniqueReplacedIds = (values: string[] | undefined, sourceIds: Set<string>, targetAssetId: string) => Array.from(new Set(
  (values || []).map((value) => sourceIds.has(value) ? targetAssetId : value),
));

const transferVariantBinding = ({
  project,
  breakdown,
  sourceIds,
  targetAssetId,
}: {
  project: Project;
  breakdown: ScriptBreakdown;
  sourceIds: Set<string>;
  targetAssetId: string;
}) => {
  const assetVariantMap = { ...(breakdown.assetVariantMap || {}) };
  const inheritedVariantId = Array.from(sourceIds).map((id) => assetVariantMap[id]).find(Boolean);
  for (const sourceId of sourceIds) delete assetVariantMap[sourceId];
  if (inheritedVariantId && projectAssetIdentity(project, targetAssetId)?.variants.some((variant) => variant.id === inheritedVariantId)) {
    assetVariantMap[targetAssetId] = inheritedVariantId;
  }
  return assetVariantMap;
};

const manualBindingForCurrentAsset = (
  bindings: ProductionPreparationAssetBinding[],
  assetType: ProductionPreparationAssetType,
  sourceAssetId: string,
) => bindings.find((binding) => binding.assetType === assetType
  && (binding.sourceAssetId === sourceAssetId || binding.targetAssetId === sourceAssetId));

export const buildProductionSceneAssetBindingUpdate = ({
  project,
  scene,
  sourceAssetId,
  targetAssetId,
  assetType,
  now = Date.now(),
}: {
  project: Project;
  scene: Scene;
  sourceAssetId: string;
  targetAssetId: string;
  assetType: ProductionPreparationAssetType;
  now?: number;
}): Partial<Scene> => {
  if (!scene.breakdown) throw new Error("当前场景尚未完成拆解，不能绑定项目资产。");
  const target = projectAssetIdentity(project, targetAssetId);
  if (!target || target.type !== assetType) throw new Error("所选项目资产与当前条目的类型不一致。");
  const source = projectAssetIdentity(project, sourceAssetId);
  if (!source || source.type !== assetType) throw new Error("当前场次资产已不存在，请刷新后重试。");

  const boundIds = assetType === "character"
    ? scene.breakdown.characterIds || []
    : assetType === "location"
      ? scene.breakdown.locationId ? [scene.breakdown.locationId] : []
      : assetType === "vehicles" ? scene.breakdown.vehicleIds || [] : scene.breakdown.propIds || [];
  if (!boundIds.includes(sourceAssetId)) throw new Error("该资产已不在当前场的正式拆解中，请刷新后重试。");

  const sourceIds = new Set([sourceAssetId]);
  const breakdown: ScriptBreakdown = {
    ...scene.breakdown,
    characterIds: assetType === "character"
      ? uniqueReplacedIds(scene.breakdown.characterIds, sourceIds, targetAssetId)
      : scene.breakdown.characterIds,
    locationId: assetType === "location" ? targetAssetId : scene.breakdown.locationId,
    propIds: assetType === "prop"
      ? uniqueReplacedIds(scene.breakdown.propIds, sourceIds, targetAssetId)
      : scene.breakdown.propIds,
    vehicleIds: assetType === "vehicles"
      ? uniqueReplacedIds(scene.breakdown.vehicleIds, sourceIds, targetAssetId)
      : scene.breakdown.vehicleIds,
    assetVariantMap: transferVariantBinding({ project, breakdown: scene.breakdown, sourceIds, targetAssetId }),
  };

  const existingBindings = scene.productionPreparation?.assetBindings || [];
  const existingBinding = manualBindingForCurrentAsset(existingBindings, assetType, sourceAssetId);
  const nextBinding: ProductionPreparationAssetBinding = {
    assetType,
    sourceAssetId: existingBinding?.sourceAssetId || sourceAssetId,
    sourceAssetName: existingBinding?.sourceAssetName || source.name,
    targetAssetId,
    targetAssetName: target.name,
    boundAt: now,
  };
  const assetBindings = existingBinding
    ? existingBindings.map((binding) => binding === existingBinding ? nextBinding : binding)
    : [...existingBindings, nextBinding];

  return {
    breakdown,
    shots: (scene.shots || []).map((shot) => ({
      ...shot,
      characterIdsInShot: assetType === "character"
        ? uniqueReplacedIds(shot.characterIdsInShot, sourceIds, targetAssetId)
        : shot.characterIdsInShot,
      locationId: assetType === "location" && shot.locationId === sourceAssetId ? targetAssetId : shot.locationId,
      propIds: assetType === "prop"
        ? uniqueReplacedIds(shot.propIds, sourceIds, targetAssetId)
        : shot.propIds,
      vehicleIds: assetType === "vehicles"
        ? uniqueReplacedIds(shot.vehicleIds, sourceIds, targetAssetId)
        : shot.vehicleIds,
      dialogueLines: assetType === "character"
        ? shot.dialogueLines?.map((line) => ({ ...line, characterId: line.characterId === sourceAssetId ? targetAssetId : line.characterId }))
        : shot.dialogueLines,
    })),
    ...(assetType === "vehicles" && scene.manualStoryboard ? { manualStoryboard: {
      ...scene.manualStoryboard,
      boards: scene.manualStoryboard.boards?.map((workflow) => workflow.board ? {
        ...workflow,
        board: {
          ...workflow.board,
          panels: workflow.board.panels.map((panel) => ({
            ...panel,
            assetRefs: uniqueReplacedIds(panel.assetRefs, sourceIds, targetAssetId),
          })),
        },
      } : workflow),
    } } : {}),
    scriptBlocks: scene.scriptBlocks?.map((block) => ({
      ...block,
      linkedAssetId: block.linkedAssetId === sourceAssetId ? targetAssetId : block.linkedAssetId,
      locationId: assetType === "location" && block.locationId === sourceAssetId ? targetAssetId : block.locationId,
      propIds: assetType === "prop" ? uniqueReplacedIds(block.propIds, sourceIds, targetAssetId) : block.propIds,
    })),
    audioTracks: scene.audioTracks?.map((track) => ({
      ...track,
      characterId: assetType === "character" && track.characterId === sourceAssetId ? targetAssetId : track.characterId,
      linkedAssetId: track.linkedAssetId === sourceAssetId ? targetAssetId : track.linkedAssetId,
    })),
    productionPreparation: {
      ...(scene.productionPreparation || { schemaVersion: "production-preparation.v1", sceneId: scene.id }),
      assetBindings,
      updatedAt: now,
    },
  };
};

export const applyProductionSceneManualAssetBindingsToBreakdown = ({
  project,
  scene,
  breakdown,
}: {
  project: Project;
  scene: Scene;
  breakdown: ScriptBreakdown;
}): ScriptBreakdown => {
  let next = {
    ...breakdown,
    vehicleIds: Array.from(new Set([...(breakdown.vehicleIds || []), ...(scene.breakdown?.vehicleIds || [])]))
      .filter((id) => project.assets.some((asset) => asset.id === id && asset.type === "vehicles")),
    assetVariantMap: { ...(breakdown.assetVariantMap || {}) },
  };
  for (const binding of scene.productionPreparation?.assetBindings || []) {
    const target = projectAssetIdentity(project, binding.targetAssetId);
    if (!target || target.type !== binding.assetType) continue;
    const sourceNameKey = normalizedAssetName(binding.sourceAssetName);
    const boundIds = binding.assetType === "character"
      ? next.characterIds || []
      : binding.assetType === "location"
        ? next.locationId ? [next.locationId] : []
        : binding.assetType === "vehicles" ? next.vehicleIds || [] : next.propIds || [];
    const sourceIds = new Set(boundIds.filter((id) => id === binding.sourceAssetId
      || normalizedAssetName(projectAssetIdentity(project, id)?.name || "") === sourceNameKey));
    const textDeclaresSource = binding.assetType === "character"
      ? next.characters.some((item) => normalizedAssetName(namedBreakdownValue(item)) === sourceNameKey)
      : binding.assetType === "location"
        ? normalizedAssetName(namedBreakdownValue(next.location)) === sourceNameKey
        : binding.assetType === "vehicles"
          ? (next.vehicles || []).some((name) => normalizedAssetName(name) === sourceNameKey)
          : next.props.some((item) => normalizedAssetName(namedBreakdownValue(item)) === sourceNameKey);
    if (!sourceIds.size && !textDeclaresSource) continue;

    const assetVariantMap = transferVariantBinding({ project, breakdown: next, sourceIds, targetAssetId: target.id });
    next = {
      ...next,
      characterIds: binding.assetType === "character"
        ? Array.from(new Set([...uniqueReplacedIds(next.characterIds, sourceIds, target.id), ...(textDeclaresSource ? [target.id] : [])]))
        : next.characterIds,
      locationId: binding.assetType === "location" ? target.id : next.locationId,
      propIds: binding.assetType === "prop"
        ? Array.from(new Set([...uniqueReplacedIds(next.propIds, sourceIds, target.id), ...(textDeclaresSource ? [target.id] : [])]))
        : next.propIds,
      vehicleIds: binding.assetType === "vehicles"
        ? Array.from(new Set([...uniqueReplacedIds(next.vehicleIds, sourceIds, target.id), ...(textDeclaresSource ? [target.id] : [])]))
        : next.vehicleIds,
      assetVariantMap,
    };
  }
  return next;
};
