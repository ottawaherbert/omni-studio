import { Plus, Trash2 } from 'lucide-react';
import type { ScriptProject, DeliveryUnit, ContinuityTrack } from '../../../../../packages/script/src/schema';
import { newId } from '../../../../../packages/script/src/project';
import { sceneContinuity, sceneStateHash, visibleInUnit, unitCharacters, threadDiagnostics } from '../../../../../packages/script/src/continuity';
import { ScriptThreadPlan } from './ScriptThreadPlan';
import { Field, TextField } from './ScriptFields';
import { ScriptScope } from './ScriptScope';
const kinds={knowledge:'人物 / 观众知识',relationship:'关系变化',prop:'道具与状态',thread:'伏笔与回收'};
export function ScriptContinuity({project,unit,sceneId,onChange,onOpenScene}:{project:ScriptProject;unit:DeliveryUnit;sceneId?:string;onChange:(edit:(project:ScriptProject)=>void)=>void;onOpenScene:(id:string,unitId?:string)=>void}){
  const scenes=project.units.flatMap(u=>u.scenes.map(scene=>({scene,unit:u})));
  const tracks=(project.continuityTracks||[]).filter(t=>visibleInUnit(t.scopeId,project,unit));
  const selected=unit.scenes.find(s=>s.id===sceneId)||unit.scenes[0];
  const states=selected?sceneContinuity(project,unit,selected.id):[];
  const threads=threadDiagnostics(project,unit);
  const edit=(id:string,fn:(t:ContinuityTrack)=>void)=>onChange(p=>{const track=p.continuityTracks?.find(t=>t.id===id);if(track)fn(track);});
  return <>
    <div className="sw-section-title"><div><h1>故事连续性</h1><p className="sw-muted">登记谁知道什么、关系和道具如何变化，以及伏笔何时回收。这里记录作者确认的变化，不自动推断正文事实。</p></div><button onClick={()=>onChange(p=>{(p.continuityTracks||=[]).push({id:newId('state'),scopeId:unit.scopeId,kind:'knowledge',perspective:'character',label:'新的连续性线索',characterIds:[],initialValue:'',changes:[]});})}><Plus size={15}/>添加线索</button></div>
    <h2>故事顺序</h2><p className="sw-muted">数字表示事情发生的先后，可留空；它不会调整正文场次。角色状态按故事顺序计算，观众状态按场次展示顺序计算。</p>
    {unit.scenes.map(scene=><div className="sw-order-row" key={scene.id}><button onClick={()=>onOpenScene(scene.id)}>{scene.title}</button><Field label={`${scene.title} · 故事顺序`}><input type="number" min="0" step="1" value={scene.storyOrder??''} onChange={e=>onChange(p=>{p.units.find(u=>u.id===unit.id)!.scenes.find(s=>s.id===scene.id)!.storyOrder=e.target.value===''?undefined:Number(e.target.value);})}/></Field></div>)}
    {selected&&<><h2>「{selected.title}」的状态</h2>{!states.length&&<p className="sw-muted">尚无线索。可先登记“某人是否知道秘密”或“钥匙由谁持有”。</p>}{states.map(state=><article className="sw-state-summary" key={state.trackId}><strong>{state.label} · {state.status==='confirmed'?'已核对':'待核对'}</strong><p>进入本场：{state.entry||'未知'} → 离开本场：{state.exit||'未知'}</p>{state.issues.map(issue=><p className="sw-warning" key={issue}>{issue}</p>)}</article>)}</>}
    <h2>线索与变化记录</h2>
    {tracks.map(track=><article className="sw-continuity-track" key={track.id}>
      <div className="sw-grid"><TextField label="线索名称" value={track.label} onChange={value=>edit(track.id,t=>{t.label=value;})}/><Field label="线索类型"><select value={track.kind} onChange={e=>{if(track.threadPlan&&e.target.value!=='thread'&&!window.confirm('更改类型会移除伏笔回收计划，变化记录仍保留。继续？'))return;edit(track.id,t=>{t.kind=e.target.value as ContinuityTrack['kind'];if(t.kind!=='thread')delete t.threadPlan;});}}>{Object.entries(kinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
      <ScriptScope project={project} value={track.scopeId} label="线索适用范围" onChange={id=>edit(track.id,t=>{t.scopeId=id;})}/><Field label="状态观察视角"><select value={track.perspective} onChange={e=>edit(track.id,t=>{t.perspective=e.target.value as ContinuityTrack['perspective'];})}><option value="character">故事中的角色</option><option value="audience">观看作品的观众</option></select></Field></div>
      <div className="sw-methods">{project.characters.filter(c=>unitCharacters(project,unit).some(x=>x.id===c.id)||track.characterIds.includes(c.id)).map(c=><label key={c.id}><input type="checkbox" checked={track.characterIds.includes(c.id)} onChange={()=>edit(track.id,t=>{t.characterIds=t.characterIds.includes(c.id)?t.characterIds.filter(id=>id!==c.id):[...t.characterIds,c.id];})}/>{c.name}</label>)}</div>
      <TextField label="故事开始前的状态" value={track.initialValue} area onChange={value=>edit(track.id,t=>{t.initialValue=value;})}/>
      {track.changes.map(change=>{const source=scenes.find(x=>x.scene.id===change.sceneId);const valid=source&&change.sourceHash===sceneStateHash(source.scene);return <div className="sw-state-change" key={change.id}><Field label="变化发生的场景"><select value={change.sceneId} onChange={e=>edit(track.id,t=>{const c=t.changes.find(c=>c.id===change.id)!;c.sceneId=e.target.value;c.sourceHash='';})}>{!source&&<option value={change.sceneId}>原场景已删除，待重新定位</option>}{scenes.filter(x=>visibleInUnit(track.scopeId,project,x.unit)||x.scene.id===change.sceneId).map(x=><option key={x.scene.id} value={x.scene.id}>{x.unit.title} / {x.scene.title}</option>)}</select></Field>
        <TextField label="变化后的状态" value={change.value} onChange={value=>edit(track.id,t=>{const c=t.changes.find(c=>c.id===change.id)!;c.value=value;c.sourceHash='';})}/><TextField label="正文依据 / 变化原因" value={change.reason} area onChange={value=>edit(track.id,t=>{const c=t.changes.find(c=>c.id===change.id)!;c.reason=value;c.sourceHash='';})}/>
        <div className="sw-inline"><span className="sw-muted">{valid?'已按当前场景确认':'未确认或依据已改稿'}</span><button disabled={!source||!change.value.trim()||!change.reason.trim()} onClick={()=>edit(track.id,t=>{t.changes.find(c=>c.id===change.id)!.sourceHash=sceneStateHash(source!.scene);})}>按当前正文确认</button><button title="删除这条变化" onClick={()=>edit(track.id,t=>{t.changes=t.changes.filter(c=>c.id!==change.id);})}><Trash2 size={14}/></button></div>
      </div>;})}
      <div className="sw-inline"><button disabled={!selected} onClick={()=>edit(track.id,t=>{t.changes.push({id:newId('change'),sceneId:selected!.id,value:'',reason:'',sourceHash:''});})}><Plus size={14}/>登记本场变化</button><button onClick={()=>{if(window.confirm(`删除线索「${track.label}」及变化记录？删除后将更新当前稿。`))onChange(p=>{p.continuityTracks=p.continuityTracks?.filter(t=>t.id!==track.id);});}}><Trash2 size={14}/>删除线索</button></div>
      {track.kind==='thread'&&<ScriptThreadPlan project={project} track={track} diagnostic={threads.find(t=>t.trackId===track.id)} sceneId={selected?.id} unitId={unit.id} onChange={fn=>edit(track.id,fn)} onOpenScene={onOpenScene}/>}
    </article>)}
  </>;
}
