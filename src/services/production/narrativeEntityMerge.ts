import { sha256 } from "js-sha256";

import type { ScriptExportPackage } from "../../../packages/domain/src/scriptDelivery";
import type { ScriptDeliveryCharacter, ScriptDeliveryLore } from "../../../packages/domain/src/scriptDelivery";
import type { Asset, Character, Project } from "../../types/project";

export type ProductionNarrativeEntityKind = "character" | "location" | "prop";
export type ProductionNarrativeEntityMergeAction = "create" | "update";

export interface ProductionNarrativeEntityFieldChange {
  field: string;
  label: string;
  before?: string;
  after: string;
}

export interface ProductionNarrativeEntityMergeChange {
  id: string;
  action: ProductionNarrativeEntityMergeAction;
  kind: ProductionNarrativeEntityKind;
  sourceEntityId: string;
  targetId: string;
  name: string;
  fieldChanges: ProductionNarrativeEntityFieldChange[];
}

export interface ProductionNarrativeEntityRemovedSource {
  kind: ProductionNarrativeEntityKind;
  sourceEntityId: string;
  targetId: string;
  name: string;
}

export interface ProductionNarrativeEntityUnmappedSource {
  sourceEntityId: string;
  name: string;
  reason: string;
}

export interface ProductionNarrativeEntityMergeCandidate {
  schemaVersion: "production-narrative-entity-merge-candidate.v1";
  id: string;
  sourceWritingProjectId: string;
  sourceExportedAt: number;
  projectEntityFingerprint: string;
  changes: ProductionNarrativeEntityMergeChange[];
  removedSources: ProductionNarrativeEntityRemovedSource[];
  unmappedSources: ProductionNarrativeEntityUnmappedSource[];
  createdAt: number;
}

interface NarrativeEntityProjection {
  kind: ProductionNarrativeEntityKind;
  sourceEntityId: string;
  targetId: string;
  name: string;
  fields: Array<{ field: string; label: string; value?: string }>;
}

const text = (value: unknown) => {
  const normalized = String(value || "").trim();
  return normalized || undefined;
};

const canonicalNameKey = (value: unknown) => String(value || "")
  .trim()
  .toLocaleLowerCase()
  .replace(/\s+/g, "");

export const productionCharacterIdForWritingEntity = (sourceEntityId: string) =>
  `prod_character_${sourceEntityId}`;

export const productionAssetIdForWritingEntity = (sourceEntityId: string) =>
  `prod_asset_${sourceEntityId}`;

const projectEntityFingerprint = (project: Pick<Project, "characters" | "assets">) =>
  sha256(JSON.stringify({
    characters: project.characters.map((item) => ({
      id: item.id,
      name: item.name,
      psychologicalProfile: item.psychologicalProfile,
      mbti: item.mbti,
      enneagram: item.enneagram,
      actingStyle: item.actingStyle,
    })),
    assets: project.assets.map((item) => ({
      id: item.id,
      type: item.type,
      name: item.name,
      description: item.description,
    })),
  }));

const characterProjection = (character: ScriptDeliveryCharacter): NarrativeEntityProjection => ({
  kind: "character",
  sourceEntityId: character.id,
  targetId: productionCharacterIdForWritingEntity(character.id),
  name: character.name,
  fields: [
    { field: "name", label: "人物名称", value: text(character.name) },
    { field: "psychologicalProfile", label: "人物心理", value: text(character.psychologicalProfile) },
    { field: "mbti", label: "MBTI", value: text(character.mbti) },
    { field: "enneagram", label: "九型人格", value: text(character.enneagram) },
    { field: "actingStyle", label: "表演方向", value: text(character.actingStyle) },
  ],
});

const loreKind = (lore: ScriptDeliveryLore): ProductionNarrativeEntityKind | null => {
  if (lore.category === "coreRule") return null;
  if (lore.category === "keyArena") return "location";
  if (lore.productionAssetKind === "location" || lore.productionAssetKind === "prop") {
    return lore.productionAssetKind;
  }
  if (lore.productionAssetKind === "none") return null;
  return null;
};

const loreProjection = (lore: ScriptDeliveryLore): NarrativeEntityProjection | null => {
  const kind = loreKind(lore);
  if (!kind) return null;
  return {
    kind,
    sourceEntityId: lore.id,
    targetId: productionAssetIdForWritingEntity(lore.id),
    name: lore.term,
    fields: [
      { field: "name", label: kind === "location" ? "地点名称" : "道具名称", value: text(lore.term) },
      { field: "description", label: "剧本事实", value: text(lore.definition) },
    ],
  };
};

const sourceProjections = (sourcePackage: ScriptExportPackage) => [
  ...sourcePackage.characters.map(characterProjection),
  ...sourcePackage.lore.flatMap((lore) => {
    const projection = loreProjection(lore);
    return projection ? [projection] : [];
  }),
];

const currentValue = (
  project: Pick<Project, "characters" | "assets">,
  projection: NarrativeEntityProjection,
  field: string,
) => {
  const target = projection.kind === "character"
    ? project.characters.find((item) => item.id === projection.targetId)
    : project.assets.find((item) => item.id === projection.targetId);
  return target ? text((target as unknown as Record<string, unknown>)[field]) : undefined;
};

const currentTargetExists = (
  project: Pick<Project, "characters" | "assets">,
  projection: NarrativeEntityProjection,
) => projection.kind === "character"
  ? project.characters.some((item) => item.id === projection.targetId)
  : project.assets.some((item) => item.id === projection.targetId);

const resolveProjectionTarget = (
  project: Pick<Project, "characters" | "assets">,
  projection: NarrativeEntityProjection,
): NarrativeEntityProjection => {
  if (currentTargetExists(project, projection)) return projection;
  const key = canonicalNameKey(projection.name);
  const existing = projection.kind === "character"
    ? project.characters.find((item) => canonicalNameKey(item.name) === key)
    : project.assets.find((item) => item.type === projection.kind && canonicalNameKey(item.name) === key);
  return existing ? { ...projection, targetId: existing.id } : projection;
};

const mergeChangeFor = (
  project: Pick<Project, "characters" | "assets">,
  projection: NarrativeEntityProjection,
): ProductionNarrativeEntityMergeChange | null => {
  const resolvedProjection = resolveProjectionTarget(project, projection);
  const exists = currentTargetExists(project, resolvedProjection);
  const fieldChanges = resolvedProjection.fields.flatMap(({ field, label, value }) => {
    if (!value) return [];
    const before = currentValue(project, resolvedProjection, field);
    return before === value ? [] : [{ field, label, before, after: value }];
  });
  if (exists && fieldChanges.length === 0) return null;
  return {
    id: sha256(`${resolvedProjection.kind}:${resolvedProjection.sourceEntityId}:${JSON.stringify(fieldChanges)}`).slice(0, 24),
    action: exists ? "update" : "create",
    kind: resolvedProjection.kind,
    sourceEntityId: resolvedProjection.sourceEntityId,
    targetId: resolvedProjection.targetId,
    name: resolvedProjection.name,
    fieldChanges,
  };
};

const previousSourceProjections = (project: Project) => {
  const snapshot = project.productionSourceSnapshot;
  return snapshot?.sourceType === "writing_export" ? sourceProjections(snapshot.package as ScriptExportPackage) : [];
};

export const buildProductionNarrativeEntityMergeCandidate = ({
  project,
  sourcePackage,
  createdAt = Date.now(),
}: {
  project: Project;
  sourcePackage: ScriptExportPackage;
  createdAt?: number;
}): ProductionNarrativeEntityMergeCandidate => {
  const snapshot = project.productionSourceSnapshot;
  if (snapshot?.sourceType !== "writing_export") {
    throw new Error("当前制片项目没有可检查的系统剧本来源");
  }
  if (snapshot.sourceWritingProjectId !== sourcePackage.sourceWritingProjectId) {
    throw new Error("剧本来源与当前制片项目不匹配");
  }
  const current = sourceProjections(sourcePackage);
  const currentSourceKeys = new Set(current.map((item) => `${item.kind}:${item.sourceEntityId}`));
  const acknowledgedRemovedSourceKeys = new Set(
    project.productionNarrativeEntitySync?.sourceWritingProjectId === sourcePackage.sourceWritingProjectId
      ? project.productionNarrativeEntitySync.acknowledgedRemovedSourceKeys
      : [],
  );
  const removedSources = previousSourceProjections(project)
    .filter((item) => {
      const key = `${item.kind}:${item.sourceEntityId}`;
      return !currentSourceKeys.has(key) && !acknowledgedRemovedSourceKeys.has(key);
    })
    .map((item) => ({
      kind: item.kind,
      sourceEntityId: item.sourceEntityId,
      targetId: item.targetId,
      name: item.name,
    }));
  const changes = current.flatMap((projection) => {
    const change = mergeChangeFor(project, projection);
    return change ? [change] : [];
  });
  const unmappedSources = sourcePackage.lore
    .filter((item) => item.category === "keyEntity" && !item.productionAssetKind)
    .map((item) => ({
      sourceEntityId: item.id,
      name: item.term,
      reason: "该世界设定尚未明确为地点或道具，为避免错误资产不会自动导入",
    }));
  const fingerprint = projectEntityFingerprint(project);
  return {
    schemaVersion: "production-narrative-entity-merge-candidate.v1",
    id: sha256(JSON.stringify({
      sourceWritingProjectId: sourcePackage.sourceWritingProjectId,
      fingerprint,
      changes,
      removedSources,
      unmappedSources,
    })).slice(0, 32),
    sourceWritingProjectId: sourcePackage.sourceWritingProjectId,
    sourceExportedAt: sourcePackage.exportedAt,
    projectEntityFingerprint: fingerprint,
    changes,
    removedSources,
    unmappedSources,
    createdAt,
  };
};

const characterPatch = (
  current: Character | undefined,
  change: ProductionNarrativeEntityMergeChange,
): Character => {
  const next: Character = current
    ? { ...current }
    : { id: change.targetId, name: change.name };
  for (const field of change.fieldChanges) {
    (next as unknown as Record<string, unknown>)[field.field] = field.after;
  }
  return next;
};

const assetPatch = (
  current: Asset | undefined,
  change: ProductionNarrativeEntityMergeChange,
): Asset => {
  const next: Asset = current
    ? { ...current }
    : {
        id: change.targetId,
        type: change.kind,
        name: change.name,
        description: "",
      };
  for (const field of change.fieldChanges) {
    (next as unknown as Record<string, unknown>)[field.field] = field.after;
  }
  return next;
};

export const applyProductionNarrativeEntityMergeCandidate = ({
  project,
  candidate,
  selectedChangeIds = candidate.changes.map((item) => item.id),
}: {
  project: Project;
  candidate: ProductionNarrativeEntityMergeCandidate;
  selectedChangeIds?: string[];
}): Pick<Project, "characters" | "assets" | "productionNarrativeEntitySync"> => {
  const snapshot = project.productionSourceSnapshot;
  if (
    snapshot?.sourceType !== "writing_export"
    || snapshot.sourceWritingProjectId !== candidate.sourceWritingProjectId
  ) {
    throw new Error("候选方案不属于当前制片项目");
  }
  if (projectEntityFingerprint(project) !== candidate.projectEntityFingerprint) {
    throw new Error("制片人物或资产已发生变化，请重新检查剧本更新");
  }
  const selected = new Set(selectedChangeIds);
  const characters = project.characters.map((item) => ({ ...item }));
  const assets = project.assets.map((item) => ({ ...item }));
  for (const change of candidate.changes) {
    if (!selected.has(change.id)) continue;
    if (change.kind === "character") {
      const index = characters.findIndex((item) => item.id === change.targetId);
      const next = characterPatch(index >= 0 ? characters[index] : undefined, change);
      if (index >= 0) characters[index] = next;
      else characters.push(next);
      continue;
    }
    const index = assets.findIndex((item) => item.id === change.targetId);
    const next = assetPatch(index >= 0 ? assets[index] : undefined, change);
    if (index >= 0) assets[index] = next;
    else assets.push(next);
  }
  const acknowledgedRemovedSourceKeys = [
    ...new Set([
      ...(project.productionNarrativeEntitySync?.acknowledgedRemovedSourceKeys || []),
      ...candidate.removedSources.map((item) => `${item.kind}:${item.sourceEntityId}`),
    ]),
  ];
  return {
    characters,
    assets,
    productionNarrativeEntitySync: {
      schemaVersion: "production-narrative-entity-sync.v1",
      sourceWritingProjectId: candidate.sourceWritingProjectId,
      acknowledgedRemovedSourceKeys,
      lastCheckedExportedAt: candidate.sourceExportedAt,
      lastAppliedAt: Date.now(),
    },
  };
};

export const productionAssetsFromWritingLore = (lore: ScriptDeliveryLore[]): Asset[] =>
  lore.flatMap((entry) => {
    const projection = loreProjection(entry);
    if (!projection) return [];
    return [{
      id: projection.targetId,
      type: projection.kind,
      name: projection.name,
      description: text(entry.definition) || "",
    }];
  });
