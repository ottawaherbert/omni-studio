import type { ScriptProject } from '../../../../../packages/script/src/schema';
export const UNASSIGNED_NODE='__unassigned__';
export type ScriptView='blueprint'|'outline'|'board'|'unit'|'studio';
export type ScriptLocation={view:ScriptView;unitId?:string;sceneId?:string;nodeId?:string;outlineChoice?:'current'|'story'|'project'|'season'|'legacy';outlineSeasonId?:string;outlineTab?:'outline'|'beats'|'structure'};
export const scriptLocationKey=(id:string)=>`omni.script.location.${id}`;
export function resolveScriptLocation(project:ScriptProject, requested:Partial<ScriptLocation>={}, remembered:Partial<ScriptLocation>={}):ScriptLocation {
  const input={...remembered,...requested};
  const unit=project.units.find(item=>item.id===input.unitId)||project.units[0];
  const nodeId=input.nodeId===UNASSIGNED_NODE||unit?.structureNodes?.some(item=>item.id===input.nodeId)?input.nodeId:undefined;
  const inRange=(scene:NonNullable<typeof unit>['scenes'][number])=>!nodeId||nodeId===UNASSIGNED_NODE?!nodeId||!scene.structureNodeId:scene.structureNodeId===nodeId||unit?.structureNodes?.find(n=>n.id===scene.structureNodeId)?.parentId===nodeId;
  const scene=unit?.scenes.find(item=>item.id===input.sceneId&&inRange(item))||unit?.scenes.find(inRange);
  const fallback=project.units.some(item=>item.scenes.some(scene=>scene.blocks.some(block=>block.type!=='note'&&block.text.trim())))?'studio':
    project.units.some(item=>item.scenes.some(scene=>scene.purpose.trim()))?'board':
    project.brief.outline.trim()||project.units.some(item=>item.summary.trim())||project.storyOutlines?.some(item=>item.outline.trim())?'outline':'blueprint';
  const view=['blueprint','outline','board','unit','studio'].includes(input.view||'')?input.view!:fallback;
  const season=project.seasons?.find(season=>season.id===input.outlineSeasonId&&(unit?.seasonId===season.id||unit?.scopeId===season.id));
  const outlineChoice=input.outlineChoice==='season'&&!season?'current':input.outlineChoice;
  return {view:view==='unit'?'board':view,unitId:unit?.id,sceneId:scene?.id,...(outlineChoice?{outlineChoice}:{}),...(season?{outlineSeasonId:season.id}:{}),...(input.outlineTab?{outlineTab:input.outlineTab}:{}),...(nodeId?{nodeId}:{})};
}
export function locationFromParams(params:URLSearchParams):Partial<ScriptLocation>{
  const value=params.get('view')||params.get('section')||params.get('tab');
  const aliases:Record<string,ScriptView>={bible:'blueprint',characters:'blueprint',world:'blueprint',treatment:'outline',episode:'unit'};
  return {...(value?{view:aliases[value]||value as ScriptView}:{}),...(params.has('unitId')?{unitId:params.get('unitId')!}:{}),...(params.has('sceneId')?{sceneId:params.get('sceneId')!}:{}),...(params.has('nodeId')?{nodeId:params.get('nodeId')!}:{})};
}
