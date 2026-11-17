import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { CreateInteractiveExperienceInput, InteractiveExperienceAggregate, InteractiveRuntimeBuild } from '../src/domains/interactive/types/schema';
import { runtimeBuildHasSourceChanges } from '../src/domains/interactive/runtime/runtimeBuildSourceReview';

const input: CreateInteractiveExperienceInput = {
  title: '补齐画面后继续试玩', genre: '剧情', executionPolicy: 'guided',
  formatProfile: { format: 'branching_fmv', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 1, targetCompleteMinutes: 1 },
  experienceSpec: { playerRole: '来访者', playerPersona: '普通观众', interactionPromise: '归还钥匙', coreVerbs: ['选择'],
    dramaticContract: { genre: '剧情', theme: '信任', centralConflict: '归还钥匙' }, choiceCadence: { targetChoicesPerTenMinutes: 1, maxMinutesWithoutChoice: 1 },
    consequenceHorizon: ['immediate'], failStatePolicy: 'retry', savePolicy: 'manual_save',
    accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'standard', colorBlindSafe: true } },
  storyArchitecture: { premise: '钥匙', protagonistGoal: '归还', thematicQuestion: '信任', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 1, maxParallelBranches: 1 } },
  storySource: { mode: 'bind_writing', writingProjectId: 'fixture-script' },
  productionBoundary: { maxBranchDepth: 1, maxParallelBranches: 1, exclusiveContentPercent: 0, maxAutomaticRepairAttempts: 0 },
};

test('preserved media builds detect new selections and review completion, then the player explicitly rebuilds', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'interactive-media-refresh-'));
  const previousPath = process.env.OMNI_DB_PATH;
  process.env.OMNI_DB_PATH = path.join(directory, 'isolated.sqlite');
  const { db, dbHelpers } = await import('../src/server/db');
  assert.equal(db.name, process.env.OMNI_DB_PATH);
  const { interactiveRepository } = await import('../src/server/interactiveRepository');
  const { mediaTakeChecksum } = await import('../src/server/productionMediaTakeResolver');
  try {
    let current = interactiveRepository.createExperience(input);
    const id = current.experience.id;
    current = interactiveRepository.saveGraph(id, { entryNodeId: 'end', semanticContractVersion: 2, nodes: [{
      id: 'end', brief: { nodeId: 'end', title: '归还钥匙', intent: '归还', dramaticFunction: 'ending', narrativeSummary: '店主收回钥匙。' },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [],
      interaction: { capabilities: ['play_content', 'terminal'], contentPolicy: 'create_shared_content', durationRangeSec: [1, 5], playerKnowledgeIn: [], playerKnowledgeOut: [] },
    }] });
    const scriptRef = { kind: 'script_scene' as const, artifactId: 'fixture-scene', versionId: 'revision-1', checksum: 'script-content' };
    current = interactiveRepository.saveBinding(id, { nodeId: 'end', slot: 'main', status: 'approved', scriptSceneRefs: [scriptRef],
      contentFitReview: { verdict: 'pass', rationale: '已经实际核对节点与正文内容一致', sceneChecksums: [scriptRef.checksum], reviewedAt: new Date().toISOString() } });
    const waiting = interactiveRepository.getRuntimeBuild(id, interactiveRepository.createRuntimeBuild(id).id)!;
    assert.equal(waiting.status, 'waiting_for_media');
    assert.equal(runtimeBuildHasSourceChanges(waiting, current), false);
    assert.equal(waiting.nodeManifests[0].bindingVersionIndex, current.bindings[0].versionIndex);

    const media = ['first', 'replacement'].map((name, index) => ({ kind: 'video' as const, source: 'upload' as const, status: 'ready' as const,
      url: `/api/assets/${name}.mp4`, createdAt: index + 1, updatedAt: index + 1 }));
    dbHelpers.saveProject({ id: 'media-fixture', title: '隔离媒体', episodes: [{ id: 'episode', scenes: [{ id: 'scene', shots: media.map((item, index) => ({
      id: `shot-${index}`, duration: 2, videoMedia: item,
    })) }] }] });
    const refs = media.map((item, index) => {
      const shotId = `shot-${index}`;
      const takeId = `${shotId}:primary`;
      const checksum = mediaTakeChecksum({ projectId: 'media-fixture', episodeId: 'episode', sceneId: 'scene', shotId, takeId, media: item });
      return { kind: 'media_take' as const, artifactId: `production-media-take:media-fixture:episode:scene:${shotId}:${takeId}`, versionId: `media-${checksum.slice(0, 16)}`, checksum };
    });
    current = interactiveRepository.saveBinding(id, { ...current.bindings[0], mediaTakeRefs: [refs[0]] });
    const awaitingReview = interactiveRepository.createRuntimeBuild(id);
    assert.deepEqual(awaitingReview.pendingMediaReviewNodeIds, ['end']);
    current = interactiveRepository.saveBinding(id, { ...current.bindings[0], mediaFitReview: { verdict: 'pass', rationale: '已检查画面与剧情一致', mediaChecksums: [refs[0].checksum], reviewedAt: new Date().toISOString() } });
    assert.equal(runtimeBuildHasSourceChanges(waiting, current), true);
    assert.equal(runtimeBuildHasSourceChanges(awaitingReview, current), true);
    const legacyWaiting = structuredClone(waiting);
    const legacyReview = structuredClone(awaitingReview);
    delete legacyWaiting.nodeManifests[0].bindingVersionIndex;
    delete legacyReview.nodeManifests[0].bindingVersionIndex;
    assert.equal(runtimeBuildHasSourceChanges(legacyWaiting, current), true, 'old builds also detect newly selected media');
    assert.equal(runtimeBuildHasSourceChanges(legacyReview, current), true, 'old builds detect review-only changes with unchanged media');
    assert.deepEqual(interactiveRepository.getRuntimeBuild(id, waiting.id), waiting, 'binding writes preserve the old snapshot');

    await checkPlayerRebuild(current, waiting, () => interactiveRepository.createRuntimeBuild(id));
    const ready = interactiveRepository.getLatestRuntimeBuild(id)!;
    assert.equal(ready.status, 'ready_for_player');
    assert.equal(runtimeBuildHasSourceChanges(ready, current), false);
    const legacyReady = structuredClone(ready);
    delete legacyReady.nodeManifests[0].bindingVersionIndex;
    assert.equal(runtimeBuildHasSourceChanges(legacyReady, current), false, 'unchanged legacy media must not show a false update');
    const remapped = structuredClone(current);
    remapped.bindings[0].updatedAt = new Date(Date.parse(legacyReady.createdAt) + 1).toISOString();
    remapped.bindings[0].mediaScenarios = [{ scenarioId: 'revised-state', reuseFingerprint: 'revised-visuals', mediaTakeRefs: [refs[0]] }];
    assert.equal(runtimeBuildHasSourceChanges(legacyReady, remapped), true, 'legacy scenario-only edits are newer binding decisions too');

    current = interactiveRepository.saveBinding(id, { ...current.bindings[0], mediaTakeRef: undefined, mediaTakeRefs: [refs[1]],
      mediaFitReview: { verdict: 'pass', rationale: '已检查替换画面与剧情一致', mediaChecksums: [refs[1].checksum], reviewedAt: new Date().toISOString() } });
    assert.equal(runtimeBuildHasSourceChanges(ready, current), true);
    assert.equal(runtimeBuildHasSourceChanges(legacyReady, current), true);
    await checkPlayerRebuild(current, ready, () => interactiveRepository.createRuntimeBuild(id));
    assert.deepEqual(interactiveRepository.getRuntimeBuild(id, ready.id), ready, 'refreshing keeps previous selected video and checkpoint identity intact');
    assert.equal(interactiveRepository.getLatestRuntimeBuild(id)!.nodeManifests[0].mediaTakeRefs[0].checksum, refs[1].checksum);
  } finally {
    db.close();
    if (previousPath === undefined) delete process.env.OMNI_DB_PATH; else process.env.OMNI_DB_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

async function checkPlayerRebuild(aggregate: InteractiveExperienceAggregate, oldBuild: InteractiveRuntimeBuild, rebuild: () => InteractiveRuntimeBuild) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/', pretendToBeVisual: true });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { InteractivePlayerServices } = await import('../src/components/interactive/InteractivePlayerServices');
  const Player = (await import('../src/pages/InteractivePlaytestPlayer')).default;
  let createCalls = 0;
  let mediaBuildId = '';
  const client = {
    getExperience: async () => aggregate,
    getLatestRuntimeBuild: async () => oldBuild,
    getPlaytestCheckpoint: async () => null,
    getRuntimeStoryManifest: async () => ({ buildId: oldBuild.id, experienceId: aggregate.experience.id, nodes: [] }),
    getRuntimeMediaManifest: async (_id: string, buildId: string) => {
      mediaBuildId = buildId;
      return { buildId, experienceId: aggregate.experience.id, nodes: [] };
    },
    createRuntimeBuild: async () => { createCalls++; return rebuild(); },
    createStructurePreviewBuild: async () => { throw new Error('Confirmed content must keep the formal build path'); },
    savePlaytestCheckpoint: async () => { throw new Error('This fixture uses manual saving'); },
  };
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(<InteractivePlayerServices.Provider value={{ client }}><MemoryRouter initialEntries={[`/play/${aggregate.experience.id}`]}>
      <Routes><Route path="/play/:experienceId" element={<Player />} /></Routes>
    </MemoryRouter></InteractivePlayerServices.Provider>));
    assert.equal(createCalls, 0, 'opening an old snapshot must not silently replace it');
    assert.match(document.body.textContent || '', /来源有更新 · 历史试玩快照/);
    const refresh = [...document.querySelectorAll('button')].find((button) => button.textContent === '用当前内容重新准备');
    assert.ok(refresh, 'media-only updates must expose a usable rebuild action');
    await act(async () => refresh.click());
    assert.equal(createCalls, 1);
    assert.notEqual(mediaBuildId, oldBuild.id, 'player resolves the newly created build media');
    assert.match(document.body.textContent || '', /成片画面/);
    assert.doesNotMatch(document.body.textContent || '', /历史试玩快照/);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
}
