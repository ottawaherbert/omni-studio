import { randomUUID } from 'node:crypto';
import { AgentError, ExecutionInvalidated, assertResourceRef, hashCommand, hashValue, jsonCopy, stableJson, type AgentRun, type AgentStep, type ExecutionToken, type GoalRevision, type HistoryPrincipal, type HistoryReadPolicy, type HistoryReaderDescriptor, type PlanProjection, type PlanRevision, type PlanView, type ReceiptPage, type ReceiptProjection, type ReceiptView, type ResourceRef, type Sampling } from '../../agent-core/src';
import { AgentSqliteStore } from './store';
import { SqliteGoalStore } from './goalStore';

type ReceiptRecord = { sequence: number; step: AgentStep; origin: HistoryPrincipal; sampling: Sampling | null };
type Collection = { id: string; readerId: string; members: Array<{ sequence: number; id: string; ref: ResourceRef | null }>; digest: string };
const SUMMARY_LIMIT = 1200;
const LIMIT = 50;
const unavailable = (id: string) => ({ state: 'REDACTED' as const, id, reason: 'HISTORY_UNAVAILABLE' as const, sourceUsable: false as const });

/** Read-only projections from durable facts. SQL and raw records remain within
 * the adapter/host policy; model-facing results contain no execution prompts. */
export class SqliteHistoryStore {
  private validationDepth=0;
  private cacheChanges=-1;
  private readonly validViews=new Map<string,ReceiptView>();
  private readonly validCollections=new Map<string,{collection:Collection;views:ReceiptView[];rows:any[]}>();
  private readonly validReaders=new Map<string,HistoryPrincipal>();
  constructor(readonly store: AgentSqliteStore, readonly goals: SqliteGoalStore, private readonly policy: HistoryReadPolicy) {
    for (const name of ['authorizeReader','authorize','assertSamplingView','assertReceiptView'] as const) if (typeof policy?.[name] !== 'function') throw new AgentError('HISTORY_POLICY_REQUIRED', '历史读取必须提供完整的宿主权限校验');
  }
  ensureSchema() {
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS agent_history_readers(id TEXT PRIMARY KEY,digest TEXT NOT NULL UNIQUE,descriptor_json TEXT NOT NULL,link_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_history_collections(id TEXT PRIMARY KEY,reader_id TEXT NOT NULL,digest TEXT NOT NULL,data_json TEXT NOT NULL,UNIQUE(reader_id,digest));`);
  }
  private checked(action: () => void) { const result = action() as unknown; if (result === false || result && typeof (result as any).then === 'function') throw new AgentError('HISTORY_POLICY_INVALID', '历史权限校验必须同步并明确通过'); }
  private withValidation<T>(read:()=>T):T {
    const outer=this.validationDepth===0;
    this.validationDepth++;
    try{
      const result=outer&&this.policy.withValidationBatch?this.policy.withValidationBatch(read):read();
      if(result&&typeof(result as any).then==='function')throw new AgentError('ASYNC_HISTORY_VALIDATION','历史批量核验必须同步');
      return result;
    }
    finally {if(--this.validationDepth===0){this.validViews.clear();this.validCollections.clear();this.validReaders.clear();this.cacheChanges=-1;}}
  }
  /** Reuse successful checks only within one synchronous database snapshot.
   * Authority and local writes remain part of each existing validation key. */
  withValidationBatch<T>(read:()=>T):T {
    return this.store.atomic(()=>this.withValidation(read));
  }
  private validationKey(kind:string,descriptor:HistoryReaderDescriptor,identity:string,activeReader?:HistoryPrincipal):string|null {
    if(!this.policy.validationKey||this.validationDepth===0)return null;
    const changes=(this.store.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    if(changes!==this.cacheChanges){this.validViews.clear();this.validCollections.clear();this.validReaders.clear();this.cacheChanges=changes;}
    return hashValue({kind,descriptor:hashValue(descriptor),identity,activeReader:activeReader?{
      runId:activeReader.run.id,version:activeReader.run.version,generation:activeReader.run.generation,
      goalRevision:activeReader.revision.revision,authorizationRef:activeReader.link.authorizationRef}:null,
      authority:this.policy.validationKey(),changes});
  }
  private exactRevision(goalId: string, revision: number): GoalRevision {
    const row = this.store.db.prepare('SELECT data_json FROM agent_goal_revisions WHERE goal_id=? AND revision=?').get(goalId, revision) as any;
    if (!row) throw new AgentError('HISTORY_BINDING_INVALID', '历史目标版本不存在'); return JSON.parse(row.data_json);
  }
  private acceptedRevision(run: AgentRun, generation: number): GoalRevision {
    const rows = this.store.db.prepare('SELECT receipt_json FROM agent_goal_commands WHERE owner_id=?').all(run.ownerId) as any[];
    const receipts = rows.map(row => JSON.parse(row.receipt_json)).filter(value => value.runId === run.id);
    const revisions = [...new Set(receipts.map(value => value.goalRevision as number))].sort((a,b)=>a-b);
    const revision = revisions[generation - 1], receipt = receipts.find(value => value.goalRevision === revision);
    if (!receipt || !Number.isSafeInteger(generation) || generation < 1) throw new AgentError('HISTORY_BINDING_INVALID', '历史运行缺少对应的作者目标命令');
    return this.exactRevision(receipt.goalId, revision);
  }
  private principal(run: AgentRun, revision: GoalRevision, link = this.goals.readRunLink(run.id)): HistoryPrincipal {
    if (!link || link.goalId !== revision.goalId || link.workspaceRef?.uri !== revision.workspaceRef.uri || link.workspaceRef.branch !== revision.workspaceRef.branch) throw new AgentError('HISTORY_BINDING_INVALID', '历史执行绑定与目标不一致');
    const goal = this.goals.read(revision.goalId, run.ownerId);
    if (goal.ownerId !== run.ownerId || goal.scopeId !== run.scopeId) throw new AgentError('HISTORY_BINDING_INVALID', '历史目标不属于执行范围');
    return { run, revision, link: link.role === 'MANUAL_STEP' ? link : { ...link, goalRevision: revision.revision, authorizationRef: revision.authorizationRef, workspaceRef: revision.workspaceRef } };
  }
  private current(token: ExecutionToken): HistoryPrincipal {
    const execution = this.goals.execution(token);
    return { run: execution.run, revision: execution.revision, link: execution.link };
  }
  captureReader(token: ExecutionToken): HistoryReaderDescriptor {
    return this.store.atomic(() => {
      const reader = this.current(token); this.checked(()=>this.policy.authorizeReader({reader,phase:'CONSUME',activeReader:reader}));
      const value = {runId:reader.run.id,goalId:reader.revision.goalId,goalRevision:reader.revision.revision,authorizationRef:reader.revision.authorizationRef,workspaceRef:reader.revision.workspaceRef};
      const digest = hashValue({value,ownerId:reader.run.ownerId,scopeId:reader.run.scopeId,role:reader.link.role});
      const old = this.store.db.prepare('SELECT descriptor_json FROM agent_history_readers WHERE digest=?').get(digest) as any;
      if (old) return JSON.parse(old.descriptor_json);
      const descriptor = {id:`history_reader_${randomUUID()}`,digest,...value};
      this.store.db.prepare('INSERT INTO agent_history_readers VALUES(?,?,?,?)').run(descriptor.id,digest,stableJson(descriptor),stableJson(reader.link)); return descriptor;
    });
  }
  readerForSource(ref: ResourceRef, sourceAccess: { ownerId:string; scopeId:string; branch:string }): HistoryReaderDescriptor {
    return this.store.atomic(() => {
      if(assertResourceRef(ref)!=='agent-history')throw new AgentError('HISTORY_SOURCE_INVALID','不是历史资源引用');
      const url=new URL(ref.uri),match=/^\/readers\/([^/]+)\/(plans|receipts|collections)\/[^/]+$/.exec(url.pathname);
      if(!match||url.search)throw new AgentError('HISTORY_SOURCE_INVALID','历史资源地址无效');
      const row=this.store.db.prepare('SELECT descriptor_json FROM agent_history_readers WHERE id=?').get(match[1]) as any;
      if(!row)throw new AgentError('HISTORY_READER_INVALID','历史读取身份不存在');
      const descriptor:HistoryReaderDescriptor=JSON.parse(row.descriptor_json),reader=this.reader(descriptor);
      if(sourceAccess.ownerId!==reader.run.ownerId||sourceAccess.branch!==descriptor.workspaceRef.branch||ref.branch!==descriptor.workspaceRef.branch)throw new AgentError('HISTORY_READER_INVALID','历史来源不属于当前作者或分支');
      this.checked(()=>this.policy.authorizeReader({reader,phase:'VIEW',sourceAccess})); return descriptor;
    });
  }
  private reader(descriptor: HistoryReaderDescriptor): HistoryPrincipal {
    const key=this.validationKey('reader',descriptor,'principal'),cached=key?this.validReaders.get(key):undefined;
    if(cached)return cached;
    const row = this.store.db.prepare('SELECT * FROM agent_history_readers WHERE id=?').get(descriptor.id) as any;
    if (!row || row.digest !== descriptor.digest || hashValue(JSON.parse(row.descriptor_json)) !== hashValue(descriptor)) throw new AgentError('HISTORY_READER_INVALID', '历史读取身份未由受控执行登记');
    const run = this.store.readRun(descriptor.runId), link = JSON.parse(row.link_json), revision = this.exactRevision(descriptor.goalId,descriptor.goalRevision);
    const value = {runId:run.id,goalId:revision.goalId,goalRevision:revision.revision,authorizationRef:revision.authorizationRef,workspaceRef:revision.workspaceRef};
    if (hashValue({value,ownerId:run.ownerId,scopeId:run.scopeId,role:link.role}) !== descriptor.digest || link.goalId !== revision.goalId || link.goalRevision !== revision.revision || link.authorizationRef !== revision.authorizationRef) throw new AgentError('HISTORY_READER_INVALID', '冻结历史读取身份已改变');
    const receipts = this.store.db.prepare('SELECT receipt_json FROM agent_goal_commands WHERE owner_id=?').all(run.ownerId) as any[];
    if (!receipts.some(row=>{const v=JSON.parse(row.receipt_json);return v.runId===run.id&&v.goalId===revision.goalId&&v.goalRevision===revision.revision;})) throw new AgentError('HISTORY_READER_INVALID','读取身份缺少原始目标命令');
    const principal=this.principal(run,revision,link);
    if(key)this.validReaders.set(key,principal);
    return principal;
  }
  private resource(descriptor: HistoryReaderDescriptor, kind: 'plans'|'receipts'|'collections', identity: string, version: string, value: unknown): ResourceRef {
    return {uri:`resource://agent-history/readers/${descriptor.id}/${kind}/${encodeURIComponent(identity)}`,version,contentHash:hashValue(value),branch:descriptor.workspaceRef.branch};
  }
  private planView(descriptor: HistoryReaderDescriptor, reader: HistoryPrincipal, planId: string, activeReader?: HistoryPrincipal): PlanView {
    const row = this.store.db.prepare('SELECT data_json FROM agent_plan_revisions WHERE id=? AND goal_id=?').get(planId,reader.revision.goalId) as any;
    if (!row) throw new AgentError('HISTORY_NOT_FOUND','计划不存在于当前目标',404);
    const plan: PlanRevision = JSON.parse(row.data_json);
    try {
      const sampleRow=this.store.db.prepare('SELECT run_id,generation,data_json FROM agent_samplings WHERE decision_id=?').get(plan.decisionId) as any;
      if (!sampleRow) throw new AgentError('HISTORY_BINDING_INVALID','计划缺少原决策');
      const sampling:Sampling=JSON.parse(sampleRow.data_json),origin=this.principal(this.store.readRun(sampleRow.run_id),this.acceptedRevision(this.store.readRun(sampleRow.run_id),sampleRow.generation));
      if (origin.revision.goalId!==plan.goalId||origin.revision.revision!==plan.goalRevision||sampling.acceptedDecision?.id!==plan.decisionId||sampling.acceptedDecision.decision.kind!=='CALL'||hashValue(sampling.acceptedDecision.decision.planUpdate)!==hashValue({summary:plan.summary,intentions:plan.intentions})) throw new AgentError('HISTORY_BINDING_INVALID','计划与接受决策不匹配');
      for(const effectiveReader of activeReader ? [reader,activeReader] : [reader]) { this.checked(()=>this.policy.authorize({reader:effectiveReader,origin,kind:'PLAN',plan}));this.checked(()=>this.policy.assertSamplingView({reader:effectiveReader,origin,sampling})); }
      const intentions = plan.intentions.slice(0,50).map(item=>({id:item.id,description:item.description.slice(0,SUMMARY_LIMIT),evidenceRefs:jsonCopy(item.evidenceRefs.slice(0,100))}));
      intentions.forEach(item=>item.evidenceRefs.forEach(assertResourceRef));
      const projection:PlanProjection={id:plan.id,goalRevision:plan.goalRevision,summary:plan.summary.slice(0,SUMMARY_LIMIT),summaryTruncated:plan.summary.length>SUMMARY_LIMIT,intentions,intentionsTruncated:plan.intentions.length>50||plan.intentions.some(item=>item.description.length>SUMMARY_LIMIT),meaning:'PLAN_NOT_EXECUTION',planDigest:hashValue(plan),referencesTruncated:plan.intentions.some(item=>item.evidenceRefs.length>100)};
      return {state:'VISIBLE',projection,exactRef:this.resource(descriptor,'plans',plan.id,String(plan.revision),projection),sourceUsable:true};
    } catch(error) { if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;if(error instanceof AgentError)return unavailable(plan.id);throw error; }
  }
  readPlanForExecution(token:ExecutionToken,planId?:string):PlanView|null {
    return this.store.atomic(()=>{const descriptor=this.captureReader(token),reader=this.reader(descriptor),selected=planId??this.goals.execution(token).link.activePlanRef;if(!selected)return null;return this.planView(descriptor,reader,selected);});
  }
  private manualCommand(run:AgentRun,step:AgentStep) {
    if(run.kind!=='CAPABILITY'||step.generation!==1)throw new AgentError('HISTORY_BINDING_INVALID','手动结果没有可核对的作者命令');
    const request=(run.input as any)?.request;
    if(!request||request.callId!==step.prepared.request.callId||request.capabilityId!==step.prepared.request.capabilityId||request.capabilityVersion!==step.prepared.request.capabilityVersion||hashValue(request)!==step.requestHash)throw new AgentError('HISTORY_BINDING_INVALID','手动步骤与原命令不同');
    const rows=this.store.db.prepare("SELECT c.* FROM agent_commands c JOIN agent_engine_bindings b ON b.owner_id=c.owner_id AND b.request_id=c.request_id AND b.run_id=c.run_id WHERE c.run_id=? AND c.owner_id=? AND b.engine_owner='foundation'").all(run.id,run.ownerId) as any[];
    if(!rows.some(row=>{const command={requestId:row.request_id,ownerId:run.ownerId,scopeId:run.scopeId,kind:run.kind,input:run.input,policyRevision:run.policyRevision,maxInvocations:run.maxInvocations};return row.payload_hash===hashCommand('ACCEPT',command)||row.payload_hash===hashCommand('ACCEPT',{...command,threadId:run.threadId});}))throw new AgentError('HISTORY_BINDING_INVALID','手动步骤缺少原始命令回执');
  }
  private receiptRecord(row:any):ReceiptRecord {
    const run=this.store.readRun(row.run_id),link=this.goals.readRunLink(run.id);
    if(!link?.goalId)throw new AgentError('HISTORY_BINDING_INVALID','历史步骤没有目标绑定');
    const step=this.store.getStep(run.id,row.generation,row.call_id)!;
    if(!step||step.id!==row.id||step.status!=='COMMITTED'||!step.observation)throw new AgentError('HISTORY_BINDING_INVALID','历史步骤没有提交回执');
    const {preparedDigest,...payload}=step.prepared;
    if(hashValue(payload)!==preparedDigest||hashValue(step.prepared.request.input)!==step.prepared.inputDigest||step.prepared.binding.ownerId!==run.ownerId||step.prepared.binding.scopeId!==run.scopeId||step.prepared.binding.commandRevision!==String(step.generation)||step.prepared.binding.policyRevision!==run.policyRevision)throw new AgentError('HISTORY_BINDING_INVALID','历史步骤完整性或作用域不匹配');
    let sampling:Sampling|null=null;let revision:GoalRevision;
    if(link.role==='GOAL_CONTROLLER') {
      sampling=this.goals.decisionForCall(run.id,step.generation,row.call_id);
      const accepted=sampling?.acceptedDecision;
      if(!accepted?.consumed||accepted.stepId!==step.id||accepted.callId!==row.call_id||accepted.decision.kind!=='CALL')throw new AgentError('HISTORY_NOT_CONSUMED','工具结果尚未由协调者消费');
      const d=accepted.decision;
      if(hashValue({capabilityId:d.capabilityId,capabilityVersion:d.capabilityVersion,input:d.arguments,callId:accepted.callId})!==step.requestHash||d.capabilityId!==step.prepared.request.capabilityId||d.capabilityVersion!==step.prepared.request.capabilityVersion)throw new AgentError('HISTORY_BINDING_INVALID','已消费步骤不匹配原决策');
      revision=this.acceptedRevision(run,step.generation);
    }else if(link.role==='MANUAL_STEP'){this.manualCommand(run,step);revision=this.exactRevision(link.goalId,link.goalRevision!);}
    else throw new AgentError('HISTORY_BINDING_INVALID','执行不属于可读取的目标历史');
    const origin=this.principal(run,revision,link);
    return{sequence:row.sequence,step,origin,sampling};
  }
  private receiptView(descriptor:HistoryReaderDescriptor,reader:HistoryPrincipal,row:any,activeReader?:HistoryPrincipal):ReceiptView {
    const key=this.validationKey('receipt',descriptor,row.id,activeReader),cached=key?this.validViews.get(key):undefined;
    if(cached)return cached;
    try {
      const {step,origin,sampling}=this.receiptRecord(row);
      if(origin.run.ownerId!==reader.run.ownerId||origin.revision.goalId!==reader.revision.goalId)throw new AgentError('HISTORY_BINDING_INVALID','历史结果不属于当前目标');
      const invocations = this.store.db.prepare("SELECT id,status,request_json,input_hash FROM agent_invocations WHERE run_id=? AND input_revision=? AND owner_key=?").all(step.runId,step.generation,step.id).map((item:any)=>({id:item.id,status:item.status,request:JSON.parse(item.request_json),inputHash:item.input_hash}));
      for(const effectiveReader of activeReader ? [reader,activeReader] : [reader]) {
        this.checked(()=>this.policy.authorize({reader:effectiveReader,origin,kind:'RECEIPT',step}));
        if(sampling)this.checked(()=>this.policy.assertSamplingView({reader:effectiveReader,origin,sampling}));
        this.checked(()=>this.policy.assertReceiptView({reader:effectiveReader,origin,step,invocations}));
      }
      const result=step.observation!; if(typeof result.summary!=='string'||!Array.isArray(result.artifacts)||!Array.isArray(result.evidence))throw new AgentError('HISTORY_BINDING_INVALID','历史回执格式无效');
      [...result.artifacts,...result.evidence].forEach(assertResourceRef);
      const projection:ReceiptProjection={stepId:step.id,callId:step.prepared.request.callId,capabilityId:step.prepared.request.capabilityId,capabilityVersion:step.prepared.request.capabilityVersion,origin:{runId:origin.run.id,goalRevision:origin.revision.revision,role:origin.link.role},status:result.status,effectState:result.effectState,summary:result.summary.slice(0,SUMMARY_LIMIT),summaryTruncated:result.summary.length>SUMMARY_LIMIT,artifactRefs:jsonCopy(result.artifacts.slice(0,100)),evidenceRefs:jsonCopy(result.evidence.slice(0,100)),receiptDigest:hashValue({preparedDigest:step.prepared.preparedDigest,observation:result}),referencesTruncated:result.artifacts.length>100||result.evidence.length>100};
      const view:ReceiptView={state:'VISIBLE',projection,exactRef:this.resource(descriptor,'receipts',step.id,'1',projection),sourceUsable:true};
      if(key)this.validViews.set(key,view);
      return view;
    }catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;if(error instanceof AgentError)return unavailable(row.id);throw error;}
  }
  private rows(reader:HistoryPrincipal):any[] {
    const rows=this.store.db.prepare("SELECT s.rowid sequence,s.id,s.run_id,s.generation,s.call_id,l.role FROM agent_steps s JOIN agent_run_links l ON l.run_id=s.run_id JOIN agent_runs r ON r.id=s.run_id WHERE l.goal_id=? AND r.owner_id=? AND s.status='COMMITTED' AND l.role IN ('GOAL_CONTROLLER','MANUAL_STEP') ORDER BY s.rowid").all(reader.revision.goalId,reader.run.ownerId) as any[];
    // Unconsumed controller effects are facts in the workspace, but not yet
    // a completed tool observation in the coordinator's decision history.
    return rows.filter(row=>row.role==='MANUAL_STEP'||this.goals.decisionForCall(row.run_id,row.generation,row.call_id)?.acceptedDecision?.consumed===true);
  }
  /** A source check for one frozen receipt must not materialize the complete
   * Goal history. The same consumed-decision check as rows() still applies. */
  private receiptRow(reader:HistoryPrincipal,stepId:string):any|null {
    const row=this.store.db.prepare(`SELECT s.rowid sequence,s.id,s.run_id,s.generation,s.call_id,l.role
      FROM agent_steps s JOIN agent_run_links l ON l.run_id=s.run_id JOIN agent_runs r ON r.id=s.run_id
      WHERE s.id=? AND l.goal_id=? AND r.owner_id=? AND s.status='COMMITTED'
        AND l.role IN ('GOAL_CONTROLLER','MANUAL_STEP')`).get(stepId,reader.revision.goalId,reader.run.ownerId) as any;
    // receiptView/receiptRecord checks the consumed decision and its exact step
    // binding before a receipt can become VISIBLE. Do not parse the full model
    // sampling again before that authority-keyed batch validation cache.
    return row??null;
  }
  private collection(descriptor:HistoryReaderDescriptor,reader:HistoryPrincipal,activeReader?:HistoryPrincipal,persist=true) {
    const key=this.validationKey('collection',descriptor,persist?'saved':'compare',activeReader),cached=key?this.validCollections.get(key):undefined;
    if(cached)return cached;
    const rows=this.rows(reader),views=rows.map(row=>this.receiptView(descriptor,reader,row,activeReader));
    const members=rows.map((row,index)=>({sequence:row.sequence,id:row.id,ref:views[index].state==='VISIBLE'?(views[index] as Extract<ReceiptView,{state:'VISIBLE'}>).exactRef:null}));
    const digest=hashValue(members);const old=this.store.db.prepare('SELECT data_json FROM agent_history_collections WHERE reader_id=? AND digest=?').get(descriptor.id,digest) as any;
    const collection:Collection=old?JSON.parse(old.data_json):{id:`history_collection_${randomUUID()}`,readerId:descriptor.id,members,digest};
    if(!old&&persist)this.store.db.prepare('INSERT INTO agent_history_collections VALUES(?,?,?,?)').run(collection.id,descriptor.id,digest,stableJson(collection));
    const result={collection,views,rows};
    if(key){const currentKey=this.validationKey('collection',descriptor,persist?'saved':'compare',activeReader);if(currentKey)this.validCollections.set(currentKey,result);}
    return result;
  }
  listReceiptViews(token:ExecutionToken,options:{cursor?:string;limit?:number}={}):ReceiptPage {
    return this.withValidation(()=>this.store.atomic(()=>{
      const limit=options.limit??20;if(!Number.isSafeInteger(limit)||limit<1||limit>LIMIT)throw new AgentError('INVALID_HISTORY_LIMIT','历史页大小必须在1到50之间',400);
      const descriptor=this.captureReader(token),reader=this.reader(descriptor),{collection,views,rows}=this.collection(descriptor,reader);
      let after=0;
      if(options.cursor){try{if(options.cursor.length>512)throw new Error();const cursor=JSON.parse(Buffer.from(options.cursor,'base64url').toString());if(cursor.readerId!==descriptor.id||cursor.digest!==collection.digest)throw new AgentError('HISTORY_COLLECTION_CHANGED','历史集合已更新，请重新读取');if(!Number.isSafeInteger(cursor.after)||cursor.after<0)throw new Error();after=cursor.after;}catch(error){if(error instanceof AgentError)throw error;throw new AgentError('INVALID_HISTORY_CURSOR','历史分页游标无效',400);}}
      const eligible=rows.map((row,index)=>({row,view:views[index]})).filter(item=>item.row.sequence>after),selected=eligible.slice(0,limit),truncated=eligible.length>limit;
      const nextCursor=truncated?Buffer.from(stableJson({readerId:descriptor.id,digest:collection.digest,after:selected.at(-1)!.row.sequence})).toString('base64url'):null;
      return{reader:descriptor,items:selected.map(item=>item.view),nextCursor,collectionRef:this.resource(descriptor,'collections',collection.id,collection.digest,collection.members),truncated,sourceUsable:views.every(item=>item.sourceUsable)};
    }));
  }
  assertSourceForReader(descriptor:HistoryReaderDescriptor,ref:ResourceRef,freshness:'EXACT'|'CURRENT'|'COLLECTION',phase:'VIEW'|'CONSUME',activeToken?:ExecutionToken,sourceAccess?:{ownerId:string;scopeId:string;branch:string}):void {
    this.withValidation(()=>this.store.atomic(()=>{
      const reader=this.reader(descriptor),activeReader=activeToken?this.current(activeToken):undefined;
      if(phase==='CONSUME'&&!activeReader)throw new AgentError('HISTORY_ACTIVE_READER_REQUIRED','新输入必须提供当前执行身份');
      if(!activeReader&&!sourceAccess)throw new AgentError('HISTORY_READER_ACCESS_REQUIRED','历史来源核验需要调用方的实际读取范围');
      if(sourceAccess&&(sourceAccess.ownerId!==reader.run.ownerId||sourceAccess.branch!==descriptor.workspaceRef.branch))throw new AgentError('HISTORY_READER_INVALID','历史来源不属于当前读取作者或分支');
      if(activeReader&&(activeReader.run.ownerId!==reader.run.ownerId||activeReader.revision.goalId!==reader.revision.goalId))throw new AgentError('HISTORY_READER_INVALID','新输入不能使用另一作者或目标的读取身份');
      this.checked(()=>this.policy.authorizeReader({reader,phase,...(activeReader?{activeReader}:{}),...(sourceAccess?{sourceAccess}:{})}));
      const namespace=assertResourceRef(ref),url=new URL(ref.uri),match=/^\/readers\/([^/]+)\/(plans|receipts|collections)\/([^/]+)$/.exec(url.pathname);
      if(namespace!=='agent-history'||!match||match[1]!==descriptor.id||url.search||ref.branch!==descriptor.workspaceRef.branch)throw new AgentError('HISTORY_SOURCE_INVALID','历史引用与读取授权不匹配');
      const identity=decodeURIComponent(match[3]);
      if(match[2]==='plans'){
        const view=this.planView(descriptor,reader,identity,activeReader);if(view.state!=='VISIBLE'||hashValue(view.exactRef)!==hashValue(ref))throw new AgentError('HISTORY_SOURCE_INVALID','计划已撤回或引用失效');
        if(freshness!=='EXACT'&&this.goals.readRunLink((activeReader??reader).run.id)?.activePlanRef!==identity)throw new AgentError('HISTORY_SOURCE_INVALID','当前计划已更新');
      }else if(match[2]==='receipts'){
        const row=this.receiptRow(reader,identity);if(!row)throw new AgentError('HISTORY_SOURCE_INVALID','回执不属于可消费历史');const view=this.receiptView(descriptor,reader,row,activeReader);if(view.state!=='VISIBLE'||hashValue(view.exactRef)!==hashValue(ref))throw new AgentError('HISTORY_SOURCE_INVALID','回执来源已撤回或引用失效');
      }else{
        const row=this.store.db.prepare('SELECT data_json FROM agent_history_collections WHERE id=? AND reader_id=?').get(identity,descriptor.id) as any;if(!row)throw new AgentError('HISTORY_SOURCE_INVALID','历史集合不存在');const saved:Collection=JSON.parse(row.data_json);
        const expected=this.resource(descriptor,'collections',saved.id,saved.digest,saved.members);if(hashValue(expected)!==hashValue(ref))throw new AgentError('HISTORY_SOURCE_INVALID','历史集合引用不完整');
        // An immutable collection depends only on its original members. Adding
        // later receipts must not create a reverse edge into their own parent
        // Sampling's old collection (including an originally empty one).
        if(freshness==='EXACT'){
          for(const member of saved.members){const row=this.receiptRow(reader,member.id),view=row?this.receiptView(descriptor,reader,row,activeReader):null;if(!member.ref||!view||view.state!=='VISIBLE'||hashValue(view.exactRef)!==hashValue(member.ref))throw new AgentError('HISTORY_SOURCE_INVALID','历史集合包含已撤回或不可见的来源');}
        }else{
          const current=this.collection(descriptor,reader,activeReader,false);
          if(current.collection.digest!==saved.digest)throw new AgentError('HISTORY_SOURCE_INVALID','历史集合已更新');
          const views=new Map(current.rows.map((item,index)=>[item.id,current.views[index]]));
          for(const member of saved.members){const view=views.get(member.id);if(!member.ref||!view||view.state!=='VISIBLE'||hashValue(view.exactRef)!==hashValue(member.ref))throw new AgentError('HISTORY_SOURCE_INVALID','历史集合包含已撤回或不可见的来源');}
        }
      }
    }));
  }
}
