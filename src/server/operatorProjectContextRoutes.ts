import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  readAssetContinuityForAccess,
  readLongFormMemoryForAccess,
  readOperatorProjectContextForAccess,
  type OperatorProjectContextStore,
} from "../services/operator/projectContextUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorProjectContextRoutesOptions {
  store: OperatorProjectContextStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorProjectContextError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: err?.message || fallback });
};

export const registerOperatorProjectContextRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorProjectContextRoutesOptions,
) => {
  app.get("/api/operator/projects/:projectId/context", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(readOperatorProjectContextForAccess(store, access, {
        projectId: req.params.projectId,
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator context Error:", err);
      sendOperatorProjectContextError(res, err, "Failed to build operator project context");
    }
  });

  app.get("/api/operator/projects/:projectId/long-form-memory", async (req, res) => {
    try {
      res.json(readLongFormMemoryForAccess(store, access, {
        projectId: req.params.projectId,
        episodeIds: req.query.episodeIds,
        profile: req.query.profile,
        windowSize: req.query.windowSize,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator long-form memory Error:", err);
      sendOperatorProjectContextError(res, err, "Failed to build operator long-form memory");
    }
  });

  app.get("/api/operator/projects/:projectId/asset-continuity", async (req, res) => {
    try {
      res.json(readAssetContinuityForAccess(store, access, {
        projectId: req.params.projectId,
        profile: req.query.profile,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator asset continuity Error:", err);
      sendOperatorProjectContextError(res, err, "Failed to build operator asset continuity");
    }
  });
};
