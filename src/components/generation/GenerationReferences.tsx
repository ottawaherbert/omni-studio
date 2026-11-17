import { useState } from 'react';
import { Film, Music2, Search, Upload } from 'lucide-react';
import { generationRoleLabels, type GenerationCapability, type GenerationReference } from '../../../packages/domain/src/generation';

const input = 'w-full min-w-0 rounded-md border border-border-soft/50 bg-bg-primary px-3 py-2 text-sm text-text-primary';
const statusLabel = (ref: GenerationReference) => ref.qualityIssue ? '接触检查未通过' : ref.status === 'adopted' ? '已采用' : ref.status === 'source_changed' ? '来源变化，需核对' : '待检查';
export function ReferencePreview({ reference }: { reference: GenerationReference }) {
  if (reference.mediaKind === 'image') return <img src={reference.mediaUrl} alt={reference.label} className="h-full w-full object-contain" loading="lazy" />;
  return <div className="flex h-full items-center justify-center text-text-muted">{reference.mediaKind === 'video' ? <Film size={24} /> : <Music2 size={24} />}</div>;
}
export function GenerationReferences({ references, capability, selectedId, busy, onSelect, onToggle, onUpload }: {
  references: GenerationReference[]; capability: GenerationCapability; selectedId?: string; busy: boolean;
  onSelect: (ref: GenerationReference) => void; onToggle: (ref: GenerationReference, enabled: boolean) => void; onUpload: (file: File) => void;
}) {
  const [search, setSearch] = useState('');
  const selected = references.filter(r => r.enabled), available = references.filter(r => !r.enabled && r.label.toLowerCase().includes(search.toLowerCase()));
  const accepted = (['image', 'video', 'audio'] as const).filter(kind => capability.inputs[kind].max > 0);
  function card(ref: GenerationReference) {
    const supported = capability.inputs[ref.mediaKind].max > 0;
    return <div key={ref.id} className={`group relative min-w-0 overflow-hidden rounded-lg border ${selectedId === ref.id ? 'border-gold ring-1 ring-gold/30' : ref.enabled ? 'border-gold/40' : 'border-border-soft/40'}`} draggable onDragStart={e => e.dataTransfer.setData('application/omni-generation-reference', `ref:${ref.mediaVersionId}`)}>
      <button type="button" className="block w-full text-left focus-visible:outline-gold" aria-label={`查看素材 ${ref.label}`} onClick={() => onSelect(ref)}>
        <div className="h-28 bg-bg-surface p-2"><ReferencePreview reference={ref} /></div>
        <div className="px-3 pb-3 pt-2"><p className="truncate text-xs font-medium" title={ref.label}>{ref.label}</p><p className="mt-1 truncate text-[11px] text-text-muted">{generationRoleLabels[ref.role]} · {statusLabel(ref)}</p></div>
      </button>
      <label className="absolute right-2 top-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded bg-bg-primary/95 shadow-sm" title={ref.enabled ? '取消本次引用' : supported ? '用于本次生成' : '当前接入方式未开放此类素材，可更换生成方案'}>
        <input type="checkbox" aria-label={`使用${ref.label}`} disabled={busy || !supported && !ref.enabled} checked={ref.enabled} onChange={e => onToggle(ref, e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
      </label>
    </div>;
  }
  return <section aria-label="参考素材选择">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">本次使用的素材 <span className="ml-1 text-text-muted">{selected.length}</span></h3><p className="mt-1 text-xs leading-5 text-text-muted">点击素材查看来源、调整用途；只有勾选的素材会发送。</p></div>
      {!!accepted.length && <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border-soft/50 px-3 text-xs"><Upload size={14} />上传参考<input aria-label="上传参考文件" type="file" accept={accepted.map(k => `${k}/*`).join(',')} className="sr-only" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.currentTarget.value = ''; if (file) onUpload(file); }} /></label>}
    </div>
    <div className="mb-4 flex flex-wrap gap-3 text-xs text-text-secondary">{accepted.map(kind => <span key={kind}>{({ image: '图片', video: '视频', audio: '音频' })[kind]} {selected.filter(r => r.mediaKind === kind).length} / {capability.inputs[kind].max}{capability.inputs[kind].min ? `（至少 ${capability.inputs[kind].min}）` : ''}</span>)}</div>
    {capability.referenceAdapter === 'h3_multimodal_v1' && <p className="mb-4 text-xs leading-5 text-text-muted">按需组合素材，不必填满。音频可指定人物音色或完整对白；视频仅参考画面，原声需单独添加。新组合仍需服务与成片验证。</p>}
    {selected.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{selected.map(card)}</div> : <p className="border-l-2 border-border-soft/50 py-3 pl-3 text-sm text-text-muted">{accepted.length ? '还没选择素材。从下方素材库勾选，或上传参考文件。' : '此方式根据文字生成，不需要参考素材。'}</p>}
    <details className="mt-5 border-t border-border-soft/30 pt-3" open={search ? true : undefined}>
      <summary className="cursor-pointer text-xs text-text-secondary">添加或替换素材 · {references.filter(r => !r.enabled).length} 份可查看</summary>
      <label className="my-3 flex items-center gap-2 text-text-muted"><Search size={15} /><input aria-label="搜索参考素材" className={input} placeholder="搜索人物、场景、道具或历史宫格" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{available.map(card)}</div>
      {!available.length && <p className="py-4 text-xs text-text-muted">没有符合条件的其他素材。</p>}
    </details>
  </section>;
}
export function GenerationReferenceInspector({ reference: ref, capability, busy, onChange, onBack }: {
  reference: GenerationReference; capability: GenerationCapability; busy: boolean; onChange: (patch: Partial<GenerationReference>) => void; onBack: () => void;
}) {
  const roles = capability.inputs[ref.mediaKind].roles;
  return <section aria-label="素材用途设置" className="space-y-4">
    <button type="button" className="text-xs text-gold" onClick={onBack}>返回生成设置</button>
    <h3 className="text-sm font-semibold break-words">{ref.label}</h3>
    {ref.qualityIssue&&<p role="alert" className="text-xs leading-5 text-amber-400">{ref.qualityIssue}</p>}
    <div className="aspect-video overflow-hidden rounded-lg bg-bg-surface">{ref.mediaKind === 'audio' ? <audio controls src={ref.mediaUrl} className="w-full" /> : ref.mediaKind === 'video' ? <video controls src={ref.mediaUrl} className="h-full w-full" /> : <a href={ref.mediaUrl} target="_blank" rel="noreferrer" title="打开原图"><ReferencePreview reference={ref} /></a>}</div>
    <p className="text-xs text-text-muted">{ref.sourceCharacterId ? '角色声音档案' : ref.sourceAssetId ? '项目资产' : ref.sourceTakeId ? '历史候选' : ref.dependency ? '上游任务结果' : '参考文件'} · {statusLabel(ref)}</p>
    {ref.derivedFrom && <p className="text-xs leading-5 text-text-muted">{ref.derivedFrom.operation === 'extract_frame' ? ref.derivedFrom.framePosition === 'time' ? `提取自原视频 ${ref.derivedFrom.frameTimeSeconds} 秒` : '提取自原视频末尾' : '裁切自原图'}。来源不决定用途，可作为构图、空间或明确的视频首帧使用。</p>}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`本次引用${ref.label}`} checked={ref.enabled} disabled={busy || !capability.inputs[ref.mediaKind].max && !ref.enabled} onChange={e => onChange({ enabled: e.target.checked })} />用于本次生成</label>
    <label className="block text-xs text-text-secondary">这份素材用来参考什么<select aria-label={`${ref.label}的用途`} className={`${input} mt-2`} value={ref.role} disabled={busy} onChange={e => onChange({ role: e.target.value as GenerationReference['role'] })}>{[...new Set([...roles, ref.role])].map(role => <option key={role} value={role} disabled={!roles.includes(role)}>{generationRoleLabels[role]}{!roles.includes(role) ? '（此方式不支持）' : ''}</option>)}</select></label>
    <p className="text-xs leading-5 text-text-muted">用途会随素材一起交给模型。例如人物参考保持身份与服装，场景参考保持空间和光线，不要求它们出现在每个画格。</p>
    <label className="block text-xs text-text-secondary">作用对象与具体要求<textarea aria-label="素材作用对象与要求" className={`${input} mt-2`} rows={3} maxLength={2000} value={ref.usageNote || ''} disabled={busy} placeholder="例如：仅参考闻秋棠的音色，使用本镜台词，不沿用样本情绪。" onChange={e => onChange({ usageNote: e.target.value })} /></label>
    {ref.mediaKind === 'audio' && <p className="text-xs leading-5 text-text-muted">音色参考只确定声音身份；完整对白提供台词与表演参考。输入音频不等于模型会逐字复用或保持原波形，生成后仍须听审。</p>}
    <label className="flex items-start gap-2 text-xs leading-5"><input type="checkbox" className="mt-1" checked={ref.locked} disabled={busy} onChange={e => onChange({ locked: e.target.checked })} />锁定选择和用途，AI 建议保留此设置</label>
    {ref.source === 'user' && <button type="button" className="text-xs text-gold" disabled={busy} onClick={() => onChange({ source: 'preset', locked: false })}>允许 AI 再调整此素材的选择</button>}
    <details className="border-t border-border-soft/30 pt-3 text-xs"><summary className="cursor-pointer text-text-muted">素材版本记录</summary><p className="mt-2 break-all leading-5 text-text-muted">{ref.mediaVersionId}</p></details>
  </section>;
}
