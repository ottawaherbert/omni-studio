import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  createStoryboardStrategyPromotionForProject,
  createStoryboardStrategyTrialForProject,
  type OperatorStoryboardStrategyStore,
} from "../services/operator/storyboardStrategyUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorStoryboardStrategyRoutesOptions {
  store: OperatorStoryboardStrategyStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorStoryboardStrategyError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code,
      ...(err.payload && typeof err.payload === "object" ? err.payload : {}),
    });
  }
  return res.status(Number(err?.statusCode || 500)).json({ error: err?.message || fallback });
};

export const registerOperatorStoryboardStrategyRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorStoryboardStrategyRoutesOptions,
) => {
  app.post("/api/operator/projects/:projectId/storyboard-strategy-trials", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createStoryboardStrategyTrialForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator storyboard strategy trial Error:", err);
      sendOperatorStoryboardStrategyError(res, err, "Failed to create storyboard strategy draft trial");
    }
  });

  app.post("/api/operator/projects/:projectId/storyboard-strategy-promotions", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createStoryboardStrategyPromotionForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator storyboard strategy promotion Error:", err);
      sendOperatorStoryboardStrategyError(res, err, "Failed to create storyboard strategy promotion candidate");
    }
  });
};
