import type { Asset, Character, Episode, Project, Scene, Shot } from "../../types/project";
import type {
  CoordinationRepairTicket,
  DepartmentHandoffManifest,
  HumanInterventionTask,
  ProductionCoordinationDepartment,
  ProductionCoordinationReport,
  ProductionCoordinationScope,
  ProductionCoordinationSourceRef,
  ProductionCoordinationTraceIndex,
  ProductionDepartmentCoverageItem,
  ProductionDepartmentCoverageReport,
  ProductionDepartmentFinding,
  ProductionDepartmentQaSummary,
  ProductionGateVerdict,
  ProductionMissingDepartmentPackage,
  ProductionQAIssue,
  ProductionQAReport,
  ProductionRepairClassification,
  ProductionRepairMode,
  ProductionStageType,
  QAStatus,
} from "../../types/production";
import type { OperatorArtifactEnvelope } from "../operator/types";
import { classifyQAIssueResolution, QA_SEVERITY_POLICY_ID } from "./qaIssue";
import { DEPARTMENT_COORDINATION_POINTS } from "./departmentAgents";
import {
  expandProductionPrepDepartment,
  PRODUCTION_PREP_CANONICAL_DEPARTMENTS,
  PRODUCTION_PREP_DEPARTMENT_ALIASES,
  PRODUCTION_PREP_LEGACY_DEPARTMENTS,
  type DepartmentPrepPackage,
  type ProductionBreakdownReport,
  type ProductionPrepDepartment,
} from "./productionPrep";
import {
  runOperatorGovernanceCoordinationQA as runOperatorGovernanceDepartmentQA,
} from "./coordination/departments/operatorGovernance";
import {
  runAssetCoordinationQA as runAssetDepartmentQA,
} from "./coordination/departments/asset";
import {
  runCreativeCommercialCoordinationQA as runCreativeCommercialDepartmentQA,
} from "./coordination/departments/creativeCommercial";
import {
  runDepartmentCoverageCoordinationQA as runDepartmentCoverageDepartmentQA,
} from "./coordination/departments/departmentCoverage";
import {
  runMediaReadinessCoordinationQA as runMediaReadinessDepartmentQA,
} from "./coordination/departments/mediaReadiness";
import {
  runContinuityCoordinationQA as runContinuityDepartmentQA,
} from "./coordination/departments/continuity";
import {
  runStoryboardVideoUnitCoordinationQA as runStoryboardVideoUnitDepartmentQA,
} from "./coordination/departments/storyboardVideoUnit";
import {
  runStyleStrategyCoordinationQA as runStyleStrategyDepartmentQA,
} from "./coordination/departments/styleStrategy";
import { stageRequires } from "./coordination/stageRequirements";
import {
  buildProductionCoordinationTraceIndex,
  validateProductionCoordinationTraceIndex,
} from "./coordination/trace";

export interface ProductionCoordinationSnapshotInput {
  project: Project;
  episodes?: Episode[];
  operatorArtifacts?: OperatorArtifactEnvelope[];
  qaReports?: ProductionQAReport[];
  gateVerdicts?: ProductionGateVerdict[];
  previousRepairTickets?: CoordinationRepairTicket[];
  scope?: ProductionCoordinationScope;
  runId?: string;
  stageId?: string;
  stageType?: ProductionStageType;
  environment?: "test" | "production" | "development";
  capturedAt?: number;
}

export interface ProductionCoordinationSnapshot extends Required<Pick<ProductionCoordinationSnapshotInput, "scope">> {
  project: Project;
  episodes: Episode[];
  scenes: Scene[];
  shots: Shot[];
  operatorArtifacts: OperatorArtifactEnvelope[];
  qaReports: ProductionQAReport[];
  gateVerdicts: ProductionGateVerdict[];
  previousRepairTickets: CoordinationRepairTicket[];
  runId?: string;
  stageId?: string;
  stageType?: ProductionStageType;
  environment: "test" | "production" | "development";
  capturedAt: number;
}

export interface CoordinationCircuitBreakerDecision {
  status: "clear" | "repair_allowed" | "human_review_required" | "blocked";
  shouldRetry: boolean;
  humanInterventionRequired: boolean;
  reason: string;
  repeatedIssueIds: string[];
  exhaustedTicketIds: string[];
}

export interface ProductionCoordinationGateResult {
  report: ProductionCoordinationReport;
  blocking: boolean;
  canProceed: boolean;
  nextAction: "proceed" | "repair" | "human_review" | "blocked";
  repairTickets: CoordinationRepairTicket[];
  coordinationTrace: ProductionCoordinationTraceIndex;
  circuitBreaker: CoordinationCircuitBreakerDecision;
  humanInterventionTasks: HumanInterventionTask[];
  reason: string;
}

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const compact = (value: unknown) => String(value || "").trim();

const isNonEmpty = (value: unknown) => compact(value).length > 0;

const extractProductionBreakdownReports = (artifact: OperatorArtifactEnvelope): ProductionBreakdownReport[] => {
  const data: any = artifact.data;
  const candidates = data?.productionBreakdownReports || data?.productionBreakdownReport ||
    (artifact.kind === "production_breakdown_report" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "production-breakdown-report.v1") as ProductionBreakdownReport[];
};

const extractDepartmentPrepPackages = (artifact: OperatorArtifactEnvelope): DepartmentPrepPackage[] => {
  const data: any = artifact.data;
  const candidates = data?.departmentPrepPackages || data?.departmentPrepPackage ||
    (artifact.kind === "department_prep_package" ? data : undefined);
  const list = Array.isArray(candidates) ? candidates : candidates ? [candidates] : [];
  return list.filter((item) => item?.schemaVersion === "department-prep-package.v1") as DepartmentPrepPackage[];
};

export { collectProductionCoordinationArtifacts } from "./coordination/artifacts";

const artifactRef = (artifact: OperatorArtifactEnvelope): ProductionCoordinationSourceRef => ({
  kind: "operator_artifact",
  id: artifact.id,
  targetPath: artifact.targetPath,
  artifactKind: artifact.kind,
});

const projectRef = (project: Project): ProductionCoordinationSourceRef => ({
  kind: "project",
  id: project.id,
  targetPath: `projects.${project.id || "unknown"}`,
});

const episodeRef = (episode: Episode): ProductionCoordinationSourceRef => ({
  kind: "episode",
  id: episode.id,
  targetPath: `episodes.${episode.id || "unknown"}`,
});

const sceneRef = (episodeId: string, scene: Scene): ProductionCoordinationSourceRef => ({
  kind: "scene",
  id: scene.id,
  targetPath: `episodes.${episodeId}.scenes.${scene.id || "unknown"}`,
});

const shotRef = (episodeId: string, sceneId: string, shot: Shot): ProductionCoordinationSourceRef => ({
  kind: "shot",
  id: shot.id,
  targetPath: `episodes.${episodeId}.scenes.${sceneId}.shots.${shot.id || "unknown"}`,
});

const qaReportRef = (report: ProductionQAReport): ProductionCoordinationSourceRef => ({
  kind: "qa_report",
  id: report.id,
  targetPath: `qaReports.${report.id}`,
});

const gateVerdictRef = (verdict: ProductionGateVerdict): ProductionCoordinationSourceRef => ({
  kind: "gate_verdict",
  id: verdict.gateId,
  targetPath: `gateVerdicts.${verdict.gateId}`,
});

const productionMemoryRef = (project: Project): ProductionCoordinationSourceRef | undefined =>
  project.productionMemory || project.operatorProductionMemory
    ? {
        kind: "production_memory",
        id: project.id,
        targetPath: project.productionMemory ? "project.productionMemory" : "project.operatorProductionMemory",
      }
    : undefined;

const assetContinuityRef = (project: Project): ProductionCoordinationSourceRef => ({
  kind: "asset_continuity",
  id: project.id,
  targetPath: "derived.assetContinuity",
});

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  repairInstruction?: string,
  options: {
    issueType?: string;
    retryable?: boolean;
    suggestion?: string;
    fingerprint?: string;
    resolutionClass?: ProductionQAIssue["resolutionClass"];
  } = {},
): ProductionQAIssue => ({
  id: nowId("coordination_issue"),
  severity,
  target,
  message,
  suggestion: options.suggestion,
  fingerprint: options.fingerprint,
  repairInstruction: repairInstruction || message,
  issueType: options.issueType || "production_coordination",
  retryable: options.retryable ?? severity !== "blocking",
  resolutionClass: options.resolutionClass,
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const finding = (input: {
  department: ProductionDepartmentFinding["department"];
  status: QAStatus;
  severity: ProductionQAIssue["severity"];
  target: string;
  message: string;
  evidenceRefs: ProductionCoordinationSourceRef[];
  ownerAgentId?: string;
  suggestedStageType?: ProductionStageType;
  repairInstruction?: string;
  retryable?: boolean;
  resolutionClass?: ProductionDepartmentFinding["resolutionClass"];
  severityPolicyId?: string;
}): ProductionDepartmentFinding => {
  const { retryable, ...rest } = input;
  return {
    id: nowId(`coordination_${input.department}`),
    retryable: retryable ?? input.severity !== "blocking",
    ...rest,
  };
};

const artifactsByKind = (
  artifacts: OperatorArtifactEnvelope[],
  kind: OperatorArtifactEnvelope["kind"],
) => artifacts.filter((artifact) => artifact.kind === kind);

const statusFromIssues = (issues: ProductionQAIssue[]): QAStatus =>
  issues.some((item) => item.severity === "blocking" || item.severity === "error")
    ? "failed"
    : issues.length
      ? "warning"
      : "passed";

const severityFromIssues = (issues: ProductionQAIssue[]): ProductionQAIssue["severity"] =>
  issues.some((item) => item.severity === "blocking" || item.severity === "error")
    ? "blocking"
    : issues.length
      ? "warning"
      : "info";

const resolutionRank: Record<NonNullable<ProductionQAIssue["resolutionClass"]>, number> = {
  advisory: 0,
  soft_hold: 1,
  auto_repairable: 2,
  hard_blocking: 3,
};

const resolutionFromIssues = (issues: ProductionQAIssue[]): NonNullable<ProductionQAIssue["resolutionClass"]> =>
  issues
    .map((item) => classifyQAIssueResolution(item))
    .sort((a, b) => resolutionRank[b] - resolutionRank[a])[0] || "advisory";

const refsForSnapshot = (snapshot: ProductionCoordinationSnapshot): ProductionCoordinationSourceRef[] => [
  projectRef(snapshot.project),
  ...snapshot.episodes.map(episodeRef),
  ...snapshot.operatorArtifacts.map(artifactRef),
];

const uniqueIssuesByFingerprint = (issues: ProductionQAIssue[]): ProductionQAIssue[] => {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = item.fingerprint || `${item.issueType || "coordination"}:${item.target}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const departmentFindingFromIssues = (input: {
  department: ProductionCoordinationDepartment;
  issues: ProductionQAIssue[];
  passedMessage: string;
  target: string;
  ownerAgentId: string;
  suggestedStageType: ProductionStageType;
  evidenceRefs: ProductionCoordinationSourceRef[];
}): ProductionDepartmentFinding => {
  const issues = uniqueIssuesByFingerprint(input.issues);
  const severity = severityFromIssues(issues);
  const resolutionClass = issues.length ? resolutionFromIssues(issues) : "advisory";
  return finding({
    department: input.department,
    status: statusFromIssues(issues),
    severity,
    target: input.target,
    message: issues.length ? issues.map((item) => item.message).join("；") : input.passedMessage,
    evidenceRefs: input.evidenceRefs,
    ownerAgentId: input.ownerAgentId,
    suggestedStageType: input.suggestedStageType,
    repairInstruction: issues.map((item) => item.repairInstruction || item.message).join("；") || input.passedMessage,
    retryable: issues.length ? issues.every((item) => item.retryable !== false) : true,
    resolutionClass,
    severityPolicyId: QA_SEVERITY_POLICY_ID,
  });
};

const environmentRepairMode = (
  environment: ProductionCoordinationSnapshot["environment"],
): ProductionRepairMode => {
  if (environment === "test") return "test_fix_code_prompt_qa_or_workflow";
  if (environment === "production") return "production_content_draft";
  return "manual_intervention";
};

const maxRetriesForRepair = (
  finding: ProductionDepartmentFinding,
  repairMode: ProductionRepairMode,
) => {
  if (finding.resolutionClass === "hard_blocking") return 0;
  if (finding.retryable === false) return 0;
  if (repairMode === "manual_intervention" || repairMode === "waiver_request") return 0;
  if (repairMode === "test_fix_code_prompt_qa_or_workflow") return 1;
  return 2;
};

const stableIssueId = (finding: ProductionDepartmentFinding) =>
  [
    "coordination",
    finding.department,
    finding.suggestedStageType || "unknown_stage",
    finding.target,
    compact(finding.message).slice(0, 160),
  ].join(":");

const firstOperatorArtifactId = (finding: ProductionDepartmentFinding) =>
  finding.evidenceRefs.find((ref) => ref.kind === "operator_artifact" && ref.id)?.id;

const sourceArtifactIds = (finding: ProductionDepartmentFinding) =>
  unique(finding.evidenceRefs
    .filter((ref) => (ref.kind === "operator_artifact" || ref.artifactKind) && ref.id)
    .map((ref) => ref.id));

const classifyRepair = (
  finding: ProductionDepartmentFinding,
  repairMode: ProductionRepairMode,
): ProductionRepairClassification => {
  if (repairMode === "production_content_draft") return "content";
  if (repairMode === "waiver_request") return "waiver";
  if (repairMode === "manual_intervention") return "manual";
  const text = [
    finding.target,
    finding.message,
    finding.repairInstruction,
    finding.ownerAgentId,
    finding.suggestedStageType,
  ].join(" ").toLowerCase();
  if (/prompt|imageprompt|videoprompt|提示词/.test(text)) return "prompt";
  if (/qa|verdict|gate|rubric|checker|质检/.test(text)) return "qa";
  if (/workflow|stage|handoff|gate|流程|阶段|交接/.test(text)) return "workflow";
  if (/schema|json|contract|结构|字段|version/.test(text)) return "schema";
  return "code";
};

const issueFromFinding = (finding: ProductionDepartmentFinding): ProductionQAIssue => issue(
  finding.target,
  finding.message,
  finding.severity,
  finding.repairInstruction || finding.message,
  {
    issueType: `coordination_${finding.department}`,
    retryable: finding.retryable,
    fingerprint: stableIssueId(finding),
    resolutionClass: finding.resolutionClass,
  },
);

export const buildCoordinationRepairTickets = (input: {
  departmentFindings: ProductionDepartmentFinding[];
  repairMode: ProductionRepairMode;
  previousTickets?: CoordinationRepairTicket[];
  createdAt?: number;
}): CoordinationRepairTicket[] => {
  const now = input.createdAt || Date.now();
  const previousByIssueId = new Map<string, CoordinationRepairTicket>();
  for (const ticket of input.previousTickets || []) {
    const existing = previousByIssueId.get(ticket.issueId);
    if (!existing || ticket.retryCount > existing.retryCount) previousByIssueId.set(ticket.issueId, ticket);
  }

  return input.departmentFindings
    .filter((finding) => finding.severity === "blocking" || finding.status === "failed")
    .map((finding) => {
      const issueId = stableIssueId(finding);
      const previous = previousByIssueId.get(issueId);
      const maxRetries = maxRetriesForRepair(finding, input.repairMode);
      const retryCount = previous ? previous.retryCount + 1 : 0;
      const exhausted = retryCount >= maxRetries && maxRetries > 0;
      const nonRetryable = maxRetries === 0;
      const status: CoordinationRepairTicket["status"] = exhausted || nonRetryable ? "blocked" : "open";
      const humanEscalationReason = nonRetryable
        ? "该问题不可自动返工，必须人工判断是内容修订、流程问题还是允许豁免。"
        : exhausted
          ? `同类阻断已达到最大重试次数 ${maxRetries}，停止自动重做并转人工接管。`
          : undefined;
      return {
        id: nowId("coordination_repair_ticket"),
        issueId,
        ownerAgentId: finding.ownerAgentId || "production.coordination.supervisor",
        suggestedStageType: finding.suggestedStageType || "context_planning",
        targetArtifactId: firstOperatorArtifactId(finding),
        targetPath: finding.target,
        repairMode: input.repairMode,
        repairClassification: classifyRepair(finding, input.repairMode),
        issueFingerprint: issueId,
        sourceArtifactIds: sourceArtifactIds(finding),
        sourceStageType: finding.suggestedStageType,
        reason: finding.message,
        repairInstruction: finding.repairInstruction || finding.message,
        maxRetries,
        retryCount,
        resolutionClass: finding.resolutionClass || "auto_repairable",
        severityPolicyId: finding.severityPolicyId || QA_SEVERITY_POLICY_ID,
        autoRepairAttempted: retryCount > 0,
        waiverCandidate: finding.resolutionClass === "soft_hold",
        humanEscalationReason,
        status,
        createdAt: now,
        updatedAt: previous ? now : undefined,
      };
    });
};

export const evaluateCoordinationCircuitBreaker = (
  report: ProductionCoordinationReport,
  previousReports: ProductionCoordinationReport[] = [],
): CoordinationCircuitBreakerDecision => {
  const tickets = asArray<CoordinationRepairTicket>(report.repairTickets);
  if (!tickets.length) {
    return {
      status: "clear",
      shouldRetry: false,
      humanInterventionRequired: false,
      reason: "统筹 QA 未产生返工单。",
      repeatedIssueIds: [],
      exhaustedTicketIds: [],
    };
  }

  const previousIssueIds = new Set(previousReports.flatMap((item) =>
    asArray<CoordinationRepairTicket>(item.repairTickets).map((ticket) => ticket.issueId),
  ));
  const repeatedIssueIds = tickets
    .map((ticket) => ticket.issueId)
    .filter((issueId) => previousIssueIds.has(issueId));
  const exhaustedTickets = tickets.filter((ticket) => ticket.status === "blocked" || ticket.retryCount >= ticket.maxRetries);
  if (exhaustedTickets.length) {
    return {
      status: "blocked",
      shouldRetry: false,
      humanInterventionRequired: true,
      reason: `统筹返工触发 circuit breaker：${exhaustedTickets.length} 个返工单不可继续自动重试。`,
      repeatedIssueIds: Array.from(new Set(repeatedIssueIds)),
      exhaustedTicketIds: exhaustedTickets.map((ticket) => ticket.id),
    };
  }
  if (repeatedIssueIds.length) {
    return {
      status: "repair_allowed",
      shouldRetry: true,
      humanInterventionRequired: false,
      reason: "同类统筹问题再次出现，但仍在允许重试范围内。",
      repeatedIssueIds: Array.from(new Set(repeatedIssueIds)),
      exhaustedTicketIds: [],
    };
  }
  return {
    status: "repair_allowed",
    shouldRetry: true,
    humanInterventionRequired: false,
    reason: "统筹 QA 发现阻断问题，已生成可自动返工的 repair tickets。",
    repeatedIssueIds: [],
    exhaustedTicketIds: [],
  };
};

export const buildCoordinationHumanInterventionTasks = (
  report: ProductionCoordinationReport,
  decision: CoordinationCircuitBreakerDecision,
): HumanInterventionTask[] => {
  if (!decision.humanInterventionRequired) return [];
  const tickets = asArray<CoordinationRepairTicket>(report.repairTickets);
  return [{
    id: nowId("coordination_human_intervention"),
    workflowStepId: `production_coordination.${report.scope}.${report.stageType || "wrap"}`,
    agentRunId: "production.coordination.supervisor",
    reason: decision.reason,
    issueFingerprints: tickets.map((ticket) => ticket.issueId),
    repairOptions: Array.from(new Set(tickets.map((ticket) => ticket.repairInstruction).filter(Boolean))),
    status: decision.status === "blocked" ? "blocked" : "open",
    createdAt: Date.now(),
  }];
};

export const buildProductionCoordinationSnapshot = ({
  project,
  episodes,
  operatorArtifacts = [],
  qaReports = [],
  gateVerdicts = [],
  previousRepairTickets = [],
  scope = "stage_exit",
  runId,
  stageId,
  stageType,
  environment = "development",
  capturedAt = Date.now(),
}: ProductionCoordinationSnapshotInput): ProductionCoordinationSnapshot => {
  const fullEpisodes = asArray<Episode>(episodes).length
    ? asArray<Episode>(episodes)
    : asArray<Episode>((project as any).episodes);
  const scenes = fullEpisodes.flatMap((episode) => asArray<Scene>(episode.scenes));
  const shots = scenes.flatMap((scene) => asArray<Shot>(scene.shots));
  return {
    project,
    episodes: fullEpisodes,
    scenes,
    shots,
    operatorArtifacts,
    qaReports,
    gateVerdicts,
    previousRepairTickets,
    scope,
    runId,
    stageId,
    stageType,
    environment,
    capturedAt,
  };
};

export const buildDepartmentHandoffManifest = (
  snapshot: ProductionCoordinationSnapshot,
): DepartmentHandoffManifest => {
  const blockedStatuses = new Set(["qa_failed", "quarantined"]);
  const missingRefs = stageRequires(snapshot.stageType)
    .filter((kind) => artifactsByKind(snapshot.operatorArtifacts, kind).length === 0)
    .map((kind) => ({
      targetPath: `operatorArtifacts.${kind}`,
      reason: `当前 ${snapshot.stageType || "manual"} 统筹范围缺少 ${kind} artifact。`,
      requiredBeforeStageType: snapshot.stageType,
    }));

  return {
    id: nowId("department_handoff_manifest"),
    fromStageType: snapshot.stageType,
    toStageType: undefined,
    allowedArtifactRefs: snapshot.operatorArtifacts
      .filter((artifact) => !blockedStatuses.has(artifact.status))
      .map(artifactRef),
    allowedAssetRefs: [
      ...asArray<Character>(snapshot.project.characters).map((character) => ({
        kind: "project" as const,
        id: character.id,
        targetPath: `project.characters.${character.id}`,
      })),
      ...asArray<Asset>(snapshot.project.assets).map((asset) => ({
        kind: "project" as const,
        id: asset.id,
        targetPath: `project.assets.${asset.id}`,
      })),
    ],
    blockedRefs: snapshot.operatorArtifacts
      .filter((artifact) => blockedStatuses.has(artifact.status))
      .map(artifactRef),
    missingRefs,
    notes: [
      "统筹交接清单只声明下一阶段可读上下文，不替代专业 producer agent 产物。",
      "缺失项在阶段 2 先作为报告事实记录；阶段出口阻断留给后续接入。",
    ],
  };
};

const unique = (items: Array<string | undefined>) =>
  Array.from(new Set(items.map((item) => compact(item)).filter(Boolean)));

type DepartmentPrepPackageItem = {
  artifact: OperatorArtifactEnvelope;
  prepPackage: DepartmentPrepPackage;
};

const departmentCoveragePolicyId = "production-department-coverage.v1";

const departmentCoverageStages = new Set<ProductionStageType>([
  "production_breakdown",
  "production_asset_detail",
  "asset_sync",
  "storyboard",
  "prompt",
  "expensive_generation_planning",
  "interactive_storyboard",
]);

const professionalPayloadSchemas: Partial<Record<ProductionPrepDepartment, string>> = {
  cinematography: "cinematography-prep.v1",
  lighting: "lighting-prep.v1",
  production_design: "production-design-prep.v1",
  wardrobe: "wardrobe-prep.v1",
  makeup_hair: "makeup-hair-prep.v1",
  performance_directing: "performance-directing-prep.v1",
  action_choreography: "action-choreography-prep.v1",
};

const projectModeForCoverage = (project: Project) => {
  if (project.projectModel === "interactive" || (project as any).type === "interactive" || project.productionMode === "interactive") return "interactive";
  return project.productionMode || project.type || "ai-video-sample";
};

const latestProductionBreakdownReport = (reports: ProductionBreakdownReport[]) =>
  [...reports].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];

const shotBriefSignal = (shot: NonNullable<ProductionBreakdownReport["sceneMatrix"][number]["shotBriefs"]>[number]) => [
  shot.visualAction,
  shot.blocking,
  shot.cameraMovement,
  shot.continuityNote,
  shot.motivation,
].join(" ");

const actionSignalPattern = /战|打|追|摔|跌|跑|爆|火|危险|搏|杀|逃|跳|撞|fight|chase|stunt|combat|fall|run|explosion/i;

const rowHasActionSignal = (row: ProductionBreakdownReport["sceneMatrix"][number]) =>
  actionSignalPattern.test([
    row.title,
    ...asArray<string>(row.vehicles),
    ...asArray<string>(row.specialEquipment),
    ...asArray<string>(row.vfx),
    ...asArray<string>(row.sfx),
    ...asArray<NonNullable<typeof row.shotBriefs>[number]>(row.shotBriefs).map(shotBriefSignal),
  ].join(" "));

const reportHasVfxSignal = (report?: ProductionBreakdownReport) =>
  !!report && (
    report.sceneMatrix.some((row) => asArray<string>(row.vfx).length > 0 || asArray<string>(row.sfx).length > 0) ||
    asArray<ProductionBreakdownReport["variantNeeds"][number]>(report.variantNeeds)
      .some((need) => need.variantKind === "vfx_state")
  );

const reportHasUiSignal = (report?: ProductionBreakdownReport) =>
  !!report && (
    report.scope?.mode === "interactive" ||
    report.sceneMatrix.some((row) => !!row.interactive) ||
    asArray<ProductionBreakdownReport["variantNeeds"][number]>(report.variantNeeds)
      .some((need) => ["ui_state", "choice_state", "interactive_variable_state", "ending_state", "failure_state"].includes(need.variantKind))
  );

const reportHasExtrasSignal = (report?: ProductionBreakdownReport) =>
  !!report && report.sceneMatrix.some((row) =>
    asArray<string>(row.extrasAtmosphere).length > 0 ||
    asArray<string>(row.vehicles).length > 0 ||
    asArray<string>(row.specialEquipment).length > 0,
  );

const requiredDepartmentsForCoverage = (
  snapshot: ProductionCoordinationSnapshot,
  report?: ProductionBreakdownReport,
): ProductionPrepDepartment[] => {
  if (!report && !departmentCoverageStages.has(snapshot.stageType as ProductionStageType)) return [];
  const projectMode = projectModeForCoverage(snapshot.project);
  const sampleMode = projectMode === "ai-video-sample";
  const required = new Set<ProductionPrepDepartment>(sampleMode
    ? ["continuity"]
    : [
        "production_design",
        "wardrobe",
        "makeup_hair",
        "props",
        "continuity",
      ]);
  if (!snapshot.stageType || ["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt", "expensive_generation_planning", "interactive_storyboard"].includes(snapshot.stageType)) {
    required.add("cinematography");
    required.add("lighting");
    required.add("performance_directing");
  }
  if (report?.sceneMatrix.some(rowHasActionSignal)) required.add("action_choreography");
  if (reportHasVfxSignal(report)) required.add("vfx_sfx");
  if (reportHasUiSignal(report)) required.add("ui_interaction");
  if (reportHasExtrasSignal(report)) required.add("extras_stunts");
  return Array.from(required);
};

const prepPackageExpandedDepartments = (prepPackage: DepartmentPrepPackage) =>
  expandProductionPrepDepartment(prepPackage.department);

const prepPackageCoversDepartment = (
  prepPackage: DepartmentPrepPackage,
  department: ProductionPrepDepartment,
) => prepPackageExpandedDepartments(prepPackage).includes(department);

const packageSceneIds = (prepPackage: DepartmentPrepPackage) =>
  unique([
    ...asArray<string>(prepPackage.sceneIds),
    ...asArray<string>(prepPackage.sceneRefs),
    ...asArray<DepartmentPrepPackage["requiredAssets"][number]>(prepPackage.requiredAssets).flatMap((asset) => asset.sceneIds),
  ]);

const packageNodeIds = (prepPackage: DepartmentPrepPackage) =>
  unique([
    ...asArray<string>(prepPackage.nodeIds),
    ...asArray<DepartmentPrepPackage["requiredAssets"][number]>(prepPackage.requiredAssets).flatMap((asset) => asset.nodeIds),
  ]);

const packageShotIds = (prepPackage: DepartmentPrepPackage) =>
  unique([
    ...asArray<string>(prepPackage.shotRefs),
    ...asArray<DepartmentPrepPackage["requiredAssets"][number]>(prepPackage.requiredAssets).flatMap((asset) => asset.shotIds),
  ]);

const packageCoversSceneRow = (
  prepPackage: DepartmentPrepPackage,
  row: ProductionBreakdownReport["sceneMatrix"][number],
) => {
  const sceneIds = packageSceneIds(prepPackage);
  const nodeIds = packageNodeIds(prepPackage);
  if (row.sceneId && sceneIds.includes(row.sceneId)) return true;
  if (row.nodeId && nodeIds.includes(row.nodeId)) return true;
  return !sceneIds.length && !nodeIds.length && (!row.episodeId || asArray<string>(prepPackage.episodeIds).includes(row.episodeId));
};

const coverageReadinessFromPackages = (
  required: boolean,
  packages: DepartmentPrepPackageItem[],
  missingSpecialistPayload: boolean,
): ProductionDepartmentCoverageItem["readiness"] => {
  if (!packages.length) return required ? "missing" : "not_required";
  if (packages.some(({ prepPackage }) => prepPackage.readiness === "blocked")) return "blocked";
  if (missingSpecialistPayload || packages.some(({ prepPackage }) => prepPackage.readiness === "needs_review")) return "needs_review";
  return "ready";
};

const qaStatusFromCoverageReadiness = (readiness: ProductionDepartmentCoverageItem["readiness"]): QAStatus =>
  readiness === "blocked" || readiness === "missing"
    ? "failed"
    : readiness === "needs_review"
      ? "warning"
      : "passed";

const severityFromCoverageReadiness = (
  readiness: ProductionDepartmentCoverageItem["readiness"],
  required: boolean,
): ProductionQAIssue["severity"] =>
  readiness === "blocked" || (required && readiness === "missing")
    ? "blocking"
    : readiness === "needs_review"
      ? "warning"
      : "info";

const resolutionFromCoverageReadiness = (
  readiness: ProductionDepartmentCoverageItem["readiness"],
  required: boolean,
): NonNullable<ProductionQAIssue["resolutionClass"]> =>
  readiness === "blocked" || (required && readiness === "missing")
    ? "hard_blocking"
    : readiness === "needs_review"
      ? "soft_hold"
      : "advisory";

export const buildProductionDepartmentCoverage = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentCoverageReport => {
  const breakdownReports = snapshot.operatorArtifacts.flatMap(extractProductionBreakdownReports);
  const latestBreakdown = latestProductionBreakdownReport(breakdownReports);
  const prepItems = snapshot.operatorArtifacts.flatMap((artifact) =>
    extractDepartmentPrepPackages(artifact).map((prepPackage) => ({ artifact, prepPackage })),
  );
  const coverageMode: ProductionDepartmentCoverageReport["coverageMode"] =
    latestBreakdown || prepItems.length ? "active" : "not_started";
  const requiredDepartments = coverageMode === "active" ? requiredDepartmentsForCoverage(snapshot, latestBreakdown) : [];
  const requiredSet = new Set<ProductionPrepDepartment>(requiredDepartments);
  const trackedDepartments = [...PRODUCTION_PREP_CANONICAL_DEPARTMENTS];
  const departments: ProductionDepartmentCoverageItem[] = trackedDepartments.map((department) => {
    const packages = prepItems.filter(({ prepPackage }) => prepPackageCoversDepartment(prepPackage, department));
    const directPackages = packages.filter(({ prepPackage }) => prepPackage.department === department);
    const legacyAliasPackages = packages.filter(({ prepPackage }) => prepPackage.department !== department);
    const expectedSchema = professionalPayloadSchemas[department];
    const hasSpecialistPayload = expectedSchema
      ? directPackages.some(({ prepPackage }) => (prepPackage.specialistPayload as any)?.schemaVersion === expectedSchema)
      : packages.some(({ prepPackage }) => !!prepPackage.specialistPayload);
    const missingSpecialistPayload = !!expectedSchema && directPackages.length > 0 && !hasSpecialistPayload;
    const required = requiredSet.has(department);
    const readiness = coverageReadinessFromPackages(required, packages, missingSpecialistPayload);
    const requiredAssets = packages.flatMap(({ prepPackage }) => asArray<DepartmentPrepPackage["requiredAssets"][number]>(prepPackage.requiredAssets));
    const variants = packages.flatMap(({ prepPackage }) => asArray<DepartmentPrepPackage["variants"][number]>(prepPackage.variants));
    const continuityRows = packages.flatMap(({ prepPackage }) => asArray<DepartmentPrepPackage["continuityInOut"][number]>(prepPackage.continuityInOut));
    const sceneIds = unique(packages.flatMap(({ prepPackage }) => packageSceneIds(prepPackage)));
    const nodeIds = unique(packages.flatMap(({ prepPackage }) => packageNodeIds(prepPackage)));
    const shotIds = unique(packages.flatMap(({ prepPackage }) => packageShotIds(prepPackage)));
    return {
      department,
      required,
      readiness,
      reason: !required && !packages.length
        ? "当前范围没有要求该部门产出正式筹备包。"
        : !packages.length
          ? "当前范围缺少该部门 department_prep_package。"
          : missingSpecialistPayload
            ? "该部门包存在，但缺少专业 specialistPayload，不能当作完整专业筹备。"
            : packages.some(({ prepPackage }) => prepPackage.readiness === "blocked")
              ? "该部门至少一个筹备包处于 blocked。"
              : packages.some(({ prepPackage }) => prepPackage.readiness === "needs_review")
                ? "该部门至少一个筹备包需要复核。"
                : "该部门筹备包已覆盖当前统筹范围。",
      requiredBeforeStageTypes: department === "continuity"
        ? ["production_breakdown", "asset_sync", "storyboard", "prompt"]
        : department === "cinematography" || department === "lighting" || department === "performance_directing" || department === "action_choreography"
          ? ["storyboard", "prompt", "expensive_generation_planning"]
          : ["production_asset_detail", "asset_sync", "storyboard"],
      packageIds: packages.map(({ prepPackage }) => prepPackage.id),
      artifactIds: unique(packages.map(({ artifact }) => artifact.id)),
      directPackageIds: directPackages.map(({ prepPackage }) => prepPackage.id),
      legacyAliasPackageIds: legacyAliasPackages.map(({ prepPackage }) => prepPackage.id),
      ownerAgentIds: unique(packages.map(({ prepPackage }) => prepPackage.ownerAgentId)),
      readyPackageCount: packages.filter(({ prepPackage }) => prepPackage.readiness === "ready_for_department_review").length,
      needsReviewPackageCount: packages.filter(({ prepPackage }) => prepPackage.readiness === "needs_review").length,
      blockedPackageCount: packages.filter(({ prepPackage }) => prepPackage.readiness === "blocked").length,
      requiredAssetCount: requiredAssets.length,
      variantCount: variants.length,
      continuityCount: continuityRows.length,
      sceneIds,
      nodeIds,
      shotIds,
      hasSpecialistPayload,
      missingSpecialistPayload,
    };
  });

  const missingDepartmentPackages: ProductionMissingDepartmentPackage[] = departments
    .filter((item) => item.required && item.readiness === "missing")
    .map((item) => ({
      department: item.department,
      targetPath: `departmentPrepPackages.${item.department}`,
      reason: item.reason,
      severity: "blocking",
      resolutionClass: "hard_blocking",
      requiredBeforeStageType: item.requiredBeforeStageTypes[0],
      sceneIds: latestBreakdown ? unique(latestBreakdown.sceneMatrix.map((row) => row.sceneId)) : [],
      nodeIds: latestBreakdown ? unique(latestBreakdown.sceneMatrix.map((row) => row.nodeId)) : [],
      shotIds: latestBreakdown ? unique(latestBreakdown.sceneMatrix.flatMap((row) => row.shotIds)) : [],
    }));

  const departmentQaSummary: ProductionDepartmentQaSummary[] = departments.map((item) => {
    const severity = severityFromCoverageReadiness(item.readiness, item.required);
    const messages = [
      item.reason,
      item.missingSpecialistPayload ? "缺少专业 specialistPayload。" : "",
      item.legacyAliasPackageIds.length ? `由 legacy alias 兼容覆盖：${item.legacyAliasPackageIds.join(", ")}` : "",
    ].filter(Boolean);
    return {
      department: item.department,
      status: qaStatusFromCoverageReadiness(item.readiness),
      severity,
      readiness: item.readiness,
      resolutionClass: resolutionFromCoverageReadiness(item.readiness, item.required),
      packageIds: item.packageIds,
      artifactIds: item.artifactIds,
      ownerAgentIds: item.ownerAgentIds,
      issueCount: severity === "info" ? 0 : 1,
      messages,
      target: `departmentCoverage.${item.department}`,
    };
  });

  const requiredDepartmentsForRows = (row: ProductionBreakdownReport["sceneMatrix"][number]) =>
    requiredDepartments.filter((department) => department !== "action_choreography" || rowHasActionSignal(row));
  const perSceneReadiness: ProductionDepartmentCoverageReport["perSceneReadiness"] = latestBreakdown
    ? latestBreakdown.sceneMatrix.map((row) => {
        const rowRequired = requiredDepartmentsForRows(row);
        const readyDepartments: string[] = [];
        const needsReviewDepartments: string[] = [];
        const blockedDepartments: string[] = [];
        const missingDepartments: string[] = [];
        const packageIds: string[] = [];
        for (const department of rowRequired) {
          const packages = prepItems.filter(({ prepPackage }) =>
            prepPackageCoversDepartment(prepPackage, department) && packageCoversSceneRow(prepPackage, row),
          );
          packageIds.push(...packages.map(({ prepPackage }) => prepPackage.id));
          const readiness = coverageReadinessFromPackages(true, packages, false);
          if (readiness === "ready") readyDepartments.push(department);
          if (readiness === "needs_review") needsReviewDepartments.push(department);
          if (readiness === "blocked") blockedDepartments.push(department);
          if (readiness === "missing") missingDepartments.push(department);
        }
        return {
          sourceType: row.sourceType,
          episodeId: row.episodeId,
          sceneId: row.sceneId,
          nodeId: row.nodeId,
          title: row.title,
          readyDepartments,
          needsReviewDepartments,
          blockedDepartments,
          missingDepartments,
          packageIds: unique(packageIds),
        };
      })
    : [];

  const legacyAliasCoverage = PRODUCTION_PREP_LEGACY_DEPARTMENTS.map((aliasDepartment) => ({
    aliasDepartment,
    canonicalDepartments: [...(PRODUCTION_PREP_DEPARTMENT_ALIASES[aliasDepartment] || [])],
    packageIds: prepItems
      .filter(({ prepPackage }) => prepPackage.department === aliasDepartment)
      .map(({ prepPackage }) => prepPackage.id),
  })).filter((item) => item.packageIds.length > 0);

  const readyDepartments = departments.filter((item) => item.readiness === "ready").map((item) => item.department);
  const needsReviewDepartments = departments.filter((item) => item.readiness === "needs_review").map((item) => item.department);
  const blockedDepartments = departments.filter((item) => item.readiness === "blocked").map((item) => item.department);
  const missingRequiredDepartments = missingDepartmentPackages.map((item) => item.department);
  const coveredDepartments = departments.filter((item) => item.packageIds.length > 0).map((item) => item.department);

  return {
    schemaVersion: departmentCoveragePolicyId,
    policyId: "phase-12c.formal-department-coverage",
    coverageMode,
    projectMode: projectModeForCoverage(snapshot.project),
    stageType: snapshot.stageType,
    trackedDepartments,
    requiredDepartments,
    coveredDepartments,
    readyDepartments,
    needsReviewDepartments,
    blockedDepartments,
    missingRequiredDepartments,
    optionalMissingDepartments: departments
      .filter((item) => !item.required && item.readiness === "not_required")
      .map((item) => item.department),
    departments,
    missingDepartmentPackages,
    departmentQaSummary,
    perSceneReadiness,
    legacyAliasCoverage,
    totals: {
      trackedDepartments: trackedDepartments.length,
      requiredDepartments: requiredDepartments.length,
      coveredDepartments: coveredDepartments.length,
      readyDepartments: readyDepartments.length,
      needsReviewDepartments: needsReviewDepartments.length,
      blockedDepartments: blockedDepartments.length,
      missingRequiredDepartments: missingRequiredDepartments.length,
      perSceneRows: perSceneReadiness.length,
    },
    notes: [
      coverageMode === "active"
        ? "部门覆盖率来自 production_breakdown_report 与 department_prep_package，不由前端私算。"
        : "当前范围尚未进入正式制片拆解，部门覆盖只记录为未启动，不阻断旧链路或样片探索。",
      "legacy wardrobe_makeup 会展开为 wardrobe + makeup_hair，legacy location_art 会展开为 production_design。",
      "directing、casting 和 production 仍通过导演决定、选角链路和统筹报告管理，不强制要求 department_prep_package。",
    ],
  };
};

export const runAssetCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
  handoffManifest: DepartmentHandoffManifest = buildDepartmentHandoffManifest(snapshot),
): ProductionDepartmentFinding => runAssetDepartmentQA(snapshot);

export const runContinuityCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => runContinuityDepartmentQA(snapshot);

export const runStoryboardVideoUnitCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => runStoryboardVideoUnitDepartmentQA(snapshot);

export const runStyleStrategyCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => runStyleStrategyDepartmentQA(snapshot);

export const runCreativeCommercialCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => runCreativeCommercialDepartmentQA(snapshot);

export const runMediaReadinessCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
): ProductionDepartmentFinding => runMediaReadinessDepartmentQA(snapshot);

export const runOperatorGovernanceCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
  handoffManifest: DepartmentHandoffManifest = buildDepartmentHandoffManifest(snapshot),
): ProductionDepartmentFinding => runOperatorGovernanceDepartmentQA(snapshot, handoffManifest);

export const runDepartmentCoverageCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
  departmentCoverage: ProductionDepartmentCoverageReport = buildProductionDepartmentCoverage(snapshot),
): ProductionDepartmentFinding => runDepartmentCoverageDepartmentQA(snapshot, departmentCoverage);

export const runProductionDepartmentCoordinationQA = (
  snapshot: ProductionCoordinationSnapshot,
  handoffManifest: DepartmentHandoffManifest = buildDepartmentHandoffManifest(snapshot),
  departmentCoverage: ProductionDepartmentCoverageReport = buildProductionDepartmentCoverage(snapshot),
): ProductionDepartmentFinding[] => [
  runAssetCoordinationQA(snapshot, handoffManifest),
  runContinuityCoordinationQA(snapshot),
  runStoryboardVideoUnitCoordinationQA(snapshot),
  runStyleStrategyCoordinationQA(snapshot),
  runCreativeCommercialCoordinationQA(snapshot),
  runMediaReadinessCoordinationQA(snapshot),
  runDepartmentCoverageCoordinationQA(snapshot, departmentCoverage),
  runOperatorGovernanceCoordinationQA(snapshot, handoffManifest),
];

export const buildProductionCoordinationReport = (
  input: ProductionCoordinationSnapshotInput,
): ProductionCoordinationReport => {
  const snapshot = buildProductionCoordinationSnapshot(input);
  const handoffManifest = buildDepartmentHandoffManifest(snapshot);
  const departmentCoverage = buildProductionDepartmentCoverage(snapshot);
  const departmentFindings = runProductionDepartmentCoordinationQA(snapshot, handoffManifest, departmentCoverage);
  const blockingIssues = departmentFindings
    .filter((item) => item.severity === "blocking")
    .map(issueFromFinding);
  const preferredRepairMode = environmentRepairMode(snapshot.environment);
  const repairTickets = buildCoordinationRepairTickets({
    departmentFindings,
    repairMode: preferredRepairMode,
    previousTickets: snapshot.previousRepairTickets,
    createdAt: snapshot.capturedAt,
  });
  const sourceRefs = [
    projectRef(snapshot.project),
    productionMemoryRef(snapshot.project),
    assetContinuityRef(snapshot.project),
    ...snapshot.episodes.map(episodeRef),
    ...snapshot.episodes.flatMap((episode) => asArray<Scene>(episode.scenes).map((scene) => sceneRef(episode.id, scene))),
    ...snapshot.episodes.flatMap((episode) => asArray<Scene>(episode.scenes).flatMap((scene) =>
      asArray<Shot>(scene.shots).map((shot) => shotRef(episode.id, scene.id, shot)),
    )),
    ...snapshot.operatorArtifacts.map(artifactRef),
    ...snapshot.qaReports.map(qaReportRef),
    ...snapshot.gateVerdicts.map(gateVerdictRef),
  ].filter(Boolean) as ProductionCoordinationSourceRef[];
  const coordinationTrace = buildProductionCoordinationTraceIndex({
    runId: snapshot.runId,
    stageId: snapshot.stageId,
    stageType: snapshot.stageType,
    sourceArtifactIds: snapshot.operatorArtifacts.map((artifact) => artifact.id),
    sourceRefs,
    departmentFindings,
    repairTickets,
    handoffManifest,
  });

  return {
    schemaVersion: "production-coordination-report.v1",
    id: nowId("production_coordination_report"),
    scope: snapshot.scope,
    projectId: snapshot.project.id,
    runId: snapshot.runId,
    stageId: snapshot.stageId,
    stageType: snapshot.stageType,
    episodeIds: snapshot.episodes.map((episode) => episode.id).filter(Boolean),
    sceneIds: snapshot.scenes.map((scene) => scene.id).filter(Boolean),
    shotIds: snapshot.shots.map((shot) => shot.id).filter(Boolean),
    capturedAt: snapshot.capturedAt,
    sourceArtifactIds: snapshot.operatorArtifacts.map((artifact) => artifact.id),
    sourceRefs,
    departmentFindings,
    blockingIssues,
    repairTickets,
    coordinationTrace,
    departmentCoverage,
    missingDepartmentPackages: departmentCoverage.missingDepartmentPackages,
    departmentQaSummary: departmentCoverage.departmentQaSummary,
    handoffManifest,
    approvalState: blockingIssues.length
      ? "blocked"
      : departmentFindings.some((item) => item.status === "warning")
        ? "ready_for_human_review"
        : "approved",
    environmentPolicy: {
      environment: snapshot.environment,
      preferredRepairMode,
      rationale: snapshot.environment === "test"
        ? "测试环境优先修通用代码、prompt、QA、schema 或流程，内容返工只用于验证闭环。"
        : snapshot.environment === "production"
          ? "生产环境优先生成内容返工草稿、版本 diff、审批记录和重试/人工接管记录。"
          : "开发环境先保守记录问题，由实现者判断进入代码修复、内容返工或人工接管。",
    },
    qaChecklist: [
      "统筹报告不改变正式 workflow stage。",
      "所有 sourceRefs 必须能回查到项目、分集、场景、镜头、Operator artifact、QA 或 gate。",
      "handoffManifest 必须列出可读、阻断和缺失的交接项。",
      "blocking issue 不能被标记为 approved。",
    ],
    summary: `统筹范围 ${snapshot.scope} 覆盖 ${snapshot.episodes.length} 集、${snapshot.scenes.length} 场、${snapshot.shots.length} 镜头、${snapshot.operatorArtifacts.length} 个 Operator artifact。`,
  };
};

export const buildProductionCoordinationStageGate = (
  input: ProductionCoordinationSnapshotInput & {
    previousReports?: ProductionCoordinationReport[];
  },
): ProductionCoordinationGateResult => {
  const previousReports = input.previousReports || [];
  const previousRepairTickets = [
    ...previousReports.flatMap((report) => asArray<CoordinationRepairTicket>(report.repairTickets)),
    ...asArray<CoordinationRepairTicket>(input.previousRepairTickets),
  ];
  const report = buildProductionCoordinationReport({
    ...input,
    scope: "stage_exit",
    previousRepairTickets,
  });
  const circuitBreaker = evaluateCoordinationCircuitBreaker(report, previousReports);
  const blocking = report.approvalState === "blocked" ||
    asArray<ProductionQAIssue>(report.blockingIssues).some((item) => item.severity === "blocking");
  const canProceed = !blocking && circuitBreaker.status === "clear";
  const nextAction: ProductionCoordinationGateResult["nextAction"] = canProceed
    ? "proceed"
    : circuitBreaker.humanInterventionRequired
      ? circuitBreaker.status === "blocked" ? "blocked" : "human_review"
      : "repair";
  const humanInterventionTasks = buildCoordinationHumanInterventionTasks(report, circuitBreaker);
  const coordinationTrace = buildProductionCoordinationTraceIndex({
    runId: report.runId,
    stageId: report.stageId,
    stageType: report.stageType,
    sourceArtifactIds: report.sourceArtifactIds,
    sourceRefs: report.sourceRefs,
    departmentFindings: report.departmentFindings,
    repairTickets: report.repairTickets,
    handoffManifest: report.handoffManifest,
    humanInterventionTasks,
  });
  const tracedReport: ProductionCoordinationReport = {
    ...report,
    coordinationTrace,
  };

  return {
    report: tracedReport,
    blocking,
    canProceed,
    nextAction,
    repairTickets: tracedReport.repairTickets,
    coordinationTrace,
    circuitBreaker,
    humanInterventionTasks,
    reason: canProceed
      ? "阶段出口统筹 QA 通过，可以进入下一阶段。"
      : circuitBreaker.reason,
  };
};

export const buildProductionCoordinationWrapQA = (
  input: ProductionCoordinationSnapshotInput & {
    previousReports?: ProductionCoordinationReport[];
    scope?: Extract<ProductionCoordinationScope, "episode_wrap" | "phase_wrap">;
  },
): ProductionCoordinationGateResult => {
  const previousReports = input.previousReports || [];
  const previousRepairTickets = [
    ...previousReports.flatMap((report) => asArray<CoordinationRepairTicket>(report.repairTickets)),
    ...asArray<CoordinationRepairTicket>(input.previousRepairTickets),
  ];
  const report = buildProductionCoordinationReport({
    ...input,
    scope: input.scope || "episode_wrap",
    previousRepairTickets,
  });
  const circuitBreaker = evaluateCoordinationCircuitBreaker(report, previousReports);
  const blocking = report.approvalState === "blocked" ||
    asArray<ProductionQAIssue>(report.blockingIssues).some((item) => item.severity === "blocking");
  const canProceed = !blocking && circuitBreaker.status === "clear";
  const nextAction: ProductionCoordinationGateResult["nextAction"] = canProceed
    ? "proceed"
    : circuitBreaker.humanInterventionRequired
      ? circuitBreaker.status === "blocked" ? "blocked" : "human_review"
      : "repair";
  const humanInterventionTasks = buildCoordinationHumanInterventionTasks(report, circuitBreaker);
  const coordinationTrace = buildProductionCoordinationTraceIndex({
    runId: report.runId,
    stageId: report.stageId,
    stageType: report.stageType,
    sourceArtifactIds: report.sourceArtifactIds,
    sourceRefs: report.sourceRefs,
    departmentFindings: report.departmentFindings,
    repairTickets: report.repairTickets,
    handoffManifest: report.handoffManifest,
    humanInterventionTasks,
  });
  const tracedReport: ProductionCoordinationReport = {
    ...report,
    coordinationTrace,
  };

  return {
    report: tracedReport,
    blocking,
    canProceed,
    nextAction,
    repairTickets: tracedReport.repairTickets,
    coordinationTrace,
    circuitBreaker,
    humanInterventionTasks,
    reason: canProceed
      ? "整集/整段统筹 QA 通过，可以标记当前生产批次完成。"
      : circuitBreaker.reason,
  };
};

export const validateCoordinationRepairTickets = (
  tickets: Partial<CoordinationRepairTicket>[] | undefined,
): ProductionQAIssue[] => {
  if (!Array.isArray(tickets) || tickets.length === 0) {
    return [issue("coordinationRepairTickets", "coordination_repair_ticket artifact 必须包含至少一张返工单。", "blocking")];
  }
  const issues: ProductionQAIssue[] = [];
  const validRepairModes: ProductionRepairMode[] = [
    "test_fix_code_prompt_qa_or_workflow",
    "production_content_draft",
    "manual_intervention",
    "waiver_request",
  ];
  const validStatuses: CoordinationRepairTicket["status"][] = ["open", "in_progress", "resolved", "blocked"];
  const validRepairClassifications: ProductionRepairClassification[] = [
    "content",
    "code",
    "prompt",
    "qa",
    "workflow",
    "schema",
    "manual",
    "waiver",
  ];
  const validResolutionClasses: Array<NonNullable<CoordinationRepairTicket["resolutionClass"]>> = [
    "hard_blocking",
    "auto_repairable",
    "soft_hold",
    "advisory",
  ];
  tickets.forEach((ticket, index) => {
    const target = `coordinationRepairTickets.${ticket?.id || index}`;
    if (!isNonEmpty(ticket?.id)) issues.push(issue(`${target}.id`, "返工单缺少 id。", "blocking"));
    if (!isNonEmpty(ticket?.issueId)) issues.push(issue(`${target}.issueId`, "返工单缺少 issueId。", "blocking"));
    if (!isNonEmpty(ticket?.ownerAgentId)) issues.push(issue(`${target}.ownerAgentId`, "返工单缺少 ownerAgentId。", "blocking"));
    if (!isNonEmpty(ticket?.suggestedStageType)) issues.push(issue(`${target}.suggestedStageType`, "返工单缺少 suggestedStageType。", "blocking"));
    if (!isNonEmpty(ticket?.targetPath)) issues.push(issue(`${target}.targetPath`, "返工单缺少 targetPath。", "blocking"));
    if (!ticket?.repairMode || !validRepairModes.includes(ticket.repairMode)) {
      issues.push(issue(`${target}.repairMode`, "返工单 repairMode 不合法。", "blocking"));
    }
    if (!ticket?.repairClassification || !validRepairClassifications.includes(ticket.repairClassification)) {
      issues.push(issue(`${target}.repairClassification`, "返工单必须声明 repairClassification，用于区分内容、代码、prompt、QA、schema 或流程修复。", "blocking"));
    }
    if (!isNonEmpty(ticket?.issueFingerprint)) {
      issues.push(issue(`${target}.issueFingerprint`, "返工单必须记录 issueFingerprint，便于追溯同类问题。", "blocking"));
    }
    if (!Array.isArray(ticket?.sourceArtifactIds)) {
      issues.push(issue(`${target}.sourceArtifactIds`, "返工单必须包含 sourceArtifactIds 数组；没有来源 artifact 时也要显式为空数组。", "blocking"));
    }
    if (ticket?.repairMode === "production_content_draft" && ticket.repairClassification !== "content") {
      issues.push(issue(`${target}.repairClassification`, "生产环境返工必须优先生成内容修复单，不能默认修代码/prompt/QA。", "blocking"));
    }
    if (ticket?.repairMode === "test_fix_code_prompt_qa_or_workflow" && ticket.repairClassification === "content") {
      issues.push(issue(`${target}.repairClassification`, "测试环境返工应优先定位代码、prompt、QA、schema 或流程缺陷，不能只改内容绕过系统问题。", "blocking"));
    }
    if (!isNonEmpty(ticket?.repairInstruction)) issues.push(issue(`${target}.repairInstruction`, "返工单缺少 repairInstruction。", "blocking"));
    if (!Number.isFinite(ticket?.maxRetries) || Number(ticket?.maxRetries) < 0) {
      issues.push(issue(`${target}.maxRetries`, "返工单 maxRetries 必须是非负数。", "blocking"));
    }
    if (!Number.isFinite(ticket?.retryCount) || Number(ticket?.retryCount) < 0) {
      issues.push(issue(`${target}.retryCount`, "返工单 retryCount 必须是非负数。", "blocking"));
    }
    if (Number(ticket?.retryCount || 0) > Number(ticket?.maxRetries || 0)) {
      issues.push(issue(`${target}.retryCount`, "返工单 retryCount 不能超过 maxRetries。", "blocking"));
    }
    if (!ticket?.status || !validStatuses.includes(ticket.status)) {
      issues.push(issue(`${target}.status`, "返工单 status 不合法。", "blocking"));
    }
    if (ticket?.resolutionClass && !validResolutionClasses.includes(ticket.resolutionClass)) {
      issues.push(issue(`${target}.resolutionClass`, "返工单 resolutionClass 不合法。", "blocking"));
    }
    if (ticket?.status === "blocked" && !isNonEmpty(ticket.humanEscalationReason)) {
      issues.push(issue(`${target}.humanEscalationReason`, "blocked 返工单必须说明人工升级原因。", "blocking"));
    }
  });
  return issues;
};

export const validateProductionCoordinationReport = (
  report: Partial<ProductionCoordinationReport> | undefined,
): ProductionQAIssue[] => {
  if (!report || typeof report !== "object") {
    return [issue("productionCoordinationReport", "production_coordination_report artifact 必须包含 data.productionCoordinationReport。", "blocking")];
  }

  const issues: ProductionQAIssue[] = [];
  if (report.schemaVersion !== "production-coordination-report.v1") {
    issues.push(issue("productionCoordinationReport.schemaVersion", "统筹报告 schemaVersion 必须为 production-coordination-report.v1。", "blocking"));
  }
  if (!isNonEmpty(report.id)) issues.push(issue("productionCoordinationReport.id", "统筹报告缺少 id。", "blocking"));
  if (!isNonEmpty(report.projectId)) issues.push(issue("productionCoordinationReport.projectId", "统筹报告缺少 projectId。", "blocking"));
  if (!["stage_exit", "episode_wrap", "phase_wrap", "manual_audit"].includes(report.scope || "")) {
    issues.push(issue("productionCoordinationReport.scope", "统筹报告 scope 不合法。", "blocking"));
  }
  if (!Number.isFinite(report.capturedAt || NaN) || Number(report.capturedAt) <= 0) {
    issues.push(issue("productionCoordinationReport.capturedAt", "统筹报告缺少 capturedAt。", "blocking"));
  }
  if (!Array.isArray(report.sourceRefs) || report.sourceRefs.length === 0) {
    issues.push(issue("productionCoordinationReport.sourceRefs", "统筹报告必须包含 sourceRefs，保证可回查。", "blocking"));
  } else {
    report.sourceRefs.forEach((ref, index) => {
      if (!isNonEmpty(ref?.kind) || !isNonEmpty(ref?.targetPath)) {
        issues.push(issue(`productionCoordinationReport.sourceRefs.${index}`, "sourceRef 必须包含 kind 和 targetPath。", "blocking"));
      }
    });
  }
  if (!Array.isArray(report.departmentFindings) || report.departmentFindings.length === 0) {
    issues.push(issue("productionCoordinationReport.departmentFindings", "统筹报告必须包含部门 findings。", "blocking"));
  }
  const requiredDepartments: ProductionDepartmentFinding["department"][] = [
    "asset",
    "continuity",
    "storyboard_video_unit",
    "style_strategy",
    "creative_commercial",
    "media_readiness",
    "department_coverage",
    "operator_governance",
  ];
  for (const department of requiredDepartments) {
    if (!report.departmentFindings?.some((finding) => finding.department === department)) {
      issues.push(issue(`productionCoordinationReport.departmentFindings.${department}`, `统筹报告缺少 ${department} finding。`, "warning"));
    }
  }
  if (!report.handoffManifest?.id) {
    issues.push(issue("productionCoordinationReport.handoffManifest", "统筹报告必须包含 handoffManifest。", "blocking"));
  }
  if (!Array.isArray(report.handoffManifest?.allowedArtifactRefs)) {
    issues.push(issue("productionCoordinationReport.handoffManifest.allowedArtifactRefs", "handoffManifest.allowedArtifactRefs 必须是数组。", "blocking"));
  }
  if (!Array.isArray(report.handoffManifest?.blockedRefs)) {
    issues.push(issue("productionCoordinationReport.handoffManifest.blockedRefs", "handoffManifest.blockedRefs 必须是数组。", "blocking"));
  }
  if (!Array.isArray(report.handoffManifest?.missingRefs)) {
    issues.push(issue("productionCoordinationReport.handoffManifest.missingRefs", "handoffManifest.missingRefs 必须是数组。", "blocking"));
  }
  if (!report.environmentPolicy?.environment || !report.environmentPolicy?.preferredRepairMode) {
    issues.push(issue("productionCoordinationReport.environmentPolicy", "统筹报告必须声明环境与优先返工策略。", "blocking"));
  }
  if (report.departmentCoverage?.schemaVersion !== "production-department-coverage.v1") {
    issues.push(issue("productionCoordinationReport.departmentCoverage", "统筹报告必须包含 production-department-coverage.v1 部门覆盖率。", "blocking"));
  } else {
    if (!Array.isArray(report.departmentCoverage.departments) || report.departmentCoverage.departments.length === 0) {
      issues.push(issue("productionCoordinationReport.departmentCoverage.departments", "departmentCoverage.departments 必须列出被统筹的部门。", "blocking"));
    }
    if (!Array.isArray(report.departmentCoverage.departmentQaSummary)) {
      issues.push(issue("productionCoordinationReport.departmentCoverage.departmentQaSummary", "departmentCoverage.departmentQaSummary 必须是数组。", "blocking"));
    }
    if (!Array.isArray(report.departmentCoverage.perSceneReadiness)) {
      issues.push(issue("productionCoordinationReport.departmentCoverage.perSceneReadiness", "departmentCoverage.perSceneReadiness 必须是数组。", "blocking"));
    }
    for (const missing of asArray<ProductionMissingDepartmentPackage>(report.departmentCoverage.missingDepartmentPackages)) {
      if (!isNonEmpty(missing.department) || !isNonEmpty(missing.targetPath) || !isNonEmpty(missing.reason)) {
        issues.push(issue("productionCoordinationReport.departmentCoverage.missingDepartmentPackages", "缺失部门包必须包含 department、targetPath 和 reason。", "blocking"));
      }
      if (missing.severity === "blocking" && missing.resolutionClass !== "hard_blocking") {
        issues.push(issue(`productionCoordinationReport.departmentCoverage.${missing.department}.resolutionClass`, "blocking 的缺失部门包必须标记 hard_blocking。", "blocking"));
      }
    }
  }
  if (!Array.isArray(report.missingDepartmentPackages)) {
    issues.push(issue("productionCoordinationReport.missingDepartmentPackages", "统筹报告必须显式返回 missingDepartmentPackages 数组。", "blocking"));
  }
  if (!Array.isArray(report.departmentQaSummary)) {
    issues.push(issue("productionCoordinationReport.departmentQaSummary", "统筹报告必须显式返回 departmentQaSummary 数组。", "blocking"));
  }
  const hasBlocking = asArray<ProductionQAIssue>(report.blockingIssues).length > 0 ||
    asArray<ProductionDepartmentFinding>(report.departmentFindings).some((finding) => finding.severity === "blocking");
  if (hasBlocking && report.approvalState === "approved") {
    issues.push(issue("productionCoordinationReport.approvalState", "存在 blocking issue 的统筹报告不能标记 approved。", "blocking"));
  }
  if (hasBlocking && asArray<CoordinationRepairTicket>(report.repairTickets).length === 0) {
    issues.push(issue("productionCoordinationReport.repairTickets", "存在 blocking issue 的统筹报告必须生成 repairTickets。", "blocking"));
  }
  issues.push(...validateCoordinationRepairTickets(asArray<CoordinationRepairTicket>(report.repairTickets))
    .filter(() => asArray<CoordinationRepairTicket>(report.repairTickets).length > 0));
  issues.push(...validateProductionCoordinationTraceIndex(report.coordinationTrace, {
    departmentFindings: asArray<ProductionDepartmentFinding>(report.departmentFindings),
    repairTickets: asArray<CoordinationRepairTicket>(report.repairTickets),
  }));
  for (const ticket of asArray<CoordinationRepairTicket>(report.repairTickets)) {
    if (!isNonEmpty(ticket.id) || !isNonEmpty(ticket.ownerAgentId) || !isNonEmpty(ticket.targetPath)) {
      issues.push(issue(`productionCoordinationReport.repairTickets.${ticket.id || "unknown"}`, "返工单必须包含 id、ownerAgentId 和 targetPath。", "blocking"));
    }
    if (ticket.retryCount > ticket.maxRetries) {
      issues.push(issue(`productionCoordinationReport.repairTickets.${ticket.id}`, "返工单 retryCount 不能超过 maxRetries。", "blocking"));
    }
  }
  return issues;
};

export const buildProductionCoordinationSystem = () => ({
  status: "production_coordination_contract_available_operator_artifact_only",
  artifactKind: "production_coordination_report",
  schemaVersion: "production-coordination-report.v1",
  qaFunction: "validateProductionCoordinationReport",
  snapshotFunction: "buildProductionCoordinationSnapshot",
  reportFunction: "buildProductionCoordinationReport",
  departmentQaFunction: "runProductionDepartmentCoordinationQA",
  departmentCoverageFunction: "buildProductionDepartmentCoverage",
  departmentCoverageSchema: "production-department-coverage.v1",
  departmentQaAgents: {
    asset: "runAssetCoordinationQA",
    continuity: "runContinuityCoordinationQA",
    storyboard_video_unit: "runStoryboardVideoUnitCoordinationQA",
    style_strategy: "runStyleStrategyCoordinationQA",
    creative_commercial: "runCreativeCommercialCoordinationQA",
    media_readiness: "runMediaReadinessCoordinationQA",
    department_coverage: "runDepartmentCoverageCoordinationQA",
    operator_governance: "runOperatorGovernanceCoordinationQA",
  },
  repairTicketArtifactKind: "coordination_repair_ticket",
  repairTicketFunction: "buildCoordinationRepairTickets",
  repairTicketQaFunction: "validateCoordinationRepairTickets",
  traceSchemaVersion: "production-coordination-trace.v1",
  traceFunction: "buildProductionCoordinationTraceIndex",
  traceQaFunction: "validateProductionCoordinationTraceIndex",
  qaSeverityPolicyId: QA_SEVERITY_POLICY_ID,
  qaResolutionClasses: ["hard_blocking", "auto_repairable", "soft_hold", "advisory"],
  stageGateFunction: "buildProductionCoordinationStageGate",
  wrapQaFunction: "buildProductionCoordinationWrapQA",
  circuitBreakerFunction: "evaluateCoordinationCircuitBreaker",
  commitBehavior: "operator_artifact_only",
  scopes: ["stage_exit", "episode_wrap", "phase_wrap", "manual_audit"],
  departments: ["asset", "continuity", "storyboard_video_unit", "style_strategy", "creative_commercial", "media_readiness", "department_coverage", "operator_governance"],
  coordinatedPrepDepartments: PRODUCTION_PREP_CANONICAL_DEPARTMENTS,
  legacyPrepDepartmentAliases: PRODUCTION_PREP_DEPARTMENT_ALIASES,
  legacyPrepDepartments: PRODUCTION_PREP_LEGACY_DEPARTMENTS,
  coordinationTargets: [
    "production_breakdown_report",
    "casting_requirement",
    "casting_decision",
    "department_prep_package",
    "continuity_matrix",
    "formal_asset_package",
    "scene_visual_pack",
    "storyboard_board",
    "asset_reference_pack",
    "video_generation_unit",
    "style_reference_analysis",
    "visual_style_lock_candidate",
    "style_lock_change_order",
    "storyboard_strategy_draft",
    "storyboard_strategy_draft_trial",
  ],
  coordinationPoints: DEPARTMENT_COORDINATION_POINTS,
  requiredBehavior: [
    "Do not create a new formal workflow stage.",
    "Use stage gate and wrap QA functions as blocking decisions for coordination checks without reordering canonical stages.",
    "Coordinate all department agents at production_breakdown, production_asset_detail, asset_sync, storyboard, prompt, and expensive_generation_planning exits, plus episode/block wrap scopes.",
    "Generate handoff manifests from persisted project, episode, scene, shot, QA, gate, and Operator artifact data.",
    "Use test_fix_code_prompt_qa_or_workflow in test environments and production_content_draft in production environments.",
    "Repair tickets must carry repairClassification, issueFingerprint, sourceArtifactIds, and sourceStageType so production fixes edit content while test fixes target code, prompt, QA, schema, or workflow defects.",
    "production_coordination_report must include coordinationTrace linking department findings, source artifacts, QA reports, gate verdicts, handoff manifest, repair tickets, and human intervention tasks for local recovery.",
    "Generate coordination repair tickets for blocking findings and stop automatic retry when the circuit breaker requires human intervention.",
    "Classify QA findings before automation: hard_blocking requires human judgment, auto_repairable may retry, soft_hold stays visible without circuit breaker, advisory never blocks.",
    "Expose departmentCoverage, missingDepartmentPackages, departmentQaSummary, and per-scene readiness from production_coordination_report and reuse them in production-cockpit instead of recalculating in UI.",
    "Check styleLockVersion, visualStyleLockRefs, storyboardStrategyOrigin/id, annotationLegendVersion, approved style_lock_change_order, storyboard_strategy_draft provenance, and passed storyboard_strategy_draft_trial before media generation.",
    "Expand legacy wardrobe_makeup/location_art packages for coverage, but require specialistPayload on new professional department packages before treating them as production-ready.",
  ],
});
