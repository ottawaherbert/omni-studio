import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { compileContext } from '../packages/agent-context/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { prepareScriptConversationContext } from '../apps/api/src/agent/scriptConversationContext';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const decision=(kind:string,fields:Record<string,unknown>={})=>({kind,capabilityId:null,capabilityVersion:null,arguments:null,
  planUpdate:null,message:null,choices:null,artifactRefs:null,summary:null,reason:null,remainingWork:null,...fields});

test('a real Goal decision reads omitted conversation body through the registered, authorized tool',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const oldText='EARLY_AUTHOR_DETAIL_FOR_EXACT_RETRIEVAL';
  let calls=0,readSeen=false;
  const host=createScriptAgentHost(db,{sendOnce:async request=>{
    if(request.operationKey==='reply')return {text:JSON.stringify({question:'【机械协议】收到本次消息',options:[]}),
      provenance:{channel:'provider',producer:'MECHANICAL_CHAT_NO_EXTERNAL_MODEL'}};
    assert.ok(request.operationKey.startsWith('decision:'));
    calls++;
    if(calls===1){
      assert.doesNotMatch(request.prompt,/EARLY_AUTHOR_DETAIL_FOR_EXACT_RETRIEVAL/);
      const catalog=(request.inputManifest as any).allowedGoalTools as Array<{id:string}>;
      assert.ok(catalog.some(item=>item.id==='script.read_conversation'));
      return {text:JSON.stringify(decision('CALL',{capabilityId:'script.read_conversation',capabilityVersion:'1',arguments:{
        authorizationRef:(request.inputManifest as any).scriptGoal.authorizationRef,
        threadId:thread.id,throughTurnId:accepted.turnId,view:'BODY',entryId:'seed:0',cursor:null,maxChars:1000,limit:10,
      }})),provenance:{channel:'provider',producer:'MECHANICAL_DECISION_NO_EXTERNAL_MODEL'}};
    }
    readSeen=request.prompt.includes(oldText);
    return {text:JSON.stringify(decision('ASK',{message:'【机械协议】已读取早期原文',choices:[]})),
      provenance:{channel:'provider',producer:'MECHANICAL_DECISION_NO_EXTERNAL_MODEL'}};
  }},'history-read-test');
  const seed=Array.from({length:30},(_,index)=>({role:'user' as const,text:index===0?oldText:`【机械历史 ${index}】${'后'.repeat(700)}`}));
  const thread=host.conversations.open('author','script:home','history-read',seed);
  const accepted=host.conversations.accept({ownerId:'author',threadId:thread.id,requestId:'history-cutoff',expectedVersion:thread.version,
    requestEnvelope:{text:'现在交付一集'},payload:{text:'现在交付一集'},capabilityId:'script.converse',maxInvocations:1});
  await host.worker.runOnce(accepted.conversation.turns.at(-1)!.runId);
  const prepared=prepareScriptConversationContext({conversations:host.conversations,contexts:host.contexts,ownerId:'author',
    threadId:thread.id,turnId:accepted.turnId,compile:window=>compileContext({systemInstruction:'机械冻结历史',
      sections:[{id:'conversation',text:JSON.stringify(window),required:true,priority:100,dependencies:[]}],skills:[]})});
  assert.ok(!prepared.messages.some(message=>message.text===oldText));
  const goal=await host.commands.submit('author',{kind:'GOAL_START',requestId:'read-early',threadId:thread.id,
    expectedConversationVersion:host.conversations.read(thread.id,'author').version,
    source:{kind:'NEW',title:'【机械新稿】',profile:createScriptCreationProfile('short-film',1,3)},
    objective:'参考较早对话写本集',task:'WRITE',target:{initialUnit:true,initialMaxNewScenes:16},methodIds:[],
    sources:[{purpose:'CONVERSATION',ref:prepared.history}]},
  {resolveMethods:async()=>[],resolveExecution:()=>({channel:'api' as const,routeRef:'mechanical'})});
  await host.worker.runOnce(goal.runId);
  assert.equal(calls,2);
  assert.ok(readSeen,'the next actual model decision must contain the exact earlier body');
  assert.equal(host.store.readRun(goal.runId).status,'WAITING_INPUT');
});
