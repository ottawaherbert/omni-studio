import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import React from 'react';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptDelivery, exportText } from '../packages/script/src/exporters';
import { blocksToScreenplayText, replaceScreenplaySelection, screenplayTextToBlocks, screenplayBlockTextRanges } from '../packages/script/src/fountainAdapter';
import { createLegacyProductionProjectFromWritingSource, createLegacyProductionProjectFromWritingExport } from '../src/services/production/writingExportLegacyAdapter';
import { createInteractiveWritingPort } from '../src/server/interactiveWritingPort';
import { selectionBlockIds } from '../packages/script/src/agentScope';
import { bodyEvidenceSelection } from '../apps/web/src/features/script/scriptAnalysisNavigation';
import { productionWritingUnitSourceContext } from '../src/services/production/writingSourceContext';
import { productionBreakdownCanonicalAssetContext } from '../src/services/production/manualSceneBreakdown';
import type { ScriptRepository } from '../apps/api/src/repositories/scriptStore';
import type { Character } from '../packages/script/src/schema';

const require = createRequire(import.meta.url);
const fountain = require('fountain-js') as { Fountain: new () => {parse:(text:string,tokens:boolean)=>{tokens:Array<{type:string;text?:string}>}} };
const project = () => createScriptProject('隔离交付', createScriptCreationProfile('micro-drama', 2, 2));

test('v2 交付保留明确规格、确认资料和对白组，两个制片入口采用竖屏；v1 仍可导入', () => {
  const p = project();
  p.profile.aspectRatio = '9:16';
  p.profile.productionMode = 'AI-video';
  p.profile.language = 'zh-CN';
  p.brief.constraints = '不表现暴力';
  p.facts = [
    {id:'rule',scopeId:p.id,status:'approved',text:'夜间房门不能打开'},
    {id:'idea',scopeId:p.id,status:'draft',text:'尚未确认的秘密'},
  ];
  p.characters = [{id:'ming',scopeId:p.id,name:'阿明',bio:'失明的修表匠',desire:'',need:'',contradiction:'',arc:'',voice:''}];
  p.units[0].scenes[0].blocks = screenplayTextToBlocks('阿明\n（低声）\n别出声。', p.characters).blocks;
  const delivery = createScriptDelivery(p);
  assert.equal(delivery.schemaVersion, 'script-delivery.v2');
  assert.equal(delivery.aspectRatio, '9:16');
  assert.equal(delivery.language, 'zh-CN');
  assert.equal(delivery.productionMethod, 'AI-video');
  assert.deepEqual(delivery.authorRequirements, ['不表现暴力']);
  assert.equal(delivery.characters[0].bio, '失明的修表匠');
  assert.deepEqual(delivery.lore.map(fact => fact.definition), ['夜间房门不能打开']);
  assert.deepEqual(delivery.units[0].scenes![0].blocks.map(block => block.type), ['character','parenthetical','dialogue']);
  for (const importer of [createLegacyProductionProjectFromWritingSource, createLegacyProductionProjectFromWritingExport]) {
    const production = importer({package:delivery,productionProjectId:'production',importId:'import',importedAt:1});
    assert.equal(production.aspectRatio, '9:16');
    assert.match(production.characters[0].psychologicalProfile!, /失明的修表匠/);
    assert.equal(production.productionSourceSnapshot?.sourceType, 'writing_export');
    if (production.productionSourceSnapshot?.sourceType !== 'writing_export') throw new Error('missing writing snapshot');
    assert.equal(production.productionSourceSnapshot.package.aspectRatio, '9:16');
    assert.deepEqual(production.productionSourceSnapshot.package.authorRequirements, ['不表现暴力']);
  }
  const old = {...delivery,schemaVersion:'script-delivery.v1' as const};
  delete old.aspectRatio; delete old.language; delete old.productionMethod; delete old.authorRequirements;
  assert.equal(createLegacyProductionProjectFromWritingSource({package:old,productionProjectId:'old',importId:'old'}).aspectRatio, '16:9');
});

test('人物括号对白经 Fountain 实际解析保持归属，局部改写保留旁侧块', () => {
  const p=project();
  p.units[0].scenes[0].location='房间';
  p.units[0].scenes[0].blocks=[
    {id:'before',type:'action',text:'门关上。'},
    {id:'parenthetical',type:'parenthetical',text:'低声'},
    {id:'dialogue',type:'dialogue',speakerName:'阿明',text:'别出声。'},
    {id:'after',type:'action',text:'灯灭了。'},
  ];
  const text=blocksToScreenplayText(p.units[0].scenes[0].blocks);
  assert.match(text,/阿明\n\(低声\)\n别出声。/);
  const parsed=new fountain.Fountain().parse(exportText(p,'fountain'),true).tokens;
  const character=parsed.findIndex(token=>token.type==='character'&&token.text==='阿明');
  assert.deepEqual(parsed.slice(character,character+3).map(token=>token.type),['character','parenthetical','dialogue']);
  assert.equal(parsed.some(token=>token.type==='action'&&token.text==='(低声)'),false);
  const start=text.indexOf('别出声。');
  assert.deepEqual(selectionBlockIds(p,p.units[0].id,p.units[0].scenes[0].id,{start,end:start+4,text:'别出声。'}),['dialogue']);
  assert.equal(bodyEvidenceSelection(p.units[0].scenes[0].blocks,[],{blockId:'dialogue',quote:'别出声。'})?.start,start);
  const edited=replaceScreenplaySelection(p.units[0].scenes[0].blocks,[],{start,end:start+4,text:'别出声。'},'别开门。');
  assert.equal(edited[0].id,'before');
  assert.equal(edited.at(-1)?.id,'after');
  assert.match(blocksToScreenplayText(edited),/阿明\n\(低声\)\n别开门。/);
  assert.deepEqual(screenplayTextToBlocks(blocksToScreenplayText(edited)).blocks.map(block=>block.type),edited.map(block=>block.type));
});

test('空括号说明不产生虚假选区，仍保留对白坐标',()=>{
  const blocks=[{id:'empty',type:'parenthetical' as const,text:'  '},{id:'line',type:'dialogue' as const,speakerName:'阿明',text:'别出声。'}];
  assert.equal(blocksToScreenplayText(blocks),'阿明\n别出声。');
  assert.deepEqual(screenplayBlockTextRanges(blocks).map(range=>({index:range.index,start:range.start,end:range.end})),
    [{index:1,start:0,end:'阿明\n别出声。'.length}]);
});

test('确认设定按所属单元进入制片拆解，上游要求实际进入来源上下文',()=>{
  const p=project();
  p.units[0].scopeId=p.units[0].id;
  p.units.push(newUnit('第二集',p.profile.targetDurationMs));
  for(const unit of p.units)unit.scenes[0].blocks=[{id:`body_${unit.id}`,type:'action',text:'房间内的秘密。'}];
  p.profile.aspectRatio='9:16';p.profile.productionMode='animation';p.brief.constraints='不表现暴力';
  p.facts=[{id:'first_rule',scopeId:p.units[0].scopeId,status:'approved',text:'第一集的门不能开'},
    {id:'second_rule',scopeId:p.units[1].scopeId,status:'approved',text:'第二集的钟不能停'}];
  const delivery=createScriptDelivery(p);
  assert.deepEqual(delivery.lore.map(fact=>fact.sourceUnitIds),[[p.units[0].id],[p.units[1].id]]);
  const production=createLegacyProductionProjectFromWritingSource({package:delivery,productionProjectId:'scope-production',importId:'scope-import'});
  const [first,second]=production.episodes;
  const firstEvidence=JSON.parse(productionBreakdownCanonicalAssetContext(production,{...first,scenes:[]})).upstreamWritingEvidence;
  const secondEvidence=JSON.parse(productionBreakdownCanonicalAssetContext(production,{...second,scenes:[]})).upstreamWritingEvidence;
  assert.deepEqual(firstEvidence.lore.map((fact:{definition:string})=>fact.definition),['第一集的门不能开']);
  assert.deepEqual(secondEvidence.lore.map((fact:{definition:string})=>fact.definition),['第二集的钟不能停']);
  assert.equal(firstEvidence.deliveryRequirements.aspectRatio,'9:16');
  assert.equal(firstEvidence.deliveryRequirements.productionMethod,'animation');
  assert.deepEqual(firstEvidence.deliveryRequirements.authorRequirements,['不表现暴力']);
  const context=productionWritingUnitSourceContext(production,first);
  assert.match(context,/作者要求：不表现暴力/);
  assert.match(context,/已确认设定：第一集的门不能开/);
  assert.doesNotMatch(context,/第二集的钟不能停/);
});

test('旧互动场景校验和仍只匹配同 revision 的历史块序', () => {
  const p=project(); p.revision=2;
  p.units[0].scenes[0].blocks=screenplayTextToBlocks('阿明\n（低声）\n别出声。').blocks;
  const unit=p.units[0], scene=unit.scenes[0];
  const delivery=createScriptDelivery(p).units[0].scenes![0];
  const oldScene={...delivery,blocks:[
    {id:scene.blocks[0].id,type:'parenthetical',content:'低声'},
    {id:`${scene.blocks[1].id}_speaker`,type:'character',content:'阿明'},
    {id:scene.blocks[1].id,type:'dialogue',content:'别出声。'},
  ]};
  const checksum=createHash('sha256').update(JSON.stringify({s:oldScene,revision:p.revision})).digest('hex');
  const repository={readProjectInput:(_id:string,revision:number)=>revision===p.revision?p:null} as ScriptRepository;
  const port=createInteractiveWritingPort(repository);
  const ref={kind:'script_scene' as const,artifactId:`script-scene:${p.id}:${unit.id}:${scene.id}`,versionId:`script-revision:${p.revision}`,checksum};
  assert.ok(port.resolveScene(ref));
  assert.equal(port.resolveScene({...ref,checksum:'invalid'}),null);
  assert.equal(port.resolveScene({...ref,versionId:'script-revision:3'}),null);
});

test('编辑保存回执保留原始空行和光标，切场及外部改稿仍同步', async () => {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
  const {createRoot}=await import('react-dom/client');
  const {ScreenplayEditor}=await import('../apps/web/src/features/script/components/ScreenplayEditor');
  const p=project();p.revision=1;p.units[0].scenes[0].blocks=[{id:'original',type:'action',text:'原动作。'}];
  let scene=p.units[0].scenes[0];
  let characters:Character[]=[];
  let updated=scene;
  const root=createRoot(dom.window.document.getElementById('root')!);
  const render=()=>React.createElement(ScreenplayEditor,{project:p,scene,characters,onUpdateScene:value=>{updated=value;},onRegisterSpeaker:()=>{},onRequestSceneTask:()=>{},onReadThrough:()=>{},onDiscuss:()=>{},onRequestTextTask:()=>{}});
  try {
    await React.act(async()=>root.render(render()));
    const textarea=dom.window.document.querySelector('textarea')!;
    await React.act(async()=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'修改后的动作。\n\n');
      textarea.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    });
    textarea.setSelectionRange(4,4);
    scene=updated;p.revision=2;
    await React.act(async()=>root.render(render()));
    assert.equal(textarea.value,'修改后的动作。\n\n');
    assert.equal(textarea.selectionStart,4);
    scene={...scene,blocks:[{id:'external',type:'action',text:'外部改稿。'}]};
    await React.act(async()=>root.render(render()));
    assert.equal(textarea.value,'外部改稿。');
    characters=[{id:'speaker',scopeId:p.id,name:'阿明',desire:'',need:'',contradiction:'',arc:'',voice:''}];
    scene={...scene,blocks:[{id:'line',type:'dialogue',speakerId:'speaker',text:'别出声。'}]};
    await React.act(async()=>root.render(render()));
    assert.equal(textarea.value,'阿明\n别出声。');
    characters=[{...characters[0],name:'小明'}];
    await React.act(async()=>root.render(render()));
    assert.equal(textarea.value,'小明\n别出声。');
    scene={...scene,id:'another',blocks:[{id:'second',type:'action',text:'下一场。'}]};
    await React.act(async()=>root.render(render()));
    assert.equal(textarea.value,'下一场。');
  } finally {await React.act(async()=>root.unmount());dom.window.close();}
});
