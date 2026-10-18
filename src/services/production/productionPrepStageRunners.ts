import type {
  ProductionQAIssue,
  ProductionRun,
  ProductionStageExecutionResult,
} from "../../types/production";
import {
  buildFormalAssetPackage,
  validateFormalAssetPackage,
} from "./productionAssetPackage";
import {
  validateContentLockPackage,
  validateProductionBlockLock,
  validateScriptLockPackage,
} from "./productionLock";
import {
  validateCastingRequirements,
  validateDepartmentPrepPackages,
  validateProductionBreakdownReport,
} from "./productionPrep";
import {
  validateCastingDecision,
  validateRoleSlots,
} from "./productionCasting";
import { validateContinuityMatrix } from "./productionContinuity";
import { resolveProductionPrepBundle } from "./productionPrepRuntime";
import {
  fetchApprovedCastingDecisionsForPrep,
  getProject,
  loadFullEpisodes,
  mergeCastingDecisions,
} from "./runnerRepositoryAccess";
import { makeArtifact, makeIssue, makeQA } from "./runnerArtifacts";
import {
  buildVideoStoryboardAssetBoardPlan,
  validateVideoStoryboardAssetBoardPlan,
} from "./videoStoryboardAssetBoards";

const toAssetBoardProductionIssues = (
  issues: ReturnType<typeof validateVideoStoryboardAssetBoardPlan>,
): ProductionQAIssue[] =>
  issues.map((item) => makeIssue(
    item.target,
    `${item.code}: ${item.message}`,
    item.severity === "blocking" ? "blocking" : "warning",
    "检查正式资产板是否已绑定 script/content lock、production breakdown、casting requirement 和 department prep。",
  ));

export const executeProductionBreakdownStage = async (
  run: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const episodes = await loadFullEpisodes(project);
  const prep = resolveProductionPrepBundle(run, project, episodes);
  const issues = [
    ...("scriptLockPackage" in prep && prep.scriptLockPackage ? validateScriptLockPackage(prep.scriptLockPackage) : []),
    ...("contentLockPackage" in prep && prep.contentLockPackage ? validateContentLockPackage(prep.contentLockPackage) : []),
    ...(prep.productionBlockLock ? validateProductionBlockLock(prep.productionBlockLock) : []),
    ...validateProductionBreakdownReport(prep.productionBreakdownReport),
    ...validateContinuityMatrix(prep.continuityMatrix),
    ...validateRoleSlots(prep.roleSlots),
    ...validateCastingRequirements(prep.castingRequirements),
    ...prep.castingDecisions.flatMap((decision) => validateCastingDecision(decision)),
    ...validateDepartmentPrepPackages(prep.departmentPrepPackages),
  ];
  return {
    summary: `已完成生产拆解：${prep.productionBreakdownReport.sceneMatrix.length} 个锁定场次/节点、${prep.continuityMatrix?.rows?.length || 0} 条场记连续性记录、${prep.roleSlots.length} 个角色功能位、${prep.castingRequirements.length} 个角色需求、${prep.castingDecisions.length} 个选角决定、${prep.departmentPrepPackages.length} 个部门筹备包。`,
    artifacts: [
      makeArtifact("production_breakdown_report", "run.outputSnapshot.productionBreakdownReport", "生产拆解报告", [prep.productionBreakdownReport.id]),
      makeArtifact("continuity_matrix", "run.outputSnapshot.continuityMatrix", "场记连续性矩阵", [prep.continuityMatrix?.id].filter(Boolean) as string[]),
      makeArtifact("role_slot", "run.outputSnapshot.roleSlots", "角色功能位", prep.roleSlots.map((item) => item.id)),
      makeArtifact("casting_requirement", "run.outputSnapshot.castingRequirements", "导演/选角角色需求", prep.castingRequirements.map((item) => item.id)),
      makeArtifact("casting_decision", "run.outputSnapshot.castingDecisions", "AutoStudio 导演/选角决定", prep.castingDecisions.map((item) => item.id)),
      makeArtifact("department_prep_package", "run.outputSnapshot.departmentPrepPackages", "部门筹备包", prep.departmentPrepPackages.map((item) => item.id)),
    ],
    qaReports: [makeQA("production.prep.breakdown.qa", issues, issues.some((issue) => issue.severity === "blocking") ? 0 : issues.length ? 82 : 100)],
    outputSnapshot: prep,
  };
};

export const executeProductionAssetDetailStage = async (
  run: ProductionRun,
): Promise<ProductionStageExecutionResult> => {
  const project = getProject();
  const episodes = await loadFullEpisodes(project);
  const prep = resolveProductionPrepBundle(run, project, episodes);
  const operatorCastingDecisions = await fetchApprovedCastingDecisionsForPrep(
    project.id,
    prep.productionBreakdownReport.id,
    prep.castingRequirements.map((requirement) => requirement.id),
  );
  const castingDecisions = mergeCastingDecisions(prep.castingDecisions, operatorCastingDecisions);
  const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(project, {
    formalAssetIntent: true,
    scriptLockPackage: prep.scriptLockPackage,
    contentLockPackage: prep.contentLockPackage,
    productionBlockLock: prep.productionBlockLock,
    productionBreakdownReport: prep.productionBreakdownReport,
    castingRequirements: prep.castingRequirements,
    castingDecisions,
    departmentPrepPackages: prep.departmentPrepPackages,
  });
  const formalAssetPackage = buildFormalAssetPackage({
    project,
    assetBoardPlan,
    productionBreakdownReport: prep.productionBreakdownReport,
    castingDecisions,
    departmentPrepPackages: prep.departmentPrepPackages,
  });
  const issues = [
    ...toAssetBoardProductionIssues(validateVideoStoryboardAssetBoardPlan(assetBoardPlan, project)),
    ...validateFormalAssetPackage(formalAssetPackage),
  ];
  return {
    summary: `已生成正式资产板计划：${assetBoardPlan.productionReadiness}，正式资产包 ${formalAssetPackage.status}，identity boards ${formalAssetPackage.identityBoards.length} 个。角色板 ${assetBoardPlan.characterBoards.length}、场景板 ${assetBoardPlan.sceneBoards.length}、道具板 ${assetBoardPlan.propBoards.length}、变体板 ${assetBoardPlan.variantBoards.length}。`,
    artifacts: [
      makeArtifact("asset_board_plan", "run.outputSnapshot.formalAssetBoardPlan", "正式角色/场景/道具/变体资产板计划", [assetBoardPlan.id]),
      makeArtifact("formal_asset_package", "run.outputSnapshot.formalAssetPackage", "统一正式资产包", [formalAssetPackage.id]),
      makeArtifact("asset_identity_board", "run.outputSnapshot.formalAssetPackage.identityBoards", "正式资产身份板", formalAssetPackage.identityBoards.map((board) => board.id)),
    ],
    qaReports: [makeQA("production.asset.formal_board.qa", issues, issues.some((issue) => issue.severity === "blocking") ? 0 : issues.length ? 84 : 100)],
    outputSnapshot: {
      ...prep,
      castingDecisions,
      operatorCastingDecisionIds: operatorCastingDecisions.map((decision) => decision.id),
      assetBoardPlan,
      formalAssetPackage,
    },
  };
};
