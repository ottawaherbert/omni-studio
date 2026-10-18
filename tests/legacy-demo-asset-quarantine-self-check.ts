import assert from "node:assert/strict";

import {
  isLegacyDemoAssetUrl,
  quarantineLegacyDemoProjectData,
} from "../src/services/legacy/legacyDemoAssets";

const duckUrl = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb";
const panoramaUrl = "https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr";
const realAssetUrl = "https://cdn.example.test/project/real-location.hdr";
const project = {
  id: "legacy-demo-project",
  characters: [{ id: "character-1", name: "角色", model3dUrl: duckUrl }],
  assets: [
    { id: "location-1", name: "广场", type: "location", panoramaUrl, tags: [] },
    { id: "location-2", name: "真实场景", type: "location", panoramaUrl: realAssetUrl },
  ],
};

assert.equal(isLegacyDemoAssetUrl(duckUrl), true);
assert.equal(isLegacyDemoAssetUrl(realAssetUrl), false);
const quarantined = quarantineLegacyDemoProjectData(project);
assert.equal(quarantined.characters[0].model3dUrl, undefined);
assert.equal(quarantined.assets[0].panoramaUrl, undefined);
assert.deepEqual(quarantined.assets[0].tags, ["legacy_demo"]);
assert.equal(quarantined.assets[1].panoramaUrl, realAssetUrl, "real authored assets must remain untouched");
assert.deepEqual(
  quarantined.legacyDemoAssets?.map((record) => record.source),
  ["legacy_demo", "legacy_demo"],
);
assert.equal(
  quarantineLegacyDemoProjectData(quarantined).legacyDemoAssets?.length,
  2,
  "repeated reads must not duplicate quarantine audit records",
);

console.log("Legacy demo asset quarantine self-check passed.");
