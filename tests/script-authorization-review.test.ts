import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type ResourceRef, type CapabilityRequest, type PreparedCall } from '../packages/agent-core/src';
import { compileContext, memorySection, type ContextAccess } from '../packages/agent-context/src';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal, SqliteGoalStore, SqliteBudgetStore, SqliteHistoryStore } from '../packages/agent-sqlite/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore, type ScriptReadSource } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';

// Independent authority fault tests. Text is a mechanical marker, no model or network.
function fixture(t: any) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  new SqliteModelJournal(store).ensureSchema();
  const conversations = new SqliteConversationStore(store); conversations.ensureSchema();
  const thread = conversations.open('author', 'script:home', 'independent-authority-review');
  const scripts = createScriptRepository(db); scripts.ensureSchema();
  const workspaces = new ScriptWorkspaceStore(store, scripts); workspaces.ensureSchema();
  const doc = createScriptProject('机械来源校验', createScriptCreationProfile('tv-series', 2, 20));
  doc.units.push(newUnit('第二单元', 1200000, doc.id));
  doc.units[0].scenes[0].blocks[0].text = 'UNIT_ONE_PROTOCOL_MARKER';
  doc.units[1].scenes[0].blocks[0].text = 'UNIT_TWO_PROTOCOL_MARKER';
  const project = scripts.saveProject(doc, 0);
  const target = createScriptProject('机械授权工作稿', createScriptCreationProfile('tv-series', 2, 20));
  const workspace = workspaces.create({ ownerId: 'author', threadId: thread.id, requestId: 'create-target', source: { document: target } });
  const access = { ownerId: 'author', scopeId: workspace.id, branch: `workspace:${workspace.id}` };
  const projectRef: ResourceRef = { uri: `resource://script/projects/${project.id}`, version: String(project.revision), contentHash: hashValue(project), branch: 'author' };
  const broad: ScriptReadSource = { ref: projectRef, access: { ownerId: 'author', scopeId: project.id, branch: 'author' }, purpose: 'PREVIOUS_SCRIPT', unitIds: null };
  let authority: ScriptAuthorizationStore;
  let contexts: SqliteContextStore;
  const readSource = (source: ScriptReadSource): unknown => {
    authority.assertSourceIntersection(source);
    const url = new URL(source.ref.uri);
    if (source.purpose === 'CONVERSATION') {
      assert.equal(conversations.sourceAllowed(source.ref, source.access.ownerId, source.access.scopeId, refs => {
        for (const ref of refs) contexts.assertVisible(ref, source.access);
        return true;
      }), true);
      const row = db.prepare('SELECT data_json FROM agent_conversation_sources WHERE id=?').get(url.pathname.slice(1)) as any;
      return JSON.parse(row.data_json);
    }
    assert.equal(source.access.scopeId, project.id);
    assert.ok(scripts.getProject(project.id));
    const stored = scripts.readProjectInput(project.id, Number(source.ref.version))!;
    assert.equal(hashValue(stored), source.ref.contentHash);
    assert.ok(source.unitIds === null || source.unitIds.every(id => stored.units.some(unit => unit.id === id)));
    scripts.captureProjectInput(stored);
    return { ...stored, units: stored.units.filter(unit => source.unitIds === null || source.unitIds.includes(unit.id)) };
  };
  authority = new ScriptAuthorizationStore(store, workspaces, { validateScope() {}, readSource }); authority.ensureSchema();
  contexts = new SqliteContextStore(store, (dependency, sourceAccess) => {
    if (new URL(dependency.ref.uri).pathname.startsWith('/read-grants/')) return authority.sourceAllowed(dependency, sourceAccess);
    try {
      readSource({ ref: dependency.ref, access: sourceAccess, purpose: 'PREVIOUS_SCRIPT', unitIds: null });
      return true;
    } catch { return false; }
  }); contexts.ensureSchema();
  const issue = (commandId: string, sources: ScriptReadSource[], request?: CapabilityRequest) => {
    const auth = authority.issue({ ownerId: 'author', threadId: thread.id, workspaceId: workspace.id, commandId, scope: {}, sources });
    const accepted = store.accept({ ownerId: 'author', scopeId: 'script:home', threadId: thread.id, requestId: commandId, kind: 'CAPABILITY', input: { authorizationRef: auth.id, ...(request ? { request } : {}) }, policyRevision: 'protocol', maxInvocations: 1 });
    authority.bind(auth.id, 'author', { kind: 'RUN', runId: accepted.runId, inputRevision: 1 });
    return { auth, run: store.readRun(accepted.runId), grant: authority.grants(auth.id, 'author')[0] };
  };
  const narrow = { ...broad, unitIds: [project.units[0].id] };
  return { db, store, scripts, workspaces, contexts, conversations, authority, thread, workspace, access, project, broad, narrow, issue };
}

test('a new narrow authorization cannot reuse the frozen full-script grant or its derived memory closure', t => {
  const h = fixture(t), old = h.issue('old-wide', [h.broad]), next = h.issue('new-narrow', [h.narrow]);
  const oldGrantRef = h.authority.ref(old.grant);
  const first = h.contexts.createMemory(h.access, 'model', 'derived-one', { key: 'review.first', kind: 'DOMAIN_DERIVED', content: { label: '机械摘要', value: 'UNIT_ONE_AND_TWO_DERIVED_MARKER' }, dependencies: [{ ref: oldGrantRef, freshness: 'EXACT' }] });
  const second = h.contexts.createMemory(h.access, 'model', 'derived-two', { key: 'review.second', kind: 'DOMAIN_DERIVED', content: { label: '机械二级摘要', value: 'SECOND_LEVEL_DERIVED_MARKER' }, dependencies: memorySection(h.contexts.getMemory(first.id, h.access)).dependencies });
  const bundle = compileContext({ systemInstruction: 'Mechanical authorization test', sections: [memorySection(h.contexts.getMemory(second.id, h.access))], skills: [] });
  const frozen = h.contexts.capture(h.access, bundle);
  assert.doesNotThrow(() => h.authority.withRunAuthorization(old.run, 'VIEW', () => h.contexts.assertVisible(frozen, h.access)));
  assert.throws(() => h.authority.withRunAuthorization(next.run, 'CONSUME', () => h.contexts.assertVisible(frozen, h.access)));
  assert.throws(() => h.authority.withRunAuthorization(next.run, 'VIEW', () => h.authority.readGranted(oldGrantRef, h.access)));
  assert.doesNotThrow(() => h.authority.withRunAuthorization(old.run, 'VIEW', () => h.contexts.assertVisible(frozen, h.access)), 'failed nested read must clear the active reader stack');
});

test('a full direct source cannot be laundered through an original-scope context into a narrow reader', t => {
  const h = fixture(t), old = h.issue('direct-wide', [h.broad]), next = h.issue('direct-narrow', [h.narrow]);
  const sourceAccess: ContextAccess = h.broad.access;
  const bundle = compileContext({ systemInstruction: 'Mechanical direct dependency', sections: [{ id: 'source', text: 'BOTH_UNITS_MARKER', required: true, priority: 1, dependencies: [{ ref: h.broad.ref, freshness: 'EXACT' }] }], skills: [] });
  const frozen = h.contexts.capture(sourceAccess, bundle);
  assert.doesNotThrow(() => h.authority.withRunAuthorization(old.run, 'VIEW', () => h.contexts.assertVisible(frozen, sourceAccess)));
  assert.throws(() => h.authority.withRunAuthorization(next.run, 'VIEW', () => h.contexts.assertVisible(frozen, sourceAccess)));
});

test('equivalent source permissions survive a new authorization ID; narrowed results contain only selected units', t => {
  const h = fixture(t), old = h.issue('equivalent-old', [h.narrow]), next = h.issue('equivalent-new', [h.narrow]);
  assert.notEqual(old.auth.id, next.auth.id);
  const result = h.authority.withRunAuthorization(next.run, 'VIEW', () => h.authority.readGranted(h.authority.ref(old.grant), h.access));
  assert.deepEqual((result.data as any).units.map((unit: any) => unit.id), [h.project.units[0].id]);
  assert.doesNotMatch(JSON.stringify(result.data), /UNIT_TWO_PROTOCOL_MARKER/);
});

test('a source from another home conversation is rejected even for the same author and scope', t => {
  const h = fixture(t);
  const other = h.conversations.open('author', 'script:home', 'other-author-thread');
  const accepted = h.conversations.accept({ ownerId: 'author', threadId: other.id, requestId: 'other-message', expectedVersion: 1, requestEnvelope: { protocol: true }, payload: {}, capabilityId: 'protocol', maxInvocations: 1 });
  const ref = h.conversations.captureHistory(other.id, accepted.turnId, 'author', { text: 'OTHER_THREAD_PRIVATE_PROTOCOL_MARKER', contextRefs: [] });
  const source: ScriptReadSource = { ref, access: { ownerId: 'author', scopeId: 'script:home', branch: 'author' }, purpose: 'CONVERSATION', unitIds: null };
  assert.throws(() => h.authority.issue({ ownerId: 'author', threadId: h.thread.id, workspaceId: h.workspace.id, commandId: 'wrong-thread-source', scope: {}, sources: [source] }));
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_authorizations').get() as any).n, 0);
});

test('the authorization cannot bind a different author command even when owner, thread and authRef match', t => {
  const h = fixture(t);
  const auth = h.authority.issue({ ownerId: 'author', threadId: h.thread.id, workspaceId: h.workspace.id, commandId: 'actual-author-command', scope: {}, sources: [] });
  const accepted = h.store.accept({ ownerId: 'author', scopeId: 'script:home', threadId: h.thread.id, requestId: 'different-author-command', kind: 'CAPABILITY', input: { authorizationRef: auth.id }, policyRevision: 'protocol', maxInvocations: 1 });
  assert.throws(() => h.authority.bind(auth.id, 'author', { kind: 'RUN', runId: accepted.runId, inputRevision: 1 }));
  assert.equal(h.authority.read(auth.id, 'author').binding, null);
  const goals = new SqliteGoalStore(h.store, new SqliteBudgetStore(h.store)); goals.ensureSchema();
  const goal = goals.accept({ ownerId: 'author', scopeId: 'script:home', threadId: h.thread.id, requestId: 'different-goal-command', requestEnvelope: { protocol: 'wrong-command' },
    policyRevision: 'protocol', objective: '机械命令绑定', contract: { pluginId: 'protocol', version: '1', value: {}, digest: hashValue({}) },
    authorizationRef: auth.id, workspaceRef: auth.workspaceRef, sourceRefs: [], skillManifest: [], route: { channel: 'external', routeRef: 'protocol' },
    stopPolicy: 'CONTRACT_COMPLETE', turnLimits: { maxDecisions: 1, maxToolCalls: 1 }, budgetLimits: { maxInvocations: 1, maxToolCalls: 1, maxTurns: 1, maxRepairRounds: 0 } });
  assert.throws(() => h.authority.bind(auth.id, 'author', { kind: 'GOAL', goalId: goal.goalId, revision: 1 }));
  assert.equal(h.authority.read(auth.id, 'author').binding, null);
});

test('deleting a source immediately invalidates old grant and derived frozen view without touching the author draft', t => {
  const h = fixture(t), old = h.issue('source-withdrawal', [h.broad]), ref = h.authority.ref(old.grant);
  const bundle = compileContext({ systemInstruction: 'Mechanical withdrawal', sections: [{ id: 'source', text: 'FIXED_SOURCE_MARKER', required: true, priority: 1, dependencies: [{ ref, freshness: 'EXACT' }] }], skills: [] });
  const frozen = h.contexts.capture(h.access, bundle), before = structuredClone(h.workspace.document);
  assert.doesNotThrow(() => h.authority.withRunAuthorization(old.run, 'VIEW', () => h.contexts.assertVisible(frozen, h.access)));
  h.scripts.deleteProject(h.project.id);
  assert.throws(() => h.authority.withRunAuthorization(old.run, 'VIEW', () => h.contexts.assertVisible(frozen, h.access)));
  assert.deepEqual(h.workspace.document, before);
});

test('a manual step sharing an existing Goal budget retains its narrower author-command authorization', t => {
  const h = fixture(t), goals = new SqliteGoalStore(h.store, new SqliteBudgetStore(h.store)); goals.ensureSchema();
  const controller = h.authority.issue({ ownerId: 'author', threadId: h.thread.id, workspaceId: h.workspace.id, commandId: 'wide-goal', scope: {}, sources: [h.broad] });
  const accepted = goals.accept({ ownerId: 'author', scopeId: 'script:home', threadId: h.thread.id, requestId: 'wide-goal', requestEnvelope: { protocol: 'broad-controller' },
    policyRevision: 'protocol', objective: '机械宽范围委托', contract: { pluginId: 'protocol', version: '1', value: {}, digest: hashValue({}) },
    authorizationRef: controller.id, workspaceRef: controller.workspaceRef, sourceRefs: [h.broad.ref], skillManifest: [], route: { channel: 'external', routeRef: 'protocol' },
    stopPolicy: 'CONTRACT_COMPLETE', turnLimits: { maxDecisions: 2, maxToolCalls: 2 }, budgetLimits: { maxInvocations: 3, maxToolCalls: 3, maxTurns: 3, maxRepairRounds: 0 } });
  h.authority.bind(controller.id, 'author', { kind: 'GOAL', goalId: accepted.goalId, revision: 1 });
  h.store.control(accepted.runId, 'author', h.store.readRun(accepted.runId).version, 'pause', 'pause-before-manual');
  const request: CapabilityRequest = { callId: 'manual-protocol-call', capabilityId: 'protocol.read', capabilityVersion: '1', input: {} };
  const manual = h.issue('narrow-manual', [h.narrow], request);
  goals.attachManualRun({ runId: manual.run.id, ownerId: 'author', goalId: accepted.goalId, expectedGoalVersion: goals.read(accepted.goalId, 'author').version });
  assert.equal(h.authority.forRun(manual.run).id, manual.auth.id, 'budget linkage must not replace the explicit single-step grant');
  assert.throws(() => h.authority.withRunAuthorization(manual.run, 'CONSUME', () => h.authority.assertSourceIntersection(h.broad)));
  const claim = h.store.claim('manual', 30000, manual.run.id)!;
  const prepared: PreparedCall = { request, implementationDigest: hashValue('protocol'), contractDigest: hashValue('contract'), inputDigest: hashValue({}),
    binding: { ownerId: 'author', scopeId: 'script:home', commandRevision: '1', policyRevision: 'protocol' }, sources: [], targets: [], preparedDigest: '' };
  const { preparedDigest: ignored, ...body } = prepared; prepared.preparedDigest = hashValue(body);
  const step = h.store.savePrepared(claim.token, prepared);
  h.store.commitStep({ ...claim.token, stepId: step.id }, request.callId, { status: 'SUCCEEDED', summary: 'MECHANICAL_NARROW_MANUAL_RECEIPT', data: {}, evidence: [], artifacts: [], effectState: 'NO_EFFECT', retry: 'NEVER' }, () => {});
  h.store.finish(claim.token, 'SUCCEEDED', {});
  goals.continue({ goalId: accepted.goalId, ownerId: 'author', expectedVersion: goals.read(accepted.goalId, 'author').version,
    expectedRunVersion: h.store.readRun(accepted.runId).version, requestId: 'resume-after-manual', requestEnvelope: { protocol: 'resume' } });
  const resumed = h.store.claim('resumed-controller', 30000, accepted.runId)!;
  const originAuthorizations: string[] = [];
  const history = new SqliteHistoryStore(h.store, goals, {
    authorizeReader() {}, authorize({ origin }) { originAuthorizations.push(origin.link.authorizationRef); }, assertSamplingView() {}, assertReceiptView() {},
  }); history.ensureSchema();
  const page = history.listReceiptViews(resumed.token);
  assert.equal(page.items[0].state, 'VISIBLE');
  assert.deepEqual(originAuthorizations, [manual.auth.id], 'historical origin must retain the manual grant, not the controller budget grant');
  h.store.control(accepted.runId, 'author', h.store.readRun(accepted.runId).version, 'pause', 'pause-before-foreign-workspace');
  const foreign = h.workspaces.create({ ownerId: 'author', threadId: h.thread.id, requestId: 'other-workspace', source: { document: createScriptProject('另一个机械工作稿', createScriptCreationProfile('tv-series', 2, 20)) } });
  const foreignAuth = h.authority.issue({ ownerId: 'author', threadId: h.thread.id, workspaceId: foreign.id, commandId: 'foreign-manual', scope: {}, sources: [] });
  const foreignRun = h.store.accept({ ownerId: 'author', scopeId: 'script:home', threadId: h.thread.id, requestId: 'foreign-manual', kind: 'CAPABILITY', input: { authorizationRef: foreignAuth.id, request }, policyRevision: 'protocol', maxInvocations: 1 });
  h.authority.bind(foreignAuth.id, 'author', { kind: 'RUN', runId: foreignRun.runId, inputRevision: 1 });
  goals.attachManualRun({ runId: foreignRun.runId, ownerId: 'author', goalId: accepted.goalId, expectedGoalVersion: goals.read(accepted.goalId, 'author').version });
  assert.throws(() => h.authority.forRun(h.store.readRun(foreignRun.runId)), 'another workspace must not use this Goal budget and history binding');
});

test('the actual host journal enforces the grant intersection through derived memory and excludes source planning fields', t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  const h = createScriptAgentHost(db, { async sendOnce() { throw new Error('NO_MODEL_DISPATCH_AUTHORIZED'); } }, 'independent-review', {trustedLegacyProjectOwner:'author'});
  const thread = h.conversations.open('author', 'script:home', 'formal-host-review');
  const source = createScriptProject('机械前集', createScriptCreationProfile('tv-series', 2, 20));
  source.units.push(newUnit('未选集', 1200000, source.id)); source.brief.outline = 'UNCONFIRMED_GLOBAL_PLAN';
  source.units[0].summary = 'UNCONFIRMED_UNIT_PLAN'; source.units[0].scenes[0].purpose = 'UNCONFIRMED_SCENE_PLAN';
  source.units[0].scenes[0].blocks[0].text = 'ACTUAL_BODY_ONE'; source.units[1].scenes[0].blocks[0].text = 'ACTUAL_BODY_TWO';
  const saved = h.scripts.saveProject(source, 0);
  const w = h.workspaces.create({ ownerId: 'author', threadId: thread.id, requestId: 'host-workspace', source: { document: createScriptProject('机械工作稿', createScriptCreationProfile('tv-series', 2, 20)) } });
  const scope: ScriptDraftScope = { workspaceId: w.id, documentId: w.documentId, originRevision: w.revision, originContentHash: hashValue(w.document), operations: ['scene_body'],
    units: [{ unitId: w.document.units[0].id, allowSummary: false, allowAllScenes: true, maxNewScenes: 0, scenes: [] }], newUnitSlots: [], sharedFields: [], characterScopeIds: [], factScopeIds: [] };
  const sourceRef: ScriptReadSource = { ref: { uri: `resource://script/projects/${saved.id}`, version: String(saved.revision), contentHash: hashValue(saved), branch: 'author' },
    access: { ownerId: 'author', scopeId: saved.id, branch: 'author' }, purpose: 'PREVIOUS_SCRIPT', unitIds: null };
  const receive = (commandId: string, selected: ScriptReadSource) => {
    const auth = h.authorizations.issue({ ownerId: 'author', threadId: thread.id, workspaceId: w.id, commandId, scope, sources: [selected] });
    const received = h.store.accept({ ownerId: 'author', threadId: thread.id, scopeId: 'script:home', requestId: commandId, kind: 'CAPABILITY', input: { authorizationRef: auth.id }, policyRevision: 'protocol', maxInvocations: 1 });
    h.authorizations.bind(auth.id, 'author', { kind: 'RUN', runId: received.runId, inputRevision: 1 });
    return { run: h.store.readRun(received.runId), grant: h.authorizations.grants(auth.id, 'author')[0] };
  };
  const wide = receive('host-wide', sourceRef), narrow = receive('host-narrow', { ...sourceRef, unitIds: [saved.units[0].id] });
  const access = { ownerId: 'author', scopeId: w.id, branch: `workspace:${w.id}` };
  const read = h.authorizations.withRunAuthorization(narrow.run, 'CONSUME', () => h.authorizations.readGranted(h.authorizations.ref(narrow.grant), access));
  assert.match(JSON.stringify(read.data), /ACTUAL_BODY_ONE/); assert.doesNotMatch(JSON.stringify(read.data), /ACTUAL_BODY_TWO|UNCONFIRMED_/);
  const memory = h.contexts.createMemory(access, 'model', 'host-derived', { key: 'review.host', kind: 'DOMAIN_DERIVED', content: { label: '机械派生', value: 'BOTH_UNITS_DERIVED' }, dependencies: [{ ref: h.authorizations.ref(wide.grant), freshness: 'EXACT' }] });
  const bundle = compileContext({ systemInstruction: 'Mechanical host input guard', sections: [memorySection(h.contexts.getMemory(memory.id, access))], skills: [] });
  const frozen = h.contexts.capture(access, bundle), request = { operationKey: 'host-guard', channel: 'api' as const, routeRef: 'mechanical:never', prompt: bundle.prompt, systemInstruction: bundle.systemInstruction, contextRef: frozen };
  assert.doesNotThrow(() => h.journal.assertRunInput(request, wide.run, 'VIEW'));
  assert.throws(() => h.journal.assertRunInput(request, narrow.run, 'CONSUME'));
  assert.doesNotThrow(() => h.journal.assertRunInput(request, wide.run, 'VIEW'));
});
