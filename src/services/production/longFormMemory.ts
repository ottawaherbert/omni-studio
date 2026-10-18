import type { Episode, LongFormMemoryPhase, LongFormProductionMemory, Project } from "../../types/project";
import type { ProductionQAIssue } from "../../types/production";
import { buildAssetContinuityContext, type AssetContinuityContext } from "./assetContinuity";

export type LongFormMemoryTaskProfile =
  | "outline"
  | "episode"
  | "scene"
  | "script"
  | "storyboard"
  | "visual_prompt"
  | "operator"
  | "default";

export interface LongFormMemoryWindowPolicy {
  profile: LongFormMemoryTaskProfile;
  exactEpisodeRadius: number;
  nearEpisodeRadius: number;
  includeSceneDetails: boolean;
  includeShotDetails: boolean;
  includeAssetLedger: boolean;
  includePhaseLedger: boolean;
  includeForbiddenContradictions: boolean;
  maxEpisodeSummaryChars: number;
  maxSceneSummaryChars: number;
  maxShotCount: number;
  rationale: string;
}

export const LONG_FORM_MEMORY_WINDOW_POLICIES: Record<LongFormMemoryTaskProfile, LongFormMemoryWindowPolicy> = {
  outline: {
    profile: "outline",
    exactEpisodeRadius: 0,
    nearEpisodeRadius: 3,
    includeSceneDetails: false,
    includeShotDetails: false,
    includeAssetLedger: true,
    includePhaseLedger: true,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 360,
    maxSceneSummaryChars: 0,
    maxShotCount: 0,
    rationale: "大纲阶段重在全局骨架、阶段承诺、近邻分集走向和伏笔偿付，不需要分镜细节。",
  },
  episode: {
    profile: "episode",
    exactEpisodeRadius: 1,
    nearEpisodeRadius: 2,
    includeSceneDetails: true,
    includeShotDetails: false,
    includeAssetLedger: true,
    includePhaseLedger: true,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 420,
    maxSceneSummaryChars: 180,
    maxShotCount: 0,
    rationale: "重写/续写单集需要前后集具体梗概和当前集场景状态，但不应注入大量镜头造成干扰。",
  },
  scene: {
    profile: "scene",
    exactEpisodeRadius: 1,
    nearEpisodeRadius: 2,
    includeSceneDetails: true,
    includeShotDetails: false,
    includeAssetLedger: true,
    includePhaseLedger: true,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 340,
    maxSceneSummaryChars: 220,
    maxShotCount: 0,
    rationale: "拆场景需要当前/近邻集的价值变化、角色和资产状态，避免只凭当前一集拆出断裂场次。",
  },
  script: {
    profile: "script",
    exactEpisodeRadius: 1,
    nearEpisodeRadius: 1,
    includeSceneDetails: true,
    includeShotDetails: false,
    includeAssetLedger: true,
    includePhaseLedger: true,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 300,
    maxSceneSummaryChars: 260,
    maxShotCount: 0,
    rationale: "剧本阶段优先保留当前集/当前场细节、前后场承接和人物声线，远期剧情只用压缩台账。",
  },
  storyboard: {
    profile: "storyboard",
    exactEpisodeRadius: 0,
    nearEpisodeRadius: 1,
    includeSceneDetails: true,
    includeShotDetails: true,
    includeAssetLedger: true,
    includePhaseLedger: false,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 260,
    maxSceneSummaryChars: 240,
    maxShotCount: 18,
    rationale: "分镜阶段以当前场/近邻场的空间、道具和动作承接为主，阶段大纲只保留必要禁忌。",
  },
  visual_prompt: {
    profile: "visual_prompt",
    exactEpisodeRadius: 0,
    nearEpisodeRadius: 0,
    includeSceneDetails: true,
    includeShotDetails: true,
    includeAssetLedger: true,
    includePhaseLedger: false,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 180,
    maxSceneSummaryChars: 160,
    maxShotCount: 12,
    rationale: "提示词阶段不能被远期剧情污染，主要需要当前镜头、当前场、资产锚点和连续性规则。",
  },
  operator: {
    profile: "operator",
    exactEpisodeRadius: 1,
    nearEpisodeRadius: 3,
    includeSceneDetails: true,
    includeShotDetails: true,
    includeAssetLedger: true,
    includePhaseLedger: true,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 420,
    maxSceneSummaryChars: 220,
    maxShotCount: 24,
    rationale: "Operator 需要恢复项目状态和执行 QA，必须同时看到阶段压缩、近邻具体内容、状态台账和必要分镜样本。",
  },
  default: {
    profile: "default",
    exactEpisodeRadius: 1,
    nearEpisodeRadius: 2,
    includeSceneDetails: true,
    includeShotDetails: false,
    includeAssetLedger: true,
    includePhaseLedger: true,
    includeForbiddenContradictions: true,
    maxEpisodeSummaryChars: 320,
    maxSceneSummaryChars: 180,
    maxShotCount: 0,
    rationale: "默认长篇记忆窗口：当前内容较详细，近邻半详细，远期只保留阶段压缩和台账。",
  },
};

const resolveProfile = (profile?: string): LongFormMemoryTaskProfile =>
  profile && profile in LONG_FORM_MEMORY_WINDOW_POLICIES
    ? profile as LongFormMemoryTaskProfile
    : "default";

const createIssue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: `long-form-memory-${Date.now()}-${crypto.randomUUID()}`,
  target,
  message,
  severity,
  suggestion,
});

const compactText = (value: unknown, maxLength = 260) => {
  void maxLength;
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text;
};

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const chineseEpisodeNumber = (value: string) => {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (digits[value]) return digits[value];
  if (value.startsWith("十")) return 10 + (digits[value.slice(1)] || 0);
  if (value.endsWith("十")) return (digits[value.slice(0, -1)] || 1) * 10;
  const tenParts = value.split("十");
  if (tenParts.length === 2) return (digits[tenParts[0]] || 1) * 10 + (digits[tenParts[1]] || 0);
  return undefined;
};

const episodeNumber = (episode: any, index: number) => {
  const explicit = [episode?.sequenceNumber, episode?.episodeNumber, episode?.number]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
  if (explicit) return explicit;
  const fromOrder = Number(episode?.order);
  if (Number.isFinite(fromOrder)) return fromOrder + 1;
  const title = String(episode?.title || "");
  const titleNumber = title.match(/第\s*(\d+)\s*[集话章]/);
  if (titleNumber) return Number(titleNumber[1]);
  const titleChineseNumber = title.match(/第\s*([一二三四五六七八九十]{1,3})\s*[集话章]/);
  const parsedChineseNumber = titleChineseNumber ? chineseEpisodeNumber(titleChineseNumber[1]) : undefined;
  if (parsedChineseNumber) return parsedChineseNumber;
  const id = String(episode?.id || "");
  const idEpisodeNumber = id.match(/(?:^|[-_])(?:ep|episode)[-_]?0*(\d+)(?:$|[-_])/i);
  if (idEpisodeNumber) return Number(idEpisodeNumber[1]);
  return index + 1;
};

const parseEpisodeRange = (range?: string) => {
  const match = String(range || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return undefined;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
  };
};

const phaseContainsEpisode = (phase: LongFormMemoryPhase, episodeIndex: number) => {
  const range = parseEpisodeRange(phase.episodes);
  return range ? episodeIndex >= range.start && episodeIndex <= range.end : false;
};

export interface LongFormEpisodeSummary {
  id?: string;
  index: number;
  title?: string;
  summary?: string;
  hook?: string;
  cliffhanger?: string;
  sceneCount: number;
  shotCount: number;
  targetDuration?: number;
  continuityState?: unknown;
  episodeValuePlan?: unknown;
  scenes?: Array<{
    id?: string;
    title?: string;
    description?: string;
    valueShift?: unknown;
    continuityIn?: string;
    continuityOut?: string;
    breakdown?: unknown;
    shots?: Array<{
      id?: string;
      visualAction?: string;
      duration?: number;
      continuityNote?: string;
      characterIdsInShot?: string[];
      locationId?: string;
      propIds?: string[];
    }>;
  }>;
}

export interface LongFormMemoryContext {
  source: "productionMemory" | "operatorProductionMemory" | "derived";
  isLongForm: boolean;
  targetEpisodeCount?: number;
  generatedEpisodeCount: number;
  memory: LongFormProductionMemory;
  phaseMap: LongFormMemoryPhase[];
  currentPhase?: LongFormMemoryPhase;
  scopedEpisodeIds: string[];
  previousEpisodes: LongFormEpisodeSummary[];
  currentEpisodes: LongFormEpisodeSummary[];
  nextEpisodes: LongFormEpisodeSummary[];
  continuityLedger: {
    currentPhaseId?: string;
    latestEpisode?: LongFormEpisodeSummary;
    latestContinuityState?: unknown;
    characterState?: unknown;
    relationshipStage?: unknown;
    sectState?: unknown;
    powerLedger?: unknown;
    propOwnership?: unknown;
    forbiddenContradictions: string[];
    shotContinuityRule?: string;
  };
  assetContinuity?: AssetContinuityContext;
  requiredBeforeGeneration: string[];
  missingRequirements: string[];
  guardrails: string[];
  windowPolicy: LongFormMemoryWindowPolicy;
}

export const getStoredProductionMemory = (project: Project): {
  source: LongFormMemoryContext["source"];
  memory?: LongFormProductionMemory;
} => {
  if (project.productionMemory) return { source: "productionMemory", memory: project.productionMemory };
  if (project.operatorProductionMemory) return { source: "operatorProductionMemory", memory: project.operatorProductionMemory };
  return { source: "derived" };
};

const derivePhaseMap = (project: Project): LongFormMemoryPhase[] => {
  const target = Number(project.targetEpisodeCount || 0);
  if (target >= 100) {
    const block = Math.ceil(target / 5);
    return Array.from({ length: 5 }, (_, index) => {
      const start = index * block + 1;
      const end = Math.min((index + 1) * block, target);
      return {
        id: `phase-${index + 1}`,
        episodes: `${start}-${end}`,
        title: `阶段 ${index + 1}`,
        promise: "待在 productionMemory.skeletonMemory.phaseMap 中锁定本阶段商业承诺、剧情转折和偿付。",
        status: "derived_missing_detail",
      };
    });
  }
  if (target >= 20) {
    return [
      {
        id: "phase-1",
        episodes: `1-${target}`,
        title: "全季主阶段",
        promise: "待在 productionMemory.skeletonMemory.phaseMap 中拆分长线阶段。",
        status: "derived_missing_detail",
      },
    ];
  }
  return [];
};

export const normalizeProductionMemory = (project: Project): {
  source: LongFormMemoryContext["source"];
  memory: LongFormProductionMemory;
} => {
  const stored = getStoredProductionMemory(project);
  const memory = stored.memory || {
    updatedAt: Date.now(),
    skeletonMemory: {
      seasonPromise: compactText(project.seasonArc || project.logline || project.refinedInspiration, 500),
      phaseMap: derivePhaseMap(project),
    },
    continuityMemory: {
      shotContinuityRule: "每场分镜必须交代 180 度轴线、视线匹配、动作顺接、空间方位连续性。",
    },
    qaCouncil: {
      continuityScriptSupervisorQA: "缺少正式 productionMemory 时只能派生基础上下文，生成前必须补齐长篇记忆。",
    },
  };
  const existingPhaseMap = asArray<LongFormMemoryPhase>(memory.skeletonMemory?.phaseMap);
  return {
    source: stored.source,
    memory: {
      ...memory,
      skeletonMemory: {
        ...(memory.skeletonMemory || {}),
        phaseMap: existingPhaseMap.length ? existingPhaseMap : derivePhaseMap(project),
      },
    },
  };
};

const summarizeEpisode = (
  episode: any,
  index: number,
  policy: LongFormMemoryWindowPolicy = LONG_FORM_MEMORY_WINDOW_POLICIES.default,
): LongFormEpisodeSummary => {
  const scenes = asArray<any>(episode?.scenes);
  const summary: LongFormEpisodeSummary = {
    id: episode?.id,
    index: episodeNumber(episode, index),
    title: episode?.title,
    summary: compactText(episode?.summary || episode?.inspiration, policy.maxEpisodeSummaryChars),
    hook: compactText(episode?.hook, 260),
    cliffhanger: compactText(episode?.cliffhanger, 260),
    sceneCount: scenes.length || Number(episode?.sceneCount || 0),
    shotCount: scenes.reduce((total, scene) => total + asArray(scene?.shots).length, 0),
    targetDuration: episode?.targetDuration,
    continuityState: episode?.continuityState,
    episodeValuePlan: episode?.episodeValuePlan,
  };
  if (policy.includeSceneDetails) {
    summary.scenes = scenes.map((scene) => ({
      id: scene?.id,
      title: scene?.title,
      description: compactText(scene?.description, policy.maxSceneSummaryChars),
      valueShift: scene?.valueShift,
      continuityIn: compactText(scene?.continuityIn, 180),
      continuityOut: compactText(scene?.continuityOut, 180),
      breakdown: scene?.breakdown
        ? {
            locationId: scene.breakdown.locationId,
            characterIds: scene.breakdown.characterIds || [],
            propIds: scene.breakdown.propIds || [],
          }
        : undefined,
      shots: policy.includeShotDetails
        ? asArray<any>(scene?.shots).map((shot) => ({
            id: shot?.id,
            visualAction: compactText(shot?.visualAction, 160),
            duration: shot?.duration,
            continuityNote: compactText(shot?.continuityNote, 220),
            characterIdsInShot: shot?.characterIdsInShot || [],
            locationId: shot?.locationId,
            propIds: shot?.propIds || [],
          }))
        : undefined,
    }));
  }
  return summary;
};

export const buildLongFormMemoryContext = (
  project: Project,
  options: { episodeIds?: string[]; windowSize?: number; profile?: LongFormMemoryTaskProfile | string } = {},
): LongFormMemoryContext => {
  const { source, memory } = normalizeProductionMemory(project);
  const policy = LONG_FORM_MEMORY_WINDOW_POLICIES[resolveProfile(options.profile)];
  const episodes = asArray<Episode>((project as any).episodes);
  const summaries = episodes.map((episode, index) => summarizeEpisode(episode, index, policy));
  const scopedIds = new Set(asArray<string>(options.episodeIds).filter(Boolean));
  const scopedSummaries = scopedIds.size
    ? summaries.filter((episode) => episode.id && scopedIds.has(episode.id))
    : summaries.slice(Math.max(0, summaries.length - Math.max(1, policy.exactEpisodeRadius || Number(options.windowSize || 2))));
  const windowSize = Math.max(1, Number(options.windowSize || policy.nearEpisodeRadius || 2));
  const firstScopedIndex = scopedSummaries.length ? scopedSummaries[0].index : summaries.at(-1)?.index || 1;
  const lastScopedIndex = scopedSummaries.length ? scopedSummaries.at(-1)!.index : summaries.at(-1)?.index || 1;
  const phaseMap = asArray<LongFormMemoryPhase>(memory.skeletonMemory?.phaseMap);
  const phaseFromEpisode = phaseMap.find((phase) => phaseContainsEpisode(phase, firstScopedIndex));
  const currentPhase = phaseMap.find((phase) => phase.id === memory.continuityMemory?.currentPhase) || phaseFromEpisode;
  const previousEpisodes = summaries.filter((episode) =>
    episode.index >= firstScopedIndex - windowSize && episode.index < firstScopedIndex,
  );
  const currentEpisodes = scopedSummaries.length
    ? scopedSummaries
    : summaries.filter((episode) => episode.index >= firstScopedIndex && episode.index <= lastScopedIndex);
  const nextEpisodes = summaries.filter((episode) =>
    episode.index > lastScopedIndex && episode.index <= lastScopedIndex + windowSize,
  );
  const latestEpisode = summaries.at(-1);
  const continuityMemory = memory.continuityMemory || {};
  const assetContinuity = policy.includeAssetLedger
    ? buildAssetContinuityContext(project, { profile: policy.profile === "visual_prompt" ? "visual_prompt" : "operator" })
    : undefined;
  const missingRequirements = [
    ...collectLongFormMemoryGaps(project, memory),
    ...(policy.profile === "visual_prompt" || policy.profile === "operator"
      ? assetContinuity?.requiredBeforeVisualGeneration || []
      : []),
  ];
  return {
    source,
    isLongForm: Number(project.targetEpisodeCount || 0) >= 10 || summaries.length >= 10,
    targetEpisodeCount: project.targetEpisodeCount,
    generatedEpisodeCount: summaries.length,
    memory,
    phaseMap: policy.includePhaseLedger ? phaseMap : [],
    currentPhase: policy.includePhaseLedger ? currentPhase : undefined,
    scopedEpisodeIds: currentEpisodes.map((episode) => episode.id || "").filter(Boolean),
    previousEpisodes,
    currentEpisodes,
    nextEpisodes,
    continuityLedger: {
      currentPhaseId: currentPhase?.id || continuityMemory.currentPhase,
      latestEpisode,
      latestContinuityState: latestEpisode?.continuityState,
      characterState: continuityMemory.protagonistState || continuityMemory.characterState,
      relationshipStage: continuityMemory.relationshipStage,
      sectState: continuityMemory.sectState,
      powerLedger: continuityMemory.powerLedger,
      propOwnership: policy.includeAssetLedger ? continuityMemory.propOwnership : undefined,
      forbiddenContradictions: policy.includeForbiddenContradictions ? asArray<string>(continuityMemory.forbiddenContradictions) : [],
      shotContinuityRule: continuityMemory.shotContinuityRule,
    },
    assetContinuity,
    requiredBeforeGeneration: [
      "第 2 集及以后开始生成前，必须读取持久化的长篇记忆。",
      "进入场景、剧本或分镜任务前，必须刷新商业记忆、骨架记忆、连续性记忆和当前分集窗口。",
      "进入分镜、视觉提示词、图片生成或跨集资产变更前，必须刷新资产连续性。",
      "写入下游分集或分镜产物前，必须先提交对应的记忆更新。",
    ],
    missingRequirements,
    guardrails: [
      "长篇记忆只以项目持久化数据为事实源，不以测试脚本或聊天记录为事实源。",
      "开启新阶段时延续既有偿付和台账，不得重置前序状态。",
      "跨集复用已确认资产；服装、妆发、伤势、损坏、场景状态或道具用途变化时创建状态变体，不复制新资产。",
      "外部或导入剧本同样必须遵守轴线、视线、动作承接、道具流转、状态台账和时长连续性。",
    ],
    windowPolicy: policy,
  };
};

const renderEpisodeList = (title: string, episodes: LongFormEpisodeSummary[]) => {
  if (!episodes.length) return "";
  return [
    `【${title}】`,
    ...episodes.map((episode) => [
      `- 第 ${episode.index} 集 ${episode.title || ""}`.trim(),
      episode.summary ? `  概要: ${episode.summary}` : "",
      episode.hook ? `  钩子: ${episode.hook}` : "",
      episode.cliffhanger ? `  结尾: ${episode.cliffhanger}` : "",
      episode.continuityState ? `  状态: ${JSON.stringify(episode.continuityState)}` : "",
    ].filter(Boolean).join("\n")),
  ].join("\n");
};

const renderCompactJson = (label: string, value: unknown) => {
  if (!value || (typeof value === "object" && Object.keys(value as Record<string, unknown>).length === 0)) return "";
  return `【${label}】\n${JSON.stringify(value, null, 2)}`;
};

export const renderLongFormMemoryForPrompt = (context: LongFormMemoryContext) => {
  if (!context.isLongForm && context.generatedEpisodeCount <= 1) return "";
  const phaseLines = context.phaseMap.length
    ? [
        "【阶段压缩记忆】",
        ...context.phaseMap.map((phase) => `- ${phase.episodes} ${phase.title}: ${phase.promise}`),
      ].join("\n")
    : "";
  const currentPhase = context.currentPhase
    ? `【当前阶段】\n${context.currentPhase.episodes} ${context.currentPhase.title}: ${context.currentPhase.promise}`
    : "";
  const assetLedger = context.assetContinuity
    ? [
        "【多集资产台账】",
        `角色 ${context.assetContinuity.counts.characters}；地点 ${context.assetContinuity.counts.locations}；道具 ${context.assetContinuity.counts.props}`,
        `跨集需变体资产 ${context.assetContinuity.variantCoverage.recurringAssetCount}；已有变体资产 ${context.assetContinuity.variantCoverage.assetsWithVariants}；待补变体 ${context.assetContinuity.variantCoverage.recurringWithoutVariants.length}`,
        ...context.assetContinuity.variantCoverage.recurringWithoutVariants.map((entry) =>
          `- ${entry.kind} ${entry.name} 第 ${entry.firstEpisode}-${entry.lastEpisode} 集出现 ${entry.episodeCount} 集，进入出图前需补视觉变体。`,
        ),
      ].join("\n")
    : "";
  return [
    "<long_form_memory>",
    context.targetEpisodeCount ? `目标集数: ${context.targetEpisodeCount}；已生成集数: ${context.generatedEpisodeCount}` : "",
    phaseLines,
    currentPhase,
    renderCompactJson("商业/受众记忆", context.memory.commercialMemory),
    renderCompactJson("骨架/伏笔记忆", context.memory.skeletonMemory),
    renderCompactJson("连续性台账", {
      latestContinuityState: context.continuityLedger.latestContinuityState,
      characterState: context.continuityLedger.characterState,
      relationshipStage: context.continuityLedger.relationshipStage,
      sectState: context.continuityLedger.sectState,
      powerLedger: context.continuityLedger.powerLedger,
      propOwnership: context.continuityLedger.propOwnership,
      forbiddenContradictions: context.continuityLedger.forbiddenContradictions,
      shotContinuityRule: context.continuityLedger.shotContinuityRule,
    }),
    assetLedger,
    renderEpisodeList("较近前文具体内容", context.previousEpisodes),
    renderEpisodeList("当前/最近几集具体内容", context.currentEpisodes),
    renderEpisodeList("后文已定内容", context.nextEpisodes),
    context.guardrails.length ? `【继承规则】\n${context.guardrails.map((item) => `- ${item}`).join("\n")}` : "",
    "</long_form_memory>",
  ].filter(Boolean).join("\n\n");
};

export const collectLongFormMemoryGaps = (
  project: Project,
  memoryInput?: LongFormProductionMemory,
): string[] => {
  const { memory } = memoryInput ? { memory: memoryInput } : normalizeProductionMemory(project);
  const gaps: string[] = [];
  const target = Number(project.targetEpisodeCount || 0);
  const phaseMap = asArray<LongFormMemoryPhase>(memory.skeletonMemory?.phaseMap);
  if (target >= 50 && phaseMap.length < 2) {
    gaps.push("skeletonMemory.phaseMap must define multi-phase structure for long-form projects.");
  }
  if (target >= 100 && phaseMap.length < 5) {
    gaps.push("100-episode projects must define five phase ledgers.");
  }
  if (!memory.commercialMemory?.targetAudience || !memory.commercialMemory?.monetizationPromise) {
    gaps.push("commercialMemory must define targetAudience and monetizationPromise.");
  }
  if (!memory.skeletonMemory?.finaleContract && !memory.skeletonMemory?.seriesPromise100) {
    gaps.push("skeletonMemory must define a finaleContract or seriesPromise100.");
  }
  if (!memory.continuityMemory?.relationshipStage && !memory.continuityMemory?.protagonistState) {
    gaps.push("continuityMemory must define relationshipStage or protagonistState.");
  }
  if (!memory.continuityMemory?.propOwnership) {
    gaps.push("continuityMemory.propOwnership is required for recurring asset continuity.");
  }
  if (!asArray(memory.continuityMemory?.forbiddenContradictions).length && target >= 20) {
    gaps.push("continuityMemory.forbiddenContradictions should list hard continuity taboos.");
  }
  return gaps;
};

export const validateLongFormMemoryRules = (
  project: Project,
  episodes: Episode[] = [],
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  const target = Number(project.targetEpisodeCount || 0);
  const allEpisodes = asArray<Episode>((project as any).episodes);
  const scopedEpisodes = episodes.length ? episodes : allEpisodes;
  const longForm = target >= 20 || allEpisodes.length >= 10 || scopedEpisodes.length >= 10;
  if (!longForm) return issues;

  const stored = getStoredProductionMemory(project);
  const { memory } = normalizeProductionMemory(project);
  const gaps = collectLongFormMemoryGaps(project, memory);
  if (!stored.memory) {
    issues.push(createIssue(
      "project.productionMemory",
      "长篇/多集项目缺少系统级 productionMemory，只能从项目字段派生临时上下文。",
      target >= 50 ? "blocking" : "warning",
      "在项目根字段写入 productionMemory；Operator 旧数据可同时镜像到 operatorProductionMemory。",
    ));
  }
  gaps.forEach((gap) => {
    issues.push(createIssue(
      "project.productionMemory.longForm",
      gap,
      target >= 100 ? "blocking" : "warning",
      "补齐 commercialMemory、skeletonMemory.phaseMap、continuityMemory 和禁忌设定清单。",
    ));
  });

  scopedEpisodes.forEach((episode, index) => {
    const number = episodeNumber(episode, index);
    if (number <= 1) return;
    const state = (episode as any).continuityState || {};
    const missingStateKeys = ["cultivationStage", "relationshipStage", "sectState", "keyPropState"]
      .filter((key) => !String(state[key] || "").trim());
    if (missingStateKeys.length > 0) {
      issues.push(createIssue(
        `episode.${episode.id}.continuityState`,
        `第 ${number} 集缺少连续性状态字段：${missingStateKeys.join(", ")}。`,
        "warning",
        "每集进入下一集前必须记录修为/能力、关系、组织/地点、关键道具状态。",
      ));
    }
  });

  issues.push(...buildAssetContinuityContext(project, { profile: "visual_prompt" }).qaIssues);

  return issues;
};
