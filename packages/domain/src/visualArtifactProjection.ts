import type {
  Animation2DVisualSpecification,
  Animation3DVisualSpecification,
  LiveActionVisualSpecification,
  MixedMediaVisualSpecification,
  StopMotionVisualSpecification,
  VisualAppearance,
  VisualEntityType,
  VisualMediumAssignment,
  VisualProductionMode,
  VisualStyleTreatment,
} from "./visualStyle";
import type {
  VisualArtifactIntent,
  VisualArtifactPresentation,
  VisualRecipeRuntimeContract,
} from "./visualArtifactRecipe";

export interface VisualProjectionTarget {
  entityType?: VisualEntityType;
  entityId?: string;
  layerId?: string;
}

export interface VisualProjectionTargetSelection {
  mode: "full_frame" | "targeted";
  targets: VisualProjectionTarget[];
}

export interface VisualProjectionFieldOrigin {
  path: string;
  source: "style_lock" | "medium_assignment" | "asset_override" | "shot_override" | "request_override" | "recipe";
  sourceId?: string;
  action: "seed" | "set" | "suppress" | "project";
}

export interface VisualProjectionIssue {
  severity: "warning" | "blocking";
  code: string;
  message: string;
  path?: string;
}

export type VisualProjectedModeSpecification =
  | ({ kind: "live_action" } & Partial<Omit<LiveActionVisualSpecification, "kind">>)
  | ({ kind: "2d_animation" } & Partial<Omit<Animation2DVisualSpecification, "kind">>)
  | ({ kind: "3d_animation" } & Partial<Omit<Animation3DVisualSpecification, "kind">>)
  | ({ kind: "stop_motion" } & Partial<Omit<StopMotionVisualSpecification, "kind">>)
  | ({ kind: "mixed_media" } & Partial<Omit<MixedMediaVisualSpecification, "kind">>);

export interface VisualProjectedImplementation {
  productionMode: VisualProductionMode;
  appearance?: Partial<VisualAppearance>;
  techniques?: string[];
  specification?: VisualProjectedModeSpecification;
}

/** Mixed-media composition rules remain distinct from the concrete target implementation. */
export type VisualProjectedCompositingEnvelope = Omit<VisualProjectedImplementation, "productionMode" | "specification"> & {
  productionMode: "mixed_media";
  specification?: { kind: "mixed_media" } & Partial<Omit<MixedMediaVisualSpecification, "kind">>;
};

export type VisualProjectedMediumAssignment = Omit<VisualMediumAssignment, "implementation"> & {
  implementation: VisualProjectedImplementation;
  mediumProfile: { id: string; version: string };
};

export interface VisualStyleSourcePointer {
  schemaVersion?: string;
  revision?: number;
  declaredContentHash?: string;
  resolvedContentHash: string;
}

export interface VisualCompileManifest {
  creativeDirection?: { sourceHash: string; directorSkillId?: string; directorRevision?: number; sources: string[]; directorPlanId?: string; directorPlanStatus?: string; appliedMethods?: string[]; execution?: "instructions" };
  schemaVersion: "visual-compile-manifest.v1";
  recipeId: string;
  recipeVersion: string;
  intent: VisualArtifactIntent;
  presentation: VisualArtifactPresentation;
  targetSelection: VisualProjectionTargetSelection;
  sourceStyle: VisualStyleSourcePointer;
  mediumProfile?: { id: string; version: string };
  compositingEnvelopeProfile?: { id: string; version: string };
  appliedMediumProfiles: Array<{ assignmentId: string; id: string; version: string }>;
  appliedMediumAssignmentIds: string[];
  suppressedFields: string[];
  issueCodes: string[];
  blockIds: string[];
  /** Bound at request compilation; output acceptance remains explicitly pending. */
  recipeContract?: VisualRecipeRuntimeContract;
}

export interface VisualStyleProjection {
  stylePrompt?: string;
  schemaVersion: "visual-style-projection.v1";
  recipeId: string;
  recipeVersion: string;
  intent: VisualArtifactIntent;
  presentation: VisualArtifactPresentation;
  targetSelection: VisualProjectionTargetSelection;
  compositingEnvelope?: VisualProjectedCompositingEnvelope;
  implementation?: VisualProjectedImplementation;
  treatment: Partial<VisualStyleTreatment>;
  mediumAssignments: VisualProjectedMediumAssignment[];
  appliedMediumAssignmentIds: string[];
  neutralDirectives: string[];
  fieldOrigins: VisualProjectionFieldOrigin[];
  suppressedFields: string[];
  issues: VisualProjectionIssue[];
  sourceStyle: VisualStyleSourcePointer;
  mediumProfile?: { id: string; version: string };
  compositingEnvelopeProfile?: { id: string; version: string };
}
