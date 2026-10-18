import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { acknowledgeLegacyScriptRecovery, ownsScriptRecoveryLease, readLegacyScriptRecoveries, readScriptRecovery, putScriptRecovery, removeScriptRecoveryIfSame, ScriptRecoveryConflict, scriptRecoveryKey, scriptRecoveryWriterKey } from '../apps/web/src/features/script/scriptDraftCache';
import { applyWorkspacePatch, createWorkspacePatch } from '../packages/script/src/workspacePatch';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const project = () => createScriptProject('机械恢复内容', createScriptCreationProfile('short-film', 1, 3));
function old(storage: Storage, value: ReturnType<typeof project>, id: string, updatedAt = 1) {
  const key = `omni.script.draft.v2.${encodeURIComponent(value.id)}.${id}`;
  const raw = JSON.stringify({ id, updatedAt, project: value });
  storage.setItem(key, raw); return { key, raw };
}

test('each work has one current recovery slot and successive edits update that slot', () => {
  const storage = new MemoryStorage(), value = project();
  const first = putScriptRecovery(storage, value, 'page-A', null, 1);
  value.title = '后续编辑';
  const second = putScriptRecovery(storage, value, 'page-A', first, 2);
  assert.equal(first.key, second.key); assert.equal(storage.length, 1);
  assert.equal(readScriptRecovery(storage, value.id)!.project.title, '后续编辑');
  assert.equal(second.key, scriptRecoveryKey(value.id));
});

test('an earlier save cannot erase or replace newer recovery content', () => {
  const storage = new MemoryStorage(), value = project();
  const first = putScriptRecovery(storage, value, 'page-A', null, 1);
  value.title = '延迟响应期间的新编辑';
  const second = putScriptRecovery(storage, value, 'page-A', first, 2);
  assert.equal(removeScriptRecoveryIfSame(storage, first), false);
  assert.throws(() => putScriptRecovery(storage, value, 'page-A', first), ScriptRecoveryConflict);
  assert.equal(storage.getItem(second.key), second.raw);
});

test('a competing tab cannot overwrite a recovery write it has not observed', () => {
  const storage = new MemoryStorage(), value = project();
  const first = putScriptRecovery(storage, value, 'page-A', null, 1);
  const other = structuredClone(value); other.title = '另一页面';
  assert.throws(() => putScriptRecovery(storage, other, 'page-B', null), ScriptRecoveryConflict);
  assert.equal(storage.getItem(first.key), first.raw);
  const takeover = putScriptRecovery(storage, other, 'page-B', first, 2);
  assert.equal(removeScriptRecoveryIfSame(storage, first), false);
  assert.equal(readScriptRecovery(storage, value.id)!.id, 'page-B');
  assert.equal(removeScriptRecoveryIfSame(storage, takeover), true);
});

test('fallback editing ownership expires and a former owner cannot mutate between heartbeat checks', () => {
  const storage = new MemoryStorage(), value = project(), key = scriptRecoveryWriterKey(value.id);
  storage.setItem(key, JSON.stringify({ id: 'page-A', until: 100 }));
  assert.equal(ownsScriptRecoveryLease(storage, value.id, 'page-A', 99), true);
  assert.equal(ownsScriptRecoveryLease(storage, value.id, 'page-A', 100), false);
  storage.setItem(key, JSON.stringify({ id: 'page-B', until: 200 }));
  assert.equal(ownsScriptRecoveryLease(storage, value.id, 'page-A', 101), false);
  assert.equal(ownsScriptRecoveryLease(storage, value.id, 'page-B', 101), true);
});

test('unique legacy content is recoverable, duplicate saves and current content are ignored', () => {
  const storage = new MemoryStorage(), server = project(), recover = structuredClone(server);
  recover.title = '旧版独有内容'; old(storage, recover, 'A');
  recover.revision = 99; recover.updatedAt++; old(storage, recover, 'B', 2);
  old(storage, server, 'same');
  const entries = readLegacyScriptRecoveries(storage, server);
  assert.equal(entries.length, 1); assert.equal(entries[0].project.title, '旧版独有内容');
  assert.equal(entries[0].updatedAt, 2, 'the newest duplicate supplies the correct recovery baseline');
  assert.equal(storage.length, 3, 'migration never deletes old bytes');
  acknowledgeLegacyScriptRecovery(storage, entries[0]);
  assert.deepEqual(readLegacyScriptRecoveries(storage, server), [], 'acknowledgement covers identical legacy copies without presenting them again');
});

test('parser-reconstructed legacy content is not offered again solely because object keys were reordered', () => {
  const storage = new MemoryStorage(), server = project();
  const same = applyWorkspacePatch(server, createWorkspacePatch(server, server));
  old(storage, same, 'parsed');
  assert.deepEqual(readLegacyScriptRecoveries(storage, server), []);
  assert.equal(storage.length, 1, 'the old bytes remain untouched');
});

test('multiple different legacy recoveries stay intact; one-time acknowledgement hides only exact old bytes', () => {
  const storage = new MemoryStorage(), server = project(), a = structuredClone(server), b = structuredClone(server);
  a.title = '旧版独有A'; b.title = '旧版独有B';
  const originalA = old(storage, a, 'A'), originalB = old(storage, b, 'B');
  const entries = readLegacyScriptRecoveries(storage, server); assert.equal(entries.length, 2);
  acknowledgeLegacyScriptRecovery(storage, entries.find(item => item.key === originalA.key)!);
  assert.deepEqual(readLegacyScriptRecoveries(storage, server).map(item => item.project.title), ['旧版独有B']);
  assert.equal(storage.getItem(originalA.key), originalA.raw); assert.equal(storage.getItem(originalB.key), originalB.raw);
  a.title = 'A后来追加的独有内容'; old(storage, a, 'A', 3);
  assert.equal(readLegacyScriptRecoveries(storage, server).length, 2);
});

test('legacy single-slot draft is preserved and corrupt or foreign legacy entries do not become current', () => {
  const storage = new MemoryStorage(), server = project(), recover = structuredClone(server);
  recover.title = '最早格式的内容';
  const key = `omni.script.draft.${server.id}`, raw = JSON.stringify(recover); storage.setItem(key, raw);
  storage.setItem(`omni.script.draft.v2.${encodeURIComponent(server.id)}.broken`, '{');
  const foreign = project(); old(storage, foreign, 'foreign');
  assert.deepEqual(readLegacyScriptRecoveries(storage, server).map(item => item.project.title), ['最早格式的内容']);
  assert.equal(storage.getItem(key), raw);
  storage.setItem(scriptRecoveryKey(server.id), '{');
  assert.equal(readScriptRecovery(storage, server.id), null);
  assert.throws(() => putScriptRecovery(storage, server, 'A', null), ScriptRecoveryConflict);
  const observed = { key: scriptRecoveryKey(server.id), raw: '{' };
  storage.setItem(observed.key, 'new unparsed recovery');
  assert.equal(removeScriptRecoveryIfSame(storage, observed), false, 'even an explicit raw-recovery decision cannot remove later bytes');
  assert.equal(removeScriptRecoveryIfSame(storage, { ...observed, raw: 'new unparsed recovery' }), true);
});
