import test from 'node:test';
import { workspaceSources } from '../apps/api/src/agent/scriptMemory';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { hashValue } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { workspaceRef } from '../apps/api/src/repositories/scriptWorkspaceStore';
import { compileContext } from '../packages/agent-context/src';

const result=(key:string,value:string)=>({text:JSON.stringify({items:[{key,kind:'NAVIGATION',label:'【机械索引】',value}]}),
  provenance:{channel:'external-return' as const,producer:'MECHANICAL_MEMORY_PROTOCOL_NO_MODEL'}});

async function setup(t:any,grant:'SECOND'|'FIRST'|'CHANGED_TEXT'|'OTHER_PROJECT',historicalBatch=false){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_EXTERNAL_MODEL');}},'memory-readgrant-test',
    {trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','memory-readgrant');
  const document=createScriptProject('【机械连续作品】',createScriptCreationProfile('tv-series',3,3));
  document.units[0].scenes[0].blocks[0].text='FIRST_UNIT_SOURCE_MARKER';
  const second=newUnit('第二集',180000,document.id);second.scenes[0].blocks[0].text='SECOND_UNIT_SOURCE_MARKER';document.units.push(second);
  const saved=host.scripts.saveProject(document,0);
  let granted=saved;
  let originalWorkspace:ReturnType<typeof host.workspaces.create>|undefined;
  if(grant==='CHANGED_TEXT'){
    // Keep an existing work draft before the author edits the project. Starting
    // a new Goal from the stale project revision is correctly rejected.
    originalWorkspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'before-author-edit',
      source:{projectId:saved.id,revision:saved.revision}});
    const changed=structuredClone(saved);changed.units[1].scenes[0].blocks[0].text='CHANGED_FIXED_PROJECT_TEXT';
    granted=host.scripts.saveProject(changed,saved.revision);
  }else if(grant==='OTHER_PROJECT'){
    const other=createScriptProject('【另一作品】',createScriptCreationProfile('tv-series',3,3));
    other.units=structuredClone(saved.units);other.units[1].scenes[0].blocks[0].text='SECOND_UNIT_SOURCE_MARKER';
    granted=host.scripts.saveProject(other,0);
  }
  const grantedUnit=grant==='FIRST'?saved.units[0]:saved.units[1];
  const ref={uri:`resource://script/projects/${granted.id}`,version:String(granted.revision),contentHash:hashValue(granted),branch:'author'};
  const receipt=await host.commands.submit('author',{
    kind:'GOAL_START',requestId:'mechanical-next-unit',threadId:thread.id,expectedConversationVersion:thread.version,
    source:originalWorkspace?{kind:'WORKSPACE',workspaceId:originalWorkspace.id,expectedRevision:originalWorkspace.revision}:
      {kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
    objective:'【机械协议】只写第三集',task:'WRITE',target:{newUnitCount:1},methodIds:[],
    sources:[{purpose:'PREVIOUS_SCRIPT',ref,unitIds:[grantedUnit.id]}],
  },{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical'})});
  const access={ownerId:'author',scopeId:receipt.workspaceId,branch:`workspace:${receipt.workspaceId}`};
  // Seed historical extraction evidence directly; external creative tasks no longer enqueue maintenance.
  const sources=workspaceSources(host.workspaces.read(receipt.workspaceId,'author'),'external','mechanical');
  assert.equal(sources.length,2);
  sources.forEach(source=>{
    if(historicalBatch){
      const row=JSON.parse(source.text);
      row.text=row.text.slice(0,7);
      source.text=JSON.stringify(row);
      source.key=source.key.replace('draft.v2.','draft.');
    }
    host.memory.work.enqueue(source);
  });
  for(let index=0;index<2;index++){
    const job=host.memory.work.freezeNext()!;
    const unitId=job.source.range?.[0].unitId;
    assert.ok(unitId===saved.units[0].id||unitId===saved.units[1].id);
    const first=unitId===saved.units[0].id;
    host.memory.work.complete(job.id,access,job.requestHash!,result(first?'mechanical.first':'mechanical.second',
      first?'FIRST_MEMORY_MARKER':'SECOND_MEMORY_MARKER'));
  }
  const publicMemories=host.contexts.listMemories(access).items;
  assert.equal(publicMemories.length,2);
  const run=host.store.readRun(receipt.runId);
  return {db,host,thread,saved,granted,receipt,access,run,publicMemories};
}

test('historical memory batches retain provenance when current source batching changes',async t=>{
  const h=await setup(t,'SECOND',true);
  const visible=h.host.authorizations.withRunAuthorization(h.run,'CONSUME',()=>h.host.contexts.listMemories(h.access));
  assert.deepEqual(visible.items.map(item=>item.key),['mechanical.second']);
});

test('fixed second-unit readgrant projects only matching derived memory into the actual frozen Goal',async t=>{
  const h=await setup(t,'SECOND');
  const visible=h.host.authorizations.withRunAuthorization(h.run,'CONSUME',()=>h.host.contexts.listMemories(h.access));
  assert.deepEqual(visible.items.map(item=>item.key),['mechanical.second']);
  await h.host.worker.runOnce(h.run.id);
  const frozen=h.host.journal.listExternal(h.run.id,'author').find(item=>item.status==='WAITING')!;
  assert.ok(frozen);
  assert.match(frozen.request.prompt,/SECOND_MEMORY_MARKER/);
  assert.doesNotMatch(frozen.request.prompt,/FIRST_MEMORY_MARKER|FIRST_UNIT_SOURCE_MARKER/);
  assert.ok(frozen.request.prompt.includes(visible.items[0].id));
  const goal=h.host.goals.read(h.receipt.goalId!,'author'),waiting=h.host.store.readRun(h.run.id);
  const continued=await h.host.commands.submit('author',{
    kind:'GOAL_CONTINUE',requestId:'same-source-new-grant',threadId:h.thread.id,expectedConversationVersion:h.thread.version,
    goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:waiting.version,
  },{resolveMethods:async()=>{throw Error('must reuse frozen methods');},resolveExecution:()=>{throw Error('must reuse frozen route');}});
  assert.notEqual(continued.authorizationRef,h.receipt.authorizationRef);
  const successor=h.host.store.readRun(continued.runId);
  h.host.authorizations.withRunAuthorization(successor,'VIEW',()=>h.host.contexts.assertVisible(frozen.request.contextRef!,h.access));
});

for(const variant of ['FIRST','CHANGED_TEXT','OTHER_PROJECT'] as const){
  test(`readgrant memory projection respects ${variant} fixed source`,async t=>{
    const h=await setup(t,variant);
    const visible=h.host.authorizations.withRunAuthorization(h.run,'CONSUME',()=>h.host.contexts.listMemories(h.access));
    assert.deepEqual(visible.items.map(item=>item.key),variant==='FIRST'?['mechanical.first']:[]);
  });
}

test('a fixed project grant reuses matching extracted memory across workspaces without write authority',async t=>{
  const h=await setup(t,'SECOND');
  const nextThread=h.host.conversations.open('author','script:home','other-workspace-goal');
  const ref={uri:`resource://script/projects/${h.saved.id}`,version:String(h.saved.revision),contentHash:hashValue(h.saved),branch:'author'};
  const next=await h.host.commands.submit('author',{
    kind:'GOAL_START',requestId:'another-workspace-same-source',threadId:nextThread.id,expectedConversationVersion:nextThread.version,
    source:{kind:'PROJECT',projectId:h.saved.id,revision:h.saved.revision,contentHash:hashValue(h.saved)},
    objective:'【机械协议】另一工作稿只写下一集',task:'WRITE',target:{newUnitCount:1},methodIds:[],
    sources:[{purpose:'PREVIOUS_SCRIPT',ref,unitIds:[h.saved.units[1].id]}],
  },{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical'})});
  assert.notEqual(next.workspaceId,h.receipt.workspaceId);
  const run=h.host.store.readRun(next.runId),access={ownerId:'author',scopeId:next.workspaceId,branch:`workspace:${next.workspaceId}`};
  const visible=h.host.authorizations.withRunAuthorization(run,'CONSUME',()=>h.host.contexts.listMemories(access));
  assert.deepEqual(visible.items.map(item=>item.key),['mechanical.second']);
  const scope=h.host.authorizations.read(next.authorizationRef,'author').scope as any;
  assert.ok(scope.units.every((unit:any)=>unit.unitId!==h.saved.units[1].id));
  assert.ok(scope.newUnitSlots.length===1);
  await h.host.worker.runOnce(next.runId);
  const frozen=h.host.journal.listExternal(next.runId,'author').find(item=>item.status==='WAITING')!;
  assert.ok(frozen);
  assert.match(frozen.request.prompt,/SECOND_MEMORY_MARKER/);
  h.host.contexts.revokeScope(h.access); // source scope, not this Goal's scope
  const after=h.host.authorizations.withRunAuthorization(run,'VIEW',()=>h.host.contexts.listMemories(access));
  assert.deepEqual(after.items,[]);
  assert.throws(()=>h.host.authorizations.withRunAuthorization(run,'VIEW',()=>
    h.host.contexts.assertVisible(frozen.request.contextRef!,access)));
});

test('a manual draft freezes the selected prior-unit memory but cannot write that unit',async t=>{
  const h=await setup(t,'SECOND');
  const draftThread=h.host.conversations.open('author','script:home','memory-manual-draft');
  const ref={uri:`resource://script/projects/${h.saved.id}`,version:String(h.saved.revision),contentHash:hashValue(h.saved),branch:'author'};
  const command=await h.host.commands.submit('author',{
    kind:'PROPOSE',requestId:'draft-with-prior-memory',threadId:draftThread.id,expectedConversationVersion:draftThread.version,
    source:{kind:'PROJECT',projectId:h.saved.id,revision:h.saved.revision,contentHash:hashValue(h.saved)},
    operation:'concept',instruction:'【机械协议】提炼当前作品概念',target:{},methodIds:[],
    sources:[{purpose:'PREVIOUS_SCRIPT',ref,unitIds:[h.saved.units[1].id]}],
  },{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical'})});
  await h.host.worker.runOnce(command.runId);await h.host.childWorker.runOnce(command.runId);
  const frozen=h.host.journal.listExternal(command.runId,'author').find(item=>item.status==='WAITING')!;
  assert.ok(frozen,JSON.stringify(h.host.store.readRun(command.runId)));
  assert.match(frozen.request.prompt,/SECOND_MEMORY_MARKER/);
  assert.doesNotMatch(frozen.request.prompt,/FIRST_MEMORY_MARKER/);
  const grant=h.host.authorizations.read(command.authorizationRef,'author').scope as any;
  assert.deepEqual(grant.units,[]);
  assert.deepEqual(grant.sharedFields,['concept']);
});

test('registered check capability reads selected prior-unit memory while checking a different target unit',async t=>{
  const h=await setup(t,'SECOND'),reviewThread=h.host.conversations.open('author','script:home','memory-check');
  const ref={uri:`resource://script/projects/${h.saved.id}`,version:String(h.saved.revision),contentHash:hashValue(h.saved),branch:'author'};
  const receipt=await h.host.commands.submit('author',{
    kind:'GOAL_START',requestId:'check-with-prior-memory',threadId:reviewThread.id,expectedConversationVersion:reviewThread.version,
    source:{kind:'PROJECT',projectId:h.saved.id,revision:h.saved.revision,contentHash:hashValue(h.saved)},
    objective:'【机械协议】检查第一集',task:'REVISE',target:{unitIds:[h.saved.units[0].id],wholeUnitIds:[h.saved.units[0].id]},methodIds:[],
    sources:[{purpose:'PREVIOUS_SCRIPT',ref,unitIds:[h.saved.units[1].id]}],
  },{resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical'})});
  const claim=h.host.store.claim('memory-check-worker',30000,receipt.runId)!;
  const auth=h.host.authorizations.read(receipt.authorizationRef,'author');
  const status=h.host.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>h.host.reviews.readStatus(claim.token));
  const task=status.plan.tasks.find(item=>item.kind==='LOCAL'&&item.requiredEvidenceTaskIds.length===0)!;
  assert.ok(task);
  const prepared=await h.host.registry.prepare({capabilityId:'script.check_batch',capabilityVersion:'1',callId:'memory-check',
    input:{authorizationRef:auth.id,taskId:task.id}},
    {ownerId:'author',scopeId:'script:home',commandRevision:String(claim.run.generation),policyRevision:claim.run.policyRevision,
      execution:claim.token,signal:new AbortController().signal});
  const model=(prepared.request.input as any).frozen.model;
  assert.match(model.prompt,/SECOND_MEMORY_MARKER/);
  assert.doesNotMatch(model.prompt,/FIRST_MEMORY_MARKER/);
  const scope=auth.scope as any;
  assert.deepEqual(scope.units.map((unit:any)=>unit.unitId),[h.saved.units[0].id]);
  assert.deepEqual(auth.sources[0].unitIds,[h.saved.units[1].id]);
});

test('withdrawal of the original extraction context invalidates projected memory and frozen evidence',async t=>{
  const h=await setup(t,'SECOND');
  await h.host.worker.runOnce(h.run.id);
  const frozen=h.host.journal.listExternal(h.run.id,'author').find(item=>item.status==='WAITING')!;
  assert.ok(frozen?.request.contextRef);
  h.host.contexts.revokeScope(h.access);
  const visible=h.host.authorizations.withRunAuthorization(h.run,'VIEW',()=>h.host.contexts.listMemories(h.access));
  assert.deepEqual(visible.items,[]);
  assert.throws(()=>h.host.authorizations.withRunAuthorization(h.run,'VIEW',()=>
    h.host.contexts.assertVisible(frozen.request.contextRef!,h.access)));
});

test('an old same-workspace read grant and projected memory disappear after the reader removes that source',async t=>{
  const h=await setup(t,'SECOND'),workspace=h.host.workspaces.read(h.receipt.workspaceId,'author');
  const ownSource={purpose:'PREVIOUS_SCRIPT' as const,ref:workspaceRef(workspace),
    access:h.access,unitIds:[h.saved.units[1].id]};
  const scope=h.host.authorizations.read(h.receipt.authorizationRef,'author').scope;
  const issue=(requestId:string,sources:typeof ownSource[])=>{
    const auth=h.host.authorizations.issue({ownerId:'author',threadId:h.thread.id,workspaceId:workspace.id,commandId:requestId,scope,sources});
    const accepted=h.host.store.accept({ownerId:'author',threadId:h.thread.id,scopeId:'script:home',requestId,
      kind:'CAPABILITY',input:{authorizationRef:auth.id},policyRevision:'mechanical',maxInvocations:1});
    h.host.authorizations.bind(auth.id,'author',{kind:'RUN',runId:accepted.runId,inputRevision:1});
    return {auth,run:h.host.store.readRun(accepted.runId)};
  };
  const old=issue('self-source-old',[ownSource]),next=issue('self-source-removed',[]);
  const grant=h.host.authorizations.grants(old.auth.id,'author')[0],ref=h.host.authorizations.ref(grant);
  const visible=h.host.authorizations.withRunAuthorization(old.run,'VIEW',()=>h.host.contexts.listMemories(h.access));
  assert.ok(visible.items.some(item=>item.key==='mechanical.second'));
  assert.throws(()=>h.host.authorizations.withRunAuthorization(next.run,'VIEW',()=>h.host.authorizations.readGranted(ref,h.access)),/来源范围/);
  const after=h.host.authorizations.withRunAuthorization(next.run,'VIEW',()=>h.host.contexts.listMemories(h.access));
  assert.ok(after.items.every(item=>item.key!=='mechanical.second'));
  const projected=visible.items.find(item=>item.key==='mechanical.second')!;
  assert.throws(()=>h.host.authorizations.withRunAuthorization(next.run,'VIEW',()=>h.host.contexts.getMemory(projected.id,h.access)),/来源|不存在|不可/);
});

test('next-unit Goal validates committed workspace provenance without inheriting its old read grant',async t=>{
  const h=await setup(t,'SECOND');
  const oldGrant=h.host.authorizations.grants(h.receipt.authorizationRef,'author')[0];
  const oldGrantRef=h.host.authorizations.ref(oldGrant);
  const historic=h.host.authorizations.withRunAuthorization(h.run,'CONSUME',()=>h.host.contexts.capture(h.access,
    compileContext({systemInstruction:'【机械旧版本来源】',skills:[],sections:[{id:'old-source',text:'【机械旧来源】',required:true,priority:100,dependencies:[{ref:oldGrantRef,freshness:'CURRENT'}]}]})));
  const before=h.host.workspaces.read(h.receipt.workspaceId,'author');
  const document=structuredClone(before.document);document.title='【机械已完成第一集】';
  const version=h.host.workspaces.saveAuthor({workspaceId:before.id,ownerId:'author',requestId:'mechanical-finished-first',
    expectedRevision:before.revision,expectedEpoch:before.writerEpoch,document});
  h.host.authorizations.withRunAuthorization(h.run,'VIEW',()=>h.host.contexts.bindEvidenceArtifact(
    'script-workspace-version',`${before.id}:${version.revision}`,historic,h.access));
  const next=await h.host.commands.submit('author',{kind:'GOAL_START',requestId:'mechanical-next-from-version',
    threadId:h.thread.id,expectedConversationVersion:h.thread.version,
    source:{kind:'WORKSPACE',workspaceId:before.id,expectedRevision:version.revision},
    objective:'【机械协议】只写下一集',task:'WRITE',target:{newUnitCount:1,newUnitMaxScenes:4},methodIds:[],
    sources:[{purpose:'PREVIOUS_SCRIPT',ref:workspaceRef(version),unitIds:[h.saved.units[1].id]}]},
  {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical'})});
  const run=h.host.store.readRun(next.runId);
  const visible=h.host.authorizations.withRunAuthorization(run,'VIEW',()=>h.host.workspaces.read(before.id,'author'));
  assert.equal(visible.revision,version.revision);
  assert.throws(()=>h.host.authorizations.withRunAuthorization(run,'VIEW',()=>h.host.authorizations.readGranted(oldGrantRef,h.access)),
    /旧资料|来源/);
});
