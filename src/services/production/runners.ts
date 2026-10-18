import {
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
  ProductionStageType,
} from "../../types/production";
import { getProject } from "./runnerRepositoryAccess";
import {
  executeContentLockStage,
  executeScriptLockStage,
} from "./productionLockStageRunners";
import {
  executeProductionAssetDetailStage,
  executeProductionBreakdownStage,
} from "./productionPrepStageRunners";
import { executeAssetSyncStage } from "./productionAssetSyncStageRunner";
import { executeMediaGenerationPlanningStage } from "./productionGenerationPlanningStageRunner";
import {
  executeContextPlanningStage,
  executeIntakeStage,
} from "./productionPlanningStageRunners";
import { executeConceptStage } from "./productionConceptStageRunner";
import { executeBibleStage } from "./productionBibleStageRunner";
import { executeAssetDetailStage } from "./productionAssetDetailStageRunner";
import { executeStructureStage } from "./productionStructureStageRunner";
import { executeSceneStage } from "./productionSceneStageRunner";
import { executeScriptStage } from "./productionScriptStageRunner";
import { executeStoryboardStage } from "./productionStoryboardStageRunner";
import { executePromptStage } from "./productionPromptStageRunner";
import { clearActiveApprovedStageExecutionSession } from "./productionPromptRuntime";
import { buildStageContextTrace } from "./productionPromptContext";
import { executeProductionStageWithKernel } from "./stageRunnerKernel";

export { PromptApprovalRequiredError } from "./productionPromptRuntime";

type ProductionStageExecutor = (
  run: ProductionRun,
  stage: ProductionStageRun,
) => Promise<ProductionStageExecutionResult>;

const retiredInteractiveStage = (stage: ProductionStageRun): Promise<ProductionStageExecutionResult> =>
  Promise.reject(new Error(
    `历史互动自动制片阶段「${stage.stageType}」已停止执行。请从当前互动白板打开 Writing、制片或试玩。`,
  ));

export const productionStageExecutorRegistry = {
  intake: (run, stage) => executeIntakeStage(run, stage),
  concept: (run, stage) => executeConceptStage(run, stage),
  context_planning: (run) => executeContextPlanningStage(run),
  bible: (run, stage) => executeBibleStage(run, stage),
  interactive_bible: (_run, stage) => retiredInteractiveStage(stage),
  asset_detail: (_run, stage) => executeAssetDetailStage(stage),
  structure: (_run, stage) => executeStructureStage(stage),
  scene: (_run, stage) => executeSceneStage(stage),
  script: (_run, stage) => executeScriptStage(stage),
  script_lock: (run) => executeScriptLockStage(run),
  content_lock: (run) => executeContentLockStage(run),
  production_breakdown: (run) => executeProductionBreakdownStage(run),
  production_asset_detail: (run) => executeProductionAssetDetailStage(run),
  asset_sync: (run) => executeAssetSyncStage(run),
  storyboard: (run, stage) => executeStoryboardStage(run, stage),
  prompt: (run, stage) => executePromptStage(run, stage),
  expensive_generation_planning: (run) => executeMediaGenerationPlanningStage(run),
  game_blueprint: (_run, stage) => retiredInteractiveStage(stage),
  graph_generation: (_run, stage) => retiredInteractiveStage(stage),
  interactive_graph_qa: (_run, stage) => retiredInteractiveStage(stage),
  node_to_scene: (_run, stage) => retiredInteractiveStage(stage),
  interactive_script: (_run, stage) => retiredInteractiveStage(stage),
  interactive_storyboard: (_run, stage) => retiredInteractiveStage(stage),
  playtest_simulation: (_run, stage) => retiredInteractiveStage(stage),
} satisfies Record<ProductionStageType, ProductionStageExecutor>;

export const executeProductionStage = async (
  run: ProductionRun,
  stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> =>
  executeProductionStageWithKernel(run, stage, {
    getProject,
    createExecutionStage: ({ run, stage, project }) => {
      const contextTrace = buildStageContextTrace(project, run.contextPlan, stage.stageType);
      const runtimeControls = {
        ...run.policy.runtimeControls,
        ...(stage.runtimeControlOverrides || {}),
      };
      return {
        ...stage,
        contextUsed: {
          ...(stage.contextUsed && typeof stage.contextUsed === "object" ? stage.contextUsed : {}),
          reviewMode: run.policy.reviewMode,
          tokenBudget: run.contextPlan.tokenBudgetEstimate[stage.stageType],
          contextPlan: run.contextPlan,
          contextTrace,
          runtimeControls,
          runtimeControlOverrides: stage.runtimeControlOverrides || {},
        },
      };
    },
    executeStage: ({ run, stage }) => productionStageExecutorRegistry[stage.stageType](run, stage),
    onFinally: ({ stage }) => {
      clearActiveApprovedStageExecutionSession(stage.id);
    },
  });
