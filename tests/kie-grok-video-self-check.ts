import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_CONFIG_SCHEMA_VERSION,
  KIE_DEFAULT_BASE_URL,
  KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
  KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  KIE_GROK_VIDEO_DEFAULT_SETTINGS,
  defaultChannels,
  defaultModels,
  normalizeAIConfig,
  type AIModel,
} from "../src/config/aiConfigDefaults";
import {
  KIE_BASE64_UPLOAD_ENDPOINT,
  buildKieCreateTaskRequest,
  buildKieTaskStatusEndpoint,
  kieResultVideoUrl,
  normalizeKieCreateTaskEndpoint,
  registerKieGrokVideoRoute,
  validateKieGrokVideoRequest,
} from "../src/server/providers/kieGrokVideo";
import { buildKieGrokVideoRequest, validateKieGrokVideoDuration } from "../src/services/providers/kieGrokVideo";
import { buildOperatorCapabilityManifest } from "../src/services/operator/capabilities";
import type { PersistedVideoGenerationTask, VideoGenerationTaskRepository } from "../src/server/videoGenerationTaskRepository";

const channel = defaultChannels.find((item) => item.type === "kie");
assert.ok(channel, "the Kie channel preset should exist");
assert.equal(channel.baseUrl, KIE_DEFAULT_BASE_URL);
assert.deepEqual(defaultModels, [], "channels may be preset but model instances must remain user-created");

const model: AIModel = {
  id: "manual-kie-grok-video",
  channelId: channel.id,
  alias: "Kie Grok Image to Video",
  modelId: KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  capabilities: ["video"],
  kieGrokVideo: { resolution: "720p" },
};
const normalized = normalizeAIConfig({
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  channels: defaultChannels,
  models: [model],
});
assert.equal(normalized.models[0]?.kieGrokVideo?.resolution, "720p");
assert.equal(normalizeAIConfig({ schemaVersion: AI_CONFIG_SCHEMA_VERSION, channels: defaultChannels, models: [] }).models.length, 0);
assert.equal(KIE_GROK_VIDEO_DEFAULT_SETTINGS.resolution, "480p");

assert.equal(normalizeKieCreateTaskEndpoint(), "https://api.kie.ai/api/v1/jobs/createTask");
assert.equal(normalizeKieCreateTaskEndpoint("https://api.kie.ai/api/v1"), "https://api.kie.ai/api/v1/jobs/createTask");
assert.equal(normalizeKieCreateTaskEndpoint("https://api.kie.ai/api/v1/jobs"), "https://api.kie.ai/api/v1/jobs/createTask");
assert.throws(() => normalizeKieCreateTaskEndpoint("http://api.kie.ai/api/v1"), /HTTPS/);
assert.throws(() => normalizeKieCreateTaskEndpoint("https://api.kie.ai/v2"), /api\/v1/);
assert.equal(
  buildKieTaskStatusEndpoint("https://api.kie.ai/api/v1/jobs/createTask", "task/unsafe"),
  "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task%2Funsafe",
);

assert.equal(validateKieGrokVideoDuration(1), 1);
assert.equal(validateKieGrokVideoDuration(15), 15);
assert.throws(() => validateKieGrokVideoDuration(0), /1-15/);
assert.throws(() => validateKieGrokVideoDuration(15.5), /整数/);

const proxyRequest = buildKieGrokVideoRequest(model, {
  prompt: "人物接过咖啡后转身走向办公室深处，摄影机轻微跟移",
  imageUrl: "data:image/png;base64,aGVsbG8=",
  durationSeconds: 6,
  aspectRatio: "16:9",
});
assert.deepEqual(proxyRequest, {
  model: KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  prompt: "人物接过咖啡后转身走向办公室深处，摄影机轻微跟移",
  imageUrl: "data:image/png;base64,aGVsbG8=",
  duration: 6,
  resolution: "720p",
  aspectRatio: "16:9",
});
assert.deepEqual(validateKieGrokVideoRequest(proxyRequest), proxyRequest);
assert.throws(() => validateKieGrokVideoRequest({ ...proxyRequest, duration: 16 }), /between 1 and 15/);
assert.throws(() => validateKieGrokVideoRequest({ ...proxyRequest, imageUrl: "http://localhost:3000/media/frame.png" }), /public HTTP/);
assert.throws(() => validateKieGrokVideoRequest({ ...proxyRequest, resolution: "1080p" }), /480p or 720p/);

const createTaskRequest = buildKieCreateTaskRequest(proxyRequest, "https://tempfile.example.com/frame.png", "task_grok_test");
assert.deepEqual(createTaskRequest, {
  model: KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  input: {
    image_urls: ["https://tempfile.example.com/frame.png"],
    prompt: proxyRequest.prompt,
    duration: 6,
    resolution: "720p",
    aspect_ratio: "16:9",
  },
});
const legacyCreateTaskRequest = buildKieCreateTaskRequest(
  { ...proxyRequest, model: KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID },
  "https://tempfile.example.com/frame.png",
  "task_grok_legacy_test",
);
assert.deepEqual(legacyCreateTaskRequest, {
  model: KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID,
  input: {
    task_id: "task_grok_legacy_test",
    image_urls: ["https://tempfile.example.com/frame.png"],
    prompt: proxyRequest.prompt,
    mode: "normal",
    duration: "6",
    resolution: "720p",
    aspect_ratio: "16:9",
  },
});
assert.equal(
  kieResultVideoUrl({ data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/result.mp4"] }) } }),
  "https://cdn.example.com/result.mp4",
);

type Handler = (req: any, res: any) => Promise<unknown> | unknown;
const routes = new Map<string, Handler>();
const providerCalls: Array<{ url: string; method: string; body?: any; authorization?: string }> = [];
const tasks = new Map<string, PersistedVideoGenerationTask>();
const repository: VideoGenerationTaskRepository = {
  getById: (id) => tasks.get(id),
  findByIdempotencyKey: (key) => [...tasks.values()].find((task) => task.idempotencyKey === key),
  create: (input) => {
    const now = Date.now();
    const task = { ...input, id: `kie-local-${tasks.size + 1}`, createdAt: now, updatedAt: now };
    tasks.set(task.id, task);
    return task;
  },
  update: (id, patch) => {
    const current = tasks.get(id);
    assert.ok(current);
    const task = { ...current, ...patch, id: current.id, idempotencyKey: current.idempotencyKey, updatedAt: Date.now() };
    tasks.set(id, task);
    return task;
  },
};
registerKieGrokVideoRoute({
  post: (path: string, routeHandler: Handler) => routes.set(`POST ${path}`, routeHandler),
  get: (path: string, routeHandler: Handler) => routes.set(`GET ${path}`, routeHandler),
} as any, {
  repository,
  resolveConfiguration: () => ({ endpoint: "https://api.kie.ai/api/v1/jobs/createTask", apiKey: "server-only-key" }),
  wait: async () => undefined,
  pollIntervalMs: 1,
  providerFetch: async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    providerCalls.push({
      url,
      method: String(init?.method || "GET"),
      body,
      authorization: (init?.headers as Record<string, string>)?.Authorization,
    });
    if (url === KIE_BASE64_UPLOAD_ENDPOINT) {
      return new Response(JSON.stringify({ code: 200, data: { downloadUrl: "https://tempfile.example.com/uploaded-frame.png" } }), { status: 200 });
    }
    if (String(init?.method) === "POST") {
      return new Response(JSON.stringify({ code: 200, msg: "success", data: { taskId: "kie-task-1" } }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: 200,
      data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/final-video.mp4"] }) },
    }), { status: 200 });
  },
});
const handler = routes.get("POST /api/proxy/kie-grok-video");
assert.ok(handler);

let responseStatus = 0;
let responsePayload: any;
await handler!({ body: { channelId: channel.id, modelConfigId: model.id, request: proxyRequest } }, {
  status(value: number) { responseStatus = value; return this; },
  json(value: unknown) { responsePayload = value; return value; },
});
assert.equal(responseStatus, 200);
assert.equal(responsePayload.videoUrl, "https://cdn.example.com/final-video.mp4");
assert.equal(providerCalls.length, 3, "data URL input should upload once, submit once, then poll once");
assert.equal(providerCalls.filter((call) => call.url.endsWith("/jobs/createTask")).length, 1, "the expensive task must never be resubmitted automatically");
assert.equal(providerCalls[0].url, KIE_BASE64_UPLOAD_ENDPOINT);
assert.match(providerCalls[0].body.fileName, /\.png$/);
assert.equal(providerCalls[1].body.model, KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID);
assert.equal(providerCalls[1].body.input.duration, 6);
assert.equal(providerCalls[1].body.input.resolution, "720p");
assert.equal("task_id" in providerCalls[1].body.input, false);
assert.equal("mode" in providerCalls[1].body.input, false);
assert.equal("callBackUrl" in providerCalls[1].body, false);
assert.equal(providerCalls[1].authorization, "Bearer server-only-key");
assert.equal(JSON.stringify(responsePayload).includes("server-only-key"), false);

const invokeTask = async (method: "POST" | "GET", body?: unknown, taskId?: string) => {
  const route = method === "POST"
    ? routes.get("POST /api/proxy/kie-grok-video/tasks")
    : routes.get("GET /api/proxy/kie-grok-video/tasks/:taskId");
  assert.ok(route);
  let statusCode = 200;
  let payload: any;
  const res = {
    status(value: number) { statusCode = value; return res; },
    json(value: unknown) { payload = value; return res; },
  };
  await route({ body, params: { taskId } }, res);
  return { statusCode, payload };
};
const taskBody = {
  idempotencyKey: "project-1:shot-1:kie:attempt-1",
  channelId: channel.id,
  modelConfigId: model.id,
  request: proxyRequest as unknown as Record<string, unknown>,
  audit: { projectId: "project-1", shotId: "shot-1" },
};
const callsBeforeTask = providerCalls.length;
const submittedTask = await invokeTask("POST", taskBody);
assert.equal(submittedTask.statusCode, 202);
assert.equal(submittedTask.payload.task.provider, "kie_grok");
assert.equal(submittedTask.payload.task.status, "queued");
assert.equal(providerCalls.length, callsBeforeTask + 2, "task submission uploads once and submits once without polling");
const duplicateTask = await invokeTask("POST", taskBody);
assert.equal(duplicateTask.statusCode, 200);
assert.equal(duplicateTask.payload.task.id, submittedTask.payload.task.id);
assert.equal(duplicateTask.payload.task.duplicate, true);
assert.equal(providerCalls.length, callsBeforeTask + 2, "duplicate clicks must not call the provider again");
const completedTask = await invokeTask("GET", undefined, submittedTask.payload.task.id);
assert.equal(completedTask.statusCode, 200);
assert.equal(completedTask.payload.task.status, "succeeded");
assert.equal(completedTask.payload.task.videoUrl, "https://cdn.example.com/final-video.mp4");
assert.equal(providerCalls.length, callsBeforeTask + 3, "refresh recovery polls the original task exactly once");
const completedTaskAgain = await invokeTask("GET", undefined, submittedTask.payload.task.id);
assert.equal(completedTaskAgain.payload.task.status, "succeeded");
assert.equal(providerCalls.length, callsBeforeTask + 3, "completed tasks are served from persistence");
repository.create({
  idempotencyKey: "project-1:shot-failed:kie:attempt-1",
  provider: "kie_grok",
  channelId: channel.id,
  modelConfigId: model.id,
  projectId: "project-1",
  status: "failed",
  embeddedAudio: false,
  requestHash: "failed-request",
  request: proxyRequest as unknown as Record<string, unknown>,
  error: "provider rejected the task",
});
const failedDuplicateTask = await invokeTask("POST", {
  ...taskBody,
  idempotencyKey: "project-1:shot-failed:kie:attempt-1",
});
assert.equal(failedDuplicateTask.statusCode, 409);
assert.equal(failedDuplicateTask.payload.task.status, "failed");
assert.equal(providerCalls.length, callsBeforeTask + 3, "failed tasks must not be silently resubmitted");
const explicitNewTask = await invokeTask("POST", {
  ...taskBody,
  idempotencyKey: "project-1:shot-failed:kie:attempt-2",
});
assert.equal(explicitNewTask.statusCode, 202);
assert.equal(explicitNewTask.payload.task.status, "queued");
assert.equal(providerCalls.length, callsBeforeTask + 5, "only an explicit new candidate key may create another provider task");

const capabilityManifest = buildOperatorCapabilityManifest();
const modelProxyRoutes = capabilityManifest.apiGroups.find((group) => group.id === "model-proxy")?.routes || [];
assert.ok(modelProxyRoutes.includes("POST /api/proxy/kie-grok-video/tasks"));
assert.ok(modelProxyRoutes.includes("GET /api/proxy/kie-grok-video/tasks/:taskId"));
const providerContracts = capabilityManifest.videoStoryboardSystem.videoGenerationModes.providerInputContracts.filter((item) => item.provider === "kie");
const previewContract = providerContracts.find((item) => item.modelId === KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID);
const legacyContract = providerContracts.find((item) => item.modelId === KIE_GROK_LEGACY_IMAGE_TO_VIDEO_MODEL_ID);
assert.ok(previewContract);
assert.ok(legacyContract);
assert.equal(previewContract.requestContract, "preview_1_5_numeric_duration_without_task_id_or_mode");
assert.deepEqual(previewContract.acceptedResolutions, ["480p", "720p"]);
assert.equal(previewContract.automaticSubmissionRetries, 0);
assert.equal("pollingTimeoutMinutes" in previewContract, false);
assert.equal(previewContract.resultDelivery, "provider_terminal_status_polling");

const settingsSource = readFileSync("src/pages/Settings.tsx", "utf8");
const aiSource = readFileSync("src/services/ai.ts", "utf8");
const routeSource = readFileSync("src/server/routes/providerProxyRoutes.ts", "utf8");
const providerSource = readFileSync("src/server/providers/kieGrokVideo.ts", "utf8");
assert.ok(settingsSource.includes('<option value="kie">Kie AI</option>'));
assert.ok(settingsSource.includes("KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID"));
assert.ok(settingsSource.includes("编辑模型"));
assert.ok(settingsSource.includes("openEditModelModal(model)"), "every model card should use the unified model editor");
assert.equal(settingsSource.includes("defaultDuration"), false, "duration belongs to the selected shot or storyboard unit, not model settings");
assert.equal(settingsSource.includes("Callback URL (Optional)"), false, "provider callbacks are server infrastructure, not a model-level user setting");
assert.ok(aiSource.includes("generateKieGrokVideo"));
assert.ok(aiSource.includes("submitKieGrokVideoTask"));
assert.ok(routeSource.includes("registerKieGrokVideoRoute(app)"));
assert.equal(providerSource.includes("REQUEST_TIMEOUT_MS"), false, "video tasks must wait for a provider terminal status");
assert.equal(providerSource.includes("KIE_GROK_VIDEO_TIMEOUT"), false, "elapsed time must not manufacture a video failure");

console.log("Kie Grok Video self-check passed.");
