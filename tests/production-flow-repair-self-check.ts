import assert from 'node:assert/strict';
import { productionTeamTemplates } from '../src/config/prompts/productionTeam';
import { scenePlanSourceContract, upgradeScenePlanSourceContract } from '../src/config/prompts/scenePlanSourceContract';
import { validateProductionScenePlanSource } from '../src/services/production/productionScenePlanProjection';
import { productionBreakdownAdoptionUpdates } from '../src/services/production/manualSceneBreakdown';
import { compileImageGenerationRequest } from '../src/services/production/imageGenerationRequest';
import { splitTimelineShot, splitTimelineAudio, trimTimelineShot } from '../src/utils/timelineEditing';
import { sceneVideoClips } from '../src/utils/sceneVideoClips';
import { adoptShotTake, reviseShotTakeAudio } from '../src/services/production/shotTakeReview';
import { buildSceneVideoExportItems, buildSceneStoryboardExportItems } from '../src/hooks/useEpisodeFilmExport';
import { buildManualStudioStoryboardTimeline } from '../src/services/production/manualStudioVideoIntent';
import type { Scene, Shot, AudioTrack, ManualStoryboardBoard } from '../src/types/project';

const first = '林岚把编号17的铜钥匙交给周宁，屏幕显示“请勿断电”。';
const second = '周宁独自走上站台，电话中传来林岚的声音。';
const source = `${first}\n\n${second}`;
const plan = [first, second].map(sourceEvidence => ({ sourceEvidence }));
assert.deepEqual(validateProductionScenePlanSource(source, plan), plan);
for (const candidate of [
  [{ sourceEvidence: first + '周宁拔枪抢走金条。' }], [plan[0]], [plan[1]],
  [plan[1], plan[0]], [plan[0], plan[0], plan[1]],
]) assert.throws(() => validateProductionScenePlanSource(source, candidate));
assert.deepEqual(validateProductionScenePlanSource(`${first}\n${first}`, [plan[0], plan[0]]), [plan[0], plan[0]], 'authored repeated text must remain repeated');
assert.throws(() => validateProductionScenePlanSource(`\n冷白天空下，楼阁消失。\n${source}`, plan), /第 1 场之前.*第 2 行起.*冷白天空下，楼阁消失。.*不能只摘录几句/);
assert.throws(() => validateProductionScenePlanSource(`${first}\n遗漏的动作。\n${second}`, plan), /第 2 场之前.*第 2 行起.*遗漏的动作/);
assert.throws(() => validateProductionScenePlanSource(`${source}\n黑场。`, plan), /剧本末尾.*第 4 行起.*黑场/);
assert.deepEqual(validateProductionScenePlanSource(`\r\n${first}\r\n\r\n${second}\r\n`, plan), plan, 'boundary whitespace alone is allowed');
for (const id of ['productionScenePlan', 'productionScenePlanOptimize']) {
  const template = productionTeamTemplates[id].template;
  assert.ok(template.includes(scenePlanSourceContract));
  assert.ok(!template.includes('"sourceEvidence": "从当前来源剧本摘取的原文片段"'));
  assert.equal(upgradeScenePlanSourceContract(template), template, 'upgrades must be idempotent');
}
const customTemplate = '作者要求保留长镜头。\n所有场次按原文顺序完整覆盖来源，不得遗漏、重复或改写；每个候选场次必须保留足够支撑后续场次拆解的 sourceEvidence 连续原文片段。\n"sourceEvidence": "从当前来源剧本摘取的原文片段"\n自定义结尾';
const upgraded = upgradeScenePlanSourceContract(customTemplate);
assert.ok(upgraded.startsWith('作者要求保留长镜头。\n'));
assert.ok(upgraded.endsWith('\n自定义结尾'));
assert.ok(upgraded.includes(scenePlanSourceContract));

const image = compileImageGenerationRequest({ promptCore: '保留屏幕文字“请勿断电”。', aspectRatio: '16:9' }, { enforcement: 'draft' });
assert.ok(image.providerPrompt.includes('请勿断电'));
assert.ok(!image.providerPrompt.includes('不添加装饰边框、UI、可读文字'));
const qa = { score: 84, verdict: 'revise', summary: '建议核对命名', issues: [] } as const;
const adopted = productionBreakdownAdoptionUpdates({ scene: { id: 's', script: source }, breakdown: { characters: [], props: [] }, prompt: '整理事实', qa } as any);
assert.equal(adopted.productionPreparation?.breakdown?.status, 'confirmed');
assert.equal(adopted.productionPreparation?.breakdown?.qa?.verdict, 'revise', 'author adoption must not falsify QA');

const shot: Shot = { id: 'a', duration: 10, videoUrl: '/media/take.mp4', sourceStartSeconds: 2, transition: 'fade' };
const cutTake = { ...shot, activeTakeId: 'original', takes: [{ id: 'original', videoUrl: shot.videoUrl, generationAudit: { action: 'import_video' } }] } as Shot;
const audioRevision = reviseShotTakeAudio(cutTake, 'original', { takeId: 'new-audio', videoUrl: '/media/new-audio.mp4', mode: 'strip', createdAt: 1 });
assert.equal(audioRevision.sourceStartSeconds, 2, 'changing only audio must preserve the video cut');
assert.equal(adoptShotTake({ ...cutTake, takes: [...cutTake.takes!, { id: 'different', videoUrl: '/media/different.mp4', createdAt: 2 }] }, 'different', 'video').sourceStartSeconds, 0, 'adopting a different source must reset the old cut');
const split = splitTimelineShot(shot, 4, 'b');
assert.deepEqual(split.map(s => [s.duration, s.sourceStartSeconds]), [[4, 2], [6, 6]]);
assert.equal(split[1].transition, 'none');
assert.equal(trimTimelineShot([shot], 0, 'left', 3)[0].sourceStartSeconds, 5);
assert.equal(trimTimelineShot([shot], 0, 'left', 3)[0].duration, 7);
const rolled = trimTimelineShot(split, 0, 'right', 5, true);
assert.deepEqual(rolled.map(s => [s.duration, s.sourceStartSeconds]), [[5, 2], [5, 7]]);
const track = { id: 'voice', type: 'dialogue', url: '/media/voice.wav', startTime: 1, sourceStartSeconds: 3, duration: 8 } as AudioTrack;
assert.deepEqual(splitTimelineAudio(track, 2, 'voice2').map(t => [t.startTime, t.duration, t.sourceStartSeconds]), [[1, 2, 3], [3, 6, 5]]);
assert.equal(buildSceneVideoExportItems({ shots: split } as Scene)[1].sourceStartSeconds, 6);
assert.equal(buildSceneVideoExportItems({ shots: split } as Scene)[0].transition, 'fade');
assert.equal(buildSceneStoryboardExportItems({ shots: [{ ...shot, imageUrl: '/media/frame.png' }] } as Scene)[0].transition, 'fade');

const scene = { shots: [{ id: 'a', duration: 4 }, { id: 'b', duration: 6 }], manualStoryboard: { boards: [{ unitSchema: 'storyboard_unit.v1', shotIds: ['a', 'b'], activeTakeId: 'take', takes: [{ id: 'take', videoUrl: '/media/unit.mp4' }], board: { panels: [{ shotId: 'a', durationSeconds: 4 }, { shotId: 'b', durationSeconds: 6 }] } }] } } as unknown as Scene;
assert.deepEqual(sceneVideoClips(scene).map(s => s.sourceStartSeconds), [0, 4]);
const unitClips = sceneVideoClips(scene);
assert.deepEqual(buildSceneVideoExportItems({ ...scene, shots: [...splitTimelineShot(unitClips[0], 1, 'inserted'), unitClips[1]] }).map(s => [s.sourceStartSeconds || 0, s.durationSeconds]), [[0, 1], [1, 3], [4, 6]], 'editing a unit must not duplicate or replay its whole take');
const mismatchedBoard = { panels: [{ shotId: 'a', durationSeconds: 1 }, { shotId: 'b', durationSeconds: 2 }] } as ManualStoryboardBoard;
assert.equal(buildManualStudioStoryboardTimeline(mismatchedBoard, scene.shots!).at(-1)?.endSeconds, 10, 'video prompt and edit timeline must agree on Shot duration');
console.log('Production flow repair checks passed: source coverage, authored repetition, final prompt, author adoption, trim/split source ranges, unit editing and duration agreement.');
