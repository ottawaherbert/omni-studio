import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Project, Episode, ManualFilmTeamPromptAudit, SimplePreparationKind } from '../src/types/project';
import { SIMPLE_PREPARATION_SECTIONS, readSimplePreparationPlan, normalizeSimplePreparationPlan, adoptSimplePreparationPlan, normalizeSimplePreparationReview, simplePreparationReady, simplePreparationFingerprint, simplePreparationBatches, mergeSimplePreparationReview } from '../src/services/production/simplePreparation';
import { buildManualFilmTeamReadModel } from '../src/services/production/manualFilmTeamReadModel';
import { buildProductionPreparationGate } from '../src/services/production/productionPreparationGate';
import { buildProductionAssetPreparationContext } from '../src/services/production/productionAssetPreparation';
import { manualFilmTeamSceneSource, manualFilmTeamScriptHash } from '../src/services/production/manualFilmTeam';
import { preparationStartTab } from '../src/features/production/preparation/productionPreparationViewModel';
import { simplePreparationTemplates } from '../src/config/prompts/simplePreparation';

const audit: ManualFilmTeamPromptAudit = { action: 'generate', templateId: 'productionSimplePlan', promptHash: 'test', selectedSkillIds: [], selectedSkillTitles: [], selectedContextIds: [], createdAt: 1 };
const project = { id: 'p', title: '简洁筹备验证', type: 'tv_series', characters: [{ id: 'c', name: '林岚' }], assets: [{ id: 'key', name: '铜钥匙', type: 'prop' }], episodes: [] } as unknown as Project;
let episode = { id: 'e', title: '第一集', scenes: [
  { id: 's1', title: '车站', script: '林岚把钥匙交给周宁。', breakdown: { characters: ['林岚', '周宁'], props: ['铜钥匙'], location: '车站', sfx: [], bgm: [] } },
  { id: 's2', title: '追逐', script: '周宁拿着铜钥匙跑向站台。', breakdown: { characters: ['周宁'], props: ['铜钥匙'], location: '站台', sfx: [], bgm: [] } },
] } as unknown as Episode;
episode.scenes.forEach(scene => { scene.productionPreparation = { breakdown: { status: 'confirmed', sourceHash: manualFilmTeamScriptHash(manualFilmTeamSceneSource(scene).text), updatedAt: 1 } } as any; });
project.episodes = [episode];
const raw = (kind: SimplePreparationKind, ids: string[]) => ({ shared: Object.fromEntries(Object.keys(SIMPLE_PREPARATION_SECTIONS[kind].fields).map(key => [key, ['建议：保持清晰的空间关系。']])), scenes: ids.map(sceneId => ({ sceneId, notes: Object.fromEntries(Object.keys(SIMPLE_PREPARATION_SECTIONS[kind].fields).map(key => [key, [sceneId === 's1' ? '原文：钥匙由林岚交给周宁。' : '原文：钥匙仍由周宁持有。']])), assetIds: ['key'] })), openQuestions: [] });
const normalize = (kind: SimplePreparationKind, ids: string[]) => normalizeSimplePreparationPlan(raw(kind, ids), kind, ids, ['c', 'key'], audit);

for (const malformed of [
  { ...raw('creative', ['s1']), scenes: [] },
  raw('creative', ['s1', 's1']), raw('creative', ['unknown']),
  { ...raw('creative', ['s1']), scenes: [{ ...raw('creative', ['s1']).scenes[0], assetIds: ['invented'] }] },
  { ...raw('creative', ['s1']), shared: { direction: 'not an array' } },
]) assert.throws(() => normalizeSimplePreparationPlan(malformed, 'creative', ['s1'], ['key'], audit));

episode = { ...episode, ...adoptSimplePreparationPlan(project, episode, normalize('creative', ['s1'])) };
assert.equal(episode.productionTeam?.outputs.length, 7, 'one combined call produces compatible directing/visual/sound and coordination fields');
assert.ok(episode.productionTeam?.outputs.every(output => output.qa === undefined), 'author adoption must not fabricate QA or scores');
assert.equal(simplePreparationReady(episode), false, 'partial generation cannot mark the episode complete');
const firstScene = structuredClone(episode.productionTeam!.outputs.find(output => output.department === 'directing')!.scenePlans![0]);
episode = { ...episode, ...adoptSimplePreparationPlan(project, episode, normalize('creative', ['s2'])) };
assert.deepEqual(episode.productionTeam!.outputs.find(output => output.department === 'directing')!.scenePlans![0], firstScene, 'next batch preserves prior scene decisions');
episode = { ...episode, ...adoptSimplePreparationPlan(project, episode, normalize('assets', ['s1', 's2'])) };
assert.equal(simplePreparationReady(episode), true);
assert.equal(episode.productionTeam!.outputs.length, 11, 'optional action does not need an empty generated report');
let model = buildManualFilmTeamReadModel({ project, episode });
assert.equal(model.coverage.length, 11);
assert.ok(model.coverage.every(row => row.readiness === 'ready'));
assert.equal(buildProductionPreparationGate({ scene: episode.scenes[0], filmTeam: model, assets: {} as any }).departmentsReady, true);
assert.equal(preparationStartTab(episode.scenes[1], episode), 'assets', 'running in source must not force the optional action workflow');
const downstream = buildProductionAssetPreparationContext(project, [episode]);
assert.equal(downstream.departmentOutputs.length, 11, 'adopted plans reach asset generation context');
assert.ok(downstream.departmentOutputs.some(output => output.department === 'wardrobe'));

episode = { ...episode, ...adoptSimplePreparationPlan(project, episode, normalize('action', ['s2'])) };
model = buildManualFilmTeamReadModel({ project, episode });
assert.equal(model.coverage.find(row => row.department === 'action_choreography')?.readiness, 'ready', 'optional action covers only the chosen scene');
const reviewRaw = { summary: '发现道具持有需要核对。', reviewedSceneIds: ['s1', 's2'], issues: [{ kind: 'assets', sceneIds: ['s2'], severity: 'warning', description: '需要核对钥匙归属', suggestion: '保持钥匙由周宁持有', sourceEvidence: '周宁拿着铜钥匙跑向站台。' }] };
const review = normalizeSimplePreparationReview(reviewRaw, episode, ['s1', 's2'], audit);
assert.equal(review.issues[0].kind, 'assets');
assert.throws(() => normalizeSimplePreparationReview({ ...reviewRaw, reviewedSceneIds: ['s1'] }, episode, ['s1', 's2'], audit));
assert.throws(() => normalizeSimplePreparationReview({ ...reviewRaw, issues: [{ ...reviewRaw.issues[0], sceneIds: ['other'] }] }, episode, ['s1', 's2'], audit));
episode.simplePreparation!.review = review;
const previousOutputs = structuredClone(episode.productionTeam!.outputs);
const revised = normalize('assets', ['s2']);
revised.scenes[0].notes.props = ['原文：铜钥匙仍由周宁持有；建议：保留持钥匙的手部动作。'];
revised.shared.props = ['不应通过局部修订替换整集道具基准'];
const previousShared = structuredClone(episode.simplePreparation!.plans.assets!.shared);
episode = { ...episode, ...adoptSimplePreparationPlan(project, episode, revised) };
assert.notEqual(simplePreparationFingerprint(episode), review.sourceFingerprint, 'changing a plan makes the previous comprehensive review stale');
assert.deepEqual(episode.simplePreparation!.plans.assets!.shared, previousShared, 'local repair must preserve shared direction');
for (const department of ['directing', 'sound_music', 'action_choreography']) assert.deepEqual(episode.productionTeam!.outputs.find(output => output.department === department), previousOutputs.find(output => output.department === department));
assert.deepEqual(episode.simplePreparation!.history.at(-1)!.outputs.find(output => output.department === 'props'), previousOutputs.find(output => output.department === 'props'), 'replaced authored data is archived');
assert.equal(episode.productionTeam!.outputs.find(output => output.department === 'props')!.scenePlans!.find(row => row.sceneId === 's1')!.summary, '原文：钥匙由林岚交给周宁。');
const recheck = normalizeSimplePreparationReview({ summary: '本场已检查。', reviewedSceneIds: ['s2'], issues: [] }, episode, ['s2'], audit);
assert.deepEqual(mergeSimplePreparationReview(episode, recheck).reviewedSceneIds, ['s2'], 'stale review coverage must not be carried forward as if rechecked');
assert.equal(buildManualFilmTeamReadModel({ project, episode: { ...episode, preparationMode: 'professional' } }).coverage.length, 12, 'professional mode remains available');

// Existing professional content must survive a first partial adoption in simple mode.
const legacy = structuredClone(episode);
delete legacy.simplePreparation;
legacy.productionTeam!.outputs.forEach(output => { delete output.preparationOrigin; output.content = `人工定调：${output.department}`; });
const legacyBefore = structuredClone(legacy.productionTeam!.outputs);
const legacyPatch = { ...legacy, ...adoptSimplePreparationPlan(project, legacy, normalize('assets', ['s2'])) };
for (const department of ['props', 'wardrobe', 'continuity', 'production_coordination']) {
  const before = legacyBefore.find(output => output.department === department)!;
  const after = legacyPatch.productionTeam!.outputs.find(output => output.department === department)!;
  assert.equal(after.content, before.content, 'partial adoption preserves professional shared decisions');
  assert.deepEqual(after.scenePlans!.find(row => row.sceneId === 's1'), before.scenePlans!.find(row => row.sceneId === 's1'), 'partial adoption must retain unrelated professional scene rows including coordination');
}
const edited = structuredClone(episode);
const props = edited.productionTeam!.outputs.find(output => output.department === 'props')!;
props.content = '专业模式修改的道具共同原则';
props.scenePlans![0].executionNotes = ['专业模式修改的第一场道具'];
assert.ok(readSimplePreparationPlan(edited, 'assets')!.shared.props.includes(props.content));
assert.ok(readSimplePreparationPlan(edited, 'assets')!.scenes[0].notes.props.includes('专业模式修改的第一场道具'), 'simple mode reads current adopted professional decisions');
episode.simplePreparation!.review!.issues.push({ ...review.issues[0], id: 'keep-s1', sceneIds: ['s1'] });
const merged = mergeSimplePreparationReview(episode, recheck);
assert.deepEqual(merged.reviewedSceneIds, ['s2']);
assert.equal(merged.issues.find(issue => issue.id === 'keep-s1')?.stale, true, 'a partial stale recheck cannot erase unresolved issues outside its scope');


const longEpisode = { ...episode, scenes: Array.from({ length: 36 }, (_, i) => ({ ...episode.scenes[0], id: `long-${i}` })) };
const batches = simplePreparationBatches(longEpisode);
assert.equal(batches.length, 3);
assert.deepEqual(batches.flat(), longEpisode.scenes.map(scene => scene.id));
assert.ok(!simplePreparationTemplates.productionSimplePlan.template.includes('85'));
console.log('Simple preparation checks passed: source coverage, references, batch preservation, downstream projection, optional action, localized repair, review freshness, legacy data history and single-call execution.');
