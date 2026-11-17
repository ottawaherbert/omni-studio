import { useState } from 'react';
import toast from 'react-hot-toast';
import { useGlobalStore } from '../../clients/stateClient';
import { assetClient } from '../../clients/assetClient';
import { GenerationWorkbench } from '../generation/GenerationWorkbench';
import { GLOBAL_GENERATION_SCOPE } from '../../../packages/domain/src/generation';
import { VisualImageCandidatePanel } from '../production/VisualImageCandidatePanel';
import { adoptGlobalVisualImageCandidate, createVisualImageCandidate, rejectVisualImageCandidate, upsertVisualImageCandidate, visualImageCandidateSourceContentHash } from '../../clients/productionVisualImageClient';
import { PanoramaViewer } from './PanoramaViewer';
import type { AssetVariant } from '../../clients/domainTypes';

const field = 'mt-1 w-full rounded-md border border-border-soft bg-bg-surface px-3 py-2 text-sm';
export function GlobalAssetDetailView({ assetId, onBack }: { assetId: string; onBack: () => void }) {
  const { globalAssets, updateGlobalAsset, deleteGlobalAsset } = useGlobalStore();
  const asset = globalAssets.find(a => a.id === assetId) as (typeof globalAssets[number] & Record<string, any>) | undefined;
  const [generationSource, setGenerationSource] = useState<string>();
  const [panorama, setPanorama] = useState(false);
  const update = (patch: Record<string, unknown>) => { if (useGlobalStore.getState().globalAssets.some(a => a.id === assetId)) updateGlobalAsset(assetId, patch); };
  if (!asset) return <button onClick={onBack}>资产已不存在，返回列表</button>;
  const variants: AssetVariant[] = asset.variants || [];
  const upload = async (file: File, variantId?: string) => {
    try {
      const { url } = await assetClient.uploadFile(file);
      const current = useGlobalStore.getState().globalAssets.find(a => a.id === assetId) as typeof asset;
      if (!current) return;
      update(variantId ? { variants: (current.variants || []).map((v: AssetVariant) => v.id === variantId ? { ...v, imageUrl: url } : v) } : { imageUrls: [url, ...current.imageUrls.filter(u => u !== url)], defaultReferenceUrl: current.defaultReferenceUrl || url });
    } catch (e) { toast.error(e instanceof Error ? e.message : '上传失败'); }
  };
  if (generationSource) return <GenerationWorkbench target={{ projectId: GLOBAL_GENERATION_SCOPE, kind: 'scratch', scratchId: `global-asset:${assetId}:${generationSource}`, shotIds: [] }} operation="asset_image" initialPrompt={asset.prompt || asset.description || asset.name} returnLabel="返回全局资产" onClose={() => setGenerationSource(undefined)} onUseResult={(url, source) => {
    const current = useGlobalStore.getState().globalAssets.find(a => a.id === assetId);
    if (current) update({ visualImageCandidates: upsertVisualImageCandidate(current.visualImageCandidates, createVisualImageCandidate({ kind: 'base', imageUrl: url, prompt: source.prompt, modelId: source.modelId, generationPlan: source.plan, sourceContentHash: generationSource })) });
    setGenerationSource(undefined);
  }} />;
  return <section className="space-y-6 text-text-primary">
    <header className="flex items-center justify-between"><button className="text-sm text-text-secondary" onClick={onBack}>返回全局资产</button><button className="text-xs text-red-500" onClick={() => { if (window.confirm(`删除全局资产“${asset.name}”？已导入项目的副本保持不变。`)) { deleteGlobalAsset(assetId); onBack(); } }}>删除资产</button></header>
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-8">
      <div>{asset.imageUrls[0] ? <img src={asset.imageUrls[0]} alt={asset.name} className="aspect-video w-full bg-bg-surface-soft object-contain" /> : <div className="flex aspect-video items-center justify-center bg-bg-surface-soft text-sm text-text-muted">尚无基础图片</div>}<div className="mt-3 flex gap-3"><button className="btn-primary rounded-md px-3 py-2 text-xs" onClick={() => setGenerationSource(visualImageCandidateSourceContentHash({ owner: asset, kind: 'base' }))}>生成基础形象候选</button><label className="rounded-md border border-border-soft px-3 py-2 text-xs">上传基础图<input type="file" className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); }} /></label></div>{asset.imageUrls.length > 1 && <details className="mt-4 text-xs"><summary>历史基础图片 · {asset.imageUrls.length}</summary><div className="mt-2 flex gap-2 overflow-auto">{asset.imageUrls.map(url => <button key={url} onClick={() => update({ imageUrls: [url, ...asset.imageUrls.filter(u => u !== url)] })}><img src={url} alt="恢复此版本" className="h-24 max-w-40 object-contain" /></button>)}</div></details>}</div>
      <div className="space-y-4"><label className="block text-xs">名称<input className={field} value={asset.name} onChange={e => update({ name: e.target.value })} /></label><label className="block text-xs">描述<textarea rows={4} className={field} value={asset.description} onChange={e => update({ description: e.target.value })} /></label><label className="block text-xs">图像要求<textarea rows={4} className={field} value={asset.prompt || ''} onChange={e => update({ prompt: e.target.value })} /></label>{['bgm', 'sfx'].includes(asset.type) && <label className="block text-xs">音频地址<input className={field} value={asset.url || ''} onChange={e => update({ url: e.target.value })} />{asset.url && <audio controls src={asset.url} className="mt-2 w-full" />}</label>}</div>
    </div>
    {asset.type === 'character' && <details className="border-t border-border-soft pt-4 text-xs"><summary>角色背景与动机</summary><div className="mt-4 grid grid-cols-2 gap-4">{[['internalDesire', '内在渴望'], ['externalGoal', '外部目标'], ['flaw', '性格弱点'], ['psychologicalProfile', '心理画像']].map(([key, label]) => <label key={key}>{label}<textarea className={field} value={asset[key] || ''} onChange={e => update({ [key]: e.target.value })} /></label>)}</div></details>}
    <VisualImageCandidatePanel candidates={asset.visualImageCandidates} owner={asset} onAdopt={id => { const current = useGlobalStore.getState().globalAssets.find(a => a.id === assetId); if (current) update({ ...adoptGlobalVisualImageCandidate(current, id) }); }} onReject={id => { const current = useGlobalStore.getState().globalAssets.find(a => a.id === assetId); if (current) update({ ...rejectVisualImageCandidate(current, id) }); }} />
    <details className="border-t border-border-soft pt-4 text-xs"><summary>全景与多视图资料</summary><div className="mt-4 grid grid-cols-2 gap-4">{[['panoramaUrl', 'panoramaPrompt', '全景'], ['multiViewUrl', 'multiViewPrompt', '多视图']].map(([url, prompt, label]) => <div key={url}><label>{label}地址<input className={field} value={asset[url] || ''} onChange={e => update({ [url]: e.target.value })} /></label>{asset[url] && <img src={asset[url]} alt={label} className="mt-2 max-h-56 w-full object-contain" />}<textarea aria-label={`${label}要求`} className={field} value={asset[prompt] || ''} onChange={e => update({ [prompt]: e.target.value })} /></div>)}</div>{asset.panoramaUrl && <button className="mt-3 text-gold" onClick={() => setPanorama(v => !v)}>{panorama ? '关闭环绕预览' : '环绕预览'}</button>}{panorama && <div className="mt-3 h-96"><PanoramaViewer imageUrl={asset.panoramaUrl} /></div>}</details>
    <details className="border-t border-border-soft pt-4 text-xs"><summary>状态变体 · {variants.length}</summary><button className="my-4 text-gold" onClick={() => update({ variants: [...variants, { id: crypto.randomUUID(), name: '新状态', description: '', promptModifiers: '' }] })}>添加状态</button><div className="grid grid-cols-3 gap-5">{variants.map(v => <div key={v.id} className="space-y-2"><input aria-label="状态名称" className={field} value={v.name} onChange={e => update({ variants: variants.map(x => x.id === v.id ? { ...x, name: e.target.value } : x) })} /><textarea aria-label="状态描述" className={field} value={v.description} onChange={e => update({ variants: variants.map(x => x.id === v.id ? { ...x, description: e.target.value } : x) })} />{v.imageUrl && <img src={v.imageUrl} alt={v.name} className="aspect-video object-contain" />}<input type="file" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f, v.id); }} /><button className="mr-3 text-gold" disabled={!v.imageUrl} onClick={() => update({ defaultVariantId: v.id, defaultReferenceUrl: v.imageUrl })}>{asset.defaultVariantId === v.id ? '默认参考' : '设为参考'}</button><button onClick={() => { if (window.confirm(`删除状态“${v.name}”？`)) update({ variants: variants.filter(x => x.id !== v.id), ...(asset.defaultVariantId === v.id ? { defaultVariantId: undefined, defaultReferenceUrl: asset.imageUrls[0] } : {}) }); }}>删除状态</button></div>)}</div><p className="mt-3 text-text-muted">全局变体支持资料与图片上传；在具体项目内生成带剧情状态的制作参考。</p></details>
  </section>;
}
