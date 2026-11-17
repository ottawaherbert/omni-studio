import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import type {Scene} from '../src/types/project';

test('collaboration editors submit only changed records and preserve input during delayed saves',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://fixture.invalid',pretendToBeVisual:true});
 const globals={window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true};
 const previous=new Map(Object.keys(globals).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,v] of Object.entries(globals))Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
 const {createRoot}=await import('react-dom/client');
 const {SceneCollaborationPanel}=await import('../src/components/production/SceneCollaborationPanel');
 const {AssetProductionUseEditor}=await import('../src/components/production/AssetProductionUseEditor');
 const root=createRoot(document.getElementById('root')!);
 const click=async(label:string)=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b);await act(async()=>b.click());};
 const fill=async(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='INPUT'?dom.window.HTMLInputElement.prototype:dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});};
 try{
  const scene={id:'s',shots:[],manualStoryboard:{directorPlan:{requirements:[{id:'r',department:'摄影',description:'已有要求'}]}},productionPreparation:{observations:[{id:'old',impact:'note',note:'之前已检查',checkedAt:123,reviewer:'external_agent'}]}} as unknown as Scene;
  const saved:any[]=[];let release!:()=>void;
  await act(async()=>root.render(<SceneCollaborationPanel scene={scene} onSave={async patch=>{saved.push(patch);await new Promise<void>(r=>release=r);}} />));
  await click('记录一次观察');
  const notes=[...document.querySelectorAll('label')].filter(l=>l.textContent?.startsWith('看到了什么')).map(l=>l.querySelector('input')!);
  await fill(notes[1],'新观察');await click('保存本场制作记录');
  assert.deepEqual(Object.keys(saved[0]),['observations']);assert.equal(saved[0].observations.length,1);assert.equal(saved[0].observations[0].note,'新观察');
  assert.equal(document.querySelector('fieldset')!.disabled,true,'typing cannot be lost while a save is in flight');
  await act(async()=>release());assert.equal(notes[1].value,'新观察');
  const value={shotScale:'远景',operations:'旧操作'};
  await act(async()=>root.render(<AssetProductionUseEditor value={value} onSave={async patch=>{saved.push(patch);}} />));
  await act(async()=>root.render(<AssetProductionUseEditor value={{...value,operations:'最新操作'}} onSave={async patch=>{saved.push(patch);}} />));
  const fields=document.querySelectorAll('textarea');assert.equal(fields[2].value,'最新操作');
  await fill(fields[0],'近景');await click('保存拍摄用途');assert.deepEqual(saved.at(-1),{shotScale:'近景'});
 }finally{await act(async()=>root.unmount());for(const [k,d] of previous)d?Object.defineProperty(globalThis,k,d):Reflect.deleteProperty(globalThis,k);dom.window.close();}
});
