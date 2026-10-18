import dagre from "dagre";
import type { NarrativeGraphVersion } from "../types/schema";
import { findStoryFlowFeedbackEdgeIds } from "./graphEdgeRouting";

export const STORY_FLOW_NODE_WIDTH = 320;
export const STORY_FLOW_NODE_HEIGHT = 180;

export const buildStoryFlowPositions = (
  graph: NarrativeGraphVersion,
): Record<string, { x: number; y: number }> => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 90,
    ranksep: 160,
    marginx: 80,
    marginy: 80,
  });
  g.setDefaultEdgeLabel(() => ({}));

  graph.nodes.forEach((node) => {
    g.setNode(node.id, { width: STORY_FLOW_NODE_WIDTH, height: STORY_FLOW_NODE_HEIGHT });
  });

  const transitions = graph.transitions?.length
    ? graph.transitions
    : graph.nodes.flatMap((node) =>
      node.choices.map((choice) => ({
        id: choice.id,
        sourceNodeId: node.id,
        targetNodeId: choice.targetNodeId,
      })),
    );
  const feedbackEdgeIds = findStoryFlowFeedbackEdgeIds(
    graph.nodes.map((node) => node.id),
    transitions,
  );

  transitions.forEach((t) => {
    if (t.sourceNodeId && t.targetNodeId && !feedbackEdgeIds.has(t.id)) {
      g.setEdge(t.sourceNodeId, t.targetNodeId);
    }
  });

  dagre.layout(g);

  const positions: Record<string, { x: number; y: number }> = {};
  graph.nodes.forEach((node) => {
    const n = g.node(node.id);
    if (n) {
      positions[node.id] = {
        x: Math.round(n.x - STORY_FLOW_NODE_WIDTH / 2),
        y: Math.round(n.y - STORY_FLOW_NODE_HEIGHT / 2),
      };
    } else {
      positions[node.id] = { x: 80, y: 80 };
    }
  });

  return positions;
};
