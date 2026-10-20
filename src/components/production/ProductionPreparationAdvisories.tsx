import type { ProductionPreparationGate } from '../../clients/productionPreparationWorkflowClient';

/** Advisory-only: action-specific execution guards remain with their owning actions. */
export function ProductionPreparationAdvisories({ gate, sceneTitle }: { gate?: ProductionPreparationGate | null; sceneTitle?: string }) {
  if (!gate?.advisories.length) return null;
  return <details className="shrink-0 border-b border-border-soft/30 bg-bg-surface px-4 py-2 text-xs text-text-secondary">
    <summary className="cursor-pointer">{sceneTitle || '当前场次'} · {gate.advisories.length} 项来源与材料提醒，可继续编辑</summary>
    <ul className="mt-2 list-disc space-y-1 pl-4">{gate.advisories.map(message => <li key={message}>{message}</li>)}</ul>
  </details>;
}
