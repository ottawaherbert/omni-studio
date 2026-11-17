import { useState } from 'react';
import toast from 'react-hot-toast';
import { useProjectStore, flushDebouncedProjectSave } from '../../clients/stateClient';
import { assetClient } from '../../clients/assetClient';
import type { Asset, Character, Project } from '../../clients/domainTypes';
import { GenerationWorkbench } from '../generation/GenerationWorkbench';
import { VisualImageCandidatePanel } from './VisualImageCandidatePanel';
import { PanoramaViewer } from '../bible/PanoramaViewer';
import { adoptVisualImageCandidate, createVisualImageCandidate, rejectVisualImageCandidate, upsertVisualImageCandidate, visualImageCandidateSourceContentHash, buildImageVisualStyleProjection, buildAssetImagePrompt, buildMultiViewImagePrompt } from '../../clients/productionVisualImageClient';

/** Source/concept media stays separate from production boards and clean references. */
export function AssetSourceMedia({ project, owner, character }: { project: Project; owner: Character | Asset; character: boolean }) {
  const [generating, setGenerating] = useState<{ kind: 'base' | 'multiview'; sourceHash: string; prompt: string }>();
  const [panorama, setPanorama] = useState(false);
  const [busy, setBusy] = useState(false);
  const getOwner = () => { const current = useProjectStore.getState().currentProject; if (current?.id !== project.id) throw new Error('项目已切换，原结果未覆盖。'); const value = (character ? current.characters : current.assets).find(a => a.id === owner.id); if (!value) throw new Error('资产已变化，请刷新核对。'); return { current, value }; };
  const update = async (patch: Record<string, unknown>) => {
    const { current } = getOwner();
    await useProjectStore.getState().updateProject(character ? { characters: current.characters.map(a => a.id === owner.id ? { ...a, ...patch } : a) } : { assets: current.assets.map(a => a.id === owner.id ? { ...a, ...patch } : a) }, { expectedProjectId: project.id });
    await flushDebouncedProjectSave(project.id);
  };
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : '保存失败'); } finally { setBusy(false); } };
  const record = owner as unknown as Record<string, any>;
  const fields = [{ key: character ? 'referenceImageUrl' : 'imageUrl', label: '基础概念图', kind: 'base' as const }, { key: 'multiViewUrl', label: '多视图资料', kind: 'multiview' as const }, ...(!character && (owner as Asset).type === 'location' ? [{ key: 'panoramaUrl', label: '环绕全景图', kind: undefined }] : [])];
  const identityReference = record.defaultReferenceUrl || record.referenceImageUrl || record.imageUrl || record.cleanReferenceImageUrl || record.multiViewUrl;
  if (generating) return <GenerationWorkbench target={{ projectId: project.id, kind: 'scratch', scratchId: `asset-source:${owner.id}:${generating.kind}:${generating.sourceHash}`, shotIds: [] }} operation="asset_image" initialPrompt={generating.prompt} initialReferences={generating.kind === 'multiview' && identityReference ? [{ url: identityReference, label: owner.name, role: character ? 'character_identity' : record.type === 'location' ? 'environment' : 'prop_identity' }] : []} returnLabel="返回资产原始资料" onClose={() => setGenerating(undefined)} onUseResult={(url, source) => void run(async () => {
    const { value } = getOwner();
    const candidate = createVisualImageCandidate({ kind: generating.kind, imageUrl: url, prompt: source.prompt, modelId: source.modelId, generationPlan: source.plan, sourceContentHash: generating.sourceHash });
    await update({ visualImageCandidates: upsertVisualImageCandidate(value.visualImageCandidates, candidate) }); setGenerating(undefined);
  })} />;
  return <section className="space-y-5">
    <p className="text-sm leading-6 text-text-secondary">概念图、多视图和全景属于原始资料。它们不会自动覆盖制作板或纯净参考；正式制作参考在“参考板”中采用。</p>
    <div className="grid grid-cols-3 gap-5">{fields.map(({ key, label, kind }) => <div key={key} className="space-y-3"><h3 className="text-sm font-semibold">{label}</h3>{record[key] ? <img src={record[key]} alt={label} className="aspect-video w-full bg-bg-surface-soft object-contain" /> : <p className="flex aspect-video items-center justify-center bg-bg-surface-soft text-xs text-text-muted">尚无资料</p>}<label className="block text-xs">上传图片<input type="file" accept="image/*" disabled={busy} className="mt-2 block w-full" onChange={e => { const file = e.target.files?.[0]; if (file) void run(async () => { const { url } = await assetClient.uploadFile(file, project.id); const { value } = getOwner(); await update({ [key]: url, ...(!value.defaultReferenceUrl ? { defaultReferenceUrl: url } : {}) }); }); }} /></label>{kind && <button disabled={busy} className="text-xs text-gold" onClick={() => { try {
        const style = buildImageVisualStyleProjection({ project, intent: 'asset_identity', assetOverride: owner.visualOverride });
        const build = kind === 'multiview' ? buildMultiViewImagePrompt : buildAssetImagePrompt;
        const prompt = build({ assetType: character ? 'character' : record.type === 'location' ? 'location' : 'prop', assetName: owner.name, description: [character ? (owner as Character).visualIdentity : (owner as Asset).description, kind === 'multiview' ? record.multiViewPrompt : record.prompt].filter(Boolean).join('\n'), visualStyle: style.instruction });
        setGenerating({ kind, prompt, sourceHash: visualImageCandidateSourceContentHash({ owner, kind, visualStyleLock: project.visualStyleLock }) });
      } catch (e) { toast.error(e instanceof Error ? e.message : '视觉要求尚未准备好'); } }}>生成候选</button>}{key === 'panoramaUrl' && <><p className="text-xs text-text-muted">环绕预览需要 2:1 等距柱状全景图；未声明该能力的模型不提交生成。</p>{record.panoramaUrl && <button className="text-xs text-gold" onClick={() => setPanorama(v => !v)}>开关环绕预览</button>}</>}</div>)}</div>
    {panorama && record.panoramaUrl && <div className="h-96"><PanoramaViewer imageUrl={record.panoramaUrl} /></div>}
    <div className="grid grid-cols-2 gap-4">{['multiViewPrompt', ...(!character && (owner as Asset).type === 'location' ? ['panoramaPrompt'] : [])].map(key => <label className="text-xs" key={key}>{key === 'multiViewPrompt' ? '多视图要求' : '全景要求'}<textarea key={`${owner.id}:${key}`} defaultValue={record[key] || ''} className="mt-2 w-full rounded-md border border-border-soft bg-bg-surface p-3 text-sm" onBlur={e => { if (e.target.value !== (record[key] || '')) void run(() => update({ [key]: e.target.value })); }} /></label>)}</div>
    <VisualImageCandidatePanel candidates={owner.visualImageCandidates} owner={owner} visualStyleLock={project.visualStyleLock} onAdopt={id => void run(() => { const { value } = getOwner(); return update({ ...adoptVisualImageCandidate(value, id, Date.now(), project.visualStyleLock) }); })} onReject={id => void run(() => { const { value } = getOwner(); return update({ ...rejectVisualImageCandidate(value, id) }); })} />
    {!!owner.variants?.length && <label className="block text-xs">默认状态参考<select className="mt-2 rounded-md border border-border-soft bg-bg-surface p-2" value={owner.defaultVariantId || ''} onChange={e => { const variant = owner.variants?.find(v => v.id === e.target.value); void run(() => update({ defaultVariantId: variant?.id, defaultReferenceUrl: variant?.imageUrl || (character ? (owner as Character).referenceImageUrl : (owner as Asset).imageUrl) })); }}><option value="">基础身份</option>{owner.variants.map(v => <option key={v.id} value={v.id} disabled={!v.imageUrl}>{v.name}{v.imageUrl ? '' : '（尚无图片）'}</option>)}</select></label>}
  </section>;
}
