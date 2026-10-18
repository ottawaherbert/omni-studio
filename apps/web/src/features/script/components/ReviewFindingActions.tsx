import type {ReviewSceneHandler,ScriptJob} from '../../../../../../packages/script/src/proposals';
import { useEffect, useState } from 'react';
import { scriptClient } from '../../../clients/scriptClient';
import { blocksToScreenplayText } from '../../../../../../packages/script/src/fountainAdapter';
const decisionLabels={to_fix:'准备修改',keep:'保留原稿',later:'稍后处理',revised:'已采用改稿，待复查',verified:'本轮复查未再发现问题',unresolved:'复查仍有建议'};
export function ReviewFindingActions({job,index,working,currentRevision,dirty,onDecide,onReviewScene}:{job:ScriptJob;index:number;working:boolean;currentRevision:number;dirty:boolean;onDecide:(job:ScriptJob,index:number,status:'to_fix'|'keep'|'later')=>void;onReviewScene?:ReviewSceneHandler}){
  const [showSource,setShowSource]=useState(false);
  const [source,setSource]=useState<{text:string;title:string}|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!showSource)return;
    let active=true;
    setSource(null);setError('');
    scriptClient.getReviewBaseline(job).then(({project})=>{
      const scene=project.units.flatMap(unit=>unit.scenes).find(scene=>scene.id===job.result?.findings?.[index]?.sceneId);
      if(!scene)throw new Error('当时的稿件中找不到此场景');
      if(active)setSource({title:scene.title,text:blocksToScreenplayText(scene.blocks,project.characters)});
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'读取审阅原文失败');});
    return()=>{active=false;};
  },[showSource,job.id,index]);
  const finding=job.result?.findings?.[index];if(!finding)return null;
  const decision=job.reviewDecisions?.[index];
  return <>
    <details onToggle={event=>setShowSource(event.currentTarget.open)}>
      <summary>查看审阅时原文</summary>
      {error?<p role="alert">{error}</p>:source?<><strong>{source.title}</strong><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{source.text||'本场没有正文'}</pre></>:<p>正在读取当时的稿件…</p>}
    </details>
    <p className="sw-muted">处理决定：{decision?decisionLabels[decision.status]:'未决定'}{decision?.revision!==undefined?' · 对应检查时的原文':''}</p>
    {decision&&['verified','unresolved'].includes(decision.status)&&(dirty||decision.revision!==currentRevision)&&<p className="sw-muted">此后稿件已有改动，以上复查结论针对检查时的原文。可以用当前稿再次复查。</p>}
    <div className="sw-inline">{(['to_fix','keep','later'] as const).map(status=><button type="button" key={status} disabled={working} aria-pressed={decision?.status===status} onClick={()=>onDecide(job,index,status)}>{decisionLabels[status]}</button>)}{onReviewScene&&<><button type="button" disabled={working} onClick={()=>onReviewScene(finding.sceneId,finding.issue,finding.suggestion,{jobId:job.id,index},'scene')}>针对这条意见改稿</button><button type="button" disabled={working} onClick={()=>onReviewScene(finding.sceneId,finding.issue,finding.suggestion,{jobId:job.id,index},'review')}>用当前稿复查</button></>}</div>
  </>;
}
