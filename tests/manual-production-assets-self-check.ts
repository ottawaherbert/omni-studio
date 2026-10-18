import assert from "node:assert/strict";
import type { Episode, ManualFilmTeamOutput, Project, Scene } from "../src/types/project";
import {
  MANUAL_FILM_TEAM_DEPARTMENTS,
  manualFilmTeamBreakdownHash,
  manualFilmTeamFullScriptHash,
  manualFilmTeamScriptHash,
  manualFilmTeamUnitSource,
} from "../src/services/production/manualFilmTeam";
import { buildManualFilmTeamReadModel } from "../src/services/production/manualFilmTeamReadModel";
import { defaultTemplates } from "../src/config/prompts";
import { productionTemplateMetadataRegistry } from "../src/services/production/templateMetadata";
import { runManualPromptGatewayReview } from "../src/services/production/manualGateway";
import {
  buildManualProductionAssetReadModel,
  buildManualProductionReferenceImageUpdate,
  buildManualProductionVariantUpdate,
  confirmManualProductionAssetBoard,
  revokeManualProductionAssetBoard,
} from "../src/services/production/manualProductionAssets";
import { buildManualStoryboardSourceHash } from "../src/services/production/manualStoryboard";
import {
  buildProductionAssetProfileContext,
  productionAssetProfileTarget,
} from "../src/services/production/productionAssetProfileContext";
import {
  applyProductionAssetProfileEnrichmentLocks,
  buildProductionAssetProfileReviewPrompt,
  loadProductionAssetProfileSources,
} from "../src/hooks/useProductionAssetProfileAI";
import { legacyProjectClient } from "../src/clients/legacyProjectClient";
import {
  buildProductionAssetPreparationContext,
  buildProductionAssetPreparationSceneUpdates,
  normalizeProductionAssetPreparationCandidate,
  productionAssetPreparationVariantId,
} from "../src/services/production/productionAssetPreparation";

const scene: Scene = {
  id: "scene-assets",
  title: "雨夜天台",
  description: "林夏在天台找到被雨水浸湿的录音笔。",
  valueCharge: "negative",
  script: "外景。雨夜。林夏捡起录音笔，红灯仍在闪烁。",
  breakdown: {
    setting: "EXT.",
    location: { name: "旧楼天台", state: "暴雨" },
    locationId: "location-rooftop",
    time: "NIGHT",
    characters: [{ name: "林夏", state: "淋湿" }],
    characterIds: ["character-linxia"],
    props: [{ name: "录音笔", state: "浸水后仍工作" }],
    propIds: ["prop-recorder"],
    wardrobe: ["深色风衣被雨浸透"],
    makeupHair: ["湿发贴在脸侧"],
    assetVariantMap: { "prop-recorder": "variant-wet" },
  },
  shots: [{
    id: "shot-assets-1",
    characterIdsInShot: ["character-linxia"],
    locationId: "location-rooftop",
    propIds: ["prop-recorder"],
    imagePrompt: "林夏在雨夜天台捡起录音笔。",
    videoPrompt: "镜头缓慢推进，录音笔红灯闪烁。",
  }],
};

assert.ok(defaultTemplates.productionAssetVariant?.template.includes("{{stateSummary}}"), "variant generation must use a visible editable prompt template");
assert.equal(productionTemplateMetadataRegistry.productionAssetVariant.stageType, "asset_sync");
const variantPromptReview = await runManualPromptGatewayReview({
  templateId: "productionAssetVariant",
  finalPrompt: "根据当前场景结构化状态为录音笔创建浸水状态变体，只描述可见差异并返回约定 JSON。",
  currentTemplate: defaultTemplates.productionAssetVariant.template,
  variables: {
    assetType: "prop",
    assetName: "录音笔",
    baseDescription: "黑色金属录音笔",
    sceneTitle: scene.title,
    scriptContent: scene.script || "",
    stateSummary: "表面挂满雨水但红灯仍亮",
    selectedContext: "",
    userIntent: "",
    skills: "",
  },
  selectedContextIds: [],
  selectedSkillIds: [],
});
assert.equal(variantPromptReview.qaVerdicts.some((item) => item.blocking), false);

const episode = {
  id: "episode-assets",
  title: "第一集",
  inspiration: "雨夜证据",
  scenes: [scene],
} as Episode;

const project: Project = {
  id: "project-assets",
  title: "雨夜证据",
  type: "movie",
  aspectRatio: "16:9",
  logline: "林夏必须在追捕者到来前取回证据。",
  coreConflict: "真相与追捕。",
  characters: [{ id: "character-linxia", name: "林夏", referenceImageUrl: "data:image/png;base64,character-seed", boardImageUrl: "data:image/png;base64,character-board" }],
  assets: [
    { id: "location-rooftop", type: "location", name: "旧楼天台", description: "水泥地面和锈蚀护栏。", imageUrl: "data:image/png;base64,location-seed", boardImageUrl: "data:image/png;base64,location-board" },
    {
      id: "prop-recorder",
      type: "prop",
      name: "录音笔",
      description: "黑色金属录音笔，红色工作灯。",
      imageUrl: "data:image/png;base64,prop-seed",
      boardImageUrl: "data:image/png;base64,prop-board",
      variants: [{ id: "variant-wet", name: "浸水状态", description: "表面挂满雨水但红灯仍亮。", promptModifiers: "water droplets", imageUrl: "data:image/png;base64,prop-wet", boardImageUrl: "data:image/png;base64,prop-wet-board" }],
    },
    { id: "prop-unrelated", type: "prop", name: "办公室钥匙", description: "不属于当前场。", imageUrl: "data:image/png;base64,key" },
  ],
  episodes: [{ id: episode.id, title: episode.title, inspiration: episode.inspiration }],
};

assert.ok(defaultTemplates.productionAssetPreparationBatch?.template.includes("不能用正则"), "the batch prompt must require semantic state understanding instead of keyword rules");
assert.equal(productionTemplateMetadataRegistry.productionAssetPreparationBatch.stageType, "asset_sync");
const preparationContext = buildProductionAssetPreparationContext(project, [episode]);
assert.deepEqual(preparationContext.assets.map((item) => item.id), ["character-linxia", "location-rooftop", "prop-recorder"], "asset governance must include only canonical assets structurally referenced by the selected scenes");
assert.equal(preparationContext.scenes.length, 1, "scene evidence must be injected once per scene instead of repeated for every asset usage");
assert.equal(preparationContext.usages.length, 3, "every sceneId + assetId usage must receive an explicit semantic state decision");
assert.equal("sceneScript" in preparationContext.usages[0], false, "the compact usage table must not duplicate full scene scripts");
const normalizedPreparation = normalizeProductionAssetPreparationCandidate({
  project,
  context: preparationContext,
  raw: {
    profiles: [
      {
        assetId: "character-linxia", assetType: "character", name: "林夏",
        visualIdentity: "【候选设计】短发女性，沿用已确认身份参考。", psychologicalProfile: "以保护证据为外在行动目标。",
        mbti: "", enneagram: "", internalDesire: "查明真相", externalGoal: "取回证据", flaw: "高压下过度独行",
        actingStyle: "自然主义的克制表演", vocalQuirk: "短句、低声、急促停顿", sliders: { 警觉: 8 }, description: "", tags: [],
        evidence: ["林夏必须取回证据。"], assumptions: ["短发造型为【候选设计】。"],
      },
      { assetId: "location-rooftop", assetType: "location", name: "旧楼天台", description: "水泥地面、锈蚀护栏与可拍摄的开放边界。", tags: ["水泥", "锈蚀护栏"], evidence: ["项目资产登记：水泥地面和锈蚀护栏。"], assumptions: [] },
      { assetId: "prop-recorder", assetType: "prop", name: "录音笔", description: "黑色金属机身与红色工作灯。", tags: ["黑色金属", "红色工作灯"], evidence: ["项目资产登记：黑色金属录音笔，红色工作灯。"], assumptions: [] },
    ],
    decisions: [
      { sceneId: scene.id, assetId: "character-linxia", assetType: "character", use: "base", existingVariantId: "", variantKey: "", variantName: "", visibleDelta: "", promptModifiers: "", reason: "动作不改变身份参考。", evidence: "林夏捡起录音笔。" },
      { sceneId: scene.id, assetId: "location-rooftop", assetType: "location", use: "variant", existingVariantId: "", variantKey: "rain-night", variantName: "暴雨夜状态", visibleDelta: "地面与护栏被暴雨打湿。", promptModifiers: "wet concrete, active rainfall", reason: "天气会改变场景参考图。", evidence: "外景。雨夜。" },
      { sceneId: scene.id, assetId: "prop-recorder", assetType: "prop", use: "variant", existingVariantId: "variant-wet", variantKey: "wet-working", variantName: "浸水状态", visibleDelta: "", promptModifiers: "", reason: "复用既有浸水工作状态。", evidence: "录音笔被雨水浸湿且红灯闪烁。" },
    ],
  },
});
assert.deepEqual(normalizedPreparation.structureErrors, [], "a complete ID-safe profile and semantic state candidate must pass structural validation");
const rooftopDecision = normalizedPreparation.decisions.find((item) => item.assetId === "location-rooftop")!;
assert.ok(productionAssetPreparationVariantId(rooftopDecision).startsWith("manual-variant-location-rooftop-"));
const preparationSceneUpdates = buildProductionAssetPreparationSceneUpdates([episode], normalizedPreparation.decisions);
assert.equal(preparationSceneUpdates[0].breakdown.assetVariantMap?.["prop-recorder"], "variant-wet", "an exact existing visual state must reuse its stable variant ID");
assert.equal(preparationSceneUpdates[0].breakdown.assetVariantMap?.["character-linxia"], undefined, "action-only state must remain on the base identity without a fabricated variant");

const blockedReadModel = buildManualProductionAssetReadModel({ project, episode, scene });
assert.equal(blockedReadModel.assetBoards.length, 4, "current scene should expose three base boards and one selected variant board");
assert.equal(blockedReadModel.assetBoards.some((item) => item.assetId === "prop-unrelated"), false, "unrelated project assets must not enter the current scene pack");
assert.equal(blockedReadModel.blockedBoardCount, 0, "missing department work must not cascade into disabled asset controls");
assert.doesNotThrow(() => confirmManualProductionAssetBoard({ project, episode, scene, boardItemId: blockedReadModel.assetBoards[0].boardItemId }));

const promptHash = manualFilmTeamScriptHash(manualFilmTeamUnitSource(project, episode).text);
const breakdownHash = manualFilmTeamBreakdownHash(episode);
const downstreamBindingHash = manualFilmTeamBreakdownHash({
  ...episode,
  scenes: [{
    ...scene,
    breakdown: { ...scene.breakdown!, assetVariantMap: { "prop-recorder": "another-approved-variant" } },
  }],
});
assert.equal(downstreamBindingHash, breakdownHash, "adopting downstream asset variants must not invalidate confirmed department preparation");
const fullScriptHash = manualFilmTeamFullScriptHash(project);
const confirmedOutputs: ManualFilmTeamOutput[] = MANUAL_FILM_TEAM_DEPARTMENTS.map((department) => ({
  department: department.id,
  sourceScriptHash: promptHash,
  sourceBreakdownHash: breakdownHash,
  fullScriptHash,
  sourceSceneIds: [scene.id],
  taskSummary: `${department.name}已完成当前制片单元筹备。`,
  content: `${department.name}单元总体筹备结果。`,
  scenePlans: [{
    sceneId: scene.id,
    sceneTitle: scene.title,
    summary: `${department.name}当前场执行任务。`,
    executionNotes: ["按正式拆解执行"],
    assetNeeds: [],
    continuityNotes: [],
    handoffNotes: [],
  }],
  openQuestions: [],
  handoffNotes: [],
  status: "confirmed",
  version: 1,
  audit: {
    action: "generate",
    templateId: "productionTeamGenerate",
    promptHash: `prompt-${department.id}`,
    selectedSkillIds: [],
    selectedSkillTitles: [],
    selectedContextIds: [],
    createdAt: 1,
  },
  qa: {
    score: 92,
    verdict: "pass",
    summary: "可执行",
    strengths: ["职责清楚"],
    issues: [],
    audit: {
      action: "qa",
      templateId: "productionTeamQa",
      promptHash: `qa-${department.id}`,
      selectedSkillIds: [],
      selectedSkillTitles: [],
      selectedContextIds: [],
      createdAt: 2,
    },
    reviewedAt: 2,
  },
  updatedAt: 2,
  confirmedAt: 2,
}));
const confirmedScene: Scene = {
  ...scene,
};
const episodeWithConfirmedTeam = (scenes: Scene[]): Episode => {
  const scopedEpisode = { ...episode, scenes };
  const scopedScriptHash = manualFilmTeamScriptHash(manualFilmTeamUnitSource(project, scopedEpisode).text);
  const scopedBreakdownHash = manualFilmTeamBreakdownHash(scopedEpisode);
  const outputs = confirmedOutputs.map((output) => ({
    ...output,
    sourceScriptHash: scopedScriptHash,
    sourceBreakdownHash: scopedBreakdownHash,
    sourceSceneIds: scenes.map((item) => item.id),
    scenePlans: scenes.map((item) => ({
      sceneId: item.id,
      sceneTitle: item.title,
      summary: `${output.department}当前场执行任务。`,
      executionNotes: ["按正式拆解执行"],
      assetNeeds: [],
      continuityNotes: [],
      handoffNotes: [],
    })),
  }));
  return {
    ...scopedEpisode,
    productionTeam: {
      schemaVersion: "manual-film-team.v2",
      episodeId: episode.id,
      sourceScriptHash: scopedScriptHash,
      sourceBreakdownHash: scopedBreakdownHash,
      fullScriptHash,
      sourceSceneIds: scenes.map((item) => item.id),
      outputs,
      updatedAt: 2,
    },
  };
};
const confirmedEpisode = episodeWithConfirmedTeam([confirmedScene]);
const episodeWithWorkspaceQaView: Episode = {
  ...confirmedEpisode,
  productionTeam: confirmedEpisode.productionTeam
    ? {
        ...confirmedEpisode.productionTeam,
        outputs: confirmedEpisode.productionTeam.outputs.map((output) => ({
          ...output,
          qa: output.qa ? {
            ...output.qa,
            coverage: [{
              itemId: `${output.department}-coverage`,
              judgment: "grounded_fact",
              outputEvidence: "已采用的部门筹备内容。",
              sourceEvidence: "已确认的剧本与场次拆解。",
              note: "只用于审计展示，不参与资产治理来源语义。",
            }],
          } : undefined,
        })),
      }
    : undefined,
};
const fullQaPreparationContext = buildProductionAssetPreparationContext(project, [episodeWithWorkspaceQaView]);
const strippedQaPreparationContext = buildProductionAssetPreparationContext(project, [{
  ...episodeWithWorkspaceQaView,
  productionTeam: episodeWithWorkspaceQaView.productionTeam
    ? {
        ...episodeWithWorkspaceQaView.productionTeam,
        outputs: episodeWithWorkspaceQaView.productionTeam.outputs.map((output) => {
          if (!output.qa) return output;
          const { coverage: _coverage, ...qa } = output.qa;
          return { ...output, qa };
        }),
      }
    : undefined,
}]);
assert.equal(
  fullQaPreparationContext.sourceHash,
  strippedQaPreparationContext.sourceHash,
  "asset governance hashes must remain stable when a workspace read omits bulky QA coverage evidence",
);
const changedDepartmentContentContext = buildProductionAssetPreparationContext(project, [{
  ...episodeWithWorkspaceQaView,
  productionTeam: episodeWithWorkspaceQaView.productionTeam
    ? {
        ...episodeWithWorkspaceQaView.productionTeam,
        outputs: episodeWithWorkspaceQaView.productionTeam.outputs.map((output, index) =>
          index === 0 ? { ...output, content: `${output.content} 已变更。` } : output),
      }
    : undefined,
}]);
assert.notEqual(
  fullQaPreparationContext.sourceHash,
  changedDepartmentContentContext.sourceHash,
  "asset governance hashes must still invalidate when adopted department content changes",
);

const profileSourceDocumentId = "source-assets";
const profileEpisode: Episode = {
  ...confirmedEpisode,
  sourceDocumentId: profileSourceDocumentId,
  scenes: confirmedEpisode.scenes.map((item) => ({ ...item, sourceDocumentId: profileSourceDocumentId })),
};
const profileProject: Project = {
  ...project,
  episodes: [{
    id: profileEpisode.id,
    title: profileEpisode.title,
    inspiration: profileEpisode.inspiration,
    sourceDocumentId: profileSourceDocumentId,
  }],
  productionSourceDocuments: [{
    id: profileSourceDocumentId,
    order: 0,
    kind: "episode",
    title: "第一集完整剧本",
    content: "外景。雨夜。林夏穿着被雨浸透的深色风衣，在旧楼天台捡起黑色录音笔，红灯仍在闪烁。",
    sourceHash: "source-assets-hash",
    isWorkRange: true,
    createdAt: 1,
  }],
};
const profileContext = buildProductionAssetProfileContext(
  profileProject,
  productionAssetProfileTarget(profileProject.characters[0]),
  [profileEpisode],
);
assert.equal(profileContext.options.length, 3, "asset profiling should include source evidence and adopted department continuity");
assert.equal(profileContext.defaultIds.length, 3, "production evidence should be selected by default rather than hidden behind manual context selection");
assert.match(profileContext.options[0].value, /深色风衣被雨浸透/);
assert.match(profileContext.options[0].value, /与当前资产相关的拆解参考/);
assert.doesNotMatch(profileContext.options[0].value, /旧楼天台/);
assert.match(profileContext.options[2].value, /已采用的专业部门结果/);
assert.match(profileContext.options[0].value, /来源原文与作者明确决定优先/);
const unboundSource = `${profileProject.productionSourceDocuments![0].content}\n${"完整正文。".repeat(3000)}\n来源末尾`;
const unboundProfileProject = {
  ...profileProject,
  productionSourceDocuments: [{ ...profileProject.productionSourceDocuments![0], content: unboundSource }],
};
const unboundProfileContext = buildProductionAssetProfileContext(
  unboundProfileProject, productionAssetProfileTarget(profileProject.characters[0]), [],
);
assert.equal(unboundProfileContext.defaultIds.length, 1, "an unbound character must still receive its imported source");
assert.ok(unboundProfileContext.options[0].value.includes(unboundSource), "unbound source must not be truncated");
assert.match(unboundProfileContext.options[0].value, /尚无已确认场次绑定/);
assert.doesNotMatch(unboundProfileContext.options[0].value, /【与当前资产相关的已确认拆解】/);
const multiSourceContext = buildProductionAssetProfileContext({
  ...unboundProfileProject,
  productionSourceDocuments: [...unboundProfileProject.productionSourceDocuments, {
    ...profileProject.productionSourceDocuments![0], id: "unrelated-episode", title: "另一个单元", content: "其他人的故事。",
  }],
}, productionAssetProfileTarget(profileProject.characters[0]), []);
assert.equal(multiSourceContext.options.length, 2, "other source documents remain available for author selection");
assert.equal(multiSourceContext.defaultIds.length, 1, "unrelated episodes must not be silently selected");
const originalGetProject = legacyProjectClient.getProject;
const originalGetEpisode = legacyProjectClient.getEpisode;
try {
  legacyProjectClient.getProject = async (_id, view, options) => {
    assert.equal(view, "production-workspace");
    assert.equal(options?.sourceDocumentId, profileSourceDocumentId);
    return unboundProfileProject;
  };
  legacyProjectClient.getEpisode = async (_id, _episodeId, view, options) => {
    assert.equal(view, "production-preparation");
    assert.equal(options?.scope, "episode", "asset profiling needs all scene bodies, not the scene index");
    return profileEpisode;
  };
  const shellProject = { ...profileProject, productionSourceDocuments: [{ ...profileProject.productionSourceDocuments![0], content: "" }] };
  const loadedProfile = await loadProductionAssetProfileSources(shellProject);
  assert.equal(loadedProfile.project.productionSourceDocuments[0].content, unboundSource);
  assert.equal(loadedProfile.episodes[0], profileEpisode);
  assert.equal(shellProject.productionSourceDocuments[0].content, "", "context loading must not mutate the live project shell");
  legacyProjectClient.getProject = async () => null;
  await assert.rejects(loadProductionAssetProfileSources(shellProject), /无法读取完整来源/);
} finally {
  legacyProjectClient.getProject = originalGetProject;
  legacyProjectClient.getEpisode = originalGetEpisode;
}
const lockedProfileProposal = applyProductionAssetProfileEnrichmentLocks({
  currentValues: { name: "林夏", mbti: "ISTJ", enneagram: "8w7", visualIdentity: "" },
  proposedValues: { name: "林霞", mbti: "ENTP", enneagram: "8w9", visualIdentity: "深色风衣" },
  isCharacter: true,
});
assert.equal(lockedProfileProposal.name, "林夏", "profile enrichment must not silently rename an adopted character");
assert.equal(lockedProfileProposal.mbti, "ISTJ", "profile enrichment must preserve adopted behavior keys");
assert.equal(lockedProfileProposal.enneagram, "8w7", "profile enrichment must preserve adopted enneagram values");
assert.equal(lockedProfileProposal.visualIdentity, "深色风衣");
const profileReviewPrompt = buildProductionAssetProfileReviewPrompt({
  generationPrompt: "以完整剧本和已确认拆解为证据。",
  currentValues: { name: "林夏", visualIdentity: "深色风衣" },
  proposedValues: { name: "林夏", visualIdentity: "28岁，鹅蛋脸，深色风衣" },
  isCharacter: true,
  attempt: 1,
});
assert.match(profileReviewPrompt, /【候选设计】/);
assert.match(profileReviewPrompt, /项目级基础身份不得混入/);
assert.match(profileReviewPrompt, /评分不低于 90/);

const reviewReadModel = buildManualProductionAssetReadModel({ project, episode: confirmedEpisode, scene: confirmedScene });
assert.equal(reviewReadModel.blockedBoardCount, 0);
assert.equal(reviewReadModel.assetBoards.every((item) => item.approvalState === "needs_confirmation"), true);
assert.equal(reviewReadModel.sceneVisualPack?.referenceSlots.length, 3);
assert.equal(reviewReadModel.assetReferencePack?.items.length, 3, "model reference pack should contain only current character, location, and prop");
assert.equal(reviewReadModel.assetReferencePack?.items.find((item) => item.assetId === "prop-recorder")?.variantId, "variant-wet");
assert.equal(reviewReadModel.sceneStates.find((item) => item.assetId === "prop-recorder")?.variantId, "variant-wet");
assert.equal(reviewReadModel.missingReferenceCount, 0);

const confirmedFilmTeam = buildManualFilmTeamReadModel({ project, episode: confirmedEpisode });
const generatedShotScene: Scene = {
  ...confirmedScene,
  shots: [{
    ...confirmedScene.shots![0],
    id: "shot-assets-generated",
    lighting: "冷色顶光和红色指示灯反光",
    lightingAtmo: "暴雨中的低照度冷色环境",
    continuityNote: "从林夏捡起录音笔的动作接入，保持越轴前的视线方向。",
  }],
};
const afterShotReadModel = buildManualProductionAssetReadModel({
  project,
  episode: { ...confirmedEpisode, scenes: [generatedShotScene] },
  scene: generatedShotScene,
});
assert.equal(
  afterShotReadModel.assetPackHash,
  reviewReadModel.assetPackHash,
  "writing downstream Shots must not mutate the upstream scene asset pack",
);
assert.equal(
  buildManualStoryboardSourceHash(confirmedFilmTeam, afterShotReadModel),
  buildManualStoryboardSourceHash(confirmedFilmTeam, reviewReadModel),
  "adopting a Shot plan must not invalidate its own storyboard source hash",
);

const multiCharacterProject: Project = {
  ...project,
  characters: [...project.characters, { id: "character-luchen", name: "陆沉", referenceImageUrl: "data:image/png;base64,luchen-seed", boardImageUrl: "data:image/png;base64,luchen-board" }],
};
const multiCharacterScene: Scene = {
  ...scene,
  id: "scene-assets-two-characters",
  breakdown: {
    ...scene.breakdown!,
    characters: [
      { name: "林夏", state: "深色风衣干燥，头发整齐，右手完好" },
      { name: "陆沉", state: "红色西装被雨淋湿，左眉有新伤" },
    ],
    characterIds: ["character-linxia", "character-luchen"],
    wardrobe: ["林夏深色风衣", "陆沉红色西装"],
    makeupHair: ["林夏头发整齐", "陆沉左眉伤口"],
  },
};
const multiCharacterReadModel = buildManualProductionAssetReadModel({
  project: multiCharacterProject,
  episode: { ...episode, scenes: [multiCharacterScene] },
  scene: multiCharacterScene,
});
const linxiaVisualState = multiCharacterReadModel.sceneVisualPack?.characters.find((item) => item.characterId === "character-linxia");
const luchenVisualState = multiCharacterReadModel.sceneVisualPack?.characters.find((item) => item.characterId === "character-luchen");
assert.equal(linxiaVisualState?.continuityState, "深色风衣干燥，头发整齐，右手完好");
assert.equal(luchenVisualState?.continuityState, "红色西装被雨淋湿，左眉有新伤");
assert.equal(linxiaVisualState?.costumeState?.includes("陆沉"), false, "global wardrobe notes must not leak another character's state into the current identity");

const noAssetScene: Scene = {
  ...confirmedScene,
  id: "scene-assets-dialogue-only",
  title: "空旷走廊",
  script: "林夏停在走廊尽头，沉默片刻后转身离开。",
  breakdown: {
    setting: "INT.",
    location: { name: "空旷走廊" },
    time: "DAY",
    characters: [],
    props: [],
    vfx: [],
    sfx: [],
    wardrobe: [],
    makeupHair: [],
    vehicles: [],
    extrasAtmosphere: [],
    specialEquipment: [],
    bgm: [],
  },
  shots: [],
  productionTeam: undefined,
};
const noAssetReadModel = buildManualProductionAssetReadModel({
  project,
  episode: { ...episode, scenes: [noAssetScene] },
  scene: noAssetScene,
  filmTeam: {
    ...buildManualFilmTeamReadModel({ project, episode: { ...episode, scenes: [noAssetScene] }, requiredDepartments: [] }),
    coverage: [],
    departmentPrepPackages: [],
  },
});
assert.equal(noAssetReadModel.assetBoards.length, 0, "a scene with no structured asset references must not invent project assets");
assert.equal(noAssetReadModel.issues.some((item) => item.code === "MANUAL_PRODUCTION_ASSET_BOARD_EMPTY"), false);
assert.equal(noAssetReadModel.issues.some((item) => item.code === "SCENE_VISUAL_PACK_LOCATION_MISSING"), true, "an unresolved formal scene asset must surface its real blocker instead of a misleading 0/0 asset count");
assert.equal(noAssetReadModel.readyForStoryboardGeneration, false);

const reusedScene: Scene = {
  ...confirmedScene,
  id: "scene-assets-reused",
  title: "雨夜天台续场",
  shots: confirmedScene.shots?.map((shot) => ({ ...shot, id: `${shot.id}-reused` })),
  productionTeam: undefined,
};
const reusedReadModel = buildManualProductionAssetReadModel({
  project,
  episode: episodeWithConfirmedTeam([confirmedScene, reusedScene]),
  scene: confirmedScene,
});
assert.deepEqual(reusedReadModel.reusedSceneIds, [reusedScene.id], "identical visual states should reuse one scene visual fingerprint across scenes");

const baselineScene: Scene = {
  ...confirmedScene,
  id: "scene-assets-baseline",
  title: "雨前天台",
  breakdown: {
    ...confirmedScene.breakdown!,
    wardrobe: ["深色风衣保持干燥"],
    makeupHair: ["头发整齐"],
  },
  shots: confirmedScene.shots?.map((shot) => ({ ...shot, id: `${shot.id}-baseline` })),
  productionTeam: undefined,
};
const changedStateReadModel = buildManualProductionAssetReadModel({
  project,
  episode: episodeWithConfirmedTeam([baselineScene, confirmedScene]),
  scene: confirmedScene,
});
assert.equal(changedStateReadModel.issues.some((item) => item.code === "MANUAL_ASSET_STATE_CHANGE_NEEDS_SEMANTIC_REVIEW" && item.message.includes("林夏")), true);
assert.equal(changedStateReadModel.issues.find((item) => item.code === "MANUAL_ASSET_STATE_CHANGE_NEEDS_SEMANTIC_REVIEW")?.severity, "warning");
assert.equal(changedStateReadModel.readyForStoryboardGeneration, true, "a semantic state suggestion must not disable downstream generation");

let explicitlyConfirmedBaseProject: Project = project;
for (const board of changedStateReadModel.assetBoards) {
  const registry = confirmManualProductionAssetBoard({
    project: explicitlyConfirmedBaseProject,
    episode: episodeWithConfirmedTeam([baselineScene, confirmedScene]),
    scene: confirmedScene,
    boardItemId: board.boardItemId,
    confirmedAt: 7,
  });
  explicitlyConfirmedBaseProject = { ...explicitlyConfirmedBaseProject, manualProductionAssets: registry };
}
const explicitlyConfirmedBaseReadModel = buildManualProductionAssetReadModel({
  project: explicitlyConfirmedBaseProject,
  episode: episodeWithConfirmedTeam([baselineScene, confirmedScene]),
  scene: confirmedScene,
});
assert.equal(
  explicitlyConfirmedBaseReadModel.issues.some((item) => item.code === "MANUAL_ASSET_STATE_CHANGE_NEEDS_SEMANTIC_REVIEW" && item.message.includes("林夏")),
  false,
  "an explicit confirmation of the current state-bound base board is the author's base/variant decision",
);

const priorEpisode: Episode = {
  id: "episode-assets-prior",
  title: "上一集",
  inspiration: "雨前状态",
  scenes: [baselineScene],
};
const crossEpisodeProject: Project = {
  ...project,
  episodes: [
    { id: priorEpisode.id, title: priorEpisode.title, inspiration: priorEpisode.inspiration },
    { id: confirmedEpisode.id, title: confirmedEpisode.title, inspiration: confirmedEpisode.inspiration },
  ],
};
const crossEpisodeChangedStateReadModel = buildManualProductionAssetReadModel({
  project: crossEpisodeProject,
  episode: confirmedEpisode,
  episodes: [priorEpisode, confirmedEpisode],
  scene: confirmedScene,
});
assert.equal(
  crossEpisodeChangedStateReadModel.issues.some((item) => item.code === "MANUAL_ASSET_STATE_CHANGE_NEEDS_SEMANTIC_REVIEW" && item.message.includes("林夏")),
  true,
  "the visual baseline must start at the asset's first appearance across episodes, not reset at the current episode",
);

const characterVariantUpdate = buildManualProductionVariantUpdate({
  project,
  episode: episodeWithConfirmedTeam([baselineScene, confirmedScene]),
  scene: confirmedScene,
  assetId: "character-linxia",
  draft: {
    name: "雨夜湿身状态",
    description: "深色风衣完全湿透，湿发贴脸，但角色基础身份和体态不变。",
    promptModifiers: "soaked dark trench coat, wet hair",
  },
  finalPrompt: "根据当前场景建立林夏雨夜湿身状态变体",
  selectedSkillIds: ["skill-continuity"],
  selectedContextIds: ["ctx-scene"],
  createdAt: 8,
});
assert.equal(characterVariantUpdate.projectUpdates.characters.find((item) => item.id === "character-linxia")?.variants?.length, 1);
assert.equal(characterVariantUpdate.sceneUpdates.breakdown?.assetVariantMap?.["character-linxia"], characterVariantUpdate.variantId);
assert.equal(characterVariantUpdate.projectUpdates.manualProductionAssets?.variants?.[0].selectedSkillIds[0], "skill-continuity");
assert.equal(characterVariantUpdate.projectUpdates.characters.find((item) => item.id === "character-linxia")?.referenceImageUrl, project.characters[0].referenceImageUrl, "creating a variant must not overwrite the canonical character reference");
const variantBoundScene: Scene = { ...confirmedScene, ...characterVariantUpdate.sceneUpdates };
const variantBoundProject: Project = { ...project, ...characterVariantUpdate.projectUpdates };
const firstVariantWithImage = {
  ...variantBoundProject,
  characters: variantBoundProject.characters.map((item) => ({
    ...item,
    variants: item.variants?.map((variant) => ({ ...variant, boardImageUrl: "/media/first-episode-adopted.png" })),
  })),
};
const laterVariantUpdate = buildManualProductionVariantUpdate({
  project: firstVariantWithImage,
  episode: { ...episodeWithConfirmedTeam([{ ...confirmedScene, id: "later-scene" }]), id: "later-episode" },
  scene: { ...confirmedScene, id: "later-scene" },
  assetId: "character-linxia",
  draft: { name: "另一套雨衣", description: "本集穿黄色雨衣，基础人物不变。", promptModifiers: "yellow raincoat" },
  finalPrompt: "第二集独立设计",
  createdAt: 9,
});
assert.notEqual(laterVariantUpdate.variantId, characterVariantUpdate.variantId, "matching scene summaries must not make a new variant overwrite one used in another episode");
assert.deepEqual(
  laterVariantUpdate.projectUpdates.characters.find((item) => item.id === "character-linxia")?.variants?.find((variant) => variant.id === characterVariantUpdate.variantId),
  firstVariantWithImage.characters.find((item) => item.id === "character-linxia")?.variants?.[0],
  "creating another episode's variant must preserve the first variant and its adopted image",
);
const variantBoundReadModel = buildManualProductionAssetReadModel({
  project: variantBoundProject,
  episode: episodeWithConfirmedTeam([baselineScene, variantBoundScene]),
  scene: variantBoundScene,
});
assert.equal(variantBoundReadModel.issues.some((item) => item.code === "MANUAL_ASSET_STATE_CHANGE_NEEDS_SEMANTIC_REVIEW" && item.message.includes("林夏")), false);

let adoptedProject: Project = project;
for (const board of reviewReadModel.assetBoards) {
  const registry = confirmManualProductionAssetBoard({ project: adoptedProject, episode: confirmedEpisode, scene: confirmedScene, boardItemId: board.boardItemId, confirmedAt: 10 });
  adoptedProject = { ...adoptedProject, manualProductionAssets: registry };
}
const adoptedReadModel = buildManualProductionAssetReadModel({ project: adoptedProject, episode: confirmedEpisode, scene: confirmedScene });
assert.equal(adoptedReadModel.confirmedBoardCount, 4);
assert.equal(adoptedReadModel.staleBoardCount, 0);
assert.equal(adoptedReadModel.readyForStoryboardGeneration, true, "confirmed current-scene boards with references should unlock storyboard generation");
assert.notEqual(adoptedReadModel.assetPackHash, reviewReadModel.assetPackHash, "asset-pack confirmation must be invalidated when individual asset approvals change");

const propBaseBoard = adoptedReadModel.assetBoards.find((item) => item.assetId === "prop-recorder" && !item.variantId)!;
const referenceUpdate = buildManualProductionReferenceImageUpdate({
  project: adoptedProject,
  episode: confirmedEpisode,
  scene: confirmedScene,
  boardItemId: propBaseBoard.boardItemId,
  imageUrl: "data:image/png;base64,prop-regenerated",
  finalPrompt: "重新生成录音笔基础身份板",
  modelId: "image-model",
  inputReferenceUrl: "data:image/png;base64,input",
  selectedSkillIds: ["skill-prop"],
  selectedContextIds: ["ctx-scene"],
  createdAt: 10,
});
const referenceUpdatedProject: Project = { ...adoptedProject, ...referenceUpdate };
const referenceUpdatedReadModel = buildManualProductionAssetReadModel({ project: referenceUpdatedProject, episode: confirmedEpisode, scene: confirmedScene });
assert.equal(referenceUpdatedProject.assets.find((item) => item.id === "prop-recorder")?.imageUrl, "data:image/png;base64,prop-seed", "concept seed must not be overwritten by an adopted prop board");
assert.equal(referenceUpdatedProject.assets.find((item) => item.id === "prop-recorder")?.boardImageUrl, "data:image/png;base64,prop-regenerated");
assert.equal(referenceUpdatedProject.assets.find((item) => item.id === "prop-recorder")?.multiViewUrl, "data:image/png;base64,prop-regenerated");
assert.equal(referenceUpdatedProject.manualProductionAssets?.references?.[0].selectedSkillIds[0], "skill-prop");
assert.equal(referenceUpdatedReadModel.assetBoards.find((item) => item.boardItemId === propBaseBoard.boardItemId)?.referenceOrigin, "ai_generation");
assert.equal(referenceUpdatedReadModel.assetBoards.find((item) => item.boardItemId === propBaseBoard.boardItemId)?.approvalState, "stale", "new reference images must require identity reconfirmation");

const changedProject: Project = {
  ...adoptedProject,
  assets: adoptedProject.assets.map((asset) => asset.id === "prop-recorder" ? { ...asset, description: "银色录音笔，蓝色工作灯。" } : asset),
};
const staleReadModel = buildManualProductionAssetReadModel({ project: changedProject, episode: confirmedEpisode, scene: confirmedScene });
assert.equal(staleReadModel.assetBoards.filter((item) => item.assetId === "prop-recorder").every((item) => item.approvalState === "stale"), true, "asset identity changes must stale both base and variant confirmations");
assert.equal(staleReadModel.readyForStoryboardGeneration, true, "asset identity changes must remain advisory and preserve downstream access");
assert.ok(staleReadModel.issues.some((item) => item.code === "MANUAL_ASSET_CONFIRMATION_SOURCE_CHANGED" && item.severity === "warning"));

const revokedRegistry = revokeManualProductionAssetBoard(adoptedProject.manualProductionAssets, reviewReadModel.assetBoards[0].boardItemId, 11);
assert.equal(revokedRegistry.approvals.length, 3);

console.log("Manual production assets self-check passed.");
