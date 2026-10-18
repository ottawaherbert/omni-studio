import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { SCRIPT_CHAT_TEMPLATE } from '../apps/api/src/agent/scriptConversation';
import { createScriptProject } from '../packages/script/src/project';
import { readScriptGoalEnvelope } from '../packages/script/src/agentGoal';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const start={kind:'START',stopAfter:'BODY',blueprint:null,question:'【机械回填】启动一部三分钟短片的完整委托。',options:[],title:'【机械入口稿】',format:'short-film',plannedUnits:1,targetMinutes:3};
const ask={kind:'ASK',question:'【机械问题】本次完成短片还是一集？',options:[{tag:'短片',text:'完成三分钟短片'}],title:null,format:null,plannedUnits:null,targetMinutes:null};
const discussion={...ask,kind:'REPLY',blueprint:null,stopAfter:null};
function setup(t:any,reply:any=start,encode:(value:any)=>string=JSON.stringify){
  const db=new Database(':memory:');t.after(()=>db.close());let sends=0;
  const host=createScriptAgentHost(db,{sendOnce:async request=>{
    sends++;assert.ok(['assistant-start','manual-dispatch'].includes(request.operationKey));
    return {text:encode(reply),provenance:{channel:'provider',producer:'MECHANICAL_ENTRY_FIXTURE_NO_EXTERNAL_MODEL'}};
  }},'entry-audit');
  const conversation=host.conversations.open('author','script:home','entry');
  return {db,host,conversation,sends:()=>sends};
}
async function sendHome(h:ReturnType<typeof setup>,intent:'AUTO'|'AGENT'|'BLUEPRINT'='AUTO',stopAfter?:'OUTLINE'){
  const accepted=h.host.conversations.accept({ownerId:'author',threadId:h.conversation.id,requestId:'format-check',expectedVersion:1,
    requestEnvelope:{text:'【机械题材】穿越修仙',intent},payload:{intent,text:'【机械题材】穿越修仙',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical',...(stopAfter?{stopAfter}:{})},
    capabilityId:'script.assistant_start',maxInvocations:1});
  const runId=accepted.conversation.turns[0].runId;
  await h.host.worker.runOnce(runId);
  return {run:h.host.store.readRun(runId),response:h.host.conversations.turn(h.conversation.id,accepted.turnId,'author').turn.response};
}
const encodings={
  'bare wrapped JSON':(value:any)=>JSON.stringify({response:value}),
  'wrapped JSON fence':(value:any)=>'```json\n'+JSON.stringify({response:value})+'\n```',
  'legacy bare JSON fence':(value:any)=>'```json\n'+JSON.stringify(value)+'\n```',
  'CRLF and uppercase JSON fence':(value:any)=>'\n ```JSON\r\n'+JSON.stringify({response:value})+'\r\n``` \n',
  'unlabelled JSON fence':(value:any)=>'```\n'+JSON.stringify({response:value})+'\n```',
};
for(const [name,encode] of Object.entries(encodings))test(`home accepts ${name}, preserves raw evidence and does not resend`,async t=>{
  const h=setup(t,discussion,encode),{run,response}=await sendHome(h);
  assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));
  assert.equal(response.text,discussion.question);assert.deepEqual(response.options,discussion.options);
  const raw=encode(discussion);assert.equal(response.rawResult,raw);
  const invocation=h.db.prepare('SELECT request_json,result_json FROM agent_invocations WHERE run_id=?').get(run.id) as any;
  assert.equal(JSON.parse(invocation.result_json).text,raw);
  assert.match(JSON.parse(invocation.request_json).systemInstruction,/不要 Markdown 代码块/);
  await h.host.worker.runOnce(run.id);assert.equal(h.sends(),1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_attempts').get() as any).n,1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,0);
});
const invalidReplies={
  'explanation before a fence':'回复如下：\n```json\n'+JSON.stringify({response:start})+'\n```',
  'explanation after a fence':'```json\n'+JSON.stringify({response:start})+'\n```\n开始执行。',
  'multiple fenced answers':'```json\n'+JSON.stringify({response:start})+'\n```\n```json\n'+JSON.stringify({response:start})+'\n```',
  'unclosed fence':'```json\n'+JSON.stringify({response:start}),
  'truncated JSON':'```json\n{"response":{"kind":"START"\n```',
  'wrong field type':'```json\n'+JSON.stringify({response:{...start,options:'执行'}})+'\n```',
  'wrapper with extra fields':'```json\n'+JSON.stringify({response:start,execute:true})+'\n```',
  'unsupported fence language':'```javascript\n'+JSON.stringify({response:start})+'\n```',
};
for(const [name,raw] of Object.entries(invalidReplies))test(`home rejects ${name} without creating a work or retrying`,async t=>{
  const h=setup(t,start,()=>raw),{run,response}=await sendHome(h,'AGENT');
  assert.equal(run.status,'FAILED',JSON.stringify(run));assert.equal(response,null);assert.equal(h.sends(),1);
  const invocation=h.db.prepare('SELECT status,result_json FROM agent_invocations WHERE run_id=?').get(run.id) as any;
  assert.equal(invocation.status,'RECEIVED');assert.equal(JSON.parse(invocation.result_json).text,raw);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,0);
});
test('a fenced START in ordinary mode still cannot start a continuous delegation',async t=>{
  const h=setup(t,start,encodings['wrapped JSON fence']),{run,response}=await sendHome(h);
  assert.equal(run.status,'SUCCEEDED');assert.equal(response.replyKind,'READY');
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
});
test('a fenced Agent reply still cannot exceed the author stop stage',async t=>{
  const h=setup(t,start,encodings['wrapped JSON fence']),{run,response}=await sendHome(h,'AGENT','OUTLINE');
  assert.equal(run.status,'FAILED');assert.equal(response,null);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
});
test('home Agent creates a durable Goal and separate workspace, never a one-shot author blueprint',async t=>{
  const h=setup(t),methods=[{id:'skill:method',title:'机械方法',version:'v2',content:'【方法完整末段】'}];
  const identity={ownerId:'author',threadId:h.conversation.id,requestId:'home-start',expectedVersion:1,requestEnvelope:{intent:'AGENT',text:'完成三分钟短片'}};
  const accepted=h.host.conversations.accept({...identity,payload:{intent:'AGENT',text:'完成三分钟短片',methods,template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},capabilityId:'script.assistant_start',maxInvocations:1});
  const runId=accepted.conversation.turns[0].runId;await h.host.worker.runOnce(runId);
  const run=h.host.store.readRun(runId);assert.equal(run.status,'SUCCEEDED',JSON.stringify(run));
  const response=h.host.conversations.turn(h.conversation.id,accepted.turnId,'author').turn.response;
  assert.ok(response.goal.goalId);const goal=h.host.goals.read(response.goal.goalId,'author');
  assert.equal(h.host.store.readRun(response.goal.runId).kind,'GOAL');
  assert.deepEqual(goal.revision.skillManifest,methods);assert.equal(goal.revision.route.routeRef,'mechanical');
  const workspace=h.host.workspaces.read(response.goal.workspaceId,'author');assert.equal(workspace.projectId,null);
  assert.equal(h.host.scripts.getProject(workspace.documentId),null);
  assert.equal(workspace.document.profile.targetDurationMs,180000);
  const scope=(goal.revision.contract.value as any).scope;
  assert.equal(scope.units[0].maxNewScenes,16);
  assert.ok(h.host.budgets.read(goal.revision.budgetId,'author').limits.maxInvocations>=20+4*16+22);
  const repeated=h.host.conversations.accept({...identity,payload:{},capabilityId:'script.assistant_start',maxInvocations:1});
  assert.equal(repeated.turnId,accepted.turnId);assert.equal(h.sends(),1);
  assert.equal((h.db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,1);
});
test('home direction question remains in the same conversation with clickable choices and creates no work',async t=>{
  const h=setup(t,ask),accepted=h.host.conversations.accept({ownerId:'author',threadId:h.conversation.id,requestId:'home-ask',expectedVersion:1,requestEnvelope:{},
    payload:{intent:'AGENT',text:'写一点修仙',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},capabilityId:'script.assistant_start',maxInvocations:1});
  await h.host.worker.runOnce(accepted.conversation.turns[0].runId);
  const response=h.host.conversations.turn(h.conversation.id,accepted.turnId,'author').turn.response;
  assert.equal(response.text,ask.question);assert.deepEqual(response.options,ask.options);
  assert.equal((h.db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,0);
});
for(const [operation,task] of [['review_goal','REVIEW'],['revise_goal','REVISE'],['write_goal','WRITE']] as const){
  test(`author chat dispatches ${operation} through the real shared Goal service`,async t=>{
    const h=setup(t,{kind:'CALL',operation,question:'【机械协议】执行作者要求',options:[]});
    const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.conversation.id,requestId:'base',source:{document:createScriptProject('原稿',createScriptCreationProfile('short-film',1,3))}});
    const unit=workspace.document.units[0],scene=unit.scenes[0];
    const accepted=h.host.commands.acceptChatTurn({ownerId:'author',threadId:h.conversation.id,requestId:operation,expectedVersion:1,requestEnvelope:{operation},text:'【机械作者要求】处理当前稿',
      methods:[],route:{channel:'api',routeRef:'mechanical'},payload:{text:'【机械作者要求】处理当前稿',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},
      selection:{workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:unit.id,sceneId:scene.id}});
    const runId=accepted.conversation.turns[0].runId;await h.host.worker.runOnce(runId);
    assert.equal(h.host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(h.host.store.readRun(runId)));
    const response=h.host.conversations.turn(h.conversation.id,accepted.turnId,'author').turn.response;
    assert.ok(response.goal.goalId);const goal=h.host.goals.read(response.goal.goalId,'author');assert.equal(readScriptGoalEnvelope(goal.revision.contract).task,task);
    const auth=h.host.authorizations.read(goal.revision.authorizationRef,'author');
    assert.equal((auth.scope as any).units[0].allowAllScenes,false);
    assert.equal(h.host.workspaces.read(workspace.id,'author').revision,workspace.revision);
  });
}

test('author chat can explicitly delegate the whole selected unit without writing its author draft',async t=>{
  const h=setup(t,{kind:'CALL',operation:'write_goal',question:'【机械协议】写本集',options:[]});
  const workspace=h.host.workspaces.create({ownerId:'author',threadId:h.conversation.id,requestId:'whole-unit-base',
    source:{document:createScriptProject('【机械整集作者稿】',createScriptCreationProfile('tv-series',2,3))}});
  const unit=workspace.document.units[0],original=JSON.stringify(workspace.document);
  const accepted=h.host.commands.acceptChatTurn({ownerId:'author',threadId:h.conversation.id,requestId:'whole-unit',expectedVersion:1,
    requestEnvelope:{target:'unit'},text:'【机械作者要求】完成这一整集',methods:[],route:{channel:'api',routeRef:'mechanical'},
    payload:{text:'【机械作者要求】完成这一整集',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},
    selection:{workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:unit.id}});
  const runId=accepted.conversation.turns[0].runId;await h.host.worker.runOnce(runId);
  assert.equal(h.host.store.readRun(runId).status,'SUCCEEDED');
  const goalReceipt=h.host.conversations.turn(h.conversation.id,accepted.turnId,'author').turn.response.goal;
  const goal=h.host.goals.read(goalReceipt.goalId,'author'),scope=(goal.revision.contract.value as any).scope;
  assert.equal(scope.units[0].unitId,unit.id);assert.equal(scope.units[0].allowAllScenes,true);
  assert.equal(JSON.stringify(h.host.workspaces.read(workspace.id,'author').document),original);
});


test('home real worker uses one durable correction without starting an unauthorized Goal',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let calls=0;
  const host=createScriptAgentHost(db,{
    outputPolicy:()=>({validateSchema:true,maxFormatCorrections:1}),
    sendOnce:async request=>{calls++;if(calls===2)assert.ok(request.formatCorrection);return {text:calls===1?'not-json':JSON.stringify({response:discussion}),provenance:{channel:'provider'}};},
  },'correction-test');
  const conversation=host.conversations.open('author','script:home','correction');
  const accepted=host.conversations.accept({ownerId:'author',threadId:conversation.id,requestId:'corrected-home',expectedVersion:1,requestEnvelope:{},
    payload:{intent:'AUTO',text:'机械题材',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},capabilityId:'script.assistant_start',maxInvocations:2});
  const runId=accepted.conversation.turns[0].runId;await host.worker.runOnce(runId);
  assert.equal(host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(host.store.readRun(runId)));
  assert.equal(calls,2);assert.equal(host.conversations.turn(conversation.id,accepted.turnId,'author').turn.response.text,discussion.question);
  assert.equal((db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
  assert.equal((db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,0);
});
