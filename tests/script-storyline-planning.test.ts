import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptProject,newUnit} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {parseScriptProject} from '../packages/script/src/schema';
import {anchorFor,beatsForUnit,visibleOutlineGuides,outlineGuideId,outlineHash,type OutlineOwner} from '../packages/script/src/outlineGuides';
import {beatsForStoryline,visibleStorylinesForOutline,setBeatStorylineLink,updateBeatText,removeBeat,removeStoryline,updateStoryline} from '../packages/script/src/storylinePlanning';
import {applyWorkspacePatch,createWorkspacePatch} from '../packages/script/src/workspacePatch';
import {outlineOnlyAdoption} from '../packages/script/src/outlineAdoption';
import {buildRequiredWritingContext} from '../packages/script/src/writingContext';

function fixture(){
  const p=createScriptProject('明确故事线关系',createScriptCreationProfile('anthology',3,2));
  p.seasons=[{id:'season_a',title:'季甲',arc:'季的原文'},{id:'season_b',title:'季乙',arc:'另季原文'}];
  p.brief.outline='作品的原文';const unit=p.units[0];unit.scopeId='story_a';unit.seasonId='season_a';unit.summary='当前集原文';
  const other=newUnit('同季其他独立故事',120000,'story_b');other.seasonId='season_a';
  const later=newUnit('别季故事',120000,'story_c');later.seasonId='season_b';p.units.push(other,later);
  p.storyOutlines=[{scopeId:'story_a',outline:'故事甲原文'},{scopeId:'story_b',outline:'故事乙原文'}];
  p.storylines=[['line_project',p.id],['line_season','season_a'],['line_other_season','season_b'],['line_story','story_a'],['line_other_story','story_b']].map(([id,scopeId])=>({id,scopeId,lane:'A' as const,title:id,premise:'前提',resolution:'结局'}));
  const owners:OutlineOwner[]=[{kind:'project',id:p.id},{kind:'season',id:'season_a'},{kind:'story',id:'story_a'},{kind:'unit',id:unit.id}];
  const originals=[p.brief.outline,p.seasons[0].arc,p.storyOutlines[0].outline,unit.summary];
  p.outlineGuides=owners.map((owner,i)=>({id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{id:`beat_${i}`,title:'关键事件',change:'局势变化',anchors:[anchorFor(originals[i],0,originals[i].length)],unitIds:i===0?[]:[unit.id],sceneRefs:[]}]}));
  return parseScriptProject(p);
}
const lineIds=(p:ReturnType<typeof fixture>,owner:OutlineOwner)=>visibleStorylinesForOutline(p,owner).map(line=>line.id);

test('outline owners expose shared lines without unlocking their member stories',()=>{
  const p=fixture(),unit=p.units[0];
  assert.deepEqual(lineIds(p,{kind:'project',id:p.id}),['line_project']);
  assert.deepEqual(lineIds(p,{kind:'season',id:'season_a'}),['line_project','line_season']);
  assert.deepEqual(lineIds(p,{kind:'story',id:'story_a'}),['line_project','line_season','line_story']);
  assert.deepEqual(lineIds(p,{kind:'unit',id:unit.id}),['line_project','line_season','line_story']);
  const mixed=structuredClone(p);mixed.units[2].scopeId='story_a';
  assert.deepEqual(lineIds(mixed,{kind:'story',id:'story_a'}),['line_project','line_story'],'a story spanning seasons does not inherit either season line');
});

test('explicit beat-line edges persist, reject crossed scopes, and are not inferred from common scenes',()=>{
  const p=fixture(),owner=p.outlineGuides![3].owner,beat=p.outlineGuides![3].beats[0],scene=p.units[0].scenes[0];
  scene.storylineIds=['line_story'];beat.sceneRefs=[{unitId:p.units[0].id,sceneId:scene.id}];
  assert.deepEqual(beatsForStoryline(p,owner,'line_story'),[]);
  const next=setBeatStorylineLink(p,owner,beat.id,'line_story',true);
  assert.deepEqual(beatsForStoryline(next,owner,'line_story').map(entry=>[entry.beat.id,entry.current]),[[beat.id,true]]);
  assert.deepEqual(applyWorkspacePatch(p,createWorkspacePatch(p,next)),next);
  assert.deepEqual(applyWorkspacePatch(next,createWorkspacePatch(next,p)),p);
  assert.throws(()=>setBeatStorylineLink(p,owner,beat.id,'line_other_story',true),/不属于/);
  const season=p.outlineGuides![1];assert.throws(()=>setBeatStorylineLink(p,season.owner,season.beats[0].id,'line_story',true),/不属于/);
  for(const refs of [['line_other_story'],['line_story','line_story'],['missing']]){
    const forged=structuredClone(next);forged.outlineGuides![3].beats[0].storylineIds=refs;
    assert.throws(()=>parseScriptProject(forged),/故事线引用/);
    assert.throws(()=>applyWorkspacePatch(p,{projectId:p.id,operations:[{key:`outlineGuides/${next.outlineGuides![3].id}`,field:'beats',beforeHash:createWorkspacePatch(p,next).operations.find(op=>op.field==='beats')!.beforeHash,after:{present:true,value:forged.outlineGuides![3].beats}}]}),/故事线引用/);
  }
});

test('metadata changes preserve original and all explicit relationships; wrong owner rejects',()=>{
  const p=fixture(),owner=p.outlineGuides![3].owner,beat=p.outlineGuides![3].beats[0];
  beat.storylineIds=['line_story'];beat.sceneRefs=[{unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id}];
  const next=updateBeatText(p,owner,beat.id,{title:'新名称',change:'新的局势变化'});
  assert.deepEqual(next.units,p.units);assert.deepEqual(next.brief,p.brief);assert.deepEqual(next.storyOutlines,p.storyOutlines);
  assert.deepEqual({...next.outlineGuides![3].beats[0],title:beat.title,change:beat.change},beat);
  assert.throws(()=>updateBeatText(p,p.outlineGuides![1].owner,beat.id,{title:'错目标'}),/不存在/);
  assert.throws(()=>updateBeatText(p,owner,beat.id,{title:''}),/格式无效/);
});

test('line deletion cleans both kinds of links; beat deletion cleans delivery identities',()=>{
  const p=fixture(),unit=p.units[0],owner=p.outlineGuides![3].owner;
  unit.scenes[0].storylineIds=['line_project','line_story'];p.outlineGuides![3].beats[0].storylineIds=['line_project','line_story'];p.outlineGuides![0].beats[0].storylineIds=['line_project'];
  const deleted=removeStoryline(p,'line_project');
  assert.deepEqual(deleted.units[0].scenes[0].storylineIds,['line_story']);assert.deepEqual(deleted.outlineGuides![3].beats[0].storylineIds,['line_story']);assert.deepEqual(deleted.outlineGuides![0].beats[0].storylineIds,[]);
  assert.deepEqual(applyWorkspacePatch(p,createWorkspacePatch(p,deleted)),deleted);
  const guide=p.outlineGuides![3];guide.development={sourceHash:outlineHash(unit.summary),unitId:unit.id,nodes:false,beats:true,full:false,nodeId:null,beatIds:[guide.beats[0].id]};
  const removed=removeBeat(p,owner,guide.beats[0].id);assert.deepEqual(removed.outlineGuides![3].beats,[]);assert.deepEqual(removed.outlineGuides![3].development!.beatIds,[]);
  assert.equal(p.outlineGuides![3].beats.length,1);assert.equal(p.storylines!.length,5);
});

test('scope edits reject invalid scene or beat references atomically, including cross-story and cross-season moves',()=>{
  const p=fixture();p.units[0].scenes[0].storylineIds=['line_story'];p.outlineGuides![1].beats[0].storylineIds=['line_season'];
  const baseline=structuredClone(p);
  for(const scopeId of ['story_b','season_b'])assert.throws(()=>updateStoryline(p,'line_story',{scopeId}),/场景引用越界/);
  for(const scopeId of ['story_a','season_b'])assert.throws(()=>updateStoryline(p,'line_season',{scopeId}),/大纲归属/);
  assert.deepEqual(p,baseline);
  const shared=updateStoryline(p,'line_story',{scopeId:p.id,title:'已共享'});assert.equal(shared.storylines!.find(line=>line.id==='line_story')!.scopeId,p.id);assert.deepEqual(shared.units,p.units);
});

test('legacy beats remain field-compatible and text-only adoption preserves author relationships',()=>{
  const p=fixture();assert.ok(p.outlineGuides!.every(guide=>!Object.hasOwn(guide.beats[0],'storylineIds')));
  assert.deepEqual(parseScriptProject(p),p);
  const owner=p.outlineGuides![3].owner,linked=setBeatStorylineLink(p,owner,'beat_3','line_story',true),merged=structuredClone(linked);merged.units[0].summary='工作稿新原文';merged.outlineGuides![3].beats[0].storylineIds=['line_project'];
  const adopted=outlineOnlyAdoption(linked,merged);assert.equal(adopted.units[0].summary,'工作稿新原文');assert.deepEqual(adopted.outlineGuides,linked.outlineGuides);
});

test('only explicitly assigned season beats enter current-unit and scene-planning context; parent edits still require its exact owner',()=>{
  const p=fixture(),unit=p.units[0],guide=p.outlineGuides![1],beat=guide.beats[0];
  p.seasons![0].arc+='SEASON_OTHER_DETAILS_FORBIDDEN';
  guide.beats.push({...structuredClone(beat),id:'season_unassigned',title:'OTHER_STORY_BEAT_FORBIDDEN',change:'OTHER_STORY_CHANGE_FORBIDDEN',unitIds:[p.units[1].id]});
  p.units[1].scenes[0].blocks[0].text='OTHER_STORY_BODY_FORBIDDEN';
  assert.ok(visibleOutlineGuides(p,unit).some(item=>item.id===guide.id));
  assert.deepEqual(beatsForUnit(p,unit).filter(entry=>entry.guide.owner.kind==='season').map(entry=>entry.beat.id),[beat.id]);
  assert.throws(()=>updateBeatText(p,{kind:'unit',id:unit.id},beat.id,{title:'隐式改季'}),/不存在/);
  const explicit=updateBeatText(p,guide.owner,beat.id,{title:'明确改季'});assert.equal(explicit.outlineGuides![1].beats[0].title,'明确改季');
  for(const operation of ['consult','scene_plan','plan_scenes']){
    const context=buildRequiredWritingContext(p,{unitIds:[unit.id],sceneId:unit.scenes[0].id,operation,source:{kind:'WORKSPACE',id:'fixture',version:1}});
    const season=context.outlineGuides.find(item=>item.owner.kind==='season');assert.deepEqual(season!.beats.map(item=>item.id),[beat.id]);
    assert.doesNotMatch(JSON.stringify(context),/SEASON_OTHER_DETAILS_FORBIDDEN|OTHER_STORY_BEAT_FORBIDDEN|OTHER_STORY_CHANGE_FORBIDDEN|OTHER_STORY_BODY_FORBIDDEN/);
  }
  beat.unitIds=[];assert.ok(!visibleOutlineGuides(p,unit).some(item=>item.id===guide.id));
  beat.sceneRefs=[{unitId:unit.id,sceneId:unit.scenes[0].id}];assert.ok(visibleOutlineGuides(p,unit).some(item=>item.id===guide.id));
  const otherSeason=p.outlineGuides![1];otherSeason.owner={kind:'season',id:'season_b'};assert.ok(!visibleOutlineGuides(p,unit).some(item=>item===otherSeason));
});
