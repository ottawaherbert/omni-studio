import crypto from "crypto";

import { GoogleGenAI } from "@google/genai";

import { dbHelpers } from "../db";
import { normalizeCredentialedProviderTarget, normalizeLocalOpenAICompatibleTarget } from "./providerTargetPolicy";

export type OpenAICompatibleProvider = "openai" | "deepseek" | "doubao" | "kie" | "llamacpp";
const OPENAI_COMPATIBLE_DEFAULT_BASE_URLS: Record<OpenAICompatibleProvider, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  kie: "https://api.kie.ai/api/v1",
  llamacpp: "http://127.0.0.1:8080/v1",
};
const DEFAULT_CUSTOM_BGM_ENV_NAME = "OMNI_CUSTOM_BGM_API_KEY";
export const DEFAULT_CUSTOM_BGM_MODEL_ID = "suno-v3.5";
let backendGeminiCache: { apiKey: string; client: GoogleGenAI } | null = null;

export const resolveDatabaseChannelApiKey = (channelId?: string, provider?: string) => {
  try {
    const { config } = dbHelpers.getAIConfig();
    const channel = channelId
      ? config.channels.find((item) => item.id === channelId)
      : config.channels.find((item) => item.type === provider && item.apiKey?.trim());
    return (channel?.apiKey || "").trim().replace(/^Bearer\s+/i, "");
  } catch {
    return "";
  }
};

const resolveBackendGeminiClient = () => {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return null;
  if (!backendGeminiCache || backendGeminiCache.apiKey !== apiKey) {
    backendGeminiCache = { apiKey, client: new GoogleGenAI({ apiKey }) };
  }
  return backendGeminiCache;
};

export const resolveGeminiProxyClient = (requestApiKey?: string, channelId?: string) => {
  const providedKey = (requestApiKey || "").trim();
  if (providedKey) return { client: new GoogleGenAI({ apiKey: providedKey }), apiKey: providedKey };

  const databaseKey = resolveDatabaseChannelApiKey(channelId, "gemini");
  if (databaseKey) return { client: new GoogleGenAI({ apiKey: databaseKey }), apiKey: databaseKey };

  return resolveBackendGeminiClient();
};

export const normalizeOpenAICompatibleBaseUrl = (
  provider: OpenAICompatibleProvider,
  baseUrl?: string,
  channelId?: string,
) => {
  const requestedBaseUrl = baseUrl || OPENAI_COMPATIBLE_DEFAULT_BASE_URLS[provider];
  const url = provider === "llamacpp"
    ? normalizeLocalOpenAICompatibleTarget(requestedBaseUrl, channelId)
    : normalizeCredentialedProviderTarget(provider, requestedBaseUrl, channelId);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
};

const splitEnvList = (value?: string) =>
  (value || "").split(",").map((item) => item.trim()).filter(Boolean);

export const redactProxyText = (value: unknown, maxLength = 400) => {
  const raw = typeof value === "string" ? value : value instanceof Error ? value.message : JSON.stringify(value ?? "");
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[redacted]"')
    .replace(/"authorization"\s*:\s*"[^"]+"/gi, '"authorization":"[redacted]"')
    .replace(/"prompt"\s*:\s*"[^"]+"/gi, '"prompt":"[redacted]"')
    .replace(/"contents?"\s*:\s*"[^"]+"/gi, '"content":"[redacted]"')
    .slice(0, maxLength);
};

export const proxyErrorSummary = (err: unknown) => {
  const cause = (err as any)?.cause;
  return {
    name: err instanceof Error ? err.name : typeof err,
    message: redactProxyText(err, 300) || "Unknown proxy error",
    ...(cause ? { cause: redactProxyText(cause?.message || cause?.code || cause, 200) } : {}),
  };
};

export const providerFailureSummary = (status: number, responseText: string) => ({
  status,
  responseBytes: responseText.length,
  responseSha256: responseText ? crypto.createHash("sha256").update(responseText).digest("hex").slice(0, 12) : "none",
  responsePreview: redactProxyText(responseText, 400),
});

const providerMessageFrom = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const nestedError = record.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : {};
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : {};
  return [nestedError.message, record.message, record.msg, data.failMsg, data.message]
    .find((item) => typeof item === "string" && item.trim()) as string || "";
};

export const providerFailurePayload = (label: string, status: number, responseText: string) => {
  const parsed = parseProviderText(responseText);
  const message = redactProxyText(providerMessageFrom(parsed) || responseText, 400);
  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const nestedError = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const providerCode = nestedError.code ?? record.code;
  return {
    error: `${label} 返回 HTTP ${status}${message ? `：${message}` : ""}`,
    providerStatus: status,
    ...(providerCode !== undefined ? { providerCode: String(providerCode) } : {}),
    providerResponse: providerFailureSummary(status, responseText).responsePreview,
  };
};

export const providerExceptionPayload = (label: string, error: unknown) => {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = Number(record.status ?? record.statusCode);
  const code = record.code;
  const message = redactProxyText(error, 400) || "未知供应商错误";
  return {
    error: `${label}${Number.isFinite(status) ? ` 返回 HTTP ${status}` : "调用失败"}：${message}`,
    ...(Number.isFinite(status) ? { providerStatus: status } : {}),
    ...(code !== undefined ? { providerCode: String(code) } : {}),
  };
};

export const hashProxyBody = (body?: string) =>
  body ? crypto.createHash("sha256").update(body).digest("hex").slice(0, 12) : "none";

export const parseProviderText = (text: string) => {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
};

export const resolveOpenAICompatibleApiKey = (
  provider: OpenAICompatibleProvider,
  requestApiKey?: string,
  channelId?: string,
) => {
  const provided = (requestApiKey || "").trim().replace(/^Bearer\s+/i, "");
  if (provided) return provided;
  const databaseKey = resolveDatabaseChannelApiKey(channelId, provider);
  if (databaseKey) return databaseKey;
  if (provider === "llamacpp") return "";
  if (provider === "openai") return (process.env.OPENAI_API_KEY || "").trim();
  if (provider === "deepseek") return (process.env.DEEPSEEK_API_KEY || "").trim();
  if (provider === "doubao") return (process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY || "").trim();
  return (process.env.KIE_API_KEY || "").trim();
};

export const resolveMiniMaxApiKey = (requestApiKey?: string, channelId?: string) => {
  const provided = (requestApiKey || "").trim().replace(/^Bearer\s+/i, "");
  if (provided) return provided;
  const databaseKey = resolveDatabaseChannelApiKey(channelId, "minimax");
  if (databaseKey) return databaseKey;
  return (process.env.MINIMAX_API_KEY || "").trim();
};

const customBgmAllowedOrigins = () =>
  splitEnvList(process.env.OMNI_CUSTOM_BGM_ALLOWED_ORIGINS || process.env.CUSTOM_BGM_ALLOWED_ORIGINS);

const customBgmAllowedModels = () => {
  const configured = splitEnvList(process.env.OMNI_CUSTOM_BGM_ALLOWED_MODELS || process.env.CUSTOM_BGM_ALLOWED_MODELS);
  return configured.length > 0 ? configured : [DEFAULT_CUSTOM_BGM_MODEL_ID];
};

export const normalizeCustomBgmProviderUrl = (rawUrl: string) => {
  const url = new URL(rawUrl);
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(isLocalhost && url.protocol === "http:")) {
    throw new Error("Custom BGM provider only allows HTTPS targets, except localhost development endpoints.");
  }
  if (!isLocalhost) {
    const matched = customBgmAllowedOrigins().some((entry) => {
      try {
        return new URL(entry).origin === url.origin;
      } catch {
        return entry === url.hostname || entry === url.origin;
      }
    });
    if (!matched) {
      throw new Error("Custom BGM provider URL is not allowlisted. Configure OMNI_CUSTOM_BGM_ALLOWED_ORIGINS or CUSTOM_BGM_ALLOWED_ORIGINS on the server.");
    }
  }
  url.hash = "";
  return url.toString();
};

export const normalizeCustomBgmModelId = (rawModel?: string) => {
  const model = (rawModel || DEFAULT_CUSTOM_BGM_MODEL_ID).trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) {
    throw new Error("Custom BGM model id must use only letters, numbers, dot, underscore, colon or hyphen.");
  }
  if (!customBgmAllowedModels().includes(model)) {
    throw new Error("Custom BGM model id is not allowlisted. Configure OMNI_CUSTOM_BGM_ALLOWED_MODELS or CUSTOM_BGM_ALLOWED_MODELS on the server.");
  }
  return model;
};

const normalizeCustomBgmEnvName = (rawName?: string) => {
  const envName = (rawName || DEFAULT_CUSTOM_BGM_ENV_NAME).trim().toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(envName)) {
    throw new Error("Custom BGM env key slot must use only A-Z, 0-9 and underscore.");
  }
  if (!envName.endsWith("_API_KEY") || (!envName.startsWith("OMNI_CUSTOM_BGM_") && !envName.startsWith("CUSTOM_BGM_"))) {
    throw new Error("Custom BGM env key slot must start with OMNI_CUSTOM_BGM_ or CUSTOM_BGM_ and end with _API_KEY.");
  }
  return envName;
};

export const resolveCustomBgmApiKey = (requestApiKey?: string, requestEnvName?: string) => {
  const provided = (requestApiKey || "").trim().replace(/^Bearer\s+/i, "");
  if (provided) return { apiKey: provided, envName: "", source: "local" as const };

  const envName = normalizeCustomBgmEnvName(requestEnvName);
  return { apiKey: (process.env[envName] || "").trim(), envName, source: "serverEnv" as const };
};

export const getProviderKeyStatus = (customBgmEnvName?: string) => {
  const databaseReady = (provider: string) => Boolean(resolveDatabaseChannelApiKey(undefined, provider));
  const backendGemini = resolveBackendGeminiClient();
  const customBgm = (() => {
    try {
      const resolved = resolveCustomBgmApiKey("", customBgmEnvName);
      return { envName: resolved.envName, ready: Boolean(resolved.apiKey) };
    } catch (err: any) {
      return {
        envName: (customBgmEnvName || DEFAULT_CUSTOM_BGM_ENV_NAME).trim(),
        ready: false,
        error: err?.message || "Invalid Custom BGM env key slot.",
      };
    }
  })();
  const allowedOrigins = customBgmAllowedOrigins();
  const allowedModels = customBgmAllowedModels();
  return {
    openai: Boolean((process.env.OPENAI_API_KEY || "").trim()) || databaseReady("openai"),
    gemini: Boolean(backendGemini?.apiKey) || databaseReady("gemini"),
    deepseek: Boolean((process.env.DEEPSEEK_API_KEY || "").trim()) || databaseReady("deepseek"),
    doubao: Boolean((process.env.DOUBAO_API_KEY || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY || "").trim()) || databaseReady("doubao"),
    minimax: Boolean((process.env.MINIMAX_API_KEY || "").trim()) || databaseReady("minimax"),
    kie: databaseReady("kie"),
    llamacpp: databaseReady("llamacpp"),
    customBgm: {
      ...customBgm,
      allowedOriginsConfigured: allowedOrigins.length > 0,
      allowedOriginCount: allowedOrigins.length,
      allowedModelCount: allowedModels.length,
    },
  };
};
