import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAgentMethods, mergeAgentMethodTrace, AGENT_METHOD_OPERATIONS } from '../packages/script/src/agentMethods';
import { compileContext } from '../packages/agent-context/src';
import { createScriptProject, newUnit } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import type { MethodBinding } from '../packages/script/src/schema';
const project=()=>{const p=createScriptProject('【机械配置验证】',createScriptCreationProfile('tv-series',2,20));p.units.push(newUnit('【未选单元】',1200000,p.id));return p;};
const method=(inputs:Array<'structure'|'continuity'>,operations:any[]=['review']):MethodBinding=>({id:'method-test',title:'机械方法',version:'7',content:'【全文开始】不可省略的中段。【全文结尾】',usage:{operations,inputs,note:'【实际使用说明】'}});
function compile(prepared:ReturnType<typeof prepareAgentMethods>){return compileContext({systemInstruction:'机械验证',skills:prepared.skills,sections:prepared.auxiliaryContext?[{id:'auxiliary',text:JSON.stringify(prepared.auxiliaryContext),required:true,priority:1,dependencies:[]}]:[]});}
test('all Agent operations preserve existing author-configured Skill operation semantics',()=>{
 assert.deepEqual(AGENT_METHOD_OPERATIONS,{scene_order:'plan',outline_development:'outline',concept:'concept',theme:'theme',audienceExperience:'concept',constraints:'concept',update_character:'character',update_fact:'fact',project_outline:'outline',unit_outline:'unit_outline',add_unit:'unit_outlines',plan_scenes:'plan',scene_plan:'plan',scene_body:'scene',replace_blocks:'rewrite',replace_selection:'text_rewrite',add_character:'character',add_fact:'fact',review:'review',story_outline:'story_outline',season_outline:'season_outline',plan_structure:'plan',append_scene_body:'scene'});
 const p=project(),prepared=prepareAgentMethods({project:p,methods:[method(['structure'],['scene'])],operation:'review',targetUnitIds:[p.units[1].id]}),bundle=compile(prepared);
 assert.equal(prepared.skills.length,0);assert.equal(prepared.auxiliaryContext,null);assert.doesNotMatch(bundle.prompt,/全文|实际使用说明/);
 assert.equal(mergeAgentMethodTrace(prepared,bundle.skillTrace)[0].reason,'SKIPPED_OPERATION');
});
test('applicable full Skill, configuration and selected structural records are actually sent',()=>{
 const p=project();p.units[1].scopeId=p.units[1].id;p.storylines=[{id:'line-selected',scopeId:p.units[1].id,lane:'A',title:'【所选真实结构】',premise:'【结构前提】',resolution:'【未来计划不是真实事件】'},{id:'line-unselected',scopeId:p.units[0].id,lane:'B',title:'【不可读取结构】',premise:'',resolution:''}];
 const prepared=prepareAgentMethods({project:p,methods:[method(['structure'])],operation:'review',targetUnitIds:[p.units[1].id]}),bundle=compile(prepared);
 assert.match(bundle.prompt,/全文开始.*全文结尾/);assert.match(bundle.prompt,/实际使用说明/);assert.match(bundle.prompt,/所选真实结构/);assert.doesNotMatch(bundle.prompt,/不可读取结构/);
 assert.match(bundle.prompt,/AUXILIARY_PLANNING_NOT_MANUSCRIPT/);assert.equal(mergeAgentMethodTrace(prepared,bundle.skillTrace)[0].status,'APPLIED');
});
test('continuity inputs are real computed records; unselected evidence is redacted with uncertainty',()=>{
 const p=project(),unit=p.units[1];unit.scopeId=unit.id;unit.scenes[0].storyOrder=2;
 p.continuityTracks=[{id:'track',scopeId:unit.id,kind:'prop',perspective:'character',label:'【真实连续性记录】',characterIds:[],initialValue:'【初始辅助状态】',changes:[{id:'outside-change',sceneId:p.units[0].scenes[0].id,value:'【未选场景秘密值】',reason:'【未选场景秘密原因】',sourceHash:'unselected-hash'}]}];
 const prepared=prepareAgentMethods({project:p,methods:[method(['continuity'])],operation:'review',targetUnitIds:[unit.id]}),bundle=compile(prepared);
 assert.match(bundle.prompt,/真实连续性记录/);assert.match(bundle.prompt,/statesByScene/);assert.match(bundle.prompt,/needs_review/);assert.doesNotMatch(bundle.prompt,/未选场景秘密值|未选场景秘密原因/);
 assert.doesNotMatch(bundle.prompt,/'seasons'|'storylines'/);
});
test('continuity Skill cannot enlarge a selected block or text rewrite into whole-scene raw',()=>{
 const p=project(),unit=p.units[0],scene=unit.scenes[0];
 scene.blocks[0].text='SELECTED_METHOD_BLOCK';scene.blocks.push({id:'outside_method_block',type:'action',text:'OUTSIDE_METHOD_BLOCK_SENTINEL'});
 p.continuityTracks=[{id:'method-track',scopeId:unit.scopeId,kind:'prop',perspective:'audience',label:'机械道具记录',characterIds:[],initialValue:'起点',
   changes:[{id:'method-change',sceneId:scene.id,value:'状态',reason:'作者记录',sourceHash:'hash'}]}];
 const selected=prepareAgentMethods({project:p,methods:[method(['continuity'],['rewrite'])],operation:'replace_blocks',
   targetUnitIds:[unit.id],targetSceneId:scene.id,readBlockIds:[scene.blocks[0].id]});
 assert.match(compile(selected).prompt,/SELECTED_METHOD_BLOCK/);
 assert.doesNotMatch(compile(selected).prompt,/OUTSIDE_METHOD_BLOCK_SENTINEL/);
 const text=prepareAgentMethods({project:p,methods:[method(['continuity'],['text_rewrite'])],operation:'replace_selection',
   targetUnitIds:[unit.id],targetSceneId:scene.id});
 assert.doesNotMatch(compile(text).prompt,/SELECTED_METHOD_BLOCK|OUTSIDE_METHOD_BLOCK_SENTINEL/);
 const whole=prepareAgentMethods({project:p,methods:[method(['continuity'],['scene'])],operation:'scene_body',
   targetUnitIds:[unit.id],targetSceneId:scene.id});
 assert.match(compile(whole).prompt,/OUTSIDE_METHOD_BLOCK_SENTINEL/);
});
test('empty targets never default to first unit; unknown targets reject instead of substituting',()=>{
 const p=project();p.units[0].scenes[0].purpose='【第一集不该注入】';const prepared=prepareAgentMethods({project:p,methods:[method(['structure','continuity'])],operation:'review',targetUnitIds:[]}),bundle=compile(prepared);
 assert.match(bundle.prompt,/没有已存在的目标单元/);assert.doesNotMatch(bundle.prompt,/第一集不该注入/);
 assert.throws(()=>prepareAgentMethods({project:p,methods:[method([])],operation:'review',targetUnitIds:['missing']}),/明确存在/);
});
test('no Skill completes without auxiliary injection; trace keeps original selection order',()=>{
 const p=project(),empty=prepareAgentMethods({project:p,methods:[],operation:'review',targetUnitIds:[p.units[0].id]});assert.deepEqual(empty.skills,[]);assert.equal(empty.auxiliaryContext,null);assert.deepEqual(mergeAgentMethodTrace(empty,compile(empty).skillTrace),[]);
 const prepared=prepareAgentMethods({project:p,methods:[method([],['scene']),{...method([]),id:'applied'}],operation:'review',targetUnitIds:[p.units[0].id]}),bundle=compile(prepared);
 assert.deepEqual(mergeAgentMethodTrace(prepared,bundle.skillTrace).map(t=>[t.id,t.status]),[['method-test','SKIPPED'],['applied','APPLIED']]);
});
