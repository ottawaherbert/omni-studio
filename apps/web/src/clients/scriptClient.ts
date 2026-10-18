import type {PlanningRepairTarget,PlanningRepairResult} from '../../../../packages/script/src/planningRepair';
import { checkTestSubmission, requireTestMode } from './testMode';
import { selectedMethodVersions } from '../../../../packages/script/src/methods';
import type { ScriptStage } from '../../../../packages/script/src/agentStages';
import type { ScriptJobQuery } from '../../../../packages/script/src/proposals';
import type { ScriptJob, ScriptOperation, ReviewSource } from '../../../../packages/script/src/proposals';
import type { ScriptAgentRun, ScriptAgentStrategy, ScriptAgentPlanUpdate } from '../../../../packages/script/src/agent';
import type { ScriptProject, ProjectProfile } from '../../../../packages/script/src/schema';
import type { ScriptProposal } from '../../../../packages/script/src/project';
import type { ScriptExportPackage, ScriptProjectSummary } from '../../../../packages/domain/src/scriptDelivery';
import type { AgentRun, ExternalRequest, ModelRequest } from '../../../../packages/agent-core/src';
import type { BudgetSnapshot, GoalSnapshot } from '../../../../packages/agent-core/src/goals';
import type { AgentDraftOperation, DraftSelection } from '../../../../packages/script/src/agentScope';
import type { ScriptWorkspace } from '../../../api/src/repositories/scriptWorkspaceStore';
import type { AgentDraftCandidate, AgentDraftRequest } from '../../../../packages/script/src/agentDraft';
import type { ResourceRef } from '../../../../packages/agent-core/src';
import type { ScriptExportFormat } from '../../../../packages/script/src/exporters';
import type { WorkspacePatchConflictView, WorkspacePatchResolution } from '../../../../packages/script/src/workspacePatch';
import type { CoverageAssessment, ReviewFinding } from '../../../../packages/script/src/goalChecks';
import type { MemoryWork } from '../../../../packages/agent-sqlite/src/memoryWorkStore';
import type { ScriptConversationView } from './scriptConversationClient';
async function request<T>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T>{
  checkTestSubmission(body);
  const response=await fetch(`/api/scripts${path}`,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||`请求失败 ${response.status}`),{status:response.status});return value;
}
export const scriptClient={
  exportUrl:(id:string,format:import('../../../../packages/script/src/exporters').ScriptExportFormat)=>`/api/scripts/${encodeURIComponent(id)}/export?${new URLSearchParams({format})}`,
  getReviewBaseline:(job:ScriptJob)=>request<{project:ScriptProject}>(
    `/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/input`),
  listAgentRuns:(id:string)=>request<{runs:ScriptAgentRun[]}>(`/${encodeURIComponent(id)}/agent-runs`,undefined,'GET'),
  createAgentRun:(id:string,input:{unitId:string;goal:string;strategy:ScriptAgentStrategy;maxScenes:number;methodIds:string[];methodVersions?:Record<string,string>;startSceneId?:string;workspace?:'published'|'draft';executionMode?:'api'|'manual';maxCalls?:number;lockedSceneIds?:string[];pauseAfterPlanning?:boolean;maxRevisionRounds?:number})=>request<{run:ScriptAgentRun}>(`/${encodeURIComponent(id)}/agent-runs`,input),
  getAgentDraft:(run:ScriptAgentRun)=>request<{project:ScriptProject}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/draft`,undefined,'GET'),
  getAgentRunInput:(run:ScriptAgentRun)=>request<{project:ScriptProject}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/input`),
  listAgentReviews:(run:ScriptAgentRun)=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/reviews`,undefined,'GET'),
  listAgentJobs:(run:ScriptAgentRun)=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/jobs`),
  publishAgentRun:(run:ScriptAgentRun,expectedPublishedRevision:number)=>request<{run:ScriptAgentRun;project:ScriptProject}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/publish`,{expectedVersion:run.version,expectedPublishedRevision}),
  synchronizeAgentRun:(run:ScriptAgentRun,expectedPublishedRevision:number)=>request<{run:ScriptAgentRun;project:ScriptProject}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/synchronize`,{expectedVersion:run.version,expectedPublishedRevision}),
  createAgentStep:(run:ScriptAgentRun,job:{expectedRevision:number;unitId:string;sceneId:string;operation:ScriptOperation;prompt:string;methodIds:string[];reviewSceneIds?:string[]})=>request<{run:ScriptAgentRun;job:ScriptJob}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/steps`,{expectedVersion:run.version,job}),
  claimAgentExecution:(run:ScriptAgentRun,job:ScriptJob,owner:string,replaceExpired=false)=>request<{run:ScriptAgentRun;job:ScriptJob}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/jobs/${encodeURIComponent(job.id)}/claim`,{owner,replaceExpired}),
  renewAgentExecution:(job:ScriptJob,executionId:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/renew`,{executionId}),
  transitionAgentRun:(run:ScriptAgentRun,action:'resume'|'pause'|'cancel'|'attach'|'advance'|'skip'|'skip_step'|'fail'|'configure',extra:ScriptAgentPlanUpdate&{jobId?:string;error?:string}={})=>request<{run:ScriptAgentRun}>(`/${encodeURIComponent(run.projectId)}/agent-runs/${encodeURIComponent(run.id)}/transition`,{action,expectedVersion:run.version,...extra}),
  failJob:(job:ScriptJob,error:string,executionId?:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(job.projectId)}/jobs/${encodeURIComponent(job.id)}/fail`,{error,executionId}),
  listJobs:(id:string,query:ScriptJobQuery={})=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(id)}/jobs?${new URLSearchParams(Object.entries(query).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)]))}`),
  listBoardPlanJobs:(id:string)=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(id)}/jobs?operation=board_plan`,undefined,'GET'),
  listBoardSuggestionJobs:(id:string)=>request<{jobs:ScriptJob[]}>(`/${encodeURIComponent(id)}/jobs?operation=board`,undefined,'GET'),
  getJob:(projectId:string,id:string)=>request<{job:ScriptJob}>(`/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(id)}`,undefined,'GET'),
  createJob:(project:ScriptProject,unitId:string,sceneId:string,operation:ScriptOperation,prompt:string,blockIds?:string[],methodIds:string[]=[],reviewSceneIds?:string[],agentRunId?:string,reviewSource?:ReviewSource,details?:{selection?:import('../../../../packages/script/src/proposals').TextSelection;scopeId?:string;seasonId?:string;unitIndices?:number[];authorRequest?:string})=>request<{job:ScriptJob}>(`/${encodeURIComponent(project.id)}/jobs`,{expectedRevision:project.revision,unitId,sceneId,operation,prompt,blockIds,methodIds,methodVersions:selectedMethodVersions(project.methods,methodIds),reviewSceneIds,agentRunId,reviewSource,...details}),
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

/** Author-facing durable commands. The server derives grants, tool tokens and
 * model routes; no browser-supplied authorization is accepted. */
export type ScriptCommandSource =
  | {kind:'PROJECT';projectId:string;revision:number;contentHash:string}
  | {kind:'WORKSPACE';workspaceId:string;expectedRevision:number}
  | {kind:'NEW';title:string;profile:ProjectProfile};
export type ScriptCommandTarget = {repairCandidateId?:string;outlineStructure?:boolean;outlineSceneOrder?:boolean;initialUnit?:boolean;unitId?:string;sceneId?:string;blockIds?:string[];
  selection?:DraftSelection;scopeId?:string;seasonId?:string;nodeId?:string;entityId?:string;initialScope?:'PROJECT'|'UNIT';maxNewScenes?:number;outlineRange?:DraftSelection;outlineBeatIds?:string[]};
export type ScriptGoalTarget = {initialUnit?:boolean;initialMaxNewScenes?:number;unitIds?:string[];wholeUnitIds?:string[];
  sceneIds?:Array<{unitId:string;sceneId:string}>;maxNewScenes?:Array<{unitId:string;count:number}>;
  newUnitCount?:number;newUnitMaxScenes?:number;newUnitScopeId?:string;outlineTarget?:{unitId:string;scopeId?:string;seasonId?:string;nodeId?:string;allowStructure?:boolean;allowSceneOrder?:boolean};structureTargets?:Array<{unitId:string;nodeId:string}>;storyOutlineScopeIds?:string[];seasonOutlineIds?:string[];sharedFields?:Array<'concept'|'theme'|'outline'|'audienceExperience'|'constraints'>;
  characterScopeIds?:string[];factScopeIds?:string[];characterIds?:string[];factIds?:string[];
  initialCharacterScope?:'PROJECT'|'UNIT';initialFactScope?:'PROJECT'|'UNIT';
  newUnitCharacterScopes?:boolean;newUnitFactScopes?:boolean};
export type ScriptSourceChoice = {purpose:'CONVERSATION'|'PREVIOUS_SCRIPT';ref:ResourceRef;unitIds?:string[]|null};
type CommandBase = {requestId:string;threadId:string;expectedConversationVersion:number;executionChannel?:'api'|'external'};
export type ScriptAuthorCommand =
  | CommandBase & {kind:'PLANNING_REPAIR';source:ScriptCommandSource;target:PlanningRepairTarget;instruction:string;methodIds:string[]}
  | CommandBase & {kind:'PROPOSE';source:ScriptCommandSource;operation:AgentDraftOperation;instruction:string;
      target:ScriptCommandTarget;methodIds:string[];manualGoal?:{goalId:string;expectedGoalVersion:number}}
  | CommandBase & {kind:'APPLY';workspaceId:string;candidateId:string;expectedRevision:number;writerEpoch:number;
      manualGoal?:{goalId:string;expectedGoalVersion:number}}
  | CommandBase & {kind:'GOAL_START';stopAfter?:ScriptStage;source:ScriptCommandSource;objective:string;task:'WRITE'|'REVISE'|'REVIEW';
      target:ScriptGoalTarget;methodIds:string[];sources?:ScriptSourceChoice[]}
  | CommandBase & {kind:'GOAL_CONTINUE'|'GOAL_REVISE';stopAfter?:ScriptStage;goalId:string;expectedGoalVersion:number;
      expectedRunVersion:number;objective?:string;task?:'WRITE'|'REVISE'|'REVIEW';target?:ScriptGoalTarget;methodIds?:string[];sources?:ScriptSourceChoice[];additionalSources?:ScriptSourceChoice[];
      answer?:{decisionId:string;text:string;choiceId?:string}};
export type ScriptCommandReceipt = {kind:ScriptAuthorCommand['kind'];workspaceId:string;runId:string;threadId:string;
  authorizationRef:string;goalId?:string;goalRevision?:number;reservedUnitIds?:string[]};
export type ScriptCandidateView = {id:string;workspaceId:string;status:'VALID'|'INVALID'|'REDACTED';error:string|null;
  candidate:AgentDraftCandidate|null;request:AgentDraftRequest|null;baseRef:ResourceRef|null;modelInputHash:string|null;
  runId:string|null;appliedRevision:number|null};
export type ScriptGoalView = GoalSnapshot & {redacted?:boolean;lastRunId:string;workspaceId:string;createdSceneCounts?:Record<string,number>;
  pendingQuestion?:{decisionId:string;runId:string;goalRevision:number;message:string;choices:Array<{id:string;text:string}>}|null};
export type ScriptRunView = {run:AgentRun;workspaceId:string;goalId:string|null;planningRepair?:PlanningRepairResult|null};
export type ScriptInvocationView = {id:string;runId:string;status:string;inputHash:string;request:ModelRequest;
  redacted:boolean;contextError:string|null;attempts:Array<{id:string;attemptNo:number;status:string}>};
export type ScriptGoalExternalView = {runId:string;role:string;request:ExternalRequest};
export type ScriptChatSelection = {draftOperation?:'outline_development'|'scene_order'|'scene_plan'|'replace_selection';analysis?:boolean;workspaceId:string;expectedRevision:number;unitId:string;sceneId?:string;blockIds?:string[];
  selection?:{start:number;end:number;text:string};scopeId?:string;seasonId?:string;nodeId?:string;outlineStructure?:boolean;outlineSceneOrder?:boolean;outlineRange?:DraftSelection;outlineBeatIds?:string[];localDraft?:ScriptProject;entity?:{kind:'character'|'fact';id:string};manualGoal?:{goalId:string;expectedGoalVersion:number}};
export type ScriptChatTurnBody = {requestId:string;expectedVersion:number;text:string;methodIds:string[];template:string;
  executionChannel?:'api'|'external';selection?:ScriptChatSelection};
export type ScriptGoalReviewView = {redacted:boolean;pendingBody?:string;review:null|{
  reviewId:string;workspaceId:string;manifestHash:string;workspaceRevision:number;targetUnitIds:string[];
  storyProgress?:ReturnType<typeof import('../../../../packages/script/src/goalCoverage').storyProgress>;outlineGaps?:string[];
  coverage:CoverageAssessment;repairRoundsUsed:number;maxRepairRounds:number;
  tasks:Array<{id:string;kind:'LOCAL'|'GLOBAL';phase:string;checkId:string;status:string;summary:string|null}>;
  findings:Array<ReviewFinding & {sourceRevision:number;sourceBlockHash:string;originalText:string;sourceReceiptId:string}>;
}};

export type ScriptGoalProgressView = Omit<ScriptGoalReviewView,'review'> & {review:Omit<NonNullable<ScriptGoalReviewView['review']>,'tasks'|'findings'>|null};

async function durableRequest<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api${path}`,options);
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(value.error||`任务请求失败 ${response.status}`),{status:response.status,code:value.code});
  return value as T;
}
const post=async<T>(path:string,body:unknown):Promise<T>=>{
  checkTestSubmission(body);
  if(/^\/agent\/external\/[^/]+\/result$/.test(path)||/^\/script-memory\//.test(path))requireTestMode();
  return durableRequest<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
};
export const scriptAgentClient={
  createWorkspace:(threadId:string,projectId:string,revision:number,requestId:string)=>post<{workspace:ScriptWorkspace}>(
    '/script-workspaces',{threadId,requestId,source:{projectId,revision}}),
  sendChatTurn:(threadId:string,body:ScriptChatTurnBody)=>post<{conversation:ScriptConversationView;turnId:string}>(
    `/script-assistant/conversations/${encodeURIComponent(threadId)}/messages`,body),
  submit:(command:ScriptAuthorCommand)=>post<ScriptCommandReceipt>('/script-commands',command),
  run:(runId:string)=>durableRequest<{run:AgentRun;externalRequests:ExternalRequest[]}>(`/agent/runs/${encodeURIComponent(runId)}?view=state`),
  control:(run:AgentRun,action:'pause'|'resume'|'cancel')=>post<{run:AgentRun}>(`/agent/runs/${encodeURIComponent(run.id)}/control`,
    {requestId:crypto.randomUUID(),expectedVersion:run.version,action}),
  reconcile:(run:AgentRun)=>post<{run:AgentRun}>(`/agent/runs/${encodeURIComponent(run.id)}/reconcile`,
    {requestId:crypto.randomUUID(),expectedVersion:run.version}),
  external:(requestId:string)=>durableRequest<{request:ExternalRequest}>(`/agent/external/${encodeURIComponent(requestId)}`),
  submitExternal:(request:ExternalRequest,text:string,producer:{name:string;model?:string})=>post<{request:ExternalRequest}>(
    `/agent/external/${encodeURIComponent(request.id)}/result`,{inputHash:request.inputHash,text,producer}),
  workspace:(workspaceId:string)=>durableRequest<{workspace:ScriptWorkspace}>(`/script-workspaces/${encodeURIComponent(workspaceId)}`),
  authorBaseline:(workspaceId:string)=>durableRequest<{document:ScriptProject|null}>(`/script-workspaces/${encodeURIComponent(workspaceId)}/author-baseline`),
  workspaces:()=>durableRequest<{workspaces:ScriptWorkspace[]}>('/script-workspaces'),
  workspaceState:async(threadId:string,documentId:string,previous:ScriptWorkspace[])=>{
    const held=new Map(previous.filter(item=>item.threadId===threadId&&item.documentId===documentId).slice(0,100).map(item=>[item.id,item]));
    const query=new URLSearchParams({view:'state',threadId,documentId,known:JSON.stringify([...held.values()].map(item=>[item.id,item.revision]))});
    const result=await durableRequest<{workspaces:Array<Omit<ScriptWorkspace,'document'>&{document?:ScriptProject}>}>(`/script-workspaces?${query}`);
    return {workspaces:result.workspaces.map(item=>{
      const before=held.get(item.id);
      const document=item.document??(before?.revision===item.revision?before.document:undefined);
      if(!document||item.threadId!==threadId||item.documentId!==documentId)throw new Error('工作稿读取版本不一致，请重新载入。');
      if(before&&document===before.document&&JSON.stringify({...before,document:undefined})===JSON.stringify({...item,document:undefined}))return before;
      return {...item,document};
    })};
  },
  saveWorkspace:(workspace:ScriptWorkspace,document:ScriptProject,takeover?:{runId:string;expectedVersion:number})=>durableRequest<{workspace:ScriptWorkspace}>(
    `/script-workspaces/${encodeURIComponent(workspace.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({requestId:crypto.randomUUID(),expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,document,takeover})}),
  syncAuthor:(workspaceId:string,body:{requestId:string;expectedRevision:number;expectedEpoch:number;expectedAuthorRevision:number;
    takeover?:{runId:string;expectedVersion:number}})=>post<{workspace:ScriptWorkspace;authorRevision:number;changed:boolean;
    previousWorkspaceRevision:number;synchronizedWorkspaceRevision:number;authorDelta:unknown}>(
    `/script-workspaces/${encodeURIComponent(workspaceId)}/sync-author`,body),
  workspaceVersion:(workspaceId:string,revision:number)=>durableRequest<{document:ScriptProject}>(
    `/script-workspaces/${encodeURIComponent(workspaceId)}/revisions/${revision}`),
  prepareAdoption:(workspace:ScriptWorkspace,expectedAuthorRevision:number,resolutions?:WorkspacePatchResolution[],outlineOnly=false)=>post<{
    proposal:{id:string;digest:string;document:ScriptProject}|null;conflicts:WorkspacePatchConflictView[]}>(
    `/script-workspaces/${encodeURIComponent(workspace.id)}/merge`,{workspaceRevision:workspace.revision,expectedAuthorRevision,...(resolutions?{resolutions}:{}),...(outlineOnly?{outlineOnly:true}:{})}),
  adopt:(workspaceId:string,proposal:{id:string;digest:string},requestId:string)=>post<{receipt:{partial?:boolean}}>(
    `/script-workspaces/${encodeURIComponent(workspaceId)}/adopt`,{requestId,proposalId:proposal.id,digest:proposal.digest}),
  goals:(threadId:string)=>durableRequest<{goals:ScriptGoalView[]}>(`/script-goals?threadId=${encodeURIComponent(threadId)}&view=state`),
  goal:(goalId:string)=>durableRequest<{goal:ScriptGoalView;run:AgentRun}>(`/script-goals/${encodeURIComponent(goalId)}?view=state`),
  goalBudget:(goalId:string)=>durableRequest<{budget:BudgetSnapshot}>(`/script-goals/${encodeURIComponent(goalId)}/budget`),
  increaseGoalBudget:(goalId:string,body:{requestId:string;expectedGoalVersion:number;expectedBudgetVersion:number;maxInvocations:number})=>
    post<{budget:BudgetSnapshot}>(`/script-goals/${encodeURIComponent(goalId)}/budget`,body),
  goalProgress:(goalId:string)=>durableRequest<ScriptGoalProgressView>(`/script-goals/${encodeURIComponent(goalId)}/review?view=progress`),
  goalReview:(goalId:string)=>durableRequest<ScriptGoalReviewView>(`/script-goals/${encodeURIComponent(goalId)}/review`),
  runs:(threadId:string)=>durableRequest<{runs:ScriptRunView[]}>(`/script-runs?threadId=${encodeURIComponent(threadId)}&view=state`),
  goalExternal:(goalId:string)=>durableRequest<{externalRequests:ScriptGoalExternalView[]}>(
    `/script-goals/${encodeURIComponent(goalId)}/external-requests?view=state`),
  invocations:(runId:string)=>durableRequest<{invocations:ScriptInvocationView[]}>(
    `/agent/runs/${encodeURIComponent(runId)}/invocations`),
  candidates:(workspaceId:string)=>durableRequest<{candidates:ScriptCandidateView[]}>(
    `/script-workspaces/${encodeURIComponent(workspaceId)}/candidates`),
  candidateBatch:async(threadId:string,documentId:string,workspaceIds:string[])=>{
    const candidates:ScriptCandidateView[]=[];
    // Bound each transport, never omit older candidates from revalidation.
    for(let offset=0;offset<workspaceIds.length;offset+=100){
      const query=new URLSearchParams({threadId,documentId,workspaceIds:JSON.stringify(workspaceIds.slice(offset,offset+100))});
      const result=await durableRequest<{candidates:ScriptCandidateView[]}>(`/script-candidates?${query}`);
      candidates.push(...result.candidates);
    }
    return {candidates};
  },
  memoryWork:(scopeId:string)=>durableRequest<MemoryWork[]>(`/script-memory/scopes/${encodeURIComponent(scopeId)}/work`),
  returnMemory:(scopeId:string,workId:string,body:{requestHash:string;text:string;producer:string;attemptId?:string})=>post<MemoryWork>(
    `/script-memory/scopes/${encodeURIComponent(scopeId)}/work/${encodeURIComponent(workId)}/return`,body),
  exportWorkspace:(workspaceId:string,revision:number,unitIds:string[],format:ScriptExportFormat)=>post<{
    kind:'candidate';ref:ResourceRef;unitIds:string[];text:string}>(`/script-workspaces/${encodeURIComponent(workspaceId)}/export`,
    {revision,unitIds,format}),
};
