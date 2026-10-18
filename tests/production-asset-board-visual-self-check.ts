import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import type { Project } from "../src/types/project";
import {
  buildVideoStoryboardAssetBoardPlan,
  resolveAssetBoardLayoutContract,
  validateVideoStoryboardAssetBoardPlan,
} from "../src/services/production/videoStoryboardAssetBoards";
import { visualOnlySavedAssetBrief, assetVariantVisualInstructions, buildProductionAssetBoardExecutionPrompt, buildProductionAssetBoardPromptPreview, productionAssetBoardPromptCore } from "../src/services/production/productionAssetBoardExecution";
import { buildProductionAssetBoardReferenceUpdate } from "../src/services/production/productionAssetBoardProfile";
import {
  adoptProductionAssetBoardReferenceCandidate,
  discardProductionAssetBoardReferenceCandidate,
  productionAssetBoardCandidateSourceContentHash,
  reviewProductionAssetBoardCandidateSource,
  stageProductionAssetBoardReferenceCandidate,
} from "../src/services/production/productionAssetBoardCandidate";
import {
  buildProductionAssetBoardVisualQAPrompt,
  buildProductionAssetBoardVisualRepairPrompt,
  isProductionAssetBoardVisualQualityPassing,
} from "../src/services/production/productionAssetBoardVisual";
import { buildAssetBoardOverlaySpec } from "../src/services/production/productionBoardImageOverlay";
import { createNeutralVisualImplementation } from "../src/services/production/visualMediumProfiles";
import { buildProductionAssetVisualStyleProjection } from "../src/services/production/productionAssetVisualStyle";
import {
  buildProductionAssetImageVisualStyleProjection,
  buildProductionAssetVisualRecipeInputEvidence,
} from "../src/services/production/imageVisualStyleProjection";
import { compileImageGenerationRequest } from "../src/services/production/imageGenerationRequest";

const project = {
  id: "asset-board-visual-project",
  title: "资产板最终形态测试",
  type: "movie",
  aspectRatio: "16:9",
  logline: "女剑修在祖祠发现封印真相。",
  coreConflict: "她必须在宗门追杀前带走残剑。",
  episodes: [],
  characters: [{
    id: "character-lead",
    name: "云照",
    visualIdentity: "二十岁女剑修，冷白肤色，黑发高束，青白窄袖剑服，左眉尾细疤。",
    variants: [{ id: "variant-wounded", name: "负伤态", description: "右肩绷带渗血，衣摆破损，脸和基础服装身份不变。" }],
  }, {
    id: "character-radio-voice",
    name: "广播员（声音）",
    visualPresence: "voice_only",
  }],
  assets: [{
    id: "char-character-lead",
    name: "云照",
    type: "character",
    description: "角色镜像资产",
    variants: [{ id: "variant-wounded", name: "负伤态", description: "旧状态" }],
  }, {
    id: "location-shrine",
    name: "宗门祖祠",
    type: "location",
    description: "纵深三进，中央魂灯墙，左侧暗门，冷月从右侧高窗进入。",
    variants: [{ id: "variant-burning", name: "焚毁态", description: "魂灯墙起火、梁柱焦黑，空间骨架不变。" }],
  }, {
    id: "prop-sword",
    name: "九霄残剑",
    type: "prop",
    description: "黑金剑柄，断裂剑身，握柄末端有云纹铜环。",
    variants: [{ id: "variant-awakened", name: "觉醒态", description: "断口出现金色灵纹，核心结构不变。" }],
  }],
} as Project;

const plan = buildVideoStoryboardAssetBoardPlan(project);
const allBoards = [...plan.characterBoards, ...plan.sceneBoards, ...plan.propBoards, ...plan.variantBoards];
assert.equal(allBoards.length, 6);
assert.equal(plan.characterBoards.some((item) => item.assetId === "character-radio-voice"), false);
assert.equal(validateVideoStoryboardAssetBoardPlan(plan, project).some((issue) => issue.severity === "blocking"), false);

const characterBoard = plan.characterBoards[0];
assert.equal(characterBoard.layoutContract.outputForm, "single_composite_production_sheet");
assert.ok(characterBoard.layoutContract.requiredViews.includes("背面全身"));
assert.ok(characterBoard.layoutContract.requiredStudies.some((item) => item.includes("表情")));
const characterOverlaySpec = buildAssetBoardOverlaySpec({ project, board: characterBoard });
assert.equal(characterOverlaySpec.kind, "asset_board");
assert.match(characterOverlaySpec.title, /云照/);
assert.match(characterOverlaySpec.subtitle, /角色身份板/);
assert.ok(characterOverlaySpec.sections.includes("背面全身"));
const sceneBoard = plan.sceneBoards[0];
assert.ok(sceneBoard.layoutContract.requiredViews.some((item) => item.includes("俯视")));
assert.ok(sceneBoard.layoutContract.requiredViews.some((item) => item.includes("机位")));
const propBoard = plan.propBoards[0];
assert.ok(propBoard.layoutContract.requiredViews.includes("顶视"));
assert.ok(propBoard.layoutContract.requiredStudies.some((item) => item.includes("手持")));
const variantBoard = plan.variantBoards.find((item) => item.assetType === "character")!;
assert.match(variantBoard.layoutContract.contractId, /variant\.character/);
assert.ok(variantBoard.layoutContract.forbiddenContent.includes("前后对比"));
assert.ok(variantBoard.layoutContract.forbiddenContent.includes("基础状态小窗"));
assert.deepEqual(
  resolveAssetBoardLayoutContract("variant_board", "location").requiredViews,
  ["当前状态主空间全景", "当前状态入口/出口", "当前状态反打方向", "当前状态俯视拓扑"],
);

const executionPrompt = buildProductionAssetBoardExecutionPrompt(project, characterBoard);
assert.match(executionPrompt, /输出一张复合参考图/);
assert.doesNotMatch(executionPrompt, /16:9|9:16|横向构图|竖向构图/);
assert.match(executionPrompt, /正面全身、侧面全身、背面全身/);
assert.match(executionPrompt, /至少 8 格表情与眼神矩阵/);
assert.doesNotMatch(executionPrompt, /普通角色参考表/);

const cleanCharacterPrompt = buildProductionAssetBoardExecutionPrompt(project, characterBoard, "clean_reference");
assert.doesNotMatch(cleanCharacterPrompt, /asset-reference\./);
assert.match(cleanCharacterPrompt, /严格 90 度侧面全身视图/);
assert.match(cleanCharacterPrompt, /正面上半身身份特写/);
assert.match(cleanCharacterPrompt, /不添加标题栏、页脚、注释区/);
assert.match(cleanCharacterPrompt, /铭文、编号、招牌、印刷内容和屏幕文字，保持原文/);
assert.doesNotMatch(cleanCharacterPrompt, /表情与眼神矩阵/);

// Copy/manual preview and API generation must use the same current style, even for saved briefs.
const styledProject = structuredClone(project);
styledProject.visualStyleLock = { ...project.visualStyleLock!, stylePrompt: "宫崎骏风格" };
for (const mode of ["clean_reference", "production_board"] as const) {
  const board = { ...characterBoard, cleanPrompt: "作者保存的纯净三视图要求" };
  const preview = buildProductionAssetBoardPromptPreview(styledProject, board, mode);
  assert.match(preview, /【风格提示词】\n宫崎骏风格/);
  if (mode === "clean_reference") assert.match(preview, /作者保存的纯净三视图要求/);
  const compiled = compileImageGenerationRequest({
    promptCore: productionAssetBoardPromptCore(preview, styledProject, board), aspectRatio: "16:9",
    visualStyleProjection: buildProductionAssetImageVisualStyleProjection({ project: styledProject, asset: board }),
    visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({ project: styledProject, asset: board }),
  });
  assert.equal(compiled.providerPrompt.split("宫崎骏风格").length - 1, 1);
  assert.ok(compiled.providerPrompt.includes(styledProject.characters[0].visualIdentity!), "saved briefs must still send current identity to the image model");
}
const updatedProfileProject = structuredClone(styledProject);
updatedProfileProject.characters[0].visualIdentity = "作者新确认的短发，银色发夹";
const savedBeforeProfileEdit = { ...characterBoard, cleanPrompt: productionAssetBoardPromptCore(buildProductionAssetBoardPromptPreview(styledProject, { ...characterBoard, cleanPrompt: "作者手写：保持四栏纯净版式" }, "clean_reference"), styledProject, characterBoard) };
const afterProfileEdit = buildProductionAssetBoardPromptPreview(updatedProfileProject, savedBeforeProfileEdit, "clean_reference");
assert.match(afterProfileEdit, /作者手写：保持四栏纯净版式/);
assert.match(afterProfileEdit, /作者新确认的短发，银色发夹/);
assert.equal(afterProfileEdit.includes(styledProject.characters[0].visualIdentity!), false, "replace only the generated identity block when a profile changes");
assert.equal(afterProfileEdit.split('【当前角色外观】').length - 1, 1);
styledProject.characters[0].creativeDirection = { visual: { mode: "replace", stylePrompt: "赛博朋克风格" } };
for (const board of [characterBoard, variantBoard]) {
  const preview = buildProductionAssetBoardPromptPreview(styledProject, board, "clean_reference");
  assert.match(preview, /赛博朋克风格/);
  assert.doesNotMatch(preview, /宫崎骏风格/);
}
styledProject.characters[0].creativeDirection = { visual: { mode: "inherit" } };
assert.match(buildProductionAssetBoardPromptPreview(styledProject, characterBoard, "clean_reference"), /宫崎骏风格/);
styledProject.visualStyleLock.humanApprovalState = "rejected";
assert.doesNotMatch(buildProductionAssetBoardPromptPreview(styledProject, characterBoard, "clean_reference"), /宫崎骏风格/);

const cleanScenePrompt = buildProductionAssetBoardExecutionPrompt(project, sceneBoard, "clean_reference");
assert.doesNotMatch(cleanScenePrompt, /asset-reference\./);
assert.match(cleanScenePrompt, /一张完整的空场主视图/);
assert.match(cleanScenePrompt, /不做拼贴、不分栏/);

const cleanPropPrompt = buildProductionAssetBoardExecutionPrompt(project, propBoard, "clean_reference");
assert.doesNotMatch(cleanPropPrompt, /asset-reference\./);
assert.match(cleanPropPrompt, /三分之四英雄视角/);
assert.match(cleanPropPrompt, /同中心线/);
for (const promptCore of [cleanCharacterPrompt, cleanScenePrompt, cleanPropPrompt]) {
  assert.doesNotThrow(() => compileImageGenerationRequest({ promptCore, aspectRatio: "16:9" }));
}

const variantPrompt = buildProductionAssetBoardExecutionPrompt(project, variantBoard);
assert.match(variantPrompt, /禁止：前后对比、变化时间线、基础状态小窗/);
assert.match(variantPrompt, /只允许改变声明的 variant 状态/);

const qaPrompt = buildProductionAssetBoardVisualQAPrompt({ project, board: characterBoard });
assert.match(qaPrompt, /一张宽度大于高度的复合制作参考板/);
assert.doesNotMatch(qaPrompt, /16:9|9:16/);
assert.match(qaPrompt, /普通肖像、单张气氛图、剧情截图/);
assert.match(qaPrompt, /必需视图/);
const cleanQaPrompt = buildProductionAssetBoardVisualQAPrompt({ project, board: characterBoard, referenceMode: "clean_reference" });
assert.match(cleanQaPrompt, /纯净三视图/);
assert.match(cleanQaPrompt, /没有额外资料标题、标尺、色板文字/);
assert.match(cleanQaPrompt, /不得因它可读而要求删除/);
assert.match(cleanQaPrompt, /左眉尾细疤/, "asset QA must receive the actual canonical identity facts, not only generic layout rules");
assert.match(cleanQaPrompt, /明显影响模型读取时记为 blocking/);
assert.match(buildProductionAssetBoardVisualRepairPrompt(executionPrompt, ["背面视图缺失"]), /背面视图缺失/);

const passingQuality = {
  score: 94,
  verdict: "pass" as const,
  summary: "同一身份且视图齐全。",
  strengths: ["角色正侧背和表情矩阵清楚"],
  issues: [{ severity: "advisory" as const, description: "留白可再均衡", suggestion: "下一版微调" }],
};
assert.equal(isProductionAssetBoardVisualQualityPassing(passingQuality), true);
assert.equal(isProductionAssetBoardVisualQualityPassing({
  ...passingQuality,
  score: 88,
  verdict: "revise",
  issues: [{ severity: "blocking", description: "背面视图缺失", suggestion: "重绘整板" }],
}), false);

const updates = buildProductionAssetBoardReferenceUpdate({
  project,
  boardItemId: characterBoard.id,
  imageUrl: "data:image/png;base64,character-board",
  source: "ai_generation",
  finalPrompt: executionPrompt,
  modelId: "image-model",
  quality: passingQuality,
  review: { mode: "automatic", status: "approved", reviewedAt: 10 },
  createdAt: 10,
});
const audit = updates.manualProductionAssets.references?.find((item) => item.boardItemId === characterBoard.id);
assert.equal(audit?.layoutContractId, characterBoard.layoutContract.contractId);
assert.equal(audit?.quality?.score, 94);
assert.equal(audit?.review?.status, "approved");
assert.equal(audit?.adoptedBy, "user");
assert.equal(
  updates.assets.find((asset) => asset.id === "char-character-lead")?.boardImageUrl,
  "data:image/png;base64,character-board",
  "character mirror assets must receive the same adopted base board",
);

const variantUpdates = buildProductionAssetBoardReferenceUpdate({
  project,
  boardItemId: variantBoard.id,
  imageUrl: "data:image/png;base64,character-variant-board",
  source: "ai_generation",
  finalPrompt: variantPrompt,
  createdAt: 10,
});
assert.equal(
  variantUpdates.characters[0].variants?.find((variant) => variant.id === "variant-wounded")?.boardImageUrl,
  "data:image/png;base64,character-variant-board",
);
assert.equal(
  variantUpdates.assets.find((asset) => asset.id === "char-character-lead")?.variants?.find((variant) => variant.id === "variant-wounded")?.boardImageUrl,
  "data:image/png;base64,character-variant-board",
  "character mirror variants must stay aligned with canonical character variants",
);

const pendingUpdates = stageProductionAssetBoardReferenceCandidate({
  project,
  candidateId: "candidate-character-v1",
  boardItemId: characterBoard.id,
  imageUrl: "data:image/png;base64,pending-character-board",
  source: "ai_generation",
  finalPrompt: executionPrompt,
  modelId: "image-model",
  createdAt: 11,
});
assert.equal(project.characters[0].boardImageUrl, undefined, "staging must not mutate the canonical character image");
assert.equal(pendingUpdates.manualProductionAssets.pendingReferences?.[0]?.status, "pending_review");
const pendingCandidate = pendingUpdates.manualProductionAssets.pendingReferences?.[0];
assert.ok(pendingCandidate?.sourceContentHash, "staging must persist the exact source-content fingerprint");
assert.equal(
  pendingCandidate?.sourceContentHash,
  productionAssetBoardCandidateSourceContentHash({
    project,
    boardItemId: characterBoard.id,
  }),
);
assert.equal(
  reviewProductionAssetBoardCandidateSource({ project, candidate: pendingCandidate!, detectedAt: 11 }).status,
  "current",
);
const replacedPending = stageProductionAssetBoardReferenceCandidate({
  project: { ...project, ...pendingUpdates } as Project,
  candidateId: "candidate-character-v2",
  boardItemId: characterBoard.id,
  imageUrl: "data:image/png;base64,pending-character-board-v2",
  source: "ai_generation",
  finalPrompt: `${executionPrompt}\n第二版`,
  createdAt: 11.5,
});
assert.deepEqual(
  replacedPending.manualProductionAssets.pendingReferences?.map((candidate) => candidate.id),
  ["candidate-character-v2"],
  "one board/reference slot must expose only its newest pending candidate",
);
const projectWithPending = { ...project, ...pendingUpdates } as Project;
const manualExecution = {
  source: "manual_external" as const,
  provider: "manual_external",
  modelId: "manual_external",
  requestedModelId: "configured-paid-image-model",
};
const manualPending = stageProductionAssetBoardReferenceCandidate({
  project,
  candidateId: "candidate-manual-image",
  boardItemId: characterBoard.id,
  imageUrl: "data:image/png;base64,manual-image",
  source: "upload",
  finalPrompt: cleanCharacterPrompt,
  modelId: "manual_external",
  executionProvenance: manualExecution,
  createdAt: 11,
});
assert.deepEqual(manualPending.manualProductionAssets.pendingReferences?.[0]?.executionProvenance, manualExecution);
const manualAdopted = adoptProductionAssetBoardReferenceCandidate({
  project: { ...project, ...manualPending } as Project,
  candidateId: "candidate-manual-image",
  adoptedAt: 12,
});
assert.deepEqual(manualAdopted.manualProductionAssets.references?.[0]?.executionProvenance, manualExecution);
assert.equal(manualAdopted.manualProductionAssets.references?.[0]?.modelId, "manual_external");
const adoptedPending = adoptProductionAssetBoardReferenceCandidate({
  project: projectWithPending,
  candidateId: "candidate-character-v1",
  adoptedAt: 12,
});
assert.equal(adoptedPending.characters[0].boardImageUrl, "data:image/png;base64,pending-character-board");
assert.equal(adoptedPending.manualProductionAssets.pendingReferences?.length, 0);
assert.equal(adoptedPending.manualProductionAssets.references?.[0]?.candidateId, "candidate-character-v1");
assert.equal(adoptedPending.manualProductionAssets.references?.[0]?.generatedAt, 11);
assert.equal(adoptedPending.manualProductionAssets.references?.[0]?.adoptedAt, 12);
assert.equal(adoptedPending.manualProductionAssets.references?.[0]?.sourceReview?.status, "current");

const identityChangedProject = {
  ...projectWithPending,
  characters: projectWithPending.characters.map((character) => character.id === "character-lead"
    ? { ...character, visualIdentity: `${character.visualIdentity}，新增金色瞳孔身份锚点。` }
    : character),
} as Project;
const identitySourceReview = reviewProductionAssetBoardCandidateSource({
  project: identityChangedProject,
  candidate: pendingCandidate!,
  detectedAt: 15,
});
assert.equal(identitySourceReview.status, "review_recommended");
assert.deepEqual(identitySourceReview.reasons, ["source_updated"]);
const explicitlyAdoptedAfterIdentityChange = adoptProductionAssetBoardReferenceCandidate({
  project: identityChangedProject,
  candidateId: "candidate-character-v1",
  adoptedAt: 16,
});
assert.equal(
  explicitlyAdoptedAfterIdentityChange.characters[0].boardImageUrl,
  "data:image/png;base64,pending-character-board",
  "a source update must recommend review without blocking the user's explicit adoption",
);
assert.equal(
  explicitlyAdoptedAfterIdentityChange.manualProductionAssets.references?.[0]?.sourceReview?.status,
  "review_recommended",
);
assert.deepEqual(
  explicitlyAdoptedAfterIdentityChange.manualProductionAssets.references?.[0]?.sourceReview?.reasons,
  ["source_updated"],
);

const styleChangedProject = {
  ...projectWithPending,
  visualStyleLock: {
    stylePrompt: "改为黑白木刻风格，并保持角色身份。",
    styleKeywords: ["woodcut"],
  },
} as Project;
assert.equal(
  reviewProductionAssetBoardCandidateSource({
    project: styleChangedProject,
    candidate: pendingCandidate!,
    detectedAt: 17,
  }).status,
  "review_recommended",
  "a visual-style-lock update must make the candidate reviewable rather than silently current",
);

const stagedVariant = stageProductionAssetBoardReferenceCandidate({
  project,
  candidateId: "candidate-variant-source-v1",
  boardItemId: variantBoard.id,
  imageUrl: "data:image/png;base64,pending-variant-board",
  source: "ai_generation",
  finalPrompt: variantPrompt,
  createdAt: 18,
});
const pendingVariant = stagedVariant.manualProductionAssets.pendingReferences?.[0];
const variantChangedProject = {
  ...project,
  ...stagedVariant,
  characters: project.characters.map((character) => character.id === "character-lead"
    ? {
        ...character,
        variants: character.variants?.map((variant) => variant.id === "variant-wounded"
          ? { ...variant, description: `${variant.description}，左袖新增烧灼痕迹。` }
          : variant),
      }
    : character),
} as Project;
assert.equal(
  reviewProductionAssetBoardCandidateSource({
    project: variantChangedProject,
    candidate: pendingVariant!,
    detectedAt: 19,
  }).status,
  "review_recommended",
  "a selected state-variant update must be part of the candidate source fingerprint",
);

assert.equal(
  reviewProductionAssetBoardCandidateSource({
    project,
    candidate: { ...pendingCandidate!, sourceContentHash: undefined },
    detectedAt: 20,
  }).reasons[0],
  "source_fingerprint_missing",
  "legacy pending candidates without provenance must recommend review without becoming blocked",
);

const discardSource = { ...project, ...stageProductionAssetBoardReferenceCandidate({
  project,
  candidateId: "candidate-character-discard",
  boardItemId: characterBoard.id,
  imageUrl: "data:image/png;base64,discard-character-board",
  source: "ai_generation",
  finalPrompt: executionPrompt,
  createdAt: 13,
}) } as Project;
const discardedPending = discardProductionAssetBoardReferenceCandidate({
  project: discardSource,
  candidateId: "candidate-character-discard",
  discardedAt: 14,
});
assert.equal(discardedPending.manualProductionAssets.pendingReferences?.length, 0);
assert.equal(discardSource.characters[0].boardImageUrl, undefined, "discarding must leave canonical media unchanged");

const projectWithProductionBoard = { ...project, ...updates } as Project;
const cleanUpdates = buildProductionAssetBoardReferenceUpdate({
  project: projectWithProductionBoard,
  boardItemId: characterBoard.id,
  imageUrl: "data:image/png;base64,clean-character-reference",
  source: "ai_generation",
  finalPrompt: cleanCharacterPrompt,
  modelId: "image-model",
  referenceMode: "clean_reference",
  createdAt: 20,
});
const updatedCharacter = cleanUpdates.characters.find((item) => item.id === characterBoard.assetId);
assert.equal(updatedCharacter?.boardImageUrl, "data:image/png;base64,character-board", "the detailed production board must remain available");
assert.equal(updatedCharacter?.cleanReferenceImageUrl, "data:image/png;base64,clean-character-reference");
assert.equal(updatedCharacter?.multiViewUrl, "data:image/png;base64,clean-character-reference", "legacy model-reference consumers should receive the clean view");
assert.equal(cleanUpdates.manualProductionAssets.references?.length, 2, "production and clean references must keep separate audits");
assert.equal(cleanUpdates.manualProductionAssets.references?.find((item) => item.referenceMode === "clean_reference")?.layoutContractId, "asset-reference.character.clean-turnaround.v1");
const updatedPlan = buildVideoStoryboardAssetBoardPlan({ ...projectWithProductionBoard, ...cleanUpdates } as Project);
const updatedBoard = updatedPlan.characterBoards.find((item) => item.assetId === characterBoard.assetId);
assert.equal(updatedBoard?.productionReferenceImageUrl, "data:image/png;base64,character-board");
assert.equal(updatedBoard?.cleanReferenceImageUrl, "data:image/png;base64,clean-character-reference");
assert.equal(updatedBoard?.referenceImageUrl, "data:image/png;base64,clean-character-reference", "downstream generation must prefer the text-free reference");

const targetedProject = {
  ...project,
  characters: project.characters.map((character) => character.id === "character-lead" ? {
    ...character,
    visualOverride: {
      schemaVersion: "visual-local-override.v1",
      treatment: {
        linework: { mode: "set", value: ["canonical character ink override"] },
      },
    },
  } : character),
  assets: [
    ...project.assets.map((asset) => asset.id === "location-shrine" ? {
      ...asset,
      visualOverride: {
        schemaVersion: "visual-local-override.v1",
        treatment: {
          palette: { mode: "set", value: ["canonical location palette"] },
        },
      },
    } : asset.id === "prop-sword" ? {
      ...asset,
      visualOverride: {
        schemaVersion: "visual-local-override.v1",
        treatment: {
          linework: { mode: "set", value: ["canonical prop asset override"] },
        },
      },
    } : asset),
    {
      id: "character-lead",
      name: "云照",
      type: "character",
      description: "兼容旧数据的角色镜像资产。",
      visualOverride: {
        schemaVersion: "visual-local-override.v1",
        treatment: {
          linework: { mode: "set", value: ["mirror override must not leak"] },
        },
      },
    },
  ],
  visualStyleLock: {
    schemaVersion: "visual-style-lock.v3",
    revision: 4,
    contentHash: "targeted-style-test",
    humanApprovalState: "approved",
    visualImplementation: {
      ...createNeutralVisualImplementation("mixed_media"),
      appearance: { realism: "stylized", dimensionality: "hybrid", finish: "polished", descriptors: ["layered tactile world"] },
      techniques: ["layered compositing"],
      specification: {
        kind: "mixed_media",
        compositingModel: ["ordered layer stack"],
        integrationRules: ["preserve medium boundaries"],
        transitionRules: ["declared transitions only"],
        contactAndShadowRules: ["shared contact plane"],
      },
    },
    treatment: {
      palette: ["muted teal"],
      color: ["muted chroma with controlled accents"],
      surface: [],
      linework: ["project line baseline"],
      lighting: ["shared directional key light"],
      camera: [],
      movement: ["readable staged motion"],
      composition: ["clear subject hierarchy"],
      materials: ["final surface must not enter identity boards"],
      finish: [],
      readability: ["silhouette remains readable across media"],
      constraints: ["do not merge declared media identities"],
      directives: ["honor the approved mixed-media contract"],
    },
    mediumAssignments: [{
      id: "internal-whole-assignment",
      target: { scope: "whole" },
      implementation: {
        ...createNeutralVisualImplementation("stop_motion"),
        appearance: { realism: "stylized", dimensionality: "physical_miniature", finish: "polished", descriptors: ["tactile miniature"] },
        techniques: ["replacement animation"],
        specification: {
          ...createNeutralVisualImplementation("stop_motion").specification,
          fabrication: ["whole-frame clay fabrication"],
          setConstructionAndScale: ["locked miniature set scale and repeatable prop dimensions"],
          puppetConstruction: ["wire armature puppet"],
          armatureBehavior: ["stable armature"],
          replacementAnimation: ["replaceable expressions"],
          frameCadence: ["intentional held frames"],
          captureAndMotionControl: ["locked camera, per-frame exposure, and repeatable motion-control moves"],
          stageLighting: ["miniature stage lighting"],
          materialImperfections: ["controlled fingerprints"],
          rigRemovalAndCompositing: ["remove support rigs while preserving contact shadows"],
        },
      },
      compositingRole: "base",
      priority: 0,
    }, {
      id: "internal-character-assignment",
      target: { scope: "entity", entityType: "character", entityId: "character-lead" },
      implementation: {
        ...createNeutralVisualImplementation("2d_animation"),
        appearance: { realism: "stylized", dimensionality: "flat_2d", finish: "graphic", descriptors: ["ink overlay"] },
        techniques: ["hand-drawn animation"],
        specification: {
          ...createNeutralVisualImplementation("2d_animation").specification,
          animationMethod: "hand_drawn",
          lineSystem: ["target character ink system"],
          colorApplication: ["limited cel color"],
          depthStrategy: ["layered planes"],
          layoutAndBackground: ["authored layout over reusable painted backgrounds"],
          performanceAndCleanup: ["preserve acting intent, deformation limits, and key/in-between/cleanup consistency"],
          motionCadence: ["drawn twos"],
          effectsAnimation: ["hand-drawn effects layer when explicitly requested"],
          compositing: ["ink overlay composite"],
        },
      },
      compositingRole: "overlay",
      priority: 10,
    }, {
      id: "internal-prop-assignment",
      target: { scope: "entity", entityType: "prop", entityId: "prop-sword" },
      implementation: {
        ...createNeutralVisualImplementation("3d_animation"),
        appearance: { realism: "stylized", dimensionality: "volumetric_3d", finish: "polished", descriptors: ["geometric prop insert"] },
        techniques: ["modeled 3d"],
        specification: {
          ...createNeutralVisualImplementation("3d_animation").specification,
          modelingLanguage: ["unrelated prop-only geometry"],
          shadingModel: ["graphic PBR"],
          lightingPipeline: ["shared scene lighting"],
          riggingSystem: ["prop control rig with locked silhouette constraints"],
          animationSystem: ["keyframed prop animation only when requested"],
          simulationPolicy: ["no unrequested simulation"],
          renderCharacter: ["clean geometric render"],
          compositing: ["embedded prop composite"],
        },
      },
      compositingRole: "embedded",
      priority: 10,
    }],
    sourceReview: { status: "current", changedFields: [], detectedAt: 1, basedOnRevision: 4 },
  },
} as Project;

const targetedCharacterStyle = buildProductionAssetVisualStyleProjection({
  project: targetedProject,
  asset: characterBoard,
});
assert.equal(targetedCharacterStyle.overrideSource, "project.characters");
assert.equal(targetedCharacterStyle.intent, "asset_identity");
assert.deepEqual(
  targetedCharacterStyle.projection.appliedMediumAssignmentIds,
  ["internal-whole-assignment", "internal-character-assignment"],
  "an asset projection must apply the whole assignment plus only that entity's assignment",
);
assert.match(targetedCharacterStyle.rendered.instruction, /target character ink system/);
assert.match(targetedCharacterStyle.rendered.instruction, /canonical character ink override/);
assert.match(targetedCharacterStyle.rendered.instruction, /角色“云照”/);
assert.doesNotMatch(targetedCharacterStyle.rendered.instruction, /unrelated prop-only geometry/);
assert.doesNotMatch(targetedCharacterStyle.rendered.instruction, /mirror override must not leak/);
assert.doesNotMatch(targetedCharacterStyle.rendered.instruction, /final surface must not enter identity boards/);
assert.doesNotMatch(targetedCharacterStyle.rendered.instruction, /internal-(?:whole|character|prop)-assignment/);

const targetedStateStyle = buildProductionAssetVisualStyleProjection({
  project: targetedProject,
  asset: { ...characterBoard, variantId: "variant-wounded", variantName: "负伤态" },
});
assert.equal(targetedStateStyle.intent, "asset_state");
assert.match(targetedStateStyle.rendered.instruction, /角色“云照”.*状态“负伤态”/);
const imageVisualStyleProjection = buildProductionAssetImageVisualStyleProjection({
  project: targetedProject,
  asset: characterBoard,
});
const compiledTargetedRequest = compileImageGenerationRequest({
  promptCore: "生成云照的角色身份参考板。",
  aspectRatio: "16:9",
  visualStyleProjection: imageVisualStyleProjection,
  visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({
    project: targetedProject,
    asset: characterBoard,
  }),
}, { enforcement: "formal" });
assert.match(compiledTargetedRequest.providerPrompt, /target character ink system/);
assert.doesNotMatch(compiledTargetedRequest.providerPrompt, /unrelated prop-only geometry/);
assert.ok(compiledTargetedRequest.manifest.blocks.some((block) => block.blockId === "image.visual_style" && block.included));

const nameOnlyProject = {
  ...targetedProject,
  characters: targetedProject.characters.map((character) => character.id === characterBoard.assetId ? {
    id: character.id,
    name: character.name,
  } : character),
} as Project;
const nameOnlyProjection = buildProductionAssetImageVisualStyleProjection({
  project: nameOnlyProject,
  asset: characterBoard,
});
assert.throws(() => compileImageGenerationRequest({
  promptCore: "生成云照的角色身份参考板。",
  aspectRatio: "16:9",
  visualStyleProjection: nameOnlyProjection,
  visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({
    project: nameOnlyProject,
    asset: characterBoard,
  }),
}, { enforcement: "formal" }), /VISUAL_RECIPE_INPUT_MISSING|identity_facts/);

const targetedPlan = buildVideoStoryboardAssetBoardPlan(targetedProject);
const targetedCharacterBoard = targetedPlan.characterBoards.find((item) => item.assetId === "character-lead")!;
const targetedLocationBoard = targetedPlan.sceneBoards.find((item) => item.assetId === "location-shrine")!;
const targetedPropBoard = targetedPlan.propBoards.find((item) => item.assetId === "prop-sword")!;
assert.doesNotMatch(targetedCharacterBoard.prompt || "", /target character ink system|unrelated prop-only geometry/);
assert.match(targetedCharacterBoard.styleLockSummary || "", /target character ink system/);
assert.doesNotMatch(targetedCharacterBoard.styleLockSummary || "", /unrelated prop-only geometry/);
assert.match(targetedLocationBoard.styleLockSummary || "", /canonical location palette/);
assert.match(targetedPropBoard.styleLockSummary || "", /unrelated prop-only geometry/);
assert.match(targetedPropBoard.styleLockSummary || "", /canonical prop asset override/);
assert.doesNotMatch(targetedPropBoard.styleLockSummary || "", /target character ink system/);

const targetedExecutionPrompt = buildProductionAssetBoardExecutionPrompt(targetedProject, targetedCharacterBoard);
assert.doesNotMatch(
  targetedExecutionPrompt,
  /\[Projected visual implementation\]|target character ink system|unrelated prop-only geometry/,
  "the raw execution prompt must not duplicate the separately submitted structured projection",
);

for (const relativePath of [
  "src/hooks/useProductionAssetBoardImage.ts",
  "src/hooks/useProductionAssetBoardBatch.ts",
  "src/hooks/useManualProductionAssetImages.ts",
]) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  assert.match(source, /buildProductionAssetImageVisualStyleProjection\(\{/);
  for (const imageCall of source.split("generateAIImage(").slice(1)) {
    assert.match(
      imageCall.slice(0, imageCall.indexOf("onPromptCompiled")),
      /visualStyleProjection,/,
      `${relativePath} must submit the targeted canonical visual projection with every asset image request`,
    );
  }
  assert.match(
    source,
    /sourceContentHash,/,
    `${relativePath} must send the generation-time source fingerprint when staging a durable candidate`,
  );
  assert.match(source, /activeProjectIdRef/);
  assert.match(source, /generationEpochRef/);
  assert.match(source, /reviewEpochRef/);
  assert.match(source, /inFlightGenerationScopesRef/);
  assert.match(source, /finally\s*\{[\s\S]{0,160}finish(?:Generation|Review)Operation\(operation\)/);
  const awaitOffsets = [...source.matchAll(/\bawait\b/g)].map((match) => match.index);
  awaitOffsets.forEach((offset, index) => {
    const nextOffset = awaitOffsets[index + 1] ?? source.length;
    assert.match(
      source.slice(offset, nextOffset),
      /is(?:Generation|Review)OperationCurrent\(operation\)/,
      `${relativePath} must validate project ownership and request epoch after every awaited operation`,
    );
  });
}

const batchHookSource = fs.readFileSync(
  path.join(process.cwd(), "src/hooks/useProductionAssetBoardBatch.ts"),
  "utf8",
);
assert.match(batchHookSource, /setCurrentProgress/);
assert.doesNotMatch(
  batchHookSource,
  /finally\s*\{\s*set(?:Progress|IsAdopting)/,
  "an obsolete batch request must not clear the active project's progress or review busy state",
);

for (const relativePath of [
  "src/components/production/ProductionAssetBoardReviewModal.tsx",
  "src/components/production/ManualProductionReferenceReviewModal.tsx",
]) {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
  assert.match(source, /来源有更新，建议复核/);
  assert.match(source, /不会自动撤销或采用/);
  assert.doesNotMatch(source, /disabled=\{[^}]*sourceReview/);
}

console.log("Production asset board visual self-check passed.");

// Regression: three copies of an auto summary and a truncated list label must not reach image generation.
const autoFields = { clothing: '黑色长外套', injury: '右肩包扎白色绷带' };
const autoSummary = '服装：黑色长外套；伤势：右肩包扎白色绷带';
const autoVariant = { id: 'auto-regression', name: '截断名称尚未发生后', description: autoSummary, promptModifiers: `保持人物身份、基本长相和未指定部位不变。当前完整可见状态：${autoSummary}。`, appearanceFields: autoFields };
const regressionProject = structuredClone(project);
regressionProject.characters[0].variants = [autoVariant];
const regressionBoard = buildVideoStoryboardAssetBoardPlan(regressionProject).variantBoards.find(b => b.variantId === autoVariant.id)!;
for (const mode of ['clean_reference', 'production_board'] as const) {
 const prompt = buildProductionAssetBoardExecutionPrompt(regressionProject, regressionBoard, mode);
 assert.equal(prompt.split('右肩包扎白色绷带').length - 1, 1);
 assert.equal(prompt.split('黑色长外套').length - 1, 1);
 assert(!prompt.includes(autoVariant.name));
 assert(!prompt.includes('状态补充') && !prompt.includes('当前完整可见状态'));
 assert(prompt.includes('指定变化优先于参考图中的旧状态'));
 assert.throws(() => buildProductionAssetBoardExecutionPrompt(regressionProject, { ...regressionBoard, variantId: 'removed-state' }, mode), /状态变体已移除/);
 assert.throws(() => buildProductionAssetBoardPromptPreview(regressionProject, { ...regressionBoard, variantId: 'removed-state', cleanPrompt: '旧的已保存提示词' }, mode), /状态变体已移除/);
}
assert.equal(assetVariantVisualInstructions(autoVariant, { ...autoVariant, appearanceFields: { clothing: '黑色长外套' } }), '伤势：右肩包扎白色绷带', 'unchanged parent fields do not become change requests');
assert.equal(assetVariantVisualInstructions({ ...autoVariant, description: '衣摆撕裂', promptModifiers: '保留右袖原有徽记' }), '衣摆撕裂\n保留右袖原有徽记', 'distinct author instructions remain intact');
console.log('变体提示词回归通过：不读截断列表名，变化只写一次，变化覆盖参考旧状态，手写要求保留，失效变体阻止生成。');

const legacySaved = '生成一张纯净三视图，这是供图片与视频生成模型直接读取的无额外说明排版的视觉参考，不是资料海报。\n主体：苏挽。\n视觉继承来源：已有生产参考（如提供）。\n白色背景，衣袖有蓝色花纹。';
const visualSaved = visualOnlySavedAssetBrief(legacySaved);
assert(!/用于|供图片|视觉继承来源/.test(visualSaved));
assert(visualSaved.includes('白色背景，衣袖有蓝色花纹。'));
assert.equal(visualOnlySavedAssetBrief('作者文字：只修改衣袖花纹'), '作者文字：只修改衣袖花纹');
for (const board of allBoards) {
 const core = buildProductionAssetBoardExecutionPrompt(project, board, 'clean_reference');
 const compiled = compileImageGenerationRequest({ promptCore: core, aspectRatio: '16:9', visualStyleProjection: buildProductionAssetImageVisualStyleProjection({ project, asset: board }), visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({ project, asset: board }) });
 assert(!/用于后续|供图片|视觉继承来源|Required evidence|Acceptance gates|Task recipe execution contract|本次 API|剧本/.test(compiled.providerPrompt));
 assert(compiled.visualRecipeContract, 'application validation remains structured');
}
