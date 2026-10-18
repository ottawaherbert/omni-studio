import React from 'react';
import { Plus, LayoutGrid, Maximize2, Minimize2, Link2, Focus, Spline, CornerDownRight, Minus, Check, Settings2, FileText, SlidersHorizontal } from 'lucide-react';
import { useSettingsStore, type EdgeLineMode } from '../../../clients/stateClient';

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
  onAddNode,
  onAutoLayout,
  onFitView,
  isFullscreen = false,
  onToggleFullscreen,
  onMapWritingContent,
  onOpenSettings,
  onEditState,
  onOpenWriting,
}) => {
  const { edgeLineMode, setEdgeLineMode } = useSettingsStore();

  const lineModes: Array<{ id: EdgeLineMode; label: string; icon: typeof Spline }> = [
    { id: 'bezier', label: '曲线连线', icon: Spline },
    { id: 'orthogonal', label: '折线连线', icon: CornerDownRight },
    { id: 'straight', label: '直线连线', icon: Minus },
  ];
  const activeLineMode = lineModes.find((mode) => mode.id === edgeLineMode) || lineModes[0];
  const LineIcon = activeLineMode.icon;

  return (
    <div className="absolute top-3 left-2 z-30 flex items-center gap-1 p-1.5 rounded-2xl bg-bg-surface/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-border-soft/40 shadow-2xl select-none transition-colors sm:top-4 sm:left-4">
      <button
        onClick={onAddNode}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary"
        title="添加节点"
        aria-label="添加节点"
      >
        <Plus className="h-4.5 w-4.5 text-gold" />
      </button>

      <div className="h-4 w-px bg-border-soft/40" />

      <details className="group relative">
        <summary aria-label="创作设置" title="创作设置" role="button" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl text-text-secondary hover:bg-bg-surface-soft [&::-webkit-details-marker]:hidden"><Settings2 className="h-4.5 w-4.5" /></summary>
        <div className="absolute left-0 top-full mt-2 w-40 rounded-lg border border-border-soft/50 bg-bg-surface p-1 shadow-xl">
          {[
            { label: '作品与故事设置', action: onOpenSettings, Icon: Settings2 },
            { label: '故事状态', action: onEditState, Icon: SlidersHorizontal },
            { label: '打开剧本工作区', action: onOpenWriting, Icon: FileText },
          ].filter((item) => item.action).map(({ label, action, Icon }) => <button key={label} type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); action?.(); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold text-text-secondary hover:bg-bg-surface-soft"><Icon className="h-4 w-4 text-gold" />{label}</button>)}
        </div>
      </details>

      {onFitView && (
        <>
          <button
            onClick={onFitView}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary"
            title="回到主视角（居中所有节点）"
            aria-label="回到主视角"
          >
            <Focus className="h-4.5 w-4.5 text-sky-500" />
          </button>
          <div className="h-4 w-px bg-border-soft/40" />
        </>
      )}

      <details className="group relative">
        <summary
          className="flex h-9 w-9 shrink-0 cursor-pointer list-none items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary [&::-webkit-details-marker]:hidden"
          title={`连线样式：${activeLineMode.label}`}
          aria-label={`连线样式：${activeLineMode.label}`}
          aria-haspopup="menu"
          role="button"
        >
          <LineIcon className="h-4.5 w-4.5 text-cyan-500" />
        </summary>
        <div role="menu" className="absolute left-0 top-full mt-2 w-36 overflow-hidden rounded-lg border border-border-soft/50 bg-bg-surface p-1 shadow-xl">
          {lineModes.map((mode) => {
            const ModeIcon = mode.icon;
            const selected = mode.id === edgeLineMode;
            return (
              <button
                key={mode.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={(event) => {
                  setEdgeLineMode(mode.id);
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold text-text-secondary hover:bg-bg-surface-soft hover:text-text-primary"
              >
                <ModeIcon className="h-4 w-4 text-cyan-500" />
                <span className="flex-1 text-left">{mode.label}</span>
                {selected && <Check className="h-3.5 w-3.5 text-gold" />}
              </button>
            );
          })}
        </div>
      </details>

      <div className="h-4 w-px bg-border-soft/40" />

      {onMapWritingContent && (
        <>
          <button
            onClick={onMapWritingContent}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary"
            title="映射剧本场次"
            aria-label="映射剧本场次"
          >
            <Link2 className="h-4.5 w-4.5 text-emerald-500" />
          </button>
          <div className="h-4 w-px bg-border-soft/40" />
        </>
      )}

      <button
        onClick={onAutoLayout}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary"
        title="自动整理布局"
        aria-label="自动整理布局"
      >
        <LayoutGrid className="h-4.5 w-4.5 text-purple-500" />
      </button>

      {onToggleFullscreen && (
        <>
          <div className="h-4 w-px bg-border-soft/40" />
          <button
            onClick={onToggleFullscreen}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary"
            title={isFullscreen ? '退出全屏' : '全屏展示'}
            aria-label={isFullscreen ? '退出全屏' : '全屏展示'}
          >
            {isFullscreen ? <Minimize2 className="h-4.5 w-4.5" /> : <Maximize2 className="h-4.5 w-4.5" />}
          </button>
        </>
      )}
    </div>
  );
};
