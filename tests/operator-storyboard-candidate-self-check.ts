import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  listOperatorAssetsForAccess,
  reviewOperatorStoryboardAssetForAccess,
  type OperatorAssetStore,
} from "../src/services/operator/assetUseCases";
import type { OperatorArtifactAccess } from "../src/services/operator/artifactUseCases";
import type { OperatorArtifactEnvelope, OperatorRun } from "../src/services/operator/types";
import type { OperatorRegisteredAsset } from "../packages/domain/src/operatorApi";
import type { Project, Shot } from "../src/types/project";
import { buildStoryboardMediaCandidateSourceHash } from "../src/services/production/storyboardMediaCandidateSource";
import type { AssetReferencePack, StoryboardBoard } from "../src/services/production/videoStoryboardArtifacts";

const project = {
  id: "project-storyboard-candidate",
  title: "候选闭环测试",
  characters: [],
  assets: [],
  episodes: [],
} as unknown as Project;
const run: OperatorRun = {
  id: "run-storyboard-candidate",
  projectId: project.id,
  provider: "codex",
  handbookVersion: "test",
  mode: "asset_generation",
  status: "needs_human_review",
  userRequest: "test",
  scope: { projectId: project.id },
  events: [],
  outputs: [],
  qaSummary: { passed: 0, warnings: 0, failed: 0, blocked: 0 },
  startedAt: 1,
  updatedAt: 1,
};
const artifact = (id: string, updatedAt: number, action: string): OperatorArtifactEnvelope => ({
  id,
  runId: run.id,
  projectId: project.id,
  kind: "storyboard_board",
  targetPath: `storyboard.${id}`,
  entityIds: ["board-1", "scene-1"],
  status: "committed",
  data: { storyboardBoard: { id: "board-1", sceneId: "scene-1", action } },
  qaVerdicts: [],
  provenance: { provider: "codex", handbookVersion: "test", source: "operator", generatedAt: updatedAt },
  commitResult: { committedAt: updatedAt, changedPaths: [], summary: "test" },
  createdAt: updatedAt,
  updatedAt,
});
const sourceArtifact = artifact("storyboard-source", 10, "旧动作");
const artifacts: OperatorArtifactEnvelope[] = [sourceArtifact];
const candidate = (id: string, status: string, updatedAt: number): OperatorRegisteredAsset => ({
  id,
  projectId: project.id,
  runId: run.id,
  artifactId: sourceArtifact.id,
  kind: "image",
  mediaUrl: `/media/${id}.png`,
  targetEntity: { type: "scene", id: "scene-1", sceneId: "scene-1", field: "pendingStoryboardBoardImageCandidate" },
  qaStatus: "warning",
  metadata: {
    phase: "storyboards",
    sourceId: "board-1",
    promptHash: "prompt-current",
    candidateId: id,
    adoptionStatus: status,
    technicalQA: "passed",
    visualQA: "manual_review_required",
  },
  createdAt: updatedAt,
  updatedAt,
});
const assets: OperatorRegisteredAsset[] = [
  candidate("candidate-primary", "awaiting_review", 20),
  candidate("candidate-alternate", "awaiting_review", 19),
  candidate("candidate-previous", "adopted", 18),
];
let transactionCalls = 0;
const store: OperatorAssetStore = {
  transaction: (operation) => {
    transactionCalls += 1;
    return operation();
  },
  getProjectById: (id) => id === project.id ? project : null,
  getOperatorRunById: (id) => id === run.id ? run : null,
  getOperatorArtifactById: (id) => artifacts.find((item) => item.id === id) || null,
  listOperatorArtifacts: ({ projectId } = {}) => artifacts
    .filter((item) => !projectId || item.projectId === projectId)
    .sort((left, right) => right.updatedAt - left.updatedAt),
  saveOperatorArtifact: (next) => {
    const index = artifacts.findIndex((item) => item.id === next.id);
    if (index >= 0) artifacts[index] = next;
    else artifacts.push(next);
    return next;
  },
  listOperatorAssets: ({ projectId } = {}) => assets.filter((item) => !projectId || item.projectId === projectId),
  saveOperatorAsset: (next) => {
    const index = assets.findIndex((item) => item.id === next.id);
    if (index >= 0) assets[index] = next;
    else assets.push(next);
    return next;
  },
  appendOperatorRunEvent: (_id, event) => {
    run.events.push({ id: `event-${run.events.length + 1}`, createdAt: Date.now(), ...event });
    return run;
  },
};
const access: OperatorArtifactAccess = {
  assertProjectAccess: (projectId) => assert.equal(projectId, project.id),
  resolveReadableProjectIds: () => [project.id],
};

const currentList = listOperatorAssetsForAccess(store, access, { projectId: project.id });
assert.equal(currentList.find((item) => item.id === "candidate-primary")?.metadata?.sourceReviewRecommended, false);

const missingSourceCandidate = {
  ...candidate("candidate-missing-source", "awaiting_review", 21),
  metadata: {
    ...candidate("candidate-missing-source", "awaiting_review", 21).metadata,
    sourceId: "board-no-longer-present",
  },
};
assets.push(missingSourceCandidate);
assert.equal(
  listOperatorAssetsForAccess(store, access, { projectId: project.id })
    .find((item) => item.id === missingSourceCandidate.id)?.metadata?.sourceReviewRecommended,
  true,
  "a candidate whose current storyboard source disappeared must conservatively recommend review",
);
assets.splice(assets.indexOf(missingSourceCandidate), 1);

const newerSource = artifact("storyboard-source-review", 30, "新动作");
newerSource.status = "draft";
newerSource.commitResult = undefined;
artifacts.push(newerSource);
const staleList = listOperatorAssetsForAccess(store, access, { projectId: project.id });
assert.equal(staleList.find((item) => item.id === "candidate-primary")?.metadata?.sourceReviewRecommended, true);

const adopted = reviewOperatorStoryboardAssetForAccess(store, access, {
  projectId: project.id,
  assetId: "candidate-primary",
  decision: "adopt",
});
assert.equal(adopted.metadata?.adoptionStatus, "adopted");
assert.equal(adopted.metadata?.sourceReviewRecommended, true, "stale source warns but does not block explicit adoption");
assert.equal(assets.find((item) => item.id === "candidate-alternate")?.metadata?.adoptionStatus, "discarded");
assert.equal(assets.find((item) => item.id === "candidate-previous")?.metadata?.adoptionStatus, "superseded");
assert.equal((sourceArtifact.data as { storyboardBoard: { generatedImageUrl?: string } }).storyboardBoard.generatedImageUrl, undefined);
assert.equal(sourceArtifact.status, "committed", "adoption must not rewrite the committed source artifact");
const adoptedRevision = artifacts.find((item) => item.id === "operator_storyboard_media_candidate-primary");
assert.ok(adoptedRevision);
assert.equal(adoptedRevision?.status, "draft", "adoption projects media into a new reviewable revision");
assert.equal((adoptedRevision?.data as any).storyboardBoard.generatedImageUrl, "/media/candidate-primary.png");
assert.equal((adoptedRevision?.data as any).storyboardBoard.visualReview.status, "approved");
assert.equal((adoptedRevision?.data as any).sourceReview.status, "review_recommended");

const discardCandidate = candidate("candidate-discard", "awaiting_review", 40);
assets.push(discardCandidate);
const artifactCountBeforeDiscard = artifacts.length;
const discarded = reviewOperatorStoryboardAssetForAccess(store, access, {
  projectId: project.id,
  assetId: discardCandidate.id,
  decision: "discard",
});
assert.equal(discarded.metadata?.adoptionStatus, "discarded");
assert.equal(artifacts.length, artifactCountBeforeDiscard, "discard must not mutate storyboard artifacts");

project.characters.push({
  id: "character-v2",
  name: "来源角色",
  visualIdentity: "固定短发和红色围巾",
  boardImageUrl: "/media/character-v2-a.png",
});
project.episodes = [{
  id: "episode-v2",
  title: "来源测试集",
  scenes: [{
    id: "scene-v2",
    title: "来源测试场",
    shots: [{
      id: "shot-v2",
      shotSize: "MS",
      cameraAngle: "eye level",
      cameraMovement: "slow push in",
      focalLength: "50mm",
      lighting: "hard side light",
      composition: "centered doorway frame",
      blocking: "lead stops at the threshold",
      continuityNote: "red scarf remains over left shoulder",
      visualAction: "lead reaches for the sealed door",
      lightingAtmo: "cold haze with warm practical spill",
      duration: 4,
      motivation: "reveal hesitation before contact",
      microExpression: "eyes narrow, jaw holds",
      storyboardCapabilityIds: ["performance_progression"],
      imagePrompt: "medium shot at the sealed doorway",
      videoPrompt: "slow push as the hand reaches the seal",
      visualSummary: "hesitation at the blocked threshold",
      characterIdsInShot: ["character-v2"],
      propIds: [],
      dialogueLines: [{ characterId: "character-v2", text: "此地不通。" }],
    }],
  }],
}] as any;
project.visualStyleLock = { stylePrompt: "黑白线稿" };
const sourceBoardV2 = {
  id: "board-v2",
  episodeId: "episode-v2",
  sceneId: "scene-v2",
  strategyDecision: {} as StoryboardBoard["strategyDecision"],
  boardMode: "storyboard" as StoryboardBoard["boardMode"],
  layout: "1x1",
  lineArtPrompt: "line art",
  arrowLegendIds: [],
  performanceBeatIds: [],
  scriptBlockIds: [],
  shotIds: ["shot-v2"],
  panels: [{ panelNumber: 1, shotId: "shot-v2", assetRefs: ["character-v2"] } as StoryboardBoard["panels"][number]],
  startState: "start",
  endState: "end",
} satisfies StoryboardBoard;
const sourcePackV2: AssetReferencePack = {
  id: "pack-v2",
  modelProfileId: "image-model",
  purpose: "storyboard source freshness",
  items: [{
    assetId: "character-v2",
    assetType: "character",
    referenceImageUrl: "/media/character-v2-a.png",
    roleInUnit: "lead",
    required: true,
  }],
  maxReferenceImages: 4,
  maxReferenceVideos: 0,
  packagingNotes: "single identity reference",
};
const storyboardArtifactV2: OperatorArtifactEnvelope = {
  ...artifact("storyboard-source-v2", 50, "来源动作"),
  data: { storyboardBoard: sourceBoardV2 },
  entityIds: [sourceBoardV2.id, sourceBoardV2.sceneId],
};
const packArtifactV2: OperatorArtifactEnvelope = {
  ...artifact("pack-source-v2", 50, "pack"),
  kind: "asset_reference_pack",
  data: { assetReferencePack: sourcePackV2 },
};
const unitArtifactV2: OperatorArtifactEnvelope = {
  ...artifact("unit-source-v2", 50, "unit"),
  kind: "video_generation_unit",
  data: { videoGenerationUnit: { storyboardBoardId: sourceBoardV2.id, assetReferencePackId: sourcePackV2.id } },
};
artifacts.push(storyboardArtifactV2, packArtifactV2, unitArtifactV2);
const sourceHashV2 = buildStoryboardMediaCandidateSourceHash({
  project,
  board: sourceBoardV2,
  referenceItems: sourcePackV2.items,
});
const currentShotV2 = (project.episodes[0] as any).scenes[0].shots[0] as Shot;
for (const [field, changedValue] of [
  ["visualAction", "lead recoils from the sealed door"],
  ["cameraMovement", "locked tripod"],
  ["cameraAngle", "high angle"],
  ["lighting", "soft overhead light"],
  ["composition", "off-center negative space"],
  ["imagePrompt", "wide silhouette at the sealed doorway"],
  ["videoPrompt", "handheld retreat from the seal"],
  ["duration", 7],
] as const) {
  const mutableShot = currentShotV2 as unknown as Record<string, unknown>;
  const originalValue = mutableShot[field];
  mutableShot[field] = changedValue;
  assert.notEqual(
    buildStoryboardMediaCandidateSourceHash({
      project,
      board: sourceBoardV2,
      referenceItems: sourcePackV2.items,
    }),
    sourceHashV2,
    `changing current Project Shot.${field} must change the storyboard candidate source hash`,
  );
  mutableShot[field] = originalValue;
}
const candidateV2: OperatorRegisteredAsset = {
  ...candidate("candidate-v2", "awaiting_review", 51),
  artifactId: storyboardArtifactV2.id,
  metadata: {
    ...candidate("candidate-v2", "awaiting_review", 51).metadata,
    sourceId: sourceBoardV2.id,
    sourceContentHash: sourceHashV2,
  },
};
assets.push(candidateV2);
assert.equal(
  listOperatorAssetsForAccess(store, access, { projectId: project.id })
    .find((item) => item.id === candidateV2.id)?.metadata?.sourceReviewRecommended,
  false,
  "the exact board, reference package and visual style source must initially be current",
);
currentShotV2.visualAction = "lead recoils from the sealed door";
assert.equal(
  listOperatorAssetsForAccess(store, access, { projectId: project.id })
    .find((item) => item.id === candidateV2.id)?.metadata?.sourceReviewRecommended,
  true,
  "freshness must be recomputed from the current Project Shot rather than only the storyboard artifact",
);
currentShotV2.visualAction = "lead reaches for the sealed door";
assert.equal(
  listOperatorAssetsForAccess(store, access, { projectId: project.id })
    .find((item) => item.id === candidateV2.id)?.metadata?.sourceReviewRecommended,
  false,
  "restoring the current Project Shot source must restore an exact candidate match",
);
(packArtifactV2.data as { assetReferencePack: AssetReferencePack }).assetReferencePack = {
  ...sourcePackV2,
  items: [{ ...sourcePackV2.items[0], referenceImageUrl: "/media/character-v2-b.png" }],
};
packArtifactV2.updatedAt = 60;
assert.equal(
  listOperatorAssetsForAccess(store, access, { projectId: project.id })
    .find((item) => item.id === candidateV2.id)?.metadata?.sourceReviewRecommended,
  true,
  "changing the actually selected reference image must recommend review",
);
(packArtifactV2.data as { assetReferencePack: AssetReferencePack }).assetReferencePack = sourcePackV2;
project.visualStyleLock = { stylePrompt: "彩色二维赛璐璐" };
assert.equal(
  listOperatorAssetsForAccess(store, access, { projectId: project.id })
    .find((item) => item.id === candidateV2.id)?.metadata?.sourceReviewRecommended,
  true,
  "changing the current visual standard must recommend review",
);
const adoptedV2 = reviewOperatorStoryboardAssetForAccess(store, access, {
  projectId: project.id,
  assetId: candidateV2.id,
  decision: "adopt",
});
assert.equal(adoptedV2.metadata?.adoptionStatus, "adopted");
assert.equal(adoptedV2.metadata?.sourceReviewRecommended, true, "a stale exact source remains explicitly adoptable");
assert.equal(transactionCalls, 3, "each candidate review must persist its related writes in one transaction");

const routeSource = readFileSync("src/server/operatorAssetRoutes.ts", "utf8");
const pageSource = readFileSync("src/pages/Storyboard.tsx", "utf8");
const reviewSource = readFileSync("src/components/storyboard/StoryboardMediaCandidateReview.tsx", "utf8");
assert.match(routeSource, /reviewOperatorStoryboardAssetForAccess/);
assert.match(pageSource, /<StoryboardMediaCandidateReview/);
assert.match(reviewSource, /reviewStoryboardMediaCandidate/);
assert.match(reviewSource, /adoptionStatus === "adopted"/, "adopted media must remain visibly inspectable after review");

console.log("operator storyboard candidate self-check passed");
