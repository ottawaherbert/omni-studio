import React, { useState } from 'react';
import { X, Sparkles, FileText, Video, Plus, Trash2, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import type { NarrativeNode, InteractiveChoice } from '../../../clients/interactiveProductionClient';
import type { NodeCapability, NodeContentPolicy, StateSchema } from '../../../domains/interactive/types/schema.ts';
import { getFactDefinitions } from '../../../domains/interactive/types/schema.ts';

export interface InteractiveNodeInspectorProps {
  node: NarrativeNode;
  isEntry?: boolean;
  hasScriptBinding?: boolean;
  hasWritingProject?: boolean;
  isPreparingContent?: boolean;
  hasMediaTake?: boolean;
  stateSchema?: StateSchema;
  chapters?: Array<{ id: string; title: string }>;
  currentChapterId?: string;
  onMoveToChapter?: (nodeId: string, chapterId: string) => void;
  onClose: () => void;
  onUpdateBrief: (nodeId: string, patch: Partial<NarrativeNode['brief']>) => void;
  onUpdateNode?: (nodeId: string, patch: Partial<Pick<NarrativeNode, 'brief' | 'interaction' | 'contract' | 'storyBeatIds'>>) => void;
  onAddChoice: (sourceNodeId: string) => void;
  onSelectChoice: (choiceId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onSetAsEntry: (nodeId: string) => void;
  onAiExtendFromNode: (nodeId: string) => void;
  onOpenWritingHandoff: (nodeId: string) => void;
  onPrepareContent?: (nodeId: string) => void;
  onOpenProductionHandoff: (nodeId: string) => void;
}

export const InteractiveNodeInspector: React.FC<InteractiveNodeInspectorProps> = ({
  node,
  isEntry = false,
  hasScriptBinding = false,
  hasWritingProject = false,
  isPreparingContent = false,
  hasMediaTake = false,
  stateSchema,
  chapters,
  currentChapterId = '',
  onMoveToChapter,
  onClose,
  onUpdateBrief,
  onUpdateNode,
  onAddChoice,
  onSelectChoice,
  onDeleteNode,
  onSetAsEntry,
  onAiExtendFromNode,
  onOpenWritingHandoff,
  onPrepareContent,
  onOpenProductionHandoff,
}) => {
  const [title, setTitle] = useState(node?.brief?.title || '');
  const [intent, setIntent] = useState(node?.brief?.intent || '');
  const [summary, setSummary] = useState(node?.brief?.narrativeSummary || '');
  const [dramaticFunction, setDramaticFunction] = useState(node.brief.dramaticFunction);
  const [contentPolicy, setContentPolicy] = useState<NodeContentPolicy>(node.interaction?.contentPolicy || 'create_shared_content');
  const [durationMin, setDurationMin] = useState(node.interaction?.durationRangeSec?.[0] || 45);
  const [durationMax, setDurationMax] = useState(node.interaction?.durationRangeSec?.[1] || 90);
  const [knowledgeIn, setKnowledgeIn] = useState((node.interaction?.playerKnowledgeIn || []).join('\n'));
  const [knowledgeOut, setKnowledgeOut] = useState((node.interaction?.playerKnowledgeOut || []).join('\n'));
  const [capabilities, setCapabilities] = useState<NodeCapability[]>(node.interaction?.capabilities || ['play_content']);
  const [stateContract, setStateContract] = useState(() => structuredClone(node.contract));

  const handleSaveBrief = () => {
    onUpdateBrief(node.id, {
      title: title.trim() || '未命名节点',
      intent: intent.trim(),
      narrativeSummary: summary.trim(),
    });
  };
  const handleSaveNode = () => {
    if (!onUpdateNode) return handleSaveBrief();
    const nextCapabilities = new Set(capabilities);
    if (dramaticFunction === 'ending') nextCapabilities.add('terminal');
    else nextCapabilities.delete('terminal');
    if (node.choices.length > 0) nextCapabilities.add('present_choice');
    if (contentPolicy === 'no_new_content') nextCapabilities.delete('play_content');
    else nextCapabilities.add('play_content');
    if (nextCapabilities.size === 0) nextCapabilities.add('interaction_hold');
    onUpdateNode(node.id, {
      brief: { ...node.brief, title: title.trim() || '未命名节点', intent: intent.trim(), narrativeSummary: summary.trim(), dramaticFunction },
      interaction: {
        ...node.interaction,
        capabilities: [...nextCapabilities],
        contentPolicy,
        durationRangeSec: [Math.max(1, Number(durationMin) || 1), Math.max(Math.max(1, Number(durationMin) || 1), Number(durationMax) || 1)],
        playerKnowledgeIn: knowledgeIn.split('\n').map((item) => item.trim()).filter(Boolean),
        playerKnowledgeOut: knowledgeOut.split('\n').map((item) => item.trim()).filter(Boolean),
      },
      contract: stateContract,
    });
  };

  return (
    <aside className="fixed top-14 bottom-0 right-0 z-40 flex w-full flex-col border-l border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl sm:w-[390px] transition-colors duration-200">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4 bg-bg-surface dark:bg-neutral-900">
        <h2 className="text-base font-extrabold truncate max-w-[280px] text-text-primary">{node.brief.title || '节点详情'}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭节点详情"
          title="关闭"
          className="p-1.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Quick Actions Bar */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => onAiExtendFromNode(node.id)}
            className="flex-1 bg-gold hover:bg-gold-light text-bg-primary text-xs font-bold py-2.5 rounded-xl flex items-center justify-center shadow-md shadow-gold/15 transition-all active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            AI 延展分支
          </button>

          {!isEntry && (
            <button
              type="button"
              onClick={() => onSetAsEntry(node.id)}
              className="px-3.5 py-2.5 rounded-xl bg-bg-surface-soft hover:bg-bg-surface-hover text-text-secondary text-xs font-bold border border-border-soft/40 transition-colors"
            >
              设为入口
            </button>
          )}
        </div>

        {/* Narrative Summary Box */}
        <div className="border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 p-4 rounded-2xl shadow-sm">
          <p className="text-xs leading-6 text-text-secondary">{node.brief.narrativeSummary || node.brief.intent || '暂无详细叙事摘要'}</p>
        </div>

        {/* Manual Edit Collapsible */}
        <details className="border border-border-soft/30 bg-bg-surface-soft/40 dark:bg-neutral-950/40 rounded-2xl overflow-hidden group">
          <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-text-muted hover:text-text-primary transition-colors flex items-center justify-between">
            <span>手动修改节点文字</span>
          </summary>
          <div className="space-y-3 border-t border-border-soft/30 p-4 bg-bg-surface dark:bg-neutral-900">
            <div>
              <label className="text-[11px] text-text-muted block mb-1 font-bold">节点标题</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleSaveBrief}
                className="w-full bg-bg-surface-soft dark:bg-neutral-950 border border-border-soft/40 px-3 py-2 text-xs text-text-primary rounded-xl focus:outline-none focus:border-gold/60 transition-colors"
              />
            </div>

            <div>
              <label className="text-[11px] text-text-muted block mb-1 font-bold">一句话叙事意图</label>
              <input
                type="text"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                onBlur={handleSaveBrief}
                placeholder="如：主角初次获得关键线索"
                className="w-full bg-bg-surface-soft dark:bg-neutral-950 border border-border-soft/40 px-3 py-2 text-xs text-text-primary rounded-xl focus:outline-none focus:border-gold/60 transition-colors"
              />
            </div>

            <div>
              <label className="text-[11px] text-text-muted block mb-1 font-bold">剧情概要</label>
              <textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                onBlur={handleSaveBrief}
                rows={3}
                className="w-full bg-bg-surface-soft dark:bg-neutral-950 border border-border-soft/40 p-3 text-xs text-text-primary rounded-xl focus:outline-none focus:border-gold/60 resize-none transition-colors"
              />
            </div>
          </div>
        </details>

        {chapters && onMoveToChapter && <label className="block rounded-2xl border border-border-soft/30 bg-bg-surface-soft/40 p-4 text-xs font-bold text-text-muted">
          所属章节
          <select aria-label="所属章节" value={currentChapterId} onChange={(event) => onMoveToChapter(node.id, event.target.value)} className="mt-2 w-full rounded-xl border border-border-soft/40 bg-bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:border-gold/60">
            <option value="">未归章</option>
            {chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
          </select>
        </label>}

        {onUpdateNode && <details className="border border-border-soft/30 bg-bg-surface-soft/40 dark:bg-neutral-950/40 rounded-2xl overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-xs font-bold text-text-muted hover:text-text-primary">节点用途与运行方式</summary>
          <div className="space-y-3 border-t border-border-soft/30 p-4 text-xs">
            <label className="block">叙事类型<select aria-label="叙事类型" value={dramaticFunction} onChange={(event) => setDramaticFunction(event.target.value as typeof dramaticFunction)} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-text-primary"><option value="exposition">序幕铺垫</option><option value="inciting_incident">引发事件</option><option value="choice_point">抉择时刻</option><option value="climax">剧情高潮</option><option value="resolution">结局收束</option><option value="ending">最终结局</option></select></label>
            <label className="block">内容用途<select aria-label="内容用途" value={contentPolicy} onChange={(event) => setContentPolicy(event.target.value as NodeContentPolicy)} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-text-primary"><option value="create_shared_content">创作共用正文</option><option value="exclusive_branch_content">创作此分支专属正文</option><option value="bind_existing">绑定已有正文</option><option value="compatible_state_reuse">按状态复用正文</option><option value="no_new_content">纯逻辑衔接，不需新正文</option></select></label>
            <div className="grid grid-cols-2 gap-2"><label>最短时长（秒）<input aria-label="最短时长" type="number" min={1} value={durationMin} onChange={(event) => setDurationMin(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-text-primary" /></label><label>最长时长（秒）<input aria-label="最长时长" type="number" min={1} value={durationMax} onChange={(event) => setDurationMax(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-text-primary" /></label></div>
            <div><div className="mb-1 text-text-muted">运行能力</div><div className="grid grid-cols-2 gap-1">{([
              ['present_choice', '呈现选择'], ['evaluate_condition', '检查条件'], ['apply_state_effect', '改变状态'], ['converge', '汇合分支'], ['checkpoint', '建立存档点'], ['fail_or_retry', '失败或重试'], ['interaction_hold', '等待交互'],
            ] as const).map(([capability, label]) => <label key={capability} className="flex items-center gap-1"><input type="checkbox" checked={capabilities.includes(capability)} onChange={(event) => setCapabilities(event.target.checked ? [...capabilities, capability] : capabilities.filter((item) => item !== capability))} />{label}</label>)}</div></div>
            <label className="block">进入前玩家已知（每行一项）<textarea rows={2} value={knowledgeIn} onChange={(event) => setKnowledgeIn(event.target.value)} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-text-primary" /></label>
            <label className="block">离开后玩家得知（每行一项）<textarea rows={2} value={knowledgeOut} onChange={(event) => setKnowledgeOut(event.target.value)} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-text-primary" /></label>
            {stateSchema && <details className="rounded-xl border border-border-soft/30 p-2.5"><summary className="cursor-pointer font-bold">状态读写与事实要求</summary><div className="mt-2 space-y-2">{([
              ['readVariables', '读取变量', stateSchema.variables.map((item) => item.key)],
              ['writeVariables', '写入变量', stateSchema.variables.map((item) => item.key)],
              ['requiredFacts', '进入所需事实', getFactDefinitions(stateSchema)],
              ['producedFacts', '完成后获得事实', getFactDefinitions(stateSchema)],
            ] as const).map(([key, label, options]) => <fieldset key={key}><legend className="font-medium text-text-muted">{label}</legend><div className="grid grid-cols-2 gap-1">{[...new Set([...options, ...stateContract[key]])].map((option) => <label key={option} className="flex items-center gap-1"><input type="checkbox" checked={stateContract[key].includes(option)} onChange={(event) => setStateContract({ ...stateContract, [key]: event.target.checked ? [...stateContract[key], option] : stateContract[key].filter((item) => item !== option) })} />{option}</label>)}</div></fieldset>)}</div></details>}
            <button type="button" onClick={handleSaveNode} className="w-full rounded-xl bg-gold px-3 py-2 font-bold text-bg-primary hover:bg-gold-light">保存节点设置</button>
          </div>
        </details>}

        {/* Story Content Section */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase tracking-wider">接下来</div>
          <div className="space-y-3 border border-border-soft/30 bg-bg-surface-soft/40 dark:bg-neutral-950/40 p-4 rounded-2xl">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-text-primary flex items-center">
                <FileText className="w-4 h-4 mr-1.5 text-gold" />
                节点内容
              </span>
              {hasScriptBinding ? (
                <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-500 flex items-center border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  已准备
                </span>
              ) : (
                <span className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-bg-surface-soft text-text-muted border border-border-soft/30">
                  待准备
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onOpenWritingHandoff(node.id)}
              disabled={isPreparingContent}
              className="w-full border border-border-soft/40 bg-bg-surface dark:bg-neutral-900 p-3 text-left rounded-xl transition-all hover:border-gold/40 hover:shadow-md"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-gold">
                {isPreparingContent && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {hasScriptBinding ? '查看完整剧本' : '打开剧本工作区'}
              </div>
              <div className="mt-1 text-[11px] leading-5 text-text-muted">
                {hasScriptBinding
                  ? '打开已连接的剧本，修改后可回到当前节点'
                  : '在剧本工作区编写正文，保存后回到白板选择场景版本'}
              </div>
            </button>
            {!hasScriptBinding && hasWritingProject && onPrepareContent && <button type="button" disabled={isPreparingContent} onClick={() => onPrepareContent(node.id)} className="w-full rounded-xl border border-border-soft/40 bg-bg-surface p-3 text-left text-xs font-bold text-gold hover:border-gold/40">{isPreparingContent ? '正在安排节点内容' : '让 AI 安排节点内容'}</button>}
          </div>

          <div className="border border-border-soft/30 bg-bg-surface-soft/40 dark:bg-neutral-950/40 p-4 rounded-2xl">
            <button
              type="button"
              onClick={() => onOpenProductionHandoff(node.id)}
              className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                hasMediaTake
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-500 font-bold'
                  : 'bg-bg-surface dark:bg-neutral-900 border-border-soft/40 text-text-primary hover:border-gold/40'
              }`}
            >
              <div>
                <div className="text-xs font-bold">制片工作台</div>
                <div className="text-[11px] text-text-muted mt-0.5">{hasMediaTake ? '画面已采用' : '准备资产、镜头和画面'}</div>
              </div>
              <Video className="w-4.5 h-4.5 text-emerald-500" />
            </button>
          </div>
        </div>

        {/* Choices List */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
              玩家选择（{node.choices.length}）
            </span>
            <button
              type="button"
              onClick={() => onAddChoice(node.id)}
              className="text-xs text-gold hover:text-gold-light flex items-center font-bold"
            >
              <Plus className="w-3.5 h-3.5 mr-0.5" />
              添加选项
            </button>
          </div>

          <div className="space-y-2">
            {node.choices.length === 0 ? (
              <div className="p-4 text-center text-xs text-text-muted rounded-2xl border border-dashed border-border-soft/40 bg-bg-surface-soft/40">
                这个节点没有玩家选择
              </div>
            ) : (
              node.choices.map((c: InteractiveChoice) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectChoice(c.id)}
                  className="w-full p-3 rounded-xl bg-bg-surface dark:bg-neutral-900 border border-border-soft/40 hover:border-gold/50 cursor-pointer flex items-center justify-between transition-all text-left group"
                >
                  <div className="truncate mr-2">
                    <div className="text-xs font-bold text-text-primary truncate">{c.text || '未命名选项'}</div>
                    <div className="text-[10px] text-text-muted mt-0.5">点击查看或修改</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-gold shrink-0 transition-colors" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Footer Delete Action */}
      <footer className="p-4 border-t border-border-soft/30 bg-bg-surface dark:bg-neutral-900 shrink-0">
        <button
          type="button"
          onClick={() => onDeleteNode(node.id)}
          className="w-full flex items-center justify-center border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 py-2.5 rounded-xl text-xs font-bold transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          删除此节点
        </button>
      </footer>
    </aside>
  );
};
