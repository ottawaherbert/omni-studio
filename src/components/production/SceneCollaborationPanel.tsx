import { useEffect, useRef, useState } from 'react';
import type { Scene } from '../../clients/domainTypes';
import type { ProductionEventState, ProductionObservation, ProductionRequirement, ProductionWorkRecord } from '../../../packages/domain/src/productionCollaboration';
import type { CollaborationPatch } from '../../../packages/domain/src/productionCollaboration';

const input='w-full rounded-md border border-border-soft bg-bg-primary p-2 text-xs';
export function SceneCollaborationPanel({scene,entities=[],onSave}:{scene:Scene;entities?:{id:string;name:string}[];onSave:(patch:CollaborationPatch)=>Promise<unknown>}) {
  const [requirements,setRequirements]=useState<ProductionRequirement[]>([]),[events,setEvents]=useState<ProductionEventState[]>([]),[observations,setObservations]=useState<ProductionObservation[]>([]),[work,setWork]=useState<ProductionWorkRecord[]>([]);
  const baseline=useRef({requirements:scene.manualStoryboard?.directorPlan?.requirements||[],events:scene.visualPlan?.eventStates||[],observations:scene.productionPreparation?.observations||[],work:scene.productionPreparation?.workRecords||[]});
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{if(dirty)return;baseline.current={requirements:scene.manualStoryboard?.directorPlan?.requirements||[],events:scene.visualPlan?.eventStates||[],observations:scene.productionPreparation?.observations||[],work:scene.productionPreparation?.workRecords||[]};setRequirements(scene.manualStoryboard?.directorPlan?.requirements||[]);setEvents(scene.visualPlan?.eventStates||[]);setObservations(scene.productionPreparation?.observations||[]);setWork(scene.productionPreparation?.workRecords||[]);setDirty(false);setError('');},[scene.id,scene.manualStoryboard?.directorPlan,scene.visualPlan?.eventStates,scene.productionPreparation]);
  const change=()=>setDirty(true);
  const targets=[...entities,...(scene.shots||[]).map((shot,i)=>({id:shot.id,name:`镜头 ${i+1}`}))];
  const label=(name:string, value:string, edit:(value:string)=>void)=><label key={name} className="block text-xs text-text-secondary">{name}<input className={`${input} mt-1`} value={value} onChange={e=>{change();edit(e.target.value);}} /></label>;
  return <details className="mx-3 my-4 border-b border-border-soft pb-4 text-xs sm:mx-8" aria-label="场面协作与实际观察">
    <summary className="cursor-pointer font-semibold text-text-primary">制作需求、事件状态与实际观察</summary>
    <fieldset disabled={busy} className="mt-3 min-w-0 space-y-5">
      <p className="text-text-muted">按本场需要记录，保存后直接交给布景、分镜和后续制作。没有必填专业报告。</p>
      <section aria-label="制作需求"><h3 className="mb-2 font-semibold">制作需求</h3>{requirements.map((r,i)=><div key={r.id} className="mb-3 grid gap-2 sm:grid-cols-2">
        {label('专业',r.department,v=>setRequirements(items=>items.map((x,j)=>j===i?{...x,department:v}:x)))}
        {label('具体要求',r.description,v=>setRequirements(items=>items.map((x,j)=>j===i?{...x,description:v}:x)))}
        <label className="text-text-secondary">相关资产或镜头（可选）<select aria-label="相关资产或镜头" multiple className={`${input} mt-1`} value={r.targetIds||[]} onChange={e=>{change();const ids=Array.from(e.target.selectedOptions).map(o=>o.value);setRequirements(items=>items.map((x,j)=>j===i?{...x,targetIds:ids}:x));}}>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <button type="button" onClick={()=>{change();setRequirements(items=>items.filter(x=>x.id!==r.id));}}>移除此要求</button>
      </div>)}<button type="button" className="text-gold" onClick={()=>{change();setRequirements(r=>[...r,{id:crypto.randomUUID(),department:'美术/摄影',description:''}]);}}>添加制作要求</button></section>
      <section aria-label="事件状态"><h3 className="mb-2 font-semibold">事件前后状态</h3>{events.map((r,i)=><div key={r.id} className="mb-3 grid gap-2 sm:grid-cols-2">{(['event','before','after'] as const).map((field,k)=>label(['事件','发生前','发生后'][k],r[field],v=>setEvents(items=>items.map((x,j)=>j===i?{...x,[field]:v}:x))))}<label>人物或物件<select aria-label="人物或物件" className={`${input} mt-1`} value={r.entityId} onChange={e=>{change();setEvents(items=>items.map((x,j)=>j===i?{...x,entityId:e.target.value}:x));}}><option value="">选择人物或物件</option>{entities.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>对应镜头（可选）<select aria-label="对应镜头" multiple className={`${input} mt-1`} value={r.shotIds||[]} onChange={e=>{change();const ids=Array.from(e.target.selectedOptions).map(o=>o.value);setEvents(items=>items.map((x,j)=>j===i?{...x,shotIds:ids}:x));}}>{(scene.shots||[]).map((shot,index)=><option key={shot.id} value={shot.id}>镜头 {index+1}</option>)}</select></label><button type="button" onClick={()=>{change();setEvents(items=>items.filter(x=>x.id!==r.id));}}>移除此状态</button></div>)}<button type="button" className="text-gold" onClick={()=>{change();setEvents(r=>[...r,{id:crypto.randomUUID(),event:'',entityId:'',before:'',after:''}]);}}>添加事件变化</button></section>
      <section aria-label="实际观察"><h3 className="mb-2 font-semibold">实际观察</h3>{observations.map((r,i)=><div key={r.id} className="mb-3 grid gap-2 sm:grid-cols-2">
        {label('看到了什么',r.note,v=>setObservations(items=>items.map((x,j)=>j===i?{...x,note:v}:x)))}
        <label>影响<select aria-label="观察影响" className={`${input} mt-1`} value={r.impact} onChange={e=>{change();setObservations(items=>items.map((x,j)=>j===i?{...x,impact:e.target.value as ProductionObservation['impact']}:x));}}><option value="note">说明或建议</option><option value="issue">有问题，待处理</option><option value="unusable">当前用途不可用</option></select></label>
        {label('实际图片或视频',r.mediaUrl||'',v=>setObservations(items=>items.map((x,j)=>j===i?{...x,mediaUrl:v}:x)))}
        <label>需要修改的对象<select aria-label="需要修改的对象" className={`${input} mt-1`} value={r.fixTargetId||''} onChange={e=>{change();setObservations(items=>items.map((x,j)=>j===i?{...x,fixTargetId:e.target.value}:x));}}><option value="">本场或在说明中记录</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {label('时间点（秒，可选）',r.startSeconds===undefined?'':String(r.startSeconds),v=>setObservations(items=>items.map((x,j)=>j===i?{...x,startSeconds:v===''?undefined:Number(v)}:x)))}
      </div>)}<button type="button" className="text-gold" onClick={()=>{change();setObservations(r=>[...r,{id:crypto.randomUUID(),note:'',impact:'note'}]);}}>记录一次观察</button></section>
      <details><summary className="cursor-pointer text-text-secondary">本范围工作安排与交接</summary>{work.map((r,i)=><div key={r.scopeKey} className="mt-3 grid gap-2 sm:grid-cols-2"><span>本范围制作安排</span>{(['reviewsUsed','repairsUsed','maxReviews','maxRepairs'] as const).map((key,k)=><label key={key}>{['已粗审次数','已返工次数','约定粗审上限','约定返工上限'][k]}<input type="number" min="0" step="1" className={input} value={r[key]??''} onChange={e=>{change();const v=e.target.value;setWork(items=>items.map((x,j)=>j===i?{...x,[key]:v===''&&key.startsWith('max')?null:Number(v)}:x));}} /></label>) }{label('下一步',r.nextStep||'',v=>setWork(items=>items.map((x,j)=>j===i?{...x,nextStep:v}:x)))}<label><input type="checkbox" checked={!!r.handoff} onChange={e=>{change();setWork(items=>items.map((x,j)=>j===i?{...x,handoff:e.target.checked}:x));}} />交付当前成果，继续其他范围</label></div>)}<button className="mt-2 text-gold" type="button" onClick={()=>{change();setWork(items=>items.some(x=>x.scopeKey===scene.id)?items:[...items,{scopeKey:scene.id,reviewsUsed:0,repairsUsed:0}]);}}>记录本范围安排</button><p className="mt-2 text-text-muted">次数与上限按已约定安排填写，系统不会自动追加生成。</p></details>
      {error&&<p role="alert" className="text-red-500">{error}</p>}
      <button type="button" disabled={!dirty||busy} className="rounded-md bg-gold px-3 py-2 text-black disabled:opacity-40" onClick={async()=>{setBusy(true);setError('');try{const changed=(a:unknown,b:unknown)=>JSON.stringify(a)!==JSON.stringify(b);
        const patch:CollaborationPatch={};
        if(changed(requirements,baseline.current.requirements))patch.direction={requirements};
        if(changed(events,baseline.current.events))patch.eventStates=events;
        const changedObservations=observations.filter(o=>changed(o,baseline.current.observations.find(old=>old.id===o.id)));
        if(changedObservations.length)patch.observations=changedObservations;
        const changedWork=work.filter(w=>changed(w,baseline.current.work.find(old=>old.scopeKey===w.scopeKey)));
        if(changedWork.length)patch.workRecords=changedWork;
        await onSave(patch);baseline.current={requirements,events,observations,work};setDirty(false);}catch(e){setError(String(e));}finally{setBusy(false);}}}>保存本场制作记录</button>
    </fieldset>
  </details>;
}
