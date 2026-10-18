import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  buildAssetBoardMediaPrompt,
  buildMediaStoryboardCameraContract,
  buildMediaStoryboardControlTemplateSvg,
  buildStoryboardBoardMediaPrompt,
  classifyStoryboardReferenceReadiness,
  compareMediaProductionOrder,
  evaluateMediaProductionCircuitBreaker,
  normalizeMediaWorkerConcurrency,
  normalizeMediaWorkerMaxAttempts,
  resolveMediaStoryboardCompositeLayout,
  resolveMediaStoryboardFramingConstraint,
  resolveMediaStoryboardGrid,
  resolvePanelSourceShotLabel,
  selectStoryboardReferenceItems,
} from "../src/services/production/mediaProductionWorker";
import type { AssetIdentityBoard } from "../src/services/production/productionAssetPackage";
import type { StoryboardBoard } from "../src/services/production/videoStoryboardArtifacts";

const assetBoard: AssetIdentityBoard = {
  schemaVersion: "asset-identity-board.v1",
  id: "character-a.identity-board",
  projectId: "project-a",
  assetId: "character-a",
  assetType: "character",
  assetName: "海桥",
  boardItemId: "character-a.character_board",
  boardKind: "character_board",
  strategyId: "assetBoard.characterIdentity.artbook.v1",
  prompt: [
    "【视觉风格】沿海工业现实主义电影",
    "【角色外观事实】32岁中国女性声学修复师，短发，深灰防水工作服",
    "【身份锁定】所有视角保持相同脸型、发型、年龄和服装",
  ].join("\n"),
  readiness: "prompt_ready",
  productionUse: "formal_asset_board",
  sourceRefs: { assetBoardPlanId: "plan-a", castingDecisionIds: [], departmentPrepPackageIds: [] },
  usageRefs: [],
};

const assetPrompt = buildAssetBoardMediaPrompt(assetBoard);
assert.ok(assetPrompt.includes("32岁中国女性声学修复师"));
assert.ok(assetPrompt.includes("单画布"));
assert.equal(assetPrompt.includes(assetBoard.strategyId), false, "asset image prompts must not expose renderer strategy IDs");
assert.ok(!assetPrompt.endsWith("…"), "asset prompt must not be silently truncated");

const panels = Array.from({ length: 6 }, (_, index) => ({
  id: `panel-${index + 1}`,
  panelNumber: index + 1,
  shotId: "shot-1",
  framePurpose: `动作阶段 ${index + 1}`,
  visualBeat: `人物完成第 ${index + 1} 个可见动作变化`,
  assetRefs: ["character-a", "location-a"],
  actionArrowLegendIds: ["subject_action_red"],
}));
const board = {
  id: "board-a",
  episodeId: "episode-a",
  sceneId: "scene-a",
  strategyDecision: {
    selectedStrategyId: "storyboard.multi_shot_narrative.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video-profile-a",
    rationale: "test",
    rejectedStrategyIds: [],
    riskNotes: [],
    expectedBoardShape: "3x2",
    expectedVideoUnitDurationSeconds: 8,
    expectedReferenceImageCount: 1,
    expectedReferenceVideoCount: 0,
    arrowLegendIds: ["subject_action_red"],
    qaChecklist: [],
  },
  boardMode: "multi_shot_narrative",
  layout: "3x2",
  lineArtPrompt: "",
  arrowLegendIds: ["subject_action_red"],
  performanceBeatIds: [],
  scriptBlockIds: [],
  shotIds: ["shot-1"],
  panels,
  startState: "人物站定",
  endState: "人物离开",
} as StoryboardBoard;

assert.deepEqual(resolveMediaStoryboardGrid(board), { columns: 3, rows: 2 });
const compositeLayout = resolveMediaStoryboardCompositeLayout(board);
assert.equal(compositeLayout.width, 1920);
assert.equal(compositeLayout.height, 1080);
assert.equal(compositeLayout.columns, 3);
assert.equal(compositeLayout.rows, 2);
const controlTemplate = buildMediaStoryboardControlTemplateSvg(board);
assert.ok(controlTemplate.includes('width="1536"'));
assert.ok(controlTemplate.includes('height="1024"'));
assert.ok(controlTemplate.includes("P1 · S01"));
assert.ok(controlTemplate.includes("P6 · S01"));
assert.ok(controlTemplate.includes("source framing"));
assert.equal(resolvePanelSourceShotLabel(board, { shotId: "production-scene-shot-12" }), "S12");

const multiShotControlTemplate = buildMediaStoryboardControlTemplateSvg({
  ...board,
  shotIds: ["production-scene-shot-10", "production-scene-shot-11"],
  panels: board.panels.map((panel, index) => ({
    ...panel,
    shotId: index < 3 ? "production-scene-shot-10" : "production-scene-shot-11",
    framing: index < 3 ? "WS" : "CU",
  })),
});
assert.ok(multiShotControlTemplate.includes("P1 · S10"));
assert.ok(multiShotControlTemplate.includes("P3 · S10"));
assert.ok(multiShotControlTemplate.includes("P4 · S11"));
assert.ok(multiShotControlTemplate.includes("P6 · S11"));
assert.ok(multiShotControlTemplate.includes(">WS</text>"));
assert.ok(multiShotControlTemplate.includes(">CU</text>"));
assert.ok(resolveMediaStoryboardFramingConstraint("WS").includes("人物全身完整"));
assert.ok(resolveMediaStoryboardFramingConstraint("CU").includes("头肩"));
const lockedCameraContract = buildMediaStoryboardCameraContract({
  ...board,
  panels: board.panels.map((panel) => ({
    ...panel,
    framing: "WS",
    lens: "24mm",
    angle: "eye-level",
    cameraMove: "static",
  })),
});
assert.ok(lockedCameraContract.includes("同一S是一个源镜头的时间关键帧"));
assert.ok(lockedCameraContract.includes("禁止推近、裁切、换镜位"));
assert.ok(lockedCameraContract.includes("人物全身完整且高度约占画面20%-40%"));
const selectedReferences = selectStoryboardReferenceItems(board, [
  { assetId: "character-a", assetType: "character", roleInUnit: "visible character", required: true },
  { assetId: "location-a", assetType: "location", roleInUnit: "location", required: true },
  { assetId: "character-b", assetType: "character", roleInUnit: "scene-only character", required: true },
]);
assert.deepEqual(selectedReferences.map((item) => item.assetId), ["character-a", "location-a"]);
assert.equal(classifyStoryboardReferenceReadiness([
  { ...selectedReferences[0], referenceImageUrl: "/media/character-a.png" },
], new Set()).status, "ready");
assert.equal(classifyStoryboardReferenceReadiness(selectedReferences, new Set(["character-a:", "location-a:"])).status, "awaiting_asset_review");
assert.equal(classifyStoryboardReferenceReadiness(selectedReferences, new Set(["character-a:"])).status, "missing_asset_reference");
const storyboardPrompt = buildStoryboardBoardMediaPrompt({
  projectTitle: "测试电影",
  sceneTitle: "潮门控制室",
  board,
  assetNames: ["海桥", "潮门控制室"],
  assetLabels: [
    { assetId: "character-a", assetType: "character", name: "海桥" },
    { assetId: "location-a", assetType: "location", name: "潮门控制室" },
  ],
});
assert.ok(storyboardPrompt.includes("单画布"));
assert.ok(storyboardPrompt.includes("P1["));
assert.ok(storyboardPrompt.includes("P6["));
assert.ok(storyboardPrompt.includes("首张空白模板"));
assert.ok(storyboardPrompt.includes("禁止格内再分格"));
assert.ok(storyboardPrompt.includes("文字、编号"));
assert.ok(storyboardPrompt.includes("同一S是一个源镜头的时间关键帧"));
assert.ok(storyboardPrompt.includes("多镜头剧情推进板"), "storyboard image prompts should use a human-readable method name");
assert.equal(storyboardPrompt.includes(board.strategyDecision.selectedStrategyId), false, "storyboard image prompts must not expose strategy IDs");
assert.ok(storyboardPrompt.includes("在场:海桥"));
assert.ok(storyboardPrompt.includes("人物完成第 6 个可见动作变化"), "storyboard prompt must preserve the final panel task");
const tenPanelPrompt = buildStoryboardBoardMediaPrompt({
  projectTitle: "测试电影",
  sceneTitle: "潮门控制室",
  board: {
    ...board,
    panels: Array.from({ length: 10 }, (_, index) => ({
      ...panels[index % panels.length],
      id: `panel-ten-${index + 1}`,
      panelNumber: index + 1,
      visualBeat: `动作进度${Math.round(index * 100 / 9)}%：第${index + 1}个可见状态发生变化`,
    })),
  },
  assetNames: ["海桥：32岁中国女性声学修复师", "潮门控制室：沿海工业空间"],
});
assert.ok(tenPanelPrompt.includes("P1["));
assert.ok(tenPanelPrompt.includes("P10["));
assert.ok(tenPanelPrompt.includes("32岁中国女性声学修复师"));
assert.ok(tenPanelPrompt.includes("第10个可见状态发生变化"), "long storyboard prompts must preserve the final panel task without silent truncation");

assert.equal(normalizeMediaWorkerConcurrency(99), 3);
assert.ok(compareMediaProductionOrder("storyboard.2", "storyboard.10") < 0);
assert.equal(normalizeMediaWorkerMaxAttempts(undefined), 3);
assert.equal(normalizeMediaWorkerMaxAttempts(0), 1);
assert.equal(normalizeMediaWorkerMaxAttempts(99), 10);
assert.equal(evaluateMediaProductionCircuitBreaker({ consecutiveFailures: 2 }).open, false);
assert.equal(evaluateMediaProductionCircuitBreaker({ consecutiveFailures: 3 }).open, true);

const workerSource = fs.readFileSync(path.resolve("apps/worker/src/production-media-worker.ts"), "utf8");
assert.match(workerSource, /stageProductionAssetBoardReferenceCandidate/);
assert.match(workerSource, /adoptionStatus:\s*"awaiting_review"/);
assert.match(workerSource, /enforcement:\s*"formal"/);
assert.match(workerSource, /buildProductionAssetImageVisualStyleProjection/);
assert.match(workerSource, /buildShotImageVisualRecipeInputEvidence/);
assert.match(workerSource, /awaiting_asset_review/);
assert.match(workerSource, /sourceContentHash:\s*result\.sourceContentHash/);
assert.match(workerSource, /buildStoryboardMediaCandidateSourceHash/);
assert.match(workerSource, /candidate\.referenceMode \|\| "production_board"/);
assert.match(workerSource, /previousSourceReview\?\.sourceArtifactId \|\| artifact\.id/);
assert.doesNotMatch(workerSource, /正式资产板已生成并落库/);
assert.doesNotMatch(workerSource, /identity\.referenceImageUrl\s*=\s*result\.image\.mediaUrl/);

console.log("production media worker self-check passed");
