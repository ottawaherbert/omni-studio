import React, { useState } from 'react';
import { X, Trash2, Clock, Check } from 'lucide-react';
import type { InteractiveChoice, NarrativeNode, StateSchema } from '../../../domains/interactive/types/schema.ts';
import { InteractiveEffectsEditor, InteractivePredicateEditor } from './InteractiveRuleEditor.tsx';

export interface InteractiveChoiceInspectorProps {
  choice: InteractiveChoice;
  allNodes: NarrativeNode[];
  stateSchema?: StateSchema;
  onClose: () => void;
  onSaveChoice: (choiceId: string, updated: Partial<InteractiveChoice>) => void;
  onDeleteChoice: (choiceId: string) => void;
}

const defaultInteraction = {
  playerKnowledge: '', immediateFeedback: '', consequenceHorizon: 'immediate' as const,
  thematicMeaning: '', convergenceStrategy: 'diverge' as const, estimatedUniqueMediaSec: 0, replayValue: '无新增内容',
};

const ChoiceForm: React.FC<InteractiveChoiceInspectorProps> = ({
  choice,
  allNodes,
  stateSchema = { variables: [], factDefinitions: [], initialFactIds: [] },
  onClose,
  onSaveChoice,
  onDeleteChoice,
}) => {
  const [text, setText] = useState(choice.text || '');
  const [intent, setIntent] = useState(choice.intent || '');
  const [targetNodeId, setTargetNodeId] = useState(choice.targetNodeId || '');
  const [enableTimeout, setEnableTimeout] = useState(choice.timeoutSeconds !== undefined);
  const [timeoutSeconds, setTimeoutSeconds] = useState(choice.timeoutSeconds || 5);
  const [defaultTimeoutTarget, setDefaultTimeoutTarget] = useState(choice.defaultTimeoutTargetNodeId || choice.targetNodeId || '');
  const [condition, setCondition] = useState(choice.condition);
  const [effects, setEffects] = useState(choice.effects || []);
  const [interaction, setInteraction] = useState(choice.interaction || defaultInteraction);

  const handleSave = () => {
    onSaveChoice(choice.id, {
      text: text.trim() || '未命名选项',
      intent: intent.trim(),
      targetNodeId,
      timeoutSeconds: enableTimeout ? Number(timeoutSeconds) : undefined,
      defaultTimeoutTargetNodeId: enableTimeout ? defaultTimeoutTarget : undefined,
      condition,
      effects,
      interaction,
    });
    onClose();
  };

  return (
    <div className="fixed top-14 bottom-0 right-0 z-40 flex w-full flex-col border-l border-border-soft/30 bg-bg-surface/95 dark:bg-neutral-900/95 text-text-primary shadow-2xl backdrop-blur-xl sm:w-[380px] transition-colors">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4 bg-bg-surface dark:bg-neutral-900">
        <div>
          <div className="text-sm font-bold text-text-primary">编辑玩家选择</div>
          <div className="mt-0.5 text-[11px] text-text-muted">修改玩家看到的文字、去向和等待时间</div>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭选择详情" title="关闭" className="p-1.5 rounded-xl text-text-muted hover:bg-bg-surface-soft hover:text-text-primary transition-colors"><X className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        <div className="space-y-3 border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 p-4 rounded-xl">
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-text-muted">玩家看到的选项</span><input value={text} onChange={(event) => setText(event.target.value)} placeholder="如：留下调查真相" className="w-full border border-border-soft/40 bg-bg-surface dark:bg-neutral-900 px-3 py-2 text-sm text-text-primary outline-none focus:border-gold/60 rounded-xl" /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-text-muted">这个选择想表达什么</span><input value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="如：为了真相承担风险" className="w-full border border-border-soft/40 bg-bg-surface dark:bg-neutral-900 px-3 py-2 text-sm text-text-primary outline-none focus:border-gold/60 rounded-xl" /></label>
          <label className="block"><span className="mb-1 block text-[11px] font-medium text-text-muted">选择后前往</span><select value={targetNodeId} onChange={(event) => setTargetNodeId(event.target.value)} className="w-full border border-border-soft/40 bg-bg-surface dark:bg-neutral-900 px-3 py-2 text-sm text-text-primary outline-none focus:border-gold/60 rounded-xl">{allNodes.map((node) => <option key={node.id} value={node.id}>{node.brief?.title || '未命名节点'}</option>)}</select></label>
        </div>
        <details className="border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 p-4 rounded-xl" open={Boolean(choice.condition || choice.effects?.length)}>
          <summary className="cursor-pointer font-bold text-text-primary">生效条件与状态变化</summary>
          <div className="mt-3 space-y-3"><label className="block font-medium text-text-muted">出现条件</label><InteractivePredicateEditor value={condition} onChange={setCondition} schema={stateSchema} nodes={allNodes} /><label className="block font-medium text-text-muted">选择后的状态效果</label><InteractiveEffectsEditor value={effects} onChange={setEffects} schema={stateSchema} /></div>
        </details>
        <details className="border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 p-4 rounded-xl" open={Boolean(choice.interaction)}>
          <summary className="cursor-pointer font-bold text-text-primary">玩家知情与分支后果</summary>
          <div className="mt-3 space-y-3">
            {([
              ['playerKnowledge', '选择前玩家知道什么'], ['immediateFeedback', '选择后立刻看到或听到什么'],
              ['thematicMeaning', '这个选择的戏剧意义'], ['replayValue', '再次游玩会发现什么'],
            ] as const).map(([key, label]) => <label key={key} className="block"><span className="mb-1 block text-[11px] text-text-muted">{label}</span><textarea rows={2} value={interaction[key]} onChange={(event) => setInteraction({ ...interaction, [key]: event.target.value })} className="w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-xs text-text-primary outline-none focus:border-gold/60" /></label>)}
            <div className="grid grid-cols-2 gap-2"><label>后果何时显现<select value={interaction.consequenceHorizon} onChange={(event) => setInteraction({ ...interaction, consequenceHorizon: event.target.value as typeof interaction.consequenceHorizon })} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-xs text-text-primary"><option value="immediate">立即</option><option value="delayed">稍后</option><option value="chapter">本章</option><option value="ending">结局</option></select></label><label>分支走向<select value={interaction.convergenceStrategy} onChange={(event) => setInteraction({ ...interaction, convergenceStrategy: event.target.value as typeof interaction.convergenceStrategy })} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-xs text-text-primary"><option value="diverge">继续分叉</option><option value="soft_converge">部分汇合</option><option value="hard_converge">完全汇合</option><option value="terminal">进入结局</option></select></label></div>
            <label className="block">独占画面时长（秒）<input type="number" min={0} value={interaction.estimatedUniqueMediaSec} onChange={(event) => setInteraction({ ...interaction, estimatedUniqueMediaSec: Number(event.target.value) })} className="mt-1 w-full rounded-xl border border-border-soft/40 bg-bg-surface p-2 text-xs text-text-primary" /></label>
          </div>
        </details>

        <div className="space-y-3 border border-border-soft/30 bg-bg-surface-soft/60 dark:bg-neutral-950/60 p-4 rounded-xl">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="flex items-center font-bold text-text-primary"><Clock className="mr-1.5 h-4 w-4 text-sky-400" />限时选择</span>
            <input type="checkbox" checked={enableTimeout} onChange={(event) => setEnableTimeout(event.target.checked)} className="h-4 w-4 rounded accent-gold" />
          </label>
          {enableTimeout && <div className="grid grid-cols-2 gap-2 pt-1"><label><span className="mb-1 block text-[10px] text-text-muted font-medium">思考时间（秒）</span><input type="number" min={1} max={60} value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(Number(event.target.value))} className="w-full border border-border-soft/40 bg-bg-surface dark:bg-neutral-900 px-3 py-2 text-xs text-text-primary rounded-xl focus:border-gold/60" /></label><label><span className="mb-1 block text-[10px] text-text-muted font-medium">超时自动前往</span><select value={defaultTimeoutTarget} onChange={(event) => setDefaultTimeoutTarget(event.target.value)} className="w-full border border-border-soft/40 bg-bg-surface dark:bg-neutral-900 px-3 py-2 text-xs text-text-primary rounded-xl focus:border-gold/60">{allNodes.map((node) => <option key={node.id} value={node.id}>{node.brief?.title || '未命名节点'}</option>)}</select></label></div>}
        </div>
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border-soft/30 p-4 bg-bg-surface dark:bg-neutral-900">
        <button type="button" onClick={() => { onDeleteChoice(choice.id); onClose(); }} className="flex items-center justify-center border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-500 hover:bg-rose-500/20 rounded-xl transition-colors"><Trash2 className="mr-1.5 h-4 w-4" />删除</button>
        <button type="button" onClick={handleSave} className="flex-1 flex items-center justify-center bg-gold hover:bg-gold-light py-2.5 text-xs font-bold text-bg-primary rounded-xl transition-all shadow-md shadow-gold/20"><Check className="mr-1.5 h-4 w-4" />保存修改</button>
      </div>
    </div>
  );
};

export const InteractiveChoiceInspector: React.FC<InteractiveChoiceInspectorProps> = (props) => <ChoiceForm key={props.choice.id} {...props} />;
