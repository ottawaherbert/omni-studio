import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

// Saved GPT-6 Sol replies are replayed solely to verify persistence/protocol,
// not offered as model-quality evidence for inputs changed by a test.
const first = readFileSync(new URL('./fixtures/agent-sol-chat-first-result.json', import.meta.url), 'utf8');
const second = readFileSync(new URL('./fixtures/agent-sol-chat-second-result.json', import.meta.url), 'utf8');
const original = JSON.parse(readFileSync(new URL('../artifacts/agent-foundation-study-2026-09-26/sol-chat-first-request.json', import.meta.url), 'utf8')).request.request.prompt;
const message = '【模拟验收】想写一部安静的短片：夜雨里，母亲来找成年女儿，两个人在门口迟迟没有开口。请给我两个可选择的日常动作方向，不要强加反转或重大冲突，先聊想法。';
async function stop(proc: ChildProcess) { if (proc.exitCode !== null || proc.signalCode !== null) return; const exited = once(proc, 'exit'); proc.kill('SIGKILL'); await exited; }
async function setup(t: any) {
  const filename = `/tmp/agent-chat-http-${randomUUID()}.sqlite`, children: ChildProcess[] = [];
  let origin = '';
  async function launch(entry: string) {
    const child = fork(path.resolve(entry), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, SCRIPT_AGENT_DB: filename, SCRIPT_AGENT_PORT:'0', SCRIPT_AGENT_ROLE:'coordinator' }, stdio:['ignore','ignore','pipe','ipc'] });
    children.push(child); let errors = ''; child.stderr?.on('data', chunk => { errors += chunk; });
    const ready = await new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(errors || 'startup timeout')),10000); child.once('message', value => { clearTimeout(timer); resolve(value); }); child.once('exit',code=>{ clearTimeout(timer); reject(new Error(`${code}: ${errors}`)); }); });
    if (ready.port) origin = `http://127.0.0.1:${ready.port}`;
    return child;
  }
  const startApi = () => launch('tests/agent-script-harness.ts'), startWorker = () => launch('apps/worker/src/script-agent-worker.ts');
  const server = await startApi(), worker = await startWorker();
  t.after(async () => { await Promise.all(children.map(stop)); for (const suffix of ['','-wal','-shm']) rmSync(filename+suffix,{force:true}); });
  const api = async (route: string, body?: unknown, expected = 200) => {
    const r = await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const data = await r.json(); assert.equal(r.status,expected,JSON.stringify(data)); return data as any;
  };
  const waitRun = async (id: string, status: string) => {
    for(let i=0;i<150;i++){ const v=await api(`/api/agent/runs/${id}`); if(v.run.status===status)return v; assert.notEqual(v.run.status,'FAILED',JSON.stringify(v)); await new Promise(r=>setTimeout(r,50)); }
    throw new Error(JSON.stringify(await api(`/api/agent/runs/${id}`)));
  };
  const open = async (clientKey='script-home',seed:unknown[]=[]) => (await api('/api/script-assistant/conversations',{clientKey,seed})).conversation;
  const send = async (conversation:any,text=message,requestId=randomUUID()) => api(`/api/script-assistant/conversations/${conversation.id}/messages`,{text,requestId,expectedVersion:conversation.version,methodIds:['acceptance-actions']},202);
  const submit = (external:any,text:string) => api(`/api/agent/external/${external.id}/result`,{inputHash:external.inputHash,text,producer:{name:'GPT-6 Sol 子 Agent 已生成回复回放（流程验收）',model:'gpt-6-sol'}});
  return {api,waitRun,open,send,submit,server,worker,startApi,startWorker};
}

test('durable same-page dialogue: actual API/worker restart, original Skill, two Sol replies, choices and new conversation',async t=>{
  const h=await setup(t), conversation=await h.open();
  const accepted=await h.send(conversation), turn=accepted.conversation.turns[0];
  const waiting=await h.waitRun(turn.runId,'WAITING_EXTERNAL'), external=waiting.externalRequests[0];
  assert.match(external.request.prompt,/本次没有进行演读计时/);
  assert.ok(original.includes(message)); assert.ok(external.request.prompt.includes(message));
  assert.equal(external.request.inputManifest.skillTrace[0].version,'1');
  await stop(h.server); await stop(h.worker); await h.startApi();
  assert.deepEqual((await h.open()).turns[0].input,turn.input);
  await h.submit(external,first); await h.submit(external,first);
  await h.startWorker(); await h.waitRun(turn.runId,'SUCCEEDED');
  const replied=await h.open(); assert.equal(replied.turns[0].response.rawResult,first);
  const option=replied.turns[0].response.options[0];
  const chosen=`【${option.tag}】${option.text}`;
  const next=await h.send(replied,chosen), nextTurn=next.conversation.turns[1];
  const waiting2=await h.waitRun(nextTurn.runId,'WAITING_EXTERNAL');
  assert.ok(waiting2.externalRequests[0].request.prompt.includes(chosen));
  assert.ok(waiting2.externalRequests[0].request.prompt.includes(replied.turns[0].response.text));
  await h.submit(waiting2.externalRequests[0],second); await h.waitRun(nextTurn.runId,'SUCCEEDED');
  const final=await h.open(); assert.equal(final.turns.length,2); assert.equal(final.turns[1].response.rawResult,second);
  assert.deepEqual((await h.api('/api/scripts')).projects,[]);
  const fresh=await h.open('new-dialogue'); assert.equal(fresh.turns.length,0); assert.notEqual(fresh.id,conversation.id);
  assert.equal((await h.open()).turns.length,2);
});

test('forget revokes history transitively and next prompt excludes withdrawn replies',async t=>{
  const h=await setup(t),conversation=await h.open();
  const secret='仅供撤回验收：纸灯乙';
  const memory=(await h.api('/api/agent/scopes/script:home/memories',{requestId:'remember-chat',memory:{key:'author.preference',kind:'AUTHOR_PREFERENCE',content:{label:'对话撤回验收',value:secret},dependencies:[]}},201));
  const firstTurn=(await h.send(conversation)).conversation.turns[0];
  const firstWait=await h.waitRun(firstTurn.runId,'WAITING_EXTERNAL'); assert.ok(firstWait.externalRequests[0].request.prompt.includes(secret));
  await h.submit(firstWait.externalRequests[0],first); await h.waitRun(firstTurn.runId,'SUCCEEDED');
  const next=(await h.send(await h.open(),'继续讨论')).conversation.turns[1];
  const nextWait=await h.waitRun(next.runId,'WAITING_EXTERNAL'); await h.submit(nextWait.externalRequests[0],second); await h.waitRun(next.runId,'SUCCEEDED');
  await h.api(`/api/agent/scopes/script:home/memories/${memory.id}`,{requestId:'forget-chat',expectedRevision:memory.revision,action:'DELETE'});
  const revoked=await h.open();
  assert.ok(revoked.turns.every((turn:any)=>turn.response.redacted));
  assert.ok(!JSON.stringify(revoked).includes(secret));
  const third=(await h.send(revoked,'从我的原始想法重新讨论')).conversation.turns[2];
  const thirdWait=await h.waitRun(third.runId,'WAITING_EXTERNAL'),prompt=thirdWait.externalRequests[0].request.prompt;
  assert.ok(!prompt.includes(secret)); assert.ok(!prompt.includes(JSON.parse(first).question)); assert.match(prompt,/历史回复已撤回/);
});
