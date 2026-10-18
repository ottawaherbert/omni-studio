import {hashValue} from '../../agent-core/src/identity';
import type {ScriptProject} from './schema';
import {structureGrantHash} from './outlineGuides';
import {structureNodeSceneIds,updateUnitStructure} from './structure';
export type SceneOrderGrant={unitId:string;nodeId?:string;sceneIds:string[];structureHash:string};
export function freezeSceneOrder(project:ScriptProject,unitId:string,nodeId?:string):SceneOrderGrant{const unit=project.units.find(u=>u.id===unitId);if(!unit)throw new Error('场序单元不存在');return {unitId,...(nodeId?{nodeId}:{}),sceneIds:nodeId?structureNodeSceneIds(unit,nodeId):unit.scenes.map(s=>s.id),structureHash:structureGrantHash(unit)};}
export function reorderScenes(project:ScriptProject,grant:SceneOrderGrant,sceneIds:unknown):ScriptProject{
  const current=freezeSceneOrder(project,grant.unitId,grant.nodeId);if(hashValue(current)!==hashValue(grant))throw new Error('场景顺序或成员已变化，请重新选择范围');
  if(!Array.isArray(sceneIds)||sceneIds.length!==grant.sceneIds.length||new Set(sceneIds).size!==sceneIds.length||sceneIds.some(id=>!grant.sceneIds.includes(id)))throw new Error('场序候选必须只排列获准的全部场景');
  const unit=project.units.find(u=>u.id===grant.unitId)!;let cursor=0;const sceneOrder=unit.scenes.map(scene=>grant.sceneIds.includes(scene.id)?sceneIds[cursor++]:scene.id);
  const next=updateUnitStructure(project,unit.id,{nodes:unit.structureNodes??[],sceneOrder,sceneMembership:Object.fromEntries(unit.scenes.map(scene=>[scene.id,scene.structureNodeId??null]))});if(unit.structureNodes===undefined)delete next.units.find(u=>u.id===unit.id)!.structureNodes;return next;
}
