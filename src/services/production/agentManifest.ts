import type {
  AgentDefinition,
  ProductionArtifactType,
  ProductionStageType,
  WorkflowStepDefinition,
} from "../../types/production";

export type ProductionAgentManifestKind =
  | "stage"
  | "manual"
  | "linear"
  | "interactive"
  | "upstream_reference"
  | "qa"
  | "other";

export interface ProductionAgentModuleManifest {
  schemaVersion: "production-agent-module-manifest.v1";
  id: string;
  kind: ProductionAgentManifestKind;
  definition: AgentDefinition;
  workflowStepIds: string[];
  producerStepIds: string[];
  qaStepIds: string[];
  qaAgentIds: string[];
  producedArtifactTypes: ProductionArtifactType[];
  stageTypes: ProductionStageType[];
  modeTags: string[];
  capabilities: {
    summary: string;
    artifactKinds: ProductionArtifactType[];
    stageTypes: ProductionStageType[];
    modeTags: string[];
  };
  boundaries: {
    mayProduceDraftArtifacts: boolean;
    mayCommitCanonicalState: boolean;
    mustRunQa: boolean;
    allowedTools: string[];
  };
}

const unique = <T>(items: T[]) => Array.from(new Set(items));

const compact = (value: unknown) => String(value || "").trim();

const inferManifestKind = (agent: AgentDefinition): ProductionAgentManifestKind => {
  if (agent.role === "qa" || agent.id.startsWith("qa.") || agent.id.startsWith("rights.")) return "qa";
  if (agent.id.startsWith("manual.")) return "manual";
  if (agent.id.startsWith("linear.")) return "linear";
  if (agent.id.startsWith("interactive.")) return "interactive";
  if (/^(import|analysis|dna|skill|reference)\./.test(agent.id)) return "upstream_reference";
  if (agent.owns.startsWith("stage:")) return "stage";
  return "other";
};

const inferModeTags = (agent: AgentDefinition, steps: WorkflowStepDefinition[]): string[] => {
  const tags = new Set<string>();
  const kind = inferManifestKind(agent);
  tags.add(kind);
  tags.add(agent.role);
  if (agent.modelRoute) tags.add(`model:${agent.modelRoute}`);
  for (const stageType of agent.stageTypes || []) {
    tags.add(`stage:${stageType}`);
    if (stageType.startsWith("interactive_") || ["game_blueprint", "graph_generation", "interactive_graph_qa", "playtest_simulation"].includes(stageType)) {
      tags.add("interactive");
    } else {
      tags.add("linear");
    }
  }
  for (const step of steps) {
    if (step.trigger === "manual") tags.add("manual");
    if (step.trigger === "auto") tags.add("auto");
  }
  return Array.from(tags);
};

export const createProductionAgentModuleManifest = (
  agent: AgentDefinition,
  workflowSteps: WorkflowStepDefinition[],
): ProductionAgentModuleManifest => {
  const producerSteps = workflowSteps.filter((step) => step.producerAgentId === agent.id);
  const qaSteps = workflowSteps.filter((step) => step.qaAgentIds.includes(agent.id));
  const relatedSteps = unique([...producerSteps, ...qaSteps]);
  const producedArtifactTypes = agent.role === "qa"
    ? (["qa_report"] as ProductionArtifactType[])
    : unique(producerSteps.flatMap((step) => step.artifactTypes));
  const stageTypes = unique([
    ...(agent.stageTypes || []),
    ...relatedSteps.map((step) => step.stageType).filter(Boolean) as ProductionStageType[],
  ]);
  const qaAgentIds = agent.role === "qa"
    ? [agent.id]
    : unique(producerSteps.flatMap((step) => step.qaAgentIds));
  const modeTags = inferModeTags(agent, relatedSteps);
  const artifactKinds: ProductionArtifactType[] = producedArtifactTypes.length
    ? producedArtifactTypes
    : agent.role === "qa"
      ? ["qa_report"]
      : [];

  return {
    schemaVersion: "production-agent-module-manifest.v1",
    id: `agent-module.${agent.id}`,
    kind: inferManifestKind(agent),
    definition: agent,
    workflowStepIds: relatedSteps.map((step) => step.id),
    producerStepIds: producerSteps.map((step) => step.id),
    qaStepIds: qaSteps.map((step) => step.id),
    qaAgentIds,
    producedArtifactTypes,
    stageTypes,
    modeTags,
    capabilities: {
      summary: agent.description,
      artifactKinds,
      stageTypes,
      modeTags,
    },
    boundaries: {
      mayProduceDraftArtifacts: ["producer", "planner", "tool"].includes(agent.role),
      mayCommitCanonicalState: agent.role === "committer",
      mustRunQa: agent.role !== "qa",
      allowedTools: [...agent.allowedTools],
    },
  };
};

export const createProductionAgentModuleManifests = (
  agents: AgentDefinition[],
  workflowSteps: WorkflowStepDefinition[],
) => agents.map((agent) => createProductionAgentModuleManifest(agent, workflowSteps));

export const validateProductionAgentModuleManifests = (
  manifests: ProductionAgentModuleManifest[],
  workflowSteps: WorkflowStepDefinition[],
): string[] => {
  const issues: string[] = [];
  const manifestIds = new Set<string>();
  const agentIds = new Set<string>();

  for (const manifest of manifests) {
    if (manifest.schemaVersion !== "production-agent-module-manifest.v1") {
      issues.push(`${manifest.id || "(missing)"}: invalid schemaVersion`);
    }
    if (!compact(manifest.id)) issues.push("agent manifest missing id");
    if (manifestIds.has(manifest.id)) issues.push(`${manifest.id}: duplicate manifest id`);
    manifestIds.add(manifest.id);
    if (!compact(manifest.definition?.id)) issues.push(`${manifest.id}: missing definition.id`);
    if (agentIds.has(manifest.definition.id)) issues.push(`${manifest.definition.id}: duplicate manifest definition`);
    agentIds.add(manifest.definition.id);
    if (!compact(manifest.definition.inputContractId)) issues.push(`${manifest.id}: missing input contract`);
    if (!compact(manifest.definition.outputContractId)) issues.push(`${manifest.id}: missing output contract`);
    if (!compact(manifest.capabilities.summary)) issues.push(`${manifest.id}: missing capability summary`);
    if (!Array.isArray(manifest.boundaries.allowedTools)) issues.push(`${manifest.id}: allowedTools must be an array`);
    if (manifest.definition.role !== "qa" && manifest.producerStepIds.length > 0 && manifest.qaAgentIds.length === 0) {
      issues.push(`${manifest.id}: producer/planner step has no QA agents`);
    }
    if (manifest.definition.role === "qa" && manifest.boundaries.mayProduceDraftArtifacts) {
      issues.push(`${manifest.id}: QA manifest must not produce draft artifacts`);
    }
  }

  for (const step of workflowSteps) {
    if (!agentIds.has(step.producerAgentId)) {
      issues.push(`${step.id}: producer agent has no manifest`);
    }
    for (const qaAgentId of step.qaAgentIds) {
      if (!agentIds.has(qaAgentId)) issues.push(`${step.id}: QA agent has no manifest ${qaAgentId}`);
    }
  }

  return issues;
};
