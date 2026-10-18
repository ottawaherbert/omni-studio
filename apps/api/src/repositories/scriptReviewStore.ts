import { parseModelJson } from '../../../../packages/model-output/src';
import { stageDelivery, type ScriptStage } from '../../../../packages/script/src/agentStages';
import { emptyScriptDraftCreationLedger, type ScriptDraftCreationLedger, type ScriptDraftScope } from '../../../../packages/script/src/agentScope';
import { storyProgress, type OutlineCoverageEntry, type OutlineRequirement } from '../../../../packages/script/src/goalCoverage';
import { sha256 } from 'js-sha256';
import { AgentError, ExecutionInvalidated, hashValue, type AgentRun, type ExecutionToken, type ModelRequest, type Observation, type ResourceRef } from '../../../../packages/agent-core/src';
import type { ContextAccess, ContextSection } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore, SqliteContextStore, SqliteModelJournal } from '../../../../packages/agent-sqlite/src';
import { assessCheckCoverage, assessGoalCandidate, carryForwardUnchangedLocalReceipts, createCheckPlan, createGoalBodyManifest, validateCheckReceipt,
  type CheckFinding, type CheckPlan, type CheckReceipt, type CheckSpan, type CheckTask, type GoalArtifact, type GoalBodyManifest, type GoalCheckContract, type ReviewFinding } from '../../../../packages/script/src/goalChecks';
import { workspaceRef, type ScriptWorkspaceStore } from './scriptWorkspaceStore';

export type ReviewAuthority = {stage?:ScriptStage;stageScope?:ScriptDraftScope; reviewScopeId:string; workspaceId:string; authorizationRef:string; contract:GoalCheckContract };
export type ReviewSet = { id:string; ownerId:string; workspaceId:string; reviewScopeId:string; contract:GoalCheckContract; manifest:GoalBodyManifest;
  plan:CheckPlan; baseRef:ResourceRef; receipts:CheckReceipt[]; findings:ReviewFinding[]; findingSources:Array<{findingId:string;reviewId:string;receiptId:string}>; repairRoundsUsed:number };
export type ReviewRepair = { id:string; reviewScopeId:string; baselineReviewId:string; findingIds:string[]; round:number; applicationRef:ResourceRef|null;
  revisedReviewId:string|null; mappings:Array<{findingId:string; raw:CheckSpan[]}> };
export type ReviewBatch = { reviewId:string; task:CheckTask; payload:{ raw:Array<CheckSpan & {text:string}>; index:CheckTask['requiredIndex'];
  evidence:CheckReceipt['input']['evidence']; rechecks:Array<{finding:ReviewFinding;raw:CheckSpan[]}>;outline?:OutlineRequirement[] };
  section:ContextSection; inputManifest:{scriptReview:{reviewId:string;taskId:string;payloadHash:string}}; outputSchema:Record<string,unknown>; sourceRefs:ResourceRef[] };
/** Batch-local display IDs never change the manuscript or receipt IDs. */
function reviewBlockAliases(payload:ReviewBatch['payload']){
  const blocks=[...payload.raw,...payload.index],ids=[...new Set(blocks.map(item=>item.blockId))];
  if(payload.raw.length<=64&&payload.index.length<=64)return new Map<string,string>();
  const originals=new Set([...ids,...payload.rechecks.flatMap(item=>[item.finding.source.blockId,...item.raw.map(span=>span.blockId)])]);
  let prefix='@';while(ids.some((_,index)=>originals.has(`${prefix}${index+1}`)))prefix+='@';
  return new Map(ids.map((id,index)=>[id,`${prefix}${index+1}`]));
}
export type ReviewCompletionProof = { reviewId:string; workspaceRef:ResourceRef; reviewDigest:string; stateDigest:string; artifact:GoalArtifact };
export type ScriptReviewPolicy = {
  forRun(run:AgentRun,phase:'VIEW'|'CONSUME'):ReviewAuthority;
  withRunAuthorization?<T>(run:AgentRun,phase:'VIEW'|'CONSUME',read:()=>T):T;
  /** These facts must be derived from the durable application receipt, never a
   * model/caller declaration. The repository independently reads both versions. */
  repairApplication?(run:AgentRun,applicationRef:ResourceRef):{workspaceId:string;beforeRevision:number;afterRevision:number};
  reserveRepair?(token:ExecutionToken,operationId:string):boolean;
  completionState?(run:AgentRun,review:Pick<ReviewSet,'workspaceId'>):{unresolvedUnknown:boolean;outOfScopeWrites:boolean;structureAlignment?:{aligned:boolean;evidenceHash:string}};
};
const denied=(message:string):never=>{throw new AgentError('SCRIPT_REVIEW_DENIED',message,403);};
const same=(a:unknown,b:unknown)=>hashValue(a)===hashValue(b);
// goalChecks fingerprints deliberately use its JSON-order-preserving digest.
const checkDigest=(value:unknown)=>sha256(JSON.stringify(value));
const access=(ownerId:string,workspaceId:string):ContextAccess=>({ownerId,scopeId:workspaceId,branch:`workspace:${workspaceId}`});
const blocks=(manifest:GoalBodyManifest)=>manifest.units.flatMap(u=>u.scenes.flatMap(s=>s.blocks));
const location=(span:Pick<CheckSpan,'unitId'|'sceneId'|'blockId'>)=>`${span.unitId}/${span.sceneId}/${span.blockId}`;
const sync=<T>(value:T):T=>{if(value&&typeof(value as any).then==='function')denied('审阅授权和事务策略必须同步');return value;};
const object=(properties:Record<string,unknown>)=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'};
/** Fully specified strict schema: nullable offsets are required by strict
 * providers and normalized away for index findings after host validation. */
export const scriptCheckOutputSchema:Record<string,unknown>=object({summary:string,findings:{type:'array',items:object({id:string,issue:string,suggestion:string,
  severity:{type:'string',enum:['BLOCKING','ADVISORY']},basis:{type:'string',enum:['RAW','INDEX']},
  source:object({unitId:string,sceneId:string,blockId:string,start:{type:['integer','null']},end:{type:['integer','null']}}),uncertainty:string})},
  resolvedFindingIds:{type:'array',items:string}});
const outlineCheckOutputSchema=object({...scriptCheckOutputSchema.properties as Record<string,unknown>,outlineCoverage:{type:'array',items:object({requirementId:string,
  status:{type:'string',enum:['UNEXPANDED','PLANNED','PARTIAL','DRAFT_READY']},reason:string,
  evidence:{type:'array',items:object({sceneId:string,blockId:string,start:{type:'integer'},end:{type:'integer'}})}})}});

/** Check coverage comes exclusively from the persisted request's required
 * ContextSection. Raw model output and the domain effect receipt commit together. */
export class ScriptReviewStore {
  constructor(private readonly store:AgentSqliteStore,private readonly workspaces:ScriptWorkspaceStore,
    private readonly contexts:SqliteContextStore,private readonly journal:SqliteModelJournal,private readonly policy:ScriptReviewPolicy){
    if(typeof policy?.forRun!=='function')denied('审阅仓储缺少授权策略');
  }
  private withRunAuthorization<T>(run:AgentRun,phase:'VIEW'|'CONSUME',read:()=>T):T {
    return this.policy.withRunAuthorization ? this.policy.withRunAuthorization(run,phase,read) : read();
  }
  ensureSchema(){this.store.db.exec(`
    CREATE TABLE IF NOT EXISTS script_review_sets(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,workspace_id TEXT NOT NULL,scope_id TEXT NOT NULL,contract_hash TEXT NOT NULL,manifest_hash TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(scope_id,workspace_id,contract_hash,manifest_hash));
    CREATE TABLE IF NOT EXISTS script_check_results(id TEXT PRIMARY KEY,review_id TEXT NOT NULL REFERENCES script_review_sets(id),step_id TEXT NOT NULL UNIQUE REFERENCES agent_steps(id),invocation_id TEXT NOT NULL UNIQUE REFERENCES agent_invocations(id),data_json TEXT NOT NULL,observation_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS script_review_repairs(id TEXT PRIMARY KEY,scope_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(scope_id,operation_id));
  `);}
  private authority(subject:ExecutionToken|AgentRun,phase:'VIEW'|'CONSUME'='CONSUME'){
    const run='runId' in subject?this.store.assertExecution(subject):this.store.readRun(subject.id,subject.ownerId);
    if(!('runId' in subject)&&(run.version!==subject.version||run.generation!==subject.generation))throw new ExecutionInvalidated('SCRIPT_COMPLETION_CHANGED','结算所用任务版本已改变');
    const auth=sync(this.policy.forRun(run,phase));
    if(!auth.reviewScopeId||!auth.workspaceId||!auth.authorizationRef)denied('缺少固定审阅范围');
    const workspace=this.workspaces.read(auth.workspaceId,run.ownerId);
    if(workspace.threadId!==run.threadId)denied('工作稿与执行会话不一致');
    return {run,auth,workspace};
  }
  private load(id:string,ownerId:string):ReviewSet{
    const row=this.store.db.prepare('SELECT * FROM script_review_sets WHERE id=? AND owner_id=?').get(id,ownerId) as any;
    if(!row)throw new AgentError('SCRIPT_REVIEW_NOT_FOUND','审阅记录不存在或不属于作者',404);
    const data=JSON.parse(row.data_json) as ReviewSet;
    if(data.id!==row.id||data.workspaceId!==row.workspace_id||data.reviewScopeId!==row.scope_id||data.manifest.hash!==row.manifest_hash||hashValue(data.contract)!==row.contract_hash)denied('审阅记录身份损坏');
    return data;
  }
  private save(review:ReviewSet){this.store.db.prepare('UPDATE script_review_sets SET data_json=? WHERE id=?').run(JSON.stringify(review),review.id);}
  private receiptVisible(review:ReviewSet,receipt:CheckReceipt){
    return this.contexts.withValidationBatch(()=>{
    // Carry-forward receipts keep the original invocation/context as evidence.
    this.contexts.assertVisible(receipt.input.contextRef,access(review.ownerId,review.workspaceId));
    const source=this.journal.read(receipt.input.invocationId);
    source.result=this.journal.resolvedResult(source.id);
    if(source.status!=='RECEIVED'||source.inputHash!==receipt.input.inputHash||!source.result)denied('审阅回执缺少收到的模型结果');
    const row=this.store.db.prepare('SELECT data_json FROM script_check_results WHERE invocation_id=?').get(source.id) as any;
    if(!row)denied('审阅回执缺少原始检查记录');
    const record=JSON.parse(row.data_json),original=record.receipt as CheckReceipt;
    const {validatedManifestHash:_validated,carriedFromReceiptId:_carried,...content}=receipt;
    const {validatedManifestHash:_oldValidated,carriedFromReceiptId:_oldCarried,...oldContent}=original;
    if(!same(record.modelRequest,source.request)||!same(record.modelResult,source.result)||record.raw!==source.result.text||
      receipt.taskFingerprint!==original.taskFingerprint||!same({...content,id:original.id,taskId:original.taskId},oldContent))denied('审阅回执或原始模型证据已变化');
    if(!this.contexts.hasArtifact('script-check-result',original.id))denied('检查结果未绑定原始上下文');
    this.contexts.assertArtifact('script-check-result',original.id,'VIEW');
    });
  }
  private visible(review:ReviewSet){
    this.workspaces.version(review.workspaceId,review.ownerId,review.manifest.revision);
    for(const receipt of review.receipts)this.receiptVisible(review,receipt);
    for(const finding of review.findings)this.findingSource(review,finding.id);
    return review;
  }
  /** A withdrawn source cannot count as check coverage. Keep the original
   * invocation and result rows for audit, while letting the current plan ask
   * for a fresh check against the same manuscript. */
  private usable(review:ReviewSet,persist:boolean):ReviewSet{
    this.workspaces.version(review.workspaceId,review.ownerId,review.manifest.revision);
    const withdrawn=(error:unknown)=>error instanceof AgentError&&
      ['CONTEXT_REVOKED','CONTEXT_SOURCE_INVALID','MEMORY_STALE','MEMORY_NOT_FOUND','MEMORY_SOURCE_RANGE_DENIED'].includes(error.code);
    const receipts=review.receipts.filter(receipt=>{try{this.receiptVisible(review,receipt);return true;}catch(error){if(withdrawn(error))return false;throw error;}});
    const validIds=new Set(receipts.map(receipt=>receipt.id));
    const findings=review.findings.flatMap(finding=>{
      try{this.findingSource(review,finding.id);}catch(error){if(withdrawn(error))return [];throw error;}
      if(finding.verificationReceiptId&&!validIds.has(finding.verificationReceiptId))return [{...finding,status:'UNRESOLVED' as const,verificationReceiptId:undefined}];
      return [finding];
    });
    const findingIds=new Set(findings.map(finding=>finding.id));
    const findingSources=review.findingSources.filter(source=>findingIds.has(source.findingId));
    if(receipts.length===review.receipts.length&&same(findings,review.findings)&&findingSources.length===review.findingSources.length)return review;
    const current={...review,receipts,findings,findingSources};if(persist)this.save(current);return current;
  }
  private findingSource(review:ReviewSet,findingId:string){
    const source=review.findingSources.find(s=>s.findingId===findingId);if(!source)denied('审阅问题没有原始来源回执');
    const origin=this.load(source.reviewId,review.ownerId),receipt=origin.receipts.find(r=>r.id===source.receiptId);
    const finding=review.findings.find(f=>f.id===findingId),original=receipt?.findings.find(f=>f.id===findingId);
    const fields=(f:CheckFinding)=>({id:f.id,issue:f.issue,suggestion:f.suggestion,severity:f.severity,basis:f.basis,source:f.source,uncertainty:f.uncertainty});
    if(origin.reviewScopeId!==review.reviewScopeId||origin.workspaceId!==review.workspaceId||!receipt||!original||!finding||!same(fields(finding),fields(original)))denied('问题原始来源已变化');
    this.receiptVisible(origin,receipt);return {origin,receipt,ref:this.receiptRef(origin,receipt)};
  }
  private repairRows(scopeId:string):ReviewRepair[]{return (this.store.db.prepare('SELECT data_json FROM script_review_repairs WHERE scope_id=? ORDER BY rowid').all(scopeId) as any[]).map(r=>JSON.parse(r.data_json));}
  ensurePlan(token:ExecutionToken):ReviewSet{return this.currentPlan(token,true);}
  private currentPlan(token:ExecutionToken|AgentRun,persist:boolean,phase:'VIEW'|'CONSUME'='CONSUME'):ReviewSet{
    return this.store.atomic(()=>{
      const {run,auth,workspace}=this.authority(token,phase),manifest=createGoalBodyManifest(workspace.document,auth.contract.targetUnitIds,auth.contract.targetScenes),plan=createCheckPlan(manifest,auth.contract);
      const id=`review_${hashValue({scope:auth.reviewScopeId,workspace:workspace.id,contract:auth.contract,manifest:manifest.hash}).slice(0,40)}`;
      const old=this.store.db.prepare('SELECT id FROM script_review_sets WHERE id=?').get(id);
      if(old)return this.usable(this.load(id,run.ownerId),persist);
      const priorRow=this.store.db.prepare('SELECT id FROM script_review_sets WHERE owner_id=? AND workspace_id=? AND scope_id=? AND contract_hash=? ORDER BY rowid DESC LIMIT 1').get(run.ownerId,workspace.id,auth.reviewScopeId,hashValue(auth.contract)) as any;
      const prior=priorRow?this.usable(this.load(priorRow.id,run.ownerId),false):null;
      const receipts=prior?carryForwardUnchangedLocalReceipts(prior.manifest,prior.plan,manifest,plan,prior.receipts):[];
      const findings=prior?prior.findings.map(f=>({...f,status:f.status==='AUTHOR_ACCEPTED'?'AUTHOR_ACCEPTED':'UNRESOLVED'} as ReviewFinding)):[];
      const review:ReviewSet={id,ownerId:run.ownerId,workspaceId:workspace.id,reviewScopeId:auth.reviewScopeId,contract:structuredClone(auth.contract),manifest,plan,baseRef:workspaceRef(workspace),receipts,findings,findingSources:prior?structuredClone(prior.findingSources):[],repairRoundsUsed:this.repairRows(auth.reviewScopeId).length};
      if(persist)this.store.db.prepare('INSERT INTO script_review_sets VALUES(?,?,?,?,?,?,?)').run(id,run.ownerId,workspace.id,auth.reviewScopeId,hashValue(auth.contract),manifest.hash,JSON.stringify(review));
      return review;
    });
  }
  readStatus(token:ExecutionToken){return this.ensurePlan(token);}
  /** A finished Goal reports the checked manuscript version. Adoption or an
   * author edit may advance the workspace without rewriting its old verdict. */
  private authorPlan(run:AgentRun):ReviewSet{
    if(run.status==='SUCCEEDED'){
      const {auth}=this.authority(run,'VIEW');
      const final=(run.result as {artifactRefs?:ResourceRef[]}|null)?.artifactRefs?.find(ref=>
        ref.uri===`resource://script/workspaces/${auth.workspaceId}`&&ref.branch===`workspace:${auth.workspaceId}`);
      if(!final)denied('已完成委托的成果版本不存在');
      const rows=this.store.db.prepare(`SELECT id FROM script_review_sets
        WHERE owner_id=? AND workspace_id=? AND scope_id=? AND contract_hash=? ORDER BY rowid DESC`)
        .all(run.ownerId,auth.workspaceId,auth.reviewScopeId,hashValue(auth.contract)) as Array<{id:string}>;
      for(const row of rows){
        const review=this.load(row.id,run.ownerId);
        if(same(review.baseRef,final))return this.usable(review,false);
      }
      denied('已完成委托的原始审阅记录不存在');
    }
    return this.currentPlan(run,false,'VIEW');
  }
  /** Author-facing projection. It is derived from the same checked plan and
   * source-bound receipts as the executor, but never creates a review row. */
  readAuthorStatus(run:AgentRun){return this.authorStatus(run,true);}
  /** Same live authority, receipt and historical-version checks, without
   * reconstructing findings/original text that the progress summary never uses. */
  readAuthorProgress(run:AgentRun){
    const {tasks:_tasks,findings:_findings,...progress}=this.authorStatus(run,false);
    return progress;
  }
  private authorStatus(run:AgentRun,details:boolean){
   return this.contexts.withValidationBatch(()=>this.withRunAuthorization(run,'VIEW',()=>{
    const authority=this.authority(run,'VIEW');
    if(authority.auth.stage&&authority.auth.stageScope){
      const final=run.status==='SUCCEEDED'?(run.result as {artifactRefs?:ResourceRef[]}|null)?.artifactRefs?.find(ref=>ref.uri===`resource://script/workspaces/${authority.workspace.id}`&&ref.branch===`workspace:${authority.workspace.id}`):undefined;
      const document=final?this.workspaces.version(authority.workspace.id,run.ownerId,Number(final.version)):authority.workspace.document;
      const delivery=stageDelivery(document,authority.auth.stageScope,authority.auth.stage,{ledger:this.stageLedger(run,authority.auth),contract:authority.auth.contract});
      const contract=authority.auth.contract;
      return {reviewId:`stage:${authority.auth.reviewScopeId}`,workspaceId:authority.workspace.id,manifestHash:hashValue(delivery.content),workspaceRevision:document.revision,targetUnitIds:contract.targetUnitIds,
        coverage:{localComplete:false,globalComplete:false,missingTaskIds:[] as string[],invalidReceipts:[] as Array<{taskId:string;reason:string}>},repairRoundsUsed:0,maxRepairRounds:contract.maxRepairRounds,tasks:[],findings:[],
        ...(contract.storyCoverage?{storyProgress:storyProgress(document,contract.outlineRequirements??[]),outlineGaps:[...new Set([...(contract.outlineGaps??[]),...delivery.gaps])]}:{})};
    }
    const review=this.authorPlan(run);
    const coverage=assessCheckCoverage(review.manifest,review.plan,review.receipts);
    const receiptByTask=new Map((details?review.plan.tasks:[]).map(task=>{
      const attempts=review.receipts.filter(receipt=>receipt.taskId===task.id);
      const valid=[...attempts].reverse().find(receipt=>validateCheckReceipt(review.manifest,review.plan,receipt,review.receipts).valid);
      return [task.id,valid??attempts.at(-1)] as const;
    }));
    const roots=review.plan.tasks.filter(task=>task.checkId==='story_coverage'&&task.phase==='SYNTHESIS'&&!review.plan.tasks.some(other=>other.requiredEvidenceTaskIds.includes(task.id)));
    const final=roots.length===1?[...review.receipts].reverse().find(receipt=>receipt.taskId===roots[0].id&&validateCheckReceipt(review.manifest,review.plan,receipt,review.receipts).valid):undefined;
    // Completed tasks retain their checked historical version; active tasks use
    // the current review contract. Invalid/missing roots cannot claim readiness.
    const document=this.workspaces.version(review.workspaceId,run.ownerId,review.manifest.revision);
    const progress=review.contract.storyCoverage?storyProgress(document,review.contract.outlineRequirements??[],final?.outlineCoverage):undefined;
    return {
      reviewId:review.id,workspaceId:review.workspaceId,manifestHash:review.manifest.hash,
      workspaceRevision:review.manifest.revision,targetUnitIds:review.manifest.targetUnitIds,
      coverage,repairRoundsUsed:review.repairRoundsUsed,maxRepairRounds:review.contract.maxRepairRounds,
      ...(progress?{storyProgress:progress,outlineGaps:review.contract.outlineGaps??[]}:{}),
      tasks:(details?review.plan.tasks:[]).map(task=>({id:task.id,kind:task.kind,phase:task.phase,checkId:task.checkId,
        status:receiptByTask.get(task.id)?.status??'PENDING',summary:receiptByTask.get(task.id)?.summary??null})),
      findings:(details?review.findings:[]).map(finding=>{
        const {origin,receipt}=this.findingSource(review,finding.id);
        const block=origin.manifest.units.find(unit=>unit.unitId===finding.source.unitId)?.scenes
          .find(scene=>scene.sceneId===finding.source.sceneId)?.blocks.find(item=>item.blockId===finding.source.blockId);
        if(!block)denied('审阅问题的原文定位已丢失');
        const start=finding.source.start??0,end=finding.source.end??block.length;
        if(start<0||end<start||end>block.length)denied('审阅问题的原文范围无效');
        return {...finding,sourceRevision:origin.manifest.revision,sourceBlockHash:block.blockHash,
          originalText:block.text.slice(start,end),sourceReceiptId:receipt.id};
      }),
    };
   }));
  }
  /** Goal decisions may inspect derived status without creating a review or
   * counting a plan as a completed check. */
  readStatusForExecution(token:ExecutionToken){return this.currentPlan(token,false);}
  sourceRefsForExecution(token:ExecutionToken,preview:ReviewSet):ResourceRef[]{
    const current=this.currentPlan(token,false);if(!same(current,preview))throw new ExecutionInvalidated('SCRIPT_REVIEW_CHANGED','审阅预览已改变');
    const refs=[current.baseRef,...current.findings.map(finding=>this.findingSource(current,finding.id).ref)];
    for(const receipt of current.receipts){
      this.receiptVisible(current,receipt);
      const row=this.store.db.prepare('SELECT review_id,data_json FROM script_check_results WHERE invocation_id=?').get(receipt.input.invocationId) as any;
      const origin=this.visible(this.load(row.review_id,current.ownerId)),original=JSON.parse(row.data_json).receipt as CheckReceipt;
      refs.push(this.receiptRef(origin,original));
    }
    return [...new Map(refs.map(ref=>[hashValue(ref),ref])).values()];
  }
  readRepairViews(token:ExecutionToken){
    const {auth}=this.authority(token);
    return this.repairRows(auth.reviewScopeId).map(repair=>({id:repair.id,round:repair.round,findingIds:[...repair.findingIds],
      baselineReviewId:repair.baselineReviewId,applicationRef:repair.applicationRef,revisedReviewId:repair.revisedReviewId}));
  }
  receiptRef(review:ReviewSet,receipt:CheckReceipt):ResourceRef{return {uri:`resource://script/check-receipts/${review.id}/${receipt.id}`,version:'1',contentHash:hashValue(receipt),branch:`workspace:${review.workspaceId}`};}
  sourceRefs(review:ReviewSet):ResourceRef[]{
    const current=this.visible(this.load(review.id,review.ownerId));
    if(!same(current,review))throw new ExecutionInvalidated('SCRIPT_REVIEW_CHANGED','审阅状态已更新，请重新读取');
    const refs=[current.baseRef,...current.receipts.map(receipt=>this.receiptRef(current,receipt)),...current.findings.map(finding=>this.findingSource(current,finding.id).ref)];
    return [...new Map(refs.map(ref=>[hashValue(ref),ref])).values()];
  }
  private batch(review:ReviewSet,taskId:string):ReviewBatch{
    const task=review.plan.tasks.find(t=>t.id===taskId);if(!task)denied('检查任务不属于此计划');
    const raw=task.requiredRaw.map(span=>{const block=blocks(review.manifest).find(b=>location(b)===location(span));if(!block)denied('原文定位不存在');return {...span,text:block.text.slice(span.start,span.end)};});
    const sources=[review.baseRef];
    const evidence=task.requiredEvidenceTaskIds.map(taskId=>{
      const receipt=review.receipts.find(r=>r.taskId===taskId&&validateCheckReceipt(review.manifest,review.plan,r,review.receipts).valid);
      if(!receipt)throw new AgentError('SCRIPT_CHECK_UPSTREAM_PENDING','综合检查的上游回执尚未齐全');
      this.receiptVisible(review,receipt);sources.push(this.receiptRef(review,receipt));
      return {taskId,receiptId:receipt.id,receiptDigest:checkDigest(receipt),summary:receipt.summary,findings:receipt.findings,...(receipt.outlineCoverage?{outlineCoverage:receipt.outlineCoverage}:{})};
    });
    const repairs=this.repairRows(review.reviewScopeId).filter(r=>r.revisedReviewId===review.id);
    const rechecks=repairs.flatMap(r=>r.mappings.flatMap(mapping=>{const finding=review.findings.find(f=>f.id===mapping.findingId&&f.status==='REVISED');return finding?[{finding,raw:mapping.raw}]:[];}));
    for(const recheck of rechecks){const ref=this.findingSource(review,recheck.finding.id).ref;if(!sources.some(s=>same(s,ref)))sources.push(ref);}
    const payload={raw,index:task.requiredIndex,evidence,rechecks,...(task.requiredOutline?{outline:task.requiredOutline}:{})};
    const guidance=task.requiredOutline?'\n逐项核对outline的全部原始大纲范围，不得从已有场数推断整片已写完。每项返回outlineCoverage；RAW只说明当前批次能证实的结果，INDEX没有原文不能宣称DRAFT_READY，SYNTHESIS综合所有上游实际原文证据。DRAFT_READY必须说明大纲要求如何在正文实现并引用精确块区间（UTF-16偏移）；原文片段仅相关但没有完成该叙事结果时标PARTIAL。缺少对应分场标UNEXPANDED，只有计划标PLANNED。不要把未来计划、笔记、摘要当正文。':'';
    // The durable task retains the complete requirements. In the model input,
    // payload is their one canonical copy (with RAW text added); the receipt
    // still checks that exact frozen section against the original task.
    const taskInput={id:task.id,kind:task.kind,phase:task.phase,
      checkId:task.checkId,dependency:task.dependency,requiredRawRef:'payload.raw',requiredIndexRef:'payload.index',
      requiredEvidenceTaskIdsRef:'payload.evidence[].taskId',...(task.requiredOutline?{requiredOutlineRef:'payload.outline'}:{})};
    // Hashes stay in the frozen task/payload and request manifest. They are
    // opaque to the reviewer, so omit their repeated per-span bytes here while
    // preserving every checked location, offset, length and original RAW text.
    const aliases=reviewBlockAliases(payload),displayBlock=(blockId:string)=>aliases.get(blockId)??blockId;
    const document=payload.raw.length?this.workspaces.version(review.workspaceId,review.ownerId,review.manifest.revision):null;
    if(document&&!same(workspaceRef({id:review.workspaceId,revision:review.manifest.revision,document}),review.baseRef))denied('审阅稿件来源不匹配');
    const sourceBlocks=new Map(document?.units.flatMap(unit=>unit.scenes.flatMap(scene=>scene.blocks.map(block=>
      [location({unitId:unit.id,sceneId:scene.id,blockId:block.id}),block] as const)))??[]);
    const rawInput=payload.raw.map(({blockHash,textHash,...span})=>{
      const block=sourceBlocks.get(location(span));
      if(!block||checkDigest(block)!==blockHash||sha256(span.text)!==textHash||block.text.slice(span.start,span.end)!==span.text)denied('审阅块的类型或说话人来源不匹配');
      return {...span,blockId:displayBlock(span.blockId),type:block.type,
        ...(block.speakerId?{speakerId:block.speakerId}:{}),
        ...(block.speakerName||block.speakerId?{speakerName:block.speakerName??document!.characters.find(character=>character.id===block.speakerId)?.name??''}:{})};
    });
    const indexInput=payload.index.map(({blockHash:_blockHash,textHash:_textHash,...entry})=>({...entry,blockId:displayBlock(entry.blockId)}));
    // Short dialogue blocks otherwise repeat the same long unit/scene IDs
    // hundreds of times. Consecutive groups retain the exact original order;
    // the table carries every block ID, UTF-16 range and byte of manuscript.
    const grouped=<T extends {unitId:string;sceneId:string}>(items:T[],columns:string[],row:(item:T)=>unknown[])=>{
      const groups:Array<{unitId:string;sceneId:string;blocks:unknown[][]}>=[];
      for(const item of items){
        let group=groups.at(-1);
        if(!group||group.unitId!==item.unitId||group.sceneId!==item.sceneId){
          group={unitId:item.unitId,sceneId:item.sceneId,blocks:[]};groups.push(group);
        }
        group.blocks.push(row(item));
      }
      return {encoding:'SCENE_BLOCK_TABLE_V1',columns,groups};
    };
    // Reuse speaker/type descriptors instead of repeating a character ID on
    // every short line. Missing final cells inherit the most common descriptor.
    const presentation=(span:typeof rawInput[number])=>({type:span.type,...(span.speakerId?{speakerId:span.speakerId}:{}),...(span.speakerName?{speakerName:span.speakerName}:{})});
    const counts=new Map<string,{value:ReturnType<typeof presentation>;count:number}>();
    for(const span of rawInput){const value=presentation(span),key=JSON.stringify(value),entry=counts.get(key);if(entry)entry.count++;else counts.set(key,{value,count:1});}
    const presentations=[...counts.values()].sort((a,b)=>b.count-a.count).map(item=>item.value);
    const presentationIds=new Map(presentations.map((value,index)=>[JSON.stringify(value),index]));
    const rawTable=rawInput.length>64?{...grouped(rawInput,['blockId','start','end','text','presentation'],span=>{
      const index=presentationIds.get(JSON.stringify(presentation(span)))!;
      return [span.blockId,span.start,span.end,span.text,...(index?[index]:[])];
    }),presentations,defaults:{presentation:0}}:null;
    const modelPayload={...payload,
      ...(payload.outline?{outline:payload.outline.map(({sourceHash:_sourceHash,...item})=>item)}:{}),
      ...(aliases.size?{blockIdMeaning:'@编号仅在本批有效；问题和outlineCoverage的blockId照抄本批编号，宿主按冻结批次恢复原稿ID。其他批次/上游报告的编号不可挪用。'}:{}),
      rechecks:payload.rechecks.map(item=>({...item,
        finding:{...item.finding,source:{...item.finding.source,blockId:displayBlock(item.finding.source.blockId)}},
        raw:item.raw.map(span=>({...span,blockId:displayBlock(span.blockId)}))})),
      raw:rawTable??rawInput,
      index:indexInput.length>64?grouped(indexInput,['blockId','length'],entry=>[entry.blockId,entry.length]):indexInput};
    const locationGuidance='\nSCENE_BLOCK_TABLE_V1：groups保持原顺序，行继承unitId/sceneId；blocks按columns读取，缺少末尾值取defaults。presentation是presentations的下标，给出原稿块类型和说话人，不得猜测归属。返回定位照抄本批ID及UTF-16偏移；宿主恢复blockId。编码保留完整原文及位置。';
    const text=`SCRIPT_CHECK_INPUT\n${JSON.stringify({reviewId:review.id,task:taskInput,payload:modelPayload})}\nEND_SCRIPT_CHECK_INPUT${locationGuidance}${guidance}`;
    const section:ContextSection={id:`script-review:${review.id}:${task.id}`,text,required:true,priority:100,dependencies:sources.map((ref,index)=>({ref,freshness:index===0?'CURRENT':'EXACT'}))};
    return {reviewId:review.id,task,payload,section,inputManifest:{scriptReview:{reviewId:review.id,taskId:task.id,payloadHash:hashValue(payload)}},outputSchema:structuredClone(task.requiredOutline?outlineCheckOutputSchema:scriptCheckOutputSchema),sourceRefs:sources};
  }
  prepareBatch(token:ExecutionToken,taskId:string){return this.batch(this.ensurePlan(token),taskId);}
  private step(token:ExecutionToken){
    const run=this.store.assertExecution(token);if(!token.stepId)denied('检查必须属于真实执行步骤');
    const row=this.store.db.prepare('SELECT call_id FROM agent_steps WHERE id=? AND run_id=? AND generation=?').get(token.stepId,run.id,token.inputRevision) as any;
    if(!row)denied('检查步骤身份不匹配');const step=this.store.getStep(run.id,token.inputRevision,row.call_id)!;
    const {preparedDigest,...basis}=step.prepared;
    if(hashValue(basis)!==preparedDigest||hashValue(step.prepared.request.input)!==step.prepared.inputDigest||step.prepared.binding.ownerId!==run.ownerId||step.prepared.binding.commandRevision!==String(token.inputRevision))denied('检查步骤冻结证据无效');
    return {run,step};
  }
  private parse(raw:string,receiptId:string,outline=false){
    const value:any=parseModelJson(raw),keys=(v:any,names:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===names.sort().join();
    if(!keys(value,['summary','findings','resolvedFindingIds',...(outline?['outlineCoverage']:[])])||typeof value.summary!=='string'||!value.summary.trim()||!Array.isArray(value.findings)||!Array.isArray(value.resolvedFindingIds)||
      value.resolvedFindingIds.some((id:any)=>typeof id!=='string'||!id)||new Set(value.resolvedFindingIds).size!==value.resolvedFindingIds.length)throw new Error('检查结果结构无效');
    const ids=new Set<string>();
    const findings:CheckFinding[]=value.findings.map((f:any)=>{
      if(!keys(f,['id','issue','suggestion','severity','basis','source','uncertainty'])||typeof f.id!=='string'||!f.id.trim()||ids.has(f.id)||
        typeof f.issue!=='string'||!f.issue.trim()||typeof f.suggestion!=='string'||!f.suggestion.trim()||typeof f.uncertainty!=='string'||!['BLOCKING','ADVISORY'].includes(f.severity)||!['RAW','INDEX'].includes(f.basis)||
        !keys(f.source,['unitId','sceneId','blockId','start','end'])||['unitId','sceneId','blockId'].some(k=>typeof f.source[k]!=='string'||!f.source[k])||
        [f.source.start,f.source.end].some(v=>v!==null&&!Number.isSafeInteger(v)))throw new Error('问题定位结构无效');
      ids.add(f.id);const source={unitId:f.source.unitId,sceneId:f.source.sceneId,blockId:f.source.blockId,...(f.source.start!==null?{start:f.source.start}:{}),...(f.source.end!==null?{end:f.source.end}:{})};
      return {...f,id:`${receiptId}_${hashValue(f.id).slice(0,12)}`,source};
    });
    if(outline&&(!Array.isArray(value.outlineCoverage)||value.outlineCoverage.some((entry:any)=>!keys(entry,['requirementId','status','reason','evidence'])||
      typeof entry.requirementId!=='string'||typeof entry.reason!=='string'||!Array.isArray(entry.evidence)||entry.evidence.some((ref:any)=>!keys(ref,['sceneId','blockId','start','end'])||typeof ref.sceneId!=='string'||typeof ref.blockId!=='string'||!Number.isSafeInteger(ref.start)||!Number.isSafeInteger(ref.end)))))throw new Error('大纲覆盖结果结构无效');
    return {summary:value.summary as string,findings,resolvedFindingIds:value.resolvedFindingIds as string[],...(outline?{outlineCoverage:value.outlineCoverage as OutlineCoverageEntry[]}:{})};
  }
  private allRaw(receipt:CheckReceipt,review:ReviewSet,seen=new Set<string>()):CheckSpan[]{
    if(seen.has(receipt.id))return [];seen.add(receipt.id);
    return [...receipt.input.raw,...receipt.input.evidence.flatMap(link=>{const source=review.receipts.find(r=>r.id===link.receiptId&&checkDigest(r)===link.receiptDigest);return source?this.allRaw(source,review,seen):[];})];
  }
  private covers(span:CheckSpan,raw:CheckSpan[]){let at=span.start;for(const part of raw.filter(r=>location(r)===location(span)&&r.blockHash===span.blockHash).sort((a,b)=>a.start-b.start)){if(part.start>at)break;at=Math.max(at,part.end);}return at>=span.end;}
  recordResult(input:{token:ExecutionToken;invocationId:string}):Observation{
    return this.store.atomic(()=>{
      const {run,step}=this.step(input.token),phase=step.status==='COMMITTED'?'VIEW':'CONSUME',auth=sync(this.policy.forRun(run,phase));
      if(step.prepared.request.capabilityId!=='script.check_batch')denied('该步骤不是审阅能力');
      if(step.status==='COMMITTED'){
        const row=this.store.db.prepare('SELECT * FROM script_check_results WHERE step_id=?').get(step.id) as any;
        if(!row||row.invocation_id!==input.invocationId)denied('检查回放不属于原调用');
        const review=this.visible(this.load(row.review_id,run.ownerId));if(review.reviewScopeId!==auth.reviewScopeId||review.workspaceId!==auth.workspaceId)denied('回放超出本次审阅范围');
        return this.store.commitStep(input.token,step.prepared.request.callId,JSON.parse(row.observation_json),()=>{});
      }
      const args=step.prepared.request.input as any;
      if(!args||args.authorizationRef!==auth.authorizationRef||!args.frozen?.reviewBatch||!args.frozen?.model)denied('检查步骤没有固定本次授权、批次或模型请求');
      const review=this.ensurePlan(input.token),expected=this.batch(review,args.taskId),frozen=args.frozen.reviewBatch as ReviewBatch;
      if(!same(expected,frozen)||!expected.sourceRefs.every(ref=>step.prepared.sources.some(s=>same(s,ref))))denied('冻结检查批次或原文来源已变化');
      const invocation=this.journal.read(input.invocationId),request=invocation.request;
      invocation.result=this.journal.resolvedResult(invocation.id);
      if(invocation.runId!==run.id||invocation.ownerKey!==step.id||invocation.inputRevision!==input.token.inputRevision||invocation.status!=='RECEIVED'||!invocation.result||
        !same(request,args.frozen.model)||invocation.inputHash!==hashValue(request)||!same(request.inputManifest?.scriptReview,expected.inputManifest.scriptReview)||
        !same(request.outputSchema,expected.outputSchema)||!request.contextRef)denied('检查结果没有匹配真实发送的模型请求');
      this.journal.assertInput(input.token,request);
      const bundle=this.withRunAuthorization(run,'CONSUME',()=>
        this.contexts.assertAllowed(request.contextRef!,access(run.ownerId,auth.workspaceId)));
      if(bundle.prompt!==request.prompt||bundle.systemInstruction!==(request.systemInstruction??'')||!same(bundle.outputSchema,request.outputSchema)||
        !bundle.sections.some(s=>same(s,expected.section))||!bundle.prompt.includes(expected.section.text)||
        !expected.section.dependencies.every(d=>bundle.dependencies.some(actual=>same(actual,d))))denied('实际上下文没有完整发送检查所需的原文、索引或上游报告');
      const id=`check_receipt_${hashValue({stepId:step.id,invocationId:invocation.id}).slice(0,32)}`;
      const receipt:CheckReceipt={id,taskId:expected.task.id,taskFingerprint:expected.task.fingerprint,manifestHash:review.manifest.hash,status:'SUCCEEDED',schemaValidated:true,
        input:{source:'FROZEN_SENT_REQUEST',contextRef:request.contextRef,invocationId:invocation.id,inputHash:invocation.inputHash,raw:expected.task.requiredRaw,index:expected.task.requiredIndex,
          omittedRaw:[],omittedIndex:[],evidence:expected.payload.evidence,...(expected.task.requiredOutline?{outline:expected.task.requiredOutline}:{})},findings:[],summary:''};
      let error:string|null=null,resolvedFindingIds:string[]=[];
      try{
        if(invocation.result.failure)throw new Error(invocation.result.failure.message);
        if(invocation.result.validationErrors?.length)throw new Error(invocation.result.validationErrors.join('；'));
        const parsed=this.parse(invocation.result.text,id,Boolean(expected.task.requiredOutline));
        const originals=new Map([...reviewBlockAliases(expected.payload)].map(([original,alias])=>[alias,original]));
        const originalBlock=(blockId:string)=>originals.get(blockId)??blockId;
        for(const finding of parsed.findings)finding.source.blockId=originalBlock(finding.source.blockId);
        for(const coverage of parsed.outlineCoverage??[])for(const evidence of coverage.evidence)evidence.blockId=originalBlock(evidence.blockId);
        receipt.findings=parsed.findings;receipt.summary=parsed.summary;resolvedFindingIds=parsed.resolvedFindingIds;
        if(parsed.outlineCoverage)receipt.outlineCoverage=parsed.outlineCoverage;
        const checked=validateCheckReceipt(review.manifest,review.plan,receipt,review.receipts);if(!checked.valid)throw new Error(checked.reasons.join('；'));
        const raw=this.allRaw(receipt,review);
        for(const findingId of resolvedFindingIds){
          const recheck=expected.payload.rechecks.find(r=>r.finding.id===findingId);
          if(!recheck||!recheck.raw.length||!recheck.raw.every(span=>this.covers(span,raw)))throw new Error('解决声明没有实际读取返修映射的新稿全文');
          if(receipt.findings.some(f=>f.severity==='BLOCKING'&&recheck.raw.some(span=>span.unitId===f.source.unitId&&span.sceneId===f.source.sceneId)))throw new Error('复查仍报告返修位置阻断问题');
        }
      }catch(cause){error=cause instanceof Error?cause.message:'检查结果解析失败';receipt.status='FAILED';receipt.schemaValidated=false;resolvedFindingIds=[];}
      const observation:Observation={status:error?'FAILED':'SUCCEEDED',summary:error?'检查原文已保留，结果未通过证据校验':'检查结果与实际原文覆盖已保存',
        data:{reviewId:review.id,receiptId:id,taskId:receipt.taskId,error,resolvedFindingIds},evidence:expected.sourceRefs,artifacts:[this.receiptRef(review,receipt)],effectState:'CANDIDATE_PRESERVED',retry:'NEVER'};
      return this.store.commitStep(input.token,step.prepared.request.callId,observation,()=>{
        const data={receipt,raw:invocation.result!.text,modelResult:invocation.result,modelRequest:request,error,resolvedFindingIds};
        this.store.db.prepare('INSERT INTO script_check_results VALUES(?,?,?,?,?,?)').run(id,review.id,step.id,invocation.id,JSON.stringify(data),JSON.stringify(observation));
        this.withRunAuthorization(run,'CONSUME',()=>
          this.contexts.bindArtifact('script-check-result',id,request.contextRef!,access(run.ownerId,auth.workspaceId)));
        review.receipts.push(receipt);
        if(!error){
          review.findings.push(...receipt.findings.map(f=>({...f,status:'OPEN' as const,manifestHash:review.manifest.hash})));
          review.findingSources.push(...receipt.findings.map(f=>({findingId:f.id,reviewId:review.id,receiptId:receipt.id})));
          for(const finding of review.findings)if(resolvedFindingIds.includes(finding.id)){finding.status='VERIFIED';finding.manifestHash=review.manifest.hash;finding.verificationReceiptId=receipt.id;}
          // Only the completed review cycle can conclude that an unconfirmed
          // repair remains unresolved. Earlier raw batches must not prevent the
          // final synthesis from explicitly resolving the same original issue.
          const coverage=assessCheckCoverage(review.manifest,review.plan,review.receipts);
          if(coverage.localComplete&&coverage.globalComplete)for(const finding of review.findings)if(finding.status==='REVISED')finding.status='UNRESOLVED';
        }
        this.save(review);
      });
    });
  }
  beginRepair(input:{token:ExecutionToken;operationId:string;findingIds:string[]}):ReviewRepair{
    return this.store.atomic(()=>{
      const {run,auth}=this.authority(input.token);if(!input.operationId?.trim()||!input.findingIds.length||new Set(input.findingIds).size!==input.findingIds.length)denied('返修命令或目标问题无效');
      const prior=this.store.db.prepare('SELECT * FROM script_review_repairs WHERE scope_id=? AND operation_id=?').get(auth.reviewScopeId,input.operationId) as any;
      if(prior){
        const repair=JSON.parse(prior.data_json) as ReviewRepair,baseline=this.visible(this.load(repair.baselineReviewId,run.ownerId));
        if(!same(repair.findingIds,input.findingIds)||baseline.workspaceId!==auth.workspaceId||!same(baseline.contract,auth.contract))denied('返修重放参数已变化');
        return repair;
      }
      const review=this.ensurePlan(input.token),payload={reviewId:review.id,findingIds:input.findingIds};
      if(input.findingIds.some(id=>!review.findings.some(f=>f.id===id&&['OPEN','UNRESOLVED'].includes(f.status))))denied('返修必须引用真实未解决问题');
      const round=this.repairRows(review.reviewScopeId).length+1;if(round>review.contract.maxRepairRounds)throw new AgentError('SCRIPT_REPAIR_LIMIT','返修轮数已用尽');
      if(!this.policy.reserveRepair||!sync(this.policy.reserveRepair(input.token,input.operationId)))throw new AgentError('SCRIPT_REPAIR_BUDGET','没有可用的共享返修预算');
      const repair:ReviewRepair={id:`repair_${hashValue({scope:review.reviewScopeId,operationId:input.operationId}).slice(0,32)}`,reviewScopeId:review.reviewScopeId,baselineReviewId:review.id,findingIds:[...input.findingIds],round,applicationRef:null,revisedReviewId:null,mappings:[]};
      this.store.db.prepare('INSERT INTO script_review_repairs VALUES(?,?,?,?,?)').run(repair.id,review.reviewScopeId,input.operationId,hashValue(payload),JSON.stringify(repair));
      review.repairRoundsUsed=round;this.save(review);return repair;
    });
  }
  markRepaired(input:{token:ExecutionToken;repairId:string;applicationRef:ResourceRef}):ReviewRepair{
    return this.store.atomic(()=>{
      const {run,auth}=this.authority(input.token),row=this.store.db.prepare('SELECT data_json FROM script_review_repairs WHERE id=? AND scope_id=?').get(input.repairId,auth.reviewScopeId) as any;
      if(!row||!this.policy.repairApplication)denied('缺少返修或真实候选应用核验');const repair=JSON.parse(row.data_json) as ReviewRepair;
      const application=sync(this.policy.repairApplication(run,input.applicationRef)),baseline=this.visible(this.load(repair.baselineReviewId,run.ownerId));
      if(repair.applicationRef){if(!same(repair.applicationRef,input.applicationRef))denied('返修不能绑定另一候选');return repair;}
      const next=this.ensurePlan(input.token);
      if(application.workspaceId!==auth.workspaceId||application.beforeRevision!==baseline.manifest.revision||application.afterRevision!==next.manifest.revision||application.afterRevision<=application.beforeRevision)denied('返修应用不属于该问题基线与当前新稿');
      for(const findingId of repair.findingIds){
        const old=baseline.findings.find(f=>f.id===findingId)!,scene=next.manifest.units.find(u=>u.unitId===old.source.unitId)?.scenes.find(s=>s.sceneId===old.source.sceneId);
        const oldScene=baseline.manifest.units.find(u=>u.unitId===old.source.unitId)?.scenes.find(s=>s.sceneId===old.source.sceneId);
        if(!scene||scene.sceneHash===oldScene?.sceneHash)denied('返修没有可复查的实际新场景，不能以旧块消失判定解决');
        const raw=scene.blocks.filter(b=>b.length>0).map(b=>({unitId:b.unitId,sceneId:b.sceneId,blockId:b.blockId,blockHash:b.blockHash,start:0,end:b.length,textHash:b.textHash}));
        if(!raw.length)denied('返修后正文为空，不能完成问题映射');
        repair.mappings.push({findingId,raw});
        const finding=next.findings.find(f=>f.id===findingId);if(!finding)denied('新稿丢失了原审阅问题');
        finding.status='REVISED';finding.revisedManifestHash=next.manifest.hash;finding.repairRound=repair.round;delete finding.verificationReceiptId;
      }
      repair.applicationRef=input.applicationRef;repair.revisedReviewId=next.id;next.repairRoundsUsed=this.repairRows(auth.reviewScopeId).length;
      this.store.db.prepare('UPDATE script_review_repairs SET data_json=? WHERE id=?').run(JSON.stringify(repair),repair.id);this.save(next);return repair;
    });
  }
  assessCompletion(token:ExecutionToken){return this.assess(token);}
  private stageLedger(run:AgentRun,authority:ReviewAuthority):ScriptDraftCreationLedger{
    const has=(name:string)=>Boolean(this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    if(has('agent_run_links')&&has('script_goal_creation_ledgers')){
      const link=this.store.db.prepare('SELECT goal_id,goal_revision FROM agent_run_links WHERE run_id=?').get(run.id) as {goal_id:string;goal_revision:number}|undefined;
      if(link?.goal_id===authority.reviewScopeId){
        const row=this.store.db.prepare('SELECT data_json FROM script_goal_creation_ledgers WHERE goal_id=? AND goal_revision=?').get(link.goal_id,link.goal_revision) as {data_json:string}|undefined;
        if(row)return JSON.parse(row.data_json);
      }
    }
    if(has('script_draft_ledgers')){
      const row=this.store.db.prepare('SELECT data_json FROM script_draft_ledgers WHERE authorization_id=?').get(authority.authorizationRef) as {data_json:string}|undefined;
      if(row)return JSON.parse(row.data_json);
    }
    return emptyScriptDraftCreationLedger();
  }
  private assess(token:ExecutionToken|AgentRun){
    const {run,workspace}=this.authority(token);let review:ReviewSet;
    const authority=this.policy.forRun(run,'CONSUME');
    if(authority.stage&&authority.stageScope){
      const stage=authority.stage,delivery=stageDelivery(workspace.document,authority.stageScope,stage,{ledger:this.stageLedger(run,authority),contract:authority.contract});
      const state=this.policy.completionState?sync(this.policy.completionState(run,{workspaceId:workspace.id})):{unresolvedUnknown:true,outOfScopeWrites:true};
      const applications=this.store.db.prepare('SELECT a.candidate_id,a.workspace_revision FROM script_draft_applications a JOIN agent_run_links l ON l.run_id=a.run_id WHERE l.goal_id=? AND l.goal_revision=? ORDER BY a.workspace_revision').all(authority.reviewScopeId,(this.store.db.prepare('SELECT goal_revision FROM agent_run_links WHERE run_id=?').get(run.id) as {goal_revision:number}).goal_revision);
      const gaps=[...delivery.gaps,...(!delivery.ready?['指定阶段的内容尚不完整']:[]),...(!applications.length?['尚未提交本次阶段成果']:[]),...(state.unresolvedUnknown?['模型结果尚待核对']:[]),...(state.outOfScopeWrites?['检测到范围外写入']:[])];
      const digest=hashValue({stage,content:delivery.content,applications,scope:authority.stageScope,contract:authority.contract});
      const artifact:GoalArtifact={kind:'stage_candidate',projectId:workspace.documentId,revision:workspace.revision,manifestHash:digest,unitIds:authority.contract.targetUnitIds};
      const proof:ReviewCompletionProof={reviewId:`stage:${authority.reviewScopeId}`,workspaceRef:workspaceRef(workspace),reviewDigest:digest,stateDigest:hashValue(state),artifact};
      return {complete:!gaps.length,resultType:!gaps.length?'stage_candidate' as const:'PARTIAL' as const,manifestHash:digest,gaps,coverage:{localComplete:false,globalComplete:false,missingTaskIds:[] as string[],invalidReceipts:[] as Array<{taskId:string;reason:string}>},artifact,proof};
    }
    try{review=this.currentPlan(token,false);}catch(error){
      // An accepted goal can name units which its writing tools have not yet
      // created. FINISH is a rejected proposal, not a failed executor or a
      // reason to replace the author's requested units with the first unit.
      if(error instanceof Error&&!(error instanceof AgentError)&&/^(目标单元必须存在且不能重复|目标单元不存在：|目标场景不存在：)/.test(error.message))return {
        complete:false,resultType:'PARTIAL' as const,manifestHash:'',gaps:[error.message],
        coverage:{localComplete:false,globalComplete:false,missingTaskIds:[] as string[],invalidReceipts:[] as Array<{taskId:string;reason:string}>},artifact:null,proof:null};
      throw error;
    }
    const state=this.policy.completionState?sync(this.policy.completionState(run,review)):{unresolvedUnknown:true,outOfScopeWrites:true};
    const artifact:GoalArtifact={kind:'complete_candidate',projectId:workspace.document.id,revision:workspace.revision,manifestHash:review.manifest.hash,unitIds:review.contract.targetUnitIds};
    const assessment=assessGoalCandidate({project:workspace.document,contract:review.contract,manifest:review.manifest,plan:review.plan,receipts:review.receipts,findings:review.findings,artifact,repairRoundsUsed:this.repairRows(review.reviewScopeId).length,...state});
    const proof:ReviewCompletionProof={reviewId:review.id,workspaceRef:workspaceRef(workspace),reviewDigest:hashValue(review),stateDigest:hashValue(state),artifact};
    return {...assessment,artifact,proof};
  }
  verifyCompletion(token:ExecutionToken,proof:unknown){
    const current=this.assessCompletion(token);if(!current.complete||!same(current.proof,proof))throw new ExecutionInvalidated('SCRIPT_COMPLETION_CHANGED','正文、审阅结果、范围或模型核对状态已改变');
  }
  /** GoalStore invokes this inside its already-fenced finish transaction. The
   * readonly verifier re-reads the actual Run and domain authority; it neither
   * manufactures a lease token nor requires an obsolete historical one. */
  verifyCompletionForRun(run:AgentRun,proof:unknown){
    const current=this.assess(run);if(!current.complete||!same(current.proof,proof))throw new ExecutionInvalidated('SCRIPT_COMPLETION_CHANGED','正文、审阅结果、范围或模型核对状态已改变');
  }
  sourceAllowed(ref:ResourceRef,sourceAccess:ContextAccess,freshness:'EXACT'|'CURRENT'|'COLLECTION'){
    try{
      const url=new URL(ref.uri),match=/^\/check-receipts\/(review_[\w-]+)\/(check_receipt_[\w-]+(?::carry:[\w-]+)*)$/.exec(url.pathname);
      if(url.protocol!=='resource:'||url.hostname!=='script'||url.username||url.password||url.port||url.search||url.hash||!match||ref.version!=='1'||freshness==='COLLECTION')return false;
      const review=this.load(match[1],sourceAccess.ownerId);
      if(sourceAccess.scopeId!==review.workspaceId||sourceAccess.branch!==`workspace:${review.workspaceId}`||ref.branch!==sourceAccess.branch)return false;
      if(freshness==='CURRENT'&&this.workspaces.read(review.workspaceId,review.ownerId).revision!==review.manifest.revision)return false;
      const receipt=review.receipts.find(r=>r.id===match[2]);if(!receipt||!same(ref,this.receiptRef(review,receipt)))return false;
      this.receiptVisible(review,receipt);return true;
    }catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;return false;}
  }
}
