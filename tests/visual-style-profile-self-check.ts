import assert from "node:assert/strict";

import type { VisualArtifactIntent } from "../packages/domain/src/visualArtifact";
import type { VisualOverrideValue } from "../packages/domain/src/visualOverride";
import type { VisualImplementationMedium, VisualStyleLockV3Fields } from "../packages/domain/src/visualStyle";
import {
  assertVisualStyleReadyForExecution,
  createNeutralVisualImplementation,
  getVisualMediumProfile,
  listVisualMediumProfiles,
  validateVisualStyleReadiness,
} from "../packages/production/src/services/production/visualMediumProfiles";
import {
  normalizeLegacyVisualStyleLock,
  visualStyleContentHash,
} from "../packages/production/src/services/production/visualStyleMigration";
import {
  applyVisualOverrideValue,
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
} from "../packages/production/src/services/production/visualStyleProjection";
import { getVisualTaskRecipeForIntent } from "../packages/production/src/services/production/visualTaskRecipes";
import { resolveVisualStyleSourceReviewForUpdate } from "../src/store/visualStyleSourceReview";
import { resolveImageVisualStyleProjectionContext } from "../src/services/production/imageVisualStyleProjection";

const forbiddenLiveActionTerms = /live[_ -]?action|photoreal|真人|写实摄影/i;

const printable = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(printable).join(" ");
  if (value && typeof value === "object") return Object.values(value).map(printable).join(" ");
  return "";
};

const requiredProductionDecisions: Partial<Record<string, string[]>> = {
  live_action: ["effectsBoundary"],
  "2d_animation": ["layoutAndBackground", "performanceAndCleanup", "effectsAnimation"],
  "3d_animation": ["riggingSystem", "animationSystem"],
  stop_motion: ["setConstructionAndScale", "captureAndMotionControl", "rigRemovalAndCompositing"],
};

const profileFor = (productionMode: string) => {
  const profile = getVisualMediumProfile(productionMode as never);
  assert.ok(profile, `profile ${productionMode} must exist`);
  return profile;
};

console.log("[visual-style-profile] medium profiles");
const profiles = listVisualMediumProfiles();
for (const productionMode of ["live_action", "2d_animation", "3d_animation", "stop_motion", "mixed_media"]) {
  const profile = profileFor(productionMode);
  assert.ok(profiles.some((item) => item.id === profile.id), `${productionMode} should be listed`);
  assert.equal(profile.productionMode, productionMode);
  assert.ok(profile.requiredSpecificationFields.length > 0, `${productionMode} needs required specification metadata`);
  for (const field of requiredProductionDecisions[productionMode] || []) {
    assert.ok(profile.requiredSpecificationFields.includes(field), `${productionMode} must require ${field}`);
  }
  for (const field of profile.requiredSpecificationFields) {
    assert.ok(
      profile.editorSections.flatMap((section) => section.fields).some((entry) => entry.path.endsWith(`.${field}`) && entry.required),
      `${productionMode}.${field} must be reachable in the formal editor`,
    );
  }
  assert.ok(profile.requiredTreatmentSections.length > 0, `${productionMode} needs required shared treatment metadata`);
  assert.ok(profile.editorSections.flatMap((section) => section.fields).some((field) => field.required));
  const neutralReadiness = validateVisualStyleReadiness({
    schemaVersion: "visual-style-lock.v3",
    revision: 1,
    contentHash: "neutral",
    visualImplementation: createNeutralVisualImplementation(productionMode as never),
    treatment: {
      palette: [], color: [], surface: [], linework: [], lighting: [], camera: [], movement: [],
      composition: [], materials: [], finish: [], readability: [], constraints: [], directives: [],
    },
    mediumAssignments: [],
    sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
  }, { formal: true });
  assert.equal(neutralReadiness.ready, false, `${productionMode} neutral seed must not pass as a formal style`);
  for (const requiredField of profile.requiredSpecificationFields) {
    assert.ok(
      neutralReadiness.issues.some((issue) => issue.path === `visualImplementation.specification.${requiredField}`),
      `${productionMode} must require ${requiredField}`,
    );
  }
  for (const requiredSection of profile.requiredTreatmentSections) {
    assert.ok(
      neutralReadiness.issues.some((issue) => issue.path === `treatment.${requiredSection}`),
      `${productionMode} must require treatment.${requiredSection}`,
    );
  }
}

const stopMotion = profileFor("stop_motion");
const stopMotionSeed = stopMotion.seed;
const stopMotionSpecification = stopMotionSeed.specification;
assert.ok(stopMotionSpecification);
assert.equal(stopMotionSpecification.kind, "stop_motion");
if (stopMotionSpecification.kind !== "stop_motion") throw new Error("stop motion profile has the wrong specification");
assert.ok(Array.isArray(stopMotionSpecification.fabrication), "stop motion needs a fabrication field");
assert.ok(Array.isArray(stopMotionSpecification.setConstructionAndScale), "stop motion needs a set-construction and scale field");
assert.ok(Array.isArray(stopMotionSpecification.frameCadence), "stop motion needs a frame cadence field");
assert.ok(Array.isArray(stopMotionSpecification.captureAndMotionControl), "stop motion needs a capture and motion-control field");
assert.equal(stopMotion.version, "1.2.0");

const mixedMedia = profileFor("mixed_media");
assert.equal(mixedMedia.seed.productionMode, "mixed_media");
const animation2d = profileFor("2d_animation");
assert.equal(animation2d.version, "1.2.0");
assert.equal(animation2d.seed.specification.kind, "2d_animation");
if (animation2d.seed.specification.kind !== "2d_animation") throw new Error("2d animation profile has the wrong specification");
assert.ok(Array.isArray(animation2d.seed.specification.performanceAndCleanup));

console.log("[visual-style-profile] neutral seeds and migration");
for (const productionMode of ["2d_animation", "3d_animation", "stop_motion", "mixed_media"]) {
  const seed = createNeutralVisualImplementation(productionMode as never);
  assert.doesNotMatch(
    printable(seed),
    forbiddenLiveActionTerms,
    `${productionMode} neutral implementation must not leak live-action defaults`,
  );
}

const legacyPhotoreal = normalizeLegacyVisualStyleLock({
  renderingMode: "photoreal cinematic finish",
  stylePrompt: "high-detail photoreal image",
} as never) as { lock: VisualStyleLockV3Fields };
assert.notEqual(
  legacyPhotoreal.lock.visualImplementation?.productionMode,
  "live_action",
  "photoreal legacy prose is not evidence for live action",
);
const legacy2d = normalizeLegacyVisualStyleLock({
  renderingMode: "2D animation",
  stylePrompt: "hand-drawn animated linework",
  humanApprovalState: "approved",
} as never) as { lock: VisualStyleLockV3Fields };
assert.equal(legacy2d.lock.visualImplementation?.productionMode, "2d_animation");
assert.deepEqual(
  legacy2d.lock.visualImplementation?.specification.kind === "2d_animation"
    ? legacy2d.lock.visualImplementation.specification.performanceAndCleanup
    : undefined,
  [],
  "legacy 2d styles must receive the reviewable performance-and-cleanup default",
);
const structured2dWithoutPerformance = normalizeLegacyVisualStyleLock({
  schemaVersion: "visual-style-lock.v3",
  revision: 1,
  contentHash: "pre-performance-contract",
  visualImplementation: {
    productionMode: "2d_animation",
    appearance: { realism: "stylized", dimensionality: "flat_2d", finish: "clean", descriptors: ["legacy cel finish"] },
    techniques: ["hand-drawn"],
    specification: {
      kind: "2d_animation",
      animationMethod: "hand_drawn",
      lineSystem: ["stable line"],
      colorApplication: ["cel color"],
      depthStrategy: ["layered planes"],
      layoutAndBackground: ["locked layout"],
      motionCadence: ["drawn twos"],
      effectsAnimation: ["declared effects pass"],
      compositing: ["clean composite"],
    },
  },
  treatment: legacy2d.lock.treatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
} as never);
assert.deepEqual(
  structured2dWithoutPerformance.lock.visualImplementation?.specification.kind === "2d_animation"
    ? structured2dWithoutPerformance.lock.visualImplementation.specification.performanceAndCleanup
    : undefined,
  [],
  "pre-contract structured 2d locks must normalize to an explicit empty review field",
);
assert.ok(validateVisualStyleReadiness(structured2dWithoutPerformance.lock, { formal: true }).issues.some(
  (issue) => issue.path === "visualImplementation.specification.performanceAndCleanup",
));
const preContractStopMotion = createNeutralVisualImplementation("stop_motion") as unknown as {
  specification: Record<string, unknown>;
};
delete preContractStopMotion.specification.setConstructionAndScale;
delete preContractStopMotion.specification.captureAndMotionControl;
const migratedPreContractStopMotion = normalizeLegacyVisualStyleLock({
  schemaVersion: "visual-style-lock.v3",
  revision: 1,
  contentHash: "pre-stop-motion-capture-contract",
  visualImplementation: preContractStopMotion,
  treatment: legacy2d.lock.treatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
} as never);
assert.deepEqual(
  migratedPreContractStopMotion.lock.visualImplementation?.specification.kind === "stop_motion"
    ? migratedPreContractStopMotion.lock.visualImplementation.specification.setConstructionAndScale
    : undefined,
  [],
);
assert.deepEqual(
  migratedPreContractStopMotion.lock.visualImplementation?.specification.kind === "stop_motion"
    ? migratedPreContractStopMotion.lock.visualImplementation.specification.captureAndMotionControl
    : undefined,
  [],
);
for (const field of ["setConstructionAndScale", "captureAndMotionControl"]) {
  assert.ok(validateVisualStyleReadiness(migratedPreContractStopMotion.lock, { formal: true }).issues.some(
    (issue) => issue.path === `visualImplementation.specification.${field}`,
  ));
}
assert.equal((legacy2d.lock as { humanApprovalState?: string }).humanApprovalState, "approved");
assert.equal(legacy2d.lock.sourceReview?.status, "review_recommended");
assert.ok(legacy2d.lock.visualImplementation?.appearance.descriptors.includes("hand-drawn animated linework"));
const legacy2dAssetProjection = projectVisualStyleForArtifact({
  styleLock: legacy2d.lock as never,
  intent: "asset_identity",
});
assert.ok(legacy2dAssetProjection.implementation?.appearance?.descriptors?.includes("hand-drawn animated linework"));
assert.equal(legacy2dAssetProjection.implementation?.appearance?.finish, undefined);
const legacyWithStructuredMode = normalizeLegacyVisualStyleLock({
  visualImplementation: createNeutralVisualImplementation("3d_animation"),
  stylePrompt: "soft geometric storybook forms",
} as never);
assert.ok(
  legacyWithStructuredMode.lock.visualImplementation?.appearance.descriptors.includes("soft geometric storybook forms"),
  "legacy stylePrompt must survive when productionMode is already explicit in visualImplementation",
);

const v3WithResidualLegacy = normalizeLegacyVisualStyleLock({
  ...legacy2d.lock,
  stylePrompt: "must not be merged again",
} as never);
assert.doesNotMatch(printable(v3WithResidualLegacy.lock.treatment), /must not be merged again/);
assert.equal(normalizeLegacyVisualStyleLock({ renderingMode: "hybrid" } as never).lock.visualImplementation?.productionMode, "mixed_media");

const tamperedV3 = normalizeLegacyVisualStyleLock({
  ...legacy2d.lock,
  treatment: { ...legacy2d.lock.treatment!, palette: ["tampered"] },
} as never);
assert.ok(tamperedV3.warnings.some((warning) => warning.code === "CONTENT_HASH_MISMATCH"));
const incompleteV3Payload = {
  schemaVersion: "visual-style-lock.v3" as const,
  contentHash: "",
  visualImplementation: legacy2d.lock.visualImplementation,
  treatment: legacy2d.lock.treatment,
  mediumAssignments: [],
  sourceReview: { status: "current" as const, changedFields: [], detectedAt: 1 },
};
incompleteV3Payload.contentHash = visualStyleContentHash(incompleteV3Payload);
const incompleteV3 = normalizeLegacyVisualStyleLock(incompleteV3Payload as never);
assert.ok(incompleteV3.warnings.some((warning) => warning.code === "INCOMPLETE_V3_LOCK" && warning.field === "revision"));
assert.equal(incompleteV3.lock.sourceReview?.status, "review_recommended");

const preservedUpstreamReview = resolveVisualStyleSourceReviewForUpdate({
  existing: {
    schemaVersion: "visual-style-lock.v3",
    revision: 3,
    sourceReview: { status: "current", changedFields: [], detectedAt: 1, basedOnRevision: 3 },
  },
  incoming: { stylePrompt: "legacy caller also changed the lock" },
  upstreamChangedFields: ["creativeVision.visualStyle"],
  detectedAt: 9,
});
assert.equal(preservedUpstreamReview?.status, "review_recommended");
assert.deepEqual(preservedUpstreamReview?.changedFields, ["creativeVision.visualStyle"]);
assert.equal(preservedUpstreamReview?.basedOnRevision, 3);
const explicitHumanReview = resolveVisualStyleSourceReviewForUpdate({
  existing: { revision: 3 },
  incoming: {
    revision: 4,
    sourceReview: { status: "current", changedFields: [], detectedAt: 10, basedOnRevision: 4 },
  },
  upstreamChangedFields: ["creativeVision.visualStyle"],
  detectedAt: 10,
});
assert.equal(explicitHumanReview?.status, "current", "only an explicit sourceReview may record human review as current");

const styleLock = {
  schemaVersion: "visual-style-lock.v3",
  revision: 1,
  contentHash: "style-r1-hash",
  visualImplementation: {
    ...createNeutralVisualImplementation("mixed_media"),
    productionMode: "mixed_media",
    appearance: {
      realism: "stylized",
      dimensionality: "hybrid",
      finish: "polished",
      descriptors: ["fabricated miniature fantasy"],
    },
    techniques: ["layered compositing"],
    specification: {
      kind: "mixed_media",
      compositingModel: ["layer stack"],
      integrationRules: ["preserve declared boundaries"],
      transitionRules: ["explicit transitions only"],
      contactAndShadowRules: ["shared contact plane"],
    },
  },
  mediumAssignments: [{
    id: "z-whole-base",
    target: { scope: "whole" },
    implementation: {
      ...createNeutralVisualImplementation("stop_motion"),
      appearance: {
        realism: "stylized",
        dimensionality: "physical_miniature",
        finish: "polished",
        descriptors: ["tactile miniature silhouette"],
      },
      techniques: ["replacement animation"],
      specification: {
        ...createNeutralVisualImplementation("stop_motion").specification,
        fabrication: ["clay"],
        setConstructionAndScale: ["locked miniature set and prop scale"],
        puppetConstruction: ["wire puppet"],
        armatureBehavior: ["stable armature"],
        replacementAnimation: ["replacement face"],
        frameCadence: ["held frames"],
        captureAndMotionControl: ["repeatable camera move and per-frame exposure"],
        stageLighting: ["assignment final stage lighting"],
        materialImperfections: ["assignment fingerprints"],
        rigRemovalAndCompositing: ["remove support rigs and preserve contact shadows"],
      },
    },
    compositingRole: "base",
    priority: 100,
  }, {
    id: "character-ink-overlay",
    target: { scope: "entity", entityType: "character", entityId: "hero" },
    implementation: createNeutralVisualImplementation("2d_animation"),
    compositingRole: "overlay",
  }, {
    id: "atmosphere-layer",
    target: { scope: "layer", layerId: "atmosphere", label: "环境气氛", description: "承载镜头空间中的空气与雾效" },
    implementation: createNeutralVisualImplementation("3d_animation"),
    compositingRole: "effect",
  }],
  treatment: {
    palette: [],
    surface: ["fingerprint clay", "painted wood"],
    linework: [],
    lighting: [],
    camera: [],
    movement: [],
    composition: [],
    materials: ["clay", "wood", "wire armature"],
    finish: ["tactile hand-finished miniature"],
    color: ["muted teal", "warm amber"],
    readability: [],
    constraints: [],
    directives: [],
  },
} satisfies VisualStyleLockV3Fields;

console.log("[visual-style-profile] task recipes and projections");
const storyboardRecipe = getVisualTaskRecipeForIntent("storyboard_control" as VisualArtifactIntent);
assert.equal(storyboardRecipe.intent, "storyboard_control");
assert.equal(storyboardRecipe.appearanceProjection, "control");
const finalRecipe = getVisualTaskRecipeForIntent("final_frame" as VisualArtifactIntent);
assert.equal(finalRecipe.intent, "final_frame");
assert.deepEqual(getVisualTaskRecipeForIntent("asset_state").requiredInputs, ["base_identity", "state_delta"]);
assert.deepEqual(getVisualTaskRecipeForIntent("image_edit").requiredInputs, ["source_edit", "requested_changes", "preserve_constraints"]);
assert.deepEqual(getVisualTaskRecipeForIntent("video_clip").requiredInputs, ["start_state", "end_state", "motion_intent", "continuity"]);
assert.deepEqual(finalRecipe.workflowStages, ["deconstruct", "diagnose", "develop", "deliver"]);

const projectionLockFor = (visualImplementation: VisualImplementationMedium) => ({
  schemaVersion: "visual-style-lock.v3" as const,
  revision: 1,
  contentHash: "projection-field-check",
  visualImplementation,
  treatment: {
    palette: [], color: [], surface: [], linework: [], lighting: [], camera: [], movement: [],
    composition: [], materials: [], finish: [], readability: [], constraints: [], directives: [],
  },
  mediumAssignments: [],
  sourceReview: { status: "current" as const, changedFields: [], detectedAt: 1 },
});
const implementation3d = createNeutralVisualImplementation("3d_animation");
implementation3d.specification.riggingSystem = ["facial and body deformation contract"];
implementation3d.specification.shadingModel = ["declared NPR shading"];
const identity3dProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementation3d) as never,
  intent: "asset_identity",
});
assert.deepEqual(identity3dProjection.implementation?.specification?.kind === "3d_animation"
  ? identity3dProjection.implementation.specification.riggingSystem
  : undefined, ["facial and body deformation contract"]);
implementation3d.specification.animationSystem = ["keyframe performance with corrective shapes"];
const control3dProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementation3d) as never,
  intent: "storyboard_control",
});
assert.deepEqual(control3dProjection.implementation?.specification?.kind === "3d_animation"
  ? control3dProjection.implementation.specification.animationSystem
  : undefined, ["keyframe performance with corrective shapes"]);

const implementationLiveAction = createNeutralVisualImplementation("live_action");
implementationLiveAction.specification.effectsBoundary = ["atmosphere is practical; set extension is VFX"];
const liveActionControlProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementationLiveAction) as never,
  intent: "storyboard_control",
});
assert.deepEqual(liveActionControlProjection.implementation?.specification?.kind === "live_action"
  ? liveActionControlProjection.implementation.specification.effectsBoundary
  : undefined, ["atmosphere is practical; set extension is VFX"]);

const implementation2d = createNeutralVisualImplementation("2d_animation");
implementation2d.specification.layoutAndBackground = ["locked layout and background perspective"];
implementation2d.specification.performanceAndCleanup = ["locked acting, bounded deformation, and consistent keys, in-betweens, and cleanup"];
implementation2d.specification.effectsAnimation = ["hand-drawn effects pass"];
const control2dProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementation2d) as never,
  intent: "storyboard_control",
});
assert.deepEqual(control2dProjection.implementation?.specification?.kind === "2d_animation"
  ? control2dProjection.implementation.specification.layoutAndBackground
  : undefined, ["locked layout and background perspective"]);
assert.deepEqual(control2dProjection.implementation?.specification?.kind === "2d_animation"
  ? control2dProjection.implementation.specification.performanceAndCleanup
  : undefined, ["locked acting, bounded deformation, and consistent keys, in-betweens, and cleanup"]);
assert.deepEqual(control2dProjection.implementation?.specification?.kind === "2d_animation"
  ? control2dProjection.implementation.specification.effectsAnimation
  : undefined, ["hand-drawn effects pass"]);
const identity2dProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementation2d) as never,
  intent: "asset_identity",
});
assert.deepEqual(identity2dProjection.implementation?.specification?.kind === "2d_animation"
  ? identity2dProjection.implementation.specification.performanceAndCleanup
  : undefined, ["locked acting, bounded deformation, and consistent keys, in-betweens, and cleanup"]);

const implementationStopMotion = createNeutralVisualImplementation("stop_motion");
implementationStopMotion.specification.rigRemovalAndCompositing = ["remove support rigs while preserving contact shadows"];
implementationStopMotion.specification.setConstructionAndScale = ["locked miniature set scale"];
implementationStopMotion.specification.captureAndMotionControl = ["locked exposure and repeatable motion-control move"];
const stopMotionControlProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementationStopMotion) as never,
  intent: "storyboard_control",
});
assert.deepEqual(stopMotionControlProjection.implementation?.specification?.kind === "stop_motion"
  ? stopMotionControlProjection.implementation.specification.rigRemovalAndCompositing
  : undefined, ["remove support rigs while preserving contact shadows"]);
assert.deepEqual(stopMotionControlProjection.implementation?.specification?.kind === "stop_motion"
  ? stopMotionControlProjection.implementation.specification.captureAndMotionControl
  : undefined, ["locked exposure and repeatable motion-control move"]);
const stopMotionIdentityProjection = projectVisualStyleForArtifact({
  styleLock: projectionLockFor(implementationStopMotion) as never,
  intent: "asset_identity",
});
assert.deepEqual(stopMotionIdentityProjection.implementation?.specification?.kind === "stop_motion"
  ? stopMotionIdentityProjection.implementation.specification.setConstructionAndScale
  : undefined, ["locked miniature set scale"]);

const storyboardProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "storyboard_control",
});
const finalProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
});
const assetProjection = projectVisualStyleForArtifact({ styleLock, intent: "asset_identity" });
const heroProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
  target: { entityType: "character", entityId: "hero" },
});
const videoProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "video_clip",
  target: { entityType: "character", entityId: "hero" },
});
const atmosphereLayerProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
  target: { layerId: "atmosphere" },
});
for (const entityType of ["wardrobe", "makeupHair", "vehicles", "extrasAtmosphere", "specialEquipment"] as const) {
  const assignmentId = `visual-entity-${entityType}`;
  const entityAssignment = {
    ...styleLock.mediumAssignments[0],
    id: assignmentId,
    target: { scope: "entity" as const, entityType, entityId: `asset-${entityType}` },
    compositingRole: "overlay" as const,
    priority: 200,
  };
  const normalizedEntityAssignment = normalizeLegacyVisualStyleLock({
    ...styleLock,
    mediumAssignments: [entityAssignment],
  } as never);
  assert.equal(normalizedEntityAssignment.lock.mediumAssignments?.[0]?.target.scope, "entity");
  assert.ok(!normalizedEntityAssignment.warnings.some((warning) => warning.code === "MALFORMED_MEDIUM_ASSIGNMENT"));
  const entityReadiness = validateVisualStyleReadiness({ ...styleLock, mediumAssignments: [entityAssignment] }, { formal: true });
  assert.ok(!entityReadiness.issues.some((issue) => issue.code === "MALFORMED_MEDIUM_ASSIGNMENT"));
  const entityProjection = projectVisualStyleForArtifact({
    styleLock: { ...styleLock, mediumAssignments: [entityAssignment] },
    intent: "final_frame",
    target: { entityType, entityId: `asset-${entityType}` },
  });
  assert.ok(entityProjection.appliedMediumAssignmentIds.includes(assignmentId), `${entityType} assignment must project onto its entity`);
}
for (const audioEntityType of ["sfx", "bgm"] as const) {
  const invalidAudioAssignment = {
    ...styleLock.mediumAssignments[0],
    id: `audio-${audioEntityType}`,
    target: { scope: "entity" as const, entityType: audioEntityType, entityId: `asset-${audioEntityType}` },
  };
  const normalizedAudioAssignment = normalizeLegacyVisualStyleLock({
    ...styleLock,
    mediumAssignments: [invalidAudioAssignment],
  } as never);
  assert.equal(normalizedAudioAssignment.lock.mediumAssignments?.length, 0);
  assert.ok(normalizedAudioAssignment.warnings.some((warning) => warning.code === "MALFORMED_MEDIUM_ASSIGNMENT"));
  const audioReadiness = validateVisualStyleReadiness({
    ...styleLock,
    mediumAssignments: [invalidAudioAssignment],
  } as never, { formal: true });
  assert.ok(audioReadiness.issues.some((issue) => issue.code === "MALFORMED_MEDIUM_ASSIGNMENT"));
}
const visualEntityProjectionContext = resolveImageVisualStyleProjectionContext({
  project: {
    title: "visual entity projection",
    characters: [],
    visualStyleLock: undefined,
    assets: [
      ...(["wardrobe", "makeupHair", "vehicles", "extrasAtmosphere", "specialEquipment"] as const).map((type) => ({
        id: `asset-${type}`,
        type,
        name: type,
        description: type,
      })),
      { id: "asset-sfx", type: "sfx", name: "audio effect", description: "audio only" },
      { id: "asset-bgm", type: "bgm", name: "music", description: "audio only" },
    ],
  },
  assetIds: ["asset-wardrobe", "asset-makeupHair", "asset-vehicles", "asset-extrasAtmosphere", "asset-specialEquipment", "asset-sfx", "asset-bgm"],
});
assert.deepEqual(visualEntityProjectionContext.targets, [
  { entityType: "wardrobe", entityId: "asset-wardrobe" },
  { entityType: "makeupHair", entityId: "asset-makeupHair" },
  { entityType: "vehicles", entityId: "asset-vehicles" },
  { entityType: "extrasAtmosphere", entityId: "asset-extrasAtmosphere" },
  { entityType: "specialEquipment", entityId: "asset-specialEquipment" },
]);
const multiTargetProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
  targets: [
    { entityType: "character", entityId: "hero" },
    { entityType: "location", entityId: "unassigned-location" },
  ],
});
const emptyTargetProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
  targets: [],
});
const layeredWholeStyleLock = {
  ...styleLock,
  mediumAssignments: [
    styleLock.mediumAssignments[0],
    {
      id: "whole-live-action-overlay",
      target: { scope: "whole" as const },
      implementation: createNeutralVisualImplementation("live_action"),
      compositingRole: "overlay" as const,
      priority: 200,
    },
    ...styleLock.mediumAssignments.slice(1),
  ],
};
const layeredWholeFullProjection = projectVisualStyleForArtifact({
  styleLock: layeredWholeStyleLock,
  intent: "final_frame",
});
const layeredWholeHeroProjection = projectVisualStyleForArtifact({
  styleLock: layeredWholeStyleLock,
  intent: "final_frame",
  target: { entityType: "character", entityId: "hero" },
});
const layeredWholeUnassignedProjection = projectVisualStyleForArtifact({
  styleLock: layeredWholeStyleLock,
  intent: "final_frame",
  target: { entityType: "location", entityId: "unassigned-location" },
});
const layeredWholeMultiProjection = projectVisualStyleForArtifact({
  styleLock: layeredWholeStyleLock,
  intent: "final_frame",
  targets: [
    { entityType: "character", entityId: "hero" },
    { entityType: "location", entityId: "unassigned-location" },
  ],
});
const multipleWholeBaseProjection = projectVisualStyleForArtifact({
  styleLock: {
    ...styleLock,
    mediumAssignments: [
      styleLock.mediumAssignments[0],
      { ...styleLock.mediumAssignments[0], id: "second-whole-base", priority: 200 },
    ],
  },
  intent: "final_frame",
});
const storyboardText = printable(storyboardProjection);
const finalText = printable(finalProjection);
assert.doesNotMatch(storyboardText, /fingerprint clay|painted wood|wire armature|hand-finished miniature/i);
assert.match(finalText, /fingerprint clay|painted wood|wire armature|hand-finished miniature/i);
assert.doesNotMatch(printable(assetProjection.treatment), /fingerprint clay|painted wood|wire armature|hand-finished miniature/i);
assert.equal(assetProjection.implementation?.appearance?.realism, "stylized");
assert.equal(assetProjection.implementation?.appearance?.finish, undefined);
assert.deepEqual(assetProjection.implementation?.appearance?.descriptors, ["tactile miniature silhouette"]);
assert.deepEqual(
  finalProjection.mediumAssignments.map((item) => item.id),
  ["z-whole-base", "character-ink-overlay", "atmosphere-layer"],
  "mixed-media assignments must preserve explicit entity and layer targets",
);
assert.deepEqual(finalProjection.appliedMediumAssignmentIds, ["z-whole-base", "character-ink-overlay", "atmosphere-layer"]);
assert.deepEqual(heroProjection.appliedMediumAssignmentIds, ["z-whole-base", "character-ink-overlay"]);
assert.deepEqual(heroProjection.mediumAssignments.map((item) => item.id), ["z-whole-base", "character-ink-overlay"]);
assert.equal(heroProjection.implementation?.productionMode, "2d_animation");
assert.equal(multiTargetProjection.targetSelection.mode, "targeted");
assert.equal(multiTargetProjection.targetSelection.targets.length, 2);
assert.deepEqual(multiTargetProjection.appliedMediumAssignmentIds, ["z-whole-base", "character-ink-overlay"]);
assert.equal(
  multiTargetProjection.implementation?.productionMode,
  "stop_motion",
  "multi-target projection must keep the whole/base implementation instead of promoting the last entity medium",
);
assert.doesNotMatch(printable(multiTargetProjection), /atmosphere-layer/);
assert.equal(emptyTargetProjection.targetSelection.mode, "targeted");
assert.deepEqual(emptyTargetProjection.targetSelection.targets, []);
assert.deepEqual(emptyTargetProjection.appliedMediumAssignmentIds, ["z-whole-base"]);
assert.equal(emptyTargetProjection.implementation?.productionMode, "stop_motion");
assert.equal(layeredWholeFullProjection.implementation?.productionMode, "stop_motion");
assert.ok(layeredWholeFullProjection.appliedMediumAssignmentIds.includes("whole-live-action-overlay"));
assert.equal(layeredWholeHeroProjection.implementation?.productionMode, "2d_animation");
assert.equal(layeredWholeUnassignedProjection.implementation?.productionMode, "stop_motion");
assert.equal(layeredWholeMultiProjection.implementation?.productionMode, "stop_motion");
assert.ok(!layeredWholeFullProjection.issues.some((issue) => issue.severity === "blocking"));
assert.match(printable(layeredWholeFullProjection.mediumAssignments), /live_action/);
assert.equal(multipleWholeBaseProjection.implementation, undefined);
assert.ok(multipleWholeBaseProjection.issues.some((issue) => issue.code === "MIXED_MEDIA_BASE_ASSIGNMENT_INVALID"));
assert.throws(() => renderVisualStyleProjectionInstruction(multipleWholeBaseProjection), /blocking issues/);
assert.equal(finalProjection.implementation?.productionMode, "stop_motion");
assert.equal(finalProjection.compositingEnvelope?.productionMode, "mixed_media");
assert.equal(heroProjection.compositingEnvelope?.productionMode, "mixed_media");
assert.equal(videoProjection.compositingEnvelope?.productionMode, "mixed_media");
assert.deepEqual(atmosphereLayerProjection.appliedMediumAssignmentIds, ["z-whole-base", "atmosphere-layer"]);
assert.equal(atmosphereLayerProjection.implementation?.productionMode, "3d_animation");
const renderedAtmosphereLayer = renderVisualStyleProjectionInstruction(atmosphereLayerProjection, {
  assignmentTargetLabels: { "atmosphere-layer": "当前镜头的大气视觉层" },
});
assert.match(renderedAtmosphereLayer.instruction, /当前镜头的大气视觉层/);
assert.doesNotMatch(renderedAtmosphereLayer.instruction, /character-ink-overlay/);
for (const projection of [finalProjection, heroProjection, videoProjection]) {
  const envelope = projection.compositingEnvelope?.specification;
  assert.equal(envelope?.kind, "mixed_media");
  assert.match(printable(envelope), /layer stack/);
  assert.match(printable(envelope), /preserve declared boundaries/);
  assert.match(printable(envelope), /explicit transitions only/);
  assert.match(printable(envelope), /shared contact plane/);
}
assert.match(printable(assetProjection.compositingEnvelope?.specification), /layer stack/);
assert.match(printable(assetProjection.compositingEnvelope?.specification), /preserve declared boundaries/);
assert.doesNotMatch(printable(assetProjection.compositingEnvelope?.specification), /explicit transitions only|shared contact plane/);
assert.match(printable(storyboardProjection.compositingEnvelope?.specification), /explicit transitions only/);
assert.match(printable(storyboardProjection.compositingEnvelope?.specification), /shared contact plane/);
assert.doesNotMatch(printable(storyboardProjection.compositingEnvelope?.specification), /layer stack|preserve declared boundaries/);
const suppressedTechniqueProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
  requestOverride: {
    schemaVersion: "visual-local-override.v1",
    implementation: { techniques: { mode: "suppress" } },
  },
});
assert.equal(suppressedTechniqueProjection.implementation?.techniques, undefined);
const restoredOverrideProjection = projectVisualStyleForArtifact({
  styleLock,
  intent: "final_frame",
  assetOverride: {
    schemaVersion: "visual-local-override.v1",
    implementation: { techniques: { mode: "suppress" } },
    treatment: { camera: { mode: "suppress" } },
    mediumAssignments: { mode: "suppress" },
  },
  requestOverride: {
    schemaVersion: "visual-local-override.v1",
    implementation: { techniques: { mode: "set", value: ["explicitly restored technique"] } },
    treatment: { camera: { mode: "set", value: ["explicitly restored camera rule"] } },
    mediumAssignments: { mode: "set", value: styleLock.mediumAssignments },
  },
});
assert.deepEqual(restoredOverrideProjection.implementation?.techniques, ["explicitly restored technique"]);
assert.deepEqual(restoredOverrideProjection.treatment.camera, ["explicitly restored camera rule"]);
assert.ok(!restoredOverrideProjection.suppressedFields.includes("visualImplementation.techniques"));
assert.ok(!restoredOverrideProjection.suppressedFields.includes("treatment.camera"));
assert.ok(!restoredOverrideProjection.suppressedFields.includes("mediumAssignments"));
const renderedHeroProjection = renderVisualStyleProjectionInstruction(heroProjection, {
  assignmentTargetLabels: { "character-ink-overlay": "hero character" },
});
assert.match(renderedHeroProjection.instruction, /hero character/);
assert.doesNotMatch(renderedHeroProjection.instruction, /character-ink-overlay|entityId|hero\"/);
assert.doesNotMatch(renderedHeroProjection.instruction, /atmosphere-layer/);
const renderedStoryboardProjection = renderVisualStyleProjectionInstruction(storyboardProjection);
assert.doesNotMatch(
  renderedStoryboardProjection.instruction,
  /assignment fingerprints|assignment final stage lighting/i,
);
assert.equal(renderedStoryboardProjection.manifest.schemaVersion, "visual-compile-manifest.v1");
assert.equal(renderedStoryboardProjection.manifest.appliedMediumProfiles.length, 3);
assert.equal(renderedStoryboardProjection.manifest.compositingEnvelopeProfile?.id, "visual-medium.mixed-media");
assert.ok(renderedStoryboardProjection.manifest.blockIds.includes("visual.compositing_envelope"));
const renderedVideoProjection = renderVisualStyleProjectionInstruction(videoProjection, {
  assignmentTargetLabels: { "character-ink-overlay": "hero character" },
});
assert.match(renderedVideoProjection.instruction, /Mixed-media compositing envelope/);
assert.match(renderedVideoProjection.instruction, /shared contact plane/);

console.log("[visual-style-profile] formal readiness");
const completeStopMotion: Extract<VisualImplementationMedium, { productionMode: "stop_motion" }> = {
  ...createNeutralVisualImplementation("stop_motion"),
  appearance: { realism: "stylized", dimensionality: "physical_miniature", finish: "polished", descriptors: ["tactile"] },
  techniques: ["replacement animation"],
  specification: {
    kind: "stop_motion" as const,
    fabrication: ["clay"],
    setConstructionAndScale: ["locked miniature set, puppet, and prop scales"],
    puppetConstruction: ["replaceable face puppet"],
    armatureBehavior: ["stable armature"],
    replacementAnimation: ["replacement mouth"],
    frameCadence: ["held frames by intent"],
    captureAndMotionControl: ["locked camera, per-frame exposure, and repeatable motion-control moves"],
    stageLighting: ["miniature stage lighting"],
    materialImperfections: ["visible fingerprints"],
    rigRemovalAndCompositing: ["remove support rigs while retaining intentional contact shadows"],
  },
};
const completeStopMotionTreatment = {
  ...styleLock.treatment,
  color: ["muted teal and warm amber"],
  surface: ["tactile fabricated surfaces"],
  lighting: ["single coherent miniature-stage key direction"],
  camera: ["deliberate miniature-scale camera language"],
  movement: ["held-frame motion with intentional acceleration"],
  composition: ["clear subject hierarchy and spatial continuity"],
  materials: ["clay, fabric, painted wood, and wire armature"],
  readability: ["silhouette and action remain readable at storyboard scale"],
  constraints: ["do not hide canonical identity or fabricate undeclared media layers"],
  directives: ["tactile handcrafted stop-motion world"],
};
const stopLock = normalizeLegacyVisualStyleLock({
  schemaVersion: "visual-style-lock.v3",
  revision: 2,
  visualImplementation: completeStopMotion,
  treatment: completeStopMotionTreatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1, basedOnRevision: 2 },
} as never).lock;
const stopStoryboard = projectVisualStyleForArtifact({ styleLock: stopLock, intent: "storyboard_control" });
const stopFinal = projectVisualStyleForArtifact({ styleLock: stopLock, intent: "final_frame" });
assert.doesNotMatch(printable(stopStoryboard.implementation?.specification), /visible fingerprints/i);
assert.match(printable(stopFinal.implementation?.specification), /visible fingerprints/i);

const neutralReadiness = validateVisualStyleReadiness({
  schemaVersion: "visual-style-lock.v3",
  revision: 1,
  contentHash: "seed",
  visualImplementation: createNeutralVisualImplementation("stop_motion"),
  treatment: completeStopMotionTreatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
}, { formal: true });
assert.equal(neutralReadiness.ready, false);
assert.ok(neutralReadiness.missingFields.some((field) => field.path.endsWith("fabrication")));
const completeReadiness = validateVisualStyleReadiness({
  schemaVersion: "visual-style-lock.v3",
  revision: 2,
  contentHash: "complete",
  visualImplementation: completeStopMotion,
  treatment: completeStopMotionTreatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
}, { formal: true });
assert.equal(completeReadiness.ready, true);
const invalidEnumImplementation = structuredClone(completeStopMotion) as VisualImplementationMedium;
invalidEnumImplementation.appearance.realism = "cinematic" as never;
if (invalidEnumImplementation.specification.kind === "stop_motion") {
  invalidEnumImplementation.specification.frameCadence = ["   "];
}
const invalidEnumReadiness = validateVisualStyleReadiness({
  schemaVersion: "visual-style-lock.v3",
  revision: 2,
  contentHash: "invalid-enum",
  visualImplementation: invalidEnumImplementation,
  treatment: completeStopMotionTreatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
}, { formal: true });
assert.equal(invalidEnumReadiness.ready, false);
assert.ok(invalidEnumReadiness.issues.some((issue) => issue.code === "VISUAL_APPEARANCE_VALUE_INVALID"));
assert.ok(invalidEnumReadiness.issues.some((issue) => issue.path.endsWith("frameCadence") && issue.code === "VISUAL_SPECIFICATION_VALUE_MISSING"));

const executableStopLock = {
  ...stopLock,
  humanApprovalState: "approved" as const,
  sourceReview: { status: "review_recommended" as const, changedFields: ["creativeVision.visualStyle"], detectedAt: 2 },
};
assert.doesNotThrow(() => assertVisualStyleReadyForExecution(executableStopLock, "final_frame"));
assert.doesNotThrow(() => assertVisualStyleReadyForExecution(executableStopLock, "video_clip"));
for (const humanApprovalState of [undefined, "draft", "pending_review", "rejected"] as const) {
  assert.doesNotThrow(
    () => assertVisualStyleReadyForExecution({ ...stopLock, humanApprovalState }, "final_frame"),
    "Author-directed generation must not require an approval workflow",
  );
}
assert.doesNotThrow(
  () => assertVisualStyleReadyForExecution({ ...executableStopLock, visualImplementation: createNeutralVisualImplementation("stop_motion") }, "asset_identity"),
  "Missing creative detail is guidance, not a generation prerequisite",
);
assert.doesNotThrow(() => assertVisualStyleReadyForExecution(undefined, "video_clip"));
assert.throws(() => assertVisualStyleReadyForExecution({ ...executableStopLock, mediumAssignments: {} as never }, "final_frame"), /无法使用的数据/);
assert.doesNotThrow(() => assertVisualStyleReadyForExecution(undefined, "direction_preview"));
assert.doesNotThrow(() => assertVisualStyleReadyForExecution({ humanApprovalState: "draft" }, "storyboard_control"));
const mixedReadiness = validateVisualStyleReadiness({
  ...styleLock,
  sourceReview: { status: "current", changedFields: [], detectedAt: 1 },
}, { formal: true });
assert.equal(mixedReadiness.ready, false);
assert.ok(mixedReadiness.issues.some((issue) => issue.path.includes("mediumAssignments.character-ink-overlay")));

const structurallyInvalidMixedReadiness = validateVisualStyleReadiness({
  ...styleLock,
  mediumAssignments: [
    ...styleLock.mediumAssignments,
    {
      id: "",
      target: { scope: "layer", layerId: "", label: "", description: "" },
      implementation: createNeutralVisualImplementation("2d_animation"),
      compositingRole: "overlay",
      priority: Number.POSITIVE_INFINITY,
    },
  ],
}, { formal: true });
for (const code of [
  "MIXED_MEDIA_ASSIGNMENT_ID_MISSING",
  "MIXED_MEDIA_ASSIGNMENT_LAYER_ID_MISSING",
  "MIXED_MEDIA_ASSIGNMENT_PRIORITY_INVALID",
]) {
  assert.ok(structurallyInvalidMixedReadiness.issues.some((issue) => issue.code === code), `${code} must be diagnosed`);
}

const nonMixedWithAssignments = validateVisualStyleReadiness({
  ...stopLock,
  mediumAssignments: [styleLock.mediumAssignments[0]],
}, { formal: true });
assert.ok(nonMixedWithAssignments.issues.some((issue) => issue.code === "MEDIUM_ASSIGNMENTS_REQUIRE_MIXED_MEDIA"));

const mixedWithEntityBase = validateVisualStyleReadiness({
  ...styleLock,
  mediumAssignments: styleLock.mediumAssignments.map((assignment) => assignment.compositingRole === "base"
    ? { ...assignment, target: { scope: "entity" as const, entityType: "location" as const, entityId: "stage" } }
    : assignment),
}, { formal: true });
assert.ok(mixedWithEntityBase.issues.some((issue) => issue.code === "MIXED_MEDIA_BASE_ASSIGNMENT_MUST_TARGET_WHOLE"));

const repeatedTargetAssignments = [
  styleLock.mediumAssignments[0],
  { ...styleLock.mediumAssignments[1], id: "hero-low", priority: 1 },
  { ...styleLock.mediumAssignments[1], id: "hero-high", priority: 2 },
];
const orderedTargetReadiness = validateVisualStyleReadiness({
  ...styleLock,
  mediumAssignments: repeatedTargetAssignments,
}, { formal: true });
assert.ok(!orderedTargetReadiness.issues.some((issue) => issue.code === "MIXED_MEDIA_ASSIGNMENT_TARGET_CONFLICT"));
const ambiguousTargetProjection = projectVisualStyleForArtifact({
  styleLock: {
    ...styleLock,
    mediumAssignments: repeatedTargetAssignments.map((assignment) => (
      assignment.target.scope === "entity" ? { ...assignment, priority: 1 } : assignment
    )),
  },
  intent: "final_frame",
  target: { entityType: "character", entityId: "hero" },
});
assert.ok(ambiguousTargetProjection.issues.some((issue) => issue.code === "AMBIGUOUS_MEDIUM_ASSIGNMENT_PRECEDENCE"));
assert.throws(() => renderVisualStyleProjectionInstruction(ambiguousTargetProjection), /blocking issues/);

const malformedAssignmentsProjection = projectVisualStyleForArtifact({
  styleLock: { ...styleLock, mediumAssignments: { invalid: true } as never },
  intent: "final_frame",
});
assert.ok(malformedAssignmentsProjection.issues.some((issue) => (
  issue.code === "MALFORMED_MEDIUM_ASSIGNMENTS" && issue.severity === "blocking"
)));
assert.throws(() => renderVisualStyleProjectionInstruction(malformedAssignmentsProjection), /blocking issues/);
const malformedAssignmentProjection = projectVisualStyleForArtifact({
  styleLock: { ...styleLock, mediumAssignments: [null as never, styleLock.mediumAssignments[0]] },
  intent: "video_clip",
});
assert.ok(malformedAssignmentProjection.issues.some((issue) => (
  issue.code === "MALFORMED_MEDIUM_ASSIGNMENT" && issue.severity === "blocking"
)));
assert.equal(malformedAssignmentProjection.compositingEnvelope?.productionMode, "mixed_media");
assert.throws(() => renderVisualStyleProjectionInstruction(malformedAssignmentProjection), /blocking issues/);
const malformedAssignmentsReadiness = validateVisualStyleReadiness({
  ...styleLock,
  mediumAssignments: { invalid: true } as never,
}, { formal: true });
assert.equal(malformedAssignmentsReadiness.ready, false);
assert.ok(malformedAssignmentsReadiness.issues.some((issue) => issue.code === "MALFORMED_MEDIUM_ASSIGNMENTS"));
const malformedAssignmentReadiness = validateVisualStyleReadiness({
  ...styleLock,
  mediumAssignments: [null as never],
}, { formal: true });
assert.equal(malformedAssignmentReadiness.ready, false);
assert.ok(malformedAssignmentReadiness.issues.some((issue) => issue.code === "MALFORMED_MEDIUM_ASSIGNMENT"));

const inherited = applyVisualOverrideValue("project value", { mode: "inherit" } as VisualOverrideValue<string>);
assert.equal(inherited.value, "project value");
const set = applyVisualOverrideValue("project value", { mode: "set", value: "shot value" } as VisualOverrideValue<string>);
assert.equal(set.value, "shot value");
const suppressed = applyVisualOverrideValue("project value", { mode: "suppress" } as VisualOverrideValue<string>);
assert.equal(suppressed.value, undefined);
assert.equal(suppressed.suppressed, true);

console.log("Visual style profile self-check passed.");
