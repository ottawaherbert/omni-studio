import type { ScriptDeliveryBlockType, ScriptDeliveryFormat } from "../../../../domain/src/scriptDelivery";

export interface ProductionScriptImportSource {
  importId: string;
  sourceWritingProjectId: string;
  sourceExportedAt: number;
  importedAt: number;
}

export interface ProductionImportedWritingStrategySummary {
  structureTemplateId?: string;
  cadenceTemplateId?: string;
  patternTemplateIds: string[];
  referenceTitles: string[];
  qaStatus: "unchecked" | "pass" | "warn" | "block";
  warnings: string[];
}

export interface ProductionImportedScriptBlock {
  id: string;
  type: ScriptDeliveryBlockType;
  content: string;
  acting?: string;
  emotion?: string;
}

export interface ProductionImportedScene {
  id: string;
  sourceUnitId: string;
  sourceSceneId?: string;
  index: number;
  title: string;
  synopsis: string;
  characters: string[];
  scriptBlocks: ProductionImportedScriptBlock[];
  sourceText: string;
}

export interface ProductionImportedEpisode {
  id: string;
  sourceUnitId: string;
  index: number;
  title: string;
  summary: string;
  scenes: ProductionImportedScene[];
  prose?: string;
}

export interface ProductionImportedScriptProject {
  id: string;
  title: string;
  format: ScriptDeliveryFormat;
  workType?: string;
  importSource: ProductionScriptImportSource;
  writingStrategy?: ProductionImportedWritingStrategySummary;
  episodes: ProductionImportedEpisode[];
  createdAt: number;
  updatedAt: number;
}

export interface ProductionScriptImportReport {
  projectId: string;
  sourceWritingProjectId: string;
  importedUnitCount: number;
  importedSceneCount: number;
  droppedFields: string[];
  warnings: string[];
}

export type ProductionScriptReimportChangeType =
  | "unit_added"
  | "unit_removed"
  | "unit_changed"
  | "scene_added"
  | "scene_removed"
  | "scene_changed";

export interface ProductionScriptReimportChange {
  type: ProductionScriptReimportChangeType;
  sourceUnitId: string;
  sourceSceneId?: string;
  title: string;
  before?: string;
  after?: string;
}

export interface ProductionScriptReimportPreview {
  projectId: string;
  sourceWritingProjectId: string;
  comparedAt: number;
  changes: ProductionScriptReimportChange[];
  summary: {
    added: number;
    removed: number;
    changed: number;
  };
}

export interface ProductionSceneBreakdown {
  sceneId: string;
  episodeId: string;
  characters: string[];
  location: string;
  props: string[];
  productionNotes: string[];
}

export interface ProductionAssetCandidate {
  id: string;
  kind: "character" | "location" | "prop";
  name: string;
  sourceSceneIds: string[];
  rationale: string;
}

export interface ProductionStoryboardBeat {
  id: string;
  sceneId: string;
  sourceBlockId: string;
  index: number;
  beatType: "establishing" | "action" | "dialogue" | "reaction" | "transition";
  text: string;
  suggestedShotSize: "wide" | "medium" | "close";
  productionIntent: string;
}

export interface ProductionScriptPrepPackage {
  projectId: string;
  generatedAt: number;
  breakdowns: ProductionSceneBreakdown[];
  assetCandidates: ProductionAssetCandidate[];
  storyboardBeats: ProductionStoryboardBeat[];
}
