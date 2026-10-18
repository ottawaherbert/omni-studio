import type {DeliveryUnit,ScriptOperation,ScriptProject} from '../../../../../packages/script/src/schema';
import type {ScriptStage} from '../../../../../packages/script/src/agentStages';
import type {AssistantRequest} from './scriptAssistantShortcuts';
import type {ScriptJob} from '../../../../../packages/script/src/proposals';

const stageWords:Record<ScriptStage,string>={BLUEPRINT:'全案蓝图|作品蓝图|蓝图|构想',OUTLINE:'故事总纲|全剧总纲|总纲|故事大纲|大纲|梗概',SCENES:'分场规划|场景规划|分场',BODY:'剧本初稿|剧本正文|正文|初稿',BEATS:'故事节拍'};
const stageMentions=(text:string)=>Object.entries(stageWords).flatMap(([stage,words])=>[...text.matchAll(new RegExp(words,'g'))].map(match=>({stage:stage as ScriptStage,index:match.index!,end:match.index!+match[0].length}))).sort((a,b)=>a.index-b.index);
/** A source stage ("根据大纲") is not the requested deliverable. Bound page
 * requests retain their stage unless the author explicitly changes the stop. */
function requestedStage(text:string,bound:ScriptStage|undefined,fallback:ScriptStage):ScriptStage {
  const mentions=stageMentions(text);
  const explicit=mentions.filter((item,index)=>{
    const before=text.slice(Math.max(0,item.index-18),item.index);
    const after=text.slice(item.end,mentions[index+1]?.index??text.length);
    return /(?:停在|停到|停止在|截至|写到|做到|推进到|只(?:做|写|完成|生成|规划|整理))\s*(?:(?:第\s*[\d一二三四五六七八九十]+\s*集|本集|当前集)(?:的)?)?\s*$/.test(before)||/^\s*(?:阶段)?\s*(?:(?:完成|写完|规划完|整理完)?\s*(?:后|了)?\s*(?:就|即|便|再)?\s*(?:停(?:止)?|为止)|[，,。；;]\s*(?:完成后|然后|就)\s*停(?:止)?)/.test(after);
  }).at(-1);
  if(explicit)return explicit.stage;
  if(bound)return bound;
  const deliverables=mentions.filter(item=>{
    const clause=text.slice(0,item.index).split(/[，,。；;！？!?]/).at(-1)||'';
    return /(?:生成|起草|撰写|写完|完成|整理|规划|补齐|展开|推进|改写|续写|写)(?:[^，,。；;！？!?]{0,24})$/.test(clause);
  });
  return deliverables.at(-1)?.stage??mentions.at(-1)?.stage??fallback;
}

/** These explicit handoffs already have a bounded candidate command. Keeping
 * that command avoids silently converting a text range or batch into a Goal. */
export function delegationCandidateKind(context:AssistantRequest|null):'selection'|'batch'|null {
  if(context?.selection)return 'selection';
  if(context?.operation&&['unit_outlines','board_plan'].includes(context.operation))return 'batch';
  return null;
}

/** The legacy job protocol uses a unit ID for scene-independent planning.
 * An empty unit is a valid target; it does not need an invented scene. */
export function legacyTaskAnchor(unit:DeliveryUnit,operation:ScriptOperation,sceneId?:string):string {
  if(sceneId){if(!unit.scenes.some(scene=>scene.id===sceneId))throw new Error('原场景已删除，请重新选择任务范围。');return sceneId;}
  if(['board_plan','ending','outline','story_outline','season_outline','unit_outline','unit_outlines','concept','theme','character','fact','consult'].includes(operation))return unit.id;
  throw new Error('这项任务需要已有场景，请先规划分场或选择有效场景。');
}

export function unreturnedPlanningUnits(job:Pick<ScriptJob,'operation'|'unitIndices'|'result'>):number[] {
  if(!['unit_outlines','board_plan'].includes(job.operation)||!job.result?.units)return [];
  const returned=new Set(job.result.units.map(unit=>unit.unitIndex));
  return (job.unitIndices||[]).filter(index=>!returned.has(index));
}

export function inferDelegation(project:ScriptProject,text:string,context:AssistantRequest|null,currentUnitId:string,currentStage:ScriptStage){
  const numerals:Record<string,number>={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  const match=text.match(/第\s*(\d+|[一二三四五六七八九十])\s*集/);
  const explicit=match?project.units[(Number(match[1])||numerals[match[1]])-1]:undefined;
  const unitId=explicit?.id||context?.unitId||currentUnitId;
  const stopAfter=requestedStage(text,context&&context.id!==0?context.stage:undefined,context?.stage||currentStage);
  const changedUnit=Boolean(explicit&&explicit.id!==context?.unitId);
  return {unitId,stopAfter,nodeId:changedUnit?undefined:context?.nodeId,scopeId:changedUnit?undefined:context?.scopeId,seasonId:changedUnit?undefined:context?.seasonId,
    ...(!changedUnit&&context?.operation==='outline'&&context.scopeId===project.id?{projectOutlineOnly:true}:{})};
}
