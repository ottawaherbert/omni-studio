import {useState} from 'react';
import type {DeliveryUnit,ScriptProject} from '../../../../../../packages/script/src/schema';
import {changeUnitStoryScope} from '../../../../../../packages/script/src/continuity';
import toast from 'react-hot-toast';

export function ScriptUnitSettings({project,unit,onUpdate}:{project:ScriptProject;unit:DeliveryUnit;onUpdate:(updater:(draft:ScriptProject)=>void)=>void}){
  const [pendingScope,setPendingScope]=useState<{unitId:string;scopeId:string}|null>(null);
  const independent=unit.scopeId!==project.id&&project.units.filter(item=>item.scopeId===unit.scopeId).length===1;
  const groups=[...new Set(project.units.map(item=>item.scopeId))].filter(id=>id!==project.id&&!(independent&&id===unit.scopeId));
  const applyScope=()=>{if(!pendingScope||pendingScope.unitId!==unit.id)return;try{changeUnitStoryScope(project,unit.id,pendingScope.scopeId);onUpdate(draft=>Object.assign(draft,changeUnitStoryScope(draft,unit.id,pendingScope.scopeId)));setPendingScope(null);}catch(cause){toast.error(cause instanceof Error?cause.message:'无法更改故事范围');}};
  return <details className="px-4 py-2 border-b border-border-primary/20 text-xs bg-bg-surface">
    <summary className="cursor-pointer text-text-secondary">本单元时长与故事共享范围</summary>
    <div className="flex flex-wrap gap-4 py-3 items-start">
      <label>目标时长（分钟）<input aria-label="本单元目标时长（分钟）" type="number" min={0.5} max={600} step={0.5} value={unit.targetDurationMs/60000} className="ml-2 w-20 px-2 py-1 rounded border border-border-primary/30 bg-bg-surface-soft" onChange={event=>{const minutes=Number(event.target.value);if(Number.isFinite(minutes)&&minutes>=0.5&&minutes<=600)onUpdate(draft=>{draft.units.find(item=>item.id===unit.id)!.targetDurationMs=Math.round(minutes*60000);});}}/></label>
      {project.profile.organization==='episodic'&&<label>人物与设定<select aria-label="本单元故事范围" value={independent?'independent':unit.scopeId} className="ml-2 max-w-full px-2 py-1 rounded border border-border-primary/30 bg-bg-surface-soft" onChange={event=>{
        const targetScopeId=event.target.value;
        try{
          const updated=changeUnitStoryScope(project,unit.id,targetScopeId);
          if(JSON.stringify(updated)===JSON.stringify(project))return;
          setPendingScope({unitId:unit.id,scopeId:targetScopeId});
        }catch(cause){toast.error(cause instanceof Error?cause.message:'无法更改故事范围');}
      }}><option value="independent">本集独立故事</option><option value={project.id}>全剧连续共用</option>{groups.map(id=><option key={id} value={id}>与 {project.units.filter(item=>item.scopeId===id).map(item=>item.title).join(' / ')} 共用故事资料</option>)}</select></label>}
    </div>
    {pendingScope?.unitId===unit.id&&<div className="mb-3 p-3 rounded border border-border-primary/30 bg-bg-surface-soft" role="region" aria-label="故事范围变更预览">
      <p>{pendingScope.scopeId==='independent'?'本集将独立使用故事资料，全剧共用资料仍可使用。':'本集将加入所选故事范围；原本独有的人物与设定将一起共享，同名人物保持各自身份。'}其他集和正文不会改写。</p>
      <div className="flex gap-4 mt-2"><button type="button" className="underline" onClick={applyScope}>确认更改故事范围</button><button type="button" className="text-text-muted" onClick={()=>setPendingScope(null)}>取消更改</button></div>
    </div>}
    <p className="pb-2 text-text-muted">时长是创作目标。独立故事默认隔离；常驻人物可在资料页设为全剧共用，续篇可以明确加入同一故事范围。更改后保存作品生效。</p>
  </details>;
}
