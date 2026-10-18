import test from 'node:test';
import assert from 'node:assert/strict';
import {hashValue} from '../packages/agent-core/src/identity';
import {createScriptProject, newScene} from '../packages/script/src/project';
import {parseScriptProject, type ScriptProject} from '../packages/script/src/schema';
import {
  anchorCurrent, anchorFor, beatsForUnit, freezeOutlineGrant, getOutlineGuide,
  outlineGuideId, unitOutlineOwner, type OutlineGrant, type OutlineOwner,
} from '../packages/script/src/outlineGuides';
import {buildAgentDraft, type AgentDraftCandidate} from '../packages/script/src/agentDraft';
import {assertAgentDraftScope, emptyScriptDraftCreationLedger, type ScriptDraftScope} from '../packages/script/src/agentScope';
import {applyWorkspacePatch, createWorkspacePatch} from '../packages/script/src/workspacePatch';
import {stageDelivery} from '../packages/script/src/agentStages';
import {ScriptCommandService} from '../apps/api/src/agent/scriptCommands';
import {workspaceRef} from '../apps/api/src/repositories/scriptWorkspaceStore';
import {ScriptDraftStore} from '../apps/api/src/repositories/scriptDraftStore';

function fixture(options: {ungrouped?: boolean; nested?: boolean} = {}): ScriptProject {
  const project = createScriptProject('联合大纲合同回归', {
    organization: 'standalone', continuity: 'serialized', workType: '剧情', genres: [],
    language: 'zh-CN', plannedUnits: 1, targetDurationMs: 60000, toleranceMs: 0,
    includeCredits: false, aspectRatio: '16:9', productionMode: 'live-action',
  });
  project.brief.outline = 'A段。B段。';
  const unit = project.units[0];
  unit.structureNodes = [
    ...(options.nested ? [{id: 'node_root', title: '总段', purpose: ''}] : []),
    {id: 'node_a', title: 'A', purpose: '', ...(options.nested ? {parentId: 'node_root'} : {})},
    {id: 'node_b', title: 'B', purpose: '', ...(options.nested ? {parentId: 'node_root'} : {})},
  ];
  const scene = (title: string, structureNodeId?: string) => {
    const value = newScene(title);
    value.blocks[0].text = `${title}已有正文，必须保留。`;
    return {...value, ...(structureNodeId ? {structureNodeId} : {})};
  };
  unit.scenes = [
    ...(options.ungrouped ? [scene('序幕')] : []),
    scene('A场', 'node_a'),
    ...(options.ungrouped ? [scene('间场')] : []),
    scene('B场', 'node_b'),
    ...(options.ungrouped ? [scene('尾声')] : []),
  ];
  const owner: OutlineOwner = {kind: 'project', id: project.id};
  project.outlineGuides = [{
    id: outlineGuideId(owner), owner,
    nodeLinks: [
      ...(options.nested ? [{unitId: unit.id, nodeId: 'node_root', anchor: anchorFor(project.brief.outline, 0, 6)}] : []),
      {unitId: unit.id, nodeId: 'node_a', anchor: anchorFor(project.brief.outline, 0, 3)},
      {unitId: unit.id, nodeId: 'node_b', anchor: anchorFor(project.brief.outline, 3, 6)},
    ],
    beats: [{
      id: 'beat_a', title: 'A中的发现', change: '人物发现线索',
      anchors: [anchorFor(project.brief.outline, 0, 3)], unitIds: [unit.id], sceneRefs: [],
    }],
  }];
  return parseScriptProject(project);
}

function scopeFor(project: ScriptProject, grant: OutlineGrant): ScriptDraftScope {
  return {
    workspaceId: 'workspace_outline_review', documentId: project.id,
    originRevision: project.revision, originContentHash: hashValue(project),
    operations: ['outline_development'],
    units: [{unitId: project.units[0].id, allowSummary: false, allowAllScenes: false, maxNewScenes: 0, scenes: []}],
    newUnitSlots: [], sharedFields: [], characterScopeIds: [], factScopeIds: [],
    outlineGrants: [grant],
  };
}

function result(project: ScriptProject, changes: Record<string, unknown> = {}) {
  return {summary: '按明确范围整理原文', content: project.brief.outline, nodes: null, beats: null, ...changes};
}

function candidateFor(
  current: ScriptProject, scope: ScriptDraftScope, value: Record<string, unknown>,
  origin = current, candidateId = 'candidate_outline_review',
) {
  return buildAgentDraft(JSON.stringify(value), {
    candidateId, operation: 'outline_development', unitId: current.units[0].id,
    ...(scope.outlineGrants?.[0].nodeId ? {nodeId: scope.outlineGrants[0].nodeId} : {}),
  }, current, scope, {origin, ledger: emptyScriptDraftCreationLedger()});
}

function modelNodes(project: ScriptProject) {
  const unit = project.units[0], guide = project.outlineGuides![0];
  return unit.structureNodes!.map(node => ({
    id: node.id, localKey: node.id, parentLocalKey: node.parentId ?? null,
    title: node.title, purpose: node.purpose ?? '',
    quote: guide.nodeLinks.find(link => link.nodeId === node.id)!.anchor.quote,
    sceneIds: unit.scenes.filter(scene => scene.structureNodeId === node.id).map(scene => scene.id),
  }));
}

function workspace(project: ScriptProject) {
  return {
    id: 'workspace_outline_review', documentId: project.id, ownerId: 'owner_outline_review',
    revision: project.revision, document: project,
  };
}

test('ordinary joint candidate rebuilds its adoption grant without requiring a scene target', () => {
  const project = fixture(), work = workspace(project);
  const scope = scopeFor(project, freezeOutlineGrant(project, project.outlineGuides![0].owner));
  const candidate = candidateFor(project, scope, result(project, {content: `${project.brief.outline}尾注。`}));
  const record = {
    id: candidate.request.candidateId, status: 'VALID', candidate, request: candidate.request,
    workspaceId: work.id, runId: 'run_outline_review', authorizationId: 'auth_outline_review', baseRef: workspaceRef(work),
  };
  // Exercise the real command boundary with inert repository reads; no SQLite or model is involved.
  const service = {deps: {
    drafts: {readCandidate: () => record},
    authorizations: {read: () => ({id: 'auth_outline_review', workspaceId: work.id, scope, sources: []})},
    store: {readRun: (runId: string) => {
      assert.equal(runId, record.runId);
      return {id: runId, input: {}};
    }, db: {prepare: () => ({get: () => undefined})}},
  }};
  const adopted = (ScriptCommandService.prototype as any).applyScope.call(service, work, record.id, work.ownerId);
  assert.deepEqual(adopted.scope.outlineGrants, scope.outlineGrants);
  assert.equal(adopted.scope.units[0].unitId, project.units[0].id);
  const rebuilt = candidateFor(project, adopted.scope, candidate.result);
  assert.deepEqual(rebuilt.patch, candidate.patch);
});

test('text-only command grants no implicit structure or scene-order write', () => {
  const project = fixture(), work = workspace(project);
  const prepared = (ScriptCommandService.prototype as any).manualScope.call({deps: {}}, work, {
    operation: 'outline_development', instruction: '只润色原文，保留结构和场序。',
    source: {kind: 'WORKSPACE'}, target: {unitId: project.units[0].id, scopeId: project.id},
  }) as {scope: ScriptDraftScope};
  assert.equal(prepared.scope.outlineGrants![0].allowStructure, false);
  assert.equal(prepared.scope.outlineGrants![0].allowSceneOrder, false);
  const candidate = candidateFor(project, prepared.scope, result(project, {nodes: modelNodes(project)}));
  const after = applyWorkspacePatch(project, candidate.patch);
  assert.deepEqual(after.units, project.units);
  assert.ok(candidate.delivery?.errors.some(message => /结构/.test(message)));
});

test('unchanged structure preserves ungrouped prologue, interlude, epilogue and every body', () => {
  const project = fixture({ungrouped: true}), unit = project.units[0];
  const scope = scopeFor(project, freezeOutlineGrant(project, project.outlineGuides![0].owner, {allowStructure: true, allowSceneOrder: true}));
  const candidate = candidateFor(project, scope, result(project, {nodes: modelNodes(project)}));
  const after = applyWorkspacePatch(project, candidate.patch);
  assert.deepEqual(after.units[0].scenes, unit.scenes);
  assert.deepEqual(after.units[0].scenes.map(scene => scene.title), ['序幕', 'A场', '间场', 'B场', '尾声']);
});

test('removing a beat cannot silently remove separately protected scene edges', () => {
  const project = fixture(), unit = project.units[0];
  project.outlineGuides![0].beats[0].sceneRefs = [{unitId: unit.id, sceneId: unit.scenes[0].id}];
  const scope = scopeFor(project, freezeOutlineGrant(project, project.outlineGuides![0].owner));
  const candidate = candidateFor(project, scope, result(project, {beats: []}));
  const after = applyWorkspacePatch(project, candidate.patch);
  assert.deepEqual(after.outlineGuides![0].beats, project.outlineGuides![0].beats);
  assert.ok(candidate.delivery?.missing.includes('beats'));
  assert.ok(candidate.delivery?.errors.some(message => /解除.*场景关联|场景关联.*写权/.test(message)));
  assert.equal(stageDelivery(after, scope, 'OUTLINE').ready, false);
  assert.equal(project.outlineGuides![0].beats[0].sceneRefs.length, 1);
});

test('authorized sibling reorder inside a parent moves scene intervals recursively without rewriting bodies', () => {
  const project = fixture({nested: true}), unit = project.units[0];
  const scope = scopeFor(project, freezeOutlineGrant(project, project.outlineGuides![0].owner, {allowStructure: true, allowSceneOrder: true}));
  const rows = modelNodes(project), root = {...rows[0], quote: 'B段。A段。'};
  const candidate = candidateFor(project, scope, result(project, {content: 'B段。A段。', nodes: [root, rows[2], rows[1]]}));
  const after = applyWorkspacePatch(project, candidate.patch);
  assert.deepEqual(after.units[0].structureNodes!.map(node => node.id), ['node_root', 'node_b', 'node_a']);
  assert.deepEqual(after.units[0].scenes.map(scene => scene.id), [unit.scenes[1].id, unit.scenes[0].id]);
  for (const scene of after.units[0].scenes) assert.deepEqual(scene, unit.scenes.find(old => old.id === scene.id));
  const noOrder = scopeFor(project, freezeOutlineGrant(project, project.outlineGuides![0].owner, {allowStructure: true}));
  const partial = candidateFor(project, noOrder, result(project, {content: 'B段。A段。', nodes: [root, rows[2], rows[1]]}));
  assert.deepEqual(applyWorkspacePatch(project, partial.patch).units, project.units);
  assert.ok(partial.delivery?.missing.includes('nodes'));
  assert.ok(partial.delivery?.errors.some(message => /场序/.test(message)));
});

test('local text-only rewrite preserves stale beat evidence instead of requiring an unrequested beat rewrite', () => {
  const project = fixture(), owner = project.outlineGuides![0].owner;
  const scope = scopeFor(project, freezeOutlineGrant(project, owner, {nodeId: 'node_a'}));
  const candidate = candidateFor(project, scope, result(project, {content: 'A段新增行动。'}));
  const after = applyWorkspacePatch(project, candidate.patch), guide = getOutlineGuide(after, owner)!;
  assert.equal(after.brief.outline, 'A段新增行动。B段。');
  assert.deepEqual(after.units, project.units);
  assert.deepEqual(guide.beats, project.outlineGuides![0].beats);
  assert.equal(anchorCurrent(guide.beats[0].anchors[0], after.brief.outline), false);
  assert.equal(anchorCurrent(guide.nodeLinks.find(link => link.nodeId === 'node_b')!.anchor, after.brief.outline), true);
});

test('frozen local grant rejects a rebound or deleted node even when the source text is unchanged', () => {
  const origin = fixture(), owner = origin.outlineGuides![0].owner;
  const scope = scopeFor(origin, freezeOutlineGrant(origin, owner, {nodeId: 'node_a'}));
  const rebound = structuredClone(origin);
  rebound.revision++;
  rebound.outlineGuides![0].nodeLinks = [{
    unitId: rebound.units[0].id, nodeId: 'node_a', anchor: anchorFor(rebound.brief.outline, 3, 6),
  }];
  parseScriptProject(rebound);
  assert.throws(() => candidateFor(rebound, scope, result(rebound, {content: '改写A段。'}), origin), /关联已变化/);

  const removed = structuredClone(origin);
  removed.revision++;
  removed.units[0].structureNodes = removed.units[0].structureNodes!.filter(node => node.id !== 'node_a');
  removed.units[0].scenes.forEach(scene => {if (scene.structureNodeId === 'node_a') delete scene.structureNodeId;});
  removed.outlineGuides![0].nodeLinks = removed.outlineGuides![0].nodeLinks.filter(link => link.nodeId !== 'node_a');
  parseScriptProject(removed);
  assert.throws(() => candidateFor(removed, scope, result(removed, {content: '改写A段。'}), origin), /关联已变化/);
});

test('film scene planning excludes legacy-summary beats once the full outline owns the story', () => {
  const project = fixture(), unit = project.units[0], owner: OutlineOwner = {kind: 'unit', id: unit.id};
  unit.summary = '旧摘要：人物死亡。';
  project.outlineGuides!.push({
    id: outlineGuideId(owner), owner, nodeLinks: [], beats: [{
      id: 'legacy_beat', title: '旧稿人物死亡', change: '死亡',
      anchors: [anchorFor(unit.summary, 0, unit.summary.length)], unitIds: [unit.id], sceneRefs: [],
    }],
  });
  parseScriptProject(project);
  assert.deepEqual(unitOutlineOwner(project, unit), {kind: 'project', id: project.id});
  assert.deepEqual(beatsForUnit(project, unit).map(entry => entry.beat.id), ['beat_a']);
  assert.equal(getOutlineGuide(project, owner)!.beats[0].id, 'legacy_beat', 'old material remains saved and inspectable');
});

test('joint outline completion remains partial until the requested relations have been delivered', () => {
  const project = fixture(), owner = project.outlineGuides![0].owner;
  const scope = scopeFor(project, freezeOutlineGrant(project, owner, {allowStructure: true}));
  const partial = applyWorkspacePatch(project, candidateFor(project, scope, result(project)).patch);
  assert.equal(stageDelivery(partial, scope, 'OUTLINE').ready, false);
  const complete: AgentDraftCandidate = candidateFor(project, scope, result(project, {nodes: modelNodes(project), beats: []}));
  const after = applyWorkspacePatch(project, complete.patch);
  assert.equal(stageDelivery(after, scope, 'OUTLINE').ready, true);
});

test('a local development receipt cannot certify a wider outline structure that it did not deliver', () => {
  const project = fixture(), owner = project.outlineGuides![0].owner;
  project.outlineGuides![0].nodeLinks = project.outlineGuides![0].nodeLinks.filter(link => link.nodeId === 'node_a');
  const local = scopeFor(project, freezeOutlineGrant(project, owner, {nodeId: 'node_a'}));
  const node = modelNodes({...project, units: [{...project.units[0], structureNodes: [project.units[0].structureNodes![0]]}]})[0];
  const after = applyWorkspacePatch(project, candidateFor(project, local, result(project, {
    content: 'A段。', nodes: [node], beats: [],
  })).patch);
  assert.equal(stageDelivery(after, local, 'OUTLINE').ready, true);
  const whole = scopeFor(after, freezeOutlineGrant(after, owner, {allowStructure: true}));
  assert.equal(stageDelivery(after, whole, 'OUTLINE').ready, false, 'node_b still has no delivered original-text association');
});

test('local completion metadata cannot hide a stale retained beat or omit a delivered beat identity', () => {
  const project = fixture(), owner = project.outlineGuides![0].owner;
  const scope = scopeFor(project, freezeOutlineGrant(project, owner, {nodeId: 'node_a'}));
  const content = 'A段新增证据。', node = {...modelNodes(project)[0], quote: content};
  const value = result(project, {content, nodes: [node], beats: null});
  const candidate = candidateFor(project, scope, value);
  const after = applyWorkspacePatch(project, candidate.patch), guide = getOutlineGuide(after, owner)!;
  assert.equal(guide.development!.beats, false);
  assert.deepEqual(guide.development!.beatIds, []);
  assert.equal(anchorCurrent(guide.beats[0].anchors[0], after.brief.outline), false);
  assert.equal(stageDelivery(after, scope, 'OUTLINE').ready, false);

  guide.development!.beats = true;
  const forgedPatch = createWorkspacePatch(project, after);
  const check = {...candidate.request, origin: project, ledger: emptyScriptDraftCreationLedger()};
  assert.throws(() => assertAgentDraftScope(project, forgedPatch, scope, 'outline_development', check), /节拍交付记录未对应/);

  // This repository check predates the independent typed-patch fix: the raw
  // model result must rebuild to the same patch before ordinary adoption.
  const work = workspace(project), auth = {id: 'auth_outline_review', workspaceRef: workspaceRef(work)};
  const record = {status: 'VALID', workspaceId: work.id, baseRef: workspaceRef(work), raw: JSON.stringify(value),
    request: candidate.request, candidate: {...candidate, patch: forgedPatch}};
  const repository = {
    authorizations: {forRun: () => auth, withRunAuthorization: (_run: unknown, _intent: unknown, read: () => unknown) => read()},
    readCandidate: () => record,
    workspaces: {read: () => work, version: () => project},
    scopeForRun: () => scope, ledger: emptyScriptDraftCreationLedger,
  };
  assert.throws(() => (ScriptDraftStore.prototype as any).preflightCandidate.call(repository,
    {ownerId: work.ownerId}, candidate.request.candidateId), /候选身份或补丁已变化/);

  const complete = candidateFor(project, scope, {...value, beats: [{
    id: 'beat_a', localKey: 'A', title: '发现证据', change: '取得证据', quotes: [content], unitIds: [project.units[0].id],
  }]});
  const completeAfter = applyWorkspacePatch(project, complete.patch);
  assert.equal(stageDelivery(completeAfter, scope, 'OUTLINE').ready, true);
  getOutlineGuide(completeAfter, owner)!.development!.beatIds = [];
  assert.throws(() => assertAgentDraftScope(project, createWorkspacePatch(project, completeAfter), scope,
    'outline_development', check), /节拍交付记录未对应/);
});

test('local outline completion requires its surviving node and current original-text association', () => {
  const project = fixture(), owner = project.outlineGuides![0].owner;
  const scope = scopeFor(project, freezeOutlineGrant(project, owner, {nodeId: 'node_a'}));
  const candidate = candidateFor(project, scope, result(project, {content: 'A段。', nodes: [modelNodes(project)[0]], beats: []}));
  const complete = applyWorkspacePatch(project, candidate.patch);
  assert.equal(stageDelivery(complete, scope, 'OUTLINE').ready, true);

  const unlinked = structuredClone(complete);
  getOutlineGuide(unlinked, owner)!.nodeLinks = getOutlineGuide(unlinked, owner)!.nodeLinks.filter(link => link.nodeId !== 'node_a');
  parseScriptProject(unlinked);
  assert.equal(stageDelivery(unlinked, scope, 'OUTLINE').ready, false, 'an empty link selection is not a delivery');
  assert.throws(() => assertAgentDraftScope(project, createWorkspacePatch(project, unlinked), scope, 'outline_development', {
    ...candidate.request, origin: project, ledger: emptyScriptDraftCreationLedger(),
  }), /当前段落尚未关联有效原文/);

  const removed = structuredClone(unlinked);
  removed.units[0].structureNodes = removed.units[0].structureNodes!.filter(node => node.id !== 'node_a');
  removed.units[0].scenes.forEach(scene => {if (scene.structureNodeId === 'node_a') delete scene.structureNodeId;});
  parseScriptProject(removed);
  assert.equal(stageDelivery(removed, scope, 'OUTLINE').ready, false, 'a deleted target must not satisfy the old stop condition');
});
