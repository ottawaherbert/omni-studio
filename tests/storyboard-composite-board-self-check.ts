import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type {
  ManualStoryboardBoard,
  ManualStoryboardBoardWorkflow,
  ManualStoryboardBoardVisualTake,
  Project,
  Scene,
  Shot,
} from "../src/types/project";
import {
  adoptStoryboardBoardVisualTake,
  buildStoryboardCompositeBoardPrompt,
  buildStoryboardCompositeBoardQAPrompt,
  buildStoryboardCompositeBoardSourceHash,
  buildStoryboardCompositeVisualPages,
  buildStoryboardShotCellManifest,
  buildStoryboardShotGridSourceHash,
  composeStoryboardShotGridPage,
  composeStoryboardSceneBoardWorkflow,
  composeStoryboardCompositeVideoUnits,
  getActiveStoryboardBoardVisualTake,
  getActiveStoryboardShotGridTake,
  listStoryboardCompositeWorkflowAnchors,
  mergeStoryboardUnitWorkflows,
  planStoryboardCompositeVideoUnitGroups,
  reconcileStoryboardCompositeVisualPages,
  resolveStoryboardCompositeLayout,
  resolveStoryboardShotGridImage,
  scopeStoryboardCompositeBoardToPage,
  selectStoryboardCompositeBoardReferences,
  stageStoryboardBoardVisualTakeForCreatorReview,
  storyboardShotGridStatus,
  splitStoryboardUnitWorkflow,
  validateStoryboardCompositeBoardContract,
} from "../src/services/production/storyboardCompositeBoard";
import {
  getStoryboardStrategyCapabilityIds,
  getStoryboardStrategyCompositionRole,
  STORYBOARD_PROMPT_STRATEGIES,
  resolveStoryboardStrategyCoverage,
  validateStoryboardStrategyDecision,
} from "../src/services/production/videoStoryboardSystem";
import { renderStoryboardBoardPrompt } from "../src/services/production/videoStoryboardTemplateRenderer";
import { compileImageGenerationRequest } from "../src/services/production/imageGenerationRequest";
import { buildSceneStoryboardExportItems } from "../src/hooks/useEpisodeFilmExport";
import {
  buildStoryboardRhythmTrack,
  validateStoryboardRhythmTrack,
} from "../src/services/production/storyboardRhythmTrack";
import type { StoryboardBoard } from "../src/services/production/videoStoryboardArtifacts";
import {
  shouldStopStoryboardRepairCycle,
  STORYBOARD_BOARD_AGENT_MAX_REPAIRS,
} from "../src/services/production/storyboardBoardAgent";
import {
  buildStoryboardBoardOverlaySpec,
  buildStoryboardShotGridCellRects,
  buildStoryboardVideoReferenceNumberBadges,
  buildStoryboardVideoReferencePanelCrops,
  detectStoryboardCompositeContentBounds,
} from "../src/services/production/productionBoardImageOverlay";
import {
  appearanceSourceHash,
  materializeAppearanceVariants,
  normalizeShotAppearances,
  requireAppearanceReady,
} from "../src/services/production/productionAppearance";

const project = {
  id: "project-composite-board",
  title: "通用复合故事板测试",
  type: "short-drama",
  aspectRatio: "9:16",
  creativeVision: { visualStyle: "克制写实，动作方向清楚" },
  characters: [],
  assets: [],
  episodes: [],
} as unknown as Project;

const scene = {
  id: "scene-composite-board",
  title: "两人对峙后夺门离开",
} as Scene;

for (const strategyId of [
  "storyboard.spatial_geography.v1",
  "storyboard.montage_compression.v1",
  "storyboard.procedural_insert.v1",
  "storyboard.parallel_intercut.v1",
  "storyboard.subjective_suspense.v1",
]) {
  assert.ok(STORYBOARD_PROMPT_STRATEGIES.some((strategy) => strategy.id === strategyId), `missing strategy ${strategyId}`);
}

for (const strategy of STORYBOARD_PROMPT_STRATEGIES) {
  const capabilityIds = getStoryboardStrategyCapabilityIds(strategy.id);
  assert.ok(capabilityIds.length > 0, `${strategy.id} must declare structured capabilities`);
  const resolution = resolveStoryboardStrategyCoverage({ requiredCapabilityIds: capabilityIds });
  assert.deepEqual(resolution.uncoveredCapabilityIds, [], `${strategy.id} capabilities must remain resolvable by the built-in recipe system`);
  assert.notEqual(getStoryboardStrategyCompositionRole(resolution.primaryStrategyId), "modifier");
  assert.equal(resolution.modifierStrategyIds.length <= 2, true);
}

const commonProductionGrammarCases = [
  {
    name: "ensemble dialogue with spatial blocking",
    requiredCapabilityIds: ["narrative:spatial_geography", "control:spatial_topology", "narrative:dialogue", "control:performance"],
  },
  {
    name: "combat with a visible effect state cycle",
    requiredCapabilityIds: ["narrative:combat", "control:action_choreography", "control:screen_direction", "control:vfx_state", "control:lighting"],
  },
  {
    name: "parallel action lines",
    requiredCapabilityIds: ["narrative:parallel_intercut", "control:cross_cut_continuity", "narrative:action", "control:screen_direction"],
  },
  {
    name: "subjective suspense transition",
    requiredCapabilityIds: ["narrative:subjective", "narrative:suspense", "narrative:transition", "control:continuity"],
  },
  {
    name: "interactive loop with choice-safe UI",
    requiredCapabilityIds: ["narrative:interactive", "control:ui_safe_area", "control:loop_closure", "control:choice_state"],
  },
  {
    name: "dance choreography with a dense rhythm track",
    requiredCapabilityIds: ["narrative:dance", "control:body_rhythm", "control:rhythm_timeline", "control:sound_rhythm"],
  },
];

for (const productionCase of commonProductionGrammarCases) {
  const resolution = resolveStoryboardStrategyCoverage({ requiredCapabilityIds: productionCase.requiredCapabilityIds });
  assert.deepEqual(resolution.uncoveredCapabilityIds, [], `${productionCase.name} should be covered without inventing a new global preset`);
  assert.notEqual(getStoryboardStrategyCompositionRole(resolution.primaryStrategyId), "modifier");
  assert.equal(resolution.modifierStrategyIds.length <= 2, true);
}

const mixedResolution = resolveStoryboardStrategyCoverage({
  actionBeatCount: 3,
  expectedVideoUnitDurationSeconds: 10,
  requiredCapabilityIds: ["narrative:action", "control:vfx_state", "control:lighting"],
});
assert.equal(mixedResolution.mode, "composed_recipe");
assert.equal(mixedResolution.modifierStrategyIds.length <= 2, true);
assert.deepEqual(mixedResolution.uncoveredCapabilityIds, []);
assert.notEqual(getStoryboardStrategyCompositionRole(mixedResolution.primaryStrategyId), "modifier");
assert.equal(
  mixedResolution.modifierStrategyIds.every((strategyId) => getStoryboardStrategyCompositionRole(strategyId) !== "primary"),
  true,
);
const mixedDecisionIssues = validateStoryboardStrategyDecision({
  selectedStrategyId: mixedResolution.primaryStrategyId,
  selectedStrategyVersion: "v1",
  selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
  rationale: "动作因果决定页面主语法，效果状态和光线作为组合控制层补充，整板保持一个视频单元内的连续方向与状态变化。",
  rejectedStrategyIds: ["storyboard.single_shot_dialogue.v1"],
  riskNotes: ["效果峰值不能遮住主体动作方向"],
  expectedBoardShape: "动作主版式加效果状态控制",
  expectedVideoUnitDurationSeconds: 10,
  expectedReferenceImageCount: 4,
  expectedReferenceVideoCount: 0,
  arrowLegendIds: ["subject_action_red", "camera_motion_blue"],
  qaChecklist: ["动作方向连续", "效果状态可追溯"],
  strategyResolution: mixedResolution,
}, {
  actionBeatCount: 3,
  expectedVideoUnitDurationSeconds: 10,
  requiredCapabilityIds: ["narrative:action", "control:vfx_state", "control:lighting"],
});
assert.equal(
  mixedDecisionIssues.some((issue) => issue.severity === "blocking"),
  false,
  `a valid composed recipe must be evaluated as a whole: ${mixedDecisionIssues.map((issue) => issue.code).join(", ")}`,
);

const unknownResolution = resolveStoryboardStrategyCoverage({
  requiredCapabilityIds: ["narrative:zero_gravity_ritual", "control:non_euclidean_blocking"],
});
assert.equal(unknownResolution.mode, "project_local_draft_required");
assert.equal(unknownResolution.requiresHumanApproval, true);
assert.equal(unknownResolution.maxAutomaticRevisionAttempts, 1);
assert.ok(unknownResolution.uncoveredCapabilityIds.includes("control:non_euclidean_blocking"));

const repeatedRepair = shouldStopStoryboardRepairCycle({
  repairCount: 1,
  maxRepairs: STORYBOARD_BOARD_AGENT_MAX_REPAIRS,
  previousIssueFingerprint: "动作方向相反|角色身份漂移",
  currentIssues: ["动作方向相反", "角色身份漂移"],
});
assert.equal(repeatedRepair.stop, true);
assert.equal(repeatedRepair.reason, "same_issue_loop");

const shots: Shot[] = [
  {
    id: "shot-a",
    imageUrl: "https://cdn.example.com/shot-a.png",
    duration: 4,
    shotSize: "MS",
    cameraAngle: "Eye-Level",
    visualAction: "角色甲把信封推到桌面中央",
    characterIdsInShot: ["character-a", "character-b"],
    locationId: "location-room",
    propIds: ["prop-envelope"],
  },
  {
    id: "shot-b",
    imageUrl: "https://cdn.example.com/shot-b.png",
    duration: 6,
    shotSize: "WS",
    cameraAngle: "Low Angle",
    visualAction: "角色乙抓起信封冲向门口，角色甲转身追上",
    characterIdsInShot: ["character-a", "character-b"],
    locationId: "location-room",
    propIds: ["prop-envelope"],
  },
];

const board = {
  id: "board-composite-1",
  episodeId: "episode-1",
  sceneId: scene.id,
  shotId: shots[0].id,
  videoGenerationUnitId: "video-unit-1",
  strategyDecision: {
    selectedStrategyId: "storyboard.multi_shot_narrative.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    rationale: "两段镜头构成一个连续冲突单元，需要在同一张故事板中控制道具交接、动作方向和结尾状态。",
    rejectedStrategyIds: [],
    riskNotes: [],
    expectedBoardShape: "3x2 六格多镜头剧情推进板",
    expectedVideoUnitDurationSeconds: 10,
    expectedReferenceImageCount: 4,
    expectedReferenceVideoCount: 0,
    arrowLegendIds: ["subject_action_red", "camera_motion_blue"],
    qaChecklist: ["道具交接连续", "动作方向一致"],
  },
  boardMode: "multi_shot_narrative",
  layout: "3x2",
  lineArtPrompt: "一张六格故事板",
  arrowLegendIds: ["subject_action_red", "camera_motion_blue"],
  performanceBeatIds: ["beat-1"],
  scriptBlockIds: [],
  shotIds: shots.map((shot) => shot.id),
  strategyOrigin: "built_in",
  panels: Array.from({ length: 6 }, (_, index) => ({
    id: `panel-${index + 1}`,
    panelNumber: index + 1,
    shotId: index < 2 ? shots[0].id : shots[1].id,
    durationSeconds: index < 2 ? 2 : 1.5,
    framePurpose: index === 0 ? "建立两人和信封位置" : index === 5 ? "角色乙冲出门，角色甲追上" : "推进动作与反应",
    shotType: index < 2 ? "MS" : "WS",
    visualBeat: index === 0 ? "信封位于桌面中央" : `动作阶段 ${index + 1}`,
    subjectAction: index < 2 ? "角色甲推信封" : "角色乙带信封冲向门口",
    continuityIn: index === 0 ? "信封在角色甲手中" : `承接 panel ${index}`,
    continuityOut: index === 5 ? "角色乙持信封离场" : `进入 panel ${index + 2}`,
    assetRefs: ["character-a", "character-b", "location-room", "prop-envelope"],
    annotationLegendIds: ["subject_action_red", "camera_motion_blue"],
    actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"],
  })),
  startState: "角色甲持有信封，两人隔桌对峙",
  endState: "角色乙持有信封离场，角色甲追上",
} as ManualStoryboardBoard;

assert.equal(resolveStoryboardCompositeLayout(4), "2x2");
assert.equal(resolveStoryboardCompositeLayout(6), "3x2");
assert.equal(resolveStoryboardCompositeLayout(12), "4x3");
assert.equal(resolveStoryboardCompositeLayout(16), "4x4");
assert.equal(resolveStoryboardCompositeLayout(24), "6x4");

const pages = buildStoryboardCompositeVisualPages(board);
assert.equal(pages.length, 1);
const firstPanelPageScope = scopeStoryboardCompositeBoardToPage(board, {
  id: "page-scope-1",
  pageIndex: 0,
  pageCount: 2,
  layout: "1x1",
  annotationMode: "director_annotated_sheet",
  panelIds: [board.panels[0].id],
});
assert.deepEqual(firstPanelPageScope.shotIds, [shots[0].id]);
assert.deepEqual(firstPanelPageScope.panels.map((panel) => panel.id), [board.panels[0].id]);
assert.equal(firstPanelPageScope.layout, "1x1");
assert.equal(pages[0].layout, "2x1");
assert.equal(pages[0].panelIds.length, 2, "a clean/video reference page has exactly one representative cell per Shot");
assert.deepEqual(pages[0].panelIds, ["panel-2", "panel-3"]);
const shotCellManifest = buildStoryboardShotCellManifest({ board, shots });
assert.deepEqual(shotCellManifest.map((cell) => [cell.shotId, cell.order, cell.status]), [
  ["shot-a", 1, "ready"],
  ["shot-b", 2, "ready"],
]);
assert.deepEqual(validateStoryboardCompositeBoardContract({ board, pages, shots }), []);
const overlaySpec = buildStoryboardBoardOverlaySpec({ project, scene, board, page: pages[0] });
assert.equal(overlaySpec.columns, 2);
assert.equal(overlaySpec.rows, 1);
assert.deepEqual(overlaySpec.panels.map((panel) => panel.panelNumber), [1, 2]);
assert.match(overlaySpec.subtitle, /视频生成单元 video-unit-1/);
assert.deepEqual(overlaySpec.legend.map((item) => item.id), ["subject_action_red", "camera_motion_blue"]);
const videoReferenceCrops = buildStoryboardVideoReferencePanelCrops(
  { x: 0, y: 0, width: 1920, height: 1080 },
  overlaySpec.columns,
  overlaySpec.rows,
);
assert.equal(videoReferenceCrops.length, 2);
assert.ok(videoReferenceCrops.every((crop) => crop.sourceX > crop.targetX));
assert.ok(videoReferenceCrops.every((crop) => crop.sourceY > crop.targetY));
assert.ok(videoReferenceCrops.every((crop) => crop.sourceWidth < crop.targetWidth));
assert.ok(videoReferenceCrops.every((crop) => crop.sourceHeight < crop.targetHeight));
const videoReferenceNumberBadges = buildStoryboardVideoReferenceNumberBadges(
  { x: 0, y: 0, width: 1920, height: 1080 },
  overlaySpec.columns,
  overlaySpec.rows,
  [1, 2],
);
assert.deepEqual(videoReferenceNumberBadges.map((badge) => badge.panelNumber), [1, 2]);
assert.ok(videoReferenceNumberBadges.every((badge) => badge.centerX > 0 && badge.centerY > 0 && badge.radius >= 12));
for (const cellCount of [1, 6, 9]) {
  const rects = buildStoryboardShotGridCellRects({
    layout: resolveStoryboardCompositeLayout(cellCount),
    cellCount,
    width: 1920,
    height: 1080,
  });
  assert.equal(rects.length, cellCount, `${cellCount} Shots must produce one clean-grid cell each`);
  assert.ok(rects.every((rect) => rect.width > 0 && rect.height > 0));
}
const sevenRects = buildStoryboardShotGridCellRects({ layout: "3x3", cellCount: 7, width: 1920, height: 1080 });
assert.equal(sevenRects.length, 7);
assert.equal(sevenRects[6].width, 1920, "a partial final row must not leave blank pseudo-cells");

const syntheticWidth = 120;
const syntheticHeight = 80;
const syntheticPixels = new Uint8ClampedArray(syntheticWidth * syntheticHeight * 4);
for (let offset = 0; offset < syntheticPixels.length; offset += 4) {
  syntheticPixels[offset] = 250;
  syntheticPixels[offset + 1] = 249;
  syntheticPixels[offset + 2] = 246;
  syntheticPixels[offset + 3] = 255;
}
for (let y = 20; y < 68; y += 1) {
  for (let x = 4; x < 116; x += 1) {
    if ((x - 4) % 38 < 34 && (y - 20) % 24 < 20) {
      const offset = (y * syntheticWidth + x) * 4;
      syntheticPixels[offset] = 60;
      syntheticPixels[offset + 1] = 64;
      syntheticPixels[offset + 2] = 68;
    }
  }
}
const detectedContentBounds = detectStoryboardCompositeContentBounds(
  { width: syntheticWidth, height: syntheticHeight, data: syntheticPixels },
  3,
  2,
  { x: 0, y: 8, width: syntheticWidth, height: 64 },
);
assert.equal(detectedContentBounds.detected, true);
assert.ok(detectedContentBounds.y >= 16 && detectedContentBounds.y <= 22);
assert.ok(detectedContentBounds.height >= 44 && detectedContentBounds.height <= 54);

const blankContentBounds = detectStoryboardCompositeContentBounds(
  { width: syntheticWidth, height: syntheticHeight, data: new Uint8ClampedArray(syntheticWidth * syntheticHeight * 4) },
  3,
  2,
  { x: 0, y: 8, width: syntheticWidth, height: 64 },
);
assert.equal(blankContentBounds.detected, false);
assert.equal(blankContentBounds.y, 8);

const fivePanelBoard = {
  ...board,
  id: "board-composite-five-panels",
  layout: "3x2",
  panels: board.panels.slice(0, 5),
  strategyDecision: {
    ...board.strategyDecision,
    expectedVideoUnitDurationSeconds: 8.5,
  },
};
const fivePanelPages = buildStoryboardCompositeVisualPages(fivePanelBoard);
assert.equal(fivePanelPages[0].layout, "2x1");
assert.deepEqual(
  validateStoryboardCompositeBoardContract({ board: fivePanelBoard, pages: fivePanelPages, shots }),
  [],
  "a production grid may reserve one unused cell for notes/legend",
);

const sevenShotBoard = {
  ...board,
  id: "board-seven-shots",
  shotIds: Array.from({ length: 7 }, (_, index) => `shot-${index + 1}`),
  layout: "6x4",
  panels: Array.from({ length: 28 }, (_, index) => ({
    ...board.panels[index % board.panels.length],
    id: `seven-shot-panel-${index + 1}`,
    panelNumber: index + 1,
    shotId: `shot-${Math.floor(index / 4) + 1}`,
  })),
} as ManualStoryboardBoard;
const sevenShotPages = buildStoryboardCompositeVisualPages(sevenShotBoard);
assert.deepEqual(sevenShotPages.map((page) => page.panelIds.length), [7]);
for (const shotId of sevenShotBoard.shotIds) {
  assert.equal(
    sevenShotPages.filter((page) => page.panelIds.some((panelId) => (
      sevenShotBoard.panels.find((panel) => panel.id === panelId)?.shotId === shotId
    ))).length,
    1,
    "each Shot must appear exactly once on the video reference page",
  );
}
const oversizedLegacyPages = [{
  id: `${sevenShotBoard.id}.page.1`,
  pageIndex: 0,
  pageCount: 2,
  layout: "6x4",
  annotationMode: "director_annotated_sheet" as const,
  panelIds: sevenShotBoard.panels.slice(0, 24).map((panel) => panel.id),
}, {
  id: `${sevenShotBoard.id}.page.2`,
  pageIndex: 1,
  pageCount: 2,
  layout: "2x2",
  annotationMode: "director_annotated_sheet" as const,
  panelIds: sevenShotBoard.panels.slice(24).map((panel) => panel.id),
}];
assert.deepEqual(
  reconcileStoryboardCompositeVisualPages({ ...sevenShotBoard, visualPages: oversizedLegacyPages })
    .map((page) => page.panelIds.length),
  [7],
  "an oversized persisted page without generated visuals should be repartitioned before retry",
);
assert.equal(
  reconcileStoryboardCompositeVisualPages({
    ...sevenShotBoard,
    visualPages: [{
      ...oversizedLegacyPages[0],
      visualTakes: [{ id: "existing-take" } as ManualStoryboardBoardVisualTake],
    }, oversizedLegacyPages[1]],
  }).length,
  2,
  "a page that already owns a generated take must not be silently repartitioned or rerun",
);

const perShotWorkflows: ManualStoryboardBoardWorkflow[] = shots.map((shot, shotIndex) => {
  const shotPanels = board.panels.filter((panel) => panel.shotId === shot.id).map((panel, index) => ({ ...panel, panelNumber: index + 1 }));
  const shotBoard = {
    ...board,
    id: `board-${shot.id}`,
    shotId: shot.id,
    shotIds: [shot.id],
    videoGenerationUnitId: `unit-${shot.id}`,
    layout: resolveStoryboardCompositeLayout(shotPanels.length),
    panels: shotPanels,
    startState: shotIndex === 0 ? board.startState : "角色乙抓起信封",
    endState: shotIndex === 0 ? "角色乙抓起信封" : board.endState,
    strategyDecision: {
      ...board.strategyDecision,
      selectedStrategyId: "storyboard.single_shot_dialogue.v1",
      expectedVideoUnitDurationSeconds: shot.duration || 0,
    },
    boardMode: "single_shot_performance",
    visualPages: undefined,
  };
  return {
    id: `workflow-${shot.id}`,
    unitSchema: "storyboard_unit.v1",
    shotId: shot.id,
    shotIds: [shot.id],
    strategyDecision: shotBoard.strategyDecision,
    performanceBeat: {
      id: `beat-${shot.id}`,
      episodeId: "episode-1",
      sceneId: scene.id,
      shotId: shot.id,
      scriptBlockIds: [],
      beatType: shotIndex === 0 ? "dialogue" : "action",
      summary: shot.visualAction || "",
      visibleChange: shot.visualAction || "",
      startState: shotBoard.startState,
      endState: shotBoard.endState,
      durationSeconds: shot.duration || 0,
      characterIds: shot.characterIdsInShot || [],
      locationId: shot.locationId,
      propIds: shot.propIds || [],
      soundCues: [],
      continuityIn: shotBoard.startState,
      continuityOut: shotBoard.endState,
    },
    board: shotBoard,
    updatedAt: 1,
  };
});
const composedUnits = composeStoryboardCompositeVideoUnits({ workflows: perShotWorkflows, shots });
assert.equal(composedUnits.length, 1, "two short consecutive shots should share one video generation unit");
assert.deepEqual(composedUnits[0].shotIds, ["shot-a", "shot-b"]);
assert.notEqual(
  getStoryboardStrategyCompositionRole(composedUnits[0].strategyDecision?.selectedStrategyId || ""),
  "modifier",
  "aggregate selection must choose a page-defining primary strategy",
);
assert.deepEqual(composedUnits[0].strategyDecision?.strategyResolution?.uncoveredCapabilityIds, []);
assert.equal(composedUnits[0].board?.panels.length, 6);
assert.equal(composedUnits[0].board?.visualPages?.length, 1);
assert.equal(composedUnits[0].strategyDecision?.expectedVideoUnitDurationSeconds, 10);
const authorMergedUnit = mergeStoryboardUnitWorkflows({ workflows: perShotWorkflows, shots });
assert.deepEqual(authorMergedUnit.shotIds, ["shot-a", "shot-b"]);
assert.match(authorMergedUnit.videoGenerationUnitId || "", /^manual-video-unit-/);
assert.deepEqual(authorMergedUnit.unitLineage?.sourceUnitIds, ["unit-shot-a", "unit-shot-b"]);
const authorSplitUnits = splitStoryboardUnitWorkflow({ workflow: authorMergedUnit, shots });
assert.deepEqual(authorSplitUnits.map((item) => item.shotIds), [["shot-a"], ["shot-b"]]);
assert.equal(new Set(authorSplitUnits.map((item) => item.videoGenerationUnitId)).size, 2);
assert.ok(authorSplitUnits.every((item) => item.unitLineage?.sourceUnitIds.includes(authorMergedUnit.videoGenerationUnitId!)));
const composedAnchors = listStoryboardCompositeWorkflowAnchors({ workflows: perShotWorkflows, shots });
assert.equal(composedAnchors.length, 2, "persisted StoryboardUnits must never be silently regrouped while reading the page");
assert.deepEqual(composedAnchors.map((anchor) => anchor.shotIds), [["shot-a"], ["shot-b"]]);
assert.equal(composedAnchors.every((anchor) => anchor.persisted), true);
const persistedAnchors = listStoryboardCompositeWorkflowAnchors({ workflows: composedUnits, shots });
assert.equal(persistedAnchors.length, 1);
assert.equal(persistedAnchors[0].persisted, true);
const sceneBoard = composeStoryboardSceneBoardWorkflow({ workflows: perShotWorkflows, shots });
assert.ok(sceneBoard, "a scene with planned shots must produce one scene-level composite board");
assert.deepEqual(sceneBoard.shotIds, ["shot-a", "shot-b"]);
assert.equal(sceneBoard.board?.visualPages?.length, 1);
const spatialOpeningSceneBoard = composeStoryboardSceneBoardWorkflow({
  workflows: perShotWorkflows.map((workflow, index) => index === 0 ? {
    ...workflow,
    strategyDecision: {
      ...workflow.strategyDecision!,
      selectedStrategyId: "storyboard.spatial_geography.v1",
    },
    performanceBeat: {
      ...workflow.performanceBeat!,
      beatType: "transition" as const,
    },
  } : workflow),
  shots,
});
assert.deepEqual(
  spatialOpeningSceneBoard?.strategyDecision?.strategyResolution?.uncoveredCapabilityIds,
  [],
  "an opening geography beat must not require a transition bridge unless its source strategy explicitly requested one",
);
assert.equal(
  spatialOpeningSceneBoard?.strategyDecision?.strategyResolution?.requiredCapabilityIds.includes("narrative:transition"),
  false,
);
const longUnits = composeStoryboardCompositeVideoUnits({
  workflows: perShotWorkflows,
  shots: shots.map((shot) => ({ ...shot, duration: 10 })),
});
assert.equal(longUnits.length, 2, "video units must not exceed the selected model duration ceiling");
const profilelessGroups = planStoryboardCompositeVideoUnitGroups({
  workflows: perShotWorkflows.map((workflow) => ({
    ...workflow,
    strategyDecision: workflow.strategyDecision
      ? { ...workflow.strategyDecision, selectedModelProfileId: "" }
      : undefined,
  })),
  shots,
  limits: {
    maxDurationSeconds: 15,
    supportsMultiShotSingleGeneration: true,
  },
});
assert.equal(profilelessGroups.length, 1, "adapter-driven grouping must not require a legacy model profile");

const spatialWorkflows = perShotWorkflows.map((workflow) => ({
  ...workflow,
  strategyDecision: {
    ...workflow.strategyDecision!,
    strategyResolution: {
      mode: "composed_recipe" as const,
      primaryStrategyId: workflow.strategyDecision!.selectedStrategyId,
      modifierStrategyIds: [],
      requiredCapabilityIds: [
        "narrative:spatial_geography",
        "control:spatial_topology",
        "control:blocking",
        "control:screen_direction",
        "control:continuity",
        "temporal:multi_shot",
      ],
      coveredCapabilityIds: [],
      uncoveredCapabilityIds: [],
      fallbackStrategyId: "storyboard.multi_shot_narrative.v1",
      confidence: 1,
      requiresHumanApproval: false,
      maxAutomaticRevisionAttempts: 1 as const,
    },
  },
}));
const spatialUnits = composeStoryboardCompositeVideoUnits({ workflows: spatialWorkflows, shots });
assert.equal(
  spatialUnits[0].strategyDecision?.selectedStrategyId,
  "storyboard.spatial_geography.v1",
  "a combined video unit must resolve its aggregate capabilities instead of using a fixed mode priority",
);
assert.equal(spatialUnits[0].strategyDecision?.strategyResolution?.mode, "composed_recipe");
assert.deepEqual(spatialUnits[0].strategyDecision?.strategyResolution?.uncoveredCapabilityIds, []);

const assets = {
  assetBoards: [
    { boardItemId: "board-character-a", assetId: "character-a", assetName: "角色甲", referenceImageUrl: "https://example.com/a.jpg", promptHash: "a" },
    { boardItemId: "board-character-b", assetId: "character-b", assetName: "角色乙", referenceImageUrl: "https://example.com/b.jpg", promptHash: "b" },
    { boardItemId: "board-location", assetId: "location-room", assetName: "房间", referenceImageUrl: "https://example.com/room.jpg", promptHash: "room" },
    { boardItemId: "board-prop", assetId: "prop-envelope", assetName: "信封", referenceImageUrl: "https://example.com/envelope.jpg", promptHash: "prop" },
  ],
} as any;
const references = selectStoryboardCompositeBoardReferences({ board, shots, assets });
assert.equal(references.selected.length, 4);
assert.deepEqual(references.missingAssetIds, []);

// Two cells show different moments of one character. A scene-level variant
// must not silently replace either the clean start or the injured, changed coat.
const appearanceScene = { ...scene, script: "角色甲穿蓝外套，摔伤左颊，随后换黑外套。" };
const appearanceProject = {
  ...project,
  characters: [{ id: "character-a", name: "角色甲", cleanReferenceImageUrl: "https://example.com/a-identity.jpg", variants: [] }],
} as unknown as Project;
const appearanceShots = normalizeShotAppearances(appearanceProject, appearanceScene, shots, [
  { appearance: { states: [{ assetId: "character-a", origin: "script", evidence: appearanceScene.script, timelineKey: "主线", continuity: "new", startChanges: { clothing: "蓝外套" }, endChanges: { injury: "左颊擦伤" }, event: "摔伤左颊", imageMoment: "start", referenceNeed: "image" }] } },
  { appearance: { states: [{ assetId: "character-a", origin: "script", evidence: appearanceScene.script, timelineKey: "主线", continuity: "continue", inheritFromShotId: "previous", endChanges: { clothing: "黑外套" }, event: "换黑外套，伤势仍在", imageMoment: "end", referenceNeed: "image" }] } },
]);
const materialized = materializeAppearanceVariants(appearanceProject, appearanceShots);
const stateProject = {
  ...appearanceProject,
  characters: materialized.characters.map((owner) => ({ ...owner, variants: owner.variants?.map((variant) => ({ ...variant, cleanReferenceImageUrl: `https://example.com/${variant.id}.jpg` })) })),
};
const stateShots = materialized.shots;
const stateReferences = selectStoryboardCompositeBoardReferences({ project: stateProject, board, shots: stateShots, assets });
assert.deepEqual(stateReferences.selected.filter((item) => item.assetId === "character-a").map((item) => item.variantId), [
  stateShots[0].appearance!.states[0].startVariantId,
  stateShots[1].appearance!.states[0].endVariantId,
]);
assert.equal(stateReferences.selected.some((item) => item.referenceImageUrl === "https://example.com/a.jpg"), false);
assert.equal(stateReferences.selected.some((item) => item.variantId === stateShots[0].appearance!.states[0].endVariantId), false, "the unpictured intermediate injury state must not replace either cell's selected moment");
assert.doesNotThrow(() => requireAppearanceReady(stateProject, appearanceScene, stateShots, stateShots, "image"));
const statePrompt = buildStoryboardCompositeBoardPrompt({ project: stateProject, scene: appearanceScene, board, page: pages[0], shots: stateShots, references: stateReferences.selected });
assert.match(statePrompt, /Shot shot-a[\s\S]*画面选择变化前时刻。服装：蓝外套/);
assert.match(statePrompt, /Shot shot-b[\s\S]*画面选择变化后时刻。服装：黑外套；伤势：左颊擦伤/);
assert.doesNotMatch(statePrompt, /同一人物身份、服装/);
assert.match(statePrompt, /不能为了整板一致而抹去变化/);
const stateQaPrompt = buildStoryboardCompositeBoardQAPrompt({ project: stateProject, scene: appearanceScene, board, page: pages[0], shots: stateShots, references: stateReferences.selected });
assert.match(stateQaPrompt, /明确的换装或伤势变化不属于不一致/);
assert.match(stateQaPrompt, /黑外套；伤势：左颊擦伤/);
const selectedEndVariantId = stateShots[1].appearance!.states[0].endVariantId;
const stateProjectMissingImage = { ...stateProject, characters: stateProject.characters.map((owner) => ({ ...owner, variants: owner.variants?.map((variant) => variant.id === selectedEndVariantId ? { ...variant, cleanReferenceImageUrl: undefined } : variant) })) };
assert.throws(() => requireAppearanceReady(stateProjectMissingImage, appearanceScene, stateShots, stateShots, "image"), /缺少参考图/);
const textOnlyStateShots = stateShots.map((item) => ({ ...item, appearance: { ...item.appearance!, states: item.appearance!.states.map((state) => ({ ...state, referenceNeed: "text" as const })) } }));
const textOnlyReferences = selectStoryboardCompositeBoardReferences({ project: stateProjectMissingImage, board, shots: textOnlyStateShots, assets });
assert.ok(textOnlyReferences.selected.some((item) => item.assetId === "character-a" && item.referenceImageUrl === "https://example.com/a-identity.jpg" && item.variantName?.includes("仅基础身份参考")));
assert.equal(textOnlyReferences.selected.some((item) => item.referenceImageUrl === "https://example.com/a.jpg"), false);
assert.doesNotThrow(() => requireAppearanceReady(stateProjectMissingImage, appearanceScene, textOnlyStateShots, textOnlyStateShots, "image"));
assert.throws(() => requireAppearanceReady(stateProject, { ...appearanceScene, script: "已修改原文" }, stateShots, stateShots, "image"), /原文已修改/);
assert.equal(stateShots[0].appearance!.states[0].sourceHash, appearanceSourceHash(appearanceScene));
assert.deepEqual(selectStoryboardCompositeBoardReferences({ project: stateProject, board, shots, assets }), references, "legacy Shot plans retain their existing asset reference selection");

// A board can be planned before pictures exist. Both generation and adoption
// must hash the newly adopted Shot pictures rather than the old empty manifest.
const boardBeforeImages = { ...board, shotCellManifest: buildStoryboardShotCellManifest({ board, shots: shots.map((item) => ({ ...item, imageUrl: undefined, takes: [], activeTakeId: undefined })) }) };
const generatedAfterImagesHash = buildStoryboardCompositeBoardSourceHash({ project, board: { ...boardBeforeImages, shotCellManifest: buildStoryboardShotCellManifest({ board, shots }) }, page: pages[0], references: references.selected, shots });
const adoptedAfterImagesHash = buildStoryboardCompositeBoardSourceHash({ project, board: boardBeforeImages, page: pages[0], references: references.selected, shots });
assert.equal(adoptedAfterImagesHash, generatedAfterImagesHash, "fresh pictures must be adoptable even when the stored board manifest predates them");
assert.notEqual(adoptedAfterImagesHash, buildStoryboardCompositeBoardSourceHash({ project, board: boardBeforeImages, page: pages[0], references: references.selected, shots: shots.map((item, index) => index ? item : { ...item, imageUrl: "https://example.com/replaced-shot.jpg" }) }));

const manyAssetIds = Array.from({ length: 12 }, (_, index) => `asset-${index + 1}`);
const manyReferenceBoard = {
  ...board,
  panels: board.panels.map((panel) => ({ ...panel, assetRefs: manyAssetIds })),
};
const manyReferenceAssets = {
  assetBoards: manyAssetIds.map((assetId, index) => ({
    boardItemId: `board-${assetId}`,
    assetId,
    assetName: `资产 ${index + 1}`,
    referenceImageUrl: `https://example.com/${assetId}.jpg`,
    promptHash: assetId,
  })),
} as any;
const allReferences = selectStoryboardCompositeBoardReferences({
  board: manyReferenceBoard,
  shots,
  assets: manyReferenceAssets,
});
assert.equal(allReferences.selected.length, 12, "canonical source hashing must not truncate references to a provider-specific default");
assert.equal(allReferences.omitted.length, 0);
const providerLimitedReferences = selectStoryboardCompositeBoardReferences({
  board: manyReferenceBoard,
  shots,
  assets: manyReferenceAssets,
  maxReferences: 9,
});
assert.equal(providerLimitedReferences.selected.length, 9);
assert.equal(providerLimitedReferences.omitted.length, 3, "provider limits must remain explicit rather than silently changing lineage");
const gptCapacityReferences = selectStoryboardCompositeBoardReferences({
  board: manyReferenceBoard,
  shots,
  assets: manyReferenceAssets,
  maxReferences: 16,
});
assert.equal(
  buildStoryboardCompositeBoardSourceHash({
    project,
    board: manyReferenceBoard,
    page: pages[0],
    references: gptCapacityReferences.selected,
    shots,
  }),
  buildStoryboardCompositeBoardSourceHash({
    project,
    board: manyReferenceBoard,
    page: pages[0],
    references: allReferences.selected,
    shots,
  }),
  "a GPT Image 2 candidate with more than nine references must keep the same hash when read and adopted",
);

const prompt = buildStoryboardCompositeBoardPrompt({
  project,
  scene,
  board,
  page: pages[0],
  shots,
  references: references.selected,
});
assert.ok(prompt.includes("一张完整的专业电影制作故事板控制图"));
assert.ok(prompt.includes("严格为 2x1，共 2 格"));
assert.ok(prompt.includes("不是单格画面"));
assert.equal(prompt.includes("shot-a"), false);
assert.equal(prompt.includes("shot-b"), false);
assert.doesNotMatch(prompt, /strategyId|strategyVersion|templateId|schemaVersion|asset refs|部门 refs|9:16/i);
assert.doesNotThrow(() => compileImageGenerationRequest({ promptCore: prompt, aspectRatio: "9:16" }));
assert.ok(prompt.includes("不要添加标题、页眉、页脚、镜头参数"));
assert.ok(prompt.includes("作品内容必须保留原文及位置"));
assert.ok(prompt.includes("由系统在另一张展示图上确定性叠加"));
assert.ok(prompt.includes("原始画面不写编号"));
assert.equal(prompt.includes("连续编号"), false);

const modifierAsPrimaryIssues = validateStoryboardStrategyDecision({
  ...board.strategyDecision,
  selectedStrategyId: "storyboard.ai_video_control.v1",
  selectedStrategyVersion: "v1",
  strategyResolution: {
    mode: "built_in_preset",
    primaryStrategyId: "storyboard.ai_video_control.v1",
    modifierStrategyIds: [],
    requiredCapabilityIds: ["control:ai_video"],
    coveredCapabilityIds: ["control:ai_video"],
    uncoveredCapabilityIds: [],
    fallbackStrategyId: "storyboard.multi_shot_narrative.v1",
    confidence: 1,
    requiresHumanApproval: false,
    maxAutomaticRevisionAttempts: 1,
  },
}, { requiredCapabilityIds: ["control:ai_video"] });
assert.ok(modifierAsPrimaryIssues.some((issue) => issue.code === "MODIFIER_USED_AS_PRIMARY_STRATEGY"));

assert.throws(() => buildStoryboardCompositeBoardPrompt({
  project,
  scene,
  board: {
    ...board,
    strategyDecision: {
      ...board.strategyDecision,
      strategyResolution: unknownResolution,
    },
  },
  page: pages[0],
  shots,
  references: references.selected,
}), /仍缺少故事板能力/);

const renderedRecipe = renderStoryboardBoardPrompt({
  project,
  scene,
  board: {
    ...board,
    strategyDecision: {
      ...board.strategyDecision,
      selectedStrategyId: mixedResolution.primaryStrategyId,
      selectedStrategyVersion: "v1",
      strategyResolution: mixedResolution,
    },
  } as any,
});
assert.deepEqual(renderedRecipe.modifierStrategyIds, mixedResolution.modifierStrategyIds);
assert.ok(renderedRecipe.prompt.includes("附加控制"));
assert.ok(renderedRecipe.prompt.includes("【Panel 合同】"));
assert.doesNotMatch(renderedRecipe.prompt, /strategyId|strategyVersion|templateId|schemaVersion|asset refs|部门 refs|9:16/i);

const danceRhythmResolution = resolveStoryboardStrategyCoverage({
  requiredCapabilityIds: [
    "narrative:dance",
    "control:body_rhythm",
    "control:camera_motion",
    "control:sound_rhythm",
    "control:rhythm_timeline",
    "temporal:dense_beats",
  ],
});
assert.deepEqual(danceRhythmResolution.uncoveredCapabilityIds, []);
assert.equal(danceRhythmResolution.primaryStrategyId, "storyboard.dance_choreography.v1");
assert.ok(danceRhythmResolution.modifierStrategyIds.includes("storyboard.rhythm_sheet.v1"));

const danceRhythmBoard = {
  ...board,
  id: "board-dance-rhythm-track",
  boardMode: "dance_choreography",
  layout: "4x3",
  lineArtPrompt: "一张十二格肢体动作复合故事板",
  videoGenerationUnitId: "video-unit-dance-rhythm",
  strategyDecision: {
    ...board.strategyDecision,
    selectedStrategyId: danceRhythmResolution.primaryStrategyId,
    selectedStrategyVersion: "v1",
    expectedVideoUnitDurationSeconds: 10,
    strategyResolution: danceRhythmResolution,
  },
  panels: Array.from({ length: 12 }, (_, index) => ({
    ...board.panels[index % board.panels.length],
    id: `dance-panel-${index + 1}`,
    panelNumber: index + 1,
    shotId: index < 6 ? "shot-a" : "shot-b",
    durationSeconds: (index % 3) + 1,
    subjectAction: `身体动作阶段 ${index + 1}`,
    cameraMove: index % 2 === 0 ? "摄影机顺动作向右跟移" : "摄影机回稳并保持轴线",
    soundCue: `节拍 ${index + 1}`,
    lightingCue: index < 8 ? "主光保持" : "轮廓光增强",
    continuityIn: index === 0 ? "双脚落地，重心居中" : `承接 P${index}`,
    continuityOut: index === 11 ? "动作定格，重心稳定" : `进入 P${index + 2}`,
    annotationLegendIds: [
      "subject_action_red",
      "camera_motion_blue",
      "sound_emotion_purple",
      ...(index === 8 ? ["energy_impact_orange"] : []),
    ],
    actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"],
  })),
  startState: "双脚落地，重心居中",
  endState: "动作定格，重心稳定",
} satisfies StoryboardBoard;

const danceRhythmTrack = buildStoryboardRhythmTrack(danceRhythmBoard);
assert.equal(danceRhythmTrack.totalDurationSeconds, 10);
assert.equal(danceRhythmTrack.panelCount, 12);
assert.equal(danceRhythmTrack.timingSource, "panel_duration_weights");
assert.deepEqual(danceRhythmTrack.lanes.map((lane) => lane.id), ["shot", "action", "camera", "sound", "lighting", "state"]);
assert.deepEqual(validateStoryboardRhythmTrack(danceRhythmTrack, danceRhythmBoard), []);
assert.equal(danceRhythmTrack.beats[0].startSeconds, 0);
assert.equal(danceRhythmTrack.beats.at(-1)?.endSeconds, 10);
assert.equal(new Set(danceRhythmTrack.beats.map((beat) => beat.panelId)).size, 12);
assert.ok(danceRhythmTrack.beats[8].emphasis.includes("impact"));
assert.ok(validateStoryboardRhythmTrack({
  ...danceRhythmTrack,
  beats: danceRhythmTrack.beats.map((beat, index) => index === 1 ? { ...beat, panelNumber: 9 } : beat),
}, danceRhythmBoard).some((issue) => issue.includes("panel numbers must match")));

const evenRhythmTrack = buildStoryboardRhythmTrack({
  ...danceRhythmBoard,
  id: "board-dance-even-rhythm-track",
  panels: danceRhythmBoard.panels.map((panel) => ({ ...panel, durationSeconds: undefined })),
});
assert.equal(evenRhythmTrack.timingSource, "even_distribution");
assert.equal(evenRhythmTrack.beats.at(-1)?.endSeconds, 10);
assert.deepEqual(validateStoryboardRhythmTrack(evenRhythmTrack), []);

const renderedDanceRhythm = renderStoryboardBoardPrompt({ project, scene, board: danceRhythmBoard });
assert.equal(renderedDanceRhythm.rhythmTrack?.schemaVersion, "storyboard-rhythm-track.v1");
assert.ok(renderedDanceRhythm.boardContext.includes("【结构化节奏轨】"));
assert.ok(renderedDanceRhythm.boardContext.includes("镜头轨:"));
assert.ok(renderedDanceRhythm.boardContext.includes("状态变化轨:"));

const renderedDialogueWithoutRhythm = renderStoryboardBoardPrompt({
  project,
  scene,
  board: {
    ...board,
    boardMode: "multi_shot_narrative",
    lineArtPrompt: "即使自由文本提到打斗、舞蹈和追逐，也必须服从结构化策略能力。",
  },
});
assert.equal(renderedDialogueWithoutRhythm.rhythmTrack, undefined);
assert.equal(renderedDialogueWithoutRhythm.boardContext.includes("【结构化节奏轨】"), false);

const storyboardPageSource = readFileSync(new URL("../src/pages/Storyboard.tsx", import.meta.url), "utf8");
const manualPanelSource = readFileSync(new URL("../src/components/production/ManualVideoStoryboardPanel.tsx", import.meta.url), "utf8");
assert.equal(storyboardPageSource.includes("onRegeneratePanel"), false, "formal storyboard UI must not expose per-panel image regeneration");
assert.equal(manualPanelSource.includes("onRegeneratePanel"), false, "manual storyboard panel must review the composite page as one deliverable");
assert.ok(manualPanelSource.includes("视频单元 ·"), "the UI must present a persisted video unit rather than a single-shot reference label");
assert.ok(manualPanelSource.includes("分镜宫格图"));
assert.ok(manualPanelSource.includes("故事板参考模式"));
assert.ok(manualPanelSource.includes("仅分镜序号"));
const repairPrompt = buildStoryboardCompositeBoardPrompt({
  project,
  scene,
  board,
  page: pages[0],
  shots,
  references: references.selected,
  repairIssues: ["P4 动作方向与 P3 冲突"],
});
assert.ok(repairPrompt.includes("P4 动作方向与 P3 冲突"));
assert.equal(repairPrompt.includes("第一张参考图"), false, "reference duties belong to the structured manifest");

const sourceHash = buildStoryboardCompositeBoardSourceHash({
  project,
  board,
  page: pages[0],
  references: references.selected,
});
const changedSourceHash = buildStoryboardCompositeBoardSourceHash({
  project,
  board: { ...board, endState: "角色乙停在门口" },
  page: pages[0],
  references: references.selected,
});
assert.notEqual(sourceHash, changedSourceHash);

const take = {
  id: "composite-take-1",
  imageUrl: "https://example.com/composite-board.jpg",
  sourceHash,
  prompt,
  promptHash: "prompt-hash",
  modelId: "image-model",
  selectedSkillIds: [],
  selectedSkillTitles: [],
  selectedContextIds: [],
  selectedAssetBoardItemIds: references.selected.map((item: any) => item.boardItemId),
  referenceImageUrls: references.selected.map((item: any) => item.referenceImageUrl),
  panelIds: pages[0].panelIds,
  attempt: 1,
  status: "candidate",
  review: { mode: "manual", status: "approved", reviewer: "creator", reviewedAt: 1 },
  executions: [],
  createdAt: 1,
} as ManualStoryboardBoardVisualTake;
const adoptedPage = adoptStoryboardBoardVisualTake({ page: pages[0], take, adoptedAt: 2 });
assert.equal(adoptedPage.activeVisualTakeId, take.id);
assert.equal(getActiveStoryboardBoardVisualTake(adoptedPage)?.status, "adopted");

let gridRenderCalls = 0;
let gridSaveCalls = 0;
const gridPage = await composeStoryboardShotGridPage({
  board, page: adoptedPage, shots, now: 100,
  render: async (input) => { gridRenderCalls++; assert.equal(input.layout, adoptedPage.layout); assert.deepEqual(input.cells.map((cell) => cell.imageUrl), shots.map((shot) => shot.imageUrl)); return "data:image/png;base64,composited-pixels"; },
  persist: async (url) => { gridSaveCalls++; assert.match(url, /^data:image/); return "/api/assets/composed-grid-1.png"; },
});
assert.equal(gridRenderCalls, 1);
assert.equal(gridSaveCalls, 1);
assert.equal(resolveStoryboardShotGridImage(gridPage), "/api/assets/composed-grid-1.png");
assert.equal(storyboardShotGridStatus({ board, page: gridPage, shots }), "ready");
assert.equal(getActiveStoryboardShotGridTake(gridPage)?.source, "adopted_shot_composition");
assert.equal(getActiveStoryboardShotGridTake(gridPage)?.sourceHash, buildStoryboardShotGridSourceHash({ board, page: gridPage, shots }));
assert.equal(getActiveStoryboardShotGridTake(gridPage)?.imageMedia?.generationJobId, undefined);
assert.deepEqual(gridPage.visualTakes, adoptedPage.visualTakes, "composing a grid must not replace director-board pictures or change their quality/review records");
assert.equal(adoptedPage.shotGridTakes, undefined, "the source page remains immutable");
assert.equal(await composeStoryboardShotGridPage({ board, page: gridPage, shots, render: async () => { throw new Error("unchanged grids must not render again"); }, persist: async () => { throw new Error("unchanged grids must not save again"); } }), gridPage);
const changedGridShots = shots.map((shot, index) => index ? shot : { ...shot, imageUrl: "/api/assets/new-shot-picture.png", activeTakeId: undefined, takes: [] });
assert.equal(storyboardShotGridStatus({ board, page: gridPage, shots: changedGridShots }), "stale");
const updatedGridPage = await composeStoryboardShotGridPage({ board, page: gridPage, shots: changedGridShots, now: 200, render: async () => "data:image/png;base64,new-grid", persist: async () => "/api/assets/composed-grid-2.png" });
assert.equal(updatedGridPage.shotGridTakes?.length, 2, "updating a grid retains the old composed image and its source cells");
assert.equal(updatedGridPage.shotGridTakes?.[0].imageUrl, "/api/assets/composed-grid-1.png");
assert.equal(resolveStoryboardShotGridImage(updatedGridPage), "/api/assets/composed-grid-2.png");
assert.equal(storyboardShotGridStatus({ board, page: updatedGridPage, shots: changedGridShots }), "ready");
assert.equal(storyboardShotGridStatus({ board, page: gridPage, shots }), "ready");
await assert.rejects(composeStoryboardShotGridPage({ board, page: adoptedPage, shots: shots.map((shot) => ({ ...shot, imageUrl: undefined, takes: [] })), render: async () => { throw new Error("missing images must be rejected before rendering"); }, persist: async () => "" }), /请先为本页 2 个分镜上传或采用图片/);
await assert.rejects(composeStoryboardShotGridPage({ board, page: adoptedPage, shots, render: async () => "data:image/png;base64,ok", persist: async () => { throw new Error("disk unavailable"); } }), /disk unavailable/);
assert.equal(adoptedPage.shotGridTakes, undefined, "failed persistence does not create an active grid or change board adoption");
const gridExportScene = { ...scene, shots, manualStoryboard: { boards: [{ id: "grid-export-unit", shotId: shots[0].id, shotIds: board.shotIds, unitSchema: "storyboard_unit.v1", board: { ...board, visualReferenceMode: "shot_grid", visualPages: [{ ...gridPage, visualTakes: [], activeVisualTakeId: undefined }] } }] } } as Scene;
const gridExports = buildSceneStoryboardExportItems(gridExportScene);
assert.equal(gridExports.length, 1);
assert.equal(gridExports[0].imageUrl, "/api/assets/composed-grid-1.png", "exports use the independently composed grid even when no director-board image exists");
assert.deepEqual(gridExports[0].shotIds, shots.map((shot) => shot.id));
assert.equal(buildSceneStoryboardExportItems({ ...gridExportScene, manualStoryboard: { ...gridExportScene.manualStoryboard!, boards: gridExportScene.manualStoryboard!.boards!.map((workflow) => ({ ...workflow, board: { ...workflow.board!, visualReferenceMode: undefined } })) } })[0].imageUrl, "/api/assets/composed-grid-1.png", "an omitted legacy mode follows the same default grid selection as the UI");

const qaPassingCandidate = {
  ...take,
  id: "composite-take-qa-pass",
  status: "candidate",
  review: { mode: "automatic", status: "approved", reviewedAt: 3 },
  createdAt: 3,
} as ManualStoryboardBoardVisualTake;
const stagedAfterAutomaticQa = stageStoryboardBoardVisualTakeForCreatorReview({
  page: adoptedPage,
  take: qaPassingCandidate,
});
assert.equal(stagedAfterAutomaticQa.activeVisualTakeId, take.id, "automatic QA must not replace the creator-adopted board image");
assert.equal(getActiveStoryboardBoardVisualTake(stagedAfterAutomaticQa)?.id, take.id);
assert.deepEqual(
  stagedAfterAutomaticQa.visualTakes?.find((item) => item.id === qaPassingCandidate.id)?.review,
  { mode: "manual", status: "pending", notes: undefined },
  "a QA-passing board image remains a candidate until explicit creator adoption",
);
const saturatedPage = {
  ...adoptedPage,
  visualTakes: [
    getActiveStoryboardBoardVisualTake(adoptedPage)!,
    ...Array.from({ length: 8 }, (_, index) => ({
      ...qaPassingCandidate,
      id: `older-board-candidate-${index + 1}`,
      createdAt: index + 3,
    })),
  ],
};
const stagedWithFullHistory = stageStoryboardBoardVisualTakeForCreatorReview({
  page: saturatedPage,
  take: { ...qaPassingCandidate, id: "newest-board-candidate", createdAt: 20 },
});
assert.equal(stagedWithFullHistory.visualTakes?.length, 8);
assert.equal(stagedWithFullHistory.activeVisualTakeId, take.id);
assert.ok(stagedWithFullHistory.visualTakes?.some((item) => item.id === take.id), "candidate retention must not evict the active adopted Take or its audit");
assert.ok(stagedWithFullHistory.visualTakes?.some((item) => item.id === "newest-board-candidate"));
assert.ok(stagedWithFullHistory.visualTakes?.some((item) => item.id === "older-board-candidate-8"), "the newest historical candidate must be retained");
assert.equal(stagedWithFullHistory.visualTakes?.some((item) => item.id === "older-board-candidate-1"), false, "the oldest unselected candidate must be evicted first");

const invalidPages = [{ ...pages[0], layout: "1x1" }];
assert.ok(validateStoryboardCompositeBoardContract({ board, pages: invalidPages, shots })
  .some((issue) => issue.code === "COMPOSITE_BOARD_LAYOUT_MISMATCH"));

const unsupportedLegacyAnchor = listStoryboardCompositeWorkflowAnchors({
  workflows: [{
    id: "removed-workflow-shot-a",
    shotId: "shot-a",
    board,
    updatedAt: 1,
  }],
  shots,
});
assert.equal(unsupportedLegacyAnchor.length, 0, "workflows without the current StoryboardUnit schema are ignored rather than migrated");

console.log("Storyboard composite board self-check passed.");
