import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptProject,newUnit} from '../packages/script/src/project';
import {parseScriptProject,type ProjectProfile} from '../packages/script/src/schema';
import {resolveScriptLocation,locationFromParams} from '../apps/web/src/features/script/scriptWorkspaceLocation';
import {inferDelegation,delegationCandidateKind,legacyTaskAnchor,unreturnedPlanningUnits} from '../apps/web/src/features/script/scriptAssistantIntent';
import {assistantShortcuts,type AssistantRequest} from '../apps/web/src/features/script/scriptAssistantShortcuts';
import {newGoalSelection,goalRangeSnapshot,goalRangeChanged,goalRangeSupportsStage,goalReviewTarget} from '../apps/web/src/features/script/scriptGoalAuthoring';
import type {ScriptDraftScope} from '../packages/script/src/agentScope';
import {freezeStructureScope} from '../packages/script/src/structure';
import Database from 'better-sqlite3';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {readScriptGoalEnvelope} from '../packages/script/src/agentGoal';
import {createScriptJob,parseScriptResult,applyScriptJob} from '../packages/script/src/proposals';
const profile:ProjectProfile={organization:'episodic',continuity:'anthology',workType:'电视剧',genres:['剧情'],language:'zh-CN',plannedUnits:24,targetDurationMs:1800000,toleranceMs:15000,includeCredits:true,aspectRatio:'16:9',productionMode:'live-action'};
const fixture=()=>{const p=createScriptProject('隔离验收',profile);p.units.push(newUnit('第 2 集',profile.targetDurationMs));return parseScriptProject(p);};
test('first blueprint work opens blueprint; outline, scene plan and body advance only default location',()=>{const p=fixture();assert.equal(resolveScriptLocation(p).view,'blueprint');p.brief.outline='第一集修桥，第二集送信';assert.equal(resolveScriptLocation(p).view,'outline');p.units[1].scenes[0].purpose='送信';assert.equal(resolveScriptLocation(p).view,'board');p.units[1].scenes[0].blocks[0].text='一封信';assert.equal(resolveScriptLocation(p).view,'studio');});
test('explicit page URL preserves selected unit and valid scene; deleted IDs resolve to valid parent',()=>{const p=fixture();const remembered={view:'studio' as const,unitId:p.units[1].id,sceneId:p.units[1].scenes[0].id};const next=resolveScriptLocation(p,locationFromParams(new URLSearchParams('view=outline')),remembered);assert.equal(next.unitId,p.units[1].id);assert.equal(next.sceneId,remembered.sceneId);assert.equal(next.view,'outline');assert.equal(resolveScriptLocation(p,{unitId:p.units[1].id,sceneId:'removed'},remembered).sceneId,p.units[1].scenes[0].id);});
test('natural-language handoff fixes episode one and SCENES even while page two is open',()=>{const p=fixture();const intent=inferDelegation(p,'帮我把第一集分场规划好，完成就停',null,p.units[1].id,'BODY');assert.deepEqual(intent,{unitId:p.units[0].id,stopAfter:'SCENES',nodeId:undefined,scopeId:undefined,seasonId:undefined});});
test('bound request retains its unit, node and stage across browsing',()=>{const p=fixture();const intent=inferDelegation(p,'继续整理',{id:1,text:'',label:'段落分场',unitId:p.units[0].id,nodeId:'node-a',stage:'SCENES'},p.units[1].id,'BODY');assert.equal(intent.unitId,p.units[0].id);assert.equal(intent.nodeId,'node-a');assert.equal(intent.stopAfter,'SCENES');});
test('node goals grant only the node and new unit goals grant necessary private entities',()=>{const p=fixture(),u=p.units[0];u.structureNodes=[{id:'node-a',title:'到站'}];const node=newGoalSelection(p,u,undefined,'WRITE',0,12,'SCENES',false,{kind:'node',nodeId:'node-a'});assert.deepEqual(node.target.structureTargets,[{unitId:u.id,nodeId:'node-a'}]);assert.equal(node.target.wholeUnitIds,undefined);const next=newGoalSelection(p,u,undefined,'WRITE',1,12);assert.equal(next.target.newUnitCharacterScopes,true);assert.equal(next.target.newUnitFactScopes,true);assert.equal(next.target.unitIds,undefined);});
test('story outline goal has a narrow grant and does not acquire whole project outline',()=>{const p=fixture(),u=p.units[0];const target=newGoalSelection(p,u,undefined,'WRITE',0,12,'OUTLINE',false,{kind:'story',scopeId:u.scopeId}).target;assert.equal(target.outlineTarget?.scopeId,u.scopeId);assert.equal(target.outlineTarget?.allowStructure,false);assert.equal(target.sharedFields,undefined);assert.equal(target.wholeUnitIds,undefined);});

test('reopening and revising a node Goal preserves identity even for two empty nodes',()=>{
  const p=fixture(),u=p.units[0];u.structureNodes=[{id:'node-a',title:'到站'},{id:'node-b',title:'离站'}];
  const scope={units:[{unitId:u.id,allowSummary:false,allowAllScenes:false,scenes:[],nodeScopes:[freezeStructureScope(p,u.id,'node-a')]}],sharedFields:[],storyOutlineScopeIds:[],seasonOutlineIds:[]} as unknown as ScriptDraftScope;
  const before=goalRangeSnapshot(scope);assert.equal(before.rangeKind,'node');assert.equal(before.nodeId,'node-a');assert.equal(before.unitId,u.id);
  assert.equal(goalRangeChanged(before,{...before,nodeId:'node-b'}),true,'switching empty nodes must revise the server contract');
  assert.equal(goalRangeChanged(before,{...before,unitId:p.units[1].id}),true);
  assert.deepEqual(goalReviewTarget(scope),{unitIds:[u.id],structureTargets:[{unitId:u.id,nodeId:'node-a'}]},'switch to review must retain the node');
  scope.units.push({...scope.units[0],unitId:p.units[1].id});const combined=goalRangeSnapshot(scope);
  assert.equal(combined.rangeKind,'existing');assert.equal(goalRangeChanged(combined,{...combined,unitId:p.units[1].id}),false,'background navigation does not replace a compound scope');
});

test('story and season outline Goals reopen with their exact owner and owner changes revise scope',()=>{
  const p=fixture(),u=p.units[0];
  const scope={units:[{unitId:u.id,allowSummary:false,allowAllScenes:false,scenes:[]}],sharedFields:[],storyOutlineScopeIds:[u.scopeId],seasonOutlineIds:[]} as unknown as ScriptDraftScope;
  const story=goalRangeSnapshot(scope);assert.equal(story.rangeKind,'story');assert.equal(story.outlineScope,u.scopeId);
  assert.equal(goalRangeChanged(story,{...story,outlineScope:p.units[1].scopeId}),true);
  scope.storyOutlineScopeIds=[];scope.seasonOutlineIds=['season-a'];const season=goalRangeSnapshot(scope);
  assert.equal(season.rangeKind,'season');assert.equal(season.outlineScope,'season-a');
});

test('the actual total-outline shortcut retains its owner and OUTLINE stop when handed off',()=>{
  const p=fixture(),u=p.units[0],text=assistantShortcuts.outline!.text;
  const context:AssistantRequest={id:1,text,label:'故事总纲',unitId:u.id,stage:'OUTLINE',operation:'outline',scopeId:p.id};
  const intent=inferDelegation(p,text,context,p.units[1].id,'BODY');
  assert.equal(intent.stopAfter,'OUTLINE','the blueprint mentioned as a source must not replace the delivery stage');
  assert.equal(intent.unitId,u.id);assert.equal(intent.projectOutlineOnly,true);
  const selection=newGoalSelection(p,u,undefined,'WRITE',0,24,intent.stopAfter,false,{kind:'project'});
  assert.deepEqual(selection.target,{unitIds:[u.id],outlineTarget:{unitId:u.id,scopeId:p.id,allowStructure:false,allowSceneOrder:false}});
  const story=inferDelegation(p,text,{...context,scopeId:u.scopeId},p.units[1].id,'BODY');
  assert.equal(story.stopAfter,'OUTLINE');assert.equal(story.scopeId,u.scopeId);assert.equal(story.projectOutlineOnly,undefined);
});

test('delegation distinguishes source stages from the requested deliverable and explicit stop',()=>{
  const p=fixture(),u=p.units[0];
  for(const text of ['根据已有大纲完成第1集正文','按分场写完正文']){
    assert.equal(inferDelegation(p,text,null,u.id,'OUTLINE').stopAfter,'BODY');
    assert.equal(inferDelegation(p,text,{id:0,text:'',label:'故事讨论',unitId:u.id,stage:'OUTLINE'},u.id,'OUTLINE').stopAfter,'BODY','typing binds the location, not an unrelated page stage');
  }
  const bound:AssistantRequest={id:2,text:'',label:'本场正文',unitId:u.id,sceneId:u.scenes[0].id,stage:'BODY',operation:'scene'};
  assert.equal(inferDelegation(p,'根据大纲继续',bound,u.id,'BLUEPRINT').stopAfter,'BODY');
  assert.equal(inferDelegation(p,'完成第1集分场就停',bound,u.id,'BODY').stopAfter,'SCENES');
  assert.equal(inferDelegation(p,'先做到故事大纲',bound,u.id,'BODY').stopAfter,'OUTLINE');
  assert.equal(inferDelegation(p,'只写本集大纲',bound,u.id,'BODY').stopAfter,'OUTLINE');
});

test('explicitly selecting another episode drops the old story and node identity',()=>{
  const p=fixture(),u=p.units[0];
  const intent=inferDelegation(p,'完成第2集分场就停',{id:3,text:'',label:'段落分场',unitId:u.id,nodeId:'node-a',scopeId:u.scopeId,seasonId:'old-season',stage:'SCENES'},u.id,'SCENES');
  assert.equal(intent.unitId,p.units[1].id);assert.equal(intent.nodeId,undefined);assert.equal(intent.scopeId,undefined);assert.equal(intent.seasonId,undefined);
});

test('text selections and finite episode batches use their candidate handoff instead of a wider Goal',()=>{
  const p=fixture(),u=p.units[0],base:AssistantRequest={id:1,text:'只修改选中文字',label:'选段精修',unitId:u.id,sceneId:u.scenes[0].id,stage:'BODY',operation:'text_rewrite',selection:{start:0,end:2,text:'原文'}};
  assert.equal(delegationCandidateKind(base),'selection');
  assert.equal(delegationCandidateKind({...base,operation:'consult'}),'selection','rewriting the message must not drop its selected text boundary');
  assert.equal(delegationCandidateKind({...base,selection:undefined,operation:'unit_outlines',unitIndices:[2,3]}),'batch');
  assert.equal(delegationCandidateKind({...base,selection:undefined,operation:'board_plan',unitIndices:[2,3]}),'batch');
  assert.equal(delegationCandidateKind({...base,selection:undefined,operation:'scene'}),null);
});

test('a stage change cannot silently replace node, scene or outline ranges with a whole unit',()=>{
  const p=fixture(),u=p.units[0];u.structureNodes=[{id:'node-a',title:'到站'}];
  assert.equal(goalRangeSupportsStage('node','BODY'),true);
  const narrow=newGoalSelection(p,u,undefined,'WRITE',0,12,'OUTLINE',false,{kind:'node',nodeId:'node-a'}).target;assert.equal(narrow.outlineTarget?.nodeId,'node-a');assert.equal(narrow.outlineTarget?.allowStructure,false);assert.equal(narrow.wholeUnitIds,undefined);
  assert.throws(()=>newGoalSelection(p,u,undefined,'WRITE',0,12,'BLUEPRINT',false,{kind:'scenes',sceneIds:[u.scenes[0].id]}),/明确选择范围/);
  assert.throws(()=>newGoalSelection(p,u,undefined,'WRITE',0,12,'BODY',false,{kind:'project'}),/明确选择范围/);
});

test('a new node review is accepted by the real command contract without creation permissions',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('No external model in UI contract test');}},'ui-node-review');
  const p=fixture(),u=p.units[0];u.structureNodes=[{id:'node-a',title:'到站'}];u.scenes[0].structureNodeId='node-a';u.scenes[0].blocks[0].text='机械正文';
  const thread=host.conversations.open('author','script:home','ui-node-review');
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'ui-node-review-workspace',source:{document:p}});
  const selection=newGoalSelection(p,u,workspace,'REVIEW',0,24,'SCENES',false,{kind:'node',nodeId:'node-a'});
  const receipt=await host.commands.submit('author',{kind:'GOAL_START',requestId:'ui-node-review-start',threadId:thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:1},objective:'审阅所选段落正文',task:'REVIEW',...selection,methodIds:[]},{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'fixture'})});
  const contract=readScriptGoalEnvelope(host.goals.read(receipt.goalId!,'author').revision.contract);
  assert.deepEqual(contract.scope.operations,[]);assert.equal(contract.scope.units[0].nodeScopes?.[0].nodeId,'node-a');
  assert.equal(contract.scope.units[0].nodeScopes?.[0].allowCreate,false);assert.equal(contract.scope.units[0].allowAllScenes,false);
  assert.deepEqual(contract.checks.targetScenes,[{unitId:u.id,sceneIds:[u.scenes[0].id]}]);
});

test('scene-only goals cannot silently become whole-episode reviews',()=>{
  const p=fixture(),u=p.units[0];
  assert.throws(()=>newGoalSelection(p,u,undefined,'REVIEW',0,24,'BODY',false,{kind:'scenes',sceneIds:[u.scenes[0].id]}),/不能将所选场景/);
  const scope={units:[{unitId:u.id,allowAllScenes:false,scenes:[{sceneId:u.scenes[0].id,blockIds:null}]}]} as ScriptDraftScope;
  assert.throws(()=>goalReviewTarget(scope),/不能将所选场景/);
  scope.units[0].allowAllScenes=true;
  assert.deepEqual(goalReviewTarget(scope),{unitIds:[u.id]});
  assert.deepEqual(newGoalSelection(p,u,undefined,'REVIEW',0,24,'BODY',false,{kind:'unit'}).target,{unitIds:[u.id]});
});

for(const operation of ['unit_outlines','board_plan'] as const)test(`${operation} can create and adopt a bounded candidate for an empty unit without an invented scene`,()=>{
  const p=fixture(),u=p.units[0];u.scenes=[];
  const original=JSON.stringify(p),anchor=legacyTaskAnchor(u,operation);
  assert.equal(anchor,u.id);
  const job=createScriptJob(p,{unitId:u.id,sceneId:anchor,operation,prompt:'只处理第1集',unitIndices:[1],expectedRevision:p.revision});
  assert.equal(JSON.stringify(p),original,'starting a planning job must not add a scene');
  const units=[{unitIndex:1,title:u.title,summary:'找到信件并决定送出。',...(operation==='board_plan'?{scenes:[{title:'找到信件',purpose:'人物在旧屋发现寄错的信。'}]}:{})}];
  const result=parseScriptResult(JSON.stringify({summary:'机械规划候选',units}),p,job);
  const adopted=applyScriptJob(p,{...job,status:'ready',result});
  assert.equal(adopted.units[0].summary,units[0].summary);
  assert.equal(adopted.units[0].scenes.length,operation==='board_plan'?1:0);
  assert.deepEqual(adopted.units[1],p.units[1]);
  assert.throws(()=>legacyTaskAnchor(u,'scene_turn'),/需要已有场景/);
});

test('the actual legacy assistant renders a batch request when its unit has no scenes',async()=>{
  const [{createElement},{renderToStaticMarkup},{ScriptAssistant}]=await Promise.all([import('react'),import('react-dom/server'),import('../apps/web/src/features/script/ScriptAssistant')]);
  const p=fixture(),u=p.units[0];u.scenes=[];
  const html=renderToStaticMarkup(createElement(ScriptAssistant,{project:p,unit:u,dirty:false,onSave:async()=>{},onApplied:()=>{},onOpenScene:()=>{},initialOperation:'unit_outlines',initialIssue:'只规划第1至3集',unitIndices:[1,2,3],submission:{id:1,channel:'external',methodIds:[]}}));
  assert.match(html,/只规划第1至3集/);assert.match(html,/对话与结果/);
  assert.doesNotMatch(html,/当前场：/);assert.equal(u.scenes.length,0);
});

for(const operation of ['unit_outlines','board_plan'] as const)test(`${operation} reports the requested episodes missing from a partial response`,()=>{
  const p=fixture(),u=p.units[0];
  const job=createScriptJob(p,{unitId:u.id,sceneId:u.scenes[0].id,operation,prompt:'本批只处理第1至3集',unitIndices:[1,2,3],expectedRevision:p.revision});
  const units=[{unitIndex:2,title:'第2集',summary:'送出信件。',...(operation==='board_plan'?{scenes:[{title:'送信',purpose:'人物把信送到旧址。'}]}:{})}];
  const result=parseScriptResult(JSON.stringify({summary:'模型概括不能替代批次核对',units}),p,job);
  assert.deepEqual(unreturnedPlanningUnits({...job,result}),[1,3]);
  assert.deepEqual(unreturnedPlanningUnits({...job,unitIndices:[2],result}),[]);
  assert.deepEqual(unreturnedPlanningUnits({...job,unitIndices:undefined,result}),[],'old jobs without a frozen batch must not invent an expected range');
  assert.deepEqual(unreturnedPlanningUnits(job),[],'waiting jobs do not yet have a returned batch');
});
