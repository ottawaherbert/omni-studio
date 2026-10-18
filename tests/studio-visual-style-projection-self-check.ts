import assert from "node:assert/strict";
import fs from "node:fs";

import { createNeutralVisualImplementation } from "../src/services/production/visualMediumProfiles";
import {
  createVisualStyleLockDraft,
  visualStyleContentHash,
} from "../src/services/production/visualStyleMigration";
import {
  buildStudioShotImageVisualStyleProjection,
  buildStudioShotVideoVisualStyleProjection,
  buildStudioShotVisualTargets,
} from "../src/services/production/studioShotVisualStyle";

const completeImplementation = (productionMode: "live_action" | "2d_animation" | "3d_animation" | "mixed_media", descriptor: string) => {
  const implementation = createNeutralVisualImplementation(productionMode) as any;
  implementation.appearance = {
    realism: productionMode === "live_action" ? "naturalistic" : "stylized",
    dimensionality: productionMode === "live_action" ? "physical_capture" : productionMode === "2d_animation" ? "layered_2d" : productionMode === "3d_animation" ? "volumetric_3d" : "hybrid",
    finish: "polished",
    descriptors: [descriptor],
  };
  implementation.techniques = [`${productionMode} production technique`];
  if (productionMode === "live_action") implementation.specification = {
    kind: "live_action",
    captureProcess: "digital",
    lensBehavior: ["controlled perspective"],
    cameraSupport: ["stable support"],
    practicalLighting: ["motivated practical light"],
    productionDesign: ["coherent physical set"],
    performanceFidelity: ["credible physical performance"],
    effectsBoundary: ["practical atmosphere; no undeclared VFX"],
    finishing: ["controlled finishing"],
  };
  if (productionMode === "2d_animation") implementation.specification = {
    kind: "2d_animation",
    animationMethod: "hand_drawn",
    lineSystem: ["stable line system"],
    colorApplication: ["consistent color blocks"],
    depthStrategy: ["layered depth"],
    layoutAndBackground: ["authored layout and reusable background system"],
    performanceAndCleanup: ["preserve authored performance, deformation limits, and key/in-between/cleanup consistency"],
    motionCadence: ["authored cadence"],
    effectsAnimation: ["declared hand-drawn effects only"],
    compositing: ["clean 2d composite"],
  };
  if (productionMode === "3d_animation") implementation.specification = {
    kind: "3d_animation",
    modelingLanguage: ["coherent modeled forms"],
    shadingModel: ["stylized physically coherent shading"],
    lightingPipeline: ["controlled 3d lighting"],
    riggingSystem: ["stable character and prop rigging"],
    animationSystem: ["keyframed animation with declared procedural assists"],
    simulationPolicy: ["bounded simulation"],
    renderCharacter: ["stable render character"],
    compositing: ["integrated 3d composite"],
  };
  if (productionMode === "mixed_media") implementation.specification = {
    kind: "mixed_media",
    compositingModel: ["declared layer stack"],
    integrationRules: ["shared color and edge logic"],
    transitionRules: ["explicit authored transitions"],
    contactAndShadowRules: ["coherent contact and shadow"],
  };
  return implementation;
};

const visualStyleLock = createVisualStyleLockDraft({ productionMode: "mixed_media" });
visualStyleLock.visualImplementation = completeImplementation("mixed_media", "approved mixed-media finish");
visualStyleLock.treatment = {
  palette: [],
  color: ["controlled project color relationship"],
  surface: [],
  linework: [],
  lighting: ["coherent light direction"],
  camera: [],
  movement: ["consistent motion language"],
  composition: ["clear subject hierarchy"],
  materials: [],
  finish: [],
  readability: ["subjects and action remain readable"],
  constraints: ["do not alter canonical identity"],
  directives: ["approved mixed-media production image"],
};
visualStyleLock.mediumAssignments = [
  {
    id: "assignment-shot-base",
    target: { scope: "whole" },
    implementation: completeImplementation("2d_animation", "base 2d implementation"),
    compositingRole: "base",
    priority: 1,
  },
  {
    id: "assignment-current-character",
    target: { scope: "entity", entityType: "character", entityId: "char-current" },
    implementation: completeImplementation("2d_animation", "current character implementation"),
    compositingRole: "embedded",
    priority: 20,
  },
  {
    id: "assignment-current-location",
    target: { scope: "entity", entityType: "location", entityId: "loc-current" },
    implementation: completeImplementation("3d_animation", "current location implementation"),
    compositingRole: "embedded",
    priority: 10,
  },
  {
    id: "assignment-unrelated-character",
    target: { scope: "entity", entityType: "character", entityId: "char-unrelated" },
    implementation: completeImplementation("live_action", "unrelated character implementation"),
    compositingRole: "overlay",
    priority: 30,
  },
  {
    id: "assignment-active-atmosphere",
    target: { scope: "layer", layerId: "layer-atmosphere", label: "环境雾层", description: "承载空间中的体积雾与空气透视" },
    implementation: completeImplementation("3d_animation", "active atmosphere layer implementation"),
    compositingRole: "effect",
    priority: 40,
  },
  {
    id: "assignment-inactive-interface",
    target: { scope: "layer", layerId: "layer-interface", label: "界面叠加层", description: "承载屏幕内可见的二维界面图形" },
    implementation: completeImplementation("2d_animation", "inactive interface layer implementation"),
    compositingRole: "overlay",
    priority: 50,
  },
];
visualStyleLock.contentHash = visualStyleContentHash(visualStyleLock);

const project = {
  id: "studio-project",
  visualStyleLock: {
    ...visualStyleLock,
    humanApprovalState: "approved",
  },
  characters: [
    { id: "char-current", name: "当前角色" },
    { id: "char-unrelated", name: "无关角色" },
  ],
  assets: [
    { id: "loc-current", type: "location", name: "当前场景" },
    { id: "prop-current", type: "prop", name: "当前道具" },
    { id: "prop-unrelated", type: "prop", name: "无关道具" },
  ],
} as any;
const shot = {
  id: "shot-current",
  characterIdsInShot: ["char-current"],
  locationId: "loc-current",
  propIds: ["prop-current"],
  activeVisualLayerIds: ["layer-atmosphere"],
} as any;

const targets = buildStudioShotVisualTargets(project, shot);
assert.deepEqual(targets, [
  { entityType: "character", entityId: "char-current" },
  { entityType: "location", entityId: "loc-current" },
  { entityType: "prop", entityId: "prop-current" },
  { layerId: "layer-atmosphere" },
]);

const imageProjection = buildStudioShotImageVisualStyleProjection({ project, shot });
assert.equal(imageProjection.artifactIntent, "final_frame");
assert.deepEqual(imageProjection.targetSelection?.targets, targets);
assert.deepEqual([...(imageProjection.compileManifest?.appliedMediumAssignmentIds || [])].sort(), [
  "assignment-shot-base",
  "assignment-current-character",
  "assignment-current-location",
  "assignment-active-atmosphere",
].sort());
assert.match(imageProjection.instruction, /当前角色/);
assert.match(imageProjection.instruction, /当前场景/);
assert.match(imageProjection.instruction, /active atmosphere layer implementation/);
assert.doesNotMatch(imageProjection.instruction, /inactive interface layer implementation/);
assert.doesNotMatch(imageProjection.instruction, /无关角色|assignment-|char-current|char-unrelated|loc-current|prop-current/);

const videoProjection = buildStudioShotVideoVisualStyleProjection({ project, shot });
assert.equal(videoProjection.projection.intent, "video_clip");
assert.deepEqual(videoProjection.projection.targetSelection.targets, targets);
assert.deepEqual([...videoProjection.rendered.manifest.appliedMediumAssignmentIds].sort(), [
  "assignment-shot-base",
  "assignment-current-character",
  "assignment-current-location",
  "assignment-active-atmosphere",
].sort());
assert.match(videoProjection.rendered.instruction, /当前角色/);
assert.match(videoProjection.rendered.instruction, /当前场景/);
assert.match(videoProjection.rendered.instruction, /active atmosphere layer implementation/);
assert.doesNotMatch(videoProjection.rendered.instruction, /inactive interface layer implementation/);
assert.doesNotMatch(videoProjection.rendered.instruction, /无关角色|assignment-|char-current|char-unrelated|loc-current|prop-current/);

const studioHook = fs.readFileSync(new URL("../src/hooks/useStudioAI.ts", import.meta.url), "utf8");
assert.match(studioHook, /visualStyleProjection:\s*buildStudioShotImageVisualStyleProjection/);
assert.match(studioHook, /buildStudioShotVideoVisualStyleProjection/);
assert.match(studioHook, /visualStyleProjection\.rendered\.instruction/);

console.log("Studio visual style projection self-check passed.");
