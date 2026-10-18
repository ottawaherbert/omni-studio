import assert from "node:assert/strict";
import fs from "node:fs/promises";

import type { PersistedVideoGenerationTask, VideoGenerationTaskRepository } from "../src/server/videoGenerationTaskRepository";
import { COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS } from "../src/config/aiConfigDefaults";
import type { MiniMaxH3VideoRequest } from "../src/services/production/minimaxH3Adapter";

process.env.OMNI_DB_PATH = `/tmp/omni-comfyui-h3-video-task-${process.pid}.db`;

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

let uploadCount = 0;
let submitCount = 0;
let simulatePromptTimeout = false;
let historyCount = 0;
let downloadCount = 0;
let submittedGraph: Record<string, any> | undefined;
const providerFetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/upload/image") && init?.method === "POST") {
    uploadCount += 1;
    return new Response(JSON.stringify({ name: `reference-${uploadCount}.png`, subfolder: "omni_h3", type: "input" }), { status: 200 });
  }
  if (url.endsWith("/prompt") && init?.method === "POST") {
    submitCount += 1;
    if (simulatePromptTimeout) throw new Error("simulated ComfyUI submit timeout");
    const body = JSON.parse(String(init.body || "{}"));
    submittedGraph = body.prompt;
    return new Response(JSON.stringify({ prompt_id: "prompt-1", number: 1, node_errors: {} }), { status: 200 });
  }
  if (url.endsWith("/history/prompt-1")) {
    historyCount += 1;
    return new Response(JSON.stringify({
      "prompt-1": {
        status: { completed: true, status_str: "success" },
        outputs: { "15": { videos: [{ filename: "candidate.mp4", subfolder: "video/omni_h3", type: "output" }] } },
      },
    }), { status: 200 });
  }
  if (url.includes("/view?")) {
    downloadCount += 1;
    return new Response(Buffer.from("persisted-comfyui-video"), { status: 200, headers: { "Content-Type": "video/mp4" } });
  }
  throw new Error(`unexpected provider request: ${init?.method || "GET"} ${url}`);
};

const { buildComfyUIH3Prompt, registerComfyUIH3VideoRoute, validateComfyUIH3VideoRequest } = await import("../src/server/providers/comfyUIH3Video");
const mediaAssetsDir = `/tmp/omni-comfyui-h3-media-${process.pid}`;
registerComfyUIH3VideoRoute(app as any, {
  repository,
  providerFetch: providerFetch as typeof fetch,
  mediaAssetsDir,
  resolveConfiguration: () => ({
    baseUrl: "http://192.168.31.103:8118",
    workflowId: "workflow-local-h3",
    sourceWorkflowName: "video_minimax_h3_r2v.json",
    settings: COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  }),
});

const invoke = async (method: "POST" | "GET", routePath: string, input: { body?: unknown; params?: Record<string, string> } = {}) => {
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
  await handler({ body: input.body, params: input.params || {}, protocol: "http", get: () => "localhost:3000" }, res);
  return { statusCode, payload };
};

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const { prepareComfyUIH3Intent } = await import("../src/services/providers/comfyUIH3Video");
const localIntentInput = {
  schemaVersion: "video-generation-intent.v1",
  id: "intent-1",
  projectId: "project-1",
  episodeId: "episode-1",
  sceneId: "scene-1",
  videoGenerationUnitId: "unit-1",
  storyboardBoardId: "board-1",
  shotIds: ["shot-1"],
  sourceHash: "source-1",
  aspectRatio: "16:9",
  durationSeconds: 5,
  startState: "角色站在画面中央",
  endState: "角色抬头看向镜头",
  directorIntent: "稳定的角色表演与缓慢推进",
  timelineBeats: [],
  audioPolicy: { mode: "provider_native" },
  referenceBindings: [
    { id: "character", sourceType: "character_board", sourceAssetId: "character-1", semanticEntityId: "character-1", displayName: "阿橘", description: "橘猫面包师的身份和服装", mediaUrl: "https://cdn.example.com/character.png", purpose: "identity", preservation: "strong", required: true, priority: 100 },
    { id: "character-2", sourceType: "character_board", sourceAssetId: "character-2", semanticEntityId: "character-2", displayName: "老熊", description: "老熊的身份和湿外套", mediaUrl: "https://cdn.example.com/character.png", purpose: "identity", preservation: "required", required: true, priority: 95 },
  ],
} as any;
assert.throws(
  () => prepareComfyUIH3Intent({
    ...localIntentInput,
    referenceBindings: [
      ...localIntentInput.referenceBindings,
      { id: "voice", sourceType: "voice_reference_audio", sourceAssetId: "voice-1", mediaUrl: "https://cdn.example.com/voice.wav", purpose: "voice_timbre", preservation: "strong", required: true, priority: 90 },
    ],
  }),
  /不支持/,
  "the local workflow must reject unsupported references instead of silently deleting the author's exact selection",
);
const localIntent = prepareComfyUIH3Intent(localIntentInput);
assert.deepEqual(localIntent.referenceBindings.map((binding) => binding.sourceType), ["character_board"]);
assert.equal(localIntent.referenceBindings[0].displayName, "阿橘、老熊", "one shared production board must only occupy one H3 image slot");
assert.equal(localIntent.referenceBindings[0].semanticEntityId, undefined, "a shared board must not be mislabeled as belonging to only one character");
assert.match(localIntent.referenceBindings[0].description || "", /阿橘.*老熊/, "the shared image description must retain both identity mappings");
assert.equal((localIntent.referenceBindings[0].description?.match(/阿橘/g) || []).length, 1, "merging a shared board must not repeatedly nest the first identity label");
assert.equal(localIntent.referenceBindings[0].preservation, "required");
assert.equal(localIntent.audioPolicy.mode, "provider_native", "local H3 must record and use the model's native audio policy");

const request: MiniMaxH3VideoRequest = {
  model: "MiniMax-H3",
  resolution: "768P",
  duration: 5,
  ratio: "16:9",
  content: [
    { type: "text", text: "[Shot 1] 00:00-00:05，角色抬头，摄影机缓慢推进。" },
    ...Array.from({ length: 3 }, () => ({ type: "image_url", image_url: { url: onePixelPng }, role: "reference_image" } as const)),
  ],
};

assert.throws(() => validateComfyUIH3VideoRequest({ ...request, duration: 4 }), /最短长度约为 5 秒/);
assert.equal(validateComfyUIH3VideoRequest({ ...request, duration: 15 }).duration, 15, "the local workflow must accept the documented maximum duration");
assert.throws(() => validateComfyUIH3VideoRequest({ ...request, duration: 16 }), /5-15 秒/);
assert.throws(() => validateComfyUIH3VideoRequest({
  ...request,
  content: [
    request.content[0],
    ...Array.from({ length: 10 }, () => ({ type: "image_url", image_url: { url: onePixelPng }, role: "reference_image" } as const)),
  ],
}), /1-9 张参考图片/);

assert.throws(() => validateComfyUIH3VideoRequest({
  ...request,
  content: [
    request.content[0],
    { type: "audio_url", audio_url: { url: "https://cdn.example.com/voice.mp3" }, role: "voice_reference" },
  ],
}), /暂不发送参考视频或人物声音/);

const body = {
  idempotencyKey: "project-1:shot-1:local-h3:attempt-1",
  channelId: "channel-local-h3",
  modelConfigId: "model-local-h3",
  request,
  audit: { projectId: "project-1", shotId: "shot-1" },
};

const first = await invoke("POST", "/api/proxy/comfyui-h3-video/tasks", { body });
assert.equal(first.statusCode, 202);
assert.equal(first.payload.task.status, "queued");
assert.equal(first.payload.task.provider, "comfyui_h3");
assert.equal(first.payload.task.embeddedAudio, true);
assert.equal(uploadCount, 3);
assert.equal(submitCount, 1);
assert.ok(submittedGraph);
assert.equal(submittedGraph["6"].inputs.width, 960, "0.5MP 16:9 should use the documented 960px width");
assert.equal(submittedGraph["6"].inputs.height, 544, "0.5MP 16:9 should use the documented 544px height");
assert.equal(submittedGraph["6"].inputs.length, 124, "five seconds should be converted dynamically and aligned for H3");
assert.deepEqual(submittedGraph["6"].inputs["ref_images.ref_image_0"], ["100", 0]);
assert.deepEqual(submittedGraph["6"].inputs["ref_images.ref_image_1"], ["101", 0]);
assert.deepEqual(submittedGraph["6"].inputs["ref_images.ref_image_2"], ["102", 0]);
assert.equal(Object.keys(submittedGraph["6"].inputs).some((key) => key.startsWith("ref_audio")), false, "reference audio must not be sent into H3 conditioning");
assert.equal(Object.values(submittedGraph).some((node: any) => node.class_type === "LoadAudio"), false, "the API graph must not load a voice reference");
assert.deepEqual(submittedGraph["14"].inputs.audio, ["13", 0], "the model's native audio output should stay attached to the video");
assert.equal(Object.values(submittedGraph).filter((node: any) => node.class_type === "LoadImage").length, 3, "the graph must create exactly one loader per reference image");

const sixSecond2KGraph = buildComfyUIH3Prompt({
  request: { ...request, resolution: "2K", duration: 6 },
  settings: COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  uploadedImages: ["reference.png"],
  seed: 1,
  filenamePrefix: "video/test",
});
assert.equal(sixSecond2KGraph["6"].inputs.width, 1920, "the exported workflow's 2K 16:9 selector should use 1920px width");
assert.equal(sixSecond2KGraph["6"].inputs.height, 1088, "the exported workflow's multiple-of-32 2K height should be 1088px");
assert.equal(sixSecond2KGraph["6"].inputs.length, 141, "six seconds should use the nearest valid H3 frame count without exceeding the requested test duration");

const nineReferenceGraph = buildComfyUIH3Prompt({
  request: { ...request, duration: 15 },
  settings: COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  uploadedImages: Array.from({ length: 9 }, (_, index) => `reference-${index + 1}.png`),
  seed: 2,
  filenamePrefix: "video/test-nine-references",
});
assert.equal(nineReferenceGraph["6"].inputs.width, 960, "the local H3 workflow should default to 0.5MP");
assert.equal(nineReferenceGraph["6"].inputs.height, 544, "the 0.5MP default should keep the multiple-of-32 height");
assert.equal(nineReferenceGraph["6"].inputs.length, 362, "duration must be derived from the current video unit up to 15 seconds");
assert.deepEqual(nineReferenceGraph["6"].inputs["ref_images.ref_image_8"], ["108", 0]);
assert.equal(nineReferenceGraph["6"].inputs["ref_images.ref_image_9"], undefined, "the graph must add only the reference slots required by this request");
assert.equal(Object.values(nineReferenceGraph).filter((node: any) => node.class_type === "LoadImage").length, 9);

const duplicate = await invoke("POST", "/api/proxy/comfyui-h3-video/tasks", { body });
assert.equal(duplicate.statusCode, 200);
assert.equal(duplicate.payload.task.id, first.payload.task.id);
assert.equal(duplicate.payload.task.duplicate, true);
assert.equal(uploadCount, 3, "a duplicate click must not upload the references again");
assert.equal(submitCount, 1, "a duplicate click must not submit another ComfyUI prompt");

const [completed, concurrentCompleted] = await Promise.all([
  invoke("GET", "/api/proxy/comfyui-h3-video/tasks/:taskId", { params: { taskId: first.payload.task.id } }),
  invoke("GET", "/api/proxy/comfyui-h3-video/tasks/:taskId", { params: { taskId: first.payload.task.id } }),
]);
assert.equal(completed.statusCode, 200);
assert.equal(completed.payload.task.status, "succeeded");
assert.equal(completed.payload.task.videoUrl, `/media/project-1/comfyui_h3_${first.payload.task.id}.mp4`);
assert.equal(concurrentCompleted.payload.task.videoUrl, completed.payload.task.videoUrl);
assert.equal(downloadCount, 1, "concurrent refreshes must share one ComfyUI output archive download");
assert.equal(await fs.readFile(`${mediaAssetsDir}/project-1/comfyui_h3_${first.payload.task.id}.mp4`, "utf8"), "persisted-comfyui-video");
assert.equal(submitCount, 1, "polling must only query the original ComfyUI prompt");

const completedRefresh = await invoke("GET", "/api/proxy/comfyui-h3-video/tasks/:taskId", { params: { taskId: first.payload.task.id } });
assert.equal(completedRefresh.payload.task.videoUrl, completed.payload.task.videoUrl);
assert.equal(downloadCount, 1, "a persisted local video must not be downloaded again after refresh");
assert.equal(historyCount, 2, "a persisted local video must not query ComfyUI history again after refresh");

const legacySucceededTask = repository.create({
  idempotencyKey: "project-1:shot-legacy:local-h3:attempt-1",
  provider: "comfyui_h3",
  channelId: "channel-local-h3",
  modelConfigId: "model-local-h3",
  projectId: "project-1",
  status: "succeeded",
  providerTaskId: "prompt-legacy",
  videoUrl: "/api/proxy/comfyui-h3-video/tasks/legacy/output",
  embeddedAudio: true,
  requestHash: "legacy-request",
  request: {},
  providerResponse: { output: { filename: "legacy-candidate.mp4", subfolder: "video/omni_h3", type: "output" } },
});
const archivedLegacy = await invoke("GET", "/api/proxy/comfyui-h3-video/tasks/:taskId", { params: { taskId: legacySucceededTask.id } });
assert.equal(archivedLegacy.statusCode, 200);
assert.equal(archivedLegacy.payload.task.videoUrl, `/media/project-1/comfyui_h3_${legacySucceededTask.id}.mp4`);
assert.equal(downloadCount, 2, "a legacy succeeded proxy URL must be archived exactly once on its next query");
const archivedLegacyRefresh = await invoke("GET", "/api/proxy/comfyui-h3-video/tasks/:taskId", { params: { taskId: legacySucceededTask.id } });
assert.equal(archivedLegacyRefresh.payload.task.videoUrl, archivedLegacy.payload.task.videoUrl);
assert.equal(downloadCount, 2, "a migrated legacy task must not download again after refresh");

simulatePromptTimeout = true;
const uncertainBody = {
  ...body,
  idempotencyKey: "project-1:shot-1:local-h3:uncertain-attempt",
};
const uncertain = await invoke("POST", "/api/proxy/comfyui-h3-video/tasks", { body: uncertainBody });
assert.equal(uncertain.statusCode, 502);
assert.equal(uncertain.payload.task.status, "unknown");
assert.match(uncertain.payload.task.error, /不会自动重提/);
assert.equal(submitCount, 2);

const uncertainDuplicate = await invoke("POST", "/api/proxy/comfyui-h3-video/tasks", { body: uncertainBody });
assert.equal(uncertainDuplicate.statusCode, 200);
assert.equal(uncertainDuplicate.payload.task.id, uncertain.payload.task.id);
assert.equal(uncertainDuplicate.payload.task.duplicate, true);
assert.equal(submitCount, 2, "retrying an uncertain submit must return the persisted task without another ComfyUI prompt");
assert.equal(uploadCount, 6, "retrying an uncertain submit must not upload the references again");

const uncertainRefresh = await invoke("GET", "/api/proxy/comfyui-h3-video/tasks/:taskId", { params: { taskId: uncertain.payload.task.id } });
assert.equal(uncertainRefresh.statusCode, 200);
assert.equal(uncertainRefresh.payload.task.status, "unknown");
assert.equal(submitCount, 2, "refresh recovery must never resubmit an uncertain ComfyUI task");

console.log("ComfyUI MiniMax H3 video task self-check passed.");
