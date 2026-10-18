import type {
  DepartmentHandoffManifest,
  ProductionDepartmentFinding,
} from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import {
  coordinationIssue,
  departmentFindingFromIssues,
  refsForSnapshot,
} from "../shared";

export const runOperatorGovernanceCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
  handoffManifest: DepartmentHandoffManifest,
): ProductionDepartmentFinding => {
  const issues = [
    ...handoffManifest.missingRefs.map((missing) => coordinationIssue(
      missing.targetPath,
      missing.reason,
      "warning",
      missing.reason,
      { issueType: "operator_governance_coordination" },
    )),
    ...snapshot.qaReports
      .filter((report) => report.blocking)
      .map((report) => coordinationIssue(
        `qaReports.${report.id}`,
        `上游 QA 存在阻断：${report.fixInstructions || report.checkerId}`,
        "blocking",
        report.fixInstructions || "先修复上游 QA 阻断，再重新生成统筹报告。",
        { issueType: "operator_governance_coordination", retryable: true },
      )),
    ...snapshot.gateVerdicts
      .filter((verdict) => verdict.blocking)
      .map((verdict) => coordinationIssue(
        `gateVerdicts.${verdict.gateId}`,
        `上游 gate 存在阻断：${verdict.summary}`,
        "blocking",
        "先处理 gate 阻断，再重新生成统筹报告。",
        { issueType: "operator_governance_coordination", retryable: true },
      )),
  ];

  return departmentFindingFromIssues({
    department: "operator_governance",
    issues,
    passedMessage: "Operator 治理统筹未发现当前范围的结构性缺口。",
    target: "coordination.operator_governance",
    ownerAgentId: "linear.context.planner",
    suggestedStageType: "context_planning",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
