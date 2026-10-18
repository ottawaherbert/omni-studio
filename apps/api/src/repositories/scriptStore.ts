import type { ScriptJobQuery } from '../../../../packages/script/src/proposals';
import { detectWorkflowChanges, type WorkflowReviewNotice } from '../../../../packages/script/src/workflowReview';
import {newId} from '../../../../packages/script/src/project';
import { createScriptJob, parseScriptResult, applyScriptJob, assertJobBaseline, type ScriptJob } from '../../../../packages/script/src/proposals';
import Database from 'better-sqlite3';
import { isDeepStrictEqual } from 'node:util';
import { parseScriptProject, type ScriptProject } from '../../../../packages/script/src/schema';
import { projectSummary } from '../../../../packages/script/src/exporters';
import { agentPlanCapacity, agentReviewSceneIds, agentTaskTarget, advanceScriptAgentRun, createScriptAgentRun, type ScriptAgentRun, type ScriptAgentPlanUpdate } from '../../../../packages/script/src/agent';
import { mergeAgentDraft } from '../../../../packages/script/src/agentMerge';
import { methodUsage } from '../../../../packages/script/src/methods';
export class ScriptConflictError extends Error { statusCode=409; constructor(){super('当前稿已被更新。你的输入已保留，请刷新后合并。');} }
export function createScriptRepository(db:ReturnType<typeof Database>, candidatePolicy?: { assertAdopt(job:ScriptJob):void; assertInput?(job:ScriptJob):void; view(job:ScriptJob):ScriptJob; assertLegacyExecution(job:ScriptJob):void; projectChanged?(projectId:string):void }) {
  // A second/legacy repository on the same database must not bypass the host's
  // context policy. Truly legacy jobs without a binding remain compatible.
  const assertPolicy=(job:ScriptJob)=>{
    if(!candidatePolicy&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_context_artifacts'").get()
      &&db.prepare("SELECT 1 FROM agent_context_artifacts WHERE domain='script-job' AND artifact_id=?").get(job.id))
      throw Object.assign(new Error('此候选需要通过受保护的 Agent 上下文仓储访问'),{code:'CONTEXT_GUARD_MISSING',statusCode:409});
  };
  const viewJob=(job:ScriptJob)=>{assertPolicy(job);return candidatePolicy?candidatePolicy.view(job):job;};
  const ensureSchema=()=>db.exec(`
    CREATE TABLE IF NOT EXISTS script_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_projects(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_workflow_reviews(project_id TEXT NOT NULL,notice_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,notice_key));
    CREATE TABLE IF NOT EXISTS script_project_inputs(project_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project_id,revision));
    CREATE TABLE IF NOT EXISTS script_job_inputs(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_agent_run_inputs(run_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_agent_runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_agent_drafts(run_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL);
  `);
  const getProject=(id:string):ScriptProject|null=>{const row=db.prepare('SELECT data FROM script_projects WHERE id=?').get(id) as {data:string}|undefined;return row?parseScriptProject(JSON.parse(row.data)):null;};
  const hasRetiredTable=(name:'script_revisions'|'script_agent_draft_revisions')=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
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
    if(!row)throw Object.assign(new Error('写作记录不存在'),{statusCode:404});const job=JSON.parse(row.data) as ScriptJob;assertPolicy(job);return job;
  };
  const writeJob=(job:ScriptJob)=>{job.updatedAt=Date.now();db.prepare('UPDATE script_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);return viewJob(job);};
  const requiredProject=(id:string)=>{const p=getProject(id);if(!p)throw new Error('剧本不存在');return p;};
  const getAgentRun=(projectId:string,id:string):ScriptAgentRun=>{
    const row=db.prepare('SELECT data FROM script_agent_runs WHERE id=? AND project_id=?').get(id,projectId) as {data:string}|undefined;
    if(!row)throw Object.assign(new Error('Agent 任务不存在'),{statusCode:404});
    return JSON.parse(row.data) as ScriptAgentRun;
  };
  const writeAgentRun=(run:ScriptAgentRun)=>{
    db.prepare('UPDATE script_agent_runs SET data=? WHERE id=?').run(JSON.stringify(run),run.id);
    return run;
  };
  const getAgentDraft=(projectId:string,runId:string):ScriptProject=>{
    const run=getAgentRun(projectId,runId);
    if(run.workspace!=='draft')throw new Error('此 Agent 任务没有独立工作草稿');
    const row=db.prepare('SELECT data FROM script_agent_drafts WHERE run_id=? AND project_id=?').get(runId,projectId) as {data:string}|undefined;
    if(!row)throw Object.assign(new Error('Agent 工作草稿不存在'),{statusCode:404});
    return parseScriptProject(JSON.parse(row.data));
  };
  const getJobInput=(projectId:string,id:string):ScriptProject=>{
    const job=getJob(projectId,id);candidatePolicy?.assertInput?.(job);
    const row=db.prepare('SELECT data FROM script_job_inputs WHERE job_id=? AND project_id=?').get(id,projectId) as {data:string}|undefined;
    if(row)return parseScriptProject(JSON.parse(row.data));
    // Lazily pin only the inputs of pre-migration tasks, without importing the
    // legacy author's entire history or mistaking today's text for old input.
    let source:ScriptProject|null=null;
    if(job.agentRunId){
      const current=getAgentDraft(projectId,job.agentRunId);
      const legacy=hasRetiredTable('script_agent_draft_revisions')?db.prepare('SELECT data FROM script_agent_draft_revisions WHERE run_id=? AND revision=?').get(job.agentRunId,job.baseRevision) as {data:string}|undefined:undefined;
      source=current.revision===job.baseRevision?current:legacy?parseScriptProject(JSON.parse(legacy.data)):null;
    }else source=readProjectInput(projectId,job.baseRevision);
    if(!source)throw Object.assign(new Error('任务的固定输入不存在'),{statusCode:404});
    return captureJobInput(job,source);
  };
  const writeAgentRunInput=(run:ScriptAgentRun,project:ScriptProject)=>{
    db.prepare('INSERT INTO script_agent_run_inputs(run_id,project_id,data) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET data=excluded.data')
      .run(run.id,run.projectId,JSON.stringify(project));
    captureProjectInput(project);
    return project;
  };
  const getAgentRunInput=(projectId:string,id:string):ScriptProject=>{
    const run=getAgentRun(projectId,id),row=db.prepare('SELECT data FROM script_agent_run_inputs WHERE run_id=? AND project_id=?').get(id,projectId) as {data:string}|undefined;
    if(row){const input=parseScriptProject(JSON.parse(row.data));if(input.revision!==run.baseRevision)throw new ScriptConflictError();return input;}
    const source=readProjectInput(projectId,run.baseRevision??0);
    if(!source)throw Object.assign(new Error('Agent 的固定输入不存在'),{statusCode:404});
    return writeAgentRunInput(run,source);
  };
  const saveAgentDraft=(run:ScriptAgentRun,value:ScriptProject,expectedRevision:number,minimumRevision=expectedRevision):ScriptProject=>{
    const input=parseScriptProject(value);
    if(run.workspace!=='draft'||input.id!==run.projectId||input.revision!==expectedRevision)throw new ScriptConflictError();
    const previous=getAgentDraft(run.projectId,run.id);
    if(previous.revision!==expectedRevision)throw new ScriptConflictError();
    // Pre-migration tasks may still point at this current draft without a
    // retired draft-history row (especially a run's first step). Pin only those
    // actual task inputs before approve, configure or synchronize replaces it.
    for(const row of db.prepare("SELECT jobs.data FROM script_jobs jobs LEFT JOIN script_job_inputs inputs ON inputs.job_id=jobs.id WHERE jobs.project_id=? AND json_extract(jobs.data,'$.agentRunId')=? AND json_extract(jobs.data,'$.baseRevision')=? AND inputs.job_id IS NULL")
      .all(run.projectId,run.id,previous.revision) as {data:string}[])captureJobInput(JSON.parse(row.data) as ScriptJob,previous);
    const next={...input,revision:Math.max(expectedRevision,minimumRevision)+1,updatedAt:Date.now()};
    const result=db.prepare('UPDATE script_agent_drafts SET revision=?,data=? WHERE run_id=? AND project_id=? AND revision=?')
      .run(next.revision,JSON.stringify(next),run.id,run.projectId,expectedRevision);
    if(result.changes!==1)throw new ScriptConflictError();
    return next;
  };
  const assertAgentContext=(run:ScriptAgentRun)=>{
    if(run.workspace==='draft'&&run.baseRevision!==requiredProject(run.projectId).revision)
      throw Object.assign(new Error('作者已保存新稿。请暂停 Agent，预览并同步作者稿后继续。'),{statusCode:409});
  };
  const projectForJob=(job:ScriptJob)=>job.agentRunId?getAgentDraft(job.projectId,job.agentRunId):requiredProject(job.projectId);
  const updateSourceFinding=(job:ScriptJob,status:'revised'|'verified'|'unresolved',revision:number)=>{
    if(!job.reviewSource)return;
    const source=getJob(job.projectId,job.reviewSource.jobId);
    const previous=source.reviewDecisions?.[job.reviewSource.index];
    source.reviewDecisions={...source.reviewDecisions,[job.reviewSource.index]:{...previous,status,revision,updatedAt:Date.now(),...(status==='revised'?{revisionJobId:job.id}:{recheckJobId:job.id})}};
    writeJob(source);
  };
  const transition=(projectId:string,id:string,action:'approve'|'reject'|'cancel',choiceIndex?:unknown)=>db.transaction(()=>{
    const job=getJob(projectId,id);
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
      const run=job.agentRunId?getAgentRun(projectId,job.agentRunId):undefined;
      if(run&&(run.workspace!=='draft'||run.status!=='running'||run.activeJobId!==job.id))throw new Error('Agent 工作步骤未在运行，不能采用到草稿');
      if(run)assertAgentContext(run);
      if(job.operation==='plan'){
        const linked=(db.prepare('SELECT data FROM script_agent_runs WHERE project_id=?').all(projectId) as {data:string}[])
          .map(row=>JSON.parse(row.data) as ScriptAgentRun)
          .find(run=>run.activeJobId===job.id);
        if(linked){const capacity=agentPlanCapacity(linked,projectForJob(job));if((job.result?.scenePlans?.length||0)>capacity)throw new Error(`Agent 本次最多处理 ${linked.maxScenes} 场，当前最多还能补 ${capacity} 场；请缩小分场返回后再提交。`);}
      }
      const project=run
        ? saveAgentDraft(run,applyScriptJob(getAgentDraft(projectId,run.id),job,choiceIndex as number|undefined,run.lockedSceneIds),job.baseRevision)
        : saveProject(applyScriptJob(requiredProject(projectId),job,choiceIndex as number|undefined),job.operation==='unit_outlines'&&job.unitBatch?requiredProject(projectId).revision:job.baseRevision);
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
getProject,readProjectInput,captureProjectInput,captureJobInput,getJobInput,getAgentRunInput,saveProject,getJob:(projectId:string,id:string)=>viewJob(getJob(projectId,id)),transition,
    listAgentRuns:(projectId:string)=>(db.prepare('SELECT data FROM script_agent_runs WHERE project_id=? ORDER BY rowid DESC').all(projectId) as {data:string}[])
      .map(row=>JSON.parse(row.data) as ScriptAgentRun)
      .filter((run,index)=>index<30||run.status==='paused'||run.status==='running'||run.publicationStatus==='draft'),
    getAgentRun,getAgentDraft,
    createAgentRun:(projectId:string,input:Parameters<typeof createScriptAgentRun>[1],methods?:ScriptProject['methods'])=>db.transaction(()=>{
      const published=requiredProject(projectId);
      const run=createScriptAgentRun(published,input,methods);
      writeAgentRunInput(run,published);
      db.prepare('INSERT INTO script_agent_runs(id,project_id,data) VALUES(?,?,?)').run(run.id,projectId,JSON.stringify(run));
      if(run.workspace==='draft')db.prepare('INSERT INTO script_agent_drafts(run_id,project_id,revision,data) VALUES(?,?,?,?)')
        .run(run.id,projectId,published.revision,JSON.stringify(published));
      return run;
    })(),
    publishAgentRun:(projectId:string,id:string,expectedVersion:number,expectedPublishedRevision:number)=>db.transaction(()=>{
      const run=getAgentRun(projectId,id);
      if(run.version!==expectedVersion)throw new ScriptConflictError();
      if(run.publicationStatus==='published'){
        const existing=requiredProject(projectId);
        return {run,project:existing};
      }
      if(run.workspace!=='draft'||run.status!=='complete'||run.publicationStatus!=='draft')throw new Error('Agent 工作草稿尚未完成，不能采用');
      const draft=getAgentDraft(projectId,id);
      if(draft.revision===(run.baseRevision??-1))throw new Error('此 Agent 未修改剧本正文，无需采用草稿');
      const published=requiredProject(projectId);
      if(published.revision!==expectedPublishedRevision)throw new ScriptConflictError();
      const base=getAgentRunInput(projectId,id);
      if(!base)throw new Error('Agent 工作草稿的固定输入不存在');
      const {project:merged}=mergeAgentDraft(base,published,draft);
      const project=saveProject(merged,published.revision);
      run.publicationStatus='published';run.publishedRevision=project.revision;run.version++;run.updatedAt=Date.now();
      return {run:writeAgentRun(run),project};
    }).immediate(),
    synchronizeAgentRun:(projectId:string,id:string,expectedVersion:number,expectedPublishedRevision:number)=>db.transaction(()=>{
      let run=getAgentRun(projectId,id);
      if(run.version!==expectedVersion)throw new ScriptConflictError();
      if(run.workspace!=='draft'||run.status!=='paused')throw new Error('先暂停 Agent，再同步作者稿');
      const published=requiredProject(projectId);
      if(published.revision!==expectedPublishedRevision)throw new ScriptConflictError();
      const draft=getAgentDraft(projectId,id);
      if(run.baseRevision===published.revision)return {run,project:draft};
      const base=getAgentRunInput(projectId,id);
      if(!base)throw new Error('原始基线不存在');
      if(!published.units.some(unit=>unit.id===run.unitId))throw new Error('目标单元已删除，请建立新任务');
      // Preserve finished steps; unadopted old-context proposals remain readable in job history.
      let retiredJobId:string|undefined;
      if(run.activeJobId){
        const job=getJob(projectId,run.activeJobId);
        if(job.status==='approved'||(job.operation==='review'&&job.status==='ready')){
          run=advanceScriptAgentRun({...run,status:'running'},draft,job);
          if(run.status==='complete'&&run.strategy!=='plan_only')run.phase='review';
          run.status=run.phase==='done'?'complete':'paused';
        }else{
          retiredJobId=job.id;job.status='cancelled';job.error='作者稿已同步，此步骤的旧上下文已失效；原返回保留供参考。';writeJob(job);delete run.activeJobId;
        }
      }
      const merged=mergeAgentDraft(base,published,draft,{preferAuthor:true,allowUnchanged:true});
      const project=saveAgentDraft(run,{...merged.project,revision:draft.revision},draft.revision,published.revision);
      run.syncHistory=[...(run.syncHistory||[]),{fromRevision:run.baseRevision!,toRevision:published.revision,draftRevision:draft.revision,overriddenSceneIds:merged.overriddenSceneIds,retiredJobId,createdAt:Date.now()}];
      run.baseRevision=published.revision;
      writeAgentRunInput(run,published);
      if(run.phase==='write'){
        const valid=new Set(project.units.find(unit=>unit.id===run.unitId)!.scenes.map(scene=>scene.id));
        run.sceneIds=run.sceneIds.filter((id,index)=>index<run.cursor||valid.has(id));
        if(run.cursor>=run.sceneIds.length)run.phase='review';
      }
      if(run.phase==='revise'){run.phase='review';delete run.revisionQueue;delete run.revisionCursor;delete run.revisionReviewJobId;}
      if(run.phase==='review'){
        const scenes=project.units.find(unit=>unit.id===run.unitId)!.scenes;
        run.sceneIds=(run.strategy==='review_all'?scenes:scenes.filter(scene=>run.sceneIds.includes(scene.id))).filter(scene=>scene.blocks.some(block=>block.type!=='note'&&block.text.trim())).map(scene=>scene.id);
        run.cursor=0;
        if(!run.sceneIds.length){run.phase='done';run.status='complete';}
      }
      delete run.error;run.version++;run.updatedAt=Date.now();
      return {run:writeAgentRun(run),project};
    })(),
    transitionAgentRun:(projectId:string,id:string,input:{action:'resume'|'pause'|'cancel'|'attach'|'advance'|'skip'|'skip_step'|'fail'|'configure';expectedVersion:number;jobId?:string;error?:string}&ScriptAgentPlanUpdate)=>db.transaction(()=>{
      const run=getAgentRun(projectId,id);
      if(run.version!==input.expectedVersion)throw new ScriptConflictError();
      const next:ScriptAgentRun=structuredClone(run);
      const project=run.workspace==='draft'?getAgentDraft(projectId,id):requiredProject(projectId);
      if(input.action==='resume'){
        if(['complete','cancelled'].includes(run.status))throw new Error('Agent 任务已结束');
        assertAgentContext(run);
        const anotherRunning=(db.prepare('SELECT data FROM script_agent_runs WHERE project_id=?').all(projectId) as {data:string}[])
          .map(row=>JSON.parse(row.data) as ScriptAgentRun)
          .find(other=>other.id!==run.id&&other.status==='running');
        if(anotherRunning)throw new Error('同一作品已有运行中的 Agent；请先暂停该任务。');
        next.status='running';delete next.error;
      }else if(input.action==='configure'){
        if(run.status!=='paused')throw new Error('暂停后才能更改计划');
        if(input.executionMode!==undefined){if(!['api','manual'].includes(input.executionMode))throw new Error('未知模型执行方式');next.executionMode=input.executionMode;}
        if(input.maxCalls!==undefined){if(!Number.isInteger(input.maxCalls)||input.maxCalls<Math.max(1,run.callsUsed||0)||input.maxCalls>1000)throw new Error('调用预算不能小于已使用次数，最多 1000 次');next.maxCalls=input.maxCalls;}
        const changesContext=input.goal!==undefined||input.sceneIds!==undefined||input.lockedSceneIds!==undefined||input.stepInstructions!==undefined||input.sceneEdits!==undefined;
        if(changesContext&&run.activeJobId)throw new Error('当前有未完成的步骤，请先完成或取消该步骤，再修改计划');
        const unit=project.units.find(unit=>unit.id===run.unitId)!;
        if(input.goal!==undefined){if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>5000)throw new Error('目标需要 1–5000 字');next.goal=input.goal.trim();}
        if(input.sceneIds!==undefined){
          if(run.phase!=='write'||!Array.isArray(input.sceneIds)||input.sceneIds.length>run.maxScenes||new Set(input.sceneIds).size!==input.sceneIds.length||input.sceneIds.some(id=>!unit.scenes.some(scene=>scene.id===id)))throw new Error('待写计划必须为本单元不重复的场景，且不超过场数预算');
          const completed=run.sceneIds.slice(0,run.cursor);
          if(completed.length+input.sceneIds.length>run.maxScenes)throw new Error('已完成和待写场景合计不能超过场数预算');
          if(input.sceneIds.some(id=>completed.includes(id)))throw new Error('不能重新安排已经完成的场景');
          next.sceneIds=[...completed,...input.sceneIds];
          if(!input.sceneIds.length)next.phase='review';
        }
        if(input.lockedSceneIds!==undefined){
          if(!Array.isArray(input.lockedSceneIds)||new Set(input.lockedSceneIds).size!==input.lockedSceneIds.length||input.lockedSceneIds.some(id=>!unit.scenes.some(scene=>scene.id===id)))throw new Error('锁定场景无效');
          next.lockedSceneIds=[...input.lockedSceneIds];
        }
        if(input.stepInstructions!==undefined){
          if(!input.stepInstructions||typeof input.stepInstructions!=='object'||Array.isArray(input.stepInstructions)||Object.entries(input.stepInstructions).some(([id,text])=>!unit.scenes.some(scene=>scene.id===id)||typeof text!=='string'||text.length>5000))throw new Error('每场要求需要有效场景和不超过 5000 字的文本');
          next.stepInstructions={...input.stepInstructions};
        }
        if(input.sceneEdits!==undefined){
          if(run.workspace!=='draft'||!Array.isArray(input.sceneEdits)||input.sceneEdits.length>2000||new Set(input.sceneEdits.map(edit=>edit.sceneId)).size!==input.sceneEdits.length)throw new Error('分场调整需要不重复的工作草稿场景');
          const edited=structuredClone(project);const targetUnit=edited.units.find(unit=>unit.id===run.unitId)!;
          for(const edit of input.sceneEdits){
            const scene=targetUnit.scenes.find(scene=>scene.id===edit?.sceneId);
            if(!scene||Object.keys(edit).some(key=>!['sceneId','title','purpose','location','timeOfDay'].includes(key)))throw new Error('分场调整不允许修改正文或其他单元');
            for(const key of ['title','purpose','location','timeOfDay'] as const){if(typeof edit[key]!=='string'||edit[key].length>20000||(key==='title'&&!edit[key].trim()))throw new Error('分场资料格式无效');scene[key]=edit[key];}
          }
          if(JSON.stringify(edited)!==JSON.stringify(project))saveAgentDraft(run,edited,project.revision);
        }
        if(input.pauseAfterPlanning!==undefined){if(typeof input.pauseAfterPlanning!=='boolean')throw new Error('分场后暂停设置无效');next.pauseAfterPlanning=input.pauseAfterPlanning;}
      }else if(input.action==='pause'){
        if(run.status!=='running')throw new Error('Agent 任务未在运行');
        next.status='paused';
      }else if(input.action==='cancel'){
        if(['complete','cancelled'].includes(run.status))throw new Error('Agent 任务已结束');
        next.status='cancelled';
      }else if(input.action==='fail'){
        if(run.status!=='running')throw new Error('Agent 任务未在运行');
        next.status='paused';next.error=String(input.error||'本步未完成').slice(0,2000);
      }else if(input.action==='attach'){
        if(run.status!=='running'||run.activeJobId)throw new Error('Agent 当前不能登记新任务');
        const target=agentTaskTarget(run,project);
        if(!target||!input.jobId)throw new Error('Agent 没有可执行的下一步');
        const job=getJob(projectId,input.jobId);
        if((run.workspace==='draft'?run.id:undefined)!==job.agentRunId)throw new Error('写作记录与 Agent 工作区不一致');
        const attachedElsewhere=(db.prepare('SELECT data FROM script_agent_runs WHERE project_id=?').all(projectId) as {data:string}[])
          .map(row=>JSON.parse(row.data) as ScriptAgentRun)
          .some(other=>other.id!==run.id&&other.activeJobId===job.id);
        if(attachedElsewhere)throw new Error('这条写作记录已属于另一项 Agent 任务');
        if(job.operation!==target.operation||job.sceneId!==target.sceneId||job.unitId!==run.unitId||job.baseRevision!==project.revision||job.status!=='waiting')throw new Error('任务目标与 Agent 计划不一致');
        if(job.operation==='review'){
          const expectedIds=agentReviewSceneIds(run,project);
          if(JSON.stringify(job.reviewSceneIds)!==JSON.stringify(expectedIds))throw new Error('审阅范围与 Agent 计划不一致');
        }
        const planned=run.methods.filter(method=>methodUsage(method).operations.includes(job.operation)).map(method=>({...method,usage:methodUsage(method)})).sort((a,b)=>a.id.localeCompare(b.id));
        const actual=[...job.methods].sort((a,b)=>a.id.localeCompare(b.id));
        if(JSON.stringify(planned)!==JSON.stringify(actual))throw new Error('本次 Skill 已变化，请重新建立 Agent 计划');
        next.activeJobId=job.id;
      }else if(input.action==='advance'){
        if(!run.activeJobId)throw new Error('Agent 没有可完成的任务');
        return writeAgentRun(advanceScriptAgentRun(run,project,getJob(projectId,run.activeJobId)));
      }else if(input.action==='skip_step'){
        if(run.status!=='paused'||!['write','revise'].includes(run.phase))throw new Error('暂停后才能跳过待写或待修订步骤');
        const target=agentTaskTarget(run,project);if(!target)throw new Error('当前没有可跳过的步骤');
        if(run.activeJobId){
          const job=getJob(projectId,run.activeJobId);
          if(job.status==='approved')throw new Error('此步骤已采用，应继续推进而不能跳过');
          if(job.execution?.state==='active'&&job.execution.expiresAt>Date.now())throw new Error('本步仍有执行窗口，请先结束执行再跳过');
          job.status='cancelled';job.error='作者跳过此步，已有返回保留且不采用';writeJob(job);delete next.activeJobId;
        }
        next.skippedSteps=[...(run.skippedSteps||[]),{...target,jobId:run.activeJobId,reason:String(input.error||'作者跳过').slice(0,1000),createdAt:Date.now()}];
        if(run.phase==='write'){next.cursor++;if(next.cursor>=next.sceneIds.length)next.phase='review';}
        else{next.revisionCursor=(run.revisionCursor||0)+1;if(next.revisionCursor>=(run.revisionQueue?.length||0))next.phase='review';}
        delete next.error;
      }else if(input.action==='skip'){
        if(run.status!=='running'||run.phase!=='write'||run.activeJobId)throw new Error('当前步骤不能跳过');
        const scene=project.units.find(u=>u.id===run.unitId)?.scenes.find(s=>s.id===run.sceneIds[run.cursor]);
        if(scene && !run.lockedSceneIds?.includes(scene.id) && !scene.blocks.some(b=>b.type!=='note'&&b.text.trim()))throw new Error('空白正文不能自动跳过');
        next.skippedScenes=[...(run.skippedScenes||[]),{sceneId:run.sceneIds[run.cursor],reason:!scene?'removed':run.lockedSceneIds?.includes(scene.id)?'locked':'already_written',createdAt:Date.now()}];
        next.cursor++;
        if(next.cursor>=next.sceneIds.length)next.phase='review';
      }else throw new Error('未知 Agent 操作');
      next.version++;next.updatedAt=Date.now();return writeAgentRun(next);
    })(),
    recordReviewDecision:(projectId:string,id:string,index:number,status:'to_fix'|'keep'|'later',note?:string)=>db.transaction(()=>{
      const job=getJob(projectId,id);
      if(job.operation!=='review'||job.status!=='ready'||!job.result?.findings)throw new Error('只有已完成的审阅意见可以标记处理决定');
      if(!Number.isInteger(index)||index<0||index>=job.result.findings.length)throw new Error('审阅意见不存在');
      if(!['to_fix','keep','later'].includes(status))throw new Error('未知的审阅处理决定');
      if(note!==undefined&&(typeof note!=='string'||note.length>1000))throw new Error('处理备注不能超过 1000 字');
      job.reviewDecisions={...job.reviewDecisions,[index]:{status,...(note?.trim()?{note:note.trim()}:{}),updatedAt:Date.now()}};
      return writeJob(job);
    })(),
    failJob:(projectId:string,id:string,reason:unknown,executionId?:string)=>{
      const job=getJob(projectId,id);candidatePolicy?.assertLegacyExecution(job);if(job.execution&&job.execution.id!==executionId)throw new Error('不能结束另一执行窗口的步骤');if(job.status!=='waiting'&&job.status!=='failed')return viewJob(job);
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
    listAgentReviewJobs:(projectId:string,runId:string)=>{
      getAgentRun(projectId,runId);
      return (db.prepare('SELECT data FROM script_jobs WHERE project_id=? ORDER BY rowid ASC').all(projectId) as {data:string}[])
        .map(row=>JSON.parse(row.data) as ScriptJob)
        .filter(job=>job.agentRunId===runId&&job.operation==='review'&&job.status==='ready').map(viewJob);
    },
    listAgentJobs:(projectId:string,runId:string)=>{
      getAgentRun(projectId,runId);
      return (db.prepare('SELECT data FROM script_jobs WHERE project_id=? ORDER BY rowid ASC').all(projectId) as {data:string}[])
        .map(row=>JSON.parse(row.data) as ScriptJob).filter(job=>job.agentRunId===runId).map(viewJob);
    },
    createJob:(projectId:string,input:Parameters<typeof createScriptJob>[1],methods?:ScriptProject['methods'])=>db.transaction(()=>{
      let project=requiredProject(projectId);
      if(input.agentRunId){
        const run=getAgentRun(projectId,input.agentRunId);
        methods=run.methods;
        if(run.workspace!=='draft'||run.status!=='running'||run.activeJobId)throw new Error('Agent 当前不能建立工作草稿步骤');
        assertAgentContext(run);
        project=getAgentDraft(projectId,run.id);
        const target=agentTaskTarget(run,project);
        if(!target||target.operation!==input.operation||target.sceneId!==input.sceneId||run.unitId!==input.unitId)throw new Error('任务范围与 Agent 计划不一致');
        if(['scene','rewrite'].includes(input.operation)&&run.lockedSceneIds?.includes(input.sceneId))throw new Error('此场已锁定，不允许 Agent 写作');
        if(input.operation==='scene'&&project.units.find(unit=>unit.id===run.unitId)?.scenes.find(scene=>scene.id===input.sceneId)?.blocks.some(block=>block.type!=='note'&&block.text.trim()))throw new Error('此场已有正文，Agent 必须保留并跳过');
      }
      if(input.agentRunId&&input.operation==='rewrite'){
        const run=getAgentRun(projectId,input.agentRunId);
        const scene=project.units.find(unit=>unit.id===run.unitId)?.scenes.find(scene=>scene.id===input.sceneId);
        if(run.phase!=='revise'||!scene||JSON.stringify(input.blockIds)!==JSON.stringify(scene.blocks.map(block=>block.id)))throw new Error('修订必须对应计划中的本场正文');
      }
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
    claimAgentExecution:(projectId:string,runId:string,jobId:string,owner:string,replaceExpired=false)=>db.transaction(()=>{
      const run=getAgentRun(projectId,runId);const job=getJob(projectId,jobId);
      if(run.status!=='running'||run.activeJobId!==jobId||(run.workspace==='draft'&&job.agentRunId!==runId)||!['waiting','failed'].includes(job.status))throw new Error('当前步骤不能执行');
      assertAgentContext(run);
      if(typeof replaceExpired!=='boolean')throw new Error('恢复执行选项无效');
      if(typeof owner!=='string'||!/^[\w-]{1,120}$/.test(owner))throw new Error('执行者标识无效');
      if(job.execution?.state==='active'){
        if(job.execution.expiresAt>Date.now())throw new Error('此步骤已由另一执行窗口领取，请等待返回或执行窗口结束');
        if(!replaceExpired)throw new Error('上次执行已中断，是否收到返回未知。请先检查记录，再明确选择重新执行');
      }
      if((run.callsUsed||0)>=(run.maxCalls??run.maxScenes*2+2))throw new Error('已达到调用预算，任务已保留；暂停后可调整预算');
      if((job.executionHistory?.length||0)+(job.execution?1:0)>=5)throw new Error('此步骤已执行 5 次，请保留记录并重新制定任务');
      if(job.execution)job.executionHistory=[...(job.executionHistory||[]),{...job.execution,state:'finished'}];
      job.execution={id:newId('execution'),owner,startedAt:Date.now(),expiresAt:Date.now()+90000,state:'active'};
      run.callsUsed=(run.callsUsed||0)+1;run.version++;run.updatedAt=Date.now();
      return {run:writeAgentRun(run),job:writeJob(job)};
    })(),
    renewAgentExecution:(projectId:string,jobId:string,executionId:string)=>{
      const job=getJob(projectId,jobId);
      candidatePolicy?.assertLegacyExecution(job);
      if(!job.execution||job.execution.id!==executionId||job.execution.state!=='active')throw new Error('本次执行已结束或被接管');
      if(job.agentRunId){const run=getAgentRun(projectId,job.agentRunId);if(!['running','paused'].includes(run.status)||run.activeJobId!==jobId)throw new Error('任务已结束');}
      job.execution.expiresAt=Date.now()+90000;return writeJob(job);
    },
    createAgentStep:(projectId:string,runId:string,expectedVersion:number,input:Parameters<typeof createScriptJob>[1]):{run:ScriptAgentRun;job:ScriptJob}=>db.transaction(()=>{
      const run=getAgentRun(projectId,runId);
      if(run.version!==expectedVersion)throw new ScriptConflictError();
      const job=repository.createJob(projectId,{...input,agentRunId:run.workspace==='draft'?run.id:undefined},run.methods);
      const next=repository.transitionAgentRun(projectId,runId,{action:'attach',jobId:job.id,expectedVersion});
      return {run:next,job};
    })(),
    submitJob:(projectId:string,id:string,raw:unknown,provenance:unknown,executionPrompt?:ScriptJob['executionPrompt'],executionId?:string)=>db.transaction(()=>{
      const job=getJob(projectId,id);
      candidatePolicy?.assertLegacyExecution(job);
      if(job.execution&&job.execution.id!==executionId)throw new Error('返回不属于当前执行，不能覆盖另一轮结果');
      if(job.status==='ready'&&job.rawResult===raw)return viewJob(job);
      if(!['waiting','failed'].includes(job.status))throw new Error('记录已结束，不接受迟到的模型结果');
      const project=projectForJob(job);
      if(job.agentRunId){
        const run=getAgentRun(projectId,job.agentRunId);
        if(!['running','paused'].includes(run.status)||run.activeJobId!==job.id)throw new Error('Agent 已取消或步骤已结束，不接受返回');
      }
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
        if(job.operation==='plan'){
          const linked=(db.prepare('SELECT data FROM script_agent_runs WHERE project_id=?').all(projectId) as {data:string}[])
            .map(row=>JSON.parse(row.data) as ScriptAgentRun)
            .find(run=>run.activeJobId===job.id);
          if(linked){const capacity=agentPlanCapacity(linked,project);if((job.result.scenePlans?.length||0)>capacity)throw new Error(`本次最多处理 ${linked.maxScenes} 场，当前最多还能补 ${capacity} 场；请精简分场建议后重新提交。`);}
        }
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
      db.prepare('DELETE FROM script_agent_run_inputs WHERE project_id=?').run(id);
      if(hasRetiredTable('script_agent_draft_revisions'))db.prepare('DELETE FROM script_agent_draft_revisions WHERE run_id IN (SELECT id FROM script_agent_runs WHERE project_id=?)').run(id);
      db.prepare('DELETE FROM script_agent_runs WHERE project_id=?').run(id);
      db.prepare('DELETE FROM script_agent_drafts WHERE project_id=?').run(id);
      candidatePolicy?.projectChanged?.(id);
      return { success: true };
    })(),
  };
  return repository;
}
export type ScriptRepository=ReturnType<typeof createScriptRepository>;
