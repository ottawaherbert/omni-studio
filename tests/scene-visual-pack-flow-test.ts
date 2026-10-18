import assert from "node:assert/strict";
import { dbHelpers } from "../src/server/db";
import { createOperatorArtifact } from "../src/services/operator/artifacts";
import { runOperatorArtifactQA } from "../src/services/operator/qa";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import type { OperatorArtifactEnvelope, OperatorArtifactKind, OperatorRun } from "../src/services/operator/types";
import { buildProductionAssetReferencePackDrafts } from "../src/services/production/videoStoryboardPromptPacks";
import { buildProductionSceneVisualPackDrafts } from "../src/services/production/videoStoryboardSceneVisualPacks";
import { buildProductionStoryboardBoardDrafts } from "../src/services/production/videoStoryboardStageBoards";
import { buildProductionVideoGenerationUnitDrafts } from "../src/services/production/videoStoryboardVideoUnits";
import type { Episode, Project, Scene, Shot } from "../src/types/project";

const now = Date.now();
const projectId = `svp-flow-${now}`;
const episodeId = `${projectId}-ep-1`;
const sceneAId = `${projectId}-scene-1`;
const sceneBId = `${projectId}-scene-2`;
const sceneCId = `${projectId}-scene-3`;

const makeShot = (
  sceneId: string,
  index: number,
  visualAction: string,
  characters: string[],
  propIds: string[],
  duration = 5,
): Shot => ({
  id: `${sceneId}-shot-${index}`,
  shotSize: index === 1 ? "MS" : "CU",
  cameraAngle: index === 1 ? "eye-level" : "low angle",
  cameraMovement: index === 1 ? "slow push-in" : "pan",
  focalLength: index === 1 ? "35mm" : "50mm",
  lighting: "青灯暖光与冷月天光混合，角色面部表情可读。",
  composition: "竖屏 9:16，角色方位固定，青灯在画面右后方作为视觉锚点。",
  blocking: "陆沉站在 screen left，沈照雪站在 screen right，动作沿洞府石案方向承接。",
  continuityNote: "保持 180 度轴线、视线方向、青灯位置和霜纹剑归属连续。",
  visualAction,
  duration,
  characterIdsInShot: characters,
  locationId: "loc-frost-cave",
  propIds,
  imagePrompt: `中文图片提示词：竖屏9:16，${visualAction}，青灯洞府、冷月、霜纹剑，角色方位清楚，表情和道具关系可读。`,
  videoPrompt: `中文视频提示词：竖屏mobile，${visualAction}，镜头运动克制，保持青灯洞府空间、角色方位和道具状态连续。`,
});

const sharedSceneState = {
  setting: "INT." as const,
  location: { name: "青灯洞府", state: "青灯未灭，石案完整，冷月从天井落下" },
  time: "NIGHT" as const,
  characters: [
    { name: "陆沉", state: "白衣未染血，克制压抑" },
    { name: "沈照雪", state: "白衣未染血，眼神担忧" },
  ],
  props: [{ name: "霜纹剑", state: "剑身完整，未出鞘" }],
  characterIds: ["char-lu-chen", "char-shen-zhaoxue"],
  locationId: "loc-frost-cave",
  propIds: ["prop-frost-sword"],
  wardrobe: ["陆沉和沈照雪均为无血白色宗门长袍"],
  makeupHair: ["发冠完整，妆发无伤痕"],
};

const makeScene = (
  id: string,
  sceneNumber: string,
  title: string,
  description: string,
  cliffhanger: string,
  variantMap?: Record<string, string>,
): Scene => {
  const damaged = Boolean(variantMap);
  const breakdown = damaged
    ? {
        ...sharedSceneState,
        characters: [
          { name: "陆沉", state: "肩口染血，强撑灵力" },
          { name: "沈照雪", state: "白衣未染血，眼神心疼" },
        ],
        props: [{ name: "霜纹剑", state: "剑尖崩裂，霜纹外泄" }],
        wardrobe: ["陆沉肩口染血，沈照雪白衣无血"],
        makeupHair: ["陆沉唇色发白，发冠偏斜；沈照雪妆发完整"],
        assetVariantMap: variantMap,
      }
    : sharedSceneState;
  return {
    id,
    sceneNumber,
    title,
    description,
    valueCharge: damaged ? "negative" : "positive",
    valueShift: damaged
      ? {
          from: "两人以为霜纹剑已经稳定",
          to: "陆沉受伤且霜纹剑破损，飞升前代价暴露",
          reason: "霜纹剑承受不了陆沉体内劫火。",
        }
      : {
          from: "两人互相隐忍",
          to: "两人确认共同守住青灯誓约",
          reason: "陆沉和沈照雪把霜纹剑放到青灯前立誓。",
        },
    hook: damaged ? "霜纹剑突然裂响，陆沉肩口渗血。" : "青灯映出两人同握霜纹剑的影子。",
    cliffhanger,
    targetDuration: 1,
    sceneGoal: damaged ? "让视觉状态变化强制产生新场景视觉包。" : "验证相同布景服化道和道具状态可以复用视觉包。",
    environment: "INT.",
    timeOfDay: "NIGHT",
    sceneAssets: damaged
      ? "青灯洞府，石案完整，陆沉肩口染血，霜纹剑剑尖崩裂。"
      : "青灯洞府，石案完整，青灯未灭，霜纹剑完整未出鞘。",
    scriptBlocks: [
      { id: `${id}-sb-1`, type: "scene_heading", content: "INT. 青灯洞府 - NIGHT", locationId: "loc-frost-cave" },
      {
        id: `${id}-sb-2`,
        type: "action",
        content: damaged
          ? "霜纹剑忽然裂响，陆沉肩口渗血，沈照雪伸手扶住他。"
          : "陆沉与沈照雪并肩站在青灯前，把完整的霜纹剑放在石案上。",
        locationId: "loc-frost-cave",
        propIds: ["prop-frost-sword"],
      },
      { id: `${id}-sb-3`, type: "character", content: "沈照雪", linkedAssetId: "char-shen-zhaoxue" },
      {
        id: `${id}-sb-4`,
        type: "dialogue",
        content: damaged ? "别再硬撑了，你的劫火已经压不住。" : "若你飞升前回头，我就在青灯下等你。",
        linkedAssetId: "char-shen-zhaoxue",
      },
      { id: `${id}-sb-5`, type: "character", content: "陆沉", linkedAssetId: "char-lu-chen" },
      {
        id: `${id}-sb-6`,
        type: "dialogue",
        content: damaged ? "我若停下，宗门血债就再没人能讨。" : "我若飞升，第一眼也要先看见你。",
        linkedAssetId: "char-lu-chen",
      },
    ],
    breakdown,
    shots: [
      makeShot(
        id,
        1,
        damaged
          ? "陆沉肩口渗血仍握住崩裂的霜纹剑，沈照雪从右侧扶住他。"
          : "陆沉与沈照雪在青灯前同看完整霜纹剑，彼此没有越过石案。",
        ["char-lu-chen", "char-shen-zhaoxue"],
        ["prop-frost-sword"],
        damaged ? 6 : 5,
      ),
      makeShot(
        id,
        2,
        damaged
          ? "霜纹剑剑尖崩裂，冷霜灵光从裂缝外泄，陆沉血滴落在石案边。"
          : "完整霜纹剑映出青灯火光，沈照雪的手停在剑鞘旁没有触碰。",
        damaged ? ["char-lu-chen"] : ["char-shen-zhaoxue"],
        ["prop-frost-sword"],
        damaged ? 5 : 4,
      ),
    ],
  };
};

const episode: Episode = {
  id: episodeId,
  title: "第一集：青灯誓约",
  inspiration: "飞升前，陆沉和道侣沈照雪在青灯洞府立下誓约，随后霜纹剑崩裂暴露飞升代价。",
  scenes: [
    makeScene(sceneAId, "1", "青灯前的誓约", "陆沉与沈照雪在青灯洞府确认飞升前誓约。", "青灯火焰忽然向霜纹剑倾斜。"),
    makeScene(sceneBId, "2", "同夜未改的守候", "同一晚同一洞府，两人仍保持同样服化道和道具状态，继续誓约。", "霜纹剑第一次发出细小裂响。"),
    makeScene(
      sceneCId,
      "3",
      "剑裂血落",
      "霜纹剑崩裂，陆沉受伤，沈照雪发现飞升前真正代价。",
      "沈照雪看见陆沉血中浮现被毁宗门的旧印。",
      { "char-lu-chen": "variant-lu-bloodied", "prop-frost-sword": "variant-sword-cracked" },
    ),
  ],
} as Episode;

const project: Project = {
  id: projectId,
  title: `[TEST] Scene Visual Pack Flow ${now}`,
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  logline: "飞升前夜，陆沉与道侣沈照雪在青灯下立誓，却因霜纹剑崩裂暴露宗门被毁的血债。",
  coreConflict: "陆沉必须在飞升前讨回宗门血债，但每次动用霜纹剑都会让他离沈照雪更远。",
  targetEpisodeCount: 1,
  creativeVision: {
    genre: ["修仙", "短剧", "虐恋", "复仇"],
    visualStyle: "青灯暖光、冷月蓝影、白衣与血色形成强对比。",
    narrativeStyle: "短剧快节奏，情感承诺后立刻暴露代价。",
    referenceWorks: "原创，不复刻具体作品。",
    want: "陆沉想飞升前复仇。",
    need: "他必须承认自己不是一个人承担血债。",
    stakes: "失败会让宗门血债永远沉没，也会失去道侣。",
    oppositionForce: "飞升劫火和毁宗真凶留下的旧印。",
    themeQuestion: "飞升是否值得以爱人为代价。",
    protagonistArc: "从独自硬撑到允许沈照雪共同承担。",
    emotionalReward: "观众看到道侣互相守护但代价越来越近。",
  },
  characters: [
    {
      id: "char-lu-chen",
      name: "陆沉",
      psychologicalProfile: "克制、深情、在痛苦中仍保持礼数。",
      multiViewPrompt: "中文角色板：陆沉，二十岁修仙青年，白色宗门长袍，冷峻眉眼，佩霜纹剑，正面侧面背面和表情变化。",
      variants: [{
        id: "variant-lu-bloodied",
        name: "劫火染血态",
        description: "肩口染血、唇色发白、发冠偏斜，仍强撑握剑。",
        promptModifiers: "白袍肩口明显血迹，脸色苍白，眼神压痛，发冠略歪。",
      }],
    },
    {
      id: "char-shen-zhaoxue",
      name: "沈照雪",
      psychologicalProfile: "温柔、坚定、观察细腻。",
      multiViewPrompt: "中文角色板：沈照雪，二十岁修仙女子，白色宗门长裙，清冷但眼神温柔，青灯暖光下正面侧面背面和表情变化。",
    },
  ],
  assets: [
    {
      id: "loc-frost-cave",
      type: "location",
      name: "青灯洞府",
      description: "宗门遗址后的隐秘洞府，中央石案有一盏青灯，天井落下冷月光，墙面有残破宗门纹样。",
      panoramaPrompt: "中文场景板：青灯洞府，中央石案、青灯、天井月光、残破宗门纹样，竖屏可拍机位，冷暖光对比。",
    },
    {
      id: "prop-frost-sword",
      type: "prop",
      name: "霜纹剑",
      description: "陆沉随身长剑，剑鞘有霜纹，完整状态下冷光内敛。",
      multiViewPrompt: "中文道具板：霜纹剑，剑鞘、剑柄、剑身纹路、持握方式，正面侧面细节。",
      variants: [{
        id: "variant-sword-cracked",
        name: "崩裂态",
        description: "剑尖崩裂，霜纹外泄，裂口有冷白灵光。",
        promptModifiers: "剑尖有明显裂口，冷白灵光从裂缝外泄，边缘有细碎冰霜。",
      }],
    },
  ],
  episodes: [episode],
};

const blocking = (issues: Array<{ severity?: string }>) => issues.some((issue) => issue.severity === "blocking");

const saveDraftArtifact = (
  run: OperatorRun,
  kind: OperatorArtifactKind,
  targetPath: string,
  entityIds: string[],
  data: unknown,
) => dbHelpers.saveOperatorArtifact(createOperatorArtifact({
  runId: run.id,
  kind,
  targetPath,
  entityIds,
  data,
}, run));

const appendAutoQA = (
  artifact: OperatorArtifactEnvelope,
  relatedArtifacts: OperatorArtifactEnvelope[],
) => {
  const verdict = runOperatorArtifactQA({ artifact, relatedArtifacts: [artifact, ...relatedArtifacts] });
  assert.ok(verdict, `auto QA must support ${artifact.kind}`);
  assert.equal(verdict.blocking, false, JSON.stringify(verdict.issues, null, 2));
  const saved = dbHelpers.appendOperatorArtifactQA(artifact.id, verdict);
  assert.ok(saved, `artifact QA should save: ${artifact.id}`);
  return saved as OperatorArtifactEnvelope;
};

dbHelpers.saveProject(project);

const savedProject = dbHelpers.getProjectById(projectId) as Project & { episodes: Episode[] };
assert.equal(savedProject.id, projectId);
assert.equal(savedProject.episodes?.[0]?.scenes?.length, 3);

const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
  projectId,
  provider: "codex",
  mode: "produce",
  userRequest: "测试 operator-v11 场景视觉包复用、资产参考包投影、视频单元和审计可视化流程。",
  scope: {
    projectId,
    episodeIds: [episodeId],
    sceneIds: [sceneAId, sceneBId, sceneCId],
  },
}, OPERATOR_HANDBOOK_VERSION));

dbHelpers.appendOperatorRunEvent(run.id, {
  type: "context_read",
  message: "读取测试项目、角色、场景、道具和分镜事实源。",
  entityIds: [projectId, episodeId],
});
dbHelpers.appendOperatorRunEvent(run.id, {
  type: "plan_created",
  message: "计划验证 scene_visual_pack 复用、asset_reference_pack 投影和 video_generation_unit QA。",
  entityIds: [projectId, episodeId, sceneAId, sceneBId, sceneCId],
});

const episodes = savedProject.episodes as Episode[];
const sceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(savedProject, episodes);
assert.equal(blocking(sceneVisualPackDrafts.issues), false, JSON.stringify(sceneVisualPackDrafts.issues, null, 2));
assert.equal(sceneVisualPackDrafts.sceneVisualPacks.length, 2, JSON.stringify(sceneVisualPackDrafts.sceneVisualPacks, null, 2));
assert.equal(sceneVisualPackDrafts.reusedPackIds.length, 1);
const reusedPack = sceneVisualPackDrafts.sceneVisualPacks.find((pack) =>
  pack.linkedSceneIds.includes(sceneAId) && pack.linkedSceneIds.includes(sceneBId),
);
assert.ok(reusedPack, "scene 1 and scene 2 should reuse one scene_visual_pack");
const changedPack = sceneVisualPackDrafts.sceneVisualPacks.find((pack) => pack.linkedSceneIds.includes(sceneCId));
assert.ok(changedPack, "scene 3 should produce a separate scene_visual_pack");
assert.notEqual(reusedPack.visualFingerprint, changedPack.visualFingerprint);

const storyboardBoardDrafts = buildProductionStoryboardBoardDrafts(savedProject, episodes);
assert.equal(blocking(storyboardBoardDrafts.issues), false, JSON.stringify(storyboardBoardDrafts.issues, null, 2));

const assetReferencePackDrafts = buildProductionAssetReferencePackDrafts(savedProject, episodes, sceneVisualPackDrafts.sceneVisualPacks);
assert.equal(blocking(assetReferencePackDrafts.issues), false, JSON.stringify(assetReferencePackDrafts.issues, null, 2));
assert.equal(assetReferencePackDrafts.assetReferencePacks.length, 3);
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.sceneVisualPackId));
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.modelInputFingerprint));
assert.equal(
  assetReferencePackDrafts.assetReferencePacks.filter((pack) => pack.sceneVisualPackId === reusedPack.id).length,
  2,
);

const videoUnitDrafts = buildProductionVideoGenerationUnitDrafts(savedProject, episodes);
assert.equal(blocking(videoUnitDrafts.issues), false, JSON.stringify(videoUnitDrafts.issues, null, 2));
assert.equal(videoUnitDrafts.sceneVisualPacks.length, 2);
assert.ok(videoUnitDrafts.videoGenerationUnits.length >= 3);

const savedArtifacts: OperatorArtifactEnvelope[] = [];
const saveAndQA = (
  artifact: OperatorArtifactEnvelope,
) => {
  const approved = appendAutoQA(artifact, savedArtifacts);
  savedArtifacts.push(approved);
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: approved.status === "qa_failed" ? "qa_failed" : "qa_passed",
    message: `Auto QA ${approved.status}: ${approved.kind}`,
    targetPath: approved.targetPath,
    entityIds: approved.entityIds,
    data: { artifactId: approved.id, status: approved.status },
  });
  return approved;
};

saveAndQA(saveDraftArtifact(
  run,
  "performance_beats",
  `episodes.${episodeId}.performanceBeats`,
  [episodeId],
  { performanceBeats: videoUnitDrafts.performanceBeats },
));

for (const pack of sceneVisualPackDrafts.sceneVisualPacks) {
  saveAndQA(saveDraftArtifact(
    run,
    "scene_visual_pack",
    `episodes.${episodeId}.sceneVisualPacks.${pack.id}`,
    [episodeId, ...pack.linkedSceneIds, pack.id],
    { sceneVisualPack: pack },
  ));
}

for (const board of storyboardBoardDrafts.storyboardBoards) {
  saveAndQA(saveDraftArtifact(
    run,
    "storyboard_board",
    `episodes.${board.episodeId}.scenes.${board.sceneId}.storyboardBoards.${board.id}`,
    [board.episodeId, board.sceneId, board.id],
    { storyboardBoard: board },
  ));
}

for (const pack of assetReferencePackDrafts.assetReferencePacks) {
  saveAndQA(saveDraftArtifact(
    run,
    "asset_reference_pack",
    `episodes.${pack.episodeId}.scenes.${pack.sceneId}.assetReferencePacks.${pack.id}`,
    [pack.episodeId, pack.sceneId, pack.id],
    { assetReferencePack: pack },
  ));
}

for (const unit of videoUnitDrafts.videoGenerationUnits) {
  saveAndQA(saveDraftArtifact(
    run,
    "video_generation_unit",
    `episodes.${unit.episodeId}.scenes.${unit.sceneId}.videoGenerationUnits.${unit.id}`,
    [unit.episodeId, unit.sceneId, unit.id],
    { videoGenerationUnit: unit },
  ));
}

saveAndQA(saveDraftArtifact(
  run,
  "custom",
  "videoStoryboardPlan",
  [projectId, episodeId],
  {
    performanceBeats: videoUnitDrafts.performanceBeats,
    storyboardBoards: storyboardBoardDrafts.storyboardBoards,
    sceneVisualPacks: sceneVisualPackDrafts.sceneVisualPacks,
    assetReferencePacks: assetReferencePackDrafts.assetReferencePacks,
    videoGenerationUnits: videoUnitDrafts.videoGenerationUnits,
  },
));

dbHelpers.appendOperatorRunEvent(run.id, {
  type: "completed",
  message: "Scene visual pack flow test passed and artifacts are available in AutoStudio Audit.",
  entityIds: [projectId, episodeId],
});
dbHelpers.patchOperatorRun(run.id, {
  status: "completed",
  qaSummary: {
    passed: savedArtifacts.length,
    warnings: savedArtifacts.filter((artifact) => artifact.qaVerdicts.some((verdict) => verdict.status === "warning")).length,
    failed: 0,
    blocked: 0,
  },
  outputs: savedArtifacts.map((artifact) => ({
    kind: artifact.kind,
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    artifactId: artifact.id,
  })),
});

const persistedArtifacts = dbHelpers.listOperatorArtifacts({ projectId, runId: run.id });
assert.equal(persistedArtifacts.length, savedArtifacts.length);
assert.ok(persistedArtifacts.some((artifact) => artifact.kind === "scene_visual_pack" && artifact.status === "approved"));
assert.ok(persistedArtifacts.some((artifact) => artifact.kind === "asset_reference_pack" && artifact.status === "approved"));
assert.ok(persistedArtifacts.some((artifact) => artifact.kind === "video_generation_unit" && artifact.status === "approved"));

const result = {
  status: "passed",
  projectId,
  runId: run.id,
  sceneVisualPackCount: sceneVisualPackDrafts.sceneVisualPacks.length,
  reusedPackIds: sceneVisualPackDrafts.reusedPackIds,
  changedPackId: changedPack.id,
  assetReferencePackCount: assetReferencePackDrafts.assetReferencePacks.length,
  storyboardBoardCount: storyboardBoardDrafts.storyboardBoards.length,
  videoGenerationUnitCount: videoUnitDrafts.videoGenerationUnits.length,
  artifactCount: persistedArtifacts.length,
  productionUrl: `http://localhost:3001/production/preparation?projectId=${projectId}`,
};

console.log(JSON.stringify(result, null, 2));
