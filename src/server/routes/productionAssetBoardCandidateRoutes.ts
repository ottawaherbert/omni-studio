import type { Express, Response } from "express";

import {
  adoptProductionAssetBoardReferenceCandidate,
  discardProductionAssetBoardReferenceCandidate,
  stageProductionAssetBoardReferenceCandidate,
} from "../../services/production/productionAssetBoardCandidate";
import { dbHelpers } from "../db";

const sendCandidateRouteError = (res: Response, err: unknown, fallback: string) => {
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

export const registerProductionAssetBoardCandidateRoutes = (app: Express) => {
  app.post("/api/projects/:id/production-asset-board-candidates", async (req, res) => {
    try {
      const project = dbHelpers.getProjectById(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found in DB" });
      const updates = stageProductionAssetBoardReferenceCandidate({
        project,
        ...(req.body || {}),
      });
      return res.json(dbHelpers.updateProjectMeta(req.params.id, updates));
    } catch (err) {
      return sendCandidateRouteError(res, err, "Failed to stage production asset board candidate");
    }
  });

  app.post("/api/projects/:id/production-asset-board-candidates/:candidateId/adopt", async (req, res) => {
    try {
      const project = dbHelpers.getProjectById(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found in DB" });
      const updates = adoptProductionAssetBoardReferenceCandidate({
        project,
        candidateId: req.params.candidateId,
      });
      const saved = dbHelpers.transaction(() => {
        const adoptedAt = Date.now();
        const savedProject = dbHelpers.updateProjectMeta(req.params.id, updates);
        for (const asset of dbHelpers.listOperatorAssets({ projectId: req.params.id })) {
          if (asset.metadata?.candidateId !== req.params.candidateId) continue;
          dbHelpers.saveOperatorAsset({
            ...asset,
            metadata: { ...asset.metadata, adoptionStatus: "adopted", adoptedAt },
            updatedAt: adoptedAt,
          });
        }
        return savedProject;
      });
      return res.json(saved);
    } catch (err) {
      return sendCandidateRouteError(res, err, "Failed to adopt production asset board candidate");
    }
  });

  app.delete("/api/projects/:id/production-asset-board-candidates/:candidateId", async (req, res) => {
    try {
      const project = dbHelpers.getProjectById(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found in DB" });
      const updates = discardProductionAssetBoardReferenceCandidate({
        project,
        candidateId: req.params.candidateId,
      });
      const saved = dbHelpers.transaction(() => {
        const discardedAt = Date.now();
        const savedProject = dbHelpers.updateProjectMeta(req.params.id, updates);
        for (const asset of dbHelpers.listOperatorAssets({ projectId: req.params.id })) {
          if (asset.metadata?.candidateId !== req.params.candidateId) continue;
          dbHelpers.saveOperatorAsset({
            ...asset,
            metadata: { ...asset.metadata, adoptionStatus: "discarded", discardedAt },
            updatedAt: discardedAt,
          });
        }
        return savedProject;
      });
      return res.json(saved);
    } catch (err) {
      return sendCandidateRouteError(res, err, "Failed to discard production asset board candidate");
    }
  });
};
