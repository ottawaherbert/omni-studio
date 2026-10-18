import type { Express, Response } from "express";

import { dbHelpers } from "../db";
import {
  createDefaultStyleVariantPolicy,
  createDefaultTargetScale,
  resolveProductionLockStrategy,
  resolveProductionMode,
} from "../../services/production/productionMode";
import { registerProductionAssetBoardCandidateRoutes } from "./productionAssetBoardCandidateRoutes";
import { registerStudioCandidateRoutes } from "./studioCandidateRoutes";

const sendLegacyRouteError = (res: Response, err: unknown, fallback: string) => {
  if ((err as { statusCode?: number })?.statusCode === 409) {
    return res.status(409).json({ error: err instanceof Error ? err.message : "内容归属冲突，原内容未被修改。" });
  }
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

const withProjectProductionDefaults = (rawProject: any) => {
  const project = { ...(rawProject || {}) };
  project.productionMode = project.productionMode || resolveProductionMode(project);
  project.lockStrategy = project.lockStrategy || resolveProductionLockStrategy(project);
  project.targetScale = project.targetScale || createDefaultTargetScale(project);
  project.styleVariantPolicy = project.styleVariantPolicy || createDefaultStyleVariantPolicy(project);
  return project;
};

export const registerLegacyProjectRoutes = (app: Express) => {
  app.get("/api/projects", async (req, res) => {
    try {
      // Project lists are global shell data and must never pull every episode,
      // scene, shot, media payload and audit body. Deep legacy reads remain
      // available only through an explicit compatibility view.
      res.json(req.query.view === "full"
        ? dbHelpers.getAllProjects()
        : dbHelpers.getProjectSummaries());
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to read projects from DB");
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const project = withProjectProductionDefaults(req.body);
      project.id = project.id || Date.now().toString();
      if (dbHelpers.getProjectShellById(project.id)) return res.status(409).json({ error: "项目标识已存在，请重新读取项目后保存。" });
      res.json(dbHelpers.saveProject(project));
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to save project to DB");
    }
  });

  app.get("/api/projects/:id", async (req, res) => {
    try {
      const project = req.query.view === "production-workspace"
        ? dbHelpers.getProductionWorkspaceProjectShellById(req.params.id, typeof req.query.sourceDocumentId === "string" ? req.query.sourceDocumentId : undefined)
        : req.query.view === "shell"
          ? dbHelpers.getProjectShellById(req.params.id, typeof req.query.sourceDocumentId === "string" ? req.query.sourceDocumentId : undefined)
          : dbHelpers.getProjectById(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found in DB" });
      return res.json(project);
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to load project from DB");
    }
  });

  app.get("/api/projects/:id/script-units/:sourceDocumentId", async (req, res) => {
    try {
      const unit = dbHelpers.getProductionScriptUnitBySourceDocumentId(req.params.id, req.params.sourceDocumentId);
      if (!unit) return res.status(404).json({ error: "Production script unit not found" });
      return res.json(unit);
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to load production script unit");
    }
  });

  app.get("/api/projects/:id/script-workspace", async (req, res) => {
    try {
      const workspace = dbHelpers.getProductionScriptWorkspace(req.params.id);
      if (!workspace) return res.status(404).json({ error: "Production script workspace not found" });
      return res.json(workspace);
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to load production script workspace");
    }
  });


  app.get("/api/projects/:id/episodes/:epId", async (req, res) => {
    try {
      const episode = dbHelpers.getEpisodeById(
        req.params.id,
        req.params.epId,
        typeof req.query.view === "string" ? req.query.view : undefined,
        typeof req.query.sceneId === "string" ? req.query.sceneId : undefined,
        typeof req.query.shotId === "string" ? req.query.shotId : undefined,
        req.query.scope === "episode",
      );
      if (!episode) return res.status(404).json({ error: "Episode not found" });
      return res.json(episode);
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to load episode");
    }
  });

  app.get("/api/projects/:id/manual-studio/prior-video-references", async (req, res) => {
    try {
      return res.json(dbHelpers.getManualStudioPriorVideoReferences(req.params.id));
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to load Manual Studio prior video references");
    }
  });

  app.get("/api/projects/:id/episodes/:epId/storyboard-team-context", async (req, res) => {
    try {
      const sceneId = typeof req.query.sceneId === "string" ? req.query.sceneId : "";
      if (!sceneId) return res.status(400).json({ error: "sceneId is required" });
      const context = dbHelpers.getStoryboardTeamPromptContext(
        req.params.id,
        req.params.epId,
        sceneId,
      );
      if (!context) return res.status(404).json({ error: "Episode not found" });
      return res.json(context);
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to load Storyboard team context");
    }
  });

  app.put("/api/projects/:id", async (req, res) => {
    try {
      const project = withProjectProductionDefaults(req.body);
      project.id = req.params.id;
      project.__requireProductionRevision = true;
      res.json(dbHelpers.saveProject(project));
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 409) {
        return res.status(409).json({ error: err instanceof Error ? err.message : "正式剧本已被更新" });
      }
      sendLegacyRouteError(res, err, "Failed to update project in DB");
    }
  });

  app.put("/api/projects/:id/appearance-snapshot", (req, res) => {
    const { project, episodes } = req.body || {};
    if (project?.id !== req.params.id || !Array.isArray(episodes) || !episodes.length || episodes.some((episode: any) => !episode?.id || !Array.isArray(episode.scenes))) return res.status(400).json({ error: 'Invalid appearance snapshot' });
    try {
      const result = dbHelpers.transaction(() => {
        // A scene snapshot and its generated state assets must commit together.
        const updated = dbHelpers.updateProjectMeta(req.params.id, project);
        const savedEpisodes = episodes.map((episode: any) => dbHelpers.updateEpisode(req.params.id, episode.id, {
          ...episode,
          __requireProductionRevision: true,
        }));
        return { ...updated, __savedEpisodeRevisions: Object.fromEntries(savedEpisodes.map((episode: any) => [episode.id, episode.productionRevision])) };
      });
      return res.json(result);
    } catch (err) { return sendLegacyRouteError(res, err, 'Failed to save appearance snapshot'); }
  });

  app.patch("/api/projects/:id", async (req, res) => {
    try {
      const project = { ...(req.body || {}), id: req.params.id };
      res.json(dbHelpers.updateProjectMeta(req.params.id, project));
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 409) {
        return res.status(409).json({ error: err instanceof Error ? err.message : "正式剧本已被更新" });
      }
      sendLegacyRouteError(res, err, "Failed to update project patch in DB");
    }
  });

  registerProductionAssetBoardCandidateRoutes(app);
  registerStudioCandidateRoutes(app);

  app.put("/api/projects/:id/episodes/:epId", async (req, res) => {
    try {
      const episode = { ...(req.body || {}), id: req.params.epId, __requireProductionRevision: true };
      res.json(dbHelpers.updateEpisode(req.params.id, req.params.epId, episode));
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to update episode in DB");
    }
  });

  app.delete("/api/projects/:id/episodes/:epId", async (req, res) => {
    try {
      dbHelpers.deleteEpisode(req.params.id, req.params.epId);
      res.json({ success: true });
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to delete episode");
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      dbHelpers.deleteProject(req.params.id);
      res.json({ success: true });
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to delete project from DB");
    }
  });

  app.get("/api/production-runs", async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
      res.json(dbHelpers.listProductionRuns(projectId));
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to list production runs");
    }
  });

  app.get("/api/production-runs/:runId", async (req, res) => {
    try {
      const run = dbHelpers.getProductionRunById(req.params.runId);
      if (!run) return res.status(404).json({ error: "Production run not found" });
      return res.json(run);
    } catch (err) {
      return sendLegacyRouteError(res, err, "Failed to get production run");
    }
  });

  app.put("/api/production-runs/:runId", async (req, res) => {
    try {
      const run = { ...(req.body || {}), id: req.params.runId };
      const baseRevision = Number(req.header("X-Production-Run-Base-Revision"));
      if (Number.isFinite(baseRevision)) run.__baseRevision = baseRevision;
      res.json(dbHelpers.saveProductionRun(run));
    } catch (err: any) {
      if (err?.statusCode === 409) {
        return res.status(409).json({ error: "Production run save conflict", serverRun: err.serverRun });
      }
      return sendLegacyRouteError(res, err, "Failed to save production run");
    }
  });

  app.delete("/api/production-runs/:runId", async (req, res) => {
    try {
      dbHelpers.deleteProductionRun(req.params.runId);
      res.json({ success: true });
    } catch (err) {
      sendLegacyRouteError(res, err, "Failed to delete production run");
    }
  });
};
