import { parseModelJson } from '../../model-output/src';
import { ModelResponseError } from '../../agent-core/src/model';
import { randomUUID } from 'node:crypto';
import { AgentError, hashValue, stableJson, type ModelRequest, type ModelResult, type ModelTransport, type ResourceRef } from '../../agent-core/src';
import { compileContext, type ContextAccess, type Dependency, type MemoryKind } from '../../agent-context/src';
import { SqliteContextStore } from './contextStore';
import { AgentSqliteStore } from './store';

export type MemoryWorkSource = {
  access: ContextAccess;
  key: string;
  text: string;
  ref: ResourceRef;
  /** Host-verified provenance for projecting derived text into a narrower scope. */
  range?: Array<{ unitId: string; sceneId: string; blockId: string }>;
  freshness: Dependency['freshness'];
  channel: 'api' | 'external';
  routeRef: string;
};
export type MemoryWork = {
  id: string; source: MemoryWorkSource; kind: 'EXTRACT' | 'REBUILD'; memoryId: string | null;
  expectedRevision: number | null; status: 'QUEUED' | 'FROZEN' | 'SENT' | 'UNKNOWN' | 'RECEIVED' | 'DONE' | 'CANCELED' | 'FAILED';
  request: ModelRequest | null; requestHash: string | null; attemptId: string | null;
  result: ModelResult | null; error: string | null; retryAfter: number; retryCount: number;
};
const schema = { type: 'object', required: ['items'], additionalProperties: false, properties: {
  items: { type: 'array', maxItems: 3, items: { type: 'object', required: ['key', 'kind', 'label', 'value'], additionalProperties: false,
    properties: { key: { type: 'string', pattern: '^[a-z0-9][a-z0-9._:-]{1,159}$' }, kind: { type: 'string', enum: ['AUTHOR_PREFERENCE', 'COLLABORATION', 'NAVIGATION', 'EXECUTION_INDEX', 'DOMAIN_DERIVED'] }, label: { type: 'string', maxLength: 200 }, value: { type: 'string', maxLength: 20000 } } } },
} };
const kinds = new Set<MemoryKind>(['AUTHOR_PREFERENCE', 'COLLABORATION', 'NAVIGATION', 'EXECUTION_INDEX', 'DOMAIN_DERIVED']);
const CONTRACT_VERSION = 2;
const MEMORY_SYSTEM = '你是受控记忆提取器。只从给定的已提交来源提取可复用的简短参考线索。作者明确说法优先；AI 想法与工作稿不能冒充作者采用的正式剧情事实。正文观察用 DOMAIN_DERIVED，定位线索用 NAVIGATION；只有作者明确声明的偏好才用 AUTHOR_PREFERENCE。不要写执行完成或修改授权。无可靠内容返回空 items。只返回符合 schema 的 JSON。';
const memoryPrompt = (key:string,text:string,kind:'EXTRACT'|'REBUILD',rebuildIdentity='') =>
  `来源键：${key}\n任务：${kind === 'REBUILD' ? '重建这条已失效记忆' : '提取最多三条辅助记忆'}${rebuildIdentity}\n已提交内容：\n${text}`;
const allowedKey = (key: unknown): key is string => typeof key === 'string' && /^[a-z0-9][a-z0-9._:-]{1,159}$/.test(key);
function parseResult(text: string) {
  let value: any;
  try { value = parseModelJson(text); } catch { throw new AgentError('MEMORY_RESULT_INVALID', '记忆提取返回不是 JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'items' || !Array.isArray(value.items) || value.items.length > 3) throw new AgentError('MEMORY_RESULT_INVALID', '记忆提取返回结构无效');
  const keys = new Set<string>();
  return value.items.map((item: any) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join() !== 'key,kind,label,value' || !allowedKey(item.key) || !kinds.has(item.kind) || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 200 || typeof item.value !== 'string' || !item.value.trim() || item.value.length > 20000 || keys.has(item.key)) throw new AgentError('MEMORY_RESULT_INVALID', '记忆条目不符合合同');
    keys.add(item.key);
    return item as { key: string; kind: MemoryKind; label: string; value: string };
  });
}

/** Durable, domain-neutral memory work. The caller supplies only committed
 * source text and its authoritative ref. No automatic resend follows SENT. */
export class SqliteMemoryWorkStore {
  constructor(private readonly store: AgentSqliteStore, private readonly contexts: SqliteContextStore) {}
  ensureSchema() {
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS agent_memory_work(
      id TEXT PRIMARY KEY, identity_hash TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, scope_id TEXT NOT NULL, branch TEXT NOT NULL,
      kind TEXT NOT NULL, memory_id TEXT, expected_revision INTEGER, status TEXT NOT NULL,
      source_json TEXT NOT NULL, request_json TEXT, request_hash TEXT, attempt_id TEXT, result_json TEXT, error TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, retry_after INTEGER NOT NULL DEFAULT 0, retry_count INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS agent_memory_work_ready ON agent_memory_work(status,created_at);`);
    const columns=new Set((this.store.db.prepare('PRAGMA table_info(agent_memory_work)').all() as Array<{name:string}>).map(row=>row.name));
    if(!columns.has('retry_after'))this.store.db.exec('ALTER TABLE agent_memory_work ADD COLUMN retry_after INTEGER NOT NULL DEFAULT 0');
    if(!columns.has('retry_count'))this.store.db.exec('ALTER TABLE agent_memory_work ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
    this.store.db.exec('CREATE TABLE IF NOT EXISTS agent_memory_work_outputs(work_id TEXT NOT NULL REFERENCES agent_memory_work(id),memory_id TEXT NOT NULL,stable_key TEXT NOT NULL,PRIMARY KEY(work_id,memory_id))');
    // Frozen prompts are immutable. A changed extraction contract produces a
    // new identity; pending old work is canceled, never silently rewritten.
    this.store.db.prepare("UPDATE agent_memory_work SET status='CANCELED',error='MEMORY_CONTRACT_CHANGED',updated_at=? WHERE status='FROZEN' AND (json_extract(request_json,'$.inputManifest.contractVersion') IS NULL OR json_extract(request_json,'$.inputManifest.contractVersion')<>?)").run(Date.now(), CONTRACT_VERSION);
  }
  private decode(row: any): MemoryWork {
    return { id: row.id, source: JSON.parse(row.source_json), kind: row.kind, memoryId: row.memory_id, expectedRevision: row.expected_revision,
      status: row.status, request: row.request_json ? JSON.parse(row.request_json) : null, requestHash: row.request_hash,
      attemptId: row.attempt_id, result: row.result_json ? JSON.parse(row.result_json) : null, error: row.error,
      retryAfter: row.retry_after??0, retryCount: row.retry_count??0 };
  }
  private defer(id:string){
    const row=this.store.db.prepare('SELECT status,retry_count FROM agent_memory_work WHERE id=?').get(id) as {status:string;retry_count:number}|undefined;
    if(!row)return;
    const delay=Math.min(60_000,1000*2**Math.min(row.retry_count,6)),now=Date.now();
    this.store.db.prepare('UPDATE agent_memory_work SET retry_after=?,retry_count=retry_count+1,error=?,updated_at=? WHERE id=? AND status=?')
      .run(now+delay,'CONTEXT_VALIDATION_LIMIT',now,id,row.status);
  }
  read(id: string, access: ContextAccess): MemoryWork {
    const row = this.store.db.prepare('SELECT * FROM agent_memory_work WHERE id=? AND owner_id=? AND scope_id=? AND branch=?').get(id, access.ownerId, access.scopeId, access.branch);
    if (!row) throw new AgentError('MEMORY_WORK_NOT_FOUND', '记忆任务不存在或不属于当前范围', 404);
    return this.decode(row);
  }
  list(access: ContextAccess) {
    if (!access.ownerId || !access.scopeId || !access.branch) throw new AgentError('MEMORY_SCOPE_INVALID', '记忆任务范围无效', 400);
    return (this.store.db.prepare('SELECT * FROM agent_memory_work WHERE owner_id=? AND scope_id=? AND branch=? ORDER BY created_at,id LIMIT 200').all(access.ownerId, access.scopeId, access.branch) as any[])
      .map(row => this.view(this.decode(row)));
  }
  view(work: MemoryWork): MemoryWork {
    let reason: string | null = null;
    try { this.contexts.assertSource({ ref: work.source.ref, freshness: work.source.freshness }, work.source.access); }
    catch (error) { if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error; reason = error instanceof AgentError ? error.code : 'MEMORY_SOURCE_INVALID'; }
    if (!reason && work.request?.contextRef) {
      const inspected = this.contexts.view(work.request.contextRef, work.source.access);
      if (inspected.redacted) reason = inspected.reason;
    }
    return reason ? { ...work, source: { ...work.source, text: '' }, request: null, result: null, error: reason } : work;
  }
  enqueue(source: MemoryWorkSource, rebuild?: { memoryId: string; expectedRevision: number }) {
    const { access } = source;
    if (!access.ownerId || !access.scopeId || !access.branch || !allowedKey(source.key) || typeof source.text !== 'string' || !source.text.trim() || source.text.length > 24000 || !['EXACT', 'CURRENT'].includes(source.freshness) || !['api', 'external'].includes(source.channel) || !source.routeRef || source.routeRef.length > 20000) throw new AgentError('MEMORY_WORK_INVALID', '记忆来源或执行配置无效', 400);
    if (rebuild && (!rebuild.memoryId || !Number.isSafeInteger(rebuild.expectedRevision) || rebuild.expectedRevision < 1)) throw new AgentError('MEMORY_WORK_INVALID', '重建身份无效', 400);
    const identity = hashValue({ contractVersion: CONTRACT_VERSION, access, key: source.key, ref: source.ref, kind: rebuild ? 'REBUILD' : 'EXTRACT', memoryId: rebuild?.memoryId, expectedRevision: rebuild?.expectedRevision });
    return this.store.atomic(() => {
      const old = this.store.db.prepare('SELECT * FROM agent_memory_work WHERE identity_hash=?').get(identity);
      if (old) return this.decode(old);
      // Bound background work independently of model prompt size.
      const count = this.store.db.prepare("SELECT count(*) AS n FROM agent_memory_work WHERE owner_id=? AND scope_id=? AND branch=? AND status IN ('QUEUED','FROZEN','SENT','UNKNOWN','RECEIVED')").get(access.ownerId, access.scopeId, access.branch) as { n: number };
      if (count.n >= 64) throw new AgentError('MEMORY_WORK_BUDGET', '待处理记忆任务已达上限');
      const id = `memory_work_${randomUUID()}`, now = Date.now();
      this.store.db.prepare('INSERT INTO agent_memory_work(id,identity_hash,owner_id,scope_id,branch,kind,memory_id,expected_revision,status,source_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, identity, access.ownerId, access.scopeId, access.branch, rebuild ? 'REBUILD' : 'EXTRACT', rebuild?.memoryId ?? null, rebuild?.expectedRevision ?? null, 'QUEUED', stableJson(source), now, now);
      return this.read(id, access);
    });
  }
  /** Unsent work has no physical side effect. Release its queue slot as soon
   * as its source or frozen context is revoked; SENT/UNKNOWN remain for exact
   * reconciliation and are never silently discarded. */
  cancelStaleUnsent() {
    let canceled = 0;
    const rows = this.store.db.prepare("SELECT * FROM agent_memory_work WHERE status IN ('QUEUED','FROZEN') AND retry_after<=? ORDER BY created_at,id").all(Date.now()) as any[];
    for (const row of rows) {
      const work = this.decode(row);
      let reason: string | null = null;
      try {
        this.contexts.assertSource({ ref: work.source.ref, freshness: work.source.freshness }, work.source.access);
        if (work.request?.contextRef) this.contexts.assertAllowed(work.request.contextRef, work.source.access);
      } catch (error) { if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT'){this.defer(work.id);continue;} reason = error instanceof AgentError ? error.code : 'MEMORY_SOURCE_INVALID'; }
      if (reason) canceled += this.store.db.prepare("UPDATE agent_memory_work SET status='CANCELED',error=?,updated_at=? WHERE id=? AND status IN ('QUEUED','FROZEN')").run(reason, Date.now(), work.id).changes;
    }
    return canceled;
  }
  /** Freeze only one pending task per tick. A changed source cancels it, with
   * the old request retained for audit and never submitted as current fact. */
  freezeNext(): MemoryWork | null {
    const day = Date.now() - 86_400_000;
    const rows=this.store.db.prepare("SELECT * FROM agent_memory_work WHERE status='QUEUED' AND retry_after<=? ORDER BY created_at,id").all(Date.now()) as any[];
    for(const row of rows){
    const work = this.decode(row), { source } = work;
    if(source.channel==='api'){
      const sent=this.store.db.prepare('SELECT count(*) AS n FROM agent_memory_work WHERE owner_id=? AND scope_id=? AND branch=? AND attempt_id IS NOT NULL AND updated_at>?')
        .get(source.access.ownerId,source.access.scopeId,source.access.branch,day) as {n:number};
      if(sent.n>=20)continue;
    }
    try {
      let rebuildIdentity = '';
      if (work.kind === 'REBUILD') {
        const memory = this.contexts.getMemory(work.memoryId!, source.access);
        if (memory.status !== 'STALE' || memory.revision !== work.expectedRevision || memory.origin !== 'MODEL_DERIVED') throw new AgentError('MEMORY_REBUILD_DENIED', '重建记忆已被作者改变');
        rebuildIdentity = `\n原记忆稳定键：${memory.key}\n原记忆类型：${memory.kind}\n只返回一个 items 条目，必须保持该 key 与 kind；重新概括当前已提交来源，不得沿用已失效内容。`;
      }
      const compiled = compileContext({
        systemInstruction: MEMORY_SYSTEM,
        sections: [{ id: 'committed-source', text: memoryPrompt(source.key,source.text,work.kind,rebuildIdentity), required: true, priority: 100, dependencies: [{ ref: source.ref, freshness: source.freshness }] }],
        skills: [], outputSchema: schema,
      });
      const ref = this.contexts.capture(source.access, compiled);
      const request: ModelRequest = { operationKey: `memory:${work.id}`, channel: source.channel, routeRef: source.routeRef, systemInstruction: compiled.systemInstruction, prompt: compiled.prompt, outputSchema: compiled.outputSchema, contextRef: ref, inputManifest: { contractVersion: CONTRACT_VERSION, source: source.ref, sourceKey: source.key, kind: work.kind, memoryId: work.memoryId, expectedRevision: work.expectedRevision } };
      return this.store.atomic(() => {
        const changed = this.store.db.prepare("UPDATE agent_memory_work SET status='FROZEN',request_json=?,request_hash=?,retry_after=0,retry_count=0,error=NULL,updated_at=? WHERE id=? AND status='QUEUED'").run(stableJson(request), hashValue(request), Date.now(), work.id);
        return changed.changes === 1 ? this.read(work.id, source.access) : null;
      });
    } catch (error) {
      if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT'){this.defer(work.id);continue;}
      this.store.db.prepare("UPDATE agent_memory_work SET status='CANCELED',error=?,updated_at=? WHERE id=? AND status='QUEUED'").run(error instanceof AgentError ? error.code : 'MEMORY_PREPARE_FAILED', Date.now(), work.id);
      return null;
    }
    }
    return null;
  }
  nextFrozen(channel: 'api' | 'external', sendableOnly = false) {
    const row = this.store.db.prepare("SELECT * FROM agent_memory_work WHERE status='FROZEN' AND retry_after<=? ORDER BY created_at,id").all(Date.now()) as any[];
    const day = Date.now() - 86_400_000;
    return row.map(item => this.decode(item)).find(item => {
      if (item.source.channel !== channel) return false;
      if (!sendableOnly) return true;
      const access = item.source.access;
      const sent = this.store.db.prepare('SELECT count(*) AS n FROM agent_memory_work WHERE owner_id=? AND scope_id=? AND branch=? AND attempt_id IS NOT NULL AND updated_at>?')
        .get(access.ownerId, access.scopeId, access.branch, day) as {n:number};
      return sent.n < 20;
    }) ?? null;
  }
  private assertCurrent(work: MemoryWork) {
    if (!work.request?.contextRef || hashValue(work.request) !== work.requestHash) throw new AgentError('MEMORY_REQUEST_CHANGED', '冻结请求不匹配');
    if (work.request.inputManifest?.contractVersion !== CONTRACT_VERSION) throw new AgentError('MEMORY_CONTRACT_CHANGED', '记忆提取合同已更新，请读取新冻结请求');
    this.contexts.assertAllowed(work.request.contextRef, work.source.access);
    if (work.kind === 'REBUILD') {
      const memory = this.contexts.getMemory(work.memoryId!, work.source.access);
      if (memory.status !== 'STALE' || memory.revision !== work.expectedRevision || memory.origin !== 'MODEL_DERIVED') throw new AgentError('MEMORY_REBUILD_DENIED', '作者已更改待重建记忆');
    }
  }
  /** External/manual return and delayed provider return use the same atomic
   * commit. The exact request hash and attempt fence prevent cross-job replay. */
  complete(id: string, access: ContextAccess, requestHash: string, result: ModelResult, attemptId?: string) {
    try { return this.store.atomic(() => {
      if (!result || typeof result.text !== 'string' || !result.provenance || !['provider', 'external-return'].includes(result.provenance.channel)) throw new AgentError('MEMORY_RESULT_INVALID', '模型结果缺少原文或执行来源');
      const work = this.read(id, access);
      if (work.status === 'DONE') {
        if (work.requestHash !== requestHash || hashValue(work.result) !== hashValue(result)) throw new AgentError('IDEMPOTENCY_CONFLICT', '记忆回填与已完成结果不一致');
        return work;
      }
      if (work.requestHash !== requestHash || !['FROZEN', 'SENT', 'UNKNOWN', 'RECEIVED'].includes(work.status) || (work.status !== 'FROZEN' && work.attemptId !== (attemptId??null)) || (work.status === 'FROZEN' && work.source.channel !== 'external')) throw new AgentError('MEMORY_RESULT_DENIED', '记忆回填不属于当前冻结请求');
      if(work.status==='RECEIVED'&&hashValue(work.result)!==hashValue(result))throw new AgentError('IDEMPOTENCY_CONFLICT','已接收记忆结果不能换成另一份返回');
      this.assertCurrent(work);
      if (result.failure) throw new ModelResponseError(result);
      const items = parseResult(result.text);
      if (work.kind === 'REBUILD' && items.length !== 1) throw new AgentError('MEMORY_RESULT_INVALID', '重建必须返回一条记忆');
      if (result.validationErrors?.length) throw new AgentError('MEMORY_RESULT_INVALID', '模型返回元数据无效');
      if (work.kind === 'REBUILD') {
        const old = this.contexts.getMemory(work.memoryId!, access);
        if (items[0].key !== old.key || items[0].kind !== old.kind) throw new AgentError('MEMORY_RESULT_INVALID', '重建不能更换记忆身份或类型');
      }
      const dependency: Dependency = { ref: work.source.ref, freshness: work.source.freshness };
      items.forEach((item, index) => {
        const saved = work.kind === 'REBUILD'
          ? this.contexts.rebuildMemory(access, `memory-work:${id}:rebuild`, work.memoryId!, work.expectedRevision!, { content: { label: item.label, value: item.value }, dependencies: [dependency] })
          : this.contexts.createMemory(access, 'model', `memory-work:${id}:${index}`, { key: item.key, kind: item.kind, content: { label: item.label, value: item.value }, dependencies: [dependency] });
        this.store.db.prepare('INSERT INTO agent_memory_work_outputs(work_id,memory_id,stable_key) VALUES(?,?,?)').run(id, saved.id, item.key);
      });
      this.store.db.prepare("UPDATE agent_memory_work SET status='DONE',result_json=?,error=NULL,retry_after=0,retry_count=0,updated_at=? WHERE id=?").run(stableJson(result), Date.now(), id);
      return this.read(id, access);
    }); }
    catch (error) {
      // Keep a returned body even when parsing, provenance, or source checks
      // reject consumption. A new explicit job is required to try again.
      const row = this.store.db.prepare('SELECT status,request_hash,attempt_id,owner_id,scope_id,branch,result_json,source_json FROM agent_memory_work WHERE id=?').get(id) as any;
      if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT'){
        if(row&&row.owner_id===access.ownerId&&row.scope_id===access.scopeId&&row.branch===access.branch&&row.request_hash===requestHash&&
          ['FROZEN','SENT','UNKNOWN','RECEIVED'].includes(row.status)&&(row.status==='FROZEN'?!attemptId:row.attempt_id===(attemptId??null))&&
          (!row.result_json||hashValue(JSON.parse(row.result_json))===hashValue(result)))
          {this.store.db.prepare("UPDATE agent_memory_work SET status='RECEIVED',result_json=?,error=?,updated_at=? WHERE id=?").run(stableJson(result),error.code,Date.now(),id);if(row.status==='RECEIVED')this.defer(id);}
        throw error;
      }
      if (!(error instanceof AgentError&&['IDEMPOTENCY_CONFLICT','MEMORY_RESULT_DENIED'].includes(error.code))&&
        row && row.owner_id === access.ownerId && row.scope_id === access.scopeId && row.branch === access.branch && row.request_hash === requestHash&&
        (!row.result_json||hashValue(JSON.parse(row.result_json))===hashValue(result))&&
        ['FROZEN', 'SENT', 'UNKNOWN', 'RECEIVED'].includes(row.status) &&
        (row.status === 'FROZEN' ? !attemptId&&JSON.parse(row.source_json).channel==='external' : row.attempt_id === (attemptId??null))) {
        this.store.db.prepare("UPDATE agent_memory_work SET status='FAILED',result_json=?,error=?,updated_at=? WHERE id=?").run(stableJson(result), error instanceof AgentError ? error.code : 'MEMORY_COMMIT_FAILED', Date.now(), id);
      }
      throw error;
    }
  }
  /** A crash after SENT leaves UNKNOWN; the same request must be reconciled. */
  recoverSent() { const now = Date.now(); return this.store.db.prepare("UPDATE agent_memory_work SET status='UNKNOWN',error='RESULT_UNKNOWN',updated_at=? WHERE status='SENT' AND updated_at<?").run(now, now - 600_000).changes; }
  retryReceived(): MemoryWork | null {
    const row=this.store.db.prepare("SELECT * FROM agent_memory_work WHERE status='RECEIVED' AND retry_after<=? ORDER BY created_at,id LIMIT 1").get(Date.now()) as any;
    if(!row)return null;
    const work=this.decode(row);
    try{return this.complete(work.id,work.source.access,work.requestHash!,work.result!,work.attemptId??undefined);}
    catch(error){if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')return null;throw error;}
  }
  async runOnce(transport: ModelTransport, signal: AbortSignal): Promise<MemoryWork | null> {
    signal.throwIfAborted();
    // A restart before the ambiguity deadline must not leave SENT forever:
    // the background loop rechecks the deadline without resending that request.
    this.recoverSent();
    const received=this.retryReceived();
    if(received)return received;
    this.freezeNext();
    const work = this.nextFrozen('api', true);
    if (!work) return null;
    try { this.assertCurrent(work); }
    catch (error) {
      if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT'){this.defer(work.id);return null;}
      this.store.db.prepare("UPDATE agent_memory_work SET status='CANCELED',error=?,updated_at=? WHERE id=? AND status='FROZEN'").run(error instanceof AgentError ? error.code : 'MEMORY_SOURCE_INVALID', Date.now(), work.id);
      return null;
    }
    try { await transport.preflight?.(work.request!); }
    catch (error) {
      if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT'){this.defer(work.id);return null;}
      this.store.db.prepare("UPDATE agent_memory_work SET status='FAILED',error=?,updated_at=? WHERE id=? AND status='FROZEN'").run(error instanceof AgentError ? error.code : 'MEMORY_PREFLIGHT_FAILED', Date.now(), work.id);
      throw error;
    }
    signal.throwIfAborted();
    const attemptId = `memory_attempt_${randomUUID()}`;
    let started = false;
    try { started = this.store.atomic(() => {
      this.assertCurrent(this.read(work.id, work.source.access));
      const access = work.source.access;
      const sent = this.store.db.prepare('SELECT count(*) AS n FROM agent_memory_work WHERE owner_id=? AND scope_id=? AND branch=? AND attempt_id IS NOT NULL AND updated_at>?')
        .get(access.ownerId, access.scopeId, access.branch, Date.now() - 86_400_000) as {n:number};
      if (sent.n >= 20) return false;
      return this.store.db.prepare("UPDATE agent_memory_work SET status='SENT',attempt_id=?,updated_at=? WHERE id=? AND status='FROZEN'").run(attemptId, Date.now(), work.id).changes === 1;
    }); }
    catch (error) {
      if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT'){this.defer(work.id);return null;}
      this.store.db.prepare("UPDATE agent_memory_work SET status='CANCELED',error=?,updated_at=? WHERE id=? AND status='FROZEN'").run(error instanceof AgentError ? error.code : 'MEMORY_SOURCE_INVALID', Date.now(), work.id);
      return null;
    }
    if (!started) return null;
    let result: ModelResult;
    try { result = await transport.sendOnce(work.request!, { attemptId, signal }); }
    catch (error) {
      if (error instanceof ModelResponseError) result = error.result;
      else {
        this.store.db.prepare("UPDATE agent_memory_work SET status='UNKNOWN',error=?,updated_at=? WHERE id=? AND status='SENT' AND attempt_id=?").run('RESULT_UNKNOWN', Date.now(), work.id, attemptId);
        throw error;
      }
    }
    // A malformed response is known received. Keep it for inspection; do not
    // mislabel it UNKNOWN or resend a physical request.
    try { return this.complete(work.id, work.source.access, work.requestHash!, result, attemptId); }
    catch (error) {
      if(error instanceof AgentError&&error.code==='CONTEXT_VALIDATION_LIMIT')throw error;
      this.store.db.prepare("UPDATE agent_memory_work SET status='FAILED',result_json=?,error=?,updated_at=? WHERE id=? AND status='SENT' AND attempt_id=?")
        .run(stableJson(result), error instanceof AgentError ? error.code : 'MEMORY_COMMIT_FAILED', Date.now(), work.id, attemptId);
      throw error;
    }
  }
}
