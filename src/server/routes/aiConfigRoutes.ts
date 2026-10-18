import type { Express, Response } from "express";

import { dbHelpers } from "../db";

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
      res.json(dbHelpers.getAIConfig());
    } catch (err) {
      sendAiConfigRouteError(res, err, "Failed to read AI config from DB");
    }
  });

  app.put("/api/ai-config", (req, res) => {
    try {
      res.json(dbHelpers.saveAIConfig(req.body || {}));
    } catch (err) {
      sendAiConfigRouteError(res, err, "Failed to save AI config to DB");
    }
  });
};
