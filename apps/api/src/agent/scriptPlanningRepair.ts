import { parseModelJson } from '../../../../packages/model-output/src';
import {AgentError,hashValue,invokeModel,type AgentRun,type CapabilityRegistry,type ModelRequest,type ModelTransport,type Observation,type RunContext} from '../../../../packages/agent-core/src';
import {compileContext} from '../../../../packages/agent-context/src';
import type {AgentSqliteStore,SqliteContextStore,SqliteModelJournal} from '../../../../packages/agent-sqlite/src';
import {planningRepairEvidence,type PlanningRepairContract,type PlanningRepairResult} from '../../../../packages/script/src/planningRepair';
import {structureAnalysisSchema,validateStructureAnalysis,type StructureAnalysis} from '../../../../packages/script/src/structureAnalysis';
import {prepareAgentMethods} from '../../../../packages/script/src/agentMethods';
import type {MethodBinding} from '../../../../packages/script/src/schema';
import type {ScriptAuthorizationStore} from '../repositories/scriptAuthorizationStore';
import {workspaceRef,type ScriptWorkspaceStore} from '../repositories/scriptWorkspaceStore';
import type {ScriptDraftStore} from '../repositories/scriptDraftStore';

type Dependencies={store:AgentSqliteStore;contexts:SqliteContextStore;journal:SqliteModelJournal;authorizations:ScriptAuthorizationStore;
  workspaces:ScriptWorkspaceStore;drafts:ScriptDraftStore;transport:ModelTransport;
  executionSettings(runId:string):{channel:'api'|'external';routeRef:string;methods:MethodBinding[];authorRequest:string}};
const object=(value:unknown):Record<string,any>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new AgentError('INVALID_PLANNING_REPAIR','规划检查参数无效');return value as Record<string,any>;};
const parse=(value:unknown)=>{const raw=object(value);if(Object.keys(raw).some(key=>!['authorizationRef','round','frozen'].includes(key))||typeof raw.authorizationRef!=='string'||!Number.isInteger(raw.round)||raw.round<0||raw.round>2)throw new AgentError('INVALID_PLANNING_REPAIR','检查轮次必须为 0 到 2');return raw;};

/** A read projection of committed steps, including when cancellation or budget
 * exhaustion stopped the coordinator before it could return a final result. */
export function readScriptPlanningRepairProgress(deps:Pick<Dependencies,'store'|'journal'|'authorizations'|'drafts'>,run:AgentRun):PlanningRepairResult|null{
  if(!(run.input as any)?.planningRepair)return null;
  return deps.authorizations.withRunAuthorization(run,'VIEW',()=>{
    const result:PlanningRepairResult={kind:'PLANNING_REPAIR',roundsUsed:0,analyses:[],candidateIds:[],applicationRefs:[],summary:'规划检查进行中，已保存的意见和工作稿可以随时查看。'};
    for(let round=0;round<=2;round++){
      const check=deps.store.getStep(run.id,run.generation,`planning:check:${round}`);
      if(check?.status==='COMMITTED'){
        deps.journal.assertRunInput((check.prepared.request.input as any).frozen.model,run,'VIEW');
        const data=check.observation?.data as {analysis?:StructureAnalysis;error?:string}|undefined;
        if(data?.analysis)result.analyses.push(data.analysis);
        if(data?.error)result.summary=`检查响应已保存，但引用未通过验证：${data.error}`;
      }
      if(round===2)break;
      const proposal=deps.store.getStep(run.id,run.generation,`planning:propose:${round+1}`);
      const candidateId=(proposal?.observation?.data as any)?.candidateId;
      if(candidateId){deps.drafts.readCandidate(run.ownerId,candidateId,'VIEW');result.candidateIds.push(candidateId);}
      const application=deps.store.getStep(run.id,run.generation,`planning:apply:${round+1}`);
      if(application?.status==='COMMITTED'&&application.observation?.status==='SUCCEEDED'){
        for(const ref of application.observation.artifacts)deps.drafts.readApplication(ref,run.ownerId,'VIEW');
        result.roundsUsed++;result.applicationRefs.push(...application.observation.artifacts);
      }
    }
    if((run.result as any)?.kind==='PLANNING_REPAIR')result.summary=(run.result as PlanningRepairResult).summary;
    else if(['PARTIAL','FAILED','CANCELED','RECONCILIATION_REQUIRED','NEEDS_REBASE'].includes(run.status))result.summary='本次规划返修已停止；已完成的意见、候选和工作稿仍保留，尚未完成的复核不算通过。';
    return result;
  });
}

export function registerScriptPlanningRepair(registry:CapabilityRegistry,deps:Dependencies,implementationDigest:string){
  const {store,contexts,journal,authorizations,workspaces,drafts,transport}=deps;
  registry.register({spec:{id:'script.analyze_planning',version:'1',implementationDigest,
    description:'固定范围的规划原文检查，保存真实引用；不检查正文、不修改作品。',effect:'PROPOSE',cost:'MODEL',dispatch:'DURABLE',replay:'TRANSACTIONAL',
    input:{jsonSchema:{type:'object',additionalProperties:false,required:['authorizationRef','round'],properties:{authorizationRef:{type:'string'},round:{type:'integer',minimum:0,maximum:2}}},parse},
    output:{jsonSchema:{type:'object'},parse:object}},
    async prepare(value,context){const input=parse(value);return contexts.withValidationBatch(()=>{
      const run=store.assertExecution(context.execution),auth=authorizations.forRun(run),contract=(run.input as any).planningRepair as PlanningRepairContract;
      if(!contract||contract.version!==1||contract.maxRepairRounds!==2||input.authorizationRef!==auth.id)throw new AgentError('INVALID_PLANNING_REPAIR','规划检查缺少作者有限返修授权');
      const scope=drafts.scopeForRun(run),workspace=workspaces.read(auth.workspaceId,run.ownerId);
      const applied=(store.db.prepare('SELECT COUNT(*) AS n FROM script_draft_applications WHERE run_id=?').get(run.id) as {n:number}).n;
      if(input.round!==applied)throw new AgentError('INVALID_PLANNING_REPAIR','复核轮次没有对应真实采用回执');
      const evidence=planningRepairEvidence(workspace.document,contract,scope);
      if(!evidence.length)throw new AgentError('PLANNING_EVIDENCE_MISSING','当前范围没有可核对的规划原文');
      const baseRef=workspaceRef(workspace),config=deps.executionSettings(run.id),prior=input.round?store.getStep(run.id,run.generation,`planning:check:${input.round-1}`)?.observation?.data:null;
      const methods=prepareAgentMethods({project:workspace.document,methods:config.methods,operation:'review',targetUnitIds:[contract.target.unitId]});
      const model=authorizations.withRunAuthorization(run,'CONSUME',()=>{
        const bundle=compileContext({systemInstruction:'你是剧本规划审阅助手。按作者意图检查指定大纲、结构节拍或场景规划。只引用 evidence 中真实发送的准确原文，返回指定 JSON；不把规划检查宣称为正文检查或作者验收。复核时逐项核对上一轮意见，仍成立或未修复的问题必须保留；已修复的问题可以移除，不因文本改写就自动视为解决。不要强制节拍数、冲突密度或写作理论。',
          outputSchema:structureAnalysisSchema,skills:methods.skills,sections:[{id:'planning-evidence',text:JSON.stringify({authorRequest:contract.instruction,scope,round:input.round,previousAnalysis:prior,evidence}),required:true,priority:100,dependencies:[{ref:baseRef,freshness:'EXACT'}]}]});
        return {operationKey:`planning-check:${input.round}`,channel:config.channel,routeRef:config.routeRef,prompt:bundle.prompt,systemInstruction:bundle.systemInstruction,outputSchema:structureAnalysisSchema,
          contextRef:contexts.capture({ownerId:run.ownerId,scopeId:workspace.id,branch:`workspace:${workspace.id}`},bundle),inputManifest:{planningRepair:{round:input.round,workspaceRef:baseRef,evidence}}} satisfies ModelRequest;
      });
      return {input:{authorizationRef:auth.id,round:input.round,frozen:{baseRef,evidence,unitId:contract.target.unitId,model}},sources:[baseRef],targets:[]};
    });},
    async execute(call,context){
      const input=parse(call.request.input);if(!input.frozen?.model)throw new AgentError('SCRIPT_INPUT_NOT_PREPARED','规划检查未冻结');
      try{await invokeModel(journal,transport,context.execution,input.frozen.model,context.signal);}catch(error){if(!(error instanceof AgentError)||error.code!=='MODEL_RESULT_METADATA_INVALID')throw error;}
      context.signal.throwIfAborted();
      return contexts.withValidationBatch(()=>store.atomic(()=>{
        const run=store.assertExecution(context.execution),auth=authorizations.forRun(run),workspace=workspaces.read(auth.workspaceId,run.ownerId);
        if(hashValue(workspaceRef(workspace))!==hashValue(input.frozen.baseRef))throw new AgentError('PLANNING_SOURCE_CHANGED','检查期间原文已变化');
        const invocation=journal.prepare(context.execution,input.frozen.model);
        invocation.result=journal.resolvedResult(invocation.id);
        if(invocation.status!=='RECEIVED'||!invocation.result)throw new AgentError('PLANNING_RESULT_MISSING','检查尚未收到可用响应');
        let analysis:StructureAnalysis|null=null,error:string|null=null;
        try{if(invocation.result.validationErrors?.length)throw new Error(invocation.result.validationErrors.join('；'));
          analysis=validateStructureAnalysis(parseModelJson(invocation.result.text),input.frozen.evidence,workspace.documentId,workspace.revision,input.frozen.unitId);
          const target=((run.input as any).planningRepair as PlanningRepairContract).target;analysis.target={unitId:target.unitId,...(target.nodeId?{nodeId:target.nodeId}:{}),...(target.sceneId?{sceneId:target.sceneId}:{})};
        }catch(cause){error=cause instanceof Error?cause.message:'规划分析格式无效';}
        const result:Observation={status:analysis?'SUCCEEDED':'FAILED',summary:analysis?'规划意见和引用已保存':'检查响应已保存，真实引用未通过验证',
          data:{analysis,error,round:input.round,invocationId:invocation.id},evidence:call.sources,artifacts:[],effectState:'NO_EFFECT',retry:'NEVER'};
        return store.commitStep(context.execution,call.request.callId,result,()=>{});
      }));
    },
  });
}

/** Fixed host coordinator: three checks and at most two proposals/applications.
 * Stable calls resume through the existing Step/Journal/lease machinery. */
export async function handleScriptPlanningRepair(context:RunContext,deps:Pick<Dependencies,'store'|'drafts'|'workspaces'|'authorizations'>){
  const contract=(context.run.input as any).planningRepair as PlanningRepairContract,authorizationRef=(context.run.input as any).authorizationRef;
  if(!contract||contract.version!==1||contract.maxRepairRounds!==2)throw new AgentError('INVALID_PLANNING_REPAIR','有限规划返修合同无效');
  const result:PlanningRepairResult={kind:'PLANNING_REPAIR',roundsUsed:0,analyses:[],candidateIds:[],applicationRefs:[],summary:''};
  const finish=(status:'SUCCEEDED'|'PARTIAL',summary:string)=>{result.summary=summary;return {status,result};};
  for(let round=0;round<=2;round++){
    await context.checkpoint();
    const check=await context.call({capabilityId:'script.analyze_planning',capabilityVersion:'1',callId:`planning:check:${round}`,input:{authorizationRef,round}});
    const checked=check.data as {analysis:StructureAnalysis|null;error:string|null};
    if(check.status!=='SUCCEEDED'||!checked.analysis)return finish('PARTIAL',`检查意见未通过验证，已停止；${checked.error||check.summary}`);
    result.analyses.push(checked.analysis);
    if(!checked.analysis.findings.length)return finish('SUCCEEDED',`已完成 ${round} 轮规划修正并复核，当前检查没有发现待修正意见。工作稿仍待作者比较采用。`);
    if(round===2)return finish('PARTIAL','已达到两轮修正上限，未解决意见已保留；请审阅工作稿与最后一次复核。');
    const target=contract.target;
    const proposal=await context.call({capabilityId:'script.propose',capabilityVersion:'1',callId:`planning:propose:${round+1}`,input:{authorizationRef,operation:contract.operation,
      instruction:`${contract.instruction}\n只修正以下真实规划意见，保留授权范围外内容；不写正文。${JSON.stringify(checked.analysis.findings)}`,
      unitId:target.unitId,sceneId:target.sceneId??null,slotId:null,scopeId:target.scopeId??null,entityId:null,blockIds:null,selection:null,
      ...(target.seasonId?{seasonId:target.seasonId}:{}),...(target.nodeId?{nodeId:target.nodeId}:{})}});
    const proposed=proposal.data as {candidateId?:string;delivery?:{missing:string[]};error?:string};
    if(proposed.candidateId)result.candidateIds.push(proposed.candidateId);
    if(proposal.status!=='SUCCEEDED'||!proposed.candidateId||proposed.delivery?.missing.length)return finish('PARTIAL',`候选已保留但未自动采用；${proposed.error||'候选无效或交付尚有缺项'}`);
    const candidate=deps.drafts.readCandidate(context.run.ownerId,proposed.candidateId,'VIEW');
    const callId=`planning:apply:${round+1}`,previous=deps.store.getStep(context.run.id,context.run.generation,callId);
    const workspace=deps.workspaces.read(candidate.workspaceId,context.run.ownerId);
    const input=previous?previous.prepared.request.input:{authorizationRef,candidateId:candidate.id,expectedRevision:Number(candidate.baseRef.version),writerEpoch:workspace.writerEpoch};
    const application=await context.call({capabilityId:'script.apply_patch',capabilityVersion:'1',callId,input});
    if(application.status!=='SUCCEEDED')return finish('PARTIAL','候选未能采用到工作稿，已停止；原作者稿未覆盖。');
    result.roundsUsed=round+1;result.applicationRefs.push(...application.artifacts);
  }
  return finish('PARTIAL','有限规划检查已停止');
}
