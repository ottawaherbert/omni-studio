import test from 'node:test';
import assert from 'node:assert/strict';
import React, {type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScriptProject, newUnit} from '../packages/script/src/project';
import {parseScriptProject, type ScriptProject} from '../packages/script/src/schema';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {anchorFor, outlineGuideId, type OutlineOwner} from '../packages/script/src/outlineGuides';
import {ScriptStructure} from '../apps/web/src/features/script/ScriptStructure';
import {TextField} from '../apps/web/src/features/script/ScriptFields';

function fixture(){
  const project=createScriptProject('故事线收口隔离样本',createScriptCreationProfile('tv-series',3,20));
  const unit=project.units[0];unit.scopeId='story_local';unit.seasonId='season_first';unit.summary='她读完来信，决定找父亲核实。';
  project.seasons=[{id:'season_first',title:'第一季',arc:'父女追查旧案。'}];
  project.storyOutlines=[{scopeId:unit.scopeId,outline:'父女读信后找到证人，公开旧案。'}];
  const next=newUnit('下一集',unit.targetDurationMs,unit.scopeId);next.seasonId=unit.seasonId;
  const other=newUnit('另一独立故事',unit.targetDurationMs,'story_foreign');other.seasonId=unit.seasonId;
  project.units.push(next,other);
  project.storylines=[
    {id:'line_shared',scopeId:project.id,lane:'A',title:'旧案主线',premise:'查清事故',resolution:'公开真相'},
    {id:'line_season',scopeId:'season_first',lane:'B',title:'本季证言',premise:'核对证言',resolution:'找到证人'},
    {id:'line_local',scopeId:unit.scopeId,lane:'B',title:'父女关系',premise:'她为什么离开',resolution:'相互理解'},
    {id:'line_foreign',scopeId:other.scopeId,lane:'C',title:'不应显示的海港线',premise:'另一故事秘密',resolution:'秘密结局'}
  ];
  unit.scenes[0].storylineIds=['line_local'];unit.scenes[0].blocks[0].text='既有正文保持。';
  const owner:OutlineOwner={kind:'unit',id:unit.id};
  project.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{id:'beat_local',title:'决定找父亲',change:'从逃避到核实',anchors:[anchorFor(unit.summary,0,unit.summary.length)],unitIds:[unit.id],sceneRefs:[],storylineIds:['line_local']}]}];
  return parseScriptProject(project);
}
function capture(project:ScriptProject,owner?:OutlineOwner,onChange?:(fn:(p:ScriptProject)=>void)=>void,onOpenBeat?:(owner:OutlineOwner,id:string)=>void){
  let tree:ReactNode;
  function Capture(){tree=ScriptStructure({project,unit:project.units[0],owner,onChange:onChange??(()=>{}),onOpenScene:()=>{},onOpenBeat});return tree;}
  return {html:renderToStaticMarkup(<Capture/>),tree};
}
function elements(node:ReactNode):React.ReactElement<any>[]{
  if(Array.isArray(node))return node.flatMap(elements);
  if(!React.isValidElement<any>(node))return [];
  const element=node as React.ReactElement<{children?:ReactNode}>;
  return [element,...elements(element.props.children)];
}
function text(node:ReactNode):string{
  if(Array.isArray(node))return node.map(text).join('');
  return React.isValidElement<any>(node)?text((node as React.ReactElement<{children?:ReactNode}>).props.children):typeof node==='string'||typeof node==='number'?String(node):'';
}
function lineArticle(tree:ReactNode,id:string){
  const found=elements(tree).find(e=>e.props['data-storyline-id']===id);assert.ok(found);return found;
}

test('storyline planning opens directly and isolates the current story from another in the same season',()=>{
  const project=fixture(),{html}=capture(project);
  assert.match(html,/父女关系/);assert.match(html,/旧案主线/);assert.match(html,/本季证言/);
  assert.doesNotMatch(html,/不应显示的海港线|另一故事秘密|秘密结局/);
  assert.doesNotMatch(html,/<details/);
});
test('explicit season and project views do not reveal member story private lines',()=>{
  const project=fixture(),season=capture(project,{kind:'season',id:'season_first'}).html;
  assert.match(season,/旧案主线/);assert.match(season,/本季证言/);assert.doesNotMatch(season,/父女关系|不应显示的海港线/);
  const whole=capture(project,{kind:'project',id:project.id}).html;
  assert.match(whole,/旧案主线/);assert.doesNotMatch(whole,/本季证言|父女关系|不应显示的海港线/);
});
test('explicit beat relations can be viewed and opened without inferring them from scenes',()=>{
  const project=fixture();let opened:any;
  const {tree}=capture(project,undefined,undefined,(...args)=>{opened=args;});
  const local=lineArticle(tree,'line_local'),shared=lineArticle(tree,'line_shared');
  assert.match(text(local),/相关关键节拍 · 1/);assert.match(text(shared),/相关关键节拍 · 0/);
  const link=elements(local).find(e=>e.type==='button'&&e.props.className==='script-storyline-link'&&text(e.props.children)==='决定找父亲');assert.ok(link);
  link.props.onClick();assert.deepEqual(opened,[{kind:'unit',id:project.units[0].id},'beat_local']);
});
test('checkbox editing persists the explicit edge and leaves original, body and other lines unchanged',()=>{
  const project=fixture(),before=structuredClone(project);let saved=structuredClone(project);
  const {tree}=capture(project,undefined,fn=>fn(saved));
  const shared=lineArticle(tree,'line_shared');
  const checkbox=elements(shared).find(e=>e.type==='input'&&e.props.type==='checkbox');assert.ok(checkbox);
  checkbox.props.onChange({target:{checked:true}});
  assert.deepEqual(saved.outlineGuides![0].beats[0].storylineIds,['line_local','line_shared']);
  assert.deepEqual(saved.units,before.units);assert.deepEqual(saved.storylines,before.storylines);
  const refreshed=parseScriptProject(JSON.parse(JSON.stringify(saved)));
  assert.match(text(lineArticle(capture(refreshed).tree,'line_shared')),/相关关键节拍 · 1/);
});
test('editing a storyline validates and preserves text, scenes and explicit beat links',()=>{
  const project=fixture();let saved=structuredClone(project);
  const {tree}=capture(project,undefined,fn=>fn(saved));
  const field=elements(lineArticle(tree,'line_local')).find(e=>e.type===TextField&&e.props.label==='核心问题 / 推动力');assert.ok(field);
  field.props.onChange('她愿不愿意相信父亲');
  assert.equal(saved.storylines!.find(line=>line.id==='line_local')!.premise,'她愿不愿意相信父亲');
  assert.deepEqual(saved.units,project.units);assert.deepEqual(saved.outlineGuides,project.outlineGuides);
});
test('new storylines inherit the explicitly selected outline scope',()=>{
  for(const ownerKind of ['unit','story','season','project'] as const){
    const project=fixture(),owner:OutlineOwner={kind:ownerKind,id:ownerKind==='unit'?project.units[0].id:ownerKind==='story'?project.units[0].scopeId:ownerKind==='season'?'season_first':project.id};
    let saved=structuredClone(project);
    const {tree}=capture(project,owner,fn=>fn(saved));
    const add=elements(tree).find(e=>e.type==='button'&&text(e.props.children)==='添加故事线');assert.ok(add);add.props.onClick();
    assert.equal(saved.storylines!.at(-1)!.scopeId,ownerKind==='unit'?project.units[0].scopeId:owner.id);
    assert.doesNotThrow(()=>parseScriptProject(saved));
  }
});

test('a queued relation edit preserves newer unrelated author edits',()=>{
  const project=fixture();let queued:((p:ScriptProject)=>void)|undefined;
  const {tree}=capture(project,undefined,fn=>{queued=fn;});
  const checkbox=elements(lineArticle(tree,'line_shared')).find(e=>e.type==='input'&&e.props.type==='checkbox');assert.ok(checkbox);
  checkbox.props.onChange({target:{checked:true}});
  const current=structuredClone(project);current.units[0].scenes[0].blocks[0].text='作者刚刚补写的动作。';
  assert.ok(queued);queued(current);
  assert.equal(current.units[0].scenes[0].blocks[0].text,'作者刚刚补写的动作。');
  assert.deepEqual(current.outlineGuides![0].beats[0].storylineIds,['line_local','line_shared']);
});
