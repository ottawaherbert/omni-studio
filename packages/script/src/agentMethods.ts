import { AgentError, hashValue } from '../../agent-core/src';
import { freezeSkills, type FrozenSkill, type SkillTrace } from '../../agent-context/src';
import { buildScriptTaskContext, methodUsage } from './methods';
import type { AgentDraftOperation } from './agentScope';
import type { MethodBinding, MethodUsage, ScriptOperation, ScriptProject } from './schema';

export const AGENT_METHOD_OPERATIONS:Record<AgentDraftOperation|'review',ScriptOperation>={
  scene_order:'plan',outline_development:'outline',concept:'concept',theme:'theme',audienceExperience:'concept',constraints:'concept',update_character:'character',update_fact:'fact',project_outline:'outline',unit_outline:'unit_outline',add_unit:'unit_outlines',plan_scenes:'plan',scene_plan:'plan',scene_body:'scene',
  replace_blocks:'rewrite',replace_selection:'text_rewrite',add_character:'character',add_fact:'fact',review:'review',
  story_outline:'story_outline',season_outline:'season_outline',plan_structure:'plan',append_scene_body:'scene',
};
export type PreparedAgentMethods={operation:ScriptOperation;skills:FrozenSkill[];skippedTrace:SkillTrace[];selectedIds:string[];inputs:MethodUsage['inputs'];auxiliaryContext:Record<string,unknown>|null};

/** Method configuration has the same meaning for manual and Agent tools.
 * Callers supply their authorized current-unit selection, never a first-unit
 * fallback. The returned auxiliary records are planning aids, not body facts. */
export function prepareAgentMethods(input:{project:ScriptProject;methods:MethodBinding[];operation:AgentDraftOperation|'review';targetUnitIds:string[];targetSceneId?:string;readBlockIds?:string[]}):PreparedAgentMethods{
  const operation=AGENT_METHOD_OPERATIONS[input.operation];
  if(!operation)throw new AgentError('SCRIPT_METHOD_OPERATION','未知写作操作的 Skill 语义',400);
  const targets=input.targetUnitIds;
  if(!Array.isArray(targets)||new Set(targets).size!==targets.length||targets.some(id=>!input.project.units.some(unit=>unit.id===id)))throw new AgentError('SCRIPT_METHOD_SCOPE','Skill 辅助资料需要明确存在的目标单元，不能默认选择第一集',400);
  const methods=input.methods.map(method=>({...structuredClone(method),usage:structuredClone(methodUsage(method))}));
  for(const method of methods)if(!Array.isArray(method.usage.operations)||!Array.isArray(method.usage.inputs)||method.usage.inputs.some(v=>!['structure','continuity'].includes(v)))throw new AgentError('SCRIPT_METHOD_USAGE','Skill 使用配置无效',400);
  const frozen=freezeSkills(methods.map(method=>({id:method.id,title:method.title,version:method.version,content:method.content,variables:{},configuration:{...method.usage},overflow:'ERROR'})));
  const applicable=methods.filter(method=>method.usage.operations.includes(operation)),ids=new Set(applicable.map(method=>method.id));
  const skills=frozen.filter(skill=>ids.has(skill.id)),skippedTrace:SkillTrace[]=frozen.filter(skill=>!ids.has(skill.id)).map(skill=>({id:skill.id,version:skill.version,snapshotHash:skill.snapshotHash,contentHash:skill.contentHash,status:'SKIPPED',reason:'SKIPPED_OPERATION',renderedText:''}));
  const inputs=[...new Set(applicable.flatMap(method=>method.usage.inputs))];
  let auxiliaryContext:Record<string,unknown>|null=null;
  if(inputs.length){
    // Compute continuity against the actual saved scene hashes, then redact
    // only the raw evidence before sending it. Redacting before computation
    // would falsely report an unchanged author record as a stale change.
    const readableIds=new Set(input.readBlockIds??[]);
    const readableScene=(scene:ScriptProject['units'][number]['scenes'][number])=>({...scene,
      blocks:scene.id!==input.targetSceneId?[]:
        input.operation==='scene_body'?scene.blocks:
        input.operation==='replace_blocks'?scene.blocks.filter(block=>readableIds.has(block.id)):[]});
    const units=input.project.units.filter(unit=>targets.includes(unit.id));
    const scopes=new Set([input.project.id,...units.flatMap(unit=>[unit.id,unit.scopeId,...(unit.seasonId?[unit.seasonId]:[])])]);
    const sceneIds=new Set(units.flatMap(unit=>unit.scenes.map(scene=>scene.id))),omittedEvidenceSceneIds=new Set<string>();
    // Keep unavailable reference identities so the existing continuity reader
    // reports uncertainty; never expose values from a nonselected scene or
    // silently treat omitted changes as a confirmed initial state.
    const continuityTracks=(input.project.continuityTracks||[]).filter(track=>scopes.has(track.scopeId)).map(track=>({...track,
      changes:track.changes.map(change=>{if(sceneIds.has(change.sceneId))return change;omittedEvidenceSceneIds.add(change.sceneId);return {...change,value:'本次未读取的场景依据，不能推断状态',reason:'NOT_SELECTED'};}),
    }));
    const selectedProject:ScriptProject={...input.project,methods:applicable,units,characters:input.project.characters.filter(c=>scopes.has(c.scopeId)),facts:input.project.facts.filter(f=>scopes.has(f.scopeId)),
      seasons:(input.project.seasons||[]).filter(season=>units.some(unit=>unit.seasonId===season.id)),storylines:(input.project.storylines||[]).filter(line=>scopes.has(line.scopeId)),continuityTracks};
    const byUnit=units.map(unit=>{
      const context=buildScriptTaskContext(selectedProject,unit,operation,applicable.map(method=>method.id),input.targetSceneId).context;
      const continuity=context.continuity as {evidenceScenes:Array<{unitId:string;unitTitle:string;scene:ScriptProject['units'][number]['scenes'][number]}>}|undefined;
      const redactedContinuity=continuity?{...continuity,evidenceScenes:continuity.evidenceScenes.map(evidence=>({...evidence,scene:readableScene(evidence.scene)}))}:null;
      return {unitId:unit.id,...(inputs.includes('structure')?{structure:{seasons:context.seasons??[],storylines:context.storylines??[]}}:{}),
        ...(inputs.includes('continuity')?{continuity:redactedContinuity}:{})};
    });
    auxiliaryContext={meaning:'AUXILIARY_PLANNING_NOT_MANUSCRIPT',notice:'这些是作者维护的结构与连续性辅助记录，不等于正文实际发生的事件。未来变化和计划不能冒充当前事实；正文检查覆盖仍由真实发送的检查区间单独计算。',
      inputs,targetUnitIds:[...targets],units:byUnit,omittedEvidenceSceneIds:[...omittedEvidenceSceneIds],
      ...(units.length===0?{unavailableReason:'本次没有已存在的目标单元，不默认读取其他集的辅助资料'}:{})};
  }
  return {operation,skills,skippedTrace,selectedIds:methods.map(method=>method.id),inputs,auxiliaryContext};
}
export function mergeAgentMethodTrace(prepared:PreparedAgentMethods,applied:SkillTrace[]):SkillTrace[]{
  const expected=new Map(prepared.skills.map(skill=>[skill.id,skill]));
  if(applied.length!==expected.size||new Set(applied.map(trace=>trace.id)).size!==applied.length)throw new AgentError('SCRIPT_METHOD_TRACE','Skill 使用追溯与实际冻结方法不一致');
  for(const trace of applied){const skill=expected.get(trace.id);if(!skill||trace.snapshotHash!==skill.snapshotHash||trace.contentHash!==hashValue(skill.content))throw new AgentError('SCRIPT_METHOD_TRACE','Skill 使用追溯与实际冻结方法不一致');}
  const traces=new Map([...applied,...prepared.skippedTrace].map(trace=>[trace.id,trace]));
  return prepared.selectedIds.map(id=>traces.get(id)!);
}
