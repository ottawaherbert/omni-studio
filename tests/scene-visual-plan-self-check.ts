import assert from 'node:assert/strict';
import { emptySceneVisualPlan, groupBreaks, overviewCell, resolveSceneOverviewPanelIndices, planSceneVideoGroups, renderSceneContinuityBasis, sceneReferencesForShots, sceneVisualReviewHash, validateSceneOverview } from '../src/services/production/sceneVisualPlan';
import { buildStoryboardUnitVideoPromptSourceHash, buildStoryboardUnitVideoPromptText } from '../src/services/production/storyboardUnitVideoPrompt';
import type { ManualStoryboardBoardWorkflow, Scene, Shot } from '../src/types/project';

const shots = [6, 4, 2, 2, 3, 1.5, 4, 3, 5].map((duration, i) => ({ id: `s${i}`, duration, videoPrompt: `动作${i}`, continuityNote: `状态${i}` } as Shot));
const original = structuredClone(shots);
const explicit = planSceneVideoGroups(shots, ['s2', 's5'], 5, 14);
assert.deepEqual(explicit.map(g => g.duration), [12, 6.5, 12]);
assert.deepEqual(explicit.flatMap(g => g.shotIds), shots.map(s => s.id));
assert.equal(explicit.flatMap(g => g.issues).length, 0);
assert.equal(planSceneVideoGroups(shots, [], 5, 14)[0].duration, 30.5);
assert.match(planSceneVideoGroups(shots, [], 5, 14)[0].issues.join(), /超过/);
assert.match(planSceneVideoGroups([{ id: 'long', duration: 15 } as Shot], undefined, 5, 14)[0].issues.join(), /拆镜/);
assert.match(planSceneVideoGroups([{ id: 'missing' } as Shot], undefined, 5, 14)[0].issues.join(), /有效时长/);
assert.match(planSceneVideoGroups([{ id: 'invalid', duration: NaN } as Shot], undefined, 5, 14)[0].issues.join(), /有效时长/);
assert.deepEqual(planSceneVideoGroups([6,6,4].map((duration, i) => ({ id: `a${i}`, duration } as Shot)), undefined, 5, 14).map(g => g.duration), [6,10]);
assert.deepEqual(shots, original, 'Planning must never speed up or rewrite shots');
const suggested = planSceneVideoGroups(shots, undefined, 5, 14);
assert.deepEqual(planSceneVideoGroups(shots, groupBreaks(suggested), 5, 14), suggested);
const overview = { imageUrl: '/media/grid.png', width: 1672, height: 941, columns: 3, rows: 3, shotIds: shots.map(s => s.id) };
validateSceneOverview(overview, shots);
assert.equal(overviewCell(overview, 's8')!.x + overviewCell(overview, 's8')!.width, 1672);
assert.equal(overviewCell(overview, 's8')!.y + overviewCell(overview, 's8')!.height, 941);
assert.equal(overviewCell(overview, 'foreign'), undefined);
assert.throws(() => validateSceneOverview({ ...overview, columns: 2 }, shots), /画格数/);
validateSceneOverview({ ...overview, shotIds: ['s0', 's0', 's1'] }, shots);
assert.throws(() => validateSceneOverview({ ...overview, shotIds: ['foreign'] }, shots), /不存在/);
const plan = { ...emptySceneVisualPlan(), geography: '左柱右门', exitState: '追兵已离场', references: [
  { id: 'room', imageUrl: '/media/room.png', role: 'space' as const, note: '地标' },
  { id: 'boundary', imageUrl: '/media/last.png', role: 'boundary' as const, note: '只沿用持剑状态', beforeShotId: 's3' },
] };
assert.deepEqual(sceneReferencesForShots(plan, ['s0']).map(r => r.id), ['room']);
assert.deepEqual(sceneReferencesForShots(plan, ['s3', 's4']).map(r => r.id), ['room', 'boundary']);
assert.match(renderSceneContinuityBasis(plan), /禁止提前画入/);
assert.doesNotMatch(renderSceneContinuityBasis(plan, ['s0']), /只沿用持剑状态/);
assert.match(renderSceneContinuityBasis(plan, ['s3']), /只沿用持剑状态/);
assert.equal(renderSceneContinuityBasis(emptySceneVisualPlan()), '');
const scene = { id: 'scene', shots, visualPlan: plan } as Scene;
const source = { id: 'source', visualPlan: { ...emptySceneVisualPlan(), exitState: '旧伤' } } as Scene;
assert.notEqual(sceneVisualReviewHash(scene, source), sceneVisualReviewHash(scene, { ...source, visualPlan: { ...source.visualPlan!, exitState: '新伤' } }));
assert.notEqual(sceneVisualReviewHash(scene), sceneVisualReviewHash({ ...scene, shots: shots.map((s, i) => i ? s : { ...s, duration: 8 }) }));
const workflow = { shotId: 's3', shotIds: ['s3', 's4'], board: { sceneId: 'actual-scene', continuityBasis: plan, panels: [], startState: '', endState: '' } } as unknown as ManualStoryboardBoardWorkflow;
const prompt = buildStoryboardUnitVideoPromptText({ workflow, shots });
assert.match(prompt, /actual-scene/);
assert.match(prompt, /前一镜头/);
assert.match(prompt, /状态2/);
assert.match(prompt, /状态5/);
assert.doesNotMatch(prompt, /current_scene/);
assert.notEqual(buildStoryboardUnitVideoPromptSourceHash({ workflow, shots }), buildStoryboardUnitVideoPromptSourceHash({ workflow, shots: shots.map(s => s.id === 's2' ? { ...s, continuityNote: '不同入组状态' } : s) }));
console.log('Scene planning, duration, crop mapping, reference scope, review invalidation and full-scene prompt regressions passed.');

const keyframes = { ...overview, shotIds: ['s0', 's0', 's1'] };
assert.throws(() => resolveSceneOverviewPanelIndices(keyframes, [{ id: 'p0', shotId: 's0' }], {}), /明确选择/);
assert.deepEqual(resolveSceneOverviewPanelIndices(keyframes, [{ id: 'p0', shotId: 's0' }, { id: 'p1', shotId: 's1' }], { p0: 1 }), [1, 2]);
assert.throws(() => resolveSceneOverviewPanelIndices(keyframes, [{ id: 'p0', shotId: 's0' }], { p0: 2 }), /明确选择/);

assert.deepEqual(planSceneVideoGroups([{id:"short",duration:0.4} as Shot], [], 5, 14)[0].issues, []);
const pacedShots=shots.map(s=>s.id=== "s3" ? {...s,motivation:"揭示变化",editingNote:"约2秒完成揭示后切反应"}:s);
assert.match(buildStoryboardUnitVideoPromptText({workflow,shots:pacedShots}), /约2秒完成揭示后切反应/);
assert.notEqual(buildStoryboardUnitVideoPromptSourceHash({workflow,shots}),buildStoryboardUnitVideoPromptSourceHash({workflow,shots:pacedShots}));
