import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createSerializedSaveQueue } from "../src/utils/serializedSaveQueue";

type ProjectSnapshot = { id: string; title: string };
type EpisodeSnapshot = { id: string; content: string };

let releaseFirstSave!: () => void;
let markFirstStarted!: () => void;
const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
const firstGate = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
const persisted: Array<{ project: ProjectSnapshot; episodes: EpisodeSnapshot[] }> = [];
let activeSaves = 0;
let idleCount = 0;

const queue = createSerializedSaveQueue<ProjectSnapshot, EpisodeSnapshot>({
  persist: async (_projectId, project, episodes) => {
    activeSaves += 1;
    assert.equal(activeSaves, 1, "project snapshots must never persist concurrently");
    persisted.push({ project, episodes });
    if (persisted.length === 1) {
      markFirstStarted();
      await firstGate;
    }
    activeSaves -= 1;
  },
  onIdle: () => { idleCount += 1; },
});

queue.schedule("project-1", { id: "project-1", title: "first" }, [{ id: "episode-1", content: "first" }], 0);
await firstStarted;
queue.schedule("project-1", { id: "project-1", title: "latest" }, [{ id: "episode-1", content: "latest" }], 60_000);
const flushed = queue.flush("project-1");
await Promise.resolve();
assert.equal(activeSaves, 1);
releaseFirstSave();
await flushed;

assert.equal(persisted.length, 2);
assert.equal(persisted[1].project.title, "latest");
assert.equal(persisted[1].episodes[0].content, "latest");
assert.equal(idleCount, 1);

let shouldFail = true;
let failedBatchTitle = "";
let retainedBatchTitle = "";
let saveAttempts = 0;
const retryQueue = createSerializedSaveQueue<ProjectSnapshot, EpisodeSnapshot>({
  persist: async (_projectId, project) => {
    saveAttempts += 1;
    if (shouldFail) throw new Error("offline");
    persisted.push({ project, episodes: [] });
  },
  onFailure: (_projectId, batch) => { failedBatchTitle = batch.projectData.title; },
  onPendingAfterFailure: (_projectId, batch) => { retainedBatchTitle = batch.projectData.title; },
});
retryQueue.schedule("project-2", { id: "project-2", title: "recoverable" }, [], 60_000);
await assert.rejects(retryQueue.flush("project-2"), /offline/);
assert.equal(failedBatchTitle, "recoverable");
shouldFail = false;
await assert.rejects(retryQueue.flush("project-2"), /offline/, "flush does not silently retry a failed save");
retryQueue.schedule("project-2", { id: "project-2", title: "edited while offline" }, [], 0);
assert.equal(retainedBatchTitle, "edited while offline", "later edits refresh the recovery copy");
assert.equal(saveAttempts, 1, "later edits do not retry in the background");
retryQueue.clearFailure("project-2");
await retryQueue.flush("project-2");
assert.equal(saveAttempts, 1, "a manually recovered batch is not replayed by the queue");
retryQueue.schedule("project-2", { id: "project-2", title: "new edit after recovery" }, [], 60_000);
await retryQueue.flush("project-2");
assert.equal(persisted.at(-1)?.project.title, "new edit after recovery");

const sourceSection = (filePath: string, startMarker: string, endMarker: string) => {
  const source = readFileSync(filePath, "utf8");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${filePath} should contain ${startMarker}`);
  assert.notEqual(end, -1, `${filePath} should contain ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
};

const markerPositions = (source: string, marker: string) => {
  const positions: number[] = [];
  let cursor = source.indexOf(marker);
  while (cursor !== -1) {
    positions.push(cursor);
    cursor = source.indexOf(marker, cursor + marker.length);
  }
  return positions;
};

const assertFlushBeforeCompletion = (
  source: string,
  completionMarker: string,
  label: string,
) => {
  const updatePosition = Math.max(
    source.lastIndexOf("await updateScene("),
    source.lastIndexOf("await updateProject("),
    source.lastIndexOf("await onConfirmAssetPack("),
  );
  const flushPosition = source.indexOf("await flushDebouncedProjectSave(");
  const completionPosition = source.indexOf(completionMarker, flushPosition + 1);
  assert.ok(updatePosition >= 0, `${label} should await its canonical update`);
  assert.ok(flushPosition > updatePosition, `${label} should flush after its canonical update`);
  assert.ok(completionPosition > flushPosition, `${label} should flush before closing or reporting success`);
};

const assertFlushFailureHandled = (
  source: string,
  flushMarker: string,
  completionMarker: string,
  label: string,
) => {
  const flushPosition = source.indexOf(flushMarker);
  const catchPosition = source.indexOf("catch (error)", flushPosition + flushMarker.length);
  const errorToastPosition = source.indexOf("toast.error(", catchPosition + 1);
  const returnPosition = source.indexOf("return;", errorToastPosition + 1);
  const completionPosition = source.indexOf(completionMarker, returnPosition + 1);
  assert.ok(flushPosition >= 0, `${label} should flush the project save queue`);
  assert.ok(catchPosition > flushPosition, `${label} should catch persistence failures`);
  assert.ok(errorToastPosition > catchPosition, `${label} should report persistence failures to the author`);
  assert.ok(returnPosition > errorToastPosition, `${label} should stop before reporting success after a persistence failure`);
  assert.ok(completionPosition > returnPosition, `${label} should only complete after the handled flush`);
};

const stateClientSource = readFileSync("apps/web/src/clients/stateClient.ts", "utf8");
assert.ok(
  stateClientSource.includes('export { flushDebouncedProjectSave } from "../../../../src/store/slices/projectSlice"'),
  "stateClient should expose the existing project save queue flush",
);

const storyboardAdoptionSource = sourceSection(
  "src/hooks/useStoryboardAI.ts",
  "const adoptReviewCandidate = async () =>",
  "return {",
);
const storyboardUpdatePositions = markerPositions(storyboardAdoptionSource, "await updateScene(");
const storyboardFlushPositions = markerPositions(storyboardAdoptionSource, "await flushDebouncedProjectSave(currentProject.id)");
const storyboardClosePositions = markerPositions(storyboardAdoptionSource, "setReviewCandidate(null)");
assert.equal(storyboardUpdatePositions.length, 2, "Shot and prompt adoption should each await one canonical scene update");
assert.equal(storyboardFlushPositions.length, 2, "Shot and prompt adoption should each flush the project save queue");
assert.equal(storyboardClosePositions.length, 2, "Shot and prompt adoption should each close after persistence");
for (let index = 0; index < storyboardFlushPositions.length; index += 1) {
  assert.ok(storyboardUpdatePositions[index] < storyboardFlushPositions[index]);
  assert.ok(storyboardFlushPositions[index] < storyboardClosePositions[index]);
}
for (const [startMarker, endMarker, completionMarker, label] of [
  ["if (reviewCandidate.kind === \"shots\")", "const currentSourceHash =", "setReviewCandidate(null)", "Shot-plan adoption"],
  ["const currentSourceHash =", "return {", "setReviewCandidate(null)", "prompt-layer adoption"],
] as const) {
  const section = sourceSection("src/hooks/useStoryboardAI.ts", startMarker, endMarker);
  assertFlushFailureHandled(
    section,
    "await flushDebouncedProjectSave(currentProject.id)",
    completionMarker,
    label,
  );
}

const manualVideoStoryboardSource = readFileSync("src/hooks/useManualVideoStoryboard.ts", "utf8");
for (const [startMarker, endMarker, completionMarker, label] of [
  ["const adoptCandidate = async () =>", "const confirmBoard = async () =>", "setCandidate(null)", "storyboard candidate adoption"],
  ["const confirmBoard = async () =>", "const setTargetVideoModel = async", "toast.success", "video-unit board confirmation"],
  ["const saveUnitVideoPrompt = async", "const rebuildUnitVideoPrompt = async", "toast.success", "video-unit prompt confirmation"],
  ["const approvePanelVisual = async", "const approveBoardVisual = async", "toast.success", "storyboard panel adoption"],
  ["const approveBoardVisual = async", "const composeShotGrid = async", "toast.success", "storyboard page adoption"],
] as const) {
  const start = manualVideoStoryboardSource.indexOf(startMarker);
  const end = manualVideoStoryboardSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `useManualVideoStoryboard should contain ${startMarker}`);
  assert.notEqual(end, -1, `useManualVideoStoryboard should contain ${endMarker}`);
  const section = manualVideoStoryboardSource.slice(start, end);
  assertFlushBeforeCompletion(section, completionMarker, label);
  assertFlushFailureHandled(
    section,
    "await flushDebouncedProjectSave(project.id)",
    completionMarker,
    label,
  );
}

const breakdownReviewSource = sourceSection(
  "src/components/production/preparation/ProductionBreakdownReviewActions.tsx",
  "const adopt = async () =>",
  "return <>",
);
assertFlushBeforeCompletion(breakdownReviewSource, "setCandidate(null)", "breakdown review adoption");

const breakdownWorkspaceSource = readFileSync(
  "src/components/production/preparation/ProductionSceneBreakdownWorkspace.tsx",
  "utf8",
);
for (const [startMarker, endMarker, completionMarker, label] of [
  ["const adopt = async () =>", "const confirmExistingBreakdown = async", "setCandidate(null)", "breakdown candidate adoption"],
  ["const confirmExistingBreakdown = async", "return (", "toast.success", "existing breakdown confirmation"],
] as const) {
  const start = breakdownWorkspaceSource.indexOf(startMarker);
  const end = breakdownWorkspaceSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `ProductionSceneBreakdownWorkspace should contain ${startMarker}`);
  assert.notEqual(end, -1, `ProductionSceneBreakdownWorkspace should contain ${endMarker}`);
  assertFlushBeforeCompletion(breakdownWorkspaceSource.slice(start, end), completionMarker, label);
}

const assetPanelSource = readFileSync("src/components/production/ManualProductionAssetsPanel.tsx", "utf8");
for (const [startMarker, endMarker, label] of [
  ["const persistBoard = async", "const bindingBoardsFor", "asset board confirmation"],
  ["const persistBinding = async", "const bindVariant = async", "scene asset binding confirmation"],
  ["const confirmAssetPack = async", "return (", "scene asset pack confirmation"],
] as const) {
  const start = assetPanelSource.indexOf(startMarker);
  const end = assetPanelSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `ManualProductionAssetsPanel should contain ${startMarker}`);
  assert.notEqual(end, -1, `ManualProductionAssetsPanel should contain ${endMarker}`);
  assertFlushBeforeCompletion(assetPanelSource.slice(start, end), "toast.success", label);
}

console.log("serialized project save queue and Production author-decision flush boundaries passed");
