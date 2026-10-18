import type {
  Project,
  ScriptBreakdown,
} from "../../../../../src/types/project";
import {
  canonicalAssetId,
  normalizeBreakdownAssetIds,
} from "../../../../../src/utils/assetRefs";
import { compactJson } from "./promptUtils";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

export const resolveBreakdownAssetIds = (
  project: Project,
  breakdown: ScriptBreakdown | undefined,
): ScriptBreakdown | undefined => normalizeBreakdownAssetIds(project, breakdown);

export const sceneAssetReferenceContext = (project: Project, sceneOrNode: { breakdown?: ScriptBreakdown }) => {
  const breakdown = resolveBreakdownAssetIds(project, sceneOrNode.breakdown);
  const characterIds = unique(breakdown?.characterIds || []);
  const propIds = unique(breakdown?.propIds || []);
  const locationId = breakdown?.locationId;
  const characters = characterIds
    .map((id) => project.characters?.find((character) => character.id === id))
    .filter(Boolean)
    .map((character) => ({ id: character!.id, name: character!.name }));
  const location = locationId
    ? project.assets?.find((asset) => asset.id === locationId && asset.type === "location")
    : undefined;
  const props = propIds
    .map((id) => project.assets?.find((asset) => asset.id === id && asset.type === "prop"))
    .filter(Boolean)
    .map((asset) => ({ id: asset!.id, name: asset!.name }));
  return {
    characterIds,
    locationId,
    propIds,
    promptContext: compactJson({
      characters,
      location: location ? { id: location.id, name: location.name } : undefined,
      props,
      allowedCharacterIds: characterIds,
      allowedLocationId: locationId,
      allowedPropIds: propIds,
    }),
  };
};

export const sanitizeShotAssetRefs = (
  project: Project,
  shot: any,
  assetRefs: ReturnType<typeof sceneAssetReferenceContext>,
) => {
  const characterIdsInShot = unique(Array.isArray(shot.characterIdsInShot) ? shot.characterIdsInShot : [])
    .map((id) => canonicalAssetId(project, "character", id))
    .filter((id) => assetRefs.characterIds.includes(id));
  const propIds = unique(Array.isArray(shot.propIds) ? shot.propIds : [])
    .map((id) => canonicalAssetId(project, "prop", id))
    .filter((id) => assetRefs.propIds.includes(id));
  const shotLocationId = canonicalAssetId(project, "location", shot.locationId);
  const locationId = assetRefs.locationId && shotLocationId === assetRefs.locationId
    ? shotLocationId
    : assetRefs.locationId;
  return {
    characterIdsInShot: characterIdsInShot.length > 0 ? characterIdsInShot : assetRefs.characterIds,
    locationId,
    propIds: propIds.length > 0 ? propIds : assetRefs.propIds,
  };
};

export const projectAssetCatalogContext = (
  project: Project,
  scope?: { sourceText?: string; breakdown?: ScriptBreakdown },
) => {
  const sourceText = String(scope?.sourceText || "");
  const breakdown = resolveBreakdownAssetIds(project, scope?.breakdown);
  const requestedCharacterIds = new Set(breakdown?.characterIds || []);
  const requestedAssetIds = new Set([breakdown?.locationId, ...(breakdown?.propIds || [])].filter(Boolean));
  const inScope = (id: string, name: string, requestedIds: Set<string>) =>
    !scope || requestedIds.has(id) || Boolean(name && sourceText.includes(name));
  const characters = (project.characters || [])
    .filter((character) => inScope(character.id, character.name, requestedCharacterIds))
    .map((character) => ({ id: character.id, name: character.name }));
  const locations = (project.assets || [])
    .filter((asset) => asset.type === "location" && inScope(asset.id, asset.name, requestedAssetIds))
    .map((asset) => ({ id: asset.id, name: asset.name }));
  const props = (project.assets || [])
    .filter((asset) => asset.type === "prop" && inScope(asset.id, asset.name, requestedAssetIds))
    .map((asset) => ({ id: asset.id, name: asset.name }));
  return compactJson({
    characters,
    characterMirrorAliases: characters.map((character) => ({ canonicalId: character.id, mirrorAssetId: `char-${character.id}` })),
    locations,
    props,
  });
};
