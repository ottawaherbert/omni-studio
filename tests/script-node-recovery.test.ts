import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { readScriptGoalEnvelope } from '../packages/script/src/agentGoal';
import { collectOutlineRequirements } from '../packages/script/src/goalCoverage';

// Real host, commands, workers and journals; all model responses are explicit
// mechanical external returns against an in-memory database. No provider runs.
const envelope=(capabilityId:string,args:Record<string,unknown>)=>({kind:'CALL',capabilityId,capabilityVersion:'1',arguments:args,
  planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null});
const resolve={resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical-node-regression'})};
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());let providerCalls=0;
  const host=createScriptAgentHost(db,{sendOnce:async()=>{providerCalls++;throw new Error('NO_EXTERNAL_MODEL');}},'node-recovery-fixture');
  const thread=host.conversations.open('author','script:home','node-recovery');
  const project=createScriptProject('机械节点恢复',createScriptCreationProfile('tv-series',2,3));
  const unit=project.units[0];unit.summary='进入房间，找到记录，再离开。';
  unit.structureNodes=[{id:'node_a',title:'进入',purpose:'进入房间并找到记录。'},{id:'node_b',title:'离开',purpose:'带走记录。'}];
  unit.scenes=['a','b'].map(key=>({...newScene(`原场${key}`),id:`scene_${key}`,structureNodeId:`node_${key}`,purpose:`原场${key}的事件`,blocks:[{id:`block_${key}`,type:'action' as const,text:`作者原文${key}`}]}));
  project.units.push(newUnit('另一集',180000,project.id));project.units[1].summary='另一集的故事。';
  project.units[1].scenes[0].blocks[0].text='另一集不得读取的原文';
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'base',source:{document:project}});
  const common={threadId:thread.id,expectedConversationVersion:thread.version};
  const start=()=>host.commands.submit('author',{...common,kind:'GOAL_START',requestId:'start-node',stopAfter:'BODY',
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},objective:'只写进入段落，保留其他原稿',task:'WRITE',
    target:{unitIds:[unit.id],structureTargets:[{unitId:unit.id,nodeId:'node_a'}],maxNewScenes:[{unitId:unit.id,count:3}]},methodIds:[]},resolve);
  async function waiting(runId:string,operation:'decision'|'draft'){
    for(let i=0;i<12;i++){
      const external=host.journal.listExternal(runId,'author').find(item=>item.status==='WAITING');
      if(external){assert.ok(operation==='decision'?external.request.operationKey.startsWith('decision:'):external.request.operationKey==='draft',external.request.operationKey);return external;}
      await host.worker.runOnce(runId);await host.childWorker.runOnce(runId);
    }
    assert.fail(`no ${operation} request: ${JSON.stringify(host.store.readRun(runId))}`);
  }
  const reply=(external:Awaited<ReturnType<typeof waiting>>,value:unknown)=>host.journal.submitExternal(external.id,'author',external.inputHash,JSON.stringify(value),{name:'MECHANICAL_PROTOCOL_NO_EXTERNAL_MODEL',model:'fixture'});
  async function decide(runId:string,capabilityId:string,args:Record<string,unknown>){
    reply(await waiting(runId,'decision'),envelope(capabilityId,args));await host.worker.runOnce(runId);
  }
  async function propose(runId:string,authorizationRef:string,operation:string,target:Record<string,unknown>,result:unknown){
    await decide(runId,'script.propose',{authorizationRef,operation,instruction:'机械协议生成，不评价创作品质',unitId:unit.id,sceneId:null,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null,...target});
    const external=await waiting(runId,'draft');reply(external,result);await host.childWorker.runOnce(runId);
    // External request identity is checked by the real journal; obtain the
    // persisted candidate independently of any model-returned identifier.
    const row=db.prepare('SELECT id FROM script_draft_candidates WHERE run_id=? AND invocation_id=?').get(runId,external.invocationId) as {id:string}|undefined;
    assert.ok(row,JSON.stringify(host.store.readRun(runId)));
    const candidate=host.drafts.readCandidate('author',row.id);assert.equal(candidate.status,'VALID',candidate.error??'');
    assert.equal(candidate.request.operation,operation);return candidate;
  }
  async function apply(runId:string,authorizationRef:string,candidateId:string){
    const current=host.workspaces.read(workspace.id,'author');
    await decide(runId,'script.apply_patch',{authorizationRef,candidateId,expectedRevision:current.revision,writerEpoch:current.writerEpoch});
    const after=host.workspaces.read(workspace.id,'author');assert.equal(after.revision,current.revision+1);return after;
  }
  const pause=(runId:string)=>{const run=host.store.readRun(runId);host.store.control(runId,'author',run.version,'pause','author-takeover');return host.store.readRun(runId);};
  async function createWithinNode(){
    const receipt=await start(),requirements=collectOutlineRequirements(workspace.document,[{unitId:unit.id,nodeIds:['node_a']}]).items.map(item=>item.id);
    const candidate=await propose(receipt.runId,receipt.authorizationRef,'plan_scenes',{nodeId:'node_a'},
      {summary:'机械新增场',scenes:[{localKey:'created',title:'新增场',purpose:'找到记录',location:'房间',timeOfDay:'日',outlineRequirementIds:requirements}]});
    const after=await apply(receipt.runId,receipt.authorizationRef,candidate.id);
    const created=after.document.units[0].scenes.find(scene=>!workspace.document.units[0].scenes.some(old=>old.id===scene.id))!;
    assert.ok(created);assert.equal(created.structureNodeId,'node_a');
    const ledger=JSON.parse((db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?').get(receipt.authorizationRef) as {data_json:string}).data_json);
    assert.ok(ledger.scenes.some((scene:any)=>scene.sceneId===created.id));
    return {receipt,created};
  }
  return {db,host,thread,project,unit,workspace,common,start,waiting,reply,decide,propose,apply,pause,createWithinNode,providerCalls:()=>providerCalls};
}

test('node-created scene retains planning rights and refrozen membership after GOAL_CONTINUE',async t=>{
  const h=setup(t),{receipt,created}=await h.createWithinNode(),paused=h.pause(receipt.runId),goal=h.host.goals.read(receipt.goalId!,'author');
  const continued=await h.host.commands.submit('author',{...h.common,kind:'GOAL_CONTINUE',requestId:'continue-node',goalId:goal.id,
    expectedGoalVersion:goal.version,expectedRunVersion:paused.version},resolve);
  const contract=readScriptGoalEnvelope(h.host.goals.read(goal.id,'author').revision.contract),grant=contract.scope.units[0];
  assert.equal(grant.allowAllScenes,false);assert.ok(grant.nodeScopes?.[0].sceneIds.includes(created.id));
  assert.equal(grant.scenes.find(scene=>scene.sceneId===created.id)?.allowPlan,true);
  const candidate=await h.propose(continued.runId,continued.authorizationRef,'scene_plan',{sceneId:created.id,nodeId:'node_a'},
    {summary:'机械修订分场',title:'修订新场',purpose:'找到记录并确认署名',location:'房间',timeOfDay:'日',entryState:'尚未确认',exitState:'确认记录'});
  const after=await h.apply(continued.runId,continued.authorizationRef,candidate.id);
  assert.equal(after.document.units[0].scenes.find(scene=>scene.id===created.id)!.purpose,'找到记录并确认署名');
  assert.deepEqual(after.document.units[0].scenes.find(scene=>scene.id==='scene_b'),h.workspace.document.units[0].scenes[1]);
  assert.deepEqual(after.document.units[1],h.workspace.document.units[1]);assert.equal(h.providerCalls(),0);
});

test('author can adopt a valid body candidate for a node-created scene after pausing its Goal',async t=>{
  const h=setup(t),{receipt,created}=await h.createWithinNode();
  const source=readScriptGoalEnvelope(h.host.goals.read(receipt.goalId!,'author').revision.contract).scope;
  assert.equal(source.units[0].allowAllScenes,false);assert.ok(!source.units[0].scenes.some(scene=>scene.sceneId===created.id),'source authority must rely on its creation ledger');
  const candidate=await h.propose(receipt.runId,receipt.authorizationRef,'scene_body',{sceneId:created.id,nodeId:'node_a'},
    {summary:'机械正文候选',blocks:[{localKey:'action',type:'action',text:'她展开记录，辨认出纸角的署名。',speakerId:null,speakerName:null}]});
  h.pause(receipt.runId);const goal=h.host.goals.read(receipt.goalId!,'author'),before=h.host.workspaces.read(receipt.workspaceId,'author');
  const applied=await h.host.commands.submit('author',{...h.common,kind:'APPLY',requestId:'author-adopts-created-body',workspaceId:before.id,
    candidateId:candidate.id,expectedRevision:before.revision,writerEpoch:before.writerEpoch,manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}},resolve);
  await h.host.worker.runOnce(applied.runId);const run=h.host.store.readRun(applied.runId);assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));
  const after=h.host.workspaces.read(before.id,'author'),scene=after.document.units[0].scenes.find(item=>item.id===created.id)!;
  assert.equal(after.revision,before.revision+1);assert.equal(scene.blocks[0].text,'她展开记录，辨认出纸角的署名。');
  assert.equal(scene.generation?.status,'complete');assert.equal(h.host.goals.readRunLink(applied.runId)?.role,'MANUAL_STEP');
  const authority=h.host.authorizations.read(applied.authorizationRef,'author').scope as any;
  assert.equal(authority.units[0].allowAllScenes,false);assert.deepEqual(authority.units[0].scenes.map((row:any)=>row.sceneId),[created.id]);
  assert.deepEqual(after.document.units[0].scenes.find(item=>item.id==='scene_b'),h.workspace.document.units[0].scenes[1]);
  assert.deepEqual(after.document.units[1],h.workspace.document.units[1]);assert.equal(h.providerCalls(),0);
});

for(const other of ['node','unit'] as const)test(`scene_plan outside the authorized ${other} is rejected before any draft model request`,async t=>{
  const h=setup(t),receipt=await h.start();
  const target=other==='node'?{unitId:h.unit.id,sceneId:'scene_b'}:{unitId:h.project.units[1].id,sceneId:h.project.units[1].scenes[0].id};
  const request={operation:'scene_plan' as const,instruction:'机械越界请求应被拒绝',...target};
  assert.throws(()=>h.host.drafts.assertProposalTarget(h.host.store.readRun(receipt.runId),request),/未授权|授权范围/);
  await h.decide(receipt.runId,'script.propose',{authorizationRef:receipt.authorizationRef,...request,slotId:null,scopeId:null,entityId:null,blockIds:null,selection:null});
  await h.host.childWorker.runOnce(receipt.runId);
  const requests=h.host.journal.listExternal(receipt.runId,'author');
  assert.ok(requests.length,'the real controller decision was dispatched');
  assert.ok(requests.every(item=>item.request.operationKey.startsWith('decision:')),'out-of-scope raw text must not enter a draft model request');
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_draft_candidates WHERE run_id=?').get(receipt.runId) as {n:number}).n,0);
  assert.deepEqual(h.host.workspaces.read(receipt.workspaceId,'author').document,h.workspace.document);assert.equal(h.providerCalls(),0);
});
