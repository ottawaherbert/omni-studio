import type { Character, ProjectProfile, ScriptFact, ScriptProject } from './schema';
import { visibleInUnit } from './continuity';
import { planningContext, scopedBrief, type PlanningContextOptions } from './outlines';

export const CHARACTER_TEXT_FIELDS = ['name', 'bio', 'desire', 'need', 'contradiction', 'arc', 'voice'] as const;
export const BLUEPRINT_BRIEF_FIELDS = ['concept', 'theme', 'audienceExperience', 'constraints'] as const;
export type BlueprintBriefField = typeof BLUEPRINT_BRIEF_FIELDS[number];

export const BLUEPRINT_GUIDANCE = `一次整理精简、可审阅的作品蓝图，人工主要审阅和修改，不留下一份待作者逐项填写的问卷。
根据已选方向一并起草核心构想、主题、风格与观众感受、作者要求，以及主要人物的简介、目标、内在需要、矛盾、变化方向和说话方式。非必填项有创作价值时也先给简短建议；不适用可留空，不为凑齐字段捏造创伤、强迫成长或增加禁忌。
默认 3–5 位主要人物、6–10 条必要设定，上限 6 位人物、12 条设定。简单故事可以更少，不扩写配角大全和世界百科。构想约 150–300 字；主题、风格各 1–3 句；人物简介约 60–120 字，其余人物维度各一句；每条设定 1–2 句。整体优先控制在约 2000–3000 中文字，信息充分即停。
作者明确说过或选过的设定才标 approved；AI 补充、暂用假设和开放问题标 draft。人物及其他文本中的推测用【建议】或【暂定】简短标明，不将建议说成作者决定。作者要求只记录已表达的要求，不自行编造限制。尚无要求可留空；保留最多三个会影响后续的关键待定问题，写在相应内容中。
作品形式、题材、集数、时长、语言与制作方式尽量从讨论整理，未明确时给合理可修改的暂定方案，并在 constraints 说明暂定规格。不得把系统默认值说成作者选择。不生成故事大纲、分场或正文，不自动扩展到后续阶段。`;

const text = (maxLength:number) => ({type:'string',maxLength});
const object = (properties:Record<string,unknown>) => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const blueprintSchema = object({
  concept:text(1200), theme:text(500), audienceExperience:text(500), constraints:text(800),
  characters:{type:'array',maxItems:6,items:object(Object.fromEntries(CHARACTER_TEXT_FIELDS.map(key=>[key,text(key==='bio'?400:200)])))},
  facts:{type:'array',maxItems:12,items:object({text:text(500),status:{type:'string',enum:['draft','approved']}})},
  profile:object({workType:text(100),organization:{type:'string',enum:['standalone','episodic']},
    continuity:{type:'string',enum:['serialized','procedural','anthology','mixed']},genres:{type:'array',maxItems:4,items:text(40)},
    language:text(40),productionMode:{type:'string',enum:['live-action','AI-video','animation','hybrid']},aspectRatio:{type:'string',enum:['16:9','9:16','1:1']}}),
});
export type BlueprintDraft = Pick<ScriptProject['brief'],'concept'|'theme'> & Partial<Pick<ScriptProject['brief'],'audienceExperience'|'constraints'>> & {
  characters:Array<Pick<Character,'name'> & Partial<Omit<Character,'id'|'name'|'scopeId'>>>;
  facts:Array<string|Pick<ScriptFact,'text'|'status'>>;
  profile?:Pick<ProjectProfile,'workType'|'organization'|'continuity'|'genres'|'language'|'productionMode'|'aspectRatio'>;
};
/** Old frozen replies remain readable; new requests ask for the complete bounded form. */
export function parseBlueprint(value:unknown):BlueprintDraft {
  const b=value as BlueprintDraft;
  const legacy=Boolean(b&&typeof b==='object'&&Object.keys(b).sort().join()==='characters,concept,facts,theme');
  const validText=(value:unknown,max:number)=>typeof value==='string'&&value.length<=(legacy?200000:max);
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(key=>!Object.keys(blueprintSchema.properties).includes(key))||
    !validText(b.concept,1200)||!b.concept.trim()||!validText(b.theme,500)||
    b.audienceExperience!==undefined&&!validText(b.audienceExperience,500)||b.constraints!==undefined&&!validText(b.constraints,800)||
    !Array.isArray(b.characters)||b.characters.length>(legacy?1000:6)||!Array.isArray(b.facts)||b.facts.length>(legacy?1000:12))
    throw new Error('蓝图内容不完整或超出精简蓝图的篇幅，请保留核心内容后重试。');
  for(const character of b.characters)if(!character||typeof character!=='object'||Array.isArray(character)||
    !validText(character.name,200)||!character.name.trim()||Object.keys(character).some(key=>!CHARACTER_TEXT_FIELDS.includes(key as any))||
    CHARACTER_TEXT_FIELDS.some(key=>character[key]!==undefined&&!validText(character[key],key==='bio'?400:200)))throw new Error('蓝图人物资料无效');
  for(const fact of b.facts)if(typeof fact==='string'?!validText(fact,500):!fact||typeof fact!=='object'||Array.isArray(fact)||
    Object.keys(fact).sort().join()!=='status,text'||!validText(fact.text,500)||!['draft','approved'].includes(fact.status))throw new Error('蓝图设定资料无效');
  if(b.profile&&(typeof b.profile!=='object'||Array.isArray(b.profile)||Object.keys(b.profile).sort().join()!==Object.keys((blueprintSchema.properties.profile as any).properties).sort().join()))throw new Error('蓝图规格资料无效');
  return b;
}

/** A common, scoped source of writing facts; raw scenes keep their separate read boundary. */
export function blueprintContext(project:ScriptProject,unitIds:string[],options:PlanningContextOptions={}) {
  const units=project.units.filter(unit=>unitIds.includes(unit.id));
  const visible=(scopeId:string)=>scopeId===project.id||units.some(unit=>visibleInUnit(scopeId,project,unit));
  return {title:project.title,profile:(({organization,continuity,workType,genres,language,plannedUnits,targetDurationMs,toleranceMs,includeCredits,aspectRatio,productionMode})=>({organization,continuity,workType,genres,language,plannedUnits,targetDurationMs,toleranceMs,includeCredits,aspectRatio,productionMode}))(project.profile),brief:scopedBrief(project,unitIds,options),planning:planningContext(project,unitIds,options),
    characters:project.characters.filter(item=>visible(item.scopeId)).map(({id,scopeId,name,bio,desire,need,contradiction,arc,voice})=>({id,scopeId,name,bio,desire,need,contradiction,arc,voice})),facts:project.facts.filter(item=>visible(item.scopeId)).map(({id,scopeId,text,status})=>({id,scopeId,text,status})),
    meaning:'AUTHOR_BLUEPRINT_NOT_MANUSCRIPT_EVENTS',
    guidance:'approved 是作者已选定的创作依据；draft 是待确认的建议或假设。规划事件不等于正文已经发生。风格和作者要求持续适用；资料可留空，不要求作者维护上下文。'};
}
