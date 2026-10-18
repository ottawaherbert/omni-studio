import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  Connection,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { GraphLayoutRevision, NarrativeGraphVersion, NarrativeNode, NodeContentBinding } from '../../clients/interactiveProductionClient';
import { bindingMediaTakeRefs, bindingScriptSceneRefs } from '../../domains/interactive/binding/nodeContentBinding';
import {
  findStoryFlowFeedbackEdgeIds,
  StoryFlowNodeRect,
} from '../../domains/interactive/layout/graphEdgeRouting';
import { useSettingsStore } from '../../clients/stateClient';
import { InteractiveNarrativeNodeCard } from './whiteboard/InteractiveNarrativeNodeCard';
import { InteractiveChoiceEdge } from './whiteboard/InteractiveChoiceEdge';

type CanvasNodeData = {
  node: NarrativeNode;
  isEntry: boolean;
  hasScriptBinding?: boolean;
  scriptSceneCount?: number;
  hasMediaTake?: boolean;
  reviewRecommended?: boolean;
  hasBlockingIssue?: boolean;
  onSelectNode: (nodeId: string) => void;
  onDoubleSelectNode: (nodeId: string) => void;
};

const nodeTypes = { narrative: InteractiveNarrativeNodeCard };
const edgeTypes = { choice: InteractiveChoiceEdge };
const noopSelectNode = () => {};

const toFlowNodes = (
  graph: NarrativeGraphVersion,
  layout: GraphLayoutRevision | null,
  bindings: NodeContentBinding[] = [],
  onSelectNode: (nodeId: string) => void,
  onDoubleSelectNode: (nodeId: string) => void,
  visibleNodeIds?: string[]
): Node<CanvasNodeData>[] => {
  const visible = visibleNodeIds ? new Set(visibleNodeIds) : null;
  const bindingMap = new Map(bindings.map((b) => [b.nodeId, b]));

  return graph.nodes
    .filter((node) => !visible || visible.has(node.id))
    .map((node, index) => {
      const binding = bindingMap.get(node.id);
      const scriptSceneCount = bindingScriptSceneRefs(binding).length;
      const hasScriptBinding = scriptSceneCount > 0;
      const hasMediaTake = bindingMediaTakeRefs(binding).length > 0;

      return {
        id: node.id,
        type: 'narrative',
        position: layout?.nodes[node.id] || {
          x: 100 + (index % 4) * 340,
          y: 140 + Math.floor(index / 4) * 230,
        },
        data: {
          node,
          isEntry: graph.entryNodeId === node.id,
          hasScriptBinding,
          scriptSceneCount,
          hasMediaTake,
          reviewRecommended: binding?.sourceReview?.status === 'review_recommended',
          onSelectNode,
          onDoubleSelectNode,
        },
      };
    });
};

const toFlowEdges = (
  graph: NarrativeGraphVersion,
  selectedChoiceId: string,
  onSelectChoice: (sourceNodeId: string, choiceId: string) => void,
  onDeleteChoice: (choiceId: string) => void,
  flowNodes: Node<CanvasNodeData>[],
  visibleNodeIds?: string[]
): Edge[] => {
  const visible = visibleNodeIds ? new Set(visibleNodeIds) : null;
  const transitions = graph.transitions || [];

  const edgesFromTransitions = transitions
    .filter((t) => (!visible || visible.has(t.sourceNodeId)) && (!visible || visible.has(t.targetNodeId)))
    .map((t) => ({
      id: t.id,
      source: t.sourceNodeId,
      target: t.targetNodeId,
      type: 'choice',
      selected: t.id === selectedChoiceId,
      data: {
        choice: t,
        onSelectChoice: (choiceId: string) => onSelectChoice(t.sourceNodeId, choiceId),
        onDeleteChoice,
      },
    }));

  const legacyEdges = graph.nodes
    .filter((node) => !visible || visible.has(node.id))
    .flatMap((node) =>
      node.choices
        .filter((choice) => !visible || visible.has(choice.targetNodeId))
        .map((choice) => ({
          id: choice.id,
          source: node.id,
          target: choice.targetNodeId,
          type: 'choice',
          label: choice.text || '未命名选择',
          selected: choice.id === selectedChoiceId,
          data: {
            choice,
            onSelectChoice: (choiceId: string) => onSelectChoice(node.id, choiceId),
            onDeleteChoice,
          },
        }))
    );

  const edgeMap = new Map<string, Edge>();
  [...edgesFromTransitions, ...legacyEdges].forEach((e) => edgeMap.set(e.id, e));
  const deduplicatedEdges = Array.from(edgeMap.values());
  const feedbackEdgeIds = findStoryFlowFeedbackEdgeIds(
    flowNodes.map((node) => node.id),
    deduplicatedEdges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
    })),
  );
  const obstacles: StoryFlowNodeRect[] = flowNodes.map((node) => ({
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width || node.width || 256,
    height: node.measured?.height || node.height || 180,
  }));
  let feedbackLaneIndex = 0;

  return deduplicatedEdges.map((edge, index) => {
    const feedback = feedbackEdgeIds.has(edge.id);
    const laneIndex = feedback ? feedbackLaneIndex++ : index % 4;
    return {
      ...edge,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
      data: {
        ...(edge.data || {}),
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        obstacles,
        feedback,
        laneIndex,
      },
    };
  });
};

export type CanvasProps = {
  graph: NarrativeGraphVersion;
  layout: GraphLayoutRevision | null;
  bindings?: NodeContentBinding[];
  visibleNodeIds?: string[];
  selectedNodeId: string;
  selectedChoiceId: string;
  locked?: boolean;
  onSelectNode: (nodeId: string) => void;
  onDoubleSelectNode?: (nodeId: string) => void;
  onSelectChoice: (sourceNodeId: string, choiceId: string) => void;
  onDeleteChoice?: (choiceId: string) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onChangeLayout: (layout: Pick<GraphLayoutRevision, 'nodes' | 'viewport'>) => void;
  onPaneClick?: () => void;
  onFitViewRef?: React.MutableRefObject<((nodeId?: string) => void) | null>;
};

function InnerCanvas({
  graph,
  layout,
  bindings = [],
  visibleNodeIds,
  selectedNodeId,
  selectedChoiceId,
  locked = false,
  onSelectNode,
  onDoubleSelectNode = noopSelectNode,
  onSelectChoice,
  onDeleteChoice = () => {},
  onConnectNodes,
  onChangeLayout,
  onPaneClick,
  onFitViewRef,
}: CanvasProps) {
  const { theme } = useSettingsStore();
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!onFitViewRef) return;
    const fitCanvas = (nodeId?: string) => fitView({
      nodes: nodeId ? [{ id: nodeId }] : undefined,
      padding: nodeId ? 1 : 0.25,
      maxZoom: nodeId ? 1 : undefined,
      duration: 350,
    });
    onFitViewRef.current = fitCanvas;
    return () => {
      if (onFitViewRef.current === fitCanvas) onFitViewRef.current = null;
    };
  }, [fitView, onFitViewRef]);

  const initialNodes = useMemo(
    () => toFlowNodes(graph, layout, bindings, onSelectNode, onDoubleSelectNode, visibleNodeIds),
    [graph, layout, bindings, onSelectNode, onDoubleSelectNode, visibleNodeIds]
  );
  const [nodes, setNodes] = useState<Node<CanvasNodeData>[]>(initialNodes);
  const synchronizedNodesRef = useRef(initialNodes);

  useEffect(() => {
    if (synchronizedNodesRef.current === initialNodes) return;
    synchronizedNodesRef.current = initialNodes;
    setNodes(initialNodes);
  }, [initialNodes]);

  const edges = useMemo(
    () => toFlowEdges(graph, selectedChoiceId, onSelectChoice, onDeleteChoice, nodes, visibleNodeIds),
    [graph, selectedChoiceId, onSelectChoice, onDeleteChoice, nodes, visibleNodeIds]
  );

  const handleNodesChange = (changes: NodeChange<Node<CanvasNodeData>>[]) => {
    if (locked) return;
    setNodes((current) => applyNodeChanges(changes, current));
  };

  const handleNodeDragStop = (_: React.MouseEvent, node: Node) => {
    if (locked) return;
    const positions = Object.fromEntries(
      nodes.map((n) => [n.id, n.id === node.id ? { x: node.position.x, y: node.position.y } : { x: n.position.x, y: n.position.y }])
    );
    onChangeLayout({ nodes: positions, viewport: layout?.viewport });
  };

  const handleConnect = (connection: Connection) => {
    if (locked || !connection.source || !connection.target || connection.source === connection.target) return;
    onConnectNodes(connection.source, connection.target);
  };

  return (
    <div className="relative w-full h-full bg-bg-primary text-text-primary overflow-hidden transition-colors duration-200">
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
          <div className="max-w-sm border border-border-soft/40 bg-bg-surface/90 dark:bg-neutral-900/90 backdrop-blur-md px-6 py-5 text-center rounded-2xl shadow-2xl">
            <p className="text-sm font-bold text-text-primary">这个范围还没有可编辑节点</p>
            <p className="mt-1.5 text-xs leading-5 text-text-muted">拖动只整理画布；从端口连线才会创建一条可编辑的选择。</p>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onPaneClick?.()}
        nodesDraggable={!locked}
        nodesConnectable={!locked}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        colorMode={isDark ? 'dark' : 'light'}
      >
        <Background gap={24} size={1.5} color={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'} />
        <Controls className="!bottom-12 !border-border-soft/40 !bg-bg-surface/90 dark:!bg-neutral-900/90 !text-text-primary !rounded-2xl !shadow-xl overflow-hidden" showInteractive={false} />
        <MiniMap
          zoomable
          pannable
          className="!bottom-12 !hidden !border !border-border-soft/40 !bg-bg-surface/90 dark:!bg-neutral-900/90 !rounded-2xl overflow-hidden !shadow-2xl sm:!block cursor-pointer"
          nodeColor={() => '#00cae0'}
          maskColor={isDark ? 'rgba(15,15,18,0.75)' : 'rgba(245,247,251,0.75)'}
        />
      </ReactFlow>
    </div>
  );
}

export default function InteractiveGraphCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}
