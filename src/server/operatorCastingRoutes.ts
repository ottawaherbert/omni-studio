import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  createCastingCandidatesForProject,
  createCastingDecisionForProject,
  createRoleSlotsForProject,
  type OperatorCastingStore,
} from "../services/operator/castingUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorCastingRoutesOptions {
  store: OperatorCastingStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorCastingError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({
      error: err.message,
      code: err.code,
      ...(err.payload && typeof err.payload === "object" ? err.payload : {}),
    });
  }
  return res.status(500).json({ error: err?.message || fallback });
};

export const registerOperatorCastingRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorCastingRoutesOptions,
) => {
  app.post("/api/operator/projects/:projectId/role-slots", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createRoleSlotsForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator role slots create Error:", err);
      sendOperatorCastingError(res, err, "Failed to create role slots");
    }
  });

  app.post("/api/operator/projects/:projectId/casting-candidates", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createCastingCandidatesForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator casting candidates create Error:", err);
      sendOperatorCastingError(res, err, "Failed to create casting candidates");
    }
  });

  app.post("/api/operator/projects/:projectId/casting-decisions", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createCastingDecisionForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator casting decision create Error:", err);
      sendOperatorCastingError(res, err, "Failed to create casting decision");
    }
  });
};
