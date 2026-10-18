import { sha256 } from 'js-sha256';
import { SCHEMA_VERSION, parseProjectProfile, type ScriptProject, type ProjectProfile, type Scene, type DeliveryUnit, type Character } from './schema';
export const newId=(prefix:string)=>`${prefix}_${crypto.randomUUID()}`;
export const newScene=(title='新场景'):Scene=>({id:newId('scene'),title,location:'',timeOfDay:'',storyTime:'',purpose:'',entryState:'',exitState:'',characterIds:[],targetDurationMs:0,blocks:[{id:newId('block'),type:'action',text:''}]});
export const newUnit=(title:string,targetDurationMs:number,scopeId?:string):DeliveryUnit=>{const id=newId('unit'); return {id,title,scopeId:scopeId||id,summary:'',endingHook:'',targetDurationMs,scenes:[newScene('第 1 场')],timeline:[],timingEvidence:[]};};
export function createScriptProject(title:string,profile:ProjectProfile):ScriptProject {
  parseProjectProfile(profile); if(!title.trim()) throw new Error('请填写剧本名称');
  const now=Date.now();const id=newId('script');
  return {schemaVersion:SCHEMA_VERSION,id,revision:0,title:title.trim(),profile,
    brief:{concept:'',theme:'',audienceExperience:'',constraints:'',outline:''},characters:[],facts:[],methods:[],
    units:[newUnit(profile.organization==='standalone'?'全片':'第 1 集',profile.targetDurationMs,['anthology','procedural'].includes(profile.continuity)?undefined:id)],createdAt:now,updatedAt:now};
}
/** Register a name written directly in a dialogue heading without changing the author's text. */
export function registerDialogueSpeaker(project:ScriptProject,unitId:string,sceneId:string,name:string):Character {
  const unit=project.units.find(item=>item.id===unitId);
  const scene=unit?.scenes.find(item=>item.id===sceneId);
  const clean=name.trim();
  if(!unit||!scene||!clean)throw new Error('找不到要登记的对白人物');
  if(!scene.blocks.some(block=>block.type==='dialogue'&&block.speakerName?.trim()===clean))throw new Error('当前场景没有这个待登记的人物');
  let character=project.characters.find(item=>item.name.trim()===clean&&(item.scopeId===unit.scopeId||item.scopeId===project.id));
  if(!character){
    character={id:newId('char'),name:clean,scopeId:unit.scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''};
    project.characters.push(character);
  }
  scene.blocks.forEach(block=>{if(block.type==='dialogue'&&block.speakerName?.trim()===clean){block.speakerId=character.id;delete block.speakerName;}});
  if(!scene.characterIds.includes(character.id))scene.characterIds.push(character.id);
  return character;
}
export function setProjectContinuity(project:ScriptProject,mode:ProjectProfile['continuity']):void {
  if(project.profile.continuity===mode)return;
  if(mode!=='mixed'){
    const remainingScopes=new Set([project.id,...(project.seasons??[]).map(season=>season.id),...project.units.map(unit=>unit.id)]);
    if(project.storyOutlines?.some(outline=>!remainingScopes.has(outline.scopeId)))throw new Error('当前跨集故事已有专属大纲，请先调整故事归属再切换连续性模式；原稿未修改');
  }
  if(mode==='anthology'||mode==='procedural'){
    const oldScopes=new Map<string,string[]>();
    project.units.forEach(unit=>oldScopes.set(unit.scopeId,[...(oldScopes.get(unit.scopeId)||[]),unit.id]));
    for(const entity of [...project.characters,...project.facts,...(project.storylines||[]),...(project.continuityTracks||[])]){
      if(entity.scopeId===project.id)continue;
      const members=oldScopes.get(entity.scopeId);
      if(members?.length)entity.scopeId=members.length===1?members[0]:project.id;
    }
    project.units.forEach(unit=>{unit.scopeId=unit.id;});
  }else if(mode==='serialized'){
    const storyScopes=new Set(project.units.flatMap(unit=>[unit.id,unit.scopeId]));
    project.units.forEach(unit=>{unit.scopeId=project.id;});
    for(const entity of [...project.characters,...project.facts,...(project.storylines||[]),...(project.continuityTracks||[])]){
      if(storyScopes.has(entity.scopeId))entity.scopeId=project.id;
    }
  }
  project.profile.continuity=mode;
}
/** Remove a scene and its scene-bound timing rows; continuity evidence stays for repair. */
export function removeScriptScene(project:ScriptProject,unitId:string,sceneId:string):number {
  const unit=project.units.find(item=>item.id===unitId);
  if(!unit||!unit.scenes.some(scene=>scene.id===sceneId))throw new Error('场景不存在');
  if(unit.scenes.length<=1)throw new Error('每个单元至少保留一场');
  unit.scenes=unit.scenes.filter(scene=>scene.id!==sceneId);
  project.outlineGuides?.forEach(guide=>guide.beats.forEach(beat=>{beat.sceneRefs=beat.sceneRefs.filter(ref=>ref.unitId!==unitId||ref.sceneId!==sceneId);}));
  const oldTimelineCount=unit.timeline.length;
  unit.timeline=unit.timeline.filter(item=>item.sceneId!==sceneId);
  return oldTimelineCount-unit.timeline.length;
}

/** Remove a unit and private story data only when remaining units do not reference it. */
export function removeScriptUnit(project:ScriptProject,unitId:string):{characters:number;facts:number;storylines:number;tracks:number}{
  const unit=project.units.find(item=>item.id===unitId);
  if(!unit)throw new Error('单元不存在');
  if(project.units.length<=1)throw new Error('作品至少保留一个单元');
  const remaining=project.units.filter(item=>item.id!==unitId);
  const activeScopes=new Set([project.id,...(project.seasons||[]).map(season=>season.id),...remaining.flatMap(item=>[item.id,item.scopeId])]);
  const removedScopes=new Set([unit.id,unit.scopeId].filter(id=>!activeScopes.has(id)));
  const privateCharacters=project.characters.filter(item=>removedScopes.has(item.scopeId));
  const privateStorylines=(project.storylines||[]).filter(item=>removedScopes.has(item.scopeId));
  const privateCharacterIds=new Set(privateCharacters.map(item=>item.id));
  const privateStorylineIds=new Set(privateStorylines.map(item=>item.id));
  if(remaining.some(item=>item.scenes.some(scene=>scene.characterIds.some(id=>privateCharacterIds.has(id))
    ||scene.blocks.some(block=>block.speakerId&&privateCharacterIds.has(block.speakerId))
    ||scene.storylineIds?.some(id=>privateStorylineIds.has(id)))))throw new Error('其他单元仍引用此故事的专属人物或故事线，请先调整引用');
  if((project.continuityTracks||[]).some(track=>!removedScopes.has(track.scopeId)&&track.characterIds.some(id=>privateCharacterIds.has(id))))throw new Error('其他连续性记录仍引用此故事的专属人物，请先调整引用');
  const counts={characters:privateCharacters.length,facts:project.facts.filter(item=>removedScopes.has(item.scopeId)).length,
    storylines:privateStorylines.length,tracks:(project.continuityTracks||[]).filter(item=>removedScopes.has(item.scopeId)).length};
  project.units=remaining;
  if(project.outlineGuides)project.outlineGuides=project.outlineGuides.filter(guide=>!(guide.owner.kind==='unit'&&guide.owner.id===unitId)&&!removedScopes.has(guide.owner.id)).map(guide=>({...guide,nodeLinks:guide.nodeLinks.filter(link=>link.unitId!==unitId),beats:guide.beats.map(beat=>({...beat,unitIds:beat.unitIds.filter(id=>id!==unitId),sceneRefs:beat.sceneRefs.filter(ref=>ref.unitId!==unitId)}))}));
  project.characters=project.characters.filter(item=>!removedScopes.has(item.scopeId));
  project.facts=project.facts.filter(item=>!removedScopes.has(item.scopeId));
  if(project.storylines)project.storylines=project.storylines.filter(item=>!removedScopes.has(item.scopeId));
  if(project.storyOutlines)project.storyOutlines=project.storyOutlines.filter(item=>!removedScopes.has(item.scopeId));
  if(project.continuityTracks)project.continuityTracks=project.continuityTracks.filter(item=>!removedScopes.has(item.scopeId));
  return counts;
}
export const unitContentHash=(project:ScriptProject,unit:DeliveryUnit)=>{
  // Counting credits changes the report scope, not the authored content.
  // Keep the original default in the hash so existing v1 evidence remains valid.
  const profile={...project.profile,includeCredits:true};
  const evidenceIds=new Set((project.continuityTracks||[]).flatMap(t=>[...t.changes.map(c=>c.sceneId),...(t.threadPlan?[t.threadPlan.setupSceneId]:[])]));
  const structure=project.seasons?.length||project.storylines?.length||evidenceIds.size?{
    seasons:project.seasons||[],storylines:project.storylines||[],
    deliveryOrder:project.units.map(u=>({id:u.id,scopeId:u.scopeId,seasonId:u.seasonId})),
    continuityEvidence:project.units.flatMap(u=>u.scenes.filter(s=>evidenceIds.has(s.id)).map(scene=>({unitId:u.id,scene}))),
  }:undefined;
  return sha256(JSON.stringify({profile,brief:project.brief,characters:project.characters,facts:project.facts,methods:project.methods,continuityTracks:project.continuityTracks||[],structure,...(project.storyOutlines?{storyOutlines:project.storyOutlines}:{}),unit:{id:unit.id,scopeId:unit.scopeId,seasonId:unit.seasonId,summary:unit.summary,title:unit.title,targetDurationMs:unit.targetDurationMs,scenes:unit.scenes,...(unit.structureNodes?{structureNodes:unit.structureNodes}:{})}}));
};
export const estimateDialogue=(project:ScriptProject,unit:DeliveryUnit)=>{
  const characters=unit.scenes.flatMap(s=>s.blocks).filter(b=>b.type==='dialogue').reduce((sum,b)=>sum+Array.from(b.text.replace(/\s/g,'')).length,0);
  if(!characters) return null;
  return {id:newId('timing'),kind:'estimate' as const,source:'assumption' as const,contentHash:unitContentHash(project,unit),
    lowMs:Math.round(characters/5*1000),durationMs:Math.round(characters/4*1000),highMs:Math.round(characters/3*1000),
    assumptions:'仅对白：按每秒 3–5 个中文字符的未校准假设；不包含动作、停顿、并行剪辑。不是全片时长或置信区间。'};
};
export interface ScriptProposal { schemaVersion:'script-proposal.v1'; baseRevision:number; unitId:string; sceneId:string; inputHash:string; provider:'mock'; promptVersion:'scene.v1'; blocks:Scene['blocks']; }
export function createMockProposal(project:ScriptProject,unitId:string,sceneId:string):ScriptProposal {
  const unit=project.units.find(u=>u.id===unitId);const scene=unit?.scenes.find(s=>s.id===sceneId);
  if(!unit||!scene) throw new Error('场景不存在');
  return {schemaVersion:'script-proposal.v1',baseRevision:project.revision,unitId,sceneId,inputHash:unitContentHash(project,unit),provider:'mock',promptVersion:'scene.v1',
    blocks:[{id:newId('block'),type:'action',text:`【流程示例，非模型创作】${scene.title}。${scene.purpose || '请补充本场意图，再写下可以看见或听见的行动。'}`} ]};
}
export function applyProposal(project:ScriptProject,proposal:ScriptProposal):ScriptProject {
  const unit=project.units.find(u=>u.id===proposal.unitId);
  if(!unit||project.revision!==proposal.baseRevision||unitContentHash(project,unit)!==proposal.inputHash) throw new Error('提案基线已改变，请重新生成；当前稿未覆盖。');
  const next=structuredClone(project);const scene=next.units.find(u=>u.id===proposal.unitId)?.scenes.find(s=>s.id===proposal.sceneId);
  if(!scene) throw new Error('场景已删除'); scene.blocks.push(...proposal.blocks);return next;
}
