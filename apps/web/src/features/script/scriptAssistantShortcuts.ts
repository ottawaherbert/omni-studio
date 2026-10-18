import type { ScriptOperation, ScriptProject } from '../../../../../packages/script/src/schema';
import type { ScriptStage } from '../../../../../packages/script/src/agentStages';
import { visibleInUnit } from '../../../../../packages/script/src/continuity';

export type AssistantRequest = {
  id: number; text: string; label: string; unitId: string; sceneId?: string; discussionDraft?:ScriptProject;
  stage: ScriptStage; entity?:{kind:'character'|'fact';id:string}; selection?: {start:number;end:number;text:string};
  draftOperation?:'outline_development'|'scene_order'|'scene_plan'|'replace_selection'; operation?: ScriptOperation; scopeId?:string; seasonId?:string; nodeId?:string;unitIndices?:number[];analysis?:boolean;outlineStructure?:boolean;outlineSceneOrder?:boolean;outlineRange?:{start:number;end:number;text:string};outlineBeatIds?:string[];
};

/** The blueprint lists all entities; an entity shortcut must use a unit that can read it. */
export function resolveAssistantUnit(project:ScriptProject, preferredUnitId?:string, entity?:AssistantRequest['entity'],scopeId?:string) {
  const scoped=scopeId&&scopeId!==project.id&&!project.seasons?.some(season=>season.id===scopeId)?project.units.find(unit=>unit.scopeId===scopeId):undefined;
  const preferred=scoped||project.units.find(unit=>unit.id===preferredUnitId)||project.units[0];
  if(!entity)return preferred;
  const target=(entity.kind==='character'?project.characters:project.facts).find(item=>item.id===entity.id);
  if(!target)return undefined;
  return preferred&&visibleInUnit(target.scopeId,project,preferred)?preferred:
    project.units.find(unit=>visibleInUnit(target.scopeId,project,unit));
}

export const assistantShortcuts: Partial<Record<ScriptOperation, {label:string;text:string}>> = {
  concept: {label:'故事前提',text:'请基于已有资料，生成一版故事前提候选供我采用，保留已确定的方向，待定内容不要写成事实。'},
  theme: {label:'主题与核心问题',text:'请基于现有故事，整理一版主题与核心问题候选，不强加道德结论，供我审阅采用。'},
  character: {label:'新增人物',text:'请根据现有故事需要，提出一个新人物方案，生成可采用的人物资料。'},
  fact: {label:'新增设定',text:'请根据现有故事需要，提出一条具体设定，生成可采用的设定资料。'},
  outline: {label:'故事总纲',text:'请根据已有蓝图生成故事总纲候选，包含主要事件、人物选择、因果与结局方向。只整理总纲，完成后停止。'},
  unit_outline: {label:'本集大纲',text:'请生成当前集的大纲候选，明确主要事件、人物选择与本集落点，不改其他集或全剧总纲。'},
  plan: {label:'本集分场',text:'请根据当前集大纲生成分场候选，说明每场的地点、人物、事件与变化，只处理当前集。'},
  scene: {label:'本场正文',text:'请根据当前场规划生成本场剧本正文候选，包含动作、对白与必要场景描写。'},
  ending: {label:'本集结尾',text:'请根据本集已有故事提出可采用的结尾安排，尊重作者节奏，不要求悬念或反转。'},
  scene_turn: {label:'本场变化',text:'请根据本场已有内容提出可采用的行动、关系、信息或气氛推进，不强制反转。'},
  consult: {label:'故事讨论',text:''},
  unit_outlines: {label:'分集安排',text:'请根据故事总纲规划分集安排，保持人物选择与事件因果连贯。'},
  board_plan: {label:'故事结构',text:'请分析当前故事结构，提出可采用的结构调整方案。'},
  text_rewrite: {label:'选中文字',text:'请修改选中的文字，保留范围之外的原文。'},
};
