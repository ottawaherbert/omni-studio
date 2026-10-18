import crypto from "crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Express, Request } from "express";

import {
  COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_H3_RESOLUTIONS,
  type ComfyMiniMaxH3ReferenceSettings,
} from "../../config/aiConfigDefaults";
import type { MiniMaxH3ContentItem, MiniMaxH3VideoRequest } from "../../services/production/minimaxH3Adapter";
import { dbHelpers } from "../db";
import {
  publicVideoGenerationTask,
  videoGenerationTaskRepository,
  type PersistedVideoGenerationTask,
  type VideoGenerationTaskRepository,
} from "../videoGenerationTaskRepository";
import { parseProviderText, providerFailurePayload, providerFailureSummary, proxyErrorSummary } from "../routes/providerProxyUtils";

const COMFYUI_H3_PROVIDER = "comfyui_h3" as const;
const COMFYUI_H3_SOURCE_WORKFLOW = "video_minimax_h3_r2v.json";
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv"]);

type ComfyUIFileDescriptor = {
  filename: string;
  subfolder?: string;
  type?: string;
};

export interface ComfyUIH3Configuration {
  baseUrl: string;
  workflowId: string;
  sourceWorkflowName: string;
  settings: ComfyMiniMaxH3ReferenceSettings;
}

export const normalizeComfyUIBaseUrl = (rawValue: string) => {
  const url = new URL(String(rawValue || "").trim());
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("ComfyUI 地址必须使用 HTTP 或 HTTPS。");
  if (url.username || url.password) throw new Error("ComfyUI 地址不能包含用户名或密码。");
  if (url.search || url.hash) throw new Error("ComfyUI 地址不能包含查询参数或页面片段。");
  url.pathname = "/";
  return url.toString().replace(/\/$/, "");
};

const normalizedWorkflowName = (value?: string) => {
  const name = String(value || COMFYUI_H3_SOURCE_WORKFLOW).trim();
  return name.endsWith(".json") ? name : `${name}.json`;
};

export const resolveComfyUIH3Configuration = (channelId?: string, modelConfigId?: string): ComfyUIH3Configuration => {
  if (!channelId || !modelConfigId) throw new Error("本地 ComfyUI 渠道和视频模型不能为空。");
  const { config } = dbHelpers.getAIConfig();
  const channel = config.channels.find((item) => item.id === channelId && item.type === "comfyui");
  if (!channel) throw new Error("没有找到本地 ComfyUI 渠道。");
  const model = config.models.find((item) => item.id === modelConfigId && item.channelId === channel.id && item.capabilities.includes("video"));
  if (!model) throw new Error("没有找到本地 ComfyUI 视频模型。");
  const workflow = config.comfyWorkflows.find((item) => (
    item.id === model.comfyWorkflowId
    && item.kind === COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND
    && (!item.channelId || item.channelId === channel.id)
  ));
  if (!workflow) throw new Error("本地 MiniMax H3 尚未绑定参考生视频工作流。");
  return {
    baseUrl: normalizeComfyUIBaseUrl(channel.baseUrl),
    workflowId: workflow.id,
    sourceWorkflowName: normalizedWorkflowName(workflow.sourceWorkflowName),
    settings: {
      ...COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
      ...(workflow.minimaxH3Reference || {}),
    },
  };
};

const contentUrl = (item: MiniMaxH3ContentItem) => {
  if (item.type === "image_url") return item.image_url.url;
  if (item.type === "video_url") return item.video_url.url;
  if (item.type === "audio_url") return item.audio_url.url;
  return "";
};

export const validateComfyUIH3VideoRequest = (input: unknown): MiniMaxH3VideoRequest => {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const model = String(source.model || "").trim();
  const resolution = String(source.resolution || "").trim();
  const duration = Number(source.duration);
  const ratio = String(source.ratio || "adaptive").trim();
  const content = Array.isArray(source.content) ? source.content as MiniMaxH3ContentItem[] : [];
  if (model !== MINIMAX_H3_MODEL_ID) throw new Error(`本地 H3 工作流只接受 ${MINIMAX_H3_MODEL_ID}。`);
  if (!MINIMAX_H3_RESOLUTIONS.includes(resolution as "768P" | "2K")) throw new Error("本地 H3 清晰度只支持 768P 或 2K。");
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) throw new Error("本地 H3 时长必须是 5-15 秒整数；当前参考生视频节点的最短长度约为 5 秒。");
  if (!["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(ratio)) throw new Error("本地 H3 画幅不受支持。");
  const prompts = content.filter((item) => item?.type === "text" && item.text.trim());
  const images = content.filter((item) => item?.type === "image_url");
  const unsupported = content.filter((item) => item?.type !== "text" && item?.type !== "image_url");
  if (prompts.length !== 1 || prompts[0].type !== "text" || prompts[0].text.length > 7000) throw new Error("本地 H3 必须包含一份不超过 7000 字符的模型提示词。");
  if (unsupported.length > 0) throw new Error("本地 H3 当前只接收图片参考，暂不发送参考视频或人物声音。");
  if (images.length < 1 || images.length > 9) throw new Error("本地 H3 每次需要 1-9 张参考图片。");
  for (const item of images) {
    if (item.type !== "image_url" || item.role !== "reference_image" || !contentUrl(item).trim()) {
      throw new Error("本地 H3 参考图片缺少合法地址或用途。");
    }
  }
  return {
    model: MINIMAX_H3_MODEL_ID,
    content,
    resolution: resolution as "768P" | "2K",
    duration,
    ratio: ratio as MiniMaxH3VideoRequest["ratio"],
  };
};

const dimensionsFor = (
  ratio: MiniMaxH3VideoRequest["ratio"],
  resolution: MiniMaxH3VideoRequest["resolution"],
  defaultMegapixels: number,
) => {
  const normalizedRatio = ratio === "adaptive" ? "16:9" : ratio;
  if (normalizedRatio === "16:9" && resolution === "2K") return [1920, 1088];
  const [ratioWidth, ratioHeight] = normalizedRatio.split(":").map(Number);
  const aspect = ratioWidth / ratioHeight;
  const pixels = (resolution === "2K" ? 2 : defaultMegapixels) * 1_000_000;
  const width = Math.ceil(Math.sqrt(pixels * aspect) / 32) * 32;
  const height = Math.ceil((width / aspect) / 32) * 32;
  return [width, height];
};

const alignedFrameCount = (durationSeconds: number) => {
  const targetFrames = Math.max(5, Math.round(durationSeconds * 24));
  const lowerAlignedFrames = targetFrames - ((targetFrames - 5) % 17);
  const upperAlignedFrames = lowerAlignedFrames + 17;
  return targetFrames - lowerAlignedFrames <= upperAlignedFrames - targetFrames
    ? lowerAlignedFrames
    : upperAlignedFrames;
};

export const buildComfyUIH3Prompt = ({
  request,
  settings,
  uploadedImages,
  seed,
  filenamePrefix,
}: {
  request: MiniMaxH3VideoRequest;
  settings: ComfyMiniMaxH3ReferenceSettings;
  uploadedImages: string[];
  seed: number;
  filenamePrefix: string;
}) => {
  const prompt = request.content.find((item) => item.type === "text");
  if (!prompt || prompt.type !== "text") throw new Error("本地 H3 模型提示词不能为空。");
  const [width, height] = dimensionsFor(request.ratio, request.resolution, settings.megapixels);
  const modelSource: [string, number] = settings.teSpeedEnabled ? ["5", 0] : ["1", 0];
  const graph: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }> = {
    "1": { class_type: "UNETLoader", inputs: { unet_name: settings.diffusionModel, weight_dtype: "default" }, _meta: { title: "MiniMax H3 参考生视频模型" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: settings.textEncoder, type: "minimax", device: "default" }, _meta: { title: "MiniMax H3 文本编码器" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: settings.videoVae }, _meta: { title: "MiniMax H3 视频 VAE" } },
    "4": { class_type: "VAELoader", inputs: { vae_name: settings.audioVae }, _meta: { title: "MiniMax H3 音频 VAE" } },
    "5": { class_type: "TESpeedMiniMaxH3", inputs: { model: ["1", 0], processing_control_value: 0.12, processing_percent_1: 0.1, processing_percent_2: 0.9, mcs: 2, device: "auto" }, _meta: { title: "H3 推理加速" } },
    "6": {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: {
        clip: ["2", 0],
        vae: ["3", 0],
        audio_vae: ["4", 0],
        prompt: prompt.text,
        width,
        height,
        length: alignedFrameCount(request.duration),
        ref_image_size: settings.refImageSize,
        ...Object.fromEntries(uploadedImages.map((_, index) => [`ref_images.ref_image_${index}`, [String(100 + index), 0]])),
      },
      _meta: { title: "MiniMax H3 图片参考生成" },
    },
    "7": { class_type: "RandomNoise", inputs: { noise_seed: seed }, _meta: { title: "随机种子" } },
    "8": { class_type: "KSamplerSelect", inputs: { sampler_name: "res_multistep" }, _meta: { title: "采样方式" } },
    "9": { class_type: "BasicScheduler", inputs: { model: modelSource, scheduler: settings.scheduler, steps: settings.steps, denoise: 1 }, _meta: { title: "采样计划" } },
    "10": { class_type: "BasicGuider", inputs: { model: modelSource, conditioning: ["6", 0] }, _meta: { title: "生成引导" } },
    "11": { class_type: "SamplerCustomAdvanced", inputs: { noise: ["7", 0], guider: ["10", 0], sampler: ["8", 0], sigmas: ["9", 0], latent_image: ["6", 1] }, _meta: { title: "视频采样" } },
    "12": { class_type: "VAEDecode", inputs: { samples: ["11", 0], vae: ["3", 0] }, _meta: { title: "视频解码" } },
    "13": { class_type: "VAEDecodeAudio", inputs: { samples: ["11", 0], vae: ["4", 0] }, _meta: { title: "原生声音解码" } },
    "14": { class_type: "CreateVideo", inputs: { images: ["12", 0], audio: ["13", 0], fps: 24, bit_depth: 8 }, _meta: { title: "合成视频和原生声音" } },
    "15": { class_type: "SaveVideo", inputs: { video: ["14", 0], filename_prefix: filenamePrefix, format: "auto", codec: "auto" }, _meta: { title: "保存候选视频" } },
  };
  uploadedImages.forEach((image, index) => {
    graph[String(100 + index)] = { class_type: "LoadImage", inputs: { image }, _meta: { title: `引用素材 ${index + 1}` } };
  });
  return graph;
};

const parseDataUrl = (value: string) => {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(value);
  if (!match) return undefined;
  return {
    mimeType: match[1].toLowerCase(),
    buffer: match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8"),
  };
};

const extensionForMime = (mimeType: string) => {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  return ".jpg";
};

const absoluteMediaUrl = (rawValue: string, req: Request) => {
  if (/^https?:\/\//i.test(rawValue)) return rawValue;
  if (rawValue.startsWith("/")) return `${req.protocol}://${req.get("host")}${rawValue}`;
  throw new Error("引用素材必须使用图片地址或 data URL。");
};

const readReferenceImage = async (rawValue: string, req: Request, providerFetch: typeof fetch) => {
  const dataUrl = parseDataUrl(rawValue);
  if (dataUrl) {
    if (!dataUrl.mimeType.startsWith("image/")) throw new Error("引用素材不是图片。");
    if (dataUrl.buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error("单张引用图片不能超过 50 MB。");
    return dataUrl;
  }
  const response = await providerFetch(absoluteMediaUrl(rawValue, req), { method: "GET" });
  if (!response.ok) throw new Error(`读取引用图片失败（${response.status}）。`);
  const mimeType = String(response.headers.get("content-type") || "image/png").split(";")[0].trim().toLowerCase();
  if (!mimeType.startsWith("image/")) throw new Error("引用素材地址没有返回图片。");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error("单张引用图片不能超过 50 MB。");
  return { mimeType, buffer };
};

const uploadReferenceImage = async ({
  baseUrl,
  localTaskId,
  index,
  image,
  providerFetch,
}: {
  baseUrl: string;
  localTaskId: string;
  index: number;
  image: { mimeType: string; buffer: Buffer };
  providerFetch: typeof fetch;
}) => {
  const digest = crypto.createHash("sha256").update(image.buffer).digest("hex").slice(0, 16);
  const filename = `omni-h3-${localTaskId}-${index + 1}-${digest}${extensionForMime(image.mimeType)}`;
  const body = new FormData();
  body.append("image", new Blob([image.buffer], { type: image.mimeType }), filename);
  body.append("type", "input");
  body.append("subfolder", "omni_h3");
  body.append("overwrite", "true");
  const response = await providerFetch(`${baseUrl}/upload/image`, {
    method: "POST",
    body,
  });
  const text = await response.text();
  const data = parseProviderText(text) as Record<string, unknown>;
  if (!response.ok) throw new Error(`ComfyUI 未接受第 ${index + 1} 张引用图片（${response.status}）。`);
  const name = String(data.name || filename);
  const subfolder = String(data.subfolder || "").replace(/^\/+|\/+$/g, "");
  return subfolder ? `${subfolder}/${name}` : name;
};

const fileExtension = (filename: string) => {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
};

const findVideoFile = (value: unknown): ComfyUIFileDescriptor | undefined => {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.filename === "string" && VIDEO_EXTENSIONS.has(fileExtension(record.filename))) {
      return { filename: record.filename, subfolder: typeof record.subfolder === "string" ? record.subfolder : "", type: typeof record.type === "string" ? record.type : "output" };
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = findVideoFile(child);
    if (found) return found;
  }
  return undefined;
};

const queueContainsPrompt = (items: unknown, promptId: string) => Array.isArray(items) && items.some((item) => (
  Array.isArray(item) ? String(item[1] || "") === promptId : false
));

const taskRequestSummary = (request: MiniMaxH3VideoRequest) => ({
  model: request.model,
  resolution: request.resolution,
  duration: request.duration,
  ratio: request.ratio,
  promptCharacters: request.content.find((item) => item.type === "text")?.text.length || 0,
  referenceImageCount: request.content.filter((item) => item.type === "image_url").length,
});

const readJson = async (response: Response, label: string) => {
  const text = await response.text();
  if (!response.ok) throw new Error(providerFailurePayload(label, response.status, text).error);
  return parseProviderText(text);
};

export interface ComfyUIH3RouteDependencies {
  repository?: VideoGenerationTaskRepository;
  providerFetch?: typeof fetch;
  resolveConfiguration?: typeof resolveComfyUIH3Configuration;
  mediaAssetsDir?: string;
}

const normalizedArchiveProjectId = (value?: string) => {
  const projectId = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(projectId)) {
    throw new Error("本地 H3 视频任务缺少合法项目编号，无法归档候选视频。");
  }
  return projectId;
};

const archiveExtension = (output: ComfyUIFileDescriptor) => {
  const extension = fileExtension(output.filename);
  return VIDEO_EXTENSIONS.has(extension) ? extension : ".mp4";
};

const existingNonEmptyFile = async (filePath: string) => {
  try {
    return (await fs.stat(filePath)).size > 0;
  } catch {
    return false;
  }
};

const archiveComfyUIVideo = async ({
  task,
  output,
  configuration,
  mediaAssetsDir,
  providerFetch,
}: {
  task: PersistedVideoGenerationTask;
  output: ComfyUIFileDescriptor;
  configuration: ComfyUIH3Configuration;
  mediaAssetsDir: string;
  providerFetch: typeof fetch;
}) => {
  const projectId = normalizedArchiveProjectId(task.projectId);
  const filename = `comfyui_h3_${task.id.replace(/[^A-Za-z0-9._-]/g, "_")}${archiveExtension(output)}`;
  const projectDir = path.join(mediaAssetsDir, projectId);
  const filePath = path.join(projectDir, filename);
  const mediaUrl = `/media/${projectId}/${filename}`;
  if (await existingNonEmptyFile(filePath)) return mediaUrl;

  await fs.mkdir(projectDir, { recursive: true });
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  try {
    const url = new URL(`${configuration.baseUrl}/view`);
    url.searchParams.set("filename", output.filename);
    url.searchParams.set("subfolder", output.subfolder || "");
    url.searchParams.set("type", output.type || "output");
    const response = await providerFetch(url);
    if (!response.ok || !response.body) throw new Error(`读取 ComfyUI 候选视频失败（${response.status || 502}）。`);
    await pipeline(Readable.fromWeb(response.body as any), createWriteStream(temporaryPath, { flags: "wx" }));
    if (!(await existingNonEmptyFile(temporaryPath))) throw new Error("ComfyUI 候选视频为空，未写入项目媒体目录。");
    await fs.rename(temporaryPath, filePath);
    return mediaUrl;
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
};

export const registerComfyUIH3VideoRoute = (app: Express, dependencies: ComfyUIH3RouteDependencies = {}) => {
  const repository = dependencies.repository || videoGenerationTaskRepository;
  const providerFetch = dependencies.providerFetch || fetch;
  const resolveConfiguration = dependencies.resolveConfiguration || resolveComfyUIH3Configuration;
  const mediaAssetsDir = dependencies.mediaAssetsDir || path.resolve("OMNI_Workspace", "Media_Assets");
  const archiveTasksInFlight = new Map<string, Promise<string>>();

  const archiveTaskOutput = (
    task: PersistedVideoGenerationTask,
    output: ComfyUIFileDescriptor,
    configuration: ComfyUIH3Configuration,
  ) => {
    const current = archiveTasksInFlight.get(task.id);
    if (current) return current;
    const operation = archiveComfyUIVideo({ task, output, configuration, mediaAssetsDir, providerFetch })
      .finally(() => archiveTasksInFlight.delete(task.id));
    archiveTasksInFlight.set(task.id, operation);
    return operation;
  };

  app.post("/api/proxy/comfyui/status", async (req, res) => {
    let baseUrl: string;
    try {
      baseUrl = normalizeComfyUIBaseUrl(req.body?.baseUrl);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "ComfyUI 地址无效。" });
    }
    try {
      const [stats, diffusionModels, textEncoders, vaes, workflows, h3Node, teSpeedNode] = await Promise.all([
        providerFetch(`${baseUrl}/system_stats`).then((response) => readJson(response, "读取 ComfyUI 状态")),
        providerFetch(`${baseUrl}/models/diffusion_models`).then((response) => readJson(response, "读取扩散模型")),
        providerFetch(`${baseUrl}/models/text_encoders`).then((response) => readJson(response, "读取文本编码器")),
        providerFetch(`${baseUrl}/models/vae`).then((response) => readJson(response, "读取 VAE")),
        providerFetch(`${baseUrl}/api/userdata?dir=workflows&recurse=true&split=false`).then((response) => readJson(response, "读取工作流")),
        providerFetch(`${baseUrl}/object_info/MiniMaxH3ReferenceToVideo`).then((response) => readJson(response, "读取 H3 节点")),
        providerFetch(`${baseUrl}/object_info/TESpeedMiniMaxH3`).then((response) => readJson(response, "读取 H3 推理加速节点")),
      ]);
      const system = stats && typeof stats === "object" ? (stats as Record<string, any>).system || {} : {};
      const devices = stats && typeof stats === "object" && Array.isArray((stats as Record<string, any>).devices) ? (stats as Record<string, any>).devices : [];
      const installed = {
        diffusionModel: Array.isArray(diffusionModels) && diffusionModels.includes(COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.diffusionModel),
        textEncoder: Array.isArray(textEncoders) && textEncoders.includes(COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.textEncoder),
        videoVae: Array.isArray(vaes) && vaes.includes(COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.videoVae),
        audioVae: Array.isArray(vaes) && vaes.includes(COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS.audioVae),
        referenceNode: Boolean(h3Node && typeof h3Node === "object" && (h3Node as Record<string, unknown>).MiniMaxH3ReferenceToVideo),
        teSpeedNode: Boolean(teSpeedNode && typeof teSpeedNode === "object" && (teSpeedNode as Record<string, unknown>).TESpeedMiniMaxH3),
        sourceWorkflow: Array.isArray(workflows) && workflows.map(String).some((name) => name.endsWith(COMFYUI_H3_SOURCE_WORKFLOW)),
      };
      return res.json({
        ready: Object.values(installed).every(Boolean),
        baseUrl,
        version: String(system.comfyui_version || ""),
        deviceName: String(devices[0]?.name || ""),
        installed,
        sourceWorkflowName: COMFYUI_H3_SOURCE_WORKFLOW,
      });
    } catch (error) {
      console.error("ComfyUI status proxy error:", proxyErrorSummary(error));
      return res.status(502).json({ error: "无法读取这台 ComfyUI，请检查地址、服务和本地网络权限。" });
    }
  });

  app.post("/api/proxy/comfyui-h3-video/tasks", async (req, res) => {
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 500) return res.status(400).json({ error: "视频任务缺少合法的重复提交识别码。" });
    const existing = repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.provider !== COMFYUI_H3_PROVIDER) return res.status(409).json({ error: "这个重复提交识别码已经属于另一种视频任务，请重新打开生成确认页。" });
      if (existing.status === "failed" || existing.status === "cancelled") {
        return res.status(409).json({ error: "原视频任务已经失败或取消。请明确点击“再生成一个候选视频”，由页面创建新的尝试。", task: publicVideoGenerationTask(existing, true) });
      }
      return res.status(200).json({ task: publicVideoGenerationTask(existing, true) });
    }

    let request: MiniMaxH3VideoRequest;
    let configuration: ComfyUIH3Configuration;
    try {
      request = validateComfyUIH3VideoRequest(req.body?.request);
      configuration = resolveConfiguration(req.body?.channelId, req.body?.modelConfigId);
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "本地 H3 视频请求无效。" });
    }
    const requestText = JSON.stringify(request);
    let localTask: PersistedVideoGenerationTask;
    try {
      localTask = repository.create({
        idempotencyKey,
        provider: COMFYUI_H3_PROVIDER,
        channelId: String(req.body.channelId),
        modelConfigId: String(req.body.modelConfigId),
        projectId: req.body?.audit?.projectId ? String(req.body.audit.projectId) : undefined,
        status: "submitting",
        embeddedAudio: true,
        requestHash: crypto.createHash("sha256").update(requestText).digest("hex"),
        request: taskRequestSummary(request),
        audit: req.body?.audit && typeof req.body.audit === "object" ? req.body.audit : undefined,
      });
    } catch (error) {
      const concurrent = repository.findByIdempotencyKey(idempotencyKey);
      if (concurrent?.provider === COMFYUI_H3_PROVIDER && !["failed", "cancelled"].includes(concurrent.status)) {
        return res.status(200).json({ task: publicVideoGenerationTask(concurrent, true) });
      }
      throw error;
    }

    const references = request.content.filter((item): item is Extract<MiniMaxH3ContentItem, { type: "image_url" }> => item.type === "image_url");
    const uploadedImages: string[] = [];
    try {
      for (let index = 0; index < references.length; index += 1) {
        const image = await readReferenceImage(references[index].image_url.url, req, providerFetch);
        uploadedImages.push(await uploadReferenceImage({ baseUrl: configuration.baseUrl, localTaskId: localTask.id, index, image, providerFetch }));
      }
    } catch (error) {
      localTask = repository.update(localTask.id, { status: "failed", error: error instanceof Error ? error.message : "上传引用图片失败。" });
      return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
    }

    const graph = buildComfyUIH3Prompt({
      request,
      settings: configuration.settings,
      uploadedImages,
      seed: crypto.randomInt(0, 2 ** 31 - 1),
      filenamePrefix: `video/omni_h3/${localTask.id}`,
    });
    try {
      const response = await providerFetch(`${configuration.baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ prompt: graph, extra_data: { extra_pnginfo: { source: "OMNI", localTaskId: localTask.id, workflowId: configuration.workflowId } } }),
      });
      const text = await response.text();
      const data = parseProviderText(text) as Record<string, unknown>;
      if (!response.ok || (data.node_errors && Object.keys(data.node_errors as object).length > 0)) {
        console.warn("ComfyUI H3 submit error:", providerFailureSummary(response.status, text));
        localTask = repository.update(localTask.id, { status: "failed", error: providerFailurePayload("ComfyUI 工作流提交", response.status, text).error, providerResponse: data });
        return res.status(response.ok ? 400 : response.status).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
      }
      const promptId = String(data.prompt_id || "").trim();
      if (!promptId) {
        localTask = repository.update(localTask.id, { status: "unknown", error: "ComfyUI 已响应但没有返回任务编号；系统不会自动重提。", providerResponse: data });
        return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
      }
      localTask = repository.update(localTask.id, { status: "queued", providerTaskId: promptId, providerResponse: { ...data, uploadedImages }, error: undefined });
      return res.status(202).json({ task: publicVideoGenerationTask(localTask) });
    } catch (error) {
      console.error("ComfyUI H3 submit proxy error:", proxyErrorSummary(error));
      localTask = repository.update(localTask.id, { status: "unknown", error: `ComfyUI 提交结果未知：${error instanceof Error ? error.message : String(error)}。系统不会自动重提，请继续查询原任务。` });
      return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
    }
  });

  app.get("/api/proxy/comfyui-h3-video/tasks/:taskId", async (req, res) => {
    let task = repository.getById(req.params.taskId);
    if (!task || task.provider !== COMFYUI_H3_PROVIDER) return res.status(404).json({ error: "没有找到这个本地 H3 视频生成任务。" });
    if (["failed", "cancelled"].includes(task.status)) return res.json({ task: publicVideoGenerationTask(task) });
    if (task.status === "succeeded" && task.videoUrl?.startsWith("/media/")) {
      return res.json({ task: publicVideoGenerationTask(task) });
    }
    try {
      const configuration = resolveConfiguration(task.channelId, task.modelConfigId);
      const recordedOutput = (task.providerResponse as Record<string, any> | undefined)?.output as ComfyUIFileDescriptor | undefined;
      if (task.status === "succeeded" && recordedOutput?.filename) {
        const archivedUrl = await archiveTaskOutput(task, recordedOutput, configuration);
        task = repository.update(task.id, { videoUrl: archivedUrl, error: undefined });
        return res.json({ task: publicVideoGenerationTask(task) });
      }
      if (!task.providerTaskId) return res.json({ task: publicVideoGenerationTask(task) });
      const historyResponse = await providerFetch(`${configuration.baseUrl}/history/${encodeURIComponent(task.providerTaskId)}`);
      const historyData = await readJson(historyResponse, "查询 ComfyUI 原任务") as Record<string, any>;
      const history = historyData[task.providerTaskId];
      if (history) {
        const statusText = String(history.status?.status_str || "").toLowerCase();
        const completed = history.status?.completed === true || statusText === "success" || statusText === "succeeded";
        if (completed) {
          const output = findVideoFile(history.outputs);
          const archivedUrl = output ? await archiveTaskOutput(task, output, configuration) : undefined;
          task = repository.update(task.id, {
            status: archivedUrl ? "succeeded" : "unknown",
            videoUrl: archivedUrl,
            providerResponse: { ...(task.providerResponse || {}), historyStatus: history.status, output },
            error: archivedUrl ? undefined : "ComfyUI 已完成任务，但没有找到候选视频文件。",
          });
          return res.json({ task: publicVideoGenerationTask(task) });
        }
        if (["error", "failed"].includes(statusText)) {
          task = repository.update(task.id, { status: "failed", error: "本地 H3 视频生成失败。", providerResponse: { ...(task.providerResponse || {}), historyStatus: history.status } });
          return res.json({ task: publicVideoGenerationTask(task) });
        }
      }
      const queueResponse = await providerFetch(`${configuration.baseUrl}/queue`);
      const queue = await readJson(queueResponse, "查询 ComfyUI 队列") as Record<string, unknown>;
      const status = queueContainsPrompt(queue.queue_running, task.providerTaskId)
        ? "running"
        : queueContainsPrompt(queue.queue_pending, task.providerTaskId) ? "queued" : "unknown";
      task = repository.update(task.id, { status, error: status === "unknown" ? "原任务暂时不在队列或历史记录中；系统不会自动重提。" : undefined });
      return res.json({ task: publicVideoGenerationTask(task) });
    } catch (error) {
      console.error("ComfyUI H3 query proxy error:", proxyErrorSummary(error));
      task = repository.update(task.id, { status: "unknown", error: `查询或归档 ComfyUI 原任务失败：${error instanceof Error ? error.message : String(error)}。没有创建新任务。` });
      return res.status(502).json({ error: task.error, task: publicVideoGenerationTask(task) });
    }
  });

  app.get("/api/proxy/comfyui-h3-video/tasks/:taskId/output", async (req, res) => {
    const task = repository.getById(req.params.taskId);
    if (!task || task.provider !== COMFYUI_H3_PROVIDER || task.status !== "succeeded") return res.status(404).json({ error: "候选视频尚不可用。" });
    const output = (task.providerResponse as Record<string, any> | undefined)?.output as ComfyUIFileDescriptor | undefined;
    if (!output?.filename) return res.status(404).json({ error: "候选视频文件记录缺失。" });
    try {
      const configuration = resolveConfiguration(task.channelId, task.modelConfigId);
      const url = new URL(`${configuration.baseUrl}/view`);
      url.searchParams.set("filename", output.filename);
      url.searchParams.set("subfolder", output.subfolder || "");
      url.searchParams.set("type", output.type || "output");
      const response = await providerFetch(url);
      if (!response.ok || !response.body) return res.status(response.status || 502).json({ error: "读取本地候选视频失败。" });
      res.setHeader("Content-Type", response.headers.get("content-type") || "video/mp4");
      const contentLength = response.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      return Readable.fromWeb(response.body as any).pipe(res);
    } catch (error) {
      console.error("ComfyUI H3 output proxy error:", proxyErrorSummary(error));
      return res.status(502).json({ error: "读取本地候选视频失败。" });
    }
  });
};
