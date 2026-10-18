import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type ExecutionToken, type PreparedCall } from '../packages/agent-core/src';
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

const prepared=(callId:string,input:unknown,run:any,sources:any[]=[],targets:any[]=[]):PreparedCall=>{const basis={
  request:{capabilityId:'script.draft.test',capabilityVersion:'1',callId,input},implementationDigest:'mechanical',
  contractDigest:'mechanical',inputDigest:hashValue(input),binding:{ownerId:run.ownerId,scopeId:run.scopeId,
    commandRevision:String(run.generation),policyRevision:run.policyRevision},sources,targets
};return {...basis,preparedDigest:hashValue(basis)};};
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());const store=new AgentSqliteStore(db);store.ensureSchema();
  const conversations=new SqliteConversationStore(store);conversations.ensureSchema();const thread=conversations.open('author','script:home','draft-tests');
  const scripts=createScriptRepository(db);scripts.ensureSchema();
  let drafts:ScriptDraftStore,bindFails=false;
  const contexts=new SqliteContextStore(store,(dependency,access)=>workspaces.sourceAllowed(dependency.ref,access,dependency.freshness));contexts.ensureSchema();
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
    compileContext({systemInstruction:'机械协议',sections:[{id:'base',text:'工作稿原文',required:true,priority:1,dependencies:[{ref:workspaceRef(workspace),freshness:'CURRENT'}]}],skills:[]}));
  const propose=(raw:string,name='propose')=>{
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

// Independent real-CURRENT-source regression; no model network.
test('adoption must commit when its own write advances the workspace source pointer',t=>{
 const h=setup(t),p=h.propose(JSON.stringify({summary:'MECHANICAL',content:'MECHANICAL_NEXT_CONCEPT'}));
 const candidateId=(p.receipt.data as any).candidateId;h.store.finish(p.token,'SUCCEEDED',p.receipt);
 const a=h.apply(candidateId);
 const result=h.drafts.apply({token:a.token});
 assert.equal(result.status,'SUCCEEDED');
 assert.equal(h.workspaces.read(h.workspace.id,'author').revision,2);
});

test('committed proposal replay checks its own frozen source after withdrawal',t=>{
 const h=setup(t),p=h.propose(JSON.stringify({summary:'MECHANICAL',content:'MECHANICAL_PROPOSAL'}));
 h.contexts.revokeScope({ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`});
 assert.throws(()=>h.drafts.recordResult({token:p.token,invocationId:p.invocation.id}));
 assert.equal(h.workspaces.read(h.workspace.id,'author').revision,1);
});
