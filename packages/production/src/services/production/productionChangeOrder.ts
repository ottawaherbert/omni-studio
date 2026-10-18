import type { Episode, Project } from "../../../../../src/types/project";
import type { GameProjectData } from "../../../../../src/types/game";
import type { ProductionQAIssue, ProductionStageType } from "../../../../../src/types/production";
import type {
  ContentLockPackage,
  ProductionBlockLock,
  ProductionLockFormat,
  ScriptLockPackage,
} from "./productionLock";
import type { ProductionBreakdownReport } from "./productionPrep";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";

export type SeriesChangeOrderType =
  | "add_episode"
  | "delete_episode"
  | "reorder_episode"
  | "rewrite_episode"
  | "add_scene"
  | "delete_scene"
  | "rewrite_scene"
  | "add_node"
  | "delete_node"
  | "rewrite_node"
  | "node_variable_change"
  | "choice_change"
  | "ending_change"
  | "role_change"
  | "asset_state_change"
  | "target_episode_count_change"
  | "other";

export type SeriesChangeOrderStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "applied"
  | "superseded";

export interface SeriesChangeOrderRequestedChange {
  id: string;
  targetType: "episode" | "scene" | "node" | "choice" | "variable" | "ending" | "character" | "asset" | "structure" | "other";
  operation: "add" | "delete" | "rewrite" | "reorder" | "replace" | "state_change" | "count_change" | "other";
  targetId?: string;
  title?: string;
  description: string;
  reason?: string;
}

export interface SeriesChangeOrder {
  schemaVersion: "series-change-order.v1";
  id: string;
  projectId: string;
  mode: ProductionLockFormat;
  changeType: SeriesChangeOrderType;
  title: string;
  reason: string;
  status: SeriesChangeOrderStatus;
  requestedChanges: SeriesChangeOrderRequestedChange[];
  /** Immutable screenplay evidence that caused this downstream change request. */
  sourceScriptRevision?: {
    revisionId: string;
    revision: number;
    unitIds: string[];
  };
  sourceLockIds: string[];
  productionBlockLockId?: string;
  affectedEpisodes: string[];
  affectedScenes: string[];
  affectedNodes: string[];
  affectedAssets: string[];
  impactOnStructure: {
    requiresStructureUpdate: boolean;
    targetEpisodeCountBefore?: number;
    targetEpisodeCountAfter?: number;
    episodeCountBefore?: number;
    episodeCountAfter?: number;
    notes: string[];
  };
  impactOnAssets: {
    affectedAssetIds: string[];
    affectedDepartments: string[];
    requiresNewFormalAssets: boolean;
    requiresVariantReplan: boolean;
    notes: string[];
  };
  impactOnInteractive: {
    affectedNodeIds: string[];
    affectedChoiceIds: string[];
    affectedVariableStateIds: string[];
    affectedEndingNodeIds: string[];
    requiresGraphQA: boolean;
    requiresPlaytest: boolean;
    notes: string[];
  };
  requiredReLocks: Array<"script_lock_package" | "content_lock_package" | "production_block_lock">;
  requiredStageReruns: ProductionStageType[];
  staleArtifactKinds: string[];
  localResyncPlan: {
    required: boolean;
    affectedStageTypes: ProductionStageType[];
    staleTargetPaths: string[];
    reason: string;
  };
  humanApprovalRequired: true;
  approvedBy?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface BuildSeriesChangeOrderInput {
  project: Project;
  episodes?: Episode[];
  changeType: SeriesChangeOrderType;
  title?: string;
  reason: string;
  requestedChanges: Array<Partial<SeriesChangeOrderRequestedChange>>;
  sourceScriptRevision?: SeriesChangeOrder["sourceScriptRevision"];
  status?: SeriesChangeOrderStatus;
  scriptLockPackage?: Partial<ScriptLockPackage>;
  contentLockPackage?: Partial<ContentLockPackage>;
  productionBlockLock?: Partial<ProductionBlockLock>;
  productionBreakdownReport?: Partial<ProductionBreakdownReport>;
  affectedEpisodeIds?: string[];
  affectedSceneIds?: string[];
  affectedNodeIds?: string[];
  affectedChoiceIds?: string[];
  affectedVariableStateIds?: string[];
  affectedEndingNodeIds?: string[];
  affectedAssetIds?: string[];
  targetEpisodeCountAfter?: number;
  approvedBy?: string;
  createdAt?: number;
}

export interface ProductionSeriesGovernanceSnapshot {
  schemaVersion: "production-series-governance.v1";
  projectId: string;
  mode: ProductionLockFormat;
  lockStatus: "legacy_unlocked" | "unlocked" | "partially_locked" | "fully_locked" | "interactive_content_locked";
  currentBlock?: {
    id: string;
    blockId: string;
    lockType: ProductionBlockLock["lockType"];
    episodeIds: string[];
    sceneIds: string[];
    nodeIds: string[];
    status: ProductionBlockLock["status"];
  };
  scriptCoverage: {
    targetEpisodeCount: number;
    existingEpisodeCount: number;
    lockedEpisodeCount: number;
    knownUnlockedEpisodeIds: string[];
    missingEpisodeCount: number;
    coverageRatio: number;
    fullSeriesLocked: boolean;
  };
  contentCoverage: {
    lockedNodeCount: number;
    knownNodeCount: number;
    knownUnlockedNodeIds: string[];
    coverageRatio: number;
  };
  breakdownCoverage: {
    productionBreakdownReportIds: string[];
    lockedSceneCount: number;
    breakdownSceneCount: number;
    lockedNodeCount: number;
    breakdownNodeCount: number;
    coverageRatio: number;
  };
  assetPrepReadiness: {
    scope: "not_ready" | "current_block_only" | "full_series" | "interactive_node_block";
    currentBlockReady: boolean;
    fullSeriesReady: boolean;
    blockers: string[];
  };
  changeOrders: {
    openCount: number;
    approvedCount: number;
    appliedCount: number;
    pendingReviewCount: number;
    changeOrderIds: string[];
    openChangeOrderIds: string[];
  };
  nextActions: string[];
}

export interface BuildProductionSeriesGovernanceInput {
  project: Project;
  episodes?: Episode[];
  gameData?: GameProjectData;
  scriptLockPackages?: Partial<ScriptLockPackage>[];
  contentLockPackages?: Partial<ContentLockPackage>[];
  productionBlockLocks?: Partial<ProductionBlockLock>[];
  productionBreakdownReports?: Partial<ProductionBreakdownReport>[];
  seriesChangeOrders?: Partial<SeriesChangeOrder>[];
}

const compact = (value: unknown) => String(value || "").trim();

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => compact(item)).filter(Boolean)));

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: nowId("series_change_order_issue"),
  severity,
  target,
  message,
  suggestion,
  repairInstruction: suggestion || message,
  issueType: "series_change_order_contract",
  retryable: severity !== "blocking",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "soft_hold",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
});

const projectMode = (project: Project): ProductionLockFormat => {
  if (project.type === "single-work" || project.type === "series-work") return project.type;
  if (project.projectModel === "interactive" || (project as any).type === "interactive") return "interactive";
  if (project.type === "movie" || project.type === "tv-series" || project.type === "short-drama" || project.type === "micro-short-drama") {
    return project.type;
  }
  return "ai-video-sample";
};

const locked = (state?: string) => state === "approved" || state === "locked" || state === "applied";

const stageRerunsForChange = (
  changeType: SeriesChangeOrderType,
  mode: ProductionLockFormat,
): ProductionStageType[] => {
  const isInteractive = mode === "interactive" || ["add_node", "delete_node", "rewrite_node", "node_variable_change", "choice_change", "ending_change"].includes(changeType);
  const lockStage: ProductionStageType = isInteractive ? "content_lock" : "script_lock";
  const interactiveGraphStages: ProductionStageType[] = isInteractive
    ? ["interactive_graph_qa", "node_to_scene", "interactive_script"]
    : [];
  const downstream: ProductionStageType[] = [
    ...interactiveGraphStages,
    lockStage,
    "production_breakdown",
    "production_asset_detail",
    isInteractive ? "interactive_storyboard" : "asset_sync",
  ];
  if (!isInteractive) downstream.push("storyboard", "prompt");
  if (changeType === "asset_state_change") {
    return uniq(["production_breakdown", "production_asset_detail", "asset_sync", "storyboard", "prompt"]) as ProductionStageType[];
  }
  return downstream;
};

const requiredLocksForMode = (
  mode: ProductionLockFormat,
): SeriesChangeOrder["requiredReLocks"] =>
  mode === "interactive"
    ? ["content_lock_package", "production_block_lock"]
    : ["script_lock_package", "production_block_lock"];

const staleArtifactsForChange = (
  changeType: SeriesChangeOrderType,
): string[] => {
  const isInteractive = ["add_node", "delete_node", "rewrite_node", "node_variable_change", "choice_change", "ending_change"].includes(changeType);
  const base = [
    ...(isInteractive ? ["content_lock_package", "production_block_lock", "interactive_graph_qa"] : []),
    "production_breakdown_report",
    "casting_requirement",
    "department_prep_package",
    "continuity_matrix",
    "asset_board_plan",
  ];
  if (changeType === "asset_state_change") {
    return [...base, "scene_visual_pack", "asset_reference_pack", "video_generation_unit"];
  }
  return [...base, "scene_visual_pack", "storyboard_board", "asset_reference_pack", "video_generation_unit"];
};

export const buildSeriesChangeOrder = (input: BuildSeriesChangeOrderInput): SeriesChangeOrder => {
  const createdAt = input.createdAt || Date.now();
  const mode = projectMode(input.project);
  const episodes = input.episodes || asArray<Episode>((input.project as any).episodes);
  const requestedChanges = input.requestedChanges.map((change, index) => ({
    id: compact(change.id) || `change-${index + 1}`,
    targetType: change.targetType || "other",
    operation: change.operation || "other",
    targetId: compact(change.targetId) || undefined,
    title: compact(change.title) || undefined,
    description: compact(change.description) || input.reason,
    reason: compact(change.reason) || undefined,
  }));
  const affectedEpisodes = uniq([
    ...asArray<string>(input.affectedEpisodeIds),
    ...requestedChanges.filter((change) => change.targetType === "episode").map((change) => change.targetId),
  ]);
  const affectedScenes = uniq([
    ...asArray<string>(input.affectedSceneIds),
    ...requestedChanges.filter((change) => change.targetType === "scene").map((change) => change.targetId),
  ]);
  const affectedNodes = uniq([
    ...asArray<string>(input.affectedNodeIds),
    ...requestedChanges.filter((change) => change.targetType === "node").map((change) => change.targetId),
  ]);
  const affectedChoices = uniq([
    ...asArray<string>(input.affectedChoiceIds),
    ...requestedChanges.filter((change) => change.targetType === "choice").map((change) => change.targetId),
  ]);
  const affectedVariableStateIds = uniq([
    ...asArray<string>(input.affectedVariableStateIds),
    ...requestedChanges.filter((change) => change.targetType === "variable").map((change) => change.targetId),
  ]);
  const affectedEndingNodeIds = uniq([
    ...asArray<string>(input.affectedEndingNodeIds),
    ...requestedChanges.filter((change) => change.targetType === "ending").map((change) => change.targetId),
    ...(input.changeType === "ending_change" ? affectedNodes : []),
  ]);
  const affectedAssets = uniq([
    ...asArray<string>(input.affectedAssetIds),
    ...requestedChanges.filter((change) => change.targetType === "asset" || change.targetType === "character").map((change) => change.targetId),
  ]);
  const sourceLockIds = uniq([
    input.scriptLockPackage?.id,
    input.contentLockPackage?.id,
    input.productionBlockLock?.id,
    input.productionBreakdownReport?.id,
  ]);
  const stageReruns = stageRerunsForChange(input.changeType, mode);
  const targetEpisodeCountBefore = Number(input.project.targetEpisodeCount || episodes.length || 0) || undefined;
  const targetEpisodeCountAfter = Number(input.targetEpisodeCountAfter || targetEpisodeCountBefore || 0) || undefined;
  return {
    schemaVersion: "series-change-order.v1",
    id: `series-change-order-${input.project.id}-${input.changeType}-${createdAt}`,
    projectId: input.project.id,
    mode,
    changeType: input.changeType,
    title: compact(input.title) || `锁定后变更：${input.changeType}`,
    reason: input.reason,
    status: input.status || "pending_review",
    requestedChanges,
    sourceScriptRevision: input.sourceScriptRevision?.revisionId
      ? {
        revisionId: input.sourceScriptRevision.revisionId,
        revision: Number(input.sourceScriptRevision.revision || 0),
        unitIds: uniq(input.sourceScriptRevision.unitIds || []),
      }
      : undefined,
    sourceLockIds,
    productionBlockLockId: input.productionBlockLock?.id,
    affectedEpisodes,
    affectedScenes,
    affectedNodes,
    affectedAssets,
    impactOnStructure: {
      requiresStructureUpdate: ["add_episode", "delete_episode", "reorder_episode", "target_episode_count_change", "add_node", "delete_node"].includes(input.changeType),
      targetEpisodeCountBefore,
      targetEpisodeCountAfter,
      episodeCountBefore: episodes.length,
      episodeCountAfter: input.changeType === "add_episode"
        ? episodes.length + Math.max(1, affectedEpisodes.length || requestedChanges.length)
        : input.changeType === "delete_episode"
          ? Math.max(0, episodes.length - Math.max(1, affectedEpisodes.length || requestedChanges.length))
          : episodes.length,
      notes: [
        `changeType=${input.changeType}`,
        sourceLockIds.length ? `sourceLocks=${sourceLockIds.join(",")}` : "缺少锁定来源，必须由统筹确认是否属于 legacy_unlocked。",
      ],
    },
    impactOnAssets: {
      affectedAssetIds: affectedAssets,
      affectedDepartments: uniq([
        "production",
        "continuity",
        "casting",
        "wardrobe_makeup",
        "props",
        "location_art",
        ...(mode === "interactive" ? ["ui_interaction", "vfx_sfx"] : []),
      ]),
      requiresNewFormalAssets: ["role_change", "asset_state_change", "add_scene", "add_node", "ending_change"].includes(input.changeType),
      requiresVariantReplan: ["asset_state_change", "rewrite_scene", "rewrite_node", "add_scene", "add_node", "node_variable_change", "choice_change", "ending_change"].includes(input.changeType),
      notes: ["重新计算 production_breakdown_report、department_prep_package、正式资产板和场次视觉包。"],
    },
    impactOnInteractive: {
      affectedNodeIds: affectedNodes,
      affectedChoiceIds: affectedChoices,
      affectedVariableStateIds,
      affectedEndingNodeIds,
      requiresGraphQA: mode === "interactive",
      requiresPlaytest: mode === "interactive" && ["node_variable_change", "choice_change", "ending_change", "delete_node"].includes(input.changeType),
      notes: mode === "interactive"
        ? [
          "互动锁后变更必须重跑 interactive_graph_qa、content_lock、production_breakdown 和 interactive_storyboard。",
          affectedVariableStateIds.length ? `变量状态变化：${affectedVariableStateIds.join(",")}` : "",
          affectedEndingNodeIds.length ? `结局节点变化：${affectedEndingNodeIds.join(",")}` : "",
        ].filter(Boolean)
        : [],
    },
    requiredReLocks: requiredLocksForMode(mode),
    requiredStageReruns: stageReruns,
    staleArtifactKinds: staleArtifactsForChange(input.changeType),
    localResyncPlan: {
      required: true,
      affectedStageTypes: stageReruns,
      staleTargetPaths: uniq([
        ...affectedEpisodes.map((id) => `episodes.${id}`),
        ...affectedScenes.map((id) => `scenes.${id}`),
        ...affectedNodes.map((id) => `gameData.nodes.${id}`),
        ...affectedChoices.map((id) => `gameData.edges.${id}`),
        ...affectedVariableStateIds.map((id) => `gameData.variables.${id}`),
        ...affectedEndingNodeIds.map((id) => `gameData.endings.${id}`),
        ...affectedAssets.map((id) => `assets.${id}`),
      ]),
      reason: "锁定后的结构/内容/资产变化必须重新锁定、重新拆解并局部重同步。",
    },
    humanApprovalRequired: true,
    approvedBy: input.approvedBy,
    createdAt,
    updatedAt: createdAt,
  };
};

export const validateSeriesChangeOrder = (
  order?: Partial<SeriesChangeOrder>,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!order || typeof order !== "object") {
    return normalizeProductionQAIssues([issue("series_change_order", "series_change_order artifact 必须包含结构化变更单。", "blocking")]);
  }
  if (order.schemaVersion !== "series-change-order.v1") issues.push(issue("series_change_order.schemaVersion", "schemaVersion 必须是 series-change-order.v1。", "blocking"));
  if (!compact(order.id)) issues.push(issue("series_change_order.id", "变更单缺少 id。", "blocking"));
  if (!compact(order.projectId)) issues.push(issue("series_change_order.projectId", "变更单缺少 projectId。", "blocking"));
  if (!compact(order.title)) issues.push(issue("series_change_order.title", "变更单缺少标题。", "warning"));
  if (!compact(order.reason)) issues.push(issue("series_change_order.reason", "锁定后变更必须说明原因。", "blocking"));
  if (!order.humanApprovalRequired) issues.push(issue("series_change_order.humanApprovalRequired", "锁定后变更必须需要人工统筹确认。", "blocking"));
  if (!["draft", "pending_review", "approved", "rejected", "applied", "superseded"].includes(String(order.status || ""))) {
    issues.push(issue("series_change_order.status", "变更单状态不合法。", "blocking"));
  }
  if (!asArray(order.requestedChanges).length) {
    issues.push(issue("series_change_order.requestedChanges", "变更单必须列出具体 requestedChanges。", "blocking"));
  }
  if (!asArray(order.sourceLockIds).length) {
    issues.push(issue("series_change_order.sourceLockIds", "锁定后变更单必须引用 script/content/block lock 或 breakdown 来源。", "blocking"));
  }
  if (!asArray(order.requiredReLocks).length) {
    issues.push(issue("series_change_order.requiredReLocks", "变更单必须声明需要重新锁定的 lock artifacts。", "blocking"));
  }
  if (!asArray(order.requiredStageReruns).includes("production_breakdown")) {
    issues.push(issue("series_change_order.requiredStageReruns", "变更单必须触发 production_breakdown 复算。", "blocking"));
  }
  if (!asArray(order.requiredStageReruns).includes("production_asset_detail")) {
    issues.push(issue("series_change_order.requiredStageReruns", "变更单必须触发 production_asset_detail 复算。", "blocking"));
  }
  if (order.mode === "interactive") {
    if (!asArray(order.requiredReLocks).includes("content_lock_package")) {
      issues.push(issue("series_change_order.requiredReLocks", "互动变更单必须重新生成或复核 content_lock_package。", "blocking"));
    }
    if (!asArray(order.requiredStageReruns).includes("interactive_graph_qa")) {
      issues.push(issue("series_change_order.requiredStageReruns", "互动变更单必须先重跑 interactive_graph_qa。", "blocking"));
    }
    if (!asArray(order.requiredStageReruns).includes("content_lock")) {
      issues.push(issue("series_change_order.requiredStageReruns", "互动变更单必须重跑 content_lock。", "blocking"));
    }
    if (!order.impactOnInteractive || order.impactOnInteractive.requiresGraphQA !== true) {
      issues.push(issue("series_change_order.impactOnInteractive", "互动变更单必须声明 graph QA 和 playtest 影响。", "blocking"));
    }
  }
  if (!asArray(order.staleArtifactKinds).includes("production_breakdown_report")) {
    issues.push(issue("series_change_order.staleArtifactKinds", "变更单必须把旧 production_breakdown_report 标记为 stale。", "blocking"));
  }
  if (order.mode === "interactive" && !asArray(order.staleArtifactKinds).includes("content_lock_package")) {
    issues.push(issue("series_change_order.staleArtifactKinds", "互动变更单必须把旧 content_lock_package 标记为 stale。", "blocking"));
  }
  if (order.localResyncPlan?.required !== true || !asArray(order.localResyncPlan?.affectedStageTypes).length) {
    issues.push(issue("series_change_order.localResyncPlan", "变更单必须生成 re-lock/re-breakdown/re-sync 计划。", "blocking"));
  }
  if ((order.status === "approved" || order.status === "applied") && !compact(order.approvedBy)) {
    issues.push(issue("series_change_order.approvedBy", "approved/applied 变更单必须记录 approvedBy。", "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

const scriptLockApproved = (lock: Partial<ScriptLockPackage>) => lock.approvalState === "approved";
const contentLockApproved = (lock: Partial<ContentLockPackage>) => lock.approvalState === "approved";
const blockLocked = (lock: Partial<ProductionBlockLock>) => lock.status === "locked";

const sceneIdsFromEpisodes = (episodes: Episode[]) =>
  uniq(episodes.flatMap((episode) => asArray<any>(episode.scenes).map((scene) => scene.id)));

const nodeIdsFromProject = (
  project: Project,
  episodes: Episode[],
  explicitGameData?: GameProjectData,
) => {
  const gameData = explicitGameData || (project as any).gameData || episodes.find((episode) => episode.gameData?.nodes?.length)?.gameData;
  return uniq(asArray<any>(gameData?.nodes).map((node) => node.id));
};

export const buildProductionSeriesGovernanceSnapshot = ({
  project,
  episodes,
  gameData,
  scriptLockPackages = [],
  contentLockPackages = [],
  productionBlockLocks = [],
  productionBreakdownReports = [],
  seriesChangeOrders = [],
}: BuildProductionSeriesGovernanceInput): ProductionSeriesGovernanceSnapshot => {
  const scopedEpisodes = episodes?.length ? episodes : asArray<Episode>((project as any).episodes);
  const mode = projectMode(project);
  const episodeIds = uniq(scopedEpisodes.map((episode) => episode.id));
  const knownSceneIds = sceneIdsFromEpisodes(scopedEpisodes);
  const knownNodeIds = nodeIdsFromProject(project, scopedEpisodes, gameData);
  const approvedScriptLocks = scriptLockPackages.filter(scriptLockApproved);
  const approvedContentLocks = contentLockPackages.filter(contentLockApproved);
  const lockedBlocks = productionBlockLocks.filter(blockLocked);
  const currentBlock = lockedBlocks[lockedBlocks.length - 1];
  const lockedEpisodeIds = uniq([
    ...approvedScriptLocks.flatMap((lock) => asArray<string>(lock.episodeIds)),
    ...lockedBlocks.flatMap((lock) => asArray<string>(lock.episodeIds)),
  ]);
  const lockedSceneIds = uniq([
    ...approvedScriptLocks.flatMap((lock) => asArray<string>(lock.sceneIds)),
    ...lockedBlocks.flatMap((lock) => asArray<string>(lock.sceneIds)),
  ]);
  const lockedNodeIds = uniq([
    ...approvedContentLocks.flatMap((lock) => asArray<string>(lock.nodeIds)),
    ...lockedBlocks.flatMap((lock) => asArray<string>(lock.nodeIds)),
  ]);
  const targetEpisodeCount = Math.max(Number(project.targetEpisodeCount || 0), episodeIds.length);
  const missingEpisodeCount = Math.max(0, targetEpisodeCount - episodeIds.length);
  const knownUnlockedEpisodeIds = episodeIds.filter((id) => !lockedEpisodeIds.includes(id));
  const knownUnlockedNodeIds = knownNodeIds.filter((id) => !lockedNodeIds.includes(id));
  const breakdownSceneIds = uniq(productionBreakdownReports.flatMap((report) =>
    asArray<any>(report.sceneMatrix).map((row) => row.sceneId),
  ));
  const breakdownNodeIds = uniq(productionBreakdownReports.flatMap((report) =>
    asArray<any>(report.sceneMatrix).map((row) => row.nodeId),
  ));
  const openChangeOrders = seriesChangeOrders.filter((order) =>
    !["rejected", "applied", "superseded"].includes(String(order.status || "")),
  );
  const pendingReviewCount = seriesChangeOrders.filter((order) => order.status === "pending_review").length;
  const approvedCount = seriesChangeOrders.filter((order) => order.status === "approved").length;
  const appliedCount = seriesChangeOrders.filter((order) => order.status === "applied").length;
  const lockedEpisodeCountForCoverage = Math.min(lockedEpisodeIds.length, targetEpisodeCount || lockedEpisodeIds.length);
  const fullSeriesLocked = mode === "movie"
    ? approvedScriptLocks.some((lock) => lock.lockScope === "full_script" && Number(lock.coverageRatio || 0) >= 1)
    : targetEpisodeCount > 0 && lockedEpisodeCountForCoverage >= targetEpisodeCount && knownUnlockedEpisodeIds.length === 0 && missingEpisodeCount === 0;
  const contentCoverageRatio = knownNodeIds.length ? lockedNodeIds.length / knownNodeIds.length : lockedNodeIds.length ? 1 : 0;
  const breakdownSceneCoverage = lockedSceneIds.length ? breakdownSceneIds.filter((id) => lockedSceneIds.includes(id)).length / lockedSceneIds.length : 0;
  const breakdownNodeCoverage = lockedNodeIds.length ? breakdownNodeIds.filter((id) => lockedNodeIds.includes(id)).length / lockedNodeIds.length : 0;
  const breakdownCoverageRatio = mode === "interactive"
    ? (lockedNodeIds.length ? breakdownNodeCoverage : 0)
    : (lockedSceneIds.length ? breakdownSceneCoverage : 0);
  const currentBlockReady = Boolean(currentBlock) && breakdownCoverageRatio > 0 && openChangeOrders.length === 0;
  const fullSeriesReady = fullSeriesLocked && currentBlockReady && openChangeOrders.length === 0;
  const assetPrepBlockers = [
    ...(!currentBlock ? ["缺少 locked production_block_lock。"] : []),
    ...(breakdownCoverageRatio <= 0 ? ["缺少覆盖当前锁定范围的 production_breakdown_report。"] : []),
    ...(openChangeOrders.length ? [`存在 ${openChangeOrders.length} 个未应用 series_change_order。`] : []),
    ...(!fullSeriesLocked && targetEpisodeCount > 0 ? [`目标 ${targetEpisodeCount} 集中当前只锁定 ${lockedEpisodeIds.length} 集，剩余 ${Math.max(0, targetEpisodeCount - lockedEpisodeIds.length)} 集不能视为全剧 ready。`] : []),
  ];
  const scope = fullSeriesReady
    ? "full_series"
    : mode === "interactive" && currentBlockReady
      ? "interactive_node_block"
      : currentBlockReady
        ? "current_block_only"
        : "not_ready";
  const lockStatus = mode === "interactive" && lockedNodeIds.length
    ? "interactive_content_locked"
    : !approvedScriptLocks.length && !approvedContentLocks.length && !lockedBlocks.length
      ? "legacy_unlocked"
      : fullSeriesLocked
        ? "fully_locked"
        : lockedEpisodeIds.length || lockedNodeIds.length
          ? "partially_locked"
          : "unlocked";
  const nextActions = [
    ...(openChangeOrders.length ? ["先审批并应用 open series_change_order，再重跑 lock/breakdown/asset sync。"] : []),
    ...(!currentBlock ? ["生成 script_lock/content_lock 和 production_block_lock。"] : []),
    ...(currentBlock && breakdownCoverageRatio <= 0 ? ["重跑 production_breakdown，覆盖当前 production block。"] : []),
    ...(!fullSeriesLocked && targetEpisodeCount > lockedEpisodeIds.length && mode !== "interactive"
      ? ["继续锁定下一生产 block，或明确当前交付只覆盖 current_block_only。"]
      : []),
  ];
  return {
    schemaVersion: "production-series-governance.v1",
    projectId: project.id,
    mode,
    lockStatus,
    currentBlock: currentBlock?.id ? {
      id: currentBlock.id,
      blockId: currentBlock.blockId || currentBlock.id,
      lockType: currentBlock.lockType || "episode_block",
      episodeIds: asArray<string>(currentBlock.episodeIds),
      sceneIds: asArray<string>(currentBlock.sceneIds),
      nodeIds: asArray<string>(currentBlock.nodeIds),
      status: currentBlock.status || "draft",
    } : undefined,
    scriptCoverage: {
      targetEpisodeCount,
      existingEpisodeCount: episodeIds.length,
      lockedEpisodeCount: lockedEpisodeIds.length,
      knownUnlockedEpisodeIds,
      missingEpisodeCount,
      coverageRatio: targetEpisodeCount ? Math.min(1, lockedEpisodeIds.length / targetEpisodeCount) : 0,
      fullSeriesLocked,
    },
    contentCoverage: {
      lockedNodeCount: lockedNodeIds.length,
      knownNodeCount: knownNodeIds.length,
      knownUnlockedNodeIds,
      coverageRatio: knownNodeIds.length ? Math.min(1, contentCoverageRatio) : 0,
    },
    breakdownCoverage: {
      productionBreakdownReportIds: uniq(productionBreakdownReports.map((report) => report.id)),
      lockedSceneCount: lockedSceneIds.length,
      breakdownSceneCount: breakdownSceneIds.filter((id) => lockedSceneIds.includes(id)).length,
      lockedNodeCount: lockedNodeIds.length,
      breakdownNodeCount: breakdownNodeIds.filter((id) => lockedNodeIds.includes(id)).length,
      coverageRatio: Math.min(1, breakdownCoverageRatio),
    },
    assetPrepReadiness: {
      scope,
      currentBlockReady,
      fullSeriesReady,
      blockers: assetPrepBlockers,
    },
    changeOrders: {
      openCount: openChangeOrders.length,
      approvedCount,
      appliedCount,
      pendingReviewCount,
      changeOrderIds: uniq(seriesChangeOrders.map((order) => order.id)),
      openChangeOrderIds: uniq(openChangeOrders.map((order) => order.id)),
    },
    nextActions,
  };
};

export const validateProductionSeriesGovernanceSnapshot = (
  snapshot?: Partial<ProductionSeriesGovernanceSnapshot>,
  options: { requireFullSeriesReady?: boolean } = {},
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!snapshot || typeof snapshot !== "object") {
    return normalizeProductionQAIssues([issue("production_series_governance", "缺少 production-series-governance 快照。", "blocking")]);
  }
  if (snapshot.schemaVersion !== "production-series-governance.v1") {
    issues.push(issue("production_series_governance.schemaVersion", "schemaVersion 必须是 production-series-governance.v1。", "blocking"));
  }
  if (!compact(snapshot.projectId)) issues.push(issue("production_series_governance.projectId", "治理快照缺少 projectId。", "blocking"));
  if (snapshot.lockStatus === "legacy_unlocked") {
    issues.push(issue("production_series_governance.lockStatus", "项目没有 production lock，只能按 legacy_unlocked 兼容路径继续。", "warning", "生成 lock/breakdown 草案后再进入正式资产筹备。"));
  }
  if (snapshot.assetPrepReadiness?.currentBlockReady !== true) {
    issues.push(issue("production_series_governance.assetPrepReadiness", "当前 production block 尚未 ready，不能进入正式资产筹备。", "blocking"));
  }
  if (options.requireFullSeriesReady && snapshot.assetPrepReadiness?.fullSeriesReady !== true) {
    issues.push(issue("production_series_governance.fullSeriesReady", "正式全剧交付要求 full_series ready；当前只覆盖局部 block 或仍有未锁范围。", "blocking"));
  }
  if (Number(snapshot.changeOrders?.openCount || 0) > 0) {
    issues.push(issue("production_series_governance.changeOrders", "仍有未应用 series_change_order，需要先审批、应用并重跑相关阶段。", "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

export const buildProductionChangeOrderSystem = () => ({
  schemaVersion: "production-change-order-system.v1",
  status: "series_change_order_available",
  artifactKinds: ["series_change_order"],
  governanceReadModel: "production-series-governance.v1",
  builderFunctions: [
    "buildSeriesChangeOrder",
    "buildProductionSeriesGovernanceSnapshot",
  ],
  qaFunctions: [
    "validateSeriesChangeOrder",
    "validateProductionSeriesGovernanceSnapshot",
  ],
  requiredBehavior: [
    "After script_lock/content_lock or production_block_lock, adding, deleting, reordering, or rewriting episodes/scenes/nodes must create a series_change_order.",
    "Interactive node, choice, variable-state, or ending changes must rerun interactive_graph_qa, content_lock, production_breakdown, production_asset_detail, and interactive_storyboard before formal delivery.",
    "Every change order must declare requiredReLocks, requiredStageReruns, staleArtifactKinds, and a localResyncPlan.",
    "targetEpisodeCount must be compared against lockedEpisodeCount; current-block readiness must not be mislabelled as full-series readiness.",
    "Open change orders block formal full delivery and force re-lock/re-breakdown/re-sync before downstream asset prep can be trusted.",
  ],
});
