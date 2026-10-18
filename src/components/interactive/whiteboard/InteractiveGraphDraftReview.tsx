import React, { useState } from 'react';
import { X, Check, Trash2, Clock, Film, AlertTriangle, AlertCircle, ShieldAlert, Sparkles, MessageSquareText } from 'lucide-react';
import { InteractiveGraphDraft } from '../../../domains/interactive/authoring/graphDraft';
import { Button } from '../../ui/Button';

export interface InteractiveGraphDraftReviewProps {
  draft: InteractiveGraphDraft;
  onAdopt: (draftId: string) => void;
  onReject: (draftId: string) => void;
  onRequestRevision: (draft: InteractiveGraphDraft, feedback: string) => void;
  onClose: () => void;
  isAdopting?: boolean;
}

const explainIssue = (message: string) => message
  .replaceAll('StateSchema', '故事规则')
  .replaceAll('state schema', '故事规则')
  .replaceAll('schema', '故事规则')
  .replaceAll('variable', '故事进展')
  .replaceAll('fact', '剧情信息')
  .replaceAll('Graph', '故事图')
  .replaceAll('graph', '故事图')
  .replaceAll('P50', '典型体验时长')
  .replaceAll('P90', '完整探索时长');

export const InteractiveGraphDraftReview: React.FC<InteractiveGraphDraftReviewProps> = ({
  draft,
  onAdopt,
  onReject,
  onRequestRevision,
  onClose,
  isAdopting = false,
}) => {
  const isStale = draft.status === 'stale';
  const hasBlockingQA = (draft.qa?.blocking?.length ?? 0) > 0;
  const [feedback, setFeedback] = useState('');
  const proposedNodes = draft.operations
    .filter((operation) => operation.type === 'add_node')
    .map((operation) => operation.node);
  const choiceCountByNode = new Map<string, number>();
  draft.operations
    .filter((operation) => operation.type === 'add_transition')
    .forEach((operation) => choiceCountByNode.set(
      operation.transition.sourceNodeId,
      (choiceCountByNode.get(operation.transition.sourceNodeId) || 0) + 1,
    ));

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl sm:w-[420px] transition-colors">
      {/* Header */}
      <div className="h-14 px-4 border-b border-border-soft/30 flex items-center justify-between shrink-0 bg-bg-surface dark:bg-neutral-900">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-xl bg-gold/15 text-gold">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-bold text-sm text-text-primary">看看 AI 的新方案</h2>
            <div className="text-[11px] text-text-muted">不满意就直接告诉 AI 怎么改</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭故事方案"
          title="关闭"
          className="p-1.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status Alert if Stale or Has Blocking QA */}
        {isStale && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">白板内容已经变化</div>
              <div className="text-text-muted mt-0.5">这份方案基于较早的内容，请让 AI 重新生成。</div>
            </div>
          </div>
        )}

        {hasBlockingQA && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs space-y-1">
            <div className="flex items-center font-bold">
              <ShieldAlert className="w-4 h-4 mr-1.5 shrink-0" />
              AI 检查出 {draft.qa.blocking.length} 个必须先修正的问题
            </div>
            <ul className="list-disc list-inside text-text-secondary space-y-0.5 pl-1">
              {draft.qa.blocking.map((msg, i) => (
                <li key={i}>{explainIssue(msg)}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Intent & Summary */}
        <div className="p-4 rounded-xl bg-bg-surface-soft/60 dark:bg-neutral-950/60 border border-border-soft/30 space-y-1">
          <div className="text-xs font-bold text-text-muted">你的要求</div>
          <div className="text-sm font-bold text-text-primary">{draft.authorIntent || '常规改写'}</div>
          <div className="text-xs text-text-muted pt-1 border-t border-border-soft/30 mt-1">
            {draft.summary}
          </div>
        </div>

        {draft.proposedStoryArchitecture?.premise && (
          <div className="border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 p-4 text-xs rounded-xl">
            <div className="font-bold text-text-primary">这一版的故事方向</div>
            <p className="mt-1.5 leading-5 text-text-muted">{draft.proposedStoryArchitecture.premise}</p>
            <div className="mt-2 text-[11px] text-text-muted">{draft.proposedStoryArchitecture.endingContracts?.length || 0} 个结局方向 · {draft.proposedStoryArchitecture.storyBeats?.length || 0} 个关键段落</div>
          </div>
        )}

        {proposedNodes.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-primary">故事会这样展开</div>
            <div className="divide-y divide-border-soft/20 border border-border-soft/30 bg-bg-surface-soft/40 dark:bg-neutral-950/40 rounded-xl overflow-hidden">
              {proposedNodes.map((node, index) => (
                <div key={node.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg bg-bg-surface-soft text-[10px] font-bold text-gold border border-border-soft/30">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-text-primary">{node.brief.title}</div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{node.brief.narrativeSummary}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-text-muted font-medium">
                    {node.brief.dramaticFunction === 'ending' ? '结局' : `${choiceCountByNode.get(node.id) || 0} 个选择`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Impact / Deltas */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-3.5 rounded-xl bg-bg-surface-soft/60 dark:bg-neutral-950/60 border border-border-soft/30 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-gold shrink-0" />
            <div>
              <div className="text-[10px] text-text-muted font-medium">预计时长变化</div>
              <div className="text-xs font-bold text-gold">
                {draft.impact.p50DurationDeltaSec >= 0 ? `+${draft.impact.p50DurationDeltaSec}s` : `${draft.impact.p50DurationDeltaSec}s`}
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-bg-surface-soft/60 dark:bg-neutral-950/60 border border-border-soft/30 flex items-center space-x-2">
            <Film className="w-4 h-4 text-emerald-500 shrink-0" />
            <div>
              <div className="text-[10px] text-text-muted font-medium">预计新增画面</div>
              <div className="text-xs font-bold text-emerald-500">
                {draft.impact.uniqueMediaDeltaSec >= 0 ? `+${draft.impact.uniqueMediaDeltaSec}s` : `${draft.impact.uniqueMediaDeltaSec}s`}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted">这次会怎么改</div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-text-muted font-medium">新增故事节点</span>
              <span className="font-bold text-emerald-500">{draft.impact.addedNodeIds.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted font-medium">调整故事节点</span>
              <span className="font-bold text-gold">{draft.impact.updatedNodeIds.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted font-medium">移除故事节点</span>
              <span className="font-bold text-rose-500">{draft.impact.removedNodeIds.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-muted font-medium">新增玩家选择</span>
              <span className="font-bold text-emerald-500">{draft.impact.addedChoiceIds.length}</span>
            </div>
          </div>
        </div>

        {/* Warnings list */}
        {draft.qa?.warnings && draft.qa.warnings.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-bold text-amber-500 flex items-center">
              <AlertCircle className="w-3.5 h-3.5 mr-1" />
              AI 建议留意 ({draft.qa.warnings.length})
            </div>
            <ul className="list-disc list-inside text-xs text-text-muted space-y-0.5 pl-1">
              {draft.qa.warnings.map((w, i) => (
                <li key={i}>{explainIssue(w)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2.5 border-t border-border-soft/30 pt-4">
          <label className="flex items-center text-xs font-bold text-text-primary"><MessageSquareText className="mr-1.5 h-4 w-4 text-gold" />告诉 AI 哪里需要调整</label>
          <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3} placeholder="例如：第二个选择太保守，增加更冒险但代价更大的方案；结局不要这么早收束。" className="w-full resize-none border border-border-soft/40 bg-bg-surface-soft dark:bg-neutral-950 p-3.5 text-xs leading-5 text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors" />
          <button type="button" disabled={!feedback.trim() || isAdopting} onClick={() => onRequestRevision(draft, feedback.trim())} className="w-full flex items-center justify-center border border-gold/40 bg-gold/10 py-2.5 text-xs font-bold text-gold hover:bg-gold/20 rounded-xl transition-colors disabled:opacity-50"><Sparkles className="mr-1.5 h-4 w-4" />按这条意见重新生成方案</button>
        </div>
      </div>

      {/* Footer Actions */}
      <footer className="flex shrink-0 gap-2 border-t border-border-soft/30 p-4 bg-bg-surface dark:bg-neutral-900">
        <button
          type="button"
          onClick={() => onReject(draft.id)}
          className="flex-1 rounded-xl border border-border-soft/40 bg-bg-surface-soft py-2.5 text-xs font-bold text-text-muted hover:text-rose-500 hover:border-rose-500/40 transition-colors flex items-center justify-center gap-1.5"
        >
          <Trash2 className="w-4 h-4 text-text-muted" />
          放弃这版
        </button>

        <button
          type="button"
          disabled={isStale || hasBlockingQA || isAdopting}
          onClick={() => onAdopt(draft.id)}
          className="flex-1 rounded-xl bg-gold hover:bg-gold-light text-bg-primary text-xs font-bold py-2.5 shadow-md shadow-gold/20 flex items-center justify-center gap-1.5 disabled:opacity-50 transition-all"
        >
          <Check className="w-4 h-4" />
          采用这版
        </button>
      </footer>
    </div>
  );
};
