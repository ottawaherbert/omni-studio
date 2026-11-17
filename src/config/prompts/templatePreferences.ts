import type {PromptTemplate} from './types';

export const retiredAssistantPrompts=new Set(['scriptChat','scriptIdeation','scriptResume']);
export const templateFingerprint=(text:string)=>{
  let value=2166136261;
  for(const c of text)value=Math.imul(value^c.charCodeAt(0),16777619);
  return String(value>>>0);
};
export const templateBaselines=(templates:Record<string,PromptTemplate>)=>Object.fromEntries(Object.entries(templates).map(([id,t])=>[id,templateFingerprint(t.template)]));
/** Known shipped defaults follow upgrades. Unidentified legacy edits remain intact. */
export function templateOverrides(defaults:Record<string,PromptTemplate>, saved:Record<string,PromptTemplate>={}, baseline:Record<string,string>={}) {
 return Object.fromEntries(Object.entries(saved).filter(([id,t])=>t&&typeof t.template==='string'&&!retiredAssistantPrompts.has(id)&&t.template!==defaults[id]?.template&&(!defaults[id]||templateFingerprint(t.template)!==baseline[id])));
}
