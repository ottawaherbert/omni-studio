import React, { createContext, useContext, useLayoutEffect, useRef } from 'react';
import { X, Sparkles } from 'lucide-react';
import type { StructureAnalysis } from '../../../../../../packages/script/src/structureAnalysis';
import type { PlanningRepairTarget } from '../../../../../../packages/script/src/planningRepair';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import type { OutlineOwner } from '../../../../../../packages/script/src/outlineGuides';
import type { AssistantRequest } from '../scriptAssistantShortcuts';
import { StructureAnalysisCard, type AnalysisEvidenceLocation } from './StructureAnalysisCard';

export type AnalysisSceneSource = { kind: 'SCENE_PLAN' | 'BODY_BLOCK'; field?: string; blockId?: string; quote?: string };
export type ScriptAnalysisEntry = {
  analysis: StructureAnalysis;
  onRequest: (request: AssistantRequest, source?: AnalysisEvidenceLocation) => void;
  onRepair?: (target: PlanningRepairTarget, instruction: string, source?: AnalysisEvidenceLocation) => void;
};
type ViewProps = ScriptAnalysisEntry & {
  project: ScriptProject;
  onClose: () => void;
  onOpenScene: (unitId: string, sceneId: string, source?: AnalysisSceneSource) => void;
  onOpenOutline: (unitId: string, source?: { owner: OutlineOwner; start: number; end: number; nodeId?: string }) => void;
};
export const ScriptAnalysisContext = createContext<ViewProps | null>(null);

/** The full report and its existing actions have one rendering surface. */
export function ScriptAnalysisView({ onClose, ...props }: ViewProps) {
  return (
    <section
      className="script-analysis-view bg-bg-surface/95 backdrop-blur-md rounded-2xl shadow-xl p-4 sm:p-6 overflow-hidden flex flex-col h-full max-h-full max-w-3xl mx-auto w-full"
      role="region"
      aria-label="中央结构与节奏分析"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="script-analysis-header shrink-0 flex items-center justify-between pb-3 sm:pb-4 border-b border-border-primary/10">
        <div>
          <h2 className="text-base font-semibold text-text-primary tracking-tight">结构与节奏分析</h2>
          <p className="text-xs text-text-muted mt-0.5">
            分析依据版本 {props.analysis.revision} · {props.analysis.findings.length} 条意见
          </p>
        </div>
        <button
          type="button"
          data-analysis-close
          onClick={onClose}
          aria-label="关闭分析，返回原内容"
          title="关闭分析，返回原内容"
          className="p-2 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-colors cursor-pointer"
        >
          <X size={18} />
        </button>
      </header>
      <div className="script-analysis-content flex-1 min-h-0 overflow-y-auto pt-4 pb-8 pr-1">
        <StructureAnalysisCard {...props} />
      </div>
    </section>
  );
}

/** Suspend input only under this central layer. The underlying components,
 * text selections, scroll containers and uncontrolled editor state stay mounted. */
export function suspendAnalysisUnderlay(layer: HTMLElement) {
  const siblings = Array.from(layer.parentElement?.children ?? []).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node !== layer,
  );
  const before = siblings.map((node) => ({ node, inert: node.inert, hidden: node.getAttribute('aria-hidden') }));
  for (const { node } of before) {
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
  }
  return () => {
    for (const { node, inert, hidden } of before) {
      node.inert = inert;
      if (hidden === null) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', hidden);
    }
  };
}

export function ScriptAnalysisOutlet() {
  const view = useContext(ScriptAnalysisContext),
    layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!view || !layer.current) return;
    return suspendAnalysisUnderlay(layer.current);
  });
  useLayoutEffect(() => {
    if (!view || !layer.current) return;
    layer.current.querySelector<HTMLButtonElement>('[data-analysis-close]')?.focus({ preventScroll: true });
  }, [view?.analysis]);
  return view ? (
    <div ref={layer} className="script-analysis-layer absolute inset-0 z-50 bg-black/40 backdrop-blur-xs flex flex-col items-center justify-center p-2 sm:p-4 overflow-hidden">
      <ScriptAnalysisView {...view} />
    </div>
  ) : null;
}

export function ScriptAnalysisSummary({ analysis, onOpen }: { analysis: StructureAnalysis; onOpen?: () => void }) {
  return (
    <section aria-label="结构与节奏分析摘要" className="rounded-2xl bg-bg-surface p-4 shadow-xs space-y-2.5">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-primary" />
        <strong className="text-sm font-semibold text-text-primary">
          结构与节奏分析 · {analysis.findings.length} 条意见
        </strong>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-xs text-text-secondary leading-relaxed bg-bg-surface-soft/60 p-2.5 rounded-xl">
        {analysis.summary}
      </p>
      <div>
        <button
          type="button"
          disabled={!onOpen}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors cursor-pointer"
          onClick={onOpen}
        >
          在中央查看分析
        </button>
      </div>
    </section>
  );
}
