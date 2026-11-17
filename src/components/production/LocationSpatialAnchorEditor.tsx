import type { Asset, LocationSpatialAnchor, LocationView } from '../../clients/domainTypes';
import { locationSpatialAnchor, locationViewLabels } from '../../clients/productionAssetWorkflowClient';
import { DebouncedInput, DebouncedTextarea } from '../ui/DebouncedInputs';

export function LocationSpatialAnchorEditor({ asset, variantId, view, onChange }: {
  asset: Asset; variantId?: string; view: LocationView; onChange: (asset: Asset) => void;
}) {
  const owner = variantId ? asset.variants?.find(v => v.id === variantId) : asset;
  const effective = locationSpatialAnchor(asset, variantId);
  const update = (patch: Partial<LocationSpatialAnchor>) => {
    const locationSpatialAnchor = { ...owner?.locationSpatialAnchor, ...patch };
    onChange(variantId ? { ...asset, variants: asset.variants?.map(v => v.id === variantId ? { ...v, locationSpatialAnchor } : v) } : { ...asset, locationSpatialAnchor });
  };
  const camera = (key: LocationView, field: 'position' | 'lookAt', value: string) => update({ cameras: {
    ...owner?.locationSpatialAnchor?.cameras,
    [key]: { ...effective.cameras[key], [field]: value },
  } });
  const fieldClass = 'mt-1 w-full rounded-md border border-border-soft/40 bg-bg-primary px-2 py-1.5 text-xs text-text-primary';
  return <details className="mb-3 text-xs text-text-secondary" aria-label="场景空间方位基准">
    <summary className="cursor-pointer font-bold">空间方位基准 · {effective.layout || Object.values(effective.cameras).some(c => c.position || c.lookAt) ? '已填写，可编辑' : '可选，建议先确定'}</summary>
    <p className="my-2 leading-5 text-text-muted">可约定东南西北，也可用门侧、窗侧等固定地标。分别说明摄影机在哪里、朝哪里看，不用画面左右代替空间方向。{variantId ? '当前状态继承基础方位，可在这里覆盖。' : '本场景各视角共用这份基准。'}</p>
    <label className="block">固定空间关系<DebouncedTextarea className={fieldClass} value={effective.layout || ''} onChange={layout => update({ layout })} placeholder="例如：北墙是书柜，东墙有窗，西墙是入口；长桌靠北墙。" /></label>
    {[...new Set<LocationView>(['main', view])].map(key => <div key={key} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label>{locationViewLabels[key]} · 摄影机位置<DebouncedInput className={fieldClass} value={effective.cameras[key].position || ''} onChange={value => camera(key, 'position', value)} placeholder={key === 'main' ? '例如：房间南侧，平视' : '例如：东北角，平视'} /></label>
      <label>{locationViewLabels[key]} · 朝向 / 拍摄目标<DebouncedInput className={fieldClass} value={effective.cameras[key].lookAt || ''} onChange={value => camera(key, 'lookAt', value)} placeholder={key === 'main' ? '例如：朝北墙书柜' : '例如：朝西南，覆盖西侧入口'} /></label>
    </div>)}
    <p className="mt-2 leading-5 text-text-muted">方位只提供约束，仍需看图核对门窗和家具。修改基准后相关旧视角会提示复核，图片会保留。</p>
  </details>;
}
