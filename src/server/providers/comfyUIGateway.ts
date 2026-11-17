import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Express } from 'express';
import { db, dbHelpers } from '../db';
import { GenerationLease } from '../generation/lease';
import { videoGenerationTaskRepository, publicVideoGenerationTask, type PersistedVideoGenerationTask, type VideoGenerationTaskRepository } from '../videoGenerationTaskRepository';
import { compileComfyGraph, validateComfyInput, comfyMediaKind, type ComfyGenerationInput, type ComfyAPITemplate } from '../../../packages/domain/src/comfyWorkflow';
import type { AIChannel, AIConfigSnapshot } from '../../config/aiConfigDefaults';
import { assertPublicRemoteUrl } from '../routes/assetRoutes';
import { compareComfyVideoPrompt, readComfyVideoPrompt } from './comfyExecutionEvidence';
import type { DispatchReservationRelease } from '../../../packages/domain/src/generation';

const ACTIVE = ['queued', 'running', 'submitting', 'unknown'];
// A verified release only removes an uncertain local reservation. A known
// upstream job always occupies capacity again, including after late association.
const occupiesCapacity = (task: PersistedVideoGenerationTask) => ACTIVE.includes(task.status)
  && !!(task.providerTaskId || task.status === 'submitting' || (task.status === 'unknown' && !task.dispatchReservationRelease));
const MAX_INPUT = 50 * 1024 * 1024;
type UploadedInputs = Partial<Record<'images' | 'videos' | 'audio', Record<number, { sourceHash: string; filename: string }>>>;
export function comfyBaseUrl(raw: string): string {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw new Error('ComfyUI 地址无效，不能包含凭证、查询或片段。');
  if (url.protocol === 'http:' && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(url.hostname)) throw new Error('公网 ComfyUI 服务须使用 HTTPS。');
  return url.toString().replace(/\/+$/, '');
}
const stable = (value: unknown): string => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const hash = (v: unknown) => crypto.createHash('sha256').update(stable(v)).digest('hex');
class GatewayError extends Error {
  constructor(message: string, readonly status = 502, readonly retryAfterMs = 0) { super(message); }
}
const scrub = (value: unknown, key = '') => String(value instanceof Error ? value.message : value)
  .replaceAll(key || '\0', '[已隐藏]').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]').slice(0, 2000);
const retryDelay = (attempts: number) => Math.min(60000, 3000 * 2 ** Math.min(attempts, 5));
export function comfyFailureDescription(job: { execution_error?: unknown; execution_status?: unknown }): string {
  const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const text = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const detail = record(job.execution_error), state = record(job.execution_status);
  const lastEvent = Array.isArray(state.messages) ? state.messages.at(-1) : undefined;
  const event = Array.isArray(lastEvent) ? record(lastEvent[1]) : {};
  const message = text(detail.exception_message) || text(job.execution_error) || text(event.exception_message)
    || text(state.message) || (Array.isArray(lastEvent) ? text(lastEvent[0]) : undefined)
    || text(job.execution_status) || text(state.status_str) || '未知错误';
  const id = detail.node_id ?? event.node_id;
  const nodeId = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
  const nodeType = text(detail.node_type) || text(event.node_type) || '';
  return `执行失败：${message}${nodeId || nodeType ? `；节点 ${[nodeId, nodeType].filter(Boolean).join(' ')}` : ''}`;
}
const kindFor = (filename: string): 'image' | 'video' | 'audio' | undefined => {
  const ext = path.extname(filename).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.mkv', '.m4v'].includes(ext)) return 'video';
  if (['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'].includes(ext)) return 'audio';
};

export function registerComfyUIGatewayRoutes(app: Express, deps: {
  repository?: VideoGenerationTaskRepository;
  providerFetch?: typeof fetch;
  getConfig?: () => AIConfigSnapshot;
  mediaAssetsDir?: string;
  background?: boolean;
  authorizeTask?: (task: PersistedVideoGenerationTask) => void;
  readVideoPrompt?: (file: string) => Promise<unknown>;
} = {}) {
  const repository = deps.repository || videoGenerationTaskRepository;
  const providerFetch = deps.providerFetch || fetch;
  const getConfig = deps.getConfig || (() => dbHelpers.getAIConfig().config);
  const mediaRoot = path.resolve(deps.mediaAssetsDir || 'OMNI_Workspace/Media_Assets');
  const leases = new GenerationLease(db);
  const pool = (channel: AIChannel) => channel.comfyQueue?.executionPoolId || new URL(comfyBaseUrl(channel.baseUrl)).origin;
  const locks = new Map<string, Promise<unknown>>();
  const list = () => repository.listComfyTasks?.() || [];
  const requireTask = (id: string) => {
    const task = repository.getById(id);
    if (!task || task.provider !== 'comfyui') throw new GatewayError('ComfyUI 任务不存在。', 404);
    return task;
  };
  const channelFor = (id: string): AIChannel => {
    const channel = getConfig().channels.find(c => c.id === id && c.type === 'comfyui');
    if (!channel) throw new GatewayError('ComfyUI 服务配置已不存在，请恢复配置后继续查询。', 400);
    comfyBaseUrl(channel.baseUrl);
    return channel;
  };
  const call = async (channel: AIChannel, endpoint: string, options: RequestInit = {}, timeout = 30000) => {
    const key = channel.apiKey.trim().replace(/^Bearer\s+/i, '');
    const headers = new Headers(options.headers);
    if (key) headers.set('Authorization', `Bearer ${key}`);
    let response: Response;
    try {
      response = await providerFetch(`${comfyBaseUrl(channel.baseUrl)}${endpoint}`, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(timeout) });
    } catch (error) { throw new GatewayError(scrub(error, key)); }
    if (!response.ok) {
      const detail = scrub((await response.text()).slice(0, 2000), key);
      const labels: Record<number, string> = { 400: '工作流或参数无效', 401: 'API Key 无效', 403: '缺少权限或素材不属于此账号', 404: '任务或素材不存在', 413: '工作流或素材过大', 429: '账号或全局队列已满' };
      const retry = response.headers.get('retry-after');
      const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
      throw new GatewayError(`ComfyUI ${response.status}：${labels[response.status] || '服务错误'}${detail ? `；${detail}` : ''}`, response.status, Math.max(0, Math.min(300000, delay || 0)));
    }
    return response;
  };
  const json = async (channel: AIChannel, endpoint: string, body?: unknown) => {
    const response = await call(channel, endpoint, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    try { return await response.json(); } catch { throw new GatewayError('ComfyUI 返回了无法解析的响应。'); }
  };
  const checkedChannel = (task: PersistedVideoGenerationTask) => {
    const channel = channelFor(task.channelId);
    if (task.request.baseUrl !== comfyBaseUrl(channel.baseUrl)) throw new GatewayError('服务地址已变化，请恢复提交时的地址后查询此任务。', 409);
    return channel;
  };
  const readInput = async (url: string, kind: string) => {
    let bytes: Buffer, mime: string;
    const data = /^data:((?:image|video|audio)\/[\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url);
    if (data) { mime = data[1]; bytes = Buffer.from(data[2], 'base64'); }
    else if (/^https?:\/\//i.test(url)) {
      const target = await assertPublicRemoteUrl(url);
      // Public input downloads never carry the ComfyUI credential and never
      // follow a redirect to an unchecked/local origin.
      const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok || !response.body) throw new GatewayError(`读取参考素材失败（${response.status}）。`, 400);
      mime = (response.headers.get('content-type') || '').split(';')[0].trim();
      if (!mime.startsWith(`${kind}/`)) throw new GatewayError('参考素材地址返回的媒体类型不符。', 400);
      const parts: Uint8Array[] = []; let size = 0;
      for await (const part of Readable.fromWeb(response.body as any)) {
        size += part.length;
        if (size > MAX_INPUT) throw new GatewayError('单个参考素材不能超过 50 MiB。', 413);
        parts.push(part);
      }
      bytes = Buffer.concat(parts);
    } else {
      if (!url.startsWith('/media/')) throw new GatewayError('参考素材须为系统媒体、公开媒体地址或上传文件。', 400);
      const relative = decodeURIComponent(url.slice('/media/'.length));
      const target = await fs.realpath(path.resolve(mediaRoot, relative));
      const root = await fs.realpath(mediaRoot);
      if (!target.startsWith(`${root}${path.sep}`)) throw new GatewayError('参考素材路径越界。', 400);
      if ((await fs.stat(target)).size > MAX_INPUT) throw new GatewayError('单个参考素材不能超过 50 MiB。', 413);
      bytes = await fs.readFile(target);
      const ext = path.extname(target).toLowerCase();
      const mimes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
      mime = mimes[ext] || '';
    }
    if (!mime.startsWith(`${kind}/`) || !bytes.length || bytes.length > MAX_INPUT) throw new GatewayError(`参考 ${kind} 素材类型或大小无效。`, 400);
    if (url.startsWith('/media/generation/snapshots/')) {
      const expected = path.basename(url).split('.')[0];
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) throw new GatewayError('固定素材内容已变化，请重新检查后提交。', 409);
    }
    return { bytes, mime };
  };
  const upload = async (channel: AIChannel, url: string, kind: string) => {
    const { bytes, mime } = await readInput(url, kind);
    const form = new FormData();
    const suffix: Record<string, string> = { 'image/jpeg': 'jpg', 'audio/mpeg': 'mp3', 'video/quicktime': 'mov', 'audio/mp4': 'm4a' };
    // Concurrent tasks must not upload different references under the same name.
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), `omni-${kind}-${digest}.${suffix[mime] || mime.split('/')[1]}`);
    const response = await call(channel, '/api/v1/uploads', { method: 'POST', body: form }, 120000);
    const data = await response.json() as { filename?: string };
    if (!data.filename || typeof data.filename !== 'string') throw new GatewayError('上传没有返回素材文件名。');
    return data.filename;
  };
  const archive = async (task: PersistedVideoGenerationTask, channel: AIChannel, history: any) => {
    const outputs: NonNullable<PersistedVideoGenerationTask['outputs']> = [];
    const seen = new Set<string>();
    for (const output of Object.values(history?.outputs || {}) as any[]) for (const category of ['images', 'gifs', 'videos', 'audio']) {
      for (const file of Array.isArray(output?.[category]) ? output[category] : []) {
        if (typeof file?.filename !== 'string' || (file.type !== undefined && typeof file.type !== 'string') || (file.subfolder !== undefined && typeof file.subfolder !== 'string')) continue;
        const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
        if (seen.has(params.toString())) continue;
        seen.add(params.toString());
        const kind = kindFor(file.filename);
        if (!kind) continue;
        const dir = path.join(mediaRoot, 'comfyui', task.id);
        await fs.mkdir(dir, { recursive: true });
        const filename = `${hash(params.toString()).slice(0, 24)}${path.extname(file.filename).toLowerCase()}`;
        const target = path.join(dir, filename);
        const temporary = `${target}.${crypto.randomUUID()}.part`;
        try {
          const existing = await fs.stat(target).catch(() => undefined);
          if (!existing?.size) {
            const response = await call(channel, `/view?${params}`, {}, 180000);
            if (!response.body) throw new GatewayError('ComfyUI 返回了空媒体。');
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('text/html') || contentType.includes('application/json')) throw new GatewayError('素材下载返回了页面或 JSON，请检查 asset:read 权限。');
            let size = 0;
            const limit = new Transform({ transform(chunk, _encoding, cb) { size += chunk.length; cb(size > 2 * 1024 ** 3 ? new Error('生成素材超过 2 GiB。') : null, chunk); } });
            await pipeline(Readable.fromWeb(response.body as any), limit, createWriteStream(temporary, { flags: 'wx' }));
            if (!size) throw new GatewayError('生成素材为空。');
            await fs.rename(temporary, target);
          }
        } finally { await fs.unlink(temporary).catch(() => undefined); }
        const executionEvidence = kind === 'video'
          ? compareComfyVideoPrompt(task.providerResponse!.graph, await (deps.readVideoPrompt || readComfyVideoPrompt)(target)) : undefined;
        const technicalIssues = executionEvidence?.status === 'mismatch'
          ? [`供应商输出内嵌工作流与提交图不一致（${executionEvidence.changedFields.slice(0, 10).join('、')}）；原文件保留，不能按原方案采用。`] : undefined;
        outputs.push({ url: `/media/comfyui/${task.id}/${filename}`, kind, filename: file.filename, ...(executionEvidence ? { executionEvidence } : {}), ...(technicalIssues ? { technicalIssues } : {}) });
      }
    }
    const desiredKind = comfyMediaKind((task.request.template as ComfyAPITemplate).api!.operation);
    if (!outputs.some(output => output.kind === desiredKind)) throw new GatewayError(`任务完成但没有 ${desiredKind === 'video' ? '视频' : '图片'} 输出，请检查保存节点。`, 422);
    return outputs;
  };
  const backoff = (task: PersistedVideoGenerationTask, error: unknown, patch: Partial<PersistedVideoGenerationTask> = {}) => repository.update(task.id, {
    ...patch, attempts: (task.attempts || 0) + 1, nextAttemptAt: Date.now() + Math.max(retryDelay(task.attempts || 0), error instanceof GatewayError ? error.retryAfterMs : 0),
    error: scrub(error, getConfig().channels.find(c => c.id === task.channelId)?.apiKey),
  });
  const processTask = (initial: PersistedVideoGenerationTask): Promise<unknown> => {
    const existing = locks.get(initial.id);
    if (existing) return existing;
    const release = leases.acquire(`comfy:${initial.id}`); if (!release) return Promise.resolve();
    let releasePreparation: (() => void) | undefined;
    const operation = (async () => {
      let task = requireTask(initial.id);
      const channel = checkedChannel(task);
      if (task.nextAttemptAt && task.nextAttemptAt > Date.now()) return;
      if (!task.providerTaskId) {
        if (task.status !== 'queued') return;
        deps.authorizeTask?.(task);
        // Stage references one task at a time per shared service. Release as
        // soon as the graph is ready: GPU execution still uses the full pool.
        if (!task.providerResponse?.graph && (['images', 'videos', 'audio'] as const).some(field => (task.request.input as ComfyGenerationInput)[field]?.length)) {
          releasePreparation = leases.acquire(`comfy:prepare:${hash(pool(channel))}`);
          if (!releasePreparation) return;
        }
        const reserved = db.transaction(() => {
          const limit = Math.min(...getConfig().channels.filter(c => c.type === 'comfyui' && pool(c) === pool(channel)).map(c => c.comfyQueue?.maxInFlight || 2));
          const inFlight = list().filter(t => t.id !== task.id && occupiesCapacity(t)).filter(t => { try { return pool(channelFor(t.channelId)) === pool(channel); } catch { return true; } }).length;
          if (inFlight >= limit) return undefined;
          return repository.update(task.id, { status: 'submitting', error: undefined, providerResponse: { ...task.providerResponse, stage: task.providerResponse?.graph ? 'prepared' : 'uploading' } });
        })();
        if (!reserved) return; task = reserved;
        try {
          if (!task.providerResponse?.graph) {
            const input = structuredClone(task.request.input) as ComfyGenerationInput;
            for (const [field, kind] of [['images', 'image'], ['videos', 'video'], ['audio', 'audio']] as const) {
              const uploaded: string[] = [];
              for (const [index, url] of (input[field] || []).entries()) {
                if (requireTask(task.id).status === 'cancelled') return;
                deps.authorizeTask?.(task);
                const previous = task.providerResponse?.uploadedInputs as UploadedInputs | undefined;
                const saved = previous?.[field]?.[index];
                const sourceHash = hash(url);
                const filename = saved?.sourceHash === sourceHash && typeof saved.filename === 'string'
                  ? saved.filename : await upload(channel, url, kind);
                if (requireTask(task.id).status === 'cancelled') return;
                const uploadedInputs: UploadedInputs = { ...previous,
                  [field]: { ...previous?.[field], [index]: { sourceHash, filename } } };
                task = repository.update(task.id, { providerResponse: { ...task.providerResponse, uploadedInputs } });
                uploaded.push(filename);
              }
              input[field] = uploaded;
            }
            if (requireTask(task.id).status === 'cancelled') return;
            const graph = compileComfyGraph(task.request.template as ComfyAPITemplate, input);
            task = repository.update(task.id, { providerResponse: { ...task.providerResponse, graph, stage: 'prepared' } });
          }
          releasePreparation?.(); releasePreparation = undefined;
          if (requireTask(task.id).status === 'cancelled') return;
          deps.authorizeTask?.(task);
          task = repository.update(task.id, { providerResponse: { ...task.providerResponse, stage: 'posting' } });
        } catch (error) {
          if (requireTask(task.id).status === 'cancelled') return;
          if ((error as any)?.name === 'GenerationError') return backoff(task, error, { status: 'queued' });
          if (error instanceof GatewayError && error.status === 429) return backoff(task, error, { status: 'queued' });
          // Uploads are not paid executions. A transient failure here is safe to
          // retry, whereas a timeout after /prompt must remain uncertain below.
          if (task.providerResponse?.stage === 'uploading' && !task.providerResponse.graph
            && error instanceof GatewayError && (error.status === 408 || error.status >= 500)
            && (task.attempts || 0) < 2) return backoff(task, error, { status: 'queued' });
          return repository.update(task.id, { status: 'failed', error: scrub(error, channel.apiKey) });
        }
        try {
          const data = await json(channel, '/prompt', { prompt: task.providerResponse!.graph });
          if (typeof data.prompt_id !== 'string' || !data.prompt_id) throw new GatewayError('提交响应缺少 prompt_id；请核对近期任务后恢复。');
          return repository.update(task.id, { status: 'queued', providerTaskId: data.prompt_id, nextAttemptAt: Date.now() + (channel.comfyQueue?.pollIntervalMs || 3000), error: undefined });
        } catch (error) {
          if (error instanceof GatewayError && error.status === 429) return backoff(task, error, { status: 'queued' });
          const certainFailure = error instanceof GatewayError && [400, 401, 403, 404, 413, 422].includes(error.status);
          return repository.update(task.id, { status: certainFailure ? 'failed' : 'unknown', error: `${scrub(error, channel.apiKey)}${certainFailure ? '' : '；提交结果不确定，已停止自动重发，请核对近期任务。'}` });
        }
      }
      if (!ACTIVE.includes(task.status)) return;
      try {
        const job = await json(channel, `/api/jobs/${encodeURIComponent(task.providerTaskId)}`);
        if (job.status === 'failed') {
          return repository.update(task.id, { status: 'failed', error: scrub(comfyFailureDescription(job), channel.apiKey) });
        }
        if (job.status === 'cancelled') return repository.update(task.id, { status: 'cancelled', error: undefined });
        if (job.status === 'completed') {
          const history = await json(channel, `/history/${encodeURIComponent(task.providerTaskId)}`);
          const entry = history[task.providerTaskId];
          if (!entry) throw new GatewayError('任务已完成，历史尚未就绪，将继续查询。');
          const outputs = await archive(task, channel, entry);
          return repository.update(task.id, { status: 'succeeded', outputs, videoUrl: outputs.find(o => o.kind === 'video')?.url, error: undefined, attempts: 0, nextAttemptAt: undefined });
        }
        if (!['pending', 'in_progress'].includes(job.status)) throw new GatewayError('ComfyUI 返回了未知任务状态，将保留任务并继续查询。');
        return repository.update(task.id, { status: job.status === 'pending' ? 'queued' : 'running', error: undefined, attempts: 0, nextAttemptAt: Date.now() + (channel.comfyQueue?.pollIntervalMs || 3000) });
      } catch (error) {
        if (error instanceof GatewayError && error.status === 422) return repository.update(task.id, { status: 'failed', error: scrub(error, channel.apiKey) });
        return backoff(task, error);
      }
    })().finally(() => { releasePreparation?.(); release(); locks.delete(initial.id); });
    locks.set(initial.id, operation);
    return operation;
  };
  const recoverAbandonedSubmissions = () => {
    // A restarted process may initially see a still-live lease from its old
    // owner. Recheck on ticks so expiry does not strand the task forever.
    for (const task of list()) if (task.status === 'submitting' && !task.providerTaskId && !leases.active(`comfy:${task.id}`)) {
      const beforePost = ['uploading', 'prepared'].includes(String(task.providerResponse?.stage));
      repository.update(task.id, { status: beforePost ? 'queued' : 'unknown', error: beforePost ? undefined : '上次服务在提交期间中断，请核对近期任务后恢复。' });
    }
  };
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      recoverAbandonedSubmissions();
      const tasks = list().filter(t => ACTIVE.includes(t.status));
      const running = tasks.filter(occupiesCapacity);
      const origin = (task: PersistedVideoGenerationTask) => pool(channelFor(task.channelId));
      for (const task of tasks.filter(t => t.providerTaskId)) void processTask(task).catch(() => undefined);
      for (const task of tasks.filter(t => t.status === 'queued' && !t.providerTaskId).sort((a, b) => a.createdAt - b.createdAt)) {
        let channel: AIChannel;
        try { channel = channelFor(task.channelId); } catch { continue; }
        // Image and video models on the same service share the local budget.
        // The gateway still controls capacity shared with other accounts.
        const caps = getConfig().channels.filter(c => {
          try { return c.type === 'comfyui' && pool(c) === origin(task); } catch { return false; }
        }).map(c => c.comfyQueue?.maxInFlight || 2);
        const cap = Math.min(...caps, channel.comfyQueue?.maxInFlight || 2);
        if (running.filter(t => origin(t) === origin(task)).length >= cap) continue;
        if (task.nextAttemptAt && task.nextAttemptAt > Date.now()) continue;
        running.push(task);
        void processTask(task).catch(error => { backoff(task, error); });
      }
    } finally { ticking = false; }
  };
  let timer: ReturnType<typeof setInterval> | undefined;
  if (deps.background !== false) {
    // A process crash during POST is uncertain; restarting never resubmits it.
    recoverAbandonedSubmissions();
    timer = setInterval(() => { void tick().catch(() => undefined); }, 1000);
    timer.unref();
  }
  const fail = (res: any, error: unknown) => res.status(error instanceof GatewayError ? error.status : 400).json({ error: scrub(error) });
  app.post('/api/proxy/comfyui-api/check', async (req, res) => {
    try { await json(channelFor(req.body.channelId), '/api/jobs?limit=1&offset=0'); res.json({ ready: true, message: '连接和任务读取权限正常；生成、上传及下载权限将在实际任务中验证。' }); } catch (error) { fail(res, error); }
  });
  app.get('/api/proxy/comfyui-api/tasks', (_req, res) => res.json({ tasks: list().slice(0, 100).map(t => publicVideoGenerationTask(t)) }));
  app.post('/api/proxy/comfyui-api/tasks', async (req, res) => {
    try {
      const { channelId, modelConfigId, input, idempotencyKey } = req.body || {};
      if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 500) throw new Error('缺少合法的重复提交识别码。');
      const fingerprint = hash({ channelId, modelConfigId, input });
      const prior = repository.findByIdempotencyKey(idempotencyKey);
      if (prior) {
        if (prior.provider !== 'comfyui' || prior.requestHash !== fingerprint) throw new GatewayError('相同提交识别码已对应其他内容。', 409);
        return res.json({ task: publicVideoGenerationTask(prior, true) });
      }
      const config = getConfig(), channel = channelFor(channelId);
      if (channel.enabled === false) throw new Error('此 ComfyUI 服务已停用。');
      const model = config.models.find(m => m.id === modelConfigId && m.channelId === channelId);
      const workflow = config.comfyWorkflows.find(w => w.id === model?.comfyWorkflowId && w.channelId === channelId && w.kind === 'api_graph');
      if (!model || !workflow || workflow.enabled === false) throw new Error('没有找到此模型启用的 API 工作流。');
      validateComfyInput(workflow, input);
      if (!model.capabilities.includes(comfyMediaKind(workflow.api!.operation))) throw new Error('模型与工作流的生成类型不匹配。');
      const task = repository.create({ provider: 'comfyui', channelId, modelConfigId, projectId: typeof req.body.projectId === 'string' ? req.body.projectId : undefined,
        idempotencyKey, requestHash: fingerprint, embeddedAudio: workflow.api!.nativeAudio, status: 'queued',
        request: { input, template: structuredClone(workflow), baseUrl: comfyBaseUrl(channel.baseUrl) }, audit: { workflowId: workflow.id, workflowName: workflow.name } });
      res.status(202).json({ task: publicVideoGenerationTask(task) });
      void tick().catch(() => undefined);
    } catch (error) { fail(res, error); }
  });
  app.get('/api/proxy/comfyui-api/tasks/:id', async (req, res) => {
    try { const task = requireTask(req.params.id); if (task.providerTaskId) await processTask(task); else await tick(); res.json({ task: publicVideoGenerationTask(requireTask(task.id)) }); } catch (error) { fail(res, error); }
  });
  app.post('/api/proxy/comfyui-api/tasks/:id/cancel', async (req, res) => {
    try {
      const task = requireTask(req.params.id);
      if (!ACTIVE.includes(task.status)) return res.json({ task: publicVideoGenerationTask(task) });
      if (!task.providerTaskId) {
        const uploading = task.status === 'submitting' && task.providerResponse?.stage === 'uploading';
        if (!uploading && (task.status !== 'queued' || locks.has(task.id))) throw new GatewayError('提交结果尚不确定，请核对上游任务后再取消。', 409);
        return res.json({ task: publicVideoGenerationTask(repository.update(task.id, { status: 'cancelled', error: undefined })) });
      }
      const result = await json(checkedChannel(task), `/api/jobs/${encodeURIComponent(task.providerTaskId)}/cancel`, {});
      if (ACTIVE.includes(requireTask(task.id).status)) repository.update(task.id, { nextAttemptAt: 0, error: result.cancelled ? '取消请求已发送，正在确认最终状态。' : '上游暂未取消，请继续查询最终状态。' });
      res.json({ task: publicVideoGenerationTask(requireTask(task.id)) });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/proxy/comfyui-api/tasks/:id/resume', async (req, res) => {
    try {
      let task = requireTask(req.params.id);
      if (!task.providerTaskId) {
        if (task.status !== 'unknown') throw new Error('只有提交结果不确定的任务才需要关联上游编号。');
        const id = req.body?.providerTaskId;
        if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('请填写此任务的 prompt_id。');
        const job = await json(checkedChannel(task), `/api/jobs/${encodeURIComponent(id)}`);
        if (!task.providerResponse?.graph || hash(job.workflow?.prompt) !== hash(task.providerResponse.graph)) throw new Error('上游任务工作流与本次提交不一致，不能关联。');
        if (list().some(other => other.id !== task.id && other.channelId === task.channelId && other.providerTaskId === id)) throw new Error('此上游任务已关联其他本地任务。');
        task = repository.update(task.id, { providerTaskId: id, status: 'queued' });
      }
      if (ACTIVE.includes(task.status)) {
        task = repository.update(task.id, { nextAttemptAt: 0, attempts: 0, error: undefined });
        await processTask(task);
      }
      res.json({ task: publicVideoGenerationTask(requireTask(task.id)) });
    } catch (error) { fail(res, error); }
  });
  app.get('/api/proxy/comfyui-api/tasks/:id/recent', async (req, res) => {
    try {
      const task = requireTask(req.params.id);
      const data = await json(checkedChannel(task), '/api/jobs?limit=20&offset=0');
      // Never return another job's graph or prompts to the browser.
      const rows = Array.isArray(data) ? data : data.jobs || data.items || [];
      res.json({ jobs: rows.map((j: any) => ({ id: j.prompt_id || j.id, status: j.status, createdAt: j.created_at })) });
    } catch (error) { fail(res, error); }
  });
  const enqueueFrozen = (body: { channelId: string; modelConfigId: string; projectId: string; idempotencyKey: string; template: ComfyAPITemplate; input: ComfyGenerationInput; executionId: string; planHash: string }) => {
    const prior = repository.findByIdempotencyKey(body.idempotencyKey);
    const fingerprint = hash({ planHash: body.planHash, input: body.input, template: body.template });
    if (prior) { if (prior.requestHash !== fingerprint) throw new GatewayError('相同提交识别码已对应其他方案。', 409); return prior; }
    const channel = channelFor(body.channelId);
    if (channel.enabled === false) throw new GatewayError('生成服务已停用。', 400);
    validateComfyInput(body.template, body.input);
    const task = repository.create({ provider: 'comfyui', channelId: body.channelId, modelConfigId: body.modelConfigId, projectId: body.projectId, idempotencyKey: body.idempotencyKey, requestHash: fingerprint, embeddedAudio: body.template.api!.nativeAudio, status: 'queued', request: { input: body.input, template: structuredClone(body.template), baseUrl: comfyBaseUrl(channel.baseUrl) }, audit: { generationExecutionId: body.executionId, generationPlanHash: body.planHash } });
    void tick().catch(() => undefined); return task;
  };
  const reconcileFrozen = async (recordId: string, providerTaskId: string) => {
    let task = requireTask(recordId);
    if (task.providerTaskId) return task;
    if (task.status !== 'unknown' || !providerTaskId.trim() || providerTaskId.length > 200) throw new GatewayError('请核对提交结果未知任务的上游编号。', 409);
    const job = await json(checkedChannel(task), `/api/jobs/${encodeURIComponent(providerTaskId)}`);
    if (!task.providerResponse?.graph || hash(job.workflow?.prompt) !== hash(task.providerResponse.graph)) throw new GatewayError('上游工作流与固定提交不一致，不能关联。', 409);
    if (list().some(other => other.id !== task.id && other.providerTaskId === providerTaskId && pool(channelFor(other.channelId)) === pool(channelFor(task.channelId)))) throw new GatewayError('此上游任务已关联其他执行。', 409);
    task = repository.update(task.id, { providerTaskId, status: 'queued', nextAttemptAt: 0, error: undefined });
    await processTask(task); return requireTask(task.id);
  };
  const cancelFrozen = async (id: string) => {
    const task = requireTask(id);
    if (!ACTIVE.includes(task.status)) return task;
    if (!task.providerTaskId) {
      if (task.providerResponse?.stage === 'posting' || task.status === 'unknown') throw new GatewayError('提交结果尚不确定，请先核对任务。', 409);
      return repository.update(id, { status: 'cancelled' });
    }
    await json(checkedChannel(task), `/api/jobs/${encodeURIComponent(task.providerTaskId)}/cancel`, {});
    return task;
  };
  const releaseReservation = (id: string, evidence: string, actor: DispatchReservationRelease['actor']) => {
    if (typeof evidence !== 'string' || !evidence.trim() || evidence.length > 4000) throw new GatewayError('请记录实际核对的远端队列、历史范围和结论。', 400);
    return db.transaction(() => {
      const task = requireTask(id);
      if (task.status !== 'unknown' || task.providerTaskId || locks.has(id) || leases.active(`comfy:${id}`)) throw new GatewayError('仅能释放已结束提交、无上游编号的未知任务占位。', 409);
      if (task.dispatchReservationRelease) return task;
      return repository.update(id, { dispatchReservationRelease: { releasedAt: Date.now(), evidence: evidence.trim(), actor } });
    })();
  };
  return { tick, processTask, enqueueFrozen, cancelFrozen, reconcileFrozen, releaseReservation, findByIdempotencyKey: (key: string) => repository.findByIdempotencyKey(key), getTask: (id: string) => repository.getById(id), stop: () => { if (timer) clearInterval(timer); } };
}
