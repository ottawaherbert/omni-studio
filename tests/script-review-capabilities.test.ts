import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from 'js-sha256';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AgentWorker, AgentChildWorker, CapabilityRegistry, hashValue, type ModelRequest, type ModelResult } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { ScriptReviewStore } from '../apps/api/src/repositories/scriptReviewStore';
import { createScriptReviewAuthorization, registerScriptReviewCapabilities } from '../apps/api/src/agent/scriptReviewCapabilities';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { validateScriptDraftScope, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';
import { buildRequiredWritingContext } from '../packages/script/src/writingContext';

const raw=(findings:any[]=[])=>JSON.stringify({summary:'【机械工具协议】收到检查输入',findings,resolvedFindingIds:[]});
function setup(t:any,customize?:(document:ReturnType<typeof createScriptProject>)=>void,targetIndex=0,
  checkLimits?:{maxRawChars:number;maxIndexEntries:number;storyCoverage?:boolean}){
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();const conversations=new SqliteConversationStore(store);conversations.ensureSchema();
  const thread=conversations.open('author','script:home','shared-review'),scripts=createScriptRepository(db);scripts.ensureSchema();const workspaces=new ScriptWorkspaceStore(store,scripts);workspaces.ensureSchema();
  const document=createScriptProject('【机械共享检查】',createScriptCreationProfile('short-film',1,3));document.units[0].scenes[0].blocks[0].text='【机械原文】测试。';customize?.(document);
  const w=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}});
  let reviews:ScriptReviewStore,allowed=true,n=0,sendCount=0,repairReservations=0,output=(request:ModelRequest):ModelResult=>({text:raw(),provenance:{channel:'provider',producer:'mechanical protocol fixture'}});
  const applications=new Map<string,{workspaceId:string;beforeRevision:number;afterRevision:number}>();
  const requests:ModelRequest[]=[],contexts=new SqliteContextStore(store,(dep,access)=>allowed&&(new URL(dep.ref.uri).pathname.startsWith('/check-receipts/')?reviews.sourceAllowed(dep.ref,access,dep.freshness):workspaces.sourceAllowed(dep.ref,access,dep.freshness)));contexts.ensureSchema();
  const authorizations=new ScriptAuthorizationStore(store,workspaces,{validateScope:(scope,workspace)=>validateScriptDraftScope(workspace.document,scope as ScriptDraftScope),readSource:()=>{throw new Error('No selected prior sources in fixture');}});authorizations.ensureSchema();
  const journal=new SqliteModelJournal(store,(request,run,phase)=>authorizations.withRunAuthorization(run,phase,()=>{
    const auth=authorizations.forRun(run,phase),access={ownerId:run.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`};
    const bundle=phase==='VIEW'?contexts.assertVisible(request.contextRef!,access):contexts.assertAllowed(request.contextRef!,access);
    assert.equal(bundle.prompt,request.prompt);assert.deepEqual(bundle.outputSchema,request.outputSchema);
  }));journal.ensureSchema();
  const reviewPolicy={forRun:(run:any,phase:any)=>{const auth=authorizations.forRun(run,phase);return {reviewScopeId:'shared-goal-protocol',workspaceId:w.id,authorizationRef:auth.id,
    contract:{revision:1,targetUnitIds:[w.document.units[targetIndex].id],localChecks:[{id:'local',dependency:'EXACT_BLOCKS' as const}],
      globalChecks:[{id:'global',dependency:'WHOLE_MANUSCRIPT' as const},...(checkLimits?.storyCoverage?[{id:'story_coverage',dependency:'WHOLE_MANUSCRIPT' as const}]:[])],
      maxRawChars:checkLimits?.maxRawChars??100,maxIndexEntries:checkLimits?.maxIndexEntries??3,maxRepairRounds:2,
      ...(checkLimits?.storyCoverage?{storyCoverage:{originRevision:w.revision,targets:[{unitId:w.document.units[targetIndex].id}]},
        outlineRequirements:collectOutlineRequirements(w.document,[{unitId:w.document.units[targetIndex].id}]).items,outlineGaps:[]}: {})}};},
    repairApplication:(_run:any,ref:any)=>{const evidence=applications.get(hashValue(ref));if(!evidence)throw new Error('missing application evidence');return evidence;},reserveRepair:()=>{repairReservations++;return true;},completionState:()=>({unresolvedUnknown:false,outOfScopeWrites:false})};
  reviews=new ScriptReviewStore(store,workspaces,contexts,journal,reviewPolicy);reviews.ensureSchema();
  const settings=new Map<string,{channel:'api'|'external';routeRef:string;methods:any[];authorRequest:string}>();
  const deps={store,contexts,journal,authorizations,workspaces,reviews,transport:{sendOnce:async(request:ModelRequest)=>{sendCount++;requests.push(structuredClone(request));return output(request);}},executionSettings:(runId:string)=>settings.get(runId)!};
  const registry=new CapabilityRegistry({assertExecution:async c=>{store.assertExecution(c.execution);},authorize:createScriptReviewAuthorization(deps)});
  registerScriptReviewCapabilities(registry,deps,hashValue('shared-review-mechanical-v1'));
  const worker=new AgentWorker(store,registry,{workerId:'review-parent'}),child=new AgentChildWorker(store,registry,{workerId:'review-child'});
  function command(tool:string,input:Record<string,unknown>={},channel:'api'|'external'='api'){
    const workspace=workspaces.read(w.id,'author'),requestId=`command-${++n}`,scope:ScriptDraftScope={workspaceId:w.id,documentId:w.documentId,originRevision:workspace.revision,originContentHash:hashValue(workspace.document),
      operations:['scene_body'],units:[{unitId:w.document.units[targetIndex].id,allowSummary:false,allowAllScenes:true,maxNewScenes:0,scenes:[]}],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]};
    const auth=authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:w.id,commandId:requestId,scope,sources:[]});
    const request={capabilityId:tool,capabilityVersion:'1',callId:'operation',input:{authorizationRef:auth.id,...input}},accepted=store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId,kind:'CAPABILITY',input:{authorizationRef:auth.id,request},policyRevision:'1',maxInvocations:20});
    authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});
    settings.set(accepted.runId,{channel,routeRef:'frozen-fixture-route',methods:[{id:'method-fixture',title:'机械方法',version:'1',content:'【完整机械方法】精确原文、后半段约束、结尾约束。'}],authorRequest:'【机械作者意图】只检查当前单元'});return {runId:accepted.runId,auth,request};
  }
  async function run(tool:string,input:Record<string,unknown>={}){const c=command(tool,input);await worker.runOnce(c.runId);if(store.readRun(c.runId).status==='WAITING_STEP'){await child.runOnce(c.runId);await worker.runOnce(c.runId);}return {...c,run:store.readRun(c.runId),step:store.getStep(c.runId,1,'operation')!};}
  return {db,store,contexts,journal,workspaces,w,applications,authorizations,reviews,registry,worker,child,requests,settings,command,run,sourceAllowed:(v:boolean)=>{allowed=v;},setOutput:(fn:typeof output)=>{output=fn;},sendCount:()=>sendCount,repairReservations:()=>repairReservations};
}

test('shared registry status and durable checks use full frozen Skill and real request evidence',async t=>{
  const h=setup(t),status=await h.run('script.check_status',{cursor:null,limit:50});assert.equal(status.run.status,'SUCCEEDED');assert.equal(h.sendCount(),0);
  const data=status.step.observation!.data as any;assert.equal(data.coverage.localComplete,false);assert.ok(data.tasks.some((t:any)=>t.status==='WAITING_UPSTREAM'));
  for(const task of data.tasks){const checked=await h.run('script.check_batch',{taskId:task.id});assert.equal(checked.run.status,'SUCCEEDED',JSON.stringify(checked.run));}
  assert.match(h.requests[0].prompt,/完整机械方法.*后半段约束.*结尾约束/);assert.match(h.requests[0].prompt,/机械原文/);
  assert.equal(h.requests[0].routeRef,'frozen-fixture-route');
  const last=await h.run('script.check_status',{cursor:null,limit:50});assert.equal((last.step.observation!.data as any).coverage.globalComplete,true);
  const c=h.command('script.check_status',{cursor:null,limit:20}),claim=h.store.claim('proof-reader',30000,c.runId)!;
  const completion=h.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>h.reviews.assessCompletion(claim.token));assert.equal(completion.complete,true);
  h.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>h.reviews.verifyCompletionForRun(h.store.readRun(c.runId),completion.proof));
  assert.throws(()=>h.reviews.verifyCompletionForRun({...claim.run,version:claim.run.version-1},completion.proof),/任务版本已改变/);
});
test('check status pagination is bounded and rejects a stale review cursor after an actual check',async t=>{
  const h=setup(t),first=await h.run('script.check_status',{cursor:null,limit:1}),data=first.step.observation!.data as any;assert.equal(data.tasks.length,1);assert.ok(data.truncated&&data.nextCursor);
  const next=await h.run('script.check_status',{cursor:data.nextCursor,limit:1});assert.equal(next.run.status,'SUCCEEDED');assert.notEqual((next.step.observation!.data as any).tasks[0].id,data.tasks[0].id);
  await h.run('script.check_batch',{taskId:data.tasks[0].id});const stale=await h.run('script.check_status',{cursor:data.nextCursor,limit:1});assert.equal(stale.run.status,'NEEDS_REBASE');assert.equal(h.sendCount(),1);
});
test('provider metadata-invalid received result becomes a saved failed check, never an UNKNOWN retry',async t=>{
  const h=setup(t),status=await h.run('script.check_status',{cursor:null,limit:50}),task=(status.step.observation!.data as any).tasks[0];
  h.setOutput(()=>({text:'【机械非法原件】',provenance:{channel:'provider'},validationErrors:['mechanical malformed body']}));
  const checked=await h.run('script.check_batch',{taskId:task.id});assert.equal(checked.run.status,'FAILED');assert.equal(checked.step.status,'COMMITTED');
  assert.equal(h.sendCount(),1);const saved=JSON.parse((h.db.prepare('SELECT data_json FROM script_check_results').get() as any).data_json);assert.equal(saved.raw,'【机械非法原件】');assert.equal(saved.receipt.status,'FAILED');
  assert.equal((h.db.prepare('SELECT status FROM agent_invocations').get() as any).status,'RECEIVED');
});
test('external return resumes exactly the prepared Skill/config even if current settings change',async t=>{
  const h=setup(t),status=await h.run('script.check_status',{cursor:null,limit:20}),task=(status.step.observation!.data as any).tasks[0];
  const c=h.command('script.check_batch',{taskId:task.id},'external');await h.worker.runOnce(c.runId);await h.child.runOnce(c.runId);
  assert.equal(h.store.readRun(c.runId).status,'WAITING_EXTERNAL');const request=h.journal.listExternal(c.runId,'author')[0];assert.match(request.request.prompt,/完整机械方法/);
  h.settings.set(c.runId,{channel:'api',routeRef:'changed-route',methods:[],authorRequest:'changed'});
  h.journal.submitExternal(request.id,'author',request.inputHash,raw(),{name:'mechanical protocol',model:'no external provider'});
  await h.child.runOnce(c.runId);await h.worker.runOnce(c.runId);assert.equal(h.store.readRun(c.runId).status,'SUCCEEDED');assert.equal(h.sendCount(),0);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_invocations').get() as any).n,1);
});
test('source withdrawal between parent handoff and child dispatch prevents physical model attempts',async t=>{
  const h=setup(t),status=await h.run('script.check_status',{cursor:null,limit:20}),task=(status.step.observation!.data as any).tasks[0],c=h.command('script.check_batch',{taskId:task.id});
  await h.worker.runOnce(c.runId);h.sourceAllowed(false);await h.child.runOnce(c.runId);
  assert.equal(h.store.readRun(c.runId).status,'NEEDS_REBASE');assert.equal(h.sendCount(),0);assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n,0);
});
test('repair reservation and review state roll back if the Step receipt cannot commit',async t=>{
  const h=setup(t),status=await h.run('script.check_status',{cursor:null,limit:20}),task=(status.step.observation!.data as any).tasks[0];
  h.setOutput(request=>{const match=/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(request.prompt)!,payload=JSON.parse(match[1]),span=payload.payload.raw[0];return {text:raw([{id:'problem',issue:'【机械问题】',suggestion:'【机械修改建议】',severity:'BLOCKING',basis:'RAW',source:{unitId:span.unitId,sceneId:span.sceneId,blockId:span.blockId,start:span.start,end:span.end},uncertainty:''}]),provenance:{channel:'provider'}};});
  await h.run('script.check_batch',{taskId:task.id});const issues=await h.run('script.check_status',{cursor:null,limit:20}),findingId=(issues.step.observation!.data as any).findings[0].id;
  h.db.exec("CREATE TRIGGER reject_repair_receipt BEFORE UPDATE OF status ON agent_steps WHEN NEW.status='COMMITTED' BEGIN SELECT RAISE(ABORT,'repair receipt fault'); END;");
  const bad=await h.run('script.begin_repair',{operationId:'repair-one',findingIds:[findingId]});assert.equal(bad.run.status,'FAILED');assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_review_repairs').get() as any).n,0);
  h.db.exec('DROP TRIGGER reject_repair_receipt');const good=await h.run('script.begin_repair',{operationId:'repair-two',findingIds:[findingId]});assert.equal(good.run.status,'SUCCEEDED');assert.equal((good.step.observation!.data as any).round,1);
});
test('all advertised model tool schemas describe nested objects completely',t=>{
  const h=setup(t);function check(schema:any){if(schema.type==='object'){assert.equal(schema.additionalProperties,false);assert.deepEqual([...schema.required].sort(),Object.keys(schema.properties).sort());Object.values(schema.properties).forEach(check);}if(schema.items)check(schema.items);schema.anyOf?.forEach(check);}
  for(const spec of h.registry.describe()){check(spec.inputSchema);check(spec.outputSchema);}
});

test('mark_repaired freezes the exact application dependency and receipt replay fails after source withdrawal',async t=>{
  const h=setup(t),status=await h.run('script.check_status',{cursor:null,limit:20}),task=(status.step.observation!.data as any).tasks[0];
  h.setOutput(request=>{const payload=JSON.parse(/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(request.prompt)![1]),span=payload.payload.raw[0];return {text:raw([{id:'problem',issue:'【机械问题】',suggestion:'【机械修改】',severity:'BLOCKING',basis:'RAW',source:{unitId:span.unitId,sceneId:span.sceneId,blockId:span.blockId,start:span.start,end:span.end},uncertainty:''}]),provenance:{channel:'provider'}};});
  await h.run('script.check_batch',{taskId:task.id});const issues=await h.run('script.check_status',{cursor:null,limit:20}),findingId=(issues.step.observation!.data as any).findings[0].id;
  const begin=await h.run('script.begin_repair',{operationId:'repair-replay',findingIds:[findingId]}),repairId=(begin.step.observation!.data as any).repairId;
  const old=h.workspaces.read(h.w.id,'author'),document=structuredClone(old.document);document.units[0].scenes[0].blocks[0].text='【机械返修新稿】';
  const updated=h.workspaces.saveAuthor({ownerId:'author',workspaceId:old.id,requestId:'applied-test-evidence',expectedRevision:old.revision,expectedEpoch:old.writerEpoch,document}),ref=workspaceRef(updated);
  h.applications.set(hashValue(ref),{workspaceId:old.id,beforeRevision:old.revision,afterRevision:updated.revision});
  const c=h.command('script.mark_repaired',{repairId,applicationRef:ref}),claim=h.store.claim('replay-check',30000,c.runId)!,base={ownerId:'author',scopeId:'script:home',commandRevision:'1',policyRevision:'1',execution:claim.token,signal:new AbortController().signal};
  const prepared=await h.registry.prepare(c.request,base),step=h.store.savePrepared(claim.token,prepared),context={...base,execution:{...claim.token,stepId:step.id}},frozen=(prepared.request.input as any).frozen;
  const bundle=h.contexts.assertAllowed(frozen.contextRef,{ownerId:'author',scopeId:old.id,branch:`workspace:${old.id}`});
  assert.ok(bundle.dependencies.some(d=>d.freshness==='EXACT'&&hashValue(d.ref)===hashValue(ref)));assert.ok(prepared.sources.some(r=>hashValue(r)===hashValue(ref)));
  await h.registry.execute(prepared,context);assert.equal(h.store.getStep(c.runId,1,'operation')!.status,'COMMITTED');await h.registry.attestReceipt(prepared,context);
  h.sourceAllowed(false);await assert.rejects(h.registry.attestReceipt(prepared,context));assert.equal(h.store.getStep(c.runId,1,'operation')!.status,'COMMITTED');
});
test('check transport receives only operation-applicable Skill and actual selected auxiliary records',async t=>{
  const h=setup(t),workspace=h.workspaces.read(h.w.id,'author'),document=structuredClone(workspace.document);document.storylines=[{id:'line-protocol',scopeId:document.id,lane:'A',title:'【真正结构资料哨兵】',premise:'规划',resolution:'未来计划'}];
  h.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'structure-setup',expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,document});
  const status=await h.run('script.check_status',{cursor:null,limit:20}),task=(status.step.observation!.data as any).tasks[0],c=h.command('script.check_batch',{taskId:task.id});
  h.settings.get(c.runId)!.methods=[{id:'not-review',title:'仅正文方法',version:'1',content:'【不该用于检查的方法正文】',usage:{operations:['scene'],inputs:['continuity'],note:''}},
    {id:'review-method',title:'检查方法',version:'2',content:'【完整检查方法正文】',usage:{operations:['review'],inputs:['structure'],note:'【使用说明】'}}];
  await h.worker.runOnce(c.runId);await h.child.runOnce(c.runId);await h.worker.runOnce(c.runId);assert.equal(h.store.readRun(c.runId).status,'SUCCEEDED');
  const request=h.requests.at(-1)!;assert.match(request.prompt,/真正结构资料哨兵/);assert.match(request.prompt,/完整检查方法正文/);assert.doesNotMatch(request.prompt,/不该用于检查的方法正文/);
  assert.deepEqual((request.inputManifest!.skillTrace as any[]).map(t=>[t.id,t.status,t.reason]),[['not-review','SKIPPED','SKIPPED_OPERATION'],['review-method','APPLIED',null]]);
});


test('actual frozen review includes scoped outline and duration without unrelated or adjacent manuscript',async t=>{
  const h=setup(t,document=>{
    document.profile=createScriptCreationProfile('anthology',3,2);const current=document.units[0];current.scopeId='story_a';current.targetDurationMs=45000;current.summary='CURRENT_EPISODE_PLAN';
    const previous=newUnit('前篇',120000,'story_a');previous.scenes[0].blocks[0].text='REVIEW_PREVIOUS_ACTUAL_END';
    const other=newUnit('其他故事',120000,'story_b');other.summary='REVIEW_OTHER_PLAN_FORBIDDEN';other.scenes[0].blocks[0].text='REVIEW_OTHER_BODY_FORBIDDEN';
    document.units=[previous,other,current];document.brief.outline='REVIEW_MIXED_OUTLINE_FORBIDDEN';
    document.storyOutlines=[{scopeId:'story_a',outline:'REVIEW_STORY_A_OUTLINE'},{scopeId:'story_b',outline:'REVIEW_STORY_B_FORBIDDEN'}];
  },2);
  const status=await h.run('script.check_status',{cursor:null,limit:50}),task=(status.step.observation!.data as any).tasks.find((item:any)=>item.phase==='RAW');
  assert.ok(task);const checked=await h.run('script.check_batch',{taskId:task.id});assert.equal(checked.run.status,'SUCCEEDED',JSON.stringify(checked.run));
  assert.equal(h.requests.length,1);assert.doesNotMatch(h.requests[0].prompt,/REVIEW_PREVIOUS_ACTUAL_END/);assert.match(h.requests[0].prompt,/REVIEW_STORY_A_OUTLINE/);
  assert.match(h.requests[0].prompt,/45000/);assert.doesNotMatch(h.requests[0].prompt,/FORBIDDEN/);
  const actual=JSON.parse(/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(h.requests[0].prompt)![1]);
  assert.ok(actual.payload.raw.every((span:any)=>span.unitId===h.w.document.units[2].id),'supplementary predecessor is not claimed as checked raw coverage');
});

function sentEntries(value:any):any[]{
  return Array.isArray(value)?value:value.groups.flatMap((group:any)=>group.blocks.map((row:any[])=>{
    const fields:any=Object.fromEntries(value.columns.map((column:string,index:number)=>[column,row[index]??value.defaults?.[column]]));
    const descriptor=fields.presentation===undefined?{}:value.presentations[fields.presentation];delete fields.presentation;
    return {unitId:group.unitId,sceneId:group.sceneId,...fields,...descriptor};
  }));
}
function originalEntries(value:any,expected:any[]):any[]{
  const aliases=new Map<string,string>(),originals=new Map<string,string>();
  const rows=sentEntries(value);assert.equal(rows.length,expected.length);
  return rows.map((row,index)=>{
    const original=expected[index].blockId;
    if(row.blockId!==original){
      assert.match(row.blockId,/^@+\d+$/);
      if(aliases.has(row.blockId))assert.equal(aliases.get(row.blockId),original);
      if(originals.has(original))assert.equal(originals.get(original),row.blockId);
      aliases.set(row.blockId,original);originals.set(original,row.blockId);
    }
    const {type,speakerId,speakerName,...location}=row;
    if('text' in row)assert.ok(['action','dialogue'].includes(type));
    return {...location,blockId:original};
  });
}
function sentText(value:any,input:any):string{
  if(typeof value==='string')return value;
  const text=value.parts.map((part:any)=>{
    if('text' in part)return part.text;
    assert.equal(value.sectionId,'SCRIPT_CHECK_INPUT');assert.equal(value.path,'payload.outline');
    return input.payload.outline.find((item:any)=>item.id===part.requirementId)[value.field];
  }).join('');
  assert.equal(sha256(text),value.sourceHash);
  return text;
}

test('36-scene review deduplicates RAW and INDEX input while preserving frozen coverage evidence',async t=>{
  const manuscript=(document:ReturnType<typeof createScriptProject>)=>{
    document.brief.outline='甲在渡轮上核对真实名单。'.repeat(310);
    const unit=document.units[0];unit.summary=document.brief.outline;
    unit.scenes=Array.from({length:36},(_,sceneIndex)=>{
      const scene=newScene(`第 ${sceneIndex+1} 场`);
      scene.blocks=Array.from({length:4},(_,blockIndex)=>({id:`block_${sceneIndex}_${blockIndex}`,type:'action' as const,
        text:`第${sceneIndex+1}场第${blockIndex+1}块。`+'船员按已确认的次序撤离。'.repeat(18)}));
      return scene;
    });
  };
  for(const target of [{phase:'RAW',checkId:'local'},{phase:'INDEX',checkId:'story_coverage'},{phase:'RAW',checkId:'story_coverage'}]){
    const h=setup(t,manuscript,0,{maxRawChars:16000,maxIndexEntries:500,storyCoverage:true});
    const status=await h.run('script.check_status',{cursor:null,limit:50});
    const tasks=(status.step.observation!.data as any).tasks as Array<{id:string;phase:string;checkId:string}>;
    const task=tasks.find(item=>item.phase===target.phase&&item.checkId===target.checkId);
    assert.ok(task);
    const c=h.command('script.check_batch',{taskId:task!.id},'external');
    await h.worker.runOnce(c.runId);
    await h.child.runOnce(c.runId);
    assert.equal(h.store.readRun(c.runId).status,'WAITING_EXTERNAL',`${task!.checkId}/${task!.phase}: ${JSON.stringify(h.store.readRun(c.runId).result)}`);
    const request=h.journal.listExternal(c.runId,'author')[0].request;
    const sent=JSON.parse(/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(request.prompt)![1]);
    const step=h.store.getStep(c.runId,1,'operation')!;
    const frozen=(step.prepared.request.input as any).frozen.reviewBatch;
    assert.equal(sent.task.id,frozen.task.id);
    assert.equal(frozen.task.manifestHash,(status.step.observation!.data as any).manifestHash);
    assert.equal((request.inputManifest!.scriptReview as any).payloadHash,hashValue(frozen.payload));
    assert.deepEqual(frozen.payload.raw.map(({text,...span}:any)=>span),frozen.task.requiredRaw);
    assert.deepEqual(frozen.payload.index,frozen.task.requiredIndex);
    assert.deepEqual(originalEntries(sent.payload.raw,frozen.payload.raw),frozen.payload.raw.map(({blockHash:_b,textHash:_t,...span}:any)=>span));
    assert.deepEqual(originalEntries(sent.payload.index,frozen.payload.index),frozen.payload.index.map(({blockHash:_b,textHash:_t,...entry}:any)=>entry));
    const bundle=h.contexts.assertAllowed(request.contextRef!,{ownerId:'author',scopeId:h.w.id,branch:`workspace:${h.w.id}`});
    const writing=JSON.parse(bundle.sections.find(section=>section.id==='required-writing-context')!.text);
    const full=buildRequiredWritingContext(h.w.document,{unitIds:[h.w.document.units[0].id],operation:'review',includeAdjacentBodies:false,
      source:{kind:'WORKSPACE',id:h.w.id,version:h.w.revision}});
    assert.equal(writing.blueprintHash,full.blueprintHash);assert.equal(writing.planningHash,full.planningHash);
    assert.deepEqual(writing.blueprint.planningRef,{sectionId:'required-writing-context',path:'planning'});
    assert.equal(writing.blueprint.brief.outlineRef.path,'planning.outlines');
    assert.equal(sentText(writing.planning.outlines.find((item:any)=>item.kind==='project').outline,sent),h.w.document.brief.outline);
    assert.equal(sentText(writing.planning.units[0].summary,sent),h.w.document.units[0].summary);
    assert.equal(writing.currentUnits[0].summaryRef.path,'planning.units');
    if(writing.outlineRequirements.itemsRef)assert.deepEqual(writing.outlineRequirements.itemsRef,{sectionId:'SCRIPT_CHECK_INPUT',path:'payload.outline'});
    assert.deepEqual((writing.outlineRequirements.items??sent.payload.outline).map((item:any)=>{
      if('text' in item)return item.text;
      const source=sentText(writing.planning.outlines.find((row:any)=>row.scopeId===item.ownerId).outline,sent);
      assert.equal(item.textRef.path,'planning.outlines');
      assert.equal(item.textRef.sectionId,writing.sectionId);
      return source.slice(item.start,item.end);
    }),full.outlineRequirements!.items.map(item=>item.text));
    assert.equal(writing.manuscript.excerpts.length,0);
    if(task!.phase==='RAW'){
      const chars=sentEntries(sent.payload.raw).map((span:any)=>span.text.length).reduce((a:number,b:number)=>a+b,0);
      assert.ok(chars>15000&&chars<=16000);
      for(const span of originalEntries(sent.payload.raw,frozen.payload.raw)){
        const scene=h.w.document.units[0].scenes.find(scene=>scene.id===span.sceneId)!;
        assert.equal(span.text,scene.blocks.find(block=>block.id===span.blockId)!.text.slice(span.start,span.end));
      }
    }
    if(task!.checkId==='story_coverage'){
      assert.deepEqual(frozen.task.requiredOutline,frozen.payload.outline);
      assert.equal(sent.payload.outline.map((item:any)=>item.text).join(''),h.w.document.brief.outline);
    }
  }
});

test('dense 36-scene review preserves every short block within 48k',async t=>{
  // Block lengths reflect seven 15–28-block scene returns sampled from this
  // rehearsal; cycling them to 36 scenes tests location density, not prose.
  const lengths=[
    [79,58,20,25,15,20,71,3,50,9,44,4,9,52,11,6,72,18,7,33,8,6,23,19,5,77],
    [79,46,20,24,13,14,16,39,77,15,58,72,11,6,18,13,81,9,48,22,27,10,22,62],
    [85,63,23,20,85,8,33,27,6,17,33,27,2,70,44],
    [65,76,12,19,6,10,34,13,25,50,9,29,6,11,50],
    [90,55,85,46,19,18,48,11,25,51,44,3,66],
    [77,47,9,76,11,7,32,24,31,10,13,77,17,8,36,11,15,41,8,14,14,20,42,23,47,64,15,70],
    [84,22,13,34,13,12,45,35,7,33,17,12,20,42,27,22,50],
  ];
  const film=JSON.parse(readFileSync(new URL('./fixtures/script-goal-film-scenes-workspace.json',import.meta.url),'utf8'));
  for(const realContext of [false,true])for(const scale of [1,1.32])for(const target of [{phase:'RAW',checkId:'local'},{phase:'RAW',checkId:'story_coverage'},{phase:'INDEX',checkId:'story_coverage'}]){
    const manuscript=(document:ReturnType<typeof createScriptProject>)=>{
      if(realContext)Object.assign(document,structuredClone(film.document),{revision:0});
      else{
        document.brief.outline='甲在渡轮上核对真实名单。'.repeat(310);
        document.units[0].summary='全片大纲与分场在本次检查中保持原始完整。'.repeat(180);
      }
      document.units[0].scenes=Array.from({length:36},(_,sceneIndex)=>{
        const scene=newScene(`第 ${sceneIndex+1} 场`);
        scene.blocks=lengths[sceneIndex%lengths.length].map((length,blockIndex)=>({id:`block_${sha256(`${sceneIndex}:${blockIndex}`).slice(0,48)}`,
          type:realContext&&blockIndex%2?'dialogue' as const:'action' as const,text:'船'.repeat(Math.round(length*scale)),
          ...(realContext&&blockIndex%2?{speakerId:document.characters[sceneIndex%4].id}:{})}));
        return scene;
      });
    };
    const h=setup(t,manuscript,0,{maxRawChars:16000,maxIndexEntries:500,storyCoverage:true});
    const status=await h.run('script.check_status',{cursor:null,limit:50});
    const task=(status.step.observation!.data as any).tasks.find((item:any)=>item.phase===target.phase&&item.checkId===target.checkId);
    const c=h.command('script.check_batch',{taskId:task.id},'external');
    if(realContext)Object.assign(h.settings.get(c.runId)!,{methods:film.skillManifest,authorRequest:film.objective});
    await h.worker.runOnce(c.runId);await h.child.runOnce(c.runId);
    const chars=h.w.document.units[0].scenes.flatMap(scene=>scene.blocks).reduce((sum,block)=>sum+block.text.length,0);
    const count=h.w.document.units[0].scenes.flatMap(scene=>scene.blocks).length;
    const state=h.store.readRun(c.runId);
    assert.equal(state.status,'WAITING_EXTERNAL',`${target.checkId}/${target.phase} ${JSON.stringify(state.result)}`);
    const request=h.journal.listExternal(c.runId,'author')[0].request;
    const sent=JSON.parse(/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(request.prompt)![1]);
    const frozen=(h.store.getStep(c.runId,1,'operation')!.prepared.request.input as any).frozen.reviewBatch;
    assert.deepEqual(originalEntries(sent.payload.raw,frozen.payload.raw),frozen.payload.raw.map(({blockHash:_b,textHash:_t,...span}:any)=>span));
    assert.deepEqual(originalEntries(sent.payload.index,frozen.payload.index),frozen.payload.index.map(({blockHash:_b,textHash:_t,...entry}:any)=>entry));
  }
});

test('batch aliases restore original finding and outline evidence IDs without accepting invalid locations',async t=>{
  for(const checkId of ['local','story_coverage'])for(const variant of ['valid','unknown-alias','wrong-scene','outside-span']){
    const h=setup(t,document=>{
      document.units[0].summary='船员核对名单后放行。';
      const scene=document.units[0].scenes[0];
      scene.blocks=Array.from({length:65},(_,index)=>({id:`block_${index}`,type:'action' as const,text:'船员核对名单。'}));
      const other=newScene('另一个场景');other.blocks[0].text='另一处原文。';document.units[0].scenes.push(other);
    },0,{maxRawChars:16000,maxIndexEntries:500,storyCoverage:true});
    const status=await h.run('script.check_status',{cursor:null,limit:50});
    const task=(status.step.observation!.data as any).tasks.find((item:any)=>item.phase==='RAW'&&item.checkId===checkId);
    h.setOutput(request=>{
      const sent=JSON.parse(/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(request.prompt)![1]);
      const span=sentEntries(sent.payload.raw)[0];assert.equal(span.blockId,'@1');
      const source={unitId:span.unitId,sceneId:variant==='wrong-scene'?h.w.document.units[0].scenes[1].id:span.sceneId,
        blockId:variant==='unknown-alias'?'@999':span.blockId,start:span.start,end:variant==='outside-span'?span.end+1:span.end};
      return {text:JSON.stringify({summary:'机械定位验证',findings:checkId==='local'?[{id:'location',issue:'机械检查问题',suggestion:'核对原文',severity:'ADVISORY',basis:'RAW',source,uncertainty:''}]:[],resolvedFindingIds:[],
        ...(checkId==='story_coverage'?{outlineCoverage:sent.payload.outline.map((item:any)=>({requirementId:item.id,status:'DRAFT_READY',reason:'机械证据链验证',
          evidence:[{sceneId:source.sceneId,blockId:source.blockId,start:source.start,end:source.end}]}))}:{})}),provenance:{channel:'provider'}};
    });
    const checked=await h.run('script.check_batch',{taskId:task.id});
    assert.equal(checked.run.status,variant==='valid'?'SUCCEEDED':'FAILED',`${checkId}/${variant}`);
    const saved=JSON.parse((h.db.prepare('SELECT data_json FROM script_check_results').get() as any).data_json);
    assert.match(saved.raw,variant==='unknown-alias'?/@999/:/@1/,'the actual unnormalized response is preserved');
    if(variant==='valid'){
      const actual=checkId==='local'?saved.receipt.findings[0].source:saved.receipt.outlineCoverage[0].evidence[0];
      assert.equal(actual.blockId,'block_0');assert.equal(actual.sceneId,h.w.document.units[0].scenes[0].id);
      assert.equal(saved.receipt.input.raw[0].blockId,'block_0');assert.equal(saved.error,null);
    }else{assert.equal(saved.receipt.status,'FAILED');assert.ok(saved.error);}
  }
});

test('frozen review RAW retains block types and actual speakers in flat and grouped input',async t=>{
  for(const count of [3,66]){
    const h=setup(t,document=>{
      document.characters=[{id:'speaker_one',scopeId:document.id,name:'梁平',bio:'',desire:'',need:'',contradiction:'',arc:'',voice:''}];
      document.units[0].scenes[0].blocks=Array.from({length:count},(_,index)=>index%3===0?
        {id:`b_${index}`,type:'action',text:'他按住纸角。'}:index%3===1?
        {id:`b_${index}`,type:'dialogue',text:'先等回报。',speakerId:'speaker_one'}:
        {id:`b_${index}`,type:'dialogue',text:'收到。',speakerName:'电台·值守员'});
    },0,{maxRawChars:16000,maxIndexEntries:500});
    const status=await h.run('script.check_status',{cursor:null,limit:50});
    const task=(status.step.observation!.data as any).tasks.find((item:any)=>item.phase==='RAW'&&item.checkId==='local');
    h.setOutput(request=>{
      const sent=JSON.parse(/SCRIPT_CHECK_INPUT\n([^]*?)\nEND_SCRIPT_CHECK_INPUT/.exec(request.prompt)![1]),rows=sentEntries(sent.payload.raw);
      assert.equal(rows.length,count);
      for(const [index,block] of h.w.document.units[0].scenes[0].blocks.entries()){
        assert.equal(rows[index].text,block.text);assert.equal(rows[index].type,block.type);
        assert.equal(rows[index].speakerId,block.speakerId);
        assert.equal(rows[index].speakerName,block.speakerName??(block.speakerId?'梁平':undefined));
      }
      return {text:raw(),provenance:{channel:'provider'}};
    });
    const checked=await h.run('script.check_batch',{taskId:task.id});assert.equal(checked.run.status,'SUCCEEDED');assert.equal(h.sendCount(),1);
  }
});
