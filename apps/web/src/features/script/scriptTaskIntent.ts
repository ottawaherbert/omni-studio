import type {DeliveryUnit,ScriptOperation} from '../../../../../packages/script/src/schema';
import type {ScriptJob} from '../../../../../packages/script/src/proposals';

export function scriptTaskAnchor(unit:DeliveryUnit,operation:ScriptOperation,sceneId?:string):string {
  if(sceneId){if(!unit.scenes.some(scene=>scene.id===sceneId))throw new Error('原场景已删除，请重新选择任务范围。');return sceneId;}
  if(['plan','board_plan','ending','outline','story_outline','season_outline','unit_outline','unit_outlines','concept','theme','character','fact','consult'].includes(operation))return unit.id;
  throw new Error('这项任务需要已有场景，请先规划分场或选择有效场景。');
}

export function unreturnedPlanningUnits(job:Pick<ScriptJob,'operation'|'unitIndices'|'result'>):number[] {
  if(!['unit_outlines','board_plan'].includes(job.operation)||!job.result?.units)return [];
  const returned=new Set(job.result.units.map(unit=>unit.unitIndex));
  return (job.unitIndices||[]).filter(index=>!returned.has(index));
}
