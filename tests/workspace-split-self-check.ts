import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const requiredDocs = [
  "apps/README.md",
  "apps/web/README.md",
  "apps/web/index.html",
  "apps/web/src/App.tsx",
  "apps/web/src/main.tsx",
  "apps/web/vite.config.ts",
  "apps/api/README.md",
  "apps/api/src/index.ts",
  "apps/worker/README.md",
  "apps/worker/src/index.ts",
  "apps/worker/src/jobRuntime.ts",
  "packages/production/src/domains/production/index.ts",
  "packages/production/src/services/production/index.ts",
  "packages/production/src/services/production/qaIssue.ts",
  "packages/production/src/services/production/productionMode.ts",
  "packages/production/src/services/production/productionLock.ts",
  "packages/production/src/services/production/productionPrep.ts",
  "packages/production/src/services/production/productionCasting.ts",
  "packages/production/src/services/production/creativeChange.ts",
  "packages/production/src/services/production/productionChangeOrder.ts",
  "packages/production/src/services/production/productionAssetPackage.ts",
  "packages/production/src/services/production/productionContinuity.ts",
  "packages/production/src/services/production/visualStyleLock.ts",
  "packages/production/src/services/production/storyboardStrategyDraft.ts",
  "packages/production/src/services/production/videoStoryboardSystem.ts",
  "packages/production/src/services/production/videoStoryboardArtifacts.ts",
  "packages/production/src/services/production/videoStoryboardAssetBoards.ts",
  "packages/production/src/services/production/videoStoryboardDepartmentRefs.ts",
  "packages/production/src/services/production/videoStoryboardTemplateRenderer.ts",
  "packages/production/src/services/production/videoStoryboardStageBoards.ts",
  "packages/production/src/services/production/videoStoryboardSceneVisualPacks.ts",
  "packages/production/src/services/production/videoStoryboardPromptPacks.ts",
  "packages/production/src/services/production/videoStoryboardPerformanceBeats.ts",
  "packages/production/src/services/production/videoStoryboardVideoUnits.ts",
  "packages/production/src/services/production/repositories.ts",
  "packages/production/src/services/production/promptUtils.ts",
  "packages/production/src/services/production/retryManager.ts",
  "packages/production/src/services/production/runnerArtifacts.ts",
  "packages/production/src/services/production/productionPrepRuntime.ts",
  "packages/production/src/services/production/productionAssetReferenceContext.ts",
  "packages/production/src/services/production/scriptImport.ts",
  "packages/production/src/services/production/scriptPrep.ts",
  "src/domains/production/index.ts",
  "src/services/production/qaIssue.ts",
  "src/services/production/productionMode.ts",
  "src/services/production/productionLock.ts",
  "src/services/production/productionPrep.ts",
  "src/services/production/productionCasting.ts",
  "src/services/production/creativeChange.ts",
  "src/services/production/productionChangeOrder.ts",
  "src/services/production/productionAssetPackage.ts",
  "src/services/production/productionContinuity.ts",
  "src/services/production/visualStyleLock.ts",
  "src/services/production/storyboardStrategyDraft.ts",
  "src/services/production/videoStoryboardSystem.ts",
  "src/services/production/videoStoryboardArtifacts.ts",
  "src/services/production/videoStoryboardAssetBoards.ts",
  "src/services/production/videoStoryboardDepartmentRefs.ts",
  "src/services/production/videoStoryboardTemplateRenderer.ts",
  "src/services/production/videoStoryboardStageBoards.ts",
  "src/services/production/videoStoryboardSceneVisualPacks.ts",
  "src/services/production/videoStoryboardPromptPacks.ts",
  "src/services/production/videoStoryboardPerformanceBeats.ts",
  "src/services/production/videoStoryboardVideoUnits.ts",
  "src/services/production/repositories.ts",
  "src/services/production/promptUtils.ts",
  "src/services/production/retryManager.ts",
  "src/services/production/runnerArtifacts.ts",
  "src/services/production/productionPrepRuntime.ts",
  "src/services/production/productionAssetReferenceContext.ts",
  "src/services/production/scriptImport.ts",
  "src/services/production/scriptPrep.ts",
  "src/workers/jobRuntime.ts",
];

for (const filePath of requiredDocs) {
  assert.ok(existsSync(filePath), `${filePath} should exist`);
}

const webDoc = readFileSync("apps/web/README.md", "utf8");
const webEntry = readFileSync("apps/web/src/main.tsx", "utf8");
const webAppShell = readFileSync("apps/web/src/App.tsx", "utf8");
const webViteConfig = readFileSync("apps/web/vite.config.ts", "utf8");
const sharedStyles = readFileSync("src/index.css", "utf8");
const apiDoc = readFileSync("apps/api/README.md", "utf8");
const apiEntry = readFileSync("apps/api/src/index.ts", "utf8");
const workerDoc = readFileSync("apps/worker/README.md", "utf8");
const workerEntry = readFileSync("apps/worker/src/index.ts", "utf8");
const workerRuntime = readFileSync("apps/worker/src/jobRuntime.ts", "utf8");
const productionDomainIndex = readFileSync("packages/production/src/domains/production/index.ts", "utf8");
const productionServiceIndex = readFileSync("packages/production/src/services/production/index.ts", "utf8");
const productionPackageServices = [
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
const productionScriptImport = readFileSync("packages/production/src/services/production/scriptImport.ts", "utf8");
const productionScriptPrep = readFileSync("packages/production/src/services/production/scriptPrep.ts", "utf8");
const legacyProductionDomain = readFileSync("src/domains/production/index.ts", "utf8");
const legacyProductionCoreSources = productionPackageServices.map((service) => ({
  service,
  source: readFileSync(`src/services/production/${service}.ts`, "utf8"),
}));
const legacyProductionScriptImport = readFileSync("src/services/production/scriptImport.ts", "utf8");
const legacyProductionScriptPrep = readFileSync("src/services/production/scriptPrep.ts", "utf8");
const legacyWorkerRuntime = readFileSync("src/workers/jobRuntime.ts", "utf8");
const packageSource = readFileSync("package.json", "utf8");

assert.ok(webEntry.includes("createRoot"), "web app entry should own React bootstrap");
assert.ok(webEntry.includes("src/index.css"), "web app entry should import shared styles during migration");
assert.ok(webEntry.includes("src/i18n"), "web app entry should import shared i18n during migration");
assert.ok(webAppShell.includes("src/App"), "web app shell should wrap the existing App during migration");
assert.ok(webViteConfig.includes("root: __dirname"), "web Vite config should use apps/web as root");
assert.ok(sharedStyles.includes('@source "./"'), "shared Tailwind styles should scan the legacy product UI outside the apps/web Vite root");
assert.ok(sharedStyles.includes('@source "../apps/web/src"'), "shared Tailwind styles should scan the migrated web UI explicitly");
assert.ok(webViteConfig.includes("VITE_BACKEND_URL"), "web Vite config should proxy API calls to backend");
assert.ok(apiEntry.includes("OMNI_API_ONLY"), "api app entry should force API-only mode");
assert.ok(apiEntry.includes("startServer"), "api app entry should explicitly start the backend");
assert.ok(apiEntry.includes("../../../server"), "api app entry should boot the existing server during migration");
assert.ok(workerEntry.includes("runProductionWorkerJob"), "worker app should export production job runtime");
assert.ok(legacyWorkerRuntime.includes("apps/worker/src/jobRuntime"), "legacy worker runtime path should re-export the worker app runtime");
assert.ok(productionDomainIndex.includes("./importedScript"), "real Production imported-script domain should live under packages/production");
assert.ok(productionServiceIndex.includes("./scriptImport"), "real Production import services should live under packages/production");
for (const service of productionPackageServices) {
  assert.ok(productionServiceIndex.includes(`./${service}`), `Production service index should export ${service}`);
  assert.ok(
    readFileSync(`packages/production/src/services/production/${service}.ts`, "utf8").includes("src/services/production") === false,
    `real Production ${service} should not import legacy Production services`,
  );
}
assert.ok(productionScriptPrep.includes("ProductionScriptPrepPackage"), "Production prep should live under packages/production");
assert.ok(legacyProductionDomain.includes("packages/production/src/domains/production/index"), "legacy Production domain path should re-export the package domain");
for (const { service, source } of legacyProductionCoreSources) {
  assert.ok(
    source.includes(`packages/production/src/services/production/${service}`),
    `legacy Production ${service} path should re-export the package service`,
  );
}
assert.ok(legacyProductionScriptImport.includes("packages/production/src/services/production/scriptImport"), "legacy Production script import path should re-export the package service");
assert.ok(legacyProductionScriptPrep.includes("packages/production/src/services/production/scriptPrep"), "legacy Production script prep path should re-export the package service");
assert.ok(packageSource.includes("vite --config apps/web/vite.config.ts"), "frontend dev script should use apps/web");
assert.ok(packageSource.includes("tsx apps/api/src/index.ts"), "backend dev script should use apps/api");

for (const file of ["apps/web/src/features/script/ScriptWorkspace.tsx", "apps/web/src/clients/scriptClient.ts", "apps/api/src/routes/scriptRoutes.ts", "apps/api/src/repositories/scriptStore.ts", "packages/script/src/schema.ts"]) assert.ok(existsSync(file), `${file} must implement the new screenplay module`);
assert.ok(productionScriptImport.includes("domain/src/scriptDelivery"), "Production consumes a data-only delivery contract");
console.log("Workspace boundaries passed: new screenplay module and shared production package.");
