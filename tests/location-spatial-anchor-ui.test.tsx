import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import type { Asset } from '../src/types/project';
import { LocationSpatialAnchorEditor } from '../src/components/production/LocationSpatialAnchorEditor';

test('anchor editor saves position and direction separately, restores them and isolates a state override', async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
  const globals={window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true};
  const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root')!);
  let saved:Asset={id:'room',type:'location',name:'客厅',description:'窗与书柜',variants:[{id:'night',name:'夜间',description:'夜间开灯',promptModifiers:''}]};
  function Editor({variantId}:{variantId?:string}) {const [asset,setAsset]=useState(saved);return <LocationSpatialAnchorEditor asset={asset} variantId={variantId} view="oblique" onChange={next=>{saved=next;setAsset(next);}}/>;}
  const type=async(selector:string,value:string)=>{
    const element=document.querySelector(selector) as HTMLInputElement;
    const proto=element.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;
    await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(element,value);element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,550));});
  };
  try {
    await act(async()=>root.render(<Editor/>));
    await type('textarea','北柜东窗西门');
    await type('input[placeholder="例如：房间南侧，平视"]','南侧平视');
    await type('input[placeholder="例如：朝北墙书柜"]','朝北书柜');
    assert.equal(saved.locationSpatialAnchor?.layout,'北柜东窗西门');
    assert.deepEqual(saved.locationSpatialAnchor?.cameras?.main,{position:'南侧平视',lookAt:'朝北书柜'});
    await act(async()=>root.render(<Editor key="night" variantId="night"/>));
    assert.equal((document.querySelector('textarea') as HTMLTextAreaElement).value,'北柜东窗西门');
    await type('input[placeholder="例如：朝北墙书柜"]','朝北灯下书柜');
    assert.equal(saved.locationSpatialAnchor?.cameras?.main?.lookAt,'朝北书柜');
    assert.equal(saved.variants![0].locationSpatialAnchor?.cameras?.main?.lookAt,'朝北灯下书柜');
    await act(async()=>root.render(<Editor key="restored" variantId="night"/>));
    assert.equal((document.querySelector('input[placeholder="例如：朝北墙书柜"]') as HTMLInputElement).value,'朝北灯下书柜');
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);
  }
});
