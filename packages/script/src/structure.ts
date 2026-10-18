import { hashValue } from '../../agent-core/src/identity';
import { parseScriptProject, type DeliveryUnit, type Scene, type ScriptProject, type StructureNode } from './schema';

export type StructureInsertion = { nodeId?: string; beforeSceneId?: string; afterSceneId?: string };
export type FrozenStructureScope = {
  nodeId: string; descendantNodeIds: string[]; sceneIds: string[];
  structureHash: string; outlineHash: string; allowCreate: boolean; stopAfterSceneId?: string;
};
const unitOf=(project:ScriptProject,unitId:string)=>{const unit=project.units.find(item=>item.id===unitId);if(!unit)throw new Error('结构所在单元不存在');return unit;};
export function structureNodeSceneIds(unit:DeliveryUnit,nodeId:string):string[]{
  if(!unit.structureNodes?.some(node=>node.id===nodeId))throw new Error('结构节点不存在');
  const children=new Set([nodeId,...unit.structureNodes.filter(node=>node.parentId===nodeId).map(node=>node.id)]);
  return unit.scenes.filter(scene=>scene.structureNodeId&&children.has(scene.structureNodeId)).map(scene=>scene.id);
}
export function orderNodeIntervals(unit:DeliveryUnit,nodes:StructureNode[]):Scene[]{
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const reorder=(scenes:Scene[],parentId?:string):Scene[]=>{
    const siblings=nodes.filter(node=>node.parentId===parentId);
    const classify=(scene:Scene)=>{const direct=byId.get(scene.structureNodeId??'');return parentId?(direct?.parentId===parentId?direct.id:undefined):(direct?.parentId??direct?.id);};
    const groups=siblings.map(node=>({node,scenes:scenes.filter(scene=>classify(scene)===node.id)})).filter(group=>group.scenes.length);
    const seen=new Set<string>();let cursor=0;const result:Scene[]=[];
    for(const scene of scenes){const id=classify(scene);if(!id){result.push(scene);continue;}if(seen.has(id))continue;seen.add(id);const group=groups[cursor++];result.push(...(parentId?group.scenes:reorder(group.scenes,group.node.id)));}
    return result;
  };
  return reorder(unit.scenes);
}
/** Reversible author action. Membership, directory and scene order validate as one document. */
export function updateUnitStructure(project:ScriptProject,unitId:string,change:{nodes:StructureNode[];sceneOrder?:string[];sceneMembership?:Record<string,string|null>}):ScriptProject{
  const next=structuredClone(project),unit=unitOf(next,unitId);
  unit.structureNodes=structuredClone(change.nodes);
  for(const [sceneId,nodeId] of Object.entries(change.sceneMembership??{})){
    const scene=unit.scenes.find(item=>item.id===sceneId);if(!scene)throw new Error('不能移动不存在的场景');
    if(nodeId===null)delete scene.structureNodeId;else scene.structureNodeId=nodeId;
  }
  if(change.sceneOrder){
    if(change.sceneOrder.length!==unit.scenes.length||new Set(change.sceneOrder).size!==unit.scenes.length)throw new Error('原子场序须包含全部已有场景一次');
    const byId=new Map(unit.scenes.map(scene=>[scene.id,scene]));unit.scenes=change.sceneOrder.map(id=>{const scene=byId.get(id);if(!scene)throw new Error('场序包含未知场景');return scene;});
  }else if(!change.sceneMembership)unit.scenes=orderNodeIntervals(unit,change.nodes);
  return parseScriptProject(next);
}
/** Shared by insertion and drafting context so both use the same predecessor. */
export function structureInsertionIndex(unit:DeliveryUnit,target:StructureInsertion={}):number{
  if(target.beforeSceneId&&target.afterSceneId)throw new Error('插入只能指定一个前后锚点');
  if(target.nodeId&&!unit.structureNodes?.some(node=>node.id===target.nodeId))throw new Error('插入节点不存在');
  const anchor=target.beforeSceneId??target.afterSceneId;
  let index=unit.scenes.length;
  if(anchor){const found=unit.scenes.findIndex(scene=>scene.id===anchor);if(found<0)throw new Error('插入锚点不存在');index=found+(target.afterSceneId?1:0);}
  else if(target.nodeId){
    const ids=structureNodeSceneIds(unit,target.nodeId);if(ids.length)index=unit.scenes.findIndex(scene=>scene.id===ids.at(-1))+1;
    else {
      const nodes=unit.structureNodes!,position=nodes.findIndex(node=>node.id===target.nodeId),node=nodes[position];
      const parentMembers=node.parentId?structureNodeSceneIds(unit,node.parentId):[];
      // An empty child still belongs inside its parent's existing interval.
      // Unassigned scenes between that interval and the next root stay outside it.
      const following=new Set(nodes.slice(position+1).filter(item=>!parentMembers.length||item.parentId===node.parentId).map(item=>item.id));
      const found=unit.scenes.findIndex(scene=>scene.structureNodeId&&following.has(scene.structureNodeId));
      if(found>=0)index=found;
      else if(parentMembers.length)index=unit.scenes.findIndex(scene=>scene.id===parentMembers.at(-1))+1;
    }
  }
  return index;
}
export function insertScenesInStructure(project:ScriptProject,unitId:string,scenes:Scene[],target:StructureInsertion={}):ScriptProject{
  const next=structuredClone(project),unit=unitOf(next,unitId);
  if(!scenes.length)throw new Error('至少插入一场');
  const index=structureInsertionIndex(unit,target);
  const additions=scenes.map(scene=>{const copy=structuredClone(scene);if(target.nodeId)copy.structureNodeId=target.nodeId;else delete copy.structureNodeId;return copy;});
  unit.scenes.splice(index,0,...additions);
  return parseScriptProject(next);
}
function structureSnapshot(unit:DeliveryUnit,nodeId:string,ignoredSceneIds:ReadonlySet<string>=new Set()){
  const nodes=unit.structureNodes??[],node=nodes.find(item=>item.id===nodeId);if(!node)throw new Error('冻结结构节点已删除');
  const descendants=nodes.filter(item=>item.id===nodeId||item.parentId===nodeId);
  const allowed=new Set(descendants.map(item=>item.id));const scenes=unit.scenes.filter(scene=>!ignoredSceneIds.has(scene.id));
  const members=scenes.filter(scene=>scene.structureNodeId&&allowed.has(scene.structureNodeId));
  const first=scenes.findIndex(scene=>scene.id===members[0]?.id),last=scenes.findIndex(scene=>scene.id===members.at(-1)?.id);
  const parent=node.parentId?nodes.find(item=>item.id===node.parentId):undefined;
  return {nodes:descendants.map(item=>({id:item.id,parentId:item.parentId??null,purpose:item.purpose??''})),parent:parent?{id:parent.id,parentId:parent.parentId??null}:null,
    members:members.map(scene=>({id:scene.id,nodeId:scene.structureNodeId})),before:first>0?scenes[first-1].id:null,after:last>=0&&last<scenes.length-1?scenes[last+1].id:null,
    // Empty nodes are pinned to their adjacent directory entries as their insertion point.
    emptyPosition:members.length?null:{before:nodes[nodes.indexOf(node)-1]?.id??null,after:nodes[nodes.indexOf(descendants.at(-1)!)+1]?.id??null}};
}
function outlineHash(project:ScriptProject,unit:DeliveryUnit):string{
  const outline=unit.scopeId===project.id?project.brief.outline:project.seasons?.find(season=>season.id===unit.scopeId)?.arc??project.storyOutlines?.find(item=>item.scopeId===unit.scopeId)?.outline??'';
  return hashValue({scopeId:unit.scopeId,outline,summary:unit.summary});
}
export function freezeStructureScope(project:ScriptProject,unitId:string,nodeId:string,options:{allowCreate?:boolean;stopAfterSceneId?:string}={}):FrozenStructureScope{
  const unit=unitOf(project,unitId),snapshot=structureSnapshot(unit,nodeId),sceneIds=snapshot.members.map(scene=>scene.id);
  if(options.stopAfterSceneId&&!sceneIds.includes(options.stopAfterSceneId))throw new Error('停点不在冻结节点范围');
  return {nodeId,descendantNodeIds:snapshot.nodes.map(node=>node.id).filter(id=>id!==nodeId),sceneIds,structureHash:hashValue(snapshot),outlineHash:outlineHash(project,unit),allowCreate:options.allowCreate??false,...(options.stopAfterSceneId?{stopAfterSceneId:options.stopAfterSceneId}:{})};
}
/** Legal created scenes are supplied only by the trusted transactional creation ledger. */
export function assertFrozenStructureScopeCurrent(project:ScriptProject,unitId:string,frozen:FrozenStructureScope,created:Array<{unitId:string;sceneId:string}>=[]):void{
  const unit=unitOf(project,unitId),ignored=new Set(created.filter(item=>item.unitId===unitId).map(item=>item.sceneId));
  const snapshot=structureSnapshot(unit,frozen.nodeId,ignored);
  if(hashValue(snapshot)!==frozen.structureHash||outlineHash(project,unit)!==frozen.outlineHash)throw new Error('结构成员、相邻场序或大纲版本已变化，请重新确认范围');
  const allowed=new Set([frozen.nodeId,...frozen.descendantNodeIds]);
  for(const entry of created.filter(item=>item.unitId===unitId)){
    const scene=unit.scenes.find(item=>item.id===entry.sceneId);
    if(scene&&allowed.has(scene.structureNodeId??'')&&!frozen.allowCreate)throw new Error('冻结节点未授权创建场景');
  }
}
