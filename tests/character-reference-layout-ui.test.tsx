import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useState} from 'react';
import {JSDOM} from 'jsdom';
import {CharacterReferenceLayoutInfo} from '../src/components/production/CharacterReferenceLayoutInfo';
import type {CharacterReferenceLayout} from '../src/types/project';
test('only the new layout is offered; historical adoption is clearly identified',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid'});
 const globals={window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
 try{
  await act(async()=>root.render(<CharacterReferenceLayoutInfo activeLayout="standard"/>));
  assert.equal(document.querySelector('select'),null);assert.match(document.body.textContent!,/故事画面仍保留完整头部/);assert.match(document.body.textContent!,/历史完整三视图，待新版参考采用/);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}
});
