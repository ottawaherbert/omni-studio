import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Flag, Play, CircleCheck, AlertCircle, Sparkles, AlertTriangle, Route } from 'lucide-react';
import type { NarrativeNode } from '../../../clients/interactiveProductionClient';
import { nodeRequiresMainContent } from '../../../domains/interactive/nodeContentRequirements';

export interface InteractiveNarrativeNodeCardData {
  node: NarrativeNode;
  isEntry?: boolean;
  hasScriptBinding?: boolean;
  scriptSceneCount?: number;
  hasMediaTake?: boolean;
  reviewRecommended?: boolean;
  hasBlockingIssue?: boolean;
  issueCount?: number;
  isSelected?: boolean;
  onSelectNode?: (nodeId: string) => void;
  onDoubleSelectNode?: (nodeId: string) => void;
}

const DRAMATIC_FUNCTION_LABELS: Record<string, string> = {
  exposition: '序幕铺垫',
  inciting_incident: '引发事件',
  choice_point: '抉择时刻',
  climax: '剧情高潮',
  resolution: '结局收束',
  ending: '最终结局',
};

export const InteractiveNarrativeNodeCard: React.FC<NodeProps> = ({ data, selected }) => {
  const nodeData = data as unknown as InteractiveNarrativeNodeCardData;
  const node = nodeData.node;
  const isEntry = nodeData.isEntry;
  const isEnding = node?.brief?.dramaticFunction === 'ending';
  const isChoicePoint = node?.brief?.dramaticFunction === 'choice_point';
  const isFailOrRetry = node?.interaction?.capabilities?.includes('fail_or_retry');
  const choicesCount = node?.choices?.length ?? 0;

  const dramaticFunctionText = DRAMATIC_FUNCTION_LABELS[node?.brief?.dramaticFunction] || '叙事节点';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    nodeData.onSelectNode?.(node.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    nodeData.onDoubleSelectNode?.(node.id);
  };

  if (!nodeRequiresMainContent(node)) {
    return (
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`
          relative flex w-52 cursor-pointer select-none items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-text-primary shadow-lg backdrop-blur-xl transition-all duration-200
          ${selected ? 'border-sky-500 bg-bg-surface dark:bg-neutral-900 ring-2 ring-sky-500/50 shadow-sky-500/20' : 'border-border-soft/40 bg-bg-surface/90 dark:bg-neutral-900/90 hover:border-gold/50'}
        `}
      >
        <Handle type="target" position={Position.Left} title="输入" className="!h-3 !w-3 !border-2 !border-bg-surface !bg-sky-500" />
        <Route className="h-4 w-4 shrink-0 text-sky-400" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs font-bold text-text-primary">{node?.brief?.title || '自动衔接'}</h3>
          <p className="mt-0.5 text-[10px] text-text-muted">自动衔接</p>
        </div>
        <Handle type="source" position={Position.Right} title="输出" className="!h-3 !w-3 !border-2 !border-bg-surface !bg-sky-500" />
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`
        w-64 rounded-2xl p-4 transition-all duration-200 cursor-pointer select-none text-text-primary relative shadow-xl backdrop-blur-xl border
        ${selected ? 'ring-2 ring-gold/70 shadow-gold/20 bg-bg-surface dark:bg-neutral-900 border-gold' : 'bg-bg-surface/90 dark:bg-neutral-900/90 border-border-soft/40 hover:border-gold/40 hover:shadow-2xl'}
      `}
    >
      <Handle type="target" position={Position.Left} title="输入" className="!w-3 !h-3 !bg-gold !border-2 !border-bg-surface" />

      {/* Header Badges */}
      <div className="flex items-center justify-between gap-1 mb-2.5">
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          {isEntry && (
            <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center">
              <Play className="w-2.5 h-2.5 mr-1 fill-current" />
              起点
            </span>
          )}
          {isEnding && (
            <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-purple-500/15 text-purple-500 border border-purple-500/30 flex items-center">
              <Flag className="w-2.5 h-2.5 mr-1" />
              结局
            </span>
          )}
          {isFailOrRetry && (
            <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-rose-500/15 text-rose-500 border border-rose-500/30 flex items-center">
              <AlertTriangle className="w-2.5 h-2.5 mr-1" />
              重试/失败
            </span>
          )}
          {nodeData.reviewRecommended && (
            <span className="flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold text-amber-500">
              <AlertTriangle className="mr-1 h-2.5 w-2.5" />
              来源有更新
            </span>
          )}
          {!isEntry && !isEnding && (
            <span className="px-2.5 py-0.5 text-[10px] font-medium rounded-full bg-bg-surface-soft text-text-secondary border border-border-soft/40">
              {dramaticFunctionText}
            </span>
          )}
        </div>

        {nodeData.hasBlockingIssue && (
          <span className="p-1 rounded-full bg-rose-500/15 text-rose-500 border border-rose-500/30" title="存在阻断问题">
            <AlertCircle className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

      {/* Node Title & Intent */}
      <div className="mb-3">
        <h3 className="font-bold text-sm text-text-primary truncate mb-1">
          {node?.brief?.title || '未命名节点'}
        </h3>
        <p className="text-xs text-text-muted line-clamp-2 leading-relaxed">
          {node?.brief?.intent || node?.brief?.narrativeSummary || '未填写叙事意图'}
        </p>
      </div>

      {/* Status Footer */}
      <div className="pt-2.5 border-t border-border-soft/30 flex items-center justify-between text-[11px] text-text-muted">
        <span
          className={`flex items-center font-medium ${nodeData.hasMediaTake ? 'text-emerald-500' : nodeData.hasScriptBinding ? 'text-sky-500' : 'text-text-muted'}`}
          title={nodeData.hasMediaTake ? '这个节点已有可查看画面' : nodeData.hasScriptBinding ? '这个节点已绑定故事内容' : '可以让 AI 继续完善这个节点'}
        >
          {nodeData.hasScriptBinding || nodeData.hasMediaTake
            ? <CircleCheck className="mr-1 h-3.5 w-3.5 text-emerald-500" />
            : <Sparkles className="mr-1 h-3.5 w-3.5 text-gold" />}
          {nodeData.hasMediaTake
            ? '可看片'
            : nodeData.hasScriptBinding
              ? `${nodeData.scriptSceneCount || 1} 场内容`
              : '待完善'}
        </span>

        <span className="rounded-lg bg-bg-surface-soft px-2 py-0.5 text-[10px] font-bold text-text-secondary border border-border-soft/30">
          {choicesCount} 选择
        </span>
      </div>

      <Handle type="source" position={Position.Right} title="输出" className="!w-3 !h-3 !bg-gold !border-2 !border-bg-surface" />
    </div>
  );
};
