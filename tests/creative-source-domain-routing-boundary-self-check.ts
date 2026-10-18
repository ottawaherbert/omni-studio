import assert from "node:assert/strict";
import { routeCreativeSourceProjection } from "../src/domains/creativeSourceProjection";

const projection = routeCreativeSourceProjection({
  sourceId: "source-1",
  writingUses: ["conflict", "pacing"],
  writingGuidance: ["Use external pursuit to force an internal choice."],
  downstreamGuidance: ["Reserved for downstream visual planning."],
  gameGuidance: ["Turn the pursuit into a timed choice."],
  mustNotCopy: ["source character name", "source dialogue"],
  risk: "medium",
});

assert.equal(projection.sourceId, "source-1");
assert.equal(projection.writing?.allowed, true);
assert.deepEqual(projection.writing?.uses, ["conflict", "pacing"]);
assert.equal(projection.production?.allowed, true);
assert.equal(projection.game?.allowed, true);
assert.equal(projection.blocked.length, 2);
assert.ok(projection.blocked.every((item) => item.blockedFor.includes("writing")));

const highRisk = routeCreativeSourceProjection({
  sourceId: "source-2",
  writingUses: ["structure"],
  writingGuidance: ["Copy the source event order."],
  mustNotCopy: ["source event order"],
  risk: "high",
});

assert.equal(highRisk.writing?.allowed, false);
assert.deepEqual(highRisk.writing?.guidance, []);
assert.ok(highRisk.writing?.mustNotCopy.includes("source event order"));

console.log("Creative source domain routing boundary self-check passed.");
