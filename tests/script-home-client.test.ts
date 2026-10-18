import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptLibrary } from '../apps/web/src/features/script/ScriptLibrary';
import { ScriptHomeExternalRequest } from '../apps/web/src/features/script/ScriptHomeGoal';
import { scriptConversationClient } from '../apps/web/src/clients/scriptConversationClient';
import type { ExternalRequest } from '../packages/agent-core/src';
import { useSettingsStore } from '../src/store/useSettingsStore';

function enableTestMode(t:test.TestContext){
  const initial=useSettingsStore.getInitialState(),previousInitial=initial.isTestMode,previous=useSettingsStore.getState().isTestMode;
  // Server rendering reads Zustand's initial snapshot; client requests read current state.
  initial.isTestMode=true;useSettingsStore.setState({isTestMode:true});
  t.after(()=>{initial.isTestMode=previousInitial;useSettingsStore.setState({isTestMode:previous});});
}

test('测试模式首页保留创作控件，并提供持久执行渠道选择',t=>{
  enableTestMode(t);
  const html=renderToStaticMarkup(React.createElement(ScriptLibrary,{projects:[],error:'',onOpen:()=>{},onCreate:async()=>{}}));
  assert.match(html,/给 AI 的消息/);
  assert.match(html,/普通模式/);
  assert.match(html,/选择 Skill/);
  assert.match(html,/首页执行方式/);
  assert.match(html,/复制回填/);
});

test('测试模式首页外部请求展示冻结提示词、请求摘要与回填入口',t=>{
  enableTestMode(t);
  const request:ExternalRequest={id:'external-1',invocationId:'invoke-1',runId:'run-1',status:'WAITING',
    inputHash:'frozen-hash',request:{operationKey:'assistant-start',channel:'external',routeRef:'author:external-return',
      systemInstruction:'冻结系统要求',prompt:'冻结作者上下文'}};
  const html=renderToStaticMarkup(React.createElement(ScriptHomeExternalRequest,{request}));
  assert.match(html,/冻结系统要求/);
  assert.match(html,/冻结作者上下文/);
  assert.match(html,/frozen-hash/);
  assert.match(html,/提交本次返回/);
});

test('测试模式持久首页消息把 Agent 意图和外部渠道送到会话 API',async t=>{
  enableTestMode(t);
  const oldFetch=globalThis.fetch;
  let url='',body:Record<string,unknown>={};
  globalThis.fetch=async(input,init)=>{
    url=String(input);body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify({turnId:'turn-1',conversation:{id:'thread-1',version:2,seed:[],turns:[]}}),
      {status:202,headers:{'Content-Type':'application/json'}});
  };
  try{
    const result=await scriptConversationClient.send('thread-1',{requestId:'request-1',expectedVersion:1,
      text:'完成第一集正文',methodIds:['skill-1'],template:'{{conversation}}{{taskContract}}',intent:'AGENT',executionChannel:'external'});
    assert.equal(url,'/api/script-assistant/conversations/thread-1/messages');
    assert.deepEqual(body,{requestId:'request-1',expectedVersion:1,text:'完成第一集正文',methodIds:['skill-1'],
      template:'{{conversation}}{{taskContract}}',intent:'AGENT',executionChannel:'external'});
    assert.equal(result.conversation.id,'thread-1');
  }finally{globalThis.fetch=oldFetch;}
});
