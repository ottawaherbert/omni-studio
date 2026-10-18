import type { Express } from "express";

import {
  createCreativeChangeForProject,
  listCreativeChangesForProject,
  OperatorCreativeChangeUseCaseError,
  updateCreativeChangeForProject,
  type OperatorCreativeChangeStore,
} from "../services/operator/creativeChangeUseCases";
import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";

export interface OperatorCreativeChangeRoutesOptions {
  store: OperatorCreativeChangeStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorCreativeChangeError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorCreativeChangeUseCaseError || err?.name === "OperatorCreativeChangeUseCaseError") {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code,
    });
  }
  return res.status(500).json({ error: err?.message || fallback });
};

export const registerOperatorCreativeChangeRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorCreativeChangeRoutesOptions,
) => {
  app.get("/api/operator/projects/:projectId/creative-changes", async (req, res) => {
    try {
      res.json(listCreativeChangesForProject(store, access, req.params.projectId));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator creative changes list Error:", err);
      sendOperatorCreativeChangeError(res, err, "Failed to list creative changes");
    }
  });

  app.post("/api/operator/projects/:projectId/creative-changes", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createCreativeChangeForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator creative change create Error:", err);
      sendOperatorCreativeChangeError(res, err, "Failed to create creative change request");
    }
  });

  app.patch("/api/operator/projects/:projectId/creative-changes/:artifactId", async (req, res) => {
    try {
      res.json(updateCreativeChangeForProject(store, access, {
        projectId: req.params.projectId,
        artifactId: req.params.artifactId,
        input: req.body || {},
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator creative change update Error:", err);
      sendOperatorCreativeChangeError(res, err, "Failed to update creative change request");
    }
  });
};
