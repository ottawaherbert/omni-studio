import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue, type PreparedCall, type Observation } from '../packages/agent-core/src';
import { compileContext } from '../packages/agent-context/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { scriptDraftCandidateRef, type ScriptDraftRecord } from '../apps/api/src/repositories/scriptDraftStore';
import { workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';

// Isolated durable records exercise the real host's source/authority checks.
// No worker or transport is run and no application database is opened.
function fixture(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_MODEL');}},'content-cache-test',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','content-cache');
  const source=createScriptProject('source',createScriptCreationProfile('tv-series',2,20));source.units.push(newUnit('second',1200000,source.id));
  const previous=host.scripts.saveProject(source,0);
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document:createScriptProject('draft',createScriptCreationProfile('short-film',1,3))}});
  const access={ownerId:'author',scopeId:workspace.id,branch:`workspace:${workspace.id}`};
  const scope:ScriptDraftScope={workspaceId:workspace.id,documentId:workspace.documentId,originRevision:1,originContentHash:hashValue(workspace.document),operations:['concept'],units:[],newUnitSlots:[],sharedFields:['concept'],characterScopeIds:[],factScopeIds:[]};
  const command=(id:string,unitIds:string[]|null)=>{
    const auth=host.authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId:id,scope,sources:[{ref:{uri:`resource://script/projects/${previous.id}`,version:'1',contentHash:hashValue(previous),branch:'author'},access:{ownerId:'author',scopeId:previous.id,branch:'author'},purpose:'PREVIOUS_SCRIPT',unitIds}]});
    const accepted=host.store.accept({ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:id,kind:'CAPABILITY',input:{authorizationRef:auth.id},policyRevision:'1',maxInvocations:2});
    host.authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});
    return {auth,run:host.store.readRun(accepted.runId)};
  };
  const wide=command('wide',null),narrow=command('narrow',[previous.units[0].id]);
  const grant=host.authorizations.ref(host.authorizations.grants(wide.auth.id,'author')[0]);
  const bundle=compileContext({systemInstruction:'mechanical',skills:[],sections:[{id:'source',text:'mechanical',required:true,priority:1,dependencies:[{ref:grant,freshness:'EXACT'},{ref:workspaceRef(workspace),freshness:'CURRENT'}]}]});
  const contextRef=host.authorizations.withRunAuthorization(wide.run,'CONSUME',()=>host.contexts.capture(access,bundle));
  const claim=host.store.claim('fixture',30000,wide.run.id)!;
  const basis={request:{capabilityId:'script.propose',capabilityVersion:'1',callId:'fixture',input:{authorizationRef:wide.auth.id}},implementationDigest:'fixture',contractDigest:'fixture',inputDigest:hashValue({authorizationRef:wide.auth.id}),binding:{ownerId:'author',scopeId:'script:home',commandRevision:'1',policyRevision:'1'},sources:[],targets:[]};
  const step=host.store.savePrepared(claim.token,{...basis,preparedDigest:hashValue(basis)} as PreparedCall);
  const token={...claim.token,stepId:step.id};
  const model={operationKey:'draft',channel:'external' as const,routeRef:'fixture',prompt:bundle.prompt,systemInstruction:bundle.systemInstruction,contextRef};
  const invocation=host.journal.prepare(token,model);
  const record:ScriptDraftRecord={id:'draft_content_fixture',ownerId:'author',workspaceId:workspace.id,authorizationId:wide.auth.id,runId:wide.run.id,stepId:step.id,callId:'fixture',invocationId:invocation.id,modelRequest:model,modelInputHash:hashValue(model),modelResult:{text:'fixture'},raw:'fixture',contextRef,baseRef:workspaceRef(workspace),request:{candidateId:'',operation:'concept'},status:'INVALID',error:'mechanical fixture',candidate:null};
  const observation:Observation={status:'SUCCEEDED',effectState:'CANDIDATE_PRESERVED',summary:'fixture',data:{candidateId:record.id},artifacts:[scriptDraftCandidateRef(record)],evidence:[],retry:'NEVER'};
  db.prepare('INSERT INTO script_draft_candidates VALUES(?,?,?,?,?,?,?,?,?)').run(record.id,'author',workspace.id,wide.run.id,step.id,invocation.id,hashValue(record),JSON.stringify(record),JSON.stringify(observation));
  host.contexts.bindArtifact('script-draft-candidate',record.id,contextRef,access);
  host.store.commitStep(token,'fixture',observation,()=>{});
  host.store.finish(token,'SUCCEEDED',observation);
  const read=(phase:'VIEW'|'CONSUME'='VIEW')=>host.authorizations.withRunAuthorization(wide.run,phase,()=>host.drafts.readCandidate('author',record.id,phase));
  return {db,host,workspace,access,wide,narrow,record,read};
}

test('candidate cache reuses exact bytes but never returns its mutable object or trusts changed row identity',async t=>{
  const h=fixture(t),data=JSON.stringify(h.record),parse=JSON.parse;let parses=0;
  t.mock.method(JSON,'parse',(text:string,...args:any[])=>{if(text===data)parses++;return parse(text,...args);});
  const first=h.read();first.modelRequest.prompt='mutated';first.request.operation='scene_body';
  await Promise.resolve();
  assert.deepEqual(h.read(),h.record);assert.equal(parses,1,'only pure decoding survives the await');
  const view=h.host.authorizations.withRunAuthorization(h.wide.run,'VIEW',()=>h.host.drafts.readCandidateView('author',h.record.id));
  assert.deepEqual(view.ref,scriptDraftCandidateRef(h.record));view.baseRef.version='changed';assert.deepEqual(h.read(),h.record);
  assert.throws(()=>h.host.drafts.readCandidate('other',h.record.id),/不属于作者/);
  h.db.prepare('UPDATE script_draft_candidates SET owner_id=? WHERE id=?').run('other',h.record.id);
  assert.throws(h.read,/不属于作者/);
  assert.throws(()=>h.host.drafts.readCandidate('other',h.record.id),/损坏/);
  h.db.prepare('UPDATE script_draft_candidates SET owner_id=? WHERE id=?').run('author',h.record.id);
  h.db.prepare('UPDATE script_draft_candidates SET payload_hash=? WHERE id=?').run('tampered',h.record.id);
  assert.throws(h.read,/损坏/);h.db.prepare('UPDATE script_draft_candidates SET payload_hash=? WHERE id=?').run(hashValue(h.record),h.record.id);
  h.db.prepare('UPDATE script_draft_candidates SET workspace_id=? WHERE id=?').run('other-workspace',h.record.id);
  assert.throws(h.read,/损坏/);h.db.prepare('UPDATE script_draft_candidates SET workspace_id=? WHERE id=?').run(h.workspace.id,h.record.id);
  h.db.prepare('UPDATE script_draft_candidates SET data_json=? WHERE id=?').run(JSON.stringify(h.record,null,2),h.record.id);
  assert.deepEqual(h.read(),h.record,'equivalent JSON with different stored bytes retains canonical identity');
  const changed={...h.record,raw:'different bytes'};
  h.db.prepare('UPDATE script_draft_candidates SET data_json=? WHERE id=?').run(JSON.stringify(changed),h.record.id);
  assert.throws(h.read,/损坏/);
  h.db.prepare('UPDATE script_draft_candidates SET payload_hash=? WHERE id=?').run(hashValue(changed),h.record.id);
  assert.deepEqual(h.read(),changed,'new exact bytes are decoded rather than served from the old entry');
});

test('warm candidate data cannot bypass real source narrowing, CURRENT changes or scope revocation',async t=>{
  const h=fixture(t);assert.deepEqual(h.read('CONSUME'),h.record);await Promise.resolve();
  assert.throws(()=>h.host.authorizations.withRunAuthorization(h.narrow.run,'VIEW',()=>h.host.drafts.readCandidate('author',h.record.id)),/来源|范围/);
  const document=structuredClone(h.workspace.document);document.brief.concept='author changed';
  const current=h.host.workspaces.read(h.workspace.id,'author');
  h.host.workspaces.saveAuthor({workspaceId:h.workspace.id,ownerId:'author',requestId:'change',expectedRevision:current.revision,expectedEpoch:current.writerEpoch,document});
  assert.deepEqual(h.read(),h.record,'historical VIEW retains exact sources');
  assert.throws(()=>h.read('CONSUME'),/来源|变化/);
  h.host.contexts.revokeScope(h.access);assert.throws(h.read,/撤回/);
});

test('candidate content retention is bounded by entry count and stored character count',t=>{
  const h=fixture(t),privateStore=h.host.drafts as any;
  // Reusing the same isolated row exercises the size budget without violating
  // its unique invocation binding or creating synthetic application effects.
  const write=(raw:string)=>{const record={...h.record,raw};h.db.prepare('UPDATE script_draft_candidates SET data_json=?,payload_hash=? WHERE id=?').run(JSON.stringify(record),hashValue(record),record.id);return record;};
  h.read();write('x'.repeat(16_000_001));h.read();assert.equal(privateStore.recordContents.size,0);assert.equal(privateStore.recordContentSize,0);
  write('small');h.read();assert.equal(privateStore.recordContents.size,1);
  // Independent rows are fixture records; identifiers remain bound to their
  // own bytes, while FK enforcement is unnecessary for this storage-only case.
  h.db.pragma('foreign_keys = OFF');
  for(let i=0;i<130;i++){
    const record={...h.record,id:`draft_cache_${i}`,invocationId:`invocation_cache_${i}`,raw:'x'.repeat(140000)};
    h.db.prepare('INSERT INTO script_draft_candidates VALUES(?,?,?,?,?,?,?,?,?)').run(record.id,'author',h.workspace.id,record.runId,record.stepId,record.invocationId,hashValue(record),JSON.stringify(record),'{}');
    privateStore.stored(record.id,'author');
  }
  assert.ok(privateStore.recordContents.size<=128);assert.ok(privateStore.recordContentSize<=16_000_000);
  assert.equal(privateStore.recordContentSize,[...privateStore.recordContents.values()].reduce((n:number,value:any)=>n+value.data.length,0));
  for(let i=0;i<130;i++){
    const record={...h.record,id:`draft_cache_${i}`,invocationId:`invocation_cache_${i}`,raw:'small'};
    h.db.prepare('UPDATE script_draft_candidates SET data_json=?,payload_hash=? WHERE id=?').run(JSON.stringify(record),hashValue(record),record.id);
    privateStore.stored(record.id,'author');
  }
  assert.equal(privateStore.recordContents.size,128,'small records also obey the separate entry-count bound');
  assert.equal(privateStore.recordContentSize,[...privateStore.recordContents.values()].reduce((n:number,value:any)=>n+value.data.length,0));
});
