import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { productionPreparationHref } from "../src/utils/productionNavigation";
import { retiredWorkspaceHref, RETIRED_WORKSPACE_PATHS } from "../src/utils/retiredWorkspaceRoutes";
import { defaultTemplates } from "../src/config/prompts";

const retiredFiles: string[] = JSON.parse(readFileSync("tests/fixtures/retired-workspace-files.json", "utf8"));
for (const file of retiredFiles) assert.equal(existsSync(file), false, `${file} must stay physically deleted`);
for (const id of ["adaptationExtractAssets", "adaptationBeatSheet", "adaptationExpandScript", "generateFullBoard", "generateReverseEngineering", "insight-simulate"]) {
  assert.equal(defaultTemplates[id], undefined, `${id} must not be registered as a current task`);
}
const aiService = readFileSync("src/services/ai.ts", "utf8");
for (const name of ["generateReverseEngineering", "generateFullBoardFromContext", "suggestClimaxIdeas", "evaluateStoryboard", "solveScriptConstraint", "simulateAudienceResponse", "generateDevilsAdvocate"]) {
  assert.ok(!aiService.includes(`function ${name}(`), `${name} must not leave a callable retired implementation`);
}
// Protect current workspaces when removing similarly named historical panels.
for (const file of [
  "apps/web/src/features/script/ScriptWorkspace.tsx",
  "packages/script/src/schema.ts",
  "src/components/bible/AssetDetailView.tsx",
  "src/components/production/ProductionMagicImportPage.tsx",
  "src/pages/InteractiveGraphWorkspace.tsx",
]) assert.ok(existsSync(file), `${file} remains part of the current product`);

const obsoletePages = ["Bible", "World", "World_new", "CharacterEdit", "AssetEdit", "Episodes", "EpisodeGenerator", "Breakdown", "Whiteboard", "Insight", "AdaptationPage"];
for (const page of obsoletePages) assert.equal(existsSync(`src/pages/${page}.tsx`), false, `${page} must be physically deleted`);
for (const dir of ["src/components/world", "src/components/episodes", "src/components/adaptation", "src/components/structure"]) {
  assert.deepEqual(existsSync(dir) ? readdirSync(dir).filter(file => /\.[jt]sx?$/.test(file)) : [], [], `${dir} must not retain old UI implementations`);
}
assert.equal(existsSync("src/store/useAdaptationStore.ts"), false);
const returnTo = "/interactive/experiences/story/production?nodeId=node-1";
const context = new URLSearchParams({ projectId: "project / 一", episodeId: "episode-2", sceneId: "scene-3", returnTo, videoMode: "shot" });
const expected = new Map([
  ["/production/team", "/production/preparation"], ["/episodes", "/production/preparation"], ["/breakdown", "/production/preparation"],
  ["/world", "/production/assets"], ["/world/character/abc", "/production/assets/character/abc"],
  ["/world/asset/def", "/production/assets/asset/def"], ["/storyboard", "/production/storyboard"],
  ["/studio", "/production/studio"], ["/video-gen", "/production/studio"], ["/audio-gen", "/production/studio"],
]);
for (const [oldPath, newPath] of expected) {
  const url = new URL(retiredWorkspaceHref(oldPath, `?${context}`), "http://localhost");
  assert.equal(url.pathname, newPath);
  for (const [key, value] of context) assert.equal(url.searchParams.get(key), value, `${oldPath}: preserve ${key}`);
}
for (const oldPath of ["/bible", "/script", "/whiteboard", "/insight", "/episodes/generator"]) {
  const url = new URL(retiredWorkspaceHref(oldPath, "?projectId=old-project", "another-project"), "http://localhost");
  assert.equal(url.pathname, "/writing"); assert.equal(url.searchParams.has("projectId"), false, "legacy ID must never masquerade as a Writing ID");
  assert.equal(url.searchParams.get("legacyProjectId"), "old-project");
}
assert.equal(retiredWorkspaceHref("/episodes", "", "remembered-project"), "/production/preparation?projectId=remembered-project");
assert.equal(retiredWorkspaceHref("/adaptation", "?destination=production"), "/production/import");
assert.equal(retiredWorkspaceHref("/studio", ""), "/production/studio");
assert.equal(productionPreparationHref({}), "/production");
const recovery = new URL(productionPreparationHref({ projectId: "p", episodeId: "e", returnTo }), "http://localhost");
assert.equal(recovery.pathname, "/production/preparation"); assert.equal(recovery.searchParams.get("episodeId"), "e"); assert.equal(recovery.searchParams.get("returnTo"), returnTo);
assert.equal(recovery.searchParams.has("sceneId"), false, "recovery must not reselect the missing scene");
assert.equal(productionPreparationHref({ projectId: "p", returnTo: "https://unrelated.example" }), "/production/preparation?projectId=p");
const app = readFileSync("src/App.tsx", "utf8");
for (const page of obsoletePages) assert.ok(!app.includes(`./pages/${page}"`));
assert.ok(app.includes("RETIRED_WORKSPACE_PATHS.map"));
assert.ok(app.includes('path="production/import" element={<ProductionMagicImportPage />}'));
for (const page of ["Studio", "Storyboard"]) {
  const code = readFileSync(`src/pages/${page}.tsx`, "utf8");
  assert.doesNotMatch(code, /(?:navigate\(|to=)[^\n]*(?:['"]\/(?:episodes|bible|world|breakdown)['"])/);
  assert.ok(code.includes("productionPreparationHref")); assert.ok(code.includes("前往剧本与场次"));
}
assert.equal(RETIRED_WORKSPACE_PATHS.length, 16);
console.log("Retired workspace routes: physical deletion, context preservation, Writing ID isolation and empty-state recovery passed.");
