import { selectedMethodVersions } from '../../../../packages/script/src/methods';
import type { ScriptJobQuery } from '../../../../packages/script/src/proposals';
import type { ScriptJob, ScriptOperation, ReviewSource } from '../../../../packages/script/src/proposals';
import type { ScriptProject, ProjectProfile } from '../../../../packages/script/src/schema';
import type { ScriptProposal } from '../../../../packages/script/src/project';
import type { ScriptExportPackage, ScriptProjectSummary } from '../../../../packages/domain/src/scriptDelivery';
import type { ScriptExportFormat } from '../../../../packages/script/src/exporters';
async function request<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
  const response=await fetch(`/api/scripts${path}`,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||`请求失败 ${response.status}`),{status:response.status});return value;
}
export const scriptClient={
  exportUrl:(id:string,format:import('../../../../packages/script/src/exporters').ScriptExportFormat)=>`/api/scripts/${encodeURIComponent(id)}/export?${new URLSearchParams({format})}`,
  getReviewBaseline:(job:ScriptJob)=>request<{project:ScriptProject}>(
    `/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/input`),
  failJob:(job:ScriptJob,error:string,executionId?:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/fail`,{error,executionId}),
  listJobs:(id:string,query:ScriptJobQuery={})=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(id)}/jobs?${new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))}`),
  listBoardPlanJobs:(id:string)=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(id)}/jobs?operation=board_plan`,undefined,'GET'),
  listBoardSuggestionJobs:(id:string)=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(id)}/jobs?operation=board`,undefined,'GET'),
  getJob:(projectId:string,id:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(id)}`,undefined,'GET'),
  createJob:(project:ScriptProject,unitId:string,sceneId:string,operation:ScriptOperation,prompt:string,blockIds?:string[],methodIds:string[]=[],reviewSceneIds?:string[],agentRunId?:string,reviewSource?:ReviewSource,details?:import('../../../../packages/script/src/outlineTask').OutlineTaskScope & {selection?:import('../../../../packages/script/src/proposals').TextSelection;scopeId?:string;seasonId?:string;unitIndices?:number[];authorRequest?:string})=>request<{job:ScriptJob}>(`/${encodeURIComponent(project.id)}/jobs`,{expectedRevision:project.revision,unitId,sceneId,operation,prompt,blockIds,methodIds,methodVersions:selectedMethodVersions(project.methods,methodIds),reviewSceneIds,agentRunId,reviewSource,...details}),
  submitJob:(job:ScriptJob,rawResult:string,provenance:ScriptJob['provenance'],executionPrompt?:ScriptJob['executionPrompt'],executionId?:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/result`,{rawResult,provenance,executionPrompt,executionId}),
  recordReviewDecision:(job:ScriptJob,index:number,status:'to_fix'|'keep'|'later',note?:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/findings/${index}/decision`,{status,note}),
  transitionJob:(job:ScriptJob,action:'approve'|'reject'|'cancel',choiceIndex?:number)=>request<{job:ScriptJob;project?:ScriptProject}>(`/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/${action}`,choiceIndex===undefined?{}:{choiceIndex}),
  listProjects:()=>request<{projects:ScriptProjectSummary[]}>(''),
  createProject:(title:string,profile:ProjectProfile,initialBrief?:import('../../../../packages/script/src/creation').InitialBriefPayload)=>request<{project:ScriptProject}>('',{title,profile,initialBrief}),
  getProject:(id:string)=>request<{project:ScriptProject}>(`/${encodeURIComponent(id)}`),
  workflowReviews:(id:string)=>request<{notices:import('../../../../packages/script/src/workflowReview').WorkflowReviewNotice[]}>(`/${encodeURIComponent(id)}/workflow-review`),
  acknowledgeWorkflowReviews:(id:string,expectedRevision:number,ids:string[])=>request<{success:boolean}>(`/${encodeURIComponent(id)}/workflow-review/acknowledge`,{expectedRevision,ids}),
  saveProject:(project:ScriptProject)=>request<{project:ScriptProject}>(`/${encodeURIComponent(project.id)}`,{project,expectedRevision:project.revision},'PUT'),
  deleteProject:(id:string)=>request<{success:boolean}>(`/${encodeURIComponent(id)}`,undefined,'DELETE'),
  exportPackage:(id:string)=>request<{package:ScriptExportPackage}>(`/${encodeURIComponent(id)}/delivery`),
  mock:(project:ScriptProject,unitId:string,sceneId:string)=>request<{proposal:ScriptProposal}>(`/${encodeURIComponent(project.id)}/mock`,{unitId,sceneId,expectedRevision:project.revision}),
};
