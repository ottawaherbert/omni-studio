import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { AgentError, hashValue } from '../packages/agent-core/src';
import { SqliteBudgetStore, SqliteGoalStore } from '../packages/agent-sqlite/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { ScriptCommandService } from '../apps/api/src/agent/scriptCommands';
import { registerScriptCommandRoutes } from '../apps/api/src/routes/scriptCommandRoutes';
import { registerScriptReadCapability } from '../apps/api/src/agent/scriptReadCapability';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';
import { coversScope } from '../apps/api/src/agent/scriptHistory';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { readScriptGoalEnvelope } from '../packages/script/src/agentGoal';
import type { MethodBinding } from '../packages/script/src/schema';

test('history scope intersection rejects removed operations, creation slots and scene allowance',()=>{
  const origin:ScriptDraftScope={workspaceId:'workspace',documentId:'document',originRevision:1,originContentHash:'origin',
    operations:['plan_scenes','scene_body','add_unit'],units:[{unitId:'unit',allowSummary:false,allowAllScenes:true,maxNewScenes:3,scenes:[]}],
    newUnitSlots:[{slotId:'slot',unitId:'unit',scopeId:'document',targetDurationMs:60000,maxNewScenes:3}],
    sharedFields:[],characterScopeIds:[],factScopeIds:[]};
  assert.equal(coversScope(origin,origin),true);
  assert.equal(coversScope({...origin,operations:['scene_body','add_unit']},origin),false);
  assert.equal(coversScope({...origin,newUnitSlots:[]},origin),false);
  assert.equal(coversScope({...origin,newUnitSlots:[{...origin.newUnitSlots[0],maxNewScenes:2}]},origin),false);
  assert.equal(coversScope({...origin,units:[{...origin.units[0],maxNewScenes:2}]},origin),false);
  const spent={scenes:new Map([['unit',1]]),slots:new Map([['slot','unit']])};
  assert.equal(coversScope({...origin,newUnitSlots:[],units:[{...origin.units[0],maxNewScenes:2}]},origin,spent),true,
    'a normal continuation may consume one creation slot and one scene without hiding its prior history');
  assert.equal(coversScope({...origin,newUnitSlots:[],units:[{...origin.units[0],maxNewScenes:1}]},origin,spent),false,
    'an additional author narrowing still removes the older broad history');
});

// Independent receiver faults: in-memory repositories, no creative output and
// no model invocation. Formal worker/HTTP checks are identified separately.
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_MODEL_AUTHORIZED');}},'independent-goal-review',{trustedLegacyProjectOwner:'author'});
  const goals=(host as any).goals as SqliteGoalStore|undefined ?? new SqliteGoalStore(host.store,new SqliteBudgetStore(host.store));
  goals.ensureSchema();
  const commands=new ScriptCommandService({...host,goals});commands.ensureSchema();
  const thread=host.conversations.open('author','script:home','independent-goal-command');
  const base={threadId:thread.id,expectedConversationVersion:thread.version};
  const source={kind:'NEW',title:'MECHANICAL_GOAL',profile:createScriptCreationProfile('feature-film',1,90)};
  const resolvers={resolveMethods:async(ids:string[])=>ids.map(id=>({id,title:'MECHANICAL_METHOD',version:'1',content:'METHOD_V1'})),resolveExecution:()=>({channel:'external' as const,routeRef:'mechanical-no-provider'})};
  const start=(requestId:string)=>({...base,requestId,kind:'GOAL_START',source,objective:'MECHANICAL_WRITE_GOAL',task:'WRITE',target:{initialUnit:true},methodIds:[]});
  const counts=()=>Object.fromEntries(['script_workspaces','script_workspace_revisions','script_authorizations','script_read_grants','agent_goals','agent_goal_commands','agent_runs','script_author_commands'].map(table=>[table,(db.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n]));
  return {db,host,goals,commands,thread,base,source,resolvers,start,counts};
}

test('manual author proposal binds the exact command identity and replay bypasses broken current configuration',async t=>{
  const h=setup(t),command={...h.base,requestId:'manual-proposal',kind:'PROPOSE',source:h.source,operation:'concept',instruction:'MECHANICAL_CONCEPT_REQUEST',target:{},methodIds:[]};
  const first=await h.commands.submit('author',command,h.resolvers);
  const auth=h.host.authorizations.forRun(h.host.store.readRun(first.runId));
  assert.equal(auth.commandId,command.requestId);
  const before=h.counts();
  const replay=await h.commands.submit('author',command,{resolveMethods:async()=>{throw new Error('SKILL_NOW_MISSING');},resolveExecution:()=>{throw new Error('ROUTE_NOW_MISSING');}});
  assert.deepEqual(replay,first);assert.deepEqual(h.counts(),before);
});

test('new complete-film Goal has a usable planning allowance for its server-created initial unit',async t=>{
  const h=setup(t),receipt=await h.commands.submit('author',h.start('new-film'),h.resolvers);
  const contract=readScriptGoalEnvelope(h.goals.read(receipt.goalId!,'author').revision.contract);
  const grant=contract.scope.units[0];
  assert.equal(grant.allowSummary,true,'a complete-unit goal must be able to write its unit outline');
  assert.ok(grant.maxNewScenes>0,'the initial server-generated unit must permit multiple scenes without requiring the browser to guess its ID');
  assert.deepEqual(contract.checks.targetUnitIds,[grant.unitId]);
});

test('next-episode Goal can reserve only a new unit without granting write access to the preceding episode',async t=>{
  const h=setup(t),document=createScriptProject('MECHANICAL_PREVIOUS_EPISODE',createScriptCreationProfile('tv-series',2,20));
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'existing-workspace',source:{document}});
  const command={...h.start('next-episode'),source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},target:{newUnitCount:1}};
  const receipt=await h.commands.submit('author',command,h.resolvers),contract=readScriptGoalEnvelope(h.goals.read(receipt.goalId!,'author').revision.contract);
  assert.equal(contract.scope.units.length,1);assert.equal(contract.scope.newUnitSlots.length,1);
  assert.notEqual(contract.scope.units[0].unitId,document.units[0].id);
  assert.deepEqual(contract.checks.targetUnitIds,receipt.reservedUnitIds);
  assert.deepEqual(h.host.workspaces.read(workspace.id,'author').document,workspace.document);
});

test('rejected new author command rolls back workspace, authorization, Goal and command receipts together',async t=>{
  const h=setup(t),before=h.counts();
  await assert.rejects(h.commands.submit('author',{...h.start('invalid-unit'),target:{unitIds:['missing'],wholeUnitIds:['missing']}},h.resolvers));
  assert.deepEqual(h.counts(),before);
});

test('a concurrent accepted command wins over a later failing Skill resolution for the same author envelope',async t=>{
  const h=setup(t),command=h.start('concurrent-replay');
  let reject!: (error:Error)=>void;
  const delayed=h.commands.submit('author',command,{...h.resolvers,resolveMethods:()=>new Promise<MethodBinding[]>((_resolve,rejectPromise)=>{reject=rejectPromise;})});
  const first=await h.commands.submit('author',command,h.resolvers);
  reject(new Error('SKILL_DELETED_DURING_OTHER_RECEIVER_ACCEPT'));
  assert.deepEqual(await delayed,first);
  assert.equal(h.counts().script_authorizations,1);assert.equal(h.counts().agent_goals,1);
});

test('continuation reissues current authority while retaining the already frozen Skill manifest and route',async t=>{
  const h=setup(t),command={...h.start('start-with-method'),methodIds:['method-v1']};
  const first=await h.commands.submit('author',command,h.resolvers),run=h.host.store.readRun(first.runId);
  h.host.store.control(run.id,'author',run.version,'pause','author-pause');
  const goal=h.goals.read(first.goalId!,'author'),paused=h.host.store.readRun(run.id),revision=goal.revision;
  const receipt=await h.commands.submit('author',{...h.base,kind:'GOAL_CONTINUE',requestId:'continue-frozen-method',goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:paused.version},{resolveMethods:async()=>{throw new Error('NO_SILENT_SKILL_UPGRADE');},resolveExecution:()=>{throw new Error('NO_SILENT_ROUTE_CHANGE');}});
  const next=h.goals.read(goal.id,'author').revision;
  assert.notEqual(next.authorizationRef,revision.authorizationRef);assert.equal(next.authorCommandId,'continue-frozen-method');
  assert.deepEqual(next.skillManifest,revision.skillManifest);assert.deepEqual(next.route,revision.route);
  assert.equal(h.host.authorizations.forRun(h.host.store.readRun(receipt.runId)).id,receipt.authorizationRef);
  assert.equal(next.budgetId,revision.budgetId);
});

test('existing-workspace empty target and forged execution authority fail without selecting the first unit',async t=>{
  const h=setup(t),document=createScriptProject('MECHANICAL_EXISTING',createScriptCreationProfile('tv-series',2,20));
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'existing-target',source:{document}}),before=h.counts();
  await assert.rejects(h.commands.submit('author',{...h.start('missing-target'),source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},target:{}},h.resolvers));
  await assert.rejects(h.commands.submit('author',{...h.start('forged-grant'),authorizationRef:'client-forged',contextRef:{id:'forged',digest:'forged'}},h.resolvers));
  assert.deepEqual(h.counts(),before);
  await assert.rejects(h.commands.submit('other-author',h.start('foreign-thread'),h.resolvers),error=>error instanceof AgentError);
  assert.deepEqual(h.counts(),before);
});

test('author adding an unrelated scene does not consume the Agent creation allowance or widen a continued local Goal',async t=>{
  const h=setup(t),document=createScriptProject('MECHANICAL_LOCAL_REVISION',createScriptCreationProfile('tv-series',2,20));
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'local-workspace',source:{document}});
  const unitId=document.units[0].id,sceneId=document.units[0].scenes[0].id;
  const first=await h.commands.submit('author',{...h.start('local-goal'),task:'REVISE',source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},target:{unitIds:[unitId],sceneIds:[{unitId,sceneId}]}},h.resolvers);
  const run=h.host.store.readRun(first.runId);h.host.store.control(run.id,'author',run.version,'pause','pause-local-goal');
  const original=h.host.workspaces.read(workspace.id,'author'),edited=structuredClone(original.document),added=newScene('AUTHOR_ADDED_UNSELECTED_SCENE');
  edited.units[0].scenes.push(added);
  h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:workspace.id,requestId:'author-added-scene',expectedRevision:original.revision,expectedEpoch:original.writerEpoch,document:edited});
  const goal=h.goals.read(first.goalId!,'author'),paused=h.host.store.readRun(run.id);
  const next=await h.commands.submit('author',{...h.base,kind:'GOAL_CONTINUE',requestId:'continue-after-author-scene',goalId:goal.id,expectedGoalVersion:goal.version,expectedRunVersion:paused.version},h.resolvers);
  const contract=readScriptGoalEnvelope(h.goals.read(next.goalId!,'author').revision.contract);
  assert.equal(contract.scope.units[0].maxNewScenes,0);
  assert.equal(contract.scope.units[0].allowAllScenes,false);
  assert.deepEqual(contract.scope.units[0].scenes.map(scene=>scene.sceneId),[sceneId]);
  assert.equal(h.host.workspaces.read(workspace.id,'author').document.units[0].scenes.at(-1)!.id,added.id);
});

test('manual new-unit outline and scene planning select the unit without an unintended first-scene target',async t=>{
  const h=setup(t);
  for(const operation of ['unit_outline','plan_scenes'] as const){
    const receipt=await h.commands.submit('author',{...h.base,requestId:`new-${operation}`,kind:'PROPOSE',source:h.source,operation,instruction:'MECHANICAL_PLAN_REQUEST',target:{initialUnit:true},methodIds:[]},h.resolvers);
    const run=h.host.store.readRun(receipt.runId),input=(run.input as any).request.input;
    const workspace=h.host.workspaces.read(receipt.workspaceId,'author');
    assert.equal(input.unitId,workspace.document.units[0].id);assert.equal(input.sceneId,null);
  }
});

test('actual HTTP author route accepts persistent external channel but never caller-selected route or owner',async t=>{
  const h=setup(t),app=express();app.use(express.json());let configurationAvailable=true,routeCalls=0;
  registerScriptCommandRoutes(app,{commands:h.commands,owner:()=> 'author',resolveMethods:h.resolvers.resolveMethods,
    resolveExecution:req=>{routeCalls++;if(!configurationAvailable)throw new Error('CURRENT_ROUTE_REMOVED');
      assert.equal(req.body.executionChannel,'external');return {channel:'external',routeRef:'SERVER_FIXED_EXTERNAL'};}});
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const url=`http://127.0.0.1:${(server.address() as any).port}/api/script-commands`;
  const post=(body:unknown)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const command={...h.start('http-external'),executionChannel:'external'},response=await post(command);
  assert.equal(response.status,202);const first=await response.json();
  assert.deepEqual(h.goals.read(first.goalId,'author').revision.route,{channel:'external',routeRef:'SERVER_FIXED_EXTERNAL'});
  configurationAvailable=false;
  const replay=await post(command);assert.equal(replay.status,202);assert.deepEqual(await replay.json(),first);assert.equal(routeCalls,1);
  const before=h.counts();
  assert.equal((await post({...command,requestId:'forged-route',routeRef:'caller-route'})).status,400);
  assert.equal((await post({...command,requestId:'forged-owner',ownerId:'another-author'})).status,400);
  assert.deepEqual(h.counts(),before);
});

test('actual read preparation preserves identified and named dialogue speakers in its manuscript projection',async t=>{
  const h=setup(t),document=createScriptProject('MECHANICAL_DIALOGUE',createScriptCreationProfile('short-film',1,5));
  document.characters.push({id:'character_marker',scopeId:document.id,name:'CHARACTER_ID_NAME',desire:'',need:'',voice:'',arc:'',contradiction:''});
  const scene=document.units[0].scenes[0];scene.blocks=[
    {id:'dialogue_identified',type:'dialogue',text:'MECHANICAL_SAME_LINE',speakerId:'character_marker'},
    {id:'dialogue_named',type:'dialogue',text:'MECHANICAL_SAME_LINE',speakerName:'NAMED_SPEAKER_MARKER'},
  ];
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'dialogue-workspace',source:{document}});
  const receipt=await h.commands.submit('author',{...h.base,requestId:'dialogue-scope',kind:'PROPOSE',source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},operation:'scene_body',instruction:'MECHANICAL_CONTEXT',target:{unitId:document.units[0].id,sceneId:scene.id},methodIds:[]},h.resolvers);
  if(!h.host.registry.describe().some(spec=>spec.id==='script.read'))registerScriptReadCapability(h.host.registry,h.host,hashValue('independent-read-preparation'));
  const claim=h.host.store.claim('independent-reader',30000,receipt.runId)!;
  const prepared=await h.host.registry.prepare({capabilityId:'script.read',capabilityVersion:'1',callId:'independent-read',input:{authorizationRef:receipt.authorizationRef,sourceId:null,view:'BODY',unitId:document.units[0].id,sceneId:scene.id,cursor:null,maxChars:1000,limit:10}},
    {ownerId:'author',scopeId:'script:home',commandRevision:String(claim.run.generation),policyRevision:claim.run.policyRevision,execution:claim.token,signal:new AbortController().signal});
  const rows=(prepared.request.input as any).frozen.projection.rows;
  assert.equal(rows[0].speakerId,'character_marker');assert.equal(rows[0].speakerName,'CHARACTER_ID_NAME');
  assert.equal(rows[1].speakerId,null);assert.equal(rows[1].speakerName,'NAMED_SPEAKER_MARKER');
});

test('manual command shares only the selected paused Goal budget and retains its explicit scene authorization',async t=>{
  const h=setup(t),first=await h.commands.submit('author',h.start('manual-budget-goal'),h.resolvers);
  const run=h.host.store.readRun(first.runId);h.host.store.control(run.id,'author',run.version,'pause','pause-for-manual');
  const goal=h.goals.read(first.goalId!,'author'),workspace=h.host.workspaces.read(first.workspaceId,'author');
  const command={...h.base,kind:'PROPOSE',requestId:'manual-linked-scene',source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},operation:'scene_body',instruction:'MECHANICAL_LOCAL_STEP',target:{unitId:workspace.document.units[0].id,sceneId:workspace.document.units[0].scenes[0].id},methodIds:[],manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}};
  const receipt=await h.commands.submit('author',command,h.resolvers),link=h.goals.readRunLink(receipt.runId)!;
  assert.equal(link.role,'MANUAL_STEP');assert.equal(link.budgetId,goal.revision.budgetId);
  const auth=h.host.authorizations.forRun(h.host.store.readRun(receipt.runId));
  assert.equal(auth.id,receipt.authorizationRef);assert.notEqual(auth.id,goal.revision.authorizationRef);
  const scope=auth.scope as any;assert.equal(scope.units[0].allowAllScenes,false);
  assert.deepEqual(scope.units[0].scenes.map((scene:any)=>scene.sceneId),[workspace.document.units[0].scenes[0].id]);
  const other=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'other-manual-workspace',source:{document:createScriptProject('MECHANICAL_OTHER_WORKSPACE',createScriptCreationProfile('short-film',1,5))}}),before=h.counts();
  await assert.rejects(h.commands.submit('author',{...command,requestId:'wrong-manual-workspace',source:{kind:'WORKSPACE',workspaceId:other.id,expectedRevision:other.revision},target:{unitId:other.document.units[0].id,sceneId:other.document.units[0].scenes[0].id}},h.resolvers));
  assert.deepEqual(h.counts(),before);
});

test('manual Goal association cannot widen one authorized scene or bypass the shared creation allowance',async t=>{
  const h=setup(t),document=createScriptProject('MECHANICAL_NARROW_GOAL',createScriptCreationProfile('tv-series',2,20));
  document.units[0].scenes.push(newScene('MECHANICAL_OTHER_SCENE'));
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.thread.id,requestId:'narrow-manual-workspace',source:{document}});
  const unitId=document.units[0].id,sceneId=document.units[0].scenes[0].id;
  const receipt=await h.commands.submit('author',{...h.start('narrow-manual-goal'),task:'REVISE',
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},
    target:{unitIds:[unitId],sceneIds:[{unitId,sceneId}]}},h.resolvers);
  const run=h.host.store.readRun(receipt.runId);h.host.store.control(run.id,'author',run.version,'pause','manual-scope-review');
  const goal=h.goals.read(receipt.goalId!,'author'),before=h.counts();
  const choices=[
    {operation:'scene_body',target:{unitId,sceneId:document.units[0].scenes[1].id}},
    {operation:'unit_outline',target:{unitId}},
    {operation:'project_outline',target:{}},
    {operation:'plan_scenes',target:{unitId,maxNewScenes:1}},
    {operation:'add_character',target:{scopeId:document.id}},
  ];
  for(const [index,choice] of choices.entries()){
    await assert.rejects(h.commands.submit('author',{...h.base,kind:'PROPOSE',requestId:`denied-manual-expansion-${index}`,
      source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},
      ...choice,instruction:'MECHANICAL_UNAUTHORIZED_EXPANSION',methodIds:[],manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}},h.resolvers),
      error=>error instanceof AgentError&&error.code==='MANUAL_GOAL_SCOPE_DENIED');
    assert.deepEqual(h.counts(),before);
  }
});

test('actual read honors a selected previous episode and its pinned version after the author current pointer advances',async t=>{
  const h=setup(t),document=createScriptProject('MECHANICAL_PREVIOUS_SOURCE',createScriptCreationProfile('tv-series',2,20));
  document.units[0].scenes[0].blocks[0].text='PINNED_SELECTED_EPISODE_V1';
  const excluded=newUnit('EXCLUDED_EPISODE',20*60*1000,document.id);excluded.scenes[0].blocks[0].text='NEVER_READ_EXCLUDED_EPISODE';document.units.push(excluded);
  const saved=h.host.scripts.saveProject(document,0),ref={uri:`resource://script/projects/${saved.id}`,version:String(saved.revision),contentHash:hashValue(saved),branch:'author'};
  const receipt=await h.commands.submit('author',{...h.start('selected-previous'),sources:[{purpose:'PREVIOUS_SCRIPT',ref,unitIds:[saved.units[0].id]}]},h.resolvers);
  if(!h.host.registry.describe().some(spec=>spec.id==='script.read'))registerScriptReadCapability(h.host.registry,h.host,hashValue('independent-pinned-source'));
  const claim=h.host.store.claim('selected-previous-reader',30000,receipt.runId)!,grant=h.host.authorizations.grants(receipt.authorizationRef,'author')[0];
  const context={ownerId:'author',scopeId:'script:home',commandRevision:String(claim.run.generation),policyRevision:claim.run.policyRevision,execution:claim.token,signal:new AbortController().signal};
  const request=(callId:string,unitId:string|null)=>({capabilityId:'script.read',capabilityVersion:'1',callId,input:{authorizationRef:receipt.authorizationRef,sourceId:grant.id,view:'BODY',unitId,sceneId:null,cursor:null,maxChars:1000,limit:10}});
  const initial=await h.host.registry.prepare(request('read-pinned-before',null),context);
  const first=(initial.request.input as any).frozen;
  assert.match(JSON.stringify(first.projection),/PINNED_SELECTED_EPISODE_V1/);assert.doesNotMatch(JSON.stringify(first.projection),/NEVER_READ_EXCLUDED_EPISODE/);
  await assert.rejects(h.host.registry.prepare(request('read-excluded',excluded.id),context),error=>error instanceof AgentError&&error.code==='SCRIPT_SCOPE_DENIED');
  const changed=structuredClone(saved);changed.units[0].scenes[0].blocks[0].text='CURRENT_SELECTED_EPISODE_V2';h.host.scripts.saveProject(changed,saved.revision);
  const later=await h.host.registry.prepare(request('read-pinned-after',null),context),projection=(later.request.input as any).frozen.projection;
  assert.match(JSON.stringify(projection),/PINNED_SELECTED_EPISODE_V1/);assert.doesNotMatch(JSON.stringify(projection),/CURRENT_SELECTED_EPISODE_V2|NEVER_READ_EXCLUDED_EPISODE/);
  const access={ownerId:'author',scopeId:receipt.workspaceId,branch:`workspace:${receipt.workspaceId}`};
  assert.doesNotThrow(()=>h.host.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>h.host.contexts.assertAllowed(first.contextRef,access)));
});

test('an actual UNKNOWN model attempt from a linked manual child blocks continuation of the whole Goal',async t=>{
  const h=setup(t),receipt=await h.commands.submit('author',h.start('manual-unknown-goal'),h.resolvers);
  const original=h.host.store.readRun(receipt.runId);h.host.store.control(original.id,'author',original.version,'pause','pause-for-unknown-manual');
  const goal=h.goals.read(receipt.goalId!,'author'),workspace=h.host.workspaces.read(receipt.workspaceId,'author');
  const manual=await h.commands.submit('author',{...h.base,kind:'PROPOSE',requestId:'manual-unknown-proposal',
    source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},operation:'scene_body',
    instruction:'MECHANICAL_TRANSPORT_FAILURE_INJECTION',target:{unitId:workspace.document.units[0].id,sceneId:workspace.document.units[0].scenes[0].id},methodIds:[],
    manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}},
    {...h.resolvers,resolveExecution:()=>({channel:'api',routeRef:'mechanical-transport-failure'})});
  await h.host.worker.runOnce(manual.runId);await h.host.childWorker.runOnce(manual.runId);
  const unknown=h.db.prepare("SELECT status FROM agent_invocations WHERE run_id=?").all(manual.runId) as Array<{status:string}>;
  assert.ok(unknown.some(row=>row.status==='UNKNOWN'),'the real journal must retain the physically attempted request, not a fabricated unknown row');
  const before=h.counts(),currentGoal=h.goals.read(goal.id,'author'),paused=h.host.store.readRun(receipt.runId);
  await assert.rejects(h.commands.submit('author',{...h.base,kind:'GOAL_CONTINUE',requestId:'continue-around-manual-unknown',goalId:goal.id,
    expectedGoalVersion:currentGoal.version,expectedRunVersion:paused.version},h.resolvers),error=>error instanceof AgentError&&error.code==='RECONCILIATION_REQUIRED');
  assert.deepEqual(h.counts(),before);
});

test('historical story and empty-node scopes cannot be imported after changing only their stable owners',()=>{
  const origin={workspaceId:'w',documentId:'p',originRevision:1,originContentHash:'hash',operations:['story_outline'],units:[],newUnitSlots:[],sharedFields:[],characterScopeIds:[],factScopeIds:[],storyOutlineScopeIds:['story_a']} as ScriptDraftScope;
  assert.equal(coversScope({...origin,storyOutlineScopeIds:['story_b']},origin),false);
  const node={nodeId:'node_a',descendantNodeIds:[],sceneIds:[],structureHash:'structure',outlineHash:'outline',allowCreate:true};
  const nodeScope={...origin,storyOutlineScopeIds:[],operations:['plan_scenes'] as const,units:[{unitId:'u',allowSummary:false,allowAllScenes:false,maxNewScenes:3,scenes:[],nodeScopes:[node]}]};
  const source={...nodeScope,operations:[...nodeScope.operations]};
  assert.equal(coversScope({...source,units:[{...source.units[0],nodeScopes:[{...node,nodeId:'node_b'}]}]},source),false);
  assert.equal(coversScope({...source,units:[{...source.units[0],nodeScopes:[{...node,sceneIds:['legally_created']}]}]},source),true);
});
