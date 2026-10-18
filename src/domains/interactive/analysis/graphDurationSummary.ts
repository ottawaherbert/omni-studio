import {
  normalizeNarrativeGraph,
  type NarrativeGraphVersion,
  type NarrativeNode,
} from '../types/schema.ts';

export interface InteractivePathDuration {
  nodeIds: string[];
  durationRangeSec: [number, number];
  choicePointCount: number;
}

export interface InteractiveGraphDurationSummary {
  completedPaths: InteractivePathDuration[];
  shortestPath?: InteractivePathDuration;
  typicalPath?: InteractivePathDuration;
  longestPath?: InteractivePathDuration;
  reachableUniqueRangeSec: [number, number];
  reachableNodeCount: number;
  truncated: boolean;
}

const MAX_PATHS = 2048;

const durationRange = (node: NarrativeNode): [number, number] => {
  const range = node.interaction?.durationRangeSec;
  if (
    !range
    || !Number.isFinite(range[0])
    || !Number.isFinite(range[1])
    || range[0] < 0
    || range[1] < range[0]
  ) return [0, 0];
  return range;
};

const midpoint = (range: [number, number]) => (range[0] + range[1]) / 2;

export const summarizeInteractiveGraphDuration = (
  graph: NarrativeGraphVersion,
  resolveDurationRange?: (node: NarrativeNode) => [number, number] | undefined,
): InteractiveGraphDurationSummary => {
  const normalized = normalizeNarrativeGraph(graph);
  const nodeMap = new Map(normalized.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  const completedPaths: InteractivePathDuration[] = [];
  let truncated = false;

  const visit = (
    nodeId: string,
    visited: Set<string>,
    pathNodeIds: string[],
    total: [number, number],
    choicePointCount: number,
  ) => {
    if (completedPaths.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    const node = nodeMap.get(nodeId);
    if (!node || visited.has(nodeId)) {
      truncated = true;
      return;
    }
    reachable.add(nodeId);
    const ownRange = resolveDurationRange?.(node) || durationRange(node);
    const nextTotal: [number, number] = [
      total[0] + ownRange[0],
      total[1] + ownRange[1],
    ];
    const nextNodeIds = [...pathNodeIds, nodeId];
    const targets = node.choices
      .filter((choice) => choice.condition?.op !== 'never')
      .map((choice) => choice.targetNodeId)
      .filter((targetId) => nodeMap.has(targetId));
    const nextChoiceCount = choicePointCount + (targets.length > 1 ? 1 : 0);
    if (targets.length === 0 || node.brief.dramaticFunction === 'ending') {
      completedPaths.push({
        nodeIds: nextNodeIds,
        durationRangeSec: nextTotal,
        choicePointCount: nextChoiceCount,
      });
      return;
    }
    const nextVisited = new Set(visited).add(nodeId);
    targets.forEach((targetId) => {
      if (nextVisited.has(targetId)) {
        truncated = true;
        return;
      }
      visit(targetId, nextVisited, nextNodeIds, nextTotal, nextChoiceCount);
    });
  };

  if (normalized.entryNodeId && nodeMap.has(normalized.entryNodeId)) {
    visit(normalized.entryNodeId, new Set(), [], [0, 0], 0);
  }

  const sortedPaths = [...completedPaths].sort(
    (left, right) => midpoint(left.durationRangeSec) - midpoint(right.durationRangeSec),
  );
  const reachableUniqueRangeSec = Array.from(reachable).reduce<[number, number]>(
    (total, nodeId) => {
      const node = nodeMap.get(nodeId)!;
      const range = resolveDurationRange?.(node) || durationRange(node);
      return [total[0] + range[0], total[1] + range[1]];
    },
    [0, 0],
  );

  return {
    completedPaths: sortedPaths,
    shortestPath: sortedPaths[0],
    typicalPath: sortedPaths[Math.floor(sortedPaths.length / 2)],
    longestPath: sortedPaths[sortedPaths.length - 1],
    reachableUniqueRangeSec,
    reachableNodeCount: reachable.size,
    truncated,
  };
};
