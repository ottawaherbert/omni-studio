import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/agent-core/src/identity';
import { createScriptProject, newScene } from '../packages/script/src/project';
import { parseScriptProject, type ScriptProject } from '../packages/script/src/schema';
import { freezeStructureScope, insertScenesInStructure } from '../packages/script/src/structure';
import { buildAgentDraft } from '../packages/script/src/agentDraft';
import { assertAgentDraftScope, emptyScriptDraftCreationLedger, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';
import { stageDelivery } from '../packages/script/src/agentStages';
import { defaultScriptChecks } from '../packages/script/src/agentGoal';
import { applyWorkspacePatch } from '../packages/script/src/workspacePatch';

function project(organization:'standalone'|'episodic'='standalone'):ScriptProject{
  const p=createScriptProject('范围回归',{organization,continuity:'serialized',workType:'剧情',genres:[],language:'zh-CN',plannedUnits:1,targetDurationMs:60000,toleranceMs:0,includeCredits:false,aspectRatio:'16:9',productionMode:'live-action'});
  p.revision=1;p.brief.outline='主人公进入屋子，找到钥匙后离开。';p.units[0].summary='本集进入屋子，找到钥匙后离开。';
  return p;
}
function grant(p:ScriptProject,nodeId?:string):ScriptDraftScope{
  const unit=p.units[0];
  return {workspaceId:'workspace_review',documentId:p.id,originRevision:p.revision,originContentHash:hashValue(p),
    operations:['plan_scenes','scene_plan'],units:[{unitId:unit.id,allowSummary:false,allowAllScenes:!nodeId,maxNewScenes:4,scenes:[],
      ...(nodeId?{nodeScopes:[freezeStructureScope(p,unit.id,nodeId,{allowCreate:true})]}:{})}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
}

test('first scene of an empty child stays inside its parent before an ungrouped tail',()=>{
  const p=project(),u=p.units[0];
  u.structureNodes=[{id:'parent',title:'父段'},{id:'empty_child',title:'待展开子段',parentId:'parent'}];
  u.scenes=[{...newScene('已有父段场'),structureNodeId:'parent'},newScene('未归组尾声')];
  u.scenes.forEach(scene=>{scene.blocks[0].text=`作者原文：${scene.title}`;});
  parseScriptProject(p);const original=structuredClone(u.scenes),addition=newScene('子段第一场');
  const next=insertScenesInStructure(p,u.id,[addition],{nodeId:'empty_child'});
  assert.deepEqual(next.units[0].scenes.map(scene=>scene.id),[original[0].id,addition.id,original[1].id]);
  assert.deepEqual(next.units[0].scenes[0],original[0]);assert.deepEqual(next.units[0].scenes[2],original[1]);
  assert.equal(next.units[0].scenes[1].structureNodeId,'empty_child');assert.deepEqual(u.scenes,original);
});

test('empty children respect a following sibling before falling back to the parent tail',()=>{
  const p=project(),u=p.units[0];
  u.structureNodes=[{id:'parent',title:'父段'},{id:'empty_child',title:'前子段',parentId:'parent'},
    {id:'later_child',title:'后子段',parentId:'parent'},{id:'next_root',title:'下一段'}];
  u.scenes=[{...newScene('父段开场'),structureNodeId:'parent'},{...newScene('后子段场'),structureNodeId:'later_child'},
    newScene('未归组场'),{...newScene('下一段场'),structureNodeId:'next_root'}];
  parseScriptProject(p);const addition=newScene('前子段场');
  const next=insertScenesInStructure(p,u.id,[addition],{nodeId:'empty_child'});
  assert.deepEqual(next.units[0].scenes.map(scene=>scene.id),[u.scenes[0].id,addition.id,...u.scenes.slice(1).map(scene=>scene.id)]);
});

for(const organization of ['standalone','episodic'] as const)test(`${organization} whole-unit SCENES maps grouped new and existing scenes to the unit outline`,()=>{
  const p=project(organization),u=p.units[0];u.structureNodes=[{id:'node_a',title:'第一段',purpose:'进入屋子找到钥匙'}];u.scenes=[];
  const scope=grant(p),ledger=emptyScriptDraftCreationLedger(),basis=collectOutlineRequirements(p,[{unitId:u.id}]);
  const requirementId=basis.items[0].id;
  const planned=buildAgentDraft(JSON.stringify({summary:'展开本集',scenes:[{localKey:'entry',title:'找钥匙',purpose:'进入房间找到钥匙',location:'房间',timeOfDay:'日',outlineRequirementIds:[requirementId]}]}),
    {candidateId:'grouped_plan',operation:'plan_scenes',unitId:u.id,nodeId:'node_a'},p,scope,{origin:p,ledger});
  const next=applyWorkspacePatch(p,planned.patch),sceneId=planned.idMap['scene:entry'];ledger.scenes.push({unitId:u.id,sceneId});
  const revised=buildAgentDraft(JSON.stringify({summary:'补足离开',title:'找钥匙后离开',purpose:'进入房间找到钥匙后离开',location:'房间',timeOfDay:'日',entryState:'门口',exitState:'离开屋子',outlineRequirementIds:[requirementId]}),
    {candidateId:'grouped_revise',operation:'scene_plan',unitId:u.id,sceneId},next,scope,{origin:p,ledger});
  const adoptScope:ScriptDraftScope={...scope,originContentHash:hashValue(next),units:[{unitId:u.id,allowSummary:false,allowAllScenes:false,maxNewScenes:0,
    scenes:[{sceneId,allowPlan:true,allowBody:false,blockIds:null}]}]};
  assert.doesNotThrow(()=>assertAgentDraftScope(next,revised.patch,adoptScope,'scene_plan',{...revised.request,origin:next,ledger:emptyScriptDraftCreationLedger()}));
  const finished=applyWorkspacePatch(next,revised.patch);
  const contract=defaultScriptChecks([u.id],1,undefined,{originRevision:p.revision,targets:[{unitId:u.id}]});
  contract.outlineRequirements=basis.items;contract.outlineGaps=basis.gaps;
  const delivery=stageDelivery(finished,scope,'SCENES',{ledger,contract});
  assert.equal(delivery.ready,true);assert.deepEqual(delivery.gaps,[]);
});

test('narrow node mappings include its parent goal but reject unit and unrelated node requirements',()=>{
  const p=project(),u=p.units[0];u.structureNodes=[{id:'selected',title:'本次段落',purpose:'找到钥匙'},
    {id:'child',parentId:'selected',title:'子段',purpose:'打开抽屉'},{id:'unrelated',title:'其他段落',purpose:'远处的另一件事'}];
  u.scenes=[{...newScene('抽屉'),structureNodeId:'child',purpose:'拉开抽屉',location:'房间'}];
  const scope=grant(p,'selected'),check={origin:p,ledger:emptyScriptDraftCreationLedger()};
  const own=collectOutlineRequirements(p,[{unitId:u.id,nodeIds:['selected']}]).items[0].id;
  const outside=[collectOutlineRequirements(p,[{unitId:u.id}]).items[0].id,
    collectOutlineRequirements(p,[{unitId:u.id,nodeIds:['unrelated']}]).items[0].id];
  const raw=(requirementId:string)=>JSON.stringify({summary:'映射',title:'抽屉',purpose:'拉开抽屉找到钥匙',location:'房间',timeOfDay:'日',entryState:'寻找中',exitState:'找到钥匙',outlineRequirementIds:[requirementId]});
  const request={candidateId:'narrow_map',operation:'scene_plan' as const,unitId:u.id,sceneId:u.scenes[0].id};
  assert.doesNotThrow(()=>buildAgentDraft(raw(own),request,p,scope,check));
  for(const requirementId of outside){
    assert.throws(()=>buildAgentDraft(raw(requirementId),request,p,scope,check),/范围外的大纲/);
    assert.throws(()=>buildAgentDraft(raw(requirementId),{...request,nodeId:'unrelated'},p,scope,check),/范围外的大纲/);
    assert.throws(()=>buildAgentDraft(JSON.stringify({summary:'越界映射',scenes:[{localKey:'new',title:'补场',purpose:'开门',location:'房间',timeOfDay:'日',outlineRequirementIds:[requirementId]}]}),
      {candidateId:'narrow_add',operation:'plan_scenes',unitId:u.id,nodeId:'child'},p,scope,check),/范围外的大纲/);
  }
});
