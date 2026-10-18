import assert from "node:assert/strict";

import type { PersistedVideoGenerationTask, VideoGenerationTaskRepository } from "../src/server/videoGenerationTaskRepository";

process.env.OMNI_DB_PATH = `/tmp/omni-minimax-h3-video-task-${process.pid}.db`;

type Handler = (req: any, res: any) => Promise<unknown> | unknown;

const routes = new Map<string, Handler>();
const app = {
  post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
  get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
};

const tasks = new Map<string, PersistedVideoGenerationTask>();
const repository: VideoGenerationTaskRepository = {
  getById: (id) => tasks.get(id),
  findByIdempotencyKey: (key) => [...tasks.values()].find((task) => task.idempotencyKey === key),
  create: (input) => {
    const now = Date.now();
    const task = { ...input, id: `local-${tasks.size + 1}`, createdAt: now, updatedAt: now };
    tasks.set(task.id, task);
    return task;
  },
  update: (id, patch) => {
    const current = tasks.get(id);
    assert.ok(current, `missing task ${id}`);
    const task = { ...current, ...patch, id: current.id, idempotencyKey: current.idempotencyKey, updatedAt: Date.now() };
    tasks.set(id, task);
    return task;
  },
};

let submitCount = 0;
let queryCount = 0;
const providerFetch = async (url: string | URL | Request, init?: RequestInit) => {
  if (init?.method === "POST") {
    submitCount += 1;
    return new Response(JSON.stringify({ task_id: "provider-task-1" }), { status: 200 });
  }
  queryCount += 1;
  assert.match(String(url), /\/v2\/query\/video_generation\/provider-task-1$/);
  return new Response(JSON.stringify({
    task: { id: "provider-task-1", status: "succeeded", content: { url: "https://cdn.example.com/result.mp4" } },
  }), { status: 200 });
};

const { registerMiniMaxH3VideoRoute } = await import("../src/server/providers/minimaxH3Video");
registerMiniMaxH3VideoRoute(app as any, {
  repository,
  providerFetch: providerFetch as typeof fetch,
  resolveConfiguration: () => ({ endpoint: "https://api.minimax.io/v2/video_generation", apiKey: "test-key" }),
});

const invoke = async (method: "POST" | "GET", path: string, input: { body?: unknown; params?: Record<string, string> } = {}) => {
  const routePath = method === "GET" ? "/api/proxy/minimax-h3-video/tasks/:taskId" : path;
  const handler = routes.get(`${method} ${routePath}`);
  assert.ok(handler, `missing route ${method} ${routePath}`);
  let statusCode = 200;
  let payload: any;
  const res = {
    status: (value: number) => {
      statusCode = value;
      return res;
    },
    json: (value: unknown) => {
      payload = value;
      return res;
    },
  };
  await handler({ body: input.body, params: input.params || {} }, res);
  return { statusCode, payload };
};

const request = {
  model: "MiniMax-H3",
  resolution: "768P",
  duration: 8,
  ratio: "16:9",
  content: [
    { type: "text", text: "[Shot 1] At 00:00.000, 阿橘抬头。" },
    { type: "image_url", image_url: { url: "https://cdn.example.com/aju.png" }, role: "reference_image" },
  ],
};
const { validateMiniMaxH3VideoRequest } = await import("../src/server/providers/minimaxH3Video");
assert.throws(() => validateMiniMaxH3VideoRequest({
  ...request,
  content: [
    request.content[0],
    { type: "image_url", image_url: { url: "https://cdn.example.com/aju.png" } },
  ],
}), /素材类型与用途不匹配/);
assert.throws(() => validateMiniMaxH3VideoRequest({
  ...request,
  content: [
    request.content[0],
    { type: "audio_url", audio_url: { url: "https://cdn.example.com/voice.mp3" }, role: "reference_image" },
  ],
}), /素材类型与用途不匹配/);
const body = {
  idempotencyKey: "project-1:shot-1:model-1:attempt-1",
  channelId: "channel-1",
  modelConfigId: "model-1",
  request,
  audit: { projectId: "project-1", shotId: "shot-1" },
};

const first = await invoke("POST", "/api/proxy/minimax-h3-video/tasks", { body });
assert.equal(first.statusCode, 202);
assert.equal(first.payload.task.status, "queued");
assert.equal(first.payload.task.duplicate, false);
assert.equal(submitCount, 1);

const duplicate = await invoke("POST", "/api/proxy/minimax-h3-video/tasks", { body });
assert.equal(duplicate.statusCode, 200);
assert.equal(duplicate.payload.task.id, first.payload.task.id);
assert.equal(duplicate.payload.task.duplicate, true);
assert.equal(submitCount, 1, "same click key must never submit a second provider task");

const completed = await invoke("GET", `/api/proxy/minimax-h3-video/tasks/${first.payload.task.id}`, {
  params: { taskId: first.payload.task.id },
});
assert.equal(completed.statusCode, 200);
assert.equal(completed.payload.task.status, "succeeded");
assert.equal(completed.payload.task.videoUrl, "https://cdn.example.com/result.mp4");
assert.equal(queryCount, 1);
assert.equal(submitCount, 1, "polling the original task must not resubmit it");

const completedAgain = await invoke("GET", `/api/proxy/minimax-h3-video/tasks/${first.payload.task.id}`, {
  params: { taskId: first.payload.task.id },
});
assert.equal(completedAgain.payload.task.status, "succeeded");
assert.equal(queryCount, 1, "completed tasks should be served from persistence");

const duplicateCompleted = await invoke("POST", "/api/proxy/minimax-h3-video/tasks", { body });
assert.equal(duplicateCompleted.statusCode, 200);
assert.equal(duplicateCompleted.payload.task.id, first.payload.task.id);
assert.equal(submitCount, 1, "a succeeded attempt must never be submitted again");

repository.create({
  idempotencyKey: "project-1:shot-failed:model-1:attempt-1",
  provider: "minimax_h3",
  channelId: "channel-1",
  modelConfigId: "model-1",
  projectId: "project-1",
  status: "failed",
  embeddedAudio: true,
  requestHash: "failed-request",
  request,
  error: "provider rejected the task",
});
const failedDuplicate = await invoke("POST", "/api/proxy/minimax-h3-video/tasks", {
  body: { ...body, idempotencyKey: "project-1:shot-failed:model-1:attempt-1" },
});
assert.equal(failedDuplicate.statusCode, 409);
assert.equal(failedDuplicate.payload.task.status, "failed");
assert.equal(submitCount, 1, "a failed key must not be silently resubmitted");

const explicitNewCandidate = await invoke("POST", "/api/proxy/minimax-h3-video/tasks", {
  body: { ...body, idempotencyKey: "project-1:shot-failed:model-1:attempt-2" },
});
assert.equal(explicitNewCandidate.statusCode, 202);
assert.equal(explicitNewCandidate.payload.task.status, "queued");
assert.equal(submitCount, 2, "only a new explicit candidate key may create another provider task");

console.log("MiniMax H3 video task self-check passed.");
