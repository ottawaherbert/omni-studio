import type {
  ProductionCoordinationSourceRef,
  ProductionDepartmentFinding,
  ProductionQAIssue,
  ProductionStageType,
  QAStatus,
} from "../../../types/production";
import type { ProductionCoordinationSnapshot } from "../productionCoordination";
import { classifyQAIssueResolution, QA_SEVERITY_POLICY_ID } from "../qaIssue";

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const compact = (value: unknown) => String(value || "").trim();

const unique = <T>(values: T[]) => Array.from(new Set(values));

export const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export const isNonEmpty = (value: unknown) => compact(value).length > 0;

const projectRef = (snapshot: ProductionCoordinationSnapshot): ProductionCoordinationSourceRef => ({
  kind: "project",
  id: snapshot.project.id,
  targetPath: `projects.${snapshot.project.id}`,
});

const episodeRef = (episode: ProductionCoordinationSnapshot["episodes"][number]): ProductionCoordinationSourceRef => ({
  kind: "episode",
  id: episode.id,
  targetPath: `episodes.${episode.id}`,
});

const artifactRef = (artifact: ProductionCoordinationSnapshot["operatorArtifacts"][number]): ProductionCoordinationSourceRef => ({
  kind: "operator_artifact",
  id: artifact.id,
  artifactKind: artifact.kind,
  targetPath: `operatorArtifacts.${artifact.id}`,
});

export const refsForSnapshot = (snapshot: ProductionCoordinationSnapshot): ProductionCoordinationSourceRef[] => [
  projectRef(snapshot),
  ...snapshot.episodes.map(episodeRef),
  ...snapshot.operatorArtifacts.map(artifactRef),
];

export const coordinationIssue = (
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

const uniqueIssuesByFingerprint = (issues: ProductionQAIssue[]): ProductionQAIssue[] => {
  const seen = new Set<string>();
  return issues.filter((item) => {
    const key = item.fingerprint || `${item.issueType || "coordination"}:${item.target}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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

export const departmentFindingFromIssues = (input: {
  department: ProductionDepartmentFinding["department"];
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

export const sourceArtifactIds = (finding: ProductionDepartmentFinding) =>
  unique(finding.evidenceRefs
    .filter((ref) => (ref.kind === "operator_artifact" || ref.artifactKind) && ref.id)
    .map((ref) => ref.id));

export const stableIssueId = (finding: ProductionDepartmentFinding) =>
  [
    "coordination",
    finding.department,
    finding.suggestedStageType || "unknown_stage",
    finding.target,
    compact(finding.message).slice(0, 160),
  ].join(":");
