import { parseScriptProject, type ScriptProject } from '../../../../../packages/script/src/schema';
import { sha256 } from 'js-sha256';
import { stableJson } from '../../../../../packages/agent-core/src/identity';

export type ScriptDraftSnapshot = { key: string; id: string; project: ScriptProject; updatedAt: number; raw: string };
export class ScriptRecoveryConflict extends Error {}

const legacyKey = (projectId: string) => `omni.script.draft.${projectId}`;
const legacyPrefix = (projectId: string) => `omni.script.draft.v2.${encodeURIComponent(projectId)}.`;
const reviewedKey = (projectId: string) => `omni.script.recovery.reviewed.${encodeURIComponent(projectId)}`;
export const scriptRecoveryKey = (projectId: string) => `omni.script.recovery.current.${encodeURIComponent(projectId)}`;
export const scriptRecoveryWriterKey = (projectId: string) => `omni.script.recovery.writer.${encodeURIComponent(projectId)}`;

export function ownsScriptRecoveryLease(storage: Storage, projectId: string, ownerId: string, now = Date.now()): boolean {
  try {
    const value = JSON.parse(storage.getItem(scriptRecoveryWriterKey(projectId)) || 'null');
    return value?.id === ownerId && typeof value.until === 'number' && value.until > now;
  } catch { return false; }
}

const content = ({ revision: _revision, updatedAt: _updatedAt, ...project }: ScriptProject) => stableJson(project);
function decode(key: string, raw: string | null, projectId: string, legacy = false): ScriptDraftSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw), project = parseScriptProject(legacy ? value : value.project);
    if (project.id !== projectId || (!legacy && (typeof value.id !== 'string' || !Number.isSafeInteger(value.updatedAt)))) return null;
    return { key, raw, project, id: legacy ? 'legacy' : value.id, updatedAt: legacy ? 0 : value.updatedAt };
  } catch { return null; }
}

export function readScriptRecovery(storage: Storage, projectId: string): ScriptDraftSnapshot | null {
  const key = scriptRecoveryKey(projectId);
  return decode(key, storage.getItem(key), projectId);
}

/** One current recovery slot. A stale editor may never replace an unobserved write. */
export function putScriptRecovery(storage: Storage, project: ScriptProject, ownerId: string,
  expected: Pick<ScriptDraftSnapshot, 'key' | 'raw'> | null, updatedAt = Date.now()): ScriptDraftSnapshot {
  const key = scriptRecoveryKey(project.id);
  if ((expected && expected.key !== key) || storage.getItem(key) !== (expected?.raw ?? null)) {
    throw new ScriptRecoveryConflict('另一页面已更新本机恢复稿，当前修改仍在页面中。');
  }
  const raw = JSON.stringify({ id: ownerId, updatedAt, project });
  storage.setItem(key, raw);
  return { key, raw, id: ownerId, project, updatedAt };
}

export function removeScriptRecoveryIfSame(storage: Storage, snapshot: Pick<ScriptDraftSnapshot, 'key' | 'raw'>): boolean {
  if (storage.getItem(snapshot.key) !== snapshot.raw) return false;
  storage.removeItem(snapshot.key);
  return true;
}

/** Old independent drafts are migration evidence, never another editable version list. */
export function readLegacyScriptRecoveries(storage: Storage, server: ScriptProject): ScriptDraftSnapshot[] {
  let reviewed: string[] = [];
  try { const value = JSON.parse(storage.getItem(reviewedKey(server.id)) || '[]'); if (Array.isArray(value)) reviewed = value; } catch {}
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === legacyKey(server.id) || key?.startsWith(legacyPrefix(server.id))) keys.push(key);
  }
  const seen = new Set([content(server)]);
  return keys.flatMap(key => {
    const raw = storage.getItem(key);
    if (!raw || reviewed.includes(sha256(raw))) return [];
    const snapshot = decode(key, raw, server.id, key === legacyKey(server.id));
    return snapshot ? [snapshot] : [];
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key)).filter(snapshot => {
    const value = content(snapshot.project);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** A recovery decision acknowledges the exact old bytes without deleting them. */
export function acknowledgeLegacyScriptRecovery(storage: Storage, snapshot: ScriptDraftSnapshot): void {
  const key = reviewedKey(snapshot.project.id);
  let reviewed: string[] = [];
  try { const value = JSON.parse(storage.getItem(key) || '[]'); if (Array.isArray(value)) reviewed = value; } catch {}
  const duplicates = [sha256(snapshot.raw)];
  for (let index = 0; index < storage.length; index++) {
    const candidateKey = storage.key(index);
    if (candidateKey !== legacyKey(snapshot.project.id) && !candidateKey?.startsWith(legacyPrefix(snapshot.project.id))) continue;
    const raw = storage.getItem(candidateKey), candidate = decode(candidateKey, raw, snapshot.project.id, candidateKey === legacyKey(snapshot.project.id));
    if (candidate && content(candidate.project) === content(snapshot.project)) duplicates.push(sha256(candidate.raw));
  }
  storage.setItem(key, JSON.stringify([...new Set([...reviewed, ...duplicates])]));
}

/** Only the explicit delete-work action removes its recovery material. */
export function removeAllScriptDrafts(storage: Storage, projectId: string): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === legacyKey(projectId) || key?.startsWith(legacyPrefix(projectId))) keys.push(key);
  }
  for (const key of [...keys, scriptRecoveryKey(projectId), scriptRecoveryWriterKey(projectId), reviewedKey(projectId)]) storage.removeItem(key);
}
