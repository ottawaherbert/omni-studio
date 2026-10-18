import { parseModelJson } from '../../model-output/src';
import { unitCharacters, continuityDiagnostics } from './continuity';
import { newId, newScene, newUnit, unitContentHash } from './project';
import { applyUnitOutlines, parseProposedUnitOutlines, applyWholeBoardPlan, parseProposedSceneUnits, parseScriptChoices, sceneHasAuthorWork, type ProposedUnit, type ScriptChoice } from './planning';
import { parseScriptBlock, parseScriptProject, SCRIPT_OPERATIONS, type ScriptOperation, type ScriptBlock, type ScriptProject } from './schema';
import {blocksToScreenplayText,replaceScreenplaySelection} from './fountainAdapter';
import { selectTaskMethods, methodUsage } from './methods';
import { generatedSceneState } from './continuation';
import { hashValue } from '../../agent-core/src/identity';

export { SCRIPT_OPERATIONS, type ScriptOperation } from './schema';
export type ScriptJobQuery={unitId?:string;sceneId?:string;operation?:string;status?:string;standalone?:boolean;before?:string;limit?:number};
export type ReviewSource={jobId:string;index:number};
export type ReviewSceneHandler=(sceneId:string,issue:string,suggestion:string,source?:ReviewSource,operation?:'scene'|'review')=>void;
export type TextSelection={start:number;end:number;text:string};
export const CHOICE_OPERATIONS:ScriptOperation[]=['ending','scene_turn','concept','theme','character','fact'];
export type DevelopmentSuggestion={title:string;content:string;name?:string;voice?:string;desire?:string;need?:string};
export type ScriptExecution={id:string;owner:string;startedAt:number;expiresAt:number;state:'active'|'finished'};
export interface ScriptJob {
  id: string; projectId: string; baseRevision: number; inputHash: string;
  unitId: string; sceneId: string; operation: ScriptOperation; blockIds?: string[]; reviewSceneIds?:string[]; agentRunId?:string;
  status: 'waiting' | 'ready' | 'failed' | 'cancelled' | 'approved' | 'rejected';
  prompt: string; promptVersion: 'script-assist.v1'|'script-assist.v2'; schemaVersion: 'script-result.v1';
  inputSections?:string[];
  methods: ScriptProject['methods']; createdAt: number; updatedAt: number;
  executionPrompt?: {prompt:string;systemInstruction:string};
  execution?:ScriptExecution;
  executionHistory?:ScriptExecution[];
  attempts?: { rawResult: string; error?: string; createdAt: number; provenance: NonNullable<ScriptJob['provenance']>; executionPrompt?:ScriptJob['executionPrompt'] }[];
  result?: ScriptResult; rawResult?: string; error?: string; appliedRevision?: number;
  selectedChoiceIndex?:number;
  selection?:TextSelection; scopeId?:string; authorRequest?:string;
  seasonId?:string; unitIndices?:number[]; unitBatch?:{originalOrder:string[];sourceUnits?:Array<{id:string;hash:string}>;sourceHash:string;targets:Array<{index:number;id:string;existing:boolean;hash:string|null;scopeId:string;duration:number}>};
  reviewSource?:ReviewSource;
  reviewDecisions?: Record<string,{status:'to_fix'|'keep'|'later'|'revised'|'verified'|'unresolved';note?:string;updatedAt:number;revision?:number;revisionJobId?:string;recheckJobId?:string}>;
  provenance?: { source: 'manual_external' | 'api'; provider: string; modelId: string };
}
export type ScriptResult = { summary: string; answer?:string; replacement?:string; suggestions?:DevelopmentSuggestion[]; blocks?: ScriptBlock[]; outline?: string; scenePlans?: { title: string; purpose: string; location: string; timeOfDay: string }[]; units?: ProposedUnit[]; choices?:ScriptChoice[]; findings?: { sceneId: string; issue: string; suggestion: string }[] };
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型结果需要 JSON 对象');
  return value as Record<string, unknown>;
};
const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200_000) throw new Error(`${name}需要非空文本（最多 200000 字符）`);
  return value;
};
export function assertJobBaseline(project: ScriptProject, job: ScriptJob) {
  const unit = project.units.find(u => u.id === job.unitId);
  if(job.operation==='unit_outlines'&&job.unitBatch&&project.id===job.projectId&&unit){
    const batch=job.unitBatch;
    if(batch.sourceUnits?.some(source=>{const unit=project.units.find(unit=>unit.id===source.id);return !unit||hashValue(unit)!==source.hash;}))throw Object.assign(new Error('分集候选引用的已有内容发生变化，请重新核对生成依据'),{statusCode:409});
    if(batch.originalOrder.some((id,i)=>project.units[i]?.id!==id)||hashValue({profile:project.profile,brief:project.brief,characters:project.characters,facts:project.facts,storyOutlines:project.storyOutlines??[],seasons:project.seasons??[]})!==batch.sourceHash)throw Object.assign(new Error('分集顺序或生成依据已变化，请重新核对候选目标'),{statusCode:409});
    for(const proposal of job.result?.units??[]){const target=batch.targets.find(t=>t.index===proposal.unitIndex),current=project.units[(proposal.unitIndex??0)-1];if(!target||target.existing?(!target||!current||current.id!==target.id||hashValue(current)!==target.hash):Boolean(current))throw Object.assign(new Error('冻结集号已被占用或原集改动，请处理目标冲突'),{statusCode:409});}
    return unit;
  }
  if (project.id !== job.projectId || project.revision !== job.baseRevision || !unit || unitContentHash(project, unit) !== job.inputHash) {
    throw Object.assign(new Error('提案基线已改变；当前稿未覆盖，请从最新版本重新生成。'), { statusCode: 409 });
  }
  return unit;
}
export function createScriptJob(project: ScriptProject, input: { operation: ScriptOperation; unitId: string; sceneId: string; prompt: string; expectedRevision: number; blockIds?: string[]; methodIds?:string[]; reviewSceneIds?:string[]; agentRunId?:string;reviewSource?:ReviewSource;selection?:TextSelection;scopeId?:string;seasonId?:string;unitIndices?:number[];authorRequest?:string },methodSource=project.methods): ScriptJob {
  if (!SCRIPT_OPERATIONS.includes(input.operation)) throw new Error('不支持的写作步骤');
  if (project.revision !== input.expectedRevision) throw Object.assign(new Error('生成基线已改变'), { statusCode: 409 });
  const unit = project.units.find(u => u.id === input.unitId);
  if (!unit || (['board_plan','ending','outline','story_outline','season_outline','unit_outline','unit_outlines','concept','theme','character','fact','consult'].includes(input.operation) ? input.sceneId!==unit.id&&!unit.scenes.some(s=>s.id===input.sceneId) : !unit.scenes.some(s => s.id === input.sceneId))) throw new Error('目标场景不存在');
  if(!['outline','unit_outlines','board_plan'].includes(input.operation)&&continuityDiagnostics(project,unit).length)throw new Error('请先修复本单元的人物作用域引用，再请求模型。');
  const methods=selectTaskMethods(project,input.operation,input.methodIds??[],methodSource);
  if(input.reviewSource&&(!['scene','rewrite','review'].includes(input.operation)||input.agentRunId||typeof input.reviewSource.jobId!=='string'||!Number.isInteger(input.reviewSource.index)||input.reviewSource.index<0))throw new Error('审阅来源与当前任务不匹配');
  let selection:TextSelection|undefined;
  if(input.operation==='text_rewrite'){
    const scene=unit.scenes.find(s=>s.id===input.sceneId)!;
    const source=blocksToScreenplayText(scene.blocks,unitCharacters(project,unit));
    const chosen=input.selection;
    if(!chosen||!Number.isInteger(chosen.start)||!Number.isInteger(chosen.end)||chosen.start<0||chosen.end<=chosen.start||chosen.end>source.length||source.slice(chosen.start,chosen.end)!==chosen.text)throw new Error('选中文本与已保存正文不一致，请保存后重新选取');
    selection={start:chosen.start,end:chosen.end,text:chosen.text};
  }else if(input.selection!==undefined)throw new Error('本步骤不接受选中文本范围');
  let scopeId:string|undefined;
  if(['character','fact'].includes(input.operation)){
    scopeId=input.scopeId||unit.scopeId;
    if(![project.id,unit.scopeId,unit.seasonId].includes(scopeId))throw new Error('人物或设定只能写入当前故事可用的范围');
  }else if(input.operation==='story_outline'){
    scopeId=input.scopeId??unit.scopeId;
    if(scopeId===project.id||project.seasons?.some(season=>season.id===scopeId)||!project.units.some(item=>item.scopeId===scopeId))throw new Error('故事大纲必须绑定已有故事范围');
  }else if(input.scopeId!==undefined)throw new Error('本步骤不接受人物或设定范围');
  let seasonId:string|undefined;
  if(input.operation==='season_outline'){
    seasonId=input.seasonId;if(!project.seasons?.some(season=>season.id===seasonId))throw new Error('季大纲必须绑定已有季');
  }else if(input.seasonId!==undefined)throw new Error('本步骤不接受季大纲范围');
  let unitIndices:number[]|undefined;
  if(input.unitIndices!==undefined){
    if(!['unit_outlines','board_plan'].includes(input.operation)||!Array.isArray(input.unitIndices)||!input.unitIndices.length||input.unitIndices.length>30||new Set(input.unitIndices).size!==input.unitIndices.length||input.unitIndices.some(index=>!Number.isInteger(index)||index<1||index>project.profile.plannedUnits))throw new Error('本批范围需要1–30个有效单元序号');
    unitIndices=[...input.unitIndices];
  }
  if(input.authorRequest!==undefined&&(typeof input.authorRequest!=='string'||input.authorRequest.length>20000))throw new Error('作者要求需要有效文本');
  let blockIds: string[] | undefined;
  if (input.operation === 'rewrite') {
    const scene = unit.scenes.find(s => s.id === input.sceneId)!;
    if (!Array.isArray(input.blockIds) || !input.blockIds.length || new Set(input.blockIds).size !== input.blockIds.length) throw new Error('请选择连续的正文块');
    const indices = input.blockIds.map(id => scene.blocks.findIndex(b => b.id === id)).sort((a,b) => a-b);
    if (indices.some((index,i) => index < 0 || (i > 0 && index !== indices[i-1]+1))) throw new Error('局部改写只接受本场连续正文块');
    blockIds = indices.map(index => scene.blocks[index].id);
  } else if (input.blockIds?.length) throw new Error('本步骤不接受正文块范围');
  let reviewSceneIds:string[]|undefined;
  if(input.operation==='review'&&input.reviewSceneIds!==undefined){
    if(!Array.isArray(input.reviewSceneIds)||!input.reviewSceneIds.length||input.reviewSceneIds.length>30||new Set(input.reviewSceneIds).size!==input.reviewSceneIds.length||input.reviewSceneIds.some(id=>typeof id!=='string'||!unit.scenes.some(scene=>scene.id===id)))throw new Error('审阅范围需要 1–30 个本单元场景');
    reviewSceneIds=[...input.reviewSceneIds];
  }else if(input.reviewSceneIds!==undefined)throw new Error('本步骤不接受审阅场景范围');
  const unitBatch=input.operation==='unit_outlines'?{originalOrder:project.units.map(u=>u.id),sourceUnits:project.units.map(u=>({id:u.id,hash:hashValue(u)})),sourceHash:hashValue({profile:project.profile,brief:project.brief,characters:project.characters,facts:project.facts,storyOutlines:project.storyOutlines??[],seasons:project.seasons??[]}),targets:(unitIndices??Array.from({length:project.profile.plannedUnits},(_,i)=>i+1)).map(index=>{const existing=project.units[index-1],reserved=existing??newUnit(`第 ${index} 集`,project.profile.targetDurationMs,['anthology','procedural'].includes(project.profile.continuity)?undefined:project.id);return {index,id:reserved.id,existing:Boolean(existing),hash:existing?hashValue(existing):null,scopeId:reserved.scopeId,duration:reserved.targetDurationMs};})}:undefined;
  return { ...(unitBatch?{unitBatch}:{}),...(selection?{selection}:{}),...(scopeId?{scopeId}:{}),...(seasonId?{seasonId}:{}),...(unitIndices?{unitIndices}:{}),...(input.authorRequest?{authorRequest:input.authorRequest}:{}), ...(input.reviewSource?{reviewSource:{jobId:input.reviewSource.jobId,index:input.reviewSource.index}}:{}),...(blockIds ? {blockIds} : {}), ...(reviewSceneIds?{reviewSceneIds}:{}), ...(input.agentRunId?{agentRunId:input.agentRunId}:{}), id: newId('job'), projectId: project.id, baseRevision: project.revision, inputHash: unitContentHash(project, unit), unitId: unit.id, sceneId: input.sceneId,
    operation: input.operation, status: 'waiting', prompt: text(input.prompt, '提示词'), promptVersion: 'script-assist.v2', schemaVersion: 'script-result.v1', methods, inputSections:[...new Set(methods.flatMap(m=>methodUsage(m).inputs))], createdAt: Date.now(), updatedAt: Date.now() };
}
export function parseScriptResult(raw: string, project: ScriptProject, job: ScriptJob): ScriptResult {
  text(raw, '返回结果');
  let decoded: unknown;
  try { decoded = parseModelJson(raw); }
  catch {
    if(job.operation==='consult')return {summary:'对话回复',answer:raw};
    throw new Error('返回结果不是完整 JSON，请修正后重新提交；原稿未修改。');
  }
  // Chat may contain any text, including JSON examples. Only the old answer envelope is unpacked.
  if(job.operation==='consult'){
    const legacy=decoded as {summary?:unknown;answer?:unknown}|null;
    if(!legacy||Array.isArray(legacy)||typeof legacy!=='object'||typeof legacy.answer!=='string'||typeof legacy.summary!=='string'||Object.keys(legacy).some(key=>!['answer','summary'].includes(key)))return {summary:'对话回复',answer:raw};
  }
  const value = record(decoded);
  const allowed = ['summary', (job.operation === 'scene' || job.operation === 'rewrite') ? 'blocks' : job.operation==='text_rewrite'?'replacement':job.operation==='consult'?'answer':['concept','theme','character','fact'].includes(job.operation)?'suggestions' : ['outline','story_outline','season_outline','unit_outline'].includes(job.operation) ? 'outline' : job.operation === 'plan' ? 'scenePlans' : ['board_plan','unit_outlines'].includes(job.operation)?'units':['ending','scene_turn'].includes(job.operation)?'choices':'findings'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('结果包含本步骤未授权的字段');
  const result: ScriptResult = { summary: text(value.summary, '修改说明') };
  if (job.operation === 'scene' || job.operation === 'rewrite') {
    if (!Array.isArray(value.blocks) || !value.blocks.length || value.blocks.length > 1000) throw new Error('正文必须包含 1–1000 个块');
    result.blocks = value.blocks.map(item => {
      const b = record(item);
      if (Object.keys(b).some(k => !['type', 'text', 'speakerId', 'speakerName'].includes(k))) throw new Error('正文块只接受 type、text、speakerId、speakerName');
      const block = parseScriptBlock({ ...b, id: newId('block') });
      text(block.text, '正文块');
      if (block.speakerId && !unitCharacters(project,project.units.find(u=>u.id===job.unitId)!).some(c => c.id === block.speakerId)) throw new Error('模型引用了不存在或不属于本故事的人物');
      if (block.type === 'dialogue') {
        if(Boolean(block.speakerId)===Boolean(block.speakerName))throw new Error('对白必须提供已有人物 ID 或新人物姓名，且只能填写一种');
        if(block.speakerName){if(block.speakerName.trim().length>80)throw new Error('新人物姓名不能超过 80 字');block.speakerName=block.speakerName.trim();}
      } else if(block.speakerId||block.speakerName)throw new Error('只有对白块可以指定说话人物');
      return block;
    });
  } else if(job.operation==='text_rewrite')result.replacement=text(value.replacement,'替换文本');
  else if(job.operation==='consult')result.answer=text(value.answer,'答复');
  else if(['concept','theme','character','fact'].includes(job.operation)){
    if(!Array.isArray(value.suggestions)||!value.suggestions.length||value.suggestions.length>5)throw new Error('建议需要 1–5 个方案');
    result.suggestions=value.suggestions.map(item=>{
      const suggestion=record(item);
      const allowed=job.operation==='character'?['title','content','name','voice','desire','need']:['title','content'];
      if(Object.keys(suggestion).some(key=>!allowed.includes(key)))throw new Error('建议包含本步骤未授权字段');
      const parsed:DevelopmentSuggestion={title:text(suggestion.title,'方案标题'),content:text(suggestion.content,'方案内容')};
      if(job.operation==='character'){
        parsed.name=text(suggestion.name,'人物姓名').trim();
        if(parsed.name.length>80)throw new Error('人物姓名不能超过 80 字');
        for(const key of ['voice','desire','need'] as const){if(suggestion[key]!==undefined){if(typeof suggestion[key]!=='string'||suggestion[key].length>20000)throw new Error('人物资料需要有效文本');parsed[key]=suggestion[key];}}
      }
      return parsed;
    });
  }
  else if (['outline','story_outline','season_outline','unit_outline'].includes(job.operation)) result.outline = text(value.outline, '大纲');
  else if (job.operation === 'plan') {
    if (!Array.isArray(value.scenePlans) || !value.scenePlans.length || value.scenePlans.length > 30) throw new Error('分场提案需要 1–30 场');
    result.scenePlans = value.scenePlans.map((item) => {
      const plan = record(item);
      if (Object.keys(plan).some(key => !['title','purpose','location','timeOfDay'].includes(key))) throw new Error('分场只接受标题、发生什么、地点和时间');
      return { title: text(plan.title,'场景标题'), purpose: text(plan.purpose,'场景内容'), location: typeof plan.location === 'string' ? plan.location : '', timeOfDay: typeof plan.timeOfDay === 'string' ? plan.timeOfDay : '' };
    });
  }
  else if(job.operation==='unit_outlines')result.units=parseProposedUnitOutlines(value.units,project.profile.organization==='standalone'?1:project.profile.plannedUnits,job.unitIndices);
  else if(job.operation==='board_plan')result.units=parseProposedSceneUnits(value.units,project.profile.organization==='standalone'?1:project.profile.plannedUnits,job.unitIndices);
  else if(job.operation==='ending'||job.operation==='scene_turn'){
    if(!Array.isArray(value.choices))throw new Error('建议需要 choices 数组');
    result.choices=parseScriptChoices(JSON.stringify(value.choices));
    if(job.operation==='ending'&&result.choices.some(choice=>choice.extra))throw new Error('结尾建议不能修改场景规划');
  }
  else {
    if (!Array.isArray(value.findings) || value.findings.length > 200) throw new Error('诊断 findings 需要最多 200 项的数组');
    const unit = project.units.find(u => u.id === job.unitId)!;
    result.findings = value.findings.map(item => {
      const finding = record(item);
      if (typeof finding.sceneId !== 'string' || !unit.scenes.some(s => s.id === finding.sceneId)) throw new Error('诊断引用了不属于本单元的场景');
      if(job.reviewSceneIds&&!job.reviewSceneIds.includes(finding.sceneId))throw new Error('诊断引用了本次未读取正文的场景');
      return { sceneId: finding.sceneId, issue: text(finding.issue, '问题'), suggestion: text(finding.suggestion, '建议') };
    });
  }
  return result;
}
export function applyScriptJob(project: ScriptProject, job: ScriptJob, choiceIndex?:number, protectedSceneIds:string[]=[]): ScriptProject {
  assertJobBaseline(project, job);
  if (job.status !== 'ready' || !job.result || ['review','consult'].includes(job.operation)) throw new Error('此记录没有可采用的写作提案');
  if(protectedSceneIds.includes(job.sceneId)&&['scene','rewrite','text_rewrite','scene_turn'].includes(job.operation))throw new Error('此场已锁定');
  const next = structuredClone(project);
  if(['concept','theme','character','fact'].includes(job.operation)){
    const suggestions=job.result.suggestions;
    if(!suggestions||choiceIndex===undefined||!Number.isInteger(choiceIndex)||choiceIndex<0||choiceIndex>=suggestions.length)throw new Error('请选择有效的建议方案');
    const suggestion=suggestions[choiceIndex];
    if(job.operation==='concept'||job.operation==='theme')next.brief[job.operation]=suggestion.content;
    else if(job.operation==='fact')next.facts.push({id:newId('fact'),scopeId:job.scopeId!,text:suggestion.content,status:'draft'});
    else next.characters.push({id:newId('char'),scopeId:job.scopeId!,name:suggestion.name!,voice:suggestion.voice||'',desire:suggestion.desire||'',need:suggestion.need||'',arc:suggestion.content,contradiction:''});
  }
  else if(job.operation==='ending'||job.operation==='scene_turn'){
    const choices=job.result.choices;
    if(!choices||choiceIndex===undefined||!Number.isInteger(choiceIndex)||choiceIndex<0||choiceIndex>=choices.length)throw new Error('请选择有效的建议方案');
    const choice=choices[choiceIndex];
    const unit=next.units.find(u=>u.id===job.unitId)!;
    if(job.operation==='ending')unit.endingHook=choice.content;
    else{
      const scene=unit.scenes.find(s=>s.id===job.sceneId)!;
      scene.purpose=choice.extra?.purpose?.trim()||choice.content;
      if(choice.extra?.entryState?.trim())scene.entryState=choice.extra.entryState;
      if(choice.extra?.exitState?.trim())scene.exitState=choice.extra.exitState;
    }
  }
  else if (job.operation === 'outline') next.brief.outline = job.result.outline!;
  else if(job.operation==='story_outline'){
    if(!job.scopeId||job.scopeId===next.id||next.seasons?.some(season=>season.id===job.scopeId)||!next.units.some(unit=>unit.scopeId===job.scopeId))throw new Error('故事大纲范围已失效');
    const outline=next.storyOutlines?.find(item=>item.scopeId===job.scopeId);if(outline)outline.outline=job.result.outline!;else(next.storyOutlines??=[]).push({scopeId:job.scopeId,outline:job.result.outline!});
  }
  else if(job.operation==='season_outline'){const season=next.seasons?.find(item=>item.id===job.seasonId);if(!season)throw new Error('季大纲范围已失效');season.arc=job.result.outline!;}
  else if (job.operation === 'unit_outline') next.units.find(u=>u.id===job.unitId)!.summary=job.result.outline!;
  else if (job.operation === 'unit_outlines') {
    if(job.unitBatch){let length=next.units.length;const returned=[...job.result.units!].sort((a,b)=>a.unitIndex!-b.unitIndex!);for(const proposal of returned){const index=proposal.unitIndex!;if(index<=length)continue;if(index!==length+1)throw new Error(`第 ${index} 集候选已保留，待第 ${length+1} 集建立后可重新校验采用；不会创建空集`);const target=job.unitBatch.targets.find(t=>t.index===index)!;const unit=newUnit(proposal.title||`第 ${index} 集`,target.duration,target.scopeId);unit.id=target.id;unit.scenes[0].id=`scene_${hashValue([job.id,index,'initial']).slice(0,32)}`;unit.scenes[0].blocks[0].id=`block_${hashValue([job.id,index,'initial']).slice(0,32)}`;next.units.push(unit);length++;}}
    if(!applyUnitOutlines(next,job.result.units!,job.unitIndices))throw new Error('没有可填入的空白单元大纲；已有大纲保持原样'); }
  else if (job.operation === 'board_plan') applyWholeBoardPlan(next,job.result.units!,job.unitIndices);
  else if (job.operation === 'plan') {
    const unit = next.units.find(u => u.id === job.unitId)!;
    if (unit.scenes.length === 1 && !protectedSceneIds.includes(unit.scenes[0].id) && !sceneHasAuthorWork(unit.scenes[0],next)) unit.scenes = [];
    unit.scenes.push(...job.result.scenePlans!.map(plan => {
      const scene = newScene(plan.title);
      scene.purpose = plan.purpose;
      scene.location = plan.location;
      scene.timeOfDay = plan.timeOfDay;
      return scene;
    }));
  }
  else {
    const scene = next.units.find(u => u.id === job.unitId)!.scenes.find(s => s.id === job.sceneId);
    if (!scene) throw new Error('场景已删除');
    if(job.operation==='text_rewrite'){
      const source=blocksToScreenplayText(scene.blocks,unitCharacters(project,next.units.find(u=>u.id===job.unitId)!));
      const selection=job.selection;
      if(!selection||source.slice(selection.start,selection.end)!==selection.text)throw new Error('选中的原文已改变');
      scene.blocks=replaceScreenplaySelection(scene.blocks,unitCharacters(project,next.units.find(u=>u.id===job.unitId)!),selection,job.result.replacement!);
    } else if (job.operation === 'rewrite') {
      const ids = job.blockIds;
      if (!ids?.length) throw new Error('缺少局部改写范围');
      const start = scene.blocks.findIndex(b => b.id === ids[0]);
      if (start < 0 || ids.some((id,i) => scene.blocks[start+i]?.id !== id)) throw new Error('局部改写范围已改变');
      scene.blocks.splice(start, ids.length, ...structuredClone(job.result.blocks!));
    } else {scene.blocks = structuredClone(job.result.blocks!);scene.generation=generatedSceneState(scene,job.id,hashValue(scene.blocks),true);}
  }
  return parseScriptProject(next);
}
