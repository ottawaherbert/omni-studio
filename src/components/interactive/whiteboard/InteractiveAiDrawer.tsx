import React, { useEffect, useState } from 'react';
import { X, Sparkles, GitBranch, Wrench, Loader2, Route } from 'lucide-react';
import { Button } from '../../ui/Button';

export type AiActionType = 'initial' | 'blueprint' | 'golden_path' | 'extend' | 'strategy' | 'repair' | 'revise';

export interface InteractiveAiDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNodeTitle?: string;
  selectedNodeId?: string;
  qaIssueCount?: number;
  qaIssueIds?: string[];
  isEmptyGraph?: boolean;
  isGenerating?: boolean;
  isFullscreen?: boolean;
  onGenerate: (params: { action: AiActionType; authorIntent: string; scopeNodeId?: string; issueIds?: string[] }) => void;
}

type AuthoringScope = 'whole' | 'node' | 'repair';

export const InteractiveAiDrawer: React.FC<InteractiveAiDrawerProps> = ({
  isOpen,
  onClose,
  selectedNodeTitle,
  selectedNodeId,
  qaIssueCount = 0,
  qaIssueIds = [],
  isEmptyGraph = false,
  isGenerating = false,
  isFullscreen = false,
  onGenerate,
}) => {
  const [scope, setScope] = useState<AuthoringScope>('whole');
  const [intent, setIntent] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setScope(isEmptyGraph ? 'whole' : selectedNodeId ? 'node' : qaIssueCount > 0 ? 'repair' : 'whole');
  }, [isOpen, isEmptyGraph, selectedNodeId, qaIssueCount]);

  if (!isOpen) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const action: AiActionType = isEmptyGraph ? 'initial' : scope === 'node' ? 'extend' : scope === 'repair' ? 'repair' : 'revise';
    onGenerate({
      action,
      authorIntent: intent.trim() || (isEmptyGraph ? '请为这个项目搭建完整、可审阅的第一版互动方案。' : '请检查当前方案并给出更好的下一版。'),
      scopeNodeId: scope === 'node' ? selectedNodeId : undefined,
      issueIds: scope === 'repair' ? qaIssueIds : undefined,
    });
  };

  return (
    <aside className={`fixed top-14 bottom-0 ${isFullscreen ? 'left-0' : 'left-14 md:left-20'} z-40 flex w-[380px] max-w-[calc(100vw-3.5rem)] md:max-w-[calc(100vw-5rem)] flex-col border-r border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl transition-all duration-200`}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4 bg-bg-surface dark:bg-neutral-900">
        <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-gold" /><h2 className="text-sm font-bold text-text-primary">和 AI 讨论这个故事</h2></div>
        <button type="button" onClick={onClose} aria-label="关闭 AI 助手" title="关闭" className="p-1.5 rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors"><X className="h-5 w-5" /></button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!isEmptyGraph && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted">这次想让 AI 看哪里</div>
            <button type="button" onClick={() => setScope('whole')} className={`flex w-full items-start gap-3 border p-3.5 text-left rounded-xl transition-all ${scope === 'whole' ? 'border-gold bg-gold/10' : 'border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 hover:border-border-soft/60'}`}><Route className="mt-0.5 h-4 w-4 shrink-0 text-gold" /><div><div className="text-sm font-bold text-text-primary">整体方案</div><div className="mt-0.5 text-xs text-text-muted">调整主线、节奏、分支和结局</div></div></button>
            {selectedNodeId && <button type="button" onClick={() => setScope('node')} className={`flex w-full items-start gap-3 border p-3.5 text-left rounded-xl transition-all ${scope === 'node' ? 'border-emerald-500 bg-emerald-500/10' : 'border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 hover:border-border-soft/60'}`}><GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><div className="min-w-0"><div className="text-sm font-bold text-text-primary">当前节点</div><div className="mt-0.5 truncate text-xs text-text-muted">{selectedNodeTitle || '扩展选中的故事节点'}</div></div></button>}
            {qaIssueCount > 0 && <button type="button" onClick={() => setScope('repair')} className={`flex w-full items-start gap-3 border p-3.5 text-left rounded-xl transition-all ${scope === 'repair' ? 'border-amber-500 bg-amber-500/10' : 'border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 hover:border-border-soft/60'}`}><Wrench className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /><div><div className="text-sm font-bold text-text-primary">检查发现的问题</div><div className="mt-0.5 text-xs text-text-muted">让 AI 修复 {qaIssueCount} 个结构问题</div></div></button>}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs font-bold text-text-muted">告诉 AI 你的想法</label>
          <textarea autoFocus value={intent} onChange={(event) => setIntent(event.target.value)} rows={6} placeholder={isEmptyGraph ? '例如：主角更主动一些，第一幕尽快出现一个真正困难的选择，结局至少有一次情感反转。' : '例如：这里缺少危险感；让两个选择都更难取舍；不要这么快回到主线。'} className="w-full resize-none border border-border-soft/40 bg-bg-surface dark:bg-neutral-950 p-3.5 text-sm leading-6 text-text-primary outline-none focus:border-gold/60 rounded-xl transition-colors" />
          <button type="submit" disabled={isGenerating} className="flex w-full items-center justify-center bg-gold hover:bg-gold-light py-3.5 text-sm font-bold text-bg-primary rounded-xl transition-all shadow-md shadow-gold/20 disabled:opacity-60">{isGenerating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />AI 正在准备新方案...</> : <><Sparkles className="mr-2 h-4 w-4" />生成一个可审阅的新方案</>}</button>
        </form>
      </div>
    </aside>
  );
};
