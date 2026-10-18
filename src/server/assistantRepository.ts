import type {
  AssistantAuthorization,
  AssistantChangeSet,
  AssistantContextSnapshot,
  AssistantConversationCheckpoint,
  AssistantMessage,
  AssistantPlan,
  AssistantProjectRef,
  AssistantRun,
  AssistantThread,
  ProductionPreparationBatchRun,
} from "../../packages/domain/src/assistant";
import { db } from "./db";

const parse = <T,>(row?: { data?: string } | null): T | null => row?.data ? JSON.parse(row.data) as T : null;

const scopeOf = (ref?: AssistantProjectRef) => ({
  namespace: ref?.namespace || "global",
  projectId: ref?.projectId || "",
});

const scopeMatches = (left?: AssistantProjectRef, right?: AssistantProjectRef) =>
  scopeOf(left).namespace === scopeOf(right).namespace && scopeOf(left).projectId === scopeOf(right).projectId;

export class AssistantRepositoryError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AssistantRepositoryError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const ensureAssistantSchema = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_threads (
      id TEXT PRIMARY KEY,
      project_namespace TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data JSON NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_threads_scope
      ON assistant_threads(project_namespace, project_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS assistant_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_namespace TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread
      ON assistant_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS assistant_checkpoints (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_checkpoints_thread
      ON assistant_checkpoints(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS assistant_context_snapshots (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assistant_plans (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_namespace TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assistant_runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      project_namespace TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES assistant_threads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_runs_scope
      ON assistant_runs(project_namespace, project_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS assistant_authorizations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(run_id) REFERENCES assistant_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assistant_change_sets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_namespace TEXT NOT NULL,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data JSON NOT NULL,
      FOREIGN KEY(run_id) REFERENCES assistant_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS production_preparation_batch_runs (
      id TEXT PRIMARY KEY,
      assistant_run_id TEXT,
      project_id TEXT NOT NULL,
      episode_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      data JSON NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_production_preparation_batch_scope
      ON production_preparation_batch_runs(project_id, episode_id, status, updated_at);
  `);
};

const requireThread = (threadId: string) => {
  const thread = parse<AssistantThread>(db.prepare("SELECT data FROM assistant_threads WHERE id = ?").get(threadId) as any);
  if (!thread) throw new AssistantRepositoryError(404, "assistant_thread_not_found", "Assistant thread not found.");
  return thread;
};

const assertThreadScope = (thread: AssistantThread, ref?: AssistantProjectRef) => {
  if (!scopeMatches(thread.projectRef, ref)) {
    throw new AssistantRepositoryError(403, "assistant_thread_scope_mismatch", "Assistant thread belongs to another project.");
  }
};

export const assistantRepository = {
  listThreads(projectRef?: AssistantProjectRef, includeArchived = false): AssistantThread[] {
    const scope = scopeOf(projectRef);
    const rows = db.prepare(`
      SELECT data FROM assistant_threads
      WHERE project_namespace = ? AND project_id = ? ${includeArchived ? "AND status != 'deleted'" : "AND status = 'active'"}
      ORDER BY updated_at DESC
    `).all(scope.namespace, scope.projectId) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data));
  },

  getThread(id: string, expectedProjectRef?: AssistantProjectRef): AssistantThread | null {
    const thread = parse<AssistantThread>(db.prepare("SELECT data FROM assistant_threads WHERE id = ?").get(id) as any);
    if (thread && expectedProjectRef !== undefined) assertThreadScope(thread, expectedProjectRef);
    return thread;
  },

  saveThread(thread: AssistantThread): AssistantThread {
    const scope = scopeOf(thread.projectRef);
    db.prepare(`
      INSERT INTO assistant_threads (id, project_namespace, project_id, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_namespace=excluded.project_namespace,
        project_id=excluded.project_id,
        status=excluded.status,
        updated_at=excluded.updated_at,
        data=excluded.data
    `).run(thread.id, scope.namespace, scope.projectId, thread.status, thread.updatedAt, JSON.stringify(thread));
    return thread;
  },

  listMessages(threadId: string, limit = 100): AssistantMessage[] {
    requireThread(threadId);
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = db.prepare(`
      SELECT data FROM (
        SELECT data, created_at FROM assistant_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?
      ) ORDER BY created_at ASC
    `).all(threadId, safeLimit) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data));
  },

  saveMessage(message: AssistantMessage): AssistantMessage {
    const thread = requireThread(message.threadId);
    assertThreadScope(thread, message.projectRef);
    const scope = scopeOf(message.projectRef);
    db.prepare(`
      INSERT INTO assistant_messages (id, thread_id, project_namespace, project_id, created_at, data)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data
    `).run(message.id, message.threadId, scope.namespace, scope.projectId, message.createdAt, JSON.stringify(message));
    return message;
  },

  getLatestCheckpoint(threadId: string): AssistantConversationCheckpoint | null {
    requireThread(threadId);
    return parse<AssistantConversationCheckpoint>(db.prepare("SELECT data FROM assistant_checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1").get(threadId) as any);
  },

  listCheckpoints(threadId: string, limit = 20): AssistantConversationCheckpoint[] {
    requireThread(threadId);
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = db.prepare("SELECT data FROM assistant_checkpoints WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(threadId, safeLimit) as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data));
  },

  saveCheckpoint(checkpoint: AssistantConversationCheckpoint): AssistantConversationCheckpoint {
    const thread = requireThread(checkpoint.threadId);
    assertThreadScope(thread, checkpoint.projectRef);
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO assistant_checkpoints (id, thread_id, created_at, data)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data
      `).run(checkpoint.id, checkpoint.threadId, checkpoint.createdAt, JSON.stringify(checkpoint));
      this.saveThread({ ...thread, latestCheckpointId: checkpoint.id, updatedAt: checkpoint.createdAt });
    });
    transaction();
    return checkpoint;
  },

  saveContextSnapshot(snapshot: AssistantContextSnapshot): AssistantContextSnapshot {
    requireThread(snapshot.threadId);
    db.prepare(`
      INSERT INTO assistant_context_snapshots (id, thread_id, created_at, data)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data
    `).run(snapshot.id, snapshot.threadId, snapshot.createdAt, JSON.stringify(snapshot));
    return snapshot;
  },

  getContextSnapshot(id: string): AssistantContextSnapshot | null {
    return parse<AssistantContextSnapshot>(db.prepare("SELECT data FROM assistant_context_snapshots WHERE id = ?").get(id) as any);
  },

  savePlan(plan: AssistantPlan): AssistantPlan {
    const thread = requireThread(plan.threadId);
    assertThreadScope(thread, plan.projectRef);
    const scope = scopeOf(plan.projectRef);
    db.prepare(`
      INSERT INTO assistant_plans (id, thread_id, project_namespace, project_id, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, data=excluded.data
    `).run(plan.id, plan.threadId, scope.namespace, scope.projectId, plan.status, plan.updatedAt, JSON.stringify(plan));
    return plan;
  },

  getPlan(id: string): AssistantPlan | null {
    return parse<AssistantPlan>(db.prepare("SELECT data FROM assistant_plans WHERE id = ?").get(id) as any);
  },

  saveRun(run: AssistantRun): AssistantRun {
    const thread = requireThread(run.threadId);
    assertThreadScope(thread, run.projectRef);
    const scope = scopeOf(run.projectRef);
    db.prepare(`
      INSERT INTO assistant_runs (id, thread_id, project_namespace, project_id, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, data=excluded.data
    `).run(run.id, run.threadId, scope.namespace, scope.projectId, run.status, run.updatedAt, JSON.stringify(run));
    return run;
  },

  getRun(id: string): AssistantRun | null {
    return parse<AssistantRun>(db.prepare("SELECT data FROM assistant_runs WHERE id = ?").get(id) as any);
  },

  listRuns(projectRef?: AssistantProjectRef, statuses?: string[]): AssistantRun[] {
    const scope = scopeOf(projectRef);
    const rows = db.prepare("SELECT data FROM assistant_runs WHERE project_namespace = ? AND project_id = ? ORDER BY updated_at DESC")
      .all(scope.namespace, scope.projectId) as Array<{ data: string }>;
    const runs = rows.map((row) => JSON.parse(row.data) as AssistantRun);
    return statuses?.length ? runs.filter((run) => statuses.includes(run.status)) : runs;
  },

  saveAuthorization(authorization: AssistantAuthorization): AssistantAuthorization {
    if (!this.getRun(authorization.runId)) throw new AssistantRepositoryError(404, "assistant_run_not_found", "Assistant run not found.");
    db.prepare(`
      INSERT INTO assistant_authorizations (id, run_id, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, data=excluded.data
    `).run(authorization.id, authorization.runId, authorization.status, Date.now(), JSON.stringify(authorization));
    return authorization;
  },

  getAuthorization(id: string): AssistantAuthorization | null {
    return parse<AssistantAuthorization>(db.prepare("SELECT data FROM assistant_authorizations WHERE id = ?").get(id) as any);
  },

  saveChangeSet(changeSet: AssistantChangeSet): AssistantChangeSet {
    const scope = scopeOf(changeSet.projectRef);
    db.prepare(`
      INSERT INTO assistant_change_sets (id, run_id, project_namespace, project_id, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, data=excluded.data
    `).run(changeSet.id, changeSet.runId, scope.namespace, scope.projectId, changeSet.status, Date.now(), JSON.stringify(changeSet));
    return changeSet;
  },

  getChangeSet(id: string): AssistantChangeSet | null {
    return parse<AssistantChangeSet>(db.prepare("SELECT data FROM assistant_change_sets WHERE id = ?").get(id) as any);
  },

  savePreparationBatch(batch: ProductionPreparationBatchRun): ProductionPreparationBatchRun {
    db.prepare(`
      INSERT INTO production_preparation_batch_runs (id, assistant_run_id, project_id, episode_id, status, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        assistant_run_id=excluded.assistant_run_id,
        status=excluded.status,
        updated_at=excluded.updated_at,
        data=excluded.data
    `).run(batch.id, batch.assistantRunId || null, batch.projectId, batch.workUnit.id, batch.status, batch.updatedAt, JSON.stringify(batch));
    return batch;
  },

  getPreparationBatch(id: string): ProductionPreparationBatchRun | null {
    return parse<ProductionPreparationBatchRun>(db.prepare("SELECT data FROM production_preparation_batch_runs WHERE id = ?").get(id) as any);
  },

  listPreparationBatches(projectId: string, episodeId?: string): ProductionPreparationBatchRun[] {
    const rows = episodeId
      ? db.prepare("SELECT data FROM production_preparation_batch_runs WHERE project_id = ? AND episode_id = ? ORDER BY updated_at DESC").all(projectId, episodeId)
      : db.prepare("SELECT data FROM production_preparation_batch_runs WHERE project_id = ? ORDER BY updated_at DESC").all(projectId);
    return (rows as Array<{ data: string }>).map((row) => JSON.parse(row.data));
  },

  listRecoverableBatches(): ProductionPreparationBatchRun[] {
    const rows = db.prepare("SELECT data FROM production_preparation_batch_runs WHERE status IN ('queued', 'running', 'qa', 'repairing') ORDER BY updated_at ASC").all() as Array<{ data: string }>;
    return rows.map((row) => JSON.parse(row.data));
  },
};

export type AssistantRepository = typeof assistantRepository;
