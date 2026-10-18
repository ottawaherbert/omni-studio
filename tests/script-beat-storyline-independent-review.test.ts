import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import React, {type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AgentSqliteStore, SqliteConversationStore} from '../packages/agent-sqlite/src';
import {createScriptProject, newScene, newUnit, removeScriptScene} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {parseScriptProject, type ScriptProject} from '../packages/script/src/schema';
import {anchorCurrent, anchorFor, beatsForUnit, freezeOutlineGrant, outlineGuideId, visibleOutlineGuides, type OutlineGrant, type OutlineOwner} from '../packages/script/src/outlineGuides';
import {buildOutlineDevelopment, assertOutlineDevelopment} from '../packages/script/src/outlineDevelopment';
import {removeBeat, removeStoryline, setBeatStorylineLink, updateBeatText, updateStoryline, visibleStorylinesForOutline} from '../packages/script/src/storylinePlanning';
import {ScriptCommandService} from '../apps/api/src/agent/scriptCommands';
import {ScriptWorkspaceStore, workspaceRef} from '../apps/api/src/repositories/scriptWorkspaceStore';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {OutlineBeats, OutlineBeatTextEditor, outlineNodesForBeat} from '../apps/web/src/features/script/components/OutlineBeats';
import {ScriptStructure} from '../apps/web/src/features/script/ScriptStructure';

// Independent review fixtures use only memory and mechanical protocol values.
// They never read the user database or invoke a provider.
function fixture():ScriptProject {
  const project=createScriptProject('独立节拍关系回归',createScriptCreationProfile('short-film',1,5));
  const unit=project.units[0];project.brief.outline='她读完来信。\n她打开旧匣。';
  unit.scenes[0].blocks[0].text='她把信放在桌上。';unit.scenes.push(newScene('保留场'));
  project.storylines=[{id:'review_line',scopeId:project.id,lane:'A',title:'寻父',premise:'核实来信',resolution:'见到父亲'}];
  unit.scenes[0].storylineIds=['review_line'];
  const owner:OutlineOwner={kind:'project',id:project.id};
  project.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[
    {id:'review_selected',title:'读信',change:'从怀疑到核实',anchors:[anchorFor(project.brief.outline,0,6)],unitIds:[unit.id],sceneRefs:[{unitId:unit.id,sceneId:unit.scenes[0].id}],storylineIds:['review_line']},
    {id:'review_shared_source',title:'收到信息',change:'消息改变行动',anchors:[anchorFor(project.brief.outline,0,6)],unitIds:[unit.id],sceneRefs:[],storylineIds:[]},
    {id:'review_later',title:'开匣',change:'发现旧物',anchors:[anchorFor(project.brief.outline,7,13)],unitIds:[unit.id],sceneRefs:[],storylineIds:['review_line']},
  ]}];return parseScriptProject(project);
}
function selectedGrant(project:ScriptProject):OutlineGrant {
  return freezeOutlineGrant(project,project.outlineGuides![0].owner,{outlineBeatIds:['review_selected'],range:{start:0,end:6,quote:project.brief.outline.slice(0,6)}});
}
function response(project:ScriptProject,content='她看完来信。') {
  return {summary:'机械定向修改',content,nodes:null,beats:[{id:'review_selected',localKey:'selected',title:'看信',change:'她决定核实',quotes:[content],unitIds:[project.units[0].id]}]};
}
function changed(project:ScriptProject) {
  return parseScriptProject(buildOutlineDevelopment(project,selectedGrant(project),project.units[0].id,'review_candidate',response(project)));
}
function elements(node:ReactNode):React.ReactElement<any>[] {
  if(Array.isArray(node))return node.flatMap(elements);
  if(!React.isValidElement<any>(node))return [];
  const element=node as React.ReactElement<any>;
  return [element,...elements(element.props.children)];
}

test('legacy manuscripts and beats without explicit storylineIds still round-trip unchanged',()=>{
  const project=fixture();delete project.storylines;delete project.units[0].scenes[0].storylineIds;
  for(const beat of project.outlineGuides![0].beats)delete beat.storylineIds;
  const parsed=parseScriptProject(JSON.parse(JSON.stringify(project)));assert.deepEqual(parsed,project);
  assert.equal('storylineIds' in parsed.outlineGuides![0].beats[0],false);
  delete project.outlineGuides;assert.deepEqual(parseScriptProject(project),project);
});

test('one beat sharing original text with another updates only its frozen identity',()=>{
  const project=fixture(),next=changed(project),guide=next.outlineGuides![0];
  assert.equal(next.brief.outline,'她看完来信。\n她打开旧匣。');
  assert.deepEqual(next.units,project.units);assert.deepEqual(next.storylines,project.storylines);
  const selected=guide.beats.find(beat=>beat.id==='review_selected')!;
  assert.equal(selected.title,'看信');assert.ok(anchorCurrent(selected.anchors[0],next.brief.outline));
  assert.deepEqual(selected.sceneRefs,project.outlineGuides![0].beats[0].sceneRefs);assert.deepEqual(selected.storylineIds,['review_line']);
  const shared=guide.beats.find(beat=>beat.id==='review_shared_source')!;
  assert.deepEqual(shared,project.outlineGuides![0].beats[1]);assert.equal(anchorCurrent(shared.anchors[0],next.brief.outline),false);
  assert.ok(anchorCurrent(guide.beats.find(beat=>beat.id==='review_later')!.anchors[0],next.brief.outline));
});

test('a beat request refuses sibling edits, newly invented identities and relation changes',()=>{
  const project=fixture(),grant=selectedGrant(project),value=response(project);
  assert.throws(()=>buildOutlineDevelopment(project,grant,project.units[0].id,'review_candidate',{...value,beats:[...value.beats,{...value.beats[0],id:'review_shared_source',localKey:'sibling'}]}),/目标/);
  assert.throws(()=>buildOutlineDevelopment(project,grant,project.units[0].id,'review_candidate',{...value,beats:[{...value.beats[0],id:null}]}),/目标/);
  const forged=changed(project);forged.outlineGuides![0].beats.find(beat=>beat.id==='review_selected')!.storylineIds=[];
  assert.throws(()=>assertOutlineDevelopment(project,forged,grant,project.units[0].id),/故事线关联写权/);
  assert.throws(()=>freezeOutlineGrant(project,grant.owner,{outlineBeatIds:['review_selected'],allowStructure:true,structureUnitId:project.units[0].id}),/结构或场序/);
});

test('manual proposal and adoption reconstruction retain the exact beat whitelist',()=>{
  const project=fixture(),unit=project.units[0],work={id:'review_workspace',ownerId:'review_author',documentId:project.id,revision:project.revision,document:project};
  const prepared=(ScriptCommandService.prototype as any).manualScope.call({deps:{}},work,{operation:'outline_development',instruction:'只修改读信节拍',source:{kind:'WORKSPACE'},target:{unitId:unit.id,scopeId:project.id,outlineRange:{start:0,end:6,text:project.brief.outline.slice(0,6)},outlineBeatIds:['review_selected']}});
  assert.deepEqual(prepared.scope.outlineGrants,[selectedGrant(project)]);
  const record={id:'review_candidate',status:'VALID',workspaceId:work.id,authorizationId:'review_authorization',baseRef:workspaceRef(work),request:{operation:'outline_development',unitId:unit.id},candidate:{request:{operation:'outline_development',unitId:unit.id}},runId:'review_run'};
  const service={deps:{drafts:{readCandidate:()=>record},authorizations:{read:()=>({workspaceId:work.id,scope:prepared.scope,sources:[]})},store:{readRun:()=>({input:{}}),db:{prepare:()=>({get:()=>undefined})}}}};
  const adopted=(ScriptCommandService.prototype as any).applyScope.call(service,work,record.id,work.ownerId);
  assert.deepEqual(adopted.scope.outlineGrants,[selectedGrant(project)]);
});

test('manual beat text editing preserves original source, scene links and explicit storylines',()=>{
  const project=fixture(),beforeInput=structuredClone(project),next=updateBeatText(project,project.outlineGuides![0].owner,'review_selected',{title:'当面读信',change:'决定回去核实'});
  assert.equal(next.brief.outline,project.brief.outline);assert.deepEqual(next.units,project.units);assert.deepEqual(next.storylines,project.storylines);
  const before=project.outlineGuides![0].beats[0],after=next.outlineGuides![0].beats[0];
  assert.deepEqual(after.anchors,before.anchors);assert.deepEqual(after.sceneRefs,before.sceneRefs);assert.deepEqual(after.storylineIds,before.storylineIds);
  assert.throws(()=>updateBeatText(project,project.outlineGuides![0].owner,'review_selected',{title:' '}));
  assert.deepEqual(project,beforeInput,'failed metadata edit cannot change its input');
});

test('removing a line or a scene clears every applicable edge and never changes body text',()=>{
  const project=fixture(),next=removeStoryline(project,'review_line');
  assert.equal(next.storylines!.length,0);assert.deepEqual(next.units[0].scenes[0].storylineIds,[]);
  assert.ok(next.outlineGuides![0].beats.every(beat=>!beat.storylineIds?.includes('review_line')));
  assert.equal(next.brief.outline,project.brief.outline);assert.deepEqual(next.units[0].scenes[0].blocks,project.units[0].scenes[0].blocks);
  const sceneDeleted=structuredClone(project);removeScriptScene(sceneDeleted,project.units[0].id,project.units[0].scenes[0].id);
  assert.doesNotThrow(()=>parseScriptProject(sceneDeleted));assert.ok(sceneDeleted.outlineGuides![0].beats.every(beat=>beat.sceneRefs.length===0));
  const beatDeleted=removeBeat(project,project.outlineGuides![0].owner,'review_selected');
  assert.ok(!beatDeleted.outlineGuides![0].beats.some(beat=>beat.id==='review_selected'));
  assert.deepEqual(beatDeleted.units,project.units);assert.deepEqual(beatDeleted.storylines,project.storylines);
});

test('shared season and project owners cannot link private story lines and narrowing a linked line fails atomically',()=>{
  const project=fixture();project.profile.organization='episodic';project.profile.continuity='mixed';project.profile.plannedUnits=2;
  const unit=project.units[0];unit.scopeId='review_story';unit.seasonId='review_season';
  const other=newUnit('另一故事',300000,'review_other_story');other.seasonId='review_season';project.units.push(other);
  project.seasons=[{id:'review_season',title:'第一季',arc:'共同旧案'}];
  project.storylines!.push({id:'review_private',scopeId:unit.scopeId,lane:'B',title:'私人关系',premise:'私事',resolution:'隐秘结局'});
  const owner:OutlineOwner={kind:'season',id:'review_season'};project.outlineGuides![0].owner=owner;project.outlineGuides![0].id=outlineGuideId(owner);
  for(const beat of project.outlineGuides![0].beats)beat.anchors=[anchorFor('共同旧案',0,4)];
  parseScriptProject(project);
  assert.deepEqual(visibleStorylinesForOutline(project,{kind:'season',id:'review_season'}).map(line=>line.id),['review_line']);
  assert.deepEqual(visibleStorylinesForOutline(project,project.outlineGuides![0].owner).map(line=>line.id),['review_line']);
  assert.throws(()=>setBeatStorylineLink(project,project.outlineGuides![0].owner,'review_selected','review_private',true),/当前大纲/);
  const before=structuredClone(project);
  assert.throws(()=>updateStoryline(project,'review_line',{scopeId:other.scopeId}),/越界|越出/);assert.deepEqual(project,before);
});

test('outline comparison then partial and full adoption preserve explicit storyline edges',t=>{
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('review_author','script:home','review');
  const scripts=createScriptRepository(db);scripts.ensureSchema();const workspaces=new ScriptWorkspaceStore(store,scripts,{trustedLegacyProjectOwner:'review_author'});workspaces.ensureSchema();
  const author=scripts.saveProject(fixture(),0),work=workspaces.create({ownerId:'review_author',threadId:thread.id,requestId:'review-create',source:{projectId:author.id,revision:author.revision}});
  const revised=changed(work.document),access={ownerId:'review_author',workspaceId:work.id};
  workspaces.saveAuthor({...access,requestId:'review-save',expectedRevision:work.revision,expectedEpoch:work.writerEpoch,document:revised});
  const prepare=(outlineOnly=false)=>workspaces.prepareAdoption({...access,workspaceRevision:workspaces.read(work.id,'review_author').revision,expectedAuthorRevision:scripts.getProject(author.id)!.revision,outlineOnly});
  const partial=prepare(true);assert.deepEqual(partial.document.outlineGuides,author.outlineGuides);assert.deepEqual(partial.document.storylines,author.storylines);
  workspaces.adopt({...access,requestId:'review-adopt-text',proposalId:partial.id,digest:partial.digest});
  assert.deepEqual(workspaces.read(work.id,'review_author').document.outlineGuides,revised.outlineGuides);
  const full=prepare();workspaces.adopt({...access,requestId:'review-adopt-relations',proposalId:full.id,digest:full.digest});
  const saved=scripts.getProject(author.id)!;assert.deepEqual(saved.outlineGuides,revised.outlineGuides);
  assert.deepEqual(saved.outlineGuides![0].beats.find(beat=>beat.id==='review_selected')!.storylineIds,['review_line']);
  assert.deepEqual(saved.units,author.units);assert.deepEqual(saved.storylines,author.storylines);
});

test('an adopted beat remains in current original-text order and stale quotes stay marked for review',()=>{
  const project=changed(fixture());
  const html=renderToStaticMarkup(React.createElement(OutlineBeats,{project,guides:project.outlineGuides!,unitId:project.units[0].id,editableOwner:project.outlineGuides![0].owner,onChange:()=>{}}));
  const ids=[...html.matchAll(/data-outline-beat="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(ids,['review_selected','review_later','review_shared_source']);
  assert.match(html,/原文待复核/);
});

test('the paragraph label derives from the closest valid source link and disappears when that source is stale',()=>{
  const project=fixture(),unit=project.units[0],guide=project.outlineGuides![0];
  unit.structureNodes=[{id:'review_parent',title:'第一幕'},{id:'review_child',title:'来信',parentId:'review_parent'}];
  guide.nodeLinks=[{unitId:unit.id,nodeId:'review_parent',anchor:anchorFor(project.brief.outline,0,13)},{unitId:unit.id,nodeId:'review_child',anchor:anchorFor(project.brief.outline,0,6)}];parseScriptProject(project);
  assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[{unitId:unit.id,nodeId:'review_child'}]);
  project.brief.outline='原文改过，没有重新认定。';
  assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[]);
});

test('the actual beat editor commits metadata and rejects a concurrent overwrite without touching original or links',()=>{
  const project=fixture(),owner=project.outlineGuides![0].owner;let saved=structuredClone(project);
  const tree=OutlineBeats({project,guides:project.outlineGuides!,unitId:project.units[0].id,editableOwner:owner,onChange:fn=>fn(saved)});
  const editor=elements(tree).find(element=>element.type===OutlineBeatTextEditor&&element.props.beat.id==='review_selected');assert.ok(editor);
  const baseline={title:'读信',change:'从怀疑到核实'};
  editor.props.onCommit({title:'读完来信',change:'决定亲自核实'},baseline);
  assert.equal(saved.outlineGuides![0].beats[0].title,'读完来信');assert.deepEqual(saved.units,project.units);
  assert.deepEqual(saved.outlineGuides![0].beats[0].anchors,project.outlineGuides![0].beats[0].anchors);
  assert.deepEqual(saved.outlineGuides![0].beats[0].storylineIds,['review_line']);
  const current=structuredClone(saved);assert.throws(()=>editor.props.onCommit({title:'过期编辑',change:'覆盖'},baseline),/已更新/);assert.deepEqual(saved,current);
});

test('a current story sees its assigned season beat while another story scene and paragraph names stay private',()=>{
  const project=fixture(),unit=project.units[0];project.profile.organization='episodic';project.profile.continuity='mixed';project.profile.plannedUnits=2;
  unit.scopeId='review_story';unit.seasonId='review_season';project.seasons=[{id:'review_season',title:'第一季',arc:'共同旧案'}];
  const other=newUnit('FOREIGN_STORY_TITLE',300000,'review_other_story');other.seasonId='review_season';
  other.structureNodes=[{id:'review_foreign_node',title:'FOREIGN_PARAGRAPH_TITLE'}];other.scenes[0].title='FOREIGN_SCENE_TITLE';
  project.units.push(other);const owner:OutlineOwner={kind:'season',id:'review_season'},guide=project.outlineGuides![0];guide.owner=owner;guide.id=outlineGuideId(owner);
  guide.nodeLinks=[{unitId:other.id,nodeId:'review_foreign_node',anchor:anchorFor('共同旧案',0,4)}];
  for(const beat of guide.beats)beat.anchors=[anchorFor('共同旧案',0,4)];
  guide.beats[0].sceneRefs.push({unitId:other.id,sceneId:other.scenes[0].id});
  guide.beats[1].unitIds=[other.id];guide.beats[2].unitIds=[other.id];parseScriptProject(project);
  const entries=beatsForUnit(project,unit);assert.ok(entries.some(entry=>entry.beat.id==='review_selected'));
  assert.equal(entries.some(entry=>entry.beat.id==='review_shared_source'),false);
  const guides=visibleOutlineGuides(project,unit).map(item=>({...item,beats:item.beats.filter(beat=>entries.some(entry=>entry.beat.id===beat.id))}));
  const html=renderToStaticMarkup(React.createElement(OutlineBeats,{project,guides,unitId:unit.id,editableOwner:{kind:'unit',id:unit.id},onChange:()=>{}}));
  assert.match(html,/读信/);assert.doesNotMatch(html,/FOREIGN_STORY_TITLE|FOREIGN_SCENE_TITLE|FOREIGN_PARAGRAPH_TITLE/);
  assert.equal(guide.beats[0].sceneRefs.length,2,'private relation stays in the data while its details are hidden');
});

test('the explicit season storyline view keeps other story scene titles private while retaining its relation count',()=>{
  const project=createScriptProject('共享季视图隔离检查',createScriptCreationProfile('anthology',2,5)),unit=project.units[0];
  unit.scopeId='review_story';unit.seasonId='review_season';project.seasons=[{id:'review_season',title:'第一季',arc:'共享调查'}];
  const other=newUnit('FOREIGN_STORY_TITLE',300000,'review_other_story');other.seasonId='review_season';other.scenes[0].title='FOREIGN_SCENE_TITLE';project.units.push(other);
  project.storylines=[{id:'review_season_line',scopeId:'review_season',lane:'A',title:'共享调查线',premise:'寻找证人',resolution:'核对证言'}];
  unit.scenes[0].storylineIds=['review_season_line'];other.scenes[0].storylineIds=['review_season_line'];parseScriptProject(project);
  const html=renderToStaticMarkup(React.createElement(ScriptStructure,{project,unit,owner:{kind:'season',id:'review_season'},onChange:()=>{},onOpenScene:()=>{}}));
  assert.match(html,/承接场景 · 2/);assert.doesNotMatch(html,/FOREIGN_STORY_TITLE|FOREIGN_SCENE_TITLE/);
  assert.deepEqual(other.scenes[0].storylineIds,['review_season_line']);
});
