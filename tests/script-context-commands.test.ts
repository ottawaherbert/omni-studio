import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject, newScene, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import type { ScriptProject } from '../packages/script/src/schema';
import type { ScriptDraftScope } from '../packages/script/src/agentScope';

const resolve={resolveMethods:async()=>[],resolveExecution:()=>({channel:'external' as const,routeRef:'MECHANICAL_NO_EXTERNAL_MODEL'})};
function fixture(t:any,change?:(project:ScriptProject)=>void){
  const db=new Database(':memory:');t.after(()=>db.close());const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('NO_EXTERNAL_MODEL');}},'context-commands',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','context-commands'),document=createScriptProject('机械协议',createScriptCreationProfile('anthology',3,2));
  document.units[0].scenes[0].blocks[0].text='EXISTING_BODY';change?.(document);
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create',source:{document}});
  return {host,thread,workspace,document,db};
}
async function propose(h:ReturnType<typeof fixture>,operation:string,target:unknown,requestId:string){
  const w=h.host.workspaces.read(h.workspace.id,'author');
  const receipt=await h.host.commands.submit('author',{kind:'PROPOSE',requestId,threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:w.id,expectedRevision:w.revision},operation,instruction:'机械协议测试，按冻结目标执行',target,methodIds:[],executionChannel:'external'},resolve);
  await h.host.worker.runOnce(receipt.runId);await h.host.childWorker.runOnce(receipt.runId);
  const frozen=h.host.journal.listExternal(receipt.runId,'author')[0];assert.ok(frozen,JSON.stringify(h.host.store.readRun(receipt.runId)));
  return {receipt,frozen};
}
async function finishAndApply(h:ReturnType<typeof fixture>,proposal:Awaited<ReturnType<typeof propose>>,value:unknown){
  const {receipt,frozen}=proposal;h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify(value),{name:'MECHANICAL_PROTOCOL_ONLY'});
  for(let i=0;i<5&&h.host.store.readRun(receipt.runId).status!=='SUCCEEDED';i++){await h.host.childWorker.runOnce(receipt.runId);await h.host.worker.runOnce(receipt.runId);}
  const run=h.host.store.readRun(receipt.runId);assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));const candidateId=(run.result as any).data.candidateId;
  const w=h.host.workspaces.read(h.workspace.id,'author'),command={kind:'APPLY',requestId:`apply-${receipt.runId}`,threadId:h.thread.id,expectedConversationVersion:1,workspaceId:w.id,candidateId,expectedRevision:w.revision,writerEpoch:w.writerEpoch};
  const apply=await h.host.commands.submit('author',command,resolve);await h.host.worker.runOnce(apply.runId);
  assert.equal(h.host.store.readRun(apply.runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(apply.runId)));
  assert.deepEqual(await h.host.commands.submit('author',command,resolve),apply,'retry must replay exact application');
  return h.host.workspaces.read(w.id,'author');
}

test('new story and season outline commands adopt only their exact owner; season membership alone cannot authorize the arc',async t=>{
  const h=fixture(t,p=>{p.units[0].scopeId='story_a';p.storyOutlines=[{scopeId:'story_a',outline:'A_OLD'}];p.brief.outline='KEEP_DIRECTORY';p.seasons=[{id:'season',title:'季',arc:'SEASON_OLD'}];const seasonUnit=newUnit('季故事',120000,'season');p.units.push(seasonUnit);p.units[0].seasonId='season';});
  const first=h.document.units[0],seasonUnit=h.document.units[1];
  const implicit=await propose(h,'unit_outline',{unitId:first.id},'implicit-season');
  assert.doesNotMatch(implicit.frozen.request.prompt,/SEASON_OLD/);
  assert.deepEqual((h.host.authorizations.read(implicit.receipt.authorizationRef,'author').scope as ScriptDraftScope).seasonOutlineIds??[],[]);
  await finishAndApply(h,implicit,{summary:'机械本集',content:'A_EPISODE_ONLY'});
  const a=await finishAndApply(h,await propose(h,'story_outline',{unitId:first.id,scopeId:'story_a'},'story'),{summary:'机械',content:'A_NEW'});
  assert.equal(a.document.storyOutlines![0].outline,'A_NEW');assert.equal(a.document.seasons![0].arc,'SEASON_OLD');assert.equal(a.document.brief.outline,'KEEP_DIRECTORY');
  const proposal=await propose(h,'season_outline',{unitId:seasonUnit.id,seasonId:'season'},'season');
  assert.match(proposal.frozen.request.prompt,/SEASON_OLD/);assert.doesNotMatch(proposal.frozen.request.prompt,/A_NEW|KEEP_DIRECTORY/);
  const b=await finishAndApply(h,proposal,{summary:'机械',content:'SEASON_NEW'});assert.equal(b.document.seasons![0].arc,'SEASON_NEW');assert.equal(b.document.storyOutlines![0].outline,'A_NEW');
});

test('structure, scene plan and partial continuation commands apply through the real candidate pipeline',async t=>{
  const h=fixture(t),unit=h.document.units[0],scene=unit.scenes[0];
  const structured=await finishAndApply(h,await propose(h,'plan_structure',{unitId:unit.id},'structure'),{summary:'机械结构',nodes:[{localKey:'part',parentLocalKey:null,title:'相遇段',purpose:'见到来客',sceneIds:[scene.id]}]});
  const nodeId=structured.document.units[0].structureNodes![0].id;assert.equal(structured.document.units[0].scenes[0].structureNodeId,nodeId);
  const planned=await finishAndApply(h,await propose(h,'scene_plan',{unitId:unit.id,sceneId:scene.id,nodeId},'scene-plan'),{summary:'机械场计划',title:'见到来客',purpose:'确认来意',location:'门外',timeOfDay:'夜',entryState:'尚未交谈',exitState:'知道来意',outlineRequirementIds:null});
  assert.equal(planned.document.units[0].scenes[0].purpose,'确认来意');assert.equal(planned.document.units[0].scenes[0].blocks[0].text,'EXISTING_BODY');
  const partial=await finishAndApply(h,await propose(h,'append_scene_body',{unitId:unit.id,sceneId:scene.id,nodeId},'append-partial'),{summary:'第一批',blocks:[{localKey:'b1',type:'action',text:'FIRST_NEW_BLOCK',speakerId:null,speakerName:null}],isComplete:false});
  assert.equal(partial.document.units[0].scenes[0].generation?.status,'partial');
  const final=await finishAndApply(h,await propose(h,'append_scene_body',{unitId:unit.id,sceneId:scene.id,nodeId},'append-complete'),{summary:'第二批',blocks:[{localKey:'b2',type:'action',text:'SECOND_NEW_BLOCK',speakerId:null,speakerName:null}],isComplete:true});
  assert.deepEqual(final.document.units[0].scenes[0].blocks.map(block=>block.text),['EXISTING_BODY','FIRST_NEW_BLOCK','SECOND_NEW_BLOCK']);assert.equal(final.document.units[0].scenes[0].generation?.status,'complete');
});

test('a node planning request reads its insertion anchor and bounded predecessor without turning them into write permission',async t=>{
  const h=fixture(t,p=>{const unit=p.units[0];unit.structureNodes=[{id:'n1',title:'前段',purpose:'铺垫'},{id:'n2',title:'本段',purpose:'本段目标'},{id:'n3',title:'后段',purpose:'后段'}];unit.scenes[0].structureNodeId='n1';unit.scenes[0].blocks[0].text='PRECEDING_END';
    const middle=newScene('当前场');middle.structureNodeId='n2';middle.blocks[0].text='NODE_INSERTION_ANCHOR';const last=newScene('很远的尾场');last.structureNodeId='n3';last.blocks[0].text='UNRELATED_UNIT_TAIL';unit.scenes.push(middle,last);});
  const unit=h.document.units[0],result=await propose(h,'plan_scenes',{unitId:unit.id,nodeId:'n2',maxNewScenes:2},'node-plan');
  assert.match(result.frozen.request.prompt,/NODE_INSERTION_ANCHOR/);assert.match(result.frozen.request.prompt,/PRECEDING_END/);assert.doesNotMatch(result.frozen.request.prompt,/UNRELATED_UNIT_TAIL/);
  const scope=h.host.authorizations.read(result.receipt.authorizationRef,'author').scope as any;
  assert.deepEqual(scope.units[0].nodeScopes[0].sceneIds,[unit.scenes[1].id]);assert.equal(scope.units[0].allowAllScenes,false);
});

test('new-unit continuation preserves the selected story scope instead of silently creating an independent story',async t=>{
  const h=fixture(t,p=>{p.units[0].scopeId='story_a';p.storyOutlines=[{scopeId:'story_a',outline:'同一故事'}];});
  const w=await finishAndApply(h,await propose(h,'add_unit',{scopeId:'story_a'},'continue-story'),{summary:'机械续篇',title:'续篇',unitSummary:'接前篇'});
  assert.equal(w.document.units.length,2);assert.equal(w.document.units[1].scopeId,'story_a');assert.equal(w.document.units[1].scenes.length,0);
});

test('node review freezes only the selected scene manifest while keeping its shared workspace read source',async t=>{
  const h=fixture(t,p=>{const unit=p.units[0];unit.structureNodes=[{id:'n1',title:'审阅段',purpose:'核对本段'},{id:'n2',title:'其他段',purpose:'其他'}];unit.scenes[0].structureNodeId='n1';const other=newScene('其他场');other.structureNodeId='n2';other.blocks[0].text='NOT_IN_REVIEW_MANIFEST';unit.scenes.push(other);});
  const unit=h.document.units[0],receipt=await h.host.commands.submit('author',{kind:'GOAL_START',requestId:'node-review',threadId:h.thread.id,expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},task:'REVIEW',objective:'只审阅所选段落',target:{unitIds:[unit.id],structureTargets:[{unitId:unit.id,nodeId:'n1'}]},methodIds:[],executionChannel:'external'},resolve);
  const claim=h.host.store.claim('manifest-check',30000,receipt.runId)!;assert.ok(claim);
  const review=h.host.authorizations.withRunAuthorization(claim.run,'CONSUME',()=>h.host.reviews.readStatus(claim.token));
  assert.deepEqual(review.contract.targetScenes,[{unitId:unit.id,sceneIds:[unit.scenes[0].id]}]);
  assert.deepEqual(review.manifest.units[0].scenes.map(scene=>scene.sceneId),[unit.scenes[0].id]);assert.doesNotMatch(JSON.stringify(review.manifest),/NOT_IN_REVIEW_MANIFEST/);
  const scope=h.host.authorizations.read(receipt.authorizationRef,'author').scope as any;assert.deepEqual(scope.operations,[]);assert.equal(scope.units[0].nodeScopes[0].allowCreate,false);
});

test('unsaved local scene is available for discussion only, and a model CALL cannot mint tools or authorization',async t=>{
  const h=fixture(t),localDraft=structuredClone(h.document),scene=newScene('未保存新场');scene.blocks[0].text='LOCAL_UNSAVED_TEXT';localDraft.units[0].scenes.push(scene);
  const selection={workspaceId:h.workspace.id,expectedRevision:1,unitId:localDraft.units[0].id,sceneId:scene.id,localDraft};
  const accepted=h.host.commands.acceptChatTurn({ownerId:'author',threadId:h.thread.id,requestId:'local-discuss',expectedVersion:1,requestEnvelope:{text:'讨论未保存新场',selection},payload:{text:'讨论未保存新场',methods:[],template:'{{taskContract}}\n{{conversation}}\n{{methodInstructions}}',channel:'external',routeRef:'mechanical',selection},text:'讨论未保存新场',methods:[],route:{channel:'external',routeRef:'mechanical'},selection});
  const turn=accepted.conversation.turns.find((item:any)=>item.id===accepted.turnId)!,runId=turn.runId;
  assert.equal((h.host.store.readRun(runId).input as any).authorizationRef,undefined);await h.host.worker.runOnce(runId);
  const frozen=h.host.journal.listExternal(runId,'author')[0];assert.ok(frozen,JSON.stringify(h.host.store.readRun(runId)));assert.match(frozen.request.prompt,/LOCAL_UNSAVED_TEXT/);assert.match(frozen.request.prompt,/未保存草稿/);
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,JSON.stringify({kind:'CALL',operation:'scene_body',entityId:null,question:'',options:[]}),{name:'MECHANICAL_PROTOCOL_ONLY'});await h.host.worker.runOnce(runId);
  const response=h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response;assert.equal(response.dispatch.kind,'ASK');
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_draft_candidates').get() as any).n,0);assert.equal(h.host.workspaces.read(h.workspace.id,'author').revision,1);
});


test('first partial body batch accepts the initial unsaved-project revision checkpoint',async t=>{
  const h=fixture(t,p=>{p.units[0].scenes[0].blocks=[];}),unit=h.document.units[0],scene=unit.scenes[0];
  const next=await finishAndApply(h,await propose(h,'append_scene_body',{unitId:unit.id,sceneId:scene.id},'first-batch'),{summary:'首批',blocks:[{localKey:'first',type:'action',text:'FIRST_SAVED_BATCH',speakerId:null,speakerName:null}],isComplete:false});
  assert.equal(next.document.units[0].scenes[0].generation?.status,'partial');assert.equal(next.document.units[0].scenes[0].blocks[0].text,'FIRST_SAVED_BATCH');
});

for(const authored of [false,true])test(`ordinary first plan_scenes ${authored?'preserves authored placeholder':'replaces only true empty placeholder'} through propose/apply`,async t=>{
  const h=fixture(t,p=>{const scene=p.units[0].scenes[0];scene.blocks[0].text=authored?'作者保留的正文':'';});
  const unit=h.document.units[0],oldScene=structuredClone(unit.scenes[0]);
  const proposal=await propose(h,'plan_scenes',{unitId:unit.id},'first-scenes');
  const after=await finishAndApply(h,proposal,{summary:'机械分场',scenes:[{localKey:'first',title:'开场',purpose:'抵达',location:'车站',timeOfDay:'日',outlineRequirementIds:null}]});
  assert.equal(after.document.units[0].scenes.length,authored?2:1);
  if(authored)assert.deepEqual(after.document.units[0].scenes[0],oldScene);
  else assert.notEqual(after.document.units[0].scenes[0].id,oldScene.id);
});
