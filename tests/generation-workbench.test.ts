import test from 'node:test';
import { fixtureDirectorPlan, reviewFixtureStage, reviewFixturePreparation } from './helpers/productionQualityFixture';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { qualityStages } from '../packages/domain/src/productionQuality';
import type { GenerationTaskDraft, GenerationCapability, GenerationTarget, GenerationReference } from '../packages/domain/src/generation';
import { assertNoGenerationCycle, validateGenerationDraft } from '../packages/domain/src/generation';
import { compileComfyGraph, validateComfyTemplate } from '../packages/domain/src/comfyWorkflow';
import { defaultAIConfig, type AIConfigSnapshot } from '../src/config/aiConfigDefaults';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-generation-test-'));
process.env.OMNI_DB_PATH = path.join(directory, 'fixture.db');
const { db, dbHelpers } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH, 'generation tests must only use their isolated database');
const { buildGenerationCatalog } = await import('../src/server/generation/catalog');
const { GenerationEngine } = await import('../src/server/generation/engine');
const { GenerationStore } = await import('../src/server/generation/store');
const { SubmissionUncertain } = await import('../src/server/generation/providers');
const { registerGenerationRoutes, registerGenerationBoundary } = await import('../src/server/generation/routes');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4QAAAABJRU5ErkJggg==', 'base64');
const graph = {
  '1': { class_type: 'TextEncodeQwenImage21', inputs: { prompt: '', 'images.image_1': ['90', 0], 'images.image_2': ['91', 0] } },
  '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 288 } },
  '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 12 } },
  '90': { class_type: 'LoadImage', inputs: { image: 'source.png' } }, '91': { class_type: 'LoadImage', inputs: { image: 'other.png' } },
};
const makeConfig = (): AIConfigSnapshot => ({ ...structuredClone(defaultAIConfig), channels: [{ id: 'service', name: '模拟生成服务', type: 'comfyui', baseUrl: 'https://comfy.example.test', apiKey: '', comfyQueue: { maxInFlight: 7, pollIntervalMs: 1000, waitTimeoutMs: 10000 } }], models: [{ id: 'qwen', modelId: 'qwen', alias: '联合图片', channelId: 'service', capabilities: ['image'], comfyWorkflowId: 'flow' }], comfyWorkflows: [{ id: 'flow', name: 'Qwen fixture', channelId: 'service', kind: 'api_graph', workflowJson: structuredClone(graph), mappings: [{ systemParam: 'prompt', nodeId: '1', nodeInput: 'prompt' }, { systemParam: 'width', nodeId: '2', nodeInput: 'width' }, { systemParam: 'height', nodeId: '2', nodeInput: 'height' }, { systemParam: 'seed', nodeId: '3', nodeInput: 'seed' }, { systemParam: 'image:0', nodeId: '90', nodeInput: 'image' }, { systemParam: 'image:1', nodeId: '91', nodeInput: 'image' }], api: { operation: 'i2i', imageInputs: 2, videoInputs: 0, audioInputs: 0, nativeAudio: false, minDuration: 1, maxDuration: 15 } }] });

async function fixture() {
  const projectId = `generation-${randomUUID()}`, episodeId = `${projectId}-episode`, sceneId = `${projectId}-scene`, shotId = `${projectId}-shot`;
  const media = path.join(directory, projectId); await fs.mkdir(media, { recursive: true }); await fs.writeFile(path.join(media, 'input.png'), png);
  dbHelpers.saveProject({ id: projectId, title: '隔离生成合同', type: 'movie', aspectRatio: '16:9', characters: [], assets: [], episodes: [{ id: episodeId, title: '第一集', scenes: [{ id: sceneId, title: '本场', script: '人物将杯子放在桌上，松开手后观察杯子。', manualStoryboard: { directorPlan: fixtureDirectorPlan() }, sceneNumber: 1, shots: [{ id: shotId, duration: 5, visualAction: '人物放下杯子', editingNote: '下降、接触、松手后切反应，动作约五秒', imagePrompt: '人物放下杯子' }] }] }] } as any);
  let config = makeConfig(), source = 'source-v1';
  const target: GenerationTarget = { projectId, episodeId, sceneId, kind: 'shot', shotIds: [shotId] };
  const reference: GenerationReference = { id: 'character', label: '人物独立图', mediaKind: 'image', mediaUrl: '/media/input.png', mediaVersionId: 'asset-v1', role: 'character_identity', enabled: true, locked: false, source: 'preset', status: 'adopted' };
  const context = (t: GenerationTarget) => {
    const project = dbHelpers.getProjectById(projectId) as any, episode = project.episodes[0], scene = episode.scenes[0];
    return { project, episode, scene, shots: scene.shots, target: t, references: [structuredClone(reference), ...(scene.shots[0].imageUrl ? [{ ...structuredClone(reference), id: 'current-frame', role: 'composition', mediaUrl: scene.shots[0].imageUrl, sourceShotIds: [scene.shots[0].id] }] : [])], sourceHash: source, sourceRevision: episode.productionRevision || 0, prompt: '完整的单镜人物动作', videoPrompt: '完整的视频动作', narrativeSeconds: 5, label: '测试镜头', asset: undefined, workflow: undefined, page: undefined, boardSourceHash: undefined } as any;
  };
  const engine = new GenerationEngine(new GenerationStore(db), () => config, media, context);
  await reviewFixturePreparation(engine.quality, target);
  const policy = engine.store.policy(projectId); engine.updatePolicy(projectId, { allowExperimental: true }, policy.revision);
  const task = engine.create({ target, operation: 'asset_image', commandId: randomUUID() });
  const cap = engine.recipe(task.capabilityId).capability;
  let submits = 0;
  engine.providers.submit = async () => { submits++; return { providerTaskId: 'provider-one' }; };
  engine.providers.poll = async () => ({ status: 'running' });
  const allow = (plans: string[], attempts = 1) => engine.grant({ projectId, kind: 'fixed_plans', planIds: plans, sceneId, operations: ['asset_image', 'video'], coreFamilies: [cap.coreFamily], maxAttempts: attempts, allowUnknownCost: true, expiresAt: Date.now() + 60000 });
  return { engine, task, target, reference, cap, media, allow, submits: () => submits, setSource: (s: string) => { source = s; }, setConfig: (value: AIConfigSnapshot) => { config = value; }, getConfig: () => config };
}

test('catalog provides variable input branches without altering stored workflow', () => {
  const config = makeConfig(), before = JSON.stringify(config), [recipe] = buildGenerationCatalog(config);
  assert.equal(recipe.capability.inputs.image.min, 1); assert.equal(recipe.capability.inputs.image.max, 2);
  const compiled = compileComfyGraph(recipe.template!, { prompt: '画面', aspectRatio: '16:9', width: 512, height: 288, images: ['uploaded.png'], seed: 1, parameters: { steps: 8 } });
  assert.equal(compiled['91'], undefined); assert.equal(compiled['1'].inputs['images.image_2'], undefined); assert.equal(compiled['3'].inputs.steps, 8);
  assert.equal(JSON.stringify(config), before);
});
test('MOSS preset preserves deployed core, exposes sampling and rejects reference inputs without changing other recipes', async () => {
  const { comfyAPIPresets } = await import('../src/config/comfyPresets');
  const preset = comfyAPIPresets.find(p => p.id === 'moss-image-t2i')!;
  assert.ok(preset);
  const config = makeConfig(), before = buildGenerationCatalog(config);
  config.comfyWorkflows.push({ ...structuredClone(preset.template), id: 'moss-flow', channelId: 'service' });
  config.models.push({ id: 'moss', modelId: 'moss-image-sft-bf16', alias: preset.label, channelId: 'service', capabilities: ['image'], comfyWorkflowId: 'moss-flow' });
  const saved = JSON.stringify(config), catalog = buildGenerationCatalog(config);
  assert.deepEqual(catalog[0], before[0]);
  assert.equal(JSON.stringify(config), saved);
  const recipe = catalog.find(r => r.capability.coreFamily === 'moss_image')!;
  assert.equal(recipe.capability.mode, 'text_to_image');
  assert.equal(recipe.capability.inputs.image.max, 0);
  assert.equal(recipe.capability.inputs.audio.max, 0);
  assert.equal(recipe.capability.inputs.video.max, 0);
  assert.deepEqual(recipe.capability.allowedOperations, ['asset_image', 'joint_storyboard']);
  assert.equal(recipe.capability.defaults.steps, 25);
  assert.equal(recipe.capability.defaults.cfg, 2.5);
  const input = { prompt: '写实古代山门，雨后石阶', aspectRatio: '16:9', width: 1536, height: 864, seed: 42,
    parameters: { steps: 28, cfg: 3, negativePrompt: 'watermark' } };
  const compiled = compileComfyGraph(recipe.template!, input);
  assert.equal(compiled['1'].inputs.unet_name, 'moss_image_sft_bf16.safetensors');
  assert.equal(compiled['2'].inputs.clip_name, 'qwen3.5_9b_bf16.safetensors');
  assert.equal(compiled['3'].inputs.vae_name, 'flux2-vae_small.safetensors');
  assert.equal(compiled['4'].inputs.text, input.prompt);
  assert.equal(compiled['5'].inputs.text, 'watermark');
  assert.deepEqual(compiled['6'].inputs, { width: 1536, height: 864, batch_size: 1 });
  assert.equal(compiled['7'].inputs.seed, 42);
  assert.equal(compiled['7'].inputs.steps, 28);
  assert.equal(compiled['7'].inputs.cfg, 3);
  assert.equal(compiled['7'].inputs.sampler_name, 'er_sde');
  assert.equal(compiled['7'].inputs.scheduler, 'simple');
  assert.throws(() => compileComfyGraph(recipe.template!, { ...input, images: ['reference.png'] }), /0 个 images/);
  assert.throws(() => compileComfyGraph(recipe.template!, { ...input, parameters: { ...input.parameters, steps: 0 } }), /steps/);
});
test('native director-board context keeps key-state panels without duplicating shot duration', async () => {
  const f = await fixture();
  const { normalizeManualStoryboardBoard, normalizeManualStoryboardStrategy } = await import('../src/services/production/manualVideoStoryboard');
  const { buildStoryboardCompositeVisualPages } = await import('../src/services/production/storyboardCompositeBoard');
  const { loadGenerationContext } = await import('../src/server/generation/context');
  const p = dbHelpers.getProjectById(f.target.projectId) as any, ep = p.episodes[0], scene = ep.scenes[0], shot = scene.shots[0];
  const decision = normalizeManualStoryboardStrategy({ selectedStrategyId: 'storyboard.action_continuity.v1', selectedModelProfileId: 'video.storyboard_reference.configurable.short_unit.v1', expectedVideoUnitDurationSeconds: 5 });
  const normalized = normalizeManualStoryboardBoard({ episodeId: ep.id, sceneId: scene.id, shot, decision, value: { performanceBeat: { summary: '放杯子', startState: '杯子手中', endState: '杯子桌上' }, board: { layout: '2x2', panels: ['持杯', '下降', '接触桌面', '松手'].map(visualBeat => ({ visualBeat, subjectAction: visualBeat, framePurpose: '关键状态', durationSeconds: 1.25 })) } } });
  normalized.board!.visualReferenceMode = 'director_board';
  normalized.board!.visualPages = buildStoryboardCompositeVisualPages(normalized.board!);
  scene.manualStoryboard = { directorPlan: fixtureDirectorPlan(), schemaVersion: 'manual-storyboard.v1', boards: [{ id: 'director-unit', shotId: shot.id, shotIds: [shot.id], boardId: normalized.board!.id, ...normalized, updatedAt: Date.now() }], updatedAt: Date.now() };
  dbHelpers.updateEpisode(p.id, ep.id, ep);
  const target: GenerationTarget = { ...f.target, kind: 'board', boardId: normalized.board!.id, pageId: normalized.board!.visualPages[0].id };
  for (const shotIds of [[shot.id], []]) {
    const ctx = loadGenerationContext({ ...target, shotIds });
    assert.deepEqual(ctx.target.shotIds, [shot.id]); assert.equal(ctx.page!.panelIds.length, 4); assert.equal(ctx.narrativeSeconds, 5);
  }
});
test('board panel edits invalidate frozen plans and candidates even when Shot content is unchanged', async () => {
  const f = await fixture();
  const { normalizeManualStoryboardBoard, normalizeManualStoryboardStrategy } = await import('../src/services/production/manualVideoStoryboard');
  const { buildStoryboardCompositeVisualPages } = await import('../src/services/production/storyboardCompositeBoard');
  const { loadGenerationContext } = await import('../src/server/generation/context');
  const ep = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any, scene = ep.scenes[0], shot = scene.shots[0];
  shot.imageUrl = '/media/input.png';
  const normalized = normalizeManualStoryboardBoard({ episodeId: ep.id, sceneId: scene.id, shot,
    decision: normalizeManualStoryboardStrategy({ selectedStrategyId: 'storyboard.action_continuity.v1', selectedModelProfileId: 'video.storyboard_reference.configurable.short_unit.v1', expectedVideoUnitDurationSeconds: 5 }),
    value: { performanceBeat: { summary: '放杯子', startState: '杯子手中', endState: '杯子桌上' }, board: { layout: '1x1', panels: [{ visualBeat: '杯子仍在手中', subjectAction: '持杯', framePurpose: '关键状态', durationSeconds: 5 }] } } });
  normalized.board!.visualReferenceMode = 'director_board'; normalized.board!.visualPages = buildStoryboardCompositeVisualPages(normalized.board!);
  scene.manualStoryboard = { directorPlan: fixtureDirectorPlan(), schemaVersion: 'manual-storyboard.v1', boards: [{ id: 'unit', shotId: shot.id, shotIds: [shot.id], boardId: normalized.board!.id, ...normalized, updatedAt: Date.now() }], updatedAt: Date.now() };
  dbHelpers.updateEpisode(f.target.projectId, ep.id, ep);
  const engine = new GenerationEngine(f.engine.store, f.getConfig, f.media);
  const target: GenerationTarget = { ...f.target, kind: 'board', boardId: normalized.board!.id, pageId: normalized.board!.visualPages[0].id };
  const draft = engine.create({ target, operation: 'joint_storyboard', commandId: randomUUID() });
  const task = engine.update(draft.id, { expectedRevision: draft.revision, patch: { references: draft.references.map(r => ({ ...r, role: 'composition', enabled: true })) } });
  await reviewFixturePreparation(engine.quality, target);
  const original = loadGenerationContext(target), { plan } = await engine.preflight(task.id, task.revision); assert.ok(plan);
  const imported = await engine.importResult(plan.id, '/media/input.png', randomUUID());
  assert.equal(loadGenerationContext(target).sourceHash, original.sourceHash, 'registering a candidate must not change authored source');
  const revision = () => (dbHelpers.getEpisodeById(f.target.projectId, ep.id) as any).productionRevision;
  engine.review(imported.id, imported.results[0].id, 'adopted', revision(), '已检查杯子关键状态');
  const config = f.getConfig();
  config.comfyWorkflows.push({ id: 'native', name: 'Native H3', channelId: 'service', kind: 'minimax_h3_reference_video', workflowJson: {}, mappings: [] });
  config.models.push({ id: 'native', alias: 'Native H3', modelId: 'MiniMax-H3', channelId: 'service', capabilities: ['video'], comfyWorkflowId: 'native' });
  f.setConfig(config);
  const videoTarget: GenerationTarget = { ...f.target, kind: 'video_unit', unitId: 'unit' };
  await reviewFixtureStage(engine.quality, 'visuals', videoTarget);
  const videoTask = engine.create({ target: videoTarget, operation: 'video', commandId: randomUUID() });
  const videoPreflight = await engine.preflight(videoTask.id, videoTask.revision); assert.ok(videoPreflight.plan, JSON.stringify(videoPreflight.issues));
  assert.ok(videoPreflight.plan.references.some(ref => ref.role === 'board_sequence'));
  engine.review(imported.id, imported.results[0].id, 'needs_changes', revision(), '需重新检查');
  assert.throws(() => engine.submit(videoPreflight.plan!.id, videoPreflight.plan!.planHash, undefined, randomUUID()), /宫格来源或采用状态/);
  engine.review(imported.id, imported.results[0].id, 'adopted', revision(), '已重新检查关键状态');
  assert.doesNotThrow(() => engine.assertAllowed(videoPreflight.plan!));
  const changed = dbHelpers.getEpisodeById(f.target.projectId, ep.id) as any;
  changed.scenes[0].manualStoryboard.boards[0].board.panels[0].visualBeat = '杯子已在桌上';
  dbHelpers.updateEpisode(f.target.projectId, ep.id, changed);
  const current = loadGenerationContext(target);
  assert.notEqual(current.boardSourceHash, original.boardSourceHash); assert.notEqual(current.sourceHash, original.sourceHash);
  assert.equal(loadGenerationContext(videoTarget).references.find(ref => ref.sourceTakeId === imported.results[0].candidateId)?.status, 'source_changed');
  assert.throws(() => engine.submit(videoPreflight.plan!.id, videoPreflight.plan!.planHash, undefined, randomUUID()), /宫格来源或采用状态/);
  assert.equal(engine.refreshResultReview(engine.execution(imported.id)).results[0].review, 'source_changed');
  assert.ok((await engine.preflight(task.id, task.revision)).issues.some(i => i.code === 'SOURCE_CHANGED'));
  assert.throws(() => engine.submit(plan.id, plan.planHash, undefined, randomUUID()), /上游来源/);
  await assert.rejects(engine.importResult(plan.id, '/media/input.png', randomUUID()), /已变化/);
  assert.throws(() => engine.review(imported.id, imported.results[0].id, 'adopted', current.sourceRevision, '检查旧候选'), /来源已变化/);
  assert.equal(f.submits(), 0);
});
test('legacy board plans continue only with matching saved base and board fingerprints', async () => {
  const f = await fixture();
  const { normalizeManualStoryboardBoard, normalizeManualStoryboardStrategy } = await import('../src/services/production/manualVideoStoryboard');
  const { buildStoryboardCompositeVisualPages } = await import('../src/services/production/storyboardCompositeBoard');
  const { loadGenerationContext } = await import('../src/server/generation/context');
  const ep = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any, scene = ep.scenes[0], shot = scene.shots[0];
  shot.imageUrl = '/media/input.png';
  const normalized = normalizeManualStoryboardBoard({ episodeId: ep.id, sceneId: scene.id, shot,
    decision: normalizeManualStoryboardStrategy({ selectedStrategyId: 'storyboard.action_continuity.v1', selectedModelProfileId: 'video.storyboard_reference.configurable.short_unit.v1', expectedVideoUnitDurationSeconds: 5 }),
    value: { performanceBeat: { summary: '放杯子', startState: '杯子手中', endState: '杯子桌上' }, board: { layout: '1x1', panels: [{ visualBeat: '杯子仍在手中', subjectAction: '持杯', framePurpose: '关键状态', durationSeconds: 5 }] } } });
  normalized.board!.visualReferenceMode = 'director_board'; normalized.board!.visualPages = buildStoryboardCompositeVisualPages(normalized.board!);
  scene.manualStoryboard = { directorPlan: fixtureDirectorPlan(), schemaVersion: 'manual-storyboard.v1', boards: [{ id: 'unit', shotId: shot.id, shotIds: [shot.id], boardId: normalized.board!.id, ...normalized, updatedAt: Date.now() }], updatedAt: Date.now() };
  dbHelpers.updateEpisode(f.target.projectId, ep.id, ep);
  const target: GenerationTarget = { ...f.target, kind: 'board', boardId: normalized.board!.id, pageId: normalized.board!.visualPages[0].id };
  const legacyEngine = new GenerationEngine(f.engine.store, f.getConfig, f.media, target => {
    const ctx = loadGenerationContext(target); return { ...ctx, sourceHash: ctx.legacySourceHash || ctx.sourceHash };
  });
  const legacyDraft = legacyEngine.create({ target, operation: 'joint_storyboard', commandId: randomUUID() });
  const task = legacyEngine.update(legacyDraft.id, { expectedRevision: legacyDraft.revision, patch: { references: legacyDraft.references.map(ref => ({ ...ref, role: 'composition', enabled: true })) } });
  await reviewFixturePreparation(legacyEngine.quality, target);
  const { plan } = await legacyEngine.preflight(task.id, task.revision); assert.ok(plan);
  const frozenPlan = legacyEngine.plan(plan.id);
  const existing = await legacyEngine.importResult(plan.id, '/media/input.png', randomUUID());
  const revision = () => (dbHelpers.getEpisodeById(f.target.projectId, ep.id) as any).productionRevision;
  legacyEngine.review(existing.id, existing.results[0].id, 'adopted', revision(), '旧版本已经检查采用');
  const pending = await legacyEngine.importResult(plan.id, '/media/input.png', randomUUID());
  const engine = new GenerationEngine(f.engine.store, f.getConfig, f.media);
  assert.notEqual(engine.context(target).sourceHash, plan.sourceHash, 'fixture must use the older separate-fingerprint plan');
  assert.equal(engine.workspace(target).taskSourceCurrent?.[task.id], true);
  assert.equal(engine.refreshResultReview(engine.execution(existing.id)).results[0].review, 'adopted');
  assert.equal(engine.refreshResultReview(engine.execution(pending.id)).results[0].review, 'pending');
  assert.ok((await engine.preflight(task.id, task.revision)).plan, 'the unchanged legacy draft can prepare a new plan');
  const execution = engine.submit(plan.id, plan.planHash, undefined, randomUUID()); assert.equal(execution.status, 'queued'); await engine.cancel(execution.id);
  const imported = await engine.importResult(plan.id, '/media/input.png', randomUUID());
  assert.equal(imported.results[0].review, 'pending', 'registration must use the same compatibility check');
  assert.equal(engine.review(imported.id, imported.results[0].id, 'adopted', revision(), '当前版本再次检查').results[0].review, 'adopted');
  assert.deepEqual(engine.plan(plan.id), frozenPlan, 'compatibility never rewrites the historical plan');

  const noEvidenceDraft = legacyEngine.create({ target, operation: 'joint_storyboard', commandId: randomUUID() });
  const noEvidenceTask = legacyEngine.update(noEvidenceDraft.id, { expectedRevision: noEvidenceDraft.revision, patch: { references: task.references } });
  const { plan: noEvidence } = await legacyEngine.preflight(noEvidenceTask.id, noEvidenceTask.revision); assert.ok(noEvidence);
  engine.store.put('plan-context', noEvidence.id, target.projectId, {});
  assert.equal(engine.workspace(target).taskSourceCurrent?.[noEvidenceTask.id], false);
  assert.ok((await engine.preflight(noEvidenceTask.id, noEvidenceTask.revision)).issues.some(issue => issue.code === 'SOURCE_CHANGED'));
  assert.throws(() => engine.submit(noEvidence.id, noEvidence.planHash, undefined, randomUUID()), /上游来源/);
  await assert.rejects(engine.importResult(noEvidence.id, '/media/input.png', randomUUID()), /已变化/);

  const changed = dbHelpers.getEpisodeById(f.target.projectId, ep.id) as any;
  changed.scenes[0].manualStoryboard.boards[0].board.panels[0].visualBeat = '杯子已经落桌';
  dbHelpers.updateEpisode(f.target.projectId, ep.id, changed);
  assert.equal(engine.context(target).legacySourceHash, plan.sourceHash, 'panel-only changes leave the old basic fingerprint unchanged');
  assert.equal(engine.workspace(target).taskSourceCurrent?.[task.id], false);
  assert.equal(engine.refreshResultReview(engine.execution(imported.id)).results[0].review, 'source_changed');
  assert.equal(engine.refreshResultReview(engine.execution(pending.id)).results[0].review, 'source_changed');
  assert.throws(() => engine.submit(plan.id, plan.planHash, undefined, randomUUID()), /上游来源/);
  await assert.rejects(engine.importResult(plan.id, '/media/input.png', randomUUID()), /已变化/);
  assert.throws(() => engine.review(pending.id, pending.results[0].id, 'adopted', revision(), '旧板不能采用'), /来源已变化/);
  assert.deepEqual(engine.plan(plan.id), frozenPlan); assert.equal(f.submits(), 0);
});
test('legacy exact-count workflows stay exact unless complete branch rules are present', () => {
  const flow = makeConfig().comfyWorkflows[0];
  assert.throws(() => compileComfyGraph(flow, { prompt: '画面', aspectRatio: '16:9', width: 512, height: 288, images: ['one.png'] }), /2/);
  const malformed = { ...flow, api: { ...flow.api!, minimumInputs: { images: 1 } } };
  assert.throws(() => validateComfyTemplate(malformed), /分支/);
});
test('unknown scalar parameters cannot change arbitrary graph inputs', () => {
  const [recipe] = buildGenerationCatalog(makeConfig());
  assert.throws(() => compileComfyGraph(recipe.template!, { prompt: '画面', aspectRatio: '16:9', width: 512, height: 288, images: ['one.png'], parameters: { arbitrary_model: 'replacement' } }), /允许范围/);
});
test('parameter variants merge only when core topology and model identity match', () => {
  const config = makeConfig(); config.models.push({ ...config.models[0], id: 'qwen-preview', alias: '快速 8/4', comfyWorkflowId: 'preview' });
  const preview = structuredClone(config.comfyWorkflows[0]); preview.id = 'preview'; preview.workflowJson['3'].inputs.steps = 8; config.comfyWorkflows.push(preview);
  assert.equal(buildGenerationCatalog(config).filter(r => r.capability.provider === 'comfyui').length, 1); assert.equal(buildGenerationCatalog(config)[0].legacyModelIds.length, 2);
  preview.workflowJson['3'].class_type = 'OtherSampler'; assert.equal(buildGenerationCatalog(config).filter(r => r.capability.provider === 'comfyui').length, 2);
});
test('draft creation is idempotent and conflicting command reuse is rejected', async () => {
  const f = await fixture(), commandId = randomUUID(); const first = f.engine.create({ target: f.target, operation: 'asset_image', commandId });
  assert.equal(f.engine.create({ target: f.target, operation: 'asset_image', commandId }).id, first.id);
  assert.throws(() => f.engine.create({ target: f.target, operation: 'joint_storyboard', commandId }), /相同操作/);
});
test('stale draft save returns conflict rather than overwriting new changes', async () => {
  const f = await fixture(); f.engine.update(f.task.id, { expectedRevision: 1, patch: { prompt: '人工新稿' } });
  assert.throws(() => f.engine.update(f.task.id, { expectedRevision: 1, patch: { prompt: '旧稿' } }), /更新/);
  assert.equal(f.engine.task(f.task.id).prompt, '人工新稿');
});
test('AI preset suggestions preserve manual parameter and reference overrides', async () => {
  const f = await fixture(); const t = f.engine.update(f.task.id, { expectedRevision: 1, patch: { parameters: { ...f.task.parameters, steps: { value: 9, source: 'user', locked: true } }, references: f.task.references.map(r => ({ ...r, enabled: false, source: 'user' })) } });
  const p = f.engine.propose(t.id, { parameters: { steps: 30 }, enabledReferenceIds: [f.reference.id], explanation: '测试建议' });
  const result = f.engine.applyProposal(t.id, p.id, t.revision);
  assert.equal(result.parameters.steps.value, 9); assert.equal(result.references[0].enabled, false);
});
test('removing a board is a semantic error even when image count is legal', async () => {
  const f = await fixture(); const cap = { ...f.cap, mediaKind: 'video', mode: 'board_guided_video', multiShot: true } as GenerationCapability;
  const task = { ...f.task, operation: 'video', narrativeSeconds: 5, parameters: { ...f.task.parameters, duration: { value: 5, source: 'default', locked: false } } } as GenerationTaskDraft;
  assert.ok(validateGenerationDraft(task, cap).some(i => i.code === 'REFERENCE_ROLE_REQUIRED'));
});
test('request duration cannot silently compress narrative timing', async () => {
  const f = await fixture(); const cap = { ...f.cap, mediaKind: 'video', mode: 'reference_video', multiShot: true, parameters: [...f.cap.parameters, { key: 'duration', label: '时长', type: 'number', default: 12 }] } as GenerationCapability;
  const task = { ...f.task, narrativeSeconds: 12, parameters: { ...f.task.parameters, duration: { value: 8, source: 'user', locked: false } } } as GenerationTaskDraft;
  assert.ok(validateGenerationDraft(task, cap).some(i => i.code === 'DURATION_COVERAGE_GAP'), 'duration coverage must be checked');
});
test('H3 14-second request is rejected when frame alignment exceeds capacity', async () => {
  const f = await fixture(); const cap = { ...f.cap, coreFamily: 'yz_h3', mediaKind: 'video', mode: 'reference_video', maxDuration: 14, multiShot: true, parameters: [...f.cap.parameters, { key: 'duration', label: '时长', type: 'number', default: 14 }] } as GenerationCapability;
  const t = { ...f.task, parameters: { ...f.task.parameters, duration: { value: 14, source: 'user', locked: false } } } as GenerationTaskDraft;
  assert.ok(validateGenerationDraft(t, cap).some(i => i.code === 'DURATION_FRAME_LIMIT'));
});
test('input audio capability does not imply support for timbre references', async () => {
  const f = await fixture(); const cap = structuredClone(f.cap); cap.inputs.audio = { min: 0, max: 1, roles: ['full_dialogue'] };
  const t = { ...f.task, references: [...f.task.references, { ...f.reference, id: 'voice', mediaKind: 'audio', role: 'voice_timbre' }] } as GenerationTaskDraft;
  assert.ok(validateGenerationDraft(t, cap).some(i => i.code === 'REFERENCE_ROLE_UNSUPPORTED'));
});
test('dependency cycles are rejected, while independent branches remain valid', async () => {
  const f = await fixture(); const a = { ...f.task, id: 'a', references: [{ ...f.reference, dependency: { taskId: 'b', condition: 'adopted_current' } }] } as GenerationTaskDraft;
  const b = { ...f.task, id: 'b', references: [{ ...f.reference, dependency: { taskId: 'a', condition: 'adopted_current' } }] } as GenerationTaskDraft;
  assert.throws(() => assertNoGenerationCycle([a, b]), /循环/); assert.doesNotThrow(() => assertNoGenerationCycle([a, { ...b, references: [] }]));
});
test('preflight freezes bytes and a random seed, but never calls provider', async () => {
  const f = await fixture(); const result = await f.engine.preflight(f.task.id, 1); assert.ok(result.plan);
  assert.ok(result.plan.references[0].contentHash); assert.notEqual(result.plan.references[0].mediaUrl, '/media/input.png');
  assert.ok(Number(result.plan.parameters.seed) >= 0); assert.equal(f.submits(), 0);
  const bytes = await fs.readFile(await f.engine.media.localPath(result.plan.references[0].mediaUrl)); await fs.writeFile(path.join(f.media, 'input.png'), 'changed');
  assert.deepEqual(await fs.readFile(await f.engine.media.localPath(result.plan.references[0].mediaUrl)), bytes);
});
test('changing source after preflight blocks execution without spending attempt', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const grant = f.allow([plan.id]); f.setSource('source-v2');
  assert.throws(() => f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID()), /上游来源/);
  assert.equal(f.engine.store.get<any>('grant', grant.id).usedAttempts, 0);
});
test('same execution retry is idempotent; different plan under same key is conflict', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const grant = f.allow([plan.id], 2), key = randomUUID();
  const first = f.engine.submit(plan.id, plan.planHash, grant.id, key), second = f.engine.submit(plan.id, plan.planHash, grant.id, key);
  assert.equal(first.id, second.id); assert.equal(f.engine.store.get<any>('grant', grant.id).usedAttempts, 1);
  const { plan: other } = await f.engine.preflight(f.task.id, 1); assert.ok(other); const nextGrant = f.allow([other.id]);
  assert.throws(() => f.engine.submit(other.id, other.planHash, nextGrant.id, key), /相同提交/);
});
test('paused image generation blocks submit and queued dispatch', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const grant = f.allow([plan.id]);
  const e = f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID());
  const policy = f.engine.store.policy(f.target.projectId); f.engine.updatePolicy(policy.projectId, { imagePaused: true }, policy.revision);
  await f.engine.process(e.id); assert.equal(f.engine.execution(e.id).status, 'held'); assert.equal(f.submits(), 0);
  assert.throws(() => f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID()), /暂停/);
});
test('failed creative checks block preflight, submit, import and queued dispatch without automatic retries', async () => {
  const f=await fixture(),{plan}=await f.engine.preflight(f.task.id,1);assert.ok(plan);
  const queued=f.engine.submit(plan.id,plan.planHash,undefined,randomUUID());
  const inspection=await f.engine.quality.inspect('preparation',f.target);
  f.engine.quality.review(inspection.id,{verdict:'failed',reviewerName:'隔离测试导演',findings:f.engine.quality.state('preparation',f.target).checks.map((check,index)=>({check:check.id,passed:index!==0,note:index===0?'协议测试：当前布景不支持剧情动作':'协议测试：本项符合当前夹具'}))},'external_agent');
  const preflight=await f.engine.preflight(f.task.id,1);assert.equal(preflight.plan,undefined);assert.ok(preflight.issues.some(i=>i.code==='PRODUCTION_QUALITY_BLOCKED'&&i.blocking));
  assert.throws(()=>f.engine.submit(plan.id,plan.planHash,undefined,randomUUID()),/资产、布景与调度未通过/);
  await assert.rejects(f.engine.importResult(plan.id,'/media/input.png',randomUUID()),/资产、布景与调度未通过/);
  await f.engine.process(queued.id);await f.engine.process(queued.id);
  assert.equal(f.engine.execution(queued.id).status,'held');assert.equal(f.submits(),0);
  await reviewFixturePreparation(f.engine.quality,f.target);
  await f.engine.process(queued.id);
  assert.equal(f.engine.execution(queued.id).status,'held','a new pass must not silently resume held generation');
  assert.equal(f.submits(),0);
});
test('known project video pause is migrated persistently, not inferred from result status', async () => {
  const store = new GenerationStore(db), policy = store.policy('prod_cidibutong_ep01_20261021');
  assert.equal(policy.videoPaused, true); assert.deepEqual(policy.allowedCoreFamilies, ['yz_h3']); assert.equal(new GenerationStore(db).policy(policy.projectId).videoPaused, true);
});
test('grant attempt limit is atomic across repeated submission', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const grant = f.allow([plan.id]);
  f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID());
  assert.throws(() => f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID()), /次数/);
});
test('unknown provider submission stays reconciling and never automatically reposts', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const grant = f.allow([plan.id]); const e = f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID());
  let calls = 0; f.engine.providers.submit = async () => { calls++; throw new SubmissionUncertain('网络中断，正在核对'); };
  await f.engine.process(e.id); await f.engine.process(e.id); await f.engine.resume(e.id);
  assert.equal(calls, 1); assert.equal(f.engine.execution(e.id).status, 'reconciling');
});
test('capability deployment changes hold queued execution', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const e = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
  const config = f.getConfig(); config.channels[0].baseUrl = 'https://another.example.test'; f.setConfig(config);
  await f.engine.process(e.id); assert.equal(f.engine.execution(e.id).status, 'held'); assert.equal(f.submits(), 0);
});
test('reservation release HTTP preserves unknown execution, records server identity and enforces project access', async () => {
  const f = await fixture(), express = (await import('express')).default;
  const { registerComfyUIGatewayRoutes } = await import('../src/server/providers/comfyUIGateway');
  const { videoGenerationTaskRepository: repository } = await import('../src/server/videoGenerationTaskRepository');
  const app = express(); app.use(express.json());
  f.engine.providers.comfy = registerComfyUIGatewayRoutes(app, { getConfig: f.getConfig, background: false, providerFetch: async () => { throw new Error('release must not submit or cancel upstream'); } });
  let permitted = true;
  registerGenerationRoutes(app, f.engine, { basePath: '/operator', operator: true, assertProjectAccess: () => { if (!permitted) throw new Error('access denied'); } });
  const { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const execution = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
  const record = repository.create({ provider: 'comfyui', channelId: 'service', modelConfigId: 'qwen', projectId: f.target.projectId, status: 'unknown', idempotencyKey: randomUUID(), requestHash: 'original', request: { input: 'keep' }, embeddedAudio: false, error: 'original uncertainty' });
  f.engine.store.put('execution', execution.id, execution.projectId, { ...execution, status: 'reconciling', providerRecordId: record.id });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/operator/executions/${execution.id}/release-reservation`;
  const post = (evidence: unknown) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ evidence, actor: 'creator' }) });
  try {
    assert.equal((await post('')).status, 400);
    permitted = false; assert.equal((await post('Checked queue and history')).status, 400);
    assert.equal(repository.getById(record.id)!.dispatchReservationRelease, undefined);
    permitted = true;
    const response = await post('Checked queue and history: no matching active job.'); assert.equal(response.status, 200);
    const result = (await response.json()).execution;
    assert.equal(result.status, 'reconciling'); assert.equal(result.dispatchReservationRelease.actor, 'external_agent');
    assert.deepEqual(result.dispatchReservationRelease, repository.getById(record.id)!.dispatchReservationRelease);
    assert.deepEqual((await (await post('Repeated')).json()).execution.dispatchReservationRelease, result.dispatchReservationRelease);
    f.engine.store.put('execution', execution.id, execution.projectId, { ...result, status: 'running', providerTaskId: 'known' });
    assert.equal((await post('Known upstream')).status, 409); assert.equal(f.submits(), 0);
  } finally { f.engine.providers.comfy.stop(); await new Promise<void>(r => server.close(() => r())); }
});
test('candidate registration is durable and idempotent, explicit adoption updates original shot', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const e = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
  f.engine.providers.poll = async () => ({ status: 'succeeded', outputs: [{ url: '/media/input.png', kind: 'image' }] });
  f.engine.media.inspect = async () => ({ width: 1, height: 1, durationSeconds: undefined });
  await f.engine.process(e.id); const done = f.engine.execution(e.id); assert.equal(done.status, 'succeeded'); assert.ok(done.results[0].candidateId);
  await f.engine.registerResults(done);
  let ep = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  assert.equal(ep.scenes[0].shots[0].takes.length, 1); assert.equal(ep.scenes[0].shots[0].activeTakeId, undefined);
  f.engine.review(e.id, done.results[0].id, 'adopted', ep.productionRevision, '已检查本候选');
  ep = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  assert.equal(ep.scenes[0].shots[0].activeTakeId, done.results[0].candidateId);
});
test('result adoption respects current production revision', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan); const e = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
  f.engine.providers.poll = async () => ({ status: 'succeeded', outputs: [{ url: '/media/input.png', kind: 'image' }] }); f.engine.media.inspect = async () => ({ width: 1, height: 1, durationSeconds: undefined });
  await f.engine.process(e.id); const done = f.engine.execution(e.id);
  assert.throws(() => f.engine.review(e.id, done.results[0].id, 'adopted', -1, ''), /版本/);
});

test('provider execution mismatch preserves candidate and blocks adoption despite valid media measurements', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const e = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
  const issue = '供应商输出内嵌工作流与提交图不一致（331.inputs.attention）';
  f.engine.providers.poll = async () => ({ status: 'succeeded', outputs: [{ url: '/media/input.png', kind: 'image', technicalIssues: [issue] }] });
  f.engine.media.inspect = async () => ({ width: 1, height: 1, durationSeconds: undefined });
  await f.engine.process(e.id); const done = f.engine.execution(e.id), result = done.results[0];
  assert.equal(done.status, 'succeeded'); assert.ok(result.candidateId); assert.deepEqual(result.technicalIssues, [issue]);
  assert.ok((await fs.stat(await f.engine.media.localPath(result.mediaUrl))).size > 0);
  const ep = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  assert.throws(() => f.engine.review(e.id, result.id, 'adopted', ep.productionRevision, '媒体尺寸正确'), /执行核对未通过/);
  assert.equal((dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any).scenes[0].shots[0].activeTakeId, undefined);
  f.engine.review(e.id, result.id, 'needs_changes', ep.productionRevision, '退回执行偏差，保留文件');
  assert.equal(f.engine.execution(e.id).results[0].review, 'needs_changes'); assert.equal(f.submits(), 1);
});

test('operator cannot expand grants, unpause generation or claim manual adoption', async () => {
  const f = await fixture(), routes = new Map<string, any>();
  const app = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (url: string, handler: any) => routes.set(`${method} ${url}`, handler)]));
  registerGenerationRoutes(app as any, f.engine, { basePath: '/operator', operator: true });
  for (const [method, route] of [['patch', '/operator/projects/:id/policy'], ['post', '/operator/projects/:id/grants']]) {
    let status = 200, data: any; const res = { status(n: number) { status = n; return this; }, json(value: unknown) { data = value; return this; } };
    await routes.get(`${method} ${route}`)({ params: { id: f.target.projectId }, body: {} }, res);
    assert.equal(status, 403); assert.equal(data.code, 'USER_ACTION_REQUIRED');
  }
});
test('external review requires exact inspected media and source, keeps CAS and records external identity', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const e = f.engine.submit(plan.id, plan.planHash, '', randomUUID());
  f.engine.providers.poll = async () => ({ status: 'succeeded', outputs: [{ url: '/media/input.png', kind: 'image' }] });
  f.engine.media.inspect = async () => ({ width: 1, height: 1, durationSeconds: undefined });
  await f.engine.process(e.id); const result = f.engine.execution(e.id).results[0];
  assert.ok(result.candidateId);
  const evidence = { reviewer: 'external_agent' as const, contentHash: result.contentHash, sourceHash: plan.sourceHash };
  assert.throws(() => f.engine.review(e.id, result.id, 'adopted', 0, '已检查', { ...evidence, contentHash: 'wrong' }), /实际观察/);
  assert.throws(() => f.engine.review(e.id, result.id, 'adopted', -1, '检查PNG主体与构图', evidence), /版本/);
  const revision = f.engine.context(f.target).episode!.productionRevision!;
  const done = f.engine.review(e.id, result.id, 'adopted', revision, '检查PNG主体与构图；这是隔离测试素材。', evidence);
  assert.equal(done.results[0].review, 'adopted');
  const audit = f.engine.store.list<any>('review', f.target.projectId)[0];
  assert.equal(audit.reviewer, 'external_agent'); assert.equal(audit.contentHash, result.contentHash);
  f.setSource('changed-source');
  assert.throws(() => f.engine.review(e.id, result.id, 'adopted', revision, '再次检查', evidence), /来源/);
});
test('operator experiment acknowledgement preserves pauses and required core with CAS and external audit', async () => {
  const f = await fixture(), routes = new Map<string, any>();
  const app = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (url: string, handler: any) => routes.set(`${method} ${url}`, handler)]));
  registerGenerationRoutes(app as any, f.engine, { basePath: '/operator', operator: true });
  const old = f.engine.store.policy(f.target.projectId);
  const baseline = f.engine.updatePolicy(f.target.projectId, { allowExperimental: false, videoPaused: true, allowedCoreFamilies: ['yz_h3'], reason: '用户暂停' }, old.revision);
  const invoke = async (body: unknown) => { let status = 200, data: any; const res = { status(n: number) { status = n; return this; }, json(value: unknown) { data = value; return this; } }; await routes.get('patch /operator/projects/:id/policy')({ params: { id: f.target.projectId }, body }, res); return { status, data }; };
  assert.equal((await invoke({ expectedRevision: baseline.revision, patch: { videoPaused: false, allowExperimental: true }, notes: '不能越过暂停' })).status, 403);
  const accepted = await invoke({ expectedRevision: baseline.revision, patch: { allowExperimental: true }, notes: '用户授权在本项目测试多素材组合；暂停继续保留。' });
  assert.equal(accepted.status, 200); assert.equal(accepted.data.policy.videoPaused, true); assert.equal(accepted.data.policy.reason, '用户暂停'); assert.deepEqual(accepted.data.policy.allowedCoreFamilies, ['yz_h3']);
  assert.equal(f.engine.store.list<any>('policy-review', f.target.projectId)[0].reviewer, 'external_agent');
  assert.equal((await invoke({ expectedRevision: baseline.revision, patch: { allowExperimental: false }, notes: '旧版本不得覆盖' })).status, 409);
});
test('old provider POST boundaries reject generation while allowing queries and text', () => {
  let middleware: any; registerGenerationBoundary({ use: (_: string, handler: any) => { middleware = handler; } } as any);
  for (const [method, route, body, blocked] of [['POST', '/comfyui-api/tasks', {}, true], ['POST', '/kie-grok-image', {}, true], ['POST', '/gemini', { action: 'generateVideos' }, true], ['POST', '/gemini', { action: 'generateContent' }, false], ['GET', '/comfyui-api/tasks/old', {}, false]] as const) {
    let status = 200, passed = false; const res = { status(n: number) { status = n; return this; }, json() { return this; } };
    middleware({ method, path: route, body }, res, () => { passed = true; }); assert.equal(passed, !blocked); assert.equal(status, blocked ? 409 : 200);
  }
});

test('asset production board and clean reference have distinct task identities', async () => {
  const { generationTargetKey } = await import('../packages/domain/src/generation');
  const f = await fixture(); assert.notEqual(generationTargetKey({ ...f.target, kind: 'asset', assetId: 'a', referenceMode: 'clean_reference' }), generationTargetKey({ ...f.target, kind: 'asset', assetId: 'a', referenceMode: 'production_board' }));
});
test('frozen media corruption is detected before upload or reuse', async () => {
  const f = await fixture(), frozen = await f.engine.media.freeze('/media/input.png', 'image');
  await fs.writeFile(await f.engine.media.localPath(frozen.mediaUrl), 'changed');
  await assert.rejects(f.engine.media.asDataURL(frozen.mediaUrl, 'image'), /内容发生变化/);
  await assert.rejects(f.engine.media.freeze('/media/input.png', 'image'), /内容发生变化/);
});
test('bounded grant fixes target and core revision and rejects changes outside range', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan, 'valid plan required');
  const { generationTargetKey } = await import('../packages/domain/src/generation');
  const grant = f.engine.grant({ projectId: f.target.projectId, kind: 'bounded_scope', planIds: [], targetKeys: [generationTargetKey(f.target)], operations: ['asset_image'], coreFamilies: [f.cap.coreFamily], allowedRecipeHashes: [f.cap.fixedCoreHash], parameterRanges: { steps: { min: 4, max: 16 } }, maxAttempts: 2, allowUnknownCost: true, expiresAt: Date.now() + 60000 });
  assert.doesNotThrow(() => f.engine.assertAllowed(plan, grant));
  assert.throws(() => f.engine.assertAllowed({ ...plan, parameters: { ...plan.parameters, steps: 32 } }, grant), /参数超出/);
  assert.throws(() => f.engine.assertAllowed({ ...plan, target: { ...plan.target, shotIds: ['other'] } }, grant), /目标不在/);
});
test('batch rejection rolls back execution and attempt reservations atomically', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan, 'valid plan required'); const grant = f.allow([plan.id], 2);
  const routes = new Map<string, any>(), app = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (url: string, handler: any) => routes.set(`${method} ${url}`, handler)]));
  registerGenerationRoutes(app as any, f.engine, { basePath: '/generation' });
  let status = 200; const res = { status(n: number) { status = n; return this; }, json() { return this; } };
  await routes.get('post /generation/batches')({ body: { grantId: grant.id, plans: [{ planRevisionId: plan.id, planHash: plan.planHash, idempotencyKey: randomUUID() }, { planRevisionId: plan.id, planHash: 'wrong', idempotencyKey: randomUUID() }] } }, res);
  assert.equal(status, 409); assert.equal(f.engine.store.list('execution', f.target.projectId).length, 0); assert.equal(f.engine.store.get<any>('grant', grant.id).usedAttempts, 0);
});
test('dispatch leases exclude concurrent processes and can be released', async () => {
  const { GenerationLease } = await import('../src/server/generation/lease'); const first = new GenerationLease(db), second = new GenerationLease(db), key = randomUUID();
  const release = first.acquire(key); assert.ok(release, 'first process must acquire'); assert.equal(second.acquire(key), undefined); release(); const next = second.acquire(key); assert.ok(next, 'next process acquires after release'); next();
});
test('local crop executes real media processing and registers a separate reference', async () => {
  const f = await fixture(), { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x32', '-frames:v', '1', '-y', path.join(f.media, 'input.png')]);
  const task = f.engine.create({ target: f.target, operation: 'crop', commandId: randomUUID() });
  const updated = f.engine.update(task.id, { expectedRevision: 1, patch: { parameters: { ...task.parameters, cropWidth: { value: 32, source: 'user', locked: false }, cropHeight: { value: 16, source: 'user', locked: false } } } });
  const { plan, issues } = await f.engine.preflight(task.id, updated.revision); assert.ok(plan, JSON.stringify(issues));
  const grant = f.engine.grant({ projectId: f.target.projectId, kind: 'fixed_plans', planIds: [plan.id], operations: ['crop'], coreFamilies: ['local_media'], maxAttempts: 1, allowUnknownCost: false, expiresAt: Date.now() + 60000 });
  const { GenerationProviders } = await import('../src/server/generation/providers');
  f.engine.providers.submit = GenerationProviders.prototype.submit.bind(f.engine.providers); f.engine.providers.poll = GenerationProviders.prototype.poll.bind(f.engine.providers);
  const execution = f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID()); await f.engine.process(execution.id); const result = f.engine.execution(execution.id);
  assert.equal(result.status, 'succeeded', result.error); assert.equal(result.results[0].width, 32); assert.equal(result.results[0].height, 16);
  assert.equal(f.engine.store.list<any>('imported-reference', f.target.projectId)[0].derivedFrom.operation, 'crop');
});

test('delegated dependency waits for formal adoption then submits once within original grant', async () => {
  const f = await fixture(), { generationTargetKey } = await import('../packages/domain/src/generation');
  const { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan, 'upstream plan required');
  const first = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
  f.engine.providers.poll = async () => ({ status: 'succeeded', outputs: [{ url: '/media/input.png', kind: 'image' }] }); f.engine.media.inspect = async () => ({ width: 1, height: 1, durationSeconds: undefined }); await f.engine.process(first.id);
  const sourceResult = f.engine.execution(first.id).results[0];
  let task = f.engine.create({ target: f.target, operation: 'asset_image', commandId: randomUUID() });
  task = f.engine.update(task.id, { expectedRevision: task.revision, patch: { references: [{ ...f.reference, id: 'dependency', mediaUrl: '/media/forged.png', status: 'adopted', dependency: { taskId: f.task.id, condition: 'adopted_current' } }] } });
  const grant = f.engine.grant({ projectId: f.target.projectId, kind: 'bounded_scope', planIds: [], targetKeys: [generationTargetKey(f.target)], operations: ['asset_image'], coreFamilies: [f.cap.coreFamily], allowedRecipeHashes: [f.cap.fixedCoreHash], maxAttempts: 1, allowUnknownCost: true, expiresAt: Date.now() + 60000 });
  const [job] = f.engine.schedule([task.id], grant.id, randomUUID()); await f.engine.processScheduled(job as any);
  assert.equal(f.engine.store.get<any>('scheduled-task', job.id).status, 'waiting'); assert.equal(f.engine.store.get<any>('grant', grant.id).usedAttempts, 0);
  f.engine.review(first.id, sourceResult.id, 'adopted', (dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any).productionRevision, 'isolated adoption');
  await f.engine.processScheduled(f.engine.store.get<any>('scheduled-task', job.id)); const scheduled = f.engine.store.get<any>('scheduled-task', job.id);
  assert.equal(scheduled.status, 'submitted', scheduled.error); const execution = f.engine.execution(scheduled.executionId), frozen = f.engine.plan(execution.planId);
  assert.notEqual(frozen.references[0].mediaUrl, '/media/forged.png'); assert.equal(frozen.references[0].mediaVersionId, sourceResult.id); assert.equal(f.engine.store.get<any>('grant', grant.id).usedAttempts, 1);
});
test('real extraction uses decoded video tail rather than a planned board image', async () => {
  const f = await fixture(), { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=64x32:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(f.media, 'tail.mp4')]);
  const task = f.engine.create({ target: f.target, operation: 'extract_frame', commandId: randomUUID() });
  const reference = { ...f.reference, id: 'motion', mediaKind: 'video' as const, role: 'motion' as const, mediaUrl: '/media/tail.mp4', mediaVersionId: 'actual-video' };
  f.engine.store.put('imported-reference', `${f.target.projectId}:motion`, f.target.projectId, reference);
  const edited = f.engine.update(task.id, { expectedRevision: 1, patch: { references: [reference] } }); const { plan, issues } = await f.engine.preflight(task.id, edited.revision); assert.ok(plan, JSON.stringify(issues));
  const grant = f.engine.grant({ projectId: f.target.projectId, kind: 'fixed_plans', planIds: [plan.id], operations: ['extract_frame'], coreFamilies: ['local_media'], maxAttempts: 1, allowUnknownCost: false, expiresAt: Date.now() + 60000 });
  const { GenerationProviders } = await import('../src/server/generation/providers'); f.engine.providers.submit = GenerationProviders.prototype.submit.bind(f.engine.providers); f.engine.providers.poll = GenerationProviders.prototype.poll.bind(f.engine.providers);
  const execution = f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID()); await f.engine.process(execution.id); const result = f.engine.execution(execution.id);
  assert.equal(result.status, 'succeeded', result.error); assert.equal(result.results[0].width, 64); assert.equal(result.results[0].height, 32); assert.equal(f.engine.store.list<any>('imported-reference', f.target.projectId).find(r => r.derivedFrom)?.derivedFrom.operation, 'extract_frame');
});

test('LoRA switches retain the chosen strength while compiled disabled contribution is zero', () => {
  const config = makeConfig(); (config.comfyWorkflows[0].workflowJson as any)['55'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'motion_speed_lora.safetensors', strength_model: 3, model: ['1', 0] } };
  const recipe = buildGenerationCatalog(config)[0]; assert.equal(recipe.capability.parameters.find(p => p.key === 'lora_55')?.enabledBy, 'lora_enabled_55');
  const parameters = { steps: 8, lora_55: 3, lora_enabled_55: false };
  const compiled = compileComfyGraph(recipe.template!, { prompt: '画面', width: 512, height: 288, aspectRatio: '16:9', images: ['one.png'], seed: 1, parameters });
  assert.equal(compiled['55'].inputs.strength_model, 0); assert.equal(parameters.lora_55, 3);
});

test('removed target retains readable task history and prevents false current adoption', async () => {
  const f = await fixture(), { GenerationError } = await import('../packages/domain/src/generation');
  (f.engine as any).context = () => { throw new GenerationError('TARGET_NOT_FOUND', '原目标已删除', 404); };
  const workspace = f.engine.workspace(f.target); assert.equal(workspace.sourceHash, 'target-missing'); assert.equal(workspace.tasks[0].id, f.task.id); await assert.rejects(f.engine.preflight(f.task.id, 1), /原目标已删除/);
});

test.after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });

test('workflow output size is inherited instead of being replaced by a global default', () => {
  const recipe = buildGenerationCatalog(makeConfig())[0];
  assert.equal(recipe.capability.defaults.width, 512);
  assert.equal(recipe.capability.defaults.height, 288);
  const config = makeConfig(); config.comfyWorkflows[0].api!.aspectRatios = ['9:16', '1:1'];
  assert.deepEqual(buildGenerationCatalog(config)[0].capability.parameters.find(p => p.key === 'aspectRatio')?.choices, ['9:16', '1:1']);
});

test('new portrait draft keeps workflow resolution and has a matching output aspect', async () => {
  const f = await fixture();
  dbHelpers.updateProjectMeta(f.target.projectId, { aspectRatio: '9:16' });
  const task = f.engine.create({ target: f.target, operation: 'asset_image', commandId: randomUUID() });
  assert.equal(task.parameters.width.value, 288);
  assert.equal(task.parameters.height.value, 512);
  assert.ok(!validateGenerationDraft(task, f.cap).some(i => i.code === 'OUTPUT_ASPECT_MISMATCH'));
});

test('scene workspace returns distinct source and reference context for each task target', async () => {
  const f = await fixture();
  const otherTarget = { ...f.target, shotIds: ['other-shot'] };
  const engine = new GenerationEngine(f.engine.store, f.getConfig, f.media, target => ({ ...f.engine.context(target), sourceHash: target.shotIds[0], references: [{ ...f.reference, label: target.shotIds[0] }] }));
  const other = engine.create({ target: otherTarget, operation: 'asset_image', commandId: randomUUID() });
  const workspace = engine.workspace(f.target);
  const { generationTargetKey } = await import('../packages/domain/src/generation');
  assert.equal(workspace.sources?.[generationTargetKey(other.target)].sourceHash, 'other-shot');
  assert.equal(workspace.sources?.[generationTargetKey(f.target)].sourceHash, f.target.shotIds[0]);
  assert.equal(workspace.sources?.[generationTargetKey(other.target)].references[0].label, 'other-shot');
});

test('adopting a replacement demotes the historical result and allows explicit restoration', async () => {
  const f = await fixture();
  f.engine.providers.poll = async () => ({ status: 'succeeded', outputs: [{ url: '/media/input.png', kind: 'image' }] });
  f.engine.media.inspect = async () => ({ width: 1, height: 1, durationSeconds: undefined });
  const generate = async () => {
    const { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
    const e = f.engine.submit(plan.id, plan.planHash, f.allow([plan.id]).id, randomUUID());
    await f.engine.process(e.id); return f.engine.execution(e.id);
  };
  const a = await generate(), b = await generate();
  const revision = () => (dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any).productionRevision;
  f.engine.review(a.id, a.results[0].id, 'adopted', revision(), '第一版');
  f.engine.review(b.id, b.results[0].id, 'adopted', revision(), '第二版');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(a.id)).results[0].review, 'superseded');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(b.id)).results[0].review, 'adopted');
  f.engine.review(a.id, a.results[0].id, 'adopted', revision(), '恢复第一版');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(a.id)).results[0].review, 'adopted');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(b.id)).results[0].review, 'superseded');
});

test('returning an adopted shot to review removes current media, preserves history and checks revision', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const imported = await f.engine.importResult(plan.id, '/media/input.png', randomUUID()), result = imported.results[0];
  const read = () => dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  f.engine.review(imported.id, result.id, 'adopted', read().productionRevision, '已检查');
  assert.throws(() => f.engine.review(imported.id, result.id, 'needs_changes', -1, '退回复核'), /版本/);
  assert.equal(read().scenes[0].shots[0].activeTakeId, result.candidateId);
  const returned = f.engine.review(imported.id, result.id, 'needs_changes', read().productionRevision, '动作错误');
  assert.equal(returned.results[0].review, 'needs_changes');
  assert.equal(read().scenes[0].shots[0].activeTakeId, undefined); assert.equal(read().scenes[0].shots[0].imageUrl, undefined);
  assert.ok(read().scenes[0].shots[0].takes.some((take: any) => take.id === result.candidateId));
});

test('image and video reviews follow their own media ownership across combined takes', async () => {
  const f = await fixture();
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  await promisify(execFile)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=16x16:r=24:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(f.media, 'clip.mp4')]);
  const read = () => dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  const shot = () => read().scenes[0].shots[0];
  const { plan: imagePlan } = await f.engine.preflight(f.task.id, f.task.revision); assert.ok(imagePlan);
  const image = await f.engine.importResult(imagePlan.id, '/media/input.png', randomUUID());
  f.engine.review(image.id, image.results[0].id, 'adopted', read().productionRevision, '已核对图片');
  const config = f.getConfig();
  config.comfyWorkflows.push({ id: 'native', name: 'Native H3', channelId: 'service', kind: 'minimax_h3_reference_video', workflowJson: {}, mappings: [] });
  config.models.push({ id: 'native', alias: 'Native H3', modelId: 'MiniMax-H3', channelId: 'service', capabilities: ['video'], comfyWorkflowId: 'native' }); f.setConfig(config);
  await reviewFixtureStage(f.engine.quality, 'visuals', f.target);
  const task = f.engine.create({ target: f.target, operation: 'video', commandId: randomUUID() });
  const { plan: videoPlan, issues } = await f.engine.preflight(task.id, task.revision); assert.ok(videoPlan, JSON.stringify(issues));
  const video = await f.engine.importResult(videoPlan.id, '/media/clip.mp4', randomUUID());
  f.engine.review(video.id, video.results[0].id, 'adopted', read().productionRevision, '已核对视频');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(image.id)).results[0].review, 'adopted');
  f.engine.review(image.id, image.results[0].id, 'needs_changes', read().productionRevision, '退回图片');
  assert.equal(shot().imageUrl, undefined); assert.equal(shot().videoUrl, video.results[0].mediaUrl);
  assert.equal(shot().takes.find((take: any) => take.id === shot().activeTakeId).imageUrl, undefined, 'active composite take must not expose the rejected inherited image');
  assert.equal(shot().takes.find((take: any) => take.id === image.results[0].candidateId).imageUrl, image.results[0].mediaUrl, 'original image history is retained');
  f.engine.review(image.id, image.results[0].id, 'adopted', read().productionRevision, '重新核对图片');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(video.id)).results[0].review, 'adopted');
  f.engine.review(video.id, video.results[0].id, 'needs_changes', read().productionRevision, '退回视频');
  assert.equal(shot().videoUrl, undefined); assert.equal(shot().imageUrl, image.results[0].mediaUrl);
  assert.equal(shot().takes.find((take: any) => take.id === shot().activeTakeId).videoUrl, undefined);
  const replacement = await f.engine.importResult(imagePlan.id, '/media/input.png', randomUUID());
  f.engine.review(replacement.id, replacement.results[0].id, 'adopted', read().productionRevision, '采用同字节的新候选');
  f.engine.review(image.id, image.results[0].id, 'needs_changes', read().productionRevision, '退回历史候选');
  assert.equal(shot().imageUrl, replacement.results[0].mediaUrl);
  assert.equal(shot().imageMedia.generationJobId, replacement.id, 'same URL does not transfer ownership to the older result');
  assert.equal(f.engine.refreshResultReview(f.engine.execution(replacement.id)).results[0].review, 'adopted');
  assert.equal(f.submits(), 0);
});

test('returning an adopted asset preserves the other reference mode and restores its review candidate', async () => {
  const f = await fixture();
  const { buildVideoStoryboardAssetBoardPlan } = await import('../src/services/production/videoStoryboardAssetBoards');
  dbHelpers.updateProjectMeta(f.target.projectId, { assets: [{ id: 'cup', name: '杯子', type: 'prop', description: '有把手的杯子',
    boardImageUrl: '/media/keep-board.png', multiViewUrl: '/media/keep-board.png', referenceImageUrl: '/media/input.png' }] } as any);
  const board = buildVideoStoryboardAssetBoardPlan(dbHelpers.getProjectById(f.target.projectId) as any).propBoards[0];
  const engine = new GenerationEngine(f.engine.store, f.getConfig, f.media);
  const target: GenerationTarget = { projectId: f.target.projectId, kind: 'asset', assetId: board.id, referenceMode: 'clean_reference', shotIds: [] };
  engine.store.put('imported-reference', `${f.target.projectId}:${f.reference.id}`, f.target.projectId, f.reference);
  const draft = engine.create({ target, operation: 'asset_image', commandId: randomUUID() });
  const task = engine.update(draft.id, { expectedRevision: draft.revision, patch: { references: [f.reference] } });
  const { plan, issues } = await engine.preflight(task.id, task.revision); assert.ok(plan, JSON.stringify(issues));
  const imported = await engine.importResult(plan.id, '/media/input.png', randomUUID()), result = imported.results[0];
  engine.review(imported.id, result.id, 'adopted', 0, '核对杯身和把手');
  const read = () => dbHelpers.getProjectById(f.target.projectId) as any;
  assert.equal(read().assets[0].cleanReferenceImageUrl, result.mediaUrl);
  const returned = engine.review(imported.id, result.id, 'needs_changes', 0, '把手形状错误');
  assert.equal(returned.results[0].review, 'needs_changes');
  assert.equal(read().assets[0].cleanReferenceImageUrl, undefined);
  assert.equal(read().assets[0].boardImageUrl, '/media/keep-board.png'); assert.equal(read().assets[0].multiViewUrl, '/media/keep-board.png');
  assert.ok(!read().manualProductionAssets.references.some((ref: any) => ref.candidateId === result.candidateId));
  const candidate = read().manualProductionAssets.pendingReferences.find((ref: any) => ref.id === result.candidateId);
  assert.equal(candidate.imageUrl, result.mediaUrl); assert.equal(candidate.review.status, 'pending');
  assert.equal(candidate.review.notes, '把手形状错误'); assert.equal(candidate.sourceRunId, imported.id);
});

test('independent generation owns no synthetic production project and rejects mixed targets', async () => {
  const { loadGenerationContext } = await import('../src/server/generation/context');
  const { GLOBAL_GENERATION_SCOPE } = await import('../packages/domain/src/generation');
  const target: GenerationTarget = { projectId: GLOBAL_GENERATION_SCOPE, kind: 'scratch', scratchId: 'independent-test', shotIds: [] };
  assert.equal(loadGenerationContext(target).project.id, GLOBAL_GENERATION_SCOPE);
  assert.equal(dbHelpers.getProjectById(GLOBAL_GENERATION_SCOPE), null);
  assert.throws(() => loadGenerationContext({ ...target, sceneId: 'unrelated-scene' }), /临时任务/);
  assert.throws(() => loadGenerationContext({ ...target, projectId: 'missing-project' }), /不存在/);
});

test('legacy image and native H3 recipes preserve their configured core without rewriting settings', () => {
  const config = makeConfig();
  config.channels.push({ id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '' });
  config.models.push({ id: 'dalle', modelId: 'dall-e-3', alias: 'Original image model', channelId: 'openai', capabilities: ['image'] });
  config.comfyWorkflows.push({ id: 'native', name: 'Native H3', channelId: 'service', kind: 'minimax_h3_reference_video', workflowJson: {}, mappings: [] });
  config.models.push({ id: 'native', alias: 'Native H3', modelId: 'MiniMax-H3', channelId: 'service', capabilities: ['video'], comfyWorkflowId: 'native' });
  const before = JSON.stringify(config), catalog = buildGenerationCatalog(config);
  assert.equal(catalog.find(r => r.legacyModelIds.includes('dalle'))?.capability.inputs.image.max, 0);
  const native = catalog.find(r => r.legacyModelIds.includes('native'))!;
  assert.ok(native); assert.notEqual(native.capability.coreFamily, 'yz_h3');
  assert.equal(native.capability.maxDuration, 14);
  const graph = compileComfyGraph(native.template!, { prompt: '动作', aspectRatio: '16:9', duration: 14, width: 1024, height: 576, seed: 1, images: ['one.png'], parameters: { steps: 10 } });
  assert.equal(graph['6'].inputs['ref_images.ref_image_1'], undefined);
  assert.ok(Number(graph['6'].inputs.length) / 24 <= 14);
  assert.equal(JSON.stringify(config), before);
});

test('generation plan candidates retain exact evidence and reject mismatched prompt/model', async () => {
  const { createVisualImageCandidate } = await import('../src/services/production/visualImageCandidate');
  const f = await fixture(); const result = await f.engine.preflight(f.task.id, f.task.revision);
  const plan = result.plan!; assert.ok(plan);
  const input = { kind: 'base' as const, imageUrl: '/media/result.png', prompt: plan.prompt, modelId: plan.capability.modelConfigId, generationPlan: plan, sourceContentHash: 'a'.repeat(64) };
  assert.deepEqual(createVisualImageCandidate(input).generationPlan, plan);
  assert.throws(() => createVisualImageCandidate({ ...input, prompt: 'different' }), /编译审计/);
  assert.throws(() => createVisualImageCandidate({ ...input, modelId: 'different' }), /编译审计/);
});

test('reference provenance does not force continuity, but out-of-range video boards are rejected', async () => {
  const f = await fixture();
  const task = { ...f.task, references: [{ ...f.reference, sourceShotIds: ['previous-scene-shot'], shotIds: ['previous-scene-shot'], role: 'composition' as const }] };
  assert.equal(validateGenerationDraft(task, f.cap).some(i => i.code === 'REFERENCE_SCOPE'), false);
  const video = { ...f.cap, mediaKind: 'video' as const, mode: 'board_guided_video' as const, multiShot: true, allowedOperations: ['video' as const], minDuration: 1, maxDuration: 14, inputs: { ...f.cap.inputs, image: { min: 1, max: 2, roles: ['board_sequence' as const] } } };
  assert.ok(validateGenerationDraft({ ...task, operation: 'video', references: [{ ...task.references[0], role: 'board_sequence' }] }, video).some(i => i.code === 'REFERENCE_SCOPE'));
});

test('whole-scene board creates, imports and adopts without video units, preserves history and rejects stale work', async () => {
  const f = await fixture();
  const episode = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  const first = episode.scenes[0].shots[0];
  first.imageUrl = '/media/input.png'; first.videoUrl = '/media/keep-existing.mp4';
  episode.scenes[0].shots.push({ ...first, id: `${first.id}-second`, duration: 9 }, { ...first, id: `${first.id}-third`, duration: 8 });
  dbHelpers.updateEpisode(f.target.projectId, episode.id, episode);
  const engine = new GenerationEngine(f.engine.store, f.getConfig, f.media);
  const target: GenerationTarget = { ...f.target, kind: 'scene', shotIds: [first.id, `${first.id}-second`, `${first.id}-third`] };
  const task = engine.create({ target, operation: 'joint_storyboard', commandId: randomUUID() });
  assert.deepEqual(task.storyboardLayout, { columns: 2, rows: 2, shotIds: target.shotIds });
  assert.match(task.prompt, /切镜意图/);
  assert.throws(() => engine.create({ target, operation: 'video', commandId: randomUUID() }), /视频片段/);
  await reviewFixturePreparation(engine.quality, target);
  const { plan, issues } = await engine.preflight(task.id, task.revision); assert.ok(plan, JSON.stringify(issues));
  assert.match(plan.prompt, /2 列 × 2 行/);
  const command = randomUUID(), result = await engine.importResult(plan.id, '/media/input.png', command);
  assert.equal(result.origin, 'external'); assert.equal(result.results[0].review, 'pending');
  assert.equal((await engine.importResult(plan.id, '/media/input.png', command)).id, result.id);
  const read = () => dbHelpers.getEpisodeById(target.projectId, target.episodeId!) as any;
  assert.equal(read().scenes[0].visualPlan, undefined);
  assert.equal(read().scenes[0].shots[0].takes, undefined, 'whole scene must never become first-shot candidate');
  engine.review(result.id, result.results[0].id, 'adopted', read().productionRevision, 'Verified mapping in isolated fixture');
  assert.equal(read().scenes[0].visualPlan.overview.candidateId, result.results[0].id);
  assert.equal(read().scenes[0].manualStoryboard.boards, undefined, 'whole-scene adoption preserves director plan without creating video units');
  assert.equal(read().scenes[0].shots[0].videoUrl, '/media/keep-existing.mp4');
  const second = await engine.importResult(plan.id, '/media/input.png', randomUUID());
  engine.review(second.id, second.results[0].id, 'adopted', read().productionRevision, 'Second candidate');
  assert.equal(read().scenes[0].visualPlan.overviewHistory.length, 1);
  assert.equal(engine.refreshResultReview(engine.execution(result.id)).results[0].review, 'superseded');
  const changed = read(); changed.scenes[0].shots[0].visualAction = '改变了事件'; dbHelpers.updateEpisode(target.projectId, target.episodeId!, changed);
  assert.equal(engine.refreshResultReview(engine.execution(second.id)).results[0].review, 'source_changed');
  await assert.rejects(engine.importResult(plan.id, '/media/input.png', randomUUID()), /已变化/);
  const returned = engine.review(second.id, second.results[0].id, 'needs_changes', read().productionRevision, '发现空间问题，退回');
  assert.equal(returned.results[0].review, 'needs_changes'); assert.equal(read().scenes[0].visualPlan.overview, undefined);
  assert.equal(read().scenes[0].visualPlan.overviewHistory.length, 2, 'returned overview remains in history');
  assert.equal(read().scenes[0].shots[0].videoUrl, '/media/keep-existing.mp4');
});

test('external imports share operator context, require access and cannot masquerade as creator adoption', async () => {
  const f = await fixture(), express = (await import('express')).default;
  const app = express(); app.use(express.json());
  registerGenerationRoutes(app, f.engine, { basePath: '/operator', operator: true, assertProjectAccess: id => { if (id !== f.target.projectId) throw new Error('access denied'); } });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/operator`;
  try {
    const context = await (await fetch(`${base}/context?target=${encodeURIComponent(JSON.stringify(f.target))}`)).json();
    assert.equal(context.sourceHash, f.task.sourceHash); assert.equal(context.shots[0].id, f.target.shotIds[0]);
    const referenceResponse = await fetch(`${base}/references`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: f.target.projectId, mediaUrl: '/media/input.png', mediaKind: 'image', role: 'composition', label: 'external spatial reference' }) });
    assert.equal(referenceResponse.status, 200);
    const importedReference = (await referenceResponse.json()).reference;
    assert.equal(importedReference.source, 'ai'); assert.equal(importedReference.locked, false);
    const { plan } = await f.engine.preflight(f.task.id, f.task.revision); assert.ok(plan);
    const response = await fetch(`${base}/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planRevisionId: plan.id, mediaUrl: '/media/input.png', commandId: 'external-one' }) });
    assert.equal(response.status, 201); const { execution } = await response.json();
    const adopt = await fetch(`${base}/executions/${execution.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId: execution.results[0].id, verdict: 'adopted' }) });
    assert.equal(adopt.status, 409); assert.equal((await adopt.json()).code, 'REVIEW_EVIDENCE_REQUIRED'); assert.equal(f.submits(), 0);
    const reviewed = await fetch(`${base}/executions/${execution.id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resultId: execution.results[0].id, verdict: 'adopted', expectedRevision: f.engine.context(f.target).episode!.productionRevision, contentHash: execution.results[0].contentHash, sourceHash: plan.sourceHash, notes: '隔离HTTP测试：已读取并检查测试PNG；外部身份不得由请求伪造。', reviewer: 'creator' }) });
    assert.equal(reviewed.status, 200);
    assert.equal(f.engine.store.list<any>('review', f.target.projectId)[0].reviewer, 'external_agent');
    const denied = await fetch(`${base}/context?target=${encodeURIComponent(JSON.stringify({ ...f.target, projectId: 'not-authorized' }))}`); assert.notEqual(denied.status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('specified video cut frame is measured, bounded and stored as neutral reference', async () => {
  const f = await fixture(), { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x32:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x32:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(f.media, 'cut.mp4')]);
  const reference = { ...f.reference, id: 'cut-video', mediaKind: 'video' as const, role: 'motion' as const, mediaUrl: '/media/cut.mp4', mediaVersionId: 'cut-video-v1', sourceShotIds: ['previous-shot'] };
  f.engine.store.put('imported-reference', `${f.target.projectId}:cut`, f.target.projectId, reference);
  let task = f.engine.create({ target: f.target, operation: 'extract_frame', commandId: randomUUID() });
  const setTime = (time: number) => { task = f.engine.update(task.id, { expectedRevision: task.revision, patch: { references: [reference], parameters: { ...task.parameters, framePosition: { value: 'time', source: 'user', locked: false }, frameTimeSeconds: { value: time, source: 'user', locked: false } } } }); };
  setTime(2); assert.ok((await f.engine.preflight(task.id, task.revision)).issues.some(i => i.code === 'FRAME_TIME_BOUNDS'));
  setTime(.4); const { plan, issues } = await f.engine.preflight(task.id, task.revision); assert.ok(plan, JSON.stringify(issues));
  const { GenerationProviders } = await import('../src/server/generation/providers'); const provider = new GenerationProviders(f.getConfig, f.engine.media);
  f.engine.providers.submit = provider.submit.bind(provider); f.engine.providers.poll = provider.poll.bind(provider);
  const grant = f.engine.grant({ projectId: f.target.projectId, kind: 'fixed_plans', planIds: [plan.id], operations: ['extract_frame'], coreFamilies: ['local_media'], maxAttempts: 1, allowUnknownCost: false, expiresAt: Date.now() + 60000 });
  const execution = f.engine.submit(plan.id, plan.planHash, grant.id, randomUUID()); await f.engine.process(execution.id);
  const extracted = f.engine.execution(execution.id); assert.equal(extracted.status, 'succeeded', extracted.error);
  const ref = f.engine.store.list<GenerationReference>('imported-reference', f.target.projectId).find(r => r.derivedFrom)!;
  assert.equal(ref.role, 'composition'); assert.deepEqual(ref.sourceShotIds, ['previous-shot']); assert.equal(ref.derivedFrom?.frameTimeSeconds, .4);
  const file = await f.engine.media.localPath(extracted.results[0].mediaUrl);
  const pixel = await promisify(execFile)('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { encoding: 'buffer' });
  assert.ok(pixel.stdout[0] > pixel.stdout[2] + 100, 'chosen frame must be red at cut point, not blue at file tail');
});


test('scene reference images enter canonical context only for their intended boundary', async () => {
  const f = await fixture(), { loadGenerationContext } = await import('../src/server/generation/context');
  const { emptySceneVisualPlan } = await import('../src/services/production/sceneVisualPlan');
  const episode = dbHelpers.getEpisodeById(f.target.projectId, f.target.episodeId!) as any;
  const scene = episode.scenes[0], firstId = scene.shots[0].id, otherId = `${firstId}-other`;
  scene.shots.push({ ...scene.shots[0], id: otherId });
  scene.visualPlan = { ...emptySceneVisualPlan(), references: [{ id: 'space', role: 'space', imageUrl: '/media/input.png', note: '房间与主光源' }, { id: 'boundary', role: 'boundary', imageUrl: '/media/input.png', beforeShotId: otherId, note: '只继承持物状态' }] };
  dbHelpers.updateEpisode(f.target.projectId, episode.id, episode);
  const first = loadGenerationContext(f.target);
  assert.deepEqual(first.references.filter(r => r.id.startsWith('scene-reference:')).map(r => r.label), ['房间与主光源']);
  const other = loadGenerationContext({ ...f.target, shotIds: [otherId] });
  assert.deepEqual(other.references.filter(r => r.id.startsWith('scene-reference:')).map(r => r.role), ['environment', 'composition']);
  const latest = dbHelpers.getEpisodeById(f.target.projectId, episode.id) as any; latest.scenes[0].visualPlan.references[0].note = '改为背光'; dbHelpers.updateEpisode(f.target.projectId, episode.id, latest);
  assert.notEqual(loadGenerationContext(f.target).sourceHash, first.sourceHash);
});


test('direct execution needs no grant, remains idempotent and rechecks pause before dispatch and resume', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const key = randomUUID();
  const e = f.engine.submit(plan.id, plan.planHash, undefined, key);
  assert.equal(e.grantId, '');
  assert.equal(f.engine.store.list('grant', f.target.projectId).length, 0);
  assert.equal(f.engine.submit(plan.id, plan.planHash, undefined, key).id, e.id);
  let policy = f.engine.store.policy(f.target.projectId);
  f.engine.updatePolicy(f.target.projectId, { imagePaused: true }, policy.revision);
  assert.throws(() => f.engine.submit(plan.id, plan.planHash, undefined, randomUUID()), /暂停/);
  await f.engine.process(e.id);
  assert.equal(f.engine.execution(e.id).status, 'held'); assert.equal(f.submits(), 0);
  policy = f.engine.store.policy(f.target.projectId);
  f.engine.updatePolicy(f.target.projectId, { imagePaused: false }, policy.revision);
  await f.engine.resume(e.id);
  assert.equal(f.submits(), 1);
  f.setSource('new-source');
  assert.throws(() => f.engine.submit(plan.id, plan.planHash, undefined, randomUUID()), /上游来源/);
});

test('operator execution route accepts a checked plan without grant fields', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const routes = new Map<string, any>();
  const app = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (url: string, handler: any) => routes.set(`${method} ${url}`, handler)]));
  f.engine.tick = async () => {};
  registerGenerationRoutes(app as any, f.engine, { basePath: '/operator', operator: true });
  let status = 200, data: any;
  const res = { status(n: number) { status = n; return this; }, json(value: unknown) { data = value; return this; } };
  await routes.get('post /operator/executions')({ body: { planRevisionId: plan.id, planHash: plan.planHash, idempotencyKey: randomUUID() } }, res);
  assert.equal(status, 202); assert.equal(data.execution.status, 'queued');
  assert.equal(f.engine.store.list('grant', f.target.projectId).length, 0);
});

test('explicit dependency queue needs no grant and creates only one execution', async () => {
  const f = await fixture(), commandId = randomUUID();
  const [job] = f.engine.schedule([f.task.id], undefined, commandId);
  assert.equal(f.engine.schedule([f.task.id], undefined, commandId)[0].id, job.id);
  await f.engine.processScheduled(job);
  const stored = f.engine.store.get<any>('scheduled-task', job.id);
  assert.equal(stored.status, 'submitted');
  await f.engine.processScheduled(job);
  assert.equal(f.engine.store.list('execution', f.target.projectId).length, 1);
  assert.equal(f.engine.store.list('grant', f.target.projectId).length, 0);
});

test('quality failure holds a scheduled task until an explicit new queue request', async () => {
  const f = await fixture();
  const inspection = await f.engine.quality.inspect('project_plan', f.target);
  f.engine.quality.review(inspection.id, { verdict:'failed', reviewerName:'隔离测试导演',
    findings:qualityStages.project_plan.checks.map((check,index)=>({check,passed:index!==0,note:'隔离回归：总体仍需修正，不允许自动继续。'})),
  }, 'creator');
  const [job] = f.engine.schedule([f.task.id], undefined, randomUUID());
  await f.engine.processScheduled(job);
  const read = () => f.engine.store.get<any>('scheduled-task', job.id);
  assert.equal(read().status, 'held');
  await reviewFixtureStage(f.engine.quality, 'project_plan', f.target);
  await f.engine.processScheduled(read());
  f.engine.updatePolicy(f.target.projectId, { allowExperimental: false }, f.engine.store.policy(f.target.projectId).revision);
  await f.engine.processScheduled(read());
  assert.equal(read().status, 'held');
  assert.equal(f.engine.store.list('execution', f.target.projectId).length, 0);
  assert.equal(f.submits(), 0);
  f.engine.updatePolicy(f.target.projectId, { allowExperimental: true }, f.engine.store.policy(f.target.projectId).revision);
  const [resumed] = f.engine.schedule([f.task.id], undefined, randomUUID());
  await f.engine.processScheduled(resumed);
  assert.equal(f.engine.store.get<any>('scheduled-task', resumed.id).status, 'submitted');
  assert.equal(read().status, 'held', 'the old task and reason remain available');
});


test('grant-free batch is atomic and checks every project before execution', async () => {
  const f = await fixture(), { plan } = await f.engine.preflight(f.task.id, 1); assert.ok(plan);
  const routes = new Map<string, any>();
  const app = Object.fromEntries(['get', 'post', 'patch'].map(method => [method, (url: string, handler: any) => routes.set(`${method} ${url}`, handler)]));
  f.engine.tick = async () => {};
  registerGenerationRoutes(app as any, f.engine, { basePath: '/operator', operator: true, assertProjectAccess: id => assert.equal(id, f.target.projectId) });
  let status = 200, data: any;
  const res = { status(n: number) { status = n; return this; }, json(value: unknown) { data = value; return this; } };
  const first = { planRevisionId: plan.id, planHash: plan.planHash, idempotencyKey: randomUUID() };
  await routes.get('post /operator/batches')({ body: { plans: [first, { ...first, planHash: 'wrong', idempotencyKey: randomUUID() }] } }, res);
  assert.equal(status, 409); assert.equal(f.engine.store.list('execution', f.target.projectId).length, 0);
  await routes.get('post /operator/batches')({ body: { plans: [first] } }, res);
  assert.equal(status, 202); assert.equal(data.executions.length, 1);
  assert.equal(f.engine.store.list('grant', f.target.projectId).length, 0);
});


test('fresh operator context and preflight expose pacing evidence without altering a work', async () => {
  const f = await fixture();
  const { loadGenerationContext } = await import('../src/server/generation/context');
  const project = dbHelpers.getProjectById(f.target.projectId) as any, ep = project.episodes[0], scene = ep.scenes[0];
  scene.shots = ['a', 'b', 'c'].map(id => ({ id, duration:12, visualAction:'按开关，灯亮', editingNote:'灯亮后切人物反应，十二秒内完成观察与停顿', imagePrompt:'灯亮', videoPrompt:'灯亮', cameraMovement:'缓慢推进' }));
  dbHelpers.updateEpisode(project.id, ep.id, ep);
  await reviewFixturePreparation(f.engine.quality, { ...f.target, shotIds: ['a', 'b', 'c'] });
  const before = JSON.stringify(dbHelpers.getEpisodeById(project.id, ep.id));
  const target = { ...f.target, kind:'scene' as const, shotIds:[] };
  const engine = new GenerationEngine(f.engine.store, f.getConfig, f.media, loadGenerationContext);
  const express = (await import('express')).default;
  const app = express(); app.use(express.json()); registerGenerationRoutes(app, engine, {operator:true, basePath:"/api/operator/generation"});
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/operator/generation`;
    const response = await fetch(`${base}/context?target=${encodeURIComponent(JSON.stringify(target))}`);
    assert.equal(response.status, 200); const ctx = await response.json();
    assert.equal(ctx.timingReview.creativeStatus, 'not_assessed');
    assert.equal(ctx.productionWorkingAgreement, undefined, 'legacy works must not invent author preferences');
    const agreement = '作者约定：本单元三条候选；粗审一轮，仅明显大问题返工；达到约定上限交作者。';
    dbHelpers.updateProjectMeta(project.id, { productionWorkingAgreement: agreement });
    const fresh = await (await fetch(`${base}/context?target=${encodeURIComponent(JSON.stringify(target))}`)).json();
    assert.equal(fresh.productionWorkingAgreement, agreement);
    assert.equal(fresh.sourceHash, ctx.sourceHash, 'a working agreement must not invalidate authored media sources');
    const beforeRead = JSON.stringify(['task', 'candidate', 'execution'].map(kind => f.engine.store.list(kind as any, project.id)));
    const workspace = await (await fetch(`${base}/workspaces/current?target=${encodeURIComponent(JSON.stringify(target))}`)).json();
    assert.equal(workspace.productionWorkingAgreement, agreement);
    assert.equal(JSON.stringify(['task', 'candidate', 'execution'].map(kind => f.engine.store.list(kind as any, project.id))), beforeRead, 'reading preferences must not create candidates or retry jobs');
    const { buildOperatorProjectContext } = await import('../src/services/operator/context');
    assert.equal(buildOperatorProjectContext({project:dbHelpers.getProjectById(project.id) as any}).project.productionWorkingAgreement, agreement);
    assert.ok(ctx.timingReview.issues.some((i:any) => i.code === 'TIMING_UNIFORM_SCENE'));
    let task = engine.create({target, operation:'joint_storyboard', commandId:randomUUID()});
    const imported = await fetch(`${base}/references`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({projectId:project.id,mediaUrl:f.reference.mediaUrl,mediaKind:'image',role:'composition',label:'隔离检查图'})});
    assert.equal(imported.status,200); const ref=(await imported.json()).reference;
    task = engine.update(task.id, {expectedRevision:task.revision, patch:{references:[{...ref,enabled:true}]}});
    const checked = await engine.preflight(task.id, task.revision);
    assert.ok(checked.plan, JSON.stringify(checked.issues));
    assert.equal(checked.plan!.timingReview!.shots.length, 3);
    assert.ok(checked.issues.some(i=>i.code==='TIMING_BASIS_MISSING' && !i.blocking));
    assert.equal(checked.plan!.timingReview!.creativeStatus, 'not_assessed');
    assert.equal(JSON.stringify(dbHelpers.getEpisodeById(project.id, ep.id)), before);
    const revised = dbHelpers.getEpisodeById(project.id, ep.id) as any;
    revised.scenes[0].shots[0] = {...revised.scenes[0].shots[0], duration:6.8, motivation:'确认灯修好', editingNote:'点亮、反应后切电池，约6.8秒；实际切点按声音调整'};
    dbHelpers.updateEpisode(project.id, ep.id, revised);
    const stale = await engine.preflight(task.id, task.revision);
    assert.ok(stale.issues.some(i=>i.code==='SOURCE_CHANGED' && i.blocking));
    assert.ok(!stale.plan);
    const next = loadGenerationContext({...target, kind:'shot', shotIds:['a']});
    assert.equal(next.narrativeSeconds,6.8);
    assert.equal(next.timingReview!.shots[0].basisStatus,'described');
    assert.equal(next.timingReview!.creativeStatus,'not_assessed');
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});


test('new video drafts retain fractional narrative timing and sampling proposals do not replace duration', async () => {
  const f=await fixture(); const {loadGenerationContext}=await import('../src/server/generation/context');
  const project=dbHelpers.getProjectById(f.target.projectId) as any, ep=project.episodes[0], shot=ep.scenes[0].shots[0];
  shot.duration=0.4; shot.imageUrl='/media/input.png'; shot.motivation='开关跳下的插入'; shot.editingNote='只留触点落下，0.4秒后切人物；模型多余画面剪掉';
  dbHelpers.updateEpisode(project.id,ep.id,ep);
  const config=f.getConfig(); config.comfyWorkflows.push({id:'native',name:'Native H3',channelId:'service',kind:'minimax_h3_reference_video',workflowJson:{},mappings:[]});
  config.models.push({id:'native',alias:'Native H3',modelId:'MiniMax-H3',channelId:'service',capabilities:['video'],comfyWorkflowId:'native'});
  const engine=new GenerationEngine(f.engine.store,()=>config,f.media,loadGenerationContext);
  await reviewFixturePreparation(engine.quality, f.target);
  await reviewFixtureStage(engine.quality, 'visuals', f.target);
  let task=engine.create({target:f.target,operation:'video',commandId:randomUUID()});
  assert.equal(task.narrativeSeconds,0.4);
  assert.ok(Number(task.parameters.duration.value)>=engine.recipe(task.capabilityId).capability.minDuration);
  assert.ok(engine.workspace(f.target).sources?.[Object.keys(engine.workspace(f.target).sources!)[0]].timingReview);
  task=engine.update(task.id,{expectedRevision:task.revision,patch:{references:task.references.map(ref=>({...ref,role:'composition',enabled:ref.id.startsWith('frame:')}))}});
  const checked=await engine.preflight(task.id,task.revision); assert.ok(checked.plan,JSON.stringify(checked.issues));
  assert.equal(checked.plan!.narrativeSeconds,0.4); assert.equal(checked.plan!.timingReview!.creativeStatus,'not_assessed');
  const recipe=engine.recipe.bind(engine); engine.recipe=(id)=>{const result=recipe(id);result.presetVariants=[{id:'preset',label:'文戏标准',values:{duration:12,steps:10}}];return result;};
  const suggestion=engine.propose(task.id); assert.equal(suggestion.parameters.duration,undefined);
  assert.equal(engine.applyProposal(task.id,suggestion.id,task.revision).parameters.duration.value,task.parameters.duration.value);
});


test('review records an actual observation with internal save protection and no manual revision fields',async()=>{
 const f=await fixture();const {plan}=await f.engine.preflight(f.task.id,f.task.revision);assert.ok(plan);
 const result=await f.engine.importResult(plan.id,'/media/input.png',randomUUID());
 const reviewed=f.engine.review(result.id,result.results[0].id,'adopted',undefined,'看过当前测试图',{reviewer:'external_agent',observations:[{id:'observation',note:'构图可用，近景动作未验证',impact:'note',viewpointId:'wide'}]});
 assert.equal(reviewed.results[0].observations?.[0].reviewer,'external_agent');
 assert.equal(reviewed.results[0].review,'adopted');assert.equal(f.submits(),0);
 const count=f.engine.store.list('review',f.target.projectId).length;f.engine.workspace(f.target);f.engine.workspace(f.target);
 assert.equal(f.engine.store.list('review',f.target.projectId).length,count);
});
