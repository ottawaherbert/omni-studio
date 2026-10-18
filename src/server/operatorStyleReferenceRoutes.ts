import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  createStyleLockChangeOrderForProject,
  createStyleReferenceAnalysisForProject,
  type OperatorStyleReferenceStore,
} from "../services/operator/styleReferenceUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorStyleReferenceRoutesOptions {
  store: OperatorStyleReferenceStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorStyleError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code,
      ...(err.payload && typeof err.payload === "object" ? err.payload : {}),
    });
  }
  return res.status(500).json({ error: err?.message || fallback });
};

export const registerOperatorStyleReferenceRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorStyleReferenceRoutesOptions,
) => {
  app.post("/api/operator/projects/:projectId/style-reference-analysis", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createStyleReferenceAnalysisForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator style reference analysis Error:", err);
      sendOperatorStyleError(res, err, "Failed to create style reference analysis");
    }
  });

  app.post("/api/operator/projects/:projectId/style-lock-change-orders", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createStyleLockChangeOrderForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator style lock change order Error:", err);
      sendOperatorStyleError(res, err, "Failed to create style lock change order");
    }
  });
};
