import assert from "node:assert/strict";
import {
  buildProductionCoordinationStageGate,
  buildProductionCoordinationSystem,
  validateProductionCoordinationReport,
} from "../src/services/production/productionCoordination";
import { buildProductionCockpit } from "../src/services/production/productionCockpit";
import type { Episode, Project } from "../src/types/project";

const project = {
  id: "project-coordination-trace",
  title: "Coordination Trace Test",
  type: "ai-video-sample",
  productionMode: "linear",
  logline: "A compact trace regression project.",
  characters: [],
  assets: [],
  creativeVision: {
    coreConflict: "A production team must recover from a coordination blocker.",
    emotionalHook: "The team catches the problem before media generation.",
    visualStyle: "clean test style",
  },
} as unknown as Project;

const episodes = [{
  id: "episode-trace-1",
  title: "Trace Episode",
  scenes: [{
    id: "scene-trace-1",
    title: "Trace Scene",
    scriptBlocks: [],
    shots: [{
      id: "shot-trace-1",
      visualAction: "A coordinator reviews the handoff board.",
      imagePrompt: "test prompt",
      videoPrompt: "test video prompt",
    }],
  }],
}] as unknown as Episode[];

const unsafeVideoUnitArtifact = {
  id: "artifact-video-unit-unsafe",
  runId: "operator-run-coordination-trace",
  projectId: project.id,
  kind: "video_generation_unit",
  targetPath: "episodes.episode-trace-1.scenes.scene-trace-1.videoGenerationUnits.unit-trace-unsafe",
  entityIds: ["episode-trace-1", "scene-trace-1", "unit-trace-unsafe"],
  status: "approved",
  data: {
    videoGenerationUnit: {
      id: "unit-trace-unsafe",
      episodeId: "episode-trace-1",
      sceneId: "scene-trace-1",
      modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
      durationSeconds: 8,
      performanceBeatIds: ["beat-trace-1"],
      storyboardBoardId: "board-trace-1",
      assetReferencePackId: "pack-trace-1",
      shotIds: ["shot-trace-1"],
      startState: "The coordinator opens the handoff board.",
      endState: "The missing authorization is visible.",
      promptTemplateId: "video-unit-test",
      videoPrompt: "A short production trace test shot.",
    },
  },
  qaVerdicts: [],
  provenance: {
    provider: "codex",
    handbookVersion: "test",
    source: "operator",
    generatedAt: 1710000000000,
  },
  createdAt: 1710000000000,
  updatedAt: 1710000000000,
} as any;

const coordinationSystem = buildProductionCoordinationSystem();
assert.equal(coordinationSystem.traceSchemaVersion, "production-coordination-trace.v1");
assert.equal(coordinationSystem.traceFunction, "buildProductionCoordinationTraceIndex");
assert.equal(coordinationSystem.traceQaFunction, "validateProductionCoordinationTraceIndex");
assert.ok(coordinationSystem.requiredBehavior.some((rule) => rule.includes("coordinationTrace")));

const gate = buildProductionCoordinationStageGate({
  project,
  episodes,
  operatorArtifacts: [unsafeVideoUnitArtifact],
  runId: "operator-run-coordination-trace",
  stageId: "stage-coordination-trace",
  stageType: "prompt",
  environment: "test",
  capturedAt: 1710000001000,
});

assert.equal(gate.report.coordinationTrace.schemaVersion, "production-coordination-trace.v1");
assert.equal(gate.coordinationTrace.schemaVersion, "production-coordination-trace.v1");
assert.equal(gate.coordinationTrace.runId, "operator-run-coordination-trace");
assert.equal(gate.coordinationTrace.stageId, "stage-coordination-trace");
assert.equal(gate.coordinationTrace.stageType, "prompt");
assert.equal(gate.coordinationTrace.handoffManifestId, gate.report.handoffManifest.id);
assert.equal(gate.coordinationTrace.links.length, gate.report.departmentFindings.length);
assert.equal(gate.coordinationTrace.recoverySummary.totalFindings, gate.report.departmentFindings.length);
assert.ok(gate.coordinationTrace.recoverySummary.unresolvedFindings >= 1);
assert.ok(gate.coordinationTrace.links.every((link) => link.findingId && link.issueId && Array.isArray(link.evidenceRefs)));
assert.ok(gate.coordinationTrace.links.some((link) =>
  link.repairTicketIds.length > 0 && ["blocked", "human_review_required", "repair_open"].includes(link.recoveryState),
));
assert.equal(validateProductionCoordinationReport(gate.report).some((issue) => issue.severity === "blocking"), false);

const repeatedGate = buildProductionCoordinationStageGate({
  project,
  episodes,
  operatorArtifacts: [unsafeVideoUnitArtifact],
  runId: "operator-run-coordination-trace",
  stageId: "stage-coordination-trace",
  stageType: "prompt",
  environment: "test",
  capturedAt: 1710000002000,
  previousReports: [gate.report],
});

assert.equal(repeatedGate.circuitBreaker.humanInterventionRequired, true);
assert.ok(repeatedGate.humanInterventionTasks.length >= 1);
assert.ok(repeatedGate.coordinationTrace.recoverySummary.human_review_required >= 1);
assert.ok(repeatedGate.coordinationTrace.links.some((link) => link.humanInterventionTaskIds.length > 0));

const cockpit = buildProductionCockpit({
  project,
  episodes,
  operatorArtifacts: [unsafeVideoUnitArtifact],
  operatorRunId: "operator-run-coordination-trace",
  stageType: "prompt",
  environment: "test",
  capturedAt: 1710000003000,
});

assert.equal(cockpit.coordination.trace.schemaVersion, "production-coordination-trace.v1");
assert.equal(cockpit.coordinationTrace.schemaVersion, "production-coordination-trace.v1");
assert.equal(cockpit.counts.coordinationTraceLinks, cockpit.departmentFindings.length);
assert.equal(cockpit.counts.coordinationTraceUnresolved, cockpit.coordinationTrace.recoverySummary.unresolvedFindings);

console.log("Production coordination trace self-check passed.");
