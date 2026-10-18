import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptProject, newScene} from '../packages/script/src/project';
import {parseScriptProject, type ScriptProject} from '../packages/script/src/schema';
import {buildAgentDraft, type AgentDraftCandidate} from '../packages/script/src/agentDraft';
import {assertAgentDraftScope, emptyScriptDraftCreationLedger, type ScriptDraftScope} from '../packages/script/src/agentScope';
import {applyWorkspacePatch, createWorkspacePatch} from '../packages/script/src/workspacePatch';
import {ScriptCommandService} from '../apps/api/src/agent/scriptCommands';
import {workspaceRef} from '../apps/api/src/repositories/scriptWorkspaceStore';

function fixture(structured = true): ScriptProject {
  const project = createScriptProject('场序合同回归', {
    organization: 'standalone', continuity: 'serialized', workType: '剧情', genres: [],
    language: 'zh-CN', plannedUnits: 1, targetDurationMs: 60000, toleranceMs: 0,
    includeCredits: false, aspectRatio: '16:9', productionMode: 'live-action',
  });
  const unit = project.units[0];
  if (structured) unit.structureNodes = [
    {id: 'node_a', title: 'A', purpose: '发现'},
    {id: 'node_b', title: 'B', purpose: '应对'},
  ];
  unit.scenes = ['序幕', 'A1', 'A2', 'B1'].map((title, index) => {
    const scene = newScene(title);
    scene.purpose = `${title}的事件`;
    scene.blocks[0].text = `${title}已有正文`;
    if (structured && index > 0) scene.structureNodeId = index < 3 ? 'node_a' : 'node_b';
    return scene;
  });
  return parseScriptProject(project);
}

function workspace(document: ScriptProject) {
  return {id: 'workspace_order_review', documentId: document.id, ownerId: 'owner_order_review', revision: document.revision, document};
}

function authorize(project: ScriptProject, nodeId?: string): ScriptDraftScope {
  // Use the command's real authorization builder with no database or model calls.
  return (ScriptCommandService.prototype as any).manualScope.call({deps: {}}, workspace(project), {
    operation: 'scene_order', instruction: '只调整选定范围内的场景顺序',
    source: {kind: 'WORKSPACE'}, target: {unitId: project.units[0].id, ...(nodeId ? {nodeId} : {})},
  }).scope;
}

function candidateFor(current: ScriptProject, scope: ScriptDraftScope, sceneIds: string[], origin = current) {
  const grant = scope.sceneOrderGrants![0];
  return buildAgentDraft(JSON.stringify({summary: '交换获准场景的顺序', sceneIds}), {
    candidateId: 'candidate_order_review', operation: 'scene_order', unitId: grant.unitId,
    ...(grant.nodeId ? {nodeId: grant.nodeId} : {}),
  }, current, scope, {origin, ledger: emptyScriptDraftCreationLedger()});
}

function adoptionScope(project: ScriptProject, scope: ScriptDraftScope, candidate: AgentDraftCandidate): ScriptDraftScope {
  const work = workspace(project);
  const record = {id: candidate.request.candidateId, status: 'VALID', candidate, request: candidate.request,
    workspaceId: work.id, runId: 'run_order_review', authorizationId: 'auth_order_review', baseRef: workspaceRef(work)};
  const service = {deps: {
    drafts: {readCandidate: () => record},
    authorizations: {read: () => ({id: record.authorizationId, workspaceId: work.id, scope, sources: []})},
    store: {readRun: (runId: string) => {
      assert.equal(runId, record.runId);
      return {id: runId, input: {}};
    }, db: {prepare: () => ({get: () => undefined})}},
  }};
  return (ScriptCommandService.prototype as any).applyScope.call(service, work, record.id, work.ownerId).scope;
}

test('scene order passes actual command authorization, candidate and adoption scopes without gaining content writes', () => {
  for (const structured of [true, false]) {
    const project = fixture(structured), scope = authorize(project, structured ? 'node_a' : undefined);
    assert.equal(scope.units[0].allowAllScenes, false);
    assert.equal(scope.units[0].allowSummary, false);
    assert.deepEqual(scope.units[0].scenes, []);
    assert.equal(scope.units[0].maxNewScenes, 0);
    const ids = [...scope.sceneOrderGrants![0].sceneIds].reverse();
    const candidate = candidateFor(project, scope, ids);
    const adopted = adoptionScope(project, scope, candidate);
    assert.deepEqual(adopted.sceneOrderGrants, scope.sceneOrderGrants);
    const rebuilt = candidateFor(project, adopted, ids);
    assert.deepEqual(rebuilt.patch, candidate.patch);
    const after = applyWorkspacePatch(project, rebuilt.patch), expected = structuredClone(project);
    let cursor = 0;
    expected.units[0].scenes = expected.units[0].scenes.map(scene => {
      if (!ids.includes(scene.id)) return scene;
      const targetId = ids[cursor++];
      return project.units[0].scenes.find(old => old.id === targetId)!;
    });
    assert.deepEqual(after, expected, 'only the order of the granted scene identities may change');
    assert.equal(Object.hasOwn(after.units[0], 'structureNodes'), structured);
  }
});

test('scene order rejects outside, invented, duplicated or omitted scene identities', () => {
  const project = fixture(), scope = authorize(project, 'node_a');
  const [first, second] = scope.sceneOrderGrants![0].sceneIds, outside = project.units[0].scenes.at(-1)!.id;
  for (const ids of [[outside, first], ['scene_unknown', first], [first, first], [second]]) {
    assert.throws(() => candidateFor(project, scope, ids), /获准的全部场景/);
  }
});

test('typed scene-order patches cannot smuggle body, scene-plan or shared-outline changes through adoption', () => {
  const project = fixture(), scope = authorize(project, 'node_a');
  const candidate = candidateFor(project, scope, [...scope.sceneOrderGrants![0].sceneIds].reverse());
  const adopted = adoptionScope(project, scope, candidate);
  const mutations: ((value: ScriptProject) => void)[] = [
    value => {value.units[0].scenes[1].blocks[0].text = '未经授权的新正文';},
    value => {value.units[0].scenes[1].purpose = '未经授权的新事件';},
    value => {value.brief.outline = '未经授权的总纲';},
  ];
  for (const mutate of mutations) {
    const forged = applyWorkspacePatch(project, candidate.patch);
    mutate(forged);
    assert.throws(() => assertAgentDraftScope(project, createWorkspacePatch(project, forged), adopted, 'scene_order', {
      origin: project, ledger: emptyScriptDraftCreationLedger(), unitId: project.units[0].id, nodeId: 'node_a',
    }), /场序候选不能改动正文或其他字段/);
  }
});

test('scene order rejects a frozen grant after members or their order have changed', () => {
  const origin = fixture(), scope = authorize(origin, 'node_a');
  const ids = [...scope.sceneOrderGrants![0].sceneIds].reverse();
  const mutations: ((value: ScriptProject) => void)[] = [
    value => {value.units[0].scenes[2].structureNodeId = 'node_b';},
    value => {value.units[0].scenes.splice(2, 0, {...newScene('新成员'), structureNodeId: 'node_a'});},
    value => {[value.units[0].scenes[1], value.units[0].scenes[2]] = [value.units[0].scenes[2], value.units[0].scenes[1]];},
  ];
  for (const mutate of mutations) {
    const current = structuredClone(origin);
    current.revision++;
    mutate(current);
    parseScriptProject(current);
    assert.throws(() => candidateFor(current, scope, ids, origin), /场景顺序或成员已变化/);
  }
});

test('whole-unit scene order cannot move scene groups against the structure directory', () => {
  const project = fixture(), scope = authorize(project), scenes = project.units[0].scenes;
  assert.throws(() => candidateFor(project, scope, [scenes[0].id, scenes[3].id, scenes[1].id, scenes[2].id]), /结构目录顺序|场景顺序|目录.*顺序/);
});
