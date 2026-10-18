import type { Asset, Character, Project } from '../../types/project';
import { collectProjectAssetsForContext } from '../../utils/projectAssetContext';
import { buildProductionAssetVisualStyleProjection } from './productionAssetVisualStyle';
import { renderProductionCreativeContext } from '../../../packages/production/src/services/production/creativeDirection';

/** A shipped registration note is not a visual description. Keep author prose intact. */
export const ASSET_REGISTRATION_PLACEHOLDER = '从已采用的制片场次拆解登记；基础视觉身份待在资产确认中补全。';
export const assetDesignText = (value?: string) => value?.trim() === ASSET_REGISTRATION_PLACEHOLDER ? '' : value?.trim() || '';
export const assetDesignOwner = (project: Project, assetId: string) => project.characters.find(c => c.id === assetId) || project.assets.find(a => a.id === assetId);
export const assetVisualDescription = (owner?: Character | Asset) => assetDesignText(owner && ('type' in owner ? owner.description : owner.visualIdentity));
export const assetIdentityReference = (owner?: Character | Asset) => owner?.cleanReferenceImageUrl || owner?.boardImageUrl || owner?.defaultReferenceUrl || owner?.multiViewUrl || (owner && ('type' in owner ? owner.imageUrl || owner.panoramaUrl : owner.referenceImageUrl));
export const assetNeedsVisualDesign = (project: Project, assetId: string) => {
  const owner = assetDesignOwner(project, assetId);
  return owner ? !assetVisualDescription(owner) && !assetIdentityReference(owner) : true;
};
export const missingAssetDesignIds = (project: Project, assetIds: string[]) => [...new Set(assetIds)].filter(id => assetNeedsVisualDesign(project, id));

export const assetDesignTaskInstruction = (kind: 'character' | 'location' | 'prop', visualStyle = '') => [
  `【本次设计采用的画风】\n${visualStyle.trim() || '未指定画风，不从历史外观、参考图或其他资产中自动恢复旧画风。'}`,
  '本次设计此资产跨集复用的基础形象，只返回一份可编辑的完整外观候选。先提取所选原文明确的外观，再补足没有规定的外观细节。保留已有身份特征和作者明确设定；已有参考图用于锁定身份，不能因为进入新一集就重新设计。若新原文与现有外观冲突，在 sourceNotes 说明原文及冲突，不静默覆盖已有设计。',
  '画风以本次设计采用的画风为准。已有外观、角色档案、参考图、项目早期创作方向及其他已定形象可能带有旧画风，只借用其中的身份和造型依据，不继承与当前画风冲突的绘画、摄影或渲染要求。保留年龄、五官、发型、服装形制、配色、材质、物件结构和空间关系；切换画风不代表改变故事时代或把科技装备改成古装。不能把这些具体设定当作旧画风删除。',
  kind === 'character'
    ? 'visualIdentity 写清视觉年龄、体型比例、脸型五官、肤色、发型、基础服装的形制/颜色/材质以及辨识特征；结合已定角色保持统一的时代与美术方向，并避免人人同一张脸、体型和衣服。不能从人格、善恶、职业或姓名机械推断外貌。'
    : kind === 'location'
      ? 'description 写清空间尺度、平面布局、入口出口、建筑形制、固定陈设、主要材质和色彩。区别于项目其他场景，保留明确的空间关系。'
      : 'description 写清轮廓、尺寸比例、结构部件、颜色材质、表面纹理、铭文标记与辨识细节。不能将物件功能解释或剧情用途当作外观。',
  '只设计一个一致、具体的方案，不列多个备选，不用“待定”等占位。单场换装、伤势、泥污、天气、摆位和持有者不进入基础外观。所有外观文字必须可直接用于生图，只写可见内容；画风名称、参考影视作品名及摄影/渲染要求由独立画风设置提供，不固化进外观字段。输出整理后的完整外观，不只返回新增片段，也不逐字拼接旧描述。剧情、推断过程、原文出处以及“候选设计”等来源标签全部写 sourceNotes，不写进外观字段。sourceNotes 分清原文事实、作者已有设定、此次设计补充、移除的旧画风表述及待核对冲突。',
  `只返回 JSON：${kind === 'character' ? 'visualIdentity' : 'description'}（完整的纯视觉描述）与 sourceNotes（依据和设计说明）。不返回姓名、心理、目标、人格、标签或其他字段。`,
].join('\n');

export const assetDesignContext = (project: Project, owner: Character | Asset) => {
  const kind = "type" in owner ? owner.type === "location" ? "location" : "prop" : "character";
  const directorReference = renderProductionCreativeContext(project, {}, `asset_${kind}`, false);
  const { projection, rendered } = buildProductionAssetVisualStyleProjection({ project, asset: { assetId: owner.id, assetType: 'type' in owner ? owner.type === 'location' ? 'location' : 'prop' : 'character', assetName: owner.name } });
  return {
    visualStyle: projection.stylePrompt !== undefined ? projection.stylePrompt.trim()
      : rendered.blocks.filter(block => block.id !== 'visual.artifact' && block.id !== 'visual.directives'
        && (block.id !== 'visual.treatment' || Object.values(projection.treatment).some(value => value?.length))).map(block => block.content).join('\n\n'),
    existingVisualDescriptionUsage: '以下为已保存的外观参考，可能含旧画风。保留具体身份和造型特征；其中的画风表述不作为本次画风要求，也不写回新外观。',
    existingVisualDescription: assetVisualDescription(owner),
    referenceImageProvided: Boolean(assetIdentityReference(owner)),
    sourceFacts: owner.visualFacts || [],
    ...(directorReference ? {
      directorReference,
      directorPolicy: '仅从导演参考中采用与此资产未定外观有关的空间组织、功能轮廓、结构和材质呈现建议。不要采用镜头剪辑、剧情、人格或声音要求，不改变正式功能、具体身份特征和当前画风。依据和取舍写 sourceNotes；最终外观只写可见结果。',
    } : {}),
    planningBrief: [...(project.plannedCharacters || []), ...(project.plannedLocations || []), ...(project.plannedProps || [])]
      .find(item => item.id === owner.id || item.name === owner.name)?.brief || '',
    otherAdoptedDesigns: [...project.characters, ...project.assets.filter(a => a.type !== 'character')]
      .filter(a => a.id !== owner.id && assetVisualDescription(a))
      .map(a => ({ name: a.name, kind: 'type' in a ? a.type : 'character', appearance: assetVisualDescription(a) })),
  };
};

export function assetDesignProposal(raw: Record<string, unknown>, owner: Character | Asset) {
  const field = 'type' in owner ? 'description' : 'visualIdentity';
  const value = typeof raw[field] === 'string' ? assetDesignText(raw[field]) : '';
  if (!value) return {};
  // The model returns a complete candidate, reviewed against the saved original
  // before adoption. Prefixing the original would resurrect removed style text.
  return { [field]: value };
}

/** A planned asset selected for production becomes a project identity once, without treating its story brief as an image prompt. */
export function registerPlannedDesignTargets(project: Project, ids: string[]): Project {
  const characters = [...project.characters], assets = [...project.assets];
  for (const id of [...new Set(ids)]) {
    if (assetDesignOwner(project, id)) continue;
    const planned = (['character', 'location', 'prop'] as const).flatMap(kind => collectProjectAssetsForContext(project, kind)).find(a => a.id === id);
    if (!planned) throw new Error('待设计资产已不存在，请刷新资产列表');
    if (planned.type === 'character') characters.push({ id, name: planned.name });
    else assets.push({ id, name: planned.name, type: planned.type, description: '' });
  }
  return { ...project, characters, assets };
}
