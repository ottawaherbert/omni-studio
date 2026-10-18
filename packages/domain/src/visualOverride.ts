import type {
  VisualAppearance,
  VisualMediumAssignment,
  VisualModeSpecification,
  VisualProductionMode,
  VisualStyleTreatment,
} from "./visualStyle";

export type VisualOverrideValue<T> =
  | { mode: "inherit" }
  | { mode: "set"; value: T }
  | { mode: "suppress" };

export type VisualRequiredOverrideValue<T> =
  | { mode: "inherit" }
  | { mode: "set"; value: T };

export type VisualTreatmentOverride = {
  [Section in keyof VisualStyleTreatment]?: VisualOverrideValue<VisualStyleTreatment[Section]>;
};

export interface VisualImplementationOverride {
  productionMode?: VisualRequiredOverrideValue<VisualProductionMode>;
  appearance?: VisualOverrideValue<VisualAppearance>;
  techniques?: VisualOverrideValue<string[]>;
  specification?: VisualOverrideValue<VisualModeSpecification>;
}

export interface VisualLocalOverride {
  schemaVersion: "visual-local-override.v1";
  revision?: number;
  contentHash?: string;
  implementation?: VisualImplementationOverride;
  treatment?: VisualTreatmentOverride;
  mediumAssignments?: VisualOverrideValue<VisualMediumAssignment[]>;
  source?: "asset" | "shot" | "request" | "manual" | "legacy";
  notes?: string[];
}
