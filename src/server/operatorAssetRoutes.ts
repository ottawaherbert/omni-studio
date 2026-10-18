import type { Express } from "express";

import {
  listOperatorAssetsForAccess,
  OperatorAssetUseCaseError,
  registerOperatorAssetForAccess,
  reviewOperatorStoryboardAssetForAccess,
  type OperatorAssetStore,
} from "../services/operator/assetUseCases";
import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";

export interface OperatorAssetRoutesOptions {
  store: OperatorAssetStore;
  access: OperatorArtifactAccess;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorAssetError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorAssetUseCaseError || err?.name === "OperatorAssetUseCaseError") {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code,
    });
  }
  return res.status(500).json({ error: err?.message || fallback });
};

export const registerOperatorAssetRoutes = (
  app: Express,
  { store, access, sendSecurityError }: OperatorAssetRoutesOptions,
) => {
  app.get("/api/operator/assets", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
      const artifactId = typeof req.query.artifactId === "string" ? req.query.artifactId : undefined;
      res.json(listOperatorAssetsForAccess(store, access, { projectId, runId, artifactId }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator assets list Error:", err);
      sendOperatorAssetError(res, err, "Failed to list operator assets");
    }
  });

  app.post("/api/operator/assets", async (req, res) => {
    try {
      res.json(registerOperatorAssetForAccess(store, access, req.body || {}));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator asset register Error:", err);
      sendOperatorAssetError(res, err, "Failed to register operator asset");
    }
  });

  app.post("/api/operator/projects/:projectId/assets/:assetId/:decision", async (req, res) => {
    try {
      if (req.params.decision !== "adopt" && req.params.decision !== "discard") {
        return res.status(400).json({ error: "Unsupported storyboard candidate decision" });
      }
      res.json(reviewOperatorStoryboardAssetForAccess(store, access, {
        projectId: req.params.projectId,
        assetId: req.params.assetId,
        decision: req.params.decision as "adopt" | "discard",
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator storyboard asset review Error:", err);
      sendOperatorAssetError(res, err, "Failed to review storyboard media candidate");
    }
  });
};
