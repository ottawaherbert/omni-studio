import { randomUUID } from 'node:crypto';
import { AgentError, ExecutionInvalidated, assertSamePayload, hashValue, stableJson, type AgentRun, type ResourceRef } from '../../../../packages/agent-core/src';
import type { ContextAccess, Dependency } from '../../../../packages/agent-context/src';
import type { AgentSqliteStore } from '../../../../packages/agent-sqlite/src';
import type { ScriptWorkspaceStore, ScriptWorkspace } from './scriptWorkspaceStore';
import type { ScriptDraftScope } from '../../../../packages/script/src/agentScope';

export type ScriptReadSource = {
  ref: ResourceRef;
  access: ContextAccess;
  purpose: 'CONVERSATION' | 'PREVIOUS_SCRIPT';
  /** null is the complete selected source; a nonempty array is an exact unit selection. */
  unitIds: string[] | null;
};
export type ScriptAuthorizationBinding = { kind:'GOAL'; goalId:string; revision:number } | { kind:'RUN'; runId:string; inputRevision:number };
export type ScriptAuthorization = {
  id:string; ownerId:string; threadId:string; workspaceId:string; commandId:string;
  workspaceRef:ResourceRef; scope:unknown; sources:ScriptReadSource[];
  binding:ScriptAuthorizationBinding|null;
};
export type ScriptReadGrant = { id:string; authorizationId:string; ownerId:string; workspaceId:string; source:ScriptReadSource };
const denied=(message:string):never=>{throw new AgentError('SCRIPT_AUTHORIZATION_DENIED',message,403);};
const same=(a:unknown,b:unknown)=>hashValue(a)===hashValue(b);
const sync=<T>(value:T):T=>{if(value&&typeof(value as any).then==='function')throw new AgentError('ASYNC_AUTHORIZATION','来源授权必须同步核验');return value;};

/** Host-only authority. No HTTP endpoint accepts these records or signs grants.
 * Frozen grants survive successor runs; current execution additionally intersects
 * every recursive source read with the new reader's exact source permissions. */
export class ScriptAuthorizationStore {
  private sourceDepth=0;
  private readers:Array<{authorization:ScriptAuthorization;phase:'CONSUME'|'VIEW'}>=[];
  constructor(private readonly store:AgentSqliteStore,private readonly workspaces:ScriptWorkspaceStore,private readonly policy:{
    validateScope(scope:unknown,workspace:ScriptWorkspace):void;
    /** Returns only the selected source projection, after exact identity and
     * recursive source visibility checks in its ORIGINAL ContextAccess. */
    readSource(source:ScriptReadSource):unknown;
  }){}
  ensureSchema(){this.store.db.exec(`
    CREATE TABLE IF NOT EXISTS script_authorizations(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,thread_id TEXT NOT NULL,workspace_id TEXT NOT NULL,command_id TEXT NOT NULL,payload_hash TEXT NOT NULL,data_json TEXT NOT NULL,binding_json TEXT,UNIQUE(owner_id,command_id));
    CREATE TABLE IF NOT EXISTS script_read_grants(id TEXT PRIMARY KEY,authorization_id TEXT NOT NULL REFERENCES script_authorizations(id),data_json TEXT NOT NULL);
  `);}
  private validateSource(source:ScriptReadSource,ownerId:string,threadId:string){
    if(!source||source.access?.ownerId!==ownerId||!source.access.scopeId||!source.access.branch||!source.ref||!['CONVERSATION','PREVIOUS_SCRIPT'].includes(source.purpose))denied('来源没有原作者或读取范围');
    const url=new URL(source.ref.uri);
    if(url.protocol!=='resource:'||url.username||url.password||url.port||url.search||url.hash||!source.ref.version||!/^[a-f0-9]{64}$/.test(source.ref.contentHash)||source.ref.branch!==source.access.branch)denied('来源引用身份无效');
    if(source.purpose==='CONVERSATION'){
      if(url.hostname!=='conversation'||!/^\/history_[\w-]+$/.test(url.pathname)||source.access.branch!=='author'||source.unitIds!==null)denied('对话来源必须是固定历史');
      const origin=this.store.db.prepare('SELECT c.thread_id,c.owner_id,c.scope_id FROM agent_conversation_sources s JOIN agent_conversations c ON c.thread_id=s.thread_id WHERE s.id=?').get(url.pathname.slice(1)) as any;
      if(!origin||origin.thread_id!==threadId||origin.owner_id!==ownerId||origin.scope_id!==source.access.scopeId)denied('不能引入另一会话的未选历史');
    }else{
      const match=/^\/(projects|workspaces)\/([\w-]+)$/.exec(url.pathname);
      if(url.hostname!=='script'||!match||source.access.scopeId!==match[2]||source.access.branch!==(match[1]==='projects'?'author':`workspace:${match[2]}`))denied('前集来源必须是明确选择的稿件版本');
    }
    if(source.unitIds!==null&&(!Array.isArray(source.unitIds)||!source.unitIds.length||new Set(source.unitIds).size!==source.unitIds.length||source.unitIds.some(id=>typeof id!=='string'||!/^[\w-]{1,120}$/.test(id))))denied('来源单元范围无效');
    sync(this.policy.readSource(source));
  }
  private decode(row:any):ScriptAuthorization{
    const data=JSON.parse(row.data_json);
    if(hashValue(data)!==row.payload_hash||data.id!==row.id||data.ownerId!==row.owner_id||data.workspaceId!==row.workspace_id||data.threadId!==row.thread_id||data.commandId!==row.command_id)throw new AgentError('SCRIPT_AUTHORIZATION_CORRUPTED','授权记录身份不一致');
    return {...data,binding:row.binding_json?JSON.parse(row.binding_json):null};
  }
  read(id:string,ownerId:string):ScriptAuthorization{
    const row=this.store.db.prepare('SELECT * FROM script_authorizations WHERE id=? AND owner_id=?').get(id,ownerId);if(!row)denied('授权不存在或不属于作者');return this.decode(row);
  }
  issue(input:{ownerId:string;threadId:string;workspaceId:string;commandId:string;scope:unknown;sources:ScriptReadSource[]}):ScriptAuthorization{
    return this.store.atomic(()=>{
      if(!input.commandId?.trim()||input.commandId.length>200||!Array.isArray(input.sources)||input.sources.length>200)denied('授权命令或来源清单无效');
      const old=this.store.db.prepare('SELECT * FROM script_authorizations WHERE owner_id=? AND command_id=?').get(input.ownerId,input.commandId) as any;
      if(old){const previous=this.decode(old);assertSamePayload(hashValue({ownerId:previous.ownerId,threadId:previous.threadId,workspaceId:previous.workspaceId,commandId:previous.commandId,scope:previous.scope,sources:previous.sources}),hashValue(input));return previous;}
      const workspace=this.workspaces.read(input.workspaceId,input.ownerId);
      if(workspace.threadId!==input.threadId||!this.store.db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND owner_id=?').get(input.threadId,input.ownerId))denied('授权会话与工作稿不匹配');
      sync(this.policy.validateScope(input.scope,workspace));
      input.sources.forEach(source=>this.validateSource(source,input.ownerId,input.threadId));
      if(new Set(input.sources.map(hashValue)).size!==input.sources.length)denied('来源授权重复');
      const data={id:`script_auth_${randomUUID()}`,...structuredClone(input),workspaceRef:{uri:`resource://script/workspaces/${workspace.id}`,version:String(workspace.revision),contentHash:hashValue(workspace.document),branch:`workspace:${workspace.id}`}};
      this.store.db.prepare('INSERT INTO script_authorizations(id,owner_id,thread_id,workspace_id,command_id,payload_hash,data_json) VALUES(?,?,?,?,?,?,?)').run(data.id,data.ownerId,data.threadId,data.workspaceId,data.commandId,hashValue(data),stableJson(data));
      for(const source of data.sources){const grant:ScriptReadGrant={id:`readgrant_${hashValue({id:data.id,source}).slice(0,32)}`,authorizationId:data.id,ownerId:data.ownerId,workspaceId:data.workspaceId,source};this.store.db.prepare('INSERT INTO script_read_grants VALUES(?,?,?)').run(grant.id,data.id,stableJson(grant));}
      return {...data,binding:null};
    });
  }
  bind(id:string,ownerId:string,binding:ScriptAuthorizationBinding):ScriptAuthorization{
    return this.store.atomic(()=>{
      const auth=this.read(id,ownerId);if(auth.binding){assertSamePayload(hashValue(auth.binding),hashValue(binding));return auth;}
      if(binding.kind==='GOAL'){
        const row=this.store.db.prepare('SELECT r.data_json,g.thread_id,g.owner_id FROM agent_goal_revisions r JOIN agent_goals g ON g.id=r.goal_id WHERE r.goal_id=? AND r.revision=?').get(binding.goalId,binding.revision) as any;
        if(!row||row.owner_id!==ownerId||row.thread_id!==auth.threadId)denied('委托不属于这份授权');const rev=JSON.parse(row.data_json);
        if(rev.authorCommandId!==auth.commandId||rev.authorizationRef!==auth.id||!same(rev.workspaceRef,auth.workspaceRef))denied('委托使用了不同工作稿或授权');
      }else if(binding.kind==='RUN'){
        const run=this.store.readRun(binding.runId,ownerId);
        const input=run.input as any;
        const explicit=run.kind==='CAPABILITY'&&Boolean(this.store.db.prepare('SELECT 1 FROM agent_commands WHERE owner_id=? AND request_id=? AND run_id=?').get(ownerId,auth.commandId,run.id));
        const chatCommand=this.store.db.prepare(`SELECT c.request_id FROM agent_conversation_commands c
          JOIN agent_turns t ON t.id=c.turn_id WHERE c.owner_id=? AND c.thread_id=? AND t.run_id=?`).get(ownerId,auth.threadId,run.id) as {request_id:string}|undefined;
        const chatRequest=chatCommand?.request_id??null;
        const chat=run.kind==='CHAT'&&chatRequest!==null&&auth.commandId===`chatstep_${hashValue({ownerId,requestId:chatRequest}).slice(0,48)}`&&
          input?.request?.capabilityId==='script.dispatch'&&Array.isArray(input?.dispatchOptions)&&input.dispatchOptions.length>0&&
          input.dispatchOptions.every((choice:any)=>choice&&typeof choice.operation==='string'&&
            (auth.scope as ScriptDraftScope).operations.includes(choice.operation)&&choice.input?.operation===choice.operation);
        if((!explicit&&!chat)||run.threadId!==auth.threadId||run.generation!==binding.inputRevision||input?.authorizationRef!==auth.id)denied('单步任务未绑定作者授权');
      }else denied('授权绑定类型无效');
      this.store.db.prepare('UPDATE script_authorizations SET binding_json=? WHERE id=? AND binding_json IS NULL').run(stableJson(binding),id);return {...auth,binding};
    });
  }
  private assertBinding(auth:ScriptAuthorization,current:boolean){
    if(!auth.binding)denied('来源授权尚未接收');
    if(auth.binding.kind==='GOAL'){
      const row=this.store.db.prepare('SELECT g.active_revision,r.data_json FROM agent_goals g JOIN agent_goal_revisions r ON r.goal_id=g.id WHERE g.id=? AND g.owner_id=? AND r.revision=?').get(auth.binding.goalId,auth.ownerId,auth.binding.revision) as any;
      if(!row||JSON.parse(row.data_json).authorizationRef!==auth.id||current&&row.active_revision!==auth.binding.revision)denied('来源授权不属于当前委托版本');
    }else{
      const run=this.store.readRun(auth.binding.runId,auth.ownerId);
      if((run.input as any)?.authorizationRef!==auth.id||current&&run.generation!==auth.binding.inputRevision)denied('来源授权不属于当前单步输入');
    }
  }
  forRun(value:AgentRun,phase:'CONSUME'|'VIEW'='CONSUME'):ScriptAuthorization{
    const run=this.store.readRun(value.id,value.ownerId);
    const linkRow=this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_run_links'").get()?this.store.db.prepare('SELECT data_json FROM agent_run_links WHERE run_id=?').get(run.id) as any:null;
    const link=linkRow?JSON.parse(linkRow.data_json):null;
    const manualRef=run.kind==='CAPABILITY'||run.kind==='CHAT'&&(run.input as any)?.request?.capabilityId==='script.dispatch'?(run.input as any)?.authorizationRef:null;
    if(link?.role==='MANUAL_STEP'&&typeof manualRef!=='string')denied('手动任务缺少本次单步授权');
    const id=manualRef||link?.authorizationRef;if(typeof id!=='string')return denied('此任务没有剧本授权');
    const auth=this.read(id,run.ownerId);this.assertBinding(auth,phase==='CONSUME');
    if(auth.threadId!==run.threadId)denied('任务不属于授权会话');
    if(link?.role==='MANUAL_STEP'&&(link.authorizationRef!==auth.id||link.workspaceRef?.uri!==auth.workspaceRef.uri||link.workspaceRef?.branch!==auth.workspaceRef.branch))denied('手动预算关联不属于本次工作稿或写作范围');
    if(link?.role==='MANUAL_STEP'&&phase==='CONSUME'){
      const goal=this.store.db.prepare('SELECT active_revision FROM agent_goals WHERE id=? AND owner_id=?').get(link.goalId,run.ownerId) as {active_revision:number}|undefined;
      if(!goal||goal.active_revision!==link.goalRevision)denied('关联委托已修订，旧手动步骤不能继续执行');
    }
    if(auth.binding!.kind==='GOAL'){
      if(!link||link.goalId!==auth.binding!.goalId||link.goalRevision!==auth.binding!.revision||!same(link.workspaceRef,auth.workspaceRef))denied('任务不属于冻结委托授权');
    }else if(auth.binding!.runId!==run.id||auth.binding!.inputRevision!==run.generation)denied('任务不属于冻结单步授权');
    return auth;
  }
  /** Never await inside this guard: recursive ContextStore/source checks inherit
   * the active NEW reader, including checks performed under an old sourceAccess. */
  withRunAuthorization<T>(run:AgentRun,phase:'CONSUME'|'VIEW',read:()=>T):T{
    const authorization=this.forRun(run,phase);return this.withAuthorization(authorization.id,authorization.ownerId,phase,read);
  }
  withAuthorization<T>(id:string,ownerId:string,phase:'CONSUME'|'VIEW',read:()=>T):T{
    const authorization=this.read(id,ownerId);this.assertBinding(authorization,phase==='CONSUME');this.readers.push({authorization,phase});
    try{return sync(read());}finally{this.readers.pop();}
  }
  activeAuthorization():ScriptAuthorization|null{return this.readers.length?structuredClone(this.readers[0].authorization):null;}
  /** Validate an already committed workspace version under its original
   * provenance. This exposes no historical prompt to the current run: the
   * caller only receives a yes/no validity check, while withdrawal and owner
   * checks still run through each frozen source. */
  withHistoricalProvenance<T>(read:()=>T):T{
    const readers=this.readers.splice(0);
    try{return sync(read());}finally{this.readers.push(...readers);}
  }
  /** A memory extracted from one committed block may only be projected when
   * every active author grant covers that exact source block. A text selection
   * never grants the full block as background memory. */
  coversMemoryBlock(workspaceId:string,range:{unitId:string;sceneId:string;blockId:string}):boolean{
    return this.readers.every(({authorization})=>{
      if(authorization.workspaceId!==workspaceId)return false;
      const scope=authorization.scope as ScriptDraftScope;
      const unit=scope.units.find(item=>item.unitId===range.unitId);
      if(!unit)return false;
      if(scope.operations.length===0)return true; // REVIEW reads selected whole units.
      if(unit.allowAllScenes)return true;
      const scene=unit.scenes.find(item=>item.sceneId===range.sceneId);
      return Boolean(scene?.allowBody&&!scene.selection&&(scene.blockIds===null||scene.blockIds?.includes(range.blockId)));
    });
  }
  readerDigest(){const identities=this.readers.map(reader=>({id:reader.authorization.id,phase:reader.phase}));return hashValue({active:identities[0]??null,intersection:[...new Set(identities.map(identity=>JSON.stringify(identity)))].sort()});}
  private covers(reader:ScriptAuthorization,source:ScriptReadSource,allowOwnWorkspace:boolean){
    // Direct workspace version dependencies are part of the authorized draft.
    // A read grant is a different authority: an old grant must still occur in
    // every current reader's explicit source selection, even for this workspace.
    if(allowOwnWorkspace&&source.purpose==='PREVIOUS_SCRIPT'&&source.access.ownerId===reader.ownerId&&source.access.scopeId===reader.workspaceId&&source.access.branch===reader.workspaceRef.branch&&source.ref.uri===reader.workspaceRef.uri&&source.ref.branch===reader.workspaceRef.branch)return true;
    return reader.sources.some(allowed=>same(allowed.ref,source.ref)&&same(allowed.access,source.access)&&allowed.purpose===source.purpose&&(allowed.unitIds===null||source.unitIds!==null&&source.unitIds.every(id=>allowed.unitIds!.includes(id))));
  }
  /** Hosts call this for direct source reads too; using a memory or a historical
   * context must not erase the selected unit range of its source authority. */
  assertSourceIntersection(source:ScriptReadSource,allowOwnWorkspace=true){
    for(const {authorization} of this.readers)if(!this.covers(authorization,source,allowOwnWorkspace))denied('旧资料超出了当前委托选择的来源范围');
  }
  grants(authorizationId:string,ownerId:string):ScriptReadGrant[]{
    const auth=this.read(authorizationId,ownerId);this.assertBinding(auth,false);
    return (this.store.db.prepare('SELECT data_json FROM script_read_grants WHERE authorization_id=? ORDER BY id').all(authorizationId) as any[]).map(row=>JSON.parse(row.data_json));
  }
  /** Candidate read grants for advisory memory projection. A historical grant
   * is addressable only while the current reader still selects its source. */
  memoryProjectionGrants(access:ContextAccess,wantedGrantId?:string):ScriptReadGrant[]{
    const active=this.readers[0]?.authorization;
    if(!active||active.ownerId!==access.ownerId||active.workspaceId!==access.scopeId||access.branch!==active.workspaceRef.branch)return [];
    const rows=wantedGrantId?
      this.store.db.prepare('SELECT data_json FROM script_read_grants WHERE id=?').all(wantedGrantId) as Array<{data_json:string}>:
      this.store.db.prepare('SELECT data_json FROM script_read_grants WHERE authorization_id=? ORDER BY id').all(active.id) as Array<{data_json:string}>;
    const result:ScriptReadGrant[]=[];
    for(const row of rows){
      const grant=JSON.parse(row.data_json) as ScriptReadGrant;
      if(grant.workspaceId!==access.scopeId||grant.ownerId!==access.ownerId||grant.source.purpose!=='PREVIOUS_SCRIPT')continue;
      try{this.readGranted(this.ref(grant),access,'EXACT');result.push(grant);}
      catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;}
    }
    return result;
  }
  ref(grant:ScriptReadGrant):ResourceRef{return {uri:`resource://script/read-grants/${grant.id}`,version:'1',contentHash:hashValue(grant),branch:`workspace:${grant.workspaceId}`};}
  private grant(ref:ResourceRef,access:ContextAccess):ScriptReadGrant{
    const url=new URL(ref.uri),match=/^\/read-grants\/(readgrant_[a-f0-9]{32})$/.exec(url.pathname);
    if(url.protocol!=='resource:'||url.hostname!=='script'||url.username||url.password||url.port||url.search||url.hash||!match||ref.version!=='1')denied('不是有效来源授权引用');
    const row=this.store.db.prepare('SELECT data_json FROM script_read_grants WHERE id=?').get(match[1]) as any;if(!row)denied('来源授权不存在');const grant:ScriptReadGrant=JSON.parse(row.data_json);
    if(grant.ownerId!==access.ownerId||grant.workspaceId!==access.scopeId||access.branch!==`workspace:${grant.workspaceId}`||!same(this.ref(grant),ref))denied('来源授权不属于当前工作稿');
    const auth=this.read(grant.authorizationId,grant.ownerId);
    if(!auth.sources.some(source=>same(source,grant.source))||grant.id!==`readgrant_${hashValue({id:auth.id,source:grant.source}).slice(0,32)}`)denied('来源授权内容已改变');return grant;
  }
  readGranted(ref:ResourceRef,access:ContextAccess,freshness:Dependency['freshness']='EXACT'):{ref:ResourceRef;source:ScriptReadSource;data:unknown}{
    if(freshness==='COLLECTION')denied('单项来源不是集合');
    const grant=this.grant(ref,access),auth=this.read(grant.authorizationId,grant.ownerId);this.assertBinding(auth,freshness==='CURRENT');
    this.assertSourceIntersection(grant.source,false);
    if(++this.sourceDepth>100){this.sourceDepth--;return denied('来源递归过深');}
    try{return {ref:this.ref(grant),source:grant.source,data:sync(this.policy.readSource(grant.source))};}finally{this.sourceDepth--;}
  }
  sourceAllowed(dependency:Dependency,access:ContextAccess){try{this.readGranted(dependency.ref,access,dependency.freshness);return true;}catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;return false;}}
}
