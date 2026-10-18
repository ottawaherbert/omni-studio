import {
  ProductionQAIssue,
  ProductionQAReport,
  ProductionStageRun,
} from "../../types/production";
import { normalizeProductionQAIssue, normalizeProductionQAIssues } from "./qaIssue";

const makeIssue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "blocking",
  suggestion?: string,
): ProductionQAIssue => ({
  ...normalizeProductionQAIssue({
    id: `qa-issue-${Date.now()}-${crypto.randomUUID()}`,
    target,
    message,
    severity,
    suggestion,
    issueType: "contract",
  }),
});

export const createContractQAReport = (
  stage: ProductionStageRun,
  issues: ProductionQAIssue[],
): ProductionQAReport => {
  const normalizedIssues = normalizeProductionQAIssues(issues);
  const blocking = normalizedIssues.some((issue) => issue.severity === "blocking");
  return {
    id: `qa-${Date.now()}-${crypto.randomUUID()}`,
    stageId: stage.id,
    checkerId: `qa.contract.stage.${stage.stageType}`,
    status: blocking ? "failed" : issues.length > 0 ? "warning" : "passed",
    score: blocking ? 0 : issues.length > 0 ? 70 : 100,
    issues: normalizedIssues,
    blocking,
    fixInstructions: blocking
      ? "请修复阻断性结构问题后重试当前阶段。"
      : undefined,
    createdAt: Date.now(),
  };
};

export const validateStageRunContract = (stage: ProductionStageRun) => {
  const issues: ProductionQAIssue[] = [];

  if (!stage.id) {
    issues.push(makeIssue("stage.id", "阶段缺少 id。"));
  }
  if (!stage.runId) {
    issues.push(makeIssue("stage.runId", "阶段缺少 runId。"));
  }
  if (!stage.stageType) {
    issues.push(makeIssue("stage.stageType", "阶段缺少 stageType。"));
  }
  if (!stage.agentId) {
    issues.push(makeIssue("stage.agentId", "阶段缺少 agentId。"));
  }
  if (!Array.isArray(stage.outputArtifactIds)) {
    issues.push(makeIssue("stage.outputArtifactIds", "阶段产物索引必须是数组。"));
  }
  if (!Array.isArray(stage.qaReports)) {
    issues.push(makeIssue("stage.qaReports", "阶段 QA 报告必须是数组。"));
  }

  return createContractQAReport(stage, issues);
};
