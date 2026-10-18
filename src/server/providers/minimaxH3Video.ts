import crypto from "crypto";
import type { Express } from "express";

import {
  MINIMAX_H3_DEFAULT_BASE_URL,
  MINIMAX_H3_MODEL_ID,
  MINIMAX_H3_RESOLUTIONS,
} from "../../config/aiConfigDefaults";
import type { MiniMaxH3ContentItem, MiniMaxH3VideoRequest } from "../../services/production/minimaxH3Adapter";
import { dbHelpers } from "../db";
import {
  videoGenerationTaskRepository,
  publicVideoGenerationTask,
  type PersistedVideoGenerationTask,
  type PersistedVideoGenerationTaskStatus,
  type VideoGenerationTaskRepository,
} from "../videoGenerationTaskRepository";
import { parseProviderText, providerFailureSummary, proxyErrorSummary } from "../routes/providerProxyUtils";
import { normalizeCredentialedProviderTarget } from "../routes/providerTargetPolicy";

export const MINIMAX_H3_CREATE_ENDPOINT = `${MINIMAX_H3_DEFAULT_BASE_URL}/v2/video_generation`;

export const normalizeMiniMaxH3CreateEndpoint = (rawEndpoint?: string, channelId?: string) => {
  const url = normalizeCredentialedProviderTarget("minimax", (rawEndpoint || MINIMAX_H3_DEFAULT_BASE_URL).trim(), channelId);
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) url.pathname = "/v2/video_generation";
  else if (path === "/v2") url.pathname = "/v2/video_generation";
  else if (path === "/v2/video_generation") url.pathname = path;
  else throw new Error("MiniMax H3 需要独立的视频渠道地址，填写 https://api.minimax.io 或完整的 /v2/video_generation 地址。");
  return url.toString();
};

export const buildMiniMaxH3QueryEndpoint = (createEndpoint: string, providerTaskId: string) => {
  const url = new URL(createEndpoint);
  url.pathname = `/v2/query/video_generation/${encodeURIComponent(providerTaskId)}`;
  return url.toString();
};

const contentUrl = (item: MiniMaxH3ContentItem) => {
  if (item.type === "image_url") return item.image_url.url;
  if (item.type === "video_url") return item.video_url.url;
  if (item.type === "audio_url") return item.audio_url.url;
  return "";
};

const validMediaUrl = (value: string, type: MiniMaxH3ContentItem["type"]) => {
  if (value.startsWith("mm_file://")) return true;
  if (value.startsWith(`data:${type === "image_url" ? "image" : type === "video_url" ? "video" : "audio"}/`)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (["localhost", "127.0.0.1", "::1"].includes(url.hostname) && url.protocol === "http:");
  } catch {
    return false;
  }
};

export const validateMiniMaxH3VideoRequest = (input: unknown): MiniMaxH3VideoRequest => {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const model = String(source.model || "").trim();
  const resolution = String(source.resolution || "").trim();
  const duration = Number(source.duration);
  const ratio = String(source.ratio || "adaptive").trim();
  const content = Array.isArray(source.content) ? source.content as MiniMaxH3ContentItem[] : [];
  if (model !== MINIMAX_H3_MODEL_ID) throw new Error(`MiniMax H3 视频接口只接受 ${MINIMAX_H3_MODEL_ID}。`);
  if (!MINIMAX_H3_RESOLUTIONS.includes(resolution as "768P" | "2K")) throw new Error("MiniMax H3 清晰度只支持 768P 或 2K。");
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw new Error("MiniMax H3 时长必须是 4-15 秒整数。");
  if (!["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(ratio)) throw new Error("MiniMax H3 画幅不受支持。");
  if (!content.some((item) => item?.type === "text" && typeof item.text === "string" && item.text.trim())) throw new Error("MiniMax H3 请求必须包含非空模型提示词。");
  if (JSON.stringify(source).length > 64 * 1024 * 1024) throw new Error("MiniMax H3 请求体不能超过 64 MB。");
  const roles: string[] = [];
  for (const item of content) {
    if (!item || !["text", "image_url", "video_url", "audio_url"].includes(item.type)) throw new Error("MiniMax H3 content 包含未知素材类型。");
    if (item.type === "text") {
      if (item.text.length > 7000) throw new Error("MiniMax H3 模型提示词最多 7000 字符。");
      continue;
    }
    const url = contentUrl(item);
    if (!url || !validMediaUrl(url, item.type)) throw new Error("MiniMax H3 素材必须使用 HTTPS、mm_file 或合法 data URL。");
    const role = typeof item.role === "string" ? item.role.trim() : "";
    const allowedRoles = item.type === "image_url"
      ? ["reference_image", "first_frame", "last_frame"]
      : item.type === "video_url" ? ["reference_video"] : ["reference_audio"];
    if (!allowedRoles.includes(role)) throw new Error("MiniMax H3 素材类型与用途不匹配。");
    roles.push(role);
  }
  const hasReference = roles.some((role) => role.startsWith("reference_"));
  const hasFrame = roles.some((role) => role === "first_frame" || role === "last_frame");
  if (hasReference && hasFrame) throw new Error("MiniMax H3 多素材参考不能与首帧/尾帧画面混用。");
  const count = (role: string) => roles.filter((item) => item === role).length;
  if (count("reference_image") > 9 || count("reference_video") > 3 || count("reference_audio") > 3) throw new Error("MiniMax H3 引用素材数量超过官方限制。");
  if (roles.filter((role) => role.startsWith("reference_")).length > 12) throw new Error("MiniMax H3 混合引用素材最多 12 份。");
  if (count("first_frame") > 1 || count("last_frame") > 1) throw new Error("MiniMax H3 首帧和尾帧各最多一张。");
  if (count("reference_audio") > 0 && count("reference_image") + count("reference_video") === 0) throw new Error("MiniMax H3 参考声音不能单独提交。");
  return { model: MINIMAX_H3_MODEL_ID, content, resolution: resolution as "768P" | "2K", duration, ratio: ratio as MiniMaxH3VideoRequest["ratio"] };
};

export const resolveMiniMaxH3Configuration = (channelId?: string, modelConfigId?: string) => {
  if (!channelId || !modelConfigId) throw new Error("MiniMax H3 渠道和模型配置不能为空。");
  const { config } = dbHelpers.getAIConfig();
  const channel = config.channels.find((item) => item.id === channelId && item.type === "minimax");
  if (!channel) throw new Error("没有找到 MiniMax H3 视频渠道。");
  const model = config.models.find((item) => item.id === modelConfigId && item.channelId === channel.id && item.modelId === MINIMAX_H3_MODEL_ID);
  if (!model) throw new Error("没有找到当前 MiniMax H3 视频模型配置。");
  const apiKey = (model.apiKeyOverride || channel.apiKey || process.env.MINIMAX_API_KEY || "").trim().replace(/^Bearer\s+/i, "");
  if (!apiKey) throw new Error("MiniMax H3 API Key 尚未配置。");
  return { endpoint: normalizeMiniMaxH3CreateEndpoint(channel.baseUrl, channel.id), apiKey };
};

const taskIdFromResponse = (value: unknown) => value && typeof value === "object" ? String((value as Record<string, unknown>).task_id || "").trim() : "";

export const normalizeMiniMaxH3TaskResponse = (value: unknown) => {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const task = root.task && typeof root.task === "object" ? root.task as Record<string, unknown> : root;
  const content = task.content && typeof task.content === "object" ? task.content as Record<string, unknown> : {};
  const rawStatus = String(task.status || "unknown").toLowerCase();
  const status: PersistedVideoGenerationTaskStatus = ["queued", "running", "succeeded", "failed", "cancelled"].includes(rawStatus)
    ? rawStatus as PersistedVideoGenerationTaskStatus
    : "unknown";
  return {
    providerTaskId: String(task.id || root.task_id || "").trim() || undefined,
    status,
    videoUrl: typeof content.url === "string" ? content.url : undefined,
    providerResponse: root,
  };
};

export interface MiniMaxH3RouteDependencies {
  repository?: VideoGenerationTaskRepository;
  providerFetch?: typeof fetch;
  resolveConfiguration?: typeof resolveMiniMaxH3Configuration;
}

export const registerMiniMaxH3VideoRoute = (app: Express, dependencies: MiniMaxH3RouteDependencies = {}) => {
  const repository = dependencies.repository || videoGenerationTaskRepository;
  const providerFetch = dependencies.providerFetch || fetch;
  const resolveConfiguration = dependencies.resolveConfiguration || resolveMiniMaxH3Configuration;

  app.post("/api/proxy/minimax-h3-video/tasks", async (req, res) => {
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim();
    if (!idempotencyKey || idempotencyKey.length > 500) return res.status(400).json({ error: "视频任务缺少合法的重复提交识别码。" });
    const existing = repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.provider !== "minimax_h3") {
        return res.status(409).json({ error: "这个重复提交识别码已经属于另一种视频任务，请重新打开生成确认页。" });
      }
      if (existing.status === "failed" || existing.status === "cancelled") {
        return res.status(409).json({ error: "原视频任务已经失败或取消。请明确点击“再生成一个候选视频”，由页面创建新的尝试。", task: publicVideoGenerationTask(existing, true) });
      }
      return res.status(200).json({ task: publicVideoGenerationTask(existing, true) });
    }

    let request: MiniMaxH3VideoRequest;
    let endpoint: string;
    let apiKey: string;
    try {
      request = validateMiniMaxH3VideoRequest(req.body?.request);
      ({ endpoint, apiKey } = resolveConfiguration(req.body?.channelId, req.body?.modelConfigId));
    } catch (error) {
      return res.status(400).json({ error: error instanceof Error ? error.message : "MiniMax H3 视频请求无效。" });
    }
    const requestText = JSON.stringify(request);
    let localTask: PersistedVideoGenerationTask;
    try {
      localTask = repository.create({
        idempotencyKey,
        provider: "minimax_h3",
        channelId: String(req.body.channelId),
        modelConfigId: String(req.body.modelConfigId),
        projectId: req.body?.audit?.projectId ? String(req.body.audit.projectId) : undefined,
        status: "submitting",
        embeddedAudio: true,
        requestHash: crypto.createHash("sha256").update(requestText).digest("hex"),
        request: request as unknown as Record<string, unknown>,
        audit: req.body?.audit && typeof req.body.audit === "object" ? req.body.audit : undefined,
      });
    } catch (error) {
      const concurrent = repository.findByIdempotencyKey(idempotencyKey);
      if (concurrent) {
        if (concurrent.provider !== "minimax_h3") {
          return res.status(409).json({ error: "这个重复提交识别码已经属于另一种视频任务，请重新打开生成确认页。" });
        }
        if (concurrent.status === "failed" || concurrent.status === "cancelled") {
          return res.status(409).json({ error: "原视频任务已经失败或取消。请明确点击“再生成一个候选视频”，由页面创建新的尝试。", task: publicVideoGenerationTask(concurrent, true) });
        }
        return res.status(200).json({ task: publicVideoGenerationTask(concurrent, true) });
      }
      throw error;
    }

    try {
      const providerResponse = await providerFetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: requestText,
        redirect: "error",
      });
      const text = await providerResponse.text();
      const data = parseProviderText(text);
      if (!providerResponse.ok) {
        console.warn("MiniMax H3 submit error:", providerFailureSummary(providerResponse.status, text));
        localTask = repository.update(localTask.id, { status: "failed", error: `MiniMax H3 未接受请求（${providerResponse.status}），本次任务没有自动重提。`, providerResponse: data as Record<string, unknown> });
        return res.status(providerResponse.status).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
      }
      const providerTaskId = taskIdFromResponse(data);
      if (!providerTaskId) {
        localTask = repository.update(localTask.id, { status: "unknown", error: "MiniMax H3 已响应但没有返回任务编号；系统不会自动重提。", providerResponse: data as Record<string, unknown> });
        return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
      }
      localTask = repository.update(localTask.id, { status: "queued", providerTaskId, providerResponse: data as Record<string, unknown>, error: undefined });
      return res.status(202).json({ task: publicVideoGenerationTask(localTask) });
    } catch (error) {
      console.error("MiniMax H3 submit proxy error:", proxyErrorSummary(error));
      localTask = repository.update(localTask.id, { status: "unknown", error: "MiniMax H3 提交结果未知；系统不会自动重提，请继续查询原任务。" });
      return res.status(502).json({ error: localTask.error, task: publicVideoGenerationTask(localTask) });
    }
  });

  app.get("/api/proxy/minimax-h3-video/tasks/:taskId", async (req, res) => {
    let task = repository.getById(req.params.taskId);
    if (!task || task.provider !== "minimax_h3") return res.status(404).json({ error: "没有找到这个 MiniMax H3 视频生成任务。" });
    if (["succeeded", "failed", "cancelled"].includes(task.status) || !task.providerTaskId) {
      return res.json({ task: publicVideoGenerationTask(task) });
    }
    try {
      const { endpoint, apiKey } = resolveConfiguration(task.channelId, task.modelConfigId);
      const queryResponse = await providerFetch(buildMiniMaxH3QueryEndpoint(endpoint, task.providerTaskId), {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        redirect: "error",
      });
      const text = await queryResponse.text();
      const data = parseProviderText(text);
      if (!queryResponse.ok) {
        console.warn("MiniMax H3 query error:", providerFailureSummary(queryResponse.status, text));
        task = repository.update(task.id, { status: "unknown", error: `查询原视频任务失败（${queryResponse.status}），没有创建新任务。` });
        return res.status(queryResponse.status).json({ error: task.error, task: publicVideoGenerationTask(task) });
      }
      const normalized = normalizeMiniMaxH3TaskResponse(data);
      task = repository.update(task.id, {
        status: normalized.status,
        providerTaskId: normalized.providerTaskId || task.providerTaskId,
        videoUrl: normalized.videoUrl,
        providerResponse: normalized.providerResponse,
        error: normalized.status === "failed" ? "MiniMax H3 视频生成失败。" : undefined,
      });
      return res.json({ task: publicVideoGenerationTask(task) });
    } catch (error) {
      console.error("MiniMax H3 query proxy error:", proxyErrorSummary(error));
      task = repository.update(task.id, { status: "unknown", error: "查询原视频任务时发生网络错误，没有创建新任务。" });
      return res.status(502).json({ error: task.error, task: publicVideoGenerationTask(task) });
    }
  });
};
