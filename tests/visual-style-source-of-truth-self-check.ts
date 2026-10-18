import assert from "node:assert/strict";
import fs from "node:fs";

import type { Project, VisualStyleLock } from "../src/types/project";
import { buildAssetImagePrompt } from "../src/services/production/assetImagePrompt";
import { compileImageGenerationRequest } from "../src/services/production/imageGenerationRequest";
import { buildImageVisualStyleProjection } from "../src/services/production/imageVisualStyleProjection";
import { createNeutralVisualImplementation } from "../src/services/production/visualMediumProfiles";
import { visualStyleContentHash } from "../src/services/production/visualStyleMigration";
import { resolveCreativeVisionVisualFallback } from "../src/services/production/visualPromptStyleSource";

const implementation = createNeutralVisualImplementation("live_action");
implementation.appearance = {
  realism: "naturalistic",
  dimensionality: "physical_capture",
  finish: "polished",
  descriptors: ["LOCK_ONLY_COOL_CYAN"],
};
implementation.techniques = ["controlled practical capture"];
implementation.specification = {
  kind: "live_action",
  captureProcess: "digital",
  lensBehavior: ["restrained perspective"],
  cameraSupport: ["stable camera support"],
  practicalLighting: ["motivated practical light"],
  productionDesign: ["coherent physical set"],
  performanceFidelity: ["credible physical performance"],
  effectsBoundary: ["practical atmosphere only; no added VFX elements"],
  finishing: ["controlled cinematic finishing"],
};

const visualStyleLock: VisualStyleLock = {
  schemaVersion: "visual-style-lock.v3",
  revision: 3,
  contentHash: "",
  visualImplementation: implementation,
  treatment: {
    palette: [],
    color: ["LOCK_ONLY_COOL_CYAN"],
    surface: [],
    linework: [],
    lighting: ["single coherent key direction"],
    camera: ["restrained camera language"],
    movement: ["deliberate physical movement"],
    composition: ["clear subject hierarchy"],
    materials: ["physically coherent materials"],
    finish: [],
    readability: ["identity and action remain readable"],
    constraints: ["do not introduce undeclared style sources"],
    directives: ["LOCK_ONLY_COOL_CYAN"],
  },
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1, basedOnRevision: 3 },
  humanApprovalState: "approved",
};
visualStyleLock.contentHash = visualStyleContentHash(visualStyleLock);

const creativeVision = {
  genre: ["test"],
  visualStyle: "CREATIVE_ONLY_MAGENTA",
  narrativeStyle: "",
  referenceWorks: "",
  globalLook: {
    baseTexture: ["CREATIVE_ONLY_MAGENTA_TEXTURE"],
    colorGrading: ["CREATIVE_ONLY_MAGENTA_GRADE"],
    conditionalEffects: [],
  },
};
const project = { visualStyleLock, creativeVision } as Project;

const promptCore = buildAssetImagePrompt({
  assetType: "character",
  assetName: "林照",
  description: "短发，左眉有一道浅疤，深色工作服",
  visualStyle: resolveCreativeVisionVisualFallback(project),
});
const compiled = compileImageGenerationRequest({
  promptCore,
  aspectRatio: "3:4",
  visualStyleProjection: buildImageVisualStyleProjection({
    project,
    intent: "asset_identity",
    target: { entityType: "character", entityId: "char-linzhao" },
  }),
});

assert.match(compiled.providerPrompt, /LOCK_ONLY_COOL_CYAN/);
assert.doesNotMatch(compiled.providerPrompt, /CREATIVE_ONLY_MAGENTA/);
assert.match(promptCore, /短发，左眉有一道浅疤，深色工作服/);
assert.match(promptCore, /角色身份生产参考图/);
assert.doesNotMatch(promptCore, /概念图|cinematic portrait|concept art/i);
assert.doesNotMatch(promptCore, /视觉锚点/);

assert.match(
  resolveCreativeVisionVisualFallback({ creativeVision, visualStyleLock: undefined } as Pick<Project, "creativeVision" | "visualStyleLock">),
  /CREATIVE_ONLY_MAGENTA/,
);
assert.match(
  resolveCreativeVisionVisualFallback({
    creativeVision,
    visualStyleLock: { ...visualStyleLock, humanApprovalState: "rejected" },
  } as Pick<Project, "creativeVision" | "visualStyleLock">),
  /CREATIVE_ONLY_MAGENTA/,
);

const bibleHookSource = fs.readFileSync(new URL("../src/hooks/useBibleAI.ts", import.meta.url), "utf8");
const assetViewSource = fs.readFileSync(new URL("../src/components/bible/AssetDetailView.tsx", import.meta.url), "utf8");
const storyboardHookSource = fs.readFileSync(new URL("../src/hooks/useStoryboardAI.ts", import.meta.url), "utf8");
const legacyVisualPromptSource = fs.readFileSync(new URL("../src/config/prompts/visuals.ts", import.meta.url), "utf8");
assert.doesNotMatch(
  legacyVisualPromptSource,
  /character turnaround sheet, concept art|cinematic lighting, photorealistic detail/i,
  "legacy prompt helpers must not force live-action or concept-art rendering over the declared project medium",
);
assert.equal(
  (bibleHookSource.match(/visualStyle: resolveCreativeVisionVisualFallback\(latestProject\)/g) || []).length,
  5,
  "all Bible image prompt entry points must resolve the canonical style source before composing promptCore",
);
assert.equal(
  (assetViewSource.match(/visualStyle: resolveCreativeVisionVisualFallback\(type === 'project' \? currentProject : undefined\)/g) || []).length,
  2,
  "base and variant image prompts must share the canonical style-source resolver",
);
assert.equal(
  (storyboardHookSource.match(/resolveCreativeVisionVisualFallback\(currentProject\)/g) || []).length,
  5,
  "scene, segment, batch, and single-shot storyboard prompt entry points must share the canonical style-source resolver",
);
assert.doesNotMatch(
  storyboardHookSource,
  /formatVisualCreativeVision\(currentProject\.creativeVision\)/,
  "an approved style lock must not be paired with a second creativeVision style source in storyboard prompts",
);

console.log("Visual style source-of-truth self-check passed.");
