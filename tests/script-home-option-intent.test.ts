import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptHomeFollowupIntent, scriptHomeOptionIntent } from '../apps/web/src/features/script/scriptHomeOptionIntent';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { SCRIPT_CHAT_TEMPLATE } from '../apps/api/src/agent/scriptConversation';

test('selecting an Agent ASK answer retains the creation delegation',()=>{
  const option={tag:'电影',text:'一部独立电影'};
  assert.equal(scriptHomeOptionIntent({input:{intent:'AGENT'},response:{options:[option]}},option),'AGENT');
  assert.equal(scriptHomeOptionIntent({input:{intent:'AUTO'},response:{options:[option]}},option),'AUTO');
  assert.equal(scriptHomeOptionIntent({input:{intent:'AGENT'},response:{options:[{tag:'另一项',text:'另一方向'}]}},option),'AUTO');
  assert.equal(scriptHomeOptionIntent({input:{intent:'AGENT'},response:{options:[option],goal:{id:'already-started'}}},option),'AUTO');
  assert.equal(scriptHomeFollowupIntent({input:{intent:'AGENT'},response:{options:[option]}}),'AGENT');
  assert.equal(scriptHomeFollowupIntent({input:{intent:'AGENT'},response:{goal:{id:'already-started'}}}),'AUTO');
});

test('Agent ASK free-text reply can start the durable writing Goal on its next turn',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let calls=0;
  const host=createScriptAgentHost(db,{sendOnce:async()=>{
    calls++;
    const common={question:'【机械答复】方向已明确',options:[],title:null,format:null,plannedUnits:null,targetMinutes:null};
    const response=calls===1?{...common,kind:'ASK',question:'【机械追问】选择形态',options:[{tag:'电影',text:'一部独立电影'}]}:
      {...common,kind:'START',stopAfter:'BODY',blueprint:null,title:'【机械协议作品】',format:'short-film',plannedUnits:1,targetMinutes:3};
    return {text:JSON.stringify({response}),provenance:{channel:'provider' as const,producer:'MECHANICAL_OPTION_INTENT'}};
  }},'home-option-intent');
  const thread=host.conversations.open('author','script:home','option-intent');
  const accept=(requestId:string,text:string,intent:'AUTO'|'AGENT',version:number)=>host.conversations.accept({
    ownerId:'author',threadId:thread.id,requestId,expectedVersion:version,requestEnvelope:{text,intent},
    payload:{text,intent,methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},
    capabilityId:'script.assistant_start',maxInvocations:2});
  const first=accept('start','请创作剧本','AGENT',thread.version);
  await host.worker.runOnce(first.conversation.turns.at(-1)!.runId);
  const updated=host.conversations.read(thread.id,'author'),option=updated.turns[0].response!.options![0];
  const intent=scriptHomeFollowupIntent(updated.turns[0] as any);
  assert.equal(intent,'AGENT');
  const second=accept('answer',`【${option.tag}】${option.text}`,intent,updated.version);
  await host.worker.runOnce(second.conversation.turns.at(-1)!.runId);
  const result=host.conversations.read(thread.id,'author').turns.at(-1)!.response!;
  assert.ok(result.goal);assert.equal(calls,2);
});
