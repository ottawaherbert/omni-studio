import type { Express } from "express";
import fs from "fs/promises";

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
    path: "doc/design.md",
    updatedAt: Math.floor(stat.mtimeMs),
    content,
  };
};

export const registerOperatorMetadataRoutes = (
  app: Express,
  { operatorHandbookPath, operatorSecurityPolicy }: OperatorMetadataRoutesOptions,
) => {
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
