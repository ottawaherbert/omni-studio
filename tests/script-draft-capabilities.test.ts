import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sha256 } from 'js-sha256';
import Database from 'better-sqlite3';
import { hashValue, type CapabilityRequest, type ModelTransport } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';
import { parseScriptProject } from '../packages/script/src/schema';

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

test('a long film scene rewrite reaches the model with complete outline and body',async t=>{
  const document=parseScriptProject(JSON.parse(readFileSync(new URL('./fixtures/script-goal-film-outline-workspace.json',import.meta.url),'utf8')));
  const unit=document.units[0],scene=unit.scenes[0];
  // A long, already-written scene must remain readable when revising it.
  scene.blocks[0].text='门外的浪声盖住回答。'.repeat(8000);
  const h=setup(t,'scene_body',document);
  const proposal=h.accept('film-scene-rewrite',{capabilityId:'script.propose',capabilityVersion:'1',callId:'film-scene-rewrite',input:{
    authorizationRef:'injected-by-host',operation:'scene_body',instruction:'保留全片因果，只修订当前场景',unitId:unit.id,sceneId:scene.id,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null}},
    {channel:'external',routeRef:'mechanical-no-provider',methods:[],authorRequest:'修订本场，保留已确认的大纲'});
  await h.host.worker.runOnce(proposal.runId);await h.host.childWorker.runOnce(proposal.runId);
  const external=h.host.journal.listExternal(proposal.runId,'author')[0];
  assert.ok(external,'the actual proposal must freeze a model request instead of overflowing');
  const {context}=JSON.parse(external.request.prompt.split('\n\n')[0]);
  assert.equal(context.project.blueprint.planning.units[0].summary,unit.summary);
  assert.equal(context.project.blueprintHash,sha256(JSON.stringify(context.project.blueprint)));
  assert.equal(context.project.planningHash,sha256(JSON.stringify(context.project.blueprint.planning)));
  assert.deepEqual(context.targetScene.blocks,scene.blocks);
  assert.equal(context.project.planningRef.path,'context.project.blueprint.planning');
  for(const view of [context.project.currentUnits[0],context.units[0]]){
    assert.equal(view.summaryRef.path,'context.project.blueprint.planning.units');
    assert.equal(context.project.blueprint.planning.units.find((item:any)=>item.id===view.summaryRef.unitId)[view.summaryRef.field],unit.summary);
  }
  assert.equal(external.request.inputManifest?.budget,undefined);
  assert.equal(context.project.planning,undefined);
  assert.ok(external.request.prompt.length>80000);
  assert.equal(h.host.workspaces.read(h.workspace.id,'author').revision,1);assert.equal(h.sent(),0);

});

test('actual host freezes an external proposal, worker resumes from exact return, then a new authorized run applies it',async t=>{
  const h=setup(t),input={authorizationRef:'injected-by-host',operation:'concept',instruction:'请写一个机械概念',
    unitId:null,sceneId:null,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null};
  const proposal=h.accept('propose',{capabilityId:'script.propose',capabilityVersion:'1',callId:'propose',input},
    {channel:'external',routeRef:'mechanical-external',methods:[],authorRequest:'根据原稿写概念'});
  await h.host.worker.runOnce(proposal.runId);
  assert.equal(h.host.store.readRun(proposal.runId).status,'WAITING_STEP');
  await h.host.childWorker.runOnce(proposal.runId);
  const external=h.host.journal.listExternal(proposal.runId,'author')[0];
  assert.ok(external);assert.equal(external.status,'WAITING');
  assert.equal(external.request.inputManifest?.scriptDraft && (external.request.inputManifest.scriptDraft as any).authorizationRef,proposal.auth.id);
  assert.equal((external.request.outputSchema as any).additionalProperties,false);
  const raw=JSON.stringify({summary:'机械候选',content:'一扇门的等待。'});
  h.host.journal.submitExternal(external.id,'author',external.inputHash,raw,{name:'MECHANICAL_PROTOCOL',model:'mechanical-test'});
  for(let index=0;index<5&&!['SUCCEEDED','FAILED','PARTIAL'].includes(h.host.store.readRun(proposal.runId).status);index++){
    await h.host.childWorker.runOnce(proposal.runId);await h.host.worker.runOnce(proposal.runId);
  }
  const proposalRun=h.host.store.readRun(proposal.runId);
  assert.equal(proposalRun.status,'SUCCEEDED');
  const proposalReceipt=proposalRun.result as any,candidateId=proposalReceipt.data.candidateId;
  assert.equal(h.host.drafts.readCandidate('author',candidateId).raw,raw);
  assert.equal(h.host.workspaces.read(h.workspace.id,'author').revision,1);
  assert.equal(h.sent(),0);
  const before=h.host.workspaces.read(h.workspace.id,'author');
  const apply=h.accept('apply',{capabilityId:'script.apply_patch',capabilityVersion:'1',callId:'apply',
    input:{authorizationRef:'injected-by-host',candidateId,expectedRevision:before.revision,writerEpoch:before.writerEpoch}});
  await h.host.worker.runOnce(apply.runId);
  const run=h.host.store.readRun(apply.runId);
  assert.equal(run.status,'SUCCEEDED');
  assert.equal(h.host.workspaces.read(h.workspace.id,'author').document.brief.concept,'一扇门的等待。');
  const application=h.host.drafts.readApplication((run.result as any).artifacts[0],'author');
  assert.equal(application.candidateId,candidateId);assert.equal(application.beforeRevision,1);assert.equal(application.afterRevision,2);
  assert.equal(h.sent(),0);
});

test('historical scene-body output remains compatible with the current child worker and adoption protocol (mechanical replay)',async t=>{
  const h=setup(t,'scene_body'),initial=h.host.workspaces.read(h.workspace.id,'author');
  const unitId=initial.document.units[0].id,sceneId=initial.document.units[0].scenes[0].id;
  const instruction='请写一个中文短场：雨夜失物招领处，两人围绕一把伞展开误会，结尾轻松，不强行反转。保留人物的自然互动，直接给这场正文。';
  const proposal=h.accept('scene-propose',{capabilityId:'script.propose',capabilityVersion:'1',callId:'scene-propose',input:{
    authorizationRef:'injected-by-host',operation:'scene_body',instruction,unitId,sceneId,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null}},
    {channel:'external',routeRef:'gpt-6-sol-simulation',methods:[],authorRequest:instruction});
  await h.host.worker.runOnce(proposal.runId);await h.host.childWorker.runOnce(proposal.runId);
  const external=h.host.journal.listExternal(proposal.runId,'author')[0];
  const evidence=JSON.parse(readFileSync(new URL('../artifacts/agent-foundation-study-2026-09-26/sol-scene-request.json',import.meta.url),'utf8'));
  // Preserve the historical evidence unchanged. This is schema/replay coverage,
  // not evidence of a fresh model answering the updated blueprint context.
  assert.match(external.request.systemInstruction??'',/遵守作者意图与本次明确范围/);
  assert.match(external.request.systemInstruction??'',/只按冻结 JSON 格式返回内容/);
  assert.deepEqual(external.request.outputSchema,evidence.externalRequest.request.outputSchema);
  assert.equal(external.request.inputManifest?.authorInstruction,instruction);
  assert.equal((external.request.inputManifest?.scriptDraft as any).operation,'scene_body');
  assert.match(external.request.prompt,/雨夜失物招领处/);
  const raw=readFileSync(new URL('./fixtures/agent-sol-scene-result.json',import.meta.url),'utf8');
  const provenance=JSON.parse(readFileSync(new URL('./fixtures/agent-sol-scene-provenance.json',import.meta.url),'utf8'));
  assert.equal(provenance.model,'gpt-6-sol');assert.equal(provenance.simulation,true);
  assert.equal(provenance.inputHash,evidence.externalRequest.inputHash);
  h.host.journal.submitExternal(external.id,'author',external.inputHash,raw,{name:'MECHANICAL_REPLAY_OF_HISTORICAL_SCENE_OUTPUT_NO_EXTERNAL_MODEL'});
  for(let index=0;index<5&&!['SUCCEEDED','FAILED','PARTIAL'].includes(h.host.store.readRun(proposal.runId).status);index++){
    await h.host.childWorker.runOnce(proposal.runId);await h.host.worker.runOnce(proposal.runId);
  }
  const run=h.host.store.readRun(proposal.runId);assert.equal(run.status,'SUCCEEDED');
  const candidateId=(run.result as any).data.candidateId;
  assert.equal(h.host.drafts.readCandidate('author',candidateId).raw,raw);
  const before=h.host.workspaces.read(h.workspace.id,'author');
  const apply=h.accept('scene-apply',{capabilityId:'script.apply_patch',capabilityVersion:'1',callId:'scene-apply',
    input:{authorizationRef:'injected-by-host',candidateId,expectedRevision:before.revision,writerEpoch:before.writerEpoch}});
  await h.host.worker.runOnce(apply.runId);
  assert.equal(h.host.store.readRun(apply.runId).status,'SUCCEEDED');
  const after=h.host.workspaces.read(h.workspace.id,'author');
  assert.equal(after.revision,2);assert.equal(after.document.units[0].scenes[0].blocks.length,16);
  assert.match(after.document.units[0].scenes[0].blocks[0].text,/玻璃门/);
  assert.match(after.document.units[0].scenes[0].blocks.at(-1)!.text,/雨里/);
  assert.equal(h.host.scripts.listProjects().length,0);assert.equal(h.sent(),0);
});
