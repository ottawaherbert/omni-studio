import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { CapabilityRegistry, formatCorrectionRequest, hashValue, type ExecutionToken, type ModelRequest, type ResourceRef } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptReviewStore, type ReviewAuthority, type ReviewBatch } from '../apps/api/src/repositories/scriptReviewStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';

const output=(findings:any[]=[],resolvedFindingIds:string[]=[])=>JSON.stringify({summary:'【机械检查协议】已处理本批次',findings,resolvedFindingIds});
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','review-tests');
  const scripts=createScriptRepository(db);scripts.ensureSchema();const workspaces=new ScriptWorkspaceStore(store,scripts);workspaces.ensureSchema();
  const doc=createScriptProject('机械审阅仓储验收',createScriptCreationProfile('short-film',1,3));doc.units[0].scenes[0].blocks=[{id:'old_block',type:'action',text:'【机械原文】甲。'},{id:'kept_block',type:'action',text:'【机械原文】乙。'}];
  const workspace=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:doc}});
  const revokedRefs=new Set<string>();
  let reviews:ScriptReviewStore,allowed=true,serial=0,reservations=0,state={unresolvedUnknown:false,outOfScopeWrites:false};
  const auth:ReviewAuthority={reviewScopeId:'goal_mechanical',workspaceId:workspace.id,authorizationRef:'authorization_mechanical',contract:{revision:1,targetUnitIds:[doc.units[0].id],
    localChecks:[{id:'local_protocol',dependency:'EXACT_BLOCKS'}],globalChecks:[{id:'global_protocol',dependency:'WHOLE_MANUSCRIPT'}],maxRawChars:12,maxIndexEntries:3,maxRepairRounds:2}};
  const contexts=new SqliteContextStore(store,(dep,access)=>allowed&&!revokedRefs.has(hashValue(dep.ref))&&(new URL(dep.ref.uri).pathname.startsWith('/check-receipts/')?reviews.sourceAllowed(dep.ref,access,dep.freshness):workspaces.sourceAllowed(dep.ref,access,dep.freshness)));contexts.ensureSchema();
  const sourceAccess={ownerId:'author',scopeId:workspace.id,branch:`workspace:${workspace.id}`};
  const journal=new SqliteModelJournal(store,(request,run,phase)=>{assert.equal(run.ownerId,'author');if(request.contextRef)(phase==='VIEW'?contexts.assertVisible(request.contextRef,sourceAccess):contexts.assertAllowed(request.contextRef,sourceAccess));});journal.ensureSchema();
  db.exec('CREATE TABLE test_repair_applications(id TEXT PRIMARY KEY,before_revision INTEGER NOT NULL,after_revision INTEGER NOT NULL,ref_json TEXT NOT NULL)');
  const policy={forRun:()=>structuredClone(auth),reserveRepair:()=>{reservations++;return true;},completionState:()=>structuredClone(state),repairApplication:(_run:any,ref:ResourceRef)=>{
    const row=db.prepare('SELECT * FROM test_repair_applications WHERE id=?').get(ref.uri) as any;
    if(!row||hashValue(JSON.parse(row.ref_json))!==hashValue(ref))throw new Error('not a committed repair application');
    return {workspaceId:workspace.id,beforeRevision:row.before_revision,afterRevision:row.after_revision};
  }};
  reviews=new ScriptReviewStore(store,workspaces,contexts,journal,policy);reviews.ensureSchema();
  const registry=new CapabilityRegistry({assertExecution:async c=>{store.assertExecution(c.execution);},authorize:async()=>{}}).register({spec:{id:'script.check_batch',version:'1',implementationDigest:hashValue('mechanical-review-v1'),description:'机械检查',effect:'WRITE',cost:'MODEL',dispatch:'DURABLE',replay:'TRANSACTIONAL',input:{jsonSchema:{},parse:x=>x},output:{jsonSchema:{},parse:x=>x}},
    prepare:async(input:any)=>({input,sources:input.frozen.reviewBatch.sourceRefs,targets:[]}),execute:async()=>{throw new Error('direct test uses real store commit');}});
  function controller(){const r=store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:`run-${++serial}`,kind:'CAPABILITY',input:{authorizationRef:auth.authorizationRef},policyRevision:'1',maxInvocations:50});return store.claim('parent',30000,r.runId)!;}
  function stop(token:ExecutionToken){store.finish(token,'SUCCEEDED',{});}
  async function prepare(taskId?:string,mutate?:(input:{batch:ReviewBatch;request:ModelRequest})=>void){
    const parent=controller(),plan=reviews.ensurePlan(parent.token),batch=reviews.prepareBatch(parent.token,taskId??plan.plan.tasks[0].id);
    const bundle=compileContext({systemInstruction:'仅用于机械流程验证',sections:[batch.section],skills:[],outputSchema:batch.outputSchema});
    const request:ModelRequest={operationKey:`check-${batch.task.id}`,channel:'api',routeRef:'fixture:mechanical',prompt:bundle.prompt,systemInstruction:bundle.systemInstruction,outputSchema:batch.outputSchema,inputManifest:batch.inputManifest,contextRef:contexts.capture(sourceAccess,bundle)};
    mutate?.({batch,request});
    const capability={capabilityId:'script.check_batch',capabilityVersion:'1',callId:'check',input:{authorizationRef:auth.authorizationRef,taskId:batch.task.id,frozen:{reviewBatch:batch,model:request}}};
    const prepared=await registry.prepare(capability,{ownerId:'author',scopeId:'script:home',commandRevision:'1',policyRevision:'1',execution:parent.token,signal:new AbortController().signal});
    const step=store.savePrepared(parent.token,prepared);store.handoff(parent.token,step.id);const child=store.claimChild('child',30000,parent.run.id)!;
    return {token:child.token,run:child.run,step,batch,request};
  }
  function receive(c:Awaited<ReturnType<typeof prepare>>,raw=output()){
    const invocation=journal.prepare(c.token,c.request),attempt=journal.startAttempt(c.token,invocation.id);
    journal.recordResult(invocation.id,attempt.attemptId,{text:raw,provenance:{channel:'provider',producer:'Mechanical protocol fixture; no creative generation'}});return invocation.id;
  }
  async function check(taskId?:string,raw=output()){
    const c=await prepare(taskId),invocationId=receive(c,raw),observation=reviews.recordResult({token:c.token,invocationId});stop(c.token);return {...c,invocationId,observation};
  }
  function current(){const c=controller(),review=reviews.ensurePlan(c.token);stop(c.token);return review;}
  function change(rename=false){const old=workspaces.read(workspace.id,'author'),next=structuredClone(old.document);next.units[0].scenes[0].blocks[0].text='【机械返修】丙。';if(rename)next.units[0].scenes[0].blocks[0].id='new_block';
    const saved=workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:`edit-${++serial}`,expectedRevision:old.revision,expectedEpoch:old.writerEpoch,document:next});
    const ref={uri:`resource://test/repair-${serial}`,version:'1',contentHash:hashValue({before:old.revision,after:saved.revision}),branch:`workspace:${workspace.id}`};
    db.prepare('INSERT INTO test_repair_applications VALUES(?,?,?,?)').run(ref.uri,old.revision,saved.revision,JSON.stringify(ref));return {old,saved,ref};}
  return {db,store,workspaces,workspace,auth,contexts,journal,reviews,registry,policy,sourceAccess,controller,stop,prepare,receive,check,current,change,setAllowed:(v:boolean)=>{allowed=v;},setState:(v:typeof state)=>{state=v;},reservations:()=>reservations,revokeRef:(ref:ResourceRef)=>revokedRefs.add(hashValue(ref))};
}
function finding(batch:ReviewBatch){const raw=batch.payload.raw[0];return {id:'problem',issue:'【机械问题】测试阻断定位',suggestion:'【机械建议】替换首块并复查',severity:'BLOCKING',basis:'RAW',source:{unitId:raw.unitId,sceneId:raw.sceneId,blockId:raw.blockId,start:raw.start,end:raw.end},uncertainty:''};}

test('review freezes real raw/index/upstream inputs and completes only all required checks',async t=>{
  const h=setup(t),initial=h.current();assert.equal(initial.receipts.length,0);
  for(const task of initial.plan.tasks)await h.check(task.id);
  const c=h.controller(),result=h.reviews.assessCompletion(c.token);assert.equal(result.complete,true);assert.equal(result.artifact.kind,'complete_candidate');assert.equal(result.artifact.revision,1);
  h.reviews.verifyCompletion(c.token,result.proof);h.setState({unresolvedUnknown:true,outOfScopeWrites:false});assert.throws(()=>h.reviews.verifyCompletion(c.token,result.proof),/已改变/);h.stop(c.token);
  const saved=h.db.prepare('SELECT data_json FROM script_check_results').get() as any;assert.match(JSON.parse(saved.data_json).raw,/机械检查协议/);
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,1);
});
test('author status uses the current valid story synthesis and drops its ready projection after a body edit',async t=>{
  const h=setup(t),old=h.workspaces.read(h.workspace.id,'author'),document=structuredClone(old.document),unit=document.units[0];
  document.brief.outline='甲停在门口。\n乙把门打开。';const collected=collectOutlineRequirements(document,[{unitId:unit.id}]);unit.scenes[0].outlineRequirementIds=collected.items.map(item=>item.id);
  const saved=h.workspaces.saveAuthor({ownerId:'author',workspaceId:old.id,requestId:'outline-source',expectedRevision:old.revision,expectedEpoch:old.writerEpoch,document});
  h.auth.contract.globalChecks=[{id:'story_coverage',dependency:'WHOLE_MANUSCRIPT'}];h.auth.contract.storyCoverage={originRevision:saved.revision,targets:[{unitId:unit.id}]};h.auth.contract.outlineRequirements=collected.items;h.auth.contract.outlineGaps=[];
  const initial=h.current();
  for(const task of initial.plan.tasks){
    const pending=await h.prepare(task.id);
    const outlineCoverage=task.requiredOutline?.map((item,index)=>{
      const block=unit.scenes[0].blocks[index],raw=pending.batch.payload.raw.find(span=>span.blockId===block.id&&span.start===0&&span.end===block.text.length);
      const upstream=pending.batch.payload.evidence.flatMap(receipt=>receipt.outlineCoverage??[]).find(entry=>entry.requirementId===item.id&&entry.status==='DRAFT_READY');
      const evidence=raw?[{sceneId:unit.scenes[0].id,blockId:block.id,start:0,end:block.text.length}]:upstream?.evidence??[];
      return {requirementId:item.id,status:evidence.length?'DRAFT_READY':'PLANNED',reason:evidence.length?'机械正文证据可核对':'本批尚无该原文',evidence};
    });
    const raw=JSON.stringify({summary:'机械范围核对',findings:[],resolvedFindingIds:[],...(outlineCoverage?{outlineCoverage}:{})});
    const invocation=h.receive(pending,raw);h.reviews.recordResult({token:pending.token,invocationId:invocation});h.stop(pending.token);
  }
  const active=h.controller(),status=h.reviews.readAuthorStatus(h.store.readRun(active.run.id));assert.deepEqual(status.storyProgress?.map(item=>item.status),['DRAFT_READY','DRAFT_READY']);assert.deepEqual(status.outlineGaps,[]);
  const {tasks:_tasks,findings:_findings,...expected}=status;
  assert.deepEqual(h.reviews.readAuthorProgress(h.store.readRun(active.run.id)),expected);
  h.setAllowed(false);
  const withdrawn=h.reviews.readAuthorProgress(h.store.readRun(active.run.id));
  assert.equal(withdrawn.coverage.globalComplete,false,'revoked receipts cannot retain a complete progress verdict');
  assert.ok(withdrawn.storyProgress?.every(item=>item.status!=='DRAFT_READY'));
  h.setAllowed(true);
  assert.deepEqual(h.reviews.readAuthorProgress(h.store.readRun(active.run.id)),expected,'restored permission is rechecked without a cross-request cache');
  h.stop(active.token);
  h.change();const after=h.controller(),stale=h.reviews.readAuthorStatus(h.store.readRun(after.run.id));assert.ok(stale.storyProgress?.every(item=>item.status!=='DRAFT_READY'));
  assert.deepEqual(h.reviews.readAuthorProgress(h.store.readRun(after.run.id)).storyProgress,stale.storyProgress);
  h.stop(after.token);
});
test('omitted sent raw cannot be promoted by a truthful-looking input manifest',async t=>{
  const h=setup(t),c=await h.prepare(undefined,({request,batch})=>{
    const section={...batch.section,text:'没有真正发送原文'};const bundle=compileContext({systemInstruction:request.systemInstruction!,sections:[section],skills:[],outputSchema:request.outputSchema});
    request.prompt=bundle.prompt;request.contextRef=h.contexts.capture(h.sourceAccess,bundle);
  }),invocation=h.receive(c);
  assert.throws(()=>h.reviews.recordResult({token:c.token,invocationId:invocation}),/没有完整发送/);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,0);
});
test('another invocation or forged prepared input cannot supply a check result',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c);
  const other=h.journal.prepare(c.token,{...c.request,operationKey:'unrelated'}),attempt=h.journal.startAttempt(c.token,other.id);h.journal.recordResult(other.id,attempt.attemptId,{text:output(),provenance:{channel:'provider'}});
  assert.throws(()=>h.reviews.recordResult({token:c.token,invocationId:other.id}),/真实发送/);
  const step=h.store.getStep(c.run.id,1,'check')!;step.prepared.request.input={...(step.prepared.request.input as any),taskId:'forged'};h.db.prepare('UPDATE agent_steps SET prepared_json=? WHERE id=?').run(JSON.stringify(step.prepared),step.id);
  assert.throws(()=>h.reviews.recordResult({token:c.token,invocationId:invocation}),/冻结证据无效/);
});
test('invalid and self-reported coverage are kept as raw FAILED results without granting coverage',async t=>{
  const h=setup(t),checked=await h.check(undefined,JSON.stringify({summary:'claims complete',findings:[],resolvedFindingIds:[],allChecked:true}));assert.equal(checked.observation.status,'FAILED');
  const review=h.current();assert.equal(review.receipts[0].schemaValidated,false);assert.equal(review.findings.length,0);
  const stored=JSON.parse((h.db.prepare('SELECT data_json FROM script_check_results').get() as any).data_json);assert.match(stored.raw,/allChecked/);
  const c=h.controller();assert.equal(h.reviews.assessCompletion(c.token).complete,false);h.stop(c.token);
});
test('receipt, findings, raw and context artifact roll back with the Step effect transaction',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c,output([finding(c.batch)]));
  h.db.exec("CREATE TRIGGER reject_review_save BEFORE UPDATE ON script_review_sets BEGIN SELECT RAISE(ABORT,'injected review rollback');END;");
  assert.throws(()=>h.reviews.recordResult({token:c.token,invocationId:invocation}),/injected review rollback/);
  assert.equal(h.store.getStep(c.run.id,1,'check')!.status,'PREPARED');assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,0);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_context_artifacts WHERE domain='script-check-result'").get() as any).n,0);
  h.db.exec('DROP TRIGGER reject_review_save');assert.equal(h.reviews.recordResult({token:c.token,invocationId:invocation}).status,'SUCCEEDED');
});
test('committed check replay is exact and does not rerun old CURRENT preconditions after an author revision',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c),first=h.reviews.recordResult({token:c.token,invocationId:invocation});
  h.change();assert.deepEqual(h.reviews.recordResult({token:c.token,invocationId:invocation}),first);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,1);
  h.setAllowed(false);assert.throws(()=>h.reviews.recordResult({token:c.token,invocationId:invocation}));
});
test('changed body replans and carries only exact unchanged local blocks, never global coverage',async t=>{
  const h=setup(t),before=h.current();for(const task of before.plan.tasks)await h.check(task.id);
  h.change();const after=h.current();assert.notEqual(after.id,before.id);assert.ok(after.receipts.length>0);assert.ok(after.receipts.every(r=>r.carriedFromReceiptId&&after.plan.tasks.find(t=>t.id===r.taskId)?.kind==='LOCAL'));
  const c=h.controller();assert.equal(h.reviews.assessCompletion(c.token).coverage.globalComplete,false);h.stop(c.token);
});
test('renamed block repair needs an actual application, complete new raw and explicit resolution',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c,output([finding(c.batch)]));h.reviews.recordResult({token:c.token,invocationId:invocation});h.stop(c.token);
  const initial=h.current(),findingId=initial.findings[0].id,start=h.controller(),repair=h.reviews.beginRepair({token:start.token,operationId:'repair-one',findingIds:[findingId]});
  assert.deepEqual(h.reviews.beginRepair({token:start.token,operationId:'repair-one',findingIds:[findingId]}),repair);assert.equal(h.reservations(),1);h.stop(start.token);
  const edit=h.change(true),mark=h.controller();assert.equal(h.reviews.beginRepair({token:mark.token,operationId:'repair-one',findingIds:[findingId]}).id,repair.id);assert.equal(h.reservations(),1);assert.throws(()=>h.reviews.markRepaired({token:mark.token,repairId:repair.id,applicationRef:{...edit.ref,contentHash:hashValue('forged')}}),/committed/);
  const mapped=h.reviews.markRepaired({token:mark.token,repairId:repair.id,applicationRef:edit.ref});assert.ok(mapped.mappings[0].raw.some(r=>r.blockId==='new_block'));h.stop(mark.token);
  const current=h.current();assert.equal(current.findings[0].status,'REVISED');
  // Reading only one new chunk cannot claim that the whole mapped scene passed.
  const first=await h.check(current.plan.tasks[0].id,output([],[findingId]));assert.equal(first.observation.status,'FAILED');
  for(const task of current.plan.tasks){
    const last=task.id===current.plan.tasks.at(-1)!.id;await h.check(task.id,output([],last?[findingId]:[]));
  }
  const final=h.current();assert.equal(final.findings.find(f=>f.id===findingId)!.status,'VERIFIED');
  const end=h.controller();assert.equal(h.reviews.assessCompletion(end.token).complete,true);h.stop(end.token);
});
test('new blocks and no repeated finding do not automatically mark old issues verified',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c,output([finding(c.batch)]));h.reviews.recordResult({token:c.token,invocationId:invocation});h.stop(c.token);
  const initial=h.current(),start=h.controller(),repair=h.reviews.beginRepair({token:start.token,operationId:'repair',findingIds:[initial.findings[0].id]});h.stop(start.token);
  const edit=h.change(true),mark=h.controller();h.reviews.markRepaired({token:mark.token,repairId:repair.id,applicationRef:edit.ref});h.stop(mark.token);
  for(const task of h.current().plan.tasks)await h.check(task.id);
  const end=h.controller(),assessment=h.reviews.assessCompletion(end.token);assert.equal(assessment.complete,false);assert.ok(assessment.gaps.some(g=>g.includes('阻断')));h.stop(end.token);
});
test('repair limit and missing completion policy fail closed, not an unbounded loop or assumed success',async t=>{
  const h=setup(t);h.auth.contract.maxRepairRounds=0;
  const c=await h.prepare(),invocation=h.receive(c,output([finding(c.batch)]));h.reviews.recordResult({token:c.token,invocationId:invocation});h.stop(c.token);
  const start=h.controller(),review=h.reviews.readStatus(start.token);assert.throws(()=>h.reviews.beginRepair({token:start.token,operationId:'over',findingIds:[review.findings[0].id]}),/轮数已用尽/);assert.equal(h.reservations(),0);h.stop(start.token);
  const closed=new ScriptReviewStore(h.store,h.workspaces,h.contexts,h.journal,{forRun:()=>h.auth});for(const task of h.current().plan.tasks)await h.check(task.id);
  const end=h.controller();assert.equal(closed.assessCompletion(end.token).complete,false);h.stop(end.token);
});
test('receipt references reject foreign owner, scope and revoked source, while exact historical refs remain viewable',async t=>{
  const h=setup(t),checked=await h.check(),review=h.current(),receipt=review.receipts[0],ref=h.reviews.receiptRef(review,receipt);
  assert.equal(h.reviews.sourceAllowed(ref,h.sourceAccess,'EXACT'),true);assert.equal(h.reviews.sourceAllowed(ref,{...h.sourceAccess,ownerId:'other'},'EXACT'),false);
  assert.equal(h.reviews.sourceAllowed(ref,{...h.sourceAccess,scopeId:'script:home'},'EXACT'),false);
  h.change();assert.equal(h.reviews.sourceAllowed(ref,h.sourceAccess,'EXACT'),true);assert.equal(h.reviews.sourceAllowed(ref,h.sourceAccess,'CURRENT'),false);
  h.setAllowed(false);assert.equal(h.reviews.sourceAllowed(ref,h.sourceAccess,'EXACT'),false);assert.ok(checked.invocationId);
});

test('late result after source withdrawal is preserved by journal but cannot commit check coverage',async t=>{
  const h=setup(t),c=await h.prepare(),invocationId=h.receive(c);h.setAllowed(false);
  assert.throws(()=>h.reviews.recordResult({token:c.token,invocationId}));
  assert.match(h.journal.read(invocationId).result!.text,/机械检查协议/);assert.equal(h.store.getStep(c.run.id,1,'check')!.status,'PREPARED');
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,0);
});
test('fresh repository instances recover durable raw receipts and replay the same committed check',async t=>{
  const h=setup(t),c=await h.prepare(),invocationId=h.receive(c),first=h.reviews.recordResult({token:c.token,invocationId});
  const reopened=new ScriptReviewStore(new AgentSqliteStore(h.db),h.workspaces,h.contexts,h.journal,h.policy);reopened.ensureSchema();
  assert.deepEqual(reopened.recordResult({token:c.token,invocationId}),first);assert.equal(reopened.readStatus(c.token).receipts.length,1);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n,1);
});
test('receipt mutable projection cannot silently diverge from the original received model record',async t=>{
  const h=setup(t);await h.check();const review=h.current();review.receipts[0].summary='forged summary';
  h.db.prepare('UPDATE script_review_sets SET data_json=? WHERE id=?').run(JSON.stringify(review),review.id);
  const c=h.controller();assert.throws(()=>h.reviews.readStatus(c.token),/证据已变化/);
  assert.throws(()=>h.reviews.readAuthorProgress(h.store.readRun(c.run.id)),/证据已变化/,'progress must not trust a forged receipt');
});

test('withdrawn copied findings lose active authority until fresh checks cover the changed body',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c,output([finding(c.batch)]));h.reviews.recordResult({token:c.token,invocationId:invocation});h.stop(c.token);
  const original=h.current();h.change(true);const next=h.current();assert.equal(next.receipts.length,0);assert.equal(next.findings.length,1);assert.equal(next.findingSources[0].reviewId,original.id);
  h.revokeRef(original.baseRef);const reader=h.controller(),active=h.reviews.readStatus(reader.token);
  assert.equal(active.findings.length,0);assert.equal(active.findingSources.length,0);
  assert.equal(active.receipts.length,0);assert.equal(h.reviews.assessCompletion(reader.token).complete,false);
  assert.equal(h.reviews.sourceAllowed(h.reviews.receiptRef(original,original.receipts[0]),h.sourceAccess,'EXACT'),false);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,1);
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,2);
});

test('completion assessment is read-only and cannot manufacture a persisted check plan or receipt',t=>{
  const h=setup(t),c=h.controller(),before=(h.db.prepare('SELECT count(*) AS n FROM script_review_sets').get() as any).n;
  const result=h.reviews.assessCompletion(c.token);assert.equal(result.complete,false);assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_review_sets').get() as any).n,before);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_check_results').get() as any).n,0);h.stop(c.token);
});

test('missing planned units reject a premature FINISH without failing the executor or replacing its target',t=>{
  const h=setup(t);h.auth.contract.targetUnitIds=['future-unit-slot'];const c=h.controller(),result=h.reviews.assessCompletion(c.token);
  assert.equal(result.complete,false);assert.equal(result.artifact,null);assert.equal(result.proof,null);assert.match(result.gaps[0],/目标单元不存在/);
  assert.throws(()=>h.reviews.verifyCompletion(c.token,null),/已改变/);h.store.assertExecution(c.token);h.stop(c.token);
});


test('corrected review remains verifiable by later completion and visibility checks',async t=>{
  const h=setup(t),plan=h.current();
  for(const task of plan.plan.tasks){
    const c=await h.prepare(task.id),sourceId=h.receive(c,'not-json');
    const correction=h.journal.prepare(c.token,formatCorrectionRequest(h.journal.read(sourceId)));
    const attempt=h.journal.startAttempt(c.token,correction.id);
    h.journal.recordResult(correction.id,attempt.attemptId,{text:output(),provenance:{channel:'provider'}});
    assert.equal(h.reviews.recordResult({token:c.token,invocationId:sourceId}).status,'SUCCEEDED');h.stop(c.token);
  }
  const c=h.controller(),result=h.reviews.assessCompletion(c.token);
  assert.equal(result.complete,true);h.reviews.verifyCompletion(c.token,result.proof);h.stop(c.token);
  assert.ok(h.current().receipts.length);
});


test('progress keeps finding provenance checks without rebuilding detail text or task summaries',async t=>{
  const h=setup(t),pending=await h.prepare(),invocation=h.receive(pending,output([finding(pending.batch)]));
  h.reviews.recordResult({token:pending.token,invocationId:invocation});h.stop(pending.token);
  const active=h.controller(),run=h.store.readRun(active.run.id);
  const provenance=t.mock.method(h.reviews as any,'findingSource');
  const full=h.reviews.readAuthorStatus(run),fullCalls=provenance.mock.callCount();
  assert.ok(full.findings[0].originalText);assert.ok(full.tasks.length);
  const summary=h.reviews.readAuthorProgress(run),summaryCalls=provenance.mock.callCount()-fullCalls;
  const {tasks:_tasks,findings:_findings,...expected}=full;
  assert.deepEqual(summary,expected);
  assert.ok(summaryCalls>0,'summary still validates finding provenance through the same checked review');
  assert.ok(summaryCalls<fullCalls,'summary does not perform the second pass that locates and reconstructs every finding original');
  h.stop(active.token);
});
