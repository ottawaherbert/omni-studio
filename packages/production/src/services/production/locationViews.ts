import { sha256 } from 'js-sha256';
import type { Asset, AssetVariant, LocationSupplementaryView, LocationView, LocationViews, Project } from '../../../../../src/types/project';

export const LOCATION_VIEWS: LocationView[] = ['main', 'reverse', 'oblique', 'top'];
export const LOCATION_SUPPLEMENTARY_VIEWS: LocationSupplementaryView[] = ['reverse', 'oblique', 'top'];
export const locationViewLabels: Record<LocationView, string> = { main: '主视图', reverse: '反向平视图', oblique: '互补斜角全景', top: '顶视布局图' };
export const locationViewUsage = (view: LocationView) => view === 'top'
  ? '仅参考门窗、固定家具、通道与站位的平面关系；不是故事板、视频首帧或必须拍摄的镜头。按本镜机位生成画面，不复制顶视角。'
  : `同一场景的${locationViewLabels[view]}，用于空间、固定陈设、材质和光线参考；人物与动作按本镜要求。`;
const stable = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v) ?? 'null' : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
export const locationViewOwner = (asset: Asset, variantId?: string): Asset | AssetVariant | undefined => variantId ? asset.variants?.find(v => v.id === variantId) : asset;
export const locationSpatialAnchor = (asset: Asset, variantId?: string) => {
  const base = asset.locationSpatialAnchor;
  const local = variantId ? locationViewOwner(asset, variantId)?.locationSpatialAnchor : undefined;
  return { layout: local?.layout ?? base?.layout, cameras: Object.fromEntries(LOCATION_VIEWS.map(view => [view, { ...base?.cameras?.[view], ...local?.cameras?.[view] }])) };
};
export const renderLocationSpatialAnchor = (asset: Asset, view: LocationView = 'main', variantId?: string) => {
  const anchor = locationSpatialAnchor(asset, variantId);
  const cameras = [...new Set<LocationView>(['main', view])].flatMap(v => {
    const camera = anchor.cameras[v];
    return camera.position?.trim() || camera.lookAt?.trim() ? [`${locationViewLabels[v]}：摄影机位置=${camera.position?.trim() || '未指定'}；朝向/拍摄目标=${camera.lookAt?.trim() || '未指定'}。`] : [];
  });
  if (!anchor.layout?.trim() && !cameras.length) return '';
  return ['【场景空间锚点】', '以下方向采用本场统一约定，摄影机所在位置与朝向分开理解；画面左/右不等于固定东/西。', anchor.layout?.trim() ? `固定空间关系：${anchor.layout.trim()}` : '', ...cameras,
    '按已声明的门窗、固定陈设与通道核对空间；未展示区域不要擅自增设关键出入口。参考图的机位标记只说明输入图，故事镜头仍按本镜拍法。', '【场景空间锚点结束】'].filter(Boolean).join('\n');
};
export const stripLocationSpatialAnchor = (prompt: string) => prompt.replace(/\n*【场景空间锚点】[\s\S]*?【场景空间锚点结束】/g, '').trimEnd();
export const withLocationSpatialAnchor = (prompt: string, asset: Asset, view: LocationView = 'main', variantId?: string) => [stripLocationSpatialAnchor(prompt), renderLocationSpatialAnchor(asset, view, variantId)].filter(Boolean).join('\n\n');
export const locationMainImage = (asset: Asset, variantId?: string) => {
  const owner = locationViewOwner(asset, variantId);
  return owner?.cleanReferenceImageUrl || (variantId ? owner?.imageUrl : asset.panoramaUrl || asset.imageUrl || asset.defaultReferenceUrl) || owner?.boardImageUrl;
};
export const locationViewImage = (asset: Asset, view: LocationView, variantId?: string) => view === 'main' ? locationMainImage(asset, variantId) : locationViewOwner(asset, variantId)?.locationViews?.[view]?.imageUrl;
export const locationViewDependencies = (view: LocationSupplementaryView): LocationView[] => view === 'top' ? ['main', 'reverse', 'oblique'] : ['main'];
export const locationViewSourceHash = (project: Project, asset: Asset, view: LocationSupplementaryView, variantId?: string) => {
  const owner = locationViewOwner(asset, variantId);
  return sha256(stable({ version: 'location-views.v1', assetId: asset.id, name: asset.name, description: asset.description,
    visualFacts: asset.visualFacts, assetPrompt: asset.prompt, visualOverride: asset.visualOverride, creativeDirection: asset.creativeDirection,
    variant: variantId ? { id: variantId, description: owner?.description, promptModifiers: (owner as AssetVariant)?.promptModifiers, appearanceFields: (owner as AssetVariant)?.appearanceFields } : undefined,
    view, spatialAnchor: renderLocationSpatialAnchor(asset, view, variantId) || undefined, prompt: owner?.locationViews?.[view]?.prompt,
    sources: locationViewDependencies(view).map(v => ({ view: v, imageUrl: locationViewImage(asset, v, variantId), sourceHash: v === 'main' ? undefined : owner?.locationViews?.[v]?.sourceHash })),
    style: { visualStyleLock: project.visualStyleLock, creativeDirection: project.creativeDirection },
  }));
};
export const locationViewInputIssue = (project: Project, asset: Asset, view: LocationSupplementaryView, variantId?: string): string | undefined => {
  if (asset.type !== 'location' || !locationViewOwner(asset, variantId)) return '场景或状态变体已不存在。';
  for (const dependency of locationViewDependencies(view)) {
    if (!locationViewImage(asset, dependency, variantId)) return `请先完成并采用${locationViewLabels[dependency]}，再制作${locationViewLabels[view]}。`;
    if (dependency !== 'main') {
      const issue = locationViewCurrentIssue(project, asset, dependency, variantId);
      if (issue) return `${locationViewLabels[dependency]}需要复核：${issue}`;
    }
  }
};
export const locationViewCurrentIssue = (project: Project, asset: Asset, view: LocationSupplementaryView, variantId?: string): string | undefined => {
  const stored = locationViewOwner(asset, variantId)?.locationViews?.[view];
  if (!stored?.imageUrl) return `${locationViewLabels[view]}尚未采用。`;
  const issue = locationViewInputIssue(project, asset, view, variantId);
  if (issue) return issue;
  if (!stored.reviewedAt || stored.sourceHash !== locationViewSourceHash(project, asset, view, variantId)) return '主图、上游视角或场景设计已变化，请核对并重新采用此视角；旧图保留。';
};
export function updateLocationViews(asset: Asset, variantId: string | undefined, patch: LocationViews): Asset {
  if (asset.type !== 'location') throw new Error('只有场景资产支持空间视角。');
  const owner = locationViewOwner(asset, variantId);
  if (!owner) throw new Error('场景状态变体不存在。');
  const locationViews = { ...owner.locationViews, ...patch };
  return variantId ? { ...asset, variants: asset.variants?.map(v => v.id === variantId ? { ...v, locationViews } : v) } : { ...asset, locationViews };
}
const buildLocationViewCore = (asset: Asset, view: LocationSupplementaryView, variantId?: string) => {
  const owner = locationViewOwner(asset, variantId);
  if (owner?.locationViews?.[view]?.prompt?.trim()) return owner.locationViews[view]!.prompt!.trim();
  const direction = { reverse: '以主视图为场景母版，从相反方向平视回望同一空间，补齐原图未展示的一侧。改变摄影机方向，不镜像翻转原图。', oblique: '以主视图为场景母版，生成能与主图互补的四分之三斜角全景，清楚交代固定家具的远近关系、入口与通道。摄影机位置、朝向和高度以空间锚点为准；未设置时选择平视或略高的互补角度。', top: '同时参考主视图、反向平视图、互补斜角全景，生成同一空间90度垂直向下的顶视布局图，交代完整的门窗、家具与通道关系。移除遮挡布局的屋顶；不是另一处房间。' }[view];
  return [owner?.locationViews?.[view]?.prompt || direction, `场景：${asset.name}。${asset.description || ''}`, variantId ? `当前场景状态：${owner?.description || ''}。${(owner as AssetVariant)?.promptModifiers || ''}` : '',
    '输出单张完整空场图，不拼贴、不分格、不添加标题、水印、角色或剧情后段物件。保持参考图中的建筑结构、门窗、主要陈设、材质与光线基准；新补出的区域必须与已有空间衔接。',
    view === 'top' ? '本图用于后续分镜的空间布局参考，不是故事板或视频首帧。' : locationViewUsage(view)].filter(Boolean).join('\n');
};

export const buildLocationViewPrompt = (asset: Asset, view: LocationSupplementaryView, variantId?: string) => withLocationSpatialAnchor(buildLocationViewCore(asset, view, variantId), asset, view, variantId);
