import type { ReactNode } from 'react';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, type ReactFlowProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSettingsStore } from '../../clients/stateClient';

/** Shared visual/interaction shell. Domain nodes and commands stay with their owners. */
export function InfiniteCanvas<N extends Node = Node, E extends Edge = Edge>({ children, compact = false, ...props }: ReactFlowProps<N, E> & { children?: ReactNode; compact?: boolean }) {
  const theme = useSettingsStore(state => state.theme);
  const dark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return <ReactFlow<N, E> minZoom={.15} maxZoom={2} fitView fitViewOptions={{ padding: .3 }} proOptions={{ hideAttribution: true }} colorMode={dark ? 'dark' : 'light'} deleteKeyCode={null} {...props}>
    <Background gap={24} size={1.5} color={dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'} />
    <Controls className="!bottom-12 !border-border-soft/40 !bg-bg-surface/90 dark:!bg-neutral-900/90 !text-text-primary !rounded-2xl !shadow-xl overflow-hidden" showInteractive={false} />
    <MiniMap zoomable pannable style={compact ? { width: 120, height: 72 } : undefined} className="!bottom-12 !hidden !border !border-border-soft/40 !bg-bg-surface/90 dark:!bg-neutral-900/90 !rounded-2xl overflow-hidden !shadow-2xl sm:!block" nodeColor={() => '#00cae0'} maskColor={dark ? 'rgba(15,15,18,0.75)' : 'rgba(245,247,251,0.75)'} />
    {children}
  </ReactFlow>;
}
