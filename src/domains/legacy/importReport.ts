export type LegacyImportTarget = "writing" | "production";

export interface LegacyImportDroppedField {
  path: string;
  reason: string;
}

export interface LegacyImportReport {
  target: LegacyImportTarget;
  legacyProjectId: string;
  importedProjectId: string;
  unitCount: number;
  sceneCount: number;
  droppedFields: LegacyImportDroppedField[];
  warnings: string[];
}
