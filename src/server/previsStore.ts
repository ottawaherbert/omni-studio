import { db } from './db';
import type { PrevisWorld, ScenePrevis } from '../../packages/domain/src/previs';

// Project worlds have their own revision, so saving an older ordinary episode cannot erase them.
db.exec(`CREATE TABLE IF NOT EXISTS previs_documents (
  project_id TEXT NOT NULL, scope_key TEXT NOT NULL, revision INTEGER NOT NULL,
  data TEXT NOT NULL, PRIMARY KEY(project_id, scope_key)
)`);
export const previsSceneKey = (episodeId: string, sceneId: string) => 'scene:' + JSON.stringify([episodeId, sceneId]);
export function readPrevisDocument<T extends PrevisWorld | ScenePrevis>(projectId: string, key: string): T | null {
  const row = db.prepare('SELECT data FROM previs_documents WHERE project_id = ? AND scope_key = ?').get(projectId, key) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}
export function savePrevisDocument<T extends PrevisWorld | ScenePrevis>(projectId: string, key: string, document: Omit<T, 'revision' | 'updatedAt'>, expectedRevision: number): T {
  return db.transaction(() => {
    const old = readPrevisDocument<T>(projectId, key);
    if (!Number.isSafeInteger(expectedRevision) || (old?.revision || 0) !== expectedRevision) throw Object.assign(new Error('影视城或拍摄方案已在其他窗口更新；当前草稿保留，请核对后重新保存。'), { statusCode: 409 });
    const next = { ...document, revision: expectedRevision + 1, updatedAt: Date.now() } as T;
    db.prepare('INSERT INTO previs_documents (project_id, scope_key, revision, data) VALUES (?, ?, ?, ?) ON CONFLICT(project_id, scope_key) DO UPDATE SET revision = excluded.revision, data = excluded.data').run(projectId, key, next.revision, JSON.stringify(next));
    return next;
  })();
}
export function listPrevisScenes(projectId: string): ScenePrevis[] {
  return (db.prepare("SELECT data FROM previs_documents WHERE project_id = ? AND scope_key LIKE 'scene:%'").all(projectId) as { data: string }[]).map(r => JSON.parse(r.data));
}
