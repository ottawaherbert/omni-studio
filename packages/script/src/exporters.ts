import type { ScriptProject, DeliveryUnit } from './schema';
import type { ScriptExportPackage, ScriptDeliveryBlock, ScriptProjectSummary } from '../../domain/src/scriptDelivery';
export type ScriptExportFormat = 'markdown' | 'fountain' | 'json';
export function scriptExportFilename(project: Pick<ScriptProject, 'title'>, format: ScriptExportFormat, localDraft = false) {
  const title = Array.from(project.title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim()).slice(0, 50).join('') || '未命名作品';
  return `${title}${localDraft ? '-未保存草稿' : ''}.${format === 'markdown' ? 'md' : format}`;
}
export const unitText=(project:ScriptProject,unit:DeliveryUnit,fountain=false)=>unit.scenes.map(scene=>{
  const heading=[scene.location,scene.timeOfDay].filter(Boolean).join(' / ')||scene.title;
  const renderedBlocks:string[]=[];
  const blocks=scene.blocks.filter(b=>b.text.trim());
  for(let i=0;i<blocks.length;i++){
    const b=blocks[i];
    if(b.type==='parenthetical'&&blocks[i+1]?.type==='dialogue'){
      const dialogue=blocks[++i];
      const speaker=project.characters.find(c=>c.id===dialogue.speakerId)?.name||dialogue.speakerName||'未指定人物';
      renderedBlocks.push(`${fountain?'@':''}${speaker}\n(${b.text.replace(/^[（(]|[）)]$/g,'')})\n${dialogue.text}`);
      continue;
    }
    let rendered=b.type==='note'?(fountain?`[[${b.text}]]`:`> ${b.text}`)
      :b.type==='dialogue'?`${fountain?'@':''}${project.characters.find(c=>c.id===b.speakerId)?.name||b.speakerName||'未指定人物'}\n${b.text}`
      :b.type==='parenthetical'?`(${b.text})`:b.type==='transition'&&fountain?`> ${b.text}`:b.text;
    renderedBlocks.push(rendered);
  }
  return `${fountain?'.':'## '}${heading}\n\n`+renderedBlocks.join('\n\n');
}).join('\n\n');
export const exportText=(project:ScriptProject,format:'markdown'|'fountain')=>`${format==='fountain'?'Title: ':'# '}${project.title}\n\n`+project.units.map(u=>`${format==='fountain'?'#':'##'} ${u.title}\n\n${unitText(project,u,format==='fountain')}`).join('\n\n');
export const projectSummary=(p:ScriptProject):ScriptProjectSummary=>({
  id:p.id,
  title:p.title,
  format:p.profile.organization==='standalone'?'single-work':'series-work',
  revision:p.revision,
  plannedUnitCount:p.profile.plannedUnits,
  writtenUnitCount:p.units.filter(u=>u.scenes.some(s=>s.blocks.some(b=>b.type!=='note'&&b.text.trim()))).length,
  updatedAt:p.updatedAt,
  targetDurationMinutes:p.profile.targetDurationMs/60000,
  workType:p.profile.workType,
  genre:(p.profile.genres&&p.profile.genres.length>0)?p.profile.genres.join(' · '):'剧情',
  concept:p.brief?.concept||p.brief?.theme||p.brief?.outline||'',
  unitCount:p.units.length,
  sceneCount:p.units.reduce((acc,u)=>acc+u.scenes.length,0),
  totalCharacters:p.units.reduce((acc,u)=>acc+u.scenes.reduce((sAcc,s)=>sAcc+s.blocks.reduce((bAcc,b)=>bAcc+(b.text||'').replace(/\s/g,'').length,0),0),0),
});
export function createScriptDelivery(project:ScriptProject):ScriptExportPackage {
  const unitScope=(scopeId:string)=>{
    if(scopeId===project.id)return {};
    const units=project.units.filter(unit=>unit.id===scopeId||unit.scopeId===scopeId||unit.seasonId===scopeId);
    return {sourceUnitIds:units.map(unit=>unit.id),...(units.length===1?{sourceUnitIndex:project.units.indexOf(units[0])+1}:{})};
  };
  return {schemaVersion:'script-delivery.v2',sourceRevision:project.revision,exportedAt:project.updatedAt,sourceWritingProjectId:project.id,title:project.title,
    format:project.profile.organization==='standalone'?'single-work':'series-work',workType:project.profile.workType,
    aspectRatio:project.profile.aspectRatio,language:project.profile.language,productionMethod:project.profile.productionMode,
    authorRequirements:project.brief.constraints.trim()?[project.brief.constraints.trim()]:[],
    styleGuide:{voice:'',dialogue:'',pacing:'',imagery:''},characters:project.characters.map(c=>({id:c.id,name:c.name,...unitScope(c.scopeId),bio:c.bio||'',psychologicalProfile:[c.desire,c.need,c.contradiction].filter(Boolean).join('\n'),actingStyle:c.voice})),
    lore:project.facts.filter(f=>f.status==='approved'&&f.text.trim()).map(f=>({id:f.id,term:f.text,definition:f.text,category:'coreRule',productionAssetKind:'none',...unitScope(f.scopeId)})),
    units:project.units.filter(u=>u.scenes.some(s=>s.blocks.some(b=>b.type!=='note'&&b.text.trim()))).map((u)=>({id:u.id,index:project.units.indexOf(u)+1,kind:project.profile.organization==='standalone'?'sequence':'episode',title:u.title,summary:u.summary,targetDurationMinutes:u.targetDurationMs/60000,
      continuityMode:project.profile.continuity==='anthology'?'standalone':'continue',prose:unitText(project,{...u,scenes:u.scenes.filter(s=>s.blocks.some(b=>b.type!=='note'&&b.text.trim()))}),scenes:u.scenes.filter(s=>s.blocks.some(b=>b.type!=='note'&&b.text.trim())).map((s,j)=>({id:s.id,index:u.scenes.indexOf(s)+1,title:s.title,synopsis:s.purpose,purpose:s.purpose,locationText:s.location,timeText:s.timeOfDay,continuityIn:s.entryState,continuityOut:s.exitState,targetDurationSeconds:s.targetDurationMs/1000,
        characters:[...new Set([...s.characterIds,...s.blocks.flatMap(b=>b.speakerId?[b.speakerId]:[])])].map(id=>project.characters.find(c=>c.id===id)?.name).filter((n):n is string=>Boolean(n)),
        blocks:s.blocks.filter(b=>b.type!=='note').flatMap((b,index,blocks):ScriptDeliveryBlock[]=>{
          if(b.type==='parenthetical'&&blocks[index+1]?.type==='dialogue')return [];
          if(b.type==='dialogue'){
            const parenthetical=blocks[index-1]?.type==='parenthetical'?blocks[index-1]:undefined;
            return [{id:`${b.id}_speaker`,type:'character',content:project.characters.find(c=>c.id===b.speakerId)?.name||b.speakerName||'未指定人物'},
              ...(parenthetical?[{id:parenthetical.id,type:'parenthetical' as const,content:parenthetical.text}]:[]),{id:b.id,type:'dialogue',content:b.text}];
          }
          return [{id:b.id,type:b.type as ScriptDeliveryBlock['type'],content:b.text}];
        })}))}))};
}
