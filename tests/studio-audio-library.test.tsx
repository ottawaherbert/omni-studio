import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { buildEpisodeAudioExportItems } from '../src/utils/episodeAudioExport';

test('selecting a browser library sound persists the actual file for server listening checks and export', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter } = await import('react-router-dom');
  const { useGlobalStore } = await import('../src/store/useGlobalStore');
  const { StudioAudioControls } = await import('../src/components/StudioAudioControls');
  const priorStore = useGlobalStore.getState();
  const root = createRoot(document.getElementById('root')!);
  const updates: any[] = [];
  const track = { id: 'music', type: 'bgm' as const, url: '', startTime: 0, duration: 1 };
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
    assert.ok(button, label); await act(async () => button.click());
  };
  try {
    useGlobalStore.setState({ globalAssets: [{ id: 'library-music', name: '测试库声音', type: 'bgm', description: '', url: '/media/original.wav', imageUrls: [], createdAt: 1, updatedAt: 1 }] });
    await act(async () => root.render(<MemoryRouter><StudioAudioControls
      selectedAudioTrack={track} localAudioText="" onAudioTextChange={() => {}}
      currentProject={{ id: 'p', title: '测试', assets: [], characters: [] } as any}
      isGeneratingVoice={false} onGenerateVoice={() => {}} onUpdateCharacter={() => {}}
      onUpdateAudioTrack={update => updates.push(update)}
    /></MemoryRouter>));
    await click('从资产库选择'); await click('测试库声音');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].linkedAssetId, 'library-music');
    assert.equal(updates[0].url, '/media/original.wav');
    const scene = { id: 'scene', title: '测试场', shots: [{ id: 'shot', duration: 2 }], audioTracks: [{ ...track, ...updates[0] }] } as any;
    const exported = buildEpisodeAudioExportItems([scene], () => '/media/changed-in-library.wav');
    assert.equal(exported[0].url, '/media/original.wav', 'changing the browser library cannot silently replace the reviewed scene sound');
  } finally {
    await act(async () => root.unmount());
    useGlobalStore.setState(priorStore);
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});
