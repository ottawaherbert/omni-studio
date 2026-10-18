import {hashValue} from '../../agent-core/src/identity';
import {freezeOutlineGrant,assertOutlineGrant,outlineText,getOutlineGuide,anchorCurrent} from './outlineGuides';
import {analysisEvidence,type StructureAnalysis} from './structureAnalysis';
import type {ScriptDraftScope} from './agentScope';
import type {ScriptProject} from './schema';

export type PlanningRepairTarget={unitId:string;sceneId?:string;scopeId?:string;seasonId?:string;nodeId?:string;outlineRange?:{start:number;end:number;text:string};outlineStructure?:boolean};
export type PlanningRepairContract={version:1;maxRepairRounds:2;operation:'outline_development'|'scene_plan';target:PlanningRepairTarget;instruction:string};
export type PlanningRepairResult={kind:'PLANNING_REPAIR';roundsUsed:number;analyses:StructureAnalysis[];candidateIds:string[];applicationRefs:unknown[];summary:string};

/** Only used after the host proves every intervening version was committed by
 * this same finite run. It preserves the original owner, range and powers. */
export function continuedPlanningScope(scope:ScriptDraftScope,origin:ScriptProject,current:ScriptProject):ScriptDraftScope{
  const next={...structuredClone(scope),originRevision:current.revision,originContentHash:hashValue(current)};
  next.outlineGrants=scope.outlineGrants?.map(grant=>{
    assertOutlineGrant(origin,current,grant);
    const old=outlineText(origin,grant.owner),text=outlineText(current,grant.owner);
    const end=grant.end+text.length-old.length;
    const result=freezeOutlineGrant(current,grant.owner,{nodeId:grant.nodeId,outlineBeatIds:grant.outlineBeatIds,allowStructure:grant.allowStructure,
      allowSceneOrder:grant.allowSceneOrder,structureUnitId:grant.structureUnitId,
      ...(!grant.nodeId&&(grant.start>0||grant.end<old.length)?{range:{start:grant.start,end,quote:text.slice(grant.start,end)}}:{})});
    if(result.start!==grant.start||result.end!==end)throw new Error('规划返修的原文范围已经变化');
    return result;
  });
  return next;
}

export function planningRepairEvidence(project:ScriptProject,contract:PlanningRepairContract,scope:ScriptDraftScope){
  const grant=scope.outlineGrants?.[0];
  const evidence=analysisEvidence(project,{...contract.target,...(grant?{outlineOwner:grant.owner}:{})}).filter(item=>contract.operation==='scene_plan'?item.kind==='SCENE_PLAN':item.kind==='OUTLINE_SPAN'||item.kind==='NODE_BEAT');
  if(contract.operation==='outline_development'&&grant){
    // An excerpt grants inspection of that excerpt, not unrelated paragraphs.
    return evidence.flatMap(item=>{
      if(item.kind==='OUTLINE_SPAN'){
        const text=outlineText(project,grant.owner).slice(grant.start,grant.end);
        return text.trim()?[{...item,start:grant.start,end:grant.end,text}]:[];
      }
      if(grant.start>0||grant.end<outlineText(project,grant.owner).length){
        if(grant.nodeId&&item.nodeId===grant.nodeId)return [item];
        const beat=item.beatId?getOutlineGuide(project,grant.owner)?.beats.find(beat=>beat.id===item.beatId):undefined;
        return beat?.anchors.every(anchor=>anchorCurrent(anchor,outlineText(project,grant.owner))&&anchor.start>=grant.start&&anchor.end<=grant.end)?[item]:[];
      }
      return [item];
    });
  }
  return evidence;
}
