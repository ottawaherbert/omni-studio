import { useMemo, useState } from 'react';
import {
  Check,
  FilePenLine,
  Film,
  Loader2,
  MessageSquareText,
  Recycle,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

import type { InteractiveWritingSceneOption } from '../../../domains/interactive/ports/writingPort';
import type { NarrativeNode } from '../../../clients/interactiveProductionClient';
import {
  contentPlanAdoptable,
  type InteractiveContentPlanDraft,
} from '../../../domains/interactive/contentPlanning/contentPlan';
import { artifactRefIdentity } from '../../../domains/interactive/binding/nodeContentBinding';
import { Button } from '../../ui/Button';

export interface InteractiveContentPlanReviewProps {
  draft: InteractiveContentPlanDraft;
  nodes: NarrativeNode[];
  scenes: InteractiveWritingSceneOption[];
  isWorking?: boolean;
  onClose: () => void;
  onAdopt: (draftId: string) => void;
  onReject: (draftId: string) => void;
  onRequestRevision: (draftId: string, feedback: string) => void;
  onDiscussStory: () => void;
  onOpenWriting: () => void;
}

export const InteractiveContentPlanReview = ({
  draft,
  nodes,
  scenes,
  isWorking = false,
  onClose,
  onAdopt,
  onReject,
  onRequestRevision,
  onDiscussStory,
  onOpenWriting,
}: InteractiveContentPlanReviewProps) => {
  const [feedback, setFeedback] = useState('');
  const sceneByRef = useMemo(
    () => new Map(scenes.map((scene) => [artifactRefIdentity(scene.ref), scene])),
    [scenes],
  );
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const needsWriting = draft.items.some((item) => (
    item.mode === 'create_or_revise'
    && item.slots.some((slot) => slot.orderedSceneRefs.length === 0)
  ));
  const canAdopt = contentPlanAdoptable(draft);

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl sm:w-[440px] transition-colors">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4 bg-bg-surface dark:bg-neutral-900">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-5 w-5 shrink-0 text-gold" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-text-primary">AI 安排的节点内容</h2>
            <p className="truncate text-[11px] text-text-muted">先看整体播放方案，再决定是否采用</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭内容方案" className="p-1.5 rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section className="grid grid-cols-3 border-b border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 text-center">
          <div className="px-2 py-3">
            <div className="text-base font-bold text-text-primary">{draft.impact.affectedNodeCount}</div>
            <div className="text-[10px] text-text-muted font-medium">节点会变化</div>
          </div>
          <div className="border-x border-border-soft/30 px-2 py-3">
            <div className="text-base font-bold text-text-primary">{draft.impact.reusedWritingSceneCount}</div>
            <div className="text-[10px] text-text-muted font-medium">场现有内容</div>
          </div>
          <div className="px-2 py-3">
            <div className="text-base font-bold text-text-primary">{draft.impact.newWritingSceneCount}</div>
            <div className="text-[10px] text-text-muted font-medium">处需要补写</div>
          </div>
        </section>

        {(draft.status === 'stale' || draft.qa.blocking.length > 0) && (
          <section className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-500 font-medium">
            {draft.status === 'stale'
              ? '白板或剧本已经变化，这份方案需要重新生成。'
              : needsWriting
                ? 'AI 已找出需要补写的部分。补写完成后会重新检查整张白板。'
                : draft.qa.blocking[0]}
          </section>
        )}

        <section className="divide-y divide-border-soft/20">
          {draft.items.map((item) => {
            const node = nodeById.get(item.nodeId);
            const refs = item.slots.flatMap((slot) => slot.orderedSceneRefs);
            const selectedScenes = refs.flatMap((ref) => {
              const scene = sceneByRef.get(artifactRefIdentity(ref));
              return scene ? [scene] : [];
            });
            const noContent = item.mode === 'no_content';
            const pendingWriting = item.mode === 'create_or_revise' && refs.length === 0;
            return (
              <div key={item.nodeId} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-text-primary">{node?.brief.title || '故事节点'}</div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">
                      {node?.brief.narrativeSummary || node?.brief.intent}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold ${pendingWriting ? 'text-amber-500' : noContent ? 'text-text-muted' : 'text-emerald-500'}`}>
                    {pendingWriting ? '需要补写' : noContent ? '无需画面' : `${selectedScenes.length} 场内容`}
                  </span>
                </div>

                {selectedScenes.length > 0 && (
                  <ol className="mt-2 border-l border-border-soft/40 pl-3">
                    {selectedScenes.map((scene, index) => (
                      <li key={scene.ref.checksum} className="py-1 text-[11px] font-medium text-text-secondary">
                        {index + 1}. {scene.sceneTitle}
                      </li>
                    ))}
                  </ol>
                )}

                {item.reuseGroupId && (
                  <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-sky-400 font-medium">
                    <Recycle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{item.compatibilityRationale || 'AI 建议在兼容的故事路径中复用这段内容。'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {(draft.impact.staleProductionSceneIds.length > 0 || draft.impact.staleMediaTakeCount > 0) && (
          <section className="flex items-start gap-2 border-t border-border-soft/30 px-4 py-3 text-xs text-text-muted">
            <Film className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              采用后将影响 {draft.impact.staleProductionSceneIds.length} 个制片场次
              {draft.impact.staleMediaTakeCount > 0
                ? `，并有 ${draft.impact.staleMediaTakeCount} 段已有画面需要重新确认。`
                : '。'}
            </span>
          </section>
        )}

        <section className="space-y-2.5 border-t border-border-soft/30 p-4">
          <label className="flex items-center text-xs font-bold text-text-primary">
            <MessageSquareText className="mr-1.5 h-4 w-4 text-gold" />
            告诉 AI 哪里要调整
          </label>
          <textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={3}
            placeholder="例如：入口需要连续播放两场；两个结局不要复用同一段内容。"
            className="w-full resize-none border border-border-soft/40 bg-bg-surface-soft dark:bg-neutral-950 p-3 text-xs leading-5 text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors"
          />
          <button
            type="button"
            disabled={!feedback.trim() || isWorking}
            onClick={() => onRequestRevision(draft.id, feedback.trim())}
            className="w-full flex items-center justify-center border border-gold/40 bg-gold/10 py-2.5 text-xs font-bold text-gold hover:bg-gold/20 rounded-xl transition-colors disabled:opacity-50"
          >
            {isWorking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
            按意见重新安排
          </button>
          <button
            type="button"
            onClick={onDiscussStory}
            disabled={isWorking}
            className="w-full py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
          >
            想改节点或选择？和 AI 讨论故事
          </button>
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border-soft/30 bg-bg-surface dark:bg-neutral-900 p-4">
        <button type="button" onClick={() => onReject(draft.id)} disabled={isWorking} aria-label="放弃内容方案" title="放弃这版" className="flex h-10 w-10 shrink-0 items-center justify-center border border-border-soft/40 text-text-muted hover:bg-bg-surface-soft hover:text-text-primary rounded-xl transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
        {needsWriting ? (
          <button type="button" onClick={onOpenWriting} disabled={isWorking} className="flex-1 flex items-center justify-center bg-amber-500 hover:bg-amber-600 py-2.5 text-xs font-bold text-white rounded-xl transition-all shadow-md">
            <FilePenLine className="mr-1.5 h-4 w-4" />
            让 AI 继续补写剧本
          </button>
        ) : (
          <button type="button" onClick={() => onAdopt(draft.id)} disabled={!canAdopt || isWorking} className="flex-1 flex items-center justify-center bg-gold hover:bg-gold-light py-2.5 text-xs font-bold text-bg-primary rounded-xl transition-all shadow-md shadow-gold/20 disabled:opacity-50">
            {isWorking ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
            采用整套内容方案
          </button>
        )}
      </footer>
    </aside>
  );
};
