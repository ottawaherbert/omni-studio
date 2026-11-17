import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/domain/src/contentIdentity';
import { createScriptProject, newScene } from '../packages/script/src/project';
import { parseScriptProject, type ScriptProject } from '../packages/script/src/schema';
import { freezeStructureScope, insertScenesInStructure } from '../packages/script/src/structure';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';
import { } from '../packages/script/src/writingStages';
import { applyWorkspacePatch } from '../packages/script/src/workspacePatch';

function project(organization:'standalone'|'episodic'='standalone'):ScriptProject{
  const p=createScriptProject('范围回归',{organization,continuity:'serialized',workType:'剧情',genres:[],language:'zh-CN',plannedUnits:1,targetDurationMs:60000,toleranceMs:0,includeCredits:false,aspectRatio:'16:9',productionMode:'live-action'});
  p.revision=1;p.brief.outline='主人公进入屋子，找到钥匙后离开。';p.units[0].summary='本集进入屋子，找到钥匙后离开。';
  return p;
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
