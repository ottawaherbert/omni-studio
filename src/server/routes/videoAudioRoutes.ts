import type { Express } from "express";

import { readLocalMediaSource, readVideoSource, rewriteVideoAudio } from "../media/videoComposition";

export const registerVideoAudioRoutes = (app: Express, options: {
  mediaAssetsDir: string;
  normalizedProjectId: (value: unknown) => string | undefined;
  assertPublicRemoteUrl: (value: string) => Promise<URL>;
  saveVideo: (projectId: string | undefined, buffer: Buffer) => Promise<string>;
}) => {
  app.post("/api/assets/rewrite-video-audio", async (req, res) => {
    try {
      const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl.trim() : "";
      const mode = req.body?.mode === "replace" ? "replace" : req.body?.mode === "strip" ? "strip" : "";
      const replacementAudioUrl = typeof req.body?.replacementAudioUrl === "string"
        ? req.body.replacementAudioUrl.trim()
        : "";
      if (!videoUrl || !mode) return res.status(400).json({ error: "Missing videoUrl or mode" });
      if (mode === "replace" && !replacementAudioUrl) {
        return res.status(400).json({ error: "Replacement audio is required" });
      }
      const projectId = options.normalizedProjectId(req.body?.projectId);
      const video = await readVideoSource({
        sourceUrl: videoUrl,
        mediaAssetsDir: options.mediaAssetsDir,
        assertPublicRemoteUrl: options.assertPublicRemoteUrl,
      });
      const replacementAudio = replacementAudioUrl
        ? await readLocalMediaSource({
          sourceUrl: replacementAudioUrl,
          mediaAssetsDir: options.mediaAssetsDir,
          maximumBytes: 250 * 1024 * 1024,
        })
        : undefined;
      const output = await rewriteVideoAudio(video, replacementAudio);
      return res.json({ url: await options.saveVideo(projectId, output) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Video audio rewrite failed";
      console.error("Video audio rewrite error:", error);
      return res.status(400).json({ error: message });
    }
  });
};
