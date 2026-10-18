import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { VisualLocalOverride } from "../packages/domain/src/visualOverride";
import type { Shot } from "../src/types/project";

import {
  comfyUIImageDimensionsForAspectRatio,
  compileImageGenerationRequest,
  createImageGenerationReference,
  createPreviousOutputRepairOperation,
  doubaoImageSizeForAspectRatio,
  openAIImageSizeForAspectRatio,
} from "../src/services/production/imageGenerationRequest";
import {
  buildImageVisualStyleProjection,
  resolveImageVisualStyleProjectionContext,
  resolveManualStudioImageVisualArtifactIntent,
  resolveManualStudioTargetShotOverride,
} from "../src/services/production/imageVisualStyleProjection";
import {
  buildProductionAssetBoardCanonicalReference,
  buildProductionAssetBoardPreviousOutputRepairOperation,
} from "../src/services/production/productionAssetBoardVisual";
import {
  adoptShotTake,
  appendShotTakeCandidate,
} from "../src/services/production/shotTakeReview";
import {
  composePromptBlocks,
  markPromptBlocksDuplicatedByManifest,
  promptBlocksFromText,
} from "../src/services/production/promptComposition";
import {
  compileVideoProviderPrompt,
  resolveVisualPromptLanguageProfile,
} from "../src/services/production/visualPromptLanguageProfile";
import { formatVisualCreativeVision } from "../src/utils/projectUtils";
import { buildAssetImagePrompt } from "../src/services/production/assetImagePrompt";
import { buildMiniMaxH3PromptAuthoringRequest } from "../src/services/production/minimaxH3PromptAuthoring";
import { buildStoryboardBoardBatchPrompt } from "../src/services/production/storyboardBoardAgent";

const references = [
  createImageGenerationReference({ imageUrl: "https://example.com/lin.png", label: "林岚", role: "character_identity" }),
  createImageGenerationReference({ imageUrl: "https://example.com/coat.png", label: "林岚雨衣状态", role: "wardrobe_state" }),
  createImageGenerationReference({ imageUrl: "https://example.com/alley.png", label: "雨巷", role: "location_design" }),
  createImageGenerationReference({ imageUrl: "https://example.com/key.png", label: "铜钥匙", role: "prop_design" }),
];

const compiled = compileImageGenerationRequest({
  promptCore: "林岚站在雨巷入口，右手握住铜钥匙，中景，路灯从画面左侧照入。",
  aspectRatio: "16:9",
  references,
});
const golden = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/fixtures/image-prompt-manifest.golden.json"), "utf8")) as {
  referenceOrder: string[];
  requiredSections: string[];
  forbiddenTokens: string[];
};

assert.deepEqual(compiled.referenceImages, references.map((reference) => reference.imageUrl));
assert.deepEqual(compiled.references.map((reference) => reference.role), golden.referenceOrder);
golden.requiredSections.forEach((section) => assert.ok(compiled.providerPrompt.includes(section), `golden section missing: ${section}`));
golden.forbiddenTokens.forEach((token) => assert.ok(!compiled.providerPrompt.includes(token), `golden forbidden token present: ${token}`));
assert.match(compiled.providerPrompt, /Image 1（参考图 1）：林岚\n- 职责：角色身份/);
assert.match(compiled.providerPrompt, /Image 2（参考图 2）：林岚雨衣状态\n- 职责：服装与造型状态/);
assert.match(compiled.providerPrompt, /Image 3（参考图 3）：雨巷\n- 职责：场景空间与材质/);
assert.match(compiled.providerPrompt, /Image 4（参考图 4）：铜钥匙\n- 职责：道具几何与材质/);
assert.match(compiled.providerPrompt, /【多参考图组合关系】/);
assert.match(compiled.providerPrompt, /必须保留：/);
assert.match(compiled.providerPrompt, /允许改变：/);
assert.match(compiled.providerPrompt, /禁止复制或引入：/);
assert.match(createImageGenerationReference({ imageUrl: "https://example.com/edit.png", label: "服装修订源图", role: "source_edit" }).preserve.join("；"), /精确颜色/);
assert.doesNotMatch(compiled.providerPrompt, /--ar|MBTI|心理档案|九型人格|数据库|hash/i);
assert.match(compiled.providerPrompt, /除指定的分格、分区或控制线外/);
assert.doesNotMatch(compiled.providerPrompt, /不包含 UI、边框、文字、字幕、水印或排版/);
assert.equal(openAIImageSizeForAspectRatio("9:16"), "1024x1536");
assert.equal(openAIImageSizeForAspectRatio("16:9"), "1536x1024");
assert.equal(doubaoImageSizeForAspectRatio("3:4"), "1536x2048");
assert.deepEqual(comfyUIImageDimensionsForAspectRatio("9:16"), { width: 576, height: 1024 });

const reordered = compileImageGenerationRequest({
  promptCore: "保持人物和场景身份，改变机位。",
  references: [references[2], references[0]],
});
assert.match(reordered.providerPrompt, /Image 1（参考图 1）：雨巷/);
assert.match(reordered.providerPrompt, /Image 2（参考图 2）：林岚/);
assert.deepEqual(reordered.referenceImages, [references[2].imageUrl, references[0].imageUrl]);

const projected = compileImageGenerationRequest({
  promptCore: "同一角色站在空场景中央，保持中性身份展示。",
  visualStyleProjection: {
    artifactIntent: "asset_identity",
    recipeId: "visual.asset-identity",
    recipeVersion: "v1",
    instruction: "二维逐帧动画；清晰轮廓、统一线条和有限色阶，身份板不使用电影颗粒或景深。",
    sourceRevision: "style-r3",
  },
});
assert.match(projected.providerPrompt, /【视觉风格】/);
assert.match(projected.providerPrompt, /二维逐帧动画/);
assert.equal(projected.manifest.blocks.find((block) => block.blockId === "image.visual_style")?.included, true);
assert.equal(projected.visualStyleProjection?.sourceRevision, "style-r3");

const sourceEditReference = createImageGenerationReference({
  imageUrl: "https://example.com/source-edit.png",
  label: "已采用画格",
  role: "source_edit",
});
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "普通重生成不得伪装成局部编辑。",
    references: [sourceEditReference],
  }),
  /普通图片生成不能把参考图标记为 source_edit/,
);
const surgicalEdit = compileImageGenerationRequest({
  promptCore: "只修正角色右袖口的破损边缘。",
  references: [sourceEditReference],
  operation: {
    kind: "edit",
    goal: "修复右袖口边缘",
    change: ["将右袖口破损边缘恢复为连续缝线"],
    fill: ["缺口由与原服装一致的布料纹理和缝线填补"],
    preserve: ["人物脸、姿态、服装其余部分、背景、构图和全部已有光影"],
  },
});
assert.match(surgicalEdit.providerPrompt, /CHANGE:/);
assert.match(surgicalEdit.providerPrompt, /FILL \/ RECONSTRUCT:/);
assert.match(surgicalEdit.providerPrompt, /PRESERVE EXACTLY:/);
assert.match(surgicalEdit.providerPrompt, /人物脸、姿态/);
assert.equal(surgicalEdit.operation.kind, "edit");
assert.match(surgicalEdit.providerPrompt, /EXCLUDE:/);
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "只修正袖口。",
    operation: { kind: "edit", goal: "修袖口", change: ["修正袖口"] },
  }),
  /必须通过结构化 references 提供 source_edit/,
);

const explicitConflictSource = createImageGenerationReference({
  imageUrl: "https://example.com/conflict-source.png",
  label: "冲突检测源图",
  role: "source_edit",
  preserve: ["人物脸"],
  allowChange: ["右袖口"],
  exclude: ["额外人物"],
});
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "对源图执行边界明确的局部编辑。",
    references: [explicitConflictSource],
    operation: {
      kind: "edit",
      goal: "测试冲突拒绝",
      change: ["人物脸。"],
    },
  }),
  /合同冲突：CHANGE 与 PRESERVE.*人物脸/,
);
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "对源图执行边界明确的局部编辑。",
    references: [explicitConflictSource],
    operation: {
      kind: "edit",
      goal: "测试重建冲突拒绝",
      change: ["右袖口"],
      fill: ["额外人物"],
    },
  }),
  /合同冲突：FILL 与 EXCLUDE.*额外人物/,
);
const similarButCompatibleContract = compileImageGenerationRequest({
  promptCore: "只调整人物神情，不改变身份。",
  references: [explicitConflictSource],
  operation: {
    kind: "edit",
    goal: "收紧眉眼神情",
    change: ["调整人物脸部表情"],
    preserve: ["人物脸型和身份"],
  },
});
assert.match(similarButCompatibleContract.providerPrompt, /调整人物脸部表情/);

const previousOutputRepair = createPreviousOutputRepairOperation({
  goal: "只修复上一版的质检问题",
  issues: ["右袖口边缘断裂", "背景多出一名人物"],
  preserve: ["人物身份、姿态、构图与已经正确的光影"],
  exclude: ["质检点之外的重绘", "新文字、UI与水印"],
});
assert.deepEqual(previousOutputRepair.change, ["右袖口边缘断裂", "背景多出一名人物"]);
assert.equal(previousOutputRepair.kind, "edit");
const compiledPreviousOutputRepair = compileImageGenerationRequest({
  promptCore: "根据结构化返修合同修复上一版画面。",
  references: [createImageGenerationReference({
    imageUrl: "https://example.com/previous-output.png",
    label: "上一版待修复结果",
    role: "previous_output_repair",
  })],
  operation: previousOutputRepair,
});
assert.match(compiledPreviousOutputRepair.providerPrompt, /CHANGE:\n- 右袖口边缘断裂/);
assert.match(compiledPreviousOutputRepair.providerPrompt, /EXCLUDE:\n- 质检点之外的重绘/);
assert.throws(
  () => createPreviousOutputRepairOperation({
    goal: "返修",
    issues: [],
    preserve: ["构图"],
    exclude: ["额外文字"],
  }),
  /repair issues/,
);

const assetBoardFixture = {
  assetName: "林岚",
  assetType: "character",
  variantId: "rain-state",
  variantName: "雨夜状态",
} as never;
const canonicalAssetReference = buildProductionAssetBoardCanonicalReference({
  board: assetBoardFixture,
  imageUrl: "https://example.com/canonical-character.png",
});
assert.equal(canonicalAssetReference.role, "character_identity");
assert.notEqual(canonicalAssetReference.role, "source_edit");
assert.match(canonicalAssetReference.allowChange.join("；"), /本次目标声明改变状态/);
const assetRepairOperation = buildProductionAssetBoardPreviousOutputRepairOperation({
  board: assetBoardFixture,
  issues: ["背面视图缺失"],
});
assert.equal(assetRepairOperation.kind, "edit");
assert.deepEqual(assetRepairOperation.change, ["背面视图缺失"]);
assert.ok(assetRepairOperation.preserve?.length);
assert.ok(assetRepairOperation.exclude?.length);

const projectionContext = resolveImageVisualStyleProjectionContext({
  project: {
    title: "万类同盟",
    characters: [{ id: "character-lin", name: "林岚" }],
    assets: [
      { id: "location-alley", type: "location", name: "雨巷" },
      { id: "prop-key", type: "prop", name: "铜钥匙" },
      { id: "unused-prop", type: "prop", name: "未入镜道具" },
    ],
    visualStyleLock: {
      mediumAssignments: [
        { id: "whole-base", target: { scope: "whole" } },
        { id: "lin-overlay", target: { scope: "entity", entityType: "character", entityId: "character-lin" } },
        { id: "alley-layer", target: { scope: "entity", entityType: "location", entityId: "location-alley" } },
        { id: "mist-layer", target: { scope: "layer", layerId: "layer-mist", label: "巷口薄雾", description: "覆盖巷口前景与地面的低位体积雾" } },
      ],
    },
  } as never,
  shots: [{
    characterIdsInShot: ["character-lin"],
    locationId: "location-alley",
    propIds: ["prop-key"],
    activeVisualLayerIds: ["layer-mist"],
  }],
});
assert.deepEqual(projectionContext.targets, [
  { entityType: "character", entityId: "character-lin" },
  { entityType: "location", entityId: "location-alley" },
  { entityType: "prop", entityId: "prop-key" },
  { layerId: "layer-mist" },
]);
assert.equal(projectionContext.assignmentTargetLabels["lin-overlay"], "角色“林岚”");
assert.equal(projectionContext.assignmentTargetLabels["alley-layer"], "场景“雨巷”");
assert.doesNotMatch(Object.values(projectionContext.assignmentTargetLabels).join("\n"), /character-lin|location-alley|layer-mist/);

const previewIntent = resolveManualStudioImageVisualArtifactIntent(true);
const previewProjection = buildImageVisualStyleProjection({
  project: { visualStyleLock: undefined },
  intent: previewIntent,
  targets: [],
});
assert.equal(previewProjection.artifactIntent, "direction_preview");
assert.equal(previewProjection.compileManifest?.intent, "direction_preview");
const previewCompiled = compileImageGenerationRequest({
  promptCore: "生成当前 Shot 的临时导演预览。",
  visualStyleProjection: previewProjection,
});
assert.equal(previewCompiled.providerPrompt.match(/【视觉风格】/g)?.length, 1);
assert.equal(resolveManualStudioImageVisualArtifactIntent(false), "final_frame");

const longAuthoredPrompt = `精确保留作者提供的可见事实。${"场景中的结构化可见细节保持清晰。".repeat(180)}`;
assert.ok(compileImageGenerationRequest({ promptCore: longAuthoredPrompt }).providerPrompt.includes(longAuthoredPrompt));
assert.doesNotMatch(compileImageGenerationRequest({ promptCore: "主体居中并保持轴线清晰。" }).providerPrompt, /rule of thirds|三分法/i);

const exactText = compileImageGenerationRequest({
  promptCore: "旧车站入口的实体搪瓷站牌。",
  visibleText: [{
    text: "此地不通",
    placement: "站牌正中央，单行横排",
    treatment: "褪色红漆手写体，清晰可辨",
    language: "简体中文",
  }],
});
assert.match(exactText.providerPrompt, /TEXT TO RENDER EXACTLY:/);
assert.match(exactText.providerPrompt, /"此地不通"/);
assert.match(exactText.providerPrompt, /Do not translate, paraphrase, autocorrect/);
assert.match(exactText.providerPrompt, /只允许渲染精确文字合同中声明的文字/);
assert.equal(exactText.visibleText[0]?.text, "此地不通");
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "旧车站入口的站牌。",
    visibleText: [{ text: " ", placement: "入口上方" }],
  }),
  /缺少 text/,
);

assert.throws(
  () => compileImageGenerationRequest({ promptCore: "portrait --ar 16:9" }),
  /画幅必须通过结构化 aspectRatio/,
);
assert.throws(
  () => compileImageGenerationRequest({ promptCore: "vertical portrait framing", aspectRatio: "16:9" }),
  /结构化画幅 16:9 冲突/,
);
assert.throws(
  () => compileImageGenerationRequest({ promptCore: "电影构图，16:9 横向画幅", aspectRatio: "16:9" }),
  /只通过结构化 aspectRatio/,
);
assert.throws(
  () => compileImageGenerationRequest({ promptCore: "角色 MBTI 为 INTJ，数据库 ID=42" }),
  /非画面元数据/,
);
assert.throws(
  () => compileImageGenerationRequest({ promptCore: "生成雨夜镜头", aspectRatio: "2:1" as any }),
  /不支持画幅/,
);
assert.throws(
  () => compileImageGenerationRequest({ promptCore: "生成雨夜镜头", outputConstraints: ["保留 DB ID"] }),
  /非画面元数据/,
);
assert.throws(
  () => compileImageGenerationRequest({ promptCore: "参考图地址 https://example.com/identity.png" }),
  /结构化 references/,
);
assert.throws(
  () => compileImageGenerationRequest({
    promptCore: "生成雨夜镜头",
    references: [references[0], { ...references[1], imageUrl: references[0].imageUrl }],
  }),
  /重复使用同一 imageUrl/,
);

const dedupedVideoPrompt = compileVideoProviderPrompt({
  authorPrompt: "6秒，镜头缓慢向前推进，林岚推开铁门。",
  profile: resolveVisualPromptLanguageProfile({ providerId: "kie", modelId: "grok-imagine-video-1-5-preview" }),
  providerType: "kie_grok",
  motionContract: {
    cameraMotion: "缓慢向前推进",
    subjectMotion: "林岚推开铁门",
    durationSeconds: 6,
  },
});
assert.equal(dedupedVideoPrompt.finalProviderPrompt.match(/缓慢向前推进/g)?.length, 1);
assert.equal(dedupedVideoPrompt.finalProviderPrompt.match(/林岚推开铁门/g)?.length, 1);
assert.equal(dedupedVideoPrompt.finalProviderPrompt.match(/6\s*(?:s|秒)/gi)?.length, 1);
assert.equal(dedupedVideoPrompt.manifest.blocks.find((block) => block.blockId === "video.task")?.included, true);

const h3AuthoringRequest = buildMiniMaxH3PromptAuthoringRequest({
  baselinePrompt: "[Shot 1] At 00:00.000 镜头推进",
  currentPrompt: "[Shot 1] At 00:00.000 镜头推进",
  creativePrompt: "镜头推进时保持人物身份。",
  userIntent: "镜头推进时保持人物身份。",
  references: [],
  timeline: [],
});
assert.equal(h3AuthoringRequest.prompt.match(/镜头推进时保持人物身份。/g)?.length, 1);
assert.doesNotMatch(h3AuthoringRequest.prompt, /AUTHOR'S EXTRA DIRECTION/);

const composition = composePromptBlocks([
  { blockId: "task", source: "test", purpose: "task", content: "生成一场雨戏", required: true },
  { blockId: "empty", source: "test", purpose: "empty", content: "未设置" },
  { blockId: "duplicate", source: "test", purpose: "duplicate", content: "生成一场雨戏" },
]);
assert.equal(composition.prompt, "生成一场雨戏");
assert.equal(composition.manifest.blocks.find((block) => block.blockId === "empty")?.omissionReason, "empty_placeholder");
assert.equal(composition.manifest.blocks.find((block) => block.blockId === "duplicate")?.duplicateOf, "task");

const systemOnly = composePromptBlocks([
  { blockId: "system.task", source: "test", purpose: "system task", content: "只检查当前场。" },
]);
const crossRoleDuplicate = composePromptBlocks(markPromptBlocksDuplicatedByManifest([
  { blockId: "user.task", source: "test", purpose: "user task", content: "只检查当前场。", required: true },
], systemOnly.manifest));
assert.equal(crossRoleDuplicate.prompt, "");
assert.equal(crossRoleDuplicate.manifest.blocks[0].duplicateOf, "system.task");

const requiredPlaceholder = composePromptBlocks([
  { blockId: "required", source: "test", purpose: "task", content: "【任务】\n暂无", required: true },
]);
assert.ok(requiredPlaceholder.manifest.issues.some((issue) => issue.code === "EMPTY_REQUIRED_BLOCK"));

const decomposed = composePromptBlocks(promptBlocksFromText({
  prompt: "【任务】\n生成雨夜追逐\n\n【可选资料】\n未设置\n\n【输出】\n只返回 JSON",
}));
assert.match(decomposed.prompt, /生成雨夜追逐/);
assert.match(decomposed.prompt, /只返回 JSON/);
assert.doesNotMatch(decomposed.prompt, /未设置/);
const mixedPlaceholderLines = composePromptBlocks(promptBlocksFromText({
  prompt: "【场景】\n空间：仓库\n时间：未设置\n状态：暂无\n\n【任务】\n生成可拍动作",
}));
assert.match(mixedPlaceholderLines.prompt, /空间：仓库/);
assert.doesNotMatch(mixedPlaceholderLines.prompt, /时间：未设置|状态：暂无/);


const visualVision = formatVisualCreativeVision({
  visualStyle: "克制写实",
  want: "证明自己",
  need: "学会信任",
  stakes: "失去家园",
  globalLook: { baseTexture: ["自然皮肤纹理"], colorGrading: ["冷暖分区"] },
});
assert.match(visualVision, /克制写实|自然皮肤纹理|冷暖分区/);
assert.doesNotMatch(visualVision, /证明自己|学会信任|失去家园|Want|Need|Stakes/);
const assetPrompt = buildAssetImagePrompt({
  assetType: "character",
  assetName: "林岚",
  description: "短发，灰色雨衣",
  visualStyle: visualVision,
  variantDescription: "待补全",
});
assert.match(assetPrompt, /短发，灰色雨衣/);
assert.doesNotMatch(assetPrompt, /待补全|高品质|细节丰富|心理/);

const scopedBoardPrompt = buildStoryboardBoardBatchPrompt({
  confirmedPrompt: [
    "你负责建立故事板。",
    "【已确认策略】\n包含其他场次的策略摘要。",
    "【当前视频单元/已确认 Shot】\nother-scene-script",
    "【已确认制片筹备结果】\nother-scene-department",
    "【当前场景正式资产与参考图】\nother-scene-assets",
    "【作者补充意见】\n保持克制表演。",
  ].join("\n\n"),
  sceneContext: { id: "scene-current", title: "当前场", script: "current-scene-script" },
  shots: [{ id: "shot-current", visualAction: "角色推门" } as any],
  filmTeamContext: "current-scene-department",
  assetContext: "current-scene-assets",
});
assert.match(scopedBoardPrompt, /current-scene-script/);
assert.match(scopedBoardPrompt, /current-scene-department/);
assert.match(scopedBoardPrompt, /current-scene-assets/);
assert.match(scopedBoardPrompt, /保持克制表演/);
assert.doesNotMatch(scopedBoardPrompt, /other-scene-script|other-scene-department|other-scene-assets/);

const root = process.cwd();
const sourceFiles = [
  "src/hooks/useProductionAssetBoardImage.ts",
  "src/hooks/useProductionAssetBoardBatch.ts",
  "src/hooks/useManualProductionAssetImages.ts",
  "src/hooks/useStoryboardBoardBatchAgent.ts",
  "src/hooks/useStoryboardAI.ts",
  "src/hooks/useStudioAI.ts",
  "src/hooks/useManualStudioAI.ts",
  "src/hooks/useBibleAI.ts",
  "src/components/bible/AssetDetailView.tsx",
  "src/pages/ImageGen.tsx",
  "tests/manual-shot-image-sample.ts",
];
for (const relativePath of sourceFiles) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const calls = source.split("generateAIImage(").slice(1);
  calls.forEach((call, index) => {
    const requestHead = call.slice(0, call.indexOf("});") + 3);
    assert.match(requestHead, /promptCore\s*:/, `${relativePath} image call ${index + 1} must use promptCore`);
    assert.match(requestHead, /aspectRatio\s*(?::|,)/, `${relativePath} image call ${index + 1} must use structured aspectRatio`);
    assert.doesNotMatch(requestHead, /referenceImages\s*:/, `${relativePath} image call ${index + 1} must not pass naked URL arrays`);
  });
}

const imageTemplate = fs.readFileSync(path.join(root, "src/config/prompts/visuals.ts"), "utf8")
  .match(/'generateImage':\s*\{[\s\S]*?\n\s*\},\n\s*'generateVideo'/)?.[0] || "";
assert.ok(imageTemplate);
assert.doesNotMatch(imageTemplate, /\{\{(?:assetDescriptions|interactiveProductionContext|selectedContext|skills|globalParams|userIntent)\}\}/);
const videoTemplate = fs.readFileSync(path.join(root, "src/config/prompts/visuals.ts"), "utf8")
  .match(/'generateVideo':\s*\{[\s\S]*?\n\s*\},\n\s*'generateSpecificPrompt'/)?.[0] || "";
assert.ok(videoTemplate);
assert.doesNotMatch(videoTemplate, /\{\{(?:assetDescriptions|interactiveProductionContext|selectedContext|skills|globalParams)\}\}/);

const manualStudio = fs.readFileSync(path.join(root, "src/hooks/useManualStudioAI.ts"), "utf8");
const storyboard = fs.readFileSync(path.join(root, "src/hooks/useStoryboardAI.ts"), "utf8");
const requestShotImageTakeSource = storyboard.match(
  /const requestShotImageTake[\s\S]*?\n  };\n\n  const executeRerollShot/,
)?.[0] || "";
assert.ok(requestShotImageTakeSource, "storyboard shot-image candidate flow must remain inspectable");
assert.match(requestShotImageTakeSource, /appendShotTakeCandidate/);
const shotCardSource = fs.readFileSync(path.join(root, "src/components/storyboard/ShotCard.tsx"), "utf8");
assert.match(shotCardSource, /adoptShotTake\(item, takeId, 'image'\)/);
const existingVideoMedia = { kind: "video", url: "/video-current.mp4" } as Shot["videoMedia"];
const activeTakeAudit = { action: "generate_video", sourceHash: "video-source" } as NonNullable<Shot["takes"]>[number]["generationAudit"];
const imageCandidateSource: Shot = {
  id: "shot-candidate-contract",
  imageUrl: "/image-current.png",
  videoUrl: "/video-current.mp4",
  videoMedia: existingVideoMedia,
  activeTakeId: "take-current",
  takes: [{
    id: "take-current",
    imageUrl: "/image-current.png",
    videoUrl: "/video-current.mp4",
    videoMedia: existingVideoMedia,
    generationAudit: activeTakeAudit,
    createdAt: 1,
  }],
};
const stagedImageCandidate = appendShotTakeCandidate(imageCandidateSource, {
  id: "take-image-candidate",
  imageUrl: "/image-candidate.png",
  videoUrl: "/video-from-another-version.mp4",
  createdAt: 2,
});
assert.equal(stagedImageCandidate.imageUrl, imageCandidateSource.imageUrl);
assert.equal(stagedImageCandidate.videoUrl, imageCandidateSource.videoUrl);
assert.equal(stagedImageCandidate.activeTakeId, imageCandidateSource.activeTakeId);
assert.ok(stagedImageCandidate.takes?.some((take) => take.id === "take-image-candidate"));
const adoptedImageCandidate = adoptShotTake(stagedImageCandidate, "take-image-candidate", "image");
assert.equal(adoptedImageCandidate.imageUrl, "/image-candidate.png");
assert.equal(adoptedImageCandidate.videoUrl, imageCandidateSource.videoUrl);
assert.equal(adoptedImageCandidate.videoMedia, existingVideoMedia);
assert.equal(adoptedImageCandidate.activeTakeId, "take-image-candidate");
assert.equal(
  adoptedImageCandidate.takes?.find((take) => take.id === "take-image-candidate")?.videoUrl,
  imageCandidateSource.videoUrl,
  "adopting an image candidate must keep the active Take coherent without switching or clearing the current video",
);
const retentionSource: Shot = {
  ...imageCandidateSource,
  takes: [
    imageCandidateSource.takes![0],
    { id: "take-candidate-1", imageUrl: "/candidate-1.png", createdAt: 2 },
    { id: "take-candidate-2", imageUrl: "/candidate-2.png", createdAt: 3 },
  ],
};
const retainedCandidateHistory = appendShotTakeCandidate(retentionSource, {
  id: "take-candidate-3",
  imageUrl: "/candidate-3.png",
  createdAt: 4,
}, 3);
assert.equal(retainedCandidateHistory.takes?.length, 4, "unreviewed candidates must not be silently deleted by a fixed cap");
assert.ok(retainedCandidateHistory.takes?.some((take) => take.id === "take-current"));
assert.ok(retainedCandidateHistory.takes?.some((take) => take.id === "take-candidate-3"));
assert.ok(retainedCandidateHistory.takes?.some((take) => take.id === "take-candidate-1"));
assert.equal(retainedCandidateHistory.takes?.find((take) => take.id === "take-current")?.generationAudit, activeTakeAudit);
assert.ok(manualStudio.includes("imageReferenceManifest: compiledImageRequest?.references.map"));
assert.match(manualStudio, /resolveManualStudioImageVisualArtifactIntent\(request\.draftPreview\)/);
assert.match(manualStudio, /resolveImageVisualStyleProjectionContext/);
assert.match(manualStudio, /\.\.\.visualProjectionContext/);
assert.match(manualStudio, /resolveManualStudioTargetShotOverride/);
assert.equal(
  (manualStudio.match(/shotOverride:/g) || []).length,
  (manualStudio.match(/shotOverride:\s*resolveManualStudioTargetShotOverride/g) || []).length,
  "Every Manual Studio image/video projection must resolve Shot overrides against the full target Shot set",
);
const shotOverride: VisualLocalOverride = {
  schemaVersion: "visual-local-override.v1",
  treatment: { palette: { mode: "set", value: ["only-this-shot"] } },
  source: "shot",
};
assert.equal(resolveManualStudioTargetShotOverride(shotOverride, undefined), shotOverride);
assert.equal(resolveManualStudioTargetShotOverride(shotOverride, ["shot-a"]), shotOverride);
assert.equal(resolveManualStudioTargetShotOverride(shotOverride, ["shot-a", "shot-a"]), shotOverride);
assert.equal(
  resolveManualStudioTargetShotOverride(shotOverride, ["shot-a", "shot-b"]),
  undefined,
  "A multi-shot target must not silently inherit the first Shot's local visual override",
);
assert.ok(storyboard.includes("imageReferenceManifest: compiledRequest?.references.map"));
assert.match(storyboard, /resolveImageVisualStyleProjectionContext/);
assert.match(storyboard, /shots:\s*\[shot(?:ToReroll)?\]/);
assert.doesNotMatch(manualStudio, /assetDescriptions:\s*\[/);
assert.match(storyboard, /projectShotForVisualPrompt/);
assert.doesNotMatch(storyboard, /shots:\s*item\.scene\.shots\s*\|\|\s*\[\]/);

const promptEditor = fs.readFileSync(path.join(root, "src/components/PromptEditorModal.tsx"), "utf8");
assert.match(promptEditor, /moveImageReference/);
assert.match(promptEditor, /参考图 \$\{selectedIndex \+ 1\}/);
assert.match(storyboard, /orderedSelectedIds\.map/);

const promptStore = fs.readFileSync(path.join(root, "src/store/usePromptStore.ts"), "utf8");
assert.ok(Number(promptStore.match(/version:\s*(\d+)/)?.[1]) >= 55, "prompt migrations must retain the image/video prompt boundary upgrade");
assert.ok(promptStore.includes("newTemplates['generateImage'] = defaultTemplates['generateImage']"));
assert.ok(promptStore.includes("newTemplates['generateVideo'] = defaultTemplates['generateVideo']"));

const assetBoardExecution = fs.readFileSync(path.join(root, "src/services/production/productionAssetBoardExecution.ts"), "utf8");
const assetBoardTemplates = fs.readFileSync(path.join(root, "packages/production/src/services/production/videoStoryboardAssetBoards.ts"), "utf8");
assert.doesNotMatch(assetBoardExecution, /PROMPT_LIMIT|clipText\(/);
assert.doesNotMatch(assetBoardExecution, /生成(?:一张 )?16:9/);
assert.doesNotMatch(assetBoardTemplates.match(/const characterBoardPrompt[\s\S]*?const locationBoardPrompt/)?.[0] || "", /MBTI|九型人格|心理侧写|内在渴望|外在目标/);

const projectTypes = fs.readFileSync(path.join(root, "src/types/project.ts"), "utf8");
const mediaWorker = fs.readFileSync(path.join(root, "apps/worker/src/production-media-worker.ts"), "utf8");
const mediaWorkerPromptBuilder = fs.readFileSync(path.join(root, "src/services/production/mediaProductionWorker.ts"), "utf8");
assert.doesNotMatch(mediaWorkerPromptBuilder, /策略:\$\{clean\(board\.strategyDecision\.selectedStrategyId\)\}/);
assert.doesNotMatch(mediaWorkerPromptBuilder, /策略：\$\{board\.strategyId/);
const manualShotImageSample = fs.readFileSync(path.join(root, "tests/manual-shot-image-sample.ts"), "utf8");
assert.doesNotMatch(manualShotImageSample, /assetDescriptionsForShot|formatVisualCreativeVision/);
assert.match(manualShotImageSample, /const finalImagePrompt = \(shot: any\) => shot\.imagePrompt/);
assert.ok(projectTypes.includes("imageReferenceManifest?: ImageGenerationReferenceAudit[]"));
assert.ok(mediaWorker.includes("promptCompositionManifest: compiled.manifest"));

const boardImage = fs.readFileSync(path.join(root, "src/hooks/useProductionAssetBoardImage.ts"), "utf8");
const boardBatch = fs.readFileSync(path.join(root, "src/hooks/useProductionAssetBoardBatch.ts"), "utf8");
for (const source of [boardImage, boardBatch]) {
  assert.ok(source.includes("previousOutputReferenceUrl"));
  assert.ok(source.includes("buildProductionAssetBoardPreviousOutputRepairOperation"));
  assert.ok(source.includes("buildProductionAssetBoardCanonicalReference"));
  assert.match(source, /role:\s*"previous_output_repair"/);
  assert.doesNotMatch(source, /role:\s*"source_edit"/);
  assert.match(source, /operation:\s*previousOutputReferenceUrl/);
}
const storyboardBoardBatch = fs.readFileSync(path.join(root, "src/hooks/useStoryboardBoardBatchAgent.ts"), "utf8");
assert.match(storyboardBoardBatch, /resolveImageVisualStyleProjectionContext\(\{ project, shots \}\)/);
assert.match(storyboardBoardBatch, /createPreviousOutputRepairOperation/);
assert.match(storyboardBoardBatch, /operation:\s*previousBoardTake\?\.imageUrl/);
const storyboardComposite = fs.readFileSync(path.join(root, "src/services/production/storyboardCompositeBoard.ts"), "utf8");
assert.doesNotMatch(storyboardComposite, /resolveVisualStyleLock|styleLock\.storyboardInstruction/);
const imageGenSource = fs.readFileSync(path.join(root, "src/pages/ImageGen.tsx"), "utf8");
assert.doesNotMatch(imageGenSource.match(/const referenceRoleOptions[\s\S]*?\];/)?.[0] || "", /source_edit|previous_output_repair/);

const filmRender = fs.readFileSync(path.join(root, "apps/cli/src/kie-production-film-render.ts"), "utf8");
assert.ok(filmRender.includes("resolveShotReferences"));
assert.ok(filmRender.includes("compiled.referenceImages"));
assert.ok(filmRender.includes("aspectRatio: compiled.aspectRatio"));
assert.doesNotMatch(filmRender, /Naturalistic Chinese drama with restrained cinematic realism/);
const manualShotImage = fs.readFileSync(path.join(root, "tests/manual-shot-image-sample.ts"), "utf8");
assert.match(manualShotImage, /references:\s*referencesForShot\(project, scene, shot\)/);
assert.doesNotMatch(manualShotImage, /character\?\.brief/);
const shotContentRepair = fs.readFileSync(path.join(root, "tools/production-shot-content-repair.ts"), "utf8");
assert.match(shotContentRepair, /formatVisualCreativeVision\(project\.creativeVision\)/);
assert.match(shotContentRepair, /promptCompositionManifests/);
assert.match(shotContentRepair, /composePromptBlocks\(promptBlocksFromText/);
assert.doesNotMatch(shotContentRepair, /真人电影|人物表演克制真实/);

const aiService = fs.readFileSync(path.join(root, "src/services/ai.ts"), "utf8");
assert.ok(aiService.includes("usePromptCompositionAuditStore.getState().record"));
assert.ok(aiService.includes('phase: "image_generation"'));
assert.ok(aiService.includes('phase: "video_generation"'));
assert.ok(aiService.includes('type: "json_schema"'));
assert.ok(aiService.includes("comfyUIImageDimensionsForAspectRatio(compiled.aspectRatio)"));

const imageGenPage = fs.readFileSync(path.join(root, "src/pages/ImageGen.tsx"), "utf8");
assert.doesNotMatch(imageGenPage, /referenceImages\.slice\(0,\s*4\)|referenceImages\.length\}\/4/);
assert.match(imageGenPage, /role:\s*ImageReferenceRole\s*\|\s*""/);
assert.match(imageGenPage, /请为参考图 \$\{incompleteReferenceIndex \+ 1\} 填写名称并选择职责/);
assert.doesNotMatch(imageGenPage, /用户参考图/);
const imagePromptModal = fs.readFileSync(path.join(root, "src/components/ImagePromptModal.tsx"), "utf8");
assert.doesNotMatch(imagePromptModal, /contextOptions|defaultSelectedContextIds|\{\{selectedContext\}\}|\{\{skills\}\}/);
const videoPromptPacks = fs.readFileSync(path.join(root, "packages/production/src/services/production/videoStoryboardPromptPacks.ts"), "utf8");
assert.doesNotMatch(videoPromptPacks, /referenceBudgetTracker|Math\.min\([^\n]*maxReferenceImages/);
assert.doesNotMatch(videoPromptPacks, /本包覆盖镜头：\$\{shotIds\.join\("[,]? ?"\) \|\| "无"\}/);
const productionPromptRuntime = fs.readFileSync(path.join(root, "src/services/production/productionPromptRuntime.ts"), "utf8");
assert.doesNotMatch(productionPromptRuntime, /compactPromptStructurally|prompt exceeded|stageTokenBudget/);
assert.match(productionPromptRuntime, /promptCompositionManifests/);
const productionAssetDetail = fs.readFileSync(path.join(root, "src/services/production/productionAssetDetailStageRunner.ts"), "utf8");
assert.match(productionAssetDetail, /projectPlannedCharacterPromptFacts/);
assert.doesNotMatch(productionAssetDetail, /plannedCharacters:\s*compactJson\(plannedCharacters\)/);
const productionAssetSync = fs.readFileSync(path.join(root, "src/services/production/productionAssetSyncStageRunner.ts"), "utf8");
assert.doesNotMatch(productionAssetSync, /brief:\s*`[^`]*待补全/);
const productionPromptContext = fs.readFileSync(path.join(root, "src/services/production/productionPromptContext.ts"), "utf8");
assert.doesNotMatch(productionPromptContext, /\[ContextPlan 注入\]|未注入关键上下文:|本阶段 Skill:|字段语言策略:/);
assert.doesNotMatch(productionPromptContext.match(/export const renderStageContextEnvelope[\s\S]*?^};/m)?.[0] || "", /参考源使用边界|renderReferenceInfluence/);
const visualPromptAgent = fs.readFileSync(path.join(root, "src/services/production/storyboardVisualPromptAgent.ts"), "utf8");
assert.doesNotMatch(visualPromptAgent, /欲望、阻碍、MBTI|无额外部门上下文|无额外资产上下文/);
assert.doesNotMatch(visualPromptAgent, /批次审计|完整原文已经保存/);
const promptBuilder = fs.readFileSync(path.join(root, "src/lib/promptBuilder.ts"), "utf8");
assert.doesNotMatch(promptBuilder, /verticalReadabilityTags|vertical portrait framing/);

const skillPrompt = fs.readFileSync(path.join(root, "packages/domain/src/skillPrompt.ts"), "utf8");
assert.doesNotMatch(skillPrompt.match(/buildSkillRecommendationPrompt[\s\S]*/)?.[0] || "", /\.slice\(/);
assert.doesNotMatch(skillPrompt, /input\.userIdea \|\| "未填写"|input\.categoryHint \|\| "未分类"/);
assert.ok(filmRender.includes("version: 2"));
assert.ok(filmRender.includes("renderShotReferences"));
assert.doesNotMatch(filmRender, /Natural Northeast China|\$\{aspectRatio\}, \$\{phase\}|\$\{durationSeconds\} seconds/);
assert.match(filmRender, /database IDs will not be sent to the image model/);

const longFormMemory = fs.readFileSync(path.join(root, "src/services/production/longFormMemory.ts"), "utf8");
assert.doesNotMatch(longFormMemory, /slice\(0, policy\.maxShotCount\)|slice\(0,\s*8\)/);
const interactiveVisualContext = fs.readFileSync(path.join(root, "src/utils/interactiveSceneVisualContext.ts"), "utf8");
assert.doesNotMatch(interactiveVisualContext, /视觉状态指纹|reuseFingerprint/);
assert.doesNotMatch(storyboard, /context\.(?:episodeContext|nodeContext|variableContext|pathContext|productionStatus)/);
const manualShotSample = fs.readFileSync(path.join(root, "tests/manual-shot-image-sample.ts"), "utf8");
assert.doesNotMatch(manualShotSample, /psychologicalProfile|internalDesire|externalGoal/);
assert.doesNotMatch(manualShotSample, /JSON\.stringify\([^\n]*assetVariantMap/);
const promptDirectory = path.join(root, "src/config/prompts");
const promptSources = fs.readdirSync(promptDirectory)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(promptDirectory, name), "utf8"))
  .join("\n");
assert.doesNotMatch(promptSources, /全球顶级|拥有最强大脑|You are an expert|not allowed to perform at a mediocre level/i);
const manualVideoStoryboard = fs.readFileSync(path.join(root, "src/hooks/useManualVideoStoryboard.ts"), "utf8");
assert.match(manualVideoStoryboard, /projectShotForManualStoryboardPrompt/);
assert.match(manualVideoStoryboard, /visualPanelContract/);
assert.match(manualVideoStoryboard, /projectStoryboardRepairQuality\(workflow\.qa\)/);
assert.doesNotMatch(manualVideoStoryboard, /gatherContextOptions|createSceneScopedContextSelection/);
assert.doesNotMatch(manualVideoStoryboard, /JSON\.stringify\(shot\s*,/);
const assetProfileContext = fs.readFileSync(path.join(root, "src/services/production/productionAssetProfileContext.ts"), "utf8");
// Text profile extraction needs the imported source. Image requests use the
// resulting visual fields, never this source-context builder.
assert.doesNotMatch(assetProfileContext, /content:\s*output\.content/);
assert.match(assetProfileContext, /document\.content/);
assert.doesNotMatch(assetBoardExecution, /buildProductionAssetProfileContext|productionSourceDocuments|taskSummary|continuityNotes/);
const projectDomainTypes = fs.readFileSync(path.join(root, "src/types/project.ts"), "utf8");
assert.ok(projectDomainTypes.includes("promptCompositionManifest?: PromptCompositionManifestAudit"));

const assistantPreparation = fs.readFileSync(path.join(root, "src/services/assistant/productionPreparationBatch.ts"), "utf8");
assert.match(assistantPreparation, /productionDepartmentCreativeVision\(project, departmentId\)/);
assert.match(assistantPreparation, /promptCompositionManifest:\s*promptComposition\.manifest/);
assert.doesNotMatch(assistantPreparation, /JSON\.stringify\(project\.creativeVision/);
assert.doesNotMatch(assistantPreparation, /推断伪装成剧本事实。只返回 JSON/);
assert.doesNotMatch(assistantPreparation, /\[QA_CONTEXT_MARKER\]: JSON\.stringify\(qa,\s*null,\s*2\)/);
assert.match(assistantPreparation, /projectManualFilmTeamRepairQa\(qa\)/);
assert.match(assistantPreparation, /projectProductionBreakdownRepairQa\(qa\)/);

const boardAgent = fs.readFileSync(path.join(root, "src/services/production/storyboardBoardAgent.ts"), "utf8");
const shotAgent = fs.readFileSync(path.join(root, "src/services/production/storyboardShotAgent.ts"), "utf8");
const compositeBoard = fs.readFileSync(path.join(root, "src/services/production/storyboardCompositeBoard.ts"), "utf8");
assert.match(boardAgent, /sceneOwnedSections/);
assert.match(boardAgent, /shots\.map\(projectShotForManualStoryboardPrompt\)/);
assert.doesNotMatch(boardAgent.match(/buildStoryboardBoardBatchPrompt[\s\S]*?buildStoryboardBoardBatchQualityPrompt/)?.[0] || "", /\$\{confirmedPrompt\}/);
assert.doesNotMatch(boardAgent, /JSON\.stringify\(quality,\s*null,\s*2\)/);
assert.match(shotAgent, /shots\.map\(projectShotForManualStoryboardPrompt\)/);
assert.doesNotMatch(shotAgent, /尚未进入语义质检/);
assert.doesNotMatch(shotAgent, /JSON\.stringify\(quality,\s*null,\s*2\)/);
assert.match(visualPromptAgent, /projectStoryboardVisualPromptSourceShot/);
assert.doesNotMatch(visualPromptAgent, /尚未进入(?:语义)?质检/);
assert.doesNotMatch(visualPromptAgent, /JSON\.stringify\(quality,\s*null,\s*2\)/);
assert.match(visualPromptAgent, /projectStoryboardRepairQuality/);
assert.doesNotMatch(compositeBoard, /策略渲染警告：/);

const manualBreakdown = fs.readFileSync(path.join(root, "src/services/production/manualSceneBreakdown.ts"), "utf8");
assert.doesNotMatch(manualBreakdown, /sourceDocument\.content|psychologicalProfile|\bmbti\b|enneagram/);
assert.match(manualBreakdown, /本场原文依据（唯一拆解范围）/);
const writingSourceContext = fs.readFileSync(path.join(root, "src/services/production/writingSourceContext.ts"), "utf8");
assert.doesNotMatch(writingSourceContext, /performanceNotes|characterGoals|psychologicalProfile/);
const productionScriptRunner = fs.readFileSync(path.join(root, "src/services/production/productionScriptStageRunner.ts"), "utf8");
assert.match(productionScriptRunner, /projectAssetCatalogContext\(project, \{/);
const breakdownReviewActions = fs.readFileSync(path.join(root, "src/components/production/preparation/ProductionBreakdownReviewActions.tsx"), "utf8");
assert.match(breakdownReviewActions, /projectProductionBreakdownRepairQa\(record\.qa\)/);
assert.doesNotMatch(breakdownReviewActions, /JSON\.stringify\(record\.qa,\s*null,\s*2\)/);
const sourceOverviewWorkspace = fs.readFileSync(path.join(root, "src/components/production/preparation/ProductionSourceOverviewWorkspace.tsx"), "utf8");
assert.match(sourceOverviewWorkspace, /projectScenePlanRepairQa\(activePlan\?\.qa\)/);
const assetPreparationHook = fs.readFileSync(path.join(root, "src/hooks/useProductionAssetPreparationAI.ts"), "utf8");
assert.match(assetPreparationHook, /\(\{ sourceHash: _sourceHash, episodeId: _episodeId, \.\.\.output \}\) => output/);
assert.doesNotMatch(assetPreparationHook.match(/const reviewPrompt[\s\S]*?const review = await generateAIContent/)?.[0] || "", /JSON\.stringify\(context\.departmentOutputs/);

const contextMapper = fs.readFileSync(path.join(root, "src/utils/contextMapper.ts"), "utf8");
assert.match(contextMapper, /CONTEXT_DEPENDENCIES\.longFormMemory\.usedIn\.includes\(taskId\) && !visualTask/);
assert.match(contextMapper, /visualTask\s*\?\s*formatVisualCreativeVision/);
const manualFilmTeam = fs.readFileSync(path.join(root, "src/services/production/manualFilmTeam.ts"), "utf8");
assert.match(manualFilmTeam, /manualFilmTeamDefaultContextIds[\s\S]{0,120}=>\s*\[\]/);
const manualFilmTeamCommunication = fs.readFileSync(path.join(root, "src/services/production/manualFilmTeamCommunication.ts"), "utf8");
const collaborationPromptProjection = manualFilmTeamCommunication.match(/export const manualFilmTeamCollaborationContext[\s\S]*?^};/m)?.[0] || "";
assert.ok(collaborationPromptProjection);
assert.doesNotMatch(collaborationPromptProjection, /compact\(|version:|sceneId:|handoff\.id|fromDepartment:/);

const bibleHook = fs.readFileSync(path.join(root, "src/hooks/useBibleAI.ts"), "utf8");
assert.match(bibleHook, /characterRosterPromptData/);
assert.match(bibleHook, /buildBibleAssetVisualStyleProjection/);
assert.match(bibleHook, /intent:\s*variantId\s*\?\s*"asset_state"\s*:\s*"asset_identity"/);
assert.doesNotMatch(bibleHook, /generateAI3DModel|generateAIPanorama/);
assert.doesNotMatch(bibleHook, /无显式点名|JSON\.stringify\(\{\s*characters:\s*currentProject\.characters/);
const bibleAssetDetail = fs.readFileSync(path.join(root, "src/components/bible/AssetDetailView.tsx"), "utf8");
assert.match(bibleAssetDetail, /buildProjectAssetVisualStyleProjection/);
assert.match(bibleAssetDetail, /variantId:\s*targetVariantId/);

const serverProvider = fs.readFileSync(path.join(root, "apps/api/src/providers/genericAIProvider.ts"), "utf8");
assert.match(serverProvider, /composeServerGenericJsonRequest/);
assert.match(serverProvider, /createAgentModelTransport/);
assert.match(serverProvider, /parseGenericAIJson\(generated.text, input.responseSchema\)/);
assert.match(serverProvider, /promptCompositionManifest:\s*generated\.metadata\.promptCompositionManifest \|\| composition\.manifest/);
assert.match(serverProvider, /provider_native_structured_output/);
const skillRoutes = fs.readFileSync(path.join(root, "src/server/routes/skillRoutes.ts"), "utf8");
assert.doesNotMatch(skillRoutes, /systemInstruction:\s*"你只输出严格 JSON/);
assert.match(aiService, /nativeJsonSchemaContract/);
assert.match(aiService, /normalizedSchema && !nativeJsonSchemaContract/);
assert.match(aiService, /源文本\|原文/);
assert.match(aiService, /只\?返回\[\^\\n。\]\{0,160\}JSON/);
assert.match(aiService, /taskType !== 'qcAnalyzer'/);
for (const relativePath of [
  "src/components/production/ProductionMagicImportPage.tsx",
]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(source, /sourceText\.(?:slice|substring)\(/, `${relativePath} must not silently truncate sourceText`);
  assert.doesNotMatch(source, /无额外补充/, `${relativePath} must not inject a placeholder user intent`);
}

const promptRoleSources = [
  aiService,
  fs.readFileSync(path.join(root, "src/services/production/productionConceptStageRunner.ts"), "utf8"),
  productionScriptRunner,
].join("\n");
assert.doesNotMatch(promptRoleSources, /全球顶级|世界级|最强大脑|你是[^\n]{0,30}顶级|You are (?:a |an )?(?:world-class|top|expert)/i);

console.log("prompt governance self-check passed");
