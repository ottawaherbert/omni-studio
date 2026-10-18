export const VISUAL_PRODUCTION_MODES = [
  "live_action",
  "2d_animation",
  "3d_animation",
  "stop_motion",
  "mixed_media",
] as const;

export type VisualProductionMode = typeof VISUAL_PRODUCTION_MODES[number];
export type ConcreteVisualProductionMode = Exclude<VisualProductionMode, "mixed_media">;

export const VISUAL_ENTITY_TYPES = [
  "character",
  "location",
  "prop",
  "vfx",
  "wardrobe",
  "makeupHair",
  "vehicles",
  "extrasAtmosphere",
  "specialEquipment",
] as const;

/** Project entities that can own visible medium assignments; audio-only assets are excluded. */
export type VisualEntityType = typeof VISUAL_ENTITY_TYPES[number];

export const isVisualEntityType = (value: unknown): value is VisualEntityType => (
  typeof value === "string" && (VISUAL_ENTITY_TYPES as readonly string[]).includes(value)
);

export interface VisualAppearance {
  realism: "unspecified" | "photoreal" | "naturalistic" | "stylized" | "graphic" | "abstract";
  dimensionality: "physical_capture" | "flat_2d" | "layered_2d" | "volumetric_3d" | "physical_miniature" | "hybrid";
  finish: "unspecified" | "raw" | "clean" | "painterly" | "graphic" | "polished";
  descriptors: string[];
}

export interface LiveActionVisualSpecification {
  kind: "live_action";
  captureProcess: "unspecified" | "digital" | "film" | "hybrid";
  lensBehavior: string[];
  cameraSupport: string[];
  practicalLighting: string[];
  productionDesign: string[];
  performanceFidelity: string[];
  /** Declares the practical-effects versus VFX boundary, including an explicit none/not-applicable decision. */
  effectsBoundary: string[];
  finishing: string[];
}

export interface Animation2DVisualSpecification {
  kind: "2d_animation";
  animationMethod: "unspecified" | "hand_drawn" | "rigged" | "hybrid";
  lineSystem: string[];
  colorApplication: string[];
  depthStrategy: string[];
  layoutAndBackground: string[];
  /** Character performance, deformation/off-model limits, and key/in-between/cleanup consistency. */
  performanceAndCleanup: string[];
  motionCadence: string[];
  effectsAnimation: string[];
  compositing: string[];
}

export interface Animation3DVisualSpecification {
  kind: "3d_animation";
  modelingLanguage: string[];
  shadingModel: string[];
  lightingPipeline: string[];
  riggingSystem: string[];
  animationSystem: string[];
  simulationPolicy: string[];
  renderCharacter: string[];
  compositing: string[];
}

export interface StopMotionVisualSpecification {
  kind: "stop_motion";
  fabrication: string[];
  setConstructionAndScale: string[];
  puppetConstruction: string[];
  armatureBehavior: string[];
  replacementAnimation: string[];
  frameCadence: string[];
  captureAndMotionControl: string[];
  stageLighting: string[];
  materialImperfections: string[];
  rigRemovalAndCompositing: string[];
}

export interface MixedMediaVisualSpecification {
  kind: "mixed_media";
  compositingModel: string[];
  integrationRules: string[];
  transitionRules: string[];
  contactAndShadowRules: string[];
}

export type VisualModeSpecification =
  | LiveActionVisualSpecification
  | Animation2DVisualSpecification
  | Animation3DVisualSpecification
  | StopMotionVisualSpecification
  | MixedMediaVisualSpecification;

interface VisualImplementationBase {
  appearance: VisualAppearance;
  techniques: string[];
}

export type ConcreteVisualImplementationMedium =
  | (VisualImplementationBase & { productionMode: "live_action"; specification: LiveActionVisualSpecification })
  | (VisualImplementationBase & { productionMode: "2d_animation"; specification: Animation2DVisualSpecification })
  | (VisualImplementationBase & { productionMode: "3d_animation"; specification: Animation3DVisualSpecification })
  | (VisualImplementationBase & { productionMode: "stop_motion"; specification: StopMotionVisualSpecification });

export type VisualImplementationMedium = ConcreteVisualImplementationMedium
  | (VisualImplementationBase & { productionMode: "mixed_media"; specification: MixedMediaVisualSpecification });

export type VisualMediumAssignmentTarget =
  | { scope: "whole" }
  | { scope: "entity"; entityType: VisualEntityType; entityId: string }
  | { scope: "layer"; layerId: string; label: string; description: string };

export interface VisualMediumAssignment {
  id: string;
  target: VisualMediumAssignmentTarget;
  implementation: ConcreteVisualImplementationMedium;
  compositingRole: "base" | "embedded" | "overlay" | "effect";
  priority?: number;
  notes?: string[];
}
