import type { ContinuityTrack, ScriptProject, ThreadPlan } from '../../../../../packages/script/src/schema';
import { sceneStateHash, visibleInUnit, type ThreadDiagnostic } from '../../../../../packages/script/src/continuity';
import { Field, TextField } from './ScriptFields';

export const THREAD_STATUS:Record<ThreadDiagnostic['status'],string>={unplanned:'未安排回收',planned:'尚未展示埋设',open:'已埋设，待回收',due:'本单元到期',overdue:'已过回收期限',paid_off:'已回收',needs_review:'依据待核对',waived:'保留创作例外'};
export function ScriptThreadPlan({project,track,diagnostic,sceneId,unitId,onChange,onOpenScene}:{project:ScriptProject;track:ContinuityTrack;diagnostic?:ThreadDiagnostic;sceneId?:string;unitId:string;onChange:(fn:(t:ContinuityTrack)=>void)=>void;onOpenScene:(id:string,unitId?:string)=>void}){
  const plan=track.threadPlan;
  const scenes=project.units.flatMap(unit=>unit.scenes.map(scene=>({unit,scene})));
  const setup=scenes.find(s=>s.scene.id===plan?.setupSceneId);
  const payoff=scenes.find(s=>s.scene.id===track.changes.find(c=>c.id===plan?.payoffChangeId)?.sceneId);
  const edit=(fn:(plan:ThreadPlan)=>void)=>onChange(t=>{if(t.threadPlan)fn(t.threadPlan);});
  return <div className="sw-thread-plan">
    <h3>伏笔回收计划</h3>
    <p className="sw-muted">按分集展示顺序检查期限。回收必须关联一条作者确认的变化，不根据“已回收”等文字猜测。</p>
    {diagnostic&&<p role="status" className={['due','overdue','needs_review'].includes(diagnostic.status)?'sw-warning':''}>{THREAD_STATUS[diagnostic.status]}{diagnostic.issues.map(issue=><span className="sw-thread-issue" key={issue}>{issue}</span>)}</p>}
    {!plan?<button disabled={!sceneId} onClick={()=>onChange(t=>{t.threadPlan={setupSceneId:sceneId!,setupSourceHash:'',dueUnitId:unitId};})}>安排回收</button>:<>
      <div className="sw-grid">
        <Field label="埋设场景"><select value={plan.setupSceneId} onChange={e=>edit(p=>{p.setupSceneId=e.target.value;p.setupSourceHash='';})}>{!setup&&<option value={plan.setupSceneId}>原场景已删除</option>}{scenes.filter(s=>visibleInUnit(track.scopeId,project,s.unit)||s.scene.id===plan.setupSceneId).map(s=><option key={s.scene.id} value={s.scene.id}>{s.unit.title} / {s.scene.title}</option>)}</select></Field>
        <Field label="最迟回收单元"><select value={plan.dueUnitId} onChange={e=>edit(p=>{p.dueUnitId=e.target.value;})}>{!project.units.some(u=>u.id===plan.dueUnitId)&&<option value={plan.dueUnitId}>原单元已删除</option>}{project.units.filter(u=>visibleInUnit(track.scopeId,project,u)||u.id===plan.dueUnitId).map(u=><option key={u.id} value={u.id}>{u.title}</option>)}</select></Field>
        <Field label="回收依据（已登记的变化）"><select value={plan.payoffChangeId||''} onChange={e=>edit(p=>{p.payoffChangeId=e.target.value||undefined;})}><option value="">尚未指定</option>{plan.payoffChangeId&&!track.changes.some(c=>c.id===plan.payoffChangeId)&&<option value={plan.payoffChangeId}>原变化已删除</option>}{track.changes.map(c=><option key={c.id} value={c.id}>{scenes.find(s=>s.scene.id===c.sceneId)?.scene.title||'场景已删除'} · {c.value||'尚未填写状态'}</option>)}</select></Field>
        <TextField label="创作例外理由（可选）" area value={plan.waiver||''} onChange={v=>edit(p=>{p.waiver=v;})}/>
      </div>
      <div className="sw-inline">{setup&&<button onClick={()=>onOpenScene(setup.scene.id,setup.unit.id)}>查看埋设正文</button>}{payoff&&<button onClick={()=>onOpenScene(payoff.scene.id,payoff.unit.id)}>查看回收正文</button>}</div>
      <div className="sw-inline"><span className="sw-muted">{setup&&plan.setupSourceHash===sceneStateHash(setup.scene)?'埋设依据已确认':'埋设依据未确认或已改稿'}</span><button disabled={!setup} onClick={()=>edit(p=>{p.setupSourceHash=sceneStateHash(setup!.scene);})}>确认埋设依据</button><button onClick={()=>{if(window.confirm('移除回收计划？线索与变化记录仍保留。'))onChange(t=>{delete t.threadPlan;});}}>移除计划</button></div>
    </>}
  </div>;
}
