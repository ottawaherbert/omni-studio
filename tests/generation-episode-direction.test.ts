import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Episode, Project, Scene } from '../src/types/project';
import type { GenerationPlanRevision, GenerationTarget } from '../packages/domain/src/generation';
import { defaultAIConfig, type AIConfigSnapshot } from '../src/config/aiConfigDefaults';
import { fixtureDirectorPlan, reviewFixturePreparation, reviewFixtureStage } from './helpers/productionQualityFixture';
import { buildManualStudioProjectVisualStyleContract } from '../src/services/production/manualStudioVideoIntent';
import { buildVideoStoryboardAssetBoardPlan } from '../src/services/production/videoStoryboardAssetBoards';
import { normalizeManualStoryboardBoard, normalizeManualStoryboardStrategy } from '../src/services/production/manualVideoStoryboard';
import { buildStoryboardCompositeVisualPages } from '../src/services/production/storyboardCompositeBoard';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-episode-direction-'));
process.env.OMNI_DB_PATH = path.join(directory, 'fixture.db');
const { db, dbHelpers } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH);
const { GenerationStore } = await import('../src/server/generation/store');
const { GenerationEngine } = await import('../src/server/generation/engine');
const { loadGenerationContext } = await import('../src/server/generation/context');
await fs.writeFile(path.join(directory, 'frame.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4QAAAABJRU5ErkJggg==', 'base64'));
after(() => db.close());

const originalStyle = '写实摄影，彩色自然日光';
const revisedStyle = '黑白剪影，全部空间以平面纸片呈现';
const visual = (stylePrompt: string) => ({ visual: { mode: 'replace' as const, stylePrompt } });
const sourceChanged = (error: unknown) => (error as { code?: string }).code === 'SOURCE_CHANGED';

function fixture(board = false) {
  const projectId = `episode-direction-${randomUUID()}`;
  const episodeId = `${projectId}-episode`, sceneId = `${projectId}-scene`, shotId = `${projectId}-shot`;
  const otherEpisodeId = `${projectId}-other`;
  const scene = {
    id: sceneId, title: '放杯子', script: '人物将杯子放到桌上，松手后停顿。',
    manualStoryboard: { directorPlan: fixtureDirectorPlan() },
    shots: [{ id: shotId, duration: 1, visualAction: '将杯子放桌上', editingNote: '杯子落定后切出', imageUrl: '/media/frame.png' }],
  } as Scene;
  if (board) {
    const normalized = normalizeManualStoryboardBoard({ episodeId, sceneId, shot: scene.shots[0],
      decision: normalizeManualStoryboardStrategy({ selectedStrategyId: 'storyboard.action_continuity.v1', selectedModelProfileId: 'video.storyboard_reference.configurable.short_unit.v1', expectedVideoUnitDurationSeconds: 1 }),
      value: { performanceBeat: { summary: '放杯子', startState: '杯子手中', endState: '杯子桌上' }, board: { layout: '1x1', panels: [{ visualBeat: '杯子仍在手中', subjectAction: '持杯', framePurpose: '关键状态', durationSeconds: 1 }] } },
    });
    normalized.board!.visualReferenceMode = 'director_board';
    normalized.board!.visualPages = buildStoryboardCompositeVisualPages(normalized.board!);
    scene.manualStoryboard = { ...scene.manualStoryboard!, schemaVersion: 'manual-storyboard.v1', boards: [{ id: 'unit', shotId, shotIds: [shotId], boardId: normalized.board!.id, ...normalized, updatedAt: 1 }], updatedAt: 1 };
  }
  dbHelpers.saveProject({ id: projectId, title: '隔离分集方向测试', type: 'movie', aspectRatio: '16:9', characters: [],
    assets: [{ id: `${projectId}-prop`, name: '杯子', type: 'prop', description: '白瓷杯' }],
    episodes: [
      { id: episodeId, title: '本集', creativeDirection: visual(originalStyle), scenes: [scene] },
      { id: otherEpisodeId, title: '其他集', scenes: [] },
    ],
  } as unknown as Project);
  const target: GenerationTarget = { projectId, episodeId, sceneId, kind: board ? 'board' : 'shot', shotIds: [shotId],
    ...(board ? { boardId: scene.manualStoryboard!.boards![0].board!.id, pageId: scene.manualStoryboard!.boards![0].board!.visualPages![0].id } : {}),
  };
  const config: AIConfigSnapshot = { ...structuredClone(defaultAIConfig),
    channels: [{ id: 'fixture-gemini', name: '未调用的隔离服务', type: 'gemini', baseUrl: 'https://fixture.example.test', apiKey: 'fixture-not-a-key' }],
    models: [{ id: 'fixture-veo', modelId: 'veo-3.0-generate-preview', alias: '隔离视频能力', channelId: 'fixture-gemini', capabilities: ['video'] }], comfyWorkflows: [],
  };
  const engine = new GenerationEngine(new GenerationStore(db), () => config, directory);
  engine.providers.submit = async () => { throw new Error('This regression must never call a provider'); };
  const changeEpisode = (change: (episode: Episode) => void, id = episodeId) => {
    const episode = dbHelpers.getEpisodeById(projectId, id) as Episode;
    change(episode); dbHelpers.updateEpisode(projectId, id, episode);
  };
  return { engine, target, changeEpisode, otherEpisodeId };
}

async function preparedVideo(f: ReturnType<typeof fixture>) {
  await reviewFixturePreparation(f.engine.quality, f.target);
  await reviewFixtureStage(f.engine.quality, 'visuals', f.target);
  const task = f.engine.create({ target: f.target, operation: 'video', commandId: randomUUID() });
  const { plan, issues } = await f.engine.preflight(task.id, task.revision);
  assert.ok(plan, JSON.stringify(issues));
  return { task, plan };
}

function actualVideoStyle(target: GenerationTarget) {
  const ctx = loadGenerationContext(target);
  return buildManualStudioProjectVisualStyleContract(ctx.project, { creativeScope: { episode: ctx.episode, scene: ctx.scene, shot: ctx.shots.length === 1 ? ctx.shots[0] : undefined } });
}

test('inherited episode visual changes invalidate frozen video submission and dispatch', async () => {
  const f = fixture(), { task, plan } = await preparedVideo(f);
  const storedPlan = f.engine.plan(plan.id);
  const before = loadGenerationContext(f.target);
  assert.match(plan.prompt, new RegExp(originalStyle));
  const queued = f.engine.submit(plan.id, plan.planHash, undefined, randomUUID());
  f.changeEpisode(episode => { episode.creativeDirection = visual(revisedStyle); });
  assert.match(actualVideoStyle(f.target), new RegExp(revisedStyle));
  assert.notEqual(loadGenerationContext(f.target).sourceHash, before.sourceHash);
  assert.ok((await f.engine.preflight(task.id, task.revision)).issues.some(issue => issue.code === 'SOURCE_CHANGED'));
  assert.throws(() => f.engine.submit(plan.id, plan.planHash, undefined, randomUUID()), sourceChanged);
  assert.throws(() => f.engine.assertDispatch(queued.id), sourceChanged);
  await assert.rejects(f.engine.importResult(plan.id, '/media/frame.png', randomUUID()), sourceChanged);
  assert.deepEqual(f.engine.plan(plan.id), storedPlan, 'the historical frozen plan is retained');
});

test('episode changes cannot escape through either legacy source-hash compatibility path', async () => {
  const f = fixture(true), { plan } = await preparedVideo(f), before = loadGenerationContext(f.target);
  const { productionBasis: _basis, ...oldShape } = plan;
  const legacyPlans = (['preCollaborationSourceHash', 'legacySourceHash'] as const).map(key => {
    assert.ok(before[key]); assert.notEqual(before[key], plan.sourceHash);
    const legacy: GenerationPlanRevision = { ...oldShape, id: randomUUID(), sourceHash: before[key]!, planHash: `${plan.planHash}:${key}` };
    f.engine.store.put('plan', legacy.id, f.target.projectId, legacy, 0);
    f.engine.store.put('plan-context', legacy.id, f.target.projectId, { boardSourceHash: before.boardSourceHash }, 0);
    assert.doesNotThrow(() => f.engine.assertAllowed(legacy), `${key} remains usable before the actual direction changes`);
    return legacy;
  });
  f.changeEpisode(episode => { episode.creativeDirection = visual(revisedStyle); });
  const after = loadGenerationContext(f.target);
  assert.equal(after.boardSourceHash, before.boardSourceHash, 'the board-only evidence cannot detect the episode edit');
  for (const key of ['sourceHash', 'preCollaborationSourceHash', 'legacySourceHash'] as const) assert.notEqual(after[key], before[key]);
  for (const legacy of legacyPlans) assert.throws(() => f.engine.assertAllowed(legacy), sourceChanged);
});

test('other episodes, standalone assets and shadowed episode styles retain their source identity', () => {
  const f = fixture();
  const project = dbHelpers.getProjectById(f.target.projectId) as Project;
  const assetId = buildVideoStoryboardAssetBoardPlan(project).propBoards[0].id;
  const assetTarget: GenerationTarget = { projectId: f.target.projectId, episodeId: f.target.episodeId, kind: 'asset', assetId, shotIds: [] };
  const shotBefore = loadGenerationContext(f.target).sourceHash, assetBefore = loadGenerationContext(assetTarget).sourceHash;
  f.changeEpisode(episode => { episode.creativeDirection = visual(revisedStyle); }, f.otherEpisodeId);
  assert.equal(loadGenerationContext(f.target).sourceHash, shotBefore, 'another episode is not a generation input');
  f.changeEpisode(episode => { episode.creativeDirection = visual(revisedStyle); });
  assert.equal(loadGenerationContext(assetTarget).sourceHash, assetBefore, 'standalone asset images do not inherit episode style');

  for (const localScope of ['scene', 'shot'] as const) {
    const local = fixture();
    local.changeEpisode(episode => {
      const owner = localScope === 'scene' ? episode.scenes[0] : episode.scenes[0].shots[0];
      owner.creativeDirection = visual('本地固定：水彩墨线');
    });
    const before = loadGenerationContext(local.target), style = actualVideoStyle(local.target);
    local.changeEpisode(episode => { episode.creativeDirection = visual(revisedStyle); });
    assert.equal(actualVideoStyle(local.target), style);
    assert.equal(loadGenerationContext(local.target).sourceHash, before.sourceHash, `${localScope} replacement shadows the inherited style`);
    local.changeEpisode(episode => { delete episode.creativeDirection; });
    assert.equal(loadGenerationContext(local.target).sourceHash, before.sourceHash, 'removing a shadowed binding also leaves the effective input unchanged');
  }
});

test('adding, adjusting and removing an inherited episode style changes only effective input', () => {
  const f = fixture();
  f.changeEpisode(episode => { delete episode.creativeDirection; });
  const absent = loadGenerationContext(f.target).sourceHash;
  f.changeEpisode(episode => { episode.creativeDirection = { visual: { mode: 'inherit' } }; });
  assert.equal(loadGenerationContext(f.target).sourceHash, absent, 'explicit inheritance matches an absent binding');
  f.changeEpisode(episode => { episode.creativeDirection = visual(originalStyle); });
  const replaced = loadGenerationContext(f.target).sourceHash;
  assert.notEqual(replaced, absent);
  f.changeEpisode(episode => { episode.scenes[0].creativeDirection = { visual: { mode: 'adjust', stylePrompt: '保留颗粒质感' } }; });
  const adjusted = loadGenerationContext(f.target).sourceHash;
  f.changeEpisode(episode => { episode.creativeDirection = visual(revisedStyle); });
  assert.match(actualVideoStyle(f.target), /黑白剪影/);
  assert.match(actualVideoStyle(f.target), /保留颗粒质感/);
  assert.notEqual(loadGenerationContext(f.target).sourceHash, adjusted, 'local adjustment still inherits the episode');
});
