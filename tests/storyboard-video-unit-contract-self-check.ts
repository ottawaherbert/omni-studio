import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildEpisodeFilmCoverage,
  buildSceneStoryboardExportItems,
  buildSceneVideoExportItems,
} from "../src/hooks/useEpisodeFilmExport";
import { resolveManualStudioUnitPlaybackRange } from "../src/services/production/manualStudioVideoIntent";
import { appendStudioCandidateToScene } from "../src/services/production/shotTakeReview";
import {
  buildShotUpstreamPromptHash,
  buildStoryboardUnitVideoPromptRecord,
  buildStoryboardUnitUpstreamPromptHash,
  resolveStoryboardUnitVideoPrompt,
} from "../src/services/production/storyboardUnitVideoPrompt";

const activeTake = {
  id: "take-unit-1",
  videoUrl: "https://cdn.example.com/unit-1.mp4",
  createdAt: 1,
};
const scene = {
  id: "scene-1",
  shots: [
    { id: "shot-1", duration: 4 },
    { id: "shot-2", duration: 3 },
    { id: "shot-3", duration: 5, videoUrl: "https://cdn.example.com/shot-3.mp4" },
  ],
  manualStoryboard: {
    schemaVersion: "manual-storyboard.v1",
    boards: [{
      id: "workflow-unit-1",
      unitSchema: "storyboard_unit.v1",
      shotId: "shot-1",
      shotIds: ["shot-1", "shot-2"],
      videoGenerationUnitId: "unit-1",
      takes: [activeTake],
      activeTakeId: activeTake.id,
      updatedAt: 1,
    }, {
      id: "removed-workflow",
      shotId: "shot-1",
      shotIds: ["shot-1"],
      videoGenerationUnitId: "unit-removed",
      takes: [{ id: "removed-take", videoUrl: "https://cdn.example.com/removed.mp4", createdAt: 1 }],
      activeTakeId: "removed-take",
      updatedAt: 1,
    }],
    updatedAt: 1,
  },
} as any;

const promptWorkflow = {
  id: "workflow-prompt",
  unitSchema: "storyboard_unit.v1",
  shotId: "shot-1",
  shotIds: ["shot-1", "shot-2"],
  videoGenerationUnitId: "unit-prompt",
  board: {
    id: "board-prompt",
    videoGenerationUnitId: "unit-prompt",
    shotIds: ["shot-1", "shot-2"],
    panels: [],
    startState: "林渊被锁链悬吊",
    endState: "陆尘举起剑骨",
  },
} as any;
const promptShots = [
  { id: "shot-1", duration: 4, videoPrompt: "锁链滑向林渊", dialogueLines: [{ speakerName: "陆尘", text: "别怪师弟。" }] },
  { id: "shot-2", duration: 3, videoPrompt: "剑骨离体，林渊抬眼" },
] as any[];
const promptRecord = buildStoryboardUnitVideoPromptRecord({ workflow: promptWorkflow, shots: promptShots, now: 10 });
assert.match(promptRecord.text, /镜头 1/);
assert.match(promptRecord.text, /镜头 2/);
assert.equal(resolveStoryboardUnitVideoPrompt({ workflow: { ...promptWorkflow, unitVideoPrompt: promptRecord }, shots: promptShots }).status, "ready");
const stalePrompt = resolveStoryboardUnitVideoPrompt({ workflow: { ...promptWorkflow, unitVideoPrompt: promptRecord }, shots: [{ ...promptShots[0], duration: 5 }, promptShots[1]] });
assert.equal(stalePrompt.status, "stale");
const lightingChangedPrompt = resolveStoryboardUnitVideoPrompt({
  workflow: { ...promptWorkflow, unitVideoPrompt: promptRecord },
  shots: [{ ...promptShots[0], lightingAtmo: "冷色月光改为暖色逆光" }, promptShots[1]],
});
assert.equal(lightingChangedPrompt.status, "stale", "lighting changes must stale the unit-level Studio prompt");
assert.ok(lightingChangedPrompt.text.includes("光影氛围：冷色月光改为暖色逆光"));
assert.notEqual(stalePrompt.text, promptRecord.text, "a stale stored prompt must show the current deterministic rebuild baseline, not obsolete text");
assert.equal(stalePrompt.storedText, promptRecord.text, "the obsolete author text may remain available only as comparison provenance");
assert.notEqual(buildShotUpstreamPromptHash(promptShots[0]), buildStoryboardUnitUpstreamPromptHash({ workflow: { ...promptWorkflow, unitVideoPrompt: promptRecord }, shots: promptShots }));

assert.deepEqual(buildSceneVideoExportItems(scene), [
  { videoUrl: activeTake.videoUrl, durationSeconds: 7 },
  { videoUrl: "https://cdn.example.com/shot-3.mp4", durationSeconds: 5 },
]);
assert.deepEqual(buildEpisodeFilmCoverage({ scenes: [scene] } as any), {
  readyShotCount: 3,
  imageShotCount: 0,
  totalShotCount: 3,
  completedSceneCount: 1,
  completedShotCount: 3,
  totalSceneCount: 1,
});

const storyboardScene = {
  id: "scene-storyboard-export",
  shots: [
    { id: "shot-board-1", duration: 4 },
    { id: "shot-board-2", duration: 3 },
    { id: "shot-image-fallback", duration: 5, imageUrl: "https://cdn.example.com/fallback.jpg" },
    { id: "shot-auto-only", duration: 2 },
  ],
  manualStoryboard: {
    schemaVersion: "manual-storyboard.v1",
    boards: [{
      id: "workflow-board-export",
      unitSchema: "storyboard_unit.v1",
      shotId: "shot-board-1",
      shotIds: ["shot-board-1", "shot-board-2"],
      board: {
        id: "board-export",
        shotIds: ["shot-board-1", "shot-board-2"],
        visualReferenceMode: "shot_grid",
        panels: [
          { id: "panel-export-1", shotId: "shot-board-1" },
          { id: "panel-export-2", shotId: "shot-board-2" },
        ],
        visualPages: [{
          id: "page-export",
          panelIds: ["panel-export-1", "panel-export-2"],
          activeVisualTakeId: "take-board-adopted",
          visualTakes: [{
            id: "take-board-adopted",
            imageUrl: "https://cdn.example.com/director-board.jpg",
            videoReferenceImageUrl: "https://cdn.example.com/clean-grid.jpg",
            status: "adopted",
            review: { mode: "manual", status: "approved", reviewer: "creator" },
          }],
        }],
      },
    }, {
      id: "workflow-auto-only",
      unitSchema: "storyboard_unit.v1",
      shotId: "shot-auto-only",
      shotIds: ["shot-auto-only"],
      board: {
        id: "board-auto-only",
        shotIds: ["shot-auto-only"],
        panels: [{ id: "panel-auto-only", shotId: "shot-auto-only" }],
        visualPages: [{
          id: "page-auto-only",
          panelIds: ["panel-auto-only"],
          activeVisualTakeId: "take-auto-only",
          visualTakes: [{
            id: "take-auto-only",
            imageUrl: "https://cdn.example.com/auto-only.jpg",
            status: "adopted",
            review: { mode: "automatic", status: "approved" },
          }],
        }],
      },
    }],
  },
} as any;
assert.deepEqual(buildSceneStoryboardExportItems(storyboardScene), [{
  imageUrl: "https://cdn.example.com/clean-grid.jpg",
  durationSeconds: 7,
  shotIds: ["shot-board-1", "shot-board-2"],
}, {
  imageUrl: "https://cdn.example.com/fallback.jpg",
  durationSeconds: 5,
  shotIds: ["shot-image-fallback"],
}]);
assert.equal(buildEpisodeFilmCoverage({ scenes: [storyboardScene] } as any).imageShotCount, 3);

assert.deepEqual(resolveManualStudioUnitPlaybackRange({
  shotPositions: [
    { id: "shot-1", start: 0, duration: 4 },
    { id: "shot-2", start: 4, duration: 3 },
    { id: "shot-3", start: 7, duration: 5 },
  ],
  shotIds: ["shot-2", "shot-3"],
}), { start: 4, end: 12 }, "unit video timing must stay anchored to its first Shot across internal cuts");

const studioSource = fs.readFileSync(new URL("../src/pages/Studio.tsx", import.meta.url), "utf8");
const hookSource = fs.readFileSync(new URL("../src/hooks/useManualStudioAI.ts", import.meta.url), "utf8");
const batchSource = fs.readFileSync(new URL("../src/hooks/useStoryboardBoardBatchAgent.ts", import.meta.url), "utf8");
const panelSource = fs.readFileSync(new URL("../src/components/production/ManualVideoStoryboardPanel.tsx", import.meta.url), "utf8");
const storyboardSource = fs.readFileSync(new URL("../src/pages/Storyboard.tsx", import.meta.url), "utf8");
const promptSource = fs.readFileSync(new URL("../src/services/production/storyboardUnitVideoPrompt.ts", import.meta.url), "utf8");
assert.ok(studioSource.includes("manualStudioWorkflow?.takes"), "Studio must read unit-owned Takes");
assert.ok(studioSource.includes("activeTakeId: manualStudioWorkflow?.activeTakeId"), "Studio preview must receive the unit active Take");
assert.ok(studioSource.includes("unitVideoCoversCurrentTime"), "unit video must only replace the timeline while its persisted Shot range is active");
assert.ok(studioSource.includes("positionedVideoUnitRef.current !== requestedUnitKey"), "a video-unit deep link must seek to the unit once without pinning later playback");
assert.ok(studioSource.includes('workflow.unitSchema === "storyboard_unit.v1"'), "Studio deep links, navigation and Take selection must ignore removed storyboard formats");
assert.ok(
  hookSource.includes("legacyProjectClient.appendStudioCandidate")
    && hookSource.includes('boardId: !isImage && request.target.kind === "storyboard_board" ? request.target.boardId : undefined'),
  "generation must send unit ownership through the candidate endpoint",
);
const unitCandidateScene = structuredClone(scene);
unitCandidateScene.manualStoryboard.boards[0].boardId = "board-unit-1";
const appended = appendStudioCandidateToScene(unitCandidateScene, { shotId: "shot-1", boardId: "board-unit-1", take: { id: "new-unit-candidate", videoUrl: "/fixture/unit.mp4", createdAt: 2 } });
assert.deepEqual(appended.shots, scene.shots, "unit candidates must not become per-Shot takes");
assert.equal(appended.manualStoryboard!.boards![0].takes!.length, 2);
assert.equal(appended.manualStoryboard!.boards![0].activeTakeId, activeTake.id, "a candidate must not silently replace the adopted version");
assert.ok(hookSource.includes('.filter((workflow) => workflow.unitSchema === "storyboard_unit.v1")'), "video task recovery must ignore removed storyboard formats");
assert.ok(batchSource.includes("takes: existingUnit?.takes"), "batch regeneration must retain generated/imported unit Takes");
assert.ok(batchSource.includes("activeTakeId: existingUnit?.activeTakeId"), "batch regeneration must retain the selected unit Take");
assert.ok(batchSource.includes('if (candidate.unitSchema !== "storyboard_unit.v1") return false;'), "batch regeneration must not inherit IDs, Takes or modes from removed workflows");
assert.ok(batchSource.includes("workspace.defaultVisualReferenceMode"), "new units must inherit the creator-selected scene reference mode");
assert.ok(panelSource.includes('return videoChannels.some((item) => item.id === model.channelId);'), "storyboard model selection must be capability-driven rather than provider/model hardcoded");
assert.ok(hookSource.includes('return config.channels.some((item) => item.id === model.channelId);'), "Studio model selection must keep future registered video models available");
assert.ok(storyboardSource.includes("相邻视频单元必须先统一为同一个有效目标视频模型"), "units with mixed or missing model capability contracts must never merge unchecked");
assert.ok(batchSource.includes("buildStoryboardUnitVideoPromptRecord"), "batch generation must persist one canonical model-independent prompt per StoryboardUnit");
assert.ok(panelSource.includes("saveUnitVideoPrompt") && panelSource.includes("rebuildUnitVideoPrompt"), "the Storyboard page must own editing and deterministic rebuilding of the unit prompt");
assert.ok(studioSource.includes("resolveStoryboardUnitVideoPrompt") && studioSource.includes("studioVideoPromptDirty"), "Studio must initialize a Take-local prompt draft from the upstream unit prompt without overwriting it");
assert.ok(hookSource.includes("upstreamPromptHash: request.target.upstreamPromptHash"), "each generated Take must audit the exact upstream prompt version it used");
assert.ok(promptSource.includes("buildShotUpstreamPromptHash") && promptSource.includes("buildStoryboardUnitUpstreamPromptHash"), "Shot and StoryboardUnit prompt lineage must use canonical payload hashes");

console.log("Storyboard video-unit ownership self-check passed.");
