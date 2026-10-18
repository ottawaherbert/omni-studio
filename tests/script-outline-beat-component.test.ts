import test from 'node:test';
import assert from 'node:assert/strict';
import React,{type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createScriptProject,newUnit} from '../packages/script/src/project';
import {parseScriptProject,type ProjectProfile,type ScriptProject} from '../packages/script/src/schema';
import {anchorFor,getOutlineGuide,outlineGuideId,outlineText,ownerUnits,type OutlineGuide,type OutlineOwner} from '../packages/script/src/outlineGuides';
import {OutlineBeats,OutlineBeatTextEditor,outlineBeatChangeRequest,outlineNodesForBeat} from '../apps/web/src/features/script/components/OutlineBeats';
import type {AssistantRequest} from '../apps/web/src/features/script/scriptAssistantShortcuts';

const profile:ProjectProfile={organization:'episodic',continuity:'mixed',workType:'电视剧',genres:['剧情'],language:'zh-CN',plannedUnits:2,targetDurationMs:60000,toleranceMs:5000,includeCredits:false,aspectRatio:'16:9',productionMode:'live-action'};
const source='雨停了。她决定离开。中间这句原文必须保留。她选择回来。最后兑现承诺。';
const firstQuote='她决定离开。',lastQuote='她选择回来。';

function fixture(kind:OutlineOwner['kind']='unit'){
  const project=createScriptProject('节拍组件隔离样本',{...profile}),unit=project.units[0];
  unit.title='第 1 集';unit.scopeId=kind==='project'?project.id:'story_shared';unit.seasonId='season_first';unit.summary=source;
  const second=newUnit('第 2 集',unit.targetDurationMs,unit.scopeId);second.seasonId=unit.seasonId;second.summary=source;project.units.push(second);
  project.brief.outline=source;project.seasons=[{id:'season_first',title:'第一季',arc:source}];
  if(kind!=='project')project.storyOutlines=[{scopeId:unit.scopeId,outline:source}];
  project.storylines=[{id:'line_global',scopeId:project.id,lane:'A',title:'兑现承诺',premise:'她决定怎样守约。',resolution:'她返回兑现。'}];
  unit.structureNodes=[{id:'part_parent',title:'去与回'},{id:'part_choice',parentId:'part_parent',title:'启程'},{id:'part_return',parentId:'part_parent',title:'归来'}];
  unit.scenes[0].structureNodeId='part_choice';unit.scenes[0].blocks[0].text='已有正文保持原样。';
  const owner:OutlineOwner={kind,id:kind==='unit'?unit.id:kind==='project'?project.id:kind==='season'?'season_first':unit.scopeId};
  const firstStart=source.indexOf(firstQuote),lastStart=source.indexOf(lastQuote);
  const firstAnchor=anchorFor(source,firstStart,firstStart+firstQuote.length),lastAnchor=anchorFor(source,lastStart,lastStart+lastQuote.length);
  const guide:OutlineGuide={id:outlineGuideId(owner),owner,nodeLinks:[{unitId:unit.id,nodeId:'part_parent',anchor:anchorFor(source,0,source.length)},{unitId:unit.id,nodeId:'part_choice',anchor:firstAnchor},{unitId:unit.id,nodeId:'part_return',anchor:lastAnchor}],beats:[
    {id:'beat_leave',title:'她决定离开',change:'她离开住处，准备亲自核实。',anchors:[firstAnchor],unitIds:[unit.id],sceneRefs:[{unitId:unit.id,sceneId:unit.scenes[0].id}],storylineIds:['line_global']},
    {id:'beat_return',title:'她选择回来',change:'她放弃躲避，返回兑现承诺。',anchors:[lastAnchor],unitIds:[unit.id],sceneRefs:[],storylineIds:['line_global']}
  ]};
  project.outlineGuides=[guide];
  const valid=parseScriptProject(project);return {project:valid,unit:valid.units[0],guide:valid.outlineGuides![0],owner};
}

// SSR supplies React's hook dispatcher. Callback checks exercise product actions
// with isolated data; this is not a DOM or browser acceptance claim.
function renderComponent<P>(component:(props:P)=>ReactNode,props:P){
  let tree:ReactNode;
  function Capture(){tree=component(props);return tree;}
  const html=renderToStaticMarkup(React.createElement(Capture));return {tree,html};
}
function elements(node:ReactNode):React.ReactElement<any>[] {
  if(Array.isArray(node))return node.flatMap(elements);
  if(!React.isValidElement<any>(node))return [];
  const element=node as React.ReactElement<{children?:ReactNode}>;return [element,...elements(element.props.children)];
}
function nodeText(node:ReactNode):string {
  if(Array.isArray(node))return node.map(nodeText).join('');
  return React.isValidElement<any>(node)?nodeText((node as React.ReactElement<{children?:ReactNode}>).props.children):typeof node==='string'||typeof node==='number'?String(node):'';
}
function find(tree:ReactNode,predicate:(element:React.ReactElement<any>)=>boolean){
  const found=elements(tree).find(predicate);assert.ok(found,'expected component element');return found;
}
const button=(tree:ReactNode,label:string)=>find(tree,e=>e.type==='button'&&nodeText(e.props.children)===label);
function beatArticle(tree:ReactNode,id='beat_leave'){return find(tree,e=>e.props['data-outline-beat']===id);}
function editorTree(tree:ReactNode){
  const editor=find(tree,e=>e.type===OutlineBeatTextEditor);return renderComponent(OutlineBeatTextEditor,editor.props);
}
function submit(tree:ReactNode,title:string,change:string){
  let prevented=false;
  find(tree,e=>e.type==='form').props.onSubmit({preventDefault(){prevented=true;},currentTarget:{elements:{namedItem(name:string){return {value:name==='beat-title'?title:change};}}}});
  assert.equal(prevented,true);
}

test('saving a beat edits only its metadata and preserves original, references, body and other beat',()=>{
  const {project,unit,guide,owner}=fixture(),before=structuredClone(project),updated=structuredClone(project);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:owner,onChange:fn=>fn(updated)});
  const editor=editorTree(beatArticle(tree));
  assert.match(editor.html,/编辑节拍文字/);assert.match(editor.html,/name="beat-title"/);assert.match(editor.html,/name="beat-change"/);
  submit(editor.tree,'  她拿起信出门  ','第一行具体变化。\n第二行保留换行。');
  const expected=structuredClone(before);expected.outlineGuides![0].beats[0].title='她拿起信出门';expected.outlineGuides![0].beats[0].change='第一行具体变化。\n第二行保留换行。';
  assert.deepEqual(updated,expected);assert.deepEqual(project,before,'the input snapshot remains unchanged');
});

test('the native edit form offers required fields, bounded input and cancel without a commit',()=>{
  const {guide}=fixture();let commits=0;
  const editor=renderComponent(OutlineBeatTextEditor,{beat:guide.beats[0],onCommit:()=>{commits++;}});
  const input=find(editor.tree,e=>e.type==='input'),textarea=find(editor.tree,e=>e.type==='textarea');
  assert.equal(input.props.required,true);assert.equal(input.props.maxLength,20000);assert.equal(textarea.props.required,true);assert.equal(textarea.props.maxLength,20000);
  button(editor.tree,'取消').props.onClick();assert.equal(commits,0);
});

test('empty or overlong beat text cannot call the commit handler',()=>{
  const {guide}=fixture();let commits=0;
  const editor=renderComponent(OutlineBeatTextEditor,{beat:guide.beats[0],onCommit:()=>{commits++;}});
  submit(editor.tree,'  ','有效变化');submit(editor.tree,'有效标题','\n  ');submit(editor.tree,'长'.repeat(20001),'有效变化');submit(editor.tree,'有效标题','长'.repeat(20001));
  assert.equal(commits,0);
});

test('a concurrent metadata change is preserved instead of being overwritten by a stale editor',()=>{
  const {project,unit,guide,owner}=fixture(),latest=structuredClone(project);latest.outlineGuides![0].beats[0].change='作者刚刚保存的新变化。';const before=structuredClone(latest);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:owner,onChange:fn=>fn(latest)});
  submit(editorTree(beatArticle(tree)).tree,'旧页面的标题','旧页面提交的变化');assert.deepEqual(latest,before);
});

test('default and a different owner remain read only, but a visible upper beat can still link this scene',()=>{
  const {project,unit,guide,owner}=fixture('story'),updated=structuredClone(project),before=structuredClone(project);
  guide.beats[0].sceneRefs=[];updated.outlineGuides![0].beats[0].sceneRefs=[];
  for(const editableOwner of [undefined,{kind:'unit' as const,id:unit.id},{kind:'unit' as const,id:owner.id}]){
    const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner,onChange:fn=>fn(updated),onRequestChange:()=>assert.fail('upper owner is not a write grant')});
    assert.ok(!elements(tree).some(e=>e.type===OutlineBeatTextEditor));assert.equal(button(beatArticle(tree),'与 AI 修改这一变化').props.disabled,true);
  }
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:{kind:'unit',id:unit.id},onChange:fn=>fn(updated)});
  find(beatArticle(tree),e=>e.type==='input'&&e.props.type==='checkbox').props.onChange({target:{checked:true}});
  assert.deepEqual(updated.outlineGuides![0].beats[0].sceneRefs,[{unitId:unit.id,sceneId:unit.scenes[0].id}]);
  assert.deepEqual(updated.outlineGuides![0].beats[0].anchors,before.outlineGuides![0].beats[0].anchors);
  assert.equal(updated.outlineGuides![0].beats[0].change,before.outlineGuides![0].beats[0].change);assert.equal(outlineText(updated,owner),source);
});

test('AI action emits a single beat allowlist and the exact current source without mutating the document',()=>{
  const {project,unit,guide,owner}=fixture(),before=structuredClone(project);let received:AssistantRequest|undefined;
  guide.beats[1].anchors=structuredClone(guide.beats[0].anchors);before.outlineGuides![0].beats[1].anchors=structuredClone(guide.beats[0].anchors);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:owner,onChange:()=>assert.fail('staging is not adoption'),onRequestChange:request=>{received=request;}});
  const action=button(beatArticle(tree),'与 AI 修改这一变化');assert.equal(action.props.disabled,false);action.props.onClick();
  assert.equal(received?.operation,'unit_outline');assert.equal(received?.draftOperation,'outline_development');assert.equal(received?.stage,'OUTLINE');
  assert.equal(received?.unitId,unit.id);assert.deepEqual(received?.outlineBeatIds,['beat_leave']);assert.equal(received?.outlineStructure,false);assert.equal(received?.outlineSceneOrder,false);
  const anchor=guide.beats[0].anchors[0];assert.deepEqual(received?.outlineRange,{start:anchor.start,end:anchor.end,text:firstQuote});
  assert.match(received!.text,/保留其他节拍、范围外原文/);assert.deepEqual(project,before);
});

for(const kind of ['project','season','story','unit'] as const)test(`AI request preserves explicit ${kind} owner and needs no structure or scene-order grant`,()=>{
  const {project,unit,guide,owner}=fixture(kind),request=outlineBeatChangeRequest(project,guide,guide.beats[0],unit.id,owner);assert.ok(request);
  assert.equal(request.unitId,unit.id);assert.equal(request.operation,kind==='unit'?'unit_outline':'outline');assert.equal(request.scopeId,kind==='unit'?undefined:owner.id);assert.equal(request.seasonId,kind==='season'?owner.id:undefined);
  assert.equal(request.outlineStructure,false);assert.equal(request.outlineSceneOrder,false);assert.deepEqual(request.outlineBeatIds,['beat_leave']);
  assert.equal(outlineBeatChangeRequest(project,guide,guide.beats[0],unit.id),undefined,'omitted owner cannot write');
});

test('multiple quotes request only their bounding source range and retain instructions for untouched gaps',()=>{
  const {project,unit,guide,owner}=fixture('story');guide.beats[0].anchors.push(guide.beats[1].anchors[0]);
  const request=outlineBeatChangeRequest(project,guide,guide.beats[0],unit.id,owner)!;
  const start=source.indexOf(firstQuote),end=source.indexOf(lastQuote)+lastQuote.length;
  assert.deepEqual(request.outlineRange,{start,end,text:source.slice(start,end)});assert.match(request.text,/保留中间未涉及的原文/);assert.deepEqual(request.outlineBeatIds,['beat_leave']);
});

test('stale anchors stay visible and permit metadata correction, but block source edits and guessed node ownership',()=>{
  const {project,unit,guide,owner}=fixture();unit.summary='新开头。'+unit.summary;const updated=structuredClone(project),oldAnchor=structuredClone(guide.beats[0].anchors);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:owner,onChange:fn=>fn(updated),onRequestChange:()=>assert.fail()});
  const article=beatArticle(tree);assert.match(nodeText(article.props.children),/原文待复核/);assert.match(nodeText(article.props.children),/所属段落：待复核/);assert.equal(button(article,'与 AI 修改这一变化').props.disabled,true);
  assert.equal(outlineBeatChangeRequest(project,guide,guide.beats[0],unit.id,owner),undefined);assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[]);
  submit(editorTree(article).tree,'文字标注已核对','只修改说明，不重建原文定位。');assert.equal(updated.outlineGuides![0].beats[0].title,'文字标注已核对');assert.deepEqual(updated.outlineGuides![0].beats[0].anchors,oldAnchor);assert.equal(updated.units[0].summary,unit.summary);
});

test('deleted beat, owner, unit and a mismatched current story cannot acquire an AI edit request',()=>{
  const {project,unit,guide,owner}=fixture('season');
  const beat=structuredClone(guide.beats[0]),deletedBeat=structuredClone(project);deletedBeat.outlineGuides![0].beats.shift();assert.equal(outlineBeatChangeRequest(deletedBeat,guide,beat,unit.id,owner),undefined);
  const deletedOwner=structuredClone(project);deletedOwner.seasons=[];assert.equal(outlineBeatChangeRequest(deletedOwner,guide,beat,unit.id,owner),undefined);
  assert.equal(outlineBeatChangeRequest(project,guide,beat,'unit_missing',owner),undefined);
  const foreign=newUnit('未归属本季的故事',60000,'story_foreign');project.units.push(foreign);assert.equal(outlineBeatChangeRequest(project,guide,beat,foreign.id,owner),undefined);
  assert.equal(outlineBeatChangeRequest(project,guide,beat,unit.id,{kind:'story',id:owner.id}),undefined);
});

test('node ownership derives from valid source containment and chooses a child over its parent',()=>{
  const {project,unit,guide}=fixture();
  assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[{unitId:unit.id,nodeId:'part_choice'}]);
  guide.beats[0].anchors.push(guide.beats[1].anchors[0]);
  assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[{unitId:unit.id,nodeId:'part_choice'},{unitId:unit.id,nodeId:'part_return'}]);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,onChange:()=>{}});assert.match(nodeText(beatArticle(tree).props.children),/所属段落：去与回 \/ 启程；去与回 \/ 归来/);
});

test('equal source intervals prefer a child and stale, removed or merely scene-linked nodes never supply an ownership guess',()=>{
  const {project,unit,guide}=fixture();guide.nodeLinks[0].anchor=structuredClone(guide.nodeLinks[1].anchor);
  assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[{unitId:unit.id,nodeId:'part_choice'}]);
  guide.nodeLinks=[];assert.equal(unit.scenes[0].structureNodeId,'part_choice');assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[]);
  guide.nodeLinks=[{unitId:unit.id,nodeId:'part_choice',anchor:{...guide.beats[0].anchors[0],sourceHash:'0'.repeat(64)}}];assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[]);
  guide.nodeLinks[0].anchor=guide.beats[0].anchors[0];unit.structureNodes=[];assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[]);
});

test('shared original ownership displays proven paragraphs in more than one unit without inventing links',()=>{
  const {project,unit,guide}=fixture('story'),second=ownerUnits(project,guide.owner)[1];second.structureNodes=[{id:'part_second',title:'核实选择'}];
  guide.nodeLinks.push({unitId:second.id,nodeId:'part_second',anchor:guide.beats[0].anchors[0]});
  assert.deepEqual(outlineNodesForBeat(project,guide,guide.beats[0]),[{unitId:unit.id,nodeId:'part_choice'},{unitId:second.id,nodeId:'part_second'}]);
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,onChange:()=>{}});assert.match(nodeText(beatArticle(tree).props.children),/第 2 集 \/ 核实选择/);
});

test('display follows current source order after candidate append; same-span ties and stale evidence remain stable',()=>{
  const {project,unit,guide}=fixture();guide.beats.reverse();
  const overlapping={...structuredClone(guide.beats[1]),id:'beat_overlap',title:'同一段的另一个变化'};guide.beats.splice(1,0,overlapping);
  const stale={...structuredClone(guide.beats[0]),id:'beat_stale',title:'待复核的旧条目',anchors:guide.beats[0].anchors.map(anchor=>({...anchor,sourceHash:'0'.repeat(64)}))};guide.beats.unshift(stale);
  const before=structuredClone(project),tree=OutlineBeats({project,guides:[guide],unitId:unit.id,onChange:()=>{}});
  assert.deepEqual(elements(tree).filter(e=>e.type==='article').map(e=>e.props['data-outline-beat']),['beat_overlap','beat_leave','beat_return','beat_stale']);assert.deepEqual(project,before);
});

test('AI control stays unavailable when the view has no request callback',()=>{
  const {project,unit,guide,owner}=fixture(),tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:owner,onChange:()=>{}});
  assert.equal(button(beatArticle(tree),'与 AI 修改这一变化').props.disabled,true);assert.equal(getOutlineGuide(project,owner),guide);
});

test('a shared season beat exposes same-story scenes and paragraphs, but keeps another story private',()=>{
  const {project,unit,guide}=fixture('season'),second=project.units[1],foreign=newUnit('PRIVATE_STORY_TITLE',60000,'story_private');foreign.seasonId=unit.seasonId;
  second.scenes[0].title='同故事的承接场';second.structureNodes=[{id:'part_visible_second',title:'同故事的承接段'}];
  foreign.scenes[0].title='PRIVATE_SCENE_TITLE';foreign.structureNodes=[{id:'part_private',title:'PRIVATE_PARAGRAPH_TITLE'}];project.units.push(foreign);project.profile.plannedUnits=3;
  guide.nodeLinks.push({unitId:second.id,nodeId:'part_visible_second',anchor:guide.beats[0].anchors[0]},{unitId:foreign.id,nodeId:'part_private',anchor:guide.beats[0].anchors[0]});
  guide.beats[0].sceneRefs.push({unitId:second.id,sceneId:second.scenes[0].id},{unitId:foreign.id,sceneId:foreign.scenes[0].id});
  parseScriptProject(project);const before=structuredClone(project);let opened:string[]|undefined;
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,onChange:()=>{},onOpenScene:(...args)=>{opened=args;}}),article=beatArticle(tree),html=renderToStaticMarkup(tree);
  assert.doesNotMatch(html,/PRIVATE_STORY_TITLE|PRIVATE_SCENE_TITLE|PRIVATE_PARAGRAPH_TITLE/);
  assert.match(nodeText(article.props.children),/关联 2 场/);assert.match(nodeText(article.props.children),/另有当前范围外的承接安排/);assert.match(nodeText(article.props.children),/同故事的承接段/);
  button(article,'查看场景：第 2 集 · 同故事的承接场').props.onClick();assert.deepEqual(opened,[second.id,second.scenes[0].id]);assert.deepEqual(project,before,'visibility never deletes hidden references');
});

test('a read-only season beat can open its precise owner and keep this unit scene association editable',()=>{
  const {project,unit,guide,owner}=fixture('season'),updated=structuredClone(project);let opened:[OutlineOwner,string]|undefined;
  const tree=OutlineBeats({project,guides:[guide],unitId:unit.id,editableOwner:{kind:'unit',id:unit.id},onChange:fn=>fn(updated),onOpenOwner:(...args)=>{opened=args;},onRequestChange:()=>assert.fail('reading the season beat grants no story write')});
  const article=beatArticle(tree);assert.ok(!elements(article).some(e=>e.type===OutlineBeatTextEditor));assert.equal(button(article,'与 AI 修改这一变化').props.disabled,true);
  button(article,'打开季大纲').props.onClick();assert.deepEqual(opened,[owner,'beat_leave']);
  find(article,e=>e.type==='input'&&e.props.type==='checkbox').props.onChange({target:{checked:false}});
  assert.deepEqual(updated.outlineGuides![0].beats[0].sceneRefs,[]);assert.equal(updated.outlineGuides![0].beats[0].change,guide.beats[0].change);assert.equal(outlineText(updated,owner),source);
});
