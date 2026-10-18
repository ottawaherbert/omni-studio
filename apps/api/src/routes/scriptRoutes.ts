import {createScriptProjectFromMaterial} from '../../../../packages/script/src/creation';
import type { Express, Response } from 'express';
import type { ScriptRepository } from '../repositories/scriptStore';
import { createMockProposal } from '../../../../packages/script/src/project';
import { parseProjectProfile } from '../../../../packages/script/src/schema';
import { createScriptDelivery, exportText, scriptExportFilename } from '../../../../packages/script/src/exporters';
import { resolveSharedScriptMethods } from '../services/scriptSkills';
import type { MethodBinding } from '../../../../packages/script/src/schema';
export function registerScriptRoutes(app:Express,repository:ScriptRepository,resolveMethods:(ids:string[])=>Promise<MethodBinding[]>=resolveSharedScriptMethods) {
  const error=(res:Response,e:unknown)=>res.status(Number((e as {statusCode?:number;status?:number}).statusCode||(e as {status?:number}).status)||400).json({error:e instanceof Error?e.message:'请求失败'});
  const get=(id:string)=>{const p=repository.getProject(id);if(!p)throw Object.assign(new Error('剧本不存在；旧稿未自动迁移，请从作品原件重新建立项目。'),{statusCode:404});return p;};
  const taskMethods=async(body:{methodIds?:unknown;methodVersions?:unknown})=>{
    const ids=body.methodIds??[];
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new Error('Skill 选择无效');
    const methods=await resolveMethods(ids);
    if(methods.length!==ids.length||new Set(methods.map(m=>m.id)).size!==methods.length||methods.some((m,i)=>m.id!==ids[i]&&m.id!==`skill:${ids[i]}`))throw new Error('所选 Skill 不可用');
    if(body.methodVersions!==undefined){
      const versions=body.methodVersions as Record<string,unknown>;
      if(!versions||Array.isArray(versions)||typeof versions!=='object'||methods.some((m,i)=>versions[ids[i]]!==m.version))
        throw Object.assign(new Error('Skill 已更新，请刷新后重新发起任务。'),{status:409});
    }
    return methods;
  };
  app.get('/api/scripts',(req,res)=>{try{res.json({projects:repository.listProjects()});}catch(e){error(res,e);}});
  app.post('/api/scripts',(req,res)=>{try{const project=createScriptProjectFromMaterial(req.body.title,parseProjectProfile(req.body.profile),req.body.initialBrief);res.status(201).json({project:repository.saveProject(project,0)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id',(req,res)=>{try{res.json({project:get(req.params.id)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/workflow-review',(req,res)=>{try{res.json({notices:repository.workflowReviews(req.params.id)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/workflow-review/acknowledge',(req,res)=>{try{res.json(repository.acknowledgeWorkflowReviews(req.params.id,req.body.expectedRevision,req.body.ids));}catch(e){error(res,e);}});
  app.put('/api/scripts/:id',(req,res)=>{try{
    get(req.params.id);if(req.body.project?.id!==req.params.id)throw new Error('项目标识不一致');
    res.json({project:repository.saveProject(req.body.project,req.body.expectedRevision)});
  }catch(e){error(res,e);}});
  app.delete('/api/scripts/:id',(req,res)=>{try{
    get(req.params.id);
    res.json(repository.deleteProject(req.params.id));
  }catch(e){error(res,e);}});
  app.get('/api/scripts/:id/delivery',(req,res)=>{try{res.json({package:createScriptDelivery(get(req.params.id))});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/export',(req,res)=>{try{
    const format=req.query.format;
    if(format!=='json'&&format!=='markdown'&&format!=='fountain')throw new Error('不支持的导出格式');
    if(req.query.revision!==undefined)throw new Error('作者稿只保留当前内容，不支持历史版本导出');
    const p=get(req.params.id);
    res.attachment(scriptExportFilename(p,format)).set('X-Script-Revision',String(p.revision));
    if(format==='json')return res.type('application/json').send(JSON.stringify(p,null,2));
    res.type('text/plain; charset=utf-8').send(exportText(p,format));
  }catch(e){error(res,e);}});
  app.get('/api/scripts/:id/jobs',(req,res)=>{try{get(req.params.id);res.json({jobs:req.query.operation==='board'?repository.listBoardSuggestionJobs(req.params.id):req.query.operation==='board_plan'?repository.listBoardPlanJobs(req.params.id):repository.listJobs(req.params.id,{unitId:typeof req.query.unitId==='string'?req.query.unitId:undefined,sceneId:typeof req.query.sceneId==='string'?req.query.sceneId:undefined,operation:typeof req.query.operation==='string'?req.query.operation:undefined,status:typeof req.query.status==='string'?req.query.status:undefined,standalone:req.query.standalone==='true',before:typeof req.query.before==='string'?req.query.before:undefined,limit:req.query.limit===undefined?undefined:Number(req.query.limit)})});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/jobs/:jobId',(req,res)=>{try{get(req.params.id);res.json({job:repository.getJob(req.params.id,req.params.jobId)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/jobs/:jobId/input',(req,res)=>{try{get(req.params.id);res.json({project:repository.getJobInput(req.params.id,req.params.jobId)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/agent-runs',(req,res)=>{try{get(req.params.id);res.json({runs:repository.listAgentRuns(req.params.id)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/agent-runs',async(req,res)=>{try{get(req.params.id);const methods=await taskMethods(req.body);res.status(201).json({run:repository.createAgentRun(req.params.id,{...req.body,methodIds:methods.map(m=>m.id)},methods)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/agent-runs/:runId/draft',(req,res)=>{try{get(req.params.id);res.json({project:repository.getAgentDraft(req.params.id,req.params.runId)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/agent-runs/:runId/reviews',(req,res)=>{try{get(req.params.id);res.json({jobs:repository.listAgentReviewJobs(req.params.id,req.params.runId)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/agent-runs/:runId/jobs',(req,res)=>{try{get(req.params.id);res.json({jobs:repository.listAgentJobs(req.params.id,req.params.runId)});}catch(e){error(res,e);}});
  app.get('/api/scripts/:id/agent-runs/:runId/input',(req,res)=>{try{get(req.params.id);res.json({project:repository.getAgentRunInput(req.params.id,req.params.runId)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/agent-runs/:runId/publish',(req,res)=>{try{get(req.params.id);res.json(repository.publishAgentRun(req.params.id,req.params.runId,req.body.expectedVersion,req.body.expectedPublishedRevision));}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/agent-runs/:runId/synchronize',(req,res)=>{try{res.json(repository.synchronizeAgentRun(req.params.id,req.params.runId,req.body.expectedVersion,req.body.expectedPublishedRevision));}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/agent-runs/:runId/steps',(req,res)=>{try{res.status(201).json(repository.createAgentStep(req.params.id,req.params.runId,req.body.expectedVersion,req.body.job));}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/agent-runs/:runId/jobs/:jobId/claim',(req,res)=>{try{res.json(repository.claimAgentExecution(req.params.id,req.params.runId,req.params.jobId,req.body.owner,req.body.replaceExpired));}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/jobs/:jobId/renew',(req,res)=>{try{res.json({job:repository.renewAgentExecution(req.params.id,req.params.jobId,req.body.executionId)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/agent-runs/:runId/transition',(req,res)=>{try{get(req.params.id);res.json({run:repository.transitionAgentRun(req.params.id,req.params.runId,req.body)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/jobs',async(req,res)=>{try{
    get(req.params.id);
    // Existing Agent steps must use the run's frozen methods, even after library changes.
    if(req.body.agentRunId)return res.status(201).json({job:repository.createJob(req.params.id,req.body)});
    const methods=await taskMethods(req.body);
    res.status(201).json({job:repository.createJob(req.params.id,{...req.body,methodIds:methods.map(m=>m.id)},methods)});
  }catch(e){error(res,e);}});
  app.post('/api/scripts/:id/jobs/:jobId/result',(req,res)=>{try{res.json({job:repository.submitJob(req.params.id,req.params.jobId,req.body.rawResult,req.body.provenance,req.body.executionPrompt,req.body.executionId)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/jobs/:jobId/findings/:index/decision',(req,res)=>{try{res.json({job:repository.recordReviewDecision(req.params.id,req.params.jobId,Number(req.params.index),req.body.status,req.body.note)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/jobs/:jobId/fail',(req,res)=>{try{res.json({job:repository.failJob(req.params.id,req.params.jobId,req.body.error,req.body.executionId)});}catch(e){error(res,e);}});
  app.post('/api/scripts/:id/jobs/:jobId/:action',(req,res)=>{try{
    const action=req.params.action;if(action!=='approve'&&action!=='reject'&&action!=='cancel')throw new Error('未知提案操作');
    res.json(repository.transition(req.params.id,req.params.jobId,action,req.body?.choiceIndex));
  }catch(e){error(res,e);}});
  // Mock results are preview-only. Their use still passes the same document CAS on save.
  app.post('/api/scripts/:id/mock',(req,res)=>{try{const project=get(req.params.id);if(project.revision!==req.body.expectedRevision)throw Object.assign(new Error('生成基线已改变'),{statusCode:409});res.json({proposal:createMockProposal(project,req.body.unitId,req.body.sceneId)});}catch(e){error(res,e);}});
}
