import { layoutCanvasGraph } from '../../../lib/canvasLayout';
import type { NarrativeGraphVersion } from "../types/schema";
import { findStoryFlowFeedbackEdgeIds } from "./graphEdgeRouting";

export const STORY_FLOW_NODE_WIDTH = 320;
export const STORY_FLOW_NODE_HEIGHT = 180;

export const buildStoryFlowPositions = (
  graph: NarrativeGraphVersion,
): Record<string, { x: number; y: number }> => {
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

  return layoutCanvasGraph(
    graph.nodes.map(node => ({ id: node.id, width: STORY_FLOW_NODE_WIDTH, height: STORY_FLOW_NODE_HEIGHT })),
    transitions.filter(t => !feedbackEdgeIds.has(t.id)).map(t => ({ source: t.sourceNodeId, target: t.targetNodeId })),
  );
};
