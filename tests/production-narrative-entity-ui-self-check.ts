import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const sourceOverview = read("src/components/production/preparation/ProductionSourceOverviewWorkspace.tsx");
const syncButton = read("src/components/production/preparation/ProductionNarrativeEntitySyncButton.tsx");
const mergeDomain = read("src/services/production/narrativeEntityMerge.ts");
const importAdapter = read("src/services/production/writingExportLegacyAdapter.ts");

assert.ok(sourceOverview.includes("ProductionNarrativeEntitySyncButton"));
assert.ok(syncButton.includes("writingClient.exportPackage"));
assert.ok(syncButton.includes("buildProductionNarrativeEntityMergeCandidate"));
assert.ok(syncButton.includes("applyProductionNarrativeEntityMergeCandidate"));
assert.ok(syncButton.includes("这些变化还没有改动制片资产"));
assert.ok(syncButton.includes("参考图、造型、声音、分镜和已生成媒体不会被覆盖"));
assert.ok(syncButton.includes('type="checkbox"'));
assert.ok(syncButton.includes("暂不采用"));
assert.ok(syncButton.includes("采用所选更新"));
assert.ok(syncButton.includes("系统不会猜测"));
assert.equal(syncButton.includes("generateAIContent"), false);
assert.equal(syncButton.includes("PromptEditorModal"), false);
assert.ok(mergeDomain.includes("projectEntityFingerprint"));
assert.ok(mergeDomain.includes("acknowledgedRemovedSourceKeys"));
assert.ok(importAdapter.includes("productionAssetsFromWritingLore"));

console.log("Production NarrativeEntity UI self-check passed.");
