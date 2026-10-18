import {getOutlineGuide,outlineHash,outlineText,anchorCurrent} from './outlineGuides';
import { BLUEPRINT_BRIEF_FIELDS } from './blueprint';
import type { ScriptProject } from './schema';
import { assertStructureScopesCurrent, emptyScriptDraftCreationLedger, type ScriptDraftScope, type AgentDraftOperation, type ScriptDraftCreationLedger } from './agentScope';
import type { GoalCheckContract } from './goalChecks';

export const SCRIPT_STAGES=['BLUEPRINT','OUTLINE','SCENES','BODY'] as const;
// Frozen historical contracts keep their original boundary; new pickers expose four stages.
export const COMPATIBLE_SCRIPT_STAGES=[...SCRIPT_STAGES,'BEATS'] as const;
export type ScriptStage=typeof COMPATIBLE_SCRIPT_STAGES[number];
export const stageLabels:Record<ScriptStage,string>={BLUEPRINT:'全案蓝图',OUTLINE:'故事大纲',BEATS:'故事节拍（旧任务）',SCENES:'分场规划',BODY:'剧本初稿与检查'};
export const stageDescriptions:Record<ScriptStage,string>={
  BLUEPRINT:'整理核心构想、主要人物、必要设定和创作方向。允许保留待定事项，不要求提前完成整个故事。',
  OUTLINE:'形成整体故事或所选集的大纲：具体事件、人物选择、前后因果与结局或阶段落点。单元剧允许各集独立，不强求全剧结局线。电影已有完整故事大纲时不必再重复生成单元摘要。',
  SCENES:'把所选范围展开为有顺序的场景，说明每场发生什么、谁在、地点时间和必要的前后变化。节拍与节奏在此处理，不另生成一份重复节拍稿；不写正文。',
  BODY:'展开约定范围的动作、对白和场景描写，完成检查与有限修订。交付可阅读初稿和未解决事项，不等同于作者验收或最终定稿。',
  BEATS:'按旧委托交付场景级故事推进规划，保留原停止边界，不自动升级到分场或正文。',
};
export const SCRIPT_WORKFLOW_GUIDANCE='默认流程：全案蓝图 → 故事大纲（含分集）→ 分场规划（含节拍与节奏）→ 剧本写作（含修订）。阶段可以往返或按作者要求跳过；上游资料可持续完善，不必全部填满。大纲要讲具体事件、人物选择与因果，不重复世界观介绍。分场是场景序列，节拍是事件或情绪变化，两者不强制一一对应。不强制三幕、十五节拍、每场反转或人物蜕变。剧集先有整体方向，再逐集细化，允许只完成当前集，不要求全部集数先完成分场。修改上游只说明需复核的下游内容，不擅自改写授权范围外的稿件。';
export const isPlanningStage=(stage:ScriptStage|undefined)=>Boolean(stage&&stage!=='BODY');
/** Stop boundaries are permissions, not just prompt wording. Earlier stages
 * may only be changed when separately included in the author's target. */
export function restrictStageScope(scope:ScriptDraftScope,stage:ScriptStage){
  if(stage==='BODY')return;
  const allowed:AgentDraftOperation[]=stage==='BLUEPRINT'?[...BLUEPRINT_BRIEF_FIELDS,'add_character','add_fact','update_character','update_fact']:
    stage==='OUTLINE'?[...BLUEPRINT_BRIEF_FIELDS,'add_character','add_fact','update_character','update_fact','project_outline','story_outline','season_outline','unit_outline','outline_development','plan_structure','add_unit']:[...BLUEPRINT_BRIEF_FIELDS,'add_character','add_fact','update_character','update_fact','project_outline','story_outline','season_outline','unit_outline','outline_development','plan_structure','plan_scenes','scene_plan','add_unit'];
  scope.operations=scope.operations.filter(op=>allowed.includes(op));
  if((stage==='BEATS'||stage==='SCENES')&&!scope.operations.includes('scene_plan'))scope.operations.push('scene_plan');
  scope.sharedFields=scope.sharedFields.filter(field=>stage==='BLUEPRINT'?BLUEPRINT_BRIEF_FIELDS.includes(field as any):true);
  for(const unit of scope.units){
    if(stage==='BLUEPRINT')unit.allowStructure=false;
    unit.allowSummary=unit.allowSummary&&stage!=='BLUEPRINT';
    for(const scene of unit.scenes){
      scene.allowBody=false;
      if((stage==='BEATS'||stage==='SCENES')&&scene.blockIds===null&&!scene.selection)scene.allowPlan=true;
    }
    if(stage==='BLUEPRINT'||stage==='OUTLINE')unit.maxNewScenes=0;
  }
  if(stage==='BLUEPRINT'){scope.newUnitSlots=[];scope.outlineGrants=[];scope.storyOutlineScopeIds=[];scope.seasonOutlineIds=[];}
  for(const slot of scope.newUnitSlots)if(stage==='OUTLINE')slot.maxNewScenes=0;
}
export function stageDelivery(project:ScriptProject,scope:ScriptDraftScope,stage:ScriptStage,options:{ledger?:ScriptDraftCreationLedger;contract?:GoalCheckContract}={}){
  const units=scope.units.map(grant=>project.units.find(unit=>unit.id===grant.unitId));
  if(stage==='BLUEPRINT')return {content:{concept:project.brief.concept,theme:project.brief.theme,audienceExperience:project.brief.audienceExperience,constraints:project.brief.constraints,characters:project.characters.filter(c=>(scope.characterScopeIds.includes(c.scopeId)||scope.characterIds?.includes(c.id))),facts:project.facts.filter(f=>(scope.factScopeIds.includes(f.scopeId)||scope.factIds?.includes(f.id)))},ready:Boolean(project.brief.concept.trim()),gaps:[] as string[]};
  if(stage==='OUTLINE'){
    if(scope.outlineGrants?.length){
      const grants=scope.outlineGrants.map(grant=>{
        const guide=getOutlineGuide(project,grant.owner),original=outlineText(project,grant.owner);
        const current=guide?.development?.sourceHash===outlineHash(original)
          &&scope.units.some(unit=>unit.unitId===guide.development.unitId)
          &&(!grant.nodeId||project.units.some(unit=>unit.id===guide.development.unitId&&unit.structureNodes?.some(node=>node.id===grant.nodeId))&&guide.nodeLinks.filter(link=>link.unitId===guide.development.unitId&&link.nodeId===grant.nodeId).length===1)
          &&(grant.nodeId?guide.development.nodeId===grant.nodeId:guide.development.full);
        // Local delivery follows the identities produced by this development.
        // Offsets from stale, unrelated originals cannot identify membership.
        const beats=grant.nodeId
          ? guide?.development?.beatIds?.map(id=>guide.beats.find(beat=>beat.id===id))
          : guide?.beats;
        return {owner:grant.owner,original,guide,ready:Boolean(original.trim()&&current
          &&guide?.development?.nodes&&guide.development.beats
          &&guide.nodeLinks.filter(link=>!grant.nodeId||link.nodeId===grant.nodeId).every(link=>anchorCurrent(link.anchor,original))
          &&beats&&beats.every(beat=>beat&&beat.anchors.every(a=>anchorCurrent(a,original))))};
      });
      return {content:grants,ready:grants.every(item=>item.ready),gaps:grants.filter(item=>!item.ready).map(()=> '联合大纲尚有缺项或关系依据待复核')};
    }
    const includesOutline=scope.sharedFields.includes('outline');
    const summaries=scope.units.filter(grant=>grant.allowSummary).map(grant=>project.units.find(unit=>unit.id===grant.unitId));
    const stories=(scope.storyOutlineScopeIds??[]).map(scopeId=>({scopeId,outline:project.storyOutlines?.find(item=>item.scopeId===scopeId)?.outline??''}));
    const seasons=(scope.seasonOutlineIds??[]).map(id=>({id,outline:project.seasons?.find(item=>item.id===id)?.arc??''}));
    return {content:{outline:includesOutline?project.brief.outline:null,stories,seasons,units:summaries.map(unit=>({id:unit?.id,summary:unit?.summary,structure:unit?.structureNodes}))},
      ready:(includesOutline||summaries.length>0||stories.length>0||seasons.length>0)&&(!includesOutline||Boolean(project.brief.outline.trim()))&&[...stories,...seasons].every(item=>item.outline.trim())&&summaries.every(unit=>Boolean(unit)&&(Boolean(unit?.summary.trim())||(project.profile.organization==='standalone'&&includesOutline&&Boolean(project.brief.outline.trim())))),gaps:[] as string[]};
  }
  const ledger=options.ledger??emptyScriptDraftCreationLedger(),gaps:string[]=[];
  try{assertStructureScopesCurrent(project,scope,ledger);}catch(error){gaps.push(error instanceof Error?error.message:'结构范围已变化');}
  const selected=units.map((unit,index)=>{
    const grant=scope.units[index];
    const scenes=unit?.scenes.filter(scene=>{
      if(grant.nodeScopes?.length)return grant.nodeScopes.some(node=>{
        if(![node.nodeId,...node.descendantNodeIds].includes(scene.structureNodeId??''))return false;
        if(node.sceneIds.includes(scene.id))return !node.stopAfterSceneId||node.sceneIds.indexOf(scene.id)<=node.sceneIds.indexOf(node.stopAfterSceneId);
        return node.allowCreate&&!node.stopAfterSceneId&&ledger.scenes.some(entry=>entry.unitId===unit.id&&entry.sceneId===scene.id);
      });
      return grant.allowAllScenes||grant.scenes.some(item=>item.sceneId===scene.id)||ledger.scenes.some(entry=>entry.unitId===unit.id&&entry.sceneId===scene.id);
    });
    if(!grant.allowAllScenes&&grant.scenes.some(item=>!unit?.scenes.some(scene=>scene.id===item.sceneId)))gaps.push(`单元 ${grant.unitId} 的冻结分场已删除`);
    return scenes;
  });
  if(stage==='SCENES'&&options.contract?.storyCoverage){
    const contract=options.contract;gaps.push(...contract.outlineGaps??[]);
    if(!contract.outlineRequirements?.length)gaps.push('约定大纲范围尚未建立，不能从现有场数推断分场完成');
    for(const item of contract.outlineRequirements??[]){
      const index=scope.units.findIndex(grant=>grant.unitId===item.unitId),unit=units[index],scenes=selected[index]??[];
      if(!scenes.some(scene=>scene.purpose.trim()&&(scene.outlineRequirementIds?.includes(item.id)||item.ownerKind==='node'&&(scene.structureNodeId===item.ownerId||unit?.structureNodes?.find(node=>node.id===scene.structureNodeId)?.parentId===item.ownerId))))gaps.push(`大纲范围 ${item.id} 尚未映射到本次分场`);
    }
  }
  const plans=selected.map(scenes=>scenes?.map(scene=>({id:scene.id,title:scene.title,purpose:scene.purpose,entryState:scene.entryState,exitState:scene.exitState,
    ...(scene.structureNodeId?{structureNodeId:scene.structureNodeId}:{}),...(scene.outlineRequirementIds?{outlineRequirementIds:scene.outlineRequirementIds}:{}),...(stage==='SCENES'?{location:scene.location,timeOfDay:scene.timeOfDay}: {})})));
  return {content:plans,ready:!gaps.length&&plans.length>0&&plans.every(scenes=>Boolean(scenes?.length)&&scenes!.every(scene=>scene.purpose.trim()&&(stage!=='SCENES'||Boolean(scene.location?.trim())))),gaps:[...new Set(gaps)]};
}
