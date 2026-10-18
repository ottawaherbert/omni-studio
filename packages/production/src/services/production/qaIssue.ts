import {
  QAIssueResolutionClass,
  ProductionQAIssue,
  ProductionQAReport,
} from "../../../../../src/types/production";

export const QA_SEVERITY_POLICY_ID = "qa-severity-policy.v1";

const nonRetryableIssueTypes = new Set([
  "input_missing",
  "data_conflict",
  "policy_violation",
  "contract_violation",
]);

const hardBlockingIssueTypes = new Set([
  "contract_violation",
  "policy_violation",
  "media_provenance",
  "media_readiness_coordination",
  "operator_governance_coordination",
]);

const normalizeFingerprintPart = (value: string | undefined) =>
  (value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const createQAIssueFingerprint = (issue: Pick<ProductionQAIssue, "target" | "message" | "severity" | "issueType">) => {
  const raw = [
    issue.issueType || "generic",
    issue.severity,
    normalizeFingerprintPart(issue.target),
    normalizeFingerprintPart(issue.message),
  ].join("|");
  return `qa.${stableHash(raw)}`;
};

export const isQAIssueRetryable = (issue: ProductionQAIssue) => {
  if (typeof issue.retryable === "boolean") return issue.retryable;
  if (issue.issueType && nonRetryableIssueTypes.has(issue.issueType)) return false;
  if (issue.severity === "info") return false;
  return true;
};

export const classifyQAIssueResolution = (issue: ProductionQAIssue): QAIssueResolutionClass => {
  if (issue.resolutionClass) return issue.resolutionClass;
  if (issue.severity === "info") return "advisory";
  if (issue.severity === "warning") return "soft_hold";
  if (issue.retryable === false) return "hard_blocking";
  if (issue.issueType && hardBlockingIssueTypes.has(issue.issueType)) return "hard_blocking";
  return "auto_repairable";
};

export const normalizeProductionQAIssue = (
  issue: ProductionQAIssue,
): ProductionQAIssue => {
  const repairInstruction = issue.repairInstruction || issue.suggestion || issue.message;
  const retryable = isQAIssueRetryable(issue);
  const resolutionClass = classifyQAIssueResolution({ ...issue, retryable });
  return {
    ...issue,
    fingerprint: issue.fingerprint || createQAIssueFingerprint(issue),
    retryable,
    repairInstruction,
    resolutionClass,
    severityPolicyId: issue.severityPolicyId || QA_SEVERITY_POLICY_ID,
  };
};

export const normalizeProductionQAIssues = (
  issues: ProductionQAIssue[] = [],
): ProductionQAIssue[] => issues.map(normalizeProductionQAIssue);

export const normalizeProductionQAReport = <T extends Pick<ProductionQAReport, "issues"> & Partial<Pick<ProductionQAReport, "fixInstructions">>>(
  report: T,
): T => {
  const issues = normalizeProductionQAIssues(report.issues || []);
  return {
    ...report,
    issues,
    fixInstructions: report.fixInstructions || issues
      .filter((issue) => issue.severity === "blocking")
      .map((issue) => issue.repairInstruction || issue.message)
      .join("\n") || undefined,
  };
};
