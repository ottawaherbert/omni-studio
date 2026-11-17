import { db } from '../db';
import { previsHash, validatePrevisWorld, type PrevisWorldPlan } from '../../../packages/domain/src/previs';
import type { SpatialModel, StudioRevision } from '../../../packages/domain/src/spatial';
import type { Project } from '../../../packages/domain/src/project';

db.exec(`CREATE TABLE IF NOT EXISTS spatial_models (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS spatial_studios (id TEXT NOT NULL, revision INTEGER NOT NULL, command_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL, PRIMARY KEY(id,revision));`);
export function saveModel(model: SpatialModel) { db.prepare('INSERT OR IGNORE INTO spatial_models (id,data) VALUES (?,?)').run(model.id, JSON.stringify(model)); return readModel(model.id); }
export function readModel(id: string): SpatialModel { const row = db.prepare('SELECT data FROM spatial_models WHERE id=?').get(id) as {data:string}|undefined; if (!row) throw new Error('模型资源未导入。'); return JSON.parse(row.data); }
export function listModels(): SpatialModel[] { return (db.prepare('SELECT data FROM spatial_models ORDER BY rowid DESC').all() as {data:string}[]).map(r => JSON.parse(r.data)); }
export function validateModelReferences(plan: PrevisWorldPlan) { for(const instance of plan.instances||[]){const source=readStudio(instance.studioId,instance.revision);if(instance.locationIds.some(id=>!source.plan.locations.some(l=>`${instance.id}.${l.id}`===id)))throw new Error('影视城引用的地点与固定来源版本不匹配。');} for (const m of plan.models || []) if (previsHash(m) !== previsHash(readModel(m.id))) throw new Error('模型清单必须使用库中固定资源，不能伪造或替换文件来源。'); }
export function listStudios(): StudioRevision[] { return (db.prepare('SELECT s.data FROM spatial_studios s JOIN (SELECT id, MAX(revision) revision FROM spatial_studios GROUP BY id) latest ON s.id=latest.id AND s.revision=latest.revision ORDER BY s.rowid DESC').all() as {data:string}[]).map(r => JSON.parse(r.data)); }
export function readStudio(id: string, revision?: number): StudioRevision {
  if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<1))throw new Error('影视城版本必须为正整数。');
  const row = (revision ? db.prepare('SELECT data FROM spatial_studios WHERE id=? AND revision=?').get(id, revision) : db.prepare('SELECT data FROM spatial_studios WHERE id=? ORDER BY revision DESC LIMIT 1').get(id)) as {data:string}|undefined;
  if (!row) throw Object.assign(new Error('影视城版本不存在。'), {statusCode:404}); return JSON.parse(row.data);
}
export function publishStudio(input: Omit<StudioRevision, 'revision'|'createdAt'> & {expectedRevision:number}) {
  if (!/^[\w-]{1,64}$/.test(input.id) || !/^[\w-]{1,100}$/.test(input.commandId) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160 || typeof input.description !== 'string' || input.description.length > 4000 || typeof input.license !== 'string' || !input.license.trim() || input.license.length > 2000 || !Array.isArray(input.tags) || input.tags.length > 30 || input.tags.some(t => typeof t !== 'string' || t.length > 60)) throw new Error('请填写影视城名称、标签和来源/使用说明。');
  validatePrevisWorld(input.plan, { episodes: [], assets: [], characters: [] } as unknown as Project); validateModelReferences(input.plan);
  return db.transaction(() => {
    const oldCommand = db.prepare('SELECT data FROM spatial_studios WHERE command_id=?').get(input.commandId) as {data:string}|undefined;
    if (oldCommand) { const old = JSON.parse(oldCommand.data) as StudioRevision; const {expectedRevision, ...request} = input; const {revision, createdAt, ...saved} = old; if (revision !== expectedRevision + 1 || previsHash(request) !== previsHash(saved)) throw Object.assign(new Error('同一发布编号不能用于不同内容。'), {statusCode:409}); return old; }
    const latest = db.prepare('SELECT MAX(revision) revision FROM spatial_studios WHERE id=?').get(input.id) as {revision:number|null};
    if (!Number.isSafeInteger(input.expectedRevision) || (latest.revision || 0) !== input.expectedRevision) throw Object.assign(new Error('影视城已更新，请读取最新版本后发布。'), {statusCode:409});
    const {expectedRevision, ...rest} = input; const next: StudioRevision = {...rest, revision: expectedRevision + 1, createdAt: Date.now()};
    db.prepare('INSERT INTO spatial_studios VALUES (?,?,?,?)').run(next.id, next.revision, next.commandId, JSON.stringify(next)); return next;
  })();
}
