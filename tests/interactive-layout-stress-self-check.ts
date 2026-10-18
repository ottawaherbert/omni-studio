import assert from "node:assert";
import {
  buildStoryFlowPositions,
  STORY_FLOW_NODE_HEIGHT,
  STORY_FLOW_NODE_WIDTH,
} from "../src/domains/interactive/layout/graphAutoLayout";
import {
  buildStoryFlowEdgeRoute,
  countStoryFlowRouteCrossings,
  findStoryFlowFeedbackEdgeIds,
  storyFlowRouteHitsNode,
  type StoryFlowEdgeRef,
  type StoryFlowNodeRect,
} from "../src/domains/interactive/layout/graphEdgeRouting";
import type { NarrativeGraphVersion } from "../src/domains/interactive/types/schema";

/**
 * Self check script for CORE-AUDIT-BASE-009 & Phase 6:
 * Tests graph auto-layout on a 36-node, 5-chapter graph containing merges and loops.
 * Measures edge crossings, node overlap, and position generation.
 */

function generate36NodeGraph(): NarrativeGraphVersion {
  const nodes: NarrativeGraphVersion["nodes"] = [];
  const transitions: Array<{ id: string; sourceNodeId: string; targetNodeId: string }> = [];

  // Generate 36 nodes across 5 chapters
  for (let i = 1; i <= 36; i++) {
    const chapterId = `ch_${Math.ceil(i / 7)}`;
    const nodeId = `node_${i}`;
    nodes.push({
      id: nodeId,
      brief: {
        title: `Story Node ${i}`,
        summary: `Summary of node ${i}`,
        nodeType: i === 1 ? "entry" : i === 36 ? "ending" : "play_content",
        chapterId,
      },
      choices: [],
    } as any);

    // Linear connections
    if (i < 36) {
      transitions.push({ id: `edge_${i}_${i + 1}`, sourceNodeId: nodeId, targetNodeId: `node_${i + 1}` });
    }
  }

  // Add branches, merges, and loops
  transitions.push({ id: "edge_branch_5_12", sourceNodeId: "node_5", targetNodeId: "node_12" });
  transitions.push({ id: "edge_merge_12_20", sourceNodeId: "node_12", targetNodeId: "node_20" });
  transitions.push({ id: "edge_loop_25_5", sourceNodeId: "node_25", targetNodeId: "node_5" });

  return {
    id: "graph_36_v1",
    experienceId: "exp_1",
    semanticContractVersion: 2,
    versionIndex: 1,
    entryNodeId: "node_1",
    nodes,
    transitions,
  } as any;
}

const convergingFeedbackEdges = [
  { id: "edge_16_18", sourceNodeId: "node_16", targetNodeId: "node_18" },
  { id: "edge_16_19", sourceNodeId: "node_16", targetNodeId: "node_19" },
  { id: "edge_17_18", sourceNodeId: "node_17", targetNodeId: "node_18" },
  { id: "edge_17_19", sourceNodeId: "node_17", targetNodeId: "node_19" },
  { id: "edge_18_20", sourceNodeId: "node_18", targetNodeId: "node_20" },
  { id: "edge_18_21", sourceNodeId: "node_18", targetNodeId: "node_21" },
  { id: "edge_19_20", sourceNodeId: "node_19", targetNodeId: "node_20" },
  { id: "edge_19_21", sourceNodeId: "node_19", targetNodeId: "node_21" },
  { id: "edge_loop_21_17", sourceNodeId: "node_21", targetNodeId: "node_17" },
  { id: "edge_20_22", sourceNodeId: "node_20", targetNodeId: "node_22" },
  { id: "edge_21_22", sourceNodeId: "node_21", targetNodeId: "node_22" },
];

function runSelfCheck() {
  console.log("Running interactive-layout-stress self check...");

  assert.deepEqual(
    Array.from(findStoryFlowFeedbackEdgeIds(
      Array.from({ length: 7 }, (_, index) => `node_${index + 16}`),
      convergingFeedbackEdges,
    )),
    ["edge_loop_21_17"],
    "A return edge must remain the only loop even when parallel branches repeatedly merge",
  );

  const graph = generate36NodeGraph();
  const positions = buildStoryFlowPositions(graph);

  console.log(`[Layout Output]: Positioned ${Object.keys(positions).length} nodes.`);
  assert.strictEqual(Object.keys(positions).length, 36, "All 36 nodes must be positioned!");

  const positionedNodes = Object.entries(positions);
  let overlapCount = 0;
  for (let index = 0; index < positionedNodes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < positionedNodes.length; otherIndex += 1) {
      const left = positionedNodes[index][1];
      const right = positionedNodes[otherIndex][1];
      if (
        Math.abs(left.x - right.x) < STORY_FLOW_NODE_WIDTH
        && Math.abs(left.y - right.y) < STORY_FLOW_NODE_HEIGHT
      ) overlapCount += 1;
    }
  }

  console.log(`[Overlap Count]: ${overlapCount}`);
  assert.equal(overlapCount, 0, "The 36-node layout must not overlap node rectangles");
  const edgeRefs = graph.transitions as StoryFlowEdgeRef[];
  const feedbackEdgeIds = findStoryFlowFeedbackEdgeIds(
    graph.nodes.map((node) => node.id),
    edgeRefs,
  );
  assert.deepEqual(
    Array.from(feedbackEdgeIds),
    ["edge_loop_25_5"],
    "Only the closing feedback edge should be treated as the loop",
  );
  assert(
    positions.node_25.x > positions.node_5.x,
    "The loop must not reverse the forward story layout",
  );

  const obstacles: StoryFlowNodeRect[] = graph.nodes.map((node) => ({
    id: node.id,
    x: positions[node.id].x,
    y: positions[node.id].y,
    width: STORY_FLOW_NODE_WIDTH,
    height: STORY_FLOW_NODE_HEIGHT,
  }));
  let feedbackLaneIndex = 0;
  const routes = edgeRefs.map((edge, index) => {
    const sourceRect = obstacles.find((obstacle) => obstacle.id === edge.sourceNodeId)!;
    const targetRect = obstacles.find((obstacle) => obstacle.id === edge.targetNodeId)!;
    const feedback = feedbackEdgeIds.has(edge.id);
    return buildStoryFlowEdgeRoute({
      edgeId: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      source: {
        x: sourceRect.x + sourceRect.width,
        y: sourceRect.y + sourceRect.height / 2,
      },
      target: {
        x: targetRect.x,
        y: targetRect.y + targetRect.height / 2,
      },
      obstacles,
      feedback,
      laneIndex: feedback ? feedbackLaneIndex++ : index % 4,
    });
  });
  const nodeHitCount = routes.filter((route) => storyFlowRouteHitsNode(route, obstacles)).length;
  const routeCrossingCount = countStoryFlowRouteCrossings(routes);
  const loopRoute = routes.find((route) => route.edgeId === "edge_loop_25_5");

  console.log(`[Feedback Edges]: ${feedbackEdgeIds.size}`);
  console.log(`[Edge / Node Intersections]: ${nodeHitCount}`);
  console.log(`[Routed Edge Crossings]: ${routeCrossingCount}`);
  assert.equal(nodeHitCount, 0, "No routed edge may cross a non-endpoint node body");
  assert.equal(loopRoute?.kind, "loop", "The feedback edge must use the dedicated loop route");
  console.log("36-node layout routing passed; the desktop screenshot baseline remains a separate browser acceptance.");
}

runSelfCheck();
