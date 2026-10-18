import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentError, hashValue, type ModelRequest } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

// Formal composition only: no replacement GoalStore, registry, driver, worker
// or source policy. Model envelopes below are mechanical protocol fixtures.
const envelope=(kind:string,fields:Record<string,unknown>={})=>({kind,capabilityId:null,capabilityVersion:null,arguments:null,planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null,...fields});
const ask=()=>envelope('ASK',{message:'【机械协议暂停】等待作者决定',choices:[{id:'continue',text:'【机械选项】继续'}]});
const stop=()=>envelope('STOP',{reason:'MECHANICAL_TEST_STOP',remainingWork:['未完成整稿检查']});
const call=(id:string,args:Record<string,unknown>)=>envelope('CALL',{capabilityId:id,capabilityVersion:'1',arguments:args});
const finish=(ref:any)=>envelope('FINISH',{summary:'【机械完成提案】只由服务端判定',artifactRefs:[ref]});
function decisionContext(request:ModelRequest){
 const sections=request.prompt.split('\n\n').flatMap(text=>{try{return [JSON.parse(text)];}catch{return [];}});
 const goal=sections.find(value=>value.authorizationRef&&value.contract),index=sections.find(value=>value.meaning==='PLAN_INDEX_NOT_MANUSCRIPT'),history=sections.find(value=>value.facts)?.facts,review=sections.find(value=>typeof value.available==='boolean');
 assert.ok(goal&&index&&history&&review,'actual script Goal plugin must provide its domain state');return {goal,index,history,review,request};
}
type DecisionContext=ReturnType<typeof decisionContext>;
const reads=(ctx:DecisionContext)=>ctx.history.items.filter((item:any)=>item.capabilityId==='script.read');
const read=(ctx:DecisionContext,cursor:string|null=null)=>call('script.read',{authorizationRef:ctx.goal.authorizationRef,sourceId:null,view:'BODY',unitId:ctx.goal.contract.checks.targetUnitIds[0],sceneId:null,cursor,maxChars:100,limit:20});
function setup(t:any,program:(ctx:DecisionContext,count:number)=>unknown|Promise<unknown>,options:{long?:boolean;channel?:'api'|'external';databasePath?:string}={}){
 const db=new Database(options.databasePath??':memory:');t.after(()=>{if(db.open)db.close();});const requests:ModelRequest[]=[],decisions:DecisionContext[]=[];let checks=0;
 const host=createScriptAgentHost(db,{sendOnce:async request=>{
   requests.push(structuredClone(request));
   if(request.operationKey.startsWith('decision:')){const ctx=decisionContext(request);decisions.push(ctx);return {text:JSON.stringify(await program(ctx,decisions.length)),provenance:{channel:'provider',producer:'MECHANICAL_DECISION_FIXTURE_NO_EXTERNAL_MODEL'},usage:{inputTokens:1,outputTokens:1}};}
   assert.ok(request.operationKey.startsWith('check:'),'test may only simulate decisions or check receipts');checks++;
   assert.ok(request.contextRef);assert.match(request.prompt,/SCRIPT_CHECK_INPUT/);
   return {text:JSON.stringify({summary:'【机械检查回执】本测试不评价艺术质量',findings:[],resolvedFindingIds:[]}),provenance:{channel:'provider',producer:'MECHANICAL_CHECK_FIXTURE_NO_EXTERNAL_MODEL'},usage:{inputTokens:1,outputTokens:1}};
 }},'formal-host-mechanical',{trustedLegacyProjectOwner:'author'});
 const thread=host.conversations.open('author','script:home','formal-goal-test');
 const project=createScriptProject('【机械正式宿主稿】',createScriptCreationProfile('short-film',1,3));project.units[0].scenes[0].blocks[0].text=options.long?'MECHANICAL_EXISTING_BODY_'.repeat(40):'【作者机械原稿】只测试保存与读取';
 const saved=host.scripts.saveProject(project,0),methods=[{id:'skill:mechanical',title:'机械方法全文',version:'fixed-v1',content:'【完整方法前段】\n【末段必须保留】',usage:{operations:['review' as const],inputs:[],note:'只用于检查工具'}}];
 const resolvers={resolveMethods:async(ids:string[])=>{assert.deepEqual(ids,['mechanical']);return methods;},resolveExecution:()=>({channel:options.channel??'api' as const,routeRef:'mechanical-formal-route'})};
 const command={kind:'GOAL_START',requestId:'formal-start',threadId:thread.id,expectedConversationVersion:thread.version,source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},objective:'【机械目标】读取本单元并按要求检查',task:'REVISE',target:{unitIds:[saved.units[0].id],wholeUnitIds:[saved.units[0].id]},methodIds:['mechanical']};
 const start=()=>host.commands.submit('author',command,resolvers);
 async function pump(runId:string,max=40){
   for(let count=0;count<max;count++){const run=host.store.readRun(runId);if(run.status==='QUEUED')await host.worker.runOnce(runId);else if(run.status==='WAITING_STEP')await host.childWorker.runOnce(runId);else return run;}
   throw new Error(`mechanical pump exceeded ${max} transitions: ${JSON.stringify(host.store.readRun(runId))}`);
 }
 return {db,host,thread,saved,methods,command,resolvers,requests,decisions,start,pump,checkCount:()=>checks};
}


async function received(t:any){
 const h=setup(t,()=>{throw Error('NO_EXTERNAL_MODEL');},{channel:'external'}),receipt=await h.start();
 await h.host.worker.runOnce(receipt.runId);
 const decision=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING')!;
 const ctx=decisionContext(decision.request),task=ctx.review.tasks.find((item:any)=>item.status==='READY');
 h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify(call('script.check_batch',{
   authorizationRef:ctx.goal.authorizationRef,taskId:task.id})),{name:'MECHANICAL_DECISION_FIXTURE',model:'test'});
 await h.host.worker.runOnce(receipt.runId);await h.host.childWorker.runOnce(receipt.runId);
 const check=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING'&&item.request.operationKey.startsWith('check:'))!;
 h.host.journal.submitExternal(check.id,'author',check.inputHash,JSON.stringify({summary:'MECHANICAL_CHECK_FIXTURE',findings:[],resolvedFindingIds:[]}),
   {name:'MECHANICAL_CHECK_FIXTURE',model:'test'});
 return {...h,receipt,check};
}

test('mechanical: budget recovery consumes original RECEIVED check in same run',async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author');
 const before=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const now=Date.now(),duration=(before.limits.maxActiveMs??3600000)+100;
 h.host.goals.budgets.activity(before.id,h.receipt.runId,'MECHANICAL_TIME_BUDGET',now,now-duration);
 h.host.goals.budgets.stopActivity(before.id,h.receipt.runId,now);
 await h.host.childWorker.runOnce(h.receipt.runId);
 const stopped=h.host.store.readRun(h.receipt.runId);
 assert.equal(stopped.status,'PARTIAL');assert.equal(stopped.reason,'BUDGET_EXHAUSTED');
 const current=h.host.goals.read(goal.id,'author'),budget=h.host.goals.budgets.read(before.id,'author');
 assert.throws(()=>h.host.goals.continue({goalId:goal.id,ownerId:'author',expectedVersion:current.version,expectedRunVersion:stopped.version,requestId:'MECHANICAL_DIRECT_BYPASS',requestEnvelope:{continue:true}}),
   (error:unknown)=>error instanceof AgentError&&error.code==='BUDGET_RECOVERY_REQUIRED');
 assert.rejects(h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_EARLY',threadId:h.thread.id,expectedConversationVersion:h.thread.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers),{code:'BUDGET_EXHAUSTED'});
 const expanded=h.host.commands.increaseGoalBudget('author',goal.id,{requestId:'MECHANICAL_BUDGET_INCREASE',expectedGoalVersion:current.version,expectedBudgetVersion:budget.version,maxInvocations:160});
 assert.equal(expanded.used.activeMs,budget.used.activeMs);
 const conv=h.host.conversations.read(h.thread.id,'author');
 const cmd={kind:'GOAL_CONTINUE',requestId:'MECHANICAL_CONTINUE_RECEIVED',threadId:h.thread.id,expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version};
 const continued=await h.host.commands.submit('author',cmd,h.resolvers);
 assert.equal(continued.runId,stopped.id);assert.equal(continued.goalRevision,current.activeRevision);
 assert.equal(h.host.store.readRun(stopped.id).status,'WAITING_STEP');
 assert.deepEqual(await h.host.commands.submit('author',cmd,h.resolvers),continued);
 await assert.rejects(h.host.commands.submit('author',{...cmd,expectedRunVersion:stopped.version+1},h.resolvers),
   (error:unknown)=>error instanceof AgentError&&error.code==='IDEMPOTENCY_CONFLICT');
 await h.host.childWorker.runOnce(continued.runId);
 const rows=h.db.prepare("SELECT i.id,i.run_id,i.operation_key,i.status FROM agent_invocations i JOIN agent_run_links l ON l.run_id=i.run_id WHERE l.goal_id=? AND i.operation_key LIKE 'check:%' ORDER BY i.rowid").all(goal.id) as any[];
 console.log(JSON.stringify({oldRun:h.receipt.runId,newRun:continued.runId,rows,checks:(h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n}));
 assert.equal(rows.length,1);assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
});

for(const paused of [false,true])test(`mechanical: lease stall ${paused?'after pause ':''}recovers original received check without a new request`,async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author');
 let firstToken:any;
 for(let n=0;n<3;n++){
   const claimed=h.host.store.claimChild(`MECHANICAL_STALL_${n}`,30000,h.receipt.runId);
   if(n<2){assert.ok(claimed);if(n===0)firstToken=claimed.token;h.db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(claimed.token.stepId);}
   else assert.equal(claimed,null);
 }
 let stopped=h.host.store.readRun(h.receipt.runId);
 assert.equal(stopped.status,'NEEDS_REBASE');assert.equal(stopped.reason,'LEASE_STALL_LIMIT');
 assert.equal(h.host.journal.read(h.check.invocationId).status,'RECEIVED');
 assert.throws(()=>h.host.store.assertExecution(firstToken),(error:unknown)=>error instanceof AgentError&&error.code==='LEASE_LOST');
 if(paused)stopped=h.host.store.control(stopped.id,'author',stopped.version,'pause','MECHANICAL_PAUSE_AFTER_STALL');
 const current=h.host.goals.read(goal.id,'author'),conv=h.host.conversations.read(h.thread.id,'author');
 assert.throws(()=>h.host.goals.continue({goalId:goal.id,ownerId:'author',expectedVersion:current.version,expectedRunVersion:stopped.version,
   requestId:'MECHANICAL_DIRECT_STALL_BYPASS',requestEnvelope:{bypass:true}}),
   (error:unknown)=>error instanceof AgentError&&error.code==='LEASE_STALL_RECOVERY_REQUIRED');
 await assert.rejects(h.host.commands.submit('author',{kind:'GOAL_REVISE',requestId:'MECHANICAL_SAME_STALL_REVISE',threadId:h.thread.id,
   expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers),
   (error:unknown)=>error instanceof AgentError&&error.code==='LEASE_STALL_RECOVERY_REQUIRED');
 const cmd={kind:'GOAL_CONTINUE',requestId:`MECHANICAL_STALL_RECOVER_${paused}`,threadId:h.thread.id,
   expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version};
 const resumed=await h.host.commands.submit('author',cmd,h.resolvers);
 assert.equal(resumed.runId,stopped.id);assert.equal(resumed.goalRevision,current.activeRevision);
 assert.equal(h.host.store.readRun(stopped.id).status,'WAITING_STEP');
 assert.deepEqual(await h.host.commands.submit('author',cmd,h.resolvers),resumed);
 assert.equal(h.host.journal.read(h.check.invocationId).status,'RECEIVED');
 await h.host.childWorker.runOnce(resumed.runId);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_invocations WHERE run_id=? AND operation_key LIKE 'check:%'").get(resumed.runId) as any).n,1);
 assert.equal(h.host.journal.read(h.check.invocationId).status,'RECEIVED');
 assert.ok(h.host.store.events(h.thread.id,'author').some(event=>event.type==='run.validation_stop_recovered'));
});

test('mechanical: changed implementation requests explicit rebase and retains the original return',async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author'),budget=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const now=Date.now();h.host.goals.budgets.activity(budget.id,h.receipt.runId,'MECHANICAL_TIME_BUDGET',now,now-(budget.limits.maxActiveMs??3600000)-100);
 h.host.goals.budgets.stopActivity(budget.id,h.receipt.runId,now);
 await h.host.childWorker.runOnce(h.receipt.runId);
 const stopped=h.host.store.readRun(h.receipt.runId),current=h.host.goals.read(goal.id,'author');
 h.host.commands.increaseGoalBudget('author',goal.id,{requestId:'MECHANICAL_EXPAND_REBASE',expectedGoalVersion:current.version,expectedBudgetVersion:h.host.goals.budgets.read(budget.id,'author').version,maxInvocations:160});
 const conv=h.host.conversations.read(h.thread.id,'author');
 const resumed=await h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_RESUME_REBASE',threadId:h.thread.id,expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers);
 const capability=(h.host.registry as any).capabilities.get('script.check_batch@1');
 assert.ok(capability);capability.spec.implementationDigest='0'.repeat(64); // Simulates a changed deployed implementation, never edits source.
 await h.host.childWorker.runOnce(resumed.runId);
 const invalid=h.host.store.readRun(resumed.runId);
 assert.equal(invalid.status,'NEEDS_REBASE');assert.equal(invalid.reason,'CAPABILITY_IMPLEMENTATION_CHANGED');
 assert.equal(h.host.journal.read(h.check.invocationId).status,'RECEIVED');
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,0);
 const currentGoal=h.host.goals.read(goal.id,'author');
 const reauthorized=await h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_REAUTHORIZE',threadId:h.thread.id,expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:currentGoal.version,expectedRunVersion:invalid.version},h.resolvers);
 assert.equal(reauthorized.runId,resumed.runId);assert.equal(reauthorized.goalRevision,currentGoal.activeRevision+1);
 assert.equal(h.host.journal.read(h.check.invocationId).status,'SUPERSEDED');
 assert.ok(h.host.journal.read(h.check.invocationId).result?.text);
 assert.equal(h.host.store.readRun(resumed.runId).generation,invalid.generation+1);
 assert.ok(h.host.store.events(h.thread.id,'author').some(item=>item.type==='goal.received_result_rebased'));
});

test('mechanical: workspace change makes the recovered frozen check NEEDS_REBASE without applying it',async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author'),budget=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const now=Date.now();h.host.goals.budgets.activity(budget.id,h.receipt.runId,'MECHANICAL_TIME_BUDGET',now,now-(budget.limits.maxActiveMs??3600000)-100);
 h.host.goals.budgets.stopActivity(budget.id,h.receipt.runId,now);await h.host.childWorker.runOnce(h.receipt.runId);
 const stopped=h.host.store.readRun(h.receipt.runId),current=h.host.goals.read(goal.id,'author');
 h.host.commands.increaseGoalBudget('author',goal.id,{requestId:'MECHANICAL_EXPAND_SOURCE',expectedGoalVersion:current.version,expectedBudgetVersion:h.host.goals.budgets.read(budget.id,'author').version,maxInvocations:160});
 const workspace=h.host.workspaces.read(h.receipt.workspaceId,'author');
 const changed=structuredClone(workspace.document);changed.units[0].scenes[0].blocks[0].text='MECHANICAL_AUTHOR_CHANGED_SOURCE';
 h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'MECHANICAL_AUTHOR_EDIT',expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,document:changed});
 const conv=h.host.conversations.read(h.thread.id,'author');
 const resumed=await h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_SOURCE_RESUME',threadId:h.thread.id,expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers);
 await h.host.childWorker.runOnce(resumed.runId);
 const invalid=h.host.store.readRun(resumed.runId);
 assert.equal(invalid.status,'NEEDS_REBASE');assert.equal(h.host.journal.read(h.check.invocationId).status,'RECEIVED');
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,0);
});

test('mechanical: restart keeps the received result and resumes its original child once',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'script-budget-restart-')),databasePath=path.join(dir,'agent.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const h=setup(t,()=>{throw Error('NO_EXTERNAL_MODEL');},{channel:'external',databasePath});
 const start=await h.start();await h.host.worker.runOnce(start.runId);
 const decision=h.host.journal.listExternal(start.runId,'author').find(item=>item.status==='WAITING')!;
 const ctx=decisionContext(decision.request),task=ctx.review.tasks.find((item:any)=>item.status==='READY');
 h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify(call('script.check_batch',{authorizationRef:ctx.goal.authorizationRef,taskId:task.id})),{name:'MECHANICAL_DECISION_FIXTURE'});
 await h.host.worker.runOnce(start.runId);await h.host.childWorker.runOnce(start.runId);
 const check=h.host.journal.listExternal(start.runId,'author').find(item=>item.status==='WAITING'&&item.request.operationKey.startsWith('check:'))!;
 h.host.journal.submitExternal(check.id,'author',check.inputHash,JSON.stringify({summary:'MECHANICAL_CHECK_FIXTURE',findings:[],resolvedFindingIds:[]}),{name:'MECHANICAL_CHECK_FIXTURE'});
 const goal=h.host.goals.read(start.goalId!,'author'),budget=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const now=Date.now();h.host.goals.budgets.activity(budget.id,start.runId,'MECHANICAL_TIME_BUDGET',now,now-(budget.limits.maxActiveMs??3600000)-100);
 h.host.goals.budgets.stopActivity(budget.id,start.runId,now);await h.host.childWorker.runOnce(start.runId);
 const stopped=h.host.store.readRun(start.runId),version=h.host.goals.read(goal.id,'author').version;
 h.db.close();
 const reopened=new Database(databasePath);t.after(()=>{if(reopened.open)reopened.close();});
 const host=createScriptAgentHost(reopened,{sendOnce:async()=>{throw Error('NO_EXTERNAL_MODEL');}},'mechanical-restarted',{trustedLegacyProjectOwner:'author'});
 const current=host.goals.read(goal.id,'author'),freshBudget=host.goals.budgets.read(budget.id,'author');
 assert.equal(current.version,version);assert.equal(host.journal.read(check.invocationId).status,'RECEIVED');
 host.commands.increaseGoalBudget('author',goal.id,{requestId:'MECHANICAL_RESTART_EXPAND',expectedGoalVersion:current.version,expectedBudgetVersion:freshBudget.version,maxInvocations:160});
 const conv=host.conversations.read(h.thread.id,'author');
 const resumed=await host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_RESTART_RESUME',threadId:h.thread.id,expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers);
 assert.equal(resumed.runId,start.runId);
 await host.childWorker.runOnce(resumed.runId);
 assert.equal((reopened.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 assert.equal((reopened.prepare("SELECT count(*) n FROM agent_invocations WHERE operation_key LIKE 'check:%'").get() as any).n,1);
});

test('mechanical: committed check before acknowledgement is acknowledged without repeating its effect',async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author');
 const claimed=h.host.store.claimChild('mechanical-before-ack',30000,h.receipt.runId)!;
 assert.ok(claimed);
 const context={ownerId:claimed.run.ownerId,scopeId:claimed.run.scopeId,commandRevision:String(claimed.run.generation),
   policyRevision:claimed.run.policyRevision,execution:claimed.token,signal:new AbortController().signal};
 await h.host.registry.attest(claimed.step.prepared,context);
 await h.host.registry.execute(claimed.step.prepared,context);
 assert.equal(h.host.store.getStep(claimed.run.id,claimed.run.generation,claimed.step.prepared.request.callId)?.status,'COMMITTED');
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 // Mechanical crash window: the domain effect committed, but the child had not
 // acknowledged its lease when a budget-only stop fenced it.
 h.host.store.finish(claimed.token,'PARTIAL',{remainingWork:['MECHANICAL_ACK_PENDING']},'BUDGET_EXHAUSTED');
 const stopped=h.host.store.readRun(claimed.run.id),current=h.host.goals.read(goal.id,'author');
 const conv=h.host.conversations.read(h.thread.id,'author');
 const resumed=await h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_COMMITTED_RESUME',threadId:h.thread.id,
   expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers);
 assert.equal(resumed.runId,claimed.run.id);
 const lease=h.db.prepare('SELECT fence FROM agent_step_leases WHERE step_id=?').get(claimed.step.id) as {fence:number};
 assert.ok(lease.fence>claimed.token.fence);
 assert.throws(()=>h.host.store.assertExecution(claimed.token),(error:unknown)=>error instanceof AgentError&&error.code==='LEASE_LOST');
 await h.host.childWorker.runOnce(resumed.runId);
 assert.equal(h.host.store.readRun(resumed.runId).status,'QUEUED');
 await h.host.worker.runOnce(resumed.runId);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_invocations WHERE operation_key LIKE 'check:%'").get() as any).n,1);
});

test('mechanical: real author HTTP budget and continue routes restore the existing worker step',async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author'),budget=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const now=Date.now();h.host.goals.budgets.activity(budget.id,h.receipt.runId,'MECHANICAL_TIME_BUDGET',now,now-(budget.limits.maxActiveMs??3600000)-100);
 h.host.goals.budgets.stopActivity(budget.id,h.receipt.runId,now);await h.host.childWorker.runOnce(h.receipt.runId);
 const stopped=h.host.store.readRun(h.receipt.runId),current=h.host.goals.read(goal.id,'author');
 const runtime=createScriptRuntime(h.db,{transport:{sendOnce:async()=>{throw Error('NO_EXTERNAL_MODEL');}},owner:()=> 'author',
   trustedLegacyProjectOwner:'author',resolveMethods:async()=>h.methods,resolveExecution:()=>({channel:'external',routeRef:'mechanical-formal-route'})});
 const app=express();app.use(express.json());runtime.register(app);const server=createServer(app);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 const origin=`http://127.0.0.1:${address.port}`;
 const post=async(url:string,body:unknown,expected:number)=>{
   const response=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const data=await response.json() as any;assert.equal(response.status,expected,JSON.stringify(data));return data;
 };
 const conv=runtime.conversations.read(h.thread.id,'author');
 const command={kind:'GOAL_CONTINUE',requestId:'MECHANICAL_HTTP_RESUME',threadId:h.thread.id,expectedConversationVersion:conv.version,
   goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version};
 const early=await post('/api/script-commands',{...command,requestId:'MECHANICAL_HTTP_EARLY'},409);
 assert.equal(early.code,'BUDGET_EXHAUSTED');
 const expanded=await post(`/api/script-goals/${goal.id}/budget`,{requestId:'MECHANICAL_HTTP_EXPAND',expectedGoalVersion:current.version,
   expectedBudgetVersion:budget.version,maxInvocations:160},200);
 assert.equal(expanded.budget.used.activeMs>=budget.limits.maxActiveMs,true);
 const resumed=await post('/api/script-commands',command,202);
 assert.equal(resumed.runId,stopped.id);assert.equal(resumed.goalRevision,current.activeRevision);
 assert.deepEqual(await post('/api/script-commands',command,202),resumed);
 await runtime.childWorker.runOnce(resumed.runId);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_invocations WHERE operation_key LIKE 'check:%'").get() as any).n,1);
});

test('mechanical: frozen inline read without a child lease resumes in the original parent turn',async t=>{
 const h=setup(t,()=>{throw Error('NO_EXTERNAL_MODEL');},{channel:'external'}),receipt=await h.start();
 await h.host.worker.runOnce(receipt.runId);
 const decision=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING')!;
 const ctx=decisionContext(decision.request);
 h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify(read(ctx)),{name:'MECHANICAL_INLINE_READ_DECISION'});
 const goal=h.host.goals.read(receipt.goalId!,'author'),budget=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const savePrepared=h.host.store.savePrepared.bind(h.host.store);let halted=false;
 h.host.store.savePrepared=(...args)=>{
   const step=savePrepared(...args);
   if(!halted&&step.prepared.request.capabilityId==='script.read'){
     halted=true;const now=Date.now();h.host.goals.budgets.activity(budget.id,receipt.runId,'MECHANICAL_INLINE_TIME_HALT',now,now-(budget.limits.maxActiveMs??3600000)-100);
     h.host.goals.budgets.stopActivity(budget.id,receipt.runId,now);assert.equal(h.host.store.renew(args[0],30000),null);
   }
   return step;
 };
 await h.host.worker.runOnce(receipt.runId);h.host.store.savePrepared=savePrepared;
 const stopped=h.host.store.readRun(receipt.runId),current=h.host.goals.read(goal.id,'author');
 assert.equal(halted,true);assert.equal(stopped.status,'PARTIAL');assert.equal(stopped.reason,'BUDGET_EXHAUSTED');
 assert.equal((h.db.prepare('SELECT count(*) n FROM agent_step_leases').get() as any).n,0);
 h.host.commands.increaseGoalBudget('author',goal.id,{requestId:'MECHANICAL_EXPAND_INLINE',expectedGoalVersion:current.version,
   expectedBudgetVersion:h.host.goals.budgets.read(budget.id,'author').version,maxInvocations:160});
 const conv=h.host.conversations.read(h.thread.id,'author');
 const resumed=await h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'MECHANICAL_INLINE_RESUME',threadId:h.thread.id,
   expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version},h.resolvers);
 assert.equal(resumed.runId,receipt.runId);
 await h.host.worker.runOnce(resumed.runId);
 const steps=h.db.prepare('SELECT status FROM agent_steps WHERE run_id=?').all(resumed.runId) as any[];
 assert.equal(steps.length,1);assert.equal(steps[0].status,'COMMITTED');
});

test('mechanical: explicit revision preserves received provenance for an already committed check',async t=>{
 const h=await received(t),goal=h.host.goals.read(h.receipt.goalId!,'author');
 const budget=h.host.goals.budgets.read(goal.revision.budgetId,'author');
 const complete=h.host.store.completeChild.bind(h.host.store);
 h.host.store.completeChild=(token)=>{
   const call=h.db.prepare('SELECT call_id FROM agent_steps WHERE id=?').get(token.stepId) as {call_id:string};
   const step=h.host.store.getStep(token.runId,token.inputRevision,call.call_id);
   assert.equal(step?.status,'COMMITTED');
   const now=Date.now();h.host.goals.budgets.activity(budget.id,token.runId,'MECHANICAL_COMMITTED_BEFORE_ACK',now,now-(budget.limits.maxActiveMs??3600000)-100);
   h.host.goals.budgets.stopActivity(budget.id,token.runId,now);
   assert.equal(h.host.store.renew(token,30000),null);
 };
 await h.host.childWorker.runOnce(h.receipt.runId);h.host.store.completeChild=complete;
 const stopped=h.host.store.readRun(h.receipt.runId),current=h.host.goals.read(goal.id,'author');
 assert.equal(stopped.status,'PARTIAL');assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 h.host.commands.increaseGoalBudget('author',goal.id,{requestId:'MECHANICAL_EXPAND_COMMITTED_REVISE',expectedGoalVersion:current.version,
   expectedBudgetVersion:h.host.goals.budgets.read(budget.id,'author').version,maxInvocations:160});
 const conv=h.host.conversations.read(h.thread.id,'author');
 await h.host.commands.submit('author',{kind:'GOAL_REVISE',requestId:'MECHANICAL_REVISE_AFTER_COMMIT',threadId:h.thread.id,
   expectedConversationVersion:conv.version,goalId:goal.id,expectedGoalVersion:current.version,expectedRunVersion:stopped.version,
   objective:'【明确机械修订目标】保留已执行检查，再推进后续检查'},h.resolvers);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 assert.equal(h.host.journal.read(h.check.invocationId).status,'RECEIVED');
});
