import { parseProjectProfile, parseScriptProject, type ScriptProject, type ProjectProfile, type MethodBinding } from './schema';
import {createScriptProject,newId} from './project';
import {screenplayTextToBlocks} from './fountainAdapter';

/** These numbers only prefill editable creation fields; they are not writing rules. */
export const SCRIPT_CREATION_PRESETS={
  'short-film':{label:'电影短片',organization:'standalone',continuity:'serialized',plannedUnits:1,targetMinutes:5},
  'feature-film':{label:'电影长片',organization:'standalone',continuity:'serialized',plannedUnits:1,targetMinutes:90},
  'tv-series':{label:'连续剧集',organization:'episodic',continuity:'serialized',plannedUnits:8,targetMinutes:45},
  procedural:{label:'单元剧',organization:'episodic',continuity:'procedural',plannedUnits:8,targetMinutes:45},
  anthology:{label:'独立故事合集',organization:'episodic',continuity:'anthology',plannedUnits:8,targetMinutes:45},
  'micro-drama':{label:'微短剧',organization:'episodic',continuity:'serialized',plannedUnits:12,targetMinutes:2},
  custom:{label:'其他 / 自定义',organization:'standalone',continuity:'serialized',plannedUnits:1,targetMinutes:30},
} as const;
export type ScriptCreationFormat=keyof typeof SCRIPT_CREATION_PRESETS;
export const SCRIPT_CONTINUITY_LABELS:Record<ProjectProfile['continuity'],string>={
  serialized:'连续讲一个故事',procedural:'常驻人物，各集独立事件',anthology:'各集独立故事',mixed:'混合，由作者决定',
};

export function createScriptCreationProfile(format:ScriptCreationFormat,plannedUnits:number,targetMinutes:number,genres:string[]=['剧情'],continuity?:ProjectProfile['continuity'],custom?:{workType:string;organization:ProjectProfile['organization']}):ProjectProfile{
  const preset=SCRIPT_CREATION_PRESETS[format];
  if(!preset)throw new Error('请选择有效的作品形态');
  if(format==='custom'&&!custom?.workType.trim())throw new Error('请填写自定义作品类型');
  if(!Number.isInteger(plannedUnits)||plannedUnits<1||plannedUnits>1000)throw new Error('计划集数需要在 1–1000 之间');
  if(!Number.isFinite(targetMinutes)||targetMinutes<0.5||targetMinutes>600)throw new Error('目标时长需要在 0.5–600 分钟之间');
  const organization=format==='custom'&&custom?custom.organization:preset.organization;
  const profile:ProjectProfile={
    organization,continuity:continuity||preset.continuity,
    workType:format==='custom'?custom!.workType.trim():preset.label,genres,language:'zh-CN',
    plannedUnits:organization==='standalone'?1:plannedUnits,
    targetDurationMs:Math.round(targetMinutes*60_000),toleranceMs:0,includeCredits:true,
    aspectRatio:'16:9',productionMode:'live-action',
  };
  return parseProjectProfile(profile);
}

export interface InitialBriefPayload {
  concept: string;
  theme: string;
  audienceExperience?: string;
  constraints?: string;
  outline: string;
  sceneText?: string;
  originalMaterial?: ScriptProject['originalMaterial'];
  characters?: Array<{
    name: string;
    bio?: string;
    contradiction?: string;
    arc?: string;
    voice?: string;
    desire?: string;
    need?: string;
  }>;
  facts?: Array<string|{text:string;status:'draft'|'approved'}>;
  methods?: MethodBinding[];
}

/** Validate and save the initial author material together with the project, never as a second request. */
export function createScriptProjectFromMaterial(title:string,profile:ProjectProfile,initial?:InitialBriefPayload):ScriptProject{
  const project=createScriptProject(title,profile);
  if(initial===undefined)return project;
  if(!initial||typeof initial!=='object'||Array.isArray(initial))throw new Error('初始资料需要对象');
  if(initial.originalMaterial!==undefined)project.originalMaterial=structuredClone(initial.originalMaterial);
  else if(initial.sceneText!==undefined)project.originalMaterial={kind:'scene',text:initial.sceneText};
  for(const key of ['concept','theme','outline','audienceExperience','constraints'] as const){
    if(initial[key]!==undefined)project.brief[key]=initial[key];
  }
  if(initial.sceneText!==undefined){
    if(typeof initial.sceneText!=='string'||initial.sceneText.length>200000)throw new Error('初始正文需要有效文本');
    project.units[0].scenes[0].blocks=screenplayTextToBlocks(initial.sceneText).blocks;
  }
  // A procedural series starts with recurring canon; episode guests can be added in their own story scope later.
  const scopeId=project.profile.continuity==='procedural'?project.id:project.units[0].scopeId;
  if(initial.characters!==undefined){
    if(!Array.isArray(initial.characters)||initial.characters.length>1000)throw new Error('初始人物列表无效');
    project.characters=initial.characters.map(character=>({id:newId('char'),scopeId,name:character.name,desire:character.desire||'',need:character.need||'',voice:character.voice||'',bio:character.bio||'',arc:character.arc||'',contradiction:character.contradiction||''}));
  }
  if(initial.facts!==undefined){
    if(!Array.isArray(initial.facts)||initial.facts.length>1000)throw new Error('初始设定列表无效');
    project.facts=initial.facts.map(fact=>({id:newId('fact'),text:typeof fact==='string'?fact:fact.text,scopeId,status:typeof fact==='string'?'draft':fact.status}));
  }
  if(initial.methods!==undefined)project.methods=structuredClone(initial.methods);
  return parseScriptProject(project);
}
