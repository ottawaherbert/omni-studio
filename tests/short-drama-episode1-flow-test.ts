import assert from "node:assert/strict";
import { dbHelpers } from "../src/server/db";
import { createOperatorArtifact } from "../src/services/operator/artifacts";
import { runOperatorArtifactQA, runOperatorQA } from "../src/services/operator/qa";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION } from "../src/services/operator/types";
import type { OperatorArtifactEnvelope, OperatorRun } from "../src/services/operator/types";
import { buildVideoStoryboardAssetBoardPlan, validateVideoStoryboardAssetBoardPlan } from "../src/services/production/videoStoryboardAssetBoards";
import { buildProductionAssetReferencePackDrafts } from "../src/services/production/videoStoryboardPromptPacks";
import { buildProductionSceneVisualPackDrafts } from "../src/services/production/videoStoryboardSceneVisualPacks";
import { buildProductionStoryboardBoardDrafts } from "../src/services/production/videoStoryboardStageBoards";
import { buildProductionVideoGenerationUnitDrafts } from "../src/services/production/videoStoryboardVideoUnits";
import { buildProductionPerformanceBeatDrafts } from "../src/services/production/videoStoryboardPerformanceBeats";
import {
  buildProductionCoordinationStageGate,
  buildProductionCoordinationWrapQA,
} from "../src/services/production/productionCoordination";
import { linearStageDefinitions } from "../src/services/production/stages";
import type { Episode, Project, Scene, Shot } from "../src/types/project";

type StageReport = {
  stageType: string;
  status: "passed" | "warning" | "failed";
  summary: string;
  artifactCount: number;
  blockingIssues: number;
  warningIssues: number;
};

const now = Date.now();
const projectId = `short10-ep1-${now}`;
const episode1Id = `${projectId}-ep-01`;
const stageReports: StageReport[] = [];
const savedArtifacts: OperatorArtifactEnvelope[] = [];

const stageOrder = linearStageDefinitions.map((stage) => stage.stageType);
assert.deepEqual(stageOrder, [
  "intake",
  "concept",
  "context_planning",
  "bible",
  "asset_detail",
  "structure",
  "scene",
  "script",
  "script_lock",
  "production_breakdown",
  "production_asset_detail",
  "asset_sync",
  "storyboard",
  "prompt",
  "expensive_generation_planning",
]);

const blocking = (issues: Array<{ severity?: string; blocking?: boolean }>) =>
  issues.filter((issue) => issue.severity === "blocking" || issue.blocking).length;

const warnings = (issues: Array<{ severity?: string; blocking?: boolean }>) =>
  issues.filter((issue) => issue.severity === "warning" && !issue.blocking).length;

const episodeTitles = [
  "第一集：雨夜遗嘱",
  "第二集：当铺第七条规矩",
  "第三集：亡母留下的钥匙",
  "第四集：假继承人的订婚宴",
  "第五集：账本里的第二个名字",
  "第六集：她替他挡下血契",
  "第七集：顾砚舟的真实身份",
  "第八集：当铺失火夜",
  "第九集：继承权反杀局",
  "第十集：雨停之后的契约",
];

const createEpisodeMeta = (index: number): Episode => ({
  id: index === 0 ? episode1Id : `${projectId}-ep-${String(index + 1).padStart(2, "0")}`,
  title: episodeTitles[index],
  inspiration: [
    "每集 5 分钟，前三秒必须有冲突，结尾必须有追更钩子。",
    index === 0 ? "苏晚在父亲葬礼后收到午夜遗嘱，被迫进入雨夜当铺验证继承权。" : `第 ${index + 1} 集继续推进继承权、血契和顾砚舟身份反转。`,
  ].join(" "),
  scenes: [],
} as Episode);

const makeShot = (
  sceneId: string,
  index: number,
  visualAction: string,
  characterIdsInShot: string[],
  locationId: string,
  propIds: string[],
  duration = 10,
  motivation = "服务短剧快节奏反转，镜头内必须有信息变化。",
): Shot => {
  const shotSize = index % 3 === 0 ? "CU" : index % 3 === 1 ? "MS" : "WS";
  const cameraAngle = index % 2 === 0 ? "low angle" : "eye-level";
  const cameraMovement = index % 2 === 0 ? "slow push-in" : "handheld drift";
  const focalLength = index % 3 === 0 ? "50mm" : index % 3 === 1 ? "35mm" : "24mm";
  const lighting = "雨夜冷蓝环境光与钨丝暖光对比，面部表情和关键道具必须可读。";
  const composition = "竖屏 9:16，角色站位和道具位置稳定，前景保留雨滴或玻璃反光作为空间层次。";
  const blocking = "苏晚默认 screen left，顾砚舟默认 screen right，关键道具从两人之间的桌面或门口进入画面。";
  const physicalSpec = `${shotSize}，${cameraAngle}，${cameraMovement}，${focalLength}，${lighting}${composition}${blocking}`;
  return {
    id: `${sceneId}-shot-${String(index).padStart(2, "0")}`,
    shotSize,
    cameraAngle,
    cameraMovement,
    focalLength,
    lighting,
    composition,
    blocking,
    continuityNote: "保持 180 度轴线、视线方向、雨伞/怀表/账本归属和人物屏幕方位连续。",
    visualAction,
    duration,
    motivation,
    characterIdsInShot,
    locationId,
    propIds,
    imagePrompt: `中文图片提示词：${physicalSpec}，${visualAction}，雨夜都市玄门悬疑氛围，角色方位清楚，道具关系可读，电影感但不遮挡表情。`,
    videoPrompt: `中文视频提示词：竖屏mobile，${physicalSpec}，${visualAction}，10秒视频单元，动作连续，镜头运动克制，保持人物身份、服装、道具归属和空间方向一致。`,
  };
};

const makeScene = ({
  id,
  sceneNumber,
  title,
  description,
  locationId,
  locationName,
  locationState,
  propIds,
  propStates,
  sceneAssets,
  valueFrom,
  valueTo,
  hook,
  cliffhanger,
  variantMap,
  shotActions,
}: {
  id: string;
  sceneNumber: string;
  title: string;
  description: string;
  locationId: string;
  locationName: string;
  locationState: string;
  propIds: string[];
  propStates: string[];
  sceneAssets: string;
  valueFrom: string;
  valueTo: string;
  hook: string;
  cliffhanger: string;
  variantMap?: Record<string, string>;
  shotActions: string[];
}): Scene => {
  const characterIds = title.includes("逼宫")
    ? ["char-su-wan", "char-gu-yanzhou", "char-zhou-qiming"]
    : ["char-su-wan", "char-gu-yanzhou"];
  return {
    id,
    sceneNumber,
    title,
    description,
    valueCharge: valueTo.includes("威胁") || valueTo.includes("失控") ? "negative" : "positive",
    valueShift: {
      from: valueFrom,
      to: valueTo,
      reason: "每场必须从信息压制转为新证据或新代价，支撑短剧追更。",
    },
    hook,
    cliffhanger,
    targetDuration: 1,
    sceneGoal: description,
    environment: locationId === "loc-rain-pawnshop" || locationId === "loc-archive-hospital" ? "INT." : "EXT.",
    timeOfDay: "NIGHT",
    sceneAssets,
    scriptBlocks: [
      { id: `${id}-sb-1`, type: "scene_heading", content: `${locationId === "loc-funeral-hall" ? "EXT." : "INT."} ${locationName} - NIGHT`, locationId },
      { id: `${id}-sb-2`, type: "action", content: shotActions[0], locationId, propIds },
      { id: `${id}-sb-3`, type: "character", content: "苏晚", linkedAssetId: "char-su-wan" },
      { id: `${id}-sb-4`, type: "dialogue", content: title.includes("葬礼") ? "我爸的遗嘱，为什么会在你手里？" : "这不是交易，这是有人逼我走进来。", linkedAssetId: "char-su-wan" },
      { id: `${id}-sb-5`, type: "character", content: title.includes("逼宫") ? "周启明" : "顾砚舟", linkedAssetId: title.includes("逼宫") ? "char-zhou-qiming" : "char-gu-yanzhou" },
      { id: `${id}-sb-6`, type: "dialogue", content: title.includes("逼宫") ? "她连遗嘱真假都说不清，凭什么继承苏家？" : "午夜以后，遗嘱只认付得起代价的人。", linkedAssetId: title.includes("逼宫") ? "char-zhou-qiming" : "char-gu-yanzhou" },
      { id: `${id}-sb-7`, type: "action", content: shotActions.slice(1, 4).join(" "), locationId, propIds },
    ],
    breakdown: {
      setting: locationId === "loc-funeral-hall" ? "EXT." : "INT.",
      location: { name: locationName, state: locationState },
      time: "NIGHT",
      characters: characterIds.map((characterId) => ({
        name: characterId === "char-su-wan" ? "苏晚" : characterId === "char-gu-yanzhou" ? "顾砚舟" : "周启明",
        state: variantMap?.[characterId] ? "可见状态变化" : "默认造型",
      })),
      props: propIds.map((propId, index) => ({
        name: propId === "prop-black-umbrella" ? "黑伞" : propId === "prop-brass-watch" ? "铜怀表" : propId === "prop-blood-ledger" ? "血契账本" : "遗嘱信封",
        state: propStates[index] || "默认状态",
      })),
      characterIds,
      locationId,
      propIds,
      wardrobe: variantMap?.["char-su-wan"] ? ["苏晚黑裙袖口有血痕，右手腕出现黑色契印"] : ["苏晚黑色葬礼裙，顾砚舟深色长风衣，周启明灰色西装"],
      makeupHair: variantMap?.["char-su-wan"] ? ["苏晚眼眶泛红，右手腕黑色契印清楚"] : ["妆发完整，雨水只在外套和发梢"],
      assetVariantMap: variantMap,
      sfx: ["雨声", "旧钟声", "纸张摩擦"],
    },
    shots: shotActions.map((action, index) => {
      const motivationSteps = [
        "建立场景压迫和人物站位，让观众在 3 秒内读懂冲突入口。",
        "引入关键道具或证据，推动本场信息从情绪进入事实。",
        "放大主角反应和对抗关系，让观众确认选择压力。",
        "制造规则异象或反转信号，让故事从现实层推进到玄门层。",
        "转移下一条线索或权力归属，为后续镜头提供动作理由。",
        "完成本场钩子，把观众注意力推向下一场或下一集。",
      ];
      const visibleCharacters = characterIds.filter((characterId) =>
        action.includes(characterId === "char-zhou-qiming" ? "周启明" : characterId === "char-gu-yanzhou" ? "顾砚舟" : "苏晚") || index < 2,
      );
      return makeShot(
        id,
        index + 1,
        action,
        visibleCharacters.length ? visibleCharacters : [characterIds[0]],
        locationId,
        propIds,
        10,
        motivationSteps[index] || "承接上一镜头的信息变化，保持动作和情绪连续。",
      );
    }),
  };
};

const scene1Id = `${projectId}-ep1-scene-1`;
const scene2Id = `${projectId}-ep1-scene-2`;
const scene3Id = `${projectId}-ep1-scene-3`;
const scene4Id = `${projectId}-ep1-scene-4`;
const scene5Id = `${projectId}-ep1-scene-5`;

const episode1Scenes: Scene[] = [
  makeScene({
    id: scene1Id,
    sceneNumber: "1",
    title: "葬礼后的午夜遗嘱",
    description: "苏晚在父亲葬礼后收到一封不该存在的遗嘱，顾砚舟第一次出现。",
    locationId: "loc-funeral-hall",
    locationName: "苏家葬礼雨棚",
    locationState: "雨夜临时雨棚，遗照和白花被风吹乱",
    propIds: ["prop-will-envelope", "prop-black-umbrella"],
    propStates: ["封蜡完整，边角有雨痕", "顾砚舟手中黑伞未破损"],
    sceneAssets: "苏家葬礼雨棚，雨夜，遗照、白花、黑伞、封蜡遗嘱信封。",
    valueFrom: "苏晚被排除在继承权外",
    valueTo: "苏晚拿到午夜遗嘱线索",
    hook: "前三秒：周启明当众宣布苏晚无权继承，顾砚舟的黑伞挡住遗照雨水。",
    cliffhanger: "遗嘱信封上浮出苏晚母亲的旧名。",
    shotActions: [
      "周启明在葬礼雨棚前宣布苏晚无权继承，苏晚站在雨中没有退。",
      "顾砚舟撑黑伞从遗照旁出现，把封蜡遗嘱信封递到苏晚面前。",
      "苏晚低头看见信封边角的母亲旧名，雨水顺着封蜡滑落。",
      "周启明伸手要抢遗嘱，顾砚舟用黑伞挡住他的手。",
      "苏晚抬眼质问顾砚舟，顾砚舟只看向远处午夜钟楼。",
      "遗嘱信封在钟声里浮出一行字：午夜当铺见。",
    ],
  }),
  makeScene({
    id: scene2Id,
    sceneNumber: "2",
    title: "雨夜当铺第一面",
    description: "苏晚进入雨夜当铺，顾砚舟提出验证遗嘱的代价。",
    locationId: "loc-rain-pawnshop",
    locationName: "雨夜当铺",
    locationState: "木柜完整，旧钟停在午夜，玻璃门外有雨痕",
    propIds: ["prop-brass-watch", "prop-blood-ledger"],
    propStates: ["铜怀表完整，指针停在十二点", "血契账本合上，封皮无血痕"],
    sceneAssets: "雨夜当铺，木柜完整，旧钟停在午夜，玻璃门外有雨痕，铜怀表完整，血契账本合上。",
    valueFrom: "苏晚只想验证遗嘱",
    valueTo: "苏晚知道遗嘱验证需要代价",
    hook: "当铺门铃自己响起，旧钟明明停摆却敲了十二下。",
    cliffhanger: "顾砚舟说验证遗嘱要押上一段记忆。",
    shotActions: [
      "苏晚推开雨夜当铺玻璃门，顾砚舟站在木柜后抬起铜怀表。",
      "铜怀表指针停在十二点，血契账本合在木柜中央。",
      "苏晚把遗嘱信封放在账本旁，顾砚舟没有立刻触碰。",
      "旧钟敲响，玻璃门外雨水倒流一秒，苏晚意识到这里不正常。",
      "顾砚舟把铜怀表推向苏晚，说明验证遗嘱需要押上一段记忆。",
      "苏晚的手停在怀表上方，账本封皮自行翻开第一页。",
    ],
  }),
  makeScene({
    id: scene3Id,
    sceneNumber: "3",
    title: "旧医院档案室",
    description: "遗嘱线索指向旧医院，苏晚发现父亲死亡并非意外。",
    locationId: "loc-archive-hospital",
    locationName: "旧医院档案室",
    locationState: "档案柜半开，冷白灯闪烁，地面有水迹",
    propIds: ["prop-brass-watch", "prop-will-envelope"],
    propStates: ["铜怀表完整，表盖有雾气", "遗嘱信封已拆开，纸边湿润"],
    sceneAssets: "旧医院档案室，档案柜半开，冷白灯闪烁，铜怀表完整，遗嘱信封拆开。",
    valueFrom: "苏晚以为父亲只是病逝",
    valueTo: "苏晚发现父亲死亡当晚有人改过档案",
    hook: "档案柜自己弹开，露出父亲死亡当晚的空白页。",
    cliffhanger: "空白页显出顾砚舟十年前的签名。",
    shotActions: [
      "苏晚在旧医院档案室打开父亲病历，冷白灯连续闪烁。",
      "铜怀表在档案柜上震动，表盖雾气形成一串旧日期。",
      "苏晚拆开遗嘱信封，信纸边缘显出医院地下室编号。",
      "档案柜自己弹开，父亲死亡当晚的记录被整页撕掉。",
      "顾砚舟从门口阴影里出现，阻止苏晚继续翻档案。",
      "空白病历页浮出顾砚舟十年前的签名，苏晚后退半步。",
    ],
  }),
  makeScene({
    id: scene4Id,
    sceneNumber: "4",
    title: "雨夜当铺复盘",
    description: "苏晚带着旧医院线索回到当铺，视觉状态与第二场保持一致，用于测试视觉包复用。",
    locationId: "loc-rain-pawnshop",
    locationName: "雨夜当铺",
    locationState: "木柜完整，旧钟停在午夜，玻璃门外有雨痕",
    propIds: ["prop-brass-watch", "prop-blood-ledger"],
    propStates: ["铜怀表完整，指针停在十二点", "血契账本合上，封皮无血痕"],
    sceneAssets: "雨夜当铺，木柜完整，旧钟停在午夜，玻璃门外有雨痕，铜怀表完整，血契账本合上。",
    valueFrom: "苏晚怀疑顾砚舟参与父亲旧案",
    valueTo: "苏晚确认当铺和旧案有关",
    hook: "苏晚把病历空白页拍在当铺木柜上。",
    cliffhanger: "顾砚舟说下一条线索在周启明手里。",
    shotActions: [
      "苏晚回到雨夜当铺，把旧医院空白病历页拍在木柜上。",
      "顾砚舟仍站在木柜后，铜怀表和血契账本位置与第一次进当铺一致。",
      "苏晚质问十年前签名，顾砚舟垂眼看向账本但没有打开。",
      "旧钟再次敲响十二下，玻璃门外雨水倒流一秒。",
      "顾砚舟把铜怀表推回原位，提示周启明手里有下一条线索。",
      "苏晚转身离开当铺，血契账本仍合着，封皮无血痕。",
    ],
  }),
  makeScene({
    id: scene5Id,
    sceneNumber: "5",
    title: "继承人逼宫",
    description: "周启明当众逼宫，苏晚手腕出现黑色契印，账本状态变化，形成第 1 集追更钩子。",
    locationId: "loc-su-boardroom",
    locationName: "苏氏董事会议室",
    locationState: "玻璃会议室，投影屏显示继承权公告，门外雨夜霓虹",
    propIds: ["prop-blood-ledger", "prop-will-envelope"],
    propStates: ["血契账本封皮出现一滴血痕", "遗嘱信封已拆开，封蜡断裂"],
    sceneAssets: "苏氏董事会议室，投影屏、长桌、遗嘱信封已拆，血契账本出现一滴血痕。",
    valueFrom: "苏晚掌握线索但没有公众证据",
    valueTo: "苏晚获得继承权入口但契约失控",
    hook: "周启明在董事会上播放苏晚无继承资格的假公告。",
    cliffhanger: "苏晚手腕黑色契印亮起，血契账本写下顾砚舟的名字。",
    variantMap: {
      "char-su-wan": "variant-su-contract-mark",
      "prop-blood-ledger": "variant-ledger-blood-open",
      "prop-will-envelope": "variant-will-opened",
    },
    shotActions: [
      "周启明在苏氏董事会议室播放假公告，苏晚站在长桌尽头面对所有董事。",
      "苏晚把已拆开的遗嘱信封放上长桌，封蜡断裂清楚可见。",
      "血契账本突然出现在会议桌中央，封皮渗出一滴血痕。",
      "苏晚右手腕浮出黑色契印，顾砚舟隔着玻璃门看见后神色失控。",
      "周启明伸手要合上账本，账本自动翻到顾砚舟名字那一页。",
      "苏晚看见账本写下顾砚舟名字，意识到自己押上的不是记忆而是他。",
    ],
  }),
];

const episodes: Episode[] = episodeTitles.map((_, index) => ({
  ...createEpisodeMeta(index),
  scenes: index === 0 ? episode1Scenes : [],
}));

const project: Project = {
  id: projectId,
  title: `[TEST] 十集短剧制片流程 - 雨夜当铺 ${now}`,
  type: "short-drama",
  projectModel: "linear",
  aspectRatio: "9:16",
  logline: "被逐出继承权的苏晚在雨夜当铺验证父亲遗嘱，却发现每一条继承线索都要用她和顾砚舟的记忆交换。",
  coreConflict: "苏晚必须证明父亲遗嘱真实并夺回继承权，对抗周启明的伪造公告和雨夜当铺的血契代价，否则她会失去父亲真相和顾砚舟。",
  targetEpisodeCount: 10,
  durationMinutes: 50,
  seasonArc: "1-3 集验证遗嘱与父亲旧案；4-6 集揭开顾砚舟与当铺血契；7-9 集反杀周启明和幕后董事；第 10 集苏晚用继承权交换顾砚舟自由。",
  creativeVision: {
    genre: ["现代都市", "玄门悬疑", "短剧", "甜虐复仇"],
    visualStyle: "雨夜冷蓝、当铺钨丝暖光、玻璃反光、血契红色作为核心视觉母题。",
    narrativeStyle: "前三秒强冲突，每分钟一个证据反转，集尾付费钩子。",
    referenceWorks: "原创，不复刻具体作品。",
    want: "苏晚想证明遗嘱真实并夺回继承权。",
    need: "她必须学会相信顾砚舟，而不是把所有人都当成交易者。",
    stakes: "失败会让父亲死亡真相被掩盖，苏晚失去继承权，顾砚舟被血契吞掉。",
    oppositionForce: "周启明、董事会、雨夜当铺血契规则。",
    themeQuestion: "一段记忆能否比一份遗产更值钱。",
    protagonistArc: "苏晚从被动接收遗嘱，到主动拆解血契规则并救出顾砚舟。",
    emotionalReward: "观众看到女主夺权反杀，同时守住与男主的互相信任。",
  },
  productionMemory: {
    handbookVersion: OPERATOR_HANDBOOK_VERSION,
    updatedAt: now,
    commercialMemory: {
      monetizationPromise: "每集前 3 秒给羞辱或异象冲突，每分钟给证据反转，集尾以血契代价或身份秘密制造追更。",
    },
    skeletonMemory: {
      seasonPromise: "苏晚验证父亲遗嘱、夺回继承权，并救出被雨夜当铺血契困住的顾砚舟。",
      finaleContract: "第 10 集必须偿付雨夜当铺血契：苏晚用继承权交换顾砚舟自由，并公开父亲死亡真相。",
      phaseMap: [
        {
          id: "phase-1",
          episodes: "1-3",
          title: "遗嘱入局",
          promise: "验证遗嘱、发现父亲死亡旧案、建立雨夜当铺规则。",
          entryState: "苏晚被逐出继承权。",
          exitState: "苏晚确认父亲死亡和顾砚舟旧签名相关。",
          requiredPayoffs: ["遗嘱信封母亲旧名", "顾砚舟十年前签名"],
        },
        {
          id: "phase-2",
          episodes: "4-6",
          title: "血契失控",
          promise: "苏晚和顾砚舟从交易同盟变成彼此保护，周启明开始反咬。",
          entryState: "苏晚得到继承权入口但契印初现。",
          exitState: "苏晚替顾砚舟挡下一次血契反噬。",
          requiredPayoffs: ["黑色契印", "血契账本写名规则"],
        },
        {
          id: "phase-3",
          episodes: "7-10",
          title: "夺权偿付",
          promise: "揭开顾砚舟身份、反杀周启明、完成继承权与血契的双线偿付。",
          entryState: "苏晚知道顾砚舟不是单纯掌柜。",
          exitState: "苏晚公开父亲真相，并决定是否交换继承权救顾砚舟。",
          requiredPayoffs: ["顾砚舟身份反转", "董事会证据闭环", "第十集契约选择"],
        },
      ],
      relationshipArc: "苏晚和顾砚舟从互相试探，到交易同盟，再到愿意为对方承担代价。",
      payoffMap: ["母亲旧名", "十年前签名", "黑色契印", "血契账本", "继承权公告", "顾砚舟自由"],
    },
    continuityMemory: {
      currentPhase: "phase-1",
      protagonistState: "苏晚刚进入遗嘱验证局，公开身份受压制但行动力强。",
      partnerState: "顾砚舟是雨夜当铺掌柜，表面冷静交易，实际保护苏晚避开最高代价。",
      relationshipStage: "互相试探，信任尚未建立。",
      powerLedger: {
        suWan: "持有遗嘱信封但缺少公开证据。",
        guYanzhou: "掌握当铺规则和铜怀表。",
        zhouQiming: "掌控董事会舆论和伪造公告。",
      },
      propOwnership: {
        "prop-black-umbrella": "顾砚舟持有，保护和阻隔规则的视觉符号。",
        "prop-brass-watch": "顾砚舟保管，验证遗嘱时交到苏晚面前。",
        "prop-blood-ledger": "雨夜当铺核心规则物，不能被普通人随意带走。",
        "prop-will-envelope": "苏晚持有，第 1 集从封蜡完整推进到拆封态。",
      },
      forbiddenContradictions: [
        "苏晚不能在第 1 集前已经知道顾砚舟真实身份。",
        "血契账本默认态不能无理由带血或打开。",
        "周启明不能在当铺场景中可见，除非剧本明确入场。",
        "顾砚舟的黑伞不能转移给周启明使用。",
      ],
      shotContinuityRule: "竖屏短剧必须保持 screen left/right、视线方向、道具归属和集尾钩子连续；每个视频单元生成前必须读当前 scene_visual_pack。",
    },
    episodeMemory: {
      "1": {
        title: "雨夜遗嘱",
        requiredFacts: ["苏晚被周启明公开压制", "顾砚舟递出遗嘱", "苏晚进入雨夜当铺", "血契账本在集尾写下顾砚舟名字"],
        exitState: "苏晚获得继承权入口，但黑色契印出现。",
      },
    },
    qaCouncil: {
      continuityScriptSupervisorQA: "核查多集记忆、角色可见性、道具归属、场景视觉包复用和变体边界。",
      storyboardDirectorQA: "核查 5 分钟节奏、30 个 10 秒视频单元、动作承接、反转露出顺序和竖屏可读性。",
      promptDirectorQA: "核查中文提示词是否继承镜头物理参数、角色身份锚点和资产包引用。",
    },
  },
  characters: [
    {
      id: "char-su-wan",
      name: "苏晚",
      psychologicalProfile: "聪明、克制、被羞辱时反而更冷静。",
      multiViewPrompt: "中文角色板：苏晚，二十四岁都市继承人，黑色葬礼裙，雨夜湿发，眼神克制，正面侧面背面和表情变化。",
      variants: [{
        id: "variant-su-contract-mark",
        name: "黑色契印态",
        description: "右手腕出现黑色契印，袖口有细小血痕，眼眶发红但仍保持冷静。",
        promptModifiers: "右手腕黑色契印清楚，黑裙袖口细小血痕，眼眶微红，雨夜冷光下可读。",
      }],
    },
    {
      id: "char-gu-yanzhou",
      name: "顾砚舟",
      psychologicalProfile: "冷静、神秘、说话像规则但眼神有情绪。",
      multiViewPrompt: "中文角色板：顾砚舟，二十八岁当铺掌柜，深色长风衣，黑伞，铜怀表，冷白皮肤，正面侧面背面和表情变化。",
    },
    {
      id: "char-zhou-qiming",
      name: "周启明",
      psychologicalProfile: "精英外表、轻蔑、善于操控舆论。",
      multiViewPrompt: "中文角色板：周启明，三十岁都市精英，灰色西装，细框眼镜，克制笑容，正面侧面背面和表情变化。",
    },
  ],
  assets: [
    {
      id: "loc-funeral-hall",
      type: "location",
      name: "苏家葬礼雨棚",
      description: "雨夜临时葬礼雨棚，遗照、白花、黑伞和城市霓虹反光。",
      panoramaPrompt: "中文场景板：苏家葬礼雨棚，雨夜、遗照、白花、黑伞、城市霓虹反光，竖屏可拍机位。",
    },
    {
      id: "loc-rain-pawnshop",
      type: "location",
      name: "雨夜当铺",
      description: "只在午夜出现的旧当铺，木柜、旧钟、玻璃门雨痕和钨丝灯。",
      panoramaPrompt: "中文场景板：雨夜当铺，木柜完整，旧钟停在午夜，玻璃门雨痕，钨丝灯暖光，竖屏可拍机位。",
    },
    {
      id: "loc-archive-hospital",
      type: "location",
      name: "旧医院档案室",
      description: "废弃医院档案室，半开档案柜、冷白灯、水迹和旧病历。",
      panoramaPrompt: "中文场景板：旧医院档案室，半开档案柜，冷白灯闪烁，地面积水，旧病历散落。",
    },
    {
      id: "loc-su-boardroom",
      type: "location",
      name: "苏氏董事会议室",
      description: "现代玻璃会议室，长桌、投影屏、雨夜霓虹和董事席。",
      panoramaPrompt: "中文场景板：苏氏董事会议室，玻璃长桌，投影屏，雨夜霓虹，董事席压迫感，竖屏构图。",
    },
    {
      id: "prop-black-umbrella",
      type: "prop",
      name: "黑伞",
      description: "顾砚舟的黑伞，伞柄有旧银纹，雨水不沾伞面。",
      multiViewPrompt: "中文道具板：黑伞，旧银纹伞柄，黑色伞面，雨水不沾，持握方式细节。",
    },
    {
      id: "prop-brass-watch",
      type: "prop",
      name: "铜怀表",
      description: "雨夜当铺的铜怀表，指针常停在午夜十二点。",
      multiViewPrompt: "中文道具板：铜怀表，旧铜材质，指针十二点，表盖雾气，正反面细节。",
    },
    {
      id: "prop-blood-ledger",
      type: "prop",
      name: "血契账本",
      description: "雨夜当铺账本，默认合上无血痕，血契触发后会自动翻页。",
      multiViewPrompt: "中文道具板：血契账本，黑红旧皮革封面，默认合上无血痕，纸张厚重。",
      variants: [{
        id: "variant-ledger-blood-open",
        name: "血痕翻页态",
        description: "封皮出现一滴血痕，自动翻到写有顾砚舟名字的一页。",
        promptModifiers: "账本打开，封皮和纸页有一滴鲜红血痕，页面写有顾砚舟名字。",
      }],
    },
    {
      id: "prop-will-envelope",
      type: "prop",
      name: "遗嘱信封",
      description: "封蜡完整的遗嘱信封，边角有雨痕和苏晚母亲旧名。",
      multiViewPrompt: "中文道具板：封蜡遗嘱信封，边角雨痕，红色封蜡，纸面可见旧名。",
      variants: [{
        id: "variant-will-opened",
        name: "拆封态",
        description: "封蜡断裂，信纸展开，边缘被雨水打湿。",
        promptModifiers: "遗嘱信封已拆开，封蜡断裂，信纸边缘湿润。",
      }],
    },
  ],
  episodes,
};

const saveArtifact = (
  run: OperatorRun,
  kind: OperatorArtifactEnvelope["kind"],
  targetPath: string,
  entityIds: string[],
  data: unknown,
) => dbHelpers.saveOperatorArtifact(createOperatorArtifact({ runId: run.id, kind, targetPath, entityIds, data }, run));

const appendManualQA = (artifact: OperatorArtifactEnvelope, status: "passed" | "warning" | "failed", summary: string) => {
  const saved = dbHelpers.appendOperatorArtifactQA(artifact.id, {
    qaAgentId: `operator.short_drama.${artifact.kind}.qa`,
    status,
    blocking: status === "failed",
    score: status === "failed" ? 0 : status === "warning" ? 85 : 100,
    issues: [],
    nextAction: status === "failed" ? "retry" : "commit",
  });
  assert.ok(saved, `manual QA should save artifact ${artifact.id}: ${summary}`);
  savedArtifacts.push(saved as OperatorArtifactEnvelope);
  return saved as OperatorArtifactEnvelope;
};

const appendAutoQA = (artifact: OperatorArtifactEnvelope) => {
  const verdict = runOperatorArtifactQA({ artifact, relatedArtifacts: [artifact, ...savedArtifacts] });
  assert.ok(verdict, `auto QA must support ${artifact.kind}`);
  assert.equal(verdict.blocking, false, JSON.stringify(verdict.issues, null, 2));
  const saved = dbHelpers.appendOperatorArtifactQA(artifact.id, verdict);
  assert.ok(saved, `auto QA should save artifact ${artifact.id}`);
  savedArtifacts.push(saved as OperatorArtifactEnvelope);
  return saved as OperatorArtifactEnvelope;
};

const addStageReport = (
  run: OperatorRun,
  report: StageReport,
) => {
  stageReports.push(report);
  const artifact = saveArtifact(run, "qa_report", `stages.${report.stageType}.report`, [projectId, episode1Id], { stageReport: report });
  appendManualQA(artifact, report.status, report.summary);
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: report.status === "failed" ? "qa_failed" : "qa_passed",
    message: `${report.stageType}: ${report.summary}`,
    targetPath: `stages.${report.stageType}`,
    entityIds: [projectId, episode1Id],
    data: report,
  });
};

dbHelpers.saveProject(project);
const savedProject = dbHelpers.getProjectById(projectId) as Project & { episodes: Episode[] };
assert.equal(savedProject.episodes.length, 10);
assert.equal(savedProject.episodes[0].scenes?.length, 5);
const episode1 = savedProject.episodes[0];
const episode1DurationSeconds = (episode1.scenes || [])
  .flatMap((scene) => scene.shots || [])
  .reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
assert.equal(episode1DurationSeconds, 300);

const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
  projectId,
  provider: "codex",
  mode: "produce",
  userRequest: "新建 10 集短剧，按系统制片顺序测试第 1 集，每集 5 分钟，本轮做到视频生成计划。",
  scope: {
    projectId,
    episodeIds: [episode1Id],
    sceneIds: episode1Scenes.map((scene) => scene.id),
  },
}, OPERATOR_HANDBOOK_VERSION));

dbHelpers.appendOperatorRunEvent(run.id, {
  type: "context_read",
  message: "读取系统线性制片阶段顺序、Operator 手册和测试计划。",
  entityIds: [projectId, episode1Id],
  data: { stageOrder },
});

addStageReport(run, {
  stageType: "intake",
  status: "passed",
  summary: "项目输入已归档：短剧、10集、每集5分钟、本轮制作第1集。",
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

addStageReport(run, {
  stageType: "concept",
  status: "passed",
  summary: "立项概念已锁定：现代都市玄门悬疑甜虐，继承权与血契双线驱动。",
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

addStageReport(run, {
  stageType: "context_planning",
  status: "passed",
  summary: "上下文策略采用项目内原创设定，不注入外部 Skill/DNA，不调用外部模型。",
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

const schemaVerdict = runOperatorQA({ check: "schema", project: savedProject, episodes: [episode1] });
assert.equal(schemaVerdict.blocking, false, JSON.stringify(schemaVerdict.issues, null, 2));
addStageReport(run, {
  stageType: "bible",
  status: schemaVerdict.status === "failed" ? "failed" : "passed",
  summary: "项目圣经包含3名主要角色、4个核心场景、4个关键道具和整季10集走向。",
  artifactCount: 1,
  blockingIssues: blocking(schemaVerdict.issues),
  warningIssues: warnings(schemaVerdict.issues),
});

const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(savedProject);
const assetBoardIssues = validateVideoStoryboardAssetBoardPlan(assetBoardPlan, savedProject);
assert.equal(blocking(assetBoardIssues), 0, JSON.stringify(assetBoardIssues, null, 2));
addStageReport(run, {
  stageType: "asset_detail",
  status: warnings(assetBoardIssues) > 0 ? "warning" : "passed",
  summary: `资产档案已补全并生成 asset_board_plan：角色板 ${assetBoardPlan.characterBoards.length}，场景板 ${assetBoardPlan.sceneBoards.length}，道具板 ${assetBoardPlan.propBoards.length}，变体板 ${assetBoardPlan.variantBoards.length}。`,
  artifactCount: 1,
  blockingIssues: blocking(assetBoardIssues),
  warningIssues: warnings(assetBoardIssues),
});

addStageReport(run, {
  stageType: "structure",
  status: "passed",
  summary: "10集结构已建立，第1集负责立遗嘱、进当铺、旧案证据、继承逼宫和血契钩子。",
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

addStageReport(run, {
  stageType: "scene",
  status: "passed",
  summary: "第1集拆成5场，每场目标约1分钟，合计5分钟。",
  artifactCount: 5,
  blockingIssues: 0,
  warningIssues: 0,
});

const scriptVerdict = runOperatorQA({ check: "script", project: savedProject, episodes: [episode1] });
assert.equal(scriptVerdict.blocking, false, JSON.stringify(scriptVerdict.issues, null, 2));
const scriptBeatDrafts = buildProductionPerformanceBeatDrafts(savedProject, [episode1]);
assert.equal(blocking(scriptBeatDrafts.issues), 0, JSON.stringify(scriptBeatDrafts.issues, null, 2));
addStageReport(run, {
  stageType: "script",
  status: scriptVerdict.status === "failed" ? "failed" : "passed",
  summary: `第1集剧本块、breakdown 和 performance beats 已通过 QA；script beats=${scriptBeatDrafts.performanceBeats.length}。`,
  artifactCount: 1,
  blockingIssues: blocking(scriptVerdict.issues) + blocking(scriptBeatDrafts.issues),
  warningIssues: warnings(scriptVerdict.issues) + warnings(scriptBeatDrafts.issues),
});

addStageReport(run, {
  stageType: "script_lock",
  status: "warning",
  summary: "本脚本以固定 episode/scene ID 模拟第1集锁定范围，未执行正式 script_lock stage runner。",
  artifactCount: 0,
  blockingIssues: 0,
  warningIssues: 1,
});

addStageReport(run, {
  stageType: "production_breakdown",
  status: "warning",
  summary: "本脚本验证了场次 breakdown、performance beats 与视觉包输入，但未生成正式 production_breakdown_report、continuity_matrix 和部门筹备包。",
  artifactCount: 0,
  blockingIssues: 0,
  warningIssues: 1,
});

addStageReport(run, {
  stageType: "production_asset_detail",
  status: "warning",
  summary: "本脚本使用开发期 asset_board_plan 验证视觉资产链，未将其冒充 formal_asset_package 或正式资产身份板。",
  artifactCount: 0,
  blockingIssues: 0,
  warningIssues: 1,
});

const sceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(savedProject, [episode1], assetBoardPlan);
assert.equal(blocking(sceneVisualPackDrafts.issues), 0, JSON.stringify(sceneVisualPackDrafts.issues, null, 2));
assert.ok(sceneVisualPackDrafts.reusedPackIds.length >= 1, "Scene 2 and scene 4 should reuse one rain pawnshop visual pack.");
addStageReport(run, {
  stageType: "asset_sync",
  status: warnings(sceneVisualPackDrafts.issues) > 0 ? "warning" : "passed",
  summary: `场景视觉包已生成：${sceneVisualPackDrafts.sceneVisualPacks.length} 个，复用 pack ${sceneVisualPackDrafts.reusedPackIds.length} 个。`,
  artifactCount: sceneVisualPackDrafts.sceneVisualPacks.length,
  blockingIssues: blocking(sceneVisualPackDrafts.issues),
  warningIssues: warnings(sceneVisualPackDrafts.issues),
});

const storyboardVerdict = runOperatorQA({ check: "storyboard", project: savedProject, episodes: [episode1] });
assert.equal(storyboardVerdict.blocking, false, JSON.stringify(storyboardVerdict.issues, null, 2));
const storyboardBoardDrafts = buildProductionStoryboardBoardDrafts(savedProject, [episode1]);
assert.equal(blocking(storyboardBoardDrafts.issues), 0, JSON.stringify(storyboardBoardDrafts.issues, null, 2));
addStageReport(run, {
  stageType: "storyboard",
  status: "passed",
  summary: `第1集 shots=${episode1DurationSeconds / 10}，storyboard_board=${storyboardBoardDrafts.storyboardBoards.length}，总时长=${episode1DurationSeconds}s。`,
  artifactCount: storyboardBoardDrafts.storyboardBoards.length,
  blockingIssues: blocking(storyboardVerdict.issues) + blocking(storyboardBoardDrafts.issues),
  warningIssues: warnings(storyboardVerdict.issues) + warnings(storyboardBoardDrafts.issues),
});

const promptVerdict = runOperatorQA({ check: "visual-prompts", project: savedProject, episodes: [episode1] });
assert.equal(promptVerdict.blocking, false, JSON.stringify(promptVerdict.issues, null, 2));
const assetReferencePackDrafts = buildProductionAssetReferencePackDrafts(savedProject, [episode1], sceneVisualPackDrafts.sceneVisualPacks);
assert.equal(blocking(assetReferencePackDrafts.issues), 0, JSON.stringify(assetReferencePackDrafts.issues, null, 2));
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.sceneVisualPackId));
assert.ok(assetReferencePackDrafts.assetReferencePacks.every((pack) => pack.modelInputFingerprint));
addStageReport(run, {
  stageType: "prompt",
  status: warnings(assetReferencePackDrafts.issues) > 0 ? "warning" : "passed",
  summary: `中文 imagePrompt/videoPrompt 已验收，asset_reference_pack=${assetReferencePackDrafts.assetReferencePacks.length}，均绑定 sceneVisualPackId。`,
  artifactCount: assetReferencePackDrafts.assetReferencePacks.length,
  blockingIssues: blocking(promptVerdict.issues) + blocking(assetReferencePackDrafts.issues),
  warningIssues: warnings(promptVerdict.issues) + warnings(assetReferencePackDrafts.issues),
});

const videoUnitDrafts = buildProductionVideoGenerationUnitDrafts(savedProject, [episode1]);
assert.equal(blocking(videoUnitDrafts.issues), 0, JSON.stringify(videoUnitDrafts.issues, null, 2));
addStageReport(run, {
  stageType: "expensive_generation_planning",
  status: "passed",
  summary: `视频生成单元已规划：${videoUnitDrafts.videoGenerationUnits.length} 个。`,
  artifactCount: videoUnitDrafts.videoGenerationUnits.length,
  blockingIssues: blocking(videoUnitDrafts.issues),
  warningIssues: warnings(videoUnitDrafts.issues),
});

appendAutoQA(saveArtifact(run, "performance_beats", `episodes.${episode1Id}.performanceBeats`, [episode1Id], { performanceBeats: videoUnitDrafts.performanceBeats }));
for (const pack of sceneVisualPackDrafts.sceneVisualPacks) {
  appendAutoQA(saveArtifact(run, "scene_visual_pack", `episodes.${episode1Id}.sceneVisualPacks.${pack.id}`, [episode1Id, ...pack.linkedSceneIds, pack.id], { sceneVisualPack: pack }));
}
for (const board of storyboardBoardDrafts.storyboardBoards) {
  appendAutoQA(saveArtifact(run, "storyboard_board", `episodes.${board.episodeId}.scenes.${board.sceneId}.storyboardBoards.${board.id}`, [board.episodeId, board.sceneId, board.id], { storyboardBoard: board }));
}
for (const pack of assetReferencePackDrafts.assetReferencePacks) {
  appendAutoQA(saveArtifact(run, "asset_reference_pack", `episodes.${pack.episodeId}.scenes.${pack.sceneId}.assetReferencePacks.${pack.id}`, [pack.episodeId, pack.sceneId, pack.id], { assetReferencePack: pack }));
}
for (const unit of videoUnitDrafts.videoGenerationUnits) {
  appendAutoQA(saveArtifact(run, "video_generation_unit", `episodes.${unit.episodeId}.scenes.${unit.sceneId}.videoGenerationUnits.${unit.id}`, [unit.episodeId, unit.sceneId, unit.id], { videoGenerationUnit: unit }));
}
appendAutoQA(saveArtifact(run, "custom", "videoStoryboardPlan", [projectId, episode1Id], {
  performanceBeats: videoUnitDrafts.performanceBeats,
  storyboardBoards: storyboardBoardDrafts.storyboardBoards,
  sceneVisualPacks: sceneVisualPackDrafts.sceneVisualPacks,
  assetReferencePacks: assetReferencePackDrafts.assetReferencePacks,
  videoGenerationUnits: videoUnitDrafts.videoGenerationUnits,
}));

const stageCoordinationGate = buildProductionCoordinationStageGate({
  project: savedProject,
  episodes: [episode1],
  operatorArtifacts: savedArtifacts,
  stageType: "expensive_generation_planning",
  runId: run.id,
  environment: "test",
});
assert.equal(stageCoordinationGate.canProceed, true, JSON.stringify(stageCoordinationGate, null, 2));
assert.equal(stageCoordinationGate.repairTickets.length, 0);
appendAutoQA(saveArtifact(run, "production_coordination_report", `operator.productionCoordinationReports.${episode1Id}.stageExit`, [projectId, episode1Id], {
  productionCoordinationReport: stageCoordinationGate.report,
}));

const episodeWrapQA = buildProductionCoordinationWrapQA({
  project: savedProject,
  episodes: [episode1],
  operatorArtifacts: savedArtifacts,
  runId: run.id,
  environment: "test",
});
assert.equal(episodeWrapQA.canProceed, true, JSON.stringify(episodeWrapQA, null, 2));
assert.equal(episodeWrapQA.report.scope, "episode_wrap");
appendAutoQA(saveArtifact(run, "production_coordination_report", `operator.productionCoordinationReports.${episode1Id}.episodeWrap`, [projectId, episode1Id], {
  productionCoordinationReport: episodeWrapQA.report,
}));

dbHelpers.appendOperatorRunEvent(run.id, {
  type: "completed",
  message: "第1集按系统线性制片顺序测试完成，未生成图片或视频。",
  entityIds: [projectId, episode1Id],
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
assert.deepEqual(stageReports.map((report) => report.stageType), stageOrder);
const result = {
  status: "passed",
  projectId,
  runId: run.id,
  episodeCount: savedProject.episodes.length,
  episode1DurationSeconds,
  sceneCount: episode1Scenes.length,
  shotCount: (episode1.scenes || []).flatMap((scene) => scene.shots || []).length,
  stageReports,
  scriptPerformanceBeatCount: scriptBeatDrafts.performanceBeats.length,
  sceneVisualPackCount: sceneVisualPackDrafts.sceneVisualPacks.length,
  reusedPackIds: sceneVisualPackDrafts.reusedPackIds,
  assetReferencePackCount: assetReferencePackDrafts.assetReferencePacks.length,
  storyboardBoardCount: storyboardBoardDrafts.storyboardBoards.length,
  videoGenerationUnitCount: videoUnitDrafts.videoGenerationUnits.length,
  artifactCount: persistedArtifacts.length,
  productionUrl: `http://localhost:3001/production/preparation?projectId=${projectId}`,
  note: "观察点：当前 storyboard_board planner 会从 shots 再派生 unit-level performanceBeats；script 阶段 performanceBeats 已单独 QA，后续可评估是否让 storyboard 直接复用 script beats。",
};

console.log(JSON.stringify(result, null, 2));
