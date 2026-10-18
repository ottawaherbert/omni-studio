export type StoryFlowEdgeRef = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
};

export type StoryFlowPoint = {
  x: number;
  y: number;
};

export type StoryFlowNodeRect = StoryFlowPoint & {
  id: string;
  width: number;
  height: number;
};

export type StoryFlowEdgeRoute = {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  kind: 'forward' | 'detour' | 'loop';
  points: StoryFlowPoint[];
  path: string;
  label: StoryFlowPoint;
};

type BuildStoryFlowEdgeRouteInput = Omit<StoryFlowEdgeRef, 'id'> & {
  edgeId: string;
  source: StoryFlowPoint;
  target: StoryFlowPoint;
  obstacles: StoryFlowNodeRect[];
  feedback?: boolean;
  laneIndex?: number;
};

const ROUTE_CLEARANCE = 28;
const CORNER_RADIUS = 14;

const compactPoints = (points: StoryFlowPoint[]): StoryFlowPoint[] => {
  const compacted: StoryFlowPoint[] = [];
  points.forEach((point) => {
    const previous = compacted[compacted.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) return;
    compacted.push(point);
  });
  return compacted.filter((point, index) => {
    const previous = compacted[index - 1];
    const next = compacted[index + 1];
    if (!previous || !next) return true;
    return !(
      (previous.x === point.x && point.x === next.x)
      || (previous.y === point.y && point.y === next.y)
    );
  });
};

const roundedOrthogonalPath = (rawPoints: StoryFlowPoint[]): string => {
  const points = compactPoints(rawPoints);
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incomingLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoingLength = Math.hypot(next.x - current.x, next.y - current.y);
    const radius = Math.min(CORNER_RADIUS, incomingLength / 2, outgoingLength / 2);
    const incomingRatio = radius / Math.max(incomingLength, 1);
    const outgoingRatio = radius / Math.max(outgoingLength, 1);
    const before = {
      x: current.x - (current.x - previous.x) * incomingRatio,
      y: current.y - (current.y - previous.y) * incomingRatio,
    };
    const after = {
      x: current.x + (next.x - current.x) * outgoingRatio,
      y: current.y + (next.y - current.y) * outgoingRatio,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
};

const segmentIntersectsRect = (
  start: StoryFlowPoint,
  end: StoryFlowPoint,
  rect: StoryFlowNodeRect,
  padding = 10,
): boolean => {
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  if (start.y === end.y) {
    return start.y >= top
      && start.y <= bottom
      && Math.max(Math.min(start.x, end.x), left) <= Math.min(Math.max(start.x, end.x), right);
  }
  if (start.x === end.x) {
    return start.x >= left
      && start.x <= right
      && Math.max(Math.min(start.y, end.y), top) <= Math.min(Math.max(start.y, end.y), bottom);
  }
  return false;
};

const routeHitsObstacles = (
  points: StoryFlowPoint[],
  obstacles: StoryFlowNodeRect[],
  excludedNodeIds: Set<string>,
): boolean => {
  const relevant = obstacles.filter((obstacle) => !excludedNodeIds.has(obstacle.id));
  return points.slice(1).some((point, index) =>
    relevant.some((obstacle) => segmentIntersectsRect(points[index], point, obstacle)),
  );
};

const routeLabel = (points: StoryFlowPoint[]): StoryFlowPoint => {
  const segments = points.slice(1).map((point, index) => {
    const start = points[index];
    return {
      start,
      end: point,
      length: Math.hypot(point.x - start.x, point.y - start.y),
      horizontal: start.y === point.y,
    };
  });
  const preferred = [...segments]
    .sort((left, right) => Number(right.horizontal) - Number(left.horizontal) || right.length - left.length)[0];
  if (!preferred) return points[0] || { x: 0, y: 0 };
  return {
    x: (preferred.start.x + preferred.end.x) / 2,
    y: (preferred.start.y + preferred.end.y) / 2,
  };
};

const stableParity = (value: string): number =>
  Array.from(value).reduce((total, character) => total + character.charCodeAt(0), 0) % 2;

export const findStoryFlowFeedbackEdgeIds = (
  nodeIds: string[],
  edges: StoryFlowEdgeRef[],
): Set<string> => {
  const knownNodeIds = new Set(nodeIds);
  const nodeOrder = new Map(nodeIds.map((nodeId, index) => [nodeId, index]));
  const adjacency = new Map<string, StoryFlowEdgeRef[]>();
  edges.forEach((edge) => {
    if (!knownNodeIds.has(edge.sourceNodeId) || !knownNodeIds.has(edge.targetNodeId)) return;
    const existing = adjacency.get(edge.sourceNodeId) || [];
    existing.push(edge);
    adjacency.set(edge.sourceNodeId, existing);
  });

  const closesCycle = (candidate: StoryFlowEdgeRef): boolean => {
    if (candidate.sourceNodeId === candidate.targetNodeId) return true;
    const pending = [candidate.targetNodeId];
    const visited = new Set<string>();
    while (pending.length) {
      const nodeId = pending.pop()!;
      if (nodeId === candidate.sourceNodeId) return true;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      (adjacency.get(nodeId) || []).forEach((edge) => {
        if (edge.id !== candidate.id && !visited.has(edge.targetNodeId)) {
          pending.push(edge.targetNodeId);
        }
      });
    }
    return false;
  };

  const feedbackEdgeIds = new Set<string>();
  edges.forEach((edge) => {
    const sourceOrder = nodeOrder.get(edge.sourceNodeId);
    const targetOrder = nodeOrder.get(edge.targetNodeId);
    if (sourceOrder == null || targetOrder == null || targetOrder > sourceOrder) return;
    if (closesCycle(edge)) feedbackEdgeIds.add(edge.id);
  });
  return feedbackEdgeIds;
};

export const buildStoryFlowEdgeRoute = ({
  edgeId,
  sourceNodeId,
  targetNodeId,
  source,
  target,
  obstacles,
  feedback = false,
  laneIndex = 0,
}: BuildStoryFlowEdgeRouteInput): StoryFlowEdgeRoute => {
  const excludedNodeIds = new Set([sourceNodeId, targetNodeId]);
  const middleX = Math.round((source.x + target.x) / 2);
  const directPoints = compactPoints([
    source,
    { x: middleX, y: source.y },
    { x: middleX, y: target.y },
    target,
  ]);
  const needsOuterLane = feedback
    || targetNodeId === sourceNodeId
    || target.x <= source.x + ROUTE_CLEARANCE * 2
    || routeHitsObstacles(directPoints, obstacles, excludedNodeIds);

  if (!needsOuterLane) {
    return {
      edgeId,
      sourceNodeId,
      targetNodeId,
      kind: 'forward',
      points: directPoints,
      path: roundedOrthogonalPath(directPoints),
      label: routeLabel(directPoints),
    };
  }

  const sourceGateX = source.x + ROUTE_CLEARANCE;
  const targetGateX = target.x - ROUTE_CLEARANCE;
  const routeLeft = Math.min(source.x, target.x) - ROUTE_CLEARANCE;
  const routeRight = Math.max(source.x, target.x) + ROUTE_CLEARANCE;
  const routeTop = Math.min(source.y, target.y);
  const routeBottom = Math.max(source.y, target.y);

  // Filter obstacles that are in the horizontal and vertical neighborhood of this edge
  const relevantObstacles = obstacles.filter((obstacle) =>
    !excludedNodeIds.has(obstacle.id)
    && obstacle.x <= routeRight + ROUTE_CLEARANCE
    && obstacle.x + obstacle.width >= routeLeft - ROUTE_CLEARANCE
    && obstacle.y <= routeBottom + ROUTE_CLEARANCE
    && obstacle.y + obstacle.height >= routeTop - ROUTE_CLEARANCE
  );

  const laneOffset = ROUTE_CLEARANCE + Math.min(Math.max(laneIndex, 0), 7) * 20;
  const localMinY = relevantObstacles.length > 0
    ? Math.min(routeTop, ...relevantObstacles.map((obstacle) => obstacle.y))
    : routeTop;
  const localMaxY = relevantObstacles.length > 0
    ? Math.max(routeBottom, ...relevantObstacles.map((obstacle) => obstacle.y + obstacle.height))
    : routeBottom;

  const top = localMinY - laneOffset;
  const bottom = localMaxY + laneOffset;

  const topCost = Math.abs(source.y - top) + Math.abs(target.y - top);
  const bottomCost = Math.abs(source.y - bottom) + Math.abs(target.y - bottom);
  const useTop = topCost === bottomCost ? stableParity(edgeId) === 0 : topCost < bottomCost;
  const laneY = useTop ? top : bottom;

  const routedPoints = compactPoints([
    source,
    { x: sourceGateX, y: source.y },
    { x: sourceGateX, y: laneY },
    { x: targetGateX, y: laneY },
    { x: targetGateX, y: target.y },
    target,
  ]);

  return {
    edgeId,
    sourceNodeId,
    targetNodeId,
    kind: feedback || sourceNodeId === targetNodeId ? 'loop' : 'detour',
    points: routedPoints,
    path: roundedOrthogonalPath(routedPoints),
    label: routeLabel(routedPoints),
  };
};

export const storyFlowRouteHitsNode = (
  route: StoryFlowEdgeRoute,
  obstacles: StoryFlowNodeRect[],
): boolean => routeHitsObstacles(
  route.points,
  obstacles,
  new Set([route.sourceNodeId, route.targetNodeId]),
);

const isEndpoint = (point: StoryFlowPoint, segmentStart: StoryFlowPoint, segmentEnd: StoryFlowPoint) =>
  (point.x === segmentStart.x && point.y === segmentStart.y)
  || (point.x === segmentEnd.x && point.y === segmentEnd.y);

const segmentsCross = (
  leftStart: StoryFlowPoint,
  leftEnd: StoryFlowPoint,
  rightStart: StoryFlowPoint,
  rightEnd: StoryFlowPoint,
): boolean => {
  const leftHorizontal = leftStart.y === leftEnd.y;
  const rightHorizontal = rightStart.y === rightEnd.y;
  if (leftHorizontal === rightHorizontal) {
    if (leftHorizontal && leftStart.y === rightStart.y) {
      return Math.max(Math.min(leftStart.x, leftEnd.x), Math.min(rightStart.x, rightEnd.x))
        < Math.min(Math.max(leftStart.x, leftEnd.x), Math.max(rightStart.x, rightEnd.x));
    }
    if (!leftHorizontal && leftStart.x === rightStart.x) {
      return Math.max(Math.min(leftStart.y, leftEnd.y), Math.min(rightStart.y, rightEnd.y))
        < Math.min(Math.max(leftStart.y, leftEnd.y), Math.max(rightStart.y, rightEnd.y));
    }
    return false;
  }
  const horizontalStart = leftHorizontal ? leftStart : rightStart;
  const horizontalEnd = leftHorizontal ? leftEnd : rightEnd;
  const verticalStart = leftHorizontal ? rightStart : leftStart;
  const verticalEnd = leftHorizontal ? rightEnd : leftEnd;
  const crossing = {
    x: verticalStart.x,
    y: horizontalStart.y,
  };
  if (
    crossing.x < Math.min(horizontalStart.x, horizontalEnd.x)
    || crossing.x > Math.max(horizontalStart.x, horizontalEnd.x)
    || crossing.y < Math.min(verticalStart.y, verticalEnd.y)
    || crossing.y > Math.max(verticalStart.y, verticalEnd.y)
  ) return false;
  return !(
    isEndpoint(crossing, leftStart, leftEnd)
    && isEndpoint(crossing, rightStart, rightEnd)
  );
};

export const countStoryFlowRouteCrossings = (routes: StoryFlowEdgeRoute[]): number => {
  let crossings = 0;
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex];
    for (let otherRouteIndex = routeIndex + 1; otherRouteIndex < routes.length; otherRouteIndex += 1) {
      const otherRoute = routes[otherRouteIndex];
      for (let segmentIndex = 1; segmentIndex < route.points.length; segmentIndex += 1) {
        for (let otherSegmentIndex = 1; otherSegmentIndex < otherRoute.points.length; otherSegmentIndex += 1) {
          if (segmentsCross(
            route.points[segmentIndex - 1],
            route.points[segmentIndex],
            otherRoute.points[otherSegmentIndex - 1],
            otherRoute.points[otherSegmentIndex],
          )) crossings += 1;
        }
      }
    }
  }
  return crossings;
};
