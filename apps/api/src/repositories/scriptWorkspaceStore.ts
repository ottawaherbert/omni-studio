import {outlineOnlyAdoption} from '../../../../packages/script/src/outlineAdoption';
import { randomUUID } from 'node:crypto';
import { AgentError, ExecutionInvalidated, assertSamePayload, hashValue, stableJson, type ExecutionToken, type ResourceRef, type Observation, type AgentRun } from '../../../../packages/agent-core/src';
import type { RunLifecycleParticipant } from '../../../../packages/agent-core/src/goals';
import { AgentSqliteStore } from '../../../../packages/agent-sqlite/src';
import { parseScriptProject, type ScriptProject } from '../../../../packages/script/src/schema';
import { applyWorkspacePatch, createWorkspacePatch, workspacePatchConflicts, type WorkspacePatch, type WorkspacePatchResolution } from '../../../../packages/script/src/workspacePatch';
import { exportText, type ScriptExportFormat } from '../../../../packages/script/src/exporters';
import type { ScriptRepository } from './scriptStore';

export type ScriptWorkspace = {
  id: string; ownerId: string; threadId: string; documentId: string; projectId: string | null;
  baseProjectRevision: number | null; baseWorkspaceRevision: number; hasPendingChanges?: boolean;
  revision: number; document: ScriptProject; sourceRefs: ResourceRef[];
  writerEpoch: number; writerRunId: string | null;
};
type Access = { workspaceId: string; ownerId: string };
type Command = Access & { requestId: string };
const conflict = (message: string): never => { throw new AgentError('WORKSPACE_CONFLICT', message); };
const projectRef = (project: ScriptProject): ResourceRef => ({ uri:`resource://script/projects/${project.id}`,version:String(project.revision),contentHash:hashValue(project),branch:'author' });
export const workspaceRef = (workspace: Pick<ScriptWorkspace,'id'|'revision'|'document'>): ResourceRef => ({ uri:`resource://script/workspaces/${workspace.id}`,version:String(workspace.revision),contentHash:hashValue(workspace.document),branch:`workspace:${workspace.id}` });

/** Domain documents live here; core runs only carry opaque workspace references.
 * Every public author mutation has an immutable command receipt. */
export class ScriptWorkspaceStore {
  private validationDepth = 0;
  private readonly contentHashes=new Map<string,string>();
  private contentHashSize=0;
  private pendingChangesContent:{base:string;current:string;value:boolean}|null=null;
  private revisionHashBatch:{changes:number;disabled:boolean;hashes:Map<string,string>}|null=null;
  /** Only pure content hashes are reused within a synchronous SQLite read
   * snapshot. Authority and version provenance are always checked separately. */
  withContentReadBatch<T>(read:()=>T):T{
    return this.store.atomic(()=>{
      const previous=this.revisionHashBatch;
      const changes=(this.store.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
      this.revisionHashBatch={changes,disabled:false,hashes:new Map()};
      try{
        const value=read();
        if(value&&typeof(value as any).then==='function')throw new AgentError('ASYNC_WORKSPACE_READ','工作稿批量读取必须同步');
        return value;
      }finally{this.revisionHashBatch=previous;}
    });
  }
  private revisionContentHash(workspaceId:string,revision:number):string|undefined {
    const batch=this.revisionHashBatch;
    if(batch&&!batch.disabled){
      const changes=(this.store.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
      // After any local write, do not repopulate this batch. total_changes is
      // monotonic even when an inner savepoint rolls back; disabling reuse
      // prevents a digest from the rolled-back state escaping that savepoint.
      if(changes!==batch.changes){batch.hashes.clear();batch.disabled=true;}
    }
    const key=JSON.stringify([workspaceId,revision]);
    if(batch&&!batch.disabled){const cached=batch.hashes.get(key);if(cached!==undefined)return cached;}
    const row=this.store.db.prepare('SELECT data FROM script_workspace_revisions WHERE workspace_id=? AND revision=?').get(workspaceId,revision) as {data:string}|undefined;
    if(!row)return undefined;
    const digest=this.contentHash(row.data);
    if(batch&&!batch.disabled){
      if(batch.hashes.size>=128)batch.hashes.delete(batch.hashes.keys().next().value!);
      batch.hashes.set(key,digest);
    }
    return digest;
  }
  private contentHash(data:string):string{
    const cached=this.contentHashes.get(data);
    if(cached!==undefined)return cached;
    const value=hashValue(parseScriptProject(JSON.parse(data)));
    if(data.length<=16_000_000){
      while(this.contentHashes.size>=128||this.contentHashSize+data.length>16_000_000){
        const key=this.contentHashes.keys().next().value!;this.contentHashes.delete(key);this.contentHashSize-=key.length;
      }
      this.contentHashes.set(data,value);this.contentHashSize+=data.length;
    }
    return value;
  }
  private readonly validatedVersions = new Set<string>();
  private readonly validatingVersions = new Set<string>();
  constructor(private readonly store: AgentSqliteStore, private readonly scripts: ScriptRepository, private readonly policy: {
    assertModelWrite?(input: { workspace: ScriptWorkspace; token: ExecutionToken; contextRef: {id:string;digest:string}; patch: WorkspacePatch }): void;
    bindModelVersion?(workspace: ScriptWorkspace, contextRef: {id:string;digest:string}): void;
    assertVersion?(workspaceId:string,revision:number,phase:'VIEW'|'CONSUME'): void;
    validationKey?(): string;
    changed?(workspaceId: string): void;
    /** A host-configured migration identity for ownerless legacy projects. */
    trustedLegacyProjectOwner?: string;
  } = {}) {}
  ensureSchema() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS script_workspaces(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,thread_id TEXT NOT NULL REFERENCES agent_threads(id),document_id TEXT NOT NULL,project_id TEXT,base_project_revision INTEGER,base_workspace_revision INTEGER NOT NULL,revision INTEGER NOT NULL,writer_epoch INTEGER NOT NULL DEFAULT 1,writer_run_id TEXT REFERENCES agent_runs(id),data TEXT NOT NULL,sources_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS script_workspace_revisions(workspace_id TEXT NOT NULL REFERENCES script_workspaces(id),revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(workspace_id,revision));
      CREATE TABLE IF NOT EXISTS script_workspace_parents(workspace_id TEXT NOT NULL,revision INTEGER NOT NULL,parent_revision INTEGER NOT NULL,PRIMARY KEY(workspace_id,revision,parent_revision));
      CREATE TABLE IF NOT EXISTS script_workspace_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,response_json TEXT NOT NULL,action TEXT,PRIMARY KEY(owner_id,request_id));
      CREATE TABLE IF NOT EXISTS script_workspace_merges(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner_id TEXT NOT NULL,workspace_revision INTEGER NOT NULL,author_revision INTEGER NOT NULL,digest TEXT NOT NULL,patch_json TEXT NOT NULL,document_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS script_project_owners(project_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS script_workspace_author_inputs(workspace_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
    `);
    if(this.policy.trustedLegacyProjectOwner){
      this.store.db.prepare('INSERT OR IGNORE INTO script_project_owners(project_id,owner_id) SELECT id,? FROM script_projects')
        .run(this.policy.trustedLegacyProjectOwner);
    }
    if(!(this.store.db.prepare('PRAGMA table_info(script_workspace_commands)').all() as Array<{name:string}>).some(column=>column.name==='action'))
      this.store.db.exec('ALTER TABLE script_workspace_commands ADD COLUMN action TEXT');
  }
  private decode(row: any): ScriptWorkspace {
    const document=parseScriptProject(JSON.parse(row.data));
    const base=this.store.db.prepare('SELECT data FROM script_workspace_revisions WHERE workspace_id=? AND revision=?').get(row.id,row.base_workspace_revision) as {data:string}|undefined;
    const hasPendingChanges=this.hasPendingChanges(base?.data,row.data,document);
    return {hasPendingChanges, id:row.id,ownerId:row.owner_id,threadId:row.thread_id,documentId:row.document_id,projectId:row.project_id,baseProjectRevision:row.base_project_revision,baseWorkspaceRevision:row.base_workspace_revision,revision:row.revision,writerEpoch:row.writer_epoch,writerRunId:row.writer_run_id,document,sourceRefs:JSON.parse(row.sources_json) };
  }
  private hasPendingChanges(base:string|undefined,current:string,document:ScriptProject):boolean {
    if(base===undefined||base===current)return false;
    const cached=this.pendingChangesContent;
    if(cached?.base===base&&cached.current===current)return cached.value;
    const value=Boolean(createWorkspacePatch(parseScriptProject(JSON.parse(base)),document).operations.length);
    // A single bounded pair of exact stored strings proves only this derived
    // display flag. All row, owner, document and provenance checks remain live.
    this.pendingChangesContent=base.length+current.length<=16_000_000?{base,current,value}:null;
    return value;
  }
  private raw(workspaceId: string, ownerId: string): ScriptWorkspace {
    const row = this.store.db.prepare('SELECT * FROM script_workspaces WHERE id=? AND owner_id=?').get(workspaceId,ownerId);
    if (!row) throw new AgentError('WORKSPACE_NOT_FOUND','工作稿不存在或不属于当前作者',404);
    if(row.project_id)this.assertProjectOwner(row.project_id,ownerId);
    return this.decode(row);
  }
  /** Project IDs are globally addressable in the legacy repository. Agent
   * access needs a separate owner binding; only a host-configured legacy
   * identity may read projects which predate the binding table. */
  ownsProject(projectId:string,ownerId:string):boolean{
    const bound=this.store.db.prepare('SELECT owner_id FROM script_project_owners WHERE project_id=?').get(projectId) as {owner_id:string}|undefined;
    return bound?bound.owner_id===ownerId:Boolean(this.policy.trustedLegacyProjectOwner&&this.policy.trustedLegacyProjectOwner===ownerId&&this.scripts.getProject(projectId));
  }
  assertProjectOwner(projectId:string,ownerId:string):void{
    if(!this.ownsProject(projectId,ownerId))throw new AgentError('SCRIPT_PROJECT_NOT_FOUND','作品不存在或不属于当前作者',404);
  }
  /** For a trusted project-creation or migration route only. Never derive the
   * owner from an Agent request containing a project ID. Existing bindings
   * cannot be reassigned through this method. */
  bindTrustedProjectOwner(projectId:string,ownerId:string):void{
    this.store.atomic(()=>{
      if(!this.scripts.getProject(projectId))throw new AgentError('SCRIPT_PROJECT_NOT_FOUND','作品不存在',404);
      this.store.db.prepare('INSERT OR IGNORE INTO script_project_owners(project_id,owner_id) VALUES(?,?)').run(projectId,ownerId);
      this.assertProjectOwner(projectId,ownerId);
    });
  }
  private bindNewProject(projectId:string,ownerId:string):void{
    this.store.db.prepare('INSERT OR IGNORE INTO script_project_owners(project_id,owner_id) VALUES(?,?)').run(projectId,ownerId);
    this.assertProjectOwner(projectId,ownerId);
  }
  private guardVersion(workspaceId:string,revision:number,phase:'VIEW'|'CONSUME') {
    // Re-entrant source resolution can revisit the same ancestors through both
    // version parents and context dependencies. Reuse successes only while this
    // synchronous read is on the stack, with the exact active authority and DB.
    const changes = (this.store.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    const key = hashValue({workspaceId,revision,phase,reader:this.policy.validationKey?.()??'',changes});
    if(this.validatedVersions.has(key))return;
    if(this.validatingVersions.has(key))throw new AgentError('WORKSPACE_SOURCE_CYCLE','工作稿来源存在循环');
    this.validationDepth++;this.validatingVersions.add(key);
    try {
    const seen=new Set<number>(),pending=[revision];
    const hasBindings=Boolean(this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_context_artifacts'").get());
    while(pending.length){
      const version=pending.pop()!;if(seen.has(version))continue;seen.add(version);
      const bound=hasBindings&&this.store.db.prepare("SELECT 1 FROM agent_context_artifacts WHERE domain='script-workspace-version' AND artifact_id=?").get(`${workspaceId}:${version}`);
      if(bound&&!this.policy.assertVersion)throw new AgentError('WORKSPACE_POLICY_MISSING','此工作稿需要受保护的上下文仓储');
      // Ancestors remain evidence, not a request to re-execute their old input.
      // Withdrawal must still propagate, while a normal memory update must not
      // retroactively prevent the author from editing an already visible draft.
      this.policy.assertVersion?.(workspaceId,version,version===revision?phase:'VIEW');
      for(const row of this.store.db.prepare('SELECT parent_revision FROM script_workspace_parents WHERE workspace_id=? AND revision=?').all(workspaceId,version) as any[])pending.push(row.parent_revision);
    }
    this.validatedVersions.add(key);
    } finally {
      this.validatingVersions.delete(key);
      if(--this.validationDepth===0){this.validatedVersions.clear();this.validatingVersions.clear();}
    }
  }
  read(workspaceId:string,ownerId:string) { return this.store.atomic(()=>{const workspace=this.raw(workspaceId,ownerId);this.guardVersion(workspaceId,workspace.revision,'VIEW');return workspace;}); }
  /** Permission-only reads must validate the same current version and ancestry
   * without materializing a document that the caller will never use. */
  assertReadable(workspaceId:string,ownerId:string):void {
    this.store.atomic(()=>{
      const row=this.store.db.prepare('SELECT project_id,revision FROM script_workspaces WHERE id=? AND owner_id=?').get(workspaceId,ownerId) as {project_id:string|null;revision:number}|undefined;
      if(!row)throw new AgentError('WORKSPACE_NOT_FOUND','工作稿不存在或不属于当前作者',404);
      if(row.project_id)this.assertProjectOwner(row.project_id,ownerId);
      this.guardVersion(workspaceId,row.revision,'VIEW');
    });
  }
  list(ownerId: string, scope: {threadId:string;documentId:string} | null = null) { return (this.store.db.prepare(`SELECT id,project_id FROM script_workspaces WHERE owner_id=? ${scope?'AND thread_id=? AND document_id=?':''} ORDER BY rowid DESC`).all(ownerId,...(scope?[scope.threadId,scope.documentId]:[])) as any[])
    .filter(row=>!row.project_id||this.ownsProject(row.project_id,ownerId)).flatMap(row=>{
      try{return [this.read(row.id,ownerId)];}
      catch(error){
        if(error instanceof AgentError&&/(?:REVOKED|SOURCE_INVALID|MEMORY_STALE|MEMORY_NOT_FOUND|MEMORY_COLLECTION_CHANGED|MEMORY_SOURCE_RANGE_DENIED|WORKSPACE_POLICY_MISSING)/.test(error.code))return [];
        throw error;
      }
    }); }
  version(workspaceId: string, ownerId: string, revision: number): ScriptProject {
    return this.store.atomic(()=>{
    // Historical reads need the live owner binding and the requested version's
    // provenance, not the current manuscript or its pending-change diff.
    const workspace=this.store.db.prepare('SELECT project_id FROM script_workspaces WHERE id=? AND owner_id=?').get(workspaceId,ownerId) as {project_id:string|null}|undefined;
    if(!workspace)throw new AgentError('WORKSPACE_NOT_FOUND','工作稿不存在或不属于当前作者',404);
    if(workspace.project_id)this.assertProjectOwner(workspace.project_id,ownerId);
    const row = this.store.db.prepare('SELECT data FROM script_workspace_revisions WHERE workspace_id=? AND revision=?').get(workspaceId,revision) as any;
    if (!row) throw new AgentError('WORKSPACE_VERSION_NOT_FOUND','工作稿版本不存在',404);
    this.guardVersion(workspaceId,revision,'VIEW');return parseScriptProject(JSON.parse(row.data));
    });
  }
  /** The latest author checkpoint for this AI workspace, not a history picker. */
  authorBaseline(workspaceId:string,ownerId:string):ScriptProject|null {
    return this.store.atomic(()=>{
      const workspace=this.read(workspaceId,ownerId);
      if(!workspace.projectId||workspace.baseProjectRevision===null)return null;
      if(!this.scripts.getProject(workspace.projectId))conflict('原作者稿已不存在');
      const row=this.store.db.prepare('SELECT data FROM script_workspace_author_inputs WHERE workspace_id=? AND project_id=?').get(workspace.id,workspace.projectId) as {data:string}|undefined;
      if(row){const document=parseScriptProject(JSON.parse(row.data));if(document.revision!==workspace.baseProjectRevision)conflict('作者稿同步基线不匹配');return document;}
      const legacy=this.scripts.readProjectInput(workspace.projectId,workspace.baseProjectRevision);
      if(!legacy)conflict('作者稿同步基线不存在');
      this.writeAuthorBaseline(workspace.id,legacy);
      return legacy;
    });
  }
  private writeAuthorBaseline(workspaceId:string,document:ScriptProject) {
    this.scripts.captureProjectInput(document);
    this.store.db.prepare('INSERT INTO script_workspace_author_inputs(workspace_id,project_id,data) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET project_id=excluded.project_id,data=excluded.data')
      .run(workspaceId,document.id,JSON.stringify(document));
  }
  sourceAllowed(ref:ResourceRef,access:{ownerId:string;scopeId:string;branch:string},freshness:'EXACT'|'CURRENT'|'COLLECTION') {
    try {
      const url=new URL(ref.uri),match=/^\/workspaces\/(workspace_[\w-]+)$/.exec(url.pathname);
      if(url.protocol!=='resource:'||url.hostname!=='script'||url.username||url.password||url.port||url.search||url.hash||!match||access.scopeId!==match[1]||access.branch!==`workspace:${match[1]}`||ref.branch!==access.branch||freshness==='COLLECTION')return false;
      const revision=Number(ref.version);if(!Number.isSafeInteger(revision)||revision<1||String(revision)!==ref.version)return false;
      const current=this.store.db.prepare('SELECT project_id,revision FROM script_workspaces WHERE id=? AND owner_id=?')
        .get(match[1],access.ownerId) as {project_id:string|null;revision:number}|undefined;
      if(!current)return false;
      if(current.project_id)this.assertProjectOwner(current.project_id,access.ownerId);
      if(freshness==='CURRENT'&&current.revision!==revision)return false;
      const contentHash=this.revisionContentHash(match[1],revision);
      if(contentHash===undefined)return false;
      this.guardVersion(match[1],revision,'VIEW');
      // The live current row must still match the version content semantically;
      // no current-row freshness or ownership decision is cached.
      if(freshness==='CURRENT'){
        const currentData=(this.store.db.prepare('SELECT data FROM script_workspaces WHERE id=? AND owner_id=?').get(match[1],access.ownerId) as {data:string}).data;
        if(this.contentHash(currentData)!==contentHash)return false;
      }
      return contentHash===ref.contentHash;
    } catch(error) {if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;return false;}
  }
  private command<T>(ownerId: string, requestId: string, payload: unknown, effect:()=>T): T {
    if (!ownerId || typeof requestId !== 'string' || !requestId.trim() || requestId.length>200) throw new AgentError('INVALID_WORKSPACE_COMMAND','工作稿命令标识无效',400);
    const payloadHash = hashValue(payload);
    return this.store.atomic(()=>{
      const old = this.store.db.prepare('SELECT * FROM script_workspace_commands WHERE owner_id=? AND request_id=?').get(ownerId,requestId) as any;
      if (old) { assertSamePayload(old.payload_hash,payloadHash);const result=JSON.parse(old.response_json);
        const documentView=result?.document?result:result?.workspace?.document?result.workspace:null;
        if(documentView?.id){
          // Old receipts were serialized with stableJson, which sorted nested
          // manuscript keys and changed the established timing digest. Recover
          // the same frozen revision's original serialization, never latest.
          const original=this.version(documentView.id,ownerId,documentView.revision);
          if(hashValue(original)!==hashValue(documentView.document))throw new AgentError('WORKSPACE_RECEIPT_CHANGED','工作稿命令回执与固定版本不同');
          documentView.document=original;
        }
        return result; }
      const result=effect();
      this.store.db.prepare('INSERT INTO script_workspace_commands(owner_id,request_id,payload_hash,response_json,action) VALUES(?,?,?,?,?)')
        .run(ownerId,requestId,payloadHash,JSON.stringify(result),(payload as {action?:string}).action??null);
      return result;
    });
  }
  /** Only an actual author command which changed a selected unit after the
   * last sampled manuscript can release a Goal's no-progress stop. Agent
   * application revisions never appear in this command ledger. */
  authorChangedTargetSince(workspaceId:string,ownerId:string,afterRevision:number,unitIds:string[]):boolean{
    return this.store.atomic(()=>{
      // Old restore receipts remain evidence of a real author edit. Reading
      // their target delta does not expose or reinstate a restore command.
      for(const row of this.store.db.prepare("SELECT response_json,action FROM script_workspace_commands WHERE owner_id=? AND action IN ('save-author','restore','adopt','sync-author') ORDER BY rowid").all(ownerId) as Array<{response_json:string;action:string}>){
        const response=JSON.parse(row.response_json),revision=row.action==='adopt'?response.synchronizedWorkspaceRevision:
          row.action==='sync-author'?response.synchronizedWorkspaceRevision:response.revision;
        if((response.id??response.workspaceId??response.workspace?.id)!==workspaceId||!Number.isSafeInteger(revision)||revision<=afterRevision||revision<2)continue;
        const before=this.version(workspaceId,ownerId,revision-1),after=this.version(workspaceId,ownerId,revision);
        const selected=(document:ScriptProject)=>document.units.filter(unit=>unitIds.includes(unit.id));
        if(hashValue(selected(before))!==hashValue(selected(after)))return true;
      }
      return false;
    });
  }
  create(input: {ownerId:string;threadId:string;requestId:string;source:{projectId:string;revision:number}|{document:ScriptProject}}): ScriptWorkspace {
    return this.command(input.ownerId,input.requestId,{action:'create',...input},()=>{
      if (!this.store.db.prepare('SELECT 1 FROM agent_threads WHERE id=? AND owner_id=?').get(input.threadId,input.ownerId)) throw new AgentError('WORKSPACE_THREAD_DENIED','对话不属于当前作者',403);
      let document: ScriptProject, projectId:string|null=null, baseRevision:number|null=null;
      if ('projectId' in input.source) {
        this.assertProjectOwner(input.source.projectId,input.ownerId);
        const source=this.scripts.getProject(input.source.projectId);
        if(!source)throw new AgentError('SCRIPT_NOT_FOUND','原作品已不存在',404);
        if(source.revision!==input.source.revision)conflict('原作者稿已更新，请刷新后开始');
        document=source;projectId=source.id;baseRevision=source.revision;
      } else {
        document=parseScriptProject(input.source.document);
        if(document.revision!==0||this.scripts.getProject(document.id))conflict('新工作稿不能冒充已有作品');
        if(document.units.some(unit=>unit.timingEvidence.some(e=>e.source==='ffprobe')))throw new AgentError('UNTRUSTED_TIMING_EVIDENCE','新工作稿不能自报媒体实测记录',400);
      }
      const id=`workspace_${randomUUID()}`,sources=projectId?[projectRef(document)]:[];
      if(projectId)this.writeAuthorBaseline(id,document);
      document={...document,revision:1};
      // unitContentHash is the established digest for text timing evidence.
      // Reordering nested document keys here would silently stale unchanged
      // author evidence when a workspace is first opened.
      this.store.db.prepare('INSERT INTO script_workspaces(id,owner_id,thread_id,document_id,project_id,base_project_revision,base_workspace_revision,revision,data,sources_json) VALUES(?,?,?,?,?,?,1,1,?,?)').run(id,input.ownerId,input.threadId,document.id,projectId,baseRevision,JSON.stringify(document),stableJson(sources));
      this.store.db.prepare('INSERT INTO script_workspace_revisions VALUES(?,1,?)').run(id,JSON.stringify(document));
      return this.read(id,input.ownerId);
    });
  }
  bindWriter(input: Access & {runId:string;expectedEpoch:number}): Pick<ScriptWorkspace,'id'|'revision'|'writerEpoch'|'writerRunId'> {
    return this.store.atomic(()=>{
      const workspace=this.raw(input.workspaceId,input.ownerId),run=this.store.readRun(input.runId,input.ownerId);
      if(['SUCCEEDED','FAILED','PARTIAL','CANCELED'].includes(run.status))conflict('已结束任务不能取得工作稿写入权');
      if(workspace.writerEpoch!==input.expectedEpoch||workspace.writerRunId&&workspace.writerRunId!==run.id)conflict('工作稿正由另一个任务处理');
      this.store.db.prepare('UPDATE script_workspaces SET writer_run_id=? WHERE id=?').run(run.id,workspace.id);
      return {id:workspace.id,revision:workspace.revision,writerEpoch:workspace.writerEpoch,writerRunId:run.id};
    });
  }
  /** Called by the host's transactional lifecycle hook for every terminal or
   * pause path, including budget exhaustion and unexpected worker failure. */
  releaseRun(runId: string) {
    this.store.db.prepare('UPDATE script_workspaces SET writer_run_id=NULL,writer_epoch=writer_epoch+1 WHERE writer_run_id=?').run(runId);
  }
  lifecycle(workspaceForRun: (run:AgentRun)=>string|null): RunLifecycleParticipant {
    return {
      canClaim: run => {
        const id=workspaceForRun(run);if(!id)return true;
        const workspace=this.raw(id,run.ownerId);
        return !workspace.writerRunId||workspace.writerRunId===run.id;
      },
      transition: (_previous,next) => {
        const id=workspaceForRun(next);if(!id)return;
        if(['WAITING_INPUT','NEEDS_REBASE','PAUSED','SUCCEEDED','PARTIAL','FAILED','CANCELED'].includes(next.status)){this.releaseRun(next.id);return;}
        if(next.status==='RUNNING'){
          const workspace=this.raw(id,next.ownerId);
          this.bindWriter({workspaceId:id,ownerId:next.ownerId,runId:next.id,expectedEpoch:workspace.writerEpoch});
        }
      },
    };
  }
  private save(workspace: ScriptWorkspace, document: ScriptProject, expectedRevision:number, updatedAt=Date.now(), trustedPersistedSource?:ScriptProject) {
    document=parseScriptProject(document);
    if(workspace.revision!==expectedRevision||document.revision!==expectedRevision||document.id!==workspace.documentId)conflict('工作稿已有新版本，当前输入已保留');
    this.guardVersion(workspace.id,workspace.revision,'VIEW');
    createWorkspacePatch(workspace.document,document); // identity and original material are immutable
    for(const unit of document.units)for(const evidence of unit.timingEvidence)if(evidence.source==='ffprobe'){
      const original=workspace.document.units.find(item=>item.id===unit.id)?.timingEvidence.find(item=>item.id===evidence.id);
      const trusted=trustedPersistedSource?.units.find(item=>item.id===unit.id)?.timingEvidence.find(item=>item.id===evidence.id);
      if((!original||hashValue(original)!==hashValue(evidence))&&(!trusted||hashValue(trusted)!==hashValue(evidence)))throw new AgentError('UNTRUSTED_TIMING_EVIDENCE','实测记录只能来自媒体测量流程',400);
    }
    const next={...document,revision:expectedRevision+1,updatedAt};
    if(this.store.db.prepare('UPDATE script_workspaces SET revision=?,data=? WHERE id=? AND revision=?').run(next.revision,JSON.stringify(next),workspace.id,expectedRevision).changes!==1)conflict('工作稿版本冲突');
    this.store.db.prepare('INSERT INTO script_workspace_revisions VALUES(?,?,?)').run(workspace.id,next.revision,JSON.stringify(next));
    this.store.db.prepare('INSERT INTO script_workspace_parents VALUES(?,?,?)').run(workspace.id,next.revision,workspace.revision);
    this.policy.changed?.(workspace.id);
    return this.read(workspace.id,workspace.ownerId);
  }
  saveAuthor(input: Command & {expectedRevision:number;expectedEpoch:number;document:ScriptProject;takeover?:{runId:string;expectedVersion:number}}) {
    return this.command(input.ownerId,input.requestId,{action:'save-author',...input},()=>{
      let workspace=this.read(input.workspaceId,input.ownerId);
      if(workspace.writerEpoch!==input.expectedEpoch)conflict('工作稿写入权已改变');
      if(workspace.writerRunId){
        if(input.takeover?.runId!==workspace.writerRunId)conflict('请先接管正在运行的工作稿');
        this.store.control(workspace.writerRunId,input.ownerId,input.takeover.expectedVersion,'pause',`workspace:${input.requestId}`);
        this.releaseRun(workspace.writerRunId);workspace=this.read(workspace.id,input.ownerId);
      }
      return this.save(workspace,input.document,input.expectedRevision);
    });
  }
  /** Bring independently saved author changes into an existing Goal workspace.
   * The fixed author delta is applied with the same per-field conflict rules as
   * adoption, so local AI work and unrelated author edits both survive. */
  syncAuthor(input: Command & {expectedRevision:number;expectedEpoch:number;expectedAuthorRevision:number;
    takeover?:{runId:string;expectedVersion:number}}) {
    return this.command(input.ownerId,input.requestId,{action:'sync-author',...input},()=>{
      let workspace=this.read(input.workspaceId,input.ownerId);
      if(workspace.revision!==input.expectedRevision||workspace.writerEpoch!==input.expectedEpoch)conflict('工作稿版本或写入权已改变');
      if(workspace.writerRunId){
        if(input.takeover?.runId!==workspace.writerRunId)conflict('请先接管正在运行的工作稿');
        this.store.control(workspace.writerRunId,input.ownerId,input.takeover.expectedVersion,'pause',`workspace:${input.requestId}`);
        this.releaseRun(workspace.writerRunId);workspace=this.read(workspace.id,input.ownerId);
      }
      if(!workspace.projectId||workspace.baseProjectRevision===null)conflict('此工作稿尚无可同步的作者稿');
      const author=this.scripts.getProject(workspace.projectId);
      if(!author||author.id!==workspace.documentId)conflict('原作者稿已不存在');
      if(author.revision!==input.expectedAuthorRevision||author.revision<workspace.baseProjectRevision)
        conflict('当前作者稿已更新，请刷新后比较');
      const base=this.authorBaseline(workspace.id,input.ownerId);
      if(!base)conflict('作者稿同步基线不存在');
      const delta=createWorkspacePatch(base,author),merged=delta.operations.length?
        applyWorkspacePatch(workspace.document,delta):workspace.document;
      const synchronized=delta.operations.length?this.save(workspace,{...merged,revision:workspace.revision},workspace.revision,Date.now(),author):workspace;
      this.store.db.prepare('UPDATE script_workspaces SET base_project_revision=?,sources_json=? WHERE id=?')
        .run(author.revision,stableJson([projectRef(author)]),workspace.id);
      this.writeAuthorBaseline(workspace.id,author);
      return {workspace:this.read(workspace.id,input.ownerId),authorRevision:author.revision,
        changed:delta.operations.length>0,previousWorkspaceRevision:workspace.revision,
        synchronizedWorkspaceRevision:synchronized.revision,authorDelta:delta};
    });
  }
  applyFromRun(input: Access & {token:ExecutionToken;callId:string;expectedRevision:number;writerEpoch:number;patch:WorkspacePatch;contextRef:{id:string;digest:string}}): Observation {
    return this.store.atomic(()=>{
      const run=this.store.assertExecution(input.token),workspace=this.read(input.workspaceId,input.ownerId);
      if(run.ownerId!==input.ownerId||workspace.writerRunId!==run.id||workspace.writerEpoch!==input.writerEpoch)conflict('此任务已失去工作稿写入权');
      if(!this.policy.assertModelWrite||!this.policy.bindModelVersion)throw new AgentError('WORKSPACE_POLICY_MISSING','工作稿缺少上下文、范围校验或来源绑定');
      this.policy.assertModelWrite({workspace,token:input.token,contextRef:input.contextRef,patch:input.patch});
      const document=applyWorkspacePatch(workspace.document,input.patch);
      const next={...document,revision:input.expectedRevision+1,updatedAt:Date.now()};
      const observation:Observation={status:'SUCCEEDED',summary:'改动已保存到工作稿',data:{workspaceId:workspace.id,revision:next.revision},evidence:[workspaceRef(workspace)],artifacts:[workspaceRef({id:workspace.id,revision:next.revision,document:next})],effectState:'EFFECT_VERIFIED',retry:'NEVER'};
      return this.store.commitStep(input.token,input.callId,observation,()=>{
        // Validate and bind before our own write advances CURRENT pointers.
        // The binding and actual version insert share this rollback boundary.
        this.policy.bindModelVersion!({...workspace,revision:next.revision,document:next},input.contextRef);
        this.save(workspace,document,input.expectedRevision,next.updatedAt);
      });
    });
  }
  private adoptionBasis(input: Access & {workspaceRevision:number;expectedAuthorRevision:number}) {
      const workspace=this.read(input.workspaceId,input.ownerId),selected=this.version(workspace.id,input.ownerId,input.workspaceRevision);
      if(workspace.projectId)this.assertProjectOwner(workspace.projectId,input.ownerId);
      // Adoption uses an already committed, fixed draft version. Later memory
      // extraction may add collection members, but it cannot retroactively
      // change the saved draft. VIEW still checks exact source withdrawal.
      this.guardVersion(workspace.id,input.workspaceRevision,'VIEW');
      const author=this.scripts.getProject(workspace.documentId);
      if((author?.revision??0)!==input.expectedAuthorRevision||(!workspace.projectId&&author))conflict('当前作者稿已更新');
      if(workspace.projectId&&!author)conflict('原作品已删除，不能通过旧工作稿重建');
      // Paired checkpoints exclude previously adopted changes on the next adoption.
      const base=this.version(workspace.id,input.ownerId,workspace.baseWorkspaceRevision);
      const patch=createWorkspacePatch(base,selected);
      return {workspace,selected,author,patch};
  }
  inspectAdoption(input: Access & {workspaceRevision:number;expectedAuthorRevision:number}) {
    return this.store.atomic(()=>{
      const {author,patch}=this.adoptionBasis(input);
      return author?workspacePatchConflicts(author,patch):[];
    });
  }
  prepareAdoption(input: Access & {workspaceRevision:number;expectedAuthorRevision:number;resolutions?:WorkspacePatchResolution[];outlineOnly?:boolean}) {
    return this.store.atomic(()=>{
      const {workspace,selected,author,patch}=this.adoptionBasis(input);
      if(!author&&input.resolutions?.length)conflict('新作品没有可选择的作者稿冲突');
      const merged=author?applyWorkspacePatch(author,patch,input.resolutions,selected):selected;
      if(input.outlineOnly&&!author)conflict('新作品请先整体建立，再分阶段采用');
      const document={...(input.outlineOnly?outlineOnlyAdoption(author!,merged):merged),revision:input.expectedAuthorRevision};
      const partial=input.outlineOnly?{outlineOnly:true,remainingDocument:merged}:undefined;
      const id=`merge_${randomUUID()}`,digest=hashValue({workspaceId:workspace.id,workspaceRevision:input.workspaceRevision,authorRevision:input.expectedAuthorRevision,document,...(partial?{partial}:{})});
      this.store.db.prepare('INSERT INTO script_workspace_merges VALUES(?,?,?,?,?,?,?,?)').run(id,workspace.id,input.ownerId,input.workspaceRevision,input.expectedAuthorRevision,digest,stableJson({...patch,...(partial?{partial}:{})}),JSON.stringify(document));
      return {id,digest,workspaceId:workspace.id,workspaceRevision:input.workspaceRevision,authorRevision:input.expectedAuthorRevision,patch,document};
    });
  }
  adopt(input: Command & {proposalId:string;digest:string}) {
    return this.command(input.ownerId,input.requestId,{action:'adopt',...input},()=>{
      const workspace=this.read(input.workspaceId,input.ownerId);
      const proposal=this.store.db.prepare('SELECT * FROM script_workspace_merges WHERE id=? AND workspace_id=? AND owner_id=?').get(input.proposalId,workspace.id,input.ownerId) as any;
      if(!proposal||proposal.digest!==input.digest)conflict('采用提案不存在或已改变');
      if(workspace.projectId)this.assertProjectOwner(workspace.projectId,input.ownerId);
      if(workspace.writerRunId)conflict('请先暂停工作稿再采用');
      if(workspace.revision!==proposal.workspace_revision)conflict('工作稿在预览后已修改，请重新比较');
      this.guardVersion(workspace.id,proposal.workspace_revision,'VIEW');
      if(workspace.projectId&&!this.scripts.getProject(workspace.projectId))conflict('原作品已删除，不能重建');
      const document=this.scripts.saveProject(JSON.parse(proposal.document_json),proposal.author_revision);
      this.bindNewProject(document.id,input.ownerId);
      // Continue from the actual merged author version. Otherwise a later Goal
      // would reason over a workspace missing the author's independent edits.
      const synchronized=this.save(workspace,{...document,revision:workspace.revision},workspace.revision,Date.now(),document);
      const partial=JSON.parse(proposal.patch_json).partial as {outlineOnly:true;remainingDocument:ScriptProject}|undefined;
      const continued=partial?this.save(synchronized,{...partial.remainingDocument,revision:synchronized.revision},synchronized.revision,Date.now(),document):synchronized;
      this.store.db.prepare('UPDATE script_workspaces SET project_id=?,base_project_revision=?,base_workspace_revision=?,sources_json=? WHERE id=?').run(document.id,document.revision,synchronized.revision,stableJson([projectRef(document)]),workspace.id);
      this.writeAuthorBaseline(workspace.id,document);
      return {projectId:document.id,projectRevision:document.revision,workspaceId:workspace.id,workspaceRevision:proposal.workspace_revision,synchronizedWorkspaceRevision:continued.revision,partial:Boolean(partial),proposalId:proposal.id};
    });
  }
  exportVersion(input: Access & {revision:number;unitIds:string[];format:ScriptExportFormat}) {
    const document=this.version(input.workspaceId,input.ownerId,input.revision);
    if(!['markdown','fountain','json'].includes(input.format)||!input.unitIds.length||new Set(input.unitIds).size!==input.unitIds.length||input.unitIds.some(id=>!document.units.some(unit=>unit.id===id)))throw new AgentError('INVALID_WORKSPACE_EXPORT','导出格式或单元范围无效',400);
    const selected={...document,units:document.units.filter(unit=>input.unitIds.includes(unit.id))};
    return {kind:'candidate' as const,ref:workspaceRef({id:input.workspaceId,revision:input.revision,document}),unitIds:selected.units.map(unit=>unit.id),text:input.format==='json'?JSON.stringify(selected,null,2):exportText(selected,input.format)};
  }
}
