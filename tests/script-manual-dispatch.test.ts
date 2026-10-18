import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject, newUnit, newScene } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { hashValue } from '../packages/agent-core/src';

const protocol = (kind:'CALL'|'ASK'|'REPLY',operation:string|null=kind==='CALL'?'scene_body':null) => JSON.stringify({kind,operation,question:kind==='CALL'?'':'【机械协议消息，不是剧情】请明确目标',
  options:kind==='CALL'?[]:[{tag:'机械选项',text:'选择当前目标'}]});
function setup(t:any){
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_EXTERNAL_MODEL');}},'manual-dispatch-test',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','manual-dispatch-test');
  const doc=createScriptProject('机械稿',createScriptCreationProfile('short-film',1,5));
  doc.units[0].scenes[0].blocks[0].text='【作者真实原文机械标记】';
  const workspace=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'create-workspace',source:{document:doc}});
  const selection={workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:workspace.document.units[0].id,sceneId:workspace.document.units[0].scenes[0].id};
  const accept=(requestId:string,expectedVersion:number,selected:unknown=selection)=>{
    const target=selected==='NO_SELECTION'?undefined:selected;
    return host.commands.acceptChatTurn({ownerId:'author',threadId:thread.id,
      requestId,expectedVersion,requestEnvelope:{requestId,text:'请在当前场补写正文',...(target===undefined?{}:{selection:target})},
      payload:{text:'请在当前场补写正文',methods:[],template:'{{taskContract}}\n{{conversation}}\n{{methodInstructions}}',channel:'external',routeRef:'mechanical-dispatch',...(target===undefined?{}:{selection:target})},
      text:'请在当前场补写正文',methods:[],route:{channel:'external',routeRef:'mechanical-dispatch'},selection:target});};
  return {db,host,thread,workspace,selection,accept};
}
const runId=(accepted:any)=>accepted.conversation.turns.find((turn:any)=>turn.id===accepted.turnId).runId as string;
const external=(h:ReturnType<typeof setup>,id:string)=>h.host.journal.listExternal(id,'author')[0];

test('manual free text freezes current author scene and ASK preserves same-page dialogue',async t=>{
  const h=setup(t),accepted=h.accept('ask',1),id=runId(accepted);
  assert.deepEqual(h.accept('ask',1),accepted);
  await h.host.worker.runOnce(id);
  const frozen=external(h,id);assert.ok(frozen);assert.match(JSON.stringify(frozen),/作者真实原文机械标记/);
  assert.match(JSON.stringify(frozen),/manual-dispatch/);
  assert.ok(frozen.request.prompt.includes(JSON.stringify({kind:'WORKSPACE',id:h.workspace.id,version:h.workspace.revision})));
  h.host.journal.submitExternal(frozen.id,'author',frozen.inputHash,protocol('ASK'),{name:'mechanical-protocol-constant'});
  await h.host.worker.runOnce(id);
  const turn=h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn;
  assert.equal(h.host.store.readRun(id).status,'SUCCEEDED');
  assert.equal(turn.response.dispatch.kind,'ASK');
  assert.equal(turn.response.options.length,1);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_draft_candidates').get() as any).n,0);
});

test('CALL can freeze exactly one durable proposal under the accepted scene scope',async t=>{
  const h=setup(t),accepted=h.accept('call',1),id=runId(accepted);
  await h.host.worker.runOnce(id);
  const decision=external(h,id);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL'),{name:'mechanical-protocol-constant'});
  await h.host.worker.runOnce(id);
  assert.equal(h.host.store.readRun(id).status,'WAITING_STEP');
  const run=h.host.store.readRun(id),choices=(run.input as any).dispatchOptions;
  const fixed=choices.find((choice:any)=>choice.operation==='scene_body');
  assert.ok(fixed);
  assert.equal(fixed.input.sceneId,h.selection.sceneId);
  assert.equal(fixed.input.unitId,h.selection.unitId);
  assert.ok(choices.some((choice:any)=>choice.operation==='plan_scenes'));
  assert.ok(choices.some((choice:any)=>choice.operation==='add_character'));
  assert.ok(choices.some((choice:any)=>choice.operation==='add_fact'));
  assert.equal((run.input as any).maxInvocations,undefined);
  await h.host.childWorker.runOnce(id);
  const frozen=h.host.journal.listExternal(id,'author').find(item=>item.id!==decision.id)!;
  assert.ok(frozen);assert.match(JSON.stringify(frozen),/作者真实原文机械标记/);
  assert.equal((frozen.request.inputManifest as any).scriptDraft.operation,'scene_body');
  assert.equal(h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response,null);
});

test('invalid selection and stale workspace cannot mint a wider chat authorization',async t=>{
  const h=setup(t);
  assert.throws(()=>h.accept('extra',1,{...h.selection,authorizationRef:'forged'}),/不允许/);
  assert.throws(()=>h.accept('outside',1,{...h.selection,sceneId:'other_scene'}),/场景/);
  const accepted=h.accept('stale',1),id=runId(accepted);
  const current=h.host.workspaces.read(h.workspace.id,'author'),document=structuredClone(current.document);
  document.units[0].scenes[0].blocks[0].text='作者新版原文';
  h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:current.id,requestId:'author-edit-before-dispatch',expectedRevision:current.revision,
    expectedEpoch:current.writerEpoch,document});
  await h.host.worker.runOnce(id);
  assert.equal(h.host.journal.listExternal(id,'author').length,0);
  assert.equal(h.host.store.readRun(id).status,'NEEDS_REBASE',JSON.stringify(h.host.store.readRun(id)));
});

test('model CALL without a trusted target becomes ASK and never freezes a draft',async t=>{
  const h=setup(t),accepted=h.accept('no-target',1,'NO_SELECTION'),id=runId(accepted);
  await h.host.worker.runOnce(id);
  const decision=external(h,id);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL'),{name:'mechanical-protocol-constant'});
  await h.host.worker.runOnce(id);
  const response=h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response;
  assert.equal(h.host.store.readRun(id).status,'SUCCEEDED');
  assert.equal(response.dispatch.kind,'ASK');
  assert.match(response.text,/选择当前要处理的工作稿/);
  assert.equal(h.host.journal.listExternal(id,'author').length,1);
});

for(const operation of ['plan_scenes','add_character','add_fact','unit_outline','concept','theme','project_outline'] as const)
  test(`one chat CALL selects the server-frozen ${operation} capability without applying it`,async t=>{
    const h=setup(t),accepted=h.accept(`choose-${operation}`,1),id=runId(accepted);
    await h.host.worker.runOnce(id);
    const decision=external(h,id);
    assert.ok((decision.request.inputManifest as any).dispatchOptionsHash);
    assert.match(decision.request.prompt,new RegExp(operation));
    h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL',operation),{name:'mechanical-protocol-constant'});
    await h.host.worker.runOnce(id);
    assert.equal(h.host.store.readRun(id).status,'WAITING_STEP');
    await h.host.childWorker.runOnce(id);
    const draft=h.host.journal.listExternal(id,'author').find(item=>item.id!==decision.id);
    assert.ok(draft);
    assert.equal((draft.request.inputManifest as any).scriptDraft.operation,operation);
    if(operation==='plan_scenes'){
      assert.match(draft.request.prompt,/作者真实原文机械标记/);
      assert.match(draft.request.prompt,/planningAnchor/);
    }
    assert.equal(h.host.workspaces.read(h.workspace.id,'author').revision,1);
    assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_draft_candidates').get() as any).n,0);
  });

test('an operation outside the server menu becomes ASK without a child proposal',async t=>{
  const h=setup(t),accepted=h.accept('wrong-operation',1),id=runId(accepted);
  await h.host.worker.runOnce(id);
  const decision=external(h,id);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL','add_unit'),{name:'mechanical-protocol-constant'});
  await h.host.worker.runOnce(id);
  assert.equal(h.host.store.readRun(id).status,'SUCCEEDED');
  assert.equal(h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response.dispatch.kind,'ASK');
  assert.equal(h.host.journal.listExternal(id,'author').length,1);
});

test('a selected block grants only block replacement while still allowing unit planning',async t=>{
  const h=setup(t),blockId=h.workspace.document.units[0].scenes[0].blocks[0].id;
  const accepted=h.accept('block-menu',1,{...h.selection,blockIds:[blockId]}),id=runId(accepted);
  const choices=(h.host.store.readRun(id).input as any).dispatchOptions;
  assert.ok(choices.some((choice:any)=>choice.operation==='replace_blocks'&&choice.input.blockIds[0]===blockId));
  assert.ok(choices.some((choice:any)=>choice.operation==='plan_scenes'));
  assert.ok(!choices.some((choice:any)=>choice.operation==='scene_body'||choice.operation==='replace_selection'));
});

test('a detached or ambiguous text selection is rejected before granting any chat operation',t=>{
  const h=setup(t),blockId=h.workspace.document.units[0].scenes[0].blocks[0].id;
  assert.throws(()=>h.accept('detached',1,{workspaceId:h.workspace.id,expectedRevision:1,unitId:h.selection.unitId,blockIds:[blockId]}),/选区/);
  assert.throws(()=>h.accept('ambiguous',1,{...h.selection,blockIds:[blockId],selection:{start:0,end:1,text:'字'}}),/选区/);
});

test('a paused review-only Goal still lets the author discuss and ASK without minting write access',async t=>{
  const h=setup(t),unitId=h.selection.unitId;
  const started=await h.host.commands.submit('author',{kind:'GOAL_START',requestId:'review-only-chat-goal',threadId:h.thread.id,
    expectedConversationVersion:1,source:{kind:'WORKSPACE',workspaceId:h.workspace.id,expectedRevision:1},
    objective:'机械协议：只审阅',task:'REVIEW',target:{unitIds:[unitId]},methodIds:[]},
    {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical-dispatch'})});
  const goalRun=h.host.store.readRun(started.runId);
  h.host.store.control(goalRun.id,'author',goalRun.version,'pause','pause-review-chat');
  const goal=h.host.goals.read(started.goalId!,'author');
  const accepted=h.accept('review-discussion',1,{...h.selection,manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}}),id=runId(accepted);
  assert.deepEqual((h.host.store.readRun(id).input as any).dispatchOptions,[]);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM script_authorizations WHERE command_id LIKE ?').get('chatstep_%') as any).n,0);
  await h.host.worker.runOnce(id);
  const decision=external(h,id);assert.ok(decision);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL'),{name:'mechanical-protocol-constant'});
  await h.host.worker.runOnce(id);
  const response=h.host.conversations.turn(h.thread.id,accepted.turnId,'author').turn.response;
  assert.equal(response.dispatch.kind,'ASK');
  assert.match(response.text,/当前委托没有可用的写入范围/);
  assert.equal(h.host.journal.listExternal(id,'author').length,1);
});

test('an anthology chat excludes another unit private character from the actual frozen model request',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_EXTERNAL_MODEL');}},'anthology-chat-scope',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','anthology-chat-scope');
  const doc=createScriptProject('机械单元',createScriptCreationProfile('anthology',2,5));
  doc.units[0].scenes[0].blocks[0].text='SELECTED_SCENE_TEXT';
  const other=newUnit('第二单元',300000);doc.units.push(other);
  doc.characters.push({id:'private_other',scopeId:other.scopeId,name:'UNSELECTED_PRIVATE_CHARACTER_SENTINEL',
    desire:'',need:'',voice:'',arc:'',contradiction:''});
  const w=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'anthology-workspace',source:{document:doc}});
  const selection={workspaceId:w.id,expectedRevision:w.revision,unitId:doc.units[0].id,sceneId:doc.units[0].scenes[0].id};
  const accepted=host.commands.acceptChatTurn({ownerId:'author',threadId:thread.id,requestId:'anthology-chat',expectedVersion:1,
    requestEnvelope:{text:'机械协议：只改当前场',selection},payload:{text:'机械协议：只改当前场',methods:[],
      template:'{{taskContract}}\n{{conversation}}',channel:'external',routeRef:'mechanical',selection},
    text:'机械协议：只改当前场',methods:[],route:{channel:'external',routeRef:'mechanical'},selection});
  const id=runId(accepted);await host.worker.runOnce(id);
  const frozen=host.journal.listExternal(id,'author')[0];assert.ok(frozen);
  assert.match(JSON.stringify(frozen),/SELECTED_SCENE_TEXT/);
  assert.doesNotMatch(JSON.stringify(frozen),/UNSELECTED_PRIVATE_CHARACTER_SENTINEL/);
  host.journal.submitExternal(frozen.id,'author',frozen.inputHash,protocol('CALL','scene_body'),{name:'mechanical-protocol-constant'});
  await host.worker.runOnce(id);await host.childWorker.runOnce(id);
  const child=host.journal.listExternal(id,'author').find(item=>item.id!==frozen.id);assert.ok(child);
  assert.match(child.request.prompt,/SELECTED_SCENE_TEXT/);
  assert.doesNotMatch(child.request.prompt,/UNSELECTED_PRIVATE_CHARACTER_SENTINEL/);
});

test('a paused scene-only Goal removes exhausted plan options but retains its authorized scene',async t=>{
  const h=setup(t),doc=createScriptProject('机械局部委托',createScriptCreationProfile('short-film',1,5));
  doc.units[0].scenes[0].blocks[0].text='MECHANICAL_SCENE_BODY';
  const saved=h.host.scripts.saveProject(doc,0);
  const started=await h.host.commands.submit('author',{kind:'GOAL_START',requestId:'scene-only-goal',threadId:h.thread.id,
    expectedConversationVersion:1,source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
    objective:'机械协议：只修当前场',task:'REVISE',target:{unitIds:[saved.units[0].id],
      sceneIds:[{unitId:saved.units[0].id,sceneId:saved.units[0].scenes[0].id}]},methodIds:[]},
    {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical-dispatch'})});
  const goalRun=h.host.store.readRun(started.runId);
  h.host.store.control(goalRun.id,'author',goalRun.version,'pause','pause-scene');
  const goal=h.host.goals.read(started.goalId!,'author'),w=h.host.workspaces.read(started.workspaceId,'author');
  const selected={workspaceId:w.id,expectedRevision:w.revision,unitId:saved.units[0].id,sceneId:saved.units[0].scenes[0].id,
    manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}};
  const accepted=h.accept('scene-goal-chat',1,selected),choices=(h.host.store.readRun(runId(accepted)).input as any).dispatchOptions;
  assert.deepEqual(choices.map((choice:any)=>choice.operation),['scene_body','append_scene_body']);
});

test('a shared-field-only Goal chat never sends an unselected block from the selected scene',async t=>{
  const h=setup(t),doc=createScriptProject('机械窄选区',createScriptCreationProfile('short-film',1,5));
  const first=doc.units[0].scenes[0],second=newScene('第二场');
  first.blocks[0].text='FIRST_AUTHORIZED_SCENE';
  second.blocks[0].text='OUTSIDE_SELECTED_BLOCK_SENTINEL';
  second.blocks.push({id:'block_selected_scope',type:'action',text:'INSIDE_SELECTED_BLOCK_SENTINEL'});
  doc.units[0].scenes.push(second);
  const saved=h.host.scripts.saveProject(doc,0);
  const started=await h.host.commands.submit('author',{kind:'GOAL_START',requestId:'concept-only-goal',threadId:h.thread.id,
    expectedConversationVersion:1,source:{kind:'PROJECT',projectId:saved.id,revision:saved.revision,contentHash:hashValue(saved)},
    objective:'机械协议：只处理共享概念',task:'REVISE',target:{unitIds:[saved.units[0].id],
      sceneIds:[{unitId:saved.units[0].id,sceneId:first.id}],sharedFields:['concept']},methodIds:[]},
    {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical-dispatch'})});
  const goalRun=h.host.store.readRun(started.runId);
  h.host.store.control(goalRun.id,'author',goalRun.version,'pause','pause-concept');
  const goal=h.host.goals.read(started.goalId!,'author'),w=h.host.workspaces.read(started.workspaceId,'author');
  const selection={workspaceId:w.id,expectedRevision:w.revision,unitId:saved.units[0].id,sceneId:second.id,
    blockIds:[second.blocks[1].id],manualGoal:{goalId:goal.id,expectedGoalVersion:goal.version}};
  const accepted=h.accept('concept-selected-block',1,selection),id=runId(accepted);
  assert.deepEqual((h.host.store.readRun(id).input as any).dispatchOptions.map((choice:any)=>choice.operation),['concept']);
  await h.host.worker.runOnce(id);
  const frozen=external(h,id);assert.ok(frozen);
  assert.match(frozen.request.prompt,/INSIDE_SELECTED_BLOCK_SENTINEL/);
  assert.doesNotMatch(frozen.request.prompt,/OUTSIDE_SELECTED_BLOCK_SENTINEL/);
});

test('a plan_scenes child sees only the author-selected block of its current-scene anchor',async t=>{
  const h=setup(t),current=h.host.workspaces.read(h.workspace.id,'author'),document=structuredClone(current.document);
  const scene=document.units[0].scenes[0],selectedId=scene.blocks[0].id;
  scene.blocks.push({id:'block_unselected_anchor',type:'action',text:'OUTSIDE_PLANNING_ANCHOR_SENTINEL'});
  const updated=h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:current.id,requestId:'anchor-author-edit',
    expectedRevision:current.revision,expectedEpoch:current.writerEpoch,document});
  const selected={workspaceId:updated.id,expectedRevision:updated.revision,unitId:document.units[0].id,
    sceneId:scene.id,blockIds:[selectedId]};
  const accepted=h.accept('selected-anchor',1,selected),id=runId(accepted);
  await h.host.worker.runOnce(id);
  const decision=external(h,id);
  h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL','plan_scenes'),{name:'mechanical-protocol-constant'});
  await h.host.worker.runOnce(id);await h.host.childWorker.runOnce(id);
  const child=h.host.journal.listExternal(id,'author').find(item=>item.id!==decision.id);assert.ok(child);
  assert.match(child.request.prompt,/作者真实原文机械标记/);
  assert.doesNotMatch(child.request.prompt,/OUTSIDE_PLANNING_ANCHOR_SENTINEL/);
});

for(const operation of ['replace_blocks','replace_selection'] as const)
  test(`a ${operation} child keeps the author's frozen raw read selection`,async t=>{
    const h=setup(t),current=h.host.workspaces.read(h.workspace.id,'author'),document=structuredClone(current.document);
    const scene=document.units[0].scenes[0],selectedText=scene.blocks[0].text;
    scene.blocks.push({id:'outside_child_block',type:'action',text:'OUTSIDE_CHILD_EDIT_SENTINEL'});
    const updated=h.host.workspaces.saveAuthor({ownerId:'author',workspaceId:current.id,requestId:`author-${operation}-fixture`,expectedRevision:current.revision,
      expectedEpoch:current.writerEpoch,document});
    const selection={workspaceId:updated.id,expectedRevision:updated.revision,unitId:document.units[0].id,sceneId:scene.id,
      ...(operation==='replace_blocks'?{blockIds:[scene.blocks[0].id]}:{selection:{start:0,end:selectedText.length,text:selectedText}})};
    const accepted=h.accept(`narrow-${operation}`,1,selection),id=runId(accepted);
    await h.host.worker.runOnce(id);
    const decision=external(h,id);assert.ok(decision);
    assert.doesNotMatch(decision.request.prompt,/OUTSIDE_CHILD_EDIT_SENTINEL/);
    h.host.journal.submitExternal(decision.id,'author',decision.inputHash,protocol('CALL',operation),{name:'mechanical-protocol-constant'});
    await h.host.worker.runOnce(id);await h.host.childWorker.runOnce(id);
    const child=h.host.journal.listExternal(id,'author').find(item=>item.id!==decision.id);assert.ok(child);
    assert.match(child.request.prompt,/作者真实原文机械标记/);
    assert.doesNotMatch(child.request.prompt,/OUTSIDE_CHILD_EDIT_SENTINEL/);
  });

test('chat and draft keep current-season characters while excluding another season',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw new Error('NO_EXTERNAL_MODEL');}},'season-chat-scope',{trustedLegacyProjectOwner:'author'});
  const thread=host.conversations.open('author','script:home','season-chat-scope');
  const doc=createScriptProject('机械季作用域',createScriptCreationProfile('tv-series',2,5));
  doc.seasons=[{id:'season_one',title:'第一季',arc:''},{id:'season_two',title:'第二季',arc:''}];
  doc.units[0].seasonId='season_one';
  const other=newUnit('第二季单元',300000,doc.id);other.seasonId='season_two';doc.units.push(other);
  doc.characters.push({id:'same_season_character',scopeId:'season_one',name:'SAME_SEASON_CHARACTER_SENTINEL',
    desire:'',need:'',voice:'',arc:'',contradiction:''});
  doc.characters.push({id:'other_season_character',scopeId:'season_two',name:'OTHER_SEASON_CHARACTER_SENTINEL',
    desire:'',need:'',voice:'',arc:'',contradiction:''});
  const w=host.workspaces.create({ownerId:'author',threadId:thread.id,requestId:'season-workspace',source:{document:doc}});
  const selection={workspaceId:w.id,expectedRevision:w.revision,unitId:doc.units[0].id,sceneId:doc.units[0].scenes[0].id};
  const accepted=host.commands.acceptChatTurn({ownerId:'author',threadId:thread.id,requestId:'season-chat',expectedVersion:1,
    requestEnvelope:{text:'机械协议：当前场正文',selection},payload:{text:'机械协议：当前场正文',methods:[],
      template:'{{taskContract}}\n{{conversation}}',channel:'external',routeRef:'mechanical',selection},
    text:'机械协议：当前场正文',methods:[],route:{channel:'external',routeRef:'mechanical'},selection});
  const id=runId(accepted);await host.worker.runOnce(id);
  const first=host.journal.listExternal(id,'author')[0];assert.ok(first);
  assert.match(first.request.prompt,/SAME_SEASON_CHARACTER_SENTINEL/);
  assert.doesNotMatch(first.request.prompt,/OTHER_SEASON_CHARACTER_SENTINEL/);
  host.journal.submitExternal(first.id,'author',first.inputHash,protocol('CALL','scene_body'),{name:'mechanical-protocol-constant'});
  await host.worker.runOnce(id);await host.childWorker.runOnce(id);
  const child=host.journal.listExternal(id,'author').find(item=>item.id!==first.id);assert.ok(child);
  assert.match(child.request.prompt,/SAME_SEASON_CHARACTER_SENTINEL/);
  assert.doesNotMatch(child.request.prompt,/OTHER_SEASON_CHARACTER_SENTINEL/);
});
