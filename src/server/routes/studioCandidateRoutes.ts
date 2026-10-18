import type { Express } from "express";
import { dbHelpers } from "../db";
import { appendShotTakeCandidate } from "../../services/production/shotTakeReview";
import type { Episode } from "../../types/project";

export const registerStudioCandidateRoutes = (app: Express) => {
  app.post("/api/projects/:id/episodes/:epId/scenes/:sceneId/studio-candidates", (req, res) => {
    try {
      const { shotId, boardId, take, draftPreview } = req.body || {};
      if (typeof shotId !== "string" || (!draftPreview && (!take?.id || !take?.createdAt))) {
        return res.status(400).json({ error: "缺少候选内容或目标镜头" });
      }
      const episode = dbHelpers.getEpisodeById(req.params.id, req.params.epId) as Episode | undefined;
      const scene = episode?.scenes?.find((item) => item.id === req.params.sceneId);
      const shot = scene?.shots?.find((item) => item.id === shotId);
      if (!episode || !scene || !shot) return res.status(404).json({ error: "原镜头已删除，无法将候选放回。生成的素材仍保留在磁盘中。" });
      if (draftPreview) {
        shot.draftPreview = draftPreview;
      } else if (boardId) {
        const board = scene.manualStoryboard?.boards?.find((item) => item.boardId === boardId || item.board?.id === boardId);
        if (!board) return res.status(404).json({ error: "原故事板已删除，生成素材仍保留" });
        board.takes = [...(board.takes || []).filter((item) => item.id !== take.id), take];
      } else {
        scene.shots = scene.shots.map((item) => item.id === shotId ? appendShotTakeCandidate(item, take) : item);
      }
      // Read and append without yielding; never write a stale browser scene snapshot.
      dbHelpers.updateEpisode(req.params.id, req.params.epId, episode);
      return res.json({ scene, episode: dbHelpers.getEpisodeById(req.params.id, req.params.epId) });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : "候选保存失败" });
    }
  });
};
