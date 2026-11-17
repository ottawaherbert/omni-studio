import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptDelivery } from '../packages/script/src/exporters';
import { createLegacyProductionProjectFromWritingSource } from '../src/services/production/writingExportLegacyAdapter';
import {
  currentProductionScriptRevision,
  prepareReviewedWritingScriptSync,
  previewWritingScriptConflictResolution,
  previewWritingScriptSync,
} from '../src/services/production/productionScriptWorkspace';
import type { Episode } from '../src/types/project';

const fixture = () => {
  const script = createScriptProject('来源比较', createScriptCreationProfile('short-film', 1, 1));
  script.units[0].scenes[0].blocks[0].text = '原稿中的钥匙留在桌上。';
  script.revision = 1;
  script.updatedAt = 100;
  const project = createLegacyProductionProjectFromWritingSource({ package: createScriptDelivery(script), productionProjectId: 'sync-review', importId: 'source-import', importedAt: 100 });
  script.units[0].scenes[0].blocks[0].text = '已展示更新：来访者归还钥匙。';
  script.revision = 2;
  script.updatedAt = 200;
  return { project, source: createScriptDelivery(script), workspace: project.productionScriptWorkspace! };
};

test('reviewed source sync refuses unseen author or production revisions and preserves its inputs', () => {
  const { project, source, workspace } = fixture();
  const reviewed = previewWritingScriptSync(project, workspace, source, 300);
  const before = structuredClone({ project, workspace, reviewed });
  const changedSource = structuredClone(source);
  changedSource.units[0].prose = '未展示的新作者更新。';
  // A payload change must be caught even if the advertised revision is unchanged.
  assert.throws(() => prepareReviewedWritingScriptSync(project, workspace, changedSource, reviewed), /源剧本已更新/);
  assert.throws(() => prepareReviewedWritingScriptSync(project, { ...workspace, currentRevisionId: 'another-revision' }, source, reviewed), /制片剧本已更新/);
  assert.throws(() => prepareReviewedWritingScriptSync(project, { ...workspace, syncStatus: 'conflict' }, source, reviewed), /制片剧本已更新/);
  assert.deepEqual({ project, workspace, reviewed }, before);
  const current = structuredClone(project);
  (current.episodes[0] as Episode).scenes = [{ id: 'new-production-scene', title: '新保存的场次', sceneNumber: '1', description: '', valueCharge: 'neutral', shots: [] }];
  const accepted = prepareReviewedWritingScriptSync(current, workspace, source, reviewed, 400);
  assert.match(currentProductionScriptRevision(accepted.workspace)!.units[0].content, /已展示更新/);
  assert.equal((accepted.episodes[0] as Episode).scenes![0].id, 'new-production-scene', 'safe attachment rebasing must preserve production saved since preview');
});

test('conflict resolution previews the exact author source and applies the same revision guard', () => {
  const { project, source, workspace } = fixture();
  const conflicted = { ...workspace, syncStatus: 'conflict' as const };
  const reviewed = previewWritingScriptConflictResolution(project, conflicted, source, 300);
  assert.equal(reviewed.baseSyncStatus, 'conflict');
  assert.equal(reviewed.resolvesConflict, true);
  assert.equal(conflicted.syncStatus, 'conflict', 'opening the comparison must not resolve anything');
  const changedSource = { ...source, sourceRevision: 3, exportedAt: 301 };
  assert.throws(() => prepareReviewedWritingScriptSync(project, conflicted, changedSource, reviewed), /源剧本已更新/);
  assert.throws(() => prepareReviewedWritingScriptSync(project, workspace, source, reviewed), /制片剧本已更新/);
  const accepted = prepareReviewedWritingScriptSync(project, conflicted, source, reviewed, 400);
  assert.equal(accepted.workspace.syncStatus, 'current');
  assert.equal(accepted.workspace.authority, 'writing');
  assert.match(currentProductionScriptRevision(accepted.workspace)!.units[0].content, /已展示更新/);
});

test('the visible sync and conflict actions never save an author change made after comparison', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: toast } = await import('react-hot-toast');
  const { ProductionSourceOverviewWorkspace } = await import('../src/components/production/preparation/ProductionSourceOverviewWorkspace');
  const { scriptClient } = await import('../apps/web/src/clients/scriptClient');
  const { legacyProjectClient } = await import('../src/clients/legacyProjectClient');
  const originals = { exportPackage: scriptClient.exportPackage, get: legacyProjectClient.getProductionScriptWorkspace,
    patch: legacyProjectClient.patchProductionScriptWorkspace, error: toast.error };
  const { project, source, workspace } = fixture();
  let currentSource = source;
  let currentWorkspace = workspace;
  let writes = 0;
  const errors: string[] = [];
  scriptClient.exportPackage = async () => ({ package: currentSource });
  legacyProjectClient.getProductionScriptWorkspace = async () => currentWorkspace;
  legacyProjectClient.patchProductionScriptWorkspace = async () => { writes++; throw new Error('Unexpected save'); };
  toast.error = (message) => { errors.push(String(message)); return 'fixture-error'; };
  const root = createRoot(document.getElementById('root')!);
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(label));
    assert.ok(button, `Missing action: ${label}`);
    await act(async () => button.click());
  };
  const render = () => <MemoryRouter><ProductionSourceOverviewWorkspace key={currentWorkspace.syncStatus} project={{ ...project, productionScriptWorkspace: currentWorkspace }} episode={project.episodes[0] as Episode} updateProject={async () => { writes++; }} onOpenScene={() => {}} /></MemoryRouter>;
  try {
    await act(async () => root.render(render()));
    await click('检查剧本更新');
    currentSource = { ...source, sourceRevision: 3, exportedAt: 400 };
    await click('采用剧本更新');
    assert.equal(writes, 0);
    assert.match(errors.at(-1)!, /预览后源剧本已更新/);
    currentWorkspace = { ...workspace, syncStatus: 'conflict' };
    currentSource = source;
    await act(async () => root.render(render()));
    await click('处理制片改稿');
    await click('查看剧本工作台版本');
    assert.equal(writes, 0, 'selecting the source side opens its comparison before any adoption');
    currentSource = { ...source, sourceRevision: 3, exportedAt: 400 };
    await click('采用剧本更新');
    assert.equal(writes, 0);
    assert.match(errors.at(-1)!, /预览后源剧本已更新/);
  } finally {
    await act(async () => root.unmount());
    scriptClient.exportPackage = originals.exportPackage;
    legacyProjectClient.getProductionScriptWorkspace = originals.get;
    legacyProjectClient.patchProductionScriptWorkspace = originals.patch;
    toast.error = originals.error;
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('local editing and source sync are mutually exclusive before delayed recovery writes and across awaits', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { default: toast } = await import('react-hot-toast');
  const { ProductionSourceOverviewWorkspace } = await import('../src/components/production/preparation/ProductionSourceOverviewWorkspace');
  const { scriptClient } = await import('../apps/web/src/clients/scriptClient');
  const { legacyProjectClient } = await import('../src/clients/legacyProjectClient');
  const originals = { exportPackage: scriptClient.exportPackage, get: legacyProjectClient.getProductionScriptWorkspace,
    patch: legacyProjectClient.patchProductionScriptWorkspace, error: toast.error };
  const { project, source, workspace } = fixture();
  let reads = 0, writes = 0;
  const errors: string[] = [];
  let releaseRead: (() => void) | undefined;
  let delayRead = false;
  scriptClient.exportPackage = async () => ({ package: source });
  legacyProjectClient.getProductionScriptWorkspace = async () => {
    reads++;
    if (delayRead) await new Promise<void>((resolve) => { releaseRead = resolve; });
    return workspace;
  };
  legacyProjectClient.patchProductionScriptWorkspace = async () => { writes++; throw new Error('fixture save failure'); };
  toast.error = (message) => { errors.push(String(message)); return 'fixture-error'; };
  dom.window.confirm = () => true;
  const root = createRoot(document.getElementById('root')!);
  const button = (label: string) => {
    const found = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
    assert.ok(found, `Missing action: ${label}`);
    return found;
  };
  const bodyEditor = () => document.querySelector('textarea[placeholder="直接输入或粘贴剧本正文"]') as HTMLTextAreaElement | null;
  const enterBody = async (content: string) => act(async () => {
    const field = bodyEditor()!;
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, content);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  try {
    await act(async () => root.render(<MemoryRouter><ProductionSourceOverviewWorkspace project={project} episode={project.episodes[0] as Episode} updateProject={async () => { writes++; }} onOpenScene={() => {}} /></MemoryRouter>));
    // Both handlers come from the same render, before disabled props can update.
    await act(async () => { button('编辑当前剧本').click(); button('检查剧本更新').click(); });
    assert.equal(reads, 0, 'handler guard must protect the same-event edit/check race');
    assert.match(errors.at(-1)!, /先保存或取消当前剧本编辑/);
    const dirtyText = '尚未来得及缓存的人工修订。';
    await enterBody(dirtyText);
    assert.equal(localStorage.length, 0, 'exercise the interval before the 500 ms recovery timer');
    assert.equal(button('检查剧本更新').disabled, true);
    await act(async () => button('检查剧本更新').click());
    assert.equal(reads, 0);
    assert.equal(bodyEditor()!.value, dirtyText);
    await act(async () => button('保存剧本').click());
    assert.equal(writes, 1);
    assert.match(document.body.textContent || '', /保存失败.*fixture save failure/);
    assert.equal(bodyEditor()!.value, dirtyText, 'failed save must keep the draft in the editor');
    assert.match(localStorage.getItem(`production-script-editor-recovery:${project.id}:${project.productionSourceDocuments![0].id}`) || '', /尚未来得及缓存的人工修订/);
    assert.equal(button('检查剧本更新').disabled, true);
    await act(async () => button('取消').click());

    // Check holds a synchronous mutex until its async reads have finished.
    delayRead = true;
    await act(async () => { button('检查剧本更新').click(); button('编辑当前剧本').click(); });
    assert.equal(bodyEditor(), null);
    assert.equal(button('编辑当前剧本').disabled, true);
    delayRead = false;
    await act(async () => releaseRead!());
    assert.ok(button('采用剧本更新'));

    const beforeApplyReads = reads;
    await act(async () => { button('编辑当前剧本').click(); button('采用剧本更新').click(); });
    assert.equal(reads, beforeApplyReads, 'adoption also checks the live edit guard before any request');
    assert.equal(writes, 1);
    assert.equal(button('采用剧本更新').disabled, true);
    assert.ok(button('恢复草稿'), 'the failed-save draft remains recoverable');
    await act(async () => button('恢复草稿').click());
    assert.equal(bodyEditor()!.value, dirtyText);
    await act(async () => button('取消').click());

    delayRead = true;
    await act(async () => { button('采用剧本更新').click(); button('编辑当前剧本').click(); });
    assert.equal(bodyEditor(), null, 'cannot start a new edit while adoption is awaiting source data');
    assert.equal(button('编辑当前剧本').disabled, true);
    delayRead = false;
    await act(async () => releaseRead!());
    assert.equal(writes, 2);
    assert.equal(button('编辑当前剧本').disabled, false, 'failed source sync releases the edit guard');
    await act(async () => button('编辑当前剧本').click());
    await act(async () => button('恢复草稿').click());
    assert.equal(bodyEditor()!.value, dirtyText, 'failed source sync cannot delete the prior local draft');
  } finally {
    releaseRead?.();
    await act(async () => root.unmount());
    scriptClient.exportPackage = originals.exportPackage;
    legacyProjectClient.getProductionScriptWorkspace = originals.get;
    legacyProjectClient.patchProductionScriptWorkspace = originals.patch;
    toast.error = originals.error;
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});
