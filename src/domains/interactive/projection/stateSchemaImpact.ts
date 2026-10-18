import {
  getFactDefinitions,
  getInitialFactIds,
  type NarrativeGraphVersion,
  type PredicateAST,
  type StateSchema,
} from '../types/schema';

export interface StateSchemaChangeSet {
  variables: Set<string>;
  facts: Set<string>;
}

const changedKeys = <T>(
  previous: Map<string, T>,
  next: Map<string, T>,
): Set<string> => {
  const keys = new Set([...previous.keys(), ...next.keys()]);
  return new Set([...keys].filter((key) => (
    JSON.stringify(previous.get(key)) !== JSON.stringify(next.get(key))
  )));
};

export const stateSchemaChangeSet = (
  previous: StateSchema,
  next: StateSchema,
): StateSchemaChangeSet => {
  const variableSignature = (variable: StateSchema['variables'][number]) => JSON.stringify([
    variable.type,
    variable.scope,
    variable.defaultValue,
    variable.min ?? null,
    variable.max ?? null,
    [...(variable.enumValues || [])].sort(),
  ]);
  const previousVariables = new Map(previous.variables.map((variable) => [variable.key, variableSignature(variable)]));
  const nextVariables = new Map(next.variables.map((variable) => [variable.key, variableSignature(variable)]));
  const previousFacts = new Map(getFactDefinitions(previous).map((fact) => [fact, true]));
  const nextFacts = new Map(getFactDefinitions(next).map((fact) => [fact, true]));
  const previousInitialFacts = new Map(getInitialFactIds(previous).map((fact) => [fact, true]));
  const nextInitialFacts = new Map(getInitialFactIds(next).map((fact) => [fact, true]));
  return {
    variables: changedKeys(previousVariables, nextVariables),
    facts: new Set([
      ...changedKeys(previousFacts, nextFacts),
      ...changedKeys(previousInitialFacts, nextInitialFacts),
    ]),
  };
};

const predicateReferences = (
  predicate: PredicateAST | undefined,
  variables: Set<string>,
  facts: Set<string>,
) => {
  if (!predicate) return;
  if (predicate.op === 'compare') variables.add(predicate.variable);
  if (predicate.op === 'has_fact') facts.add(predicate.fact);
  if (predicate.op === 'not') predicateReferences(predicate.predicate, variables, facts);
  if (predicate.op === 'all' || predicate.op === 'any') {
    predicate.predicates.forEach((child) => predicateReferences(child, variables, facts));
  }
};

export const stateSchemaAffectedNodeIds = (
  graph: Pick<NarrativeGraphVersion, 'nodes'>,
  previous: StateSchema,
  next: StateSchema,
  additionalDirectNodeIds: Iterable<string> = [],
): Set<string> => {
  const changed = stateSchemaChangeSet(previous, next);
  const direct = new Set(additionalDirectNodeIds);

  graph.nodes.forEach((node) => {
    const referencedVariables = new Set([
      ...node.contract.readVariables,
      ...node.contract.writeVariables,
    ]);
    const referencedFacts = new Set([
      ...node.contract.requiredFacts,
      ...node.contract.producedFacts,
    ]);
    node.choices.forEach((choice) => {
      predicateReferences(choice.condition, referencedVariables, referencedFacts);
      choice.effects.forEach((effect) => {
        if ('variable' in effect) referencedVariables.add(effect.variable);
        if ('fact' in effect) referencedFacts.add(effect.fact);
      });
    });
    if (
      [...referencedVariables].some((key) => changed.variables.has(key))
      || [...referencedFacts].some((fact) => changed.facts.has(fact))
    ) {
      direct.add(node.id);
    }
  });

  const affected = new Set(direct);
  const queue = [...direct];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  while (queue.length > 0) {
    const node = nodesById.get(queue.shift()!);
    node?.choices.forEach((choice) => {
      if (affected.has(choice.targetNodeId)) return;
      affected.add(choice.targetNodeId);
      queue.push(choice.targetNodeId);
    });
  }
  return affected;
};
