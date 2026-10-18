import type { Asset, PlannedAsset, PlannedCharacter, Project } from "../types/project";

type ContextAssetType = "character" | "location" | "prop";

const normalizeAssetName = (name?: string) => (name || "").trim();
const plannedId = (prefix: string, id: string | undefined, name: string) =>
  id || `${prefix}-${normalizeAssetName(name).replace(/\s+/g, "-").replace(/[^\w\u3400-\u9fff-]/g, "").slice(0, 48) || "unnamed"}`;

const plannedAssetToAsset = (asset: PlannedAsset): Asset => ({
  id: plannedId(`planned-${asset.type}`, asset.id, asset.name),
  type: asset.type,
  name: asset.name,
  description: asset.brief ? `规划资产：${asset.brief}` : "",
});

const plannedCharacterToAsset = (character: PlannedCharacter): Asset => ({
  id: plannedId("planned-character", character.id, character.name),
  type: "character",
  name: character.name,
  description: character.brief ? `规划角色：${character.brief}` : "",
});

export const collectProjectAssetsForContext = (
  project: Project,
  type?: ContextAssetType,
): Asset[] => {
  const detailedAssets = (project.assets || []).filter((asset) =>
    type ? asset.type === type : asset.type === "location" || asset.type === "prop",
  ) as Asset[];
  const existingNames = new Set([
    ...detailedAssets.map((asset) => normalizeAssetName(asset.name)),
    ...(type === "character" ? (project.characters || []).map((character) => normalizeAssetName(character.name)) : []),
  ]);
  const plannedCharacters = type === "character"
    ? (project.plannedCharacters || [])
      .filter((character) => {
        const name = normalizeAssetName(character.name);
        if (!name || existingNames.has(name)) return false;
        existingNames.add(name);
        return true;
      })
      .map(plannedCharacterToAsset)
    : [];
  const plannedAssets = [
    ...(type === "prop" ? [] : project.plannedLocations || []),
    ...(type === "location" ? [] : project.plannedProps || []),
  ]
    .filter((asset) => (type ? asset.type === type : asset.type === "location" || asset.type === "prop"))
    .filter((asset) => {
      const name = normalizeAssetName(asset.name);
      if (!name || existingNames.has(name)) return false;
      existingNames.add(name);
      return true;
    })
    .map(plannedAssetToAsset);

  return [...detailedAssets, ...plannedCharacters, ...plannedAssets];
};
