import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

test('a narrower Goal revision fences an older queued linked manual writing step before model dispatch', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  let sends = 0;
  const host = createScriptAgentHost(db, {sendOnce:async () => {
    sends++;
    return {text:'{"MECHANICAL_INVALID_PROPOSAL":true}',provenance:{channel:'provider',producer:'MECHANICAL_FIXTURE_NO_EXTERNAL_MODEL'}};
  }}, 'manual-revision-review', {trustedLegacyProjectOwner:'author'});
  const thread = host.conversations.open('author','script:home','manual-revision');
  const document = createScriptProject('MECHANICAL_NARROWING',createScriptCreationProfile('short-film',1,3));
  const saved = host.scripts.saveProject(document,0);
  const unitId = saved.units[0].id, sceneId = saved.units[0].scenes[0].id;
  const common = {threadId:thread.id,expectedConversationVersion:thread.version};
  const resolvers = {resolveMethods:async (_ids:string[]) => [],resolveExecution:() => ({channel:'api' as const,routeRef:'mechanical-no-external-model'})};
  const started = await host.commands.submit('author',{
    ...common,kind:'GOAL_START',requestId:'wide-goal',source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
    objective:'MECHANICAL_OLD_SCOPE',task:'REVISE',target:{unitIds:[unitId],sceneIds:[{unitId,sceneId}],sharedFields:['concept']},methodIds:[],
  },resolvers);
  const controller = host.store.readRun(started.runId);
  host.store.control(controller.id,'author',controller.version,'pause','manual-takeover');
  const originalGoal = host.goals.read(started.goalId!,'author');
  const workspace = host.workspaces.read(started.workspaceId,'author');
  const manual = await host.commands.submit('author',{
    ...common,kind:'PROPOSE',requestId:'queued-old-concept',source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},
    operation:'concept',instruction:'MECHANICAL_QUEUED_OLD_SCOPE',target:{},methodIds:[],
    manualGoal:{goalId:originalGoal.id,expectedGoalVersion:originalGoal.version},
  },resolvers);
  assert.equal(host.store.readRun(manual.runId).status,'QUEUED');
  assert.equal(host.goals.readRunLink(manual.runId)?.role,'MANUAL_STEP');

  const paused = host.store.readRun(started.runId);
  const revised = await host.commands.submit('author',{
    ...common,kind:'GOAL_REVISE',requestId:'narrow-goal',goalId:originalGoal.id,
    expectedGoalVersion:originalGoal.version,expectedRunVersion:paused.version,
    target:{unitIds:[unitId],sceneIds:[{unitId,sceneId}],sharedFields:[]},
  },resolvers);
  assert.ok(revised.goalRevision! > started.goalRevision!);
  assert.equal(host.workspaces.read(workspace.id,'author').revision,workspace.revision,'narrowing itself must not rely on a workspace revision conflict');
  const newController = host.store.readRun(revised.runId);
  host.store.control(newController.id,'author',newController.version,'pause','let-linked-manual-run-claim');

  assert.equal(await host.worker.runOnce(manual.runId),true,'test must actually dispatch the queued manual run');
  await host.childWorker.runOnce(manual.runId);
  assert.notEqual(host.store.readRun(manual.runId).status,'QUEUED','test must actually dispatch the queued manual run');
  assert.equal(sends,0,'the queued old manual authority must not send a model request after Goal narrowing');
  assert.equal((db.prepare('SELECT count(*) AS n FROM script_draft_candidates WHERE run_id=?').get(manual.runId) as {n:number}).n,0);
});
