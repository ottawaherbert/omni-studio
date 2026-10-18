import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { ProductionInteractivePrepProfile, ProductionScenePlanCandidate } from '../src/types/project.ts';
import type { ProductionScenePlanVersion, Scene } from '../src/types/project.ts';

test('formal Writing scenes prefill a complete editable manual production plan', async () => {
  const { initialManualScenePlan } = await import('../src/components/production/preparation/ManualScenePlanEditor.tsx');
  const sourceScenes = ['开场', '分岔', '结局'].map((title, index) => ({
    id: `scene-${index + 1}`, index: index + 1, title, synopsis: `${title}内容`, characters: [],
    blocks: [{ id: `block-${index + 1}`, type: 'action' as const, content: `${title}原文` }],
    targetDurationMinutes: 1,
  }));
  const nodes = sourceScenes.map((scene, index) => ({
    nodeId: `node-${index + 1}`, title: scene.title,
    sourceSceneRefs: [{ artifactId: `script-scene:writing:unit:${scene.id}`, versionId: 'revision-1', checksum: 'hash' }],
  })) as ProductionInteractivePrepProfile['nodes'];
  const sourceText = sourceScenes.map((scene) => scene.blocks[0].content).join('\n');
  const plan = initialManualScenePlan(sourceText, sourceScenes, nodes, 3);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((scene) => scene.interactiveNodeIds), [['node-1'], ['node-2'], ['node-3']]);

  const dom = new JSDOM('<div id="root"></div>', { url: 'http://fixture.invalid/' });
  const previous = new Map(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const { ManualScenePlanEditor } = await import('../src/components/production/preparation/ManualScenePlanEditor.tsx');
  const root = createRoot(document.getElementById('root')!);
  let confirmed: ProductionScenePlanCandidate[] | undefined;
  try {
    await act(async () => root.render(<ManualScenePlanEditor initialScenes={plan} sourceText={sourceText} nodes={nodes} targetDurationMinutes={3} onCancel={() => {}} onConfirm={(scenes) => { confirmed = scenes; }} />));
    const title = document.querySelector('[aria-label="第 2 场标题"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(title, '真正的分岔'); title.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => { [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('预览场次方案'))!.click(); });
    assert.equal(confirmed?.length, 3);
    assert.equal(confirmed?.[1].title, '真正的分岔');
    assert.equal(confirmed?.map((scene) => scene.sourceEvidence).join('\n'), sourceText);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key);
    dom.window.close();
  }
});

test('editing a scene title preserves scene identity and downstream production work', async () => {
  const { reconcileProductionScenes } = await import('../src/components/production/preparation/manualScenePlanReconcile.ts');
  const original: ProductionScenePlanCandidate = { id: 'candidate-1', order: 1, title: '旧标题', description: '旧概述', sourceEvidence: '正式原文', targetDurationMinutes: 1 };
  const current: Scene = { id: 'scene-existing', sceneNumber: '1', title: '旧标题', description: '旧概述', valueCharge: 'neutral', sourceEvidence: '正式原文', script: '正式原文', shots: [{ id: 'shot-1' }] as Scene['shots'], sceneAssets: '手工资产' };
  const priorPlan = { candidateScenes: [original], adoptedSceneSnapshot: [{ ...current }] } as ProductionScenePlanVersion;
  const renamed = reconcileProductionScenes({ sourceDocumentId: 'source-1', candidates: [{ ...original, title: '新标题' }], planId: 'next-plan', nodes: [], priorPlan, currentScenes: [current] });
  assert.deepEqual(renamed.replacedScenes, []);
  assert.equal(renamed.scenes[0].id, 'scene-existing');
  assert.equal(renamed.scenes[0].title, '新标题');
  assert.deepEqual(renamed.scenes[0].shots, current.shots);
  assert.equal(renamed.scenes[0].sceneAssets, '手工资产');
  const changedEvidence = reconcileProductionScenes({ sourceDocumentId: 'source-1', candidates: [{ ...original, sourceEvidence: '改过的原文' }], planId: 'next-plan', nodes: [], priorPlan, currentScenes: [current] });
  assert.equal(changedEvidence.replacedScenes[0].id, 'scene-existing');
  assert.notEqual(changedEvidence.scenes[0].id, 'scene-existing');
  const deleted = reconcileProductionScenes({ sourceDocumentId: 'source-1', candidates: [], planId: 'next-plan', nodes: [], priorPlan, currentScenes: [current] });
  assert.equal(deleted.replacedScenes[0].id, 'scene-existing');
});

test('exported Markdown headings retain separate branch scenes and exact source coverage', async () => {
  const { initialManualScenePlan } = await import('../src/components/production/preparation/ManualScenePlanEditor.tsx');
  const sourceScenes = ['抉择', '公开结局', '沉默结局'].map((title, index) => ({ id: `s${index}`, title, synopsis: '', blocks: [{ type: 'action' as const, content: `${title}正文` }] }));
  const nodes = sourceScenes.map((scene, index) => ({ nodeId: `n${index}`, title: scene.title, sourceSceneRefs: [{ artifactId: `scene:${scene.id}`, versionId: 'v1', checksum: 'sum' }] })) as ProductionInteractivePrepProfile['nodes'];
  const source = sourceScenes.map((scene) => `## ${scene.title}\n\n${scene.blocks[0].content}`).join('\n\n');
  const plan = initialManualScenePlan(source, sourceScenes, nodes, 3.375);
  assert.equal(plan.length, 3);
  assert.equal(plan.map((scene) => scene.sourceEvidence).join('\n\n'), source);
  assert.deepEqual(plan.map((scene) => scene.interactiveNodeIds), [['n0'], ['n1'], ['n2']]);
  assert.deepEqual(plan.map((scene) => scene.targetDurationMinutes), [1.125, 1.125, 1.125]);
});
