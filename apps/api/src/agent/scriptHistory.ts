import { AgentError, ExecutionInvalidated, hashValue, type HistoryPrincipal, type HistoryReadPolicy, type ModelRequest, type ResourceRef, type ExecutionToken, type ReceiptView } from '../../../../packages/agent-core/src';
import type { ContextAccess, Dependency } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore, SqliteContextStore, SqliteHistoryStore } from '../../../../packages/agent-sqlite/src';
import type { ScriptAuthorization, ScriptAuthorizationStore } from '../repositories/scriptAuthorizationStore';
import type { ScriptDraftScope } from '../../../../packages/script/src/agentScope';

export type ScriptHistoryDependencies={store:AgentSqliteStore;contexts:SqliteContextStore;authorizations:ScriptAuthorizationStore;
  /** Synchronous server resolver. It must honor the active authorization stack
   * and recursively validate artifact/context provenance; never fetch URLs. */
  assertSource(ref:ResourceRef,access:ContextAccess,freshness:Dependency['freshness']):void};
const deny=(message:string):never=>{throw new AgentError('SCRIPT_HISTORY_DENIED',message,403);};
const same=(a:unknown,b:unknown)=>hashValue(a)===hashValue(b);
const includes=(all:string[],selected:string[])=>selected.every(value=>all.includes(value));

/** Conservative own-workspace read intersection. A narrowed continuation may
 * not import prose produced under a wider old source context merely because
 * both commands refer to the same workspace. Manual origins retain their own
 * narrower scope; they never inherit the controller's authorization. */
type ConsumedCreation={scenes:Map<string,number>;slots:Map<string,string>};
const none=():ConsumedCreation=>({scenes:new Map(),slots:new Map()});
export function coversScope(reader:ScriptDraftScope,origin:ScriptDraftScope,consumed:ConsumedCreation=none()){
  if(reader.workspaceId!==origin.workspaceId||reader.documentId!==origin.documentId)return false;
  if(!includes(reader.operations,origin.operations))return false;
  if(!includes(reader.storyOutlineScopeIds??[],origin.storyOutlineScopeIds??[])||!includes(reader.seasonOutlineIds??[],origin.seasonOutlineIds??[])||!includes(reader.characterIds??[],origin.characterIds??[])||!includes(reader.factIds??[],origin.factIds??[]))return false;
  if(!includes(reader.sharedFields,origin.sharedFields)||!includes(reader.characterScopeIds,origin.characterScopeIds)||!includes(reader.factScopeIds,origin.factScopeIds))return false;
  if(!origin.newUnitSlots.every(old=>{
    const current=reader.newUnitSlots.find(slot=>slot.slotId===old.slotId);
    return Boolean(current&&current.unitId===old.unitId&&current.scopeId===old.scopeId&&current.targetDurationMs===old.targetDurationMs&&current.maxNewScenes>=old.maxNewScenes ||
      consumed.slots.get(old.slotId)===old.unitId&&reader.units.some(unit=>unit.unitId===old.unitId));
  }))return false;
  return origin.units.every(old=>{
    const current=reader.units.find(unit=>unit.unitId===old.unitId);if(!current||old.allowSummary&&!current.allowSummary||old.allowAllScenes&&!current.allowAllScenes||old.allowStructure&&!current.allowStructure||current.maxNewScenes+(consumed.scenes.get(old.unitId)??0)<old.maxNewScenes)return false;
    if(!current.allowAllScenes&&(old.nodeScopes??[]).some(node=>!current.nodeScopes?.some(allowed=>allowed.nodeId===node.nodeId&&(!node.allowCreate||allowed.allowCreate)&&includes(allowed.sceneIds,node.sceneIds)&&includes(allowed.descendantNodeIds,node.descendantNodeIds)&&(!allowed.stopAfterSceneId||allowed.stopAfterSceneId===node.stopAfterSceneId))))return false;
    return old.scenes.every(scene=>{
      if(current.allowAllScenes)return true;const allowed=current.scenes.find(item=>item.sceneId===scene.sceneId);
      if(!allowed||scene.allowPlan&&!allowed.allowPlan||scene.allowBody&&!allowed.allowBody)return false;
      if(allowed.selection)return Boolean(scene.selection&&same(scene.selection,allowed.selection));
      return allowed.blockIds===null||scene.blockIds!==null&&includes(allowed.blockIds,scene.blockIds);
    });
  });
}

export function createScriptHistoryPolicy(deps:ScriptHistoryDependencies):HistoryReadPolicy{
  const {store,contexts,authorizations}=deps;
  const goalPosition=(auth:ScriptAuthorization)=>{
    if(auth.binding?.kind==='GOAL')return {goalId:auth.binding.goalId,revision:auth.binding.revision};
    if(auth.binding?.kind==='RUN'){
      const row=store.db.prepare('SELECT goal_id,goal_revision,role FROM agent_run_links WHERE run_id=?').get(auth.binding.runId) as {goal_id:string;goal_revision:number;role:string}|undefined;
      if(row?.role==='MANUAL_STEP')return {goalId:row.goal_id,revision:row.goal_revision};
    }
    return null;
  };
  const consumedBetween=(reader:ScriptAuthorization,origin:ScriptAuthorization):ConsumedCreation=>{
    const from=goalPosition(origin),to=goalPosition(reader),consumed=none();
    if(!from||!to||from.goalId!==to.goalId||from.revision>=to.revision)return consumed;
    for(const row of store.db.prepare('SELECT data_json FROM agent_goal_revisions WHERE goal_id=? AND revision>=? AND revision<? ORDER BY revision')
      .all(from.goalId,from.revision,to.revision) as Array<{data_json:string}>){
      const revision=JSON.parse(row.data_json),ledgerRow=(store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?')
        .get(from.goalId,revision.revision) as {data_json:string}|undefined)??
        (store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?').get(revision.authorizationRef) as {data_json:string}|undefined);
      if(!ledgerRow)continue;
      const ledger=JSON.parse(ledgerRow.data_json);
      for(const item of ledger.scenes??[])consumed.scenes.set(item.unitId,(consumed.scenes.get(item.unitId)??0)+1);
      for(const item of ledger.units??[])consumed.slots.set(item.slotId,item.unitId);
    }
    return consumed;
  };
  const principal=(value:HistoryPrincipal):ScriptAuthorization=>{
    const run=store.readRun(value.run.id,value.run.ownerId),auth=authorizations.read(value.link.authorizationRef,run.ownerId),binding=auth.binding;
    if(value.link.runId!==run.id||value.link.goalId!==value.revision.goalId||value.link.goalRevision!==value.revision.revision||auth.threadId!==run.threadId||
      !value.link.workspaceRef||auth.workspaceRef.uri!==value.link.workspaceRef.uri||auth.workspaceRef.branch!==value.link.workspaceRef.branch||!same(auth.workspaceRef,value.link.workspaceRef)||!binding)deny('历史原命令授权身份不一致');
    if(value.link.role==='GOAL_CONTROLLER'){
      if(binding.kind!=='GOAL'||binding.goalId!==value.revision.goalId||binding.revision!==value.revision.revision||auth.id!==value.revision.authorizationRef)deny('历史委托版本不属于原授权');
    }else if(value.link.role==='MANUAL_STEP'){
      if(binding.kind!=='RUN'||binding.runId!==run.id||binding.inputRevision!==run.generation||(run.input as any)?.authorizationRef!==auth.id)deny('历史手动步骤没有独立作者授权');
    }else deny('历史来源不是已绑定的创作工作');
    return auth;
  };
  const access=(auth:ScriptAuthorization):ContextAccess=>({ownerId:auth.ownerId,scopeId:auth.workspaceId,branch:`workspace:${auth.workspaceId}`});
  const frame=<T>(reader:HistoryPrincipal,origin:HistoryPrincipal,read:(original:ScriptAuthorization)=>T):T=>contexts.withValidationBatch(()=>{
    const active=principal(reader),original=principal(origin);
    if(active.ownerId!==original.ownerId||active.workspaceId!==original.workspaceId||reader.link.goalId!==origin.link.goalId||!coversScope(active.scope as ScriptDraftScope,original.scope as ScriptDraftScope,consumedBetween(active,original)))deny('历史原上下文超出当前读取范围');
    return authorizations.withAuthorization(active.id,active.ownerId,'VIEW',()=>authorizations.withAuthorization(original.id,original.ownerId,'VIEW',()=>read(original)));
  });
  const model=(request:ModelRequest,auth:ScriptAuthorization)=>{
    if(!request.contextRef)deny('历史模型调用缺少原始上下文');
    const bundle=contexts.assertVisible(request.contextRef,access(auth));
    if(bundle.prompt!==request.prompt||bundle.systemInstruction!==(request.systemInstruction??'')||!same(bundle.outputSchema??null,request.outputSchema??null))deny('历史请求没有使用原冻结上下文');
  };
  return {
    withValidationBatch:read=>contexts.withValidationBatch(read),
    validationKey:()=>authorizations.readerDigest(),
    authorizeReader({reader,phase,activeReader,sourceAccess}){
      contexts.withValidationBatch(()=>{
        const auth=principal(reader),active=authorizations.activeAuthorization();
        if(active&&(active.ownerId!==auth.ownerId||active.workspaceId!==auth.workspaceId||!coversScope(active.scope as ScriptDraftScope,auth.scope as ScriptDraftScope,consumedBetween(active,auth))))deny('历史原范围超出当前授权');
        if(sourceAccess&&(sourceAccess.ownerId!==auth.ownerId||sourceAccess.scopeId!==auth.workspaceId||sourceAccess.branch!==auth.workspaceRef.branch))deny('历史来源读取范围不匹配');
        authorizations.withAuthorization(auth.id,auth.ownerId,phase,()=>{});
        if(activeReader)frame(activeReader,reader,()=>{});
      });
    },
    authorize(input){frame(input.reader,input.origin,auth=>{
      if(input.kind==='PLAN')for(const intention of input.plan.intentions)for(const ref of intention.evidenceRefs)deps.assertSource(ref,access(auth),'EXACT');
      else if((input.step.prepared.request.input as any)?.authorizationRef!==auth.id)deny('原工具没有绑定原命令授权');
    });},
    assertSamplingView({reader,origin,sampling}){frame(reader,origin,auth=>model(sampling.modelRequest,auth));},
    assertReceiptView({reader,origin,step,invocations}){frame(reader,origin,auth=>{
      const input=step.prepared.request.input as any;
      if(input?.frozen?.model)model(input.frozen.model,auth);
      if(input?.frozen?.contextRef)contexts.assertVisible(input.frozen.contextRef,access(auth));
      for(const invocation of invocations){
        if(invocation.status!=='RECEIVED'||invocation.inputHash!==hashValue(invocation.request))deny('工具模型调用没有确切接收证据');
        model(invocation.request,auth);
      }
      // This includes the independently executed child model's sources as well
      // as its final artifacts. Parent Sampling visibility alone is insufficient.
      for(const ref of [...step.prepared.sources,...step.prepared.targets,...step.observation!.evidence,...step.observation!.artifacts])deps.assertSource(ref,access(auth),'EXACT');
    });},
  };
}

/** ContextStore calls this under its current active Run authorization. Old
 * registered reader descriptors are re-read from durable state, not accepted
 * as client authority; VIEW preserves the requested collection freshness. */
export function createScriptHistorySourceResolver(history:SqliteHistoryStore){
  return (dependency:Dependency,access:ContextAccess):boolean=>{
    try{const reader=history.readerForSource(dependency.ref,access);history.assertSourceForReader(reader,dependency.ref,dependency.freshness,'VIEW',undefined,access);return true;}
    catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;return false;}
  };
}

const pick=(value:any,keys:string[])=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
/** Domain result projection is layered on the generic exact receipt source.
 * The caller cannot make a forged view authoritative: re-resolve the exact
 * reference under the current real token before reading its committed data. */
export function readScriptHistoryResult(deps:{store:AgentSqliteStore;history:SqliteHistoryStore},token:ExecutionToken,view:ReceiptView,access:ContextAccess){
  if(view.state!=='VISIBLE')return null;
  const descriptor=deps.history.readerForSource(view.exactRef,access);
  deps.history.assertSourceForReader(descriptor,view.exactRef,'EXACT','CONSUME',token,access);
  const row=deps.store.db.prepare('SELECT run_id,generation,call_id FROM agent_steps WHERE id=?').get(view.projection.stepId) as any;
  const step=row?deps.store.getStep(row.run_id,row.generation,row.call_id):null;
  if(!step||step.status!=='COMMITTED'||!step.observation||step.runId!==view.projection.origin.runId||
    step.prepared.request.capabilityId!==view.projection.capabilityId||hashValue({preparedDigest:step.prepared.preparedDigest,observation:step.observation})!==view.projection.receiptDigest)deny('历史工具输出与精确回执不一致');
  // Reconstruct the exact bounded generic projection too: an authentic ref
  // cannot be paired with another otherwise well-formed committed step.
  const projection={...view.projection};
  if(view.exactRef.contentHash!==hashValue(projection))deny('历史输出投影已变化');
  const data=step.observation.data as any;let result:any=null;
  if(step.observation.status!=='SUCCEEDED')return {status:step.observation.status};
  switch(view.projection.capabilityId){
    case 'script.read': result={...pick(data,['meaning','sourceRef','nextCursor','hasMore','totalEntries']),rows:(data?.rows??[]).map((r:any)=>pick(r,['unitId','sceneId','title','blockId','type','text','speakerId','speakerName','start','end','length']))};break;
    case 'script.read_conversation':result={...pick(data,['meaning','sourceRef','throughTurnId','total','hasMore','nextCursor']),rows:(data?.rows??[]).map((r:any)=>pick(r,['id','kind','ordinal','status','inputChars','responseChars','inputHash','responseHash','entryId','format','start','end','text']))};break;
    case 'script.check_status':result={...pick(data,['reviewId','workspaceRevision','manifestHash','contractRevision','coverage','repairRoundsUsed','maxRepairRounds','nextCursor','truncated']),tasks:(data?.tasks??[]).map((r:any)=>pick(r,['id','kind','phase','checkId','status','requiredEvidenceTaskIds'])),findings:(data?.findings??[]).map((r:any)=>({...pick(r,['id','issue','suggestion','severity','status','uncertainty']),source:pick(r.source,['unitId','sceneId','blockId','start','end'])}))};break;
    case 'script.check_batch':result=pick(data,['reviewId','receiptId','taskId','error','resolvedFindingIds']);break;
    case 'script.begin_repair':result=pick(data,['repairId','round','findingIds','baselineReviewId','status']);break;
    case 'script.mark_repaired':result=pick(data,['repairId','round','revisedReviewId','requiresRecheck','findingIds']);break;
    default:return null; // candidates/effects are read through their repositories
  }
  if(JSON.stringify(result).length>80000)return {omitted:true,reason:'TOOL_RESULT_TOO_LARGE',readSmallerPage:true};
  return result;
}
