import assert from "node:assert/strict";

import {
  buildMiniMaxH3PromptAuthoringRequest,
  parseMiniMaxH3PromptAuthoringResult,
} from "../src/services/production/minimaxH3PromptAuthoring";
import { resolveVideoModelAdapter } from "../packages/production/src/services/production/videoModelAdapterRegistry";
import type { VideoGenerationIntent } from "../packages/production/src/services/production/videoGenerationIntent";

const intent: VideoGenerationIntent = {
  schemaVersion: "video-generation-intent.v1",
  id: "prompt-authoring",
  projectId: "project",
  episodeId: "episode",
  sceneId: "scene",
  videoGenerationUnitId: "unit",
  storyboardBoardId: "board",
  shotIds: ["shot-1", "shot-2"],
  durationSeconds: 6,
  aspectRatio: "16:9",
  startState: "人物站在柜台前",
  endState: "人物递出纸带",
  directorIntent: "A restrained two-shot rainy-night bakery scene.",
  timelineBeats: [
    { id: "beat-1", shotId: "shot-1", startSeconds: 0, endSeconds: 2.5, visibleAction: "The clerk looks up.", performance: "Restrained concern.", camera: "medium shot", soundCues: ["rain"], continuityIn: "rainy room tone", continuityOut: "the clerk faces the visitor" },
    { id: "beat-2", shotId: "shot-2", startSeconds: 2.5, endSeconds: 6, visibleAction: "The visitor passes a paper strip.", performance: "A careful handoff.", camera: "close-up", dialogue: "请替我保管。", speakerCharacterId: "visitor", soundCues: ["paper rustle"], continuityIn: "the clerk faces the visitor", continuityOut: "the paper strip changes hands" },
  ],
  referenceBindings: [
    { id: "visitor-board", sourceType: "character_board", sourceAssetId: "visitor", semanticEntityId: "visitor", mediaUrl: "https://example.com/visitor.png", displayName: "访客", description: "dark wet coat and tired face", purpose: "identity", preservation: "required", required: true, priority: 100 },
    { id: "bakery-board", sourceType: "scene_board", sourceAssetId: "bakery", semanticEntityId: "bakery", mediaUrl: "https://example.com/bakery.png", displayName: "雨夜面包店", description: "warm counter and rainy windows", purpose: "environment", preservation: "required", required: true, priority: 90 },
  ],
  audioPolicy: { mode: "provider_native" },
  sourceHash: "source",
};

const adapter = resolveVideoModelAdapter({ channelType: "minimax", modelId: "MiniMax-H3" });
const plan = adapter.compile({ intent, modelConfigId: "h3" });
assert.equal(plan.issues.filter((issue) => issue.severity === "blocking").length, 0);

const request = buildMiniMaxH3PromptAuthoringRequest({
  baselinePrompt: plan.adapterPrompt,
  currentPrompt: plan.adapterPrompt,
  creativePrompt: intent.directorIntent,
  references: plan.referenceManifest.map((entry) => ({
    label: entry.providerLabel,
    providerLabel: entry.providerLabel,
    name: entry.displayName || entry.sourceAssetId,
    relationship: entry.description || entry.purpose,
    mediaKind: entry.mediaKind,
  })),
  timeline: plan.timelinePlan.map((beat, index) => ({
    label: `镜头 ${index + 1}`,
    time: `${beat.startSeconds}-${beat.endSeconds}`,
    action: beat.visibleAction,
    camera: beat.camera,
    dialogue: beat.dialogue,
    sound: beat.soundCues.join("; "),
  })),
});
assert.match(request.systemInstruction, /Never invent, remove, renumber, or reassign/);
assert.match(request.prompt, /AUTHORITATIVE REFERENCE FACTS/);
assert.match(request.prompt, /DETERMINISTIC H3 BASELINE/);

const valid = parseMiniMaxH3PromptAuthoringResult(JSON.stringify({ modelPrompt: plan.adapterPrompt, warnings: [] }), plan);
assert.equal(valid.modelPrompt, plan.adapterPrompt);
assert.throws(
  () => parseMiniMaxH3PromptAuthoringResult(JSON.stringify({ modelPrompt: plan.adapterPrompt.replace("[Shot 2] At 00:02.500", "[Shot 2] At 00:03.000"), warnings: [] }), plan),
  /镜头顺序或切换时间/,
);
assert.throws(() => parseMiniMaxH3PromptAuthoringResult("not-json", plan), /不是有效数据/);

console.log("MiniMax H3 prompt authoring self-check passed.");
