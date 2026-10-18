import { Asset, AssetRef, Character, Episode, Project, ScriptBreakdown } from "../types/project";
import { collectProjectAssetsForContext } from "./projectAssetContext";

type StructuredAssetReferenceType = Extract<Asset["type"], "character" | "location" | "prop">;
export type AssetReferenceAuditType = StructuredAssetReferenceType | "unknown";
export type AssetReferenceAuditStatus = "resolved" | "noncanonical" | "legacy_name" | "missing" | "wrong_type";
export type AssetReferenceRepairAction = "replace_with_canonical_id" | "needs_author_decision";

export interface AssetReferenceAuditItem {
  path: string;
  expectedType: AssetReferenceAuditType;
  rawValue: string;
  status: AssetReferenceAuditStatus;
  resolvedType?: StructuredAssetReferenceType;
  canonicalId?: string;
  displayName?: string;
  source?: AssetRef["source"];
  message: string;
}

export interface AssetReferenceRepairPlanItem {
  path: string;
  expectedType: AssetReferenceAuditType;
  rawValue: string;
  action: AssetReferenceRepairAction;
  replacementValue?: string;
  reason: string;
}

export const normalizeAssetRefName = (value?: string) =>
  (value || "").trim().toLowerCase().replace(/\s+/g, "");

const longestCommonSubstringLength = (left: string, right: string) => {
  let best = 0;
  for (let i = 0; i < left.length; i += 1) {
    for (let j = 0; j < right.length; j += 1) {
      let length = 0;
      while (left[i + length] && left[i + length] === right[j + length]) {
        length += 1;
      }
      if (length > best) best = length;
    }
  }
  return best;
};

export const isLikelySameAssetName = (left?: string, right?: string) => {
  const normalizedLeft = normalizeAssetRefName(left);
  const normalizedRight = normalizeAssetRefName(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return Math.min(normalizedLeft.length, normalizedRight.length) >= 2;
  }
  const commonLength = longestCommonSubstringLength(normalizedLeft, normalizedRight);
  return commonLength >= 2 && commonLength / Math.min(normalizedLeft.length, normalizedRight.length) >= 0.5;
};

const namedValue = (value: string | { name?: string; state?: string } | undefined) =>
  typeof value === "string" ? value : value?.name || "";

const unique = <T,>(items: T[]) => Array.from(new Set(items.filter(Boolean)));
const referenceTypes: StructuredAssetReferenceType[] = ["character", "location", "prop"];
type AssetRefProject = Pick<Project, "characters" | "assets"> & Partial<Pick<Project, "plannedCharacters" | "plannedLocations" | "plannedProps">>;
const plannedId = (prefix: string, id: string | undefined, name: string) =>
  id || `${prefix}-${normalizeAssetRefName(name).replace(/[^\w\u3400-\u9fff-]/g, "").slice(0, 48) || "unnamed"}`;

const makeCharacterRef = (
  character: Character,
  rawId?: string,
  mirroredAssetId?: string,
): AssetRef => ({
  type: "character",
  id: character.id,
  canonicalId: character.id,
  source: rawId && rawId !== character.id ? "character_mirror_asset" : "character",
  displayName: character.name,
  rawId,
  mirroredAssetId,
});

const makeAssetRef = (
  asset: Asset,
  rawId?: string,
  source: AssetRef["source"] = "asset",
): AssetRef => ({
  type: asset.type,
  id: asset.id,
  canonicalId: asset.id,
  source,
  displayName: asset.name,
  rawId,
});

export const buildAssetRefIndex = (project: AssetRefProject) => {
  const byId = new Map<string, AssetRef>();
  const byTypeAndName = new Map<string, AssetRef>();
  const addName = (ref: AssetRef) => {
    const key = `${ref.type}:${normalizeAssetRefName(ref.displayName)}`;
    if (!byTypeAndName.has(key)) byTypeAndName.set(key, ref);
  };

  (project.characters || []).forEach((character) => {
    const mirroredAssetId = `char-${character.id}`;
    const ref = makeCharacterRef(character, character.id, mirroredAssetId);
    byId.set(character.id, ref);
    byId.set(mirroredAssetId, makeCharacterRef(character, mirroredAssetId, mirroredAssetId));
    addName(ref);
  });

  (project.plannedCharacters || []).forEach((character) => {
    const hasDetailedCharacter = (project.characters || []).some((item) =>
      normalizeAssetRefName(item.name) === normalizeAssetRefName(character.name)
    );
    if (hasDetailedCharacter) return;
    const id = plannedId("planned-character", character.id, character.name);
    const ref: AssetRef = {
      type: "character",
      id,
      canonicalId: id,
      source: "asset",
      displayName: character.name,
      rawId: character.id || character.name,
    };
    byId.set(id, ref);
    addName(ref);
  });

  collectProjectAssetsForContext(project as Project).forEach((asset) => {
    if (asset.type === "character") {
      const mirroredCharacter = (project.characters || []).find(
        (character) => asset.id === `char-${character.id}` || normalizeAssetRefName(asset.name) === normalizeAssetRefName(character.name),
      );
      if (mirroredCharacter) {
        const ref = makeCharacterRef(mirroredCharacter, asset.id, asset.id);
        byId.set(asset.id, ref);
        addName(ref);
        return;
      }
    }
    const ref = makeAssetRef(asset, asset.id);
    byId.set(asset.id, ref);
    addName(ref);
  });

  return { byId, byTypeAndName };
};

export const resolveAssetRef = (
  project: AssetRefProject | undefined,
  type: Asset["type"],
  idOrName?: string,
): AssetRef | undefined => {
  if (!project || !idOrName) return undefined;
  const index = buildAssetRefIndex(project);
  const byId = index.byId.get(idOrName);
  if (byId && byId.type === type) return byId;
  if (type === "character" && idOrName.startsWith("char-")) {
    const stripped = idOrName.replace(/^char-/, "");
    const strippedRef = index.byId.get(stripped);
    if (strippedRef?.type === "character") return strippedRef;
  }
  const byName = index.byTypeAndName.get(`${type}:${normalizeAssetRefName(idOrName)}`);
  return byName?.type === type ? { ...byName, source: "legacy_name", rawId: idOrName } : undefined;
};

export const validateAssetRef = (
  project: AssetRefProject | undefined,
  type: Asset["type"],
  idOrName?: string,
) => Boolean(resolveAssetRef(project, type, idOrName));

export const canonicalAssetId = (
  project: AssetRefProject | undefined,
  type: Asset["type"],
  idOrName?: string,
) => resolveAssetRef(project, type, idOrName)?.canonicalId || "";

export const normalizeBreakdownAssetIds = (
  project: AssetRefProject,
  breakdown: ScriptBreakdown | undefined,
): ScriptBreakdown | undefined => {
  if (!breakdown) return breakdown;
  const characterIds = unique([
    ...(breakdown.characterIds || []),
    ...(breakdown.characters || []).map(namedValue),
  ].map((value) => canonicalAssetId(project, "character", value)));
  const locationId = canonicalAssetId(project, "location", breakdown.locationId)
    || canonicalAssetId(project, "location", namedValue(breakdown.location))
    || breakdown.locationId;
  const propIds = unique([
    ...(breakdown.propIds || []),
    ...(breakdown.props || []).map(namedValue),
  ].map((value) => canonicalAssetId(project, "prop", value)));

  return {
    ...breakdown,
    characterIds,
    locationId,
    propIds,
  };
};

const rawReferenceValue = (value: unknown) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const resolveAnyStructuredAssetRef = (
  project: Pick<Project, "characters" | "assets"> | undefined,
  idOrName?: string,
) => {
  for (const type of referenceTypes) {
    const resolved = resolveAssetRef(project, type, idOrName);
    if (resolved) return resolved as AssetRef & { type: StructuredAssetReferenceType };
  }
  return undefined;
};

const auditStatusFor = (resolved: AssetRef, rawValue: string): AssetReferenceAuditStatus => {
  if (resolved.source === "legacy_name") return "legacy_name";
  return resolved.canonicalId === rawValue ? "resolved" : "noncanonical";
};

const auditMessageFor = (
  expectedType: AssetReferenceAuditType,
  rawValue: string,
  status: AssetReferenceAuditStatus,
  resolved?: AssetRef,
) => {
  if (status === "resolved") return `${rawValue} 已解析为 ${resolved?.canonicalId || rawValue}。`;
  if (status === "legacy_name") return `${rawValue} 是名称引用，应迁移为稳定 ID ${resolved?.canonicalId || ""}。`;
  if (status === "noncanonical") return `${rawValue} 是兼容/镜像引用，应迁移为 canonical ID ${resolved?.canonicalId || ""}。`;
  if (status === "wrong_type") return `${rawValue} 能解析为 ${resolved?.type}，但当前位置期望 ${expectedType}。`;
  return `${rawValue} 无法在角色/地点/道具资产库中解析。`;
};

const createAuditItem = (
  project: Pick<Project, "characters" | "assets"> | undefined,
  path: string,
  expectedType: AssetReferenceAuditType,
  value: unknown,
): AssetReferenceAuditItem | undefined => {
  const rawValue = rawReferenceValue(value);
  if (!rawValue) return undefined;
  const resolved = expectedType === "unknown"
    ? resolveAnyStructuredAssetRef(project, rawValue)
    : resolveAssetRef(project, expectedType, rawValue);
  if (resolved) {
    const status = auditStatusFor(resolved, rawValue);
    return {
      path,
      expectedType,
      rawValue,
      status,
      resolvedType: resolved.type as StructuredAssetReferenceType,
      canonicalId: resolved.canonicalId,
      displayName: resolved.displayName,
      source: resolved.source,
      message: auditMessageFor(expectedType, rawValue, status, resolved),
    };
  }

  const wrongTypeRef = expectedType === "unknown" ? undefined : resolveAnyStructuredAssetRef(project, rawValue);
  if (wrongTypeRef) {
    return {
      path,
      expectedType,
      rawValue,
      status: "wrong_type",
      resolvedType: wrongTypeRef.type,
      canonicalId: wrongTypeRef.canonicalId,
      displayName: wrongTypeRef.displayName,
      source: wrongTypeRef.source,
      message: auditMessageFor(expectedType, rawValue, "wrong_type", wrongTypeRef),
    };
  }

  return {
    path,
    expectedType,
    rawValue,
    status: "missing",
    message: auditMessageFor(expectedType, rawValue, "missing"),
  };
};

const pushAuditItem = (
  items: AssetReferenceAuditItem[],
  project: Pick<Project, "characters" | "assets"> | undefined,
  path: string,
  expectedType: AssetReferenceAuditType,
  value: unknown,
) => {
  const item = createAuditItem(project, path, expectedType, value);
  if (item) items.push(item);
};

const scanBreakdownReferences = (
  items: AssetReferenceAuditItem[],
  project: Pick<Project, "characters" | "assets"> | undefined,
  basePath: string,
  breakdown?: ScriptBreakdown,
) => {
  if (!breakdown) return;
  (breakdown.characterIds || []).forEach((id, index) =>
    pushAuditItem(items, project, `${basePath}.breakdown.characterIds[${index}]`, "character", id));
  pushAuditItem(items, project, `${basePath}.breakdown.locationId`, "location", breakdown.locationId);
  (breakdown.propIds || []).forEach((id, index) =>
    pushAuditItem(items, project, `${basePath}.breakdown.propIds[${index}]`, "prop", id));
  Object.keys(breakdown.assetVariantMap || {}).forEach((id) =>
    pushAuditItem(items, project, `${basePath}.breakdown.assetVariantMap.${id}`, "unknown", id));
};

const scanScriptBlockReferences = (
  items: AssetReferenceAuditItem[],
  project: Pick<Project, "characters" | "assets"> | undefined,
  basePath: string,
  scriptBlocks?: Array<{ linkedAssetId?: string; locationId?: string; propIds?: string[] }>,
) => {
  (scriptBlocks || []).forEach((block, index) => {
    const blockPath = `${basePath}.scriptBlocks[${index}]`;
    pushAuditItem(items, project, `${blockPath}.linkedAssetId`, "unknown", block.linkedAssetId);
    pushAuditItem(items, project, `${blockPath}.locationId`, "location", block.locationId);
    (block.propIds || []).forEach((id, propIndex) =>
      pushAuditItem(items, project, `${blockPath}.propIds[${propIndex}]`, "prop", id));
  });
};

const scanShotReferences = (
  items: AssetReferenceAuditItem[],
  project: Pick<Project, "characters" | "assets"> | undefined,
  basePath: string,
  shots?: Array<{ characterIdsInShot?: string[]; locationId?: string; propIds?: string[]; assetOverrides?: Record<string, string> }>,
) => {
  (shots || []).forEach((shot, index) => {
    const shotPath = `${basePath}.shots[${index}]`;
    (shot.characterIdsInShot || []).forEach((id, characterIndex) =>
      pushAuditItem(items, project, `${shotPath}.characterIdsInShot[${characterIndex}]`, "character", id));
    pushAuditItem(items, project, `${shotPath}.locationId`, "location", shot.locationId);
    (shot.propIds || []).forEach((id, propIndex) =>
      pushAuditItem(items, project, `${shotPath}.propIds[${propIndex}]`, "prop", id));
    Object.keys(shot.assetOverrides || {}).forEach((id) =>
      pushAuditItem(items, project, `${shotPath}.assetOverrides.${id}`, "unknown", id));
  });
};

const scanSceneLikeReferences = (
  items: AssetReferenceAuditItem[],
  project: Pick<Project, "characters" | "assets"> | undefined,
  basePath: string,
  sceneLike: {
    breakdown?: ScriptBreakdown;
    scriptBlocks?: Array<{ linkedAssetId?: string; locationId?: string; propIds?: string[] }>;
    shots?: Array<{ characterIdsInShot?: string[]; locationId?: string; propIds?: string[]; assetOverrides?: Record<string, string> }>;
  },
) => {
  scanBreakdownReferences(items, project, basePath, sceneLike.breakdown);
  scanScriptBlockReferences(items, project, basePath, sceneLike.scriptBlocks);
  scanShotReferences(items, project, basePath, sceneLike.shots);
};

export const collectAssetReferenceAudit = (
  project: (Pick<Project, "characters" | "assets"> & { scenes?: any[]; episodes?: any[]; gameData?: { nodes?: any[] } }) | undefined,
): AssetReferenceAuditItem[] => {
  if (!project) return [];
  const items: AssetReferenceAuditItem[] = [];
  (project.scenes || []).forEach((scene, sceneIndex) =>
    scanSceneLikeReferences(items, project, `project.scenes[${sceneIndex}]`, scene));
  (project.episodes || []).forEach((episode, episodeIndex) => {
    (episode.scenes || []).forEach((scene: any, sceneIndex: number) =>
      scanSceneLikeReferences(items, project, `project.episodes[${episodeIndex}].scenes[${sceneIndex}]`, scene));
    (episode.gameData?.nodes || []).forEach((node: any, nodeIndex: number) =>
      scanSceneLikeReferences(items, project, `project.episodes[${episodeIndex}].gameData.nodes[${nodeIndex}]`, node));
  });
  (project.gameData?.nodes || []).forEach((node, nodeIndex) =>
    scanSceneLikeReferences(items, project, `project.gameData.nodes[${nodeIndex}]`, node));
  return items;
};

export const buildAssetReferenceRepairPlan = (
  project: Parameters<typeof collectAssetReferenceAudit>[0],
): AssetReferenceRepairPlanItem[] =>
  collectAssetReferenceAudit(project)
    .filter((item) => item.status !== "resolved")
    .map((item) => {
      if ((item.status === "legacy_name" || item.status === "noncanonical") && item.canonicalId) {
        return {
          path: item.path,
          expectedType: item.expectedType,
          rawValue: item.rawValue,
          action: "replace_with_canonical_id",
          replacementValue: item.canonicalId,
          reason: item.message,
        };
      }
      return {
        path: item.path,
        expectedType: item.expectedType,
        rawValue: item.rawValue,
        action: "needs_author_decision",
        replacementValue: item.canonicalId,
        reason: item.message,
      };
    });

export interface AssetOrphanResult {
  missingRefs: AssetReferenceAuditItem[];
  renamedSuggestions: { path: string; oldName: string; newName: string; canonicalId: string }[];
  freeTextOrphans: { path: string; name: string; type: string; context: string }[];
}

export interface FreeTextReferenceHit {
  path: string;
  name: string;
  type: string;
  context: string;
}

export interface StaleMediaHit {
  path: string;
  shotIndex: number;
  shotId?: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  assetId: string;
  reason: string;
}

export interface AssetLifecycleImpactReport {
  eventType: "deleted" | "renamed" | "reference_changed";
  assetType: "character" | "location" | "prop";
  assetId: string;
  oldName?: string;
  newName?: string;
  oldReferenceUrl?: string;
  newReferenceUrl?: string;
  structuredRefs: AssetReferenceAuditItem[];
  freeTextRefs: FreeTextReferenceHit[];
  staleMediaRefs: StaleMediaHit[];
  repairPlan: AssetReferenceRepairPlanItem[];
}

export const escapeRegExp = (str: string) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

export const scanProjectAssetOrphans = (
  project: Project,
  episode?: Episode | null,
  deletedAssets?: { id: string; name: string; type: string }[],
): AssetOrphanResult => {
  const missingRefs: AssetReferenceAuditItem[] = [];
  const renamedSuggestions: { path: string; oldName: string; newName: string; canonicalId: string }[] = [];
  const freeTextOrphans: { path: string; name: string; type: string; context: string }[] = [];

  const episodesToAudit = project.episodes || [];
  const updatedEpisodes = [...episodesToAudit];
  if (episode) {
    const existingIndex = updatedEpisodes.findIndex(ep => ep.id === episode.id);
    if (existingIndex !== -1) {
      updatedEpisodes[existingIndex] = episode;
    } else {
      updatedEpisodes.push(episode);
    }
  }

  const projectToAudit = {
    ...project,
    episodes: updatedEpisodes,
  };

  const auditItems = collectAssetReferenceAudit(projectToAudit);

  auditItems.forEach((item) => {
    if (item.status === "missing") {
      missingRefs.push(item);
    } else if (item.status === "legacy_name" || item.status === "noncanonical") {
      if (item.canonicalId && item.displayName && item.rawValue !== item.displayName) {
        if (item.rawValue.toLowerCase() !== item.displayName.toLowerCase()) {
          renamedSuggestions.push({
            path: item.path,
            oldName: item.rawValue,
            newName: item.displayName,
            canonicalId: item.canonicalId,
          });
        }
      }
    }
  });

  const searchTargets: { name: string; type: string; replacement?: string; canonicalId?: string }[] = [];
  if (deletedAssets) {
    deletedAssets.forEach((d) => {
      if (d.name) {
        searchTargets.push({ name: d.name, type: d.type });
      }
    });
  }

  renamedSuggestions.forEach((s) => {
    if (!searchTargets.some((t) => t.name === s.oldName)) {
      searchTargets.push({ name: s.oldName, type: "character", replacement: s.newName, canonicalId: s.canonicalId });
    }
  });

  if (searchTargets.length > 0) {
    const isInteractive = project.projectModel === "interactive";

    updatedEpisodes.forEach((ep: any, epIndex: number) => {
      const scenesToScan = isInteractive && ep.gameData?.nodes
        ? ep.gameData.nodes
        : ep.scenes || [];

      scenesToScan.forEach((scene: any, sceneIndex: number) => {
        const basePath = isInteractive
          ? `project.episodes[${epIndex}].gameData.nodes[${sceneIndex}]`
          : `project.episodes[${epIndex}].scenes[${sceneIndex}]`;

        searchTargets.forEach((target) => {
          const escapedName = escapeRegExp(target.name);
          const hasCJK = /[\u4e00-\u9fa5]/.test(target.name);
          const regex = hasCJK
            ? new RegExp(escapedName, "gi")
            : new RegExp(`\\b${escapedName}\\b`, "gi");

          if (scene.script && regex.test(scene.script)) {
            freeTextOrphans.push({
              path: `${basePath}.script`,
              name: target.name,
              type: target.type,
              context: `Script: ...${scene.script.substring(Math.max(0, scene.script.search(regex) - 20), Math.min(scene.script.length, scene.script.search(regex) + 40))}...`,
            });
          }

          if (scene.description && regex.test(scene.description)) {
            freeTextOrphans.push({
              path: `${basePath}.description`,
              name: target.name,
              type: target.type,
              context: `Description: ...${scene.description.substring(Math.max(0, scene.description.search(regex) - 20), Math.min(scene.description.length, scene.description.search(regex) + 40))}...`,
            });
          }

          (scene.scriptBlocks || []).forEach((block: any, blockIndex: number) => {
            if (block.content && regex.test(block.content)) {
              freeTextOrphans.push({
                path: `${basePath}.scriptBlocks[${blockIndex}].content`,
                name: target.name,
                type: target.type,
                context: `ScriptBlock[${block.type}]: ...${block.content.substring(Math.max(0, block.content.search(regex) - 20), Math.min(block.content.length, block.content.search(regex) + 40))}...`,
              });
            }
          });

          (scene.shots || []).forEach((shot: any, shotIndex: number) => {
            const shotPath = `${basePath}.shots[${shotIndex}]`;
            if (shot.visualAction && regex.test(shot.visualAction)) {
              freeTextOrphans.push({
                path: `${shotPath}.visualAction`,
                name: target.name,
                type: target.type,
                context: `VisualAction: ...${shot.visualAction.substring(Math.max(0, shot.visualAction.search(regex) - 20), Math.min(shot.visualAction.length, shot.visualAction.search(regex) + 40))}...`,
              });
            }
            if (shot.imagePrompt && regex.test(shot.imagePrompt)) {
              freeTextOrphans.push({
                path: `${shotPath}.imagePrompt`,
                name: target.name,
                type: target.type,
                context: `ImagePrompt: ...${shot.imagePrompt.substring(Math.max(0, shot.imagePrompt.search(regex) - 20), Math.min(shot.imagePrompt.length, shot.imagePrompt.search(regex) + 40))}...`,
              });
            }
            if (shot.videoPrompt && regex.test(shot.videoPrompt)) {
              freeTextOrphans.push({
                path: `${shotPath}.videoPrompt`,
                name: target.name,
                type: target.type,
                context: `VideoPrompt: ...${shot.videoPrompt.substring(Math.max(0, shot.videoPrompt.search(regex) - 20), Math.min(shot.videoPrompt.length, shot.videoPrompt.search(regex) + 40))}...`,
              });
            }
            if (shot.assetOverrides) {
              Object.entries(shot.assetOverrides).forEach(([key, val]) => {
                if (typeof val === "string" && regex.test(val)) {
                  freeTextOrphans.push({
                    path: `${shotPath}.assetOverrides.${key}`,
                    name: target.name,
                    type: target.type,
                    context: `AssetOverrides[${key}]: ...${val.substring(Math.max(0, val.search(regex) - 20), Math.min(val.length, val.search(regex) + 40))}...`,
                  });
                }
              });
            }
          });
        });
      });
    });
  }

  return { missingRefs, renamedSuggestions, freeTextOrphans };
};

interface UnifiedEntity {
  id: string;
  name: string;
  type: "character" | "location" | "prop";
  imageUrl?: string;
  defaultReferenceUrl?: string;
  defaultVariantId?: string;
}

const getUnifiedEntities = (project: Project): UnifiedEntity[] => {
  const chars = (project.characters || []).map((c) => ({
    id: c.id,
    name: c.name,
    type: "character" as const,
    imageUrl: c.referenceImageUrl,
    defaultReferenceUrl: c.defaultReferenceUrl,
    defaultVariantId: c.defaultVariantId,
  }));
  const assets = (project.assets || [])
    .filter((a) => a.type === "location" || a.type === "prop")
    .map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type as "location" | "prop",
      imageUrl: a.imageUrl,
      defaultReferenceUrl: a.defaultReferenceUrl,
      defaultVariantId: a.defaultVariantId,
    }));
  return [...chars, ...assets];
};

const generateReportForEvent = (
  eventType: "deleted" | "renamed" | "reference_changed",
  oldEnt: UnifiedEntity,
  newEnt: UnifiedEntity | undefined,
  oldProject: Project,
  newProject: Project,
  episodes: Episode[]
): AssetLifecycleImpactReport => {
  const entityId = oldEnt.id;
  const oldName = oldEnt.name;
  const newName = newEnt?.name;

  const auditProject = eventType === "deleted" ? oldProject : newProject;

  const projectToAudit = {
    ...auditProject,
    episodes,
  };
  const structuredRefs = collectAssetReferenceAudit(projectToAudit).filter(
    (item) => item.canonicalId === entityId || item.rawValue === entityId || item.rawValue === `char-${entityId}`
  );

  const freeTextRefs: FreeTextReferenceHit[] = [];
  const nameToSearch = eventType === "renamed" ? oldName : eventType === "deleted" ? oldName : undefined;

  if (nameToSearch) {
    const escapedName = escapeRegExp(nameToSearch);
    const hasCJK = /[\u4e00-\u9fa5]/.test(nameToSearch);
    const regex = hasCJK
      ? new RegExp(escapedName, "gi")
      : new RegExp(`\\b${escapedName}\\b`, "gi");

    episodes.forEach((episode, epIndex) => {
      const isInteractive = auditProject.projectModel === "interactive";
      const scenesToScan = (isInteractive && episode.gameData?.nodes)
        ? episode.gameData.nodes
        : episode.scenes || [];

      scenesToScan.forEach((scene: any, sceneIndex: number) => {
        const basePath = isInteractive
          ? `project.episodes[${epIndex}].gameData.nodes[${sceneIndex}]`
          : `project.episodes[${epIndex}].scenes[${sceneIndex}]`;

        if (scene.script && regex.test(scene.script)) {
          freeTextRefs.push({
            path: `${basePath}.script`,
            name: nameToSearch,
            type: oldEnt.type,
            context: `Script: ...${scene.script.substring(Math.max(0, scene.script.search(regex) - 20), Math.min(scene.script.length, scene.script.search(regex) + 40))}...`,
          });
        }

        if (scene.description && regex.test(scene.description)) {
          freeTextRefs.push({
            path: `${basePath}.description`,
            name: nameToSearch,
            type: oldEnt.type,
            context: `Description: ...${scene.description.substring(Math.max(0, scene.description.search(regex) - 20), Math.min(scene.description.length, scene.description.search(regex) + 40))}...`,
          });
        }

        (scene.scriptBlocks || []).forEach((block: any, blockIndex: number) => {
          if (block.content && regex.test(block.content)) {
            freeTextRefs.push({
              path: `${basePath}.scriptBlocks[${blockIndex}].content`,
              name: nameToSearch,
              type: oldEnt.type,
              context: `ScriptBlock[${block.type}]: ...${block.content.substring(Math.max(0, block.content.search(regex) - 20), Math.min(block.content.length, block.content.search(regex) + 40))}...`,
            });
          }
        });

        (scene.shots || []).forEach((shot: any, shotIndex: number) => {
          const shotPath = `${basePath}.shots[${shotIndex}]`;
          if (shot.visualAction && regex.test(shot.visualAction)) {
            freeTextRefs.push({
              path: `${shotPath}.visualAction`,
              name: nameToSearch,
              type: oldEnt.type,
              context: `VisualAction: ...${shot.visualAction.substring(Math.max(0, shot.visualAction.search(regex) - 20), Math.min(shot.visualAction.length, shot.visualAction.search(regex) + 40))}...`,
            });
          }
          if (shot.imagePrompt && regex.test(shot.imagePrompt)) {
            freeTextRefs.push({
              path: `${shotPath}.imagePrompt`,
              name: nameToSearch,
              type: oldEnt.type,
              context: `ImagePrompt: ...${shot.imagePrompt.substring(Math.max(0, shot.imagePrompt.search(regex) - 20), Math.min(shot.imagePrompt.length, shot.imagePrompt.search(regex) + 40))}...`,
            });
          }
          if (shot.videoPrompt && regex.test(shot.videoPrompt)) {
            freeTextRefs.push({
              path: `${shotPath}.videoPrompt`,
              name: nameToSearch,
              type: oldEnt.type,
              context: `VideoPrompt: ...${shot.videoPrompt.substring(Math.max(0, shot.videoPrompt.search(regex) - 20), Math.min(shot.videoPrompt.length, shot.videoPrompt.search(regex) + 40))}...`,
            });
          }
          if (shot.assetOverrides) {
            Object.entries(shot.assetOverrides).forEach(([key, val]) => {
              if (typeof val === "string" && regex.test(val)) {
                freeTextRefs.push({
                  path: `${shotPath}.assetOverrides.${key}`,
                  name: nameToSearch,
                  type: oldEnt.type,
                  context: `AssetOverrides[${key}]: ...${val.substring(Math.max(0, val.search(regex) - 20), Math.min(val.length, val.search(regex) + 40))}...`,
                });
              }
            });
          }
        });
      });
    });
  }

  const staleMediaRefs: StaleMediaHit[] = [];
  episodes.forEach((episode, epIndex) => {
    const isInteractive = auditProject.projectModel === "interactive";
    const scenesToScan = (isInteractive && episode.gameData?.nodes)
      ? episode.gameData.nodes
      : episode.scenes || [];

    scenesToScan.forEach((scene: any, sceneIndex: number) => {
      const basePath = isInteractive
        ? `project.episodes[${epIndex}].gameData.nodes[${sceneIndex}]`
        : `project.episodes[${epIndex}].scenes[${sceneIndex}]`;

      (scene.shots || []).forEach((shot: any, shotIndex: number) => {
        const shotPath = `${basePath}.shots[${shotIndex}]`;
        const hasMedia = shot.imageUrl || shot.videoUrl || shot.imageMedia?.url || shot.videoMedia?.url;
        if (!hasMedia) return;

        const referencesAsset =
          (oldEnt.type === "character" && shot.characterIdsInShot?.some((id: string) => id === entityId || `char-${id}` === entityId || id === `char-${entityId}`)) ||
          (oldEnt.type === "location" && shot.locationId === entityId) ||
          (oldEnt.type === "prop" && shot.propIds?.some((id: string) => id === entityId)) ||
          shot.assetOverrides?.[entityId] !== undefined ||
          shot.assetOverrides?.[`char-${entityId}`] !== undefined;

        let referencesText = false;
        if (nameToSearch) {
          const escapedName = escapeRegExp(nameToSearch);
          const hasCJK = /[\u4e00-\u9fa5]/.test(nameToSearch);
          const regex = hasCJK
            ? new RegExp(escapedName, "i")
            : new RegExp(`\\b${escapedName}\\b`, "i");

          referencesText =
            (shot.imagePrompt && regex.test(shot.imagePrompt)) ||
            (shot.videoPrompt && regex.test(shot.videoPrompt)) ||
            (shot.visualAction && regex.test(shot.visualAction));
        }

        if (referencesAsset || referencesText) {
          if (shot.imageUrl || shot.imageMedia?.url) {
            staleMediaRefs.push({
              path: `${shotPath}.imageUrl`,
              shotIndex,
              shotId: shot.id,
              mediaType: "image",
              mediaUrl: shot.imageUrl || shot.imageMedia?.url || "",
              assetId: entityId,
              reason: `镜头所含资产「${oldName}」已${eventType === "deleted" ? "删除" : eventType === "renamed" ? "重命名" : "修改参考图"}`
            });
          }
          if (shot.videoUrl || shot.videoMedia?.url) {
            staleMediaRefs.push({
              path: `${shotPath}.videoUrl`,
              shotIndex,
              shotId: shot.id,
              mediaType: "video",
              mediaUrl: shot.videoUrl || shot.videoMedia?.url || "",
              assetId: entityId,
              reason: `镜头所含资产「${oldName}」已${eventType === "deleted" ? "删除" : eventType === "renamed" ? "重命名" : "修改参考图"}`
            });
          }
        }
      });
    });
  });

  const repairPlan: AssetReferenceRepairPlanItem[] = [];

  structuredRefs.forEach((item) => {
    if (eventType === "deleted") {
      repairPlan.push({
        path: item.path,
        expectedType: item.expectedType,
        rawValue: item.rawValue,
        action: "needs_author_decision",
        reason: `资产「${oldName}」已被删除，该引用应被清除或替换。`
      });
    } else if (eventType === "renamed") {
      repairPlan.push({
        path: item.path,
        expectedType: item.expectedType,
        rawValue: item.rawValue,
        action: "replace_with_canonical_id",
        replacementValue: entityId,
        reason: `资产「${oldName}」已重命名为「${newName}」，结构化引用建议写回 canonical ID。`
      });
    }
  });

  freeTextRefs.forEach((item) => {
    if (eventType === "renamed") {
      repairPlan.push({
        path: item.path,
        expectedType: item.type as AssetReferenceAuditType,
        rawValue: item.name,
        action: "needs_author_decision",
        replacementValue: newName,
        reason: `文本段落中检测到旧资产名称「${oldName}」，建议替换为新名称「${newName}」。`
      });
    } else if (eventType === "deleted") {
      repairPlan.push({
        path: item.path,
        expectedType: item.type as AssetReferenceAuditType,
        rawValue: item.name,
        action: "needs_author_decision",
        reason: `文本段落中检测到已被删除的资产名称「${oldName}」，建议人工重写或清除。`
      });
    }
  });

  return {
    eventType,
    assetType: oldEnt.type,
    assetId: entityId,
    oldName: eventType === "renamed" ? oldName : undefined,
    newName: eventType === "renamed" ? newName : undefined,
    oldReferenceUrl: eventType === "reference_changed" ? (oldEnt.imageUrl || oldEnt.defaultReferenceUrl) : undefined,
    newReferenceUrl: eventType === "reference_changed" ? (newEnt?.imageUrl || newEnt?.defaultReferenceUrl) : undefined,
    structuredRefs,
    freeTextRefs,
    staleMediaRefs,
    repairPlan
  };
};

export const auditAssetLifecycleImpact = (
  oldProject: Project,
  newProject: Project,
  episodes: Episode[]
): AssetLifecycleImpactReport[] => {
  const oldEntities = getUnifiedEntities(oldProject);
  const newEntities = getUnifiedEntities(newProject);

  const oldMap = new Map(oldEntities.map((e) => [e.id, e]));
  const newMap = new Map(newEntities.map((e) => [e.id, e]));

  const reports: AssetLifecycleImpactReport[] = [];

  for (const oldEnt of oldEntities) {
    if (!newMap.has(oldEnt.id)) {
      reports.push(
        generateReportForEvent(
          "deleted",
          oldEnt,
          undefined,
          oldProject,
          newProject,
          episodes
        )
      );
    }
  }

  for (const newEnt of newEntities) {
    const oldEnt = oldMap.get(newEnt.id);
    if (oldEnt) {
      const isRenamed = oldEnt.name !== newEnt.name;
      const isRefChanged =
        oldEnt.imageUrl !== newEnt.imageUrl ||
        oldEnt.defaultReferenceUrl !== newEnt.defaultReferenceUrl ||
        oldEnt.defaultVariantId !== newEnt.defaultVariantId;

      if (isRenamed) {
        reports.push(
          generateReportForEvent(
            "renamed",
            oldEnt,
            newEnt,
            oldProject,
            newProject,
            episodes
          )
        );
      }
      if (isRefChanged) {
        reports.push(
          generateReportForEvent(
            "reference_changed",
            oldEnt,
            newEnt,
            oldProject,
            newProject,
            episodes
          )
        );
      }
    }
  }

  return reports;
};

export const replaceFreeTextName = (text: string, oldName: string, newName: string): string => {
  const escapedName = escapeRegExp(oldName);
  const hasCJK = /[\u4e00-\u9fa5]/.test(oldName);
  const regex = hasCJK
    ? new RegExp(escapedName, "g")
    : new RegExp(`\\b${escapedName}\\b`, "g");
  return text.replace(regex, newName);
};
