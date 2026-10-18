import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act, StrictMode} from 'react';
import {JSDOM} from 'jsdom';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {createWorkspacePatch} from '../packages/script/src/workspacePatch';
import type {ScriptCandidateView} from '../apps/web/src/clients/scriptClient';
import {hashValue} from '../packages/agent-core/src';

// Exercise the real panel lifecycle. StrictMode retires its first asynchronous
// mount before the conversation receipt arrives; that mount must never poll.
test('one StrictMode poller preserves unchanged candidate previews and publishes changed or revoked snapshots', async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
 const timers=new Map<number,()=>void>();let id=900000,reads=0;
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
 const conversation={id:'thread-panel',version:1,seed:[],turns:[]};
 let project=createScriptProject('异步轮询回归',createScriptCreationProfile('short-film',1,3));
 const workspace={id:'workspace-panel',threadId:conversation.id,documentId:project.id,projectId:project.id,
   document:project,revision:1,baseWorkspaceRevision:1,baseProjectRevision:project.revision,writerEpoch:0,writerRunId:null,hasPendingChanges:false};
 const candidates:ScriptCandidateView[]=Array.from({length:45},(_,index)=>{
   const proposed=structuredClone(project);proposed.brief.concept=`候选前提 ${index}`;
   const request={candidateId:`candidate-${index}`,operation:'concept' as const},patch=createWorkspacePatch(project,proposed);
   return {id:`candidate-${index}`,workspaceId:workspace.id,status:'VALID',error:null,
     candidate:{request,patch,result:{summary:`候选摘要 ${index}`},idMap:{},patchDigest:hashValue(patch),baseRevision:project.revision,baseContentHash:hashValue(project)},
     request,baseRef:null,modelInputHash:null,runId:null,appliedRevision:null};
 });
 let revoked=false,waiting=false,visible=true,returned=false,holdCandidates=false;
 let releaseCandidates:(()=>void)|undefined,releaseReturn:(()=>void)|undefined;
 const clone=t.mock.method(globalThis,'structuredClone');
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
   localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,
   IS_REACT_ACT_ENVIRONMENT:true,
   setTimeout:((callback:()=>void,delay?:number,...args:any[])=>{if(delay===3000){const key=id++;timers.set(key,callback);return key;}return realSetTimeout(callback,delay,...args);}) as typeof setTimeout,
   clearTimeout:((key:ReturnType<typeof setTimeout>)=>{if(!timers.delete(Number(key)))realClearTimeout(key);}) as typeof clearTimeout,
   fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);let result:unknown;
    if(path==='/api/script-assistant/conversations?view=state')result={conversation};
    else if(path==='/api/script-assistant/conversations/thread-panel?view=state'){reads++;result={conversation};}
    else if(path.startsWith('/api/script-workspaces?view=state&')){
      if(revoked)return new Response(JSON.stringify({error:'来源撤回',code:'CONTEXT_REVOKED'}),{status:403});
      result={workspaces:[workspace]};
    }
    else if(path.startsWith('/api/script-goals?'))result={goals:[]};
    else if(path.startsWith('/api/script-runs?'))result={runs:waiting?[{workspaceId:workspace.id,goalId:null,run:{id:'waiting-run',kind:'CAPABILITY',status:'WAITING_EXTERNAL'}}]:[]};
    else if(path==='/api/agent/runs/waiting-run?view=state')result={run:{id:'waiting-run',kind:'CAPABILITY',status:'WAITING_EXTERNAL'},externalRequests:[{id:returned?'next-request':'waiting-request',runId:'waiting-run',status:'WAITING',request:{prompt:returned?'下一次完整冻结请求':'完整冻结请求'}}]};
    else if(path==='/api/agent/external/waiting-request/result'){
      await new Promise<void>(resolve=>{releaseReturn=()=>{returned=true;resolve();};});result={request:{id:'waiting-request',status:'RECEIVED'}};
    }
    else if(path.startsWith('/api/script-candidates?')){
      assert.deepEqual(JSON.parse(new URL(path,'http://fixture.invalid').searchParams.get('workspaceIds')!),[workspace.id]);
      if(holdCandidates){holdCandidates=false;await new Promise<void>(resolve=>{releaseCandidates=resolve;});}
      result={candidates};
    }
    else if(path==='/api/skills')result=[];
    else throw new Error(`Unexpected fixture request ${init?.method||'GET'} ${path}`);
    return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
   }};
 const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let root:import('react-dom/client').Root|undefined;
 const scroll=Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype,'scrollIntoView');
 try{
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const {createRoot}=await import('react-dom/client');
  const {ScriptDurablePanel}=await import('../apps/web/src/features/script/ScriptDurablePanel');
  root=createRoot(dom.window.document.getElementById('root')!);
  const flush=async()=>{await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));});};
  const render=()=>root!.render(React.createElement(StrictMode,null,React.createElement(ScriptDurablePanel,{
   visible,mode:'manual',project,unit:project.units[0],dirty:false,onSave:async()=>{},onApplied:()=>{},onOpenScene:()=>{}
  })));
  await act(async()=>{render();});
  await flush();await flush();
  assert.equal(reads,1,'only the current mount may initialize manuscript state');
  assert.equal(timers.size,1,'only one timer may own refresh serials');
  assert.equal(dom.window.document.querySelectorAll('.script-chat-candidate').length,45);
  const poll=async()=>{const [key,callback]=timers.entries().next().value!;timers.delete(key);await act(async()=>{callback();});await flush();};
  const before=clone.mock.callCount();await poll();
  assert.equal(reads,2);assert.equal(timers.size,1,'each completed poll schedules exactly one successor');
  assert.equal(clone.mock.callCount(),before,'unchanged JSON responses must not recompute any of the 45 whole-project candidate previews');
  await act(async()=>{(dom.window.document.querySelector('[aria-label="历史记录与成果"]') as HTMLElement).click();});
  await act(async()=>{(dom.window.document.querySelector('[aria-label="历史记录与成果"]') as HTMLElement).click();});
  assert.equal(clone.mock.callCount(),before,'local UI state must reuse previews while author and patch are unchanged');
  const changed=structuredClone(project);changed.brief.concept='最新候选内容';
  candidates[0]={...candidates[0],candidate:{...candidates[0].candidate!,patch:createWorkspacePatch(project,changed)}};
  const beforeCandidate=clone.mock.callCount();await poll();
  assert.equal(clone.mock.callCount(),beforeCandidate,'plain candidate values update without rebuilding the whole manuscript');
  assert.match(dom.window.document.querySelector('.script-chat-candidate')!.textContent!,/最新候选内容/);
  project={...project,revision:project.revision+1,brief:{...project.brief,concept:'作者最新原文'}};
  const beforeAuthor=clone.mock.callCount();await act(async()=>{render();});
  assert.equal(clone.mock.callCount(),beforeAuthor,'current text updates without cloning a whole manuscript per plain candidate');
  assert.match(dom.window.document.querySelector('.script-chat-candidate')!.textContent!,/作者最新原文/);
  candidates[0]={...candidates[0],appliedRevision:2};await poll();
  assert.match(dom.window.document.querySelector('.script-chat-candidate')!.textContent!,/待采用/);
  workspace.revision=3;workspace.baseWorkspaceRevision=2;await poll();
  assert.match(dom.window.document.querySelector('.script-chat-candidate')!.textContent!,/已处理/,'workspace revision changes must update adopted status');
  waiting=true;await poll();
  assert.match(dom.window.document.body.textContent!,/尚未完成的测试请求/);
  const {useSettingsStore}=await import('../src/store/useSettingsStore');
  const testMode=useSettingsStore.getState().isTestMode;t.after(()=>useSettingsStore.setState({isTestMode:testMode}));
  await act(async()=>{useSettingsStore.setState({isTestMode:true});});
  const textarea=dom.window.document.querySelector('textarea[aria-label="模型返回原文"]') as HTMLTextAreaElement;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'机械回填');
    textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  const submit=[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='提交本次返回')!;
  assert.equal(submit.disabled,false);
  holdCandidates=true;await poll();const oldReads=reads;
  await act(async()=>{submit.click();});await flush();
  assert.ok(releaseReturn,'the command is submitted even while a prior polling read is pending');
  // Complete the command while the pre-command snapshot is still in flight.
  await act(async()=>{releaseReturn!();});await flush();
  assert.equal(reads,oldReads,'post-command refresh waits for the old flight instead of overlapping it');
  assert.equal(submit.disabled,true,'the acknowledged return is not yet a fresh displayed snapshot');
  await act(async()=>{dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));});
  assert.equal(reads,oldReads,'visibility wakes must not create another poll during a mutation');
  holdCandidates=true;
  await act(async()=>{releaseCandidates!();});await flush();await flush();
  assert.equal(reads,oldReads+1,'the command must force a fresh read after draining, never reuse the pre-command result');
  await poll();
  assert.equal(reads,oldReads+1,'a timer firing during the command refresh must not start a competing refresh');
  await act(async()=>{releaseCandidates!();});await flush();await flush();
  assert.match(dom.window.document.body.textContent!,/下一次完整冻结请求/);
  assert.equal(timers.size,1,'the command refresh and retired poll leave one timer owner');

  waiting=false;await poll();
  assert.doesNotMatch(dom.window.document.body.textContent!,/尚未完成的测试请求/,'completed external requests must leave the display');
  candidates[0]={...candidates[0],status:'REDACTED',candidate:null,error:'候选来源已撤回'};await poll();
  assert.match(dom.window.document.querySelector('.script-chat-candidate')!.textContent!,/候选来源已撤回/);
  assert.doesNotMatch(dom.window.document.querySelector('.script-chat-candidate')!.textContent!,/最新候选内容/);
  revoked=true;await poll();
  assert.equal(dom.window.document.querySelectorAll('.script-chat-candidate').length,0,'source denial removes all previous previews');
  revoked=false;await poll();
  assert.equal(dom.window.document.querySelectorAll('.script-chat-candidate').length,45,'a later authorized snapshot restores the display');
  visible=false;await act(async()=>{render();});const closedReads=reads;await poll();
  assert.equal(reads,closedReads,'a collapsed assistant must not keep reading every historical workspace');
  visible=true;await act(async()=>{render();});await flush();
  assert.equal(reads,closedReads+1,'reopening immediately refreshes current authorized state');
  Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:true});
  await act(async()=>{dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));});await poll();
  assert.equal(reads,closedReads+1,'a background browser tab does not occupy the server with display polling');
  Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:false});
  await act(async()=>{dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));});await flush();
  assert.equal(reads,closedReads+2,'returning to the tab reads immediately');

  await act(async()=>{root!.unmount();});root=undefined;
  assert.equal(timers.size,0,'unmount must cancel its own timer');
 }finally{
  if(root)await act(async()=>{root!.unmount();});
  if(scroll)Object.defineProperty(dom.window.HTMLElement.prototype,'scrollIntoView',scroll);
  for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  dom.window.close();
 }
});

test('old goal reads and a workspace snapshot behind APPLY cannot block or falsely reject adoption',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
 const project=createScriptProject('旧委托不会阻塞采用',createScriptCreationProfile('short-film',1,3));
 const proposed=structuredClone(project);proposed.brief.concept='新候选';
 const patch=createWorkspacePatch(project,proposed),request={candidateId:'new-candidate',operation:'concept' as const};
 const candidate:ScriptCandidateView={id:request.candidateId,workspaceId:'work',status:'VALID',error:null,
  candidate:{request,patch,result:{summary:'新候选'},idMap:{},patchDigest:hashValue(patch),baseRevision:project.revision,baseContentHash:hashValue(project)},
  request,baseRef:null,modelInputHash:null,runId:null,appliedRevision:null};
 const workspace={id:'work',threadId:'thread',documentId:project.id,projectId:project.id,document:project,
  revision:1,baseWorkspaceRevision:1,baseProjectRevision:project.revision,writerEpoch:0,writerRunId:null,hasPendingChanges:false};
 const goal={id:'old-goal',workspaceId:'work',lastRunId:'old-run',activeRunId:null,version:1,
  revision:{objective:'已完成旧委托',skillManifest:[],route:{channel:'api'},contract:{value:{stopAfter:'BODY',scope:{units:[],newUnitSlots:[],sharedFields:[]},checks:{targetUnitIds:[]}}}}};
 const events:string[]=[];let adopted=false,fullReads=0,progressReads=0,workspaceLag=true;
 const timers=new Map<number,()=>void>();let timerId=910000;
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
 const pending:Array<(value:Response)=>void>=[];
 const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
  localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true,
  setTimeout:((callback:()=>void,delay?:number,...args:any[])=>{if(delay===3000){const key=timerId++;timers.set(key,callback);return key;}return realSetTimeout(callback,delay,...args);}) as typeof setTimeout,
  clearTimeout:((key:ReturnType<typeof setTimeout>)=>{if(!timers.delete(Number(key)))realClearTimeout(key);}) as typeof clearTimeout,
  fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
   const path=String(input);let result:unknown;
   if(path.startsWith('/api/script-assistant/conversations'))result={conversation:{id:'thread',version:1,seed:[],turns:[]}};
   else if(path.startsWith('/api/script-workspaces?view=state&'))result={workspaces:[candidate.appliedRevision&&workspaceLag?
    {...workspace,document:project,revision:1,hasPendingChanges:false}:workspace]};
   else if(path.startsWith('/api/script-goals?'))result={goals:[goal]};
   else if(path.startsWith('/api/script-runs?'))result={runs:[{workspaceId:'work',goalId:goal.id,run:{id:'old-run',kind:'GOAL',status:'SUCCEEDED'}}]};
   else if(path==='/api/script-goals/old-goal/external-requests?view=state')result={externalRequests:[]};
   else if(path==='/api/script-goals/old-goal/review?view=progress'){progressReads++;return new Promise<Response>(resolve=>pending.push(resolve));}
   else if(path==='/api/script-goals/old-goal/review'){fullReads++;return new Promise<Response>(resolve=>pending.push(resolve));}
   else if(path==='/api/script-goals/old-goal/budget')result={budget:{version:1,limits:{maxInvocations:40,maxToolCalls:80,maxTurns:8},used:{invocations:3,toolCalls:1,turns:1,repairRounds:0}}};
   else if(path.startsWith('/api/script-candidates?')){events.push('candidates');result={candidates:[candidate]};}
   else if(path==='/api/script-workspaces/work')result={workspace};
   else if(path==='/api/script-workspaces/work/revisions/1')result={document:project};
   else if(path==='/api/script-commands'){
    assert.equal(JSON.parse(init!.body as string).kind,'APPLY');events.push('APPLY');
    candidate.appliedRevision=2;workspace.document=proposed;workspace.revision=2;workspace.hasPendingChanges=true;
    result={workspaceId:'work',runId:'apply-run',threadId:'thread'};
   }
   else if(path==='/api/script-workspaces/work/merge'){events.push('merge');result={proposal:{id:'proposal',digest:'checked',document:proposed},conflicts:[]};}
   else if(path==='/api/script-workspaces/work/adopt'){events.push('adopt');result={receipt:{}};}
   else if(path===`/api/scripts/${project.id}`){events.push('author-read');result={project:{...proposed,revision:project.revision+1}};}
   else if(path==='/api/skills')result=[];
   else throw new Error(`Unexpected fixture request ${path}`);
   return response(result);
  }};
 const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let root:import('react-dom/client').Root|undefined;
 try{
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const {createRoot}=await import('react-dom/client'),{ScriptDurablePanel}=await import('../apps/web/src/features/script/ScriptDurablePanel');
  root=createRoot(dom.window.document.getElementById('root')!);
  const flush=async()=>{await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));});};
  await act(async()=>{root!.render(React.createElement(ScriptDurablePanel,{mode:'manual',project,unit:project.units[0],dirty:false,onSave:async()=>{},onOpenScene:()=>{},
   onApplied:(next,base,trusted)=>{events.push('onApplied');assert.equal(next.brief.concept,'新候选');assert.equal(next.revision,project.revision+1);assert.equal(base.revision,project.revision);assert.equal(trusted,true);adopted=true;}}));});
  await flush();await flush();
  assert.equal(progressReads,1);assert.equal(fullReads,0,'closed detail must never fetch full review or budget');
  assert.equal(dom.window.document.querySelectorAll('.script-chat-candidate').length,1,'pending progress must not block candidates');
  const detail=[...dom.window.document.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='查看检查结果与用量')!;
  await act(async()=>{detail.open=true;detail.dispatchEvent(new dom.window.Event('toggle'));});await flush();
  assert.equal(fullReads,0,'opening details must drain the existing summary flight instead of overlapping a second graph read');
  assert.match(detail.textContent!,/模型调用 3\/40/,'budget must display while the expensive evidence read is pending');
  await act(async()=>{pending[0](response({redacted:false,review:null}));});await flush();
  assert.equal(fullReads,1);assert.equal(progressReads,1);assert.match(detail.textContent!,/正在读取/);
  const adopt=[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='采用到作品')!;
  assert.equal(adopt.disabled,false,'independent detail loading must not acquire the mutation lock');
  await act(async()=>{adopt.click();});await flush();await flush();
  assert.equal(adopted,false,'a lagging workspace must wait for its APPLY version');
  assert.doesNotMatch(dom.window.document.body.textContent!,/工作稿在采用期间出现其他修改/,
    'an older polling snapshot is not an additional manuscript edit');
  workspaceLag=false;
  Object.defineProperty(dom.window.document,'hidden',{configurable:true,value:true});
  const callbacks=[...timers.values()];timers.clear();
  await act(async()=>{for(const callback of callbacks)callback();});await flush();await flush();
  assert.equal(adopted,true,JSON.stringify({events,text:dom.window.document.body.textContent}));
  assert.deepEqual(events.filter(event=>event!=='candidates'),['APPLY','merge','adopt','author-read','onApplied']);
  assert.match(dom.window.document.body.textContent!,/已采用，当前稿已更新/);
  await act(async()=>{root!.unmount();});root=undefined;
  // Retired reads cannot publish after teardown; the formal data is never used.
  for(const resolve of pending)resolve(response({redacted:false,review:null,budget:{}}));
  await flush();
 }finally{
  if(root)await act(async()=>{root!.unmount();});
  for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  dom.window.close();
 }
});

test('goal read lanes reject retired responses, serialize same-goal reopen and clear failed snapshots',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
 const timers=new Map<number,()=>void>();let timerId=990000,scheduledDelay=0,readInterval=60000;
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true,
  setTimeout:((callback:()=>void,delay?:number,...args:any[])=>{if(delay===60000){scheduledDelay=delay;const id=timerId++;timers.set(id,callback);return id;}return realSetTimeout(callback,delay,...args);}) as typeof setTimeout,
  clearTimeout:((id:ReturnType<typeof setTimeout>)=>{if(!timers.delete(Number(id)))realClearTimeout(id);}) as typeof clearTimeout};
 const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const pending:Array<{resolve:(value:{marker:string})=>void;reject:(error:Error)=>void}>=[];
 let root:import('react-dom/client').Root|undefined;
 try{
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const {createRoot}=await import('react-dom/client'),{useGoalPollingRead}=await import('../apps/web/src/features/script/useGoalPollingRead');
  const Fixture=({readKey}:{readKey:string|null})=>{
   const state=useGoalPollingRead(readKey,()=>new Promise<{marker:string}>((resolve,reject)=>pending.push({resolve,reject})),readKey?.split(':')[0],readInterval);
   return React.createElement('p',null,state.loading?'loading':state.error?'denied':state.value?.marker||'empty');
  };
  root=createRoot(dom.window.document.getElementById('root')!);
  const flush=async()=>{await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));});};
  const render=async(key:string|null)=>{await act(async()=>{root!.render(React.createElement(Fixture,{readKey:key}));});await flush();};
  await render('goal-a:1');assert.equal(pending.length,1);
  await render(null);await render('goal-a:2');
  assert.equal(pending.length,1,'changed revisions/reopen must wait for the retired same-goal flight');
  await act(async()=>{pending[0].resolve({marker:'retired'});});await flush();
  assert.equal(pending.length,2);assert.equal(dom.window.document.body.textContent,'loading');
  await act(async()=>{pending[1].resolve({marker:'fresh'});});await flush();
  assert.equal(dom.window.document.body.textContent,'fresh');assert.equal(timers.size,1);
  assert.equal(scheduledDelay,60000,'completed evidence uses bounded background revalidation, not a permanent cache');
  readInterval=3000;await render('goal-a:2');
  assert.equal(pending.length,2,'cadence changes alone must not restart the same expensive evidence read');
  assert.equal(dom.window.document.body.textContent,'fresh');
  readInterval=60000;await render('goal-a:2');
  const [id,poll]=timers.entries().next().value!;timers.delete(id);await act(async()=>{poll();});await flush();
  assert.equal(pending.length,3);
  await act(async()=>{pending[2].reject(new Error('source withdrawn'));});await flush();
  assert.equal(dom.window.document.body.textContent,'denied','failed revalidation clears the previously complete status');
  await render('goal-b:1');assert.equal(pending.length,4);
  await render('goal-c:1');assert.equal(pending.length,5);
  await act(async()=>{pending[4].resolve({marker:'goal-c'});pending[3].resolve({marker:'wrong-goal'});});await flush();
  assert.equal(dom.window.document.body.textContent,'goal-c');assert.equal(timers.size,1);
  await act(async()=>{root!.unmount();});root=undefined;assert.equal(timers.size,0);
 }finally{
  if(root)await act(async()=>{root!.unmount();});
  for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  dom.window.close();
 }
});

test('candidate batches cover every requested workspace and never publish partial results after a later denial',async t=>{
 const {scriptAgentClient}=await import('../apps/web/src/clients/scriptClient');
 const ids=Array.from({length:205},(_,index)=>`workspace-${index}`),seen:string[][]=[];let deny=false;
 t.mock.method(globalThis,'fetch',async(input:RequestInfo|URL)=>{
  const url=new URL(String(input),'http://fixture.invalid'),batch=JSON.parse(url.searchParams.get('workspaceIds')!) as string[];
  assert.equal(url.pathname,'/api/script-candidates');assert.equal(url.searchParams.get('threadId'),'thread');assert.equal(url.searchParams.get('documentId'),'document');
  assert.ok(batch.length<=100);seen.push(batch);
  if(deny&&batch.includes('workspace-204'))return new Response(JSON.stringify({code:'CONTEXT_REVOKED',error:'撤回'}),{status:403});
  return new Response(JSON.stringify({candidates:batch.map(workspaceId=>({id:workspaceId,workspaceId}))}),{status:200});
 });
 assert.deepEqual((await scriptAgentClient.candidateBatch('thread','document',ids)).candidates.map(item=>item.id),ids);
 assert.deepEqual(seen.flat(),ids);
 seen.length=0;deny=true;
 await assert.rejects(scriptAgentClient.candidateBatch('thread','document',ids),/撤回/);
 assert.deepEqual(seen.flat(),ids,'a new refresh validates all old workspaces again before a later revoked batch fails closed');
});

test('selected goal and linked runs share one fresh WAITING read while independent runs still refresh',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
 const project=createScriptProject('单次委托请求读取',createScriptCreationProfile('short-film',1,3));
 const workspace={id:'work',threadId:'thread',documentId:project.id,projectId:project.id,document:project,
  revision:1,baseWorkspaceRevision:1,baseProjectRevision:project.revision,writerEpoch:0,writerRunId:null,hasPendingChanges:false};
 const goal={id:'goal',workspaceId:'work',lastRunId:'goal-run',activeRunId:'goal-run',version:1,
  revision:{objective:'机械委托',skillManifest:[],route:{channel:'external'},contract:{value:{stopAfter:'BODY',scope:{units:[],newUnitSlots:[],sharedFields:[]},checks:{targetUnitIds:[]}}}}};
 let generation=1,revoked=false,goalReads=0,progressReads=0,detailReads=0,budgetReads=0;const individualReads:string[]=[];
 const timers=new Map<number,{callback:()=>void;delay:number}>();let timerId=920000;
 const realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
 const external=(id:string)=>({id:`${id}-request`,runId:id,status:'WAITING',request:{prompt:`MECHANICAL_${generation}_${id}`}});
 const response=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 const values:Record<string,unknown>={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,
  localStorage:dom.window.localStorage,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true,
  setTimeout:((callback:()=>void,delay?:number,...args:any[])=>{if(delay===3000||delay===60000){const id=timerId++;timers.set(id,{callback,delay});return id;}return realSetTimeout(callback,delay,...args);}) as typeof setTimeout,
  clearTimeout:((id:ReturnType<typeof setTimeout>)=>{if(!timers.delete(Number(id)))realClearTimeout(id);}) as typeof clearTimeout,
  fetch:async(input:RequestInfo|URL)=>{
   const path=String(input);
   if(path.startsWith('/api/script-assistant/conversations'))return response({conversation:{id:'thread',version:1,seed:[],turns:[]}});
   if(path.startsWith('/api/script-workspaces?'))return response({workspaces:[workspace]});
   if(path.startsWith('/api/script-goals?'))return response({goals:[goal]});
   if(path.startsWith('/api/script-runs?'))return response({runs:[
    {workspaceId:'work',goalId:'goal',run:{id:'goal-run',kind:'GOAL',status:'WAITING_EXTERNAL'}},
    {workspaceId:'work',goalId:'goal',run:{id:'linked-run',kind:'CAPABILITY',status:'WAITING_EXTERNAL'}},
    {workspaceId:'work',goalId:null,run:{id:'independent-run',kind:'CAPABILITY',status:'WAITING_EXTERNAL'}},
   ]});
   if(path.startsWith('/api/agent/runs/')){individualReads.push(path);return response({run:{id:'independent-run',kind:'CAPABILITY',status:'WAITING_EXTERNAL'},externalRequests:[external('independent-run')]});}
   if(path==='/api/script-goals/goal/external-requests?view=state'){
    goalReads++;if(revoked)return new Response(JSON.stringify({error:'机械撤权',code:'CONTEXT_REVOKED'}),{status:403});
    return response({externalRequests:['goal-run','linked-run'].map(runId=>({runId,role:runId==='goal-run'?'GOAL_CONTROLLER':'MANUAL_STEP',request:external(runId)}))});
   }
   if(path==='/api/script-goals/goal/review?view=progress'){progressReads++;return response({redacted:false,review:null});}
   if(path==='/api/script-goals/goal/review'){detailReads++;return response({redacted:false,review:null});}
   if(path==='/api/script-goals/goal/budget'){budgetReads++;return response({budget:{version:1,limits:{maxInvocations:40,maxToolCalls:80,maxTurns:8},used:{invocations:3,toolCalls:1,turns:1,repairRounds:0}}});}
   if(path.startsWith('/api/script-candidates?'))return response({candidates:[]});
   if(path==='/api/skills')return response([]);
   throw Error(`unexpected ${path}`);
  }};
 const previous=new Map(Object.keys(values).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let root:import('react-dom/client').Root|undefined;
 try{
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  const {createRoot}=await import('react-dom/client'),{ScriptDurablePanel}=await import('../apps/web/src/features/script/ScriptDurablePanel');
  root=createRoot(dom.window.document.getElementById('root')!);
  const flush=async()=>{await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve));});};
  await act(async()=>{root!.render(React.createElement(ScriptDurablePanel,{mode:'agent',project,unit:project.units[0],dirty:false,onSave:async()=>{},onApplied:()=>{},onOpenScene:()=>{}}));});
  await flush();await flush();
  assert.equal(goalReads,1);
  assert.deepEqual(individualReads,['/api/agent/runs/independent-run?view=state']);
  assert.equal((dom.window.document.body.textContent!.match(/尚未完成的测试请求/g)||[]).length,2,'both selected-goal requests remain visible in the goal panel');
  const detail=[...dom.window.document.querySelectorAll('details')].find(item=>item.querySelector('summary')?.textContent==='查看检查结果与用量')!;
  await act(async()=>{detail.open=true;detail.dispatchEvent(new dom.window.Event('toggle'));});await flush();
  assert.equal(progressReads,1);assert.equal(detailReads,1);assert.equal(budgetReads,1);
  const poll=async(delay=3000)=>{const selected=[...timers].filter(([,timer])=>timer.delay===delay);selected.forEach(([id])=>timers.delete(id));
   await act(async()=>{selected.forEach(([,timer])=>timer.callback());});await flush();await flush();};
  generation++;await poll();
  assert.equal(goalReads,2,'each poll must obtain a newly authorized response, not reuse a previous grant');
  assert.equal(individualReads.length,2);
  assert.equal(progressReads,1,'open details supply progress without a second summary graph read');
  assert.equal(detailReads,1,'unchanged historical evidence must not rerun its full graph on the three-second status poll');
  assert.equal(budgetReads,2,'inexpensive budget reads retain their independent cadence');
  await poll(60000);
  assert.equal(detailReads,2,'unchanged evidence still obtains fresh authorization once a minute');
  assert.equal(goalReads,2,'the evidence timer does not duplicate the pending-request read');
  goal.version++;await poll();
  assert.equal(goalReads,3);
  assert.equal(detailReads,3,'a changed goal version refreshes evidence immediately instead of waiting for its timer');
  revoked=true;await poll();
  assert.equal(goalReads,4);
  assert.doesNotMatch(dom.window.document.body.textContent!,/尚未完成的测试请求/,'denial removes every previously displayed request');
  assert.match(dom.window.document.body.textContent!,/机械撤权/);
 }finally{
  if(root)await act(async()=>{root!.unmount();});
  for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  dom.window.close();
 }
});
