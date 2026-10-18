import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentChildWorker, hashValue, type ModelRequest } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';
import { registerScriptReadRoutes } from '../apps/api/src/routes/scriptReadRoutes';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
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
function setup(t:any,program:(ctx:DecisionContext,count:number)=>unknown|Promise<unknown>,options:{long?:boolean;channel?:'api'|'external';outOfScopeMemory?:boolean;withPreviousSource?:boolean;narrowableMemory?:boolean;partialScenes?:boolean}={}){
 const db=new Database(':memory:');t.after(()=>db.close());const requests:ModelRequest[]=[],decisions:DecisionContext[]=[];let checks=0;
 const host=createScriptAgentHost(db,{sendOnce:async request=>{
   requests.push(structuredClone(request));
   if(request.operationKey.startsWith('decision:')){const ctx=decisionContext(request);decisions.push(ctx);return {text:JSON.stringify(await program(ctx,decisions.length)),provenance:{channel:'provider',producer:'MECHANICAL_DECISION_FIXTURE_NO_EXTERNAL_MODEL'},usage:{inputTokens:1,outputTokens:1}};}
   if(request.operationKey==='draft')return {text:JSON.stringify(options.partialScenes?{summary:'【机械候选】',blocks:[{localKey:'action',type:'action',text:'【机械正文】本测试只检验持久提交',speakerId:null,speakerName:null}]}:{summary:'【机械候选】',content:'【机械正文】本测试只检验持久提交'}),
     provenance:{channel:'provider',producer:'MECHANICAL_DRAFT_FIXTURE_NO_EXTERNAL_MODEL'},usage:{inputTokens:1,outputTokens:1}};
   assert.ok(request.operationKey.startsWith('check:'),`unexpected mechanical model request: ${request.operationKey}`);checks++;
   assert.ok(request.contextRef);assert.match(request.prompt,/SCRIPT_CHECK_INPUT/);
   return {text:JSON.stringify({summary:'【机械检查回执】本测试不评价艺术质量',findings:[],resolvedFindingIds:[]}),provenance:{channel:'provider',producer:'MECHANICAL_CHECK_FIXTURE_NO_EXTERNAL_MODEL'},usage:{inputTokens:1,outputTokens:1}};
 }},'formal-host-mechanical',{trustedLegacyProjectOwner:'author'});
 const thread=host.conversations.open('author','script:home','formal-goal-test');
 const project=createScriptProject('【机械正式宿主稿】',createScriptCreationProfile(options.outOfScopeMemory?'tv-series':'short-film',options.outOfScopeMemory?2:1,3));project.units[0].scenes[0].blocks[0].text=options.long?'MECHANICAL_EXISTING_BODY_'.repeat(40):'【作者机械原稿】只测试保存与读取';
 if(options.outOfScopeMemory){project.units.push(newUnit('第二集',180000,project.id));project.units[1].scenes[0].blocks[0].text='【目标机械原稿】';}
 if(options.partialScenes){for(let n=2;n<=4;n++)project.units[0].scenes.push(newScene(`第 ${n} 场`));}
 if(options.narrowableMemory){const second=newScene('第二场');second.blocks[0].text='【范围将被撤回的机械原文】';project.units[0].scenes.push(second);}
 const saved=host.scripts.saveProject(project,0),methods=[{id:'skill:mechanical',title:'机械方法全文',version:'fixed-v1',content:'【完整方法前段】\n【末段必须保留】',usage:{operations:['review' as const],inputs:[],note:'只用于检查工具'}}];
 const previous=options.withPreviousSource?host.scripts.saveProject(createScriptProject('【机械前集】',createScriptCreationProfile('short-film',1,3)),0):null;
 const resolvers={resolveMethods:async(ids:string[])=>{assert.deepEqual(ids,['mechanical']);return methods;},resolveExecution:()=>({channel:options.channel??'api' as const,routeRef:'mechanical-formal-route'})};
 const targetUnit=options.outOfScopeMemory?saved.units[1]:saved.units[0];
 const command={kind:'GOAL_START',requestId:'formal-start',threadId:thread.id,expectedConversationVersion:thread.version,source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},objective:'【机械目标】读取本单元并按要求检查',task:'REVISE',target:{unitIds:[targetUnit.id],wholeUnitIds:[targetUnit.id]},methodIds:['mechanical'],
   ...(previous?{sources:[{purpose:'PREVIOUS_SCRIPT',ref:{uri:`resource://script/projects/${previous.id}`,version:String(previous.revision),contentHash:hashValue(previous),branch:'author'},unitIds:[previous.units[0].id]}]}:{})};
 const start=()=>host.commands.submit('author',command,resolvers);
 async function pump(runId:string,max=40){
   for(let count=0;count<max;count++){const run=host.store.readRun(runId);if(run.status==='QUEUED')await host.worker.runOnce(runId);else if(run.status==='WAITING_STEP')await host.childWorker.runOnce(runId);else return run;}
   throw new Error(`mechanical pump exceeded ${max} transitions: ${JSON.stringify(host.store.readRun(runId))}`);
 }
 return {db,host,thread,saved,previous,methods,command,resolvers,requests,decisions,start,pump,checkCount:()=>checks};
}

test('formal host exports the real shared Goal, history, check and command composition; runtime registers author commands',t=>{
 const h=setup(t,()=>stop());assert.ok(h.host.goals&&h.host.history&&h.host.reviews&&h.host.commands,'formal host must expose goals/history/reviews/commands from its own composition');
 for(const id of ['script.read','script.propose','script.apply_patch','script.check_status','script.check_batch','script.begin_repair','script.mark_repaired'])assert.ok(h.host.registry.describe().some(spec=>spec.id===id),`missing ${id}`);
 const db=new Database(':memory:');t.after(()=>db.close());const runtime=createScriptRuntime(db,{transport:{sendOnce:async()=>{throw Error('NO_NETWORK');}},owner:()=> 'author',resolveMethods:async()=>[],resolveExecution:()=>({channel:'api',routeRef:'mechanical'})});
 const routes:string[]=[],app=Object.fromEntries(['get','post','put','delete','patch'].map(method=>[method,(path:string)=>routes.push(`${method} ${path}`)]));runtime.register(app as any);
 assert.ok(routes.includes('post /api/script-commands'),'formal runtime must mount the author-command receiver');
});

test('formal Goal reads an exact body page then waits for author with durable decision and source history',async t=>{
 const h=setup(t,(ctx,count)=>count===1?read(ctx):ask()),receipt=await h.start(),run=await h.pump(receipt.runId);
 assert.equal(run.status,'WAITING_INPUT',JSON.stringify(run));assert.equal(h.decisions.length,2);assert.match(JSON.stringify(reads(h.decisions[1])[0].result),/作者机械原稿/);
 assert.equal(h.host.workspaces.read(receipt.workspaceId,'author').writerRunId,null);assert.equal(h.host.scripts.getProject(h.saved.id)!.revision,h.saved.revision);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_steps WHERE status='COMMITTED'").get() as any).n,1);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_invocations WHERE status='RECEIVED'").get() as any).n,2);
 const samples=(h.db.prepare('SELECT data_json FROM agent_samplings ORDER BY rowid').all() as any[]).map(row=>JSON.parse(row.data_json));assert.equal(samples.at(-1).acceptedDecision.decision.kind,'ASK');assert.equal(samples.at(-1).acceptedDecision.consumed,true);
 assert.match(h.requests[0].prompt,/末段必须保留/);
});

test('formal pagination passes four different raw ranges through history rather than hitting no-progress after three reads',async t=>{
 const h=setup(t,(ctx,count)=>count<=4?read(ctx,reads(ctx).at(-1)?.result.nextCursor??null):stop(),{long:true}),receipt=await h.start(),run=await h.pump(receipt.runId);
 assert.equal(run.status,'PARTIAL');assert.equal((run.result as any).reason,'MECHANICAL_TEST_STOP',JSON.stringify(run));assert.equal(h.decisions.length,5);
 const pages=(h.db.prepare("SELECT observation_json FROM agent_steps WHERE status='COMMITTED' ORDER BY rowid").all() as any[]).map(row=>JSON.parse(row.observation_json).data.rows[0]);assert.deepEqual(pages.map(row=>[row.start,row.end]),[[0,100],[100,200],[200,300],[300,400]]);
 assert.equal(h.host.goals.readRunLink(receipt.runId)!.noProgressStreak,1);
});

test('formal pause fences a late model return, preserves author edit and continues from a new Goal revision under the original budget',async t=>{
 let entered!:()=>void,release!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const h=setup(t,async(ctx,count)=>{const revision=(ctx.request.inputManifest as any).scriptGoal.goalRevision;if(revision===1){if(count===1)return read(ctx);entered();await gate;return ask();}return reads(ctx).some((item:any)=>item.origin.goalRevision===revision)?stop():read(ctx);});
 const receipt=await h.start(),working=h.host.worker.runOnce(receipt.runId);await Promise.race([waiting,working.then(()=>{throw new Error(`worker ended before controlled pause: ${JSON.stringify(h.host.store.readRun(receipt.runId))}`);})]);const before=h.host.store.readRun(receipt.runId);h.host.store.control(before.id,'author',before.version,'pause','author-pauses');
 const w=h.host.workspaces.read(receipt.workspaceId,'author'),document=structuredClone(w.document);document.units[0].scenes[0].blocks[0].text='【作者接管新稿】不得被迟到回复覆盖';
 const edited=h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:w.id,requestId:'author-edit',expectedRevision:w.revision,expectedEpoch:w.writerEpoch,document});release();await working;
 assert.equal(h.host.store.readRun(receipt.runId).status,'PAUSED');assert.equal(h.host.workspaces.read(w.id,'author').revision,edited.revision);
 const goal=h.host.goals.read(receipt.goalId!,'author'),paused=h.host.store.readRun(receipt.runId),budgetBefore=goal.revision.budgetId;
 const next=await h.host.commands.submit('author',{kind:'GOAL_CONTINUE',requestId:'after-author-edit',threadId:h.thread.id,expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:paused.version},{resolveMethods:async()=>{throw Error('must use frozen methods');},resolveExecution:()=>{throw Error('must use frozen route');}});
 assert.equal(h.host.goals.read(goal.id,'author').revision.budgetId,budgetBefore);assert.equal(next.goalRevision,2);
 const run=await h.pump(next.runId);assert.equal(run.status,'PARTIAL');assert.equal((run.result as any).reason,'MECHANICAL_TEST_STOP',JSON.stringify(run));
 assert.match(JSON.stringify(reads(h.decisions.at(-1)!).at(-1).result),/作者接管新稿/);assert.equal(h.host.workspaces.read(w.id,'author').document.units[0].scenes[0].blocks[0].text,document.units[0].scenes[0].blocks[0].text);assert.equal(h.host.scripts.getProject(h.saved.id)!.revision,h.saved.revision);
});

test('formal FINISH is rejected until real check coverage exists and its gaps reach the next frozen decision',async t=>{
 const h=setup(t,(ctx,count)=>count===1?finish(ctx.index.workspaceRef):ask()),receipt=await h.start(),run=await h.pump(receipt.runId);
 assert.equal(run.status,'WAITING_INPUT',JSON.stringify(run));assert.equal(h.checkCount(),0);assert.equal(h.decisions.length,2);assert.ok(h.decisions[1].goal.feedback.length>0);
 assert.equal(h.host.workspaces.read(receipt.workspaceId,'author').revision,1);assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,0);
});

test('formal durable check dispatch uses child worker and persists actual review evidence before the next decision',async t=>{
 const h=setup(t,(ctx,count)=>count===1?call('script.check_batch',{authorizationRef:ctx.goal.authorizationRef,taskId:ctx.review.tasks.find((task:any)=>task.status==='READY').id}):ask()),receipt=await h.start();
 await h.host.worker.runOnce(receipt.runId);assert.equal(h.host.store.readRun(receipt.runId).status,'WAITING_STEP');assert.equal(h.checkCount(),0);assert.equal(h.requests.length,1);
 await h.host.childWorker.runOnce(receipt.runId);assert.equal(h.host.store.readRun(receipt.runId).status,'QUEUED');assert.equal(h.checkCount(),1);assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 const child=(h.db.prepare("SELECT data_json FROM script_check_results LIMIT 1").get() as any);assert.match(child.data_json,/机械检查回执/);assert.match(h.requests[1].prompt,/末段必须保留/);
 const run=await h.pump(receipt.runId);assert.equal(run.status,'WAITING_INPUT',JSON.stringify(run));assert.equal(h.decisions.at(-1)!.review.tasks.filter((task:any)=>task.status==='COMPLETE').length,1);
});

test('stable out-of-scope derived memory does not rebase draft or check commits under the run grant',async t=>{
 const h=setup(t,(ctx,count)=>{
   const unit=ctx.goal.contract.checks.targetUnitIds[0],scene=h.saved.units[1].scenes[0];
   if(count===1)return call('script.propose',{authorizationRef:ctx.goal.authorizationRef,operation:'scene_body',instruction:'【机械协议】生成候选',unitId:unit,sceneId:scene.id,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null});
   if(count===2)return call('script.check_batch',{authorizationRef:ctx.goal.authorizationRef,taskId:ctx.review.tasks.find((task:any)=>task.status==='READY').id});
   return ask();
 },{outOfScopeMemory:true});
 const receipt=await h.start(),access={ownerId:'author',scopeId:receipt.workspaceId,branch:`workspace:${receipt.workspaceId}`};
 assert.ok(h.host.memory.discover()>=1);
 for(let index=0;index<2;index++)await h.host.memory.work.runOnce({sendOnce:async request=>({
   text:JSON.stringify({items:request.prompt.includes('【作者机械原稿】')?[{key:'mechanical.out-of-scope',kind:'NAVIGATION',label:'机械来源',value:'OUT_OF_SCOPE_MARKER'}]:[]}),
   provenance:{channel:'provider',producer:'MECHANICAL_MEMORY_FIXTURE_NO_EXTERNAL_MODEL'},
 })},new AbortController().signal);
 const memory=h.host.contexts.listMemories(access).items;
 assert.equal(memory.length,1);
 const run=await h.pump(receipt.runId);
 assert.equal(run.status,'WAITING_INPUT',JSON.stringify(run));
 assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_draft_candidates').get() as any).n,1);
 assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,1);
 assert.ok(h.requests.some(request=>request.operationKey==='draft'));
 assert.ok(h.requests.some(request=>request.operationKey.startsWith('check:')));
 assert.ok(h.requests.every(request=>!request.prompt.includes('OUT_OF_SCOPE_MARKER')&&!request.prompt.includes(memory[0].id)));
 assert.equal(h.host.contexts.listMemories(access).items.length,1,'the memory stayed active and unchanged');
 const authorReview=h.host.reviews.readAuthorStatus(run);
 assert.ok(authorReview.tasks.some(task=>task.status==='SUCCEEDED'),'author review must retain the real receipt under the same reader grant');
});

for(const capabilityId of ['script.propose','script.check_batch']){
 test(`newly visible memory after freeze blocks stale ${capabilityId} commit and preserves its received result`,async t=>{
   const h=setup(t,()=>{throw Error('MECHANICAL_EXTERNAL_ONLY')},{channel:'external'}),receipt=await h.start();
   await h.host.worker.runOnce(receipt.runId);
   const decision=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING')!;
   const ctx=decisionContext(decision.request),unit=h.saved.units[0];
   const args=capabilityId==='script.propose'
     ? {authorizationRef:ctx.goal.authorizationRef,operation:'scene_body',instruction:'MECHANICAL_PROTOCOL_ONLY',unitId:unit.id,sceneId:unit.scenes[0].id,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null}
     : {authorizationRef:ctx.goal.authorizationRef,taskId:ctx.review.tasks.find((task:any)=>task.status==='READY').id};
   h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify(call(capabilityId,args)),{name:'MECHANICAL_PROTOCOL',model:'fixture'});
   await h.host.worker.runOnce(receipt.runId);
   await h.host.childWorker.runOnce(receipt.runId);
   const pending=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING')!;
   assert.ok(pending);
   const access={ownerId:'author',scopeId:receipt.workspaceId,branch:`workspace:${receipt.workspaceId}`};
   h.host.contexts.createMemory(access,'author','mechanical-new-visible-memory',{key:'author.mechanical',kind:'AUTHOR_PREFERENCE',content:{label:'MECHANICAL_VISIBLE_MEMORY',value:'MECHANICAL_CHANGED_AFTER_FREEZE'},dependencies:[]});
   const run=h.host.store.readRun(receipt.runId);
   assert.equal(h.host.authorizations.withRunAuthorization(run,'CONSUME',()=>h.host.contexts.listMemories(access)).items.length,1);
   const content=capabilityId==='script.propose'?{summary:'MECHANICAL_CANDIDATE',content:'MECHANICAL_BODY'}:{summary:'MECHANICAL_CHECK',findings:[],resolvedFindingIds:[]};
   h.host.journal.submitExternal(pending.id,'author',pending.inputHash,JSON.stringify(content),{name:'MECHANICAL_PROTOCOL',model:'fixture'});
   await h.host.childWorker.runOnce(receipt.runId);
   const after=h.host.store.readRun(receipt.runId);
   assert.equal(after.status,'NEEDS_REBASE',JSON.stringify(after));
   assert.equal(after.reason,'MEMORY_COLLECTION_CHANGED');
   assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_draft_candidates').get() as any).n,0);
   assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,0);
   const external=h.db.prepare('SELECT status,result_json FROM agent_external_requests WHERE id=?').get(pending.id) as any;
   assert.equal(external.status,'RECEIVED');assert.match(external.result_json,/MECHANICAL_/);
 });
}

test('author review drops an old check when a Goal revision removes its selected source',async t=>{
 const h=setup(t,(ctx,count)=>count===1?call('script.check_batch',{
   authorizationRef:ctx.goal.authorizationRef,taskId:ctx.review.tasks.find((task:any)=>task.status==='READY').id}):ask(),{withPreviousSource:true});
 const first=await h.start(),waiting=await h.pump(first.runId);
 assert.equal(waiting.status,'WAITING_INPUT',JSON.stringify(waiting));
 assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,1);
 assert.ok(h.host.reviews.readAuthorStatus(waiting).tasks.some(task=>task.status==='SUCCEEDED'));
 const goal=h.host.goals.read(first.goalId!,'author');
 const revised=await h.host.commands.submit('author',{
   kind:'GOAL_REVISE',requestId:'remove-previous-source',threadId:h.thread.id,
   expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,
   goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:waiting.version,sources:[],
 },{resolveMethods:async()=>{throw Error('frozen methods required');},resolveExecution:()=>{throw Error('frozen route required');}});
 const newRun=h.host.store.readRun(revised.runId);
 const status=h.host.reviews.readAuthorStatus(newRun);
 assert.ok(status.tasks.every(task=>task.status==='PENDING'),'old check must lose current author-visible coverage');
 assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,1,'raw check evidence stays durable');
});

test('author review drops an old check whose derived memory falls outside a narrowed Goal scope',async t=>{
 const h=setup(t,(ctx,count)=>count===1?call('script.check_batch',{
   authorizationRef:ctx.goal.authorizationRef,taskId:ctx.review.tasks.find((task:any)=>task.status==='READY').id}):ask(),{narrowableMemory:true});
 const first=await h.start(),access={ownerId:'author',scopeId:first.workspaceId,branch:`workspace:${first.workspaceId}`};
 assert.ok(h.host.memory.discover()>=1);
 await h.host.memory.work.runOnce({sendOnce:async()=>({text:JSON.stringify({items:[{
   key:'mechanical.narrowable',kind:'NAVIGATION',label:'机械来源',value:'MEMORY_REMOVED_BY_SCOPE_NARROWING'}]}),
   provenance:{channel:'provider',producer:'MECHANICAL_MEMORY_FIXTURE_NO_EXTERNAL_MODEL'}})},new AbortController().signal);
 assert.equal(h.host.contexts.listMemories(access).items.length,1);
 const waiting=await h.pump(first.runId);
 assert.equal(waiting.status,'WAITING_INPUT',JSON.stringify(waiting));
 assert.ok(h.requests.some(request=>request.operationKey.startsWith('check:')&&request.prompt.includes('MEMORY_REMOVED_BY_SCOPE_NARROWING')));
 assert.ok(h.host.reviews.readAuthorStatus(waiting).tasks.some(task=>task.status==='SUCCEEDED'));
 const goal=h.host.goals.read(first.goalId!,'author'),unit=h.saved.units[0],scene=unit.scenes[0];
 const revised=await h.host.commands.submit('author',{
   kind:'GOAL_REVISE',requestId:'narrow-memory-source',threadId:h.thread.id,
   expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,
   goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:waiting.version,
   target:{unitIds:[unit.id],sceneIds:[{unitId:unit.id,sceneId:scene.id}]},
 },{resolveMethods:async()=>{throw Error('frozen methods required');},resolveExecution:()=>{throw Error('frozen route required');}});
 const status=h.host.reviews.readAuthorStatus(h.host.store.readRun(revised.runId));
 assert.ok(status.tasks.every(task=>task.status==='PENDING'),'old memory-bearing check must lose current coverage');
 assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,1,'original returned check remains durable');
});

test('received external check renews its child lease during repeated source validation',async t=>{
 const h=setup(t,()=>{throw Error('external channel must use frozen manual return');},{channel:'external'}),receipt=await h.start();
 await h.host.worker.runOnce(receipt.runId);
 const decision=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING');assert.ok(decision);
 const ctx=decisionContext(decision.request),task=ctx.review.tasks.find((item:any)=>item.status==='READY');assert.ok(task);
 h.host.journal.submitExternal(decision.id,'author',decision.inputHash,JSON.stringify(call('script.check_batch',{
   authorizationRef:ctx.goal.authorizationRef,taskId:task.id})),{name:'MECHANICAL_DECISION_FIXTURE',model:'test'});
 await h.host.worker.runOnce(receipt.runId);
 assert.equal(h.host.store.readRun(receipt.runId).status,'WAITING_STEP');
 await h.host.childWorker.runOnce(receipt.runId);
 const check=h.host.journal.listExternal(receipt.runId,'author').find(item=>item.status==='WAITING'&&item.request.operationKey.startsWith('check:'));
 assert.ok(check);
 h.host.journal.submitExternal(check.id,'author',check.inputHash,JSON.stringify({summary:'MECHANICAL_CHECK_FIXTURE',findings:[],resolvedFindingIds:[]}),
   {name:'MECHANICAL_CHECK_FIXTURE',model:'test'});
 const original=h.host.journal.assertInput.bind(h.host.journal);let checks=0;
 h.host.journal.assertInput=(...args)=>{const until=Date.now()+250;while(Date.now()<until){}checks++;return original(...args);};
 const child=new AgentChildWorker(h.host.store,h.host.registry,{workerId:'bounded-validation-child',leaseMs:500});
 await child.runOnce(receipt.runId);
 assert.ok(checks>=3,`recovery revalidates the frozen source after durable preparation: ${checks}`);
 assert.equal(h.host.store.readRun(receipt.runId).status,'QUEUED');
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
 assert.equal((h.db.prepare("SELECT count(*) n FROM agent_invocations WHERE operation_key LIKE 'check:%'").get() as any).n,1,
   'lease recovery consumes the received model result without another request');
});

test('unchanged author continuation keeps committed check receipts and does not repeat the child call',async t=>{
 const h=setup(t,(ctx,count)=>count===1?call('script.check_batch',{authorizationRef:ctx.goal.authorizationRef,taskId:ctx.review.tasks.find((task:any)=>task.status==='READY').id}):ask());
 const first=await h.start(),waiting=await h.pump(first.runId);assert.equal(waiting.status,'WAITING_INPUT');assert.equal(h.checkCount(),1);
 const goal=h.host.goals.read(first.goalId!,'author'),question=h.host.goals.pendingQuestion(goal.id,'author');assert.ok(question);
 const next=await h.host.commands.submit('author',{
   kind:'GOAL_CONTINUE',requestId:'continue-after-check',threadId:h.thread.id,
   expectedConversationVersion:h.host.conversations.read(h.thread.id,'author').version,
   goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:waiting.version,
   answer:{decisionId:question!.decisionId,text:'【机械回答】继续检查'},
 },{resolveMethods:async()=>{throw Error('frozen methods required');},resolveExecution:()=>{throw Error('frozen route required');}});
 const resumed=await h.pump(next.runId);assert.equal(resumed.status,'WAITING_INPUT');
 assert.equal(h.checkCount(),1,'unchanged completed check must not be dispatched again');
 assert.equal(h.decisions.at(-1)!.review.tasks.filter((task:any)=>task.status==='COMPLETE').length,1);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,1);
});

test('formal complete candidate requires every actual local/global check and leaves the author manuscript unchanged',async t=>{
 const h=setup(t,ctx=>{const ready=ctx.review.tasks.find((task:any)=>task.status==='READY');if(ready)return call('script.check_batch',{authorizationRef:ctx.goal.authorizationRef,taskId:ready.id});assert.ok(ctx.review.tasks.every((task:any)=>task.status==='COMPLETE'));return finish(ctx.index.workspaceRef);},{withPreviousSource:true}),receipt=await h.start(),run=await h.pump(receipt.runId,60);
 assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));assert.ok(h.checkCount()>2);assert.equal(h.checkCount(),h.decisions.at(-1)!.review.totalTasks);assert.equal((h.db.prepare('SELECT count(*) n FROM script_check_results').get() as any).n,h.checkCount());
 assert.equal((run.result as any).artifactRefs.length,1);assert.equal((run.result as any).artifactRefs[0].version,'1');assert.equal(h.host.workspaces.read(receipt.workspaceId,'author').writerRunId,null);assert.deepEqual(h.host.scripts.getProject(h.saved.id),h.saved);
 const reviewed=h.host.reviews.readAuthorStatus(run);
 assert.equal(reviewed.coverage.localComplete,true);assert.equal(reviewed.coverage.globalComplete,true);
 const workspace=h.host.workspaces.read(receipt.workspaceId,'author');
 const after=h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'post-finish-author-save',
   expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,document:structuredClone(workspace.document)});
 assert.equal(after.revision,2);
 const historical=h.host.reviews.readAuthorStatus(h.host.store.readRun(run.id));
 assert.equal(historical.reviewId,reviewed.reviewId);
 assert.equal(historical.workspaceRevision,1,'a finished Goal keeps its checked version after the workspace advances');
 assert.equal(historical.coverage.globalComplete,true);
 const {tasks:_tasks,findings:_findings,...historicalProgress}=historical;
 assert.deepEqual(h.host.reviews.readAuthorProgress(h.host.store.readRun(run.id)),historicalProgress,
   'progress preserves the exact completed historical verdict after a workspace revision');
 h.db.exec('SAVEPOINT missing_completed_review');
 try{
   h.db.prepare('UPDATE script_review_sets SET contract_hash=? WHERE id=?').run('missing-review-contract',reviewed.reviewId);
   assert.throws(()=>h.host.reviews.readAuthorStatus(h.host.store.readRun(run.id)),/原始审阅记录不存在/,
     'a missing checked review must not silently fall back to the current workspace');
   assert.throws(()=>h.host.reviews.readAuthorProgress(h.host.store.readRun(run.id)),/原始审阅记录不存在/);
 }finally{
   h.db.exec('ROLLBACK TO missing_completed_review');
   h.db.exec('RELEASE missing_completed_review');
 }
 assert.equal(h.host.reviews.readAuthorStatus(h.host.store.readRun(run.id)).coverage.globalComplete,true);
 assert.ok(h.previous);
 h.host.scripts.deleteProject(h.previous.id);
 const routes=new Map<string,(req:any,res:any)=>void>();
 registerScriptReadRoutes({get:(path:string,handler:(req:any,res:any)=>void)=>{routes.set(path,handler);}} as any,
   {store:h.host.store,journal:h.host.journal,goals:h.host.goals,
   workspaces:h.host.workspaces,drafts:h.host.drafts,authorizations:h.host.authorizations,
   reviews:h.host.reviews,commands:h.host.commands,owner:()=> 'author'});
 let status=200,payload:unknown;
 routes.get('/api/script-goals/:id/review')!({params:{id:receipt.goalId},query:{}},
   {status(code:number){status=code;return this;},json(value:unknown){payload=value;return this;}});
 assert.equal(status,200);
 assert.deepEqual(payload,{redacted:true,review:null},
   'the author read route must hide the finished review after its selected source is deleted');
});


test('formal selected-scene Goal writes and checks only three scenes, then finishes with an unselected empty fourth scene',async t=>{
 const h=setup(t,(ctx)=>{
   const selected=ctx.goal.contract.checks.targetScenes[0].sceneIds;
   const candidates=ctx.request.prompt.split('\n\n').flatMap(text=>{try{return [JSON.parse(text)];}catch{return [];}}).find(item=>item.candidates)?.candidates??[];
   const pending=candidates.find((item:any)=>item.status==='VALID'&&!item.appliedRevision);
   if(pending)return call('script.apply_patch',{authorizationRef:ctx.goal.authorizationRef,candidateId:pending.id,expectedRevision:Number(ctx.index.workspaceRef.version),writerEpoch:ctx.index.writerEpoch});
   const applied=candidates.filter((item:any)=>item.appliedRevision);
   if(applied.length<selected.length)return call('script.propose',{authorizationRef:ctx.goal.authorizationRef,operation:'scene_body',instruction:'【机械范围验收】只写指定场',unitId:ctx.goal.contract.checks.targetUnitIds[0],sceneId:selected[applied.length],slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null});
   const task=ctx.review.tasks.find((item:any)=>item.status==='READY');
   return task?call('script.check_batch',{authorizationRef:ctx.goal.authorizationRef,taskId:task.id}):finish(ctx.index.workspaceRef);
 },{partialScenes:true});
 const unit=h.saved.units[0],selected=unit.scenes.slice(0,3).map(scene=>scene.id),outside=structuredClone(unit.scenes[3]);
 const receipt=await h.host.commands.submit('author',{...h.command,stopAfter:'BODY',target:{unitIds:[unit.id],sceneIds:selected.map(sceneId=>({unitId:unit.id,sceneId}))}},h.resolvers);
 const run=await h.pump(receipt.runId,90);
 assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));
 const after=h.host.workspaces.read(receipt.workspaceId,'author').document;
 assert.deepEqual(after.units[0].scenes[3],outside);
 assert.ok(after.units[0].scenes.slice(0,3).every(scene=>scene.blocks.some(block=>block.text.includes('机械正文'))));
 const reviewRows=(h.db.prepare('SELECT data_json FROM script_review_sets').all() as any[]).map(row=>JSON.parse(row.data_json));
 assert.ok(reviewRows.length);
 for(const review of reviewRows)assert.deepEqual(review.manifest.units[0].scenes.map((scene:any)=>scene.sceneId),selected);
 assert.ok(h.checkCount()>0);
});
