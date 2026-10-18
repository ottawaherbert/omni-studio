import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import type { Project, Episode, Scene } from '../src/types/project';
import { buildManualProductionVariantUpdate, buildManualProductionAssetReadModel } from '../src/services/production/manualProductionAssets';
import { buildProductionSceneAssetVariantBindingUpdate, buildProductionProjectAssetReadModel } from '../src/services/production/productionProjectAssets';
import { buildProductionAssetBoardReferenceUpdate, findProductionAssetBoard } from '../src/services/production/productionAssetBoardProfile';
import { buildProductionSceneVisualPackDrafts } from '../src/services/production/videoStoryboardSceneVisualPacks';
import { buildManualStudioVideoIntent } from '../src/services/production/manualStudioVideoIntent';
import { mergeProductionAssetPreparationVariants, productionAssetPreparationVariantId, type ProductionAssetStateDecision } from '../src/services/production/productionAssetPreparation';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'a22-cross-episode-assets-'));
const media = path.join(directory, 'media');
fs.mkdirSync(media);
process.env.OMNI_DB_PATH = path.join(directory, 'test.db');
const { db } = await import('../src/server/db');
const { registerLegacyProjectRoutes } = await import('../src/server/routes/legacyProjectRoutes');
const app = express();
app.use(express.json({ limit: '25mb' }));
registerLegacyProjectRoutes(app);
app.use('/media', express.static(media));
for (const [name, color] of [['character', 'gray'], ['location', 'green'], ['first', 'red'], ['second', 'blue']]) {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180`, '-frames:v', '1', path.join(media, `${name}.png`)]);
}
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1:sample_rate=48000', path.join(media, 'voice.wav')]);
const serve = process.argv.includes('--serve');
let vite: import('vite').ViteDevServer | undefined;
if (serve) {
  const { registerAiConfigRoutes } = await import('../src/server/routes/aiConfigRoutes');
  registerAiConfigRoutes(app, { getProviderKeyStatus: () => ({}) });
  const { registerSystemRoutes } = await import('../src/server/routes/systemRoutes');
  registerSystemRoutes(app, { mediaAssetsDir: media });
  app.post('/api/runtime-logs', (_req, res) => res.json({ ok: true }));
  app.use('/api', (_req, res) => res.status(404).json({ error: '隔离验收未启用此服务' }));
  const { createServer } = await import('vite');
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}
const server = app.listen(serve ? Number(process.env.PORT || 4321) : 0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
const request = async (route: string, body?: unknown, method = body ? 'PUT' : 'GET') => {
  const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
const projectId = 'cross-episode-assets';
const projectRoute = `/api/projects/${projectId}`;
const episodeRoute = (id: string) => `${projectRoute}/episodes/${id}`;
const makeScene = (index: number): Scene => ({
  id: `river-scene-${index}`, title: `河岸第 ${index} 天`, description: '周岚在同一处河岸记录风声。', valueCharge: 'neutral',
  breakdown: { setting: 'EXT.', time: 'DAY', characters: [{ name: '周岚', state: '雨天外套' }], characterIds: ['zhou'], location: { name: '河岸' }, locationId: 'river', props: [], propIds: [] },
  scriptBlocks: [{ id: `block-${index}`, type: 'action', content: '周岚停下脚步听风。' }],
  shots: [{ id: `river-shot-${index}`, visualAction: '周岚停下脚步听风。', characterIdsInShot: ['zhou'], locationId: 'river', duration: 6, imageUrl: '/media/character.png', dialogueLines: [{ characterId: 'zhou', text: index === 1 ? '今天风很大。' : '今天风停了。' }] }],
  audioTracks: [{ id: `dialogue-${index}`, type: 'dialogue', characterId: 'zhou', text: index === 1 ? '今天风很大。' : '今天风停了。', url: '/media/voice.wav', startTime: 0, duration: 1, volume: index === 1 ? 0.25 : 0.75 }],
});
try {
  let project: Project = { id: projectId, title: '[验收] 河岸的两天', type: 'series-work', workType: '环境纪录片', aspectRatio: '16:9', logline: '', coreConflict: '',
    characters: [{ id: 'zhou', name: '周岚', visualIdentity: '短发，灰色外套。', boardImageUrl: '/media/character.png', voiceReferences: [
      { id: 'zhou-timbre', url: '/media/voice.wav', usage: 'voice_timbre', description: '经作者选择的音色测试样本', durationSeconds: 1 },
      { id: 'zhou-finished-line', url: '/media/voice.wav', usage: 'full_dialogue', description: '成句配音测试样本', durationSeconds: 1 },
    ] }],
    assets: [{ id: 'river', type: 'location', name: '河岸', description: '芦苇与石阶。', boardImageUrl: '/media/location.png' }], episodes: [],
  };
  await request('/api/projects', project, 'POST');
  let episodes: Episode[] = [1, 2].map((index) => ({ id: `river-ep-${index}`, title: `第 ${index} 集`, inspiration: '', scenes: [makeScene(index)] }));
  for (const episode of episodes) await request(episodeRoute(episode.id), episode);
  project = await request(projectRoute);
  const variantIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const episode = await request(episodeRoute(episodes[index].id)) as Episode;
    const scene = episode.scenes[0];
    const update = buildManualProductionVariantUpdate({ project, episode, scene, assetId: 'zhou', draft: { name: index === 0 ? '红色雨衣' : '蓝色雨衣', description: index === 0 ? '本集穿红色雨衣。' : '本集穿蓝色雨衣。', promptModifiers: index === 0 ? 'red raincoat' : 'blue raincoat' }, finalPrompt: '确定性测试，不调用模型', createdAt: index + 1 });
    variantIds.push(update.variantId);
    await request(projectRoute, update.projectUpdates, 'PATCH');
    project = await request(projectRoute);
    const board = findProductionAssetBoard(project, 'zhou', update.variantId)!;
    await request(projectRoute, buildProductionAssetBoardReferenceUpdate({ project, boardItemId: board.id, imageUrl: `/media/${index ? 'second' : 'first'}.png`, source: 'existing', finalPrompt: '作者导入的测试图', createdAt: index + 10 }), 'PATCH');
    episodes[index] = { ...episode, scenes: [{ ...scene, ...update.sceneUpdates }] };
    await request(episodeRoute(episode.id), episodes[index]);
    project = await request(projectRoute);
  }
  assert.notEqual(variantIds[0], variantIds[1]);
  assert.equal(project.title, '[验收] 河岸的两天');
  assert.equal(project.type, 'series-work');
  assert.equal(project.workType, '环境纪录片');
  const firstSnapshot = await request(episodeRoute(episodes[0].id));
  const firstVariant = structuredClone(project.characters[0].variants!.find((variant) => variant.id === variantIds[0]));
  assert.equal(firstVariant?.boardImageUrl, '/media/first.png', 'the second creation must preserve the first adopted image');
  assert.equal(project.characters[0].variants?.length, 2);
  const readEpisodes = await Promise.all(episodes.map((episode) => request(episodeRoute(episode.id)))) as Episode[];
  const assets = buildProductionProjectAssetReadModel(project, readEpisodes);
  assert.equal(assets.totalAssetCount, 2, 'episodes share canonical assets instead of cloning them');
  assert.equal(assets.assets.find((asset) => asset.id === 'river')?.usageRefs.length, 2);
  const packs = buildProductionSceneVisualPackDrafts(project, readEpisodes).sceneVisualPacks;
  for (let index = 0; index < 2; index++) {
    const pack = packs.find((item) => item.linkedSceneIds.includes(readEpisodes[index].scenes[0].id))!;
    assert.equal(pack.characters[0].variantId, variantIds[index]);
    assert.equal(pack.referenceSlots.find((slot) => slot.assetId === 'zhou')?.referenceImageUrl, `/media/${index ? 'second' : 'first'}.png`);
    const episode = readEpisodes[index]; const scene = episode.scenes[0]; const shot = scene.shots![0];
    const target = { shotId: shot.id, durationSeconds: 6, videoPrompt: '保持本集的内容', selectedVoiceReferenceIds: ['zhou-timbre', 'zhou-finished-line'] };
    const input = { project, episode, scene, shot, target, boards: buildManualProductionAssetReadModel({ project, episode, scene }).assetBoards, adapterId: 'fixture', generationMode: 'multimodal_reference', directorIntent: '', sourceHash: 'fixture' };
    const native = buildManualStudioVideoIntent({ ...input, audioMode: 'provider_native' });
    const voices = native.referenceBindings.filter((binding) => binding.sourceType === 'voice_reference_audio');
    assert.equal(voices.length, 1, 'finished dialogue must not be mistaken for a reusable timbre sample');
    assert.equal(voices[0].sourceAssetId, 'zhou-timbre');
    assert.equal(voices[0].semanticEntityId, 'zhou');
    const copied = buildManualStudioVideoIntent({ ...input, target: { ...target, selectedDialogueTrackIds: [scene.audioTracks![0].id] }, audioMode: 'reuse_dialogue' });
    assert.equal(copied.referenceBindings.find((binding) => binding.sourceType === 'final_dialogue_audio')?.sourceAssetId, `dialogue-${index + 1}`);
  }
  const second = readEpisodes[1];
  const rebound = { ...second.scenes[0], ...buildProductionSceneAssetVariantBindingUpdate({ project, scene: second.scenes[0], assetId: 'zhou', variantId: variantIds[0] }) };
  await request(episodeRoute(second.id), { ...second, scenes: [rebound] });
  assert.deepEqual(await request(episodeRoute(readEpisodes[0].id)), firstSnapshot);
  const independent = { ...rebound, ...buildProductionSceneAssetVariantBindingUpdate({ project, scene: rebound, assetId: 'zhou', variantId: variantIds[1] }), audioTracks: rebound.audioTracks?.map((track) => ({ ...track, volume: 0.5 })) };
  await request(episodeRoute(second.id), { ...second, scenes: [independent] });
  assert.deepEqual(await request(episodeRoute(readEpisodes[0].id)), firstSnapshot);
  assert.deepEqual((await request(projectRoute)).characters[0].variants.find((variant: { id: string }) => variant.id === variantIds[0]), firstVariant);

  const decision: ProductionAssetStateDecision = { sceneId: 'first', assetId: 'zhou', assetType: 'character', use: 'variant', variantKey: 'raincoat', variantName: '红雨衣', visibleDelta: '红色', promptModifiers: 'red', reason: '作者要求', evidence: '红色雨衣' };
  const prior = { ...mergeProductionAssetPreparationVariants('zhou', [], [decision])[0], boardImageUrl: '/media/first.png' };
  assert.deepEqual(mergeProductionAssetPreparationVariants('zhou', [prior], [{ ...decision, sceneId: 'second' }]), [prior], 'identical batch reuse must retain the adopted media');
  const different = { ...decision, sceneId: 'second', visibleDelta: '蓝色', promptModifiers: 'blue' };
  assert.notEqual(productionAssetPreparationVariantId(decision), productionAssetPreparationVariantId(different), 'reused model keys do not authorize changing another episode');
  assert.equal(mergeProductionAssetPreparationVariants('zhou', [prior], [different]).length, 2);
  assert.throws(() => mergeProductionAssetPreparationVariants('zhou', [{ ...prior, description: '作者已手改' }], [decision]), /未覆盖/);
  const audio = Buffer.from(await (await fetch(base + '/media/voice.wav')).arrayBuffer());
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  const evidence = { passed: true, directory, base, projectId, variantIds, firstVariant, episodes: readEpisodes.map((episode) => episode.id), assertions: 'HTTP cross-episode persistence, independent variants with matching scene summaries, adopted image preservation, shared location and voice identity, per-episode dialogue and volume, rebind without mutation, batch-key collision and media retention', mediaSource: 'ffmpeg color blocks and tone; not generated characters or speech' };
  fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) { await vite?.close(); server.close(); db.close(); throw error; }
if (!serve) { await new Promise<void>((resolve) => server.close(() => resolve())); db.close(); }
