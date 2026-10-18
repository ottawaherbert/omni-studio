import { randomUUID } from 'node:crypto';
import { AgentError, ExecutionInvalidated, assertSamePayload, hashValue, stableJson, type ResourceRef } from '../../agent-core/src';
import { memoryRef, validateDependencies, type ContextAccess, type ContextBundle, type ContextRef, type Dependency, type MemoryKind, type MemoryRecord, type SourceValidator } from '../../agent-context/src';
import { AgentSqliteStore } from './store';

type MemoryQuery = { kind?: MemoryKind; query?: string };
type Evaluation = { checks: number; valid: Set<string>; queries: Map<string, { items: MemoryRecord[]; excluded: Array<{ id: string; reason: string }> }> };
const evaluation = (): Evaluation => ({ checks: 0, valid: new Set(), queries: new Map() });
const kinds = ['AUTHOR_PREFERENCE', 'COLLABORATION', 'NAVIGATION', 'EXECUTION_INDEX', 'DOMAIN_DERIVED'];
const validAccess = (access: ContextAccess) => {
  if (![access.ownerId, access.scopeId, access.branch].every(value => typeof value === 'string' && value.length > 0 && value.length < 500)) throw new AgentError('INVALID_CONTEXT_SCOPE', '上下文范围无效', 400);
};
const contentValue = (value: MemoryRecord['content']) => {
  if (!value || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 200 || typeof value.value !== 'string' || !value.value.trim() || value.value.length > 20000) throw new AgentError('INVALID_MEMORY_CONTENT', '记忆需要有效标题与完整内容', 400);
  return { label: value.label, value: value.value };
};

/** SQLite port for domain-neutral memory and frozen context. Source authority
 * stays with the host; derived text is never an execution or approval record. */
export class SqliteContextStore {
  private validationDepth=0;
  private validationDeadline=0;
  private readonly validSnapshots=new Map<string,ContextBundle>();
  private readonly validSources=new Set<string>();
  private readonly pendingSnapshots=new Set<string>();
  private readonly snapshotContents=new Map<string,{identity:string;bundleJson:string;evidenceJson:string|null;bundle:ContextBundle;evidence:MemoryRecord[]|undefined;size:number}>();
  private snapshotContentSize=0;
  private memoChanges=-1;
  private memoExpiresAt=0;
  constructor(private readonly store: AgentSqliteStore, private readonly sourceValid: SourceValidator, private readonly readerKey:()=>string=()=> '',
    private readonly memoryAllowed:(memory:MemoryRecord,access:ContextAccess)=>boolean=()=>true,
    private readonly maxSynchronousValidationMs=23_000,
    private readonly memoizeSources=false,
    private readonly projectedMemories:(access:ContextAccess,wantedId?:string)=>MemoryRecord[]=()=>[]) {}
  /** A synchronous read transaction, never a cache across requests or awaits.
   * Hosts include their active authority stack in readerKey. Any local write
   * changes the memo key; other connections cannot change this read snapshot. */
  withValidationBatch<T>(read:()=>T):T {
    return this.store.atomic(()=>{
      if(this.validationDepth===0)this.validationDeadline=Date.now()+this.maxSynchronousValidationMs;
      this.validationDepth++;
      try {
        this.assertValidationDeadline();
        const result=read();
        if(result&&typeof(result as any).then==='function')throw new AgentError('ASYNC_CONTEXT_VALIDATION','上下文批量核验必须同步');
        this.assertValidationDeadline();
        return result;
      } finally {
        if(--this.validationDepth===0){this.validationDeadline=0;this.validSnapshots.clear();this.validSources.clear();this.pendingSnapshots.clear();this.memoChanges=-1;this.memoExpiresAt=0;}
      }
    });
  }
  private assertValidationDeadline(){
    if(this.validationDeadline&&Date.now()>this.validationDeadline)
      throw new ExecutionInvalidated('CONTEXT_VALIDATION_LIMIT','同步来源核验超过有界时限，请在当前实现下重新核对并继续');
  }
  /** Expiry is a clock change, even when SQLite has no write. Invalidate both
   * snapshot and source memoization at the earliest memory expiry. */
  private memoState(){
    const changes=(this.store.db.prepare('SELECT total_changes() AS n').get() as {n:number}).n;
    const now=Date.now();
    if(changes!==this.memoChanges||now>=this.memoExpiresAt){
      this.validSnapshots.clear();this.validSources.clear();this.memoChanges=changes;
      const row=this.store.db.prepare(`SELECT min(json_extract(data_json,'$.expiresAt')) AS at FROM agent_memories
        WHERE json_extract(data_json,'$.expiresAt')>?`).get(now) as {at:number|null};
      this.memoExpiresAt=row.at??Infinity;
    }
    return changes;
  }
  ensureSchema() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_context_scopes(owner_id TEXT NOT NULL,scope_id TEXT NOT NULL,policy_generation INTEGER NOT NULL DEFAULT 1,forget_generation INTEGER NOT NULL DEFAULT 1,collection_revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(owner_id,scope_id));
      CREATE TABLE IF NOT EXISTS agent_memories(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,scope_id TEXT NOT NULL,branch TEXT NOT NULL,revision INTEGER NOT NULL,data_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_memories_scope ON agent_memories(owner_id,scope_id,branch);
      CREATE TABLE IF NOT EXISTS agent_memory_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,memory_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,request_id));
      CREATE TABLE IF NOT EXISTS agent_context_snapshots(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,scope_id TEXT NOT NULL,branch TEXT NOT NULL,policy_generation INTEGER NOT NULL,forget_generation INTEGER NOT NULL,digest TEXT NOT NULL,bundle_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_context_dependencies(snapshot_id TEXT NOT NULL REFERENCES agent_context_snapshots(id),ref_uri TEXT NOT NULL,ref_version TEXT NOT NULL,ref_hash TEXT NOT NULL,branch TEXT NOT NULL,freshness TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_context_artifacts(domain TEXT NOT NULL,artifact_id TEXT NOT NULL,owner_id TEXT NOT NULL,scope_id TEXT NOT NULL,branch TEXT NOT NULL,context_id TEXT NOT NULL REFERENCES agent_context_snapshots(id),context_digest TEXT NOT NULL,PRIMARY KEY(domain,artifact_id));
      CREATE TABLE IF NOT EXISTS agent_memory_rebuilds(memory_id TEXT PRIMARY KEY REFERENCES agent_memories(id),revision INTEGER NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_source_invalidations(scope_id TEXT PRIMARY KEY,retry_after INTEGER NOT NULL DEFAULT 0,retry_count INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
    `);
    if (!(this.store.db.prepare('PRAGMA table_info(agent_context_snapshots)').all() as { name: string }[]).some(column => column.name === 'memory_evidence_json')) this.store.db.exec('ALTER TABLE agent_context_snapshots ADD COLUMN memory_evidence_json TEXT');
  }
  private scope(access: ContextAccess) {
    validAccess(access);
    this.store.db.prepare('INSERT OR IGNORE INTO agent_context_scopes(owner_id,scope_id) VALUES(?,?)').run(access.ownerId, access.scopeId);
    return this.store.db.prepare('SELECT * FROM agent_context_scopes WHERE owner_id=? AND scope_id=?').get(access.ownerId, access.scopeId) as { policy_generation: number; forget_generation: number; collection_revision: number };
  }
  getMemory(id: string, access: ContextAccess): MemoryRecord {
    validAccess(access);
    const row = this.store.db.prepare('SELECT data_json FROM agent_memories WHERE id=? AND owner_id=? AND scope_id=? AND branch=?').get(id, access.ownerId, access.scopeId, access.branch) as { data_json: string } | undefined;
    if (row) return JSON.parse(row.data_json);
    const projected=this.readProjected(access,id).find(memory=>memory.id===id);
    if (!projected) throw new AgentError('MEMORY_NOT_FOUND', '记忆不存在或不属于当前范围', 404);
    return projected;
  }
  private readProjected(access:ContextAccess,wantedId?:string):MemoryRecord[]{
    const records=this.projectedMemories(access,wantedId);
    if(!Array.isArray(records)||records.length>2000||new Set(records.map(item=>item.id)).size!==records.length||
      records.some(item=>!item.id||item.ownerId!==access.ownerId||item.scopeId!==access.scopeId||item.branch!==access.branch))
      throw new AgentError('MEMORY_PROJECTION_INVALID','记忆投影不属于实际读取范围');
    return structuredClone(records);
  }
  private assertWritableMemory(id:string,access:ContextAccess){
    if(!this.store.db.prepare('SELECT 1 FROM agent_memories WHERE id=? AND owner_id=? AND scope_id=? AND branch=?').get(id,access.ownerId,access.scopeId,access.branch))
      throw new AgentError('MEMORY_PROJECTION_READONLY','来源记忆投影只读，请在原记忆范围修改');
  }
  private assertDependency(dependency: Dependency, access: ContextAccess, visited = new Set<string>(), evidence?: MemoryRecord[], work = evaluation()) {
    this.assertValidationDeadline();
    if (++work.checks > 10000) throw new AgentError('MEMORY_QUERY_COMPLEXITY', '记忆依赖过于复杂，请缩小来源范围');
    validateDependencies([dependency]);
    const cacheKey = hashValue(dependency);
    if (work.valid.has(cacheKey)) return;
    const uri = new URL(dependency.ref.uri);
    if (uri.hostname === 'memory') {
      const id = uri.pathname.slice(1);
      if (visited.has(id) || visited.size > 100) throw new AgentError('MEMORY_DEPENDENCY_CYCLE', '记忆来源依赖存在循环或过深');
      const next = new Set(visited); next.add(id);
      const current = this.getMemory(id, access);
      const memory = evidence ? evidence.find(record => hashValue(memoryRef(record)) === hashValue(dependency.ref)) : current;
      if (memory && !this.memoryAllowed(memory, access)) throw new AgentError('MEMORY_SOURCE_RANGE_DENIED', '记忆来源超出当前授权范围');
      if (evidence) {
        if (!memory || ['DELETED', 'DISABLED'].includes(current.status)) throw new AgentError('MEMORY_STALE', '记忆证据已撤回或不存在');
        for (const parent of memory.dependencies) this.assertDependency({ ...parent, freshness: 'EXACT' }, access, next, evidence, work);
        work.valid.add(cacheKey); return;
      }
      if (!memory || memory.status !== 'ACTIVE' || !memory.content || (memory.expiresAt !== null && memory.expiresAt <= Date.now()) || hashValue(memoryRef(memory)) !== hashValue(dependency.ref)) throw new AgentError('MEMORY_STALE', '记忆已纠正、停用、删除或过期');
      for (const parent of memory.dependencies) this.assertDependency(parent, access, next, undefined, work);
    } else if (uri.hostname === 'memory-collection') {
      // All members and their ancestors were captured separately for VIEW.
      if (evidence) return;
      const query: MemoryQuery = { ...(uri.searchParams.has('kind') ? { kind: uri.searchParams.get('kind') as MemoryKind } : {}), ...(uri.searchParams.has('query') ? { query: uri.searchParams.get('query')! } : {}) };
      if (decodeURIComponent(uri.pathname.slice(1)) !== access.scopeId || uri.searchParams.get('branch') !== access.branch || hashValue(this.collectionRef(access, query, visited, work)) !== hashValue(dependency.ref)) throw new AgentError('MEMORY_COLLECTION_CHANGED', '记忆检索结果已变化，需要重新读取');
    } else {
      const memoKey=this.memoizeSources&&this.validationDepth>0?
        hashValue({dependency,access,reader:this.readerKey(),changes:this.memoState()}):null;
      const valid=memoKey&&this.validSources.has(memoKey)?true:this.sourceValid(dependency, access);
      this.assertValidationDeadline();
      if(!valid)throw new AgentError('CONTEXT_SOURCE_INVALID', '上下文来源已变化或不可访问');
      if(memoKey)this.validSources.add(memoKey);
    }
    this.assertValidationDeadline();
    work.valid.add(cacheKey);
  }
  private command(access: ContextAccess, requestId: string, payload: unknown, apply: () => MemoryRecord) {
    validAccess(access);
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) throw new AgentError('INVALID_MEMORY_COMMAND', '记忆命令标识无效', 400);
    const hash = hashValue(payload);
    return this.store.atomic(() => {
      const previous = this.store.db.prepare('SELECT * FROM agent_memory_commands WHERE owner_id=? AND request_id=?').get(access.ownerId, requestId) as any;
      if (previous) { assertSamePayload(previous.payload_hash, hash); return { id: previous.memory_id as string, revision: previous.revision as number }; }
      this.scope(access);
      const record = apply();
      // Evaluate after insertion within the same transaction. A derived output
      // cannot be a member of its own source query (directly or transitively).
      // Reject such cycles rather than recursively excluding a different set
      // of ancestors on each visit, which makes identity unstable and factorial.
      if (record.status === 'ACTIVE') this.assertDependency({ ref: memoryRef(record), freshness: 'CURRENT' }, access);
      this.store.db.prepare('INSERT INTO agent_memory_commands(owner_id,request_id,payload_hash,memory_id,revision) VALUES(?,?,?,?,?)').run(access.ownerId, requestId, hash, record.id, record.revision);
      this.store.db.prepare('UPDATE agent_context_scopes SET collection_revision=collection_revision+1 WHERE owner_id=? AND scope_id=?').run(access.ownerId, access.scopeId);
      return { id: record.id, revision: record.revision };
    });
  }
  createMemory(access: ContextAccess, actor: 'author' | 'model', requestId: string, input: { key: string; kind: MemoryKind; content: NonNullable<MemoryRecord['content']>; dependencies: Dependency[]; expiresAt?: number }) {
    if (!['author', 'model'].includes(actor) || !kinds.includes(input.kind) || typeof input.key !== 'string' || !/^[a-z0-9][a-z0-9._:-]{1,159}$/.test(input.key)) throw new AgentError('INVALID_MEMORY', '记忆类型或稳定标识无效', 400);
    const content = contentValue(input.content), dependencies = validateDependencies(input.dependencies);
    if (actor === 'model' && !dependencies.length) throw new AgentError('MEMORY_SOURCE_REQUIRED', '派生记忆必须提供来源', 400);
    if (input.expiresAt !== undefined && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now())) throw new AgentError('INVALID_MEMORY_EXPIRY', '记忆过期时间无效', 400);
    return this.command(access, requestId, { action: 'create', access, actor, input }, () => {
      dependencies.forEach(dependency => this.assertDependency(dependency, access));
      const record: MemoryRecord = { ...access, id: `memory_${randomUUID()}`, key: input.key, revision: 1, kind: input.kind, origin: actor === 'author' ? 'AUTHOR_STATED' : 'MODEL_DERIVED', review: actor === 'author' ? 'HUMAN_REVIEWED' : 'AUTO_ACCEPTED', status: 'ACTIVE', content, dependencies, reason: null, expiresAt: input.expiresAt ?? null };
      this.store.db.prepare('INSERT INTO agent_memories(id,owner_id,scope_id,branch,revision,data_json) VALUES(?,?,?,?,?,?)').run(record.id, access.ownerId, access.scopeId, access.branch, record.revision, stableJson(record));
      return record;
    });
  }
  updateMemory(access: ContextAccess, requestId: string, id: string, expectedRevision: number, action: 'CORRECT' | 'DISABLE' | 'ENABLE' | 'DELETE' | 'REVIEW', content?: NonNullable<MemoryRecord['content']>) {
    if (!['CORRECT', 'DISABLE', 'ENABLE', 'DELETE', 'REVIEW'].includes(action)) throw new AgentError('INVALID_MEMORY_ACTION', '记忆操作无效', 400);
    if (action === 'CORRECT') contentValue(content!);
    return this.command(access, requestId, { action, access, id, expectedRevision, ...(content ? { content } : {}) }, () => {
      const previous = this.getMemory(id, access);
      this.assertWritableMemory(id,access);
      if (previous.revision !== expectedRevision) throw new AgentError('MEMORY_VERSION_CONFLICT', '记忆已变化，请刷新后重试');
      if (previous.status === 'DELETED') throw new AgentError('MEMORY_DELETED', '删除的记忆不能恢复；来源稿件不受影响');
      if (action === 'ENABLE' || action === 'REVIEW') previous.dependencies.forEach(dependency => this.assertDependency(dependency, access));
      const record: MemoryRecord = { ...previous, revision: previous.revision + 1,
        status: action === 'DELETE' ? 'DELETED' : action === 'DISABLE' ? 'DISABLED' : action === 'ENABLE' || action === 'CORRECT' ? 'ACTIVE' : previous.status,
        content: action === 'DELETE' ? null : action === 'CORRECT' ? contentValue(content!) : previous.content,
        dependencies: action === 'DELETE' || action === 'CORRECT' ? [] : previous.dependencies,
        origin: action === 'CORRECT' ? 'AUTHOR_STATED' : previous.origin,
        review: ['REVIEW', 'CORRECT'].includes(action) ? 'HUMAN_REVIEWED' : previous.review,
        reason: action === 'DELETE' ? 'AUTHOR_FORGOT' : action === 'DISABLE' ? 'AUTHOR_DISABLED' : null,
      };
      this.store.db.prepare('UPDATE agent_memories SET revision=?,data_json=? WHERE id=? AND revision=?').run(record.revision, stableJson(record), id, expectedRevision);
      if (['DELETE', 'DISABLE', 'CORRECT'].includes(action)) this.store.db.prepare("UPDATE agent_memory_rebuilds SET status='CANCELED' WHERE memory_id=?").run(id);
      // Conservative scope generation fences old snapshots even after restore.
      this.store.db.prepare('UPDATE agent_context_scopes SET forget_generation=forget_generation+1 WHERE owner_id=? AND scope_id=?').run(access.ownerId, access.scopeId);
      return record;
    });
  }
  private queryMemories(access: ContextAccess, query: MemoryQuery, visited = new Set<string>(), work = evaluation()) {
    validAccess(access);
    if (query.kind && !kinds.includes(query.kind) || query.query !== undefined && (typeof query.query !== 'string' || query.query.length > 2000)) throw new AgentError('INVALID_MEMORY_QUERY', '记忆检索条件无效', 400);
    const queryKey = hashValue({ access, query });
    const cached = work.queries.get(queryKey); if (cached) return cached;
    const rows = this.store.db.prepare('SELECT data_json FROM agent_memories WHERE owner_id=? AND scope_id=? AND branch=? ORDER BY id').all(access.ownerId, access.scopeId, access.branch) as { data_json: string }[];
    const items: MemoryRecord[] = [], excluded: Array<{ id: string; reason: string }> = [];
    const projected=this.readProjected(access),localIds=new Set(rows.map(row=>(JSON.parse(row.data_json) as MemoryRecord).id));
    if(projected.some(item=>localIds.has(item.id)))throw new AgentError('MEMORY_PROJECTION_INVALID','记忆投影不能覆盖本地记忆');
    for (const row of [...rows,...projected.map(memory=>({data_json:stableJson(memory)}))]) {
      const memory = JSON.parse(row.data_json) as MemoryRecord;
      if (memory.status === 'DELETED' || (query.kind && memory.kind !== query.kind)) continue;
      // Filter before recursion: an unrelated kind/search output cannot change
      // the input collection from which that output was derived.
      if (query.query && !`${memory.content?.label || ''}\n${memory.content?.value || ''}`.toLocaleLowerCase().includes(query.query.toLocaleLowerCase())) continue;
      try { this.assertDependency({ ref: memoryRef(memory), freshness: 'CURRENT' }, access, visited, undefined, work); }
      catch (error) { if (error instanceof AgentError && ['MEMORY_DEPENDENCY_CYCLE', 'MEMORY_QUERY_COMPLEXITY', 'CONTEXT_VALIDATION_LIMIT'].includes(error.code)) throw error; excluded.push({ id: memory.id, reason: error instanceof AgentError ? error.code : 'INVALID_SOURCE' }); continue; }
      items.push(memory);
    }
    const result = { items, excluded }; work.queries.set(queryKey, result); return result;
  }
  collectionRef(access: ContextAccess, query: MemoryQuery = {}, visited = new Set<string>(), work = evaluation()): ResourceRef {
    // A collection is the effective query result, including recursive validity
    // and expiry, not a scope-wide write counter. Empty results are also pinned.
    const members = this.queryMemories(access, query, visited, work).items.map(memoryRef);
    const params = new URLSearchParams({ branch: access.branch, ...(query.kind ? { kind: query.kind } : {}), ...(query.query !== undefined ? { query: query.query } : {}) });
    const digest = hashValue({ access, query, members });
    return { uri: `resource://memory-collection/${encodeURIComponent(access.scopeId)}?${params}`, version: digest, contentHash: digest, branch: access.branch };
  }
  listMemories(access: ContextAccess, query: MemoryQuery = {}) {
    return this.withValidationBatch(()=>{
      const work = evaluation();
      return { ...this.queryMemories(access, query, new Set(), work), collection: this.collectionRef(access, query, new Set(), work) };
    });
  }
  /** A domain-neutral direct source check for protected background work views. */
  assertSource(dependency: Dependency, access: ContextAccess) {
    return this.withValidationBatch(() => this.assertDependency(dependency, access));
  }
  private memoryEvidence(dependencies: Dependency[], access: ContextAccess, records = new Map<string, MemoryRecord>()): MemoryRecord[] {
    for (const dependency of dependencies) {
      const uri = new URL(dependency.ref.uri);
      const memories = uri.hostname === 'memory' ? [this.getMemory(uri.pathname.slice(1), access)] : uri.hostname === 'memory-collection'
        ? this.queryMemories(access, { ...(uri.searchParams.has('kind') ? { kind: uri.searchParams.get('kind') as MemoryKind } : {}), ...(uri.searchParams.has('query') ? { query: uri.searchParams.get('query')! } : {}) }).items : [];
      for (const memory of memories) if (!records.has(memory.id)) { records.set(memory.id, memory); this.memoryEvidence(memory.dependencies, access, records); }
    }
    return [...records.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  revokeScope(access: ContextAccess) {
    return this.store.atomic(() => { this.scope(access); this.store.db.prepare('UPDATE agent_context_scopes SET policy_generation=policy_generation+1 WHERE owner_id=? AND scope_id=?').run(access.ownerId, access.scopeId); });
  }
  /** Cheap and durable inside the author's write transaction. Read paths still
   * revalidate exact sources before a background rebuild is discovered. */
  queueSourceInvalidation(scopeId:string){
    if(!scopeId)throw new AgentError('INVALID_CONTEXT_SCOPE','来源失效范围无效',400);
    this.store.db.prepare(`INSERT INTO agent_source_invalidations(scope_id,retry_after,retry_count,updated_at) VALUES(?,0,0,?)
      ON CONFLICT(scope_id) DO UPDATE SET retry_after=0,retry_count=0,updated_at=excluded.updated_at`).run(scopeId,Date.now());
  }
  processPendingSourceInvalidations(limit=1){
    const rows=this.store.db.prepare('SELECT scope_id,retry_count FROM agent_source_invalidations WHERE retry_after<=? ORDER BY updated_at,scope_id LIMIT ?').all(Date.now(),limit) as Array<{scope_id:string;retry_count:number}>;
    let processed=0;
    for(const row of rows){
      try{this.store.atomic(()=>{this.invalidateSources(row.scope_id);this.store.db.prepare('DELETE FROM agent_source_invalidations WHERE scope_id=?').run(row.scope_id);});processed++;}
      catch(error){
        if(!(error instanceof AgentError)||error.code!=='CONTEXT_VALIDATION_LIMIT')throw error;
        const delay=Math.min(60_000,1000*2**Math.min(row.retry_count,6));
        this.store.db.prepare('UPDATE agent_source_invalidations SET retry_after=?,retry_count=retry_count+1,updated_at=? WHERE scope_id=?')
          .run(Date.now()+delay,Date.now(),row.scope_id);
      }
    }
    return processed;
  }
  /** Called from the authoritative domain write transaction. Reads also check
   * dependencies, so delayed event delivery can never make stale text valid. */
  invalidateSources(scopeId: string) {
    return this.withValidationBatch(() => {
      const rows = this.store.db.prepare('SELECT data_json FROM agent_memories WHERE scope_id=?').all(scopeId) as { data_json: string }[];
      const invalidated: string[] = [];
      for (const row of rows) {
        const memory = JSON.parse(row.data_json) as MemoryRecord;
        if (memory.status !== 'ACTIVE' || memory.origin !== 'MODEL_DERIVED') continue;
        const access = { ownerId: memory.ownerId, scopeId: memory.scopeId, branch: memory.branch };
        try { this.assertDependency({ ref: memoryRef(memory), freshness: 'CURRENT' }, access); }
        catch (error) {
          if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;
          memory.status = 'STALE'; memory.revision++; memory.reason = error instanceof AgentError ? error.code : 'SOURCE_UNAVAILABLE';
          this.store.db.prepare('UPDATE agent_memories SET revision=?,data_json=? WHERE id=?').run(memory.revision, stableJson(memory), memory.id);
          this.store.db.prepare("INSERT INTO agent_memory_rebuilds(memory_id,revision,reason,status) VALUES(?,?,?,'PENDING') ON CONFLICT(memory_id) DO UPDATE SET revision=excluded.revision,reason=excluded.reason,status='PENDING'").run(memory.id, memory.revision, memory.reason);
          this.store.db.prepare('UPDATE agent_context_scopes SET collection_revision=collection_revision+1 WHERE owner_id=? AND scope_id=?').run(access.ownerId, access.scopeId);
          invalidated.push(memory.id);
        }
      }
      return invalidated;
    });
  }
  pendingRebuilds(access: ContextAccess) {
    validAccess(access);
    return this.store.db.prepare("SELECT r.memory_id AS id,r.revision,r.reason FROM agent_memory_rebuilds r JOIN agent_memories m ON m.id=r.memory_id WHERE m.owner_id=? AND m.scope_id=? AND m.branch=? AND r.status='PENDING'").all(access.ownerId, access.scopeId, access.branch) as { id: string; revision: number; reason: string }[];
  }
  rebuildMemory(access: ContextAccess, requestId: string, id: string, expectedRevision: number, input: { content: NonNullable<MemoryRecord['content']>; dependencies: Dependency[] }) {
    const content = contentValue(input.content), dependencies = validateDependencies(input.dependencies);
    if (!dependencies.length) throw new AgentError('MEMORY_SOURCE_REQUIRED', '重建派生记忆必须重新绑定来源', 400);
    return this.command(access, requestId, { action: 'rebuild', access, id, expectedRevision, input }, () => {
      const previous = this.getMemory(id, access);
      this.assertWritableMemory(id,access);
      if (previous.revision !== expectedRevision) throw new AgentError('MEMORY_VERSION_CONFLICT', '派生记忆已变化，请重新读取');
      if (previous.origin !== 'MODEL_DERIVED' || previous.status !== 'STALE') throw new AgentError('MEMORY_REBUILD_DENIED', '不能用派生重建覆盖作者纠正、停用或删除的记忆');
      dependencies.forEach(dependency => this.assertDependency(dependency, access));
      const record: MemoryRecord = { ...previous, content, dependencies, revision: previous.revision + 1, review: 'AUTO_ACCEPTED', status: 'ACTIVE', reason: null };
      this.store.db.prepare('UPDATE agent_memories SET revision=?,data_json=? WHERE id=?').run(record.revision, stableJson(record), id);
      this.store.db.prepare("UPDATE agent_memory_rebuilds SET status='DONE' WHERE memory_id=?").run(id);
      return record;
    });
  }
  capture(access: ContextAccess, bundle: ContextBundle): ContextRef {
    return this.withValidationBatch(() => {
      const scope = this.scope(access);
      validateDependencies(bundle.dependencies).forEach(dependency => this.assertDependency(dependency, access));
      const actual = { systemInstruction: bundle.systemInstruction, prompt: bundle.prompt, ...(bundle.outputSchema ? { outputSchema: bundle.outputSchema } : {}), ...(bundle.tools ? { tools: bundle.tools } : {}) };
      if (hashValue(actual) !== bundle.payloadHash) throw new AgentError('CONTEXT_PAYLOAD_CHANGED', '上下文实际输入与摘要不一致');
      const memoryEvidence = this.memoryEvidence(bundle.dependencies, access);
      const digest = hashValue({ access, policyGeneration: scope.policy_generation, forgetGeneration: scope.forget_generation, bundle, memoryEvidence });
      const ref = { id: `context_${randomUUID()}`, digest };
      this.store.db.prepare('INSERT INTO agent_context_snapshots(id,owner_id,scope_id,branch,policy_generation,forget_generation,digest,bundle_json,memory_evidence_json) VALUES(?,?,?,?,?,?,?,?,?)').run(ref.id, access.ownerId, access.scopeId, access.branch, scope.policy_generation, scope.forget_generation, digest, stableJson(bundle), stableJson(memoryEvidence));
      for (const { ref: source, freshness } of bundle.dependencies) this.store.db.prepare('INSERT INTO agent_context_dependencies(snapshot_id,ref_uri,ref_version,ref_hash,branch,freshness) VALUES(?,?,?,?,?,?)').run(ref.id, source.uri, source.version, source.contentHash, source.branch, freshness);
      return ref;
    });
  }
  private assertSnapshot(ref: ContextRef, access: ContextAccess, view = false, copy = true): ContextBundle {
    return this.withValidationBatch(()=>{
      const changes=this.memoState();
      const key=hashValue({ref,access,view,reader:this.readerKey(),changes});
      const cached=this.validSnapshots.get(key);if(cached)return copy?structuredClone(cached):cached;
      if(this.pendingSnapshots.has(key)||this.pendingSnapshots.size>=100)throw new AgentError('CONTEXT_SOURCE_CYCLE','上下文来源存在循环或过深');
      this.pendingSnapshots.add(key);
      try {const bundle=this.assertSnapshotValue(ref,access,view);this.validSnapshots.set(key,bundle);return copy?structuredClone(bundle):bundle;}
      finally {this.pendingSnapshots.delete(key);}
    });
  }
  private assertSnapshotValue(ref: ContextRef, access: ContextAccess, view = false): ContextBundle {
    validAccess(access);
    const row = this.store.db.prepare('SELECT * FROM agent_context_snapshots WHERE id=? AND owner_id=? AND scope_id=? AND branch=?').get(ref.id, access.ownerId, access.scopeId, access.branch) as any;
    if (!row || row.digest !== ref.digest) throw new AgentError('CONTEXT_NOT_FOUND', '冻结上下文不存在或不属于当前范围', 404);
    const scope = this.scope(access);
    if (scope.policy_generation !== row.policy_generation || scope.forget_generation !== row.forget_generation) throw new AgentError('CONTEXT_REVOKED', '上下文中的记忆或权限已撤回，请使用当前资料重新准备');
    const {bundle,evidence:memoryEvidence}=this.snapshotContent(row,access);
    if (view && memoryEvidence) for (const record of memoryEvidence) this.assertDependency({ ref: memoryRef(record), freshness: 'EXACT' }, access, new Set(), memoryEvidence);
    for (const dependency of bundle.dependencies) {
      this.assertValidationDeadline();
      // A source pointer/query becoming newer is not permission revocation.
      // Original prompts remain inspectable if their exact sources are allowed.
      if (view && new URL(dependency.ref.uri).hostname === 'memory-collection') continue;
      this.assertDependency(view ? { ...dependency, freshness: 'EXACT' } : dependency, access, new Set(), view ? memoryEvidence : undefined);
    }
    this.assertValidationDeadline();
    return bundle;
  }
  /** Reuse only decoding and integrity over identical stored bytes. Owner,
   * scope generations, reader authority, expiry and dependencies are checked
   * afresh above/below this method. No caller receives these mutable objects. */
  private snapshotContent(row:any,access:ContextAccess){
    const identity=JSON.stringify([access.ownerId,access.scopeId,access.branch,row.policy_generation,row.forget_generation,row.digest]);
    const cached=this.snapshotContents.get(row.id);
    if(cached&&cached.identity===identity&&cached.bundleJson===row.bundle_json&&cached.evidenceJson===row.memory_evidence_json)return cached;
    const bundle=JSON.parse(row.bundle_json) as ContextBundle;
    const evidence:MemoryRecord[]|undefined=row.memory_evidence_json===null?undefined:JSON.parse(row.memory_evidence_json);
    if(hashValue({access,policyGeneration:row.policy_generation,forgetGeneration:row.forget_generation,bundle,...(evidence?{memoryEvidence:evidence}:{})})!==row.digest)
      throw new AgentError('CONTEXT_CORRUPTED','冻结上下文完整性校验失败');
    const size=row.bundle_json.length+(row.memory_evidence_json?.length??0);
    const value={identity,bundleJson:row.bundle_json,evidenceJson:row.memory_evidence_json,bundle,evidence,size};
    if(cached){this.snapshotContents.delete(row.id);this.snapshotContentSize-=cached.size;}
    if(size<=16_000_000){
      while(this.snapshotContents.size>=128||this.snapshotContentSize+size>16_000_000){
        const key=this.snapshotContents.keys().next().value!;this.snapshotContentSize-=this.snapshotContents.get(key)!.size;this.snapshotContents.delete(key);
      }
      this.snapshotContents.set(row.id,value);this.snapshotContentSize+=size;
    }
    return value;
  }
  assertAllowed(ref: ContextRef, access: ContextAccess) {
    try { return this.assertSnapshot(ref, access); }
    catch (error) {
      if (error instanceof AgentError && ['CONTEXT_REVOKED', 'CONTEXT_SOURCE_INVALID', 'MEMORY_STALE', 'MEMORY_COLLECTION_CHANGED', 'MEMORY_NOT_FOUND'].includes(error.code)) throw new ExecutionInvalidated(error.code, error.message);
      throw error;
    }
  }
  assertVisible(ref: ContextRef, access: ContextAccess) { return this.assertSnapshot(ref, access, true); }
  bindArtifact(domain: string, artifactId: string, ref: ContextRef, access: ContextAccess) {
    this.assertAllowed(ref, access);
    this.insertArtifact(domain, artifactId, ref, access);
  }
  /** Inherit evidence from an already committed result. The domain host must
   * separately authorize the new effect and check its current write baseline.
   * This does not authorize executing the historical model input again. */
  bindEvidenceArtifact(domain: string, artifactId: string, ref: ContextRef, access: ContextAccess) {
    this.assertVisible(ref, access);
    this.insertArtifact(domain, artifactId, ref, access);
  }
  private insertArtifact(domain: string, artifactId: string, ref: ContextRef, access: ContextAccess) {
    this.store.db.prepare('INSERT INTO agent_context_artifacts(domain,artifact_id,owner_id,scope_id,branch,context_id,context_digest) VALUES(?,?,?,?,?,?,?)').run(domain, artifactId, access.ownerId, access.scopeId, access.branch, ref.id, ref.digest);
  }
  assertArtifact(domain: string, artifactId: string, phase: 'CONSUME' | 'VIEW' = 'CONSUME') {
    const row = this.store.db.prepare('SELECT * FROM agent_context_artifacts WHERE domain=? AND artifact_id=?').get(domain, artifactId) as any;
    if (!row) return; // Existing legacy records never pretended to use this context engine.
    const access = { ownerId: row.owner_id, scopeId: row.scope_id, branch: row.branch };
    const ref = { id: row.context_id, digest: row.context_digest };
    // Artifact guards only need validation; never expose the memoized bundle.
    if(phase==='VIEW')this.assertSnapshot(ref,access,true,false);else this.assertAllowed(ref,access);
  }
  hasArtifact(domain: string, artifactId: string) { return Boolean(this.store.db.prepare('SELECT 1 FROM agent_context_artifacts WHERE domain=? AND artifact_id=?').get(domain, artifactId)); }
  view(ref: ContextRef, access: ContextAccess) {
    try { return { ref, redacted: false as const, bundle: this.assertVisible(ref, access) }; }
    catch (error) { if (!(error instanceof AgentError) || ['CONTEXT_NOT_FOUND','CONTEXT_VALIDATION_LIMIT'].includes(error.code)) throw error; return { ref, redacted: true as const, reason: error.code }; }
  }
}
