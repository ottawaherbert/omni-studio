import assert from "node:assert/strict";

import {
  createLegacyVideoGenerationIntent,
  type VideoReferenceBinding,
} from "../packages/production/src/services/production/videoGenerationIntent";
import {
  buildVideoReferenceManifest,
  stableSortVideoReferenceBindings,
} from "../packages/production/src/services/production/videoReferenceManifest";
import {
  buildLegacyGenericVideoRequest,
  compileGenericVideoAdapterPlan,
  GENERIC_FL2V_ADAPTER_ID,
  GENERIC_I2V_ADAPTER_ID,
} from "../packages/production/src/services/production/adapters/genericVideoAdapter";
import { composePromptBlocks } from "../src/services/production/promptComposition";
import { buildVideoGenerationTaskAudit } from "../src/services/production/videoGenerationTaskAudit";
import { resolveVideoModelAdapter } from "../packages/production/src/services/production/videoModelAdapterRegistry";
import { videoAudioModeOptionsForCapabilities } from "../packages/production/src/services/production/videoModelAdapter";
import { getVisualTaskRecipeForIntent } from "../packages/production/src/services/production/visualTaskRecipes";
import {
  AI_CONFIG_SCHEMA_VERSION,
  defaultChannels,
  normalizeAIConfig,
} from "../src/config/aiConfigDefaults";

const bindings: VideoReferenceBinding[] = [
  { id: "voice-b", sourceType: "voice_reference_audio", sourceAssetId: "voice-b", semanticEntityId: "bear", mediaUrl: "https://cdn.example.com/bear.wav", contentHash: "voice-b-hash", purpose: "voice_timbre", preservation: "strong", required: true, priority: 80 },
  { id: "storyboard", sourceType: "storyboard_panel", sourceAssetId: "panel-1", mediaUrl: "https://cdn.example.com/panel.png", contentHash: "panel-hash", purpose: "composition", preservation: "strong", required: true, priority: 90 },
  { id: "cat-side", sourceType: "character_board", sourceAssetId: "cat-side", semanticEntityId: "cat", mediaUrl: "https://cdn.example.com/cat-side.png", contentHash: "cat-side-hash", purpose: "identity", preservation: "required", required: true, priority: 90 },
  { id: "voice-a", sourceType: "voice_reference_audio", sourceAssetId: "voice-a", semanticEntityId: "cat", mediaUrl: "https://cdn.example.com/cat.wav", contentHash: "voice-a-hash", purpose: "voice_timbre", preservation: "strong", required: true, priority: 90 },
  { id: "cat-front", sourceType: "character_board", sourceAssetId: "cat-front", semanticEntityId: "cat", mediaUrl: "https://cdn.example.com/cat-front.png", contentHash: "cat-front-hash", purpose: "identity", preservation: "required", required: true, priority: 100 },
];

const sortedIds = stableSortVideoReferenceBindings(bindings).map((binding) => binding.id);
assert.deepEqual(sortedIds, ["cat-front", "cat-side", "storyboard", "voice-a", "voice-b"]);
assert.deepEqual(stableSortVideoReferenceBindings([...bindings].reverse()).map((binding) => binding.id), sortedIds);

const manifest = buildVideoReferenceManifest(bindings);
assert.deepEqual(manifest.map((entry) => entry.providerLabel), ["Picture 1", "Picture 2", "Picture 3", "Audio 1", "Audio 2"]);
assert.equal(manifest[0].logicalSubjectId, "Subject 1");
assert.equal(manifest[1].logicalSubjectId, "Subject 1", "multiple identity images must share one logical subject");
assert.equal(manifest[3].logicalSubjectId, "Subject 1", "the cat voice must bind to the cat subject");
assert.equal(manifest[4].logicalSubjectId, "Subject 2", "the bear voice must bind to a different subject");

const legacyIntent = createLegacyVideoGenerationIntent({
  prompt: "人物从桌边起身，摄影机缓慢跟移。",
  imageUrl: "https://cdn.example.com/start.png",
  endImageUrl: "https://cdn.example.com/end.png",
  durationSeconds: 8,
  aspectRatio: "16:9",
});
const frameAdapter = resolveVideoModelAdapter({ channelType: "gemini", modelId: "veo-3.1-fast" });
assert.equal(frameAdapter.id, GENERIC_I2V_ADAPTER_ID, "Gemini/Veo must not have a new dedicated adapter");
const legacyFrameAdapter = resolveVideoModelAdapter({
  channelType: "gemini",
  modelId: "veo-3.1-fast",
  configuredAdapterId: GENERIC_FL2V_ADAPTER_ID,
});
const framePlan = legacyFrameAdapter.compile({ intent: legacyIntent, modelConfigId: "veo-model" });
assert.deepEqual(buildLegacyGenericVideoRequest(legacyIntent, framePlan), {
  prompt: framePlan.adapterPrompt,
  imageUrl: "https://cdn.example.com/start.png",
  endImageUrl: "https://cdn.example.com/end.png",
  durationSeconds: 8,
  aspectRatio: "16:9",
});

const videoRecipe = getVisualTaskRecipeForIntent("video_clip");
const styledIntent = {
  ...legacyIntent,
  visualStyleContract: "Keep the approved cyan-and-amber palette and physically coherent materials.",
  visualStyleCompileManifest: {
    schemaVersion: "visual-compile-manifest.v1" as const,
    recipeId: videoRecipe.id,
    recipeVersion: videoRecipe.version,
    intent: "video_clip" as const,
    presentation: "final_render" as const,
    targetSelection: { mode: "targeted" as const, targets: [{ entityType: "character" as const, entityId: "character-1" }] },
    sourceStyle: { schemaVersion: "visual-style-lock.v3", revision: 4, resolvedContentHash: "style-hash-4" },
    appliedMediumProfiles: [],
    appliedMediumAssignmentIds: [],
    suppressedFields: [],
    issueCodes: [],
    blockIds: ["visual.artifact", "visual.implementation"],
  },
};
const styledPlan = compileGenericVideoAdapterPlan({
  intent: styledIntent,
  modelConfigId: "styled-video-model",
  adapterId: GENERIC_FL2V_ADAPTER_ID,
});
const expectedStyleBlock = `<project_visual_style>\n${styledIntent.visualStyleContract}\n</project_visual_style>`;
assert.equal((styledPlan.adapterPrompt.match(/<project_visual_style>/g) || []).length, 1);
assert.match(buildLegacyGenericVideoRequest(styledIntent, styledPlan).prompt, /physically coherent materials/);
assert.throws(
  () => buildLegacyGenericVideoRequest(styledIntent, {
    ...styledPlan,
    finalConfirmedPrompt: styledPlan.adapterPrompt.replace(expectedStyleBlock, ""),
  }),
  /删除、修改或重复/,
  "a confirmed prompt must not delete the compiled visual style contract",
);
assert.throws(
  () => buildLegacyGenericVideoRequest(styledIntent, {
    ...styledPlan,
    finalConfirmedPrompt: styledPlan.adapterPrompt.replace("cyan-and-amber", "magenta"),
  }),
  /删除、修改或重复/,
  "a confirmed prompt must not alter the compiled visual style contract",
);
assert.throws(
  () => buildLegacyGenericVideoRequest(styledIntent, {
    ...styledPlan,
    finalConfirmedPrompt: `${styledPlan.adapterPrompt}\n\n${expectedStyleBlock}`,
  }),
  /删除、修改或重复/,
  "a confirmed prompt must not duplicate the compiled visual style contract",
);

const taskPromptManifest = composePromptBlocks([{
  blockId: "video.adapter_task",
  source: "video adapter self-check",
  purpose: "verify persisted video task lineage",
  content: styledPlan.adapterPrompt,
  required: true,
}]).manifest;
const taskAudit = buildVideoGenerationTaskAudit({
  intent: styledIntent,
  plan: { ...styledPlan, finalConfirmedPrompt: styledPlan.adapterPrompt },
  promptCompositionManifest: taskPromptManifest,
  extra: { candidateIndex: 2 },
});
assert.equal(taskAudit.visualStyleCompileManifest?.recipeId, styledIntent.visualStyleCompileManifest.recipeId);
assert.equal(taskAudit.visualStyleCompileManifest?.recipeContract?.enforcement, "formal");
assert.ok(taskAudit.visualRecipeContract.acceptanceChecks.every((check) => check.status === "pending_review"));
assert.equal((taskAudit as typeof taskAudit & { candidateIndex: number }).candidateIndex, 2);
assert.equal(taskAudit.finalConfirmedPrompt, styledPlan.adapterPrompt);

assert.equal(resolveVideoModelAdapter({ channelType: "kie", modelId: "grok-imagine-video-1-5-preview" }).id, "video.kie.grok.i2v.v1");
assert.equal(resolveVideoModelAdapter({ channelType: "custom", modelId: "unknown-video" }).id, GENERIC_I2V_ADAPTER_ID);
assert.equal(resolveVideoModelAdapter({ channelType: "custom", modelId: "unknown-video", configuredAdapterId: GENERIC_FL2V_ADAPTER_ID }).id, GENERIC_FL2V_ADAPTER_ID);

const normalized = normalizeAIConfig({
  schemaVersion: 6,
  channels: defaultChannels,
  models: [{
    id: "custom-video-model",
    channelId: "default-gemini",
    alias: "Custom Veo",
    modelId: "veo-3.1-fast",
    capabilities: ["video"],
    visualPromptLanguagePolicy: "en",
    videoAdapterId: "video.gemini.veo.v1",
  }],
  routing: {
    scriptGen: "",
    storyboardGen: "",
    imageGen: "",
    videoGen: "custom-video-model",
    audioGen: "",
    videoExtraction: "",
    qcAnalyzer: "",
    visualQc: "",
  },
});
assert.equal(normalized.schemaVersion, AI_CONFIG_SCHEMA_VERSION);
assert.equal(normalized.models[0]?.videoAdapterId, "auto", "removed adapter selections must fall back to automatic detection");
assert.equal(normalized.models[0]?.visualPromptLanguagePolicy, "en");
assert.equal(normalized.routing.videoGen, "custom-video-model", "schema migration must preserve a user-created video route");

const genericAudioOptions = videoAudioModeOptionsForCapabilities(frameAdapter.capabilities);
assert.deepEqual(genericAudioOptions.map(option => option.id), ['post_dub'], 'generic video must not offer audio references it cannot send');
const localH3 = resolveVideoModelAdapter({ channelType: 'comfyui', modelId: 'MiniMax-H3', configuredAdapterId: 'video.minimax.h3.ref2va.v1' });
assert.deepEqual(videoAudioModeOptionsForCapabilities(localH3.capabilities, false).map(option => option.id), ['provider_native']);
assert.deepEqual(videoAudioModeOptionsForCapabilities({ nativeAudio: true, referenceAudios: true }).map(option => option.id), ['provider_native', 'reuse_dialogue', 'post_dub']);
for (const policy of [
  { mode: 'reuse_final_dialogue_audio' as const, dialogueAudioAssetIds: ['voice-a'] },
  { mode: 'reuse_final_dialogue_audio' as const, dialogueAudioAssetIds: [] },
  { mode: 'generate_with_voice_reference' as const, speakerBindings: [{ characterId: 'cat', voiceReferenceAssetId: 'voice-a' }] },
]) {
  const input = { ...legacyIntent, audioPolicy: policy };
  const plan = legacyFrameAdapter.compile({ intent: input, modelConfigId: 'veo-model' });
  assert.ok(plan.issues.some(issue => issue.code === 'VIDEO_AUDIO_REFERENCE_UNSUPPORTED' && issue.severity === 'blocking'));
  assert.throws(() => buildLegacyGenericVideoRequest(input, plan), /不接收参考音频/, 'unsupported audio policy cannot silently disappear at serialization');
}
const extraAudio = { ...legacyIntent, referenceBindings: [...legacyIntent.referenceBindings, bindings[0]] };
const extraAudioPlan = legacyFrameAdapter.compile({ intent: extraAudio, modelConfigId: 'veo-model' });
assert.throws(() => buildLegacyGenericVideoRequest(extraAudio, extraAudioPlan), /不接收参考音频/);

console.log("Video model adapter self-check passed, including audio capability choices and rejection of unsupported audio payloads.");
