import {
  applyStateEffects,
  createInitialStateContext,
  evaluatePredicate,
  type RuntimeStateContext,
} from "../interpreter/stateInterpreter";
import type {
  NarrativeGraphVersion,
  NodeContentBinding,
  PredicateAST,
  StateSchema,
} from "../types/schema";

export interface InteractiveVisualScenario {
  id: string;
  label: string;
  entryPredicate: PredicateAST | null;
  /** Groups production-scene variants selected by the same player-visible state. */
  stateFingerprint: string;
  observableFacts: string[];
  observableVariables?: Record<string, boolean | number | string>;
  canonicalAssetRefs: string[];
  characterVariantRefs: string[];
  assetVariantRefs: string[];
  environmentChanges: string[];
  performanceConstraints: string[];
  continuityIn: string[];
  continuityOut: string[];
  shotPromptDelta: string;
  reuseFingerprint: string;
}

export interface InteractiveVisualContextProjection {
  id: string;
  experienceId: string;
  graphVersionId: string;
  stateSchemaVersionId: string;
  bindingVersionIds: string[];
  productionProjectId: string;
  productionSceneId: string;
  nodeIds: string[];
  scenarios: InteractiveVisualScenario[];
  sourceFingerprint: string;
  status: "draft" | "qa_failed" | "ready" | "adopted" | "stale";
}

export interface ReachableEntryStateEnumeration {
  statesByNodeId: Map<string, RuntimeStateContext[]>;
  exploredStateCount: number;
  truncated: boolean;
}

export interface InteractiveVisualProjectionSource {
  productionSceneId: string;
  nodeIds: string[];
  continuityIn?: string[];
  continuityOut?: string[];
  canonicalAssetRefs?: string[];
  characterVariantRefs?: string[];
  assetVariantRefs?: string[];
  environmentChanges?: string[];
  performanceConstraints?: string[];
}

const hiddenStatePattern = /(?:score|favorability|affinity|trust_level|internal|checkpoint|route|ending_eligible|visited|计分|好感度|信任值|检查点|结局资格|已访问)/i;
const observableStatePattern = /(?:obtain|possess|holding|equipped|injur|wound|bleed|blood|wet|dirty|damage|broken|burn|fire|flood|power_off|blackout|door_open|door_closed|costume|clothing|appearance|衣|伤|血|持有|拿着|获得|破损|烧|火|水淹|断电|开门|关门|外观)/i;

/**
 * Unknown state identifiers stay internal. Visual generation only receives
 * identifiers that explicitly look physical, environmental, or presentational.
 */
export function isObservableStateFact(factId: string): boolean {
  const normalized = factId.trim();
  if (!normalized || hiddenStatePattern.test(normalized)) return false;
  return observableStatePattern.test(normalized);
}

export const isObservableStateVariable = isObservableStateFact;

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const uniqueSorted = (values: string[]) => [...new Set(values.filter(Boolean))].sort();

const stableRecordEntries = (
  value: Record<string, boolean | number | string> | undefined,
) => Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right));

export function computeScenarioReuseFingerprint(scenario: Partial<InteractiveVisualScenario>): string {
  const normalized = [
    uniqueSorted(scenario.observableFacts || []).join("|"),
    stableRecordEntries(scenario.observableVariables)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("|"),
    uniqueSorted(scenario.canonicalAssetRefs || []).join("|"),
    uniqueSorted(scenario.characterVariantRefs || []).join("|"),
    uniqueSorted(scenario.assetVariantRefs || []).join("|"),
    uniqueSorted(scenario.environmentChanges || []).join("|"),
    uniqueSorted(scenario.performanceConstraints || []).join("|"),
    scenario.shotPromptDelta?.trim() || "",
  ].join("::");
  return `visual_${stableHash(normalized)}`;
}

export function computeScenarioStateFingerprint(
  scenario: Pick<InteractiveVisualScenario, "observableFacts" | "observableVariables">,
): string {
  const normalized = [
    uniqueSorted(scenario.observableFacts || []).join("|"),
    stableRecordEntries(scenario.observableVariables)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("|"),
  ].join("::");
  return `visual_state_${stableHash(normalized)}`;
}

const buildScenarioShotPromptDelta = (
  scenario: Pick<
    InteractiveVisualScenario,
    "observableFacts" | "observableVariables" | "environmentChanges" | "performanceConstraints"
  >,
) => [
  scenario.observableFacts.length ? `可见事实：${scenario.observableFacts.join("、")}` : "",
  stableRecordEntries(scenario.observableVariables).length
    ? `可见状态：${stableRecordEntries(scenario.observableVariables).map(([key, value]) => `${key}=${String(value)}`).join("、")}`
    : "",
  scenario.environmentChanges.length ? `环境变化：${scenario.environmentChanges.join("、")}` : "",
  scenario.performanceConstraints.length ? `表演约束：${scenario.performanceConstraints.join("、")}` : "",
].filter(Boolean).join("；");

export function refineInteractiveVisualScenario(
  scenario: InteractiveVisualScenario,
  proposal: {
    label?: string;
    environmentChanges: string[];
    performanceConstraints: string[];
  },
): InteractiveVisualScenario {
  const environmentChanges = uniqueSorted(proposal.environmentChanges);
  const performanceConstraints = uniqueSorted(proposal.performanceConstraints);
  const shotPromptDelta = buildScenarioShotPromptDelta({
    observableFacts: scenario.observableFacts,
    observableVariables: scenario.observableVariables,
    environmentChanges,
    performanceConstraints,
  });
  const refined: InteractiveVisualScenario = {
    ...scenario,
    label: proposal.label?.trim() || scenario.label,
    environmentChanges,
    performanceConstraints,
    shotPromptDelta,
    reuseFingerprint: "",
  };
  return {
    ...refined,
    reuseFingerprint: computeScenarioReuseFingerprint(refined),
  };
}

const cloneRuntimeState = (state: RuntimeStateContext): RuntimeStateContext => ({
  variables: { ...state.variables },
  facts: new Set(state.facts),
  visitedNodes: { ...state.visitedNodes },
});

const runtimeStateSignature = (
  nodeId: string,
  state: RuntimeStateContext,
  maxVisitsPerNode: number,
) => JSON.stringify({
  nodeId,
  variables: stableRecordEntries(state.variables),
  facts: [...state.facts].sort(),
  visitedNodes: Object.entries(state.visitedNodes)
    .filter(([, visits]) => visits > 0)
    .map(([visitedNodeId, visits]) => [visitedNodeId, Math.min(visits, maxVisitsPerNode)])
    .sort(([left], [right]) => String(left).localeCompare(String(right))),
});

/**
 * Enumerates executable node-entry states without allowing loops or broad
 * numeric domains to grow without bound. The result is an authoring projection,
 * not a replacement for the runtime interpreter.
 */
export function enumerateReachableEntryStates(input: {
  graph: NarrativeGraphVersion;
  stateSchema: StateSchema;
  maxStates?: number;
  maxStatesPerNode?: number;
  maxVisitsPerNode?: number;
}): ReachableEntryStateEnumeration {
  const maxStates = Math.max(1, input.maxStates ?? 256);
  const maxStatesPerNode = Math.max(1, input.maxStatesPerNode ?? 32);
  const maxVisitsPerNode = Math.max(1, input.maxVisitsPerNode ?? 2);
  const nodesById = new Map(input.graph.nodes.map((node) => [node.id, node]));
  const statesByNodeId = new Map<string, RuntimeStateContext[]>();
  const queue: Array<{ nodeId: string; state: RuntimeStateContext }> = [];
  const seen = new Set<string>();
  let exploredStateCount = 0;
  let truncated = false;

  if (nodesById.has(input.graph.entryNodeId)) {
    queue.push({
      nodeId: input.graph.entryNodeId,
      state: createInitialStateContext(input.stateSchema),
    });
  }

  while (queue.length > 0) {
    if (exploredStateCount >= maxStates) {
      truncated = true;
      break;
    }
    const current = queue.shift()!;
    const signature = runtimeStateSignature(current.nodeId, current.state, maxVisitsPerNode);
    if (seen.has(signature)) continue;
    seen.add(signature);

    const nodeStates = statesByNodeId.get(current.nodeId) || [];
    if (nodeStates.length >= maxStatesPerNode) {
      truncated = true;
      continue;
    }
    statesByNodeId.set(current.nodeId, [...nodeStates, cloneRuntimeState(current.state)]);
    exploredStateCount += 1;

    const node = nodesById.get(current.nodeId);
    if (!node) continue;
    for (const choice of node.choices) {
      if (choice.condition && !evaluatePredicate(choice.condition, current.state)) continue;
      if (!nodesById.has(choice.targetNodeId)) continue;
      const next = applyStateEffects(choice.effects, current.state, input.stateSchema);
      const visits = (next.visitedNodes[current.nodeId] || 0) + 1;
      next.visitedNodes = {
        ...next.visitedNodes,
        [current.nodeId]: Math.min(visits, maxVisitsPerNode),
      };
      queue.push({ nodeId: choice.targetNodeId, state: next });
    }
  }

  if (queue.length > 0) truncated = true;
  return { statesByNodeId, exploredStateCount, truncated };
}

const predicateForVisibleState = ({
  facts,
  variables,
  factUniverse,
  variableUniverse,
}: {
  facts: string[];
  variables: Record<string, boolean | number | string>;
  factUniverse: string[];
  variableUniverse: string[];
}): PredicateAST | null => {
  const predicates: PredicateAST[] = [
    ...factUniverse.map((fact): PredicateAST => facts.includes(fact)
      ? { op: "has_fact", fact }
      : { op: "not", predicate: { op: "has_fact", fact } }),
    ...variableUniverse.flatMap((variable): PredicateAST[] => (
      Object.prototype.hasOwnProperty.call(variables, variable)
        ? [{ op: "compare", variable, comparator: "eq", value: variables[variable] }]
        : []
    )),
  ];
  if (predicates.length === 0) return null;
  return predicates.length === 1 ? predicates[0] : { op: "all", predicates };
};

const visibleStateFor = (
  state: RuntimeStateContext,
  factUniverse: string[],
  variableUniverse: string[],
) => ({
  facts: factUniverse.filter((fact) => state.facts.has(fact)),
  variables: Object.fromEntries(
    variableUniverse
      .filter((variable) => Object.prototype.hasOwnProperty.call(state.variables, variable))
      .map((variable) => [variable, state.variables[variable]]),
  ) as Record<string, boolean | number | string>,
});

const scenarioFromVisibleState = ({
  nodeId,
  facts,
  variables,
  factUniverse,
  variableUniverse,
  canonicalAssets = [],
  characterVariants = [],
  assetVariants = [],
  environmentNotes = [],
  performanceConstraints = [],
  continuityIn = [],
  continuityOut = [],
}: {
  nodeId: string;
  facts: string[];
  variables: Record<string, boolean | number | string>;
  factUniverse: string[];
  variableUniverse: string[];
  canonicalAssets?: string[];
  characterVariants?: string[];
  assetVariants?: string[];
  environmentNotes?: string[];
  performanceConstraints?: string[];
  continuityIn?: string[];
  continuityOut?: string[];
}): InteractiveVisualScenario => {
  const shotPromptDelta = buildScenarioShotPromptDelta({
    observableFacts: facts,
    observableVariables: variables,
    environmentChanges: environmentNotes,
    performanceConstraints,
  });
  const partial: Partial<InteractiveVisualScenario> = {
    observableFacts: facts,
    observableVariables: variables,
    canonicalAssetRefs: canonicalAssets,
    characterVariantRefs: characterVariants,
    assetVariantRefs: assetVariants,
    environmentChanges: environmentNotes,
    performanceConstraints,
    shotPromptDelta,
  };
  const reuseFingerprint = computeScenarioReuseFingerprint(partial);
  const stateFingerprint = computeScenarioStateFingerprint({
    observableFacts: facts,
    observableVariables: variables,
  });
  const labelParts = [
    ...facts,
    ...stableRecordEntries(variables).map(([key, value]) => `${key}=${String(value)}`),
  ];
  return {
    id: `scenario_${nodeId}_${reuseFingerprint}`,
    label: labelParts.length > 0 ? `画面状态：${labelParts.join("、")}` : "默认画面状态",
    entryPredicate: predicateForVisibleState({
      facts,
      variables,
      factUniverse,
      variableUniverse,
    }),
    stateFingerprint,
    observableFacts: facts,
    observableVariables: variables,
    canonicalAssetRefs: uniqueSorted(canonicalAssets),
    characterVariantRefs: uniqueSorted(characterVariants),
    assetVariantRefs: uniqueSorted(assetVariants),
    environmentChanges: uniqueSorted(environmentNotes),
    performanceConstraints: uniqueSorted(performanceConstraints),
    continuityIn: uniqueSorted(continuityIn),
    continuityOut: uniqueSorted(continuityOut),
    shotPromptDelta,
    reuseFingerprint,
  };
};

export function buildVisualScenarios(input: {
  nodeId: string;
  facts: string[];
  observableVariables?: Record<string, boolean | number | string>;
  canonicalAssets?: string[];
  characterVariants?: string[];
  assetVariants?: string[];
  environmentNotes?: string[];
  performanceConstraints?: string[];
  continuityIn?: string[];
  continuityOut?: string[];
}): InteractiveVisualScenario[] {
  const observableFacts = uniqueSorted(input.facts.filter(isObservableStateFact));
  const observableVariables = Object.fromEntries(
    stableRecordEntries(input.observableVariables)
      .filter(([key]) => isObservableStateVariable(key)),
  ) as Record<string, boolean | number | string>;
  return [scenarioFromVisibleState({
    nodeId: input.nodeId,
    facts: observableFacts,
    variables: observableVariables,
    factUniverse: observableFacts,
    variableUniverse: Object.keys(observableVariables),
    canonicalAssets: input.canonicalAssets,
    characterVariants: input.characterVariants,
    assetVariants: input.assetVariants,
    environmentNotes: input.environmentNotes,
    performanceConstraints: input.performanceConstraints,
    continuityIn: input.continuityIn,
    continuityOut: input.continuityOut,
  })];
}

export const computeVisualProjectionSourceFingerprint = (input: {
  graphVersionId: string;
  stateSchemaVersionId: string;
  bindingVersionIds: string[];
  productionProjectId: string;
  source: InteractiveVisualProjectionSource;
}) => `visual_projection_${stableHash(JSON.stringify({
  graphVersionId: input.graphVersionId,
  stateSchemaVersionId: input.stateSchemaVersionId,
  bindingVersionIds: uniqueSorted(input.bindingVersionIds),
  productionProjectId: input.productionProjectId,
  productionSceneId: input.source.productionSceneId,
  nodeIds: uniqueSorted(input.source.nodeIds),
  continuityIn: uniqueSorted(input.source.continuityIn || []),
  continuityOut: uniqueSorted(input.source.continuityOut || []),
  canonicalAssetRefs: uniqueSorted(input.source.canonicalAssetRefs || []),
  characterVariantRefs: uniqueSorted(input.source.characterVariantRefs || []),
  assetVariantRefs: uniqueSorted(input.source.assetVariantRefs || []),
  environmentChanges: uniqueSorted(input.source.environmentChanges || []),
  performanceConstraints: uniqueSorted(input.source.performanceConstraints || []),
}))}`;

export function buildInteractiveVisualContextProjections(input: {
  experienceId: string;
  graph: NarrativeGraphVersion;
  stateSchemaVersionId: string;
  stateSchema: StateSchema;
  bindings: NodeContentBinding[];
  productionProjectId: string;
  sources: InteractiveVisualProjectionSource[];
  maxStates?: number;
}): InteractiveVisualContextProjection[] {
  const enumeration = enumerateReachableEntryStates({
    graph: input.graph,
    stateSchema: input.stateSchema,
    maxStates: input.maxStates,
  });
  const observableFactUniverse = uniqueSorted([
    ...(input.stateSchema.factDefinitions || []),
    ...[...enumeration.statesByNodeId.values()].flatMap((states) => (
      states.flatMap((state) => [...state.facts])
    )),
  ].filter(isObservableStateFact));
  const observableVariableUniverse = uniqueSorted(
    input.stateSchema.variables.map((variable) => variable.key).filter(isObservableStateVariable),
  );

  return input.sources.map((source) => {
    const nodeIds = uniqueSorted(source.nodeIds);
    const reachableStates = nodeIds.flatMap((nodeId) => enumeration.statesByNodeId.get(nodeId) || []);
    const states = reachableStates.length > 0
      ? reachableStates
      : [createInitialStateContext(input.stateSchema)];
    const visibleStates = new Map<string, ReturnType<typeof visibleStateFor>>();
    for (const state of states) {
      const visible = visibleStateFor(state, observableFactUniverse, observableVariableUniverse);
      const key = JSON.stringify({
        facts: visible.facts,
        variables: stableRecordEntries(visible.variables),
      });
      visibleStates.set(key, visible);
    }
    const bindingVersionIds = uniqueSorted(input.bindings
      .filter((binding) => nodeIds.includes(binding.nodeId))
      .map((binding) => binding.id && binding.versionIndex
        ? `${binding.id}:v${binding.versionIndex}`
        : binding.id || "")
      .filter(Boolean));
    const sourceFingerprint = computeVisualProjectionSourceFingerprint({
      graphVersionId: input.graph.id,
      stateSchemaVersionId: input.stateSchemaVersionId,
      bindingVersionIds,
      productionProjectId: input.productionProjectId,
      source,
    });
    const scenarios = [...visibleStates.values()]
      .map((visible) => scenarioFromVisibleState({
        nodeId: `${nodeIds.join("_") || "scene"}_${source.productionSceneId}`,
        facts: visible.facts,
        variables: visible.variables,
        factUniverse: observableFactUniverse,
        variableUniverse: observableVariableUniverse,
        canonicalAssets: source.canonicalAssetRefs,
        characterVariants: source.characterVariantRefs,
        assetVariants: source.assetVariantRefs,
        environmentNotes: source.environmentChanges,
        performanceConstraints: source.performanceConstraints,
        continuityIn: source.continuityIn,
        continuityOut: source.continuityOut,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    return {
      id: `visual_projection_${source.productionSceneId}_${stableHash(sourceFingerprint)}`,
      experienceId: input.experienceId,
      graphVersionId: input.graph.id,
      stateSchemaVersionId: input.stateSchemaVersionId,
      bindingVersionIds,
      productionProjectId: input.productionProjectId,
      productionSceneId: source.productionSceneId,
      nodeIds,
      scenarios,
      sourceFingerprint,
      status: "adopted" as const,
    };
  });
}

const predicateIdentifiers = (predicate: PredicateAST | null): {
  facts: string[];
  variables: string[];
  hasUnsupportedVisitedPredicate: boolean;
} => {
  if (!predicate) return { facts: [], variables: [], hasUnsupportedVisitedPredicate: false };
  switch (predicate.op) {
    case "all":
    case "any": {
      const nested = predicate.predicates.map(predicateIdentifiers);
      return {
        facts: nested.flatMap((item) => item.facts),
        variables: nested.flatMap((item) => item.variables),
        hasUnsupportedVisitedPredicate: nested.some((item) => item.hasUnsupportedVisitedPredicate),
      };
    }
    case "not":
      return predicateIdentifiers(predicate.predicate);
    case "has_fact":
      return { facts: [predicate.fact], variables: [], hasUnsupportedVisitedPredicate: false };
    case "compare":
      return { facts: [], variables: [predicate.variable], hasUnsupportedVisitedPredicate: false };
    case "visited":
      return { facts: [], variables: [], hasUnsupportedVisitedPredicate: true };
    default:
      return { facts: [], variables: [], hasUnsupportedVisitedPredicate: false };
  }
};

export function validateInteractiveVisualContextProjection(
  projection: InteractiveVisualContextProjection,
): string[] {
  const issues: string[] = [];
  if (!projection.id || !projection.experienceId || !projection.productionProjectId || !projection.productionSceneId) {
    issues.push("视觉状态投影缺少稳定来源标识");
  }
  if (!projection.graphVersionId || !projection.stateSchemaVersionId || !projection.sourceFingerprint) {
    issues.push("视觉状态投影缺少冻结版本或来源指纹");
  }
  if (projection.nodeIds.length === 0) issues.push("视觉状态投影没有对应互动节点");
  if (projection.scenarios.length === 0) issues.push("视觉状态投影至少需要一个画面情境");
  if (new Set(projection.scenarios.map((scenario) => scenario.id)).size !== projection.scenarios.length) {
    issues.push("画面情境 ID 不能重复");
  }
  if (new Set(projection.scenarios.map((scenario) => scenario.reuseFingerprint)).size !== projection.scenarios.length) {
    issues.push("相同可见结果必须合并为一个画面情境");
  }
  for (const scenario of projection.scenarios) {
    if (scenario.observableFacts.some((fact) => !isObservableStateFact(fact))) {
      issues.push(`画面情境“${scenario.label}”包含不可见事实`);
    }
    if (Object.keys(scenario.observableVariables || {}).some((key) => !isObservableStateVariable(key))) {
      issues.push(`画面情境“${scenario.label}”包含不可见变量`);
    }
    if (computeScenarioReuseFingerprint(scenario) !== scenario.reuseFingerprint) {
      issues.push(`画面情境“${scenario.label}”的复用指纹与内容不一致`);
    }
    if (computeScenarioStateFingerprint(scenario) !== scenario.stateFingerprint) {
      issues.push(`画面情境“${scenario.label}”的状态指纹与可见状态不一致`);
    }
    const identifiers = predicateIdentifiers(scenario.entryPredicate);
    if (identifiers.hasUnsupportedVisitedPredicate) {
      issues.push(`画面情境“${scenario.label}”不能使用访问历史作为视觉条件`);
    }
    if (identifiers.facts.some((fact) => !isObservableStateFact(fact))
      || identifiers.variables.some((variable) => !isObservableStateVariable(variable))) {
      issues.push(`画面情境“${scenario.label}”的选择条件泄露了内部状态`);
    }
  }
  return uniqueSorted(issues);
}
