import {
  FORMAT_ROUTING,
  GENERAL_FORMAT_TEMPLATES,
  INTERACTIVE_FORMAT_TEMPLATES,
  MICRO_SHORT_DRAMA_TEMPLATES,
} from "./templates";
import type { FormatTemplates } from "./templates";
import type { Project, ProjectType } from "../types/project";

export type ProductionFormatId = ProjectType | "interactive";
export type FormatPromptFragmentKey = "concept" | "bible" | "structure" | "scene" | "script" | "storyboard" | "prompt";

export interface FormatGenerationPolicy {
  pilotFirst: boolean;
  maxGeneratedEpisodesPerBatch: number;
  notes: string[];
}

export interface FormatProductionProfile {
  id: ProductionFormatId;
  label: string;
  mode: "linear" | "interactive";
  unitName: string;
  defaultTargetCount: number;
  maxTargetCount: number;
  defaultSkeletonId: string;
  defaultBeatId: string;
  defaultSceneTemplateId: string;
  templates: FormatTemplates;
  structureInstruction: string;
  promptFragments: Record<FormatPromptFragmentKey, string>;
  storyboardRules: string[];
  promptRules: string[];
  qaGates: string[];
  generationPolicy: FormatGenerationPolicy;
  customTemplateRules: string[];
}

const commonCustomTemplateRules = [
  "自定义模板必须声明适用作品类型和阶段，不能默认跨类型套用。",
  "自定义模板必须声明输出 JSON schema 或字段清单，缺字段时运行前提示作者。",
  "自定义模板必须标明与参考导演/作品 DNA 的关系：硬约束、软建议或禁用。",
];

const movieProfile: FormatProductionProfile = {
  id: "movie",
  label: "电影长片",
  mode: "linear",
  unitName: "电影段落",
  defaultTargetCount: 3,
  maxTargetCount: 8,
  defaultSkeletonId: "skel-movie-3act",
  defaultBeatId: "beat-story-circle",
  defaultSceneTemplateId: "seq-general",
  templates: FORMAT_ROUTING.movie,
  structureInstruction:
    "按长片段落规划，不把段落误写成连续分集。优先保证命题统一、角色弧线、因果闭环、视觉母题回收和结尾情感/认知补偿。",
  promptFragments: {
    concept: "概念必须回答主题命题、主角 Want/Need、代价、对手压力和结尾情感补偿。",
    bible: "项目圣经需要沉淀人物弧线、价值观冲突、视觉母题、世界规则和反复出现的戏剧问题。",
    structure: "结构阶段优先使用三幕/五幕/八段落等电影骨架，段落之间必须有因果推进和角色内部变化。",
    scene: "场景拆分必须服务段落价值变化，避免只按事件流水账切场。",
    script: "剧本对白要克制并有潜台词，尽量用动作、环境和选择表达人物变化。",
    storyboard: "分镜需要体现空间连续性、情绪距离变化和视觉母题，不只生成漂亮单帧。",
    prompt: "视觉提示词必须继承分镜参数、角色资产和母题规则，避免只堆摄影风格词。",
  },
  storyboardRules: [
    "每场至少有远/中/近或信息层级变化。",
    "关键转折必须有可拍摄的动作、道具或空间变化承载。",
    "镜头连续性需要在 continuityNote 同时说明 180 度轴线、视线匹配、动作顺接和空间方位连续性；若故意破坏连续性，必须说明创作理由和可见承接点。",
  ],
  promptRules: [
    "导演/作品参考只能作为 provenance，生成时必须使用拆解后的镜头、节奏、表演和美术规则。",
    "画面提示词必须继承角色、地点、道具和分镜物理参数。",
  ],
  qaGates: [
    "want_need_stakes",
    "causal_structure",
    "character_arc",
    "scene_value_shift",
    "visual_motif_recall",
    "reference_template_conflict",
  ],
  generationPolicy: {
    pilotFirst: true,
    maxGeneratedEpisodesPerBatch: 3,
    notes: ["建议先完成 1 个关键段落的剧本和分镜，通过 gate 后再扩展全片。"],
  },
  customTemplateRules: commonCustomTemplateRules,
};

const tvSeriesProfile: FormatProductionProfile = {
  id: "tv-series",
  label: "电视剧/剧集",
  mode: "linear",
  unitName: "分集",
  defaultTargetCount: 6,
  maxTargetCount: 12,
  defaultSkeletonId: "skel-tv-serialized",
  defaultBeatId: "beat-tv-5act",
  defaultSceneTemplateId: "tv-general",
  templates: FORMAT_ROUTING["tv-series"],
  structureInstruction:
    "按剧集分集规划，既要有单集满足感，也要持续推动季主线、人物关系长线燃料和下一集问题。",
  promptFragments: {
    concept: "概念必须明确持续发动机、季主线、单集问题来源和角色关系长期燃料。",
    bible: "项目圣经需要记录季节弧线、A/B/C 线、人物关系网、单元案件或主线谜题机制。",
    structure: "结构阶段每集都要声明本集 A 故事、关系/副线推进、结尾钩子和季主线增量。",
    scene: "场景拆分需要标出本场服务 A 故事、B 线、人物关系还是季主线。",
    script: "剧本应给人物关系留出拉扯和潜台词，不用电影式过度压缩，也不能短剧式只追爽点。",
    storyboard: "分镜需要保持角色关系和空间调度的连续性，服务长期观看的清晰度。",
    prompt: "视觉提示词应保持剧集统一美术和角色一致性，避免每集风格漂移。",
  },
  storyboardRules: [
    "每集必须有至少一个推动季主线或关系长线的场景。",
    "场景切换要服务 A/B 线交错，而不是平均分配戏份。",
    "结尾镜头应承载下一集问题或人物关系变化。",
  ],
  promptRules: [
    "保持角色形象、空间资产和色彩策略的跨集一致性。",
    "参考作品的节奏规则必须与当前剧集模式兼容：单元剧、连续剧、迷你剧不能混用不说明。",
  ],
  qaGates: [
    "series_engine",
    "episode_satisfaction",
    "season_arc_progress",
    "relationship_fuel",
    "cliffhanger_quality",
    "reference_template_conflict",
  ],
  generationPolicy: {
    pilotFirst: true,
    maxGeneratedEpisodesPerBatch: 6,
    notes: ["建议先生成首批 3-6 集结构和 1 集完整剧本，确认剧集发动机稳定后再批量展开。"],
  },
  customTemplateRules: commonCustomTemplateRules,
};

const shortDramaProfile: FormatProductionProfile = {
  id: "short-drama",
  label: "连续短剧",
  mode: "linear",
  unitName: "短剧分集",
  defaultTargetCount: 6,
  maxTargetCount: 12,
  defaultSkeletonId: "skel-short-rich-counterattack",
  defaultBeatId: "beat-short-3s-15s",
  defaultSceneTemplateId: "short-drama-general",
  templates: FORMAT_ROUTING["short-drama"],
  structureInstruction:
    "按连续短剧分集规划，强调低理解成本、强钩子、高频反转、情绪偿付、集尾付费诱因和连续追更欲望。",
  promptFragments: {
    concept: "概念必须明确爽点承诺、反派压迫方式、主角反击资源、付费点和连续追更发动机。",
    bible: "项目圣经需要记录阶层/身份反差、打脸节奏、反派梯队、爽点循环和禁用套路。",
    structure: "结构阶段每集都要有前置钩子、一次局部反转或压迫升级、集尾 cliffhanger。",
    scene: "场景必须短、直、强冲突，避免铺垫型过场；每场都要改变情绪优势或信息优势。",
    script: "台词要直给、带情绪和信息密度，不能写成慢热电视剧对白。",
    storyboard: "分镜优先服务手机端可读性、面部表演、冲突动作和反转信息揭示。",
    prompt: "提示词要强调竖屏/近景/表情/动作爆点，但仍需继承角色资产与空间连续性。",
  },
  storyboardRules: [
    "前 3 秒必须有可视化冲突或异常结果。",
    "每集至少一次明确反转、羞辱升级或优势转移。",
    "集尾必须停在观众想继续看的最高压力点。",
  ],
  promptRules: [
    "竖屏提示词必须优先保证主体可读、表情清楚、动作爆点明确。",
    "短剧爽点不能无提示污染电影或严肃剧集模板。",
  ],
  qaGates: [
    "first_3s_hook",
    "low_cognitive_load",
    "reversal_frequency",
    "emotional_payoff",
    "paid_hook",
    "reference_template_conflict",
  ],
  generationPolicy: {
    pilotFirst: true,
    maxGeneratedEpisodesPerBatch: 6,
    notes: ["批量生成前先验证前 3 集钩子和付费点，避免一次性生成大量同质化分集。"],
  },
  customTemplateRules: commonCustomTemplateRules,
};

const microShortDramaProfile: FormatProductionProfile = {
  id: "micro-short-drama",
  label: "单集微短剧",
  mode: "linear",
  unitName: "单集段落",
  defaultTargetCount: 3,
  maxTargetCount: 6,
  defaultSkeletonId: "skel-micro-single-hook-loop",
  defaultBeatId: "beat-micro-first-3s-proof",
  defaultSceneTemplateId: "micro-short-burst",
  templates: MICRO_SHORT_DRAMA_TEMPLATES,
  structureInstruction:
    "按单条 5-20 分钟微短剧规划段落，不生成连续分集。开场先给可视化冲突，90 秒内给实质反转，结尾给完整情绪偿付和短促余钩。",
  promptFragments: {
    concept: "概念必须能支撑单条视频闭环：开场爆点、核心误会/危机、反转证据、情绪偿付和余钩。",
    bible: "项目圣经需要压缩设定数量，明确主空间、核心关系、关键道具和单集情绪承诺。",
    structure: "结构阶段生成的是单集段落，不是多集大纲；每段都要服务一条视频的完整观看曲线。",
    scene: "场景拆分应优先可拍、短促、高压，尽量复用空间和角色，避免连续剧式支线。",
    script: "对白需要快但不能乱，信息必须通过冲突、证据和态度变化送出。",
    storyboard: "分镜优先保证手机端第一眼读懂冲突、人物关系和反转证据。",
    prompt: "提示词要继承竖屏/移动端可读性、强主体、清晰动作和关键道具证据。",
  },
  storyboardRules: [
    "第一镜必须能看懂冲突或异常结果。",
    "每个段落都要有清晰价值变化，不能只承担解释信息。",
    "结尾必须完成主冲突偿付，不把单集硬拆成连续短剧。",
  ],
  promptRules: [
    "避免把单集微短剧误套连续短剧的多集付费点。",
    "画面提示词必须突出手机端可读主体、表情和关键道具。",
  ],
  qaGates: [
    "single_video_closure",
    "first_3s_hook",
    "first_90s_turn",
    "scene_value_shift",
    "mobile_readability",
    "reference_template_conflict",
  ],
  generationPolicy: {
    pilotFirst: true,
    maxGeneratedEpisodesPerBatch: 3,
    notes: ["建议一次先完成整条视频的结构、关键场景和 1 个爆点分镜，再决定是否扩展同题材系列。"],
  },
  customTemplateRules: commonCustomTemplateRules,
};

const interactiveProfile: FormatProductionProfile = {
  id: "interactive",
  label: "互动影视游戏",
  mode: "interactive",
  unitName: "互动章节",
  defaultTargetCount: 1,
  maxTargetCount: 6,
  defaultSkeletonId: "skel-interactive-foldback",
  defaultBeatId: "beat-interactive-meaningful-choice",
  defaultSceneTemplateId: "interactive-node-choice-hold",
  templates: INTERACTIVE_FORMAT_TEMPLATES,
  structureInstruction:
    "按互动影视游戏规划：先声明 Golden Path、变量门控、折返点、Bad Ending/Hidden Ending 和可拍摄分支范围。选择必须改变变量、信息、关系、路径或结局概率。",
  promptFragments: {
    concept: "概念必须明确玩家身份、选择压力、变量系统、失败状态、结局承诺和可拍摄边界。",
    bible: "项目圣经需要记录互动契约、变量定义、玩家可见反馈、章节继承和失败状态。",
    structure: "结构阶段必须规划 Golden Path、折返节点、变量门控和分支成本，不允许只把线性剧情切按钮。",
    scene: "节点场景必须包含选择前停顿、选项压力、状态反馈和折返/分叉策略。",
    script: "节点剧本要给 Interactive Hold，选择文本必须互斥且有代价。",
    storyboard: "互动分镜要明确 UI 安全区、选择停顿、反馈镜头和分支复用关系。",
    prompt: "提示词必须继承节点状态、变量反馈、UI 安全区和可复用资产约束。",
  },
  storyboardRules: [
    "每个选择节点必须有选择前停顿和玩家可读的压力信息。",
    "分支镜头要标注可复用段落与新增拍摄成本。",
    "结局镜头必须回收导致该结局的关键变量或选择。",
  ],
  promptRules: [
    "提示词必须保留 UI 安全区和互动停顿，不把选择节点生成成普通线性剧情。",
    "变量反馈要转译成可拍摄视觉、表演或道具变化。",
  ],
  qaGates: [
    "meaningful_choice",
    "variable_feedback",
    "golden_path_reachable",
    "foldback_budget",
    "ending_coverage",
    "fake_choice_detection",
    "reference_template_conflict",
  ],
  generationPolicy: {
    pilotFirst: true,
    maxGeneratedEpisodesPerBatch: 1,
    notes: ["建议先生成 1 条 Golden Path 和 1 个 Bad Ending 验证互动契约，再扩大节点数量。"],
  },
  customTemplateRules: [
    ...commonCustomTemplateRules,
    "互动模板必须声明变量读写、结局影响、折返节点和新增拍摄成本。",
  ],
};

const generalProfile = (id: "single-work" | "series-work"): FormatProductionProfile => ({
  id, label: id === "single-work" ? "单部作品" : "系列作品", mode: "linear",
  unitName: id === "single-work" ? "段落" : "集", defaultTargetCount: 1, maxTargetCount: 500,
  defaultSkeletonId: "open-structure", defaultBeatId: "open-rhythm", defaultSceneTemplateId: "open-scenes",
  templates: GENERAL_FORMAT_TEMPLATES,
  structureInstruction: "作品类型、表达方式和内容组织以作者要求为准；不自动套用商业电影、短剧或电视季结构。",
  promptFragments: {
    concept: "整理作者意图、拍摄或呈现对象、现有资料与未知事项；不为填字段虚构人物、冲突或事实。",
    bible: "整理实际需要的角色、对象、地点、声音、美术和引用资料；没有人物也可以成立。",
    structure: "按作者选择组织单部作品或系列内容，不要求特定幕数、反转、季主线或钩子。",
    scene: "依据实际场景边界、观察过程或内容需要拆分，不按时长强凑场数。",
    script: "按作品需要使用动作、对白、旁白、采访、声音或停顿。记录内容不得伪造证据和原话。",
    storyboard: "按作者需要表现构图、空间、观察或叙事，允许静止画面、长镜头及无人物内容。",
    prompt: "只描述本次要制作的可见内容和作者选择的风格，保留素材引用，不自动加入竖屏、快切或戏剧爆点。",
  },
  storyboardRules: ["镜头数量和景别随内容决定，不设置最低变化次数。"],
  promptRules: ["采用的参考素材保持版本与来源；资料中缺失的信息不冒充已确认事实。"],
  qaGates: ["source_integrity", "reference_integrity", "author_intent"],
  generationPolicy: { pilotFirst: false, maxGeneratedEpisodesPerBatch: 6, notes: ["仅执行作者本次授权的对象范围。"] },
  customTemplateRules: ["作者自选模板仅作用于本次范围，不自动替换已保存模板。"],
});

export const FORMAT_PRODUCTION_PROFILES: Record<ProductionFormatId, FormatProductionProfile> = {
  "single-work": generalProfile("single-work"),
  "series-work": generalProfile("series-work"),
  movie: movieProfile,
  "tv-series": tvSeriesProfile,
  "short-drama": shortDramaProfile,
  "micro-short-drama": microShortDramaProfile,
  interactive: interactiveProfile,
};

export const getFormatProductionProfile = (
  project: Pick<Project, "type" | "projectModel">,
): FormatProductionProfile => {
  if (project.projectModel === "interactive") return FORMAT_PRODUCTION_PROFILES.interactive;
  return FORMAT_PRODUCTION_PROFILES[project.type] || FORMAT_PRODUCTION_PROFILES.movie;
};

export const resolveStructureTargetCount = (
  project: Pick<Project, "targetEpisodeCount">,
  profile: FormatProductionProfile,
): number => {
  const requested = Number(project.targetEpisodeCount || 0);
  const base = requested > 0 ? requested : profile.defaultTargetCount;
  return Math.max(1, Math.min(base, profile.maxTargetCount));
};

export const buildStructureInstruction = (
  profile: FormatProductionProfile,
  targetCount: number,
  revisionInstruction = "",
): string => {
  const revision = revisionInstruction.trim();
  return [
    `请生成 ${targetCount} 个${profile.unitName}。`,
    `【类型生产 Profile】${profile.label} / ${profile.mode}。${profile.structureInstruction}`,
    `【默认结构模板】${profile.defaultSkeletonId}；【默认节拍模板】${profile.defaultBeatId}；【默认场景模板】${profile.defaultSceneTemplateId}。`,
    `【QA 重点】${profile.qaGates.join("、")}。`,
    revision ? `【修订要求】${revision}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const buildFormatStageInstruction = (
  profile: FormatProductionProfile,
  stageKey: Extract<FormatPromptFragmentKey, "scene" | "script" | "storyboard" | "prompt">,
): string => {
  const stageRules = [
    profile.promptFragments[stageKey],
    stageKey === "storyboard" ? `分镜规则: ${profile.storyboardRules.join("；")}` : "",
    stageKey === "prompt" ? `提示词规则: ${profile.promptRules.join("；")}` : "",
  ].filter(Boolean);
  return [
    `【类型生产 Profile】${profile.label} / ${profile.mode}`,
    `【本阶段类型指令】${stageRules.join("\n")}`,
    `【默认模板锚点】结构=${profile.defaultSkeletonId}；节拍=${profile.defaultBeatId}；场景=${profile.defaultSceneTemplateId}`,
    `【类型 QA 重点】${profile.qaGates.join("、")}`,
    `【生成范围策略】pilotFirst=${profile.generationPolicy.pilotFirst ? "yes" : "no"}；batchLimit=${profile.generationPolicy.maxGeneratedEpisodesPerBatch}`,
  ]
    .filter(Boolean)
    .join("\n");
};
