import crypto from "crypto";

import { db } from "./db";

export type PersistedVideoGenerationTaskStatus =
  | "submitting"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export interface PersistedVideoGenerationTask {
  id: string;
  idempotencyKey: string;
  provider: "minimax_h3" | "kie_grok" | "comfyui_h3";
  channelId: string;
  modelConfigId: string;
  projectId?: string;
  status: PersistedVideoGenerationTaskStatus;
  providerTaskId?: string;
  videoUrl?: string;
  embeddedAudio: boolean;
  requestHash: string;
  request: Record<string, unknown>;
  audit?: Record<string, unknown>;
  providerResponse?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface VideoGenerationTaskRepository {
  getById(id: string): PersistedVideoGenerationTask | undefined;
  findByIdempotencyKey(idempotencyKey: string): PersistedVideoGenerationTask | undefined;
  create(input: Omit<PersistedVideoGenerationTask, "id" | "createdAt" | "updatedAt">): PersistedVideoGenerationTask;
  update(id: string, patch: Partial<PersistedVideoGenerationTask>): PersistedVideoGenerationTask;
}

export const publicVideoGenerationTask = (task: PersistedVideoGenerationTask, duplicate = false) => ({
  id: task.id,
  idempotencyKey: task.idempotencyKey,
  provider: task.provider,
  providerTaskId: task.providerTaskId,
  status: task.status,
  videoUrl: task.videoUrl,
  embeddedAudio: task.embeddedAudio,
  requestHash: task.requestHash,
  audit: task.audit,
  error: task.error,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  duplicate,
});

db.exec(`
  CREATE TABLE IF NOT EXISTS video_generation_tasks (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    model_config_id TEXT NOT NULL,
    project_id TEXT,
    status TEXT NOT NULL,
    provider_task_id TEXT,
    updated_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    data JSON NOT NULL
  );
  CREATE INDEX IF NOT EXISTS video_generation_tasks_provider_task_idx
    ON video_generation_tasks(provider, provider_task_id);
  CREATE INDEX IF NOT EXISTS video_generation_tasks_updated_at_idx
    ON video_generation_tasks(updated_at DESC);
`);

const rowToTask = (row: any): PersistedVideoGenerationTask | undefined => {
  if (!row) return undefined;
  const data = JSON.parse(row.data || "{}") as Partial<PersistedVideoGenerationTask>;
  return {
    ...data,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    provider: row.provider,
    channelId: row.channel_id,
    modelConfigId: row.model_config_id,
    projectId: row.project_id || undefined,
    status: row.status,
    providerTaskId: row.provider_task_id || data.providerTaskId,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  } as PersistedVideoGenerationTask;
};

const writeTask = (task: PersistedVideoGenerationTask) => {
  db.prepare(`
    INSERT INTO video_generation_tasks (
      id, idempotency_key, provider, channel_id, model_config_id, project_id,
      status, provider_task_id, updated_at, created_at, data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      provider_task_id=excluded.provider_task_id,
      updated_at=excluded.updated_at,
      data=excluded.data
  `).run(
    task.id,
    task.idempotencyKey,
    task.provider,
    task.channelId,
    task.modelConfigId,
    task.projectId || null,
    task.status,
    task.providerTaskId || null,
    task.updatedAt,
    task.createdAt,
    JSON.stringify(task),
  );
  return task;
};

export const videoGenerationTaskRepository: VideoGenerationTaskRepository = {
  getById: (id) => rowToTask(db.prepare("SELECT * FROM video_generation_tasks WHERE id = ?").get(id)),
  findByIdempotencyKey: (idempotencyKey) => rowToTask(
    db.prepare("SELECT * FROM video_generation_tasks WHERE idempotency_key = ?").get(idempotencyKey),
  ),
  create: (input) => {
    const now = Date.now();
    const task: PersistedVideoGenerationTask = {
      ...input,
      id: `video-task-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    return writeTask(task);
  },
  update: (id, patch) => {
    const current = videoGenerationTaskRepository.getById(id);
    if (!current) throw new Error("Video generation task not found.");
    return writeTask({ ...current, ...patch, id: current.id, idempotencyKey: current.idempotencyKey, updatedAt: Date.now() });
  },
};
