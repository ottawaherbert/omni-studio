import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentError, AgentWorker, CapabilityRegistry, DecisionDriver, hashValue, type ModelRequest, type AgentRun, type ModelTransport } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteBudgetStore, SqliteGoalStore, SqliteContextStore, SqliteModelJournal, SqliteConversationStore, SqliteHistoryStore } from '../packages/agent-sqlite/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { ScriptDraftStore } from '../apps/api/src/repositories/scriptDraftStore';
import { ScriptReviewStore } from '../apps/api/src/repositories/scriptReviewStore';
import { createScriptHistoryPolicy, createScriptHistorySourceResolver } from '../apps/api/src/agent/scriptHistory';
import { createScriptGoalPlugin } from '../apps/api/src/agent/scriptGoalPlugin';
import { ScriptCommandService } from '../apps/api/src/agent/scriptCommands';
import { registerScriptReadCapability } from '../apps/api/src/agent/scriptReadCapability';
import { createScriptReviewAuthorization } from '../apps/api/src/agent/scriptReviewCapabilities';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { defaultScriptChecks, scriptGoalEnvelope } from '../packages/script/src/agentGoal';
import { validateScriptDraftScope, type ScriptDraftScope } from '../packages/script/src/agentScope';

// Independent actual Driver/Worker sequencing, not a fake committed receipt.
// Only mechanical decision envelopes are returned. No provider or creative text.
function setup(t:any,repeated:boolean){
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','independent-driver');
  const scripts=createScriptRepository(db);scripts.ensureSchema();const workspaces=new ScriptWorkspaceStore(store,scripts);workspaces.ensureSchema();
  const doc=createScriptProject('MECHANICAL_LONG_READ',createScriptCreationProfile('feature-film',1,90));doc.units[0].scenes[0].blocks[0].text='MECHANICAL_RAW_BLOCK_'.repeat(40);
  const workspace=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:doc}}),access={ownerId:'author',scopeId:workspace.id,branch:`workspace:${workspace.id}`};
  const authorizations=new ScriptAuthorizationStore(store,workspaces,{validateScope:(scope,w)=>validateScriptDraftScope(w.document,scope as ScriptDraftScope),readSource:()=>{throw Error('NO_EXTERNAL_SOURCES');}});authorizations.ensureSchema();
  let history:SqliteHistoryStore;
  const sourceAllowed=(dependency:any,a:any)=>dependency.ref.uri.startsWith('resource://agent-history/')?createScriptHistorySourceResolver(history)(dependency,a):workspaces.sourceAllowed(dependency.ref,a,dependency.freshness);
  const contexts=new SqliteContextStore(store,sourceAllowed,()=>authorizations.readerDigest());contexts.ensureSchema();
  const inputGuard=(request:ModelRequest,run:AgentRun,phase:'VIEW'|'CONSUME')=>authorizations.withRunAuthorization(run,phase,()=>{
    assert.ok(request.contextRef);const bundle=phase==='VIEW'?contexts.assertVisible(request.contextRef,access):contexts.assertAllowed(request.contextRef,access);
    assert.equal(bundle.prompt,request.prompt);assert.equal(bundle.systemInstruction,request.systemInstruction??'');assert.deepEqual(bundle.outputSchema,request.outputSchema);
  });
  const journal=new SqliteModelJournal(store,inputGuard);journal.ensureSchema();
  const goals=new SqliteGoalStore(store,new SqliteBudgetStore(store),()=>{throw Error('NO_SUCCESS_AUTHORIZED');},inputGuard);goals.ensureSchema();
  history=new SqliteHistoryStore(store,goals,createScriptHistoryPolicy({store,contexts,authorizations,assertSource:(ref,a,freshness)=>{if(!sourceAllowed({ref,freshness},a))throw new AgentError('SOURCE_INVALID','mechanical source unavailable');}}));history.ensureSchema();
  const scope:ScriptDraftScope={workspaceId:workspace.id,documentId:doc.id,originRevision:1,originContentHash:hashValue(workspace.document),operations:['scene_body'],units:[{unitId:doc.units[0].id,allowSummary:false,allowAllScenes:true,maxNewScenes:0,scenes:[]}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
  const auth=authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId:'goal-command',scope,sources:[]}),checks=defaultScriptChecks([doc.units[0].id]);
  const receipt=goals.accept({ownerId:'author',scopeId:'script:home',threadId:thread.id,requestId:'goal-command',requestEnvelope:{mechanical:true},objective:'MECHANICAL_READ_TARGET',contract:scriptGoalEnvelope({workspaceId:workspace.id,documentId:doc.id,task:'REVISE',scope,checks,strategy:{id:'SCRIPT_GOAL_V1',maxNoProgressStreak:3}}),authorizationRef:auth.id,workspaceRef:workspaceRef(workspace),sourceRefs:[],skillManifest:[],route:{channel:'api',routeRef:'mechanical-decision-only'},stopPolicy:'CONTRACT_COMPLETE',turnLimits:{maxDecisions:8,maxToolCalls:6},policyRevision:'review',budgetLimits:{maxInvocations:12,maxToolCalls:12,maxTurns:4,maxRepairRounds:0}});
  authorizations.bind(auth.id,'author',{kind:'GOAL',goalId:receipt.goalId,revision:1});
  const drafts=new ScriptDraftStore(store,workspaces,authorizations,contexts,journal);drafts.ensureSchema();
  const reviews=new ScriptReviewStore(store,workspaces,contexts,journal,{forRun:run=>({reviewScopeId:receipt.goalId,workspaceId:workspace.id,authorizationRef:authorizations.forRun(run).id,contract:checks})});reviews.ensureSchema();
  const registry=new CapabilityRegistry({assertExecution:async c=>{store.assertExecution(c.execution);},authorize:createScriptReviewAuthorization({store,journal,contexts,authorizations})});
  registerScriptReadCapability(registry,{store,contexts,authorizations,workspaces},hashValue('independent-real-read'));
  const plugin=createScriptGoalPlugin({store,goals,history,contexts,authorizations,workspaces,drafts,reviews,registry});let sends=0;
  const transport:ModelTransport={sendOnce:async request=>{
    assert.ok(request.operationKey.startsWith('decision:'));sends++;
    const base={kind:'STOP',capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:'MECHANICAL_READ_COMPLETE',remainingWork:['CHECKS_NOT_RUN']};
    if(sends<=4){
      const row=db.prepare("SELECT observation_json FROM agent_steps WHERE run_id=? AND status='COMMITTED' ORDER BY rowid DESC LIMIT 1").get(receipt.runId) as any;
      const cursor=repeated?null:row?JSON.parse(row.observation_json).data.nextCursor:null;
      Object.assign(base,{kind:'CALL',capabilityId:'script.read',capabilityVersion:'1',arguments:{authorizationRef:auth.id,sourceId:null,view:'BODY',unitId:doc.units[0].id,sceneId:null,cursor,maxChars:100,limit:10},reason:null,remainingWork:null});
    }
    return {text:JSON.stringify(base),provenance:{channel:'provider',provider:'MECHANICAL_DECISION_SIMULATION'},usage:{inputTokens:1,outputTokens:1}};
  }};
  const driver=new DecisionDriver(goals,journal,transport,plugin),worker=new AgentWorker(store,registry,{workerId:'independent-real-driver',handlers:{GOAL:c=>driver.handle(c)}});
  const commands=new ScriptCommandService({store,conversations,workspaces,authorizations,drafts,goals,scripts});commands.ensureSchema();
  const continueWithoutChanges=async(kind:'GOAL_CONTINUE'|'GOAL_REVISE'='GOAL_CONTINUE')=>{
    const goal=goals.read(receipt.goalId,'author'),run=store.readRun(receipt.runId);
    return commands.submit('author',{kind,requestId:'ordinary-author-continue',threadId:thread.id,
      expectedConversationVersion:thread.version,goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:run.version,
      ...(kind==='GOAL_REVISE'?{objective:goal.revision.objective}:{})},
      {resolveMethods:async()=>{throw Error('CONTINUE_MUST_KEEP_METHODS');},resolveExecution:()=>{throw Error('CONTINUE_MUST_KEEP_ROUTE');}});
  };
  const continueWithChangedObjective=()=>store.atomic(()=>{
    const goal=goals.read(receipt.goalId,'author'),run=store.readRun(receipt.runId),commandId='author-revised-read-objective';
    const nextAuth=authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId,scope,sources:[]});
    const next=goals.revise({goalId:goal.id,ownerId:'author',expectedVersion:goal.version,expectedRunVersion:run.version,
      requestId:commandId,requestEnvelope:{objective:'MECHANICAL_CHANGED_OBJECTIVE'},
      revision:{...goal.revision,objective:'MECHANICAL_CHANGED_OBJECTIVE',authorizationRef:nextAuth.id}});
    authorizations.bind(nextAuth.id,'author',{kind:'GOAL',goalId:goal.id,revision:next.goalRevision});
    return next;
  });
  return {db,store,goals,contexts,history,authorizations,workspaces,workspace,worker,receipt,access,continueWithChangedObjective,continueWithoutChanges,sends:()=>sends};
}

test('actual Driver counts four distinct committed read pages before acknowledging their decisions',async t=>{
  const h=setup(t,false);await h.worker.runOnce(h.receipt.runId);
  const run=h.store.readRun(h.receipt.runId);assert.equal(run.status,'PARTIAL');
  assert.equal((run.result as any).reason,'MECHANICAL_READ_COMPLETE');assert.equal(h.sends(),5);
  const pages=(h.db.prepare("SELECT observation_json FROM agent_steps WHERE run_id=? AND status='COMMITTED' ORDER BY rowid").all(run.id) as any[]).map(row=>JSON.parse(row.observation_json).data.rows[0]);
  assert.deepEqual(pages.map(page=>[page.start,page.end]),[[0,100],[100,200],[200,300],[300,400]]);
});

test('actual Driver still stops repeated identical pages without treating new call IDs as reading progress',async t=>{
  const h=setup(t,true);await h.worker.runOnce(h.receipt.runId);
  const run=h.store.readRun(h.receipt.runId);assert.equal(run.status,'PARTIAL');
  assert.equal((run.result as any).reason,'NO_PROGRESS_LIMIT');assert.equal(h.sends(),4);
});

test('an explicit changed author objective can obtain a new decision after the previous no-progress stop',async t=>{
  const h=setup(t,true);await h.worker.runOnce(h.receipt.runId);
  assert.equal((h.store.readRun(h.receipt.runId).result as any).reason,'NO_PROGRESS_LIMIT');
  const before=h.sends(),next=h.continueWithChangedObjective();
  await h.worker.runOnce(next.runId);
  assert.ok(h.sends()>before,'a revised author objective must not be permanently stopped before its first decision');
});

test('ordinary author continuation reissues its grant without erasing the unchanged no-progress stop',async t=>{
  const h=setup(t,true);await h.worker.runOnce(h.receipt.runId);
  assert.equal((h.store.readRun(h.receipt.runId).result as any).reason,'NO_PROGRESS_LIMIT');
  const before=h.goals.readRunLink(h.receipt.runId)!,next=await h.continueWithoutChanges();
  const continued=h.goals.readRunLink(next.runId)!;
  assert.notEqual(continued.authorizationRef,before.authorizationRef);
  assert.equal(continued.budgetId,before.budgetId);
  assert.equal(continued.noProgressStreak,before.noProgressStreak,'new authorization identity alone does not represent changed author intent');
});

test('a direct author manuscript edit after no-progress permits CONTINUE to sample the changed work',async t=>{
  const h=setup(t,true);await h.worker.runOnce(h.receipt.runId);
  assert.equal((h.store.readRun(h.receipt.runId).result as any).reason,'NO_PROGRESS_LIMIT');
  const before=h.sends(),current=h.workspaces.read(h.workspace.id,'author'),document=structuredClone(current.document);
  document.units[0].scenes[0].blocks[0].text+=' AUTHOR_NEW_CONTENT';
  h.workspaces.saveAuthor({ownerId:'author',workspaceId:current.id,requestId:'direct-author-revision',expectedRevision:current.revision,expectedEpoch:current.writerEpoch,document});
  const next=await h.continueWithoutChanges();await h.worker.runOnce(next.runId);
  assert.ok(h.sends()>before,'server-proven author manuscript change must allow a new decision');
});

test('a same-content author REVISE command does not reset no-progress merely by choosing a different command kind',async t=>{
  const h=setup(t,true);await h.worker.runOnce(h.receipt.runId);
  const before=h.goals.readRunLink(h.receipt.runId)!,next=await h.continueWithoutChanges('GOAL_REVISE');
  const continued=h.goals.readRunLink(next.runId)!;
  assert.notEqual(continued.authorizationRef,before.authorizationRef);
  assert.equal(continued.budgetId,before.budgetId);
  assert.equal(continued.noProgressStreak,before.noProgressStreak,'an unchanged objective is still the same failed attempt even when command kind is REVISE');
});
