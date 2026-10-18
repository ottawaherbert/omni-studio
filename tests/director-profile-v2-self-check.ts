import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { directorProfileText, validateDirectorProfile, parseDirectorProfile, snapshotCreativeSkill, renderDirectorDirection, resolveCreativeRole, isGeneralSkill, type DirectorProfileV2 } from '../packages/domain/src/creativeDirection';
import { createSkillFile, readSkills, updateSkillFile } from '../src/server/routes/skillFileStore';
import { assetDesignContext } from '../src/services/production/productionAssetDesign';
import { renderProductionCreativeContext } from '../packages/production/src/services/production/creativeDirection';
import { normalizeDirectorPlan, validateDirectorShotEdits, reconcileDirectorAudioEdits } from '../packages/production/src/services/production/directorPlan';
import { compileImageGenerationRequest } from '../src/services/production/imageGenerationRequest';
import { buildImageVisualStyleProjection } from '../src/services/production/imageVisualStyleProjection';
import type { Project, Episode, Scene, Shot, AudioTrack } from '../src/types/project';
import { buildBgmGenerationPrompt } from '../src/services/production/manualStudioAudio';
import { mergeShotAuthorDraft } from '../src/services/production/manualStoryboard';

// Deliberately distinct instructions catch cross-department routing mistakes.
const profile: DirectorProfileV2 = { schemaVersion: 'director-profile.v2', principles: ['以人物理解组织观看'], methods: [
  { id: 'reveal', title: '反应带出揭示', priority: 'core', when: '人物察觉尚未揭示的威胁', purpose: '让观众跟随察觉过程', exceptions: ['已知威胁不重复首次揭示'], checks: ['揭示前能读到反应'], directions: {
    informationReveal: ['先局部后全貌'], performance: { physical: ['目光离开当前事务'], dialogueDelivery: ['句尾收住声音'] }, blocking: ['察觉者靠近窗边'], cinematography: { framing: ['让窗框形成尺度参照'], movement: ['缓慢向前推进'] }, editing: ['察觉之后再切全貌'], sound: { music: ['揭示前音乐留白'], effects: ['保留机械撞击声'] },
  } },
  { id: 'design', title: '功能可读的造型', priority: 'supporting', when: '设计尚未确认的外观', purpose: '保持功能与轮廓可读', exceptions: ['已有身份优先'], checks: [], directions: {
    productionDesign: { characterAppearance: ['服装轮廓便于区分群像'], locationSpace: ['入口与主要通道清楚可辨'], props: ['已有功能部件在造型中可辨认'], onSetUse: ['用现有桌椅组织对立站位'] },
  } },
], unclassified: ['未能归类的旧方法不可执行'], legacySource: '转换前原文不可执行' };
validateDirectorProfile(profile);
assert.deepEqual(parseDirectorProfile('```json\n' + JSON.stringify(profile) + '\n```'), profile);
assert.throws(() => parseDirectorProfile('{"error":"请补充作品年份"}'), /请补充作品年份/);
for (const bad of [
  { ...profile, methods: [profile.methods[0], profile.methods[0]] },
  { ...profile, methods: [{ ...profile.methods[0], directions: { unknownCamera: ['bad'] } }] },
  { ...profile, methods: [{ ...profile.methods[0], directions: { productionDesign: { everything: ['bad'] } } }] },
  { ...profile, methods: [{ ...profile.methods[0], directions: {} }] },
  { ...profile, methods: [] },
]) assert.throws(() => validateDirectorProfile(bad));
const skill = snapshotCreativeSkill({ id: 'v2', title: '测试导演', kind: 'director', revision: 2, content: '陈旧正文不得执行', profile: { director: profile }, source: 'manual', createdAt: 1, updatedAt: 1 });
const role = resolveCreativeRole([{ label: '全剧', bindings: { director: { mode: 'replace', skill, notes: '只在分镜规划使用的补充' } } }], 'director');
const project = { id: 'p', title: '测试项目', characters: [{ id: 'c', name: '阿青', visualIdentity: '短发灰衣' }], assets: [{ id: 'l', name: '房间', type: 'location', description: '灰墙与窗' }, { id: 'p1', name: '通信器', type: 'prop', description: '方形黑色' }], episodes: [], creativeDirection: { director: { mode: 'replace', skill } } } as unknown as Project;
const roleText = renderDirectorDirection(role, 'planning');
assert.ok(roleText.includes('Skill 标识：v2') && roleText.includes('方法 reveal'));
assert.ok(!roleText.includes(skill.content) && !roleText.includes(profile.legacySource!));
assert.ok(!roleText.includes(profile.unclassified![0]));
const character = assetDesignContext(project, project.characters[0]).directorReference;
const location = assetDesignContext(project, project.assets[0]).directorReference;
const prop = assetDesignContext(project, project.assets[1]).directorReference;
assert.ok(character.includes('服装轮廓') && !character.includes('通道') && !character.includes('功能部件'));
assert.ok(location.includes('通道') && !location.includes('服装轮廓'));
assert.ok(prop.includes('功能部件') && !prop.includes('通道'));
for (const text of [character, location, prop]) for (const excluded of ['反应带出揭示', '运镜', '音乐留白', '机械撞击', '桌椅组织', '句尾', '只在分镜']) assert.ok(!text.includes(excluded), excluded);
const noArt = { ...skill, profile: { director: { ...profile, methods: [profile.methods[0]] } } };
assert.equal(renderDirectorDirection({ ...role, skill: noArt }, 'asset_character'), '');
const noArtContext = assetDesignContext({ ...project, creativeDirection: { director: { mode: 'replace', skill: noArt } } }, project.characters[0]);
assert.ok(!('directorReference' in noArtContext) && !('directorPolicy' in noArtContext));
const changedMusic = structuredClone(project);
(changedMusic.creativeDirection!.director!.skill!.profile!.director as DirectorProfileV2).methods[0].directions.sound!.music = ['音乐规则改了'];
assert.equal(assetDesignContext(changedMusic, project.characters[0]).directorReference, character);
const legacy = { ...skill, profile: {}, content: '整篇旧版包含摄影音乐' };
assert.ok(renderDirectorDirection({ ...role, skill: legacy }, 'planning').includes(legacy.content));
for (const stage of ['asset', 'asset_character', 'image', 'video', 'performance', 'sound', 'music'] as const) assert.equal(renderDirectorDirection({ ...role, skill: legacy }, stage), '');
for (const scopes of [[], [{ label: '全剧', bindings: project.creativeDirection }, { label: '本场', bindings: { director: { mode: 'off' as const } } }]]) {
  assert.equal(renderDirectorDirection(resolveCreativeRole(scopes, 'director'), 'planning'), '');
}
assert.ok(isGeneralSkill({ kind: 'general' })); assert.ok(!isGeneralSkill(skill));
const shots = [{ id: 'sh', duration: 5, visualAction: '阿青停下并望向窗外', composition: '人物留在左侧，右侧窗框', cameraMovement: '固定', characterIdsInShot: ['c'], locationId: 'l', dialogueLines: [{ characterId: 'c', text: '到了。' }] }] as Shot[];
const arrivedMedia = { ...shots[0], imageUrl: '/media/new-image.png', takes: [{ id: 'new-take', imageUrl: '/media/new-image.png' }] } as Shot;
const authoredMerge = mergeShotAuthorDraft(shots[0], { ...shots[0], composition: '作者修改构图' }, arrivedMedia);
assert.equal(authoredMerge.shot.imageUrl, arrivedMedia.imageUrl); assert.deepEqual(authoredMerge.shot.takes, arrivedMedia.takes);
assert.deepEqual(authoredMerge.changedKeys, ['composition']);
assert.deepEqual(mergeShotAuthorDraft(shots[0], { ...arrivedMedia, composition: '作者修改构图' }, arrivedMedia).changedKeys, ['composition'], 'late media in the editor must not be classified as a manual shot-plan edit');
assert.throws(() => mergeShotAuthorDraft(shots[0], { ...shots[0], composition: '草稿构图' }, { ...shots[0], composition: '另一项操作修改了构图' }), /草稿仍保留/);
const scene = { id: 's', script: '阿青停下并望向窗外。阿青：到了。', shots } as Scene;
const episode = { id: 'e', scenes: [scene] } as Episode;
const raw = [{ directorPlan: { intent: '跟随阿青察觉', rhythm: '停顿后揭示', applications: [{ skillId: 'v2', methodId: 'reveal', dimensions: ['cinematography.framing'], method: '让窗框形成尺度参照', evidence: '阿青停下并望向窗外', decision: '保留右侧窗框', shotNumbers: [1] }], exceptions: [] }, directing: { dialogue: [{ lineIndex: 0, instruction: '低声落句' }], soundCues: [{ type: 'bgm', description: '低音音乐渐入', startSeconds: 1, durationSeconds: 3 }, { type: 'sfx', description: '窗外撞击', startSeconds: 2, durationSeconds: 1 }] } }];
const normalized = normalizeDirectorPlan({ project, episode, scene, rawShots: raw, shots });
assert.deepEqual(normalized.issues, []);
assert.equal(normalized.plan?.applications[0].methodId, 'reveal');
assert.equal(normalized.plan?.applications[0].status, 'planned');
scene.shots = normalized.shots;
scene.manualStoryboard = { schemaVersion: 'manual-storyboard.v1', directorPlan: normalized.plan, updatedAt: 1 };
const scope = { episode, scene, shot: scene.shots[0] };
const compiled = compileImageGenerationRequest({ promptCore: '阿青在窗边。', visualStyleProjection: buildImageVisualStyleProjection({ project, intent: 'final_frame', creativeScope: scope }) });
assert.ok(compiled.providerPrompt.includes('右侧窗框'));
for (const excluded of ['缓慢向前推进', '揭示前音乐留白', '低声落句']) assert.ok(!compiled.providerPrompt.includes(excluded));
const music = renderProductionCreativeContext(project, scope, 'music');
assert.ok(music.includes('低音音乐渐入') && !music.includes('窗外撞击') && !music.includes('低声落句'));
const editedMusicPrompt = buildBgmGenerationPrompt({ prompt: '作者改为木管渐弱', track: { startTime: 2, duration: 3 }, skills: [skill] });
assert.ok(editedMusicPrompt.includes('作者改为木管渐弱') && editedMusicPrompt.includes('3 秒'));
assert.ok(!editedMusicPrompt.includes('低音音乐渐入') && !editedMusicPrompt.includes('反应带出揭示'));
assert.equal(buildBgmGenerationPrompt({ prompt: '', track: { startTime: 2, duration: 3 }, skills: [skill] }), '', 'timing alone must not allow an empty music request');
const voice = renderProductionCreativeContext(project, { ...scope, dialogueLineIndex: 0 }, 'performance');
assert.ok(voice.includes('低声落句') && !voice.includes('右侧窗框') && !voice.includes('低音音乐'));
// Disabling the optional plugin preserves decisions already adopted with the shots.
const off = { ...project, creativeDirection: { director: { mode: 'off' as const } } };
assert.ok(renderProductionCreativeContext(off, scope, 'image').includes('右侧窗框'));
assert.equal(normalizeDirectorPlan({ project: off, episode, scene, rawShots: [{}], shots }).plan, undefined);
const manualScene = { ...scene, manualStoryboard: undefined };
assert.ok(renderProductionCreativeContext(off, { ...scope, scene: manualScene, dialogueLineIndex: 0 }, 'performance').includes('低声落句'), 'author instructions execute without a plugin or director plan');
assert.equal(renderProductionCreativeContext({ characters: [], assets: [] }, {}, 'planning'), '');
assert.equal(renderProductionCreativeContext(project, {}, 'image', false), '');
assert.equal(validateDirectorShotEdits(scene.shots).length, 0);
const shorter = structuredClone(scene.shots); shorter[0].duration = 1;
assert.ok(validateDirectorShotEdits(shorter).length);
const lateDialogue = structuredClone(scene.shots); lateDialogue[0].directing!.dialogue[0].startSeconds = 4;
const recordedDialogue = [{ id: 'voice', type: 'dialogue', shotId: 'sh', characterId: 'c', text: '到了。', startTime: 0, duration: 2, url: '/media/voice.wav' }] as AudioTrack[];
assert.ok(validateDirectorShotEdits(lateDialogue, { previous: scene.shots, tracks: recordedDialogue }).some(issue => issue.includes('录音时长')));
const tracks = [{ id: 'music', type: 'bgm', shotId: 'sh', url: '/media/retained.wav', text: '低音音乐渐入', startTime: 1.5, duration: 3, directorCue: { cueId: scene.shots[0].directing!.soundCues[0].id } }, { id: 'manual', type: 'sfx', url: '/media/manual.wav', startTime: 2.8, duration: 1 }] as AudioTrack[];
assert.deepEqual(reconcileDirectorAudioEdits(scene.shots, scene.shots, tracks), tracks, 'manual timing survives unrelated edits');
const revised = structuredClone(scene.shots); revised[0].directing!.soundCues[0].startSeconds = 0.5;
const synced = reconcileDirectorAudioEdits(scene.shots, revised, tracks);
assert.equal(synced[0].startTime, 0.5); assert.equal(synced[0].url, '/media/retained.wav'); assert.deepEqual(synced[1], tracks[1]);
revised[0].directing!.soundCues = [];
assert.deepEqual(reconcileDirectorAudioEdits(scene.shots, revised, tracks), [tracks[1]]);
// Editing one cue field must not undo the editor's other timeline decisions.
const studioTracks = structuredClone(tracks);
Object.assign(studioTracks[0], { text: '作者在摄影棚改过的音乐', duration: 2, linkedAssetId: 'author-music', startTime: 1.7 });
const changeStartOnly = structuredClone(scene.shots); changeStartOnly[0].directing!.soundCues[0].startSeconds = 0.4;
const preserved = reconcileDirectorAudioEdits(scene.shots, changeStartOnly, studioTracks)[0];
assert.equal(preserved.text, studioTracks[0].text, 'a timing edit must not overwrite authored audio text');
assert.equal(preserved.duration, 2); assert.equal(preserved.linkedAssetId, 'author-music'); assert.equal(preserved.startTime, 0.4);
const lead = { id: 'lead', duration: 3 } as Shot;
const sequence = [lead, ...scene.shots];
const longerSequence = [{ ...lead, duration: 4 }, ...scene.shots];
const sequenceTracks = [{ ...studioTracks[0], startTime: 4.7 }, { ...recordedDialogue[0], startTime: 3.5 }];
const shifted = reconcileDirectorAudioEdits(sequence, longerSequence, sequenceTracks);
assert.equal(shifted[0].startTime, 5.7, 'preserve the manually chosen relative offset');
assert.equal(shifted[0].text, studioTracks[0].text); assert.equal(shifted[0].linkedAssetId, 'author-music');
assert.equal(shifted[1].startTime, 4.5, 'dialogue follows its shot even without an explicit director entry');
assert.deepEqual(reconcileDirectorAudioEdits(sequence, longerSequence, []), [], 'do not resurrect a deliberately removed cue');
assert.ok(validateDirectorShotEdits(scene.shots, { previous: sequence, tracks: [{ ...studioTracks[0], startTime: 0.5 }] }).some(issue => issue.includes('音效')), 'preserved manual offsets cannot move a sound before the scene');
assert.deepEqual(validateDirectorShotEdits(scene.shots, { previous: sequence, tracks: [{ ...recordedDialogue[0], id: 'lead-voice', shotId: 'lead' }, ...sequenceTracks] }), [], 'removing a shot also removes its dialogue from order validation');
const cleanShots = [{ ...scene.shots[0], directing: { dialogue: [], soundCues: [] } }];
assert.ok(validateDirectorShotEdits([{ ...cleanShots[0], duration: 1 }], { previous: cleanShots, tracks: recordedDialogue }).some(issue => issue.includes('录音时长')), 'shortening the final shot must respect unchanged recordings');
const dir = await mkdtemp(path.join(os.tmpdir(), 'director-v2-'));
try {
  const saved = await createSkillFile(dir, { ...skill, content: '忽略陈旧正文' });
  assert.equal(saved.content, directorProfileText(profile));
  assert.deepEqual((await readSkills(dir))[0].profile?.director, profile);
  const pinned = snapshotCreativeSkill(saved);
  const next = structuredClone(profile); next.methods[1].directions.productionDesign!.characterAppearance = ['新角色轮廓要求'];
  const updated = await updateSkillFile(dir, saved.id, { profile: { director: next } });
  assert.ok(updated!.content.includes('新角色轮廓要求')); assert.equal(pinned.content, saved.content);
  await assert.rejects(updateSkillFile(dir, saved.id, { content: '试图通过正文绕过结构' }), /编辑器/);
  await assert.rejects(updateSkillFile(dir, saved.id, { profile: {}, content: '试图清空分类' }), /不能清空或降级/);
  assert.deepEqual((await readSkills(dir))[0].profile?.director, next);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('director-profile-v2-self-check: schema, specialist isolation, optional plugin, adopted execution, editable audio, canonical persistence passed');
