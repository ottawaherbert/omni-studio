import {
  ProductionQAReport,
  QAVerdict,
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import { findWorkflowStepDefinition } from "./agents";
import { runAgentGatewayStep } from "./agentGateway";
import { normalizeProductionQAReport } from "./qaIssue";

const scoreFromReports = (
  reports: Omit<ProductionQAReport, "id" | "stageId" | "createdAt">[],
) => {
  const scores = reports.map((report) => report.score).filter((score): score is number => Number.isFinite(score));
  if (!scores.length) return reports.some((report) => report.blocking) ? 0 : reports.some((report) => report.issues.length) ? 76 : 100;
  return Math.min(...scores);
};

const reportFromGatewayVerdict = (
  verdict: QAVerdict,
): Omit<ProductionQAReport, "id" | "stageId" | "createdAt"> =>
  normalizeProductionQAReport({
    checkerId: verdict.qaAgentId,
    status: verdict.status,
    score: verdict.score,
    issues: verdict.issues,
    blocking: verdict.blocking,
    fixInstructions: verdict.blocking
      ? verdict.issues.map((issue) => issue.repairInstruction || issue.suggestion || issue.message).join("\n")
      : undefined,
    rawOutput: JSON.stringify({
      source: "AgentGateway",
      nextAction: verdict.nextAction,
      createdAt: verdict.createdAt,
    }),
  });

export const applyStageAgentGateway = async (
  run: ProductionRun,
  stage: ProductionStageRun,
  result: ProductionStageExecutionResult,
): Promise<ProductionStageExecutionResult> => {
  const workflowStepId = `autostudio.stage.${stage.stageType}`;
  const workflowStep = findWorkflowStepDefinition(workflowStepId);
  if (!workflowStep) return result;

  const issues = result.qaReports.flatMap((report) => report.issues || []);
  const blocking = result.qaReports.some((report) => report.blocking) || issues.some((issue) => issue.severity === "blocking");
  const score = scoreFromReports(result.qaReports);
  const qaHandlers = Object.fromEntries(workflowStep.qaAgentIds.map((qaAgentId) => [
    qaAgentId,
    async () => ({
      qaAgentId,
      status: blocking ? "failed" as const : issues.length ? "warning" as const : "passed" as const,
      blocking,
      score,
      issues,
      nextAction: blocking ? "retry" as const : "commit" as const,
    }),
  ]));

  const gateway = await runAgentGatewayStep({
    workflowStepId,
    trigger: "auto",
    input: {
      runId: run.id,
      stageId: stage.id,
      stageType: stage.stageType,
      currentStageStatus: stage.status,
    },
    producer: () => ({
      summary: result.summary,
      artifacts: result.artifacts,
      outputSnapshot: result.outputSnapshot,
    }),
    qaHandlers,
    contextFingerprint: `${run.id}:${stage.id}:${run.revision || 0}`,
    artifactKind: stage.stageType,
    targetPath: `autostudio.stage.${stage.stageType}`,
    entityIds: [run.projectId, stage.id],
  });

  return {
    ...result,
    qaReports: [
      ...result.qaReports,
      ...gateway.qaVerdicts.map(reportFromGatewayVerdict),
    ],
    contextUsed: {
      ...(typeof result.contextUsed === "object" && result.contextUsed !== null ? result.contextUsed : {}),
      agentGateway: {
        agentRunId: gateway.agentRunId,
        workflowStepId: gateway.step.id,
        producerAgentId: gateway.producerAgent.id,
        draftStatus: gateway.draft.status,
        retryDecision: gateway.retryDecision,
      },
    },
  };
};
