import type {
  CoordinationRepairTicket,
  DepartmentHandoffManifest,
  HumanInterventionTask,
  ProductionCoordinationRecoveryState,
  ProductionCoordinationSourceRef,
  ProductionCoordinationTraceIndex,
  ProductionDepartmentFinding,
  ProductionQAIssue,
  ProductionStageType,
} from "../../../types/production";
import { QA_SEVERITY_POLICY_ID } from "../qaIssue";
import { asArray, compact, isNonEmpty, sourceArtifactIds, stableIssueId } from "./shared";

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const unique = (items: Array<string | undefined>) =>
  Array.from(new Set(items.map((item) => compact(item)).filter(Boolean)));

const traceIssue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
): ProductionQAIssue => ({
  id: nowId("coordination_trace_issue"),
  severity,
  target,
  message,
  repairInstruction: message,
  retryable: severity !== "blocking",
  issueType: "production_coordination_trace",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "auto_repairable",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const recoveryStates: ProductionCoordinationRecoveryState[] = [
  "clear",
  "soft_hold",
  "repair_open",
  "repair_in_progress",
  "human_review_required",
  "blocked",
  "resolved",
];

const sourceIdsForKind = (
  sourceRefs: ProductionCoordinationSourceRef[],
  kind: ProductionCoordinationSourceRef["kind"],
) => unique(sourceRefs.filter((ref) => ref.kind === kind).map((ref) => ref.id));

const artifactIdsFromRefs = (refs: ProductionCoordinationSourceRef[]) =>
  unique(refs
    .filter((ref) => (ref.kind === "operator_artifact" || ref.artifactKind) && ref.id)
    .map((ref) => ref.id));

const recoveryStateFor = (
  finding: ProductionDepartmentFinding,
  tickets: CoordinationRepairTicket[],
  humanTasks: HumanInterventionTask[],
): ProductionCoordinationRecoveryState => {
  const activeTicket = [...tickets]
    .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
  if (humanTasks.length) return "human_review_required";
  if (activeTicket?.status === "resolved") return "resolved";
  if (activeTicket?.status === "blocked") return "blocked";
  if (activeTicket?.status === "in_progress") return "repair_in_progress";
  if (activeTicket?.status === "open") return "repair_open";
  if (finding.resolutionClass === "soft_hold") return "soft_hold";
  if (finding.status === "failed" || finding.severity === "blocking" || finding.severity === "error") return "blocked";
  return "clear";
};

export const buildProductionCoordinationTraceIndex = (input: {
  runId?: string;
  stageId?: string;
  stageType?: ProductionStageType;
  sourceArtifactIds: string[];
  sourceRefs: ProductionCoordinationSourceRef[];
  departmentFindings: ProductionDepartmentFinding[];
  repairTickets: CoordinationRepairTicket[];
  handoffManifest?: DepartmentHandoffManifest;
  humanInterventionTasks?: HumanInterventionTask[];
}): ProductionCoordinationTraceIndex => {
  const ticketsByIssueId = new Map<string, CoordinationRepairTicket[]>();
  for (const ticket of input.repairTickets) {
    const list = ticketsByIssueId.get(ticket.issueId) || [];
    list.push(ticket);
    ticketsByIssueId.set(ticket.issueId, list);
  }
  const tasksByIssueId = new Map<string, HumanInterventionTask[]>();
  for (const task of input.humanInterventionTasks || []) {
    for (const issueFingerprint of task.issueFingerprints || []) {
      const list = tasksByIssueId.get(issueFingerprint) || [];
      list.push(task);
      tasksByIssueId.set(issueFingerprint, list);
    }
  }

  const links = input.departmentFindings.map((finding) => {
    const issueId = stableIssueId(finding);
    const tickets = ticketsByIssueId.get(issueId) || [];
    const humanTasks = tasksByIssueId.get(issueId) || [];
    const latestTicket = [...tickets]
      .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0];
    return {
      issueId,
      issueFingerprint: issueId,
      findingId: finding.id,
      department: finding.department,
      findingStatus: finding.status,
      severity: finding.severity,
      resolutionClass: finding.resolutionClass,
      targetPath: finding.target,
      ownerAgentId: finding.ownerAgentId,
      suggestedStageType: finding.suggestedStageType,
      sourceStageType: latestTicket?.sourceStageType || finding.suggestedStageType,
      sourceArtifactIds: latestTicket?.sourceArtifactIds?.length
        ? latestTicket.sourceArtifactIds
        : sourceArtifactIds(finding),
      evidenceRefs: finding.evidenceRefs,
      repairTicketIds: tickets.map((ticket) => ticket.id),
      humanInterventionTaskIds: humanTasks.map((task) => task.id),
      recoveryState: recoveryStateFor(finding, tickets, humanTasks),
      repairMode: latestTicket?.repairMode,
      repairClassification: latestTicket?.repairClassification,
      retryCount: latestTicket?.retryCount || 0,
      maxRetries: latestTicket?.maxRetries || 0,
      autoRepairAttempted: latestTicket?.autoRepairAttempted === true,
      updatedAt: latestTicket?.updatedAt || latestTicket?.createdAt,
    };
  });

  const recoverySummary = recoveryStates.reduce((summary, state) => {
    summary[state] = links.filter((link) => link.recoveryState === state).length;
    return summary;
  }, {
    clear: 0,
    soft_hold: 0,
    repair_open: 0,
    repair_in_progress: 0,
    human_review_required: 0,
    blocked: 0,
    resolved: 0,
    totalFindings: links.length,
    unresolvedFindings: links.filter((link) => !["clear", "resolved"].includes(link.recoveryState)).length,
    sourceArtifactCount: unique(input.sourceArtifactIds).length,
  } as ProductionCoordinationTraceIndex["recoverySummary"]);

  return {
    schemaVersion: "production-coordination-trace.v1",
    runId: input.runId,
    stageId: input.stageId,
    stageType: input.stageType,
    sourceArtifactIds: unique(input.sourceArtifactIds),
    sourceQaReportIds: sourceIdsForKind(input.sourceRefs, "qa_report"),
    sourceGateIds: sourceIdsForKind(input.sourceRefs, "gate_verdict"),
    handoffManifestId: input.handoffManifest?.id,
    handoffAllowedArtifactIds: artifactIdsFromRefs(asArray(input.handoffManifest?.allowedArtifactRefs)),
    handoffBlockedArtifactIds: artifactIdsFromRefs(asArray(input.handoffManifest?.blockedRefs)),
    findingIds: input.departmentFindings.map((finding) => finding.id),
    repairTicketIds: input.repairTickets.map((ticket) => ticket.id),
    humanInterventionTaskIds: asArray<HumanInterventionTask>(input.humanInterventionTasks).map((task) => task.id),
    links,
    recoverySummary,
  };
};

export const validateProductionCoordinationTraceIndex = (
  trace: Partial<ProductionCoordinationTraceIndex> | undefined,
  context: {
    departmentFindings?: Partial<ProductionDepartmentFinding>[];
    repairTickets?: Partial<CoordinationRepairTicket>[];
  } = {},
): ProductionQAIssue[] => {
  if (!trace || typeof trace !== "object") {
    return [traceIssue("productionCoordinationReport.coordinationTrace", "统筹报告必须包含 coordinationTrace 追踪索引。", "blocking")];
  }

  const issues: ProductionQAIssue[] = [];
  if (trace.schemaVersion !== "production-coordination-trace.v1") {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.schemaVersion", "coordinationTrace schemaVersion 必须为 production-coordination-trace.v1。", "blocking"));
  }
  if (!Array.isArray(trace.sourceArtifactIds)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.sourceArtifactIds", "coordinationTrace 必须包含 sourceArtifactIds 数组。", "blocking"));
  }
  if (!Array.isArray(trace.sourceQaReportIds)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.sourceQaReportIds", "coordinationTrace 必须包含 sourceQaReportIds 数组。", "blocking"));
  }
  if (!Array.isArray(trace.sourceGateIds)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.sourceGateIds", "coordinationTrace 必须包含 sourceGateIds 数组。", "blocking"));
  }
  if (!Array.isArray(trace.findingIds)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.findingIds", "coordinationTrace 必须包含 findingIds 数组。", "blocking"));
  }
  if (!Array.isArray(trace.repairTicketIds)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.repairTicketIds", "coordinationTrace 必须包含 repairTicketIds 数组。", "blocking"));
  }
  if (!Array.isArray(trace.humanInterventionTaskIds)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.humanInterventionTaskIds", "coordinationTrace 必须包含 humanInterventionTaskIds 数组。", "blocking"));
  }
  if (!Array.isArray(trace.links)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.links", "coordinationTrace 必须包含 links 数组。", "blocking"));
    return issues;
  }

  const findingIds = new Set(asArray<Partial<ProductionDepartmentFinding>>(context.departmentFindings).map((finding) => finding.id).filter(Boolean));
  const ticketIds = new Set(asArray<Partial<CoordinationRepairTicket>>(context.repairTickets).map((ticket) => ticket.id).filter(Boolean));
  const issueIds = new Set<string>();
  trace.links.forEach((link, index) => {
    const target = `productionCoordinationReport.coordinationTrace.links.${link?.findingId || index}`;
    if (!isNonEmpty(link?.issueId)) issues.push(traceIssue(`${target}.issueId`, "trace link 缺少 issueId。", "blocking"));
    if (!isNonEmpty(link?.issueFingerprint)) issues.push(traceIssue(`${target}.issueFingerprint`, "trace link 缺少 issueFingerprint。", "blocking"));
    if (link?.issueId && link.issueFingerprint && link.issueId !== link.issueFingerprint) {
      issues.push(traceIssue(`${target}.issueFingerprint`, "trace link 的 issueFingerprint 必须与 issueId 对齐，避免同类问题无法去重。", "blocking"));
    }
    if (!isNonEmpty(link?.findingId)) issues.push(traceIssue(`${target}.findingId`, "trace link 缺少 findingId。", "blocking"));
    if (findingIds.size && link?.findingId && !findingIds.has(link.findingId)) {
      issues.push(traceIssue(`${target}.findingId`, "trace link 引用了不存在的 department finding。", "blocking"));
    }
    if (!isNonEmpty(link?.department)) issues.push(traceIssue(`${target}.department`, "trace link 缺少 department。", "blocking"));
    if (!isNonEmpty(link?.targetPath)) issues.push(traceIssue(`${target}.targetPath`, "trace link 缺少 targetPath。", "blocking"));
    if (!link?.recoveryState || !recoveryStates.includes(link.recoveryState)) {
      issues.push(traceIssue(`${target}.recoveryState`, "trace link recoveryState 不合法。", "blocking"));
    }
    if (!Array.isArray(link?.sourceArtifactIds)) {
      issues.push(traceIssue(`${target}.sourceArtifactIds`, "trace link 必须包含 sourceArtifactIds 数组。", "blocking"));
    }
    if (!Array.isArray(link?.evidenceRefs)) {
      issues.push(traceIssue(`${target}.evidenceRefs`, "trace link 必须包含 evidenceRefs 数组。", "blocking"));
    }
    if (!Array.isArray(link?.repairTicketIds)) {
      issues.push(traceIssue(`${target}.repairTicketIds`, "trace link 必须包含 repairTicketIds 数组。", "blocking"));
    } else {
      for (const repairTicketId of link.repairTicketIds) {
        if (ticketIds.size && !ticketIds.has(repairTicketId)) {
          issues.push(traceIssue(`${target}.repairTicketIds`, "trace link 引用了不存在的 repair ticket。", "blocking"));
        }
      }
    }
    if (!Array.isArray(link?.humanInterventionTaskIds)) {
      issues.push(traceIssue(`${target}.humanInterventionTaskIds`, "trace link 必须包含 humanInterventionTaskIds 数组。", "blocking"));
    }
    if (!Number.isFinite(link?.retryCount) || Number(link?.retryCount) < 0) {
      issues.push(traceIssue(`${target}.retryCount`, "trace link retryCount 必须是非负数。", "blocking"));
    }
    if (!Number.isFinite(link?.maxRetries) || Number(link?.maxRetries) < 0) {
      issues.push(traceIssue(`${target}.maxRetries`, "trace link maxRetries 必须是非负数。", "blocking"));
    }
    if (link?.issueId) issueIds.add(link.issueId);
  });

  for (const ticket of asArray<Partial<CoordinationRepairTicket>>(context.repairTickets)) {
    if (ticket.issueId && !issueIds.has(ticket.issueId)) {
      issues.push(traceIssue(`productionCoordinationReport.coordinationTrace.repairTickets.${ticket.id || ticket.issueId}`, "每张 repair ticket 必须能在 coordinationTrace.links 中找到对应 issueId。", "blocking"));
    }
  }
  const summary = trace.recoverySummary;
  if (!summary || typeof summary !== "object" || !Number.isFinite(summary.totalFindings)) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.recoverySummary", "coordinationTrace 必须包含 recoverySummary.totalFindings。", "blocking"));
  }
  if (summary && Number(summary.totalFindings) !== trace.links.length) {
    issues.push(traceIssue("productionCoordinationReport.coordinationTrace.recoverySummary.totalFindings", "recoverySummary.totalFindings 必须等于 links 数量。", "blocking"));
  }
  return issues;
};
