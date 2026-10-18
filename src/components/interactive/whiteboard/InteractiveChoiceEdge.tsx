import React from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, EdgeProps } from '@xyflow/react';
import { Clock, RotateCcw, Trash2 } from 'lucide-react';
import type { InteractiveChoice } from '../../../clients/interactiveProductionClient';
import {
  buildStoryFlowEdgeRoute,
  StoryFlowNodeRect,
} from '../../../domains/interactive/layout/graphEdgeRouting';
import { useSettingsStore } from '../../../clients/stateClient';

export interface InteractiveChoiceEdgeData {
  choice: InteractiveChoice;
  sourceNodeId?: string;
  targetNodeId?: string;
  obstacles?: StoryFlowNodeRect[];
  feedback?: boolean;
  laneIndex?: number;
  onSelectChoice?: (choiceId: string) => void;
  onDeleteChoice?: (choiceId: string) => void;
}

export const InteractiveChoiceEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}) => {
  const { edgeLineMode } = useSettingsStore();

  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const [smoothStepPath, smoothStepLabelX, smoothStepLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const [straightPath, straightLabelX, straightLabelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  const edgeData = data as unknown as InteractiveChoiceEdgeData;
  const choice = edgeData?.choice;
  const hasTimeout = Boolean(choice?.timeoutSeconds);
  const route = edgeData?.sourceNodeId && edgeData?.targetNodeId
    ? buildStoryFlowEdgeRoute({
      edgeId: id,
      sourceNodeId: edgeData.sourceNodeId,
      targetNodeId: edgeData.targetNodeId,
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY },
      obstacles: edgeData.obstacles || [],
      feedback: edgeData.feedback,
      laneIndex: edgeData.laneIndex,
    })
    : null;

  const isLoop = route?.kind === 'loop' || Boolean(edgeData?.feedback);
  const useDirectPath = route ? route.kind === 'forward' : targetX >= sourceX + 30 && !edgeData?.feedback;

  let edgePath = bezierPath;
  let labelX = bezierLabelX;
  let labelY = bezierLabelY;

  if (edgeLineMode === 'orthogonal') {
    edgePath = useDirectPath ? smoothStepPath : (route?.path || smoothStepPath);
    labelX = useDirectPath ? smoothStepLabelX : (route?.label.x ?? smoothStepLabelX);
    labelY = useDirectPath ? smoothStepLabelY : (route?.label.y ?? smoothStepLabelY);
  } else if (edgeLineMode === 'straight') {
    edgePath = useDirectPath ? straightPath : (route?.path || straightPath);
    labelX = useDirectPath ? straightLabelX : (route?.label.x ?? straightLabelX);
    labelY = useDirectPath ? straightLabelY : (route?.label.y ?? straightLabelY);
  } else {
    edgePath = useDirectPath ? bezierPath : (route?.path || bezierPath);
    labelX = useDirectPath ? bezierLabelX : (route?.label.x ?? bezierLabelX);
    labelY = useDirectPath ? bezierLabelY : (route?.label.y ?? bezierLabelY);
  }

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 3 : 2,
          stroke: selected ? '#00cae0' : isLoop ? '#f59e0b' : '#94a3b8',
          strokeDasharray: isLoop ? '6 4' : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan flex items-center z-10"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              edgeData?.onSelectChoice?.(choice?.id || id);
            }}
            className={`
              px-3 py-1.5 rounded-full text-xs font-bold flex items-center space-x-1.5 shadow-md cursor-pointer transition-all border select-none
              ${
                selected
                  ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500 shadow-cyan-500/20 ring-2 ring-cyan-500/20'
                  : 'bg-white/95 dark:bg-neutral-900/95 text-gray-800 dark:text-neutral-200 border-gray-200 dark:border-neutral-700 hover:border-cyan-400 shadow-sm hover:shadow'
              }
            `}
          >
            {isLoop && (
              <span title="这个选择会回到前面的故事">
                <RotateCcw className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              </span>
            )}
            <span className="max-w-[150px] truncate">{choice?.text || '点击配置选项'}</span>

            {hasTimeout && (
              <span title={`限时 ${choice.timeoutSeconds}s`}>
                <Clock className="w-3.5 h-3.5 text-sky-500" />
              </span>
            )}

            {selected && edgeData?.onDeleteChoice && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  edgeData.onDeleteChoice!(choice?.id || id);
                }}
                className="ml-1 p-0.5 rounded text-gray-400 hover:text-rose-500 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
                title="删除选项"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
};
