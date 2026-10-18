import assert from "node:assert/strict";
import {
  getStoryboardBoardRequestShots,
  normalizeStoryboardBoardExecutionResponse,
} from "../src/hooks/useStoryboardBoardBatchAgent";
import {
  buildRuleBasedStoryboardBoardValue,
  getActionableStoryboardBoardIssues,
  mergeStoryboardBoardBatchValues,
  normalizeStoryboardBoardQualityWithEvidence,
  splitStoryboardBoardShots,
  validateStoryboardBoardBatch,
} from "../src/services/production/storyboardBoardAgent";
import type { Shot } from "../src/types/project";

const episodeId = "episode-manual-batch", sceneId = "scene-manual-batch";
const shots = Array.from({ length: 14 }, (_, index) => ({
  id: `${sceneId}-shot-${index + 1}`,
  duration: 8,
  visualAction: "角色将杯子放在桌上。",
  motivation: "交代杯子落点。",
  continuityNote: "固定同侧机位，杯子保持在角色右手中直到落桌。",
  cameraMovement: "Static",
} as Shot));
// Synthetic structures only exercise transport boundaries; they are not production QA results.
const response = shots.map((shot) => {
  const value = buildRuleBasedStoryboardBoardValue({ episodeId, sceneId, shot, referenceImageCount: 0 });
  return { shotId: shot.id, strategyDecision: value.strategyDecision, ...value.workflow };
});
const chunks = splitStoryboardBoardShots(shots);
assert.deepEqual(chunks.map((chunk) => chunk.length), [4, 4, 4, 2]);
const receive = (value: unknown, manualExecution: boolean, requestedShots = chunks[0]) =>
  normalizeStoryboardBoardExecutionResponse({ value, episodeId, sceneId, sceneShots: shots, requestedShots, manualExecution });

const manual = receive(response, true);
assert.equal(manual.length, 14);
assert.ok(chunks.slice(1).every((chunk) => getStoryboardBoardRequestShots(chunk, manual, true).length === 0));
assert.ok(manual.every((value) => !('qa' in value.workflow)), "Receiving structure cannot manufacture QA.");

const partial = receive(response.filter((_, index) => index !== 5), true);
assert.deepEqual(getStoryboardBoardRequestShots(chunks[1], partial, true).map((shot) => shot.id), [shots[5].id]);
const incomplete = structuredClone(response);
incomplete[5].board!.panels[0].visualBeat = "";
assert.deepEqual(getStoryboardBoardRequestShots(chunks[1], receive(incomplete, true), true).map((shot) => shot.id), [shots[5].id]);
assert.deepEqual(receive({}, true), []);
assert.equal(getStoryboardBoardRequestShots(chunks[1], [], true).length, 4);

const foreign = { ...response[0], shotId: "other-scene-shot-1" };
assert.equal(receive([foreign], true).length, 0);
assert.equal(receive([...response, foreign], true).length, 14);
assert.equal(receive([foreign], false).length, 0);

assert.equal(receive(response, false).length, 4, "API responses stay scoped to the requested four shots.");
assert.equal(getStoryboardBoardRequestShots(chunks[1], manual, false).length, 4, "Manual cache must not change API batching.");
assert.equal(receive(response, false, chunks[3]).length, 2);

const repairTargets = [shots[0], shots[6], shots[8]];
assert.equal(getStoryboardBoardRequestShots(repairTargets, [], true).length, 3, "A fresh repair round cannot reuse old candidates as repaired output.");
const repaired = mergeStoryboardBoardBatchValues([], receive(response, true, [shots[0]]));
assert.equal(getStoryboardBoardRequestShots(repairTargets, repaired, true).length, 0);

const contract = validateStoryboardBoardBatch({
  values: partial, shots, projectFormat: "movie", aspectRatio: "16:9", referenceImageCount: 0, allowedAssetIds: [],
});
assert.ok(getActionableStoryboardBoardIssues(contract).some((issue) => issue.code === "BOARD_SHOT_MISSING" && issue.targetShotId === shots[5].id));
const checked = normalizeStoryboardBoardQualityWithEvidence({
  value: {
    score: 82, verdict: "revise", summary: "合成测试中的动作需要修正。", strengths: [],
    issues: [{ severity: "warning", targetShotId: shots[0].id, description: "仍需修正。", suggestion: "按审核意见修订。", evidence: [{ path: "/workflow/board/panels/0/visualBeat", value: manual[0].workflow.board!.panels[0].visualBeat }] }],
  },
  values: manual, shots,
});
assert.equal(checked.verdict, "revise");
assert.equal(checked.score, 82);
assert.equal(checked.issues[0].severity, "warning", "Caching a whole scene must not make QA pass.");

console.log("Manual storyboard batch boundaries passed: whole scene, missing/incomplete items, foreign IDs, API scope, repair rounds, contract and QA.");
