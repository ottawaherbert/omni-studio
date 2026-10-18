import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Project } from "../src/types/project";
import type { OperatorArtifactEnvelope, OperatorQAVerdict } from "../src/services/operator/types";
import { commitOperatorArtifactToProject } from "../src/services/operator/commit";

const rootDir = process.cwd();

const passedVerdict: OperatorQAVerdict = {
  qaAgentId: "qa.commit.boundary",
  status: "passed",
  blocking: false,
  score: 100,
  issues: [],
  nextAction: "commit",
  createdAt: 1,
};

const failedVerdict: OperatorQAVerdict = {
  ...passedVerdict,
  status: "failed",
  blocking: true,
  score: 0,
  nextAction: "retry",
};

const baseProject = (): Project => ({
  id: "commit-boundary-project",
  title: "Commit Boundary",
  type: "short-drama",
  aspectRatio: "16:9",
  logline: "",
  coreConcept: "",
  coreConflict: "",
  currentEpisode: 1,
  totalEpisodes: 1,
  episodes: [{
    id: "ep-1",
    episodeNumber: 1,
    title: "EP1",
    summary: "",
    scenes: [{
      id: "scene-1",
      title: "Scene 1",
      description: "",
      valueCharge: "neutral",
      shots: [{ id: "shot-1", visualAction: "old" }],
    }],
  }],
  characters: [{ id: "char-1", name: "A", internalDesire: "", externalGoal: "", flaw: "" }],
  assets: [],
} as unknown as Project);

const artifact = (input: Partial<OperatorArtifactEnvelope>): OperatorArtifactEnvelope => ({
  id: input.id || "artifact-commit-boundary",
  runId: input.runId || "run-commit-boundary",
  projectId: input.projectId || "commit-boundary-project",
  kind: input.kind || "project_patch",
  targetPath: input.targetPath || "project",
  entityIds: input.entityIds || [],
  status: input.status || "approved",
  data: input.data || {},
  qaVerdicts: input.qaVerdicts || [passedVerdict],
  provenance: {
    provider: "other",
    handbookVersion: "commit-boundary-test",
    source: "operator",
    generatedAt: 1,
  },
  createdAt: 1,
  updatedAt: 1,
});

assert.throws(
  () => commitOperatorArtifactToProject(baseProject(), artifact({ status: "draft", qaVerdicts: [] })),
  /must pass non-blocking QA/,
);

assert.throws(
  () => commitOperatorArtifactToProject(baseProject(), artifact({ status: "qa_failed", qaVerdicts: [failedVerdict] })),
  /must pass non-blocking QA/,
);

assert.throws(
  () => commitOperatorArtifactToProject(baseProject(), artifact({ status: "committed", qaVerdicts: [passedVerdict] })),
  /already committed/,
);

const projectPatch = commitOperatorArtifactToProject(baseProject(), artifact({
  kind: "project_patch",
  data: {
    title: "Committed Title",
    episodes: [{ id: "malicious" }],
    scenes: [{ id: "malicious-scene" }],
    shots: [{ id: "malicious-shot" }],
  },
}));
assert.equal(projectPatch.project.title, "Committed Title");
assert.equal(projectPatch.project.episodes?.[0]?.id, "ep-1");
assert.deepEqual(projectPatch.changedPaths, ["project.title"]);

for (const kind of [
  "storyboard_board",
  "scene_visual_pack",
  "asset_reference_pack",
  "video_generation_unit",
  "production_coordination_report",
  "coordination_repair_ticket",
] as OperatorArtifactEnvelope["kind"][]) {
  assert.throws(
    () => commitOperatorArtifactToProject(baseProject(), artifact({ kind, targetPath: kind })),
    /Unsupported operator artifact kind/,
    `${kind} must remain artifact-only and cannot directly mutate Project state`,
  );
}

const sourceExtensions = new Set([".ts", ".tsx"]);
const walk = (relativeDir: string): string[] => {
  const absoluteDir = path.join(rootDir, relativeDir);
  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) return walk(relativePath);
    return sourceExtensions.has(path.extname(entry)) ? [relativePath] : [];
  });
};

const source = (filePath: string) => readFileSync(path.join(rootDir, filePath), "utf8");

const uiFiles = [...walk("src/pages"), ...walk("src/components"), ...walk("src/hooks")];
const directUiArtifactCommitCalls = uiFiles.filter((filePath) =>
  /\/api\/operator\/artifacts\/[^"']*\/commit/.test(source(filePath)),
);
assert.deepEqual(
  directUiArtifactCommitCalls,
  [],
  "UI must not call artifact commit endpoints directly; use feature clients/hooks before exposing commit actions.",
);

const sourceFiles = [...walk("src/services"), ...walk("src/server")];
const directCommitImports = sourceFiles.filter((filePath) => {
  if ([
    "src/services/operator/artifactUseCases.ts",
    "src/services/operator/styleReferenceUseCases.ts",
    "src/services/operator/commit.ts",
  ].includes(filePath)) return false;
  return /commitOperatorArtifactToProject/.test(source(filePath));
});
assert.deepEqual(
  directCommitImports,
  [],
  "commitOperatorArtifactToProject must stay behind operator use cases.",
);

const productionRunnerSource = source("src/services/production/runners.ts");
assert.equal(productionRunnerSource.includes("useProjectStore"), false);
assert.equal(productionRunnerSource.includes("commitOperatorArtifactToProject"), false);
assert.ok(source("src/services/production/runnerRepositoryAccess.ts").includes("updateProject"));
assert.ok(source("src/services/operator/artifactUseCases.ts").includes("commitOperatorArtifactToProject"));
assert.ok(source("src/services/operator/artifactUseCases.ts").includes("store.saveProject"));
assert.ok(source("src/services/operator/artifactUseCases.ts").includes("store.markOperatorArtifactCommitted"));

console.log("Operator commit boundary self-check passed.");
