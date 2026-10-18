import assert from "node:assert/strict";
import type { ManualStoryboardBoard, ManualStoryboardBoardVisualTake, Scene, Shot } from "../src/types/project";
import {
  buildStoryboardCompositeVisualPages,
  buildStoryboardShotGridSourceHash,
  composeStoryboardShotGridPage,
  mergeStoryboardShotGridPageResult,
  reconcileStoryboardCompositeVisualPages,
  resolveReadyStoryboardShotGridImage,
  storyboardShotGridStatus,
} from "../src/services/production/storyboardCompositeBoard";
import { buildSceneStoryboardExportItems } from "../src/hooks/useEpisodeFilmExport";
import { buildManualVideoStoryboardReadModel } from "../src/services/production/manualVideoStoryboard";
import { extractAndSaveAssets } from "../src/utils/storage";
import { assetClient } from "../src/clients/assetClient";

// Synthetic software fixtures: these carry no creative-quality claim.
const shots = ["a", "b"].map(id => ({ id, duration: 4, imageUrl: `/api/assets/${id}.png` } as Shot));
const board = {
  id: "grid-lifecycle-board", shotIds: shots.map(shot => shot.id), layout: "2x1",
  panels: shots.map((shot, index) => ({ id: `panel-${shot.id}`, shotId: shot.id, panelNumber: index + 1, framePurpose: "key", durationSeconds: 4 })),
} as ManualStoryboardBoard;
const page = buildStoryboardCompositeVisualPages(board)[0];
const grid = await composeStoryboardShotGridPage({ board, page, shots, now: 1, render: async () => "pixels", persist: async () => "/api/assets/grid-v1.png" });
const legacyTake = {
  id: "legacy-take", imageUrl: "/api/assets/director.png", videoReferenceImageUrl: "/api/assets/old-grid.png",
  sourceHash: "director-source", status: "adopted", review: { mode: "manual", status: "approved" },
} as ManualStoryboardBoardVisualTake;
const legacyPage = { ...page, activeVisualTakeId: legacyTake.id, visualTakes: [legacyTake] };
const changedShots = shots.map((shot, index) => index ? shot : { ...shot, imageUrl: "/api/assets/a-v2.png" });
const failures: string[] = [];
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}

await check("replanning retains independent grid history", () => {
  const replanned = reconcileStoryboardCompositeVisualPages({ ...board, shotIds: ["b", "a"], visualPages: [grid] });
  assert.equal(replanned[0].shotGridTakes?.[0].imageUrl, "/api/assets/grid-v1.png");
});
await check("legacy grid without source evidence is retained but needs recomposition", () => {
  assert.equal(storyboardShotGridStatus({ board, page: legacyPage, shots: changedShots }), "stale");
  assert.equal(legacyPage.visualTakes[0].videoReferenceImageUrl, "/api/assets/old-grid.png");
});
await check("export uses current adopted shot images instead of unverifiable old grid", () => {
  const scene = { id: "lifecycle-scene", shots: changedShots, manualStoryboard: { boards: [{ id: "unit", unitSchema: "storyboard_unit.v1", shotId: "a", shotIds: board.shotIds, board: { ...board, visualReferenceMode: "shot_grid", visualPages: [legacyPage] } }] } } as Scene;
  assert.deepEqual(buildSceneStoryboardExportItems(scene).map(item => item.imageUrl), changedShots.map(shot => shot.imageUrl));
});
await check("matching source hash with missing image must render again", async () => {
  const broken = { ...grid, shotGridTakes: grid.shotGridTakes!.map(take => ({ ...take, imageUrl: "" })) };
  let rendered = false;
  const recovered = await composeStoryboardShotGridPage({ board, page: broken, shots, now: 2, render: async () => { rendered = true; return "pixels"; }, persist: async () => "/api/assets/recovered.png" });
  assert.equal(rendered, true);
  assert.equal(recovered.shotGridTakes?.length, 2);
});
await check("a missing selected grid cannot silently use the director take", () => {
  assert.equal(storyboardShotGridStatus({ board, page: { ...legacyPage, activeShotGridTakeId: "missing-take" }, shots }), "missing");
});
await check("source hash detects adopted shot replacement", () => {
  assert.notEqual(buildStoryboardShotGridSourceHash({ board, page, shots }), buildStoryboardShotGridSourceHash({ board, page, shots: changedShots }));
});
await check("combined take stores independent source evidence for grid consumers", () => {
  const evidenced = { ...legacyPage, visualTakes: [{ ...legacyTake, videoReferenceSourceHash: buildStoryboardShotGridSourceHash({ board, page, shots }) }] };
  assert.equal(storyboardShotGridStatus({ board, page: evidenced, shots }), "ready");
  assert.equal(resolveReadyStoryboardShotGridImage({ board, page: evidenced, shots }), legacyTake.videoReferenceImageUrl);
  assert.equal(resolveReadyStoryboardShotGridImage({ board, page: evidenced, shots: changedShots }), undefined);
  assert.equal(resolveReadyStoryboardShotGridImage({ board, page: legacyPage, shots }), undefined);
});
await check("mixed independent and legacy pages cannot report all pages ready", () => {
  const manyShots = Array.from({ length: 25 }, (_, index) => ({ id: `shot-${index}`, imageUrl: `/api/assets/${index}.png` } as Shot));
  const manyBoard = { ...board, shotIds: manyShots.map(shot => shot.id), panels: manyShots.map((shot, index) => ({ ...board.panels[0], id: `panel-${index}`, shotId: shot.id, panelNumber: index + 1 })) };
  const [first, last] = buildStoryboardCompositeVisualPages(manyBoard);
  const withPages = { ...manyBoard, visualPages: [{ ...first, activeShotGridTakeId: "fresh", shotGridTakes: [{ ...grid.shotGridTakes![0], id: "fresh", sourceHash: buildStoryboardShotGridSourceHash({ board: manyBoard, page: first, shots: manyShots }) }] }, { ...last, visualTakes: [legacyTake], activeVisualTakeId: legacyTake.id }] };
  const readModel = buildManualVideoStoryboardReadModel({ workflowOverride: { id: "mixed-unit", unitSchema: "storyboard_unit.v1", shotId: manyShots[0].id, board: withPages, updatedAt: 1 }, shot: manyShots[0], storyboardSourceHash: "source", scene: { id: "mixed", shots: manyShots } as Scene });
  assert.equal(readModel.panelVisualStatus, "stale");
  assert.equal(readModel.readyVisualPageCount, 1);
});
await check("async composition merges current history and preserves director changes", async () => {
  const result = await composeStoryboardShotGridPage({ board, page: grid, shots: changedShots, now: 2, render: async () => "pixels", persist: async () => "/api/assets/grid-v2.png" });
  const intervening = { ...grid.shotGridTakes![0], id: "concurrent-history", imageUrl: "/api/assets/concurrent-history.png" };
  const latest = { ...legacyPage, ...grid, visualTakes: [legacyTake], shotGridTakes: [...grid.shotGridTakes!, intervening] };
  const merged = mergeStoryboardShotGridPageResult({ board, page: latest, shots: changedShots, result });
  assert.equal(merged.shotGridTakes?.length, 3);
  assert.ok(merged.shotGridTakes?.some(take => take.id === intervening.id));
  assert.deepEqual(merged.visualTakes, [legacyTake]);
  assert.equal(mergeStoryboardShotGridPageResult({ board, page: merged, shots: changedShots, result }), merged, "duplicate completion is idempotent");
  assert.throws(() => mergeStoryboardShotGridPageResult({ board, page: latest, shots, result }), /分镜图在合成过程中有更新/);
  assert.throws(() => mergeStoryboardShotGridPageResult({ board, page: { ...latest, id: "other-page" }, shots: changedShots, result }), /分镜图在合成过程中有更新/);
});
await check("media serialization preserves valid grid evidence without refreshing stale takes", async () => {
  const inlineShots = shots.map(shot => ({ ...shot, imageUrl: `data:image/png;base64,${Buffer.from(shot.id).toString("base64")}` }));
  const inlinePage = await composeStoryboardShotGridPage({ board, page, shots: inlineShots, now: 3, render: async () => "pixels", persist: async () => "/media/inline-grid.png" });
  inlinePage.shotGridTakes!.unshift({ ...grid.shotGridTakes![0], id: "stale-history", sourceHash: "unrelated-historical-source" });
  const snapshot = { ...inlinePage, visualTakes: [{ ...legacyTake, videoReferenceSourceHash: buildStoryboardShotGridSourceHash({ board, page, shots: inlineShots }) }], activeVisualTakeId: legacyTake.id };
  const original = { id: "serialize-scene", shots: inlineShots, manualStoryboard: { boards: [{ id: "serialize-unit", board: { ...board, visualPages: [snapshot] } }] } } as Scene;
  const upload = assetClient.uploadAsset;
  assetClient.uploadAsset = async ({ dataUrl }) => ({ url: `/media/fixture/${dataUrl.split(",")[1]}.png` });
  try {
    const saved = await extractAndSaveAssets(original, "fixture") as Scene;
    const savedBoard = saved.manualStoryboard!.boards![0].board!, savedPage = savedBoard.visualPages![0];
    assert.equal(storyboardShotGridStatus({ board: savedBoard, page: savedPage, shots: saved.shots! }), "ready");
    assert.equal(savedPage.shotGridTakes![0].sourceHash, "unrelated-historical-source");
    assert.notEqual(savedPage.shotGridTakes![1].sourceHash, snapshot.shotGridTakes![1].sourceHash);
    assert.equal(savedPage.visualTakes![0].videoReferenceSourceHash, savedPage.shotGridTakes![1].sourceHash);
    assert.deepEqual(savedPage.shotGridTakes![1].cells.map(cell => cell.imageUrl), saved.shots!.map(shot => shot.imageUrl));
    assert.equal(savedPage.visualTakes![0].sourceHash, legacyTake.sourceHash, "serialization does not rewrite director-board QA evidence");
    assert.ok(original.shots![0].imageUrl?.startsWith("data:"));
    assert.equal(storyboardShotGridStatus({ board: savedBoard, page: savedPage, shots: changedShots }), "stale");
  } finally { assetClient.uploadAsset = upload; }
});
assert.deepEqual(failures, [], `${failures.length} shot-grid lifecycle regressions`);
