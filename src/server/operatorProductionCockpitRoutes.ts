import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  readProductionCockpitForAccess,
  type OperatorProductionCockpitStore,
} from "../services/operator/productionCockpitUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorProductionCockpitRoutesOptions {
  store: OperatorProductionCockpitStore;
  access: OperatorArtifactAccess;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorCockpitError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
  return res.status(Number(err?.statusCode || 500)).json({ error: err?.message || fallback });
};

export const registerOperatorProductionCockpitRoutes = (
  app: Express,
  { store, access, sendSecurityError }: OperatorProductionCockpitRoutesOptions,
) => {
  app.get("/api/operator/projects/:projectId/production-cockpit", async (req, res) => {
    try {
      res.json(readProductionCockpitForAccess(store, access, {
        projectId: req.params.projectId,
        input: req.query || {},
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator production cockpit Error:", err);
      sendOperatorCockpitError(res, err, "Failed to build production cockpit");
    }
  });
};
