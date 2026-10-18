import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { formatCorrectionRequest, hashValue, type ExecutionToken, type PreparedCall } from '../packages/agent-core/src';
import { AgentSqliteStore, SqliteContextStore, SqliteConversationStore, SqliteModelJournal } from '../packages/agent-sqlite/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { ScriptWorkspaceStore, workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { ScriptAuthorizationStore } from '../apps/api/src/repositories/scriptAuthorizationStore';
import { ScriptDraftStore } from '../apps/api/src/repositories/scriptDraftStore';
import { agentDraftOutputSchema } from '../packages/script/src/agentDraft';
import { validateScriptDraftScope, type ScriptDraftScope } from '../packages/script/src/agentScope';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const prepared=(callId:string,input:unknown,run:any,sources:any[]=[],targets:any[]=[]):PreparedCall=>{
  const value={request:{capabilityId:(input as any).candidateId?'script.apply_patch':'script.propose',capabilityVersion:'1',callId,input},implementationDigest:hashValue('mechanical'),
    contractDigest:hashValue('mechanical'),inputDigest:hashValue(input),binding:{ownerId:run.ownerId,scopeId:run.scopeId,
      commandRevision:String(run.generation),policyRevision:run.policyRevision},sources,targets};
  return {...value,preparedDigest:hashValue(value)};
};
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','draft-tests');
  const scripts=createScriptRepository(db);scripts.ensureSchema();
  let drafts:ScriptDraftStore,bindFails=false;
  const contexts=new SqliteContextStore(store,()=>true);contexts.ensureSchema();
  const workspaces=new ScriptWorkspaceStore(store,scripts,{
    assertVersion:(id,revision,phase)=>contexts.assertArtifact('script-workspace-version',`${id}:${revision}`,phase),
    assertModelWrite:input=>drafts.assertWorkspaceWrite(input),
    bindModelVersion:(workspace,ref)=>{contexts.bindArtifact('script-workspace-version',`${workspace.id}:${workspace.revision}`,ref,
      {ownerId:workspace.ownerId,scopeId:workspace.id,branch:`workspace:${workspace.id}`});if(bindFails)throw new Error('injected binding fault');},
  });workspaces.ensureSchema();
  const document=createScriptProject('机械候选仓储',createScriptCreationProfile('tv-series',2,20));
  const workspace=workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}});
  const scope:ScriptDraftScope={workspaceId:workspace.id,documentId:workspace.document.id,originRevision:workspace.revision,
    originContentHash:hashValue(workspace.document),operations:['concept'],units:[],newUnitSlots:[],
    sharedFields:['concept'],characterScopeIds:[],factScopeIds:[]};
  const authorizations=new ScriptAuthorizationStore(store,workspaces,{validateScope:(value,w)=>validateScriptDraftScope(w.document,value as ScriptDraftScope),readSource:()=>{throw new Error('unused');}});authorizations.ensureSchema();
  const journal=new SqliteModelJournal(store,(request,run,phase)=>{const auth=authorizations.forRun(run,phase);
    if(!request.contextRef)throw new Error('context required');
    contexts.assertAllowed(request.contextRef,{ownerId:run.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`});
  });journal.ensureSchema();
  drafts=new ScriptDraftStore(store,workspaces,authorizations,contexts,journal);drafts.ensureSchema();
  const authorize=(name:string)=>{
    const latest=workspaces.read(workspace.id,'author');
    const currentScope={...scope,originRevision:latest.revision,originContentHash:hashValue(latest.document)};
    const auth=authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId:name,scope:currentScope,sources:[]});
    const accepted=store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:name,kind:'CAPABILITY',
      input:{authorizationRef:auth.id},policyRevision:'1',maxInvocations:2});
    authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});return {auth,runId:accepted.runId};
  };
  const context=contexts.capture({ownerId:'author',scopeId:workspace.id,branch:`workspace:${workspace.id}`},
    compileContext({systemInstruction:'机械协议',sections:[{id:'base',text:'工作稿原文',required:true,priority:1,dependencies:[]}],skills:[]}));
  const propose=(raw:string,name='propose',correctionRaw?:string)=>{
    const {auth,runId}=authorize(name),claim=store.claim(name,30000,runId)!;
    const baseRef=workspaceRef(workspaces.read(workspace.id,'author'));
    const manifest={authorizationRef:auth.id,workspaceRef:baseRef,operation:'concept'};
    const model={operationKey:`${name}:model`,channel:'api' as const,routeRef:'mechanical',prompt:'机械生成概念',
      outputSchema:agentDraftOutputSchema('concept'),inputManifest:{scriptDraft:manifest,authorInstruction:'写概念'},contextRef:context};
    const input={authorizationRef:auth.id,operation:'concept',instruction:'写概念',unitId:null,sceneId:null,slotId:null,
      scopeId:null,blockIds:null,selection:null,frozen:{model,baseRef}};
    const step=store.savePrepared(claim.token,prepared(`${name}:call`,input,claim.run,[baseRef],[]));
    const token={...claim.token,stepId:step.id};
    const invocation=journal.prepare(token,model),attempt=journal.startAttempt(token,invocation.id);
    journal.recordResult(invocation.id,attempt.attemptId,{text:raw,provenance:{channel:'provider',model:'mechanical-fixture'}});
    if(correctionRaw!==undefined){
      const correction=journal.prepare(token,formatCorrectionRequest(journal.read(invocation.id))),correctionAttempt=journal.startAttempt(token,correction.id);
      journal.recordResult(correction.id,correctionAttempt.attemptId,{text:correctionRaw,provenance:{channel:'provider',model:'mechanical-fixture'}});
    }
    const receipt=drafts.recordResult({token,invocationId:invocation.id});
    return {receipt,token,invocation,step,auth,runId};
  };
  const apply=(candidateId:string,name='apply')=>{
    const {auth,runId}=authorize(name),before=workspaces.read(workspace.id,'author');
    workspaces.bindWriter({workspaceId:workspace.id,ownerId:'author',runId,expectedEpoch:before.writerEpoch});
    const claim=store.claim(name,30000,runId)!;
    const candidate=drafts.readCandidate('author',candidateId),ref={uri:`resource://script/draft-candidates/${candidate.id}`,version:'1',contentHash:hashValue(candidate),branch:`workspace:${workspace.id}`};
    const input={authorizationRef:auth.id,candidateId,expectedRevision:before.revision,writerEpoch:before.writerEpoch};
    const step=store.savePrepared(claim.token,prepared(`${name}:call`,input,claim.run,[ref],[workspaceRef(before)]));
    return {token:{...claim.token,stepId:step.id} as ExecutionToken,step,runId};
  };
  return {db,store,scripts,workspace,workspaces,contexts,drafts,propose,apply,setBindingFault:(value:boolean)=>{bindFails=value;}};
}

test('actual invocation is preserved as a candidate, separate apply uses a new grant and atomically commits workspace, receipt and ledger',t=>{
  const h=setup(t),raw=JSON.stringify({summary:'机械摘要',content:'新的概念'}),p=h.propose(raw);
  const id=(p.receipt.data as any).candidateId;
  assert.equal(p.receipt.effectState,'CANDIDATE_PRESERVED');assert.equal(h.workspaces.read(h.workspace.id,'author').revision,1);
  const record=h.drafts.readCandidate('author',id);assert.equal(record.raw,raw);assert.equal(record.modelInputHash,p.invocation.inputHash);
  assert.deepEqual(h.drafts.recordResult({token:p.token,invocationId:p.invocation.id}),p.receipt);
  h.store.finish(p.token,'SUCCEEDED',p.receipt);
  const a=h.apply(id),receipt=h.drafts.apply({token:a.token});
  assert.equal(receipt.status,'SUCCEEDED');assert.equal(h.workspaces.read(h.workspace.id,'author').document.brief.concept,'新的概念');
  assert.equal(h.store.getStep(a.runId,1,a.step.prepared.request.callId)!.status,'COMMITTED');
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_applications').get() as any).n,1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_ledgers').get() as any).n,1);
  assert.deepEqual(h.drafts.readApplication(receipt.artifacts[0],'author'),{candidateId:id,workspaceId:h.workspace.id,
    beforeRevision:1,afterRevision:2,runId:a.runId,stepId:a.step.id,authorizationRef:(a.step.prepared.request.input as any).authorizationRef,ref:receipt.artifacts[0]});
  assert.throws(()=>h.drafts.readApplication(p.receipt.artifacts[0],'author'),/精确工作稿版本/);
  assert.deepEqual(h.drafts.apply({token:a.token}),receipt);
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,2);
  assert.equal(h.scripts.listProjects().length,0);
});

test('invalid model JSON keeps exact raw evidence and cannot be applied',t=>{
  const h=setup(t),raw='{"summary":"机械摘要","content":"概念","timingEvidence":[1]}',p=h.propose(raw);
  const id=(p.receipt.data as any).candidateId,record=h.drafts.readCandidate('author',id);
  assert.equal(p.receipt.status,'FAILED');assert.equal(record.status,'INVALID');assert.equal(record.raw,raw);
  h.store.finish(p.token,'PARTIAL',p.receipt);
  const a=h.apply(id);assert.throws(()=>h.drafts.apply({token:a.token}),/无效|候选/);
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,1);
});

test('binding failure rolls back workspace, version source, Step and ledger; author edit after proposal rejects stale base',t=>{
  const h=setup(t),p=h.propose(JSON.stringify({summary:'机械摘要',content:'新概念'}));
  const id=(p.receipt.data as any).candidateId;h.store.finish(p.token,'SUCCEEDED',p.receipt);
  const a=h.apply(id);h.setBindingFault(true);
  const candidate=h.drafts.readCandidate('author',id),base=h.workspaces.read(h.workspace.id,'author');
  assert.throws(()=>h.workspaces.applyFromRun({workspaceId:base.id,ownerId:'author',token:a.token,
    callId:a.step.prepared.request.callId,expectedRevision:base.revision,writerEpoch:base.writerEpoch,
    patch:candidate.candidate!.patch,contextRef:candidate.contextRef}),/同事务采用路径/);
  assert.throws(()=>h.drafts.apply({token:a.token}),/injected binding fault/);
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,1);
  assert.equal(h.store.getStep(a.runId,1,a.step.prepared.request.callId)!.status,'PREPARED');
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_ledgers').get() as any).n,0);
  assert.equal(h.contexts.hasArtifact('script-workspace-version',`${h.workspace.id}:2`),false);
  h.setBindingFault(false);h.drafts.apply({token:a.token});
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,2);
});

test('author revision after candidate preparation rejects adoption without changing the author draft',t=>{
  const h=setup(t),p=h.propose(JSON.stringify({summary:'机械摘要',content:'候选概念'}));
  const id=(p.receipt.data as any).candidateId;h.store.finish(p.token,'SUCCEEDED',p.receipt);
  const before=h.workspaces.read(h.workspace.id,'author'),edited=structuredClone(before.document);edited.brief.concept='作者改稿';
  h.workspaces.saveAuthor({workspaceId:before.id,ownerId:'author',requestId:'author-edit',expectedRevision:before.revision,
    expectedEpoch:before.writerEpoch,document:edited});
  const a=h.apply(id);
  assert.throws(()=>h.drafts.apply({token:a.token}),/基线|当前工作稿|候选/);
  assert.equal(h.workspaces.read(h.workspace.id,'author').document.brief.concept,'作者改稿');
});

test('committed proposal and apply receipts require historical context visibility on replay',t=>{
  const h=setup(t),p=h.propose(JSON.stringify({summary:'机械摘要',content:'候选概念'}));
  const id=(p.receipt.data as any).candidateId;
  const access={ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`};
  const memory=h.contexts.createMemory(access,'author','memory-for-revocation',{key:'author.protocol',kind:'AUTHOR_PREFERENCE',
    content:{label:'机械记忆',value:'撤回测试'},dependencies:[]});
  h.contexts.updateMemory(access,'withdraw',memory.id,1,'DELETE');
  assert.throws(()=>h.drafts.recordResult({token:p.token,invocationId:p.invocation.id}),/撤回|CONTEXT_REVOKED/);
  assert.equal(h.workspaces.read(h.workspace.id,'author').revision,1);
});

test('committed apply receipt cannot be replayed after candidate source withdrawal',t=>{
  const h=setup(t),p=h.propose(JSON.stringify({summary:'机械摘要',content:'候选概念'}));
  const id=(p.receipt.data as any).candidateId;h.store.finish(p.token,'SUCCEEDED',p.receipt);
  const a=h.apply(id);h.drafts.apply({token:a.token});
  const access={ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`};
  const memory=h.contexts.createMemory(access,'author','memory-for-revocation',{key:'author.protocol',kind:'AUTHOR_PREFERENCE',
    content:{label:'机械记忆',value:'撤回测试'},dependencies:[]});
  h.contexts.updateMemory(access,'withdraw',memory.id,1,'DELETE');
  assert.throws(()=>h.drafts.apply({token:a.token}),/撤回|CONTEXT_REVOKED/);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_applications').get() as any).n,1);
});


test('corrected draft stores both provenance and candidate, then applies through the existing authorization',t=>{
  const h=setup(t),raw=JSON.stringify({summary:'机械摘要',content:'经过纠正的概念'}),p=h.propose('malformed original','corrected',raw);
  const candidate=h.drafts.readCandidate('author',(p.receipt.data as any).candidateId);
  assert.equal(candidate.raw,raw);assert.ok((candidate.modelResult as any).correctionInvocationId);
  assert.equal(JSON.parse((h.db.prepare('SELECT result_json FROM agent_invocations WHERE id=?').get(p.invocation.id) as any).result_json).text,'malformed original');
  h.store.finish(p.token,'SUCCEEDED',p.receipt);
  const a=h.apply(candidate.id);assert.equal(h.drafts.apply({token:a.token}).status,'SUCCEEDED');
  assert.equal(h.workspaces.read(h.workspace.id,'author').document.brief.concept,'经过纠正的概念');
});
