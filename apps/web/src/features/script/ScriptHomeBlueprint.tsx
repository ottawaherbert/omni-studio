import { useEffect, useRef, useState } from 'react';
import { scriptAgentClient } from '../../clients/scriptClient';
import type { ScriptWorkspace } from '../../../../api/src/repositories/scriptWorkspaceStore';

/** A blueprint is a stopped candidate. Adoption uses the same durable receipt
 * as other workspaces and never starts a writing Goal. */
export function ScriptHomeBlueprint({workspaceId,onOpen}:{workspaceId:string;onOpen:(id:string,view?:'blueprint')=>void}){
  const [workspace,setWorkspace]=useState<ScriptWorkspace|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const working=useRef(false),alive=useRef(true),key=`omni.script.blueprint.adoption.${workspaceId}`;
  useEffect(()=>{alive.current=true;void scriptAgentClient.workspace(workspaceId).then(({workspace})=>{if(alive.current)setWorkspace(workspace);}).catch(e=>{if(alive.current)setError(e.message);});return()=>{alive.current=false;};},[workspaceId]);
  const adopt=async()=>{
    if(working.current||!workspace)return;
    if(workspace.projectId){onOpen(workspace.projectId,'blueprint');return;}
    working.current=true;setBusy(true);setError('');
    try{
      const saved=localStorage.getItem(key);
      let pending=saved?JSON.parse(saved):null;
      if(!pending){
        const {proposal}=await scriptAgentClient.prepareAdoption(workspace,0);
        if(!proposal)throw new Error('蓝图已变化，请重新读取后确认。');
        pending={requestId:crypto.randomUUID(),proposal:{id:proposal.id,digest:proposal.digest}};
        localStorage.setItem(key,JSON.stringify(pending));
      }
      await scriptAgentClient.adopt(workspaceId,pending.proposal,pending.requestId);
      localStorage.removeItem(key);
      const current=(await scriptAgentClient.workspace(workspaceId)).workspace;
      if(alive.current){setWorkspace(current);if(current.projectId)onOpen(current.projectId,'blueprint');}
    }catch(e){const status=(e as {status?:number}).status;if(status&&status>=400&&status<500){localStorage.removeItem(key);const current=await scriptAgentClient.workspace(workspaceId).catch(()=>null);if(current&&alive.current)setWorkspace(current.workspace);}if(alive.current)setError((e as Error).message);}finally{working.current=false;if(alive.current)setBusy(false);}
  };
  return <div className="mt-3 space-y-2">
    {workspace&&<p className="text-xs text-text-muted">{workspace.document.title} · 蓝图工作稿 · 大纲、分场和正文尚未生成</p>}
    {error&&<p role="alert" className="text-xs text-accent-red">{error}</p>}
    <button type="button" disabled={busy||!workspace} onClick={()=>void adopt()} className="px-3 py-2 text-xs rounded-lg bg-text-primary text-bg-surface disabled:opacity-40">{busy?'正在保存蓝图…':workspace?.projectId?'打开作品蓝图':'采用蓝图并进入作品'}</button>
  </div>;
}
