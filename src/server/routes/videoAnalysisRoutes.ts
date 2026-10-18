import type { Express, Response } from "express";

import { dbHelpers } from "../db";

const sendVideoAnalysisRouteError = (res: Response, err: unknown, fallback: string) => {
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

const positiveInteger = (value: unknown, fallback: number) => {
  const parsed = parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const registerVideoAnalysisRoutes = (app: Express) => {
  app.get("/api/video-analysis/projects", async (req, res) => {
    try {
      const page = positiveInteger(req.query.page, 1);
      const limit = positiveInteger(req.query.limit, 10);
      const search = String(req.query.search || "");
      res.json(dbHelpers.getVideoAnalysisProjects(page, limit, search));
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to read video analysis projects from DB");
    }
  });

  app.post("/api/video-analysis/projects", async (req, res) => {
    try {
      const project = { ...(req.body || {}) };
      project.id = project.id || `vap_${Date.now()}`;
      project.segments = project.segments || [];
      res.json(dbHelpers.saveVideoAnalysisProject(project));
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to save video analysis project to DB");
    }
  });

  app.put("/api/video-analysis/projects/:id", async (req, res) => {
    try {
      const project = { ...(req.body || {}), id: req.params.id };
      res.json(dbHelpers.saveVideoAnalysisProject(project));
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to update video analysis project in DB");
    }
  });

  app.delete("/api/video-analysis/projects/:id", async (req, res) => {
    try {
      dbHelpers.deleteVideoAnalysisProject(req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to delete video analysis project from DB");
    }
  });

  app.post("/api/video-analysis/projects/:id/segments", async (req, res) => {
    try {
      const segment = { ...(req.body || {}) };
      segment.id = segment.id || `vas_${Date.now()}`;
      dbHelpers.addVideoAnalysisSegment(req.params.id, segment);
      res.json(segment);
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to add segment");
    }
  });

  app.put("/api/video-analysis/projects/:id/segments/:segmentId", async (req, res) => {
    try {
      const segment = { ...(req.body || {}), id: req.params.segmentId };
      dbHelpers.updateVideoAnalysisSegment(req.params.id, segment);
      res.json(segment);
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to update segment");
    }
  });

  app.delete("/api/video-analysis/projects/:id/segments/:segmentId", async (req, res) => {
    try {
      dbHelpers.deleteVideoAnalysisSegment(req.params.id, req.params.segmentId);
      res.json({ success: true });
    } catch (err) {
      sendVideoAnalysisRouteError(res, err, "Failed to delete segment");
    }
  });
};
