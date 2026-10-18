import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_CONFIG_SCHEMA_VERSION,
  COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND,
  KIE_DEFAULT_BASE_URL,
  KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  LLAMACPP_DEFAULT_BASE_URL,
  MINIMAX_H3_MODEL_ID,
  openAICompatibleReasoningParams,
  channelPresets,
  defaultAIConfig,
  defaultModels,
  defaultRouting,
  normalizeAIConfig,
  type AIModel,
} from "../src/config/aiConfigDefaults";

assert.ok(channelPresets.length > 0, "supported provider connections may be offered as presets");
assert.deepEqual(defaultModels, [], "concrete model instances must start empty");
assert.ok(Object.values(defaultRouting).every((modelId) => modelId === ""), "all task routes must start unbound");
assert.equal(defaultAIConfig.schemaVersion, AI_CONFIG_SCHEMA_VERSION);

assert.equal(channelPresets.some((preset: any) => preset.type === "yunwu"), false, "retired providers must not remain selectable");
const kiePreset = channelPresets.find((preset) => preset.type === "kie")!;
const llamaCppPreset = channelPresets.find((preset) => preset.type === "llamacpp")!;

const manualVideoModel: AIModel = {
  id: "model-user-created-kie-video",
  channelId: kiePreset.id,
  alias: "Grok Imagine Video 1.5",
  modelId: KIE_GROK_VIDEO_1_5_PREVIEW_MODEL_ID,
  capabilities: ["video"],
};
const manualConfig = normalizeAIConfig({
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  channels: channelPresets.map(({ capabilityHints: _capabilityHints, ...channel }) => channel),
  models: [manualVideoModel],
  routing: { ...defaultRouting, videoGen: manualVideoModel.id },
});
assert.equal(manualConfig.models[0]?.id, manualVideoModel.id);
assert.equal(manualConfig.models[0]?.videoAdapterId, "auto");
assert.equal(manualConfig.models[0]?.reasoningEffort, "provider_default");
assert.equal(manualConfig.routing.videoGen, manualVideoModel.id);
assert.deepEqual(openAICompatibleReasoningParams({ reasoningEffort: "provider_default" }), {});
assert.deepEqual(openAICompatibleReasoningParams({ reasoningEffort: "medium" }), {
  chat_template_kwargs: { reasoning_effort: "medium" },
});

const localH3Config = normalizeAIConfig({
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  channels: [{ id: "channel-comfyui-h3-test", name: "本地 MiniMax H3", type: "comfyui", baseUrl: "http://192.168.31.103:8118", apiKey: "", managedBy: "comfyui_h3_workflow" }],
  comfyWorkflows: [{
    id: "local-h3-workflow",
    name: "本地 MiniMax H3",
    channelId: "channel-comfyui-h3-test",
    kind: COMFYUI_MINIMAX_H3_REFERENCE_WORKFLOW_KIND,
    sourceWorkflowName: "video_minimax_h3_r2v.json",
    workflowJson: {},
    mappings: [],
    minimaxH3Reference: COMFYUI_MINIMAX_H3_REFERENCE_DEFAULT_SETTINGS,
  }],
  models: [{
    id: "local-h3-model",
    channelId: "channel-comfyui-h3-test",
    alias: "本地 MiniMax H3",
    modelId: "MiniMax-H3",
    capabilities: ["video"],
    comfyWorkflowId: "local-h3-workflow",
  }],
  routing: { ...defaultRouting, videoGen: "local-h3-model" },
});
assert.equal(localH3Config.comfyWorkflows[0]?.minimaxH3Reference?.megapixels, 0.5);
assert.equal(localH3Config.models[0]?.comfyWorkflowId, "local-h3-workflow");
assert.equal(localH3Config.channels[0]?.managedBy, "comfyui_h3_workflow");
assert.equal(localH3Config.models[0]?.managedBy, "comfyui_h3_workflow");
assert.equal(localH3Config.routing.videoGen, "local-h3-model", "the saved local H3 model must remain selectable as the video route");

const cloudH3Config = normalizeAIConfig({
  schemaVersion: 10,
  channels: [
    { id: "minimax-text", name: "MiniMax 文本", type: "minimax", baseUrl: "https://api.minimaxi.com/anthropic", apiKey: "" },
    { id: "minimax-h3-only", name: "MiniMax H3", type: "minimax", baseUrl: "https://api.minimax.io", apiKey: "" },
  ],
  models: [
    { id: "minimax-text-model", channelId: "minimax-text", alias: "MiniMax Text", modelId: "MiniMax-M2.7", capabilities: ["text"] },
    { id: "minimax-h3-cloud", channelId: "minimax-h3-only", alias: "MiniMax H3", modelId: MINIMAX_H3_MODEL_ID, capabilities: ["video"] },
  ],
  routing: { ...defaultRouting, scriptGen: "minimax-text-model", videoGen: "minimax-h3-cloud" },
});
assert.equal(cloudH3Config.models.some((model) => model.id === "minimax-h3-cloud"), false, "cloud H3 must be removed from ordinary model configuration");
assert.equal(cloudH3Config.channels.some((channel) => channel.id === "minimax-h3-only"), false, "a dedicated cloud H3 channel must be removed when empty");
assert.equal(cloudH3Config.routing.videoGen, "", "a removed cloud H3 video route must not silently switch to local H3");
assert.equal(cloudH3Config.routing.scriptGen, "minimax-text-model", "generic MiniMax text configuration remains manageable");

const unmanagedComfyH3Config = normalizeAIConfig({
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  channels: [{ id: "ordinary-comfy", name: "普通 ComfyUI", type: "comfyui", baseUrl: "http://127.0.0.1:8188", apiKey: "" }],
  models: [{
    id: "unmanaged-comfy-h3",
    channelId: "ordinary-comfy",
    alias: "绕过工作流的 H3",
    modelId: MINIMAX_H3_MODEL_ID,
    capabilities: ["video"],
    videoAdapterId: "video.minimax.h3.ref2va.v1",
  }],
  routing: { ...defaultRouting, videoGen: "unmanaged-comfy-h3" },
});
assert.deepEqual(unmanagedComfyH3Config.models, [], "an ordinary ComfyUI model must not impersonate the managed local H3 workflow");
assert.deepEqual(unmanagedComfyH3Config.channels, [], "an empty channel created only for an unmanaged H3 model must be removed");
assert.equal(unmanagedComfyH3Config.routing.videoGen, "", "an unmanaged H3 model must never remain routable");

const retiredH3AdapterConfig = normalizeAIConfig({
  schemaVersion: 10,
  channels: [{ id: "custom-video", name: "普通视频渠道", type: "openai", baseUrl: "https://example.com/v1", apiKey: "" }],
  models: [{
    id: "ordinary-video-with-old-h3-adapter",
    channelId: "custom-video",
    alias: "普通视频模型",
    modelId: "ordinary-video-model",
    capabilities: ["video"],
    videoAdapterId: "video.minimax.h3.ref2va.v1",
  }],
  routing: { ...defaultRouting, videoGen: "ordinary-video-with-old-h3-adapter" },
});
assert.equal(retiredH3AdapterConfig.models[0]?.videoAdapterId, "auto", "retired H3 adapters must not survive on ordinary models");
assert.equal(retiredH3AdapterConfig.routing.videoGen, "ordinary-video-with-old-h3-adapter", "a valid ordinary video route may remain after its retired adapter is reset");

const legacyConfig = normalizeAIConfig({
  schemaVersion: 7,
  channels: [
    ...channelPresets.map(({ capabilityHints: _capabilityHints, ...channel }) => channel),
    { id: "retired-channel", name: "Retired provider", type: "yunwu", baseUrl: "https://retired.invalid/v1", apiKey: "old" } as any,
  ],
  models: [{ id: "retired-model", channelId: "retired-channel", alias: "Retired model", modelId: "old-model", capabilities: ["video"] }],
  routing: { ...defaultRouting, videoGen: "retired-model" },
});
assert.equal(legacyConfig.channels.some((channel: any) => channel.type === "yunwu"), false);
assert.deepEqual(legacyConfig.models, []);
assert.equal(legacyConfig.routing.videoGen, "", "a route to a retired provider must be cleared");

const settingsSource = readFileSync("src/pages/Settings.tsx", "utf8");
const aiServiceSource = readFileSync("src/services/ai.ts", "utf8");
assert.equal(settingsSource.includes("Restore Defaults"), false);
assert.equal(settingsSource.includes("MODEL_CONFIG_ID"), false);
assert.ok(settingsSource.indexOf("label: '渠道管理'") < settingsSource.indexOf("label: '模型管理'"));
assert.ok(settingsSource.indexOf("label: '模型管理'") < settingsSource.indexOf("label: '任务路由'"));
assert.ok(settingsSource.includes("先配置渠道，再手动新增模型并绑定任务路由。"));
assert.ok(kiePreset, "Kie should be selectable as a provider connection preset");
assert.equal(kiePreset.baseUrl, KIE_DEFAULT_BASE_URL);
assert.ok(llamaCppPreset, "llama.cpp should be selectable as a local OpenAI-compatible provider");
assert.equal(llamaCppPreset.baseUrl, LLAMACPP_DEFAULT_BASE_URL);
assert.ok(settingsSource.includes('<option value="kie">Kie AI</option>'));
assert.ok(settingsSource.includes('<option value="llamacpp">llama.cpp (Local)</option>'));
assert.equal(settingsSource.includes("channel.type === 'llamacpp' ?"), false, "llama.cpp must keep the ordinary editable API key field");
assert.ok(settingsSource.includes("chat_template_kwargs.reasoning_effort"), "text model settings must explain the nested reasoning request field");
assert.ok(aiServiceSource.includes("openAICompatibleReasoningParams(model)"), "public text AI calls must carry the configured nested reasoning effort");
assert.ok(settingsSource.includes("openEditModelModal(model)"), "every model must use the unified editor");
assert.equal(settingsSource.includes('value="yunwu"'), false, "retired channels must not remain in Settings");
assert.ok(settingsSource.includes("const configuredChannel = configuredWorkflow?.channelId"), "editing the saved ComfyUI address must update the existing local configuration instead of creating duplicates");
assert.ok(settingsSource.includes("保存并用于视频生成"));
assert.ok(settingsSource.includes("内部生成目标由系统维护，不会重复出现在普通渠道和模型列表中"));
assert.ok(settingsSource.includes("删除本地配置"));
assert.equal(settingsSource.includes("addMiniMaxH3Video"), false, "cloud H3 must not have an ordinary model quick-add path");
assert.ok(settingsSource.includes("model.managedBy !== 'comfyui_h3_workflow'"), "system-managed local H3 models must stay out of ordinary model management");
assert.ok(settingsSource.includes("ORDINARY_VIDEO_MODEL_ADAPTER_OPTIONS"), "ordinary model editing must use the H3-free adapter list");
assert.ok(settingsSource.includes("!option.id.startsWith('video.minimax.h3.')"), "managed H3 adapters must not be offered to ordinary models");

console.log("AI config manual setup self-check passed.");
