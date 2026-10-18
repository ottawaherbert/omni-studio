import type { Asset, Character, Project } from "../../types/project";
import type { ProductionQAIssue } from "../../types/production";

export type AssetContinuityKind = "character" | "location" | "prop";
export type AssetContinuityProfile = "operator" | "storyboard" | "visual_prompt" | "visual_generation" | "default";

export interface AssetContinuityEntry {
  id: string;
  kind: AssetContinuityKind;
  name: string;
  firstEpisode?: number;
  lastEpisode?: number;
  episodeCount: number;
  referenceCount: number;
  variantCount: number;
  variantIds: string[];
  usedVariantIds: string[];
  missingVariantRefs: string[];
  hasBasePrompt: boolean;
  hasReference: boolean;
  needsVariantPlan: boolean;
}

export interface AssetContinuityContext {
  profile: AssetContinuityProfile;
  counts: {
    characters: number;
    locations: number;
    props: number;
    episodes: number;
    scenes: number;
    shots: number;
  };
  entries: AssetContinuityEntry[];
  duplicateKeys: string[];
  missingReferences: Array<{
    path: string;
    kind: AssetContinuityKind;
    id: string;
  }>;
  variantCoverage: {
    recurringAssetCount: number;
    assetsWithVariants: number;
    recurringWithoutVariants: AssetContinuityEntry[];
    missingVariantReferenceCount: number;
  };
  requiredBeforeVisualGeneration: string[];
  qaIssues: ProductionQAIssue[];
}

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const normalizeName = (value: unknown) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const episodeNumber = (episode: any, index: number) => {
  const order = Number(episode?.order);
  if (Number.isFinite(order)) return order + 1;
  const explicit = Number(episode?.episodeNumber || episode?.index);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const match = String(episode?.id || "").match(/(\d+)/);
  return match ? Number(match[1]) : index + 1;
};

const collectVariantIds = (asset: Character | Asset) =>
  asArray<any>((asset as any).variants)
    .map((variant) => String(variant?.id || variant?.name || "").trim())
    .filter(Boolean);

const hasPrompt = (asset: Character | Asset) =>
  Boolean(
    ("prompt" in asset && asset.prompt && asset.prompt.length >= 20)
    || asset.multiViewPrompt
    || ("panoramaPrompt" in asset && asset.panoramaPrompt)
    || (asset as any).description
    || (asset as any).brief,
  );

const hasReference = (asset: Character | Asset) =>
  Boolean(
    ("imageUrl" in asset && asset.imageUrl)
    || asset.defaultReferenceUrl
    || asset.multiViewUrl
    || ("panoramaUrl" in asset && asset.panoramaUrl)
    || ("referenceImageUrl" in asset && asset.referenceImageUrl),
  );

const createIssue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: `asset-continuity-${target.replace(/[^a-zA-Z0-9_.-]+/g, "-")}`,
  target,
  message,
  severity,
  suggestion,
  issueType: "asset_ref",
});

const createCatalog = (project: Project) => {
  const characters = asArray<Character>((project as any).characters);
  const assets = asArray<Asset>((project as any).assets);
  const catalog = new Map<string, {
    id: string;
    kind: AssetContinuityKind;
    name: string;
    variantIds: string[];
    source: Character | Asset;
  }>();

  for (const character of characters) {
    if (!character?.id) continue;
    catalog.set(character.id, {
      id: character.id,
      kind: "character",
      name: character.name,
      variantIds: collectVariantIds(character),
      source: character,
    });
  }

  for (const asset of assets) {
    if (!asset?.id || !["location", "prop"].includes(asset.type)) continue;
    catalog.set(asset.id, {
      id: asset.id,
      kind: asset.type as AssetContinuityKind,
      name: asset.name,
      variantIds: collectVariantIds(asset),
      source: asset,
    });
  }

  return { characters, assets, catalog };
};

const normalizeVariantAssetId = (rawId: string, catalog: Map<string, unknown>) => {
  const id = String(rawId || "").trim();
  if (catalog.has(id)) return id;
  const stripped = id.replace(/^(character|location|prop|asset)[_:.-]/i, "");
  return catalog.has(stripped) ? stripped : id;
};

const isRecurringEnoughForVariantPlan = (
  entry: AssetContinuityEntry,
  targetEpisodeCount: number,
) => {
  if (entry.episodeCount <= 0) return false;
  const span = (entry.lastEpisode || 0) - (entry.firstEpisode || 0) + 1;
  if (entry.kind === "character") {
    return entry.episodeCount >= 5 || span >= 20 || targetEpisodeCount >= 50 && entry.episodeCount >= 3;
  }
  if (entry.kind === "location") {
    return entry.episodeCount >= 6 || span >= 30;
  }
  return entry.episodeCount >= 6 || span >= 20;
};

export const buildAssetContinuityContext = (
  project: Project,
  options: { profile?: AssetContinuityProfile | string } = {},
): AssetContinuityContext => {
  const profile = ["operator", "storyboard", "visual_prompt", "visual_generation", "default"].includes(String(options.profile))
    ? options.profile as AssetContinuityProfile
    : "default";
  const { characters, assets, catalog } = createCatalog(project);
  const usage = new Map<string, {
    episodes: Set<number>;
    referenceCount: number;
    usedVariantIds: Set<string>;
    missingVariantRefs: Set<string>;
  }>();
  const missingReferences: AssetContinuityContext["missingReferences"] = [];

  const ensureUsage = (id: string) => {
    const existing = usage.get(id);
    if (existing) return existing;
    const next = {
      episodes: new Set<number>(),
      referenceCount: 0,
      usedVariantIds: new Set<string>(),
      missingVariantRefs: new Set<string>(),
    };
    usage.set(id, next);
    return next;
  };

  const addReference = (rawId: unknown, kind: AssetContinuityKind, episode: number, path: string) => {
    const id = String(rawId || "").trim();
    if (!id) return;
    const record = catalog.get(id);
    if (!record || record.kind !== kind) {
      missingReferences.push({ path, kind, id });
      return;
    }
    const entry = ensureUsage(id);
    entry.episodes.add(episode);
    entry.referenceCount += 1;
  };

  const addVariantMap = (value: unknown, episode: number, path: string) => {
    if (!value || typeof value !== "object") return;
    for (const [rawAssetId, rawVariantId] of Object.entries(value as Record<string, unknown>)) {
      const assetId = normalizeVariantAssetId(rawAssetId, catalog);
      const variantId = String(rawVariantId || "").trim();
      if (!assetId || !variantId || variantId === "default") continue;
      const record = catalog.get(assetId);
      if (!record) {
        missingReferences.push({ path: `${path}.assetVariantMap.${rawAssetId}`, kind: "prop", id: assetId });
        continue;
      }
      const entry = ensureUsage(assetId);
      entry.episodes.add(episode);
      entry.usedVariantIds.add(variantId);
      if (!record.variantIds.includes(variantId)) {
        entry.missingVariantRefs.add(variantId);
      }
    }
  };

  let sceneCount = 0;
  let shotCount = 0;
  const episodes = asArray<any>((project as any).episodes);
  episodes.forEach((episode, episodeIndex) => {
    const epNo = episodeNumber(episode, episodeIndex);
    asArray<any>(episode?.scenes).forEach((scene, sceneIndex) => {
      sceneCount += 1;
      const scenePath = `episodes.${episode?.id || episodeIndex}.scenes.${scene?.id || sceneIndex}`;
      const breakdown = scene?.breakdown || {};
      for (const id of asArray<string>(breakdown.characterIds || scene?.characterIds)) {
        addReference(id, "character", epNo, `${scenePath}.characterIds`);
      }
      addReference(breakdown.locationId || scene?.locationId, "location", epNo, `${scenePath}.locationId`);
      for (const id of asArray<string>(breakdown.propIds || scene?.propIds)) {
        addReference(id, "prop", epNo, `${scenePath}.propIds`);
      }
      addVariantMap(breakdown.assetVariantMap || scene?.assetVariantMap, epNo, scenePath);
      asArray<any>(scene?.shots).forEach((shot, shotIndex) => {
        shotCount += 1;
        const shotPath = `${scenePath}.shots.${shot?.id || shotIndex}`;
        for (const id of asArray<string>(shot?.characterIdsInShot)) {
          addReference(id, "character", epNo, `${shotPath}.characterIdsInShot`);
        }
        addReference(shot?.locationId, "location", epNo, `${shotPath}.locationId`);
        for (const id of asArray<string>(shot?.propIds)) {
          addReference(id, "prop", epNo, `${shotPath}.propIds`);
        }
        addVariantMap(shot?.assetVariantMap || shot?.assetOverrides, epNo, shotPath);
      });
    });
  });

  const duplicateKeys = [
    ...characters.map((character) => `character:${normalizeName(character.name)}`),
    ...assets
      .filter((asset) => ["location", "prop"].includes(asset.type))
      .map((asset) => `${asset.type}:${normalizeName(asset.name)}`),
  ].filter((key, index, list) => key.endsWith(":") ? false : list.indexOf(key) !== index);

  const targetEpisodeCount = Number(project.targetEpisodeCount || episodes.length || 0);
  const entries = [...catalog.values()].map((record): AssetContinuityEntry => {
    const currentUsage = usage.get(record.id);
    const episodeNumbers = currentUsage ? [...currentUsage.episodes].sort((a, b) => a - b) : [];
    const variantIds = record.variantIds;
    const entry: AssetContinuityEntry = {
      id: record.id,
      kind: record.kind,
      name: record.name,
      firstEpisode: episodeNumbers[0],
      lastEpisode: episodeNumbers.at(-1),
      episodeCount: episodeNumbers.length,
      referenceCount: currentUsage?.referenceCount || 0,
      variantCount: variantIds.length,
      variantIds,
      usedVariantIds: currentUsage ? [...currentUsage.usedVariantIds].sort() : [],
      missingVariantRefs: currentUsage ? [...currentUsage.missingVariantRefs].sort() : [],
      hasBasePrompt: hasPrompt(record.source),
      hasReference: hasReference(record.source),
      needsVariantPlan: false,
    };
    return {
      ...entry,
      needsVariantPlan: isRecurringEnoughForVariantPlan(entry, targetEpisodeCount),
    };
  }).sort((left, right) =>
    (left.firstEpisode || 99999) - (right.firstEpisode || 99999)
    || right.episodeCount - left.episodeCount
    || left.name.localeCompare(right.name, "zh-Hans-CN"),
  );

  const recurringEntries = entries.filter((entry) => entry.needsVariantPlan);
  const recurringWithoutVariants = recurringEntries.filter((entry) => entry.variantCount === 0);
  const missingVariantReferenceCount = entries.reduce((total, entry) => total + entry.missingVariantRefs.length, 0);
  const requiredBeforeVisualGeneration = [
    ...recurringWithoutVariants.slice(0, 12).map((entry) =>
      `${entry.kind}:${entry.id} ${entry.name} appears in ${entry.episodeCount} episodes (${entry.firstEpisode}-${entry.lastEpisode}) and needs stable visual variants before image generation.`,
    ),
    ...(missingVariantReferenceCount > 0
      ? [`${missingVariantReferenceCount} asset variant references point to missing variant ids; fix variants or assetVariantMap before image generation.`]
      : []),
  ];

  const qaIssues: ProductionQAIssue[] = [
    duplicateKeys.length
      ? createIssue("assets.duplicates", `资产库存在重复角色/地点/道具：${Array.from(new Set(duplicateKeys)).join(", ")}`, "warning")
      : undefined,
    missingReferences.length
      ? createIssue("assets.references", `${missingReferences.length} 个分镜/场景资产引用找不到 canonical 资产。`, "blocking", "先复用已有资产 ID；确实是新角色/地点/道具时先提交 character_patch 或 asset_patch。")
      : undefined,
    missingVariantReferenceCount
      ? createIssue("assets.variants.references", `${missingVariantReferenceCount} 个资产变体引用找不到对应 variants 条目。`, "blocking", "先补资产 variants，或把 assetVariantMap 改为已有 variantId。")
      : undefined,
    recurringWithoutVariants.length && ["visual_prompt", "visual_generation"].includes(profile)
      ? createIssue("assets.variants.coverage", `${recurringWithoutVariants.length} 个跨集复用资产缺少视觉变体台账。`, "warning", "进入图片生成前，为反复出现的角色、地点、道具补服装/妆造/损毁/使用状态等 variants，并在 scene.breakdown.assetVariantMap 中引用。")
      : undefined,
  ].filter(Boolean) as ProductionQAIssue[];

  return {
    profile,
    counts: {
      characters: characters.length,
      locations: assets.filter((asset) => asset.type === "location").length,
      props: assets.filter((asset) => asset.type === "prop").length,
      episodes: episodes.length,
      scenes: sceneCount,
      shots: shotCount,
    },
    entries,
    duplicateKeys: Array.from(new Set(duplicateKeys)),
    missingReferences,
    variantCoverage: {
      recurringAssetCount: recurringEntries.length,
      assetsWithVariants: entries.filter((entry) => entry.variantCount > 0).length,
      recurringWithoutVariants,
      missingVariantReferenceCount,
    },
    requiredBeforeVisualGeneration,
    qaIssues,
  };
};
