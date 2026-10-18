import { sha256 } from "js-sha256";

import type { ScriptExportPackage } from "../../../packages/domain/src/scriptDelivery";
import type { EpisodeMeta, ProductionSourceDocument, Project, Scene } from "../../types/project";
import { productionScriptDocumentsFromWorkspace } from "./productionScriptWorkspace";

const text = (value: unknown) => String(value || "").trim();
const positiveMinutes = (value: unknown) => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
};
type ScriptExportUnit = ScriptExportPackage["units"][number];
type ScriptExportUnitDurationInput = {
  targetDurationMinutes?: unknown;
  scenes?: readonly {
    targetDurationSeconds?: unknown;
    targetDurationMinutes?: unknown;
  }[];
};

const scriptExportUnitDurationMinutes = (unit: ScriptExportUnitDurationInput) => {
  const explicitDuration = positiveMinutes(unit.targetDurationMinutes);
  if (explicitDuration) return explicitDuration;
  const durationSeconds = (unit.scenes || []).reduce((sum, scene) => {
    const seconds = positiveMinutes(scene.targetDurationSeconds)
      || (positiveMinutes(scene.targetDurationMinutes) ? positiveMinutes(scene.targetDurationMinutes)! * 60 : 0);
    return sum + (seconds || 0);
  }, 0);
  return positiveMinutes(durationSeconds / 60);
};

const writingUnitContent = (unit: ScriptExportUnit) => {
  if (text(unit.prose)) return text(unit.prose);
  return (unit.scenes || [])
    .flatMap((scene) => scene.blocks.map((block) => text(block.content)))
    .filter(Boolean)
    .join("\n");
};

export const createWritingSourceDocuments = (
  sourcePackage: ScriptExportPackage,
  createdAt = Date.now(),
): ProductionSourceDocument[] => sourcePackage.units
  .map((unit) => ({ unit, content: writingUnitContent(unit) }))
  .filter(({ content }) => Boolean(content))
  .map(({ unit, content }, index) => ({
    id: `prod_source_${unit.id}`,
    order: index + 1,
    kind: unit.kind === "sequence" ? "segment" : "episode",
    title: unit.title || `来源单元 ${index + 1}`,
    summary: unit.summary || undefined,
    content,
    sourceHash: sha256(content),
    targetDurationMinutes: scriptExportUnitDurationMinutes(unit),
    continuityMode: unit.continuityMode,
    sourceWritingUnitId: unit.id,
    createdAt,
  }));

const legacyMagicDocument = (project: Project): ProductionSourceDocument[] => {
  const payload = project.productionSourceSnapshot?.sourceType === "magic_import"
    ? project.productionSourceSnapshot.payload
    : undefined;
  const content = text(payload?.sourceText);
  if (!content) return [];
  return [{
    id: "prod_source_magic_legacy",
    order: 1,
    kind: "whole",
    title: "完整来源剧本",
    content,
    sourceHash: sha256(content),
    targetDurationMinutes: positiveMinutes(project.durationMinutes),
    createdAt: project.productionSourceSnapshot?.importedAt || Date.now(),
  }];
};

/** Returns persisted documents first, then a read-only projection for legacy projects. */
export const productionSourceDocumentsForProject = (project: Project): ProductionSourceDocument[] => {
  const importedDocuments = project.productionSourceDocuments?.length
    ? [...project.productionSourceDocuments].sort((left, right) => left.order - right.order)
    : project.productionSourceSnapshot?.sourceType === "writing_export"
      ? createWritingSourceDocuments(project.productionSourceSnapshot.package as ScriptExportPackage, project.productionSourceSnapshot.importedAt)
      : legacyMagicDocument(project);
  // A script workspace is the current author-approved screenplay. The import
  // documents remain untouched so version history can always show the source.
  return project.productionScriptWorkspace
    ? productionScriptDocumentsFromWorkspace(project.productionScriptWorkspace, importedDocuments)
    : importedDocuments;
};

/** Documents eligible for production scene planning. */
export const productionWorkSourceDocumentsForProject = (project: Project) => productionSourceDocumentsForProject(project)
  .filter((document) => document.isWorkRange !== false);

export const productionSourceDocumentForEpisode = (
  project: Project,
  episode?: Pick<EpisodeMeta, "sourceDocumentId"> & Partial<Pick<EpisodeMeta, "id" | "sourceWritingUnitId">> & {
    scenes?: readonly Pick<Scene, "sourceDocumentId" | "sourceWritingUnitId">[];
  } | null,
) => {
  const documents = productionWorkSourceDocumentsForProject(project);
  if (!documents.length) return undefined;
  if (!episode) return documents.length === 1 ? documents[0] : undefined;

  if (episode.sourceDocumentId) {
    return documents.find((document) => document.id === episode.sourceDocumentId);
  }

  const sourceDocumentIds = new Set((episode.scenes || [])
    .map((scene) => scene.sourceDocumentId)
    .filter((id): id is string => Boolean(id)));
  if (sourceDocumentIds.size === 1) {
    return documents.find((document) => sourceDocumentIds.has(document.id));
  }

  const sourceWritingUnitIds = new Set([
    episode.sourceWritingUnitId,
    ...(episode.scenes || []).map((scene) => scene.sourceWritingUnitId),
  ].filter((id): id is string => Boolean(id)));
  if (sourceWritingUnitIds.size === 1) {
    return documents.find((document) => Boolean(
      document.sourceWritingUnitId && sourceWritingUnitIds.has(document.sourceWritingUnitId),
    ));
  }

  // Legacy Writing imports encoded the source unit in the production episode id
  // before sourceDocumentId was persisted. Keep that deterministic provenance
  // readable without guessing by title, order, or content.
  const legacyDocument = documents.find((document) => Boolean(
    document.sourceWritingUnitId
    && (episode.id === `prod_episode_${document.sourceWritingUnitId}` || episode.id === `prod_scope_${document.id}`),
  ));
  if (legacyDocument) return legacyDocument;

  return documents.length === 1 ? documents[0] : undefined;
};

export const productionSourceTargetDurationMinutes = (
  project: Project,
  document?: Pick<ProductionSourceDocument, "id" | "sourceWritingUnitId" | "targetDurationMinutes">,
) => {
  const documentDuration = positiveMinutes(document?.targetDurationMinutes);
  if (documentDuration) return documentDuration;

  if (project.productionSourceSnapshot?.sourceType === "writing_export" && document?.sourceWritingUnitId) {
    const sourceUnit = project.productionSourceSnapshot.package.units.find((unit) => unit.id === document.sourceWritingUnitId);
    const sourceDuration = sourceUnit ? scriptExportUnitDurationMinutes(sourceUnit) : undefined;
    if (sourceDuration) return sourceDuration;
  }

  const episodeDuration = positiveMinutes(project.episodes.find((episode) => episode.sourceDocumentId === document?.id)?.targetDuration);
  if (episodeDuration) return episodeDuration;

  const documents = productionWorkSourceDocumentsForProject(project);
  return documents.length === 1 ? positiveMinutes(project.durationMinutes) : undefined;
};

export const productionFullScriptText = (project: Project) => productionWorkSourceDocumentsForProject(project)
  .map((document) => `【${document.title}】\n${document.content}`)
  .join("\n\n");

const adoptedScenePlanForDocument = (project: Project, sourceDocumentId: string) => project.productionScenePlans
  ?.filter((plan) => plan.sourceDocumentId === sourceDocumentId && plan.status === "adopted")
  .sort((left, right) => right.adoptedAt - left.adoptedAt)[0];

const boundarySceneFacts = (
  project: Project,
  sourceDocumentId: string,
  edge: "start" | "end",
) => {
  const episode = project.episodes.find((item) => item.sourceDocumentId === sourceDocumentId) as (EpisodeMeta & { scenes?: Scene[] }) | undefined;
  const scenes = episode?.scenes || [];
  const scene = edge === "start" ? scenes[0] : scenes[scenes.length - 1];
  if (!scene) return "";
  const breakdown = scene.breakdown;
  return JSON.stringify({
    title: scene.title,
    timeOfDay: scene.timeOfDay || breakdown?.time || "",
    location: breakdown?.location || null,
    characters: breakdown?.characters || [],
    props: breakdown?.props || [],
    wardrobe: breakdown?.wardrobe || [],
    makeupHair: breakdown?.makeupHair || [],
  }, null, 2);
};

/**
 * Keeps department preparation focused on the active source unit while still
 * exposing the adjacent handoff facts needed for cross-unit continuity.
 */
export const productionDepartmentContinuityContext = (
  project: Project,
  sourceDocumentId?: string,
) => {
  const documents = productionWorkSourceDocumentsForProject(project);
  const activeIndex = documents.findIndex((document) => document.id === sourceDocumentId);
  if (activeIndex < 0) return "";
  if (documents[activeIndex]?.continuityMode === "standalone") {
    return "当前是独立单集：复用项目级人物、地点、道具和风格资产，但不读取相邻剧集剧情、关系进度、伏笔或结尾作为制片连续性。";
  }

  const previousDocument = documents[activeIndex - 1];
  const nextDocument = documents[activeIndex + 1];
  const sections: string[] = [];

  if (previousDocument) {
    const adoptedPlan = adoptedScenePlanForDocument(project, previousDocument.id);
    const finalSceneFacts = boundarySceneFacts(project, previousDocument.id, "end");
    const continuityHandoffs = adoptedPlan?.candidateScenes
      .filter((scene) => text(scene.continuityOut))
      .map((scene) => `${scene.order}. ${scene.title}：${text(scene.continuityOut)}`) || [];
    const finalCandidate = adoptedPlan?.candidateScenes[adoptedPlan.candidateScenes.length - 1];
    const previousContext = [
      `【前一制片单元：${previousDocument.title}】`,
      adoptedPlan
        ? [
          continuityHandoffs.length ? `已确认出场承接：\n${continuityHandoffs.join("\n")}` : "",
          finalCandidate ? `最终场次摘要：${finalCandidate.title}｜${finalCandidate.description}` : "",
        ].filter(Boolean).join("\n")
        : "",
      finalSceneFacts
        ? `最终正式场次结构化状态：\n${finalSceneFacts}`
        : "",
    ].filter(Boolean).join("\n\n");
    if (previousContext !== `【前一制片单元：${previousDocument.title}】`) sections.push(previousContext);
  }

  if (nextDocument) {
    const adoptedPlan = adoptedScenePlanForDocument(project, nextDocument.id);
    const firstCandidate = adoptedPlan?.candidateScenes[0];
    const initialSceneFacts = boundarySceneFacts(project, nextDocument.id, "start");
    const nextContext = [
      `【后一制片单元连续性参考：${nextDocument.title}】`,
      firstCandidate
        ? `开场场次摘要：${firstCandidate.title}｜${firstCandidate.description}`
        : "",
      initialSceneFacts
        ? `开场正式场次结构化状态：\n${initialSceneFacts}`
        : "",
    ].filter(Boolean).join("\n\n");
    if (nextContext !== `【后一制片单元连续性参考：${nextDocument.title}】`) {
      sections.push(nextContext);
    }
  }

  if (!sections.length) return "";

  return [
    "这里只提供当前制片单元边界处的只读连续性事实。不得把相邻单元内容扩写为当前单元场次，也不得覆盖当前完整剧本和已确认拆解。",
    ...sections,
  ].join("\n\n");
};

export const productionScenePlanContinuityContext = (
  project: Project,
  sourceDocumentId: string,
) => {
  const documents = productionWorkSourceDocumentsForProject(project);
  const activeIndex = documents.findIndex((document) => document.id === sourceDocumentId);
  if (activeIndex < 0) return "";
  if (documents[activeIndex]?.continuityMode === "standalone") {
    return "当前是独立单集：场次规划只依据本集正文；继续复用项目级人物、地点、道具和风格资产，不承接相邻剧集剧情。";
  }

  const priorDocuments = documents.slice(0, activeIndex);
  const followingDocuments = documents.slice(activeIndex + 1);
  const sections: string[] = [];

  if (priorDocuments.length) {
    const priorPlanSummaries = priorDocuments.map((document) => {
      const adoptedPlan = adoptedScenePlanForDocument(project, document.id);
      if (!adoptedPlan) return "";
      return [
        `【${document.title}】`,
        ...adoptedPlan.candidateScenes.map((scene) => [
          `${scene.order}. ${scene.title}`,
          scene.description,
          scene.continuityOut ? `出场承接：${scene.continuityOut}` : "",
        ].filter(Boolean).join("\n")),
      ].join("\n\n");
    }).filter(Boolean);
    if (priorPlanSummaries.length) {
      sections.push([
        "【当前范围之前的已确认场次连续性】",
        ...priorPlanSummaries,
      ].join("\n\n"));
    }
  }

  if (followingDocuments.length) {
    sections.push([
      "【当前范围之后的来源标题】",
      ...followingDocuments.map((document) => `- ${document.title}`),
      "后续范围正文不参与本次场次划分。",
    ].join("\n"));
  }

  if (!sections.length) return "";

  return [
    "以下内容只用于判断当前来源工作范围的入场连续性和出场衔接，不得据此创建当前范围以外的场次。",
    ...sections,
  ].join("\n\n");
};
