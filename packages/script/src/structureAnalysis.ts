import {sha256} from 'js-sha256';
import type {ScriptProject} from './schema';
import {anchorCurrent,getOutlineGuide,outlineText,storyOutlineOwner,unitOutlineOwner,unitBelongsToSeason,type OutlineOwner} from './outlineGuides';
import {structureNodeSceneIds} from './structure';
export type AnalysisEvidence={id:string;kind:'OUTLINE_SPAN'|'NODE_BEAT'|'SCENE_PLAN'|'BODY_BLOCK';unitId:string;owner?:OutlineOwner;nodeId?:string;beatId?:string;sceneId?:string;blockId?:string;field?:string;start:number;end:number;text:string;sourceHash:string};
export type StructureAnalysis={target?:{unitId:string;nodeId?:string;sceneId?:string;seasonId?:string};projectId:string;revision:number;unitId:string;findings:Array<{id:string;issue:string;suggestion:string;severity:'ADVISORY'|'BLOCKING';quote:string;evidence:AnalysisEvidence}>;summary:string;evidenceKinds:AnalysisEvidence['kind'][]};
const str={type:'string'},obj=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
export const structureAnalysisSchema=obj({summary:str,findings:{type:'array',maxItems:30,items:obj({evidenceId:str,quote:str,issue:str,suggestion:str,severity:{type:'string',enum:['ADVISORY','BLOCKING']}})}});
export function analysisEvidence(project:ScriptProject,selection:{outlineOwner?:OutlineOwner;unitId:string;sceneId?:string|null;blockIds?:string[]|null;selection?:{start:number;end:number;text:string}|null;nodeId?:string;scopeId?:string;seasonId?:string}):AnalysisEvidence[]{
  const unit=project.units.find(u=>u.id===selection.unitId);if(!unit)throw new Error('分析目标单元不存在');
  const owner:OutlineOwner=selection.outlineOwner??(selection.seasonId?{kind:'season',id:selection.seasonId}:selection.scopeId?{kind:selection.scopeId===project.id?'project':'story',id:selection.scopeId}:unitOutlineOwner(project,unit));
  if(owner.kind!=='unit'&&owner.id!==project.id&&owner.id!==unit.scopeId&&!(owner.kind==='season'&&unitBelongsToSeason(project,unit,owner.id)))throw new Error('分析大纲超出当前故事');
  const entries:AnalysisEvidence[]=[];
  const add=(source:Omit<AnalysisEvidence,'id'|'sourceHash'|'start'|'end'> & {start?:number;end?:number},fullText=source.text)=>{if(!source.text.trim())return;const value={...source,start:source.start??0,end:source.end??source.text.length,sourceHash:sha256(fullText)};entries.push({...value,id:`evidence_${sha256(JSON.stringify(value)).slice(0,32)}`});};
  const text=outlineText(project,owner),guide=getOutlineGuide(project,owner),link=guide?.nodeLinks.find(link=>link.nodeId===selection.nodeId);
  if(selection.nodeId&&link&&anchorCurrent(link.anchor,text))add({kind:'OUTLINE_SPAN',unitId:unit.id,owner,nodeId:selection.nodeId,...link.anchor,text:link.anchor.quote},text);
  else if(!selection.nodeId)add({kind:'OUTLINE_SPAN',unitId:unit.id,owner,text});
  if(selection.nodeId&&owner.kind!=='season'){const node=unit.structureNodes?.find(node=>node.id===selection.nodeId);if(node)add({kind:'NODE_BEAT',unitId:unit.id,owner,nodeId:node.id,field:'purpose',text:node.purpose??''});}
  for(const beat of guide?.beats??[])if(beat.anchors.every(anchor=>anchorCurrent(anchor,text))&&(!selection.nodeId||beat.anchors.every(a=>link&&a.start>=link.anchor.start&&a.end<=link.anchor.end)))add({kind:'NODE_BEAT',unitId:unit.id,owner,beatId:beat.id,field:'change',text:beat.change});
  if(owner.kind==='season')return entries;
  const ids=selection.nodeId?structureNodeSceneIds(unit,selection.nodeId):unit.scenes.map(scene=>scene.id);
  for(const scene of unit.scenes.filter(scene=>(!selection.sceneId||scene.id===selection.sceneId)&&ids.includes(scene.id))){
    for(const field of ['purpose','entryState','exitState','location','timeOfDay'] as const)add({kind:'SCENE_PLAN',unitId:unit.id,sceneId:scene.id,field,text:scene[field]});
    for(const block of scene.blocks)if(block.type!=='note'&&!selection.selection&&(!selection.blockIds||selection.blockIds.includes(block.id)))add({kind:'BODY_BLOCK',unitId:unit.id,sceneId:scene.id,blockId:block.id,text:block.text});
  }
  return entries;
}
export function validateStructureAnalysis(value:unknown,evidence:AnalysisEvidence[],projectId:string,revision:number,unitId:string):StructureAnalysis{
  const raw=value as any;if(!raw||typeof raw.summary!=='string'||!Array.isArray(raw.findings)||raw.findings.length>30)throw new Error('结构分析格式无效');
  const findings=raw.findings.map((finding:any,index:number)=>{const source=evidence.find(e=>e.id===finding.evidenceId);if(!source||typeof finding.quote!=='string'||!finding.quote.trim()||!source.text.includes(finding.quote)||!['ADVISORY','BLOCKING'].includes(finding.severity)||typeof finding.issue!=='string'||!finding.issue.trim()||typeof finding.suggestion!=='string'||!finding.suggestion.trim())throw new Error('分析发现必须引用实际发送的准确原文');return {id:`finding_${sha256(JSON.stringify([projectId,revision,source.id,index,finding])).slice(0,32)}`,issue:finding.issue,suggestion:finding.suggestion,severity:finding.severity,quote:finding.quote,evidence:structuredClone(source)};});
  return {projectId,revision,unitId,findings,summary:raw.summary,evidenceKinds:[...new Set(evidence.map(e=>e.kind))]};
}
export function analysisEvidenceCurrent(project:ScriptProject,evidence:AnalysisEvidence):boolean{
  const unit=project.units.find(u=>u.id===evidence.unitId),scene=unit?.scenes.find(s=>s.id===evidence.sceneId);
  let text:string|undefined;
  try{if(evidence.kind==='OUTLINE_SPAN')text=outlineText(project,evidence.owner!);
    else if(evidence.kind==='BODY_BLOCK')text=scene?.blocks.find(b=>b.id===evidence.blockId)?.text;
    else if(evidence.kind==='SCENE_PLAN')text=scene?.[evidence.field as 'purpose'];
    else if(evidence.beatId)text=getOutlineGuide(project,evidence.owner!)?.beats.find(b=>b.id===evidence.beatId)?.change;
    else text=unit?.structureNodes?.find(n=>n.id===evidence.nodeId)?.purpose;
  }catch{return false;}
  return text!==undefined&&sha256(text)===evidence.sourceHash;
}
