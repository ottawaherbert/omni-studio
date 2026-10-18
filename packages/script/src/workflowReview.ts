import { hashValue } from '../../agent-core/src/identity';
import type { ScriptProject, DeliveryUnit } from './schema';
import { resolveStoryOutline } from './outlines';

export type WorkflowReviewNotice = {
  key:string; id:string; revision:number; unitId?:string;
  target:'outline'|'board'|'studio'; message:string;
};
const hasBody=(unit:DeliveryUnit)=>unit.scenes.some(scene=>scene.blocks.some(block=>block.text.trim()));
const hasPlan=(unit:DeliveryUnit)=>unit.scenes.some(scene=>scene.purpose.trim());
const blueprint=(project:ScriptProject)=>{
  const {outline,...brief}=project.brief;
  return {brief,profile:project.profile,characters:project.characters,facts:project.facts};
};
const plans=(unit:DeliveryUnit)=>({nodes:unit.structureNodes||[],scenes:unit.scenes.map(({blocks,generation,...scene})=>scene)});
const different=(left:unknown,right:unknown)=>hashValue(left)!==hashValue(right);

/** Advisory only: never rewrites downstream text or claims an artistic error. */
export function detectWorkflowChanges(before:ScriptProject,after:ScriptProject,revision=after.revision+1):WorkflowReviewNotice[]{
  if(before.id!==after.id)return [];
  const notices:WorkflowReviewNotice[]=[];
  const add=(key:string,target:WorkflowReviewNotice['target'],message:string,unitId?:string)=>
    notices.push({key,id:`${revision}:${key}`,revision,target,message,...(unitId?{unitId}:{})});
  if(different(blueprint(before),blueprint(after))&&(before.brief.outline.trim()||before.units.some(unit=>unit.summary.trim()||hasPlan(unit)||hasBody(unit))))
    add('blueprint','outline','蓝图或人物设定已修改，请复核已有大纲、分场和正文是否仍然一致。');
  if(before.brief.outline!==after.brief.outline&&before.units.some(unit=>unit.summary.trim()||hasPlan(unit)||hasBody(unit)))
    add('outline','outline','故事总纲已修改，请复核分集安排及已有分场、正文。');
  for(const unit of after.units){
    const old=before.units.find(item=>item.id===unit.id);
    if(!old)continue;
    if((old.summary!==unit.summary||old.endingHook!==unit.endingHook)&&(hasPlan(old)||hasBody(old)))
      add(`unit:${unit.id}`,'board',`「${unit.title}」大纲或结尾安排已修改，请复核本单元的分场和正文。`,unit.id);
    if((old.scopeId!==before.id||unit.scopeId!==after.id)&&different(resolveStoryOutline(before,old.scopeId),resolveStoryOutline(after,unit.scopeId))&&(hasPlan(old)||hasBody(old)))
      add(`story:${unit.id}`,'outline',`「${unit.title}」所属故事的大纲已修改，请复核本故事的分集安排和正文。`,unit.id);
    if(different(plans(old),plans(unit))&&hasBody(old))
      add(`scenes:${unit.id}`,'studio',`「${unit.title}」分场或场景顺序已修改，请复核已有正文的衔接。`,unit.id);
  }
  return notices;
}
