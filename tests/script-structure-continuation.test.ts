import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/agent-core/src/identity';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { parseScriptProject, type ScriptProject } from '../packages/script/src/schema';
import { freezeStructureScope, updateUnitStructure, insertScenesInStructure, assertFrozenStructureScopeCurrent } from '../packages/script/src/structure';
import { appendSceneContinuation, createSceneContinuationCheckpoint } from '../packages/script/src/continuation';
import { buildAgentDraft } from '../packages/script/src/agentDraft';
import { assertAgentDraftScope, assertStructureScopesCurrent, emptyScriptDraftCreationLedger, validateScriptDraftScope, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { applyWorkspacePatch, createWorkspacePatch } from '../packages/script/src/workspacePatch';
import { applyUnitOutlines, applyWholeBoardPlan } from '../packages/script/src/planning';
import { createScriptJob, parseScriptResult, applyScriptJob } from '../packages/script/src/proposals';

function project():ScriptProject{
  const p=createScriptProject('测试剧本',{organization:'episodic',continuity:'anthology',workType:'剧情',genres:[],language:'zh-CN',plannedUnits:24,targetDurationMs:60000,toleranceMs:0,includeCredits:false,aspectRatio:'16:9',productionMode:'live-action'});
  p.revision=1;return p;
}
function grouped():ScriptProject{
  const p=project(),u=p.units[0];u.summary='先进入，再发现，最后离开。';
  u.structureNodes=[{id:'act_a',title:'进入',purpose:'进入房间'},{id:'seq_a',parentId:'act_a',title:'发现',purpose:'发现抽屉'},{id:'act_b',title:'离开',purpose:'离开房间'},{id:'act_c',title:'尾声',purpose:'关门'}];
  u.scenes=['a','b','c','d'].map((id,index)=>({...newScene(`场${id}`),id:`scene_${id}`,structureNodeId:['act_a','seq_a','act_b','act_c'][index],blocks:[{id:`block_${id}`,type:'action',text:`动作${id}`}]}));
  return parseScriptProject(p);
}
function grant(p:ScriptProject,nodeId?:string):ScriptDraftScope{
  const u=p.units[0],frozen=nodeId?freezeStructureScope(p,u.id,nodeId,{allowCreate:true}):undefined;
  return {workspaceId:'workspace_test',documentId:p.id,originRevision:p.revision,originContentHash:hashValue(p),operations:['plan_structure','plan_scenes','scene_plan','scene_body','append_scene_body','story_outline','season_outline'],
    units:[{unitId:u.id,allowSummary:false,allowAllScenes:!nodeId,maxNewScenes:10,scenes:[],...(frozen?{nodeScopes:[frozen]}:{allowStructure:true})}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[],storyOutlineScopeIds:[u.scopeId],seasonOutlineIds:p.seasons?.map(season=>season.id)??[]};
}
const block=(key:string,text:string)=>({localKey:key,type:'action',text,speakerId:null,speakerName:null});
const rows=[{localKey:'new',title:'新场',purpose:'新的行动',location:'',timeOfDay:''}];

test('old documents retain absent optional data; malformed depth, interval and directory order reject',()=>{
  const p=project();assert.deepEqual(parseScriptProject(p),p);assert.equal(p.units[0].structureNodes,undefined);
  const g=grouped(),u=g.units[0];
  const deep=structuredClone(g);deep.units[0].structureNodes!.push({id:'too_deep',parentId:'seq_a',title:'第三层'});assert.throws(()=>parseScriptProject(deep),/两层/);
  const broken=structuredClone(g);broken.units[0].scenes[3].structureNodeId='act_a';assert.throws(()=>parseScriptProject(broken),/连续区间/);
  const reversed=structuredClone(g);reversed.units[0].structureNodes=[u.structureNodes![2],...u.structureNodes!.slice(0,2),u.structureNodes![3]];assert.throws(()=>parseScriptProject(reversed),/顺序/);
});

test('renaming/reordering nodes moves canonical intervals without replacing IDs or text, and inserts at the prior node',()=>{
  const p=grouped(),u=p.units[0],before=structuredClone(u.scenes);
  const nodes=[{...u.structureNodes![2],title:'先离开'},...u.structureNodes!.slice(0,2),u.structureNodes![3]];
  const moved=updateUnitStructure(p,u.id,{nodes});assert.deepEqual(moved.units[0].scenes.map(scene=>scene.id),['scene_c','scene_a','scene_b','scene_d']);
  for(const scene of moved.units[0].scenes)assert.deepEqual(scene,before.find(item=>item.id===scene.id));
  const inserted=insertScenesInStructure(moved,u.id,[newScene('补场')],{nodeId:'act_b'});
  assert.equal(inserted.units[0].scenes[1].structureNodeId,'act_b');assert.equal(inserted.units[0].scenes[2].id,'scene_a');
  assert.deepEqual(p.units[0].scenes,before);
});

test('membership and order change atomically; ungrouped scenes remain present',()=>{
  const p=grouped(),u=p.units[0],copy=structuredClone(p);
  assert.throws(()=>updateUnitStructure(p,u.id,{nodes:u.structureNodes!,sceneMembership:{scene_d:'act_a'}}),/连续区间/);assert.deepEqual(p,copy);
  const moved=updateUnitStructure(p,u.id,{nodes:u.structureNodes!,sceneMembership:{scene_d:'act_a'},sceneOrder:['scene_a','scene_b','scene_d','scene_c']});assert.equal(moved.units[0].scenes[2].id,'scene_d');
  const ungrouped=updateUnitStructure(p,u.id,{nodes:u.structureNodes!,sceneMembership:{scene_a:null}});assert.equal(ungrouped.units[0].scenes[0].id,'scene_a');assert.equal(ungrouped.units[0].scenes[0].structureNodeId,undefined);
});

test('node scope permits title refresh and unrelated work but rejects moved/deleted members, adjacency or changed outline',()=>{
  const p=grouped(),u=p.units[0],f=freezeStructureScope(p,u.id,'act_a',{allowCreate:true});
  const renamed=structuredClone(p);renamed.units[0].structureNodes![0].title='新标题';renamed.units[0].structureNodes![3].purpose='不相邻节点的计划变化';assert.doesNotThrow(()=>assertFrozenStructureScopeCurrent(renamed,u.id,f));
  const incoming=structuredClone(p);incoming.units[0].scenes[2].structureNodeId='act_a';assert.throws(()=>assertFrozenStructureScopeCurrent(incoming,u.id,f),/范围/);
  const outgoing=structuredClone(p);delete outgoing.units[0].scenes[0].structureNodeId;assert.throws(()=>assertFrozenStructureScopeCurrent(outgoing,u.id,f),/范围/);
  const deleted=structuredClone(p);deleted.units[0].structureNodes=deleted.units[0].structureNodes!.filter(node=>node.id!=='act_a');assert.throws(()=>assertFrozenStructureScopeCurrent(deleted,u.id,f),/删除/);
  const changed=structuredClone(p);changed.units[0].summary+='改纲';assert.throws(()=>assertFrozenStructureScopeCurrent(changed,u.id,f),/版本/);
});

test('legal created scenes join a node only through the creation ledger; a late response cannot write a moved scene',()=>{
  const p=grouped(),u=p.units[0],scope=grant(p,'act_a'),ledger=emptyScriptDraftCreationLedger();
  const request={candidateId:'candidate_create',operation:'plan_scenes' as const,unitId:u.id,nodeId:'seq_a'};
  const candidate=buildAgentDraft(JSON.stringify({summary:'补分场',scenes:rows}),request,p,scope,{origin:p,ledger});
  const next=applyWorkspacePatch(p,candidate.patch);next.revision++;
  const id=candidate.idMap['scene:new'];assert.equal(next.units[0].scenes[2].id,id);
  assert.throws(()=>assertStructureScopesCurrent(next,scope,ledger),/范围/);
  ledger.scenes.push({unitId:u.id,sceneId:id});assert.doesNotThrow(()=>assertStructureScopesCurrent(next,scope,ledger));
  assert.doesNotThrow(()=>buildAgentDraft(JSON.stringify({summary:'正文',blocks:[block('a','新增正文')]}),{candidateId:'candidate_body',operation:'scene_body',unitId:u.id,sceneId:id},next,scope,{origin:p,ledger}));
  const moved=structuredClone(next);moved.units[0].scenes.find(scene=>scene.id===id)!.structureNodeId='act_b';
  assert.throws(()=>assertStructureScopesCurrent(moved,scope,ledger),/移出/);
  const outsider=structuredClone(p);outsider.units[0].scenes[2].structureNodeId='act_a';
  assert.throws(()=>assertAgentDraftScope(outsider,candidate.patch,scope,'plan_scenes',{origin:p,ledger:emptyScriptDraftCreationLedger(),...request}),/范围/);
});

test('same scene continues three times, preserves every prior block and records partial then complete; exact retry is a no-op',()=>{
  const p=grouped(),unitId=p.units[0].id,sceneId='scene_a';let current=p;const original=structuredClone(p.units[0].scenes[0].blocks);
  let first:any;
  for(let index=1;index<=3;index++){
    const checkpoint=createSceneContinuationCheckpoint(current,unitId,sceneId),blocks=[{id:`append_${index}`,type:'action' as const,text:`后续行动 ${index}`}];
    const result=appendSceneContinuation(current,unitId,sceneId,blocks,{stepId:`step_${index}`,checkpoint,isComplete:index===3});
    assert.equal(result.applied,true);if(index===1)first={checkpoint,blocks};current=result.project;current.revision++;
    assert.equal(current.units[0].scenes[0].generation?.status,index===3?'complete':'partial');
  }
  assert.deepEqual(current.units[0].scenes[0].blocks.slice(0,original.length),original);assert.equal(current.units[0].scenes[0].blocks.length,4);
  const replay=appendSceneContinuation(current,unitId,sceneId,first.blocks,{stepId:'step_1',checkpoint:first.checkpoint,isComplete:false});assert.equal(replay.applied,false);assert.deepEqual(replay.project,current);
  assert.throws(()=>appendSceneContinuation(current,unitId,sceneId,[{...first.blocks[0],text:'改写重放'}],{stepId:'step_1',checkpoint:first.checkpoint,isComplete:false}),/不同内容/);
});

test('manual tail changes, revision changes, moves, duplicate prior output and truncated JSON never append',()=>{
  const p=grouped(),unitId=p.units[0].id,sceneId='scene_a',checkpoint=createSceneContinuationCheckpoint(p,unitId,sceneId),blocks=[{id:'append',type:'action' as const,text:'新正文'}];
  for(const mutate of [(p:ScriptProject)=>{p.revision++;},(p:ScriptProject)=>{p.units[0].scenes[0].blocks[0].text+='手改';},(p:ScriptProject)=>{p.units[0].scenes.reverse();}]){
    const changed=structuredClone(p);mutate(changed);assert.throws(()=>appendSceneContinuation(changed,unitId,sceneId,blocks,{stepId:'stale',checkpoint,isComplete:false}),/检查点/);
  }
  assert.throws(()=>appendSceneContinuation(p,unitId,sceneId,[{...blocks[0],text:'动作a'}],{stepId:'duplicate',checkpoint,isComplete:false}),/重复/);
  assert.throws(()=>buildAgentDraft('{"summary":"半截","blocks":[',{candidateId:'broken',operation:'append_scene_body',unitId,sceneId,continuationCheckpoint:checkpoint},p,grant(p),{origin:p,ledger:emptyScriptDraftCreationLedger()}),/JSON/);
  assert.equal(p.units[0].scenes[0].blocks.length,1);
});

test('append candidate is narrow, verifies the old prefix independently, and replay still requires authority',()=>{
  const p=grouped(),scope=grant(p,'act_a'),ledger=emptyScriptDraftCreationLedger(),unitId=p.units[0].id;
  const request={candidateId:'append_candidate',operation:'append_scene_body' as const,unitId,sceneId:'scene_a',continuationCheckpoint:createSceneContinuationCheckpoint(p,unitId,'scene_a')};
  const raw=JSON.stringify({summary:'继续',blocks:[block('new','第二个动作')],isComplete:false}),candidate=buildAgentDraft(raw,request,p,scope,{origin:p,ledger});
  const next=applyWorkspacePatch(p,candidate.patch);next.revision++;
  assert.equal(next.units[0].scenes[0].generation?.status,'partial');assert.equal(buildAgentDraft(raw,request,next,scope,{origin:p,ledger}).replayed,true);
  const badScope=structuredClone(scope);badScope.operations=badScope.operations.filter(operation=>operation!=='append_scene_body');assert.throws(()=>buildAgentDraft(raw,request,next,badScope,{origin:p,ledger}),/授权/);
  const forged=structuredClone(next);forged.revision=p.revision;forged.units[0].scenes[0].blocks[0].text='覆盖旧文';
  assert.throws(()=>assertAgentDraftScope(p,createWorkspacePatch(p,forged),scope,'append_scene_body',{origin:p,ledger,...request}),/检查点以前/);
});

test('story and season candidates change exactly one authorized owner; unrelated owner edits merge',()=>{
  const p=project();p.units.push(newUnit('B',60000));p.seasons=[{id:'season_one',title:'第一季',arc:'季原文'}];p.brief.outline='旧混合总纲';
  const scope=grant(p),check={origin:p,ledger:emptyScriptDraftCreationLedger()},a=p.units[0].scopeId,b=p.units[1].scopeId;
  const request={candidateId:'story_a',operation:'story_outline' as const,scopeId:a};
  const candidate=buildAgentDraft(JSON.stringify({summary:'A大纲',content:'只写A'}),request,p,scope,check);
  const author=structuredClone(p);author.storyOutlines=[{scopeId:b,outline:'只写B'}];
  const adopted=applyWorkspacePatch(author,candidate.patch);assert.equal(adopted.brief.outline,'旧混合总纲');assert.equal(adopted.storyOutlines?.find(item=>item.scopeId===b)?.outline,'只写B');
  assert.throws(()=>buildAgentDraft(JSON.stringify({summary:'越权',content:'B'}),{...request,scopeId:b},p,scope,check),/未授权/);
  const season=buildAgentDraft(JSON.stringify({summary:'季',content:'新季大纲'}),{candidateId:'season',operation:'season_outline',seasonId:'season_one'},p,scope,check);assert.equal(applyWorkspacePatch(p,season.patch).seasons![0].arc,'新季大纲');
});

test('24 planned episodes, request 3, return 1 adopts only one and rejects out-of-range results without placeholder growth',()=>{
  const p=project(),u=p.units[0];
  const job=createScriptJob(p,{operation:'unit_outlines',unitId:u.id,sceneId:u.id,prompt:'只规划前三集',expectedRevision:p.revision,unitIndices:[1,2,3]});
  job.result=parseScriptResult(JSON.stringify({summary:'一集',units:[{unitIndex:1,summary:'第一集大纲'}]}),p,job);job.status='ready';
  const next=applyScriptJob(p,job);assert.equal(next.units.length,1);assert.equal(next.profile.plannedUnits,24);
  assert.throws(()=>parseScriptResult(JSON.stringify({summary:'越界',units:[{unitIndex:4,summary:'第四集'}]}),p,job),/范围/);
  const copy=structuredClone(p);assert.throws(()=>applyUnitOutlines(copy,[{unitIndex:2,summary:'二'},{unitIndex:4,summary:'四'}],[2,4]),/不连续/);assert.deepEqual(copy,p);
  const first=project();applyUnitOutlines(first,[{unitIndex:1,summary:'一'}],[1,2,3]);applyUnitOutlines(first,[{unitIndex:1,summary:'一'}],[1,2,3]);assert.equal(first.units.length,1);
});

test('first batch replaces only a genuinely empty placeholder; location, action and references preserve it',()=>{
  for(const kind of ['empty','location','action','reference']){
    const p=project(),u=p.units[0],scene=u.scenes[0],oldId=scene.id;
    if(kind==='location')scene.location='旧车站';if(kind==='action')scene.blocks[0].text='作者行动';
    if(kind==='reference')u.timeline.push({id:'timeline_ref',sceneId:oldId,track:'a',modality:'video',kind:'marker',startMs:0,endMs:0,included:true,label:'作者引用',contentHash:''});
    const candidate=buildAgentDraft(JSON.stringify({summary:'第一批',scenes:rows}),{candidateId:`batch_${kind}`,operation:'plan_scenes',unitId:u.id},p,grant(p),{origin:p,ledger:emptyScriptDraftCreationLedger()});
    const result=applyWorkspacePatch(p,candidate.patch);assert.equal(result.units[0].scenes.some(item=>item.id===oldId),kind!=='empty');assert.equal(result.units[0].scenes.length,kind==='empty'?1:2);
  }
  const p=project();p.units[0].scenes[0].location='作者地点';const before=structuredClone(p.units[0].scenes);applyWholeBoardPlan(p,[{unitIndex:1,scenes:[{purpose:'新计划'}]}],[1]);assert.deepEqual(p.units[0].scenes,before);
});

test('first structure plan preserves scene identity and grants no rewrite or unknown outline requirements',()=>{
  const p=project(),u=p.units[0],scope=grant(p),check={origin:p,ledger:emptyScriptDraftCreationLedger()},sceneId=u.scenes[0].id;
  const candidate=buildAgentDraft(JSON.stringify({summary:'结构',nodes:[{localKey:'act',parentLocalKey:null,title:'开场',purpose:'来到这里',sceneIds:[sceneId]}]}),{candidateId:'structure',operation:'plan_structure',unitId:u.id},p,scope,check);
  const next=applyWorkspacePatch(p,candidate.patch);assert.equal(next.units[0].scenes[0].id,sceneId);assert.deepEqual(next.units[0].scenes[0].blocks,u.scenes[0].blocks);
  assert.throws(()=>buildAgentDraft(JSON.stringify({summary:'映射越权',scenes:[{...rows[0],outlineRequirementIds:['not_current_outline']}]}),{candidateId:'bad_map',operation:'plan_scenes',unitId:u.id},p,scope,check),/大纲要求/);
});

test('empty nodes have an insertion position and frozen stop points cannot be bypassed by a new scene',()=>{
  const p=grouped(),u=p.units[0];u.structureNodes!.splice(2,0,{id:'empty_node',title:'待补段落',purpose:'补充转折'});
  const inserted=insertScenesInStructure(p,u.id,[newScene('转折')],{nodeId:'empty_node'});assert.equal(inserted.units[0].scenes[2].structureNodeId,'empty_node');
  const scope=grant(p,'act_a');scope.units[0].nodeScopes=[freezeStructureScope(p,u.id,'act_a',{allowCreate:true,stopAfterSceneId:'scene_a'})];
  const check={origin:p,ledger:emptyScriptDraftCreationLedger()};
  assert.throws(()=>buildAgentDraft(JSON.stringify({summary:'越停点',blocks:[block('late','越过停点')]}),{candidateId:'late_stop',operation:'scene_body',unitId:u.id,sceneId:'scene_b'},p,scope,check),/范围/);
  assert.throws(()=>buildAgentDraft(JSON.stringify({summary:'新增越停点',scenes:rows}),{candidateId:'new_stop',operation:'plan_scenes',unitId:u.id,nodeId:'act_a'},p,scope,check),/停点/);
  const whole=grant(p);whole.units[0].nodeScopes=[];assert.doesNotThrow(()=>validateScriptDraftScope(p,whole));
});

test('typed scene replacement cannot omit generation state or use node planning to smuggle author metadata',()=>{
  const p=project(),scope=grant(p),check={origin:p,ledger:emptyScriptDraftCreationLedger()},unitId=p.units[0].id;
  const forged=structuredClone(p);forged.units[0].scenes[0].blocks=[{id:'forged_block',type:'action',text:'省略完成台账'}];
  assert.throws(()=>assertAgentDraftScope(p,createWorkspacePatch(p,forged),scope,'scene_body',{...check,candidateId:'forged',unitId,sceneId:p.units[0].scenes[0].id}),/完成台账/);
  const nodes=structuredClone(p);nodes.units[0].structureNodes=[{id:'new_node',title:'开场',unknown:'偷偷夹带'} as any];
  assert.throws(()=>assertAgentDraftScope(p,createWorkspacePatch(p,nodes),scope,'plan_structure',{...check,candidateId:'forged_node',unitId}),/字段/);
});
