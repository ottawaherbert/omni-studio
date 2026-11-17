import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

test('film export separates unreviewed preview from exact reviewed episode delivery and rechecks conflicts', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid', pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window) };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const originalFetch = globalThis.fetch;
  const { assetClient } = await import('../src/clients/assetClient');
  const { legacyProjectClient } = await import('../src/clients/legacyProjectClient');
  const originalCompose = assetClient.composeEpisodeFilm, originalGet = legacyProjectClient.getEpisode;
  const { createRoot } = await import('react-dom/client');
  const { useEpisodeFilmExport } = await import('../src/hooks/useEpisodeFilmExport');
  const { EpisodeFilmExportModal } = await import('../src/components/EpisodeFilmExportModal');
  const root = createRoot(document.getElementById('root')!);
  const downloads: { url: string; name: string }[] = [];
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ url: this.getAttribute('href')!, name: this.download }); };
  const project = { id: 'p', title: '隔离影片', assets: [], characters: [] } as any;
  const episode = { id: 'e', title: '第一集', scenes: [{ id: 's', title: '一场', shots: [{ id: 'shot', videoUrl: '/media/source.mp4', duration: 2 }] }] } as any;
  let qualityState = 'pending', deliveryConflict = false, qualityUnavailable = false, composed = 0;
  const qualityCalls: { path: string; body?: any }[] = [];
  globalThis.fetch = async (url, options) => {
    const path = String(url); qualityCalls.push({ path, body: options?.body ? JSON.parse(String(options.body)) : undefined });
    if (path.includes('/status?')) {
      if (qualityUnavailable) return new Response(JSON.stringify({ error: '质量服务暂不可用' }), { status: 503 });
      return new Response(JSON.stringify({ stages: [{ stage: 'episode_cut', status: qualityState, inspectionId: qualityState === 'passed' ? 'checked-episode' : undefined, blockers: [] }] }));
    }
    assert.equal(path, '/api/production/quality/deliveries');
    if (deliveryConflict) return new Response(JSON.stringify({ error: 'changed' }), { status: 409 });
    return new Response(JSON.stringify({ target: { projectId: 'p', episodeId: 'e' }, inspectionId: 'checked-episode', status: 'quality_passed', media: [{ mediaUrl: '/media/generation/snapshots/reviewed.mp4', mediaKind: 'video', contentHash: 'frozen' }] }));
  };
  assetClient.composeEpisodeFilm = async () => { composed++; return { url: '/media/preview.mp4' }; };
  legacyProjectClient.getEpisode = async () => episode;
  let film!: ReturnType<typeof useEpisodeFilmExport>;
  function Harness() {
    film = useEpisodeFilmExport({ project, episode });
    return <EpisodeFilmExportModal isOpen onClose={() => {}} onExport={film.exportEpisode} onDownloadReviewed={film.downloadReviewedEpisode} deliveryAvailability={film.deliveryAvailability} previewUrl={film.previewUrl} {...film} />;
  }
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { await film.refreshCoverage(); });
    const deliveryButton = () => [...document.querySelectorAll('button')].find(button => button.textContent === '下载已总检成片')!;
    assert.equal(deliveryButton().disabled, true);
    assert.match(document.body.textContent!, /尚未通过整集总检/);
    assert.doesNotMatch(document.body.textContent!, /正式视频/);
    await act(async () => { await film.exportEpisode({ mode: 'video', resolution: 720 }); });
    assert.equal(composed, 1);
    assert.deepEqual(downloads[0], { url: '/media/preview.mp4', name: '隔离影片-第一集-待审粗剪-720p.mp4' });
    assert.equal(document.querySelector('video')?.getAttribute('src'), '/media/preview.mp4');
    assert.equal((document.querySelector('[aria-label="回看视频地址"]') as HTMLInputElement).value, '/media/preview.mp4');
    assert.equal(deliveryButton().disabled, true, 'a successful composition does not grant formal delivery');
    qualityState = 'passed';
    await act(async () => { await film.refreshCoverage(); });
    assert.equal(deliveryButton().disabled, false);
    await act(async () => { await film.downloadReviewedEpisode(); });
    assert.equal(composed, 1, 'formal delivery must not invoke composition or re-encode');
    assert.deepEqual(downloads[1], { url: '/media/generation/snapshots/reviewed.mp4', name: '隔离影片-第一集-正式交付.mp4' });
    assert.deepEqual(qualityCalls.find(call => call.path.endsWith('/deliveries'))!.body, { inspectionId: 'checked-episode' });
    qualityState = 'stale';
    await act(async () => { await assert.rejects(film.downloadReviewedEpisode(), /当前内容已变化/); });
    assert.equal(downloads.length, 2, 'a stale state after opening cannot download');
    assert.equal(qualityCalls.filter(call => call.path.endsWith('/deliveries')).length, 1);
    qualityState = 'passed'; deliveryConflict = true;
    await act(async () => { await film.refreshCoverage(); });
    await act(async () => { await assert.rejects(film.downloadReviewedEpisode(), /检查依据已变化/); });
    assert.equal(deliveryButton().disabled, true);
    assert.equal(downloads.length, 2, 'delivery conflicts preserve preview and do not download another file');
    qualityUnavailable = true;
    await act(async () => { await film.refreshCoverage(); });
    assert.equal(film.totalShotCount, 1, 'quality status failure preserves ordinary preview availability');
    await act(async () => { await film.exportEpisode({ mode: 'video' }); });
    assert.equal(composed, 2);
  } finally {
    await act(async () => root.unmount()); assetClient.composeEpisodeFilm = originalCompose; legacyProjectClient.getEpisode = originalGet; globalThis.fetch = originalFetch;
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});
