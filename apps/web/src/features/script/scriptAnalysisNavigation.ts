import {blocksToScreenplayText,screenplayBlockTextRanges} from '../../../../../packages/script/src/fountainAdapter';
import type {Character,ScriptBlock,ScriptProject} from '../../../../../packages/script/src/schema';
import type {TextSelection} from '../../../../../packages/script/src/proposals';
import {outlineText,ownerUnits,type OutlineOwner} from '../../../../../packages/script/src/outlineGuides';

export type BodyEvidenceSource={blockId?:string;quote?:string};
export type ScriptUpdatedTarget={view:'blueprint'|'outline'|'board'|'studio';unitId?:string;sceneId?:string;nodeId?:string;
  sceneSource?:{kind:'SCENE_PLAN'|'BODY_BLOCK';field?:string;blockId?:string;quote?:string};
  outlineFocus?:{owner:OutlineOwner;start:number;end:number;nodeId?:string}};

/** A quote belongs to its stable block, even when another block repeats it. */
export function bodyEvidenceSelection(blocks:ScriptBlock[],characters:Character[],source:BodyEvidenceSource):TextSelection|null {
  const index=source.blockId?blocks.findIndex(block=>block.id===source.blockId):-1;
  if(source.blockId&&index<0)return null;
  const full=blocksToScreenplayText(blocks,characters);
  const range=index>=0?screenplayBlockTextRanges(blocks,characters).find(item=>item.index===index):undefined;
  if(index>=0&&!range)return null;
  const start=range?.bodyStart??0,end=range?.bodyEnd??full.length;
  const text=full.slice(start,end);
  if(!source.quote)return {start,end,text};
  const at=text.indexOf(source.quote);
  if(at<0||text.indexOf(source.quote,at+1)>=0)return null;
  return {start:start+at,end:start+at+source.quote.length,text:source.quote};
}

function changedRange(before:string,after:string){
  let start=0,end=after.length,oldEnd=before.length;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  while(end>start&&oldEnd>start&&before[oldEnd-1]===after[end-1]){end--;oldEnd--;}
  if(start>0&&/[\uDC00-\uDFFF]/.test(after[start]||''))start--;
  if(end<after.length&&/[\uDC00-\uDFFF]/.test(after[end]||''))end++;
  return {start,end};
}

/** Navigation follows fields actually adopted, including their original owner. */
export function scriptUpdatedTarget(before:ScriptProject,after:ScriptProject,preferredUnitId?:string):ScriptUpdatedTarget|null {
  const owners:OutlineOwner[]=[{kind:'project',id:after.id},...(after.seasons??[]).map(season=>({kind:'season' as const,id:season.id})),
    ...(after.storyOutlines??[]).map(story=>({kind:'story' as const,id:story.scopeId})),...after.units.map(unit=>({kind:'unit' as const,id:unit.id}))];
  for(const owner of owners){
    let old='';try{old=outlineText(before,owner);}catch{/* Newly adopted owner. */}
    let text='';try{text=outlineText(after,owner);}catch{continue;}
    if(old===text)continue;
    const units=ownerUnits(after,owner),unit=units.find(unit=>unit.id===preferredUnitId)||units[0]||after.units.find(unit=>unit.id===preferredUnitId)||after.units[0];
    return {view:'outline',unitId:unit?.id,outlineFocus:{owner,...changedRange(old,text)}};
  }
  for(const unit of after.units){
    const oldUnit=before.units.find(old=>old.id===unit.id);
    for(const scene of unit.scenes){
      const old=oldUnit?.scenes.find(old=>old.id===scene.id);
      if(JSON.stringify(scene.blocks)!==JSON.stringify(old?.blocks??[])){
        const block=scene.blocks.find(block=>JSON.stringify(block)!==JSON.stringify(old?.blocks.find(old=>old.id===block.id)));
        if(block?.text.trim())return {view:'studio',unitId:unit.id,sceneId:scene.id,nodeId:scene.structureNodeId,sceneSource:{kind:'BODY_BLOCK',blockId:block.id,quote:block.text.trim()}};
      }
      const field=(['purpose','entryState','exitState','location','timeOfDay','title'] as const).find(field=>scene[field]!==old?.[field]);
      if(field)return {view:'board',unitId:unit.id,sceneId:scene.id,nodeId:scene.structureNodeId,sceneSource:{kind:'SCENE_PLAN',field,quote:scene[field]}};
      if(JSON.stringify(scene)!==JSON.stringify(old))return {view:'board',unitId:unit.id,sceneId:scene.id,nodeId:scene.structureNodeId};
    }
    if(JSON.stringify(unit.scenes.map(scene=>scene.id))!==JSON.stringify(oldUnit?.scenes.map(scene=>scene.id)))return {view:'board',unitId:unit.id};
  }
  for(const guide of after.outlineGuides??[]){
    if(JSON.stringify(guide)===JSON.stringify(before.outlineGuides?.find(old=>old.id===guide.id)))continue;
    const unit=ownerUnits(after,guide.owner)[0];let text='';try{text=outlineText(after,guide.owner);}catch{continue;}
    return {view:'outline',unitId:unit?.id,outlineFocus:{owner:guide.owner,start:0,end:text.length}};
  }
  const {revision:_beforeRevision,updatedAt:_beforeUpdatedAt,...beforeContent}=before;
  const {revision:_afterRevision,updatedAt:_afterUpdatedAt,...afterContent}=after;
  if(JSON.stringify(beforeContent)===JSON.stringify(afterContent))return null;
  return {view:'blueprint'};
}
