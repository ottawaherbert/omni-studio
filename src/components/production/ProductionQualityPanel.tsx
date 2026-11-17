import { useEffect, useRef, useState } from 'react';
import {
  qualityStages, qualityCheckLabels,
  type ProductionQualityStage, type ProductionQualityStatus, type ProductionResponsibility,
  type QualityInspection, type QualityTarget, type QualityEvidenceInput,
} from '../../../packages/domain/src/productionQuality';
import { flushDebouncedProjectSave } from '../../clients/stateClient';

const input = 'w-full rounded-md border border-border-soft bg-bg-primary p-2 text-xs';
const button = 'rounded-md border border-border-soft px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50';
const statuses = { pending: '待检查', passed: '通过', failed: '未通过', stale: '来源已变化', blocked: '上游未通过' };
const emptyResponsibility: ProductionResponsibility = { director: '', coordinator: '', intent: '', visualDirection: '', spatialMode: 'scene_plan' };
const displayNames: Record<string, string> = {
  project: '全剧', episode: '本集', scene: '本场', title: '名称', name: '名称', script: '剧本', description: '说明',
  shots: '镜头', duration: '预计时长', durationSeconds: '时长', visualAction: '画面动作', dialogueLines: '对白', text: '正文',
  breakdown: '场次拆解', visualPlan: '场面设计', geography: '空间', lighting: '光线', entryState: '入场状态', exitState: '出场状态',
  motivation: '镜头作用', editingNote: '切镜依据', responsibility: '制作职责', director: '总导演', coordinator: '全局统筹',
  overall: '总体方案', direction: '导演方向', scenePlan: '整场设计', shotPlan: '拆镜方案', preparation: '制作准备', visuals: '整组画面', segments: '视频与声音', scenes: '场次', cut: '合成', space: '空间与事件', spatial: '空间依据', images: '画面', videos: '视频', boards: '分组', references: '空间参考', audioTracks: '音轨', rhythm: '节奏', requirements: '制作需求', beatDirections: '节拍安排', assumptions: '待核实事项', logline: '故事梗概', aspectRatio: '画幅', visualStyleLock: '视听风格', spatialMode: '空间方式', scriptBlocks: '剧本段落', sceneGoal: '本场目标', eventStates: '事件状态', transition: '跨场关系', cameraMovement: '运镜', shotSize: '景别', cameraAngle: '机位', focalLength: '焦距', composition: '构图', blocking: '调度', continuityNote: '承接说明', soundDesign: '声音安排',
  intent: '总体意图', visualDirection: '视听方向', assets: '资产', characters: '角色', edit: '剪辑', plan: '方案',
};
/** Keep technical tracking fields out of the review surface while preserving concrete work. */
function Snapshot({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="text-text-muted">未填写</span>;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (depth > 12) return <span>更多内容请在作品工作区查看。</span>;
  const entries = Object.entries(value).filter(([key]) => !/(hash|revision|version|(^|_)id$|Ids$|Id$|At$|Url$)/i.test(key));
  return <dl className="space-y-2">{entries.map(([key, item]) => <div key={key} className="border-l border-border-soft pl-3">
    <dt className="mb-1 text-text-muted">{Array.isArray(value) ? `第 ${Number(key) + 1} 项` : displayNames[key] || key}</dt>
    <dd><Snapshot value={item} depth={depth + 1} /></dd>
  </div>)}</dl>;
}
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/production/quality${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || (response.status === 409 ? '作品或检查依据已变化，请重新读取检查对象后再评审。' : '操作未完成，请重试。')), { status: response.status });
  return data;
}
type EvidenceDraft = QualityEvidenceInput & { id: number };
type ShotOption = { id: string; label?: string };
function snapshotShots(value: unknown): ShotOption[] {
  if (!value || typeof value !== 'object') return [];
  for (const [key, item] of Object.entries(value)) {
    if (key === 'shots' && Array.isArray(item)) return item.filter(shot => typeof shot?.id === 'string').map((shot, index) => ({ id: shot.id, label: `镜头 ${index + 1}${shot.visualAction ? ` · ${shot.visualAction}` : ''}` }));
    const found = snapshotShots(item);
    if (found.length) return found;
  }
  return [];
}
export function ProductionQualityPanel({ projectId, episodeId, sceneId, shots = [] }: QualityTarget & { shots?: ShotOption[] }) {
  const target = { projectId, episodeId, sceneId };
  const scope = JSON.stringify(target);
  const epoch = useRef(0);
  const [status, setStatus] = useState<ProductionQualityStatus>();
  const [responsibility, setResponsibility] = useState<ProductionResponsibility>(emptyResponsibility);
  const [inspection, setInspection] = useState<QualityInspection>();
  const [stage, setStage] = useState<ProductionQualityStage>('project_plan');
  const [findings, setFindings] = useState<Record<string, { passed?: boolean; note: string }>>({});
  const [reviewerName, setReviewerName] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [evidenceDrafts, setEvidenceDrafts] = useState<EvidenceDraft[]>([]);
  const evidenceSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [deliveryUrl, setDeliveryUrl] = useState('');
  const current = status?.stages.find(item => item.stage === stage);
  const checks = current?.checks || qualityStages[stage].checks.map(id => ({ id, label: qualityCheckLabels[id] }));
  const complete = checks.every(check => typeof findings[check.id]?.passed === 'boolean' && findings[check.id].note.trim());
  const allPassed = complete && checks.every(check => findings[check.id].passed);
  const overall = ['project_plan', 'scene_plan', 'visuals', 'scene_cut', 'episode_cut'].includes(stage);
  const needsVideo = stage === 'scene_cut' || stage === 'episode_cut';
  const groupEvidence = ['preparation', 'visuals', 'segments'].includes(stage);
  const shotOptions = shots.length ? shots : snapshotShots(inspection?.snapshot);
  const allowedKinds: QualityEvidenceInput['mediaKind'][] = stage === 'visuals' ? ['image'] : stage === 'segments' ? ['video', 'audio'] : ['image', 'video'];
  const kindLabels = { image: '图片', video: '视频', audio: '声音' };
  const invalidEvidence = groupEvidence && evidenceDrafts.some(item => !item.mediaUrl.trim() || !item.shotIds?.length || item.shotIds.some(id => !shotOptions.some(shot => shot.id === id)));
  function changeEvidence(id: number, patch: Partial<QualityEvidenceInput>) {
    setEvidenceDrafts(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
    setInspection(undefined); setFindings({}); setDelivery(false);
  }

  const blocked = !current || current.status === 'blocked' || current.blockers.length > 0;

  async function refresh(token: number, updateResponsibility = false) {
    const data = await request<ProductionQualityStatus>(`/status?target=${encodeURIComponent(scope)}`);
    if (epoch.current !== token) return;
    setStatus(data);
    if (updateResponsibility) { setResponsibility(data.responsibility || emptyResponsibility); setReviewerName(data.responsibility?.director || ''); }
  }
  useEffect(() => {
    const token = ++epoch.current;
    setStatus(undefined); setInspection(undefined); setFindings({}); setError(''); setMessage(''); setVideoUrl(''); setEvidenceDrafts([]); setBusy(true); setDelivery(false);
    void refresh(token, true).catch(e => { if (epoch.current === token) setError(e.message); }).finally(() => { if (epoch.current === token) setBusy(false); });
    return () => { epoch.current++; };
  }, [scope]);
  async function run(action: (token: number) => Promise<void>) {
    const token = epoch.current;
    setBusy(true); setError(''); setMessage('');
    try { await flushDebouncedProjectSave(projectId); await action(token); }
    catch (e) {
      if (epoch.current !== token) return;
      const failure = e as Error & { status?: number };
      setError(failure.message);
      if (failure.status === 409) { setInspection(undefined); setFindings({}); setDelivery(false); await refresh(token).catch(() => {}); }
    } finally { if (epoch.current === token) setBusy(false); }
  }
  return <details open className="mx-3 my-4 border-b border-border-soft pb-4 text-xs sm:mx-8" aria-label="制作阶段质量检查">
    <summary className="cursor-pointer font-semibold text-text-primary">总体方案、分步质检与整体验收</summary>
    {error && <p role="alert" className="mt-3 text-red-500">{error}</p>}
    {message && <p role="status" className="mt-3 text-text-secondary">{message}</p>}
    <fieldset disabled={busy} className="mt-3 min-w-0 space-y-4">
      <p className="text-text-muted">{status?.instruction || '先确定总体方案，再检查拆分成果，最后完整回看。未通过的项目停止其依赖流程。'}</p>
      <details><summary className="cursor-pointer font-medium">全局统筹与制作职责</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
        {(['director', 'coordinator', 'intent', 'visualDirection'] as const).map(key => <label key={key}>{displayNames[key]}<input className={`${input} mt-1`} value={responsibility[key]} onChange={e => setResponsibility(r => ({ ...r, [key]: e.target.value }))} /></label>)}
        <label>空间制作方式<select className={`${input} mt-1`} value={responsibility.spatialMode} onChange={e => setResponsibility(r => ({ ...r, spatialMode: e.target.value as ProductionResponsibility['spatialMode'] }))}><option value="scene_plan">场面设计（普通制作）</option><option value="previs">3D 虚拟制片</option></select></label>
        <p className="text-text-muted">总导演与全局统筹可以由同一人兼任。</p>
        <button type="button" className={button} disabled={!responsibility.director.trim() || !responsibility.coordinator.trim() || !responsibility.intent.trim() || !responsibility.visualDirection.trim()} onClick={() => void run(async token => { await request(`/projects/${encodeURIComponent(projectId)}/responsibility`, 'PUT', responsibility); await refresh(token); if (epoch.current === token) { setReviewerName(responsibility.director); setInspection(undefined); setFindings({}); setMessage('制作职责已保存。'); } })}>保存制作职责</button>
      </div></details>
      <div className="grid gap-2 sm:grid-cols-2" aria-label="八个制作阶段">{(Object.keys(qualityStages) as ProductionQualityStage[]).map(key => {
        const item = status?.stages.find(s => s.stage === key);
        const reason = item?.blockers.join('；') || (!item ? '尚未读取本阶段状态' : '');
        return <div key={key} className="min-w-0 border-b border-border-soft pb-2"><button type="button" className={`w-full text-left ${stage === key ? 'font-semibold text-gold' : ''}`} disabled={!item || item.status === 'blocked' || !!reason} title={reason} onClick={() => { setStage(key); setInspection(undefined); setFindings({}); setVideoUrl(''); setEvidenceDrafts([]); setDelivery(false); setMessage(''); setError(''); setReviewerName(responsibility.director); }}>{qualityStages[key].label} · {item ? statuses[item.status] : '读取中'}</button><p className="mt-1 text-text-muted">{item?.owner || qualityStages[key].owner}{reason && `；${reason}`}</p></div>;
      })}</div>
      <section aria-label="当前阶段检查" className="space-y-3">
        <h3 className="font-semibold">{qualityStages[stage].label}</h3>
        {blocked && <p className="text-text-muted">{current?.blockers.join('；') || '此阶段尚不可检查。'}</p>}
        {needsVideo && <label className="block">实际回看视频地址<input type="url" className={`${input} mt-1`} value={videoUrl} onChange={e => { setVideoUrl(e.target.value); setInspection(undefined); setFindings({}); }} placeholder="填写本次整场或整集合成视频地址" /></label>}
        {groupEvidence && <section aria-label="实际媒体证据清单" className="space-y-3">
          <p className="text-text-muted">可留空读取服务器当前采用媒体；资产或3D取景图、宫格与分组视频可在此补充。每项默认关联本场全部镜头，请核对可见映射，按实际内容取消无关镜头。填写清单后以整份清单检查本场，声音不能代替视频覆盖。</p>
          {!shotOptions.length && <p className="text-text-muted">尚无可关联镜头，请先完成本场拆镜并刷新。</p>}
          {evidenceDrafts.map((item, index) => <div key={item.id} className="space-y-2 border-b border-border-soft pb-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
              <label>媒体 {index + 1} 地址<input type="url" className={`${input} mt-1`} value={item.mediaUrl} onChange={e => changeEvidence(item.id, { mediaUrl: e.target.value })} /></label>
              <label>媒体 {index + 1} 类型<select className={`${input} mt-1`} value={item.mediaKind} onChange={e => changeEvidence(item.id, { mediaKind: e.target.value as QualityEvidenceInput['mediaKind'] })}>{allowedKinds.map(kind => <option key={kind} value={kind}>{kindLabels[kind]}</option>)}</select></label>
              <button type="button" className={button} onClick={() => { setEvidenceDrafts(items => items.filter(row => row.id !== item.id)); setInspection(undefined); setFindings({}); }}>移除媒体 {index + 1}</button>
            </div>
            <fieldset className="min-w-0"><legend className="mb-1">媒体 {index + 1} 对应镜头（已选 {item.shotIds?.length || 0} / {shotOptions.length}）</legend><div className="grid max-h-44 gap-2 overflow-auto sm:grid-cols-2">{shotOptions.map((shot, shotIndex) => <label key={shot.id} className="flex min-w-0 items-start gap-2"><input className="mt-0.5 shrink-0" type="checkbox" checked={item.shotIds?.includes(shot.id) || false} onChange={e => changeEvidence(item.id, { shotIds: e.target.checked ? [...(item.shotIds || []), shot.id] : item.shotIds?.filter(id => id !== shot.id) })} /><span className="break-words">{shot.label || `镜头 ${shotIndex + 1}`}</span></label>)}</div></fieldset>
            <label className="block">媒体 {index + 1} 用途说明<input className={`${input} mt-1`} value={item.note || ''} onChange={e => changeEvidence(item.id, { note: e.target.value })} /></label>
          </div>)}
          <button type="button" className={button} disabled={!shotOptions.length || evidenceDrafts.length >= 200} onClick={() => { setEvidenceDrafts(items => [...items, { id: ++evidenceSequence.current, mediaUrl: '', mediaKind: allowedKinds[0], shotIds: shotOptions.map(shot => shot.id), note: '' }]); setInspection(undefined); setFindings({}); }}>添加实际媒体</button>
        </section>}
        <button type="button" className={button} disabled={blocked || invalidEvidence || needsVideo && !videoUrl.trim()} onClick={() => void run(async token => {
          const result = await request<{ inspection: QualityInspection }>('/inspections', 'POST', { target, stage, ...(needsVideo ? { evidence: [{ mediaUrl: videoUrl.trim(), mediaKind: 'video' }] } : groupEvidence && evidenceDrafts.length ? { evidence: evidenceDrafts.map(({ id: _id, ...item }) => ({ ...item, mediaUrl: item.mediaUrl.trim() })) } : {}) });
          if (epoch.current !== token) return;
          setInspection(result.inspection); setFindings({}); setDelivery(false); setReviewerName(responsibility.director);
        })}>读取当前检查对象</button>
        {inspection && <>
          <details open><summary className="cursor-pointer font-medium">本次实际检查对象</summary><div className="mt-2 max-h-80 overflow-auto p-1"><Snapshot value={inspection.snapshot} /></div></details>
          {inspection.evidence.length > 0 && <div className="grid min-w-0 gap-4 sm:grid-cols-2">{inspection.evidence.map((media, i) => <figure key={`${media.mediaUrl}-${i}`} className="min-w-0">
            {media.mediaKind === 'image' ? <img src={media.mediaUrl} alt={`检查画面 ${i + 1}`} className="max-h-96 w-full object-contain" /> : media.mediaKind === 'video' ? <video src={media.mediaUrl} controls preload="metadata" className="max-h-96 w-full" aria-label={`检查视频 ${i + 1}`} /> : <audio src={media.mediaUrl} controls preload="metadata" className="w-full" aria-label={`检查声音 ${i + 1}`} />}
            <figcaption className="mt-1 text-text-muted">{media.note || `检查素材 ${i + 1}`}{media.shotIds?.length ? ` · 对应：${media.shotIds.map(id => shotOptions.find(shot => shot.id === id)?.label || `镜头 ${shotOptions.findIndex(shot => shot.id === id) + 1}`).join('、')}` : ''}{media.durationSeconds ? ` · ${media.durationSeconds} 秒` : ''}</figcaption>
          </figure>)}</div>}
          <p className="text-text-muted">查看本次对象和实际媒体后，逐项选择结论并记录观察。失败保留成果，不自动返工。</p>
          <label className="block">{overall ? '总导演姓名' : '检查人姓名'}<input className={`${input} mt-1`} value={reviewerName} onChange={e => setReviewerName(e.target.value)} /></label>
          {checks.map(check => <div key={check.id} className="space-y-2 border-b border-border-soft pb-3"><p>{check.label}</p>
            <div className="flex gap-4">{[true, false].map(passed => <label key={String(passed)} className="flex items-center gap-2"><input type="radio" name={`${inspection.id}-${check.id}`} checked={findings[check.id]?.passed === passed} onChange={() => setFindings(f => ({ ...f, [check.id]: { ...f[check.id], note: f[check.id]?.note || '', passed } }))} />{passed ? '通过' : '不通过'}</label>)}</div>
            <label className="block text-text-secondary">实际观察<textarea className={`${input} mt-1`} aria-label={`${check.label}：实际观察`} value={findings[check.id]?.note || ''} onChange={e => setFindings(f => ({ ...f, [check.id]: { ...f[check.id], note: e.target.value } }))} /></label>
          </div>)}
          <button type="button" className={button} disabled={!complete || !reviewerName.trim() || !!inspection.verdict} onClick={() => void run(async token => {
            const result = await request<{ inspection: QualityInspection }>(`/inspections/${encodeURIComponent(inspection.id)}/review`, 'POST', { verdict: allPassed ? 'passed' : 'failed', findings: checks.map(check => ({ check: check.id, passed: findings[check.id].passed, note: findings[check.id].note.trim() })), reviewerName: reviewerName.trim() });
            if (epoch.current !== token) return;
            setInspection(result.inspection); await refresh(token); setMessage(allPassed ? '本阶段检查通过。' : '已记录未通过项，依赖流程保持停止。');
          })}>{allPassed ? '提交本阶段通过结论' : '提交逐项检查结论'}</button>
          {stage === 'episode_cut' && inspection.verdict === 'passed' && <button type="button" className={`${button} ml-2`} disabled={delivery} onClick={() => void run(async token => {
            const result=await request<{media:{mediaKind:string;mediaUrl:string}[]}>('/deliveries', 'POST', { inspectionId: inspection.id });
            const video=result.media.find(item=>item.mediaKind==='video');
            if(!video)throw new Error('未返回本次已审视频，请重新读取当前检查。');
            if (epoch.current === token) { setDeliveryUrl(video.mediaUrl); setDelivery(true); setMessage('已取回本次通过总检的视频。'); }
          })}>{delivery ? '已取回已审成片' : '取回已审成片'}</button>}
          {delivery && <a className="ml-3 underline" href={deliveryUrl} download>下载已审成片</a>}
        </>}
      </section>
      <button type="button" className={button} onClick={() => void run(async token => { await refresh(token); if (epoch.current === token) { setInspection(undefined); setFindings({}); setDelivery(false); } })}>刷新阶段状态</button>
    </fieldset>
    {busy && <p role="status" className="mt-3 text-text-muted">正在读取或保存…</p>}
  </details>;
}
