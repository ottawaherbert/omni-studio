import React from 'react';
import { FileText, Link2, Settings2, SlidersHorizontal } from 'lucide-react';
import { CanvasToolbar } from '../../canvas/CanvasToolbar';

export interface InteractiveCanvasToolbarProps {
  onAddNode: () => void;
  onAutoLayout: () => void;
  onFitView?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onMapWritingContent?: () => void;
  onOpenSettings?: () => void;
  onEditState?: () => void;
  onOpenWriting?: () => void;
}

export const InteractiveCanvasToolbar: React.FC<InteractiveCanvasToolbarProps> = ({
  onAddNode, onAutoLayout, onFitView, isFullscreen = false, onToggleFullscreen,
  onMapWritingContent, onOpenSettings, onEditState, onOpenWriting,
}) => <CanvasToolbar onAdd={onAddNode} onAutoLayout={onAutoLayout} onFitView={onFitView} fullscreen={isFullscreen} onToggleFullscreen={onToggleFullscreen}>
  <details className="relative">
    <summary aria-label="创作设置" title="创作设置" role="button" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl text-text-secondary hover:bg-bg-surface-soft [&::-webkit-details-marker]:hidden"><Settings2 className="h-4 w-4" /></summary>
    <div className="absolute left-0 top-full mt-2 w-40 rounded-lg border border-border-soft/50 bg-bg-surface p-1 shadow-xl">
      {[
        { label: '作品与故事设置', action: onOpenSettings, Icon: Settings2 },
        { label: '故事状态', action: onEditState, Icon: SlidersHorizontal },
        { label: '打开剧本工作区', action: onOpenWriting, Icon: FileText },
      ].filter(item => item.action).map(({ label, action, Icon }) => <button key={label} type="button" onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); action?.(); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-xs text-text-secondary hover:bg-bg-surface-soft"><Icon className="h-4 w-4 text-gold" />{label}</button>)}
    </div>
  </details>
  {onMapWritingContent && <button type="button" onClick={onMapWritingContent} title="映射剧本场次" aria-label="映射剧本场次" className="flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary hover:bg-bg-surface-soft"><Link2 className="h-4 w-4 text-emerald-500" /></button>}
</CanvasToolbar>;
