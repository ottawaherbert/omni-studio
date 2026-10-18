import React, { useMemo } from 'react';
import { ChevronUp, ChevronDown, Clock, Route, X } from 'lucide-react';
import {
  normalizeNarrativeGraph,
  type DurationBudget,
  type NarrativeGraphVersion,
} from '../../../clients/interactiveProductionClient';
import { summarizeInteractiveGraphDuration } from '../../../domains/interactive/analysis/graphDurationSummary.ts';
import { nodeRequiresMainContent } from '../../../domains/interactive/nodeContentRequirements.ts';

export interface InteractivePathDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  graph: NarrativeGraphVersion;
  durationBudget?: DurationBudget;
  nodeDurationSeconds?: Record<string, number>;
  mappedScreenplayNodeCount?: number;
  onFocusNode?: (nodeId: string) => void;
}

const formatDuration = (seconds: number) => {
  const roundedMinutes = Math.max(0, Math.round(seconds / 60));
  if (roundedMinutes < 60) return `${roundedMinutes} 分钟`;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
};

const formatRange = (range: [number, number] | undefined) => {
  if (!range) return '尚无完整路线';
  const minimum = formatDuration(range[0]);
  const maximum = formatDuration(range[1]);
  return minimum === maximum ? minimum : `${minimum} - ${maximum}`;
};

export const InteractivePathDrawer: React.FC<InteractivePathDrawerProps> = ({
  isOpen,
  onToggle,
  graph,
  durationBudget,
  nodeDurationSeconds,
  mappedScreenplayNodeCount = 0,
  onFocusNode,
}) => {
  const {
    nodes,
    plannedSummary,
    screenplaySummary,
    timedScreenplayNodeCount,
    requiredScreenplayNodeCount,
  } = useMemo(() => {
    const normalizedNodes = normalizeNarrativeGraph(graph).nodes;
    const screenplayNodes = normalizedNodes.filter(nodeRequiresMainContent);
    const timedNodeCount = screenplayNodes.filter((node) => {
      const seconds = nodeDurationSeconds?.[node.id];
      return Number.isFinite(seconds) && Number(seconds) > 0;
    }).length;
    return {
      nodes: normalizedNodes,
      plannedSummary: summarizeInteractiveGraphDuration(graph),
      screenplaySummary: timedNodeCount > 0
        ? summarizeInteractiveGraphDuration(graph, (node) => {
            if (!nodeRequiresMainContent(node)) return [0, 0];
            const seconds = nodeDurationSeconds?.[node.id];
            return Number.isFinite(seconds) && Number(seconds) > 0
              ? [Number(seconds), Number(seconds)]
              : [0, 0];
          })
        : null,
      timedScreenplayNodeCount: timedNodeCount,
      requiredScreenplayNodeCount: screenplayNodes.length,
    };
  }, [graph, nodeDurationSeconds]);
  const typicalPath = plannedSummary.typicalPath;
  const longestPath = plannedSummary.longestPath;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const choiceIntervalSec = typicalPath?.choicePointCount
    ? Math.round(
      ((typicalPath.durationRangeSec[0] + typicalPath.durationRangeSec[1]) / 2)
      / typicalPath.choicePointCount,
    )
    : 0;

  return (
    <div className="fixed bottom-0 left-14 md:left-20 right-0 z-30 flex flex-col items-center pointer-events-none select-none">
      {/* Drawer Toggle Bar */}
      <button
        type="button"
        onClick={onToggle}
        className="pointer-events-auto flex max-w-full items-center space-x-2 rounded-t-2xl border-x border-t border-border-soft/40 bg-bg-surface/95 dark:bg-neutral-900/95 px-4 py-2 text-xs font-bold text-text-primary shadow-2xl backdrop-blur-xl transition-colors hover:text-gold sm:px-5"
      >
        <Clock className="w-4 h-4 text-gold" />
        <span className="truncate">
          目标单次 {durationBudget ? formatDuration(durationBudget.p50TargetSec) : '未设置'}
          {` · 当前路线 ${formatRange(typicalPath?.durationRangeSec)}`}
          {screenplaySummary
            ? ` · 剧本 ${formatRange(screenplaySummary.typicalPath?.durationRangeSec)}`
            : mappedScreenplayNodeCount > 0
              ? ` · 剧本已映射 ${mappedScreenplayNodeCount}/${requiredScreenplayNodeCount}，待补场次时长`
              : ' · 当前剧本尚未映射'}
        </span>
        {isOpen ? <ChevronDown className="w-4 h-4 ml-1 text-text-muted" /> : <ChevronUp className="w-4 h-4 ml-1 text-text-muted" />}
      </button>

      {/* Expanded Content Panel */}
      {isOpen && (
        <div className="pointer-events-auto flex h-72 w-full max-w-5xl animate-in flex-col space-y-3.5 border-t border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 p-5 shadow-2xl backdrop-blur-xl slide-in-from-bottom duration-200 text-text-primary rounded-t-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-border-soft/30 pb-3 text-xs text-text-muted">
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['目标单次', durationBudget ? formatDuration(durationBudget.p50TargetSec) : '未设置'],
                ['当前典型路线', formatRange(typicalPath?.durationRangeSec)],
                ['当前最短路线', formatRange(plannedSummary.shortestPath?.durationRangeSec)],
                ['最长完整路线', formatRange(longestPath?.durationRangeSec)],
                ['全部独有内容', formatRange(plannedSummary.reachableUniqueRangeSec)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 border-l border-border-soft/30 pl-3">
                  <p className="text-[10px] font-bold text-text-muted">{label}</p>
                  <p className="mt-1 truncate font-bold text-text-primary text-xs">{value}</p>
                </div>
              ))}
            </div>
            <button type="button" onClick={onToggle} aria-label="关闭路径检查" title="关闭" className="p-1 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4 text-[11px] font-medium text-text-muted">
            <span>{plannedSummary.completedPaths.length} 条可达完整路线{plannedSummary.truncated ? '（仅显示有界分析结果）' : ''}</span>
            <span>{choiceIntervalSec ? `典型路线约每 ${formatDuration(choiceIntervalSec)} 出现一次选择` : '典型路线尚无分支选择'}</span>
          </div>
          <div className="flex items-center justify-between gap-4 border-y border-border-soft/20 py-2 text-[11px] font-medium text-text-muted">
            <span>
              当前剧本典型 {screenplaySummary
                ? formatRange(screenplaySummary.typicalPath?.durationRangeSec)
                : mappedScreenplayNodeCount > 0
                  ? '已映射，待补场次时长'
                  : '尚未映射'}
            </span>
            <span>
              已有时长 {timedScreenplayNodeCount} / {requiredScreenplayNodeCount} 个内容节点
              {mappedScreenplayNodeCount > 0
                ? ` · 已映射 ${mappedScreenplayNodeCount} / ${requiredScreenplayNodeCount}`
                : ''}
            </span>
          </div>

          <div className="flex flex-1 items-center space-x-2 overflow-x-auto pb-2">
            {(longestPath?.nodeIds || []).map((nodeId, index, path) => {
              const node = nodeById.get(nodeId);
              if (!node) return null;
              return (
                <React.Fragment key={node.id}>
                  <div
                    onClick={() => onFocusNode?.(node.id)}
                    className="flex min-w-36 shrink-0 cursor-pointer flex-col space-y-1 rounded-xl border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 px-3.5 py-2.5 transition-all hover:border-gold/50 hover:shadow-md"
                  >
                    <span className="font-mono text-[10px] font-bold text-gold">#{index + 1}</span>
                    <span className="truncate text-xs font-bold text-text-primary">{node.brief?.title || node.id}</span>
                  </div>
                  {index < path.length - 1 && (
                    <Route className="h-4 w-4 shrink-0 text-text-muted" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
