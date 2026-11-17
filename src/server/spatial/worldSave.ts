import type { Project } from '../../types/project';
import { validatePrevisWorld, previsVisibleLocations, type PrevisWorldPlan, type PrevisWorld } from '../../../packages/domain/src/previs';
import { listPrevisScenes, savePrevisDocument } from '../previsStore';
import { validateModelReferences } from './catalog';
import { ProductionQuality } from '../productionQuality';
import { GenerationStore } from '../generation/store';
import { db } from '../db';
export function validateWorldSave(project:Project, plan:PrevisWorldPlan){
    validatePrevisWorld(plan, project);
    validateModelReferences(plan);
    for (const existing of listPrevisScenes(project.id)) {
      if (!plan.locations.some((l: { id: string }) => l.id === existing.plan.locationId)) throw new Error('该地点已有拍摄方案引用，不能删除；请保留原地点并扩建。');
      if (existing.plan.includedLocationIds?.some(id => !plan.locations.some((l: {id:string}) => l.id === id))) throw new Error('共同取景地点仍被拍摄方案引用。');
      const ids = new Set(plan.objects.filter((o: { locationId: string }) => previsVisibleLocations(plan,existing.plan).some(l=>l.id===o.locationId)).map((o: { id: string }) => o.id));
      if (existing.plan.objects.some(o => ids.has(o.id))) throw new Error('新增布景编号与已有场次物体重复，请使用稳定且独立的编号。');
      existing.plan.objects.forEach(o => ids.add(o.id));
      if (existing.plan.frames.some(f => Object.keys(f.states).some(id => !ids.has(id)))) throw new Error('此布景仍被拍摄关键帧引用，请先调整对应方案，再移除或迁移布景。');
    }
}
export function saveWorldPlan(project:Project,plan:PrevisWorldPlan,expectedRevision:number){
 validateWorldSave(project,plan);
 new ProductionQuality(new GenerationStore(db),'').require('project_plan',{projectId:project.id});
 return savePrevisDocument<PrevisWorld>(project.id,'world',{plan},expectedRevision);
}
