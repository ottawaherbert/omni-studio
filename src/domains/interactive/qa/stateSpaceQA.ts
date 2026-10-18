import type { NarrativeGraphVersion, PredicateAST, StateSchema } from '../types/schema.ts';
import { hasNodeCapability } from '../nodeContentRequirements.ts';
import { applyStateEffects, createInitialStateContext, evaluatePredicate, type RuntimeStateContext } from '../interpreter/stateInterpreter.ts';

export interface StateSpaceAudit {
  reachableNodeIds: string[];
  reachableEndingIds: string[];
  deadlockNodeIds: string[];
  complete: boolean;
  exploredStates: number;
}

const limits = { states: 10_000, transitions: 50_000 };

const collectVisitThresholds = (predicate: PredicateAST | undefined, thresholds: Map<string, number>) => {
  if (!predicate) return;
  if (predicate.op === 'visited') thresholds.set(predicate.nodeId, Math.max(thresholds.get(predicate.nodeId) || 1, predicate.minTimes ?? 1));
  if (predicate.op === 'not') collectVisitThresholds(predicate.predicate, thresholds);
  if (predicate.op === 'all' || predicate.op === 'any') predicate.predicates.forEach((part) => collectVisitThresholds(part, thresholds));
};

export const auditExecutableStateSpace = (graph: NarrativeGraphVersion, schema: StateSchema, includeTimeoutBranches = true): StateSpaceAudit => {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!nodeMap.has(graph.entryNodeId)) return { reachableNodeIds: [], reachableEndingIds: [], deadlockNodeIds: [], complete: true, exploredStates: 0 };
  const thresholds = new Map<string, number>();
  graph.nodes.forEach((node) => node.choices.forEach((choice) => collectVisitThresholds(choice.condition, thresholds)));
  const key = (nodeId: string, ctx: RuntimeStateContext) => JSON.stringify([
    nodeId,
    Object.entries(ctx.variables).sort(([a], [b]) => a.localeCompare(b)),
    [...ctx.facts].sort(),
    [...thresholds].sort(([a], [b]) => a.localeCompare(b)).map(([id, threshold]) => [id, Math.min(ctx.visitedNodes[id] || 0, threshold)]),
  ]);
  const initial = createInitialStateContext(schema);
  initial.visitedNodes[graph.entryNodeId] = 1;
  const queue: Array<{ nodeId: string; context: RuntimeStateContext }> = [{ nodeId: graph.entryNodeId, context: initial }];
  const seen = new Set([key(graph.entryNodeId, initial)]);
  const terminalStates = new Set<string>();
  const reverseEdges = new Map<string, Set<string>>();
  const reachableNodeIds = new Set<string>();
  const reachableEndingIds = new Set<string>();
  const deadlockNodeIds = new Set<string>();
  let transitions = 0;
  let complete = true;
  for (let index = 0; index < queue.length; index++) {
    if (index >= limits.states || transitions >= limits.transitions) { complete = false; break; }
    const { nodeId, context } = queue[index];
    const stateKey = key(nodeId, context);
    const node = nodeMap.get(nodeId);
    if (!node) { deadlockNodeIds.add(nodeId); continue; }
    reachableNodeIds.add(nodeId);
    if (node.brief.dramaticFunction === 'ending' || hasNodeCapability(node, 'terminal')) {
      reachableEndingIds.add(nodeId);
      terminalStates.add(stateKey);
      continue;
    }
    if (hasNodeCapability(node, 'fail_or_retry')) { terminalStates.add(stateKey); continue; }
    const unlocked = node.choices.filter((choice) => !choice.condition || evaluatePredicate(choice.condition, context));
    if (!unlocked.length) { deadlockNodeIds.add(nodeId); continue; }
    const successors = unlocked.flatMap((choice) => [
      { nodeId: choice.targetNodeId, context: applyStateEffects(choice.effects, context, schema) },
      ...(includeTimeoutBranches && choice.timeoutSeconds && choice.defaultTimeoutTargetNodeId
        ? [{ nodeId: choice.defaultTimeoutTargetNodeId, context }]
        : []),
    ]);
    for (const successor of successors) {
      transitions++;
      if (!nodeMap.has(successor.nodeId)) { deadlockNodeIds.add(nodeId); continue; }
      const visitedNodes = { ...successor.context.visitedNodes, [successor.nodeId]: (successor.context.visitedNodes[successor.nodeId] || 0) + 1 };
      const nextContext = { ...successor.context, visitedNodes };
      const nextKey = key(successor.nodeId, nextContext);
      const predecessors = reverseEdges.get(nextKey) || new Set<string>();
      predecessors.add(stateKey);
      reverseEdges.set(nextKey, predecessors);
      if (seen.has(nextKey)) continue;
      seen.add(nextKey);
      queue.push({ nodeId: successor.nodeId, context: nextContext });
    }
  }
  if (complete) {
    const canFinish = new Set(terminalStates);
    const pending = [...terminalStates];
    for (let index = 0; index < pending.length; index++) {
      for (const predecessor of reverseEdges.get(pending[index]) || []) {
        if (!canFinish.has(predecessor)) { canFinish.add(predecessor); pending.push(predecessor); }
      }
    }
    for (const state of queue) if (!canFinish.has(key(state.nodeId, state.context))) deadlockNodeIds.add(state.nodeId);
  }
  return { reachableNodeIds: [...reachableNodeIds], reachableEndingIds: [...reachableEndingIds], deadlockNodeIds: [...deadlockNodeIds], complete, exploredStates: Math.min(queue.length, limits.states) };
};
