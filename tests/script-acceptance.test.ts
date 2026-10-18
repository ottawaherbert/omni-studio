import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createScriptRepository, ScriptConflictError } from '../apps/api/src/repositories/scriptStore';
import { scriptClient } from '../apps/web/src/clients/scriptClient';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { createScriptProject } from '../packages/script/src/project';
import { applyScenePlans, sceneHasAuthorWork } from '../packages/script/src/planning';
import { mergeAgentDraft } from '../packages/script/src/agentMerge';
import { buildScriptTaskContext } from '../packages/script/src/methods';

const source={source:'manual_external' as const,provider:'acceptance',modelId:'self-written'};
const authorHistoryCount=(db:InstanceType<typeof Database>)=>db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='script_revisions'").get()?(db.prepare('SELECT count(*) AS n FROM script_revisions').get() as {n:number}).n:0;
const body=JSON.stringify({summary:'用动作表现守候，不添加反转',blocks:[{type:'action',text:'林夏把第二只碗放回碗柜，留着灶上的火。'}]});
function setup(){
  const db=new Database(':memory:');
  const repo=createScriptRepository(db);repo.ensureSchema();
  const project=repo.saveProject(createScriptProject('留一盏灯',createScriptCreationProfile('short-film',1,5)),0);
  return {db,repo,project};
}
test('验收：请求期间暂停，迟到结果保存为提案；重建仓储后不重跑、不重复采用',()=>{
  const {db,project,repo}=setup();
  try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'写一场克制的等待',strategy:'write_existing',maxScenes:1});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const job=repo.createJob(project.id,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'写等待的动作',expectedRevision:project.revision,agentRunId:run.id});
    run=repo.transitionAgentRun(project.id,run.id,{action:'attach',expectedVersion:run.version,jobId:job.id});
    run=repo.transitionAgentRun(project.id,run.id,{action:'pause',expectedVersion:run.version});
    assert.equal(repo.submitJob(project.id,job.id,body,source).status,'ready');
    assert.throws(()=>repo.transition(project.id,job.id,'approve'),/未在运行/);
    assert.equal(repo.getAgentDraft(project.id,run.id).revision,project.revision);
    const reopened=createScriptRepository(db);reopened.ensureSchema();
    assert.equal(reopened.getJob(project.id,job.id).rawResult,body);
    run=reopened.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const adopted=reopened.transition(project.id,job.id,'approve');
    assert.equal(reopened.transition(project.id,job.id,'approve').project!.revision,adopted.project!.revision);
    run=reopened.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.deepEqual(run.completedJobIds,[job.id]);
  }finally{db.close();}
});
for(const legacyTable of ['absent','empty'] as const)test(`验收：升级前 Agent 首次采用仍保留应用前输入（旧草稿表 ${legacyTable}）`,()=>{
  const {db,project,repo}=setup();
  try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'保存旧任务的输入',strategy:'write_existing',maxScenes:1});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'写等待的动作',expectedRevision:project.revision});
    const input=repo.getAgentDraft(project.id,run.id);
    // Before explicit job inputs, a Run's initial draft had no history row.
    // Do not read/pin the input before approval: upgrading alone must suffice.
    db.prepare('DELETE FROM script_job_inputs WHERE job_id=?').run(step.job.id);
    if(legacyTable==='empty')db.exec('CREATE TABLE script_agent_draft_revisions(run_id TEXT NOT NULL,project_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,revision))');
    const reopened=createScriptRepository(db);reopened.ensureSchema();
    reopened.submitJob(project.id,step.job.id,body,source);
    const adopted=reopened.transition(project.id,step.job.id,'approve').project!;
    assert.equal(adopted.revision,input.revision+1);
    assert.notDeepEqual(adopted.units[0].scenes[0].blocks,input.units[0].scenes[0].blocks);
    assert.deepEqual(reopened.getJobInput(project.id,step.job.id),input);
    assert.deepEqual(reopened.getProject(project.id),project);
    const retired=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='script_agent_draft_revisions'").get();
    assert.equal(Boolean(retired),legacyTable==='empty');
    if(retired)assert.equal((db.prepare('SELECT count(*) AS n FROM script_agent_draft_revisions').get() as {n:number}).n,0);
  }finally{db.close();}
});
test('验收：仅填写故事时间、人物或时长的卡片也属于作者稿，重新拆场必须保留',()=>{
  for(const field of ['storyTime','characterIds','targetDurationMs','storyOrder','storylineIds'] as const){
    const project=createScriptProject('空卡不是空稿',createScriptCreationProfile('short-film',1,5));
    const scene=project.units[0].scenes[0];
    Object.assign(scene,{[field]:field==='storyTime'?'三年前':field==='characterIds'?['character']:field==='storylineIds'?['line']:1});
    assert.equal(sceneHasAuthorWork(scene),true,field);
    applyScenePlans(project,[{scenes:[{title:'新场',purpose:'模型提出的新场'}]}]);
    assert.equal(project.units[0].scenes[0].id,scene.id,field);
  }
});
test('验收：客户端删除实际使用 DELETE，读取接口使用 GET',async()=>{
  const fetchBefore=globalThis.fetch;
  const methods:string[]=[];
  globalThis.fetch=async(_input,init)=>{
    methods.push(init?.method||'GET');
    return new Response(JSON.stringify({success:true,projects:[]}),{status:200});
  };
  try{await scriptClient.deleteProject('only-test');await scriptClient.listProjects();assert.deepEqual(methods,['DELETE','GET']);}
  finally{globalThis.fetch=fetchBefore;}
});
test('验收：Agent 不能在作者保存新稿后继续用旧上下文创建下一步',()=>{
  const {db,project,repo}=setup();
  try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'承接作者已写的内容',strategy:'write_existing',maxScenes:1});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    project.units[0].scenes[0].blocks[0].text='作者已经写了这一场。';repo.saveProject(project,project.revision);
    assert.throws(()=>repo.createJob(project.id,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'不应再写旧空稿',expectedRevision:project.revision,agentRunId:run.id}),/同步/);
  }finally{db.close();}
});
test('验收：逐步分场后 Agent 写作，作者接管两场，同步后只写余场且读取最新作者正文',()=>{
  const {db,repo,project}=setup();
  try{
    const plan=repo.createJob(project.id,{operation:'plan',unitId:project.units[0].id,sceneId:project.units[0].scenes[0].id,prompt:'拆成三场日常动作，不强制反转',expectedRevision:project.revision});
    repo.submitJob(project.id,plan.id,JSON.stringify({summary:'从收碗到门口',scenePlans:[{title:'收碗',purpose:'留下一碗饭'},{title:'门口',purpose:'等归人'},{title:'早晨',purpose:'让等待落在日常动作里'}]}),source);
    let published=repo.transition(project.id,plan.id,'approve').project!;
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'写一个温柔的五分钟短片',strategy:'write_existing',maxScenes:3});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'写第一场',expectedRevision:published.revision});run=step.run;
    repo.submitJob(project.id,step.job.id,body,source);repo.transition(project.id,step.job.id,'approve');
    run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    run=repo.transitionAgentRun(project.id,run.id,{action:'pause',expectedVersion:run.version});
    const previous=repo.getAgentDraft(project.id,run.id);
    published.units[0].scenes[0].blocks[0].text='林夏盛了半碗饭，把另一半留在锅里。';
    published.units[0].scenes[1].blocks[0].text='她走到门口，扶正父亲留下的鞋。';
    published=repo.saveProject(published,published.revision);
    published.brief.constraints='父亲仍在世，不添加死亡暗示。';published=repo.saveProject(published,published.revision);
    assert.throws(()=>repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version}),/同步/);
    const preview=mergeAgentDraft(repo.getAgentRunInput(project.id,run.id),published,previous,{preferAuthor:true,allowUnchanged:true});
    assert.deepEqual(preview.overriddenSceneIds,[run.sceneIds[0]]);
    assert.throws(()=>repo.synchronizeAgentRun(project.id,run.id,run.version,published.revision-1),ScriptConflictError);
    const synced=repo.synchronizeAgentRun(project.id,run.id,run.version,published.revision);run=synced.run;
    assert.deepEqual(repo.getAgentRunInput(project.id,run.id),published);
    assert.equal(synced.project.brief.constraints,published.brief.constraints);
    assert.equal(synced.project.units[0].scenes[0].blocks[0].text,published.units[0].scenes[0].blocks[0].text);
    assert.equal(repo.getJobInput(project.id,step.job.id).units[0].scenes[0].blocks[0].text,'');
    assert.deepEqual(run.completedJobIds,[step.job.id]);
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    run=repo.transitionAgentRun(project.id,run.id,{action:'skip',expectedVersion:run.version});
    assert.equal(run.cursor,2);
    const latest=repo.getAgentDraft(project.id,run.id);
    const context=buildScriptTaskContext(latest,latest.units[0],'scene',[],run.sceneIds[2]);
    assert.match(JSON.stringify(context),/父亲仍在世/);assert.match(JSON.stringify(context),/扶正父亲留下的鞋/);
    const last=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[2],prompt:JSON.stringify(context),expectedRevision:latest.revision});run=last.run;
    repo.submitJob(project.id,last.job.id,JSON.stringify({summary:'保留父亲在世的约束',blocks:[{type:'action',text:'钥匙转响。林夏没有起身，把锅盖挪开了一半。'}]}),source);
    repo.transition(project.id,last.job.id,'approve');run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    const review=repo.createAgentStep(project.id,run.id,run.version,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],reviewSceneIds:run.sceneIds,prompt:'检查三场衔接',expectedRevision:repo.getAgentDraft(project.id,run.id).revision});run=review.run;
    repo.submitJob(project.id,review.job.id,JSON.stringify({summary:'等待通过饭、鞋和钥匙形成连贯动作，无死亡暗示',findings:[]}),source);
    run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'complete');
    const approved=repo.publishAgentRun(project.id,run.id,run.version,published.revision);
    assert.match(approved.project.units[0].scenes[0].blocks[0].text,/半碗饭/);
    assert.match(approved.project.units[0].scenes[1].blocks[0].text,/父亲留下的鞋/);
    assert.match(approved.project.units[0].scenes[2].blocks[0].text,/钥匙转响/);
    assert.equal(repo.getJob(project.id,step.job.id).attempts!.length,1);
  }finally{db.close();}
});
test('验收：旧上下文未采用的返回在同步时保留，取消任务的迟到返回拒收',()=>{
  const {db,repo,project}=setup();
  try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'保留候选',strategy:'write_existing',maxScenes:1});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'初稿',expectedRevision:project.revision});run=step.run;
    const oldInput=repo.getAgentDraft(project.id,run.id);
    // Simulate an existing step whose input lived only in the current draft.
    db.prepare('DELETE FROM script_job_inputs WHERE job_id=?').run(step.job.id);
    run=repo.transitionAgentRun(project.id,run.id,{action:'pause',expectedVersion:run.version});
    repo.submitJob(project.id,step.job.id,body,source);
    project.brief.constraints='不写对白';const published=repo.saveProject(project,project.revision);
    run=repo.synchronizeAgentRun(project.id,run.id,run.version,published.revision).run;
    assert.equal(run.activeJobId,undefined);
    assert.equal(repo.getJob(project.id,step.job.id).rawResult,body);
    assert.equal(repo.getJob(project.id,step.job.id).status,'cancelled');
    assert.deepEqual(repo.getJobInput(project.id,step.job.id),oldInput);
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const retry=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'不写对白的新稿',expectedRevision:repo.getAgentDraft(project.id,run.id).revision});run=retry.run;
    repo.transitionAgentRun(project.id,run.id,{action:'cancel',expectedVersion:run.version});
    assert.throws(()=>repo.submitJob(project.id,retry.job.id,body,source),/已取消/);
  }finally{db.close();}
});
test('验收：建立 Agent 步骤是原子操作，登记失败不会遗留孤立任务',()=>{
  const {db,repo,project}=setup();
  try{
    project.methods=[{id:'voice',title:'对白',version:'1',content:'语言克制',usage:{operations:['scene'],inputs:[],note:''}}];
    const published=repo.saveProject(project,project.revision);
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'检查登记',strategy:'write_existing',maxScenes:1,methodIds:['voice']});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const input={operation:'scene' as const,unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'正文',expectedRevision:published.revision};
    assert.throws(()=>repo.createAgentStep(project.id,run.id,run.version,input),/Skill/);
    assert.equal(repo.listJobs(project.id).length,0);
    const step=repo.createAgentStep(project.id,run.id,run.version,{...input,methodIds:['voice']});
    assert.equal(repo.getAgentRun(project.id,run.id).activeJobId,step.job.id);
    assert.equal(repo.listJobs(project.id).length,1);
  }finally{db.close();}
});
test('验收：采用预览后又出现新作者稿，服务端拒绝旧预览，不修改当前稿',()=>{
  const {db,repo,project}=setup();
  try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'一场规划',strategy:'plan_only',maxScenes:1});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'plan',unitId:run.unitId,sceneId:project.units[0].scenes[0].id,prompt:'一场',expectedRevision:project.revision});run=step.run;
    repo.submitJob(project.id,step.job.id,JSON.stringify({summary:'安静的饭桌',scenePlans:[{title:'留饭',purpose:'用半碗饭表现牵挂'}]}),source);
    repo.transition(project.id,step.job.id,'approve');run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    project.title='作者新标题';const latest=repo.saveProject(project,project.revision);
    assert.throws(()=>repo.publishAgentRun(project.id,run.id,run.version,project.revision),ScriptConflictError);
    assert.deepEqual(repo.getProject(project.id),latest);
    assert.equal(authorHistoryCount(db),0);
    assert.equal(repo.publishAgentRun(project.id,run.id,run.version,latest.revision).project.title,'作者新标题');
  }finally{db.close();}
});
test('验收：手动执行方式随任务保存，重建仓储后保持手动，只能暂停后显式切换',()=>{
  const {db,repo,project}=setup();
  try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'离线手动验收',strategy:'write_existing',maxScenes:1,executionMode:'manual'});
    assert.equal(createScriptRepository(db).getAgentRun(project.id,run.id).executionMode,'manual');
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    assert.throws(()=>repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,executionMode:'api'}),/暂停/);
    run=repo.transitionAgentRun(project.id,run.id,{action:'pause',expectedVersion:run.version});
    run=repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,executionMode:'api'});
    assert.equal(run.executionMode,'api');
  }finally{db.close();}
});
test('验收：过期返回保留正文与实际修改过的提示词，但不能采用覆盖作者新稿',()=>{
  const {db,repo,project}=setup();
  try{
    const job=repo.createJob(project.id,{operation:'scene',unitId:project.units[0].id,sceneId:project.units[0].scenes[0].id,prompt:'原提示词',expectedRevision:project.revision});
    project.units[0].scenes[0].blocks[0].text='作者在请求期间改了正文';
    const saved=repo.saveProject(project,project.revision);
    const executionPrompt={prompt:'实际发出的提示词：保留灶火',systemInstruction:'不用对白'};
    const returned=repo.submitJob(project.id,job.id,body,source,executionPrompt);
    assert.equal(returned.status,'failed');assert.match(returned.error!,/基线/);
    assert.equal(returned.rawResult,body);assert.deepEqual(returned.attempts![0].executionPrompt,executionPrompt);
    assert.throws(()=>repo.transition(project.id,job.id,'approve'),/基线/);
    assert.deepEqual(repo.getProject(project.id),saved);
  }finally{db.close();}
});
test('验收：审阅意见关联改稿和复查，保留任务输入与证据，不以点击准备修改伪装成已解决',()=>{
  const {db,repo,project}=setup();
  try{
    project.units[0].scenes[0].blocks[0].text='林夏对空屋说：回来自己盛。';
    let saved=repo.saveProject(project,project.revision);
    const target={unitId:saved.units[0].id,sceneId:saved.units[0].scenes[0].id};
    const review=repo.createJob(saved.id,{...target,operation:'review',prompt:'核对克制表达',expectedRevision:saved.revision});
    repo.submitJob(saved.id,review.id,JSON.stringify({summary:'一句台词可转为行动',findings:[{sceneId:target.sceneId,issue:'对空屋说话直接说明意图',suggestion:'把饭勺留在父亲惯用的一边'}]}),source);
    repo.recordReviewDecision(saved.id,review.id,0,'to_fix');
    const reviewSource={jobId:review.id,index:0};
    const revision=repo.createJob(saved.id,{...target,operation:'scene',prompt:'用摆勺动作代替自言自语',expectedRevision:saved.revision,reviewSource});
    repo.submitJob(saved.id,revision.id,JSON.stringify({summary:'改为可见动作',blocks:[{type:'action',text:'林夏把勺柄转向父亲惯坐的位置，留着厨房的灯。'}]}),source);
    assert.equal(repo.getJob(saved.id,review.id).reviewDecisions![0].status,'to_fix');
    saved=repo.transition(saved.id,revision.id,'approve').project!;
    assert.equal(repo.getJob(saved.id,review.id).reviewDecisions![0].status,'revised');
    assert.equal(repo.getJob(saved.id,review.id).reviewDecisions![0].revisionJobId,revision.id);
    const recheck=repo.createJob(saved.id,{...target,operation:'review',prompt:'只复查原问题是否仍存在',expectedRevision:saved.revision,reviewSceneIds:[target.sceneId],reviewSource});
    repo.submitJob(saved.id,recheck.id,JSON.stringify({summary:'原句已删，勺柄方向承担留饭意图，本轮未再发现原问题。',findings:[]}),source);
    const resolution=repo.getJob(saved.id,review.id).reviewDecisions![0];
    assert.equal(resolution.status,'verified');assert.equal(resolution.revision,saved.revision);assert.equal(resolution.recheckJobId,recheck.id);
    assert.equal(repo.getJobInput(saved.id,revision.id).units[0].scenes[0].blocks[0].text,'林夏对空屋说：回来自己盛。');
    assert.throws(()=>repo.createJob(saved.id,{...target,operation:'outline',prompt:'不能扩大到全剧',expectedRevision:saved.revision,reviewSource}),/不匹配/);
  }finally{db.close();}
});

test('验收：十二集大纲任务严格校验、持久恢复，仅填空白且保留正文与结尾',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const draft=createScriptProject('末班车',createScriptCreationProfile('tv-series',12,45));
    draft.units[0].summary='作者已确定：母亲决定回乡。';draft.units[0].endingHook='车停在桥头。';draft.units[0].scenes[0].blocks[0].text='车窗上结了一层雾。';
    const project=repo.saveProject(draft,0);const unit=project.units[0];
    const job=repo.createJob(project.id,{operation:'unit_outlines',unitId:unit.id,sceneId:unit.id,prompt:'按十二集规划，只填空白',expectedRevision:project.revision});
    const bad=repo.submitJob(project.id,job.id,JSON.stringify({summary:'错误越权',units:[{unitIndex:2,summary:'第二集',scenes:[]}]}),source);
    assert.equal(bad.status,'failed');assert.match(bad.error!,/不可修改/);
    const units=Array.from({length:12},(_,i)=>({unitIndex:i+1,title:`旅途 ${i+1}`,summary:`第 ${i+1} 段旅程，在一座不同的车站停留。`}));
    assert.equal(repo.submitJob(project.id,job.id,JSON.stringify({summary:'每集独立一段行程',units}),source).status,'ready');
    const reopened=createScriptRepository(db);reopened.ensureSchema();const adopted=reopened.transition(project.id,job.id,'approve').project!;
    assert.equal(adopted.units.length,12);assert.deepEqual(adopted.units[0],project.units[0]);assert.equal(adopted.units[11].summary,units[11].summary);
    assert.equal(reopened.getJob(project.id,job.id).attempts!.length,2);
    assert.equal(reopened.transition(project.id,job.id,'approve').project!.revision,adopted.revision);
  }finally{db.close();}
});
test('验收：单元大纲只替换指定单元，任务输入可追溯且不写入故事总纲',()=>{
  const {db,repo,project}=setup();try{
    project.brief.outline='全片总纲';project.units[0].summary='原摘要';project.units[0].endingHook='留白';
    const saved=repo.saveProject(project,project.revision);const unit=saved.units[0];
    const job=repo.createJob(saved.id,{operation:'unit_outline',unitId:unit.id,sceneId:unit.id,prompt:'细化摘要',expectedRevision:saved.revision});
    repo.submitJob(saved.id,job.id,JSON.stringify({summary:'补上行为',outline:'林夏留下一盏灯，然后离开。'}),source);
    const next=repo.transition(saved.id,job.id,'approve').project!;
    assert.equal(next.brief.outline,'全片总纲');assert.equal(next.units[0].endingHook,'留白');assert.deepEqual(next.units[0].scenes,unit.scenes);assert.equal(repo.getJobInput(saved.id,job.id).units[0].summary,'原摘要');
  }finally{db.close();}
});
test('验收：蓝图建议使用 Skill 快照，一次只采用一个方案；设定保持待确认且不串故事',()=>{
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const draft=createScriptProject('三条街',createScriptCreationProfile('anthology',3,20));
    draft.methods=[{id:'everyday',title:'日常观察',version:'2',content:'先观察动作，不套冲突公式。',usage:{operations:['fact'],inputs:[],note:'保留日常语气'}}];
    const project=repo.saveProject(draft,0);const unit=project.units[0];
    const input={operation:'fact' as const,unitId:unit.id,sceneId:unit.id,prompt:'提出街道设定',expectedRevision:project.revision,methodIds:['everyday']};
    assert.throws(()=>repo.createJob(project.id,{...input,scopeId:'missing'}),/范围/);
    const job=repo.createJob(project.id,input);assert.equal(job.methods[0].content,draft.methods[0].content);
    repo.submitJob(project.id,job.id,JSON.stringify({summary:'仅提供生活细节',suggestions:[{title:'收摊时间',content:'这条街的修鞋摊每晚七点收摊。'},{title:'雨棚',content:'巷口雨棚漏水。'}]}),source);
    const next=repo.transition(project.id,job.id,'approve',0).project!;
    assert.equal(next.facts.length,1);assert.equal(next.facts[0].status,'draft');assert.equal(next.facts[0].scopeId,unit.scopeId);
    assert.equal(repo.transition(project.id,job.id,'approve',0).project!.revision,next.revision);assert.throws(()=>repo.transition(project.id,job.id,'approve',1),/另一方案/);
    assert.throws(()=>repo.createJob(project.id,{...input,operation:'character',expectedRevision:next.revision}),/不适用/);
  }finally{db.close();}
});
test('验收：讨论记录在作者继续写作后仍保存答复，不能当作正文提案采用',()=>{
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const job=repo.createJob(project.id,{operation:'consult',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:'已读当前场，讨论灯的作用',authorRequest:'灯是否太直白？',expectedRevision:project.revision});
    project.units[0].scenes[0].blocks[0].text='作者继续写：林夏拔掉了插头。';repo.saveProject(project,project.revision);
    assert.equal(repo.submitJob(project.id,job.id,JSON.stringify({summary:'谈灯的作用',answer:'就本轮读取的旧稿而言，灯可以承担行动结果，不必再用独白解释。'}),source).status,'ready');
    assert.equal(repo.getJob(project.id,job.id).authorRequest,'灯是否太直白？');assert.throws(()=>repo.transition(project.id,job.id,'approve'));
    assert.equal(repo.getProject(project.id)!.units[0].scenes[0].blocks[0].text,'作者继续写：林夏拔掉了插头。');
  }finally{db.close();}
});
test('验收：选中部分对白润色，未经选中的正文与数据保持原样，过期选择被拒绝',async()=>{
  const {blocksToScreenplayText}=await import('../packages/script/src/fountainAdapter');
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const scene=unit.scenes[0];
    scene.blocks=[{id:'untouched',type:'action',text:'误会\n这是动作说明，不能被误读成对白。'},{id:'line',type:'dialogue',speakerName:'林夏',text:'饭在锅里，回来记得吃。'},{id:'after',type:'note',text:'保留停顿'}];
    const saved=repo.saveProject(project,project.revision);const original=blocksToScreenplayText(scene.blocks,[]);const start=original.indexOf('回来记得吃');
    const input={operation:'text_rewrite' as const,unitId:unit.id,sceneId:scene.id,prompt:'只改选中部分',expectedRevision:saved.revision,selection:{start,end:start+5,text:'回来记得吃'}};
    assert.throws(()=>repo.createJob(saved.id,{...input,selection:{...input.selection,text:'错误选中'}}),/不一致/);
    const job=repo.createJob(saved.id,input);repo.submitJob(saved.id,job.id,JSON.stringify({summary:'少解释',replacement:'趁热吃'}),source);
    const next=repo.transition(saved.id,job.id,'approve').project!;
    assert.deepEqual(next.units[0].scenes[0].blocks[0],scene.blocks[0]);assert.deepEqual(next.units[0].scenes[0].blocks[2],scene.blocks[2]);
    assert.equal(next.units[0].scenes[0].blocks[1].speakerName,'林夏');assert.equal(next.units[0].scenes[0].blocks[1].text,'饭在锅里，趁热吃。');
  }finally{db.close();}
});

test('验收：创建与原始资料一次保存，拒绝非法资料时不留下空项目',async()=>{
  const {createScriptProjectFromMaterial}=await import('../packages/script/src/creation');
  const db=new Database(':memory:');const repo=createScriptRepository(db);repo.ensureSchema();
  try{
    const profile=createScriptCreationProfile('anthology',3,20);
    assert.throws(()=>repo.saveProject(createScriptProjectFromMaterial('非法资料',profile,{concept:42 as unknown as string,theme:'',outline:''}),0));
    assert.equal(repo.listProjects().length,0);
    const saved=repo.saveProject(createScriptProjectFromMaterial('三条街',profile,{concept:'三条街各有一个独立故事。',theme:'',outline:'',sceneText:'修鞋匠\n明天再来。',facts:['街口每天七点熄灯。']}),0);
    assert.equal(saved.revision,1);assert.equal(saved.brief.concept,'三条街各有一个独立故事。');
    assert.equal(saved.units[0].scenes[0].blocks[0].speakerName,'修鞋匠');assert.equal(saved.facts[0].status,'draft');assert.equal(saved.facts[0].scopeId,saved.units[0].scopeId);
    assert.equal(saved.characters.length,0,'不能从故事描述中猜出人物名');
  }finally{db.close();}
});

function runningStep(repo:ReturnType<typeof createScriptRepository>,project:ReturnType<typeof createScriptProject>,maxCalls=2){
  let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'写一场并检查',strategy:'write_existing',maxScenes:1,maxCalls,executionMode:'manual'});
  run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
  return repo.createAgentStep(project.id,run.id,run.version,{expectedRevision:project.revision,operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'写灯下的动作'});
}
test('验收：Agent 同一步只能由一个窗口领取，错误执行标识不能提交或结束任务',()=>{
  const {db,repo,project}=setup();try{
    const step=runningStep(repo,project);const claimed=repo.claimAgentExecution(project.id,step.run.id,step.job.id,'window-one');
    assert.equal(claimed.run.callsUsed,1);assert.throws(()=>repo.claimAgentExecution(project.id,step.run.id,step.job.id,'window-two'),/另一执行窗口/);
    assert.throws(()=>repo.submitJob(project.id,step.job.id,body,source,undefined,'wrong'),/不属于/);
    assert.throws(()=>repo.failJob(project.id,step.job.id,'错误中断','wrong'),/另一执行窗口/);
    assert.equal(repo.renewAgentExecution(project.id,step.job.id,claimed.job.execution!.id).execution!.state,'active');
    const ready=repo.submitJob(project.id,step.job.id,body,source,undefined,claimed.job.execution!.id);
    assert.equal(ready.status,'ready');assert.equal(ready.execution!.state,'finished');
    assert.equal(repo.listAgentRuns(project.id)[0].callsUsed,1);
  }finally{db.close();}
});
test('验收：过期执行必须显式接管，旧窗口返回无法覆盖新一轮结果，重新领取占用预算',()=>{
  const {db,repo,project}=setup();const now=Date.now;try{
    const step=runningStep(repo,project,3);const first=repo.claimAgentExecution(project.id,step.run.id,step.job.id,'first');
    Date.now=()=>now()+100000;
    assert.throws(()=>repo.claimAgentExecution(project.id,step.run.id,step.job.id,'second'),/明确选择/);
    const second=repo.claimAgentExecution(project.id,step.run.id,step.job.id,'second',true);
    assert.equal(second.run.callsUsed,2);assert.equal(second.job.executionHistory!.length,1);
    assert.throws(()=>repo.submitJob(project.id,step.job.id,body,source,undefined,first.job.execution!.id),/不属于/);
    assert.equal(repo.submitJob(project.id,step.job.id,body,source,undefined,second.job.execution!.id).status,'ready');
  }finally{Date.now=now;db.close();}
});
test('验收：预算耗尽时不能发起下一轮，暂停后增加预算才能恢复；失败返回保留',()=>{
  const {db,repo,project}=setup();try{
    const step=runningStep(repo,project,1);let claimed=repo.claimAgentExecution(project.id,step.run.id,step.job.id,'window');
    assert.equal(repo.submitJob(project.id,step.job.id,'不是 JSON',source,undefined,claimed.job.execution!.id).status,'failed');
    assert.throws(()=>repo.claimAgentExecution(project.id,step.run.id,step.job.id,'window'),/预算/);
    let run=repo.transitionAgentRun(project.id,step.run.id,{action:'pause',expectedVersion:claimed.run.version});
    run=repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,maxCalls:2});
    assert.throws(()=>repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,goal:'未完成步骤不能改上下文'}),/未完成/);
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    claimed=repo.claimAgentExecution(project.id,run.id,step.job.id,'window');
    const ready=repo.submitJob(project.id,step.job.id,body,source,undefined,claimed.job.execution!.id);
    assert.equal(ready.attempts!.length,2);assert.equal(claimed.run.callsUsed,2);
  }finally{db.close();}
});
test('验收：分场后暂停供作者调整计划，场景锁由服务端强制执行，顺序调整不改正文顺序',()=>{
  const {db,repo,project}=setup();try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'先看分场',strategy:'plan_write',maxScenes:2,pauseAfterPlanning:true});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{expectedRevision:project.revision,operation:'plan',unitId:run.unitId,sceneId:project.units[0].scenes[0].id,prompt:'分成厨房与门口'});run=step.run;
    repo.submitJob(project.id,step.job.id,JSON.stringify({summary:'两场日常动作',scenePlans:[{title:'厨房',purpose:'留饭'},{title:'门口',purpose:'等钥匙声'}]}),source);
    const draft=repo.transition(project.id,step.job.id,'approve').project!;
    run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.status,'paused');assert.equal(run.phase,'write');
    const ids=draft.units[0].scenes.map(scene=>scene.id);
    run=repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,sceneIds:[ids[1],ids[0]],lockedSceneIds:[ids[1]],stepInstructions:{[ids[0]]:'不写自言自语'}});
    assert.deepEqual(repo.getAgentDraft(project.id,run.id).units[0].scenes.map(scene=>scene.id),ids);
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    assert.throws(()=>repo.createAgentStep(project.id,run.id,run.version,{expectedRevision:draft.revision,operation:'scene',unitId:run.unitId,sceneId:ids[1],prompt:'越过锁'}),/锁定/);
    run=repo.transitionAgentRun(project.id,run.id,{action:'skip',expectedVersion:run.version});
    assert.equal(run.sceneIds[run.cursor],ids[0]);assert.equal(run.stepInstructions![ids[0]],'不写自言自语');
  }finally{db.close();}
});

test('验收：修改 Agent 分场只更新工作草稿，保留任务基线且不能借此修改正文',()=>{
  const {db,repo,project}=setup();try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'按作者分场写作',strategy:'write_existing',maxScenes:1});
    const scene=project.units[0].scenes[0];
    const edit={sceneId:scene.id,title:'灶边',purpose:'林夏把勺柄转向父亲惯用的一侧',location:'厨房',timeOfDay:'夜'};
    run=repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,sceneEdits:[edit]});
    const draft=repo.getAgentDraft(project.id,run.id);
    assert.equal(draft.units[0].scenes[0].purpose,edit.purpose);assert.deepEqual(repo.getProject(project.id),project);
    assert.deepEqual(repo.getAgentRunInput(project.id,run.id).units[0].scenes[0],scene);
    assert.throws(()=>repo.transitionAgentRun(project.id,run.id,{action:'configure',expectedVersion:run.version,sceneEdits:[{...edit,blocks:[]} as typeof edit]}),/正文/);
  }finally{db.close();}
});
test('验收：锁定的空白占位场也不能在 Agent 补分场时被删除',()=>{
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const locked=unit.scenes[0];
    let run=repo.createAgentRun(project.id,{unitId:unit.id,goal:'保留作者锁定场',strategy:'plan_only',maxScenes:1,lockedSceneIds:[locked.id]});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{expectedRevision:project.revision,operation:'plan',unitId:unit.id,sceneId:locked.id,prompt:'仅补充一场'});
    repo.submitJob(project.id,step.job.id,JSON.stringify({summary:'只新增',scenePlans:[{title:'门口',purpose:'收起钥匙'}]}),source);
    const adopted=repo.transition(project.id,step.job.id,'approve').project!;
    assert.deepEqual(adopted.units[0].scenes[0],locked);assert.equal(adopted.units[0].scenes.length,2);
  }finally{db.close();}
});

test('验收：有限修订只改审阅指出且未锁定的场，重启继续，轮数上限保留未解决意见',()=>{
  const {db,repo,project}=setup();
  try{
    project.units[0].scenes[0].blocks[0].text='门铃响了，她开门。';
    const locked=structuredClone(project.units[0].scenes[0]);locked.id='locked-scene';locked.blocks[0].id='locked-block';locked.blocks[0].text='锁定的开放结尾。';project.units[0].scenes.push(locked);
    const published=repo.saveProject(project,project.revision);const unit=published.units[0];
    let run=repo.createAgentRun(project.id,{unitId:unit.id,goal:'修好因果，保留开放结尾',strategy:'review_revise',maxScenes:2,maxRevisionRounds:1,lockedSceneIds:[locked.id]});
    run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const findings=[{sceneId:unit.scenes[0].id,issue:'她还在厨房，开门动作缺少路径',suggestion:'补走到门口'},{sceneId:locked.id,issue:'没有解释来人',suggestion:'补身份'}];
    let step=repo.createAgentStep(project.id,run.id,run.version,{operation:'review',unitId:unit.id,sceneId:unit.scenes[0].id,reviewSceneIds:run.sceneIds,prompt:'具体检查两场',expectedRevision:published.revision});run=step.run;
    repo.submitJob(project.id,step.job.id,JSON.stringify({summary:'有一处衔接问题与一处风格分歧',findings}),source);
    run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});
    assert.equal(run.phase,'revise');assert.equal(run.revisionRounds,1);assert.deepEqual(run.revisionQueue?.map(item=>item.sceneId),[unit.scenes[0].id]);
    const reopened=createScriptRepository(db);reopened.ensureSchema();run=reopened.getAgentRun(project.id,run.id);
    step=reopened.createAgentStep(project.id,run.id,run.version,{operation:'rewrite',unitId:unit.id,sceneId:unit.scenes[0].id,blockIds:unit.scenes[0].blocks.map(block=>block.id),prompt:'仅补充动作路径，不替换开放结尾',expectedRevision:published.revision});run=step.run;
    reopened.submitJob(project.id,step.job.id,JSON.stringify({summary:'补足从厨房到门口的动作',blocks:[{type:'action',text:'门铃响了。她擦干手，沿走廊走到门边，开门。'}]}),source);reopened.transition(project.id,step.job.id,'approve');
    run=reopened.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});assert.equal(run.phase,'review');
    const draft=reopened.getAgentDraft(project.id,run.id);assert.deepEqual(draft.units[0].scenes[1],locked);assert.equal(reopened.getProject(project.id)!.revision,published.revision);
    step=reopened.createAgentStep(project.id,run.id,run.version,{operation:'review',unitId:unit.id,sceneId:unit.scenes[0].id,reviewSceneIds:run.sceneIds,prompt:'复查本轮问题',expectedRevision:draft.revision});run=step.run;
    reopened.submitJob(project.id,step.job.id,JSON.stringify({summary:'路径已补，仍有可讨论的风格建议',findings:[findings[0]]}),source);
    run=reopened.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});assert.equal(run.status,'complete');assert.equal(run.revisionRounds,1);assert.equal(run.completedJobIds.length,3);
    assert.equal(reopened.getJob(project.id,step.job.id).result!.findings!.length,1);
    const result=reopened.publishAgentRun(project.id,run.id,run.version,published.revision);assert.equal(result.project.units[0].scenes[0].blocks[0].text,'门铃响了。她擦干手，沿走廊走到门边，开门。');assert.deepEqual(result.project.units[0].scenes[1],locked);
  }finally{db.close();}
});
test('验收：有限修订无意见立即结束，拒绝越界轮数和正式稿自动修订',()=>{
  const {db,repo,project}=setup();try{
    const input={unitId:project.units[0].id,goal:'只修具体问题',strategy:'review_revise' as const,maxScenes:1};
    assert.throws(()=>repo.createAgentRun(project.id,{...input,maxRevisionRounds:4}),/1–3/);
    assert.throws(()=>repo.createAgentRun(project.id,{...input,workspace:'published'}),/工作草稿/);
    let run=repo.createAgentRun(project.id,input);run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'review',unitId:run.unitId,sceneId:run.sceneIds[0],reviewSceneIds:run.sceneIds,prompt:'无正文先指出资料不足',expectedRevision:project.revision});run=step.run;
    repo.submitJob(project.id,step.job.id,JSON.stringify({summary:'空正文无可修订依据',findings:[]}),source);run=repo.transitionAgentRun(project.id,run.id,{action:'advance',expectedVersion:run.version});assert.equal(run.status,'complete');assert.equal(run.revisionRounds,0);
  }finally{db.close();}
});

test('验收：持久任务按范围分页，新增任务不造成旧页遗漏，讨论不被其他步骤挤出',()=>{
  const {db,repo,project}=setup();try{
    const unit=project.units[0];const created=[];
    for(let index=0;index<105;index++)created.push(repo.createJob(project.id,{operation:'consult',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:`讨论 ${index}`,authorRequest:`第 ${index} 个问题`,expectedRevision:project.revision}));
    const first=repo.listJobs(project.id,{operation:'consult',limit:100});assert.equal(first.length,100);
    repo.createJob(project.id,{operation:'scene',unitId:unit.id,sceneId:unit.scenes[0].id,prompt:'新的正文任务',expectedRevision:project.revision});
    const older=repo.listJobs(project.id,{operation:'consult',before:first.at(-1)!.id,limit:100});assert.equal(older.length,5);
    assert.equal(new Set([...first,...older].map(job=>job.id)).size,105);assert.equal(older.at(-1)!.id,created[0].id);
    assert.equal(repo.listJobs(project.id,{operation:'consult',sceneId:'other-scene'}).length,0);
    assert.throws(()=>repo.listJobs(project.id,{limit:101}),/1–100/);
  }finally{db.close();}
});

test('验收：作者跳过失败的待写步骤保留原返回和原稿，不允许跳过仍被执行窗口领取的步骤',()=>{
  const {db,repo,project}=setup();try{
    let run=repo.createAgentRun(project.id,{unitId:project.units[0].id,goal:'试写可跳过',strategy:'write_existing',maxScenes:1});run=repo.transitionAgentRun(project.id,run.id,{action:'resume',expectedVersion:run.version});
    const step=repo.createAgentStep(project.id,run.id,run.version,{operation:'scene',unitId:run.unitId,sceneId:run.sceneIds[0],prompt:'试写',expectedRevision:project.revision});run=step.run;
    const claim=repo.claimAgentExecution(project.id,run.id,step.job.id,'test-owner');run=claim.run;
    run=repo.transitionAgentRun(project.id,run.id,{action:'pause',expectedVersion:run.version});assert.throws(()=>repo.transitionAgentRun(project.id,run.id,{action:'skip_step',expectedVersion:run.version}),/执行窗口/);
    repo.submitJob(project.id,step.job.id,'不完整返回',source,undefined,claim.job.execution!.id);
    run=repo.transitionAgentRun(project.id,run.id,{action:'skip_step',expectedVersion:run.version,error:'先保留空白，稍后作者手写'});
    assert.equal(run.phase,'review');assert.equal(run.activeJobId,undefined);assert.equal(repo.getJob(project.id,step.job.id).rawResult,'不完整返回');assert.equal(repo.getJob(project.id,step.job.id).status,'cancelled');assert.deepEqual(repo.getAgentDraft(project.id,run.id),project);assert.equal(run.skippedSteps?.[0].reason,'先保留空白，稍后作者手写');
  }finally{db.close();}
});

test('验收：作者显式关联续篇时迁移本集专属资料但不合并同名人物，拆出时保护已有引用',async()=>{
  const {changeUnitStoryScope,unitCharacters}=await import('../packages/script/src/continuity');
  const {newUnit}=await import('../packages/script/src/project');
  const project=createScriptProject('独立和续篇',createScriptCreationProfile('anthology',3,3));
  project.units.push(newUnit('第二集',180000),newUnit('第三集',180000));
  project.characters=[{id:'first',name:'林敏',scopeId:project.units[0].scopeId,desire:'',need:'',contradiction:'',arc:'教师',voice:''},{id:'third',name:'林敏',scopeId:project.units[2].scopeId,desire:'',need:'',contradiction:'',arc:'另一位访客',voice:''}];
  project.units[2].scenes[0].characterIds=['third'];
  const joined=changeUnitStoryScope(project,project.units[2].id,project.units[0].scopeId);
  assert.equal(joined.characters.length,2);assert.equal(joined.characters[1].scopeId,joined.units[0].scopeId);assert.equal(unitCharacters(joined,joined.units[2]).length,2);assert.equal(unitCharacters(joined,joined.units[1]).length,0);
  assert.notEqual(project.units[2].scopeId,joined.units[2].scopeId);assert.deepEqual(project.units[2].scenes,joined.units[2].scenes);
  assert.throws(()=>changeUnitStoryScope(joined,joined.units[2].id,'independent'),/仍引用/);
  joined.units[2].scenes[0].characterIds=[];
  const separated=changeUnitStoryScope(joined,joined.units[2].id,'independent');assert.notEqual(separated.units[2].scopeId,joined.units[0].scopeId);assert.equal(unitCharacters(separated,separated.units[2]).length,0);assert.equal(unitCharacters(separated,separated.units[0]).length,2);
});
