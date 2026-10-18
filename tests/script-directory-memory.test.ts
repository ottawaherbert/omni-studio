import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { Root } from 'react-dom/client';
import type { DirectoryMemoryEvent, DirectoryMemorySnapshot } from './fixtures/script-directory-memory';

type FixtureSession = {
  window: JSDOM['window']; document: Document;
  data: () => DirectoryMemorySnapshot; events: () => DirectoryMemoryEvent[];
};

async function withFixture(run: (fixture: FixtureSession) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/', pretendToBeVisual: true,
  });
  const window = dom.window, document = window.document;
  const values: Record<string, unknown> = {
    window, document, navigator: window.navigator,
    Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement, HTMLTextAreaElement: window.HTMLTextAreaElement,
    Event: window.Event, MouseEvent: window.MouseEvent, FocusEvent: window.FocusEvent,
    MutationObserver: window.MutationObserver, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const before = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let root: Root | undefined;
  try {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    // Initialize ReactDOM after the globals so its delegated input events are enabled.
    const { createRoot } = await import('react-dom/client');
    const { ScriptDirectoryMemoryFixture } = await import('./fixtures/script-directory-memory');
    root = createRoot(document.getElementById('root')!);
    await act(async () => { root!.render(React.createElement(ScriptDirectoryMemoryFixture)); });
    await run({
      window, document,
      data: () => JSON.parse(document.getElementById('fixture-current-data')!.textContent!) as DirectoryMemorySnapshot,
      events: () => JSON.parse(document.getElementById('fixture-change-log')!.textContent!) as DirectoryMemoryEvent[],
    });
  } finally {
    try { if (root) await act(async () => { root!.unmount(); }); }
    finally {
      window.close();
      for (const [key, descriptor] of before) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
}

function query<T extends Element>(fixture: FixtureSession, selector: string): T {
  const element = fixture.document.querySelector<T>(selector);
  assert.ok(element, `Missing fixture element: ${selector}`);
  return element;
}
async function clickButton(fixture: FixtureSession, label: string) {
  const button = Array.from(fixture.document.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  assert.ok(button, `Missing fixture button: ${label}`);
  await act(async () => { button.click(); });
}
async function openDirectory(fixture: FixtureSession) {
  await clickButton(fixture, '目录管理与篇幅设置');
  const directory = query<HTMLDetailsElement>(fixture, 'details.script-structure-editor');
  await act(async () => { directory.querySelector('summary')!.click(); });
  assert.equal(directory.open, true, 'the real directory disclosure must open');
  const edit = Array.from(directory.querySelectorAll('summary')).find((item) => item.textContent?.trim() === '编辑');
  assert.ok(edit, 'the node edit disclosure must exist');
  await act(async () => { edit.click(); });
  assert.equal(edit.parentElement?.hasAttribute('open'), true, 'the real node edit disclosure must open');
}
async function typeValue(fixture: FixtureSession, element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof fixture.window.HTMLTextAreaElement
    ? fixture.window.HTMLTextAreaElement.prototype : fixture.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  assert.ok(setter, 'the native DOM value setter must exist');
  await act(async () => {
    element.focus(); setter.call(element, value);
    element.dispatchEvent(new fixture.window.Event('input', { bubbles: true }));
  });
  assert.equal(element.value, value, 'React must retain the typed value after its input update');
}
async function blur(element: HTMLInputElement | HTMLTextAreaElement) {
  // Native focus/blur emit focusout, which React actually delegates for onBlur.
  await act(async () => { element.focus(); });
  await act(async () => { element.blur(); });
}

test('same-ID adopted directory fields replace old values and a later blur cannot overwrite the adopted author document', { concurrency: false }, async () => {
  await withFixture(async (fixture) => {
    await openDirectory(fixture);
    const title = query<HTMLInputElement>(fixture, 'input[aria-label^="修改"]');
    const purpose = query<HTMLTextAreaElement>(fixture, 'textarea[aria-label$="段落安排"]');
    await typeValue(fixture, title, '作者手改旧名称'); await blur(title);
    assert.equal(fixture.data().nodes[0].title, '作者手改旧名称', 'real onBlur must update the author document');
    await typeValue(fixture, purpose, '作者手改旧安排'); await blur(purpose);
    assert.equal(fixture.data().nodes[0].purpose, '作者手改旧安排', 'real textarea onBlur must update the author document');
    assert.equal(fixture.events().filter((event) => event.kind === 'author-update').length, 2);

    const beforeAdopt = fixture.data();
    await clickButton(fixture, '目录管理与篇幅设置');
    assert.ok(title.closest('.hidden'), 'folding must hide the directory settings');
    assert.equal(query(fixture, 'input[aria-label^="修改"]'), title, 'folding must keep the actual editor mounted');
    await clickButton(fixture, '采用同ID新目录内容');
    await clickButton(fixture, '目录管理与篇幅设置');
    const adopted = fixture.data();
    assert.equal(adopted.projectId, beforeAdopt.projectId); assert.equal(adopted.unitId, beforeAdopt.unitId);
    assert.equal(adopted.nodes[0].id, beforeAdopt.nodes[0].id); assert.equal(adopted.revision, beforeAdopt.revision + 1);
    assert.equal(adopted.nodes[0].title, '已采用新名称 v1');
    assert.equal(adopted.nodes[0].purpose, '已采用新安排 v1');
    assert.equal(title.value, adopted.nodes[0].title, 'the rendered title must synchronize with the adopted value');
    assert.equal(purpose.value, adopted.nodes[0].purpose, 'the rendered purpose must synchronize with the adopted value');
    const eventsBeforeBlur = fixture.events();
    await blur(title); await blur(purpose);
    assert.deepEqual(fixture.data(), adopted, 'focus/blur alone must preserve the entire adopted snapshot');
    assert.deepEqual(fixture.events(), eventsBeforeBlur, 'unchanged adopted fields must not emit update callbacks');
  });
});

test('unsubmitted new-node draft survives fold/unfold and resets when unit or project ownership changes', { concurrency: false }, async () => {
  await withFixture(async (fixture) => {
    await openDirectory(fixture);
    const draft = query<HTMLInputElement>(fixture, 'input[aria-label="新增幕或段落名称"]');
    const initial = fixture.data();
    await typeValue(fixture, draft, '保留的新增名称草稿');
    await clickButton(fixture, '目录管理与篇幅设置'); await clickButton(fixture, '目录管理与篇幅设置');
    assert.equal(query(fixture, 'input[aria-label="新增幕或段落名称"]'), draft);
    assert.equal(draft.value, '保留的新增名称草稿');
    assert.deepEqual(fixture.data(), initial, 'unsubmitted input must not create or alter a node');
    assert.deepEqual(fixture.events(), [], 'folding must not emit document update callbacks');

    await clickButton(fixture, '切换单元');
    const otherUnit = fixture.data();
    assert.notEqual(otherUnit.unitId, initial.unitId); assert.equal(otherUnit.projectId, initial.projectId);
    const otherDraft = query<HTMLInputElement>(fixture, 'input[aria-label="新增幕或段落名称"]');
    assert.equal(otherDraft.value, '', 'a new unit must not inherit the prior unit draft');
    assert.equal(draft.isConnected, false, 'the prior unit editor must be unmounted');
    await typeValue(fixture, otherDraft, '第二集尚未提交的名称');
    await clickButton(fixture, '切换作品（同unitID）');
    const otherProject = fixture.data();
    assert.notEqual(otherProject.projectId, otherUnit.projectId);
    assert.equal(otherProject.unitId, otherUnit.unitId, 'keep the same unit ID for the project isolation check');
    assert.equal(query<HTMLInputElement>(fixture, 'input[aria-label="新增幕或段落名称"]').value, '', 'a new project must not inherit a same-ID unit draft');
    assert.equal(otherDraft.isConnected, false);
    assert.equal(fixture.events().filter((event) => event.kind === 'author-update').length, 0);
  });
});
