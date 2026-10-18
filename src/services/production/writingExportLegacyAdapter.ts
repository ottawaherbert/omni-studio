import { sha256 } from "js-sha256";

import type { ScriptExportPackage } from "../../../packages/domain/src/scriptDelivery";
import { createProductionProjectFromScriptExport } from "./scriptImport";
import type {
  Character,
  DeepReadonly,
  Episode,
  Project,
  ProductionScriptSourceSnapshot,
  Scene,
  ScriptBlock,
} from "../../types/project";
import { createWritingSourceDocuments } from "./productionSourceDocuments";
import { createProductionScriptWorkspace } from "./productionScriptWorkspace";
import {
  productionAssetsFromWritingLore,
  productionCharacterIdForWritingEntity,
} from "./narrativeEntityMerge";

export interface CreateLegacyProductionFromWritingExportInput {
  package: ScriptExportPackage;
  productionProjectId: string;
  importId: string;
  importedAt?: number;
}

type ImportedProject = ReturnType<typeof createProductionProjectFromScriptExport>["project"];
type ImportedEpisode = ImportedProject["episodes"][number];
type ImportedScene = ImportedEpisode["scenes"][number];
type ScriptExportUnit = ScriptExportPackage["units"][number];
type ScriptExportScene = NonNullable<ScriptExportUnit["scenes"]>[number];

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const deepFreeze = <T,>(value: T): DeepReadonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item));
  }
  return value as DeepReadonly<T>;
};

const toLegacyBlock = (block: ImportedScene["scriptBlocks"][number]): ScriptBlock => ({
  id: block.id,
  type: block.type === "prose" ? "action" : block.type,
  content: block.content,
  acting: block.acting,
  emotion: block.emotion,
});

const sceneDurationMinutes = (scene?: ScriptExportScene) =>
  scene?.targetDurationMinutes
  ?? (scene?.targetDurationSeconds === undefined ? undefined : scene.targetDurationSeconds / 60);

const unitHasScriptContent = (unit: ScriptExportUnit) => Boolean(
  unit.prose?.trim()
  || unit.scenes?.some((scene) => scene.blocks.some((block) => block.content.trim())),
);

const toLegacyScene = (
  importedScene: ImportedScene,
  sourceScene?: ScriptExportScene,
  sourceDocumentId?: string,
): Scene => ({
  id: importedScene.id,
  sourceWritingUnitId: importedScene.sourceUnitId,
  sourceWritingSceneId: importedScene.sourceSceneId,
  sourceDocumentId,
  sceneNumber: String(importedScene.index),
  title: importedScene.title,
  description: importedScene.synopsis,
  valueCharge: sourceScene?.valueCharge || "neutral",
  valueShift: sourceScene?.valueShift ? { ...sourceScene.valueShift } : undefined,
  hook: sourceScene?.hook,
  cliffhanger: sourceScene?.cliffhanger,
  targetDuration: sceneDurationMinutes(sourceScene),
  script: importedScene.sourceText,
  scriptBlocks: importedScene.scriptBlocks.map(toLegacyBlock),
  sceneGoal: sourceScene?.goal || sourceScene?.purpose,
  sceneAssets: sourceScene?.sceneAssets?.join("、"),
  timeOfDay: sourceScene?.timeText,
});

const toLegacyEpisode = (
  importedEpisode: ImportedEpisode,
  sourceUnit: ScriptExportUnit,
  sourceDocumentId: string,
): Episode => {
  const sourceScenes = new Map((sourceUnit.scenes || []).map((scene) => [scene.id, scene]));
  const scenes = importedEpisode.scenes.map((scene) =>
    toLegacyScene(scene, scene.sourceSceneId ? sourceScenes.get(scene.sourceSceneId) : undefined, sourceDocumentId));
  const targetDuration = scenes.reduce((sum, scene) => sum + (scene.targetDuration || 0), 0);
  return {
    id: importedEpisode.id,
    sourceWritingUnitId: sourceUnit.id,
    sourceDocumentId,
    title: importedEpisode.title,
    inspiration: importedEpisode.summary,
    targetDuration: targetDuration || undefined,
    scenes,
  };
};

const toLegacyCharacter = (character: ScriptExportPackage["characters"][number]): Character => ({
  id: productionCharacterIdForWritingEntity(character.id),
  name: character.name,
  psychologicalProfile: [character.bio, character.psychologicalProfile].filter(Boolean).join("\n") || undefined,
  mbti: character.mbti,
  enneagram: character.enneagram,
  actingStyle: character.actingStyle,
});

export const createWritingSourceSnapshot = (
  sourcePackage: ScriptExportPackage,
  importId: string,
  importedAt: number,
): ProductionScriptSourceSnapshot => {
  const packageCopy = cloneJson(sourcePackage);
  return deepFreeze({
    schemaVersion: "production-script-source-snapshot.v1",
    sourceType: "writing_export",
    importId,
    sourceWritingProjectId: sourcePackage.sourceWritingProjectId,
    sourceExportedAt: sourcePackage.exportedAt,
    importedAt,
    sourceHash: sha256(JSON.stringify(packageCopy)),
    package: packageCopy,
  });
};

export const createLegacyProductionProjectFromWritingExport = (
  input: CreateLegacyProductionFromWritingExportInput,
): Project => {
  const importedAt = input.importedAt ?? Date.now();
  const imported = createProductionProjectFromScriptExport({
    package: input.package,
    productionProjectId: input.productionProjectId,
    importId: input.importId,
    importedAt,
  }).project;
  const unitsById = new Map(input.package.units.map((unit) => [unit.id, unit]));
  const sourceDocuments = createWritingSourceDocuments(input.package, importedAt);
  const sourceDocumentsByWritingUnitId = new Map(sourceDocuments
    .filter((document) => document.sourceWritingUnitId)
    .map((document) => [document.sourceWritingUnitId!, document]));
  const episodes = imported.episodes.filter((episode) => {
    const sourceUnit = unitsById.get(episode.sourceUnitId);
    return Boolean(sourceUnit && unitHasScriptContent(sourceUnit));
  }).map((episode) => {
    const sourceUnit = unitsById.get(episode.sourceUnitId);
    if (!sourceUnit) throw new Error(`Writing export unit ${episode.sourceUnitId} is missing`);
    const sourceDocument = sourceDocumentsByWritingUnitId.get(sourceUnit.id);
    if (!sourceDocument) throw new Error(`Production source document for Writing unit ${sourceUnit.id} is missing`);
    return toLegacyEpisode(episode, sourceUnit, sourceDocument.id);
  });
  const durationMinutes = episodes.reduce((sum, episode) => sum + (episode.targetDuration || 0), 0);

  const project: Project = {
    id: imported.id,
    title: imported.title,
    type: imported.format,
    workType: input.package.workType,
    durationMinutes: durationMinutes || undefined,
    projectModel: "linear",
    aspectRatio: input.package.aspectRatio
      ?? (imported.format === "short-drama" || imported.format === "micro-short-drama" ? "9:16" : "16:9"),
    logline: "",
    coreConflict: "",
    targetEpisodeCount: episodes.length,
    creativeVision: {
      genre: [],
      visualStyle: input.package.styleGuide.imagery || "",
      narrativeStyle: [input.package.styleGuide.voice, input.package.styleGuide.pacing, input.package.styleGuide.dialogue]
        .filter(Boolean)
        .join("\n"),
      referenceWorks: input.package.styleGuide.referenceNotes?.join("、") || "",
    },
    characters: input.package.characters.map(toLegacyCharacter),
    episodes,
    assets: productionAssetsFromWritingLore(input.package.lore),
    productionSourceSnapshot: createWritingSourceSnapshot(input.package, input.importId, importedAt),
    productionSourceDocuments: sourceDocuments,
  };
  return {
    ...project,
    productionScriptWorkspace: createProductionScriptWorkspace(project, sourceDocuments, importedAt),
  };
};

/**
 * New director-production imports keep Writing units as read-only source ranges.
 * Production scenes are created later by the author's adopted scene plan.
 */
export const createLegacyProductionProjectFromWritingSource = (
  input: CreateLegacyProductionFromWritingExportInput,
): Project => {
  const importedAt = input.importedAt ?? Date.now();
  const sourceDocuments = createWritingSourceDocuments(input.package, importedAt);
  const episodes: Episode[] = sourceDocuments.map((document) => ({
    // Episodes are globally keyed in the legacy persistence table. A source
    // document can be prepared by more than one production project, so its
    // source id alone must not become the persisted episode id.
    id: `prod_scope_${input.productionProjectId}_${document.id}`,
    sourceWritingUnitId: document.sourceWritingUnitId,
    sourceDocumentId: document.id,
    title: document.title,
    inspiration: "",
    targetDuration: document.targetDurationMinutes,
    scenes: [],
  }));
  const durationMinutes = sourceDocuments.reduce((sum, document) => sum + (document.targetDurationMinutes || 0), 0);
  const project: Project = {
    id: input.productionProjectId,
    title: input.package.title,
    type: input.package.format,
    workType: input.package.workType,
    durationMinutes: durationMinutes || undefined,
    projectModel: "linear",
    aspectRatio: input.package.aspectRatio
      ?? (input.package.format === "short-drama" || input.package.format === "micro-short-drama" ? "9:16" : "16:9"),
    logline: "",
    coreConflict: "",
    targetEpisodeCount: input.package.format === "movie" ? undefined : sourceDocuments.length,
    creativeVision: {
      genre: [],
      visualStyle: input.package.styleGuide.imagery || "",
      narrativeStyle: [input.package.styleGuide.voice, input.package.styleGuide.pacing, input.package.styleGuide.dialogue]
        .filter(Boolean)
        .join("\n"),
      referenceWorks: input.package.styleGuide.referenceNotes?.join("、") || "",
    },
    characters: input.package.characters.map(toLegacyCharacter),
    episodes,
    assets: productionAssetsFromWritingLore(input.package.lore),
    productionSourceSnapshot: createWritingSourceSnapshot(input.package, input.importId, importedAt),
    productionSourceDocuments: sourceDocuments,
    productionScenePlans: [],
  };
  return {
    ...project,
    productionScriptWorkspace: createProductionScriptWorkspace(project, sourceDocuments, importedAt),
  };
};
