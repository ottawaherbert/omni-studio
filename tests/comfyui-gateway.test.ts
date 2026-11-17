import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AIConfigSnapshot, ComfyWorkflow } from '../src/config/aiConfigDefaults';
import { normalizeAIConfig, defaultAIConfig } from '../src/config/aiConfigDefaults';
import { comfyAPIPresets } from '../src/config/comfyPresets';
import { compileComfyGraph, validateComfyTemplate } from '../packages/domain/src/comfyWorkflow';
import { createComfyVideoAdapter } from '../packages/production/src/services/production/comfyVideoAdapter';
import type { PersistedVideoGenerationTask, VideoGenerationTaskRepository } from '../src/server/videoGenerationTaskRepository';
import { compareComfyVideoPrompt } from '../src/server/providers/comfyExecutionEvidence';

process.env.OMNI_DB_PATH = path.join(os.tmpdir(), `omni-comfy-gateway-${process.pid}.db`);
const { registerComfyUIGatewayRoutes, comfyBaseUrl, comfyFailureDescription } = await import('../src/server/providers/comfyUIGateway');
const { publicAIConfig, COMFY_STORED_KEY, registerAiConfigRoutes } = await import('../src/server/routes/aiConfigRoutes');
const { db, dbHelpers } = await import('../src/server/db');

type Handler = (req: any, res: any) => unknown;
function appHarness() {
  const routes = new Map<string, Handler>();
  const app = Object.fromEntries(['get', 'post', 'put'].map(method => [method, (url: string, handler: Handler) => routes.set(`${method} ${url}`, handler)]));
  return { app, invoke: async (method: string, url: string, body: any = {}, params: any = {}) => {
    let code = 200, data: any;
    const response = { status: (n: number) => { code = n; return response; }, json: (v: unknown) => { data = v; return response; } };
    const handler = routes.get(`${method} ${url}`); assert.ok(handler, `${method} ${url}`);
    await handler({ body, params, query: {} }, response);
    return { code, data };
  } };
}
const input = { prompt: '完整创作提示词', width: 512, height: 288, aspectRatio: '16:9', duration: 5, seed: 7, images: [], videos: [], audio: [] };
const root = '/api/proxy/comfyui-api';
test('verified reservation release unblocks dispatch without replay and late association occupies capacity again', async () => {
  const f = await fixture();
  try {
    f.change({ prompt: 'timeout' });
    const first = (await f.submit('uncertain')).data.task;
    await f.settle(first.id);
    assert.equal(f.repository.getById(first.id)!.status, 'unknown');
    const second = (await f.submit('waiting')).data.task;
    await f.settle(second.id);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 1);
    assert.throws(() => f.runtime.releaseReservation(first.id, ' ', 'creator'), /核对/);
    const before = structuredClone(f.repository.getById(first.id)!);
    const released = f.runtime.releaseReservation(first.id, 'Checked provider queue and dated history: no matching active job.', 'external_agent');
    assert.equal(released.status, 'unknown'); assert.equal(released.providerTaskId, undefined);
    assert.deepEqual(released.request, before.request); assert.deepEqual(released.providerResponse, before.providerResponse);
    assert.equal(released.error, before.error);
    assert.deepEqual(f.runtime.releaseReservation(first.id, 'Repeat request', 'creator').dispatchReservationRelease, released.dispatchReservationRelease);
    f.change({ prompt: 'ok' }); await f.runtime.tick(); await f.settle(second.id);
    assert.ok(f.repository.getById(second.id)!.providerTaskId);
    await f.settle(first.id);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 2, 'released unknown task is never resubmitted');
    f.repository.update(second.id, { status: 'cancelled' });
    await f.runtime.reconcileFrozen(first.id, 'late-result');
    assert.equal(f.repository.getById(first.id)!.providerTaskId, 'late-result');
    assert.throws(() => f.runtime.releaseReservation(first.id, 'Already associated', 'creator'), /无上游编号/);
    const third = (await f.submit('later-waiter')).data.task; await f.settle(third.id);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 2, 'late association restores capacity counting despite release audit');
  } finally { await f.cleanup(); }
});

test('reservation release cannot bypass an active submission or another process lease', async () => {
  const f = await fixture();
  try {
    f.change({ prompt: 'timeout' });
    const task = (await f.submit('lease-guard')).data.task; await f.settle(task.id);
    const { GenerationLease } = await import('../src/server/generation/lease');
    const release = new GenerationLease(db).acquire(`comfy:${task.id}`)!;
    try { assert.throws(() => f.runtime.releaseReservation(task.id, 'Checked history', 'creator'), /已结束提交/); } finally { release(); }
    for (const status of ['queued', 'submitting', 'running', 'succeeded', 'failed', 'cancelled'] as const) {
      f.repository.update(task.id, { status });
      assert.throws(() => f.runtime.releaseReservation(task.id, 'Checked history', 'creator'), /未知任务/);
    }
  } finally { await f.cleanup(); }
});
async function fixture() {
  const media = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-comfy-media-'));
  const tasks = new Map<string, PersistedVideoGenerationTask>();
  const repository: VideoGenerationTaskRepository = {
    listComfyTasks: () => [...tasks.values()], getById: id => tasks.get(id), findByIdempotencyKey: key => [...tasks.values()].find(t => t.idempotencyKey === key),
    create: value => { const task = { ...value, id: `task-${tasks.size + 1}`, createdAt: Date.now(), updatedAt: Date.now() }; tasks.set(task.id, task); return task; },
    update: (id, patch) => { const task = { ...tasks.get(id)!, ...patch, updatedAt: Date.now() }; tasks.set(id, task); return task; },
  };
  const workflows: ComfyWorkflow[] = comfyAPIPresets.map((p, i) => ({ ...structuredClone(p.template), id: `workflow-${i}`, channelId: 'service' }));
  let config: AIConfigSnapshot = normalizeAIConfig({ ...defaultAIConfig, channels: [{ id: 'service', name: 'Test', type: 'comfyui', apiKey: 'secret-comfy-key', baseUrl: 'https://comfy.example.test/prefix', enabled: true, comfyQueue: { maxInFlight: 1, pollIntervalMs: 1000, waitTimeoutMs: 10000 } }], comfyWorkflows: workflows, models: workflows.map((w, i) => ({ id: `model-${i}`, channelId: 'service', modelId: `comfy-api-${i}`, alias: w.name, capabilities: [i ? 'video' : 'image'], comfyWorkflowId: w.id })) });
  const calls: Array<{ url: URL; init: RequestInit; body?: any }> = [];
  let promptMode: 'ok' | '429' | 'timeout' | '400' = 'ok';
  let jobStatus = 'pending', pollFailure = false, downloadFailure = false, cancelResult = true;
  let outputKind = 'image';
  let pauseUploads = false;
  let uploadStatus = 201;
  let failUploadNumber = 0;
  let videoPrompt: ((graph: any) => unknown) | undefined;
  let releaseUpload: (() => void) | undefined;
  const fetcher: typeof fetch = async (url, init: RequestInit = {}) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer secret-comfy-key');
    assert.equal(init.redirect, 'error');
    const endpoint = new URL(String(url));
    assert.ok(endpoint.pathname.startsWith('/prefix/'));
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: endpoint, init, body });
    if (endpoint.pathname.endsWith('/prompt')) {
      if (promptMode === 'timeout') throw new Error('network timeout');
      if (promptMode === '429') return new Response('queue full', { status: 429, headers: { 'Retry-After': '10' } });
      if (promptMode === '400') return new Response('bad graph', { status: 400 });
      return Response.json({ prompt_id: `prompt-${calls.filter(c => c.url.pathname.endsWith('/prompt')).length}`, node_errors: {} });
    }
    if (endpoint.pathname.endsWith('/api/v1/uploads')) {
      assert.ok(init.body instanceof FormData); assert.ok(init.body.get('file') instanceof Blob);
      if (failUploadNumber === calls.filter(c => c.url.pathname.endsWith('/api/v1/uploads')).length) return new Response('temporary upload failure', { status: 524 });
      if (uploadStatus !== 201) return new Response('temporary upload failure', { status: uploadStatus });
      if (pauseUploads) await new Promise<void>(resolve => { releaseUpload = resolve; });
      return Response.json({ filename: `account/上传-${calls.length}.png`, type: 'input' }, { status: 201 });
    }
    if (endpoint.pathname.endsWith('/cancel')) return Response.json({ cancelled: cancelResult });
    if (endpoint.pathname.endsWith('/api/jobs')) return Response.json({ jobs: [{ prompt_id: 'candidate', status: jobStatus }] });
    if (endpoint.pathname.includes('/api/jobs/')) {
      if (pollFailure) return new Response('busy', { status: 503 });
      return Response.json({ status: jobStatus, workflow: { prompt: calls.find(c => c.url.pathname.endsWith('/prompt'))?.body.prompt }, execution_error: { exception_message: 'model missing', node_id: '397', node_type: 'Sampler' } });
    }
    if (endpoint.pathname.includes('/history/')) {
      const id = decodeURIComponent(endpoint.pathname.split('/').at(-1)!);
      return Response.json({ [id]: { outputs: { save: outputKind === 'image'
        ? { images: [{ filename: 'gpu7/job 图片.png', subfolder: 'a b/图', type: 'temp' }] }
        : { gifs: [{ filename: 'gpu7/task file.mp4', subfolder: 'video a', type: 'output' }], audio: [{ filename: '声.wav', subfolder: '', type: 'output' }] } } } });
    }
    if (endpoint.pathname.endsWith('/view')) {
      if (downloadFailure) return new Response('temporary', { status: 503 });
      return new Response(Buffer.from(`actual-${endpoint.searchParams.get('filename')}`));
    }
    throw new Error(`Unexpected request ${endpoint}`);
  };
  const harness = appHarness();
  const runtime = registerComfyUIGatewayRoutes(harness.app as any, { repository, providerFetch: fetcher, getConfig: () => config, mediaAssetsDir: media, background: false,
    readVideoPrompt: async () => videoPrompt?.(calls.filter(c => c.url.pathname.endsWith('/prompt')).at(-1)?.body.prompt),
  });
  const submit = async (key = 'key', model = 'model-0', data: any = input) => harness.invoke('post', `${root}/tasks`, { channelId: 'service', modelConfigId: model, input: data, idempotencyKey: key });
  const settle = async (id: string) => { await runtime.processTask(repository.getById(id)!); return repository.getById(id)!; };
  return { ...harness, runtime, repository, tasks, calls, workflows, media, submit, settle, providerFetch: fetcher,
    releaseUploads: () => { pauseUploads = false; releaseUpload?.(); },
    change: (patch: { prompt?: typeof promptMode; status?: string; pollFailure?: boolean; downloadFailure?: boolean; outputKind?: string; cancelResult?: boolean; config?: AIConfigSnapshot; pauseUploads?: boolean; uploadStatus?: number; failUploadNumber?: number; videoPrompt?: (graph: any) => unknown }) => {
      if (patch.prompt) promptMode = patch.prompt; if (patch.status) jobStatus = patch.status;
      if (patch.pollFailure !== undefined) pollFailure = patch.pollFailure; if (patch.downloadFailure !== undefined) downloadFailure = patch.downloadFailure;
      if (patch.outputKind) outputKind = patch.outputKind; if (patch.cancelResult !== undefined) cancelResult = patch.cancelResult;
      if (patch.config) config = patch.config;
      if (patch.pauseUploads !== undefined) pauseUploads = patch.pauseUploads;
      if (patch.uploadStatus !== undefined) uploadStatus = patch.uploadStatus;
      if (patch.failUploadNumber !== undefined) failUploadNumber = patch.failUploadNumber;
      if (patch.videoPrompt) videoPrompt = patch.videoPrompt;
    }, getConfig: () => config, cleanup: () => fs.rm(media, { recursive: true, force: true }),
  };
}

function useReferenceWorkflow(f: Awaited<ReturnType<typeof fixture>>, imageInputs = 1) {
  const template: ComfyWorkflow = { ...structuredClone(f.workflows[0]), id: 'staged-refs',
    api: { ...f.workflows[0].api!, operation: 'i2i', imageInputs },
    workflowJson: { loader: { class_type: 'Loader', inputs: { prompt: '', width: 512, height: 288,
      ...Object.fromEntries(Array.from({length:imageInputs}, (_,i)=>[`image${i}`, ''])) } } },
    mappings: [...['prompt','width','height'].map(param=>({systemParam:param,nodeId:'loader',nodeInput:param})),
      ...Array.from({length:imageInputs},(_,i)=>({systemParam:`image:${i}`,nodeId:'loader',nodeInput:`image${i}`}))] };
  f.change({config:{...f.getConfig(),channels:f.getConfig().channels.map(c=>({...c,comfyQueue:{...c.comfyQueue!,maxInFlight:7}})),
    comfyWorkflows:[template],models:[{id:'model-0',channelId:'service',alias:'Refs',modelId:'refs',capabilities:['image'],comfyWorkflowId:template.id}]}});
}

test('reference staging is shared across dispatchers without serializing the seven GPU jobs', async () => {
  const f = await fixture(); let pending: Promise<unknown> | undefined;
  const second = registerComfyUIGatewayRoutes(appHarness().app as any, {repository:f.repository,providerFetch:f.providerFetch,getConfig:f.getConfig,mediaAssetsDir:f.media,background:false});
  try {
    useReferenceWorkflow(f); f.change({pauseUploads:true});
    const ids: string[] = [];
    for(let i=0;i<8;i++) ids.push((await f.submit(`parallel-${i}`,'model-0',{...input,images:[`data:image/png;base64,${Buffer.from(`ref-${i}`).toString('base64')}`]})).data.task.id);
    pending=f.settle(ids[0]); await new Promise(r=>setImmediate(r));
    await Promise.all(ids.slice(1).map(id=>second.processTask(f.repository.getById(id)!)));
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/api/v1/uploads')).length,1);
    assert.equal(f.repository.getById(ids[1])!.status,'queued','waiting for uploads must not occupy a GPU reservation');
    f.releaseUploads(); await pending;
    for(const id of ids.slice(1)) await second.processTask(f.repository.getById(id)!);
    assert.equal(ids.filter(id=>f.repository.getById(id)!.providerTaskId).length,7,'all seven jobs submitted before any completes');
    assert.equal(f.repository.getById(ids[7])!.status,'queued','eighth job respects the GPU pool');
    const uploads=f.calls.filter(c=>c.url.pathname.endsWith('/api/v1/uploads'));
    assert.equal(new Set(uploads.map(c=>((c.init.body as FormData).get('file') as File).name)).size,7,'different reference bytes have distinct upstream filenames');
    f.change({status:'in_progress'}); f.repository.update(ids[0],{nextAttemptAt:0}); await f.settle(ids[0]);
    assert.equal(f.repository.getById(ids[0])!.status,'running','polling is independent of reference staging');
  } finally {f.releaseUploads();await pending;second.stop();await f.cleanup();}
});

test('partial uploads survive a dispatcher restart and only the failed reference is uploaded again', async () => {
  const f=await fixture(); let second:ReturnType<typeof registerComfyUIGatewayRoutes>|undefined;
  try {
    useReferenceWorkflow(f,2); f.change({failUploadNumber:2});
    const task=(await f.submit('resume-refs','model-0',{...input,images:['data:image/png;base64,AAAA','data:image/png;base64,AQID']})).data.task;
    const failed=await f.settle(task.id);assert.equal(failed.status,'queued');assert.equal(failed.providerTaskId,undefined);
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/prompt')).length,0);
    second=registerComfyUIGatewayRoutes(appHarness().app as any,{repository:f.repository,providerFetch:f.providerFetch,getConfig:f.getConfig,mediaAssetsDir:f.media,background:false});
    f.repository.update(task.id,{nextAttemptAt:0});await second.processTask(f.repository.getById(task.id)!);
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/api/v1/uploads')).length,3,'reuse successful first upload');
    const prompts=f.calls.filter(c=>c.url.pathname.endsWith('/prompt'));assert.equal(prompts.length,1);
    assert.equal(prompts[0].body.prompt.loader.inputs.image0,'account/上传-1.png');
    assert.equal(prompts[0].body.prompt.loader.inputs.image1,'account/上传-3.png');
  } finally {second?.stop();await f.cleanup();}
});

test('restart recovers only pre-POST work after an old lease expires, not just at startup',async()=>{
  const f=await fixture();let restarted:ReturnType<typeof registerComfyUIGatewayRoutes>|undefined;
  const {GenerationLease}=await import('../src/server/generation/lease');
  let release:(()=>void)|undefined;
  try {
    const template=(await f.submit('recovery-template')).data.task;await f.settle(template.id);
    const original=f.repository.getById(template.id)!;f.repository.update(template.id,{status:'cancelled'});
    const task=f.repository.create({...original,idempotencyKey:'delayed-recovery',status:'submitting',providerTaskId:undefined,nextAttemptAt:undefined,providerResponse:{stage:'uploading'}});
    const before=f.calls.length;
    release=new GenerationLease(db).acquire(`comfy:${task.id}`)!;
    restarted=registerComfyUIGatewayRoutes(appHarness().app as any,{repository:f.repository,providerFetch:f.providerFetch,getConfig:f.getConfig,mediaAssetsDir:f.media});
    assert.equal(f.repository.getById(task.id)!.status,'submitting');
    await restarted.tick();assert.equal(f.calls.length,before,'a live lease is not stolen');
    release();release=undefined;await restarted.tick();await restarted.processTask(f.repository.getById(task.id)!);
    assert.ok(f.repository.getById(task.id)!.providerTaskId);
    f.repository.update(task.id,{status:'cancelled'});
    const uncertain=f.repository.create({...original,idempotencyKey:'posting-at-crash',status:'submitting',providerTaskId:undefined,nextAttemptAt:undefined,providerResponse:{stage:'posting'}});
    await restarted.tick();assert.equal(f.repository.getById(uncertain.id)!.status,'unknown');
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/prompt')).length,2,'uncertain POST never replays');
  }finally{release?.();restarted?.stop();await f.cleanup();}
});

test('API presets, exact mappings, typed references and configured capabilities', () => {
  for (const preset of comfyAPIPresets) validateComfyTemplate(preset.template);
  const graph = compileComfyGraph(comfyAPIPresets[0].template, input);
  assert.equal(graph['4'].inputs.prompt, input.prompt); assert.equal(graph['5'].inputs.height, 288);
  assert.notEqual(graph, comfyAPIPresets[0].template.workflowJson);
  assert.throws(() => compileComfyGraph(comfyAPIPresets[0].template, { ...input, images: ['not-accepted'] }), /0.*images/);
  assert.throws(() => validateComfyTemplate({ ...comfyAPIPresets[0].template, workflowJson: { nodes: [], links: [] } }), /导出（API）/);
  assert.throws(() => compileComfyGraph(comfyAPIPresets[1].template, { ...input, aspectRatio: '9:16' }), /枚举值/);
  const adapter = createComfyVideoAdapter(comfyAPIPresets[1].template.api!);
  assert.equal(adapter.capabilities.referenceImages, false); assert.equal(adapter.modes[0].requiresStartFrame, false); assert.equal(adapter.modes[0].id, 'text_only');
  assert.throws(() => comfyBaseUrl('https://user:password@example.test'), /凭证/);
  assert.equal(comfyBaseUrl('https://example.test/prefix/'), 'https://example.test/prefix');
});

test('structured execution failures retain useful event and node details', () => {
  assert.equal(comfyFailureDescription({ execution_status: { status_str: 'error', messages: [['execution_interrupted', { node_id: '397', node_type: 'SelfLiftH3Sampler' }]] } }), '执行失败：execution_interrupted；节点 397 SelfLiftH3Sampler');
  assert.equal(comfyFailureDescription({ execution_error: 'Worker cancelled' }), '执行失败：Worker cancelled');
  assert.equal(comfyFailureDescription({ execution_error: { exception_message: 'model missing', node_id: 0 } }), '执行失败：model missing；节点 0');
  assert.equal(comfyFailureDescription({ execution_status: {} }), '执行失败：未知错误');
});

test('embedded workflow comparison ignores cache annotations but detects rewritten core and prompt', () => {
  const expected = { prompt: { class_type: 'PrimitiveString', inputs: { value: '保留完整正文' } }, attention: { class_type: 'ModelAttentionBackend', inputs: { model: ['model', 0], attention: 'comfy kitchen attention' } }, model: { class_type: 'UNETLoader', inputs: { unet_name: 'original.safetensors' } } };
  const actual = structuredClone(expected) as any;
  actual.model.inputs.is_changed = ['runtime-cache-fingerprint']; actual.model._meta = { title: '运行时显示名' };
  assert.equal(compareComfyVideoPrompt(expected, actual).status, 'matched', 'a graph may have a node literally named prompt');
  assert.equal(compareComfyVideoPrompt(expected, { prompt: actual }).status, 'matched');
  actual.attention.inputs.attention = 'pytorch attention'; actual.prompt.inputs.value = 'secret-value-not-to-print';
  const evidence = compareComfyVideoPrompt(expected, actual);
  assert.deepEqual(evidence.changedFields.sort(), ['attention.inputs.attention', 'prompt.inputs.value']);
  assert.equal(evidence.status, 'mismatch'); assert.ok(!JSON.stringify(evidence).includes('secret-value-not-to-print'));
  delete actual.model;
  assert.ok(compareComfyVideoPrompt(expected, actual).changedFields.includes('model.node'));
  assert.equal(compareComfyVideoPrompt(expected, undefined).status, 'unavailable');
  assert.equal(compareComfyVideoPrompt(expected, { nodes: [], links: [] }).status, 'unavailable');
});

test('rewritten video metadata keeps the output and propagates a technical issue without resubmitting', async () => {
  const f = await fixture();
  try {
    const config = f.getConfig();
    (config.comfyWorkflows[1].workflowJson as any)['331'].inputs.attention = 'comfy kitchen attention';
    f.change({ outputKind: 'video', videoPrompt: graph => {
      const actual = structuredClone(graph); actual['331'].inputs.attention = 'pytorch attention'; return actual;
    } });
    const task = (await f.submit('metadata-drift', 'model-1')).data.task;
    await f.settle(task.id); f.change({ status: 'completed' }); f.repository.update(task.id, { nextAttemptAt: 0 });
    const done = await f.settle(task.id), output = done.outputs!.find(o => o.kind === 'video')!;
    assert.equal(done.status, 'succeeded'); assert.equal(output.executionEvidence?.status, 'mismatch');
    assert.deepEqual(output.executionEvidence?.changedFields, ['331.inputs.attention']);
    assert.match(output.technicalIssues![0], /工作流与提交图不一致/);
    assert.ok((await fs.stat(path.join(f.media, output.url.slice('/media/'.length)))).size > 0, 'mismatching output is retained');
    const { GenerationProviders } = await import('../src/server/generation/providers');
    const { GenerationMediaStore } = await import('../src/server/generation/media');
    const providers = new GenerationProviders(f.getConfig, new GenerationMediaStore(f.media)); providers.comfy = f.runtime;
    const polled = await providers.poll({ capability: { provider: 'comfyui' } } as any, { providerRecordId: done.id } as any);
    assert.deepEqual(polled.outputs!.find(o => o.kind === 'video')!.technicalIssues, output.technicalIssues);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 1);
  } finally { await f.cleanup(); }
});

test('YZ dialogue and action presets preserve reference order and distinct sampling chains', () => {
  const referenceInput = { ...input, images: ['account/wen.png', 'account/xu.png', 'account/lab.png'], duration: 10 };
  const dialogue = comfyAPIPresets.find(p => p.id === 'h3-reference-3')!.template;
  const action = comfyAPIPresets.find(p => p.id === 'h3-action-3')!.template;
  for (const template of [dialogue, action]) {
    const graph = compileComfyGraph(template, referenceInput);
    referenceInput.images.forEach((filename, index) => {
      assert.equal(graph[String(900 + index)].inputs.image, filename);
      assert.deepEqual(graph['265'].inputs[`ref_images.ref_image_${index}`], [String(900 + index), 0]);
    });
    assert.equal(graph['397'].inputs.transition_step, 6);
    assert.equal(graph['397'].inputs.lowres_scale, 0.6000000000000001);
    assert.equal(graph['397'].inputs.upscaler_model, 'h3_upscaler_lms_v0.1.safetensors');
    assert.throws(() => compileComfyGraph(template, { ...referenceInput, images: referenceInput.images.slice(0, 2) }), /3.*images/);
  }
  const d = compileComfyGraph(dialogue, referenceInput), a = compileComfyGraph(action, referenceInput);
  assert.equal(d['261'].inputs.steps, 10);
  assert.equal(a['261'].inputs.steps, 12);
  assert.equal(d['252'].inputs.megapixels, 1.5);
  assert.equal(a['252'].inputs.megapixels, 2);
  assert.deepEqual(d['331'].inputs.model, ['53', 0]);
  assert.ok(!a['400'], 'legacy action configuration remains explicit');
  assert.ok(!a['332'], 'legacy action configuration is not silently converted');
  assert.deepEqual(a['331'].inputs.model, ['343', 0]);
  assert.equal(a['343'].inputs.strength_model, 3);
  assert.deepEqual(a['342'].inputs.model, ['53', 0]);
  assert.deepEqual(a['345'].inputs.model, ['342', 0]);
  assert.deepEqual(a['344'].inputs.model, ['345', 0]);
  assert.equal(a['397'].inputs.highres_tiling, true);
});

test('storyboard planning remains fourth reference and never becomes an i2v first frame', () => {
  const template = comfyAPIPresets.find(p => p.id === 'h3-storyboard-4')!.template;
  const images = ['account/wen.png', 'account/xu.png', 'account/lab.png', 'account/grid.png'];
  const graph = compileComfyGraph(template, { ...input, images });
  assert.equal(graph['265'].class_type, 'MiniMaxH3ReferenceToVideo');
  images.forEach((filename, index) => {
    assert.equal(graph[String(900 + index)].inputs.image, filename);
    assert.deepEqual(graph['265'].inputs[`ref_images.ref_image_${index}`], [String(900 + index), 0]);
  });
  assert.ok(!Object.values(graph).some(n => n.class_type === 'MiniMaxH3ImageToVideo'));
  assert.equal(createComfyVideoAdapter(template.api!).modes[0].requiresStartFrame, false);
  assert.equal(createComfyVideoAdapter(template.api!).capabilities.multiShot, true);
  assert.equal(createComfyVideoAdapter(comfyAPIPresets[1].template.api!).capabilities.multiShot, false);
  assert.throws(() => validateComfyTemplate({ ...comfyAPIPresets[0].template, api: { ...comfyAPIPresets[0].template.api!, multiShot: true } }), /图片工作流/);
  assert.throws(() => compileComfyGraph(template, { ...input, images: images.slice(0, 3) }), /4.*images/);
  const first = comfyAPIPresets.find(p => p.id === 'h3-first-frame')!.template;
  const firstGraph = compileComfyGraph(first, { ...input, images: [images[0]] });
  assert.ok(Object.values(firstGraph).some(n => n.class_type === 'MiniMaxH3ImageToVideo'));
  assert.throws(() => compileComfyGraph(first, { ...input, images }), /1.*images/);
});

test('H3 presets reject requests above 14 seconds and cap the aligned frame grid below it', () => {
  for (const preset of comfyAPIPresets.filter(p => p.id.startsWith('h3-'))) {
    const template = preset.template;
    const data = { ...input, duration: 14, images: Array.from({ length: template.api!.imageInputs }, (_, i) => `account/ref-${i}.png`) };
    const graph = compileComfyGraph(template, data);
    assert.equal(template.api!.maxDuration, 14);
    assert.equal(graph['397'].class_type, 'SelfLiftH3Sampler');
    assert.equal(graph['53'].inputs.lora_name, 'minimax_h3_dmad_full_dareties_v4_step600_comfy_fro.safetensors');
    assert.ok(Math.abs(Number(graph['53'].inputs.strength_model) - 0.8) < 1e-8);
    assert.equal(graph['397'].inputs.upscaler_model, 'h3_upscaler_lms_v0.1.safetensors');
    assert.deepEqual(graph['397'].inputs.model, ['329', 0]);
    assert.deepEqual(graph['329'].inputs.model, ['401', 0]);
    assert.deepEqual(graph['401'].inputs.model, ['333', 0]);
    assert.deepEqual(graph['333'].inputs.model, ['331', 0]);
    assert.match(String(graph['250'].inputs.expression), /^min\(328,/);
    assert.equal((328 - 5) % 17, 0);
    assert.ok(328 / 24 < 14);
    assert.ok((328 + 17) / 24 > 14, 'next aligned native frame count would exceed the limit');
    assert.throws(() => compileComfyGraph(template, { ...data, duration: 14.01 }), /14/);
  }
});

test('authenticated image lifecycle, stable file triplets, local archive and idempotence', async () => {
  const f = await fixture();
  try {
    const res = await f.submit(); assert.equal(res.code, 202);
    const id = res.data.task.id; await f.settle(id);
    assert.equal(f.repository.getById(id)?.providerTaskId, 'prompt-1');
    assert.equal((await f.submit()).data.task.duplicate, true);
    assert.equal((await f.submit('key', 'model-0', { ...input, prompt: 'changed' })).code, 409);
    f.change({ status: 'completed' }); f.repository.update(id, { nextAttemptAt: 0 });
    const completed = await f.settle(id); assert.equal(completed.status, 'succeeded');
    const file = completed.outputs![0]; assert.ok(file.url.startsWith('/media/comfyui/'));
    assert.equal(await fs.readFile(path.join(f.media, file.url.slice('/media/'.length)), 'utf8'), 'actual-gpu7/job 图片.png');
    const download = f.calls.find(c => c.url.pathname.endsWith('/view'))!;
    assert.equal(download.url.searchParams.get('filename'), 'gpu7/job 图片.png'); assert.equal(download.url.searchParams.get('subfolder'), 'a b/图'); assert.equal(download.url.searchParams.get('type'), 'temp');
    const publicTask = (await f.invoke('get', `${root}/tasks/:id`, {}, { id })).data;
    assert.ok(!JSON.stringify(publicTask).includes('secret-comfy-key')); assert.ok(!publicTask.task.request);
  } finally { await f.cleanup(); }
});

test('image and video share one budget, video in gifs and all audio outputs are archived', async () => {
  const f = await fixture();
  try {
    const first = (await f.submit('image')).data.task; await f.settle(first.id);
    const second = (await f.submit('video', 'model-1')).data.task;
    await f.runtime.tick(); assert.equal(f.repository.getById(second.id)?.providerTaskId, undefined);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 1);
    f.change({ status: 'completed' }); f.repository.update(first.id, { nextAttemptAt: 0 }); await f.settle(first.id);
    await f.runtime.tick(); await f.settle(second.id);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 2);
    f.change({ outputKind: 'video' }); f.repository.update(second.id, { nextAttemptAt: 0 });
    const task = await f.settle(second.id);
    assert.equal(task.status, 'succeeded'); assert.equal(task.outputs?.length, 2); assert.equal(task.embeddedAudio, true); assert.ok(task.videoUrl?.endsWith('.mp4'));
  } finally { await f.cleanup(); }
});

test('429 waits, uncertain POST never retries, recovery verifies exact graph', async () => {
  const f = await fixture();
  try {
    f.change({ prompt: '429' }); const task = (await f.submit()).data.task;
    await f.settle(task.id); assert.equal(f.repository.getById(task.id)?.status, 'queued');
    const firstCalls = f.calls.length; await f.runtime.tick(); await f.settle(task.id); assert.equal(f.calls.length, firstCalls);
    f.change({ prompt: 'timeout' }); f.repository.update(task.id, { nextAttemptAt: 0 }); await f.settle(task.id);
    assert.equal(f.repository.getById(task.id)?.status, 'unknown'); const submits = f.calls.length;
    await f.runtime.tick(); await f.settle(task.id); await f.submit(); assert.equal(f.calls.length, submits);
    assert.equal((await f.invoke('post', `${root}/tasks/:id/cancel`, {}, { id: task.id })).code, 409);
    f.change({ status: 'completed' });
    const resume = await f.invoke('post', `${root}/tasks/:id/resume`, { providerTaskId: 'candidate' }, { id: task.id });
    assert.equal(resume.code, 200); assert.equal(resume.data.task.status, 'succeeded');
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 2);
  } finally { await f.cleanup(); }
});

test('read/download errors retain upstream task, resume without re-submission, cancel confirms status', async () => {
  const f = await fixture();
  try {
    const task = (await f.submit()).data.task; await f.settle(task.id);
    f.change({ status: 'completed', downloadFailure: true }); f.repository.update(task.id, { nextAttemptAt: 0 }); await f.settle(task.id);
    assert.equal(f.repository.getById(task.id)?.status, 'queued'); assert.ok(f.repository.getById(task.id)?.error);
    f.change({ downloadFailure: false });
    const result = await f.invoke('post', `${root}/tasks/:id/resume`, {}, { id: task.id });
    assert.equal(result.data.task.status, 'succeeded'); assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 1);
    f.change({ status: 'pending' }); const next = (await f.submit('next')).data.task; await f.settle(next.id);
    const cancel = await f.invoke('post', `${root}/tasks/:id/cancel`, {}, { id: next.id }); assert.equal(cancel.data.task.status, 'queued');
    f.change({ status: 'cancelled' }); const cancelled = await f.invoke('get', `${root}/tasks/:id`, {}, { id: next.id }); assert.equal(cancelled.data.task.status, 'cancelled');
  } finally { await f.cleanup(); }
});

test('uploads mapped to arbitrary nodes, exact filenames, no dropped images/videos/audio', async () => {
  const f = await fixture();
  try {
    const template: ComfyWorkflow = { id: 'reference', channelId: 'service', kind: 'api_graph', enabled: true, name: 'Refs',
      api: { operation: 'reference_video', imageInputs: 1, videoInputs: 1, audioInputs: 1, nativeAudio: false, minDuration: 1, maxDuration: 10 },
      workflowJson: { arbitrary: { class_type: 'Loader', inputs: { text: '', width: 1, height: 1, duration: 1, i: '', v: '', a: '' } } },
      mappings: ['prompt:text', 'width:width', 'height:height', 'duration:duration'].map(item => ({ systemParam: item.split(':')[0], nodeId: 'arbitrary', nodeInput: item.split(':')[1] })).concat([
        { systemParam: 'image:0', nodeId: 'arbitrary', nodeInput: 'i' }, { systemParam: 'video:0', nodeId: 'arbitrary', nodeInput: 'v' }, { systemParam: 'audio:0', nodeId: 'arbitrary', nodeInput: 'a' }]) };
    f.change({ config: { ...f.getConfig(), comfyWorkflows: [template], models: [{ id: 'ref-model', channelId: 'service', alias: 'Refs', modelId: 'api-refs', capabilities: ['video'], comfyWorkflowId: template.id }] } });
    const data = { ...input, images: ['data:image/png;base64,AAAA'], videos: ['data:video/mp4;base64,AAAA'], audio: ['data:audio/wav;base64,AAAA'] };
    const task = (await f.submit('refs', 'ref-model', data)).data.task; await f.settle(task.id);
    const uploads = f.calls.filter(c => c.url.pathname.endsWith('/api/v1/uploads')); assert.equal(uploads.length, 3);
    const prompt = f.calls.find(c => c.url.pathname.endsWith('/prompt'))!.body.prompt;
    assert.match(prompt.arbitrary.inputs.i, /^account\/上传-/); assert.match(prompt.arbitrary.inputs.v, /^account\/上传-/); assert.match(prompt.arbitrary.inputs.a, /^account\/上传-/);
    const invalid = await f.submit('invalid', 'ref-model', { ...data, images: [] }); assert.equal(invalid.code, 400);
  } finally { await f.cleanup(); }
});

test('disabled workflow, node errors, unknown job ids and public key masking', async () => {
  const f = await fixture();
  try {
    f.change({ config: { ...f.getConfig(), comfyWorkflows: f.workflows.map(w => ({ ...w, enabled: false })) } });
    assert.equal((await f.submit()).code, 400);
    f.change({ config: { ...f.getConfig(), comfyWorkflows: f.workflows } });
    const task = (await f.submit()).data.task; await f.settle(task.id);
    f.change({ status: 'failed' }); f.repository.update(task.id, { nextAttemptAt: 0 });
    const failed = await f.settle(task.id); assert.equal(failed.status, 'failed'); assert.match(failed.error!, /397.*Sampler/);
    assert.equal((await f.invoke('get', `${root}/tasks/:id`, {}, { id: 'unknown' })).code, 404);
    const safe = publicAIConfig({ config: f.getConfig(), hasSavedConfig: true }); assert.equal(safe.config.channels[0].apiKey, COMFY_STORED_KEY); assert.ok(!JSON.stringify(safe).includes('secret-comfy-key'));
  } finally { await f.cleanup(); }
});

test('config API retains masked key and truthful workflow capabilities', async () => {
  const f = await fixture();
  try {
    dbHelpers.saveAIConfig(f.getConfig());
    const h = appHarness(); registerAiConfigRoutes(h.app as any, { getProviderKeyStatus: () => ({}) });
    const loaded = await h.invoke('get', '/api/ai-config');
    const config = loaded.data.config; config.channels[0].name = 'Renamed';
    const saved = await h.invoke('put', '/api/ai-config', config); assert.equal(saved.code, 200);
    assert.equal(dbHelpers.getAIConfig().config.channels[0].apiKey, 'secret-comfy-key');
    assert.equal(saved.data.config.models[1].comfyCapabilities.operation, 't2v');
    assert.deepEqual(saved.data.config.models[1].comfyCapabilities.aspectRatios, ['16:9']);
    assert.ok(!JSON.stringify(saved.data).includes('secret-comfy-key'));
  } finally { await f.cleanup(); }
});

test('429 preserves prepared upload graph and local cancellation during upload never posts prompt', async () => {
  const f = await fixture();
  try {
    const template: ComfyWorkflow = { ...structuredClone(f.workflows[0]), id: 'i2i', api: { ...f.workflows[0].api!, operation: 'i2i', imageInputs: 1 },
      workflowJson: { loader: { class_type: 'LoadImage', inputs: { image: '' } }, custom: { class_type: 'Custom', inputs: { prompt: '', width: 512, height: 512, seed: 0 } } },
      mappings: [{ systemParam: 'image:0', nodeId: 'loader', nodeInput: 'image' }, ...['prompt', 'width', 'height', 'seed'].map(param => ({ systemParam: param, nodeId: 'custom', nodeInput: param }))] };
    f.change({ config: { ...f.getConfig(), comfyWorkflows: [template], models: [{ id: 'model-0', channelId: 'service', alias: 'I2I', modelId: 'i2i', capabilities: ['image'], comfyWorkflowId: 'i2i' }] }, prompt: '429' });
    const data = { ...input, seed: undefined, images: ['data:image/png;base64,AAAA'] };
    const task = (await f.submit('retry-upload', 'model-0', data)).data.task;
    await f.settle(task.id); f.change({ prompt: 'ok' }); f.repository.update(task.id, { nextAttemptAt: 0 }); await f.settle(task.id);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/api/v1/uploads')).length, 1);
    const prompts = f.calls.filter(c => c.url.pathname.endsWith('/prompt'));
    assert.deepEqual(prompts[0].body, prompts[1].body);
    f.repository.update(task.id, { status: 'cancelled' });
    f.change({ pauseUploads: true });
    const next = (await f.submit('cancel-upload', 'model-0', data)).data.task;
    const inFlight = f.settle(next.id);
    await new Promise(resolve => setImmediate(resolve));
    const cancelled = await f.invoke('post', `${root}/tasks/:id/cancel`, {}, { id: next.id });
    assert.equal(cancelled.data.task.status, 'cancelled');
    f.releaseUploads(); await inFlight;
    assert.equal(f.repository.getById(next.id)?.status, 'cancelled');
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 2);
  } finally { f.releaseUploads(); await f.cleanup(); }
});

test('transient upload failures retry finitely before any paid submission', async () => {
  const f = await fixture();
  try {
    const template: ComfyWorkflow = { ...structuredClone(f.workflows[0]), id: 'upload-retry', api: { ...f.workflows[0].api!, operation: 'i2i', imageInputs: 1 },
      workflowJson: { loader: { class_type: 'LoadImage', inputs: { image: '' } }, custom: { class_type: 'Custom', inputs: { prompt: '', width: 512, height: 512 } } },
      mappings: [{ systemParam: 'image:0', nodeId: 'loader', nodeInput: 'image' }, ...['prompt', 'width', 'height'].map(param => ({ systemParam: param, nodeId: 'custom', nodeInput: param }))] };
    f.change({ config: { ...f.getConfig(), comfyWorkflows: [template], models: [{ id: 'model-0', channelId: 'service', alias: 'I2I', modelId: 'i2i', capabilities: ['image'], comfyWorkflowId: template.id }] }, uploadStatus: 524 });
    const data = { ...input, seed: undefined, images: ['data:image/png;base64,AAAA'] };
    const task = (await f.submit('upload-transient', 'model-0', data)).data.task;
    let result = await f.settle(task.id);
    assert.equal(result.status, 'queued'); assert.equal(result.attempts, 1);
    assert.equal(result.providerResponse?.stage, 'uploading'); assert.equal(result.providerTaskId, undefined);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 0);
    assert.ok(result.nextAttemptAt! > Date.now());
    f.change({ uploadStatus: 201 }); f.repository.update(task.id, { nextAttemptAt: 0 });
    result = await f.settle(task.id);
    assert.ok(result.providerTaskId); assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 1);
    f.repository.update(task.id, { status: 'cancelled' });
    f.change({ uploadStatus: 503 });
    const permanent = (await f.submit('upload-exhausted', 'model-0', data)).data.task;
    for (let i = 0; i < 3; i++) { f.repository.update(permanent.id, { nextAttemptAt: 0 }); result = await f.settle(permanent.id); }
    assert.equal(result.status, 'failed'); assert.equal(result.providerTaskId, undefined);
    assert.equal(f.calls.filter(c => c.url.pathname.endsWith('/prompt')).length, 1);
  } finally { await f.cleanup(); }
});

test('restart only requeues work known not to have posted; uncertain submission needs reconciliation', async () => {
  const f = await fixture();
  let restarted: ReturnType<typeof registerComfyUIGatewayRoutes> | undefined;
  try {
    const original = (await f.submit()).data.task; await f.settle(original.id);
    const saved = f.repository.getById(original.id)!;
    const prepared = f.repository.create({ ...saved, idempotencyKey: 'prepared', status: 'submitting', providerTaskId: undefined, providerResponse: { graph: saved.providerResponse?.graph, stage: 'prepared' } });
    const posting = f.repository.create({ ...saved, idempotencyKey: 'posting', status: 'submitting', providerTaskId: undefined, providerResponse: { graph: saved.providerResponse?.graph, stage: 'posting' } });
    restarted = registerComfyUIGatewayRoutes(appHarness().app as any, { repository: f.repository, getConfig: f.getConfig, mediaAssetsDir: f.media });
    assert.equal(f.repository.getById(prepared.id)?.status, 'queued');
    assert.equal(f.repository.getById(posting.id)?.status, 'unknown');
    assert.equal(f.repository.getById(original.id)?.providerTaskId, 'prompt-1');
  } finally { restarted?.stop(); await f.cleanup(); }
});

test.after(async () => { db.close(); await fs.rm(process.env.OMNI_DB_PATH!, { force: true }); });
