import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { VisualCompileManifest } from "../packages/domain/src/visualArtifact";
import type { Asset, Character } from "../src/types/project";
import type { GlobalAsset } from "../src/store/useGlobalStore";
import {
  createImageGenerationReference,
  type CompiledImageGenerationRequest,
} from "../src/services/production/imageGenerationRequest";
import {
  adoptGlobalVisualImageCandidate,
  adoptVisualImageCandidate,
  createVisualImageCandidate,
  isProjectCharacterVisualOwner,
  rejectVisualImageCandidate,
  resolveVisualImageCandidateSourceStatus,
  resolveVisualImageCandidateStyleSourceStatus,
  upsertVisualImageCandidate,
  visualImageCandidateSourceContentHash,
} from "../src/services/production/visualImageCandidate";
import { normalizeLegacyVisualStyleLock } from "../src/services/production/visualStyleMigration";

const visualCompileManifest: VisualCompileManifest = {
  schemaVersion: "visual-compile-manifest.v1",
  recipeId: "visual.asset-identity",
  recipeVersion: "1.0.0",
  intent: "asset_identity",
  presentation: "clean_reference",
  targetSelection: {
    mode: "targeted",
    targets: [{ entityType: "character", entityId: "character-1" }],
  },
  sourceStyle: {
    schemaVersion: "visual-style-lock.v3",
    revision: 4,
    declaredContentHash: "style-hash-r4",
    resolvedContentHash: "style-hash-r4",
  },
  mediumProfile: { id: "visual-medium.2d-animation", version: "1.0.0" },
  appliedMediumProfiles: [],
  appliedMediumAssignmentIds: [],
  suppressedFields: ["treatment.camera"],
  issueCodes: [],
  blockIds: ["visual-style.asset-identity"],
};

const compiledRequest = (): CompiledImageGenerationRequest => {
  const reference = createImageGenerationReference({
    imageUrl: "https://example.test/reference.png",
    label: "canonical character identity",
    role: "character_identity",
    preserve: ["face geometry", "hair silhouette"],
    allowChange: ["pose"],
    exclude: ["reference background"],
  });
  return {
    providerPrompt: "compiled provider prompt",
    aspectRatio: "3:4",
    referenceImages: [reference.imageUrl],
    references: [reference],
    outputConstraints: ["single subject"],
    operation: { kind: "generate" },
    visualStyleProjection: {
      artifactIntent: "asset_identity",
      recipeId: visualCompileManifest.recipeId,
      recipeVersion: visualCompileManifest.recipeVersion,
      instruction: "approved project visual projection",
      targetSelection: structuredClone(visualCompileManifest.targetSelection),
      compileManifest: structuredClone(visualCompileManifest),
    },
    visibleText: [],
    manifest: {
      version: "prompt-composition/v1",
      blocks: [{
        blockId: "asset.prompt",
        source: "visual-image-candidate-self-check",
        purpose: "asset identity generation",
        charCount: 24,
        hash: "prompt-block-hash",
        required: true,
        optional: false,
        included: true,
      }],
      finalCharCount: 24,
      finalHash: "compiled-prompt-hash",
      issues: [],
    },
  };
};

const makeCandidate = (
  kind: "base" | "multiview" | "variant",
  imageUrl: string,
  variantId?: string,
) => createVisualImageCandidate({
  kind,
  variantId,
  imageUrl,
  prompt: `prompt for ${kind}`,
  modelId: "image-model-self-check",
  compiledRequest: compiledRequest(),
  sourceContentHash: visualImageCandidateSourceContentHash({
    owner: originalCharacter,
    kind,
    variantId,
  }),
  createdAt: kind === "base" ? 100 : kind === "multiview" ? 200 : 300,
});

const originalCharacter: Character = {
  id: "character-1",
  name: "Lead",
  referenceImageUrl: "canonical-character.png",
  multiViewUrl: "canonical-character-multiview.png",
  defaultReferenceUrl: "canonical-character.png",
  variants: [{
    id: "variant-1",
    name: "Rain coat",
    description: "wet weather state",
    promptModifiers: "yellow rain coat",
    imageUrl: "canonical-character-variant.png",
  }],
};
assert.equal(isProjectCharacterVisualOwner(originalCharacter), true);
assert.equal("internalDesire" in originalCharacter, false);
assert.equal(isProjectCharacterVisualOwner({
  id: "asset-type-discriminator",
  type: "prop",
  name: "Typed asset",
  description: "Asset has the required type field",
}), false);

const exactSourceCandidate = makeCandidate("base", "candidate-source-check.png");
assert.equal(resolveVisualImageCandidateSourceStatus(exactSourceCandidate, originalCharacter, undefined), "current");
assert.equal(resolveVisualImageCandidateSourceStatus(exactSourceCandidate, {
  ...originalCharacter,
  visualIdentity: "updated identity",
}, undefined), "review_recommended");

const legacyStyleLock = { stylePrompt: "legacy candidate matching style" };
const legacyStyleHash = normalizeLegacyVisualStyleLock(legacyStyleLock).lock.contentHash!;
const {
  sourceContentHash: _legacySourceContentHash,
  ...legacyCandidateWithoutSourceHash
} = exactSourceCandidate;
const legacyCandidate = {
  ...legacyCandidateWithoutSourceHash,
  id: "legacy-candidate-with-style-only-provenance",
  visualStyleCompileManifest: {
    ...structuredClone(visualCompileManifest),
    sourceStyle: {
      ...structuredClone(visualCompileManifest.sourceStyle),
      declaredContentHash: legacyStyleHash,
      resolvedContentHash: legacyStyleHash,
    },
  },
};
assert.equal(
  resolveVisualImageCandidateStyleSourceStatus(legacyCandidate, legacyStyleLock),
  "current",
  "the legacy fixture must isolate the style-only match",
);
assert.equal(
  resolveVisualImageCandidateSourceStatus(legacyCandidate, originalCharacter, legacyStyleLock),
  "review_recommended",
  "a legacy candidate without the full owner source fingerprint must never be current from style alone",
);
const adoptedLegacyCandidate = adoptVisualImageCandidate({
  ...originalCharacter,
  visualImageCandidates: [legacyCandidate],
}, legacyCandidate.id, 900, legacyStyleLock);
assert.deepEqual(
  adoptedLegacyCandidate.visualImageAdoptionAudits?.[0]?.sourceReview,
  {
    status: "review_recommended",
    reasons: ["source_fingerprint_missing"],
    detectedAt: 900,
  },
  "explicit adoption must retain a truthful missing-fingerprint audit",
);

const baseCandidate = makeCandidate("base", "candidate-character.png");
const stagedCharacter: Character = {
  ...originalCharacter,
  visualImageCandidates: upsertVisualImageCandidate(
    originalCharacter.visualImageCandidates,
    baseCandidate,
  ),
};
assert.equal(stagedCharacter.referenceImageUrl, originalCharacter.referenceImageUrl);
assert.equal(stagedCharacter.multiViewUrl, originalCharacter.multiViewUrl);
assert.equal(stagedCharacter.variants?.[0]?.imageUrl, originalCharacter.variants?.[0]?.imageUrl);
assert.deepEqual(baseCandidate.imageReferenceManifest, [{
  index: 1,
  imageUrl: "https://example.test/reference.png",
  label: "canonical character identity",
  role: "character_identity",
  preserve: ["face geometry", "hair silhouette"],
  allowChange: ["pose"],
  exclude: ["reference background"],
}]);
assert.deepEqual(baseCandidate.promptCompositionManifest, compiledRequest().manifest);
assert.deepEqual(baseCandidate.visualStyleCompileManifest, visualCompileManifest);

const adoptedBase = adoptVisualImageCandidate(stagedCharacter, baseCandidate.id, 1_000);
assert.equal(adoptedBase.referenceImageUrl, baseCandidate.imageUrl);
assert.equal(adoptedBase.visualImageCandidates?.length, 0);
assert.equal(adoptedBase.visualImageAdoptionAudits?.[0]?.slot, "base");
assert.equal(adoptedBase.visualImageAdoptionAudits?.[0]?.adoptedAt, 1_000);
assert.deepEqual(
  adoptedBase.visualImageAdoptionAudits?.[0]?.imageReferenceManifest,
  baseCandidate.imageReferenceManifest,
);
assert.deepEqual(
  adoptedBase.visualImageAdoptionAudits?.[0]?.promptCompositionManifest,
  baseCandidate.promptCompositionManifest,
);
assert.deepEqual(
  adoptedBase.visualImageAdoptionAudits?.[0]?.visualStyleCompileManifest,
  baseCandidate.visualStyleCompileManifest,
);

const multiviewCandidate = makeCandidate("multiview", "candidate-multiview.png");
const adoptedMultiview = adoptVisualImageCandidate({
  ...originalCharacter,
  visualImageCandidates: [multiviewCandidate],
}, multiviewCandidate.id, 2_000);
assert.equal(adoptedMultiview.multiViewUrl, multiviewCandidate.imageUrl);
assert.equal(adoptedMultiview.referenceImageUrl, originalCharacter.referenceImageUrl);
assert.equal(adoptedMultiview.visualImageAdoptionAudits?.[0]?.slot, "multiview");

const originalAsset: Asset = {
  id: "asset-1",
  type: "prop",
  name: "Umbrella",
  description: "Black umbrella",
  imageUrl: "canonical-asset.png",
  multiViewUrl: "canonical-asset-multiview.png",
  variants: [{
    id: "variant-1",
    name: "Broken",
    description: "damaged state",
    promptModifiers: "broken ribs",
    imageUrl: "canonical-asset-variant.png",
  }],
};
const variantCandidate = makeCandidate("variant", "candidate-variant.png", "variant-1");
const stagedAsset: Asset = {
  ...originalAsset,
  visualImageCandidates: [variantCandidate],
};
assert.equal(stagedAsset.imageUrl, originalAsset.imageUrl);
assert.equal(stagedAsset.variants?.[0]?.imageUrl, originalAsset.variants?.[0]?.imageUrl);
const adoptedVariant = adoptVisualImageCandidate(stagedAsset, variantCandidate.id, 3_000);
assert.equal(adoptedVariant.variants?.[0]?.imageUrl, variantCandidate.imageUrl);
assert.equal(adoptedVariant.imageUrl, originalAsset.imageUrl);
assert.equal(adoptedVariant.visualImageAdoptionAudits?.[0]?.slot, "variant:variant-1");

const rejected = rejectVisualImageCandidate(stagedAsset, variantCandidate.id);
assert.equal(rejected.visualImageCandidates?.length, 0);
assert.equal(rejected.imageUrl, originalAsset.imageUrl);
assert.equal(rejected.variants?.[0]?.imageUrl, originalAsset.variants?.[0]?.imageUrl);
assert.equal(rejected.visualImageAdoptionAudits, undefined);

const globalAsset: GlobalAsset = {
  id: "global-asset-1",
  type: "prop",
  name: "Global umbrella",
  description: "Reusable umbrella",
  imageUrls: ["global-canonical.png", "global-secondary.png"],
  visualImageCandidates: [baseCandidate],
  createdAt: 1,
  updatedAt: 1,
};
const adoptedGlobal = adoptGlobalVisualImageCandidate(globalAsset, baseCandidate.id, 4_000);
assert.deepEqual(adoptedGlobal.imageUrls, [
  baseCandidate.imageUrl,
  "global-canonical.png",
  "global-secondary.png",
]);
assert.equal(adoptedGlobal.visualImageAdoptionAudits?.[0]?.slot, "base");
assert.deepEqual(
  adoptedGlobal.visualImageAdoptionAudits?.[0]?.visualStyleCompileManifest,
  baseCandidate.visualStyleCompileManifest,
);
const adoptedLegacyGlobal = adoptGlobalVisualImageCandidate({
  ...globalAsset,
  visualImageCandidates: [legacyCandidate],
}, legacyCandidate.id, 4_500, legacyStyleLock);
assert.deepEqual(
  adoptedLegacyGlobal.visualImageAdoptionAudits?.[0]?.sourceReview?.reasons,
  ["source_fingerprint_missing"],
  "global legacy candidates must use the same conservative source audit",
);
assert.throws(
  () => adoptGlobalVisualImageCandidate({
    ...globalAsset,
    visualImageCandidates: [multiviewCandidate],
  }, multiviewCandidate.id, 5_000),
  /only supports|currently only|\u5168\u5c40\u8d44\u4ea7/,
);
assert.deepEqual(globalAsset.imageUrls, ["global-canonical.png", "global-secondary.png"]);

const pendingCandidates = Array.from({ length: 13 }, (_, index) => ({
  ...baseCandidate,
  id: `pending-${index}`,
  kind: "variant" as const,
  variantId: `variant-${index}`,
  createdAt: index,
}));
const fourteenthCandidate = {
  ...baseCandidate,
  id: "pending-13",
  kind: "variant" as const,
  variantId: "variant-13",
  createdAt: 13,
};
assert.equal(
  upsertVisualImageCandidate(pendingCandidates, fourteenthCandidate).length,
  14,
  "pending candidates must not be silently truncated",
);
assert.equal(
  upsertVisualImageCandidate([baseCandidate], {
    ...baseCandidate,
    id: "second-base-candidate",
    imageUrl: "second-base-candidate.png",
    createdAt: 101,
  }).length,
  2,
  "a newer result for the same slot must not silently discard the earlier pending candidate",
);

assert.throws(
  () => createVisualImageCandidate({
    kind: "base",
    imageUrl: "untracked-result.png",
    prompt: "missing compile audit",
    modelId: "image-model-self-check",
    sourceContentHash: visualImageCandidateSourceContentHash({ owner: originalCharacter, kind: "base" }),
  }),
  /compile|\u7f16\u8bd1\u5ba1\u8ba1/,
);

const read = (path: string) => readFileSync(path, "utf8");
const assetViewSource = read("src/components/bible/GlobalAssetDetailView.tsx");
const projectSource = read("src/components/production/AssetSourceMedia.tsx");
const assetBoardBatchSource = read("src/hooks/useProductionAssetBoardBatch.ts");
for (const source of [assetViewSource, projectSource]) {
  assert.match(source, /createVisualImageCandidate/);
  assert.match(source, /generationPlan: source.plan/);
  assert.match(source, /upsertVisualImageCandidate/);
}
assert.match(projectSource, /expectedProjectId: project.id/);
assert.match(projectSource, /flushDebouncedProjectSave/);
assert.match(projectSource, /current\?\.id !== project.id/);
assert.match(projectSource, /generating.sourceHash/);
assert.match(assetViewSource, /adoptGlobalVisualImageCandidate/);
assert.match(read("src/components/production/VisualImageCandidatePanel.tsx"), /onAdopt|onReject/);
const batchExecutionSection = assetBoardBatchSource.slice(
  assetBoardBatchSource.indexOf("const executeBatch"),
  assetBoardBatchSource.indexOf("const adoptCandidate"),
);
assert.match(batchExecutionSection, /setTransientCandidate\(/);
assert.match(batchExecutionSection, /stage:\s*"awaiting_review"/);
assert.doesNotMatch(batchExecutionSection, /buildProductionAssetBoardReferenceUpdate\(\{/);
assert.match(assetBoardBatchSource, /const adoptCandidate[\s\S]*legacyProjectClient\.adoptProductionAssetBoardCandidate\(/);
assert.match(assetBoardBatchSource, /legacyProjectClient\.stageProductionAssetBoardCandidate\(/, "batch candidates must be durable before review");
assert.match(assetBoardBatchSource, /legacyProjectClient\.discardProductionAssetBoardCandidate\(/, "discard must persist without mutating the canonical board");
assert.match(assetBoardBatchSource, /replaceCurrentProjectSnapshot\(savedProject\)/, "candidate API responses must only replace the matching current project");
assert.match(read("src/pages/ProductionAssets.tsx"), /ProductionAssetBoardReviewModal/);

console.log("Visual image candidate self-check passed.");
