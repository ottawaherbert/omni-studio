import assert from "node:assert/strict";

import { videoBeatDialogueLines, type VideoGenerationIntent, type VideoReferenceBinding } from "../packages/production/src/services/production/videoGenerationIntent";
import {
  buildMiniMaxH3VideoRequest,
  MINIMAX_H3_FL2VA_ADAPTER_ID,
  MINIMAX_H3_I2VA_ADAPTER_ID,
  MINIMAX_H3_L2VA_ADAPTER_ID,
  MINIMAX_H3_REF2VA_ADAPTER_ID,
  MINIMAX_H3_T2VA_ADAPTER_ID,
  validateMiniMaxH3FinalPrompt,
} from "../packages/production/src/services/production/adapters/minimaxH3Adapter";
import { listCompatibleVideoModelAdapters, resolveVideoModelAdapter } from "../packages/production/src/services/production/videoModelAdapterRegistry";

const referenceBindings: VideoReferenceBinding[] = [
  { id: "aju-board", sourceType: "character_board", sourceAssetId: "asset-aju", semanticEntityId: "cat_aju", mediaUrl: "https://cdn.example.com/aju.png", contentHash: "aju-hash", displayName: "阿橘", description: "his round face, short orange fur, green cardigan, dark trousers, and flat 2D animated design", purpose: "identity", preservation: "required", required: true, priority: 100 },
  { id: "bear-board", sourceType: "character_board", sourceAssetId: "asset-bear", semanticEntityId: "bear", mediaUrl: "https://cdn.example.com/bear.png", contentHash: "bear-hash", displayName: "老熊", description: "his broad body, dark-brown fur, beige vest, small round glasses, and flat 2D animated design", purpose: "identity", preservation: "required", required: true, priority: 90 },
  { id: "kitchen-board", sourceType: "scene_board", sourceAssetId: "scene-kitchen", semanticEntityId: "kitchen_01", mediaUrl: "https://cdn.example.com/kitchen.png", contentHash: "kitchen-hash", displayName: "阿橘家厨房", description: "the room layout, pale-green cabinets, wooden table, window position, and warm morning lighting", purpose: "environment", preservation: "required", required: true, priority: 100 },
  { id: "toaster-board", sourceType: "prop_board", sourceAssetId: "prop-toaster", semanticEntityId: "toaster_01", mediaUrl: "https://cdn.example.com/toaster.png", contentHash: "toaster-hash", displayName: "坏掉的烤面包机", description: "its cream shell, red switch, burn marks, and bent metal lever", purpose: "prop_identity", preservation: "required", required: true, priority: 100 },
  { id: "storyboard-panel", sourceType: "storyboard_panel", sourceAssetId: "panel-current", mediaUrl: "https://cdn.example.com/storyboard.png", contentHash: "storyboard-hash", displayName: "当前故事板格", purpose: "composition", preservation: "strong", required: true, priority: 100 },
  { id: "aju-voice", sourceType: "voice_reference_audio", sourceAssetId: "voice-aju", semanticEntityId: "cat_aju", mediaUrl: "https://cdn.example.com/aju.wav", contentHash: "voice-aju-hash", displayName: "阿橘声音", mediaDurationSeconds: 4, purpose: "voice_timbre", audioUsage: "voice_timbre", preservation: "strong", required: true, priority: 100 },
  { id: "bear-voice", sourceType: "voice_reference_audio", sourceAssetId: "voice-bear", semanticEntityId: "bear", mediaUrl: "https://cdn.example.com/bear.wav", contentHash: "voice-bear-hash", displayName: "老熊声音", mediaDurationSeconds: 4, purpose: "voice_timbre", audioUsage: "voice_timbre", preservation: "strong", required: true, priority: 90 },
];

const intent: VideoGenerationIntent = {
  schemaVersion: "video-generation-intent.v1",
  id: "intent-aju-bear",
  projectId: "project-animation",
  episodeId: "episode-1",
  sceneId: "scene-kitchen",
  videoGenerationUnitId: "unit-kitchen-1",
  storyboardBoardId: "board-kitchen",
  shotIds: ["shot-1", "shot-2", "shot-3"],
  durationSeconds: 8,
  aspectRatio: "16:9",
  startState: "阿橘蹲在烤面包机旁",
  endState: "两片焦黑面包弹出，阿橘合上工具箱",
  directorIntent: "A polished flat 2D animated sitcom scene in which Aju repairs a toaster and the bear neighbor comments dryly.",
  timelineBeats: [
    { id: "beat-1", shotId: "shot-1", startSeconds: 0, endSeconds: 3.2, visibleAction: "Aju crouches beside the damaged toaster and presses its red switch. Black smoke rises.", performance: "He maintains false confidence.", camera: "medium-wide locked composition", dialogue: "别担心，我已经找到问题了。", speakerCharacterId: "cat_aju", soundCues: ["quiet kitchen room tone", "toaster rattles", "switch clicks"], continuityIn: "阿橘开始修理", continuityOut: "烟冒出" },
    { id: "beat-2", shotId: "shot-2", startSeconds: 3.2, endSeconds: 5.6, visibleAction: "The bear enters from frame right and lowers his grocery bag.", performance: "He looks at the smoke with dry disbelief.", camera: "cut to the kitchen doorway", dialogue: "问题是不是你还在修？", speakerCharacterId: "bear", soundCues: ["grocery bag rustles"], continuityIn: "烟冒出", continuityOut: "老熊停在门口" },
    { id: "beat-3", shotId: "shot-3", startSeconds: 5.6, endSeconds: 8, visibleAction: "Two burned slices pop up and Aju quietly closes the toolbox.", performance: "Aju keeps a serious expression and blinks once.", camera: "slow small-amplitude push-in", soundCues: ["sharp metallic pop"], continuityIn: "老熊停在门口", continuityOut: "阿橘合上工具箱" },
  ],
  referenceBindings,
  audioPolicy: {
    mode: "generate_with_voice_reference",
    speakerBindings: [
      { characterId: "cat_aju", voiceReferenceAssetId: "voice-aju" },
      { characterId: "bear", voiceReferenceAssetId: "voice-bear" },
    ],
  },
  sourceHash: "source-aju-bear-v1",
};

const adapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3" });
assert.equal(adapter.id, MINIMAX_H3_REF2VA_ADAPTER_ID);
assert.deepEqual(
  listCompatibleVideoModelAdapters({ channelType: "minimax", modelId: "MiniMax-H3" }).map((item) => item.id),
  [MINIMAX_H3_REF2VA_ADAPTER_ID, MINIMAX_H3_T2VA_ADAPTER_ID, MINIMAX_H3_I2VA_ADAPTER_ID, MINIMAX_H3_FL2VA_ADAPTER_ID, MINIMAX_H3_L2VA_ADAPTER_ID],
  "the UI must discover all five modes from adapter contracts instead of model-name conditionals",
);
const plan = adapter.compile({ intent, modelConfigId: "minimax-h3", resolution: "768P" });
assert.equal(plan.issues.filter((issue) => issue.severity === "blocking").length, 0);
assert.deepEqual(plan.referenceManifest.map((entry) => entry.providerLabel), ["Picture 1", "Picture 2", "Picture 3", "Picture 4", "Picture 5", "Audio 1", "Audio 2"]);
assert.equal(plan.referenceManifest.find((entry) => entry.bindingId === "aju-voice")?.logicalSubjectId, "Subject 1");
assert.equal(plan.referenceManifest.find((entry) => entry.bindingId === "bear-voice")?.logicalSubjectId, "Subject 2");
for (const heading of ["subject_definitions:", "summary:", "retention_analysis:", "detailed_description:", "overall_soundscape:", "non_diegetic_music:"]) {
  assert.ok(plan.adapterPrompt.includes(heading), `H3 prompt should include ${heading}`);
}
assert.match(plan.adapterPrompt, /<Audio 1> is the voice-timbre reference.*<Subject 1> \(S1\)/);
assert.match(plan.adapterPrompt, /<Audio 2> is the voice-timbre reference.*<Subject 2> \(S2\)/);
assert.match(plan.adapterPrompt, /\[Shot 2\] At 00:03\.200/);
assert.match(plan.adapterPrompt, /\[Shot 3\] At 00:05\.600/);
assert.match(plan.adapterPrompt, /<d>\[Chinese\] 别担心，我已经找到问题了。<\/d>/);
assert.equal(validateMiniMaxH3FinalPrompt(plan, plan.adapterPrompt).length, 0);
assert.ok(validateMiniMaxH3FinalPrompt(plan, plan.adapterPrompt.replace("summary:", "")).some((issue) => issue.code === "H3_FINAL_PROMPT_STRUCTURE_INVALID"));
assert.ok(validateMiniMaxH3FinalPrompt(plan, plan.adapterPrompt.replaceAll("<Picture 5>", "<Picture 9>")).some((issue) => issue.code === "H3_FINAL_PROMPT_REFERENCE_MISMATCH"));
assert.ok(validateMiniMaxH3FinalPrompt(plan, plan.adapterPrompt.replace("[Shot 2] At 00:03.200", "[Shot 2] At 00:03.300")).some((issue) => issue.code === "H3_FINAL_PROMPT_TIMELINE_MISMATCH"));
assert.ok(validateMiniMaxH3FinalPrompt(plan, plan.adapterPrompt.replace("别担心，我已经找到问题了。", "我改主意了。")).some((issue) => issue.code === "H3_FINAL_PROMPT_DIALOGUE_MISMATCH"));
assert.throws(() => buildMiniMaxH3VideoRequest(intent, { ...plan, finalConfirmedPrompt: plan.adapterPrompt.replace("summary:", "") }), /summary/);

const request = buildMiniMaxH3VideoRequest(intent, plan);
assert.equal(request.model, "MiniMax-H3");
assert.equal(request.duration, 8);
assert.equal(request.resolution, "768P");
assert.equal(request.ratio, "16:9");
assert.deepEqual(request.content.slice(1).map((item) => "role" in item ? item.role : ""), [
  "reference_image", "reference_image", "reference_image", "reference_image", "reference_image", "reference_audio", "reference_audio",
]);

const conflictPlan = adapter.compile({
  intent: {
    ...intent,
    referenceBindings: [...referenceBindings, { id: "start", sourceType: "start_frame", sourceAssetId: "start", mediaUrl: "https://cdn.example.com/start.png", purpose: "composition", preservation: "required", required: true, priority: 200 }],
  },
  modelConfigId: "minimax-h3",
});
assert.ok(conflictPlan.issues.some((issue) => issue.code === "H3_REFERENCE_FRAME_MODE_CONFLICT"));
assert.throws(() => buildMiniMaxH3VideoRequest(intent, conflictPlan), /不能混在同一次/);

const frameAdapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3", configuredAdapterId: MINIMAX_H3_FL2VA_ADAPTER_ID });
const frameIntent: VideoGenerationIntent = {
  ...intent,
  referenceBindings: [
    { id: "start", sourceType: "start_frame", sourceAssetId: "start", mediaUrl: "https://cdn.example.com/start.png", purpose: "composition", preservation: "required", required: true, priority: 100 },
    { id: "end", sourceType: "end_frame", sourceAssetId: "end", mediaUrl: "https://cdn.example.com/end.png", purpose: "composition", preservation: "required", required: true, priority: 90 },
  ],
  audioPolicy: { mode: "post_dub", stripProviderAudio: false },
};
const framePlan = frameAdapter.compile({ intent: frameIntent, modelConfigId: "minimax-h3" });
assert.equal(framePlan.issues.filter((issue) => issue.severity === "blocking").length, 0);
assert.ok(framePlan.adapterPrompt.includes(frameIntent.directorIntent), "frame modes must preserve the author's director intent");
assert.match(framePlan.adapterPrompt.split("\n")[0], /<Picture 1>.*0\.00-second.*<Picture 2>.*8\.00-second/);
assert.ok(validateMiniMaxH3FinalPrompt(framePlan, framePlan.adapterPrompt.replace("8.00-second", "9.00-second")).some((issue) => issue.code === "H3_FINAL_PROMPT_FRAME_ALIGNMENT_MISMATCH"));
const frameRequest = buildMiniMaxH3VideoRequest(frameIntent, framePlan);
assert.equal(frameRequest.ratio, "adaptive");
assert.deepEqual(frameRequest.content.slice(1).map((item) => "role" in item ? item.role : ""), ["first_frame", "last_frame"]);

const nativeAudioIntent = { ...frameIntent, audioPolicy: { mode: "provider_native" as const } };
const modeCases = [
  { adapterId: MINIMAX_H3_T2VA_ADAPTER_ID, bindings: [], roles: [] },
  { adapterId: MINIMAX_H3_I2VA_ADAPTER_ID, bindings: [frameIntent.referenceBindings[0]], roles: ["first_frame"] },
  { adapterId: MINIMAX_H3_FL2VA_ADAPTER_ID, bindings: frameIntent.referenceBindings, roles: ["first_frame", "last_frame"] },
  { adapterId: MINIMAX_H3_L2VA_ADAPTER_ID, bindings: [frameIntent.referenceBindings[1]], roles: ["last_frame"] },
] as const;
for (const modeCase of modeCases) {
  const modeAdapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3", configuredAdapterId: modeCase.adapterId });
  const modeIntent = { ...nativeAudioIntent, referenceBindings: [...modeCase.bindings] };
  const modePlan = modeAdapter.compile({ intent: modeIntent, modelConfigId: "minimax-h3" });
  assert.equal(modePlan.issues.filter((issue) => issue.severity === "blocking").length, 0, modeCase.adapterId);
  assert.ok(modePlan.adapterPrompt.includes(modeIntent.directorIntent), `${modeCase.adapterId} must preserve creative direction`);
  assert.deepEqual(
    buildMiniMaxH3VideoRequest(modeIntent, modePlan).content.slice(1).map((item) => "role" in item ? item.role : ""),
    [...modeCase.roles],
    `${modeCase.adapterId} must send only its declared media roles`,
  );
}

const invalidI2VAdapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3", configuredAdapterId: MINIMAX_H3_I2VA_ADAPTER_ID });
assert.ok(invalidI2VAdapter.compile({ intent: nativeAudioIntent, modelConfigId: "minimax-h3" }).issues.some((issue) => issue.code === "H3_I2VA_FRAME_INVALID"));

const reorderedShots = plan.adapterPrompt.replace("[Shot 2] At 00:03.200", "TEMP_SHOT").replace("[Shot 3] At 00:05.600", "[Shot 2] At 00:03.200").replace("TEMP_SHOT", "[Shot 3] At 00:05.600");
assert.ok(validateMiniMaxH3FinalPrompt(plan, reorderedShots).some((issue) => issue.code === "H3_FINAL_PROMPT_TIMELINE_MISMATCH"), "a set of markers is not proof of correct playback order");
const repeatedDialogue = `${plan.adapterPrompt}\n<d>[Chinese] 别担心，我已经找到问题了。</d>`;
assert.ok(validateMiniMaxH3FinalPrompt(plan, repeatedDialogue).some((issue) => issue.code === "H3_FINAL_PROMPT_DIALOGUE_MISMATCH"), "repeated dialogue must not pass through a deduplicating validator");

const roundedIntent = { ...intent, timelineBeats: intent.timelineBeats.map((beat, index) => index === 1 ? { ...beat, startSeconds: 3.9999 } : beat) };
assert.match(adapter.compile({ intent: roundedIntent, modelConfigId: "h3" }).adapterPrompt, /At 00:04\.000/);
assert.doesNotMatch(adapter.compile({ intent: roundedIntent, modelConfigId: "h3" }).adapterPrompt, /\.1000/);

const textAdapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3", configuredAdapterId: MINIMAX_H3_T2VA_ADAPTER_ID });
const textAutoRatio = textAdapter.compile({ intent: { ...nativeAudioIntent, referenceBindings: [], aspectRatio: "adaptive" }, modelConfigId: "h3" });
assert.ok(textAutoRatio.issues.some((issue) => issue.code === "H3_TEXT_RATIO_REQUIRED"));
const silentText = textAdapter.compile({ intent: { ...nativeAudioIntent, referenceBindings: [], directorIntent: "Hold perfectly still in complete silence.", timelineBeats: [{ ...intent.timelineBeats[2], startSeconds: 0, soundCues: [] }] }, modelConfigId: "h3" });
assert.match(silentText.adapterPrompt, /Preserve explicitly requested silence/);
assert.doesNotMatch(silentText.adapterPrompt, /Natural production sound matching/);
assert.doesNotMatch(silentText.adapterPrompt, /non_diegetic_music:\s*N\/A(?:\s|$)/, "music requested in creative direction must not be contradicted by an unconditional no-music field");

console.log("MiniMax H3 adapter self-check passed.");

const phoneIntent: VideoGenerationIntent = {
  ...intent,
  referenceBindings: referenceBindings.filter(entry => entry.id !== "aju-board"),
  timelineBeats: intent.timelineBeats.map(beat => ({ ...beat, dialogueLines: videoBeatDialogueLines(beat).map(line => ({ ...line, delivery: line.characterId === "cat_aju" ? "phone" : "on_screen" })) })),
};
const phonePlan = adapter.compile({ intent: phoneIntent, modelConfigId: "minimax-h3" });
assert.ok(!phonePlan.issues.some(issue => issue.code === "H3_AUDIO_SUBJECT_MISSING"), "an explicitly off-camera speaker needs a voice, not a visual identity image");
assert.match(phonePlan.adapterPrompt, /Telephone voice; keep the speaker off camera/);
const missingVisual = adapter.compile({ intent: { ...phoneIntent, timelineBeats: intent.timelineBeats }, modelConfigId: "minimax-h3" });
assert.ok(missingVisual.issues.some(issue => issue.code === "H3_AUDIO_SUBJECT_MISSING"), "on-camera speakers still require their identity reference");
