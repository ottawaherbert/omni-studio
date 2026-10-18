import { parseModelJson } from '../../model-output/src';
import { BLUEPRINT_GUIDANCE } from './blueprint';
import { parseProjectProfile } from './schema';
import type {MethodBinding, ProjectProfile} from './schema';
import {createScriptCreationProfile, createScriptProjectFromMaterial, SCRIPT_CREATION_PRESETS, type ScriptCreationFormat, type InitialBriefPayload} from './creation';

export interface ChatOption {tag:string;text:string}
export interface ChatMessage {
  role:'user'|'ai';text:string;options?:ChatOption[];isError?:boolean;retryKind?:IdeationMode|'blueprint';blueprintWorkspaceId?:string;replyKind?:'ASK'|'REPLY'|'READY'|'BLUEPRINT'|'START';
  prompt?:string;methods?:MethodBinding[];
  provenance?:{source:string;provider:string;modelId:string};
}
/** Count completed discussion replies only; a delivered summary resets the nudge. */
export function discussionTurnsSinceMilestone(turns:Array<{input:{intent?:string};response?:{replyKind?:string}|null}>):number {
  let count=0;
  for(const turn of turns){
    if(!turn.response)continue;
    if(['READY','BLUEPRINT','START'].includes(turn.response.replyKind||'')){count=0;continue;}
    if(turn.input.intent==='AUTO')count++;
  }
  return count;
}
export type IdeationMode='chat'|'agent'|'fast'|'finalize';
const contracts:Record<IdeationMode,string>={
  chat:'回应作者这次实际提出的内容，必要时提出一个简短问题，并给出 2–3 个有具体差异、可点选的想法。作者可以选一个、修改或另提想法。已明确的事项不重复追问，不按固定轮数结束或自动创建作品；只要求分析或改一句时，直接完成，不必提供选项。返回 JSON {"question":"你的回应或问题","options":[{"tag":"简短方向名","text":"具体想法"}]}，没有选项时 options 为 []。',
  agent:'根据作者目标和已有讨论完成一次有限的作品蓝图整理，包括故事构想、主要人物和必要设定，然后停止。保留开放问题，不声称已完成正文、多任务并发或后台持续创作。',
  fast:'根据作者当前想法直接给出简洁的前期设定，保留尚未确定的内容。',
  finalize:'根据整段对话整理作品蓝图。分清作者选择、作者原文与 AI 尚未被选择的建议；只沿用作者确认的方向，不混入被否定的方案。',
};
const draftContract=`返回 JSON：{"title":"作品名","format":"custom","workType":"原创剧本","organization":"standalone","plannedUnits":1,"targetMinutes":30,"continuity":"serialized","genres":["剧情"],"language":"zh-CN","productionMode":"live-action","aspectRatio":"16:9","concept":"故事构想","theme":"主题与核心问题","audienceExperience":"风格与观众感受","constraints":"作者要求与暂定规格","outline":"","characters":[{"name":"姓名","bio":"人物简介","voice":"说话方式","desire":"目标","need":"内在需要","contradiction":"矛盾","arc":"变化方向"}],"facts":[{"text":"必要设定","status":"draft"}]}。
格式可选 short-film / feature-film / tv-series / procedural / anthology / micro-drama / custom；从作者要求获取，不把示例数字当成作者要求。作者未指定时采用 custom、原创剧本、单部、30 分钟的可修改默认配置，不在故事里承诺时长达标。不得把聊天输入或引用旧稿改写后冒充原件；这里生成的是故事资料，不是导入正文。`;

export function buildIdeationPrompt(mode:IdeationMode,messages:ChatMessage[],methods:MethodBinding[],template:string):string {
  if(!template.includes('{{conversation}}')||!template.includes('{{taskContract}}'))throw new Error('创作对话模板需要保留 conversation 与 taskContract 占位符');
  const values:Record<string,string>={
    taskContract:contracts[mode]+(mode==='chat'?'':`\n${BLUEPRINT_GUIDANCE}\n${draftContract}`),
    conversation:JSON.stringify(messages.filter(m=>!m.isError).map(({role,text,options})=>({role,text,...(options?.length?{options}: {})})),null,2),
    methodInstructions:methods.length?methods.map(m=>`Skill：${m.title}\n版本：${m.version}\n${m.content}\n本次配置：${JSON.stringify(m.usage||{operations:['concept','outline','consult'],inputs:[],note:''})}`).join('\n\n'):'本次未选择 Skill。',
  };
  const prompt=template.replace(/\{\{(\w+)\}\}/g,(_,key)=>values[key]||'');
  if(prompt.length>180000)throw new Error('本次对话及 Skill 超过单次请求长度，请减少所选 Skill 或开始新一轮构思；原对话仍保留。');
  return prompt;
}
function jsonObject(raw:string):Record<string,unknown> {
  const parsed=parseModelJson(raw);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('AI 返回需要 JSON 对象');
  return parsed as Record<string,unknown>;
}
export function parseIdeationReply(raw:string):{text:string;options:ChatOption[]} {
  if(!raw.trim())throw new Error('AI 返回为空，请重试');
  try {
    const value=jsonObject(raw);
    if(typeof value.question!=='string'||!value.question.trim())return {text:raw,options:[]};
    const options=Array.isArray(value.options)?value.options.flatMap(option=>{
      if(!option||typeof option!=='object'||typeof option.text!=='string'||!option.text.trim())return [];
      return [{tag:typeof option.tag==='string'?option.tag:'想法',text:option.text}];
    }):[];
    return {text:value.question,options};
  } catch {return {text:raw,options:[]};}
}
export function parseIdeationDraft(raw:string,methods:MethodBinding[]):{title:string;profile:ProjectProfile;initialBrief:InitialBriefPayload} {
  let value:Record<string,unknown>;
  try {value=jsonObject(raw);}catch{throw new Error('作品蓝图格式不完整，未创建作品；可以保留对话后重试。');}
  if(typeof value.concept!=='string'||typeof value.outline!=='string'||(!value.concept.trim()&&!value.outline.trim()))throw new Error('作品蓝图缺少故事内容，未创建空作品');
  const format=typeof value.format==='string'&&Object.hasOwn(SCRIPT_CREATION_PRESETS,value.format)?value.format as ScriptCreationFormat:'custom';
  const preset=SCRIPT_CREATION_PRESETS[format];
  // Presets only supply missing values; the generated blueprint's explicit form takes priority.
  const profile=createScriptCreationProfile('custom',value.plannedUnits===undefined?preset.plannedUnits:Number(value.plannedUnits),value.targetMinutes===undefined?preset.targetMinutes:Number(value.targetMinutes),Array.isArray(value.genres)?value.genres as string[]:['剧情'],value.continuity===undefined?preset.continuity:value.continuity as ProjectProfile['continuity'],{workType:typeof value.workType==='string'&&value.workType.trim()?value.workType:format==='custom'?'原创剧本':preset.label,organization:value.organization===undefined?preset.organization:value.organization as ProjectProfile['organization']});
  for(const key of ['language','productionMode','aspectRatio'] as const)if(value[key]!==undefined)(profile as any)[key]=value[key];
  parseProjectProfile(profile);
  const initialBrief:InitialBriefPayload={concept:value.concept,theme:typeof value.theme==='string'?value.theme:'',audienceExperience:typeof value.audienceExperience==='string'?value.audienceExperience:'',constraints:typeof value.constraints==='string'?value.constraints:'',outline:value.outline,methods:structuredClone(methods)};
  if(value.characters!==undefined)initialBrief.characters=value.characters as InitialBriefPayload['characters'];
  if(value.facts!==undefined)initialBrief.facts=value.facts as InitialBriefPayload['facts'];
  const title=typeof value.title==='string'&&value.title.trim()?value.title.trim():'未命名作品';
  // Use the same validation as the atomic repository create before navigating away from the conversation.
  createScriptProjectFromMaterial(title,profile,initialBrief);
  return {title,profile,initialBrief};
}
