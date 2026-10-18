import assert from "node:assert/strict";
import fs from "node:fs";
import { dbHelpers } from "../src/server/db";
import { createOperatorArtifact, createOperatorRegisteredAsset } from "../src/services/operator/artifacts";
import { commitOperatorArtifactToProject } from "../src/services/operator/commit";
import { buildOperatorProjectContext } from "../src/services/operator/context";
import { runOperatorArtifactQA, runOperatorQA } from "../src/services/operator/qa";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import type { OperatorArtifactEnvelope, OperatorRun } from "../src/services/operator/types";
import type { Project, Scene, Shot } from "../src/types/project";

const projectId = `operator-e2e-${Date.now()}`;
const episodeId = "operator-e2e-ep-1";
const sceneId = "operator-e2e-scene-1";

const baseProject: Project = {
  id: projectId,
  title: "Operator E2E 短剧验收",
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  logline: "外门弟子林砚被当众夺走试炼资格，必须用青岚令证明自己，否则永远被逐出宗门。",
  coreConflict: "林砚的目标是在山门试炼前证明资格，对抗执事的打压，否则失去进入青岚宗和追查身世的机会。",
  targetEpisodeCount: 1,
  originalInspiration: "用本地 AI Operator 完成一集到分镜和图片验收，不调用外部模型。",
  refinedInspiration: "短剧第一集聚焦山门试炼的羞辱、反转与追更钩子。",
  creativeVision: {
    genre: ["修仙", "短剧", "逆袭"],
    visualStyle: "雨后青石、冷色宗门、令牌暖光形成视觉母题。",
    narrativeStyle: "前三秒冲突可见，场内反转，集尾追更。",
    referenceWorks: "原创，不复刻具体作品。",
    want: "林砚想拿回试炼资格。",
    need: "他必须学会公开承担代价，而不是躲避身份秘密。",
    stakes: "失败会被逐出宗门，并失去追查母亲遗物的唯一线索。",
    oppositionForce: "执事与内门弟子利用规矩压制外门弟子。",
    themeQuestion: "被制度否定的人能否用行动重写资格。",
    protagonistArc: "从低头忍耐到公开举令挑战。",
    emotionalReward: "观众看到弱者第一次把羞辱变成反击证据。",
  },
  characters: [
    {
      id: "char-lin-yan",
      name: "林砚",
      psychologicalProfile: "克制、敏锐、在羞辱中保持观察。",
      multiViewPrompt: "中文多视图角色设定图：十七岁外门弟子林砚，旧青袍、肩部雨痕、腰间空鞘、眼神忍而不屈，正面、侧面、背面。",
    },
    {
      id: "char-deacon-he",
      name: "何执事",
      psychologicalProfile: "冷硬、傲慢、善于用礼法包装私心。",
      multiViewPrompt: "中文多视图角色设定图：中年宗门执事何执事，深青执事袍、玉简册、冷脸、手指常压在名册上。",
    },
  ],
  assets: [
    {
      id: "loc-qinglan-gate",
      type: "location",
      name: "青岚宗山门",
      description: "雨后的宗门山门，青石台阶、试炼钟、两侧松影和高处牌楼。",
      prompt: "中文场景设定图：雨后青石台阶上的青岚宗山门，竖屏构图，远处牌楼、试炼钟、湿润松影、冷青色晨雾。",
    },
    {
      id: "prop-qinglan-token",
      type: "prop",
      name: "青岚令",
      description: "林砚母亲留下的铜青色令牌，边缘有裂纹，遇到试炼钟会发出暖光。",
      prompt: "中文道具设定图：铜青色青岚令，裂纹边缘，中心云纹，雨水沿刻痕滑落，近景可读。",
    },
    {
      id: "prop-test-stone",
      type: "prop",
      name: "裂纹测灵石",
      description: "山门试炼使用的测灵石，表面旧裂纹会在真气触发时亮起。",
      prompt: "中文道具设定图：裂纹测灵石，灰白石面、内侧淡金灵光、放在青石台阶上，竖屏近景。",
    },
  ],
  episodes: [
    {
      id: episodeId,
      title: "第一集：山门夺令",
      inspiration: "林砚在山门被剥夺资格，借青岚令触发测灵石反转，集尾何执事要求搜查令牌来源。",
      scenes: [],
    },
  ] as any,
};

const scene: Scene = {
  id: sceneId,
  sceneNumber: "1",
  title: "雨后山门夺令",
  description: "前三秒何执事把林砚的名字从试炼名册划掉；林砚递出青岚令，测灵石亮起，反转证明资格；何执事盯上令牌来源，留下付费追更钩子。",
  valueCharge: "negative",
  valueShift: {
    from: "被公开剥夺资格",
    to: "用青岚令证明资格但暴露秘密",
    reason: "林砚把母亲遗物交到测灵石前，令牌触发隐藏灵光。",
  },
  hook: "前三秒：何执事当众划掉林砚名字，名册朱砂溅到青岚令上。",
  cliffhanger: "付费追更点：何执事要求搜查青岚令来源，林砚意识到母亲遗物暴露。",
  targetDuration: 2,
  sceneGoal: "让林砚从被羞辱转为公开反击，并把青岚令设成后续追查线索。",
  environment: "EXT.",
  timeOfDay: "DUSK",
  scriptBlocks: [
    { id: "sb-1", type: "scene_heading", content: "EXT. 青岚宗山门 - DUSK", locationId: "loc-qinglan-gate" },
    { id: "sb-2", type: "action", content: "雨水顺着青石台阶流下，何执事用朱砂笔划掉林砚的名字，林砚握紧青岚令上前，把令牌递到裂纹测灵石旁。", locationId: "loc-qinglan-gate", propIds: ["prop-qinglan-token", "prop-test-stone"] },
    { id: "sb-3", type: "character", content: "林砚", linkedAssetId: "char-lin-yan" },
    { id: "sb-4", type: "dialogue", content: "给我一次试炼，我会当场证明。", linkedAssetId: "char-lin-yan" },
    { id: "sb-5", type: "action", content: "青岚令贴近测灵石，裂纹里亮起金光，围观弟子的嘲笑停住。何执事抬眼，手指压住名册。", locationId: "loc-qinglan-gate", propIds: ["prop-qinglan-token", "prop-test-stone"] },
    { id: "sb-6", type: "character", content: "何执事", linkedAssetId: "char-deacon-he" },
    { id: "sb-7", type: "dialogue", content: "令牌留下，你的资格，先等我查清。", linkedAssetId: "char-deacon-he" },
  ],
  breakdown: {
    setting: "EXT.",
    location: { name: "青岚宗山门", state: "雨后石阶" },
    time: "DUSK",
    characters: [{ name: "林砚", state: "被压制但不退" }, { name: "何执事", state: "冷硬审视" }],
    props: [{ name: "青岚令", state: "被朱砂溅到" }, { name: "裂纹测灵石", state: "被令牌触发" }],
    characterIds: ["char-lin-yan", "char-deacon-he"],
    locationId: "loc-qinglan-gate",
    propIds: ["prop-qinglan-token", "prop-test-stone"],
  },
};

const shots: Shot[] = [
  {
    id: "operator-e2e-shot-1",
    shotSize: "WS",
    cameraAngle: "low angle",
    cameraMovement: "static",
    focalLength: "24mm",
    lighting: "雨后冷青天光，试炼钟下有微弱暖光",
    composition: "竖屏 9:16，青石台阶占前景，林砚在 screen left，何执事在高一级台阶 screen right，山门牌楼压在画面上方。",
    blocking: "林砚从台阶下方上前一步，何执事固定站在台阶上方，用名册挡住入口。",
    continuityNote: "180 度轴线沿山门台阶方向固定；视线匹配为林砚仰视何执事、何执事俯视林砚；动作顺接从划名册接到林砚上前；空间方位连续性保持林砚 screen left、何执事 screen right。",
    visualAction: "何执事用朱砂笔划掉林砚名字，林砚握着青岚令从雨后的青石台阶下方上前。",
    duration: 6,
    motivation: "前三秒建立羞辱和权力差。",
    characterIdsInShot: ["char-lin-yan", "char-deacon-he"],
    locationId: "loc-qinglan-gate",
    propIds: ["prop-qinglan-token"],
    imagePrompt: "竖屏 9:16，WS 远景，low angle 低角度，static 固定镜头，24mm，雨后青石台阶，林砚在 screen left 握紧青岚令，何执事在 screen right 用朱砂笔划掉名册，冷青天光与试炼钟暖光对比，主体清楚，表情可读。",
    videoPrompt: "竖屏 mobile，WS low angle static 24mm，何执事划掉名字的动作接林砚上前一步，雨水沿青石流动，保持林砚 screen left、何执事 screen right，动作连续。",
  },
  {
    id: "operator-e2e-shot-2",
    shotSize: "CU",
    cameraAngle: "eye-level",
    cameraMovement: "push-in",
    focalLength: "50mm",
    lighting: "青岚令裂纹发出暖金内光，背景保持冷青",
    composition: "竖屏近景，林砚手部和青岚令占画面中心，裂纹测灵石在下方三分之一处。",
    blocking: "林砚右手把青岚令贴近测灵石，何执事的名册边缘停在画面外右侧。",
    continuityNote: "180 度轴线继续沿台阶方向；视线匹配来自上一镜林砚看向测灵石；动作顺接承接上前后递令牌；空间方位连续性让令牌从林砚一侧进入画面。",
    visualAction: "林砚把青岚令贴近裂纹测灵石，朱砂和雨水在令牌裂纹里亮起金光。",
    duration: 5,
    motivation: "把反转证据具象化，让观众看清道具关系。",
    characterIdsInShot: ["char-lin-yan"],
    locationId: "loc-qinglan-gate",
    propIds: ["prop-qinglan-token", "prop-test-stone"],
    imagePrompt: "竖屏 9:16，CU 特写，eye-level 平视，push-in 推近，50mm，林砚手部把青岚令贴近裂纹测灵石，令牌裂纹发出暖金光，朱砂和雨水清晰，mobile close-up，手部动作和道具关系可读。",
    videoPrompt: "竖屏 mobile，CU eye-level push-in 50mm，镜头缓慢推近青岚令和测灵石，金光从裂纹里亮起，承接上一镜递令牌动作，保持道具方向连续。",
  },
  {
    id: "operator-e2e-shot-3",
    shotSize: "MS",
    cameraAngle: "eye-level",
    cameraMovement: "dolly",
    focalLength: "35mm",
    lighting: "令牌暖光打在林砚脸侧，何执事半张脸落在冷影里",
    composition: "竖屏中景，林砚位于 foreground left，何执事在 background right，测灵石金光隔开两人。",
    blocking: "林砚没有后退，何执事伸手压住名册并向令牌倾身，围观弟子留在画面边缘虚化。",
    continuityNote: "180 度轴线不变；视线匹配为林砚看向何执事、何执事看向令牌；动作顺接从金光亮起接到何执事压住名册；空间方位连续性保持林砚 left、何执事 right。",
    visualAction: "测灵石亮起后，何执事压住名册盯向青岚令，林砚抬眼没有退让。",
    duration: 7,
    motivation: "把胜利转成新威胁，形成集尾追更。",
    characterIdsInShot: ["char-lin-yan", "char-deacon-he"],
    locationId: "loc-qinglan-gate",
    propIds: ["prop-qinglan-token", "prop-test-stone"],
    imagePrompt: "竖屏 9:16，MS 中景，eye-level 平视，dolly 移动镜头，35mm，林砚在 foreground left 被令牌暖光照亮脸侧，何执事在 background right 冷影中压住名册，测灵石金光隔开两人，表情紧张可读，集尾悬念。",
    videoPrompt: "竖屏 mobile，MS eye-level dolly 35mm，镜头沿台阶轻微移动，何执事压住名册并盯向青岚令，林砚抬眼不退，延续林砚 left、何执事 right 的空间方位。",
  },
];

const statusForVerdict = (verdict: ReturnType<typeof runOperatorQA>) =>
  verdict.blocking ? "failed" : verdict.issues.length ? "warning" : "passed";

const commitArtifact = (artifactId: string) => {
  const artifact = dbHelpers.getOperatorArtifactById(artifactId);
  assert.ok(artifact, `artifact should exist: ${artifactId}`);
  const project = dbHelpers.getProjectById(artifact.projectId);
  assert.ok(project, `project should exist: ${artifact.projectId}`);
  const result = commitOperatorArtifactToProject(project, artifact);
  dbHelpers.saveProject(result.project);
  const committed = dbHelpers.markOperatorArtifactCommitted(artifact.id, {
    committedAt: Date.now(),
    changedPaths: result.changedPaths,
    summary: result.summary,
  });
  assert.equal(committed?.status, "committed");
  dbHelpers.appendOperatorRunEvent(artifact.runId, {
    type: "db_write",
    message: result.summary,
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: { artifactId: artifact.id, changedPaths: result.changedPaths },
  });
  const run = dbHelpers.getOperatorRunById(artifact.runId);
  assert.ok(run, `run should exist: ${artifact.runId}`);
  dbHelpers.patchOperatorRun(run.id, {
    outputs: [
      ...(run.outputs || []),
      { kind: artifact.kind, targetPath: artifact.targetPath, entityIds: artifact.entityIds, artifactId: artifact.id },
    ],
  });
  return { artifact: committed as OperatorArtifactEnvelope, result };
};

const createDraftArtifact = (
  run: OperatorRun,
  input: Parameters<typeof createOperatorArtifact>[0],
) => dbHelpers.saveOperatorArtifact(createOperatorArtifact(input, run));

const appendAutoVideoStoryboardArtifactQA = (
  artifact: OperatorArtifactEnvelope,
  relatedArtifacts: OperatorArtifactEnvelope[] = [],
) => {
  const verdict = runOperatorArtifactQA({ artifact, relatedArtifacts: [artifact, ...relatedArtifacts] });
  assert.ok(verdict, `auto artifact QA should support kind ${artifact.kind}`);
  assert.equal(verdict.blocking, false, JSON.stringify(verdict.issues, null, 2));
  const saved = dbHelpers.appendOperatorArtifactQA(artifact.id, verdict);
  assert.ok(saved, `artifact QA should save: ${artifact.id}`);
  return saved as OperatorArtifactEnvelope;
};

try {
  dbHelpers.deleteProject(projectId);
  dbHelpers.saveProject(baseProject);

  const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
    projectId,
    provider: "codex",
    mode: "produce",
    userRequest: "关闭外部模型调用，仅用本地 AI Operator 生成一集到分镜和图片验收。",
    scope: { projectId, episodeIds: [episodeId] },
  }, OPERATOR_HANDBOOK_VERSION));
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: "context_read",
    message: "读取临时项目上下文与 Operator 手册。",
    entityIds: [projectId, episodeId],
  });
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: "plan_created",
    message: "计划写入场景、分镜、中文视觉提示词、图片验收资产，并执行系统同源 QA。",
    entityIds: [projectId, episodeId, sceneId],
  });

  const sceneArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "scene_patch",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}`,
    entityIds: [episodeId, sceneId],
    data: { episodeId, sceneId, scene },
  });
  dbHelpers.appendOperatorArtifactQA(sceneArtifact.id, {
    qaAgentId: "operator.e2e.scene_contract",
    status: "passed",
    blocking: false,
    score: 100,
    issues: [],
    nextAction: "commit",
  });
  commitArtifact(sceneArtifact.id);

  const projectWithScene = dbHelpers.getProjectById(projectId) as Project;
  const storyboardCandidate: Project = {
    ...projectWithScene,
    episodes: (projectWithScene.episodes || []).map((episode) => episode.id === episodeId
      ? {
          ...episode,
          scenes: ((episode as any).scenes || []).map((item: Scene) => item.id === sceneId ? { ...item, shots } : item),
        }
      : episode),
  };
  const storyboardVerdict = runOperatorQA({ check: "storyboard", project: storyboardCandidate, episodes: storyboardCandidate.episodes as any });
  const promptVerdict = runOperatorQA({ check: "visual-prompts", project: storyboardCandidate, episodes: storyboardCandidate.episodes as any });
  assert.equal(storyboardVerdict.blocking, false, JSON.stringify(storyboardVerdict.issues, null, 2));
  assert.equal(promptVerdict.blocking, false, JSON.stringify(promptVerdict.issues, null, 2));

  const storyboardArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "storyboard_shots",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.shots`,
    entityIds: [episodeId, sceneId, ...shots.map((shot) => shot.id)],
    data: { episodeId, sceneId, shots },
  });
  dbHelpers.appendOperatorArtifactQA(storyboardArtifact.id, {
    ...storyboardVerdict,
    qaAgentId: "operator.e2e.storyboard",
    status: statusForVerdict(storyboardVerdict),
    nextAction: "commit",
  });
  dbHelpers.appendOperatorArtifactQA(storyboardArtifact.id, {
    ...promptVerdict,
    qaAgentId: "operator.e2e.visual_prompt",
    status: statusForVerdict(promptVerdict),
    nextAction: "commit",
  });
  commitArtifact(storyboardArtifact.id);

  const performanceBeats = [{
    id: "beat-operator-e2e-dialogue-1",
    episodeId,
    sceneId,
    scriptBlockIds: ["sb-operator-e2e-1", "sb-operator-e2e-2"],
    beatType: "dialogue",
    summary: "林砚与何执事围绕青岚令形成公开对峙。",
    visibleChange: "林砚从压低目光到举起青岚令，何执事从压名册到被迫盯向令牌。",
    startState: "林砚站在山门石阶左侧，青岚令尚未举起。",
    endState: "青岚令发光，何执事的权威被当众挑战。",
    durationSeconds: 10,
    characterIds: ["char-lin-yan", "char-deacon-he"],
    locationId: "loc-qinglan-gate",
    propIds: ["prop-qinglan-token"],
    dialogueLineCount: 2,
    actionBeatCount: 0,
    combatBeatCount: 0,
    emotionalBeatCount: 1,
    soundCues: ["雨后檐滴", "远处试炼钟尾音"],
    continuityIn: "承接前一镜林砚 left、何执事 right 的轴线。",
    continuityOut: "以青岚令金光作为下一段首帧视觉锚点。",
  }];
  const performanceBeatArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "performance_beats",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.performanceBeats`,
    entityIds: [episodeId, sceneId, performanceBeats[0].id],
    data: { performanceBeats },
  });
  const approvedPerformanceBeatArtifact = appendAutoVideoStoryboardArtifactQA(performanceBeatArtifact);

  const sceneVisualPack = {
    id: "svp-operator-e2e-dialogue-1",
    projectId,
    episodeId,
    sourceSceneIds: [sceneId],
    linkedSceneIds: [sceneId],
    baseAssetBoardPlanId: `${projectId}.asset_board_plan`,
    visualFingerprint: "svp.operator_e2e_dialogue_1",
    location: {
      assetId: "loc-qinglan-gate",
      setDressingState: "雨后青岚宗山门，石阶湿润，执事名册在右侧案台。",
      timeOfDay: "DAWN",
      lightingState: "雨后冷青天光，令牌金光作为尾帧锚点。",
    },
    characters: [
      { characterId: "char-lin-yan", costumeState: "旧道袍半湿，袖口磨损。", emotionalBaseline: "压住恐惧后转为坚定。" },
      { characterId: "char-deacon-he", costumeState: "执事深色袍服完整。", emotionalBaseline: "维持威压后被迫动摇。" },
    ],
    props: [
      { assetId: "prop-qinglan-token", ownerCharacterId: "char-lin-yan", usageState: "林砚举起青岚令，令牌发出金光。", continuityState: "金光作为下一段首帧。" },
    ],
    referenceSlots: [
      { slotId: "character-char-lin-yan", assetId: "char-lin-yan", purpose: "identity", priority: 10 },
      { slotId: "character-char-deacon-he", assetId: "char-deacon-he", purpose: "identity", priority: 11 },
      { slotId: "location-loc-qinglan-gate", assetId: "loc-qinglan-gate", purpose: "set", priority: 30 },
      { slotId: "prop-prop-qinglan-token", assetId: "prop-qinglan-token", purpose: "prop", priority: 50 },
    ],
    continuityIn: "承接前一镜林砚 left、何执事 right 的轴线。",
    continuityOut: "青岚令金光作为下一段首帧视觉锚点。",
    qaChecklist: ["本场资产无冗余", "复用判断正确", "referenceSlots 可投影到模型输入"],
  };
  const sceneVisualPackArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "scene_visual_pack",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.sceneVisualPacks.${sceneVisualPack.id}`,
    entityIds: [episodeId, sceneId, sceneVisualPack.id],
    data: { sceneVisualPack },
  });
  const approvedSceneVisualPackArtifact = appendAutoVideoStoryboardArtifactQA(sceneVisualPackArtifact);

  const assetReferencePack = {
    id: "pack-operator-e2e-dialogue-1",
    episodeId,
    sceneId,
    sceneVisualPackId: sceneVisualPack.id,
    modelInputFingerprint: "mif.operator_e2e_dialogue_1",
    modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    purpose: "为林砚与何执事 10 秒单镜头对白准备角色、场景、道具参考。",
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    packagingNotes: "角色外貌、宗门山门材质和青岚令细节进入参考包，videoPrompt 只保留动作、构图、首尾状态。",
    items: [
      { assetId: "char-lin-yan", assetType: "character", referenceAssetId: "operator-ref-lin-yan", roleInUnit: "主角左侧", required: true },
      { assetId: "char-deacon-he", assetType: "character", referenceAssetId: "operator-ref-deacon-he", roleInUnit: "对手右侧", required: true },
      { assetId: "loc-qinglan-gate", assetType: "location", referenceAssetId: "operator-ref-qinglan-gate", roleInUnit: "山门场景", required: true },
      { assetId: "prop-qinglan-token", assetType: "prop", referenceAssetId: "operator-ref-token", roleInUnit: "关键道具", required: true },
    ],
  };
  const assetPackArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "asset_reference_pack",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.assetReferencePacks.${assetReferencePack.id}`,
    entityIds: [episodeId, sceneId, assetReferencePack.id],
    data: { assetReferencePack },
  });
  const approvedAssetPackArtifact = appendAutoVideoStoryboardArtifactQA(assetPackArtifact, [
    approvedSceneVisualPackArtifact,
  ]);

  const strategyDecision = {
    selectedStrategyId: "storyboard.single_shot_dialogue.v1",
    selectedStrategyVersion: "v1",
    selectedModelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    rationale: "当前段落以双人对白、眼神和令牌微动作为核心，没有打斗或追逐，10 秒时长和 4 张参考图符合所选模型 profile，因此选择单镜头对白表演板。",
    rejectedStrategyIds: ["storyboard.fight_choreography.v1", "storyboard.action_continuity.v1"],
    riskNotes: ["需要确保两句对白和停顿能支撑 10 秒。"],
    expectedBoardShape: "3-4 格单镜头表演板",
    expectedVideoUnitDurationSeconds: 10,
    expectedReferenceImageCount: 4,
    expectedReferenceVideoCount: 0,
    arrowLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green"],
    qaChecklist: ["对白时长可支撑", "角色位置稳定", "令牌光效承接下一段"],
  };
  const storyboardBoard = {
    id: "board-operator-e2e-dialogue-1",
    episodeId,
    sceneId,
    strategyDecision,
    boardMode: "single_shot_performance",
    layout: "1x4",
    lineArtPrompt: "中文线稿故事板：3 格单镜头对白表演板，林砚 left、何执事 right，红色箭头标注举令微动作，蓝色箭头标注轻微慢推，绿色箭头标注视线。",
    arrowLegendIds: ["subject_action_red", "camera_motion_blue", "eyeline_attention_green"],
    performanceBeatIds: [performanceBeats[0].id],
    scriptBlockIds: performanceBeats[0].scriptBlockIds,
    shotIds: [shots[1].id],
    assetReferencePackId: assetReferencePack.id,
    videoGenerationUnitId: "unit-operator-e2e-dialogue-1",
    panels: [
      { id: "panel-1", panelNumber: 1, performanceBeatId: performanceBeats[0].id, shotId: shots[1].id, durationSeconds: 3, framePurpose: "起始对峙", shotType: "MS 双人中景", visualBeat: "林砚压住怒意，何执事压名册。", cameraNote: "固定轴线，轻微慢推开始。", actionArrowLegendIds: ["camera_motion_blue", "eyeline_attention_green"], dialogueOrSoundCue: "檐滴和低声议论。" },
      { id: "panel-2", panelNumber: 2, performanceBeatId: performanceBeats[0].id, shotId: shots[1].id, durationSeconds: 4, framePurpose: "台词和举令", shotType: "MS 双人中景", visualBeat: "林砚举起青岚令，手指收紧。", cameraNote: "慢推保持林砚 left。", actionArrowLegendIds: ["subject_action_red", "camera_motion_blue"], dialogueOrSoundCue: "林砚低声要求一次试炼机会。" },
      { id: "panel-3", panelNumber: 3, performanceBeatId: performanceBeats[0].id, shotId: shots[1].id, durationSeconds: 3, framePurpose: "尾状态和钩子", shotType: "MS 双人中景", visualBeat: "青岚令亮起，何执事视线被迫落到令牌。", cameraNote: "慢推停在令牌与两人脸之间。", actionArrowLegendIds: ["subject_action_red", "eyeline_attention_green"], dialogueOrSoundCue: "试炼钟尾音。" },
    ],
    startState: performanceBeats[0].startState,
    endState: performanceBeats[0].endState,
  };
  const storyboardBoardArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "storyboard_board",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.storyboardBoards.${storyboardBoard.id}`,
    entityIds: [episodeId, sceneId, storyboardBoard.id],
    data: { storyboardBoard },
  });
  const approvedStoryboardBoardArtifact = appendAutoVideoStoryboardArtifactQA(storyboardBoardArtifact, [
    approvedPerformanceBeatArtifact,
    approvedSceneVisualPackArtifact,
    approvedAssetPackArtifact,
  ]);

  const videoGenerationUnit = {
    id: "unit-operator-e2e-dialogue-1",
    episodeId,
    sceneId,
    modelProfileId: "video.storyboard_reference.configurable.short_unit.v1",
    durationSeconds: 10,
    performanceBeatIds: [performanceBeats[0].id],
    storyboardBoardId: storyboardBoard.id,
    assetReferencePackId: assetReferencePack.id,
    shotIds: [shots[1].id],
    startState: performanceBeats[0].startState,
    endState: performanceBeats[0].endState,
    promptTemplateId: "storyboard.videoGenerationUnit.plan",
    videoPrompt: "竖屏 9:16，单镜头双人中景，林砚 left 举起青岚令，何执事 right 压住名册，轻微慢推，令牌金光成为尾帧锚点，10 秒，角色位置稳定。",
    audioPlan: "雨后檐滴、低声议论、试炼钟尾音，两句对白清晰。",
  };
  const videoUnitArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "video_generation_unit",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.videoGenerationUnits.${videoGenerationUnit.id}`,
    entityIds: [episodeId, sceneId, videoGenerationUnit.id],
    data: { videoGenerationUnit },
  });
  appendAutoVideoStoryboardArtifactQA(videoUnitArtifact, [
    approvedPerformanceBeatArtifact,
    approvedSceneVisualPackArtifact,
    approvedAssetPackArtifact,
    approvedStoryboardBoardArtifact,
  ]);

  const auditMediaUrl = "/operator-audit/operator-e2e-shot-2.png";
  const mediaArtifact = createDraftArtifact(run, {
    runId: run.id,
    kind: "media_reference",
    targetPath: `episodes.${episodeId}.scenes.${sceneId}.shots.${shots[1].id}.imageUrl`,
    entityIds: [episodeId, sceneId, shots[1].id],
    data: {
      mediaUrl: auditMediaUrl,
      target: { type: "shot", id: shots[1].id, episodeId, sceneId, field: "imageUrl" },
      media: {
        url: auditMediaUrl,
        kind: "image",
        source: "manual",
        status: "ready",
        createdAt: Date.now(),
        note: "Operator E2E registered audit image reference; no external image model was called.",
      },
    },
  });
  dbHelpers.appendOperatorArtifactQA(mediaArtifact.id, {
    qaAgentId: "operator.e2e.image_audit",
    status: "passed",
    blocking: false,
    score: 96,
    issues: [],
    nextAction: "commit",
  });
  commitArtifact(mediaArtifact.id);

  const registeredAsset = dbHelpers.saveOperatorAsset(createOperatorRegisteredAsset({
    projectId,
    runId: run.id,
    artifactId: mediaArtifact.id,
    kind: "audit",
    mediaUrl: auditMediaUrl,
    prompt: shots[1].imagePrompt,
    targetEntity: { type: "shot", id: shots[1].id, episodeId, sceneId, field: "imageUrl" },
    qaStatus: "passed",
    metadata: {
      generatedBy: "local-ai-operator-e2e",
      externalModelCalls: 0,
      visualChecks: ["中文提示词", "角色/道具/场景对齐", "镜头物理参数继承", "竖屏可读"],
    },
  }));
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: "asset_generated",
    message: "登记分镜图片验收资产引用，未调用外部图片模型。",
    targetPath: `shots.${shots[1].id}.imageUrl`,
    entityIds: [projectId, episodeId, sceneId, shots[1].id],
    data: { assetId: registeredAsset.id, mediaUrl: registeredAsset.mediaUrl },
  });

  const finalProject = dbHelpers.getProjectById(projectId) as Project;
  const finalVerdict = runOperatorQA({ check: "full", project: finalProject, episodes: finalProject.episodes as any });
  assert.equal(finalVerdict.blocking, false, JSON.stringify(finalVerdict.issues, null, 2));
  const finalShot = (finalProject.episodes as any[])[0].scenes[0].shots.find((shot: Shot) => shot.id === shots[1].id);
  assert.equal(finalShot.imageUrl, auditMediaUrl);
  assert.ok(finalShot.imagePrompt.includes("竖屏"));
  assert.ok(finalShot.imagePrompt.includes("青岚令"));

  const latestRun = dbHelpers.getOperatorRunById(run.id);
  assert.ok(latestRun);
  dbHelpers.patchOperatorRun(run.id, {
    status: "completed",
    qaSummary: {
      passed: 4,
      warnings: finalVerdict.issues.filter((issue) => issue.severity === "warning").length,
      failed: 0,
      blocked: 0,
    },
  });

  const runs = dbHelpers.listOperatorRuns(projectId);
  const artifacts = dbHelpers.listOperatorArtifacts({ projectId });
  const assets = dbHelpers.listOperatorAssets({ projectId });
  assert.ok(runs.some((item) => item.id === run.id));
  assert.ok(artifacts.some((item) => item.status === "committed" && item.kind === "storyboard_shots"));
  assert.ok(artifacts.some((item) => item.status === "approved" && item.kind === "performance_beats"));
  assert.ok(artifacts.some((item) => item.status === "approved" && item.kind === "storyboard_board"));
  assert.ok(artifacts.some((item) => item.status === "approved" && item.kind === "scene_visual_pack"));
  assert.ok(artifacts.some((item) => item.status === "approved" && item.kind === "asset_reference_pack"));
  assert.ok(artifacts.some((item) => item.status === "approved" && item.kind === "video_generation_unit"));
  assert.ok(assets.some((item) => item.id === registeredAsset.id && item.qaStatus === "passed"));

  const context = buildOperatorProjectContext({
    project: finalProject,
    operatorRuns: dbHelpers.listOperatorRuns(projectId),
    productionRuns: [],
    handbookVersion: OPERATOR_HANDBOOK_VERSION,
  });
  assert.equal(context.productionState.lastRuns[0]?.source, "operator_run");
  assert.equal(context.structureMemory.shots.length >= 3, true);

  const operatorClientSource = fs.readFileSync(new URL("../apps/web/src/clients/operatorClient.ts", import.meta.url), "utf-8");
  assert.ok(operatorClientSource.includes("/api/operator/artifacts?projectId="));
  assert.ok(operatorClientSource.includes("/api/operator/assets?projectId="));

  console.log(JSON.stringify({
    status: "passed",
    projectId,
    runId: run.id,
    committedArtifacts: artifacts.filter((item) => item.status === "committed").length,
    videoStoryboardArtifacts: artifacts.filter((item) => ["performance_beats", "storyboard_board", "scene_visual_pack", "asset_reference_pack", "video_generation_unit"].includes(item.kind)).length,
    registeredAssets: assets.length,
    finalQaStatus: finalVerdict.status,
    finalQaIssues: finalVerdict.issues.length,
  }, null, 2));
} finally {
  dbHelpers.deleteProject(projectId);
}
