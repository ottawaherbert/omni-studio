import { useState, useEffect } from 'react';
import { Plus, ArrowUp, ArrowDown, Trash2, Sparkles, FolderTree, ChevronDown } from 'lucide-react';
import type { DeliveryUnit, ScriptProject, StructureNode } from '../../../../../../packages/script/src/schema';
import { newId } from '../../../../../../packages/script/src/project';
import { structureNodeSceneIds, updateUnitStructure } from '../../../../../../packages/script/src/structure';
import toast from 'react-hot-toast';

interface StructureNodeRowProps {
  node: StructureNode;
  nodes: StructureNode[];
  unit: DeliveryUnit;
  selectedNodeId?: string;
  onSelectNode: (id?: string) => void;
  onRequest: (nodeId: string) => void;
  move: (node: StructureNode, direction: number) => void;
  commit: (
    next: StructureNode[],
    sceneMembership?: Record<string, string | null>,
    sceneOrder?: string[],
  ) => void;
}

function StructureNodeRow({
  node,
  nodes,
  unit,
  selectedNodeId,
  onSelectNode,
  onRequest,
  move,
  commit,
}: StructureNodeRowProps) {
  const [titleValue, setTitleValue] = useState(node.title);
  const [purposeValue, setPurposeValue] = useState(node.purpose || '');

  // Synchronize when node content changes (e.g. adopted new content from revision/AI)
  useEffect(() => {
    setTitleValue(node.title);
  }, [node.id, node.title]);

  useEffect(() => {
    setPurposeValue(node.purpose || '');
  }, [node.id, node.purpose]);

  const handleTitleBlur = () => {
    const text = titleValue.trim();
    if (!text) {
      setTitleValue(node.title);
      return;
    }
    if (text !== node.title) {
      commit(nodes.map((item) => (item.id === node.id ? { ...item, title: text } : item)));
    }
  };

  const handlePurposeBlur = () => {
    if (purposeValue !== (node.purpose || '')) {
      commit(nodes.map((item) => (item.id === node.id ? { ...item, purpose: purposeValue } : item)));
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-bg-surface shadow-xs transition-all ${
        node.parentId ? 'ml-4' : ''
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          aria-pressed={selectedNodeId === node.id}
          onClick={() => onSelectNode(node.id)}
          className={`px-2.5 py-1 rounded-lg text-left truncate font-medium transition-colors ${
            selectedNodeId === node.id
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-text-primary hover:bg-bg-surface-hover'
          }`}
        >
          {node.title} · {structureNodeSceneIds(unit, node.id).length} 场
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          title={`规划${node.title}分场`}
          aria-label={`规划${node.title}分场`}
          onClick={() => onRequest(node.id)}
          className="p-1.5 rounded-lg hover:bg-primary/10 text-primary transition-colors cursor-pointer"
        >
          <Sparkles size={13} />
        </button>
        <button
          type="button"
          title="整体上移"
          aria-label={`整体上移${node.title}`}
          onClick={() => move(node, -1)}
          className="p-1.5 rounded-lg hover:bg-bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          title="整体下移"
          aria-label={`整体下移${node.title}`}
          onClick={() => move(node, 1)}
          className="p-1.5 rounded-lg hover:bg-bg-surface-hover text-text-muted hover:text-text-primary transition-colors cursor-pointer"
        >
          <ArrowDown size={12} />
        </button>

        <details className="relative inline-block">
          <summary className="cursor-pointer px-2 py-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover transition-colors select-none">
            编辑
          </summary>
          <div className="pt-2 space-y-2 w-full min-w-[280px]">
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`修改${node.title}名称`}
                value={titleValue}
                onChange={(event) => setTitleValue(event.target.value)}
                onBlur={handleTitleBlur}
                className="min-w-0 flex-1 px-3 py-1.5 bg-bg-surface-soft rounded-xl text-text-primary outline-none focus:ring-1 focus:ring-primary/30"
              />
              <select
                aria-label={`${node.title}上级`}
                value={node.parentId || ''}
                onChange={(event) =>
                  commit(
                    nodes.map((item) =>
                      item.id === node.id ? { ...item, parentId: event.target.value || undefined } : item,
                    ),
                  )
                }
                className="bg-bg-surface-soft rounded-xl px-2.5 py-1.5 text-text-primary outline-none cursor-pointer"
              >
                <option value="">顶层</option>
                {nodes
                  .filter(
                    (item) =>
                      !item.parentId &&
                      item.id !== node.id &&
                      !nodes.some((child) => child.parentId === node.id),
                  )
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                title="删除目录，保留全部场景"
                onClick={() => {
                  const deleted = new Set([
                    node.id,
                    ...nodes.filter((item) => item.parentId === node.id).map((item) => item.id),
                  ]);
                  commit(
                    nodes.filter((item) => !deleted.has(item.id)),
                    Object.fromEntries(
                      unit.scenes
                        .filter((item) => deleted.has(item.structureNodeId || ''))
                        .map((item) => [item.id, null]),
                    ),
                  );
                  if (selectedNodeId && deleted.has(selectedNodeId)) onSelectNode(undefined);
                }}
                className="p-1.5 rounded-lg text-text-muted hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <textarea
              aria-label={`${node.title}段落安排`}
              value={purposeValue}
              onChange={(event) => setPurposeValue(event.target.value)}
              placeholder="本段发生什么、人物与信息如何推进"
              rows={2}
              onBlur={handlePurposeBlur}
              className="w-full p-2.5 bg-bg-surface-soft rounded-xl text-text-primary outline-none focus:ring-1 focus:ring-primary/30 resize-none leading-relaxed"
            />
          </div>
        </details>
      </div>
    </div>
  );
}

export function ScriptStructureEditor({
  project,
  unit,
  selectedNodeId,
  onSelectNode,
  onChange,
  onRequest,
}: {
  project: ScriptProject;
  unit: DeliveryUnit;
  selectedNodeId?: string;
  onSelectNode: (id?: string) => void;
  onChange: (fn: (draft: ScriptProject) => void) => void;
  onRequest: (nodeId: string) => void;
}) {
  const [title, setTitle] = useState('');
  useEffect(() => {
    setTitle('');
  }, [project.id, unit.id]);
  const nodes = unit.structureNodes || [];

  const commit = (
    next: StructureNode[],
    sceneMembership?: Record<string, string | null>,
    sceneOrder?: string[],
  ) => {
    try {
      const updated = updateUnitStructure(project, unit.id, {
        nodes: next,
        ...(sceneMembership ? { sceneMembership } : {}),
        ...(sceneOrder ? { sceneOrder } : {}),
      });
      onChange((draft) => {
        Object.assign(draft, updated);
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : '结构修改未通过校验');
    }
  };

  const move = (node: StructureNode, direction: number) => {
    const siblings = nodes.filter((item) => item.parentId === node.parentId),
      index = siblings.findIndex((item) => item.id === node.id),
      other = siblings[index + direction];
    if (!other) return;
    const group = (id: string) => nodes.filter((item) => item.id === id || item.parentId === id);
    const left = group(node.id),
      right = group(other.id);
    const next = nodes.flatMap((item) =>
      item.id === node.id
        ? right
        : item.id === other.id
          ? left
          : left.includes(item) || right.includes(item)
            ? []
            : [item],
    );
    commit(next);
  };

  const assign = (sceneId: string, nodeId: string) => {
    const moved = unit.scenes.find((item) => item.id === sceneId)!;
    const remaining = unit.scenes.filter((item) => item.id !== sceneId);
    let at = remaining.length;
    if (nodeId) {
      const members = new Set(structureNodeSceneIds(unit, nodeId));
      const last = remaining.reduce((last, item, index) => (members.has(item.id) ? index : last), -1);
      if (last >= 0) at = last + 1;
      else {
        const position = nodes.findIndex((item) => item.id === nodeId),
          following = new Set(nodes.slice(position + 1).map((item) => item.id));
        const next = remaining.findIndex((item) => following.has(item.structureNodeId || ''));
        if (next >= 0) at = next;
      }
    }
    const order = remaining.map((item) => item.id);
    order.splice(at, 0, moved.id);
    commit(nodes, { [sceneId]: nodeId || null }, order);
  };

  return (
    <details
      className="script-structure-editor group rounded-2xl bg-bg-surface-soft/40 p-4 text-xs"
      open={Boolean(selectedNodeId)}
    >
      <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary flex items-center justify-between select-none py-1">
        <div className="flex items-center gap-2">
          <FolderTree size={14} className="text-primary" />
          <span className="font-semibold text-text-primary">
            幕／段落目录（可选）{nodes.length ? ` · ${nodes.length}` : ''}
          </span>
        </div>
        <ChevronDown size={14} className="text-text-muted transition-transform group-open:rotate-180" />
      </summary>

      <div className="pt-3.5 space-y-3">
        {/* Node Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-primary={!selectedNodeId ? 'true' : undefined}
            onClick={() => onSelectNode(undefined)}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
              !selectedNodeId
                ? 'script-primary-btn bg-text-primary text-bg-surface shadow-xs'
                : 'bg-bg-surface hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary'
            }`}
          >
            全部场景
          </button>
        </div>

        {/* Node Items */}
        <div className="space-y-2">
          {nodes.map((node) => (
            <StructureNodeRow
              key={node.id}
              node={node}
              nodes={nodes}
              unit={unit}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
              onRequest={onRequest}
              move={move}
              commit={commit}
            />
          ))}
        </div>

        {/* Add Node Form */}
        <form
          className="flex items-center gap-2 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (!title.trim()) return;
            commit([...nodes, { id: newId('structure'), title: title.trim() }]);
            setTitle('');
          }}
        >
          <input
            aria-label="新增幕或段落名称"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="新增幕或段落名称，由作者决定"
            className="min-w-0 flex-1 px-3 py-2 bg-bg-surface rounded-xl text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-primary/30 shadow-2xs"
          />
          <button
            type="submit"
            data-primary="true"
            disabled={!title.trim()}
            className="script-primary-btn inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-text-primary text-bg-surface font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-xs transition-all cursor-pointer"
            aria-label="新增幕或段落"
          >
            <Plus size={14} />
            <span>添加</span>
          </button>
        </form>

        {/* Reassign Scenes Accordion */}
        {nodes.length > 0 && (
          <details className="group/assign rounded-xl bg-bg-surface p-3 text-xs shadow-2xs">
            <summary className="cursor-pointer font-medium text-text-secondary hover:text-text-primary flex items-center justify-between select-none">
              <span>调整场景归属 · 未分组 {unit.scenes.filter((item) => !item.structureNodeId).length} 场</span>
              <ChevronDown size={13} className="text-text-muted transition-transform group-open/assign:rotate-180" />
            </summary>
            <div className="max-h-56 overflow-y-auto pt-3 space-y-2 pr-1">
              {unit.scenes.map((scene, index) => (
                <label
                  key={scene.id}
                  className="flex items-center justify-between gap-3 p-1.5 rounded-lg hover:bg-bg-surface-hover/60 transition-colors"
                >
                  <span className="truncate text-text-primary font-medium">
                    {index + 1}. {scene.title}
                  </span>
                  <select
                    aria-label={`${scene.title}归属`}
                    value={scene.structureNodeId || ''}
                    onChange={(event) => assign(scene.id, event.target.value)}
                    className="max-w-[55%] bg-bg-surface-soft rounded-lg px-2 py-1 text-text-primary outline-none cursor-pointer"
                  >
                    <option value="">未分组</option>
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.parentId ? '　' : ''}
                        {node.title}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}
