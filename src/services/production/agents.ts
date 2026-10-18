import {
  AgentDefinition,
  ProductionStageDefinition,
  ProductionStageType,
  WorkflowStepDefinition,
} from "../../types/production";
import {
  interactiveStageDefinitions,
  linearStageDefinitions,
} from "./stages";
import {
  createProductionAgentModuleManifests,
  validateProductionAgentModuleManifests,
  type ProductionAgentModuleManifest,
} from "./agentManifest";
import {
  linearStoryboardAgentDefinitions,
  linearStoryboardQAAgentDefinitions,
  linearStoryboardWorkflowStepDefinitions,
} from "./agentModules/linearStoryboard";
import {
  manualAgentDefinitions,
  manualGenerationWorkflowStepDefinitions,
  manualQAAgentDefinitions,
  manualRewriteWorkflowStepDefinitions,
} from "./agentModules/manual";
import {
  interactiveAgentDefinitions,
  interactiveQAAgentDefinitions,
  interactiveWorkflowStepDefinitions,
} from "./agentModules/interactive";
import {
  upstreamReferenceAgentDefinitions,
  upstreamReferenceQAAgentDefinitions,
  upstreamReferenceWorkflowStepDefinitions,
} from "./agentModules/upstreamReference";
import {
  linearCoreAgentDefinitions,
  linearCorePostStoryboardWorkflowStepDefinitions,
  linearCorePreStoryboardWorkflowStepDefinitions,
  linearCoreQAAgentDefinitions,
} from "./agentModules/linearCore";

export type ProductionAgentDefinition = AgentDefinition;

const uniqueStageDefinitions = () => {
  const seen = new Set<ProductionStageType>();
  return [...linearStageDefinitions, ...interactiveStageDefinitions].filter((definition) => {
    if (seen.has(definition.stageType)) return false;
    seen.add(definition.stageType);
    return true;
  });
};

const stageRole = (stageType: ProductionStageType): AgentDefinition["role"] => {
  if (stageType === "context_planning" || stageType === "expensive_generation_planning") return "planner";
  if (stageType === "interactive_graph_qa" || stageType === "playtest_simulation") return "qa";
  return "producer";
};

const stageAgent = (definition: ProductionStageDefinition): AgentDefinition => ({
  id: definition.agentId,
  name: definition.title,
  role: stageRole(definition.stageType),
  owns: `stage:${definition.stageType}`,
  inputContractId: `input.${definition.stageType}.v1`,
  outputContractId: `output.${definition.stageType}.v1`,
  allowedTools: [],
  retryPolicyId: definition.stageType === "intake" ? "retry.contract.strict" : "retry.default",
  description: definition.description,
  stageTypes: [definition.stageType],
});

const stageDefinitions = uniqueStageDefinitions();

export const productionStageAgentRegistry: AgentDefinition[] = stageDefinitions.map(stageAgent);

export const productionManualAgentRegistry: AgentDefinition[] = manualAgentDefinitions;

export const productionLinearAgentRegistry: AgentDefinition[] = [
  ...linearCoreAgentDefinitions,
  ...linearStoryboardAgentDefinitions,
];

export const upstreamReferenceAgentRegistry: AgentDefinition[] = upstreamReferenceAgentDefinitions;

export const productionInteractiveAgentRegistry: AgentDefinition[] = interactiveAgentDefinitions;

export const productionQAAgentRegistry: AgentDefinition[] = [
  ...stageDefinitions.map((definition) => ({
    id: `qa.contract.stage.${definition.stageType}`,
    name: `${definition.title} Contract QA`,
    role: "qa" as const,
    owns: `qa:contract:${definition.stageType}`,
    inputContractId: `output.${definition.stageType}.v1`,
    outputContractId: "qa.verdict.v1",
    allowedTools: [],
    retryPolicyId: "retry.contract.strict",
    description: `检查 ${definition.title} 的结构契约、必填字段和可提交性。`,
    stageTypes: [definition.stageType],
  })),
  ...manualQAAgentDefinitions,
  ...linearCoreQAAgentDefinitions,
  ...linearStoryboardQAAgentDefinitions,
  ...interactiveQAAgentDefinitions,
  ...upstreamReferenceQAAgentDefinitions,
];

const productionAgentDefinitions: AgentDefinition[] = [
  ...productionStageAgentRegistry,
  ...productionManualAgentRegistry,
  ...productionLinearAgentRegistry,
  ...productionInteractiveAgentRegistry,
  ...upstreamReferenceAgentRegistry,
  ...productionQAAgentRegistry,
];

export const productionWorkflowStepRegistry: WorkflowStepDefinition[] = [
  ...stageDefinitions.map((definition) => ({
    id: `autostudio.stage.${definition.stageType}`,
    name: definition.title,
    trigger: "auto" as const,
    producerAgentId: definition.agentId,
    qaAgentIds: [`qa.contract.stage.${definition.stageType}`],
    commitPolicyId: `commit.stage.${definition.stageType}.v1`,
    humanGatePolicyId: definition.defaultRequiresHumanReview
      ? "human_gate.manual_required.v1"
      : "human_gate.auto_low_risk.v1",
    dependsOn: [],
    stageType: definition.stageType,
    artifactTypes: definition.artifactTypes,
  })),
  ...manualRewriteWorkflowStepDefinitions,
  ...linearCorePreStoryboardWorkflowStepDefinitions,
  ...linearStoryboardWorkflowStepDefinitions,
  ...linearCorePostStoryboardWorkflowStepDefinitions,
  ...manualGenerationWorkflowStepDefinitions,
  ...interactiveWorkflowStepDefinitions,
  ...upstreamReferenceWorkflowStepDefinitions,
];

export const productionAgentModuleManifests: ProductionAgentModuleManifest[] = createProductionAgentModuleManifests(
  productionAgentDefinitions,
  productionWorkflowStepRegistry,
);

export const productionAgentRegistry: AgentDefinition[] = productionAgentModuleManifests.map((manifest) => manifest.definition);

export const findProductionAgent = (agentId: string) =>
  productionAgentRegistry.find((agent) => agent.id === agentId);

export const findWorkflowStepDefinition = (stepId: string) =>
  productionWorkflowStepRegistry.find((step) => step.id === stepId);

export const validateProductionAgentRegistry = (
  agents: AgentDefinition[] = productionAgentRegistry,
  workflowSteps: WorkflowStepDefinition[] = productionWorkflowStepRegistry,
) => {
  const issues: string[] = [];
  const agentIds = new Set<string>();
  const qaAgentIds = new Set(agents.filter((agent) => agent.role === "qa").map((agent) => agent.id));

  agents.forEach((agent) => {
    if (agentIds.has(agent.id)) issues.push(`${agent.id}: duplicate agent id`);
    agentIds.add(agent.id);
    if (!agent.owns) issues.push(`${agent.id}: missing owns`);
    if (agent.role === "producer" && /[,|+]/.test(agent.owns)) {
      issues.push(`${agent.id}: producer owns must describe exactly one responsibility`);
    }
    if (!agent.inputContractId) issues.push(`${agent.id}: missing inputContractId`);
    if (!agent.outputContractId) issues.push(`${agent.id}: missing outputContractId`);
    if (!agent.retryPolicyId) issues.push(`${agent.id}: missing retryPolicyId`);
  });

  workflowSteps.forEach((step) => {
    const producer = agents.find((agent) => agent.id === step.producerAgentId);
    if (!producer) issues.push(`${step.id}: missing producer agent ${step.producerAgentId}`);
    if (!step.qaAgentIds.length) issues.push(`${step.id}: missing qa agents`);
    step.qaAgentIds.forEach((qaAgentId) => {
      if (!qaAgentIds.has(qaAgentId)) issues.push(`${step.id}: missing QA agent ${qaAgentId}`);
    });
    if (step.trigger === "auto" && step.stageType) {
      const contractQaId = `qa.contract.stage.${step.stageType}`;
      if (!step.qaAgentIds.includes(contractQaId)) {
        issues.push(`${step.id}: missing contract QA ${contractQaId}`);
      }
    }
  });

  return issues;
};

export const validateProductionAgentManifestRegistry = (
  manifests: ProductionAgentModuleManifest[] = productionAgentModuleManifests,
  workflowSteps: WorkflowStepDefinition[] = productionWorkflowStepRegistry,
) => validateProductionAgentModuleManifests(manifests, workflowSteps);

export const buildProductionAgentManifestSystem = () => {
  const manifestKinds = Array.from(new Set(productionAgentModuleManifests.map((manifest) => manifest.kind)));
  const roleCounts = productionAgentModuleManifests.reduce<Record<string, number>>((counts, manifest) => {
    counts[manifest.definition.role] = (counts[manifest.definition.role] || 0) + 1;
    return counts;
  }, {});
  return {
    schemaVersion: "production-agent-manifest-system.v1",
    status: "agent_manifest_registry_available",
    manifestSchemaVersion: "production-agent-module-manifest.v1",
    registrySource: "productionAgentModuleManifests",
    registryFunction: "createProductionAgentModuleManifests",
    qaFunction: "validateProductionAgentManifestRegistry",
    manifestCount: productionAgentModuleManifests.length,
    agentCount: productionAgentRegistry.length,
    workflowStepCount: productionWorkflowStepRegistry.length,
    manifestKinds,
    roleCounts,
    requiredManifestFields: [
      "definition",
      "workflowStepIds",
      "qaAgentIds",
      "producedArtifactTypes",
      "stageTypes",
      "modeTags",
      "capabilities",
      "boundaries",
    ],
    boundaryRules: [
      "Each agent manifest must declare one AgentDefinition with input/output contracts, allowedTools, retryPolicyId, and role.",
      "Producer/planner manifests must list workflowStepIds and QA agent ids before they can be scheduled.",
      "QA manifests must not produce draft artifacts or mutate canonical Project state.",
      "Center registries should aggregate manifests instead of becoming the only source of agent behavior.",
      "New agents should be added as manifest modules first, then surfaced through capabilities and the operator handbook.",
    ],
    manifests: productionAgentModuleManifests.map((manifest) => ({
      id: manifest.id,
      kind: manifest.kind,
      agentId: manifest.definition.id,
      role: manifest.definition.role,
      owns: manifest.definition.owns,
      workflowStepIds: manifest.workflowStepIds,
      qaAgentIds: manifest.qaAgentIds,
      producedArtifactTypes: manifest.producedArtifactTypes,
      stageTypes: manifest.stageTypes,
      modeTags: manifest.modeTags,
      boundaries: manifest.boundaries,
      capabilities: manifest.capabilities,
    })),
  };
};
