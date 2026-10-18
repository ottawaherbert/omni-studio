import { sha256 } from "js-sha256";
import type { ScriptExportPackage } from "../../../packages/domain/src/scriptDelivery";

import type {
  Episode,
  EpisodeMeta,
  ProductionCanonicalScriptUnit,
  ProductionCanonicalScriptUnitKind,
  ProductionScenePlanVersion,
  ProductionScriptAuthority,
  ProductionScriptRevision,
  ProductionScriptWorkspace,
  ProductionSourceDocument,
  Project,
} from "../../types/project";

const text = (value: unknown) => String(value || "").trim();

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

const positiveNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const unitHash = (unit: Pick<ProductionCanonicalScriptUnit, "title" | "summary" | "targetDurationMinutes" | "continuityMode" | "content">) =>
  sha256(JSON.stringify({
    title: text(unit.title),
    summary: text(unit.summary),
    targetDurationMinutes: positiveNumber(unit.targetDurationMinutes),
    continuityMode: unit.continuityMode,
    content: String(unit.content || ""),
  }));

const revisionHash = (units: ProductionCanonicalScriptUnit[]) => sha256(JSON.stringify(units.map((unit) => ({
  id: unit.id,
  order: unit.order,
  contentHash: unit.contentHash,
  status: unit.status,
}))));

const authorityFor = (project: Project): ProductionScriptAuthority =>
  project.productionSourceSnapshot?.sourceType === "writing_export" ? "writing" : "production";

const sourceKindFor = (project: Project): ProductionScriptWorkspace["sourceKind"] =>
  project.productionSourceSnapshot?.sourceType === "writing_export"
    ? "writing_project"
    : project.productionSourceSnapshot?.sourceType === "magic_import"
      ? "magic_import"
      : "production_created";

const unitKindFor = (document: ProductionSourceDocument): ProductionCanonicalScriptUnitKind =>
  document.kind === "segment" || document.kind === "whole" ? "segment" : "episode";

const sourceUnitFromDocument = (document: ProductionSourceDocument, now: number): ProductionCanonicalScriptUnit => {
  const content = String(document.content || "");
  const unit: ProductionCanonicalScriptUnit = {
    id: document.id,
    sourceDocumentId: document.id,
    kind: unitKindFor(document),
    order: document.order,
    title: document.title || `剧本单元 ${document.order}`,
    summary: text(document.summary) || undefined,
    targetDurationMinutes: positiveNumber(document.targetDurationMinutes),
    continuityMode: document.continuityMode,
    content,
    contentHash: "",
    status: "current",
    sourceWritingUnitId: document.sourceWritingUnitId,
    originalSourceDocumentId: document.originalSourceDocumentId,
    createdAt: document.createdAt || now,
    updatedAt: now,
  };
  return { ...unit, contentHash: unitHash(unit) };
};

const revisionFrom = (
  units: ProductionCanonicalScriptUnit[],
  input: Pick<ProductionScriptRevision, "revision" | "kind" | "authority" | "message"> & { id?: string; createdAt?: number },
): ProductionScriptRevision => ({
  id: input.id || newId("prod_script_revision"),
  revision: input.revision,
  kind: input.kind,
  authority: input.authority,
  message: input.message,
  sourceHash: revisionHash(units),
  units: clone(units),
  createdAt: input.createdAt || Date.now(),
});

/** Creates an editable screenplay revision without mutating the import evidence. */
export const createProductionScriptWorkspace = (
  project: Project,
  sourceDocuments: ProductionSourceDocument[],
  now = Date.now(),
): ProductionScriptWorkspace => {
  const authority = authorityFor(project);
  const units = sourceDocuments
    .filter((document) => document.isWorkRange !== false)
    .sort((left, right) => left.order - right.order)
    .map((document) => sourceUnitFromDocument(document, now));
  const original = revisionFrom(units, {
    id: `prod_script_revision_original_${project.id}`,
    revision: 0,
    kind: "initial",
    authority,
    message: authority === "writing" ? "保留首次进入制片的剧本快照" : "保留魔法导入原稿",
    createdAt: now,
  });
  const initial = revisionFrom(units, {
    id: `prod_script_revision_initial_${project.id}`,
    revision: 1,
    kind: "initial",
    authority,
    message: authority === "writing" ? "从剧本工作台同步初始剧本" : "保留导入原稿并创建当前剧本",
    createdAt: now,
  });
  return {
    schemaVersion: "production-canonical-script.v1",
    authority,
    sourceKind: sourceKindFor(project),
    writingProjectId: project.productionSourceSnapshot?.sourceType === "writing_export"
      ? project.productionSourceSnapshot.sourceWritingProjectId
      : undefined,
    currentRevisionId: initial.id,
    revisions: [original, initial],
    originalRevisionId: original.id,
    syncPolicy: "manual",
    syncStatus: "current",
    updatedAt: now,
  };
};

export const currentProductionScriptRevision = (workspace?: ProductionScriptWorkspace | null) => {
  if (!workspace) return undefined;
  return workspace.revisions.find((revision) => revision.id === workspace.currentRevisionId)
    || workspace.revisions.slice().sort((left, right) => right.revision - left.revision)[0];
};

export const productionScriptWorkspaceForProject = (
  project: Project,
  sourceDocuments: ProductionSourceDocument[],
) => project.productionScriptWorkspace
  ? { ...project.productionScriptWorkspace, syncPolicy: "manual" as const }
  : createProductionScriptWorkspace(project, sourceDocuments);

/** Current screenplay projection used by planning. It intentionally never mutates the imported source documents. */
export const productionScriptDocumentsFromWorkspace = (
  workspace: ProductionScriptWorkspace | undefined,
  fallback: ProductionSourceDocument[],
): ProductionSourceDocument[] => {
  const current = currentProductionScriptRevision(workspace);
  if (!current) return fallback;
  return current.units
    .filter((unit) => unit.status === "current")
    .sort((left, right) => left.order - right.order)
    .map((unit, index) => ({
      id: unit.sourceDocumentId,
      order: index + 1,
      kind: unit.kind === "episode" ? "episode" : "segment",
      title: unit.title,
      summary: unit.summary,
      content: unit.content,
      sourceHash: unit.contentHash,
      targetDurationMinutes: unit.targetDurationMinutes,
      continuityMode: unit.continuityMode,
      isWorkRange: true,
      sourceWritingUnitId: unit.sourceWritingUnitId,
      originalSourceDocumentId: unit.originalSourceDocumentId,
      createdAt: unit.createdAt,
    }));
};

export interface ProductionScriptDraftInput {
  unitId?: string;
  sourceDocumentId?: string;
  sourceWritingUnitId?: string;
  kind?: ProductionCanonicalScriptUnitKind;
  insertAfterUnitId?: string;
  /** One-based target position for an existing unit. Stable ids never change. */
  targetOrder?: number;
  title: string;
  summary?: string;
  targetDurationMinutes?: number;
  continuityMode?: "continue" | "standalone";
  content: string;
  message?: string;
  revisionKind?: ProductionScriptRevision["kind"];
  /** A Writing-linked project must make this choice visible to the author. */
  writeMode?: "write_back" | "production_override";
}

export interface ProductionScriptMutation {
  workspace: ProductionScriptWorkspace;
  episodes: EpisodeMeta[];
  episodesToCreate: Episode[];
  targetEpisodeCount?: number;
  durationMinutes?: number;
  sourceDocumentsToAppend: ProductionSourceDocument[];
  affectedSourceDocumentIds: string[];
  productionScenePlans?: ProductionScenePlanVersion[];
}

const toEpisodeMeta = (unit: ProductionCanonicalScriptUnit, project: Project): EpisodeMeta => ({
  id: `prod_scope_${project.id}_${unit.sourceDocumentId}`,
  sourceDocumentId: unit.sourceDocumentId,
  sourceWritingUnitId: unit.sourceWritingUnitId,
  title: unit.title,
  inspiration: unit.summary || "",
  targetDuration: unit.targetDurationMinutes,
  sceneCount: 0,
});

const markPlansForReview = (plans: ProductionScenePlanVersion[] | undefined, documentIds: string[]) =>
  plans?.map((plan) => documentIds.includes(plan.sourceDocumentId) && plan.status === "adopted"
    ? { ...plan, sourceStatus: "needs_review" as const }
    : plan);

const markPlansStale = (plans: ProductionScenePlanVersion[] | undefined, documentIds: string[]) =>
  plans?.map((plan) => documentIds.includes(plan.sourceDocumentId) && plan.status === "adopted"
    ? { ...plan, sourceStatus: "stale" as const }
    : plan);

const movedUnitImpactDocumentIds = (
  units: ProductionCanonicalScriptUnit[],
  sourceDocumentId: string,
  fromOrder?: number,
  toOrder?: number,
) => {
  const start = Math.min(fromOrder || 0, toOrder || 0);
  const end = Math.max(fromOrder || 0, toOrder || 0);
  if (!start || !end) return [sourceDocumentId];
  return Array.from(new Set(units
    .filter((unit) => unit.order >= Math.max(1, start - 1) && unit.order <= end + 1)
    .map((unit) => unit.sourceDocumentId)));
};

/**
 * Creates a new immutable screenplay revision and projects only its active
 * units into the production work-range rail. Existing production scenes stay
 * intact; their plans are marked for review rather than being overwritten.
 */
export const saveProductionScriptDraft = (
  project: Project,
  workspace: ProductionScriptWorkspace,
  input: ProductionScriptDraftInput,
  now = Date.now(),
): ProductionScriptMutation => {
  const current = currentProductionScriptRevision(workspace);
  if (!current) throw new Error("当前项目没有可保存的剧本修订。");
  const normalizedTitle = text(input.title);
  if (!normalizedTitle) throw new Error("请填写剧集或段落标题。");
  const normalizedContent = String(input.content || "");
  const activeUnits = current.units.filter((unit) => unit.status === "current").map((unit) => ({ ...unit }));
  const archivedUnits = current.units.filter((unit) => unit.status !== "current").map((unit) => ({ ...unit }));
  const existingIndex = input.unitId ? activeUnits.findIndex((unit) => unit.id === input.unitId) : -1;
  if (input.unitId && existingIndex < 0 && archivedUnits.some((unit) => unit.id === input.unitId)) {
    throw new Error("要保存的剧本单元已经归档，请恢复后再编辑。");
  }
  const sourceDocumentId = input.sourceDocumentId || (existingIndex >= 0 ? activeUnits[existingIndex].sourceDocumentId : newId("prod_source"));
  const unitId = input.unitId || newId("prod_script_unit");
  const base = existingIndex >= 0 ? activeUnits[existingIndex] : undefined;
  const nextUnit: ProductionCanonicalScriptUnit = {
    id: unitId,
    sourceDocumentId,
    kind: input.kind || base?.kind || (project.type === "movie" ? "segment" : "episode"),
    order: base?.order || activeUnits.length + 1,
    title: normalizedTitle,
    summary: text(input.summary) || undefined,
    targetDurationMinutes: positiveNumber(input.targetDurationMinutes),
    continuityMode: input.continuityMode || base?.continuityMode,
    content: normalizedContent,
    contentHash: "",
    status: "current",
    sourceWritingUnitId: input.sourceWritingUnitId || base?.sourceWritingUnitId,
    originalSourceDocumentId: base?.originalSourceDocumentId,
    createdAt: base?.createdAt || now,
    updatedAt: now,
  };
  nextUnit.contentHash = unitHash(nextUnit);
  const requestedOrder = positiveNumber(input.targetOrder) ? Math.round(input.targetOrder!) : base?.order;
  if (base && base.contentHash === nextUnit.contentHash && requestedOrder === base.order) {
    // A double-click on formal save must not manufacture a second immutable
    // revision. The current revision is already the exact requested state.
    return {
      workspace,
      episodes: project.episodes,
      episodesToCreate: [],
      targetEpisodeCount: project.type === "movie" ? undefined : project.episodes.length,
      durationMinutes: project.durationMinutes,
      sourceDocumentsToAppend: [],
      affectedSourceDocumentIds: [],
      productionScenePlans: project.productionScenePlans,
    };
  }

  if (existingIndex >= 0 && positiveNumber(input.targetOrder)) {
    activeUnits.splice(existingIndex, 1);
    const targetIndex = Math.max(0, Math.min(activeUnits.length, Math.round(input.targetOrder!) - 1));
    activeUnits.splice(targetIndex, 0, nextUnit);
  } else if (existingIndex >= 0) {
    activeUnits.splice(existingIndex, 1, nextUnit);
  } else {
    const afterIndex = input.insertAfterUnitId
      ? activeUnits.findIndex((unit) => unit.id === input.insertAfterUnitId)
      : activeUnits.length - 1;
    activeUnits.splice(Math.max(0, afterIndex + 1), 0, nextUnit);
  }
  const currentActiveUnits = activeUnits.map((unit, index) => ({ ...unit, order: index + 1 }));
  const units = [...currentActiveUnits, ...archivedUnits];
  const savedUnit = currentActiveUnits.find((unit) => unit.id === unitId) || nextUnit;
  const isOverride = workspace.authority === "writing" && input.writeMode === "production_override";
  const revision = revisionFrom(units, {
    revision: current.revision + 1,
    kind: input.revisionKind || (isOverride ? "production_override" : "manual_edit"),
    authority: isOverride ? "production" : workspace.authority,
    message: text(input.message) || (existingIndex >= 0 ? `修改《${normalizedTitle}》` : `新增《${normalizedTitle}》`),
    createdAt: now,
  });
  const nextWorkspace: ProductionScriptWorkspace = {
    ...workspace,
    currentRevisionId: revision.id,
    revisions: [...workspace.revisions, revision],
    syncStatus: isOverride ? "conflict" : "current",
    updatedAt: now,
  };
  const existingEpisodeByDocumentId = new Map(project.episodes.map((episode) => [episode.sourceDocumentId, episode]));
  const episodesToCreate: Episode[] = [];
  const episodes = units.filter((unit) => unit.status === "current").map((unit) => {
    const existingEpisode = existingEpisodeByDocumentId.get(unit.sourceDocumentId);
    const meta = existingEpisode ? {
      ...existingEpisode,
      title: unit.title,
      inspiration: unit.summary || existingEpisode.inspiration,
      targetDuration: unit.targetDurationMinutes,
      sourceWritingUnitId: unit.sourceWritingUnitId || existingEpisode.sourceWritingUnitId,
    } : toEpisodeMeta(unit, project);
    if (!existingEpisode) episodesToCreate.push({ ...meta, scenes: [] });
    return meta;
  });
  const sourceDocumentsToAppend: ProductionSourceDocument[] = existingIndex >= 0 ? [] : [{
    id: sourceDocumentId,
    order: savedUnit.order,
    kind: nextUnit.kind === "episode" ? "episode" : "segment",
    title: nextUnit.title,
    summary: nextUnit.summary,
    // New author-created ranges have no pre-existing import evidence. The
    // immutable first revision remains available through the script workspace.
    content: "",
    sourceHash: sha256(""),
    targetDurationMinutes: nextUnit.targetDurationMinutes,
    continuityMode: nextUnit.continuityMode,
    isWorkRange: true,
    sourceWritingUnitId: nextUnit.sourceWritingUnitId,
    createdAt: now,
  }];
  const moved = existingIndex >= 0 && positiveNumber(input.targetOrder) && Math.round(input.targetOrder!) !== base?.order;
  const affectedSourceDocumentIds = moved
    ? movedUnitImpactDocumentIds(currentActiveUnits, sourceDocumentId, base?.order, input.targetOrder)
    : [sourceDocumentId];
  return {
    workspace: nextWorkspace,
    episodes,
    episodesToCreate,
    targetEpisodeCount: project.type === "movie" ? undefined : currentActiveUnits.length,
    durationMinutes: currentActiveUnits.reduce((total, unit) => total + (unit.targetDurationMinutes || 0), 0) || undefined,
    sourceDocumentsToAppend,
    affectedSourceDocumentIds,
    productionScenePlans: markPlansForReview(project.productionScenePlans, affectedSourceDocumentIds),
  };
};

/**
 * Hides an unplanned screenplay unit from the current production range without
 * deleting its episode record or any immutable script revision. A unit with
 * adopted production content must use the series change-order flow instead.
 */
export const archiveProductionScriptUnit = (
  project: Project,
  workspace: ProductionScriptWorkspace,
  unitId: string,
  now = Date.now(),
): ProductionScriptMutation => {
  const current = currentProductionScriptRevision(workspace);
  if (!current) throw new Error("当前项目没有可保存的剧本修订。");
  const target = current.units.find((unit) => unit.id === unitId);
  if (!target || target.status !== "current") throw new Error("找不到要归档的当前剧本单元。");
  let currentOrder = 0;
  const units = current.units
    .map((unit) => unit.id === unitId ? { ...unit, status: "archived" as const, updatedAt: now } : { ...unit })
    .map((unit) => unit.status === "current" ? { ...unit, order: ++currentOrder } : unit);
  const activeUnits = units.filter((unit) => unit.status === "current");
  const revision = revisionFrom(units, {
    revision: current.revision + 1,
    kind: "manual_edit",
    authority: workspace.authority,
    message: `归档《${target.title}》`,
    createdAt: now,
  });
  const affectedSourceDocumentIds = Array.from(new Set([
    target.sourceDocumentId,
    ...activeUnits.filter((unit) => Math.abs(unit.order - target.order) <= 1).map((unit) => unit.sourceDocumentId),
  ]));
  const existingEpisodeByDocumentId = new Map(project.episodes.map((episode) => [episode.sourceDocumentId, episode]));
  return {
    workspace: {
      ...workspace,
      currentRevisionId: revision.id,
      revisions: [...workspace.revisions, revision],
      updatedAt: now,
    },
    episodes: activeUnits.map((unit) => {
      const existing = existingEpisodeByDocumentId.get(unit.sourceDocumentId);
      return existing ? {
        ...existing,
        title: unit.title,
        inspiration: unit.summary || existing.inspiration,
        targetDuration: unit.targetDurationMinutes,
      } : toEpisodeMeta(unit, project);
    }),
    episodesToCreate: [],
    targetEpisodeCount: project.type === "movie" ? undefined : activeUnits.length,
    durationMinutes: activeUnits.reduce((total, unit) => total + (unit.targetDurationMinutes || 0), 0) || undefined,
    sourceDocumentsToAppend: [],
    affectedSourceDocumentIds,
    productionScenePlans: markPlansStale(project.productionScenePlans, affectedSourceDocumentIds),
  };
};

/** Restoring is itself a new revision so no previously saved screenplay is lost. */
export const restoreProductionScriptRevision = (
  project: Project,
  workspace: ProductionScriptWorkspace,
  revisionId: string,
  now = Date.now(),
): ProductionScriptMutation => {
  const target = workspace.revisions.find((revision) => revision.id === revisionId);
  const current = currentProductionScriptRevision(workspace);
  if (!target || !current) throw new Error("找不到要恢复的剧本版本。");
  if (target.id === current.id) throw new Error("当前已经是这个剧本版本。");
  let restoredOrder = 0;
  const units = target.units.map((unit) => {
    const restored = { ...clone(unit), updatedAt: now };
    return restored.status === "current"
      ? { ...restored, order: ++restoredOrder }
      : restored;
  });
  const revision = revisionFrom(units, {
    revision: current.revision + 1,
    kind: "restore",
    authority: workspace.authority,
    message: `恢复至修订 v${target.revision}`,
    createdAt: now,
  });
  const nextWorkspace: ProductionScriptWorkspace = {
    ...workspace,
    currentRevisionId: revision.id,
    revisions: [...workspace.revisions, revision],
    syncStatus: "current",
    updatedAt: now,
  };
  const existingEpisodeByDocumentId = new Map(project.episodes.map((episode) => [episode.sourceDocumentId, episode]));
  const episodesToCreate: Episode[] = [];
  const episodes = units.filter((unit) => unit.status === "current").map((unit) => {
    const existing = existingEpisodeByDocumentId.get(unit.sourceDocumentId);
    const meta = existing ? {
      ...existing,
      title: unit.title,
      inspiration: unit.summary || existing.inspiration,
      targetDuration: unit.targetDurationMinutes,
    } : toEpisodeMeta(unit, project);
    if (!existing) episodesToCreate.push({ ...meta, scenes: [] });
    return meta;
  });
  const existingSourceDocumentIds = new Set((project.productionSourceDocuments || []).map((document) => document.id));
  const sourceDocumentsToAppend: ProductionSourceDocument[] = units
    .filter((unit) => unit.status === "current" && !existingSourceDocumentIds.has(unit.sourceDocumentId))
    .map((unit) => ({
      id: unit.sourceDocumentId,
      order: unit.order,
      kind: unit.kind === "episode" ? "episode" : "segment",
      title: unit.title,
      summary: unit.summary,
      content: "",
      sourceHash: sha256(""),
      targetDurationMinutes: unit.targetDurationMinutes,
      continuityMode: unit.continuityMode,
      isWorkRange: true,
      sourceWritingUnitId: unit.sourceWritingUnitId,
      createdAt: now,
    }));
  const affectedSourceDocumentIds = Array.from(new Set([
    ...current.units.filter((unit) => unit.status === "current").map((unit) => unit.sourceDocumentId),
    ...units.filter((unit) => unit.status === "current").map((unit) => unit.sourceDocumentId),
  ]));
  return {
    workspace: nextWorkspace,
    episodes,
    episodesToCreate,
    targetEpisodeCount: project.type === "movie" ? undefined : episodes.length,
    durationMinutes: units.filter((unit) => unit.status === "current").reduce((total, unit) => total + (unit.targetDurationMinutes || 0), 0) || undefined,
    sourceDocumentsToAppend,
    affectedSourceDocumentIds,
    productionScenePlans: markPlansForReview(project.productionScenePlans, affectedSourceDocumentIds),
  };
};

export interface ProductionWritingScriptSyncChange {
  type: "unit_added" | "unit_updated" | "unit_moved" | "unit_archived";
  sourceWritingUnitId: string;
  title: string;
  sourceDocumentId: string;
  requiresReview: boolean;
}

export interface ProductionWritingScriptSyncPreview extends ProductionScriptMutation {
  changes: ProductionWritingScriptSyncChange[];
  blockedReason?: string;
  sourceExportedAt: number;
}

const writingUnitContent = (unit: ScriptExportPackage["units"][number]) => {
  if (text(unit.prose)) return text(unit.prose);
  return (unit.scenes || [])
    .flatMap((scene) => scene.blocks.map((block) => text(block.content)))
    .filter(Boolean)
    .join("\n");
};

const writingUnitDuration = (unit: ScriptExportPackage["units"][number]) => {
  const explicit = positiveNumber(unit.targetDurationMinutes);
  if (explicit) return explicit;
  const seconds = (unit.scenes || []).reduce((total, scene) => total + (
    positiveNumber(scene.targetDurationSeconds)
    || (positiveNumber(scene.targetDurationMinutes) ? positiveNumber(scene.targetDurationMinutes)! * 60 : 0)
  ), 0);
  return positiveNumber(seconds / 60);
};

const sourceDocumentHasProductionContent = (project: Project, sourceDocumentId: string) => {
  const episode = project.episodes.find((item) => item.sourceDocumentId === sourceDocumentId) as Episode | undefined;
  return Boolean(episode?.scenes?.length)
    || Number((episode as EpisodeMeta | undefined)?.sceneCount || 0) > 0
    || Boolean(project.productionScenePlans?.some((plan) => (
      plan.sourceDocumentId === sourceDocumentId && plan.status === "adopted"
    )));
};

/**
 * Produces a reversible Writing-to-Production sync proposal. It compares
 * stable Writing unit ids, never episode numbers or production scene ids.
 */
export const previewWritingScriptSync = (
  project: Project,
  workspace: ProductionScriptWorkspace,
  sourcePackage: ScriptExportPackage,
  now = Date.now(),
): ProductionWritingScriptSyncPreview => {
  if (workspace.authority !== "writing" || !workspace.writingProjectId) {
    throw new Error("当前制片项目不是由剧本工作台管理的剧本来源。");
  }
  if (workspace.writingProjectId !== sourcePackage.sourceWritingProjectId) {
    throw new Error("要同步的剧本项目与当前制片来源不一致。");
  }
  const current = currentProductionScriptRevision(workspace);
  if (!current) throw new Error("当前项目没有可同步的剧本修订。");
  if (workspace.syncStatus === "conflict") {
    return {
      workspace,
      episodes: project.episodes,
      episodesToCreate: [],
      sourceDocumentsToAppend: [],
      affectedSourceDocumentIds: [],
      productionScenePlans: project.productionScenePlans,
      changes: [],
      sourceExportedAt: sourcePackage.exportedAt,
      blockedReason: "当前项目存在仅制片改稿，请先处理改稿与剧本工作台版本的冲突。",
    };
  }
  const existingByWritingUnitId = new Map(current.units
    .filter((unit) => unit.sourceWritingUnitId)
    .map((unit) => [unit.sourceWritingUnitId!, unit]));
  const importedWritingUnitIds = new Set(sourcePackage.units.map((unit) => unit.id));
  const changes: ProductionWritingScriptSyncChange[] = [];
  const units = sourcePackage.units.map((sourceUnit, index) => {
    const existing = existingByWritingUnitId.get(sourceUnit.id);
    const content = writingUnitContent(sourceUnit);
    const candidate: ProductionCanonicalScriptUnit = {
      id: existing?.id || `prod_script_unit_${sourceUnit.id}`,
      sourceDocumentId: existing?.sourceDocumentId || `prod_source_${sourceUnit.id}`,
      kind: sourceUnit.kind === "sequence" ? "segment" : "episode",
      order: index + 1,
      title: sourceUnit.title || `剧本单元 ${index + 1}`,
      summary: sourceUnit.summary || undefined,
      targetDurationMinutes: writingUnitDuration(sourceUnit),
      continuityMode: sourceUnit.continuityMode,
      content,
      contentHash: "",
      status: "current",
      sourceWritingUnitId: sourceUnit.id,
      originalSourceDocumentId: existing?.originalSourceDocumentId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    candidate.contentHash = unitHash(candidate);
    const hasContentChange = Boolean(existing && existing.contentHash !== candidate.contentHash);
    const hasMove = Boolean(existing && existing.order !== candidate.order);
    if (!existing) {
      changes.push({ type: "unit_added", sourceWritingUnitId: sourceUnit.id, title: candidate.title, sourceDocumentId: candidate.sourceDocumentId, requiresReview: false });
    } else {
      const requiresReview = sourceDocumentHasProductionContent(project, candidate.sourceDocumentId);
      if (hasContentChange) {
        changes.push({ type: "unit_updated", sourceWritingUnitId: sourceUnit.id, title: candidate.title, sourceDocumentId: candidate.sourceDocumentId, requiresReview });
      }
      if (hasMove) {
        changes.push({ type: "unit_moved", sourceWritingUnitId: sourceUnit.id, title: candidate.title, sourceDocumentId: candidate.sourceDocumentId, requiresReview });
      }
    }
    return candidate;
  });
  current.units.filter((unit) => unit.status === "current" && unit.sourceWritingUnitId && !importedWritingUnitIds.has(unit.sourceWritingUnitId)).forEach((unit) => {
    changes.push({
      type: "unit_archived",
      sourceWritingUnitId: unit.sourceWritingUnitId!,
      title: unit.title,
      sourceDocumentId: unit.sourceDocumentId,
      requiresReview: sourceDocumentHasProductionContent(project, unit.sourceDocumentId),
    });
  });
  if (!changes.length) {
    return {
      workspace,
      episodes: project.episodes,
      episodesToCreate: [],
      sourceDocumentsToAppend: [],
      affectedSourceDocumentIds: [],
      productionScenePlans: project.productionScenePlans,
      changes,
      sourceExportedAt: sourcePackage.exportedAt,
    };
  }
  const revision = revisionFrom(units, {
    revision: current.revision + 1,
    kind: "writing_sync",
    authority: "writing",
    message: `同步剧本工作台更新（${changes.length} 处）`,
    createdAt: now,
  });
  const nextWorkspace: ProductionScriptWorkspace = {
    ...workspace,
    currentRevisionId: revision.id,
    revisions: [...workspace.revisions, revision],
    syncStatus: "current",
    updatedAt: now,
  };
  const existingEpisodeByDocumentId = new Map(project.episodes.map((episode) => [episode.sourceDocumentId, episode]));
  const episodesToCreate: Episode[] = [];
  const episodes = units.map((unit) => {
    const existing = existingEpisodeByDocumentId.get(unit.sourceDocumentId);
    const meta = existing ? {
      ...existing,
      title: unit.title,
      inspiration: unit.summary || existing.inspiration,
      targetDuration: unit.targetDurationMinutes,
      sourceWritingUnitId: unit.sourceWritingUnitId,
    } : toEpisodeMeta(unit, project);
    if (!existing) episodesToCreate.push({ ...meta, scenes: [] });
    return meta;
  });
  const existingSourceDocumentIds = new Set((project.productionSourceDocuments || []).map((document) => document.id));
  const sourceDocumentsToAppend: ProductionSourceDocument[] = units
    .filter((unit) => !existingSourceDocumentIds.has(unit.sourceDocumentId))
    .map((unit) => ({
      id: unit.sourceDocumentId,
      order: unit.order,
      kind: unit.kind === "episode" ? "episode" : "segment",
      title: unit.title,
      summary: unit.summary,
      content: unit.content,
      sourceHash: unit.contentHash,
      targetDurationMinutes: unit.targetDurationMinutes,
      continuityMode: unit.continuityMode,
      isWorkRange: true,
      sourceWritingUnitId: unit.sourceWritingUnitId,
      createdAt: now,
    }));
  const affectedSourceDocumentIds = new Set(changes
    .filter((change) => change.type === "unit_updated" || change.type === "unit_archived")
    .map((change) => change.sourceDocumentId));
  // A reordered unit changes the handoff on both sides of its new boundary.
  // Preserve all existing material, but surface only those neighboring plans
  // for review instead of invalidating the whole season.
  changes.filter((change) => change.type === "unit_moved").forEach((change) => {
    const index = units.findIndex((unit) => unit.sourceDocumentId === change.sourceDocumentId);
    [units[index - 1], units[index], units[index + 1]]
      .filter((unit): unit is ProductionCanonicalScriptUnit => Boolean(unit))
      .forEach((unit) => affectedSourceDocumentIds.add(unit.sourceDocumentId));
  });
  changes.filter((change) => change.type === "unit_added").forEach((change) => {
    const index = units.findIndex((unit) => unit.sourceDocumentId === change.sourceDocumentId);
    if (index < 0) return;
    const previousExisting = units.slice(0, index).reverse()
      .find((unit) => Boolean(unit.sourceWritingUnitId && existingByWritingUnitId.has(unit.sourceWritingUnitId)));
    const followingExisting = units.slice(index + 1)
      .find((unit) => Boolean(unit.sourceWritingUnitId && existingByWritingUnitId.has(unit.sourceWritingUnitId)));
    // Tail additions do not rewrite an existing handoff. Insertion between two
    // existing units does, so only that local boundary becomes review-only.
    if (previousExisting && followingExisting) {
      affectedSourceDocumentIds.add(previousExisting.sourceDocumentId);
      affectedSourceDocumentIds.add(followingExisting.sourceDocumentId);
    }
  });
  return {
    workspace: nextWorkspace,
    episodes,
    episodesToCreate,
    targetEpisodeCount: project.type === "movie" ? undefined : episodes.length,
    durationMinutes: units.reduce((total, unit) => total + (unit.targetDurationMinutes || 0), 0) || undefined,
    sourceDocumentsToAppend,
    affectedSourceDocumentIds: Array.from(affectedSourceDocumentIds),
    productionScenePlans: markPlansForReview(project.productionScenePlans, Array.from(affectedSourceDocumentIds)),
    changes,
    sourceExportedAt: sourcePackage.exportedAt,
  };
};

/** Keeps the production revision independent. It never overwrites the authoring project. */
export const resolveProductionScriptConflictKeepingProduction = (
  project: Project,
  workspace: ProductionScriptWorkspace,
  now = Date.now(),
): ProductionScriptMutation => {
  if (workspace.authority !== "writing" || !workspace.writingProjectId || workspace.syncStatus !== "conflict") {
    throw new Error("当前项目没有需要处理的制片改稿冲突。");
  }
  const current = currentProductionScriptRevision(workspace);
  if (!current) throw new Error("当前项目没有可解决冲突的正式剧本修订。");
  const units = current.units.map((unit) => ({
    ...clone(unit),
    sourceWritingUnitId: unit.sourceWritingUnitId || unit.id,
    updatedAt: now,
  }));
  const revision = revisionFrom(units, {
    revision: current.revision + 1,
    kind: "manual_edit",
    authority: "production",
    message: "保留制片改稿，解除源剧本自动同步",
    createdAt: now,
  });
  const activeUnits = units.filter((unit) => unit.status === "current").sort((left, right) => left.order - right.order);
  const existingEpisodeByDocumentId = new Map(project.episodes.map((episode) => [episode.sourceDocumentId, episode]));
  return {
    workspace: {
      ...workspace,
      currentRevisionId: revision.id,
      revisions: [...workspace.revisions, revision],
      syncStatus: "current",
      authority: "production",
      syncPolicy: "manual",
      writingProjectId: undefined,
      updatedAt: now,
    },
    episodes: activeUnits.map((unit) => {
      const existing = existingEpisodeByDocumentId.get(unit.sourceDocumentId);
      return existing ? {
        ...existing,
        title: unit.title,
        inspiration: unit.summary || existing.inspiration,
        targetDuration: unit.targetDurationMinutes,
        sourceWritingUnitId: unit.sourceWritingUnitId,
      } : toEpisodeMeta(unit, project);
    }),
    episodesToCreate: [],
    targetEpisodeCount: project.type === "movie" ? undefined : activeUnits.length,
    durationMinutes: activeUnits.reduce((total, unit) => total + (unit.targetDurationMinutes || 0), 0) || undefined,
    sourceDocumentsToAppend: [],
    affectedSourceDocumentIds: activeUnits.map((unit) => unit.sourceDocumentId),
    productionScenePlans: project.productionScenePlans,
  };
};

export const productionScriptPlanNeedsReview = (
  plan: ProductionScenePlanVersion | undefined,
) => plan?.sourceStatus === "needs_review" || plan?.sourceStatus === "stale";
