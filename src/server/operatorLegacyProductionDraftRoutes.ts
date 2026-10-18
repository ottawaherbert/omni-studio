import type { Express } from "express";

import type { OperatorArtifactAccess } from "../services/operator/artifactUseCases";
import {
  createLegacyProductionDraftForProject,
  type OperatorLegacyProductionDraftStore,
} from "../services/operator/legacyProductionDraftUseCases";
import { OperatorUseCaseError } from "../services/operator/useCaseShared";

export interface OperatorLegacyProductionDraftRoutesOptions {
  store: OperatorLegacyProductionDraftStore;
  access: OperatorArtifactAccess;
  readOperatorHandbook: () => Promise<{ handbookVersion: string }>;
  sendSecurityError: (res: any, err: any) => unknown;
}

const sendOperatorLegacyDraftError = (res: any, err: any, fallback: string) => {
  if (err instanceof OperatorUseCaseError || err?.name === "OperatorUseCaseError") {
    return res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
  return res.status(Number(err?.statusCode || 500)).json({ error: err?.message || fallback });
};

export const registerOperatorLegacyProductionDraftRoutes = (
  app: Express,
  { store, access, readOperatorHandbook, sendSecurityError }: OperatorLegacyProductionDraftRoutesOptions,
) => {
  app.post("/api/operator/projects/:projectId/legacy-production-draft", async (req, res) => {
    try {
      const handbook = await readOperatorHandbook();
      res.json(createLegacyProductionDraftForProject(store, access, {
        projectId: req.params.projectId,
        input: req.body || {},
        handbookVersion: handbook.handbookVersion,
        environment: req.query.environment,
      }));
    } catch (err: any) {
      if (sendSecurityError(res, err)) return;
      console.error("Operator legacy production draft Error:", err);
      sendOperatorLegacyDraftError(res, err, "Failed to create legacy production draft");
    }
  });
};
