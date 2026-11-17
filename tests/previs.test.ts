import { fixtureDirectorPlan, reviewFixtureStage, reviewFixturePreparation } from './helpers/productionQualityFixture';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { Vector3, Box3 } from 'three';
import { buildPrevisObject } from '../src/components/spatial/previsRenderer';
import { previsFixture, previsGenerationConfig } from './fixtures/previs';
import { PREVIS_RENDER_VERSION, previsHash, previsExportSpec, previsExportCurrent, samplePrevisFrame, validatePrevisPlan, validatePrevisWorld, type ScenePrevis, type PrevisWorld } from '../packages/domain/src/previs';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-previs-'));
process.env.OMNI_DB_PATH = path.join(directory, 'test.db');
const { db, dbHelpers } = await import('../src/server/db');
const {ProductionQuality}=await import('../src/server/productionQuality');
const {GenerationStore: QualityGenerationStore}=await import('../src/server/generation/store');
const quality=new ProductionQuality(new QualityGenerationStore(db),directory);
const { registerPrevisRoutes } = await import('../src/server/routes/previsRoutes');
const { readPrevisDocument, savePrevisDocument, previsSceneKey } = await import('../src/server/previsStore');
const { buildPrevisTimeline, PrevisVideoService, previsVideoCurrent } = await import('../src/server/previsVideo');
const { GenerationMediaStore } = await import('../src/server/generation/media');
const { loadGenerationContext } = await import('../src/server/generation/context');
const app = express(); app.use(express.json({ limit: '25mb' }));
registerPrevisRoutes(app, new GenerationMediaStore(directory));
registerPrevisRoutes(app, new GenerationMediaStore(directory), { basePath: '/api/operator/previs', assertProjectAccess: id => { if (id === 'forbidden') throw Object.assign(new Error('forbidden'), { statusCode: 403 }); } });
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const request = async (route: string, body?: unknown, method = 'PUT') => { const response = await fetch(base + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
let count = 0;
async function fixture() {
  const f = previsFixture(`previs-${++count}`);
  for (const episode of f.episodes) for (const scene of episode.scenes) {
    scene.manualStoryboard = { schemaVersion: 'manual-storyboard.v1', updatedAt: 1,
      directorPlan: fixtureDirectorPlan('来访者入院后停下抬头，保持庭院空间') };
    scene.shots!.forEach(shot => { shot.editingNote = '步行或抬头完成后切反应，约两秒'; });
  }
  dbHelpers.saveProject(f.project);
  await reviewFixtureStage(quality, 'project_plan', {projectId:f.project.id});
  for (const episode of f.episodes) for (const scene of episode.scenes) {
    const target = { projectId: f.project.id, episodeId: episode.id, sceneId: scene.id };
    await reviewFixtureStage(quality, 'scene_plan', target);
    await reviewFixtureStage(quality, 'shot_plan', target);
  }
  const route = `/api/production/previs/${f.project.id}`, sceneRoute = `${route}/${f.episodes[0].id}/${f.scene.id}`;
  return { ...f, route, sceneRoute };
}
function install(f: Awaited<ReturnType<typeof fixture>>) {
  savePrevisDocument<PrevisWorld>(f.project.id, 'world', { plan: f.world }, 0);
  savePrevisDocument<ScenePrevis>(f.project.id, previsSceneKey(f.episodes[0].id, f.scene.id), { plan: f.plan, exports: [] }, 0);
  savePrevisDocument<ScenePrevis>(f.project.id, previsSceneKey(f.episodes[1].id, f.otherScene.id), { plan: f.otherPlan, exports: [] }, 0);
}

test('background staging round-trips through the scene API without creating character assets', async () => {
  const f = await fixture(); install(f);
  const before = (await request(f.sceneRoute)).body;
  const plan = structuredClone(before.document.plan);
  plan.objects.push({ id: 'background-walker', label: '路过邻居', kind: 'actor', performanceRole: 'background', activity: '沿人行道经过，保持切镜状态', position: [2, 0, -3], rotation: [0, 0, 0], size: [.6, 1.8, .4], color: '#778899', pose: 'walk' });
  plan.frames[0].states['background-walker'] = { position: [2, 0, -3] };
  plan.frames[1].states['background-walker'] = { position: [2, 0, -1] };
  plan.frames[2].states['background-walker'] = { position: [2, 0, -1] };
  const save = await request(f.sceneRoute, { plan, expectedRevision: before.document.revision, expectedEpisodeRevision: before.episodeRevision, expectedWorldRevision: before.world.revision });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const after = (await request(f.sceneRoute)).body;
  assert.equal(after.document.plan.objects.at(-1).performanceRole, 'background');
  assert.equal(after.document.plan.objects.at(-1).assetId, undefined);
  assert.deepEqual(samplePrevisFrame(after.document.plan, f.scene.shots[0].id, 1).states['background-walker'].position, [2, 0, -2]);
  assert.deepEqual(samplePrevisFrame(after.document.plan, f.scene.shots[0].id, 2).states['background-walker'].position, samplePrevisFrame(after.document.plan, f.scene.shots[1].id, 0).states['background-walker'].position);
  assert.equal(dbHelpers.getProjectShellById(f.project.id)!.characters.length, f.project.characters.length);
  assert.equal((await request(f.sceneRoute, { plan, expectedRevision: before.document.revision, expectedEpisodeRevision: before.episodeRevision, expectedWorldRevision: before.world.revision })).status, 409);
  assert.throws(() => validatePrevisPlan({ ...plan, objects: [...plan.objects, { ...plan.objects.at(-1), id: 'bad-role', kind: 'box' }] }, f.scene, f.project, f.world), /只适用于人物/);
});
test('seated and desk-leaning actors keep feet above the floor and bend above the hips', async () => {
  const f = await fixture();
  for (const pose of ['sit', 'lean'] as const) {
    const actor = { ...f.plan.objects[0], kind: 'actor' as const, pose, position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], size: [.6, 1.8, .4] as [number, number, number] };
    const plan = { ...f.plan, objects: [actor, ...f.plan.objects.slice(1)] };
    validatePrevisPlan(plan, f.scene, f.project, f.world);
    const group = buildPrevisObject(actor); group.updateMatrixWorld(true);
    const head = group.getObjectByName('head')!.getWorldPosition(new Vector3());
    assert.ok(head.y > 1 && head.y < 1.3, 'head remains above a one-metre desk');
    assert.ok(new Box3().setFromObject(group).min.y >= 0, 'feet do not rotate through the floor');
    if (pose === 'sit') {
      const hand = group.getObjectByName('socket:rightHand')!.getWorldPosition(new Vector3());
      assert.ok(hand.y >= .95 && hand.y <= 1.08, 'seated hand can reach a one-metre workbench instead of passing through it');
    }
    if (pose === 'lean') assert.ok(head.z > .5, 'torso reaches forward while legs remain standing');
  }
});
test('world belongs to the drama, expands across episodes, and uses CAS without altering normal production', async () => {
  const f = await fixture(), original = dbHelpers.getEpisodeById(f.project.id, f.episodes[0].id);
  assert.equal((await request(f.route)).body.world, null);
  const saved = await request(f.route, { plan: f.world, expectedRevision: 0 }); assert.equal(saved.status, 200); assert.equal(saved.body.world.revision, 1);
  const extended = structuredClone(f.world); extended.locations.push({ id: 'street', name: '后续街道', origin: [35, 0, 0], ground: [20, 30], description: '新增地点，保留旧庭院', sourceSceneIds: [] });
  assert.equal((await request(f.route, { plan: extended, expectedRevision: 1 })).status, 200);
  assert.equal((await request(f.route, { plan: f.world, expectedRevision: 1 })).status, 409);
  assert.equal((await request(f.route)).body.world.plan.objects[0].id, 'wall-west');
  assert.deepEqual(dbHelpers.getEpisodeById(f.project.id, f.episodes[0].id), original);
});
test('plan validation rejects dangling assets, scenes, malformed transforms and arbitrary code fields', async () => {
  const f = await fixture(); validatePrevisWorld(f.world, f.project); validatePrevisPlan(f.plan, f.scene, f.project, f.world);
  assert.throws(() => validatePrevisWorld({ ...f.world, script: 'execute()' }, f.project), /格式/);
  const bad = structuredClone(f.plan); bad.frames[0].shotId = 'other-project-shot'; assert.throws(() => validatePrevisPlan(bad, f.scene, f.project, f.world), /镜头/);
  const legacy=structuredClone(f.plan);legacy.frames[0].states['wall-west']={pose:'stand'};validatePrevisPlan(legacy,f.scene,f.project,f.world);
  legacy.frames[0].states['wall-west']={leftHand:[0,1,0]};assert.throws(()=>validatePrevisPlan(legacy,f.scene,f.project,f.world),/只适用于人物/);
  bad.frames[0].shotId = f.scene.shots![0].id; bad.objects[0].position[0] = Infinity; assert.throws(() => validatePrevisPlan(bad, f.scene, f.project, f.world), /参数/);
  const world = structuredClone(f.world); world.locations[0].sourceSceneIds.push('unknown'); assert.throws(() => validatePrevisWorld(world, f.project), /依据/);
});
test('scene shots reference existing world; concurrent normal edits cannot overwrite or silently rebase staging', async () => {
  const f = await fixture(); await request(f.route, { plan: f.world, expectedRevision: 0 });
  const initial = (await request(f.sceneRoute)).body;
  assert.equal((await request(f.sceneRoute, { plan: f.plan, expectedRevision: 0, expectedEpisodeRevision: initial.episodeRevision, expectedWorldRevision: 1 })).status, 200);
  assert.equal((await request(f.sceneRoute, { plan: f.plan, expectedRevision: 1, expectedEpisodeRevision: initial.episodeRevision, expectedWorldRevision: 0 })).status, 409);
  const old = await request(f.sceneRoute, { plan: f.plan, expectedRevision: 0, expectedEpisodeRevision: initial.episodeRevision, expectedWorldRevision: 1 }); assert.equal(old.status, 409);
  const ep = dbHelpers.getEpisodeById(f.project.id, f.episodes[0].id); dbHelpers.updateEpisode(f.project.id, f.episodes[0].id, { ...ep, title: '作者改标题' });
  assert.equal((await request(f.sceneRoute, { plan: f.plan, expectedRevision: 1, expectedEpisodeRevision: initial.episodeRevision, expectedWorldRevision: 1 })).status, 409);
  const empty = { ...f.world, locations: [], objects: [] }; assert.equal((await request(f.route, { plan: empty, expectedRevision: 1 })).status, 400);
  assert.equal((await request('/api/operator/previs/forbidden')).status, 403);
});
test('keyframes interpolate within a shot; cuts preserve explicit per-shot states and shared world remains unchanged', async () => {
  const f = await fixture(), before = JSON.stringify(f.world);
  const mid = samplePrevisFrame(f.plan, f.scene.shots![0].id, 1, f.world);
  assert.deepEqual(mid.states.visitor.position, [-1.5, 0, -1.5]); assert.deepEqual(mid.camera.position, [6.5, 3.5, 9]);
  assert.deepEqual(samplePrevisFrame(f.plan, f.scene.shots![1].id, 0, f.world).states.visitor.position, [-2, 0, 0]);
  assert.equal(JSON.stringify(f.world), before);
});
test('arm direction interpolates per actor and rejects a pose on an unrelated prop', async () => {
  const f = await fixture(); const plan = structuredClone(f.plan);
  const actor = plan.objects.find(o => o.kind === 'actor')!;
  const keys = plan.frames.filter(x => x.shotId === f.scene.shots![0].id);
  keys[0].states[actor.id] = { rightArm: [0, 0, 0] };
  keys[1].states[actor.id] = { rightArm: [1, 0, .4] };
  validatePrevisPlan(plan, f.scene, f.project, f.world);
  const mid = samplePrevisFrame(plan, f.scene.shots![0].id, (keys[0].timeInShot + keys[1].timeInShot) / 2, f.world);
  assert.deepEqual(mid.states[actor.id].rightArm, [.5, 0, .2]);
  const bad = structuredClone(plan); bad.frames[0].states['wall-west'] = { rightArm: [0, 0, 0] };
  assert.throws(() => validatePrevisPlan(bad, f.scene, f.project, f.world), /状态无效/);
});
test('grid maps arbitrary keyframes without double-counting shot duration; only relevant sources invalidate exports', async () => {
  const f = await fixture(), spec = previsExportSpec(f.plan, f.scene, '16:9', f.plan.frames.map(x => x.id), 2, f.world);
  assert.equal(spec.narrativeSeconds, 4); assert.equal(spec.rows, 2); assert.equal(spec.shotIds.length, 2);
  const item = { ...spec, id: 'export', imageUrl: '/media/a.png', contentHash: 'hash', width: 1920, height: 1080, createdAt: 1 };
  const expanded = structuredClone(f.world); expanded.locations.push({ id: 'elsewhere', name: '远方', origin: [50, 0, 0], ground: [10, 10], description: '', sourceSceneIds: [] });
  assert.ok(previsExportCurrent(f.plan, item, f.scene, '16:9', expanded));
  expanded.locations[0].origin = [30, 0, 0]; expanded.locations[0].sourceSceneIds = []; expanded.locations[0].name = '庭院主景';
  assert.ok(previsExportCurrent(f.plan, item, f.scene, '16:9', expanded), 'world overview arrangement and script associations do not alter local filming geometry');
  expanded.objects[0].size[1] = 8; assert.equal(previsExportCurrent(f.plan, item, f.scene, '16:9', expanded), false);
  assert.throws(() => previsExportSpec(f.plan, f.scene, '16:9', ['wide-end', 'wide-start'], 2, f.world), /顺序/);
});
test('grid HTTP export is a versioned optional reference, not adoption; stale render and wrong range are rejected', async () => {
  const f = await fixture(); install(f);
  const target = { projectId: f.project.id, episodeId: f.episodes[0].id, sceneId: f.scene.id, kind: 'scene' as const, shotIds: f.scene.shots!.map(s => s.id) };
  const ordinaryHash = loadGenerationContext(target).sourceHash;
  const spec = previsExportSpec(f.plan, f.scene, '16:9', ['wide-start'], 1, f.world);
  const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#a0a0a0' } }).png().toBuffer();
  const body = { ...spec, expectedRevision: 1, commandId: 'grid', imageUrl: `data:image/png;base64,${png.toString('base64')}` };
  const saved = await request(f.sceneRoute + '/exports', body, 'POST'); assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const context = loadGenerationContext(target), reference = context.references.find(r => r.previsSource);
  assert.equal(reference?.status, 'candidate'); assert.equal(reference?.enabled, false); assert.equal(reference?.role, 'composition'); assert.equal(context.sourceHash, ordinaryHash);
  const changed = structuredClone(f.world); changed.objects[0].position[0] -= 1;
  savePrevisDocument<PrevisWorld>(f.project.id, 'world', { plan: changed }, 1);
  assert.equal(loadGenerationContext(target).references.find(r => r.previsSource)?.status, 'source_changed'); assert.equal(loadGenerationContext(target).sourceHash, ordinaryHash);
  assert.equal((await request(f.sceneRoute + '/exports', { ...body, expectedRevision: 2, commandId: 'stale' }, 'POST')).status, 409);
});
test('whole-drama timeline reuses one world and never drops unfinished scenes or compresses to model limits', async () => {
  const f = await fixture(); install(f);
  const timeline = buildPrevisTimeline(f.project.id, 'project'); assert.equal(timeline.shots.length, 3); assert.equal(timeline.duration, 6);
  assert.equal(timeline.shots[0].plan.locationId, timeline.shots[2].plan.locationId);
  const longer = dbHelpers.getEpisodeById(f.project.id, f.episodes[0].id); longer.scenes[0].shots[0].duration = 20; dbHelpers.updateEpisode(f.project.id, longer.id, longer);
  assert.equal(buildPrevisTimeline(f.project.id, 'project').duration, 24, 'full previs is not constrained by a video model cap');
  const part = buildPrevisTimeline(f.project.id, 'scene', f.episodes[0].id, f.scene.id, [f.scene.shots![1].id]); assert.equal(part.duration, 2);
  savePrevisDocument<ScenePrevis>(f.project.id, previsSceneKey(f.episodes[1].id, f.otherScene.id), { plan: { ...f.otherPlan, frames: [] }, exports: [] }, 1);
  assert.throws(() => buildPrevisTimeline(f.project.id, 'project'), /不能跳过/);
});
test('current contact failures survive history pagination and become stale only when the source changes', async () => {
  const { previsContactProblem, createPrevisContactProblemReader } = await import('../src/server/spatial/contactChecks');
  const f = await fixture(); install(f);
  const timeline = buildPrevisTimeline(f.project.id, 'scene', f.episodes[0].id, f.scene.id);
  const sourceHash = previsHash({ renderVersion: PREVIS_RENDER_VERSION, content: timeline.sourceHash, objectIds: null });
  const check = { id: `failed-${f.project.id}`, projectId: f.project.id, scope: 'scene', episodeId: f.episodes[0].id,
    sceneId: f.scene.id, status: 'complete', sourceHash,
    snapshot: { world: f.world, timeline, sourceHash }, report: { complete: true, issues: [{ sceneId: f.scene.id,
      shotId: f.scene.shots![0].id, time: 1, message: '人物穿入墙体' }] } };
  const insert = db.prepare('INSERT INTO previs_contact_checks VALUES (?,?,?)');
  insert.run(check.id, f.project.id, JSON.stringify(check));
  for (let n = 0; n < 35; n++) insert.run(`unrelated-${f.project.id}-${n}`, f.project.id, JSON.stringify({ ...check, scope: 'world' }));
  assert.match(previsContactProblem(f.project.id, f.scene.id, [f.scene.shots![0].id]) || '', /人物穿入墙体/);
  assert.equal(previsContactProblem(f.project.id, f.scene.id, [f.scene.shots![1].id]), undefined);
  insert.run(`passed-${f.project.id}`, f.project.id, JSON.stringify({ ...check, report: { complete: true, issues: [] } }));
  const readProject = dbHelpers.getProjectById; let reads = 0;
  dbHelpers.getProjectById = (...args) => { reads++; return readProject(...args); };
  try {
    const problems = createPrevisContactProblemReader(f.project.id, f.scene.id);
    for (let n = 0; n < 16; n++) assert.match(problems([f.scene.shots![0].id]) || '', /人物穿入墙体/);
    assert.equal(problems([f.scene.shots![1].id]), undefined);
    assert.equal(reads, 1, 'many references share one source check; passing history does not mask a current failure');
  } finally { dbHelpers.getProjectById = readProject; }
  const changed = structuredClone(f.plan); changed.frames[0].camera.position[0] += 1;
  savePrevisDocument<ScenePrevis>(f.project.id, previsSceneKey(f.episodes[0].id, f.scene.id), { plan: changed, exports: [] }, 1);
  assert.equal(previsContactProblem(f.project.id, f.scene.id, [f.scene.shots![0].id]), undefined);
});
test('local movie export resumes ordered frames, encodes measurable MP4 and leaves ordinary media untouched', async () => {
  const f = await fixture(); install(f); const service = new PrevisVideoService(directory);
  const job = await service.create(f.project.id, { scope: 'scene', episodeId: f.episodes[0].id, sceneId: f.scene.id, shotIds: [f.scene.shots![0].id], fps: 12 });
  const jpg = await sharp({ create: { width: job.width, height: job.height, channels: 3, background: '#b0b0b0' } }).jpeg().toBuffer(), image = `data:image/jpeg;base64,${jpg.toString('base64')}`;
  await assert.rejects(service.finish(job.id), /未全部/); await assert.rejects(service.frames(job.id, 3, [image]), /范围/);
  const half = await service.frames(job.id, 0, Array(12).fill(image)); assert.equal(half.receivedFrames, 12);
  assert.equal((await service.frames(job.id, 0, Array(12).fill(image))).receivedFrames, 12);
  await service.frames(job.id, 12, Array(12).fill(image)); const result = await service.finish(job.id);
  assert.equal(result.status, 'complete'); assert.ok(previsVideoCurrent(result));
  const metadata = await new GenerationMediaStore(directory).inspect(result.videoUrl!, 'video'); assert.equal(metadata.durationSeconds, 2); assert.equal(metadata.hasAudio, false);
  assert.equal((await fs.readdir(path.join(directory, 'previs', job.id))).filter(n => n.endsWith('.jpg')).length, 0);
  assert.ok(readPrevisDocument(f.project.id, 'world'));
});
test('whitebox sources remain opt-in and changes invalidate frozen submissions, imports and adoption', async () => {
  const { GenerationEngine } = await import('../src/server/generation/engine');
  const { GenerationStore } = await import('../src/server/generation/store');
  const f = await fixture(); install(f);
  const target = { projectId: f.project.id, episodeId: f.episodes[0].id, sceneId: f.scene.id, kind: 'shot' as const, shotIds: [f.scene.shots![0].id] };
  const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#a0a0a0' } }).png().toBuffer();
  const project = dbHelpers.getProjectById(f.project.id) as any;
  const fixtureImage = `data:image/png;base64,${png.toString('base64')}`;
  project.characters[0].referenceImageUrl = fixtureImage;
  project.assets[0].referenceImageUrl = fixtureImage;
  project.episodes[0].scenes[0].manualStoryboard = { directorPlan: fixtureDirectorPlan('来访者入院后停下抬头，保持庭院空间') };
  project.episodes[0].scenes[0].shots.forEach((shot: any) => { shot.editingNote = '步行或抬头完成后切反应，约两秒'; });
  dbHelpers.saveProject(project);
  Object.assign(f.scene, project.episodes[0].scenes[0]);
  await reviewFixturePreparation(quality, target);
  const spec = previsExportSpec(f.plan, f.scene, '16:9', ['wide-start'], 1, f.world);
  const saved = await request(f.sceneRoute + '/exports', { ...spec, expectedRevision: 1, commandId: 'generation-reference', imageUrl: `data:image/png;base64,${png.toString('base64')}` }, 'POST');
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  let failedContactCheck = false;
  const config = await previsGenerationConfig(), engine = new GenerationEngine(new GenerationStore(db), () => config, directory, input => {
    const ctx = loadGenerationContext(input);
    return failedContactCheck ? { ...ctx, references: ctx.references.map(r => r.previsSource ? { ...r, qualityIssue: '真实网格检查发现穿墙' } : r) } : ctx;
  });
  const task = engine.create({ target, operation: 'asset_image', commandId: 'optional-previs' });
  assert.equal(task.references.filter(r => r.previsSource && r.enabled).length, 0);
  const ref = loadGenerationContext(target).references.find(r => r.previsSource)!;
  const edited = engine.update(task.id, { expectedRevision: task.revision, patch: { references: [{ ...ref, enabled: true, source: 'user' }], prompt: '白模空间构图配合独立角色资产完成镜头。' } });
  const checked = await engine.preflight(edited.id, edited.revision); assert.ok(checked.plan, JSON.stringify(checked.issues));
  failedContactCheck = true;
  const rejected=await engine.preflight(edited.id,edited.revision);
  assert.ok(rejected.issues.some(i=>i.code==='REFERENCE_QUALITY'&&i.blocking),'canonical failed checks cannot be cleared by the draft');
  await assert.rejects(engine.importResult(checked.plan.id,saved.body.item.imageUrl,'failed-check-import'),/已变化/,'a frozen plan must be revalidated when a check later fails');
  failedContactCheck = false;
  const result = await engine.importResult(checked.plan.id, saved.body.item.imageUrl, 'offline-result');
  assert.equal(result.results[0].review, 'pending');
  engine.review(result.id, result.results[0].id, 'adopted', dbHelpers.getEpisodeById(f.project.id, f.episodes[0].id).productionRevision, '隔离合同验证');
  assert.equal(engine.refreshResultReview(engine.execution(result.id)).results[0].review, 'adopted');
  const changed = structuredClone(f.world); changed.objects[0].size[1] += 1;
  savePrevisDocument<PrevisWorld>(f.project.id, 'world', { plan: changed }, 1);
  assert.equal(engine.refreshResultReview(engine.execution(result.id)).results[0].review, 'source_changed');
  assert.throws(() => engine.review(result.id, result.results[0].id, 'adopted', dbHelpers.getEpisodeById(f.project.id, f.episodes[0].id).productionRevision, ''), /参考来源已变化/);
  await assert.rejects(engine.importResult(checked.plan.id, saved.body.item.imageUrl, 'late-result'), /已变化/);
  engine.updatePolicy(f.project.id, { allowExperimental: true }, engine.store.policy(f.project.id).revision);
  assert.throws(() => engine.submit(checked.plan!.id, checked.plan!.planHash, undefined, 'stale-submit'), /已变化/);
  assert.ok(await fs.stat(path.join(directory, saved.body.item.imageUrl.replace('/media/', ''))));
});
test('motion key capacity is independent from grid capacity, and ambiguous duplicate times are rejected', async () => {
  const f = await fixture(); install(f);
  const plan = { ...f.plan, frames: Array.from({ length: 40 }, (_, i) => ({ ...f.plan.frames[0], id: `key-${i}`, timeInShot: i / 20 })).concat([f.plan.frames[2]]) };
  validatePrevisPlan(plan, f.scene, f.project, f.world);
  savePrevisDocument<ScenePrevis>(f.project.id, previsSceneKey(f.episodes[0].id, f.scene.id), { plan, exports: [] }, 1);
  assert.equal(buildPrevisTimeline(f.project.id, 'project').duration, 6);
  assert.throws(() => validatePrevisPlan({ ...plan, frames: [...plan.frames, { ...plan.frames[0], id: 'duplicate' }] }, f.scene, f.project, f.world), /时间不能重复/);
});
after(async () => { await new Promise<void>(r => server.close(() => r())); db.close(); await fs.rm(directory, { recursive: true, force: true }); });
