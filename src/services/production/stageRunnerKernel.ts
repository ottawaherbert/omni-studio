import { logRuntimeEvent } from "../runtimeLogger";
import type { Project } from "../../types/project";
import type {
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";

export interface ProductionStageRunnerKernelOptions {
  getProject: () => Project;
  createExecutionStage: (input: {
    run: ProductionRun;
    stage: ProductionStageRun;
    project: Project;
  }) => ProductionStageRun;
  executeStage: (input: {
    run: ProductionRun;
    stage: ProductionStageRun;
    project: Project;
  }) => Promise<ProductionStageExecutionResult>;
  onFinally?: (input: {
    run: ProductionRun;
    stage: ProductionStageRun;
    project: Project;
  }) => void;
}

export const executeProductionStageWithKernel = async (
  run: ProductionRun,
  stage: ProductionStageRun,
  options: ProductionStageRunnerKernelOptions,
): Promise<ProductionStageExecutionResult> => {
  const project = options.getProject();
  const startedAt = Date.now();
  logRuntimeEvent({
    source: "production",
    event: "production.stage.execute.start",
    runId: run.id,
    projectId: run.projectId,
    stageId: stage.id,
    stageType: stage.stageType,
    agentId: stage.agentId,
    status: stage.status,
    details: {
      reviewMode: run.policy.reviewMode,
      mode: run.mode,
    },
  });
  const executionStage = options.createExecutionStage({ run, stage, project });
  try {
    const result = await options.executeStage({ run, stage: executionStage, project });
    logRuntimeEvent({
      source: "production",
      event: "production.stage.execute.finish",
      runId: run.id,
      projectId: run.projectId,
      stageId: executionStage.id,
      stageType: executionStage.stageType,
      agentId: executionStage.agentId,
      status: "completed",
      message: result.summary,
      details: {
        durationMs: Date.now() - startedAt,
        artifactCount: result.artifacts.length,
        qaReportCount: result.qaReports.length,
        modelUsed: result.modelUsed,
      },
    });
    return result;
  } catch (err: any) {
    logRuntimeEvent({
      source: "production",
      event: "production.stage.execute.error",
      level: "error",
      runId: run.id,
      projectId: run.projectId,
      stageId: executionStage.id,
      stageType: executionStage.stageType,
      agentId: executionStage.agentId,
      status: "failed",
      message: err?.message || "Stage execution failed",
      details: {
        durationMs: Date.now() - startedAt,
      },
    });
    throw err;
  } finally {
    if (executionStage.inputConflictWarning) {
      stage.inputConflictWarning = executionStage.inputConflictWarning;
    }
    options.onFinally?.({ run, stage: executionStage, project });
  }
};
