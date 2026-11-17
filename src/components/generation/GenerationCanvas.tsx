import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, MarkerType, Position, ReactFlowProvider, applyNodeChanges, getBezierPath, getSmoothStepPath, getStraightPath, getNodesBounds, getViewportForBounds, useReactFlow, type Connection, type EdgeProps, type Node, type NodeProps, type NodeChange, useStoreApi } from '@xyflow/react';
import { Film, Image as ImageIcon, Settings2, FolderPlus, Undo2 } from 'lucide-react';
import { InfiniteCanvas } from '../canvas/InfiniteCanvas';
import { CanvasToolbar } from '../canvas/CanvasToolbar';
import { layoutCanvasGraph } from '../../lib/canvasLayout';
import { useSettingsStore } from '../../clients/stateClient';
import { generationRoleLabels, generationStatusLabels, type GenerationTaskDraft, type GenerationWorkspace, type GenerationReference, type GenerationLayout } from '../../../packages/domain/src/generation';

type CardData = Record<string, unknown> & { label: string; subtitle: string; mediaUrl?: string; mediaKind?: string; kind: 'reference' | 'task' | 'result'; taskId?: string; reference?: GenerationReference };
const GenerationCard = memo(function GenerationCard({ data, selected }: NodeProps<Node<CardData>>) {
  return <div className={`w-64 overflow-hidden rounded-lg border bg-bg-surface text-text-primary shadow-sm ${selected ? 'border-gold ring-2 ring-gold/30' : 'border-border-soft/50'}`}>
    {data.kind !== 'reference' && <Handle type="target" position={Position.Left} isConnectable={data.kind === 'task'} className="!bg-gold" />}
    <div className="flex items-center gap-3 p-3">
      {data.mediaUrl && data.mediaKind === 'image' ? <img src={data.mediaUrl} alt={data.label} className="h-16 w-20 shrink-0 rounded bg-bg-primary object-contain" loading="lazy" /> : <div className="shrink-0 text-gold">{data.kind === 'task' ? <Settings2 size={20} /> : <Film size={20} />}</div>}
      <div className="min-w-0"><strong className="block truncate text-sm" title={data.label}>{data.label}</strong><p className="mt-1 text-xs leading-5 text-text-muted">{data.subtitle}</p></div>
    </div>
    <Handle type="source" position={Position.Right} className="!bg-gold" />
  </div>;
});
function GenerationEdge(props: EdgeProps) {
  const lineMode = useSettingsStore(s => s.edgeLineMode);
  const [path, x, y] = lineMode === 'straight' ? getStraightPath(props) : lineMode === 'orthogonal' ? getSmoothStepPath({ ...props, borderRadius: 12 }) : getBezierPath(props);
  return <><BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={{ stroke: props.selected ? 'var(--color-gold, #00cae0)' : '#77828a', strokeWidth: props.selected ? 3 : 1.5 }} />{props.label && <EdgeLabelRenderer><span className="pointer-events-none absolute rounded border border-border-soft/40 bg-bg-surface px-2 py-1 text-[11px] text-text-secondary" style={{ transform: `translate(-50%,-50%) translate(${x}px,${y}px)` }}>{props.label}</span></EdgeLabelRenderer>}</>;
}
const nodeTypes = { generation: GenerationCard, generationGroup: ({ data }: NodeProps<Node<CardData>>) => <div className="h-full w-full rounded-xl border border-gold/40 bg-gold/5 p-3 text-xs text-gold">{data.label}</div> }, edgeTypes = { generation: GenerationEdge };
function Inner({ workspace, tasks, selectedTaskId, onSelectTask, onSelectReference, onSelectResult, onConnect, onRemoveReference, onLayout, onAdd }: {
  workspace: GenerationWorkspace; tasks: GenerationTaskDraft[]; selectedTaskId: string; onSelectTask: (id: string) => void;
  onSelectReference: (reference: GenerationReference) => void; onSelectResult: (taskId: string) => void;
  onConnect: (source: string, target: string) => void; onRemoveReference: (taskId: string, referenceId: string) => void;
  onLayout: (nodes: GenerationLayout['nodes'], viewport?: GenerationLayout['viewport'], groups?: GenerationLayout['groups']) => void; onAdd: () => void;
}) {
  const { setViewport } = useReactFlow(); const containerRef = useRef<HTMLDivElement>(null); const flowStore = useStoreApi();
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]), [groupLabel, setGroupLabel] = useState('');
  const layoutHistory = useRef<GenerationLayout[]>([]);
  const groups = workspace.layout.groups || [];
  const selectionChanged = useCallback(({ nodes: selected }: { nodes: Node[] }) => { const ids = selected.map(n => n.id); setSelectedNodes(old => old.join('|') === ids.join('|') ? old : ids); }, []);
  const metadata = useRef(workspace.layout.nodes); metadata.current = workspace.layout.nodes;
  const fitView = () => {
    const rect = containerRef.current?.getBoundingClientRect(); if (!rect) return;
    const visible = flowStore.getState().nodes.map(n => ({ ...n, width: n.measured?.width || n.width || 256, height: n.measured?.height || n.height || 200 }));
    if (visible.length) void setViewport(getViewportForBounds(getNodesBounds(visible), rect.width, rect.height, .15, 2, .2), { duration: 180 });
  };
  const selectedEdge = useRef<string | undefined>(undefined); const [edgeId, setEdgeId] = useState('');
  const graph = useMemo(() => {
    const nodes: Node<CardData>[] = [], edges: any[] = [], seen = new Set<string>();
    const add = (id: string, data: CardData) => { if (!seen.has(id)) { seen.add(id); nodes.push({ id, type: 'generation', width: 256, height: 96, position: workspace.layout.nodes[id] || { x: 0, y: 0 }, selected: data.kind === 'task' && data.taskId === selectedTaskId, data }); } };
    for (const task of tasks) {
      const e = workspace.executions.find(e => e.taskId === task.id);
      add(task.id, { kind: 'task', taskId: task.id, label: task.label, subtitle: `${task.narrativeSeconds ? `${task.narrativeSeconds} 秒 · ` : ''}${e ? e.status === 'succeeded' && e.results.length && e.results.every(r => r.review === 'adopted') ? '已采用' : generationStatusLabels[e.status] : '草稿'}` });
      for (const ref of task.references.filter(r => r.enabled)) {
        const source = ref.dependency ? ref.dependency.resultId || ref.dependency.taskId : `ref:${ref.mediaVersionId}`;
        if (!ref.dependency) add(source, { kind: 'reference', label: ref.label, subtitle: generationRoleLabels[ref.role], mediaUrl: ref.mediaUrl, mediaKind: ref.mediaKind, reference: ref });
        edges.push({ id: `${task.id}::${ref.id}`, source, target: task.id, type: 'generation', label: generationRoleLabels[ref.role], data: { taskId: task.id, referenceId: ref.id }, selected: edgeId === `${task.id}::${ref.id}`, markerEnd: { type: MarkerType.ArrowClosed } });
      }
    }
    for (const execution of workspace.executions) for (const result of execution.results) {
      add(result.id, { kind: 'result', taskId: execution.taskId, label: `候选 · ${result.review === 'adopted' ? '已采用' : result.review === 'source_changed' ? '来源变化' : result.review === 'superseded' ? '历史采用' : result.review === 'needs_changes' ? '需修改' : '待检查'}`, subtitle: result.mediaKind === 'video' ? `${result.durationSeconds?.toFixed(2) || '未测量'} 秒` : `${result.width || '?'} × ${result.height || '?'}`, mediaUrl: result.mediaUrl, mediaKind: result.mediaKind });
      edges.push({ id: `out:${result.id}`, source: execution.taskId, target: result.id, type: 'generation', markerEnd: { type: MarkerType.ArrowClosed } });
    }
    const positions = layoutCanvasGraph(nodes, edges, { nodesep: 24, ranksep: 140 });
    for (const node of nodes) if (!workspace.layout.nodes[node.id]) node.position = positions[node.id];
    const collapsed = new Map<string, string>();
    for (const group of groups.filter(g => g.collapsed)) {
      const members = nodes.filter(n => workspace.layout.nodes[n.id]?.groupId === group.id);
      if (!members.length) continue;
      for (const member of members) collapsed.set(member.id, group.id);
      nodes.push({ id: group.id, type: 'generation', position: workspace.layout.nodes[group.id] || members[0].position, data: { kind: 'task', label: group.label, subtitle: `${members.length} 项 · 从上方展开分组` } });
    }
    for (const group of groups.filter(g => !g.collapsed)) {
      const members = nodes.filter(n => workspace.layout.nodes[n.id]?.groupId === group.id);
      if (!members.length) continue;
      const left = Math.min(...members.map(n => n.position.x)) - 20, top = Math.min(...members.map(n => n.position.y)) - 40;
      nodes.unshift({ id: group.id, type: 'generationGroup', position: { x: left, y: top }, selectable: false, draggable: false, connectable: false, zIndex: -1, style: { width: Math.max(...members.map(n => n.position.x + 256)) - left + 20, height: Math.max(...members.map(n => n.position.y + 96)) - top + 20 }, data: { kind: 'task', label: group.label, subtitle: '' } });
    }
    return { nodes: nodes.filter(n => !collapsed.has(n.id)), edges: edges.map(e => ({ ...e, source: collapsed.get(e.source) || e.source, target: collapsed.get(e.target) || e.target })).filter(e => e.source !== e.target) };
  }, [workspace.layout, workspace.executions, tasks, selectedTaskId, edgeId]);
  const [nodes, setNodes] = useState(graph.nodes);
  const layoutRevision = useRef(workspace.layout.revision);
  useEffect(() => { const layoutChanged = layoutRevision.current !== workspace.layout.revision; layoutRevision.current = workspace.layout.revision; setNodes(current => layoutChanged ? graph.nodes : graph.nodes.map(n => ({ ...n, position: current.find(item => item.id === n.id)?.position || n.position }))); }, [graph.nodes, workspace.layout.revision]);
  const saveLayout = (current = nodes, viewport?: GenerationLayout['viewport'], nextGroups = groups, record = true) => {
    const next = { ...metadata.current, ...Object.fromEntries(current.map(n => [n.id, { ...metadata.current[n.id], ...n.position }])) };
    if (record) { layoutHistory.current.push(structuredClone(workspace.layout)); if (layoutHistory.current.length > 30) layoutHistory.current.shift(); }
    onLayout(next, viewport || workspace.layout.viewport, nextGroups);
  };
  return <div className="relative flex h-[calc(100dvh-340px)] min-h-[320px] min-w-0 flex-col bg-bg-primary" aria-label="生成素材无限画布" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); const source = e.dataTransfer.getData('application/omni-generation-reference'); if (source) onConnect(source, selectedTaskId); }}>
    <div className="shrink-0 border-b border-border-soft/30 p-2"><CanvasToolbar inline onAdd={onAdd} addLabel="添加生成任务" onAutoLayout={() => { const positions = layoutCanvasGraph(nodes.filter(n => n.type !== 'generationGroup'), graph.edges, { nodesep: 24, ranksep: 140 }); const arranged = nodes.map(n => ({ ...n, position: positions[n.id] || n.position })); setNodes(arranged); saveLayout(arranged); requestAnimationFrame(fitView); }} onFitView={() => { requestAnimationFrame(fitView); }} /></div>
    <div ref={containerRef} className="relative min-h-0 flex-1">
    {(selectedNodes.length > 1 || groups.length > 0) && <div className="absolute left-3 top-16 z-20 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2 rounded-md border border-border-soft/40 bg-bg-surface/95 p-2 text-xs">
      <input aria-label="分组名称" placeholder="分组名称" value={groupLabel} onChange={e => setGroupLabel(e.target.value)} className="w-24 rounded border border-border-soft/40 bg-bg-primary px-2 py-1" />
      <button title="按住 Shift 框选素材和任务后分组" disabled={!selectedNodes.length || !groupLabel.trim()} onClick={() => { const id = `group:${crypto.randomUUID()}`; metadata.current = { ...metadata.current, ...Object.fromEntries(selectedNodes.map(n => [n, { ...(metadata.current[n] || nodes.find(item => item.id === n)?.position || { x: 0, y: 0 }), groupId: id }])) }; saveLayout(nodes, undefined, [...groups, { id, label: groupLabel.trim(), collapsed: false }]); setGroupLabel(''); }} className="flex items-center gap-1 disabled:opacity-40"><FolderPlus size={14} />分组 {selectedNodes.length || ''}</button>
      <button aria-label="撤销画布布局" disabled={!layoutHistory.current.length} onClick={() => { const prior = layoutHistory.current.pop(); if (prior) onLayout(prior.nodes, prior.viewport, prior.groups); }} className="disabled:opacity-40"><Undo2 size={14} /></button>
      {groups.map(g => <span key={g.id} className="flex items-center gap-1 border-l border-border-soft/40 pl-2"><button onClick={() => saveLayout(nodes, undefined, groups.map(item => item.id === g.id ? { ...item, collapsed: !item.collapsed } : item))}>{g.collapsed ? '展开' : '收起'} {g.label}</button><button aria-label={`解散分组${g.label}`} onClick={() => { metadata.current = Object.fromEntries(Object.entries(metadata.current).map(([id, n]) => [id, n.groupId === g.id ? { ...n, groupId: undefined } : n])); saveLayout(nodes, undefined, groups.filter(item => item.id !== g.id)); }}>×</button></span>)}
    </div>}
    <InfiniteCanvas<Node<CardData>> compact fitViewOptions={{ padding: .1, maxZoom: 1 }} nodes={nodes} edges={graph.edges} fitView={!workspace.layout.viewport} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onSelectionChange={selectionChanged}
      onNodesChange={(changes: NodeChange<Node<CardData>>[]) => setNodes(ns => applyNodeChanges(changes, ns))}
      onNodeClick={(_, node) => {
        if (node.data.kind === 'reference' && node.data.reference) {
          const reference = tasks.find(t => t.id === selectedTaskId)?.references.find(r => r.mediaVersionId === node.data.reference!.mediaVersionId) || node.data.reference;
          onSelectReference(reference);
        } else if (node.data.kind === 'result' && node.data.taskId) onSelectResult(node.data.taskId);
        else if (node.data.taskId) onSelectTask(node.data.taskId);
      }}
      onNodeDragStop={() => saveLayout(flowStore.getState().nodes as Node<CardData>[])}
      onMoveEnd={(_, viewport) => saveLayout(nodes, viewport)} defaultViewport={workspace.layout.viewport}
      onConnect={(c: Connection) => { if (c.source && c.target) onConnect(c.source, c.target); }}
      isValidConnection={c => c.source !== c.target && tasks.some(t => t.id === c.target) && !String(c.source).startsWith('out:')}
      onEdgeClick={(_, e) => { selectedEdge.current = e.id; setEdgeId(e.id); }} onPaneClick={() => setEdgeId('')}>

    </InfiniteCanvas>
    </div>
    {edgeId && graph.edges.find(e => e.id === edgeId)?.data && <button type="button" className="absolute bottom-3 left-3 z-20 rounded-md border border-border-soft bg-bg-surface px-3 py-2 text-xs text-text-primary" onClick={() => { const e = graph.edges.find(e => e.id === edgeId); if (e?.data) onRemoveReference(e.data.taskId, e.data.referenceId); setEdgeId(''); }}>移除此引用</button>}
    <span className="pointer-events-none absolute right-3 bottom-3 rounded bg-bg-surface/90 px-2 py-1 text-[11px] text-text-muted">位置不影响镜头顺序</span>
  </div>;
}
export function GenerationCanvas(props: Parameters<typeof Inner>[0]) { return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>; }
