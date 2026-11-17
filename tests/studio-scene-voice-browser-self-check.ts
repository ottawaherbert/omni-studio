import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { qualityStages } from '../packages/domain/src/productionQuality';
import { fixtureDirectorPlan } from './helpers/productionQualityFixture';

// Real Studio, persistence and speech routes; the only provider is a local WAV fixture.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-scene-voice-'));
const mediaRoot = path.join(root, 'media');
await fs.mkdir(mediaRoot);
process.env.OMNI_DB_PATH = path.join(root, 'test.sqlite');
const { db, dbHelpers } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH);
const { defaultAIConfig } = await import('../src/config/aiConfigDefaults');
const { GenerationStore } = await import('../src/server/generation/store');
const { ProductionQuality } = await import('../src/server/productionQuality');
const { registerLegacyProjectRoutes } = await import('../src/server/routes/legacyProjectRoutes');
const { registerAiConfigRoutes } = await import('../src/server/routes/aiConfigRoutes');
const { registerSpeechRoutes } = await import('../src/server/routes/speechRoutes');

const wav = Buffer.alloc(44 + 4800);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4800, 40);
const providerBodies: unknown[] = [];
const provider = express(); provider.use(express.json());
provider.post('/v1/audio/speech', (req, res) => { providerBodies.push(req.body); res.type('audio/wav').send(wav); });
const upstream = provider.listen(0, '127.0.0.1');
await new Promise<void>(resolve => upstream.once('listening', resolve));
dbHelpers.saveAIConfig({
  ...defaultAIConfig,
  channels: [{ id: 'local-fixture', name: 'Isolated WAV fixture', type: 'custom', baseUrl: `http://127.0.0.1:${(upstream.address() as { port: number }).port}/v1`, apiKey: '' }],
  models: [{ id: 'fixture-voice', channelId: 'local-fixture', alias: 'Isolated voice', modelId: 'gpt-4o-mini-tts', capabilities: ['audio'] }],
  routing: { ...defaultAIConfig.routing, audioGen: 'fixture-voice' },
});
const target = { projectId: 'scene-voice', episodeId: 'episode', sceneId: 'scene' };
dbHelpers.saveProject({
  id: target.projectId, title: '场次配音隔离验证', type: 'movie', aspectRatio: '16:9', characters: [], assets: [],
  episodes: [{ id: target.episodeId, title: '测试集', scenes: [{
    id: target.sceneId, title: '测试场', script: '人物放下杯子，另一人走近。',
    manualStoryboard: { directorPlan: fixtureDirectorPlan('展示两个动作') },
    shots: ['shot-1', 'shot-2'].map(id => ({ id, duration: 4, visualAction: '完成动作', editingNote: '动作结束后切出' })),
    audioTracks: [{ id: 'bound-line', type: 'dialogue', shotId: 'shot-1', text: '原镜头台词', url: '', startTime: 0, duration: 2 }],
  }] }],
} as any);
const quality = new ProductionQuality(new GenerationStore(db), mediaRoot);
quality.saveResponsibility(target.projectId, { director: '隔离测试', coordinator: '隔离测试', intent: '验证软件路径', visualDirection: '不代表作品验收', spatialMode: 'scene_plan' });
const pass = async (stage: keyof typeof qualityStages, shotIds?: string[]) => {
  const inspection = await quality.inspect(stage, { ...target, ...(shotIds ? { shotIds } : {}) });
  quality.review(inspection.id, { reviewerName: '隔离测试', verdict: 'passed', findings: qualityStages[stage].checks.map(check => ({ check, passed: true, note: '确定性协议测试，不代表创作验收。' })) }, 'creator');
};
for (const stage of ['project_plan', 'scene_plan', 'shot_plan'] as const) await pass(stage);
await pass('preparation', ['shot-1']);
const app = express(); app.use(express.json({ limit: '50mb' }));
const requests: { body: any; status?: number }[] = [];
app.use('/api/audio/speech', (req, res, next) => {
  const entry = { body: req.body } as (typeof requests)[number]; requests.push(entry);
  res.once('finish', () => { entry.status = res.statusCode; }); next();
});
registerLegacyProjectRoutes(app);
registerAiConfigRoutes(app, { getProviderKeyStatus: () => ({}) });
registerSpeechRoutes(app, { mediaAssetsDir: mediaRoot });
app.get('/api/global-assets', (_req, res) => res.json([]));
app.get('/api/skills', (_req, res) => res.json({ skills: [] }));
app.post('/api/runtime-logs', (_req, res) => res.json({ ok: true }));
app.use('/media', express.static(mediaRoot));
app.use('/api', (_req, res) => res.status(404).json({ error: '隔离测试未启用此服务' }));
const vite = await createServer({ configFile: false, root: process.cwd(), cacheDir: path.join(root, 'vite-cache'), plugins: [react(), tailwindcss()], resolve: { alias: { '@': process.cwd() } }, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
app.use(vite.middlewares);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({ executablePath: process.env.OMNI_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
const pageErrors: string[] = [];
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/*', route => route.request().url().startsWith(base + '/') || route.request().url().startsWith('data:') ? route.continue() : route.abort());
await page.addInitScript(() => localStorage.setItem('isAuthenticated', 'true'));
const readScene = async () => (await (await fetch(`${base}/api/projects/${target.projectId}/episodes/${target.episodeId}`)).json()).scenes[0];
const waitForSaved = async (predicate: (scene: any) => boolean) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const scene = await readScene(); if (predicate(scene)) return scene;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Studio change was not persisted');
};
try {
  await page.goto(`${base}/production/studio?${new URLSearchParams(target)}`);
  await page.getByRole('button', { name: '展开时间轴', exact: true }).click();
  await page.getByRole('button', { name: '配音', exact: true }).click();
  await page.getByPlaceholder('输入该镜头的对白或旁白...').fill('新增场次旁白');
  const added = await waitForSaved(scene => scene.audioTracks.some((track: any) => track.text === '新增场次旁白'));
  const trackId = added.audioTracks.find((track: any) => track.text === '新增场次旁白').id;
  await page.getByRole('button', { name: '生成 AI 配音', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '生成角色配音', exact: true });
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /场次配音/);
  const blocked = page.waitForResponse(response => response.url().endsWith('/api/audio/speech'));
  await dialog.getByRole('button', { name: '生成音频', exact: true }).click();
  assert.equal((await blocked).status(), 409, 'scene-level voice needs preparation for the whole scene');
  assert.equal(providerBodies.length, 0);
  assert.deepEqual(requests[0].body.target, target);
  assert.equal(requests[0].body.purpose, 'production');
  await pass('preparation', ['shot-2']);
  await dialog.getByRole('button', { name: '生成音频', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const generated = await waitForSaved(scene => !!scene.audioTracks.find((track: any) => track.id === trackId)?.url);
  assert.equal(providerBodies.length, 1);
  assert.equal(generated.audioTracks.find((track: any) => track.id === trackId).shotId, undefined);
  assert.deepEqual(generated.shots, added.shots, 'scene voice must not resize or replace narrative shots');
  const bound = page.getByText('原镜头台词', { exact: true }).locator('..').locator('..');
  await bound.scrollIntoViewIfNeeded();
  const box = (await bound.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2, { steps: 4 }); await page.mouse.up();
  const moved = await waitForSaved(scene => !scene.audioTracks.find((track: any) => track.id === 'bound-line').shotId);
  const movedStart = moved.audioTracks.find((track: any) => track.id === 'bound-line').startTime;
  assert.ok(movedStart > 0);
  await page.getByRole('button', { name: '生成 AI 配音', exact: true }).click();
  await dialog.getByRole('button', { name: '生成音频', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const finished = await waitForSaved(scene => !!scene.audioTracks.find((track: any) => track.id === 'bound-line').url);
  assert.equal(finished.audioTracks.find((track: any) => track.id === 'bound-line').startTime, movedStart);
  assert.equal(providerBodies.length, 2);
  assert.deepEqual(requests.map(request => request.status), [409, 200, 200]);
  assert.ok(requests.every(request => JSON.stringify(request.body.target) === JSON.stringify(target)));
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: path.join(root, 'scene-voice.png'), fullPage: true });
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify({ passed: true, requests, providerBodies, pageErrors, finished }, null, 2));
  console.log(JSON.stringify({ passed: true, root, assertions: 'new and dragged scene dialogue, whole-scene preparation gate, real WAV persistence, unchanged shots and authored start times' }));
} finally {
  await browser.close(); await vite.close();
  await Promise.all([new Promise<void>(resolve => server.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
  db.close();
  if (!process.argv.includes('--keep')) await fs.rm(root, { recursive: true, force: true });
}
