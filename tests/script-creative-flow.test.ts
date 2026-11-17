import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {createScriptProject,registerDialogueSpeaker} from '../packages/script/src/project';
import {createScriptCreationProfile,createScriptProjectFromMaterial} from '../packages/script/src/creation';
import {unitCharacters} from '../packages/script/src/continuity';
import {buildScriptTaskContext} from '../packages/script/src/methods';
import {exportText,createScriptDelivery} from '../packages/script/src/exporters';
import type {ScriptProject,ScriptOperation} from '../packages/script/src/schema';
import {independentStories,serialOutlines,serialScenes,microScenes,type CreativeScene} from './fixtures/script-creative-samples';
const provenance={source:'manual_external' as const,provider:'self-written-acceptance',modelId:'no-external-model'};
function open(){const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();return {db,repo};}
type Repo=ReturnType<typeof createScriptRepository>;
test('作品对话接收普通文本和 JSON 示例，不把聊天返回当作正文修改',()=>{
  const {db,repo}=open();try{
    const p=repo.saveProject(createScriptProject('对话验收',createScriptCreationProfile('short-film',1,5)),0);
    for(const raw of ['可以让女儿接过扳手。','{"blocks":[{"text":"只是聊天中的示例"}]}']){
      const job=repo.createJob(p.id,{operation:'consult',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,expectedRevision:p.revision,prompt:'回应作者的问题',authorRequest:'帮我想一句话'});
      const result=repo.submitJob(p.id,job.id,raw,provenance);
      assert.equal(result.status,'ready');assert.equal(result.result?.answer,raw);
      assert.deepEqual(repo.getProject(p.id),p);
    }
    const write=repo.createJob(p.id,{operation:'scene',unitId:p.units[0].id,sceneId:p.units[0].scenes[0].id,expectedRevision:p.revision,prompt:'写本场正文'});
    assert.equal(repo.submitJob(p.id,write.id,'这不是结构化正文返回',provenance).status,'failed');
    assert.deepEqual(repo.getProject(p.id),p);
  }finally{db.close();}
});
test('带入单场原件逐字留存，局部改写与保存不改写原件或未选段落',()=>{
  const {db,repo}=open();try{
    const raw='  内景 修车铺 - 傍晚\n\n父亲拧紧螺帽。\n\n女儿\n（低声）\n灯还亮着。\n\n';
    let project=repo.saveProject(createScriptProjectFromMaterial('原件保护',createScriptCreationProfile('short-film',1,10),{concept:'',theme:'',outline:'',sceneText:raw}),0);
    project=repo.getProject(project.id)!;
    const original=structuredClone(project);
    assert.equal(project.originalMaterial?.text,raw);
    assert.equal(repo.getProject(project.id)?.originalMaterial?.text,raw);
    const unit=project.units[0],scene=unit.scenes[0];
    const job=repo.createJob(project.id,{unitId:unit.id,sceneId:scene.id,operation:'rewrite',blockIds:[scene.blocks[1].id],expectedRevision:project.revision,prompt:'仅改这一段'});
    repo.submitJob(project.id,job.id,JSON.stringify({summary:'本地模拟返回',blocks:[{type:'action',text:'父亲松开螺帽。'}]}),provenance);
    project=repo.transition(project.id,job.id,'approve').project!;
    assert.equal(project.originalMaterial?.text,raw);
    assert.deepEqual(project.units[0].scenes[0].blocks.slice(2),original.units[0].scenes[0].blocks.slice(2));
    const overwritten=structuredClone(project);overwritten.originalMaterial!.text='错误覆盖';
    assert.throws(()=>repo.saveProject(overwritten,overwritten.revision),/输入原件不可改写/);
    assert.deepEqual(repo.getJobInput(project.id,job.id),original);
    assert.deepEqual(repo.getProject(project.id),project);
    project=repo.saveProject({...project,title:'原件保护：作者新标题'},project.revision);
    assert.deepEqual(project.units[0].scenes[0].blocks.slice(2),original.units[0].scenes[0].blocks.slice(2));
    assert.equal(project.originalMaterial?.text,raw);
    assert.doesNotMatch(JSON.stringify(buildScriptTaskContext(project,project.units[0],'scene',[],scene.id).context),/originalMaterial/);
  }finally{db.close();}
});
function propose(repo:Repo,project:ScriptProject,unitIndex:number,operation:ScriptOperation,result:unknown){
  const unit=project.units[unitIndex];const task=buildScriptTaskContext(project,unit,operation,[],unit.scenes[0].id);
  const job=repo.createJob(project.id,{unitId:unit.id,sceneId:unit.scenes[0].id,operation,expectedRevision:project.revision,prompt:JSON.stringify(task)});
  assert.equal(repo.submitJob(project.id,job.id,JSON.stringify(result),provenance).status,'ready');
  return repo.transition(project.id,job.id,'approve').project!;
}
function artifact(name:string,project:ScriptProject,notes:unknown){
  const folder=process.env.SCRIPT_CREATIVE_ARTIFACTS;if(!folder)return;
  mkdirSync(folder,{recursive:true});
  for(const format of ['markdown','fountain'] as const)writeFileSync(resolve(folder,`${name}.${format==='markdown'?'md':'fountain'}`),exportText(project,format));
  writeFileSync(resolve(folder,`${name}.json`),JSON.stringify({project,notes},null,2));
}
