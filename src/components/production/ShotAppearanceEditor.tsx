import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AppearanceFields, Project, Shot, ShotAppearanceState } from '../../clients/domainTypes';
import { appearanceReferenceImage, appearanceLabels, appearanceOwner, appearanceSummary, appearanceSelectedVariantId, appearanceVisibleIds } from '../../clients/productionStoryboardWorkflowClient';

type Props = { project: Project; shot: Shot; onChange: (shot: Shot) => void; saved?: boolean; issues?: string[] };
export function ShotAppearanceEditor({ project, shot, onChange, saved, issues = [] }: Props) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  const states = shot.appearance?.states || [];
  const [adding, setAdding] = useState(false);
  const change = (index: number, state: ShotAppearanceState) => onChange({ ...shot, appearance: { analysis: shot.appearance?.analysis || 'unreviewed', states: states.map((old, i) => i === index ? state : old) } });
  const needsReference = states.filter(s => s.decision === "accepted" && s.referenceNeed === "image" && !appearanceReferenceImage(project, s)).length;
  return <details className="mt-3 border-t border-border-soft/40 pt-3 text-xs">
    <summary className="cursor-pointer font-semibold">外观与连续性 · {states.length ? `${states.filter(s => s.decision === 'accepted').length} 项采用${states.some(s => s.decision === 'pending') ? '，有待确认' : ''}` : shot.appearance?.analysis === 'complete' ? '已检查，无变化' : '尚未检查'}{needsReference ? ` · ${needsReference} 项待备图` : ''}</summary>
    {!states.length && <p className="mt-2 leading-5 text-text-muted">{shot.appearance?.analysis === 'complete' ? '本次返回未提出外观变化。' : '这份分镜没有外观检查结果；可直接继续，也可补充状态。新版分镜提示词会同时返回建议。'}</p>}
    {states.map((state, index) => <AppearanceRow key={`${index}:${state.assetId}`} project={project} state={state} saved={saved} returnTo={returnTo} onChange={next => change(index, next)} />)}
    {issues.map(message => <p key={message} className="mt-2 leading-5 text-amber-600 dark:text-amber-300">{message}</p>)}
    <button type="button" className="mt-3 text-cyan-600 dark:text-cyan-400" onClick={() => setAdding(!adding)}>补充状态</button>
    {adding && <select aria-label="选择需要补充状态的资产" className="mt-2 w-full rounded border border-border-soft bg-surface-base p-2" value="" onChange={event => {
      if (!event.target.value) return;
      const assetId = event.target.value;
      const state: ShotAppearanceState = { assetId, assetName: appearanceOwner(project, assetId)?.name || assetId, timelineKey: '', origin: 'proposal', evidence: '', event: '', continuity: 'new', startChanges: {}, endChanges: {}, start: {}, end: {}, imageMoment: 'start', referenceNeed: 'text', decision: 'pending', issues: ['请填写开始状态与故事时间后采用。'], sourceHash: '' };
      onChange({ ...shot, appearance: { analysis: shot.appearance?.analysis || 'unreviewed', states: [...states, state] } }); setAdding(false);
    }}><option value="">选择画面中的角色或物件</option>{appearanceVisibleIds(shot).filter(id => !states.some(s => s.assetId === id)).map(id => <option key={id} value={id}>{appearanceOwner(project, id)?.name || id}</option>)}</select>}
  </details>;
}

function AppearanceRow({ project, state, saved, returnTo, onChange }: { returnTo: string; project: Project; state: ShotAppearanceState; saved?: boolean; onChange: (state: ShotAppearanceState) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state);
  const owner = appearanceOwner(project, state.assetId);
  const variantId = appearanceSelectedVariantId(state);
  const hasImage = Boolean(appearanceReferenceImage(project, state));
  const startEdit = () => { setDraft(state); setEditing(!editing); };
  const field = (phase: 'startChanges' | 'endChanges', key: keyof AppearanceFields, value: string) => setDraft({ ...draft, [phase]: { ...draft[phase], [key]: value } });
  return <div className="mt-3 space-y-2 border-t border-border-soft/30 pt-2">
    <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2"><input type="checkbox" aria-label={`采用${state.assetName}的状态`} checked={state.decision === 'accepted'} onChange={e => onChange({ ...state, decision: e.target.checked ? 'accepted' : 'pending' })} /><strong>{state.assetName}</strong></label><span className="text-text-muted">{state.decision === 'dismissed' ? '已忽略' : state.decision === 'pending' ? '待确认' : state.origin === 'script' ? '原文明确' : '创作设定'}</span></div>
    <p className="leading-5">开始：{appearanceSummary(state.start)}<br />变化：{state.event || '无新增变化'}<br />结束：{appearanceSummary(state.end)}</p>
    <p className="leading-5 text-text-muted">{state.timelineKey || '故事时间未定'}{state.inheritFromShotId ? ' · 承接前序状态' : ''}{state.evidence ? ` · 依据：“${state.evidence}”` : ''}</p>
    <div className="flex flex-wrap gap-2">
      <select aria-label={`${state.assetName}图片时刻`} className="max-w-full rounded border border-border-soft bg-surface-base p-1.5" value={state.imageMoment} onChange={e => onChange({ ...state, imageMoment: e.target.value as 'start' | 'end' })}><option value="start">图片：变化前</option><option value="end">图片：变化后</option></select>
      <select aria-label={`${state.assetName}参考方式`} className="max-w-full rounded border border-border-soft bg-surface-base p-1.5" value={state.referenceNeed} onChange={e => onChange({ ...state, referenceNeed: e.target.value as 'text' | 'image' })}><option value="text">文字变化（复用参考）</option><option value="image">独立外观参考（创建/复用变体）</option></select>
      <button type="button" onClick={startEdit} className="text-cyan-600 dark:text-cyan-400">调整</button>
      <button type="button" onClick={() => onChange({ ...state, decision: 'dismissed' })} className="text-text-muted">忽略建议</button>
    </div>
    {saved && state.decision === 'accepted' && variantId && (state.referenceNeed === 'image' || hasImage) && <Link className="inline-block text-cyan-600 dark:text-cyan-400" to={`/production/assets/${project.characters.some(c => c.id === state.assetId) ? 'character' : 'asset'}/${encodeURIComponent(state.assetId)}?projectId=${encodeURIComponent(project.id)}&variantId=${encodeURIComponent(variantId)}&returnTo=${encodeURIComponent(returnTo)}`}>{hasImage ? '查看状态参考图' : '准备状态参考图与提示词'}</Link>}
    {state.issues.map(issue => <p className="text-amber-600 dark:text-amber-300" key={issue}>{issue}</p>)}
    {editing && <div className="space-y-2">
      <label className="block">故事时间<input aria-label={`${state.assetName}故事时间`} className="mt-1 w-full rounded border border-border-soft bg-surface-base p-2" value={draft.timelineKey} onChange={e => setDraft({ ...draft, timelineKey: e.target.value })} placeholder="例如：主线第一天上午" /></label>
      <label className="block">依据类型<select className="ml-2 rounded border border-border-soft bg-surface-base p-1" value={draft.origin} onChange={e => setDraft({ ...draft, origin: e.target.value as 'script' | 'proposal' })}><option value="script">原文明确</option><option value="proposal">我的创作设定</option></select></label>
      <label className="block">原文依据<input className="mt-1 w-full rounded border border-border-soft bg-surface-base p-2" value={draft.evidence} onChange={e => setDraft({ ...draft, evidence: e.target.value })} /></label>
      <label className="block">承接<select className="ml-2 max-w-full rounded border border-border-soft bg-surface-base p-1" value={draft.continuity} onChange={e => setDraft({ ...draft, continuity: e.target.value as ShotAppearanceState['continuity'], ...(e.target.value === 'new' ? { inheritFromShotId: undefined } : {}) })}><option value="new">明确本镜头开始状态</option><option value="continue">继承已指定前序镜头</option><option value="uncertain">暂不确定</option></select></label>
      <label className="block">复用已有状态<select aria-label={`${state.assetName}复用已有状态`} className="mt-1 w-full rounded border border-border-soft bg-surface-base p-2" value={draft.existingVariantId || ''} onChange={e => { const v = owner?.variants?.find(v => v.id === e.target.value); setDraft({ ...draft, existingVariantId: v?.id, startChanges: v?.appearanceFields || {}, continuity: 'new', inheritFromShotId: undefined }); }}><option value="">基础身份 / 按参考方式匹配</option>{owner?.variants?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <p className="leading-5 text-text-muted">小伤势、汗水和少量泥污用文字变化即可，不创建资产。仅填写外观变化；动作和情绪写在分镜中。清除旧状态请明确写“干净”“已痊愈”等。</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{(['startChanges', 'endChanges'] as const).map(phase => <fieldset key={phase} className="min-w-0"><legend className="mb-1 font-semibold">{phase === 'startChanges' ? '开始时调整' : '结束时变化'}</legend>{Object.entries(appearanceLabels).map(([key, label]) => <label key={key} className="mb-1 block">{label}<input aria-label={`${state.assetName}${phase === 'startChanges' ? '开始' : '结束'}${label}`} className="mt-1 w-full rounded border border-border-soft bg-surface-base p-1.5" value={draft[phase][key as keyof AppearanceFields] || ''} onChange={e => field(phase, key as keyof AppearanceFields, e.target.value)} /></label>)}</fieldset>)}</div>
      <label className="block">镜头内发生的变化<input className="mt-1 w-full rounded border border-border-soft bg-surface-base p-2" value={draft.event} onChange={e => setDraft({ ...draft, event: e.target.value })} /></label>
      <button type="button" className="rounded bg-cyan-700 px-3 py-2 text-white" onClick={() => { onChange({ ...draft, decision: 'accepted' }); setEditing(false); }}>保存状态调整</button>
    </div>}
  </div>;
}
