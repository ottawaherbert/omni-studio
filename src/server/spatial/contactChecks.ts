import { randomUUID } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { db, dbHelpers } from '../db';
import { readPrevisDocument } from '../previsStore';
import { buildPrevisTimeline } from '../previsVideo';
import { enqueueSpatialCapture, runSpatialBrowser } from './capture';
import { PREVIS_RENDER_VERSION, previsHash, type PrevisWorld, type PrevisContactCheck, type PrevisContactReport } from '../../../packages/domain/src/previs';
import type { ContactSnapshot } from '../../components/spatial/contactInspection';

type Stored = PrevisContactCheck & { snapshot: ContactSnapshot };
db.exec('CREATE TABLE IF NOT EXISTS previs_contact_checks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL)');
function save(check: Stored) { check.updatedAt = Date.now(); db.prepare('INSERT INTO previs_contact_checks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(check.id, check.projectId, JSON.stringify(check)); return check; }
function read(projectId: string, id: string): Stored {
  const row = db.prepare('SELECT data FROM previs_contact_checks WHERE id=? AND project_id=?').get(id, projectId) as { data: string } | undefined;
  if (!row) throw Object.assign(new Error('找不到本项目的接触检查。'), { statusCode: 404 }); return JSON.parse(row.data);
}
for (const row of db.prepare('SELECT data FROM previs_contact_checks').all() as { data: string }[]) { const check = JSON.parse(row.data) as Stored; if (check.status === 'queued' || check.status === 'running') save({ ...check, status: 'failed', error: '服务中断；旧检查保留，请基于当前版本重新检查。' }); }
function snapshot(projectId: string, input: Partial<PrevisContactCheck>): ContactSnapshot & { worldRevision: number } {
  const world = readPrevisDocument<PrevisWorld>(projectId, 'world'); if (!world) throw new Error('请先保存影视城。');
  const timeline = input.scope === 'world' ? undefined : buildPrevisTimeline(projectId, input.scope!, input.episodeId, input.sceneId, input.shotIds);
  const ids = new Set([...world.plan.objects.map(o => o.id), ...(timeline?.shots.flatMap(s => s.plan.objects.map(o => o.id)) || [])]);
  if (input.objectIds && (!Array.isArray(input.objectIds) || !input.objectIds.length || input.objectIds.length > 3000 || new Set(input.objectIds).size !== input.objectIds.length || input.objectIds.some(id => !ids.has(id)))) throw new Error('检查物体编号不存在或重复。');
  return { worldRevision: world.revision, world: world.plan, timeline, objectIds: input.objectIds, fps: input.fps || 24,
    sourceHash: previsHash({ renderVersion: PREVIS_RENDER_VERSION, content: timeline?.sourceHash || world.plan, objectIds: input.objectIds || null }) };
}
function publicCheck(check: Stored) {
  const { snapshot: ignored, ...result } = check; let sourceCurrent = false;
  try { sourceCurrent = snapshot(check.projectId, check).sourceHash === check.sourceHash; } catch { /* Deleted or changed source is stale. */ }
  return { ...result, sourceCurrent };
}
/** Only current, relevant failures block references; unrelated checks and old content never do. */
export function previsContactProblem(projectId:string,sceneId:string,shotIds:string[]) {
  return createPrevisContactProblemReader(projectId, sceneId)(shotIds);
}
/** One synchronous context read shares history and source checks across its references.
 * Never cache across requests: editing a shot/world must take effect on the next read. */
export function createPrevisContactProblemReader(projectId: string, sceneId: string) {
  let checks: Stored[] | undefined;
  const sources = new Map<string, string | undefined>();
  return (shotIds: string[]) => {
    // The UI page size must never hide a still-current failure from generation.
    checks ??= (db.prepare('SELECT data FROM previs_contact_checks WHERE project_id=? ORDER BY rowid DESC').all(projectId) as { data: string }[])
      .map(row => JSON.parse(row.data) as Stored)
      .filter(check => check.scope !== 'world' && check.status === 'complete' && check.report &&
        (!check.report.complete || check.report.issues.some(issue => issue.sceneId === sceneId)));
    for(const check of checks){
      if(!check.snapshot.timeline?.shots.some(s=>s.sceneId===sceneId&&shotIds.includes(s.shotId)))continue;
      const issue=check.report.issues.find(i=>i.sceneId===sceneId&&!!i.shotId&&shotIds.includes(i.shotId));
      if (!issue && check.report.complete) continue;
      const key = JSON.stringify([check.scope, check.episodeId, check.sceneId, check.shotIds, check.objectIds, check.fps]);
      if (!sources.has(key)) {
        try { sources.set(key, snapshot(projectId, check).sourceHash); }
        catch { sources.set(key, undefined); }
      }
      if (sources.get(key) !== check.sourceHash) continue;
      if(issue)return `3D接触检查未通过：${issue.message}（${issue.shotId}，${issue.time?.toFixed(3)}秒）。修正并重拍相关参考。`;
      if(!check.report.complete)return '3D接触检查覆盖不足，不能将该参考作为已验证素材继续生成。';
    }
  };
}
export function registerContactChecks(app: Express, base: string, assertAccess?: (projectId: string) => void) {
  const wrap = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => { try { assertAccess?.(req.params.projectId); if (!dbHelpers.getProjectShellById(req.params.projectId)) throw Object.assign(new Error('项目不存在。'), { statusCode: 404 }); await fn(req, res); } catch (e: any) { res.status(e.statusCode || 400).json({ error: e.message }); } };
  const route = `${base}/:projectId/checks`;
  app.get(route, wrap((req, res) => res.json({ checks: (db.prepare('SELECT data FROM previs_contact_checks WHERE project_id=? ORDER BY rowid DESC LIMIT 30').all(req.params.projectId) as { data: string }[]).map(row => publicCheck(JSON.parse(row.data))) })));
  app.get(`${route}/:checkId`, wrap((req, res) => res.json({ check: publicCheck(read(req.params.projectId, req.params.checkId)) })));
  app.post(route, wrap((req, res) => {
    const input = req.body || {};
    if (!['world', 'scene', 'episode', 'project'].includes(input.scope) || input.fps !== undefined && ![12, 24, 48].includes(input.fps)) throw new Error('选择世界、本场、本集或全剧；基础采样率支持12/24/48。');
    const frozen = snapshot(req.params.projectId, input);
    if (input.expectedWorldRevision !== undefined && input.expectedWorldRevision !== frozen.worldRevision) throw Object.assign(new Error('影视城版本已变化，请重新读取。'), { statusCode: 409 });
    const now = Date.now(), check = save({ id: `previs-check-${randomUUID()}`, projectId: req.params.projectId, scope: input.scope, episodeId: input.episodeId, sceneId: input.sceneId, shotIds: input.shotIds, objectIds: input.objectIds, fps: frozen.fps,
      status: 'queued', worldRevision: frozen.worldRevision, sourceHash: frozen.sourceHash, snapshot: frozen, createdAt: now, updatedAt: now });
    const port = req.socket.localPort!;
    enqueueSpatialCapture(check.id, async () => {
      save({ ...check, status: 'running' });
      try {
        let result: PrevisContactReport | undefined;
        await runSpatialBrowser(port, async (action, payload) => {
          if (action === 'init') return { kind: 'contact-check', snapshot: check.snapshot };
          if (action === 'report') { result = payload; return; }
          if (action === 'progress' || action === 'finish') return;
          throw new Error('未知检查动作。');
        });
        if (!result || result.sourceHash !== check.sourceHash || result.renderVersion !== PREVIS_RENDER_VERSION || !Number.isSafeInteger(result.sampledFrames) || !result.sampledFrames) throw new Error('检查未返回完整来源与采样记录。');
        save({ ...check, status: 'complete', report: result });
      } catch (e) { save({ ...check, status: 'failed', error: (e as Error).message }); }
    });
    res.status(202).json({ check: publicCheck(check) });
  }));
}
