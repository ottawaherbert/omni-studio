import { newId } from './project';
import { sceneHasAuthorWork } from './planning';
import type { MethodBinding, ScriptProject, ScriptOperation } from './schema';
import type { ScriptJob } from './proposals';

export interface ScriptAgentPlanUpdate {
  executionMode?:'api'|'manual';maxCalls?:number;goal?:string;sceneIds?:string[];
  lockedSceneIds?:string[];stepInstructions?:Record<string,string>;pauseAfterPlanning?:boolean;
  sceneEdits?:{sceneId:string;title:string;purpose:string;location:string;timeOfDay:string}[];
}
export type ScriptAgentStrategy = 'plan_only' | 'plan_write' | 'write_existing' | 'review_only' | 'review_all' | 'review_revise';
export interface ScriptAgentRun {
  id: string;
  projectId: string;
  unitId: string;
  goal: string;
  strategy: ScriptAgentStrategy;
  executionMode?: 'api'|'manual';
  /** Older runs omitted this and continue to use published versions. */
  workspace?: 'published' | 'draft';
  baseRevision?: number;
  publicationStatus?: 'draft' | 'published';
  publishedRevision?: number;
  maxScenes: number;
  maxCalls?: number;
  maxRevisionRounds?: number;
  revisionRounds?: number;
  revisionQueue?: {sceneId:string;issues:{issue:string;suggestion:string}[]}[];
  revisionCursor?: number;
  revisionReviewJobId?: string;
  callsUsed?: number;
  lockedSceneIds?: string[];
  stepInstructions?: Record<string,string>;
  pauseAfterPlanning?: boolean;
  skippedScenes?:{sceneId:string;reason:'locked'|'already_written'|'removed';createdAt:number}[];
  methodIds: string[];
  methods: MethodBinding[];
  status: 'paused' | 'running' | 'complete' | 'cancelled';
  phase: 'plan' | 'write' | 'review' | 'revise' | 'done';
  sceneIds: string[];
  cursor: number;
  activeJobId?: string;
  completedJobIds: string[];
  skippedSteps?:{operation:ScriptOperation;sceneId:string;jobId?:string;reason:string;createdAt:number}[];
  syncHistory?: {fromRevision:number;toRevision:number;draftRevision:number;overriddenSceneIds:string[];retiredJobId?:string;createdAt:number}[];
  error?: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

const hasBody = (scene: ScriptProject['units'][number]['scenes'][number]) =>
  scene.blocks.some(block => block.type !== 'note' && block.text.trim());

export function agentPlanCapacity(run:ScriptAgentRun,project:ScriptProject):number{
  if(run.strategy!=='plan_write')return run.maxScenes;
  const unit=project.units.find(item=>item.id===run.unitId);
  if(!unit)throw new Error('Agent 目标单元不存在');
  const plannedBlank=unit.scenes.filter(scene=>!hasBody(scene)&&sceneHasAuthorWork(scene)).length;
  return Math.max(0,run.maxScenes-plannedBlank);
}

export function agentReviewSceneIds(run:ScriptAgentRun,project:ScriptProject):string[]{
  const unit=project.units.find(item=>item.id===run.unitId);
  if(!unit)throw new Error('Agent 目标单元不存在');
  const ids=run.strategy==='review_all'?run.sceneIds.slice(run.cursor,run.cursor+run.maxScenes)
    : run.sceneIds.length?run.sceneIds:unit.scenes.slice(0,run.maxScenes).map(scene=>scene.id);
  if(!ids.length||ids.some(id=>!unit.scenes.some(scene=>scene.id===id)))throw new Error('Agent 审阅范围已失效');
  return ids;
}

export function aggregateAgentReviewFindings(jobs:ScriptJob[]){
  const seen=new Set<string>();
  return jobs.flatMap(job=>(job.result?.findings||[]).map((finding,index)=>({job,finding,index})))
    .filter(({finding})=>{
      const key=`${finding.sceneId}\0${finding.issue.trim().replace(/\s+/g,' ')}`;
      if(seen.has(key))return false;
      seen.add(key);return true;
    });
}

export function createScriptAgentRun(project: ScriptProject, input: {
  unitId: string; goal: string; strategy: ScriptAgentStrategy; maxScenes: number; methodIds?: string[]; startSceneId?: string; workspace?: 'published' | 'draft'; executionMode?: 'api'|'manual';maxCalls?:number;lockedSceneIds?:string[];pauseAfterPlanning?:boolean;maxRevisionRounds?:number;
},methodSource=project.methods): ScriptAgentRun {
  const unit = project.units.find(item => item.id === input.unitId);
  if (!unit?.scenes.length) throw new Error('先建立至少一张场景卡');
  if (!['plan_only','plan_write','write_existing','review_only','review_all','review_revise'].includes(input.strategy)) throw new Error('未知 Agent 工作范围');
  if(input.workspace!==undefined&&!['published','draft'].includes(input.workspace))throw new Error('未知 Agent 工作区');
  if(input.executionMode!==undefined&&!['api','manual'].includes(input.executionMode))throw new Error('未知模型执行方式');
  if (typeof input.goal !== 'string' || !input.goal.trim() || input.goal.length > 5000) throw new Error('请填写本次 Agent 目标');
  if (!Number.isInteger(input.maxScenes) || input.maxScenes < 1 || input.maxScenes > 30) throw new Error('本次最多处理 1–30 场');
  const maxRevisionRounds=input.maxRevisionRounds??1;
  if(!Number.isInteger(maxRevisionRounds)||maxRevisionRounds<1||maxRevisionRounds>3)throw new Error('修订轮数需要 1–3 轮');
  if(input.strategy==='review_revise'&&input.workspace==='published')throw new Error('自动修订只能在独立工作草稿中进行');
  const maxCalls=input.maxCalls??input.maxScenes*2+2;
  if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>1000)throw new Error('调用预算需要 1–1000 次');
  const lockedSceneIds=input.lockedSceneIds||[];
  if(!Array.isArray(lockedSceneIds)||new Set(lockedSceneIds).size!==lockedSceneIds.length||lockedSceneIds.some(id=>!unit.scenes.some(scene=>scene.id===id)))throw new Error('锁定场景必须属于当前单元且不能重复');
  if(input.pauseAfterPlanning!==undefined&&typeof input.pauseAfterPlanning!=='boolean')throw new Error('分场后暂停设置无效');
  const methodIds = input.methodIds || [];
  if (!Array.isArray(methodIds) || methodIds.some(id => typeof id !== 'string' || !methodSource.some(m => m.id === id)) || new Set(methodIds).size !== methodIds.length) throw new Error('所选 Skill 不可用或存在重复');
  const reviewStartIndex=['review_only','review_all','review_revise'].includes(input.strategy)&&input.startSceneId?unit.scenes.findIndex(scene=>scene.id===input.startSceneId):0;
  if(reviewStartIndex<0)throw new Error('审阅起点场景不存在');
  const sceneIds = input.strategy === 'write_existing' ? unit.scenes.filter(scene => !hasBody(scene)).slice(0,input.maxScenes).map(scene => scene.id)
    : ['review_only','review_revise'].includes(input.strategy)?unit.scenes.slice(reviewStartIndex,reviewStartIndex+input.maxScenes).map(scene=>scene.id)
    : input.strategy==='review_all'?unit.scenes.slice(reviewStartIndex).filter(hasBody).map(scene=>scene.id):[];
  if (input.strategy === 'write_existing' && !sceneIds.length) throw new Error('当前单元没有待写正文的场景');
  if (input.strategy === 'review_all' && !sceneIds.length) throw new Error('当前范围没有已写正文的场景');
  const existingPlannedBlank=unit.scenes.filter(scene=>!hasBody(scene)&&sceneHasAuthorWork(scene));
  const skipPlan=input.strategy==='plan_write'&&existingPlannedBlank.length>=input.maxScenes;
  if(skipPlan)sceneIds.push(...existingPlannedBlank.slice(0,input.maxScenes).map(scene=>scene.id));
  const now=Date.now();
  const workspace=input.workspace||'draft';
  return { id:newId('agent'), projectId:project.id, unitId:unit.id, goal:input.goal.trim(), strategy:input.strategy,executionMode:input.executionMode||'api', workspace,baseRevision:project.revision,...(workspace==='draft'?{publicationStatus:'draft' as const}:{}),maxScenes:input.maxScenes, methodIds,
    maxCalls,callsUsed:0,maxRevisionRounds,revisionRounds:0,lockedSceneIds:[...lockedSceneIds],stepInstructions:{},pauseAfterPlanning:input.pauseAfterPlanning||false,
    methods:structuredClone(methodSource.filter(method=>methodIds.includes(method.id))),
    status:'paused', phase:input.strategy === 'write_existing'||skipPlan ? 'write' : ['review_only','review_all','review_revise'].includes(input.strategy)?'review':'plan', sceneIds, cursor:0, completedJobIds:[], version:1, createdAt:now, updatedAt:now };
}

export function agentTaskTarget(run: ScriptAgentRun, project: ScriptProject): {operation: ScriptOperation; sceneId: string} | null {
  const unit=project.units.find(item => item.id === run.unitId);
  if (!unit?.scenes.length || run.phase === 'done') return null;
  if (run.phase === 'plan') return {operation:'plan',sceneId:unit.scenes[0].id};
  if (run.phase === 'revise') { const sceneId=run.revisionQueue?.[run.revisionCursor||0]?.sceneId;return sceneId?{operation:'rewrite',sceneId}:null; }
  if (run.phase === 'review') return {operation:'review',sceneId:agentReviewSceneIds(run,project)[0]};
  const sceneId=run.sceneIds[run.cursor];
  return sceneId && unit.scenes.some(scene => scene.id === sceneId) ? {operation:'scene',sceneId} : null;
}

export function advanceScriptAgentRun(run: ScriptAgentRun, project: ScriptProject, job: ScriptJob): ScriptAgentRun {
  const target=agentTaskTarget(run,project);
  if (run.status !== 'running' || job.id !== run.activeJobId || !target || job.operation !== target.operation || (run.phase !== 'plan' && job.sceneId !== target.sceneId) || job.projectId !== project.id || job.unitId !== run.unitId) throw new Error('Agent 步骤与当前任务不匹配');
  if (job.status !== (run.phase === 'review' ? 'ready' : 'approved')) throw new Error('本步结果尚未完成');
  const next: ScriptAgentRun = structuredClone(run);
  next.completedJobIds.push(job.id);
  delete next.activeJobId;
  delete next.error;
  if (run.phase === 'plan') {
    if (run.strategy === 'plan_only') { next.phase='done'; next.status='complete'; }
    else {
      const unit=project.units.find(item => item.id === run.unitId)!;
      next.sceneIds=unit.scenes.filter(scene => !hasBody(scene)&&sceneHasAuthorWork(scene)).slice(0,run.maxScenes).map(scene => scene.id);
      next.cursor=0;
      next.phase=next.sceneIds.length ? 'write' : 'review';
      if(run.pauseAfterPlanning)next.status='paused';
    }
  } else if (run.phase === 'write') {
    next.cursor++;
    if (next.cursor >= next.sceneIds.length) next.phase='review';
  } else if(run.phase==='revise') {
    next.revisionCursor=(run.revisionCursor||0)+1;
    if(next.revisionCursor>=(run.revisionQueue?.length||0))next.phase='review';
  } else if(run.strategy==='review_revise') {
    const expected=agentReviewSceneIds(run,project);
    if(JSON.stringify(job.reviewSceneIds)!==JSON.stringify(expected))throw new Error('修订审阅范围与任务不一致');
    const unit=project.units.find(item=>item.id===run.unitId)!;
    const queue=expected.filter(id=>!run.lockedSceneIds?.includes(id)&&unit.scenes.some(scene=>scene.id===id&&hasBody(scene)))
      .map(sceneId=>({sceneId,issues:(job.result?.findings||[]).filter(finding=>finding.sceneId===sceneId).map(({issue,suggestion})=>({issue,suggestion}))})).filter(item=>item.issues.length);
    if(queue.length&&(run.revisionRounds||0)<(run.maxRevisionRounds||1)){
      next.phase='revise';next.revisionQueue=queue;next.revisionCursor=0;next.revisionRounds=(run.revisionRounds||0)+1;next.revisionReviewJobId=job.id;
    }else{next.phase='done';next.status='complete';}
  } else if(run.strategy==='review_all') {
    const expected=agentReviewSceneIds(run,project);
    if(JSON.stringify(job.reviewSceneIds)!==JSON.stringify(expected))throw new Error('本批审阅范围与任务不一致');
    next.cursor+=expected.length;
    if(next.cursor>=next.sceneIds.length){next.phase='done';next.status='complete';}
  } else { next.phase='done'; next.status='complete'; }
  next.version++;
  next.updatedAt=Date.now();
  return next;
}
