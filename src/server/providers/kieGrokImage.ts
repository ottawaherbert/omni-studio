import crypto from "crypto";
import type { Express } from "express";

import {
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_RESOLUTIONS,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  isKieGptImage2ModelId,
  isKieGrokImageModelId,
  isKieImageModelId,
  isKieImageOperationId,
} from "../../config/aiConfigDefaults";
import { dbHelpers } from "../db";
import { parseProviderText, providerFailurePayload, providerFailureSummary, proxyErrorSummary } from "../routes/providerProxyUtils";
import {
  KIE_BASE64_UPLOAD_ENDPOINT,
  buildKieTaskStatusEndpoint,
  kieResultVideoUrl,
  kieTaskId,
  kieTaskState,
  normalizeKieCreateTaskEndpoint,
} from "./kieGrokVideo";

export const KIE_GROK_IMAGE_POLL_INTERVAL_MS = 3_000;
export const KIE_IMAGE_ASPECT_RATIOS = ["2:3", "3:2", "1:1", "3:4", "4:3", "9:16", "16:9"] as const;

export interface KieGrokImageProxyRequest {
  model:
    | typeof KIE_GROK_TEXT_TO_IMAGE_MODEL_ID
    | typeof KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID
    | typeof KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID
    | typeof KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID;
  prompt: string;
  aspectRatio?: (typeof KIE_IMAGE_ASPECT_RATIOS)[number];
  resolution?: (typeof KIE_GPT_IMAGE_2_RESOLUTIONS)[number];
  imageUrl?: string;
  imageUrls?: string[];
}

export type KieGrokImageCreateTaskRequest = {
  model: typeof KIE_GROK_TEXT_TO_IMAGE_MODEL_ID;
  input: { prompt: string; aspect_ratio: (typeof KIE_IMAGE_ASPECT_RATIOS)[number] };
} | {
  model: typeof KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID;
  input: { prompt: string; image_urls: string[] };
} | {
  model: typeof KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID;
  input: {
    prompt: string;
    aspect_ratio: (typeof KIE_IMAGE_ASPECT_RATIOS)[number];
    resolution: (typeof KIE_GPT_IMAGE_2_RESOLUTIONS)[number];
  };
} | {
  model: typeof KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID;
  input: {
    prompt: string;
    input_urls: string[];
    aspect_ratio: (typeof KIE_IMAGE_ASPECT_RATIOS)[number];
    resolution: (typeof KIE_GPT_IMAGE_2_RESOLUTIONS)[number];
  };
};

const isHttpUrl = (value: string) => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
};

const isLocalHttpUrl = (value: string) => {
  try { return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname); } catch { return false; }
};

const stringValue = (value: unknown) => typeof value === "string" ? value.trim() : "";

const providerMessage = (value: unknown) => {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  return stringValue(data.failMsg) || stringValue(record.msg) || stringValue(record.message);
};

export const validateKieGrokImageRequest = (input: unknown): KieGrokImageProxyRequest => {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const model = String(source.model || "").trim();
  const prompt = String(source.prompt || "").trim();
  const aspectRatio = String(source.aspectRatio || "").trim();
  const resolution = String(source.resolution || "").trim();
  const imageUrl = String(source.imageUrl || "").trim();
  const imageUrls = Array.isArray(source.imageUrls) ? source.imageUrls.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (!isKieImageOperationId(model)) throw new Error(`Unsupported Kie Image operation id: ${model || "(empty)"}.`);
  if (!prompt) throw new Error("Kie Image prompt is required.");
  if (isKieGptImage2ModelId(model)) {
    if (!KIE_IMAGE_ASPECT_RATIOS.includes(aspectRatio as any)) throw new Error("Kie GPT Image 2 requires a supported aspect ratio.");
    if (!KIE_GPT_IMAGE_2_RESOLUTIONS.includes(resolution as any)) throw new Error("Kie GPT Image 2 resolution must be 1K, 2K, or 4K.");
    if (model === KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID) {
      if (imageUrl || imageUrls.length) throw new Error("Kie GPT Image 2 text-to-image must not include reference images.");
      return {
        model,
        prompt,
        aspectRatio: aspectRatio as KieGrokImageProxyRequest["aspectRatio"],
        resolution: resolution as KieGrokImageProxyRequest["resolution"],
      };
    }
    if (imageUrls.length < 1 || imageUrls.length > 16) throw new Error("Kie GPT Image 2 image-to-image requires 1-16 reference images.");
    if (imageUrls.some((url) => !url.startsWith("data:image/") && (!isHttpUrl(url) || isLocalHttpUrl(url)))) {
      throw new Error("Kie GPT Image 2 reference images must use public HTTP(S) URLs or image data URLs.");
    }
    return {
      model: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
      prompt,
      aspectRatio: aspectRatio as KieGrokImageProxyRequest["aspectRatio"],
      resolution: resolution as KieGrokImageProxyRequest["resolution"],
      imageUrls,
    };
  }
  if (!isKieGrokImageModelId(model)) throw new Error(`Unsupported Kie Grok Image model id: ${model || "(empty)"}.`);
  if (model === KIE_GROK_TEXT_TO_IMAGE_MODEL_ID) {
    if (!KIE_IMAGE_ASPECT_RATIOS.includes(aspectRatio as any)) throw new Error("Kie Grok text-to-image requires a supported aspect ratio.");
    if (imageUrl) throw new Error("Kie Grok text-to-image must not include a reference image.");
    return { model, prompt, aspectRatio: aspectRatio as KieGrokImageProxyRequest["aspectRatio"] };
  }
  if (!imageUrl.startsWith("data:image/") && (!isHttpUrl(imageUrl) || isLocalHttpUrl(imageUrl))) {
    throw new Error("Kie Grok image-to-image requires one public HTTP(S) image URL or image data URL.");
  }
  return { model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID, prompt, imageUrl };
};

export const buildKieGrokImageCreateTaskRequest = (
  request: KieGrokImageProxyRequest,
  publicImageUrl?: string,
  publicImageUrls?: string[],
): KieGrokImageCreateTaskRequest => {
  if (request.model === KIE_GROK_TEXT_TO_IMAGE_MODEL_ID) {
    if (!request.aspectRatio) throw new Error("Kie Grok text-to-image aspect ratio is missing.");
    return { model: request.model, input: { prompt: request.prompt, aspect_ratio: request.aspectRatio } };
  }
  if (request.model === KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID) {
    if (!request.aspectRatio || !request.resolution) throw new Error("Kie GPT Image 2 text-to-image settings are missing.");
    return { model: request.model, input: { prompt: request.prompt, aspect_ratio: request.aspectRatio, resolution: request.resolution } };
  }
  if (request.model === KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID) {
    if (!request.aspectRatio || !request.resolution || !publicImageUrls?.length) throw new Error("Kie GPT Image 2 image-to-image settings are missing.");
    return {
      model: request.model,
      input: {
        prompt: request.prompt,
        input_urls: publicImageUrls,
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
      },
    };
  }
  if (!publicImageUrl) throw new Error("Kie Grok image-to-image reference image is missing.");
  return { model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID, input: { prompt: request.prompt, image_urls: [publicImageUrl] } };
};

export const resolveKieGrokImageConfiguration = (channelId?: string, modelConfigId?: string) => {
  if (!channelId) throw new Error("Kie channel id is required.");
  if (!modelConfigId) throw new Error("Kie image model config id is required.");
  const { config } = dbHelpers.getAIConfig();
  const channel = config.channels.find((item) => item.id === channelId && item.type === "kie");
  if (!channel) throw new Error("Configured Kie channel was not found.");
  const model = config.models.find((item) => item.id === modelConfigId && item.channelId === channel.id);
  if (!model || !isKieImageModelId(model.modelId)) throw new Error("Configured Kie image model was not found on this channel.");
  const apiKey = (model.apiKeyOverride || channel.apiKey || "").trim().replace(/^Bearer\s+/i, "");
  if (!apiKey) throw new Error("Kie API key is not configured in the channel or model.");
  return { endpoint: normalizeKieCreateTaskEndpoint(channel.baseUrl), apiKey, modelId: model.modelId };
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
      uploadPath: "images/omni-image-inputs",
      fileName: `omni-image-${crypto.randomUUID()}.${extension}`,
    }),
    redirect: "error",
  });
  const text = await response.text();
  const data = parseProviderText(text);
  if (!response.ok) {
    console.warn("Kie image upload error:", providerFailureSummary(response.status, text));
    throw new Error(providerFailurePayload("Kie 图片上传", response.status, text).error);
  }
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const payload = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const publicUrl = stringValue(payload.downloadUrl) || stringValue(payload.fileUrl);
  if (!publicUrl || !isHttpUrl(publicUrl)) throw new Error("Kie image upload did not return a public image URL.");
  return publicUrl;
};

export interface KieGrokImageRouteDependencies {
  resolveConfiguration?: typeof resolveKieGrokImageConfiguration;
  providerFetch?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  pollIntervalMs?: number;
}

const terminalFailureStates = new Set(["fail", "failed", "error", "cancelled", "canceled"]);

export const registerKieGrokImageRoute = (app: Express, dependencies: KieGrokImageRouteDependencies = {}) => {
  const resolveConfiguration = dependencies.resolveConfiguration || resolveKieGrokImageConfiguration;
  const providerFetch = dependencies.providerFetch || fetch;
  const wait = dependencies.wait || ((milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  const pollIntervalMs = Math.max(1, dependencies.pollIntervalMs || KIE_GROK_IMAGE_POLL_INTERVAL_MS);

  app.post("/api/proxy/kie-grok-image", async (req, res) => {
    let endpoint: string;
    let apiKey: string;
    let configuredModelId: string;
    let request: KieGrokImageProxyRequest;
    try {
      request = validateKieGrokImageRequest(req.body.request);
      ({ endpoint, apiKey, modelId: configuredModelId } = resolveConfiguration(req.body.channelId, req.body.modelConfigId));
      if (isKieGptImage2ModelId(request.model) !== isKieGptImage2ModelId(configuredModelId)) {
        throw new Error("The selected Kie image model configuration does not match the requested image model family.");
      }
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "Invalid Kie Grok Image request." });
    }
    const headers = { Accept: "application/json", Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
    let activeTaskId: string | undefined;
    try {
      const publicImageUrl = request.imageUrl ? await uploadDataUrl(providerFetch, headers, request.imageUrl) : undefined;
      const publicImageUrls = request.imageUrls
        ? await Promise.all(request.imageUrls.map((url) => uploadDataUrl(providerFetch, headers, url)))
        : undefined;
      const createRequest = buildKieGrokImageCreateTaskRequest(request, publicImageUrl, publicImageUrls);
      const submitResponse = await providerFetch(endpoint, { method: "POST", headers, body: JSON.stringify(createRequest), redirect: "error" });
      const submitText = await submitResponse.text();
      const submitData = parseProviderText(submitText);
      if (!submitResponse.ok || Number((submitData as Record<string, unknown>)?.code || 0) !== 200) {
        console.warn("Kie Grok Image submit error:", providerFailureSummary(submitResponse.status, submitText));
        return res.status(submitResponse.ok ? 502 : submitResponse.status).json({ error: `Kie 图片供应商未能接受请求${providerMessage(submitData) ? `：${providerMessage(submitData).slice(0, 300)}` : ""}。`, retryable: false });
      }
      activeTaskId = kieTaskId(submitData);
      if (!activeTaskId) return res.status(502).json({ error: "Kie createTask response did not contain data.taskId.", retryable: false });
      const statusEndpoint = buildKieTaskStatusEndpoint(endpoint, activeTaskId);
      while (true) {
        await wait(pollIntervalMs);
        const pollResponse = await providerFetch(statusEndpoint, { method: "GET", headers, redirect: "error" });
        const pollText = await pollResponse.text();
        const pollData = parseProviderText(pollText);
        if (!pollResponse.ok) return res.status(pollResponse.status).json({ ...providerFailurePayload("Kie 图片任务查询", pollResponse.status, pollText), retryable: false });
        const state = kieTaskState(pollData);
        if (state === "success") {
          const imageUrl = kieResultVideoUrl(pollData);
          if (!imageUrl) return res.status(502).json({ error: "Kie image task completed without resultJson.resultUrls.", taskId: activeTaskId, retryable: false });
          return res.status(200).json({ imageUrl, taskId: activeTaskId, status: "done" });
        }
        if (terminalFailureStates.has(state)) return res.status(502).json({ error: `Kie 图片生成失败${providerMessage(pollData) ? `：${providerMessage(pollData).slice(0, 300)}` : ""}。`, taskId: activeTaskId, retryable: false });
      }
    } catch (error) {
      console.error("Kie Grok Image proxy error:", proxyErrorSummary(error));
      return res.status(502).json({ error: error instanceof Error ? error.message : "Kie image proxy failed.", retryable: false });
    }
  });
};
