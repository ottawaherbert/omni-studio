import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { flushScriptForHandoff, mergeCurrentScript, ScriptSaveCoordinator } from '../apps/web/src/features/script/scriptSaveCoordinator';

const project = () => createScriptProject('交接保存验收', createScriptCreationProfile('short-film', 1, 3));
const edit = (source: ReturnType<typeof project>, text: string) => {
  const next = structuredClone(source);
  next.units[0].scenes[0].blocks[0].text = text;
  return next;
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test('handoff waits for the save queue and a further edit made during its first request', async () => {
  let saved = project();
  let current = edit(saved, '第一处未保存正文');
  const firstSave = deferred();
  const firstStarted = deferred();
  let writes = 0;
  let navigated = false;
  const coordinator = new ScriptSaveCoordinator({
    read: () => current,
    saved: () => saved,
    assertWritable: () => {},
    persist: async (snapshot) => {
      writes += 1;
      if (writes === 1) { firstStarted.resolve(); await firstSave.promise; }
      return { ...snapshot, revision: saved.revision + 1, updatedAt: Date.now() };
    },
    committed: (sent, result) => { current = mergeCurrentScript(sent, current, result); saved = result; },
    failed: () => {}, saving: () => {},
  });
  const handoff = flushScriptForHandoff({ projectId: saved.id, readCurrent: () => current, readSaved: () => saved,
    flush: () => coordinator.flush(), canEdit: true }).then(() => { navigated = true; });
  await firstStarted.promise;
  assert.equal(navigated, false);
  current = edit(current, '保存过程中又编辑的正文');
  firstSave.resolve();
  await handoff;
  assert.equal(writes, 2);
  assert.equal(saved.units[0].scenes[0].blocks[0].text, '保存过程中又编辑的正文');
  assert.equal(navigated, true);
});

test('failed handoff save retains the local edit and does not navigate', async () => {
  const saved = project();
  const current = edit(saved, '失败后仍在本机');
  let navigated = false;
  const coordinator = new ScriptSaveCoordinator({
    read: () => current, saved: () => saved, assertWritable: () => {},
    persist: async () => { throw new Error('模拟保存失败'); },
    committed: () => { throw new Error('must not commit'); },
    failed: () => {}, saving: () => {},
  });
  await assert.rejects(
    flushScriptForHandoff({ projectId: saved.id, readCurrent: () => current, readSaved: () => saved,
      flush: () => coordinator.flush(), canEdit: true }).then(() => { navigated = true; }),
    /模拟保存失败/,
  );
  assert.equal(navigated, false);
  assert.equal(current.units[0].scenes[0].blocks[0].text, '失败后仍在本机');
  assert.equal(saved.units[0].scenes[0].blocks[0].text, '');
});

test('read-only page cannot hand off an unsaved local draft', async () => {
  const saved = project();
  const current = edit(saved, '未保存正文');
  await assert.rejects(flushScriptForHandoff({ projectId: saved.id, readCurrent: () => current, readSaved: () => saved,
    flush: async () => { throw new Error('must not flush'); }, canEdit: false }), /无法保存/);
});
