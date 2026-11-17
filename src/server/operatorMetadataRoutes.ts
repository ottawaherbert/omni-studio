import type { Express } from "express";
import fs from "fs/promises";
import path from "node:path";
import { OPERATOR_DOCUMENTS } from "../services/operator/documents";

import { extractOperatorHandbookVersion } from "../services/operator/context";
import { buildOperatorCapabilityManifest } from "../services/operator/capabilities";
import { buildOperatorWorkflowContract } from "../services/operator/workflowContract";
import {
  summarizeOperatorSecurityPolicy,
  type OperatorSecurityPolicy,
} from "../services/operator/security";

export interface OperatorMetadataRoutesOptions {
  operatorHandbookPath: string;
  operatorSecurityPolicy: OperatorSecurityPolicy;
}

export const readOperatorHandbookFromPath = async (operatorHandbookPath: string) => {
  const content = await fs.readFile(operatorHandbookPath, "utf-8");
  const stat = await fs.stat(operatorHandbookPath);
  return {
    handbookVersion: extractOperatorHandbookVersion(content),
    path: `doc/${path.basename(operatorHandbookPath)}`,
    updatedAt: Math.floor(stat.mtimeMs),
    content,
  };
};

export const registerOperatorMetadataRoutes = (
  app: Express,
  { operatorHandbookPath, operatorSecurityPolicy }: OperatorMetadataRoutesOptions,
) => {
  // The entry point is rooted in the deployed repository, never a request path.
  const root = path.dirname(path.dirname(operatorHandbookPath));
  app.get("/api/operator/documents", (_req, res) => {
    res.json({ documents: OPERATOR_DOCUMENTS.map(document => ({
      ...document, url: `/api/operator/documents/${document.id}`,
    })) });
  });
  app.get("/api/operator/documents/:id", async (req, res) => {
    const document = OPERATOR_DOCUMENTS.find(item => item.id === req.params.id);
    if (!document) { res.status(404).json({ error: "Unknown public operating document" }); return; }
    try {
      const file = path.resolve(root, document.path);
      const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
      res.json({ ...document, content, updatedAt: Math.floor(stat.mtimeMs) });
    } catch {
      res.status(500).json({ error: "Operating document unavailable" });
    }
  });
  // Public authored examples only. No directory browsing or project media exposure.
  app.get('/api/operator/documents/:id/files/:name', (req, res) => {
    const document = OPERATOR_DOCUMENTS.find(item => item.id === req.params.id);
    if (!document || !('files' in document) || !document.files.some(name => name === req.params.name)) {
      res.status(404).json({ error: 'Unknown public example file' }); return;
    }
    res.sendFile(path.resolve(root, path.dirname(document.path), req.params.name));
  });
  app.get("/api/operator/handbook", async (req, res) => {
    try {
      res.json(await readOperatorHandbookFromPath(operatorHandbookPath));
    } catch (err: any) {
      console.error("Operator handbook read Error:", err);
      res.status(500).json({ error: "Failed to read operator handbook" });
    }
  });

  app.get("/api/operator/capabilities", async (req, res) => {
    res.json(buildOperatorCapabilityManifest());
  });

  app.get("/api/operator/workflows", async (req, res) => {
    res.json(buildOperatorWorkflowContract());
  });

  app.get("/api/operator/security", async (req, res) => {
    res.json(summarizeOperatorSecurityPolicy(operatorSecurityPolicy));
  });
};
