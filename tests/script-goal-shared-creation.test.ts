import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue } from '../packages/agent-core/src';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { goalSceneLimitTarget } from '../apps/web/src/features/script/scriptGoalAuthoring';

test('paused Goal and linked manual planning consume one atomic shared scene quota across continuation', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw Error('No provider in isolated protocol test'); } }, 'shared-quota-worker', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author', 'script:home', 'shared-quota');
  const profile = createScriptCreationProfile('tv-series', 3, 20);
  const project = host.scripts.saveProject(createScriptProject('【机械协议】额度', profile), 0);
  const unitId = project.units[0].id;
  const resolve = { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external' as const, routeRef: 'mechanical' }) };
  const started = await host.commands.submit('author', {
    kind: 'GOAL_START', requestId: 'quota-goal', threadId: thread.id, expectedConversationVersion: 1,
    source: { kind: 'PROJECT', projectId: project.id, revision: project.revision, contentHash: hashValue(project) },
    objective: '【机械协议】验证一场额度', task: 'WRITE', target: { unitIds: [unitId], wholeUnitIds: [unitId], maxNewScenes: [{ unitId, count: 1 }] }, methodIds: [],
  }, resolve);
  const firstRun = host.store.readRun(started.runId);
  host.store.control(firstRun.id, 'author', firstRun.version, 'pause', 'manual-test');
  const goal = host.goals.read(started.goalId!, 'author');
  const initial = host.workspaces.read(started.workspaceId, 'author');
  const manualGoal = { goalId: goal.id, expectedGoalVersion: goal.version };
  const proposal = await host.commands.submit('author', {
    kind: 'PROPOSE', requestId: 'manual-scene-one', threadId: thread.id, expectedConversationVersion: 1,
    source: { kind: 'WORKSPACE', workspaceId: initial.id, expectedRevision: initial.revision },
    operation: 'plan_scenes', instruction: '【机械协议】新增一场', target: { unitId, maxNewScenes: 1 }, methodIds: [], manualGoal,
  }, resolve);
  await host.worker.runOnce(proposal.runId); await host.childWorker.runOnce(proposal.runId);
  const frozen = host.journal.listExternal(proposal.runId, 'author')[0];
  assert.equal(frozen.status, 'WAITING');
  const raw = JSON.stringify({ summary: '【机械协议常量】一场', scenes: [
    { localKey: 'one', title: '【机械场】', purpose: '协议检查', location: '测试室', timeOfDay: 'DAY' },
  ] });
  host.journal.submitExternal(frozen.id, 'author', frozen.inputHash, raw, { name: 'Mechanical fixture', model: 'protocol' });
  for (let i = 0; i < 6 && host.store.readRun(proposal.runId).status !== 'SUCCEEDED'; i++) {
    await host.childWorker.runOnce(proposal.runId); await host.worker.runOnce(proposal.runId);
  }
  const candidateId = (host.store.readRun(proposal.runId).result as any).data.candidateId;
  assert.equal(host.drafts.readCandidate('author', candidateId).status, 'VALID');
  const before = host.workspaces.read(initial.id, 'author');
  const apply = await host.commands.submit('author', {
    kind: 'APPLY', requestId: 'manual-scene-apply', threadId: thread.id, expectedConversationVersion: 1,
    workspaceId: initial.id, candidateId, expectedRevision: before.revision, writerEpoch: before.writerEpoch, manualGoal,
  }, resolve);
  await host.worker.runOnce(apply.runId);
  assert.equal(host.store.readRun(apply.runId).status, 'SUCCEEDED');
  const after = host.workspaces.read(initial.id, 'author');
  assert.equal(after.document.units[0].scenes.length,1,'first plan replaces the genuinely blank placeholder');
  assert.notEqual(after.document.units[0].scenes[0].id,before.document.units[0].scenes[0].id);
  assert.equal(after.document.units[0].scenes[0].purpose,'协议检查');
  const row = db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?').get(goal.id, goal.activeRevision) as { data_json: string };
  assert.equal(JSON.parse(row.data_json).scenes.length, 1);
  await assert.rejects(() => host.commands.submit('author', {
    kind: 'PROPOSE', requestId: 'manual-scene-two', threadId: thread.id, expectedConversationVersion: 1,
    source: { kind: 'WORKSPACE', workspaceId: initial.id, expectedRevision: after.revision },
    operation: 'plan_scenes', instruction: '【机械协议】第二场', target: { unitId }, methodIds: [], manualGoal,
  }, resolve), /额度已用尽/);
  const paused = host.store.readRun(started.runId), continued = await host.commands.submit('author', {
    kind: 'GOAL_CONTINUE', requestId: 'after-manual-scene', threadId: thread.id, expectedConversationVersion: 1,
    goalId: goal.id, expectedGoalVersion: goal.version, expectedRunVersion: paused.version,
  }, resolve);
  const next = host.goals.read(continued.goalId!, 'author');
  const scope = (next.revision.contract.value as any).scope;
  assert.equal(scope.units.find((unit: any) => unit.unitId === unitId).maxNewScenes, 0);
  assert.equal(next.revision.budgetId, goal.revision.budgetId);
  const continuing=host.store.readRun(continued.runId);
  host.store.control(continuing.id,'author',continuing.version,'pause','revise-total-cap');
  const pausedContinue=host.store.readRun(continued.runId),afterContinue=host.workspaces.read(initial.id,'author');
  const revised=await host.commands.submit('author',{
    kind:'GOAL_REVISE',requestId:'total-scene-cap-two',threadId:thread.id,expectedConversationVersion:1,
    goalId:goal.id,expectedGoalVersion:next.version,expectedRunVersion:pausedContinue.version,
    target:goalSceneLimitTarget(scope,afterContinue,2),
  },resolve);
  const finalScope=(host.goals.read(revised.goalId!,'author').revision.contract.value as any).scope;
  assert.equal(finalScope.units.find((unit:any)=>unit.unitId===unitId).maxNewScenes,1,
    'a total cap of two grants only one more scene after an earlier revision created one');
});

test('linked manual new-unit slot and character/fact writes share the Goal ledger and cannot reuse the slot', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw Error('No provider in isolated protocol test'); } }, 'shared-entity-worker', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author', 'script:home', 'shared-entities');
  const profile = createScriptCreationProfile('tv-series', 3, 20);
  const resolve = { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external' as const, routeRef: 'mechanical' }) };
  const started = await host.commands.submit('author', {
    kind: 'GOAL_START', requestId: 'entity-goal', threadId: thread.id, expectedConversationVersion: 1,
    source: { kind: 'NEW', title: '【机械协议】新集', profile }, objective: '【机械协议】新增一集及实体', task: 'WRITE',
    target: { newUnitCount: 1, initialCharacterScope: 'PROJECT', initialFactScope: 'PROJECT' }, methodIds: [],
  }, resolve);
  const first = host.store.readRun(started.runId);
  host.store.control(first.id, 'author', first.version, 'pause', 'manual-test');
  const goal = host.goals.read(started.goalId!, 'author'), manualGoal = { goalId: goal.id, expectedGoalVersion: goal.version };
  const slot = (goal.revision.contract.value as any).scope.newUnitSlots[0];
  let workspace = host.workspaces.read(started.workspaceId, 'author');
  const submitAndApply = async (operation: 'add_unit' | 'add_character' | 'add_fact', requestId: string, target: Record<string, unknown>, raw: string) => {
    const proposed = await host.commands.submit('author', {
      kind: 'PROPOSE', requestId: `${requestId}-propose`, threadId: thread.id, expectedConversationVersion: 1,
      source: { kind: 'WORKSPACE', workspaceId: workspace.id, expectedRevision: workspace.revision },
      operation, instruction: `【机械协议】${operation}`, target, methodIds: [], manualGoal,
    }, resolve);
    if (operation === 'add_unit') {
      assert.deepEqual(proposed.reservedUnitIds, [slot.unitId]);
      assert.equal((host.authorizations.read(proposed.authorizationRef, 'author').scope as any).newUnitSlots[0].slotId, slot.slotId);
    }
    await host.worker.runOnce(proposed.runId); await host.childWorker.runOnce(proposed.runId);
    const frozen = host.journal.listExternal(proposed.runId, 'author')[0];
    assert.equal(frozen.status, 'WAITING');
    host.journal.submitExternal(frozen.id, 'author', frozen.inputHash, raw, { name: 'Mechanical fixture', model: 'protocol' });
    for (let i = 0; i < 6 && host.store.readRun(proposed.runId).status !== 'SUCCEEDED'; i++) {
      await host.childWorker.runOnce(proposed.runId); await host.worker.runOnce(proposed.runId);
    }
    const candidateId = (host.store.readRun(proposed.runId).result as any).data.candidateId;
    assert.equal(host.drafts.readCandidate('author', candidateId).status, 'VALID');
    workspace = host.workspaces.read(workspace.id, 'author');
    const applied = await host.commands.submit('author', {
      kind: 'APPLY', requestId: `${requestId}-apply`, threadId: thread.id, expectedConversationVersion: 1,
      workspaceId: workspace.id, candidateId, expectedRevision: workspace.revision, writerEpoch: workspace.writerEpoch, manualGoal,
    }, resolve);
    await host.worker.runOnce(applied.runId);
    assert.equal(host.store.readRun(applied.runId).status, 'SUCCEEDED');
    workspace = host.workspaces.read(workspace.id, 'author');
  };
  await submitAndApply('add_unit', 'unit', {}, JSON.stringify({ summary: '【机械协议】', title: '第二集', unitSummary: '机械占位' }));
  assert.ok(workspace.document.units.some(unit => unit.id === slot.unitId));
  await assert.rejects(() => host.commands.submit('author', {
    kind: 'PROPOSE', requestId: 'unit-again', threadId: thread.id, expectedConversationVersion: 1,
    source: { kind: 'WORKSPACE', workspaceId: workspace.id, expectedRevision: workspace.revision },
    operation: 'add_unit', instruction: '【机械协议】再占用槽', target: {}, methodIds: [], manualGoal,
  }, resolve), /没有可用的新单元槽/);
  const scopeId = workspace.document.id;
  await submitAndApply('add_character', 'character', { scopeId }, JSON.stringify({ summary: '【机械协议】', character: {
    localKey: 'person', name: '机械人物', desire: '', need: '', contradiction: '', arc: '', voice: '',
  } }));
  await submitAndApply('add_fact', 'fact', { scopeId }, JSON.stringify({ summary: '【机械协议】', fact: {
    localKey: 'fact', text: '【机械事实】仅供协议验收',
  } }));
  const row = db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?').get(goal.id, goal.activeRevision) as { data_json: string };
  const ledger = JSON.parse(row.data_json);
  assert.equal(ledger.units.length, 1); assert.equal(ledger.characters.length, 1); assert.equal(ledger.facts.length, 1);
  const paused = host.store.readRun(started.runId), continued = await host.commands.submit('author', {
    kind: 'GOAL_CONTINUE', requestId: 'after-manual-entities', threadId: thread.id, expectedConversationVersion: 1,
    goalId: goal.id, expectedGoalVersion: goal.version, expectedRunVersion: paused.version,
  }, resolve);
  assert.equal((host.goals.read(continued.goalId!, 'author').revision.contract.value as any).scope.newUnitSlots.length, 0);
});
