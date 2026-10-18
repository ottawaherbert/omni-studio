import assert from "node:assert/strict";

import {
  DEFAULT_MIN_STANDALONE_SHOT_SECONDS,
  evaluateStandaloneShotDuration,
  evaluateVideoUnitDuration,
  rebalanceShotDurations,
} from "../src/services/production/shotDurationPolicy";
import { validateStoryboardRules } from "../src/services/production/ruleQa";

assert.equal(DEFAULT_MIN_STANDALONE_SHOT_SECONDS, 3);
assert.equal(evaluateStandaloneShotDuration({ duration: 1 }).valid, false);
assert.equal(evaluateStandaloneShotDuration({ duration: 2 }).requiresGrouping, true);
assert.equal(evaluateStandaloneShotDuration({ duration: 3 }).valid, true);
assert.equal(evaluateStandaloneShotDuration({
  duration: 1,
  shortDurationOverride: { purpose: "impact_frame", reason: "结尾冲击帧仅承担一次视觉重音。" },
}).valid, true);
assert.equal(evaluateStandaloneShotDuration({
  duration: 1,
  shortDurationOverride: { purpose: "impact_frame", reason: "短" },
}).valid, false);
assert.equal(evaluateVideoUnitDuration(2).valid, false);
assert.equal(evaluateVideoUnitDuration(3).valid, true);
const rebalanced = rebalanceShotDurations([
  { id: "a", duration: 1 },
  { id: "b", duration: 5 },
  { id: "c", duration: 1 },
], 10);
assert.deepEqual(rebalanced.map((shot) => shot.duration), [3, 4, 3]);
assert.equal(rebalanced.reduce((total, shot) => total + Number(shot.duration), 0), 10);
assert.throws(() => rebalanceShotDurations([{ duration: 1 }, { duration: 1 }], 5), /cannot fit/);

const storyboardIssues = validateStoryboardRules([{ id: "episode", scenes: [{
  id: "scene",
  title: "时长测试",
  shots: [{ id: "short-shot", duration: 1, visualAction: "角色推门进入房间。" }],
}] }] as any);
assert.ok(storyboardIssues.some((item) => item.target === "shot.short-shot.duration" && item.severity === "blocking"));

console.log("Shot duration policy self-check passed.");
