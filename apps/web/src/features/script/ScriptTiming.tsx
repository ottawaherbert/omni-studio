import { ArrowUpRight, Clock3, Plus, Trash2 } from 'lucide-react';
import type { DeliveryUnit, ScriptProject } from '../../../../../packages/script/src/schema';
import { analyseTimeline } from '../../../../../packages/script/src/runtime';
import { estimateDialogue, newId, unitContentHash } from '../../../../../packages/script/src/project';
import { Field, TextField } from './ScriptFields';

const seconds=(ms:number)=>Number((ms/1000).toFixed(3));
interface Props {
  project:ScriptProject;
  unit:DeliveryUnit;
  sceneId?:string;
  onChange:(edit:(unit:DeliveryUnit)=>void)=>void;
  onProfileChange:(includeCredits:boolean)=>void;
  onOpenScene:(sceneId:string)=>void;
  onNotice:(message:string)=>void;
}
export function ScriptTiming({project,unit,sceneId,onChange,onProfileChange,onOpenScene,onNotice}:Props) {
  const hash=unitContentHash(project,unit);
  let report=analyseTimeline([],0);
  let error='';
  try { report=analyseTimeline(unit.timeline,unit.targetDurationMs,hash,{includeCredits:project.profile.includeCredits,toleranceMs:project.profile.toleranceMs}); }
  catch(e) { error=e instanceof Error?e.message:'时间轴无效'; }
  const displayMs=(value:number)=>error?'—':seconds(value);
  const scene=unit.scenes.find(item=>item.id===sceneId);
  const included=unit.timeline.filter(item=>item.included&&item.kind!=='marker');
  const tracks=[...new Set(included.map(item=>item.track))];
  const limit=Math.max(1,report.spanMs,unit.targetDurationMs);
  const estimate=unit.timingEvidence.filter(e=>e.kind==='estimate'&&e.contentHash===hash).at(-1);
  return <>
    <div className="sw-section-title"><div><h1>时长与诊断</h1><p className="sw-muted">{unit.title} · 目标、文本估算与编排计划分别记录。</p></div><Clock3 size={20} className="sw-muted"/></div>
    {error&&<p role="alert" className="sw-error">{error}</p>}
    <div className="sw-duration-contract"><label><input type="checkbox" checked={project.profile.includeCredits} onChange={e=>onProfileChange(e.target.checked)}/>片头片尾计入目标</label><span>允许偏差 ±{seconds(project.profile.toleranceMs)} 秒</span></div>
    <div className="sw-metrics">
      <div><span>目标时长</span><strong>{seconds(unit.targetDurationMs)}<small> 秒</small></strong></div>
      <div><span>完整计划跨度</span><strong>{displayMs(report.spanMs)}<small> 秒</small></strong></div>
      <div><span>{project.profile.includeCredits?'当前内容覆盖':'故事内容覆盖'}</span><strong>{displayMs(report.coverageMs)}<small> 秒</small></strong></div>
      <div><span>{report.overTargetMs?'超出目标':'距离目标'}</span><strong>{displayMs(report.overTargetMs||report.gapToTargetMs)}<small> 秒</small></strong></div>
    </div>
    <div className={`sw-timing-summary ${report.rangeStatus==='within'?'':'sw-warning'}`} role="status">
      {error?'请先修正时间轴输入，再查看时长诊断。':report.rangeStatus==='under'?`当前内容计划少于允许范围，还差 ${seconds(Math.max(0,unit.targetDurationMs-project.profile.toleranceMs-report.coverageMs))} 秒。`
        :report.rangeStatus==='over'?`当前内容计划超过允许范围 ${seconds(report.coverageMs-unit.targetDurationMs-project.profile.toleranceMs)} 秒。`
        :'内容计划处于允许范围内，仍需作者审阅叙事与节奏。'}
      <span>空档与占位不算完成内容；音画并行不重复计时。</span>
    </div>
    {report.staleCount>0&&<p className="sw-warning">正文或设定已变化，{report.staleCount} 个片段待复核，未计入当前内容覆盖。</p>}
    <div className="sw-evidence-grid">
      <div><span>对白估算</span><strong>{estimate?`${seconds(estimate.lowMs??estimate.durationMs)}–${seconds(estimate.highMs??estimate.durationMs)} 秒`:'尚未估算'}</strong><small>仅对白，未校准假设</small></div>


    </div>
    <div className="sw-section-title"><h2>编排时间轴</h2><div className="sw-inline">
      <button onClick={()=>onChange(u=>u.timeline.push({id:newId('timeline'),sceneId:scene?.id,track:'V1',modality:'video',scope:'story',kind:'content',startMs:report.spanMs,endMs:report.spanMs+10000,included:true,label:scene?.title||'内容片段',contentHash:hash}))}><Plus size={15}/>添加片段</button>
      <button disabled={!project.profile.language.startsWith('zh')} title="仅适用于中文对白，不包含动作时长" onClick={()=>{const value=estimateDialogue(project,unit);if(!value){onNotice('当前没有对白，尚不能估算。');return;}onChange(u=>u.timingEvidence.push(value));}}>估算对白</button>
    </div></div>
    {!unit.timeline.length&&<p className="sw-empty">还没有编排片段。添加本场的画面或声音计划，再检查覆盖与缺口。</p>}
    {!error&&tracks.length>0&&<div className="sw-time-map" aria-label="时间轴轨道概览">
      <div className="sw-time-ruler"><span>0 秒</span><span>{seconds(limit)} 秒</span></div>
      {tracks.map(track=><div className="sw-track" key={track}><span>{track}</span><div>{included.filter(item=>item.track===track).map(item=><button
        key={item.id} className={`sw-clip sw-clip-${item.kind}${item.contentHash!==hash?' is-stale':''}`}
        style={{left:`${item.startMs/limit*100}%`,width:`${(item.endMs-item.startMs)/limit*100}%`}}
        aria-label={`定位片段：${item.label}`} title={`${item.label} · ${seconds(item.startMs)}–${seconds(item.endMs)} 秒`}
        onClick={()=>document.getElementById(`script-clip-${item.id}`)?.scrollIntoView({behavior:'smooth',block:'center'})}
      ><span>{item.label}</span></button>)}</div></div>)}
    </div>}
    <div className="sw-timeline">{unit.timeline.map((item,index)=><article id={`script-clip-${item.id}`} key={item.id}>
      <div className="sw-section-title"><strong><span className="sw-muted">{String(index+1).padStart(2,'0')} / </span>{item.label||'未命名片段'}</strong><div className="sw-inline">
        {item.sceneId&&<button title="打开关联场景" onClick={()=>onOpenScene(item.sceneId!)}><ArrowUpRight size={14}/>场景</button>}
        <button title="删除时间片段" aria-label={`删除片段：${item.label}`} onClick={()=>onChange(u=>{u.timeline.splice(index,1);})}><Trash2 size={15}/></button>
      </div></div>
      <div className="sw-grid sw-timeline-fields">
        <TextField label="片段名称" value={item.label} onChange={value=>onChange(u=>{u.timeline[index].label=value;})}/>
        <Field label="关联场景"><select value={item.sceneId||''} onChange={e=>onChange(u=>{u.timeline[index].sceneId=e.target.value||undefined;u.timeline[index].contentHash='';})}><option value="">无关联场景</option>{unit.scenes.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></Field>
        <TextField label="轨道" value={item.track} onChange={value=>onChange(u=>{u.timeline[index].track=value;})}/>
        <Field label="媒介"><select value={item.modality} onChange={e=>onChange(u=>{u.timeline[index].modality=e.target.value as typeof item.modality;})}><option value="video">画面</option><option value="audio">声音</option></select></Field>
        <Field label="计时范围"><select value={item.scope||'story'} onChange={e=>onChange(u=>{u.timeline[index].scope=e.target.value as typeof item.scope;})}><option value="story">故事正文</option><option value="credits">片头 / 片尾</option></select></Field>
        <Field label="内容类别"><select value={item.kind} onChange={e=>onChange(u=>{u.timeline[index].kind=e.target.value as typeof item.kind;if(e.target.value==='marker')u.timeline[index].endMs=item.startMs;})}><option value="content">内容计划</option><option value="placeholder">占位</option><option value="gap">显式空档</option><option value="marker">时间标记</option></select></Field>
        {(['startMs','endMs'] as const).map(key=><Field key={key} label={key==='startMs'?'开始（秒）':'结束（秒）'}><input type="number" min="0" step="0.001" disabled={key==='endMs'&&item.kind==='marker'} value={seconds(item[key])} onChange={e=>{
          const value=Math.round(Number(e.target.value)*1000);
          onChange(u=>{u.timeline[index][key]=value;if(key==='startMs'&&item.kind==='marker')u.timeline[index].endMs=value;});
        }}/></Field>)}
      </div>
      <div className="sw-inline"><label><input type="checkbox" checked={item.included} onChange={e=>onChange(u=>{u.timeline[index].included=e.target.checked;})}/>纳入当前剪辑</label>
        {item.contentHash!==hash&&<><span className="sw-warning-text">待复核</span><button onClick={()=>onChange(u=>{u.timeline[index].contentHash=hash;})}>已按新稿复核</button></>}
      </div>
    </article>)}</div>
    <h2>覆盖明细</h2><div className="sw-coverage-list">
      <p><span>完整内容覆盖</span><strong>{seconds(report.fullCoverageMs)} 秒</strong></p>
      <p><span>故事正文</span><strong>{seconds(report.storyCoverageMs)} 秒</strong></p>
      <p><span>片头 / 片尾</span><strong>{seconds(report.creditsCoverageMs)} 秒</strong></p>
      {Object.entries(report.tracks).map(([track,ms])=><p key={track}><span>{track} · 当前计时范围</span><strong>{seconds(ms)} 秒</strong></p>)}
    </div><p className="sw-muted">当前范围：画面 {seconds(report.modalities.video)} 秒，声音 {seconds(report.modalities.audio)} 秒；二者不能相加。完整计划中的占位 {seconds(report.placeholderMs)} 秒，显式空档 {seconds(report.explicitGapMs)} 秒。片头片尾与故事重叠时同样不重复计时。</p>
    {unit.timingEvidence.some(e=>e.kind==='estimate')&&<details><summary>查看估算记录 · {unit.timingEvidence.filter(e=>e.kind==='estimate').length}</summary>{unit.timingEvidence.filter(e=>e.kind==='estimate').map(e=><article key={e.id} className="sw-evidence"><strong>{e.contentHash===hash?'当前内容':'已过期'} · {seconds(e.lowMs??e.durationMs)}–{seconds(e.highMs??e.durationMs)} 秒</strong><p>{e.assumptions}</p></article>)}</details>}
  </>;
}
