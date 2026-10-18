import type {
  Project,
  ProjectLockStrategy,
  ProjectProductionMode,
  ProjectTargetScale,
  StyleVariantPolicy,
} from "../../../../../src/types/project";
import { PRODUCTION_LOCK_MODE_POLICIES, type ProductionLockFormat } from "./productionLock";

export const PROJECT_PRODUCTION_MODES: ProjectProductionMode[] = [
  "single-work",
  "series-work",
  "movie",
  "tv-series",
  "short-drama",
  "micro-short-drama",
  "interactive",
  "ai-video-sample",
];

const LOCK_STRATEGY_LABELS: Record<ProjectLockStrategy, string> = {
  full_script: "完整剧本锁",
  full_series: "全剧锁",
  episode_block: "剧集批次锁",
  scene_range: "场次范围锁",
  sequence: "段落/Sequence 锁",
  node_block: "互动节点批次锁",
  chapter_block: "互动章节锁",
};

export type ProductionLockStrategyReadinessScope =
  | "full_project_ready"
  | "current_block_only"
  | "sample_scope_only";

export type ProductionLockStrategyRiskLevel = "low" | "medium" | "high";

export interface ProductionLockStrategyDecisionOption {
  id: ProjectLockStrategy;
  label: string;
  selected: boolean;
  recommended: boolean;
  readinessScope: ProductionLockStrategyReadinessScope;
  riskLevel: ProductionLockStrategyRiskLevel;
  summary: string;
  bestFor: string[];
  requiredBeforeFormal: string[];
  risks: string[];
}

export interface ProductionLockStrategyDecision {
  schemaVersion: "production-lock-strategy-decision.v1";
  productionMode: ProjectProductionMode;
  selectedStrategy: ProjectLockStrategy;
  recommendedStrategy: ProjectLockStrategy;
  targetScale: ProjectTargetScale;
  targetLabel: string;
  blockLabel: string;
  selectedReadinessScope: ProductionLockStrategyReadinessScope;
  fullSeriesReadyRule: string;
  currentBlockReadyRule: string;
  options: ProductionLockStrategyDecisionOption[];
  nextActions: string[];
}

const MODE_DEFAULTS: Record<ProjectProductionMode, {
  lockStrategy: ProjectLockStrategy;
  targetScale: ProjectTargetScale;
  styleVariantPolicy: StyleVariantPolicy;
}> = {
  "single-work": {
    lockStrategy: "scene_range", targetScale: { label: "single-work", productionBlockSize: 1 },
    styleVariantPolicy: { allowLocalStyleVariants: true, requiresStyleVariantId: false, allowedScopes: ["sequence", "scene"], fallbackRule: "按作者选择保留局部风格，不自动改写其他内容。" },
  },
  "series-work": {
    lockStrategy: "scene_range", targetScale: { label: "series-work", productionBlockSize: 1 },
    styleVariantPolicy: { allowLocalStyleVariants: true, requiresStyleVariantId: false, allowedScopes: ["episode", "scene"], fallbackRule: "按作者选择复用或独立设定各集风格。" },
  },
  movie: {
    lockStrategy: "full_script",
    targetScale: { label: "feature", episodeCount: 1, productionBlockSize: 1 },
    styleVariantPolicy: {
      allowLocalStyleVariants: true,
      requiresStyleVariantId: true,
      allowedScopes: ["sequence", "scene"],
      fallbackRule: "局部风格变体必须回退到项目 visualStyleLock，不能改变全片媒介和角色身份。",
    },
  },
  "tv-series": {
    lockStrategy: "episode_block",
    targetScale: { label: "series", episodeCount: 12, productionBlockSize: 6 },
    styleVariantPolicy: {
      allowLocalStyleVariants: true,
      requiresStyleVariantId: true,
      allowedScopes: ["episode", "scene"],
      fallbackRule: "每集局部风格必须继承剧集总风格锁，不能让未锁集数漂移。",
    },
  },
  "short-drama": {
    lockStrategy: "episode_block",
    targetScale: { label: "short-drama-season", episodeCount: 24, productionBlockSize: 8 },
    styleVariantPolicy: {
      allowLocalStyleVariants: true,
      requiresStyleVariantId: true,
      allowedScopes: ["episode", "scene"],
      fallbackRule: "短剧高复用资产优先使用同一风格锁，局部变体只表达状态差异。",
    },
  },
  "micro-short-drama": {
    lockStrategy: "full_script",
    targetScale: { label: "single-micro-short", episodeCount: 1, durationMinutes: 10, productionBlockSize: 1 },
    styleVariantPolicy: {
      allowLocalStyleVariants: true,
      requiresStyleVariantId: true,
      allowedScopes: ["scene"],
      fallbackRule: "单集微短剧按一条完整视频保持统一风格，变体只服务场次状态。",
    },
  },
  interactive: {
    lockStrategy: "node_block",
    targetScale: { label: "interactive", episodeCount: 1, nodeCount: 30, durationMinutes: 20, productionBlockSize: 10 },
    styleVariantPolicy: {
      allowLocalStyleVariants: true,
      requiresStyleVariantId: true,
      allowedScopes: ["node", "scene"],
      fallbackRule: "互动节点状态可以有局部风格变体，但必须绑定 graph node、变量状态和回退规则。",
    },
  },
  "ai-video-sample": {
    lockStrategy: "scene_range",
    targetScale: { label: "sample", episodeCount: 1, sceneCount: 1, durationMinutes: 1, productionBlockSize: 1 },
    styleVariantPolicy: {
      allowLocalStyleVariants: true,
      requiresStyleVariantId: true,
      allowedScopes: ["sample", "scene", "node"],
      fallbackRule: "样片风格变体只能在 sample scope 内使用，不能晋升为正式项目风格事实源。",
    },
  },
};

const isProductionMode = (value: unknown): value is ProjectProductionMode =>
  PROJECT_PRODUCTION_MODES.includes(String(value || "") as ProjectProductionMode);

const allowedLockStrategies = (mode: ProjectProductionMode): ProjectLockStrategy[] =>
  (PRODUCTION_LOCK_MODE_POLICIES[mode as ProductionLockFormat]?.allowedLockScopes || []) as ProjectLockStrategy[];

export const resolveProductionMode = (
  project: Pick<Project, "productionMode" | "projectModel" | "interactiveTemplate" | "type">,
): ProjectProductionMode => {
  if (isProductionMode(project.productionMode)) return project.productionMode;
  if (project.projectModel === "interactive" || project.interactiveTemplate) return "interactive";
  if (isProductionMode(project.type)) return project.type;
  return "ai-video-sample";
};

export const resolveProductionLockStrategy = (
  project: Pick<Project, "productionMode" | "projectModel" | "interactiveTemplate" | "type" | "lockStrategy">,
): ProjectLockStrategy => {
  const mode = resolveProductionMode(project);
  const allowed = allowedLockStrategies(mode);
  if (project.lockStrategy && allowed.includes(project.lockStrategy)) return project.lockStrategy;
  const fallback = MODE_DEFAULTS[mode].lockStrategy;
  return allowed.includes(fallback) ? fallback : allowed[0] || fallback;
};

export const createDefaultTargetScale = (
  project: Pick<Project, "productionMode" | "projectModel" | "interactiveTemplate" | "type" | "targetEpisodeCount" | "durationMinutes" | "interactiveConfig">,
): ProjectTargetScale => {
  const mode = resolveProductionMode(project);
  const defaults = MODE_DEFAULTS[mode].targetScale;
  if (mode === "interactive") {
    return {
      ...defaults,
      nodeCount: project.interactiveConfig?.targetNodeCount || defaults.nodeCount,
      durationMinutes: project.interactiveConfig?.playDurationMin || defaults.durationMinutes,
    };
  }
  return {
    ...defaults,
    episodeCount: project.targetEpisodeCount || defaults.episodeCount,
    durationMinutes: project.durationMinutes || defaults.durationMinutes,
  };
};

export const createDefaultStyleVariantPolicy = (
  project: Pick<Project, "productionMode" | "projectModel" | "interactiveTemplate" | "type">,
): StyleVariantPolicy => ({
  ...MODE_DEFAULTS[resolveProductionMode(project)].styleVariantPolicy,
});

export const buildProductionModeProfile = (project: Pick<Project,
  | "productionMode"
  | "projectModel"
  | "interactiveTemplate"
  | "type"
  | "targetEpisodeCount"
  | "durationMinutes"
  | "interactiveConfig"
  | "targetScale"
  | "lockStrategy"
  | "styleVariantPolicy"
  | "visualStyleLock"
>) => {
  const productionMode = resolveProductionMode(project);
  const lockStrategy = resolveProductionLockStrategy(project);
  const lockPolicy = PRODUCTION_LOCK_MODE_POLICIES[productionMode as ProductionLockFormat];
  const targetScale = {
    ...createDefaultTargetScale(project),
    ...(project.targetScale || {}),
  };
  const styleVariantPolicy = {
    ...createDefaultStyleVariantPolicy(project),
    ...(project.styleVariantPolicy || {}),
  };
  const styleLock = project.visualStyleLock;
  const hasStyleLock = Boolean(
    styleLock?.humanApprovalState === "approved"
    || styleLock?.visualImplementation
    || styleLock?.stylePrompt
    || styleLock?.renderingMode,
  );
  return {
    schemaVersion: "production-mode-profile.v1",
    productionMode,
    lockStrategy,
    targetScale,
    styleVariantPolicy,
    visualStyleLockStatus: hasStyleLock
      ? "locked_or_seeded"
      : "missing_or_legacy_fallback",
    formalAssetPrecondition: lockPolicy?.formalAssetPrecondition || "",
    allowedLockStrategies: allowedLockStrategies(productionMode).map((strategy) => ({
      id: strategy,
      label: LOCK_STRATEGY_LABELS[strategy],
    })),
    requiredLockArtifacts: lockPolicy?.requiredLockArtifacts || [],
    forbiddenBehaviors: lockPolicy?.forbiddenBehaviors || [],
    legacyStatus: project.productionMode ? "explicit" : "inferred_legacy_default",
  };
};

const totalUnitsForMode = (
  mode: ProjectProductionMode,
  targetScale: ProjectTargetScale,
): number => {
  if (mode === "interactive") return Math.max(1, Number(targetScale.nodeCount || 1));
  return Math.max(1, Number(targetScale.episodeCount || 1));
};

const unitLabelForMode = (mode: ProjectProductionMode) =>
  mode === "interactive" ? "节点" : "集";

const recommendedStrategyForMode = (
  mode: ProjectProductionMode,
  allowed: ProjectLockStrategy[],
): ProjectLockStrategy => {
  const preferred = MODE_DEFAULTS[mode].lockStrategy;
  return allowed.includes(preferred) ? preferred : allowed[0] || preferred;
};

const readinessScopeForStrategy = (strategy: ProjectLockStrategy): ProductionLockStrategyReadinessScope => {
  if (strategy === "full_script" || strategy === "full_series") return "full_project_ready";
  if (strategy === "episode_block" || strategy === "node_block" || strategy === "chapter_block") return "current_block_only";
  return "sample_scope_only";
};

const riskLevelForStrategy = (
  strategy: ProjectLockStrategy,
  totalUnits: number,
): ProductionLockStrategyRiskLevel => {
  if (strategy === "scene_range" || strategy === "sequence") return "high";
  if ((strategy === "full_series" || strategy === "full_script") && totalUnits > 24) return "high";
  if (strategy === "episode_block" || strategy === "node_block" || strategy === "chapter_block") return "medium";
  return "low";
};

const strategySummary = (
  strategy: ProjectLockStrategy,
  mode: ProjectProductionMode,
  totalUnits: number,
  blockSize: number,
) => {
  const unit = unitLabelForMode(mode);
  if (strategy === "full_script") return `先锁完整剧本，再允许正式资产包、breakdown、场记连续性和后续生成链路。`;
  if (strategy === "full_series") return `先锁完整 ${totalUnits} ${unit}，再把 full-series readiness 作为正式交付目标。`;
  if (strategy === "episode_block") return `按每批约 ${Math.min(blockSize, totalUnits)} ${unit}滚动制片；当前 block 可以 ready，但未锁范围必须持续可见。`;
  if (strategy === "node_block") return `按每批约 ${Math.min(blockSize, totalUnits)} 个互动节点筹备，资产需求必须绑定 graph、变量状态和路径覆盖。`;
  if (strategy === "chapter_block") return `按互动章节/关卡锁定内容，适合章节内节点多但跨章仍在变化的项目。`;
  if (strategy === "sequence") return `只锁一个段落/sequence，用于样片、动作段落或镜头链测试，不能冒充全片 ready。`;
  return `只锁明确场次范围，用于样片、补拍或局部测试，不能作为全剧正式资产事实源。`;
};

const strategyBestFor = (strategy: ProjectLockStrategy): string[] => {
  if (strategy === "full_script") return ["电影或单条成片正式交付", "剧本已完整批准，资产需要一次定版"];
  if (strategy === "full_series") return ["整季剧本已经完成", "希望一次性锁定全季复用资产和连续性"];
  if (strategy === "episode_block") return ["100 集、长剧或连续短剧滚动生产", "先锁 1-10 集，再保留后续集变更空间"];
  if (strategy === "node_block") return ["互动节点分批制作", "变量状态、失败路径和结局路径仍需逐批验证"];
  if (strategy === "chapter_block") return ["互动章节或关卡制片", "章节内可锁定，但跨章内容还会调整"];
  if (strategy === "sequence") return ["高风险动作段落或样片试制", "验证镜头语言、角色身份板或视频模型能力"];
  return ["局部场次试制、补拍或 demo 样片", "只验证明确范围内的资产和提示词"];
};

const requiredBeforeFormal = (strategy: ProjectLockStrategy): string[] => {
  if (strategy === "full_script") return ["approved script_lock_package", "coverageRatio=1", "production_breakdown_report 覆盖完整剧本"];
  if (strategy === "full_series") return ["approved full_series script_lock_package", "targetEpisodeCount 与锁定集数一致", "全剧 production_breakdown_report 与 continuity_matrix"];
  if (strategy === "episode_block") return ["locked production_block_lock", "当前 block 剧本 approved", "cockpit 显示 missingEpisodeCount 和 openDependencies"];
  if (strategy === "node_block") return ["approved content_lock_package", "locked production_block_lock", "graph nodes、变量状态、Golden Path 和结局覆盖"];
  if (strategy === "chapter_block") return ["approved content_lock_package", "章节 node/block 范围", "跨章开放依赖列表"];
  return ["明确 scene/sequence scope", "sample/prototype 标记", "不得写入正式资产包作为 source of truth"];
};

const strategyRisks = (strategy: ProjectLockStrategy): string[] => {
  if (strategy === "full_script") return ["前置剧本工作量高", "锁后大改必须走 change order 和 re-lock"];
  if (strategy === "full_series") return ["前置工作量最大", "任一集大改会扩大 re-lock、re-breakdown 和资产复检范围"];
  if (strategy === "episode_block") return ["不能标记 full-series ready", "后续新增/删改集必须走 series_change_order"];
  if (strategy === "node_block") return ["不能用线性场次顺序替代 graph 覆盖", "未锁节点资产不得进入正式包"];
  if (strategy === "chapter_block") return ["跨章节变量和结局状态需要额外 QA", "未锁章节仍会让全局 readiness 保持开放"];
  if (strategy === "sequence") return ["只能证明段落成立", "不能承诺全片/全剧资产齐备"];
  return ["容易被误用为正式生产范围", "必须在 cockpit 和 handoff 中保留 sample/prototype 标识"];
};

export const buildProductionLockStrategyDecision = (project: Pick<Project,
  | "productionMode"
  | "projectModel"
  | "interactiveTemplate"
  | "type"
  | "targetEpisodeCount"
  | "durationMinutes"
  | "interactiveConfig"
  | "targetScale"
  | "lockStrategy"
  | "styleVariantPolicy"
  | "visualStyleLock"
>): ProductionLockStrategyDecision => {
  const profile = buildProductionModeProfile(project);
  const allowed = profile.allowedLockStrategies.map((strategy) => strategy.id);
  const recommendedStrategy = recommendedStrategyForMode(profile.productionMode, allowed);
  const selectedStrategy = allowed.includes(profile.lockStrategy) ? profile.lockStrategy : recommendedStrategy;
  const totalUnits = totalUnitsForMode(profile.productionMode, profile.targetScale);
  const blockSize = Math.max(1, Number(profile.targetScale.productionBlockSize || Math.min(totalUnits, 8)));
  const unit = unitLabelForMode(profile.productionMode);
  const targetLabel = profile.productionMode === "interactive"
    ? `${totalUnits} 个互动节点`
    : `${totalUnits} 集`;
  const blockLabel = readinessScopeForStrategy(selectedStrategy) === "current_block_only"
    ? `当前批次约 ${Math.min(blockSize, totalUnits)} ${unit}，预计 ${Math.max(1, Math.ceil(totalUnits / blockSize))} 个批次`
    : readinessScopeForStrategy(selectedStrategy) === "full_project_ready"
      ? `锁定范围覆盖全部 ${targetLabel}`
      : "仅覆盖样片/场次/段落范围";
  const options = allowed.map((strategy) => ({
    id: strategy,
    label: LOCK_STRATEGY_LABELS[strategy],
    selected: strategy === selectedStrategy,
    recommended: strategy === recommendedStrategy,
    readinessScope: readinessScopeForStrategy(strategy),
    riskLevel: riskLevelForStrategy(strategy, totalUnits),
    summary: strategySummary(strategy, profile.productionMode, totalUnits, blockSize),
    bestFor: strategyBestFor(strategy),
    requiredBeforeFormal: requiredBeforeFormal(strategy),
    risks: strategyRisks(strategy),
  }));
  const selectedOption = options.find((option) => option.selected) || options[0];
  return {
    schemaVersion: "production-lock-strategy-decision.v1",
    productionMode: profile.productionMode,
    selectedStrategy,
    recommendedStrategy,
    targetScale: profile.targetScale,
    targetLabel,
    blockLabel,
    selectedReadinessScope: selectedOption?.readinessScope || "sample_scope_only",
    fullSeriesReadyRule: "只有 full_script/full_series 且锁定范围覆盖目标体量时，cockpit 才能显示 full-series ready。",
    currentBlockReadyRule: "episode_block/node_block/chapter_block 只能证明当前 production block ready；未锁集数/节点必须继续显示。",
    options,
    nextActions: [
      "保存 productionMode、targetScale 和 lockStrategy 到 Project。",
      "进入正式资产前生成并 QA script_lock/content_lock、production_block_lock、production_breakdown_report 和 continuity_matrix。",
      selectedOption?.readinessScope === "current_block_only"
        ? "在 cockpit 中持续显示 missingEpisodeCount/openDependencies，锁后新增或重排必须走 series_change_order。"
        : "正式推进时确认锁定范围、breakdown coverage 和 continuity_matrix coverage 与目标体量一致。",
    ],
  };
};

export const buildProductionModeSystem = () => ({
  schemaVersion: "production-mode-system.v1",
  status: "production_mode_and_style_lock_contract_available",
  projectFields: ["productionMode", "targetScale", "lockStrategy", "visualStyleLock", "styleVariantPolicy"],
  lockStrategyDecisionSystem: {
    schemaVersion: "production-lock-strategy-decision.v1",
    builderFunction: "buildProductionLockStrategyDecision",
    uiContract: "Project creation and Bible must show selected strategy, recommendation, readiness scope, formal prerequisites, and risks before formal prep.",
    readinessRule: "current_block_only must never be rendered as full-series ready.",
  },
  productionModes: PROJECT_PRODUCTION_MODES.map((mode) => ({
    mode,
    defaultLockStrategy: MODE_DEFAULTS[mode].lockStrategy,
    defaultTargetScale: MODE_DEFAULTS[mode].targetScale,
    allowedLockStrategies: allowedLockStrategies(mode),
    formalAssetPrecondition: PRODUCTION_LOCK_MODE_POLICIES[mode as ProductionLockFormat]?.formalAssetPrecondition,
  })),
  styleLockPolicy: {
    sourceOfTruth: "project.visualStyleLock with creativeVision, universalSkillRefs, globalGenerationParams, and originalStyleReference as legacy fallbacks",
    promptCatalogRule: "Asset identity-board prompt templates define layout and production requirements only; rendering style must be injected from visualStyleLock.",
    localVariantRule: "Local style variants require styleVariantId/scope/fallback and may not silently change project medium, character identity, or canonical asset identity.",
  },
  requiredBehavior: [
    "Project creation must persist productionMode, targetScale, lockStrategy, visualStyleLock, and styleVariantPolicy.",
    "Operator and UI must use the same mode profile; frontends must not maintain private lock-strategy enums.",
    "Missing visualStyleLock keeps the project in development exploration for formal visual assets until a style lock is seeded or approved.",
  ],
});
