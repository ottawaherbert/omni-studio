import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
import { MemoryRouter } from 'react-router-dom';
// Node SSR has no CSS renderer; leave application module execution intact.
register('data:text/javascript,' + encodeURIComponent("export async function load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return next(url,context)}"), import.meta.url);
const { GenerationWorkbench } = await import('../src/components/generation/GenerationWorkbench');
import { ShotExecutionEditor } from '../src/components/production/ShotExecutionEditor';

test('generation workbench can render before source timing has loaded', () => {
  const html = renderToStaticMarkup(<MemoryRouter><GenerationWorkbench target={{projectId:'p',episodeId:'e',sceneId:'s',kind:'shot',shotIds:['a']}} operation="video" onClose={()=>{}} /></MemoryRouter>);
  assert.ok(html.length > 0);
});
test('editor keeps fractional narrative time and exposes timing/cut basis in existing fields', () => {
  const html=renderToStaticMarkup(<ShotExecutionEditor shot={{id:'a',duration:0.4,motivation:'开关弹下',editingNote:'动作完成切人物'}} onChange={()=>{}} />);
  assert.match(html,/value="0.4"/); assert.match(html,/估时与切出依据/); assert.match(html,/本镜目的/); assert.match(html,/生成时长可含余量/);
});
