import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { SCRIPT_CHAT_TEMPLATE } from '../apps/api/src/agent/scriptConversation';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

type DirectMode='converse'|'assistant-start'|'manual-dispatch';
const directModes=['converse','assistant-start','manual-dispatch'] as const;
const fencedJson=(value:unknown,label='json')=>`\`\`\`${label}\n${JSON.stringify(value)}\n\`\`\``;
const answerFor=(mode:DirectMode,question:string)=>mode==='manual-dispatch'
  ? {kind:'REPLY',operation:null,question,options:[],entityId:null,analysis:null}
  : mode==='assistant-start'
    ? {kind:'REPLY',question,options:[],title:null,format:null,plannedUnits:null,targetMinutes:null,blueprint:null,stopAfter:null}
    : {question,options:[]};
function acceptDirectTurn(host:ReturnType<typeof createScriptAgentHost>,threadId:string,mode:DirectMode,requestId:string){
  const payload={text:'【机械作者请求】讨论当前方向',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api' as const,routeRef:'mechanical'};
  if(mode==='manual-dispatch'){
    const workspace=host.workspaces.create({ownerId:'author',threadId,requestId:`base:${requestId}`,
      source:{document:createScriptProject('【机械稿】',createScriptCreationProfile('short-film',1,3))}});
    const unit=workspace.document.units[0],scene=unit.scenes[0];
    return host.commands.acceptChatTurn({ownerId:'author',threadId,requestId,expectedVersion:1,requestEnvelope:{requestId},
      text:payload.text,methods:[],route:{channel:'api',routeRef:'mechanical'},payload,
      selection:{workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:unit.id,sceneId:scene.id}});
  }
  return host.conversations.accept({ownerId:'author',threadId,requestId,expectedVersion:1,requestEnvelope:{requestId},
    payload:{...payload,...(mode==='assistant-start'?{intent:'AUTO'}:{})},
    capabilityId:mode==='assistant-start'?'script.assistant_start':'script.converse',maxInvocations:2});
}

for(const mode of directModes)for(const label of ['json',''])test(`${mode} accepts one complete ${label||'unlabelled'} JSON fence and preserves the exact result`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let sends=0;
  const raw=` \n${fencedJson({response:answerFor(mode,'【机械答复】继续采用当前方向')},label)}\n `;
  const host=createScriptAgentHost(db,{sendOnce:async()=>{
    sends++;return {text:raw,provenance:{channel:'provider' as const,producer:'MECHANICAL_FENCED_DIRECT_REPLY'}};
  }},`fenced-direct-${mode}`);
  const thread=host.conversations.open('author','script:home',`fenced-direct-${mode}-${label}`);
  const accepted=acceptDirectTurn(host,thread.id,mode,'fenced-reply'),runId=accepted.conversation.turns.at(-1)!.runId;
  await host.worker.runOnce(runId);
  assert.equal(host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(host.store.readRun(runId)));
  const response=host.conversations.turn(thread.id,accepted.turnId,'author').turn.response;
  assert.equal(response.text,'【机械答复】继续采用当前方向');assert.deepEqual(response.options,[]);
  assert.equal(response.rawResult,raw);assert.equal(sends,1);
  const invocation=db.prepare('SELECT status,result_json FROM agent_invocations WHERE run_id=?').all(runId) as any[];
  assert.equal(invocation.length,1);assert.equal(invocation[0].status,'RECEIVED');
  assert.equal(JSON.parse(invocation[0].result_json).text,raw);
  assert.equal((db.prepare('SELECT count(*) n FROM agent_attempts WHERE invocation_id IN (SELECT id FROM agent_invocations WHERE run_id=?)').get(runId) as any).n,1);
  assert.equal((db.prepare('SELECT count(*) n FROM agent_goals').get() as any).n,0);
  assert.equal((db.prepare('SELECT count(*) n FROM script_workspaces').get() as any).n,mode==='manual-dispatch'?1:0);
});

for(const fenced of [false,true])for(const mode of directModes)test(`${mode} reads an omitted exact seed before its final answer${fenced?' through fenced READ and answer':''}`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const old='EARLY_AUTHOR_EXACT_TEXT_FOR_DIRECT_CHAT_READ';let first=0,second=0,lastAnswer='';
  const encode=(value:unknown)=>fenced?fencedJson(value):JSON.stringify(value);
  const host=createScriptAgentHost(db,{sendOnce:async request=>{
    const schema=request.outputSchema as any;
    assert.equal(schema.type,'object');assert.deepEqual(schema.required,['response']);
    assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.response.anyOf.length,2);
    assert.equal(schema.properties.response.anyOf[1].properties.kind.enum[0],'READ');
    if(request.operationKey.endsWith(':history-read')){
      second++;assert.match(request.prompt,/EARLY_AUTHOR_EXACT_TEXT_FOR_DIRECT_CHAT_READ/);
      const answer=mode==='manual-dispatch'?{kind:'REPLY',operation:null,question:'【机械答复】已读早期原文',options:[]}:
        mode==='assistant-start'?{kind:'ASK',question:'【机械答复】已读早期原文',options:[],title:null,format:null,plannedUnits:null,targetMinutes:null}:
        {question:'【机械答复】已读早期原文',options:[]};
      lastAnswer=encode({response:answer});
      return {text:lastAnswer,provenance:{channel:'provider' as const,producer:'MECHANICAL_HISTORY_READ'}};
    }
    first++;assert.doesNotMatch(request.prompt,/EARLY_AUTHOR_EXACT_TEXT_FOR_DIRECT_CHAT_READ/);
    return {text:encode({response:{kind:'READ',entryId:'seed:0',cursor:null}}),provenance:{channel:'provider' as const,producer:'MECHANICAL_HISTORY_READ'}};
  }},`direct-history-${mode}`);
  const seed=Array.from({length:30},(_,index)=>({role:'user' as const,text:index===0?old:`【机械历史 ${index}】${'后'.repeat(700)}`}));
  const conversation=host.conversations.open('author','script:home',`direct-${mode}`,seed);
  let accepted;
  if(mode==='manual-dispatch'){
    const workspace=host.workspaces.create({ownerId:'author',threadId:conversation.id,requestId:'base',
      source:{document:createScriptProject('【机械稿】',createScriptCreationProfile('short-film',1,3))}});
    const unit=workspace.document.units[0],scene=unit.scenes[0];
    accepted=host.commands.acceptChatTurn({ownerId:'author',threadId:conversation.id,requestId:'direct-read',expectedVersion:1,
      requestEnvelope:{text:'回忆早期想法'},text:'回忆早期想法',methods:[],route:{channel:'api',routeRef:'mechanical'},
      payload:{text:'回忆早期想法',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'api',routeRef:'mechanical'},
      selection:{workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:unit.id,sceneId:scene.id}});
  }else accepted=host.conversations.accept({ownerId:'author',threadId:conversation.id,requestId:'direct-read',expectedVersion:1,
    requestEnvelope:{text:'回忆早期想法'},payload:{text:'回忆早期想法',methods:[],template:SCRIPT_CHAT_TEMPLATE,
      channel:'api',routeRef:'mechanical',...(mode==='assistant-start'?{intent:'AGENT'}:{})},
    capabilityId:mode==='assistant-start'?'script.assistant_start':'script.converse',maxInvocations:2});
  const runId=accepted.conversation.turns.at(-1)!.runId;
  await host.worker.runOnce(runId);
  assert.equal(host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(host.store.readRun(runId)));
  assert.equal(first,1);assert.equal(second,1);
  assert.match(host.conversations.turn(conversation.id,accepted.turnId,'author').turn.response.text,/已读早期原文/);
  assert.equal(host.conversations.turn(conversation.id,accepted.turnId,'author').turn.response.rawResult,lastAnswer);
  assert.equal((db.prepare('SELECT count(*) n FROM agent_invocations WHERE run_id=?').get(runId) as any).n,2);
});

for(const mode of directModes)test(`${mode} still rejects a second fenced READ without a third model call`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let sends=0;
  const raw=fencedJson({response:{kind:'READ',entryId:'seed:0',cursor:null}});
  const host=createScriptAgentHost(db,{sendOnce:async()=>{
    sends++;return {text:raw,provenance:{channel:'provider' as const,producer:'MECHANICAL_FENCED_READ_LIMIT'}};
  }},`fenced-read-limit-${mode}`);
  const thread=host.conversations.open('author','script:home',`fenced-read-limit-${mode}`,[{role:'user',text:'【机械历史】原始方向'}]);
  const accepted=acceptDirectTurn(host,thread.id,mode,'second-read'),runId=accepted.conversation.turns.at(-1)!.runId;
  await host.worker.runOnce(runId);
  const run=host.store.readRun(runId);assert.equal(run.status,'FAILED',JSON.stringify(run));assert.equal(run.reason,'CHAT_HISTORY_READ_LIMIT');
  assert.equal(sends,2);assert.equal(host.conversations.turn(thread.id,accepted.turnId,'author').turn.response,null);
  const invocations=db.prepare('SELECT status,result_json FROM agent_invocations WHERE run_id=?').all(runId) as any[];
  assert.equal(invocations.length,2);for(const invocation of invocations){assert.equal(invocation.status,'RECEIVED');assert.equal(JSON.parse(invocation.result_json).text,raw);}
});

for(const mode of directModes)test(`${mode} rejects a fenced READ outside the frozen history without a follow-up send`,async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());let sends=0;
  const raw=fencedJson({response:{kind:'READ',entryId:'seed:999',cursor:null}});
  const host=createScriptAgentHost(db,{sendOnce:async()=>{
    sends++;return {text:raw,provenance:{channel:'provider' as const,producer:'MECHANICAL_FENCED_READ_DENIED'}};
  }},`fenced-read-denied-${mode}`);
  const thread=host.conversations.open('author','script:home',`fenced-read-denied-${mode}`,[{role:'user',text:'【机械历史】授权方向'}]);
  const accepted=acceptDirectTurn(host,thread.id,mode,'unauthorized-read'),runId=accepted.conversation.turns.at(-1)!.runId;
  await host.worker.runOnce(runId);
  const run=host.store.readRun(runId);assert.equal(run.status,'FAILED',JSON.stringify(run));assert.equal(run.reason,'CONVERSATION_READ_DENIED');
  assert.equal(sends,1);assert.equal(host.conversations.turn(thread.id,accepted.turnId,'author').turn.response,null);
  const invocations=db.prepare('SELECT status,result_json FROM agent_invocations WHERE run_id=?').all(runId) as any[];
  assert.equal(invocations.length,1);assert.equal(invocations[0].status,'RECEIVED');assert.equal(JSON.parse(invocations[0].result_json).text,raw);
});

test('external direct history read resumes its frozen second request after a worker wait',async t=>{
  const db=new Database(':memory:');t.after(()=>db.close());
  const host=createScriptAgentHost(db,{sendOnce:async()=>{throw Error('external fixture never calls a provider');}},'external-direct-history');
  const seed=Array.from({length:30},(_,index)=>({role:'user' as const,text:index===0?'EARLY_EXTERNAL_EXACT_TEXT':`【机械历史】${'后'.repeat(700)}`}));
  const thread=host.conversations.open('author','script:home','external-history',seed);
  const accepted=host.conversations.accept({ownerId:'author',threadId:thread.id,requestId:'external-read',expectedVersion:1,
    requestEnvelope:{text:'查找旧想法'},payload:{text:'查找旧想法',methods:[],template:SCRIPT_CHAT_TEMPLATE,channel:'external',routeRef:'manual'},
    capabilityId:'script.converse',maxInvocations:2});
  const runId=accepted.conversation.turns.at(-1)!.runId;
  await host.worker.runOnce(runId);
  const first=host.journal.listExternal(runId,'author').find(item=>item.status==='WAITING')!;
  assert.ok(first);host.journal.submitExternal(first.id,'author',first.inputHash,JSON.stringify({kind:'READ',entryId:'seed:0',cursor:null}),
    {name:'MECHANICAL_EXTERNAL_READ',model:'test'});
  await host.worker.runOnce(runId);
  const second=host.journal.listExternal(runId,'author').find(item=>item.status==='WAITING')!;
  assert.ok(second);assert.match(second.request.prompt,/EARLY_EXTERNAL_EXACT_TEXT/);
  host.journal.submitExternal(second.id,'author',second.inputHash,JSON.stringify({question:'【机械答复】已使用旧原文',options:[]}),
    {name:'MECHANICAL_EXTERNAL_ANSWER',model:'test'});
  await host.worker.runOnce(runId);
  assert.equal(host.store.readRun(runId).status,'SUCCEEDED',JSON.stringify(host.store.readRun(runId)));
  assert.equal((db.prepare('SELECT count(*) n FROM agent_invocations WHERE run_id=?').get(runId) as any).n,2);
});
