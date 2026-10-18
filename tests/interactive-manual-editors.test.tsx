import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { InteractiveChoice, NarrativeNode, StateSchema } from '../src/domains/interactive/types/schema.ts';
import type { InteractiveProjectSettingsValue } from '../src/components/interactive/whiteboard/InteractiveProjectSettingsInspector.tsx';

const node = (id: string, title: string): NarrativeNode => ({
  id, brief: { nodeId: id, title, intent: title, dramaticFunction: 'choice_point', narrativeSummary: title },
  contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [],
  interaction: { capabilities: ['play_content'], contentPolicy: 'create_shared_content', durationRangeSec: [45, 90], playerKnowledgeIn: [], playerKnowledgeOut: [] },
});

test('choice switching resets local fields and preserves nested conditions and effects', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { InteractiveChoiceInspector } = await import('../src/components/interactive/whiteboard/InteractiveChoiceInspector.tsx');
  const root = createRoot(document.getElementById('root')!);
  const a: InteractiveChoice = { id: 'a', text: '留下', intent: '冒险', targetNodeId: 'end-a', effects: [] };
  const b: InteractiveChoice = {
    id: 'b', text: '离开', intent: '保护伙伴', targetNodeId: 'end-b',
    condition: { op: 'all', predicates: [{ op: 'has_fact', fact: '线索' }, { op: 'not', predicate: { op: 'visited', nodeId: 'end-a', minTimes: 2 } }] },
    effects: [{ type: 'increment', variable: 'trust', amount: 2 }],
  };
  const schema: StateSchema = { variables: [{ key: 'trust', type: 'number', scope: 'global', defaultValue: 0 }], factDefinitions: ['线索'], initialFactIds: [] };
  const saved: Array<{ id: string; patch: Partial<InteractiveChoice> }> = [];
  const render = (choice: InteractiveChoice) => <InteractiveChoiceInspector choice={choice} allNodes={[node('end-a', '结局甲'), node('end-b', '结局乙')]} stateSchema={schema} onClose={() => {}} onSaveChoice={(id, patch) => saved.push({ id, patch })} onDeleteChoice={() => {}} />;
  try {
    await act(async () => root.render(render(a)));
    await act(async () => root.render(render(b)));
    assert.equal((document.querySelector('input') as HTMLInputElement).value, '离开');
    assert.equal((document.querySelector('select') as HTMLSelectElement).value, 'end-b');
    const save = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('保存修改'))!;
    await act(async () => save.click());
    assert.equal(saved[0].id, 'b');
    assert.deepEqual(saved[0].patch.condition, b.condition);
    assert.deepEqual(saved[0].patch.effects, b.effects);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('manual node ending save adds terminal capability without losing existing contract', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { InteractiveNodeInspector } = await import('../src/components/interactive/whiteboard/InteractiveNodeInspector.tsx');
  const root = createRoot(document.getElementById('root')!);
  const original = node('n1', '原节点');
  original.interaction!.capabilities.push('checkpoint');
  let patch: Partial<Pick<NarrativeNode, 'brief' | 'interaction' | 'contract' | 'storyBeatIds'>> | undefined;
  let movedTo = '';
  try {
    await act(async () => root.render(<InteractiveNodeInspector node={original} chapters={[{ id: 'chapter-1', title: '第一章' }]} currentChapterId="" onMoveToChapter={(_, id) => { movedTo = id; }} onClose={() => {}} onUpdateBrief={() => {}} onUpdateNode={(_, next) => { patch = next; }} onAddChoice={() => {}} onSelectChoice={() => {}} onDeleteNode={() => {}} onSetAsEntry={() => {}} onAiExtendFromNode={() => {}} onOpenWritingHandoff={() => {}} onOpenProductionHandoff={() => {}} />));
    const chapter = document.querySelector('[aria-label="所属章节"]') as HTMLSelectElement;
    await act(async () => { chapter.value = 'chapter-1'; chapter.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    assert.equal(movedTo, 'chapter-1');
    const selector = document.querySelector('[aria-label="叙事类型"]') as HTMLSelectElement;
    await act(async () => { selector.value = 'ending'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => { [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('保存节点设置'))!.click(); });
    assert.equal(patch?.brief?.dramaticFunction, 'ending');
    assert.ok(patch?.interaction?.capabilities.includes('terminal'));
    assert.ok(patch?.interaction?.capabilities.includes('checkpoint'));
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('state editor saves variables and starting facts from the visible form', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { InteractiveStateSchemaInspector } = await import('../src/components/interactive/whiteboard/InteractiveStateSchemaInspector.tsx');
  const root = createRoot(document.getElementById('root')!);
  let saved: StateSchema | undefined;
  try {
    await act(async () => root.render(<InteractiveStateSchemaInspector schema={{ variables: [{ key: 'trust', type: 'number', scope: 'global', defaultValue: 1 }], factDefinitions: ['线索'], initialFactIds: ['线索'] }} onSave={(next) => { saved = next; }} onClose={() => {}} />));
    await act(async () => { [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('添加变量'))!.click(); });
    const name = document.querySelector('[aria-label="变量 2 名称"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(name, 'seen'); name.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => { [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('保存故事状态'))!.click(); });
    assert.equal(saved?.variables[1].key, 'seen');
    assert.deepEqual(saved?.initialFactIds, ['线索']);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('project settings preserve episode and chapter links on save', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { InteractiveProjectSettingsInspector } = await import('../src/components/interactive/whiteboard/InteractiveProjectSettingsInspector.tsx');
  const root = createRoot(document.getElementById('root')!);
  const value: InteractiveProjectSettingsValue = {
    title: '旧标题', genre: '悬疑',
    formatProfile: { format: 'interactive_series', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 20, targetCompleteMinutes: 30 },
    experienceSpec: {
      playerRole: '调查员', playerPersona: '谨慎', interactionPromise: '选择改变结局', coreVerbs: ['调查'],
      dramaticContract: { genre: '悬疑', theme: '真相', centralConflict: '调查失踪' },
      choiceCadence: { targetChoicesPerTenMinutes: 3, maxMinutesWithoutChoice: 4 }, consequenceHorizon: ['immediate'],
      failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
      accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'standard', colorBlindSafe: true },
    },
    storyArchitecture: {
      premise: '一段录音', protagonistGoal: '找到真相', thematicQuestion: '是否公开', mandatoryNodes: [], variableNodes: [], endings: [],
      branchBudget: { maxDepth: 4, maxParallelBranches: 2 },
      storyChapters: [{ id: 'chapter-1', title: '码头', summary: '调查开始', storyBeatIds: [], targetDurationRangeSec: [60, 300], order: 1 }],
      storyEpisodes: [{ id: 'episode-1', title: '第一集', storyChapterIds: ['chapter-1'], order: 1 }],
    },
    productionBoundary: { maxBranchDepth: 4, maxParallelBranches: 2, exclusiveContentPercent: 30, maxAutomaticRepairAttempts: 2 },
  };
  let saved: InteractiveProjectSettingsValue | undefined;
  try {
    await act(async () => root.render(<InteractiveProjectSettingsInspector value={value} onSave={(next) => { saved = next; }} onClose={() => {}} />));
    const title = document.querySelector('[aria-label="作品名称"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(title, '新标题'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    const timedChoice = document.querySelector('[aria-label="限时选择辅助"]') as HTMLSelectElement;
    await act(async () => { timedChoice.value = 'infinite'; timedChoice.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => { [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('保存作品设置'))!.click(); });
    assert.equal(saved?.title, '新标题');
    assert.equal(saved?.storyArchitecture.durationBudget?.p50TargetSec, 1200);
    assert.equal(saved?.storyArchitecture.durationBudget?.p90TargetSec, 1800);
    assert.equal(saved?.storyArchitecture.durationBudget?.maxSecondsWithoutChoice, 240);
    assert.equal(saved?.storyArchitecture.storyChapters?.[0].episodeId, 'episode-1');
    assert.deepEqual(saved?.storyArchitecture.storyEpisodes?.[0].storyChapterIds, ['chapter-1']);
    assert.equal(saved?.experienceSpec.dramaticContract.theme, '真相');
    assert.equal(saved?.experienceSpec.accessibilitySettings.timedChoiceOption, 'infinite');
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('manual project creation reaches a blank graph without requesting an AI draft', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const { interactiveClient } = await import('../apps/web/src/clients/interactiveProductionClient.ts');
  const { interactiveAuthoringClient } = await import('../apps/web/src/clients/interactiveAuthoringClient.ts');
  const NewInteractiveProjectWizard = (await import('../src/pages/NewInteractiveProjectWizard.tsx')).default;
  const originalList = interactiveClient.listWritingProjects;
  const originalCreate = interactiveClient.createExperience;
  const originalDraft = interactiveAuthoringClient.createDraft;
  let created = 0;
  let draftCalls = 0;
  interactiveClient.listWritingProjects = async () => [];
  interactiveClient.createExperience = async (input) => {
    created++;
    assert.equal(input.executionPolicy, 'guided');
    assert.equal(input.authoringPrompt, undefined);
    return { experience: { id: 'manual-1' } } as Awaited<ReturnType<typeof originalCreate>>;
  };
  interactiveAuthoringClient.createDraft = async (...args) => { draftCalls++; return originalDraft(...args); };
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/interactive/new']}><Routes><Route path="/interactive/new" element={<NewInteractiveProjectWizard />} /><Route path="/interactive/experiences/:id/graph" element={<div>空白画布已打开</div>} /></Routes></MemoryRouter>));
    const title = document.querySelector('input[placeholder="例如：雾港回声"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(title, '手工作品'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => { [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('手动创建空白画布'))!.click(); });
    assert.equal(created, 1);
    assert.equal(draftCalls, 0);
    assert.match(document.body.textContent || '', /空白画布已打开/);
  } finally {
    await act(async () => root.unmount());
    interactiveClient.listWritingProjects = originalList;
    interactiveClient.createExperience = originalCreate;
    interactiveAuthoringClient.createDraft = originalDraft;
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});
