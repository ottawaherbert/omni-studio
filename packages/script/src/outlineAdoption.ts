import {parseScriptProject,type ScriptProject} from './schema';
import {outlineText,setOutlineText,type OutlineOwner} from './outlineGuides';

/** Adopt only original outlines; dependent relations remain in the workspace.
 * This projection never invents relation offsets for a different text version. */
export function outlineOnlyAdoption(author:ScriptProject,merged:ScriptProject):ScriptProject{
  const next=structuredClone(author),owners:OutlineOwner[]=[{kind:'project',id:author.id},...author.units.map(unit=>({kind:'unit' as const,id:unit.id})),...(author.seasons??[]).map(season=>({kind:'season' as const,id:season.id})),...[...new Set(author.units.map(unit=>unit.scopeId))].filter(id=>id!==author.id&&!author.seasons?.some(s=>s.id===id)).map(id=>({kind:'story' as const,id}))];
  for(const owner of owners){const old=outlineText(author,owner),text=outlineText(merged,owner);if(old!==text)setOutlineText(next,owner,text);}
  return parseScriptProject(next);
}
