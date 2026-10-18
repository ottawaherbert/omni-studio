import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentError, hashValue, type GoalAcceptance, type HistoryReadPolicy, type Observation, type PreparedCall, type ExecutionToken } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteBudgetStore, SqliteGoalStore, SqliteModelJournal, SqliteHistoryStore } from '../packages/agent-sqlite/src';
const code=(name:string)=>(error:unknown)=>error instanceof AgentError&&error.code===name;
const resource=(id='document',version='1')=>({uri:`resource://documents/${id}`,version,contentHash:hashValue({id,version}),branch:'workspace:test'});
function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();const budgets=new SqliteBudgetStore(store);const goals=new SqliteGoalStore(store,budgets,()=>{},()=>{});goals.ensureSchema();const journal=new SqliteModelJournal(store,()=>{});journal.ensureSchema();
 const state={grant:true,sampling:true,receipt:true,scope:true,revisions:new Set<number>([1,2,3]),seenSources:[] as string[]};
 const policy:HistoryReadPolicy={validationKey:()=> 'fixture-reader',withValidationBatch:read=>read(),authorizeReader:({reader,sourceAccess})=>{if(!state.scope||sourceAccess&&sourceAccess.scopeId!=='workspace-scope')throw new AgentError('DENIED','private detail');assert.equal(reader.run.ownerId,'owner');},authorize:({reader,origin})=>{if(!state.grant||!state.revisions.has(reader.revision.revision)||!state.revisions.has(origin.revision.revision))throw new AgentError('DENIED','private source');},assertSamplingView:({sampling})=>{if(!state.sampling)throw new AgentError('REVOKED','NEVER_HISTORY_PROMPT');assert.ok(sampling.modelRequest.prompt.includes('NEVER_HISTORY_PROMPT'));},assertReceiptView:({invocations})=>{if(!state.receipt)throw new AgentError('REVOKED','NEVER_RAW_BODY');for(const invocation of invocations)state.seenSources.push(invocation.id);}};
 const history=new SqliteHistoryStore(store,goals,policy);history.ensureSchema();
 const input:GoalAcceptance={ownerId:'owner',scopeId:'home',requestId:'goal1',requestEnvelope:{goal:1},policyRevision:'policy',objective:'protocol fixture',contract:{pluginId:'fixture',version:'1',value:{done:1},digest:hashValue({done:1})},authorizationRef:'grant:1',workspaceRef:resource('workspace'),sourceRefs:[],skillManifest:[],route:{channel:'api',routeRef:'mechanical'},stopPolicy:'CONTRACT_COMPLETE',turnLimits:{maxDecisions:20,maxToolCalls:20},budgetLimits:{maxInvocations:20,maxToolCalls:20,maxTurns:20,maxRepairRounds:2}};
 const accepted=goals.accept(input);let claimed=store.claim('reader',30000,accepted.runId)!;
 function prepare(token:ExecutionToken,callId:string,value='NEVER_RAW_ARGUMENTS'):PreparedCall{const input={value};const p:PreparedCall={request:{capabilityId:'fixture.read',capabilityVersion:'1',input,callId},implementationDigest:hashValue('impl'),contractDigest:hashValue('contract'),inputDigest:hashValue(input),binding:{ownerId:'owner',scopeId:'home',commandRevision:String(token.inputRevision),policyRevision:'policy'},sources:[resource()],targets:[],preparedDigest:''};const {preparedDigest,...rest}=p;p.preparedDigest=hashValue(rest);return p;}
 function receipt({consume=true,summary='A persisted result',withPlan=false,ownModel=false}={}){
   const token=claimed.token,turn=goals.openTurn(token);const sampling=goals.saveSampling(token,{turnId:turn.id,index:turn.nextDecisionIndex,modelRequest:{operationKey:`decision:${turn.id}:${turn.nextDecisionIndex}`,channel:'api',routeRef:'mechanical',prompt:'NEVER_HISTORY_PROMPT',contextRef:{id:'source-context',digest:hashValue('ctx')}},allowedToolsDigest:hashValue([])});
   const decision=goals.acceptDecision(token,sampling.id,{kind:'CALL',capabilityId:'fixture.read',capabilityVersion:'1',arguments:{value:'NEVER_RAW_ARGUMENTS'},planUpdate:withPlan?{summary:'A plan, not execution',intentions:[{id:'intent',description:'read next',evidenceRefs:[resource()]}]}:null});
   const step=store.savePrepared(token,prepare(token,decision.callId!));
   if(ownModel){const request=journal.prepare({...token,stepId:step.id},{operationKey:'own-input',channel:'api',routeRef:'mechanical',prompt:'NEVER_CHILD_PROMPT',contextRef:{id:'child-context',digest:hashValue('child')}});const attempt=journal.startAttempt({...token,stepId:step.id},request.id);journal.recordResult(request.id,attempt.attemptId,{text:'NEVER_RAW_MODEL_RESULT',provenance:{channel:'provider'}});}
   const observation:Observation={status:'SUCCEEDED',summary,data:{body:'NEVER_RAW_BODY'},evidence:[resource()],artifacts:[resource('artifact')],effectState:'NO_EFFECT',retry:'NEVER'};
   store.commitStep({...token,stepId:step.id},decision.callId!,observation,()=>{});if(consume)goals.consumeReceipt(token,decision.id);return{sampling,decision,step};
 }
 function resume(revise=false){const run=store.readRun(accepted.runId),goal=goals.read(accepted.goalId,'owner');if(run.status==='RUNNING')store.control(run.id,'owner',run.version,'pause',`pause:${run.version}`);const paused=store.readRun(run.id);goals.continue({goalId:goal.id,ownerId:'owner',expectedVersion:goals.read(goal.id,'owner').version,expectedRunVersion:paused.version,requestId:`continue:${paused.version}`,requestEnvelope:{resume:paused.version},...(revise?{revision:{...input,authorizationRef:'grant:2'}}:{})});claimed=store.claim('reader-next',30000,accepted.runId)!;return claimed;}
 return{db,store,goals,journal,history,state,policy,input,accepted,receipt,prepare,resume,claim:()=>claimed,access:{ownerId:'owner',scopeId:'workspace-scope',branch:'workspace:test'}};
}
test('history fails closed without complete synchronous policy and never returns raw execution input',t=>{
 const h=setup(t);assert.throws(()=>new SqliteHistoryStore(h.store,h.goals,{} as any),code('HISTORY_POLICY_REQUIRED'));h.receipt({ownModel:true});const page=h.history.listReceiptViews(h.claim().token);
 assert.equal(page.items.length,1);assert.equal(page.items[0].state,'VISIBLE');assert.equal(h.state.seenSources.length,1);assert.ok(!JSON.stringify(page).includes('NEVER_'));assert.ok(!JSON.stringify(page).includes('modelRequest'));assert.ok(!JSON.stringify(page).includes('prepared'));
 const bad=new SqliteHistoryStore(h.store,h.goals,{...h.policy,authorizeReader:async()=>{}});assert.throws(()=>bad.listReceiptViews(h.claim().token),code('HISTORY_POLICY_INVALID'));
});
test('only consumed controller receipt with matching real committed step enters the projection',t=>{
 const h=setup(t),r=h.receipt({consume:false});assert.equal(h.history.listReceiptViews(h.claim().token).items.length,0);h.goals.consumeReceipt(h.claim().token,r.decision.id);assert.equal(h.history.listReceiptViews(h.claim().token).items[0].state,'VISIBLE');
 const row=h.db.prepare('SELECT data_json FROM agent_samplings WHERE id=?').get(r.sampling.id) as any;const data=JSON.parse(row.data_json);data.acceptedDecision.stepId='forged-step';h.db.prepare('UPDATE agent_samplings SET data_json=? WHERE id=?').run(JSON.stringify(data),r.sampling.id);const redacted=h.history.listReceiptViews(h.claim().token).items[0];assert.deepEqual(redacted,{state:'REDACTED',id:r.step.id,reason:'HISTORY_UNAVAILABLE',sourceUsable:false});
});
test('plan projection is intention only, pins source decision and remains readable after source CURRENT advances',t=>{
 const h=setup(t);h.receipt({withPlan:true});const token=h.claim().token,reader=h.history.captureReader(token),view=h.history.readPlanForExecution(token)!;assert.equal(view.state,'VISIBLE');if(view.state!=='VISIBLE')return;
 assert.equal(view.projection.meaning,'PLAN_NOT_EXECUTION');assert.equal(view.projection.intentions.length,1);assert.ok(!JSON.stringify(view).includes('NEVER_'));h.resume(true);
 h.history.assertSourceForReader(reader,view.exactRef,'EXACT','VIEW',undefined,h.access);h.history.assertSourceForReader(reader,view.exactRef,'EXACT','CONSUME',h.claim().token,h.access);
 assert.equal(h.history.readPlanForExecution(h.claim().token),null);assert.equal(h.history.readPlanForExecution(h.claim().token,view.projection.id)!.state,'VISIBLE');
});
test('revoked sampling or tool context redacts all content and invalidates old source and collection refs',t=>{
 const h=setup(t);h.receipt({withPlan:true});const token=h.claim().token,page=h.history.listReceiptViews(token),item=page.items[0];assert.equal(item.state,'VISIBLE');if(item.state!=='VISIBLE')return;
 h.state.sampling=false;const changed=h.history.listReceiptViews(token);assert.equal(changed.items[0].state,'REDACTED');assert.equal(changed.sourceUsable,false);assert.notEqual(changed.collectionRef.contentHash,page.collectionRef.contentHash);assert.ok(!JSON.stringify(changed).includes('persisted result'));assert.throws(()=>h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW',undefined,h.access),code('HISTORY_SOURCE_INVALID'));assert.throws(()=>h.history.assertSourceForReader(page.reader,page.collectionRef,'EXACT','VIEW',undefined,h.access),code('HISTORY_SOURCE_INVALID'));
 h.state.sampling=true;h.state.receipt=false;assert.equal(h.history.listReceiptViews(token).items[0].state,'REDACTED');
});
test('empty history is a real collection dependency; new receipts invalidate CURRENT but not historical empty VIEW',t=>{
 const h=setup(t),token=h.claim().token,empty=h.history.listReceiptViews(token);assert.equal(empty.items.length,0);h.history.assertSourceForReader(empty.reader,empty.collectionRef,'COLLECTION','CONSUME',token,h.access);h.receipt();
 const before=(h.db.prepare('SELECT count(*) AS n FROM agent_history_collections').get() as {n:number}).n;
 assert.throws(()=>h.history.assertSourceForReader(empty.reader,empty.collectionRef,'COLLECTION','CONSUME',token,h.access),code('HISTORY_SOURCE_INVALID'));
 assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_history_collections').get() as {n:number}).n,before);
 h.history.assertSourceForReader(empty.reader,empty.collectionRef,'EXACT','VIEW',undefined,h.access);assert.throws(()=>h.history.assertSourceForReader(empty.reader,empty.collectionRef,'COLLECTION','VIEW',undefined,h.access),code('HISTORY_SOURCE_INVALID'));
});
test('pagination is bounded and stable, rejects changed collections rather than silently skipping records',t=>{
 const h=setup(t);h.receipt({summary:'first'});h.receipt({summary:'second'});const token=h.claim().token,first=h.history.listReceiptViews(token,{limit:1});assert.equal(first.truncated,true);assert.ok(first.nextCursor);const second=h.history.listReceiptViews(token,{cursor:first.nextCursor!,limit:1});assert.equal(second.truncated,false);assert.notDeepEqual(first.items,second.items);assert.deepEqual(first.collectionRef,second.collectionRef);
 h.receipt({summary:'third'});assert.throws(()=>h.history.listReceiptViews(token,{cursor:first.nextCursor!,limit:1}),code('HISTORY_COLLECTION_CHANGED'));assert.throws(()=>h.history.listReceiptViews(token,{limit:51}),code('INVALID_HISTORY_LIMIT'));assert.throws(()=>h.history.listReceiptViews(token,{cursor:'not valid'}),code('INVALID_HISTORY_CURSOR'));
});
test('manual capability receipts require author command and bound Goal, not a fabricated model decision',t=>{
 const h=setup(t),run=h.store.readRun(h.accepted.runId);h.store.control(run.id,'owner',run.version,'pause','pause-manual');const request={capabilityId:'fixture.read',capabilityVersion:'1',input:{value:'NEVER_RAW_ARGUMENTS'},callId:'manual-call'};
 const manual=h.store.accept({requestId:'author-button',threadId:run.threadId,ownerId:'owner',scopeId:'home',kind:'CAPABILITY',input:{request},policyRevision:'policy',maxInvocations:3});h.goals.attachManualRun({runId:manual.runId,ownerId:'owner',goalId:h.accepted.goalId,expectedGoalVersion:h.goals.read(h.accepted.goalId,'owner').version});const c=h.store.claim('manual',30000,manual.runId)!;const step=h.store.savePrepared(c.token,h.prepare(c.token,request.callId));h.store.commitStep({...c.token,stepId:step.id},request.callId,{status:'SUCCEEDED',summary:'Author single step',data:{secret:'NEVER_RAW_BODY'},evidence:[],artifacts:[resource('manual')],effectState:'CANDIDATE_PRESERVED',retry:'NEVER'},()=>{});h.store.finish(c.token,'SUCCEEDED',{});h.resume();
 const page=h.history.listReceiptViews(h.claim().token);assert.equal(page.items.length,1);assert.equal(page.items[0].state,'VISIBLE');if(page.items[0].state==='VISIBLE')assert.equal(page.items[0].projection.origin.role,'MANUAL_STEP');
 h.db.prepare("DELETE FROM agent_engine_bindings WHERE request_id='author-button'").run();assert.equal(h.history.listReceiptViews(h.claim().token).items[0].state,'REDACTED');
});
test('frozen descriptor is not bearer authority: forgery, foreign owner and narrowed new grant are refused',t=>{
 const h=setup(t);h.receipt();const token=h.claim().token,page=h.history.listReceiptViews(token),item=page.items[0];if(item.state!=='VISIBLE')throw new Error('fixture');
 assert.throws(()=>h.history.assertSourceForReader({...page.reader,authorizationRef:'forged'},item.exactRef,'EXACT','VIEW',undefined,h.access),code('HISTORY_READER_INVALID'));assert.throws(()=>h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW'),code('HISTORY_READER_ACCESS_REQUIRED'));assert.throws(()=>h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW',undefined,{...h.access,ownerId:'other'}),code('HISTORY_READER_INVALID'));
 h.resume(true);h.state.revisions.delete(2);assert.throws(()=>h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','CONSUME',h.claim().token,h.access),code('HISTORY_SOURCE_INVALID'));h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW',undefined,h.access);
});
test('same Run new input generation preserves exact old origin and successor reads old facts without old lease',t=>{
 const h=setup(t);h.receipt();h.resume(true);h.receipt({summary:'revision two'});const page=h.history.listReceiptViews(h.claim().token);assert.equal(page.items.length,2);assert.deepEqual(page.items.map(item=>item.state==='VISIBLE'?item.projection.origin.goalRevision:null),[1,2]);
 const old=h.claim(),goal=h.goals.read(h.accepted.goalId,'owner');h.store.finish(old.token,'PARTIAL',{});const ended=h.store.readRun(old.run.id),latest=h.goals.read(goal.id,'owner');const next=h.goals.continue({goalId:goal.id,ownerId:'owner',expectedVersion:latest.version,expectedRunVersion:ended.version,requestId:'successor',requestEnvelope:{successor:true}});const successor=h.store.claim('next',30000,next.runId)!;assert.equal(h.history.listReceiptViews(successor.token).items.length,2);assert.throws(()=>h.store.assertExecution(old.token),code('LEASE_LOST'));
});
test('projection truncation is explicit and exact digests still reflect complete persisted facts',t=>{
 const h=setup(t),r=h.receipt({summary:'s'.repeat(1300)}),page=h.history.listReceiptViews(h.claim().token),view=page.items[0];if(view.state!=='VISIBLE')throw new Error('fixture');assert.equal(view.projection.summary.length,1200);assert.equal(view.projection.summaryTruncated,true);assert.ok(!JSON.stringify(view).includes('NEVER_RAW_BODY'));
 const row=h.db.prepare('SELECT observation_json FROM agent_steps WHERE id=?').get(r.step.id) as any,data=JSON.parse(row.observation_json);data.data.body='altered withheld body';h.db.prepare('UPDATE agent_steps SET observation_json=? WHERE id=?').run(JSON.stringify(data),r.step.id);const changed=h.history.listReceiptViews(h.claim().token).items[0];if(changed.state!=='VISIBLE')throw new Error('fixture');assert.notEqual(changed.exactRef.contentHash,view.exactRef.contentHash);
});

test('manual binding preserves explicit narrow grant and newer workspace version, and replays reject identity drift',t=>{
 const h=setup(t),run=h.store.readRun(h.accepted.runId);h.store.control(run.id,'owner',run.version,'pause','narrow-pause');
 const request={capabilityId:'fixture.read',capabilityVersion:'1',input:{value:'NEVER_RAW_ARGUMENTS'},callId:'narrow-manual'};
 const manual=h.store.accept({requestId:'narrow-command',threadId:run.threadId,ownerId:'owner',scopeId:'home',kind:'CAPABILITY',input:{request,authorizationRef:'manual:scene-one'},policyRevision:'policy',maxInvocations:2});
 const binding={runId:manual.runId,ownerId:'owner',goalId:h.accepted.goalId,expectedGoalVersion:h.goals.read(h.accepted.goalId,'owner').version,authorizationRef:'manual:scene-one',workspaceRef:resource('workspace','3')};
 const link=h.goals.attachManualRun(binding);assert.equal(link.authorizationRef,'manual:scene-one');assert.deepEqual(link.workspaceRef,binding.workspaceRef);assert.deepEqual(h.goals.attachManualRun(binding),link);
 assert.throws(()=>h.goals.attachManualRun({...binding,authorizationRef:'grant:1'}),code('MANUAL_BINDING_CONFLICT'));assert.throws(()=>h.goals.attachManualRun({...binding,workspaceRef:resource('workspace','4')}),code('MANUAL_BINDING_CONFLICT'));assert.throws(()=>h.goals.attachManualRun({...binding,workspaceRef:resource('other-workspace','3')}),code('MANUAL_BINDING_CONFLICT'));
 const c=h.store.claim('manual',30000,manual.runId)!,step=h.store.savePrepared(c.token,h.prepare(c.token,request.callId));h.store.commitStep({...c.token,stepId:step.id},request.callId,{status:'SUCCEEDED',summary:'one scene only',data:null,evidence:[],artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'},()=>{});h.store.finish(c.token,'SUCCEEDED',{});h.resume();
 let observed=false;const history=new SqliteHistoryStore(h.store,h.goals,{...h.policy,authorize:({origin})=>{assert.equal(origin.link.authorizationRef,'manual:scene-one');assert.deepEqual(origin.link.workspaceRef,binding.workspaceRef);observed=true;}});assert.equal(history.listReceiptViews(h.claim().token).items[0].state,'VISIBLE');assert.equal(observed,true);
});
test('an unrelated same-owner Goal never appears in a reader collection',t=>{
 const h=setup(t);h.receipt();const token=h.claim().token;
 const other=h.goals.accept({...h.input,requestId:'other-goal',requestEnvelope:{other:true}});const c=h.store.claim('other-reader',30000,other.runId)!;
 assert.equal(h.history.listReceiptViews(c.token).items.length,0);const foreignPlan=h.history.readPlanForExecution(token);assert.equal(foreignPlan,null);
 assert.throws(()=>h.history.readPlanForExecution(c.token,'not-in-this-goal'),code('HISTORY_NOT_FOUND'));
});


test('registered reader and exact projections survive a new SQLite connection with the old Run lease invalid',async t=>{
 const h=setup(t);h.receipt({withPlan:true});const page=h.history.listReceiptViews(h.claim().token),item=page.items[0];if(item.state!=='VISIBLE')throw new Error('fixture');
 const dir=mkdtempSync(path.join(tmpdir(),'history-reopen-')),file=path.join(dir,'history.sqlite');await h.db.backup(file);const db=new Database(file);t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});const store=new AgentSqliteStore(db);store.ensureSchema();const goals=new SqliteGoalStore(store,new SqliteBudgetStore(store),()=>{},()=>{});goals.ensureSchema();const journal=new SqliteModelJournal(store,()=>{});journal.ensureSchema();const history=new SqliteHistoryStore(store,goals,h.policy);history.ensureSchema();
 db.prepare('UPDATE agent_runs SET lease_until=0 WHERE id=?').run(h.accepted.runId);const next=store.claim('reopened',30000,h.accepted.runId)!;
 assert.throws(()=>store.assertExecution(h.claim().token),code('LEASE_LOST'));assert.deepEqual(history.readerForSource(item.exactRef,h.access),page.reader);history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW',undefined,h.access);assert.deepEqual(history.listReceiptViews(next.token).items,page.items);assert.throws(()=>history.readerForSource(item.exactRef,{...h.access,ownerId:'other'}),code('HISTORY_READER_INVALID'));
});

test('EXACT nonempty collection validates original members only; later receipts never become reverse dependencies',t=>{
 const h=setup(t),first=h.receipt(),page=h.history.listReceiptViews(h.claim().token);const second=h.receipt({summary:'future receipt'});
 const visited:string[]=[];let revoked=false;
 h.policy.assertSamplingView=({sampling})=>{visited.push(sampling.id);if(sampling.id===first.sampling.id&&revoked)throw new AgentError('REVOKED','original revoked');if(sampling.id===second.sampling.id)throw new AgentError('FUTURE_UNAVAILABLE','future must not affect exact history');};
 h.history.assertSourceForReader(page.reader,page.collectionRef,'EXACT','VIEW',undefined,h.access);assert.deepEqual(visited,[first.sampling.id]);
 assert.throws(()=>h.history.assertSourceForReader(page.reader,page.collectionRef,'COLLECTION','VIEW',undefined,h.access),code('HISTORY_SOURCE_INVALID'));
 revoked=true;assert.throws(()=>h.history.assertSourceForReader(page.reader,page.collectionRef,'EXACT','VIEW',undefined,h.access),code('HISTORY_SOURCE_INVALID'));
});

test('history batch reuses exact receipt validation only in the same synchronous authority snapshot',t=>{
 const h=setup(t);h.receipt();const page=h.history.listReceiptViews(h.claim().token),item=page.items[0];
 if(item.state!=='VISIBLE')throw new Error('fixture');
 let visits=0,authority='one';h.policy.validationKey=()=>authority;
 const samplings=t.mock.method(h.goals,'decisionForCall');
 const original=h.policy.assertSamplingView;h.policy.assertSamplingView=value=>{visits++;original(value);};
 const verify=()=>h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW',undefined,h.access);
 h.history.withValidationBatch(()=>{verify();verify();assert.equal(visits,1);
   assert.equal(samplings.mock.callCount(),1,'a cached exact receipt must not reparse its full model sampling');
   authority='two';verify();assert.equal(visits,2,'changed reader authority must revalidate');
   h.db.prepare('UPDATE agent_runs SET status=status WHERE id=?').run(h.accepted.runId);
   verify();assert.equal(visits,3,'any database write invalidates successful checks');
 });
 verify();assert.equal(visits,4,'completed batch cannot lend a check to another request');
 h.state.sampling=false;assert.throws(verify,code('HISTORY_SOURCE_INVALID'));
});

test('history validation batches reject asynchronous work and clear cached checks after failure',t=>{
 const h=setup(t);h.receipt();const page=h.history.listReceiptViews(h.claim().token),item=page.items[0];
 if(item.state!=='VISIBLE')throw new Error('fixture');
 const verify=()=>h.history.assertSourceForReader(page.reader,item.exactRef,'EXACT','VIEW',undefined,h.access);
 assert.throws(()=>h.history.withValidationBatch(()=>{verify();return Promise.resolve();}),code('ASYNC_HISTORY_VALIDATION'));
 h.state.sampling=false;assert.throws(verify,code('HISTORY_SOURCE_INVALID'));
});

test('an exact receipt and its collection fail closed if a consumed decision is withdrawn inside the batch',t=>{
 const h=setup(t),receipt=h.receipt(),page=h.history.listReceiptViews(h.claim().token),item=page.items[0];
 if(item.state!=='VISIBLE')throw new Error('fixture');
 const verify=(ref:typeof item.exactRef)=>h.history.assertSourceForReader(page.reader,ref,'EXACT','VIEW',undefined,h.access);
 h.history.withValidationBatch(()=>{
  verify(item.exactRef);verify(page.collectionRef);
  const row=h.db.prepare('SELECT data_json FROM agent_samplings WHERE id=?').get(receipt.sampling.id) as {data_json:string};
  const sampling=JSON.parse(row.data_json);sampling.acceptedDecision.consumed=false;
  h.db.prepare('UPDATE agent_samplings SET data_json=? WHERE id=?').run(JSON.stringify(sampling),receipt.sampling.id);
  assert.throws(()=>verify(item.exactRef),code('HISTORY_SOURCE_INVALID'));
  assert.throws(()=>verify(page.collectionRef),code('HISTORY_SOURCE_INVALID'));
  assert.equal(h.history.listReceiptViews(h.claim().token).items.length,0);
 });
});
