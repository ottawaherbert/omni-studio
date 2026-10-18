import type {PlanningRepairTarget,PlanningRepairResult} from '../../../../../packages/script/src/planningRepair';
import {ScriptAnalysisSummary,type ScriptAnalysisEntry,type AnalysisSceneSource} from './components/ScriptAnalysisView';
import {scriptUpdatedTarget,type ScriptUpdatedTarget} from './scriptAnalysisNavigation';
import {useGoalPollingRead} from './useGoalPollingRead';
import { useScriptExecutionChannel } from './useScriptExecutionChannel';
import { SCRIPT_STAGES, stageLabels, stageDescriptions, isPlanningStage, type ScriptStage } from '../../../../../packages/script/src/agentStages';
import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Send, X, Sparkles, ChevronDown, SlidersHorizontal, ArrowRight, Lightbulb, History } from 'lucide-react';
import { Modal } from '../../../../../src/components/ui/Modal';
import { ScriptCandidateCard, ScriptDocumentComparison, scriptChangeLabel, scriptChangeValue } from './components/ScriptCandidateCard';

function suggestedPromptsForStage(stage: ScriptStage): Array<{label: string; text: string; target?:'scene'}> {
  switch (stage) {
    case 'BLUEPRINT':
      return [
        { label: '⚡ 强化核心冲突与代价', text: '请帮我评估当前故事前提的核心冲突，如何提高主角面临的危机与抉择代价？' },
        { label: '🎭 梳理主角欲望 (Want) 与阻力', text: '请基于主角设定，分析他的外在欲望、内在需求与最大的阻碍人物。' },
        { label: '📜 检查世界观设定漏洞', text: '请检查当前世界观设定中的运行规则，是否存在不合逻辑或与主线冲突的地方？' },
        { label: '💡 提炼一句话卖点 (Logline)', text: '请为这部作品提炼 3 个不同侧重点的一句话商业故事梗概 (Logline)。' }
      ];
    case 'OUTLINE':
      return [
        { label: '梳理故事因果', text: '请依据作者已有结构，检查主要事件、人物选择和结果之间的因果。结构不明确时提供可选建议。' },
        { label: '检查本集落点', text: '请检查当前集的结尾与整集推进是否连贯，给出不同的阶段性落点，不强制悬念。' },
        { label: '🔄 梳理副线与主线交织点', text: '请分析副线人物的行动，如何在关键时刻介入并推动主线危机发展？' }
      ];
    case 'BEATS':
    case 'SCENES':
      return [
        { label: '分析本场变化', text: '请分析本场行动、关系、信息或气氛如何变化，尊重留白，不强制反转。', target:'scene' },
        { label: '💥 强化开场切入与结尾抓手', text: '请建议如何“晚进早出”，让这场戏的第一句话和最后一个动作更有张力。', target:'scene' },
        { label: '⚖️ 校验场次节奏与信息密度', text: '请检查当前分场的事件量，是否存在过水或信息过载的问题？' }
      ];
    case 'BODY':
    default:
      return [
        { label: '✍️ 润色动作描写与潜台词', text: '请帮我优化本场正文的台词潜台词，减少直接说明，增加角色的试探与拉扯。' },
        { label: '🔍 检查视点与角色知情边界', text: '请检查本场角色的台词，确认他们没有说出超出当前时间线已知信息的话。' },
        { label: '⚡ 增强对白戏剧张力与节奏', text: '请针对当前对话，加快交锋节奏，增加语言动作和交锋的层次感。' }
      ];
  }
}
import { candidateIsOnlyChange, authorStillMatchesAdoption } from './scriptCandidateAdoption';
import type { AssistantRequest } from './scriptAssistantShortcuts';
import { hashValue, type AgentRun, type ExternalRequest } from '../../../../../packages/agent-core/src';
import type { BudgetSnapshot } from '../../../../../packages/agent-core/src/goals';
import { applyWorkspacePatch } from '../../../../../packages/script/src/workspacePatch';
import type { WorkspacePatchConflictView, WorkspacePatchResolution } from '../../../../../packages/script/src/workspacePatch';
import { exportText, scriptExportFilename, type ScriptExportFormat } from '../../../../../packages/script/src/exporters';
import { analyseTimeline } from '../../../../../packages/script/src/runtime';
import { unitContentHash } from '../../../../../packages/script/src/project';
import type { DeliveryUnit, Scene, ScriptProject } from '../../../../../packages/script/src/schema';
import type { AgentDraftOperation, ScriptDraftScope } from '../../../../../packages/script/src/agentScope';
import type { ScriptWorkspace } from '../../../../api/src/repositories/scriptWorkspaceStore';
import { scriptConversationClient, type ScriptConversationView } from '../../clients/scriptConversationClient';
import { scriptAgentClient, scriptClient, type ScriptAuthorCommand, type ScriptCandidateView, type ScriptCommandReceipt, type ScriptGoalView, type ScriptGoalExternalView, type ScriptInvocationView,
  type ScriptCommandSource, type ScriptChatTurnBody } from '../../clients/scriptClient';
import { useScriptSkills } from './useScriptSkills';
import { usePromptStore } from '../../clients/stateClient';
import {freezeStructureScope,structureNodeSceneIds} from '../../../../../packages/script/src/structure';
import {ScriptGoalProgress} from './components/ScriptGoalProgress';
import {inferDelegation,delegationCandidateKind,legacyTaskAnchor} from './scriptAssistantIntent';
import { newGoalSelection, goalStageTarget, goalRangeSnapshot, goalRangeChanged, goalRangeSupportsStage, goalReviewTarget, type GoalRange, type GoalRangeSnapshot } from './scriptGoalAuthoring';

import { goalActiveMessage, goalUnresolvedMessage, isUnresolvedGoal, isWorkingGoal } from './scriptGoalControl';

type PanelMode = 'manual'|'agent';
type Pending = {command:ScriptAuthorCommand;projectId:string};
const pendingKey=(projectId:string)=>`omni.script.durable.pending.${projectId}`;
type PendingChat = {threadId:string;body:ScriptChatTurnBody;composerContext?:AssistantRequest|null};
const pendingChatKey=(projectId:string)=>`omni.script.durable.chat.pending.${projectId}`;
type PendingChatWorkspace = {requestId:string;revision:number};
const pendingChatWorkspaceKey=(projectId:string)=>`omni.script.durable.chat.workspace.${projectId}`;
type PendingSync = {workspaceId:string;body:Parameters<typeof scriptAgentClient.syncAuthor>[1]};
// This is one outstanding adoption receipt, not a manuscript history. Its input
// lets acknowledgement recovery preserve edits made while the request was away.
type PendingAdoption = {projectId:string;workspaceId:string;proposal:{id:string;digest:string};requestId:string;authorBase?:ScriptProject};
type PendingBudget = {projectId:string;goalId:string;body:{requestId:string;expectedGoalVersion:number;expectedBudgetVersion:number;maxInvocations:number}};
type AdoptionReview = {outlineOnly?:boolean;workspaceId:string;workspaceRevision:number;authorRevision:number;
  proposal:{id:string;digest:string;document:ScriptProject}|null;conflicts:WorkspacePatchConflictView[];
  choices:Record<string,WorkspacePatchResolution['choice']>};
const pendingSyncKey=(projectId:string)=>`omni.script.durable.sync.pending.${projectId}`;
const pendingAdoptionKey=(projectId:string)=>`omni.script.durable.adoption.pending.${projectId}`;
const pendingBudgetKey=(projectId:string)=>`omni.script.durable.budget.pending.${projectId}`;
const budgetTiers=[80,160,320,640,1000];
const active=(run:AgentRun)=>['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL'].includes(run.status);
const operationOptions: Array<{id:AgentDraftOperation;label:string}> = [
  {id:'outline_development',label:'大纲、结构与节拍'}, {id:'story_outline',label:'当前故事大纲'}, {id:'season_outline',label:'本季大纲'}, {id:'append_scene_body',label:'继续本场正文'}, {id:'plan_structure',label:'幕／段落结构'},
  {id:'scene_body',label:'试写本场正文'}, {id:'replace_blocks',label:'改选中段落'},
  {id:'replace_selection',label:'改选中文字'}, {id:'plan_scenes',label:'补分场'},
  {id:'scene_plan',label:'本场规划与变化'}, {id:'unit_outline',label:'本集大纲'}, {id:'project_outline',label:'作品大纲'},
  {id:'concept',label:'故事构想'}, {id:'theme',label:'主题'},
  {id:'audienceExperience',label:'风格与观众感受'}, {id:'constraints',label:'作者要求'},
  {id:'update_character',label:'修改人物资料'}, {id:'update_fact',label:'修改故事设定'},
  {id:'add_character',label:'新增人物'}, {id:'add_fact',label:'新增设定'}, {id:'add_unit',label:'新增一集'},
];
const statusText:Record<AgentRun['status'],string>={QUEUED:'排队中',RUNNING:'执行中',WAITING_STEP:'等待步骤',WAITING_INPUT:'等待作者',WAITING_EXTERNAL:'等待手动回填',PAUSED:'已暂停',NEEDS_REBASE:'资料已变化',RECONCILIATION_REQUIRED:'结果待核对',SUCCEEDED:'已完成',PARTIAL:'部分完成',FAILED:'未完成',CANCELED:'已取消'};
const decisionInvalid=(run:AgentRun|undefined)=>run?.status==='PARTIAL'&&
  Boolean(run.result&&typeof run.result==='object'&&'reason' in run.result&&run.result.reason==='DECISION_INVALID');
const runStatusText=(run:AgentRun)=>decisionInvalid(run)?'决策格式无效，委托未完成':statusText[run.status];
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作未完成';
const rejected=(error:unknown)=>{const status=(error as {status?:number})?.status;return typeof status==='number'&&status>=400&&status<500;};
const sourceUnavailable=(error:unknown)=>{
  const value=error as {status?:number;code?:string};
  return value?.status===403||value?.status===404||
    /(?:REVOKED|SOURCE_INVALID|SCOPE_DENIED|PROJECT_NOT_FOUND|WORKSPACE_NOT_FOUND|POLICY_MISSING|MEMORY_STALE|MEMORY_NOT_FOUND|MEMORY_COLLECTION_CHANGED|MEMORY_SOURCE_RANGE_DENIED)/.test(value?.code||'');
};
const seconds=(ms:number)=>`${Number((ms/1000).toFixed(3))} 秒`;
const budgetTime=(ms:number)=>`${Math.floor(ms/3600000)} 小时 ${Math.floor(ms%3600000/60000)} 分钟`;

// Poll responses are JSON snapshots. Preserve identity only when every field
// matches, including revisions, redaction and pending requests. Unchanged polls
// must not rerender the entire manuscript and all its historical candidates.
function publishPollingSnapshot<T>(set:Dispatch<SetStateAction<T>>,next:T){
  set(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
}

/** Request ids identify button events, while restored composer drafts retain the
 * original event id. Every content, scope and permission field must still match. */
export function sameComposerRequest(left:AssistantRequest|null,right:AssistantRequest|null):boolean{
  if(!left||!right)return left===right;
  const {id:_leftId,...leftValue}=left,{id:_rightId,...rightValue}=right;
  return hashValue(leftValue)===hashValue(rightValue);
}
export function composerRequestDecision(text:string,context:AssistantRequest|null,next:AssistantRequest):'keep'|'queue'|'replace'{
  if(!text.trim())return 'replace';
  return text.trim()===next.text.trim()&&sameComposerRequest(context,next)?'keep':'queue';
}
export function queuedRequestAfterSend(queued:AssistantRequest|null,sentContext:AssistantRequest|null,sentText=sentContext?.text):AssistantRequest|null{
  return queued&&sentText!==undefined&&queued.text.trim()===sentText.trim()&&sameComposerRequest(queued,sentContext)?null:queued;
}
export function composerMatchesSentMessage(text:string,context:AssistantRequest|null,sentText:string,sentContext:AssistantRequest|null|undefined):boolean{
  return text.trim()===sentText.trim()&&(sentContext===undefined?context===null:sameComposerRequest(context,sentContext));
}

/** The two author modes share the same durable command/workspace/run surfaces.
 * The common sidebar owns one persistent chat across the four editing views. */
export function ScriptDurablePanel({visible=true,mode,project,unit,scene,dirty,onSave,onSaveForAction,onApplied,onOpenScene,onOpenUpdated,onOpenAnalysis,initialGoal,initialTask='WRITE',initialStage='BODY',initialOperation,request,onRequestAgent,onAgentStarted,onLegacyRequest,legacyContent,legacyHistory}:{
  visible?:boolean;
  onOpenAnalysis?:(entry:ScriptAnalysisEntry)=>void;
  request?:AssistantRequest|null;onRequestAgent?:()=>void;onAgentStarted?:()=>void;onLegacyRequest?:(request:AssistantRequest,channel:'api'|'external',methodIds:string[])=>void;legacyContent?:ReactNode;legacyHistory?:ReactNode;
  mode:PanelMode;project:ScriptProject;unit:DeliveryUnit;scene?:Scene;dirty:boolean;
  onSave:()=>Promise<void>;onSaveForAction?:()=>Promise<ScriptProject>;onApplied:(next:ScriptProject,base:ScriptProject,baselineTrusted?:boolean)=>void;
  onOpenScene:(unitId:string,sceneId:string,source?:AnalysisSceneSource)=>void;onOpenUpdated?:(target:ScriptUpdatedTarget)=>void;
  initialStage?:ScriptStage;initialGoal?:string;initialTask?:'WRITE'|'REVIEW';initialOperation?:AgentDraftOperation;initialInstruction?:string;initialSelection?:{start:number;end:number;text:string};
}){
  const [conversation,setConversation]=useState<ScriptConversationView|null>(null);
  const [workspaces,setWorkspaces]=useState<ScriptWorkspace[]>([]),[goals,setGoals]=useState<ScriptGoalView[]>([]);
  const [workspaceId,setWorkspaceId]=useState(''),[goalId,setGoalId]=useState('');
  const [planningRepairs,setPlanningRepairs]=useState<Record<string,PlanningRepairResult>>({});
  const [runs,setRuns]=useState<Record<string,AgentRun>>({}),[external,setExternal]=useState<Record<string,ExternalRequest[]>>({});
  const [goalExternalResult,setGoalExternal]=useState<{goalId:string;requests:ScriptGoalExternalView[]}|null>(null),[invocations,setInvocations]=useState<Record<string,ScriptInvocationView[]>>({});
  const [goalBudget,setGoalBudget]=useState<{goalId:string;budget:BudgetSnapshot}|null>(null);
  const {skills,error:skillsError,refresh:refreshSkills}=useScriptSkills();
  const [skillIds,setSkillIds]=useState<string[]>([]);
  const {isTestMode,channel,setChannel}=useScriptExecutionChannel();
  const [linkedGoalId,setLinkedGoalId]=useState('');
  const [operation,setOperation]=useState<AgentDraftOperation>(initialOperation||(initialStage==='BLUEPRINT'?'concept':initialStage==='OUTLINE'?'project_outline':(initialStage==='BEATS'||initialStage==='SCENES')?(scene?'scene_plan':'plan_scenes'):(scene?'scene_body':'plan_scenes')));
  const [objective,setObjective]=useState(initialGoal||''),[newScenes,setNewScenes]=useState(24),[newUnits,setNewUnits]=useState(0);
  const [stopAfter,setStopAfter]=useState<ScriptStage>(initialStage);
  const [goalRange,setGoalRange]=useState<GoalRange['kind']|'existing'>('unit');
  const [goalUnitId,setGoalUnitId]=useState(unit.id),[goalNodeId,setGoalNodeId]=useState(''),[goalOutlineScope,setGoalOutlineScope]=useState('');
  const [structureChanges,setStructureChanges]=useState<Array<{unitId:string;nodeId:string;title:string;before:string[];after:string[];hash:string}>>([]);
  const [goalSceneIds,setGoalSceneIds]=useState<string[]>(scene?[scene.id]:[]);
  const [includeProjectOutline,setIncludeProjectOutline]=useState(project.profile.organization==='standalone');
  const [goalTask,setGoalTask]=useState<'WRITE'|'REVIEW'>(initialTask);
  const [answerText,setAnswerText]=useState('');
  const settingsBaseline=useRef<(GoalRangeSnapshot&{goalId:string;revision:number;skillIds:string[];channel:'api'|'external';task:'WRITE'|'REVIEW';stopAfter:ScriptStage;includeProjectOutline:boolean;newScenes:number;newUnits:number})|null>(null);
  const defaultChatTarget: 'scene'|'unit'=scene&&(initialStage==='BODY'||initialOperation&&['scene_body','scene_plan','replace_blocks','replace_selection'].includes(initialOperation))?'scene':'unit';
  const [chatInput,setChatInput]=useState(()=>{try{return JSON.parse(localStorage.getItem(`omni.script.composer.${project.id}`)||'null')?.text||'';}catch{return '';}}),[chatTarget,setChatTarget]=useState<'scene'|'unit'>(defaultChatTarget),[externalText,setExternalText]=useState<Record<string,string>>({});
  const [chatContext,setChatContext]=useState<AssistantRequest|null>(()=>{try{return JSON.parse(localStorage.getItem(`omni.script.composer.${project.id}`)||'null')?.context||null;}catch{return null;}});
  const [queuedRequest,setQueuedRequest]=useState<AssistantRequest|null>(null);
  const composer=useRef<HTMLTextAreaElement>(null),messageEnd=useRef<HTMLDivElement>(null),resultRef=useRef<HTMLDivElement>(null);
  const handledRequest=useRef<number|undefined>(undefined);
  const adoptionAttempt=useRef('');
  const [reviewOpen,setReviewOpen]=useState(false);
  const [goalDetailsFor,setGoalDetailsFor]=useState('');
  const [historyOpen,setHistoryOpen]=useState(false);
  const [editGoalOpen,setEditGoalOpen]=useState(false);
  const [skillMenuOpen,setSkillMenuOpen]=useState(false);
  const skillMenuRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const dismiss=(event:PointerEvent)=>{
      if(skillMenuRef.current&&!skillMenuRef.current.contains(event.target as Node)){
        setSkillMenuOpen(false);
      }
    };
    if(skillMenuOpen){
      document.addEventListener('pointerdown',dismiss);
      return ()=>document.removeEventListener('pointerdown',dismiss);
    }
  },[skillMenuOpen]);
  const [allCandidates,setAllCandidates]=useState<ScriptCandidateView[]>([]);
  const [adoptionNotice,setAdoptionNotice]=useState('');
  const [updatedTarget,setUpdatedTarget]=useState<ScriptUpdatedTarget|null>(null);
  const [candidateAdoption,setCandidateAdoption]=useState<{candidateId:string;workspaceId:string;authorRevision:number;authorHash:string;outlineOnly?:boolean}|null>(()=>{try{return JSON.parse(localStorage.getItem(`omni.script.candidate-adopt.${project.id}`)||'null');}catch{return null;}});
  const clearCandidateAdoption=()=>{localStorage.removeItem(`omni.script.candidate-adopt.${project.id}`);setCandidateAdoption(null);};
  useEffect(()=>{
    try{
      const key=`omni.script.composer.${project.id}`;
      localStorage.setItem(key,JSON.stringify({text:chatInput,context:chatContext}));
    }catch{setError('输入草稿暂时无法保存，请复制保留。');}
  },[chatInput,chatContext,project.id]);
  const useRequest=(next:AssistantRequest)=>{setChatInput(next.text);setChatContext(next);setQueuedRequest(null);requestAnimationFrame(()=>composer.current?.focus());};
  const queueRequest=(next:AssistantRequest)=>{
    const decision=composerRequestDecision(chatInput,chatContext,next);
    if(decision==='queue')setQueuedRequest(next);
    else if(decision==='replace')useRequest(next);
    else setQueuedRequest(old=>queuedRequestAfterSend(old,next));
  };
  useEffect(()=>{
    if(!request||handledRequest.current===request.id)return;
    handledRequest.current=request.id;
    queueRequest(request);
  },[request]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[lastRunId,setLastRunId]=useState('');
  const [adoptionReview,setAdoptionReview]=useState<AdoptionReview|null>(null);
  const [exportFormat,setExportFormat]=useState<ScriptExportFormat>('fountain'),[exportUnitId,setExportUnitId]=useState('all');
  const [fixedExport,setFixedExport]=useState<{workspaceId:string;revision:number;title:string;format:ScriptExportFormat;
    ref:Awaited<ReturnType<typeof scriptAgentClient.exportWorkspace>>['ref'];unitIds:string[];text:string}|null>(null);
  const alive=useRef(true),mutation=useRef(false),refreshSerial=useRef(0),current=useRef({project,dirty});current.current={project,dirty};
  const selections=useRef({workspaceId,goalId,lastRunId});selections.current={workspaceId,goalId,lastRunId};
  const actionSnapshot={chatInput,chatContext,unitId:unit.id,sceneId:scene?.id,initialStage,objective,goalUnitId,goalRange,goalNodeId,goalOutlineScope,goalSceneIds,goalTask,newUnits,newScenes,includeProjectOutline,channel,skillIds,stopAfter};
  const actionState=useRef(actionSnapshot);actionState.current=actionSnapshot;
  const clearSentComposer=(text:string,context:AssistantRequest|null|undefined)=>{
    const state=actionState.current;
    if(composerMatchesSentMessage(state.chatInput,state.chatContext,text,context)){setChatInput('');setChatContext(null);}
    // Older durable records lack a composer identity. Keep an explicitly scoped
    // draft and pending shortcut rather than infer scope from matching text.
    if(context!==undefined)setQueuedRequest(old=>queuedRequestAfterSend(old,context,text));
  };
  const openedThread=useRef('');
  const threadId=conversation?.id;
  const selectedWorkspace=workspaces.find(item=>item.id===workspaceId);
  const currentAdoption=adoptionReview&&selectedWorkspace&&adoptionReview.workspaceId===selectedWorkspace.id&&
    adoptionReview.workspaceRevision===selectedWorkspace.revision&&adoptionReview.authorRevision===project.revision?adoptionReview:null;
  const adoption=currentAdoption?.proposal;
  const selectedGoal=goals.find(item=>item.id===goalId);
  const goalExternal=goalExternalResult?.goalId===goalId?goalExternalResult.requests:[];
  const selectedGoalWorkspace=selectedGoal?workspaces.find(item=>item.id===selectedGoal.workspaceId):undefined;
  const goalReadIdentity=selectedGoal&&!selectedGoal.redacted?`${project.id}:${selectedGoal.id}`:null;
  const goalReadKey=goalReadIdentity?`${goalReadIdentity}:${selectedGoal?.version}:${selectedGoalWorkspace?.revision}`:null;
  // Historical evidence validates the full source graph. Read it immediately
  // when the goal/workspace changes, then revalidate once a minute. Run state
  // and pending requests keep their independent three-second fresh reads.
  const goalReadInterval=60000;
  const detailsWanted=(Boolean(goalId)&&goalDetailsFor===goalId)||(reviewOpen&&workspaceId===selectedGoal?.workspaceId);
  // The detailed review already contains progress. One same-goal flight serves
  // both views; opening details retires a summary read before starting another.
  const evidenceRead=useGoalPollingRead(visible&&!busy&&goalReadKey?`${goalReadKey}:${detailsWanted?'details':'progress'}`:null,async()=>{
    if(detailsWanted){const review=await scriptAgentClient.goalReview(goalId);return {progress:review,details:review};}
    return {progress:await scriptAgentClient.goalProgress(goalId),details:null};
  },goalReadIdentity,goalReadInterval);
  // Budget is inexpensive and must not wait for the historical evidence graph.
  const budgetRead=useGoalPollingRead(visible&&detailsWanted&&!busy?goalReadKey:null,()=>scriptAgentClient.goalBudget(goalId),goalReadIdentity,3000);
  const progressRead={value:evidenceRead.value?.progress,error:evidenceRead.error};
  const detailsRead={value:evidenceRead.value?.details?{review:evidenceRead.value.details}:null,
    error:evidenceRead.error||budgetRead.error,loading:detailsWanted&&(evidenceRead.loading||budgetRead.loading)};
  const goalEvidenceUnavailable=Boolean(selectedGoal?.redacted||progressRead.value?.redacted||progressRead.error||
    detailsRead.value?.review.redacted||(detailsRead.error&&sourceUnavailable(detailsRead.error)));
  // A failed/revoked summary cannot leave older detailed evidence visible.
  const selectedReview=selectedGoal?.redacted||progressRead.value?.redacted?{redacted:true,review:null}:progressRead.error?null:detailsRead.value?.review;
  const readBudget=progressRead.error||progressRead.value?.redacted||budgetRead.error?undefined:budgetRead.value?.budget;
  const selectedBudget=readBudget&&goalBudget?.goalId===goalId&&goalBudget.budget.version>readBudget.version?goalBudget.budget:readBudget;
  const nextBudgetTier=selectedBudget?budgetTiers.find(value=>value>selectedBudget.limits.maxInvocations):undefined;
  const authorAhead=(workspace:ScriptWorkspace|undefined)=>Boolean(workspace?.projectId===project.id&&workspace.baseProjectRevision!==null&&workspace.baseProjectRevision<project.revision);
  const syncTarget=authorAhead(selectedGoalWorkspace)?selectedGoalWorkspace:selectedWorkspace;
  const unresolvedGoal=Object.values(runs).find(isUnresolvedGoal);
  const workingGoal=Object.values(runs).find(isWorkingGoal);
  const goalRun=selectedGoal?runs[selectedGoal.activeRunId||selectedGoal.lastRunId]:undefined;
  const manualRun=runs[lastRunId]?.kind==='CAPABILITY'?runs[lastRunId]:undefined;
  const run=mode==='manual'?runs[lastRunId]||goalRun:goalRun||runs[lastRunId];
  const goalOperations=(selectedGoal?.revision.contract.value as {scope?:{operations?:string[]}}|undefined)?.scope?.operations||[];
  const goalTargetIds=(selectedGoal?.revision.contract.value as {checks?:{targetUnitIds?:string[]}}|undefined)?.checks?.targetUnitIds||[];
  const goalUnit=project.units.find(item=>item.id===goalUnitId)||unit;
  const rangeUnit=(editGoalOpen?selectedGoalWorkspace?.document??project:project).units.find(item=>item.id===goalUnit.id);
  const progressScope=(selectedGoal?.revision.contract.value as {scope?:ScriptDraftScope}|undefined)?.scope;
  const progressDocument=selectedGoalWorkspace?.document||project;
  const progressSceneScope:Record<string,string[]|null>=Object.fromEntries([...(progressScope?.units||[]).map(grant=>{const target=progressDocument.units.find(item=>item.id===grant.unitId);return [grant.unitId,grant.allowAllScenes?null:[...new Set([...grant.scenes.map(item=>item.sceneId),...(grant.nodeScopes||[]).flatMap(node=>target?.structureNodes?.some(item=>item.id===node.nodeId)?structureNodeSceneIds(target,node.nodeId):[])])]];}),...(progressScope?.newUnitSlots||[]).map(slot=>[slot.unitId,null])]);
  const selectedCheckScenes=(selectedGoal?.revision.contract.value as {checks?:{targetScenes?:Array<{unitId:string;sceneIds:string[]}>}}|undefined)?.checks?.targetScenes;
  const selectedStage=(selectedGoal?.revision.contract.value as {stopAfter?:ScriptStage}|undefined)?.stopAfter;
  const goalTiming=useMemo(()=>(!isPlanningStage(selectedStage)?selectedGoalWorkspace:undefined)?.document.units.filter(item=>goalTargetIds.includes(item.id)).map(item=>{
    const document=selectedGoalWorkspace.document,contentHash=unitContentHash(document,item);
    const effectiveToleranceMs=Math.min(document.profile.toleranceMs,item.targetDurationMs);
    const current=item.timingEvidence.filter(evidence=>evidence.contentHash===contentHash);
    const estimate=current.filter(evidence=>evidence.kind==='estimate').at(-1);
    const preview=current.filter(evidence=>evidence.kind==='preview'&&evidence.source==='synthetic').at(-1);
    const measured=current.filter(evidence=>evidence.source==='ffprobe').at(-1);
    let plannedCoverage:number|null=null;
    try{plannedCoverage=analyseTimeline(item.timeline,item.targetDurationMs,contentHash,
      {includeCredits:document.profile.includeCredits,toleranceMs:effectiveToleranceMs}).coverageMs;}catch{}
    return {unit:item,estimate,preview,measured,plannedCoverage,toleranceMs:effectiveToleranceMs};
  })||[],[selectedStage,selectedGoalWorkspace?.document,selectedGoal?.revision.contract]);
  const mayLink=Boolean(selectedGoal&&goalRun&&selectedWorkspace?.id===selectedGoal.workspaceId&&
    ['PAUSED','WAITING_INPUT','NEEDS_REBASE'].includes(goalRun.status)&&goalOperations.includes(operation));
  const manualGoal=linkedGoalId===selectedGoal?.id&&mayLink&&selectedGoal?{goalId:selectedGoal.id,expectedGoalVersion:selectedGoal.version}:undefined;
  const source=():ScriptCommandSource=>{
    if(selectedWorkspace){
      if(authorAhead(selectedWorkspace))throw new Error('当前稿已有修改，先将改稿同步到工作稿，再继续生成。');
      return {kind:'WORKSPACE',workspaceId:selectedWorkspace.id,expectedRevision:selectedWorkspace.revision};
    }
    return {kind:'PROJECT',projectId:project.id,revision:project.revision,contentHash:hashValue(project)};
  };
  const workspaceSnapshots=useRef<ScriptWorkspace[]>([]);
  const pollingView=useRef({visible,mustFinish:false});pollingView.current={visible,mustFinish:Boolean(candidateAdoption||busy)};
  const wakePolling=useRef<(()=>void)|null>(null);
  const refreshFlight=useRef<Promise<void>|null>(null);
  const readRefresh=async(thread:string,includeConversation=true)=>{
    const serial=++refreshSerial.current;
    try{
    // SQLite validates these reads synchronously. Leave a request boundary
    // between them so another page is not queued behind the whole poll burst.
    const conversationResponse=includeConversation?await scriptConversationClient.get(thread,'state'):null;
    if(!alive.current||serial!==refreshSerial.current)return;
    const workspaceResponse=await scriptAgentClient.workspaceState(thread,project.id,workspaceSnapshots.current);
    if(!alive.current||serial!==refreshSerial.current)return;
    const goalResponse=await scriptAgentClient.goals(thread);
    if(!alive.current||serial!==refreshSerial.current)return;
    const runResponse=await scriptAgentClient.runs(thread);
    if(!alive.current||serial!==refreshSerial.current)return;
    if(conversationResponse)publishPollingSnapshot(setConversation,conversationResponse.conversation);
    const related=workspaceResponse.workspaces.filter(item=>item.threadId===thread&&item.documentId===project.id);
    workspaceSnapshots.current=related;
    setWorkspaces(previous=>previous.length===related.length&&previous.every((item,index)=>item===related[index])?previous:related);setWorkspaceId(old=>related.some(item=>item.id===old)?old:related[0]?.id||'');
    const rows=goalResponse.goals.filter(item=>related.some(workspace=>workspace.id===item.workspaceId)).reverse();
    publishPollingSnapshot(setGoals,rows);setGoalId(old=>rows.some(item=>item.id===old)?old:rows[0]?.id||'');
    const relatedIds=new Set(related.map(item=>item.id));
    const runViews=runResponse.runs.filter(item=>relatedIds.has(item.workspaceId));
    const manualRuns=runViews.filter(item=>!item.goalId&&item.run.kind==='CAPABILITY');
    const lastManual=manualRuns.at(-1)?.run.id;
    if(lastManual&&!runViews.some(item=>item.run.id===selections.current.lastRunId)){
      selections.current.lastRunId=lastManual;setLastRunId(lastManual);
    }
    const selectedManualId=selections.current.lastRunId||lastManual;
    const toInspect=runViews.filter(item=>item.run.id===selectedManualId||active(item.run)||item.run.status==='RECONCILIATION_REQUIRED');
    const selectedGoalId=rows.find(item=>item.id===selections.current.goalId)?.id||rows[0]?.id;
    // Selected-goal WAITING requests are read once by goalExternal below. Its
    // linked runs already have fresh lifecycle state in the authorized run list.
    const goalRunIds=new Set(runViews.filter(item=>item.goalId===selectedGoalId&&selectedGoalId).map(item=>item.run.id));
    const runRequests=toInspect.filter(item=>!goalRunIds.has(item.run.id));
    const chatRunIds=[...new Set<string>((conversationResponse?.conversation.turns||conversation?.turns||[])
      .filter(turn=>['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','PAUSED','RECONCILIATION_REQUIRED'].includes(turn.status))
      .map(turn=>turn.runId))].filter(id=>!goalRunIds.has(id)&&!runRequests.some(item=>item.run.id===id));
    const [runRows,chatRunRows]=await Promise.all([
      Promise.all(runRequests.map(item=>scriptAgentClient.run(item.run.id).catch(cause=>{if(sourceUnavailable(cause))throw cause;return null;}))),
      Promise.all(chatRunIds.map(id=>scriptAgentClient.run(id).then(result=>({id,result})).catch(cause=>{if(sourceUnavailable(cause))throw cause;return null;}))),
    ]);
    const [goalRequests,unknownRows,candidateResults]=await Promise.all([
      selectedGoalId?scriptAgentClient.goalExternal(selectedGoalId):Promise.resolve({externalRequests:[] as ScriptGoalExternalView[]}),
      Promise.all(toInspect.filter(item=>item.run.status==='RECONCILIATION_REQUIRED').map(item=>scriptAgentClient.invocations(item.run.id).then(value=>({id:item.run.id,rows:value.invocations})))),
      scriptAgentClient.candidateBatch(thread,project.id,related.map(workspace=>workspace.id))
    ]);
    if(!alive.current||serial!==refreshSerial.current)return;
    const nextRuns:Record<string,AgentRun>={},nextExternal:Record<string,ExternalRequest[]>={};
    runViews.forEach(item=>{nextRuns[item.run.id]=item.run;});
    runRows.forEach((item,index)=>{if(item){nextRuns[runRequests[index].run.id]=item.run;nextExternal[runRequests[index].run.id]=item.externalRequests;}});
    chatRunRows.forEach(item=>{if(item){nextRuns[item.id]=item.result.run;nextExternal[item.id]=item.result.externalRequests;}});
    goalRequests.externalRequests.forEach(item=>{(nextExternal[item.runId]??=[]).push(item.request);});
    publishPollingSnapshot(setRuns,nextRuns);publishPollingSnapshot(setExternal,nextExternal);publishPollingSnapshot(setPlanningRepairs,Object.fromEntries(runViews.filter(item=>item.planningRepair).map(item=>[item.run.id,item.planningRepair!])));
    publishPollingSnapshot(setGoalExternal,selectedGoalId?{goalId:selectedGoalId,requests:goalRequests.externalRequests}:null);
    publishPollingSnapshot(setInvocations,Object.fromEntries(unknownRows.map(item=>[item.id,item.rows])));
    publishPollingSnapshot(setAllCandidates,candidateResults.candidates);
    }catch(cause){
      if(alive.current&&serial===refreshSerial.current)setGoalBudget(null);
      if(alive.current&&serial===refreshSerial.current&&sourceUnavailable(cause)){
        ++refreshSerial.current;
        workspaceSnapshots.current=[];setWorkspaces([]);setWorkspaceId('');setGoals([]);setGoalId('');setRuns({});setExternal({});
        setGoalExternal(null);setGoalBudget(null);setInvocations({});setAllCandidates([]);setAdoptionReview(null);
        setFixedExport(null);setExternalText({});setConversation(null);
      }
      throw cause;
    }
  };
  const refresh=(thread:string,includeConversation=true)=>{
    if(refreshFlight.current)return refreshFlight.current;
    const request=readRefresh(thread,includeConversation);
    refreshFlight.current=request;
    const clear=()=>{if(refreshFlight.current===request)refreshFlight.current=null;};
    void request.then(clear,clear);
    return request;
  };
  useEffect(()=>{
    // A retired async mount must not reuse the next mount's shared alive flag.
    alive.current=true;let canceled=false,ready=false,polling=false,timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{if(!canceled&&alive.current){if(timer)clearTimeout(timer);timer=setTimeout(poll,3000);}};
    const poll=async()=>{
      if(canceled||!alive.current||!ready||polling)return;
      if(mutation.current||refreshFlight.current){schedule();return;}
      // Background generation lives on the server. Hidden UI need not repeatedly
      // read every result, but an author adoption already in progress must finish.
      if((!pollingView.current.visible||document.hidden)&&!pollingView.current.mustFinish){schedule();return;}
      polling=true;
      try{const thread=openedThread.current;if(thread)await refresh(thread);}catch(cause){if(!canceled&&alive.current)setError(errorText(cause));}
      finally{polling=false;schedule();}
    };
    const wake=()=>{if(timer)clearTimeout(timer);void poll();};
    wakePolling.current=wake;
    document.addEventListener('visibilitychange',wake);
    void (async()=>{
      try{
        const opened=await scriptConversationClient.open([],`script-project-${project.id}`,'state');
        if(canceled||!alive.current)return;
        setConversation(opened.conversation);openedThread.current=opened.conversation.id;
        const saved=localStorage.getItem(pendingKey(project.id));
        if(saved){
          try{
            const pending=JSON.parse(saved) as Pending;
            if(pending.projectId!==project.id||pending.command.threadId!==opened.conversation.id)throw new Error('待确认命令与当前作品不一致；本地记录已保留。');
            const receipt=await scriptAgentClient.submit(pending.command);
            localStorage.removeItem(pendingKey(project.id));setLastRunId(receipt.runId);selections.current.lastRunId=receipt.runId;
          }catch(cause){if(rejected(cause))localStorage.removeItem(pendingKey(project.id));setError(errorText(cause));}
        }
        const savedChat=localStorage.getItem(pendingChatKey(project.id));
        if(savedChat){
          try{
            const pending=JSON.parse(savedChat) as PendingChat;
            if(pending.threadId!==opened.conversation.id||!pending.body?.requestId)throw new Error('待确认消息与当前作品对话不一致；本地记录已保留。');
            const reply=await scriptAgentClient.sendChatTurn(pending.threadId,pending.body);
            localStorage.removeItem(pendingChatKey(project.id));setConversation(reply.conversation);clearSentComposer(pending.body.text,pending.composerContext);
          }catch(cause){if(rejected(cause))localStorage.removeItem(pendingChatKey(project.id));setError(errorText(cause));}
        }
        const savedSync=localStorage.getItem(pendingSyncKey(project.id));
        if(savedSync){
          try{
            const pending=JSON.parse(savedSync) as PendingSync;
            if(!pending.workspaceId||!pending.body?.requestId)throw new Error('待确认同步记录无法读取；本地记录已保留。');
            await scriptAgentClient.syncAuthor(pending.workspaceId,pending.body);
            localStorage.removeItem(pendingSyncKey(project.id));
          }catch(cause){if(rejected(cause))localStorage.removeItem(pendingSyncKey(project.id));setError(errorText(cause));}
        }
        const savedAdoption=localStorage.getItem(pendingAdoptionKey(project.id));
        if(savedAdoption){
          try{
            const pending=JSON.parse(savedAdoption) as PendingAdoption;
            if(pending.projectId!==project.id||!pending.workspaceId||!pending.proposal?.id||!pending.requestId)
              throw new Error('待确认采用记录与当前作品不一致；本地记录已保留。');
            await completeAdoption(pending);
          }catch(cause){setError(errorText(cause));}
        }
        const savedBudget=localStorage.getItem(pendingBudgetKey(project.id));
        if(savedBudget){
          try{
            const pending=JSON.parse(savedBudget) as PendingBudget;
            if(pending.projectId!==project.id||!pending.goalId||!pending.body?.requestId)
              throw new Error('待确认额度调整记录与当前作品不一致；本地记录已保留。');
            const result=await scriptAgentClient.increaseGoalBudget(pending.goalId,pending.body);
            localStorage.removeItem(pendingBudgetKey(project.id));setGoalBudget({goalId:pending.goalId,budget:result.budget});
          }catch(cause){if(rejected(cause))localStorage.removeItem(pendingBudgetKey(project.id));setError(errorText(cause));}
        }
      }catch(cause){if(!canceled&&alive.current)setError(errorText(cause));}
      ready=true;await poll();
    })();
    return()=>{canceled=true;alive.current=false;++refreshSerial.current;if(timer)clearTimeout(timer);
      document.removeEventListener('visibilitychange',wake);if(wakePolling.current===wake)wakePolling.current=null;};
  },[project.id]);
  useEffect(()=>{wakePolling.current?.();},[visible]);
  openedThread.current=threadId||openedThread.current;
  useEffect(()=>{setOperation(initialOperation||(initialStage==='BLUEPRINT'?'concept':initialStage==='OUTLINE'?'project_outline':(initialStage==='BEATS'||initialStage==='SCENES')?(scene?'scene_plan':'plan_scenes'):(scene?'scene_body':'plan_scenes')));},[scene?.id,unit.id,initialOperation,initialStage]);
  useEffect(()=>{if(initialGoal){setObjective(initialGoal);setGoalUnitId(unit.id);}},[initialGoal]);
  useEffect(()=>{setGoalTask(initialTask);},[initialTask]);
  useEffect(()=>{
    if(!selectedGoal||!selectedGoalWorkspace)return;
    const contract=selectedGoal.revision.contract.value as {scope:ScriptDraftScope;task:string;stopAfter?:ScriptStage};
    const pending=contract.scope.newUnitSlots.filter(slot=>!selectedGoalWorkspace.document.units.some(item=>item.id===slot.unitId));
    const frozenIds=(selectedGoal.revision.skillManifest as Array<{id:string}>).map(method=>method.id.replace(/^skill:/,''));
    const range=goalRangeSnapshot(contract.scope);
    const next={goalId:selectedGoal.id,revision:selectedGoal.activeRevision,skillIds:frozenIds,channel:selectedGoal.revision.route.channel,
      ...range,
      includeProjectOutline:contract.scope.sharedFields.includes('outline'),stopAfter:contract.stopAfter||'BODY',task:contract.task==='REVIEW'?'REVIEW' as const:'WRITE' as const,
      newScenes:Math.max(1,pending[0]?.maxNewScenes??(contract.scope.units[0]
        ?contract.scope.units[0].maxNewScenes+(selectedGoal.createdSceneCounts?.[contract.scope.units[0].unitId]??0):4)),newUnits:pending.length};
    if(range.unitId)setGoalUnitId(range.unitId);
    setGoalNodeId(range.nodeId);setGoalOutlineScope(range.outlineScope);
    settingsBaseline.current=next;setSkillIds(next.skillIds);setChannel(next.channel);setGoalTask(next.task);setStopAfter(next.stopAfter);setIncludeProjectOutline(next.includeProjectOutline);
    setGoalRange(next.rangeKind);setGoalSceneIds(next.sceneIds);
    setNewScenes(Math.max(1,next.newScenes));setNewUnits(next.newUnits);setObjective(selectedGoal.revision.objective);
  },[selectedGoal?.id,selectedGoal?.activeRevision,Boolean(selectedGoalWorkspace)]);
  useEffect(()=>{if(!selectedGoal)setStopAfter(initialStage);},[initialStage,selectedGoal?.id]);
  useEffect(()=>{setChatTarget(defaultChatTarget);},[scene?.id,unit.id,initialStage,initialOperation]);
  useEffect(()=>{setAnswerText('');},[selectedGoal?.pendingQuestion?.decisionId]);
  useEffect(()=>{if(mode==='agent'&&selectedGoal)setWorkspaceId(selectedGoal.workspaceId);},[mode,selectedGoal?.id,selectedGoal?.workspaceId]);
  useEffect(()=>{setLinkedGoalId('');},[goalId,workspaceId,operation]);
  const execute=async(action:()=>Promise<void>,refreshAfter=true)=>{
    if(mutation.current)return;
    mutation.current=true;setBusy(true);setError('');
    try{
      await action();
      if(refreshAfter&&threadId){
        // A read started before the command is not its receipt. Retire it,
        // drain that one flight, then obtain a fresh authorized snapshot.
        ++refreshSerial.current;
        await refreshFlight.current?.catch(()=>{});
        if(alive.current&&openedThread.current===threadId)await refresh(threadId);
      }
    }catch(cause){setError(errorText(cause));}
    finally{mutation.current=false;if(alive.current)setBusy(false);}
  };
  const submit=async(command:ScriptAuthorCommand):Promise<ScriptCommandReceipt>=>{
    const old=localStorage.getItem(pendingKey(project.id));
    if(old)throw new Error('上一项命令的接收状态未确定；请刷新恢复。');
    localStorage.setItem(pendingKey(project.id),JSON.stringify({projectId:project.id,command} satisfies Pending));
    try{const receipt=await scriptAgentClient.submit(command);localStorage.removeItem(pendingKey(project.id));setLastRunId(receipt.runId);selections.current.lastRunId=receipt.runId;
      selections.current.workspaceId=receipt.workspaceId;setWorkspaceId(receipt.workspaceId);
      if(receipt.goalId){selections.current.goalId=receipt.goalId;setGoalId(receipt.goalId);}return receipt;
    }catch(cause){if(rejected(cause))localStorage.removeItem(pendingKey(project.id));throw cause;}
  };
  const recoverPending=()=>execute(async()=>{
    const saved=localStorage.getItem(pendingKey(project.id));if(!saved)throw new Error('没有待确认的命令');
    const pending=JSON.parse(saved) as Pending;
    if(pending.projectId!==project.id||pending.command.threadId!==threadId)throw new Error('待确认命令与当前会话不一致');
    let receipt:ScriptCommandReceipt;
    try{receipt=await scriptAgentClient.submit(pending.command);}
    catch(cause){if(rejected(cause))localStorage.removeItem(pendingKey(project.id));throw cause;}
    localStorage.removeItem(pendingKey(project.id));setLastRunId(receipt.runId);selections.current.lastRunId=receipt.runId;
    selections.current.workspaceId=receipt.workspaceId;setWorkspaceId(receipt.workspaceId);
    if(receipt.goalId){selections.current.goalId=receipt.goalId;setGoalId(receipt.goalId);}
  });
  const common=()=>{
    if(!conversation)throw new Error('对话尚未加载');
    return {requestId:crypto.randomUUID(),threadId:conversation.id,expectedConversationVersion:conversation.version,executionChannel:channel};
  };
  const startPlanningRepair=(target:PlanningRepairTarget,instruction:string)=>execute(async()=>{
    const before=current.current.project.id;let author=current.current.project;
    if(current.current.dirty){if(!onSaveForAction)throw new Error('请先保存当前稿');author=await onSaveForAction();}
    if(current.current.project.id!==before)throw new Error('作品已切换，请在当前作品重新选择范围');
    await submit({...common(),kind:'PLANNING_REPAIR',source:{kind:'PROJECT',projectId:author.id,revision:author.revision,contentHash:hashValue(author)},
      target,instruction,methodIds:skillIds});
    setReviewOpen(false);
  });
  const analysisActions=useRef({onRequest:queueRequest,onRepair:startPlanningRepair});
  analysisActions.current={onRequest:next=>{queueRequest(next);requestAnimationFrame(()=>requestAnimationFrame(()=>composer.current?.focus({preventScroll:true})));},onRepair:startPlanningRepair};
  const rangeSelection=():GoalRange=>{
    if(newUnits>0)return {kind:'unit'};
    if(goalRange==='existing')throw new Error('新委托请明确选择本次范围；继续原委托可使用下方继续按钮。');
    if(goalRange==='node')return {kind:'node',nodeId:goalNodeId};
    if(goalRange==='story')return {kind:'story',scopeId:goalOutlineScope||goalUnit.scopeId};
    if(goalRange==='season')return {kind:'season',seasonId:goalOutlineScope||goalUnit.scopeId};
    return goalRange==='scenes'?{kind:'scenes',sceneIds:goalSceneIds}:{kind:goalRange};
  };
  const startGoal=()=>execute(async()=>{
    const startState=actionState.current;let author=current.current.project;
    if(current.current.dirty){if(!onSaveForAction)throw new Error('请先保存当前稿');author=await onSaveForAction();if(hashValue(actionState.current)!==hashValue(startState))throw new Error('保存期间委托或输入位置改变，请确认后重新开始。');}
    if(!objective.trim())throw new Error('写下这次委托的目标');
    const targetUnit=author.units.find(item=>item.id===goalUnitId);if(!targetUnit)throw new Error('委托目标已删除');
    const selection=newGoalSelection(author,targetUnit,undefined,goalTask,newUnits,newScenes,stopAfter,includeProjectOutline,rangeSelection());
    await submit({...common(),kind:'GOAL_START',source:{kind:'PROJECT',projectId:author.id,revision:author.revision,contentHash:hashValue(author)},objective:objective.trim(),task:goalTask,...(goalTask==='WRITE'?{stopAfter}:{}),...selection,methodIds:skillIds});
    clearSentComposer(objective,startState.chatContext);
    setReviewOpen(false);setEditGoalOpen(false);onAgentStarted?.();
  });
  const continueGoal=(revise:boolean)=>execute(async()=>{
    if(!selectedGoal||!goalRun||!selectedGoalWorkspace)throw new Error('委托尚未加载');
    if(active(goalRun))throw new Error('请先暂停当前委托，再保存并继续。');
    if(!revise&&selectedGoal.revision.route.channel==='external'&&!isTestMode)throw new Error('此委托使用测试回填，请开启测试模式，或在调整委托中改用 API。');
    const state=actionState.current;let author=current.current.project;
    if(current.current.dirty){if(!onSaveForAction)throw new Error('请先保存当前稿');author=await onSaveForAction();if(hashValue(actionState.current)!==hashValue(state))throw new Error('保存期间输入或目标改变，请重新确认委托。');}
    let {goal:liveGoal,run:liveRun}=await scriptAgentClient.goal(selectedGoal.id);
    let workspace=(await scriptAgentClient.workspace(liveGoal.workspaceId)).workspace;
    if(active(liveRun))throw new Error('委托已在其他位置恢复，请先暂停。');
    const scope=(liveGoal.revision.contract.value as {scope:ScriptDraftScope}).scope;
    if(workspace.baseProjectRevision!==null&&workspace.baseProjectRevision<author.revision){
      const original=(await scriptAgentClient.authorBaseline(workspace.id)).document;
      if(!original)throw new Error('工作稿缺少同步依据，请重新从当前稿发起委托。');
      const differences=scope.units.flatMap(grant=>(grant.nodeScopes||[]).flatMap(node=>{
        try{const prior=freezeStructureScope(original,grant.unitId,node.nodeId),next=freezeStructureScope(author,grant.unitId,node.nodeId);
          if(prior.structureHash===next.structureHash&&prior.outlineHash===next.outlineHash)return [];
          const target=author.units.find(item=>item.id===grant.unitId)!;
          return [{unitId:grant.unitId,nodeId:node.nodeId,title:target.structureNodes?.find(item=>item.id===node.nodeId)?.title||'原段落',before:prior.sceneIds,after:next.sceneIds,hash:hashValue(next)}];
        }catch{return [{unitId:grant.unitId,nodeId:node.nodeId,title:'已删除的原段落',before:node.sceneIds,after:[],hash:'deleted'}];}
      }));
      if(differences.length&&(!revise||hashValue(differences)!==hashValue(structureChanges))){
        setStructureChanges(differences);setGoalUnitId(differences[0].unitId);setGoalNodeId(differences[0].nodeId);setGoalRange('node');setEditGoalOpen(true);
        throw new Error('段落成员、场序或大纲已改变，请核对范围差异，再确认新范围继续。');
      }
      if(localStorage.getItem(pendingSyncKey(project.id)))throw new Error('上次同步尚未确认，请先核对结果。');
      const writer=workspace.writerRunId?(await scriptAgentClient.run(workspace.writerRunId)).run:null;
      if(writer&&active(writer))throw new Error('工作稿仍有任务运行，请先暂停。');
      const pending:PendingSync={workspaceId:workspace.id,body:{requestId:crypto.randomUUID(),expectedRevision:workspace.revision,expectedEpoch:workspace.writerEpoch,expectedAuthorRevision:author.revision,...(writer?{takeover:{runId:writer.id,expectedVersion:writer.version}}:{})}};
      localStorage.setItem(pendingSyncKey(project.id),JSON.stringify(pending));
      try{workspace=(await scriptAgentClient.syncAuthor(workspace.id,pending.body)).workspace;localStorage.removeItem(pendingSyncKey(project.id));}
      catch(cause){if(rejected(cause))localStorage.removeItem(pendingSyncKey(project.id));
        const comparison=await scriptAgentClient.prepareAdoption(workspace,author.revision).catch(()=>null);
        if(comparison){setWorkspaceId(workspace.id);setAdoptionReview({workspaceId:workspace.id,workspaceRevision:workspace.revision,authorRevision:author.revision,proposal:comparison.proposal,conflicts:comparison.conflicts,choices:{}});setReviewOpen(true);setEditGoalOpen(false);}
        throw new Error('作者稿与工作稿需要比较，已保留两份内容；解决冲突后再继续。');
      }
      ({goal:liveGoal,run:liveRun}=await scriptAgentClient.goal(selectedGoal.id));
    }
    if(current.current.dirty||current.current.project.revision!==author.revision||hashValue(current.current.project)!==hashValue(author))throw new Error('同步期间作者稿又有修改，请保存后重新继续。');
    const changes:Partial<Extract<ScriptAuthorCommand,{kind:'GOAL_CONTINUE'|'GOAL_REVISE'}>>={};
    if(revise){
      changes.objective=objective.trim();const before=settingsBaseline.current;
      if(!before||before.goalId!==selectedGoal.id||before.revision!==selectedGoal.activeRevision)throw new Error('委托设置尚未加载');
      if(hashValue(skillIds)!==hashValue(before.skillIds))changes.methodIds=skillIds;
      if(channel!==before.channel)changes.executionChannel=channel;
      const changedRange=structureChanges.length>0||goalRangeChanged(before,{rangeKind:goalRange,unitId:goalUnitId,nodeId:goalNodeId,outlineScope:goalOutlineScope||goalUnit.scopeId,sceneIds:goalSceneIds})||newUnits!==before.newUnits;
      if(changedRange||goalTask!==before.task){
        const selected=author.units.find(item=>item.id===goalUnitId);if(!selected)throw new Error('目标单元已删除');
        const selection=goalTask==='REVIEW'&&!changedRange?{target:goalReviewTarget(scope)}:
          newGoalSelection(author,selected,workspace,goalTask,newUnits,newScenes,stopAfter,includeProjectOutline,rangeSelection());
        changes.task=goalTask;changes.stopAfter=goalTask==='REVIEW'?'BODY':stopAfter;changes.target=selection.target;
        if('sources' in selection&&selection.sources)changes.additionalSources=selection.sources;
      }else if(goalTask!=='REVIEW'&&(stopAfter!==before.stopAfter||includeProjectOutline!==before.includeProjectOutline||newScenes!==before.newScenes)){
        changes.stopAfter=stopAfter;changes.target=goalStageTarget(scope,workspace,newScenes,stopAfter);
        if(stopAfter==='OUTLINE'&&includeProjectOutline!==before.includeProjectOutline)changes.target.sharedFields=includeProjectOutline?[...new Set([...(changes.target.sharedFields??[]),'outline' as const])]:changes.target.sharedFields?.filter(field=>field!=='outline');
      }
    }
    const latestConversation=(await scriptConversationClient.get(threadId!)).conversation;
    await submit({requestId:crypto.randomUUID(),threadId:latestConversation.id,expectedConversationVersion:latestConversation.version,...changes,kind:revise?'GOAL_REVISE':'GOAL_CONTINUE',goalId:liveGoal.id,expectedGoalVersion:liveGoal.version,expectedRunVersion:liveRun.version});
    setEditGoalOpen(false);setStructureChanges([]);
  });
  const answerGoal=(text:string,choiceId?:string)=>execute(async()=>{
    const question=selectedGoal?.pendingQuestion;
    if(!selectedGoal||!goalRun||!question)throw new Error('当前没有等待回答的问题');
    if(selectedGoal.revision.route.channel==='external'&&!isTestMode)throw new Error('请开启测试模式后继续此测试委托，或在调整委托中改用 API。');
    if(current.current.dirty||authorAhead(selectedGoalWorkspace))throw new Error('先保存并同步作者改稿，再回答当前委托。');
    const {executionChannel:_executionChannel,...base}=common();
    await submit({...base,kind:'GOAL_CONTINUE',goalId:selectedGoal.id,expectedGoalVersion:selectedGoal.version,
      expectedRunVersion:goalRun.version,answer:{decisionId:question.decisionId,text,...(choiceId?{choiceId}:{})}});
    setAnswerText('');
  });
  const increaseBudget=()=>execute(async()=>{
    if(!selectedGoal||!selectedBudget||!nextBudgetTier)throw new Error('委托预算尚未加载或已到最高额度');
    if(localStorage.getItem(pendingBudgetKey(project.id)))throw new Error('上次额度调整结果尚未确定，请先核对。');
    const pending:PendingBudget={projectId:project.id,goalId:selectedGoal.id,body:{requestId:crypto.randomUUID(),
      expectedGoalVersion:selectedGoal.version,expectedBudgetVersion:selectedBudget.version,maxInvocations:nextBudgetTier}};
    localStorage.setItem(pendingBudgetKey(project.id),JSON.stringify(pending));
    try{
      const result=await scriptAgentClient.increaseGoalBudget(pending.goalId,pending.body);
      localStorage.removeItem(pendingBudgetKey(project.id));setGoalBudget({goalId:pending.goalId,budget:result.budget});
    }catch(cause){if(rejected(cause))localStorage.removeItem(pendingBudgetKey(project.id));throw cause;}
  });
  const recoverBudget=()=>execute(async()=>{
    const saved=localStorage.getItem(pendingBudgetKey(project.id));if(!saved)throw new Error('没有待确认的额度调整');
    const pending=JSON.parse(saved) as PendingBudget;
    if(pending.projectId!==project.id||!pending.goalId||!pending.body?.requestId)
      throw new Error('待确认额度调整记录与当前作品不一致；本地记录已保留。');
    try{
      const result=await scriptAgentClient.increaseGoalBudget(pending.goalId,pending.body);
      localStorage.removeItem(pendingBudgetKey(project.id));setGoalBudget({goalId:pending.goalId,budget:result.budget});
    }catch(cause){if(rejected(cause))localStorage.removeItem(pendingBudgetKey(project.id));throw cause;}
  });
  const chatWorkspace=async(thread:string,author=project):Promise<ScriptWorkspace>=>{
    const existing=manualGoal?selectedWorkspace:undefined;
    if(existing){if(authorAhead(existing))throw new Error('当前稿已有修改，请先同步改稿到工作稿，再继续这段写作对话。');return existing;}
    const saved=localStorage.getItem(pendingChatWorkspaceKey(project.id));
    let pending:PendingChatWorkspace;
    try{pending=saved?JSON.parse(saved) as PendingChatWorkspace:{requestId:crypto.randomUUID(),revision:author.revision};}
    catch{localStorage.removeItem(pendingChatWorkspaceKey(project.id));throw new Error('待确认的工作稿记录无法读取，已清除；请重试。');}
    if(!saved)localStorage.setItem(pendingChatWorkspaceKey(project.id),JSON.stringify(pending));
    let created:Awaited<ReturnType<typeof scriptAgentClient.createWorkspace>>;
    try{created=await scriptAgentClient.createWorkspace(thread,project.id,pending.revision,pending.requestId);}
    catch(cause){if(rejected(cause))localStorage.removeItem(pendingChatWorkspaceKey(project.id));throw cause;}
    localStorage.removeItem(pendingChatWorkspaceKey(project.id));
    setWorkspaceId(created.workspace.id);selections.current.workspaceId=created.workspace.id;
    if(authorAhead(created.workspace))throw new Error('作者稿在准备写作对话期间已变化，请先同步改稿到工作稿。');
    return created.workspace;
  };
  const sendChat=(text:string)=>execute(async()=>{
    try{
    if(!conversation||!text.trim())return;
    if(unresolvedGoal)throw new Error(goalUnresolvedMessage);
    if(workingGoal)throw new Error(goalActiveMessage);
    const atSend=actionState.current;let author=current.current.project;const discussion=!chatContext?.operation||chatContext.operation==='consult';
    if(current.current.dirty&&!discussion){if(!onSaveForAction)throw new Error('请先保存当前稿');author=await onSaveForAction();if(hashValue(actionState.current)!==hashValue(atSend))throw new Error('保存期间输入或位置改变，已保留内容；请重新发送。');}
    const discussionDraft=discussion?chatContext?.discussionDraft:undefined;
    const chatUnit=(discussionDraft??project).units.find(item=>item.id===(chatContext?.unitId||unit.id));
    const chatSceneId=chatContext?chatContext.sceneId:chatTarget==='scene'?scene?.id:undefined;
    if(!chatUnit||chatSceneId&&!chatUnit.scenes.some(item=>item.id===chatSceneId))throw new Error('原讨论位置已删除，请清除上下文后选择当前内容。');
    if(conversation.turns.some(turn=>turn.status==='RECONCILIATION_REQUIRED'))throw new Error('上次消息结果尚未确定，请先核对。');
    if(localStorage.getItem(pendingChatKey(project.id)))throw new Error('上一条消息的接收状态未确定；请刷新恢复。');
    const workspace=await chatWorkspace(conversation.id,author);
    if(hashValue(actionState.current)!==hashValue(atSend))throw new Error('准备期间输入或位置改变，请重新发送。');
    const pending:PendingChat={threadId:conversation.id,composerContext:atSend.chatContext,body:{requestId:crypto.randomUUID(),expectedVersion:conversation.version,
      text:text.trim(),methodIds:skillIds,template:usePromptStore.getState().templates.scriptIdeation.template,executionChannel:channel,
      selection:{workspaceId:workspace.id,expectedRevision:workspace.revision,unitId:chatUnit.id,
        ...(chatContext?.entity?{entity:chatContext.entity}:{}),
        ...(chatContext?.draftOperation?{draftOperation:chatContext.draftOperation}:{}),...(chatContext?.analysis?{analysis:true}:{}),...(chatContext?.outlineRange?{outlineRange:chatContext.outlineRange}:{}),...(chatContext?.outlineBeatIds?{outlineBeatIds:chatContext.outlineBeatIds}:{}),...(chatContext?.outlineStructure!==undefined?{outlineStructure:chatContext.outlineStructure,outlineSceneOrder:chatContext.outlineSceneOrder}:{}),...(chatContext?.scopeId?{scopeId:chatContext.scopeId}:{}),...(chatContext?.seasonId?{seasonId:chatContext.seasonId}:{}),...(chatContext?.nodeId?{nodeId:chatContext.nodeId}:{}),...(discussionDraft?{localDraft:discussionDraft}:current.current.dirty&&discussion?{localDraft:current.current.project}:{}),
        ...(chatSceneId?{sceneId:chatSceneId,...(chatContext?.selection?{selection:chatContext.selection}:{})}:{}),
        ...(manualGoal?{manualGoal}:{})}}};
    localStorage.setItem(pendingChatKey(project.id),JSON.stringify(pending));
    try{
      const reply=await scriptAgentClient.sendChatTurn(pending.threadId,pending.body);
      localStorage.removeItem(pendingChatKey(project.id));setConversation(reply.conversation);clearSentComposer(pending.body.text,pending.composerContext);
    }catch(cause){if(rejected(cause))localStorage.removeItem(pendingChatKey(project.id));throw cause;}
    }catch(cause){throw cause;}
  });
  const recoverChat=()=>execute(async()=>{
    const saved=localStorage.getItem(pendingChatKey(project.id));if(!saved)throw new Error('没有待确认的消息');
    const pending=JSON.parse(saved) as PendingChat;
    if(pending.threadId!==conversation?.id||!pending.body?.requestId)throw new Error('待确认消息与当前对话不一致');
    try{
      const reply=await scriptAgentClient.sendChatTurn(pending.threadId,pending.body);
      localStorage.removeItem(pendingChatKey(project.id));setConversation(reply.conversation);clearSentComposer(pending.body.text,pending.composerContext);
    }catch(cause){if(rejected(cause))localStorage.removeItem(pendingChatKey(project.id));throw cause;}
  });
  const syncAuthor=()=>execute(async()=>{
    if(!syncTarget||!authorAhead(syncTarget))throw new Error('此工作稿已包含当前作者稿');
    if(current.current.dirty)throw new Error('先保存当前改稿，再同步到工作稿。');
    if(localStorage.getItem(pendingSyncKey(project.id)))throw new Error('上次同步结果尚未确定；请刷新恢复。');
    const writer=syncTarget.writerRunId?
      runs[syncTarget.writerRunId]||(await scriptAgentClient.run(syncTarget.writerRunId)).run:null;
    const pending:PendingSync={workspaceId:syncTarget.id,body:{requestId:crypto.randomUUID(),expectedRevision:syncTarget.revision,
      expectedEpoch:syncTarget.writerEpoch,expectedAuthorRevision:project.revision,
      ...(writer?{takeover:{runId:writer.id,expectedVersion:writer.version}}:{})}};
    localStorage.setItem(pendingSyncKey(project.id),JSON.stringify(pending));
    try{
      await scriptAgentClient.syncAuthor(pending.workspaceId,pending.body);
      localStorage.removeItem(pendingSyncKey(project.id));setAdoptionReview(null);
    }catch(cause){if(rejected(cause))localStorage.removeItem(pendingSyncKey(project.id));throw cause;}
  });
  const recoverSync=()=>execute(async()=>{
    const saved=localStorage.getItem(pendingSyncKey(project.id));if(!saved)throw new Error('没有待确认的同步');
    const pending=JSON.parse(saved) as PendingSync;
    if(!pending.workspaceId||!pending.body?.requestId)throw new Error('待确认同步记录无法读取');
    try{await scriptAgentClient.syncAuthor(pending.workspaceId,pending.body);localStorage.removeItem(pendingSyncKey(project.id));setAdoptionReview(null);}
    catch(cause){if(rejected(cause))localStorage.removeItem(pendingSyncKey(project.id));throw cause;}
  });
  const savedAuthorForAction=async()=>{
    const id=current.current.project.id;
    let author=current.current.project;
    if(current.current.dirty){
      if(!onSaveForAction)throw new Error('当前稿尚未保存，请重试保存。');
      author=await onSaveForAction();
    }
    if(current.current.project.id!==id)throw new Error('作品已切换，请在当前作品重新选择范围。');
    return author;
  };
  const apply=(candidate:ScriptCandidateView)=>execute(async()=>{
    if(!selectedWorkspace)throw new Error('请先选择工作稿。');
    await savedAuthorForAction();
    const {executionChannel:_executionChannel,...base}=common();
    await submit({...base,kind:'APPLY',workspaceId:selectedWorkspace.id,candidateId:candidate.id,
      expectedRevision:selectedWorkspace.revision,writerEpoch:selectedWorkspace.writerEpoch,...(manualGoal?{manualGoal}:{})});
  });
  const adoptCandidate=(candidate:ScriptCandidateView,outlineOnly=false)=>execute(async()=>{
    adoptionAttempt.current='';setAdoptionNotice('');setUpdatedTarget(null);
    const author=await savedAuthorForAction();
    if(localStorage.getItem(pendingAdoptionKey(project.id))){throw new Error('上次采用结果尚未确定，请先确认是否已保存。');}
    if(!candidate.candidate||candidate.status!=='VALID')throw new Error('候选未通过校验。');
    const workspace=(await scriptAgentClient.workspace(candidate.workspaceId)).workspace;
    if(!workspace)throw new Error('这份候选的工作稿已不可用。');
    if(workspace.writerRunId)throw new Error('请先暂停对应委托，再比较采用。');
    const base=(await scriptAgentClient.workspaceVersion(workspace.id,workspace.baseWorkspaceRevision)).document;
    if(!candidateIsOnlyChange(base,workspace.document,candidate.candidate.patch,Boolean(candidate.appliedRevision))){
      setWorkspaceId(workspace.id);selections.current.workspaceId=workspace.id;setReviewOpen(true);
      throw new Error('这份工作稿还包含其他修改，请在这份成果下方比较全部修改后采用。');
    }
    const intent={candidateId:candidate.id,workspaceId:workspace.id,authorRevision:author.revision,authorHash:hashValue(author),outlineOnly};
    localStorage.setItem(`omni.script.candidate-adopt.${project.id}`,JSON.stringify(intent));setCandidateAdoption(intent);
    if(!candidate.appliedRevision){
      const {executionChannel:_channel,...baseCommand}=common();
      try{await submit({...baseCommand,kind:'APPLY',workspaceId:workspace.id,candidateId:candidate.id,expectedRevision:workspace.revision,writerEpoch:workspace.writerEpoch});}
      catch(cause){if(rejected(cause))clearCandidateAdoption();throw cause;}
    }
  });
  // A reload or lost APPLY acknowledgement resumes the same author's adoption intent.
  useEffect(()=>{
    if(!candidateAdoption||busy||mutation.current)return;
    const candidate=allCandidates.find(item=>item.id===candidateAdoption.candidateId);
    const workspace=workspaces.find(item=>item.id===candidateAdoption.workspaceId);
    // Independent polling reads can expose the APPLY receipt before the
    // workspace snapshot that contains it. Wait for that version before
    // checking for other edits; an older snapshot is not a conflicting edit.
    if(!candidate?.appliedRevision||!workspace||workspace.revision<candidate.appliedRevision)return;
    const attempt=`${candidate.id}:${workspace.revision}:${project.revision}`;
    if(adoptionAttempt.current===attempt)return;
    adoptionAttempt.current=attempt;
    if(workspace.baseWorkspaceRevision>=candidate.appliedRevision&&!workspace.hasPendingChanges){clearCandidateAdoption();return;}
    void execute(async()=>{
      const saved=localStorage.getItem(pendingAdoptionKey(project.id));
      if(saved){
        const pending=JSON.parse(saved) as PendingAdoption;
        if(pending.projectId!==project.id||pending.workspaceId!==workspace.id){throw new Error('另一份采用结果尚未确定，请先确认。');}
        await completeAdoption(pending);clearCandidateAdoption();return;
      }
      if(!authorStillMatchesAdoption(current.current.project,current.current.dirty,candidateAdoption)){clearCandidateAdoption();throw new Error('页面内容在采用期间改变，已保留你的修改和候选，请重新比较采用。');}
      // Freeze before preparing the preview: later typing is a local change,
      // never part of the author's input to this adoption.
      const authorBase=structuredClone(current.current.project);
      const base=(await scriptAgentClient.workspaceVersion(workspace.id,workspace.baseWorkspaceRevision)).document;
      if(!candidate.candidate||!candidateIsOnlyChange(base,workspace.document,candidate.candidate.patch,true)){
        setWorkspaceId(workspace.id);selections.current.workspaceId=workspace.id;setReviewOpen(true);clearCandidateAdoption();
        throw new Error('工作稿在采用期间出现其他修改，请比较完整工作稿后采用。');
      }
      const result=await scriptAgentClient.prepareAdoption(workspace,authorBase.revision,undefined,candidateAdoption.outlineOnly);
      if(!result.proposal){
        setWorkspaceId(workspace.id);selections.current.workspaceId=workspace.id;
        setAdoptionReview({workspaceId:workspace.id,workspaceRevision:workspace.revision,authorRevision:authorBase.revision,proposal:null,conflicts:result.conflicts,choices:{},outlineOnly:candidateAdoption.outlineOnly});
        setReviewOpen(true);clearCandidateAdoption();throw new Error('这处内容双方都改过，请在这份成果下方选择保留哪份内容。');
      }
      const pending:PendingAdoption={projectId:project.id,workspaceId:workspace.id,proposal:{id:result.proposal.id,digest:result.proposal.digest},requestId:crypto.randomUUID(),authorBase};
      localStorage.setItem(pendingAdoptionKey(project.id),JSON.stringify(pending));
      await completeAdoption(pending);clearCandidateAdoption();
    });
  },[candidateAdoption,allCandidates,workspaces,busy]);
  const continueOutline=(candidate:ScriptCandidateView)=>execute(async()=>{
    const workspace=workspaces.find(w=>w.id===candidate.workspaceId),request=candidate.request;if(!workspace||!request)throw new Error('候选工作稿不可用');
    await submit({...common(),kind:'PROPOSE',source:{kind:'WORKSPACE',workspaceId:workspace.id,expectedRevision:workspace.revision},operation:'outline_development',instruction:'保留已交付的大纲原文、结构、关键节拍与稳定身份，只补齐原候选仍缺少的内容。',methodIds:skillIds,target:{unitId:request.unitId,nodeId:request.nodeId,scopeId:request.scopeId,seasonId:request.seasonId,repairCandidateId:candidate.id}});
  });
  const control=(targetRun:AgentRun,action:'pause'|'resume'|'cancel')=>execute(async()=>{
    const result=await scriptAgentClient.control(targetRun,action);setRuns(old=>({...old,[targetRun.id]:result.run}));
  });
  const reconcile=(targetRun:AgentRun)=>execute(async()=>{await scriptAgentClient.reconcile(targetRun);});
  const returnExternal=(request:ExternalRequest)=>execute(async()=>{
    if(!externalText[request.id]?.trim())throw new Error('先粘贴本次模型返回原文');
    await scriptAgentClient.submitExternal(request,externalText[request.id],{name:'author-external-return'});
    setExternalText(previous=>({...previous,[request.id]:''}));
  });
  const previewAdoptionFor=(workspace:ScriptWorkspace|undefined)=>execute(async()=>{
    if(!workspace)throw new Error('请先选择工作稿。');
    const author=await savedAuthorForAction();
    setWorkspaceId(workspace.id);selections.current.workspaceId=workspace.id;setReviewOpen(true);
    const result=await scriptAgentClient.prepareAdoption(workspace,author.revision);
    if(!result.proposal&&!result.conflicts.length)throw new Error('合并预览未返回结果，请刷新后重试。');
    setAdoptionReview({workspaceId:workspace.id,workspaceRevision:workspace.revision,
      authorRevision:author.revision,proposal:result.proposal,conflicts:result.conflicts,choices:{}});
  },false);
  const previewAdoption=()=>previewAdoptionFor(selectedWorkspace);
  const resolveAdoption=()=>execute(async()=>{
    if(!selectedWorkspace||!currentAdoption||!currentAdoption.conflicts.length||current.current.dirty)
      throw new Error('冲突比较已失效，请刷新后重新比较。');
    if(currentAdoption.conflicts.some(item=>!currentAdoption.choices[item.id]))throw new Error('请为每一处冲突选择保留作者稿或采用工作稿。');
    const resolutions=currentAdoption.conflicts.map(item=>({id:item.id,choice:currentAdoption.choices[item.id]}));
    const result=await scriptAgentClient.prepareAdoption(selectedWorkspace,project.revision,resolutions,currentAdoption.outlineOnly);
    if(!result.proposal||result.conflicts.length)throw new Error('合并选择未生成固定预览，请重新比较。');
    setAdoptionReview({...currentAdoption,proposal:result.proposal,conflicts:[]});
  },false);
  const completeAdoption=async(pending:PendingAdoption)=>{
    const base=pending.authorBase||current.current.project;
    const hadLocalChanges=current.current.dirty;
    let partial=false;
    try{const result=await scriptAgentClient.adopt(pending.workspaceId,pending.proposal,pending.requestId);partial=Boolean(result.receipt.partial);}
    catch(cause){if(rejected(cause))localStorage.removeItem(pendingAdoptionKey(project.id));throw cause;}
    const next=(await scriptClient.getProject(project.id)).project;
    const changedDuringAdoption=hadLocalChanges||current.current.dirty||hashValue(current.current.project)!==hashValue(base);
    // The workspace coordinates adoption with edits still arriving on the page.
    // Always deliver the acknowledged current manuscript, including recovery.
    onApplied(next,base,Boolean(pending.authorBase));
    if(changedDuringAdoption){
      setUpdatedTarget(null);
      setAdoptionNotice(`${partial?'已采用大纲，其余修改仍待采用':'已采用'}到当前稿；采用期间的页面修改已保留，请核对保存状态。`);
    }else{setUpdatedTarget(scriptUpdatedTarget(base,next,unit.id));setAdoptionNotice(`${partial?'已采用大纲，其余修改仍待采用':'已采用'}，当前稿已更新。`);}
    localStorage.removeItem(pendingAdoptionKey(project.id));setAdoptionReview(null);setReviewOpen(false);
  };
  const adopt=()=>execute(async()=>{
    if(!selectedWorkspace||!adoption||current.current.dirty)throw new Error('采用预览已失效，请重新比较。');
    if(localStorage.getItem(pendingAdoptionKey(project.id)))throw new Error('上次采用结果尚未确定；请先确认。');
    const pending:PendingAdoption={projectId:project.id,workspaceId:selectedWorkspace.id,
      proposal:{id:adoption.id,digest:adoption.digest},requestId:crypto.randomUUID(),authorBase:structuredClone(current.current.project)};
    localStorage.setItem(pendingAdoptionKey(project.id),JSON.stringify(pending));
    await completeAdoption(pending);
  });
  const recoverAdoption=()=>execute(async()=>{
    const saved=localStorage.getItem(pendingAdoptionKey(project.id));if(!saved)throw new Error('没有待确认的采用');
    const pending=JSON.parse(saved) as PendingAdoption;
    if(pending.projectId!==project.id||!pending.workspaceId||!pending.proposal?.id||!pending.requestId)
      throw new Error('待确认采用记录与当前作品不一致');
    await completeAdoption(pending);
  });
  const exportFixed=()=>execute(async()=>{
    if(!selectedWorkspace)throw new Error('先选择工作稿');
    const unitIds=exportUnitId==='all'?selectedWorkspace.document.units.map(item=>item.id):[exportUnitId];
    const result=await scriptAgentClient.exportWorkspace(selectedWorkspace.id,selectedWorkspace.revision,unitIds,exportFormat);
    setFixedExport({workspaceId:selectedWorkspace.id,revision:selectedWorkspace.revision,title:selectedWorkspace.document.title,format:exportFormat,...result});
  },false);
  const downloadFixed=()=>{
    if(!fixedExport||!selectedWorkspace||fixedExport.workspaceId!==selectedWorkspace.id)return;
    const extension=fixedExport.format==='markdown'?'md':fixedExport.format;
    const filename=scriptExportFilename({title:fixedExport.title},fixedExport.format)
      .replace(new RegExp(`\\.${extension}$`),`-工作稿.${extension}`);
    const blob=new Blob([fixedExport.text],{type:fixedExport.format==='json'?'application/json;charset=utf-8':'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const chatRunning=Boolean(conversation?.turns.some(turn=>['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL'].includes(turn.status)));
  const chatNeedsReconcile=Boolean(conversation?.turns.some(turn=>turn.status==='RECONCILIATION_REQUIRED'));
  const chatControlStatuses:AgentRun['status'][]=['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','PAUSED','RECONCILIATION_REQUIRED'];
  const chatRun=[...(conversation?.turns||[])].reverse().map(turn=>runs[turn.runId])
    .find(item=>item&&chatControlStatuses.includes(item.status));
  const chatExternal=conversation?.turns.flatMap(turn=>external[turn.runId]||[])||[];
  const visibleExternal=[...(run?external[run.id]||[]:[]),...goalExternal.map(item=>item.request),...chatExternal]
    .filter((item,index,items)=>item.status==='WAITING'&&items.findIndex(other=>other.id===item.id)===index);
  const unknownRuns=Object.values(runs).filter(item=>item.status==='RECONCILIATION_REQUIRED');
  let hasPending=false,hasPendingChat=false,hasPendingSync=false,hasPendingAdoption=false,hasPendingBudget=false;try{hasPending=Boolean(localStorage.getItem(pendingKey(project.id)));hasPendingChat=Boolean(localStorage.getItem(pendingChatKey(project.id)));hasPendingSync=Boolean(localStorage.getItem(pendingSyncKey(project.id)));hasPendingAdoption=Boolean(localStorage.getItem(pendingAdoptionKey(project.id)));hasPendingBudget=Boolean(localStorage.getItem(pendingBudgetKey(project.id)));}catch{}
  const recoveryActions=<>    {hasPending&&<button disabled={busy||!conversation} onClick={recoverPending}>确认上次命令是否已接收</button>}
    {hasPendingChat&&<button disabled={busy||!conversation} onClick={recoverChat}>确认上次消息是否已接收</button>}
    {hasPendingSync&&<button disabled={busy} onClick={recoverSync}>确认上次作者改稿同步结果</button>}
    {hasPendingAdoption&&<button disabled={busy} onClick={recoverAdoption}>确认上次采用是否已保存</button>}
    {hasPendingBudget&&<button disabled={busy} onClick={recoverBudget}>确认上次委托额度调整结果</button>}
</>;
  const goalSettings=(mode==='agent'||editGoalOpen)&&<Modal isOpen onClose={()=>{setEditGoalOpen(false);onAgentStarted?.();}} title={editGoalOpen?'调整本次委托':'交给 Agent 处理'} size="sm"><div className="sw script-assistant-tools space-y-3">
      {structureChanges.length>0&&<div role="alert" className="space-y-2"><strong>请确认变化后的委托范围</strong>{structureChanges.map(item=><p key={item.nodeId}>{item.title}：原有 {item.before.length} 场，现在 {item.after.length} 场。<br/>原范围：{item.before.map(id=>selectedGoalWorkspace?.document.units.find(unit=>unit.id===item.unitId)?.scenes.find(scene=>scene.id===id)?.title||'已移除场景').join(' → ')||'空段落'}<br/>新范围：{item.after.map(id=>project.units.find(unit=>unit.id===item.unitId)?.scenes.find(scene=>scene.id===id)?.title||'新场景').join(' → ')||'空段落'}<br/>加入：{item.after.filter(id=>!item.before.includes(id)).map(id=>project.units.find(unit=>unit.id===item.unitId)?.scenes.find(scene=>scene.id===id)?.title||'新场景').join('、')||'无'}；移出：{item.before.filter(id=>!item.after.includes(id)).map(id=>selectedGoalWorkspace?.document.units.find(unit=>unit.id===item.unitId)?.scenes.find(scene=>scene.id===id)?.title||'已移除场景').join('、')||'无'}。大纲或顺序变化将使用当前内容。</p>)}<p>确认后重新冻结下面选择的范围，不自动扩大旧委托。</p></div>}
      {!editGoalOpen&&<label className="sw-field">处理哪一集<select aria-label="委托目标单元" value={goalUnitId} onChange={event=>{setGoalUnitId(event.target.value);setGoalRange('unit');setGoalNodeId('');setGoalOutlineScope('');setGoalSceneIds([]);}}>{project.units.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      <label className="sw-field">这次委托<select value={goalTask} onChange={event=>{const task=event.target.value as 'WRITE'|'REVIEW';if(task==='REVIEW'){try{if(editGoalOpen&&goalRange==='existing'&&progressScope)goalReviewTarget(progressScope);else if(!['unit','node'].includes(goalRange))throw new Error('目前连续审阅只支持整集或幕／段落。请先明确选择范围；所选场景不会自动扩大为整集。');}catch(cause){setError(errorText(cause));return;}}setGoalTask(task);}}><option value="WRITE">推进创作</option><option value="REVIEW">审阅已有正文</option></select></label>
      {goalTask==='WRITE'&&<label className="sw-field">做到哪里停止<select aria-label="委托停止阶段" value={stopAfter} onChange={event=>{const stage=event.target.value as ScriptStage;if(!goalRangeSupportsStage(goalRange,stage)){setError('这个停止阶段需要不同的处理范围，请先明确选择范围。');return;}setStopAfter(stage);if(stage==='BLUEPRINT')setNewUnits(0);}}>{stopAfter==='BEATS'&&<option value="BEATS">{stageLabels.BEATS}</option>}{SCRIPT_STAGES.map(stage=><option key={stage} value={stage} disabled={!goalRangeSupportsStage(goalRange,stage)}>{stageLabels[stage]}</option>)}</select>{!['unit','existing'].includes(goalRange)&&<span className="sw-muted">切换到其他阶段前，请先明确选择相应处理范围。</span>}</label>}
      {goalTask==='WRITE'&&<p className="sw-muted">{stageDescriptions[stopAfter]} 其他集可之后再推进。</p>}
      {goalTask==='WRITE'&&stopAfter==='OUTLINE'&&goalRange==='unit'&&newUnits===0&&project.profile.organization==='episodic'&&<label><input type="checkbox" checked={includeProjectOutline} onChange={event=>setIncludeProjectOutline(event.target.checked)}/>同时允许修改全剧总纲（默认只处理当前集）</label>}
      {goalTask==='WRITE'&&stopAfter!=='BLUEPRINT'&&newUnits===0&&<>
        <label className="sw-field">处理范围<select aria-label="委托处理范围" value={goalRange} onChange={event=>setGoalRange(event.target.value as typeof goalRange)}>
          {goalRange==='existing'&&<option value="existing">沿用原委托范围</option>}
          <option value="unit">当前单元 · {goalUnit.title}</option>
          {stopAfter==='OUTLINE'&&<option value="project">仅作品总纲</option>}
          {stopAfter==='OUTLINE'&&goalUnit.scopeId!==project.id&&<option value={(project.seasons||[]).some(item=>item.id===goalUnit.scopeId)?'season':'story'}>当前故事完整大纲</option>}{['SCENES','BEATS','BODY'].includes(stopAfter)&&<><option value="scenes">选择本单元中的场景</option>{Boolean(goalUnit.structureNodes?.length)&&<option value="node">选择幕或段落</option>}</>}
        </select></label>
        {goalRange==='node'&&<label className="sw-field">幕／段落<select aria-label="委托结构节点" value={goalNodeId} onChange={event=>setGoalNodeId(event.target.value)}><option value="">选择一个段落</option>{goalUnit.structureNodes?.map(node=><option key={node.id} value={node.id}>{node.parentId?'　':''}{node.title}</option>)}</select></label>}
        {goalRange==='scenes'&&<fieldset className="sw-proposal"><legend>本次处理的场景</legend>
          {rangeUnit?.scenes.map((item,index)=><label key={item.id} className="flex items-center gap-2"><input type="checkbox" checked={goalSceneIds.includes(item.id)} onChange={event=>setGoalSceneIds(old=>event.target.checked?[...old,item.id]:old.filter(id=>id!==item.id))}/>{index+1}. {item.title}</label>)}
          {!rangeUnit?.scenes.length&&<p>当前没有场景，请选择当前单元先规划分场。</p>}
        </fieldset>}
      </>}
      {goalTask==='WRITE'&&newUnits===0&&<p className="sw-muted">本次范围：{stopAfter==='BLUEPRINT'?'作品构想、人物与基础设定':goalRange==='project'?'仅作品总纲，不改分集大纲、分场或正文':goalRange==='scenes'?`「${goalUnit.title}」勾选的 ${goalSceneIds.length} 场，不新增或改写其他场景`:goalRange==='node'?`「${goalUnit.title}」的「${goalUnit.structureNodes?.find(node=>node.id===goalNodeId)?.title||'待选段落'}」及其子段落`:goalRange==='story'||goalRange==='season'?'仅所选故事的完整大纲':goalRange==='existing'?'沿用原委托的单元与场景':`「${goalUnit.title}」${stopAfter==='OUTLINE'?'的大纲':'的全部场景'}`}。{stopAfter==='OUTLINE'&&goalRange==='unit'&&includeProjectOutline?'同时包含作品总纲。':''}</p>}
      <label className="sw-field">这次交付什么<textarea value={objective} onChange={event=>setObjective(event.target.value)} rows={3} placeholder="例如：根据已有蓝图生成本集大纲，再推进到所选阶段就停止。"/></label>
      <details><summary>高级范围与数量上限</summary>{goalTask==='WRITE'&&<div className="sw-inline">{!['BLUEPRINT','OUTLINE'].includes(stopAfter)&&goalRange!=='scenes'&&<label>最多新增场数 <input aria-label="最多新增场数" type="number" min={1} max={100} value={newScenes} onChange={event=>setNewScenes(Number(event.target.value))}/></label>}
        {stopAfter!=='BLUEPRINT'&&['unit','existing'].includes(goalRange)&&project.profile.organization!=='standalone'&&<label>新增后续集数 <input aria-label="新增后续集数" type="number" min={0} max={10} value={newUnits} onChange={event=>setNewUnits(Number(event.target.value))}/></label>}</div>}</details>
      {goalTask==='WRITE'&&newUnits>0&&<p className="sw-muted">只写新增的 {newUnits} 集；“{goalUnit.title}”将作为本次任务的前文参考，不授予修改权限。</p>}
      <details><summary>本次模型与写作方法</summary><div className="space-y-2">
        {isTestMode&&<label className="sw-field">执行方式<select value={channel} onChange={event=>setChannel(event.target.value as 'api'|'external')}><option value="api">使用已配置模型</option><option value="external">复制提示词，手动回填</option></select></label>}
        {skills.map(skill=><label key={skill.id} className="flex items-center gap-2"><input type="checkbox" checked={skillIds.includes(skill.id)} onChange={()=>setSkillIds(old=>old.includes(skill.id)?old.filter(id=>id!==skill.id):[...old,skill.id])}/>{skill.title}</label>)}
      </div></details>
      {error&&<p role="alert">{error}</p>}
      <button className="sw-primary" disabled={busy||!conversation||!objective.trim()} onClick={()=>editGoalOpen?continueGoal(true):startGoal()}>{dirty?'保存并继续':editGoalOpen?'更新委托并继续':goalTask==='REVIEW'?'委托 Agent 审阅':'委托 Agent 写作'}</button>

  </div></Modal>;
  const workspaceResult=<div ref={resultRef} className="sw script-assistant-tools script-chat-result" tabIndex={-1}>
    {reviewOpen&&selectedWorkspace&&<div className="space-y-3"><div className="flex items-center justify-between"><strong>比较与采用</strong><button type="button" title="收起比较" aria-label="收起比较" onClick={()=>setReviewOpen(false)}><X size={14}/></button></div>
      <p className="sw-muted">比较这份成果与作品中已保存的内容，确认后写入页面。</p>
      {allCandidates.filter(candidate=>candidate.workspaceId===workspaceId&&!candidate.appliedRevision).map(candidate=>{
        let preview:ScriptProject|null=null;
        if(candidate.status==='VALID'&&candidate.candidate&&!candidate.appliedRevision&&candidate.baseRef?.version===String(selectedWorkspace.revision)&&candidate.baseRef.contentHash===hashValue(selectedWorkspace.document)){
          try{preview=applyWorkspacePatch(selectedWorkspace.document,candidate.candidate.patch);}catch{}
        }
        return <details key={candidate.id} className="sw-proposal"><summary>{operationOptions.find(item=>item.id===candidate.request?.operation)?.label||candidate.request?.operation||'已撤回候选'} · {candidate.appliedRevision?'已写入工作稿':candidate.status==='VALID'?'待比较':candidate.status==='REDACTED'?'来源已撤回':'校验失败'}</summary>
          {candidate.error&&<p role="alert">{candidate.error}</p>}
          {candidate.candidate&&<p>{String(candidate.candidate.result.summary||'')}</p>}
          {preview&&<ScriptDocumentComparison before={selectedWorkspace.document} after={preview}/>}
          {candidate.status==='VALID'&&!candidate.appliedRevision&&<button disabled={busy||dirty||!preview} onClick={()=>apply(candidate)}>采用到工作稿</button>}
        </details>;
      })}
      <details><summary>查看当前剧本正文</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap">{exportText(selectedWorkspace.document,'markdown')}</pre></details>
      <button disabled={busy||dirty} onClick={previewAdoption}>比较作者稿与工作稿</button>
      {currentAdoption?.outlineOnly&&<p>本次仅采用大纲原文，结构与节拍留在候选中。</p>}
      {Boolean(currentAdoption?.conflicts.length)&&!adoption&&<div className="sw-proposal space-y-3">
        <strong>这些位置双方都改过，请逐项选择</strong>
        <p className="sw-muted">选择前不会修改作者稿；所有冲突都有选择后，系统才生成固定合并预览。</p>
        {currentAdoption.conflicts.map(conflict=>{
          const label=scriptChangeLabel(selectedWorkspace.document,conflict.key,conflict.field);
          const show=(document:ScriptProject,present:boolean,value:unknown)=>present?scriptChangeValue(document,conflict.key,conflict.field,value):'（此处不存在）';
          return <div key={conflict.id} className="sw-proposal"><strong>{label}</strong>
            <div className="sw-proposal-comparison"><div><strong>当前稿</strong><pre>{show(project,conflict.authorPresent,conflict.authorValue)}</pre></div>
              <div><strong>AI 工作稿</strong><pre>{show(selectedWorkspace.document,conflict.workspacePresent,conflict.workspaceValue)}</pre></div></div>
            <label className="sw-field">这处采用哪份内容<select value={currentAdoption.choices[conflict.id]||''} onChange={event=>setAdoptionReview(previous=>previous?{
              ...previous,choices:{...previous.choices,[conflict.id]:event.target.value as WorkspacePatchResolution['choice']}}:previous)}>
              <option value="">请选择</option><option value="AUTHOR">保留作者稿</option><option value="WORKSPACE">采用工作稿</option>
            </select></label>
          </div>;
        })}
        <button disabled={busy||dirty||currentAdoption.conflicts.some(item=>!currentAdoption.choices[item.id])} onClick={resolveAdoption}>生成合并预览</button>
      </div>}
      {adoption&&<div className="sw-proposal"><ScriptDocumentComparison before={project} after={adoption.document}/>
        <button disabled={busy||dirty||hasPendingAdoption} onClick={adopt}>采用并更新当前稿</button></div>}
      <details className="sw-proposal"><summary>导出本次成果</summary>
        <p className="sw-muted">导出当前 AI 工作稿的指定范围；采用后更新同一份当前稿。</p>
        {selectedGoal?.workspaceId===selectedWorkspace.id&&goalRun?.status==='PARTIAL'&&<p role="alert">{decisionInvalid(goalRun)?
          '最后一次模型决策格式无效。当前工作稿已保存，但这次委托没有形成有效交付；请核对后继续。':
          '这份委托仅部分完成。导出的是当前工作稿快照，不代表全部交付要求已达成；目标时长仍需单独核对。'}</p>}
        <label className="sw-field">导出范围<select value={exportUnitId} onChange={event=>{setExportUnitId(event.target.value);setFixedExport(null);}}>
          <option value="all">全部单元</option>{selectedWorkspace.document.units.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
        </select></label>
        <label className="sw-field">文件格式<select value={exportFormat} onChange={event=>{setExportFormat(event.target.value as ScriptExportFormat);setFixedExport(null);}}>
          <option value="fountain">Fountain</option><option value="markdown">Markdown</option><option value="json">JSON</option>
        </select></label>
        <button type="button" disabled={busy} onClick={exportFixed}>生成成果导出</button>
        {fixedExport?.workspaceId===selectedWorkspace.id&&<div className="sw-proposal"><p>{fixedExport.unitIds.length} 个单元 · 本次导出内容</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{fixedExport.text}</pre><button type="button" onClick={downloadFixed}>下载成果</button></div>}
      </details>
    </div>}

  </div>;
  const renderExternal=(request:ExternalRequest)=>!isTestMode?<p key={request.id} className="sw-muted">这是一条尚未完成的测试请求。可在设置中开启测试模式后继续，或取消本次任务。</p>:<div key={request.id} className="sw script-assistant-tools script-chat-result" role="group" aria-label="等待模型回填">
    <strong>等待模型回填</strong>
    {request.redacted?<p role="alert">来源已撤回，这条请求已不可使用。</p>:<>
      <p className="sw-muted">复制提示词到所用模型，再将返回内容粘贴到这里。</p>
      <button type="button" onClick={()=>void navigator.clipboard.writeText([request.request.systemInstruction,request.request.prompt].filter(Boolean).join('\n\n')).catch(()=>setError('复制失败，请展开提示词后手动复制。'))}>复制提示词</button>
      <details><summary>查看提示词</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{[request.request.systemInstruction,request.request.prompt].filter(Boolean).join('\n\n')}</pre></details>
      <textarea aria-label="模型返回原文" rows={4} placeholder="在这里粘贴模型返回的完整内容…" value={externalText[request.id]||''} onChange={event=>setExternalText(old=>({...old,[request.id]:event.target.value}))}/>
      <button disabled={busy||!externalText[request.id]?.trim()} onClick={()=>returnExternal(request)}>提交本次返回</button>
    </>}
  </div>;
  const renderReconciliation=(item:AgentRun)=><div key={item.id} className="sw script-assistant-tools script-chat-result" role="status">
    <strong>这次回复需要核对</strong><p>请求已发送，但返回状态未确定。核对后再继续，避免重复生成。</p>
    <button disabled={busy} onClick={()=>reconcile(item)}>检查已收到的返回</button>
    <details><summary>查看本次请求</summary>{(invocations[item.id]||[]).map(invocation=><div key={invocation.id}>
      {invocation.redacted?<p>请求来源已撤回。</p>:<pre className="max-h-64 overflow-auto whitespace-pre-wrap">{invocation.request.prompt}</pre>}
    </div>)}</details>
  </div>;
  const goalDetails=<details key={goalId} className="space-y-3" onToggle={event=>{if(event.target===event.currentTarget)setGoalDetailsFor(event.currentTarget.open?goalId:'');}}><summary>查看检查结果与用量</summary>
        {detailsRead.loading&&<p role="status">正在读取检查结果与用量…</p>}
        {detailsRead.error!=null&&<p role="alert">{errorText(detailsRead.error)}</p>}
        {selectedBudget&&<div className="sw-proposal">
          <strong>本次委托额度</strong>
          <p>模型调用 {selectedBudget.used.invocations}/{selectedBudget.limits.maxInvocations} · 工具 {selectedBudget.used.toolCalls}/{selectedBudget.limits.maxToolCalls}</p>
          <p>回合 {selectedBudget.used.turns}/{selectedBudget.limits.maxTurns} · 返修 {selectedBudget.used.repairRounds}/{selectedBudget.limits.maxRepairRounds}</p>
          {selectedBudget.limits.maxActiveMs!==undefined&&<p>累计活动时间 {budgetTime(selectedBudget.used.activeMs)}/{budgetTime(selectedBudget.limits.maxActiveMs)}</p>}
          {selectedBudget.used.invocations>=selectedBudget.limits.maxInvocations||selectedBudget.used.toolCalls>=selectedBudget.limits.maxToolCalls||
            selectedBudget.used.turns>=selectedBudget.limits.maxTurns||selectedBudget.used.repairRounds>=selectedBudget.limits.maxRepairRounds||
            selectedBudget.limits.maxActiveMs!==undefined&&selectedBudget.used.activeMs>=selectedBudget.limits.maxActiveMs
            ?<p role="alert">至少一项委托额度已用尽。增加额度后仍需由作者明确点击“继续”。</p>:null}
          {nextBudgetTier?<button type="button" disabled={busy||hasPendingBudget} onClick={increaseBudget}>增加至 {nextBudgetTier} 次模型调用的累计额度</button>
            :<p className="sw-muted">模型调用额度已到最高档。</p>}
          <p className="sw-muted">增加额度不会清零已经消耗的调用、工具、回合或返修，也不会自动继续委托。</p>
        </div>}
        {goalTiming.map(({unit:timed,estimate,preview,measured,plannedCoverage,toleranceMs})=><div key={timed.id} className="sw-proposal">
          <strong>{timed.title} · 时长证据</strong>
          <p>目标 {seconds(timed.targetDurationMs)}（本单元有效偏差 ±{seconds(toleranceMs)}）</p>
          <p>对白估算 {estimate?`${seconds(estimate.lowMs??estimate.durationMs)}–${seconds(estimate.highMs??estimate.durationMs)}`:'尚无当前内容估算'} <span className="sw-muted">仅对白，不含动作和停顿</span></p>
          <p>编排计划覆盖 {plannedCoverage===null?'时间轴待修正':seconds(plannedCoverage)} <span className="sw-muted">只代表计划</span></p>
          <p>合成预览 {preview?seconds(preview.durationMs):'尚无当前内容预览'} · 实测 {measured?seconds(measured.durationMs):'尚无当前内容 ffprobe 实测'}</p>
          <p className="sw-muted">正文检查覆盖不证明目标时长或艺术质量。可在正文页的“时长估算”查看证据详情。</p>
        </div>)}
      {selectedGoal&&!isPlanningStage(selectedStage)&&selectedReview&&(selectedReview.redacted
        ?<p role="alert">审阅来源已撤回，原文与审阅结果不可查看。</p>
        :selectedReview.review
          ?<details className="sw-proposal"><summary>正文审阅 · {selectedReview.review.findings.length} 条发现</summary>
            <p className="sw-muted">本次检查 · 返修 {selectedReview.review.repairRoundsUsed}/{selectedReview.review.maxRepairRounds} 轮</p>
            {selectedCheckScenes?.length&&<p className="sw-muted">仅核对委托选定的 {selectedCheckScenes.reduce((n,item)=>n+item.sceneIds.length,0)} 场，完成不代表整集已写完。</p>}
            <p>局部检查{selectedReview.review.coverage.localComplete?'已完成':'未完成'}，全局检查{selectedReview.review.coverage.globalComplete?'已完成':'未完成'}。</p>
            {selectedReview.review.coverage.missingTaskIds.length>0&&<p>待完成检查：{selectedReview.review.coverage.missingTaskIds.join('、')}</p>}
            {selectedReview.review.coverage.invalidReceipts.map(item=><p key={item.taskId} role="alert">检查 {item.taskId} 无效：{item.reason}</p>)}
            {selectedReview.review.tasks.map(task=><p key={task.id} className="sw-muted">{task.kind==='LOCAL'?'局部':'全局'} · {task.phase} · {task.checkId} · {task.status}{task.summary?`：${task.summary}`:''}</p>)}
            {selectedReview.review.findings.map(finding=>{
              const sourceScene=project.units.find(item=>item.id===finding.source.unitId)?.scenes.find(item=>item.id===finding.source.sceneId);
              return <div key={finding.id} className="sw-proposal"><strong>{finding.severity==='BLOCKING'?'需要处理':'建议'} · {finding.status}</strong>
                <p>{finding.issue}</p><p>建议：{finding.suggestion}</p>
                <p className="sw-muted">检查依据 · {sourceScene?.title||finding.source.sceneId} · 段落 {finding.source.blockId}{finding.source.start!==undefined?` · 字符 ${finding.source.start}${finding.source.end!==undefined?`–${finding.source.end}`:''}`:''} · {finding.basis==='RAW'?'原文检查':'索引检查'}</p>
                <blockquote className="whitespace-pre-wrap">{finding.originalText}</blockquote>
                {sourceScene&&<button type="button" onClick={()=>onOpenScene(finding.source.unitId,finding.source.sceneId)}>打开作者稿对应场</button>}
              </div>;
            })}
          </details>
          :selectedReview.pendingBody?<p className="sw-muted">审阅等待正文：{selectedReview.pendingBody}</p>:null)}
  </details>;
  const validateLegacyRequest=(author:ScriptProject,context:AssistantRequest)=>{const target=author.units.find(item=>item.id===context.unitId);if(!target)throw new Error('原任务单元已删除，请重新选择范围。');legacyTaskAnchor(target,context.operation||'consult',context.sceneId||target.scenes[0]?.id);};
  const saveThenLegacy=()=>execute(async()=>{if(!onSaveForAction||!chatContext||!onLegacyRequest)return;const state=actionState.current;const author=await onSaveForAction();if(hashValue(actionState.current)!==hashValue(state))throw new Error('保存期间输入或位置改变，请重新发送。');validateLegacyRequest(author,chatContext);onLegacyRequest({...chatContext,text:chatInput},channel,skillIds);clearSentComposer(chatInput,chatContext);});
  const sendFromComposer=()=>{
    if(!chatInput.trim())return;
    if(chatContext?.operation&&['unit_outlines','board_plan','ending','scene_turn'].includes(chatContext.operation)&&onLegacyRequest){
      if(dirty){void saveThenLegacy();return;}
      try{validateLegacyRequest(project,chatContext);}catch(cause){setError(errorText(cause));return;}
      onLegacyRequest({...chatContext,text:chatInput},channel,skillIds);clearSentComposer(chatInput,chatContext);return;
    }
    void sendChat(chatInput);
  };
  const candidateDelegation=delegationCandidateKind(chatContext);
  const scrollSignature=conversation?.turns.map(turn=>`${turn.id}:${turn.status}`).join('|');
  const previousTurnCount=useRef(0);
  useEffect(()=>{const end=messageEnd.current,parent=end?.parentElement;if(!end||!parent)return;
    const count=conversation?.turns.length||0;
    if(count>previousTurnCount.current||parent.scrollHeight-parent.scrollTop-parent.clientHeight<160)end.scrollIntoView({block:'end'});
    previousTurnCount.current=count;
  },[scrollSignature,allCandidates.length]);
  useEffect(()=>{if(reviewOpen&&!historyOpen)resultRef.current?.scrollIntoView({block:'nearest'});},[reviewOpen,workspaceId,historyOpen,currentAdoption?.workspaceRevision]);
  const candidateForTurn=(turn:NonNullable<typeof conversation>['turns'][number])=>allCandidates.filter(item=>item.runId===turn.runId||item.id===(turn.response as unknown as {dispatch?:{candidateId?:string}}|null)?.dispatch?.candidateId);
  const resultCandidateId=allCandidates.filter(item=>item.workspaceId===workspaceId).at(-1)?.id;
  const goalResultAnchor=selectedGoal?.workspaceId===workspaceId;
  const renderCandidate=(candidate:ScriptCandidateView)=>{const workspace=workspaces.find(w=>w.id===candidate.workspaceId),joint=candidate.request?.operation==='outline_development',pending=Boolean(joint&&candidate.appliedRevision&&workspace&&workspace.baseWorkspaceRevision>=candidate.appliedRevision&&workspace.hasPendingChanges);return <div key={candidate.id}>
    <ScriptCandidateCard candidate={candidate} project={project}
      busy={busy||Boolean(candidateAdoption)} partial={pending} handled={Boolean(!pending&&candidate.appliedRevision&&workspace&&workspace.baseWorkspaceRevision>=candidate.appliedRevision)}
      onContinue={joint&&candidate.candidate?.delivery?.missing.length?()=>void continueOutline(candidate):undefined} onAdopt={()=>planningRepairs[candidate.runId]&&candidate.appliedRevision&&workspace?void previewAdoptionFor(workspace):pending?void previewAdoptionFor(workspace):void adoptCandidate(candidate)} onAdoptOutline={joint&&!planningRepairs[candidate.runId]?()=>void adoptCandidate(candidate,true):undefined}/>
    {reviewOpen&&!goalResultAnchor&&candidate.id===resultCandidateId&&workspaceResult}
  </div>;};
  const goalRequestIds=new Set(goalExternal.map(item=>item.request.id));
  const turnRequestIds=new Set(chatExternal.map(item=>item.id));
  const openResult=(workspace:ScriptWorkspace)=>{setHistoryOpen(false);setWorkspaceId(workspace.id);selections.current.workspaceId=workspace.id;setAdoptionReview(null);setReviewOpen(true);};
  return <section className="script-chat-shell">
    {goalSettings}
    {/* Context Bar */}
    {chatContext?.outlineStructure!==undefined&&!chatContext.outlineBeatIds&&!chatContext.outlineRange&&!chatContext.seasonId&&<div className="px-4 py-2 flex flex-wrap gap-3 text-xs"><label><input type="checkbox" checked={chatContext.outlineStructure} onChange={e=>setChatContext({...chatContext,outlineStructure:e.target.checked,outlineSceneOrder:e.target.checked&&chatContext.outlineSceneOrder})}/> 允许调整幕／段落</label><label><input type="checkbox" disabled={!chatContext.outlineStructure} checked={Boolean(chatContext.outlineSceneOrder)} onChange={e=>setChatContext({...chatContext,outlineSceneOrder:e.target.checked})}/> 同步调整相关场序</label></div>}
    <div className="flex items-center justify-between px-4 py-2 text-xs shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="px-2 py-0.5 rounded-md bg-bg-surface-soft text-text-secondary font-mono text-[11px] font-medium shrink-0">
          {chatContext?'待发送：'+chatContext.label:({BLUEPRINT:'全案蓝图',OUTLINE:'故事大纲',SCENES:'分场规划',BEATS:'分场规划',BODY:'剧本写作'}[initialStage])}
        </span>
        <span className="text-text-muted truncate text-[11px]">
          {(chatContext?.discussionDraft??project).units.find(item=>item.id===(chatContext?.unitId||unit.id))?.title||'原单元'}
          {(!chatContext&&defaultChatTarget==='scene'&&scene)&&<> · {scene.title}</>}
          {chatContext?.nodeId&&<> · {project.units.find(item=>item.id===chatContext.unitId)?.structureNodes?.find(item=>item.id===chatContext.nodeId)?.title||'原段落'}</>}
          {chatContext?.sceneId&&<> · {project.units.find(item=>item.id===chatContext.unitId)?.scenes.find(item=>item.id===chatContext.sceneId)?.title||'原场景'}</>}
        </span>
      </div>
      <div className="flex items-center gap-2">
      <button type="button" title="历史记录与成果" aria-label="历史记录与成果" aria-expanded={historyOpen} onClick={()=>setHistoryOpen(old=>!old)} className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-surface-hover"><History size={15}/></button>
      {chatContext&&(
        <button type="button" className="text-text-muted hover:text-text-primary transition-colors text-[11px] flex items-center gap-1 shrink-0 cursor-pointer" onClick={()=>setChatContext(null)}>
          改为当前位置 <X size={12}/>
        </button>
      )}
      </div>
    </div>

    <div hidden={!historyOpen} className="script-assistant-history sw script-assistant-tools" aria-label="助手历史记录">
      <div className="flex items-center justify-between"><strong>历史记录与成果</strong><button type="button" onClick={()=>setHistoryOpen(false)}>返回聊天</button></div>
      {goals.length>0&&<section className="space-y-2"><h4>Agent 委托</h4>{goals.map(item=><button type="button" className="script-chat-history-row" key={item.id} onClick={()=>{setGoalId(item.id);selections.current.goalId=item.id;setHistoryOpen(false);}}>{item.revision.objective}<span className="sw-muted">{runs[item.activeRunId||item.lastRunId]?runStatusText(runs[item.activeRunId||item.lastRunId]):'读取中'}</span></button>)}</section>}
      <section className="space-y-2"><h4>已保存的成果</h4>
        {workspaces.filter(workspace=>workspace.revision>workspace.baseWorkspaceRevision||allCandidates.some(item=>item.workspaceId===workspace.id)).map(workspace=>{
          const candidate=allCandidates.find(item=>item.workspaceId===workspace.id),goal=goals.find(item=>item.workspaceId===workspace.id);
          return <button type="button" className="script-chat-history-row" key={workspace.id} onClick={()=>openResult(workspace)}>{goal?.revision.objective||operationOptions.find(option=>option.id===candidate?.request?.operation)?.label||'创作成果'}<span className="sw-muted">查看、比较与导出</span></button>;
        })}
        {!allCandidates.length&&!workspaces.some(workspace=>workspace.revision>workspace.baseWorkspaceRevision)&&<p className="sw-muted">暂无已生成的成果。聊天记录保留在对话中。</p>}
      </section>
      {legacyHistory&&<details><summary>较早的讨论与提案</summary>{legacyHistory}</details>}
    </div>
    {/* Chat History & Empty State */}
    <div className="script-chat-history" hidden={historyOpen}>
      {!conversation&&<p className="text-xs text-text-muted text-center py-6">正在载入作品对话…</p>}

      {/* Inspirational Copilot Empty State */}
      {conversation&&!conversation.turns.length&&!conversation.seed.length&&(
        <div className="pt-6 pb-2 px-2 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-bg-surface-soft flex items-center justify-center text-text-primary mb-3">
            <Sparkles size={22} className="opacity-90" />
          </div>
          <h4 className="text-sm font-semibold text-text-primary tracking-tight mb-1">剧作智能副驾</h4>
          <p className="text-xs text-text-secondary leading-relaxed max-w-[280px] mb-6">
            随时探讨故事走向、打磨人物小传或推演剧情冲突。在左侧点击内容旁的 ✨ 图标，也可快速带入讨论。
          </p>

          <div className="w-full space-y-2 text-left">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-muted px-1">
              <Lightbulb size={12} />
              <span>快速灵感与推演</span>
            </div>
            <div className="grid gap-1.5">
              {suggestedPromptsForStage(initialStage).map((prompt, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    queueRequest({id:Date.now(),text:prompt.text,label:prompt.label,stage:initialStage,unitId:unit.id,
                      ...(scene&&(prompt.target==='scene'||initialStage==='BODY')?{sceneId:scene.id}:{})});
                  }}
                  className="w-full text-left px-3.5 py-2.5 rounded-xl bg-bg-surface-soft hover:bg-bg-surface-hover text-xs text-text-secondary hover:text-text-primary transition-all flex items-center justify-between group cursor-pointer border-none outline-none focus:outline-none focus:ring-0"
                >
                  <span className="truncate">{prompt.label}</span>
                  <ArrowRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted shrink-0 ml-2" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Seed Messages */}
      {conversation?.seed.map((message,index)=>(
        <article key={`seed-${index}`} className={`flex flex-col ${message.role==='user'?'items-end':'items-start'}`}>
          <div className={`max-w-[90%] rounded-2xl ${message.role==='user'?'rounded-tr-xs bg-bg-surface-soft text-text-primary':'rounded-tl-xs bg-bg-surface-soft/60 text-text-primary'} px-3.5 py-2.5 text-xs select-text`}>
            <div className="text-[10px] font-medium text-text-muted mb-1">{message.role==='user'?'你':'助手'}</div>
            <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
          </div>
        </article>
      ))}

      {/* Conversation Turns */}
      {conversation?.turns.map(turn=><div key={turn.id} className="space-y-3">
        {/* User Bubble */}
        <div className="flex flex-col items-end">
          <div className="max-w-[88%] rounded-2xl rounded-tr-xs bg-bg-surface-soft px-3.5 py-2.5 text-xs text-text-primary select-text">
            <div className="text-[10px] font-medium text-text-muted mb-1 text-right">你</div>
            <p className="whitespace-pre-wrap leading-relaxed">{turn.input.text}</p>
          </div>
        </div>
        {/* Assistant Bubble */}
        <div className="flex flex-col items-start">
          <div className="max-w-[95%] rounded-2xl rounded-tl-xs bg-bg-surface-soft/60 px-3.5 py-2.5 text-xs text-text-primary select-text space-y-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-text-muted">
              <Sparkles size={11} className="text-text-secondary" />
              <span>剧作副驾</span>
            </div>
            <p className="whitespace-pre-wrap leading-relaxed">
              {(candidateForTurn(turn).some(item=>item.status==='VALID')?'已生成候选，请查看内容后决定是否采用。':!candidateForTurn(turn).length&&(turn.response as unknown as {dispatch?:{candidateId?:string}}|null)?.dispatch?.candidateId?'正在载入本次成果…':turn.response?.text)||(turn.status==='WAITING_EXTERNAL'?'请回填这条消息的模型返回。':['QUEUED','RUNNING','WAITING_STEP'].includes(turn.status)?'正在处理…':turn.errorMessage||'本次回复尚未完成。')}
            </p>
            {turn.response?.analysis&&<ScriptAnalysisSummary analysis={turn.response.analysis} onOpen={onOpenAnalysis?()=>onOpenAnalysis({analysis:turn.response!.analysis!,onRequest:(next)=>analysisActions.current.onRequest(next),onRepair:(target,instruction)=>analysisActions.current.onRepair(target,instruction)}):undefined}/>}
            {turn.response?.options?.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {turn.response.options.map((option,index)=>(
                  <button
                    key={index}
                    type="button"
                    disabled={busy||chatRunning}
                    onClick={()=>setChatInput(old=>[old,`【${option.tag}】${option.text}`].filter(Boolean).join('\n'))}
                    className="px-2.5 py-1.5 rounded-lg text-xs bg-bg-surface hover:bg-bg-surface-hover text-text-secondary hover:text-text-primary transition-all text-left cursor-pointer"
                  >
                    <span className="font-medium text-text-primary">{option.tag}</span> · {option.text}
                  </button>
                ))}
              </div>
            ) : null}
            {(external[turn.runId]||[]).filter(request=>request.status==='WAITING').map(renderExternal)}
            {turn.status==='RECONCILIATION_REQUIRED'&&runs[turn.runId]&&renderReconciliation(runs[turn.runId])}
            {candidateForTurn(turn).map(renderCandidate)}
          </div>
        </div>
      </div>)}

      {Object.entries(planningRepairs).map(([runId,progress])=>{const workflow=runs[runId];
        const workspace=workspaces.find(item=>allCandidates.some(candidate=>candidate.runId===runId&&candidate.workspaceId===item.id));
        return <section key={runId} aria-label="有限规划检查与修正" className="sw script-assistant-tools script-chat-result space-y-3">
          <strong>规划检查与修正 · 已修正 {progress.roundsUsed}/2 轮</strong><p>{workflow?runStatusText(workflow):''} · {progress.summary}</p>
          {progress.analyses.map((analysis,index)=><details key={index} open={index===progress.analyses.length-1}><summary>{index===0?'初次检查':`第 ${index} 轮复核`} · {analysis.findings.length} 条意见</summary><p>{analysis.summary}</p>{analysis.findings.map(finding=><div key={finding.id} className="my-3"><p>{finding.issue}</p><blockquote className="whitespace-pre-wrap">{finding.quote}</blockquote><p>{finding.suggestion}</p></div>)}</details>)}
          <p className="sw-muted">只检查所选规划原文。作者稿需经比较后采用；工作稿修改不等于作者已接受意见。</p>
          {workspace&&<button type="button" onClick={()=>openResult(workspace)}>比较工作稿并决定采用</button>}
          {workflow&&active(workflow)&&<button type="button" disabled={busy} onClick={()=>control(workflow,'pause')}>暂停检查与修正</button>}
          {workflow?.status==='PAUSED'&&<button type="button" disabled={busy} onClick={()=>control(workflow,'resume')}>继续原检查</button>}
          {workflow&&['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','PAUSED'].includes(workflow.status)&&<button type="button" disabled={busy} onClick={()=>control(workflow,'cancel')}>停止检查与修正</button>}
        </section>;
      })}
      {allCandidates.filter(candidate=>!conversation?.turns.some(turn=>candidateForTurn(turn).some(item=>item.id===candidate.id))).map(renderCandidate)}

      {selectedGoal&&<div className="sw script-assistant-tools script-chat-result space-y-3">
        <div className="flex items-center justify-between"><strong>Agent 委托</strong><span className="sw-muted">{goalRun?runStatusText(goalRun):'读取中'}</span></div>
        <p>{selectedGoal.revision.objective}</p>
        <ScriptGoalProgress review={goalEvidenceUnavailable?null:progressRead.value?.review} project={progressDocument} sceneScope={progressSceneScope}/>
        {progressRead.error!=null&&<p role="alert">{errorText(progressRead.error)}</p>}
        {authorAhead(selectedGoalWorkspace)&&<div role="status"><p>作品内容已更新，继续委托前需同步你最新的修改。</p><button disabled={busy||dirty} onClick={syncAuthor}>同步作品修改</button></div>}
        {selectedGoal.pendingQuestion&&<div className="space-y-2" role="group" aria-label="Agent 等待你的回答">
          <p>{selectedGoal.pendingQuestion.message}</p>
          <div className="sw-inline">{selectedGoal.pendingQuestion.choices.map(choice=><button key={choice.id} disabled={busy||dirty} onClick={()=>answerGoal(choice.text,choice.id)}>{choice.text}</button>)}</div>
          <textarea aria-label="回答 Agent" rows={2} value={answerText} onChange={event=>setAnswerText(event.target.value)} placeholder="也可以说明你的决定…"/>
          <button disabled={busy||dirty||!answerText.trim()} onClick={()=>answerGoal(answerText)}>回答并继续</button>
        </div>}
        <div className="sw-inline">
          {goalRun&&active(goalRun)&&<button disabled={busy} onClick={()=>control(goalRun,'pause')}>暂停委托</button>}
          {goalRun&&!selectedGoal.pendingQuestion&&['PAUSED','NEEDS_REBASE','PARTIAL','FAILED','SUCCEEDED'].includes(goalRun.status)&&<button disabled={busy} onClick={()=>continueGoal(false)}>{dirty?'保存并继续':authorAhead(selectedGoalWorkspace)?'同步并继续':'继续委托'}</button>}
          {goalRun&&['PAUSED','WAITING_INPUT','NEEDS_REBASE','PARTIAL','FAILED','SUCCEEDED'].includes(goalRun.status)&&<button disabled={busy} onClick={()=>setEditGoalOpen(true)}>调整委托</button>}
          {goalRun&&['SUCCEEDED','PARTIAL','PAUSED','FAILED'].includes(goalRun.status)&&<button disabled={busy||dirty} onClick={()=>void previewAdoptionFor(selectedGoalWorkspace)}>查看交付与采用</button>}
        </div>
        {mayLink&&<label><input type="checkbox" checked={linkedGoalId===selectedGoal.id} onChange={event=>setLinkedGoalId(event.target.checked?selectedGoal.id:'')}/>将接下来的消息计入这份已暂停的委托</label>}
        {goalRun?.status==='RECONCILIATION_REQUIRED'&&renderReconciliation(goalRun)}
        {visibleExternal.filter(request=>goalRequestIds.has(request.id)&&!turnRequestIds.has(request.id)).map(renderExternal)}
        {goalResultAnchor&&reviewOpen&&workspaceResult}
        {goalDetails}
      </div>}
      {reviewOpen&&!goalResultAnchor&&!resultCandidateId&&workspaceResult}
      {visibleExternal.filter(request=>!turnRequestIds.has(request.id)&&!goalRequestIds.has(request.id)).map(renderExternal)}
      {unknownRuns.filter(item=>item.id!==goalRun?.id&&!conversation?.turns.some(turn=>turn.runId===item.id)).map(renderReconciliation)}
      {manualRun&&!planningRepairs[manualRun.id]&&!candidateAdoption&&!conversation?.turns.some(turn=>turn.runId===manualRun.id)&&['QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','PAUSED'].includes(manualRun.status)&&<div className="sw script-assistant-tools script-chat-result"><p>上次操作：{runStatusText(manualRun)}</p><button disabled={busy} onClick={()=>control(manualRun,manualRun.status==='PAUSED'?'resume':'pause')}>{manualRun.status==='PAUSED'?'继续操作':'暂停操作'}</button></div>}

      {candidateAdoption&&<div role="status" className="p-3 rounded-2xl bg-bg-surface-soft text-xs space-y-2">
        <p className="text-text-secondary">正在将候选采用到作品…</p>
        {!busy&&error&&<div className="flex gap-2">
          <button type="button" onClick={()=>{adoptionAttempt.current='';setCandidateAdoption({...candidateAdoption});}} className="px-2.5 py-1 rounded-lg bg-text-primary text-bg-surface text-[11px] font-medium cursor-pointer">继续完成采用</button>
          <button type="button" onClick={clearCandidateAdoption} className="px-2.5 py-1 rounded-lg bg-bg-surface text-text-secondary text-[11px] cursor-pointer">暂不写入作品</button>
        </div>}
      </div>}

      {adoptionNotice&&<p role="status" className="text-xs text-text-secondary px-2">{adoptionNotice}{updatedTarget&&onOpenUpdated&&<button type="button" className="underline ml-2" onClick={()=>onOpenUpdated(updatedTarget)}>查看更新位置</button>}</p>}
      {error&&<p role="alert" className="text-xs text-accent-amber px-2">{error}</p>}
      {(hasPending||hasPendingChat||hasPendingSync||hasPendingAdoption||hasPendingBudget)&&<div className="sw script-assistant-tools script-chat-result space-y-2"><strong>上次操作需要确认</strong>{recoveryActions}</div>}
      {legacyContent&&<div className="sw script-assistant-tools rounded-2xl bg-bg-surface-soft p-3 text-xs">{legacyContent}</div>}

      <div ref={messageEnd}/>
    </div>

    {/* Integrated Modern Composer */}
    <div className="script-chat-composer p-3 bg-bg-surface shrink-0 space-y-2" hidden={historyOpen}>
      {chatRun&&<div className="flex flex-wrap gap-2 text-xs">
        {active(chatRun)&&<button type="button" disabled={busy} onClick={()=>control(chatRun,'pause')} className="px-2.5 py-1 rounded-lg text-xs bg-bg-surface-soft text-text-secondary hover:text-text-primary">暂停回复</button>}
        {chatRun.status==='PAUSED'&&<button type="button" disabled={busy} onClick={()=>control(chatRun,'resume')} className="px-2.5 py-1 rounded-lg text-xs bg-bg-surface-soft text-text-secondary hover:text-text-primary">继续回复</button>}
        {chatRun.status==='RECONCILIATION_REQUIRED'&&<button type="button" disabled={busy} onClick={()=>reconcile(chatRun)} className="px-2.5 py-1 rounded-lg text-xs bg-bg-surface-soft text-text-secondary hover:text-text-primary">核对本次返回</button>}
      </div>}

      {unresolvedGoal&&<p role="status" className="text-xs text-accent-amber px-1">{goalUnresolvedMessage}</p>}
      {workingGoal&&<p role="status" className="text-xs text-text-secondary flex items-center justify-between px-1">
        <span>Agent 正在执行…</span>
        <button type="button" disabled={busy} onClick={()=>control(workingGoal,'pause')} className="text-xs text-text-primary underline cursor-pointer">暂停后继续交流</button>
      </p>}
      {dirty&&<p className="text-xs text-accent-amber flex items-center justify-between px-1">
        <span>页面有未保存的修改</span>
        <button type="button" disabled={busy} onClick={()=>void onSave()} className="text-xs text-text-primary underline cursor-pointer">保存当前稿</button>
      </p>}

      {queuedRequest&&<div className="text-xs p-2.5 rounded-xl bg-bg-surface-soft space-y-1.5">
        <p className="text-text-secondary">当前有未发送的内容，是否替换为“<span className="text-text-primary font-medium">{queuedRequest.label}</span>”？</p>
        <div className="flex items-center gap-2">
          <button type="button" className="px-2 py-0.5 rounded-lg bg-text-primary text-bg-surface text-[11px] font-medium cursor-pointer" onClick={()=>useRequest(queuedRequest)}>替换输入</button>
          <button type="button" className="text-[11px] text-text-muted hover:text-text-primary cursor-pointer" onClick={()=>setQueuedRequest(null)}>取消</button>
        </div>
      </div>}

      {/* Integrated Card Container - Clean Surface, No Wireframes */}
      <div className="rounded-2xl bg-bg-surface-soft p-3.5 transition-colors focus-within:bg-bg-surface-hover/80">
        {chatContext?.selection&&<blockquote className="max-h-16 overflow-auto text-xs text-text-muted pl-2 mb-2 italic select-text">{chatContext.selection.text}</blockquote>}
        {candidateDelegation&&<p className="text-xs text-text-muted mb-2">{candidateDelegation==='selection'?'只生成当前选区的修改候选，完成后停止；采用后才更新正文。':'只规划已选批次并生成候选，完成后停止；采用后才更新对应集。'}</p>}

        <textarea
          ref={composer}
          aria-label="给助手的消息"
          rows={3}
          value={chatInput}
          onChange={event=>{
            setChatInput(event.target.value);
            if(!event.target.value.trim())setChatContext(null);
            if(!chatContext&&event.target.value.trim()){
              setChatContext({
                id:0,
                text:'',
                label:scene&&chatTarget==='scene'?'本场讨论':'故事讨论',
                stage:initialStage,
                unitId:unit.id,
                ...(scene&&chatTarget==='scene'?{sceneId:scene.id}:{})
              });
            }
          }}
          onKeyDown={event=>{
            if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229){
              event.preventDefault();
              if(!busy&&!chatRunning&&!chatNeedsReconcile&&!workingGoal)sendFromComposer();
            }
          }}
          placeholder="输入你的想法、问题或修改意见…"
          className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted/60 focus:outline-none focus:ring-0 resize-none leading-relaxed border-none outline-none p-0 block shadow-none"
        />

        <div className="script-chat-actions flex flex-wrap items-center justify-between gap-2 mt-2 pt-2">
          <div className="relative" ref={skillMenuRef}>
            <button
              type="button"
              onClick={()=>{if(!skillMenuOpen)void refreshSkills();setSkillMenuOpen(prev=>!prev);}}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors cursor-pointer border-none outline-none"
              title={isTestMode?"选用 Skill 与执行方式":"选用 Skill"}
            >
              <SlidersHorizontal size={12} />
              <span>{isTestMode?`Skill · ${channel==='api'?'API':'回填'}`:'Skill'}</span>
              {skillIds.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-bg-surface text-[10px] font-mono flex items-center justify-center text-text-primary">
                  {skillIds.length}
                </span>
              )}
              <ChevronDown size={11} className="text-text-muted" />
            </button>

            {skillMenuOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-64 p-3 rounded-2xl bg-bg-surface shadow-2xl z-50 space-y-3">
                <div className="flex items-center justify-between pb-2">
                  <span className="text-xs font-medium text-text-primary">{isTestMode?"选用 Skill 与执行方式":"选用 Skill"}</span>
                  <button type="button" onClick={()=>setSkillMenuOpen(false)} className="text-text-muted hover:text-text-primary cursor-pointer border-none outline-none">
                    <X size={12} />
                  </button>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {skills.map(skill => (
                    <label key={skill.id} className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer py-1 px-1 rounded-lg hover:bg-bg-surface-soft">
                      <input
                        type="checkbox"
                        className="rounded accent-text-primary cursor-pointer border-none outline-none"
                        checked={skillIds.includes(skill.id)}
                        onChange={()=>setSkillIds(old=>old.includes(skill.id)?old.filter(id=>id!==skill.id):[...old,skill.id])}
                      />
                      <span className="truncate">{skill.title}</span>
                    </label>
                  ))}
                  {skillsError?<p role="alert" className="text-xs text-accent-amber">{skillsError}</p>:skills.length === 0 && <p className="text-xs text-text-muted">暂无可选 Skill</p>}
                </div>
                <div className="pt-2 space-y-2">
                  {isTestMode&&<div className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary">通道方式</span>
                    <select
                      aria-label="助手执行方式"
                      value={channel}
                      onChange={event=>setChannel(event.target.value as 'api'|'external')}
                      className="text-xs bg-bg-surface-soft rounded-lg px-2 py-1 text-text-primary border-none outline-none focus:outline-none focus:ring-0"
                    >
                      <option value="api">API 模型</option>
                      <option value="external">复制回填</option>
                    </select>
                  </div>}
                  <a href="/skills" target="_blank" rel="noreferrer" className="block w-full text-center text-xs text-text-secondary hover:text-text-primary py-1 hover:underline">打开全局技能库</a>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              title={chatContext?.discussionDraft?'先创建该集，再委托 Agent 处理其内容':undefined}
              disabled={busy||Boolean(chatContext?.discussionDraft)||Boolean(candidateDelegation&&(!conversation||chatRunning||chatNeedsReconcile||workingGoal||!chatInput.trim()))}
              onClick={()=>{if(candidateDelegation){sendFromComposer();return;}const intent=inferDelegation(project,chatInput,chatContext,unit.id,initialStage);const sceneId=chatContext?.unitId===intent.unitId?chatContext.sceneId:undefined;setGoalUnitId(intent.unitId);setStopAfter(intent.stopAfter);setNewUnits(0);setGoalSceneIds(sceneId?[sceneId]:[]);setGoalNodeId(intent.nodeId||'');setGoalOutlineScope(intent.seasonId||intent.scopeId||'');setGoalRange(intent.nodeId?'node':intent.seasonId?'season':intent.projectOutlineOnly?'project':intent.scopeId&&intent.scopeId!==project.id?'story':sceneId?'scenes':'unit');setIncludeProjectOutline(project.profile.organization==='standalone');setObjective(chatInput||`推进${project.units.find(item=>item.id===intent.unitId)?.title||'当前范围'}，完成${stageLabels[intent.stopAfter]}后停止。`);onRequestAgent?.();}}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors disabled:opacity-40 cursor-pointer border-none outline-none"
            >
              {candidateDelegation==='selection'?'委托修改选区':candidateDelegation==='batch'?'委托本批规划':'交给 Agent'}
            </button>
            <button
              type="button"
              disabled={busy||!conversation||chatRunning||chatNeedsReconcile||Boolean(workingGoal)||!chatInput.trim()}
              onClick={sendFromComposer}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-text-primary text-bg-surface hover:opacity-90 disabled:opacity-30 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer border-none outline-none"
            >
              <Send size={12}/>
              <span>{dirty&&chatContext?.operation&&chatContext.operation!=='consult'?'保存并继续':'发送'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>;
}
