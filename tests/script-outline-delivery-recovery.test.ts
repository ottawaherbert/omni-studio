import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { anchorCurrent, anchorFor, freezeOutlineGrant, outlineGuideId, outlineHash } from '../packages/script/src/outlineGuides';
import { buildOutlineDevelopment } from '../packages/script/src/outlineDevelopment';
import { stageDelivery } from '../packages/script/src/agentStages';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';
import type { ScriptDraftRecord } from '../apps/api/src/repositories/scriptDraftStore';
import type { ScriptProject } from '../packages/script/src/schema';

const original = '工人发现站台无人。他决定留下等女儿。';
const partial = { summary: '隔离机械样例', content: original,
  nodes: [{ id: null, localKey: 'waiting', parentLocalKey: null, title: '决定等待', purpose: '作出选择', quote: original, sceneIds: [] }],
  beats: null };
const completed = (unitId: string) => ({ ...partial, beats: [{ id: null, localKey: 'choice', title: '他决定留下',
  change: '不再逃走', quotes: ['他决定留下等女儿。'], unitIds: [unitId] }] });
const decision = JSON.stringify({ kind: 'CALL', operation: 'outline_development', entityId: null, analysis: null, question: '', options: [] });
const resolve = { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external' as const, routeRef: 'isolated-recovery' }) };

function fixture(t: TestContext, maxInvocations?: number, local?: {
  prepare: (project: ScriptProject) => void;
  selection: { nodeId?: string; outlineRange?: { start: number; end: number; text: string }; outlineStructure?: boolean };
}) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('NO_REAL_MODEL'); } },
    'outline-delivery-review', { trustedLegacyProjectOwner: 'author' });
  const thread = host.conversations.open('author', 'script:home', 'outline-delivery-review');
  const project = createScriptProject('仅供恢复回归', createScriptCreationProfile('short-film', 1, 5));
  local?.prepare(project);
  const author = host.scripts.saveProject(project, 0);
  const workspace = host.workspaces.create({ ownerId: 'author', threadId: thread.id, requestId: 'workspace',
    source: { projectId: author.id, revision: author.revision } });
  const selection = { workspaceId: workspace.id, expectedRevision: workspace.revision, unitId: workspace.document.units[0].id,
    scopeId: workspace.document.id, outlineStructure: true, outlineSceneOrder: false, ...local?.selection };
  const text = '整理大纲、结构和关键节拍';
  const accepted = host.commands.acceptChatTurn({ ownerId: 'author', threadId: thread.id, requestId: 'joint-request', expectedVersion: 1,
    requestEnvelope: { text, selection }, payload: { text, selection, methods: [],
      template: '{{taskContract}}\n{{conversation}}\n{{methodInstructions}}', channel: 'external', routeRef: 'isolated-recovery' },
    text, methods: [], route: { channel: 'external', routeRef: 'isolated-recovery' }, selection });
  const runId = accepted.conversation.turns.find(turn => turn.id === accepted.turnId)!.runId!;
  if (maxInvocations !== undefined) db.prepare('UPDATE agent_runs SET max_invocations=? WHERE id=?').run(maxInvocations, runId);
  const readWorkspace = () => host.workspaces.read(workspace.id, 'author');
  const records = () => (db.prepare('SELECT data_json FROM script_draft_candidates ORDER BY rowid').all() as Array<{ data_json: string }>)
    .map(row => JSON.parse(row.data_json) as ScriptDraftRecord);
  return { db, host, thread, author, workspace, runId, readWorkspace, records, answered: new Set<string>() };
}

async function tick(h: ReturnType<typeof fixture>, runId: string, outputs: string[]) {
  await h.host.worker.runOnce(runId);
  await h.host.childWorker.runOnce(runId);
  const request = h.host.journal.listExternal(runId, 'author').find(item => !h.answered.has(item.id));
  if (request && outputs.length) {
    h.host.journal.submitExternal(request.id, 'author', request.inputHash, outputs.shift()!, { name: 'isolated-mechanical-response' });
    h.answered.add(request.id);
  }
}

async function until(h: ReturnType<typeof fixture>, runId: string, outputs: string[], done: () => boolean) {
  for (let i = 0; i < 35; i++) {
    await tick(h, runId, outputs);
    if (done()) return h.host.store.readRun(runId);
  }
  assert.fail(`执行未到达测试停点：${JSON.stringify(h.host.store.readRun(runId))}`);
}

const terminal = (h: ReturnType<typeof fixture>, runId: string) => ['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(h.host.store.readRun(runId).status);

async function apply(h: ReturnType<typeof fixture>, candidate: ScriptDraftRecord, requestId: string) {
  const workspace = h.readWorkspace();
  const command = await h.host.commands.submit('author', { kind: 'APPLY', requestId, threadId: h.thread.id,
    expectedConversationVersion: h.host.conversations.read(h.thread.id, 'author').version,
    workspaceId: workspace.id, candidateId: candidate.id, expectedRevision: workspace.revision, writerEpoch: workspace.writerEpoch }, resolve);
  const run = await until(h, command.runId, [], () => terminal(h, command.runId));
  assert.equal(run.status, 'SUCCEEDED', JSON.stringify(run));
  return h.readWorkspace();
}

function publish(h: ReturnType<typeof fixture>, outlineOnly: boolean) {
  const workspace = h.readWorkspace(), author = h.host.scripts.getProject(h.author.id)!;
  const proposal = h.host.workspaces.prepareAdoption({ ownerId: 'author', workspaceId: workspace.id,
    workspaceRevision: workspace.revision, expectedAuthorRevision: author.revision, outlineOnly });
  return h.host.workspaces.adopt({ ownerId: 'author', workspaceId: workspace.id, requestId: `publish-${outlineOnly}`,
    proposalId: proposal.id, digest: proposal.digest });
}

function continueCommand(h: ReturnType<typeof fixture>, candidate: ScriptDraftRecord, requestId: string) {
  const workspace = h.readWorkspace();
  return h.host.commands.submit('author', { kind: 'PROPOSE', requestId, threadId: h.thread.id,
    expectedConversationVersion: h.host.conversations.read(h.thread.id, 'author').version,
    source: { kind: 'WORKSPACE', workspaceId: workspace.id, expectedRevision: workspace.revision },
    operation: 'outline_development', instruction: '保留已完成内容，只补齐缺项', methodIds: [],
    target: { unitId: candidate.request.unitId, scopeId: candidate.request.scopeId,
      ...(candidate.request.nodeId ? { nodeId: candidate.request.nodeId } : {}), repairCandidateId: candidate.id } }, resolve);
}

test('a completed node outline can stop despite an unrelated stale node and beat', () => {
  const project = createScriptProject('仅供局部停点回归', createScriptCreationProfile('short-film', 1, 5));
  project.brief.outline = '甲段。乙段。';
  const unit = project.units[0], owner = { kind: 'project' as const, id: project.id };
  unit.structureNodes = [{ id: 'node_a', title: '甲', purpose: '' }, { id: 'node_b', title: '乙', purpose: '' }];
  project.outlineGuides = [{ id: outlineGuideId(owner), owner,
    nodeLinks: [{ nodeId: 'node_a', unitId: unit.id, anchor: anchorFor(project.brief.outline, 0, 3) },
      { nodeId: 'node_b', unitId: unit.id, anchor: anchorFor('甲段。旧段。', 3, 6) }],
    beats: [{ id: 'outside_old_beat', title: '旧变化', change: '旧规划', anchors: [anchorFor('甲段。旧段。', 3, 6)], unitIds: [unit.id], sceneRefs: [] }] }];
  const grant = freezeOutlineGrant(project, owner, { nodeId: 'node_a' });
  const next = buildOutlineDevelopment(project, grant, unit.id, 'local-recovery', {
    summary: '只细化甲段', content: '甲段新增更多行动。', nodes: [{ id: 'node_a', localKey: 'a', parentLocalKey: null,
      title: '甲', purpose: '', quote: '甲段新增更多行动。', sceneIds: [] }], beats: [] });
  const scope = { units: [{ unitId: unit.id }], outlineGrants: [grant] } as ScriptDraftScope;
  const delivery = stageDelivery(next, scope, 'OUTLINE');
  assert.equal(delivery.ready, true);
  assert.deepEqual(delivery.gaps, []);
  const guide = next.outlineGuides![0];
  assert.equal(anchorCurrent(guide.nodeLinks.find(link => link.nodeId === 'node_b')!.anchor, next.brief.outline), false);
  assert.deepEqual(guide.beats[0], project.outlineGuides[0].beats[0], '段外失效证据须原样保留，不靠删除换取完成');
  const incomplete = structuredClone(next);
  incomplete.outlineGuides![0].development!.beats = false;
  assert.equal(stageDelivery(incomplete, scope, 'OUTLINE').ready, false, '本段缺项仍阻断完成');
});

test('joint invocation budget stops before repair without losing the valid partial candidate', async t => {
  const h = fixture(t, 2);
  const state = await until(h, h.runId, [decision, JSON.stringify(partial)], () => terminal(h, h.runId));
  assert.equal(state.status, 'PARTIAL');
  assert.equal(state.reason, 'BUDGET_EXHAUSTED');
  assert.equal(state.invocationCount, 2);
  assert.equal(h.records().length, 1);
  assert.deepEqual(h.records()[0].candidate!.delivery!.missing, ['beats']);
  assert.equal(h.readWorkspace().revision, h.workspace.revision);
  for (let i = 0; i < 3; i++) await tick(h, h.runId, []);
  assert.equal(h.host.store.readRun(h.runId).invocationCount, 2);
});

test('pausing a waiting repair fences further calls and resumes the same frozen invocation', async t => {
  const h = fixture(t), outputs = [decision, JSON.stringify(partial)];
  const before = await until(h, h.runId, outputs, () => h.records().length === 1 &&
    h.host.journal.listExternal(h.runId, 'author').some(item => !h.answered.has(item.id)));
  const request = h.host.journal.listExternal(h.runId, 'author').find(item => !h.answered.has(item.id))!;
  const priorRecord = structuredClone(h.records()[0]);
  h.host.store.control(h.runId, 'author', before.version, 'pause', 'pause-repair');
  for (let i = 0; i < 3; i++) await tick(h, h.runId, []);
  const paused = h.host.store.readRun(h.runId);
  assert.equal(paused.status, 'PAUSED');
  assert.equal(paused.invocationCount, before.invocationCount);
  assert.deepEqual(h.records()[0], priorRecord);
  assert.equal(h.readWorkspace().revision, h.workspace.revision);
  h.host.store.control(h.runId, 'author', paused.version, 'resume', 'resume-repair');
  h.host.journal.submitExternal(request.id, 'author', request.inputHash,
    JSON.stringify(completed(h.workspace.document.units[0].id)), { name: 'isolated-resumed-response' });
  h.answered.add(request.id);
  const resumed = await until(h, h.runId, [], () => terminal(h, h.runId));
  assert.equal(resumed.status, 'SUCCEEDED', JSON.stringify(resumed));
  assert.equal(resumed.invocationCount, before.invocationCount);
  assert.equal(h.records().length, 2);
  assert.deepEqual(h.records()[1].candidate!.delivery!.missing, []);
});

for (const outlineOnly of [false, true]) {
  test(`an adopted partial candidate can repair missing beats while preserving existing identities (outlineOnly=${outlineOnly})`, async t => {
    const h = fixture(t, 2);
    await until(h, h.runId, [decision, JSON.stringify(partial)], () => terminal(h, h.runId));
    const prior = h.records()[0], originalRecord = structuredClone(prior);
    await apply(h, prior, 'apply-original');
    publish(h, outlineOnly);
    const before = h.readWorkspace(), nodeId = before.document.units[0].structureNodes![0].id;
    const authorBefore = h.host.scripts.getProject(h.author.id)!;
    const next = await continueCommand(h, prior, 'continue-missing');
    const grant = (h.host.authorizations.read(next.authorizationRef, 'author').scope as ScriptDraftScope).outlineGrants![0];
    assert.equal(grant.sourceHash, outlineHash(original));
    const run = await until(h, next.runId, [JSON.stringify(completed(before.document.units[0].id))], () => terminal(h, next.runId));
    assert.equal(run.status, 'SUCCEEDED', JSON.stringify(run));
    const repaired = h.records().at(-1)!;
    assert.notEqual(repaired.id, prior.id);
    assert.equal(repaired.status, 'VALID', repaired.error ?? 'valid repair expected');
    assert.deepEqual(repaired.candidate!.delivery!.missing, []);
    assert.equal(repaired.request.identitySeed, prior.request.identitySeed || prior.id);
    assert.equal(repaired.baseRef.version, String(before.revision));
    assert.deepEqual(h.records()[0], originalRecord);
    assert.deepEqual(h.host.scripts.getProject(h.author.id), authorBefore, '补齐只生成候选，不自动采用');
    const applied = await apply(h, repaired, 'apply-repaired');
    assert.equal(applied.document.units[0].structureNodes![0].id, nodeId);
    assert.equal(applied.document.brief.outline, original);
    assert.equal(applied.document.outlineGuides![0].beats.length, 1);
    assert.equal(stageDelivery(applied.document, h.host.authorizations.read(next.authorizationRef, 'author').scope as ScriptDraftScope, 'OUTLINE').ready, true);
  });
}

test('adopted-candidate recovery rejects a later manuscript edit rather than broadening the old repair grant', async t => {
  const h = fixture(t, 2);
  await until(h, h.runId, [decision, JSON.stringify(partial)], () => terminal(h, h.runId));
  const candidate = h.records()[0];
  await apply(h, candidate, 'apply-before-change');
  publish(h, false);
  const workspace = h.readWorkspace(), edited = structuredClone(workspace.document);
  edited.brief.outline += '作者后来另写的结尾。';
  h.host.workspaces.saveAuthor({ ownerId: 'author', workspaceId: workspace.id, requestId: 'author-change',
    expectedRevision: workspace.revision, expectedEpoch: workspace.writerEpoch, document: edited });
  await assert.rejects(() => continueCommand(h, candidate, 'stale-repair'), /采用后又有其他修改/);
  assert.equal(h.records().length, 1);
  assert.equal(h.readWorkspace().document.brief.outline, edited.brief.outline);
});

const localPrefix = '前文。', localSuffix = '后文。', expandedLocal = `${original}他锁上了站门。`;
function localFixture(t: TestContext, node: boolean) {
  return fixture(t, 2, {
    prepare(project) {
      project.brief.outline = localPrefix + original + localSuffix;
      if (node) {
        const unit = project.units[0], owner = { kind: 'project' as const, id: project.id };
        unit.structureNodes = [{ id: 'node_waiting', title: '决定等待', purpose: '作出选择' }];
        project.outlineGuides = [{ id: outlineGuideId(owner), owner, beats: [], nodeLinks: [{
          unitId: unit.id, nodeId: 'node_waiting', anchor: anchorFor(project.brief.outline, localPrefix.length, localPrefix.length + original.length),
        }] }];
      }
    },
    selection: node ? { nodeId: 'node_waiting', outlineStructure: false }
      : { outlineRange: { start: localPrefix.length, end: localPrefix.length + original.length, text: original }, outlineStructure: false },
  });
}

function localPartial(node: boolean) {
  return { ...partial, content: expandedLocal, nodes: node ? [{ ...partial.nodes[0], id: 'node_waiting', quote: expandedLocal }] : null };
}

for (const node of [true, false]) {
  test(`adopted ${node ? 'node' : 'plain text range'} partial keeps its exact expanded range when repairing beats`, async t => {
    const h = localFixture(t, node), value = localPartial(node);
    await until(h, h.runId, [decision, JSON.stringify(value)], () => terminal(h, h.runId));
    const prior = h.records()[0], originalRecord = structuredClone(prior);
    assert.equal(prior.status, 'VALID', prior.error ?? 'local partial expected');
    assert.deepEqual(prior.candidate!.delivery!.missing, ['beats']);
    await apply(h, prior, 'apply-local-original');
    publish(h, false);
    const before = h.readWorkspace(), authorBefore = h.host.scripts.getProject(h.author.id)!;
    const command = await continueCommand(h, prior, 'continue-local-beats');
    const scope = h.host.authorizations.read(command.authorizationRef, 'author').scope as ScriptDraftScope;
    const grant = scope.outlineGrants![0];
    assert.equal(grant.start, localPrefix.length);
    assert.equal(grant.end, localPrefix.length + expandedLocal.length);
    assert.equal(grant.nodeId, node ? 'node_waiting' : undefined);
    assert.equal(grant.allowStructure, false);
    assert.equal(grant.allowSceneOrder, false);
    assert.equal(grant.sourceHash, outlineHash(localPrefix + expandedLocal + localSuffix));
    const output = { ...value, beats: completed(before.document.units[0].id).beats };
    const run = await until(h, command.runId, [JSON.stringify(output)], () => terminal(h, command.runId));
    assert.equal(run.status, 'SUCCEEDED', JSON.stringify(run));
    const repaired = h.records().at(-1)!;
    assert.equal(repaired.status, 'VALID', repaired.error ?? 'valid local repair expected');
    assert.deepEqual(repaired.candidate!.delivery!.missing, []);
    assert.equal(repaired.request.identitySeed, prior.request.identitySeed || prior.id);
    assert.deepEqual(h.records()[0], originalRecord);
    assert.deepEqual(h.host.scripts.getProject(h.author.id), authorBefore, '补齐候选不会自动采用');
    const applied = await apply(h, repaired, 'apply-local-repaired');
    assert.equal(applied.document.brief.outline, localPrefix + expandedLocal + localSuffix);
    assert.deepEqual(applied.document.units, before.document.units, '局部补齐不修改目录、场景或正文');
    assert.equal(applied.document.outlineGuides![0].beats.length, 1);
    const anchors = applied.document.outlineGuides![0].beats[0].anchors;
    assert.ok(anchors.every(anchor => anchorCurrent(anchor, applied.document.brief.outline)
      && anchor.start >= grant.start && anchor.end <= grant.end));
    if (node) assert.equal(stageDelivery(applied.document, scope, 'OUTLINE').ready, true);
  });
}

test('adopted node recovery rejects stale or shortened links without falling back to the whole outline', async t => {
  for (const shortened of [false, true]) {
    const h = localFixture(t, true);
    const value = localPartial(true);
    if (shortened) value.nodes![0].quote = '他决定留下等女儿。';
    else value.nodes = null;
    await until(h, h.runId, [decision, JSON.stringify(value)], () => terminal(h, h.runId));
    const prior = h.records()[0];
    assert.equal(prior.status, 'VALID', prior.error ?? 'partial original expected');
    await apply(h, prior, 'apply-local-without-whole-link');
    publish(h, false);
    const before = h.readWorkspace();
    await assert.rejects(() => continueCommand(h, prior, 'reject-expanded-repair'),
      shortened ? /原文关联改变/ : /本段尚未关联当前大纲/);
    assert.equal(h.records().length, 1);
    assert.deepEqual(h.readWorkspace(), before, '拒绝恢复不扩大范围或改动原稿');
  }
});
