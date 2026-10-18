import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { SCRIPT_CHAT_TEMPLATE } from '../apps/api/src/agent/scriptConversation';

test('same-page discussion preserves input during an active Goal and starts after explicit pause', async t => {
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('external-only protocol');}},'chat-bypass-worker');
  const conversation=host.conversations.open('author','script:home','same-page');
  const started=await host.commands.submit('author',{kind:'GOAL_START',requestId:'goal',threadId:conversation.id,
    expectedConversationVersion:1,source:{kind:'NEW',title:'【机械聊天】',profile:createScriptCreationProfile('short-film',1,5)},
    objective:'【机械协议】等待决策',task:'WRITE',target:{initialUnit:true},methodIds:[]},
  {resolveMethods:async()=>[],resolveExecution:()=>({channel:'external',routeRef:'mechanical'})});
  await host.worker.runOnce(started.runId);
  assert.equal(host.store.readRun(started.runId).status,'WAITING_EXTERNAL');
  const discuss=()=>host.conversations.accept({ownerId:'author',threadId:conversation.id,requestId:'discussion',expectedVersion:1,
    requestEnvelope:{text:'【机械协议】讨论',requestId:'discussion'},payload:{text:'【机械协议】讨论',methods:[],template:SCRIPT_CHAT_TEMPLATE,
      channel:'external',routeRef:'mechanical'},capabilityId:'script.converse',maxInvocations:1});
  assert.throws(discuss,(error:any)=>error.code==='CONVERSATION_GOAL_ACTIVE');
  assert.equal(host.conversations.read(conversation.id,'author').turns.length,0);
  const goalRun=host.store.readRun(started.runId);
  host.store.control(goalRun.id,'author',goalRun.version,'pause','pause-before-discussion');
  const accepted=discuss();
  const chatRunId=accepted.conversation.turns.find(turn=>turn.id===accepted.turnId)!.runId;
  await host.worker.runOnce(chatRunId);
  assert.equal(host.store.readRun(chatRunId).status,'WAITING_EXTERNAL');
  assert.equal(host.journal.listExternal(chatRunId,'author')[0].status,'WAITING');
  assert.equal(host.store.readRun(started.runId).status,'PAUSED');
  const later=host.store.accept({ownerId:'author',threadId:conversation.id,scopeId:'script:home',requestId:'later-write',
    kind:'CAPABILITY',input:{},policyRevision:'mechanical',maxInvocations:1});
  assert.equal(host.store.claim('attacker',30000,later.runId),null);
});
