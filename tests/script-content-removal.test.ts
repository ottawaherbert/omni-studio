import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {createScriptRepository} from '../apps/api/src/repositories/scriptStore';
import {createScriptProject,createMockProposal} from '../packages/script/src/project';
import {createScriptCreationProfile} from '../packages/script/src/creation';
import {parseScriptProject,SCRIPT_OPERATIONS} from '../packages/script/src/schema';
import {buildScriptTaskContext} from '../packages/script/src/methods';
import {exportText,createScriptDelivery} from '../packages/script/src/exporters';
import {blocksToScreenplayText,screenplayTextToBlocks} from '../packages/script/src/fountainAdapter';
import {createInteractiveWritingPort} from '../src/server/interactiveWritingPort';

const provenance={source:'manual_external' as const,provider:'local-fixture',modelId:'no-external-model'};
function oldProject(contentKind:string){
  const project=createScriptProject('旧作品继续写作',createScriptCreationProfile('short-film',1,5));
  // Deliberately preserve obsolete, even incomplete metadata from existing v1 files.
  Object.assign(project.profile,{contentKind});
  Object.assign(project,{sources:[{id:'old-source',scopeId:'retired-scope',excerpt:'历史资料原件'}]});
  project.facts=[{id:'fact-1',scopeId:project.id,text:'修伞台在门口',status:'approved'}];
  Object.assign(project.facts[0],{evidence:{kind:'quote',sourceIds:['old-source']}});
  project.units[0].scenes[0].blocks[0].text='老人收起伞。';
  Object.assign(project.units[0].scenes[0].blocks[0],{evidence:{kind:'quote',sourceIds:['old-source'],confirmedHash:'old-confirmation'}});
  return project;
}

test('移除内容分类：新作品无分类；旧字段原样保存，但所有新任务上下文均不携带',()=>{
  const fresh=createScriptProject('新作',createScriptCreationProfile('short-film',1,5));
  assert.equal(Object.hasOwn(fresh.profile,'contentKind'),false);
  for(const kind of ['fiction','nonfiction','hybrid']){
    const project=oldProject(kind),unit=project.units[0];
    assert.deepEqual(parseScriptProject(project),project);
    assert.doesNotThrow(()=>createMockProposal(project,unit.id,unit.scenes[0].id));
    for(const operation of SCRIPT_OPERATIONS){
      const context=buildScriptTaskContext(project,unit,operation,[],unit.scenes[0].id).context;
      assert.doesNotMatch(JSON.stringify(context),/contentKind|documentaryPolicy|old-source|old-confirmation|"evidence"/);
      assert.equal(context.facts[0].status,'approved');
    }
  }
});

test('移除内容分类：旧作品无需资料校验即可选段改写和保存；未选正文保留',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    let project=repo.saveProject(oldProject('nonfiction'),0);
    const original=structuredClone(project),unit=project.units[0],scene=unit.scenes[0];
    const text=blocksToScreenplayText(scene.blocks);
    const job=repo.createJob(project.id,{operation:'text_rewrite',unitId:unit.id,sceneId:scene.id,prompt:'只替换动作',expectedRevision:project.revision,selection:{start:2,end:4,text:text.slice(2,4)}});
    assert.equal(repo.submitJob(project.id,job.id,JSON.stringify({summary:'改动动作',replacement:'撑开'}),provenance).status,'ready');
    project=repo.transition(project.id,job.id,'approve').project!;
    assert.equal(project.units[0].scenes[0].blocks[0].text,'老人撑开伞。');
    assert.deepEqual(repo.getJobInput(project.id,job.id),original);
    assert.deepEqual(JSON.parse(JSON.stringify(project)).sources,JSON.parse(JSON.stringify(original)).sources);
    assert.deepEqual(JSON.parse(JSON.stringify(project)).units[0].scenes[0].blocks[0].evidence,JSON.parse(JSON.stringify(original)).units[0].scenes[0].blocks[0].evidence);
    const reparsed=screenplayTextToBlocks('老人重新撑开伞。',[],project.units[0].scenes[0].blocks);
    assert.equal(JSON.parse(JSON.stringify(reparsed.blocks[0])).evidence.confirmedHash,'old-confirmation');
    assert.deepEqual(repo.getProject(project.id),project);
    assert.equal('restoreProject' in repo,false);
  }finally{db.close();}
});

test('移除内容分类：逐步与 Agent 共用普通正文合同，退休字段不能成为新提案',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const draft=oldProject('hybrid');draft.units[0].scenes[0].blocks=[{id:'blank',type:'action',text:''}];
    const project=repo.saveProject(draft,0),unit=project.units[0];
    const standalone=repo.createJob(project.id,{operation:'scene',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:'本场正文',expectedRevision:project.revision});
    const bad=JSON.stringify({summary:'旧合同返回',blocks:[{type:'action',text:'门被推开。',evidence:{kind:'quote',sourceIds:[]}}]});
    const failed=repo.submitJob(project.id,standalone.id,bad,provenance);
    assert.equal(failed.status,'failed');assert.equal(failed.rawResult,bad);
    let run=repo.createAgentRun(project.id,{unitId:unit.id,goal:'写本场',strategy:'write_existing',maxScenes:1,executionMode:'manual'});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:'写本场，不需要资料认证',expectedRevision:project.revision});
    const returned=repo.submitJob(project.id,step.job.id,JSON.stringify({summary:'完整本场',blocks:[{type:'action',text:'老人撑开伞，雨水沿伞沿落下。'}]}),provenance);
    assert.equal(returned.status,'ready');repo.transition(project.id,step.job.id,'approve');
    assert.equal(repo.getAgentDraft(project.id,run.id).units[0].scenes[0].blocks[0].text,'老人撑开伞，雨水沿伞沿落下。');
    assert.deepEqual(repo.getProject(project.id),project);
  }finally{db.close();}
});

test('移除内容分类：连读、文本导出与下游交付不再生成分类附注，存档仍保留',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const project=repo.saveProject(oldProject('nonfiction'),0);
    for(const format of ['markdown','fountain'] as const){
      const text=exportText(project,format);assert.match(text,/老人收起伞/);
      assert.doesNotMatch(text,/待作者核对|原话|资料来源|old-source/);
    }
    const delivery=createScriptDelivery(project);
    assert.doesNotMatch(JSON.stringify(delivery),/contentKind|"sources"|"evidence"/);
    repo.captureProjectInput(project);
    const port=createInteractiveWritingPort(repo),reference=port.listScenes(project.id)[0];
    assert.deepEqual(port.resolveScene(reference.ref),reference);
    assert.doesNotMatch(JSON.stringify(reference),/contentKind|"sources"|"evidence"/);
    const oldScene=structuredClone(delivery.units[0].scenes![0]);
    Object.assign(oldScene.blocks[0],{evidence:JSON.parse(JSON.stringify(project)).units[0].scenes[0].blocks[0].evidence});
    const oldRef={...reference.ref,checksum:createHash('sha256').update(JSON.stringify({s:oldScene,revision:project.revision})).digest('hex')};
    assert.deepEqual(port.resolveScene(oldRef),{...reference,ref:oldRef});
    assert.equal(port.resolveScene({...oldRef,checksum:'invalid'}),null);
    repo.saveProject({...project,title:'作者随后修改标题'},project.revision);
    assert.match(JSON.stringify(repo.readProjectInput(project.id,project.revision)),/old-source/);
    assert.deepEqual(port.resolveScene(reference.ref),reference);
  }finally{db.close();}
});
