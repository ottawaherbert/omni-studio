import assert from "node:assert/strict";

import type {
  VisualArtifactIntent,
  VisualCompileManifest,
  VisualProductionMode,
} from "../packages/domain/src/index";
import {
  assertVisualRecipeRuntimeContractReady,
  evaluateVisualRecipeRuntimeContract,
  getVisualTaskRecipeForIntent,
} from "../packages/production/src/services/production/visualTaskRecipes";
import {
  createLegacyVideoGenerationIntent,
  evaluateVideoVisualRecipeRuntimeContract,
} from "../packages/production/src/services/production/videoGenerationIntent";
import {
  buildLegacyGenericVideoRequest,
  compileGenericVideoAdapterPlan,
  GENERIC_FL2V_ADAPTER_ID,
} from "../packages/production/src/services/production/adapters/genericVideoAdapter";
import {
  compileImageGenerationRequest,
  createVisualRecipeInputEvidence,
} from "../src/services/production/imageGenerationRequest";

const compileManifest = (
  intent: VisualArtifactIntent,
  productionMode: VisualProductionMode,
): VisualCompileManifest => {
  const recipe = getVisualTaskRecipeForIntent(intent);
  return {
    schemaVersion: "visual-compile-manifest.v1",
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    intent,
    presentation: recipe.defaultPresentation,
    targetSelection: { mode: "full_frame", targets: [] },
    sourceStyle: { resolvedContentHash: `style-${productionMode}` },
    mediumProfile: { id: `visual-medium.${productionMode}`, version: "1.0.0" },
    appliedMediumProfiles: [],
    appliedMediumAssignmentIds: [],
    suppressedFields: [],
    issueCodes: [],
    blockIds: ["visual.artifact", "visual.implementation"],
  };
};

const missingDraft = evaluateVisualRecipeRuntimeContract({
  intent: "asset_state",
  enforcement: "draft",
});
assert.ok(missingDraft.issues.every((issue) => issue.severity === "warning"));
assert.doesNotThrow(() => missingDraft, "draft evaluation must report gaps without blocking authoring");

const missingFormal = evaluateVisualRecipeRuntimeContract({
  intent: "asset_state",
  enforcement: "formal",
});
assert.throws(
  () => assertVisualRecipeRuntimeContractReady(missingFormal),
  /结构化证据|尚未完成/,
  "formal generation must reject missing recipe evidence",
);

const standaloneImage = compileImageGenerationRequest({
  promptCore: "自由概念草图：一盏放在窗边的旧台灯。",
}, { enforcement: "formal" });
assert.equal(standaloneImage.visualRecipeContract, undefined, "standalone ImageGen has no project artifact Recipe to fake");
assert.match(standaloneImage.providerPrompt, /旧台灯/);

for (const productionMode of [
  "live_action",
  "2d_animation",
  "3d_animation",
  "stop_motion",
  "mixed_media",
] satisfies VisualProductionMode[]) {
  const compiled = compileImageGenerationRequest({
    promptCore: "一份作者确认的主体身份设计，保持轮廓、比例、材质与可识别特征。",
    visualStyleProjection: {
      artifactIntent: "asset_identity",
      recipeId: getVisualTaskRecipeForIntent("asset_identity").id,
      recipeVersion: getVisualTaskRecipeForIntent("asset_identity").version,
      instruction: `Use the approved ${productionMode} implementation.`,
      compileManifest: compileManifest("asset_identity", productionMode),
    },
    visualRecipeInputEvidence: {
      identity_facts: createVisualRecipeInputEvidence("TestAsset.canonicalIdentity", {
        name: "林遥",
        silhouette: "short coat and square satchel",
      }),
    },
  }, { enforcement: "formal" });
  assert.equal(compiled.visualRecipeContract?.requiredInputs[0]?.status, "satisfied");
  assert.ok(compiled.visualRecipeContract?.workflowStages.every((stage) => stage.status === "completed"));
  assert.ok(compiled.visualRecipeContract?.acceptanceChecks.every((check) => check.status === "pending_review"));
  assert.equal(
    compiled.visualStyleProjection?.compileManifest?.recipeContract?.enforcement,
    "formal",
    `${productionMode} must retain the same formal runtime contract in its compile manifest`,
  );
  assert.doesNotMatch(compiled.providerPrompt, /Task recipe execution contract|Required evidence|Acceptance gates/);
}

const editRecipe = getVisualTaskRecipeForIntent("image_edit");
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "只修正袖口颜色。",
    visualStyleProjection: {
      artifactIntent: "image_edit",
      recipeId: editRecipe.id,
      recipeVersion: editRecipe.version,
      instruction: "Preserve the approved medium and finish.",
      compileManifest: compileManifest("image_edit", "live_action"),
    },
  }, { enforcement: "formal" }),
  /source_edit|结构化证据/,
  "an image-edit recipe cannot be sent as an unbounded generation request",
);

const mismatchedProjection = {
  artifactIntent: "asset_identity" as const,
  recipeId: "stale.asset.recipe",
  recipeVersion: "0.1.0",
  instruction: "Draft style notes.",
  compileManifest: compileManifest("asset_identity", "2d_animation"),
};
const mismatchedDraft = compileImageGenerationRequest({
  promptCore: "角色身份草稿。",
  visualStyleProjection: mismatchedProjection,
});
assert.ok(mismatchedDraft.visualRecipeContract?.issues.some((issue) => issue.code === "VISUAL_RECIPE_MANIFEST_MISMATCH"));
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "角色身份正式图。",
    visualStyleProjection: mismatchedProjection,
  }, { enforcement: "formal" }),
  /Recipe 清单|Recipe 完全一致/,
  "a stale Recipe header may be inspected as a draft but never sent to a provider",
);

const finalFrameRecipe = getVisualTaskRecipeForIntent("final_frame");
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "广角雨夜追逐，人物跑向巷口并保持上一镜位置。",
    visualStyleProjection: {
      artifactIntent: "final_frame",
      recipeId: finalFrameRecipe.id,
      recipeVersion: finalFrameRecipe.version,
      instruction: "Use the approved production implementation.",
      compileManifest: compileManifest("final_frame", "3d_animation"),
    },
  }, { enforcement: "formal" }),
  /identity_facts|shot_facts|visible_action|continuity/,
  "one fluent prompt must not impersonate separate identity, shot, action, and continuity evidence",
);

const unsupportedSilentPass = evaluateVisualRecipeRuntimeContract({
  intent: "asset_identity",
  enforcement: "formal",
  inputEvidence: { identity_facts: [{ source: "test.identity" }] },
  stageEvidence: {
    deconstruct: [{ source: "test.deconstruct" }],
    diagnose: [{ source: "test.diagnose" }],
    develop: [{ source: "test.develop" }],
    deliver: [{ source: "test.deliver" }],
  },
  acceptanceResults: {
    identity_readable: { status: "passed", evidence: [] },
  },
});
assert.throws(
  () => assertVisualRecipeRuntimeContractReady(unsupportedSilentPass),
  /不能在没有证据时被标记为通过/,
  "the system must never silently pass an output acceptance check",
);

const legacyVideoIntent = createLegacyVideoGenerationIntent({
  prompt: "人物起身走到门边，摄影机平稳跟随。",
  imageUrl: "https://example.com/start.png",
  endImageUrl: "https://example.com/end.png",
  durationSeconds: 6,
  aspectRatio: "16:9",
});
const formalVideoContract = evaluateVideoVisualRecipeRuntimeContract({
  intent: legacyVideoIntent,
  enforcement: "formal",
  adapterId: GENERIC_FL2V_ADAPTER_ID,
});
assert.doesNotThrow(() => assertVisualRecipeRuntimeContractReady(formalVideoContract));
const videoPlan = compileGenericVideoAdapterPlan({
  intent: legacyVideoIntent,
  modelConfigId: "test-video",
  adapterId: GENERIC_FL2V_ADAPTER_ID,
});
assert.equal(videoPlan.visualRecipeContract.enforcement, "draft");
assert.match(videoPlan.adapterPrompt, /<visual_recipe_contract>/);
assert.doesNotThrow(() => buildLegacyGenericVideoRequest(legacyVideoIntent, videoPlan));
assert.throws(
  () => buildLegacyGenericVideoRequest(legacyVideoIntent, {
    ...videoPlan,
    finalConfirmedPrompt: videoPlan.adapterPrompt.replace(/<visual_recipe_contract>[\s\S]*?<\/visual_recipe_contract>/, ""),
  }),
  /删除、修改或重复/,
  "the provider boundary must preserve the exact runtime contract",
);

const incompleteVideoIntent = {
  ...legacyVideoIntent,
  endState: "",
};
const incompleteVideoContract = evaluateVideoVisualRecipeRuntimeContract({
  intent: incompleteVideoIntent,
  enforcement: "formal",
  adapterId: GENERIC_FL2V_ADAPTER_ID,
});
assert.throws(() => assertVisualRecipeRuntimeContractReady(incompleteVideoContract), /end_state/);

console.log("visual recipe runtime self-check passed");
