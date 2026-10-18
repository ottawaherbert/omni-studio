import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { CapabilityRegistry, hashValue, type ExecutionToken, type ModelRequest } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptReviewStore } from '../apps/api/src/repositories/scriptReviewStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

// Mechanical model protocol fixture. This test does not assess creative quality.
test('revoking a check context permits fresh checking without reviving the old receipt', async t => {
  const db = new Database(':memory:'); t.after(() => db.close());
  const store = new AgentSqliteStore(db); store.ensureSchema();
  const conversations = new SqliteConversationStore(store); conversations.ensureSchema();
  const thread = conversations.open('author', 'script:home', 'revoked-check');
  const scripts = createScriptRepository(db); scripts.ensureSchema();
  const workspaces = new ScriptWorkspaceStore(store, scripts); workspaces.ensureSchema();
  const document = createScriptProject('MECHANICAL_RECHECK', createScriptCreationProfile('short-film', 1, 3));
  document.units[0].scenes[0].blocks[0].text = 'MECHANICAL_AUTHOR_BODY';
  const workspace = workspaces.create({ownerId:'author',threadId:thread.id,requestId:'review-workspace',source:{document}});
  const access = {ownerId:'author',scopeId:workspace.id,branch:`workspace:${workspace.id}`};
  const contract = {revision:1,targetUnitIds:[document.units[0].id],localChecks:[{id:'local',dependency:'EXACT_BLOCKS' as const}],globalChecks:[{id:'global',dependency:'WHOLE_MANUSCRIPT' as const}],maxRawChars:1000,maxIndexEntries:20,maxRepairRounds:1};
  let reviews!: ScriptReviewStore;
  const contexts = new SqliteContextStore(store, (dependency, sourceAccess) => {
    const url = new URL(dependency.ref.uri);
    return url.pathname.startsWith('/check-receipts/')
      ? reviews.sourceAllowed(dependency.ref, sourceAccess, dependency.freshness)
      : workspaces.sourceAllowed(dependency.ref, sourceAccess, dependency.freshness);
  }); contexts.ensureSchema();
  const journal = new SqliteModelJournal(store, (request, _run, phase) => {
    if (request.contextRef) phase === 'VIEW' ? contexts.assertVisible(request.contextRef, access) : contexts.assertAllowed(request.contextRef, access);
  }); journal.ensureSchema();
  reviews = new ScriptReviewStore(store, workspaces, contexts, journal, {
    forRun: () => ({reviewScopeId:'goal_recheck',workspaceId:workspace.id,authorizationRef:'mechanical-auth',contract}),
    completionState: () => ({unresolvedUnknown:false,outOfScopeWrites:false}),
  }); reviews.ensureSchema();
  const registry = new CapabilityRegistry({assertExecution:async context => {store.assertExecution(context.execution);},authorize:async () => {}}).register({
    spec:{id:'script.check_batch',version:'1',implementationDigest:hashValue('mechanical-recheck'),description:'机械检查',effect:'PROPOSE',cost:'MODEL',dispatch:'DURABLE',replay:'TRANSACTIONAL',input:{jsonSchema:{},parse:value=>value},output:{jsonSchema:{},parse:value=>value}},
    prepare:async (input:any) => ({input,sources:input.frozen.reviewBatch.sourceRefs,targets:[]}),
    execute:async () => {throw new Error('test commits through the real review repository');},
  });
  let serial = 0;
  const controller = () => {
    const run = store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:`review-run-${++serial}`,kind:'CAPABILITY',input:{authorizationRef:'mechanical-auth'},policyRevision:'mechanical',maxInvocations:10});
    return store.claim('review-parent',30000,run.runId)!;
  };
  const check = async (taskId:string) => {
    const parent = controller(), batch = reviews.prepareBatch(parent.token, taskId);
    const bundle = compileContext({systemInstruction:'MECHANICAL_CHECK',sections:[batch.section],skills:[],outputSchema:batch.outputSchema});
    const request:ModelRequest = {operationKey:`check:${batch.task.id}:${serial}`,channel:'api',routeRef:'mechanical',prompt:bundle.prompt,systemInstruction:bundle.systemInstruction,outputSchema:batch.outputSchema,inputManifest:batch.inputManifest,contextRef:contexts.capture(access,bundle)};
    const prepared = await registry.prepare({capabilityId:'script.check_batch',capabilityVersion:'1',callId:'check',input:{authorizationRef:'mechanical-auth',taskId,frozen:{reviewBatch:batch,model:request}}},
      {ownerId:'author',scopeId:'script:home',commandRevision:'1',policyRevision:'mechanical',execution:parent.token,signal:new AbortController().signal});
    const step = store.savePrepared(parent.token, prepared); store.handoff(parent.token, step.id);
    const child = store.claimChild('review-child',30000,parent.run.id)!;
    const invocation = journal.prepare(child.token,request), attempt = journal.startAttempt(child.token,invocation.id);
    journal.recordResult(invocation.id,attempt.attemptId,{text:JSON.stringify({summary:'MECHANICAL_CHECK_RESULT',findings:[],resolvedFindingIds:[]}),provenance:{channel:'provider',producer:'MECHANICAL_FIXTURE_NO_EXTERNAL_MODEL'}});
    const observation = reviews.recordResult({token:child.token,invocationId:invocation.id});
    store.finish(child.token,'SUCCEEDED',{});
    assert.equal(observation.status,'SUCCEEDED');
    return observation;
  };
  const first = controller(), taskId = reviews.ensurePlan(first.token).plan.tasks[0].id;
  store.finish(first.token,'SUCCEEDED',{});
  const old = await check(taskId), oldRef = old.artifacts[0];
  assert.equal(reviews.sourceAllowed(oldRef, access, 'EXACT'),true);

  contexts.revokeScope(access);
  assert.equal(reviews.sourceAllowed(oldRef, access, 'EXACT'),false,'withdrawn check evidence must stay unavailable');
  const resumed = controller();
  const pending = reviews.ensurePlan(resumed.token);
  assert.equal(pending.plan.tasks[0].id,taskId);
  assert.equal(pending.receipts.some(receipt=>receipt.id===new URL(oldRef.uri).pathname.split('/').at(-1)),false,'revoked receipt cannot count as coverage');
  store.finish(resumed.token,'SUCCEEDED',{});
  const fresh = await check(taskId);
  assert.notEqual(fresh.artifacts[0].uri,oldRef.uri,'fresh check needs its own durable receipt');
  assert.equal(reviews.sourceAllowed(oldRef, access, 'EXACT'),false,'old receipt must not revive after a new check');
  assert.equal(reviews.sourceAllowed(fresh.artifacts[0], access, 'EXACT'),true);
});
