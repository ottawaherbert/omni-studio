import React from 'react';
import { Check, Clapperboard, Clock3, ExternalLink, Loader2, Recycle, X } from 'lucide-react';

import type { InteractiveProductionPlanDraft } from '../../../clients/domainTypes';

interface InteractiveProductionPlanReviewProps {
  plan: InteractiveProductionPlanDraft;
  isWorking: boolean;
  onClose: () => void;
  onAdopt: () => void;
  onReject: () => void;
  onOpenProduction: () => void;
}

export function InteractiveProductionPlanReview({
  plan,
  isWorking,
  onClose,
  onAdopt,
  onReject,
  onOpenProduction,
}: InteractiveProductionPlanReviewProps) {
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl transition-colors">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4 bg-bg-surface dark:bg-neutral-900">
        <div>
          <p className="text-[11px] text-text-muted">AI 制片方案</p>
          <h2 className="text-sm font-bold text-text-primary">场次复用与制作范围</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭" title="关闭" className="p-2 rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="grid grid-cols-3 border-b border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60">
        <div className="px-3 py-4 text-center"><Clapperboard className="mx-auto h-4 w-4 text-gold" /><strong className="mt-1 block text-base font-bold text-text-primary">{plan.impact.productionSceneCount}</strong><span className="text-[11px] font-medium text-text-muted">制片场次</span></div>
        <div className="border-x border-border-soft/30 px-3 py-4 text-center"><Recycle className="mx-auto h-4 w-4 text-emerald-500" /><strong className="mt-1 block text-base font-bold text-text-primary">{plan.impact.reusedSceneCount}</strong><span className="text-[11px] font-medium text-text-muted">复用场次</span></div>
        <div className="px-3 py-4 text-center"><Clock3 className="mx-auto h-4 w-4 text-amber-500" /><strong className="mt-1 block text-base font-bold text-text-primary">{Math.ceil(plan.impact.estimatedUniqueDurationSeconds / 60)}</strong><span className="text-[11px] font-medium text-text-muted">需制作分钟</span></div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {plan.units.flatMap((unit) => unit.scenes).map((scene) => (
          <div key={scene.id} className="border-b border-border-soft/30 px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-text-primary">{scene.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">{scene.description}</p>
              </div>
              {(scene.interactiveNodeIds?.length || 0) > 1 && (
                <span className="shrink-0 rounded-lg bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold text-emerald-500 border border-emerald-500/30">
                  {scene.interactiveNodeIds!.length} 个节点复用
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <footer className="shrink-0 border-t border-border-soft/30 bg-bg-surface dark:bg-neutral-900 p-4">
        <button type="button" disabled={isWorking} onClick={onAdopt} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gold hover:bg-gold-light text-xs font-bold text-bg-primary shadow-md shadow-gold/20 disabled:opacity-60 transition-all">
          {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          采用制片方案
        </button>
        <div className="mt-2.5 flex items-center justify-between px-1">
          <button type="button" onClick={onReject} className="text-xs font-medium text-text-muted hover:text-rose-500 transition-colors">放弃这版</button>
          <button type="button" onClick={onOpenProduction} className="flex items-center gap-1 text-xs font-bold text-gold hover:text-gold-light transition-colors">
            深入制片 <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </div>
      </footer>
    </aside>
  );
}
