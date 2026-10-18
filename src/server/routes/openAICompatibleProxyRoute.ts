import type { Express, Response } from "express";

import { parseOpenAICompatibleProviderText } from "./openAICompatibleEventStream";
import {
  type OpenAICompatibleProvider,
  normalizeOpenAICompatibleBaseUrl,
  providerExceptionPayload,
  providerFailurePayload,
  providerFailureSummary,
  proxyErrorSummary,
  resolveOpenAICompatibleApiKey,
} from "./providerProxyUtils";
import { ProviderTargetPolicyError } from "./providerTargetPolicy";

const isOpenAICompatibleProvider = (provider: string): provider is OpenAICompatibleProvider =>
  ["openai", "deepseek", "doubao", "kie", "llamacpp"].includes(provider);

const sendProviderTargetPolicyError = (res: Response, err: unknown) => err instanceof ProviderTargetPolicyError
  ? res.status(err.statusCode).json({ error: err.message })
  : null;

export const registerOpenAICompatibleProxyRoute = (app: Express) => {
  app.post("/api/proxy/openai-compatible", async (req, res) => {
    try {
      const provider = req.body.provider;
      if (!isOpenAICompatibleProvider(provider)) {
        return res.status(400).json({ error: "Unsupported OpenAI-compatible provider." });
      }
      const baseUrl = normalizeOpenAICompatibleBaseUrl(provider, req.body.baseUrl, req.body.channelId);
      const apiKey = resolveOpenAICompatibleApiKey(provider, req.body.apiKey, req.body.channelId);
      if (provider !== "llamacpp" && !apiKey) {
        return res.status(400).json({ error: `${provider} API key is not configured.` });
      }
      const maxAttempts = 3;
      let lastError: unknown = null;
      let lastResponse: any = null;
      let lastText = "";
      // 15 分钟超长超时，支持大体量长篇剧本、慢速推演与海量 token 输出
      const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const startTime = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

          const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(req.body.body || {}),
            redirect: "error",
            signal: controller.signal,
          });
          clearTimeout(timeout);

          const text = await response.text();
          lastResponse = response;
          lastText = text;

          // Check if response is ok
          if (response.ok) {
            // Check for embedded 500 error from proxies like Kie AI: {"code":500,"msg":"internal error..."}
            let embeddedError = false;
            try {
              const parsed = JSON.parse(text);
              if (parsed && (parsed.code === 500 || parsed.code === 502 || parsed.code === 503)) {
                embeddedError = true;
                console.warn(
                  `[OpenAI-proxy] Attempt ${attempt}/${maxAttempts} returned embedded ${parsed.code} (${Date.now() - startTime}ms):`,
                  parsed.msg || parsed.message || "internal error"
                );
              }
            } catch {
              // Not JSON, ignore
            }

            if (embeddedError) {
              if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
                continue;
              }
              return res.status(502).json(providerFailurePayload(`${provider} 供应商`, 502, text));
            }

            const data = parseOpenAICompatibleProviderText(text, response.headers.get("content-type"));
            return res.status(response.status).json(data);
          }

          // If upstream status is 5xx or 429, retry
          if ((response.status >= 500 || response.status === 429) && attempt < maxAttempts) {
            console.warn(`[OpenAI-proxy] Attempt ${attempt}/${maxAttempts} got HTTP ${response.status} (${Date.now() - startTime}ms), retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            continue;
          }

          console.warn("OpenAI-compatible provider error:", providerFailureSummary(response.status, text));
          return res.status(response.status).json(providerFailurePayload(`${provider} 供应商`, response.status, text));
        } catch (err: unknown) {
          lastError = err;
          const errorSummary = proxyErrorSummary(err);
          console.warn(`[OpenAI-proxy] Attempt ${attempt}/${maxAttempts} network failure (${Date.now() - startTime}ms):`, errorSummary);
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
            continue;
          }
        }
      }

      if (lastError) {
        throw lastError;
      }
      if (lastResponse && !lastResponse.ok) {
        return res.status(lastResponse.status).json(providerFailurePayload(`${provider} 供应商`, lastResponse.status, lastText));
      }
    } catch (err: any) {
      const policyResponse = sendProviderTargetPolicyError(res, err);
      if (policyResponse) return policyResponse;
      console.error("OpenAI-compatible proxy error:", proxyErrorSummary(err));
      const payload = providerExceptionPayload("OpenAI 兼容供应商", err);
      return res.status(payload.providerStatus || 502).json(payload);
    }
  });
};
