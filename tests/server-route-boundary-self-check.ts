import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const serverSource = read("server.ts");
const serverEntrySource = read("server-entry.ts");
const packageSource = read("package.json");
const listenSource = read("src/server/listenWithPortFallback.ts");
const staticPolicySource = read("src/server/productionStaticPolicy.ts");
const aiConfigRoutesSource = read("src/server/routes/aiConfigRoutes.ts");
const assetRoutesSource = read("src/server/routes/assetRoutes.ts");
const videoAudioRoutesSource = read("src/server/routes/videoAudioRoutes.ts");
const legacyRoutesSource = read("src/server/routes/legacyProjectRoutes.ts");
const productionAssetBoardCandidateRoutesSource = read("src/server/routes/productionAssetBoardCandidateRoutes.ts");
const productionScriptWritebackSource = read("src/server/productionScriptWriteback.ts");
const legacyWritingMigrationRoutesSource = read("src/server/routes/legacyWritingMigrationRoutes.ts");
const dbSource = read("src/server/db.ts");
const providerProxyRoutesSource = read("src/server/routes/providerProxyRoutes.ts");
const openAICompatibleProxyRouteSource = read("src/server/routes/openAICompatibleProxyRoute.ts");
const providerProxyUtilsSource = read("src/server/routes/providerProxyUtils.ts");
const kieGrokVideoSource = read("src/server/providers/kieGrokVideo.ts");
const comfyUIH3VideoSource = read("src/server/providers/comfyUIH3Video.ts");
const promptRoutesSource = read("src/server/routes/promptRoutes.ts");
const runtimeRoutesSource = read("src/server/routes/runtimeRoutes.ts");
const skillRoutesSource = read("src/server/routes/skillRoutes.ts");
const systemRoutesSource = read("src/server/routes/systemRoutes.ts");
const videoAnalysisRoutesSource = read("src/server/routes/videoAnalysisRoutes.ts");
const writingRoutesSource = read("apps/api/src/routes/writing/writingRoutes.ts");
const writingRouteInputsSource = read("apps/api/src/routes/writing/writingRouteInputs.ts");

assert.ok(serverSource.includes("registerAiConfigRoutes(app"), "server.ts should register AI config routes through a route module");
assert.ok(serverSource.includes("registerAssetRoutes(app"), "server.ts should register asset routes through a route module");
assert.ok(serverSource.includes("registerLegacyProjectRoutes(app)"), "server.ts should register legacy project routes through a route module");
assert.ok(serverSource.includes("registerLegacyWritingMigrationRoutes(app"), "server.ts should register the legacy-to-Writing migration through a route module");
assert.ok(serverSource.includes("registerProviderProxyRoutes(app"), "server.ts should register provider proxy routes through a route module");
assert.ok(serverSource.includes("registerPromptRoutes(app"), "server.ts should register prompt routes through a route module");
assert.ok(serverSource.includes("registerRuntimeRoutes(app"), "server.ts should register runtime routes through a route module");
assert.ok(serverSource.includes("registerSkillRoutes(app"), "server.ts should register skill routes through a route module");
assert.ok(serverSource.includes("registerSystemRoutes(app"), "server.ts should register system routes through a route module");
assert.ok(serverSource.includes("registerVideoAnalysisRoutes(app)"), "server.ts should register video analysis routes through a route module");
assert.ok(serverSource.includes("registerWritingRoutes(app"), "server.ts should register writing routes through a route module");
assert.ok(packageSource.includes('node --import tsx server-entry.ts'), "production start should use the environment bootstrap entry");
const dotenvConfigIndex = serverEntrySource.indexOf("dotenv.config()");
const serverImportIndex = serverEntrySource.indexOf('await import("./server")');
assert.ok(dotenvConfigIndex >= 0, "the production entry must load dotenv");
assert.ok(serverImportIndex >= 0, "the production entry must dynamically import the server");
assert.ok(
  dotenvConfigIndex < serverImportIndex,
  "the production entry must load .env before importing database-backed server modules",
);
assert.ok(serverSource.includes('express.static(path.join(__dirname, "dist"), { redirect: false })'), "the /assets application route must not be redirected as a static directory");
assert.ok(serverSource.includes("shouldServeSpaDocument(req.path)"), "production fallback should apply the tested static-path policy");
assert.ok(staticPolicySource.includes("path.posix.extname"), "missing fingerprinted static assets must be distinguished from SPA routes");
assert.ok(serverSource.includes("await listenWithPortFallback"), "server startup must await bind success or failure");
assert.equal(serverSource.includes("isDirectEntry"), false, "server.ts must remain an import-only module so startup cannot bypass environment bootstrap");
assert.ok(listenSource.includes("reject(err)"), "bind failures must reject startup instead of exiting successfully");
assert.ok(listenSource.includes('server.off("error", handleStartupError)'), "successful startup must remove its one-shot error listener");
assert.ok(listenSource.includes('process.env.NODE_ENV !== "production"'), "production startup must not silently move to another port");

[
  'app.get("/api/projects"',
  'app.post("/api/projects"',
  'app.put("/api/projects/:id"',
  'app.patch("/api/projects/:id"',
  'app.delete("/api/projects/:id"',
  'app.get("/api/production-runs"',
  'app.put("/api/production-runs/:runId"',
].forEach((snippet) => {
  assert.equal(serverSource.includes(snippet), false, `server.ts should not define route inline: ${snippet}`);
  assert.ok(legacyRoutesSource.includes(snippet), `legacyProjectRoutes should own route: ${snippet}`);
});
assert.ok(
  legacyRoutesSource.includes('req.query.view === "full"')
    && legacyRoutesSource.includes(': dbHelpers.getProjectSummaries()'),
  "project list reads must default to lightweight summaries and require an explicit full compatibility view",
);
assert.ok(legacyRoutesSource.includes('req.query.view === "shell"'), "project detail reads should support a lightweight shell");
assert.ok(legacyRoutesSource.includes('app.get("/api/projects/:id/script-units/:sourceDocumentId"'), "the selected formal screenplay unit must have a dedicated on-demand route");
assert.ok(dbSource.includes("getProductionScriptUnitBySourceDocumentId"), "the repository must hydrate one formal screenplay unit without rebuilding the full project payload");
assert.ok(legacyRoutesSource.includes('app.get("/api/projects/:id/script-workspace"'), "formal screenplay mutations must load the screenplay aggregate without rebuilding all production media");
assert.ok(legacyRoutesSource.includes('app.patch("/api/projects/:id/script-writeback"'), "linked screenplay edits must have one atomic Writing and Production route");
assert.ok(productionScriptWritebackSource.includes("db.transaction"), "Writing and Production writeback must share one SQLite transaction");
assert.ok(
  productionAssetBoardCandidateRoutesSource.includes("dbHelpers.transaction"),
  "Production asset-board candidate adoption must update canonical project and Operator review state atomically",
);
assert.ok(productionScriptWritebackSource.includes("writingRepository.saveProject"), "the atomic writeback must persist the Writing aggregate");
assert.ok(productionScriptWritebackSource.includes("dbHelpers.updateProjectMeta"), "the atomic writeback must persist the Production screenplay revision");
assert.ok(dbSource.includes("getProductionScriptWorkspace"), "the repository must expose the screenplay aggregate independently from the deep compatibility project");
assert.ok(dbSource.includes("productionScriptWorkspaceShell"), "project shells must defer formal screenplay bodies outside the selected unit");
assert.ok(legacyRoutesSource.includes("dbHelpers.getEpisodeById"), "episode reads should not rebuild every episode in the project");
assert.ok(legacyRoutesSource.includes("req.query.view"), "episode reads should pass workspace view selection to the repository");
assert.ok(dbSource.includes("workspaceEpisode"), "production workspaces should omit unrelated heavy audit bodies");
assert.ok(
  dbSource.includes("adoptedSceneSnapshotForEpisode"),
  "production workspaces should recover adopted scene snapshots when legacy episode rows are empty",
);
assert.ok(dbSource.includes("mergeWorkspaceScene"), "workspace saves should restore scene audit data omitted from the read model");
assert.ok(dbSource.includes("mergeWorkspaceProductionTeam"), "workspace saves should restore department QA evidence omitted from the read model");

assert.ok(
  legacyRoutesSource.includes("registerProductionAssetBoardCandidateRoutes(app)"),
  "legacy project routes should compose the production asset board candidate routes",
);
[
  'app.post("/api/projects/:id/production-asset-board-candidates"',
  'app.post("/api/projects/:id/production-asset-board-candidates/:candidateId/adopt"',
  'app.delete("/api/projects/:id/production-asset-board-candidates/:candidateId"',
].forEach((snippet) => {
  assert.equal(legacyRoutesSource.includes(snippet), false, `legacyProjectRoutes should not define candidate route inline: ${snippet}`);
  assert.ok(productionAssetBoardCandidateRoutesSource.includes(snippet), `productionAssetBoardCandidateRoutes should own route: ${snippet}`);
});

[
  'app.get("/api/video-analysis/projects"',
  'app.post("/api/video-analysis/projects"',
  'app.put("/api/video-analysis/projects/:id"',
  'app.delete("/api/video-analysis/projects/:id"',
].forEach((snippet) => {
  assert.equal(serverSource.includes(snippet), false, `server.ts should not define route inline: ${snippet}`);
  assert.ok(videoAnalysisRoutesSource.includes(snippet), `videoAnalysisRoutes should own route: ${snippet}`);
});

[
  ['app.get("/api/prompts/:name"', promptRoutesSource, "promptRoutes"],
  ['app.put("/api/prompts/:name"', promptRoutesSource, "promptRoutes"],
  ['app.get("/api/skills"', skillRoutesSource, "skillRoutes"],
  ['app.post("/api/skills/ai-draft"', skillRoutesSource, "skillRoutes"],
  ['app.post("/api/skills"', skillRoutesSource, "skillRoutes"],
  ['app.put("/api/skills/:id"', skillRoutesSource, "skillRoutes"],
  ['app.delete("/api/skills/:id"', skillRoutesSource, "skillRoutes"],
  ['app.post("/api/system/gc"', systemRoutesSource, "systemRoutes"],
  ['app.post("/api/system/backup"', systemRoutesSource, "systemRoutes"],
  ['app.get("/api/health"', runtimeRoutesSource, "runtimeRoutes"],
  ['app.post("/api/runtime-logs"', runtimeRoutesSource, "runtimeRoutes"],
  ['app.get("/api/provider-key-status"', aiConfigRoutesSource, "aiConfigRoutes"],
  ['app.get("/api/ai-config"', aiConfigRoutesSource, "aiConfigRoutes"],
  ['app.put("/api/ai-config"', aiConfigRoutesSource, "aiConfigRoutes"],
  ['app.post("/api/assets/upload"', assetRoutesSource, "assetRoutes"],
  ['app.post("/api/assets/video-last-frame"', assetRoutesSource, "assetRoutes"],
  ['app.post("/api/assets/compose-video-segments"', assetRoutesSource, "assetRoutes"],
  ['app.post("/api/assets/compose-episode-film"', assetRoutesSource, "assetRoutes"],
].forEach(([snippet, routeSource, owner]) => {
  assert.equal(serverSource.includes(snippet), false, `server.ts should not define route inline: ${snippet}`);
  assert.ok(routeSource.includes(snippet), `${owner} should own route: ${snippet}`);
});

[
  'app.post("/api/proxy/doubao"',
  'app.post("/api/proxy/minimax"',
  'app.post("/api/proxy/gemini"',
  'app.post("/api/proxy/openai-image"',
  'app.post("/api/proxy/custom-bgm"',
].forEach((snippet) => {
  assert.equal(serverSource.includes(snippet), false, `server.ts should not define route inline: ${snippet}`);
  assert.ok(providerProxyRoutesSource.includes(snippet), `providerProxyRoutes should own route: ${snippet}`);
});
assert.ok(providerProxyRoutesSource.includes("registerOpenAICompatibleProxyRoute(app)"), "provider routes should register the standalone OpenAI-compatible proxy");
assert.ok(openAICompatibleProxyRouteSource.includes('app.post("/api/proxy/openai-compatible"'), "the standalone OpenAI-compatible proxy should own its route");

assert.equal(serverSource.includes('app.post("/api/proxy/kie-grok-video"'), false, "server.ts should not define the Kie video route inline");
assert.equal(providerProxyRoutesSource.includes('app.post("/api/proxy/kie-grok-video"'), false, "generic provider routes should not own the Kie video adapter contract");
assert.ok(providerProxyRoutesSource.includes("registerKieGrokVideoRoute(app)"), "provider routes should register the standalone Kie video adapter");
assert.ok(kieGrokVideoSource.includes('app.post("/api/proxy/kie-grok-video"'), "standalone Kie video adapter should own its route");
assert.ok(providerProxyRoutesSource.includes("registerComfyUIH3VideoRoute(app"), "provider routes should register the local ComfyUI H3 adapter");
assert.ok(comfyUIH3VideoSource.includes('app.post("/api/proxy/comfyui-h3-video/tasks"'), "the local H3 adapter should own persistent task submission");
assert.ok(comfyUIH3VideoSource.includes('app.get("/api/proxy/comfyui-h3-video/tasks/:taskId"'), "the local H3 adapter should resume the original ComfyUI task");

const routeFiles = [
  ["src/server/routes/aiConfigRoutes.ts", aiConfigRoutesSource],
  ["src/server/routes/assetRoutes.ts", assetRoutesSource],
  ["src/server/routes/videoAudioRoutes.ts", videoAudioRoutesSource],
  ["src/server/routes/legacyProjectRoutes.ts", legacyRoutesSource],
  ["src/server/routes/productionAssetBoardCandidateRoutes.ts", productionAssetBoardCandidateRoutesSource],
  ["src/server/routes/legacyWritingMigrationRoutes.ts", legacyWritingMigrationRoutesSource],
  ["src/server/routes/providerProxyRoutes.ts", providerProxyRoutesSource],
  ["src/server/routes/openAICompatibleProxyRoute.ts", openAICompatibleProxyRouteSource],
  ["src/server/routes/providerProxyUtils.ts", providerProxyUtilsSource],
  ["src/server/routes/promptRoutes.ts", promptRoutesSource],
  ["src/server/routes/runtimeRoutes.ts", runtimeRoutesSource],
  ["src/server/routes/skillRoutes.ts", skillRoutesSource],
  ["src/server/routes/systemRoutes.ts", systemRoutesSource],
  ["src/server/routes/videoAnalysisRoutes.ts", videoAnalysisRoutesSource],
  ["apps/api/src/routes/writing/writingRoutes.ts", writingRoutesSource],
  ["apps/api/src/routes/writing/writingRouteInputs.ts", writingRouteInputsSource],
] as const;

for (const [filePath, source] of routeFiles) {
  const lineCount = source.trimEnd().split(/\r?\n/).length;
  assert.ok(lineCount <= 260, `${filePath} should stay small; found ${lineCount} lines`);
  assert.equal(source.includes("from \"react\""), false, `${filePath} must not import React`);
}

console.log("Server route boundary self-check passed.");
