import { sha256 } from 'js-sha256';
import type { ScriptProject } from './schema';

/** Scope is supplied by the author command, never inferred from extant scenes. */
export type StoryCoverageTarget = {unitId:string;nodeIds?:string[]};
export type StoryCoverageContract = {originRevision:number;targets:StoryCoverageTarget[]};
export type OutlineRequirement = {
  id:string;unitId:string;ownerKind:'project'|'unit'|'node';ownerId:string;
  sourceHash:string;start:number;end:number;text:string;
};
export type OutlineCoverageEntry = {
  requirementId:string;status:'UNEXPANDED'|'PLANNED'|'PARTIAL'|'DRAFT_READY';reason:string;
  evidence:Array<{sceneId:string;blockId:string;start:number;end:number}>;
};
const hash=(value:unknown)=>sha256(JSON.stringify(value));

/** Every nonblank source character is retained. Paragraphs are evidence ranges,
 * not mandatory beats or a fixed theory of structure. */
function requirements(unitId:string,ownerKind:OutlineRequirement['ownerKind'],ownerId:string,source:string):OutlineRequirement[]{
  const sourceHash=sha256(source),result:OutlineRequirement[]=[];
  const parts=source.matchAll(/[^\n]+(?:\n|$)/g);
  for(const part of parts){
    if(!part[0].trim())continue;
    for(let from=part.index!;from<part.index!+part[0].length;){
      let end=Math.min(from+1800,part.index!+part[0].length);
      if(end<source.length&&/[\uD800-\uDBFF]/.test(source[end-1]))end--;
      const text=source.slice(from,end);
      if(text.trim())result.push({id:`outline_${hash({unitId,ownerKind,ownerId,sourceHash,from,end}).slice(0,24)}`,unitId,ownerKind,ownerId,sourceHash,start:from,end,text});
      from=end;
    }
  }
  return result;
}

export function collectOutlineRequirements(project:ScriptProject,targets:StoryCoverageTarget[]){
  const items:OutlineRequirement[]=[],gaps:string[]=[];
  for(const target of targets){
    const unit=project.units.find(item=>item.id===target.unitId);
    if(!unit){gaps.push(`单元 ${target.unitId} 尚未建立`);continue;}
    if(target.nodeIds?.length){
      for(const nodeId of target.nodeIds){
        const node=unit.structureNodes?.find(item=>item.id===nodeId);
        if(!node){gaps.push(`段落 ${nodeId} 已不存在`);continue;}
        const members=[node,...(unit.structureNodes??[]).filter(item=>item.parentId===nodeId)];
        const useful=members.filter(item=>item.purpose?.trim());
        if(!useful.length)gaps.push(`段落「${node.title}」尚无可核对的故事目标`);
        for(const item of useful)items.push(...requirements(unit.id,'node',item.id,item.purpose!));
      }
    }else{
      // A single episode must not be required to fulfil an entire series arc.
      const fullFilm=project.profile.organization==='standalone'&&Boolean(project.brief.outline.trim());
      const source=fullFilm?project.brief.outline:unit.summary;
      if(!source.trim())gaps.push(`「${unit.title}」尚无约定大纲，请先完成获准的大纲准备`);
      else items.push(...requirements(unit.id,fullFilm?'project':'unit',fullFilm?project.id:unit.id,source));
    }
  }
  return {items:[...new Map(items.map(item=>[item.id,item])).values()],gaps};
}

export function outlineSourcesChanged(baseline:OutlineRequirement[],current:OutlineRequirement[]):boolean{
  return hash(baseline)!==hash(current);
}

export function validOutlineRequirementIds(project:ScriptProject,unitId:string,nodeId?:string):string[]{
  const nodes=project.units.find(unit=>unit.id===unitId)?.structureNodes??[];
  const targets:StoryCoverageTarget[]=nodeId?[{unitId,nodeIds:[nodeId]}]:[{unitId},...nodes.map(node=>({unitId,nodeIds:[node.id]}))];
  return collectOutlineRequirements(project,targets).items.map(item=>item.id);
}

export function storyProgress(project:ScriptProject,items:OutlineRequirement[],coverage:OutlineCoverageEntry[]=[]){
  return items.map(item=>{
    const result=coverage.find(entry=>entry.requirementId===item.id);
    const unit=project.units.find(unit=>unit.id===item.unitId);
    const scenes=unit?.scenes.filter(scene=>scene.outlineRequirementIds?.includes(item.id)||result?.evidence.some(ref=>ref.sceneId===scene.id)||(item.ownerKind==='node'&&[item.ownerId,...(unit.structureNodes??[]).filter(node=>node.parentId===item.ownerId).map(node=>node.id)].includes(scene.structureNodeId??'')));
    const unfinished=scenes?.some(scene=>scene.generation?.status==='partial');
    const state=unfinished?'PARTIAL':result?.status??(!scenes?.some(scene=>scene.purpose.trim())?'UNEXPANDED':'PLANNED');
    return {...item,status:state,evidence:result?.evidence??[],reason:unfinished?'映射场景仍待续写，须从已保存检查点继续':result?.reason??'尚未取得本项大纲与正文的覆盖证据'};
  });
}
