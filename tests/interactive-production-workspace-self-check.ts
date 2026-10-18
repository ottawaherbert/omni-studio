import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const app = read('src/App.tsx');
const workspace = read('src/pages/InteractiveProductionWorkspace.tsx');
const graphWorkspace = read('src/pages/InteractiveGraphWorkspace.tsx');
const playtest = read('src/pages/InteractivePlaytestPlayer.tsx');
const writing = read('apps/web/src/features/script/ScriptWorkspace.tsx');
const preparation = read('src/pages/ProductionPreparation.tsx');
const storyboard = read('src/pages/Storyboard.tsx');
const studio = read('src/pages/Studio.tsx');
const layout = read('src/components/Layout.tsx');
const sourceOverview = read('src/components/production/preparation/ProductionSourceOverviewWorkspace.tsx');
const productionPrompts = read('src/config/prompts/productionTeam.ts');

assert.ok(app.includes('interactive/experiences/:experienceId/production'), 'Interactive production workspace route must exist');
assert.ok(
  workspace.includes('interactiveClient.listWritingScenes(experienceId, activeNodeId)'),
  'Production workspace must resolve only the selected node shared Writing scenes',
);
assert.ok(workspace.includes("aggregate?.bindings.find((binding) => binding.nodeId === activeNode?.id && binding.slot === 'main')"), 'Production workspace must read authoritative aggregate bindings, not stale graph-node copies');
assert.ok(workspace.includes('bindingScriptSceneRefs(binding).flatMap'), 'Shared script handoff must preserve every ordered scene version checksum and its explicit playback order');
assert.ok(workspace.includes('activeScenes.map'), 'Production workspace must show every Writing scene assigned to the active node');
assert.ok(workspace.includes('按以上顺序播放'), 'Production workspace must explain multi-scene playback order in creator-facing language');
assert.ok(workspace.includes('buildInteractiveStoryUnits'), 'Production workspace must group nodes by the same author-facing chapters as the whiteboard');
assert.ok(workspace.includes('scene.scriptBlocks'), 'Production workspace must render the exact bound scene blocks from the immutable Writing reference');
assert.ok(workspace.includes('查看绑定剧本交付快照'), 'Production workspace must distinguish fixed delivery from the current author draft');
assert.ok(workspace.includes('编辑剧本当前稿'), 'Production workspace must label navigation to the mutable author draft');
assert.ok(workspace.includes('开始制作画面'), 'Production workspace must expose a real production-workspace handoff');
assert.ok(workspace.includes('ensureProductionPrepTarget(experienceId)'), 'Production workspace must create/reuse the shared preparation target through the Interactive port');
assert.ok(workspace.includes('target.nodeTargets?.find'), 'Shared preparation handoff must resolve the active interactive node instead of always opening the first production unit');
assert.ok(workspace.includes("params.set('episodeId', nodeTarget.productionEpisodeId)"), 'Shared preparation handoff must carry the exact node source unit in the URL');
assert.ok(workspace.includes('nodeTarget.productionSceneIds.length === 1'), 'Shared preparation handoff must open an exact adopted scene only when the node has one unambiguous scene mapping');
assert.ok(workspace.includes("searchParams.get('nodeId')"), 'Interactive production return routes must restore the node that opened the shared workspace');
assert.ok(workspace.includes('const productionReturnTo ='), 'Interactive production handoffs must preserve the active node in their return target');
assert.ok(workspace.includes('listProductionMediaTakes(experienceId, activeNodeId)'), 'Production workspace must read only selected takes from the shared production port');
assert.ok(workspace.includes('getLatestRuntimeBuild(experienceId)'), 'Production workspace must only expose content-path preview after reading the persisted runtime build');
assert.ok(workspace.includes("runtimeReady ? '用成片试玩' : '用剧本试玩'"), 'Production workspace must make the full game playable before media is available');
assert.ok(workspace.includes('画面未完成时也可以先验证故事选择'), 'Production workspace must keep the story path testable while media is unfinished');
assert.ok(workspace.includes('确认这些画面用于当前节点'), 'Production workspace must expose an explicit author action to confirm selected media');
assert.equal(workspace.includes('const contentReady = productionNodes.length'), false, 'One source-review recommendation must not replace the entire Production workspace');
assert.ok(workspace.includes('disabled={isOpeningPreparation || !activeContentReady}'), 'Only the affected node production action should pause while its script needs review');
assert.ok(
  workspace.includes('candidate.nodeId === activeNode?.id && candidate.isCurrentForNode')
    && workspace.includes(': await interactiveClient.ensureProductionPrepTarget(experienceId)'),
  'Production must reuse an existing target only for an active node whose exact source is still current',
);
assert.ok(workspace.includes('mediaFitReview'), 'Production workspace must record an explicit author review when adopting shared media takes');
assert.ok(workspace.includes('找到 {mediaTakes.length} 个可用版本'), 'Production workspace must describe available media alternatives in creator-facing language');
assert.ok(workspace.includes('const plan = await interactiveClient.createMediaPlan(experienceId)'), 'Node media confirmation must reuse the server plan instead of adopting every alternative');
assert.equal(workspace.includes('const refs = mediaTakes.map((take) => take.ref)'), false, 'Alternate takes for one Shot must not be sequenced as separate story clips');
assert.equal(workspace.includes('saveGraph('), false, 'Production workspace must not edit the narrative graph');
const manualMappingSection = graphWorkspace.slice(
  graphWorkspace.indexOf('const handleMapWritingContent = async'),
  graphWorkspace.indexOf('const handleOpenContentMapping = async'),
);
assert.ok(manualMappingSection.includes("const existing = bindings.find"), 'Manual script review must load the node\'s current binding');
assert.ok(manualMappingSection.includes('saveScriptBindings'), 'Manual script review must use a script-only command that cannot replace media');
assert.ok(manualMappingSection.includes('versionIndex: existing?.versionIndex'), 'Manual script review must send the binding version for conflict protection');
assert.ok(playtest.includes('createRuntimeBuild(experienceId)'), 'Player must create an immutable run from confirmed current content');
assert.ok(playtest.includes('runtimeBuild?.graphSnapshot'), 'Player must read the run snapshot rather than the mutable authoring graph');
assert.ok(playtest.includes('dramaticFunctionLabels'), 'Playtest must not expose internal dramatic-function enum identifiers to authors');
const draftReview = read('src/components/interactive/whiteboard/InteractiveGraphDraftReview.tsx');
assert.ok(draftReview.includes('onAdopt'), 'Whiteboard proposal review must make the adoption action explicit to authors');
assert.ok(draftReview.includes('onRequestRevision'), 'Whiteboard proposal review must let authors request AI revisions with natural language feedback');
assert.ok(writing.includes('返回并绑定此剧本'), 'Writing must expose an explicit return and binding action');
assert.ok(writing.includes("params.get('returnTo')"), 'Writing must preserve the return context through project selection and creation');
assert.ok(preparation.includes('isRequestedProjectPending'), 'Shared preparation must wait for the URL-selected project before normalizing its route');
assert.ok(
  preparation.includes('loadProject(queryProjectId, {')
    && preparation.includes('episodeView: "production-preparation"')
    && preparation.includes('sceneId: querySceneId || undefined'),
  'Shared preparation deep links must load their target project and current scene through the focused preparation read model',
);
assert.ok(preparation.includes('navigate(`/production/storyboard?${new URLSearchParams({ projectId: currentProject!.id, episodeId: activeEpisode.id, sceneId: activeScene.id'), 'Preparation-to-storyboard navigation must preserve the exact shared project scope');
assert.ok(preparation.includes("...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {})"), 'Shared preparation exits must preserve the Interactive return target');
assert.ok(preparation.includes('isResolvingEpisodes'), 'Shared preparation must wait for the target project\'s episode records before normalizing a deep link');
assert.ok(preparation.includes('productionEpisodes.some((episode) => episode.id === activeEpisode.id)'), 'Shared preparation must reject a stale active episode while switching projects');
assert.ok(layout.includes('productionWorkspaceHref'), 'Production navigation must preserve the current project scope when moving between preparation, storyboard and studio');
assert.ok(storyboard.includes('loadProject(queryProjectId, {'), 'Storyboard deep links must load their requested production project instead of using whichever project was active before navigation');
assert.ok(
  storyboard.includes('episodeView: isDirectorProductionRoute ? storyboardEpisodeView : undefined')
    && storyboard.includes('const storyboardEpisodeView = "storyboard" as const'),
  'Shared storyboard should load the complete current scene so every Shot card can render without loading full episode audit history',
);
assert.ok(
  storyboard.includes('buildStoryboardBatchSceneReadModel({')
    && storyboard.includes('scene: activeScene'),
  'Storyboard status must stay scoped to the current scene instead of exposing cross-scene batch work',
);
assert.ok(storyboard.includes('urlSceneId'), 'Storyboard must honor the preparation scene context carried in the URL');
assert.ok(storyboard.includes('interactiveReturnTo'), 'Storyboard must preserve an Interactive return target instead of trapping authors in the shared workspace');
assert.ok(storyboard.includes('镜头故事板草案已可审阅'), 'Storyboard mode must expose a model-free draft from an existing shot plan without requiring per-shot images');
assert.ok(storyboard.includes('建立视频单元结构') && storyboard.includes('建立单元并生成画面'), 'Storyboard mode must separate video-unit structure from the image-prompt-backed visual follow-up');
assert.equal(storyboard.includes('分镜与提示词检查'), false, 'Storyboard must not expose internal dependency repair to creators');
assert.ok(
  read('src/components/storyboard/ShotCard.tsx').includes('rebaseManualStoryboardAfterAuthorEdit'),
  'An explicit Shot-card save must confirm only the layer the author actually changed',
);
assert.ok(studio.includes('loadProject(queryProjectId, {'), 'Studio deep links must load their requested production project instead of relying on prior workspace state');
assert.ok(
  studio.includes('episodeView: isDirectorProductionRoute ? studioEpisodeView : undefined')
    && studio.includes('"storyboard-index"'),
  'Shared Studio should load its focused scene/shot read model instead of the full episode audit history',
);
assert.ok(studio.includes('interactiveReturnTo'), 'Studio must preserve an Interactive return target instead of trapping authors in the shared workspace');
assert.ok(studio.includes('返回互动制片'), 'Shared Studio must expose a contextual return action only for Interactive handoffs');
assert.equal(studio.includes('摄影棚尚未解锁'), false, 'Missing media references must not claim that the inspectable Studio workspace is locked');
assert.ok(studio.includes('媒体生成暂不可用'), 'Studio should scope missing-reference guidance to media generation');
assert.ok(/productionPreparationGate\.readyForShotPlanning\s*&& productionPreparationGate\.assetPackConfirmed\s*&& productionPreparationGate\.coordinationConfirmed\s*\? "媒体生成暂不可用"/.test(studio), 'Studio should scope confirmed-preparation warnings to media generation rather than mark preparation incomplete');
assert.ok(sourceOverview.includes('interactiveProductionPrepProfile'), 'Shared preparation overview must expose interactive planning context without a second production editor');
assert.ok(read('src/components/storyboard/StoryboardHeader.tsx').includes('返回互动制片'), 'Shared storyboard must expose a contextual return action only for Interactive handoffs');
assert.ok(sourceOverview.includes('互动路径约束 · 本剧本单元'), 'Shared preparation overview must explain the node path and state constraints for the active source unit');
assert.ok(sourceOverview.includes('interactivePlanningContext'), 'Shared preparation scene planning must inject the active interactive contract into the prompt variables');
assert.ok(sourceOverview.includes('candidateHasCompleteInteractiveCoverage'), 'Interactive scene-plan adoption must reject candidates that drop a locked node');
assert.ok(sourceOverview.includes('interactiveNodeIds'), 'Adopted shared production scenes must retain their locked interactive node references');
assert.equal(sourceOverview.includes('导入场次草案'), false, 'Shared preparation must use the configured AI workflow instead of external scene-plan writeback');
assert.equal(sourceOverview.includes('可复制互动节点引用'), false, 'Shared preparation must not expose JSON-only node reference tooling');
assert.equal(sourceOverview.includes('copyInteractiveNodeReference'), false, 'Shared preparation must not expose an external mapping helper');
assert.ok(productionPrompts.includes('【互动路径、选择与状态合同（只读）】'), 'Scene-plan prompts must carry the shared interactive constraints into generation and QA');
assert.ok(productionPrompts.includes('"interactiveNodeIds"'), 'Scene-plan prompts must require structured interactive node coverage rather than leaving it in prose');

console.log('Interactive production workspace self-check passed.');
