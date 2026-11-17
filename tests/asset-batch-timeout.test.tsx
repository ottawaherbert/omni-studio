import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { defaultAIConfig } from '../src/config/aiConfigDefaults';

test('the actual asset batch hook makes one formal request when the original execution is still running', async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
  const globals={window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const config={...structuredClone(defaultAIConfig),visualQcEnabled:false,
    channels:[{id:'fixture',name:'模拟服务',type:'openai',baseUrl:'https://fixture.invalid',apiKey:'fixture-only',comfyQueue:{waitTimeoutMs:-1,pollIntervalMs:1,maxInFlight:7}}],
    models:[{id:'image',channelId:'fixture',modelId:'gpt-image-1',alias:'图片',capabilities:['image']}],routing:{...defaultAIConfig.routing,imageGen:'image'}} as any;
  const calls:{path:string;body:any}[]=[];
  const capability={id:'cap',allowedOperations:['asset_image'],mode:'text_to_image',inputs:{image:{min:0,max:0},video:{min:0,max:0},audio:{min:0,max:0}},parameters:[{key:'aspectRatio'}]};
  t.mock.method(globalThis,'fetch',async(url:any,init:RequestInit={})=>{
    const path=String(url).split('?')[0],body=init.body?JSON.parse(String(init.body)):undefined;
    calls.push({path,body});
    if(path.includes('ai-config'))return Response.json({config,hasSavedConfig:true});
    if(path.endsWith('/capabilities'))return Response.json({recipes:[{capability,legacyModelIds:['image'],presets:[]}]});
    if(path.endsWith('/workspaces/current'))return Response.json({executions:[]});
    if(path.endsWith('/tasks'))return Response.json({task:{id:'task',revision:1,parameters:{}}});
    if(path.endsWith('/tasks/task'))return Response.json({task:{id:'task',revision:2,parameters:{}}});
    if(path.endsWith('/preflight'))return Response.json({plan:{id:'plan',planHash:'hash'},issues:[]});
    if(path.endsWith('/executions'))return Response.json({execution:{id:'still-running',status:'running',results:[]}});
    if(path.includes('runtime-logs'))return Response.json({ok:true});
    throw new Error(`Unexpected fixture request ${path}`);
  });
  const {createRoot}=await import('react-dom/client');
  const {useAIConfigStore}=await import('../src/store/useAIConfigStore');
  await useAIConfigStore.getState().hydrate();
  useAIConfigStore.setState({...config,hasHydrated:true,isHydrating:false});
  const {useProductionAssetBoardBatch}=await import('../src/hooks/useProductionAssetBoardBatch');
  const project={id:'project',title:'超时夹具',type:'movie',aspectRatio:'16:9',episodes:[],assets:[],characters:[{id:'character',name:'甲',visualIdentity:'成年男子，黑色长发，白色棉布长衫。'}]} as any;
  let batch:ReturnType<typeof useProductionAssetBoardBatch>;
  const Harness=()=>{batch=useProductionAssetBoardBatch({project,episodes:[],updateProject:async()=>{}});return null;};
  const root=createRoot(document.getElementById('root')!);
  try {
    await act(async()=>root.render(<Harness/>));
    await act(async()=>batch.openPrompt());
    assert.ok(batch!.promptRequest);
    await act(async()=>{await assert.rejects(batch.executeBatch(batch.promptRequest!.variables.imagePrompt),/still-running.*仍保留/);});
    assert.equal(calls.filter(call=>call.path.endsWith('/executions')).length,1,JSON.stringify(batch!.progress));
    assert.equal(calls.filter(call=>call.path.endsWith('/tasks')).length,1);
    assert.equal(calls.find(call=>call.path.endsWith('/tasks'))!.body.target.kind,'asset');
    assert.match(batch!.progress.failureReason!,/still-running.*仍保留/);
    assert.equal(batch!.progress.stage,'needs_decision');
  } finally {
    await act(async()=>root.unmount());
    for(const [key,descriptor] of previous)descriptor?Object.defineProperty(globalThis,key,descriptor):Reflect.deleteProperty(globalThis,key);
    dom.window.close();
  }
});
