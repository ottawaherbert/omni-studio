import test from 'node:test';
import assert from 'node:assert/strict';
import type { Scene, AudioTrack } from '../src/types/project';
import { audioForEdit, audioTrackTimelineStart, editFromTimelineShots, sceneAudioTracks, sceneVideoClips } from '../src/utils/sceneVideoClips';
import { splitTimelineAudio, splitTimelineShot } from '../src/utils/timelineEditing';
import { buildSceneStoryboardExportItems, buildEpisodeFilmCoverage } from '../src/hooks/useEpisodeFilmExport';
import { buildEpisodeAudioExportItems } from '../src/utils/episodeAudioExport';
const scene = () => ({id:'scene',title:'测试',shots:[{id:'shot',duration:6,imageUrl:'/first.png',videoUrl:'/first.mp4'}],audioTracks:[]} as unknown as Scene);

test('splitting anchored audio preserves both audible positions through preview and export',()=>{
 const s=scene();s.edit=editFromTimelineShots(sceneVideoClips(s));
 const voice={id:'voice',type:'dialogue',url:'/voice.wav',startTime:1,duration:4,clipAnchor:{clipId:'shot',offsetSeconds:1}} as AudioTrack;
 s.audioTracks=splitTimelineAudio(voice,2,'tail');
 assert.deepEqual(sceneAudioTracks(s).map(t=>t.startTime),[1,3]);
 assert.deepEqual(buildEpisodeAudioExportItems([s]).map(t=>t.startTime),[1,3]);
});
test('dialogue in the tail follows that segment when a split video is moved',()=>{
 const s=scene();s.audioTracks=[{id:'voice',type:'dialogue',url:'/voice.wav',shotId:'shot',startTime:4,duration:1}];
 const split=editFromTimelineShots(splitTimelineShot(sceneVideoClips(s)[0],3,'tail'));
 s.audioTracks=audioForEdit(s,split);s.edit=split;
 const moved=editFromTimelineShots(sceneVideoClips(s).reverse());s.audioTracks=audioForEdit(s,moved);s.edit=moved;
 assert.equal(sceneAudioTracks(s)[0].startTime,1);
});
test('source in-point changes preserve dialogue sync and keep intentional J cuts',()=>{
 const s=scene();s.audioTracks=[{id:'voice',type:'dialogue',url:'/voice.wav',shotId:'shot',startTime:2,duration:3}];
 const edit=editFromTimelineShots(sceneVideoClips(s));edit.clips[0].sourceInSeconds=3;edit.clips[0].durationSeconds=3;
 s.audioTracks=audioForEdit(s,edit);s.edit=edit;
 const voice=sceneAudioTracks(s)[0];assert.equal(voice.startTime,0);assert.equal(voice.sourceStartSeconds,1);assert.equal(voice.duration,2);
 assert.equal(s.audioTracks[0].duration,3,'derived head cropping must not overwrite original audio');
});
test('storyboard export follows edited order and duration, matching its audio timeline',()=>{
 const s=scene();s.shots.push({...s.shots[0],id:'second',duration:4,imageUrl:'/second.png'});
 s.edit=editFromTimelineShots(sceneVideoClips(s).reverse());s.edit.clips[0].durationSeconds=1;s.edit=editFromTimelineShots(sceneVideoClips(s));
 const items=buildSceneStoryboardExportItems(s);
 assert.deepEqual(items.map(i=>[i.imageUrl,i.durationSeconds]),[['/second.png',1],['/first.png',6]]);
 const coverage=buildEpisodeFilmCoverage({scenes:[s]} as any);assert.equal(coverage.imageShotCount,2);
});

test('splitting a J-cut after head cropping keeps its audible split and source ranges',()=>{
 const s=scene();s.edit=editFromTimelineShots(sceneVideoClips(s));
 const track={id:'voice',type:'dialogue',url:'/voice.wav',startTime:0,duration:4,clipAnchor:{clipId:'shot',offsetSeconds:-1}} as AudioTrack;
 const start=audioTrackTimelineStart(s,track);
 s.audioTracks=splitTimelineAudio({...track,startTime:start},1-start,'tail');
 assert.deepEqual(sceneAudioTracks(s).map(t=>[t.startTime,t.duration,t.sourceStartSeconds]),[[0,1,1],[1,2,2]]);
});
