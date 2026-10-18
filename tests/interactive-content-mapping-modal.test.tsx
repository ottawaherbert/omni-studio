import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { InteractiveWritingSceneOption, NarrativeNode, NodeContentBinding } from '../apps/web/src/clients/interactiveProductionClient.ts';
import type { ContentMappingChange } from '../src/components/interactive/InteractiveContentMappingModal.tsx';

const scene = (id: string): InteractiveWritingSceneOption => ({
  ref: { artifactId: id, versionId: 'v1', kind: 'script_scene', checksum: `checksum-${id}` },
  writingProjectId: 'writing-1', writingProjectTitle: '手稿', writingProjectRevision: 2,
  unitId: 'unit-1', unitIndex: 1, unitTitle: '第一章', sceneId: id, sceneIndex: Number(id.slice(-1)),
  sceneTitle: `场次 ${id}`, synopsis: `摘要 ${id}`, characters: [],
  scriptBlocks: [{ type: 'action', content: `正文 ${id}` }],
});
const node = (id: string): NarrativeNode => ({ id, brief: { nodeId: id, title: id, intent: `意图 ${id}`, dramaticFunction: 'choice_point', narrativeSummary: '' }, contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [] });

test('partial mapping preserves ordered existing scene refs and requires reviewed content', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/', pretendToBeVisual: true });
  const globals: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { InteractiveContentMappingModal } = await import('../src/components/interactive/InteractiveContentMappingModal.tsx');
  const root = createRoot(document.getElementById('root')!);
  const scenes = [scene('scene-1'), scene('scene-2'), scene('scene-3')];
  const bindings = [{ nodeId: 'node-a', slot: 'main', scriptSceneRefs: scenes.slice(0, 2).map((item) => item.ref) }] as NodeContentBinding[];
  const confirmed: ContentMappingChange[][] = [];
  const render = () => <InteractiveContentMappingModal isOpen nodes={[node('node-a'), node('node-b')]} scenes={scenes.map((item) => ({ ...item, scriptBlocks: undefined }))} bindings={bindings} loadScenes={async (nodeId) => nodeId ? scenes.slice(0, 2) : scenes} onClose={() => {}} onConfirm={async (changes) => { confirmed.push(changes); }} />;
  try {
    await act(async () => root.render(render()));
    assert.match(document.body.textContent || '', /正文 scene-1/);
    assert.match(document.body.textContent || '', /正文 scene-2/);
    await act(async () => (document.querySelector('[aria-label="node-a重新核对正文"]') as HTMLButtonElement).click());
    assert.equal(document.querySelectorAll('input[type="checkbox"]').length, 2, 'existing refs can be reviewed without removing and re-adding them');
    const add = document.querySelector('[aria-label="node-a添加剧本场次"]') as HTMLSelectElement;
    await act(async () => { add.value = 'scene-3:v1:checksum-scene-3'; add.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const confirm = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认所改节点')) as HTMLButtonElement;
    assert.equal(confirm.disabled, true, 'new selection cannot be accepted without review');
    assert.match(document.body.textContent || '', /正文 scene-3/);
    for (const checkbox of [...document.querySelectorAll('input[type="checkbox"]')]) await act(async () => { (checkbox as HTMLInputElement).click(); });
    const rationale = document.querySelector('[aria-label="node-a匹配理由"]') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(rationale, '三场依次铺开线索并完成节点转折'); rationale.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    assert.equal(confirm.disabled, false);
    await act(async () => confirm.click());
    assert.equal(confirmed.length, 1);
    assert.equal(confirmed[0].length, 1, 'unchanged node must not be rewritten');
    assert.deepEqual(confirmed[0][0].scenes.map((item) => item.sceneId), ['scene-1', 'scene-2', 'scene-3']);
    assert.equal(confirmed[0][0].rationale, '三场依次铺开线索并完成节点转折');
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('explicit unbinding submits only that node and a failed submit preserves edits', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/', pretendToBeVisual: true });
  const globals: Record<string, unknown> = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { InteractiveContentMappingModal } = await import('../src/components/interactive/InteractiveContentMappingModal.tsx');
  const root = createRoot(document.getElementById('root')!);
  const existing = scene('scene-1');
  const binding = [{ nodeId: 'node-a', slot: 'main', scriptSceneRefs: [existing.ref] }] as NodeContentBinding[];
  const received: ContentMappingChange[][] = [];
  const render = (isOpen: boolean) => <InteractiveContentMappingModal isOpen={isOpen} nodes={[node('node-a'), node('node-b')]} scenes={[{ ...existing, scriptBlocks: undefined }]} bindings={binding} loadScenes={async () => [existing]} onClose={() => {}} onConfirm={async (changes) => { received.push(changes); throw new Error('写入失败'); }} />;
  try {
    await act(async () => root.render(render(true)));
    await act(async () => (document.querySelector('[aria-label="node-a移除场次 1"]') as HTMLButtonElement).click());
    await act(async () => root.render(render(true)));
    const confirm = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认所改节点')) as HTMLButtonElement;
    assert.equal(confirm.disabled, false);
    await act(async () => confirm.click());
    assert.deepEqual(received[0], [{ nodeId: 'node-a', action: 'clear', scenes: [], rationale: '' }]);
    assert.match(document.body.textContent || '', /写入失败/);
    await act(async () => root.render(render(true)));
    assert.match(document.body.textContent || '', /将解除此节点/);
    await act(async () => root.render(render(false)));
    await act(async () => root.render(render(true)));
    assert.doesNotMatch(document.body.textContent || '', /写入失败/);
    assert.match(document.body.textContent || '', /摘要 scene-1/);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});
