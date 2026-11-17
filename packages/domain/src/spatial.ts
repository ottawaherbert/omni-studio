import type { PrevisWorldPlan, PrevisVector } from './previs';

/** Immutable, content-addressed resources; metres, Y-up, bottom-centred. */
export interface SpatialModel {
  id: string; name: string; hash: string; size: PrevisVector;
  lods: Array<{ url: string; hash: string; bytes: number; triangles: number; distance: number }>;
  sourceBytes: number; license: string; createdAt: number;
}
export interface StudioInstance { id: string; studioId: string; revision: number; name: string; locationIds: string[] }
export interface StudioConnection { id: string; from: string; to: string; kind: 'physical' | 'narrative'; note: string }
export interface StudioRevision {
  id: string; revision: number; name: string; description: string; tags: string[];
  license: string; plan: PrevisWorldPlan; createdAt: number; commandId: string;
}
export function validateSpatialMetadata(world: PrevisWorldPlan) {
  const fail = () => { throw new Error('三维资源、影视城引用或地点连接无效。'); };
  const brief=world.worldBrief;
  if(brief && (!['component','district','world'].includes(brief.scope) || ['description','geography','circulation','services','skyline'].some(k=>typeof brief[k] !== 'string' || brief[k].length > 6000) || !Array.isArray(brief.gaps) || brief.gaps.length>100 || brief.gaps.some(g=>typeof g!=='string'||g.length>2000))) fail();
  const ids = new Set<string>();
  for (const m of world.models || []) {
    if (!m || !/^model-[a-f0-9]{64}$/.test(m.id) || ids.has(m.id) || !/^[a-f0-9]{64}$/.test(m.hash) || !Array.isArray(m.size) || m.size.length !== 3 || m.size.some(n => !Number.isFinite(n) || n <= 0 || n > 1000) || !Array.isArray(m.lods) || !m.lods.length || m.lods.length > 4) fail();
    ids.add(m.id);
    m.lods.forEach((l, i) => { if (!/^[a-f0-9]{64}$/.test(l.hash) || l.url !== `/media/spatial/models/${l.hash}.glb` || !Number.isSafeInteger(l.bytes) || l.bytes <= 0 || !Number.isSafeInteger(l.triangles) || l.triangles < 1 || !Number.isFinite(l.distance) || l.distance < 0 || i > 0 && l.distance <= m.lods[i - 1].distance) fail(); });
  }
  if ((world.models?.length || 0) > 1000) fail();
  const locationIds = new Set(world.locations.map(l => l.id)), instanceIds = new Set<string>();
  for (const i of world.instances || []) {
    if (!i || typeof i.id !== 'string' || !/^[\w.-]{1,70}$/.test(i.id) || instanceIds.has(i.id) || typeof i.studioId !== 'string' || !Number.isSafeInteger(i.revision) || i.revision < 1 || typeof i.name !== 'string' || !Array.isArray(i.locationIds) || i.locationIds.some(id => !locationIds.has(id))) fail();
    instanceIds.add(i.id);
  }
  const camera=(c:any)=>c&&['position','target'].every(k=>Array.isArray(c[k])&&c[k].length===3&&c[k].every(n=>Number.isFinite(n)&&Math.abs(n)<=10000))&&Number.isFinite(c.focalLength)&&c.focalLength>=8&&c.focalLength<=300&&!c.position.every((v,i)=>Math.abs(v-c.target[i])<.0001);
  if((world.viewpoints?.length||0)>120||(world.routes?.length||0)>60)fail();
  const viewIds=new Set<string>();
  for(const v of world.viewpoints||[]){if(!v||typeof v.id!=='string'||!/^[\w\u3400-\u9fff:.-]{1,160}$/u.test(v.id)||v.name?.length>160||v.note?.length>2000||viewIds.has(v.id)||typeof v.name!=='string'||!locationIds.has(v.locationId)||!camera(v.camera)||typeof v.note!=='string')fail();viewIds.add(v.id);}
  const routeIds=new Set<string>();
  for(const r of world.routes||[]){if(!r||typeof r.id!=='string'||!/^[\w\u3400-\u9fff:.-]{1,160}$/u.test(r.id)||r.name?.length>160||routeIds.has(r.id)||typeof r.name!=='string'||!locationIds.has(r.locationId)||!Number.isFinite(r.duration)||r.duration<=0||r.duration>3600||!Array.isArray(r.keys)||r.keys.length<2||r.keys.length>120||r.keys[0].time!==0||r.keys.at(-1)?.time!==r.duration||r.keys.some((k,i)=>!camera(k.camera)||!Number.isFinite(k.time)||k.time<0||k.time>r.duration||i>0&&k.time<=r.keys[i-1].time))fail();routeIds.add(r.id);}
  const connections = new Set<string>();
  for (const c of world.connections || []) {
    if (!c || typeof c.id !== 'string' || connections.has(c.id) || !locationIds.has(c.from) || !locationIds.has(c.to) || c.from === c.to || !['physical', 'narrative'].includes(c.kind) || typeof c.note !== 'string' || c.note.length > 2000) fail();
    connections.add(c.id);
  }
}
/** Project-local snapshot of placements with shared immutable geometry. No live library updates. */
export function composeStudio(world: PrevisWorldPlan, studio: StudioRevision, instanceId: string, origin: PrevisVector, selectedLocationIds?: string[]): PrevisWorldPlan {
  if (!/^[\w-]{1,50}$/.test(instanceId) || world.instances?.some(i => i.id === instanceId)) throw new Error('影视城实例编号无效或已使用。');
  if (!Array.isArray(origin) || origin.length !== 3 || origin.some(n => !Number.isFinite(n) || Math.abs(n) > 9000)) throw new Error('影视城位置无效。');
  if(selectedLocationIds){const chosen=new Set(selectedLocationIds);if(!chosen.size||chosen.size!==selectedLocationIds.length||selectedLocationIds.some(id=>!studio.plan.locations.some(l=>l.id===id)))throw new Error('选择的影视城地点不存在或为空。');const objects=studio.plan.objects.filter(o=>chosen.has(o.locationId)),models=new Set(objects.map(o=>o.modelId));studio={...studio,plan:{...studio.plan,locations:studio.plan.locations.filter(l=>chosen.has(l.id)).map(l=>({...l,parentId:l.parentId&&chosen.has(l.parentId)?l.parentId:undefined})),objects,models:studio.plan.models?.filter(m=>models.has(m.id)),connections:studio.plan.connections?.filter(c=>chosen.has(c.from)&&chosen.has(c.to)),viewpoints:studio.plan.viewpoints?.filter(v=>chosen.has(v.locationId)),routes:studio.plan.routes?.filter(r=>chosen.has(r.locationId))}};}
  const prefix = (id: string) => `${instanceId}.${id}`;
  const locations = studio.plan.locations.map(l => ({ ...l, id: prefix(l.id), parentId: l.parentId ? prefix(l.parentId) : undefined, spaceId: l.spaceId ? prefix(l.spaceId) : undefined, sourceSceneIds: [], assetId: undefined, origin: l.origin.map((v, i) => v + origin[i]) as PrevisVector }));
  if (locations.some(l => world.locations.some(w => w.id === l.id))) throw new Error('地点编号冲突。');
  return { ...world, locations: [...world.locations, ...locations], objects: [...world.objects, ...studio.plan.objects.map(o => ({ ...o, id: prefix(o.id), locationId: prefix(o.locationId), assetId: undefined }))],
    viewpoints:[...(world.viewpoints||[]),...(studio.plan.viewpoints||[]).map(v=>({...v,id:prefix(v.id),locationId:prefix(v.locationId)}))],
    routes:[...(world.routes||[]),...(studio.plan.routes||[]).map(v=>({...v,id:prefix(v.id),locationId:prefix(v.locationId)}))],
    models: [...new Map([...(world.models || []), ...(studio.plan.models || [])].map(m => [m.id, m])).values()],
    instances: [...(world.instances || []), { id: instanceId, studioId: studio.id, revision: studio.revision, name: studio.name, locationIds: locations.map(l => l.id) }],
    connections: [...(world.connections || []), ...(studio.plan.connections || []).map(c => ({ ...c, id: prefix(c.id), from: prefix(c.from), to: prefix(c.to) }))] };
}

/** Structural evidence only. Empty fields and a few buildings never establish a complete world. */
export function worldCoverageNotes(world: PrevisWorldPlan): string[] {
  const b=world.worldBrief, notes:string[]=[];
  if(!b || b.scope==='component') notes.push('建筑组件或布局草稿，不能当作完整街区或影视城验收。');
  for(const [key,label] of [['geography','地形与地理关系'],['circulation','道路与步行联系'],['services','功能配套'],['skyline','远景与边界']] as const)if(!b?.[key]?.trim())notes.push(`尚未说明${label}。`);
  if(!world.locations.some(l=>l.spaceId))notes.push('尚未明确共同物理空间；旧地点排列不代表连通。');
  if(!world.locations.some(l=>l.detailTier==='horizon'))notes.push('未登记远景环境，需检查街口、窗外和高机位是否露出空场。');
  notes.push(...(b?.gaps||[]));
  return notes;
}
