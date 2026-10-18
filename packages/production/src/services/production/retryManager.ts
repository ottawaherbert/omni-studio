import {
  AgentRetryAttempt,
  HumanInterventionTask,
  QAVerdict,
  RetryDecision,
  RetryPolicy,
} from "../../../../../src/types/production";
import { normalizeProductionQAIssues } from "./qaIssue";

export const defaultAgentRetryPolicy: RetryPolicy = {
  id: "retry.default",
  maxAutoRetries: 2,
  maxModelFallbacks: 1,
  issueFingerprintWindow: 3,
  outputSimilarityThreshold: 0.92,
  minScoreDelta: 5,
  retryableIssueTypes: ["generic", "schema", "creative_quality", "format", "reference"],
  nonWaiveableGates: ["CONTRACT", "GRAPH", "PLAYTEST"],
};

export const strictContractRetryPolicy: RetryPolicy = {
  ...defaultAgentRetryPolicy,
  id: "retry.contract.strict",
  maxAutoRetries: 1,
  maxModelFallbacks: 0,
  retryableIssueTypes: ["schema", "contract"],
  nonWaiveableGates: ["CONTRACT"],
};

export const agentRetryPolicyRegistry: RetryPolicy[] = [
  defaultAgentRetryPolicy,
  strictContractRetryPolicy,
];

export const findRetryPolicy = (policyId: string) =>
  agentRetryPolicyRegistry.find((policy) => policy.id === policyId) || defaultAgentRetryPolicy;

const flattenBlockingIssues = (verdicts: QAVerdict[]) =>
  verdicts.flatMap((verdict) =>
    normalizeProductionQAIssues(verdict.issues || [])
      .filter((issue) => verdict.blocking || issue.severity === "blocking"),
  );

const lowestScore = (verdicts: QAVerdict[]) =>
  verdicts.reduce((score, verdict) => Math.min(score, verdict.score ?? 100), 100);

const countRecentFingerprint = (
  fingerprint: string,
  history: AgentRetryAttempt[],
  windowSize: number,
) =>
  history
    .slice(Math.max(0, history.length - windowSize))
    .filter((attempt) => attempt.issueFingerprints.includes(fingerprint))
    .length;

const modelFallbackCount = (history: AgentRetryAttempt[]) =>
  history.filter((attempt) => Boolean(attempt.modelRoute)).length;

const createDecision = (
  overrides: Partial<RetryDecision> & Pick<RetryDecision, "nextAction" | "reason">,
  issueFingerprints: string[],
  history: AgentRetryAttempt[],
): RetryDecision => ({
  shouldRetry: overrides.nextAction === "retry" || overrides.nextAction === "model_fallback",
  humanInterventionRequired: overrides.nextAction === "human_review" || overrides.nextAction === "blocked",
  retryable: overrides.nextAction === "retry" || overrides.nextAction === "model_fallback",
  stuckReason: overrides.stuckReason,
  issueFingerprints,
  retryCount: history.length,
  modelFallbackCount: modelFallbackCount(history),
  ...overrides,
});

export const evaluateRetryDecision = (
  policy: RetryPolicy,
  verdicts: QAVerdict[],
  history: AgentRetryAttempt[] = [],
  draftFingerprint?: string,
): RetryDecision => {
  const blockingIssues = flattenBlockingIssues(verdicts);
  const issueFingerprints = Array.from(new Set(blockingIssues.map((issue) => issue.fingerprint).filter(Boolean) as string[]));
  const currentScore = lowestScore(verdicts);

  if (!blockingIssues.length) {
    return createDecision(
      { nextAction: "commit", reason: "All blocking QA checks passed." },
      issueFingerprints,
      history,
    );
  }

  const hasNonRetryableIssue = blockingIssues.some((issue) => issue.retryable === false);
  if (hasNonRetryableIssue) {
    return createDecision(
      {
        nextAction: "human_review",
        reason: "Blocking QA includes a non-retryable issue.",
        stuckReason: "non_retryable_issue",
      },
      issueFingerprints,
      history,
    );
  }

  const retryLimit = policy.maxAutoRetries + policy.maxModelFallbacks;
  if (history.length >= retryLimit) {
    return createDecision(
      {
        nextAction: "human_review",
        reason: "Retry budget exhausted.",
        stuckReason: "retry_budget_exhausted",
      },
      issueFingerprints,
      history,
    );
  }

  const repeatedFingerprint = issueFingerprints.find((fingerprint) =>
    countRecentFingerprint(fingerprint, history, policy.issueFingerprintWindow) > 0,
  );
  const fallbackCount = modelFallbackCount(history);
  if (repeatedFingerprint && fallbackCount < policy.maxModelFallbacks) {
    return createDecision(
      {
        nextAction: "model_fallback",
        reason: `Blocking issue repeated: ${repeatedFingerprint}.`,
      },
      issueFingerprints,
      history,
    );
  }
  if (repeatedFingerprint) {
    return createDecision(
      {
        nextAction: "human_review",
        reason: `Blocking issue repeated after retry/fallback: ${repeatedFingerprint}.`,
        stuckReason: "same_issue_loop",
      },
      issueFingerprints,
      history,
    );
  }

  const previousAttempt = history.at(-1);
  if (previousAttempt && typeof previousAttempt.score === "number") {
    const scoreDelta = currentScore - previousAttempt.score;
    if (scoreDelta < policy.minScoreDelta) {
      return createDecision(
        {
          nextAction: "human_review",
          reason: `QA score improved by ${scoreDelta}, below policy minimum ${policy.minScoreDelta}.`,
          stuckReason: "score_delta_too_low",
        },
        issueFingerprints,
        history,
      );
    }
  }

  if (draftFingerprint && previousAttempt?.draftFingerprint === draftFingerprint) {
    return createDecision(
      {
        nextAction: "human_review",
        reason: "Draft fingerprint did not change while blocking QA still failed.",
        stuckReason: "unchanged_draft",
      },
      issueFingerprints,
      history,
    );
  }

  return createDecision(
    { nextAction: "retry", reason: "Blocking QA is retryable and retry budget remains." },
    issueFingerprints,
    history,
  );
};

export const createRetryAttempt = (
  attempt: number,
  verdicts: QAVerdict[],
  draftFingerprint?: string,
): AgentRetryAttempt => ({
  id: `agent-attempt-${Date.now()}-${crypto.randomUUID()}`,
  attempt,
  score: lowestScore(verdicts),
  issueFingerprints: Array.from(new Set(flattenBlockingIssues(verdicts).map((issue) => issue.fingerprint).filter(Boolean) as string[])),
  draftFingerprint,
  createdAt: Date.now(),
});

export const createHumanInterventionTask = (
  workflowStepId: string,
  agentRunId: string,
  decision: RetryDecision,
  verdicts: QAVerdict[],
): HumanInterventionTask => {
  const repairOptions = Array.from(new Set(
    verdicts
      .flatMap((verdict) => verdict.issues || [])
      .map((issue) => issue.repairInstruction || issue.suggestion || issue.message)
      .filter(Boolean),
  ));
  return {
    id: `human-intervention-${Date.now()}-${crypto.randomUUID()}`,
    workflowStepId,
    agentRunId,
    reason: decision.reason,
    issueFingerprints: decision.issueFingerprints,
    repairOptions,
    status: decision.nextAction === "blocked" ? "blocked" : "open",
    createdAt: Date.now(),
  };
};
