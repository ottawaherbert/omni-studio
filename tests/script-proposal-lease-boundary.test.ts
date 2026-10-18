import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type CapabilityRequest, type ModelTransport } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';

function setup(t:any,operation:'concept'|'scene_body'='concept',sourceDocument?:ReturnType<typeof createScriptProject>){
  const db=new Database(':memory:');t.after(()=>db.close());let sent=0;
  const transport:ModelTransport={sendOnce:async()=>{sent++;throw new Error('external mode must not contact a provider');}};
  const host=createScriptAgentHost(db,transport,'draft-worker');
  const thread=host.conversations.open('author','script:home','mechanical-draft-host');
  const document=sourceDocument??createScriptProject('机械共享能力',createScriptCreationProfile('tv-series',2,20));
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create-workspace',source:{document}});
  const scope=(current=host.workspaces.read(workspace.id,'author')):ScriptDraftScope=>({workspaceId:workspace.id,
    documentId:current.document.id,originRevision:current.revision,originContentHash:hashValue(current.document),
    operations:[operation],units:operation==='scene_body'?[{unitId:current.document.units[0].id,allowSummary:false,
      allowAllScenes:false,maxNewScenes:0,scenes:[{sceneId:current.document.units[0].scenes[0].id,allowPlan:false,
        allowBody:true,blockIds:null}]}]:[],newUnitSlots:[],sharedFields:operation==='concept'?['concept']:[],characterScopeIds:[],factScopeIds:[]});
  const accept=(name:string,request:CapabilityRequest,scriptExecution?:unknown)=>{
    const auth=host.authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId:name,scope:scope(),sources:[]});
    request.input={...(request.input as object),authorizationRef:auth.id};
    const accepted=host.store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:name,
      kind:'CAPABILITY',input:{authorizationRef:auth.id,request,...(scriptExecution?{scriptExecution}:{})},
      policyRevision:'1',maxInvocations:2});
    host.authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});
    return {auth,runId:accepted.runId};
  };
  return {db,host,thread,workspace,accept,sent:()=>sent};
}


for(const mutation of ['none','revoke','version','fence'] as const)test(`external proposal renews between guarded transactions; boundary ${mutation}`,async t=>{
  const h=setup(t),proposal=h.accept('lease-proposal',{capabilityId:'script.propose',capabilityVersion:'1',callId:'lease-proposal',input:{
    authorizationRef:'injected-by-host',operation:'concept',instruction:'MECHANICAL',unitId:null,sceneId:null,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null}},
    {channel:'external',routeRef:'mechanical-external',methods:[],authorRequest:'MECHANICAL'});
  await h.host.worker.runOnce(proposal.runId);await h.host.childWorker.runOnce(proposal.runId);
  const external=h.host.journal.listExternal(proposal.runId,'author')[0];
  h.host.journal.submitExternal(external.id,'author',external.inputHash,JSON.stringify({summary:'MECHANICAL',content:'MECHANICAL_LEASE_RESULT'}),{name:'MECHANICAL'});
  // Advance the actual store/lease guard clock by eight seconds per synchronous
  // deep validation, without a wall-clock sleep or bypassing execution checks.
  let now=Date.now(),prepares=0,renewals=0,changed=false;
  const originalNow=Date.now;t.after(()=>{Date.now=originalNow;});Date.now=()=>now;(h.host.store as any).now=()=>now;
  for(const method of ['assertInput','prepare'] as const){const old=h.host.journal[method].bind(h.host.journal);(h.host.journal as any)[method]=(...args:any[])=>{const result=(old as any)(...args);now+=8000;if(method==='prepare')prepares++;return result;};}
  const commit=h.host.store.commitStep.bind(h.host.store);h.host.store.commitStep=(...args)=>{now+=8000;return commit(...args);};
  const renew=h.host.store.renew.bind(h.host.store);h.host.store.renew=(token,ms)=>{
    renewals++;assert.equal(h.db.inTransaction,false,'renew only outside domain transactions');if((h.db.prepare('SELECT status FROM agent_steps WHERE run_id=?').get(proposal.runId) as any).status==='PREPARED')assert.equal(ms,30000,'proposal checkpoints use the existing lease duration');
    if(prepares===2&&!changed){changed=true;
      if(mutation==='revoke')h.db.prepare('UPDATE agent_context_scopes SET policy_generation=policy_generation+1 WHERE scope_id=?').run(h.workspace.id);
      if(mutation==='version')h.db.prepare('UPDATE script_workspaces SET revision=revision+1 WHERE id=?').run(h.workspace.id);
      if(mutation==='fence')h.db.prepare('UPDATE agent_step_leases SET fence=fence+1 WHERE step_id=?').run(token.stepId);
    }
    return renew(token,ms);
  };
  await h.host.childWorker.runOnce(proposal.runId);
  const row=h.db.prepare('SELECT status FROM agent_steps WHERE run_id=?').get(proposal.runId) as any;
  if(mutation==='none'){
    assert.equal(row.status,'COMMITTED');assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_candidates').get() as any).n,1);
    assert.equal(h.host.store.readRun(proposal.runId).status,'QUEUED');assert.ok(renewals>=4);
  }else{assert.equal(row.status,'PREPARED');assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_candidates').get() as any).n,0);assert.ok(changed);}
  assert.equal(h.host.journal.read(external.invocationId).status,'RECEIVED');assert.equal(h.sent(),0);
});
