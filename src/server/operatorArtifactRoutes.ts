import type { Express } from "express";

import {
  commitOperatorArtifactForAccess,
  createOperatorDraftArtifactForAccess,
  listOperatorArtifactsForAccess,
  OperatorArtifactUseCaseError,
  readOperatorArtifactForAccess,
  runOperatorArtifactQAForAccess,
  type OperatorArtifactAccess,
  type OperatorArtifactStore,
} from "../services/operator/artifactUseCases";

export interface OperatorArtifactRoutesOptions {
  store: OperatorArtifactStore;
  access: OperatorArtifactAccess;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorArtifactError = (res: any, err: any, fallback: string, defaultStatus = 500) => {
  if (err instanceof OperatorArtifactUseCaseError || err?.name === "OperatorArtifactUseCaseError") {
    return res.status(err.statusCode || defaultStatus).json({
      error: err.message,
      code: err.code,
    });
  }
  return res.status(defaultStatus).json({ error: err?.message || fallback });
};

export const registerOperatorArtifactRoutes = (
  app: Express,
  { store, access, sendSecurityError }: OperatorArtifactRoutesOptions,
) => {
  app.get("/api/operator/artifacts", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      const runId = typeof req.query.runId === "string" ? req.query.runId : undefined;
      res.json(listOperatorArtifactsForAccess(store, access, { projectId, runId }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator artifacts list Error:", err);
      sendOperatorArtifactError(res, err, "Failed to list operator artifacts");
    }
  });

  app.get("/api/operator/artifacts/:artifactId", async (req, res) => {
    try {
      res.json(readOperatorArtifactForAccess(store, access, req.params.artifactId));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator artifact read Error:", err);
      sendOperatorArtifactError(res, err, "Failed to read operator artifact");
    }
  });

  app.post("/api/operator/artifacts/draft", async (req, res) => {
    try {
      res.json(createOperatorDraftArtifactForAccess(store, access, req.body || {}));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator artifact draft Error:", err);
      sendOperatorArtifactError(res, err, "Failed to create operator draft artifact");
    }
  });

  app.post("/api/operator/artifacts/:artifactId/qa", async (req, res) => {
    try {
      res.json(runOperatorArtifactQAForAccess(store, access, req.params.artifactId, req.body || {}));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator artifact QA Error:", err);
      sendOperatorArtifactError(res, err, "Failed to append operator artifact QA");
    }
  });

  app.post("/api/operator/artifacts/:artifactId/commit", async (req, res) => {
    try {
      res.json(commitOperatorArtifactForAccess(store, access, req.params.artifactId));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator artifact commit Error:", err);
      sendOperatorArtifactError(res, err, "Failed to commit operator artifact", 400);
    }
  });
};
