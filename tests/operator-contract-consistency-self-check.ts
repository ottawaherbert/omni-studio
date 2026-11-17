import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import {
  buildOperatorCapabilityManifest,
  OPERATOR_CORE_DOCUMENTS,
} from "../src/services/operator/capabilities";
import {
  productionAgentModuleManifests,
  productionAgentRegistry,
  validateProductionAgentManifestRegistry,
} from "../src/services/production/agents";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);

const read = (relativePath: string) => fs.readFileSync(path.join(rootDir, relativePath), "utf8");

const extractHandbookVersion = (source: string) => {
  const match = source.match(/handbookVersion：`([^`]+)`/);
  return match?.[1];
};

const capabilityManifest = buildOperatorCapabilityManifest();
const handbookSource = read("doc/design.md");

assert.equal(capabilityManifest.handbookVersion, OPERATOR_HANDBOOK_VERSION);
assert.equal(extractHandbookVersion(handbookSource), OPERATOR_HANDBOOK_VERSION);
assert.deepEqual(capabilityManifest.productionQuality.stages, [
  'project_plan', 'scene_plan', 'shot_plan', 'preparation', 'visuals', 'segments', 'scene_cut', 'episode_cut',
]);
assert.equal(capabilityManifest.productionQuality.basePath, '/api/operator/quality');
assert.ok(capabilityManifest.productionQuality.commands.includes('POST /deliveries'));
assert.match(capabilityManifest.productionQuality.inspection, /Every criterion needs an explicit decision and actual observation/);
assert.match(capabilityManifest.productionQuality.delivery, /without re-encoding/);
assert.match(read('doc/agent-guide.md'), /production-quality-workflow.md/);


for (const relativePath of OPERATOR_CORE_DOCUMENTS) {
  assert.equal(fs.existsSync(path.join(rootDir, relativePath)), true, `${relativePath} must exist`);
}

[
  "productionModeSystem",
  "productionLockSystem",
  "productionPrepSystem",
  "departmentAgentSystem",
  "productionAgentManifestSystem",
  "productionCoordinationSystem",
  "productionCockpitSystem",
  "creativeChangeSystem",
  "videoStoryboardSystem",
].forEach((capabilityKey) => {
  assert.ok(Object.prototype.hasOwnProperty.call(capabilityManifest, capabilityKey), `${capabilityKey} missing from capabilities`);
});

[
  "production_breakdown_report",
  "continuity_matrix",
  "casting_requirement",
  "casting_decision",
  "department_prep_package",
].forEach((artifactKind) => {
  assert.ok(capabilityManifest.productionPrepSystem.artifactKinds.includes(artifactKind), `${artifactKind} missing from productionPrepSystem`);
});
assert.ok(capabilityManifest.productionPrepSystem.requiredBehavior.some((rule: string) => rule.includes("AutoStudio casting bridge")));
assert.ok(capabilityManifest.formalAssetPackageSystem.requiredBehavior.some((rule: string) => rule.includes("Stabilized planned characters")));

assert.equal(capabilityManifest.productionAgentManifestSystem.schemaVersion, "production-agent-manifest-system.v1");
assert.equal(capabilityManifest.productionAgentManifestSystem.manifestSchemaVersion, "production-agent-module-manifest.v1");
assert.equal(capabilityManifest.productionAgentManifestSystem.registrySource, "productionAgentModuleManifests");
assert.equal(capabilityManifest.productionAgentManifestSystem.agentCount, productionAgentRegistry.length);
assert.equal(capabilityManifest.productionAgentManifestSystem.manifestCount, productionAgentModuleManifests.length);
assert.ok(capabilityManifest.productionAgentManifestSystem.manifests.length > 0);
assert.ok(capabilityManifest.productionAgentManifestSystem.manifests.some((manifest: any) =>
  manifest.agentId === "linear.storyboard.board_planner" &&
  manifest.qaAgentIds.includes("qa.linear.storyboard_board"),
));
assert.deepEqual(validateProductionAgentManifestRegistry(), []);
assert.equal(productionAgentModuleManifests.length, productionAgentRegistry.length);
assert.ok(productionAgentModuleManifests.every((manifest) => manifest.capabilities.summary && Array.isArray(manifest.boundaries.allowedTools)));

assert.ok(capabilityManifest.upgradeContract.mustUpdateOperatorModuleWhen.some((rule: string) =>
  rule.includes("production agent manifest"),
));
assert.ok(capabilityManifest.upgradeContract.requiredUpdateTargets.includes("OPERATOR_HANDBOOK_VERSION"));
assert.ok(capabilityManifest.upgradeContract.requiredUpdateTargets.includes("doc/design.md"));
assert.ok(capabilityManifest.upgradeContract.requiredUpdateTargets.includes("production self-check assertions"));

console.log("Operator contract consistency self-check passed.");
