import { normalizeCredentialedProviderTarget } from '../routes/providerTargetPolicy';
import { resolveOpenAICompatibleApiKey, normalizeOpenAICompatibleBaseUrl } from '../routes/providerProxyUtils';
import { GoogleGenAI, GenerateVideosOperation } from '@google/genai';
import { openAIImageSizeForAspectRatio, doubaoImageSizeForAspectRatio } from '../../services/production/imageGenerationRequest';
import type { AIConfigSnapshot } from '../../config/aiConfigDefaults';
import { KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID, KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID, KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID, KIE_GROK_TEXT_TO_IMAGE_MODEL_ID, isKieGptImage2ModelId } from '../../config/aiConfigDefaults';
import type { GenerationExecution, GenerationPlanRevision, GenerationMediaKind } from '../../../packages/domain/src/generation';
import { GenerationError } from '../../../packages/domain/src/generation';
import { buildKieGrokImageCreateTaskRequest, validateKieGrokImageRequest } from '../providers/kieGrokImage';
import { buildKieCreateTaskRequest, validateKieGrokVideoRequest, buildKieTaskStatusEndpoint, kieResultVideoUrl, kieTaskState, kieTaskId, normalizeKieCreateTaskEndpoint, KIE_BASE64_UPLOAD_ENDPOINT } from '../providers/kieGrokVideo';
import type { registerComfyUIGatewayRoutes } from '../providers/comfyUIGateway';
import type { GenerationRecipe } from './catalog';
import type { GenerationMediaStore } from './media';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ComfyGenerationPort = ReturnType<typeof registerComfyUIGatewayRoutes>;
export class SubmissionUncertain extends Error { constructor(message: string) { super(message); this.name = 'SubmissionUncertain'; } }
export class GenerationProviders {
  comfy?: ComfyGenerationPort;
  constructor(readonly getConfig: () => AIConfigSnapshot, readonly media: GenerationMediaStore, readonly request: typeof fetch = fetch) {}
  private config(plan: GenerationPlanRevision) {
    const config = this.getConfig(), channel = config.channels.find(c => c.id === plan.capability.connectionId && c.enabled !== false), model = config.models.find(m => m.id === plan.capability.modelConfigId);
    if (!channel || !model || model.channelId !== channel.id) throw new GenerationError('PROVIDER_UNAVAILABLE', '原生成连接或模型已停用，请核对方案。');
    const provided = (model.apiKeyOverride || channel.apiKey || '').trim().replace(/^Bearer\s+/i, '');
    const key = channel.type === 'gemini' ? provided || process.env.GEMINI_API_KEY?.trim() || '' : resolveOpenAICompatibleApiKey(channel.type as 'openai' | 'doubao' | 'kie', provided, channel.id);
    if (!key) throw new GenerationError('CREDENTIAL_REQUIRED', '请先在服务设置或服务端环境变量中配置凭证。');
    return { channel, model, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } };
  }
  async submit(plan: GenerationPlanRevision, recipe: GenerationRecipe, execution: GenerationExecution, beforePost: (posting?: boolean) => void) {
    if (plan.capability.provider === 'local') {
      beforePost();
      const reference = plan.references[0]; await this.media.asDataURL(reference.mediaUrl, reference.mediaKind);
      const file = await this.media.localPath(reference.mediaUrl), directory = path.join(this.media.root, 'generation', 'processing');
      await fs.mkdir(directory, { recursive: true }); const output = path.join(directory, `${randomUUID()}.png`);
      const params = plan.parameters;
      const args = plan.operation === 'extract_frame' ? (params.framePosition === 'time' ? ['-i', file, '-ss', String(params.frameTimeSeconds), '-frames:v', '1'] : ['-sseof', '-1', '-i', file, '-update', '1']) : ['-i', file, '-vf', `crop=${params.cropWidth}:${params.cropHeight}:${params.cropX}:${params.cropY}`, '-frames:v', '1'];
      await promisify(execFile)('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', ...args, output], { timeout: 120000, maxBuffer: 131072 });
      const frozen = await this.media.freeze(`/media/generation/processing/${path.basename(output)}`, 'image');
      await fs.unlink(output).catch(() => {});
      return { providerRecordId: frozen.mediaUrl };
    }
    if (plan.capability.provider === 'comfyui') {
      if (!this.comfy || !recipe.template) throw new GenerationError('PROVIDER_UNAVAILABLE', '生成执行器尚未连接。');
      beforePost();
      const p = plan.parameters;
      const task = this.comfy.enqueueFrozen({ channelId: plan.capability.connectionId, modelConfigId: plan.capability.modelConfigId, projectId: execution.projectId, idempotencyKey: execution.idempotencyKey, template: recipe.template, executionId: execution.id, planHash: plan.planHash,
        input: { prompt: plan.prompt, aspectRatio: String(p.aspectRatio), width: p.width ? Number(p.width) : undefined, height: p.height ? Number(p.height) : undefined, duration: plan.requestedSeconds, seed: p.seed !== undefined ? Number(p.seed) : undefined, images: plan.references.filter(r => r.mediaKind === 'image').map(r => r.mediaUrl), videos: plan.references.filter(r => r.mediaKind === 'video').map(r => r.mediaUrl), audio: plan.references.filter(r => r.mediaKind === 'audio').map(r => r.mediaUrl), parameters: Object.fromEntries((recipe.template.parameters || []).map(def => [def.key, p[def.key]])) } });
      return { providerRecordId: task.id, providerTaskId: task.providerTaskId };
    }
    const { channel, model, headers } = this.config(plan);
    if (plan.capability.provider === 'gemini' && plan.capability.mediaKind === 'video') {
      const client = new GoogleGenAI({ apiKey: headers.Authorization.slice(7) });
      const inline = async (role: string) => { const ref = plan.references.find(r => r.role === role); if (!ref) return undefined; const data = await this.media.asDataURL(ref.mediaUrl, 'image'); return { imageBytes: data.slice(data.indexOf(',') + 1), mimeType: data.slice(5, data.indexOf(';')) }; };
      const image = await inline('first_frame'), lastFrame = await inline('last_frame');
      beforePost(true);
      try {
        const operation = await client.models.generateVideos({ model: model.modelId, prompt: plan.prompt, image, config: { numberOfVideos: 1, resolution: '720p', aspectRatio: String(plan.parameters.aspectRatio), durationSeconds: plan.requestedSeconds, ...(lastFrame ? { lastFrame } : {}) } });
        if (!operation.name) throw new SubmissionUncertain('Veo 未返回任务编号，请先核对原请求。');
        return { providerTaskId: operation.name };
      } catch (e) { if (e instanceof SubmissionUncertain) throw e; throw new SubmissionUncertain('Veo 提交结果待核对，不自动重复生成。'); }
    }
    if (['openai', 'gemini', 'doubao'].includes(plan.capability.provider)) {
      const ratio = String(plan.parameters.aspectRatio) as '16:9' | '9:16' | '1:1';
      const images = await Promise.all(plan.references.filter(r => r.mediaKind === 'image').map(r => this.media.asDataURL(r.mediaUrl, 'image')));
      beforePost(true);
      let output: string | undefined;
      try {
        if (channel.type === 'gemini') {
          const client = new GoogleGenAI({ apiKey: headers.Authorization.slice(7),  });
          const response = await client.models.generateImages({ model: model.modelId === 'gemini-2.5-flash-image' ? 'imagen-3.0-generate-002' : model.modelId, prompt: plan.prompt, config: { numberOfImages: 1, outputMimeType: 'image/jpeg', aspectRatio: ratio } });
          const bytes = response.generatedImages?.[0]?.image?.imageBytes;
          if (bytes) output = `data:image/jpeg;base64,${bytes}`;
        } else {
          const base = normalizeOpenAICompatibleBaseUrl(channel.type as 'openai' | 'doubao', channel.baseUrl, channel.id);
          const body = channel.type === 'openai' ? { model: model.modelId, prompt: plan.prompt, n: 1, size: openAIImageSizeForAspectRatio(ratio), response_format: 'b64_json' } : { model: model.modelId, prompt: plan.prompt, size: doubaoImageSizeForAspectRatio(ratio), response_format: 'url', watermark: false, ...(images.length ? { image: images, sequential_image_generation: 'disabled' } : {}) };
          const response = await this.request(`${base}/images/generations`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(300000) });
          if (!response.ok) {
            if ([400, 401, 403, 404, 413, 422, 429].includes(response.status)) throw new GenerationError('PROVIDER_REJECTED', `供应商未接受请求（${response.status}）。`);
            throw new SubmissionUncertain(`供应商响应异常（${response.status}），请先核对执行记录。`);
          }
          const data = await response.json() as any;
          output = data.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : data.data?.[0]?.url;
        }
        if (!output) throw new SubmissionUncertain('供应商没有返回可保存的图片，请核对原任务，不会自动重发。');
        const frozen = await this.media.freeze(output, 'image');
        return { providerRecordId: frozen.mediaUrl };
      } catch (error) {
        if (error instanceof GenerationError || error instanceof SubmissionUncertain) throw error;
        throw new SubmissionUncertain('图片提交后连接中断，可能已生成；保留本次执行，不自动重发。');
      }
    }
    const endpoint = normalizeKieCreateTaskEndpoint(channel.baseUrl);
    const images: string[] = [];
    for (const ref of plan.references.filter(r => r.mediaKind === 'image')) {
      beforePost();
      const dataURL = await this.media.asDataURL(ref.mediaUrl, 'image');
      const response = await this.request(KIE_BASE64_UPLOAD_ENDPOINT, { method: 'POST', headers, body: JSON.stringify({ base64Data: dataURL, uploadPath: 'images/omni-generation', fileName: `${ref.contentHash}.png` }), redirect: 'error', signal: AbortSignal.timeout(120000) });
      const data = await response.json() as any, url = data.data?.downloadUrl || data.data?.fileUrl;
      if (!response.ok || typeof url !== 'string' || !url.startsWith('https://')) throw new GenerationError('UPLOAD_FAILED', '参考素材上传失败，尚未提交生成。');
      images.push(url);
    }
    const p = plan.parameters;
    let body: unknown;
    if (plan.capability.mediaKind === 'video') body = buildKieCreateTaskRequest(validateKieGrokVideoRequest({ model: model.modelId, prompt: plan.prompt, duration: plan.requestedSeconds, resolution: p.resolution, aspectRatio: p.aspectRatio, imageUrl: images[0] }), images[0]);
    else {
      const gpt = isKieGptImage2ModelId(model.modelId), referenced = images.length > 0;
      body = buildKieGrokImageCreateTaskRequest(validateKieGrokImageRequest({ model: gpt ? referenced ? KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID : KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID : referenced ? KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID : KIE_GROK_TEXT_TO_IMAGE_MODEL_ID, prompt: plan.prompt, aspectRatio: p.aspectRatio, resolution: p.resolution, imageUrl: !gpt && referenced ? images[0] : undefined, imageUrls: gpt && referenced ? images : undefined }), images[0], images);
    }
    beforePost(true);
    let response: Response;
    try { response = await this.request(endpoint, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(120000) }); }
    catch { throw new SubmissionUncertain('供应商提交响应中断，任务可能已收到；请核对上游任务，系统不会自动重发。'); }
    const data = await response.json().catch(() => undefined), id = kieTaskId(data);
    if (!response.ok || !id) {
      if ([400, 401, 403, 404, 413, 422, 429].includes(response.status)) throw new GenerationError('PROVIDER_REJECTED', `供应商未接受请求（${response.status}）。`);
      throw new SubmissionUncertain('供应商没有返回可核对的任务编号；已停止自动重发。');
    }
    return { providerTaskId: id };
  }
  async poll(plan: GenerationPlanRevision, execution: GenerationExecution): Promise<{ status: GenerationExecution['status']; outputs?: Array<{ url: string; kind: GenerationMediaKind; technicalIssues?: string[] }>; error?: string; providerTaskId?: string }> {
    if (plan.capability.provider === 'gemini' && plan.capability.mediaKind === 'video') {
      const { headers } = this.config(plan), key = headers.Authorization.slice(7);
      const operation = await new GoogleGenAI({ apiKey: key }).operations.getVideosOperation({ operation: Object.assign(new GenerateVideosOperation(), { name: execution.providerTaskId }) });
      if (!operation.done) return { status: 'running' };
      if (operation.error) return { status: 'failed', error: 'Veo 任务失败，请核对供应商记录。' };
      const url = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!url) return { status: 'failed', error: 'Veo 完成但没有返回视频。' };
      const endpoint = normalizeCredentialedProviderTarget('gemini', url);
      const response = await this.request(endpoint, { headers: { 'x-goog-api-key': key }, redirect: 'error', signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new GenerationError('DOWNLOAD_FAILED', '原视频已生成，下载暂时失败，请恢复查询。');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 200 * 1024 * 1024) throw new GenerationError('OUTPUT_TOO_LARGE', '视频超过本机接收上限。');
      const frozen = await this.media.freeze(`data:video/mp4;base64,${bytes.toString('base64')}`, 'video');
      return { status: 'succeeded', outputs: [{ url: frozen.mediaUrl, kind: 'video' }] };
    }
    if (['local', 'openai', 'gemini', 'doubao'].includes(plan.capability.provider)) return { status: 'succeeded', outputs: [{ url: execution.providerRecordId!, kind: 'image' }] };
    if (plan.capability.provider === 'comfyui') {
      const task = execution.providerRecordId && this.comfy?.getTask(execution.providerRecordId);
      if (!task) throw new GenerationError('PROVIDER_TASK_MISSING', '找不到原执行记录，请核对服务任务。');
      if (task.providerTaskId) await this.comfy!.processTask(task);
      const current = this.comfy!.getTask(task.id)!;
      return { status: current.status === 'unknown' ? 'reconciling' : current.status, outputs: current.outputs?.map(o => ({ url: o.url, kind: o.kind, ...(o.technicalIssues?.length ? { technicalIssues: o.technicalIssues } : {}) })), error: current.error, providerTaskId: current.providerTaskId };
    }
    if (!execution.providerTaskId) return { status: 'reconciling', error: '没有上游任务编号，请核对后关联，不能自动重发。' };
    const { channel, headers } = this.config(plan);
    const response = await this.request(buildKieTaskStatusEndpoint(normalizeKieCreateTaskEndpoint(channel.baseUrl), execution.providerTaskId), { headers, redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new GenerationError('QUERY_FAILED', `查询暂时失败（${response.status}），原任务保留。`);
    const data = await response.json(), status = kieTaskState(data);
    if (status === 'success') { const url = kieResultVideoUrl(data); if (!url) throw new GenerationError('OUTPUT_MISSING', '任务完成但没有媒体地址。'); return { status: 'succeeded', outputs: [{ url, kind: plan.capability.mediaKind }] }; }
    if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(status)) return { status: status.startsWith('cancel') ? 'cancelled' : 'failed', error: '供应商任务未成功，原计划与输入保留。' };
    return { status: 'running' };
  }
  async cancel(plan: GenerationPlanRevision, execution: GenerationExecution) {
    if (plan.capability.provider === 'comfyui' && execution.providerRecordId) return this.comfy?.cancelFrozen(execution.providerRecordId);
    throw new GenerationError('CANCEL_UNSUPPORTED', '此供应商未接通取消能力；原任务继续查询，不会新增生成。', 409);
  }
}
