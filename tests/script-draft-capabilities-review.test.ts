import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal, SqliteGoalStore, SqliteBudgetStore } from '../packages/agent-sqlite/src';
import { CapabilityRegistry, hashValue, type ExecutionToken, type ModelRequest } from '../packages/agent-core/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore, type ScriptReadSource } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { ScriptDraftStore } from '../apps/api/src/repositories/scriptDraftStore';
import { createScriptDraftAuthorization, registerScriptDraftCapabilities } from '../apps/api/src/agent/scriptDraftCapabilities';
import { validateScriptDraftScope, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { defaultScriptChecks, scriptGoalEnvelope } from '../packages/script/src/agentGoal';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import type { MethodBinding } from '../packages/script/src/schema';

// These accepted CALLs are mechanical protocol fixtures, not simulated creative/model decisions.
function acceptMechanicalCall(goals:SqliteGoalStore,token:ExecutionToken,capabilityId:string,input:unknown){
 const turn=goals.openTurn(token),sampling=goals.saveSampling(token,{turnId:turn.id,index:turn.nextDecisionIndex,allowedToolsDigest:hashValue('MECHANICAL_ALLOWED'),modelRequest:{operationKey:`decision:${turn.id}:${turn.nextDecisionIndex}`,channel:'api',routeRef:'fixture:protocol-only',prompt:'MECHANICAL_CALL_FIXTURE'}});
 return goals.acceptDecision(token,sampling.id,{kind:'CALL',capabilityId,capabilityVersion:'1',arguments:input,planUpdate:null});
}
function setup(t:any,invalidMetadata=false){
 const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
 const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','capability-review');
 const scripts=createScriptRepository(db);scripts.ensureSchema();let drafts:ScriptDraftStore;
 const contexts=new SqliteContextStore(store,(dep,access)=>{
   if(new URL(dep.ref.uri).pathname.startsWith('/read-grants/'))return authorizations.sourceAllowed(dep,access);
   return workspaces.sourceAllowed(dep.ref,access,dep.freshness);
 });contexts.ensureSchema();
 const workspaces=new ScriptWorkspaceStore(store,scripts,{
   assertVersion:(id,revision,phase)=>contexts.assertArtifact('script-workspace-version',`${id}:${revision}`,phase),
   assertModelWrite:input=>drafts.assertWorkspaceWrite(input),
   bindModelVersion:(workspace,ref)=>contexts.bindEvidenceArtifact('script-workspace-version',`${workspace.id}:${workspace.revision}`,ref,{ownerId:workspace.ownerId,scopeId:workspace.id,branch:`workspace:${workspace.id}`}),
 });workspaces.ensureSchema();
 const document=createScriptProject('MECHANICAL',createScriptCreationProfile('short-film',1,3));
 document.storylines=[{id:'mechanical_storyline',scopeId:document.id,lane:'A',title:'REQUESTED_STRUCTURE_SENTINEL',premise:'MECHANICAL_PLAN_NOT_FACT',resolution:''}];
 document.continuityTracks=[{id:'mechanical_track',scopeId:document.id,kind:'prop',perspective:'audience',label:'REQUESTED_CONTINUITY_SENTINEL',characterIds:[],initialValue:'MECHANICAL_INITIAL',changes:[]}];
 const w=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}});
 const sourceDocument=createScriptProject('MECHANICAL_PREVIOUS',createScriptCreationProfile('tv-series',2,20));sourceDocument.units.push(newUnit('MECHANICAL_SECOND',1200000,sourceDocument.id));
 const previous=scripts.saveProject(sourceDocument,0);
 const source:ScriptReadSource={ref:{uri:`resource://script/projects/${previous.id}`,version:String(previous.revision),contentHash:hashValue(previous),branch:'author'},access:{ownerId:'author',scopeId:previous.id,branch:'author'},purpose:'PREVIOUS_SCRIPT',unitIds:null};
 const authorizations=new ScriptAuthorizationStore(store,workspaces,{validateScope:(scope,workspace)=>validateScriptDraftScope(workspace.document,scope as ScriptDraftScope),readSource:selected=>{
   authorizations.assertSourceIntersection(selected);const saved=scripts.readProjectInput(selected.access.scopeId,Number(selected.ref.version));
   assert.ok(saved&&scripts.getProject(saved.id));assert.equal(hashValue(saved),selected.ref.contentHash);
   scripts.captureProjectInput(saved);
   return {id:saved.id,units:saved.units.filter(unit=>selected.unitIds===null||selected.unitIds.includes(unit.id))};
 }});authorizations.ensureSchema();
 const journal=new SqliteModelJournal(store,(request,run,phase)=>authorizations.withRunAuthorization(run,phase,()=>{
   const auth=authorizations.forRun(run,phase),access={ownerId:run.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`};
   assert.ok(request.contextRef);const bundle=phase==='VIEW'?contexts.assertVisible(request.contextRef,access):contexts.assertAllowed(request.contextRef,access);
   assert.equal(request.prompt,bundle.prompt);assert.equal(request.systemInstruction,bundle.systemInstruction);
   assert.equal(hashValue(request.outputSchema),hashValue(bundle.outputSchema));
 }));journal.ensureSchema();drafts=new ScriptDraftStore(store,workspaces,authorizations,contexts,journal);drafts.ensureSchema();
 const sent:ModelRequest[]=[];
 const transport={sendOnce:async(request:ModelRequest)=>{sent.push(request);return {text:JSON.stringify({summary:'MECHANICAL_PROTOCOL',content:'MECHANICAL_NEXT_CONCEPT'}),provenance:{channel:'provider' as const,producer:'Mechanical protocol constant; no creative generation'},...(invalidMetadata?{validationErrors:['MECHANICAL_INVALID_METADATA']}:{} )};}};
 const methods:MethodBinding[]=[{id:'method_mechanical',title:'机械协议方法',version:'frozen-v1',content:'SKILL_BEGIN\n'+('FULL_METHOD_LINE\n'.repeat(400))+'SKILL_END',usage:{operations:['concept' as const],inputs:['continuity' as const],note:'USE_CONFIGURATION_SENTINEL'}}];
 const registry=new CapabilityRegistry({assertExecution:async context=>{store.assertExecution(context.execution);},authorize:createScriptDraftAuthorization({store,journal,authorizations,drafts})});
 registerScriptDraftCapabilities(registry,{store,contexts,journal,authorizations,workspaces,drafts,transport,executionSettings:()=>({channel:'api',routeRef:'fixture:protocol-only',methods,authorRequest:'MECHANICAL_AUTHOR_REQUIREMENT'})},hashValue('script-draft-independent-review'));
 function issue(name:string,sources:ScriptReadSource[]=[]){const workspace=workspaces.read(w.id,'author'),scope:ScriptDraftScope={workspaceId:w.id,documentId:workspace.documentId,originRevision:workspace.revision,originContentHash:hashValue(workspace.document),operations:['concept'],units:[{unitId:workspace.document.units[0].id,allowSummary:false,allowAllScenes:false,maxNewScenes:0,scenes:[]}],newUnitSlots:[],sharedFields:['concept'],characterScopeIds:[],factScopeIds:[]};
  const auth=authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:w.id,commandId:name,scope,sources});return auth;
 }
 function start(name:string){const auth=issue(name);
  const accepted=store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:name,kind:'CAPABILITY',input:{authorizationRef:auth.id},policyRevision:'1',maxInvocations:3});
  authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});const claim=store.claim(name,30000,accepted.runId)!;return {auth,claim};
 }
 const context=(execution:ExecutionToken)=>({ownerId:'author',scopeId:'script:home',commandRevision:String(execution.inputRevision),policyRevision:'1',execution,signal:new AbortController().signal});
 async function propose(started?:ReturnType<typeof start>,goals?:SqliteGoalStore){const {auth,claim}=started??start('propose');const input={authorizationRef:auth.id,operation:'concept',instruction:'MECHANICAL_INSTRUCTION',unitId:null,sceneId:null,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null};
  const decision=goals?acceptMechanicalCall(goals,claim.token,'script.propose',input):null;
  const prepared=await registry.prepare({capabilityId:'script.propose',capabilityVersion:'1',callId:decision?.callId??'propose',input},context(claim.token));
  const step=store.savePrepared(claim.token,prepared);store.handoff(claim.token,step.id);const child=store.claimChild('child',30000,claim.run.id)!;
  const receipt=await registry.execute(prepared,context(child.token));
  if(goals&&decision){store.completeChild(child.token);const resumed=store.claim('parent-resume',30000,claim.run.id)!;goals.consumeReceipt(resumed.token,decision.id,step.id);store.finish(resumed.token,'SUCCEEDED',receipt);}
  else store.finish(child.token,'SUCCEEDED',receipt);return {receipt,prepared};
 }
 return {db,store,workspaces,w,registry,start,context,propose,sent,issue,authorizations,contexts,drafts,source,thread,previous,methods};
}

test('actual propose capability uses complete fixed Skill content and configuration without modifying the draft',async t=>{
 const h=setup(t),result=await h.propose();assert.equal(result.receipt.status,'SUCCEEDED');assert.equal(h.sent.length,1);
 const request=h.sent[0];assert.ok(request.prompt.includes('SKILL_BEGIN'));assert.ok(request.prompt.includes('SKILL_END'));assert.ok(request.prompt.includes('USE_CONFIGURATION_SENTINEL'));
 assert.equal((request.inputManifest!.skillTrace as any[])[0].version,'frozen-v1');assert.equal(h.workspaces.read(h.w.id,'author').revision,1);
});
test('actual apply capability prepares the exact persisted candidate source required by the draft repository',async t=>{
 const h=setup(t),p=await h.propose(),candidateId=(p.receipt.data as any).candidateId;
 const {auth,claim}=h.start('apply'),workspace=h.workspaces.read(h.w.id,'author');h.workspaces.bindWriter({workspaceId:h.w.id,ownerId:'author',runId:claim.run.id,expectedEpoch:workspace.writerEpoch});
 const prepared=await h.registry.prepare({capabilityId:'script.apply_patch',capabilityVersion:'1',callId:'apply',input:{authorizationRef:auth.id,candidateId,expectedRevision:workspace.revision,writerEpoch:workspace.writerEpoch}},h.context(claim.token));
 const step=h.store.savePrepared(claim.token,prepared),receipt=await h.registry.execute(prepared,h.context({...claim.token,stepId:step.id}));
 assert.equal(receipt.status,'SUCCEEDED');assert.equal(h.workspaces.read(h.w.id,'author').document.brief.concept,'MECHANICAL_NEXT_CONCEPT');assert.equal(h.sent.length,1);
 await h.registry.attestReceipt(prepared,h.context({...claim.token,stepId:step.id}));
 h.contexts.revokeScope({ownerId:'author',scopeId:h.w.id,branch:`workspace:${h.w.id}`});
 await assert.rejects(()=>h.registry.attestReceipt(prepared,h.context({...claim.token,stepId:step.id})),'worker receipt replay must not bypass the candidate evidence guard');
});

for(const narrowed of [false,true])test(`an old Goal revision candidate ${narrowed?'cannot cross a narrower source grant':'can be adopted under an equivalent new source grant'}`,async t=>{
 const h=setup(t),goals=new SqliteGoalStore(h.store,new SqliteBudgetStore(h.store));goals.ensureSchema();
 const original=h.issue('goal-old',[h.source]);
 const revision=(auth:typeof original,objective='MECHANICAL_GOAL')=>({objective,contract:scriptGoalEnvelope({workspaceId:h.w.id,documentId:h.w.documentId,task:'WRITE',scope:auth.scope as ScriptDraftScope,checks:defaultScriptChecks([h.w.document.units[0].id]),strategy:{id:'SCRIPT_GOAL_V1',maxNoProgressStreak:3}}),authorizationRef:auth.id,workspaceRef:auth.workspaceRef,sourceRefs:[h.source.ref],skillManifest:[],route:{channel:'api' as const,routeRef:'fixture:protocol-only'},stopPolicy:'CONTRACT_COMPLETE' as const,turnLimits:{maxDecisions:5,maxToolCalls:5}});
 const accepted=goals.accept({...revision(original),ownerId:'author',scopeId:'script:home',threadId:h.thread.id,requestId:'goal-old',requestEnvelope:{mechanical:1},policyRevision:'1',budgetLimits:{maxInvocations:5,maxToolCalls:5,maxTurns:5,maxRepairRounds:2}});
 h.authorizations.bind(original.id,'author',{kind:'GOAL',goalId:accepted.goalId,revision:1});
 const claim=h.store.claim('goal-old',30000,accepted.runId)!,p=await h.propose({auth:original,claim},goals);
 const candidateId=(p.receipt.data as any).candidateId,candidate=h.drafts.readCandidate('author',candidateId);
 const next=h.issue('goal-next',[narrowed?{...h.source,unitIds:[h.previous.units[0].id]}:h.source]);
 const revised=goals.revise({goalId:accepted.goalId,ownerId:'author',requestId:'goal-next',requestEnvelope:{mechanical:2},expectedVersion:goals.read(accepted.goalId,'author').version,expectedRunVersion:h.store.readRun(accepted.runId).version,revision:revision(next,'MECHANICAL_GOAL_REVISED')});
 h.authorizations.bind(next.id,'author',{kind:'GOAL',goalId:accepted.goalId,revision:2});
 const access={ownerId:'author',scopeId:h.w.id,branch:`workspace:${h.w.id}`};
 assert.throws(()=>h.contexts.assertAllowed(candidate.contextRef,access),'the old CURRENT grant really has stopped being executable');
 const newer=h.store.claim('goal-next',30000,revised.runId)!,workspace=h.workspaces.read(h.w.id,'author');
 h.workspaces.bindWriter({workspaceId:h.w.id,ownerId:'author',runId:newer.run.id,expectedEpoch:workspace.writerEpoch});
 const request={capabilityId:'script.apply_patch',capabilityVersion:'1',callId:'apply-old-candidate',input:{authorizationRef:next.id,candidateId,expectedRevision:workspace.revision,writerEpoch:workspace.writerEpoch}};
 request.callId=acceptMechanicalCall(goals,newer.token,'script.apply_patch',request.input).callId!;
 if(narrowed){await assert.rejects(()=>h.registry.prepare(request,h.context(newer.token)));assert.equal(h.workspaces.read(h.w.id,'author').revision,1);return;}
 const prepared=await h.registry.prepare(request,h.context(newer.token)),step=h.store.savePrepared(newer.token,prepared);
 const result=await h.registry.execute(prepared,h.context({...newer.token,stepId:step.id}));
 assert.equal(result.status,'SUCCEEDED');assert.equal(h.workspaces.read(h.w.id,'author').revision,2);assert.equal(h.sent.length,1);
 h.contexts.revokeScope(access);assert.throws(()=>h.workspaces.read(h.w.id,'author'),'inherited evidence remains revocable after adoption');
});

test('metadata-invalid received draft results still produce a preserved invalid candidate receipt',async t=>{
 const h=setup(t,true),p=await h.propose();assert.equal(p.receipt.status,'FAILED');
 const row=h.db.prepare('SELECT data_json FROM script_draft_candidates').get() as any;
 assert.ok(row);const record=JSON.parse(row.data_json);assert.equal(record.status,'INVALID');assert.match(record.raw,/MECHANICAL_NEXT_CONCEPT/);
 assert.equal((h.db.prepare('SELECT status FROM agent_invocations').get() as any).status,'RECEIVED');assert.equal(h.sent.length,1);
 assert.equal(h.workspaces.read(h.w.id,'author').revision,1);
});

test('Skill applicability configuration excludes a review-only method from concept writing',async t=>{
 const h=setup(t);h.methods[0].usage!.operations=['review'];await h.propose();
 assert.equal(/SKILL_BEGIN|SKILL_END/.test(h.sent[0].prompt),false,'review-only Skill must not be applied to concept writing');
 assert.ok(!(h.sent[0].inputManifest!.skillTrace as any[]).some(trace=>trace.id==='method_mechanical'&&trace.status==='APPLIED'));
});
test('Skill requested structure and continuity inputs are supplied as actual scoped records',async t=>{
 const h=setup(t);h.methods[0].usage!.inputs=['structure','continuity'];await h.propose();
 assert.ok(h.sent[0].prompt.includes('REQUESTED_STRUCTURE_SENTINEL'),'requested structure records are missing');assert.ok(h.sent[0].prompt.includes('REQUESTED_CONTINUITY_SENTINEL'),'requested continuity records are missing');
});
