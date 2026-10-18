import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentError, AgentWorker, CapabilityRegistry, hashValue, type GoalAcceptance, type ModelRequest, type PreparedCall, type ExecutionToken, type Observation } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteBudgetStore, SqliteGoalStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
const code = (name: string) => (error: unknown) => error instanceof AgentError && error.code === name;
const ref = { uri: 'workspace:test', version: '1', contentHash: hashValue('original'), branch: 'draft' };
const input = (overrides: Partial<GoalAcceptance> = {}): GoalAcceptance => ({ ownerId:'owner',scopeId:'scope',requestId:'accept',requestEnvelope:{ goal:'test' },policyRevision:'p1',objective:'mechanical protocol',contract:{pluginId:'test',version:'1',value:{done:true},digest:hashValue({done:true})},authorizationRef:'auth:1',workspaceRef:ref,sourceRefs:[],skillManifest:[],route:{channel:'api',routeRef:'mock:fixed'},stopPolicy:'CONTRACT_COMPLETE',turnLimits:{maxDecisions:2,maxToolCalls:2},budgetLimits:{maxInvocations:3,maxToolCalls:3,maxTurns:3,maxRepairRounds:1},...overrides});
function setup(t: any, options: Partial<GoalAcceptance> = {}, verify: (run: unknown, proof: unknown) => void = () => {}, decisionGuard?: (request:ModelRequest,run:any,phase:'CONSUME'|'VIEW')=>void) {
  const db = new Database(':memory:'); t.after(()=>db.close()); const store = new AgentSqliteStore(db); store.ensureSchema(); const budgets = new SqliteBudgetStore(store); const goals = new SqliteGoalStore(store,budgets,verify,decisionGuard); goals.ensureSchema(); const journal = new SqliteModelJournal(store); journal.ensureSchema(); const accepted = goals.accept(input(options));
  const claim = () => store.claim('worker',30000,accepted.runId)!;
  const sample = (token:ExecutionToken) => { const turn=goals.openTurn(token); return goals.saveSampling(token,{turnId:turn.id,index:turn.nextDecisionIndex,modelRequest:{operationKey:`decision:${turn.id}:${turn.nextDecisionIndex}`,channel:'api',routeRef:'mock:fixed',prompt:'Mechanical decision only'},allowedToolsDigest:hashValue([]),progressFingerprint:'state:1'}); };
  const req = (key:string):ModelRequest=>({operationKey:key,channel:'api',routeRef:'mock:fixed',prompt:'mechanical'});
  return {db,store,budgets,goals,journal,accepted,claim,sample,req};
}
const stop = {kind:'STOP' as const,reason:'mechanical stop',remainingWork:['pending']};
const call = {kind:'CALL' as const,capabilityId:'test.read',capabilityVersion:'1',arguments:{value:1},planUpdate:null};
function prepared(callId:string, token:ExecutionToken):PreparedCall { return {request:{capabilityId:call.capabilityId,capabilityVersion:'1',input:call.arguments,callId},implementationDigest:'impl',contractDigest:'contract',inputDigest:'input',binding:{ownerId:'owner',scopeId:'scope',commandRevision:String(token.inputRevision),policyRevision:'p1'},sources:[],targets:[],preparedDigest:'digest'}; }
const observation:Observation={status:'SUCCEEDED',summary:'mechanical receipt',data:{n:1},evidence:[],artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'};

test('goal acceptance replays original envelope before current Skill resolution and enforces owner/CAS',t=>{
 const h=setup(t); assert.deepEqual(h.goals.accept(input({skillManifest:['changed'],route:{channel:'api',routeRef:'new'}})),h.accepted);
 assert.throws(()=>h.goals.accept(input({requestEnvelope:{goal:'different'}})),code('IDEMPOTENCY_CONFLICT'));
 assert.throws(()=>h.goals.read(h.accepted.goalId,'other'),code('GOAL_NOT_FOUND'));
 const c=h.claim(); h.store.control(c.run.id,'owner',c.run.version,'pause','pause');
 assert.throws(()=>h.goals.continue({goalId:h.accepted.goalId,ownerId:'owner',expectedVersion:999,expectedRunVersion:1,requestId:'continue',requestEnvelope:{}}),code('GOAL_VERSION_CONFLICT'));
});
test('shared invocation budget persists through terminal successor and retains physical attempt/unknown usage',t=>{
 const h=setup(t,{budgetLimits:{maxInvocations:1,maxToolCalls:3,maxTurns:3,maxRepairRounds:1}}), c=h.claim();
 const invocation=h.journal.prepare(c.token,h.req('first')), attempt=h.journal.startAttempt(c.token,invocation.id);
 h.journal.recordResult(invocation.id,attempt.attemptId,{text:'mechanical',provenance:{channel:'provider'}});
 h.store.finish(c.token,'PARTIAL',{}); const goal=h.goals.read(h.accepted.goalId,'owner'), run=h.store.readRun(c.run.id);
 assert.equal(goal.activeRunId,null);
 const successor=h.goals.continue({goalId:goal.id,ownerId:'owner',expectedVersion:goal.version,expectedRunVersion:run.version,requestId:'continue',requestEnvelope:{continue:true}});
 assert.notEqual(successor.runId,run.id); assert.equal(successor.budgetId,h.accepted.budgetId);
 const c2=h.store.claim('worker',30000,successor.runId)!; assert.throws(()=>h.journal.prepare(c2.token,h.req('next')),code('BUDGET_EXHAUSTED'));
 assert.equal(h.goals.read(goal.id,'owner').activeRunId,null); assert.equal(h.store.readRun(c2.run.id).status,'PARTIAL');
 const budget=h.budgets.read(successor.budgetId,'owner'); assert.equal(budget.used.invocations,1); assert.equal(budget.used.attempts,1); assert.equal(budget.used.unknownUsageAttempts,1);
});
test('UNKNOWN blocks revision and new operation even after pause/manual takeover; evidence is retained',t=>{
 const h=setup(t), c=h.claim(); const invocation=h.journal.prepare(c.token,h.req('unknown')); h.journal.startAttempt(c.token,invocation.id); h.journal.markUnknown(c.token,invocation.id,'mock lost');
 const run=h.store.readRun(c.run.id), goal=h.goals.read(h.accepted.goalId,'owner');
 assert.throws(()=>h.goals.revise({goalId:goal.id,ownerId:'owner',expectedVersion:goal.version,expectedRunVersion:run.version,requestId:'revise',requestEnvelope:{revision:2},revision:input()}),code('RECONCILIATION_REQUIRED'));
 const paused=h.store.control(run.id,'owner',run.version,'pause','pause'); const manual=h.store.accept({requestId:'manual',threadId:run.threadId,ownerId:'owner',scopeId:'scope',kind:'CAPABILITY',input:{},policyRevision:'p1',maxInvocations:5});
 h.goals.attachManualRun({runId:manual.runId,ownerId:'owner',goalId:goal.id,expectedGoalVersion:goal.version}); const m=h.store.claim('manual-worker',30000,manual.runId)!;
 assert.ok(m); assert.throws(()=>h.journal.prepare(m.token,h.req('bypass')),code('RECONCILIATION_REQUIRED')); assert.equal(h.journal.read(invocation.id).status,'UNKNOWN'); assert.equal(paused.status,'PAUSED');
});
test('CALL consumes only a real committed receipt once; pointers and progress survive lease replacement',t=>{
 const h=setup(t), c=h.claim(), sampling=h.sample(c.token), decision=h.goals.acceptDecision(c.token,sampling.id,call);
 assert.throws(()=>h.goals.consumeReceipt(c.token,decision.id),code('MISSING_EFFECT_RECEIPT'));
 const step=h.store.savePrepared(c.token,prepared(decision.callId!,c.token)); h.store.commitStep({...c.token,stepId:step.id},decision.callId!,observation,()=>{});
 h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(c.run.id); const resumed=h.claim();
 const progress={before:'state:1',after:'state:1'}; assert.deepEqual(h.goals.consumeReceipt(resumed.token,decision.id,undefined,progress),observation);
 h.goals.consumeReceipt(resumed.token,decision.id,undefined,progress); assert.equal(h.goals.execution(resumed.token).link.noProgressStreak,1);
 assert.equal(h.goals.openTurn(resumed.token).nextDecisionIndex,1); assert.equal(h.budgets.read(h.accepted.budgetId,'owner').used.toolCalls,1);
 assert.throws(()=>h.store.savePrepared(resumed.token,prepared('unaccepted',resumed.token)),code('GOAL_CALL_NOT_ACCEPTED'));
});
test('a durably accepted decision resets repeated parent claim detection before its child is frozen',t=>{
 const h=setup(t),first=h.claim(),sampling=h.sample(first.token);
 h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(first.run.id);
 const second=h.claim(),decision=h.goals.acceptDecision(second.token,sampling.id,call);
 assert.equal(h.store.events(first.run.threadId,'owner').at(-1)?.type,'decision.accepted');
 h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(first.run.id);
 const third=h.claim();
 assert.equal(third.run.status,'RUNNING');
 assert.equal(h.goals.readSampling(sampling.turnId,0)?.acceptedDecision?.id,decision.id);
 assert.equal(h.store.getStep(first.run.id,first.run.generation,decision.callId!),null);
});
test('a source guard that outlives its lease cannot persist an accepted decision',t=>{
 let h!:ReturnType<typeof setup>,expire=false;
 h=setup(t,{},()=>{},(_request,run)=>{if(expire)h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(run.id);});
 const claimed=h.claim(),sampling=h.sample(claimed.token);expire=true;
 assert.throws(()=>h.goals.acceptDecision(claimed.token,sampling.id,call),code('LEASE_LOST'));
 assert.equal(h.goals.readSampling(sampling.turnId,0)?.acceptedDecision,null);
 assert.equal(h.store.events(claimed.run.threadId,'owner').some(event=>event.type==='decision.accepted'),false);
});
test('a source guard that expires the lease cannot consume a FINISH proposal',t=>{
 let h!:ReturnType<typeof setup>,expire=false;
 h=setup(t,{},()=>{},(_request,run)=>{if(expire)h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(run.id);});
 const claimed=h.claim(),sampling=h.sample(claimed.token),decision=h.goals.acceptDecision(claimed.token,sampling.id,{kind:'FINISH',artifactRefs:[],summary:'MECHANICAL'});
 expire=true;
 assert.throws(()=>h.goals.advanceDecision(claimed.token,decision.id,{before:'state:1',after:'state:1'},['mechanical pending']),code('LEASE_LOST'));
 assert.equal(h.goals.readSampling(sampling.turnId,0)?.acceptedDecision?.consumed,false);
});
test('ASK consumption/wait releases writer and queue atomically so author manual capability can run',t=>{
 const h=setup(t); let writer:string|null=null; h.store.addLifecycleParticipant({transition:(_p,n)=>{ if(n.status==='RUNNING') writer=n.id; if(['WAITING_INPUT','PAUSED','NEEDS_REBASE','SUCCEEDED','PARTIAL','FAILED','CANCELED'].includes(n.status)) writer=null; }});
 const c=h.claim(), sampling=h.sample(c.token), decision=h.goals.acceptDecision(c.token,sampling.id,{kind:'ASK',message:'author choice',choices:[]});
 h.goals.awaitDecision(c.token,decision.id,{before:'state:1',after:'state:1'}); assert.equal(writer,null); assert.equal(h.store.readRun(c.run.id).status,'WAITING_INPUT');
 const manual=h.store.accept({requestId:'manual',threadId:c.run.threadId,ownerId:'owner',scopeId:'scope',kind:'CAPABILITY',input:{},policyRevision:'p1',maxInvocations:4});
 h.goals.attachManualRun({runId:manual.runId,ownerId:'owner',goalId:h.accepted.goalId,expectedGoalVersion:h.goals.read(h.accepted.goalId,'owner').version}); assert.ok(h.store.claim('manual-worker',30000,manual.runId)); assert.equal(writer,manual.runId);
 const saved=h.goals.readSampling(sampling.turnId,0)!; assert.equal(saved.acceptedDecision!.consumed,true);
});
test('finish commits proof, consumption, release and terminal together; proof failure rolls back all',t=>{
 let permitted=false; const h=setup(t,{},()=>{if(!permitted) throw new AgentError('PROOF_STALE','mechanical mismatch');}),c=h.claim(),s=h.sample(c.token),d=h.goals.acceptDecision(c.token,s.id,{kind:'FINISH',artifactRefs:[ref],summary:'mechanical done'});
 assert.throws(()=>h.goals.finishDecision(c.token,d.id,{status:'SUCCEEDED',result:{}},undefined,{ref}),code('PROOF_STALE')); assert.equal(h.goals.readSampling(s.turnId,0)!.acceptedDecision!.consumed,false); assert.equal(h.store.readRun(c.run.id).status,'RUNNING');
 permitted=true; h.goals.finishDecision(c.token,d.id,{status:'SUCCEEDED',result:{done:true}},undefined,{ref}); assert.equal(h.goals.readSampling(s.turnId,0)!.acceptedDecision!.consumed,true); assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,null); assert.equal(h.store.claim('restart',30000,c.run.id),null);
});
test('Turn yield and decision feedback persist; total Turn exhaustion releases goal',t=>{
 const h=setup(t,{turnLimits:{maxDecisions:1,maxToolCalls:1},budgetLimits:{maxInvocations:3,maxToolCalls:3,maxTurns:1,maxRepairRounds:1}}),c=h.claim(),s=h.sample(c.token),d=h.goals.acceptDecision(c.token,s.id,{kind:'FINISH',artifactRefs:[],summary:'proposal'});
 h.goals.advanceDecision(c.token,d.id,{before:'state:1',after:'state:1'},['actual missing coverage']); assert.deepEqual(h.goals.execution(c.token).link.lastFeedback,['actual missing coverage']);
 assert.throws(()=>h.sample(c.token),code('TURN_DECISION_LIMIT')); h.goals.yieldTurn(c.token); const next=h.claim(); assert.throws(()=>h.goals.openTurn(next.token),code('BUDGET_EXHAUSTED')); assert.equal(h.store.readRun(c.run.id).status,'PARTIAL'); assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,null);
});
test('budget exhaustion and worker exception use lifecycle hooks, and cancel retires current turn',async t=>{
 const h=setup(t); let writer:string|null=null; h.store.addLifecycleParticipant({transition:(_p,n)=>{writer=n.status==='RUNNING'?n.id:null;}});
 const registry=new CapabilityRegistry({assertExecution:async c=>{h.store.assertExecution(c.execution);},authorize:async()=>{}});
 const worker=new AgentWorker(h.store,registry,{workerId:'worker',handlers:{GOAL:async c=>{h.goals.openTurn(c.token);throw new Error('mechanical failure');}}}); await worker.runOnce(h.accepted.runId); assert.equal(writer,null); assert.equal(h.store.readRun(h.accepted.runId).status,'FAILED'); assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,null);
});
test('shared tool cap stops before prepare and clears ownership without refunding previous receipts',t=>{
 const h=setup(t,{budgetLimits:{maxInvocations:3,maxToolCalls:1,maxTurns:3,maxRepairRounds:1}}),c=h.claim();
 for(let n=0;n<2;n++){ const s=h.sample(c.token),d=h.goals.acceptDecision(c.token,s.id,call); if(n===0){const step=h.store.savePrepared(c.token,prepared(d.callId!,c.token));h.store.commitStep({...c.token,stepId:step.id},d.callId!,observation,()=>{});h.goals.consumeReceipt(c.token,d.id);}else assert.throws(()=>h.store.savePrepared(c.token,prepared(d.callId!,c.token)),code('BUDGET_EXHAUSTED')); }
 assert.equal(h.store.readRun(c.run.id).status,'PARTIAL'); assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,null); assert.equal(h.budgets.read(h.accepted.budgetId,'owner').used.toolCalls,1);
});
test('budget increases are CAS/idempotent and never reset consumed reservations',t=>{
 const h=setup(t); const b=h.budgets.read(h.accepted.budgetId,'owner'); h.budgets.tryReserve({budgetId:b.id,kind:'REPAIR',operationId:'repair:1'}); assert.equal(h.budgets.tryReserve({budgetId:b.id,kind:'REPAIR',operationId:'repair:2'}),false);
 const request={ownerId:'owner',budgetId:b.id,expectedVersion:b.version,requestId:'increase',limits:{...b.limits,maxRepairRounds:2}}; const next=h.budgets.increase(request); assert.equal(next.used.repairRounds,1); assert.deepEqual(h.budgets.increase(request),next); assert.equal(h.budgets.tryReserve({budgetId:b.id,kind:'REPAIR',operationId:'repair:2'}),true);
 assert.throws(()=>h.budgets.increase({...request,requestId:'stale'}),code('BUDGET_VERSION_CONFLICT'));
});

test('activity time excludes manual wait and survives expired lease with conservative capped accounting',t=>{
 const h=setup(t,{budgetLimits:{maxInvocations:5,maxToolCalls:3,maxTurns:3,maxRepairRounds:1,maxActiveMs:1000}}),c=h.claim();
 const now=Date.now(); h.db.prepare('UPDATE agent_budget_activity SET started_at=?,lease_until=? WHERE run_id=?').run(now-500,now-200,c.run.id); h.db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(c.run.id);
 const resumed=h.claim(); assert.ok(resumed); const before=h.budgets.read(h.accepted.budgetId,'owner').used.activeMs; assert.ok(before>=300 && before<400);
 h.store.wait(resumed.token,'WAITING_INPUT','author'); const waiting=h.budgets.read(h.accepted.budgetId,'owner').used.activeMs; assert.equal((h.db.prepare('SELECT count(*) n FROM agent_budget_activity').get() as any).n,0);
 const run=h.store.readRun(c.run.id); h.store.control(run.id,'owner',run.version,'resume','resume'); const again=h.claim(); assert.ok(again); assert.ok(h.budgets.read(h.accepted.budgetId,'owner').used.activeMs>=waiting);
 h.db.prepare('UPDATE agent_budget_activity SET started_at=? WHERE run_id=?').run(Date.now()-1100,c.run.id);
 assert.throws(()=>h.journal.prepare(again.token,h.req('out-of-time')),code('BUDGET_EXHAUSTED')); assert.equal(h.store.readRun(c.run.id).status,'PARTIAL');
});
test('dispatch checks deadline after preparation and never opens a physical attempt when expired',t=>{
 const h=setup(t,{budgetLimits:{maxInvocations:3,maxToolCalls:3,maxTurns:3,maxRepairRounds:1,deadlineAt:Date.now()+30000}}),c=h.claim(); const invocation=h.journal.prepare(c.token,h.req('prepared-before-deadline'));
 const row=h.db.prepare('SELECT limits_json FROM agent_budgets WHERE id=?').get(h.accepted.budgetId) as any; const limits=JSON.parse(row.limits_json); limits.deadlineAt=Date.now()-1;h.db.prepare('UPDATE agent_budgets SET limits_json=? WHERE id=?').run(JSON.stringify(limits),h.accepted.budgetId);
 assert.throws(()=>h.journal.startAttempt(c.token,invocation.id),code('BUDGET_EXHAUSTED')); assert.equal(h.budgets.read(h.accepted.budgetId,'owner').used.attempts,0); assert.equal(h.store.readRun(c.run.id).status,'PARTIAL');
});
test('all lifecycle changes roll back when a host participant rejects the transition',t=>{
 const h=setup(t),c=h.claim(); h.sample(c.token); h.store.addLifecycleParticipant({transition:(_p,next)=>{if(next.status==='PARTIAL') throw new AgentError('HOST_REJECT','mechanical rollback');}});
 assert.throws(()=>h.store.finish(c.token,'PARTIAL',{}),code('HOST_REJECT')); assert.equal(h.store.readRun(c.run.id).status,'RUNNING'); assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,c.run.id); assert.equal(h.goals.openTurn(c.token).state,'OPEN');
});

test('DURABLE committed receipt survives child expiry and author takeover; replay never repeats its effect or old CURRENT precondition',async t=>{
 const {durableFixture}=await import('./fixtures/agent-durable-fixture'); const dir=mkdtempSync(path.join(tmpdir(),'goal-reopen-'));const file=path.join(dir,'agent.sqlite');let db=new Database(file);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});let h=durableFixture(db),budgets=new SqliteBudgetStore(h.store),goals=new SqliteGoalStore(h.store,budgets);goals.ensureSchema();
 const accepted=goals.accept(input({scopeId:'document',policyRevision:'test-policy-v1'}));
 const makeController=()=>new AgentWorker(h.store,h.registry,{workerId:'goal-worker',handlers:{GOAL:async ctx=>{
   const turn=goals.openTurn(ctx.token);let s=goals.readSampling(turn.id,turn.nextDecisionIndex); if(!s)s=goals.saveSampling(ctx.token,{turnId:turn.id,index:turn.nextDecisionIndex,modelRequest:{operationKey:`decision:${turn.id}:${turn.nextDecisionIndex}`,channel:'api',routeRef:'mock:fixed',prompt:'mechanical'},allowedToolsDigest:hashValue([]),progressFingerprint:'before'});
   const d=s.acceptedDecision??goals.acceptDecision(ctx.token,s.id,{kind:'CALL',capabilityId:'document.append',capabilityVersion:'1',arguments:{text:'mechanical update'},planUpdate:null});
   await ctx.call({capabilityId:'document.append',capabilityVersion:'1',input:{text:'mechanical update'},callId:d.callId!});goals.consumeReceipt(ctx.token,d.id,undefined,{before:'before',after:'after'});return{status:'PARTIAL',result:{receipt:true}};
 }}});
 let controller=makeController(); await controller.runOnce(accepted.runId);const child=h.store.claimChild('doomed',30000,accepted.runId)!;
 await h.registry.execute(child.step.prepared,{ownerId:'owner',scopeId:'document',commandRevision:'1',policyRevision:'test-policy-v1',execution:child.token,signal:new AbortController().signal});
 db.close();db=new Database(file);h=durableFixture(db);budgets=new SqliteBudgetStore(h.store);goals=new SqliteGoalStore(h.store,budgets);goals.ensureSchema();controller=makeController();
 const waiting=h.store.readRun(accepted.runId);const paused=h.store.control(waiting.id,'owner',waiting.version,'pause','pause');db.prepare("UPDATE test_child_documents SET revision=3,text='author edit' WHERE id='document'").run();h.store.control(paused.id,'owner',paused.version,'resume','resume');
 await controller.runOnce(accepted.runId);await h.childWorker.runOnce(accepted.runId);await controller.runOnce(accepted.runId);
 assert.equal(h.store.readRun(accepted.runId).status,'PARTIAL');assert.equal((db.prepare('SELECT count(*) n FROM test_child_effects').get() as any).n,1);assert.equal((db.prepare('SELECT text FROM test_child_documents').get() as any).text,'author edit');assert.equal(budgets.read(accepted.budgetId,'owner').used.toolCalls,1);assert.equal(goals.read(accepted.goalId,'owner').activeRunId,null);
});
test('cancel closes active Turn and keeps committed fact without releasing another run writer',t=>{
 const h=setup(t),c=h.claim(),s=h.sample(c.token),d=h.goals.acceptDecision(c.token,s.id,call),step=h.store.savePrepared(c.token,prepared(d.callId!,c.token));h.store.commitStep({...c.token,stepId:step.id},d.callId!,observation,()=>{});
 const run=h.store.readRun(c.run.id);h.store.control(run.id,'owner',run.version,'cancel','cancel');assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,null);assert.equal(h.store.getStep(run.id,run.generation,d.callId!)!.status,'COMMITTED');assert.equal((h.db.prepare('SELECT data_json FROM agent_execution_turns WHERE id=?').get(s.turnId) as any).data_json.includes('CLOSED'),true);
});

test('lease heartbeat exhaustion persists PARTIAL and releases writer rather than failing or leaving a live owner',t=>{
 const h=setup(t,{budgetLimits:{maxInvocations:3,maxToolCalls:3,maxTurns:3,maxRepairRounds:1,maxActiveMs:1000}}),c=h.claim();h.sample(c.token);
 h.db.prepare('UPDATE agent_budget_activity SET started_at=? WHERE run_id=?').run(Date.now()-1100,c.run.id);
 assert.equal(h.store.renew(c.token,30000),null);assert.equal(h.store.readRun(c.run.id).status,'PARTIAL');assert.equal(h.goals.read(h.accepted.goalId,'owner').activeRunId,null);assert.equal((h.db.prepare('SELECT count(*) n FROM agent_budget_activity').get() as any).n,0);
});

test('only an explicit author revision resets no-progress; successor, replay and shared budget remain bounded',t=>{
 const h=setup(t,{turnLimits:{maxDecisions:4,maxToolCalls:4}}),c=h.claim(),invocation=h.journal.prepare(c.token,h.req('already-spent'));
 const attempt=h.journal.startAttempt(c.token,invocation.id);h.journal.recordResult(invocation.id,attempt.attemptId,{text:'mechanical',provenance:{channel:'provider'}});
 for(let i=0;i<3;i++){const sample=h.sample(c.token),decision=h.goals.acceptDecision(c.token,sample.id,{kind:'FINISH',summary:'mechanical premature finish',artifactRefs:[]});h.goals.advanceDecision(c.token,decision.id,{before:'state:1',after:'state:1'},['unfinished']);}
 assert.equal(h.goals.execution(c.token).link.noProgressStreak,3);h.store.finish(c.token,'PARTIAL',{reason:'NO_PROGRESS_LIMIT'});
 let goal=h.goals.read(h.accepted.goalId,'owner'),run=h.store.readRun(c.run.id);
 const successor=h.goals.continue({goalId:goal.id,ownerId:'owner',expectedVersion:goal.version,expectedRunVersion:run.version,requestId:'automatic-successor',requestEnvelope:{continue:true}});
 assert.equal(h.goals.readRunLink(successor.runId)!.noProgressStreak,3);
 const next=h.store.claim('next',30000,successor.runId)!;h.store.finish(next.token,'PARTIAL',{reason:'NO_PROGRESS_LIMIT'});goal=h.goals.read(goal.id,'owner');run=h.store.readRun(next.run.id);
 const before=h.budgets.read(goal.revision.budgetId,'owner'),command={goalId:goal.id,ownerId:'owner',expectedVersion:goal.version,expectedRunVersion:run.version,requestId:'author-new-objective',requestEnvelope:{objective:'changed'},revision:{...goal.revision,objective:'explicit changed author objective'}};
 const revised=h.goals.revise(command);assert.equal(h.goals.readRunLink(revised.runId)!.noProgressStreak,0);assert.equal(revised.budgetId,before.id);assert.deepEqual(h.budgets.read(before.id,'owner'),before);
 const fresh=h.store.claim('fresh',30000,revised.runId)!,sample=h.sample(fresh.token),decision=h.goals.acceptDecision(fresh.token,sample.id,{kind:'FINISH',summary:'still incomplete',artifactRefs:[]});h.goals.advanceDecision(fresh.token,decision.id,{before:'state:1',after:'state:1'});
 assert.equal(h.goals.readRunLink(revised.runId)!.noProgressStreak,1);assert.deepEqual(h.goals.revise(command),revised);assert.equal(h.goals.readRunLink(revised.runId)!.noProgressStreak,1,'HTTP replay cannot erase progress accrued after the author revision');
 const current=h.store.readRun(revised.runId);h.store.control(current.id,'owner',current.version,'pause','pause-new');const paused=h.store.readRun(current.id),updated=h.goals.read(goal.id,'owner');h.goals.continue({goalId:goal.id,ownerId:'owner',expectedVersion:updated.version,expectedRunVersion:paused.version,requestId:'plain-resume',requestEnvelope:{resume:true}});assert.equal(h.goals.readRunLink(revised.runId)!.noProgressStreak,1);
});

test('a newly signed continuation revision preserves no-progress and an unchanged explicit revise cannot reset it',t=>{
 const h=setup(t),claimed=h.claim(),sample=h.sample(claimed.token);
 const decision=h.goals.acceptDecision(claimed.token,sample.id,{kind:'FINISH',summary:'mechanical incomplete',artifactRefs:[]});
 h.goals.advanceDecision(claimed.token,decision.id,{before:'state:1',after:'state:1'});
 h.store.finish(claimed.token,'PARTIAL',{reason:'unfinished'});
 const before=h.goals.read(h.accepted.goalId,'owner'),run=h.store.readRun(claimed.run.id),budget=h.budgets.read(before.revision.budgetId,'owner');
 const continued=h.goals.continue({goalId:before.id,ownerId:'owner',expectedVersion:before.version,expectedRunVersion:run.version,
  requestId:'fresh-authorization',requestEnvelope:{continue:true},revision:{...before.revision,authorizationRef:'auth:2'}});
 assert.equal(h.goals.readRunLink(continued.runId)!.noProgressStreak,1);
 assert.equal(continued.budgetId,budget.id);
 assert.deepEqual(h.budgets.read(budget.id,'owner'),budget);
 const current=h.goals.read(before.id,'owner'),nextRun=h.store.readRun(continued.runId);
 assert.throws(()=>h.goals.revise({goalId:current.id,ownerId:'owner',expectedVersion:current.version,expectedRunVersion:nextRun.version,
  requestId:'unchanged-revise',requestEnvelope:{revise:true},revision:{...current.revision,authorizationRef:'auth:3'}}),code('GOAL_REVISION_UNCHANGED'));
 assert.equal(h.goals.readRunLink(continued.runId)!.noProgressStreak,1);
 assert.equal(h.goals.read(current.id,'owner').version,current.version);
});
