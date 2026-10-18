import fs from "fs/promises";
import path from "path";
import type { Express, Response } from "express";

import { defaultTemplates } from "../../config/prompts";
import { isPathSafe } from "./fileRouteUtils";

export interface PromptRoutesOptions {
  brainsDir: string;
}

const sendPromptRouteError = (res: Response, fallback: string) =>
  res.status(500).json({ error: fallback });

export const registerPromptRoutes = (app: Express, { brainsDir }: PromptRoutesOptions) => {
  app.get("/api/prompts/:name", async (req, res) => {
    const promptName = req.params.name;
    try {
      const fileName = `${promptName}.md`;
      if (!isPathSafe(brainsDir, fileName)) {
        return res.status(403).json({ error: "Access Denied: Path Traversal Detected" });
      }
      const content = await fs.readFile(path.join(brainsDir, fileName), "utf-8");
      return res.json({ content });
    } catch {
      const builtin = defaultTemplates[promptName];
      if (builtin?.template) return res.json({ content: builtin.template, source: "builtin" });
      return res.status(404).json({ error: "Prompt not found" });
    }
  });

  app.put("/api/prompts/:name", async (req, res) => {
    try {
      const fileName = `${req.params.name}.md`;
      if (!isPathSafe(brainsDir, fileName)) {
        return res.status(403).json({ error: "Access Denied: Path Traversal Detected" });
      }
      const filePath = path.join(brainsDir, fileName);
      try {
        const oldContent = await fs.readFile(filePath, "utf-8");
        await fs.writeFile(`${filePath}.bak`, oldContent);
      } catch {
        // No previous prompt file to back up.
      }
      await fs.writeFile(filePath, req.body?.content || "");
      return res.json({ success: true });
    } catch {
      return sendPromptRouteError(res, "Failed to update prompt");
    }
  });
};
