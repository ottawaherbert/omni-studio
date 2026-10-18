import type Database from 'better-sqlite3';
import { AgentError, ExecutionInvalidated, hashValue, type ModelRequest, type ModelTransport, type ResourceRef } from '../../../../packages/agent-core/src';
import { AgentSqliteStore, SqliteMemoryWorkStore, type MemoryWorkSource } from '../../../../packages/agent-sqlite/src';
import type { ContextAccess, MemoryRecord } from '../../../../packages/agent-context/src';
import type { ScriptWorkspaceStore } from '../repositories/scriptWorkspaceStore';
import type { ScriptAuthorizationStore, ScriptReadGrant } from '../repositories/scriptAuthorizationStore';
import { workspaceRef } from '../repositories/scriptWorkspaceStore';
import type { SqliteContextStore } from '../../../../packages/agent-sqlite/src';
import type { ScriptProject } from '../../../../packages/script/src/schema';

const chatText = (input: any, response: any) => `作者输入：\n${String(input?.text ?? '')}\n\n助手已提交回复：\n${String(response?.text ?? '')}`;
const DISCOVERY_BATCH = 8;
const SOURCE_BATCH_VERSION = 2;
const originalSourceKey = (key:string) => key.replace(/^draft\.v2\./,'draft.');
export const conversationTurnRef = (turnId: string, input: unknown, response: unknown): ResourceRef => ({
  uri: `resource://conversation-turn/${turnId}`, version: '1', contentHash: hashValue(chatText(input, response)), branch: 'author',
});

/** This resolver also checks the original model result's frozen context. */
export function conversationTurnSourceAllowed(db: InstanceType<typeof Database>, contexts: SqliteContextStore, ref: ResourceRef, access: ContextAccess) {
  try {
    const url = new URL(ref.uri);
    if (url.protocol !== 'resource:' || url.hostname !== 'conversation-turn' || url.username || url.password || url.port || url.search || url.hash || ref.version !== '1' || ref.branch !== 'author' || access.branch !== 'author') return false;
    const row = db.prepare('SELECT t.id,t.input_json,t.response_json,c.scope_id FROM agent_turns t JOIN agent_conversations c ON c.thread_id=t.thread_id WHERE t.id=? AND c.owner_id=?').get(url.pathname.slice(1), access.ownerId) as any;
    if (!row || !row.response_json || row.scope_id !== access.scopeId) return false;
    const input = JSON.parse(row.input_json), response = JSON.parse(row.response_json);
    if (hashValue(conversationTurnRef(row.id, input, response)) !== hashValue(ref)) return false;
    contexts.assertArtifact('conversation-turn', row.id, 'VIEW');
    return true;
  } catch(error) { if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return false; }
}

function chunks(value: string, limit = 12000) {
  const output: string[] = [];
  for (let start = 0; start < value.length; start += limit) output.push(value.slice(start, start + limit));
  return output.length ? output : [''];
}
export function workspaceSources(workspace: { id: string; ownerId: string; revision: number; document: ScriptProject }, channel: 'api' | 'external', routeRef: string): MemoryWorkSource[] {
  const access: ContextAccess = { ownerId: workspace.ownerId, scopeId: workspace.id, branch: `workspace:${workspace.id}` };
  const ref = workspaceRef(workspace), result: MemoryWorkSource[] = [];
  let parts: string[] = [], range: NonNullable<MemoryWorkSource['range']> = [], identities: unknown[] = [], length = 0;
  const flush = () => {
    if (!parts.length) return;
    const key = `draft.v2.${hashValue({ workspaceId: workspace.id, identities }).slice(0, 32)}`;
    result.push({ access, key, text: parts.join('\n'), ref, range: structuredClone(range), freshness: 'CURRENT', channel, routeRef });
    parts = []; range = []; identities = []; length = 0;
  };
  for (const unit of workspace.document.units) {
    flush(); // A memory cannot silently span distinct delivery units.
    for (const scene of unit.scenes) for (const block of scene.blocks) {
    let offset = 0, index = 0;
    do {
      const identity = { unitId: unit.id, sceneId: scene.id, blockId: block.id, part: index };
      const render = (size:number) => JSON.stringify({ ...identity, unitTitle: unit.title, sceneTitle: scene.title,
        blockType: block.type, text: block.text.slice(offset, offset + size) });
      let lo = block.text.length === 0 ? 0 : 1, hi = Math.min(12000, block.text.length - offset), chosen = -1;
      while (lo <= hi) {
        const middle = Math.floor((lo + hi) / 2);
        if (render(middle).length <= 10000) { chosen = middle; lo = middle + 1; }
        else hi = middle - 1;
      }
      if (chosen < 0) throw new AgentError('MEMORY_CHUNK_INVALID', '正文块元数据超过记忆来源限制');
      const text = render(chosen);
      if (parts.length && length + text.length + 1 > 12000) flush();
      parts.push(text); range.push({ unitId: unit.id, sceneId: scene.id, blockId: block.id }); identities.push(identity); length += text.length + 1;
      offset += chosen; index++;
    } while (offset < block.text.length);
    }
  }
  flush();
  return result;
}

/** Validate the captured source against its exact manuscript version, without
 * depending on today's batch boundaries. Older frozen batches remain usable. */
function workspaceSourceMatches(workspace: { id:string; document:ScriptProject }, source:MemoryWorkSource):boolean {
  try {
    const rows=source.text.split('\n').map(line=>JSON.parse(line));
    if(!rows.length||!source.range||rows.length!==source.range.length)return false;
    const identities=rows.map(row=>({unitId:row.unitId,sceneId:row.sceneId,blockId:row.blockId,part:row.part}));
    if(originalSourceKey(source.key)!==`draft.${hashValue({workspaceId:workspace.id,identities}).slice(0,32)}`)return false;
    return rows.every((row,index)=>{
      const unit=workspace.document.units.find(unit=>unit.id===row.unitId),scene=unit?.scenes.find(scene=>scene.id===row.sceneId);
      const block=scene?.blocks.find(block=>block.id===row.blockId),range=source.range![index];
      return Object.keys(row).sort().join() === 'blockId,blockType,part,sceneId,sceneTitle,text,unitId,unitTitle' &&
        Number.isSafeInteger(row.part)&&row.part>=0&&typeof row.text==='string'&&
        unit?.title===row.unitTitle&&scene?.title===row.sceneTitle&&block?.type===row.blockType&&block.text.includes(row.text)&&
        range.unitId===row.unitId&&range.sceneId===row.sceneId&&range.blockId===row.blockId;
    });
  }catch{return false;}
}

/** Recheck the actual committed source behind a derived memory. Legacy
 * workspace memories without block provenance fail closed inside a narrower
 * author grant, including when an old frozen context is viewed or resumed. */
export function scriptMemoryRangeAllowed(db: InstanceType<typeof Database>, workspaces: ScriptWorkspaceStore,
  memory: MemoryRecord, access: ContextAccess, covers: (workspaceId:string,range:NonNullable<MemoryWorkSource['range']>[number])=>boolean): boolean {
  if (memory.origin !== 'MODEL_DERIVED') return true;
  const workspaceDeps = memory.dependencies.filter(item => /^resource:\/\/script\/workspaces\/[\w-]+$/.test(item.ref.uri));
  if (!workspaceDeps.length) return true;
  const rows = db.prepare(`SELECT w.source_json,w.request_json,w.request_hash,o.stable_key FROM agent_memory_work_outputs o
    JOIN agent_memory_work w ON w.id=o.work_id WHERE o.memory_id=? AND w.status='DONE' ORDER BY w.updated_at DESC`).all(memory.id) as Array<{source_json:string;request_json:string;request_hash:string;stable_key:string}>;
  for (const dependency of workspaceDeps) {
    const match = /^resource:\/\/script\/workspaces\/([\w-]+)$/.exec(dependency.ref.uri);
    if (!match) return false;
    const workspaceId = match[1];
    let version: ScriptProject;
    try { version = workspaces.version(workspaceId, access.ownerId, Number(dependency.ref.version)); }
    catch(error) { if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; return false; }
    const pinned = { id: workspaceId, ownerId: access.ownerId, revision: Number(dependency.ref.version), document: version };
    if (hashValue(workspaceRef(pinned)) !== hashValue(dependency.ref)) return false;
    const matching = rows.some(row => {
      if (row.stable_key !== memory.key) return false;
      const source = JSON.parse(row.source_json) as MemoryWorkSource;
      const request=row.request_json?JSON.parse(row.request_json) as ModelRequest:null;
      const contextRef=request?.contextRef;
      const snapshot=contextRef?db.prepare('SELECT owner_id,scope_id,branch,policy_generation,forget_generation,digest FROM agent_context_snapshots WHERE id=?').get(contextRef.id) as any:null;
      const scope=snapshot?db.prepare('SELECT policy_generation,forget_generation FROM agent_context_scopes WHERE owner_id=? AND scope_id=?').get(snapshot.owner_id,snapshot.scope_id) as any:null;
      if(!request||hashValue(request)!==row.request_hash||!contextRef||!snapshot||!scope||snapshot.owner_id!==access.ownerId||
        snapshot.scope_id!==workspaceId||snapshot.branch!==source.access.branch||snapshot.digest!==contextRef.digest||
        snapshot.policy_generation!==scope.policy_generation||snapshot.forget_generation!==scope.forget_generation)return false;
      if (!Array.isArray(source.range) || !source.range.length || hashValue(source.ref) !== hashValue(dependency.ref) || source.access.ownerId !== access.ownerId ||
        source.access.scopeId !== workspaceId || source.access.branch !== access.branch || !source.range.every(range => covers(workspaceId, range))) return false;
      return workspaceSourceMatches(pinned,source);
    });
    if (!matching) return false;
  }
  return true;
}

type ProjectedMemory = MemoryRecord & { scriptProjection: { originMemoryId:string; originRef:ResourceRef; grantRef:ResourceRef } };
const projectedId=(grantId:string,memoryId:string)=>`memory_projection_${grantId}_${memoryId}`;
const projectedPattern=/^memory_projection_(readgrant_[a-f0-9]{32})_(memory_[\w-]+)$/;
const bodyUnit=(unit:any)=>({id:unit.id,title:unit.title,scenes:unit.scenes.map((scene:any)=>({id:scene.id,title:scene.title,
  location:scene.location,timeOfDay:scene.timeOfDay,storyTime:scene.storyTime,characterIds:scene.characterIds,blocks:scene.blocks}))});

/** Read-only, per-authority projection of committed manuscript memory. Its
 * virtual identity is tied to one exact read grant and the original memory;
 * neither the source memory nor its authority is copied into the new scope. */
export function createScriptMemoryProjection(db:InstanceType<typeof Database>,workspaces:ScriptWorkspaceStore,
  authorizations:ScriptAuthorizationStore){
  const candidates=(access:ContextAccess,wantedId?:string):MemoryRecord[]=>{
    const wanted=wantedId?projectedPattern.exec(wantedId):null;
    if(wantedId&&!wanted)return [];
    const grants=authorizations.memoryProjectionGrants(access,wanted?.[1]);
    const output:MemoryRecord[]=[];
    for(const grant of grants){
      let selected:any;
      try{selected=authorizations.readGranted(authorizations.ref(grant),access,'EXACT').data;}
      catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;continue;}
      if(selected?.kind!=='SCRIPT_BODY'||!Array.isArray(selected.units))continue;
      const uri=new URL(grant.source.ref.uri),sourceId=uri.pathname.split('/').at(-1)!;
      const origins=uri.pathname.startsWith('/projects/')?
        db.prepare('SELECT id FROM script_workspaces WHERE owner_id=? AND project_id=? AND base_project_revision=?').all(access.ownerId,sourceId,Number(grant.source.ref.version)) as Array<{id:string}>:
        uri.pathname.startsWith('/workspaces/')?[{id:sourceId}]:[];
      for(const origin of origins){
        const rows=db.prepare(`SELECT m.data_json FROM agent_memories m JOIN agent_memory_work_outputs o ON o.memory_id=m.id
          JOIN agent_memory_work w ON w.id=o.work_id WHERE m.owner_id=? AND m.scope_id=? AND m.branch=? AND w.status='DONE'
          ${wanted?'AND m.id=?':''} ORDER BY m.id`).all(access.ownerId,origin.id,`workspace:${origin.id}`,...(wanted?[wanted[2]]:[])) as Array<{data_json:string}>;
        for(const row of rows){
          const memory=JSON.parse(row.data_json) as MemoryRecord;
          if(memory.origin!=='MODEL_DERIVED'||memory.status!=='ACTIVE'||!memory.content||memory.expiresAt!==null&&memory.expiresAt<=Date.now())continue;
          if(wantedId&&projectedId(grant.id,memory.id)!==wantedId)continue;
          const deps=memory.dependencies.filter(item=>/^resource:\/\/script\/workspaces\/[\w-]+$/.test(item.ref.uri));
          if(deps.length!==1||deps[0].ref.uri!==`resource://script/workspaces/${origin.id}`||deps[0].freshness!=='CURRENT')continue;
          const originAccess={ownerId:access.ownerId,scopeId:origin.id,branch:`workspace:${origin.id}`};
          const sourceRef=deps[0].ref,version=Number(sourceRef.version);
          if(!Number.isSafeInteger(version)||version<1)continue;
          let original:ScriptProject;
          try{original=workspaces.version(origin.id,access.ownerId,version);}
          catch(error){if(error instanceof ExecutionInvalidated&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;continue;}
          const sourceUnits=new Map<string,any>(selected.units.map((unit:any)=>[unit.id,unit]));
          const covers=(_workspaceId:string,range:{unitId:string;sceneId:string;blockId:string})=>{
            if(grant.source.unitIds!==null&&!grant.source.unitIds.includes(range.unitId))return false;
            const originalUnit=original.units.find(unit=>unit.id===range.unitId),selectedUnit=sourceUnits.get(range.unitId);
            return Boolean(originalUnit&&selectedUnit&&hashValue(bodyUnit(originalUnit))===hashValue(selectedUnit)&&
              originalUnit.scenes.some(scene=>scene.id===range.sceneId&&scene.blocks.some(block=>block.id===range.blockId)));
          };
          if(!scriptMemoryRangeAllowed(db,workspaces,memory,originAccess,covers))continue;
          // Project grants bridge only a workspace created from that exact
          // saved project revision. Same-looking units in another work fail.
          if(uri.pathname.startsWith('/projects/')){
            const lineage=db.prepare('SELECT project_id,base_project_revision FROM script_workspaces WHERE id=? AND owner_id=?').get(origin.id,access.ownerId) as any;
            if(lineage?.project_id!==sourceId||lineage.base_project_revision!==Number(grant.source.ref.version))continue;
          }else if(sourceRef.uri!==grant.source.ref.uri||sourceRef.version!==grant.source.ref.version||
            sourceRef.contentHash!==grant.source.ref.contentHash)continue;
          const projected:ProjectedMemory={...memory,...access,id:projectedId(grant.id,memory.id),
            dependencies:[{ref:authorizations.ref(grant),freshness:'EXACT'}],
            scriptProjection:{originMemoryId:memory.id,originRef:sourceRef,grantRef:authorizations.ref(grant)}};
          output.push(projected);
        }
      }
    }
    return output;
  };
  return {candidates,allowed:(memory:MemoryRecord,access:ContextAccess)=>{
    if(!('scriptProjection' in memory))return false;
    return candidates(access,memory.id).some(candidate=>hashValue(candidate)===hashValue(memory));
  }};
}

/** Finds committed material after restart; never takes provisional candidates,
 * pending chat turns, plans, or unadopted AI suggestions as manuscript facts. */
export class ScriptMemoryScheduler {
  readonly work: SqliteMemoryWorkStore;
  constructor(private readonly db: InstanceType<typeof Database>, store: AgentSqliteStore, private readonly contexts: SqliteContextStore,
    private readonly workspaces: ScriptWorkspaceStore, private readonly transport: ModelTransport) {
    this.work = new SqliteMemoryWorkStore(store, contexts);
    this.work.ensureSchema();
    db.exec('CREATE TABLE IF NOT EXISTS script_memory_seen(kind TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(kind,source_id))');
    db.exec(`CREATE TABLE IF NOT EXISTS script_memory_scan(kind TEXT NOT NULL,source_id TEXT NOT NULL,next_index INTEGER NOT NULL,last_served INTEGER NOT NULL,PRIMARY KEY(kind,source_id));
      CREATE TABLE IF NOT EXISTS script_memory_scheduler_state(name TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
    // Batch boundaries changed. Restart only unfinished discovery; retained
    // jobs use their original identities and completed sources stay completed.
    db.transaction(()=>{
      const state=db.prepare("SELECT value FROM script_memory_scheduler_state WHERE name='source_batch_version'").get() as {value:number}|undefined;
      if(state?.value===SOURCE_BATCH_VERSION)return;
      db.prepare('UPDATE script_memory_scan SET next_index=0').run();
      db.prepare("INSERT INTO script_memory_scheduler_state(name,value) VALUES('source_batch_version',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(SOURCE_BATCH_VERSION);
    })();
    this.work.recoverSent();
    this.retireManualMaintenance();
  }
  /** Auxiliary memory is automatic. Old unsent copy/return jobs are retired
   * without deleting their evidence or touching foreground creative requests. */
  private retireManualMaintenance() {
    return this.db.prepare(`UPDATE agent_memory_work SET status='CANCELED',error='AUTOMATIC_MEMORY_ONLY',updated_at=?
      WHERE status IN ('QUEUED','FROZEN') AND attempt_id IS NULL
        AND json_extract(source_json,'$.channel')='external'
        AND (json_extract(source_json,'$.ref.uri') LIKE 'resource://conversation-turn/%'
          OR json_extract(source_json,'$.ref.uri') LIKE 'resource://script/workspaces/%')`).run(Date.now()).changes;
  }
  /** Follow the latest accepted author command, but never turn an external
   * creative request into a manual memory chore or silently switch to API. */
  private executionFor(workspaceId:string,ownerId:string):{channel:'api'|'external';routeRef:string}{
    const rows = this.db.prepare(`SELECT binding_json FROM script_authorizations
      WHERE workspace_id=? AND owner_id=? AND binding_json IS NOT NULL ORDER BY rowid DESC`).all(workspaceId,ownerId) as Array<{binding_json:string}>;
    for (const row of rows) {
      const binding = JSON.parse(row.binding_json);
      let route: any = null;
      if (binding.kind === 'RUN') {
        const run = this.db.prepare('SELECT input_json FROM agent_runs WHERE id=? AND owner_id=?').get(binding.runId,ownerId) as {input_json:string}|undefined;
        route = run ? JSON.parse(run.input_json).scriptExecution : null;
      } else if (binding.kind === 'GOAL') {
        const revision = this.db.prepare('SELECT data_json FROM agent_goal_revisions WHERE goal_id=? AND revision=?').get(binding.goalId,binding.revision) as {data_json:string}|undefined;
        route = revision ? JSON.parse(revision.data_json).route : null;
      }
      if (route && ['api','external'].includes(route.channel) && typeof route.routeRef === 'string' && route.routeRef.trim())
        return {channel:route.channel,routeRef:route.routeRef};
    }
    return {channel:'external',routeRef:'memory-manual'};
  }
  /** Commit a bounded slice and its cursor together. Unseen sources rotate by
   * last-served order, so one long manuscript cannot monopolize other scopes. */
  discover() {
    let queued = 0;
    for (const kind of ['conversation', 'workspace'] as const) {
      const row = kind === 'conversation'
        ? this.db.prepare(`SELECT t.rowid AS rowid,t.id,t.run_id,t.input_json,t.response_json,c.owner_id,c.scope_id,
              coalesce(scan.next_index,0) AS next_index
            FROM agent_turns t JOIN agent_conversations c ON c.thread_id=t.thread_id
            LEFT JOIN script_memory_scan scan ON scan.kind='conversation' AND scan.source_id=t.id
            WHERE t.response_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM script_memory_seen s WHERE s.kind='conversation' AND s.source_id=t.id)
            ORDER BY coalesce(scan.last_served,0),t.rowid LIMIT 1`).get() as any
        : this.db.prepare(`SELECT v.rowid AS rowid,v.workspace_id,v.revision,w.owner_id,w.revision AS current_revision,
              coalesce(scan.next_index,0) AS next_index
            FROM script_workspace_revisions v JOIN script_workspaces w ON w.id=v.workspace_id
            LEFT JOIN script_memory_scan scan ON scan.kind='workspace' AND scan.source_id=v.workspace_id||':'||v.revision
            WHERE NOT EXISTS(SELECT 1 FROM script_memory_seen s WHERE s.kind='workspace' AND s.source_id=v.workspace_id||':'||v.revision)
              AND NOT EXISTS(SELECT 1 FROM agent_source_invalidations i WHERE i.scope_id=v.workspace_id)
            ORDER BY coalesce(scan.last_served,0),v.rowid LIMIT 1`).get() as any;
      if (!row) continue;
      this.db.transaction(() => {
        const sourceId = kind === 'conversation' ? row.id as string : `${row.workspace_id}:${row.revision}`;
        let sources: MemoryWorkSource[] = [];
        if (kind === 'conversation') {
          const input = JSON.parse(row.input_json), response = JSON.parse(row.response_json);
          const invocation = this.db.prepare("SELECT request_json FROM agent_invocations WHERE run_id=? AND status='RECEIVED' ORDER BY rowid DESC LIMIT 1").get(row.run_id) as any;
          const original: ModelRequest | null = invocation ? JSON.parse(invocation.request_json) : null;
          const source: MemoryWorkSource = { access: { ownerId: row.owner_id, scopeId: row.scope_id, branch: 'author' }, key: `chat.${row.id}`,
            text: chatText(input, response), ref: conversationTurnRef(row.id, input, response), freshness: 'EXACT',
            channel: original?.channel === 'api' ? 'api' : 'external', routeRef: original?.routeRef ?? 'memory-manual' };
          if (source.channel === 'api') sources = chunks(source.text).map((text, index) => ({ ...source, key: `${source.key}.v2.${index}`, text }));
        } else if (row.revision === row.current_revision) {
          // A withdrawn workspace cannot feed new memory. Mark this exact
          // version seen so one inaccessible source cannot jam every tick;
          // a later committed revision is discovered under its own identity.
          let workspace: ReturnType<ScriptWorkspaceStore['read']> | null = null;
          try { workspace = this.workspaces.read(row.workspace_id, row.owner_id); } catch { /* inaccessible source */ }
          if (workspace) {
            const route=this.executionFor(workspace.id,workspace.ownerId);
            if (route.channel === 'api') sources = workspaceSources(workspace, route.channel, route.routeRef);
          }
        }
        let next = row.next_index as number;
        const end = Math.min(sources.length, next + DISCOVERY_BATCH);
        for (; next < end; next++) {
          const source = sources[next];
          if (kind === 'workspace') {
            const rebuilding = this.db.prepare(`SELECT 1 FROM agent_memory_rebuilds r
              JOIN agent_memory_work_outputs o ON o.memory_id=r.memory_id
              JOIN agent_memory_work w ON w.id=o.work_id
              WHERE r.status='PENDING' AND w.scope_id=? AND json_extract(w.source_json,'$.key') IN (?,?) LIMIT 1`).get(source.access.scopeId, source.key, originalSourceKey(source.key));
            if (rebuilding) continue;
          }
          try { this.work.enqueue(source); queued++; }
          catch (error) {
            if (error instanceof AgentError && error.code === 'MEMORY_WORK_BUDGET') break;
            throw error;
          }
        }
        if (next >= sources.length) this.db.prepare('INSERT INTO script_memory_seen(kind,source_id) VALUES(?,?)').run(kind, sourceId);
        else {
          const served = (this.db.prepare("UPDATE script_memory_scheduler_state SET value=value+1 WHERE name='served' RETURNING value").get() as {value:number}|undefined)?.value ??
            (this.db.prepare("INSERT INTO script_memory_scheduler_state(name,value) VALUES('served',1) RETURNING value").get() as {value:number}).value;
          this.db.prepare(`INSERT INTO script_memory_scan(kind,source_id,next_index,last_served) VALUES(?,?,?,?)
            ON CONFLICT(kind,source_id) DO UPDATE SET next_index=excluded.next_index,last_served=excluded.last_served`).run(kind,sourceId,next,served);
        }
      })();
    }
    return queued;
  }
  /** A stale derived memory can be regenerated only from a newer version of
   * its original committed workspace chunk. Missing/deleted scenes stay stale. */
  scheduleRebuilds() {
    this.contexts.processPendingSourceInvalidations();
    const cursor = (this.db.prepare("SELECT value FROM script_memory_scheduler_state WHERE name='rebuild_cursor'").get() as {value:number}|undefined)?.value ?? 0;
    const rows = this.db.prepare(`SELECT r.rowid AS rowid,r.memory_id,r.revision,o.work_id,o.stable_key,w.source_json
      FROM agent_memory_rebuilds r JOIN agent_memory_work_outputs o ON o.memory_id=r.memory_id
      JOIN agent_memory_work w ON w.id=o.work_id WHERE r.status='PENDING'
      ORDER BY CASE WHEN r.rowid>? THEN 0 ELSE 1 END,r.rowid LIMIT 64`).all(cursor) as any[];
    let queued = 0;
    for (const row of rows) {
      this.db.prepare("INSERT INTO script_memory_scheduler_state(name,value) VALUES('rebuild_cursor',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(row.rowid);
      const old: MemoryWorkSource = JSON.parse(row.source_json);
      if (!old.access.branch.startsWith('workspace:')) continue;
      let workspace;
      try { workspace = this.workspaces.read(old.access.scopeId, old.access.ownerId); } catch { continue; }
      const route=this.executionFor(workspace.id,workspace.ownerId);
      if (route.channel !== 'api') continue;
      const latest = workspaceSources(workspace, route.channel, route.routeRef).find(source => originalSourceKey(source.key) === originalSourceKey(old.key));
      if (!latest || hashValue(latest.ref) === hashValue(old.ref)) continue;
      try { this.work.enqueue(latest, { memoryId: row.memory_id, expectedRevision: row.revision }); queued++; }
      catch (error) {
        if (error instanceof AgentError && error.code === 'MEMORY_WORK_BUDGET') continue;
        throw error;
      }
    }
    return queued;
  }
  async runOnce(signal: AbortSignal) {
    this.retireManualMaintenance();
    this.work.cancelStaleUnsent();
    this.scheduleRebuilds();
    this.discover();
    return this.work.runOnce(this.transport, signal);
  }
}
