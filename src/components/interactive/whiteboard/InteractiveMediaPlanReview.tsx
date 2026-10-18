import React, { useState } from 'react';
import { Check, ExternalLink, Film, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react';

import type { InteractiveMediaPlanDraft } from '../../../clients/domainTypes';

interface InteractiveMediaPlanReviewProps {
  plan: InteractiveMediaPlanDraft;
  isWorking: boolean;
  nodeTitles: Record<string, string>;
  onClose: () => void;
  onAdopt: () => void;
  onRequestRevision: (nodeId: string, feedback: string, scenarioId?: string) => void;
  onOpenProduction: (nodeId?: string) => void;
}

export function InteractiveMediaPlanReview({
  plan,
  isWorking,
  nodeTitles,
  onClose,
  onAdopt,
  onRequestRevision,
  onOpenProduction,
}: InteractiveMediaPlanReviewProps) {
  const [editingSelectionId, setEditingSelectionId] = useState('');
  const [feedback, setFeedback] = useState('');
  const missingScenarioCount = plan.missingScenarios?.length || plan.missingScenarioIds?.length || 0;
  const missingSlotCount = plan.missingContentSlots?.length || 0;
  const ready = plan.missingNodeIds.length === 0
    && missingScenarioCount === 0
    && missingSlotCount === 0;
  const submitFeedback = (nodeId: string, scenarioId?: string) => {
    const value = feedback.trim();
    if (!value) return;
    onRequestRevision(nodeId, value, scenarioId);
    setEditingSelectionId('');
    setFeedback('');
  };
  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl transition-colors">
      <header className="flex h-14 items-center justify-between border-b border-border-soft/30 px-4 bg-bg-surface dark:bg-neutral-900">
        <div><p className="text-[11px] text-text-muted">画面采用方案</p><h2 className="text-sm font-bold text-text-primary">{ready ? '可一次采用全部画面' : '还有画面需要制作'}</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭" title="关闭" className="p-2 rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors"><X className="h-4 w-4" /></button>
      </header>
      <div className="flex-1 overflow-y-auto">
        {plan.selections.map((selection) => {
          const selectionId = `${selection.nodeId}:${selection.scenarioId || 'default'}`;
          return (
          <div key={selectionId} className="border-b border-border-soft/30 px-4 py-4">
            <div className="flex items-start gap-3">
              <Film className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-text-primary">{nodeTitles[selection.nodeId] || '故事节点'}</p>
                {selection.scenarioLabel && <p className="mt-0.5 text-[11px] font-medium text-gold">{selection.scenarioLabel}</p>}
                <p className="mt-1 text-xs text-text-muted">{selection.labels.length} 段画面 · {selection.labels.join('、')}</p>
              </div>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => {
                  setEditingSelectionId((current) => current === selectionId ? '' : selectionId);
                  setFeedback('');
                }}
                className="shrink-0 p-2 rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors disabled:opacity-50"
                aria-label={`调整${nodeTitles[selection.nodeId] || '这个节点'}的画面`}
                title="告诉 AI 哪里要调整"
              >
                <MessageSquareText className="h-4 w-4" />
              </button>
            </div>
            {editingSelectionId === selectionId && (
              <div className="mt-3 pl-7">
                <textarea
                  autoFocus
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                  rows={3}
                  placeholder="例如：这段太压抑，保留剧情，但让光线和表演更克制。"
                  className="w-full resize-none border border-border-soft/40 bg-bg-surface-soft dark:bg-neutral-950 p-3 text-xs leading-5 text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors"
                />
                <button
                  type="button"
                  disabled={!feedback.trim() || isWorking}
                  onClick={() => submitFeedback(selection.nodeId, selection.scenarioId)}
                  className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-gold hover:bg-gold-light text-xs font-bold text-bg-primary shadow-md shadow-gold/15 transition-all disabled:opacity-50"
                >
                  {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  让 AI 按意见重做这段
                </button>
              </div>
            )}
          </div>
          );
        })}
        {!ready && (
          <div className="px-4 py-5">
            <p className="text-xs leading-6 text-amber-500 font-medium">
              {[
                plan.missingNodeIds.length ? `${plan.missingNodeIds.length} 个节点缺少画面` : '',
                missingScenarioCount ? `${missingScenarioCount} 个状态缺少画面` : '',
                missingSlotCount ? `${missingSlotCount} 个播放位置缺少画面` : '',
              ].filter(Boolean).join('，')}。其他节点的成果不会丢失。
            </p>
            {plan.missingNodeIds.length > 0 && <div className="mt-3 space-y-2">
              {plan.missingNodeIds.map((nodeId) => (
                <button
                  key={nodeId}
                  type="button"
                  onClick={() => onOpenProduction(nodeId)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border-soft/40 bg-bg-surface-soft/60 px-3.5 py-2.5 text-left text-xs font-bold text-text-primary hover:border-gold/40 hover:bg-bg-surface transition-all"
                >
                  <span className="truncate">{nodeTitles[nodeId] || '故事节点'}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                </button>
              ))}
            </div>}
          </div>
        )}
      </div>
      <footer className="border-t border-border-soft/30 bg-bg-surface dark:bg-neutral-900 p-4">
        {ready ? (
          <button type="button" disabled={isWorking} onClick={onAdopt} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gold hover:bg-gold-light text-xs font-bold text-bg-primary shadow-md shadow-gold/20 disabled:opacity-60 transition-all">
            {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}采用全部画面
          </button>
        ) : (
          <button type="button" onClick={() => onOpenProduction()} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-gold hover:bg-gold-light text-xs font-bold text-bg-primary shadow-md shadow-gold/20 transition-all">
            继续制作画面 <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </footer>
    </aside>
  );
}
