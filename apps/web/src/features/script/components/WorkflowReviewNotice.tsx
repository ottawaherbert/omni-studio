import { useEffect, useState } from 'react';
import { detectWorkflowChanges, type WorkflowReviewNotice as Notice } from '../../../../../../packages/script/src/workflowReview';
import type { ScriptProject } from '../../../../../../packages/script/src/schema';
import { scriptClient } from '../../../clients/scriptClient';

export function WorkflowReviewNotice({project,saved,dirty,onOpen}:{project:ScriptProject;saved:string;dirty:boolean;onOpen:(notice:Notice)=>void}){
  const [notices,setNotices]=useState<Notice[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let active=true;setError('');
    scriptClient.workflowReviews(project.id).then(result=>{if(active)setNotices(result.notices);}).catch(e=>{if(active)setError(e.message||'复核提示读取失败');});
    return()=>{active=false;};
  },[project.id,project.revision]);
  let pending:Notice[]=[];
  if(dirty&&saved)try{pending=detectWorkflowChanges(JSON.parse(saved),project);}catch{}
  const combined=new Map(notices.map(notice=>[notice.key,notice]));
  pending.forEach(notice=>combined.set(notice.key,notice));
  if(!combined.size&&!error)return null;
  const acknowledge=async()=>{
    setBusy(true);setError('');
    try{await scriptClient.acknowledgeWorkflowReviews(project.id,project.revision,notices.map(item=>item.id));setNotices([]);}
    catch(e){setError(e instanceof Error?e.message:'复核确认未保存');}
    finally{setBusy(false);}
  };
  return <details className="shrink-0 border-b border-border-primary/30 bg-bg-surface px-5 py-2 text-xs" open>
    <summary className="cursor-pointer text-text-secondary">上游内容变化，{combined.size} 项待复核</summary>
    <div className="max-h-32 overflow-auto space-y-2 pt-2">
      {[...combined.values()].map(notice=><div key={notice.key} className="flex flex-wrap items-center gap-2"><span>{notice.message}</span><button type="button" className="underline" onClick={()=>onOpen(notice)}>查看相关内容</button></div>)}
      {error&&<p role="alert">{error}</p>}
      {combined.size>0&&<div className="flex flex-wrap items-center gap-3 text-text-muted"><span>提示不代表存在错误，请按创作意图判断。{dirty?'保存当前稿后可标记已复核。':''}</span><button type="button" disabled={dirty||busy||!notices.length} className="underline disabled:opacity-40" onClick={()=>void acknowledge()}>我已复核以上内容</button></div>}
    </div>
  </details>;
}
