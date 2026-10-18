import assert from 'node:assert/strict';
import type { AudioTrack, Shot } from '../src/types/project';
import { applyStudioVoiceResult, resolveTrackVoiceDirection, voiceDirectionOverrides } from '../src/utils/studioVoiceResult';

const shots = [{ id: 's1', duration: 10 }, { id: 's2', duration: 6 }] as Shot[];
const tracks: AudioTrack[] = [
  { id: 'a1', shotId: 's1', characterId: 'c1', type: 'dialogue', text: '原台词', url: '/old.wav', startTime: 1, duration: 2 },
  { id: 'a2', shotId: 's1', characterId: 'c2', type: 'dialogue', text: '第二句', url: '', startTime: 5, duration: 2 },
  { id: 'a3', shotId: 's2', type: 'dialogue', url: '/third.wav', startTime: 11, duration: 2 },
  { id: 'bgm', type: 'bgm', url: '/bgm.wav', startTime: 2, duration: 12 },
];
const snapshot = JSON.stringify({ shots, tracks });
const base = {
  shots, tracks, trackId: 'a1', url: '/new.wav', text: '新台词', duration: 3.2,
  audioMedia: undefined, voiceDirection: { instructions: '低声', speed: 0.9 },
  audit: { action: 'generate_voice' as const, sourceHash: 'source', textHash: 'text', modelId: 'model', voiceName: 'Serena', createdAt: 42 },
  governed: true,
};
const result = applyStudioVoiceResult(base);
assert.deepEqual(result.audioTracks.map(track => track.startTime), [1, 5, 11, 2], 'one recording must preserve every authored offset');
assert.equal(result.audioTracks[0].duration, 3.2, 'do not round recordings into overlaps');
assert.equal(result.audioTracks[0].text, '新台词');
assert.equal(result.audioTracks[0].voiceHistory?.[0].url, '/old.wav');
assert.equal(result.audioTracks[0].voiceHistory?.[0].text, '原台词');
assert.equal(result.exceedsShot, false);
assert.equal(result.overlapsNextLine, false);
const newlyAdoptedShots = shots.map(shot => ({ ...shot, videoPrompt: '另一页面刚采用的运动提示词' }));
const savedAfterVoice = { shots: newlyAdoptedShots, audioTracks: tracks, ...result.sceneUpdates };
assert.deepEqual(savedAfterVoice.shots, newlyAdoptedShots, 'a stale governed voice result must not replace newly adopted shot prompts');
assert.equal(savedAfterVoice.audioTracks[0].url, '/new.wav', 'recording updates still persist');
assert.equal(JSON.stringify({ shots, tracks }), snapshot, 'source objects and recordings remain intact');
const long = applyStudioVoiceResult({ ...base, duration: 11 });
assert.equal(long.shots[0].duration, 10, 'governed shot duration cannot change');
assert.equal(long.exceedsShot, true);
assert.equal(long.overlapsNextLine, true);
const extend = applyStudioVoiceResult({ ...base, trackId: 'a2', duration: 7, governed: false });
assert.deepEqual(extend.shots.map(shot => shot.duration), [12, 6]);
assert.deepEqual(extend.sceneUpdates.shots?.map(shot => shot.duration), [12, 6], 'legacy voice generation still saves required shot extensions');
assert.deepEqual(extend.audioTracks.map(track => track.startTime), [1, 5, 13, 2], 'later shot shifts preserve local offsets and independent BGM timing');
const shorter = applyStudioVoiceResult({ ...base, duration: 0.8, governed: false });
assert.equal(shorter.shots[0].duration, 10, 'shorter line must not truncate the whole shot');
const inherited = { language: 'Chinese', instructions: '平静', speed: 1.1 };
assert.deepEqual(voiceDirectionOverrides(inherited, inherited), {});
const overrides = voiceDirectionOverrides({ language: 'Chinese', instructions: '', speed: 0.9 }, inherited);
assert.deepEqual(overrides, { instructions: '', speed: 0.9 }, 'explicit empty instructions override character style');
assert.deepEqual(resolveTrackVoiceDirection({ ...inherited, language: 'English' }, { ...tracks[0], voiceDirection: overrides }), {
  language: 'English', instructions: '', speed: 0.9,
}, 'unspecified fields follow new defaults while shot overrides persist');
const twice = applyStudioVoiceResult({ ...base, tracks: result.audioTracks, url: '/third-take.wav' });
assert.deepEqual(twice.audioTracks[0].voiceHistory?.map(item => item.url), ['/old.wav', '/new.wav']);
console.log('Studio voice result checks passed: multi-line offsets, text, direction inheritance, exact duration, non-destructive history, governed limits.');
