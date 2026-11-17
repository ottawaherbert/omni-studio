import test from 'node:test';
import assert from 'node:assert/strict';
import {createScriptProject,newUnit} from '../packages/script/src/project';
import {parseScriptProject,type ProjectProfile} from '../packages/script/src/schema';
import {resolveScriptLocation,locationFromParams} from '../apps/web/src/features/script/scriptWorkspaceLocation';
import {scriptTaskAnchor,unreturnedPlanningUnits} from '../apps/web/src/features/script/scriptTaskIntent';
import {writingTaskShortcuts,type WritingTaskRequest} from '../apps/web/src/features/script/scriptTaskShortcuts';
import {freezeStructureScope} from '../packages/script/src/structure';
import Database from 'better-sqlite3';
import {createScriptJob,parseScriptResult,applyScriptJob} from '../packages/script/src/proposals';
const profile:ProjectProfile={organization:'episodic',continuity:'anthology',workType:'电视剧',genres:['剧情'],language:'zh-CN',plannedUnits:24,targetDurationMs:1800000,toleranceMs:15000,includeCredits:true,aspectRatio:'16:9',productionMode:'live-action'};
const fixture=()=>{const p=createScriptProject('隔离验收',profile);p.units.push(newUnit('第 2 集',profile.targetDurationMs));return parseScriptProject(p);};
test('first blueprint work opens blueprint; outline, scene plan and body advance only default location',()=>{const p=fixture();assert.equal(resolveScriptLocation(p).view,'blueprint');p.brief.outline='第一集修桥，第二集送信';assert.equal(resolveScriptLocation(p).view,'outline');p.units[1].scenes[0].purpose='送信';assert.equal(resolveScriptLocation(p).view,'board');p.units[1].scenes[0].blocks[0].text='一封信';assert.equal(resolveScriptLocation(p).view,'studio');});
test('explicit page URL preserves selected unit and valid scene; deleted IDs resolve to valid parent',()=>{const p=fixture();const remembered={view:'studio' as const,unitId:p.units[1].id,sceneId:p.units[1].scenes[0].id};const next=resolveScriptLocation(p,locationFromParams(new URLSearchParams('view=outline')),remembered);assert.equal(next.unitId,p.units[1].id);assert.equal(next.sceneId,remembered.sceneId);assert.equal(next.view,'outline');assert.equal(resolveScriptLocation(p,{unitId:p.units[1].id,sceneId:'removed'},remembered).sceneId,p.units[1].scenes[0].id);});

for(const operation of ['unit_outlines','board_plan'] as const)test(`${operation} can create and adopt a bounded candidate for an empty unit without an invented scene`,()=>{
  const p=fixture(),u=p.units[0];u.scenes=[];
  const original=JSON.stringify(p),anchor=scriptTaskAnchor(u,operation);
  assert.equal(anchor,u.id);
  const job=createScriptJob(p,{unitId:u.id,sceneId:anchor,operation,prompt:'只处理第1集',unitIndices:[1],expectedRevision:p.revision});
  assert.equal(JSON.stringify(p),original,'starting a planning job must not add a scene');
  const units=[{unitIndex:1,title:u.title,summary:'找到信件并决定送出。',...(operation==='board_plan'?{scenes:[{title:'找到信件',purpose:'人物在旧屋发现寄错的信。'}]}:{})}];
  const result=parseScriptResult(JSON.stringify({summary:'机械规划候选',units}),p,job);
  const adopted=applyScriptJob(p,{...job,status:'ready',result});
  assert.equal(adopted.units[0].summary,units[0].summary);
  assert.equal(adopted.units[0].scenes.length,operation==='board_plan'?1:0);
  assert.deepEqual(adopted.units[1],p.units[1]);
  assert.throws(()=>scriptTaskAnchor(u,'scene_turn'),/需要已有场景/);
});

test('the explicit writing task panel renders a batch request when its unit has no scenes',async()=>{
  const [{createElement},{renderToStaticMarkup},{ScriptTaskPanel}]=await Promise.all([import('react'),import('react-dom/server'),import('../apps/web/src/features/script/ScriptTaskPanel')]);
  const p=fixture(),u=p.units[0];u.scenes=[];
  const html=renderToStaticMarkup(createElement(ScriptTaskPanel,{project:p,unit:u,dirty:false,onSave:async()=>{},onApplied:()=>{},onOpenScene:()=>{},initialOperation:'unit_outlines',initialIssue:'只规划第1至3集',unitIndices:[1,2,3]}));
  assert.match(html,/只规划第1至3集/);assert.match(html,/任务与候选/);
  assert.doesNotMatch(html,/当前场：/);assert.equal(u.scenes.length,0);
});

for(const operation of ['unit_outlines','board_plan'] as const)test(`${operation} reports the requested episodes missing from a partial response`,()=>{
  const p=fixture(),u=p.units[0];
  const job=createScriptJob(p,{unitId:u.id,sceneId:u.scenes[0].id,operation,prompt:'本批只处理第1至3集',unitIndices:[1,2,3],expectedRevision:p.revision});
  const units=[{unitIndex:2,title:'第2集',summary:'送出信件。',...(operation==='board_plan'?{scenes:[{title:'送信',purpose:'人物把信送到旧址。'}]}:{})}];
  const result=parseScriptResult(JSON.stringify({summary:'模型概括不能替代批次核对',units}),p,job);
  assert.deepEqual(unreturnedPlanningUnits({...job,result}),[1,3]);
  assert.deepEqual(unreturnedPlanningUnits({...job,unitIndices:[2],result}),[]);
  assert.deepEqual(unreturnedPlanningUnits({...job,unitIndices:undefined,result}),[],'old jobs without a frozen batch must not invent an expected range');
  assert.deepEqual(unreturnedPlanningUnits(job),[],'waiting jobs do not yet have a returned batch');
});
