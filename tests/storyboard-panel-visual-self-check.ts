import assert from "node:assert/strict";
import fs from "node:fs";

import {
  adoptStoryboardPanelVisualTake,
  approveStoryboardPanelVisualTake,
  buildStoryboardPanelControlStyleContract,
  buildStoryboardPanelVisualPrompt,
  buildStoryboardPanelVisualQAPrompt,
  buildStoryboardPanelVisualSourceHash,
  getStoryboardSceneVisualStyleAnchor,
  isStoryboardPanelVisualQualityPassing,
  isStoryboardPanelVisualReady,
  isStoryboardPanelVisualTakeApproved,
  isStoryboardPanelAspectRatioCompatible,
  selectStoryboardPanelVisualReferences,
} from "../src/services/production/storyboardPanelVisual";
import type { ManualStoryboardBoard, ManualStoryboardBoardPanel, Project, Scene, Shot } from "../src/types/project";
import { AI_CONFIG_SCHEMA_VERSION, normalizeAIConfig } from "../src/config/aiConfigDefaults";

const migratedConfig = normalizeAIConfig({
  schemaVersion: AI_CONFIG_SCHEMA_VERSION,
  models: [
    { id: "manual-gemini-flash", channelId: "default-gemini", alias: "Gemini Flash", modelId: "gemini-flash", capabilities: ["text"] },
    { id: "manual-gemini-pro", channelId: "default-gemini", alias: "Gemini Pro", modelId: "gemini-pro", capabilities: ["text", "vision"] },
  ],
  routing: { scriptGen: "", storyboardGen: "", imageGen: "", videoGen: "", audioGen: "", videoExtraction: "", qcAnalyzer: "", visualQc: "manual-gemini-pro" },
});
assert.deepEqual(migratedConfig.models.find((item) => item.id === "manual-gemini-flash")?.capabilities, ["text"]);
assert.deepEqual(migratedConfig.models.find((item) => item.id === "manual-gemini-pro")?.capabilities, ["text", "vision"]);
assert.equal(migratedConfig.routing.visualQc, "manual-gemini-pro");
assert.equal(migratedConfig.visualQcEnabled, true);
assert.equal(normalizeAIConfig({ visualQcEnabled: false }).visualQcEnabled, false);
assert.equal(isStoryboardPanelAspectRatioCompatible({ width: 1024, height: 1536, targetAspectRatio: "9:16" }), true);
assert.equal(isStoryboardPanelAspectRatioCompatible({ width: 1536, height: 1024, targetAspectRatio: "16:9" }), true);
assert.equal(isStoryboardPanelAspectRatioCompatible({ width: 1024, height: 1536, targetAspectRatio: "16:9" }), false);
assert.equal(isStoryboardPanelAspectRatioCompatible({ width: 1024, height: 1024, targetAspectRatio: "9:16" }), false);

const project = {
  id: "project-visual-board",
  title: "通用测试项目",
  type: "short-drama",
  aspectRatio: "9:16",
  creativeVision: { visualStyle: "克制写实，冷暖光线有明确叙事作用" },
  visualStyleLock: { stylePrompt: "写实电影质感，人物和空间保持稳定" },
  characters: [],
  assets: [],
  episodes: [],
} as unknown as Project;

const shot: Shot = {
  id: "shot-visual-1",
  duration: 8,
  shotSize: "MS",
  cameraAngle: "Eye-Level",
  focalLength: "50mm",
  composition: "角色在左，道具位于中线",
  blocking: "角色向前半步",
  visualAction: "角色把道具推到桌面中央",
  lightingAtmo: "窗外冷光与室内暖光形成对比",
  continuityNote: "保持角色方向和道具位置连续",
  characterIdsInShot: ["character-1"],
  locationId: "location-1",
  propIds: ["prop-1"],
};

const panel: ManualStoryboardBoardPanel = {
  id: "panel-1",
  panelNumber: 1,
  shotId: shot.id,
  durationSeconds: 4,
  framePurpose: "动作起始画格",
  visualBeat: "角色手指刚接触道具",
  subjectAction: "右手从身体一侧伸向桌面",
  blocking: "角色保持画面左侧",
  lightingCue: "暖光照亮手和道具",
  continuityIn: "承接角色站位",
  continuityOut: "道具尚未移动",
  assetRefs: ["character-1", "location-1", "prop-1"],
  annotationLegendIds: [],
  actionArrowLegendIds: [],
  renderInstruction: "电影制作故事板画格，构图与动作清楚",
};

const board: ManualStoryboardBoard = {
  id: "board-1",
  episodeId: "episode-1",
  sceneId: "scene-1",
  shotId: shot.id,
  strategyDecision: {} as ManualStoryboardBoard["strategyDecision"],
  boardMode: "visual-control",
  layout: "single",
  lineArtPrompt: "整板专用提示词不得进入单格执行",
  arrowLegendIds: [],
  performanceBeatIds: [],
  scriptBlockIds: [],
  shotIds: [shot.id],
  strategyOrigin: "built_in",
  panels: [panel],
  startState: "角色尚未触碰道具",
  endState: "角色手指接触道具",
};

const assetBoards = [
  { boardItemId: "character-base", assetId: "character-1", assetName: "角色", assetType: "character", promptHash: "c-base", prompt: "角色基础身份", referenceImageUrl: "https://example.com/character-base.jpg" },
  { boardItemId: "character-variant", assetId: "character-1", assetName: "角色", assetType: "character", variantId: "character-state", variantName: "本场状态", promptHash: "c-state", prompt: "角色本场状态", referenceImageUrl: "https://example.com/character-state.jpg" },
  { boardItemId: "location-base", assetId: "location-1", assetName: "场景", assetType: "location", promptHash: "l-base", prompt: "场景结构", referenceImageUrl: "https://example.com/location.jpg" },
  { boardItemId: "prop-base", assetId: "prop-1", assetName: "道具", assetType: "prop", promptHash: "p-base", prompt: "道具结构", referenceImageUrl: "https://example.com/prop.jpg" },
] as any[];

const selection = selectStoryboardPanelVisualReferences({ panel, shot, assets: { assetBoards } as any });
assert.equal(selection.selected[0].boardItemId, "character-variant");
assert.equal(selection.selected.length, 4);
assert.deepEqual(selection.missingAssetIds, []);

const anchorTake = {
  id: "take-anchor",
  imageUrl: "https://example.com/storyboard-anchor.jpg",
  sourceHash: "anchor-source",
  prompt: "anchor",
  promptHash: "anchor-prompt",
  modelId: "image-model",
  selectedSkillIds: [],
  selectedSkillTitles: [],
  selectedContextIds: [],
  selectedAssetBoardItemIds: [],
  referenceImageUrls: [],
  attempt: 1,
  status: "adopted" as const,
  review: { mode: "manual" as const, status: "approved" as const, reviewedAt: 1 },
  executions: [],
  createdAt: 1,
};
const anchorScene = {
  id: "scene-anchor",
  manualStoryboard: { boards: [{ unitSchema: "storyboard_unit.v1", board: { panels: [
    { ...panel, id: "panel-anchor", visualTakes: [anchorTake], activeVisualTakeId: anchorTake.id },
    { ...panel, id: "panel-secondary", visualTakes: [{ ...anchorTake, id: "take-secondary" }], activeVisualTakeId: "take-secondary" },
  ] } }] },
} as unknown as Scene;
assert.equal(getStoryboardSceneVisualStyleAnchor(anchorScene)?.takeId, anchorTake.id);
assert.equal(getStoryboardSceneVisualStyleAnchor(anchorScene, "panel-anchor"), undefined);
assert.equal(getStoryboardSceneVisualStyleAnchor(anchorScene, "panel-secondary")?.takeId, anchorTake.id);
const anchoredSelection = selectStoryboardPanelVisualReferences({ panel, shot, assets: { assetBoards } as any, scene: anchorScene });
assert.equal(anchoredSelection.styleAnchor?.takeId, anchorTake.id);
assert.equal(anchoredSelection.selected.length, 4);

const prompt = buildStoryboardPanelVisualPrompt({ project, shot, board, panel, references: selection.selected });
assert.ok(prompt.includes("动作起始画格"));
assert.ok(prompt.includes("正式资产"));
assert.ok(prompt.includes("不是照片、最终成片帧或概念效果图"));
assert.ok(prompt.includes("全部 panel 必须保持同一绘制语言"));
assert.ok(prompt.includes("固定耳饰、疤痕、痣、发型和服装细节"));
assert.ok(prompt.includes("禁止因对白、视线或构图提及而把道具塞进人物手中、复制或迁移"));
assert.ok(prompt.includes("静态或“无”必须完全无箭头"));
assert.ok(prompt.includes("禁止额外的局部放大框"));
assert.ok(prompt.includes("不得仅因带引号或包含数字而删除"));
assert.equal(prompt.includes("画格编号：1"), false);
assert.equal(prompt.includes(board.lineArtPrompt), false, "single-panel image prompts must not replay the whole-board prompt");
assert.ok(!prompt.includes(String(shot.id)), "provider prompt must not expose the Shot database id");
assert.ok(buildStoryboardPanelControlStyleContract({ project, board }).includes("线稿故事板能力槽"));
const anchoredPrompt = buildStoryboardPanelVisualPrompt({ project, shot, board, panel, references: anchoredSelection.selected, styleAnchor: anchoredSelection.styleAnchor });
assert.equal(anchoredPrompt.includes("参考图前"), false, "provider reference numbering belongs to the structured manifest");
assert.equal(anchoredPrompt.includes("最后 1 张"), false, "style reference duties belong to the structured manifest");
const anchoredQAPrompt = buildStoryboardPanelVisualQAPrompt({ project, shot, panel, references: anchoredSelection.selected, styleAnchor: anchoredSelection.styleAnchor });
assert.ok(anchoredQAPrompt.includes('"imageIndex":2'));
assert.ok(anchoredQAPrompt.includes(`【输入图${anchoredSelection.selected.length + 2}职责】`));
assert.equal(anchoredQAPrompt.includes(String(shot.id)), false);
assert.equal(anchoredQAPrompt.includes(String(panel.id)), false);
assert.equal(anchoredQAPrompt.includes("boardItemId"), false);
assert.equal(anchoredQAPrompt.includes("assetId"), false);

const sourceHash = buildStoryboardPanelVisualSourceHash({ storyboardSourceHash: "storyboard-source", boardOutputHash: "board-output", panel, project, references: selection.selected });
const changedSourceHash = buildStoryboardPanelVisualSourceHash({ storyboardSourceHash: "storyboard-source", boardOutputHash: "board-output", panel: { ...panel, visualBeat: "角色已经推动道具" }, project, references: selection.selected });
assert.notEqual(sourceHash, changedSourceHash);
assert.notEqual(sourceHash, buildStoryboardPanelVisualSourceHash({ storyboardSourceHash: "storyboard-source", boardOutputHash: "board-output", panel, project: { ...project, aspectRatio: "16:9" }, references: selection.selected }));
assert.notEqual(sourceHash, buildStoryboardPanelVisualSourceHash({ storyboardSourceHash: "storyboard-source", boardOutputHash: "board-output", panel, project, references: selection.selected.map((item, index) => index ? item : { ...item, referenceImageUrl: "https://example.com/character-state-v2.jpg" }) }));
assert.notEqual(sourceHash, buildStoryboardPanelVisualSourceHash({ storyboardSourceHash: "storyboard-source", boardOutputHash: "board-output", panel, project, references: selection.selected, styleAnchor: anchoredSelection.styleAnchor }));

const take = {
  id: "take-1",
  imageUrl: "https://example.com/panel.jpg",
  sourceHash,
  prompt,
  promptHash: "prompt-hash",
  modelId: "image-model",
  selectedSkillIds: [],
  selectedSkillTitles: [],
  selectedContextIds: [],
  selectedAssetBoardItemIds: selection.selected.map((item) => item.boardItemId),
  referenceImageUrls: selection.selected.map((item) => item.referenceImageUrl!),
  attempt: 1,
  status: "candidate" as const,
  quality: { score: 94, verdict: "pass" as const, summary: "一致", strengths: ["构图清楚"], issues: [] },
  executions: [],
  createdAt: 1,
};
assert.equal(isStoryboardPanelVisualQualityPassing(take.quality), true);
const adopted = adoptStoryboardPanelVisualTake({ panel, take, adoptedAt: 2 });
assert.equal(adopted.activeVisualTakeId, take.id);
assert.equal(isStoryboardPanelVisualReady({ panel: adopted, sourceHash }), true);
assert.equal(isStoryboardPanelVisualReady({ panel: adopted, sourceHash: "changed" }), false);

const manualCandidate = {
  ...take,
  id: "take-manual",
  quality: undefined,
  review: { mode: "manual" as const, status: "pending" as const },
};
assert.equal(isStoryboardPanelVisualTakeApproved(manualCandidate), false);
const manuallyAdopted = approveStoryboardPanelVisualTake({
  panel: { ...panel, visualTakes: [manualCandidate] },
  takeId: manualCandidate.id,
  reviewedAt: 3,
});
assert.equal(manuallyAdopted.activeVisualTakeId, manualCandidate.id);
assert.equal(isStoryboardPanelVisualReady({ panel: manuallyAdopted, sourceHash }), true);
assert.equal(manuallyAdopted.visualTakes?.find((item) => item.id === manualCandidate.id)?.quality, undefined);

const manualStoryboardHookSource = fs.readFileSync(new URL("../src/hooks/useManualVideoStoryboard.ts", import.meta.url), "utf8");
assert.ok(manualStoryboardHookSource.includes("selectStoryboardPanelVisualReferences({ panel, shot, assets, scene })"));
assert.ok(manualStoryboardHookSource.includes("styleAnchor: referenceSelection.styleAnchor"));
const storyboardReadModelSource = fs.readFileSync(new URL("../src/services/production/manualVideoStoryboard.ts", import.meta.url), "utf8");
assert.ok(storyboardReadModelSource.includes("selectStoryboardPanelVisualReferences({ panel, shot, assets, scene })"));
assert.ok(storyboardReadModelSource.includes("styleAnchor: referenceSelection?.styleAnchor"));
const storyboardBatchHookSource = fs.readFileSync(new URL("../src/hooks/useStoryboardBoardBatchAgent.ts", import.meta.url), "utf8");
assert.ok(storyboardBatchHookSource.includes("previousBoardTake?.imageUrl"));
assert.ok(storyboardBatchHookSource.includes("referenceSelection.selected.map((item) => item.referenceImageUrl!)"));

console.log("Storyboard panel visual self-check passed.");
