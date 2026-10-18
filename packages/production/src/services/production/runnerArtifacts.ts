import type {
  ProductionQAIssue,
  ProductionQAReport,
  ProductionStageExecutionResult,
} from "../../../../../src/types/production";
import { normalizeProductionQAReport } from "./qaIssue";

export const makeIssue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "error",
  suggestion?: string,
): ProductionQAIssue => ({
  id: `production-issue-${Date.now()}-${crypto.randomUUID()}`,
  target,
  message,
  severity,
  suggestion,
});

export const makeQA = (
  checkerId: string,
  issues: ProductionQAIssue[] = [],
  score = issues.length > 0 ? 72 : 100,
): Omit<ProductionQAReport, "id" | "stageId" | "createdAt"> => {
  const blocking = issues.some((issue) => issue.severity === "blocking");
  return normalizeProductionQAReport({
    checkerId,
    status: blocking ? "failed" : issues.length > 0 ? "warning" : "passed",
    score,
    issues,
    blocking,
    fixInstructions: blocking
      ? issues.map((issue) => issue.suggestion || issue.message).join("\n")
      : undefined,
  });
};

export const makeArtifact = (
  artifactType: ProductionStageExecutionResult["artifacts"][number]["artifactType"],
  targetPath: string,
  summary: string,
  entityIds: string[] = [],
  version = 1,
) => ({
  artifactType,
  targetPath,
  entityIds,
  version,
  summary,
});
