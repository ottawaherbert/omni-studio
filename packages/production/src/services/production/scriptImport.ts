import type {
  ProductionImportedEpisode,
  ProductionImportedScene,
  ProductionImportedScriptBlock,
  ProductionImportedScriptProject,
  ProductionScriptReimportChange,
  ProductionScriptReimportPreview,
  ProductionScriptImportReport,
} from "../../domains/production";
import type {
  ScriptExportPackage,
  ScriptExportScene,
  ScriptExportUnit,
  ScriptDeliveryBlock,
} from "../../../../domain/src/scriptDelivery";

export interface CreateProductionFromScriptExportInput {
  package: ScriptExportPackage;
  productionProjectId: string;
  importId: string;
  importedAt?: number;
}

export interface ProductionScriptImportResult {
  project: ProductionImportedScriptProject;
  report: ProductionScriptImportReport;
}

const blockText = (blocks: ScriptDeliveryBlock[]) =>
  blocks.map((block) => block.content.trim()).filter(Boolean).join("\n");

const copyBlock = (block: ScriptDeliveryBlock): ProductionImportedScriptBlock => ({
  id: block.id,
  type: block.type,
  content: block.content,
  acting: block.acting,
  emotion: block.emotion,
});

const importScene = (
  unit: ScriptExportUnit,
  scene: ScriptExportScene,
): ProductionImportedScene => ({
  id: `prod_scene_${scene.id}`,
  sourceUnitId: unit.id,
  sourceSceneId: scene.id,
  index: scene.index,
  title: scene.title,
  synopsis: scene.synopsis,
  characters: [...scene.characters],
  scriptBlocks: scene.blocks.map(copyBlock),
  sourceText: blockText(scene.blocks) || scene.synopsis,
});

const proseScene = (unit: ScriptExportUnit): ProductionImportedScene => ({
  id: `prod_scene_${unit.id}_prose`,
  sourceUnitId: unit.id,
  index: 1,
  title: unit.title,
  synopsis: unit.summary,
  characters: [],
  scriptBlocks: unit.prose ? [{ id: `block_${unit.id}_prose`, type: "prose", content: unit.prose }] : [],
  sourceText: unit.prose || unit.summary,
});

const importEpisode = (unit: ScriptExportUnit): ProductionImportedEpisode => ({
  id: `prod_episode_${unit.id}`,
  sourceUnitId: unit.id,
  index: unit.index,
  title: unit.title,
  summary: unit.summary,
  scenes: unit.scenes?.length ? unit.scenes.map((scene) => importScene(unit, scene)) : [proseScene(unit)],
  prose: unit.prose,
});

const sourceText = (episode: ProductionImportedEpisode) => [
  episode.title,
  episode.summary,
  episode.prose,
  ...episode.scenes.map((scene) => [scene.title, scene.synopsis, scene.sourceText].join("\n")),
].filter(Boolean).join("\n").replace(/\s+/g, " ").trim();

const sceneText = (scene: ProductionImportedScene) =>
  [scene.title, scene.synopsis, scene.sourceText].filter(Boolean).join("\n").replace(/\s+/g, " ").trim();

const countSummary = (changes: ProductionScriptReimportChange[]) => ({
  added: changes.filter((change) => change.type.endsWith("_added")).length,
  removed: changes.filter((change) => change.type.endsWith("_removed")).length,
  changed: changes.filter((change) => change.type.endsWith("_changed")).length,
});

export const createProductionProjectFromScriptExport = (
  input: CreateProductionFromScriptExportInput,
): ProductionScriptImportResult => {
  const importedAt = input.importedAt ?? Date.now();
  const episodes = input.package.units.map(importEpisode);
  const importedSceneCount = episodes.reduce((count, episode) => count + episode.scenes.length, 0);
  const project: ProductionImportedScriptProject = {
    id: input.productionProjectId,
    title: input.package.title,
    format: input.package.format,
    workType: input.package.workType,
    importSource: {
      importId: input.importId,
      sourceWritingProjectId: input.package.sourceWritingProjectId,
      sourceExportedAt: input.package.exportedAt,
      importedAt,
    },
    writingStrategy: input.package.strategySummary ? { ...input.package.strategySummary } : undefined,
    episodes,
    createdAt: importedAt,
    updatedAt: importedAt,
  };
  return {
    project,
    report: {
      projectId: project.id,
      sourceWritingProjectId: input.package.sourceWritingProjectId,
      importedUnitCount: episodes.length,
      importedSceneCount,
      droppedFields: [
        "writing.memoryDigest",
        "writing.contextStats",
        "writing.styleGuide.referenceNotes",
        "writing.creativeGovernance.skillBindings",
        "writing.creativeGovernance.referenceDNA",
        "writing.creativeGovernance.sourceLedger",
      ],
      warnings: input.package.units.length ? [] : ["导出包没有可导入单元"],
    },
  };
};

export const previewProductionScriptReimport = (
  existingProject: ProductionImportedScriptProject,
  nextPackage: ScriptExportPackage,
  comparedAt = Date.now(),
): ProductionScriptReimportPreview => {
  const nextProject = createProductionProjectFromScriptExport({
    package: nextPackage,
    productionProjectId: existingProject.id,
    importId: existingProject.importSource.importId,
    importedAt: existingProject.importSource.importedAt,
  }).project;
  const currentByUnit = new Map(existingProject.episodes.map((episode) => [episode.sourceUnitId, episode]));
  const nextByUnit = new Map(nextProject.episodes.map((episode) => [episode.sourceUnitId, episode]));
  const changes: ProductionScriptReimportChange[] = [];

  for (const [sourceUnitId, nextEpisode] of nextByUnit) {
    const currentEpisode = currentByUnit.get(sourceUnitId);
    if (!currentEpisode) {
      changes.push({ type: "unit_added", sourceUnitId, title: nextEpisode.title, after: sourceText(nextEpisode) });
      continue;
    }
    if (sourceText(currentEpisode) !== sourceText(nextEpisode)) {
      changes.push({
        type: "unit_changed",
        sourceUnitId,
        title: nextEpisode.title,
        before: sourceText(currentEpisode),
        after: sourceText(nextEpisode),
      });
    }
    const currentScenes = new Map(currentEpisode.scenes.map((scene) => [scene.sourceSceneId || scene.id, scene]));
    const nextScenes = new Map(nextEpisode.scenes.map((scene) => [scene.sourceSceneId || scene.id, scene]));
    for (const [sourceSceneId, nextScene] of nextScenes) {
      const currentScene = currentScenes.get(sourceSceneId);
      if (!currentScene) {
        changes.push({ type: "scene_added", sourceUnitId, sourceSceneId, title: nextScene.title, after: sceneText(nextScene) });
      } else if (sceneText(currentScene) !== sceneText(nextScene)) {
        changes.push({
          type: "scene_changed",
          sourceUnitId,
          sourceSceneId,
          title: nextScene.title,
          before: sceneText(currentScene),
          after: sceneText(nextScene),
        });
      }
    }
    for (const [sourceSceneId, currentScene] of currentScenes) {
      if (!nextScenes.has(sourceSceneId)) {
        changes.push({ type: "scene_removed", sourceUnitId, sourceSceneId, title: currentScene.title, before: sceneText(currentScene) });
      }
    }
  }

  for (const [sourceUnitId, currentEpisode] of currentByUnit) {
    if (!nextByUnit.has(sourceUnitId)) {
      changes.push({ type: "unit_removed", sourceUnitId, title: currentEpisode.title, before: sourceText(currentEpisode) });
    }
  }

  return {
    projectId: existingProject.id,
    sourceWritingProjectId: nextPackage.sourceWritingProjectId,
    comparedAt,
    changes,
    summary: countSummary(changes),
  };
};
