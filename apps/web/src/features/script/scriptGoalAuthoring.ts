import {unitOutlineOwner} from '../../../../../packages/script/src/outlineGuides';
import { BLUEPRINT_BRIEF_FIELDS, blueprintContext } from '../../../../../packages/script/src/blueprint';
import type { ScriptStage } from '../../../../../packages/script/src/agentStages';
import { hashValue } from '../../../../../packages/agent-core/src';
import type { ScriptDraftScope } from '../../../../../packages/script/src/agentScope';
import type { DeliveryUnit, ScriptProject } from '../../../../../packages/script/src/schema';
import type { ScriptWorkspace } from '../../../../api/src/repositories/scriptWorkspaceStore';
import type { ScriptGoalTarget, ScriptSourceChoice } from '../../clients/scriptClient';

export type GoalRange = {kind:'unit'} | {kind:'project'} | {kind:'scenes';sceneIds:string[]} | {kind:'node';nodeId:string} | {kind:'story';scopeId:string} | {kind:'season';seasonId:string};

export function goalRangeSupportsStage(range:GoalRange['kind']|'existing',stage:ScriptStage):boolean {
  if(['project','story','season'].includes(range))return stage==='OUTLINE';
  if(range==='node')return ['OUTLINE','SCENES','BEATS','BODY'].includes(stage);
  if(range==='scenes')return ['SCENES','BEATS','BODY'].includes(stage);
  return true;
}

export type GoalRangeSnapshot = {rangeKind:GoalRange['kind']|'existing';unitId:string;nodeId:string;outlineScope:string;sceneIds:string[]};
/** Restore the actual contract, independently of the page behind the dialog. */
export function goalRangeSnapshot(scope:ScriptDraftScope):GoalRangeSnapshot {
  const only=scope.units.length===1?scope.units[0]:undefined;
  const base:GoalRangeSnapshot={rangeKind:'existing',unitId:only?.unitId||'',nodeId:'',outlineScope:'',sceneIds:only?.scenes.map(scene=>scene.sceneId)||[]};
  if(!only||only.scenes.some(scene=>scene.blockIds!==null||scene.selection))return base;
  const outline=scope.outlineGrants?.[0];if(outline)return {...base,rangeKind:outline.nodeId?'node':outline.owner.kind==='unit'?'unit':outline.owner.kind,nodeId:outline.nodeId||'',outlineScope:outline.owner.id};
  const stories=scope.storyOutlineScopeIds||[],seasons=scope.seasonOutlineIds||[],nodes=only.nodeScopes||[];
  if(stories.length+seasons.length){
    if(stories.length+seasons.length!==1||nodes.length||only.allowSummary||only.allowAllScenes||only.scenes.length||scope.sharedFields.length)return base;
    return {...base,rangeKind:stories.length?'story':'season',outlineScope:stories[0]||seasons[0]};
  }
  if(nodes.length){
    if(nodes.length!==1||only.allowAllScenes||only.allowSummary||scope.sharedFields.length||only.scenes.some(scene=>!nodes[0].sceneIds.includes(scene.sceneId)))return base;
    return {...base,rangeKind:'node',nodeId:nodes[0].nodeId};
  }
  return {...base,rangeKind:!only.allowAllScenes&&only.scenes.length?'scenes':!only.allowSummary&&!only.allowAllScenes&&scope.sharedFields.includes('outline')?'project':'unit'};
}
export function goalRangeChanged(before:GoalRangeSnapshot,after:GoalRangeSnapshot):boolean {
  const identity=(value:GoalRangeSnapshot)=>({rangeKind:value.rangeKind,unitId:value.rangeKind==='existing'?'':value.unitId,
    nodeId:value.rangeKind==='node'?value.nodeId:'',outlineScope:['story','season'].includes(value.rangeKind)?value.outlineScope:'',
    sceneIds:value.rangeKind==='scenes'?[...value.sceneIds].sort():[]});
  return hashValue(identity(before))!==hashValue(identity(after));
}

export function goalReviewTarget(scope:ScriptDraftScope):ScriptGoalTarget {
  if(scope.units.some(unit=>!unit.allowAllScenes&&!unit.nodeScopes?.length))throw new Error('目前连续审阅只支持整集或幕／段落，不能将所选场景自动扩大为整集。请先明确选择整集或段落，或使用当前场的单次审阅。');
  const structureTargets=scope.units.flatMap(unit=>(unit.nodeScopes||[]).map(node=>({unitId:unit.unitId,nodeId:node.nodeId})));
  return {unitIds:scope.units.map(unit=>unit.unitId),...(structureTargets.length?{structureTargets}:{})};
}

/** Next-episode intent grants only new units. Its predecessor is a fixed,
 * selected read source, never an implicitly writable target. */
export function newGoalSelection(project:ScriptProject,unit:DeliveryUnit,workspace:ScriptWorkspace|undefined,
  task:'WRITE'|'REVIEW',newUnits:number,newScenes:number,stage:ScriptStage='BODY',includeProjectOutline=project.profile.organization==='standalone',range:GoalRange={kind:'unit'}):{target:ScriptGoalTarget;sources?:ScriptSourceChoice[]} {
  if(task==='REVIEW'&&!['unit','node'].includes(range.kind))throw new Error('目前连续审阅只支持整集或幕／段落，不能将所选场景或大纲自动扩大为整集。请先明确选择整集或段落，或使用当前场的单次审阅。');
  if(task==='WRITE'&&!goalRangeSupportsStage(range.kind,stage))throw new Error('这个停止阶段需要不同的处理范围，请先明确选择范围。');
  if(task==='WRITE'&&stage==='OUTLINE'&&newUnits===0){
    const owner=range.kind==='project'||range.kind==='unit'&&includeProjectOutline?{kind:'project',id:project.id}:range.kind==='story'?{kind:'story',id:range.scopeId}:range.kind==='season'?{kind:'season',id:range.seasonId}:unitOutlineOwner(workspace?.document??project,unit);
    return {target:{unitIds:[unit.id],outlineTarget:{unitId:unit.id,...(owner.kind==='project'||owner.kind==='story'?{scopeId:owner.id}:{}),...(owner.kind==='season'?{seasonId:owner.id}:{}),...(range.kind==='node'?{nodeId:range.nodeId}:{}),allowStructure:range.kind!=='node'&&(owner.kind==='unit'||project.profile.organization==='standalone'),allowSceneOrder:false}}};
  }
  if(range.kind==='node'){if(!unit.structureNodes?.some(node=>node.id===range.nodeId))throw new Error('结构范围不存在');return {target:{unitIds:[unit.id],structureTargets:[{unitId:unit.id,nodeId:range.nodeId}],...(task==='REVIEW'?{}:{maxNewScenes:[{unitId:unit.id,count:newScenes}]})}};}
  if(range.kind==='story'||range.kind==='season'){if(stage!=='OUTLINE'||newUnits>0)throw new Error('故事或季大纲须停在大纲阶段');return {target:{unitIds:[unit.id],...(range.kind==='story'?{storyOutlineScopeIds:[range.scopeId]}:{seasonOutlineIds:[range.seasonId]})}};}
  if(task==='REVIEW')return {target:{unitIds:[unit.id]}};
  if(range.kind==='project'){
    if(stage!=='OUTLINE'||newUnits>0)throw new Error('仅总纲委托应停在故事大纲，不能同时新增分集。');
    return {target:{unitIds:[unit.id],sharedFields:['outline']}};
  }
  if(range.kind==='scenes'){
    if(!['SCENES','BEATS','BODY'].includes(stage)||newUnits>0)throw new Error('所选场景委托只处理分场或正文，不能同时新增分集。');
    const current=(workspace?.document??project).units.find(item=>item.id===unit.id);
    if(!range.sceneIds.length||new Set(range.sceneIds).size!==range.sceneIds.length||range.sceneIds.some(id=>!current?.scenes.some(scene=>scene.id===id)))throw new Error('请选择当前工作稿中的有效场景。');
    return {target:{unitIds:[unit.id],sceneIds:range.sceneIds.map(sceneId=>({unitId:unit.id,sceneId}))}};
  }
  if(stage==='BLUEPRINT'&&newUnits>0)throw new Error('作品蓝图不新增分集；请将新增后续集数设为 0。');
  if(newUnits>0){
    const ref=workspace?{uri:`resource://script/workspaces/${workspace.id}`,version:String(workspace.revision),
      contentHash:hashValue(workspace.document),branch:`workspace:${workspace.id}`}:
      {uri:`resource://script/projects/${project.id}`,version:String(project.revision),contentHash:hashValue(project),branch:'author'};
    return {target:{newUnitCount:newUnits,newUnitMaxScenes:newScenes,newUnitCharacterScopes:true,newUnitFactScopes:true},
      sources:[{purpose:'PREVIOUS_SCRIPT',ref,unitIds:[unit.id]}]};
  }
  return {target:{unitIds:[unit.id],wholeUnitIds:[unit.id],maxNewScenes:[{unitId:unit.id,count:newScenes}],
    ...(stage==='BLUEPRINT'?{sharedFields:[...BLUEPRINT_BRIEF_FIELDS],characterScopeIds:[project.id],factScopeIds:[project.id],characterIds:blueprintContext(workspace?.document??project,[unit.id]).characters.map(item=>item.id),factIds:blueprintContext(workspace?.document??project,[unit.id]).facts.map(item=>item.id)}:{}),
    ...(stage==='OUTLINE'&&includeProjectOutline?{sharedFields:['outline']}: {})}};
}

/** Stage changes must use the original frozen targets, never the scene/unit
 * currently open behind the assistant. New permissions require explicit selection. */
export function goalStageTarget(scope:ScriptDraftScope,workspace:ScriptWorkspace,newScenes:number,stage:ScriptStage):ScriptGoalTarget {
  const target=goalSceneLimitTarget(scope,workspace,newScenes);
  // A scene-only or shared-only goal cannot acquire an append permission.
  target.maxNewScenes=target.maxNewScenes?.filter(item=>scope.units.some(unit=>unit.unitId===item.unitId&&(unit.allowAllScenes||unit.nodeScopes?.some(node=>node.allowCreate))));
  if(stage==='BLUEPRINT')return {...target,sharedFields:[...BLUEPRINT_BRIEF_FIELDS],characterScopeIds:[workspace.document.id],factScopeIds:[workspace.document.id],characterIds:blueprintContext(workspace.document,scope.units.map(unit=>unit.unitId)).characters.map(item=>item.id),factIds:blueprintContext(workspace.document,scope.units.map(unit=>unit.unitId)).facts.map(item=>item.id)};
  return target;
}

/** Changing a scene limit preserves the selected units, scenes, shared fields
 * and pending new-unit slots. The server reuses trusted slot identities. */
export function goalSceneLimitTarget(scope:ScriptDraftScope,workspace:ScriptWorkspace,newScenes:number):ScriptGoalTarget {
  const existing=scope.units.filter(grant=>workspace.document.units.some(unit=>unit.id===grant.unitId));
  if(existing.some(grant=>grant.scenes.some(scene=>scene.blockIds!==null||scene.selection)))
    throw new Error('当前委托限定了段落或文字；调整场数前请明确重新选择整集范围。');
  const pending=scope.newUnitSlots.filter(slot=>!workspace.document.units.some(unit=>unit.id===slot.unitId));
  const outline=scope.outlineGrants?.[0];
  return {...(outline?{outlineTarget:{unitId:existing[0].unitId,...(outline.owner.kind==='project'||outline.owner.kind==='story'?{scopeId:outline.owner.id}:{}),...(outline.owner.kind==='season'?{seasonId:outline.owner.id}:{}),nodeId:outline.nodeId,allowStructure:outline.allowStructure,allowSceneOrder:outline.allowSceneOrder}}:{}),unitIds:existing.map(grant=>grant.unitId),wholeUnitIds:existing.filter(grant=>grant.allowAllScenes).map(grant=>grant.unitId),
    sceneIds:existing.filter(grant=>!grant.allowAllScenes).flatMap(grant=>grant.scenes.map(scene=>({unitId:grant.unitId,sceneId:scene.sceneId}))),
    maxNewScenes:existing.map(grant=>({unitId:grant.unitId,count:newScenes})),
    ...(pending.length?{newUnitCount:pending.length,newUnitMaxScenes:newScenes}:{}),
    structureTargets:existing.flatMap(grant=>(grant.nodeScopes||[]).map(node=>({unitId:grant.unitId,nodeId:node.nodeId}))),storyOutlineScopeIds:scope.storyOutlineScopeIds,seasonOutlineIds:scope.seasonOutlineIds,sharedFields:scope.sharedFields,characterIds:scope.characterIds,factIds:scope.factIds,characterScopeIds:scope.characterScopeIds,factScopeIds:scope.factScopeIds};
}
