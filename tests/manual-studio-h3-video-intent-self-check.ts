import assert from "node:assert/strict";

import {
  buildManualStudioVideoIntent,
  buildManualStudioStoryboardTimeline,
  resolveManualStudioInteractiveContext,
  selectMiniMaxH3GenerationWay,
} from "../src/services/production/manualStudioVideoIntent";
import {
  MINIMAX_H3_FL2VA_ADAPTER_ID,
  MINIMAX_H3_I2VA_ADAPTER_ID,
  MINIMAX_H3_L2VA_ADAPTER_ID,
  MINIMAX_H3_REF2VA_ADAPTER_ID,
  MINIMAX_H3_T2VA_ADAPTER_ID,
  validateMiniMaxH3FinalPrompt,
} from "../src/services/production/minimaxH3Adapter";
import { resolveVideoModelAdapter } from "../src/services/production/videoModelAdapterRegistry";
import { listManualStudioEligiblePriorVideoReferences } from "../src/services/production/manualStudioReferenceCandidates";
import { gatherContextOptions } from "../src/utils/contextMapper";
import { createNeutralVisualImplementation } from "../src/services/production/visualMediumProfiles";
import { visualStyleContentHash } from "../src/services/production/visualStyleMigration";

const approved3dImplementation = {
  ...createNeutralVisualImplementation("3d_animation"),
  appearance: {
    realism: "stylized" as const,
    dimensionality: "volumetric_3d" as const,
    finish: "polished" as const,
    descriptors: ["中国本土动物角色与中国生活环境统一的院线动画风格"],
  },
  techniques: ["stylized modeled character animation"],
  specification: {
    kind: "3d_animation" as const,
    modelingLanguage: ["high-recognition animal silhouettes and readable proportions"],
    shadingModel: ["stylized physically coherent fur and household materials"],
    lightingPipeline: ["soft motivated key with readable character separation"],
    riggingSystem: ["stable body, face, and fur deformation rig"],
    animationSystem: ["keyframe-led performance with bounded motion-capture support"],
    simulationPolicy: ["bounded fur, cloth, smoke, and prop simulation"],
    renderCharacter: ["clean theatrical animation finish"],
    compositing: ["integrated characters, environment, smoke, and practical effects"],
  },
};
const approvedVisualStyleLock: any = {
  schemaVersion: "visual-style-lock.v3",
  revision: 2,
  contentHash: "",
  visualImplementation: approved3dImplementation,
  treatment: {
    palette: [],
    color: ["明快但不过度饱和"],
    surface: ["柔和毛发表面与可信生活材质"],
    linework: [],
    lighting: ["柔和且有明确方向的家庭空间光线"],
    camera: ["适合家庭喜剧表演的清晰摄影机语言"],
    movement: ["轻快但保留动作起止状态"],
    composition: ["人物关系和喜剧反应始终清楚"],
    materials: ["非写实动画毛发与中国生活环境材质统一"],
    finish: ["院线动画完成度"],
    readability: ["动作、表情和道具状态优先可读"],
    constraints: ["不得漂移为真人或照片写实质感"],
    directives: ["中国本土动物主角的高辨识度三维卡通动画"],
  },
  mediumAssignments: [],
  sourceReview: { status: "current", changedFields: [], detectedAt: 1, basedOnRevision: 2 },
  humanApprovalState: "approved",
  source: "manual",
};
approvedVisualStyleLock.contentHash = visualStyleContentHash(approvedVisualStyleLock);

const project = {
  id: "project-animation",
  aspectRatio: "16:9",
  creativeVision: {
    visualStyle: "中国本土动物主角的高辨识度三维卡通动画",
    narrativeStyle: "轻快家庭讽刺喜剧，动物是故事主体",
    globalLook: {
      baseTexture: ["柔和毛发表面", "非写实动画材质"],
      colorGrading: ["明快但不过度饱和"],
      conditionalEffects: [],
    },
  },
  visualStyleLock: approvedVisualStyleLock,
  characters: [
    {
      id: "aju",
      name: "阿橘",
      voiceReferences: [{ id: "voice-aju", url: "https://cdn.example.com/aju.wav", usage: "voice_timbre", isDefault: true, durationSeconds: 4 }],
    },
    {
      id: "bear",
      name: "老熊",
      voiceReferences: [{ id: "voice-bear", url: "https://cdn.example.com/bear.wav", usage: "voice_timbre", isDefault: true, durationSeconds: 4 }],
    },
  ],
  assets: [
    { id: "kitchen", name: "厨房", type: "location" },
    { id: "toaster", name: "烤面包机", type: "prop" },
  ],
} as any;

const episode = { id: "episode-1" } as any;
assert.ok(
  gatherContextOptions(project, "generateVideo").defaultIds.includes("ctx_creativeVision"),
  "confirmed creative vision must be selected by default in the video prompt confirmation dialog",
);
const shot = {
  id: "shot-1",
  duration: 8,
  characterIdsInShot: ["aju", "bear"],
  locationId: "kitchen",
  propIds: ["toaster"],
  visualAction: "阿橘修理烤面包机，老熊走进厨房。",
  blocking: "阿橘在左，老熊从右侧进入。",
  cameraMovement: "先中广景，再切门口，最后缓慢推近。",
  dialogueLines: [
    { characterId: "aju", text: "别担心，我已经找到问题了。" },
    { characterId: "bear", text: "问题是不是你还在修？" },
  ],
} as any;

const scene = {
  id: "scene-kitchen",
  shots: [shot],
  audioTracks: [
    { id: "dialogue-aju", type: "dialogue", shotId: shot.id, characterId: "aju", url: "https://cdn.example.com/aju-master.wav", duration: 4, text: "别担心，我已经找到问题了。" },
    { id: "dialogue-bear", type: "dialogue", shotId: shot.id, characterId: "bear", url: "https://cdn.example.com/bear-master.wav", duration: 4, text: "问题是不是你还在修？" },
  ],
  interactiveMetadata: {
    nodeIds: ["node-kitchen"],
    visualProjectionFingerprint: "graph-v3",
    activeVisualScenarioId: "scenario-wet",
    incomingContext: "阿橘的外套仍然湿着，右手拿着钥匙。",
    outboundChoices: [
      { label: "让老熊帮忙", targetNodeId: "node-help" },
      { label: "继续逞强", targetNodeId: "node-alone", timeoutSeconds: 6, defaultTimeoutTargetNodeId: "node-alone" },
    ],
    visualScenarios: [{
      id: "scenario-wet",
      stateFingerprint: "state-wet-key",
      reuseFingerprint: "reuse-wet-key",
      observableFacts: ["阿橘右手拿着钥匙", "阿橘的外套已经淋湿"],
    }],
  },
} as any;

const importedContext = resolveManualStudioInteractiveContext({
  ...project, interactiveProductionPrepProfile: { experienceId: "interactive-work", graphVersionId: "graph-v3" },
} as any, scene, { interactiveContentSlot: "entry", videoPrompt: "人物说出 choice，仍是进入画面" });
assert.equal(importedContext?.experienceId, "interactive-work");
assert.equal(importedContext?.graphVersionId, "graph-v3");
assert.equal(importedContext?.contentSlot, "entry");
assert.equal(importedContext?.requiresIdleLoop, false);
assert.equal(importedContext?.visualScenarioId, "scenario-wet");
assert.equal(resolveManualStudioInteractiveContext(project, scene, { videoPrompt: "choice 是本场对白，不是播放指令" })?.contentSlot, "main");
assert.equal(resolveManualStudioInteractiveContext(project, { ...scene, interactiveMetadata: undefined }, { videoPrompt: "" }), undefined);

const boards = [
  { boardItemId: "aju-base", assetId: "aju", assetType: "character", assetName: "阿橘", prompt: "基础形态", referenceImageUrl: "https://cdn.example.com/aju-base.png" },
  { boardItemId: "aju-wet", assetId: "aju", assetType: "character", assetName: "阿橘", variantId: "wet", variantName: "湿外套", prompt: "短橘毛、绿色湿外套", referenceImageUrl: "https://cdn.example.com/aju-wet.png" },
  { boardItemId: "bear-board", assetId: "bear", assetType: "character", assetName: "老熊", prompt: "深棕毛、米色背心和圆眼镜", referenceImageUrl: "https://cdn.example.com/bear.png" },
  { boardItemId: "kitchen-board", assetId: "kitchen", assetType: "location", assetName: "厨房", prompt: "浅绿橱柜、木桌和晨光", referenceImageUrl: "https://cdn.example.com/kitchen.png" },
  { boardItemId: "toaster-board", assetId: "toaster", assetType: "prop", assetName: "烤面包机", prompt: "奶油色外壳、红色开关和焦痕", referenceImageUrl: "https://cdn.example.com/toaster.png" },
] as any[];

assert.equal(selectMiniMaxH3GenerationWay({}), MINIMAX_H3_REF2VA_ADAPTER_ID, "H3 must use multi-reference mode when no strict frame was selected");
assert.equal(
  selectMiniMaxH3GenerationWay({ startFrameUrl: "https://cdn.example.com/strict-start.png" }),
  MINIMAX_H3_I2VA_ADAPTER_ID,
  "a first frame alone must select I2V rather than silently pretending a tail frame exists",
);
assert.equal(selectMiniMaxH3GenerationWay({ endFrameUrl: "https://cdn.example.com/strict-end.png" }), MINIMAX_H3_L2VA_ADAPTER_ID);
assert.equal(selectMiniMaxH3GenerationWay({ startFrameUrl: "start", endFrameUrl: "end" }), MINIMAX_H3_FL2VA_ADAPTER_ID);

const target = {
  kind: "storyboard_board" as const,
  shotId: shot.id,
  boardId: "board-kitchen",
  pageId: "page-1",
  label: "厨房 8 秒视频单元",
  durationSeconds: 8,
  videoPrompt: "阿橘修理烤面包机，老熊吐槽。",
  assetIds: ["aju", "bear", "kitchen", "toaster"],
  assetBoardItemIds: [],
  storyboardImageUrl: "https://cdn.example.com/storyboard.png",
  videoReferenceImageUrl: "https://cdn.example.com/storyboard-clean.png",
  storyboardReferenceMode: "shot_grid" as const,
  includeStoryboardReference: true,
  selectedVoiceReferenceIds: ["voice-aju", "voice-bear"],
  videoGenerationUnitId: "unit-kitchen-8s",
  shotIds: [shot.id],
  startState: "阿橘蹲在烤面包机旁",
  endState: "焦黑面包弹出，阿橘合上工具箱",
  timeline: [
    { id: "beat-1", shotId: shot.id, panelId: "panel-1", startSeconds: 0, endSeconds: 3.2, visibleAction: "阿橘按下红色开关，黑烟升起。", performance: "保持虚假的自信。", camera: "中广景固定", dialogue: "别担心，我已经找到问题了。", speakerCharacterId: "aju", soundCues: ["开关咔哒声"], continuityIn: "开始修理", continuityOut: "黑烟升起" },
    { id: "beat-2", shotId: shot.id, panelId: "panel-2", startSeconds: 3.2, endSeconds: 5.6, visibleAction: "老熊从画右走进厨房。", performance: "干巴巴地看着黑烟。", camera: "切到厨房门口", dialogue: "问题是不是你还在修？", speakerCharacterId: "bear", soundCues: ["纸袋摩擦"], continuityIn: "黑烟升起", continuityOut: "老熊停在门口" },
    { id: "beat-3", shotId: shot.id, panelId: "panel-3", startSeconds: 5.6, endSeconds: 8, visibleAction: "两片焦黑面包弹出，阿橘默默合上工具箱。", performance: "严肃地眨一次眼。", camera: "小幅缓慢推近", soundCues: ["金属弹响"], continuityIn: "老熊停在门口", continuityOut: "阿橘合上工具箱" },
  ],
  interactiveContentSlot: "choice_hold" as const,
  interactiveNodeId: "node-kitchen",
};

const referenceIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target,
  boards,
  adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
  generationMode: "multimodal_reference",
  audioMode: "provider_native",
  startFrameUrl: "https://cdn.example.com/strict-start.png",
  endFrameUrl: "https://cdn.example.com/strict-end.png",
  directorIntent: "一段精致的二维家庭喜剧动画。",
  sourceHash: "storyboard-source-v1",
});
assert.equal(referenceIntent.referenceBindings.some((binding) => binding.description?.includes("基础形态") || binding.description?.includes("短橘毛")), false, "video prompts must not embed the long asset-board generation prompt");
assert.equal(referenceIntent.referenceBindings.filter((binding) => binding.sourceType === "start_frame" || binding.sourceType === "end_frame").length, 0);
assert.equal(
  referenceIntent.referenceBindings.find((binding) => binding.sourceType === "storyboard_board")?.mediaUrl,
  "https://cdn.example.com/storyboard-clean.png",
  "the creator-selected clean grid must be used without inferring a mode from the provider",
);
assert.equal(referenceIntent.referenceBindings.filter((binding) => ["character_board", "character_variant", "scene_board", "prop_board"].includes(binding.sourceType)).length, 5, "every explicitly selected asset board, including multiple variants of one asset, must be submitted");
assert.deepEqual(referenceIntent.referenceBindings.filter((binding) => binding.sourceType === "voice_reference_audio").map((binding) => binding.semanticEntityId), ["aju", "bear"]);
assert.equal(referenceIntent.audioPolicy.mode, "generate_with_voice_reference");
assert.equal(referenceIntent.interactiveContext?.contentSlot, "choice_hold");
assert.equal(referenceIntent.interactiveContext?.requiresIdleLoop, true);
assert.match(referenceIntent.visualStyleContract || "", /中国本土动物角色/);
assert.match(referenceIntent.visualStyleContract || "", /不得漂移为真人/);
assert.match(referenceIntent.visualStyleContract || "", /production video clip/, "real video intents must use the video_clip visual recipe");
assert.doesNotMatch(referenceIntent.visualStyleContract || "", /storyboard control drawing/, "real video intents must not inherit storyboard rendering instructions");
const subsetBoardIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target,
  boards: [boards[0]],
  adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
  generationMode: "multimodal_reference",
  audioMode: "provider_native",
  directorIntent: "只选择阿橘资产板，但镜头视觉媒介范围仍须覆盖镜头内全部实体。",
  sourceHash: "storyboard-source-subset-board",
});
assert.deepEqual(
  subsetBoardIntent.visualStyleCompileManifest?.targetSelection.targets
    .filter((item) => item.entityId)
    .map((item) => item.entityId)
    .sort(),
  ["aju", "bear", "kitchen", "toaster"],
  "selected reference boards must not narrow the shot's visual-style projection scope",
);
const directorBoardIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target: { ...target, storyboardReferenceMode: "director_board" },
  boards,
  adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
  generationMode: "multimodal_reference",
  audioMode: "provider_native",
  directorIntent: "一段精致的二维家庭喜剧动画。",
  sourceHash: "storyboard-source-director-board",
});
assert.equal(
  directorBoardIntent.referenceBindings.find((binding) => binding.sourceType === "storyboard_board")?.mediaUrl,
  "https://cdn.example.com/storyboard.png",
  "the creator-selected director board must remain usable without a MiniMax-specific asset gate",
);

const referenceAdapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3", configuredAdapterId: MINIMAX_H3_REF2VA_ADAPTER_ID });
const referencePlan = referenceAdapter.compile({ intent: referenceIntent, modelConfigId: "h3", resolution: "768P" });
assert.equal(referencePlan.issues.some((issue) => issue.severity === "blocking"), false);
assert.match(referencePlan.adapterPrompt, /<Audio \d+> is the voice-timbre reference[^\n]*<Subject \d+> \(S1\)/, "real Studio voice bindings must use the same speaker numbering as the spoken timeline");
assert.doesNotMatch(referencePlan.adapterPrompt, /\(aju\)|\(bear\)/, "database character ids are not H3 speaker ids");

const dialogueTimeline = buildManualStudioStoryboardTimeline({
  panels: [
    { id: "same-shot-start", shotId: shot.id, durationSeconds: 3, visualBeat: "保持双人构图" },
    { id: "same-shot-end", shotId: shot.id, durationSeconds: 5, visualBeat: "两人继续交谈" },
  ],
  startState: "两人站在厨房内",
  endState: "两人仍在原位",
} as any, [shot]);
assert.equal(dialogueTimeline.length, 1, "two storyboard action panels in one Shot must not invent two video cuts");
assert.deepEqual(dialogueTimeline[0].dialogueLines, shot.dialogueLines);
const sameShotInput = {
  project, episode, scene, shot, boards,
  target: { ...target, timeline: dialogueTimeline },
  adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
  generationMode: "multimodal_reference" as const,
  audioMode: "provider_native" as const,
  directorIntent: "A continuous two-person exchange. Keep the sign reading \"营业中\" visible.",
  sourceHash: "same-shot-two-speakers",
};
const sameShotIntent = buildManualStudioVideoIntent(sameShotInput);
assert.deepEqual(sameShotIntent.timelineBeats[0].dialogueLines, shot.dialogueLines);
const sameShotPrompt = referenceAdapter.compile({ intent: sameShotIntent, modelConfigId: "h3" }).adapterPrompt;
assert.equal(sameShotPrompt.match(/\[Shot \d+\]/g)?.length, 1);
assert.match(sameShotPrompt, /<Subject \d+> \(S1\) says: <d>\[Chinese\] 别担心/);
assert.match(sameShotPrompt, /<Subject \d+> \(S2\) says: <d>\[Chinese\] 问题是不是/);
assert.equal(sameShotPrompt.match(/<d>/g)?.length, 2);
assert.match(sameShotPrompt, /preserve authored text/);
assert.doesNotMatch(sameShotPrompt, /or any text in the target video/);
const standaloneIntent = buildManualStudioVideoIntent({ ...sameShotInput, target: { ...target, timeline: undefined } });
assert.deepEqual(standaloneIntent.timelineBeats[0].dialogueLines, shot.dialogueLines, "standalone Shot generation must preserve the same speaker facts as board generation");
const repeatedShot = { ...shot, dialogueLines: [shot.dialogueLines[1], shot.dialogueLines[0], shot.dialogueLines[1]] };
const repeatedIntent = buildManualStudioVideoIntent({ ...sameShotInput, shot: repeatedShot, target: { ...target, timeline: undefined } });
const repeatedPlan = referenceAdapter.compile({ intent: repeatedIntent, modelConfigId: "h3" });
assert.match(repeatedPlan.adapterPrompt, /<Audio \d+> is the voice-timbre reference[^\n]*<Subject 2> \(S1\)/, "speaker numbers follow spoken order, not character library order");
assert.equal(repeatedPlan.adapterPrompt.match(/<d>/g)?.length, 3, "repeated lines are authored content, not duplicates to remove");
assert.match(referencePlan.adapterPrompt, /seamless idle loop/i);
assert.match(referencePlan.adapterPrompt, /Do not perform any outgoing choice/i);
assert.match(referencePlan.adapterPrompt, /Keep the central interaction area visually clear/i);
assert.match(referencePlan.adapterPrompt, /\[Shot 2\] At 00:03\.200/);
assert.match(referencePlan.adapterPrompt, /<project_visual_style>[\s\S]*中国本土动物角色/);
assert.equal(
  referencePlan.adapterPrompt.match(/<project_visual_style>/g)?.length,
  1,
  "the execution adapter must compile the project visual style exactly once",
);
assert.equal(referencePlan.referenceManifest.length, referenceIntent.referenceBindings.length, "the style contract must not add media references");
const promptWithoutStyle = referencePlan.adapterPrompt.replace(/<project_visual_style>[\s\S]*?<\/project_visual_style>\n?/, "");
assert.ok(
  validateMiniMaxH3FinalPrompt(referencePlan, promptWithoutStyle)
    .some((issue) => issue.code === "H3_FINAL_PROMPT_STYLE_CONTRACT_MISMATCH"),
  "the final provider prompt must not drop the confirmed project style contract",
);

const audioOnlyIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target: {
    ...target,
    includeStoryboardReference: false,
    selectedVoiceReferenceIds: ["voice-aju"],
  },
  boards: [],
  adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
  generationMode: "multimodal_reference",
  audioMode: "provider_native",
  directorIntent: "只选择声音不足以驱动画面。",
  sourceHash: "storyboard-source-audio-only",
});
assert.deepEqual(audioOnlyIntent.referenceBindings.map((binding) => binding.sourceAssetId), ["voice-aju"], "reference construction must not silently add default visual or voice references");
const audioOnlyPlan = referenceAdapter.compile({ intent: audioOnlyIntent, modelConfigId: "h3" });
assert.ok(audioOnlyPlan.issues.some((issue) => issue.code === "H3_REFERENCE_MISSING"), "audio alone must not satisfy Ref2VA visual readiness");

const strictIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target: { ...target, interactiveContentSlot: "entry" },
  boards,
  adapterId: MINIMAX_H3_FL2VA_ADAPTER_ID,
  generationMode: "first_last_frame",
  audioMode: "provider_native",
  startFrameUrl: "https://cdn.example.com/strict-start.png",
  endFrameUrl: "https://cdn.example.com/strict-end.png",
  directorIntent: "承接上一选择造成的湿外套和手持钥匙状态。",
  sourceHash: "storyboard-source-v1",
});
assert.deepEqual(strictIntent.referenceBindings.map((binding) => binding.sourceType), ["start_frame", "end_frame"]);
assert.equal(strictIntent.audioPolicy.mode, "provider_native");
assert.equal(strictIntent.interactiveContext?.contentSlot, "entry");
const strictAdapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3", configuredAdapterId: MINIMAX_H3_FL2VA_ADAPTER_ID });
const strictPlan = strictAdapter.compile({ intent: strictIntent, modelConfigId: "h3", resolution: "768P" });
assert.equal(strictPlan.issues.some((issue) => issue.severity === "blocking"), false);
assert.match(strictPlan.adapterPrompt, /visible result carried in from the previous choice/i);
assert.match(strictPlan.adapterPrompt, /外套仍然湿着/);
assert.match(strictPlan.adapterPrompt, /<project_visual_style>[\s\S]*中国本土动物角色/);

const missingDialoguePlan = strictAdapter.compile({
  intent: { ...strictIntent, audioPolicy: { mode: "reuse_final_dialogue_audio", dialogueAudioAssetIds: [] } },
  modelConfigId: "h3",
});
assert.ok(missingDialoguePlan.issues.some((issue) => issue.code === "H3_DIALOGUE_MASTER_MISSING"));

const textIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target,
  boards,
  adapterId: MINIMAX_H3_T2VA_ADAPTER_ID,
  generationMode: "text_only",
  audioMode: "provider_native",
  startFrameUrl: "https://cdn.example.com/ignored-start.png",
  endFrameUrl: "https://cdn.example.com/ignored-end.png",
  directorIntent: "只按已确认的文本调度生成。",
  sourceHash: "storyboard-source-text",
});
assert.deepEqual(textIntent.referenceBindings, [], "T2V must remain text-only even when stale frame fields exist in the editor");

const projectReferenceEpisodes = [{
  id: "episode-library",
  title: "已完成片段",
  inspiration: "",
  scenes: [{
    id: "scene-library",
    title: "参考场",
    shots: [{
      id: "shot-library",
      takes: [{
        id: "take-shot-video",
        videoUrl: "https://cdn.example.com/reference-shot.mp4",
        videoMedia: { status: "ready" },
        generationAudit: { videoMotionContract: { durationSeconds: 10 } },
        createdAt: 1,
      }],
    }],
    manualStoryboard: {
      boards: [{
        id: "workflow-library",
        unitSchema: "storyboard_unit.v1",
        videoGenerationUnitId: "unit-library",
        shotId: "shot-library",
        takes: [{
          id: "take-unit-video",
          videoUrl: "https://cdn.example.com/reference-unit.mp4",
          videoMedia: { status: "ready" },
          generationAudit: { videoMotionContract: { durationSeconds: 10 } },
          createdAt: 2,
        }],
        updatedAt: 2,
      }, {
        id: "legacy-workflow",
        shotId: "shot-library",
        takes: [{
          id: "legacy-video",
          videoUrl: "https://cdn.example.com/legacy.mp4",
          videoMedia: { status: "ready" },
          generationAudit: { videoMotionContract: { durationSeconds: 5 } },
          createdAt: 3,
        }],
        updatedAt: 3,
      }],
    },
  }],
}] as any;
const priorVideoCandidates = listManualStudioEligiblePriorVideoReferences(projectReferenceEpisodes);
assert.equal(priorVideoCandidates.length, 2, "the reference picker must scan ready Shot and current StoryboardUnit Takes across the project while ignoring legacy boards");
assert.deepEqual(priorVideoCandidates.map((candidate) => candidate.durationSeconds), [10, 10]);
const totalDurationIntent = buildManualStudioVideoIntent({
  project,
  episode,
  scene,
  shot,
  target: {
    ...target,
    includeStoryboardReference: false,
    selectedVoiceReferenceIds: [],
    selectedReferenceVideos: priorVideoCandidates.map((candidate) => ({
      takeId: candidate.takeId,
      shotId: candidate.shotId,
      mediaUrl: candidate.mediaUrl,
      displayName: candidate.label,
      durationSeconds: candidate.durationSeconds,
    })),
  },
  boards: [],
  adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
  generationMode: "multimodal_reference",
  referenceCapabilities: { images: true, videos: true, audios: true },
  audioMode: "provider_native",
  directorIntent: "使用两段已完成片段作为动作参考。",
  sourceHash: "storyboard-source-prior-videos",
});
const totalDurationPlan = referenceAdapter.compile({ intent: totalDurationIntent, modelConfigId: "h3" });
assert.deepEqual(
  totalDurationPlan.referenceManifest.map((entry) => entry.mediaDurationSeconds),
  [10, 10],
  "known source duration must remain frozen in the provider manifest and Take audit input",
);
assert.ok(
  totalDurationPlan.issues.some((issue) => issue.code === "H3_REFERENCE_TOTAL_DURATION_EXCEEDED"),
  "two ten-second video references must be blocked before submitting the H3 request",
);

const localH3Adapter = resolveVideoModelAdapter({
  channelType: "comfyui",
  modelId: "MiniMax-H3",
  configuredAdapterId: MINIMAX_H3_REF2VA_ADAPTER_ID,
});
assert.equal(localH3Adapter.capabilities.referenceImages, true);
assert.equal(localH3Adapter.capabilities.referenceVideos, false, "the local image-only workflow must not advertise video references that it drops");
assert.equal(localH3Adapter.capabilities.referenceAudios, false, "the local image-only workflow must not advertise audio references that it drops");
assert.equal(localH3Adapter.capabilities.dialogueVoiceReference, false);

console.log("Manual Studio H3 video intent self-check passed.");

// Exercise the actual studio intent -> adapter -> provider request boundary.
const { buildVideoContinuityContext } = await import('../packages/production/src/services/production/videoContinuityContext');
const { buildMiniMaxH3VideoRequest } = await import('../src/services/production/minimaxH3Adapter');
const { buildLegacyGenericVideoRequest, GENERIC_I2V_ADAPTER_ID } = await import('../packages/production/src/services/production/adapters/genericVideoAdapter');
const previousShot = { ...shot, id: 'previous-local', visualAction: '上一镜将钥匙放在左桌角', continuityNote: '作者有意越轴', blocking: '人物看向画右' };
const followingShot = { ...shot, id: 'following-local', visualAction: '下一镜接起同一把钥匙', blocking: '人物反打看向画左' };
const continuityScene = { ...scene, shots: [previousShot, shot, followingShot] };
const continuityInput = { project, episode, scene: continuityScene, shot, target, boards, adapterId: MINIMAX_H3_REF2VA_ADAPTER_ID, generationMode: 'multimodal_reference', audioMode: 'provider_native' as const, directorIntent: '保留作者明确的越轴', sourceHash: 'continuity-source' };
const continuityIntent = buildManualStudioVideoIntent(continuityInput);
const continuityPlan = referenceAdapter.compile({ intent: continuityIntent, modelConfigId: 'h3' });
const continuityRequest = buildMiniMaxH3VideoRequest(continuityIntent, continuityPlan);
const requestText = (continuityRequest.content[0] as { text: string }).text;
assert.match(requestText, /上一镜将钥匙放在左桌角/);
assert.match(requestText, /下一镜接起同一把钥匙/);
assert.match(requestText, /作者有意越轴/);
assert.match(requestText, /first and last pose and sound bed loop cleanly/);
assert.doesNotMatch(requestText, /60%/);
assert.deepEqual(continuityIntent.referenceBindings, referenceIntent.referenceBindings, 'neighbour text must not add media');
assert.notEqual(continuityIntent.sourceHash, buildManualStudioVideoIntent({ ...continuityInput, scene: { ...continuityScene, shots: [{ ...previousShot, visualAction: '变更的承接动作' }, shot, followingShot] } }).sourceHash);
assert.equal(buildVideoContinuityContext({ sceneId: 'empty', shots: [], unitShotIds: [shot.id] }), '');
assert.equal(buildVideoContinuityContext({ sceneId: 'foreign', shots: [previousShot], unitShotIds: [shot.id] }), '');
const boundaryContext = buildVideoContinuityContext({ sceneId: scene.id, shots: [shot], unitShotIds: [shot.id] });
assert.match(boundaryContext, /无本场前镜头/); assert.match(boundaryContext, /无本场后镜头/);
const multiContext = buildVideoContinuityContext({ sceneId: scene.id, shots: [previousShot, shot, followingShot], unitShotIds: [previousShot.id, shot.id] });
assert.match(multiContext, /previous-local → shot-1/); assert.match(multiContext, /后一镜头.*following-local/);
const genericIntent = buildManualStudioVideoIntent({ ...continuityInput, adapterId: GENERIC_I2V_ADAPTER_ID, generationMode: 'first_frame', audioMode: 'post_dub', target: { ...target, selectedVoiceReferenceIds: [], includeStoryboardReference: false }, boards: [], startFrameUrl: 'https://example.test/selected-start.png' });
const genericAdapter = resolveVideoModelAdapter({ channelType: 'test', modelId: 'test', configuredAdapterId: GENERIC_I2V_ADAPTER_ID });
const genericPlan = genericAdapter.compile({ intent: genericIntent, modelConfigId: 'generic' });
const genericRequest = buildLegacyGenericVideoRequest(genericIntent, genericPlan);
assert.match(genericRequest.prompt, /上一镜将钥匙放在左桌角/);
assert.match(genericRequest.prompt, /seamless idle loop/);
assert.equal(genericRequest.imageUrl, 'https://example.test/selected-start.png');
console.log('Studio continuity provider request regression passed.');
