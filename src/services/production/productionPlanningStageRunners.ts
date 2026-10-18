import type {
  ContextPlan,
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
} from "../../types/production";
import { createInitialContextPlan } from "./contextPlanner";
import { createContextPlannerQAReports } from "./linearAgents";
import { validateContextPlanRules } from "./ruleQa";
import { getProject } from "./runnerRepositoryAccess";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";

export const executeIntakeStage = async (
  _run: ProductionRun,
  _stage: ProductionStageRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const issues = [];
  if (!project.originalInspiration && !project.logline) {
    issues.push(makeIssue("project.originalInspiration", "项目缺少原始灵感或 logline。", "warning", "建议在继续自动生产前补充创作目标。"));
  }
  return {
    summary: "已归档项目创建输入与初始自动制片策略。",
    artifacts: [
      makeArtifact("concept", "project.originalInspiration", "项目输入快照", [project.id]),
    ],
    qaReports: [makeQA("intake.contract.checker", issues)],
    outputSnapshot: {
      projectId: project.id,
      title: project.title,
      type: project.type,
      projectModel: project.projectModel || "linear",
      inspiration: project.originalInspiration,
      logline: project.logline,
    },
  };
};

export const executeContextPlanningStage = async (
  run: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const contextPlan: ContextPlan = createInitialContextPlan(project);
  return {
    summary: "已生成初始 ContextPlan，按阶段拆分 Skill 与拉片 DNA 使用边界。",
    artifacts: [
      makeArtifact("qa_report", "run.contextPlan", "上下文治理计划", [run.id]),
    ],
    qaReports: [
      makeQA("context.pollution.checker", validateContextPlanRules(contextPlan, projectUniversalSkillRefs(project), project)),
      ...createContextPlannerQAReports(contextPlan, project),
    ],
    contextPlan,
    outputSnapshot: contextPlan,
  };
};
