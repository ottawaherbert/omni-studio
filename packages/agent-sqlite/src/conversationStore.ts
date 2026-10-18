import { randomUUID } from 'node:crypto';
import { AgentError, assertSamePayload, hashValue, stableJson, type ResourceRef, type RunLifecycleParticipant } from '../../agent-core/src';
import { AgentSqliteStore } from './store';

export type ConversationTurn = { id: string; runId: string; ordinal: number; input: any; response: any | null; status: string };
export type Conversation = { id: string; scopeId: string; version: number; seed: unknown[]; turns: ConversationTurn[]; restartedTo: string | null };
export type ConversationCommandIdentity = { threadId: string; ownerId: string; requestId: string; expectedVersion: number; requestEnvelope: unknown };
export type ConversationRestartCommand = { threadId: string; ownerId: string; requestId: string; expectedVersion: number; clientKey: string };
/** Persistent dialogue is domain-neutral. The host owns message/response schemas,
 * model policy and prompt compilation. A turn never creates a domain project. */
export class SqliteConversationStore {
  constructor(private readonly store: AgentSqliteStore) {}
  private readonly retirementGuard: RunLifecycleParticipant = {
    canClaim: run => !this.restartedTo(run.threadId),
    transition: (_previous, next) => {
      // Budget/lease recovery must not reactivate work from a cleared dialogue.
      // Cancellation still uses the normal lifecycle to release its resources.
      if (next.status !== 'CANCELED') this.assertNotRestarted(next.threadId);
    },
  };
  ensureSchema() {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_conversations(thread_id TEXT PRIMARY KEY REFERENCES agent_threads(id),owner_id TEXT NOT NULL,scope_id TEXT NOT NULL,client_key TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,seed_json TEXT NOT NULL,UNIQUE(owner_id,scope_id,client_key));
      CREATE TABLE IF NOT EXISTS agent_turns(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES agent_conversations(thread_id),run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id),ordinal INTEGER NOT NULL,input_json TEXT NOT NULL,response_json TEXT,UNIQUE(thread_id,ordinal));
      CREATE TABLE IF NOT EXISTS agent_conversation_commands(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,thread_id TEXT NOT NULL,turn_id TEXT NOT NULL,PRIMARY KEY(owner_id,request_id));
      CREATE TABLE IF NOT EXISTS agent_conversation_sources(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES agent_conversations(thread_id),turn_id TEXT NOT NULL UNIQUE REFERENCES agent_turns(id),content_hash TEXT NOT NULL,data_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_conversation_restarts(owner_id TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,thread_id TEXT NOT NULL UNIQUE REFERENCES agent_conversations(thread_id),next_thread_id TEXT NOT NULL UNIQUE REFERENCES agent_conversations(thread_id),PRIMARY KEY(owner_id,request_id));
    `);
    this.store.addLifecycleParticipant(this.retirementGuard);
  }
  private restartedTo(threadId: string): string | null {
    const row = this.store.db.prepare('SELECT next_thread_id FROM agent_conversation_restarts WHERE thread_id=?').get(threadId) as { next_thread_id: string } | undefined;
    return row?.next_thread_id ?? null;
  }
  private assertNotRestarted(threadId: string) {
    if (this.restartedTo(threadId)) throw new AgentError('CONVERSATION_RESTARTED', '此对话已清空重来，请从新对话继续', 409);
  }
  assertActive(threadId: string, ownerId: string): Conversation {
    const conversation = this.read(threadId, ownerId);
    this.assertNotRestarted(threadId);
    return conversation;
  }
  open(ownerId: string, scopeId: string, clientKey: string, seed: unknown[] = []): Conversation {
    if (!ownerId || !scopeId || typeof clientKey !== 'string' || !clientKey.trim() || clientKey.length > 200 || !Array.isArray(seed) || stableJson(seed).length > 500000) throw new AgentError('INVALID_CONVERSATION', '对话身份或历史内容无效', 400);
    return this.store.atomic(() => {
      const old = this.store.db.prepare('SELECT thread_id FROM agent_conversations WHERE owner_id=? AND scope_id=? AND client_key=?').get(ownerId, scopeId, clientKey) as any;
      if (old) return this.read(old.thread_id, ownerId);
      const threadId = `thread_${randomUUID()}`;
      this.store.db.prepare('INSERT INTO agent_threads(id,owner_id,scope_id) VALUES(?,?,?)').run(threadId, ownerId, scopeId);
      this.store.db.prepare('INSERT INTO agent_conversations(thread_id,owner_id,scope_id,client_key,seed_json) VALUES(?,?,?,?,?)').run(threadId, ownerId, scopeId, clientKey, stableJson(seed));
      return this.read(threadId, ownerId);
    });
  }
  read(threadId: string, ownerId: string): Conversation {
    return this.store.atomic(() => {
      const row = this.store.db.prepare('SELECT * FROM agent_conversations WHERE thread_id=? AND owner_id=?').get(threadId, ownerId) as any;
      if (!row) throw new AgentError('CONVERSATION_NOT_FOUND', '对话不存在或不属于当前作者', 404);
      const turns = (this.store.db.prepare('SELECT t.*,r.status FROM agent_turns t JOIN agent_runs r ON r.id=t.run_id WHERE t.thread_id=? ORDER BY t.ordinal').all(threadId) as any[]).map(item => ({ id: item.id, runId: item.run_id, ordinal: item.ordinal, input: JSON.parse(item.input_json), response: item.response_json !== null ? JSON.parse(item.response_json) : null, status: item.status }));
      return { id: threadId, scopeId: row.scope_id, version: row.version, seed: JSON.parse(row.seed_json), turns, restartedTo: this.restartedTo(threadId) };
    });
  }
  /** Explicitly abandon this dialogue, not retry its unknown physical request.
   * Keep all messages, requests and late evidence attached to the old thread. */
  restart(input: ConversationRestartCommand): { conversation: Conversation } {
    if (!input.threadId || !input.ownerId || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || typeof input.clientKey !== 'string' || !input.clientKey.trim() || input.clientKey.length > 200)
      throw new AgentError('INVALID_CONVERSATION_RESTART', '清空重来缺少有效请求标识、对话版本或新对话标识', 400);
    const payloadHash = hashValue({ action: 'RESTART_CONVERSATION', ...input });
    return this.store.atomic(() => {
      const previous = this.store.db.prepare('SELECT * FROM agent_conversation_restarts WHERE owner_id=? AND request_id=?').get(input.ownerId, input.requestId) as any;
      if (previous) {
        assertSamePayload(previous.payload_hash, payloadHash);
        return { conversation: this.read(previous.next_thread_id, input.ownerId) };
      }
      const old = this.assertActive(input.threadId, input.ownerId);
      if (old.version !== input.expectedVersion) throw new AgentError('CONVERSATION_VERSION_CONFLICT', '对话已更新，请读取当前消息后再清空重来', 409);
      if (this.store.db.prepare('SELECT 1 FROM agent_conversations WHERE owner_id=? AND scope_id=? AND client_key=?').get(input.ownerId, old.scopeId, input.clientKey))
        throw new AgentError('CONVERSATION_RESTART_KEY_CONFLICT', '新对话标识已使用，请重新发起清空重来', 409);
      const next = this.open(input.ownerId, old.scopeId, input.clientKey);
      this.store.db.prepare('INSERT INTO agent_conversation_restarts(owner_id,request_id,payload_hash,thread_id,next_thread_id) VALUES(?,?,?,?,?)')
        .run(input.ownerId, input.requestId, payloadHash, old.id, next.id);
      const changed = this.store.db.prepare('UPDATE agent_conversations SET version=version+1 WHERE thread_id=? AND owner_id=? AND version=?').run(old.id, input.ownerId, input.expectedVersion);
      if (changed.changes !== 1) throw new AgentError('CONVERSATION_VERSION_CONFLICT', '对话已更新，请读取当前消息后再清空重来', 409);
      const runs = this.store.db.prepare("SELECT id,version FROM agent_runs WHERE thread_id=? AND owner_id=? AND status NOT IN ('SUCCEEDED','FAILED','PARTIAL','CANCELED')").all(old.id, input.ownerId) as Array<{ id: string; version: number }>;
      for (const run of runs) this.store.control(run.id, input.ownerId, run.version, 'cancel', `conversation-restart:${payloadHash}:${run.id}`);
      return { conversation: next };
    });
  }
  /** Identity comes from the client's original command, not mutable host-resolved
   * Skill content, model routing or defaults. Return the original turn before
   * consulting those dependencies again. */
  received(input: ConversationCommandIdentity) {
    if (!input.threadId || !input.ownerId || typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new AgentError('INVALID_CONVERSATION_COMMAND', '消息缺少有效请求标识或对话版本', 400);
    const hash = hashValue({ threadId: input.threadId, ownerId: input.ownerId, requestId: input.requestId, expectedVersion: input.expectedVersion, requestEnvelope: input.requestEnvelope });
    const previous = this.store.db.prepare('SELECT * FROM agent_conversation_commands WHERE owner_id=? AND request_id=?').get(input.ownerId, input.requestId) as any;
    if (!previous) return null;
    assertSamePayload(previous.payload_hash, hash);
    return { conversation: this.read(previous.thread_id, input.ownerId), turnId: previous.turn_id as string };
  }
  accept(input: ConversationCommandIdentity & { payload: unknown; capabilityId: string; maxInvocations: number; runInput?: Record<string, unknown> }) {
    return this.store.atomic(() => {
      const previous = this.received(input);
      if (previous) return previous;
      const conversation = this.assertActive(input.threadId, input.ownerId);
      if (input.expectedVersion !== conversation.version) throw new AgentError('CONVERSATION_VERSION_CONFLICT', '对话已更新，你的输入仍保留；请读取最新回复后发送');
      const activeGoal = this.store.db.prepare(`SELECT id,status FROM agent_runs WHERE thread_id=? AND owner_id=? AND kind='GOAL'
        AND status IN ('QUEUED','RUNNING','WAITING_STEP','WAITING_EXTERNAL','RECONCILIATION_REQUIRED') LIMIT 1`).get(conversation.id, input.ownerId) as {status:string}|undefined;
      if (activeGoal?.status === 'RECONCILIATION_REQUIRED') throw new AgentError('CONVERSATION_GOAL_ACTIVE', '委托结果待核对，输入已保留。请先在委托中核对已收到的返回，再暂停或继续。', 409);
      if (activeGoal) throw new AgentError('CONVERSATION_GOAL_ACTIVE', '委托正在运行，输入已保留。请先暂停，再修改目标并明确继续；如需回答作者问题，请使用委托中的回答入口。', 409);
      // Canceling a Run or changing the request key does not prove that an
      // already sent physical request had no effect. Even received evidence on
      // a RECONCILIATION_REQUIRED Run needs the explicit reconciliation command.
      // Only an explicit restart retires a dialogue without claiming that its
      // unknown request failed; ordinary cancel/open never removes this barrier.
      const unresolved = this.store.db.prepare(`SELECT r.id FROM agent_turns t JOIN agent_runs r ON r.id=t.run_id JOIN agent_conversations c ON c.thread_id=t.thread_id
        WHERE c.owner_id=? AND c.scope_id=? AND NOT EXISTS (SELECT 1 FROM agent_conversation_restarts x WHERE x.thread_id=c.thread_id) AND (r.status='RECONCILIATION_REQUIRED' OR EXISTS (
          SELECT 1 FROM agent_invocations i WHERE i.run_id=r.id AND i.status IN ('SENT','UNKNOWN'))) LIMIT 1`).get(input.ownerId, conversation.scopeId);
      if (unresolved) throw new AgentError('CONVERSATION_RESULT_UNRESOLVED', '此前模型请求的结果尚未确认，请先等待返回或核对原请求；不能新建消息来重新发送', 409);
      const hash = hashValue({ threadId: input.threadId, ownerId: input.ownerId, requestId: input.requestId, expectedVersion: input.expectedVersion, requestEnvelope: input.requestEnvelope });
      const turnId = `turn_${randomUUID()}`;
      if (input.runInput && (!input.runInput || typeof input.runInput !== 'object' || Array.isArray(input.runInput) || Object.hasOwn(input.runInput, 'request'))) throw new AgentError('INVALID_CONVERSATION_COMMAND', '内部对话执行设置无效', 400);
      const run = this.store.accept({ ownerId: input.ownerId, scopeId: conversation.scopeId, threadId: conversation.id, requestId: `conversation:${input.requestId}`, kind: 'CHAT', input: { ...input.runInput, request: { capabilityId: input.capabilityId, capabilityVersion: '1', callId: turnId, input: { threadId: conversation.id, turnId } } }, policyRevision: 'local-author.v1', maxInvocations: input.maxInvocations });
      this.store.db.prepare('INSERT INTO agent_turns(id,thread_id,run_id,ordinal,input_json) VALUES(?,?,?,?,?)').run(turnId, conversation.id, run.runId, conversation.turns.length + 1, stableJson(input.payload));
      const changed = this.store.db.prepare('UPDATE agent_conversations SET version=version+1 WHERE thread_id=? AND owner_id=? AND version=?').run(conversation.id, input.ownerId, input.expectedVersion);
      if (changed.changes !== 1) throw new AgentError('CONVERSATION_VERSION_CONFLICT', '对话已更新，你的输入仍保留；请读取最新回复后发送');
      this.store.db.prepare('INSERT INTO agent_conversation_commands(owner_id,request_id,payload_hash,thread_id,turn_id) VALUES(?,?,?,?,?)').run(input.ownerId, input.requestId, hash, conversation.id, turnId);
      return { conversation: this.read(conversation.id, input.ownerId), turnId };
    });
  }
  turn(threadId: string, turnId: string, ownerId: string) {
    const conversation = this.read(threadId, ownerId), turn = conversation.turns.find(item => item.id === turnId);
    if (!turn) throw new AgentError('TURN_NOT_FOUND', '消息回合不存在', 404);
    return { conversation, turn };
  }
  captureHistory(threadId: string, turnId: string, ownerId: string, data: unknown): ResourceRef {
    return this.store.atomic(() => {
      this.turn(threadId, turnId, ownerId);
      let row = this.store.db.prepare('SELECT * FROM agent_conversation_sources WHERE turn_id=?').get(turnId) as any;
      if (row) assertSamePayload(row.content_hash, hashValue(data));
      else { row = { id: `history_${randomUUID()}`, content_hash: hashValue(data) }; this.store.db.prepare('INSERT INTO agent_conversation_sources(id,thread_id,turn_id,content_hash,data_json) VALUES(?,?,?,?,?)').run(row.id, threadId, turnId, row.content_hash, stableJson(data)); }
      return { uri: `resource://conversation/${row.id}`, version: '1', contentHash: row.content_hash, branch: 'author' };
    });
  }
  sourceAllowed(ref: ResourceRef, ownerId: string, scopeId: string, checkContexts: (refs: Array<{ id: string; digest: string }>) => boolean) {
    let url: URL;
    try { url = new URL(ref.uri); } catch { return false; }
    if (url.protocol !== 'resource:' || url.hostname !== 'conversation' || url.username || url.password || url.port || url.search || url.hash || ref.version !== '1' || ref.branch !== 'author') return false;
    const row = this.store.db.prepare('SELECT s.content_hash,s.data_json FROM agent_conversation_sources s JOIN agent_conversations c ON c.thread_id=s.thread_id WHERE s.id=? AND c.owner_id=? AND c.scope_id=?').get(url.pathname.slice(1), ownerId, scopeId) as any;
    return Boolean(row && row.content_hash === ref.contentHash && hashValue(JSON.parse(row.data_json)) === ref.contentHash && checkContexts(JSON.parse(row.data_json).contextRefs || []));
  }
  writeResponse(threadId: string, turnId: string, ownerId: string, response: unknown) {
    return this.store.atomic(() => {
      this.turn(threadId, turnId, ownerId);
      const row = this.store.db.prepare('SELECT response_json FROM agent_turns WHERE id=? AND thread_id=?').get(turnId, threadId) as { response_json: string | null };
      if (row.response_json !== null) { assertSamePayload(hashValue(JSON.parse(row.response_json)), hashValue(response)); return; }
      this.assertNotRestarted(threadId);
      const changed = this.store.db.prepare('UPDATE agent_turns SET response_json=? WHERE id=? AND thread_id=? AND response_json IS NULL').run(stableJson(response), turnId, threadId);
      if (changed.changes !== 1) throw new AgentError('CONVERSATION_RESPONSE_CONFLICT', '这条消息已有回复，不能覆盖', 409);
      this.store.db.prepare('UPDATE agent_conversations SET version=version+1 WHERE thread_id=? AND owner_id=?').run(threadId, ownerId);
    });
  }
}
