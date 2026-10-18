import { retiredWorkspaceHref } from "../src/utils/retiredWorkspaceRoutes";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * This source-level guard prevents the heavy production workspaces from being
 * pulled into the initial bundle. Real timings belong to browser acceptance and
 * must never be replaced with invented numbers in a unit test.
 */
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const routeProfilerSource = fs.readFileSync(new URL("../src/components/DevRouteProfiler.tsx", import.meta.url), "utf8");
const layoutSource = fs.readFileSync(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");

const globalAssistantSource = fs.readFileSync(new URL("../src/components/assistant/GlobalAssistant.tsx", import.meta.url), "utf8");
const promptEditorSource = fs.readFileSync(new URL("../src/components/PromptEditorModal.tsx", import.meta.url), "utf8");
const imagePromptSource = fs.readFileSync(new URL("../src/components/ImagePromptModal.tsx", import.meta.url), "utf8");
const skillStoreSource = fs.readFileSync(new URL("../src/store/useSkillStore.ts", import.meta.url), "utf8");
const assistantContextSource = fs.readFileSync(new URL("../src/services/assistant/context.ts", import.meta.url), "utf8");
const assistantRuntimeSource = fs.readFileSync(new URL("../src/services/assistant/runtime.ts", import.meta.url), "utf8");
const episodeSliceSource = fs.readFileSync(new URL("../src/store/slices/episodeSlice.ts", import.meta.url), "utf8");
const projectSliceSource = fs.readFileSync(new URL("../src/store/slices/projectSlice.ts", import.meta.url), "utf8");
const preparationSource = fs.readFileSync(new URL("../src/pages/ProductionPreparation.tsx", import.meta.url), "utf8");
const storyboardSource = fs.readFileSync(new URL("../src/pages/Storyboard.tsx", import.meta.url), "utf8");
const studioSource = fs.readFileSync(new URL("../src/pages/Studio.tsx", import.meta.url), "utf8");
const sceneReadModelHookSource = fs.readFileSync(new URL("../src/hooks/useSceneReadModel.ts", import.meta.url), "utf8");
const interactiveGraphWorkspaceSource = fs.readFileSync(new URL("../src/pages/InteractiveGraphWorkspace.tsx", import.meta.url), "utf8");
const interactiveGraphCanvasSource = fs.readFileSync(new URL("../src/components/interactive/InteractiveGraphCanvas.tsx", import.meta.url), "utf8");
const interactivePathDrawerSource = fs.readFileSync(new URL("../src/components/interactive/whiteboard/InteractivePathDrawer.tsx", import.meta.url), "utf8");
const heavyRoutes = [
  ["ProductionPreparation", "./pages/ProductionPreparation"],
  ["Storyboard", "./pages/Storyboard"],
  ["Studio", "./pages/Studio"],
  ["ProductionAssets", "./pages/ProductionAssets"],
  ["ImageGen", "./pages/ImageGen"],
] as const;

assert.match(
  appSource,
  /projectCount === 0[\s\S]*!hasRequestedProject[\s\S]*shouldRestoreActiveProject\(location\.pathname\)[\s\S]*void fetchProjects\(\);/,
  "the application shell must not fetch the legacy project catalog when a workspace URL already identifies its project",
);
for (const [source, owner] of [
  [assistantContextSource, "assistant context"],
  [assistantRuntimeSource, "assistant runtime"],
] as const) {
  assert.doesNotMatch(
    source,
    /getAllProjects\(\)/,
    `${owner} must not rebuild every Episode, Scene, Shot and media body merely to locate a project`,
  );
}

for (const [component, modulePath] of heavyRoutes) {
  assert.match(
    appSource,
    new RegExp(`const\\s+${component}\\s*=\\s*lazy\\(\\(\\)\\s*=>\\s*import\\([\"']${modulePath}[\"']\\)\\)`),
    `${component} must stay route-lazy`,
  );
  assert.doesNotMatch(
    appSource,
    new RegExp(`import\\s+${component}\\s+from\\s+[\"']${modulePath}[\"']`),
    `${component} must not also have an eager import`,
  );
}
assert.doesNotMatch(
  appSource,
  /import\(["']\.\/pages\/AutoStudio(?:Audit)?["']\)/,
  "Retired AutoStudio pages must not be bundled into the current product",
);
assert.match(
  appSource,
  /function\s+LegacyAutoStudioRedirect\(\)[\s\S]*\/production\/preparation/,
  "Historical AutoStudio links should enter the current production preparation workspace",
);
assert.doesNotMatch(
  appSource,
  /import\(["']\.\/pages\/(?:VideoGen|AudioGen)["']\)/,
  "Unavailable standalone media generators must not be bundled as product pages",
);
assert.equal(retiredWorkspaceHref("/video-gen", "?projectId=p"), "/production/studio?projectId=p");
assert.equal(retiredWorkspaceHref("/audio-gen", "?projectId=p"), "/production/studio?projectId=p");
assert.doesNotMatch(
  layoutSource,
  /["']\/(?:video-gen|audio-gen)["']/,
  "Unavailable standalone media generators must not appear in ordinary navigation",
);
assert.match(
  layoutSource,
  /import\s*\{\s*useProjectStore\s*,\s*useSettingsStore\s*\}\s*from\s*["']\.\.\/clients\/stateClient["'];?/,
  "Layout must access its two shell stores through src/clients/stateClient.ts",
);
assert.doesNotMatch(
  layoutSource,
  /\buseAdaptationStore\b/,
  "Layout must not subscribe to adaptation state it does not render",
);
for (const [label, source] of [
  ["Layout", layoutSource],
  ["GlobalAssistant", globalAssistantSource],
] as const) {
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*(?:\/store\/use[A-Za-z0-9]+|\/features\/legacy\/legacyStores)["']/,
    `${label} must not bypass the state client boundary with a direct legacy store import`,
  );
  assert.doesNotMatch(
    source,
    /import\s+\*\s+as\s+\w+\s+from\s+["'][^"']*clients\/stateClient["']/,
    `${label} must use narrow named state-client imports rather than a namespace import`,
  );
}

assert.match(
  layoutSource,
  /const\s+GlobalAssistant\s*=\s*lazy\(/,
  "The global assistant must not inflate the shared shell before the author opens it",
);
assert.match(
  layoutSource,
  /assistantLaunchRequest\s*&&\s*\([\s\S]*<GlobalAssistant/,
  "The global assistant chunk should only mount after an explicit assistant command",
);
assert.match(
  promptEditorSource,
  /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!isOpen\)\s*return;\s*void fetchSkills\(\);/,
  "PromptEditorModal must not request the Skill catalog while its panel is closed",
);
assert.doesNotMatch(
  imagePromptSource,
  /\b(?:useSkillStore|fetchSkills|SkillRecommendationModal)\b/,
  "ImagePromptModal must not load the Skill catalog after its Skill controls have been removed",
);
assert.match(
  skillStoreSource,
  /if\s*\(skillCatalogRequest\)\s*return skillCatalogRequest;/,
  "Concurrent prompt panels must share one Skill catalog request",
);

assert.match(appSource, /<Suspense\s+fallback=\{<RouteFallback\s*\/>\}>/);
for (const routeId of ["production-preparation", "storyboard", "studio"]) {
  assert.match(
    appSource,
    new RegExp(`<DevRouteProfiler\\s+id=[\"']${routeId}[\"']>`),
    `${routeId} must expose real development React Profiler measurements`,
  );
}
assert.match(
  routeProfilerSource,
  /window\.__OMNI_ROUTE_PROFILES__/,
  "Development route profiles must remain available to browser acceptance",
);
assert.match(
  routeProfilerSource,
  /window\.__OMNI_ROUTE_PERFORMANCE__/,
  "Development route performance snapshots must remain available to browser acceptance",
);
assert.match(
  routeProfilerSource,
  /PerformanceObserver/,
  "Browser acceptance must capture resource and long-task entries rather than inventing timings",
);
assert.match(
  routeProfilerSource,
  /data-dev-route-performance/,
  "Browser acceptance needs a hidden DOM probe because page globals are not available to every browser controller",
);
assert.match(
  routeProfilerSource,
  /import\.meta\.env\.DEV/,
  "Route profiling must not add production runtime work",
);
assert.doesNotMatch(
  storyboardSource,
  /from\s+["']@hello-pangea\/dnd["']/,
  "Storyboard must not load the removed drag-and-drop Shot rail",
);
assert.doesNotMatch(
  storyboardSource,
  /StoryboardShotReorderRail|调整顺序/,
  "Storyboard must render Shot cards directly without the retired reorder rail",
);
assert.match(
  storyboardSource,
  /isProductionEvidenceOpen\s*&&\s*\(/,
  "Production evidence panels should stay unmounted while collapsed",
);
assert.match(
  storyboardSource,
  /getStoryboardTeamContext\(/,
  "Storyboard should fetch full production-team prompt evidence only when an AI action needs it",
);
assert.match(
  storyboardSource,
  /buildStoryboardBatchSceneReadModel\(\{[\s\S]*scene:\s*activeScene/,
  "Storyboard status should be derived only for the current scene",
);
assert.doesNotMatch(
  storyboardSource,
  /storyboardBatchSourceScenes\.map\(/,
  "Storyboard must not synchronously aggregate every scene during render",
);
for (const [label, source] of [
  ["ProductionPreparation", preparationSource],
  ["Storyboard", storyboardSource],
  ["Studio", studioSource],
  ["useSceneReadModel", sceneReadModelHookSource],
] as const) {
  assert.match(
    source,
    /useShallow/,
    `${label} must subscribe only to the project state it renders`,
  );
}
assert.match(
  storyboardSource,
  /const\s+DepartmentBoardsPanel\s*=\s*lazy\(/,
  "Department evidence should not inflate the initial Storyboard chunk",
);
assert.match(
  storyboardSource,
  /const\s+ShotCard\s*=\s*lazy\(/,
  "The full shot inspector should stay outside the initial Storyboard chunk",
);
assert.match(
  storyboardSource,
  /const\s+PromptEditorModal\s*=\s*lazy\(/,
  "Storyboard must not load the Prompt editor or Skill catalog before an AI action",
);
assert.match(
  storyboardSource,
  /\{\(promptModalState\.isOpen\s*\|\|\s*boardBatchAgent\.promptRequest\s*\|\|\s*isVisualRefinementPromptOpen\)\s*&&\s*\(/,
  "Storyboard must not mount its lazy Prompt editor while every AI action is closed",
);
assert.match(
  storyboardSource,
  /repeat\(auto-fit,\s*minmax\(min\(100%,\s*300px\),\s*1fr\)\)/,
  "Storyboard should size the Shot-card columns from the actual content width",
);
assert.doesNotMatch(
  storyboardSource,
  /选择一个镜头查看详情/,
  "Storyboard should not hide the current scene's Shot cards behind a selected-Shot inspector",
);
assert.match(
  appSource,
  /sceneId:\s*episodeView\s*\?/,
  "Production workspace restoration should request only the current scene",
);
assert.match(
  preparationSource,
  /view:\s*"production-preparation",\s*sceneId/,
  "Production preparation scene switching should hydrate the requested scene on demand",
);
assert.match(
  preparationSource,
  /const\s+destinationTab\s*=\s*activeTab\s*===\s*"overview"[\s\S]*:\s*activeTab/,
  "Production preparation scene switching should preserve the current step outside the overview",
);
const preparationSelectSceneSource = preparationSource.match(
  /const\s+selectScene\s*=\s*\(sceneId:\s*string\)\s*=>\s*\{([\s\S]*?)\n\s*\};/,
)?.[1] || "";
assert.doesNotMatch(
  preparationSelectSceneSource,
  /setActiveEpisodeId\(/,
  "Production preparation scene selection must not race URL-scoped hydration with a second eager request",
);
assert.match(
  storyboardSource,
  /view:\s*storyboardEpisodeView,\s*sceneId/,
  "Storyboard scene switching should hydrate the requested scene on demand",
);
const storyboardSelectSceneSource = storyboardSource.match(
  /const\s+selectScene\s*=\s*\(sceneId:\s*string\)\s*=>\s*\{([\s\S]*?)\n\s*\};/,
)?.[1] || "";
assert.doesNotMatch(
  storyboardSelectSceneSource,
  /setActiveEpisodeId\(/,
  "Storyboard scene selection must not race URL-scoped hydration with a second eager request",
);
assert.match(
  storyboardSource,
  /view:\s*storyboardEpisodeView,[\s\S]*shotId:\s*undefined/,
  "Storyboard should hydrate every Shot in the selected scene for the Shot-card grid",
);
assert.match(
  studioSource,
  /const\s+studioEpisodeView\s*=\s*urlVideoGenerationMode\s*===\s*"storyboard"\s*\|\|\s*Boolean\(urlShotId\)[\s\S]*\?\s*"storyboard"[\s\S]*:\s*"storyboard-index"/,
  "Studio should keep the scene list compact, then hydrate the selected scene fully before QA and media generation",
);
assert.match(
  studioSource,
  /shotId:\s*studioEpisodeView\s*===\s*"storyboard-index"\s*\?\s*urlShotId\s*\|\|\s*undefined\s*:\s*undefined/,
  "Studio should request a compact Shot only before a concrete Shot has been selected",
);
const studioSelectSceneSource = studioSource.match(
  /const\s+selectStudioScene\s*=\s*\(sceneId:\s*string\)\s*=>\s*\{([\s\S]*?)\n\s*\};/,
)?.[1] || "";
assert.doesNotMatch(
  studioSelectSceneSource,
  /setActiveEpisodeId\(/,
  "Studio scene selection must not race URL-scoped hydration with a second eager request",
);
assert.match(
  studioSource,
  /selectedShotCandidate\s*&&\s*!selectedShotCandidate\.__workspaceShotSummary/,
  "Studio must not expose a shot summary to generation controls as if it were a complete shot",
);
assert.doesNotMatch(
  studioSource,
  /setSelectedShotId\(activeScene\.shots\[0\]\.id\)/,
  "Studio must not preload the first full shot before the author selects one",
);
for (const component of [
  "Timeline",
  "StudioShotControls",
  "StudioAudioControls",
  "StudioGenerationTargetPicker",
  "StudioReferenceControlPanel",
  "PromptEditorModal",
]) {
  assert.match(
    studioSource,
    new RegExp(`const\\s+${component}\\s*=\\s*lazy\\(`),
    `${component} must stay outside the initial Studio bundle`,
  );
}
assert.match(
  interactiveGraphWorkspaceSource,
  /isAiDrawerOpen\s*&&\s*\([\s\S]*<InteractiveAiDrawer/,
  "The AI drawer chunk should not be requested while the drawer is closed",
);
assert.match(
  interactiveGraphWorkspaceSource,
  /isContentMappingOpen\s*&&\s*\([\s\S]*<InteractiveContentMappingModal/,
  "Writing content mapping should not load before the author opens it",
);
assert.match(
  studioSource,
  /isParamsModalOpen\s*&&\s*\([\s\S]*<GlobalGenerationParamsModal/,
  "Studio settings must not load its modal bundle before the author opens it",
);
assert.match(
  studioSource,
  /ttsModalState\.isOpen\s*&&\s*\([\s\S]*<TTSConfigModal/,
  "Studio TTS settings must not load before the author opens them",
);
for (const component of [
  "InteractiveAiDrawer",
  "InteractiveGraphDraftReview",
  "InteractiveContentPlanReview",
  "InteractiveNodeInspector",
  "InteractiveChoiceInspector",
  "PromptEditorModal",
]) {
  assert.match(
    interactiveGraphWorkspaceSource,
    new RegExp(`const\\s+${component}\\s*=\\s*lazy\\(`),
    `${component} should stay outside the initial infinite-canvas bundle`,
  );
}
assert.match(
  interactiveGraphCanvasSource,
  /position:\s*layout\?\.nodes\[node\.id\]\s*\|\|\s*\{/,
  "The canvas should paint a lightweight fallback instead of blocking render on dagre",
);
assert.doesNotMatch(
  interactiveGraphCanvasSource,
  /graphAutoLayout/,
  "Dagre must stay outside the initial infinite-canvas render chunk",
);
assert.match(
  interactiveGraphWorkspaceSource,
  /import\('\.\.\/domains\/interactive\/layout\/graphAutoLayout'\)/,
  "Missing or explicitly reset layouts should load dagre on demand",
);
assert.match(
  interactiveGraphCanvasSource,
  /synchronizedNodesRef\.current\s*===\s*initialNodes/,
  "The canvas must not rebuild the same node projection twice on mount",
);
assert.match(
  interactivePathDrawerSource,
  /const\s+\{[\s\S]*?nodes,[\s\S]*?plannedSummary,[\s\S]*?\}\s*=\s*useMemo/,
  "Path enumeration must not rerun on unrelated whiteboard renders",
);
assert.match(
  episodeSliceSource,
  /localScene\?\.__workspaceSceneSummary[\s\S]*legacyProjectClient\.getEpisode\(currentProject\.id,\s*targetEpisodeId\)/,
  "Editing an unloaded scene must hydrate the full episode before persistence",
);
assert.match(
  episodeSliceSource,
  /__workspaceSceneScope[\s\S]*localScene\?\.__workspaceSceneSummary\s*\|\|\s*shotSummaryOnly\s*\|\|\s*sceneScopedWorkspace[\s\S]*legacyProjectClient\.getEpisode\(currentProject\.id,\s*targetEpisodeId\)/,
  "Editing a scene-scoped preparation workspace must hydrate the full episode before sequential writes",
);
assert.match(
  episodeSliceSource,
  /visibleEpisode\?\.id === targetEpisodeId[\s\S]*projectUpdatedSceneIntoActiveWorkspace\(visibleEpisode,\s*updatedEp,\s*sceneId/,
  "A scoped scene write must retain its optimistic full scene instead of being overwritten by a pre-save workspace reload",
);
assert.ok(preparationSource.includes("queryTab !== selectedTab || queryDepartment"), "an absent optional department must not repeatedly rewrite the current URL and undo a user's navigation");
assert.match(
  episodeSliceSource,
  /workspaceEpisode\.__workspaceSceneScope\s*===\s*sceneId[\s\S]*delete\s+\(draft\s+as\s+WorkspaceEpisode\)\.__workspaceShotSummaryOnly/,
  "A hydrated scene must no longer advertise shot-summary-only data after an optimistic write",
);
const { projectUpdatedSceneIntoActiveWorkspace } = await import("../src/store/slices/episodeSlice");
const projectedStoryboardEpisode = projectUpdatedSceneIntoActiveWorkspace(
  {
    id: "episode-1",
    title: "Episode 1",
    scenes: [
      { id: "scene-1", title: "Scene 1", shots: [] },
      { id: "scene-2", title: "Scene 2", shotCount: 2, __workspaceSceneSummary: true },
    ],
    __workspaceView: "storyboard",
    __workspaceSceneScope: "scene-1",
    __workspaceShotSummaryOnly: true,
  } as any,
  {
    id: "episode-1",
    title: "Episode 1",
    scenes: [
      { id: "scene-1", title: "Scene 1", shots: [{ id: "shot-1", duration: 5 }] },
      { id: "scene-2", title: "Scene 2", shots: [{ id: "shot-2" }, { id: "shot-3" }] },
    ],
  } as any,
  "scene-1",
) as any;
assert.equal(projectedStoryboardEpisode.scenes[0].shots.length, 1);
assert.equal(projectedStoryboardEpisode.scenes[1].__workspaceSceneSummary, true);
assert.equal(projectedStoryboardEpisode.__workspaceView, "storyboard");
assert.equal(projectedStoryboardEpisode.__workspaceSceneScope, "scene-1");
assert.equal(projectedStoryboardEpisode.__workspaceShotSummaryOnly, undefined);
assert.match(
  projectSliceSource,
  /projectView\s*=\s*options\?\.episodeView\s*===\s*"production-preparation"[\s\S]*options\?\.episodeView\s*===\s*"storyboard"/,
  "Preparation, Storyboard and Studio should load the production workspace project shell so projected source bodies do not invalidate current department hashes",
);
for (const [label, source] of [
  ["ProductionPreparation", preparationSource],
  ["Storyboard", storyboardSource],
] as const) {
  assert.match(
    source,
    /__productionWorkspaceShell/,
    `${label} must distinguish an ordinary project shell from the production workspace projection`,
  );
  assert.match(
    source,
    /currentProject\?\.id\s*===\s*queryProjectId[\s\S]*hasProductionWorkspaceShell/,
    `${label} must reload the same project when navigation changes from an ordinary shell to a production workspace`,
  );
}

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "storyboard-scoped-read-"));
process.env.OMNI_DB_PATH = path.join(tempDirectory, "workspace.db");
const { db, dbHelpers } = await import("../src/server/db");
const {
  buildManualShotPlanHash,
  buildManualImagePromptHash,
  buildManualStoryboardReadModel,
  buildManualStoryboardSourceHash,
  buildManualVideoPromptHash,
  buildManualVisualPromptHash,
  buildManualVisualPromptSourceHash,
} = await import("../src/services/production/manualStoryboard");
const {
  buildProductionAssetPreparationContext,
  productionAssetDepartmentOutputSourceHash,
} = await import("../src/services/production/productionAssetPreparation");

try {
  const filmTeamStub = {
    sourceScriptHash: "script-source",
    departmentPrepPackages: [],
  } as any;
  const assetsStub = {
    sceneVisualPack: undefined,
    assetBoards: [],
    readyForShotPlanning: true,
    readyForStoryboardGeneration: true,
  } as any;
  const sceneOneSourceHash = buildManualStoryboardSourceHash(filmTeamStub, assetsStub);
  const sceneOneShots = [
    {
      id: "shot-1",
      duration: 5,
      shotSize: "WS",
      visualAction: "Action 1",
      imagePrompt: "Image prompt 1",
      videoPrompt: "Video prompt 1",
      imageUrl: "https://cdn.example.test/shot-1.png",
    },
    {
      id: "shot-1b",
      duration: 4,
      shotSize: "CU",
      visualAction: "Action 1B",
      imagePrompt: "Image prompt 1B",
      videoPrompt: "Video prompt 1B",
      videoUrl: "data:video/mp4;base64,AAAA",
    },
  ];
  const heavyBoard = {
    schemaVersion: "manual-storyboard.v1",
    shotPlan: {
      sourceHash: sceneOneSourceHash,
      outputHash: buildManualShotPlanHash(sceneOneShots),
      audit: { promptHash: "shot-plan-prompt" },
    },
    imagePrompts: {
      sourceHash: buildManualVisualPromptSourceHash(sceneOneSourceHash, sceneOneShots),
      outputHash: buildManualImagePromptHash(sceneOneShots),
      audit: { promptHash: "image-prompt" },
    },
    videoPrompts: {
      sourceHash: buildManualVisualPromptSourceHash(sceneOneSourceHash, sceneOneShots),
      outputHash: buildManualVideoPromptHash(sceneOneShots),
      audit: { promptHash: "video-prompt" },
    },
    boards: [{ id: "board-1", prompt: "x".repeat(20_000) }],
    updatedAt: 1,
  };
  const heavyScenePlanText = "department execution evidence ".repeat(1_000);
  dbHelpers.saveProject({
    id: "project-scoped-read",
    title: "Scoped read",
    type: "movie",
    characters: [],
    assets: [],
    productionSourceDocuments: [{
      id: "document-1",
      order: 1,
      kind: "whole",
      title: "Source",
      content: "Source content",
      sourceHash: "source-hash",
      createdAt: 1,
    }],
    productionSourceSnapshot: {
      sourceType: "writing_export",
      package: { units: [{ id: "unit-1", prose: "x".repeat(20_000), scenes: [] }] },
    },
    productionScenePlans: [{
      id: "scene-plan-history",
      sourceDocumentId: "document-1",
      status: "adopted",
      candidateScenes: [{ id: "candidate", description: "x".repeat(20_000) }],
      adoptedSceneSnapshot: [],
      adoptedAt: 1,
    }],
    manualProductionAssets: {
      schemaVersion: "manual-production-assets.v1",
      approvals: [{ boardItemId: "board-approval", status: "confirmed" }],
      references: [],
      pendingReferences: [{
        id: "pending-reference-1",
        status: "pending_review",
        boardItemId: "board-pending",
        assetId: "asset-1",
        assetType: "prop",
        imageUrl: "/media/pending-reference.png",
        source: "ai_generation",
        selectedSkillIds: [],
        selectedContextIds: [],
        sourceSceneIds: ["scene-1"],
        createdAt: 1,
        updatedAt: 1,
      }],
      variants: [{ variantId: "variant-history", finalPrompt: "x".repeat(20_000) }],
      profileRevisions: [{ assetId: "asset-1", evidence: "x".repeat(20_000) }],
      preparationBatches: [{
        id: "batch-1",
        sourceHash: "batch-source",
        decisions: [{ sceneId: "scene-1", assetId: "asset-1", use: "base" }],
        finalPrompt: "x".repeat(20_000),
        updatedAt: 1,
      }],
      updatedAt: 1,
    },
    episodes: [{
      id: "episode-1",
      title: "Episode 1",
      inspiration: "Private episode planning context ".repeat(1_000),
      productionTeam: {
        outputs: [{
          department: "directing",
          taskSummary: "Directing summary",
          content: "Unit direction",
          scenePlans: [
            {
              sceneId: "scene-1",
              sceneTitle: "Scene 1",
              summary: "Current scene direction",
              executionNotes: ["Current execution"],
              assetNeeds: [],
              continuityNotes: [],
              handoffNotes: [],
            },
            {
              sceneId: "scene-2",
              sceneTitle: "Scene 2",
              summary: heavyScenePlanText,
              executionNotes: [heavyScenePlanText],
              assetNeeds: [heavyScenePlanText],
              continuityNotes: [heavyScenePlanText],
              handoffNotes: [heavyScenePlanText],
            },
          ],
          openQuestions: [],
          handoffNotes: ["Team handoff"],
          status: "confirmed",
          version: 1,
          audit: { promptHash: "prompt-1" },
          qa: {
            verdict: "pass",
            score: 96,
            issues: [],
            coverage: { evidence: heavyScenePlanText },
          },
          updatedAt: 1,
        }],
      },
      scenes: [
        {
          id: "scene-1",
          title: "Scene 1",
          description: "First scene",
          breakdown: { characters: [] },
          productionPreparation: { breakdown: { status: "confirmed", sourceHash: "scene-1" } },
          manualStoryboard: heavyBoard,
          shots: sceneOneShots,
        },
        {
          id: "scene-2",
          title: "Scene 2",
          description: "Second scene",
          breakdown: { characters: [] },
          productionPreparation: { breakdown: { status: "confirmed", sourceHash: "scene-2" } },
          manualStoryboard: heavyBoard,
          shots: [{ id: "shot-2", duration: 6, visualAction: "Action 2" }],
        },
      ],
    }],
  });

  const projectListEntry = dbHelpers.getProjectSummaries()
    .find((project: any) => project.id === "project-scoped-read");
  assert.equal(projectListEntry.episodes[0].inspiration, undefined);
  assert.equal(projectListEntry.episodes[0].id, "episode-1");
  assert.equal(projectListEntry.episodes[0].sceneCount, 2);

  const fullProjectShell = dbHelpers.getProjectShellById("project-scoped-read");
  const productionProjectShell = dbHelpers.getProductionWorkspaceProjectShellById("project-scoped-read");
  assert.equal(productionProjectShell.__productionWorkspaceShell, true);
  assert.equal(productionProjectShell.productionSourceSnapshot, undefined);
  assert.equal(productionProjectShell.productionScenePlans[0].status, "adopted", "workspace must retain adopted plan state and history");
  assert.equal(productionProjectShell.manualProductionAssets.variants.length, 0);
  assert.equal(productionProjectShell.manualProductionAssets.pendingReferences[0].id, "pending-reference-1");
  assert.equal(productionProjectShell.manualProductionAssets.profileRevisions[0].evidence, undefined);
  assert.equal(productionProjectShell.manualProductionAssets.preparationBatches[0].finalPrompt, undefined);
  assert.equal(
    productionProjectShell.manualProductionAssets.preparationBatches[0].decisions[0].evidence,
    undefined,
  );
  assert.ok(
    JSON.stringify(productionProjectShell).length < JSON.stringify(fullProjectShell).length / 2,
    "production workspace project shells must omit source packages and asset audit history bodies",
  );
  productionProjectShell.manualProductionAssets.approvals.push({
    boardItemId: "board-approval-2",
    status: "confirmed",
  });
  dbHelpers.updateProjectMeta("project-scoped-read", productionProjectShell);
  const savedProject = dbHelpers.getProjectById("project-scoped-read");
  assert.equal(savedProject.manualProductionAssets.approvals.length, 2);
  assert.equal(savedProject.manualProductionAssets.pendingReferences[0].id, "pending-reference-1");
  assert.equal(savedProject.manualProductionAssets.variants[0].finalPrompt.length, 20_000);
  assert.equal(savedProject.manualProductionAssets.profileRevisions[0].evidence.length, 20_000);
  assert.equal(savedProject.manualProductionAssets.preparationBatches[0].finalPrompt.length, 20_000);
  assert.equal(savedProject.productionSourceSnapshot.package.units[0].prose.length, 20_000);
  assert.equal(savedProject.productionScenePlans[0].candidateScenes[0].description.length, 20_000);

  const longScriptUnits = Array.from({ length: 100 }, (_, index) => ({
    id: `long-script-unit-${index + 1}`,
    sourceDocumentId: `long-source-${index + 1}`,
    kind: "episode",
    order: index + 1,
    title: `第 ${index + 1} 集`,
    content: `第 ${index + 1} 集正文：${"正文".repeat(1_000)}`,
    contentHash: `long-content-${index + 1}`,
    status: "current",
    createdAt: 1,
    updatedAt: 1,
  }));
  dbHelpers.saveProject({
    id: "project-lazy-script-units",
    title: "长剧剧本懒加载验收",
    type: "short-drama",
    episodes: longScriptUnits.map((unit: any) => ({
      id: `long-episode-${unit.order}`,
      title: unit.title,
      sourceDocumentId: unit.sourceDocumentId,
      scenes: [],
    })),
    productionSourceDocuments: longScriptUnits.map((unit: any) => ({
      id: unit.sourceDocumentId,
      order: unit.order,
      kind: "episode",
      title: unit.title,
      content: unit.content,
      sourceHash: unit.contentHash,
      isWorkRange: true,
      createdAt: 1,
    })),
    productionScriptWorkspace: {
      schemaVersion: "production-canonical-script.v1",
      authority: "production",
      sourceKind: "magic_import",
      currentRevisionId: "long-current-revision",
      revisions: [{
        id: "long-current-revision",
        revision: 1,
        kind: "initial",
        authority: "production",
        message: "初始剧本",
        sourceHash: "long-script-source",
        units: longScriptUnits,
        createdAt: 1,
      }],
      syncPolicy: "safe_auto",
      syncStatus: "current",
      updatedAt: 1,
    },
  });
  const longScriptShell = dbHelpers.getProjectShellById("project-lazy-script-units");
  assert.equal(longScriptShell.productionScriptWorkspace.revisions[0].units.every((unit: any) => unit.content === ""), true,
    "a long project shell must defer every screenplay body until an author selects a unit");
  assert.equal(longScriptShell.productionSourceDocuments.every((document: any) => document.content === ""), true,
    "the shell must not retain a duplicate full source-document payload beside the canonical screenplay");
  const longScriptUnit = dbHelpers.getProductionScriptUnitBySourceDocumentId("project-lazy-script-units", "long-source-58");
  assert.equal(longScriptUnit.unit.content, longScriptUnits[57].content,
    "the selected screenplay body must hydrate through its dedicated unit read");
  const activeLongScriptShell = dbHelpers.getProjectShellById("project-lazy-script-units", "long-source-58");
  assert.equal(activeLongScriptShell.productionScriptWorkspace.revisions[0].units[57].content, longScriptUnits[57].content,
    "an explicitly selected unit may be included without expanding the other 99 bodies");
  assert.equal(activeLongScriptShell.productionScriptWorkspace.revisions[0].units.filter((unit: any) => unit.content).length, 1);
  dbHelpers.updateProjectMeta("project-lazy-script-units", {
    ...longScriptShell,
    productionPreparationStatus: "viewed-from-lightweight-shell",
  });
  const lazyProjectAfterGeneralSave = dbHelpers.getProjectById("project-lazy-script-units");
  assert.equal(lazyProjectAfterGeneralSave.productionScriptWorkspace.revisions[0].units[57].content, longScriptUnits[57].content,
    "a general save from a deferred shell must never erase canonical screenplay bodies");
  assert.equal(lazyProjectAfterGeneralSave.productionSourceDocuments[57].content, longScriptUnits[57].content,
    "a general save from a deferred shell must never erase immutable source-document bodies");
  const nextWorkspace = {
    ...lazyProjectAfterGeneralSave.productionScriptWorkspace,
    currentRevisionId: "long-revision-after-editor-a",
    revisions: [
      ...lazyProjectAfterGeneralSave.productionScriptWorkspace.revisions,
      {
        ...lazyProjectAfterGeneralSave.productionScriptWorkspace.revisions[0],
        id: "long-revision-after-editor-a",
        revision: 2,
        message: "编辑器 A 修改",
        createdAt: 2,
      },
    ],
  };
  dbHelpers.updateProjectMeta("project-lazy-script-units", {
    productionScriptWorkspace: nextWorkspace,
    __expectedProductionScriptRevisionId: "long-current-revision",
  });
  assert.throws(() => dbHelpers.updateProjectMeta("project-lazy-script-units", {
    productionScriptWorkspace: nextWorkspace,
    __expectedProductionScriptRevisionId: "long-current-revision",
  }), (error: any) => error?.statusCode === 409,
  "a second editor must receive a revision conflict instead of overwriting a newer formal screenplay");
  const fullEpisode = dbHelpers.getEpisodeById("project-scoped-read", "episode-1");
  const scopedEpisode = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "storyboard",
    "scene-1",
  );
  assert.equal(scopedEpisode.__workspaceSceneScope, "scene-1");
  assert.equal(scopedEpisode.scenes.length, 2);
  assert.equal(scopedEpisode.scenes[0].shots.length, 2);
  assert.equal(scopedEpisode.scenes[1].__workspaceSceneSummary, true);
  assert.equal(scopedEpisode.scenes[1].shotCount, 1);
  assert.equal(scopedEpisode.scenes[1].__workspaceBreakdownStatus, "已确认");
  assert.ok(
    JSON.stringify(scopedEpisode).length < JSON.stringify(fullEpisode).length,
    "scoped Storyboard reads must omit inactive scene payloads",
  );
  const storyboardIndex = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "storyboard-index",
    "scene-1",
  );
  const defaultStoryboardIndex = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "storyboard-index",
  );
  assert.equal(
    defaultStoryboardIndex.__workspaceSceneScope,
    "scene-1",
    "workspace reads without a scene query must default to the first scene instead of expanding the whole episode",
  );
  assert.equal(defaultStoryboardIndex.scenes[1].__workspaceSceneSummary, true);
  const expandedStoryboard = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "storyboard",
    undefined,
    undefined,
    true,
  );
  assert.equal(expandedStoryboard.__workspaceSceneScope, undefined);
  assert.equal(
    expandedStoryboard.scenes[1].__workspaceSceneSummary,
    undefined,
    "explicit episode-scoped batch reads must keep every scene available",
  );
  const { buildStoryboardBatchSceneIndex } = await import(
    "../src/services/production/storyboardBatchSceneIndex"
  );
  let batchYieldCount = 0;
  const batchReadModels = await buildStoryboardBatchSceneIndex({
    project: fullProjectShell,
    episode: fullEpisode,
    episodes: [fullEpisode],
    scenes: fullEpisode.scenes,
    yieldControl: async () => {
      batchYieldCount += 1;
    },
  });
  assert.equal(batchReadModels.length, fullEpisode.scenes.length);
  assert.equal(
    batchYieldCount,
    Math.max(0, fullEpisode.scenes.length - 1),
    "long batch indexing must yield after every completed scene except the last",
  );
  assert.equal(storyboardIndex.__workspaceShotSummaryOnly, true);
  assert.equal(storyboardIndex.scenes[0].shots[0].__workspaceShotSummary, true);
  assert.equal(storyboardIndex.scenes[0].shots[0].visualAction, undefined);
  assert.equal(storyboardIndex.scenes[0].shots[0].shotSize, "WS");
  assert.equal(storyboardIndex.scenes[0].shots[0].cameraAngle, undefined);
  assert.equal(
    storyboardIndex.scenes[0].shots[0].imageUrl,
    "https://cdn.example.test/shot-1.png",
    "compact remote media references should remain available to Studio playback",
  );
  assert.equal(
    storyboardIndex.scenes[0].shots[1].videoUrl,
    undefined,
    "inline media bodies must stay out of the Shot index response",
  );
  assert.equal(
    storyboardIndex.scenes[0].__workspaceShotPlanHash,
    buildManualShotPlanHash(fullEpisode.scenes[0].shots),
  );
  assert.equal(
    storyboardIndex.scenes[0].__workspaceVisualPromptHash,
    buildManualVisualPromptHash(fullEpisode.scenes[0].shots),
  );
  assert.equal(
    storyboardIndex.scenes[0].__workspaceVisualPromptSourceHash,
    buildManualVisualPromptSourceHash(sceneOneSourceHash, fullEpisode.scenes[0].shots),
  );
  assert.equal(storyboardIndex.scenes[0].__workspaceHasVisualPrompts, true);
  const fullStoryboardReadModel = buildManualStoryboardReadModel({
    scene: fullEpisode.scenes[0],
    filmTeam: filmTeamStub,
    assets: assetsStub,
  });
  const indexedStoryboardReadModel = buildManualStoryboardReadModel({
    scene: storyboardIndex.scenes[0],
    filmTeam: filmTeamStub,
    assets: assetsStub,
  });
  assert.deepEqual(
    indexedStoryboardReadModel,
    fullStoryboardReadModel,
    "server-side shot hashes must preserve the same Storyboard readiness as a full scene payload",
  );
  assert.equal(storyboardIndex.__workspaceProductionTeamSummaryOnly, true);
  assert.equal(storyboardIndex.productionTeam.outputs[0].content, "");
  assert.deepEqual(
    storyboardIndex.productionTeam.outputs[0].handoffNotes,
    ["Team handoff"],
    "compact outputs must retain handoff notes used by the production asset source hash",
  );
  assert.equal(
    storyboardIndex.productionTeam.outputs[0].__workspaceProductionTeamOutputSummary,
    true,
  );
  assert.equal(
    typeof storyboardIndex.productionTeam.outputs[0].__workspaceProductionAssetSourceHash,
    "string",
    "the production asset read model must retain the authoritative department source hash",
  );
  assert.equal(
    productionAssetDepartmentOutputSourceHash(storyboardIndex.productionTeam.outputs[0]),
    productionAssetDepartmentOutputSourceHash(fullEpisode.productionTeam.outputs[0]),
    "compact department outputs must preserve the same production asset source hash",
  );
  assert.equal(
    buildProductionAssetPreparationContext(productionProjectShell, [storyboardIndex]).sourceHash,
    buildProductionAssetPreparationContext(fullProjectShell, [fullEpisode]).sourceHash,
    "compact project and episode shells must preserve the production asset preparation source hash",
  );
  assert.equal(
    storyboardIndex.productionTeam.outputs[0].scenePlans[0].__workspaceScenePlanSummary,
    true,
    "the collapsed Shot index must use purpose-built department summaries for every scene",
  );
  assert.equal(
    storyboardIndex.productionTeam.outputs[0].scenePlans[0].sceneTitle,
    undefined,
    "collapsed department coverage should retain only stable scene ids",
  );
  assert.equal(
    storyboardIndex.productionTeam.outputs[0].scenePlans[1].__workspaceScenePlanSummary,
    true,
  );
  assert.equal(
    storyboardIndex.productionTeam.outputs[0].scenePlans[1].executionNotes,
    undefined,
    "inactive department scene plans must stay as coverage summaries until their scene is opened",
  );
  assert.equal(
    storyboardIndex.productionTeam.outputs[0].qa.coverage,
    undefined,
    "department QA evidence bodies must stay out of scoped workspace reads",
  );
  assert.equal(
    storyboardIndex.scenes[0].manualStoryboard.__workspaceStoryboardIndex,
    true,
  );
  assert.equal(
    storyboardIndex.scenes[0].manualStoryboard.boards,
    undefined,
    "collapsed Shot mode must not include Storyboard candidate identities or bodies",
  );
  assert.equal(
    storyboardIndex.scenes[0].manualStoryboard.batchAudits,
    undefined,
    "collapsed Shot mode must not include historical board audit bodies",
  );
  assert.equal(
    storyboardIndex.__workspaceProductionTeamPromptContext,
    undefined,
    "collapsed Shot mode must not preload AI-only production context",
  );
  const promptResponse = dbHelpers.getStoryboardTeamPromptContext(
    "project-scoped-read",
    "episode-1",
    "scene-1",
  );
  const promptContext = JSON.parse(promptResponse.productionTeamContext);
  assert.equal(promptContext.historicalPlans[0].unitPlan, "Unit direction");
  assert.equal(promptContext.historicalPlans[0].scenePlan.summary, "Current scene direction");
  assert.equal(
    promptContext.historicalPlans[0].scenePlan.sceneId,
    promptResponse.sceneId,
    "the server prompt read model must remain scoped to the active scene",
  );
  const selectedShotIndex = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "storyboard-index",
    "scene-1",
    "shot-1",
  );
  assert.equal(selectedShotIndex.__workspaceShotScope, "shot-1");
  assert.equal(selectedShotIndex.scenes[0].shots[0].__workspaceShotSummary, undefined);
  assert.equal(selectedShotIndex.scenes[0].shots[1].__workspaceShotSummary, true);
  assert.ok(
    JSON.stringify(storyboardIndex).length < JSON.stringify(scopedEpisode).length,
    "collapsed Storyboard reads must be smaller than the full current-scene response",
  );
  selectedShotIndex.scenes[0].description = "Updated through selected-shot workspace";
  selectedShotIndex.scenes[0].shots[0].visualAction = "Updated action";
  delete selectedShotIndex.scenes[0].shots[0].imageUrl;
  dbHelpers.updateEpisode("project-scoped-read", "episode-1", selectedShotIndex);
  const savedSelectedShotEpisode = dbHelpers.getEpisodeById("project-scoped-read", "episode-1");
  assert.equal(savedSelectedShotEpisode.scenes[0].shots.length, 2);
  assert.equal(savedSelectedShotEpisode.scenes[0].shots[0].visualAction, "Updated action");
  assert.equal(
    savedSelectedShotEpisode.scenes[0].shots[0].imageUrl,
    "https://cdn.example.test/shot-1.png",
    "partial selected-shot saves must preserve omitted formal media",
  );
  assert.equal(savedSelectedShotEpisode.scenes[0].manualStoryboard.boards[0].prompt.length, 20_000);
  assert.equal(
    savedSelectedShotEpisode.productionTeam.outputs[0].content,
    "Unit direction",
    "partial workspace saves must restore omitted department unit plans",
  );
  assert.equal(
    savedSelectedShotEpisode.productionTeam.outputs[0].audit.promptHash,
    "prompt-1",
    "partial workspace saves must restore the full department audit",
  );
  assert.equal(
    savedSelectedShotEpisode.productionTeam.outputs[0].scenePlans[0].summary,
    "Current scene direction",
  );
  assert.equal(
    savedSelectedShotEpisode.productionTeam.outputs[0].scenePlans[1].summary,
    heavyScenePlanText,
    "partial workspace saves must restore inactive department scene-plan bodies",
  );
  assert.equal(
    savedSelectedShotEpisode.productionTeam.outputs[0].qa.coverage.evidence,
    heavyScenePlanText,
    "partial workspace saves must restore omitted department QA evidence",
  );
  const fullPreparationEpisode = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "production-preparation",
    undefined,
    undefined,
    true,
  );
  const scopedPreparationEpisode = dbHelpers.getEpisodeById(
    "project-scoped-read",
    "episode-1",
    "production-preparation",
    "scene-1",
  );
  assert.equal(scopedPreparationEpisode.__workspaceSceneScope, "scene-1");
  assert.equal(scopedPreparationEpisode.scenes[1].__workspaceSceneSummary, true);
  assert.equal(scopedPreparationEpisode.scenes[1].productionPreparation.breakdown.status, "confirmed");
  assert.equal(
    productionAssetDepartmentOutputSourceHash(scopedPreparationEpisode.productionTeam.outputs[0]),
    productionAssetDepartmentOutputSourceHash(fullPreparationEpisode.productionTeam.outputs[0]),
    "scene-scoped preparation responses must preserve the authoritative department source hash",
  );
  assert.equal(
    buildProductionAssetPreparationContext(productionProjectShell, [scopedPreparationEpisode]).sourceHash,
    buildProductionAssetPreparationContext(fullProjectShell, [fullPreparationEpisode]).sourceHash,
    "returning from asset governance to one preparation scene must not invalidate the accepted semantic batch",
  );

  scopedEpisode.scenes[0].description = "Updated first scene";
  dbHelpers.updateEpisode("project-scoped-read", "episode-1", scopedEpisode);
  const savedEpisode = dbHelpers.getEpisodeById("project-scoped-read", "episode-1");
  assert.equal(savedEpisode.scenes.length, 2);
  assert.equal(savedEpisode.scenes[0].description, "Updated first scene");
  assert.equal(savedEpisode.scenes[1].description, "Second scene");
  assert.equal(savedEpisode.scenes[1].manualStoryboard.boards[0].prompt.length, 20_000);
} finally {
  db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}

console.log("production route lazy-loading and scoped Storyboard read guards passed; browser timings are validated separately");
