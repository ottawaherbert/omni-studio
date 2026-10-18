import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const app = read('src/App.tsx');
const library = read('src/pages/InteractiveProduction.tsx');
const wizard = read('src/pages/NewInteractiveProjectWizard.tsx');
const authoringClient = read('apps/web/src/clients/interactiveAuthoringClient.ts');
const productionClient = read('apps/web/src/clients/interactiveProductionClient.ts');
const interactivePrompts = read('src/config/prompts/interactive.ts');
const narrativeNodeCard = read('src/components/interactive/whiteboard/InteractiveNarrativeNodeCard.tsx');
const graphWorkspace = read('src/pages/InteractiveGraphWorkspace.tsx');
const mediaPlanReview = read('src/components/interactive/whiteboard/InteractiveMediaPlanReview.tsx');
const graph = graphWorkspace
  + read('src/components/interactive/whiteboard/InteractiveWhiteboardHeader.tsx')
  + narrativeNodeCard
  + read('src/components/interactive/whiteboard/InteractiveChoiceEdge.tsx')
  + read('src/components/interactive/whiteboard/InteractiveNodeInspector.tsx')
  + read('src/components/interactive/whiteboard/InteractiveChoiceInspector.tsx')
  + read('src/components/interactive/whiteboard/InteractiveAiDrawer.tsx')
  + read('src/components/interactive/whiteboard/InteractiveGraphDraftReview.tsx')
  + read('src/components/interactive/whiteboard/InteractiveContentPlanReview.tsx')
  + read('src/components/interactive/whiteboard/InteractiveProductionPlanReview.tsx')
  + read('src/components/interactive/whiteboard/InteractiveMediaPlanReview.tsx')
  + read('src/components/interactive/whiteboard/InteractiveStoryUnitSwitcher.tsx')
  + read('src/components/interactive/whiteboard/InteractivePathDrawer.tsx');
const graphInitialLoadStart = graphWorkspace.indexOf('// Load experience aggregate & layout');
const graphInitialLoad = graphWorkspace.slice(
  graphInitialLoadStart,
  graphWorkspace.indexOf('\n\n  useEffect(() => {', graphInitialLoadStart + 1),
);
const graphCanvas = read('src/components/interactive/InteractiveGraphCanvas.tsx');
const authoringProjection = read('src/services/interactive/interactiveAuthoringStatusProjection.ts')
  + read('src/server/interactiveWritingPort.ts');
const interactiveRoutes = read('src/server/routes/interactiveRoutes.ts');
const interactiveRepository = read('src/server/interactiveRepository.ts');
const production = read('src/pages/InteractiveProductionWorkspace.tsx');
const studioCreatorLanguage = read('src/components/StudioPreview.tsx')
  + read('src/components/StudioReferenceControlPanel.tsx')
  + read('src/components/StudioShotControls.tsx')
  + read('src/hooks/useManualStudioAI.ts');
const playtest = read('src/pages/InteractivePlaytestPlayer.tsx');
const storyboard = read('src/pages/Storyboard.tsx');
const productionPreparation = read('src/pages/ProductionPreparation.tsx');
const promptEditor = read('src/components/PromptEditorModal.tsx');
const storyboardWorkflow = read('src/hooks/useStoryboardAI.ts')
  + read('src/components/storyboard/StoryboardHeader.tsx');
const departmentBoards = read('src/components/storyboard/DepartmentBoardsPanel.tsx');
const creatorFacingAiError = read('src/features/interactive/creatorFacingAiError.ts');
const productionBudgetBoundary = read('src/types/production.ts')
  + read('src/services/production/productionGenerationPlanningStageRunner.ts')
  + read('src/services/production/gates.ts')
  + read('src/config/formatProductionProfiles.ts');

for (const route of [
  'path="interactive" element={<InteractiveProduction />}',
  'path="interactive/new" element={<NewInteractiveProjectWizard />}',
  'path="interactive/experiences/:experienceId/graph" element={<InteractiveGraphWorkspace />}',
  'path="interactive/experiences/:experienceId/bindings" element={<Navigate to="../graph" replace />}',
  'path="interactive/experiences/:experienceId/production" element={<InteractiveProductionWorkspace />}',
  'path="interactive/experiences/:experienceId/playtest" element={<InteractivePlaytestPlayer />}',
]) assert.ok(app.includes(route), `Missing current interactive route: ${route}`);

assert.equal(app.includes('interactive/experiences/:experienceId/overview'), false, 'Deleted overview route must not reappear');
assert.equal(app.includes('interactive/experiences/:experienceId/state'), false, 'Deleted state route must not reappear');
assert.equal(app.includes('interactive/experiences/:experienceId/architecture'), false, 'Deleted architecture route must not reappear');
assert.equal(app.includes('interactive/episodes/:episodeId/game-editor'), false, 'Deleted legacy GameEditor routes must not reappear');
assert.equal(app.includes('interactive/episodes/:episodeId/node-script/:nodeId'), false, 'Deleted legacy node-script routes must not reappear');
assert.ok(library.includes("navigate('/interactive/new')"), 'Interactive library must start creation in the independent wizard');
assert.ok(wizard.includes('interactiveClient.createExperience'), 'Wizard must persist an interactive aggregate through the domain API');
assert.ok(wizard.includes("action: 'initial'"), 'New project creation must automatically request its first AI-authored proposal');
assert.ok(wizard.includes('<PromptEditorModal'), 'New project AI creation must open the shared prompt editor before calling the model');
assert.ok(wizard.includes('templateId="interactiveCreateFirstDraft"'), 'New project creation must use an editable interactive prompt template');
assert.ok(wizard.includes('authorIntent: finalPrompt'), 'The confirmed prompt must be the instruction sent to graph authoring');
assert.ok(
  wizard.includes('createExperience(experienceInput(finalPrompt))')
    && wizard.includes('authoringPrompt: authoringPrompt?.trim() || undefined'),
  'The confirmed prompt must persist with the interactive creation request',
);
assert.equal(interactiveRoutes.includes('resumePersistedWritingTask'), false, 'Retired screenplay generation must not be resumed by interactive polling');
assert.equal(wizard.includes('使用外部 Agent 方案创建'), false, 'New project creation must use the configured AI workflow');
assert.equal(wizard.includes('buildNarrativeGraphFromExternalPlan'), false, 'New project creation must not expose external graph writeback');
assert.ok(wizard.includes("id: 'feature'"), 'New projects must offer an author-facing feature-length scale');
assert.equal(
  wizard.includes("id: 'epic'"),
  false,
  'The wizard must not advertise a six-hour one-call graph until staged long-form generation is implemented',
);
assert.equal(wizard.includes('targetSessionMinutes: 6'), false, 'New projects must not silently force every story into a six-minute demo');
assert.equal(wizard.includes('targetCompleteMinutes: 9'), false, 'New projects must not silently force full exploration into a nine-minute demo');
assert.ok(wizard.includes('experienceScale'), 'The selected production scale must feed the persisted duration contract and AI prompt');
assert.ok(wizard.includes('draft.id'), 'The first AI proposal must open directly in review after project creation');
assert.equal(authoringClient.includes('45_000'), false, 'AI proposal requests must wait for the provider result instead of inventing a timeout');
assert.ok(authoringClient.includes('getLatestDraft'), 'A persisted Graph proposal must remain recoverable after page refresh');
assert.equal(wizard.includes('setStep('), false, 'New project creation must not force authors through a multi-step configuration flow');
assert.ok(wizard.includes('告诉 AI 你想做什么'), 'New project creation must start from an author brief instead of technical parameters');
assert.ok(wizard.includes('interactiveClient.listWritingProjects'), 'Wizard must offer a shared Writing source instead of duplicating a script editor');
assert.ok(graph.includes('interactiveClient.saveGraph'), 'Story map must persist graph edits through the domain API');
assert.ok(
  graph.includes("interactiveClient.saveGraph(experienceId, pending, 'draft', pending.versionIndex)"),
  'Story map saves must send the graph revision they edited so concurrent writes cannot overwrite newer work',
);
assert.ok(graph.includes('来源有更新'), 'The whiteboard must show a focused source-review recommendation without revoking adopted content');
assert.ok(production.includes('已采用结果仍保留，建议复核当前节点'), 'Interactive Production must expose non-destructive review recommendations');
assert.ok(playtest.includes('来源有更新 · 历史试玩快照'), 'The player must label a preserved Runtime Build when newer source decisions exist');
assert.ok(
  graphWorkspace.includes('interactiveClient.getWhiteboardExperience(experienceId)')
    && productionClient.includes('?view=whiteboard')
    && productionClient.includes('normalizeNarrativeGraph(aggregate.graph)')
    && interactiveRoutes.includes("req.query.view !== 'whiteboard'")
    && interactiveRoutes.includes('nodes: aggregate.graph.nodes.map((node) => ({ ...node, choices: [] }))')
    && interactiveRoutes.includes('bindings: aggregate.bindings,')
    && graphWorkspace.includes('interactiveClient.saveScriptBindings(experienceId, reviewedBindings)')
    && interactiveRepository.includes('saveScriptBindings(')
    && interactiveRepository.includes('binding.versionIndex !== existingBinding.versionIndex'),
  'The whiteboard must load complete versioned bindings and submit script-only changes with conflict protection',
);
assert.ok(graph.includes('interactiveClient.getGraphLayout'), 'Story map must load authoring layout separately from semantic graph data');
assert.ok(graph.includes('interactiveClient.saveGraphLayout'), 'Story map must persist card movement through the layout API');
assert.ok(graph.includes('key={selectedNode.id}'), 'Switching nodes must remount the editor so local form state cannot leak from the previous node');
assert.ok(graph.includes('<InteractiveGraphCanvas'), 'Story map must render a real graph canvas rather than a card grid');
assert.ok(
  graphWorkspace.includes('mappedScreenplayNodeCount={mappedScreenplayNodeCount}')
    && graph.includes('剧本已映射 ${mappedScreenplayNodeCount}/${requiredScreenplayNodeCount}，待补场次时长'),
  'Mapped screenplay nodes without source duration metadata must not be reported as unmapped',
);
assert.equal(graph.includes('创作范围'), false, 'The author-facing whiteboard must not expose internal Production Block scope controls');
assert.ok(graph.includes('storyChapters'), 'Whiteboard chapter switching must use the author-facing story hierarchy');
assert.equal(
  read('src/domains/interactive/structure/storyUnits.ts').includes('const blocks = architecture.productionBlocks'),
  false,
  'Whiteboard chapters must not be projected directly from Production Blocks',
);
assert.ok(production.includes('productionNodeGroups'), 'Interactive Production must retain the same story chapter grouping as the whiteboard');
assert.ok(
  production.includes('listWritingScenes(experienceId, activeNodeId)')
    && productionClient.includes('?nodeId=${encodeURIComponent(nodeId)}')
    && interactiveRoutes.includes("typeof req.query.nodeId === 'string'")
    && interactiveRoutes.includes('requireWritingPort().resolveScene(ref)'),
  'Interactive Production must load only the selected node script scenes instead of downloading the whole Writing project',
);
assert.ok(
  graph.includes('interactiveClient.listWritingSceneSummaries(experienceId)')
    && productionClient.includes("'/writing-scenes')}?view=summary")
    && interactiveRoutes.includes("req.query.view !== 'summary'")
    && interactiveRoutes.includes('scriptBlocks: undefined'),
  'The whiteboard scene catalog must omit full screenplay blocks from its initial payload',
);
for (const deferredProposalRead of [
  'interactiveClient.getLatestContentPlan(experienceId)',
  'interactiveClient.getLatestProductionPlan(experienceId)',
  'interactiveClient.getLatestMediaPlan(experienceId)',
]) {
  assert.equal(
    graphInitialLoad.includes(deferredProposalRead),
    false,
    `The whiteboard must defer inactive proposal payloads until the author opens them: ${deferredProposalRead}`,
  );
}
assert.ok(
  graph.includes("status.content.state === 'working'"),
  'The whiteboard must keep polling while AI content planning is actively running',
);
assert.ok(graphCanvas.includes('<ReactFlow'), 'Graph canvas must use the shared XYFlow implementation');
assert.ok(graphCanvas.includes('onConnect'), 'Graph canvas must let authors create a semantic edge by connecting nodes');
assert.equal(narrativeNodeCard.includes('Position.Top'), false, 'A story node must not expose a second input handle');
assert.equal(narrativeNodeCard.includes('Position.Bottom'), false, 'A story node must not expose a second output handle');
assert.ok(narrativeNodeCard.includes('position={Position.Left} title="输入"'), 'A story node must expose one left-side input');
assert.ok(narrativeNodeCard.includes('position={Position.Right} title="输出"'), 'A story node must expose one right-side output');
assert.ok(graphCanvas.includes('拖动只整理画布'), 'Graph canvas must explain that layout movement does not mutate story semantics');
assert.ok(graphCanvas.includes('这个范围还没有可编辑节点'), 'An empty Block scope must explain the next author action instead of showing a blank canvas');
assert.ok(graph.includes('!nodeRequiresMainContent(node)'), 'Pure routing and checkpoint nodes must use the compact system-node card');
assert.ok(graph.includes('自动衔接'), 'Compact system nodes must use creator-facing automatic-transition language');
assert.ok(graph.includes('节点内容'), 'Story map must offer a direct author handoff into node content');
assert.ok(graph.includes('让 AI 安排节点内容'), 'Story map must present node content as a full-graph AI planning action');
assert.ok(graph.includes('/writing?'), 'Node content must open the shared AI Writing capability instead of a removed binding page');
assert.ok(graph.includes('interactiveClient.createContentPlan'), 'Whiteboard must ask AI for one reviewable full-graph content plan');
assert.ok(graph.includes('<PromptEditorModal'), 'Whiteboard AI actions must reuse the shared prompt editor');
for (const confirmedExecution of [
  'executeGenerateAiDraft(params, finalPrompt)',
  'createContentPlan(experienceId, finalPrompt)',
  'reviseContentPlan(experienceId, draftId, finalPrompt)',
  'requestMediaPlanRevision(',
]) {
  assert.ok(
    graph.includes(confirmedExecution),
    `Interactive AI execution must remain behind the shared prompt editor: ${confirmedExecution}`,
  );
}
for (const templateId of [
  'interactiveCreateFirstDraft',
  'interactiveGraphAuthoring',
  'interactiveContentPlanning',
  'interactiveMediaRevision',
  'interactiveVisualRefinement',
]) {
  assert.ok(interactivePrompts.includes(`'${templateId}'`), `Missing interactive prompt template: ${templateId}`);
}
assert.ok(graph.includes('authorIntent: finalPrompt'), 'Graph generation must send the prompt confirmed by the author');
assert.ok(graph.includes('createContentPlan(experienceId, finalPrompt)'), 'Content planning must send the prompt confirmed by the author');
assert.ok(graph.includes('reviseContentPlan(experienceId, draftId, finalPrompt)'), 'Content-plan revision must send the prompt confirmed by the author');
assert.ok(graph.includes('nodeId,\n            finalPrompt,'), 'Media revision must send the prompt confirmed by the author');
assert.ok(graph.includes('interactiveClient.adoptContentPlan'), 'Whiteboard must adopt the plan through one server command instead of looping over bindings');
assert.ok(graph.includes('await refreshAuthoringStatus()'), 'Adopting a domain proposal must refresh the creator-facing next action');
assert.ok(graph.includes('setContentPlanCandidate(null)'), 'Adopting a new graph must close downstream candidates that the server has made stale');
assert.equal(graph.includes('interactiveClient.recommendNodeContent'), false, 'The old one-node/one-scene recommendation path must stay deleted');
assert.equal(graph.includes('interactiveClient.saveBinding('), false, 'The whiteboard must not persist bindings one node at a time');
assert.ok(graph.includes('interactiveClient.saveScriptBindings'), 'A reviewed external content map must be adopted as one script-only batch decision');
assert.ok(interactiveRoutes.includes('/bindings/script'), 'Script mapping must be validated by a dedicated domain route');
assert.ok(graph.includes('采用整套内容方案'), 'The author must be able to adopt the reviewed content plan as one decision');
assert.ok(graph.includes('告诉 AI 哪里要调整'), 'Content plan review must support natural-language revision feedback');
assert.ok(graph.includes('想改节点或选择？和 AI 讨论故事'), 'A pending content plan must not hide the natural-language story revision entry');
assert.ok(graph.includes('个制片场次'), 'A Writing/content change must show its downstream Production scope before adoption');
assert.equal(graph.includes('创作推进方式'), false, 'Whiteboard must not ask authors to manage an execution policy');
assert.equal(graph.includes('暂停自动推进'), false, 'Whiteboard must not add a technical authoring pause control');
assert.equal(wizard.includes('AI 怎么推进'), false, 'Project creation must not ask authors to choose an internal execution policy');
for (const owner of ['interactive_graph', 'content_plan', 'production', 'runtime']) {
  assert.ok(
    interactiveRoutes.includes(`owner: '${owner}'`),
    `Authoring coordination must retain a lightweight ${owner} task reference`,
  );
}
assert.ok(graph.includes('creatorFacingInteractiveAiError'), 'Interactive AI failures must be translated before they reach the author');
assert.ok(wizard.includes('creatorFacingInteractiveAiError'), 'Initial creation failures must use the same creator-facing error translation');
assert.ok(creatorFacingAiError.includes('insufficient balance'), 'Provider balance failures must have an explicit creator-facing fallback');
assert.ok(interactiveRoutes.includes('/tasks/:taskId/cancel'), 'Independent interactive tasks must expose persisted cancellation');
assert.ok(interactiveRoutes.includes('/tasks/:taskId/retry'), 'Independent interactive tasks must expose local retry');
assert.ok(authoringProjection.includes('已有可供互动节点采用的剧本场次'), 'Writing readiness must be described in creator-facing language');
assert.ok(
  authoringProjection.includes('const writing: InteractiveWritingGenerationStatus = allContentReady'),
  'Approved exact node content must outrank a missing Writing Agent job in creator-facing status',
);
assert.ok(graph.includes('采用制片方案'), 'Whiteboard must review and adopt one complete production scene plan');
assert.equal(graph.includes('采用当前全部方案'), false, 'A single Production candidate must not show a second equivalent adoption action');
assert.ok(interactiveRoutes.includes('/proposal-bundles/adopt-compatible'), 'The optional compatible batch adoption command must remain available at the server boundary');
assert.ok(graph.includes("latestProductionPlan?.status === 'adopted'"), 'An adopted Production plan must advance to media review instead of creating a duplicate plan');
assert.ok(interactiveRoutes.includes('pendingProposalAdoptions(run)'), 'A repeated batch command must resume only failed or unfinished proposal items');
assert.ok(interactiveRoutes.includes("coordination.executionPolicy === 'autopilot'"), 'Autopilot must continue into Production planning after content adoption');
assert.ok(graph.includes('result.productionPlan'), 'An automatically prepared Production candidate must open for author review without another setup click');
assert.ok(graph.includes('还有画面需要制作'), 'Whiteboard must surface missing media instead of pretending production is complete');
assert.ok(graph.includes('采用全部画面'), 'Whiteboard must support one server-side batch adoption action when approved media exists');
assert.ok(graph.includes('让 AI 按意见重做这段'), 'A media plan must accept natural-language feedback for one node');
assert.ok(graph.includes('requestMediaPlanRevision'), 'Node media feedback must use one persisted server command');
assert.ok(mediaPlanReview.includes("selection.scenarioId || 'default'"), 'Multi-state media review rows must have scenario-scoped identities');
assert.ok(mediaPlanReview.includes('selection.scenarioLabel'), 'Media review must identify the visual state being reviewed');
assert.ok(
  mediaPlanReview.includes('missingScenarioCount === 0') && mediaPlanReview.includes('missingSlotCount === 0'),
  'Media review must not claim a plan is adoptable while a state or playback slot is missing',
);
assert.ok(
  graphWorkspace.includes('handleRequestMediaRevision(nodeId, feedback, scenarioId)'),
  'Media feedback must retain the selected visual-state scope through the page handler',
);
assert.ok(production.includes('你从白板提出的调整'), 'Node media feedback must follow the author into the exact Production context');
assert.equal(
  production.includes('const refs = mediaTakes.map((take) => take.ref)'),
  false,
  'Interactive Production must not silently sequence every alternate take for a Shot',
);
assert.ok(
  production.includes('const plan = await interactiveClient.createMediaPlan(experienceId)'),
  'Direct node confirmation must reuse the server media-selection policy',
);
assert.equal(storyboardWorkflow.includes('externalAgent'), false, 'Storyboard must not retain external Agent import templates');
assert.equal(
  /成本单位|预算授权|生成授权|昂贵生成|付费前停下/.test(`${wizard}\n${graph}\n${production}\n${studioCreatorLanguage}`),
  false,
  'Creator-facing interactive and production UI must not expose spend budgets or generation authorization',
);
for (const retiredBudgetContract of [
  'allowExpensiveGeneration',
  'costCeiling',
  'estimatedCostUnits',
  'approvalRequired',
  'requiresHumanApprovalBeforeGeneration',
  'ProductionSpendAuthorization',
]) {
  assert.equal(
    productionBudgetBoundary.includes(retiredBudgetContract),
    false,
    `Removed production budget contract must stay deleted: ${retiredBudgetContract}`,
  );
}
assert.equal(production.includes('视频 take'), false, 'Interactive Production must call selected media videos, not expose Take terminology');
assert.equal(studioCreatorLanguage.includes('>TAKES<'), false, 'Studio media choices must use creator-facing labels');
assert.equal(studioCreatorLanguage.includes('图片 Take'), false, 'Studio prompts must call the selected first-frame media an image');
assert.equal(studioCreatorLanguage.includes('视频 Take'), false, 'Studio completion messages must call generated media a video proposal');
assert.ok(graph.includes('hasUnsavedChanges && graph'), 'Content preparation must persist a newly added node before adopting its content');
assert.ok(graph.includes('限时选择'), 'Story map must let authors define timed choices instead of requiring database edits');
assert.ok(graph.includes('超时自动前往'), 'Story map must expose the explicit timeout fallback destination');
assert.ok(graph.includes('编辑玩家选择'), 'Selecting an edge must make its authoring context explicit');
assert.ok(graph.includes('creatorFacingGraphIssue'), 'Story map must translate validation details into creator-facing terms before rendering them');
assert.ok(graph.includes('qaIssueIds={qaResult?.issues.map'), 'Graph QA repair must pass exact issue IDs into the AI draft request');
assert.ok(graph.includes('issueIds: params.issueIds'), 'Graph AI draft requests must preserve the selected repair scope');
assert.ok(graph.includes('setGraph((current) =>'), 'Story map must append new nodes against the latest graph revision rather than a stale render snapshot');
assert.ok(graph.includes('setSelectedNodeId(newNode.id)'), 'A newly added node must become the active editing context');
assert.ok(graph.includes('canvasFitViewRef.current?.(newNode.id)'), 'A newly added node must be brought into the visible canvas');
assert.ok(graph.includes('互动白板'), 'The graph route must present itself as the interactive whiteboard rather than a step in a form flow');
assert.ok(graph.includes('制片工作台'), 'A selected node must open production as a contextual capability from the whiteboard');
assert.equal(graph.includes('InteractiveStateModal'), false, 'Authors must not be asked to configure a state schema from the whiteboard');
assert.ok(graph.includes('按这条意见重新生成方案'), 'Draft review must accept natural-language feedback before adoption');
assert.ok(graph.includes("graph.nodes.length === 0 ? 'initial' : 'revise'"), 'Whole-story feedback must revise the current graph instead of appending a duplicate island');
assert.equal(graph.includes('复杂条件和后果由 AI'), false, 'Choice editing must not explain technical state machinery to authors');
assert.ok(graph.includes("setSelectedChoiceId(choice.id)"), 'Adding a choice must focus its edge contract immediately');
assert.ok(
  graph.includes('nodeCapabilities(n)')
  && graph.includes("currentCapabilities.includes('present_choice')"),
  'Adding a choice must update the source node runtime contract without crashing legacy nodes',
);
assert.equal(graphCanvas.includes("' · 条件'"), false, 'Canvas edges must not expose AI-managed conditions');
assert.equal(graphCanvas.includes("' · 后果'"), false, 'Canvas edges must not expose AI-managed effects');
assert.ok(graph.includes('当前典型路线'), 'Story map must give authors a real path-duration summary before creating a preview');
assert.ok(graph.includes('InteractiveStoryUnitSwitcher'), 'Long-form story maps must switch between author-facing chapters instead of rendering every node at once');
assert.ok(graph.includes('visibleNodeIds={visibleNodeIds}'), 'The active chapter must scope the infinite canvas to its own nodes');
assert.ok(graph.includes("title.replace(/^第"), 'Chapter labels must not repeat the chapter number from imported titles');
assert.ok(graph.includes('全部独有内容'), 'Path preview must distinguish unique content volume from one playthrough');
assert.ok(
  graph.includes('目标单次')
  && graph.includes('当前路线')
  && graph.includes('当前剧本'),
  'Path duration must separate the author-confirmed target, current graph routes and mapped screenplay coverage',
);
assert.ok(graph.includes('onOpenWritingHandoff') || graph.includes('Writing'), 'Node content must lead authors to Writing creation or selection');
assert.ok(production.includes('ensureProductionPrepTarget(experienceId)'), 'Production must open the shared preparation port, not a duplicated editor');
assert.ok(production.includes('const productionReturnTo ='), 'Production handoff must retain the selected node for its return route');
assert.ok(production.includes('returnToWhiteboard'), 'Production must return to the selected whiteboard node when opened contextually');
assert.ok(playtest.includes('互动游戏试玩'), 'Playtest must present itself as a complete interactive game rather than a path inspection utility');
assert.ok(
  playtest.includes("const isMediaDecisionPending = runtimeBuild?.status === 'ready_for_player'")
    && playtest.includes('!isMediaDecisionPending\n    && (hasStoryMedia ? mediaFinished : storyFinished)')
    && playtest.includes('!hasStoryMedia && !isLoadingStory && !isMediaDecisionPending'),
  'A formal playtest must not expose story progression before its media manifest resolves',
);
assert.ok(playtest.includes('fixed inset-0 z-[1000]'), 'Playtest must be a full-screen game surface rather than a card inside the authoring shell');
assert.ok(playtest.includes('系统会自动整理当前故事并准备体验'), 'Playtest must explain run creation in creator-facing language');
assert.equal(playtest.includes('运行变量'), false, 'Playtest must not expose AI-managed variables');
assert.equal(playtest.includes('可验证的事实状态'), false, 'Playtest must not expose AI-managed fact state');
assert.ok(playtest.includes('补齐画面后即可完整播放'), 'Content preview must not pretend that a media player exists before approved media is assembled');
assert.ok(playtest.includes('剧本画面'), 'Playtest must explain its no-media presentation in creator-facing language');
assert.ok(
  playtest.includes('resetNodePlayback();\n    setCurrentNodeId(targetNodeId)')
    && playtest.includes('A legal loop may target the current node'),
  'Each path visit, including a self-loop, must replay node story and media from the beginning',
);
assert.ok(playtest.includes('开始试玩'), 'Playtest must let authors start a run after content confirmation');
assert.ok(playtest.includes('canCreatePreview'), 'Playtest must gate preview creation on current graph and confirmed bindings, not a project lock');
assert.equal(playtest.includes('runtime build'), false, 'Playtest must not expose runtime implementation terminology');
assert.ok(playtest.includes('interactiveClient.getRuntimeMediaManifest'), 'A media-ready runtime build must resolve shared media through the domain client');
assert.ok(playtest.includes('<video'), 'A media-ready runtime build must expose a real HTML video player instead of a fake playback card');
assert.ok(playtest.includes('<img'), 'A selected storyboard frame must remain playable as an image placeholder');
assert.ok(
  playtest.includes("clip.contentSlot !== 'choice_hold'")
    && playtest.includes("clip.contentSlot === 'choice_hold'")
    && playtest.includes('loop={isChoiceHoldPlaying}'),
  'The choice-waiting clip must loop only after the node story media finishes',
);
assert.ok(playtest.includes("hasPlayableMedia ? 'bg-black/30' : 'bg-bg-primary/40'"), 'Real video playback must retain a dark cinematic overlay in light mode');
assert.ok(playtest.includes('播放完毕后显示选择'), 'Interactive choices must wait for the selected node media to finish');
assert.equal(playtest.includes('共享视频 take'), false, 'Player UI must describe playback as story footage rather than a shared-take implementation');
assert.ok(playtest.includes('检查素材') && playtest.includes('navigate(productionHandoff)') && playtest.includes('?? currentNode?.id'), 'A failed media take must expose the relevant Production handoff while allowing clearly labeled text preview');
assert.ok(playtest.includes('effectiveMediaError && <section role="alert"') && playtest.includes('文字预览 · 画面不可用'), 'The actual media failure must stay visible rather than silently pretending the current view is a film');
assert.ok(playtest.includes('重试读取') && playtest.includes('用当前内容重新准备'), 'Media failures must expose both retrying the old build and explicitly creating a new build');
const playbackReset = playtest.slice(playtest.indexOf('const resetNodePlayback ='), playtest.indexOf('const unlockedChoices ='));
assert.equal(playbackReset.includes('setMediaLoadError(null)'), false, 'Restarting a path or receiving a delayed story response must not erase an unresolved media request failure');
assert.ok(playtest.includes('onError'), 'Player must react to an actual video loading failure');
assert.ok(playtest.includes('保存路径'), 'Player must let an author explicitly save a path checkpoint');
assert.ok(playtest.includes('恢复路径'), 'Player must expose a compatible saved path for restore');
assert.ok(playtest.includes('上次保存的路径对应旧内容'), 'Player must refuse to restore a checkpoint from an incompatible runtime version');
assert.ok(playtest.includes('请在限定时间内做出选择'), 'Player UI must expose a timed-choice state when the graph declares it');
assert.ok(playtest.includes('defaultTimeoutTargetNodeId'), 'Timed-choice fallback must come from the graph contract, not a page-local hardcode');
assert.ok(playtest.includes('productionHandoff'), 'A media-pending preview must return the author to the exact missing-media production node');
assert.ok(playtest.includes('interactiveClient.getRuntimeStoryManifest'), 'Media-pending playtest must resolve the exact frozen Writing scenes for every node');
assert.ok(playtest.includes('currentScene.scriptBlocks'), 'A no-media playtest must render the actual script instead of only the node summary');
assert.ok(playtest.includes('expectedPlayedSeconds'), 'The game HUD must expose the expected duration of the path being tested');
assert.ok(playtest.includes('playedNodes.length'), 'The game HUD and ending summary must expose the traversed node count');
assert.ok(playtest.includes("'下一场'"), 'A multi-scene node must remain playable in approved scene order');
assert.ok(interactiveRoutes.includes("'/api/interactive/experiences/:experienceId/runtime-story'"), 'The server must expose an exact-version story manifest for the game player');
assert.ok(interactiveRoutes.includes('resolveInteractiveRuntimeStory(build, port)') && read('src/server/interactiveRuntimeStory.ts').includes('port.resolveScene(ref)'), 'The shared story manifest must resolve frozen Writing references instead of reading mutable current scenes');
assert.ok(storyboard.includes('镜头故事板草案已可审阅'), 'Storyboard mode must expose a model-free storyboard draft from an existing Shot plan');
assert.ok(storyboard.includes('建立视频单元结构') && storyboard.includes('建立单元并生成画面'), 'Storyboard mode must separate unit structure from visual-board generation');
assert.ok(storyboard.includes('templateId="interactiveVisualRefinement"'), 'Interactive visual refinement must use the shared prompt editor before calling AI');
assert.ok(storyboard.includes('interactiveClient.createVisualRefinement'), 'Storyboard must persist an AI proposal instead of mutating the adopted visual state');
assert.ok(storyboard.includes('审阅 AI 画面方案'), 'AI environment and performance changes must be reviewed before adoption');
assert.ok(storyboard.includes('interactiveClient.adoptVisualRefinement'), 'Storyboard must adopt a reviewed visual proposal through the domain API');
assert.equal(storyboard.includes('visualProjectionFingerprint}'), false, 'Storyboard must not expose internal projection fingerprints to authors');
assert.ok(promptEditor.includes('flex-col overflow-hidden lg:flex-row'), 'Shared prompt editor must stack its panes on narrow screens');
assert.ok(promptEditor.includes("activeTab === 'template' && Object.keys(variables).length"), 'Prompt runtime variables must stay out of the ordinary author view');
assert.equal(storyboardWorkflow.includes('导入整段镜头结果'), false, 'Storyboard must not expose external batch writeback');
assert.ok(
  storyboardWorkflow.includes('validateStoryboardImagePromptContract')
    && storyboardWorkflow.includes('validateStoryboardVideoPromptContract'),
  'System-generated image and video prompts must pass their independent contracts',
);
assert.ok(
  storyboard.includes('batchScenes: []')
    && storyboard.includes('scenes: isDirectorProductionRoute ? storyboardAgentScenes : []'),
  'Storyboard AI actions must stay scoped to the current scene instead of exposing cross-scene batch work',
);
assert.ok(
  productionPreparation.includes('onContinueBreakdown={goToNextIncompleteBreakdown}'),
  'Breakdown continuation must select another unfinished breakdown instead of returning to the current scene next task',
);
assert.ok(storyboardWorkflow.includes('buildManualVisualPromptSourceHash'), 'Adopted visual prompts must remain tied to the confirmed Shot plan');
assert.equal(storyboard.includes('分镜与提示词检查'), false, 'Storyboard must keep internal stale-state repair out of the creator UI');
assert.ok(departmentBoards.includes('筹备状态') && departmentBoards.includes('核对结果'), 'Storyboard must describe production inputs in author language');
assert.equal(departmentBoards.includes('DEPARTMENT BOARDS'), false, 'Storyboard must not expose internal department-board terminology to authors');
assert.equal(departmentBoards.includes('specialist ok'), false, 'Storyboard must not expose raw implementation readiness labels to authors');

console.log('Interactive current UI self-check passed.');
