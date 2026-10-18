import type {
  ProductionDepartmentCoverageReport,
  ProductionDepartmentFinding,
  ProductionQAIssue,
} from "../../../../types/production";
import type { ProductionCoordinationSnapshot } from "../../productionCoordination";
import {
  coordinationIssue,
  departmentFindingFromIssues,
  refsForSnapshot,
} from "../shared";

export const runDepartmentCoverageCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
  departmentCoverage: ProductionDepartmentCoverageReport,
): ProductionDepartmentFinding => {
  const issues: ProductionQAIssue[] = [
    ...departmentCoverage.missingDepartmentPackages.map((missing) => coordinationIssue(
      missing.targetPath,
      missing.reason,
      missing.severity,
      `生成或补齐 ${missing.department} department_prep_package，并绑定当前 production_breakdown_report、sceneRefs 和 shotRefs。`,
      {
        issueType: "department_coverage_coordination",
        retryable: true,
        fingerprint: `department_coverage:missing:${missing.department}:${snapshot.stageType || "unknown"}`,
        resolutionClass: missing.resolutionClass,
      },
    )),
    ...departmentCoverage.departments
      .filter((item) => item.required && item.readiness === "blocked")
      .map((item) => coordinationIssue(
        `departmentCoverage.${item.department}`,
        `${item.department} 部门筹备包处于 blocked，不能进入正式交付。`,
        "blocking",
        "先修复该部门 blocked 的 department_prep_package，再重新跑统筹 QA。",
        {
          issueType: "department_coverage_coordination",
          retryable: true,
          fingerprint: `department_coverage:blocked:${item.department}:${item.packageIds.join(",")}`,
          resolutionClass: "hard_blocking",
        },
      )),
    ...departmentCoverage.departments
      .filter((item) => item.required && item.readiness === "needs_review")
      .map((item) => coordinationIssue(
        `departmentCoverage.${item.department}`,
        item.missingSpecialistPayload
          ? `${item.department} 部门包缺少专业 specialistPayload，需要部门 QA 复核。`
          : `${item.department} 部门筹备包需要复核。`,
        "warning",
        "补齐部门专业 payload、openQuestions 或 continuity/style refs；无法自动确认时保持 soft hold。",
        {
          issueType: "department_coverage_coordination",
          retryable: true,
          fingerprint: `department_coverage:needs_review:${item.department}:${item.packageIds.join(",")}`,
          resolutionClass: "soft_hold",
        },
      )),
  ];

  return departmentFindingFromIssues({
    department: "department_coverage",
    issues,
    passedMessage: departmentCoverage.coverageMode === "active"
      ? "专业部门覆盖率已完成统筹检查。"
      : "当前范围尚未进入正式制片拆解，部门覆盖率未启动且不阻断旧链路。",
    target: "coordination.department_coverage",
    ownerAgentId: "production.coordination.supervisor",
    suggestedStageType: snapshot.stageType || "production_breakdown",
    evidenceRefs: refsForSnapshot(snapshot),
  });
};
