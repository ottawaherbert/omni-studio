import {useEffect,useState} from 'react';
import type {ScriptProject} from '../../../../../../packages/script/src/schema';
import type {ScriptJob} from '../../../../../../packages/script/src/proposals';
import {scriptClient} from '../../../clients/scriptClient';

/** Read-only discussion launcher. Execution, recovery and Skill selection use the shared task panel. */
export function ScriptDiscussion({project,sceneId,onRequest,question='',onQuestionChange}:{project:ScriptProject;sceneId?:string;onRequest:(question:string)=>void;question?:string;onQuestionChange?:(text:string)=>void}){
  const [jobs,setJobs]=useState<ScriptJob[]>([]);
  const [hasMore,setHasMore]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    const refresh=()=>scriptClient.listJobs(project.id,{operation:'consult',sceneId}).then(result=>{if(alive){setJobs(result.jobs);setHasMore(result.jobs.length===100);setError('');}}).catch(cause=>{if(alive)setError(cause.message);});
    void refresh();
    const handleFocus=()=>{void refresh();};
    window.addEventListener('focus',handleFocus);
    window.addEventListener('script-jobs-changed',handleFocus);
    return ()=>{alive=false;window.removeEventListener('focus',handleFocus);window.removeEventListener('script-jobs-changed',handleFocus);};
  },[project.id,project.revision,sceneId]);
  const value=question;
  return <div className="flex-1 flex flex-col min-h-0 text-xs">
    <p className="p-3 text-text-muted border-b border-border-primary/20">讨论基于作品资料和当前场及相邻场正文，可查看提示词中的具体范围。讨论会留在作品里，答复不会自动写入正文。</p>
    <div className="flex-1 overflow-auto p-3 space-y-3 select-text">
      {error&&<p role="alert">{error}</p>}
      {!jobs.length&&<p className="text-text-muted">可以讨论故事方向，也可以直接回到正文试写。</p>}
      {hasMore&&<button onClick={()=>void scriptClient.listJobs(project.id,{operation:'consult',sceneId,before:jobs.at(-1)?.id}).then(({jobs:older})=>{setJobs(current=>[...current,...older.filter(job=>!current.some(existing=>existing.id===job.id))]);setHasMore(older.length===100);}).catch(cause=>setError(cause.message))}>加载更早的讨论</button>}
      {[...jobs].reverse().map(job=><article key={job.id} className="p-3 rounded-xl bg-bg-surface-soft border border-border-primary/20 space-y-2">
        <p className="font-medium whitespace-pre-wrap">{job.authorRequest||job.result?.summary||'讨论记录'}</p>
        <p className="text-text-muted">{project.units.find(unit=>unit.id===job.unitId)?.title||'原单元'} · {job.status==='ready'?'已答复':job.status==='failed'?'待重试':job.status==='waiting'?'等待返回':job.status==='cancelled'?'已取消':'已结束'}</p>
        {job.result?.answer&&<p className="whitespace-pre-wrap leading-relaxed">{job.result.answer}</p>}
        {job.error&&<p role="alert">{job.error}</p>}
        <details><summary>查看实际提示词与读取范围</summary><pre className="whitespace-pre-wrap break-words max-h-64 overflow-auto">{job.executionPrompt?[job.executionPrompt.systemInstruction,job.executionPrompt.prompt].filter(Boolean).join('\n\n'):job.prompt}</pre></details>
      </article>)}
    </div>
    <div className="p-3 border-t border-border-primary/20 space-y-2">
      <button onClick={()=>onRequest(value.trim())} className="px-3 py-2 rounded-lg bg-text-primary text-bg-surface">{jobs.length?'继续讨论或试写':'与 AI 讨论这个故事'}</button>
    </div>
  </div>;
}
