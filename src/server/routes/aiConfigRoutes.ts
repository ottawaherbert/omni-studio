import type { Express, Response } from "express";

import { dbHelpers } from "../db";
import { validateComfyTemplate } from '../../../packages/domain/src/comfyWorkflow';

export const COMFY_STORED_KEY = '__OMNI_STORED_COMFY_KEY__';
export const publicAIConfig = (payload: ReturnType<typeof dbHelpers.getAIConfig>) => ({
  ...payload,
  config: { ...payload.config, channels: payload.config.channels.map(channel => channel.type === 'comfyui'
    ? { ...channel, apiKey: channel.apiKey ? COMFY_STORED_KEY : '' } : channel),
    models: payload.config.models.map(model => payload.config.channels.some(c => c.id === model.channelId && c.type === 'comfyui')
      ? { ...model, apiKeyOverride: '' } : model) },
});

export interface AiConfigRoutesOptions {
  getProviderKeyStatus: (customBgmEnvName?: string) => unknown;
}

const sendAiConfigRouteError = (res: Response, err: unknown, fallback: string) => {
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

export const registerAiConfigRoutes = (app: Express, { getProviderKeyStatus }: AiConfigRoutesOptions) => {
  app.get("/api/provider-key-status", (req, res) => {
    const customBgmKeySlot = Array.isArray(req.query.customBgmKeySlot)
      ? req.query.customBgmKeySlot[0]
      : req.query.customBgmKeySlot;
    res.json(getProviderKeyStatus(typeof customBgmKeySlot === "string" ? customBgmKeySlot : undefined));
  });

  app.get("/api/ai-config", (_req, res) => {
    try {
      res.json(publicAIConfig(dbHelpers.getAIConfig()));
    } catch (err) {
      sendAiConfigRouteError(res, err, "Failed to read AI config from DB");
    }
  });

  app.put("/api/ai-config", (req, res) => {
    try {
      const input = req.body || {};
      const previous = dbHelpers.getAIConfig().config;
      for (const channel of input.channels || []) {
        if (channel.type === 'comfyui' && channel.apiKey === COMFY_STORED_KEY) {
          const stored = previous.channels.find(c => c.id === channel.id && c.type === 'comfyui');
          if (!stored) return res.status(400).json({ error: '凭证不存在，请重新填写 API Key。' });
          channel.apiKey = stored.apiKey;
        }
      }
      for (const workflow of input.comfyWorkflows || []) if (workflow.kind === 'api_graph' && workflow.enabled !== false) validateComfyTemplate(workflow);
      res.json(publicAIConfig(dbHelpers.saveAIConfig(input)));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : '保存 AI 配置失败' });
    }
  });
};
