import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mergeStoryboardBoardBatchValues,
  getIncompleteStoryboardBoardShotIds,
  normalizeStoryboardBoardQualityWithEvidence,
  scoreStoryboardBoardCandidateCompleteness,
  scoreStoryboardBoardIssues,
  type StoryboardBoardBatchValue,
} from "../src/services/production/storyboardBoardAgent";
import {
  buildStoryboardShotQualityPrompt,
  buildStoryboardShotRepairPrompt,
  isStoryboardAgentQualityPassing,
  normalizeStoryboardAgentQuality,
  resolveStoryboardQualityTargetShotId,
  STORYBOARD_AGENT_QUALITY_THRESHOLD,
  validateStoryboardShotContract,
} from "../src/services/production/storyboardShotAgent";
import {
  allocateDialogueLineDurations,
  estimateDialogueLineDurationSeconds,
} from "../src/services/production/storyboardDialogueTiming";
import {
  buildStoryboardImagePromptQualityPrompt,
  buildStoryboardImagePromptRepairPrompt,
  buildStoryboardVideoPromptQualityPrompt,
  normalizeStoryboardImagePrompts,
  normalizeStoryboardVideoPrompts,
  validateStoryboardImagePromptContract,
  validateStoryboardVideoPromptContract,
} from "../src/services/production/storyboardVisualPromptAgent";
import type { Shot } from "../src/types/project";
import { resolveStoryboardCandidateDisposition } from "../src/hooks/useStoryboardAI";

const assetIds = {
  character: new Set(["character-a", "character-b"]),
  location: new Set(["location-a"]),
  prop: new Set(["prop-a"]),
};
const resolveAssetId = (type: keyof typeof assetIds, value: string) =>
  assetIds[type].has(value) ? value : undefined;

const rawShots = [
  {
    motivation: "建立空间和行动目标",
    visualAction: "角色走到桌边放下道具",
    shotSize: "MS",
    cameraAngle: "Eye-Level",
    cameraMovement: "Track",
    focalLength: "50mm",
    composition: "角色和桌面形成前后景",
    blocking: "角色从画左进入并停在桌前",
    continuityNote: "保持轴线、视线、动作顺接与空间方位",
    duration: 45,
    characterIdsInShot: ["character-a"],
    locationId: "location-a",
    propIds: ["prop-a"],
    dialogueLines: [],
  },
  {
    motivation: "完成动作结果和人物反应",
    visualAction: "另一角色拿起道具并看向门口",
    shotSize: "CU",
    cameraAngle: "Eye-Level",
    cameraMovement: "Push-in",
    focalLength: "85mm",
    composition: "人物眼神与道具同框",
    blocking: "角色保持在画右并抬起道具",
    continuityNote: "沿既定轴线承接视线、动作和空间方位",
    duration: 45,
    characterIdsInShot: ["character-b"],
    locationId: "location-a",
    propIds: ["prop-a"],
    dialogueLines: [],
  },
];
const normalizedShots = rawShots.map((shot, index): Shot => ({ ...shot, id: `shot-${index + 1}` }));

const validIssues = validateStoryboardShotContract({
  rawShots,
  normalizedShots,
  targetDurationSeconds: 90,
  enforceAssetScope: true,
  allowedAssetIds: {
    character: ["character-a", "character-b"],
    location: ["location-a"],
    prop: ["prop-a"],
  },
  resolveAssetId,
});
assert.deepEqual(validIssues, []);

const unboundLocationOptions = {
  rawShots: rawShots.map(shot => ({ ...shot, locationId: "" })),
  normalizedShots: normalizedShots.map(shot => ({ ...shot, locationId: "" })),
  targetDurationSeconds: 90,
  enforceAssetScope: true,
  allowedAssetIds: { character: ["character-a", "character-b"], location: ["location-a"], prop: ["prop-a"] },
  resolveAssetId,
};
assert.deepEqual(validateStoryboardShotContract({ ...unboundLocationOptions, requireLocation: false }), [], "an unbound scene must not be forced into an unrelated registered location");
assert.ok(validateStoryboardShotContract({ ...unboundLocationOptions, requireLocation: true }).some(issue => issue.code === "unknown_location"), "a scene with an explicit location binding still checks missing location IDs");


const shortIssues = validateStoryboardShotContract({
  rawShots: rawShots.map((shot) => ({ ...shot, duration: 31.5 })),
  normalizedShots: normalizedShots.map((shot) => ({ ...shot, duration: 31.5 })),
  targetDurationSeconds: 90,
  enforceAssetScope: true,
  allowedAssetIds: {
    character: ["character-a", "character-b"],
    location: ["location-a"],
    prop: ["prop-a"],
  },
  resolveAssetId,
});
assert.ok(shortIssues.some((issue) => issue.code === "duration_mismatch"));

const unknownAssetIssues = validateStoryboardShotContract({
  rawShots: [{ ...rawShots[0], characterIdsInShot: ["unknown-character"] }],
  normalizedShots: [normalizedShots[0]],
  targetDurationSeconds: 45,
  enforceAssetScope: true,
  allowedAssetIds: { character: ["character-a"], location: ["location-a"], prop: ["prop-a"] },
  resolveAssetId,
});
assert.ok(unknownAssetIssues.some((issue) => issue.code === "unknown_character" && issue.severity === "blocking"));

const sceneLocalSpeakerIssues = validateStoryboardShotContract({
  rawShots: [{
    ...rawShots[0],
    dialogueLines: [{ speakerName: "周阿姨", text: "你们看见我的拖鞋了吗？" }],
  }],
  normalizedShots: [normalizedShots[0]],
  targetDurationSeconds: 45,
  enforceAssetScope: true,
  allowedAssetIds: { character: ["character-a"], location: ["location-a"], prop: ["prop-a"] },
  allowedUnboundSpeakerNames: ["周阿姨"],
  resolveAssetId,
});
assert.equal(
  sceneLocalSpeakerIssues.some((issue) => issue.code === "invalid_dialogue_speaker"),
  false,
  "a declared scene-local speaker must not be forced into the formal character library",
);

const inventedSpeakerIssues = validateStoryboardShotContract({
  rawShots: [{ ...rawShots[0], dialogueLines: [{ speakerName: "陌生人", text: "临时加一句。" }] }],
  normalizedShots: [normalizedShots[0]],
  targetDurationSeconds: 45,
  enforceAssetScope: true,
  allowedAssetIds: { character: ["character-a"], location: ["location-a"], prop: ["prop-a"] },
  allowedUnboundSpeakerNames: ["周阿姨"],
  resolveAssetId,
});
assert.ok(inventedSpeakerIssues.some((issue) => issue.code === "invalid_dialogue_speaker"));

const fakeSpeakerIdIssues = validateStoryboardShotContract({
  rawShots: [{ ...rawShots[0], dialogueLines: [{ characterId: "周阿姨", text: "不能伪造正式角色 ID。" }] }],
  normalizedShots: [normalizedShots[0]],
  targetDurationSeconds: 45,
  enforceAssetScope: true,
  allowedAssetIds: { character: ["character-a"], location: ["location-a"], prop: ["prop-a"] },
  allowedUnboundSpeakerNames: ["周阿姨"],
  resolveAssetId,
});
assert.ok(fakeSpeakerIdIssues.some((issue) => issue.code === "invalid_dialogue_speaker"));

assert.equal(
  estimateDialogueLineDurationSeconds("我查真相，你出鼻子。"),
  2,
  "Chinese punctuation must not be miscounted as English words and inflate a shot",
);
const allocatedDialogueDurations = allocateDialogueLineDurations([
  { text: "我查真相，你出鼻子。" },
  { text: "也查你不想说的？" },
  { text: "别攻击调查组。" },
], 5);
assert.equal(Number(allocatedDialogueDurations.reduce((sum, value) => sum + value, 0).toFixed(3)), 5);
assert.ok(allocatedDialogueDurations.every((duration) => duration > 0 && duration <= 5));

const dialogueCapacityIssues = validateStoryboardShotContract({
  rawShots: [{
    ...rawShots[0],
    duration: 5,
    dialogueLines: [{ characterId: "character-a", text: "这是一段明显放不进五秒镜头里的很长很长的对白，需要拆分镜头或者精简以后再交付。" }],
  }],
  normalizedShots: [{ ...normalizedShots[0], duration: 5 }],
  targetDurationSeconds: 5,
  enforceAssetScope: true,
  allowedAssetIds: { character: ["character-a"], location: ["location-a"], prop: ["prop-a"] },
  resolveAssetId,
});
assert.ok(dialogueCapacityIssues.some((issue) => (
  issue.code === "dialogue_capacity_exceeded"
  && issue.severity === "warning"
  && issue.message.includes("保留原时长")
)));

const storyboardHookSource = fs.readFileSync(new URL("../src/hooks/useStoryboardAI.ts", import.meta.url), "utf8");
const shotAgentSource = storyboardHookSource.slice(
  storyboardHookSource.indexOf("const runManualShotAgentForScene"),
  storyboardHookSource.indexOf("const handleGenerateSegmentShots"),
);
const visualPromptAgentSource = storyboardHookSource.slice(
  storyboardHookSource.indexOf("const runManualVisualPromptAgentForScene"),
  storyboardHookSource.indexOf("const handlePrepareGeneratePrompts"),
);
const explicitAdoptionSource = storyboardHookSource.slice(
  storyboardHookSource.indexOf("const adoptReviewCandidate"),
  storyboardHookSource.indexOf("return {", storyboardHookSource.indexOf("const adoptReviewCandidate")),
);
assert.equal(storyboardHookSource.includes("Math.max(rawDuration, minimumDialogueDuration)"), false);
assert.equal(storyboardHookSource.includes("Math.max(rawDuration, minVoiceDuration)"), false);
assert.ok(storyboardHookSource.includes("duration: rawDuration"), "normalization must preserve an explicit authored shot duration");
assert.ok(storyboardHookSource.includes("allocateDialogueLineDurations"), "multiple dialogue lines must share the authored shot duration instead of extending it");
assert.ok(
  storyboardHookSource.includes("promptKind === \"image\" ? storyboardImagePromptSchema : storyboardVideoPromptSchema"),
  "image and video prompts must use separate model calls and schemas",
);
assert.ok(
  storyboardHookSource.includes("validateStoryboardImagePromptContract")
    && storyboardHookSource.includes("validateStoryboardVideoPromptContract"),
  "each prompt layer must retain an independent contract and quality pass",
);
assert.ok(
  storyboardHookSource.includes("qa: undefined"),
  "automatic regeneration must discard stale persisted QA and rely on the current AI audits",
);
assert.ok(
  storyboardHookSource.includes("confirmedAt: now"),
  "manual candidate adoption must record creator confirmation without replacing AI provenance",
);

const passingQuality = normalizeStoryboardAgentQuality({
  score: STORYBOARD_AGENT_QUALITY_THRESHOLD,
  verdict: "pass",
  summary: "达到交付线",
  strengths: ["覆盖完整"],
  issues: [{ severity: "advisory", description: "可在拍摄时微调", suggestion: "现场确认" }],
});
assert.equal(isStoryboardAgentQualityPassing(passingQuality), true);
assert.equal(resolveStoryboardCandidateDisposition(passingQuality, 0), "awaiting_author_adoption");
assert.equal(resolveStoryboardCandidateDisposition(passingQuality, 1), "needs_author_decision");
assert.equal(resolveStoryboardCandidateDisposition(undefined, 0), "needs_author_decision");
assert.equal(storyboardHookSource.includes("autoAdopted"), false, "automatic QA must never mark a candidate as creator-adopted");
assert.match(storyboardHookSource, /awaiting_author_adoption[\s\S]*setReviewCandidateState\(candidate\)/, "a passing candidate must enter the explicit author-review boundary");
assert.equal(shotAgentSource.includes("updateScene("), false, "a Shot Agent result must not write canonical state before author adoption");
assert.equal(visualPromptAgentSource.includes("updateScene("), false, "a prompt Agent result must not write canonical state before author adoption");
assert.match(explicitAdoptionSource, /confirmedAt: now[\s\S]*await updateScene\(/, "only the explicit adoption path may confirm and write a candidate");
assert.equal(normalizeStoryboardAgentQuality({ ...passingQuality, score: 9.5 }).score, 95);
assert.equal(isStoryboardAgentQualityPassing({ ...passingQuality, verdict: "revise", issues: [{ severity: "advisory", description: "可选风格偏好", suggestion: "按导演偏好决定" }] }), true);
assert.equal(isStoryboardAgentQualityPassing({
  ...passingQuality,
  issues: [{ severity: "warning", description: "节奏仍不稳定", suggestion: "重排" }],
}), false);
assert.equal(resolveStoryboardQualityTargetShotId("shot-2", normalizedShots), "shot-2");
assert.equal(resolveStoryboardQualityTargetShotId("SHOT 02", normalizedShots), "shot-2");
assert.equal(resolveStoryboardQualityTargetShotId("镜头2", normalizedShots), undefined);

const boardCandidate = (shotId: string, marker: string) => ({
  shotId,
  strategyDecision: { rationale: marker },
  workflow: { performanceBeat: { summary: marker }, board: { lineArtPrompt: marker } },
}) as StoryboardBoardBatchValue;
const retainedCandidate = boardCandidate("shot-1", "保留完整候选");
const degradedCandidate = boardCandidate("shot-1", "空结构修订");
const candidateScores = new Map([[retainedCandidate, 0], [degradedCandidate, 1_001_000]]);
assert.equal(
  mergeStoryboardBoardBatchValues([retainedCandidate], [degradedCandidate], (value) => candidateScores.get(value) || 0)[0],
  retainedCandidate,
  "a structurally worse repair must not overwrite the better checkpoint",
);
assert.ok(scoreStoryboardBoardIssues([
  { severity: "blocking", code: "blocking", message: "blocking" },
]) > scoreStoryboardBoardIssues(Array.from({ length: 100 }, (_, index) => ({
  severity: "warning" as const,
  code: `warning-${index}`,
  message: "warning",
}))));
assert.ok(
  scoreStoryboardBoardCandidateCompleteness(degradedCandidate)
    > scoreStoryboardBoardCandidateCompleteness({
      ...retainedCandidate,
      strategyDecision: { selectedStrategyId: "storyboard.single_shot_dialogue.v1" },
      workflow: {
        performanceBeat: { summary: "摘要", visibleChange: "变化", startState: "开始", endState: "结束" },
        board: {
          startState: "开始",
          endState: "结束",
          panels: [{ framePurpose: "功能", visualBeat: "变化", subjectAction: "动作", continuityIn: "入口", continuityOut: "出口" }],
        },
      },
    } as StoryboardBoardBatchValue),
  "only genuinely incomplete repair output should be rejected",
);
assert.deepEqual(getIncompleteStoryboardBoardShotIds([], normalizedShots), ["shot-1", "shot-2"]);
const evidenceCandidate = {
  ...retainedCandidate,
  shotId: "shot-1",
  workflow: {
    performanceBeat: { summary: "当前候选事实" },
    board: { panels: [{ shotType: "CU" }] },
  },
} as StoryboardBoardBatchValue;
const unsupportedQuality = normalizeStoryboardBoardQualityWithEvidence({
  value: {
    score: 55,
    verdict: "revise",
    summary: "误报",
    strengths: [],
    issues: [{
      severity: "warning",
      targetShotId: "shot-1",
      description: "候选写了不存在的 MCU",
      suggestion: "修改",
      evidence: [{ path: "/workflow/board/panels/0/shotType", value: "MCU" }],
    }],
  },
  values: [evidenceCandidate],
  shots: normalizedShots,
});
assert.equal(unsupportedQuality.issues[0].severity, "advisory");
assert.equal(unsupportedQuality.score, 90);
const supportedQuality = normalizeStoryboardBoardQualityWithEvidence({
  value: {
    score: 85,
    verdict: "revise",
    summary: "有证据",
    strengths: [],
    issues: [{
      severity: "warning",
      targetShotId: "shot-1",
      description: "候选使用 CU",
      suggestion: "检查",
      evidence: [{ path: "/workflow/board/panels/0/shotType", value: "CU" }],
    }],
  },
  values: [evidenceCandidate],
  shots: normalizedShots,
});
assert.equal(supportedQuality.issues[0].severity, "warning");
assert.equal(supportedQuality.score, 85);

const context = {
  sceneId: "scene-a",
  sceneTitle: "测试场",
  script: "测试剧本事实源",
  targetDurationSeconds: 90,
  productionTeamContext: "已确认部门方案",
  formalAssetContext: "已确认正式资产",
};
const qaPrompt = buildStoryboardShotQualityPrompt({ context, shots: normalizedShots });
assert.ok(qaPrompt.includes("剧本覆盖与事实忠实"));
assert.ok(qaPrompt.includes("90"));
const repairPrompt = buildStoryboardShotRepairPrompt({
  context,
  shots: normalizedShots,
  contractIssues: shortIssues,
  quality: { ...passingQuality, verdict: "revise", score: 82 },
});
assert.equal(repairPrompt.includes("创作者首次确认的生成提示词"), false);
assert.ok(repairPrompt.includes("不得用无叙事功能的空镜凑时长"));
assert.ok(repairPrompt.includes(shortIssues[0].message));
assert.equal(repairPrompt.includes("覆盖完整"), false, "Shot repair must omit QA strengths");
assert.equal(repairPrompt.includes('"score"'), false, "Shot repair must omit QA scoring metadata");

const imagePrompts = normalizeStoryboardImagePrompts(normalizedShots.map((shot) => ({
  id: shot.id,
  visualSummary: `视觉摘要 ${shot.id}`,
  microExpression: "下颌轻收，视线落在道具边缘",
  imagePrompt: "中近景，角色位于画面左侧，桌面道具清晰可见，室内侧光",
})));
const videoPrompts = normalizeStoryboardVideoPrompts(normalizedShots.map((shot) => ({
  id: shot.id,
  videoPrompt: "角色从画面左侧走到桌边，摄影机平稳跟移，角色停下后手掌离开道具",
})));
assert.deepEqual(validateStoryboardImagePromptContract({ prompts: imagePrompts, shots: normalizedShots }), []);
assert.deepEqual(validateStoryboardVideoPromptContract({ prompts: videoPrompts, shots: normalizedShots }), []);
assert.ok(validateStoryboardImagePromptContract({
  prompts: imagePrompts.slice(0, 1),
  shots: normalizedShots,
}).some((issue) => issue.code === "missing_shot"));
assert.ok(validateStoryboardImagePromptContract({
  prompts: imagePrompts.map((prompt, index) => index === 0 ? { ...prompt, imagePrompt: `${prompt.imagePrompt} --ar 16:9` } : prompt),
  shots: normalizedShots,
}).some((issue) => issue.code === "platform_parameter"));
assert.ok(validateStoryboardImagePromptContract({
  prompts: imagePrompts.map((prompt, index) => index === 0 ? { ...prompt, imagePrompt: `${prompt.imagePrompt}，16:9 电影画幅` } : prompt),
  shots: normalizedShots,
}).some((issue) => issue.code === "embedded_aspect_ratio"));
const visualContext = {
  sceneId: context.sceneId,
  sceneTitle: context.sceneTitle,
  script: context.script,
  shots: normalizedShots,
  productionTeamContext: context.productionTeamContext,
  formalAssetContext: context.formalAssetContext,
};
const imageQaPrompt = buildStoryboardImagePromptQualityPrompt({
  context: visualContext,
  candidateShots: normalizedShots.map((shot, index) => ({ ...shot, ...imagePrompts[index] })),
});
const videoQaPrompt = buildStoryboardVideoPromptQualityPrompt({
  context: visualContext,
  candidateShots: normalizedShots.map((shot, index) => ({ ...shot, ...videoPrompts[index] })),
});
assert.ok(imageQaPrompt.includes("图片提示词"));
assert.ok(videoQaPrompt.includes("视频提示词"));
const imageRepairPrompt = buildStoryboardImagePromptRepairPrompt({
  context: visualContext,
  values: imagePrompts,
  contractIssues: [],
  quality: {
    ...passingQuality,
    verdict: "revise",
    score: 86,
    issues: [{ severity: "warning", targetShotId: "shot-1", description: "静帧混入动作过程", suggestion: "固定起始态" }],
  },
});
assert.ok(imageRepairPrompt.includes("只修订本次提示词"));
assert.ok(imageRepairPrompt.includes("不得改写 Shot 结构或另一类提示词"));
assert.equal(imageRepairPrompt.includes("创作者确认的视觉提示词"), false);
assert.ok(imageRepairPrompt.includes("shot-1"));
assert.equal(imageRepairPrompt.includes("shot-2"), false, "repair prompt must not replay unaffected Shot content");
assert.ok(imageRepairPrompt.includes("静帧混入动作过程"));
assert.equal(imageRepairPrompt.includes("覆盖完整"), false, "repair prompt must omit QA strengths");
assert.equal(imageRepairPrompt.includes('"score"'), false, "repair prompt must omit QA scoring metadata");
assert.equal(
  imageRepairPrompt.slice(imageRepairPrompt.indexOf("输出字段：")).includes('"microExpression"'),
  false,
  "image-only repair output must match its schema",
);

const hookSource = fs.readFileSync(new URL("../src/hooks/useStoryboardAI.ts", import.meta.url), "utf8");
assert.ok(hookSource.includes("batchScenes.filter((item) => !item.shotPlanComplete)"), "segment execution must resume from scenes that have not already passed");
assert.ok(hookSource.includes("!item.imagePromptComplete") && hookSource.includes("!item.videoPromptComplete"), "image and video prompt batches must resume independently");
assert.ok(hookSource.includes("已通过质检，仅作连续性参考，不得重做"), "completed scenes must remain continuity context without being regenerated");
assert.ok(hookSource.includes('taskType = action === "qa" ? "qcAnalyzer" : "storyboardGen"'), "visual prompt QA must use the independent review route");

console.log("storyboard shot agent self-check passed");
