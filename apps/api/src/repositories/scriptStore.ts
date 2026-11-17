import type { ScriptJobQuery } from '../../../../packages/script/src/proposals';
import { detectWorkflowChanges, type WorkflowReviewNotice } from '../../../../packages/script/src/workflowReview';
import {newId} from '../../../../packages/script/src/project';
import { createScriptJob, parseScriptResult, applyScriptJob, assertJobBaseline, type ScriptJob } from '../../../../packages/script/src/proposals';
import Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { parseScriptProject, type ScriptProject } from '../../../../packages/script/src/schema';
import { projectSummary } from '../../../../packages/script/src/exporters';
export class ScriptConflictError extends Error { statusCode=409; constructor(){super('当前稿已被更新。你的输入已保留，请刷新后合并。');} }
export function createScriptRepository(db:ReturnType<typeof Database>, candidatePolicy?: { assertAdopt(job:ScriptJob):void; assertInput?(job:ScriptJob):void; view(job:ScriptJob):ScriptJob; assertLegacyExecution(job:ScriptJob):void; projectChanged?(projectId:string):void }) {
  // A second/legacy repository on the same database must not bypass the host's
  // context policy. Truly legacy jobs without a binding remain compatible.
  const retiredJob=(job:ScriptJob)=>Boolean(job.agentRunId)||Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_context_artifacts'").get()&&db.prepare("SELECT 1 FROM agent_context_artifacts WHERE domain='script-job' AND artifact_id=?").get(job.id));
  const assertWritable=(job:ScriptJob)=>{if(retiredJob(job))throw Object.assign(new Error('历史助手任务仅供查看与导出；请基于当前稿建立新任务。'),{statusCode:409,code:'RETIRED_TASK'});};
  const viewJob=(job:ScriptJob)=>retiredJob(job)?{...job,readOnly:true}:candidatePolicy?candidatePolicy.view(job):job;
  const ensureSchema=()=>db.exec(`
    CREATE TABLE IF NOT EXISTS script_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_workflow_reviews(project_id TEXT NOT NULL,notice_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,notice_key));
    CREATE TABLE IF NOT EXISTS script_project_inputs(project_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,revision));
    CREATE TABLE IF NOT EXISTS script_job_inputs(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
  `);
  const getProject=(id:string):ScriptProject|null=>{const row=db.prepare('SELECT data FROM script_projects WHERE id=?').get(id) as {data:string}|undefined;return row?parseScriptProject(JSON.parse(row.data)):null;};
  const hasRetiredTable=(name:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  // Existing fixed task/reference inputs may predate explicit input tables.
  // Read them on demand; never create, backfill or append author history.
  const readRetiredProjectInput=(id:string,revision:number):{data:string}|undefined=>hasRetiredTable('script_revisions')?
    db.prepare('SELECT data FROM script_revisions WHERE project_id=? AND revision=?').get(id,revision) as {data:string}|undefined:undefined;
  // These are execution/reference inputs, not author history. Ordinary saves
  // never enter this table. Legacy rows remain readable by existing bindings.
  const readProjectInput=(id:string,revision:number):ScriptProject|null=>{
    const current=getProject(id);if(!current)return null;
    if(current.revision===revision)return current;
    const row=(db.prepare('SELECT data FROM script_project_inputs WHERE project_id=? AND revision=?').get(id,revision)
      ??readRetiredProjectInput(id,revision)) as {data:string}|undefined;
    return row?parseScriptProject(JSON.parse(row.data)):null;
  };
  const captureProjectInput=(value:ScriptProject):ScriptProject=>{
    const project=parseScriptProject(value),source=readProjectInput(project.id,project.revision);
    if(!source||!isDeepStrictEqual(source,project))throw new ScriptConflictError();
    db.prepare('INSERT OR IGNORE INTO script_project_inputs(project_id,revision,data) VALUES(?,?,?)').run(project.id,project.revision,JSON.stringify(project));
    return project;
  };
  const captureJobInput=(job:ScriptJob,value:ScriptProject)=>{
    const project=parseScriptProject(value);
    if(project.id!==job.projectId||project.revision!==job.baseRevision)throw new ScriptConflictError();
    const old=db.prepare('SELECT data FROM script_job_inputs WHERE job_id=? AND project_id=?').get(job.id,job.projectId) as {data:string}|undefined;
    if(old&&!isDeepStrictEqual(parseScriptProject(JSON.parse(old.data)),project))throw new ScriptConflictError();
    db.prepare('INSERT OR IGNORE INTO script_job_inputs(job_id,project_id,data) VALUES(?,?,?)').run(job.id,job.projectId,JSON.stringify(project));
    if(!job.agentRunId)captureProjectInput(project);
    return project;
  };
  const saveDocument=(value:unknown,expectedRevision:number)=>db.transaction(()=>{
    const input=parseScriptProject(value);const previous=getProject(input.id);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||input.revision!==expectedRevision||(previous?.revision??0)!==expectedRevision||(!previous&&expectedRevision!==0)) throw new ScriptConflictError();
    if(previous&&input.createdAt!==previous.createdAt) throw new Error('创建时间不可修改');
    if(previous?.originalMaterial&&!isDeepStrictEqual(input.originalMaterial,previous.originalMaterial))throw new Error('创建时的输入原件不可改写；请编辑当前稿或故事资料');
    // Measurement can only enter through a trusted media pipeline, not a document PUT.
    for(const unit of input.units) for(const e of unit.timingEvidence) if(e.source==='ffprobe') {
      const old=previous?.units.find(u=>u.id===unit.id)?.timingEvidence.find(x=>x.id===e.id);
      if(!old||!isDeepStrictEqual(e,old)) throw Object.assign(new Error('实测证据必须由媒体测量流程创建'),{statusCode:400});
    }
    const next={...input,revision:expectedRevision+1,updatedAt:Date.now()};const data=JSON.stringify(next);
    if(previous){const result=db.prepare('UPDATE script_projects SET revision=?,data=? WHERE id=? AND revision=?').run(next.revision,data,next.id,expectedRevision);if(result.changes!==1)throw new ScriptConflictError();}
    else db.prepare('INSERT INTO script_projects(id,revision,data) VALUES(?,?,?)').run(next.id,next.revision,data);
    if(previous)for(const notice of detectWorkflowChanges(previous,next,next.revision))
      db.prepare('INSERT INTO script_workflow_reviews(project_id,notice_key,data) VALUES(?,?,?) ON CONFLICT(project_id,notice_key) DO UPDATE SET data=excluded.data').run(next.id,notice.key,JSON.stringify(notice));
    for(const row of db.prepare('SELECT notice_key,data FROM script_workflow_reviews WHERE project_id=?').all(next.id) as {notice_key:string;data:string}[]){
      const notice=JSON.parse(row.data) as WorkflowReviewNotice;
      if(notice.unitId&&!next.units.some(unit=>unit.id===notice.unitId))db.prepare('DELETE FROM script_workflow_reviews WHERE project_id=? AND notice_key=?').run(next.id,row.notice_key);
    }
    candidatePolicy?.projectChanged?.(next.id);
    return next;
  }).immediate();
  const saveProject=(value:unknown,expectedRevision:number)=>saveDocument(value,expectedRevision);
  const getJob=(projectId:string,id:string):ScriptJob=>{
    const row=db.prepare('SELECT data FROM script_jobs WHERE id=? AND project_id=?').get(id,projectId) as {data:string}|undefined;
    if(!row)throw Object.assign(new Error('写作记录不存在'),{statusCode:404});const job=JSON.parse(row.data) as ScriptJob;return job;
  };
  const writeJob=(job:ScriptJob)=>{job.updatedAt=Date.now();db.prepare('UPDATE script_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);return viewJob(job);};
  const requiredProject=(id:string)=>{const p=getProject(id);if(!p)throw new Error('剧本不存在');return p;};
  const getJobInput=(projectId:string,id:string):ScriptProject=>{
    const job=getJob(projectId,id);candidatePolicy?.assertInput?.(job);
    const row=db.prepare('SELECT data FROM script_job_inputs WHERE job_id=? AND project_id=?').get(id,projectId) as {data:string}|undefined;
    if(row)return parseScriptProject(JSON.parse(row.data));
    // Lazily pin only the inputs of pre-migration tasks, without importing the
    // legacy author's entire history or mistaking today's text for old input.
    let source:ScriptProject|null=null;
    if(job.agentRunId){
      const row=hasRetiredTable('script_agent_drafts')?db.prepare('SELECT data FROM script_agent_drafts WHERE run_id=? AND project_id=?').get(job.agentRunId,projectId) as {data:string}|undefined:undefined;
      const current=row?parseScriptProject(JSON.parse(row.data)):null;
      const legacy=hasRetiredTable('script_agent_draft_revisions')?db.prepare('SELECT data FROM script_agent_draft_revisions WHERE run_id=? AND revision=?').get(job.agentRunId,job.baseRevision) as {data:string}|undefined:undefined;
      source=current?.revision===job.baseRevision?current:legacy?parseScriptProject(JSON.parse(legacy.data)):null;
    }else source=readProjectInput(projectId,job.baseRevision);
    if(!source)throw Object.assign(new Error('任务的固定输入不存在'),{statusCode:404});
    return captureJobInput(job,source);
  };
  const projectForJob=(job:ScriptJob)=>requiredProject(job.projectId);
  const updateSourceFinding=(job:ScriptJob,status:'revised'|'verified'|'unresolved',revision:number)=>{
    if(!job.reviewSource)return;
    const source=getJob(job.projectId,job.reviewSource.jobId);assertWritable(source);
    const previous=source.reviewDecisions?.[job.reviewSource.index];
    source.reviewDecisions={...source.reviewDecisions,[job.reviewSource.index]:{...previous,status,revision,updatedAt:Date.now(),...(status==='revised'?{revisionJobId:job.id}:{recheckJobId:job.id})}};
    writeJob(source);
  };
  const transition=(projectId:string,id:string,action:'approve'|'reject'|'cancel',choiceIndex?:unknown)=>db.transaction(()=>{
    const job=getJob(projectId,id);assertWritable(job);
    if(action==='approve'){
      const needsChoice=['ending','scene_turn','concept','theme','character','fact'].includes(job.operation);
      if(needsChoice&&(typeof choiceIndex!=='number'||!Number.isInteger(choiceIndex)||choiceIndex<0||choiceIndex>=(job.result?.choices?.length||job.result?.suggestions?.length||0)))throw new Error('请选择有效的建议方案');
      if(!needsChoice&&choiceIndex!==undefined)throw new Error('本步骤不接受建议方案序号');
      if(job.status==='approved'){
        candidatePolicy?.assertInput?.(job);
        if(needsChoice&&job.selectedChoiceIndex!==choiceIndex)throw new Error('此记录已采用另一方案');
        const applied=job.agentRunId?projectForJob(job):requiredProject(projectId);
        return {job:viewJob(job),project:applied};
      }
      candidatePolicy?.assertAdopt(job);
      const project=saveProject(applyScriptJob(requiredProject(projectId),job,choiceIndex as number|undefined),job.operation==='unit_outlines'&&job.unitBatch?requiredProject(projectId).revision:job.baseRevision);
      job.status='approved';job.appliedRevision=project.revision;if(needsChoice)job.selectedChoiceIndex=choiceIndex as number;
      updateSourceFinding(job,'revised',project.revision);
      return {job:viewJob(writeJob(job)),project};
    }
    const target=action==='cancel'?'cancelled':'rejected';
    if(job.status===target)return {job:viewJob(job)};
    if(!['waiting','ready','failed'].includes(job.status))throw new Error('记录已结束，不能重复修改');
    job.status=target;return {job:viewJob(writeJob(job))};
  }).immediate();
  const repository={ensureSchema,
    workflowReviews:(projectId:string):WorkflowReviewNotice[]=>{
      requiredProject(projectId);
      return (db.prepare('SELECT data FROM script_workflow_reviews WHERE project_id=? ORDER BY notice_key').all(projectId) as {data:string}[]).map(row=>JSON.parse(row.data));
    },
    acknowledgeWorkflowReviews:(projectId:string,expectedRevision:number,ids:unknown)=>db.transaction(()=>{
      if(requiredProject(projectId).revision!==expectedRevision)throw new ScriptConflictError();
      if(!Array.isArray(ids)||ids.length>3000||ids.some(id=>typeof id!=='string'||id.length>200))throw new Error('复核提示标识无效');
      for(const row of db.prepare('SELECT notice_key,data FROM script_workflow_reviews WHERE project_id=?').all(projectId) as {notice_key:string;data:string}[])
        if(ids.includes((JSON.parse(row.data) as WorkflowReviewNotice).id))db.prepare('DELETE FROM script_workflow_reviews WHERE project_id=? AND notice_key=?').run(projectId,row.notice_key);
      return {success:true};
    })(),
getProject,readProjectInput,captureProjectInput,captureJobInput,getJobInput,saveProject,getJob:(projectId:string,id:string)=>viewJob(getJob(projectId,id)),transition,
    recordReviewDecision:(projectId:string,id:string,index:number,status:'to_fix'|'keep'|'later',note?:string)=>db.transaction(()=>{
      const job=getJob(projectId,id);assertWritable(job);
      if(job.operation!=='review'||job.status!=='ready'||!job.result?.findings)throw new Error('只有已完成的审阅意见可以标记处理决定');
      if(!Number.isInteger(index)||index<0||index>=job.result.findings.length)throw new Error('审阅意见不存在');
      if(!['to_fix','keep','later'].includes(status))throw new Error('未知的审阅处理决定');
      if(note!==undefined&&(typeof note!=='string'||note.length>1000))throw new Error('处理备注不能超过 1000 字');
      job.reviewDecisions={...job.reviewDecisions,[index]:{status,...(note?.trim()?{note:note.trim()}:{}),updatedAt:Date.now()}};
      return writeJob(job);
    })(),
    failJob:(projectId:string,id:string,reason:unknown,executionId?:string)=>{
      const job=getJob(projectId,id);assertWritable(job);candidatePolicy?.assertLegacyExecution(job);if(job.execution&&job.execution.id!==executionId)throw new Error('不能结束另一执行窗口的步骤');if(job.status!=='waiting'&&job.status!=='failed')return viewJob(job);
      if(job.execution)job.execution.state='finished';
      job.status='failed';job.error=typeof reason==='string'?reason.slice(0,2000):'模型调用未完成';return writeJob(job);
    },
    listJobs:(projectId:string,query:ScriptJobQuery={})=>{
      const limit=query.limit??100;
      if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('任务页大小需要 1–100 条');
      const conditions=['project_id=?'];const params:(string|number)[]=[projectId];
      for(const key of ['unitId','sceneId','operation','status'] as const)if(query[key]){if(typeof query[key]!=='string')throw new Error('任务筛选无效');conditions.push(`json_extract(data, '$.${key}')=?`);params.push(query[key]!);}
      if(query.standalone)conditions.push("json_extract(data, '$.agentRunId') IS NULL");
      if(query.before){conditions.push('rowid < (SELECT rowid FROM script_jobs WHERE project_id=? AND id=?)');params.push(projectId,query.before);}
      return (db.prepare(`SELECT data FROM script_jobs WHERE ${conditions.join(' AND ')} ORDER BY rowid DESC LIMIT ?`).all(...params,limit) as {data:string}[]).map(row=>viewJob(JSON.parse(row.data) as ScriptJob));
    },
    listBoardPlanJobs:(projectId:string)=>(db.prepare('SELECT data FROM script_jobs WHERE project_id=? ORDER BY rowid DESC').all(projectId) as {data:string}[])
      .map(row=>JSON.parse(row.data) as ScriptJob).filter(job=>job.operation==='board_plan'&&!job.agentRunId).map(viewJob),
    listBoardSuggestionJobs:(projectId:string)=>(db.prepare('SELECT data FROM script_jobs WHERE project_id=? ORDER BY rowid DESC').all(projectId) as {data:string}[])
      .map(row=>JSON.parse(row.data) as ScriptJob).filter(job=>['board_plan','ending','scene_turn'].includes(job.operation)&&!job.agentRunId).map(viewJob),
    createJob:(projectId:string,input:Parameters<typeof createScriptJob>[1],methods?:ScriptProject['methods'])=>db.transaction(()=>{
      let project=requiredProject(projectId);
      if(input.agentRunId)throw Object.assign(new Error('内部助手执行已移除，请创建独立任务'),{statusCode:410});
      if(input.reviewSource){
        const original=getJob(projectId,input.reviewSource.jobId);
        candidatePolicy?.assertAdopt(original);
        const finding=original.result?.findings?.[input.reviewSource.index];
        if(original.operation!=='review'||original.status!=='ready'||!finding||finding.sceneId!==input.sceneId||original.unitId!==input.unitId)throw new Error('原审阅意见与改稿目标不一致');
      }
      const job=createScriptJob(project,input,methods);
      captureJobInput(job,project);
      db.prepare('INSERT INTO script_jobs(id,project_id,data) VALUES(?,?,?)').run(job.id,projectId,JSON.stringify(job));return job;
    }).immediate(),
    submitJob:(projectId:string,id:string,raw:unknown,provenance:unknown,executionPrompt?:ScriptJob['executionPrompt'],executionId?:string)=>db.transaction(()=>{
      const job=getJob(projectId,id);
      assertWritable(job);candidatePolicy?.assertLegacyExecution(job);
      if(job.execution&&job.execution.id!==executionId)throw new Error('返回不属于当前执行，不能覆盖另一轮结果');
      if(job.status==='ready'&&job.rawResult===raw)return viewJob(job);
      if(!['waiting','failed'].includes(job.status))throw new Error('记录已结束，不接受迟到的模型结果');
      const project=projectForJob(job);
      if(typeof raw!=='string'||raw.length>200000)throw new Error('模型结果过长或格式不正确');
      const source=provenance as ScriptJob['provenance'];
      if(!source||!['manual_external','api'].includes(source.source)||typeof source.provider!=='string'||typeof source.modelId!=='string'||source.provider.length>200||source.modelId.length>200)throw new Error('缺少有效模型来源');
      if((job.attempts?.length||0)>=20)throw new Error('此记录已达到 20 次返回上限，请保留记录并发起新任务');
      if(executionPrompt!==undefined&&(typeof executionPrompt?.prompt!=='string'||!executionPrompt.prompt.trim()||typeof executionPrompt.systemInstruction!=='string'||executionPrompt.prompt.length+executionPrompt.systemInstruction.length>200000))throw new Error('实际提示词记录无效或过长');
      job.executionPrompt=executionPrompt?{prompt:executionPrompt.prompt,systemInstruction:executionPrompt.systemInstruction}:{prompt:job.prompt,systemInstruction:''};
      job.provenance={source:source.source,provider:source.provider,modelId:source.modelId};job.rawResult=raw;
      try{
        if(job.operation!=='consult')assertJobBaseline(project,job);
        job.result=parseScriptResult(raw,project,job);
        job.status='ready';delete job.error;
        if(job.operation==='review'&&job.reviewSource)updateSourceFinding(job,job.result.findings?.length?'unresolved':'verified',job.baseRevision);
      }
      catch(e){job.status='failed';job.error=e instanceof Error?e.message:'结果校验失败';}
      if(job.execution)job.execution.state='finished';
      job.attempts=[...(job.attempts||[]),{rawResult:raw,error:job.error,createdAt:Date.now(),provenance:job.provenance,executionPrompt:job.executionPrompt}];
      return writeJob(job);
    })(),
    listProjects:()=> (db.prepare('SELECT data FROM script_projects ORDER BY rowid DESC').all() as {data:string}[]).map(row=>projectSummary(parseScriptProject(JSON.parse(row.data)))),
    deleteProject:(id:string)=>db.transaction(()=>{
      db.prepare('DELETE FROM script_workflow_reviews WHERE project_id=?').run(id);
      db.prepare('DELETE FROM script_projects WHERE id=?').run(id);
      if(hasRetiredTable('script_revisions'))db.prepare('DELETE FROM script_revisions WHERE project_id=?').run(id);
      db.prepare('DELETE FROM script_jobs WHERE project_id=?').run(id);
      db.prepare('DELETE FROM script_project_inputs WHERE project_id=?').run(id);
      db.prepare('DELETE FROM script_job_inputs WHERE project_id=?').run(id);
      if(hasRetiredTable('script_agent_run_inputs'))db.prepare('DELETE FROM script_agent_run_inputs WHERE project_id=?').run(id);
      if(hasRetiredTable('script_agent_draft_revisions'))db.prepare('DELETE FROM script_agent_draft_revisions WHERE run_id IN (SELECT id FROM script_agent_runs WHERE project_id=?)').run(id);
      if(hasRetiredTable('script_agent_runs'))db.prepare('DELETE FROM script_agent_runs WHERE project_id=?').run(id);
      if(hasRetiredTable('script_agent_drafts'))db.prepare('DELETE FROM script_agent_drafts WHERE project_id=?').run(id);
      candidatePolicy?.projectChanged?.(id);
      return { success: true };
    })(),
  };
  return repository;
}
export type ScriptRepository=ReturnType<typeof createScriptRepository>;
