import { sha256 } from 'js-sha256';
import type { ScriptProject, DeliveryUnit } from './schema';
import { planningContext, scopedBrief } from './outlines';

/** Project scope is explicitly shared canon. A story scope may span multiple units. */
export const visibleInUnit=(scopeId:string,project:ScriptProject,unit:DeliveryUnit)=>scopeId===project.id||scopeId===unit.scopeId||scopeId===unit.seasonId;
export const unitCharacters=(project:ScriptProject,unit:DeliveryUnit)=>project.characters.filter(c=>visibleInUnit(c.scopeId,project,unit));
export const unitFacts=(project:ScriptProject,unit:DeliveryUnit)=>project.facts.filter(f=>visibleInUnit(f.scopeId,project,unit));
export function scopeOptions(project:ScriptProject){
  const ids=[...new Set(project.units.map(u=>u.scopeId))].filter(id=>id!==project.id);
  const seasons=project.seasons||[];
  return [{id:project.id,label:'全剧共用'},...seasons.map(s=>({id:s.id,label:`季 · ${s.title}`})),...ids.filter(id=>!seasons.some(s=>s.id===id)).map(id=>({id,label:project.units.filter(u=>u.scopeId===id).map(u=>u.title).join(' / ')}))];
}
export function writingContext(project:ScriptProject,unit:DeliveryUnit,wholeProject=false){
  const relatedUnits=project.units.filter(item=>wholeProject||item.scopeId===unit.scopeId);
  const foreignSceneIds=new Set(project.units.filter(item=>!relatedUnits.includes(item)).flatMap(item=>item.scenes.map(scene=>scene.id)));
  const tracks=(project.continuityTracks||[]).filter(t=>wholeProject||visibleInUnit(t.scopeId,project,unit)).map(track=>({...track,changes:track.changes.filter(change=>!foreignSceneIds.has(change.sceneId))}));
  const relatedProject={...project,units:relatedUnits,continuityTracks:tracks};
  const readState=createContinuityReader(relatedProject);
  const referenced=new Map<string,Set<string>>();
  for(const track of tracks)for(const id of [...track.changes.map(c=>c.sceneId),...(track.threadPlan?[track.threadPlan.setupSceneId]:[])]){
    if(!referenced.has(id))referenced.set(id,new Set());referenced.get(id)!.add(track.scopeId);
  }
  const evidenceScenes=relatedUnits.flatMap(u=>u.scenes.filter(s=>referenced.has(s.id)&&[...referenced.get(s.id)!].some(scope=>visibleInUnit(scope,project,u))).map(scene=>({unitId:u.id,unitTitle:u.title,scene})));
  return {title:project.title,profile:project.profile,brief:scopedBrief(project,[unit.id],{includeProjectOutline:wholeProject}),planning:planningContext(project,[unit.id],{includeProjectOutline:wholeProject}),
    characters:wholeProject?project.characters:unitCharacters(project,unit),facts:wholeProject?project.facts:unitFacts(project,unit),methods:project.methods,unit,
    seasons:(project.seasons||[]).filter(s=>wholeProject||s.id===unit.scopeId),
    storylines:(project.storylines||[]).filter(s=>wholeProject||visibleInUnit(s.scopeId,project,unit)),
    continuity:{scopeId:unit.scopeId,statesByScene:unit.scenes.map(scene=>({sceneId:scene.id,states:readState(unit,scene.id)})),tracks,evidenceScenes,threads:threadDiagnostics(relatedProject,unit),structureIssues:storylineDiagnostics(relatedProject,unit),inheritance:'只继承全剧共用、所属季及本故事组的设定；同名人物按 ID 区分。其他独立故事组不继承。依据场景用于核对，未来的变化记录不表示当前已经发生。'},
    otherUnits:project.units.filter(u=>u.id!==unit.id&&(wholeProject||u.scopeId===unit.scopeId)).map(u=>({id:u.id,scopeId:u.scopeId,title:u.title,summary:u.summary}))};
}
export function continuityDiagnostics(project:ScriptProject,unit:DeliveryUnit){
  const issues:{sceneId:string;characterId:string;message:string}[]=[];
  const characters=new Set(unitCharacters(project,unit).map(c=>c.id));
  for(const scene of unit.scenes){
    for(const id of new Set([...scene.characterIds,...scene.blocks.flatMap(b=>b.speakerId?[b.speakerId]:[])]))
      if(!characters.has(id))issues.push({sceneId:scene.id,characterId:id,message:`「${scene.title}」引用的人物「${project.characters.find(c=>c.id===id)?.name||id}」不属于本故事组。请调整人物范围或修改引用。`});
  }
  return issues;
}

export const sceneStateHash=(scene:import('./schema').Scene)=>sha256(JSON.stringify(scene));
export interface StateProjection {
  trackId:string;label:string;kind:string;perspective:string;entry:string;exit:string;
  status:'confirmed'|'needs_review';issues:string[];
}
/** Never infer story chronology from scene display order. Ambiguity remains visible to the writer. */
export function sceneContinuity(project:ScriptProject,unit:DeliveryUnit,sceneId:string):StateProjection[]{
  return createContinuityReader(project)(unit,sceneId);
}
/** One index/hash cache per snapshot; long scripts need not rehash every scene for every projection. */
export function createContinuityReader(project:ScriptProject){
  const all=project.units.flatMap(u=>u.scenes.map(scene=>({scene,unit:u})));
  const byScene=new Map(all.map((x,index)=>[x.scene.id,{...x,index}]));
  const hashes=new Map<string,string>();
  const hash=(scene:import('./schema').Scene)=>{if(!hashes.has(scene.id))hashes.set(scene.id,sceneStateHash(scene));return hashes.get(scene.id)!;};
  return (unit:DeliveryUnit,sceneId:string):StateProjection[]=>{
  const target=byScene.get(sceneId);if(!target||target.unit.id!==unit.id)return [];
  const availableCharacters=new Set(unitCharacters(project,unit).map(c=>c.id));
  return (project.continuityTracks||[]).filter(t=>visibleInUnit(t.scopeId,project,unit)).map(track=>{
    const issues:string[]=[];let entry=track.initialValue,exit=track.initialValue;
    const inScope=(u:DeliveryUnit)=>visibleInUnit(track.scopeId,project,u);
    const order=(id:string)=>track.perspective==='audience'?byScene.get(id)?.index:byScene.get(id)?.scene.storyOrder;
    const targetOrder=order(sceneId);
    if(targetOrder===undefined)issues.push('本场未填写故事顺序，不能推断角色当时的状态。');
    if(!track.initialValue.trim())issues.push('尚未填写初始状态。');
    for(const characterId of track.characterIds)if(!availableCharacters.has(characterId))issues.push('关联人物不属于本故事组。');
    const ordered=track.changes.map(change=>({change,source:byScene.get(change.sceneId),order:order(change.sceneId)}));
    let uncertain=false;
    const applicable=ordered.filter(item=>{
      if(!item.source){issues.push('变化依据场景已删除，需重新定位。');uncertain=true;return false;}
      if(!inScope(item.source.unit)){issues.push('变化依据场景已移出此故事组。');uncertain=true;return false;}
      if(item.order===undefined||item.order<0){issues.push(`「${item.source.scene.title}」缺少顺序，变化暂不生效。`);uncertain=true;return false;}
      return targetOrder!==undefined&&item.order<=targetOrder;
    }).sort((a,b)=>a.order!-b.order!);
    const counts=new Map<number,number>();for(const item of applicable)counts.set(item.order!,1+(counts.get(item.order!)||0));
    for(const item of applicable){
      if(item.order===targetOrder&&item.change.sceneId!==sceneId){issues.push('同一故事顺序的其他场景发生了变化，需明确先后。');uncertain=true;}
      if(counts.get(item.order!)!>1){issues.push(`顺序 ${item.order} 存在多条状态变化，请明确先后。`);uncertain=true;}
      if(item.change.sourceHash!==hash(item.source!.scene)){issues.push(`「${item.source!.scene.title}」变化未确认或依据已改稿。`);uncertain=true;}
      if(!item.change.value.trim()){issues.push('状态变化缺少结果。');uncertain=true;}
      if(uncertain)continue;
      if(item.change.sceneId===sceneId)exit=item.change.value;
      else {entry=item.change.value;exit=item.change.value;}
    }
    return {trackId:track.id,label:track.label,kind:track.kind,perspective:track.perspective,entry,exit,status:issues.length?'needs_review':'confirmed',issues:[...new Set(issues)]};
  });
  };
}

export function storylineDiagnostics(project:ScriptProject,unit:DeliveryUnit){
  return unit.scenes.flatMap(scene=>(scene.storylineIds||[]).flatMap(id=>{
    const line=project.storylines?.find(s=>s.id===id);
    return !line||!visibleInUnit(line.scopeId,project,unit)?[{sceneId:scene.id,message:`「${scene.title}」关联故事线「${line?.title||id}」不属于当前范围，请调整关联。`}]:[];
  }));
}

export interface ThreadDiagnostic {
  trackId:string; label:string; status:'unplanned'|'planned'|'open'|'due'|'overdue'|'paid_off'|'needs_review'|'waived';
  setupSceneId?:string; dueUnitId?:string; payoffSceneId?:string; issues:string[]; waiver?:string;
}
/** Deadlines use delivery order, never story time or a duration estimate. */
export function threadDiagnostics(project:ScriptProject,unit:DeliveryUnit):ThreadDiagnostic[]{
  const units=new Map(project.units.map((u,index)=>[u.id,{unit:u,index}]));
  const scenes=new Map(project.units.flatMap((u,unitIndex)=>u.scenes.map(scene=>({scene,unit:u,unitIndex}))).map((s,index)=>[s.scene.id,{...s,index}]));
  const current=units.get(unit.id)?.index??-1;
  const readState=createContinuityReader(project);
  return (project.continuityTracks||[]).filter(t=>t.kind==='thread'&&visibleInUnit(t.scopeId,project,unit)).map(track=>{
    const plan=track.threadPlan;
    const result:ThreadDiagnostic={trackId:track.id,label:track.label,status:'unplanned',issues:[]};
    if(!plan)return result;
    result.setupSceneId=plan.setupSceneId;result.dueUnitId=plan.dueUnitId;
    const setup=scenes.get(plan.setupSceneId),due=units.get(plan.dueUnitId);
    const payoff=track.changes.find(c=>c.id===plan.payoffChangeId);
    const paid=payoff?scenes.get(payoff.sceneId):undefined;
    result.payoffSceneId=payoff?.sceneId;
    if(!setup)result.issues.push('埋设场景已删除，请重新定位。');
    else {
      if(!visibleInUnit(track.scopeId,project,setup.unit))result.issues.push('埋设场景不属于伏笔范围。');
      if(plan.setupSourceHash!==sceneStateHash(setup.scene))result.issues.push('埋设依据未确认或已改稿。');
    }
    if(!due)result.issues.push('回收期限单元不存在。');
    else if(!visibleInUnit(track.scopeId,project,due.unit))result.issues.push('回收期限不属于伏笔范围。');
    if(setup&&due&&due.index<setup.unitIndex)result.issues.push('回收期限早于埋设单元。');
    if(plan.payoffChangeId){
      if(!payoff||!paid)result.issues.push('回收变化或依据场景已删除。');
      else {
        if(setup&&paid.index<setup.index&&!plan.waiver?.trim())result.issues.push('回收展示在埋设之前，请核对或记录创作例外。');
        if(!visibleInUnit(track.scopeId,project,paid.unit))result.issues.push('回收场景不属于伏笔范围。');
        const state=readState(paid.unit,paid.scene.id).find(t=>t.trackId===track.id);
        if(!state||state.status==='needs_review'||!payoff.reason.trim())result.issues.push('回收依据或此前的状态变化待核对。');
      }
    }
    // An exception remains explicit and never certifies missing or stale evidence as a payoff.
    if(result.issues.length){result.status='needs_review';result.waiver=plan.waiver;return result;}
    if(plan.waiver?.trim()){result.status='waived';result.waiver=plan.waiver;return result;}
    if(paid&&paid.unitIndex<=current){
      result.status='paid_off';
      if(due&&paid.unitIndex>due.index)result.issues.push('已回收，但晚于计划期限。');
    } else if(setup&&setup.unitIndex>current)result.status='planned';
    else if(due&&current>due.index)result.status='overdue';
    else if(due&&current===due.index)result.status='due';
    else result.status='open';
    return result;
  });
}

/** Explicit author action: join a story group or start an independent one; never merge names. */
export function changeUnitStoryScope(project:ScriptProject,unitId:string,targetScopeId:string|'independent'):ScriptProject{
  const next=structuredClone(project);const unit=next.units.find(item=>item.id===unitId);
  if(!unit)throw new Error('单元不存在');
  const oldScope=unit.scopeId;const members=next.units.filter(item=>item.scopeId===oldScope);
  if(targetScopeId==='independent'){
    if(members.length===1&&oldScope!==project.id)return next;
    unit.scopeId=`story_${crypto.randomUUID()}`;
  }else{
    if(targetScopeId!==project.id&&!next.units.some(item=>item.scopeId===targetScopeId))throw new Error('目标故事范围不存在');
    unit.scopeId=targetScopeId;
  }
  if(unit.scopeId===oldScope)return next;
  // Only a genuinely private scope can move with this unit. Shared canon stays with its group.
  if(oldScope!==project.id&&members.length===1&&!(project.seasons||[]).some(season=>season.id===oldScope)){
    const storyOutline=next.storyOutlines?.find(item=>item.scopeId===oldScope);
    if(storyOutline?.outline.trim())throw new Error('本故事已有完整大纲，请先明确合并到目标故事的大纲再调整归属；原大纲与稿件均未改变。');
    if(storyOutline)next.storyOutlines=next.storyOutlines!.filter(item=>item.scopeId!==oldScope);
    for(const entity of [...next.characters,...next.facts,...(next.storylines||[]),...(next.continuityTracks||[])])if(entity.scopeId===oldScope)entity.scopeId=unit.scopeId;
  }
  if(continuityDiagnostics(next,unit).length||storylineDiagnostics(next,unit).length)throw new Error('本集仍引用原故事范围的人物或故事线。请先在资料页调整共享范围；原稿与引用均未改变。');
  return next;
}
