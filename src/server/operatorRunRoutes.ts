import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  appendOperatorRunEventForAccess,
  createOperatorRunForAccess,
  listOperatorRunsForAccess,
  readOperatorRunForAccess,
  updateOperatorRunForAccess,
  type OperatorRunStore,
} from "../services/operator/runUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorRunRoutesOptions {
  store: OperatorRunStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorRunError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
  return res.status(500).json({ error: err?.message || fallback });
};

export const registerOperatorRunRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorRunRoutesOptions,
) => {
  app.get("/api/operator/runs", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      res.json(listOperatorRunsForAccess(store, access, projectId));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator runs list Error:", err);
      sendOperatorRunError(res, err, "Failed to list operator runs");
    }
  });

  app.get("/api/operator/runs/:runId", async (req, res) => {
    try {
      res.json(readOperatorRunForAccess(store, access, req.params.runId));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator run read Error:", err);
      sendOperatorRunError(res, err, "Failed to read operator run");
    }
  });

  app.post("/api/operator/runs", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createOperatorRunForAccess(store, access, req.body || {}, handbook.handbookVersion));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator run create Error:", err);
      sendOperatorRunError(res, err, "Failed to create operator run");
    }
  });

  app.patch("/api/operator/runs/:runId", async (req, res) => {
    try {
      res.json(updateOperatorRunForAccess(store, access, req.params.runId, req.body || {}));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator run patch Error:", err);
      sendOperatorRunError(res, err, "Failed to patch operator run");
    }
  });

  app.post("/api/operator/runs/:runId/events", async (req, res) => {
    try {
      res.json(appendOperatorRunEventForAccess(store, access, req.params.runId, req.body || {}));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator run event Error:", err);
      sendOperatorRunError(res, err, "Failed to append operator run event");
    }
  });
};
