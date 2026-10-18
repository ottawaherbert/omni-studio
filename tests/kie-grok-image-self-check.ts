import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_CONFIG_SCHEMA_VERSION,
  KIE_GPT_IMAGE_2_ADAPTER_ID,
  KIE_GPT_IMAGE_2_FAMILY_ID,
  KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  KIE_GROK_IMAGE_ADAPTER_ID,
  KIE_GROK_IMAGE_FAMILY_ID,
  KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  defaultChannels,
  normalizeAIConfig,
  type AIModel,
} from "../src/config/aiConfigDefaults";
import { buildKieGrokImageRequest } from "../src/services/providers/kieGrokImage";
import {
  assertImageGenerationRequestSupported,
  resolveImageModelCapabilities,
} from "../src/services/providers/imageModelCapabilities";
import {
  buildKieGrokImageCreateTaskRequest,
  registerKieGrokImageRoute,
  validateKieGrokImageRequest,
} from "../src/server/providers/kieGrokImage";
import { KIE_BASE64_UPLOAD_ENDPOINT } from "../src/server/providers/kieGrokVideo";

const channel = defaultChannels.find((item) => item.type === "kie");
assert.ok(channel);
const model: AIModel = {
  id: "kie-grok-image",
  channelId: channel.id,
  alias: "Grok Imagine 图片",
  modelId: KIE_GROK_IMAGE_FAMILY_ID,
  capabilities: ["image"],
  imageAdapterId: KIE_GROK_IMAGE_ADAPTER_ID,
};
assert.equal(normalizeAIConfig({ schemaVersion: AI_CONFIG_SCHEMA_VERSION, channels: defaultChannels, models: [model] }).models[0]?.modelId, KIE_GROK_IMAGE_FAMILY_ID);

const gptImage2Model: AIModel = {
  id: "kie-gpt-image-2",
  channelId: channel.id,
  alias: "GPT Image 2",
  modelId: KIE_GPT_IMAGE_2_FAMILY_ID,
  capabilities: ["image"],
  imageAdapterId: KIE_GPT_IMAGE_2_ADAPTER_ID,
  kieGptImage2: { resolution: "4K" },
};
const normalizedGptImage2 = normalizeAIConfig({ schemaVersion: AI_CONFIG_SCHEMA_VERSION, channels: defaultChannels, models: [gptImage2Model] }).models[0];
assert.equal(normalizedGptImage2?.kieGptImage2?.resolution, "4K");
assert.equal(normalizedGptImage2?.modelId, KIE_GPT_IMAGE_2_FAMILY_ID);
assert.equal(normalizedGptImage2?.imageAdapterId, KIE_GPT_IMAGE_2_ADAPTER_ID);

const migratedPairedConfig = normalizeAIConfig({
  schemaVersion: 10,
  channels: defaultChannels,
  models: [
    { ...gptImage2Model, id: "legacy-gpt-t2i", modelId: KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID },
    { ...gptImage2Model, id: "legacy-gpt-i2i", modelId: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID, kieGptImage2: { resolution: "2K" } },
  ],
  routing: { imageGen: "legacy-gpt-i2i" } as any,
});
assert.equal(migratedPairedConfig.models.length, 1, "paired operation configs must collapse into one model family");
assert.equal(migratedPairedConfig.models[0]?.id, "legacy-gpt-i2i", "the routed legacy config must win deterministically");
assert.equal(migratedPairedConfig.models[0]?.modelId, KIE_GPT_IMAGE_2_FAMILY_ID);
assert.equal(migratedPairedConfig.routing.imageGen, "legacy-gpt-i2i");
assert.deepEqual(normalizeAIConfig(migratedPairedConfig), migratedPairedConfig, "image-family migration must be idempotent");

const gptTextRequest = buildKieGrokImageRequest(gptImage2Model, { prompt: "电影海报", aspectRatio: "16:9" });
assert.deepEqual(gptTextRequest, {
  model: KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  prompt: "电影海报",
  aspectRatio: "16:9",
  resolution: "4K",
});
assert.deepEqual(buildKieGrokImageCreateTaskRequest(gptTextRequest), {
  model: KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID,
  input: { prompt: "电影海报", aspect_ratio: "16:9", resolution: "4K" },
});

const gptImageRequest = buildKieGrokImageRequest(gptImage2Model, {
  prompt: "保持角色和服装一致",
  aspectRatio: "3:4",
  referenceImages: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
});
assert.deepEqual(gptImageRequest, {
  model: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  prompt: "保持角色和服装一致",
  aspectRatio: "3:4",
  resolution: "4K",
  imageUrls: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
});
assert.deepEqual(validateKieGrokImageRequest(gptImageRequest), gptImageRequest);
assert.deepEqual(buildKieGrokImageCreateTaskRequest(gptImageRequest, undefined, gptImageRequest.imageUrls), {
  model: KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID,
  input: {
    prompt: "保持角色和服装一致",
    input_urls: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
    aspect_ratio: "3:4",
    resolution: "4K",
  },
});
assert.throws(() => buildKieGrokImageRequest(gptImage2Model, {
  prompt: "过多参考图",
  referenceImages: Array.from({ length: 17 }, (_, index) => `https://cdn.example.com/${index}.png`),
}), /最多接受 16 张参考图/);

const textRequest = buildKieGrokImageRequest(model, { prompt: "电影故事板", aspectRatio: "16:9" });
assert.deepEqual(textRequest, { model: KIE_GROK_TEXT_TO_IMAGE_MODEL_ID, prompt: "电影故事板", aspectRatio: "16:9" });
assert.deepEqual(validateKieGrokImageRequest(textRequest), textRequest);
assert.deepEqual(buildKieGrokImageCreateTaskRequest(textRequest), {
  model: KIE_GROK_TEXT_TO_IMAGE_MODEL_ID,
  input: { prompt: "电影故事板", aspect_ratio: "16:9" },
});

const portraitRequest = buildKieGrokImageRequest(model, { prompt: "角色设定板", aspectRatio: "3:4" });
assert.equal(portraitRequest.aspectRatio, "2:3", "the app portrait ratio should map to a documented Kie ratio");
const imageRequest = buildKieGrokImageRequest(model, { prompt: "保持人物一致性", referenceImages: ["data:image/png;base64,aGVsbG8="] });
assert.deepEqual(imageRequest, { model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID, prompt: "保持人物一致性", imageUrl: "data:image/png;base64,aGVsbG8=" });
assert.deepEqual(buildKieGrokImageCreateTaskRequest(imageRequest, "https://cdn.example.com/reference.png"), {
  model: KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID,
  input: { prompt: "保持人物一致性", image_urls: ["https://cdn.example.com/reference.png"] },
});
assert.throws(() => buildKieGrokImageRequest(model, { prompt: "多参考", referenceImages: ["https://a.example/a.png", "https://b.example/b.png"] }), /只接受 1 张参考图/);

assert.deepEqual(resolveImageModelCapabilities({ channel, model: gptImage2Model }), {
  familyLabel: "GPT Image 2",
  textToImage: true,
  imageToImage: true,
  maxReferenceImages: 16,
});
assert.doesNotThrow(() => assertImageGenerationRequestSupported({
  channel,
  model: gptImage2Model,
  referenceImages: Array.from({ length: 16 }, (_, index) => `https://cdn.example.com/${index}.png`),
}));
assert.throws(() => assertImageGenerationRequestSupported({
  channel,
  model: gptImage2Model,
  referenceImages: Array.from({ length: 17 }, (_, index) => `https://cdn.example.com/${index}.png`),
}), /系统不会静默丢弃素材/);
assert.doesNotThrow(() => assertImageGenerationRequestSupported({
  channel,
  model,
  referenceImages: ["https://cdn.example.com/a.png"],
}));
assert.throws(() => assertImageGenerationRequestSupported({
  channel,
  model,
  referenceImages: ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"],
}), /最多接受 1 张参考图/);
const openAIChannel = defaultChannels.find((item) => item.type === "openai")!;
assert.throws(() => assertImageGenerationRequestSupported({
  channel: openAIChannel,
  model: { ...gptImage2Model, channelId: openAIChannel.id, modelId: "gpt-image-1", imageAdapterId: undefined },
  referenceImages: ["https://cdn.example.com/a.png"],
}), /当前没有接入图生图/);

let handler: ((req: any, res: any) => Promise<unknown>) | undefined;
const providerCalls: Array<{ url: string; method: string; body?: any }> = [];
registerKieGrokImageRoute({
  post(path: string, routeHandler: typeof handler) {
    assert.equal(path, "/api/proxy/kie-grok-image");
    handler = routeHandler;
  },
} as any, {
  resolveConfiguration: (_channelId, modelConfigId) => ({
    endpoint: "https://api.kie.ai/api/v1/jobs/createTask",
    apiKey: "server-only-key",
    modelId: modelConfigId === gptImage2Model.id ? gptImage2Model.modelId : model.modelId,
  }),
  wait: async () => undefined,
  pollIntervalMs: 1,
  providerFetch: async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    providerCalls.push({ url, method: String(init?.method || "GET"), body });
    if (url === KIE_BASE64_UPLOAD_ENDPOINT) return new Response(JSON.stringify({ code: 200, data: { downloadUrl: "https://cdn.example.com/reference.png" } }), { status: 200 });
    if (String(init?.method) === "POST") return new Response(JSON.stringify({ code: 200, data: { taskId: "image-task-1" } }), { status: 200 });
    return new Response(JSON.stringify({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://cdn.example.com/result.png"] }) } }), { status: 200 });
  },
});
assert.ok(handler);

let responseStatus = 0;
let responsePayload: any;
await handler!({ body: { channelId: channel.id, modelConfigId: model.id, request: imageRequest } }, {
  status(value: number) { responseStatus = value; return this; },
  json(value: unknown) { responsePayload = value; return value; },
});
assert.equal(responseStatus, 200);
assert.equal(responsePayload.imageUrl, "https://cdn.example.com/result.png");
assert.equal(providerCalls.length, 3, "image-to-image should upload once, submit once, then poll once");
assert.equal(providerCalls[1].body.model, KIE_GROK_IMAGE_TO_IMAGE_MODEL_ID);
assert.deepEqual(providerCalls[1].body.input.image_urls, ["https://cdn.example.com/reference.png"]);

providerCalls.length = 0;
await handler!({ body: { channelId: channel.id, modelConfigId: gptImage2Model.id, request: gptImageRequest } }, {
  status(value: number) { responseStatus = value; return this; },
  json(value: unknown) { responsePayload = value; return value; },
});
assert.equal(responseStatus, 200);
assert.equal(providerCalls.length, 2, "public GPT Image 2 references should submit once and then poll once");
assert.equal(providerCalls[0].body.model, KIE_GPT_IMAGE_2_IMAGE_TO_IMAGE_MODEL_ID);
assert.equal(providerCalls[0].body.input.resolution, "4K");
assert.deepEqual(providerCalls[0].body.input.input_urls, ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"]);

const settingsSource = readFileSync("src/pages/Settings.tsx", "utf8");
const aiSource = readFileSync("src/services/ai.ts", "utf8");
const routesSource = readFileSync("src/server/routes/providerProxyRoutes.ts", "utf8");
const providerSource = readFileSync("src/server/providers/kieGrokImage.ts", "utf8");
const storyboardBatchSource = readFileSync("src/hooks/useStoryboardBoardBatchAgent.ts", "utf8");
assert.ok(settingsSource.includes("Kie Grok Imagine"));
assert.ok(settingsSource.includes("Kie GPT Image 2"));
assert.ok(settingsSource.includes("KIE_GPT_IMAGE_2_RESOLUTIONS"));
assert.ok(settingsSource.includes("具体文生图或图生图接口由系统根据本次参考图数量自动选择"));
assert.equal(settingsSource.includes("KIE_GPT_IMAGE_2_TEXT_TO_IMAGE_MODEL_ID"), false, "provider operation IDs must not leak into Settings");
assert.ok(aiSource.includes("generateKieGrokImage"));
assert.ok(routesSource.includes("registerKieGrokImageRoute(app)"));
assert.equal(providerSource.includes("REQUEST_TIMEOUT_MS"), false, "image tasks must wait for a provider terminal status");
assert.equal(providerSource.includes("KIE_GROK_IMAGE_TIMEOUT"), false, "elapsed time must not manufacture an image failure");
assert.equal(storyboardBatchSource.includes("isKieGrokImageModelId"), false, "storyboard generation must use model capabilities rather than provider IDs");
assert.equal(storyboardBatchSource.includes("providerReferenceLimit"), false, "storyboard generation must not keep a provider-specific reference limit");

console.log("Kie Grok Image self-check passed.");
