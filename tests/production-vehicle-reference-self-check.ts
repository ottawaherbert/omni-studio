import assert from "node:assert/strict";
import type { Episode, ManualStoryboardBoard, ManualStoryboardBoardVisualPage, Project, Scene } from "../src/types/project";
import { buildVideoStoryboardAssetBoardPlan } from "../src/services/production/videoStoryboardAssetBoards";
import { buildManualProductionAssetReadModel } from "../src/services/production/manualProductionAssets";
import { applyProductionSceneManualAssetBindingsToBreakdown, buildProductionSceneVehicleSelectionUpdate, buildProductionSceneAssetBindingUpdate } from "../src/services/production/productionProjectAssets";
import { buildProductionAssetBoardReferenceUpdate } from "../src/services/production/productionAssetBoardProfile";
import { resolveProductionAssetReferenceModeSpec } from "../src/services/production/productionAssetReferenceMode";
import { buildProductionAssetBoardExecutionPrompt } from "../src/services/production/productionAssetBoardExecution";
import { buildProductionSceneVisualPackDrafts } from "../src/services/production/videoStoryboardSceneVisualPacks";
import { buildProductionAssetReferencePackDrafts } from "../src/services/production/videoStoryboardPromptPacks";
import {
  buildStoryboardCompositeBoardPrompt,
  buildStoryboardCompositeBoardSourceHash,
  getLatestStoryboardBoardVisualCandidate,
  selectStoryboardCompositeBoardReferences,
} from "../src/services/production/storyboardCompositeBoard";
import { compileImageGenerationRequest, createImageGenerationReference } from "../src/services/production/imageGenerationRequest";
import { resolveStoryboardVehicleId } from "../src/services/production/storyboardShotAgent";

const project = {
  id: "vehicle-reference-project", title: "渡轮连续性", type: "movie", aspectRatio: "16:9",
  characters: [{ id: "captain", name: "船长", cleanReferenceImageUrl: "/media/captain.png" }],
  assets: [
    { id: "bridge", type: "location", name: "驾驶台", cleanReferenceImageUrl: "/media/bridge.png" },
    { id: "wrench", type: "prop", name: "扳手", cleanReferenceImageUrl: "/media/wrench.png" },
    { id: "ferry", type: "vehicles", name: "双层渡轮", description: "驾驶台与客舱同层，左舷车辆门。", cleanReferenceImageUrl: "/media/ferry-v1.png" },
    { id: "ferry-alt", type: "vehicles", name: "另一渡轮", cleanReferenceImageUrl: "/media/ferry-alt.png" },
  ],
  episodes: [],
} as unknown as Project;
const scene = {
  id: "vehicle-scene", title: "左舷靠岸", description: "船长在驾驶台调整航向。", script: "双层渡轮左舷靠近码头。",
  breakdown: {
    setting: "INT.", time: "NIGHT", location: "驾驶台", locationId: "bridge",
    characters: ["船长"], characterIds: ["captain"], props: ["扳手"], propIds: ["wrench"],
  },
  shots: [{ id: "shot-ferry", duration: 5, visualAction: "双层渡轮左舷靠近码头", imagePrompt: "从码头看双层渡轮左舷靠岸", characterIdsInShot: ["captain"], locationId: "bridge", propIds: ["wrench"] }],
} as Scene;
const episode = { id: "vehicle-episode", title: "第一单元", scenes: [scene] } as Episode;

const planned = buildVideoStoryboardAssetBoardPlan(project);
assert.equal(planned.vehicleBoards[0]?.assetType, "vehicles");
assert.equal(planned.vehicleBoards[0]?.boardKind, "vehicle_board");
assert.equal(planned.vehicleBoards[0]?.referenceImageUrl, "/media/ferry-v1.png");
const selection = buildProductionSceneVehicleSelectionUpdate({ project, scene, vehicleId: "ferry", selected: true });
assert.equal(Object.hasOwn(selection, "manualStoryboard"), false, "a partial workspace scene must not explicitly clear unloaded boards");
const boundScene = { ...scene, ...selection } as Scene;
assert.deepEqual(boundScene.breakdown?.vehicleIds, ["ferry"]);
assert.deepEqual(boundScene.shots[0].vehicleIds, ["ferry"]);
assert.deepEqual(applyProductionSceneManualAssetBindingsToBreakdown({ project, scene: boundScene, breakdown: scene.breakdown! }).vehicleIds, ["ferry"], "a later breakdown revision must retain the creator-selected vehicle");
const boundEpisode = { ...episode, scenes: [boundScene] };
const assets = buildManualProductionAssetReadModel({ project, episode: boundEpisode, scene: boundScene });
assert.notEqual(assets.assetPackHash, buildManualProductionAssetReadModel({ project, episode, scene }).assetPackHash);
assert.deepEqual(new Set(assets.assetBoards.map((item) => item.assetType)), new Set(["character", "location", "prop", "vehicles"]));
assert.equal(assets.sceneVisualPack?.referenceSlots.find((slot) => slot.assetId === "ferry")?.purpose, "vehicle");
assert.equal(assets.assetReferencePack?.items.find((item) => item.assetId === "ferry")?.assetType, "vehicles");

const board = {
  id: "board-ferry", episodeId: episode.id, sceneId: scene.id, shotId: "shot-ferry", shotIds: ["shot-ferry"],
  boardMode: "single_shot", layout: "1x1", lineArtPrompt: "靠岸分镜", arrowLegendIds: [], performanceBeatIds: [], scriptBlockIds: [], strategyOrigin: "built_in",
  strategyDecision: { selectedStrategyId: "storyboard.single_shot_dialogue.v1", selectedStrategyVersion: "v1", selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1", rationale: "空间关系", rejectedStrategyIds: [], riskNotes: [], expectedBoardShape: "1x1", expectedVideoUnitDurationSeconds: 5, expectedReferenceImageCount: 4, expectedReferenceVideoCount: 0, arrowLegendIds: [], qaChecklist: [] },
  panels: [{ id: "panel-ferry", panelNumber: 1, shotId: "shot-ferry", durationSeconds: 5, framePurpose: "确认左舷方向", assetRefs: ["captain", "bridge", "wrench", "ferry"], annotationLegendIds: [], actionArrowLegendIds: [] }],
  startState: "船在外侧", endState: "船靠近码头",
} as ManualStoryboardBoard;
const page = { id: "page-ferry", pageIndex: 0, pageCount: 1, layout: "1x1", annotationMode: "director_annotated_sheet", panelIds: ["panel-ferry"] } as ManualStoryboardBoardVisualPage;
const refs = selectStoryboardCompositeBoardReferences({ project, board, shots: boundScene.shots, assets });
assert.deepEqual(refs.missingAssetIds, []);
assert.deepEqual(new Set(refs.selected.map((item) => item.assetType)), new Set(["character", "location", "prop", "vehicles"]));
assert.equal(refs.selected.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/ferry-v1.png");
const prompt = buildStoryboardCompositeBoardPrompt({ project, scene: boundScene, board, page, shots: boundScene.shots, references: refs.selected });
assert.match(prompt, /交通工具连续性/);
assert.match(prompt, /轮廓、比例、左右方位/);
const imageRequest = compileImageGenerationRequest({ promptCore: prompt, aspectRatio: "16:9", references: refs.selected.map((item) => createImageGenerationReference({ imageUrl: item.referenceImageUrl!, label: item.assetName, role: item.assetType === "character" ? "character_identity" : item.assetType === "location" ? "location_design" : item.assetType === "vehicles" ? "vehicle_design" : "prop_design" })) });
assert.equal(imageRequest.references.find((item) => item.role === "vehicle_design")?.imageUrl, "/media/ferry-v1.png");
const variantProject = { ...project, assets: project.assets.map((asset) => asset.id === "ferry" ? {
  ...asset, variants: [{ id: "ferry-damaged", name: "左舷受损", description: "左舷车辆门受损", promptModifiers: "damaged port vehicle door", cleanReferenceImageUrl: "/media/ferry-damaged.png" }],
} : asset) };
const variantScene = { ...boundScene,
  breakdown: { ...boundScene.breakdown!, assetVariantMap: { ferry: "ferry-damaged" } },
  shots: boundScene.shots.map((shot) => ({ ...shot, appearance: { analysis: "complete" as const, states: [{
    assetId: "captain", assetName: "船长", timelineKey: "同夜", event: "保持原造型", evidence: "船长", origin: "script" as const,
    continuity: "new" as const, startChanges: {}, endChanges: {}, start: {}, end: {}, imageMoment: "start" as const,
    referenceNeed: "image" as const, decision: "accepted" as const, issues: [], sourceHash: "appearance-source",
  }] } })),
} as Scene;
const variantAssets = buildManualProductionAssetReadModel({ project: variantProject, episode: { ...episode, scenes: [variantScene] }, scene: variantScene });
const appearanceRefs = selectStoryboardCompositeBoardReferences({ project: variantProject, board, shots: variantScene.shots, assets: variantAssets });
assert.equal(appearanceRefs.selected.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/ferry-damaged.png", "accepted character appearance must not drop the selected vehicle variant");
assert.equal(appearanceRefs.selected.find((item) => item.assetType === "vehicles")?.variantId, "ferry-damaged");
const oldHash = buildStoryboardCompositeBoardSourceHash({ project, board, page, references: refs.selected, shots: boundScene.shots });
const candidate = { id: "take-old", status: "candidate", sourceHash: oldHash, createdAt: 1 } as any;
const changedProject = { ...project, ...buildProductionAssetBoardReferenceUpdate({ project, boardItemId: planned.vehicleBoards[0].id, imageUrl: "/media/ferry-v2.png", source: "upload", referenceMode: "clean_reference", finalPrompt: "人工更换双层渡轮正式船型参考" }) };
const changedAssets = buildManualProductionAssetReadModel({ project: changedProject, episode: boundEpisode, scene: boundScene });
const changedRefs = selectStoryboardCompositeBoardReferences({ project: changedProject, board, shots: boundScene.shots, assets: changedAssets });
const newHash = buildStoryboardCompositeBoardSourceHash({ project: changedProject, board, page, references: changedRefs.selected, shots: boundScene.shots });
assert.notEqual(newHash, oldHash, "replacing the canonical vehicle image must stale the old board candidate");
assert.equal(getLatestStoryboardBoardVisualCandidate({ ...page, visualTakes: [candidate] } as any, newHash), undefined);
const replaced = buildProductionSceneAssetBindingUpdate({ project, scene: boundScene, sourceAssetId: "ferry", targetAssetId: "ferry-alt", assetType: "vehicles" });
assert.equal(Object.hasOwn(replaced, "manualStoryboard"), false, "rebinding from partial scene data must not clear unloaded boards");
assert.deepEqual(replaced.breakdown?.vehicleIds, ["ferry-alt"]);
assert.deepEqual(replaced.shots?.[0]?.vehicleIds, ["ferry-alt"]);
const without = buildProductionSceneVehicleSelectionUpdate({ project, scene: boundScene, vehicleId: "ferry", selected: false });
assert.deepEqual(without.breakdown?.vehicleIds, []);
assert.deepEqual(without.shots?.[0]?.vehicleIds, []);
const sceneWithBoard = { ...scene, manualStoryboard: { schemaVersion: "manual-storyboard.v1", boards: [{ board }], updatedAt: 1 } } as Scene;
const panelBinding = buildProductionSceneVehicleSelectionUpdate({ project, scene: sceneWithBoard, vehicleId: "ferry", selected: true });
assert.ok(panelBinding.manualStoryboard?.boards?.[0]?.board?.panels[0].assetRefs.includes("ferry"));
const replacedPanel = buildProductionSceneAssetBindingUpdate({ project, scene: { ...sceneWithBoard, ...panelBinding } as Scene, sourceAssetId: "ferry", targetAssetId: "ferry-alt", assetType: "vehicles" });
assert.ok(replacedPanel.manualStoryboard?.boards?.[0]?.board?.panels[0].assetRefs.includes("ferry-alt"));
assert.equal(replacedPanel.manualStoryboard?.boards?.[0]?.board?.panels[0].assetRefs.includes("ferry"), false);

// A generic vehicle board must also work for a car without inventing decks or ship doors.
const carProject = { ...project, id: "car-project", assets: [
  { id: "car", type: "vehicles", name: "巡逻警车", description: "四门轿车，右前车门凹陷。", cleanReferenceImageUrl: "/media/car.png",
    variants: [{ id: "damaged", name: "受损状态", description: "右前车门凹陷加深，挡风玻璃裂纹。", promptModifiers: "dent and cracked windshield", cleanReferenceImageUrl: "/media/car-damaged.png" }] },
] } as Project;
const carBoard = buildVideoStoryboardAssetBoardPlan(carProject).vehicleBoards[0];
const cleanCar = resolveProductionAssetReferenceModeSpec(carBoard, "clean_reference");
assert.match(carBoard.prompt || "", /四门轿车/);
assert.doesNotMatch([carBoard.prompt, carBoard.layoutContract.requiredViews.join(" "), cleanCar.label, cleanCar.requiredViews.join(" "), cleanCar.compositionInstruction].join(" "), /船|舷|甲板|登船门/);
assert.doesNotMatch(buildProductionAssetBoardExecutionPrompt(carProject, carBoard, "clean_reference"), /船|舷|甲板|登船门/);
const carScene = { ...scene, id: "car-intact", title: "警车完好", breakdown: { ...scene.breakdown!, locationId: undefined, characterIds: [], propIds: [], vehicleIds: ["car"], assetVariantMap: {} },
  shots: [{ id: "car-shot-a", duration: 4, vehicleIds: ["car"], visualAction: "警车驶入" }] } as Scene;
const damagedScene = { ...carScene, id: "car-damaged", title: "警车受损", breakdown: { ...carScene.breakdown!, assetVariantMap: { car: "damaged" } }, shots: [{ ...carScene.shots[0], id: "car-shot-b" }] } as Scene;
const sameDamagedScene = { ...damagedScene, id: "car-damaged-repeat", title: "受损状态续场", shots: [{ ...damagedScene.shots[0], id: "car-shot-c" }] } as Scene;
const carEpisode = { ...episode, id: "car-episode", scenes: [carScene, damagedScene, sameDamagedScene] } as Episode;
const carPacks = buildProductionSceneVisualPackDrafts(carProject, [carEpisode]);
assert.equal(carPacks.sceneVisualPacks.length, 2, "intact and damaged car must not merge into one visual pack");
const intactPack = carPacks.sceneVisualPacks.find((pack) => pack.linkedSceneIds.includes(carScene.id))!;
const damagedPack = carPacks.sceneVisualPacks.find((pack) => pack.linkedSceneIds.includes(damagedScene.id))!;
assert.notEqual(intactPack.visualFingerprint, damagedPack.visualFingerprint);
assert.deepEqual(damagedPack.linkedSceneIds.sort(), [damagedScene.id, sameDamagedScene.id].sort(), "same vehicle variant should reuse its pack");
assert.equal(intactPack.referenceSlots.find((slot) => slot.purpose === "vehicle")?.referenceImageUrl, "/media/car.png");
assert.equal(damagedPack.referenceSlots.find((slot) => slot.purpose === "vehicle")?.referenceImageUrl, "/media/car-damaged.png");
const carReferencePacks = buildProductionAssetReferencePackDrafts(carProject, [carEpisode], carPacks.sceneVisualPacks).assetReferencePacks;
assert.equal(carReferencePacks.find((pack) => pack.sceneId === carScene.id)?.items.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/car.png");
assert.equal(carReferencePacks.find((pack) => pack.sceneId === damagedScene.id)?.items.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/car-damaged.png");
const intactReadModel = buildManualProductionAssetReadModel({ project: carProject, episode: carEpisode, scene: carScene });
const damagedReadModel = buildManualProductionAssetReadModel({ project: carProject, episode: carEpisode, scene: damagedScene });
assert.equal(intactReadModel.assetReferencePack?.items.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/car.png");
assert.equal(damagedReadModel.assetReferencePack?.items.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/car-damaged.png");
assert.equal(damagedReadModel.assetBoards.find((item) => item.assetType === "vehicles" && item.variantId === "damaged")?.referenceImageUrl, "/media/car-damaged.png");
const editedCarProject = { ...carProject, assets: carProject.assets.map((asset) => ({ ...asset, variants: asset.variants?.map((variant) => ({ ...variant, description: "右前门凹陷，挡风玻璃星状裂纹已扩大。" })) })) } as Project;
const editedCarPacks = buildProductionSceneVisualPackDrafts(editedCarProject, [carEpisode]).sceneVisualPacks;
const editedDamagedPack = editedCarPacks.find((pack) => pack.linkedSceneIds.includes(damagedScene.id))!;
assert.notEqual(editedDamagedPack.visualFingerprint, damagedPack.visualFingerprint, "variant description edits must update scene context");
assert.match(editedDamagedPack.vehicles?.[0]?.continuityState || "", /星状裂纹已扩大/);
const editedDamagedReadModel = buildManualProductionAssetReadModel({ project: editedCarProject, episode: carEpisode, scene: damagedScene });
assert.match(editedDamagedReadModel.sceneStates.find((state) => state.assetType === "vehicles")?.stateSummary || "", /星状裂纹已扩大/);

const shotOnlyScene = { ...carScene, breakdown: undefined } as Scene;
const shotOnlyReadModel = buildManualProductionAssetReadModel({ project: carProject, episode: { ...carEpisode, scenes: [shotOnlyScene] }, scene: shotOnlyScene });
assert.equal(shotOnlyReadModel.assetBoards.find((item) => item.assetType === "vehicles")?.referenceImageUrl, "/media/car.png", "legacy shot-only vehicle bindings must survive upstream asset projection");
assert.equal(shotOnlyReadModel.sceneVisualPack?.referenceSlots.find((slot) => slot.purpose === "vehicle")?.assetId, "car");
const aliasedCarProject = { ...carProject, assets: carProject.assets.map((asset) => ({ ...asset, name: "Patrol Car", aliases: ["警车甲"] })) } as Project;
assert.equal(resolveStoryboardVehicleId(aliasedCarProject, " patrol CAR "), "car");
assert.equal(resolveStoryboardVehicleId(aliasedCarProject, "警车甲"), "car");
assert.equal(resolveStoryboardVehicleId({ ...aliasedCarProject, assets: [...aliasedCarProject.assets, { ...aliasedCarProject.assets[0], id: "car-2" }] }, "警车甲"), undefined, "ambiguous aliases require a canonical ID");

// Saved pre-vehicle checkpoints must be refreshed, never silently treated as formal approval.
const { executeAssetSyncStage } = await import("../src/services/production/productionAssetSyncStageRunner");
const { setProductionRepository } = await import("../src/services/production/productionRepositoryRuntime");
let repositoryProject = { ...carProject, characters: [] } as Project;
const repositoryEpisode = { ...carEpisode, scenes: [shotOnlyScene] };
setProductionRepository({
  getProject: () => repositoryProject,
  updateProject: async (updates) => { repositoryProject = { ...repositoryProject, ...updates }; },
  listEpisodes: async () => [repositoryEpisode],
  getEpisode: async () => repositoryEpisode,
  addEpisode: async () => { throw new Error("unexpected episode creation"); },
  updateEpisode: async () => { throw new Error("unexpected episode mutation"); },
  listOperatorArtifacts: async () => [],
});
try {
  const legacyPlan = { ...buildVideoStoryboardAssetBoardPlan(repositoryProject), productionReadiness: "formal_ready" } as any;
  delete legacyPlan.vehicleBoards;
  const legacyRun = { stages: [{ id: "asset-detail", stageType: "production_asset_detail" }], checkpoints: [{ stageId: "asset-detail", kind: "output", snapshot: { assetBoardPlan: legacyPlan } }] } as any;
  const result = await executeAssetSyncStage(legacyRun);
  assert.equal((result.outputSnapshot as any).requiresAssetDetailRerun, true);
  const vehicleSlot = (result.outputSnapshot as any).sceneVisualPackDrafts.sceneVisualPacks[0]?.referenceSlots.find((slot: any) => slot.purpose === "vehicle");
  assert.ok(vehicleSlot?.boardItemId, "regenerated draft must have a real vehicle board identity");
  assert.equal(vehicleSlot.referenceImageUrl, "/media/car.png");
  assert.ok(result.qaReports.some((report) => report.issues.some((issue) => issue.target === "assetSync.vehicleBoardsMissing" && issue.severity === "blocking")));
  const noVehicleProject = { ...repositoryProject, assets: [] };
  repositoryProject = noVehicleProject;
  const unaffected = await executeAssetSyncStage({ ...legacyRun, checkpoints: [{ stageId: "asset-detail", kind: "output", snapshot: { assetBoardPlan: { ...legacyPlan, productionReadiness: "development_only" } } }] } as any);
  assert.equal((unaffected.outputSnapshot as any).requiresAssetDetailRerun, false, "legacy projects without vehicles need no migration");
} finally {
  setProductionRepository(undefined);
}
console.log("production vehicle reference self-check passed");
