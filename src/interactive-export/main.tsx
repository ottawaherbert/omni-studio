import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import InteractivePlaytestPlayer from '../pages/InteractivePlaytestPlayer';
import { InteractivePlayerServices, type InteractivePlayerClient } from '../components/interactive/InteractivePlayerServices';
import type { InteractiveStandalonePackage } from '../domains/interactive/runtime/standalonePackage';
import type { InteractivePlaytestCheckpoint } from '../domains/interactive/types/schema';
import '../index.css';

const snapshot = JSON.parse(document.getElementById('interactive-package')!.textContent!) as InteractiveStandalonePackage;
const storageKey = `interactive-player:${snapshot.build.experienceId}:${snapshot.build.id}`;
const unavailable = async (): Promise<never> => { throw new Error('这是已导出的作品快照，不能重新构建。'); };
const client: InteractivePlayerClient = {
  getExperience: async () => snapshot.aggregate,
  getLatestRuntimeBuild: async () => snapshot.build,
  getRuntimeStoryManifest: async () => snapshot.story,
  getRuntimeMediaManifest: async () => snapshot.media || { buildId: snapshot.build.id, experienceId: snapshot.build.experienceId, nodes: [] },
  createRuntimeBuild: unavailable,
  createStructurePreviewBuild: unavailable,
  getPlaytestCheckpoint: async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as InteractivePlaytestCheckpoint | null;
      return saved?.runtimeBuildId === snapshot.build.id && saved.state && Array.isArray(saved.state.facts) ? saved : null;
    } catch { return null; }
  },
  savePlaytestCheckpoint: async (_experienceId, input) => {
    const saved: InteractivePlaytestCheckpoint = {
      id: storageKey, kind: snapshot.build.kind || 'formal', createdAt: new Date().toISOString(),
      ...input, experienceId: snapshot.build.experienceId,
      graphVersionId: snapshot.build.graphVersionId, stateSchemaVersionId: snapshot.build.stateSchemaVersionId,
      updatedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); }
    catch { throw new Error('浏览器未允许保存本地进度，当前试玩仍可继续。'); }
    return saved;
  },
};

createRoot(document.getElementById('root')!).render(
  <InteractivePlayerServices.Provider value={{ client, standalone: true }}>
    <MemoryRouter initialEntries={[`/play/${snapshot.build.experienceId}`]}>
      <Routes><Route path="/play/:experienceId" element={<InteractivePlaytestPlayer />} /></Routes>
      <Toaster />
    </MemoryRouter>
  </InteractivePlayerServices.Provider>,
);
