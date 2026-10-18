import {
  AgentDefinition,
  AgentRetryAttempt,
  ArtifactEnvelope,
  ArtifactEnvelopeStatus,
  HumanInterventionTask,
  QAVerdict,
  RetryDecision,
  RetryPolicy,
  WorkflowStepDefinition,
  WorkflowTrigger,
} from "../../types/production";
import {
  findProductionAgent,
  findWorkflowStepDefinition,
  productionAgentRegistry,
} from "./agents";
import {
  createHumanInterventionTask,
  evaluateRetryDecision,
  findRetryPolicy,
} from "./retryManager";
import { normalizeProductionQAIssues } from "./qaIssue";
import { logRuntimeEvent } from "../runtimeLogger";

export interface AgentGatewayProducerContext<TInput> {
  agentRunId: string;
  trigger: WorkflowTrigger;
  input: TInput;
  step: WorkflowStepDefinition;
  producerAgent: AgentDefinition;
}

export interface AgentGatewayQAContext<TInput, TData> {
  agentRunId: string;
  trigger: WorkflowTrigger;
  input: TInput;
  draft: ArtifactEnvelope<TData>;
  step: WorkflowStepDefinition;
  qaAgent: AgentDefinition;
}

export type AgentProducerHandler<TInput, TData> = (
  context: AgentGatewayProducerContext<TInput>,
) => TData | ArtifactEnvelope<TData> | Promise<TData | ArtifactEnvelope<TData>>;

export type AgentQAHandler<TInput, TData> = (
  context: AgentGatewayQAContext<TInput, TData>,
) => Partial<QAVerdict> | Promise<Partial<QAVerdict>>;

export interface RunAgentGatewayStepOptions<TInput, TData> {
  workflowStepId: string;
  trigger?: WorkflowTrigger;
  input: TInput;
  producer: AgentProducerHandler<TInput, TData>;
  qaHandlers: Record<string, AgentQAHandler<TInput, TData>>;
  retryHistory?: AgentRetryAttempt[];
  retryPolicy?: RetryPolicy;
  contextFingerprint?: string;
  artifactKind?: string;
  targetPath?: string;
  entityIds?: string[];
  agentRegistry?: AgentDefinition[];
  workflowStepRegistry?: WorkflowStepDefinition[];
}

export interface AgentGatewayResult<TData> {
  agentRunId: string;
  step: WorkflowStepDefinition;
  producerAgent: AgentDefinition;
  draft: ArtifactEnvelope<TData>;
  qaVerdicts: QAVerdict[];
  retryDecision: RetryDecision;
  humanInterventionTask?: HumanInterventionTask;
}

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

const fingerprintValue = (value: unknown) =>
  `fp.${stableHash(stableStringify(value))}`;

const isArtifactEnvelope = <TData>(value: TData | ArtifactEnvelope<TData>): value is ArtifactEnvelope<TData> =>
  Boolean(value) && typeof value === "object" && "provenance" in value && "status" in value && "data" in value;

const resolveStep = (
  workflowStepId: string,
  registry?: WorkflowStepDefinition[],
) => {
  const step = registry?.find((item) => item.id === workflowStepId) || findWorkflowStepDefinition(workflowStepId);
  if (!step) throw new Error(`Unknown workflow step: ${workflowStepId}`);
  return step;
};

const resolveAgent = (
  agentId: string,
  registry: AgentDefinition[] = productionAgentRegistry,
) => {
  const agent = registry.find((item) => item.id === agentId) || findProductionAgent(agentId);
  if (!agent) throw new Error(`Unknown production agent: ${agentId}`);
  return agent;
};

const normalizeVerdict = (
  agentRunId: string,
  qaAgent: AgentDefinition,
  raw: Partial<QAVerdict>,
): QAVerdict => {
  const issues = normalizeProductionQAIssues(raw.issues || []);
  const blocking = raw.blocking ?? issues.some((issue) => issue.severity === "blocking");
  const status = raw.status || (blocking ? "failed" : issues.length ? "warning" : "passed");
  return {
    qaAgentId: raw.qaAgentId || qaAgent.id,
    status,
    blocking,
    score: raw.score ?? (blocking ? 0 : issues.length ? 75 : 100),
    issues,
    nextAction: raw.nextAction || (blocking ? "retry" : "commit"),
    createdAt: raw.createdAt || Date.now(),
  };
};

const statusFromDecision = (decision: RetryDecision): ArtifactEnvelopeStatus => {
  if (decision.nextAction === "commit") return "approved";
  if (decision.humanInterventionRequired) return "quarantined";
  return "qa_failed";
};

export const runAgentGatewayStep = async <TInput, TData>(
  options: RunAgentGatewayStepOptions<TInput, TData>,
): Promise<AgentGatewayResult<TData>> => {
  const step = resolveStep(options.workflowStepId, options.workflowStepRegistry);
  const trigger = options.trigger || step.trigger;
  const producerAgent = resolveAgent(step.producerAgentId, options.agentRegistry);
  const agentRunId = `agent-run-${Date.now()}-${crypto.randomUUID()}`;
  const contextFingerprint = options.contextFingerprint || fingerprintValue(options.input);

  logRuntimeEvent({
    source: "agent",
    event: "agent.gateway.producer.start",
    agentRunId,
    agentId: producerAgent.id,
    status: "running",
    message: `${producerAgent.name} started ${step.id}`,
    details: {
      workflowStepId: step.id,
      trigger,
      artifactTypes: step.artifactTypes,
      contextFingerprint,
    },
  });
  const produced = await options.producer({
    agentRunId,
    trigger,
    input: options.input,
    step,
    producerAgent,
  });

  const draft: ArtifactEnvelope<TData> = isArtifactEnvelope(produced)
    ? {
        ...produced,
        provenance: {
          ...produced.provenance,
          agentRunId,
          contextFingerprint,
        },
      }
    : {
        id: `artifact-envelope-${Date.now()}-${crypto.randomUUID()}`,
        kind: options.artifactKind || step.artifactTypes[0] || "unknown",
        targetPath: options.targetPath || step.id,
        entityIds: options.entityIds || [],
        status: "draft",
        data: produced,
        provenance: {
          agentRunId,
          modelRoute: producerAgent.modelRoute,
          contextFingerprint,
        },
        createdAt: Date.now(),
      };

  logRuntimeEvent({
    source: "agent",
    event: "agent.gateway.producer.finish",
    agentRunId,
    agentId: producerAgent.id,
    status: draft.status,
    message: `${producerAgent.name} produced ${draft.kind}`,
    details: {
      workflowStepId: step.id,
      artifactId: draft.id,
      artifactKind: draft.kind,
      targetPath: draft.targetPath,
      entityCount: draft.entityIds.length,
    },
  });

  const qaVerdicts = await Promise.all(step.qaAgentIds.map(async (qaAgentId) => {
    const qaAgent = resolveAgent(qaAgentId, options.agentRegistry);
    const handler = options.qaHandlers[qaAgentId];
    if (!handler) throw new Error(`Missing QA handler for ${qaAgentId}`);
    logRuntimeEvent({
      source: "qa",
      event: "agent.gateway.qa.start",
      agentRunId,
      agentId: producerAgent.id,
      qaAgentId: qaAgent.id,
      status: "running",
      message: `${qaAgent.name} checking ${draft.kind}`,
      details: {
        workflowStepId: step.id,
        artifactId: draft.id,
      },
    });
    const rawVerdict = await handler({
      agentRunId,
      trigger,
      input: options.input,
      draft,
      step,
      qaAgent,
    });
    const verdict = normalizeVerdict(agentRunId, qaAgent, rawVerdict);
    logRuntimeEvent({
      source: "qa",
      event: "agent.gateway.qa.finish",
      level: verdict.blocking ? "warn" : "info",
      agentRunId,
      agentId: producerAgent.id,
      qaAgentId: qaAgent.id,
      status: verdict.status,
      details: {
        workflowStepId: step.id,
        score: verdict.score,
        blocking: verdict.blocking,
        issueCount: verdict.issues.length,
        nextAction: verdict.nextAction,
      },
    });
    return verdict;
  }));

  const retryPolicy = options.retryPolicy || findRetryPolicy(producerAgent.retryPolicyId);
  const retryDecision = evaluateRetryDecision(
    retryPolicy,
    qaVerdicts,
    options.retryHistory || [],
    fingerprintValue(draft.data),
  );
  const finalDraft = {
    ...draft,
    status: statusFromDecision(retryDecision),
  };
  const humanInterventionTask = retryDecision.humanInterventionRequired
    ? createHumanInterventionTask(step.id, agentRunId, retryDecision, qaVerdicts)
    : undefined;

  logRuntimeEvent({
    source: "agent",
    event: "agent.gateway.retry_decision",
    level: retryDecision.nextAction === "commit" ? "info" : "warn",
    agentRunId,
    agentId: producerAgent.id,
    status: finalDraft.status,
    message: `AgentGateway decision: ${retryDecision.nextAction}`,
    details: {
      workflowStepId: step.id,
      nextAction: retryDecision.nextAction,
      humanInterventionRequired: retryDecision.humanInterventionRequired,
      qaVerdictCount: qaVerdicts.length,
      finalArtifactStatus: finalDraft.status,
    },
  });

  return {
    agentRunId,
    step,
    producerAgent,
    draft: finalDraft,
    qaVerdicts,
    retryDecision,
    humanInterventionTask,
  };
};
