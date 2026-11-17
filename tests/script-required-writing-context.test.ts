import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { buildRequiredWritingContext } from '../packages/script/src/writingContext';
import { resolveStoryOutline } from '../packages/script/src/outlines';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile, createScriptProjectFromMaterial } from '../packages/script/src/creation';
import { unitCharacters, unitFacts, sceneStateHash, changeUnitStoryScope } from '../packages/script/src/continuity';

function anthology(){
  const p=createScriptProject('机械上下文验证',createScriptCreationProfile('anthology',3,2));
  const first=p.units[0];first.scopeId='story_a';first.summary='A_FIRST_PLAN';first.scenes[0].blocks[0].text='A_PREVIOUS_END';
  const other=newUnit('同名故事',120000,'story_b');other.summary='B_FORBIDDEN_PLAN';other.scenes[0].blocks[0].text='B_FORBIDDEN_BODY';
  const current=newUnit('同名故事',90000,'story_a');current.summary='A_CURRENT_PLAN';current.scenes[0].purpose='CURRENT_SCENE_PLAN';current.scenes[0].blocks[0].text='A_CURRENT_BODY';
  p.units.push(other,current);p.brief.concept='SHARED_CONCEPT';p.brief.outline='MIXED_GLOBAL_FORBIDDEN';
  p.seasons=[{id:'season_compilation',title:'同名故事',arc:'COMPILATION_ARC_FORBIDDEN'}];p.units.forEach(unit=>unit.seasonId='season_compilation');
  p.storyOutlines=[{scopeId:'story_a',outline:'A_FULL_STORY_PLAN'},{scopeId:'story_b',outline:'B_FULL_STORY_FORBIDDEN'}];
  p.characters=[{id:'char_a',scopeId:'story_a',name:'同名人物',bio:'A_CHARACTER',voice:'',desire:'',need:'',arc:'',contradiction:''},{id:'char_b',scopeId:'story_b',name:'同名人物',bio:'B_CHARACTER_FORBIDDEN',voice:'',desire:'',need:'',arc:'',contradiction:''}];
  return {p,first,other,current};
}

test('same-story continuation reads the actual earlier ending, real unit duration and precise outline owner',()=>{
  const {p,first,current}=anthology(),context=buildRequiredWritingContext(p,{unitIds:[current.id],sceneId:current.scenes[0].id,operation:'scene_body',source:{kind:'WORKSPACE',id:'work',version:7}}),serialized=JSON.stringify(context);
  assert.match(serialized,/A_PREVIOUS_END|A_FULL_STORY_PLAN/);assert.doesNotMatch(serialized,/FORBIDDEN/);
  assert.equal(context.currentUnits[0].targetDurationMs,90000);assert.equal(context.currentUnits[0].projectDefaultDurationMs,120000);
  assert.equal(context.manuscript.excerpts[0].sceneHash,sceneStateHash(first.scenes[0]));assert.equal(context.source.version,7);
  assert.equal(context.planning.meaning,'AUTHOR_PLANNING_NOT_OCCURRED_EVENTS');assert.equal(context.manuscript.excerpts[0].reason,'PREVIOUS_SAME_STORY_UNIT_END');
  assert.equal(context.outlineRequirements!.items[0].text,'A_CURRENT_PLAN');
  assert.equal(resolveStoryOutline(p,'story_a').kind,'story');assert.equal(resolveStoryOutline(p,'season_compilation').kind,'season');assert.equal(resolveStoryOutline(p,p.id).kind,'project');
});

test('long previous scene preserves its tail and exact partial-read offsets rather than implying a full read',()=>{
  const {p,first,current}=anthology();first.scenes[0].blocks[0].text='HIDDEN_HEAD_'+ '早'.repeat(7000)+'REAL_TAIL';
  const context=buildRequiredWritingContext(p,{unitIds:[current.id],sceneId:current.scenes[0].id,maxExcerptChars:100}),e=context.manuscript.excerpts[0];
  assert.equal(e.coverage.mode,'TAIL_EXCERPT');assert.equal(e.coverage.readChars,100);assert.equal(e.blocks[0].text,first.scenes[0].blocks[0].text.slice(-100));
  assert.equal(e.blocks[0].end,first.scenes[0].blocks[0].text.length);assert.ok(e.blocks[0].start>0);assert.match(e.notice,/不能声称已通读全场/);
});

test('old mixed anthology outline is never a missing-story fallback, and shared knowledge changes cannot import another story event',()=>{
  const {p,other,current}=anthology();p.storyOutlines=[];
  p.continuityTracks=[{id:'track',scopeId:p.id,kind:'knowledge',perspective:'audience',label:'共有记录',characterIds:[],initialValue:'起点',changes:[{id:'change',sceneId:other.scenes[0].id,value:'B_SECRET_FORBIDDEN',reason:'另一故事',sourceHash:sceneStateHash(other.scenes[0])}]}];
  const context=buildRequiredWritingContext(p,{unitIds:[current.id],sceneId:current.scenes[0].id});
  assert.equal(context.planning.missing[0].scopeId,'story_a');assert.doesNotMatch(JSON.stringify(context),/FORBIDDEN/);
});

test('procedural initial recurring canon is shared, anthology initial canon remains local',()=>{
  for(const format of ['procedural','anthology'] as const){
    const p=createScriptProjectFromMaterial('机械初始资料',createScriptCreationProfile(format,2,20),{concept:'前提',theme:'主题',outline:'',characters:[{name:'常驻'}],facts:['约定']});
    const next=newUnit('下一集',1200000,'story_next');p.units.push(next);
    assert.equal(unitCharacters(p,next).length,format==='procedural'?1:0);assert.equal(unitFacts(p,next).length,format==='procedural'?1:0);
  }
});


test('changing the sole story owner cannot orphan or overwrite its saved complete outline',()=>{
  const {p,other}=anthology(),before=JSON.stringify(p);
  assert.throws(()=>changeUnitStoryScope(p,other.id,'story_a'),/已有完整大纲/);assert.equal(JSON.stringify(p),before);
});
