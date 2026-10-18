import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';
import { AgentError } from '../packages/agent-core/src';
import type { ModelRequest } from '../packages/agent-core/src';
const raw=readFileSync(new URL('./fixtures/agent-sol-chat-first-result.json',import.meta.url),'utf8');
async function setup(t:any){
 const db=new Database(':memory:'); let route='pinned:model-one',badConfig=false;const sent:ModelRequest[]=[];
 const runtime=createScriptRuntime(db,{owner:()=> 'local-author',resolveMethods:async()=>[],resolveExecution:req=>{if(req.get('X-Manual-AI-Session'))throw new AgentError('LEGACY_MANUAL_SESSION','旧会话不能转接口',409);if(badConfig)throw new AgentError('CONFIG_MISSING','测试配置已移除',400);return {channel:'api',routeRef:route};},transport:{sendOnce:async(request)=>{sent.push(request);return {text:raw,provenance:{channel:'provider',producer:'GPT-6 Sol 已生成fixture回放，仅协议验收',model:'gpt-6-sol'}};}}});
 const app=express();app.use(express.json());runtime.register(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as any).port}`;
 t.after(async()=>{await runtime.stop();await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
 const api=async(path:string,body?:unknown,expected=200,headers:Record<string,string>={})=>{const response=await fetch(url+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data as any;};
 const conversation=(await api('/api/script-assistant/conversations',{seed:[]})).conversation;
 return {runtime,api,db,conversation,sends:()=>sent.filter(request=>!request.operationKey.startsWith('memory:')).length,setRoute:(next:string)=>{route=next;},removeConfig:()=>{badConfig=true;}};
}
test('shared runtime freezes server route at acceptance and original receipt survives config removal',async t=>{
 const h=await setup(t),body={text:'独立组合根协议验收',methodIds:[],expectedVersion:h.conversation.version,requestId:'fixed-command'};
 assert.equal((await h.api('/api/script-assistant/features')).durableChat,true);
 const accepted=await h.api(`/api/script-assistant/conversations/${h.conversation.id}/messages`,body,202);
 h.setRoute('pinned:model-two');h.removeConfig();
 assert.equal((await h.api(`/api/script-assistant/conversations/${h.conversation.id}/messages`,body,202)).turnId,accepted.turnId);
 assert.equal(accepted.conversation.turns[0].input.routeRef,'pinned:model-one');
 h.runtime.start();h.runtime.start();
 for(let i=0;i<80;i++){if(h.runtime.conversations.read(h.conversation.id,'local-author').turns[0].response)break;await new Promise(resolve=>setTimeout(resolve,20));}
 await h.runtime.stop();
 assert.equal(h.runtime.conversations.read(h.conversation.id,'local-author').turns[0].response.rawResult,raw);assert.equal(h.sends(),1);
 await h.api(`/api/script-assistant/conversations/${h.conversation.id}/messages`,{...body,requestId:'new',expectedVersion:3},400);
});
test('formal composition rejects unowned generic commands, missing scopes and legacy manual headers before accepting work',async t=>{
 const h=await setup(t);
 await h.api('/api/agent/runs',{requestId:'bypass',scopeId:'script:home',kind:'CHAT',input:{},ownerId:'victim'},400);
 await h.api('/api/agent/scopes/not-a-project/memories',undefined,403);
 await h.api(`/api/script-assistant/conversations/${h.conversation.id}/messages`,{text:'不得偷偷改用API',requestId:'manual',expectedVersion:1,methodIds:[]},409,{'X-Manual-AI-Session':'legacy-memory-session'});
 assert.equal(h.runtime.conversations.read(h.conversation.id,'local-author').turns.length,0);assert.equal(h.sends(),0);
});

test('stopping active host aborts transport, preserves UNKNOWN and restart does not resend',async t=>{
 const db=new Database(':memory:');let sent=0,dispatched=false,aborted=false;
 const runtime=createScriptRuntime(db,{owner:()=> 'local-author',resolveMethods:async()=>[],resolveExecution:()=>({channel:'api',routeRef:'test:abort'}),transport:{sendOnce:async(_request,{signal})=>{sent++;dispatched=true;return new Promise((_,reject)=>{const stop=()=>{aborted=true;reject(new Error('mechanical abort after dispatch'));};signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();});}}});
 t.after(async()=>{await runtime.stop();db.close();});
 const c=runtime.conversations.open('local-author','script:home','stop-case');
 const {turnId}=runtime.conversations.accept({threadId:c.id,ownerId:'local-author',requestId:'stop-once',expectedVersion:1,requestEnvelope:{text:'停止验收'},payload:{text:'停止验收',methods:[],template:'{{taskContract}}\n{{conversation}}',channel:'api',routeRef:'test:abort'},capabilityId:'script.converse',maxInvocations:1});
 runtime.start();for(let i=0;i<100&&!dispatched;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(dispatched);
 await runtime.stop();assert.ok(aborted);assert.equal(sent,1);
 const runId=runtime.conversations.turn(c.id,turnId,'local-author').turn.runId;
 assert.equal(runtime.store.readRun(runId).status,'RECONCILIATION_REQUIRED');
 runtime.start();await new Promise(resolve=>setTimeout(resolve,180));await runtime.stop();assert.equal(sent,1);
 assert.equal((db.prepare('SELECT status FROM agent_invocations WHERE run_id=?').get(runId) as any).status,'UNKNOWN');
});
