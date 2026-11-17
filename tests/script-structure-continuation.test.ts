import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/domain/src/contentIdentity';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { parseScriptProject, type ScriptProject } from '../packages/script/src/schema';
import { freezeStructureScope, updateUnitStructure, insertScenesInStructure, assertFrozenStructureScopeCurrent } from '../packages/script/src/structure';
import { appendSceneContinuation, createSceneContinuationCheckpoint } from '../packages/script/src/continuation';
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

test('24 planned episodes, request 3, return 1 adopts only one and rejects out-of-range results without placeholder growth',()=>{
  const p=project(),u=p.units[0];
  const job=createScriptJob(p,{operation:'unit_outlines',unitId:u.id,sceneId:u.id,prompt:'只规划前三集',expectedRevision:p.revision,unitIndices:[1,2,3]});
  job.result=parseScriptResult(JSON.stringify({summary:'一集',units:[{unitIndex:1,summary:'第一集大纲'}]}),p,job);job.status='ready';
  const next=applyScriptJob(p,job);assert.equal(next.units.length,1);assert.equal(next.profile.plannedUnits,24);
  assert.throws(()=>parseScriptResult(JSON.stringify({summary:'越界',units:[{unitIndex:4,summary:'第四集'}]}),p,job),/范围/);
  const copy=structuredClone(p);assert.throws(()=>applyUnitOutlines(copy,[{unitIndex:2,summary:'二'},{unitIndex:4,summary:'四'}],[2,4]),/不连续/);assert.deepEqual(copy,p);
  const first=project();applyUnitOutlines(first,[{unitIndex:1,summary:'一'}],[1,2,3]);applyUnitOutlines(first,[{unitIndex:1,summary:'一'}],[1,2,3]);assert.equal(first.units.length,1);
});
