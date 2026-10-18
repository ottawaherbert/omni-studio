import type { Express } from "express";

export interface RuntimeRoutesOptions {
  compactRuntimeLogDetails: (value: unknown, maxLength?: number) => string;
}

export const registerRuntimeRoutes = (app: Express, { compactRuntimeLogDetails }: RuntimeRoutesOptions) => {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/runtime-logs", (req, res) => {
    const entry = req.body || {};
    const level = ["debug", "info", "warn", "error"].includes(entry.level) ? entry.level : "info";
    const prefix = `[runtime:${entry.source || "frontend"}:${entry.event || "event"}]`;
    const summary = {
      runId: entry.runId,
      projectId: entry.projectId,
      stageType: entry.stageType,
      stageId: entry.stageId,
      agentId: entry.agentId,
      qaAgentId: entry.qaAgentId,
      agentRunId: entry.agentRunId,
      status: entry.status,
      message: entry.message,
      details: entry.details,
    };
    const line = `${prefix} ${compactRuntimeLogDetails(summary)}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    res.json({ ok: true });
  });
};
