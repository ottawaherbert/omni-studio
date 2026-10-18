import assert from "node:assert/strict";
import fs from "node:fs";

import {
  planStoryboardStudioVideoUnits,
} from "../src/services/production/storyboardCompositeBoard";
import {
  buildManualStudioFrameReferenceCandidates,
  buildManualStudioGenerationDraftKey,
  filterManualStudioDistinctEndFrameCandidates,
} from "../src/services/production/manualStudioReferenceCandidates";

const shotDurations = [6, 6, 6, 6, 6, 6, 6, 6, 6, 6];
const shots = shotDurations.map((duration, index) => ({
  id: `shot-${index + 1}`,
  duration,
  characterIdsInShot: index < 4 ? ["parent"] : ["dog"],
  locationId: index < 5 ? "kitchen" : "yard",
  propIds: index === 1 ? ["toaster"] : [],
  visualAction: `action-${index + 1}`,
})) as any[];

const panels = shots.map((shot, index) => ({
  id: `panel-${index + 1}`,
  panelNumber: index + 1,
  shotId: shot.id,
  durationSeconds: shot.duration,
  framePurpose: `frame-${index + 1}`,
  assetRefs: [...shot.characterIdsInShot, shot.locationId, ...shot.propIds],
  annotationLegendIds: [],
  actionArrowLegendIds: [],
  continuityIn: `state-${index}`,
  continuityOut: `state-${index + 1}`,
})) as any[];

const adoptedVisualTake = {
  id: "take-scene-board",
  imageUrl: "https://cdn.example.com/scene-board.png",
  sourceHash: "board-source",
  prompt: "scene board",
  promptHash: "board-prompt",
  modelId: "image-model",
  selectedSkillIds: [],
  selectedSkillTitles: [],
  selectedContextIds: [],
  selectedAssetBoardItemIds: [],
  referenceImageUrls: [],
  panelIds: panels.map((panel) => panel.id),
  attempt: 1,
  status: "adopted",
  executions: [],
  createdAt: 1,
};

const sceneWorkflow = {
  id: "workflow-scene",
  boardId: "board-scene",
  videoGenerationUnitId: "unit-scene",
  targetVideoModelConfigId: "local-h3",
  shotId: shots[0].id,
  shotIds: shots.map((shot) => shot.id),
  strategyDecision: {
    selectedStrategyId: "storyboard.multi_shot_narrative.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    rationale: "scene board",
    rejectedStrategyIds: [],
    riskNotes: [],
    expectedBoardShape: "scene board",
    expectedVideoUnitDurationSeconds: 60,
    expectedReferenceImageCount: 4,
    expectedReferenceVideoCount: 0,
    arrowLegendIds: [],
    qaChecklist: [],
  },
  board: {
    id: "board-scene",
    episodeId: "episode-1",
    sceneId: "scene-1",
    shotId: shots[0].id,
    shotIds: shots.map((shot) => shot.id),
    videoGenerationUnitId: "unit-scene",
    strategyDecision: undefined as any,
    boardMode: "multi_shot_narrative",
    layout: "5x2",
    lineArtPrompt: "scene board",
    arrowLegendIds: [],
    performanceBeatIds: [],
    scriptBlockIds: [],
    strategyOrigin: "built_in",
    panels,
    visualPages: [{
      id: "board-scene.page.1",
      pageIndex: 0,
      pageCount: 1,
      layout: "5x2",
      annotationMode: "director_annotated_sheet",
      panelIds: panels.map((panel) => panel.id),
      visualTakes: [adoptedVisualTake],
      activeVisualTakeId: adoptedVisualTake.id,
    }],
    startState: "state-0",
    endState: "state-10",
  },
  confirmedAt: 1,
  updatedAt: 1,
} as any;
sceneWorkflow.board.strategyDecision = sceneWorkflow.strategyDecision;

const original = structuredClone(sceneWorkflow);
const h3Plan = planStoryboardStudioVideoUnits({
  workflow: sceneWorkflow,
  shots,
  minDurationSeconds: 5,
  maxDurationSeconds: 15,
  supportsMultiShotSingleGeneration: true,
});
assert.equal(h3Plan.issues.length, 0);
assert.deepEqual(h3Plan.units.map((unit) => unit.shotIds), [
  ["shot-1", "shot-2"],
  ["shot-3", "shot-4"],
  ["shot-5", "shot-6"],
  ["shot-7", "shot-8"],
  ["shot-9", "shot-10"],
]);
assert.ok(h3Plan.units.every((unit) => unit.strategyDecision?.expectedVideoUnitDurationSeconds === 12));
assert.ok(h3Plan.units.every((unit) => unit.board?.visualPages?.[0].visualTakes?.[0].imageUrl === adoptedVisualTake.imageUrl));
assert.deepEqual(
  h3Plan.units[0].board?.panels.flatMap((panel) => panel.assetRefs),
  ["parent", "kitchen", "parent", "kitchen", "toaster"],
  "each derived unit must carry only references used by its own panels",
);
assert.equal(h3Plan.units[0].board?.panels.some((panel) => panel.assetRefs.includes("dog")), false);
assert.deepEqual(sceneWorkflow, original, "planning for a model must not mutate the persisted storyboard");

const switchedPlan = planStoryboardStudioVideoUnits({
  workflow: sceneWorkflow,
  shots,
  minDurationSeconds: 5,
  maxDurationSeconds: 10,
  supportsMultiShotSingleGeneration: true,
});
assert.deepEqual(switchedPlan.units.map((unit) => unit.shotIds), shots.map((shot) => [shot.id]));
assert.deepEqual(sceneWorkflow, original, "switching the execution model must not rewrite script, shots, assets, or storyboard");

const shortPlan = planStoryboardStudioVideoUnits({
  workflow: {
    ...sceneWorkflow,
    shotIds: ["shot-1", "shot-2"],
    board: {
      ...sceneWorkflow.board,
      shotIds: ["shot-1", "shot-2"],
      panels: panels.slice(0, 2),
      visualPages: [{ ...sceneWorkflow.board.visualPages[0], panelIds: ["panel-1", "panel-2"] }],
    },
  },
  shots: shots.slice(0, 2),
  minDurationSeconds: 5,
  maxDurationSeconds: 15,
  supportsMultiShotSingleGeneration: true,
});
assert.equal(shortPlan.units.length, 1, "existing short-scene behavior must remain one unit");
assert.deepEqual(shortPlan.units[0].shotIds, ["shot-1", "shot-2"]);
assert.equal(shortPlan.units[0].videoGenerationUnitId, "unit-scene", "an already valid short unit must keep its persisted identity");

const tailShots = [6, 6, 4].map((duration, index) => ({ id: `tail-${index + 1}`, duration })) as any[];
const tailPanels = tailShots.map((shot, index) => ({
  ...panels[0],
  id: `tail-panel-${index + 1}`,
  panelNumber: index + 1,
  shotId: shot.id,
  durationSeconds: shot.duration,
}));
const tailPlan = planStoryboardStudioVideoUnits({
  workflow: {
    ...sceneWorkflow,
    shotId: tailShots[0].id,
    shotIds: tailShots.map((shot) => shot.id),
    board: {
      ...sceneWorkflow.board,
      shotId: tailShots[0].id,
      shotIds: tailShots.map((shot) => shot.id),
      panels: tailPanels,
      visualPages: [{ ...sceneWorkflow.board.visualPages[0], panelIds: tailPanels.map((panel) => panel.id) }],
    },
  },
  shots: tailShots,
  minDurationSeconds: 5,
  maxDurationSeconds: 15,
  supportsMultiShotSingleGeneration: true,
});
assert.deepEqual(tailPlan.units.map((unit) => unit.strategyDecision?.expectedVideoUnitDurationSeconds), [6, 10]);
assert.equal(tailPlan.issues.length, 0, "a short tail should be rebalanced without duplicating or dropping a shot");

const missingPanelPlan = planStoryboardStudioVideoUnits({
  workflow: {
    ...sceneWorkflow,
    shotIds: ["shot-1", "shot-2"],
    board: {
      ...sceneWorkflow.board,
      shotIds: ["shot-1", "shot-2"],
      panels: panels.slice(0, 1),
      visualPages: [{ ...sceneWorkflow.board.visualPages[0], panelIds: ["panel-1"] }],
    },
  },
  shots: shots.slice(0, 2),
  minDurationSeconds: 5,
  maxDurationSeconds: 15,
  supportsMultiShotSingleGeneration: true,
});
assert.deepEqual(missingPanelPlan.issues[0]?.shotIds, ["shot-2"], "a shot without panels must be blocked instead of silently dropped");

const studioSource = fs.readFileSync(new URL("../src/pages/Studio.tsx", import.meta.url), "utf8");
assert.ok(studioSource.includes("const persistedStudioWorkflow = useMemo(() => urlVideoUnitId"), "Studio must resolve an adopted StoryboardUnit by its stable URL id");
assert.equal(studioSource.includes("planStoryboardStudioVideoUnits"), false, "Studio must consume only persisted units and never create provider-sized shadow units");
assert.ok(studioSource.includes('manualVideoStoryboardReadModel?.workflow?.unitSchema === "storyboard_unit.v1"'), "normal Studio routing must resolve the current persisted unit by Shot membership");
assert.ok(studioSource.includes("const workflow = manualStudioWorkflow;"), "storyboard generation must use the selected persisted unit instead of the whole scene board");
assert.ok(studioSource.includes("manualStudioVideoUnitIssue?.message"), "invalid atomic tails must remain blocked in the author-facing page");
assert.ok(studioSource.includes("takes: manualStudioWorkflow?.takes || []"), "preview and Take selection must project unit-owned Takes without writing them back to the first Shot");
assert.ok(studioSource.includes('urlVideoGenerationMode === "shot" && !urlVideoUnitId'), "a direct StoryboardUnit URL must default to the unit target instead of the first Shot");
assert.ok(studioSource.includes('videoRef.current.getAttribute("src") !== studioPreviewPlayingShot.videoUrl'), "unit-owned video Takes must drive the real preview source without reloading relative URLs on each tick");
assert.ok(studioSource.includes("studioReferenceDrafts[studioReferenceDraftKey]"), "reference choices must be restored from a source/model/mode draft bucket");
assert.ok(studioSource.includes("当前生成方式的参考选择已保留，不会提交给新方式"), "changing mode with selected references must explicitly explain retention and non-submission");
assert.equal(studioSource.includes("onGenerationWayChange={setSelectedVideoAdapterId}"), false, "mode changes must not bypass reference-draft retention");

const firstShot = {
  id: "frame-first",
  activeTakeId: "first-adopted",
  takes: [
    { id: "first-adopted", imageUrl: "https://cdn.example.com/first.png" },
    { id: "first-ready-but-not-adopted", imageUrl: "https://cdn.example.com/first-alt.png", imageMedia: { status: "ready" } },
  ],
};
const middleShot = {
  id: "frame-middle",
  activeTakeId: "middle-adopted",
  takes: [{ id: "middle-adopted", imageUrl: "https://cdn.example.com/middle.png" }],
};
const lastShot = {
  id: "frame-last",
  activeTakeId: "last-adopted",
  takes: [
    { id: "last-adopted", imageUrl: "https://cdn.example.com/last.png" },
    { id: "last-ready", imageUrl: "https://cdn.example.com/last-alt.png", imageMedia: { status: "ready" } },
    { id: "last-pending", imageUrl: "https://cdn.example.com/last-pending.png", imageMedia: { status: "pending" } },
  ],
};
const frameCandidates = buildManualStudioFrameReferenceCandidates([
  firstShot,
  middleShot,
  lastShot,
] as any[]);
assert.deepEqual(frameCandidates.start.map((candidate) => candidate.id), ["first-adopted"], "a unit start frame must be the first Shot's adopted image only");
assert.deepEqual(frameCandidates.end.map((candidate) => candidate.id), ["last-adopted", "last-ready"], "a unit end frame must come only from eligible images on the last Shot");
assert.equal(frameCandidates.start.some((candidate) => candidate.shotId === middleShot.id), false, "middle Shots must never leak into frame boundaries");
assert.equal(frameCandidates.end.some((candidate) => candidate.id === "last-pending"), false, "pending image Takes are not eligible end frames");
const pendingAdoptedFrames = buildManualStudioFrameReferenceCandidates([{
  id: "pending-shot",
  activeTakeId: "pending-adopted",
  takes: [{
    id: "pending-adopted",
    imageUrl: "https://cdn.example.com/pending.png",
    imageMedia: { status: "pending" },
  }],
}] as any[]);
assert.deepEqual(pendingAdoptedFrames, { start: [], end: [] }, "an active Take is not a frame candidate while its media is pending");

const signedStartFrames = buildManualStudioFrameReferenceCandidates([{
  id: "signed-start",
  activeTakeId: "signed-start-take",
  takes: [{ id: "signed-start-take", imageUrl: "https://cdn.example.com/frame.png?token=old&variant=full" }],
}] as any[]);
const signedEndFrames = buildManualStudioFrameReferenceCandidates([{
  id: "signed-end",
  activeTakeId: "signed-end-take",
  takes: [
    { id: "signed-end-take", imageUrl: "https://cdn.example.com/frame.png?variant=full&token=new" },
    { id: "distinct-end-take", imageUrl: "https://cdn.example.com/frame-2.png", imageMedia: { status: "ready" } },
  ],
}] as any[]);
assert.deepEqual(
  filterManualStudioDistinctEndFrameCandidates(signedStartFrames.start[0], signedEndFrames.end).map((candidate) => candidate.id),
  ["distinct-end-take"],
  "different Take ids that resolve to the same normalized media must not form a start/end pair",
);

const draftSourceKey = "storyboard_unit:unit-1:prompt-hash";
const refDraftKey = buildManualStudioGenerationDraftKey({ sourceKey: draftSourceKey, modelConfigId: "cloud-h3", modeId: "ref2va" });
assert.notEqual(refDraftKey, buildManualStudioGenerationDraftKey({ sourceKey: draftSourceKey, modelConfigId: "cloud-h3", modeId: "i2va" }), "each generation mode must own a separate reference draft");
assert.notEqual(refDraftKey, buildManualStudioGenerationDraftKey({ sourceKey: draftSourceKey, modelConfigId: "local-h3", modeId: "ref2va" }), "each model configuration must own a separate reference draft");
assert.notEqual(refDraftKey, buildManualStudioGenerationDraftKey({ sourceKey: "shot:shot-1:prompt-hash", modelConfigId: "cloud-h3", modeId: "ref2va" }), "each source must own a separate reference draft");

const promptModalSource = fs.readFileSync(new URL("../src/components/PromptEditorModal.tsx", import.meta.url), "utf8");
const manualStudioAISource = fs.readFileSync(new URL("../src/hooks/useManualStudioAI.ts", import.meta.url), "utf8");
assert.ok(manualStudioAISource.includes("selectionLocked: true"), "manual Studio confirmation must lock the model/mode selected by the owning surface");
assert.equal(promptModalSource.match(/disabled=\{videoGeneration\.selectionLocked\}/g)?.length, 2, "the confirmation modal must not override either a locked Studio model or generation mode");

console.log("manual studio storyboard video-unit self-check passed");
