import {sha256} from 'js-sha256';
import type {ScriptProject, DeliveryUnit, Storyline} from './schema';

export type OutlineOwner = {kind:'project'|'season'|'story'|'unit';id:string};
export type OutlineAnchor = {start:number;end:number;quote:string;sourceHash:string};
export type OutlineNodeLink = {nodeId:string;unitId:string;anchor:OutlineAnchor};
export type StoryBeat = {id:string;title:string;change:string;anchors:OutlineAnchor[];unitIds:string[];sceneRefs:Array<{unitId:string;sceneId:string}>;storylineIds?:string[]};
export type OutlineGuide = {id:string;owner:OutlineOwner;nodeLinks:OutlineNodeLink[];beats:StoryBeat[];development?:{sourceHash:string;unitId:string;nodes:boolean;beats:boolean;full:boolean;nodeId:string|null;beatIds?:string[]};overview?:{text:string;sourceHash:string}};
export type OutlineGrant = {owner:OutlineOwner;sourceHash:string;start:number;end:number;nodeId?:string;outlineBeatIds?:string[];allowStructure:boolean;allowSceneOrder:boolean;structureUnitId?:string;structureHash?:string};
export const outlineHash=(text:string)=>sha256(text);
export const ownerKey=(owner:OutlineOwner)=>`${owner.kind}_${owner.id}`;
export const outlineGuideId=(owner:OutlineOwner)=>`guide_${sha256(ownerKey(owner)).slice(0,32)}`;
const fail=(reason:string):never=>{throw new Error(`大纲关联：${reason}`);};
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[\w-]{1,120}$/.test(id);
export function unitBelongsToSeason(project:ScriptProject,unit:DeliveryUnit,seasonId:string):boolean{
  return Boolean(project.seasons?.some(season=>season.id===seasonId)&&(unit.seasonId===seasonId||unit.scopeId===seasonId));
}
export function ownerUnits(project:ScriptProject,owner:OutlineOwner):DeliveryUnit[]{
  if(owner.kind==='unit')return project.units.filter(unit=>unit.id===owner.id);
  if(owner.kind==='project')return project.units.filter(unit=>project.profile.organization==='standalone'||unit.scopeId===owner.id);
  if(owner.kind==='season')return project.units.filter(unit=>unitBelongsToSeason(project,unit,owner.id));
  return project.units.filter(unit=>unit.scopeId===owner.id);
}
/** A selected shared outline never exposes the private lines of its members. */
export function visibleStorylinesForOutline(project:ScriptProject,owner:OutlineOwner):Storyline[]{
  outlineText(project,owner);
  const scopes=new Set([project.id]);
  if(owner.kind==='unit'){
    const unit=ownerUnits(project,owner)[0];scopes.add(unit.scopeId);if(unit.seasonId)scopes.add(unit.seasonId);
  }else if(owner.kind==='season')scopes.add(owner.id);
  else if(owner.kind==='story'){
    scopes.add(owner.id);
    const units=ownerUnits(project,owner);
    for(const season of project.seasons??[])if(units.length&&units.every(unit=>unitBelongsToSeason(project,unit,season.id)))scopes.add(season.id);
  }
  return (project.storylines??[]).filter(line=>scopes.has(line.scopeId));
}
export function outlineText(project:ScriptProject,owner:OutlineOwner):string{
  if(owner.kind==='project'){if(owner.id!==project.id)fail('作品归属不存在');return project.brief.outline;}
  if(owner.kind==='unit'){const unit=project.units.find(unit=>unit.id===owner.id);if(!unit)fail('单元不存在');return unit.summary;}
  if(owner.kind==='season'){const season=project.seasons?.find(season=>season.id===owner.id);if(!season)fail('季不存在');return season.arc;}
  if(owner.id===project.id||project.seasons?.some(season=>season.id===owner.id)||!project.units.some(unit=>unit.scopeId===owner.id))fail('故事归属不存在');
  return project.storyOutlines?.find(item=>item.scopeId===owner.id)?.outline||'';
}
export function unitOutlineOwner(project:ScriptProject,unit:DeliveryUnit):OutlineOwner{
  if(project.profile.organization==='episodic'&&unit.scopeId!==project.id&&project.units.filter(u=>u.scopeId===unit.scopeId).length===1){const story=storyOutlineOwner(project,unit);if(story.kind==='story'&&outlineText(project,story).trim())return story;}
  return project.profile.organization==='standalone'&&project.brief.outline.trim()?{kind:'project',id:project.id}:{kind:'unit',id:unit.id};
}
export function storyOutlineOwner(project:ScriptProject,unit:DeliveryUnit):OutlineOwner{
  return unit.scopeId===project.id?{kind:'project',id:project.id}:project.seasons?.some(season=>season.id===unit.scopeId)?{kind:'season',id:unit.scopeId}:{kind:'story',id:unit.scopeId};
}
export function getOutlineGuide(project:ScriptProject,owner:OutlineOwner){return project.outlineGuides?.find(guide=>ownerKey(guide.owner)===ownerKey(owner));}
export function anchorCurrent(anchor:OutlineAnchor,text:string){return anchor.sourceHash===outlineHash(text)&&text.slice(anchor.start,anchor.end)===anchor.quote;}
const boundary=(text:string,at:number)=>at>=0&&at<=text.length&&!(at>0&&at<text.length&&/[\uD800-\uDBFF]/.test(text[at-1])&&/[\uDC00-\uDFFF]/.test(text[at]));
export function anchorFor(text:string,start:number,end:number):OutlineAnchor{
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start||!boundary(text,start)||!boundary(text,end))fail('原文区间无效');
  return {start,end,quote:text.slice(start,end),sourceHash:outlineHash(text)};
}
export function locateOutlineQuote(text:string,quote:string):OutlineAnchor{
  const start=text.indexOf(quote);if(!quote.trim()||start<0||text.indexOf(quote,start+1)>=0)fail('引用必须在原文中唯一出现，请提供更完整的原文');
  return anchorFor(text,start,start+quote.length);
}
export function setOutlineText(project:ScriptProject,owner:OutlineOwner,text:string){
  outlineText(project,owner);
  if(typeof text!=='string'||text.length>200000)fail('大纲超出长度限制');
  if(owner.kind==='project')project.brief.outline=text;
  else if(owner.kind==='unit')project.units.find(unit=>unit.id===owner.id)!.summary=text;
  else if(owner.kind==='season')project.seasons!.find(season=>season.id===owner.id)!.arc=text;
  else {project.storyOutlines??=[];const item=project.storyOutlines.find(item=>item.scopeId===owner.id);if(item)item.outline=text;else project.storyOutlines.push({scopeId:owner.id,outline:text});}
  // Anchors retain their source hash and quote. Untracked full replacements
  // become visibly stale; reading/saving a document never guesses new links.
}
export function replaceOutlineRange(project:ScriptProject,grant:OutlineGrant,replacement:string):ScriptProject{
  const text=outlineText(project,grant.owner);
  if(grant.nodeId){const link=getOutlineGuide(project,grant.owner)?.nodeLinks.find(link=>link.nodeId===grant.nodeId);if(!link||!project.units.some(unit=>unit.id===link.unitId&&unit.structureNodes?.some(node=>node.id===grant.nodeId))||link.anchor.sourceHash!==grant.sourceHash||link.anchor.start!==grant.start||link.anchor.end!==grant.end)fail('所选节点的原文关联已变化');}
  if(outlineHash(text)!==grant.sourceHash||!boundary(text,grant.start)||!boundary(text,grant.end)||grant.start>grant.end)fail('原文已变化，请重新选择范围');
  if(typeof replacement!=='string')fail('替换内容无效');
  const next=structuredClone(project),value=text.slice(0,grant.start)+replacement+text.slice(grant.end),delta=replacement.length-(grant.end-grant.start);
  setOutlineText(next,grant.owner,value);
  const guide=getOutlineGuide(next,grant.owner);
  const rebase=(anchor:OutlineAnchor):OutlineAnchor=>{
    if(!anchorCurrent(anchor,text))return anchor;
    if(anchor.end<=grant.start)return {...anchor,sourceHash:outlineHash(value)};
    if(anchor.start>=grant.end)return {...anchor,start:anchor.start+delta,end:anchor.end+delta,sourceHash:outlineHash(value)};
    // Touched semantic links stay bound to the previous source for review.
    return anchor;
  };
  if(guide){guide.nodeLinks=guide.nodeLinks.map(link=>({...link,anchor:rebase(link.anchor)}));guide.beats=guide.beats.map(beat=>({...beat,anchors:beat.anchors.map(rebase)}));}
  return next;
}
export const structureGrantHash=(unit:DeliveryUnit)=>sha256(JSON.stringify({nodes:unit.structureNodes??[],scenes:unit.scenes.map(scene=>({id:scene.id,nodeId:scene.structureNodeId??null}))}));
export function freezeOutlineGrant(project:ScriptProject,owner:OutlineOwner,options:{nodeId?:string;outlineBeatIds?:string[];allowStructure?:boolean;allowSceneOrder?:boolean;structureUnitId?:string;range?:{start:number;end:number;quote:string}}={}):OutlineGrant{
  const text=outlineText(project,owner),link=options.nodeId?getOutlineGuide(project,owner)?.nodeLinks.find(link=>link.nodeId===options.nodeId):undefined;
  if(options.nodeId&&(!link||!anchorCurrent(link.anchor,text)))fail('本段尚未关联当前大纲，请先关联原文');
  if(options.range&&(options.nodeId||text.slice(options.range.start,options.range.end)!==options.range.quote))fail('待改原文与所选区间不一致');
  if(options.range)anchorFor(text,options.range.start,options.range.end);
  const start=options.range?.start??link?.anchor.start??0,end=options.range?.end??link?.anchor.end??text.length;
  if(options.outlineBeatIds!==undefined){
    const ids=options.outlineBeatIds,beats=getOutlineGuide(project,owner)?.beats??[];
    if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!validId(id)))fail('节拍目标标识无效');
    if(options.nodeId||options.allowStructure||options.allowSceneOrder)fail('节拍目标不包含结构或场序写权');
    for(const id of ids){const beat=beats.find(beat=>beat.id===id);if(!beat||!beat.anchors.length||!beat.anchors.every(anchor=>anchorCurrent(anchor,text)&&anchor.start>=start&&anchor.end<=end))fail('目标节拍未关联所选有效原文');}
  }
  const structureUnitId=options.allowStructure?(options.structureUnitId??ownerUnits(project,owner)[0]?.id):undefined;
  const structure=structureUnitId?project.units.find(unit=>unit.id===structureUnitId):undefined;
  if(options.allowSceneOrder&&!options.allowStructure||options.allowStructure&&!structure)fail('结构权限缺少明确单元');
  return {...(structure?{structureUnitId:structure.id,structureHash:structureGrantHash(structure)}:{}),owner,sourceHash:outlineHash(text),start,end,...(options.nodeId?{nodeId:options.nodeId}:{}),...(options.outlineBeatIds?{outlineBeatIds:[...options.outlineBeatIds]}:{}),allowStructure:options.allowStructure??false,allowSceneOrder:options.allowSceneOrder??false};
}
export function assertOutlineGrant(before:ScriptProject,after:ScriptProject,grant:OutlineGrant){
  const old=outlineText(before,grant.owner),value=outlineText(after,grant.owner);
  if(outlineHash(old)!==grant.sourceHash)fail('冻结大纲版本已改变');
  const suffix=old.slice(grant.end);
  if(!value.startsWith(old.slice(0,grant.start))||!value.endsWith(suffix)||value.length<grant.start+suffix.length)fail('修改越过获准的大纲原文区间');
}
export function visibleOutlineGuides(project:ScriptProject,unit:DeliveryUnit){
  return (project.outlineGuides||[]).filter(guide=>guide.owner.kind==='unit'?guide.owner.id===unit.id&&!(project.profile.organization==='standalone'&&project.brief.outline.trim()):
    guide.owner.id===unit.scopeId||project.profile.organization==='standalone'&&guide.owner.kind==='project'||guide.owner.kind==='season'&&unitBelongsToSeason(project,unit,guide.owner.id)&&guide.beats.some(beat=>beat.unitIds.includes(unit.id)||beat.sceneRefs.some(ref=>ref.unitId===unit.id)));
}
export function beatsForUnit(project:ScriptProject,unit:DeliveryUnit){
  return visibleOutlineGuides(project,unit).flatMap(guide=>guide.beats.filter(beat=>guide.owner.kind==='unit'||project.profile.organization==='standalone'||beat.unitIds.includes(unit.id)||beat.sceneRefs.some(ref=>ref.unitId===unit.id)).map(beat=>({guide,beat,current:beat.anchors.every(anchor=>anchorCurrent(anchor,outlineText(project,guide.owner)))})));
}
export function setBeatSceneLink(project:ScriptProject,guideId:string,beatId:string,unitId:string,sceneId:string,linked:boolean):ScriptProject{
  const next=structuredClone(project),unit=next.units.find(unit=>unit.id===unitId),guide=next.outlineGuides?.find(guide=>guide.id===guideId),beat=guide?.beats.find(beat=>beat.id===beatId);
  if(!unit?.scenes.some(scene=>scene.id===sceneId)||!guide||!beat||!ownerUnits(next,guide.owner).some(unit=>unit.id===unitId))fail('节拍与场景不在同一获准故事');
  beat.sceneRefs=beat.sceneRefs.filter(ref=>ref.unitId!==unitId||ref.sceneId!==sceneId);if(linked)beat.sceneRefs.push({unitId,sceneId});
  validateOutlineGuides(next);return next;
}
/** Stale anchors retain evidence but are never treated as a current match. */
export function validateOutlineGuides(project:ScriptProject){
  if(project.outlineGuides===undefined)return;
  if(!Array.isArray(project.outlineGuides)||project.outlineGuides.length>2000)fail('指南数量无效');
  const ids=new Set([project.id,...project.units.flatMap(unit=>[unit.id,...(unit.structureNodes||[]).map(node=>node.id),...unit.scenes.flatMap(scene=>[scene.id,...scene.blocks.map(block=>block.id)])]),...(project.seasons??[]).map(s=>s.id),...(project.storylines??[]).map(s=>s.id),...project.characters.map(c=>c.id),...project.facts.map(f=>f.id)]),owners=new Set<string>();
  const unique=(id:string)=>{if(!validId(id)||ids.has(id))fail('稳定标识无效或重复');ids.add(id);};
  const anchor=(value:OutlineAnchor,text:string)=>{
    if(!value||!Number.isSafeInteger(value.start)||!Number.isSafeInteger(value.end)||value.start<0||value.end<=value.start||typeof value.quote!=='string'||value.quote.length>200000||!/^[a-f0-9]{64}$/.test(value.sourceHash))fail('原文定位格式无效');
    if(value.sourceHash===outlineHash(text)&&(!boundary(text,value.start)||!boundary(text,value.end)||text.slice(value.start,value.end)!==value.quote))fail('原文定位与版本不符');
  };
  for(const guide of project.outlineGuides){
    if(!guide?.owner||!['project','season','story','unit'].includes(guide.owner.kind)||!validId(guide.owner.id))fail('大纲归属无效');
    unique(guide.id);if(guide.id!==outlineGuideId(guide.owner)||owners.has(ownerKey(guide.owner)))fail('大纲指南归属重复');owners.add(ownerKey(guide.owner));
    const text=outlineText(project,guide.owner),units=ownerUnits(project,guide.owner),allowed=new Set(units.map(unit=>unit.id));
    if(!Array.isArray(guide.nodeLinks)||!Array.isArray(guide.beats)||guide.nodeLinks.length>2000||guide.beats.length>2000)fail('结构或节拍列表无效');
    const linked=new Set<string>();
    for(const link of guide.nodeLinks){
      if(!allowed.has(link.unitId)||!units.find(unit=>unit.id===link.unitId)?.structureNodes?.some(node=>node.id===link.nodeId)||linked.has(link.nodeId))fail('节点关联不存在或重复');linked.add(link.nodeId);anchor(link.anchor,text);
    }
    for(const unit of units){
      const links=guide.nodeLinks.filter(link=>link.unitId===unit.id&&anchorCurrent(link.anchor,text));
      for(const node of unit.structureNodes||[]){const link=links.find(link=>link.nodeId===node.id);if(!link)continue;
        const parent=links.find(link=>link.nodeId===node.parentId);if(parent&&(link.anchor.start<parent.anchor.start||link.anchor.end>parent.anchor.end))fail('子段原文必须位于父段内');
        const siblings=(unit.structureNodes||[]).filter(item=>item.parentId===node.parentId),previous=siblings.slice(0,siblings.indexOf(node)).flatMap(item=>links.filter(link=>link.nodeId===item.id));
        if(previous.some(item=>item.anchor.end>link.anchor.start))fail('同级原文区间交错或顺序不一致');
      }
    }
    for(const beat of guide.beats){unique(beat.id);if(typeof beat.title!=='string'||!beat.title.trim()||typeof beat.change!=='string'||beat.change.length>20000||!Array.isArray(beat.anchors)||!beat.anchors.length||!Array.isArray(beat.unitIds)||!Array.isArray(beat.sceneRefs))fail('关键节拍格式无效');
      beat.anchors.forEach(item=>anchor(item,text));if(new Set(beat.unitIds).size!==beat.unitIds.length||beat.unitIds.some(id=>!allowed.has(id)))fail('节拍跨出故事范围');
      if(beat.storylineIds!==undefined){const lines=new Set(visibleStorylinesForOutline(project,guide.owner).map(line=>line.id));if(!Array.isArray(beat.storylineIds)||beat.storylineIds.length>10000||new Set(beat.storylineIds).size!==beat.storylineIds.length||beat.storylineIds.some(id=>!validId(id)||!lines.has(id)))fail('节拍故事线引用不存在、重复或越出大纲归属');}
      const refs=new Set<string>();for(const ref of beat.sceneRefs){const key=`${ref.unitId}/${ref.sceneId}`;if(refs.has(key)||!allowed.has(ref.unitId)||!units.find(unit=>unit.id===ref.unitId)?.scenes.some(scene=>scene.id===ref.sceneId))fail('节拍场景引用不存在或越界');refs.add(key);}
    }
    if(guide.development?.beatIds&&(!Array.isArray(guide.development.beatIds)||new Set(guide.development.beatIds).size!==guide.development.beatIds.length||guide.development.beatIds.some(id=>!guide.beats.some(beat=>beat.id===id))))fail('大纲交付节拍身份无效');
    if(guide.development&&(!allowed.has(guide.development.unitId)||!/^[a-f0-9]{64}$/.test(guide.development.sourceHash)||typeof guide.development.nodes!=='boolean'||typeof guide.development.beats!=='boolean'||typeof guide.development.full!=='boolean'||guide.development.nodeId!==null&&!validId(guide.development.nodeId)))fail('大纲交付依据无效');
    if(guide.overview&&(typeof guide.overview.text!=='string'||guide.overview.text.length>20000||!/^[a-f0-9]{64}$/.test(guide.overview.sourceHash)))fail('概览梗概格式无效');
  }
}
