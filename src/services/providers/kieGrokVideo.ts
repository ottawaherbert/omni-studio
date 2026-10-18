import {
  KIE_GROK_VIDEO_DEFAULT_SETTINGS,
  KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
  KIE_GROK_VIDEO_MIN_DURATION_SECONDS,
  KIE_GROK_VIDEO_RESOLUTIONS,
  isKieGrokVideoModelId,
  type AIChannel,
  type AIModel,
} from "../../config/aiConfigDefaults";
import type { VideoGenerationTask } from "./videoGenerationTask";

export interface GenerateKieGrokVideoOptions {
  prompt: string;
  imageUrl: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16";
}

export interface KieGrokVideoProxyRequest {
  model: string;
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  aspectRatio: "16:9" | "9:16";
  imageUrl: string;
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const isLocalHttpUrl = (value: string) => {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === "string"
    ? resolve(reader.result)
    : reject(new Error("视频首帧没有转换为可上传的图片数据。"));
  reader.onerror = () => reject(reader.error || new Error("读取视频首帧失败。"));
  reader.readAsDataURL(blob);
});

const resolveSourceImage = async (imageUrl: string) => {
  const trimmed = imageUrl.trim();
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (isHttpUrl(trimmed) && !isLocalHttpUrl(trimmed)) return trimmed;
  const response = await fetch(trimmed);
  if (!response.ok) throw new Error(`无法读取 Kie 视频首帧 (${response.status})。`);
  return blobToDataUrl(await response.blob());
};

export const validateKieGrokVideoDuration = (durationSeconds: number) => {
  const duration = Number(durationSeconds);
  if (!Number.isInteger(duration)
    || duration < KIE_GROK_VIDEO_MIN_DURATION_SECONDS
    || duration > KIE_GROK_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(`当前视频生成单元时长必须是 ${KIE_GROK_VIDEO_MIN_DURATION_SECONDS}-${KIE_GROK_VIDEO_MAX_DURATION_SECONDS} 秒整数；超出模型上限时请拆分视频单元，不能静默截断。`);
  }
  return duration;
};

export const buildKieGrokVideoRequest = (
  model: AIModel,
  options: GenerateKieGrokVideoOptions,
): KieGrokVideoProxyRequest => {
  if (!isKieGrokVideoModelId(model.modelId)) {
    throw new Error(`Kie Grok 视频适配器不支持模型 ID：${model.modelId || "（空）"}。`);
  }
  const prompt = options.prompt.trim();
  if (!prompt) throw new Error("Kie 视频生成提示词不能为空。");
  const imageUrl = options.imageUrl.trim();
  if (!imageUrl || (!imageUrl.startsWith("data:image/") && !isHttpUrl(imageUrl))) {
    throw new Error("Kie 视频生成需要已采用的首帧图片 URL 或图片 data URL。");
  }
  if (options.aspectRatio !== "16:9" && options.aspectRatio !== "9:16") {
    throw new Error("Kie 视频生成画幅只支持 16:9 或 9:16，必须继承当前项目画幅。");
  }
  const settings = { ...KIE_GROK_VIDEO_DEFAULT_SETTINGS, ...(model.kieGrokVideo || {}) };
  if (!KIE_GROK_VIDEO_RESOLUTIONS.includes(settings.resolution)) {
    throw new Error("Kie 视频生成清晰度只支持 480p 或 720p，请在模型管理中选择。");
  }
  return {
    model: model.modelId,
    prompt,
    duration: validateKieGrokVideoDuration(options.durationSeconds),
    resolution: settings.resolution,
    aspectRatio: options.aspectRatio,
    imageUrl,
  };
};

const safeErrorMessage = (value: unknown) => {
  if (!value || typeof value !== "object") return "Kie 视频生成失败。";
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" ? error.slice(0, 500) : "Kie 视频生成失败。";
};

export const generateKieGrokVideo = async ({
  channel,
  model,
  options,
}: {
  channel: AIChannel;
  model: AIModel;
  options: GenerateKieGrokVideoOptions;
}) => {
  const imageUrl = await resolveSourceImage(options.imageUrl);
  const request = buildKieGrokVideoRequest(model, { ...options, imageUrl });
  const response = await fetch("/api/proxy/kie-grok-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId: channel.id, modelConfigId: model.id, request }),
  });
  const data = await response.json().catch(() => ({})) as { videoUrl?: string; error?: string };
  if (!response.ok) {
    throw Object.assign(
      new Error(`Kie Grok Video 请求失败 (${response.status})：${safeErrorMessage(data)}`),
      { retryable: false },
    );
  }
  if (!data.videoUrl) throw new Error("Kie Grok Video 没有返回可用视频。");
  return data.videoUrl;
};

const taskResponse = async (response: Response) => {
  const data = await response.json().catch(() => ({})) as { task?: VideoGenerationTask; error?: string };
  if (!data.task) throw new Error(data.error || "Kie 视频接口没有返回本地任务记录。");
  return data.task;
};

export const submitKieGrokVideoTask = async ({
  channel,
  model,
  options,
  idempotencyKey,
  audit,
}: {
  channel: AIChannel;
  model: AIModel;
  options: GenerateKieGrokVideoOptions;
  idempotencyKey: string;
  audit?: Record<string, unknown>;
}) => {
  const imageUrl = await resolveSourceImage(options.imageUrl);
  const request = buildKieGrokVideoRequest(model, { ...options, imageUrl });
  return taskResponse(await fetch("/api/proxy/kie-grok-video/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channelId: channel.id, modelConfigId: model.id, request, idempotencyKey, audit }),
  }));
};

export const queryKieGrokVideoTask = async (taskId: string) =>
  taskResponse(await fetch(`/api/proxy/kie-grok-video/tasks/${encodeURIComponent(taskId)}`));
