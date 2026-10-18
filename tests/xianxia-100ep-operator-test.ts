import assert from "node:assert/strict";
import { dbHelpers } from "../src/server/db";
import { createOperatorArtifact } from "../src/services/operator/artifacts";
import { buildOperatorCapabilityManifest } from "../src/services/operator/capabilities";
import { runOperatorArtifactQA, runOperatorQA } from "../src/services/operator/qa";
import { createOperatorRunRecord } from "../src/services/operator/runs";
import { OPERATOR_HANDBOOK_VERSION, type OperatorArtifactEnvelope, type OperatorRun } from "../src/services/operator/types";
import { productionAgentModuleManifests, validateProductionAgentManifestRegistry } from "../src/services/production/agents";
import { buildLongFormMemoryContext } from "../src/services/production/longFormMemory";
import { buildFormalAssetPackage, buildSceneAssetVariantPacks } from "../src/services/production/productionAssetPackage";
import { buildRoleSlots } from "../src/services/production/productionCasting";
import { buildProductionCockpit } from "../src/services/production/productionCockpit";
import { buildContinuityMatrix } from "../src/services/production/productionContinuity";
import { buildProductionCoordinationStageGate, buildProductionCoordinationWrapQA } from "../src/services/production/productionCoordination";
import { buildCastingRequirements, buildDepartmentPrepPackages, buildProductionBreakdownReport } from "../src/services/production/productionPrep";
import { buildAutostudioCastingDecisions, createScriptLockBundle } from "../src/services/production/productionPrepRuntime";
import { buildVideoStoryboardAssetBoardPlan, validateVideoStoryboardAssetBoardPlan } from "../src/services/production/videoStoryboardAssetBoards";
import { buildProductionVideoGenerationUnitDrafts } from "../src/services/production/videoStoryboardVideoUnits";
import { linearStageDefinitions } from "../src/services/production/stages";
import type { Asset, Character, Episode, Project, Scene, Shot } from "../src/types/project";

type StageReport = {
  stageType: string;
  status: "passed" | "warning" | "failed";
  summary: string;
  artifactCount: number;
  blockingIssues: number;
  warningIssues: number;
};

type EpisodeOutline = {
  episodeNumber: number;
  id: string;
  title: string;
  phaseId: string;
  summary: string;
  hook: string;
  cliffhanger: string;
  cultivationStage: string;
  relationshipStage: string;
  sectState: string;
  keyPropState: string;
};

const now = Date.now();
const projectId = `xianxia100-${now}`;
const detailedEpisodeCount = 20;
const targetEpisodeCount = 100;
const savedArtifacts: OperatorArtifactEnvelope[] = [];
const stageReports: StageReport[] = [];

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

const capabilityManifest = buildOperatorCapabilityManifest();
assert.equal(capabilityManifest.handbookVersion, OPERATOR_HANDBOOK_VERSION);
assert.deepEqual(validateProductionAgentManifestRegistry(), []);
for (const stageType of stageOrder) {
  assert.ok(
    productionAgentModuleManifests.some((manifest) => manifest.stageTypes.includes(stageType)),
    `${stageType} must have an agent manifest`,
  );
}
assert.ok(capabilityManifest.productionAgentManifestSystem);
assert.ok(capabilityManifest.productionCoordinationSystem);
assert.ok(capabilityManifest.departmentAgentSystem);
assert.ok(capabilityManifest.productionLockSystem);
assert.ok(capabilityManifest.productionPrepSystem);
assert.ok(capabilityManifest.formalAssetPackageSystem);
assert.ok(capabilityManifest.productionCockpitSystem);

const blocking = (issues: Array<{ severity?: string; blocking?: boolean }>) =>
  issues.filter((issue) => issue.severity === "blocking" || issue.blocking).length;

const warnings = (issues: Array<{ severity?: string; blocking?: boolean }>) =>
  issues.filter((issue) => issue.severity === "warning" && !issue.blocking).length;

const pad2 = (value: number) => String(value).padStart(2, "0");
const episodeId = (episodeNumber: number) => `${projectId}-ep-${pad2(episodeNumber)}`;

const phaseDefinitions = [
  {
    id: "phase-1",
    episodes: "1-20",
    title: "凡骨藏仙胎",
    promise: "云知微从废脉杂役被卷入宗门阴谋，和谢无咎结成生死道侣契；第20集青岚宗被毁，二人带残存火种逃入下界乱域。",
    entryState: "主角没有修为、没有靠山，只握着母亲留下的碎玉。",
    exitState: "宗门沦陷，主角觉醒天命骨第一层，和谢无咎确认彼此是唯一可信的人。",
    requiredPayoffs: ["碎玉认主", "道侣契成", "叛徒显形", "宗门毁灭"],
  },
  {
    id: "phase-2",
    episodes: "21-40",
    title: "乱域重铸剑心",
    promise: "二人在追杀中聚拢旧部，进入万骨秘境夺回青岚宗传承；第40集破开下界天门，发现上界仙盟才是真正幕后。",
    entryState: "主角带伤逃亡，谢无咎被魔纹反噬。",
    exitState: "主角筑基圆满，获得九霄剑胚，二人关系从契约互救转为彼此成全。",
    requiredPayoffs: ["旧部重聚", "剑胚认主", "谢无咎魔纹真相", "破界入上界"],
  },
  {
    id: "phase-3",
    episodes: "41-60",
    title: "上界仙盟判罪",
    promise: "仙盟以救世之名操控下界宗门，云知微被判为灾星；第60集她公开反审仙盟，救回谢无咎半魂。",
    entryState: "二人初入上界，身份低微，青岚宗背负魔宗罪名。",
    exitState: "主角金丹成，掌握仙盟罪证，谢无咎半魂回归但记忆残缺。",
    requiredPayoffs: ["仙盟伪善揭露", "道侣误会与重认", "青岚宗昭雪第一步"],
  },
  {
    id: "phase-4",
    episodes: "61-80",
    title: "魔渊借命归来",
    promise: "主角主动入魔渊救人，发现魔君曾是被仙盟牺牲的飞升者；第80集她拒绝单人成仙，选择开众生路。",
    entryState: "主角有罪证但无力量，谢无咎半魂不稳。",
    exitState: "主角元婴后期，谢无咎彻底回魂，二人立下众生同升的飞升誓。",
    requiredPayoffs: ["魔君身世", "主角入魔不失本心", "道侣共同立誓", "天门裂开"],
  },
  {
    id: "phase-5",
    episodes: "81-100",
    title: "百集飞升开天门",
    promise: "主角整合下界、上界和魔渊证据，打穿仙盟飞升垄断；第100集与谢无咎共同飞升，但把天门留给后来者。",
    entryState: "天门已裂，仙盟准备献祭三界修士补天。",
    exitState: "第100集飞升完成，青岚宗重立，众生可凭本心问道。",
    requiredPayoffs: ["仙盟终审", "宗门重立", "道侣不牺牲彼此", "飞升但不抛弃众生"],
  },
];

const phaseBeatTitles = [
  ["血雨拜宗", "废脉验灵", "碎玉发烫", "试剑崖坠落", "掌门密令", "道侣契初动", "魔纹入梦", "祖祠藏灯", "叛徒设局", "护山钟裂", "雪夜问心", "禁地开门", "半卷剑谱", "替罪入牢", "无咎挡刑", "血契反噬", "掌门断臂", "魔渊来信", "宗门大审", "青岚宗灭门夜"],
  ["乱域追杀", "旧部火种", "万骨客栈", "剑胚拍卖", "魔纹失控", "雾市换命", "秘境门开", "骸骨师尊", "青岚旧旗", "无咎身世", "剑心试炼", "情劫幻境", "血灯复燃", "仇人结盟", "乱域称王", "碎玉第二层", "天门钥匙", "万骨塌陷", "下界告别", "破界入上界"],
  ["仙盟审名", "云阶受辱", "上界灵税", "旧案卷宗", "无咎失忆", "青檀被捕", "天牢换魂", "仙盟圣女", "镜湖证词", "金丹雷劫", "道侣陌路", "母亲真名", "众仙围猎", "半魂归灯", "仙盟反诬", "剑斩审台", "三界账册", "无咎认心", "青岚昭雪", "公开反审"],
  ["魔渊入口", "以命换渡", "魔君旧梦", "无相真名", "妖市借兵", "元婴破境", "三界血税", "仙盟补天", "无咎全魂", "道侣同誓", "魔渊婚契", "天火焚城", "众生请愿", "青岚再聚", "魔君让路", "碎玉成门", "仙盟夺门", "拒绝独升", "天门裂开", "众生飞升誓"],
  ["飞升名单", "仙盟献祭", "旧敌归队", "宗门重立", "天梯初战", "三界联军", "无咎断劫", "知微问天", "掌门归魂", "万剑朝宗", "魔君证道", "青檀守门", "温烬赎罪", "天命骨碎", "道侣重逢", "仙盟终审", "天门大开", "众生问道", "飞升前夜", "百集飞升"],
];

const cultivationStageFor = (episodeNumber: number) => {
  if (episodeNumber <= 3) return "凡骨未入门";
  if (episodeNumber <= 10) return `炼气${Math.max(1, Math.ceil((episodeNumber - 3) / 2))}层`;
  if (episodeNumber <= 20) return "炼气圆满，天命骨第一层";
  if (episodeNumber <= 40) return episodeNumber < 34 ? "筑基期" : "筑基圆满，九霄剑胚认主";
  if (episodeNumber <= 60) return episodeNumber < 52 ? "金丹期" : "金丹圆满";
  if (episodeNumber <= 80) return episodeNumber < 72 ? "元婴期" : "元婴后期";
  return episodeNumber < 100 ? "化神问道" : "飞升开天门";
};

const relationshipStageFor = (episodeNumber: number) => {
  if (episodeNumber <= 3) return "互相试探";
  if (episodeNumber <= 8) return "契约同盟";
  if (episodeNumber <= 20) return "生死道侣但未言明";
  if (episodeNumber <= 40) return "逃亡中彼此成全";
  if (episodeNumber <= 60) return "误会后重认本心";
  if (episodeNumber <= 80) return "共同立下众生飞升誓";
  return "不以牺牲对方换飞升";
};

const sectStateFor = (episodeNumber: number) => {
  if (episodeNumber <= 10) return "青岚宗表面安稳，内里叛徒已动";
  if (episodeNumber <= 19) return "青岚宗内乱升级，护山阵多处破损";
  if (episodeNumber <= 40) return "青岚宗已毁，残部在乱域重聚";
  if (episodeNumber <= 80) return "青岚宗名义未复，旧部成为三界火种";
  return "青岚宗重立，成为众生问道之门";
};

const propStateFor = (episodeNumber: number) => {
  if (episodeNumber <= 3) return "碎玉未认主，只在危机时发烫";
  if (episodeNumber <= 10) return "碎玉认主，魂灯能映出宗门旧案";
  if (episodeNumber <= 20) return "碎玉开启天命骨第一层，护山钟裂";
  if (episodeNumber <= 40) return "九霄剑胚与碎玉相互牵引";
  if (episodeNumber <= 60) return "三界账册记录仙盟血税";
  if (episodeNumber <= 80) return "碎玉变成天门钥匙";
  return "碎玉碎成众生飞升路标";
};

const buildEpisodeOutlines = (): EpisodeOutline[] =>
  Array.from({ length: targetEpisodeCount }, (_, index) => {
    const episodeNumber = index + 1;
    const phaseIndex = Math.floor(index / 20);
    const phase = phaseDefinitions[phaseIndex];
    const beatTitle = phaseBeatTitles[phaseIndex][index % 20];
    const id = episodeId(episodeNumber);
    return {
      episodeNumber,
      id,
      title: `第${episodeNumber}集：${beatTitle}`,
      phaseId: phase.id,
      summary: `${phase.title}阶段第${(index % 20) + 1}个推进点：${beatTitle}。本集围绕云知微、谢无咎与青岚宗旧案推进，必须有反转、情绪压迫和追更钩子，服务阶段承诺：${phase.promise}`,
      hook: `前三秒钩子：${beatTitle}的危机结果先出现，让观众先看到羞辱、追杀、证据或天象异变。`,
      cliffhanger: `集尾追更钩子：${beatTitle}并非结束，而是引出下一集更大的代价或身份反转。`,
      cultivationStage: cultivationStageFor(episodeNumber),
      relationshipStage: relationshipStageFor(episodeNumber),
      sectState: sectStateFor(episodeNumber),
      keyPropState: propStateFor(episodeNumber),
    };
  });

const characters: Character[] = [
  {
    id: "char-yun-zhiwei",
    name: "云知微",
    psychologicalProfile: "外柔内硬，面对羞辱会先忍后反击，越被逼越冷静。",
    actingStyle: "细微眼神压抑、手指攥紧后突然爆发，适合短剧近景表演。",
    globalAssetId: "asset-board.char-yun-zhiwei.base",
    multiViewPrompt: "中文角色板：云知微，十八岁凡骨女弟子，清冷坚韧，青白弟子服，腰间碎玉，正侧背三视图，表情含忍、决绝、落泪、爆发。",
    variants: [
      { id: "variant-disciple-blood", name: "血雨战损", description: "青白弟子服袖口有血，发丝被雨打湿。", promptModifiers: "战损但身份不变，袖口血迹、湿发、眼神更冷。" },
      { id: "variant-awakened-bone", name: "天命骨觉醒", description: "锁骨下浮现金色骨纹，碎玉发光。", promptModifiers: "金色骨纹微光，碎玉悬浮，表情痛苦但不失控。" },
    ],
  },
  {
    id: "char-xie-wujiu",
    name: "谢无咎",
    psychologicalProfile: "冷面少宗主，话少，行动比承诺快，危险时眼神先软后狠。",
    actingStyle: "克制、停顿、突然护身挡刀，适合对视和手部特写。",
    globalAssetId: "asset-board.char-xie-wujiu.base",
    multiViewPrompt: "中文角色板：谢无咎，二十岁少宗主，黑金剑修长袍，背九霄残剑，眉眼冷，魔纹藏在右腕，正侧背三视图。",
    variants: [
      { id: "variant-demon-mark", name: "魔纹反噬", description: "右腕黑金魔纹蔓延到颈侧，气息不稳。", promptModifiers: "魔纹可见但仍克制，右手握剑发抖。" },
      { id: "variant-wounded-guardian", name: "护身重伤", description: "胸口剑伤，黑袍破裂但仍挡在云知微前。", promptModifiers: "胸口血迹、站姿护人、眼神压痛。" },
    ],
  },
  {
    id: "char-wen-jin",
    name: "温烬",
    psychologicalProfile: "表面温和，公开场合懂得煽动人群，私下极怕失去位置。",
    actingStyle: "微笑挑衅、目光闪躲、突然撕破伪装。",
    globalAssetId: "asset-board.char-wen-jin.base",
    multiViewPrompt: "中文角色板：温烬，青岚宗旁支天才，银青长袍，温和笑面下有嫉恨，正侧背三视图。",
  },
  {
    id: "char-luo-qingtan",
    name: "洛青檀",
    psychologicalProfile: "灵阵师少女，聪明嘴快，负责提供证据和技术支援。",
    actingStyle: "快速观察、边跑边解释、害怕时仍护住阵盘。",
    globalAssetId: "asset-board.char-luo-qingtan.base",
    multiViewPrompt: "中文角色板：洛青檀，年轻灵阵师，墨绿短袍，背阵盘和卷轴，机敏明亮，正侧背三视图。",
  },
  {
    id: "char-master-shen",
    name: "沈鹤年",
    psychologicalProfile: "青岚宗掌门，疲惫但正直，是旧案见证人。",
    actingStyle: "咳血、停顿、递出证据时手很稳。",
    globalAssetId: "asset-board.char-master-shen.base",
    multiViewPrompt: "中文角色板：沈鹤年，白发掌门，青灰道袍，病弱但眼神清明，正侧背三视图。",
  },
  {
    id: "char-wuxiang",
    name: "无相魔君",
    psychologicalProfile: "远期大反派兼镜像导师，声音温柔但压迫感极强。",
    actingStyle: "少动作，多用阴影、镜中倒影和声音出现。",
    globalAssetId: "asset-board.char-wuxiang.base",
    multiViewPrompt: "中文角色板：无相魔君，黑白无相面具，长发如烟，魔渊王座阴影，正侧背三视图。",
  },
];

const assets: Asset[] = [
  {
    id: "loc-qinglan-gate",
    type: "location",
    name: "青岚宗山门",
    description: "云海石阶、青铜宗门牌匾、护山阵纹，是羞辱、拜宗和宗门毁灭的主视觉地点。",
    globalAssetId: "asset-board.loc-qinglan-gate.base",
    prompt: "中文场景板：青岚宗山门，云海石阶，青铜牌匾，护山阵纹，仙侠宗门大门，竖屏可拍机位。",
    panoramaPrompt: "中文全景场景板：青岚宗山门，山雾、石阶、阵纹、牌匾、远处剑峰，日夜两版光线。",
    variants: [
      { id: "variant-blood-rain", name: "血雨压境", description: "山门被血雨浸湿，阵纹忽明忽暗。", promptModifiers: "血雨、青铜牌匾湿亮、阵纹闪烁。" },
      { id: "variant-destroyed", name: "宗门毁灭态", description: "牌匾断裂，石阶塌陷，护山阵熄灭。", promptModifiers: "断裂牌匾、塌陷石阶、灰烬和残阵。" },
    ],
  },
  {
    id: "loc-spirit-root-hall",
    type: "location",
    name: "灵根殿",
    description: "测灵柱、审判台、长老席，是废脉羞辱和证据反转的主要室内空间。",
    globalAssetId: "asset-board.loc-spirit-root-hall.base",
    prompt: "中文场景板：灵根殿，测灵柱，审判台，长老席，冷白灵光，竖屏近景和中景可读。",
    panoramaPrompt: "中文全景场景板：灵根殿内部，测灵柱居中，长老席半环形，地面阵纹。",
  },
  {
    id: "loc-sword-trial-cliff",
    type: "location",
    name: "试剑崖",
    description: "悬崖、剑碑、锁链桥，是拔剑、坠崖、道侣护身和剑心试炼的动作场。",
    globalAssetId: "asset-board.loc-sword-trial-cliff.base",
    prompt: "中文场景板：试剑崖，悬崖剑碑，锁链桥，风雪，适合动作分镜和近身打斗。",
    panoramaPrompt: "中文全景场景板：试剑崖高处，剑碑林立，锁链桥通向云雾。",
  },
  {
    id: "loc-ancestral-shrine",
    type: "location",
    name: "青岚祖祠",
    description: "魂灯墙、祖师牌位、地下暗门，是旧案和母亲真相的线索空间。",
    globalAssetId: "asset-board.loc-ancestral-shrine.base",
    prompt: "中文场景板：青岚祖祠，魂灯墙，祖师牌位，暗门，烛光和冷蓝月光对比。",
    panoramaPrompt: "中文全景场景板：祖祠室内，魂灯一排排，中央供桌，地砖暗纹。",
  },
  {
    id: "loc-sect-bell-tower",
    type: "location",
    name: "镇魔钟楼",
    description: "巨钟、悬索、裂纹铜壁，是护山钟裂和魔渊异动的高危地点。",
    globalAssetId: "asset-board.loc-sect-bell-tower.base",
    prompt: "中文场景板：镇魔钟楼，巨大铜钟，悬索，裂纹，红黑魔气从钟缝渗出。",
    panoramaPrompt: "中文全景场景板：钟楼高处，巨钟占画面主体，远处青岚宗山门。",
    variants: [
      { id: "variant-bell-cracked", name: "巨钟裂开", description: "铜钟出现贯穿裂纹，魔气外泄。", promptModifiers: "巨钟裂纹、红黑魔气、碎铜片悬浮。" },
    ],
  },
  {
    id: "loc-demon-rift",
    type: "location",
    name: "后山魔隙",
    description: "黑色裂隙、枯树、残阵，是无相魔君声音第一次进入现实的地点。",
    globalAssetId: "asset-board.loc-demon-rift.base",
    prompt: "中文场景板：后山魔隙，黑色空间裂缝，枯树，残阵，红黑雾气，竖屏惊悚仙侠。",
    panoramaPrompt: "中文全景场景板：后山荒林，中央黑色裂隙，地面残阵发光。",
  },
  {
    id: "prop-broken-jade",
    type: "prop",
    name: "裂纹碎玉",
    description: "云知微母亲遗物，能映出旧案魂影，后期成为天门钥匙。",
    globalAssetId: "asset-board.prop-broken-jade.base",
    prompt: "中文道具板：裂纹碎玉，半透明青白玉，内部金色骨纹，挂在细绳上，手持比例清楚。",
    multiViewPrompt: "中文道具多视图：裂纹碎玉正面、侧面、背面、发光态、贴近手心态。",
    variants: [
      { id: "variant-jade-awakened", name: "觉醒发光", description: "碎玉裂缝透出金色光，悬浮在掌心。", promptModifiers: "金光从裂缝溢出，玉片悬浮。" },
    ],
  },
  {
    id: "prop-ninefold-sword",
    type: "prop",
    name: "九霄残剑",
    description: "谢无咎佩剑，剑身断一截，后期重铸成飞升剑胚。",
    globalAssetId: "asset-board.prop-ninefold-sword.base",
    prompt: "中文道具板：九霄残剑，黑金剑柄，断裂剑身，剑脊有古篆纹，持握方式清楚。",
    multiViewPrompt: "中文道具多视图：九霄残剑正侧背、拔剑态、断刃特写、剑纹特写。",
  },
  {
    id: "prop-soul-lamp",
    type: "prop",
    name: "青岚魂灯",
    description: "祖祠魂灯，能保存死者最后一息证词。",
    globalAssetId: "asset-board.prop-soul-lamp.base",
    prompt: "中文道具板：青岚魂灯，青铜小灯，蓝色魂火，灯壁有青岚纹章。",
    multiViewPrompt: "中文道具多视图：魂灯正侧背、点燃态、熄灭态、魂影浮现态。",
  },
  {
    id: "prop-sect-bell",
    type: "prop",
    name: "镇魔铜钟",
    description: "青岚宗护山核心，裂开时代表魔渊逼近。",
    globalAssetId: "asset-board.prop-sect-bell.base",
    prompt: "中文道具板：镇魔铜钟，巨型青铜钟，阵纹和裂痕，悬索连接钟楼。",
    multiViewPrompt: "中文道具多视图：铜钟整体、裂纹特写、阵纹特写、魔气外泄态。",
  },
  {
    id: "prop-blood-oath-scroll",
    type: "prop",
    name: "血誓卷轴",
    description: "道侣契约的纸质载体，签下后两人伤痛互感。",
    globalAssetId: "asset-board.prop-blood-oath-scroll.base",
    prompt: "中文道具板：血誓卷轴，白纸红纹，滴血后文字浮现，卷轴边缘烧焦。",
    multiViewPrompt: "中文道具多视图：血誓卷轴展开、卷起、滴血、文字浮现。",
  },
];

const displayName = (id: string) => {
  const character = characters.find((item) => item.id === id);
  if (character) return character.name;
  const asset = assets.find((item) => item.id === id);
  return asset?.name || id;
};

const physicalSpec = (shot: Pick<Shot, "shotSize" | "cameraAngle" | "cameraMovement" | "focalLength" | "lighting" | "composition" | "blocking">) =>
  `${shot.shotSize}，${shot.cameraAngle}，${shot.cameraMovement}，${shot.focalLength}，${shot.lighting}，${shot.composition}，${shot.blocking}`;

type EpisodeDetailBeat = {
  suffix: string;
  core: string;
  protagonistLine: string;
  partnerLine: string;
};

const firstTenDetailBeats: Record<number, EpisodeDetailBeat[]> = {
  1: [
    { suffix: "血雨山门", core: "云知微带着母亲碎玉在血雨里拜宗，山门石阶渗出旧案血字，温烬逼她跪下认灾星之名。", protagonistLine: "这不是天罚，是有人把旧案埋在山门下。", partnerLine: "她今日若跪，青岚宗的骨头也一起断。" },
    { suffix: "碎玉认路", core: "碎玉从她腰间飞出，沿着石阶划出一条通往灵根殿的金线，围观弟子从嘲笑变成惊惧。", protagonistLine: "它在找的不是我，是被你们藏起来的人。", partnerLine: "跟着碎玉走，我替你拦住身后的人。" },
    { suffix: "温烬递刀", core: "温烬把伪造供状塞进她掌心，想让所有人看见她承认母亲叛宗，谢无咎当众折断供状封绳。", protagonistLine: "我的字，不长这样。", partnerLine: "伪证用的是长老院封泥，我记住了。" },
    { suffix: "魂灯倒燃", core: "祖祠最底层一盏无名魂灯倒着燃烧，火光映出云知微母亲曾跪在同一处山门前。", protagonistLine: "娘，你当年也来过这里。", partnerLine: "灯倒着烧，说明有人把生死账改过。" },
    { suffix: "血雨止息", core: "镇魔钟第一次无风自鸣，血雨突然停在半空，无相魔君的笑声从钟缝里叫出云知微的名字。", protagonistLine: "他认识我，可我从未见过他。", partnerLine: "先别回头，钟里的东西在看你的眼睛。" },
  ],
  2: [
    { suffix: "废脉验灵", core: "测灵柱在云知微掌下不亮，长老宣布她废脉逐宗，柱底却浮出被磨掉的第七道灵纹。", protagonistLine: "废脉不会让测灵柱害怕。", partnerLine: "第七道灵纹不是测试，是封印。" },
    { suffix: "少宗主保人", core: "谢无咎以少宗主令牌压下逐宗令，右腕魔纹被令牌烫出黑金裂痕，云知微第一次看见他的代价。", protagonistLine: "你保我，是为了碎玉，还是为了真相？", partnerLine: "先活下来，再问我为什么。" },
    { suffix: "青檀偷阵", core: "洛青檀偷偷改写验灵阵，把测灵柱底部残留的旧年血样投到墙上，众人看到云母姓名一闪而过。", protagonistLine: "青檀，别把自己也赔进去。", partnerLine: "她已经站出来了，现在轮到我们。" },
    { suffix: "长老席翻脸", core: "三名长老同时改口说从未见过旧案卷宗，温烬趁乱要求立刻搜云知微的身。", protagonistLine: "他们怕的不是我，是卷宗还活着。", partnerLine: "搜身可以，先搜温烬袖里的封泥。" },
    { suffix: "柱裂见名", core: "测灵柱从中裂开，裂缝里露出云知微母亲的真名，下一瞬全殿灵灯集体熄灭。", protagonistLine: "原来我的姓，是被你们抹掉的。", partnerLine: "灯灭之前，我看见了掌门的手印。" },
  ],
  3: [
    { suffix: "碎玉发烫", core: "碎玉烫穿云知微掌心，血滴落地后拼成一枚旧宗印，温烬的剑尖因此偏开半寸。", protagonistLine: "它不是护身符，是钥匙。", partnerLine: "钥匙一醒，锁门的人也会醒。" },
    { suffix: "旧印开缝", core: "灵根殿地砖被旧宗印撬开一道暗缝，里面传出被封存多年的审讯铃声。", protagonistLine: "铃声下面有人在喊冤。", partnerLine: "别碰第二次，阵法在吃你的血。" },
    { suffix: "剑鸣认主", core: "九霄残剑隔着剑匣低鸣，所有剑修以为是谢无咎召剑，却发现剑鸣朝向云知微。", protagonistLine: "我没有修为，为什么它在回应我？", partnerLine: "因为它认的不是修为，是债。" },
    { suffix: "温烬换证", core: "温烬趁众人看剑鸣时换走旧证，洛青檀只截下一角血誓纸，纸角写着青岚二字。", protagonistLine: "他越急，越说明证据是真的。", partnerLine: "纸角够了，血誓卷轴会补全缺口。" },
    { suffix: "掌门咳血", core: "沈鹤年听见剑鸣后咳出黑血，悄悄把半枚魂灯钥匙交给洛青檀，示意她带云知微逃。", protagonistLine: "掌门知道全部真相。", partnerLine: "他在用命告诉我们，今晚别留在殿里。" },
  ],
  4: [
    { suffix: "锁桥坠落", core: "试剑崖锁桥突然断裂，云知微坠向云海，碎玉牵出一条金线把她吊在半空。", protagonistLine: "别拉我，先看桥是谁斩断的。", partnerLine: "我拉你，也看见了那道剑气。" },
    { suffix: "崖壁旧声", core: "崖壁剑痕里传出云母当年的声音，她提醒云知微不要相信第一个伸手救她的人。", protagonistLine: "娘说的第一个人，会是谁？", partnerLine: "今天伸手的人很多，你只管记住谁在躲。" },
    { suffix: "残剑护命", core: "谢无咎拔出九霄残剑斩断追来的试炼藤，右腕魔纹反咬，他仍把云知微推回崖面。", protagonistLine: "你每救我一次，魔纹就深一寸。", partnerLine: "那就让我多欠你一寸真相。" },
    { suffix: "温烬失手", core: "温烬假装救人却踩碎崖边阵眼，洛青檀录下他的脚印和阵纹错位。", protagonistLine: "他不是失手，他知道阵眼在哪里。", partnerLine: "把脚印留住，下一次审他。" },
    { suffix: "崖下有门", core: "云海翻开露出崖下石门，门上写着云知微母亲的禁名，门缝里传来镇魔钟声。", protagonistLine: "试剑崖下面，才是真正的审判台。", partnerLine: "门在叫你，也在叫我。" },
  ],
  5: [
    { suffix: "掌门密令", core: "沈鹤年把密令藏在药碗底部交给云知微，命她子时前离开青岚宗。", protagonistLine: "若我走了，旧案就又只剩死人说话。", partnerLine: "活人离开，是为了回来让死人开口。" },
    { suffix: "药碗藏砂", core: "药碗里的灵砂自动排成三个人名，其中一个正是温烬父亲，长老院瞬间封锁寝殿。", protagonistLine: "原来叛徒不是一个人。", partnerLine: "名单出现，封门的人就会更多。" },
    { suffix: "魂灯钥匙", core: "洛青檀把半枚魂灯钥匙交给云知微，钥匙只在她和谢无咎同时触碰时才完整发光。", protagonistLine: "为什么需要我们两个人？", partnerLine: "因为旧案把我们的命线绑在一起。" },
    { suffix: "密道追兵", core: "三人从掌门寝殿密道撤离，追兵的脚步声从墙内逼近，温烬提前知道出口位置。", protagonistLine: "出口泄露了，我们身边还有眼睛。", partnerLine: "别停，眼睛也会被光照出来。" },
    { suffix: "断臂封口", core: "沈鹤年在殿外自断一臂封住追兵阵门，血线却被镇魔钟吸走。", protagonistLine: "掌门是在替谁还债？", partnerLine: "钟吸他的血，说明旧债快醒了。" },
  ],
  6: [
    { suffix: "道侣契初动", core: "魂灯钥匙在云知微和谢无咎掌心合拢，二人同时感到对方旧伤，未成形的道侣契第一次回应。", protagonistLine: "我听见你的心口在裂。", partnerLine: "别听，契还没稳，会把痛放大。" },
    { suffix: "痛觉互感", core: "温烬当众刺伤自己嫁祸云知微，谢无咎却先感到同样痛感，证明血誓被人调包。", protagonistLine: "他的伤，为什么会疼在你身上？", partnerLine: "因为这张誓卷本来写的不是他的名字。" },
    { suffix: "誓卷改名", core: "血誓卷轴自动改写，把谢无咎的名字和云知微并列，长老席宣布二人私通魔契。", protagonistLine: "这不是私通，是证词在找见证人。", partnerLine: "他们怕我们并列，就让他们怕到底。" },
    { suffix: "魔纹外露", core: "谢无咎右腕魔纹压不住，黑金纹路爬上指节，云知微用碎玉暂时替他镇住反噬。", protagonistLine: "你一直把这个藏在袖子里？", partnerLine: "我怕你看见后，连真相也不敢要。" },
    { suffix: "契线断灯", core: "道侣契线刚出现就被镇魔钟震断，魂灯墙熄灭一半，只剩云母那盏灯亮得刺眼。", protagonistLine: "灯灭了，娘的灯却更亮。", partnerLine: "有人不想契成，但她在逼我们继续。" },
  ],
  7: [
    { suffix: "魔纹入梦", core: "云知微梦见谢无咎被锁在黑金水牢，醒来时自己的手腕也浮出同样魔纹。", protagonistLine: "梦里的水是冷的，可你的血在烧。", partnerLine: "那不是梦，是魔纹借你找我。" },
    { suffix: "水牢倒影", core: "灵根殿水镜照不出云知微，只照出少年谢无咎跪在仙盟使者面前。", protagonistLine: "你小时候见过仙盟的人。", partnerLine: "我不记得，但我的魔纹记得。" },
    { suffix: "温烬借梦", core: "温烬把梦境画成罪证，说云知微已被魔渊污染，逼她接受净魂针。", protagonistLine: "他画错了锁链方向。", partnerLine: "错的地方，就是他偷看的地方。" },
    { suffix: "净魂反噬", core: "净魂针刺入云知微眉心却反向点亮碎玉，针身显出仙盟徽记。", protagonistLine: "所谓净魂，原来是仙盟的针。", partnerLine: "别拔，先让所有人看清徽记。" },
    { suffix: "魔君低语", core: "无相魔君第一次在清醒状态下开口，告诉云知微谢无咎缺失的半魂在上界。", protagonistLine: "你想用他的半魂换什么？", partnerLine: "别答应他，我宁可少一半也不要你欠魔渊。" },
  ],
  8: [
    { suffix: "祖祠藏灯", core: "洛青檀带二人进入祖祠夹层，发现一整排被倒挂的魂灯，灯牌都被改成灾星二字。", protagonistLine: "他们不是只抹掉我娘，是抹掉一整排人。", partnerLine: "这不是宗门旧案，是一套吃人的规矩。" },
    { suffix: "灯牌复名", core: "云知微用血点亮第一盏倒挂魂灯，灯牌恢复出真实姓名，也露出死因是飞升试验。", protagonistLine: "飞升试验，为什么会死在青岚宗？", partnerLine: "因为上界把刀藏在下界。" },
    { suffix: "青檀破阵", core: "洛青檀拆开祖祠护阵，发现阵眼需要宗主血和少宗主血同时维持。", protagonistLine: "掌门和无咎，都被困在这座祠堂里。", partnerLine: "我以为自己在守宗，原来是在守牢。" },
    { suffix: "碎玉觉醒", core: "碎玉吸收倒挂魂灯的火光，云知微锁骨下浮现金色骨纹，所有魂灯同时朝她低头。", protagonistLine: "它们不是拜我，是把路交给我。", partnerLine: "那就别一个人扛，我也在路上。" },
    { suffix: "祖祠封死", core: "祖祠石门被外面封死，温烬在门外宣告云知微偷盗宗魂，长老院准备当夜审判。", protagonistLine: "他终于急到亲自封门。", partnerLine: "封门的人，也把自己关进证据里了。" },
  ],
  9: [
    { suffix: "叛徒设局", core: "温烬安排假证人指认云知微盗魂，证人说错了魂灯排列顺序，被洛青檀当场抓住破绽。", protagonistLine: "他说的那盏灯，昨夜已经倒挂了。", partnerLine: "破绽够小，才像真话里漏出来的。" },
    { suffix: "假证换命", core: "假证人突然被血誓卷轴反噬，临死前只说出温家祠堂四个字。", protagonistLine: "他不是替温烬作证，是替温家续命。", partnerLine: "温家祠堂，今晚必须去。" },
    { suffix: "温家暗格", core: "三人潜入温家祠堂，发现暗格里藏着青岚宗灭门预案和镇魔钟裂纹图。", protagonistLine: "他们连宗门怎么毁都画好了。", partnerLine: "预案能画出来，说明毁灭还没开始。" },
    { suffix: "青檀被困", core: "洛青檀为传出裂纹图主动留下拖阵，温烬发现她后把阵盘踩碎。", protagonistLine: "青檀，阵盘碎了你就往左跑！", partnerLine: "她留下的不是阵盘，是我们的证人。" },
    { suffix: "裂纹图送出", core: "云知微用碎玉把裂纹图投到宗门夜空，所有弟子都看见镇魔钟将从内部裂开。", protagonistLine: "看清楚，钟不是被魔渊敲裂的。", partnerLine: "是自己人先在钟里埋了刀。" },
  ],
  10: [
    { suffix: "护山钟裂", core: "镇魔铜钟按裂纹图预言开裂，护山阵开始倒转，青岚宗弟子的灵力被钟声抽走。", protagonistLine: "钟在吸同门的灵力，不是在护山。", partnerLine: "护山阵被改成了献祭阵。" },
    { suffix: "钟心有名", core: "云知微闯入钟心，发现钟壁内侧刻满被献祭者姓名，其中最新一行正在刻谢无咎。", protagonistLine: "它下一笔要刻你的名字。", partnerLine: "那就趁它没刻完，把钟心砸开。" },
    { suffix: "道侣挡劫", core: "谢无咎替云知微挡下钟心雷火，道侣契被迫提前成线，二人的伤口同时出现金光。", protagonistLine: "我不要用你的命证明契成。", partnerLine: "那就用我们两个人的命，证明它错了。" },
    { suffix: "温烬露底", core: "温烬以为钟声盖住一切，亲口承认温家只是在执行仙盟回收青岚宗的命令。", protagonistLine: "仙盟两个字，我终于等到你说出口。", partnerLine: "他说出口，就再也收不回去。" },
    { suffix: "第一层天命骨", core: "云知微用碎玉压住镇魔钟裂口，天命骨第一层觉醒，钟声停止的同时魔渊裂隙睁开。", protagonistLine: "我能堵住钟，却堵不住门后的东西。", partnerLine: "那就别堵，我们去看门后是谁。" },
  ],
};

const makeShot = ({
  sceneId,
  index,
  visualAction,
  characterIds,
  locationId,
  propIds,
  motivation,
  protagonistDialogue,
  partnerDialogue,
}: {
  sceneId: string;
  index: number;
  visualAction: string;
  characterIds: string[];
  locationId: string;
  propIds: string[];
  motivation: string;
  protagonistDialogue?: string;
  partnerDialogue?: string;
}): Shot => {
  const shotSize = ["WS", "MS", "CU", "MCU", "WS", "CU"][(index - 1) % 6];
  const cameraAngle = index % 2 === 0 ? "low angle" : "eye-level";
  const cameraMovement = ["static", "slow push-in", "handheld", "tracking", "tilt", "push-in"][(index - 1) % 6];
  const focalLength = ["24mm", "35mm", "50mm", "50mm", "24mm", "85mm"][(index - 1) % 6];
  const lighting = "冷蓝仙雾主光与金色灵纹边光，脸、手、关键道具必须清楚可读";
  const composition = "竖屏 9:16 mobile portrait，主体靠近画面中央，保留脸部表情和手部动作";
  const blocking = "云知微默认 screen left，谢无咎默认 screen right，温烬/长老在后景压迫，道具从画面中线进入";
  const note = "保持180度轴线、视线匹配、动作顺接、空间方位连续；云知微画面左侧，谢无咎画面右侧，道具交接从左向右。";
  const visibleNames = characterIds.map(displayName).join("、");
  const propNames = propIds.map(displayName).join("、");
  const promptSpec = physicalSpec({ shotSize, cameraAngle, cameraMovement, focalLength, lighting, composition, blocking });
  return {
    id: `${sceneId}-shot-${pad2(index)}`,
    shotSize,
    cameraAngle,
    cameraMovement,
    focalLength,
    lighting,
    composition,
    blocking,
    continuityNote: note,
    visualAction: `可见角色：${visibleNames}。${visualAction}`,
    duration: 10,
    motivation,
    microExpression: index % 2 === 0 ? "云知微压住恐惧，眼神从闪避变成直视。" : "谢无咎先看道具再看云知微，明显在隐忍反噬。",
    characterIdsInShot: characterIds,
    locationId,
    propIds,
    dialogueLines: [
      { characterId: characterIds[0], text: protagonistDialogue || (index % 2 === 0 ? "我不认这个罪。" : "这一次，我自己选。") },
      { characterId: characterIds[1] || characterIds[0], text: partnerDialogue || (index % 2 === 0 ? "站到我身后。" : "代价会回来找你。") },
    ],
    imagePrompt: `中文图片提示词：${promptSpec}，可见角色：${visibleNames}，关键道具：${propNames}，${visualAction}，修仙短剧，近景表情清楚，手部动作清楚，仙侠电影感。`,
    videoPrompt: `中文视频提示词：竖屏 mobile portrait，${promptSpec}，可见角色：${visibleNames}，关键道具：${propNames}，${visualAction}，10秒视频单元，动作连续，视线匹配，表情变化可读，不生成视频只记录提示词。`,
  };
};

const makeScene = ({
  episode,
  sceneIndex,
  title,
  description,
  locationId,
  propIds,
  characterIds,
  valueFrom,
  valueTo,
  hook,
  cliffhanger,
  variantMap,
  detailBeat,
}: {
  episode: EpisodeOutline;
  sceneIndex: number;
  title: string;
  description: string;
  locationId: string;
  propIds: string[];
  characterIds: string[];
  valueFrom: string;
  valueTo: string;
  hook: string;
  cliffhanger: string;
  variantMap?: Record<string, string>;
  detailBeat?: EpisodeDetailBeat;
}): Scene => {
  const id = `${episode.id}-scene-${sceneIndex}`;
  const location = assets.find((asset) => asset.id === locationId);
  const eventCore = detailBeat?.core || description;
  const fallbackProtagonistDialogue = [
    `第${episode.episodeNumber}集这道劫我接下，${episode.cultivationStage}也压不住碎玉的光。`,
    `他们拿${episode.title}审我，我就把青岚旧案摆到众人面前。`,
    `我不是来求他们赦免的，我要让${displayName(propIds[0])}替亡魂开口。`,
    `若这一步会伤到我，就让伤口记住第${episode.episodeNumber}集的真相。`,
    `到第${sceneIndex}场还要我退，那我偏把这条命线往前推。`,
  ][(sceneIndex - 1) % 5];
  const fallbackPartnerDialogue = [
    `我挡第${episode.episodeNumber}集这一次，下一次你要亲手赢回来。`,
    `他们能封住殿门，封不住你和${displayName(propIds[0])}之间的因果。`,
    `别把所有代价独吞，道侣契不是让你一个人赴死。`,
    `我右腕魔纹若再亮，就先替你挡住这场审判。`,
    `记住现在的方向，下一场危机会从${displayName(locationId)}追上来。`,
  ][(sceneIndex - 1) % 5];
  const protagonistDialogue = detailBeat?.protagonistLine || fallbackProtagonistDialogue;
  const partnerDialogue = detailBeat?.partnerLine || fallbackPartnerDialogue;
  const sceneValueFrom = detailBeat ? `开场压力：${detailBeat.core}` : valueFrom;
  const sceneValueTo = detailBeat ? `收场变化：${detailBeat.partnerLine}` : valueTo;
  const shotActions = [
    `${displayName(characterIds[0])}进入${displayName(locationId)}的冲突中心，事件核心是：${eventCore}`,
    `${displayName(characterIds[1])}上前挡住压迫方，衣袖掠过${displayName(propIds[0])}，让关键证据暴露在众人视线里。`,
    `温烬或长老席试图改写现场叙事，${displayName(characterIds[0])}用${displayName(propIds[0])}逼出新的破绽。`,
    `${displayName(characterIds[0])}触发${displayName(propIds[0])}的异象，旧案线索以可见图像或声音回到当前场面。`,
    `${displayName(characterIds[1])}拔出${propIds.includes("prop-ninefold-sword") ? "九霄残剑" : "护身剑气"}稳住空间轴线，保护动作和情绪对视同时成立。`,
    `${displayName(characterIds[0])}带着${displayName(propIds[0])}离开当前压力点，承接下一场危机：${cliffhanger}`,
  ];
  return {
    id,
    sceneNumber: `${episode.episodeNumber}.${sceneIndex}`,
    title,
    description,
    valueCharge: sceneValueTo.includes("暴露") || sceneValueTo.includes("逼近") || sceneValueTo.includes("怕") ? "negative" : "positive",
    valueShift: {
      from: sceneValueFrom,
      to: sceneValueTo,
      reason: "短剧每场必须让信息、关系或代价发生可见变化。",
    },
    hook,
    cliffhanger,
    targetDuration: 1,
    sceneGoal: description,
    sceneAssets: `本场只允许调用：${[locationId, ...propIds, ...characterIds].map(displayName).join("、")}。`,
    environment: locationId === "loc-sword-trial-cliff" || locationId === "loc-demon-rift" || locationId === "loc-qinglan-gate" ? "EXT." : "INT.",
    timeOfDay: sceneIndex >= 4 ? "NIGHT" : "DUSK",
    scriptBlocks: [
      { id: `${id}-sb-1`, type: "scene_heading", content: `${locationId === "loc-spirit-root-hall" || locationId === "loc-ancestral-shrine" ? "INT." : "EXT."} ${displayName(locationId)} - DUSK`, locationId },
      { id: `${id}-sb-2`, type: "action", content: shotActions[0], locationId, propIds },
      { id: `${id}-sb-3`, type: "character", content: displayName(characterIds[0]), linkedAssetId: characterIds[0] },
      { id: `${id}-sb-4`, type: "dialogue", content: protagonistDialogue, linkedAssetId: characterIds[0] },
      { id: `${id}-sb-5`, type: "character", content: displayName(characterIds[1]), linkedAssetId: characterIds[1] },
      { id: `${id}-sb-6`, type: "dialogue", content: partnerDialogue, linkedAssetId: characterIds[1] },
      { id: `${id}-sb-7`, type: "action", content: shotActions.slice(1, 4).join(" "), locationId, propIds },
      { id: `${id}-sb-8`, type: "transition", content: "CUT TO 下一处证据或危机。", locationId },
    ],
    breakdown: {
      setting: locationId === "loc-spirit-root-hall" || locationId === "loc-ancestral-shrine" ? "INT." : "EXT.",
      location: { name: location?.name || locationId, state: variantMap?.[locationId] ? "当前场景变体已启用" : "基础场景状态" },
      time: sceneIndex >= 4 ? "NIGHT" : "DUSK",
      characters: characterIds.map((characterId) => ({ name: displayName(characterId), state: variantMap?.[characterId] ? "当前变体状态" : "基础造型" })),
      props: propIds.map((propId) => ({ name: displayName(propId), state: variantMap?.[propId] ? "激活或损坏态" : "基础道具状态" })),
      characterIds,
      locationId,
      propIds,
      wardrobe: [
        variantMap?.["char-yun-zhiwei"] ? "云知微血雨战损弟子服，袖口血迹延续。" : "云知微青白弟子服，碎玉挂在腰间。",
        variantMap?.["char-xie-wujiu"] ? "谢无咎魔纹反噬或护身重伤状态。" : "谢无咎黑金剑修长袍，右腕魔纹隐藏。",
      ],
      makeupHair: ["仙雾和汗水使发丝贴近脸侧，近景能读出眼神变化。"],
      assetVariantMap: variantMap,
      sfx: ["宗门钟声", "剑鸣", "灵纹燃起"],
      bgm: [{ prompt: "低鼓点和古琴拨弦，情绪从压迫转为爆发。", description: "短剧追更悬念音乐" }],
    },
    interactiveMetadata: {
      incomingContext: sceneValueFrom,
      outgoingContext: sceneValueTo,
    },
    shots: shotActions.map((visualAction, index) => makeShot({
      sceneId: id,
      index: index + 1,
      visualAction,
      characterIds,
      locationId,
      propIds,
      motivation: [
        "前三秒建立冲突结果。",
        "让道侣保护动作可见。",
        "把反派压力具象化。",
        "用道具异象完成信息反转。",
        "用动作承接下一镜。",
        "制造本场追更钩子。",
      ][index],
      protagonistDialogue,
      partnerDialogue,
    })),
  };
};

const detailedEpisode = (outline: EpisodeOutline): Episode => {
  const baseCharacters = ["char-yun-zhiwei", "char-xie-wujiu", "char-wen-jin"];
  const mentorCharacters = outline.episodeNumber >= 5 ? [...baseCharacters, "char-master-shen"] : baseCharacters;
  const finaleCharacters = outline.episodeNumber >= 7 ? [...mentorCharacters, "char-wuxiang"] : mentorCharacters;
  const zhiweiVariant = outline.episodeNumber >= 4 ? "variant-disciple-blood" : undefined;
  const zhiweiAwakened = outline.episodeNumber >= 8 ? "variant-awakened-bone" : zhiweiVariant;
  const wujiuVariant = outline.episodeNumber >= 6 ? "variant-demon-mark" : undefined;
  const variantMapBase: Record<string, string> = {
    ...(zhiweiAwakened ? { "char-yun-zhiwei": zhiweiAwakened } : {}),
    ...(wujiuVariant ? { "char-xie-wujiu": wujiuVariant } : {}),
    ...(outline.episodeNumber >= 8 ? { "prop-broken-jade": "variant-jade-awakened" } : {}),
  };
  const sceneText = (
    sceneIndex: number,
    fallback: { suffix: string; description: string; hook: string; cliffhanger: string },
  ) => {
    const detailBeat = firstTenDetailBeats[outline.episodeNumber]?.[sceneIndex - 1];
    return {
      title: `${outline.title} / ${detailBeat?.suffix || fallback.suffix}`,
      description: detailBeat?.core || fallback.description,
      hook: detailBeat ? `前三秒：${detailBeat.core}` : fallback.hook,
      cliffhanger: detailBeat ? `追更点：${detailBeat.partnerLine}` : fallback.cliffhanger,
      detailBeat,
    };
  };
  return {
    id: outline.id,
    title: outline.title,
    inspiration: `${outline.summary} ${outline.hook} ${outline.cliffhanger}`,
    arcId: outline.phaseId,
    targetDuration: 5,
    sceneCount: 5,
    characterIds: finaleCharacters,
    locationIds: ["loc-qinglan-gate", "loc-spirit-root-hall", "loc-sword-trial-cliff", "loc-ancestral-shrine", "loc-sect-bell-tower"],
    continuityState: {
      cultivationStage: outline.cultivationStage,
      relationshipStage: outline.relationshipStage,
      sectState: outline.sectState,
      keyPropState: outline.keyPropState,
    },
    hook: outline.hook,
    cliffhanger: outline.cliffhanger,
    scenes: [
      makeScene({
        episode: outline,
        sceneIndex: 1,
        ...sceneText(1, {
          suffix: "山门羞辱",
          description: "前三秒先给出云知微被逼跪的结果，再用碎玉发烫把羞辱变成旧案入口。",
          hook: "前三秒：云知微被温烬一剑逼到山门石阶前，碎玉却先于她开口发光。",
          cliffhanger: "追更点：碎玉投出的魂影叫出谢无咎的名字。",
        }),
        locationId: "loc-qinglan-gate",
        propIds: ["prop-broken-jade"],
        characterIds: baseCharacters,
        valueFrom: "云知微被当众认定为废脉和灾星。",
        valueTo: "碎玉在众目睽睽下发烫，证明她和旧案有关。",
        variantMap: variantMapBase,
      }),
      makeScene({
        episode: outline,
        sceneIndex: 2,
        ...sceneText(2, {
          suffix: "灵根殿审判",
          description: "测灵柱判她废脉，谢无咎以少宗主身份保她，温烬借长老席逼出更大指控。",
          hook: "测灵柱碎裂，所有人以为云知微要被逐出宗门。",
          cliffhanger: "追更点：魂灯显示沈鹤年当年亲手封存过云知微母亲的名字。",
        }),
        locationId: "loc-spirit-root-hall",
        propIds: ["prop-broken-jade", "prop-soul-lamp"],
        characterIds: mentorCharacters,
        valueFrom: "宗门长老相信温烬的证词。",
        valueTo: "魂灯响应云知微，旧案证据开始反咬温烬。",
        variantMap: variantMapBase,
      }),
      makeScene({
        episode: outline,
        sceneIndex: 3,
        ...sceneText(3, {
          suffix: "试剑崖对赌",
          description: "温烬要求以剑心试炼定罪，云知微被迫上试剑崖，谢无咎用残剑暗中护住她的命门。",
          hook: "云知微刚踏上试剑崖，锁链桥当场断裂。",
          cliffhanger: "追更点：九霄残剑只对云知微和谢无咎同时有反应。",
        }),
        locationId: "loc-sword-trial-cliff",
        propIds: ["prop-ninefold-sword", "prop-broken-jade"],
        characterIds: baseCharacters,
        valueFrom: "云知微没有修为，被认为必死。",
        valueTo: "她靠碎玉听见剑碑旧声，第一次让九霄残剑低鸣。",
        variantMap: variantMapBase,
      }),
      makeScene({
        episode: outline,
        sceneIndex: 4,
        ...sceneText(4, {
          suffix: "祖祠魂灯",
          description: "洛青檀暗中把二人带进祖祠，魂灯墙出现被抹掉的名字，旧案从传闻变成可验证证据。",
          hook: "魂灯墙突然有一盏灯倒着燃烧。",
          cliffhanger: "追更点：血誓卷轴自动写下云知微和谢无咎的名字。",
        }),
        locationId: "loc-ancestral-shrine",
        propIds: ["prop-soul-lamp", "prop-blood-oath-scroll", "prop-broken-jade"],
        characterIds: ["char-yun-zhiwei", "char-xie-wujiu", "char-luo-qingtan", "char-master-shen"],
        valueFrom: "云知微只知道自己被冤。",
        valueTo: "她确认母亲和青岚旧案有关，谢无咎也被卷入同一条命线。",
        variantMap: { ...variantMapBase, ...(outline.episodeNumber >= 6 ? { "char-xie-wujiu": "variant-demon-mark" } : {}) },
      }),
      makeScene({
        episode: outline,
        sceneIndex: 5,
        ...sceneText(5, {
          suffix: "钟楼魔隙",
          description: "镇魔铜钟裂开，无相魔君的声音穿过后山魔隙，宗门危机从内部争斗升级为三界阴谋。",
          hook: "镇魔铜钟无风自鸣，钟面裂出一道黑红光。",
          cliffhanger: "集尾付费/追更点：无相魔君在裂隙里说'后来者，你终于回来了'。",
        }),
        locationId: outline.episodeNumber >= 7 ? "loc-demon-rift" : "loc-sect-bell-tower",
        propIds: ["prop-sect-bell", "prop-broken-jade", "prop-ninefold-sword"],
        characterIds: finaleCharacters,
        valueFrom: "众人以为只是宗门内审。",
        valueTo: "魔渊逼近，云知微被迫承担青岚宗存亡的第一笔代价。",
        variantMap: {
          ...variantMapBase,
          "loc-sect-bell-tower": "variant-bell-cracked",
          "prop-broken-jade": "variant-jade-awakened",
          ...(outline.episodeNumber >= 9 ? { "loc-qinglan-gate": "variant-blood-rain" } : {}),
        },
      }),
    ],
  } as Episode;
};

const outlines = buildEpisodeOutlines();
const detailedEpisodes = outlines.slice(0, detailedEpisodeCount).map(detailedEpisode);
const outlineEpisodes: Episode[] = outlines.slice(detailedEpisodeCount).map((outline) => ({
  id: outline.id,
  title: outline.title,
  inspiration: `${outline.summary} ${outline.hook} ${outline.cliffhanger}`,
  arcId: outline.phaseId,
  targetDuration: 5,
  sceneCount: 5,
  continuityState: {
    cultivationStage: outline.cultivationStage,
    relationshipStage: outline.relationshipStage,
    sectState: outline.sectState,
    keyPropState: outline.keyPropState,
  },
  scenes: [],
} as Episode));

const episodeMemory = Object.fromEntries(outlines.map((outline) => [
  outline.id,
  {
    episodeNumber: outline.episodeNumber,
    title: outline.title,
    phaseId: outline.phaseId,
    summary: outline.summary,
    hook: outline.hook,
    cliffhanger: outline.cliffhanger,
    continuityState: {
      cultivationStage: outline.cultivationStage,
      relationshipStage: outline.relationshipStage,
      sectState: outline.sectState,
      keyPropState: outline.keyPropState,
    },
    status: outline.episodeNumber <= detailedEpisodeCount ? "detailed_to_video_unit_plan" : "outline_locked",
  },
]));

const project: Project = {
  id: projectId,
  title: "《问骨飞升》100集修仙短剧 Operator 测试",
  type: "short-drama",
  projectModel: "linear",
  productionMode: "short-drama",
  targetScale: {
    label: "xianxia-100ep-front20-storyboard-mode",
    episodeCount: targetEpisodeCount,
    durationMinutes: 500,
    productionBlockSize: detailedEpisodeCount,
  },
  lockStrategy: "episode_block",
  styleVariantPolicy: {
    allowLocalStyleVariants: true,
    requiresStyleVariantId: true,
    allowedScopes: ["episode", "scene", "sequence"],
    fallbackRule: "局部风格变体必须回退到项目 visualStyleLock，不能改变角色身份、媒介或 canonical 资产。",
  },
  aspectRatio: "9:16",
  durationMinutes: 500,
  targetEpisodeCount,
  pacingPreference: "fast",
  originalInspiration: "做一部每集5分钟、100集体量的修仙短剧，宗门被毁、道侣虐恋、飞升前后都有阶段爽点，最终第100集飞升。",
  refinedInspiration: "凡骨女弟子云知微被宗门当成灾星，少宗主谢无咎以道侣契护她。二人从宗门旧案查到仙盟飞升骗局，最终不以牺牲彼此换飞升，而是打开众生问道之路。",
  logline: "凡骨女弟子云知微在宗门灭门前夜觉醒天命骨，与背负魔纹的少宗主谢无咎结成生死道侣，从青岚旧案一路反审仙盟，最终打破飞升垄断。",
  coreConflict: "云知微想救宗门和道侣，仙盟与魔渊都想把她的天命骨变成飞升钥匙；每次变强都要付出关系、宗门或众生的代价。",
  seasonArc: "1-20宗门崩塌，21-40乱域重铸，41-60上界反审，61-80魔渊开门，81-100飞升开天门。",
  visualStyleLock: {
    renderingMode: "live_action",
    stylePrompt: "竖屏仙侠电影感；冷蓝仙雾、金色灵纹、红黑魔渊对比；角色近景表演、手部道具动作和灵力光效都必须服务剧情，不做抽象风格化。",
    styleKeywords: ["vertical xianxia cinematic", "cold immortal mist", "gold spirit veins", "red black demon rift", "close-up performance"],
    colorPalette: ["冷蓝仙雾", "金色灵纹", "红黑魔渊", "青岚宗灰白石阶"],
    lighting: ["冷雾背光", "灵纹边缘光", "魔渊裂隙红黑反差光", "竖屏近景可读性优先"],
    cameraLanguage: "9:16 短剧竖屏，前三秒强危机近景，中段证据反转用手部/道具特写，尾部追更钩子保留角色眼神反应。",
    storyboardStylePolicy: "故事板必须继承项目风格锁，只允许 episode/scene/sequence 级状态变体，不得把项目改成漫画、卡通、3D 或纯概念图风格。",
    assetBoardStylePolicy: "资产板采用制作级真人仙侠身份板语言，清晰拆分角色、服饰、道具和场景状态，禁止把剧情截图当身份锁。",
    effectLookPolicy: "灵力、魂灯、碎玉和魔渊光效必须有统一材质逻辑，局部升级需绑定 variantId 和 scene_asset_variant_pack。",
    driftGuards: [
      "不得脱离竖屏真人仙侠电影感。",
      "不得在同一角色的不同故事板中改变年龄、脸型、发型或核心服装轮廓。",
      "不得用单一气氛词替代可拍摄的镜头、道具和表演指令。",
    ],
    styleSourceRefs: ["creativeVision.visualStyle", "productionMemory.commercialMemory.shortDramaRhythm"],
    humanApprovalState: "approved",
    version: "visual-style-lock.xianxia100.v1",
    source: "operator",
    lockedAt: now,
  },
  creativeVision: {
    genre: ["修仙", "短剧", "虐恋", "逆袭", "宗门复仇"],
    visualStyle: "竖屏仙侠电影感，冷蓝仙雾、金色灵纹、红黑魔渊对比，近景表情和手部道具动作优先。",
    narrativeStyle: "每集前三秒先给危机结果，中段证据反转，结尾用身份/代价/情感钩子推动追更。",
    referenceWorks: "只参考爆款修仙网文的爽点密度、追更结构和情绪偿付，不复制具体作品设定。",
    want: "云知微要证明凡骨也能问道，并救下青岚宗残存火种。",
    need: "她必须学会和谢无咎共同承担，而不是独自牺牲。",
    stakes: "失败则青岚宗旧案永远被抹去，谢无咎半魂被仙盟炼成天门钥匙，三界修士永无公平飞升路。",
    oppositionForce: "仙盟、无相魔君、宗门叛徒温烬以及飞升制度本身。",
    themeQuestion: "飞升究竟是一个人的超脱，还是给后来者留下路？",
    protagonistArc: "从被羞辱的凡骨杂役，到愿意和道侣、同门、众生共同开天门的人。",
    emotionalReward: "第100集飞升不是抛弃人间，而是让众生都能凭本心问道。",
  },
  worldBuildingRules: [
    { id: "rule-cultivation-cost", category: "修为代价", content: "每次破境必须付出可见代价，代价可以是伤势、关系、宗门资源或关键道具损耗。" },
    { id: "rule-dao-partner", category: "道侣契", content: "道侣契不是恋爱标签，而是伤痛互感、命线互证、关键时刻能替对方承受一次致命反噬。" },
    { id: "rule-ascension", category: "飞升制度", content: "仙盟垄断飞升名额，真实飞升门需要众生因果共同打开，不能靠献祭单人完成。" },
  ],
  arcs: phaseDefinitions.map((phase) => ({ id: phase.id, name: phase.title, description: phase.promise })),
  characters,
  relationships: [
    { id: "rel-zhiwei-wujiu", sourceId: "char-yun-zhiwei", targetId: "char-xie-wujiu", type: "道侣/互救", description: "从契约互保到真正互相信任，最终共同飞升但不牺牲彼此。" },
    { id: "rel-zhiwei-wenjin", sourceId: "char-yun-zhiwei", targetId: "char-wen-jin", type: "同门宿敌", description: "温烬既嫉妒云知微也需要她证明自己的选择不是错的。" },
    { id: "rel-zhiwei-wuxiang", sourceId: "char-yun-zhiwei", targetId: "char-wuxiang", type: "镜像对手", description: "无相魔君代表走偏的飞升者，逼云知微回答飞升的意义。" },
  ],
  assets,
  episodes: [...detailedEpisodes, ...outlineEpisodes],
  productionMemory: {
    handbookVersion: OPERATOR_HANDBOOK_VERSION,
    updatedAt: now,
    commercialMemory: {
      monetizationPromise: "每集一个可见爽点和一个追更问题；第20、40、60、80、100集给阶段级大偿付。",
      shortDramaRhythm: "前三秒冲突结果，中段证据/身份反转，最后十五秒付费/追更钩子。",
    },
    skeletonMemory: {
      seriesPromise100: "100集讲完从凡骨被辱到众生开天门的完整修仙飞升线。",
      seasonPromise: "云知微和谢无咎从宗门旧案查到仙盟飞升骗局，最终共同飞升并留下众生路。",
      actMap: phaseDefinitions.map((phase) => `${phase.episodes} ${phase.title}: ${phase.promise}`),
      phaseMap: phaseDefinitions,
      relationshipArc: "互相试探 -> 契约同盟 -> 生死道侣 -> 误会重认 -> 不以牺牲彼此换飞升。",
      payoffMap: ["第10集道侣契预热", "第20集宗门毁灭", "第40集破界入上界", "第60集公开反审", "第80集拒绝独升", "第100集飞升开天门"],
      finaleContract: "第100集必须飞升，但飞升的意义是打开众生路，不是主角抛弃人间。",
    },
    continuityMemory: {
      currentPhase: "phase-1",
      protagonistState: "云知微凡骨起步，前20集从被辱到炼气圆满并觉醒天命骨第一层，碎玉完成第一阶段认主。",
      partnerState: "谢无咎右腕魔纹隐藏，前20集反噬加重但仍保护云知微，并在宗门毁灭夜确认生死道侣命线。",
      relationshipStage: "前20集从互相试探进入生死道侣但未完全公开的阶段，道侣契已成但仍有代价。",
      sectState: "青岚宗表面秩序逐步崩坏，温烬与部分长老推动旧案重审，第20集宗门毁灭。",
      powerLedger: {
        "char-yun-zhiwei": cultivationStageFor(20),
        "char-xie-wujiu": "筑基剑修但魔纹反噬",
        "char-wen-jin": "炼气圆满，擅长借宗门规则杀人",
      },
      propOwnership: {
        "prop-broken-jade": "云知微持有，母亲遗物，前20集认主并开启天命骨第一层。",
        "prop-ninefold-sword": "谢无咎持有，只在云知微危机时低鸣。",
        "prop-soul-lamp": "祖祠保管，洛青檀能短暂点燃。",
        "prop-blood-oath-scroll": "祖祠暗格出现，前20集完成生死道侣契证据链。",
      },
      forbiddenContradictions: [
        "谢无咎不能在第20集前完全解释魔纹真相。",
        "云知微不能在第20集前离开青岚宗主线。",
        "宗门不能在第20集前彻底毁灭，只能逐步崩坏。",
        "碎玉不能直接解决所有危机，每次发光都必须带来新代价。",
      ],
      shotContinuityRule: "竖屏短剧镜头必须保持180度轴线、视线匹配、动作顺接、空间方位和道具归属连续；云知微常在画面左侧，谢无咎常在画面右侧。",
    },
    episodeMemory,
    qaCouncil: {
      commercialProducerQA: "每集必须有前三秒强钩子、中段反转、尾部追更。",
      continuityScriptSupervisorQA: "每集结束必须更新修为、关系、宗门状态和关键道具。",
      storyboardSupervisorQA: "5分钟按5场、每场6个10秒视频单元规划，不生成图片和视频。",
    },
  },
};
project.operatorProductionMemory = project.productionMemory;

const saveArtifact = (
  run: OperatorRun,
  kind: OperatorArtifactEnvelope["kind"],
  targetPath: string,
  entityIds: string[],
  data: unknown,
) => dbHelpers.saveOperatorArtifact(createOperatorArtifact({ runId: run.id, kind, targetPath, entityIds, data }, run));

const appendManualQA = (
  artifact: OperatorArtifactEnvelope,
  status: "passed" | "warning" | "failed",
  summary: string,
) => {
  const saved = dbHelpers.appendOperatorArtifactQA(artifact.id, {
    qaAgentId: `operator.xianxia100.${artifact.kind}.qa`,
    status,
    blocking: status === "failed",
    score: status === "failed" ? 0 : status === "warning" ? 85 : 100,
    issues: [],
    nextAction: status === "failed" ? "retry" : "commit",
    summary,
  });
  assert.ok(saved, `manual QA should save artifact ${artifact.id}`);
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
  const artifact = saveArtifact(run, "qa_report", `stages.${report.stageType}.report`, [projectId], { stageReport: report });
  appendManualQA(artifact, report.status, report.summary);
  dbHelpers.appendOperatorRunEvent(run.id, {
    type: report.status === "failed" ? "qa_failed" : "qa_passed",
    message: `${report.stageType}: ${report.summary}`,
    targetPath: `stages.${report.stageType}`,
    entityIds: [projectId],
    data: report,
  });
};

dbHelpers.saveProject(project);

const run = dbHelpers.saveOperatorRun(createOperatorRunRecord({
  projectId,
  provider: "codex",
  mode: "produce",
  status: "running",
  handbookVersion: OPERATOR_HANDBOOK_VERSION,
  userRequest: "新起一个修仙类100集短剧项目，先做100集脉络，再严格按制片顺序测试前20集到故事板/提示词/视频单元计划。",
  scope: {
    projectId,
    episodeIds: detailedEpisodes.map((episode) => episode.id),
  },
}));

dbHelpers.appendOperatorRunEvent(run.id, {
  type: "plan_created",
  message: "已创建《问骨飞升》100集修仙短剧测试项目，并锁定前20集为本轮详细测试范围。",
  entityIds: [projectId],
});

appendManualQA(saveArtifact(run, "project_patch", "projects.xianxia100.seed", [projectId], {
  projectId,
  title: project.title,
  targetEpisodeCount,
  detailedEpisodeCount,
}), "passed", "项目根数据、100集目标、前20集测试范围已写入 SQLite。");

appendManualQA(saveArtifact(run, "custom", "operator.seriesOutline100", [projectId], {
  phaseDefinitions,
  episodeOutlines: outlines,
}), "passed", "100集五阶段脉络已锁定，后80集为 outline 状态，前20集为 detailed 测试状态。");

const memoryContext = buildLongFormMemoryContext(project, {
  episodeIds: detailedEpisodes.map((episode) => episode.id),
  profile: "operator",
});
appendManualQA(saveArtifact(run, "custom", "operator.longFormMemoryContext.front20", [projectId], {
  memoryContext,
}), memoryContext.missingRequirements.length ? "warning" : "passed", "多集记忆窗口已生成，作为前20集制片上下文。");

addStageReport(run, {
  stageType: "intake",
  status: "passed",
  summary: `新建修仙短剧项目：100集，每集5分钟；本轮测试前${detailedEpisodeCount}集。`,
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

addStageReport(run, {
  stageType: "concept",
  status: "passed",
  summary: "核心卖点锁定：凡骨逆袭、道侣互救、宗门被毁、仙盟飞升骗局、第100集众生开天门。",
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

addStageReport(run, {
  stageType: "context_planning",
  status: memoryContext.missingRequirements.length ? "warning" : "passed",
  summary: `productionMemory 已写入五阶段骨架和100集 episodeMemory；记忆缺口 ${memoryContext.missingRequirements.length} 个。`,
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: memoryContext.missingRequirements.length,
});

const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(project);
const assetBoardIssues = validateVideoStoryboardAssetBoardPlan(assetBoardPlan, project);
assert.equal(blocking(assetBoardIssues), 0, JSON.stringify(assetBoardIssues, null, 2));
appendManualQA(saveArtifact(run, "custom", "operator.assetBoardPlan", [projectId], {
  assetBoardPlan,
  issues: assetBoardIssues,
}), warnings(assetBoardIssues) ? "warning" : "passed", "角色板、场景板、道具板和变体板计划已生成。");

addStageReport(run, {
  stageType: "bible",
  status: "passed",
  summary: `项目圣经已包含 ${characters.length} 名角色、${assets.filter((asset) => asset.type === "location").length} 个场景、${assets.filter((asset) => asset.type === "prop").length} 个关键道具和五阶段飞升线。`,
  artifactCount: 1,
  blockingIssues: 0,
  warningIssues: 0,
});

addStageReport(run, {
  stageType: "asset_detail",
  status: warnings(assetBoardIssues) ? "warning" : "passed",
  summary: `资产板计划完成：角色板 ${assetBoardPlan.characterBoards.length}，场景板 ${assetBoardPlan.sceneBoards.length}，道具板 ${assetBoardPlan.propBoards.length}，变体板 ${assetBoardPlan.variantBoards.length}。`,
  artifactCount: assetBoardPlan.characterBoards.length + assetBoardPlan.sceneBoards.length + assetBoardPlan.propBoards.length + assetBoardPlan.variantBoards.length,
  blockingIssues: blocking(assetBoardIssues),
  warningIssues: warnings(assetBoardIssues),
});

addStageReport(run, {
  stageType: "structure",
  status: "passed",
  summary: `100集结构已规划：5个阶段，每阶段20集；前${detailedEpisodeCount}集进入详细制片。`,
  artifactCount: outlines.length,
  blockingIssues: 0,
  warningIssues: 0,
});

const sceneCount = detailedEpisodes.reduce((total, episode) => total + episode.scenes.length, 0);
const shotCount = detailedEpisodes.reduce((total, episode) =>
  total + episode.scenes.reduce((sceneTotal, scene) => sceneTotal + (scene.shots?.length || 0), 0), 0);

addStageReport(run, {
  stageType: "scene",
  status: "passed",
  summary: `前${detailedEpisodeCount}集已拆场：每集5场，每场1分钟；合计 ${sceneCount} 场。`,
  artifactCount: sceneCount,
  blockingIssues: 0,
  warningIssues: 0,
});

const fullVerdict = runOperatorQA({ check: "full", project, episodes: detailedEpisodes });
assert.equal(fullVerdict.blocking, false, JSON.stringify(fullVerdict.issues, null, 2));
assert.equal(fullVerdict.issues.length, 0, JSON.stringify(fullVerdict.issues, null, 2));

addStageReport(run, {
  stageType: "script",
  status: fullVerdict.status === "passed" ? "passed" : "warning",
  summary: `前${detailedEpisodeCount}集剧本、breakdown、资产引用、分镜和中文提示词已通过 Operator full QA；warning=${fullVerdict.issues.length}。`,
  artifactCount: detailedEpisodes.reduce((total, episode) =>
    total + episode.scenes.reduce((sceneTotal, scene) => sceneTotal + (scene.scriptBlocks?.length || 0), 0), 0),
  blockingIssues: 0,
  warningIssues: fullVerdict.issues.length,
});

const { scriptLockPackage, productionBlockLock } = createScriptLockBundle(project, detailedEpisodes, now);
appendAutoQA(saveArtifact(run, "script_lock_package", "operator.productionLocks.script.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  scriptLockPackage,
}));
appendAutoQA(saveArtifact(run, "production_block_lock", "operator.productionLocks.block.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  productionBlockLock,
}));

addStageReport(run, {
  stageType: "script_lock",
  status: productionBlockLock.openDependencies.length ? "warning" : "passed",
  summary: `剧本锁定完成：锁定前${detailedEpisodeCount}集、${scriptLockPackage.sceneIds.length}场；当前 productionBlockLock=${productionBlockLock.status}，未锁全集风险 ${productionBlockLock.openDependencies.length} 个。`,
  artifactCount: 2,
  blockingIssues: 0,
  warningIssues: productionBlockLock.openDependencies.length,
});

const productionBreakdownReport = buildProductionBreakdownReport({
  project,
  episodes: detailedEpisodes,
  scriptLockPackage,
  productionBlockLock,
  createdAt: now,
});
const castingRequirements = buildCastingRequirements(project, productionBreakdownReport, now);
const roleSlots = buildRoleSlots({ project, castingRequirements, createdAt: now });
const castingDecisions = buildAutostudioCastingDecisions({
  projectId,
  castingRequirements,
  scriptLockPackage,
  productionBlockLock,
  createdAt: now,
});
const departmentPrepPackages = buildDepartmentPrepPackages(project, productionBreakdownReport, now);
const continuityMatrixDraft = buildContinuityMatrix({
  project,
  productionBreakdownReport,
  departmentPrepPackages,
  createdAt: now,
});

appendAutoQA(saveArtifact(run, "production_breakdown_report", "operator.productionBreakdown.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  productionBreakdownReport,
}));
appendAutoQA(saveArtifact(run, "continuity_matrix", "operator.productionContinuity.front20.preVariant", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  continuityMatrix: continuityMatrixDraft,
}));
appendAutoQA(saveArtifact(run, "role_slot", "operator.roleSlots.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  roleSlots,
}));
appendAutoQA(saveArtifact(run, "casting_requirement", "operator.castingRequirements.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  castingRequirements,
}));
for (const decision of castingDecisions) {
  appendAutoQA(saveArtifact(run, "casting_decision", `operator.castingDecisions.front20.${decision.id}`, [projectId, ...decision.affectedEpisodeIds, ...decision.affectedSceneIds, decision.id], {
    castingDecision: decision,
  }));
}
appendAutoQA(saveArtifact(run, "department_prep_package", "operator.departmentPrepPackages.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  departmentPrepPackages,
}));

addStageReport(run, {
  stageType: "production_breakdown",
  status: productionBreakdownReport.openQuestions.length || continuityMatrixDraft.totals.blocked || continuityMatrixDraft.totals.needsReview ? "warning" : "passed",
  summary: `生产拆解完成：sceneMatrix=${productionBreakdownReport.sceneMatrix.length}，role_slot=${roleSlots.length}，casting_requirement=${castingRequirements.length}，casting_decision=${castingDecisions.length}，department_prep_package=${departmentPrepPackages.length}，continuity_rows=${continuityMatrixDraft.totals.rows}。`,
  artifactCount: 5 + castingDecisions.length,
  blockingIssues: continuityMatrixDraft.totals.blocked,
  warningIssues: productionBreakdownReport.openQuestions.length + continuityMatrixDraft.totals.needsReview,
});

const formalAssetBoardPlan = buildVideoStoryboardAssetBoardPlan(project, {
  formalAssetIntent: true,
  scriptLockPackage,
  productionBlockLock,
  productionBreakdownReport,
  castingRequirements,
  castingDecisions,
  departmentPrepPackages,
});
const formalAssetBoardIssues = validateVideoStoryboardAssetBoardPlan(formalAssetBoardPlan, project);
assert.equal(blocking(formalAssetBoardIssues), 0, JSON.stringify(formalAssetBoardIssues, null, 2));
appendManualQA(saveArtifact(run, "custom", "operator.formalAssetBoardPlan.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  assetBoardPlan: formalAssetBoardPlan,
  issues: formalAssetBoardIssues,
}), warnings(formalAssetBoardIssues) ? "warning" : "passed", "正式资产板计划已基于剧本锁、生产拆解、选角决策和部门筹备生成。");

const formalAssetPackage = buildFormalAssetPackage({
  project,
  assetBoardPlan: formalAssetBoardPlan,
  productionBreakdownReport,
  castingDecisions,
  departmentPrepPackages,
  createdAt: now,
});
appendAutoQA(saveArtifact(run, "formal_asset_package", "operator.formalAssetPackage.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  formalAssetPackage,
}));
appendAutoQA(saveArtifact(run, "asset_identity_board", "operator.assetIdentityBoards.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  formalAssetPackage,
}));

addStageReport(run, {
  stageType: "production_asset_detail",
  status: formalAssetPackage.status === "ready_for_department_review" ? "passed" : "failed",
  summary: `正式资产包完成：identity_boards=${formalAssetPackage.identityBoards.length}，productionReadiness=${formalAssetPackage.productionReadiness}，packageBlockers=${formalAssetPackage.packageBlockers.length}。`,
  artifactCount: formalAssetPackage.identityBoards.length + 2,
  blockingIssues: formalAssetPackage.packageBlockers.length,
  warningIssues: warnings(formalAssetBoardIssues),
});

const videoUnitDrafts = buildProductionVideoGenerationUnitDrafts(project, detailedEpisodes, {
  departmentPrepPackages,
  requireDepartmentPrepRefs: true,
});
assert.equal(blocking(videoUnitDrafts.issues), 0, JSON.stringify(videoUnitDrafts.issues, null, 2));
const sceneAssetVariantPacks = buildSceneAssetVariantPacks({
  projectId,
  formalAssetPackage,
  sceneVisualPacks: videoUnitDrafts.sceneVisualPacks,
  createdAt: now,
});
appendAutoQA(saveArtifact(run, "scene_asset_variant_pack", "operator.sceneAssetVariantPacks.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  sceneAssetVariantPacks,
}));
appendAutoQA(saveArtifact(run, "asset_variant_fingerprint", "operator.assetVariantFingerprints.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  sceneAssetVariantPacks,
}));
const continuityMatrix = buildContinuityMatrix({
  project,
  productionBreakdownReport,
  departmentPrepPackages,
  sceneAssetVariantPacks,
  createdAt: now + 1,
});
appendAutoQA(saveArtifact(run, "continuity_matrix", "operator.productionContinuity.front20.withVariants", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  continuityMatrix,
}));

addStageReport(run, {
  stageType: "asset_sync",
  status: warnings(videoUnitDrafts.issues) ? "warning" : "passed",
  summary: `场景视觉包已生成：${videoUnitDrafts.sceneVisualPacks.length} 个，scene_asset_variant_pack=${sceneAssetVariantPacks.length}，复用与变体由 visualFingerprint 管理。`,
  artifactCount: videoUnitDrafts.sceneVisualPacks.length + sceneAssetVariantPacks.length,
  blockingIssues: 0,
  warningIssues: warnings(videoUnitDrafts.issues),
});

addStageReport(run, {
  stageType: "storyboard",
  status: warnings(videoUnitDrafts.issues) ? "warning" : "passed",
  summary: `前${detailedEpisodeCount}集分镜合计 ${shotCount} 镜头，storyboard_board=${videoUnitDrafts.storyboardBoards.length}。`,
  artifactCount: videoUnitDrafts.storyboardBoards.length,
  blockingIssues: 0,
  warningIssues: warnings(videoUnitDrafts.issues),
});

addStageReport(run, {
  stageType: "prompt",
  status: warnings(videoUnitDrafts.issues) ? "warning" : "passed",
  summary: `中文 imagePrompt/videoPrompt 已写入每个镜头；asset_reference_pack=${videoUnitDrafts.assetReferencePacks.length}。`,
  artifactCount: videoUnitDrafts.assetReferencePacks.length,
  blockingIssues: 0,
  warningIssues: warnings(videoUnitDrafts.issues),
});

addStageReport(run, {
  stageType: "expensive_generation_planning",
  status: "passed",
  summary: `视频生成单元已规划：${videoUnitDrafts.videoGenerationUnits.length} 个。`,
  artifactCount: videoUnitDrafts.videoGenerationUnits.length,
  blockingIssues: 0,
  warningIssues: warnings(videoUnitDrafts.issues),
});

appendAutoQA(saveArtifact(run, "performance_beats", "operator.performanceBeats.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  performanceBeats: videoUnitDrafts.performanceBeats,
}));

for (const pack of videoUnitDrafts.sceneVisualPacks) {
  appendAutoQA(saveArtifact(run, "scene_visual_pack", `episodes.${pack.episodeId}.sceneVisualPacks.${pack.id}`, [projectId, pack.episodeId, ...pack.linkedSceneIds, pack.id], {
    sceneVisualPack: pack,
  }));
}

for (const board of videoUnitDrafts.storyboardBoards) {
  appendAutoQA(saveArtifact(run, "storyboard_board", `episodes.${board.episodeId}.scenes.${board.sceneId}.storyboardBoards.${board.id}`, [projectId, board.episodeId, board.sceneId, board.id], {
    storyboardBoard: board,
  }));
}

for (const pack of videoUnitDrafts.assetReferencePacks) {
  appendAutoQA(saveArtifact(run, "asset_reference_pack", `episodes.${pack.episodeId}.scenes.${pack.sceneId}.assetReferencePacks.${pack.id}`, [projectId, pack.episodeId || "", pack.sceneId || "", pack.id], {
    assetReferencePack: pack,
  }));
}

for (const unit of videoUnitDrafts.videoGenerationUnits) {
  appendAutoQA(saveArtifact(run, "video_generation_unit", `episodes.${unit.episodeId}.scenes.${unit.sceneId}.videoGenerationUnits.${unit.id}`, [projectId, unit.episodeId, unit.sceneId, unit.id], {
    videoGenerationUnit: unit,
  }));
}

appendAutoQA(saveArtifact(run, "custom", "videoStoryboardPlan.xianxia100.front20", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  performanceBeats: videoUnitDrafts.performanceBeats,
  storyboardBoards: videoUnitDrafts.storyboardBoards,
  sceneVisualPacks: videoUnitDrafts.sceneVisualPacks,
  assetReferencePacks: videoUnitDrafts.assetReferencePacks,
  videoGenerationUnits: videoUnitDrafts.videoGenerationUnits,
}));

const stageCoordinationGate = buildProductionCoordinationStageGate({
  project,
  episodes: detailedEpisodes,
  operatorArtifacts: savedArtifacts,
  stageType: "expensive_generation_planning",
  runId: run.id,
  environment: "test",
});
assert.equal(stageCoordinationGate.canProceed, true, JSON.stringify(stageCoordinationGate, null, 2));
appendAutoQA(saveArtifact(run, "production_coordination_report", "operator.productionCoordinationReports.front20.stageExit", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  productionCoordinationReport: stageCoordinationGate.report,
}));

const wrapQA = buildProductionCoordinationWrapQA({
  project,
  episodes: detailedEpisodes,
  operatorArtifacts: savedArtifacts,
  runId: run.id,
  environment: "test",
  scope: "phase_wrap",
});
assert.equal(wrapQA.canProceed, true, JSON.stringify(wrapQA, null, 2));
appendAutoQA(saveArtifact(run, "production_coordination_report", "operator.productionCoordinationReports.front20.phaseWrap", [projectId, ...detailedEpisodes.map((episode) => episode.id)], {
  productionCoordinationReport: wrapQA.report,
}));

const cockpit = buildProductionCockpit({
  project,
  episodes: detailedEpisodes,
  operatorArtifacts: savedArtifacts,
  operatorRunId: run.id,
  stageType: "expensive_generation_planning",
  scope: "phase_wrap",
  environment: "test",
  capturedAt: now + 2,
});
assert.equal(cockpit.productionPrep.latestBreakdown?.id, productionBreakdownReport.id);
assert.equal(cockpit.productionPrep.sceneMatrix.length, productionBreakdownReport.sceneMatrix.length);
assert.equal(cockpit.productionPrep.totals.roleSlots, roleSlots.length);
assert.equal(cockpit.productionPrep.totals.castingRequirements, castingRequirements.length);
assert.equal(cockpit.productionPrep.totals.castingDecisions, castingDecisions.length);
assert.equal(cockpit.productionPrep.totals.departmentPrepPackages, departmentPrepPackages.length);
assert.equal(cockpit.productionContinuity.latestMatrix?.id, continuityMatrix.id);
assert.equal(cockpit.productionSchedule.currentBlockReady, true);
assert.equal(cockpit.productionSchedule.fullSeriesReady, false);
assert.equal(cockpit.styleStrategy.styleLockVersion, project.visualStyleLock?.version);
assert.equal(cockpit.storyboardChain.scriptBlocks, detailedEpisodes.reduce((total, episode) =>
  total + episode.scenes.reduce((sceneTotal, scene) => sceneTotal + (scene.scriptBlocks?.length || 0), 0), 0));
assert.equal(cockpit.storyboardChain.shots, shotCount);
assert.equal(cockpit.storyboardChain.artifactCounts.storyboardBoards, videoUnitDrafts.storyboardBoards.length);
assert.equal(cockpit.storyboardChain.artifactCounts.sceneVisualPacks, videoUnitDrafts.sceneVisualPacks.length);
assert.equal(cockpit.storyboardChain.artifactCounts.assetReferencePacks, videoUnitDrafts.assetReferencePacks.length);
assert.equal(cockpit.storyboardChain.artifactCounts.videoGenerationUnits, videoUnitDrafts.videoGenerationUnits.length);
assert.equal(cockpit.storyboardChain.generationStatus.status, "ready");

dbHelpers.appendOperatorRunEvent(run.id, {
  type: "completed",
  message: "修仙100集短剧测试项目：100集骨架和前20集故事板/提示词/视频单元计划已完成。",
  entityIds: [projectId, ...detailedEpisodes.map((episode) => episode.id)],
});

dbHelpers.patchOperatorRun(run.id, {
  status: "completed",
  qaSummary: {
    passed: savedArtifacts.filter((artifact) => artifact.qaVerdicts.every((verdict) => verdict.status === "passed")).length,
    warnings: savedArtifacts.filter((artifact) => artifact.qaVerdicts.some((verdict) => verdict.status === "warning")).length,
    failed: savedArtifacts.filter((artifact) => artifact.qaVerdicts.some((verdict) => verdict.status === "failed")).length,
    blocked: savedArtifacts.filter((artifact) => artifact.qaVerdicts.some((verdict) => verdict.blocking)).length,
  },
  outputs: savedArtifacts.map((artifact) => ({
    kind: artifact.kind,
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    artifactId: artifact.id,
  })),
});

const savedProject = dbHelpers.getProjectById(projectId) as Project | null;
assert.ok(savedProject, "saved project must be readable from sqlite");
assert.equal(savedProject.episodes.length, targetEpisodeCount);
assert.equal((savedProject.episodes.slice(0, detailedEpisodeCount) as Episode[])
  .reduce((total, episode) => total + (episode.scenes?.length || 0), 0), sceneCount);

const result = {
  status: "passed",
  projectId,
  runId: run.id,
  title: project.title,
  targetEpisodeCount,
  detailedEpisodeCount,
  episodeDurationSeconds: 300,
  totalPlannedDurationMinutes: targetEpisodeCount * 5,
  phaseCount: phaseDefinitions.length,
  outlineEpisodeCount: outlines.length,
  detailedSceneCount: sceneCount,
  detailedShotCount: shotCount,
  lockedEpisodeCount: scriptLockPackage.episodeIds.length,
  lockedSceneCount: scriptLockPackage.sceneIds.length,
  productionBlockLockStatus: productionBlockLock.status,
  productionBreakdownSceneMatrixCount: productionBreakdownReport.sceneMatrix.length,
  roleSlotCount: roleSlots.length,
  castingRequirementCount: castingRequirements.length,
  castingDecisionCount: castingDecisions.length,
  departmentPrepPackageCount: departmentPrepPackages.length,
  continuityRowCount: continuityMatrix.totals.rows,
  formalAssetPackageStatus: formalAssetPackage.status,
  formalAssetIdentityBoardCount: formalAssetPackage.identityBoards.length,
  performanceBeatCount: videoUnitDrafts.performanceBeats.length,
  sceneVisualPackCount: videoUnitDrafts.sceneVisualPacks.length,
  sceneAssetVariantPackCount: sceneAssetVariantPacks.length,
  assetReferencePackCount: videoUnitDrafts.assetReferencePacks.length,
  storyboardBoardCount: videoUnitDrafts.storyboardBoards.length,
  videoGenerationUnitCount: videoUnitDrafts.videoGenerationUnits.length,
  coordinationReports: 2,
  cockpit: {
    currentBlockReady: cockpit.productionSchedule.currentBlockReady,
    fullSeriesReady: cockpit.productionSchedule.fullSeriesReady,
    lockStatus: cockpit.productionSchedule.lockStatus,
    departmentCoverageReady: cockpit.counts.departmentCoverageReady,
    coordinationTraceLinks: cockpit.counts.coordinationTraceLinks,
    styleLockVersion: cockpit.styleStrategy.styleLockVersion,
    storyboardBoardsVisible: cockpit.storyboardChain.artifactCounts.storyboardBoards,
    mediaGenerationReady: cockpit.storyboardChain.generationStatus.status === "ready",
  },
  stageReports,
  front20Outline: outlines.slice(0, detailedEpisodeCount).map((outline) => ({
    episodeNumber: outline.episodeNumber,
    title: outline.title,
    summary: outline.summary,
    cliffhanger: outline.cliffhanger,
  })),
  productionUrl: `http://localhost:3001/production/preparation?projectId=${projectId}`,
  projectUrl: `http://localhost:3001/projects/${projectId}`,
};

console.log(JSON.stringify(result, null, 2));
