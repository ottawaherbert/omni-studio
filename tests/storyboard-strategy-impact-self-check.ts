import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildStoryboardStrategyImpactPlan,
  validateStoryboardStrategyImpactPlan,
} from "../src/services/production/storyboardStrategyImpact";

const projectId = "project-strategy-impact";
const now = 1784332800000;

const artifact = (
  id: string,
  kind: string,
  data: unknown,
  status = "approved",
  updatedAt = now,
) => ({ id, kind, data, status, updatedAt });

const board = (id: string, episodeId: string, sceneId: string, shotId: string, packId: string, unitId: string, strategyDraftId?: string) => ({
  id,
  episodeId,
  sceneId,
  shotIds: [shotId],
  assetReferencePackId: packId,
  videoGenerationUnitId: unitId,
  strategyDraftId,
  strategyDecision: {
    selectedStrategyId: strategyDraftId || "storyboard.multi_shot_narrative.v1",
  },
});

const pack = (id: string, episodeId: string, sceneId: string, strategyIds: string[] = []) => ({
  id,
  episodeId,
  sceneId,
  modelProfileId: "video.test.v1",
  items: [],
  storyboardStrategyIds: strategyIds,
});

const unit = (id: string, episodeId: string, sceneId: string, boardId: string, packId: string, strategyId = "storyboard.multi_shot_narrative.v1") => ({
  id,
  episodeId,
  sceneId,
  storyboardBoardId: boardId,
  assetReferencePackId: packId,
  storyboardStrategyId: strategyId,
});

const boards = [
  board("board-1", "ep-1", "scene-1", "shot-1", "pack-1", "unit-1"),
  board("board-2", "ep-1", "scene-2", "shot-2", "pack-2", "unit-2"),
];
const packs = [
  pack("pack-1", "ep-1", "scene-1"),
  pack("pack-2", "ep-1", "scene-2"),
];
const units = [
  unit("unit-1", "ep-1", "scene-1", "board-1", "pack-1"),
  unit("unit-2", "ep-1", "scene-2", "board-2", "pack-2"),
];
const chainArtifacts = [
  artifact("artifact-boards", "storyboard_board", { storyboardBoards: boards }),
  artifact("artifact-packs", "asset_reference_pack", { assetReferencePacks: packs }),
  artifact("artifact-units", "video_generation_unit", { videoGenerationUnits: units }),
];

const noChange = buildStoryboardStrategyImpactPlan({ projectId, artifacts: chainArtifacts });
assert.equal(noChange.status, "no_change");
assert.equal(noChange.rerunPlan.requiredStageReruns.length, 0);
assert.equal(noChange.rerunPlan.automaticRetryBudget, 0);

const draft = {
  schemaVersion: "storyboard-strategy-draft.v1",
  id: "strategy.scene-1.custom.v1",
  projectId,
  scope: "scene_range_local",
  status: "approved",
  name: "第一场空间压迫复合板",
  sampleSceneIds: ["scene-1"],
  createdAt: now,
};
const draftArtifact = artifact("artifact-draft", "storyboard_strategy_draft", { storyboardStrategyDraft: draft });
const blockedWithoutTrial = buildStoryboardStrategyImpactPlan({
  projectId,
  artifacts: [...chainArtifacts, draftArtifact],
});
assert.equal(blockedWithoutTrial.status, "blocked");
assert.ok(blockedWithoutTrial.blockers.some((message) => message.includes("passed trial")));
assert.equal(blockedWithoutTrial.rerunPlan.automaticRetryBudget, 0);

const trialArtifact = artifact("artifact-trial", "storyboard_strategy_draft_trial", {
  storyboardStrategyDraftTrial: {
    schemaVersion: "storyboard-strategy-draft-trial.v1",
    id: "trial-1",
    draftId: draft.id,
    status: "passed",
    sampleSceneIds: ["scene-1"],
  },
});
const planned = buildStoryboardStrategyImpactPlan({
  projectId,
  artifacts: [...chainArtifacts, draftArtifact, trialArtifact],
  scope: { episodeIds: ["ep-1"] },
});
assert.equal(planned.status, "planned");
assert.deepEqual(planned.rerunPlan.affectedBoardIds, ["board-1"]);
assert.deepEqual(planned.rerunPlan.affectedAssetReferencePackIds, ["pack-1"]);
assert.deepEqual(planned.rerunPlan.affectedVideoGenerationUnitIds, ["unit-1"]);
assert.deepEqual(planned.rerunPlan.preservedBoardIds, ["board-2"]);
assert.deepEqual(planned.rerunPlan.preservedAssetReferencePackIds, ["pack-2"]);
assert.deepEqual(planned.rerunPlan.preservedVideoGenerationUnitIds, ["unit-2"]);
assert.deepEqual(planned.rerunPlan.requiredStageReruns, ["storyboard", "prompt", "expensive_generation_planning"]);
assert.ok(planned.rerunPlan.preservedArtifactKinds.includes("script_lock_package"));
assert.ok(planned.rerunPlan.preservedArtifactKinds.includes("formal_asset_package"));
assert.equal(planned.rerunPlan.requiresHumanApproval, true);
assert.equal(planned.rerunPlan.automaticRetryBudget, 0);
assert.deepEqual(validateStoryboardStrategyImpactPlan(planned), []);

const downstreamOnly = buildStoryboardStrategyImpactPlan({
  projectId,
  artifacts: [
    artifact("artifact-boards-current", "storyboard_board", {
      storyboardBoards: [board("board-1", "ep-1", "scene-1", "shot-1", "pack-1", "unit-1", draft.id)],
    }),
    artifact("artifact-packs-old", "asset_reference_pack", { assetReferencePacks: [pack("pack-1", "ep-1", "scene-1")] }),
    artifact("artifact-units-old", "video_generation_unit", { videoGenerationUnits: [unit("unit-1", "ep-1", "scene-1", "board-1", "pack-1")] }),
    draftArtifact,
    trialArtifact,
  ],
});
assert.equal(downstreamOnly.status, "planned");
assert.deepEqual(downstreamOnly.rerunPlan.affectedBoardIds, []);
assert.deepEqual(downstreamOnly.rerunPlan.affectedAssetReferencePackIds, ["pack-1"]);
assert.deepEqual(downstreamOnly.rerunPlan.affectedVideoGenerationUnitIds, ["unit-1"]);
assert.deepEqual(downstreamOnly.rerunPlan.requiredStageReruns, ["prompt", "expensive_generation_planning"]);
assert.deepEqual(validateStoryboardStrategyImpactPlan(downstreamOnly), []);

const fullyApplied = buildStoryboardStrategyImpactPlan({
  projectId,
  artifacts: [
    artifact("artifact-boards-current", "storyboard_board", {
      storyboardBoards: [board("board-1", "ep-1", "scene-1", "shot-1", "pack-1", "unit-1", draft.id)],
    }),
    artifact("artifact-packs-current", "asset_reference_pack", { assetReferencePacks: [pack("pack-1", "ep-1", "scene-1", [draft.id])] }),
    artifact("artifact-units-current", "video_generation_unit", { videoGenerationUnits: [unit("unit-1", "ep-1", "scene-1", "board-1", "pack-1", draft.id)] }),
    draftArtifact,
    trialArtifact,
  ],
});
assert.equal(fullyApplied.status, "no_change");
assert.equal(fullyApplied.rerunPlan.requiredStageReruns.length, 0);

const globalCandidate = buildStoryboardStrategyImpactPlan({
  projectId,
  artifacts: [
    ...chainArtifacts,
    artifact("artifact-global", "storyboard_strategy_draft", {
      storyboardStrategyDraft: { ...draft, id: "global-candidate-1", scope: "global_candidate" },
    }),
  ],
});
assert.equal(globalCandidate.status, "no_change", "global candidate must never mutate a project or trigger reruns");

const ambiguousScope = buildStoryboardStrategyImpactPlan({
  projectId,
  artifacts: [
    ...chainArtifacts,
    artifact("artifact-ambiguous", "storyboard_strategy_draft", {
      storyboardStrategyDraft: { ...draft, id: "strategy-ambiguous", sampleSceneIds: [] },
    }, "approved", now + 2),
    artifact("artifact-ambiguous-trial", "storyboard_strategy_draft_trial", {
      storyboardStrategyDraftTrial: {
        schemaVersion: "storyboard-strategy-draft-trial.v1",
        id: "trial-ambiguous",
        draftId: "strategy-ambiguous",
        status: "passed",
        sampleSceneIds: [],
      },
    }, "approved", now + 2),
  ],
});
assert.equal(ambiguousScope.status, "blocked");
assert.ok(ambiguousScope.blockers.some((message) => message.includes("禁止退化为全项目重跑")));

console.log("Storyboard strategy impact self-check passed.");
