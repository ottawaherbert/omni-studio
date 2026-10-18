import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue } from '../packages/agent-core/src';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';

test('REVIEW Goal freezes only read/check tools and cannot authorize a writing proposal', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = createScriptAgentHost(db, { sendOnce: async () => { throw Error('external review protocol only'); } }, 'review-only-worker', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author', 'script:home', 'review-only');
  const doc = createScriptProject('【机械审阅】', createScriptCreationProfile('short-film', 1, 5));
  doc.units[0].scenes[0].blocks[0].text = '【机械原文】校验定位。';
  const project = host.scripts.saveProject(doc, 0), unitId = project.units[0].id;
  const accepted = await host.commands.submit('author', {
    kind: 'GOAL_START', requestId: 'only-review', threadId: thread.id, expectedConversationVersion: 1,
    source: { kind: 'PROJECT', projectId: project.id, revision: project.revision, contentHash: hashValue(project) },
    objective: '【机械协议】只核对正文', task: 'REVIEW', target: { unitIds: [unitId] }, methodIds: [],
  }, { resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'mechanical' }) });
  const goal = host.goals.read(accepted.goalId!, 'author'), scope = (goal.revision.contract.value as any).scope;
  assert.deepEqual(scope.operations, []);
  assert.deepEqual(scope.units.map((unit: any) => unit.unitId), [unitId]);
  assert.throws(() => host.drafts.assertProposalTarget(host.store.readRun(accepted.runId), {
    operation: 'scene_body', unitId, sceneId: project.units[0].scenes[0].id,
  }), /未授权/);
  await host.worker.runOnce(accepted.runId);
  const run = host.store.readRun(accepted.runId);
  assert.equal(run.status, 'WAITING_EXTERNAL');
  const frozen = host.journal.listExternal(accepted.runId, 'author')[0];
  assert.equal(frozen.status, 'WAITING');
  const invocation = host.journal.read(frozen.invocationId);
  const tools = (invocation.request.inputManifest as any).allowedGoalTools as Array<{ id: string }>;
  assert.deepEqual(tools.map(tool => tool.id).sort(), ['script.check_batch', 'script.check_status', 'script.read', 'script.read_conversation']);
  assert.equal(host.workspaces.read(accepted.workspaceId, 'author').document.units[0].scenes[0].blocks[0].text, '【机械原文】校验定位。');
});
