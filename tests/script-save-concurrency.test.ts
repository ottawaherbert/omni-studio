import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScriptRepository, ScriptConflictError } from '../apps/api/src/repositories/scriptStore';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

type Contention='IDLE_WRITER'|'COMMITTED_WRITER';
const authorHistoryCount=(db:InstanceType<typeof Database>)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='script_revisions'").get()?(db.prepare('SELECT count(*) AS n FROM script_revisions').get() as {n:number}).n:0;
const projectInputCount=(db:InstanceType<typeof Database>)=>(db.prepare('SELECT count(*) AS n FROM script_project_inputs').get() as {n:number}).n;
function harness(directory:string,name:string,contention:Contention,writePrefixes=['INSERT INTO script_projects','UPDATE script_projects']){
  let contender:InstanceType<typeof Database>|undefined,armed=false,interleaved=false,contenderResult='';
  // The trace hook runs after the operation's SELECT has established its read
  // snapshot, immediately before its first write. Both locks and writes are
  // real SQLite operations on separate connections, with no timing sleeps.
  const db=new Database(join(directory,`${name}.sqlite`),{verbose(sql){
    if(!armed||interleaved||!writePrefixes.some(prefix=>sql.startsWith(prefix)))return;
    interleaved=true;
    try{
      if(contention==='IDLE_WRITER'){contender!.exec('BEGIN IMMEDIATE');contenderResult='HELD_WITHOUT_WRITES';}
      else {contender!.prepare('UPDATE unrelated_activity SET counter=counter+1').run();contenderResult='COMMITTED';}
    }catch(error){contenderResult=(error as {code:string}).code;}
  }});
  db.pragma('journal_mode = WAL');db.pragma('busy_timeout = 5000');
  const repository=createScriptRepository(db);repository.ensureSchema();
  db.exec('CREATE TABLE unrelated_activity(counter INTEGER NOT NULL); INSERT INTO unrelated_activity VALUES(0)');
  contender=new Database(db.name,{timeout:1});
  return {db,repository,contender,
    arm(){armed=true;},
    result(){return {interleaved,contenderResult};},
    close(){if(contender!.inTransaction)contender!.exec('ROLLBACK');contender!.close();db.close();}};
}

for(const contention of ['IDLE_WRITER','COMMITTED_WRITER'] as const)test(`script save acquires its WAL write lock before reading: ${contention}`,t=>{
  const directory=mkdtempSync(join(tmpdir(),'script-save-concurrency-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const document=createScriptProject('隔离并发保存',createScriptCreationProfile('short-film',1,5));

  const before=harness(directory,'deferred-baseline',contention);
  try{
    before.arm();
    // Recreate the previous top-level deferred policy. SQLite uses a savepoint
    // for the nested repository transaction, so it cannot upgrade this outer
    // transaction to IMMEDIATE before the first read.
    const legacySave=before.db.transaction(()=>before.repository.saveProject(document,0));
    assert.throws(()=>legacySave.deferred(),{code:contention==='IDLE_WRITER'?'SQLITE_BUSY':'SQLITE_BUSY_SNAPSHOT'});
    assert.deepEqual(before.result(),{interleaved:true,contenderResult:contention==='IDLE_WRITER'?'HELD_WITHOUT_WRITES':'COMMITTED'});
    assert.equal(before.repository.getProject(document.id),null);
    assert.equal(authorHistoryCount(before.db),0);
    assert.equal(projectInputCount(before.db),0);
  }finally{before.close();}

  const after=harness(directory,'immediate-save',contention);
  try{
    after.arm();
    const saved=after.repository.saveProject(document,0);
    assert.deepEqual(after.result(),{interleaved:true,contenderResult:'SQLITE_BUSY'});
    assert.equal(saved.revision,1);
    assert.deepEqual(after.repository.getProject(saved.id),saved);
    assert.equal(authorHistoryCount(after.db),0);
    assert.equal(projectInputCount(after.db),0);
    // The acquired lock protects the read/compare/write sequence, without
    // weakening the author's stamp comparison or creating author history.
    assert.throws(()=>after.repository.saveProject({...document,title:'过期创建'},0),ScriptConflictError);
    const updated=after.repository.saveProject({...saved,title:'有效更新'},1);
    assert.equal(updated.revision,2);
    assert.throws(()=>after.repository.saveProject({...saved,title:'过期覆盖'},1),ScriptConflictError);
    assert.deepEqual(after.repository.getProject(updated.id),updated);
    assert.equal(after.repository.readProjectInput(updated.id,1),null);
    assert.equal(authorHistoryCount(after.db),0);
    assert.equal(projectInputCount(after.db),0);
    const persisted=after.contender.prepare('SELECT revision,data FROM script_projects WHERE id=?').get(updated.id) as {revision:number;data:string};
    assert.equal(persisted.revision,2);assert.deepEqual(JSON.parse(persisted.data),updated);
  }finally{after.close();}
});

test('creating a job locks before reading and freezes its input under WAL contention',t=>{
  const directory=mkdtempSync(join(tmpdir(),'script-job-input-concurrency-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const fixture=harness(directory,'job-input','COMMITTED_WRITER',['INSERT OR IGNORE INTO script_job_inputs']);
  try{
    const project=fixture.repository.saveProject(createScriptProject('固定任务输入',createScriptCreationProfile('short-film',1,5)),0);
    fixture.arm();
    const job=fixture.repository.createJob(project.id,{operation:'unit_outline',unitId:project.units[0].id,sceneId:project.units[0].id,
      prompt:'补充本集大纲',expectedRevision:project.revision});
    assert.deepEqual(fixture.result(),{interleaved:true,contenderResult:'SQLITE_BUSY'});
    assert.equal(job.baseRevision,project.revision);
    assert.deepEqual(fixture.repository.getJob(project.id,job.id),job);
    assert.deepEqual(fixture.repository.getJobInput(project.id,job.id),project);
    assert.deepEqual(fixture.repository.getProject(project.id),project);
    assert.equal((fixture.db.prepare('SELECT count(*) AS n FROM script_jobs').get() as {n:number}).n,1);
    assert.equal((fixture.db.prepare('SELECT count(*) AS n FROM script_job_inputs').get() as {n:number}).n,1);
    assert.equal(projectInputCount(fixture.db),1);
    assert.equal(authorHistoryCount(fixture.db),0);
    assert.equal((fixture.contender.prepare('SELECT counter FROM unrelated_activity').get() as {counter:number}).counter,0);
  }finally{fixture.close();}
});

const provenance={source:'manual_external' as const,provider:'self_written',modelId:'mechanical-fixture'};
function readyOutline(repository:ReturnType<typeof createScriptRepository>,project:ReturnType<typeof createScriptProject>){
  const job=repository.createJob(project.id,{operation:'unit_outline',unitId:project.units[0].id,sceneId:project.units[0].id,
    prompt:'只更新本集大纲',expectedRevision:project.revision});
  assert.equal(repository.submitJob(project.id,job.id,JSON.stringify({summary:'本集大纲',outline:'主人公找到钥匙后离开。'}),provenance).status,'ready');
  return job;
}
function adoption(repository:ReturnType<typeof createScriptRepository>,flow:'CANDIDATE'|'PUBLICATION'){
  const published=repository.saveProject(createScriptProject('隔离采用',createScriptCreationProfile('short-film',1,5)),0);
  if(flow==='CANDIDATE'){
    const job=readyOutline(repository,published);
    return {published,before:'ready',after:'approved',state:()=>repository.getJob(published.id,job.id).status,
      input:()=>repository.getJobInput(published.id,job.id),apply:()=>repository.transition(published.id,job.id,'approve').project!};
  }
  let run=repository.createAgentRun(published.id,{unitId:published.units[0].id,goal:'为当前单元准备一场',strategy:'plan_only',maxScenes:1,workspace:'draft'});
  run=repository.transitionAgentRun(published.id,run.id,{action:'resume',expectedVersion:run.version});
  const job=repository.createJob(published.id,{operation:'plan',unitId:run.unitId,sceneId:published.units[0].scenes[0].id,
    prompt:'规划一场取钥匙的行动',expectedRevision:published.revision,agentRunId:run.id});
  run=repository.transitionAgentRun(published.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
  assert.equal(repository.submitJob(published.id,job.id,JSON.stringify({summary:'一场',scenePlans:[{title:'房间',purpose:'找到钥匙后离开。'}]}),provenance).status,'ready');
  repository.transition(published.id,job.id,'approve');
  run=repository.transitionAgentRun(published.id,run.id,{action:'advance',expectedVersion:run.version});
  assert.equal(run.status,'complete');
  assert.throws(()=>repository.publishAgentRun(published.id,run.id,run.version-1,published.revision),ScriptConflictError);
  assert.throws(()=>repository.publishAgentRun(published.id,run.id,run.version,published.revision+1),ScriptConflictError);
  return {published,before:'draft',after:'published',state:()=>repository.getAgentRun(published.id,run.id).publicationStatus,
    input:()=>repository.getAgentRunInput(published.id,run.id),apply:()=>{const result=repository.publishAgentRun(published.id,run.id,run.version,published.revision);run=result.run;return result.project;}};
}

for(const flow of ['CANDIDATE','PUBLICATION'] as const)for(const contention of ['IDLE_WRITER','COMMITTED_WRITER'] as const)
test(`outer ${flow} adoption locks before reads and commits current project/status together: ${contention}`,t=>{
  const directory=mkdtempSync(join(tmpdir(),'script-adopt-concurrency-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const before=harness(directory,'deferred-baseline',contention);
  try{
    const pending=adoption(before.repository,flow);before.arm();
    assert.throws(()=>before.db.transaction(pending.apply).deferred(),{code:contention==='IDLE_WRITER'?'SQLITE_BUSY':'SQLITE_BUSY_SNAPSHOT'});
    assert.equal(before.result().interleaved,true);assert.equal(pending.state(),pending.before);
    assert.deepEqual(before.repository.getProject(pending.published.id),pending.published);
    assert.deepEqual(pending.input(),pending.published);
    assert.equal(authorHistoryCount(before.db),0);
  }finally{before.close();}
  const after=harness(directory,'immediate-adoption',contention);
  try{
    const pending=adoption(after.repository,flow);after.arm();
    const adopted=pending.apply();
    assert.deepEqual(after.result(),{interleaved:true,contenderResult:'SQLITE_BUSY'});
    assert.equal(pending.state(),pending.after);assert.equal(adopted.revision,2);
    assert.deepEqual(after.repository.getProject(adopted.id),adopted);
    assert.deepEqual(pending.input(),pending.published);
    assert.deepEqual(pending.apply(),adopted);
    assert.equal(authorHistoryCount(after.db),0);
    // An ordinary candidate made before an author save still conflicts; the
    // immediate transaction must not silently adopt it onto a newer draft.
    const stale=readyOutline(after.repository,adopted);
    const authored=after.repository.saveProject({...adopted,title:'作者随后修改'},2);
    assert.throws(()=>after.repository.transition(authored.id,stale.id,'approve'),/基线|新版本|改变/);
    assert.equal(after.repository.getJob(authored.id,stale.id).status,'ready');
    assert.deepEqual(after.repository.getProject(authored.id),authored);
    assert.deepEqual(pending.apply(),authored);
    assert.deepEqual(after.repository.getProject(authored.id),authored);
    assert.equal(authorHistoryCount(after.db),0);
  }finally{after.close();}
});
