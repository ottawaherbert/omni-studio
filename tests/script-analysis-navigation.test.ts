import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {bodyEvidenceSelection,scriptUpdatedTarget} from '../apps/web/src/features/script/scriptAnalysisNavigation';
import {blocksToScreenplayText} from '../packages/script/src/fountainAdapter';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {createScriptProject} from '../packages/script/src/project';
import type {ScriptBlock} from '../packages/script/src/schema';
import {resolveTaskUnit} from '../apps/web/src/features/script/scriptTaskShortcuts';

const fixture=()=>createScriptProject('分析导航机械样本',createScriptCreationProfile('short-film',1,5));

test('an explicit season shortcut keeps the selected member instead of redirecting to a legacy season-scope story',()=>{
  const project=fixture(),selected=project.units[0];selected.scopeId='independent-story';selected.seasonId='season-current';
  project.seasons=[{id:'season-current',title:'当前季',arc:'当季方向'}];
  const legacy=structuredClone(selected);legacy.id='legacy-unit';legacy.scopeId='season-current';project.units.unshift(legacy);
  assert.equal(resolveTaskUnit(project,selected.id,undefined,'season-current')?.id,selected.id);
  assert.equal(resolveTaskUnit(project,legacy.id,undefined,'independent-story')?.id,selected.id);
});

test('body evidence uses its block identity when the same quote appears in another block',()=>{
  const blocks:ScriptBlock[]=[{id:'first',type:'action',text:'他说同一句话。'},{id:'empty',type:'action',text:''},
    {id:'second',type:'dialogue',speakerName:'小林',text:'他说同一句话。'}];
  const rendered=blocksToScreenplayText(blocks);
  const selection=bodyEvidenceSelection(blocks,[],{blockId:'second',quote:'同一句话'});
  assert.ok(selection);assert.equal(selection.start,rendered.lastIndexOf('同一句话'));
  assert.equal(rendered.slice(selection.start,selection.end),selection.text);
});

test('body evidence rejects ambiguous quotations inside one block and removed block identities',()=>{
  const blocks:ScriptBlock[]=[{id:'second',type:'action',text:'同一句话。同一句话。'}];
  assert.equal(bodyEvidenceSelection(blocks,[],{blockId:'second',quote:'同一句话'}),null);
  assert.equal(bodyEvidenceSelection(blocks,[],{blockId:'deleted',quote:'同一句话'}),null);
});

test('adopted season outline returns its actual owner and changed passage',()=>{
  const before=fixture(),unit=before.units[0];
  before.seasons=[{id:'season-two',title:'第二季',arc:'她回到故乡。她决定隐瞒。'}];unit.seasonId='season-two';
  const after=structuredClone(before);after.seasons![0].arc='她回到故乡。她决定公开。';
  const target=scriptUpdatedTarget(before,after,unit.id);
  assert.equal(target.view,'outline');assert.equal(target.unitId,unit.id);
  assert.deepEqual(target.outlineFocus?.owner,{kind:'season',id:'season-two'});
  assert.equal(after.seasons![0].arc.slice(target.outlineFocus!.start,target.outlineFocus!.end),'公开');
});

test('adopted story and unit outlines keep distinct owner identities',()=>{
  for(const kind of ['story','unit'] as const){
    const before=fixture(),unit=before.units[0];unit.scopeId='story-main';before.storyOutlines=[{scopeId:'story-main',outline:'旧故事'}];
    const after=structuredClone(before);
    if(kind==='story')after.storyOutlines![0].outline='新故事';else after.units[0].summary='本集大纲';
    assert.deepEqual(scriptUpdatedTarget(before,after).outlineFocus?.owner,{kind,id:kind==='story'?'story-main':unit.id});
  }
});

test('a planning-only adoption returns to its field even when the scene already has body text',()=>{
  const before=fixture(),scene=before.units[0].scenes[0];scene.blocks[0].text='保留的正文';
  const after=structuredClone(before);after.units[0].scenes[0].exitState='决定公开真相';
  const target=scriptUpdatedTarget(before,after);
  assert.equal(target.view,'board');assert.equal(target.sceneId,scene.id);
  assert.deepEqual(target.sceneSource,{kind:'SCENE_PLAN',field:'exitState',quote:'决定公开真相'});
});

test('body adoption returns to the actual changed block',()=>{
  const before=fixture(),after=structuredClone(before),scene=after.units[0].scenes[0];
  scene.blocks[0].text='她摊开手中的旧信。';
  const target=scriptUpdatedTarget(before,after);
  assert.equal(target.view,'studio');assert.equal(target.sceneId,scene.id);
  assert.deepEqual(target.sceneSource,{kind:'BODY_BLOCK',blockId:scene.blocks[0].id,quote:scene.blocks[0].text});
});

test('adopted outline focus does not split a surrogate pair',()=>{
  const before=fixture(),after=structuredClone(before);before.brief.outline='她选了😀。';after.brief.outline='她选了😁。';
  const focus=scriptUpdatedTarget(before,after)!.outlineFocus!;
  assert.equal(after.brief.outline.slice(focus.start,focus.end),'😁');
});

test('keeping all author choices gives no invented update destination',()=>{
  const before=fixture(),after=structuredClone(before);after.revision++;after.updatedAt++;
  assert.equal(scriptUpdatedTarget(before,after),null);
});
