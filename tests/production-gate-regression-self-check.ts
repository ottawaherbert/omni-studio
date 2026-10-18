import assert from "node:assert/strict";
import { createGateVerdictsForStage } from "../src/services/production/gates";
import { createProductionRun } from "../src/services/production/orchestrator";
import {
  interactiveStageDefinitions,
  linearStageDefinitions,
} from "../src/services/production/stages";
import type { ProductionStageExecutionResult } from "../src/types/production";

const gateArtifact = (
  artifactType: ProductionStageExecutionResult["artifacts"][number]["artifactType"],
) => ({
  artifactType,
  targetPath: `run.outputSnapshot.${artifactType}`,
  entityIds: [`${artifactType}-gate-self-check`],
  version: 1,
  summary: `${artifactType} gate self-check`,
});

const run = createProductionRun({
  id: "production-gate-regression-project",
  title: "Production Gate Regression Project",
  projectModel: "linear",
  type: "movie",
  originalInspiration: "Gate regression self-check.",
  universalSkillRefs: [],
});

const scriptLockStage = run.stages.find((stage) => stage.stageType === "script_lock");
assert.ok(scriptLockStage);

const passingScriptLockGate = createGateVerdictsForStage(run, scriptLockStage, {
  result: {
    summary: "script lock gate self-check",
    artifacts: [gateArtifact("script_lock_package"), gateArtifact("production_block_lock")],
    qaReports: [],
  },
  qaReports: [],
}).find((verdict) => verdict.gateId === "SCRIPT");
assert.equal(passingScriptLockGate?.blocking, false, JSON.stringify(passingScriptLockGate?.issues, null, 2));

const missingScriptLockGate = createGateVerdictsForStage(run, scriptLockStage, {
  result: {
    summary: "missing script lock package gate self-check",
    artifacts: [gateArtifact("production_block_lock")],
    qaReports: [],
  },
  qaReports: [],
}).find((verdict) => verdict.gateId === "SCRIPT");
assert.equal(missingScriptLockGate?.blocking, true);
assert.ok(missingScriptLockGate?.issues.some((issue) => issue.target === "artifacts.script_lock_package"));

assert.ok(linearStageDefinitions
  .find((stage) => stage.stageType === "production_breakdown")
  ?.artifactTypes.includes("casting_decision"));
assert.ok(interactiveStageDefinitions
  .find((stage) => stage.stageType === "production_breakdown")
  ?.artifactTypes.includes("casting_decision"));

console.log("Production gate regression self-check passed.");
