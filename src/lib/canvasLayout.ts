import dagre from 'dagre';

/** Layout shared by interactive storytelling and generation workspaces. */
export function layoutCanvasGraph(nodes: Array<{ id: string; width?: number; height?: number }>, edges: Array<{ source: string; target: string }>, spacing: { nodesep?: number; ranksep?: number } = {}) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: spacing.nodesep ?? 90, ranksep: spacing.ranksep ?? 160, marginx: 80, marginy: 80 });
  graph.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map(n => n.id));
  for (const node of nodes) graph.setNode(node.id, { width: node.width || 320, height: node.height || 180 });
  for (const edge of edges) if (ids.has(edge.source) && ids.has(edge.target)) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return Object.fromEntries(nodes.map(node => { const n = graph.node(node.id); return [node.id, n ? { x: Math.round(n.x - (node.width || 320) / 2), y: Math.round(n.y - (node.height || 180) / 2) } : { x: 80, y: 80 }]; }));
}
