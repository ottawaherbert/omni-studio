/** Production handoff snapshot. Independent of authoring storage and workflows. */
export type ScriptDeliveryFormat = "single-work" | "series-work" | "movie" | "tv-series" | "short-drama" | "micro-short-drama";
export type ScriptDeliveryBlockType = "scene_heading" | "action" | "character" | "dialogue" | "parenthetical" | "transition" | "prose";
export interface ScriptDeliveryBlock { id: string; type: ScriptDeliveryBlockType; content: string; acting?: string; emotion?: string; cameraHint?: string; }
export interface ScriptDeliveryCharacter { id: string; name: string; sourceUnitIndex?: number; sourceUnitIds?: string[]; role?: string; manualLockedFields?: string[]; bio?: string; psychologicalProfile?: string; mbti?: string; enneagram?: string; actingStyle?: string; }
export interface ScriptDeliveryLore { id: string; term: string; definition: string; category: string; sourceUnitIndex?: number; sourceUnitIds?: string[]; productionAssetKind?: "location" | "prop" | "none"; }
export interface ScriptExportScene {
  id: string; index: number; title: string; synopsis: string; characters: string[]; blocks: ScriptDeliveryBlock[];
  purpose?: string; goal?: string; obstacle?: string; surfaceConflict?: string; subtextConflict?: string;
  openingValue?: string; closingValue?: string; turn?: string; irreversibleChange?: string; dialogueStrategy?: string;
  locationText?: string; timeText?: string; targetDurationSeconds?: number; targetDurationMinutes?: number;
  sceneAssets?: string[]; relationshipPressure?: string; performanceNotes?: string; continuityIn?: string; continuityOut?: string;
  valueCharge?: "positive" | "negative" | "neutral"; valueShift?: {from:string;to:string;reason:string};
  beats?: {id:string;index:number;title:string;action:string;durationSeconds?:number;visibleChange?:string}[];
  hook?: string; cliffhanger?: string;
}
export interface ScriptExportUnit {
  id: string; index: number; kind: "episode" | "sequence" | "scene"; title: string; summary: string;
  targetDurationMinutes?: number; continuityMode?: "continue" | "standalone"; scenes?: ScriptExportScene[]; prose?: string;
}
export interface ScriptExportPackage {
  /** v1 and unversioned exports remain importable; new authoring exports use v2. */
  schemaVersion?: "script-delivery.v1" | "script-delivery.v2"; sourceRevision?: number; exportedAt: number; sourceWritingProjectId: string;
  aspectRatio?: "16:9" | "9:16" | "1:1"; language?: string;
  productionMethod?: "live-action" | "AI-video" | "animation" | "hybrid";
  authorRequirements?: string[];
  title: string; format: ScriptDeliveryFormat; workType?: string; characters: ScriptDeliveryCharacter[]; lore: ScriptDeliveryLore[];
  styleGuide: { voice: string; pacing: string; dialogue: string; imagery?: string; referenceNotes?: string[]; forbiddenStyle?: string[] };
  units: ScriptExportUnit[];
  memoryDigest?: { criticalEntityStates: {unitId?:string;parentUnitId?:string;name:string;type:string;status?:string;position?:string;properties?:Record<string,unknown>;lockedFacts?:string[];evidence?:string}[] };
  strategySummary?: { structureTemplateId?: string; cadenceTemplateId?: string; patternTemplateIds: string[]; referenceTitles: string[]; qaStatus: "unchecked" | "pass" | "warn" | "block"; warnings: string[] };
}
export interface ScriptProjectSummary { 
  id: string; 
  title: string; 
  format: ScriptDeliveryFormat; 
  /** Current manuscript CAS stamp; never display as a version or history. */
  revision: number;
  plannedUnitCount: number; 
  writtenUnitCount: number; 
  updatedAt: number; 
  targetDurationMinutes?: number;
  workType?: string;
  genre?: string;
  concept?: string;
  unitCount?: number;
  sceneCount?: number;
  totalCharacters?: number;
}
