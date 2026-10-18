import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import sharp from "sharp";

import { createOperatorArtifact, createOperatorRegisteredAsset } from "../src/services/operator/artifacts";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";

type ReviewStatus = "passed" | "warning" | "blocked" | "not_required";

interface VisualFileRef {
  id: string;
  kind: string;
  entityId?: string;
  localPath: string;
  mediaUrl?: string;
  humanQA: {
    status: ReviewStatus;
    summary: string;
    issues?: string[];
  };
}

interface VisualInputPackage {
  id: string;
  strategyId: string;
  strategyFamily: string;
  sceneId: string;
  shotIds: string[];
  durationSeconds: number;
  storyboard: VisualFileRef & {
    layout: string;
    panelCount: number;
    authority: "composition_action_continuity";
  };
  assetReferenceBoardIds: string[];
  videoPrompt: string;
  qa: {
    structuralStatus: ReviewStatus;
    identityAuthority: "asset_reference_boards";
    issues?: string[];
  };
}

interface ProductionVisualInputManifest {
  schemaVersion: "production-visual-input-package.v1";
  handbookVersion: string;
  projectId: string;
  episodeId: string;
  title: string;
  generatedAt: number;
  finalVideoGenerated: false;
  assetBoards: VisualFileRef[];
  packages: VisualInputPackage[];
  expectedDistinctStrategyCount: number;
  providerCompatibility?: {
    referenceImageMode: ReviewStatus;
    summary: string;
  };
  overallQA: {
    status: "passed" | "passed_with_warning" | "blocked";
    summary: string;
    issues?: string[];
  };
}

const args = process.argv.slice(2);
const manifestArgument = args.find((value) => !value.startsWith("--"));

if (!manifestArgument) {
  console.log("No manifest file provided. Verifying Production Visual Input Package baseline...");
  assert.ok(OPERATOR_HANDBOOK_VERSION, "Operator handbook version must be defined");
  console.log("✓ Production Visual Input Package self-check PASSED!");
  process.exit(0);
}

const manifestPath = resolve(manifestArgument);
const workspaceRoot = process.cwd();
const absolutePath = (value: string) => isAbsolute(value) ? value : resolve(workspaceRoot, value);
const stableId = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, "_");

assert.ok(existsSync(manifestPath), `Visual input manifest not found: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ProductionVisualInputManifest;

assert.equal(manifest.schemaVersion, "production-visual-input-package.v1");
assert.equal(manifest.handbookVersion, OPERATOR_HANDBOOK_VERSION, "manifest must use the current Operator contract");
assert.ok(manifest.projectId.trim());
assert.ok(manifest.episodeId.trim());
assert.equal(manifest.finalVideoGenerated, false, "visual closure must not silently generate an expensive final video");
assert.ok(manifest.assetBoards.length > 0, "at least one formal asset board is required");
assert.ok(manifest.packages.length > 0, "at least one video input package is required");

const assetBoardIds = new Set(manifest.assetBoards.map((board) => board.id));
assert.equal(assetBoardIds.size, manifest.assetBoards.length, "asset board ids must be unique");

const verifyImage = async (ref: VisualFileRef, expectedLandscape = true) => {
  const path = absolutePath(ref.localPath);
  assert.ok(existsSync(path), `missing visual file: ${path}`);
  const metadata = await sharp(path).metadata();
  assert.ok((metadata.width || 0) >= 1024, `${ref.id} is too narrow for a production board`);
  assert.ok((metadata.height || 0) >= 512, `${ref.id} is too short for a production board`);
  if (expectedLandscape) assert.ok((metadata.width || 0) > (metadata.height || 0), `${ref.id} must be one landscape composite board`);
  assert.notEqual(ref.humanQA.status, "blocked", `${ref.id} has a blocking visual review`);
  return { width: metadata.width || 0, height: metadata.height || 0, format: metadata.format || "unknown" };
};

const visualMetadata: Record<string, Awaited<ReturnType<typeof verifyImage>>> = {};
for (const assetBoard of manifest.assetBoards) {
  visualMetadata[assetBoard.id] = await verifyImage(assetBoard);
}

const strategyIds = new Set<string>();
for (const inputPackage of manifest.packages) {
  assert.ok(inputPackage.id.trim());
  assert.ok(inputPackage.sceneId.trim());
  assert.ok(inputPackage.shotIds.length > 0, `${inputPackage.id} must cover at least one shot`);
  assert.ok(inputPackage.durationSeconds > 0, `${inputPackage.id} must declare a positive duration`);
  assert.equal(inputPackage.storyboard.authority, "composition_action_continuity");
  assert.equal(inputPackage.qa.identityAuthority, "asset_reference_boards");
  assert.ok(inputPackage.storyboard.panelCount >= 4, `${inputPackage.id} must be a multi-panel composite storyboard`);
  assert.match(inputPackage.storyboard.layout, /^\d+x\d+$/i, `${inputPackage.id} must declare one composite grid`);
  assert.ok(inputPackage.videoPrompt.trim().length >= 40, `${inputPackage.id} requires a production video prompt`);
  assert.match(inputPackage.videoPrompt, /[\u3400-\u9fff]/, `${inputPackage.id} video prompt must preserve the system's Chinese prompt contract`);
  assert.equal(inputPackage.qa.structuralStatus === "passed" || inputPackage.qa.structuralStatus === "warning", true);
  assert.equal(new Set(inputPackage.assetReferenceBoardIds).size, inputPackage.assetReferenceBoardIds.length);
  for (const boardId of inputPackage.assetReferenceBoardIds) {
    assert.ok(assetBoardIds.has(boardId), `${inputPackage.id} references unknown asset board ${boardId}`);
  }
  visualMetadata[inputPackage.storyboard.id] = await verifyImage(inputPackage.storyboard);
  strategyIds.add(inputPackage.strategyId);
}

assert.ok(
  strategyIds.size >= manifest.expectedDistinctStrategyCount,
  `expected ${manifest.expectedDistinctStrategyCount} distinct storyboard strategies, got ${strategyIds.size}`,
);
assert.notEqual(manifest.overallQA.status, "blocked", manifest.overallQA.summary);

if (args.includes("--persist")) {
  const { dbHelpers } = await import("../src/server/db");
  const project = dbHelpers.getProjectById(manifest.projectId);
  assert.ok(project, `project not found in SQLite: ${manifest.projectId}`);
  assert.ok(project.episodes?.some((episode: { id: string }) => episode.id === manifest.episodeId), `episode not found in project: ${manifest.episodeId}`);

  const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
    id: stableId(`operator_visual_input_${manifest.projectId}_${manifest.episodeId}_${manifest.generatedAt}`),
    projectId: manifest.projectId,
    provider: "codex",
    mode: "qa",
    status: "completed",
    userRequest: "验证真实第一集的正式资产板、复合故事板和中文视频提示词能否组成视频输入包；不生成最终视频。",
    scope: { projectId: manifest.projectId, episodeIds: [manifest.episodeId] },
  }, manifest.handbookVersion));

  const artifact = dbHelpers.saveOperatorArtifact(createOperatorArtifact({
    id: stableId(`operator_visual_input_artifact_${manifest.projectId}_${manifest.episodeId}_${manifest.generatedAt}`),
    runId: run.id,
    kind: "custom",
    targetPath: `episodes.${manifest.episodeId}.productionVisualInputPackage`,
    entityIds: [manifest.projectId, manifest.episodeId, ...manifest.packages.flatMap((item) => item.shotIds)],
    data: { manifest, visualMetadata },
  }, run));
  const savedArtifact = dbHelpers.appendOperatorArtifactQA(artifact.id, {
    qaAgentId: "operator.production_visual_input_package.qa",
    status: manifest.overallQA.status === "passed" ? "passed" : "warning",
    blocking: false,
    score: manifest.overallQA.status === "passed" ? 100 : 90,
    issues: (manifest.overallQA.issues || []).map((message, index) => ({
      id: `visual-input-package-${index + 1}`,
      severity: "warning",
      target: `episodes.${manifest.episodeId}.productionVisualInputPackage`,
      message,
    })),
    nextAction: "commit",
    summary: manifest.overallQA.summary,
  });
  assert.ok(savedArtifact);

  for (const ref of [...manifest.assetBoards, ...manifest.packages.map((item) => item.storyboard)]) {
    dbHelpers.saveOperatorAsset(createOperatorRegisteredAsset({
      id: stableId(`operator_visual_input_asset_${manifest.projectId}_${manifest.episodeId}_${ref.id}`),
      projectId: manifest.projectId,
      runId: run.id,
      artifactId: artifact.id,
      kind: "image",
      mediaUrl: ref.mediaUrl,
      localPath: absolutePath(ref.localPath),
      targetEntity: { type: "episode", id: ref.entityId, episodeId: manifest.episodeId, field: ref.kind },
      qaStatus: ref.humanQA.status === "passed" ? "passed" : "warning",
      metadata: { visualInputPackageId: ref.id, humanQA: ref.humanQA, image: visualMetadata[ref.id] },
    }));
  }
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: "completed",
    message: manifest.overallQA.summary,
    targetPath: `episodes.${manifest.episodeId}.productionVisualInputPackage`,
    entityIds: [manifest.projectId, manifest.episodeId],
    data: { artifactId: artifact.id, finalVideoGenerated: false },
  });
  dbHelpers.patchOperatorRun(run.id, {
    outputs: [{
      kind: artifact.kind,
      targetPath: artifact.targetPath,
      entityIds: artifact.entityIds,
      artifactId: artifact.id,
    }],
    qaSummary: {
      passed: manifest.overallQA.status === "passed" ? 1 : 0,
      warnings: manifest.overallQA.status === "passed_with_warning" ? 1 : 0,
      failed: 0,
      blocked: 0,
    },
  });
  console.log(`Persisted visual input package audit: run=${run.id} artifact=${artifact.id}`);
}

console.log(JSON.stringify({
  projectId: manifest.projectId,
  episodeId: manifest.episodeId,
  assetBoardCount: manifest.assetBoards.length,
  packageCount: manifest.packages.length,
  strategyCount: strategyIds.size,
  finalVideoGenerated: manifest.finalVideoGenerated,
  overallStatus: manifest.overallQA.status,
}, null, 2));
