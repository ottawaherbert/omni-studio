import type { ProductionQAIssue } from "../../../../../src/types/production";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";

export type ProductionLockFormat =
  | "single-work"
  | "series-work"
  | "movie"
  | "tv-series"
  | "short-drama"
  | "micro-short-drama"
  | "interactive"
  | "ai-video-sample";

export type ProductionLockScope =
  | "full_script"
  | "full_series"
  | "episode_block"
  | "scene_range"
  | "sequence"
  | "node_block"
  | "chapter_block";

export type ProductionLockApprovalState = "draft" | "approved" | "rejected" | "superseded";

export interface ProductionLockPolicy {
  format: ProductionLockFormat;
  formalAssetPrecondition: string;
  requiredLockArtifacts: Array<
    "script_lock_package" |
    "content_lock_package" |
    "production_block_lock" |
    "production_breakdown_report" |
    "development_asset_brief"
  >;
  allowedLockScopes: ProductionLockScope[];
  rollingProduction: "not_recommended" | "block_lock_allowed" | "chapter_or_node_lock_allowed" | "sample_only";
  formalAssetRule: string;
  forbiddenBehaviors: string[];
  requiredReadModels: string[];
}

export interface DevelopmentAssetBrief {
  schemaVersion: "development-asset-brief.v1";
  id: string;
  projectId: string;
  assetType: "character" | "location" | "prop" | "wardrobe_makeup" | "vehicle" | "creature" | "vfx_sfx" | "other";
  assetIntent: string;
  storyFunction: string;
  visualHypothesis: string;
  knownUnknowns: string[];
  notProductionReadyReason: string;
  sourceStageType?: string;
  styleLockId?: string;
  productionReady: false;
  createdAt?: number;
  updatedAt?: number;
}

export interface ScriptCoverageSummary {
  expectedEpisodeCount?: number;
  lockedEpisodeCount?: number;
  expectedSceneCount?: number;
  lockedSceneCount?: number;
  expectedSequenceCount?: number;
  lockedSequenceCount?: number;
}

export interface ScriptLockPackage {
  schemaVersion: "script-lock-package.v1";
  id: string;
  projectId: string;
  format: Exclude<ProductionLockFormat, "interactive">;
  lockScope: Exclude<ProductionLockScope, "node_block" | "chapter_block">;
  episodeIds: string[];
  sceneIds: string[];
  sequenceIds?: string[];
  scriptRevision: string;
  coverageRatio: number;
  scriptCoverage?: ScriptCoverageSummary;
  approvedBy?: string;
  approvalState: ProductionLockApprovalState;
  unlockedRisks: string[];
  lockedAt?: number;
  createdAt?: number;
}

export interface ContentLockPackage {
  schemaVersion: "content-lock-package.v1";
  id: string;
  projectId: string;
  format: "interactive";
  lockScope: Extract<ProductionLockScope, "node_block" | "chapter_block">;
  graphRevision: string;
  nodeIds: string[];
  variableStateIds: string[];
  goldenPathNodeIds: string[];
  endingNodeIds: string[];
  failurePathNodeIds: string[];
  endingCoverageRatio: number;
  unreachableNodeIds: string[];
  unlockedNodeIds: string[];
  variableGaps: string[];
  approvedBy?: string;
  approvalState: ProductionLockApprovalState;
  lockedAt?: number;
  createdAt?: number;
}

export interface ProductionBlockLock {
  schemaVersion: "production-block-lock.v1";
  id: string;
  projectId: string;
  blockId: string;
  mode: ProductionLockFormat;
  lockType: "full_project" | "episode_block" | "scene_range" | "node_block" | "sample";
  episodeIds: string[];
  sceneIds: string[];
  nodeIds: string[];
  scriptLockPackageId?: string;
  contentLockPackageId?: string;
  entryCriteria: string[];
  exitCriteria: string[];
  openDependencies: string[];
  status: "draft" | "locked" | "blocked" | "superseded" | "cancelled";
  createdAt?: number;
  lockedAt?: number;
}

export interface BuildLegacyProductionLockDraftInput {
  project: {
    id: string;
    type?: ProductionLockFormat;
    projectModel?: string;
    interactiveTemplate?: string;
    targetEpisodeCount?: number;
    characters?: Array<{
      id?: string;
      name?: string;
      roleType?: string;
      role?: string;
      brief?: string;
      description?: string;
    }>;
    assets?: Array<{
      id?: string;
      name?: string;
      type?: string;
      prompt?: string;
      description?: string;
      panoramaPrompt?: string;
      multiViewPrompt?: string;
    }>;
    gameData?: {
      nodes?: Array<{ id?: string; isEnding?: boolean }>;
      variables?: Array<{ id?: string }>;
    };
  };
  episodes?: Array<{
    id?: string;
    scenes?: Array<{ id?: string }>;
    gameData?: {
      nodes?: Array<{ id?: string; isEnding?: boolean }>;
      variables?: Array<{ id?: string }>;
    };
  }>;
  createdAt?: number;
}

export interface LegacyProductionLockDraftBundle {
  mode: ProductionLockFormat;
  scriptLockPackage?: ScriptLockPackage;
  contentLockPackage?: ContentLockPackage;
  productionBlockLock: ProductionBlockLock;
  developmentAssetBriefs: DevelopmentAssetBrief[];
  legacyAssetPackageDraft: LegacyAssetPackageDraft;
  migrationNotes: string[];
}

export interface LegacyAssetPackageDraft {
  schemaVersion: "legacy-asset-package-draft.v1";
  id: string;
  projectId: string;
  productionReady: false;
  developmentAssetBriefIds: string[];
  legacyAssetRefs: Array<{
    sourceType: "character" | "asset";
    sourceId: string;
    name: string;
    assetType: DevelopmentAssetBrief["assetType"];
    trustLevel: "development_brief_only";
    notProductionReadyReason: string;
  }>;
  formalAssetBlockedReason: string;
  requiredBeforeFormalAssetPackage: string[];
  createdAt: number;
}

export const PRODUCTION_LOCK_MODE_POLICIES: Record<ProductionLockFormat, ProductionLockPolicy> = {
  "single-work": {
    format: "single-work", formalAssetPrecondition: "作者可直接制作所选内容，缺少参考素材时只提示对应生成操作。",
    requiredLockArtifacts: [], allowedLockScopes: ["full_script", "scene_range", "sequence"], rollingProduction: "block_lock_allowed",
    formalAssetRule: "采用的素材保留来源与版本，不要求先完成全片。", forbiddenBehaviors: ["未经作者同意覆盖已采用素材。"], requiredReadModels: [],
  },
  "series-work": {
    format: "series-work", formalAssetPrecondition: "各集可独立制作，跨集复用时保留引用和差异。",
    requiredLockArtifacts: [], allowedLockScopes: ["full_series", "episode_block", "scene_range"], rollingProduction: "block_lock_allowed",
    formalAssetRule: "共享素材按作者选择引用，不把某一集的修改自动覆盖其他集。", forbiddenBehaviors: ["未经作者同意覆盖其他集的内容。"], requiredReadModels: [],
  },
  movie: {
    format: "movie",
    formalAssetPrecondition: "Formal asset packages require an approved full_script script_lock_package before full feature production. Sequence tests must be labelled as samples.",
    requiredLockArtifacts: ["script_lock_package", "production_block_lock", "production_breakdown_report"],
    allowedLockScopes: ["full_script", "scene_range", "sequence"],
    rollingProduction: "not_recommended",
    formalAssetRule: "Do not generate final character/location/prop boards from bible-only material; use development_asset_brief until the screenplay revision is approved.",
    forbiddenBehaviors: [
      "Treating bible characters as final castable identities.",
      "Building full production asset boards before script lock.",
      "Using sequence samples as proof that the full film is locked.",
    ],
    requiredReadModels: ["productionLockSystem", "production_breakdown_report", "production-cockpit.v1"],
  },
  "tv-series": {
    format: "tv-series",
    formalAssetPrecondition: "Formal prep requires a series structure commitment plus an approved production_block_lock for the current episode block.",
    requiredLockArtifacts: ["script_lock_package", "production_block_lock", "production_breakdown_report"],
    allowedLockScopes: ["full_series", "episode_block", "scene_range"],
    rollingProduction: "block_lock_allowed",
    formalAssetRule: "Assets may be prepared for locked episode blocks only; unlocked future episodes must remain visible as open production scope.",
    forbiddenBehaviors: [
      "Adding or deleting episodes after lock without a series_change_order.",
      "Pretending a partially written season is fully deliverable.",
      "Letting current-block assets leak into unlocked episodes without breakdown evidence.",
    ],
    requiredReadModels: ["productionLockSystem", "production_block_lock", "production-cockpit.v1"],
  },
  "short-drama": {
    format: "short-drama",
    formalAssetPrecondition: "Formal prep requires a season/series outline and an approved script lock for the current short-drama production block; full-season lock is preferred when feasible.",
    requiredLockArtifacts: ["script_lock_package", "production_block_lock", "production_breakdown_report"],
    allowedLockScopes: ["full_series", "episode_block", "scene_range"],
    rollingProduction: "block_lock_allowed",
    formalAssetRule: "Because short-drama reuse is dense, wardrobe/prop/location variants must be matrixed from the locked block before storyboard/prompt work.",
    forbiddenBehaviors: [
      "Generating per-scene base character boards repeatedly.",
      "Skipping variant reuse analysis for repeated rooms, costumes, or props.",
      "Calling a few written episodes a complete season.",
    ],
    requiredReadModels: ["productionLockSystem", "production_block_lock", "scene_visual_pack"],
  },
  "micro-short-drama": {
    format: "micro-short-drama",
    formalAssetPrecondition: "Formal prep requires a high-density micro-short structure and an approved script lock for the current full season or production block.",
    requiredLockArtifacts: ["script_lock_package", "production_block_lock", "production_breakdown_report"],
    allowedLockScopes: ["full_script", "episode_block", "scene_range"],
    rollingProduction: "block_lock_allowed",
    formalAssetRule: "Micro-short assets should emphasize reusable identity boards plus scene-specific variant packs driven by locked scenes.",
    forbiddenBehaviors: [
      "Treating isolated hooks as enough for formal asset prep.",
      "Creating unrelated variants when the same package can be reused.",
      "Skipping continuity because episode duration is short.",
    ],
    requiredReadModels: ["productionLockSystem", "production_block_lock", "production-cockpit.v1"],
  },
  interactive: {
    format: "interactive",
    formalAssetPrecondition: "Formal prep requires an approved content_lock_package covering graph nodes, variables, Golden Path, endings, and node scripts for the current node/chapter block.",
    requiredLockArtifacts: ["content_lock_package", "production_block_lock", "production_breakdown_report"],
    allowedLockScopes: ["node_block", "chapter_block"],
    rollingProduction: "chapter_or_node_lock_allowed",
    formalAssetRule: "Do not derive assets from linear scenes alone; include variable states, failure paths, ending paths, and node reuse.",
    forbiddenBehaviors: [
      "Ignoring variables or unreachable nodes in asset prep.",
      "Using linear episode lock rules as the only interactive gate.",
      "Generating formal props or costumes for node states that are not reachable or locked.",
    ],
    requiredReadModels: ["productionLockSystem", "content_lock_package", "interactive_graph_qa"],
  },
  "ai-video-sample": {
    format: "ai-video-sample",
    formalAssetPrecondition: "Samples may use a minimal scene/node lock, but must be labelled as prototype/sample and cannot become the formal asset source of truth.",
    requiredLockArtifacts: ["development_asset_brief", "production_block_lock"],
    allowedLockScopes: ["scene_range", "sequence", "node_block"],
    rollingProduction: "sample_only",
    formalAssetRule: "Temporary sample packages are allowed only inside the declared sample scope and must not pollute formal character/location/prop identity boards.",
    forbiddenBehaviors: [
      "Promoting sample assets to formal production without re-lock and breakdown.",
      "Hiding sample scope from cockpit or Operator handoff.",
      "Skipping style lock because the output is a sample.",
    ],
    requiredReadModels: ["productionLockSystem", "visualStyleLock", "production-cockpit.v1"],
  },
};

const compact = (value: unknown) => String(value || "").trim();
const asStringArray = (value: unknown): string[] => Array.isArray(value)
  ? Array.from(new Set(value.map((item) => compact(item)).filter(Boolean)))
  : [];

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const inferLegacyMode = (project: BuildLegacyProductionLockDraftInput["project"]): ProductionLockFormat => {
  if (project.projectModel === "interactive" || project.interactiveTemplate) return "interactive";
  if (project.type && PRODUCTION_LOCK_MODE_POLICIES[project.type]) return project.type;
  return "ai-video-sample";
};

const getLegacyGameData = (
  project: BuildLegacyProductionLockDraftInput["project"],
  episodes: NonNullable<BuildLegacyProductionLockDraftInput["episodes"]>,
) => project.gameData?.nodes?.length
  ? project.gameData
  : episodes.find((episode) => episode.gameData?.nodes?.length)?.gameData;

const legacyAssetType = (type?: string): DevelopmentAssetBrief["assetType"] => {
  if (type === "character") return "character";
  if (type === "location") return "location";
  if (type === "prop") return "prop";
  if (type === "wardrobe" || type === "makeupHair" || type === "wardrobe_makeup") return "wardrobe_makeup";
  if (type === "vehicle" || type === "vehicles") return "vehicle";
  if (type === "vfx" || type === "sfx" || type === "vfx_sfx") return "vfx_sfx";
  return "other";
};

const buildLegacyDevelopmentAssetBriefs = (
  project: BuildLegacyProductionLockDraftInput["project"],
  createdAt: number,
): DevelopmentAssetBrief[] => {
  const characterBriefs = asStringArray((project.characters || []).map((character) => character.id || character.name)).map((key) => {
    const character = (project.characters || []).find((item) => (item.id || item.name) === key);
    const name = compact(character?.name || key);
    return {
      schemaVersion: "development-asset-brief.v1" as const,
      id: `legacy-development-brief-${project.id}-character-${compact(character?.id || name).replace(/\s+/g, "-")}`,
      projectId: project.id,
      assetType: "character" as const,
      assetIntent: `旧项目角色方向：${name}`,
      storyFunction: compact(character?.role || character?.roleType || character?.brief || character?.description) || "legacy 项目中已有角色，待剧本锁定后重新确认功能位和选角需求。",
      visualHypothesis: compact(character?.description || character?.brief) || "旧项目遗留视觉方向，仅作为开发期参考。",
      knownUnknowns: ["未绑定 script/content lock。", "未绑定 casting_requirement。", "未绑定 approved casting_decision。"],
      notProductionReadyReason: "legacy_unlocked 旧角色只能作为 development_asset_brief；正式资产必须经 lock、production_breakdown、casting_decision 和 department prep 重跑。",
      sourceStageType: "asset_detail",
      productionReady: false as const,
      createdAt,
    };
  });
  const assetBriefs = asStringArray((project.assets || []).map((asset) => asset.id || asset.name)).map((key) => {
    const asset = (project.assets || []).find((item) => (item.id || item.name) === key);
    const name = compact(asset?.name || key);
    const assetType = legacyAssetType(asset?.type);
    return {
      schemaVersion: "development-asset-brief.v1" as const,
      id: `legacy-development-brief-${project.id}-${assetType}-${compact(asset?.id || name).replace(/\s+/g, "-")}`,
      projectId: project.id,
      assetType,
      assetIntent: `旧项目资产方向：${name}`,
      storyFunction: compact(asset?.description) || "legacy 项目中已有资产，待 production_breakdown 后确认出现范围和部门用途。",
      visualHypothesis: compact(asset?.prompt || asset?.panoramaPrompt || asset?.multiViewPrompt || asset?.description) || "旧项目遗留视觉方向，仅作为开发期参考。",
      knownUnknowns: ["未绑定 production_breakdown_report scene/node matrix。", "未绑定 department_prep_package。", "未绑定 scene_asset_variant_pack。"],
      notProductionReadyReason: "legacy_unlocked 旧资产只能作为 development_asset_brief；正式资产包必须由 formal_ready asset_board_plan 和 production prep 重新生成。",
      sourceStageType: "asset_detail",
      productionReady: false as const,
      createdAt,
    };
  });
  return [...characterBriefs, ...assetBriefs];
};

const buildLegacyAssetPackageDraft = (
  project: BuildLegacyProductionLockDraftInput["project"],
  briefs: DevelopmentAssetBrief[],
  createdAt: number,
): LegacyAssetPackageDraft => ({
  schemaVersion: "legacy-asset-package-draft.v1",
  id: `legacy-asset-package-draft-${project.id}-${createdAt}`,
  projectId: project.id,
  productionReady: false,
  developmentAssetBriefIds: briefs.map((brief) => brief.id),
  legacyAssetRefs: [
    ...(project.characters || []).map((character) => ({
      sourceType: "character" as const,
      sourceId: compact(character.id || character.name),
      name: compact(character.name || character.id),
      assetType: "character" as const,
      trustLevel: "development_brief_only" as const,
      notProductionReadyReason: "旧角色缺少 casting_requirement/casting_decision，不能直接进入正式身份板。",
    })),
    ...(project.assets || []).map((asset) => ({
      sourceType: "asset" as const,
      sourceId: compact(asset.id || asset.name),
      name: compact(asset.name || asset.id),
      assetType: legacyAssetType(asset.type),
      trustLevel: "development_brief_only" as const,
      notProductionReadyReason: "旧资产缺少 production_breakdown/departments/variant refs，不能直接进入正式资产包。",
    })),
  ].filter((ref) => ref.sourceId && ref.name),
  formalAssetBlockedReason: "legacy_unlocked 草案只迁移旧资产方向；正式 formal_asset_package 必须等 lock approved、block locked、production_breakdown/casting/department prep/casting_decision 全部完成。",
  requiredBeforeFormalAssetPackage: [
    "approved script_lock_package or content_lock_package",
    "locked production_block_lock",
    "production_breakdown_report QA passed",
    "casting_requirement and approved casting_decision for characters",
    "department_prep_package QA passed",
    "formal_ready asset_board_plan",
  ],
  createdAt,
});

export const buildLegacyProductionLockDraftBundle = ({
  project,
  episodes = [],
  createdAt = Date.now(),
}: BuildLegacyProductionLockDraftInput): LegacyProductionLockDraftBundle => {
  const mode = inferLegacyMode(project);
  const developmentAssetBriefs = buildLegacyDevelopmentAssetBriefs(project, createdAt);
  const legacyAssetPackageDraft = buildLegacyAssetPackageDraft(project, developmentAssetBriefs, createdAt);
  const episodeIds = asStringArray(episodes.map((episode) => episode.id));
  const sceneIds = asStringArray(episodes.flatMap((episode) => (episode.scenes || []).map((scene) => scene.id)));
  const targetEpisodeCount = Math.max(Number(project.targetEpisodeCount || 0), episodeIds.length);
  if (mode === "interactive") {
    const gameData = getLegacyGameData(project, episodes);
    const nodeIds = asStringArray((gameData?.nodes || []).map((node) => node.id));
    const variableStateIds = asStringArray((gameData?.variables || []).map((variable) => variable.id));
    const endingNodeIds = asStringArray((gameData?.nodes || []).filter((node) => node.isEnding).map((node) => node.id));
    const contentLockPackage: ContentLockPackage = {
      schemaVersion: "content-lock-package.v1",
      id: `legacy-content-lock-draft-${project.id}-${createdAt}`,
      projectId: project.id,
      format: "interactive",
      lockScope: "node_block",
      graphRevision: `legacy-draft-${createdAt}`,
      nodeIds,
      variableStateIds,
      goldenPathNodeIds: nodeIds.slice(0, Math.max(1, Math.min(3, nodeIds.length))),
      endingNodeIds,
      failurePathNodeIds: [],
      endingCoverageRatio: endingNodeIds.length ? 1 : 0,
      unreachableNodeIds: [],
      unlockedNodeIds: [],
      variableGaps: variableStateIds.length ? [] : ["legacy draft 未发现变量状态；互动正式锁定前需补变量表。"],
      approvalState: "draft",
      createdAt,
    };
    const productionBlockLock: ProductionBlockLock = {
      schemaVersion: "production-block-lock.v1",
      id: `legacy-production-block-draft-${project.id}-${createdAt}`,
      projectId: project.id,
      blockId: "legacy-node-block-draft",
      mode,
      lockType: "node_block",
      episodeIds: [],
      sceneIds: [],
      nodeIds,
      contentLockPackageId: contentLockPackage.id,
      entryCriteria: ["legacy project migration draft", "content lock must be director/showrunner approved before formal prep"],
      exitCriteria: ["production_breakdown_report QA reviewed", "department_prep_package QA reviewed"],
      openDependencies: ["content_lock_package 尚未 approved", "production_block_lock 尚未 locked"],
      status: "draft",
      createdAt,
    };
    return {
      mode,
      contentLockPackage,
      productionBlockLock,
      developmentAssetBriefs,
      legacyAssetPackageDraft,
      migrationNotes: [
        "legacy_unlocked 互动项目已生成 content/block lock 草案。",
        "旧角色/资产已降级为 development_asset_brief，不能直接作为正式资产包。",
        "草案只能用于迁移审查；正式资产筹备前必须人工批准并重跑 QA。",
      ],
    };
  }

  const lockScope: ScriptLockPackage["lockScope"] =
    mode === "movie" && targetEpisodeCount <= 1 ? "full_script" : "episode_block";
  const scriptLockPackage: ScriptLockPackage = {
    schemaVersion: "script-lock-package.v1",
    id: `legacy-script-lock-draft-${project.id}-${createdAt}`,
    projectId: project.id,
    format: mode,
    lockScope,
    episodeIds,
    sceneIds,
    scriptRevision: `legacy-draft-${createdAt}`,
    coverageRatio: targetEpisodeCount ? Math.min(1, episodeIds.length / targetEpisodeCount) : episodeIds.length ? 1 : 0,
    scriptCoverage: {
      expectedEpisodeCount: targetEpisodeCount || episodeIds.length,
      lockedEpisodeCount: episodeIds.length,
      expectedSceneCount: sceneIds.length,
      lockedSceneCount: sceneIds.length,
    },
    approvalState: "draft",
    unlockedRisks: [
      "legacy_unlocked 迁移草案尚未由导演/制片批准。",
      ...(targetEpisodeCount > episodeIds.length ? [`目标 ${targetEpisodeCount} 集中当前仅发现 ${episodeIds.length} 集。`] : []),
    ],
    createdAt,
  };
  const productionBlockLock: ProductionBlockLock = {
    schemaVersion: "production-block-lock.v1",
    id: `legacy-production-block-draft-${project.id}-${createdAt}`,
    projectId: project.id,
    blockId: episodeIds.length ? `legacy-episodes-${episodeIds[0]}-${episodeIds[episodeIds.length - 1]}` : "legacy-scene-range-draft",
    mode,
    lockType: episodeIds.length ? "episode_block" : "scene_range",
    episodeIds,
    sceneIds,
    nodeIds: [],
    scriptLockPackageId: scriptLockPackage.id,
    entryCriteria: ["legacy project migration draft", "script lock must be director/showrunner approved before formal prep"],
    exitCriteria: ["production_breakdown_report QA reviewed", "casting_requirement QA reviewed", "department_prep_package QA reviewed"],
    openDependencies: ["script_lock_package 尚未 approved", "production_block_lock 尚未 locked"],
    status: "draft",
    createdAt,
  };
  return {
    mode,
    scriptLockPackage,
    productionBlockLock,
    developmentAssetBriefs,
    legacyAssetPackageDraft,
    migrationNotes: [
      "legacy_unlocked 线性项目已生成 script/block lock 草案。",
      "旧角色/资产已降级为 development_asset_brief，不能直接作为正式资产包。",
      "草案只能用于迁移审查；正式资产筹备前必须人工批准并重跑 QA。",
    ],
  };
};

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  options: {
    suggestion?: string;
    issueType?: string;
    retryable?: boolean;
    resolutionClass?: ProductionQAIssue["resolutionClass"];
  } = {},
): ProductionQAIssue => ({
  id: nowId("production_lock_issue"),
  severity,
  target,
  message,
  suggestion: options.suggestion,
  repairInstruction: options.suggestion || message,
  issueType: options.issueType || "production_lock_contract",
  retryable: options.retryable ?? severity !== "blocking",
  resolutionClass: options.resolutionClass,
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const normalizeApprovalIssues = (
  approvalState: unknown,
  target: string,
  artifactLabel: string,
): ProductionQAIssue[] => {
  if (approvalState === "approved") return [];
  if (approvalState === "rejected") {
    return [issue(
      `${target}.approvalState`,
      `${artifactLabel} 已被 rejected，不能作为正式生产锁使用。`,
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    )];
  }
  if (approvalState === "superseded") {
    return [issue(
      `${target}.approvalState`,
      `${artifactLabel} 已 superseded，必须引用最新锁定包。`,
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    )];
  }
  return [issue(
    `${target}.approvalState`,
    `${artifactLabel} 尚未 approved；可作为草案保存，但不能驱动正式资产筹备。`,
    "warning",
    { resolutionClass: "soft_hold" },
  )];
};

export const validateDevelopmentAssetBrief = (
  brief?: Partial<DevelopmentAssetBrief>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!isObject(brief)) {
    return normalizeProductionQAIssues([issue(
      "development_asset_brief",
      "development_asset_brief artifact 必须包含结构化开发资产 brief。",
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    )]);
  }
  if (brief.schemaVersion !== "development-asset-brief.v1") {
    issues.push(issue("development_asset_brief.schemaVersion", "schemaVersion 必须是 development-asset-brief.v1。", "blocking", { retryable: false }));
  }
  if (!compact(brief.id)) issues.push(issue("development_asset_brief.id", "开发资产 brief 缺少 id。", "blocking"));
  if (!compact(brief.projectId)) issues.push(issue("development_asset_brief.projectId", "开发资产 brief 缺少 projectId。", "blocking"));
  if (!compact(brief.assetIntent)) issues.push(issue("development_asset_brief.assetIntent", "开发资产 brief 必须说明资产意图。", "blocking"));
  if (!compact(brief.storyFunction)) issues.push(issue("development_asset_brief.storyFunction", "开发资产 brief 必须说明叙事功能。", "blocking"));
  if (!compact(brief.visualHypothesis)) issues.push(issue("development_asset_brief.visualHypothesis", "开发资产 brief 必须说明视觉假设。", "blocking"));
  if (!compact(brief.notProductionReadyReason)) {
    issues.push(issue("development_asset_brief.notProductionReadyReason", "开发资产 brief 必须说明为什么还不能作为正式资产。", "blocking"));
  }
  if ((brief as any).productionReady === true) {
    issues.push(issue(
      "development_asset_brief.productionReady",
      "development_asset_brief 不能标记为 productionReady=true；正式资产必须走 script/content lock 和 production breakdown。",
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    ));
  }
  if (asStringArray(brief.knownUnknowns).length === 0) {
    issues.push(issue(
      "development_asset_brief.knownUnknowns",
      "建议列出 knownUnknowns，避免后续把概念方向误当正式资产事实。",
      "warning",
      { resolutionClass: "soft_hold" },
    ));
  }
  return normalizeProductionQAIssues(issues);
};

export const validateScriptLockPackage = (
  lock?: Partial<ScriptLockPackage>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!isObject(lock)) {
    return normalizeProductionQAIssues([issue(
      "script_lock_package",
      "script_lock_package artifact 必须包含结构化剧本锁定包。",
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    )]);
  }
  const rawFormat = compact((lock as any).format) as ProductionLockFormat;
  const policy = rawFormat ? PRODUCTION_LOCK_MODE_POLICIES[rawFormat] : undefined;
  if (lock.schemaVersion !== "script-lock-package.v1") {
    issues.push(issue("script_lock_package.schemaVersion", "schemaVersion 必须是 script-lock-package.v1。", "blocking", { retryable: false }));
  }
  if (!compact(lock.id)) issues.push(issue("script_lock_package.id", "剧本锁定包缺少 id。", "blocking"));
  if (!compact(lock.projectId)) issues.push(issue("script_lock_package.projectId", "剧本锁定包缺少 projectId。", "blocking"));
  if (!policy || rawFormat === "interactive") {
    issues.push(issue("script_lock_package.format", "script_lock_package 只能用于 movie/tv-series/short-drama/micro-short-drama/ai-video-sample。", "blocking", { retryable: false }));
  }
  if (!lock.lockScope || !policy?.allowedLockScopes.includes(lock.lockScope)) {
    issues.push(issue("script_lock_package.lockScope", "lockScope 与项目模式不匹配。", "blocking", {
      suggestion: `允许范围：${policy?.allowedLockScopes.join(", ") || "unknown"}`,
    }));
  }
  if (!compact(lock.scriptRevision)) issues.push(issue("script_lock_package.scriptRevision", "剧本锁定包必须绑定 scriptRevision。", "blocking"));
  if (!Number.isFinite(lock.coverageRatio) || Number(lock.coverageRatio) <= 0 || Number(lock.coverageRatio) > 1) {
    issues.push(issue("script_lock_package.coverageRatio", "coverageRatio 必须在 0-1 之间。", "blocking"));
  }
  if ((lock.lockScope === "full_script" || lock.lockScope === "full_series") && Number(lock.coverageRatio) < 1) {
    issues.push(issue(
      "script_lock_package.coverageRatio",
      "full_script/full_series 锁定必须 coverageRatio=1，不能用部分剧本冒充完整锁。",
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    ));
  }
  if (lock.lockScope === "episode_block" && asStringArray(lock.episodeIds).length === 0) {
    issues.push(issue("script_lock_package.episodeIds", "episode_block 锁定必须列出 episodeIds。", "blocking"));
  }
  if ((lock.lockScope === "scene_range" || lock.lockScope === "sequence") && asStringArray(lock.sceneIds).length === 0 && asStringArray(lock.sequenceIds).length === 0) {
    issues.push(issue("script_lock_package.sceneIds", "scene_range/sequence 锁定必须列出 sceneIds 或 sequenceIds。", "blocking"));
  }
  const coverage = lock.scriptCoverage;
  if (coverage?.expectedEpisodeCount && coverage.lockedEpisodeCount !== undefined && coverage.lockedEpisodeCount < coverage.expectedEpisodeCount && lock.lockScope === "full_series") {
    issues.push(issue("script_lock_package.scriptCoverage", "full_series 锁定的 lockedEpisodeCount 小于 expectedEpisodeCount。", "blocking"));
  }
  issues.push(...normalizeApprovalIssues(lock.approvalState, "script_lock_package", "script_lock_package"));
  if (asStringArray(lock.unlockedRisks).length > 0) {
    issues.push(issue(
      "script_lock_package.unlockedRisks",
      "剧本锁定包仍声明 unlockedRisks；正式资产筹备前需在 cockpit 中持续可见。",
      "warning",
      { resolutionClass: "soft_hold" },
    ));
  }
  return normalizeProductionQAIssues(issues);
};

export const validateContentLockPackage = (
  lock?: Partial<ContentLockPackage>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!isObject(lock)) {
    return normalizeProductionQAIssues([issue(
      "content_lock_package",
      "content_lock_package artifact 必须包含结构化互动内容锁定包。",
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    )]);
  }
  if (lock.schemaVersion !== "content-lock-package.v1") {
    issues.push(issue("content_lock_package.schemaVersion", "schemaVersion 必须是 content-lock-package.v1。", "blocking", { retryable: false }));
  }
  if (!compact(lock.id)) issues.push(issue("content_lock_package.id", "互动内容锁定包缺少 id。", "blocking"));
  if (!compact(lock.projectId)) issues.push(issue("content_lock_package.projectId", "互动内容锁定包缺少 projectId。", "blocking"));
  if (lock.format !== "interactive") issues.push(issue("content_lock_package.format", "content_lock_package 只能用于 interactive 模式。", "blocking", { retryable: false }));
  if (!lock.lockScope || !PRODUCTION_LOCK_MODE_POLICIES.interactive.allowedLockScopes.includes(lock.lockScope)) {
    issues.push(issue("content_lock_package.lockScope", "互动内容锁定必须使用 node_block 或 chapter_block。", "blocking"));
  }
  if (!compact(lock.graphRevision)) issues.push(issue("content_lock_package.graphRevision", "互动内容锁定必须绑定 graphRevision。", "blocking"));
  if (asStringArray(lock.nodeIds).length === 0) issues.push(issue("content_lock_package.nodeIds", "互动内容锁定必须列出 nodeIds。", "blocking"));
  if (asStringArray(lock.goldenPathNodeIds).length === 0) {
    issues.push(issue("content_lock_package.goldenPathNodeIds", "互动内容锁定必须覆盖 Golden Path。", "blocking"));
  }
  if (asStringArray(lock.endingNodeIds).length === 0) {
    issues.push(issue("content_lock_package.endingNodeIds", "互动内容锁定必须声明结局节点集合。", "blocking"));
  }
  if (asStringArray(lock.failurePathNodeIds).length === 0) {
    issues.push(issue(
      "content_lock_package.failurePathNodeIds",
      "互动内容锁定未声明失败路径；如果该互动项目确实没有失败路径，需要在制作统筹中显式说明。",
      "warning",
      { resolutionClass: "soft_hold" },
    ));
  }
  if (asStringArray(lock.variableStateIds).length === 0) {
    issues.push(issue("content_lock_package.variableStateIds", "互动内容锁定必须声明变量状态集合。", "blocking"));
  }
  if (!Number.isFinite(lock.endingCoverageRatio) || Number(lock.endingCoverageRatio) <= 0 || Number(lock.endingCoverageRatio) > 1) {
    issues.push(issue("content_lock_package.endingCoverageRatio", "endingCoverageRatio 必须在 0-1 之间。", "blocking"));
  } else if (Number(lock.endingCoverageRatio) < 1) {
    issues.push(issue(
      "content_lock_package.endingCoverageRatio",
      "互动内容锁定未覆盖全部目标结局；可继续 block 生产，但正式交付前必须可见。",
      "warning",
      { resolutionClass: "soft_hold" },
    ));
  }
  if (asStringArray(lock.unreachableNodeIds).length > 0) {
    issues.push(issue("content_lock_package.unreachableNodeIds", "仍存在不可达节点，需要互动图谱 QA 处理。", "warning", { resolutionClass: "soft_hold" }));
  }
  if (asStringArray(lock.unlockedNodeIds).length > 0) {
    issues.push(issue("content_lock_package.unlockedNodeIds", "仍存在未锁节点，不能把它们纳入正式资产筹备。", "warning", { resolutionClass: "soft_hold" }));
  }
  if (asStringArray(lock.variableGaps).length > 0) {
    issues.push(issue("content_lock_package.variableGaps", "仍存在变量状态缺口，相关资产状态必须暂缓正式化。", "warning", { resolutionClass: "soft_hold" }));
  }
  issues.push(...normalizeApprovalIssues(lock.approvalState, "content_lock_package", "content_lock_package"));
  return normalizeProductionQAIssues(issues);
};

export const validateProductionBlockLock = (
  lock?: Partial<ProductionBlockLock>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!isObject(lock)) {
    return normalizeProductionQAIssues([issue(
      "production_block_lock",
      "production_block_lock artifact 必须包含结构化生产批次锁。",
      "blocking",
      { retryable: false, resolutionClass: "hard_blocking" },
    )]);
  }
  const policy = lock.mode ? PRODUCTION_LOCK_MODE_POLICIES[lock.mode] : undefined;
  if (lock.schemaVersion !== "production-block-lock.v1") {
    issues.push(issue("production_block_lock.schemaVersion", "schemaVersion 必须是 production-block-lock.v1。", "blocking", { retryable: false }));
  }
  if (!compact(lock.id)) issues.push(issue("production_block_lock.id", "生产批次锁缺少 id。", "blocking"));
  if (!compact(lock.projectId)) issues.push(issue("production_block_lock.projectId", "生产批次锁缺少 projectId。", "blocking"));
  if (!compact(lock.blockId)) issues.push(issue("production_block_lock.blockId", "生产批次锁缺少 blockId。", "blocking"));
  if (!policy) issues.push(issue("production_block_lock.mode", "production_block_lock.mode 必须是已知生产模式。", "blocking", { retryable: false }));
  if (!lock.lockType) issues.push(issue("production_block_lock.lockType", "生产批次锁缺少 lockType。", "blocking"));
  const isInteractive = lock.mode === "interactive";
  if (isInteractive) {
    if (!compact(lock.contentLockPackageId)) issues.push(issue("production_block_lock.contentLockPackageId", "互动 block lock 必须引用 contentLockPackageId。", "blocking"));
    if (asStringArray(lock.nodeIds).length === 0) issues.push(issue("production_block_lock.nodeIds", "互动 block lock 必须列出 nodeIds。", "blocking"));
  } else if (lock.mode !== "ai-video-sample") {
    if (!compact(lock.scriptLockPackageId)) issues.push(issue("production_block_lock.scriptLockPackageId", "线性影视 block lock 必须引用 scriptLockPackageId。", "blocking"));
    if (asStringArray(lock.episodeIds).length === 0 && asStringArray(lock.sceneIds).length === 0) {
      issues.push(issue("production_block_lock.episodeIds", "线性影视 block lock 必须列出 episodeIds 或 sceneIds。", "blocking"));
    }
  }
  if (asStringArray(lock.entryCriteria).length === 0) {
    issues.push(issue("production_block_lock.entryCriteria", "生产批次锁必须声明 entryCriteria。", "blocking"));
  }
  if (asStringArray(lock.exitCriteria).length === 0) {
    issues.push(issue("production_block_lock.exitCriteria", "生产批次锁必须声明 exitCriteria。", "blocking"));
  }
  if (lock.status === "blocked" || lock.status === "cancelled") {
    issues.push(issue("production_block_lock.status", "生产批次锁处于 blocked/cancelled，不能推进正式筹备。", "blocking", {
      retryable: false,
      resolutionClass: "hard_blocking",
    }));
  } else if (lock.status !== "locked") {
    issues.push(issue("production_block_lock.status", "production_block_lock 尚未 locked；可保存草案，但不能驱动正式资产筹备。", "warning", {
      resolutionClass: "soft_hold",
    }));
  }
  if (asStringArray(lock.openDependencies).length > 0) {
    issues.push(issue("production_block_lock.openDependencies", "生产批次仍有开放依赖，必须在 cockpit 中持续可见。", "warning", {
      resolutionClass: "soft_hold",
    }));
  }
  return normalizeProductionQAIssues(issues);
};

export const buildProductionLockSystem = () => ({
  schemaVersion: "production-lock-system.v1",
  status: "production_lock_contract_stage_integrated",
  purpose: "Separate development asset exploration from formal production assets, and require script/content/block locks before production asset prep.",
  artifactKinds: [
    "development_asset_brief",
    "script_lock_package",
    "content_lock_package",
    "production_block_lock",
  ],
  modePolicies: Object.values(PRODUCTION_LOCK_MODE_POLICIES),
  formalAssetPreconditions: Object.fromEntries(
    Object.entries(PRODUCTION_LOCK_MODE_POLICIES).map(([format, policy]) => [format, policy.formalAssetPrecondition]),
  ),
  qaFunctions: [
    "validateDevelopmentAssetBrief",
    "validateScriptLockPackage",
    "validateContentLockPackage",
    "validateProductionBlockLock",
  ],
  requiredBehavior: [
    "Treat bible-time assets as development_asset_brief until a script/content lock and production breakdown exist.",
    "Legacy production upgrade must convert old characters/assets into development_asset_brief and legacyAssetPackageDraft with productionReady=false before formal asset package work.",
    "Movie formal asset boards require an approved full_script lock unless the scope is explicitly labelled sample/sequence.",
    "TV series, short drama, and micro-short drama may use production_block_lock, but unlocked episodes must remain visible as open scope.",
    "Interactive projects must use content_lock_package over graph nodes, variable states, Golden Path, endings, failure paths, and node scripts before formal asset prep.",
    "Formal character/location/prop/wardrobe boards must be downstream of lock + production_breakdown + casting/department requirements.",
    "Late storyboard inspiration must return through creative_change_request or series_change_order instead of bypassing lock governance.",
  ],
  commitBehavior: "formal_stage_output_with_operator_artifact_qa",
});
