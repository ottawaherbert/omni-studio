import assert from 'node:assert/strict';
import type { Project } from '../src/types/project';
import { assetNeedsVisualDesign, assetDesignProposal, assetVisualDescription, assetDesignTaskInstruction, assetDesignContext, registerPlannedDesignTargets, ASSET_REGISTRATION_PLACEHOLDER } from '../src/services/production/productionAssetDesign';
import { bindProductionBreakdownAssetsToCanonicalRegistry, normalizeProductionBreakdown, productionBreakdownCanonicalAssetContext } from '../src/services/production/manualSceneBreakdown';
import { buildVideoStoryboardAssetBoardPlan } from '../src/services/production/videoStoryboardAssetBoards';
import { buildProductionAssetBoardPromptPreview, buildProductionAssetBoardExecutionPlan, productionAssetBoardPromptCore } from '../src/services/production/productionAssetBoardExecution';
import { compileImageGenerationRequest } from '../src/services/production/imageGenerationRequest';
import { buildProductionAssetImageVisualStyleProjection } from '../src/services/production/imageVisualStyleProjection';
import { applyCreativeVisualBinding } from '../packages/production/src/services/production/creativeDirection';

const empty = { id: 'series', title: '两集测试', type: 'tv_series', characters: [], assets: [], episodes: [] } as unknown as Project;
const first = normalizeProductionBreakdown({ location: { name: '旧钟楼' }, characters: [{ name: '阿青' }], props: [{ name: '铜钥匙', requiresAsset: true }], assetVisualFacts: [
  { assetType: 'character', name: '阿青', description: '短发', evidence: '阿青剪着短发', scope: 'identity' },
  { assetType: 'character', name: '阿青', description: '衣袖湿透', evidence: '雨水打湿她的衣袖', scope: 'scene' },
] });
const registered = bindProductionBreakdownAssetsToCanonicalRegistry(empty, [{ sceneId: 'episode-1-scene-1', breakdown: first }]);
const project = { ...empty, characters: registered.characters, assets: registered.assets };
assert.equal(project.characters.length, 1); assert.equal(project.assets.length, 2);
assert.equal(project.characters[0].visualFacts?.length, 2);
assert.equal(project.characters[0].visualIdentity, undefined, 'source facts are not silently promoted to an adopted design');
for (const owner of [...project.characters, ...project.assets]) assert(assetNeedsVisualDesign(project, owner.id));
assert.equal(assetVisualDescription({ ...project.assets[0], description: ASSET_REGISTRATION_PLACEHOLDER }), '');
const designed = structuredClone(project);
designed.characters[0].visualIdentity = '二十多岁，短发，圆脸，身形结实，藏蓝棉布短外套';
designed.characters[0].cleanReferenceImageUrl = '/media/adopted-face.png';
designed.characters[0].variants = [{ id: 'winter-outfit', name: '冬装', description: '深灰厚棉外套', promptModifiers: '', imageUrl: '/media/winter.png' }];
designed.assets[0].description = '圆形石砌钟楼，北侧木门，青石地面';
designed.assets[1].description = '手掌长度的黄铜钥匙，圆环柄，三齿';
const oldSnapshot = JSON.stringify(designed);
const next = normalizeProductionBreakdown({ location: { name: '钟楼', assetId: designed.assets[0].id }, characters: [{ name: '小青', assetId: designed.characters[0].id }], props: [{ name: '那把铜钥匙', assetId: designed.assets[1].id }], assetVisualFacts: [
  { assetType: 'character', name: '小青', assetId: designed.characters[0].id, description: '左眉有细疤', evidence: '小青左眉的细疤', scope: 'identity' },
] });
const second = bindProductionBreakdownAssetsToCanonicalRegistry(designed, [{ sceneId: 'episode-2-scene-1', breakdown: next }]);
assert.deepEqual(second.createdCounts, { characters: 0, locations: 0, props: 0 });
assert.equal(second.characters[0].visualIdentity, designed.characters[0].visualIdentity);
assert.equal(second.characters[0].cleanReferenceImageUrl, '/media/adopted-face.png');
assert.deepEqual(second.characters[0].variants, designed.characters[0].variants);
assert(second.characters[0].aliases?.includes('小青'));
assert(second.characters[0].visualDesignNeedsReview, 'new evidence requests review instead of redesigning');
assert.equal(JSON.stringify(designed), oldSnapshot, 'adoption cannot mutate its input snapshot');
const thirdProject = { ...designed, characters: second.characters, assets: second.assets };
const third = bindProductionBreakdownAssetsToCanonicalRegistry(thirdProject, [{ sceneId: 'episode-3-scene-1', breakdown: normalizeProductionBreakdown({ characters: ['小青'], location: '钟楼', props: ['那把铜钥匙'] }) }]);
assert.deepEqual(third.createdCounts, { characters: 0, locations: 0, props: 0 }, 'adopted aliases are reusable in later episodes');
assert.equal(third.entries[0].breakdown.characterIds?.[0], designed.characters[0].id);
assert.throws(() => bindProductionBreakdownAssetsToCanonicalRegistry(designed, [{ sceneId: 'wrong', breakdown: normalizeProductionBreakdown({ characters: [{ name: '小青', assetId: 'another-project-id' }] }) }]), /不属于本项目/);
const context = productionBreakdownCanonicalAssetContext(thirdProject, { id: 'ep3', scenes: [] } as any);
assert(context.includes('winter-outfit') && context.includes('小青') && context.includes(designed.characters[0].id));
const completeCharacterDesign = `${designed.characters[0].visualIdentity}，左眉细疤`;
assert.deepEqual(assetDesignProposal({ visualIdentity: completeCharacterDesign, sourceNotes: '推断说明', psychologicalProfile: '沉默' }, designed.characters[0]), { visualIdentity: completeCharacterDesign });
const completeLocationDesign = `${designed.assets[0].description}，门上有铜钉`;
assert.deepEqual(assetDesignProposal({ description: completeLocationDesign, name: '改名', sourceNotes: '设计候选' }, designed.assets[0]), { description: completeLocationDesign });
assert(assetDesignTaskInstruction('character').includes('视觉年龄'));
const imageOnly = structuredClone(project); imageOnly.characters[0].cleanReferenceImageUrl = '/media/existing.png';
assert(!assetNeedsVisualDesign(imageOnly, imageOnly.characters[0].id), 'an adopted image can anchor identity without forcing a redesign');

// Changing style must not lock its old label into the identity or re-prefix it
// when the complete, style-independent candidate is reviewed and adopted.
const restyled = structuredClone(designed);
restyled.visualStyleLock = applyCreativeVisualBinding(undefined, { mode: 'replace', stylePrompt: '90年代香港武侠电影风格' });
for (const owner of [...restyled.characters, ...restyled.assets]) {
  const kind = 'type' in owner ? owner.type === 'location' ? 'location' : 'prop' : 'character';
  const identity = assetVisualDescription(owner);
  if ('type' in owner) owner.description = `写实科幻风格的${identity}`;
  else owner.visualIdentity = `写实科幻风格的${identity}`;
  const oldIdentity = assetVisualDescription(owner);
  const context = assetDesignContext(restyled, owner);
  assert.equal(context.visualStyle, '90年代香港武侠电影风格');
  assert.equal(context.existingVisualDescription, oldIdentity, 'the saved original remains available for identity comparison');
  assert.match(context.existingVisualDescriptionUsage, /旧画风/);
  const instruction = assetDesignTaskInstruction(kind, context.visualStyle);
  assert(instruction.startsWith('【本次设计采用的画风】\n90年代香港武侠电影风格'));
  assert.match(instruction, /不固化进外观字段/);
  const field = kind === 'character' ? 'visualIdentity' : 'description';
  const candidate = assetDesignProposal({ [field]: identity, name: '不允许改名', sourceNotes: '移除旧画风，保留具体形象' }, owner);
  assert.deepEqual(candidate, { [field]: identity }, 'old style is not automatically prepended to the complete candidate');
  assert.equal(assetVisualDescription(owner), oldIdentity, 'candidate generation does not modify the saved original');
  assert.deepEqual(assetDesignProposal({ [field]: '' }, owner), {}, 'an empty return cannot erase identity');
  Object.assign(owner, candidate); // Simulate the existing explicit candidate adoption.
}
const restyledBoards = buildVideoStoryboardAssetBoardPlan(restyled);
for (const board of [...restyledBoards.characterBoards, ...restyledBoards.sceneBoards, ...restyledBoards.propBoards]) {
  for (const mode of ['production_board', 'clean_reference'] as const) {
    const preview = buildProductionAssetBoardPromptPreview(restyled, board, mode);
    const actual = compileImageGenerationRequest({ promptCore: productionAssetBoardPromptCore(preview, restyled, board), visualStyleProjection: buildProductionAssetImageVisualStyleProjection({ project: restyled, asset: board }) });
    assert(actual.providerPrompt.includes('90年代香港武侠电影风格'));
    assert(!actual.providerPrompt.includes('写实科幻风格'));
  }
}
const local = restyled.characters[0];
local.creativeDirection = { visual: { mode: 'replace', stylePrompt: '黑白木刻' } };
assert.equal(assetDesignContext(restyled, local).visualStyle, '黑白木刻');
local.creativeDirection.visual = { mode: 'inherit' };
assert.equal(assetDesignContext(restyled, local).visualStyle, '90年代香港武侠电影风格');
local.creativeDirection.visual = { mode: 'replace', stylePrompt: '' };
assert.equal(assetDesignContext(restyled, local).visualStyle, '');
assert.match(assetDesignTaskInstruction('character', assetDesignContext(restyled, local).visualStyle), /未指定画风/);
local.creativeDirection.visual = { mode: 'off' };
assert.equal(assetDesignContext(restyled, local).visualStyle, '', 'disabled style does not revive the project or historical style');

const planned = { ...empty, plannedCharacters: [{ id: 'planned-q', name: '小桥', brief: '在第二集追回失物。' }], plannedLocations: [{ id: 'planned-t', name: '石塔', type: 'location', brief: '两人在此争执。' }], plannedProps: [{ id: 'planned-p', name: '玉簪', type: 'prop', brief: '打开机关。' }] } as Project;
const plannedIds = ['planned-q', 'planned-t', 'planned-p'];
const promoted = registerPlannedDesignTargets(planned, plannedIds);
assert.equal(promoted.characters.length, 1); assert.equal(promoted.assets.length, 2);
assert.deepEqual(registerPlannedDesignTargets(promoted, plannedIds), promoted, 'planned identities are registered once');
assert.equal(planned.characters.length, 0);
assert.equal(assetDesignContext(promoted, promoted.characters[0]).planningBrief, '在第二集追回失物。', 'planning information is available to the designer separately');
for (const item of [...promoted.characters, ...promoted.assets]) { assert.equal(assetVisualDescription(item), ''); assert(assetNeedsVisualDesign(promoted, item.id)); }
const plannedBoards = buildVideoStoryboardAssetBoardPlan(promoted);
for (const board of [...plannedBoards.characterBoards, ...plannedBoards.sceneBoards, ...plannedBoards.propBoards]) {
  assert(!/追回失物|在此争执|打开机关/.test(buildProductionAssetBoardPromptPreview(promoted, board, 'clean_reference')), 'story briefs do not enter image prompts');
}

// All modes and kinds preserve authored prompt edits and include the current visual description.
for (const owner of [...designed.characters, ...designed.assets]) {
  owner.boardPrompt = '作者版式：保留左侧主视图，右侧细节分区。';
  owner.cleanReferencePrompt = '作者纯净版式：四分区白底。';
}
const boardsPlan = buildVideoStoryboardAssetBoardPlan(designed);
const boards = [...boardsPlan.characterBoards, ...boardsPlan.sceneBoards, ...boardsPlan.propBoards];
const batch = buildProductionAssetBoardExecutionPlan(designed, boards);
for (const board of boards) {
  const owner = [...designed.characters, ...designed.assets].find(o => o.id === board.assetId)!;
  for (const mode of ['production_board', 'clean_reference'] as const) {
    const preview = buildProductionAssetBoardPromptPreview(designed, board, mode);
    assert(preview.includes(assetVisualDescription(owner)));
    assert(preview.includes(mode === 'production_board' ? '保留左侧主视图' : '四分区白底'));
    const actual = compileImageGenerationRequest({ promptCore: productionAssetBoardPromptCore(preview, designed, board), aspectRatio: '16:9' });
    assert(actual.providerPrompt.includes(assetVisualDescription(owner)));
    assert(!actual.providerPrompt.includes(ASSET_REGISTRATION_PLACEHOLDER));
    if (mode === 'production_board') assert.equal(batch.items.find(i => i.boardItemId === board.id)?.executionPrompt, productionAssetBoardPromptCore(preview, designed, board));
  }
}
console.log('Asset design flow passed: cross-episode identity/alias reuse, visual evidence, design protection, all asset types and prompt entry points.');
