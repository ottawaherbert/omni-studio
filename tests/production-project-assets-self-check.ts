import assert from "node:assert/strict";

import type { Episode, Project, Scene } from "../src/types/project";
import {
  applyProductionSceneManualAssetBindingsToBreakdown,
  buildProductionProjectAssetReadModel,
  buildProductionSceneAssetBindingUpdate,
  buildProductionSceneAssetVariantBindingUpdate,
} from "../src/services/production/productionProjectAssets";
import {
  buildProductionAssetBoardPromptUpdate,
  buildProductionAssetBoardReferenceUpdate,
  findProductionAssetBoard,
  resolveProductionAssetBoardGenerationReference,
} from "../src/services/production/productionAssetBoardProfile";
import { buildVideoStoryboardAssetBoardPlan } from "../src/services/production/videoStoryboardAssetBoards";
import { projectAssetCatalogContext } from "../src/services/production/productionAssetReferenceContext";
import {
  buildProductionAssetBoardExecutionPlan,
  parseProductionAssetBoardExecutionPlan,
  serializeProductionAssetBoardExecutionPlan,
} from "../src/services/production/productionAssetBoardExecution";

const scene: Scene = {
  id: "scene-project-assets",
  title: "雨夜大厅",
  description: "林岚拿着开裂钥匙进入大厅。",
  valueCharge: "negative",
  breakdown: {
    setting: "INT.",
    time: "NIGHT",
    characters: [{ name: "林岚", state: "右手包扎" }],
    characterIds: ["character-linlan"],
    location: { name: "寄存柜大厅" },
    locationId: "location-hall",
    props: [{ name: "黄铜钥匙", state: "齿部开裂" }],
    propIds: ["prop-key"],
    assetVariantMap: { "prop-key": "variant-cracked" },
  },
  shots: [{
    id: "shot-project-assets",
    characterIdsInShot: ["character-linlan"],
    locationId: "location-hall",
    propIds: ["prop-key"],
  }],
};

const episode: Episode = {
  id: "episode-project-assets",
  title: "第一集",
  inspiration: "",
  scenes: [scene],
};

const project: Project = {
  id: "project-assets-library",
  title: "雨夜寄存柜",
  type: "movie",
  aspectRatio: "16:9",
  logline: "",
  coreConflict: "",
  characters: [{
    id: "character-linlan",
    name: "林岚",
    visualIdentity: "二十七岁，短发，右眉尾有浅疤，深蓝配送夹克。",
    psychologicalProfile: "高压下先观察出口，再决定行动。",
    mbti: "INTJ",
    enneagram: "6w5",
    actingStyle: "迈斯纳派 (Meisner)",
    referenceImageUrl: "/media/linlan.png",
    boardImageUrl: "/media/linlan-board.png",
    multiViewPrompt: "legacy-character-grid-layout",
    variants: [{ id: "variant-bandage", name: "右手包扎", description: "右手白色纱布", promptModifiers: "bandaged right hand", boardImageUrl: "/media/linlan-bandage-board.png" }],
  }],
  assets: [
    { id: "char-character-linlan", type: "character", name: "林岚", description: "角色镜像资产" },
    { id: "location-hall", type: "location", name: "寄存柜大厅", description: "旧车站大厅", imageUrl: "/media/hall.png", boardImageUrl: "/media/hall-board.png", panoramaPrompt: "legacy-location-panorama-layout" },
    {
      id: "prop-key",
      type: "prop",
      name: "黄铜钥匙",
      description: "做旧黄铜钥匙",
      imageUrl: "/media/key.png",
      boardImageUrl: "/media/key-board.png",
      multiViewPrompt: "legacy-prop-grid-layout",
      variants: [{ id: "variant-cracked", name: "齿部开裂", description: "钥匙齿部开裂", promptModifiers: "cracked teeth", imageUrl: "/media/key-cracked.png", boardImageUrl: "/media/key-cracked-board.png" }],
    },
    { id: "wardrobe-coat", type: "wardrobe", name: "配送夹克", description: "深蓝配送夹克" },
  ],
  episodes: [{ id: episode.id, title: episode.title, inspiration: "" }],
};

const readModel = buildProductionProjectAssetReadModel(project, [episode]);
assert.equal(readModel.totalAssetCount, 4, "character mirror assets must not duplicate the canonical character");
assert.equal(readModel.totalVariantCount, 2);
assert.equal(readModel.linkedSceneCount, 1);
assert.equal(readModel.assets.find((asset) => asset.id === "prop-key")?.usageRefs[0]?.variantId, "variant-cracked");
assert.equal(readModel.assets.find((asset) => asset.id === "wardrobe-coat")?.usageRefs.length, 0, "free-text wardrobe names must not be guessed into structured bindings");
assert.equal(readModel.assets.find((asset) => asset.id === "character-linlan")?.boardImageUrl, "/media/linlan-board.png");
assert.equal(readModel.assets.find((asset) => asset.id === "character-linlan")?.sourceImageUrl, "/media/linlan.png", "seed material must remain separate from the adopted character board");
const boardPlan = buildVideoStoryboardAssetBoardPlan(project);
const plannedCharacterBoard = boardPlan.characterBoards.find((item) => item.assetId === "character-linlan");
const allBoardItems = [
  ...boardPlan.characterBoards,
  ...boardPlan.sceneBoards,
  ...boardPlan.propBoards,
  ...boardPlan.variantBoards,
];
const executionPlan = buildProductionAssetBoardExecutionPlan(project, allBoardItems);
assert.equal(executionPlan.items.length, allBoardItems.length);
assert.ok(executionPlan.items.find((item) => item.boardItemId === plannedCharacterBoard?.id)?.executionPrompt.includes("林岚"));
const narrativeProject = { ...project, title: '内部项目名称', logline: '林岚在下一集为亲人复仇，绝密剧情', coreConflict: '幕后故事信息' };
const scopedExecutionPlan = buildProductionAssetBoardExecutionPlan(narrativeProject, allBoardItems);
assert.deepEqual(scopedExecutionPlan.items.map(item => item.executionPrompt), executionPlan.items.map(item => item.executionPrompt), 'image prompts never receive project story context');
const crackedVariantPrompt = executionPlan.items.find((item) => item.variantName === "齿部开裂")?.executionPrompt || "";
assert.ok(crackedVariantPrompt.includes("所有视图保持同一外观"));
assert.ok(crackedVariantPrompt.includes("不做前后对比"));
assert.equal(crackedVariantPrompt.includes("关键差异细节和状态前后对比"), false);
const scopedCatalog = projectAssetCatalogContext({
  ...project,
  characters: [...project.characters, { id: "character-unrelated", name: "无关角色" }],
  assets: [
    ...project.assets,
    { id: "location-unrelated", type: "location", name: "无关地点", description: "不会在当前场出现" },
    { id: "prop-unrelated", type: "prop", name: "无关道具", description: "不会在当前场出现" },
  ],
}, { sourceText: scene.description, breakdown: scene.breakdown });
assert.match(scopedCatalog, /character-linlan|location-hall|prop-key/);
assert.doesNotMatch(scopedCatalog, /character-unrelated|location-unrelated|prop-unrelated/);
assert.ok(boardPlan.variantBoards.find((item) => item.variantName === "齿部开裂")?.prompt?.includes("单一当前状态参考板"));
assert.ok(boardPlan.variantBoards.find((item) => item.variantName === "齿部开裂")?.prompt?.includes("禁止基础状态小参考区、变化时间线、状态前后对比、其他变体、未来状态"));
const serializedExecutionPlan = serializeProductionAssetBoardExecutionPlan(executionPlan);
assert.deepEqual(
  parseProductionAssetBoardExecutionPlan(serializedExecutionPlan, allBoardItems.map((item) => item.id)),
  executionPlan,
  "the editable confirmation payload must be the exact per-board execution contract",
);
assert.ok(plannedCharacterBoard?.prompt?.includes("【可见身份锚点】"));
assert.equal(plannedCharacterBoard?.prompt?.includes("MBTI INTJ；九型 6w5"), false);
assert.equal(plannedCharacterBoard?.prompt?.includes("迈斯纳派"), false);
assert.equal(plannedCharacterBoard?.prompt?.includes("legacy-character-grid-layout"), false, "legacy multi-view prompts must not leak into the new character-board strategy");
assert.equal(boardPlan.sceneBoards[0]?.prompt?.includes("legacy-location-panorama-layout"), false, "legacy panorama prompts must not leak into the new scene-board strategy");
assert.equal(boardPlan.propBoards[0]?.prompt?.includes("legacy-prop-grid-layout"), false, "legacy multi-view prompts must not leak into the new prop-board strategy");
const seedOnlyProject: Project = {
  ...project,
  characters: project.characters.map((item) => item.id === "character-linlan" ? { ...item, boardImageUrl: undefined, multiViewUrl: undefined } : item),
};
assert.equal(
  buildVideoStoryboardAssetBoardPlan(seedOnlyProject).characterBoards.find((item) => item.assetId === "character-linlan")?.referenceImageUrl,
  undefined,
  "a portrait seed must not silently become the formal character-board reference",
);

const characterBoard = findProductionAssetBoard(project, "character-linlan");
assert.equal(characterBoard?.boardKind, "character_board");
const promptUpdate = buildProductionAssetBoardPromptUpdate({
  project,
  assetId: "character-linlan",
  prompt: "自定义角色板提示词",
});
assert.equal(promptUpdate.characters.find((item) => item.id === "character-linlan")?.boardPrompt, "自定义角色板提示词");
const referenceUpdate = buildProductionAssetBoardReferenceUpdate({
  project,
  boardItemId: characterBoard!.id,
  imageUrl: "/media/linlan-board-v2.png",
  source: "ai_generation",
  finalPrompt: characterBoard?.prompt || "",
  modelId: "image-test-model",
  selectedSkillIds: ["skill-character-identity"],
  selectedSkillTitles: ["角色一致性"],
  selectedContextIds: ["ctx-character-linlan"],
  createdAt: 100,
});
assert.equal(referenceUpdate.characters.find((item) => item.id === "character-linlan")?.boardImageUrl, "/media/linlan-board-v2.png");
assert.equal(referenceUpdate.characters.find((item) => item.id === "character-linlan")?.multiViewUrl, "/media/linlan-board-v2.png", "legacy consumers should receive the adopted board during migration");
assert.equal(referenceUpdate.manualProductionAssets.references?.[0]?.modelId, "image-test-model");
assert.equal(referenceUpdate.manualProductionAssets.references?.[0]?.finalPrompt, characterBoard?.prompt);
assert.deepEqual(referenceUpdate.manualProductionAssets.references?.[0]?.selectedSkillTitles, ["角色一致性"]);

const sequentialProject: Project = {
  ...project,
  assets: project.assets.map((item) => item.id !== "prop-key" ? item : {
    ...item,
    variants: [
      ...(item.variants || []),
      {
        id: "variant-open",
        name: "开启状态",
        description: "钥匙机关已开启",
        promptModifiers: "opened mechanism",
        referenceVariantId: "variant-cracked",
      },
    ],
  }),
};
const sequentialBoard = findProductionAssetBoard(sequentialProject, "prop-key", "variant-open")!;
const sequentialReference = resolveProductionAssetBoardGenerationReference(sequentialProject, sequentialBoard);
assert.equal(sequentialReference.imageUrl, "/media/key-cracked-board.png");
assert.ok(sequentialReference.label.includes("齿部开裂"));
assert.ok(
  buildProductionAssetBoardExecutionPlan(sequentialProject, [sequentialBoard]).items[0]?.executionPrompt.includes("钥匙机关已开启"),
  "generation describes the target appearance while the reference selector supplies the actual parent image",
);
const unavailableSequentialProject: Project = {
  ...sequentialProject,
  assets: sequentialProject.assets.map((item) => item.id !== "prop-key" ? item : {
    ...item,
    variants: item.variants?.map((variant) => variant.id === "variant-cracked"
      ? { ...variant, boardImageUrl: undefined, imageUrl: undefined }
      : variant),
  }),
};
const unavailableReference = resolveProductionAssetBoardGenerationReference(
  unavailableSequentialProject,
  findProductionAssetBoard(unavailableSequentialProject, "prop-key", "variant-open")!,
);
assert.equal(unavailableReference.imageUrl, undefined);
assert.match(unavailableReference.issue || "", /先完成上游状态变体板/);
const reusedReferenceUpdate = buildProductionAssetBoardReferenceUpdate({
  project: sequentialProject,
  boardItemId: sequentialBoard.id,
  imageUrl: sequentialReference.imageUrl!,
  source: "existing",
  finalPrompt: "沿用已确认状态板",
  inputReferenceUrl: sequentialReference.imageUrl,
  createdAt: 200,
});
assert.equal(
  reusedReferenceUpdate.assets.find((item) => item.id === "prop-key")?.variants?.find((item) => item.id === "variant-open")?.boardImageUrl,
  "/media/key-cracked-board.png",
);
assert.equal(reusedReferenceUpdate.manualProductionAssets.references?.at(-1)?.source, "existing");

const baseBinding = buildProductionSceneAssetVariantBindingUpdate({ project, scene, assetId: "prop-key" });
assert.equal(baseBinding.breakdown?.assetVariantMap?.["prop-key"], undefined);
const changedBinding = buildProductionSceneAssetVariantBindingUpdate({ project, scene, assetId: "character-linlan", variantId: "variant-bandage" });
assert.equal(changedBinding.breakdown?.assetVariantMap?.["character-linlan"], "variant-bandage");
assert.throws(
  () => buildProductionSceneAssetVariantBindingUpdate({ project, scene, assetId: "wardrobe-coat" }),
  /不在当前场的正式拆解/,
);
assert.throws(
  () => buildProductionSceneAssetVariantBindingUpdate({ project, scene, assetId: "prop-key", variantId: "variant-unknown" }),
  /不属于该项目资产/,
);

const manualBindingProject: Project = {
  ...project,
  assets: [
    ...project.assets,
    {
      id: "location-canonical-hall",
      type: "location",
      name: "旧车站寄存柜大厅",
      description: "已经完成视觉确认的项目场景资产",
      boardImageUrl: "/media/canonical-hall-board.png",
    },
  ],
};
const manuallyBoundScene: Scene = {
  ...scene,
  scriptBlocks: [{ id: "block-location", type: "scene_heading", content: "雨夜大厅", linkedAssetId: "location-hall", locationId: "location-hall" }],
};
const manualBindingUpdate = buildProductionSceneAssetBindingUpdate({
  project: manualBindingProject,
  scene: manuallyBoundScene,
  sourceAssetId: "location-hall",
  targetAssetId: "location-canonical-hall",
  assetType: "location",
  now: 500,
});
assert.equal(manualBindingUpdate.breakdown?.locationId, "location-canonical-hall");
assert.equal(manualBindingUpdate.shots?.[0]?.locationId, "location-canonical-hall");
assert.equal(manualBindingUpdate.scriptBlocks?.[0]?.locationId, "location-canonical-hall");
assert.equal(manualBindingUpdate.scriptBlocks?.[0]?.linkedAssetId, "location-canonical-hall");
assert.deepEqual(manualBindingUpdate.productionPreparation?.assetBindings?.[0], {
  assetType: "location",
  sourceAssetId: "location-hall",
  sourceAssetName: "寄存柜大厅",
  targetAssetId: "location-canonical-hall",
  targetAssetName: "旧车站寄存柜大厅",
  boundAt: 500,
});

const reboundAfterBreakdown = applyProductionSceneManualAssetBindingsToBreakdown({
  project: {
    ...manualBindingProject,
    assets: [
      ...manualBindingProject.assets,
      { id: "location-reroll", type: "location", name: "寄存柜大厅", description: "重新拆解临时创建的同名场景" },
    ],
  },
  scene: { ...manuallyBoundScene, productionPreparation: manualBindingUpdate.productionPreparation },
  breakdown: { ...scene.breakdown!, locationId: "location-reroll" },
});
assert.equal(
  reboundAfterBreakdown.locationId,
  "location-canonical-hall",
  "an explicit author binding must survive later automatic breakdown adoption",
);

console.log("Production project assets self-check passed.");
