import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

test('director import opens by loading eligible Writing projects', async () => {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/production' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { scriptClient } = await import('../apps/web/src/clients/scriptClient');
  const { useProjectStore } = await import('../src/clients/stateClient');
  const { default: DirectorProduction } = await import('../src/pages/DirectorProduction');
  const originalList = scriptClient.listProjects;
  const store = useProjectStore.getState();
  const root = createRoot(document.getElementById('root')!);
  try {
    let calls = 0;
    scriptClient.listProjects = async () => {
      calls++;
      return { projects: [{ id: 'script_sample', title: '第 5 场样本', format: 'movie', writtenUnitCount: 1 }] as any };
    };
    useProjectStore.setState({ projects: [], isLoading: false, fetchProjects: async () => {} });
    await React.act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: ['/production'] }, React.createElement(DirectorProduction))));
    assert.equal(calls, 0, 'the script list is deferred until import is opened');
    const importButton = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('导入系统剧本'));
    assert.ok(importButton);
    await React.act(async () => importButton.click());
    assert.equal(calls, 1);
    assert.match(document.body.textContent || '', /1 个可导入剧本/);
    assert.match(document.body.textContent || '', /第 5 场样本/);
  } finally {
    await React.act(async () => root.unmount());
    scriptClient.listProjects = originalList;
    useProjectStore.setState(store, true);
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
