import test from 'node:test';
import assert from 'node:assert/strict';
import React, {type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScriptProject, newScene, newUnit} from '../packages/script/src/project';
import {parseScriptProject, type ProjectProfile, type ScriptProject} from '../packages/script/src/schema';
import {anchorFor, outlineGuideId, type OutlineGuide} from '../packages/script/src/outlineGuides';
import {blocksToScreenplayText} from '../packages/script/src/fountainAdapter';
import {StoryOutlineView, focusOutlineEvidence} from '../apps/web/src/features/script/components/StoryOutlineView';
import {OutlineBeats} from '../apps/web/src/features/script/components/OutlineBeats';
import {ScenePlanningView, focusScenePlanningField} from '../apps/web/src/features/script/components/ScenePlanningView';
import {ScriptReadThrough} from '../apps/web/src/features/script/components/ScriptReadThrough';
import {ScriptStructure} from '../apps/web/src/features/script/ScriptStructure';
import type {WritingTaskRequest} from '../apps/web/src/features/script/scriptTaskShortcuts';

const profile:ProjectProfile={organization:'episodic',continuity:'mixed',workType:'电视剧',genres:['剧情'],language:'zh-CN',plannedUnits:4,targetDurationMs:60000,toleranceMs:5000,includeCredits:false,aspectRatio:'16:9',productionMode:'live-action'};

function fixture(){
  const project=createScriptProject('组件定位隔离样本',{...profile}),unit=project.units[0];
  unit.scopeId='story_shared';unit.seasonId='season_first';unit.summary='本集先核实来信。';
  unit.structureNodes=[{id:'part_arrival',title:'来信'},{id:'part_departure',title:'出发'}];
  unit.scenes=[newScene('同名场景'),newScene('同名场景')];
  unit.scenes.forEach((scene,index)=>{scene.structureNodeId=unit.structureNodes![index].id;scene.purpose=`本场事件${index}`;scene.entryState=`进入状态${index}，手里没有信。`;scene.exitState=`离开状态${index}`;scene.blocks[0].text=`正文${index}仍然保留。`;});
  project.brief.outline='全剧最终找回失踪者。';
  project.seasons=[{id:'season_first',title:'第一季',arc:'本季揭开来信的来历。'},{id:'season_second',title:'第二季',arc:'下一季寻找寄信人。'}];
  project.storyOutlines=[{scopeId:unit.scopeId,outline:'本故事从收信到启程。'}];
  const second=newUnit('第 2 集',unit.targetDurationMs,unit.scopeId);second.seasonId=unit.seasonId;second.scenes[0].title='同名场景';project.units.push(second);
  const other=newUnit('另一独立故事',unit.targetDurationMs,'story_other');other.seasonId=unit.seasonId;other.scenes[0].title='禁止混入的场景';project.units.push(other);
  return parseScriptProject(project);
}

// SSR supplies React's supported hook dispatcher. This captures the returned
// element tree for direct callback checks; it does not emulate a browser DOM.
function renderComponent<P>(component:(props:P)=>ReactNode,props:P){
  let tree:ReactNode;
  function Capture(){tree=component(props);return tree;}
  const html=renderToStaticMarkup(React.createElement(Capture));
  return {tree,html};
}
function elements(node:ReactNode):React.ReactElement<any>[] {
  if(Array.isArray(node))return node.flatMap(elements);
  if(!React.isValidElement<any>(node))return [];
  const element=node as React.ReactElement<{children?:ReactNode}>;
  return [element,...elements(element.props.children)];
}
function nodeText(node:ReactNode):string {
  if(Array.isArray(node))return node.map(nodeText).join('');
  return React.isValidElement<any>(node)?nodeText((node as React.ReactElement<{children?:ReactNode}>).props.children):typeof node==='string'||typeof node==='number'?String(node):'';
}
function findElement(tree:ReactNode,predicate:(element:React.ReactElement<any>)=>boolean){
  const element=elements(tree).find(predicate);assert.ok(element,'expected component element');return element;
}
const button=(tree:ReactNode,label:string)=>findElement(tree,e=>e.type==='button'&&nodeText(e.props.children)===label);

test('outline focus uses stable beat and node identifiers and converts a node span to local selection',()=>{
  const calls:any[]=[];
  const beat={dataset:{outlineBeat:'beat_exact'},focus:(...args:any[])=>calls.push(['beat',...args]),scrollIntoView:(...args:any[])=>calls.push(['beat-scroll',...args])};
  const node={dataset:{outlineNode:'node_unlinked'},focus:(...args:any[])=>calls.push(['node',...args]),scrollIntoView:(...args:any[])=>calls.push(['node-scroll',...args])};
  const content={querySelectorAll:(selector:string)=>selector==='[data-outline-beat]'?[{dataset:{outlineBeat:'beat_other'}},beat]:[node]} as unknown as HTMLDivElement;
  const editor={focus:(...args:any[])=>calls.push(['editor',...args]),setSelectionRange:(...args:any[])=>calls.push(['selection',...args]),scrollIntoView:()=>{}} as unknown as HTMLTextAreaElement;
  const owner={kind:'unit' as const,id:'unit_test'};
  focusOutlineEvidence(content,editor,{owner,start:0,end:0,tab:'beats',beatId:'beat_exact'});assert.deepEqual(calls,[['beat',{preventScroll:true}],['beat-scroll',{block:'center'}]]);
  calls.length=0;focusOutlineEvidence(content,null,{owner,start:0,end:0,nodeId:'node_unlinked',tab:'outline'});assert.deepEqual(calls,[['node',{preventScroll:true}],['node-scroll',{block:'center'}]]);
  calls.length=0;focusOutlineEvidence(content,editor,{owner,start:7,end:11,nodeId:'node_linked'},5);assert.deepEqual(calls,[['editor',{preventScroll:true}],['selection',2,6]]);
  calls.length=0;focusOutlineEvidence(content,editor,{owner,start:0,end:0,tab:'beats',beatId:'beat_deleted'});assert.deepEqual(calls,[],'a deleted beat must not select an unrelated outline editor');
});

function outlineProps(project:ScriptProject,overrides:Partial<React.ComponentProps<typeof StoryOutlineView>>={}):React.ComponentProps<typeof StoryOutlineView>{
  return {project,activeUnitId:project.units[0].id,choice:'current',tab:'outline',setChoice:()=>{},setTab:()=>{},onUpdateProject:()=>{},onUpdateUnit:()=>{},onSwitchToBlueprint:()=>{},onSwitchToBoard:()=>{},onSelectUnit:()=>{},onAddUnit:()=>{},onSelectNode:()=>{},onRequestTask:()=>{},...overrides};
}

test('outline views edit separate unit, story, season and project originals by exact owner',()=>{
  const project=fixture(),before=structuredClone(project);
  for(const choice of ['current','story','season','project'] as const){
    let updated=structuredClone(project);
    const {tree}=renderComponent(StoryOutlineView,outlineProps(project,{choice,seasonId:'season_second',onUpdateProject:fn=>fn(updated)}));
    const editor=findElement(tree,e=>e.type==='textarea'&&e.props.className==='script-original-editor');
    const expected=choice==='current'?project.units[0].summary:choice==='story'?project.storyOutlines![0].outline:choice==='season'?project.seasons![1].arc:project.brief.outline;
    assert.equal(editor.props.value,expected);editor.props.onChange({target:{value:'作者修改这份原文。'}});
    const expectedProject=structuredClone(project);
    if(choice==='current')expectedProject.units[0].summary='作者修改这份原文。';else if(choice==='story')expectedProject.storyOutlines![0].outline='作者修改这份原文。';else if(choice==='season')expectedProject.seasons![1].arc='作者修改这份原文。';else expectedProject.brief.outline='作者修改这份原文。';
    assert.deepEqual(updated,expectedProject);
  }
  assert.deepEqual(project,before);
});

test('season dropdown and AI request keep the explicitly selected season ID',()=>{
  const project=fixture();let chosen:any,request:any,node:any='before';
  const {tree,html}=renderComponent(StoryOutlineView,outlineProps(project,{choice:'season',seasonId:'season_second',setChoice:(...args)=>{chosen=args;},onSelectNode:id=>{node=id;},onRequestTask:(...args)=>{request=args;}}));
  assert.match(html,/本季：第二季/);assert.match(html,/本故事整体走向/);assert.match(html,/全剧走向/);
  findElement(tree,e=>e.type==='select'&&e.props['aria-label']==='大纲归属').props.onChange({target:{value:'season'}});
  assert.deepEqual(chosen,['season','season_second']);assert.equal(node,undefined);
  findElement(tree,e=>e.type==='button'&&e.props['aria-label']==='与 AI 整理本季完整大纲').props.onClick();assert.equal(request[0],'outline');assert.equal(request[1],project.units[0].id);assert.equal(request[2],'season_second');
});

test('outline storyline callback preserves the clicked scene ID despite identical scene titles',()=>{
  const project=fixture();let opened:any;
  const {tree}=renderComponent(StoryOutlineView,outlineProps(project,{tab:'structure',onSwitchToBoard:(...args)=>{opened=args;}}));
  findElement(tree,e=>e.type===ScriptStructure).props.onOpenScene(project.units[0].scenes[1].id);
  assert.deepEqual(opened,[project.units[0].id,project.units[0].scenes[1].id]);
});

test('season beat quote returns to the same season original instead of the story original',t=>{
  const project=fixture(),owner={kind:'season' as const,id:'season_first'},text=project.seasons![0].arc;
  project.outlineGuides=[{id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{id:'beat_season',title:'查明来历',change:'从怀疑到确认',anchors:[anchorFor(text,2,text.length)],unitIds:[],sceneRefs:[]}]}];
  let chosen:any,tab:any,node:any='before';const prior=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=()=>1;t.after(()=>{if(prior)globalThis.requestAnimationFrame=prior;else delete (globalThis as any).requestAnimationFrame;});
  const {tree}=renderComponent(StoryOutlineView,outlineProps(project,{choice:'season',seasonId:owner.id,tab:'beats',setChoice:(...args)=>{chosen=args;},setTab:value=>{tab=value;},onSelectNode:value=>{node=value;}}));
  findElement(tree,e=>e.type===OutlineBeats).props.onLocate(project.outlineGuides[0],2);
  assert.deepEqual(chosen,['season',owner.id]);assert.equal(tab,'outline');assert.equal(node,undefined);
});

test('a legacy unit beat returns to its retained summary rather than the story alias',t=>{
  const project=fixture();project.units=project.units.slice(0,1);
  const unit=project.units[0],owner={kind:'unit' as const,id:unit.id},text=unit.summary;
  const guide:OutlineGuide={id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{id:'beat_retained_summary',title:'核实',change:'先核实',anchors:[anchorFor(text,0,text.length)],unitIds:[unit.id],sceneRefs:[]}]};project.outlineGuides=[guide];
  let chosen:any;const prior=globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame=()=>1;t.after(()=>{if(prior)globalThis.requestAnimationFrame=prior;else delete (globalThis as any).requestAnimationFrame;});
  const {tree}=renderComponent(StoryOutlineView,outlineProps(project,{tab:'beats',setChoice:(...args)=>{chosen=args;}}));
  findElement(tree,e=>e.type===OutlineBeats).props.onLocate(guide,0);assert.deepEqual(chosen,['legacy',undefined]);
  const target=renderComponent(StoryOutlineView,outlineProps(project,{choice:chosen[0] as React.ComponentProps<typeof StoryOutlineView>['choice']}));assert.equal(findElement(target.tree,e=>e.type==='textarea'&&e.props.className==='script-original-editor').props.value,text);
});

test('beat scene links open exact allowed units and scenes and preserve relationship editing',()=>{
  const project=fixture(),unit=project.units[0],other=project.units[1],owner={kind:'story' as const,id:unit.scopeId},text=project.storyOutlines![0].outline;
  const guide:OutlineGuide={id:outlineGuideId(owner),owner,nodeLinks:[],beats:[{id:'beat_shared',title:'决定出发',change:'从等待到行动',anchors:[anchorFor(text,0,text.length)],unitIds:[unit.id,other.id],sceneRefs:[{unitId:unit.id,sceneId:unit.scenes[1].id},{unitId:other.id,sceneId:other.scenes[0].id}]}]};project.outlineGuides=[guide];
  let opened:any,updated=structuredClone(project);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,onChange:fn=>fn(updated),onOpenScene:(...args)=>{opened=args;}});
  const links=elements(tree).filter(e=>e.type==='button'&&nodeText(e.props.children).startsWith('查看场景：'));assert.equal(links.length,2);
  links[0].props.onClick();assert.deepEqual(opened,[unit.id,unit.scenes[1].id]);links[1].props.onClick();assert.deepEqual(opened,[other.id,other.scenes[0].id]);
  const checkbox=elements(tree).filter(e=>e.type==='input'&&e.props.type==='checkbox')[0];checkbox.props.onChange({target:{checked:true}});
  assert.ok(updated.outlineGuides![0].beats[0].sceneRefs.some(ref=>ref.sceneId===unit.scenes[0].id));assert.deepEqual(updated.units,project.units);assert.deepEqual(updated.storyOutlines,project.storyOutlines);assert.deepEqual(parseScriptProject(updated),updated);
  const withForeign=structuredClone(guide);withForeign.beats[0].sceneRefs.push({unitId:project.units[2].id,sceneId:project.units[2].scenes[0].id});
  const safe=OutlineBeats({project,guides:[withForeign],unitId:unit.id,onChange:()=>{},onOpenScene:()=>{}});assert.doesNotMatch(renderToStaticMarkup(safe),/禁止混入的场景/);
});

function planningProps(project:ScriptProject,overrides:Partial<React.ComponentProps<typeof ScenePlanningView>>={}):React.ComponentProps<typeof ScenePlanningView>{
  return {project,unitId:project.units[0].id,sceneId:project.units[0].scenes[0].id,onUnit:()=>{},onNode:()=>{},onScene:()=>{},onChange:()=>{},onUpdateUnit:()=>{},onAddUnit:()=>{},onAddScene:()=>{},onWrite:()=>{},onOutline:()=>{},onRequest:()=>{},overview:()=>null,...overrides};
}

test('expanded scene edits visible characters, storylines and optional seconds without changing body',()=>{
  const project=fixture(),unit=project.units[0],scene=unit.scenes[0],before=structuredClone(project);
  project.characters=[{id:'character_local',name:'本故事人物',scopeId:unit.scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''},{id:'character_foreign',name:'另一故事专属人物',scopeId:project.units[2].scopeId,desire:'',need:'',contradiction:'',arc:'',voice:''}];
  project.storylines=[{id:'line_local',scopeId:unit.scopeId,lane:'A',title:'追查来信',premise:'',resolution:''},{id:'line_foreign',scopeId:project.units[2].scopeId,lane:'A',title:'另一故事专属线',premise:'',resolution:''}];
  let updated=structuredClone(unit),updates=0;
  const {tree,html}=renderComponent(ScenePlanningView,planningProps(project,{onUpdateUnit:value=>{updated=value;updates++;}}));
  assert.match(html,/更多安排/);assert.match(html,/本故事人物/);assert.match(html,/追查来信/);assert.doesNotMatch(html,/另一故事专属/);
  const duration=findElement(tree,e=>e.type==='input'&&e.props['aria-label']==='目标时长（秒）');assert.equal(duration.props.value,'');
  duration.props.onChange({target:{value:'1.5'}});assert.equal(updated.scenes[0].targetDurationMs,1500);assert.deepEqual(updated.scenes[0].blocks,scene.blocks);assert.deepEqual(updated.scenes[1],unit.scenes[1]);
  duration.props.onChange({target:{value:''}});assert.equal(updated.scenes[0].targetDurationMs,0);
  const count=updates;duration.props.onChange({target:{value:'-1'}});duration.props.onChange({target:{value:'not-a-number'}});assert.equal(updates,count);
  findElement(tree,e=>e.type==='label'&&nodeText(e.props.children)==='本故事人物').props.children[0].props.onChange({target:{checked:true}});assert.deepEqual(updated.scenes[0].characterIds,['character_local']);assert.deepEqual(updated.scenes[0].blocks,scene.blocks);
  findElement(tree,e=>e.type==='label'&&nodeText(e.props.children)==='追查来信').props.children[0].props.onChange({target:{checked:true}});assert.deepEqual(updated.scenes[0].storylineIds,['line_local']);assert.deepEqual(updated.scenes[0].blocks,scene.blocks);
  assert.deepEqual(project.units,before.units,'callbacks stage a unit update without mutating the input snapshot');
});

test('planning focus scrolls the field and selects only a unique exact quote',()=>{
  const calls:any[]=[];const field={value:'前文。进入状态。后文。',focus:(...args:any[])=>calls.push(['focus',...args]),scrollIntoView:(...args:any[])=>calls.push(['scroll',...args]),setSelectionRange:(...args:any[])=>calls.push(['selection',...args])} as unknown as HTMLTextAreaElement;
  focusScenePlanningField(field,'进入状态');assert.deepEqual(calls,[['focus',{preventScroll:true}],['scroll',{block:'center'}],['selection',3,7]]);
  calls.length=0;field.value='重复。重复。';focusScenePlanningField(field,'重复');assert.equal(calls.some(call=>call[0]==='selection'),false);
  calls.length=0;focusScenePlanningField(field,'已经删除');assert.equal(calls.some(call=>call[0]==='selection'),false);assert.doesNotThrow(()=>focusScenePlanningField(undefined,'任何引用'));
});

test('read-through edits the exact chosen unit and scene, preserving author content',()=>{
  const project=fixture(),before=structuredClone(project);let opened:any;
  for(const unit of project.units.slice(0,2)){
    const {tree,html}=renderComponent(ScriptReadThrough,{project,initialUnitId:unit.id,dirty:true,onOpenScene:(...args)=>{opened=args;}});
    assert.match(html,/包含当前未保存的编辑/);
    const buttons=elements(tree).filter(e=>e.type==='button'&&nodeText(e.props.children)==='编辑这一场');assert.equal(buttons.length,unit.scenes.length);
    buttons.at(-1)!.props.onClick();assert.deepEqual(opened,[unit.id,unit.scenes.at(-1)!.id]);
  }
  assert.deepEqual(project,before);
});
