import test from 'node:test';
import assert from 'node:assert/strict';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { currentScriptLoadPolicy, mergeAdoptedScript, mergeCurrentScript, sameScriptContent, ScriptSaveCoordinator } from '../apps/web/src/features/script/scriptSaveCoordinator';
import { applyWorkspacePatch, createWorkspacePatch } from '../packages/script/src/workspacePatch';

function document() {
  const value = createScriptProject('机械自动保存', createScriptCreationProfile('short-film', 1, 3));
  value.revision = 1;
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('autosave and save-before-AI share a serial drain and preserve edits made during a delayed response', async () => {
  let saved = document(), current = structuredClone(saved), active = 0, maxActive = 0;
  current.title = '第一轮输入';
  const writes: Array<{ snapshot: typeof current; reply: ReturnType<typeof deferred<typeof current>> }> = [];
  const state: boolean[] = [];
  const queue = new ScriptSaveCoordinator({
    read: () => current, saved: () => saved, assertWritable() {},
    persist: async snapshot => {
      active++; maxActive = Math.max(active, maxActive);
      const reply = deferred<typeof current>(); writes.push({ snapshot, reply });
      try { return await reply.promise; } finally { active--; }
    },
    committed: (sent, result) => { current = mergeCurrentScript(sent, current, result); saved = result; },
    failed() { assert.fail('unexpected failure'); }, saving: value => state.push(value),
  });
  const automatic = queue.flush(); await turn();
  const beforeAI = queue.flush(); assert.equal(automatic, beforeAI);
  current = { ...current, title: '延迟回执期间的新输入' };
  writes[0].reply.resolve({ ...writes[0].snapshot, revision: 2, updatedAt: 2 });
  await turn();
  assert.equal(writes.length, 2); assert.equal(writes[1].snapshot.title, '延迟回执期间的新输入');
  assert.equal(writes[1].snapshot.revision, 2); assert.equal(maxActive, 1);
  writes[1].reply.resolve({ ...writes[1].snapshot, revision: 3, updatedAt: 3 });
  assert.equal((await beforeAI)!.title, '延迟回执期间的新输入');
  assert.deepEqual(current, saved); assert.deepEqual(state, [true, false]);
  await queue.flush(); assert.equal(writes.length, 2, 'a clean flush makes no redundant PUT');
});

test('a failed request leaves current edits intact and retry saves the latest content', async () => {
  let saved = document(), current = { ...saved, title: '失败前内容' }, fail = true;
  const snapshots: typeof current[] = [], errors: unknown[] = [];
  const queue = new ScriptSaveCoordinator({
    read: () => current, saved: () => saved, assertWritable() {},
    persist: async snapshot => {
      snapshots.push(snapshot);
      if (fail) throw new Error('mechanical network failure');
      return { ...snapshot, revision: snapshot.revision + 1 };
    },
    committed: (sent, result) => { current = mergeCurrentScript(sent, current, result); saved = result; },
    failed: error => { errors.push(error); }, saving() {},
  });
  await assert.rejects(queue.flush(), /network failure/);
  assert.equal(current.title, '失败前内容'); assert.equal(saved.title, '机械自动保存'); assert.equal(errors.length, 1);
  current.title = '失败后继续编辑'; fail = false;
  await queue.flush(); assert.equal(saved.title, '失败后继续编辑'); assert.equal(snapshots.length, 2);
});

test('switching work disposes the old queue so its delayed response cannot update the new editor', async () => {
  const saved = document(), current = { ...saved, title: '旧作品未完成输入' }, reply = deferred<typeof current>();
  let commits = 0, failures = 0;
  const queue = new ScriptSaveCoordinator({
    read: () => current, saved: () => saved, assertWritable() {}, persist: () => reply.promise,
    committed() { commits++; }, failed() { failures++; }, saving() {},
  });
  const pending = queue.flush(); await turn(); queue.dispose();
  reply.resolve({ ...current, revision: 2 });
  assert.equal(await pending, undefined); assert.equal(commits, 0); assert.equal(failures, 0);
  assert.equal(await queue.flush(), undefined);
});

test('conflict or lost editing ownership blocks persistence without modifying the local draft', async () => {
  const saved = document(), current = { ...saved, title: '保留本机内容' };
  let requests = 0;
  const queue = new ScriptSaveCoordinator({
    read: () => current, saved: () => saved, assertWritable() { throw new Error('blocked conflict'); },
    persist: async value => { requests++; return value; }, committed() {}, failed() {}, saving() {},
  });
  await assert.rejects(queue.flush(), /blocked conflict/);
  assert.equal(requests, 0); assert.equal(current.title, '保留本机内容');
});

test('losing fallback ownership preserves uncached edits, and later acquisition still retains them for conflict handling', () => {
  const saved = document(), local = { ...saved, title: '缓存写失败但页面仍有的独有输入' };
  assert.equal(currentScriptLoadPolicy(local, saved, local.id, false), 'wait', 'lock loss must not reload the server over memory');
  assert.equal(currentScriptLoadPolicy(local, saved, local.id, true), 'retain', 'reacquiring ownership must keep the same unsaved memory');
  assert.equal(local.title, '缓存写失败但页面仍有的独有输入');
  assert.equal(currentScriptLoadPolicy(local, saved, 'another-work', true), 'reload');
  assert.equal(currentScriptLoadPolicy(saved, saved, saved.id, true), 'reload', 'a clean waiting tab refreshes the latest work when taking over');
});

test('AI adoption preserves independent later local edits and uses the committed revision', () => {
  const base = document(), local = structuredClone(base), adopted = structuredClone(base);
  local.title = '作者同时改作品名称';
  adopted.units[0].scenes[0].blocks[0].text = 'AI采用正文'; adopted.revision = 2; adopted.updatedAt++;
  const merged = mergeAdoptedScript(base, local, base, adopted);
  assert.equal(merged.title, local.title); assert.equal(merged.units[0].scenes[0].blocks[0].text, 'AI采用正文');
  assert.equal(merged.revision, 2);
  assert.equal(local.units[0].scenes[0].blocks[0].text, ''); assert.equal(adopted.title, base.title);
});

test('same-field adoption conflict keeps both inputs intact instead of replacing local edits', () => {
  const base = document(), local = structuredClone(base), adopted = structuredClone(base);
  local.title = '本机独有修改'; adopted.title = 'AI采用名称'; adopted.revision = 2;
  const before = JSON.stringify({ base, local, adopted });
  assert.throws(() => mergeAdoptedScript(base, local, base, adopted), /冲突|修改|选择/);
  assert.equal(JSON.stringify({ base, local, adopted }), before);
});

test('old adoption receipt passing the dirty document as base still preserves local edits', () => {
  const saved = document(), local = structuredClone(saved), adopted = structuredClone(saved);
  local.title = '恢复后的本机输入'; adopted.brief.concept = '已采用构想'; adopted.revision = 2;
  const merged = mergeAdoptedScript(local, local, saved, adopted);
  assert.equal(merged.title, local.title); assert.equal(merged.brief.concept, '已采用构想');
  const newerSaved = { ...saved, revision: 3 };
  assert.throws(() => mergeAdoptedScript(local, local, newerSaved, adopted), /基线不明确/);
});

test('a captured adoption baseline can resume after reload even when the server already contains the committed AI result', () => {
  const authorBase = document(), adopted = structuredClone(authorBase);
  adopted.brief.concept = '采用已提交、响应曾丢失的构想'; adopted.revision = 2;
  const recovered = structuredClone(authorBase);
  const merged = mergeAdoptedScript(authorBase, recovered, adopted, adopted, true);
  assert.equal(merged.brief.concept, adopted.brief.concept);
  assert.equal(merged.revision, adopted.revision);
  recovered.title = '恢复稿中的独立输入';
  assert.equal(mergeAdoptedScript(authorBase, recovered, adopted, adopted, true).title, recovered.title);
});

for (const overlapping of [false, true]) test(`a delayed adoption preview keeps its frozen author baseline: ${overlapping ? 'same-field conflict' : 'independent later edit'}`, async () => {
  const author = document(), authorBase = structuredClone(author), reply = deferred<typeof author>();
  const preview = reply.promise;
  author.title = '预览等待期间的作者输入';
  const adopted = structuredClone(authorBase); adopted.revision = 2;
  if (overlapping) adopted.title = 'AI也改作品名称';
  else adopted.brief.concept = 'AI采用构想';
  reply.resolve(adopted);
  const result = await preview;
  if (overlapping) {
    assert.throws(() => mergeAdoptedScript(authorBase, author, authorBase, result, true), /冲突|修改|选择/);
    assert.equal(author.title, '预览等待期间的作者输入');
    assert.equal(result.title, 'AI也改作品名称');
  } else {
    const merged = mergeAdoptedScript(authorBase, author, authorBase, result, true);
    assert.equal(merged.title, '预览等待期间的作者输入');
    assert.equal(merged.brief.concept, 'AI采用构想');
  }
});

test('revision and save timestamp do not make an otherwise identical current draft dirty', () => {
  const saved = document();
  assert.equal(sameScriptContent(saved, { ...saved, revision: 55, updatedAt: saved.updatedAt + 100 }), true);
  assert.equal(sameScriptContent(saved, { ...saved, title: '实际修改' }), false);
});

test('an unchanged patch reconstructed by the parser does not trigger another autosave', async () => {
  const saved = document();
  const current = applyWorkspacePatch({ ...saved, revision: 2 }, createWorkspacePatch(saved, saved));
  assert.notEqual(JSON.stringify(current), JSON.stringify(saved), 'the real parser changes object key order and metadata');
  assert.equal(sameScriptContent(current, saved), true);
  let requests = 0;
  const queue = new ScriptSaveCoordinator({
    read: () => current, saved: () => saved, assertWritable() {},
    persist: async value => { requests++; return value; }, committed() {}, failed() {}, saving() {},
  });
  assert.deepEqual(await queue.flush(), saved);
  assert.equal(requests, 0);
});
