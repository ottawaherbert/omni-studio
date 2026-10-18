import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createScriptRepository } from '../apps/api/src/repositories/scriptStore';
import { registerScriptRoutes } from '../apps/api/src/routes/scriptRoutes';
import { createScriptProject, unitContentHash } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { selectSharedMethods, buildScriptTaskContext } from '../packages/script/src/methods';
import type { SkillDTO } from '../packages/domain/src/skill';

const skill:SkillDTO={id:'dialogue',title:'对白方法',content:'用动作表达潜台词。',revision:1,createdAt:1,updatedAt:1,source:'manual'};

test('共享 Skill 接受两种入口标识，拒绝重复或已删除的选择',()=>{
  assert.deepEqual(selectSharedMethods([skill],['dialogue']),selectSharedMethods([skill],['skill:dialogue']));
  assert.throws(()=>selectSharedMethods([skill],['dialogue','skill:dialogue']),/重复/);
  assert.throws(()=>selectSharedMethods([],['dialogue']),/已删除/);
  assert.deepEqual(selectSharedMethods([],[]),[]);
});

test('共享 Skill HTTP：无需作品绑定、版本变化拒绝旧提示词、采用基线不变、历史 Agent 保持快照',async t=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  let catalog=[structuredClone(skill)];
  const app=express();app.use(express.json());registerScriptRoutes(app,repo,async ids=>selectSharedMethods(catalog,ids));
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();});
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/scripts`;
  const post=async(path:string,body:unknown)=>{const response=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,...await response.json()};};
  const project=repo.saveProject(createScriptProject('共享技能验收',createScriptCreationProfile('short-film',1,5)),0);
  const unit=project.units[0],scene=unit.scenes[0],methods=selectSharedMethods(catalog,['dialogue']);
  assert.deepEqual(project.methods,[]);
  const task=buildScriptTaskContext({...project,methods},unit,'theme',['skill:dialogue'],scene.id);
  assert.match(task.instructions,/用动作表达潜台词/);
  const input={operation:'theme',unitId:unit.id,sceneId:scene.id,expectedRevision:project.revision,prompt:task.instructions,methodIds:['skill:dialogue'],methodVersions:{'skill:dialogue':'1'}};
  const created=await post(`/${project.id}/jobs`,{...input,methods:[{...methods[0],content:'伪造内容'}]});
  assert.equal(created.status,201);assert.equal(created.job.methods[0].content,skill.content);
  assert.equal(created.job.inputHash,unitContentHash(project,unit));
  assert.deepEqual(repo.getProject(project.id)?.methods,[]);

  catalog=[{...skill,revision:2,content:'更新后的方法'}];
  assert.equal((await post(`/${project.id}/jobs`,input)).status,409);
  const updated=await post(`/${project.id}/jobs`,{...input,methodVersions:{'skill:dialogue':'2'},prompt:'更新后的方法'});
  assert.equal(updated.status,201);assert.equal(updated.job.methods[0].version,'2');
  assert.equal(repo.getJob(project.id,created.job.id).methods[0].version,'1');

  const returned=await post(`/${project.id}/jobs/${created.job.id}/result`,{rawResult:JSON.stringify({summary:'建议',suggestions:[{title:'主题',content:'人物通过行动承担选择的后果。'}]}),provenance:{source:'manual_external',provider:'test',modelId:'fixture'}});
  assert.equal(returned.job.status,'ready');
  const adopted=await post(`/${project.id}/jobs/${created.job.id}/approve`,{choiceIndex:0});
  assert.equal(adopted.status,200);assert.equal(repo.getProject(project.id)?.brief.theme,'人物通过行动承担选择的后果。');
  assert.deepEqual(repo.getProject(project.id)?.methods,[]);

  const started=await post(`/${project.id}/agent-runs`,{unitId:unit.id,goal:'只补一场',strategy:'plan_only',maxScenes:1,methodIds:['dialogue'],methodVersions:{dialogue:'2'},workspace:'draft',executionMode:'manual'});
  assert.equal(started.status,201);assert.equal(started.run.methods[0].version,'2');
  catalog=[];
  assert.equal((await post(`/${project.id}/jobs`,{...input,expectedRevision:repo.getProject(project.id)!.revision})).status,409);
  const resumed=await post(`/${project.id}/agent-runs/${started.run.id}/transition`,{action:'resume',expectedVersion:started.run.version});
  assert.equal(resumed.status,200);
  const frozenStep=await post(`/${project.id}/agent-runs/${started.run.id}/steps`,{expectedVersion:resumed.run.version,job:{operation:'plan',unitId:unit.id,sceneId:scene.id,expectedRevision:repo.getProject(project.id)!.revision,prompt:'使用已保存的方法',methodIds:['skill:dialogue']}});
  assert.equal(frozenStep.status,201);assert.equal(frozenStep.job.methods[0].content,'更新后的方法');
  assert.deepEqual(repo.getProject(project.id)?.methods,[]);
});
