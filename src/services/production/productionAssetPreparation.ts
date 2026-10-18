import type {
  Asset,
  AssetVariant,
  Character,
  Episode,
  Project,
  Scene,
} from "../../types/project";
import { manualFilmTeamScriptHash } from "./manualFilmTeam";

export type ProductionAssetPreparationAssetType = "character" | "location" | "prop";

export interface ProductionAssetPreparationContextAsset {
  id: string;
  type: ProductionAssetPreparationAssetType;
  name: string;
  currentProfile: Record<string, unknown>;
  variants: AssetVariant[];
}

export interface ProductionAssetPreparationContextUsage {
  episodeId: string;
  episodeTitle: string;
  sceneId: string;
  sceneTitle: string;
  assetId: string;
  assetType: ProductionAssetPreparationAssetType;
  assetName: string;
  state: string;
}

export interface ProductionAssetPreparationContextScene {
  episodeId: string;
  episodeTitle: string;
  sceneId: string;
  sceneTitle: string;
  script: string;
  sourceEvidence: string;
  structuredBreakdown?: Scene["breakdown"];
}

export interface ProductionAssetPreparationContext {
  projectId: string;
  projectTitle: string;
  sourceHash: string;
  episodeIds: string[];
  assets: ProductionAssetPreparationContextAsset[];
  scenes: ProductionAssetPreparationContextScene[];
  usages: ProductionAssetPreparationContextUsage[];
  sourceDocuments: Array<{ id: string; title: string; content: string; sourceHash: string }>;
  departmentOutputs: Array<{
    episodeId: string;
    department: string;
    sourceHash: string;
    taskSummary: string;
    content?: string;
    scenePlans?: Array<{ sceneId: string; summary: string; continuityNotes: string[] }>;
    sceneIds: string[];
    handoffNotes: string[];
  }>;
}

export interface ProductionAssetPreparedProfile {
  assetId: string;
  assetType: ProductionAssetPreparationAssetType;
  assetName: string;
  currentValues: Record<string, unknown>;
  proposedValues: Record<string, unknown>;
  changedFields: string[];
  evidence: string[];
  assumptions: string[];
}

export interface ProductionAssetStateDecision {
  sceneId: string;
  assetId: string;
  assetType: ProductionAssetPreparationAssetType;
  use: "base" | "variant";
  existingVariantId?: string;
  variantKey?: string;
  variantName?: string;
  visibleDelta?: string;
  promptModifiers?: string;
  reason: string;
  evidence: string;
}

export interface ProductionAssetPreparationNormalizedCandidate {
  profiles: ProductionAssetPreparedProfile[];
  decisions: ProductionAssetStateDecision[];
  structureErrors: string[];
}

const characterProfileFields = [
  "name",
  "visualIdentity",
  "psychologicalProfile",
  "mbti",
  "enneagram",
  "internalDesire",
  "externalGoal",
  "flaw",
  "actingStyle",
  "vocalQuirk",
  "sliders",
] as const;

const catalogProfileFields = ["name", "description", "tags"] as const;

const text = (value: unknown) => String(value || "").trim();

const textList = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];

const meaningful = (value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return text(value).length > 0;
};

const stateAt = (values: Scene["breakdown"] extends infer _ ? unknown[] | undefined : never, index: number) => {
  const value = values?.[index];
  if (!value || typeof value === "string") return text(value);
  return text((value as { state?: string }).state);
};

const sourceForScene = (scene: Scene) => text(scene.script || scene.sourceEvidence || scene.description);

const profileForCharacter = (character: Character): Record<string, unknown> => Object.fromEntries(
  characterProfileFields.map((field) => [field, character[field]]),
);

const profileForAsset = (asset: Asset): Record<string, unknown> => Object.fromEntries(
  catalogProfileFields.map((field) => [field, asset[field]]),
);

const contextAssets = (project: Project, episodes: Episode[]) => {
  const characterIds = new Set<string>();
  const assetIds = new Set<string>();
  episodes.forEach((episode) => episode.scenes.forEach((scene) => {
    scene.breakdown?.characterIds?.forEach((id) => characterIds.add(id));
    if (scene.breakdown?.locationId) assetIds.add(scene.breakdown.locationId);
    scene.breakdown?.propIds?.forEach((id) => assetIds.add(id));
  }));
  return [
    ...project.characters
      .filter((character) => characterIds.has(character.id))
      .map((character): ProductionAssetPreparationContextAsset => ({
        id: character.id,
        type: "character",
        name: character.name,
        currentProfile: profileForCharacter(character),
        variants: character.variants || [],
      })),
    ...project.assets
      .filter((asset) => assetIds.has(asset.id) && (asset.type === "location" || asset.type === "prop"))
      .map((asset): ProductionAssetPreparationContextAsset => ({
        id: asset.id,
        type: asset.type as "location" | "prop",
        name: asset.name,
        currentProfile: profileForAsset(asset),
        variants: asset.variants || [],
      })),
  ];
};

const contextUsages = (
  project: Project,
  episodes: Episode[],
  assets: ProductionAssetPreparationContextAsset[],
) => {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const usages: ProductionAssetPreparationContextUsage[] = [];
  episodes.forEach((episode) => episode.scenes.forEach((scene) => {
    const breakdown = scene.breakdown;
    (breakdown?.characterIds || []).forEach((assetId, index) => {
      const asset = byId.get(assetId);
      if (!asset) return;
      usages.push({
        episodeId: episode.id,
        episodeTitle: episode.title,
        sceneId: scene.id,
        sceneTitle: scene.title,
        assetId,
        assetType: "character",
        assetName: asset.name,
        state: stateAt(breakdown?.characters, index),
      });
    });
    if (breakdown?.locationId) {
      const asset = byId.get(breakdown.locationId);
      if (asset) usages.push({
        episodeId: episode.id,
        episodeTitle: episode.title,
        sceneId: scene.id,
        sceneTitle: scene.title,
        assetId: asset.id,
        assetType: "location",
        assetName: asset.name,
        state: typeof breakdown.location === "string" ? "" : text(breakdown.location.state),
      });
    }
    (breakdown?.propIds || []).forEach((assetId, index) => {
      const asset = byId.get(assetId);
      if (!asset) return;
      usages.push({
        episodeId: episode.id,
        episodeTitle: episode.title,
        sceneId: scene.id,
        sceneTitle: scene.title,
        assetId,
        assetType: "prop",
        assetName: asset.name,
        state: stateAt(breakdown?.props, index),
      });
    });
  }));
  return usages;
};

const contextScenes = (episodes: Episode[]): ProductionAssetPreparationContextScene[] => episodes.flatMap((episode) => (
  episode.scenes
    .filter((scene) => Boolean(scene.breakdown))
    .map((scene) => ({
      episodeId: episode.id,
      episodeTitle: episode.title,
      sceneId: scene.id,
      sceneTitle: scene.title,
      script: sourceForScene(scene),
      sourceEvidence: text(scene.sourceEvidence),
      structuredBreakdown: scene.breakdown
        ? { ...scene.breakdown, assetVariantMap: undefined }
        : undefined,
    }))
));

export const productionAssetDepartmentOutputSourceHash = (
  output: NonNullable<Episode["productionTeam"]>["outputs"][number],
) => {
  const workspaceHash = (output as typeof output & {
    __workspaceProductionAssetSourceHash?: string;
  }).__workspaceProductionAssetSourceHash;
  if (workspaceHash) return workspaceHash;
  return manualFilmTeamScriptHash(JSON.stringify({
    department: output.department,
    coordinationPhase: output.coordinationPhase,
    sourceScriptHash: output.sourceScriptHash,
    sourceBreakdownHash: output.sourceBreakdownHash,
    fullScriptHash: output.fullScriptHash,
    sourceSceneIds: output.sourceSceneIds,
    taskSummary: output.taskSummary,
    content: output.content,
    scenePlans: output.scenePlans,
    openQuestions: output.openQuestions,
    handoffNotes: output.handoffNotes,
    handoffs: output.handoffs,
    collaborationSourceHash: output.collaborationSourceHash,
    collaborationSourceVersions: output.collaborationSourceVersions,
    collaborationHandoffIds: output.collaborationHandoffIds,
    status: output.status,
    version: output.version,
  }));
};

export const buildProductionAssetPreparationContext = (
  project: Project,
  episodes: Episode[],
): ProductionAssetPreparationContext => {
  const selectedEpisodes = episodes.filter((episode) => episode.scenes.some((scene) => Boolean(scene.breakdown)));
  const assets = contextAssets(project, selectedEpisodes);
  const scenes = contextScenes(selectedEpisodes);
  const usages = contextUsages(project, selectedEpisodes, assets);
  const sourceDocumentIds = new Set(selectedEpisodes.map((episode) => episode.sourceDocumentId).filter(Boolean));
  const sourceDocuments = (project.productionSourceDocuments || [])
    .filter((document) => sourceDocumentIds.has(document.id))
    .map((document) => ({ id: document.id, title: document.title, content: document.content, sourceHash: document.sourceHash }));
  const departmentOutputs = selectedEpisodes.flatMap((episode) => (episode.productionTeam?.outputs || [])
    .filter((output) => output.status === "confirmed")
    .map((output) => ({
      episodeId: episode.id,
      department: output.department,
      // Workspace reads omit bulky QA evidence. Hash the adopted department
      // result itself so the same production state stays valid in every view.
      sourceHash: productionAssetDepartmentOutputSourceHash(output),
      taskSummary: output.taskSummary,
      content: output.content,
      scenePlans: output.scenePlans?.map(row => ({ sceneId: row.sceneId, summary: row.summary, continuityNotes: row.continuityNotes })),
      sceneIds: (output.scenePlans || []).map((plan) => plan.sceneId),
      handoffNotes: output.handoffNotes || [],
    })));
  const sourceHash = manualFilmTeamScriptHash(JSON.stringify({
    sourceDocuments: sourceDocuments.map((document) => ({ id: document.id, sourceHash: document.sourceHash })),
    assets: assets.map((asset) => ({ id: asset.id, type: asset.type, name: asset.name })),
    scenes,
    usages,
    departmentOutputs: departmentOutputs.map(({ content: _content, scenePlans: _scenePlans, ...output }) => output),
  }));
  return {
    projectId: project.id,
    projectTitle: project.title,
    sourceHash,
    episodeIds: selectedEpisodes.map((episode) => episode.id),
    assets,
    scenes,
    usages,
    sourceDocuments,
    departmentOutputs,
  };
};

const normalizeSliders = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const sliders = Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const numeric = Number(item);
    return key.trim() && Number.isFinite(numeric)
      ? [[key.trim(), Math.max(-10, Math.min(10, Math.round(numeric)))]]
      : [];
  }));
  return Object.keys(sliders).length ? sliders : undefined;
};

const normalizeProfileValues = (
  raw: Record<string, unknown>,
  asset: ProductionAssetPreparationContextAsset,
  project: Project,
) => {
  const fields = asset.type === "character" ? characterProfileFields : catalogProfileFields;
  const current = asset.currentProfile;
  const result: Record<string, unknown> = {};
  fields.forEach((field) => {
    const value = raw[field];
    if (field === "sliders") {
      const sliders = normalizeSliders(value);
      if (sliders) result[field] = sliders;
      return;
    }
    if (field === "tags") {
      if (Array.isArray(value)) result[field] = value.map(text).filter(Boolean);
      return;
    }
    const normalized = text(value);
    if (normalized) result[field] = normalized;
  });
  result.name = current.name;
  if (asset.type === "character") {
    if (meaningful(current.mbti)) result.mbti = current.mbti;
    if (meaningful(current.enneagram)) result.enneagram = current.enneagram;
  }
  const hasAdoptedProfile = Boolean(project.manualProductionAssets?.profileRevisions?.some((entry) => entry.assetId === asset.id));
  if (hasAdoptedProfile) {
    fields.forEach((field) => {
      if (meaningful(current[field])) result[field] = current[field];
    });
  } else {
    fields.forEach((field) => {
      if (!meaningful(result[field]) && meaningful(current[field])) result[field] = current[field];
    });
  }
  return result;
};

const usageKey = (sceneId: string, assetId: string) => `${sceneId}::${assetId}`;

export const normalizeProductionAssetPreparationCandidate = ({
  raw,
  project,
  context,
}: {
  raw: Record<string, unknown>;
  project: Project;
  context: ProductionAssetPreparationContext;
}): ProductionAssetPreparationNormalizedCandidate => {
  const errors: string[] = [];
  const assetById = new Map(context.assets.map((asset) => [asset.id, asset]));
  const profileById = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(raw.profiles) ? raw.profiles : []) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const assetId = text(record.assetId);
    if (!assetById.has(assetId)) {
      errors.push(`档案候选引用了当前范围外的资产 ID：${assetId || "空"}`);
      continue;
    }
    if (text(record.assetType) !== assetById.get(assetId)?.type) errors.push(`资产 ${assetId} 的 assetType 与 canonical 登记不一致。`);
    if (profileById.has(assetId)) errors.push(`资产 ${assetId} 返回了重复档案。`);
    profileById.set(assetId, record);
  }
  const profiles = context.assets.map((asset): ProductionAssetPreparedProfile => {
    const rawProfile = profileById.get(asset.id) || {};
    if (!profileById.has(asset.id)) errors.push(`缺少资产 ${asset.name}（${asset.id}）的项目级档案。`);
    const proposedValues = normalizeProfileValues(rawProfile, asset, project);
    const requiredFields = asset.type === "character"
      ? ["visualIdentity", "psychologicalProfile", "actingStyle", "vocalQuirk"]
      : ["description", "tags"];
    requiredFields.forEach((field) => {
      if (!meaningful(proposedValues[field])) errors.push(`${asset.name} 的档案缺少 ${field}。`);
    });
    const currentValues = asset.currentProfile;
    const changedFields = Object.keys(proposedValues).filter((field) =>
      JSON.stringify(currentValues[field]) !== JSON.stringify(proposedValues[field])
    );
    const evidence = textList(rawProfile.evidence);
    const assumptions = textList(rawProfile.assumptions);
    if (!evidence.length) errors.push(`${asset.name} 的项目级档案缺少可核对的来源证据。`);
    return { assetId: asset.id, assetType: asset.type, assetName: asset.name, currentValues, proposedValues, changedFields, evidence, assumptions };
  });

  const requiredUsageByKey = new Map(context.usages.map((usage) => [usageKey(usage.sceneId, usage.assetId), usage]));
  const decisionByKey = new Map<string, ProductionAssetStateDecision>();
  for (const value of Array.isArray(raw.decisions) ? raw.decisions : []) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const sceneId = text(record.sceneId);
    const assetId = text(record.assetId);
    const key = usageKey(sceneId, assetId);
    const usage = requiredUsageByKey.get(key);
    if (!usage) {
      errors.push(`状态决策引用了当前范围外的 sceneId/assetId：${sceneId}/${assetId}`);
      continue;
    }
    if (text(record.assetType) !== usage.assetType) errors.push(`${usage.sceneTitle} / ${usage.assetName} 的 assetType 与 canonical 登记不一致。`);
    if (decisionByKey.has(key)) errors.push(`${usage.sceneTitle} / ${usage.assetName} 返回了重复状态决策。`);
    const use = record.use === "variant" ? "variant" : "base";
    const existingVariantId = text(record.existingVariantId) || undefined;
    if (existingVariantId && !assetById.get(assetId)?.variants.some((variant) => variant.id === existingVariantId)) {
      errors.push(`${usage.assetName} 引用了不存在的既有变体 ${existingVariantId}。`);
    }
    const decision: ProductionAssetStateDecision = {
      sceneId,
      assetId,
      assetType: usage.assetType,
      use,
      existingVariantId,
      variantKey: use === "variant" ? text(record.variantKey) || undefined : undefined,
      variantName: use === "variant" ? text(record.variantName) || undefined : undefined,
      visibleDelta: use === "variant" ? text(record.visibleDelta) || undefined : undefined,
      promptModifiers: use === "variant" ? text(record.promptModifiers) || undefined : undefined,
      reason: text(record.reason),
      evidence: text(record.evidence),
    };
    if (!decision.reason || !decision.evidence) errors.push(`${usage.sceneTitle} / ${usage.assetName} 的状态判断缺少理由或证据。`);
    if (use === "variant" && !existingVariantId && (!decision.variantKey || !decision.variantName || !decision.visibleDelta || !decision.promptModifiers)) {
      errors.push(`${usage.sceneTitle} / ${usage.assetName} 需要新变体，但缺少稳定 key、名称、可见差异或增量提示词。`);
    }
    decisionByKey.set(key, decision);
  }
  requiredUsageByKey.forEach((usage, key) => {
    if (!decisionByKey.has(key)) errors.push(`缺少 ${usage.sceneTitle} / ${usage.assetName} 的 base 或 variant 判断。`);
  });
  const decisions = context.usages.flatMap((usage) => {
    const decision = decisionByKey.get(usageKey(usage.sceneId, usage.assetId));
    return decision ? [decision] : [];
  });
  const reusableVariants = new Map<string, ProductionAssetStateDecision>();
  decisions.filter((decision) => decision.use === "variant" && !decision.existingVariantId).forEach((decision) => {
    const key = `${decision.assetId}::${decision.variantKey}`;
    const existing = reusableVariants.get(key);
    if (!existing) {
      reusableVariants.set(key, decision);
      return;
    }
    if (existing.variantName !== decision.variantName || existing.visibleDelta !== decision.visibleDelta || existing.promptModifiers !== decision.promptModifiers) {
      errors.push(`同一资产变体 key ${decision.variantKey} 在不同场次返回了不一致的视觉定义。`);
    }
  });
  return { profiles, decisions, structureErrors: Array.from(new Set(errors)) };
};

export const productionAssetPreparationVariantId = (decision: ProductionAssetStateDecision) => {
  if (decision.existingVariantId) return decision.existingVariantId;
  const definition = [decision.assetId, decision.variantKey, decision.variantName, decision.visibleDelta, decision.promptModifiers];
  return `manual-variant-${decision.assetId}-${manualFilmTeamScriptHash(JSON.stringify(definition)).slice(0, 12)}`;
};

export const mergeProductionAssetPreparationVariants = (
  assetId: string,
  variants: AssetVariant[],
  decisions: ProductionAssetStateDecision[],
): AssetVariant[] => {
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  for (const decision of decisions) {
    if (decision.assetId !== assetId || decision.use !== "variant" || decision.existingVariantId) continue;
    const next: AssetVariant = {
      id: productionAssetPreparationVariantId(decision),
      name: decision.variantName || "状态变体",
      description: decision.visibleDelta || "",
      promptModifiers: decision.promptModifiers || "",
    };
    const existing = byId.get(next.id);
    if (existing) {
      if (existing.name !== next.name || existing.description !== next.description || existing.promptModifiers !== next.promptModifiers) {
        throw new Error(`「${existing.name}」已被修改，未覆盖既有状态。请重新读取资产后再采用。`);
      }
      continue;
    }
    byId.set(next.id, next);
  }
  return [...byId.values()];
};

export const buildProductionAssetPreparationSceneUpdates = (
  episodes: Episode[],
  decisions: ProductionAssetStateDecision[],
) => episodes.flatMap((episode) => episode.scenes.flatMap((scene) => {
  const sceneDecisions = decisions.filter((decision) => decision.sceneId === scene.id);
  if (!scene.breakdown || !sceneDecisions.length) return [];
  const assetVariantMap = { ...(scene.breakdown.assetVariantMap || {}) };
  sceneDecisions.forEach((decision) => {
    if (decision.use === "variant") assetVariantMap[decision.assetId] = productionAssetPreparationVariantId(decision);
    else delete assetVariantMap[decision.assetId];
  });
  return [{ episodeId: episode.id, sceneId: scene.id, breakdown: { ...scene.breakdown, assetVariantMap } }];
}));
