import {hashValue} from '../../agent-core/src/identity';
import {newId,newUnit} from './project';
import {parseScriptProject,type ScriptProject} from './schema';
import {getOutlineGuide,outlineGuideId,outlineText,setOutlineText,storyOutlineOwner,type OutlineOwner} from './outlineGuides';
export type EpisodeChoice={kind:'independent'|'continue'|'season_independent'|'season_continue';sourceUnitId:string;title:string;targetDurationMs?:number;seasonTitle?:string};
export type EpisodePreview={baseHash:string;project:ScriptProject;unitId:string;conversion:null|{source:OutlineOwner;target:OutlineOwner;original:string;previousSummary:string;replacesExistingRelations:boolean}};
/** Explicit preview only. Opening an old work never migrates its outline. */
export function previewNextEpisode(project:ScriptProject,choice:EpisodeChoice):EpisodePreview{
  if(project.profile.organization!=='episodic'||project.units.length>=1000)throw new Error('当前作品不能新增分集');
  const p=structuredClone(project),source=p.units.find(unit=>unit.id===choice.sourceUnitId);if(!source)throw new Error('延续来源不存在');
  const continuation=choice.kind==='continue'||choice.kind==='season_continue',newSeason=choice.kind.startsWith('season_');
  if(choice.targetDurationMs!==undefined&&(!Number.isSafeInteger(choice.targetDurationMs)||choice.targetDurationMs<1000||choice.targetDurationMs>86400000))throw new Error('单集时长无效');
  const unit=newUnit(choice.title.trim()||`第 ${p.units.length+1} 集`,choice.targetDurationMs??p.profile.targetDurationMs,continuation?source.scopeId:undefined);
  let conversion:EpisodePreview['conversion']=null;
  if(continuation&&!p.seasons?.some(season=>season.id===source.scopeId)&&source.scopeId!==p.id&&p.units.filter(u=>u.scopeId===source.scopeId).length===1){
    const owner=storyOutlineOwner(p,source),original=outlineText(p,owner),target:OutlineOwner={kind:'unit',id:source.id};
    if(original.trim()){
      const guide=getOutlineGuide(p,owner),oldTarget=getOutlineGuide(p,target);
      if(guide?.nodeLinks.some(link=>link.unitId!==source.id)||guide?.beats.some(beat=>beat.unitIds.some(id=>id!==source.id)||beat.sceneRefs.some(ref=>ref.unitId!==source.id)))throw new Error('旧故事关系含外部引用，需要先处理归属，不能自动转换');
      conversion={source:owner,target,original,previousSummary:source.summary,replacesExistingRelations:Boolean(oldTarget?.beats.length||oldTarget?.nodeLinks.length)};
      source.summary=original;setOutlineText(p,owner,'');
      if(guide||oldTarget)p.outlineGuides=[...(p.outlineGuides??[]).filter(g=>g.id!==guide?.id&&g.id!==oldTarget?.id),...(guide?[{...guide,id:outlineGuideId(target),owner:target}]:[])];
    }
  }
  if(newSeason){const season={id:newId('season'),title:choice.seasonTitle?.trim()||`第 ${(p.seasons?.length??0)+1} 季`,arc:''};(p.seasons??=[]).push(season);unit.seasonId=season.id;if(!continuation)unit.scopeId=season.id;}
  else if(continuation&&source.seasonId)unit.seasonId=source.seasonId;
  p.units.push(unit);p.profile.plannedUnits=Math.max(p.profile.plannedUnits,p.units.length);
  return {baseHash:hashValue(project),project:parseScriptProject(p),unitId:unit.id,conversion};
}
export function applyEpisodePreview(current:ScriptProject,preview:EpisodePreview){if(hashValue(current)!==preview.baseHash)throw new Error('作品在预览后已变化，请重新预览新增集');return parseScriptProject(structuredClone(preview.project));}
