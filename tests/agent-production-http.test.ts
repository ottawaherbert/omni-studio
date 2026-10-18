import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdirSync,writeFileSync,readFileSync,rmSync,existsSync } from 'node:fs';
import path from 'node:path';
const raw=readFileSync(new URL('./fixtures/agent-sol-chat-first-result.json',import.meta.url),'utf8');
async function stop(proc:ChildProcess){if(proc.exitCode!==null||proc.signalCode!==null)return;const exited=once(proc,'exit');proc.kill('SIGTERM');await exited;}
async function setup(t:any,autoStart=true){
 const dir=`/tmp/agent-production-${randomUUID()}`;mkdirSync(dir);const skillDir=`${dir}/skills`;mkdirSync(skillDir);const log=`${dir}/sends.jsonl`;
 writeFileSync(`${skillDir}/acceptance.md`,'---\nid: acceptance-actions\ntitle: 隔离验收 Skill\ncreativeMetadata: {"kind":"general","revision":9}\nsource: manual\ncreatedAt: 1\nupdatedAt: 1\n---\n只按作者要求讨论。末尾完整规则：本次没有进行演读计时。');
 const children:ChildProcess[]=[];let origin='';
 const start=async()=>{
 const child=fork(path.resolve('tests/agent-production-harness.ts'),[],{execArgv:['--import','tsx'],env:{...process.env,OMNI_DB_PATH:`${dir}/db.sqlite`,OMNI_SKILLS_DIR:skillDir,AGENT_ACCEPTANCE_SEND_LOG:log,AGENT_ACCEPTANCE_AUTOSTART:autoStart?'1':'0'},stdio:['ignore','pipe','pipe','ipc']});children.push(child);let errors='';child.stderr?.on('data',v=>{errors+=v;});
 const ready=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`production startup timeout ${errors}`)),15000);child.once('message',m=>{clearTimeout(timer);resolve(m);});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`exit ${code}: ${errors}`));});});assert.equal(ready.sameRepository,true);origin=`http://127.0.0.1:${ready.port}`;return child;};
 t.after(async()=>{await Promise.all(children.map(stop));rmSync(dir,{recursive:true,force:true});});
 const child=await start();
 const api=async(route:string,body?:unknown,method=body===undefined?'GET':'POST',expected=200)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data as any;};
 const wait=async(id:string,status:string)=>{for(let i=0;i<150;i++){const v=await api(`/api/agent/runs/${id}`);if(v.run.status===status)return v;await new Promise(r=>setTimeout(r,30));}throw new Error(JSON.stringify(await api(`/api/agent/runs/${id}`)));};
 const open=async()=>(await api('/api/script-assistant/conversations',{seed:[]})).conversation;
 const sends=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
 return {child,start,api,wait,open,sends:()=>sends().filter(item=>item.purpose==='chat'),dir};
}
test('production singleton/config/policy/transport/worker runs accepted homepage chat and survives API restart',async t=>{
 const h=await setup(t);assert.equal((await h.api('/api/script-assistant/features')).durableChat,true);
 const c=await h.open(),body={requestId:'production-chat',expectedVersion:c.version,text:'【真实宿主协议验收】母女夜雨门口，两个动作方向。',methodIds:['acceptance-actions']};
 const a=await h.api(`/api/script-assistant/conversations/${c.id}/messages`,body,'POST',202),runId=a.conversation.turns[0].runId;
 await h.wait(runId,'SUCCEEDED');assert.equal(h.sends().length,1);assert.equal(h.sends()[0].redirect,'error');assert.ok(JSON.stringify(h.sends()[0].prompt).includes('末尾完整规则'));
 assert.equal((await h.open()).turns[0].response.rawResult,raw);
 assert.equal((await h.open()).turns[0].response.methods[0].version,'9');
 await stop(h.child);await h.start();
 assert.equal((await h.api(`/api/script-assistant/conversations/${c.id}/messages`,body,'POST',202)).turnId,a.turnId);
 assert.equal((await h.open()).turns[0].response.rawResult,raw);assert.equal(h.sends().length,1);
 assert.deepEqual((await h.api('/api/scripts')).projects,[]);
 await h.api('/api/agent/runs',{scopeId:'script:home',kind:'CHAT',input:{},requestId:'unfrozen'},'POST',400);
});
test('accepted route target change fails local preflight without sending; later explicit new turn uses valid config',async t=>{
 const h=await setup(t,false),c=await h.open();const body={text:'【路由变化验收】不应该把新凭证发给旧地址。',requestId:'pin-route',expectedVersion:c.version,methodIds:[]};
 const a=await h.api(`/api/script-assistant/conversations/${c.id}/messages`,body,'POST',202),runId=a.conversation.turns[0].runId;
 const config=(await h.api('/api/ai-config')).config;const changed=structuredClone(config);changed.channels[0].baseUrl='http://127.0.0.1:18890/v1';await h.api('/api/ai-config',changed,'PUT');
 h.child.send({action:'start-worker'});await h.wait(runId,'FAILED');assert.equal(h.sends().length,0);
 const run=await h.api(`/api/agent/runs/${runId}`);assert.notEqual(run.run.status,'RECONCILIATION_REQUIRED');
 await h.api('/api/ai-config',config,'PUT');const latest=await h.open();
 const next=await h.api(`/api/script-assistant/conversations/${c.id}/messages`,{...body,requestId:'explicit-new',expectedVersion:latest.version},'POST',202);
 await h.wait(next.conversation.turns[1].runId,'SUCCEEDED');assert.equal(h.sends().length,1);
});

test('same production runtime persists an explicit external return without provider credentials or API dispatch',async t=>{
 const h=await setup(t),c=await h.open();
 const config=(await h.api('/api/ai-config')).config;config.routing.scriptGen='';await h.api('/api/ai-config',config,'PUT');
 const body={requestId:'no-route',expectedVersion:c.version,text:'【无配置验收】先保留我的想法',methodIds:[]};
 await h.api(`/api/script-assistant/conversations/${c.id}/messages`,body,'POST',409);
 assert.equal((await h.open()).turns.length,0);
 const accepted=await h.api(`/api/script-assistant/conversations/${c.id}/messages`,{...body,requestId:'explicit-external',executionChannel:'external'},'POST',202),runId=accepted.conversation.turns[0].runId;
 const waiting=await h.wait(runId,'WAITING_EXTERNAL'),external=waiting.externalRequests[0];
 assert.equal(external.request.channel,'external');assert.equal(h.sends().length,0);
 await h.api(`/api/agent/external/${external.id}/result`,{inputHash:external.inputHash,text:raw,producer:{name:'GPT-6 Sol 保存回复回放，正式组合根回填验收',model:'gpt-6-sol'}});
 await h.wait(runId,'SUCCEEDED');assert.equal((await h.open()).turns[0].response.rawResult,raw);assert.equal(h.sends().length,0);
});
