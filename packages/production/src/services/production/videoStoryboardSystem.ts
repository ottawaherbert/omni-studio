import { defaultTemplates } from "../../../../../src/config/prompts";

export type StoryboardBoardMode =
  | "single_shot_performance"
  | "dialogue_blocking"
  | "multi_shot_narrative"
  | "spatial_geography"
  | "montage_compression"
  | "procedural_insert"
  | "parallel_intercut"
  | "subjective_suspense"
  | "action_continuity"
  | "fight_choreography"
  | "dance_choreography"
  | "emotional_reaction"
  | "emotional_performance"
  | "reveal_or_twist"
  | "effect_reveal"
  | "transition_bridge"
  | "interactive_idle_loop"
  | "interactive_ui_safe"
  | "ai_video_control"
  | "rhythm_sheet";

export type StoryboardStrategyStatus = "active" | "experimental" | "deprecated";

export type StoryboardStrategyResolutionMode =
  | "built_in_preset"
  | "composed_recipe"
  | "project_local_draft_required";

export type StoryboardStrategyCompositionRole =
  | "primary"
  | "primary_or_modifier"
  | "modifier";

export interface StoryboardStrategyResolution {
  mode: StoryboardStrategyResolutionMode;
  primaryStrategyId: string;
  modifierStrategyIds: string[];
  requiredCapabilityIds: string[];
  coveredCapabilityIds: string[];
  uncoveredCapabilityIds: string[];
  fallbackStrategyId: string;
  confidence: number;
  requiresHumanApproval: boolean;
  maxAutomaticRevisionAttempts: 1;
}

export interface ImageModelProfile {
  id: string;
  provider: string;
  model: string;
  version: string;
  purpose: string;
  supportsReferenceImages: boolean;
  supportsLineArtControl: boolean;
  supportsMultiPanelBoards: boolean;
  supportsAssetBoards: boolean;
  aspectRatios: string[];
  notes: string;
}

export interface VideoModelProfile {
  id: string;
  provider: string;
  model: string;
  version: string;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  preferredDurationsSeconds: number[];
  supportsStoryboardReference: boolean;
  supportsLineArtControl: boolean;
  supportsStartEndFrames: boolean;
  supportsReferenceImages: boolean;
  maxReferenceImages?: number;
  supportsReferenceVideos: boolean;
  maxReferenceVideos?: number;
  supportsAudio: boolean;
  supportsDialogueAudio?: boolean;
  supportsMultiShotSingleGeneration?: boolean;
  aspectRatios: string[];
  notes: string;
}

export interface StoryboardArrowLegendEntry {
  id: string;
  marker: string;
  meaning: string;
  configurable: boolean;
}

export interface StoryboardPromptStrategy {
  id: string;
  version: string;
  name: string;
  status: StoryboardStrategyStatus;
  boardMode: StoryboardBoardMode;
  recommendedWhen: string[];
  avoidWhen: string[];
  requiredInputs: string[];
  outputContract: string[];
  promptTemplateId: string;
  qaChecklist: string[];
  modelCompatibilityTags: string[];
}

export interface StoryboardStrategySelectionContext {
  projectFormat?: string;
  scenePurpose?: string;
  beatSummary?: string;
  dialogueLineCount?: number;
  actionBeatCount?: number;
  combatBeatCount?: number;
  emotionalBeatCount?: number;
  revealOrTwist?: boolean;
  transitionBridge?: boolean;
  interactiveNode?: boolean;
  requiresDialogueBlocking?: boolean;
  requiresMultiShot?: boolean;
  expectedVideoUnitDurationSeconds?: number;
  expectedReferenceImageCount?: number;
  expectedReferenceVideoCount?: number;
  modelProfileId?: string;
  targetAspectRatio?: string;
  availableStrategyIds?: string[];
  /** Structured production requirements take priority over text-keyword compatibility inference. */
  requiredCapabilityIds?: string[];
}

export interface StoryboardStrategyDecision {
  selectedStrategyId: string;
  selectedStrategyVersion: string;
  selectedModelProfileId: string;
  rationale: string;
  rejectedStrategyIds: string[];
  riskNotes: string[];
  expectedBoardShape: string;
  expectedVideoUnitDurationSeconds: number;
  expectedReferenceImageCount: number;
  expectedReferenceVideoCount: number;
  arrowLegendIds: string[];
  qaChecklist: string[];
  strategyResolution?: StoryboardStrategyResolution;
}

export interface StoryboardStrategyRecommendation {
  strategyId: string;
  score: number;
  reasons: string[];
  cautions: string[];
}

export type StoryboardStrategySelectionIssueSeverity = "blocking" | "warning";

export interface StoryboardStrategySelectionIssue {
  severity: StoryboardStrategySelectionIssueSeverity;
  code: string;
  message: string;
  field?: string;
}

export const STORYBOARD_STRATEGY_DECISION_REQUIRED_FIELDS: Array<keyof StoryboardStrategyDecision> = [
  "selectedStrategyId",
  "selectedStrategyVersion",
  "selectedModelProfileId",
  "rationale",
  "rejectedStrategyIds",
  "riskNotes",
  "expectedBoardShape",
  "expectedVideoUnitDurationSeconds",
  "expectedReferenceImageCount",
  "expectedReferenceVideoCount",
  "arrowLegendIds",
  "qaChecklist",
];

export const STORYBOARD_ARROW_LEGEND: StoryboardArrowLegendEntry[] = [
  {
    id: "subject_action_red",
    marker: "red solid arrow",
    meaning: "角色、身体、武器、道具或主要动作方向。",
    configurable: true,
  },
  {
    id: "camera_motion_blue",
    marker: "blue solid arrow",
    meaning: "摄影机或画框运动方向，例如推、拉、摇、移、跟拍。",
    configurable: true,
  },
  {
    id: "eyeline_attention_green",
    marker: "green arrow",
    meaning: "视线、注意力或情绪指向。",
    configurable: true,
  },
  {
    id: "composition_note_green",
    marker: "green note/mark",
    meaning: "取景、构图、安全区、三分线、前景虚化或负空间提示。",
    configurable: true,
  },
  {
    id: "energy_impact_orange",
    marker: "orange arrow",
    meaning: "能量、冲击、光效、爆炸、法术流向。",
    configurable: true,
  },
  {
    id: "lighting_direction_orange",
    marker: "orange note/arrow",
    meaning: "灯光方向、窗光、逆光、顶光、冷暖对比或光线变化。",
    configurable: true,
  },
  {
    id: "sound_emotion_purple",
    marker: "purple note/arrow",
    meaning: "声音、音乐节拍、台词重音、情绪爆点或沉默停顿。",
    configurable: true,
  },
  {
    id: "shot_note_black",
    marker: "black text",
    meaning: "panel 编号、镜头规格、镜头笔记、时长或节奏说明。",
    configurable: true,
  },
  {
    id: "offscreen_handoff_dashed",
    marker: "dashed arrow",
    meaning: "预期动作、离屏运动、下一段承接。",
    configurable: true,
  },
  {
    id: "primary_fast_motion_thick",
    marker: "thick arrow",
    meaning: "主运动或高速动作。",
    configurable: true,
  },
  {
    id: "rotation_arc_curved",
    marker: "curved arrow",
    meaning: "旋转、转身、环绕、摇镜。",
    configurable: true,
  },
];

export const IMAGE_MODEL_PROFILES: ImageModelProfile[] = [
  {
    id: "image.line_art_storyboard_control.configurable.v1",
    provider: "configurable",
    model: "line-art-storyboard-image-model",
    version: "v1",
    purpose: "生成线稿故事板、动作箭头、首尾帧草图和视频控制图。",
    supportsReferenceImages: true,
    supportsLineArtControl: true,
    supportsMultiPanelBoards: true,
    supportsAssetBoards: true,
    aspectRatios: ["9:16", "16:9", "1:1", "4:3", "3:4"],
    notes: "具体模型名称和限制必须由渠道配置覆盖；这里是系统能力槽位，不是全局硬编码模型。",
  },
  {
    id: "image.asset_board_reference.configurable.v1",
    provider: "configurable",
    model: "asset-board-image-model",
    version: "v1",
    purpose: "生成角色板、场景板、道具板、服化妆/伤势/战损变体板。",
    supportsReferenceImages: true,
    supportsLineArtControl: false,
    supportsMultiPanelBoards: true,
    supportsAssetBoards: true,
    aspectRatios: ["16:9", "4:3", "3:4", "1:1"],
    notes: "用于资产参考图，不直接决定视频生成时长。",
  },
];

export const VIDEO_MODEL_PROFILES: VideoModelProfile[] = [
  {
    id: "video.storyboard_reference.configurable.short_unit.v1",
    provider: "configurable",
    model: "storyboard-guided-video-model",
    version: "v1",
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    preferredDurationsSeconds: [6, 8, 10, 12],
    supportsStoryboardReference: true,
    supportsLineArtControl: true,
    supportsStartEndFrames: true,
    supportsReferenceImages: true,
    maxReferenceImages: 9,
    supportsReferenceVideos: true,
    maxReferenceVideos: 3,
    supportsAudio: true,
    supportsDialogueAudio: false,
    supportsMultiShotSingleGeneration: true,
    aspectRatios: ["9:16", "16:9", "1:1"],
    notes: "这是可覆盖的默认短视频单元 profile；真实限制以当前视频渠道配置为准。",
  },
  {
    id: "video.start_end_frame.configurable.bridge_unit.v1",
    provider: "configurable",
    model: "start-end-frame-video-model",
    version: "v1",
    minDurationSeconds: 2,
    maxDurationSeconds: 10,
    preferredDurationsSeconds: [4, 6, 8],
    supportsStoryboardReference: true,
    supportsLineArtControl: false,
    supportsStartEndFrames: true,
    supportsReferenceImages: true,
    maxReferenceImages: 4,
    supportsReferenceVideos: false,
    supportsAudio: false,
    supportsDialogueAudio: false,
    supportsMultiShotSingleGeneration: false,
    aspectRatios: ["9:16", "16:9", "1:1"],
    notes: "适合转场桥接、动作承接和首尾帧连续性测试；真实限制以渠道 profile 为准。",
  },
];

export const STORYBOARD_PROMPT_STRATEGIES: StoryboardPromptStrategy[] = [
  {
    id: "storyboard.single_shot_dialogue.v1",
    version: "v1",
    name: "单镜头对白表演板",
    status: "active",
    boardMode: "single_shot_performance",
    recommendedWhen: ["10 秒左右单镜头", "双人或少量角色对白", "情绪靠眼神、停顿、手部微动作推进"],
    avoidWhen: ["复杂打斗", "多人高速调度", "需要明显多镜头剪辑"],
    requiredInputs: ["scriptBlocks", "dialogueLines", "characterVariants", "locationVariant", "continuityInOut"],
    outputContract: ["3-4 个关键帧", "固定轴线", "表演节拍", "台词/音效提示", "首尾状态"],
    promptTemplateId: "storyboard.board.singleShotDialogue",
    qaChecklist: ["对白时长可支撑", "镜头不乱切", "角色位置稳定", "表演有可见变化"],
    modelCompatibilityTags: ["single-shot", "dialogue", "start-end-frame-friendly"],
  },
  {
    id: "storyboard.dialogue_blocking.v1",
    version: "v1",
    name: "对白站位调度板",
    status: "active",
    boardMode: "dialogue_blocking",
    recommendedWhen: ["双人/多人对峙", "道具交接", "关系权力变化依赖站位"],
    avoidWhen: ["纯动作追逐", "无人物环境镜头"],
    requiredInputs: ["scriptBlocks", "sceneBlocking", "assetVariantMap", "eyelinePlan"],
    outputContract: ["4-6 格", "轴线/视线", "角色站位变化", "道具流转"],
    promptTemplateId: "storyboard.board.dialogueBlocking",
    qaChecklist: ["180 度轴线清楚", "视线匹配", "道具归属连续", "每格都有价值变化"],
    modelCompatibilityTags: ["dialogue", "blocking", "multi-panel"],
  },
  {
    id: "storyboard.multi_shot_narrative.v1",
    version: "v1",
    name: "多镜头剧情推进板",
    status: "active",
    boardMode: "multi_shot_narrative",
    recommendedWhen: ["普通剧情推进", "一段视频单元内包含 2-5 个镜头节拍", "需要清楚开端和结尾状态"],
    avoidWhen: ["单句对白停顿", "极复杂动作编排"],
    requiredInputs: ["performanceBeats", "shotCandidates", "continuityInOut", "assetReferencePack"],
    outputContract: ["6-9 格", "镜头切换动机", "动作/反应/揭示顺序", "首尾帧"],
    promptTemplateId: "storyboard.board.multiShotNarrative",
    qaChecklist: ["镜头切换有动机", "节拍不抢相邻场景", "首尾状态可接下一段"],
    modelCompatibilityTags: ["multi-shot", "narrative", "storyboard-reference"],
  },
  {
    id: "storyboard.spatial_geography.v1",
    version: "v1",
    name: "空间建立与调度板",
    status: "active",
    boardMode: "spatial_geography",
    recommendedWhen: ["新场景首次建立空间", "人物、出入口、障碍物和行动路线决定后续连续性", "群戏或动作前需要先讲清地理关系"],
    avoidWhen: ["空间已经稳定且只需微表演", "纯道具细节", "不可见空间不影响叙事"],
    requiredInputs: ["locationTopology", "entrancesAndExits", "characterBlocking", "screenDirection", "continuityInOut"],
    outputContract: ["4-8 格", "建立镜头与空间轴线", "出入口/障碍/行动路线", "人物初末站位"],
    promptTemplateId: "storyboard.board.spatialGeography",
    qaChecklist: ["空间拓扑不矛盾", "出入口和屏幕方向清楚", "人物移动路线可执行", "后续镜头能继承轴线"],
    modelCompatibilityTags: ["spatial", "blocking", "multi-panel", "storyboard-reference"],
  },
  {
    id: "storyboard.montage_compression.v1",
    version: "v1",
    name: "蒙太奇与时间压缩板",
    status: "active",
    boardMode: "montage_compression",
    recommendedWhen: ["训练、成长、准备、旅程或调查过程需要压缩时间", "多个动作以共同视觉或声音母题连接", "需要清楚区分省略与连续动作"],
    avoidWhen: ["实时连续动作因果不能省略", "单次对白", "精确攻防编排"],
    requiredInputs: ["timeSpan", "montageBeats", "visualMotif", "soundBridge", "startEndState"],
    outputContract: ["6-12 格", "时间/地点跳跃标记", "视觉或声音连接母题", "起止状态与进展幅度"],
    promptTemplateId: "storyboard.board.montageCompression",
    qaChecklist: ["省略关系可理解", "重复画面确有递进", "时间地点跳跃有标记", "结果与经历的过程相称"],
    modelCompatibilityTags: ["montage", "time-compression", "multi-shot", "rhythm"],
  },
  {
    id: "storyboard.procedural_insert.v1",
    version: "v1",
    name: "程序动作与道具细节板",
    status: "active",
    boardMode: "procedural_insert",
    recommendedWhen: ["开锁、配药、组装、检查证据、操作设备等步骤不能错", "手、道具和界面状态是主要信息", "需要插入特写而不丢失操作者和空间关系"],
    avoidWhen: ["只需要道具身份板", "步骤顺序无关紧要", "高速打斗"],
    requiredInputs: ["procedureSteps", "propStateFlow", "handedness", "insertCoverage", "continuityInOut"],
    outputContract: ["4-10 格", "手与道具状态", "步骤先后", "关键插入特写", "错误/完成状态"],
    promptTemplateId: "storyboard.board.proceduralInsert",
    qaChecklist: ["步骤不能交换", "手和道具不跳变", "特写能回到空间主镜头", "完成状态可验证"],
    modelCompatibilityTags: ["procedural", "insert", "prop-continuity", "multi-panel"],
  },
  {
    id: "storyboard.parallel_intercut.v1",
    version: "v1",
    name: "平行交叉剪辑板",
    status: "active",
    boardMode: "parallel_intercut",
    recommendedWhen: ["两条或多条同时发生的行动线交替推进", "追捕、营救、倒计时或对照叙事", "声音桥或共同事件连接不同空间"],
    avoidWhen: ["单一空间连续动作", "各行动线没有时间或因果关系", "视频模型不支持多镜头单次生成且未拆单元"],
    requiredInputs: ["parallelThreads", "timeRelation", "intercutMotivation", "soundBridge", "threadEndStates"],
    outputContract: ["6-12 格", "行动线分栏/色标", "交叉切换动机", "共同时间点", "各线尾状态"],
    promptTemplateId: "storyboard.board.parallelIntercut",
    qaChecklist: ["行动线不会混人混景", "时间关系清楚", "每次切换都有信息或压力增量", "各线连续性分别闭合"],
    modelCompatibilityTags: ["intercut", "multi-shot", "cross-location", "rhythm"],
  },
  {
    id: "storyboard.subjective_suspense.v1",
    version: "v1",
    name: "主观视角与悬念信息板",
    status: "active",
    boardMode: "subjective_suspense",
    recommendedWhen: ["POV、窥视、梦境、记忆偏差或不可靠感知", "悬念依赖看见/没看见什么", "声音先于画面或画外空间制造压力"],
    avoidWhen: ["需要客观展示全部空间事实", "纯说明性场景", "主观错觉会破坏必须锁定的资产身份"],
    requiredInputs: ["subjectiveOwner", "audienceKnowledge", "occlusionPlan", "offscreenSound", "realityAnchor"],
    outputContract: ["4-8 格", "主客观视角标记", "遮挡/画外信息", "声音先后", "现实锚点与尾部揭示"],
    promptTemplateId: "storyboard.board.subjectiveSuspense",
    qaChecklist: ["主观视角归属清楚", "隐藏信息公平", "声音与画外空间可追溯", "错觉不污染 canonical 资产事实"],
    modelCompatibilityTags: ["subjective", "suspense", "information-control", "multi-panel"],
  },
  {
    id: "storyboard.action_continuity.v1",
    version: "v1",
    name: "动作连续板",
    status: "active",
    boardMode: "action_continuity",
    recommendedWhen: ["追逐", "跌倒", "拔剑", "转身", "爆发", "match-on-action 是关键"],
    avoidWhen: ["静态对白", "纯环境氛围"],
    requiredInputs: ["actionBeats", "screenDirection", "propFlow", "startEndState"],
    outputContract: ["4-12 格，按动作复杂度和视频时长动态取值", "红色动作箭头", "蓝色镜头箭头", "动作承接点"],
    promptTemplateId: "storyboard.board.actionContinuity",
    qaChecklist: ["动作方向一致", "受力/重心合理", "道具不跳变", "首尾帧可衔接"],
    modelCompatibilityTags: ["action", "line-art-control", "multi-panel"],
  },
  {
    id: "storyboard.ai_video_control.v1",
    version: "v1",
    name: "AI 视频控制故事板",
    status: "active",
    boardMode: "ai_video_control",
    recommendedWhen: ["需要把主题内容、场景信息、景别关系、摄影机运动、灯光变化和声音提示一次性交给视频模型", "镜头不一定复杂但模型执行风险高", "需要彩色标注体系控制生成"],
    avoidWhen: ["只需要单张效果图", "纯角色身份板", "没有明确视频单元或时长"],
    requiredInputs: ["performanceBeats", "shotCandidates", "sceneVisualPack", "departmentPrepRefs", "visualStyleLock", "modelProfile"],
    outputContract: ["8-12 格", "红/蓝/绿/橙/紫/黑标注", "主题内容", "场景关系", "镜头运动", "灯光方向", "声音/情绪提示", "首尾状态"],
    promptTemplateId: "storyboard.board.aiVideoControl",
    qaChecklist: ["标注 legend 可读", "每格服务视频控制", "不把资产外貌塞进板面", "时长与模型 profile 匹配", "部门 prep refs 可追溯"],
    modelCompatibilityTags: ["storyboard-reference", "video-control", "multi-panel", "line-art-control"],
  },
  {
    id: "storyboard.fight_choreography.v1",
    version: "v1",
    name: "打斗/仙术动作板",
    status: "active",
    boardMode: "fight_choreography",
    recommendedWhen: ["刀剑交锋", "仙术对撞", "多段攻防", "受击反馈"],
    avoidWhen: ["低成本对白戏", "只需要一个震撼定格"],
    requiredInputs: ["combatants", "weaponOrPowerStates", "spatialAxis", "impactBeats"],
    outputContract: ["12-16 格", "攻防距离", "受击/闪避/反击", "能量方向"],
    promptTemplateId: "storyboard.board.fightChoreography",
    qaChecklist: ["攻防因果清楚", "角色没有瞬移", "能量方向不混乱", "安全空间连续"],
    modelCompatibilityTags: ["fight", "action", "line-art-control"],
  },
  {
    id: "storyboard.dance_choreography.v1",
    version: "v1",
    name: "舞蹈/肢体节奏板",
    status: "active",
    boardMode: "dance_choreography",
    recommendedWhen: ["街舞、霹雳舞、舞台动作、训练动作或强节奏肢体表演", "动作重点是身体动能、重心转移、音乐节拍和连续姿态", "需要表现 headspin、滑步、跳跃、地板动作或连续 pose 变化"],
    avoidWhen: ["静态对白", "纯道具揭示", "只需要最终定格海报"],
    requiredInputs: ["choreographyBeats", "musicOrSoundBeats", "bodyMotionPlan", "cameraRhythm", "safeSpace"],
    outputContract: ["12-20 格", "身体运动轨迹", "镜头运动轨迹", "节拍/音乐标注", "重心变化", "最终定格姿态"],
    promptTemplateId: "storyboard.board.danceChoreography",
    qaChecklist: ["没有静态站姿灌水", "每格有身体动能", "音乐节拍和动作同步", "极端姿势仍可读", "最终 pose 能形成收束"],
    modelCompatibilityTags: ["dance", "rhythm", "action", "line-art-control", "multi-panel"],
  },
  {
    id: "storyboard.rhythm_sheet.v1",
    version: "v1",
    name: "分镜节奏表",
    status: "active",
    boardMode: "rhythm_sheet",
    recommendedWhen: ["一段动作或音乐需要 16-24 格分解", "需要同时看镜头、动作、节奏、光效、状态的时间线", "复杂视频单元要先做导演节奏预演"],
    avoidWhen: ["普通对白场", "单镜头情绪停顿", "模型只支持极短单镜头且不接受多格控制"],
    requiredInputs: ["performanceBeats", "shotRhythm", "motionRhythm", "lightingRhythm", "soundRhythm", "stateRhythm"],
    outputContract: ["16-24 格", "panel 上方镜头信息", "底部节奏轨道", "动作/摄影/灯光/状态曲线", "分镜连贯费用预估依据"],
    promptTemplateId: "storyboard.board.rhythmSheet",
    qaChecklist: ["节奏轨不自相矛盾", "动作曲线可执行", "镜头密度不超模型能力", "每格都有状态推进", "不把节奏表当最终美术图"],
    modelCompatibilityTags: ["rhythm", "multi-panel", "director-previs", "line-art-control"],
  },
  {
    id: "storyboard.emotional_reaction.v1",
    version: "v1",
    name: "情绪反应表演板",
    status: "active",
    boardMode: "emotional_reaction",
    recommendedWhen: ["无对白反应", "关系裂变", "道侣情感", "沉默和停顿比动作重要"],
    avoidWhen: ["快速追逐", "大规模群戏"],
    requiredInputs: ["characterState", "relationshipStage", "microExpressionPlan", "soundCue"],
    outputContract: ["3-5 格", "眼神落点", "呼吸/手部/身体细节", "声音留白"],
    promptTemplateId: "storyboard.board.emotionalReaction",
    qaChecklist: ["情绪被翻译成可见动作", "留白有时长理由", "不靠抽象词支撑画面"],
    modelCompatibilityTags: ["performance", "emotion", "single-shot"],
  },
  {
    id: "storyboard.emotional_performance.v1",
    version: "v1",
    name: "情绪表演推进板",
    status: "active",
    boardMode: "emotional_performance",
    recommendedWhen: ["情绪变化比剧情事件更重要", "需要细分眼神、手部、呼吸、停顿和身体重心", "演员表演指导需要可见微动作"],
    avoidWhen: ["高速动作", "道具/证据揭示为主", "纯环境空镜"],
    requiredInputs: ["emotionArc", "microExpressionPlan", "performanceDirectingRefs", "soundCue", "continuityInOut"],
    outputContract: ["3-5 格", "表情/眼神变化", "手部/呼吸/身体重心", "声音留白", "首尾情绪状态"],
    promptTemplateId: "storyboard.board.emotionalPerformance",
    qaChecklist: ["抽象情绪有可见动作", "表演变化有因果", "不破坏角色设定", "声音/沉默有节奏意义"],
    modelCompatibilityTags: ["performance", "emotion", "single-shot", "actor-directing"],
  },
  {
    id: "storyboard.reveal_twist.v1",
    version: "v1",
    name: "揭示/反转/付费钩子板",
    status: "active",
    boardMode: "reveal_or_twist",
    recommendedWhen: ["证据揭示", "身份反转", "结尾钩子", "观众必须按顺序理解信息"],
    avoidWhen: ["无信息变化的过场", "纯打斗连招"],
    requiredInputs: ["revealObject", "audienceKnowledgeBeforeAfter", "reactionBeats", "cliffhangerState"],
    outputContract: ["4-8 格", "信息露出顺序", "角色反应", "结尾定格"],
    promptTemplateId: "storyboard.board.revealTwist",
    qaChecklist: ["观众理解顺序清晰", "反转物/证据可见", "结尾能牵引下一段"],
    modelCompatibilityTags: ["reveal", "short-drama-hook", "multi-panel"],
  },
  {
    id: "storyboard.effect_reveal.v1",
    version: "v1",
    name: "效果揭示板",
    status: "active",
    boardMode: "effect_reveal",
    recommendedWhen: ["法术、灵纹、发光道具、爆炸、变身、空间异常或 VFX/SFX 逐步显现", "观众必须看懂效果从无到有的阶段", "效果图和故事板需要分开管理"],
    avoidWhen: ["无 VFX/SFX 的普通对白", "只需要资产身份板", "没有明确起止状态"],
    requiredInputs: ["effectStateCycle", "vfxSfxPrep", "lightingPlan", "soundCue", "continuityInOut"],
    outputContract: ["4-8 格", "效果阶段", "光源变化", "受影响物体/角色反应", "声音/情绪提示", "尾帧状态"],
    promptTemplateId: "storyboard.board.effectReveal",
    qaChecklist: ["效果阶段可读", "光源与效果因果一致", "不替换资产身份", "声音和情绪标注清楚", "尾帧可接下一段"],
    modelCompatibilityTags: ["vfx", "effect", "reveal", "line-art-control"],
  },
  {
    id: "storyboard.transition_bridge.v1",
    version: "v1",
    name: "首尾帧转场桥接板",
    status: "active",
    boardMode: "transition_bridge",
    recommendedWhen: ["两个视频单元之间需要承接", "时间/地点转换", "用尾帧接下一段首帧"],
    avoidWhen: ["完整戏剧冲突段", "复杂对白场"],
    requiredInputs: ["previousEndState", "nextStartState", "motionBridge", "lightingBridge"],
    outputContract: ["2-4 格", "首帧", "尾帧", "运动方向", "光线/位置连续"],
    promptTemplateId: "storyboard.board.transitionBridge",
    qaChecklist: ["前后状态不矛盾", "运动方向可接", "转场不偷换资产状态"],
    modelCompatibilityTags: ["transition", "start-end-frame", "bridge"],
  },
  {
    id: "storyboard.interactive_idle_loop.v1",
    version: "v1",
    name: "互动待机循环板",
    status: "active",
    boardMode: "interactive_idle_loop",
    recommendedWhen: ["互动影视节点等待选择", "需要 UI 安全区", "需要默认超时动作"],
    avoidWhen: ["线性短剧正片段落", "不可循环的爆点镜头"],
    requiredInputs: ["nodeState", "choicePrompt", "uiSafeArea", "timeoutDefault"],
    outputContract: ["循环首尾一致", "UI 安全区", "等待微动作", "默认超时承接"],
    promptTemplateId: "storyboard.board.interactiveIdleLoop",
    qaChecklist: ["循环不卡顿", "UI 不遮挡主体", "默认选择可承接", "不替玩家做未选择事件"],
    modelCompatibilityTags: ["interactive", "idle-loop", "ui-safe-area"],
  },
  {
    id: "storyboard.interactive_ui_safe.v1",
    version: "v1",
    name: "互动 UI 安全故事板",
    status: "active",
    boardMode: "interactive_ui_safe",
    recommendedWhen: ["互动影视或游戏节点需要选择按钮、提示卡、状态 UI 或触控热区", "需要同时保护主体表演和 UI 可读", "选择前后会改变变量或结局路径"],
    avoidWhen: ["线性正片段落", "没有 UI/选择层", "纯动作连续板"],
    requiredInputs: ["nodeState", "choiceLayout", "uiSafeArea", "variableState", "timeoutDefault", "continuityInOut"],
    outputContract: ["4-8 格", "UI 安全区", "主体位置", "选择前/后状态", "默认超时", "变量/结局提示"],
    promptTemplateId: "storyboard.board.interactiveUiSafe",
    qaChecklist: ["UI 不遮挡主体", "选择前不替玩家行动", "变量变化可追溯", "首尾状态可循环或可分支"],
    modelCompatibilityTags: ["interactive", "ui-safe-area", "choice", "multi-panel"],
  },
];

export const STORYBOARD_STRATEGY_CAPABILITIES: Record<StoryboardBoardMode, string[]> = {
  single_shot_performance: ["narrative:dialogue", "control:performance", "control:eyeline", "temporal:single_shot"],
  dialogue_blocking: ["narrative:dialogue", "control:performance", "control:blocking", "control:eyeline", "control:prop_continuity", "control:screen_direction"],
  multi_shot_narrative: ["narrative:linear_progression", "control:information_order", "control:continuity", "temporal:multi_shot"],
  spatial_geography: ["narrative:spatial_geography", "control:spatial_topology", "control:blocking", "control:screen_direction", "control:continuity", "temporal:multi_shot"],
  montage_compression: ["narrative:montage", "control:time_compression", "control:sound_rhythm", "temporal:multi_shot"],
  procedural_insert: ["narrative:procedural", "control:prop_continuity", "control:insert_readability", "control:handedness", "temporal:step_sequence"],
  parallel_intercut: ["narrative:parallel_intercut", "control:cross_cut_continuity", "control:information_order", "control:sound_rhythm", "temporal:multi_shot"],
  subjective_suspense: ["narrative:subjective", "narrative:suspense", "control:information_order", "control:offscreen_space", "control:sound_rhythm"],
  action_continuity: ["narrative:action", "control:camera_motion", "control:screen_direction", "control:prop_continuity", "control:continuity", "temporal:multi_shot"],
  fight_choreography: ["narrative:combat", "control:action_choreography", "control:screen_direction", "control:impact", "control:prop_continuity"],
  dance_choreography: ["narrative:dance", "control:body_rhythm", "control:camera_motion", "control:sound_rhythm", "control:safe_space"],
  emotional_reaction: ["narrative:emotion", "control:performance", "control:eyeline", "control:sound_rhythm", "temporal:single_shot"],
  emotional_performance: ["narrative:emotion", "control:performance", "control:micro_expression", "control:sound_rhythm", "temporal:single_shot"],
  reveal_or_twist: ["narrative:reveal", "control:information_order", "control:reaction", "control:prop_continuity"],
  effect_reveal: ["narrative:effect", "control:vfx_state", "control:lighting", "control:impact", "control:continuity"],
  transition_bridge: ["narrative:transition", "control:continuity", "control:camera_motion", "control:lighting", "temporal:bridge"],
  interactive_idle_loop: ["narrative:interactive", "control:loop_closure", "control:ui_safe_area", "control:performance"],
  interactive_ui_safe: ["narrative:interactive", "control:ui_safe_area", "control:choice_state", "control:loop_closure", "control:information_order"],
  ai_video_control: ["control:ai_video", "control:camera_motion", "control:lighting", "control:sound_rhythm", "control:continuity"],
  rhythm_sheet: ["control:rhythm_timeline", "control:camera_motion", "control:sound_rhythm", "control:lighting", "temporal:dense_beats"],
};

/**
 * Narrative/performance grammars define the page. Control overlays only refine
 * that page and must never become the sole layout strategy.
 */
export const STORYBOARD_STRATEGY_COMPOSITION_ROLES: Record<StoryboardBoardMode, StoryboardStrategyCompositionRole> = {
  single_shot_performance: "primary",
  dialogue_blocking: "primary_or_modifier",
  multi_shot_narrative: "primary",
  spatial_geography: "primary_or_modifier",
  montage_compression: "primary",
  procedural_insert: "primary",
  parallel_intercut: "primary",
  subjective_suspense: "primary_or_modifier",
  action_continuity: "primary_or_modifier",
  fight_choreography: "primary",
  dance_choreography: "primary",
  emotional_reaction: "primary_or_modifier",
  emotional_performance: "primary_or_modifier",
  reveal_or_twist: "primary_or_modifier",
  effect_reveal: "primary_or_modifier",
  transition_bridge: "primary_or_modifier",
  interactive_idle_loop: "primary",
  interactive_ui_safe: "modifier",
  ai_video_control: "modifier",
  rhythm_sheet: "modifier",
};

export const getStoryboardStrategyCompositionRole = (strategyId: string) => {
  const strategy = STORYBOARD_PROMPT_STRATEGIES.find((item) => item.id === strategyId);
  return strategy ? STORYBOARD_STRATEGY_COMPOSITION_ROLES[strategy.boardMode] : undefined;
};

export const getStoryboardStrategyCapabilityIds = (strategyId: string) => {
  const strategy = STORYBOARD_PROMPT_STRATEGIES.find((item) => item.id === strategyId);
  return strategy ? STORYBOARD_STRATEGY_CAPABILITIES[strategy.boardMode] || [] : [];
};

export const getStoryboardPromptStrategyById = (strategyId: string) =>
  STORYBOARD_PROMPT_STRATEGIES.find((strategy) => strategy.id === strategyId);

export const getVideoModelProfileById = (profileId: string) =>
  VIDEO_MODEL_PROFILES.find((profile) => profile.id === profileId);

const isPositiveCount = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;

const addScore = (
  recommendation: StoryboardStrategyRecommendation,
  score: number,
  reason: string,
) => {
  recommendation.score += score;
  recommendation.reasons.push(reason);
};

const addCaution = (
  recommendation: StoryboardStrategyRecommendation,
  scorePenalty: number,
  caution: string,
) => {
  recommendation.score -= scorePenalty;
  recommendation.cautions.push(caution);
};

export const recommendStoryboardPromptStrategies = (
  context: StoryboardStrategySelectionContext,
  limit = 3,
): StoryboardStrategyRecommendation[] => {
  const modelProfile = context.modelProfileId ? getVideoModelProfileById(context.modelProfileId) : undefined;
  const dialogueLineCount = context.dialogueLineCount ?? 0;
  const actionBeatCount = context.actionBeatCount ?? 0;
  const combatBeatCount = context.combatBeatCount ?? 0;
  const emotionalBeatCount = context.emotionalBeatCount ?? 0;
  const allowedStrategies = context.availableStrategyIds ? new Set(context.availableStrategyIds) : undefined;

  const recommendations = STORYBOARD_PROMPT_STRATEGIES
    .filter((strategy) => strategy.status === "active")
    .map<StoryboardStrategyRecommendation>((strategy) => ({
      strategyId: strategy.id,
      score: 10,
      reasons: ["active strategy"],
      cautions: [],
    }));

  for (const recommendation of recommendations) {
    const strategy = getStoryboardPromptStrategyById(recommendation.strategyId);
    if (!strategy) continue;

    if (allowedStrategies && !allowedStrategies.has(strategy.id)) {
      addCaution(recommendation, 100, "strategy is not available in this context");
    }

    if (context.interactiveNode) {
      if (strategy.boardMode === "interactive_idle_loop") addScore(recommendation, 100, "interactive node needs a loop-safe board");
      else if (strategy.boardMode === "interactive_ui_safe") addScore(recommendation, 85, "interactive node needs UI-safe layout and choice coverage");
      else addCaution(recommendation, 35, "interactive node should prefer idle-loop or UI-safe strategy");
    }

    if (context.transitionBridge) {
      if (strategy.boardMode === "transition_bridge") addScore(recommendation, 90, "bridge unit needs start/end continuity");
      else addCaution(recommendation, 25, "transition bridge needs explicit start/end state");
    }

    if (combatBeatCount > 0) {
      if (strategy.boardMode === "fight_choreography") addScore(recommendation, 95, "combat beats need attack/defense choreography");
      if (strategy.boardMode === "action_continuity") addScore(recommendation, 25, "action continuity can support simple combat");
      if (["single_shot_performance", "emotional_reaction", "transition_bridge"].includes(strategy.boardMode)) {
        addCaution(recommendation, 60, "combat should not be flattened into a static board");
      }
    }

    if (actionBeatCount > 0 && combatBeatCount === 0) {
      if (strategy.boardMode === "action_continuity") addScore(recommendation, 75, "action beats need motion continuity");
      if (strategy.boardMode === "ai_video_control") addScore(recommendation, 40, "AI video control board can carry action, camera, light, and sound notes");
      if (strategy.boardMode === "dance_choreography") addScore(recommendation, 30, "dance/choreography board can carry body rhythm when action is performance-led");
      if (strategy.boardMode === "rhythm_sheet") addScore(recommendation, 25, "rhythm sheet can expose dense motion and timing");
      if (strategy.boardMode === "multi_shot_narrative") addScore(recommendation, 20, "narrative board can carry simple action");
      if (strategy.boardMode === "single_shot_performance") addCaution(recommendation, 30, "single-shot performance may under-specify action");
    }

    if (dialogueLineCount >= 2 && actionBeatCount <= 1 && combatBeatCount === 0) {
      if (strategy.boardMode === "single_shot_performance") addScore(recommendation, 60, "dialogue-heavy beat can use performance keyframes");
      if (strategy.boardMode === "dialogue_blocking") addScore(recommendation, 55, "dialogue-heavy beat benefits from eyeline/blocking");
      if (strategy.boardMode === "fight_choreography") addCaution(recommendation, 70, "dialogue-heavy beat should not use fight board");
    }

    if (context.requiresDialogueBlocking && strategy.boardMode === "dialogue_blocking") {
      addScore(recommendation, 60, "scene explicitly needs blocking and eyeline control");
    }

    if (emotionalBeatCount > 0 && actionBeatCount === 0 && combatBeatCount === 0) {
      if (strategy.boardMode === "emotional_reaction") addScore(recommendation, 65, "emotional beat needs visible micro-performance");
      if (strategy.boardMode === "emotional_performance") addScore(recommendation, 70, "emotional performance board can carry actor-directing details");
      if (strategy.boardMode === "single_shot_performance") addScore(recommendation, 20, "single-shot board can preserve emotional timing");
    }

    if (context.revealOrTwist) {
      if (strategy.boardMode === "reveal_or_twist") addScore(recommendation, 95, "reveal needs controlled information order");
      if (strategy.boardMode === "effect_reveal") addScore(recommendation, 55, "effect reveal can stage visual state-cycle reveals");
      if (strategy.boardMode === "multi_shot_narrative") addScore(recommendation, 45, "multi-shot narrative can stage reveal order");
      if (["action_continuity", "fight_choreography"].includes(strategy.boardMode)) addCaution(recommendation, 35, "action-first boards can bury reveal information");
    }

    if (context.requiresMultiShot) {
      if (strategy.boardMode === "multi_shot_narrative") addScore(recommendation, 55, "context asks for multi-shot narrative progression");
      if (strategy.boardMode === "single_shot_performance") addCaution(recommendation, 25, "single-shot strategy conflicts with multi-shot request");
    }

    if (modelProfile) {
      if (strategy.modelCompatibilityTags.includes("line-art-control") && !modelProfile.supportsLineArtControl) {
        addCaution(recommendation, 35, "selected model profile does not support line-art control");
      }
      if (strategy.modelCompatibilityTags.includes("multi-shot") && !modelProfile.supportsMultiShotSingleGeneration) {
        addCaution(recommendation, 25, "selected model profile may not support multi-shot single generation");
      }
      if (strategy.modelCompatibilityTags.includes("start-end-frame") && !modelProfile.supportsStartEndFrames) {
        addCaution(recommendation, 25, "selected model profile does not support start/end frames");
      }
      if (context.targetAspectRatio && !modelProfile.aspectRatios.includes(context.targetAspectRatio)) {
        addCaution(recommendation, 20, "target aspect ratio is not supported by selected model profile");
      }
      if (
        typeof context.expectedVideoUnitDurationSeconds === "number" &&
        typeof modelProfile.maxDurationSeconds === "number" &&
        context.expectedVideoUnitDurationSeconds > modelProfile.maxDurationSeconds
      ) {
        addCaution(recommendation, 60, "expected duration exceeds selected model profile");
      }
    }
  }

  return recommendations
    .sort((a, b) => b.score - a.score || a.strategyId.localeCompare(b.strategyId))
    .slice(0, Math.max(1, limit));
};

export const deriveStoryboardRequiredCapabilityIds = (
  context: StoryboardStrategySelectionContext,
) => {
  const required = new Set((context.requiredCapabilityIds || []).filter(Boolean));
  if (context.interactiveNode) {
    required.add("narrative:interactive");
    required.add("control:ui_safe_area");
    required.add("control:loop_closure");
  }
  if (context.transitionBridge) {
    required.add("narrative:transition");
    required.add("control:continuity");
  }
  if ((context.combatBeatCount || 0) > 0) {
    required.add("narrative:combat");
    required.add("control:action_choreography");
    required.add("control:screen_direction");
  } else if ((context.actionBeatCount || 0) > 0) {
    required.add("narrative:action");
    required.add("control:screen_direction");
  }
  if ((context.dialogueLineCount || 0) > 0) {
    required.add("narrative:dialogue");
    required.add("control:performance");
  }
  if (context.requiresDialogueBlocking) {
    required.add("control:blocking");
    required.add("control:eyeline");
  }
  if (
    (context.emotionalBeatCount || 0) > 0
    && (context.actionBeatCount || 0) === 0
    && (context.combatBeatCount || 0) === 0
    && (context.dialogueLineCount || 0) === 0
  ) {
    required.add("narrative:emotion");
    required.add("control:performance");
  }
  if (context.revealOrTwist) {
    required.add("narrative:reveal");
    required.add("control:information_order");
  }
  if (context.requiresMultiShot) required.add("temporal:multi_shot");
  if (required.size === 0) {
    required.add("narrative:linear_progression");
    required.add("control:continuity");
  }
  return Array.from(required);
};

const intersectCapabilities = (left: Iterable<string>, right: Set<string>) =>
  Array.from(new Set(left)).filter((item) => right.has(item));

/**
 * Resolves common cases to a preset and mixed cases to one primary layout plus
 * at most two modifier strategies. It never invents a global strategy or loops.
 */
export const resolveStoryboardStrategyCoverage = (
  context: StoryboardStrategySelectionContext,
): StoryboardStrategyResolution => {
  const requiredCapabilityIds = deriveStoryboardRequiredCapabilityIds(context);
  const required = new Set(requiredCapabilityIds);
  const explicitlyRequired = new Set((context.requiredCapabilityIds || []).filter(Boolean));
  const recommendations = recommendStoryboardPromptStrategies(
    context,
    STORYBOARD_PROMPT_STRATEGIES.length,
  );
  const ranked = recommendations
    .map((recommendation) => {
      const capabilityIds = getStoryboardStrategyCapabilityIds(recommendation.strategyId);
      const coverage = intersectCapabilities(capabilityIds, required);
      return { ...recommendation, capabilityIds, coverage };
    })
    .sort((a, b) => b.coverage.length - a.coverage.length || b.score - a.score || a.strategyId.localeCompare(b.strategyId));
  const primaryCandidates = ranked.filter((item) => getStoryboardStrategyCompositionRole(item.strategyId) !== "modifier");
  const modifierCandidates = ranked.filter((item) => getStoryboardStrategyCompositionRole(item.strategyId) !== "primary");
  const recipes = primaryCandidates.flatMap((primary) => {
    const availableModifiers = modifierCandidates.filter((item) => item.strategyId !== primary.strategyId);
    const modifierSets = [
      [] as typeof availableModifiers,
      ...availableModifiers.map((item) => [item]),
      ...availableModifiers.flatMap((left, leftIndex) => availableModifiers
        .slice(leftIndex + 1)
        .map((right) => [left, right])),
    ];
    return modifierSets.map((modifiers) => {
      const covered = new Set([
        ...primary.coverage,
        ...modifiers.flatMap((item) => item.coverage),
      ]);
      return {
        primary,
        modifiers,
        covered,
        coverageCount: covered.size,
        primaryExplicitCoverageCount: intersectCapabilities(primary.capabilityIds, explicitlyRequired).length,
        recommendationScore: primary.score + modifiers.reduce((sum, item) => sum + item.score, 0),
      };
    });
  });
  const bestRecipe = recipes.sort((left, right) =>
    right.coverageCount - left.coverageCount
    || right.primaryExplicitCoverageCount - left.primaryExplicitCoverageCount
    || left.modifiers.length - right.modifiers.length
    || right.recommendationScore - left.recommendationScore
    || left.primary.strategyId.localeCompare(right.primary.strategyId)
    || left.modifiers.map((item) => item.strategyId).join("|").localeCompare(right.modifiers.map((item) => item.strategyId).join("|"))
  )[0];
  const fallbackPrimary = ranked.find((item) => item.strategyId === "storyboard.multi_shot_narrative.v1") || ranked[0];
  const primary = bestRecipe?.primary || fallbackPrimary;
  const covered = bestRecipe?.covered || new Set(primary?.coverage || []);
  const modifierStrategyIds = bestRecipe?.modifiers.map((item) => item.strategyId) || [];

  const coveredCapabilityIds = requiredCapabilityIds.filter((item) => covered.has(item));
  const uncoveredCapabilityIds = requiredCapabilityIds.filter((item) => !covered.has(item));
  const mode: StoryboardStrategyResolutionMode = uncoveredCapabilityIds.length
    ? "project_local_draft_required"
    : modifierStrategyIds.length
      ? "composed_recipe"
      : "built_in_preset";
  return {
    mode,
    primaryStrategyId: primary.strategyId,
    modifierStrategyIds,
    requiredCapabilityIds,
    coveredCapabilityIds,
    uncoveredCapabilityIds,
    fallbackStrategyId: primary.strategyId,
    confidence: requiredCapabilityIds.length
      ? Math.round((coveredCapabilityIds.length / requiredCapabilityIds.length) * 100) / 100
      : 1,
    requiresHumanApproval: mode === "project_local_draft_required",
    maxAutomaticRevisionAttempts: 1,
  };
};

export const validateStoryboardStrategyDecision = (
  decision: Partial<StoryboardStrategyDecision>,
  context: StoryboardStrategySelectionContext = {},
): StoryboardStrategySelectionIssue[] => {
  const issues: StoryboardStrategySelectionIssue[] = [];
  const strategy = decision.selectedStrategyId ? getStoryboardPromptStrategyById(decision.selectedStrategyId) : undefined;
  const modelProfile = decision.selectedModelProfileId ? getVideoModelProfileById(decision.selectedModelProfileId) : undefined;
  const legendIds = new Set(STORYBOARD_ARROW_LEGEND.map((entry) => entry.id));

  for (const field of STORYBOARD_STRATEGY_DECISION_REQUIRED_FIELDS) {
    const value = decision[field];
    const missingArray = Array.isArray(value) && value.length === 0;
    if (value === undefined || value === null || value === "" || missingArray) {
      issues.push({
        severity: "blocking",
        code: "MISSING_DECISION_FIELD",
        field,
        message: `StoryboardStrategyDecision 缺少必填字段：${field}`,
      });
    }
  }

  if (!strategy) {
    issues.push({
      severity: "blocking",
      code: "UNKNOWN_STRATEGY",
      field: "selectedStrategyId",
      message: `未知故事板策略：${decision.selectedStrategyId ?? "(empty)"}`,
    });
  } else {
    if (strategy.status !== "active") {
      issues.push({
        severity: "blocking",
        code: "INACTIVE_STRATEGY",
        field: "selectedStrategyId",
        message: `故事板策略不是 active：${strategy.id}`,
      });
    }
    if (decision.selectedStrategyVersion && decision.selectedStrategyVersion !== strategy.version) {
      issues.push({
        severity: "blocking",
        code: "STRATEGY_VERSION_MISMATCH",
        field: "selectedStrategyVersion",
        message: `策略版本不匹配：选择 ${decision.selectedStrategyVersion}，当前 ${strategy.version}`,
      });
    }
    if (getStoryboardStrategyCompositionRole(strategy.id) === "modifier") {
      issues.push({
        severity: "blocking",
        code: "MODIFIER_USED_AS_PRIMARY_STRATEGY",
        field: "selectedStrategyId",
        message: `${strategy.name} 是控制修饰器，不能单独决定整张故事板版式；必须先选择叙事或表演主策略。`,
      });
    }
  }

  const resolution = decision.strategyResolution;
  if (context.requiredCapabilityIds?.length && !resolution) {
    issues.push({
      severity: "blocking",
      code: "STRATEGY_CAPABILITY_RESOLUTION_MISSING",
      field: "strategyResolution",
      message: "当前视频单元声明了结构化能力需求，必须保存策略覆盖决策，不能只凭策略名称推进。",
    });
  }
  if (resolution) {
    if (resolution.primaryStrategyId !== decision.selectedStrategyId) {
      issues.push({
        severity: "blocking",
        code: "STRATEGY_PRIMARY_MISMATCH",
        field: "strategyResolution.primaryStrategyId",
        message: "策略覆盖决策的 primaryStrategyId 必须与 selectedStrategyId 一致。",
      });
    }
    if (resolution.modifierStrategyIds.length > 2) {
      issues.push({
        severity: "blocking",
        code: "STRATEGY_MODIFIER_LIMIT_EXCEEDED",
        field: "strategyResolution.modifierStrategyIds",
        message: "一个故事板配方最多允许两个修饰策略；超过时应拆分视频单元，而不是堆叠万能 Prompt。",
      });
    }
    for (const modifierStrategyId of resolution.modifierStrategyIds) {
      const modifierStrategy = getStoryboardPromptStrategyById(modifierStrategyId);
      if (!modifierStrategy) {
        issues.push({
          severity: "blocking",
          code: "UNKNOWN_MODIFIER_STRATEGY",
          field: "strategyResolution.modifierStrategyIds",
          message: `未知故事板修饰策略：${modifierStrategyId}`,
        });
      } else if (getStoryboardStrategyCompositionRole(modifierStrategyId) === "primary") {
        issues.push({
          severity: "blocking",
          code: "PRIMARY_ONLY_STRATEGY_USED_AS_MODIFIER",
          field: "strategyResolution.modifierStrategyIds",
          message: `${modifierStrategy.name} 只能作为主版式；若它也不可缺少，应拆分视频单元，而不是把两个完整板型叠在一起。`,
        });
      }
    }
    if (resolution.maxAutomaticRevisionAttempts !== 1) {
      issues.push({
        severity: "blocking",
        code: "STRATEGY_REVISION_BUDGET_INVALID",
        field: "strategyResolution.maxAutomaticRevisionAttempts",
        message: "策略适配最多自动修订一次；失败后必须使用 fallback 或交给创作者决定，禁止无限循环。",
      });
    }
    if (resolution.uncoveredCapabilityIds.length > 0 || resolution.mode === "project_local_draft_required") {
      issues.push({
        severity: "blocking",
        code: "STORYBOARD_STRATEGY_GAP_UNRESOLVED",
        field: "strategyResolution.uncoveredCapabilityIds",
        message: `内置策略配方仍缺少能力：${resolution.uncoveredCapabilityIds.join("、") || "未说明"}。先做项目级草案小样，或使用 fallbackStrategyId，不得直接进入正式整板生成。`,
      });
    }
  }

  if (!modelProfile) {
    issues.push({
      severity: "blocking",
      code: "UNKNOWN_MODEL_PROFILE",
      field: "selectedModelProfileId",
      message: `未知视频模型 profile：${decision.selectedModelProfileId ?? "(empty)"}`,
    });
  }

  if (decision.rationale && decision.rationale.trim().length < 24) {
    issues.push({
      severity: "blocking",
      code: "RATIONALE_TOO_THIN",
      field: "rationale",
      message: "策略选择理由太短，无法审计剧情、表演、连续性和模型适配。",
    });
  }

  if (decision.expectedVideoUnitDurationSeconds !== undefined) {
    if (!isPositiveCount(decision.expectedVideoUnitDurationSeconds) || decision.expectedVideoUnitDurationSeconds === 0) {
      issues.push({
        severity: "blocking",
        code: "INVALID_DURATION",
        field: "expectedVideoUnitDurationSeconds",
        message: "视频单元预计时长必须是正数。",
      });
    } else if (modelProfile) {
      if (
        typeof modelProfile.minDurationSeconds === "number" &&
        decision.expectedVideoUnitDurationSeconds < modelProfile.minDurationSeconds
      ) {
        issues.push({
          severity: "blocking",
          code: "DURATION_BELOW_MODEL_MIN",
          field: "expectedVideoUnitDurationSeconds",
          message: `视频单元时长 ${decision.expectedVideoUnitDurationSeconds}s 低于模型 profile 最小时长 ${modelProfile.minDurationSeconds}s。`,
        });
      }
      if (
        typeof modelProfile.maxDurationSeconds === "number" &&
        decision.expectedVideoUnitDurationSeconds > modelProfile.maxDurationSeconds
      ) {
        issues.push({
          severity: "blocking",
          code: "DURATION_EXCEEDS_MODEL_MAX",
          field: "expectedVideoUnitDurationSeconds",
          message: `视频单元时长 ${decision.expectedVideoUnitDurationSeconds}s 超过模型 profile 最大时长 ${modelProfile.maxDurationSeconds}s。`,
        });
      }
    }
  }

  if (decision.expectedReferenceImageCount !== undefined && !isPositiveCount(decision.expectedReferenceImageCount)) {
    issues.push({
      severity: "blocking",
      code: "INVALID_REFERENCE_IMAGE_COUNT",
      field: "expectedReferenceImageCount",
      message: "参考图数量必须是非负数。",
    });
  }
  if (
    modelProfile &&
    !modelProfile.supportsReferenceImages &&
    typeof decision.expectedReferenceImageCount === "number" &&
    decision.expectedReferenceImageCount > 0
  ) {
    issues.push({
      severity: "blocking",
      code: "REFERENCE_IMAGES_UNSUPPORTED",
      field: "expectedReferenceImageCount",
      message: "所选模型 profile 不支持参考图，但决策要求使用参考图。",
    });
  }
  if (
    modelProfile &&
    typeof modelProfile.maxReferenceImages === "number" &&
    typeof decision.expectedReferenceImageCount === "number" &&
    decision.expectedReferenceImageCount > modelProfile.maxReferenceImages
  ) {
    issues.push({
      severity: "blocking",
      code: "REFERENCE_IMAGES_EXCEED_MODEL_MAX",
      field: "expectedReferenceImageCount",
      message: `参考图数量 ${decision.expectedReferenceImageCount} 超过模型 profile 上限 ${modelProfile.maxReferenceImages}。`,
    });
  }

  if (decision.expectedReferenceVideoCount !== undefined && !isPositiveCount(decision.expectedReferenceVideoCount)) {
    issues.push({
      severity: "blocking",
      code: "INVALID_REFERENCE_VIDEO_COUNT",
      field: "expectedReferenceVideoCount",
      message: "参考视频数量必须是非负数。",
    });
  }
  if (
    modelProfile &&
    !modelProfile.supportsReferenceVideos &&
    typeof decision.expectedReferenceVideoCount === "number" &&
    decision.expectedReferenceVideoCount > 0
  ) {
    issues.push({
      severity: "blocking",
      code: "REFERENCE_VIDEOS_UNSUPPORTED",
      field: "expectedReferenceVideoCount",
      message: "所选模型 profile 不支持参考视频，但决策要求使用参考视频。",
    });
  }
  if (
    modelProfile &&
    typeof modelProfile.maxReferenceVideos === "number" &&
    typeof decision.expectedReferenceVideoCount === "number" &&
    decision.expectedReferenceVideoCount > modelProfile.maxReferenceVideos
  ) {
    issues.push({
      severity: "blocking",
      code: "REFERENCE_VIDEOS_EXCEED_MODEL_MAX",
      field: "expectedReferenceVideoCount",
      message: `参考视频数量 ${decision.expectedReferenceVideoCount} 超过模型 profile 上限 ${modelProfile.maxReferenceVideos}。`,
    });
  }

  if (decision.arrowLegendIds) {
    for (const arrowLegendId of decision.arrowLegendIds) {
      if (!legendIds.has(arrowLegendId)) {
        issues.push({
          severity: "blocking",
          code: "UNKNOWN_ARROW_LEGEND",
          field: "arrowLegendIds",
          message: `未知线稿箭头 legend：${arrowLegendId}`,
        });
      }
    }
    for (const requiredLegendId of ["subject_action_red", "camera_motion_blue"]) {
      if (!decision.arrowLegendIds.includes(requiredLegendId)) {
        issues.push({
          severity: "blocking",
          code: "MISSING_CORE_ARROW_LEGEND",
          field: "arrowLegendIds",
          message: `线稿故事板选择缺少核心箭头 legend：${requiredLegendId}`,
        });
      }
    }
  }

  if (!strategy) return issues;

  const appliedStrategies = [
    strategy,
    ...(resolution?.modifierStrategyIds || [])
      .map((strategyId) => getStoryboardPromptStrategyById(strategyId))
      .filter((item): item is StoryboardPromptStrategy => Boolean(item)),
  ];
  const appliedCapabilityIds = new Set(
    appliedStrategies.flatMap((item) => getStoryboardStrategyCapabilityIds(item.id)),
  );
  const recipeCovers = (capabilityId: string) => appliedCapabilityIds.has(capabilityId);

  const dialogueLineCount = context.dialogueLineCount ?? 0;
  const actionBeatCount = context.actionBeatCount ?? 0;
  const combatBeatCount = context.combatBeatCount ?? 0;

  if (
    dialogueLineCount >= 2 &&
    actionBeatCount <= 1 &&
    combatBeatCount === 0 &&
    ["fight_choreography", "action_continuity"].includes(strategy.boardMode) &&
    !recipeCovers("narrative:dialogue")
  ) {
    issues.push({
      severity: "blocking",
      code: "DIALOGUE_OVERCOMPLICATED_AS_ACTION",
      field: "selectedStrategyId",
      message: "单镜头/对白为主的表演段不应误选动作或打斗故事板。",
    });
  }

  if (
    combatBeatCount > 0 &&
    (!recipeCovers("narrative:combat") || !recipeCovers("control:action_choreography"))
  ) {
    issues.push({
      severity: "blocking",
      code: "COMBAT_UNDER_SPECIFIED",
      field: "selectedStrategyId",
      message: "打斗或仙术攻防段不能压成单镜头表演、情绪反应或转场板。",
    });
  }

  if (
    actionBeatCount >= 2
    && !recipeCovers("narrative:action")
    && !recipeCovers("narrative:combat")
  ) {
    issues.push({
      severity: "blocking",
      code: "ACTION_UNDER_SPECIFIED",
      field: "selectedStrategyId",
      message: "多动作节拍需要动作连续或多镜头叙事策略，不能只用表演板。",
    });
  }

  if (context.transitionBridge && !recipeCovers("narrative:transition")) {
    issues.push({
      severity: "blocking",
      code: "TRANSITION_STRATEGY_MISMATCH",
      field: "selectedStrategyId",
      message: "转场桥接段必须选择首尾帧转场桥接策略。",
    });
  }

  if (
    context.interactiveNode
    && (!recipeCovers("narrative:interactive")
      || !recipeCovers("control:loop_closure")
      || !recipeCovers("control:ui_safe_area"))
  ) {
    issues.push({
      severity: "blocking",
      code: "INTERACTIVE_LOOP_STRATEGY_MISMATCH",
      field: "selectedStrategyId",
      message: "互动待机节点必须选择可循环、UI 安全区明确的互动待机策略。",
    });
  }

  if (context.revealOrTwist && !recipeCovers("narrative:reveal")) {
    issues.push({
      severity: "warning",
      code: "REVEAL_STRATEGY_WEAK",
      field: "selectedStrategyId",
      message: "揭示/反转段通常需要揭示板或多镜头叙事板，当前策略需要额外说明信息露出顺序。",
    });
  }

  if (context.requiresMultiShot && !recipeCovers("temporal:multi_shot")) {
    issues.push({
      severity: "blocking",
      code: "MULTI_SHOT_REQUIRED",
      field: "selectedStrategyId",
      message: "上下文要求多镜头推进时，不能选择单镜头表演板。",
    });
  }

  return issues;
};

export const buildVideoStoryboardSystem = () => ({
  status: "configuration_and_strategy_registry_available",
  nonDisruptivePolicy: "This system is a stage-internal enhancement for asset_detail, script, asset_sync, storyboard, prompt, and expensive_generation_planning. It must not replace existing shots or change canonical workflow stage order.",
  promptMutationPolicy: "Storyboard strategies reference versioned prompt templates. Update prompts/configuration first; change TypeScript only when schema, QA, or workflow contracts change.",
  imageModelProfiles: IMAGE_MODEL_PROFILES,
  videoModelProfiles: VIDEO_MODEL_PROFILES,
  arrowLegend: STORYBOARD_ARROW_LEGEND,
  promptStrategies: STORYBOARD_PROMPT_STRATEGIES,
  strategyArchitecture: {
    schemaVersion: "storyboard-strategy-architecture.v2",
    principle: "Choose one primary layout preset, add at most two orthogonal control modifiers, and keep the final deliverable as one composite storyboard image per page.",
    capabilityProfiles: STORYBOARD_STRATEGY_CAPABILITIES,
    compositionRoles: STORYBOARD_STRATEGY_COMPOSITION_ROLES,
    resolutionFunction: "resolveStoryboardStrategyCoverage",
    selectionAlgorithm: "Evaluate every allowed one-primary/zero-to-two-modifier recipe, maximize total capability coverage, then prefer a primary that carries explicit structured requirements before recommendation score and recipe size.",
    modes: ["built_in_preset", "composed_recipe", "project_local_draft_required"],
    automaticRevisionBudget: 1,
    noFitPolicy: [
      "derive structured capability requirements before choosing a strategy",
      "evaluate all allowed built-in recipes with one primary and at most two modifiers instead of using a fixed mode priority",
      "if capabilities remain uncovered, create one project-local draft and run one bounded sample trial",
      "if the trial fails, use fallbackStrategyId or request a creator decision; never loop or mutate the global catalog automatically",
    ],
  },
  strategyCreationPolicy: {
    defaultBehavior: "Producer AI must choose from built-in active strategies first.",
    allowProjectLocalDrafts: true,
    draftArtifactKind: "storyboard_strategy_draft",
    requiredWhenNoFit: [
      "inspect built-in promptStrategies and quote the closest strategy ids",
      "state why each close built-in strategy fails for this scene or video unit",
      "create a storyboard_strategy_draft with inheritsFromStrategyIds and fallbackStrategyId",
      "run validateStoryboardStrategyDraft before using it",
      "keep the draft project-local until sample QA proves it should be promoted",
    ],
    forbiddenShortcut: "Do not ask the model to simply create 'a storyboard', stack more than two modifiers, or repeatedly invent strategies without a bounded sample trial, fallback, and creator decision.",
  },
  assetBoardStrategies: [
    {
      id: "assetBoard.characterIdentity.artbook.v1",
      assetTypes: ["character"],
      purpose: "生成制作级角色身份板，锁定脸、身体比例、发型、服装、姿态语言、表情范围、轮廓和细节研究。",
      stylePolicy: "layout-only; rendering style must come from project.visualStyleLock, creativeVision, universalSkillRefs, or globalGenerationParams",
    },
    {
      id: "assetBoard.variantDelta.stateLock.v1",
      assetTypes: ["character", "location", "prop"],
      purpose: "生成变体差异板，只表达换装、妆发、伤势、血迹、破损、激活、损毁或使用状态变化，不改变 canonical 身份。",
      stylePolicy: "inherits the base asset board style lock; variant prompt may not introduce a conflicting medium or aesthetic",
    },
    {
      id: "assetBoard.propIdentity.production.v1",
      assetTypes: ["prop"],
      purpose: "生成道具/装备身份板，锁定外形、尺寸、材质、持握方式、交互部件和状态变化。",
      stylePolicy: "layout-only; style follows the project style lock",
    },
    {
      id: "assetBoard.locationSetIdentity.production.v1",
      assetTypes: ["location"],
      purpose: "生成场景/置景身份板，锁定空间结构、入口出口、可拍机位、光线方向、关键陈设和状态变体。",
      stylePolicy: "layout-only; style follows the project style lock",
    },
    {
      id: "assetBoard.wardrobeMakeup.continuity.v1",
      assetTypes: ["wardrobe_makeup"],
      purpose: "生成服装/妆发连续性板，锁定基础 look、穿脱层级、材质、发型、妆面、伤痕、污损、湿度和场次状态差异。",
      stylePolicy: "layout-only; style follows the project style lock and scene-specific variants must keep character identity stable",
    },
    {
      id: "assetBoard.vfxSfx.stateCycle.v1",
      assetTypes: ["vfx_sfx", "vehicle", "creature"],
      purpose: "生成 VFX/SFX、车辆或生物状态板，锁定结构、比例参照、运动方式、发光/破损/变形阶段和可生成状态帧。",
      stylePolicy: "layout-only; state-cycle rendering follows the project style lock and may not invent a new medium",
    },
  ],
  assetBoardStyleLockPolicy: {
    sourcePriority: [
      "project.visualStyleLock",
      "project.creativeVision.visualStyle/globalLook",
      "project.universalSkillRefs universal Skill content",
      "project.globalGenerationParams",
      "project.originalStyleReference",
    ],
    rule: "Asset board templates define production layout and identity-locking requirements only. Photoreal, cartoon, 3D, anime, comic, ink, clay, pixel, or other rendering styles must be injected from project style settings.",
  },
  storyboardAnnotationPolicy: {
    defaultLegendIds: STORYBOARD_ARROW_LEGEND.map((entry) => entry.id),
    colorSemantics: {
      red: "body/action/prop motion",
      blue: "camera/frame motion",
      green: "eyeline, attention, composition, framing notes",
      orange: "lighting, energy, impact, VFX direction",
      purple: "sound, music beat, dialogue stress, emotional emphasis",
      black: "panel number, shot note, duration, lens note",
    },
    rule: "Legend meaning is configurable through visualStyleLock.annotationLegend, but a board must carry the legend ids it uses and cannot invent untracked colors.",
  },
  assetBoardProductionGate: {
    defaultReadiness: "development_only",
    formalReadyRequires: [
      "approved script_lock_package or approved content_lock_package",
      "locked production_block_lock",
      "production_breakdown_report with locked scene/node matrix",
      "casting_requirement for formal character needs",
      "approved casting_decision for formal character identity boards",
      "department_prep_package for wardrobe, props, locations, continuity, VFX/SFX, sound, extras, or stunts",
    ],
    blockedIssueCode: "FORMAL_ASSET_BOARD_LOCK_MISSING",
    developmentWarningCode: "ASSET_BOARD_DEVELOPMENT_ONLY",
    rule: "asset_board_plan may exist during asset_detail as a style-locked development identity direction. It is not a formal production asset board unless formalAssetIntent=true and productionReadiness=formal_ready.",
  },
  selectionProtocol: {
    producerChoosesStrategy: true,
    userDoesNotNeedToChooseEveryTemplate: true,
    strategySelectionPromptTemplateId: "storyboard.strategy.select",
    requiredDecisionFields: STORYBOARD_STRATEGY_DECISION_REQUIRED_FIELDS,
    qaMustRejectWhen: [
      "single-shot dialogue is forced into a fight/action board",
      "fight/action choreography is reduced to an atmosphere still",
      "duration exceeds the selected model profile",
      "reference image/video counts exceed the selected model profile",
      "arrow legend is missing or conflicts with the selected strategy",
      "rationale does not explain story, performance, continuity, and model fit",
    ],
    qaContract: {
      decisionArtifact: "StoryboardStrategyDecision",
      qaFunction: "validateStoryboardStrategyDecision",
      recommendationFunction: "recommendStoryboardPromptStrategies",
      blockingIssueCodes: [
        "MISSING_DECISION_FIELD",
        "UNKNOWN_STRATEGY",
        "UNKNOWN_MODEL_PROFILE",
        "DURATION_EXCEEDS_MODEL_MAX",
        "REFERENCE_IMAGES_EXCEED_MODEL_MAX",
        "REFERENCE_VIDEOS_EXCEED_MODEL_MAX",
        "REFERENCE_IMAGES_UNSUPPORTED",
        "REFERENCE_VIDEOS_UNSUPPORTED",
        "DIALOGUE_OVERCOMPLICATED_AS_ACTION",
        "COMBAT_UNDER_SPECIFIED",
        "ACTION_UNDER_SPECIFIED",
        "TRANSITION_STRATEGY_MISMATCH",
        "INTERACTIVE_LOOP_STRATEGY_MISMATCH",
      ],
    },
  },
  stageIntegration: {
    asset_detail: "prepare style-locked development asset board directions only; formal asset boards require script/content lock, production breakdown, casting requirements, approved casting decisions, department prep, and stable existing/planned asset refs",
    script: "add performanceBeats beside scriptBlocks without replacing scriptBlocks",
    asset_sync: "create or update asset variants needed by locked breakdown/prep facts, then derive reusable scene_visual_pack drafts scoped by production_breakdown_report when formal",
    storyboard: "choose a StoryboardPromptStrategy, plan StoryboardBoard artifacts, and keep shot-level storyboards intact",
    prompt: "assemble clean model-specific video input packs from boards, asset references, and video units",
    expensive_generation_planning: "schedule video generation by model profile, input readiness, and media risk",
  },
  stageArtifacts: {
    asset_detail: {
      artifactType: "asset_board_plan",
      targetPath: "project.videoStoryboardAssetBoardPlan",
      sourceOfTruth: "development identity directions come from project.characters/assets/variants and planned character/location/prop refs; formal asset boards require script/content lock, production_breakdown_report, casting_requirement, approved casting_decision, department_prep_package, and stable asset refs",
      qaFunction: "validateVideoStoryboardAssetBoardPlan",
    },
    script: {
      artifactType: "performance_beats",
      targetPath: "run.outputSnapshot.performanceBeatDrafts",
      sourceOfTruth: "episode.scenes.scriptBlocks and scene.breakdown remain the canonical script source",
      qaFunction: "validatePerformanceBeats",
    },
    asset_sync: {
      artifactType: "scene_visual_pack",
      targetPath: "run.outputSnapshot.sceneVisualPackDrafts",
      sourceOfTruth: "formal packs are scoped by production_breakdown_report and department_prep_package, then projected through asset_board_plan, asset-continuity, scene.breakdown, variants, and script/shots",
      qaFunction: "validateSceneVisualPack",
    },
    storyboard: {
      artifactType: "storyboard_board",
      targetPath: "run.outputSnapshot.storyboardBoardDrafts",
      sourceOfTruth: "episode.scenes.shots remain the canonical shot source",
      qaFunction: "validateStoryboardBoard",
    },
    prompt: {
      artifactType: "asset_reference_pack",
      targetPath: "run.outputSnapshot.assetReferencePackDrafts",
      sourceOfTruth: "project.characters, project.assets, variants, and episode.scenes.shots remain canonical",
      qaFunction: "validateAssetReferencePack",
    },
    expensive_generation_planning: {
      artifactType: "video_generation_unit",
      targetPath: "run.outputSnapshot.videoGenerationUnitDrafts",
      sourceOfTruth: "storyboard_board, asset_reference_pack, shot prompts, and model profiles remain canonical",
      qaFunction: "validateVideoGenerationUnit",
    },
  },
});

export const validateVideoStoryboardSystem = () => {
  const issues: string[] = [];
  const strategyIds = new Set<string>();
  const templateIds = new Set(Object.keys(defaultTemplates));

  if (STORYBOARD_PROMPT_STRATEGIES.filter((strategy) => strategy.status === "active").length < 6) {
    issues.push("至少需要 6 套 active 故事板提示词策略。");
  }
  if (!STORYBOARD_ARROW_LEGEND.some((entry) => entry.id === "subject_action_red")) {
    issues.push("线稿故事板 legend 缺少红色动作箭头。");
  }
  if (!STORYBOARD_ARROW_LEGEND.some((entry) => entry.id === "camera_motion_blue")) {
    issues.push("线稿故事板 legend 缺少蓝色镜头箭头。");
  }
  if (!VIDEO_MODEL_PROFILES.some((profile) => profile.supportsStoryboardReference)) {
    issues.push("至少需要一个支持故事板参考的视频模型 profile。");
  }
  if (!IMAGE_MODEL_PROFILES.some((profile) => profile.supportsLineArtControl)) {
    issues.push("至少需要一个支持线稿控制图的图像模型 profile。");
  }

  for (const strategy of STORYBOARD_PROMPT_STRATEGIES) {
    if (strategyIds.has(strategy.id)) issues.push(`故事板策略 ID 重复：${strategy.id}`);
    strategyIds.add(strategy.id);
    if (!strategy.recommendedWhen.length) issues.push(`策略 ${strategy.id} 缺少 recommendedWhen。`);
    if (!strategy.requiredInputs.length) issues.push(`策略 ${strategy.id} 缺少 requiredInputs。`);
    if (!strategy.outputContract.length) issues.push(`策略 ${strategy.id} 缺少 outputContract。`);
    if (!strategy.qaChecklist.length) issues.push(`策略 ${strategy.id} 缺少 qaChecklist。`);
    if (!templateIds.has(strategy.promptTemplateId)) {
      issues.push(`策略 ${strategy.id} 引用的 prompt 模板不存在：${strategy.promptTemplateId}`);
    }
  }

  return issues;
};
