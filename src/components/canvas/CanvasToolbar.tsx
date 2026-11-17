import type { ReactNode } from 'react';
import { Check, CornerDownRight, Focus, LayoutGrid, Maximize2, Minimize2, Minus, Plus, Spline } from 'lucide-react';
import { useSettingsStore, type EdgeLineMode } from '../../clients/stateClient';

const tool = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary';
export function CanvasToolbar({ onAdd, addLabel = '添加节点', onAutoLayout, onFitView, fullscreen, onToggleFullscreen, children, inline = false }: {
  onAdd?: () => void; addLabel?: string; onAutoLayout: () => void; onFitView?: () => void;
  fullscreen?: boolean; onToggleFullscreen?: () => void; children?: ReactNode; inline?: boolean;
}) {
  const { edgeLineMode, setEdgeLineMode } = useSettingsStore();
  const modes: Array<{ id: EdgeLineMode; label: string; Icon: typeof Spline }> = [
    { id: 'bezier', label: '曲线连线', Icon: Spline }, { id: 'orthogonal', label: '折线连线', Icon: CornerDownRight }, { id: 'straight', label: '直线连线', Icon: Minus },
  ];
  const active = modes.find(m => m.id === edgeLineMode) || modes[0];
  return <div className={`${inline ? 'relative z-30 w-fit' : 'absolute left-2 top-3 z-30 shadow-2xl sm:left-4 sm:top-4'} flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-2xl border border-border-soft/40 bg-bg-surface/90 p-1.5 backdrop-blur-xl dark:bg-neutral-900/90`}>
    {onAdd && <button type="button" className={tool} aria-label={addLabel} title={addLabel} onClick={onAdd}><Plus className="h-4 w-4 text-gold" /></button>}
    {children}
    {onFitView && <button type="button" className={tool} aria-label="回到主视角" title="回到主视角" onClick={onFitView}><Focus className="h-4 w-4 text-sky-500" /></button>}
    <details className="relative"><summary role="button" aria-label={`连线样式：${active.label}`} className={`${tool} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}><active.Icon className="h-4 w-4 text-cyan-500" /></summary>
      <div role="menu" className="absolute left-0 top-full mt-2 w-36 rounded-lg border border-border-soft/50 bg-bg-surface p-1 shadow-xl">{modes.map(({ id, label, Icon }) => <button key={id} type="button" role="menuitemradio" aria-checked={id === edgeLineMode} onClick={e => { setEdgeLineMode(id); e.currentTarget.closest('details')?.removeAttribute('open'); }} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-xs text-text-secondary hover:bg-bg-surface-soft"><Icon className="h-4 w-4" /><span className="flex-1 text-left">{label}</span>{id === edgeLineMode && <Check className="h-3 w-3 text-gold" />}</button>)}</div>
    </details>
    <button type="button" className={tool} aria-label="自动整理布局" title="自动整理布局" onClick={onAutoLayout}><LayoutGrid className="h-4 w-4 text-purple-500" /></button>
    {onToggleFullscreen && <button type="button" className={tool} aria-label={fullscreen ? '退出全屏' : '全屏展示'} title={fullscreen ? '退出全屏' : '全屏展示'} onClick={onToggleFullscreen}>{fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>}
  </div>;
}
