import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScriptProject} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {ScriptDocumentComparison,scriptChangeValue} from '../apps/web/src/features/script/components/ScriptCandidateCard';
import {anchorFor,outlineGuideId} from '../packages/script/src/outlineGuides';

const render=(before:ReturnType<typeof createScriptProject>,after:typeof before)=>renderToStaticMarkup(React.createElement(ScriptDocumentComparison,{before,after}));
const fixture=()=>createScriptProject('比较验收',createScriptCreationProfile('short-film',1,5));

test('adoption preview includes blueprint changes even when script body is empty',()=>{
  const before=fixture();before.brief.concept='原来的前提';before.brief.theme='作者的冲突';
  const after=structuredClone(before);after.brief.concept='候选前提';after.brief.theme='合并后的冲突';
  const html=render(before,after);
  for(const text of ['故事前提','主题与核心问题','原来的前提','作者的冲突','候选前提','合并后的冲突'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('project/brief'));
});

test('adoption preview includes outline and scene planning changes before any body exists',()=>{
  const before=fixture(),after=structuredClone(before);
  after.brief.outline='完整故事总纲';after.units[0].summary='当前集的故事走向';
  after.units[0].scenes[0].purpose='主人公发现时钟的代价';after.units[0].scenes[0].location='钟表店';
  const html=render(before,after);
  for(const text of ['完整故事总纲','当前集的故事走向','主人公发现时钟的代价','钟表店'])assert.ok(html.includes(text),text);
});

test('choosing the author version does not claim the rejected candidate will be saved',()=>{
  const before=fixture();before.brief.theme='保留作者选择';
  const html=render(before,structuredClone(before));
  assert.ok(html.includes('已保留作品中的内容，无需替换'));
  assert.ok(!html.includes('采用后'));
});

test('story and season outline comparisons show both actual texts',()=>{
  const before=fixture();before.units[0].scopeId=before.units[0].id;before.storyOutlines=[{scopeId:before.units[0].id,outline:'原本的故事'}];before.seasons=[{id:'season-local',title:'第二季',arc:'原季走向'}];
  const after=structuredClone(before);after.storyOutlines[0].outline='修改后故事';after.seasons[0].arc='新季走向';
  const html=render(before,after);for(const value of ['原本的故事','修改后故事','原季走向','新季走向'])assert.ok(html.includes(value),value);
});

test('planning comparison names related scenes and preserves stale quotations without exposing storage fields',()=>{
  const project=fixture(),unit=project.units[0],scene=unit.scenes[0];
  project.brief.outline='发现旧信。决定返乡。';unit.structureNodes=[{id:'node-private-id',title:'发现旧信',purpose:''}];scene.title='候车室';
  const owner={kind:'project' as const,id:project.id},id=outlineGuideId(owner),anchor=anchorFor(project.brief.outline,0,5);
  const guide={id,owner,nodeLinks:[{unitId:unit.id,nodeId:'node-private-id',anchor}],beats:[{id:'beat-private-id',title:'决定追查',change:'由回避转为追查',anchors:[anchor],unitIds:[unit.id],sceneRefs:[{unitId:unit.id,sceneId:scene.id}]}]};
  project.outlineGuides=[guide];
  const nodes=scriptChangeValue(project,`outlineGuides/${id}`,'nodeLinks',guide.nodeLinks);
  const beats=scriptChangeValue(project,`outlineGuides/${id}`,'beats',guide.beats);
  assert.match(nodes,/发现旧信/);assert.match(beats,/候车室/);assert.match(beats,/由回避转为追查/);
  for(const text of [nodes,beats]){assert.doesNotMatch(text,/sourceHash|node-private-id|beat-private-id/);assert.doesNotMatch(text,/待复核/);}
  project.brief.outline='另一个开头。';
  assert.match(scriptChangeValue(project,`outlineGuides/${id}`,'nodeLinks',guide.nodeLinks),/原文待复核[\s\S]*发现旧信。/);
});

test('order comparisons resolve names and conceal missing storage identifiers',()=>{
  const project=fixture(),unit=project.units[0],scene=unit.scenes[0];scene.title='站台对峙';
  assert.equal(scriptChangeValue(project,`sceneOrder/${unit.id}`,undefined,[scene.id,'removed-private-id']),'站台对峙 → 已移除项目');
  assert.equal(scriptChangeValue(project,'order/units',undefined,[unit.id]),unit.title);
});

test('beat storyline changes are visible in author adoption comparison without exposing relation IDs',()=>{
  const before=fixture(),owner={kind:'project' as const,id:before.id};
  before.brief.outline='她读完来信，决定核实。';
  before.storylines=[{id:'line-internal-relation-id',scopeId:before.id,lane:'A',title:'父女重建信任',premise:'',resolution:''}];
  before.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{id:'beat-internal-relation-id',title:'决定核实',change:'从回避到面对',anchors:[anchorFor(before.brief.outline,0,before.brief.outline.length)],unitIds:[],sceneRefs:[]}]}];
  const after=structuredClone(before);after.outlineGuides![0].beats[0].storylineIds=['line-internal-relation-id'];
  const html=render(before,after);
  assert.match(html,/尚未关联故事线/);assert.match(html,/关联故事线：父女重建信任/);
  assert.doesNotMatch(html,/line-internal-relation-id|beat-internal-relation-id|storylineIds/);
});
