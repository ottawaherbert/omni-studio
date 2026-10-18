import type { ProductionStageType } from "../../../../../src/types/production";
import type {
  AssetReferencePack,
  StoryboardBoard,
  VideoGenerationUnit,
} from "./videoStoryboardArtifacts";
import type { StoryboardStrategyDraft } from "./storyboardStrategyDraft";

type StrategyArtifactStatus = "draft" | "qa_failed" | "approved" | "committed" | "quarantined";

export interface StoryboardStrategyImpactArtifact {
  id: string;
  kind: string;
  status: StrategyArtifactStatus | string;
  data: unknown;
  updatedAt?: number;
}

export interface StoryboardStrategyImpactScope {
  episodeIds?: string[];
  sceneIds?: string[];
  shotIds?: string[];
}

export interface StoryboardStrategyImpactNode {
  id: string;
  kind: "strategy_change" | "storyboard_board" | "asset_reference_pack" | "video_generation_unit";
  state: "source" | "rerun" | "preserve";
  episodeId?: string;
  sceneId?: string;
  label: string;
}

export interface StoryboardStrategyImpactEdge {
  id: string;
  from: string;
  to: string;
  reason: string;
}

export interface StoryboardStrategyLocalRerunPlan {
  schemaVersion: "storyboard-strategy-local-rerun-plan.v1";
  executionMode: "human_approved_local_rerun";
  requiresHumanApproval: true;
  automaticRetryBudget: 0;
  affectedBoardIds: string[];
  affectedAssetReferencePackIds: string[];
  affectedVideoGenerationUnitIds: string[];
  preservedBoardIds: string[];
  preservedAssetReferencePackIds: string[];
  preservedVideoGenerationUnitIds: string[];
  preservedArtifactKinds: string[];
  requiredStageReruns: ProductionStageType[];
  requiredQaChecks: string[];
  stopConditions: string[];
}

export interface StoryboardStrategyImpactPlan {
  schemaVersion: "storyboard-strategy-impact.v1";
  id: string;
  projectId: string;
  status: "no_change" | "planned" | "blocked";
  sourceArtifactId?: string;
  sourceDraftId?: string;
  targetStrategyId?: string;
  scope: {
    episodeIds: string[];
    sceneIds: string[];
    shotIds: string[];
  };
  nodes: StoryboardStrategyImpactNode[];
  edges: StoryboardStrategyImpactEdge[];
  rerunPlan: StoryboardStrategyLocalRerunPlan;
  blockers: string[];
  summary: string;
}

export interface BuildStoryboardStrategyImpactInput {
  projectId: string;
  artifacts: StoryboardStrategyImpactArtifact[];
  scope?: StoryboardStrategyImpactScope;
}

interface StrategyDraftArtifact {
  artifact: StoryboardStrategyImpactArtifact;
  draft: StoryboardStrategyDraft;
}

interface StrategyTrial {
  draftId: string;
  status: string;
  sampleSceneIds?: string[];
}

const clean = (value: unknown) => String(value || "").trim();
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map(clean).filter(Boolean)));

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const isApprovedArtifact = (artifact: StoryboardStrategyImpactArtifact) =>
  artifact.status === "approved" || artifact.status === "committed";

const unwrapDraft = (artifact: StoryboardStrategyImpactArtifact): StoryboardStrategyDraft | undefined => {
  if (artifact.kind !== "storyboard_strategy_draft") return undefined;
  const data: any = artifact.data;
  const draft = data?.storyboardStrategyDraft || data?.strategyDraft || data?.draft || data;
  return draft?.schemaVersion === "storyboard-strategy-draft.v1" ? draft : undefined;
};

const unwrapTrial = (artifact: StoryboardStrategyImpactArtifact): StrategyTrial | undefined => {
  if (artifact.kind !== "storyboard_strategy_draft_trial") return undefined;
  const data: any = artifact.data;
  const trial = data?.storyboardStrategyDraftTrial || data?.strategyTrial || data?.trial || data;
  return trial?.schemaVersion === "storyboard-strategy-draft-trial.v1" ? trial : undefined;
};

const unwrapBoards = (artifact: StoryboardStrategyImpactArtifact): StoryboardBoard[] => {
  if (artifact.kind !== "storyboard_board") return [];
  const data: any = artifact.data;
  return [
    ...asArray<StoryboardBoard>(data?.storyboardBoards),
    ...asArray<StoryboardBoard>(data?.storyboardBoardDrafts?.storyboardBoards),
    ...asArray<StoryboardBoard>(data?.videoStoryboardPlan?.storyboardBoards),
    ...(data?.storyboardBoard?.id ? [data.storyboardBoard] : []),
    ...(data?.id && data?.strategyDecision ? [data] : []),
  ];
};

const unwrapPacks = (artifact: StoryboardStrategyImpactArtifact): AssetReferencePack[] => {
  if (artifact.kind !== "asset_reference_pack") return [];
  const data: any = artifact.data;
  return [
    ...asArray<AssetReferencePack>(data?.assetReferencePacks),
    ...asArray<AssetReferencePack>(data?.assetReferencePackDrafts?.assetReferencePacks),
    ...asArray<AssetReferencePack>(data?.videoStoryboardPlan?.assetReferencePacks),
    ...(data?.assetReferencePack?.id ? [data.assetReferencePack] : []),
    ...(data?.id && data?.modelProfileId && Array.isArray(data?.items) ? [data] : []),
  ];
};

const unwrapUnits = (artifact: StoryboardStrategyImpactArtifact): VideoGenerationUnit[] => {
  if (artifact.kind !== "video_generation_unit") return [];
  const data: any = artifact.data;
  return [
    ...asArray<VideoGenerationUnit>(data?.videoGenerationUnits),
    ...asArray<VideoGenerationUnit>(data?.videoGenerationUnitDrafts?.videoGenerationUnits),
    ...asArray<VideoGenerationUnit>(data?.videoStoryboardPlan?.videoGenerationUnits),
    ...(data?.videoGenerationUnit?.id ? [data.videoGenerationUnit] : []),
    ...(data?.id && data?.storyboardBoardId && data?.assetReferencePackId ? [data] : []),
  ];
};

const uniqueById = <T extends { id: string }>(items: T[]) => {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (clean(item?.id)) byId.set(item.id, item);
  }
  return Array.from(byId.values());
};

const latestActionableDraft = (
  artifacts: StoryboardStrategyImpactArtifact[],
): StrategyDraftArtifact | undefined => artifacts
  .map((artifact) => ({ artifact, draft: unwrapDraft(artifact) }))
  .filter((item): item is StrategyDraftArtifact => Boolean(item.draft))
  .filter(({ artifact, draft }) =>
    isApprovedArtifact(artifact) &&
    (draft.status === "approved" || draft.status === "promoted") &&
    draft.scope !== "global_candidate")
  .sort((a, b) => Number(b.artifact.updatedAt || b.draft.createdAt || 0) - Number(a.artifact.updatedAt || a.draft.createdAt || 0))[0];

const intersects = (values: string[], filter: Set<string>) =>
  filter.size === 0 || values.some((value) => filter.has(value));

const emptyRerunPlan = (): StoryboardStrategyLocalRerunPlan => ({
  schemaVersion: "storyboard-strategy-local-rerun-plan.v1",
  executionMode: "human_approved_local_rerun",
  requiresHumanApproval: true,
  automaticRetryBudget: 0,
  affectedBoardIds: [],
  affectedAssetReferencePackIds: [],
  affectedVideoGenerationUnitIds: [],
  preservedBoardIds: [],
  preservedAssetReferencePackIds: [],
  preservedVideoGenerationUnitIds: [],
  preservedArtifactKinds: [
    "script_lock_package",
    "production_breakdown_report",
    "formal_asset_package",
    "scene_asset_variant_pack",
    "continuity_matrix",
  ],
  requiredStageReruns: [],
  requiredQaChecks: [],
  stopConditions: [
    "没有明确、已批准且试跑通过的项目级策略变更时停止。",
    "局部重跑完成一次 QA 后停止；失败转人工复核，不自动循环。",
  ],
});

export const buildStoryboardStrategyImpactPlan = ({
  projectId,
  artifacts,
  scope = {},
}: BuildStoryboardStrategyImpactInput): StoryboardStrategyImpactPlan => {
  const boards = uniqueById(artifacts.flatMap(unwrapBoards));
  const packs = uniqueById(artifacts.flatMap(unwrapPacks));
  const units = uniqueById(artifacts.flatMap(unwrapUnits));
  const draftItem = latestActionableDraft(artifacts);
  const basePlan = emptyRerunPlan();
  basePlan.preservedBoardIds = boards.map((board) => board.id);
  basePlan.preservedAssetReferencePackIds = packs.map((pack) => pack.id);
  basePlan.preservedVideoGenerationUnitIds = units.map((unit) => unit.id);

  if (!draftItem) {
    return {
      schemaVersion: "storyboard-strategy-impact.v1",
      id: `storyboard_strategy_impact.${stableHash(`${projectId}:no_change`)}`,
      projectId,
      status: "no_change",
      scope: { episodeIds: [], sceneIds: [], shotIds: [] },
      nodes: [],
      edges: [],
      rerunPlan: basePlan,
      blockers: [],
      summary: "没有已批准的项目级故事板策略变更；保留现有整板、参考包和视频单元。",
    };
  }

  const { artifact: draftArtifact, draft } = draftItem;
  const passedTrials = artifacts
    .filter((artifact) => artifact.kind === "storyboard_strategy_draft_trial" && isApprovedArtifact(artifact))
    .map(unwrapTrial)
    .filter((trial): trial is StrategyTrial => Boolean(trial && trial.draftId === draft.id && trial.status === "passed"));
  const trialSceneIds = unique(passedTrials.flatMap((trial) => trial.sampleSceneIds || []));
  const declaredSceneIds = unique([...(draft.sampleSceneIds || []), ...trialSceneIds]);
  const requestedEpisodeIds = new Set(unique(scope.episodeIds || []));
  const requestedSceneIds = new Set(unique(scope.sceneIds || []));
  const requestedShotIds = new Set(unique(scope.shotIds || []));
  const blockers: string[] = [];

  if (passedTrials.length === 0) blockers.push("项目级故事板策略尚无已批准的 passed trial，不能生成正式局部重跑计划。");
  if ((draft.scope === "scene_range_local" || draft.scope === "production_block_local") && declaredSceneIds.length === 0 && requestedSceneIds.size === 0) {
    blockers.push(`${draft.scope} 策略没有声明 scene scope，禁止退化为全项目重跑。`);
  }

  const draftSceneIds = new Set(declaredSceneIds.length ? declaredSceneIds : Array.from(requestedSceneIds));
  const scopedBoards = boards.filter((board) =>
    intersects([board.episodeId], requestedEpisodeIds) &&
    intersects([board.sceneId], requestedSceneIds) &&
    intersects(board.shotIds || [], requestedShotIds) &&
    (draft.scope === "project_local" || draftSceneIds.has(board.sceneId)));
  const affectedBoards = scopedBoards.filter((board) => board.strategyDraftId !== draft.id);
  const affectedBoardIds = new Set(affectedBoards.map((board) => board.id));
  const targetBoardIds = new Set(scopedBoards.map((board) => board.id));
  const targetSceneIds = new Set(scopedBoards.map((board) => board.sceneId));
  const targetPackIdsFromBoards = new Set(scopedBoards.map((board) => board.assetReferencePackId).filter(Boolean));
  const affectedPacks = packs.filter((pack) =>
    (targetPackIdsFromBoards.has(pack.id) || (Boolean(pack.sceneId) && targetSceneIds.has(pack.sceneId!))) &&
    !asArray<string>(pack.storyboardStrategyIds).includes(draft.id));
  const affectedPackIds = new Set(affectedPacks.map((pack) => pack.id));
  const affectedUnits = units.filter((unit) =>
    (targetBoardIds.has(unit.storyboardBoardId) || targetSceneIds.has(unit.sceneId)) &&
    unit.storyboardStrategyId !== draft.id);

  if (passedTrials.length > 0 && scopedBoards.length === 0) {
    blockers.push("策略变更作用域内没有已保存的复合故事板，无法建立局部影响关系。");
  }

  const affectedBoardIdList = affectedBoards.map((board) => board.id);
  const affectedPackIdList = affectedPacks.map((pack) => pack.id);
  const affectedUnitIdList = affectedUnits.map((unit) => unit.id);
  const rerunPlan: StoryboardStrategyLocalRerunPlan = {
    ...basePlan,
    affectedBoardIds: affectedBoardIdList,
    affectedAssetReferencePackIds: affectedPackIdList,
    affectedVideoGenerationUnitIds: affectedUnitIdList,
    preservedBoardIds: boards.filter((board) => !affectedBoardIds.has(board.id)).map((board) => board.id),
    preservedAssetReferencePackIds: packs.filter((pack) => !affectedPackIds.has(pack.id)).map((pack) => pack.id),
    preservedVideoGenerationUnitIds: units.filter((unit) => !affectedUnits.some((affected) => affected.id === unit.id)).map((unit) => unit.id),
    requiredStageReruns: [
      ...(affectedBoardIdList.length ? ["storyboard" as const] : []),
      ...(affectedBoardIdList.length || affectedPackIdList.length ? ["prompt" as const] : []),
      ...(affectedBoardIdList.length || affectedPackIdList.length || affectedUnitIdList.length ? ["expensive_generation_planning" as const] : []),
    ],
    requiredQaChecks: affectedBoardIdList.length || affectedPackIdList.length || affectedUnitIdList.length
      ? [
          "qa.linear.storyboard_board",
          "qa.linear.asset_reference_pack",
          "qa.linear.video_generation_unit",
          "production.coordination.storyboard_video_unit",
        ]
      : [],
  };

  const sourceNodeId = `strategy:${draft.id}`;
  const nodes: StoryboardStrategyImpactNode[] = [
    { id: sourceNodeId, kind: "strategy_change", state: "source", label: draft.name },
    ...affectedBoards.map((board) => ({ id: `board:${board.id}`, kind: "storyboard_board" as const, state: "rerun" as const, episodeId: board.episodeId, sceneId: board.sceneId, label: board.id })),
    ...affectedPacks.map((pack) => ({ id: `pack:${pack.id}`, kind: "asset_reference_pack" as const, state: "rerun" as const, episodeId: pack.episodeId, sceneId: pack.sceneId, label: pack.id })),
    ...affectedUnits.map((unit) => ({ id: `unit:${unit.id}`, kind: "video_generation_unit" as const, state: "rerun" as const, episodeId: unit.episodeId, sceneId: unit.sceneId, label: unit.id })),
  ];
  const edges: StoryboardStrategyImpactEdge[] = [
    ...affectedBoards.map((board) => ({ id: `${sourceNodeId}->board:${board.id}`, from: sourceNodeId, to: `board:${board.id}`, reason: "已批准策略改变复合整板的版式与控制语法。" })),
    ...affectedPacks.map((pack) => {
      const board = affectedBoards.find((candidate) => candidate.assetReferencePackId === pack.id || candidate.sceneId === pack.sceneId);
      const from = board ? `board:${board.id}` : sourceNodeId;
      return { id: `${from}->pack:${pack.id}`, from, to: `pack:${pack.id}`, reason: "参考包刷新故事板策略来源，不重做资产身份图。" };
    }),
    ...affectedUnits.map((unit) => {
      const from = affectedBoardIds.has(unit.storyboardBoardId) ? `board:${unit.storyboardBoardId}` : sourceNodeId;
      return { id: `${from}->unit:${unit.id}`, from, to: `unit:${unit.id}`, reason: "视频单元必须继承新整板、提示词与策略来源。" };
    }),
  ];
  const status: StoryboardStrategyImpactPlan["status"] = blockers.length
    ? "blocked"
    : affectedBoardIdList.length || affectedPackIdList.length || affectedUnitIdList.length
      ? "planned"
      : "no_change";
  const scopeEpisodeIds = unique(affectedBoards.map((board) => board.episodeId));
  const scopeSceneIds = unique(affectedBoards.map((board) => board.sceneId));
  const scopeShotIds = unique(affectedBoards.flatMap((board) => board.shotIds || []));
  const fingerprint = stableHash(JSON.stringify({
    projectId,
    draftId: draft.id,
    boards: affectedBoardIdList,
    packs: affectedPackIdList,
    units: affectedUnitIdList,
  }));

  return {
    schemaVersion: "storyboard-strategy-impact.v1",
    id: `storyboard_strategy_impact.${fingerprint}`,
    projectId,
    status,
    sourceArtifactId: draftArtifact.id,
    sourceDraftId: draft.id,
    targetStrategyId: draft.id,
    scope: {
      episodeIds: scopeEpisodeIds,
      sceneIds: scopeSceneIds,
      shotIds: scopeShotIds,
    },
    nodes,
    edges,
    rerunPlan,
    blockers,
    summary: status === "blocked"
      ? `策略变更尚不能执行：${blockers.join("；")}`
      : status === "planned"
        ? `局部重跑 ${affectedBoardIdList.length} 张复合整板、${affectedPackIdList.length} 个参考包、${affectedUnitIdList.length} 个视频单元；剧本锁、制片拆解、正式资产包和场记矩阵保持不变。`
        : "目标范围已经使用当前策略，不需要重跑。",
  };
};

export const validateStoryboardStrategyImpactPlan = (
  plan: StoryboardStrategyImpactPlan,
): string[] => {
  const issues: string[] = [];
  if (plan.schemaVersion !== "storyboard-strategy-impact.v1") issues.push("schemaVersion 必须是 storyboard-strategy-impact.v1。");
  if (!clean(plan.id) || !clean(plan.projectId)) issues.push("影响计划必须包含稳定 id 和 projectId。");
  if (plan.rerunPlan.automaticRetryBudget !== 0) issues.push("故事板策略局部重跑不能设置自动重试预算。");
  if (plan.rerunPlan.requiresHumanApproval !== true) issues.push("故事板策略局部重跑必须人工批准。");
  if (plan.status === "planned" && [
    ...plan.rerunPlan.affectedBoardIds,
    ...plan.rerunPlan.affectedAssetReferencePackIds,
    ...plan.rerunPlan.affectedVideoGenerationUnitIds,
  ].length === 0) issues.push("planned 计划必须至少影响一项故事板链路产物。");
  if (plan.status === "no_change" && plan.rerunPlan.requiredStageReruns.length > 0) issues.push("no_change 计划不能要求阶段重跑。");
  const nodeIds = plan.nodes.map((node) => node.id);
  if (new Set(nodeIds).size !== nodeIds.length) issues.push("影响图 node id 不能重复。");
  const knownNodeIds = new Set(nodeIds);
  for (const edge of plan.edges) {
    if (!knownNodeIds.has(edge.from) || !knownNodeIds.has(edge.to)) issues.push(`影响边引用未知节点：${edge.id}。`);
  }
  return unique(issues);
};

export const buildStoryboardStrategyImpactSystem = () => ({
  schemaVersion: "storyboard-strategy-impact-system.v1",
  status: "bounded_local_rerun_read_model_available",
  builderFunction: "buildStoryboardStrategyImpactPlan",
  qaFunction: "validateStoryboardStrategyImpactPlan",
  readModel: "production-cockpit.v1.styleStrategy.impactPlan",
  requiredBehavior: [
    "Only approved project-local strategy drafts with approved passed trials may create a rerun plan.",
    "A global candidate never changes a project or triggers reruns automatically.",
    "The plan reruns only affected composite storyboard boards, prompt/reference-pack projections, and video generation units.",
    "Script locks, production breakdown, formal asset identity packages, scene variants, and continuity matrices remain preserved for a strategy-only change.",
    "The plan has automaticRetryBudget=0 and always requires human approval; failed QA stops for review instead of looping.",
  ],
});
