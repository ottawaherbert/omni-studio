import type { StudioPreviews } from './spatialClient';
import type { WorldBuildTask, WorldBuildMode } from '../../packages/domain/src/worldBuild';
export {worldBuildStatusLabels} from '../../packages/domain/src/worldBuild';
export type {WorldBuildTask} from '../../packages/domain/src/worldBuild';
export type BuildTask=WorldBuildTask & {sourceCurrent:boolean};
async function request<T>(projectId:string,path='',method='GET',body?:unknown):Promise<T>{const res=await fetch(`/api/production/previs/${encodeURIComponent(projectId)}/builds${path}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await res.json();if(!res.ok)throw new Error(data.error||'影视城构建失败');return data;}
export const worldBuildClient={
 options:async(p:string)=>{const r=await fetch(`/api/production/previs/${encodeURIComponent(p)}/build-options`);const data=await r.json();if(!r.ok)throw new Error(data.error);return data as {defaultModelId:string;models:Array<{id:string;name:string;provider:string}>};},
 previews:(p:string,id:string,start=false)=>request<StudioPreviews>(p,`/${encodeURIComponent(id)}/previews`,start?'POST':'GET',start?{}:undefined),
 list:(p:string)=>request<{tasks:WorldBuildTask[]}>(p),
 read:(p:string,id:string)=>request<{task:BuildTask}>(p,`/${encodeURIComponent(id)}`),
 create:(p:string,mode:WorldBuildMode,instructions:string,modelId?:string,sourceTaskId?:string)=>request<{task:BuildTask}>(p,'','POST',{commandId:crypto.randomUUID(),mode,instructions,modelId,sourceTaskId}),
 result:(p:string,id:string,rawResult:string)=>request<{task:BuildTask}>(p,`/${encodeURIComponent(id)}/result`,'POST',{rawResult}),
 apply:(p:string,id:string)=>request<{task:BuildTask}>(p,`/${encodeURIComponent(id)}/apply`,'POST',{}),
};
