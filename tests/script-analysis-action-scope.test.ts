import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import React, {type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScriptAgentHost} from '../apps/api/src/agent/scriptHost';
import {StructureAnalysisCard} from '../apps/web/src/features/script/components/StructureAnalysisCard';
import type {AssistantRequest} from '../apps/web/src/features/script/scriptAssistantShortcuts';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {createScriptProject, newScene} from '../packages/script/src/project';
import {anchorFor, outlineGuideId} from '../packages/script/src/outlineGuides';
import type {ScriptDraftScope} from '../packages/script/src/agentScope';
import type {StructureAnalysis} from '../packages/script/src/structureAnalysis';

function fixture(t: TestContext) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  const host = createScriptAgentHost(db, {
    sendOnce: async () => { throw new Error('NO_EXTERNAL_MODEL'); },
  }, 'analysis-action-test', {trustedLegacyProjectOwner: 'author'});
  const thread = host.conversations.open('author', 'script:home', 'analysis-action-test');
  const project = createScriptProject('分析范围机械样本', createScriptCreationProfile('short-film', 1, 5));
  const firstSpan = '她听到敲门。';
  project.brief.outline = `${firstSpan}她决定离开。`;
  const unit = project.units[0];
  unit.structureNodes = [{id: 'node_a', title: '敲门', purpose: '听到有人到访'}, {id: 'node_b', title: '离开'}];
  unit.scenes = ['门内', '门外', '车站'].map((title, index) => {
    const scene = newScene(title);
    scene.structureNodeId = index < 2 ? 'node_a' : 'node_b';
    scene.purpose = `PLAN_${index}_EXACT_QUOTE`;
    scene.blocks[0].text = `BODY_${index}_MUST_REMAIN`;
    return scene;
  });
  const owner = {kind: 'project' as const, id: project.id};
  project.outlineGuides = [{
    id: outlineGuideId(owner), owner, beats: [],
    nodeLinks: [
      {unitId: unit.id, nodeId: 'node_a', anchor: anchorFor(project.brief.outline, 0, firstSpan.length)},
      {unitId: unit.id, nodeId: 'node_b', anchor: anchorFor(project.brief.outline, firstSpan.length, project.brief.outline.length)},
    ],
  }];
  const workspace = host.workspaces.create({
    ownerId: 'author', threadId: thread.id, requestId: 'workspace', source: {document: project},
  });
  const outlineRange = {start: 0, end: firstSpan.length, text: firstSpan};
  return {db, host, thread, workspace, project, unit, outlineRange};
}

function accept(h: ReturnType<typeof fixture>, selected: Record<string, unknown>) {
  const selection = {
    workspaceId: h.workspace.id, expectedRevision: h.workspace.revision, unitId: h.unit.id, ...selected,
  };
  const text = '按当前明确范围处理结构与节奏意见，保留范围外内容。';
  const accepted = h.host.commands.acceptChatTurn({
    ownerId: 'author', threadId: h.thread.id, requestId: 'analysis-action', expectedVersion: 1,
    requestEnvelope: {text, selection},
    payload: {
      text, methods: [], template: '{{taskContract}}\n{{conversation}}\n{{methodInstructions}}',
      channel: 'external', routeRef: 'MECHANICAL_PROTOCOL_ONLY', selection,
    },
    text, methods: [], route: {channel: 'external', routeRef: 'MECHANICAL_PROTOCOL_ONLY'}, selection,
  });
  const runId = accepted.conversation.turns.find(turn => turn.id === accepted.turnId)!.runId;
  return {accepted, runId, input: h.host.store.readRun(runId).input as any};
}

async function freeze(h: ReturnType<typeof fixture>, chat: ReturnType<typeof accept>) {
  await h.host.worker.runOnce(chat.runId);
  const request = h.host.journal.listExternal(chat.runId, 'author')[0];
  assert.ok(request, JSON.stringify(h.host.store.readRun(chat.runId)));
  return request;
}

async function reply(h: ReturnType<typeof fixture>, chat: ReturnType<typeof accept>, decision: unknown) {
  const request = h.host.journal.listExternal(chat.runId, 'author')[0];
  h.host.journal.submitExternal(request.id, 'author', request.inputHash, JSON.stringify(decision), {name: 'MECHANICAL_PROTOCOL_ONLY'});
  await h.host.worker.runOnce(chat.runId);
  return h.host.conversations.turn(h.thread.id, chat.accepted.turnId, 'author').turn.response;
}

function exactOperation(h: ReturnType<typeof fixture>, chat: ReturnType<typeof accept>, operation: string) {
  assert.deepEqual(chat.input.dispatchOptions.map((choice: any) => choice.operation), [operation]);
  assert.deepEqual(chat.input.dispatchGoals, []);
  const scope = h.host.authorizations.read(chat.input.authorizationRef, 'author').scope as ScriptDraftScope;
  assert.deepEqual(scope.operations, [operation]);
  assert.deepEqual(scope.sharedFields, []);
  assert.deepEqual(scope.characterScopeIds, []);
  assert.deepEqual(scope.factScopeIds, []);
  assert.deepEqual(scope.newUnitSlots, []);
  assert.ok(scope.units.every(unit => !unit.allowAllScenes && !unit.allowSummary && !unit.allowStructure && unit.maxNewScenes === 0));
  return scope;
}

async function rejectCall(h: ReturnType<typeof fixture>, chat: ReturnType<typeof accept>, operation: string) {
  await freeze(h, chat);
  const response = await reply(h, chat, {kind: 'CALL', operation, question: '', options: [], entityId: null, analysis: null});
  assert.equal(h.host.store.readRun(chat.runId).status, 'SUCCEEDED');
  assert.equal(response.dispatch.kind, 'ASK');
  assert.equal(response.goal, undefined);
  assert.equal(response.dispatch.candidateId, undefined);
  assert.equal(h.host.journal.listExternal(chat.runId, 'author').length, 1);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_draft_candidates').get() as {n: number}).n, 0);
  const workspace = h.host.workspaces.read(h.workspace.id, 'author');
  assert.equal(workspace.revision, h.workspace.revision);
  assert.deepEqual(workspace.document, h.workspace.document);
}

for (const typed of [false, true]) for (const forbidden of ['project_outline', 'outline_goal']) {
  test(`${typed ? 'typed' : 'legacy'} local outlineRange cannot dispatch ${forbidden}`, async t => {
    const h = fixture(t);
    const chat = accept(h, {
      scopeId: h.project.id, outlineRange: h.outlineRange,
      ...(typed ? {draftOperation: 'outline_development'} : {}),
      outlineStructure: true, outlineSceneOrder: true,
    });
    const scope = exactOperation(h, chat, 'outline_development');
    assert.equal(scope.outlineGrants!.length, 1);
    const grant = scope.outlineGrants![0];
    assert.deepEqual(grant.owner, {kind: 'project', id: h.project.id});
    assert.equal(grant.start, h.outlineRange.start);
    assert.equal(grant.end, h.outlineRange.end);
    assert.equal(grant.allowStructure, false);
    assert.equal(grant.allowSceneOrder, false);
    assert.deepEqual(scope.units[0].scenes, []);
    await rejectCall(h, chat, forbidden);
  });
}

for (const operation of ['scene_plan', 'scene_order']) for (const forbidden of ['scene_body', 'write_goal']) {
  test(`typed ${operation} cannot dispatch ${forbidden}`, async t => {
    const h = fixture(t), scene = h.unit.scenes[0];
    const chat = accept(h, {
      draftOperation: operation,
      ...(operation === 'scene_plan' ? {sceneId: scene.id} : {nodeId: 'node_a'}),
    });
    const scope = exactOperation(h, chat, operation);
    if (operation === 'scene_plan') {
      assert.deepEqual(scope.units[0].scenes, [{sceneId: scene.id, allowPlan: true, allowBody: false, blockIds: null}]);
      assert.equal(scope.sceneOrderGrants, undefined);
    } else {
      assert.deepEqual(scope.units[0].scenes, []);
      assert.equal(scope.sceneOrderGrants![0].nodeId, 'node_a');
      assert.deepEqual(scope.sceneOrderGrants![0].sceneIds, h.unit.scenes.slice(0, 2).map(item => item.id));
    }
    await rejectCall(h, chat, forbidden);
  });
}

test('a scene-bound typed scene_order request cannot widen to the unit', async t => {
  const h = fixture(t);
  const chat = accept(h, {draftOperation: 'scene_order', sceneId: h.unit.scenes[0].id});
  assert.deepEqual(chat.input.dispatchOptions, []);
  assert.deepEqual(chat.input.dispatchGoals, []);
  assert.equal(chat.input.authorizationRef, undefined);
  await rejectCall(h, chat, 'scene_order');
});

test('typed body selection cannot dispatch a whole-scene rewrite', async t => {
  const h = fixture(t), scene = h.unit.scenes[0];
  const selection = {start: 0, end: 6, text: scene.blocks[0].text.slice(0, 6)};
  const chat = accept(h, {draftOperation: 'replace_selection', sceneId: scene.id, selection});
  const scope = exactOperation(h, chat, 'replace_selection');
  assert.deepEqual(scope.units[0].scenes, [{sceneId: scene.id, allowPlan: false, allowBody: true, blockIds: null, selection}]);
  await rejectCall(h, chat, 'scene_body');
});

function buttonWithText(node: ReactNode, label: string): React.ReactElement<any> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{children?: ReactNode}>(child)) continue;
    if (child.type === 'button' && child.props.children === label) return child;
    const nested = buttonWithText(child.props.children, label);
    if (nested) return nested;
  }
  return undefined;
}

for (const range of ['unit', 'node', 'scene'] as const) {
  test(`${range} analysis target is frozen by the server and cannot be expanded by a model`, async t => {
    const h = fixture(t), scene = h.unit.scenes[0];
    const target = {
      unitId: h.unit.id, ...(range !== 'unit' ? {nodeId: 'node_a'} : {}),
      ...(range === 'scene' ? {sceneId: scene.id} : {}),
    };
    const chat = accept(h, {...target, analysis: true});
    const frozen = await freeze(h, chat);
    const source = (frozen.request.inputManifest as any).analysisSource;
    const evidence = source.evidence.find((item: any) => item.kind === 'SCENE_PLAN' && item.sceneId === scene.id);
    assert.ok(evidence);
    if (range !== 'unit') assert.ok(source.evidence.every((item: any) => !item.sceneId || h.unit.scenes.slice(0, range === 'scene' ? 1 : 2).some(allowed => allowed.id === item.sceneId)));
    const response = await reply(h, chat, {
      kind: 'REPLY', operation: null, entityId: null, question: '分析当前范围。', options: [],
      analysis: {
        summary: '机械分析样本',
        // These fields are untrusted model output; only the server may attach a target.
        target: {unitId: 'forged_other_unit'}, unitId: 'forged_other_unit',
        findings: [{evidenceId: evidence.id, quote: evidence.text, issue: '事件承接需要核对', suggestion: '确认这场发生的原因', severity: 'ADVISORY'}],
      },
    });
    assert.equal(h.host.store.readRun(chat.runId).status, 'SUCCEEDED');
    const analysis = response.analysis as StructureAnalysis;
    assert.deepEqual(analysis.target, target);
    assert.equal(analysis.unitId, h.unit.id);
    assert.deepEqual(analysis.findings[0].evidence, evidence);
    let requested: AssistantRequest | undefined;
    const card = StructureAnalysisCard({
      analysis, project: h.workspace.document, onRequest: request => {requested = request;},
      onOpenScene: () => {}, onOpenOutline: () => {},
    });
    const markup = renderToStaticMarkup(card);
    if (range === 'scene') {
      assert.doesNotMatch(markup, /提出场序调整候选/);
    } else {
      assert.match(markup, /提出场序调整候选/);
      const order = buttonWithText(card, '提出场序调整候选');
      assert.ok(order);
      order.props.onClick();
      assert.equal(requested?.draftOperation, 'scene_order');
      assert.equal(requested?.unitId, target.unitId);
      assert.equal(requested?.nodeId, range === 'node' ? 'node_a' : undefined);
      assert.equal(requested?.sceneId, undefined);
    }
    const proposal = buttonWithText(card, '提出修改候选');
    assert.ok(proposal);
    proposal.props.onClick();
    assert.equal(requested?.draftOperation, 'scene_plan');
    assert.equal(requested?.sceneId, scene.id);
    assert.deepEqual(h.host.workspaces.read(h.workspace.id, 'author').document, h.workspace.document);
  });
}
