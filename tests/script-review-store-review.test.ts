import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { CapabilityRegistry, hashValue, type ExecutionToken, type ModelRequest, type ResourceRef } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptReviewStore, type ReviewAuthority, type ReviewBatch } from '../apps/api/src/repositories/scriptReviewStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

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
  function change(rename=false,body='【机械返修】丙。'){const old=workspaces.read(workspace.id,'author'),next=structuredClone(old.document);next.units[0].scenes[0].blocks[0].text=body;if(rename)next.units[0].scenes[0].blocks[0].id='new_block';
    const saved=workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:`edit-${++serial}`,expectedRevision:old.revision,expectedEpoch:old.writerEpoch,document:next});
    const ref={uri:`resource://test/repair-${serial}`,version:'1',contentHash:hashValue({before:old.revision,after:saved.revision}),branch:`workspace:${workspace.id}`};
    db.prepare('INSERT INTO test_repair_applications VALUES(?,?,?,?)').run(ref.uri,old.revision,saved.revision,JSON.stringify(ref));return {old,saved,ref};}
  return {db,store,workspaces,workspace,auth,contexts,journal,reviews,registry,policy,sourceAccess,controller,stop,prepare,receive,check,current,change,setAllowed:(v:boolean)=>{allowed=v;},setState:(v:typeof state)=>{state=v;},reservations:()=>reservations,revokeRef:(ref:ResourceRef)=>revokedRefs.add(hashValue(ref))};
}
function finding(batch:ReviewBatch){const raw=batch.payload.raw[0];return {id:'problem',issue:'【机械问题】测试阻断定位',suggestion:'【机械建议】替换首块并复查',severity:'BLOCKING',basis:'RAW',source:{unitId:raw.unitId,sceneId:raw.sceneId,blockId:raw.blockId,start:raw.start,end:raw.end},uncertainty:''};}

// Independent retry regression; mechanical protocol only, no external provider.
test('an unresolved original finding remains repairable after a completed unsuccessful recheck',async t=>{
  const h=setup(t),c=await h.prepare(),invocation=h.receive(c,output([finding(c.batch)]));
  h.reviews.recordResult({token:c.token,invocationId:invocation});h.stop(c.token);
  const first=h.current(),originalId=first.findings[0].id;
  const begin=h.controller(),repair=h.reviews.beginRepair({token:begin.token,operationId:'first-repair',findingIds:[originalId]});h.stop(begin.token);
  const edit=h.change(true),mark=h.controller();h.reviews.markRepaired({token:mark.token,repairId:repair.id,applicationRef:edit.ref});h.stop(mark.token);
  const current=h.current();
  for(const task of current.plan.tasks){
    if(task.id===current.plan.tasks[0].id){
      const next=await h.prepare(task.id),stillBroken=finding(next.batch);
      stillBroken.issue='【机械协议】同一原问题仍未解决';
      const received=h.receive(next,output([stillBroken]));h.reviews.recordResult({token:next.token,invocationId:received});h.stop(next.token);
    }else await h.check(task.id);
  }
  const checked=h.current(),later=checked.findings.find(f=>f.id!==originalId)!;
  assert.ok(later);assert.notEqual(checked.findings.find(f=>f.id===originalId)!.status,'VERIFIED');
  const again=h.controller();
  const retry=h.reviews.beginRepair({token:again.token,operationId:'second-repair',findingIds:[originalId,later.id]});
  assert.equal(retry.round,2);assert.equal(h.reservations(),2);h.stop(again.token);
  const secondEdit=h.change(false,'【机械第二次返修】丁。'),secondMark=h.controller();
  h.reviews.markRepaired({token:secondMark.token,repairId:retry.id,applicationRef:secondEdit.ref});h.stop(secondMark.token);
  const finalPlan=h.current();
  for(const task of finalPlan.plan.tasks){
    const isLast=task.id===finalPlan.plan.tasks.at(-1)!.id;
    await h.check(task.id,output([],isLast?[originalId,later.id]:[]));
  }
  const finished=h.current();assert.equal(finished.findings.find(f=>f.id===originalId)!.status,'VERIFIED');
  assert.equal(finished.findings.find(f=>f.id===later.id)!.status,'VERIFIED');
  const end=h.controller();assert.equal(h.reviews.assessCompletion(end.token).complete,true);h.stop(end.token);
});
