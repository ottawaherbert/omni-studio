import type { Express, Response } from "express";
import { registerSpeechRoutes } from './speechRoutes';
import { registerComfyUIH3VideoRoute } from "../providers/comfyUIH3Video";
import { registerKieGrokVideoRoute } from "../providers/kieGrokVideo";
import { registerKieGrokImageRoute } from "../providers/kieGrokImage";
import { registerMiniMaxH3VideoRoute } from "../providers/minimaxH3Video";
import {
  DEFAULT_CUSTOM_BGM_MODEL_ID,
  hashProxyBody,
  normalizeCustomBgmModelId,
  normalizeCustomBgmProviderUrl,
  normalizeOpenAICompatibleBaseUrl,
  parseProviderText,
  providerExceptionPayload,
  providerFailurePayload,
  providerFailureSummary,
  proxyErrorSummary,
  resolveCustomBgmApiKey,
  resolveGeminiProxyClient,
  resolveMiniMaxApiKey,
  resolveOpenAICompatibleApiKey,
} from "./providerProxyUtils";
import { registerOpenAICompatibleProxyRoute } from "./openAICompatibleProxyRoute";
import { normalizeCredentialedProviderTarget, ProviderTargetPolicyError } from "./providerTargetPolicy";
const requestHeaderValue = (headers: unknown, name: string) => {
  if (!headers || typeof headers !== "object") return "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1] || "") : "";
};
const sendProviderTargetPolicyError = (res: Response, err: unknown) => err instanceof ProviderTargetPolicyError
  ? res.status(err.statusCode).json({ error: err.message })
  : null;
export const registerProviderProxyRoutes = (app: Express, options?: { mediaAssetsDir?: string }) => {
  if (options?.mediaAssetsDir) registerSpeechRoutes(app, { mediaAssetsDir: options.mediaAssetsDir });
  registerComfyUIH3VideoRoute(app, { mediaAssetsDir: options?.mediaAssetsDir });
  registerKieGrokVideoRoute(app);
  registerKieGrokImageRoute(app);
  registerMiniMaxH3VideoRoute(app);
  registerOpenAICompatibleProxyRoute(app);
  app.post("/api/proxy/doubao", async (req, res) => {
    try {
      const targetUrl = normalizeCredentialedProviderTarget("doubao", req.body.url, req.body.channelId);
      console.log("Doubao Proxy Call:", targetUrl.origin);
      const apiKey = resolveOpenAICompatibleApiKey(
        "doubao",
        requestHeaderValue(req.body.headers, "authorization"),
        req.body.channelId,
      );
      const finalBody = typeof req.body.rawBody === "string"
        ? req.body.rawBody
        : req.body.body !== undefined ? JSON.stringify(req.body.body) : undefined;
      console.log("Doubao Proxy Body metadata:", {
        length: finalBody ? finalBody.length : 0,
        sha256: hashProxyBody(finalBody),
      });
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": requestHeaderValue(req.body.headers, "content-type") || "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: finalBody,
        redirect: "error",
      });
      const text = await response.text();
      const data = parseProviderText(text);
      if (!response.ok) {
        console.warn("Doubao API Error:", providerFailureSummary(response.status, text));
        return res.status(response.status).json(providerFailurePayload("豆包供应商", response.status, text));
      }
      return res.status(response.status).json(data);
    } catch (err: any) {
      const policyResponse = sendProviderTargetPolicyError(res, err);
      if (policyResponse) return policyResponse;
      console.error("Doubao Proxy System Error:", proxyErrorSummary(err));
      const payload = providerExceptionPayload("豆包供应商", err);
      return res.status(payload.providerStatus || 502).json(payload);
    }
  });

  app.post("/api/proxy/minimax", async (req, res) => {
    try {
      const targetUrl = normalizeCredentialedProviderTarget("minimax", req.body.url, req.body.channelId);
      console.log("MiniMax Proxy Call:", targetUrl.origin);
      const requestKey = requestHeaderValue(req.body.headers, "x-api-key")
        || requestHeaderValue(req.body.headers, "authorization");
      const apiKey = resolveMiniMaxApiKey(requestKey, req.body.channelId);
      const response = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": requestHeaderValue(req.body.headers, "anthropic-version") || "2023-06-01",
          ...(apiKey ? { "x-api-key": apiKey, Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: req.body.body !== undefined ? JSON.stringify(req.body.body) : undefined,
        redirect: "error",
      });
      const text = await response.text();
      const data = parseProviderText(text);
      if (!response.ok) {
        console.warn("MiniMax API Error:", providerFailureSummary(response.status, text));
        return res.status(response.status).json(providerFailurePayload("MiniMax 供应商", response.status, text));
      }
      return res.status(response.status).json(data);
    } catch (err: any) {
      const policyResponse = sendProviderTargetPolicyError(res, err);
      if (policyResponse) return policyResponse;
      console.error("MiniMax Proxy Error:", proxyErrorSummary(err));
      const payload = providerExceptionPayload("MiniMax 供应商", err);
      return res.status(payload.providerStatus || 502).json(payload);
    }
  });

  app.post("/api/proxy/gemini", async (req, res) => {
    const geminiProxy = resolveGeminiProxyClient(req.body.apiKey, req.body.channelId);
    if (!geminiProxy) return res.status(500).json({ error: "Gemini API key is not configured on the server." });

    const { action, payload } = req.body;
    try {
      if (action === "generateImages") return res.json(await geminiProxy.client.models.generateImages(payload));
      if (action === "generateVideos") return res.json(await geminiProxy.client.models.generateVideos(payload));
      if (action === "getVideosOperation") return res.json(await geminiProxy.client.operations.getVideosOperation(payload));
      if (action === "downloadVideo") {
        const targetUrl = normalizeCredentialedProviderTarget("gemini", payload?.uri, req.body.channelId);
        const response = await fetch(targetUrl, {
          method: "GET",
          headers: { "x-goog-api-key": geminiProxy.apiKey },
          redirect: "error",
        });
        if (!response.ok) throw new Error(`Failed to download video: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        res.setHeader("Content-Type", "video/mp4");
        return res.send(Buffer.from(buffer));
      }
      if (action === "generateContent") return res.json(await geminiProxy.client.models.generateContent(payload));
      if (action === "generateContentStream") {
        const response = await geminiProxy.client.models.generateContentStream(payload);
        let audioBase64 = "";
        let mimeType = "audio/wav";
        for await (const chunk of response) {
          const parts = chunk.candidates?.[0]?.content?.parts;
          if (!parts) continue;
          for (const part of parts) {
            if (part.inlineData?.data) {
              if (!audioBase64 && part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
              audioBase64 += part.inlineData.data;
            }
          }
        }
        return res.json({ audioBase64, mimeType });
      }
      return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err: any) {
      const policyResponse = sendProviderTargetPolicyError(res, err);
      if (policyResponse) return policyResponse;
      console.error(`Gemini proxy error for action ${action}:`, proxyErrorSummary(err));
      const payload = providerExceptionPayload(`Gemini ${action}`, err);
      return res.status(payload.providerStatus || 502).json(payload);
    }
  });

  app.post("/api/proxy/openai-image", async (req, res) => {
    try {
      const baseUrl = normalizeOpenAICompatibleBaseUrl("openai", req.body.baseUrl, req.body.channelId);
      const apiKey = resolveOpenAICompatibleApiKey("openai", req.body.apiKey, req.body.channelId);
      if (!apiKey) return res.status(400).json({ error: "OpenAI API key is not configured." });
      const response = await fetch(`${baseUrl}/images/generations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(req.body.body || {}),
        redirect: "error",
      });
      const text = await response.text();
      const data = parseProviderText(text);
      if (!response.ok) {
        console.warn("OpenAI image provider error:", providerFailureSummary(response.status, text));
        return res.status(response.status).json(providerFailurePayload("OpenAI 图片供应商", response.status, text));
      }
      return res.status(response.status).json(data);
    } catch (err: any) {
      const policyResponse = sendProviderTargetPolicyError(res, err);
      if (policyResponse) return policyResponse;
      console.error("OpenAI image proxy error:", proxyErrorSummary(err));
      const payload = providerExceptionPayload("OpenAI 图片供应商", err);
      return res.status(payload.providerStatus || 502).json(payload);
    }
  });

  app.post("/api/proxy/custom-bgm", async (req, res) => {
    try {
      let url: string;
      let model: string;
      try {
        url = normalizeCustomBgmProviderUrl(req.body.url || "");
        model = normalizeCustomBgmModelId(req.body.model || DEFAULT_CUSTOM_BGM_MODEL_ID);
      } catch (err: any) {
        return res.status(400).json({ error: err?.message || "Invalid Custom BGM provider configuration." });
      }
      const keySource = req.body.keySource === "local" ? "local" : "serverEnv";
      let resolvedKey: ReturnType<typeof resolveCustomBgmApiKey>;
      try {
        resolvedKey = keySource === "local"
          ? { apiKey: (req.body.apiKey || "").trim().replace(/^Bearer\s+/i, ""), envName: "", source: "local" as const }
          : resolveCustomBgmApiKey("", req.body.apiKeyEnvName || "");
      } catch (err: any) {
        return res.status(400).json({ error: err?.message || "Invalid Custom BGM key configuration." });
      }
      if (!resolvedKey.apiKey) {
        return res.status(400).json({
          error: keySource === "local"
            ? "Custom BGM local API key is missing."
            : `Custom BGM server env key is missing for ${resolvedKey.envName}.`,
        });
      }

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resolvedKey.apiKey}` },
        body: JSON.stringify({ prompt: req.body.prompt || "", model }),
        redirect: "error",
      });
      const text = await response.text();
      const data = parseProviderText(text);
      if (!response.ok) {
        console.warn("Custom BGM provider error:", providerFailureSummary(response.status, text));
        return res.status(response.status).json(providerFailurePayload("自定义音乐供应商", response.status, text));
      }
      return res.status(response.status).json(data);
    } catch (err: any) {
      console.error("Custom BGM proxy error:", proxyErrorSummary(err));
      const payload = providerExceptionPayload("自定义音乐供应商", err);
      return res.status(payload.providerStatus || 502).json(payload);
    }
  });
};
