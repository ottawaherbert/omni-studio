import type { ScenePrevis, PrevisPlan, PrevisExport, PrevisWorld, PrevisWorldPlan, PrevisVideo, PrevisContactCheck } from '../../packages/domain/src/previs';
import type { Project, Scene } from './domainTypes';
export * from '../../packages/domain/src/previs';
export interface PrevisScope { projectId: string; episodeId: string; sceneId: string }
export interface PrevisWorkspace { document: ScenePrevis | null; world: PrevisWorld | null; scene: Scene; project: Pick<Project, 'id' | 'title' | 'aspectRatio' | 'characters' | 'assets'>; episodeRevision: number }
export interface PrevisWorldWorkspace { world: PrevisWorld | null; project: Pick<Project, 'id' | 'title' | 'aspectRatio' | 'characters' | 'assets'>; scenes: Array<{ episodeId: string; episodeTitle: string; id: string; title: string; script: string; description: string; locationIds: string[] }> }
const route = (s: PrevisScope) => `/api/production/previs/${encodeURIComponent(s.projectId)}/${encodeURIComponent(s.episodeId)}/${encodeURIComponent(s.sceneId)}`;
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await r.json(); if (!r.ok) throw new Error(result.error || '白模保存失败，草稿仍保留。'); return result;
}
export const previsClient = {
  patchWorld: (projectId:string,patch:object)=>request<PrevisWorldWorkspace>(`/api/production/previs/${encodeURIComponent(projectId)}`,'PATCH',patch),
  patch: (scope:PrevisScope,patch:object)=>request<PrevisWorkspace>(route(scope),'PATCH',patch),
  checks: (projectId:string)=>request<{checks:PrevisContactCheck[]}>(`/api/production/previs/${encodeURIComponent(projectId)}/checks`),
  check: (projectId:string,id:string)=>request<{check:PrevisContactCheck}>(`/api/production/previs/${encodeURIComponent(projectId)}/checks/${encodeURIComponent(id)}`),
  startCheck: (projectId:string,input:Pick<PrevisContactCheck,'scope'> & Partial<Pick<PrevisContactCheck,'episodeId'|'sceneId'|'shotIds'|'objectIds'|'fps'>> & {expectedWorldRevision?:number})=>request<{check:PrevisContactCheck}>(`/api/production/previs/${encodeURIComponent(projectId)}/checks`,'POST',input),
  pauseCapture:(projectId:string,videoId:string)=>request<{status:string}>(`/api/production/previs/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(videoId)}/capture/pause`, 'POST', {}),
  capture: (projectId:string,id:string,start=false)=>request<{status:string;error?:string}>(`/api/production/previs/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(id)}/capture`,start?'POST':'GET',start?{}:undefined),
  cancelVideo: (projectId:string,id:string)=>request(`/api/production/previs/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(id)}/cancel`,'POST',{}),
  videos: (projectId: string) => request<{ videos: Array<Omit<PrevisVideo, 'timeline'> & { duration: number; sourceCurrent?: boolean }> }>(`/api/production/previs/${encodeURIComponent(projectId)}/videos`),
  createVideo: (projectId: string, input: { scope: PrevisVideo['scope']; episodeId?: string; sceneId?: string; shotIds?: string[]; fps: number }) => request<{ video: PrevisVideo }>(`/api/production/previs/${encodeURIComponent(projectId)}/videos`, 'POST', input),
  video: (projectId: string, id: string) => request<{ video: PrevisVideo }>(`/api/production/previs/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(id)}`),
  videoFrames: (projectId: string, id: string, start: number, images: string[]) => request<{ video: Omit<PrevisVideo, 'timeline'> }>(`/api/production/previs/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(id)}/frames`, 'POST', { start, images }),
  finishVideo: (projectId: string, id: string) => request<{ video: Omit<PrevisVideo, 'timeline'> }>(`/api/production/previs/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(id)}/finish`, 'POST', {}),
  world: (projectId: string) => request<PrevisWorldWorkspace>(`/api/production/previs/${encodeURIComponent(projectId)}`),
  saveWorld: (projectId: string, plan: PrevisWorldPlan, expectedRevision: number) => request<PrevisWorldWorkspace>(`/api/production/previs/${encodeURIComponent(projectId)}`, 'PUT', { plan, expectedRevision }),
  read: (scope: PrevisScope) => request<PrevisWorkspace>(route(scope)),
  save: (scope: PrevisScope, plan: PrevisPlan, expectedRevision: number, expectedEpisodeRevision: number, expectedWorldRevision: number) => request<PrevisWorkspace>(route(scope), 'PUT', { plan, expectedRevision, expectedEpisodeRevision, expectedWorldRevision }),
  export: (scope: PrevisScope, input: { expectedRevision: number; frameIds: string[]; columns: number; sourceHash: string; imageUrl: string; commandId: string }) => request<{ document: ScenePrevis; item: PrevisExport; episodeRevision: number }>(route(scope) + '/exports', 'POST', input),
};
