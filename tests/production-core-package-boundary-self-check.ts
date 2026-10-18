import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCastingDecisionSystem,
  buildCreativeChangeSystem,
  buildFormalAssetPackageSystem,
  buildProductionContinuitySystem,
  buildProductionChangeOrderSystem,
  buildProductionLockStrategyDecision,
  buildProductionLockSystem,
  buildProductionModeSystem,
  buildProductionPrepSystem,
  buildSceneVisualPackSystem,
  buildStoryboardStrategyDraftSystem,
  buildVideoStoryboardArtifactSystem,
  buildVideoStoryboardSystem,
  normalizeProductionQAIssue,
  resolveVisualStyleLock,
  validateDevelopmentAssetBrief,
} from "../packages/production/src/services/production";

const productionCoreServices = [
  "qaIssue",
  "productionMode",
  "productionLock",
  "productionPrep",
  "productionCasting",
  "creativeChange",
  "productionChangeOrder",
  "productionAssetPackage",
  "productionContinuity",
  "visualStyleLock",
  "visualMediumProfiles",
  "visualStyleMigration",
  "visualStyleProjection",
  "visualTaskRecipes",
  "storyboardStrategyDraft",
  "videoStoryboardSystem",
  "videoStoryboardArtifacts",
  "videoStoryboardAssetBoards",
  "videoStoryboardDepartmentRefs",
  "videoStoryboardTemplateRenderer",
  "videoStoryboardStageBoards",
  "videoStoryboardSceneVisualPacks",
  "videoStoryboardPromptPacks",
  "videoStoryboardPerformanceBeats",
  "videoStoryboardVideoUnits",
  "repositories",
  "promptUtils",
  "retryManager",
  "runnerArtifacts",
  "productionPrepRuntime",
  "productionAssetReferenceContext",
];

const source = (filePath: string) => readFileSync(filePath, "utf8");
const packageIndex = source("packages/production/src/services/production/index.ts");

for (const service of productionCoreServices) {
  const packageSource = source(`packages/production/src/services/production/${service}.ts`);
  const legacySource = source(`src/services/production/${service}.ts`);
  assert.ok(packageIndex.includes(`./${service}`), `Production package index must export ${service}`);
  assert.ok(
    legacySource.includes(`packages/production/src/services/production/${service}`),
    `legacy src/services/production/${service}.ts must only re-export the package service`,
  );
  assert.equal(packageSource.includes("from \"react\""), false, `${service} must not import React`);
  assert.equal(packageSource.includes("store/use"), false, `${service} must not import browser stores`);
  assert.equal(packageSource.includes("src/services/production"), false, `${service} must not import legacy Production services`);
}

const qaIssue = normalizeProductionQAIssue({
  id: "core-boundary-issue",
  severity: "blocking",
  target: "core.boundary",
  message: "Core package self-check issue",
  issueType: "contract_violation",
});
assert.equal(qaIssue.severityPolicyId, "qa-severity-policy.v1");
assert.equal(qaIssue.retryable, false);
assert.ok(qaIssue.fingerprint?.startsWith("qa."));

const modeSystem = buildProductionModeSystem();
assert.equal(modeSystem.schemaVersion, "production-mode-system.v1");
assert.ok(modeSystem.projectFields.includes("productionMode"));

const decision = buildProductionLockStrategyDecision({
  id: "production-core-package-project",
  title: "Production Core Package Project",
  projectModel: "linear",
  type: "short-drama",
  productionMode: "short-drama",
  lockStrategy: "episode_block",
  targetScale: { label: "short-drama", episodeCount: 24, productionBlockSize: 6 },
} as any);
assert.equal(decision.schemaVersion, "production-lock-strategy-decision.v1");
assert.equal(decision.selectedReadinessScope, "current_block_only");

const lockSystem = buildProductionLockSystem();
assert.equal(lockSystem.schemaVersion, "production-lock-system.v1");
assert.ok(lockSystem.artifactKinds.includes("production_block_lock"));
assert.ok(validateDevelopmentAssetBrief(undefined).some((issue) => issue.severity === "blocking"));

const prepSystem = buildProductionPrepSystem();
assert.equal(prepSystem.schemaVersion, "production-prep-system.v1");
assert.ok(prepSystem.artifactKinds.includes("production_breakdown_report"));

const castingSystem = buildCastingDecisionSystem();
assert.equal(castingSystem.schemaVersion, "casting-decision-system.v1");
assert.ok(castingSystem.artifactKinds.includes("casting_decision"));

const creativeChangeSystem = buildCreativeChangeSystem();
assert.equal(creativeChangeSystem.status, "creative_change_flow_contract_available_operator_artifact_only");
assert.equal(creativeChangeSystem.primaryArtifactKind, "creative_change_request");
assert.ok(creativeChangeSystem.artifactKinds.includes("creative_change_request"));

const changeOrderSystem = buildProductionChangeOrderSystem();
assert.equal(changeOrderSystem.schemaVersion, "production-change-order-system.v1");
assert.ok(changeOrderSystem.artifactKinds.includes("series_change_order"));

const formalAssetPackageSystem = buildFormalAssetPackageSystem();
assert.equal(formalAssetPackageSystem.schemaVersion, "formal-asset-package-system.v1");
assert.ok(formalAssetPackageSystem.artifactKinds.includes("formal_asset_package"));

const continuitySystem = buildProductionContinuitySystem();
assert.equal(continuitySystem.schemaVersion, "production-continuity-system.v1");
assert.ok(continuitySystem.artifactKinds.includes("continuity_matrix"));

const videoStoryboardSystem = buildVideoStoryboardSystem();
assert.equal(videoStoryboardSystem.status, "configuration_and_strategy_registry_available");
assert.ok(videoStoryboardSystem.promptStrategies.length > 0);

const artifactSystem = buildVideoStoryboardArtifactSystem();
assert.equal(artifactSystem.status, "artifact_contracts_available_operator_artifact_only");
assert.ok(artifactSystem.artifactKinds.includes("storyboard_board"));

const strategyDraftSystem = buildStoryboardStrategyDraftSystem();
assert.equal(strategyDraftSystem.schemaVersion, "storyboard-strategy-draft-system.v1");
assert.equal(strategyDraftSystem.artifactKind, "storyboard_strategy_draft");

const sceneVisualPackSystem = buildSceneVisualPackSystem();
assert.equal(sceneVisualPackSystem.status, "scene_visual_pack_contract_available_operator_artifact_only");
assert.equal(sceneVisualPackSystem.artifactKind, "scene_visual_pack");

const styleLock = resolveVisualStyleLock({
  id: "style-lock-project",
  title: "Style Lock Project",
  projectModel: "linear",
  type: "movie",
  visualStyleLock: {
    stylePrompt: "冷峻现实主义，低饱和，手持压迫感",
  },
  universalSkillRefs: [],
} as any);
assert.ok(styleLock.summary.includes("冷峻现实主义"));

const upstreamOnlyStyle = resolveVisualStyleLock({
  id: "structured-style-lock-project",
  title: "Structured Style Lock Project",
  projectModel: "linear",
  type: "short-drama",
  creativeVision: {
    genre: [],
    visualStyle: {
      primary: "院线级略二次元 3D 动画",
      locationIdentity: "当代中国普通城市社区",
      exclusions: ["不要写实真人", "不要科幻城市"],
    },
    narrativeStyle: "家庭动物喜剧",
    referenceWorks: "只参考抽象节奏",
  },
  universalSkillRefs: [],
} as any);
assert.deepEqual(upstreamOnlyStyle.sourceFields, []);
assert.ok(upstreamOnlyStyle.summary.includes("未设置显式项目视觉规范"));
assert.ok(!upstreamOnlyStyle.summary.includes("院线级略二次元 3D 动画"));
assert.ok(!upstreamOnlyStyle.summary.includes("当代中国普通城市社区"));
assert.ok(!upstreamOnlyStyle.summary.includes("[object Object]"));

console.log("Production package boundary self-check passed.");
