import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { ProjectProfile } from '../packages/script/src/schema.ts';
import type { InitialBriefPayload } from '../packages/script/src/creation.ts';

test('script home manually creates a project through onCreate without a model request', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/', pretendToBeVisual: true });
  const requests: string[] = [];
  const globals: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (input: string | URL | Request) => { requests.push(String(input)); throw new Error('Unexpected network request'); },
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { scriptConversationClient } = await import('../apps/web/src/clients/scriptConversationClient.ts');
  const { skillClient } = await import('../apps/web/src/clients/skillClient.ts');
  const originalAvailable = scriptConversationClient.available;
  const originalSkills = skillClient.listSkills;
  scriptConversationClient.available = async () => false;
  skillClient.listSkills = async () => [];
  const { ScriptLibrary } = await import('../apps/web/src/features/script/ScriptLibrary.tsx');
  const root = createRoot(document.getElementById('root')!);
  const created: Array<{ title: string; profile: ProjectProfile; brief?: InitialBriefPayload }> = [];
  try {
    await act(async () => root.render(<ScriptLibrary projects={[]} error="" onOpen={() => {}} onCreate={async (title, profile, brief) => { created.push({ title, profile, brief }); }} />));
    const backgroundRequests = [...requests];
    const open = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('手动新建剧本'))!;
    await act(async () => open.click());
    const title = document.querySelector('[aria-label="手动剧本名称"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(title, '手工电影'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    const format = document.querySelector('[aria-label="手动剧本形态"]') as HTMLSelectElement;
    await act(async () => { format.value = 'short-film'; format.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const brief = document.querySelector('[aria-label="手动剧本构想"]') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(brief, '雨夜有人失踪。'); brief.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    const create = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('创建空白剧本'))!;
    await act(async () => create.click());
    assert.equal(created.length, 1);
    assert.equal(created[0].title, '手工电影');
    assert.equal(created[0].profile.workType, '电影短片');
    assert.equal(created[0].profile.targetDurationMs, 5 * 60_000);
    assert.equal(created[0].brief?.concept, '雨夜有人失踪。');
    await act(async () => open.click());
    const secondTitle = document.querySelector('[aria-label="手动剧本名称"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(secondTitle, '纯空白稿'); secondTitle.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => { [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('创建空白剧本'))!.click(); });
    assert.equal(created.length, 2);
    assert.equal(created[1].brief, undefined, 'the optional brief must remain optional');
    assert.deepEqual(requests, backgroundRequests, 'manual creation must not add an AI or other network request');
  } finally {
    await act(async () => root.unmount());
    scriptConversationClient.available = originalAvailable;
    skillClient.listSkills = originalSkills;
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});
