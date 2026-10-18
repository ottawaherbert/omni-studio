import type { Express, Response } from "express";

import { dbHelpers } from "../db";

export interface SystemRoutesOptions {
  mediaAssetsDir: string;
}

const sendSystemRouteError = (res: Response, err: unknown, fallback: string) => {
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

export const registerSystemRoutes = (app: Express, { mediaAssetsDir }: SystemRoutesOptions) => {
  app.get("/api/system/gc", (_req, res) => {
    try { res.json({ success: true, files: dbHelpers.previewUnusedMedia(mediaAssetsDir) }); }
    catch (err) { sendSystemRouteError(res, err, "无法完整扫描素材，本次不会移动文件"); }
  });
  app.post("/api/system/gc/restore", (_req, res) => {
    try { res.json({ success: true, message: `已恢复 ${dbHelpers.restoreRecycledMedia(mediaAssetsDir)} 个文件，已有文件不会被覆盖。` }); }
    catch (err) { sendSystemRouteError(res, err, "恢复未全部完成，回收区中的文件仍然保留"); }
  });
  app.post("/api/system/gc", async (_req, res) => {
    try {
      const deletedCount = await dbHelpers.garbageCollectMedia(mediaAssetsDir);
      res.json({ success: true, message: `已将 ${deletedCount} 个未使用文件移入回收区，可随时恢复。` });
    } catch (err) {
      sendSystemRouteError(res, err, "Failed to run Garbage Collection");
    }
  });

  app.post("/api/system/backup", async (_req, res) => {
    try {
      const isSuccess = dbHelpers.backupDatabase();
      if (!isSuccess) return res.status(500).json({ error: "Failed to initiate backup." });
      return res.json({ success: true, message: "Backup initiated." });
    } catch (err) {
      return sendSystemRouteError(res, err, "Failed to run backup");
    }
  });
};
