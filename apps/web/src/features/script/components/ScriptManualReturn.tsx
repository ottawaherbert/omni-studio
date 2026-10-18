import { useSettingsStore } from '../../../clients/stateClient';
import {useState} from 'react';
import type {ScriptJob} from '../../../../../../packages/script/src/proposals';

/** Both execution channels submit to the same persisted job contract. */
export function ScriptManualReturn({job,disabled,onSubmit}:{job:ScriptJob;disabled:boolean;onSubmit:(raw:string)=>Promise<void>}){
  const isTestMode=useSettingsStore(state=>state.isTestMode);
  const [raw,setRaw]=useState('');
  const [error,setError]=useState('');
  const [copied,setCopied]=useState(false);
  if(!isTestMode)return null;
  return <div className="space-y-3 mt-3">
    <p className="sw-muted">复制这次任务的提示词，在你使用的模型中执行，再把返回贴回这里。关闭后可从任务记录继续。</p>
    <button type="button" onClick={()=>void navigator.clipboard.writeText(job.prompt).then(()=>setCopied(true)).catch(()=>setError('复制失败，请展开提示词手动复制。'))}>{copied?'已复制提示词':'复制本次提示词'}</button>
    <label className="sw-field">粘贴本次返回<textarea aria-label="粘贴本次返回" rows={6} value={raw} onChange={event=>setRaw(event.target.value)} placeholder={job.operation==='consult'?'直接粘贴模型回复，无需转换格式':'粘贴模型按提示词给出的 JSON 返回'}/></label>
    {error&&<p role="alert">{error}</p>}
    <button disabled={disabled||!raw.trim()} onClick={async()=>{setError('');try{await onSubmit(raw);}catch(cause){setError(cause instanceof Error?cause.message:'提交失败，输入已保留');}}}>{job.operation==='consult'?'保存回复':'校验并查看结果'}</button>
  </div>;
}
