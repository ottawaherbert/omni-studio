import { useSettingsStore } from '../src/store/useSettingsStore';
import assert from "node:assert/strict";
import { answerManualAI, getManualAIPending, withManualAIResult } from "../apps/web/src/clients/manualAIClient";
import { generateAIContent, generateAIImage, generateAIVoice, generateAIBgm, generateAIVideo, generateVideoFromIntent } from "../src/services/ai";
import { useAIConfigStore } from "../src/store/useAIConfigStore";
import { useGlobalStore } from "../src/store/useGlobalStore";
import { usePromptCompositionAuditStore } from "../src/store/usePromptCompositionAuditStore";
import { compileImageGenerationRequest, createImageGenerationReference, type CompiledImageGenerationRequest } from "../src/services/production/imageGenerationRequest";
import { createLegacyVideoGenerationIntent } from "../src/services/production/videoGenerationIntent";
import { getVisualTaskRecipeForIntent } from "../packages/production/src/services/production/visualTaskRecipes";
import { promptContentHash } from "../src/services/production/promptComposition";
import type { AIExecutionProvenance } from "../src/types/project";
import { formatAIExecutionProvenance } from "../src/utils/aiExecutionProvenance";

const savedTestMode = useSettingsStore.getState().isTestMode;
useSettingsStore.setState({ isTestMode: true });
const savedConfig = useAIConfigStore.getState();
const savedGlobal = useGlobalStore.getState();
const savedFetch = globalThis.fetch;
const calls: Array<{ url: string; body: any }> = [];
useAIConfigStore.setState({ hasHydrated: true, channels: [
  { id: "text", name: "text", type: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "test-only" },
  { id: "image", name: "image", type: "doubao", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiKey: "test-only" },
  { id: "audio", name: "audio", type: "custom", baseUrl: "http://127.0.0.1:8033/v1", apiKey: "" },
  { id: "video", name: "video", type: "gemini", baseUrl: "", apiKey: "test-only" },
], models: [
  { id: "text", channelId: "text", alias: "text", modelId: "text-test", capabilities: ["text"] },
  { id: "image", channelId: "image", alias: "image", modelId: "doubao-seedream-4-0", capabilities: ["image"] },
  { id: "audio", channelId: "audio", alias: "audio", modelId: "local-test", capabilities: ["audio"] },
  { id: "video", channelId: "video", alias: "video", modelId: "veo-3.1-fast", capabilities: ["video"] },
], routing: { ...savedConfig.routing, scriptGen: "text", imageGen: "image", audioGen: "audio", videoGen: "video" } });
useGlobalStore.setState({ bgmSettings: { ...savedGlobal.bgmSettings, provider: "custom", customApiUrl: "https://example.invalid/bgm", customKeySource: "local", customApiKey: "test-only" } });
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body));
  calls.push({ url, body });
  if (url === "/api/proxy/openai-compatible") return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  if (url === "/api/proxy/doubao") return Response.json({ data: [{ url: "/media/test-image.png" }] });
  if (url === "/api/audio/speech") return Response.json({ url: "/media/test-speech.wav" });
  if (url === "/api/proxy/custom-bgm") return Response.json({ url: "/media/test-bgm.wav" });
  if (url === "/api/proxy/gemini" && body.action === "generateVideos") return new Response("Test boundary: video generation deliberately not performed", { status: 418 });
  throw new Error(`Unexpected request: ${url}`);
};
const pending = async () => {
  for (let i = 0; i < 100; i++) { if (getManualAIPending()) return getManualAIPending()!; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error("Prompt editor did not open");
};
const review = <T>(run: () => Promise<T>) => withManualAIResult("", undefined, run, true);
const latestAudit = () => usePromptCompositionAuditStore.getState().records.at(-1)!;
try {
  let textAudit: any;
  let textExecution: AIExecutionProvenance | undefined;
  const text = review(() => generateAIContent({ prompt: "old fallback", promptBlocks: [{ blockId: "stale", source: "test", purpose: "test", content: "old actual block", required: true }], requireJson: true, onPromptComposed: audit => { textAudit = audit; }, onExecutionProvenance: audit => { textExecution = audit; } }));
  let request = await pending();
  assert.equal(request.prompt, "old actual block");
  answerManualAI(request.id, undefined, { prompt: "new actual task", systemInstruction: "Keep response in English." });
  assert.equal(await text, '{"ok":true}');
  const textBody = calls.at(-1)!.body.body;
  assert.equal(textBody.messages.find((message: any) => message.role === "user").content, "new actual task");
  assert.doesNotMatch(JSON.stringify(textBody), /old actual block|old fallback/);
  assert.equal(textAudit.manifest.finalHash, promptContentHash([textAudit.systemInstruction, textAudit.prompt].filter(Boolean).join("\n\n")));
  assert.deepEqual(textExecution, { source: "api", provider: "openai", modelId: "text-test", requestedModelId: "text" });
  const beforeManualText = calls.length;
  const manualText = withManualAIResult("profile", { kind: "text", text: '{"name":"苏挽"}' }, () => generateAIContent({ prompt: "profile", requireJson: true, onExecutionProvenance: audit => { textExecution = audit; } }));
  assert.equal(await manualText, '{"name":"苏挽"}');
  assert.deepEqual(textExecution, { source: "manual_external", provider: "manual_external", modelId: "manual_external", requestedModelId: "text" });
  assert.equal(calls.length, beforeManualText);
  assert.match(formatAIExecutionProvenance(textExecution), /手动外部返回/);
  assert.match(formatAIExecutionProvenance(undefined, "old-config-id"), /执行来源未记录/);

  const references = [createImageGenerationReference({ imageUrl: "/media/reference.png", label: "原角色", role: "character_identity" })];
  const imageOptions = { promptCore: "old composition", aspectRatio: "3:4" as const, references, outputConstraints: ["保留原角色红围巾"], visibleText: [{ text: "雪落之前", placement: "门上招牌" }] };
  let imageAudit: CompiledImageGenerationRequest | undefined;
  const image = review(() => generateAIImage({ ...imageOptions, onPromptCompiled: compiled => { imageAudit = compiled; } }));
  request = await pending();
  const imageReview = { prompt: "new composition", systemInstruction: "人物转向窗边。" };
  const expected = compileImageGenerationRequest({ ...imageOptions, promptCore: "人物转向窗边。\n\nnew composition" }, { enforcement: "formal" });
  assert.ok(request.previewPrompt!(imageReview).includes(expected.providerPrompt));
  assert.throws(() => answerManualAI(request.id, undefined, { prompt: "invalid --ar 16:9" }), /平台参数/);
  answerManualAI(request.id, undefined, imageReview);
  assert.equal(await image, "/media/test-image.png");
  const imageBody = JSON.parse(calls.at(-1)!.body.rawBody);
  assert.equal(imageBody.prompt, expected.providerPrompt);
  assert.deepEqual(imageBody.image, ["/media/reference.png"]);
  assert.equal(imageBody.size, "1536x2048");
  assert.equal(imageAudit!.manifest.finalHash, expected.manifest.finalHash);
  assert.match(imageBody.prompt, /红围巾/);
  assert.match(imageBody.prompt, /雪落之前/);

  const countBeforeManual = calls.length;
  let imageExecution: AIExecutionProvenance | undefined;
  const manualImage = review(() => generateAIImage({ ...imageOptions, onPromptCompiled: compiled => { imageAudit = compiled; }, onExecutionProvenance: audit => { imageExecution = audit; } }));
  request = await pending();
  answerManualAI(request.id, { kind: "image", url: "/media/manual-test.png" }, imageReview);
  assert.equal(await manualImage, "/media/manual-test.png");
  assert.equal(calls.length, countBeforeManual);
  assert.equal(imageAudit!.providerPrompt, expected.providerPrompt);
  assert.deepEqual(imageExecution, { source: "manual_external", provider: "manual_external", modelId: "manual_external", requestedModelId: "image" });

  const voice = review(() => generateAIVoice({ text: "old dialogue", voiceName: "serena", language: "Chinese", speed: 1, instructions: "old acting", modelConfigId: "audio", projectId: "test-project" }));
  request = await pending();
  assert.equal(request.systemInstruction, "old acting");
  assert.match(request.context!, /serena[\s\S]*Chinese/);
  answerManualAI(request.id, undefined, { prompt: "新台词。", systemInstruction: "压低声音，语气坚定。" });
  assert.equal(await voice, "/media/test-speech.wav");
  const voiceBody = calls.at(-1)!.body;
  assert.equal(voiceBody.text, "新台词。");
  assert.equal(voiceBody.instructions, "压低声音，语气坚定。");
  assert.equal(voiceBody.voice, "serena");
  assert.equal(voiceBody.language, "Chinese");
  assert.equal(voiceBody.speed, 1);
  assert.equal(voiceBody.projectId, "test-project");
  assert.equal(latestAudit().manifest.finalHash, promptContentHash("压低声音，语气坚定。\n\n新台词。"));

  const bgm = review(() => generateAIBgm({ prompt: "old music" }));
  request = await pending();
  answerManualAI(request.id, undefined, { prompt: "new music", systemInstruction: "Sparse piano." });
  assert.equal(await bgm, "/media/test-bgm.wav");
  assert.equal(calls.at(-1)!.body.prompt, "Sparse piano.\n\nnew music");
  assert.equal(latestAudit().manifest.finalHash, promptContentHash("Sparse piano.\n\nnew music"));

  const videoRecipe = getVisualTaskRecipeForIntent("video_clip");
  const visualStyleCompileManifest = { schemaVersion: "visual-compile-manifest.v1" as const, recipeId: videoRecipe.id, recipeVersion: videoRecipe.version, intent: "video_clip" as const, presentation: "final_render" as const, targetSelection: { mode: "targeted" as const, targets: [{ entityType: "character" as const, entityId: "test-character" }] }, sourceStyle: { schemaVersion: "visual-style-lock.v3", revision: 1, resolvedContentHash: "test-style" }, appliedMediumProfiles: [], appliedMediumAssignmentIds: [], suppressedFields: [], issueCodes: [], blockIds: [] };
  const imageUrl = "data:image/png;base64,dGVzdA==";
  let videoAudit: any;
  const directVideo = review(() => generateAIVideo({ prompt: "old video action", imageUrl, durationSeconds: 5, visualStyleCompileManifest, onProviderPromptPrepared: audit => { videoAudit = audit; } }));
  const directRejected = assert.rejects(directVideo, /Test boundary/);
  request = await pending();
  answerManualAI(request.id, undefined, { prompt: "new video action" });
  await directRejected;
  assert.equal(calls.at(-1)!.body.payload.prompt, videoAudit.finalProviderPrompt);
  assert.match(videoAudit.finalProviderPrompt, /new video action/);
  assert.doesNotMatch(videoAudit.finalProviderPrompt, /old video action/);

  const intent = { ...createLegacyVideoGenerationIntent({ prompt: "original intent", imageUrl, durationSeconds: 5 }), visualStyleCompileManifest };
  let intentPlan: any;
  const intentVideo = review(() => generateVideoFromIntent({ intent, idempotencyKey: "test-only", onAdapterPlanPrepared: plan => { intentPlan = plan; } }));
  const intentRejected = assert.rejects(intentVideo, /Test boundary/);
  request = await pending();
  answerManualAI(request.id, undefined, { prompt: "edited intent action" });
  await intentRejected;
  assert.equal(getManualAIPending(), undefined, "one video request must not open a second prompt editor");
  assert.match(intentPlan.finalConfirmedPrompt, /edited intent action/);
  assert.match(intentPlan.finalConfirmedPrompt, /visual_recipe_contract/);
  assert.equal(calls.at(-1)!.body.payload.prompt, intentPlan.finalConfirmedPrompt);

  const manualVideo = review(() => generateVideoFromIntent({ intent, idempotencyKey: "manual-test", onAdapterPlanPrepared: plan => { intentPlan = plan; } }));
  request = await pending();
  const beforeVideo = calls.length;
  answerManualAI(request.id, { kind: "video", url: "/media/already-uploaded.mp4" }, { prompt: "edited external video" });
  const adoptedVideo = await manualVideo;
  assert.equal(adoptedVideo.kind, "completed");
  assert.equal(intentPlan.finalConfirmedPrompt, "edited external video");
  assert.equal(latestAudit().manifest.finalHash, promptContentHash("edited external video"));
  assert.equal(calls.length, beforeVideo);
  console.log("manual-ai-consumer-prompt: all six AI entry points use reviewed prompts; image contracts/references, fixed voice parameters and manual/API audits agree; video stops at mocked boundary, no video generated");
} finally {
  globalThis.fetch = savedFetch;
  useSettingsStore.setState({ isTestMode: savedTestMode });
  useAIConfigStore.setState(savedConfig);
  useGlobalStore.setState(savedGlobal);
}
