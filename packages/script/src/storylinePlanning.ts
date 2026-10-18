import {parseScriptProject, type ScriptProject, type Storyline} from './schema';
import {visibleInUnit} from './continuity';
import {anchorCurrent, getOutlineGuide, outlineText, visibleStorylinesForOutline, type OutlineOwner} from './outlineGuides';

export {visibleStorylinesForOutline} from './outlineGuides';
const fail=(reason:string):never=>{throw new Error(`故事线与节拍：${reason}`);};
const selectedBeat=(project:ScriptProject,owner:OutlineOwner,beatId:string)=>{
  outlineText(project,owner);
  return getOutlineGuide(project,owner)?.beats.find(beat=>beat.id===beatId)??fail('当前大纲中不存在该节拍');
};

export function beatsForStoryline(project:ScriptProject,owner:OutlineOwner,storylineId:string){
  if(!visibleStorylinesForOutline(project,owner).some(line=>line.id===storylineId))return [];
  const guide=getOutlineGuide(project,owner),text=outlineText(project,owner);
  return (guide?.beats??[]).filter(beat=>beat.storylineIds?.includes(storylineId)).map(beat=>({guide:guide!,beat,current:beat.anchors.every(anchor=>anchorCurrent(anchor,text))}));
}

export function setBeatStorylineLink(project:ScriptProject,owner:OutlineOwner,beatId:string,storylineId:string,linked:boolean):ScriptProject{
  const next=structuredClone(project),beat=selectedBeat(next,owner,beatId);
  if(typeof linked!=='boolean'||!visibleStorylinesForOutline(next,owner).some(line=>line.id===storylineId))fail('故事线不属于当前大纲');
  beat.storylineIds=(beat.storylineIds??[]).filter(id=>id!==storylineId);if(linked)beat.storylineIds.push(storylineId);
  return parseScriptProject(next);
}

/** Manual metadata edits leave verbatim source, anchors and relationships intact. */
export function updateBeatText(project:ScriptProject,owner:OutlineOwner,beatId:string,patch:{title?:string;change?:string}):ScriptProject{
  const next=structuredClone(project),beat=selectedBeat(next,owner,beatId);
  if(!patch||Object.keys(patch).some(key=>!['title','change'].includes(key)))fail('节拍只接受名称和变化');
  if(patch.title!==undefined)beat.title=patch.title;if(patch.change!==undefined)beat.change=patch.change;
  return parseScriptProject(next);
}

export function removeBeat(project:ScriptProject,owner:OutlineOwner,beatId:string):ScriptProject{
  const next=structuredClone(project);selectedBeat(next,owner,beatId);
  const guide=getOutlineGuide(next,owner)!;guide.beats=guide.beats.filter(beat=>beat.id!==beatId);
  if(guide.development?.beatIds)guide.development.beatIds=guide.development.beatIds.filter(id=>id!==beatId);
  return parseScriptProject(next);
}

export function removeStoryline(project:ScriptProject,storylineId:string):ScriptProject{
  const next=structuredClone(project);
  if(!next.storylines?.some(line=>line.id===storylineId))fail('故事线不存在');
  next.storylines=next.storylines.filter(line=>line.id!==storylineId);
  for(const unit of next.units)for(const scene of unit.scenes)if(scene.storylineIds)scene.storylineIds=scene.storylineIds.filter(id=>id!==storylineId);
  for(const guide of next.outlineGuides??[])for(const beat of guide.beats)if(beat.storylineIds)beat.storylineIds=beat.storylineIds.filter(id=>id!==storylineId);
  return parseScriptProject(next);
}

/** Scope changes must retain valid explicit references, or fail atomically. */
export function updateStoryline(project:ScriptProject,storylineId:string,patch:Partial<Pick<Storyline,'scopeId'|'lane'|'title'|'premise'|'resolution'>>):ScriptProject{
  const next=structuredClone(project),line=next.storylines?.find(line=>line.id===storylineId)??fail('故事线不存在');
  if(!patch||Object.keys(patch).some(key=>!['scopeId','lane','title','premise','resolution'].includes(key)))fail('故事线字段无效');
  Object.assign(line,patch);
  for(const unit of next.units)for(const scene of unit.scenes)if(scene.storylineIds?.includes(storylineId)&&!visibleInUnit(line.scopeId,next,unit))fail('调整范围会使已有场景引用越界，请先解除关联');
  return parseScriptProject(next);
}
