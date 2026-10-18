import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  runOperatorQAForAccess,
  type OperatorQAStore,
} from "../services/operator/qaUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorQARoutesOptions {
  store: OperatorQAStore;
  access: OperatorArtifactAccess;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorQAError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
  return res.status(Number(err?.statusCode || 500)).json({ error: err?.message || fallback });
};

export const registerOperatorQARoutes = (
  app: Express,
  { store, access, sendSecurityError }: OperatorQARoutesOptions,
) => {
  app.post("/api/operator/qa/:check", async (req, res) => {
    try {
      res.json(runOperatorQAForAccess(store, access, {
        input: req.body || {},
        checkFromParams: req.params.check,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator QA Error:", err);
      sendOperatorQAError(res, err, "Failed to run operator QA");
    }
  });

  app.post("/api/operator/projects/:projectId/qa/:check", async (req, res) => {
    try {
      res.json(runOperatorQAForAccess(store, access, {
        projectIdFromParams: req.params.projectId,
        input: req.body || {},
        checkFromParams: req.params.check,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator QA Error:", err);
      sendOperatorQAError(res, err, "Failed to run operator QA");
    }
  });
};
