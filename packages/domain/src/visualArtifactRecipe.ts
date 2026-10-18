import type { VisualStyleTreatmentSection } from "./visualStyle";

export type VisualArtifactIntent =
  | "asset_identity"
  | "asset_state"
  | "storyboard_control"
  | "direction_preview"
  | "effect_look"
  | "final_frame"
  | "image_edit"
  | "video_clip";

export type VisualArtifactPresentation =
  | "final_render"
  | "clean_reference"
  | "control_drawing"
  | "annotated_board";

export type VisualRecipeRequiredInput =
  | "identity_facts"
  | "base_identity"
  | "state_delta"
  | "shot_facts"
  | "visible_action"
  | "continuity"
  | "source_edit"
  | "requested_changes"
  | "preserve_constraints"
  | "start_state"
  | "end_state"
  | "motion_intent";

export type VisualRecipeWorkflowStage = "deconstruct" | "diagnose" | "develop" | "deliver";

export type VisualRecipeRuntimeEnforcement = "draft" | "formal";

/** Structural evidence from an authored field, reference contract, or compiler result. */
export interface VisualRecipeRuntimeEvidence {
  source: string;
  summary?: string;
}

export interface VisualRecipeRuntimeInputCheck {
  input: VisualRecipeRequiredInput;
  status: "satisfied" | "missing";
  evidence: VisualRecipeRuntimeEvidence[];
}

export interface VisualRecipeRuntimeStageCheck {
  stage: VisualRecipeWorkflowStage;
  status: "completed" | "pending";
  evidence: VisualRecipeRuntimeEvidence[];
}

export interface VisualRecipeRuntimeAcceptanceCheck {
  check: string;
  /** Output review remains pending until a human or a real QC result records evidence. */
  status: "pending_review" | "passed" | "failed";
  evidence: VisualRecipeRuntimeEvidence[];
}

export interface VisualRecipeRuntimeIssue {
  severity: "warning" | "blocking";
  code:
    | "VISUAL_RECIPE_INPUT_MISSING"
    | "VISUAL_RECIPE_STAGE_PENDING"
    | "VISUAL_RECIPE_ACCEPTANCE_UNREGISTERED"
    | "VISUAL_RECIPE_ACCEPTANCE_FAILED"
    | "VISUAL_RECIPE_MANIFEST_MISMATCH";
  subject: string;
  message: string;
}

export interface VisualRecipeRuntimeContract {
  schemaVersion: "visual-recipe-runtime.v1";
  recipeId: string;
  recipeVersion: string;
  intent: VisualArtifactIntent;
  enforcement: VisualRecipeRuntimeEnforcement;
  requiredInputs: VisualRecipeRuntimeInputCheck[];
  workflowStages: VisualRecipeRuntimeStageCheck[];
  acceptanceChecks: VisualRecipeRuntimeAcceptanceCheck[];
  issues: VisualRecipeRuntimeIssue[];
}

export interface VisualTaskRecipeDefinition {
  id: string;
  version: string;
  intent: VisualArtifactIntent;
  defaultPresentation: VisualArtifactPresentation;
  treatmentSections: VisualStyleTreatmentSection[];
  appearanceProjection: "identity" | "control" | "full";
  specificationProjection: "identity" | "control" | "full";
  requiredInputs: VisualRecipeRequiredInput[];
  workflowStages: VisualRecipeWorkflowStage[];
  neutralDirectives: string[];
  acceptanceChecks: string[];
}
