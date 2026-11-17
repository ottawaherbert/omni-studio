import type { StudioRevision, SpatialModel } from '../../packages/domain/src/spatial';
export * from '../../packages/domain/src/spatial';
const base='/api/production/previs/library';
async function request<T>(path:string,method='GET',body?:unknown):Promise<T>{const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'影视城操作失败');return data;}
export type StudioPreviews={status:string;error?:string;images:Array<{id:string;name:string;locationId:string;url:string;note:string}>};
export const spatialClient={
  studios:()=>request<{studios:StudioRevision[]}>('/studios'),
  studio:(id:string,revision?:number)=>request<{studio:StudioRevision}>(`/studios/${encodeURIComponent(id)}${revision?`?revision=${revision}`:''}`),
  publish:(input:Omit<StudioRevision,'revision'|'createdAt'>&{expectedRevision:number})=>request<{studio:StudioRevision}>('/studios','POST',input),
  district:()=>request<{studio:StudioRevision}>('/district','POST',{}),
  samples:()=>request<{studios:StudioRevision[]}>('/samples','POST',{}),
  previews:(id:string,revision:number)=>request<StudioPreviews>(`/studios/${encodeURIComponent(id)}/previews?revision=${revision}`),
  createPreviews:(id:string,revision:number)=>request<StudioPreviews>(`/studios/${encodeURIComponent(id)}/previews`,'POST',{revision}),
  models:()=>request<{models:SpatialModel[]}>('/models'),
  async importModel(file:File,license:string){const r=await fetch(`${base}/models?${new URLSearchParams({name:file.name,license})}`,{method:'POST',headers:{'Content-Type':'model/gltf-binary'},body:file});const data=await r.json();if(!r.ok)throw new Error(data.error);return data as {model:SpatialModel};},
};
