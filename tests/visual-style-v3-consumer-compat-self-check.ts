import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildProductionModeProfile } from "../src/services/production/productionMode";
import { buildAssetBoardOverlaySpec } from "../src/services/production/productionBoardImageOverlay";
import { buildStoryboardPanelVisualPrompt } from "../src/services/production/storyboardPanelVisual";
import { buildStyleReferenceAnalysis } from "../src/services/production/styleReference";
import {
  resolveVisualImageCandidateStyleSourceStatus,
} from "../src/services/production/visualImageCandidate";
import { createNeutralVisualImplementation } from "../src/services/production/visualMediumProfiles";
import { visualStyleContentHash } from "../src/services/production/visualStyleMigration";
import { VisualImageCandidatePanel } from "../src/components/production/VisualImageCandidatePanel";
import type {
  ManualStoryboardBoard,
  ManualStoryboardBoardPanel,
  Project,
  Shot,
  VisualImageCandidate,
  VisualStyleLock,
} from "../src/types/project";

const treatment = {
  palette: ["canonical teal", "#123456"],
  color: ["restrained chroma"],
  surface: [],
  linework: ["clean canonical line"],
  lighting: ["directional window light"],
  camera: ["canonical 35mm camera language"],
  movement: [],
  composition: [],
  materials: [],
  finish: [],
  readability: [],
  constraints: [],
  directives: ["canonical V3 visual direction"],
};

const v3Lock: VisualStyleLock = {
  schemaVersion: "visual-style-lock.v3",
  revision: 3,
  contentHash: "",
  humanApprovalState: "approved",
  visualImplementation: createNeutralVisualImplementation("2d_animation"),
  treatment,
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1, basedOnRevision: 3 },
  stylePrompt: "legacy prompt must not win",
  allowedHex: ["#ABCDEF"],
  colorPalette: ["legacy red"],
  cameraLanguage: "legacy camera must not win",
};
v3Lock.contentHash = visualStyleContentHash(v3Lock);

const project = {
  id: "visual-style-v3-consumer-compat",
  title: "V3 consumer compatibility",
  type: "movie",
  characters: [],
  assets: [],
  episodes: [],
  visualStyleLock: v3Lock,
} as unknown as Project;

const boardItem = {
  boardKind: "character_board",
  assetName: "Lead",
  layoutContract: { requiredViews: ["front"], requiredStudies: ["expression"] },
} as any;

assert.deepEqual(
  buildAssetBoardOverlaySpec({ project, board: boardItem }).palette,
  ["canonical teal", "#123456"],
  "asset board overlays must use V3 treatment.palette instead of legacy palette fields",
);
assert.deepEqual(
  buildAssetBoardOverlaySpec({
    project: {
      ...project,
      visualStyleLock: {
        ...v3Lock,
        treatment: { ...treatment, palette: [] },
        allowedHex: ["#AABBCC"],
        colorPalette: ["legacy fallback"],
      },
    },
    board: boardItem,
  }).palette,
  ["#AABBCC", "legacy fallback"],
  "empty V3 palette must retain the legacy compatibility fallback",
);

assert.equal(buildProductionModeProfile(project).visualStyleLockStatus, "locked_or_seeded");
assert.equal(buildProductionModeProfile({
  type: "movie",
  visualStyleLock: { schemaVersion: "visual-style-lock.v3", humanApprovalState: "approved" },
} as any).visualStyleLockStatus, "locked_or_seeded");
assert.equal(buildProductionModeProfile({
  type: "movie",
  visualStyleLock: { schemaVersion: "visual-style-lock.v3", visualImplementation: createNeutralVisualImplementation("3d_animation") },
} as any).visualStyleLockStatus, "locked_or_seeded");
assert.equal(buildProductionModeProfile({
  type: "movie",
  visualStyleLock: { schemaVersion: "visual-style-lock.v3" },
} as any).visualStyleLockStatus, "missing_or_legacy_fallback");

const shot = {
  id: "shot-1",
  duration: 2,
  imagePrompt: "visible action",
} as Shot;
const panel = {
  id: "panel-1",
  panelNumber: 1,
  shotId: shot.id,
  durationSeconds: 2,
  framePurpose: "action beat",
  assetRefs: [],
  annotationLegendIds: [],
  actionArrowLegendIds: [],
} as ManualStoryboardBoardPanel;
const storyboard = {
  id: "board-1",
  strategyDecision: {},
  boardMode: "visual-control",
  layout: "single",
  arrowLegendIds: [],
  performanceBeatIds: [],
  scriptBlockIds: [],
  shotIds: [shot.id],
  strategyOrigin: "built_in",
  panels: [panel],
  startState: "start",
  endState: "end",
} as unknown as ManualStoryboardBoard;
const storyboardPrompt = buildStoryboardPanelVisualPrompt({
  project,
  shot,
  board: storyboard,
  panel,
  references: [],
});
assert.match(storyboardPrompt, /canonical V3 visual direction/);
assert.doesNotMatch(storyboardPrompt, /legacy prompt must not win/);

const styleReferenceAnalysis = buildStyleReferenceAnalysis(project, {});
assert.ok(styleReferenceAnalysis.cameraRead.includes("canonical 35mm camera language"));
assert.equal(styleReferenceAnalysis.cameraRead.includes("legacy camera must not win"), false);

const candidate = {
  id: "candidate-1",
  kind: "base",
  imageUrl: "https://example.test/candidate.png",
  prompt: "candidate",
  promptHash: "candidate-prompt-hash",
  modelId: "candidate-model",
  visualStyleCompileManifest: {
    schemaVersion: "visual-compile-manifest.v1",
    recipeId: "visual.asset-identity",
    recipeVersion: "1.0.0",
    intent: "asset_identity",
    presentation: "clean_reference",
    targetSelection: { mode: "full_frame", targets: [] },
    sourceStyle: {
      schemaVersion: v3Lock.schemaVersion,
      revision: v3Lock.revision,
      declaredContentHash: v3Lock.contentHash,
      resolvedContentHash: v3Lock.contentHash!,
    },
    appliedMediumProfiles: [],
    appliedMediumAssignmentIds: [],
    suppressedFields: [],
    issueCodes: [],
    blockIds: [],
  },
  createdAt: 10,
} satisfies VisualImageCandidate;
const changedLock: VisualStyleLock = {
  ...v3Lock,
  treatment: { ...treatment, palette: ["changed magenta"] },
  revision: 4,
  contentHash: "",
};
changedLock.contentHash = visualStyleContentHash(changedLock);

assert.equal(resolveVisualImageCandidateStyleSourceStatus(candidate, v3Lock), "current");
assert.equal(resolveVisualImageCandidateStyleSourceStatus(candidate, changedLock), "review_recommended");
const staleMarkup = renderToStaticMarkup(React.createElement(VisualImageCandidatePanel, {
  candidates: [candidate],
  owner: { id: "character-1", name: "测试角色" },
  visualStyleLock: changedLock,
  onAdopt: () => undefined,
  onReject: () => undefined,
}));
assert.match(staleMarkup, /来源有更新，建议复核/);
assert.match(staleMarkup, /aria-label="采用图片候选"/);
assert.doesNotMatch(staleMarkup, /aria-label="采用图片候选"[^>]*disabled/);

console.log("visual style V3 consumer compatibility self-check passed");
