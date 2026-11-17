import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import sharp from 'sharp';
import { qualityStages } from '../packages/domain/src/productionQuality';
import { fixtureDirectorPlan } from './helpers/productionQualityFixture';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-quality-'));
process.env.OMNI_DB_PATH = path.join(root, 'fixture.db');
const { db, dbHelpers } = await import('../src/server/db');
const { defaultAIConfig } = await import('../src/config/aiConfigDefaults');
const { registerProviderProxyRoutes } = await import('../src/server/routes/providerProxyRoutes');
const { ProductionQuality } = await import('../src/server/productionQuality');
const { GenerationStore } = await import('../src/server/generation/store');

test('real isolated audio routes gate TTS, Gemini audio and BGM before provider calls, while explicit previews remain available', async () => {
  const wav = Buffer.alloc(44 + 4800); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4800, 40);
  let speechCalls = 0, geminiCalls = 0, musicCalls = 0;
  const provider = express(); provider.use(express.json()); provider.post('/v1/audio/speech', (_req, res) => { speechCalls++; res.type('audio/wav').send(wav); });
  provider.post('/music', (_req, res) => { musicCalls++; res.json({ audio_url: '/fixture-audio.wav' }); });
  const upstream = provider.listen(0, '127.0.0.1'); await new Promise<void>(resolve => upstream.once('listening', resolve));
  dbHelpers.saveAIConfig({ ...defaultAIConfig, channels: [{ id: 'tts-local', name: 'Mock local voice', type: 'custom', baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}/v1`, apiKey: '' }], models: [{ id: 'tts', channelId: 'tts-local', alias: 'voice', modelId: 'tts-1', capabilities: ['audio'] }], routing: { ...defaultAIConfig.routing, audioGen: 'tts' } });
  const target = { projectId: 'audio-fixture', episodeId: 'ep', sceneId: 'scene', shotIds: ['shot'] };
  dbHelpers.saveProject({ id: target.projectId, title: '隔离音频协议测试', type: 'movie', characters: [], assets: [], episodes: [{ id: 'ep', title: '一集', scenes: [{ id: 'scene', title: '桌边', script: '人物放下杯子，说一句话。', manualStoryboard: { directorPlan: fixtureDirectorPlan() }, shots: [{ id: 'shot', duration: 2, visualAction: '人物放下杯子', editingNote: '说完后切出' }] }] }] } as any);
  const quality = new ProductionQuality(new GenerationStore(db), root);
  quality.saveResponsibility(target.projectId, { director: '隔离测试导演', coordinator: '隔离测试导演', intent: '只验证音频执行前置条件', visualDirection: '只验证协议，不代表作品验收', spatialMode: 'scene_plan' });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: 'blue' } }).png().toFile(path.join(root, 'set.png'));
  const app = express(); app.use(express.json()); registerProviderProxyRoutes(app, { mediaAssetsDir: root });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      const value = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] };
      return new Response(url.includes('streamGenerateContent') ? `data: ${JSON.stringify(value)}\n\n` : JSON.stringify(value), { headers: { 'Content-Type': url.includes('streamGenerateContent') ? 'text/event-stream' : 'application/json' } });
    }
    return originalFetch(input, options);
  };
  const post = (route: string, body: unknown) => originalFetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const cases = [
    { route: '/api/audio/speech', input: { text: '一句话', voice: 'alloy', projectId: target.projectId } },
    { route: '/api/proxy/custom-bgm', input: { url: `http://127.0.0.1:${(upstream.address() as any).port}/music`, model: 'suno-v3.5', prompt: '配乐', keySource: 'local', apiKey: 'fixture-key' } },
    ...['generateContent', 'generateContentStream'].map(action => ({ route: '/api/proxy/gemini', input: { action, apiKey: 'fixture-key', payload: { model: 'gemini-tts-fixture', contents: '一句话', config: { responseModalities: ['AUDIO'] } } } })),
  ];
  try {
    for (const item of cases) {
      assert.equal((await post(item.route, item.input)).status, 400, 'missing purpose is not an implicit preview');
      assert.equal((await post(item.route, { ...item.input, purpose: 'production', target })).status, 409);
      assert.equal((await post(item.route, { ...item.input, purpose: 'preview', target })).status, 400, 'preview cannot claim a formal target');
    }
    assert.deepEqual([speechCalls, geminiCalls, musicCalls], [0, 0, 0]);
    for (const item of cases) { const response = await post(item.route, { ...item.input, purpose: 'preview' }); assert.equal(response.status, 200, item.route + ' ' + await response.text()); }
    assert.deepEqual([speechCalls, geminiCalls, musicCalls], [1, 2, 1]);
    for (const stage of ['project_plan', 'scene_plan', 'shot_plan', 'preparation'] as const) {
      const inspection = await quality.inspect(stage, target, stage === 'preparation' ? [{ mediaUrl: '/media/set.png', mediaKind: 'image', shotIds: ['shot'], note: '隔离测试布景证据' }] : undefined);
      quality.review(inspection.id, { verdict: 'passed', reviewerName: '隔离测试导演', findings: qualityStages[stage].checks.map(check => ({ check, passed: true, note: '隔离协议用例核对，不代表真实作品验收' })) }, 'external_agent');
    }
    for (const item of cases) assert.equal((await post(item.route, { ...item.input, purpose: 'production', target })).status, 200);
    assert.deepEqual([speechCalls, geminiCalls, musicCalls], [2, 4, 2]);
    const mismatched = await post('/api/audio/speech', { ...cases[0].input, projectId: 'another-project', purpose: 'production', target });
    assert.equal(mismatched.status, 400);
    const project = dbHelpers.getProjectById(target.projectId) as any; project.episodes[0].scenes[0].script += ' 未检查的剧情改变'; dbHelpers.saveProject(project);
    for (const item of cases) assert.equal((await post(item.route, { ...item.input, purpose: 'production', target })).status, 409);
    assert.deepEqual([speechCalls, geminiCalls, musicCalls], [2, 4, 2], 'stale formal work never dispatches another provider request');
  } finally {
    globalThis.fetch = originalFetch;
    await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
    db.close(); await fs.rm(root, { recursive: true, force: true });
  }
});
