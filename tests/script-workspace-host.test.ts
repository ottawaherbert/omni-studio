import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AgentWorker, CapabilityRegistry, hashValue, type GoalAcceptance } from '../packages/agent-core/src';
import { compileContext, memorySection } from '../packages/agent-context/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

function setup(t:any){
 const db=new Database(':memory:');t.after(()=>db.close());
 const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('No model calls in mechanical lifecycle tests');}},'host-test');
 const thread=host.conversations.open('author','script:home','workspace-host');
 const document=createScriptProject('机械宿主验收',createScriptCreationProfile('short-film',1,5));
 const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'workspace',source:{document}});
 const {budgets,goals}=host;
 const authorization=host.authorizations.issue({ownerId:'author',threadId:thread.id,workspaceId:workspace.id,commandId:'goal',sources:[],scope:{workspaceId:workspace.id,documentId:workspace.documentId,originRevision:workspace.revision,originContentHash:hashValue(workspace.document),operations:['scene_body'],units:workspace.document.units.map(unit=>({unitId:unit.id,allowSummary:false,allowAllScenes:true,maxNewScenes:0,scenes:[]})),newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[]}});
 const value={mechanical:true};
 const input:GoalAcceptance={ownerId:'author',threadId:thread.id,scopeId:'script:home',requestId:'goal',requestEnvelope:{test:true},policyRevision:'1',objective:'Mechanical lifecycle only',contract:{pluginId:'mechanical',version:'1',value,digest:hashValue(value)},authorizationRef:authorization.id,workspaceRef:workspaceRef(workspace),sourceRefs:[],skillManifest:[],route:{channel:'external',routeRef:'mechanical'},stopPolicy:'CONTRACT_COMPLETE',turnLimits:{maxDecisions:2,maxToolCalls:2},budgetLimits:{maxInvocations:1,maxTurns:2,maxToolCalls:2,maxRepairRounds:1}};
 const accepted=goals.accept(input);host.authorizations.bind(authorization.id,'author',{kind:'GOAL',goalId:accepted.goalId,revision:1});
 return {db,host,thread,workspace,budgets,goals,accepted};
}

test('real Goal ASK releases workspace; same-thread author work claims it and stale release cannot clear new writer',t=>{
 const h=setup(t),claim=h.host.store.claim('coordinator',30000,h.accepted.runId)!;
 assert.equal(h.host.workspaces.read(h.workspace.id,'author').writerRunId,claim.run.id);
 const compiled=compileContext({systemInstruction:'',skills:[],sections:[{id:'request',text:'mechanical ASK protocol',required:true,priority:100,dependencies:[]}]});
 const contextRef=h.host.contexts.capture({ownerId:'author',scopeId:h.workspace.id,branch:`workspace:${h.workspace.id}`},compiled);
 const turn=h.goals.openTurn(claim.token),sampling=h.goals.saveSampling(claim.token,{turnId:turn.id,index:0,modelRequest:{operationKey:`decision:${turn.id}:0`,channel:'external',routeRef:'mechanical',prompt:compiled.prompt,contextRef},allowedToolsDigest:hashValue([])});
 const ask=h.goals.acceptDecision(claim.token,sampling.id,{kind:'ASK',message:'Mechanical choice',choices:[]});h.goals.awaitDecision(claim.token,ask.id);
 assert.equal(h.host.workspaces.read(h.workspace.id,'author').writerRunId,null);
 const manualAuth=h.host.authorizations.issue({ownerId:'author',threadId:h.thread.id,workspaceId:h.workspace.id,
   commandId:'manual',scope:h.host.authorizations.read(h.goals.read(h.accepted.goalId,'author').revision.authorizationRef,'author').scope,sources:[]});
 const manual=h.host.store.accept({ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId:'manual',kind:'CAPABILITY',input:{authorizationRef:manualAuth.id},policyRevision:'1',maxInvocations:1});
 h.host.authorizations.bind(manualAuth.id,'author',{kind:'RUN',runId:manual.runId,inputRevision:1});
 h.goals.attachManualRun({runId:manual.runId,ownerId:'author',goalId:h.accepted.goalId,expectedGoalVersion:h.goals.read(h.accepted.goalId,'author').version,
   authorizationRef:manualAuth.id,workspaceRef:manualAuth.workspaceRef});
 const m=h.host.store.claim('manual',30000,manual.runId)!;assert.ok(m);
 h.host.workspaces.releaseRun(claim.run.id);assert.equal(h.host.workspaces.read(h.workspace.id,'author').writerRunId,m.run.id);
 h.host.store.finish(m.token,'SUCCEEDED',{});assert.equal(h.host.workspaces.read(h.workspace.id,'author').writerRunId,null);
});

test('model budget exhaustion and unexpected handler failure release the actual workspace in scheduler transaction',async t=>{
 const h=setup(t),claim=h.host.store.claim('coordinator',30000,h.accepted.runId)!;
 const request={operationKey:'one',channel:'external' as const,routeRef:'mechanical',prompt:'unused mechanical request'};
 // Use an unguarded protocol journal only to exercise budget admission, no send.
 const {SqliteModelJournal}=await import('../packages/agent-sqlite/src');const journal=new SqliteModelJournal(h.host.store);journal.ensureSchema();journal.prepare(claim.token,request);
 assert.throws(()=>journal.prepare(claim.token,{...request,operationKey:'two'}),/预算/);
 assert.equal(h.host.store.readRun(claim.run.id).status,'PARTIAL');assert.equal(h.host.workspaces.read(h.workspace.id,'author').writerRunId,null);
 // A budget-stopped run requires explicit budget recovery. Exercise the
 // unrelated handler-failure cleanup with a fresh queued run.
 const failed=setup(t);
 const worker=new AgentWorker(failed.host.store,new CapabilityRegistry({assertExecution:async()=>{},authorize:async()=>{}}),{workerId:'failing-worker',handlers:{GOAL:async()=>{throw new Error('mechanical handler crash');}}});
 await worker.runOnce(failed.accepted.runId);assert.equal(failed.host.store.readRun(failed.accepted.runId).status,'FAILED');assert.equal(failed.host.workspaces.read(failed.workspace.id,'author').writerRunId,null);
});

test('actual host resolves fixed workspace context and propagates memory withdrawal through later author saves',t=>{
 const h=setup(t),w=h.workspace,access={ownerId:'author',scopeId:w.id,branch:`workspace:${w.id}`};
 const memory=h.host.contexts.createMemory(access,'author','memory',{key:'mechanical.source',kind:'AUTHOR_PREFERENCE',content:{label:'协议资料',value:'机械来源撤回测试'},dependencies:[]});
 const compiled=compileContext({systemInstruction:'机械来源测试',skills:[],sections:[{id:'workspace',text:JSON.stringify(w.document),required:true,priority:100,dependencies:[{ref:workspaceRef(w),freshness:'CURRENT'}]},memorySection(h.host.contexts.getMemory(memory.id,access))]});
 const contextRef=h.host.contexts.capture(access,compiled);assert.equal(h.host.contexts.assertAllowed(contextRef,access).prompt,compiled.prompt);
 const changed=structuredClone(w.document);changed.title='机械作者修改';
 const v2=h.host.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'save',expectedRevision:1,expectedEpoch:1,document:changed});
 assert.throws(()=>h.host.contexts.assertAllowed(contextRef,access));assert.doesNotThrow(()=>h.host.contexts.assertVisible(contextRef,access));
 // Bind evidence from the exact original version, as a trusted host would.
 const exact=h.host.contexts.capture(access,compileContext({systemInstruction:'机械证据',skills:[],sections:[{id:'workspace',text:JSON.stringify(w.document),required:true,priority:100,dependencies:[{ref:workspaceRef(w),freshness:'EXACT'}]},memorySection(h.host.contexts.getMemory(memory.id,access))]}));
 h.host.contexts.bindArtifact('script-workspace-version',`${w.id}:${v2.revision}`,exact,access);
 const v3=h.host.workspaces.saveAuthor({workspaceId:w.id,ownerId:'author',requestId:'later',expectedRevision:2,expectedEpoch:1,document:v2.document});assert.equal(v3.revision,3);
 h.host.contexts.updateMemory(access,'withdraw',memory.id,1,'DELETE');
 assert.throws(()=>h.host.workspaces.read(w.id,'author'),/撤回|不可|删除/);
 assert.throws(()=>h.host.workspaces.exportVersion({workspaceId:w.id,ownerId:'author',revision:2,unitIds:[w.document.units[0].id],format:'json'}));
 assert.equal(h.host.workspaces.version(w.id,'author',1).title,w.document.title);
 assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspace_revisions').get() as any).n,3);
});
