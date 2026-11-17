import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLongFormMemoryContext, collectLongFormMemoryGaps, renderLongFormMemoryForPrompt } from '../src/services/production/longFormMemory';
import { runOperatorQA } from '../src/services/operator/qa';
import { comfyAPIPresets } from '../src/config/comfyPresets';
import { defaultAIConfig, normalizeAIConfig } from '../src/config/aiConfigDefaults';

const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-independent-production-audit-'));
process.env.OMNI_DB_PATH = path.join(tempDirectory, 'isolated.sqlite');
const { db } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH);
const { registerComfyUIGatewayRoutes } = await import('../src/server/providers/comfyUIGateway');
after(async () => { db.close(); await fs.rm(tempDirectory, { recursive: true, force: true }); });

function longFormProject(): any {
  return { id: 'independent-noncommercial', title: '免费教育系列', type: 'tv-series', targetEpisodeCount: 100,
    productionMemory: { version: 1,
      skeletonMemory: { phaseMap: Array.from({ length: 5 }, (_, i) => ({ id: String(i), title: '教学阶段', startEpisode: i * 20 + 1, endEpisode: (i + 1) * 20 })), finaleContract: '完成学习' },
      continuityMemory: { protagonistState: '学生', propOwnership: {}, forbiddenContradictions: ['不改变授课主题'] } },
    episodes: [], characters: [], assets: [] };
}

test('noncommercial long-form project with complete story memory has no invented commercial gate', () => {
  const project = longFormProject();
  assert.deepEqual(collectLongFormMemoryGaps(project), []);
  assert.equal(runOperatorQA({ check: 'schema', project }).issues.some(issue => /commercialMemory|monetizationPromise/.test(issue.message)), false);
  delete project.productionMemory.skeletonMemory.finaleContract;
  assert.ok(collectLongFormMemoryGaps(project).some(issue => /finaleContract/.test(issue)), 'story requirements remain enforced');
});

test('author-provided commercial requirements remain in long-form task context', () => {
  const project = longFormProject();
  project.productionMemory.commercialMemory = { targetAudience: 'UNIQUE_AUDIENCE_MARKER', monetizationPromise: 'UNIQUE_AUTHOR_COMMERCIAL_PROMISE' };
  const context = buildLongFormMemoryContext(project);
  assert.equal(context.memory.commercialMemory?.monetizationPromise, 'UNIQUE_AUTHOR_COMMERCIAL_PROMISE');
  const prompt = renderLongFormMemoryForPrompt(context);
  assert.match(prompt, /UNIQUE_AUDIENCE_MARKER/);
  assert.match(prompt, /UNIQUE_AUTHOR_COMMERCIAL_PROMISE/);
});

test('same-origin service aliases and image/video presets share seven in-flight slots', async () => {
  const handlers = new Map<string, (req: any, res: any) => any>();
  const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (route: string, handler: any) => handlers.set(`${method} ${route}`, handler)]));
  const tasks = new Map<string, any>();
  const repository: any = {
    listComfyTasks: () => [...tasks.values()], getById: (id: string) => tasks.get(id),
    findByIdempotencyKey: (key: string) => [...tasks.values()].find(task => task.idempotencyKey === key),
    create: (value: any) => { const task = { ...value, id: `audit-${tasks.size}`, createdAt: Date.now(), updatedAt: Date.now() }; tasks.set(task.id, task); return task; },
    update: (id: string, patch: any) => { const task = { ...tasks.get(id), ...patch, updatedAt: Date.now() }; tasks.set(id, task); return task; },
  };
  const workflows = comfyAPIPresets.slice(0, 2).map((preset, i) => ({ ...structuredClone(preset.template), id: `flow-${i}`, channelId: i ? 'alias' : 'primary' }));
  const config = normalizeAIConfig({ ...structuredClone(defaultAIConfig),
    channels: ['primary', 'alias'].map((id, i) => ({ id, name: id, type: 'comfyui', apiKey: '', baseUrl: `https://audit.invalid/${i ? 'alias' : 'primary'}`, comfyQueue: { maxInFlight: 7, pollIntervalMs: 1000, waitTimeoutMs: 10000 } })),
    comfyWorkflows: workflows,
    models: workflows.map((workflow, i) => ({ id: `model-${i}`, channelId: workflow.channelId, modelId: workflow.id, alias: workflow.id, capabilities: [i ? 'video' : 'image'], comfyWorkflowId: workflow.id })),
  });
  let promptPosts = 0;
  const runtime = registerComfyUIGatewayRoutes(app as any, { repository, getConfig: () => config, mediaAssetsDir: tempDirectory, background: false,
    providerFetch: async (url) => {
      const parsed = new URL(String(url)); assert.equal(parsed.origin, 'https://audit.invalid');
      if (parsed.pathname.endsWith('/prompt')) return Response.json({ prompt_id: `fake-${++promptPosts}`, node_errors: {} });
      if (parsed.pathname.includes('/api/jobs/')) return Response.json({ status: 'pending' });
      throw Error(`Unexpected mocked endpoint ${url}`);
    },
  });
  for (let i = 0; i < 16; i++) {
    let code = 200, data: any;
    const res: any = { status: (value: number) => { code = value; return res; }, json: (value: any) => { data = value; return res; } };
    await handlers.get('post /api/proxy/comfyui-api/tasks')!({ body: { channelId: i % 2 ? 'alias' : 'primary', modelConfigId: `model-${i % 2}`, idempotencyKey: `independent-${i}`,
      input: { prompt: 'isolated mock only', width: 512, height: 288, aspectRatio: '16:9', duration: 5, seed: i, images: [], videos: [], audio: [] } } }, res);
    assert.equal(code, 202, JSON.stringify(data));
  }
  await runtime.tick();
  for (let i = 0; i < 100 && promptPosts < 7; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(promptPosts, 7);
  for (let i = 0; i < 3; i++) { await runtime.tick(); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(promptPosts, 7, 'aliases or presets must not multiply capacity');
  assert.equal([...tasks.values()].filter(task => task.providerTaskId).length, 7);
  assert.equal([...tasks.values()].filter(task => !task.providerTaskId).length, 9);
  assert.ok([...tasks.values()].some(task => task.providerTaskId && task.channelId === 'primary'));
  assert.ok([...tasks.values()].some(task => task.providerTaskId && task.channelId === 'alias'));
});
