import { COMPATIBLE_SCRIPT_STAGES, type ScriptStage } from './agentStages';
import { AgentError, hashValue, type DomainGoalContract } from '../../agent-core/src';
import type { ScriptDraftScope } from './agentScope';
import type { GoalCheckContract } from './goalChecks';
import type { StoryCoverageContract } from './goalCoverage';

export type ScriptGoalContract={
  stopAfter?:ScriptStage;workspaceId:string;documentId:string;task:'WRITE'|'REVISE'|'REVIEW';
  scope:ScriptDraftScope;checks:GoalCheckContract;
  strategy:{id:'SCRIPT_GOAL_V1';maxNoProgressStreak:3};
};
const denied=(message:string):never=>{throw new AgentError('SCRIPT_GOAL_CONTRACT',message,400);};
const object=(v:unknown):Record<string,any>=>{if(!v||typeof v!=='object'||Array.isArray(v))return denied('剧本目标合同需要对象');return v as Record<string,any>;};
const exact=(value:object,keys:string[])=>{if(Object.keys(value).sort().join()!==keys.sort().join())denied('剧本目标合同包含缺失或未知字段');};
const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;

/** Only the trusted command receiver constructs this envelope. Parsing it
 * never grants access; the host still compares it to the stored authorization. */
export function parseScriptGoalContract(value:unknown):ScriptGoalContract{
  const input=object(value);exact(input,[...(input.stopAfter!==undefined?['stopAfter']:[]),'workspaceId','documentId','task','scope','checks','strategy']);
  if(!['WRITE','REVISE','REVIEW'].includes(input.task)||typeof input.workspaceId!=='string'||typeof input.documentId!=='string')denied('剧本目标身份无效');
  if(input.stopAfter!==undefined&&!COMPATIBLE_SCRIPT_STAGES.includes(input.stopAfter))denied('未知停止阶段');
  const scope=object(input.scope),checks=object(input.checks),strategy=object(input.strategy);
  if(scope.workspaceId!==input.workspaceId||scope.documentId!==input.documentId||!Array.isArray(scope.units))denied('剧本目标与作者范围不一致');
  if(input.task==='REVIEW'&&(!Array.isArray(scope.operations)||scope.operations.length||scope.newUnitSlots?.length||
    scope.storyOutlineScopeIds?.length||scope.seasonOutlineIds?.length||scope.characterIds?.length||scope.factIds?.length||scope.sharedFields?.length||scope.characterScopeIds?.length||scope.factScopeIds?.length||
    scope.units.some((unit:any)=>unit.allowSummary||unit.allowAllScenes||unit.allowStructure||unit.nodeScopes?.some((node:any)=>node.allowCreate)||unit.maxNewScenes||unit.scenes?.length)))
    denied('只审阅委托不能包含正文写入权限');
  if(input.task!=='REVIEW'&&(!Array.isArray(scope.operations)||!scope.operations.length))denied('写作委托缺少操作范围');
  exact(strategy,['id','maxNoProgressStreak']);
  if(strategy.id!=='SCRIPT_GOAL_V1'||strategy.maxNoProgressStreak!==3)denied('未知剧本执行策略');
  if(Object.keys(checks).some(k=>!['revision','targetUnitIds','targetScenes','localChecks','globalChecks','maxRawChars','maxIndexEntries','maxRepairRounds','requireStructureAlignment','storyCoverage'].includes(k)))denied('检查合同包含未知字段');
  if(!integer(checks.revision,1,1000000)||!integer(checks.maxRawChars,100,100000)||!integer(checks.maxRepairRounds,0,20)||
    checks.maxIndexEntries!==undefined&&!integer(checks.maxIndexEntries,1,5000)||checks.requireStructureAlignment!==undefined&&typeof checks.requireStructureAlignment!=='boolean')denied('检查批次或返修上限无效');
  if(!Array.isArray(checks.targetUnitIds)||!checks.targetUnitIds.length||new Set(checks.targetUnitIds).size!==checks.targetUnitIds.length||
    checks.targetUnitIds.some((id:unknown)=>!scope.units.some((unit:any)=>unit.unitId===id)))denied('检查目标不在作者确定的单元范围');
  if(checks.storyCoverage!==undefined){
    const coverage=object(checks.storyCoverage);exact(coverage,['originRevision','targets']);
    if(!integer(coverage.originRevision,1,Number.MAX_SAFE_INTEGER)||!Array.isArray(coverage.targets)||!coverage.targets.length)denied('大纲覆盖基线无效');
    const seen=new Set<string>();
    for(const raw of coverage.targets){const target=object(raw);exact(target,['unitId',...(target.nodeIds!==undefined?['nodeIds']:[])]);
      if(!checks.targetUnitIds.includes(target.unitId)||seen.has(target.unitId))denied('大纲覆盖目标越界或重复');seen.add(target.unitId);
      if(target.nodeIds!==undefined&&(!Array.isArray(target.nodeIds)||!target.nodeIds.length||new Set(target.nodeIds).size!==target.nodeIds.length||target.nodeIds.some((id:unknown)=>typeof id!=='string'||!id)))denied('结构覆盖目标无效');
    }
    if(!checks.globalChecks?.some((item:any)=>item.id==='story_coverage'))denied('大纲覆盖缺少真实审阅要求');
  }
  if(checks.targetScenes!==undefined){
    if(!Array.isArray(checks.targetScenes)||!checks.targetScenes.length||new Set(checks.targetScenes.map((item:any)=>item?.unitId)).size!==checks.targetScenes.length)denied('检查场景范围无效');
    for(const item of checks.targetScenes){
      exact(object(item),['unitId','sceneIds']);
      const grant=scope.units.find((unit:any)=>unit.unitId===item.unitId);
      if(!checks.targetUnitIds.includes(item.unitId)||!grant||grant.allowAllScenes||!Array.isArray(item.sceneIds)||(!item.sceneIds.length&&!grant.nodeScopes?.length)||
        new Set(item.sceneIds).size!==item.sceneIds.length||hashValue([...item.sceneIds].sort())!==hashValue([...new Set([...grant.scenes.map((scene:any)=>scene.sceneId),...(grant.nodeScopes??[]).flatMap((node:any)=>node.sceneIds)])].sort()))denied('检查范围必须与作者选定的场景一致');
    }
    if(scope.units.some((unit:any)=>!unit.allowAllScenes&&unit.scenes.length&&!checks.targetScenes.some((item:any)=>item.unitId===unit.unitId)))denied('检查范围遗漏选定单元');
  }
  for(const [key,dependency] of [['localChecks','EXACT_BLOCKS'],['globalChecks','WHOLE_MANUSCRIPT']] as const){
    const list=checks[key];if(!Array.isArray(list)||!list.length||list.length>20||new Set(list.map((x:any)=>x.id)).size!==list.length)denied('完整目标必须包含有效的局部和全稿检查');
    for(const item of list){exact(object(item),['id','dependency']);if(typeof item.id!=='string'||!item.id.trim()||item.id.length>100||item.dependency!==dependency)denied('检查类型或依赖范围无效');}
  }
  return structuredClone(input) as ScriptGoalContract;
}
export function scriptGoalEnvelope(value:ScriptGoalContract):DomainGoalContract{
  const contract=parseScriptGoalContract(value);return {pluginId:'script',version:'1',value:contract,digest:hashValue(contract)};
}
export function readScriptGoalEnvelope(envelope:DomainGoalContract):ScriptGoalContract{
  if(envelope.pluginId!=='script'||envelope.version!=='1'||envelope.digest!==hashValue(envelope.value))denied('剧本目标插件或合同摘要已改变');
  return parseScriptGoalContract(envelope.value);
}
export function defaultScriptChecks(unitIds:string[],revision=1,scope?:ScriptDraftScope,storyCoverage?:StoryCoverageContract):GoalCheckContract{
  const targetScenes=scope?.units.filter(unit=>!unit.allowAllScenes&&(unit.scenes.length||unit.nodeScopes?.length)).map(unit=>({unitId:unit.unitId,sceneIds:[...new Set([...unit.scenes.map(scene=>scene.sceneId),...(unit.nodeScopes??[]).flatMap(node=>node.sceneIds)])]}));
  return {revision,targetUnitIds:[...unitIds],...(targetScenes?.length?{targetScenes}:{}),localChecks:[{id:'author_intent',dependency:'EXACT_BLOCKS'},{id:'body_integrity',dependency:'EXACT_BLOCKS'}],
    globalChecks:[{id:'story_continuity',dependency:'WHOLE_MANUSCRIPT'},{id:'characters_and_facts',dependency:'WHOLE_MANUSCRIPT'},...(storyCoverage?[{id:'story_coverage',dependency:'WHOLE_MANUSCRIPT' as const}]:[])],maxRawChars:16000,maxIndexEntries:500,maxRepairRounds:2,...(storyCoverage?{storyCoverage,requireStructureAlignment:true}:{})};
}
