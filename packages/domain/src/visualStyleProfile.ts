import type {
  VisualImplementationMedium,
  VisualMediumAssignment,
  VisualProductionMode,
} from "./visualStyleImplementation";

export interface VisualStyleTreatment {
  palette: string[];
  color: string[];
  surface: string[];
  linework: string[];
  lighting: string[];
  camera: string[];
  movement: string[];
  composition: string[];
  materials: string[];
  finish: string[];
  readability: string[];
  constraints: string[];
  directives: string[];
}

export type VisualStyleTreatmentSection = keyof VisualStyleTreatment;

export interface VisualStyleSourceReview {
  status: "current" | "review_recommended";
  changedFields: string[];
  detectedAt: number;
  basedOnRevision?: number;
}

export interface VisualMediumProfileEditorField {
  path: string;
  label: string;
  kind: "text" | "list" | "enum";
  required: boolean;
  options?: string[];
}

export interface VisualMediumProfileEditorSection {
  id: string;
  label: string;
  fields: VisualMediumProfileEditorField[];
}

export interface VisualMediumProfileDefinition {
  id: string;
  version: string;
  productionMode: VisualProductionMode;
  seed: VisualImplementationMedium;
  requiredSpecificationFields: string[];
  requiredTreatmentSections: VisualStyleTreatmentSection[];
  editorSections: VisualMediumProfileEditorSection[];
  neutralDirectives: string[];
}

export interface VisualStyleLockV3 {
  stylePrompt?: string;
  schemaVersion: "visual-style-lock.v3";
  revision: number;
  contentHash: string;
  visualImplementation?: VisualImplementationMedium;
  treatment: VisualStyleTreatment;
  mediumAssignments: VisualMediumAssignment[];
  sourceReview: VisualStyleSourceReview;
}

export interface VisualStyleLockV3Fields {
  stylePrompt?: string;
  schemaVersion?: "visual-style-lock.v3";
  revision?: number;
  contentHash?: string;
  visualImplementation?: VisualImplementationMedium;
  treatment?: VisualStyleTreatment;
  mediumAssignments?: VisualMediumAssignment[];
  sourceReview?: VisualStyleSourceReview;
}
