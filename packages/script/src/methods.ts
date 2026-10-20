import { SCRIPT_OPERATIONS, type MethodBinding, type MethodUsage, type ScriptOperation, type ScriptProject, type DeliveryUnit } from './schema';
import { writingContext, unitCharacters, unitFacts } from './continuity';
import type { SkillDTO } from '../../domain/src/skill';
import { scopedBrief } from './outlines';
import { buildRequiredWritingContext } from './writingContext';

export const OPERATION_LABELS:Record<ScriptOperation,string>={story_outline:'当前故事大纲建议',season_outline:'本季大纲建议',scene:'写作 / 改写本场',text_rewrite:'润色选中文字',consult:'讨论当前故事',concept:'故事前提建议',theme:'主题与问题建议',character:'新人物建议',fact:'故事设定建议',rewrite:'改写选中段落',outline:'故事总纲建议',unit_outline:'本单元大纲建议',unit_outlines:'规划各单元大纲',plan:'补充本单元分场',board_plan:'全剧分场建议',ending:'结尾安排建议',scene_turn:'场景变化建议',review:'审阅当前场'};
export const INPUT_LABELS={structure:'结构辅助记录',continuity:'连续性辅助记录'};
export const DEFAULT_METHOD_USAGE:MethodUsage={operations:[...SCRIPT_OPERATIONS],inputs:[],note:''};
export const methodUsage=(method:MethodBinding):MethodUsage=>method.usage||DEFAULT_METHOD_USAGE;
export const methodFromSkill=(skill:SkillDTO):MethodBinding=>({id:`skill:${skill.id}`,title:skill.title,version:String(skill.revision||skill.updatedAt),content:skill.content,...(skill.purposes?{purposes:structuredClone(skill.purposes)}:{}),...(skill.applicability?{applicability:structuredClone(skill.applicability)}:{})});
export function selectSharedMethods(skills:SkillDTO[],ids:unknown):MethodBinding[]{
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'))throw new Error('本次 Skill 选择需要最多 100 个标识');
  const methods=ids.map(id=>{
    const skill=skills.find(item=>item.id===id||`skill:${item.id}`===id);
    if(!skill)throw Object.assign(new Error('所选 Skill 已删除或不可访问，请重新选择'),{status:409});
    return methodFromSkill(skill);
  });
  if(new Set(methods.map(method=>method.id)).size!==methods.length)throw new Error('本次 Skill 不能重复');
  return methods;
}
export const selectedMethodVersions=(methods:MethodBinding[],ids:string[])=>Object.fromEntries(ids.map(id=>[id,methods.find(method=>method.id===id)?.version]));
export const availableMethods=(project:ScriptProject,operation:ScriptOperation)=>project.methods.filter(m=>methodUsage(m).operations.includes(operation));

/** IDs select trusted task snapshots; historical project bindings remain readable. */
export function selectTaskMethods(project:ScriptProject,operation:ScriptOperation,ids:unknown,source=project.methods):MethodBinding[]{
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('本次 Skill 选择需要最多 100 个不重复的标识');
  return ids.map(id=>{
    const method=source.find(m=>m.id===id);
    if(!method)throw new Error('所选 Skill 不可用，请重新选择');
    if(!methodUsage(method).operations.includes(operation))throw new Error('所选 Skill 不适用于本次任务');
    return structuredClone({...method,usage:methodUsage(method)});
  });
}

export function buildScriptTaskContext(project:ScriptProject,unit:DeliveryUnit,operation:ScriptOperation,ids:string[],targetSceneId?:string,reviewSceneIds?:string[]){
  const methods=selectTaskMethods(project,operation,ids);
  const inputs=[...new Set(methods.flatMap(m=>methodUsage(m).inputs))];
  const all=operation==='outline'&&project.profile.continuity!=='anthology';
  const projectStructure=inputs.includes('structure');
  const targetIndex=unit.scenes.findIndex(scene=>scene.id===targetSceneId);
  const focused=targetIndex>=0 && (['scene','rewrite','text_rewrite','consult'].includes(operation));
  const planning=operation==='plan';
  const reviewScope=operation==='review' && reviewSceneIds?.length;
  const bodySceneIds=focused
    ? unit.scenes.slice(Math.max(0,targetIndex-1),Math.min(unit.scenes.length,targetIndex+2)).map(scene=>scene.id)
    : planning ? unit.scenes.slice(-2).map(scene=>scene.id)
    : reviewScope ? unit.scenes.filter(scene=>reviewSceneIds.includes(scene.id)).map(scene=>scene.id)
    : unit.scenes.map(scene=>scene.id);
  const bodySceneIdSet=new Set(bodySceneIds);
  const sceneContext=(scene:DeliveryUnit['scenes'][number])=>{
    const {storylineIds,storyOrder,blocks,...base}=scene;
    return {...base,...(bodySceneIdSet.has(scene.id)?{blocks:blocks.map(({id,type,text,speakerId,speakerName})=>({id,type,text,...(speakerId?{speakerId}:{}),...(speakerName?{speakerName}:{})}))}:{}),...(projectStructure?{storylineIds}:{}),...(inputs.includes('continuity')?{storyOrder}:{})};
  };
  // Project settings and the operation's content range are essential; optional methods cannot enlarge the write scope.
  const context:{
    title:string;profile:ScriptProject['profile'];brief:ReturnType<typeof scopedBrief>;requiredContext:ReturnType<typeof buildRequiredWritingContext>;
    characters:ScriptProject['characters'];facts:ScriptProject['facts'];
    unit:unknown;otherUnits:unknown[];bodyCoverage:unknown;unregisteredSpeakerNames:string[];seasons?:unknown;storylines?:unknown;continuity?:unknown;
  }={
    title:project.title,
    // Only active writing fields enter prompts; archived metadata stays in stored versions.
    profile:((p)=>({organization:p.organization,continuity:p.continuity,workType:p.workType,genres:p.genres,language:p.language,plannedUnits:p.plannedUnits,targetDurationMs:p.targetDurationMs,toleranceMs:p.toleranceMs,includeCredits:p.includeCredits,aspectRatio:p.aspectRatio,productionMode:p.productionMode}))(project.profile),brief:scopedBrief(project,[unit.id],{includeProjectOutline:operation==='outline'}),
    requiredContext:buildRequiredWritingContext(project,{unitIds:[unit.id],sceneId:targetSceneId,operation,includeProjectOutline:operation==='outline'}),
    characters:(all?project.characters:unitCharacters(project,unit)).map(({id,name,bio,scopeId,desire,need,contradiction,arc,voice})=>({id,name,bio,scopeId,desire,need,contradiction,arc,voice})),facts:(all?project.facts:unitFacts(project,unit)).map(({id,text,scopeId,status})=>({id,text,scopeId,status})),
    unit:{index:project.units.findIndex(u=>u.id===unit.id)+1,id:unit.id,title:unit.title,summary:unit.summary,endingHook:unit.endingHook,scopeId:unit.scopeId,seasonId:unit.seasonId,targetDurationMs:unit.targetDurationMs,
      scenes:unit.scenes.map(sceneContext)},
    unregisteredSpeakerNames:[...new Set(unit.scenes.flatMap(scene=>scene.blocks.filter(block=>block.type==='dialogue'&&block.speakerName).map(block=>block.speakerName!.trim())))],
    otherUnits:project.units.filter(u=>u.id!==unit.id&&(all||u.scopeId===unit.scopeId)).map(u=>({index:project.units.findIndex(item=>item.id===u.id)+1,id:u.id,title:u.title,scopeId:u.scopeId,summary:u.summary,endingHook:u.endingHook,targetDurationMs:u.targetDurationMs})),
    bodyCoverage:{mode:focused?'target_and_neighbors':planning?'last_two_scenes':reviewScope?'selected_scenes':'entire_unit',sceneIds:bodySceneIds,omittedSceneCount:unit.scenes.length-bodySceneIds.length},
  };
  if(inputs.length){
    const extended=writingContext(project,unit,all);
    if(projectStructure){context.seasons=extended.seasons;context.storylines=extended.storylines;}
    if(inputs.includes('continuity')){
      const {structureIssues,evidenceScenes,...continuity}=extended.continuity;
      context.continuity={...continuity,evidenceScenes:evidenceScenes.map(e=>({...e,scene:sceneContext(e.scene)})),...(projectStructure?{structureIssues}:{})};
    }
  }
  const instructions=methods.map(m=>`Skill：${m.title}\n版本：${m.version}\n额外资料：${methodUsage(m).inputs.map(input=>INPUT_LABELS[input]).join('、')||'无'}\n${m.content}${methodUsage(m).note?`\n已保存的补充要求：${methodUsage(m).note}`:''}`).join('\n\n');
  return {context,methods,inputs,instructions:instructions||'本次未选用 Skill；依据作者要求完成当前任务，不套用特定编剧框架。'};
}
