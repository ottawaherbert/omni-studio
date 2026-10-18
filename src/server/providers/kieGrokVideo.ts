import crypto from "crypto";
import type { Express } from "express";

import {
  KIE_DEFAULT_BASE_URL,
  KIE_FILE_UPLOAD_BASE_URL,
  KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
  KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
  KIE_GROK_VIDEO_MIN_DURATION_SECONDS,
  KIE_GROK_VIDEO_RESOLUTIONS,
  isKieGrokVideoModelId,
} from "../../config/aiConfigDefaults";
import { dbHelpers } from "../db";
import {
  publicVideoGenerationTask,
  videoGenerationTaskRepository,
  type PersistedVideoGenerationTask,
  type VideoGenerationTaskRepository,
} from "../videoGenerationTaskRepository";
import { parseProviderText, providerFailurePayload, providerFailureSummary, proxyErrorSummary } from "../routes/providerProxyUtils";
import { normalizeCredentialedProviderTarget } from "../routes/providerTargetPolicy";

export const KIE_GROK_VIDEO_POLL_INTERVAL_MS = 5_000;
export const KIE_BASE64_UPLOAD_ENDPOINT = `${KIE_FILE_UPLOAD_BASE_URL}/api/file-base64-upload`;

export interface KieGrokVideoProxyRequest {
  model: string;
  prompt: string;
  duration: number;
  resolution: "480p" | "720p";
  aspectRatio: "16:9" | "9:16";
  imageUrl: string;
}

export interface KiePreviewCreateTaskRequest {
  model: typeof KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID;
  input: {
    image_urls: string[];
    prompt: string;
    duration: number;
    resolution: "480p" | "720p";
    aspect_ratio: "16:9" | "9:16";
  };
}

export interface KieLegacyCreateTaskRequest {
  model: typeof KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID;
  input: {
    task_id: string;
    image_urls: string[];
    prompt: string;
    mode: "normal";
    duration: string;
    resolution: "480p" | "720p";
    aspect_ratio: "16:9" | "9:16";
  };
}

export type KieCreateTaskRequest = KiePreviewCreateTaskRequest | KieLegacyCreateTaskRequest;

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
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
};

export const normalizeKieCreateTaskEndpoint = (rawEndpoint?: string) => {
  const url = normalizeCredentialedProviderTarget("kie", (rawEndpoint || KIE_DEFAULT_BASE_URL).trim());
  url.search = "";
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname) url.pathname = "/api/v1/jobs/createTask";
  else if (pathname.endsWith("/api/v1")) url.pathname = `${pathname}/jobs/createTask`;
  else if (pathname.endsWith("/api/v1/jobs")) url.pathname = `${pathname}/createTask`;
  else if (pathname.endsWith("/api/v1/jobs/createTask")) url.pathname = pathname;
  else throw new Error("Kie channel URL must use an /api/v1 base URL or end with /api/v1/jobs/createTask.");
  return url.toString();
};

export const buildKieTaskStatusEndpoint = (createEndpoint: string, taskId: string) => {
  const url = new URL(createEndpoint);
  url.pathname = url.pathname.replace(/\/jobs\/createTask$/, "/jobs/recordInfo");
  url.searchParams.set("taskId", taskId);
  return url.toString();
};

export const validateKieGrokVideoRequest = (input: unknown): KieGrokVideoProxyRequest => {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const model = String(source.model || "").trim();
  const prompt = String(source.prompt || "").trim();
  const duration = Number(source.duration);
  const resolution = String(source.resolution || "").trim();
  const aspectRatio = String(source.aspectRatio || "").trim();
  const imageUrl = String(source.imageUrl || "").trim();

  if (!isKieGrokVideoModelId(model)) {
    throw new Error(`Unsupported Kie Grok Video model id: ${model || "(empty)"}.`);
  }
  if (!prompt) throw new Error("Kie Grok Video prompt is required.");
  if (!Number.isInteger(duration)
    || duration < KIE_GROK_VIDEO_MIN_DURATION_SECONDS
    || duration > KIE_GROK_VIDEO_MAX_DURATION_SECONDS) {
    throw new Error(`Kie Grok Video duration must be an integer between ${KIE_GROK_VIDEO_MIN_DURATION_SECONDS} and ${KIE_GROK_VIDEO_MAX_DURATION_SECONDS} seconds.`);
  }
  if (!KIE_GROK_VIDEO_RESOLUTIONS.includes(resolution as "480p" | "720p")) {
    throw new Error("Kie Grok Video resolution must be 480p or 720p and must come from model settings.");
  }
  if (aspectRatio !== "16:9" && aspectRatio !== "9:16") {
    throw new Error("Kie Grok Video aspect ratio must be 16:9 or 9:16 and must come from the current project.");
  }
  if (!imageUrl.startsWith("data:image/") && (!isHttpUrl(imageUrl) || isLocalHttpUrl(imageUrl))) {
    throw new Error("Kie Grok Video requires a public HTTP(S) image URL or image data URL.");
  }
  return {
    model,
    prompt,
    duration,
    resolution: resolution as "480p" | "720p",
    aspectRatio: aspectRatio as "16:9" | "9:16",
    imageUrl,
  };
};

export const buildKieCreateTaskRequest = (
  request: KieGrokVideoProxyRequest,
  publicImageUrl: string,
  legacyTaskId = `task_grok_${crypto.randomUUID().replace(/-/g, "")}`,
): KieCreateTaskRequest => {
  if (request.model === KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID) {
    return {
      model: KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
      input: {
        image_urls: [publicImageUrl],
        prompt: request.prompt,
        duration: request.duration,
        resolution: request.resolution,
        aspect_ratio: request.aspectRatio,
      },
    };
  }
  if (request.model !== KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID) {
    throw new Error(`Unsupported Kie Grok Video model id: ${request.model || "(empty)"}.`);
  }
  return {
    model: KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
    input: {
      task_id: legacyTaskId,
      image_urls: [publicImageUrl],
      prompt: request.prompt,
      mode: "normal",
      duration: String(request.duration),
      resolution: request.resolution,
      aspect_ratio: request.aspectRatio,
    },
  };
};

const stringValue = (value: unknown) => typeof value === "string" ? value.trim() : "";

export const kieTaskId = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  return stringValue(data.taskId) || stringValue(record.taskId) || undefined;
};

export const kieTaskState = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  return stringValue(data.state || data.status || record.state || record.status).toLowerCase();
};

export const kieResultVideoUrl = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const rawResult = data.resultJson || record.resultJson;
  let result: unknown = rawResult;
  if (typeof rawResult === "string") {
    try { result = JSON.parse(rawResult); } catch { return undefined; }
  }
  if (!result || typeof result !== "object") return undefined;
  const urls = (result as Record<string, unknown>).resultUrls;
  return Array.isArray(urls) ? urls.map(stringValue).find(Boolean) : undefined;
};

export const resolveKieGrokVideoConfiguration = (channelId?: string, modelConfigId?: string) => {
  if (!channelId) throw new Error("Kie channel id is required.");
  if (!modelConfigId) throw new Error("Kie video model config id is required.");
  const { config } = dbHelpers.getAIConfig();
  const channel = config.channels.find((item) => item.id === channelId && item.type === "kie");
  if (!channel) throw new Error("Configured Kie channel was not found.");
  const model = config.models.find((item) => item.id === modelConfigId && item.channelId === channel.id);
  if (!model) throw new Error("Configured Kie video model was not found on this channel.");
  if (!isKieGrokVideoModelId(model.modelId)) {
    throw new Error(`Unsupported Kie Grok Video model id: ${model.modelId || "(empty)"}.`);
  }
  const apiKey = (model.apiKeyOverride || channel.apiKey || "").trim().replace(/^Bearer\s+/i, "");
  if (!apiKey) throw new Error("Kie API key is not configured in the channel or model.");
  return { endpoint: normalizeKieCreateTaskEndpoint(channel.baseUrl), apiKey };
};

export interface KieGrokVideoRouteDependencies {
  repository?: VideoGenerationTaskRepository;
  resolveConfiguration?: typeof resolveKieGrokVideoConfiguration;
  providerFetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
}

const terminalFailureStates = new Set(["fail", "failed", "error", "cancelled", "canceled"]);

const providerMessage = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  return stringValue(data.failMsg) || stringValue(record.msg) || stringValue(record.message);
};

const uploadDataUrl = async (providerFetch: typeof fetch, headers: Record<string, string>, imageUrl: string) => {
  if (!imageUrl.startsWith("data:image/")) return imageUrl;
  const imageType = imageUrl.match(/^data:image\/(png|jpe?g|webp);/i)?.[1]?.toLowerCase();
  const extension = imageType === "jpeg" ? "jpg" : imageType || "png";
  const response = await providerFetch(KIE_BASE64_UPLOAD_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      base64Data: imageUrl,
      uploadPath: "images/omni-video-inputs",
      fileName: `omni-video-${crypto.randomUUID()}.${extension}`,
    }),
    redirect: "error",
  });
  const text = await response.text();
  const data = parseProviderText(text);
  if (!response.ok) {
    console.warn("Kie image upload error:", providerFailureSummary(response.status, text));
    throw new Error(providerFailurePayload("Kie 视频首帧上传", response.status, text).error);
  }
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const payload = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const publicUrl = stringValue(payload.downloadUrl) || stringValue(payload.fileUrl);
  if (!publicUrl || !isHttpUrl(publicUrl)) throw new Error("Kie image upload did not return a public image URL.");
  return publicUrl;
};

export const registerKieGrokVideoRoute = (
  app: Express,
  dependencies: KieGrokVideoRouteDependencies = {},
) => {
  const repository = dependencies.repository || videoGenerationTaskRepository;
  const resolveConfiguration = dependencies.resolveConfiguration || resolveKieGrokVideoConfiguration;
  const providerFetch = dependencies.providerFetch || fetch;
  const wait = dependencies.wait || ((milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  const pollIntervalMs = Math.max(1, dependencies.pollIntervalMs || KIE_GROK_VIDEO_POLL_INTERVAL_MS);

  app.post("/api/proxy/kie-grok-video/tasks", async (req, res) => {
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 500) {
      return res.status(400).json({ error: "视频任务缺少合法的重复提交识别码。" });
    }
    const existing = repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.provider !== "kie_grok") {
        return res.status(409).json({ error: "这个重复提交识别码已经属于另一种视频任务，请重新打开生成确认页。" });
      }
      if (existing.status === "failed" || existing.status === "cancelled") {
        return res.status(409).json({
          error: "原视频任务已经失败或取消。请明确点击“再生成一个候选视频”，由页面创建新的尝试。",
          task: publicVideoGenerationTask(existing, true),
        });
      }
      return res.status(200).json({ task: publicVideoGenerationTask(existing, true) });
    }

    let endpoint: string;
    let apiKey: string;
    let request: KieGrokVideoProxyRequest;
    try {
      request = validateKieGrokVideoRequest(req.body?.request);
      ({ endpoint, apiKey } = resolveConfiguration(req.body?.channelId, req.body?.modelConfigId));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "Kie 视频请求无效。" });
    }

    let localTask: PersistedVideoGenerationTask;
    try {
      localTask = repository.create({
        idempotencyKey,
        provider: "kie_grok",
        channelId: String(req.body.channelId),
        modelConfigId: String(req.body.modelConfigId),
        projectId: req.body?.audit?.projectId ? String(req.body.audit.projectId) : undefined,
        status: "submitting",
        embeddedAudio: false,
        requestHash: crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
        request: request as unknown as Record<string, unknown>,
        audit: req.body?.audit && typeof req.body.audit === "object" ? req.body.audit : undefined,
      });
    } catch (error) {
      const concurrent = repository.findByIdempotencyKey(idempotencyKey);
      if (concurrent) {
        if (concurrent.provider !== "kie_grok") {
          return res.status(409).json({ error: "这个重复提交识别码已经属于另一种视频任务，请重新打开生成确认页。" });
        }
        if (concurrent.status === "failed" || concurrent.status === "cancelled") {
          return res.status(409).json({
            error: "原视频任务已经失败或取消。请明确点击“再生成一个候选视频”，由页面创建新的尝试。",
            task: publicVideoGenerationTask(concurrent, true),
          });
        }
        return res.status(200).json({ task: publicVideoGenerationTask(concurrent, true) });
      }
      throw error;
    }

    const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    try {
      const imageUrl = await uploadDataUrl(providerFetch, headers, request.imageUrl);
      const createRequest = buildKieCreateTaskRequest(request, imageUrl);
      const submitResponse = await providerFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(createRequest),
        redirect: "error",
      });
      const submitText = await submitResponse.text();
      const submitData = parseProviderText(submitText);
      if (!submitResponse.ok || Number((submitData as Record<string, unknown>)?.code || 0) !== 200) {
        console.warn("Kie Grok Video submit error:", providerFailureSummary(submitResponse.status, submitText));
        localTask = repository.update(localTask.id, {
          status: "failed",
          error: `Kie 视频供应商未能接受请求${providerMessage(submitData) ? `：${providerMessage(submitData).slice(0, 300)}` : ""}，本次任务没有自动重提。`,
          providerResponse: submitData as Record<string, unknown>,
        });
        return res.status(submitResponse.ok ? 502 : submitResponse.status).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
      }
      const providerTaskId = kieTaskId(submitData);
      if (!providerTaskId) {
        localTask = repository.update(localTask.id, {
          status: "unknown",
          error: "Kie 已响应但没有返回任务编号；系统不会自动重提。",
          providerResponse: submitData as Record<string, unknown>,
        });
        return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
      }
      localTask = repository.update(localTask.id, {
        status: "queued",
        providerTaskId,
        providerResponse: submitData as Record<string, unknown>,
        error: undefined,
      });
      return res.status(202).json({ task: publicVideoGenerationTask(localTask) });
    } catch (error) {
      console.error("Kie Grok Video submit proxy error:", proxyErrorSummary(error));
      localTask = repository.update(localTask.id, {
        status: "unknown",
        error: error instanceof Error
          ? `Kie 视频提交结果未知：${error.message}。系统不会自动重提，请继续查询原任务。`
          : "Kie 视频提交结果未知；系统不会自动重提，请继续查询原任务。",
      });
      return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
    }
  });

  app.get("/api/proxy/kie-grok-video/tasks/:taskId", async (req, res) => {
    let task = repository.getById(req.params.taskId);
    if (!task || task.provider !== "kie_grok") return res.status(404).json({ error: "没有找到这个 Kie 视频生成任务。" });
    if (["succeeded", "failed", "cancelled"].includes(task.status) || !task.providerTaskId) {
      return res.json({ task: publicVideoGenerationTask(task) });
    }
    try {
      const { endpoint, apiKey } = resolveConfiguration(task.channelId, task.modelConfigId);
      const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      const pollResponse = await providerFetch(buildKieTaskStatusEndpoint(endpoint, task.providerTaskId), { method: "GET", headers, redirect: "error" });
      const pollText = await pollResponse.text();
      const pollData = parseProviderText(pollText);
      if (!pollResponse.ok) {
        console.warn("Kie Grok Video query error:", providerFailureSummary(pollResponse.status, pollText));
        task = repository.update(task.id, { status: "unknown", error: providerFailurePayload("Kie 视频任务查询", pollResponse.status, pollText).error });
        return res.status(pollResponse.status).json({ error: task.error, task: publicVideoGenerationTask(task) });
      }
      const state = kieTaskState(pollData);
      const videoUrl = state === "success" ? kieResultVideoUrl(pollData) : undefined;
      const failed = terminalFailureStates.has(state);
      task = repository.update(task.id, {
        status: state === "success" && videoUrl ? "succeeded" : failed ? (state.startsWith("cancel") ? "cancelled" : "failed") : "running",
        videoUrl,
        providerResponse: pollData as Record<string, unknown>,
        error: state === "success" && !videoUrl
          ? "Kie 原任务已完成，但没有返回可用视频地址。"
          : failed ? `Kie 视频生成失败${providerMessage(pollData) ? `：${providerMessage(pollData).slice(0, 300)}` : ""}。` : undefined,
      });
      return res.json({ task: publicVideoGenerationTask(task) });
    } catch (error) {
      console.error("Kie Grok Video query proxy error:", proxyErrorSummary(error));
      task = repository.update(task.id, { status: "unknown", error: "查询原 Kie 视频任务时发生网络错误，没有创建新任务。" });
      return res.status(502).json({ error: task.error, task: publicVideoGenerationTask(task) });
    }
  });

  app.post("/api/proxy/kie-grok-video", async (req, res) => {
    let endpoint: string;
    let apiKey: string;
    let request: KieGrokVideoProxyRequest;
    try {
      request = validateKieGrokVideoRequest(req.body.request);
      ({ endpoint, apiKey } = resolveConfiguration(req.body.channelId, req.body.modelConfigId));
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Invalid Kie Grok Video request." });
    }

    const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    let activeTaskId: string | undefined;
    try {
      const imageUrl = await uploadDataUrl(providerFetch, headers, request.imageUrl);
      const createRequest = buildKieCreateTaskRequest(request, imageUrl);
      const submitResponse = await providerFetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(createRequest),
        redirect: "error",
      });
      const submitText = await submitResponse.text();
      const submitData = parseProviderText(submitText);
      if (!submitResponse.ok || Number((submitData as Record<string, unknown>)?.code || 0) !== 200) {
        console.warn("Kie Grok Video submit error:", providerFailureSummary(submitResponse.status, submitText));
        return res.status(submitResponse.ok ? 502 : submitResponse.status).json({
          error: `Kie 视频供应商未能接受请求${providerMessage(submitData) ? `：${providerMessage(submitData).slice(0, 300)}` : ""}，本次昂贵任务未重复提交。`,
          retryable: false,
        });
      }
      activeTaskId = kieTaskId(submitData);
      if (!activeTaskId) return res.status(502).json({ error: "Kie createTask response did not contain data.taskId.", retryable: false });

      const statusEndpoint = buildKieTaskStatusEndpoint(endpoint, activeTaskId);
      while (true) {
        await wait(pollIntervalMs);
        const pollResponse = await providerFetch(statusEndpoint, { method: "GET", headers, redirect: "error" });
        const pollText = await pollResponse.text();
        const pollData = parseProviderText(pollText);
        if (!pollResponse.ok) {
          console.warn("Kie Grok Video poll error:", providerFailureSummary(pollResponse.status, pollText));
          return res.status(pollResponse.status).json({ ...providerFailurePayload("Kie 视频任务查询", pollResponse.status, pollText), retryable: false });
        }
        const state = kieTaskState(pollData);
        if (state === "success") {
          const videoUrl = kieResultVideoUrl(pollData);
          if (!videoUrl) return res.status(502).json({ error: "Kie task completed without resultJson.resultUrls.", taskId: activeTaskId, retryable: false });
          return res.status(200).json({ videoUrl, taskId: activeTaskId, status: "done" });
        }
        if (terminalFailureStates.has(state)) {
          return res.status(502).json({ error: `Kie 视频生成失败${providerMessage(pollData) ? `：${providerMessage(pollData).slice(0, 300)}` : ""}。`, taskId: activeTaskId, retryable: false });
        }
      }
    } catch (error) {
      console.error("Kie Grok Video proxy error:", proxyErrorSummary(error));
      return res.status(502).json({ error: error instanceof Error ? error.message : "Kie video proxy failed.", retryable: false });
    }
  });
};
