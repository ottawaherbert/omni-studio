import type { Asset, Episode, Project } from "../../../../../src/types/project";
import type { ProductionQAIssue, ProductionStageType } from "../../../../../src/types/production";

export type CreativeChangeDepartment =
  | "directing"
  | "writing"
  | "cinematography"
  | "lighting"
  | "production_design"
  | "wardrobe"
  | "makeup_hair"
  | "performance_directing"
  | "action_choreography"
  | "props"
  | "wardrobe_makeup"
  | "location_art"
  | "continuity"
  | "vfx_sfx"
  | "sound_music"
  | "ui_interaction"
  | "production";

export type CreativeChangeStatus =
  | "open"
  | "classified"
  | "resync_planned"
  | "resolved"
  | "rejected";

export type CreativeChangeKind =
  | "new_asset"
  | "asset_variant"
  | "scene_change"
  | "shot_change"
  | "prompt_change";

export type PendingAssetStatus = "pending" | "promoted" | "merged" | "discarded" | "waived";

export type VariantRequestStatus = "pending" | "created" | "merged" | "discarded" | "waived";

export interface CreativeChangeSource {
  stageType: ProductionStageType;
  requestedBy?: "author" | "operator" | "system";
  operatorRunId?: string;
  page?: string;
  note?: string;
}

export interface CreativeChangeImpact {
  episodeIds: string[];
  sceneIds: string[];
  shotIds: string[];
  assetIds: string[];
  artifactKinds: string[];
  stageTypes: ProductionStageType[];
  departments: CreativeChangeDepartment[];
}

export interface PendingAsset {
  schemaVersion: "pending-asset.v1";
  id: string;
  tempAssetId: string;
  sourceChangeRequestId: string;
  projectId: string;
  assetType: Asset["type"];
  name: string;
  description: string;
  department: CreativeChangeDepartment;
  status: PendingAssetStatus;
  canonicalAssetId?: string;
  mergeTargetAssetId?: string;
  requiredBeforeStages: ProductionStageType[];
  episodeIds: string[];
  sceneIds: string[];
  shotIds: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface VariantRequest {
  schemaVersion: "variant-request.v1";
  id: string;
  sourceChangeRequestId: string;
  projectId: string;
  assetId: string;
  variantKind: "wardrobe" | "makeup_hair" | "prop_state" | "location_state" | "injury_state" | "performance_state" | "other";
  name: string;
  description: string;
  status: VariantRequestStatus;
  variantId?: string;
  requiredBeforeStages: ProductionStageType[];
  episodeIds: string[];
  sceneIds: string[];
  shotIds: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface LocalResyncPlan {
  schemaVersion: "local-resync-plan.v1";
  id: string;
  sourceChangeRequestId: string;
  projectId: string;
  affectedEpisodeIds: string[];
  affectedSceneIds: string[];
  affectedShotIds: string[];
  affectedArtifactKinds: string[];
  affectedStageTypes: ProductionStageType[];
  producerSteps: string[];
  qaChecks: string[];
  staleTargets: Array<{
    targetPath: string;
    reason: string;
  }>;
  mustResolveBeforeStages: ProductionStageType[];
  summary: string;
  createdAt: number;
}

export interface CreativeChangeRequest {
  schemaVersion: "creative-change-request.v1";
  id: string;
  projectId: string;
  runId?: string;
  source: CreativeChangeSource;
  status: CreativeChangeStatus;
  kind: CreativeChangeKind;
  title: string;
  description: string;
  creativePurpose: string;
  department: CreativeChangeDepartment;
  impact: CreativeChangeImpact;
  pendingAssets: PendingAsset[];
  variantRequests: VariantRequest[];
  localResyncPlan?: LocalResyncPlan;
  formalDeliveryBlockers: string[];
  qaChecklist: string[];
  createdAt: number;
  updatedAt?: number;
}

export interface BuildCreativeChangeRequestInput {
  id?: string;
  runId?: string;
  source?: Partial<CreativeChangeSource>;
  status?: CreativeChangeStatus;
  kind?: CreativeChangeKind;
  title?: string;
  description?: string;
  creativePurpose?: string;
  department?: CreativeChangeDepartment;
  episodeIds?: string[];
  sceneIds?: string[];
  shotIds?: string[];
  assetIds?: string[];
  proposedAsset?: Partial<Pick<PendingAsset, "assetType" | "name" | "description" | "department">>;
  pendingAssets?: Partial<PendingAsset>[];
  variantRequests?: Partial<VariantRequest>[];
  localResyncPlan?: Partial<LocalResyncPlan>;
  createdAt?: number;
}

const formalDeliveryStages = new Set<ProductionStageType>(["prompt", "expensive_generation_planning"]);

const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));

const asStringArray = (value: unknown): string[] => Array.isArray(value)
  ? uniq(value.map((item) => String(item || "")))
  : [];

const projectEpisodes = (project: Project, episodes?: Episode[]) =>
  Array.isArray(episodes) && episodes.length ? episodes : ((project as any).episodes || []) as Episode[];

const findSceneRefs = (project: Project, sceneIds: string[], episodes?: Episode[]) => {
  const refs: Array<{ episodeId: string; sceneId: string; shotIds: string[] }> = [];
  for (const episode of projectEpisodes(project, episodes)) {
    for (const scene of episode.scenes || []) {
      if (sceneIds.length && !sceneIds.includes(scene.id)) continue;
      refs.push({
        episodeId: episode.id,
        sceneId: scene.id,
        shotIds: (scene.shots || []).map((shot) => shot.id),
      });
    }
  }
  return refs;
};

const inferDepartment = (input: BuildCreativeChangeRequestInput): CreativeChangeDepartment => {
  if (input.department) return input.department;
  const assetType = input.proposedAsset?.assetType || input.pendingAssets?.[0]?.assetType;
  if (assetType === "prop" || assetType === "vehicles" || assetType === "specialEquipment") return "props";
  if (assetType === "wardrobe" || assetType === "makeupHair") return "wardrobe_makeup";
  if (assetType === "location") return "location_art";
  if (input.variantRequests?.length) return "continuity";
  return "directing";
};

const inferKind = (input: BuildCreativeChangeRequestInput): CreativeChangeKind => {
  if (input.kind) return input.kind;
  if (input.pendingAssets?.length || input.proposedAsset?.name) return "new_asset";
  if (input.variantRequests?.length) return "asset_variant";
  if (input.shotIds?.length) return "shot_change";
  if (input.sceneIds?.length) return "scene_change";
  return "prompt_change";
};

const impactedStagesForKind = (kind: CreativeChangeKind): ProductionStageType[] => {
  if (kind === "prompt_change") return ["prompt", "expensive_generation_planning"];
  if (kind === "shot_change") return ["storyboard", "prompt", "expensive_generation_planning"];
  return ["asset_sync", "storyboard", "prompt", "expensive_generation_planning"];
};

const impactedArtifactsForKind = (kind: CreativeChangeKind) => {
  if (kind === "prompt_change") return ["asset_reference_pack", "video_generation_unit"];
  if (kind === "shot_change") return ["storyboard", "storyboard_board", "asset_reference_pack", "video_generation_unit"];
  return ["scene_visual_pack", "storyboard_board", "asset_reference_pack", "video_generation_unit"];
};

const requiredBeforeStagesForKind = (kind: CreativeChangeKind): ProductionStageType[] =>
  kind === "prompt_change" ? ["expensive_generation_planning"] : ["prompt", "expensive_generation_planning"];

const normalizePendingAsset = (
  input: Partial<PendingAsset>,
  base: {
    changeId: string;
    projectId: string;
    department: CreativeChangeDepartment;
    episodeIds: string[];
    sceneIds: string[];
    shotIds: string[];
    kind: CreativeChangeKind;
    createdAt: number;
  },
): PendingAsset => ({
  schemaVersion: "pending-asset.v1",
  id: String(input.id || nowId("pending_asset")),
  tempAssetId: String(input.tempAssetId || `pending-${String(input.assetType || "asset")}-${Date.now()}`),
  sourceChangeRequestId: base.changeId,
  projectId: base.projectId,
  assetType: input.assetType || "prop",
  name: String(input.name || "未命名临时资产").trim(),
  description: String(input.description || "").trim(),
  department: input.department || base.department,
  status: input.status || "pending",
  canonicalAssetId: input.canonicalAssetId,
  mergeTargetAssetId: input.mergeTargetAssetId,
  requiredBeforeStages: input.requiredBeforeStages?.length ? input.requiredBeforeStages : requiredBeforeStagesForKind(base.kind),
  episodeIds: input.episodeIds?.length ? input.episodeIds : base.episodeIds,
  sceneIds: input.sceneIds?.length ? input.sceneIds : base.sceneIds,
  shotIds: input.shotIds?.length ? input.shotIds : base.shotIds,
  createdAt: Number(input.createdAt || base.createdAt),
  updatedAt: input.updatedAt,
});

const normalizeVariantRequest = (
  input: Partial<VariantRequest>,
  base: {
    changeId: string;
    projectId: string;
    episodeIds: string[];
    sceneIds: string[];
    shotIds: string[];
    createdAt: number;
  },
): VariantRequest => ({
  schemaVersion: "variant-request.v1",
  id: String(input.id || nowId("variant_request")),
  sourceChangeRequestId: base.changeId,
  projectId: base.projectId,
  assetId: String(input.assetId || "").trim(),
  variantKind: input.variantKind || "other",
  name: String(input.name || "未命名变体申请").trim(),
  description: String(input.description || "").trim(),
  status: input.status || "pending",
  variantId: input.variantId,
  requiredBeforeStages: input.requiredBeforeStages?.length ? input.requiredBeforeStages : ["prompt", "expensive_generation_planning"],
  episodeIds: input.episodeIds?.length ? input.episodeIds : base.episodeIds,
  sceneIds: input.sceneIds?.length ? input.sceneIds : base.sceneIds,
  shotIds: input.shotIds?.length ? input.shotIds : base.shotIds,
  createdAt: Number(input.createdAt || base.createdAt),
  updatedAt: input.updatedAt,
});

export const buildCreativeChangeImpact = (
  project: Project,
  input: BuildCreativeChangeRequestInput,
  kind: CreativeChangeKind = inferKind(input),
  department: CreativeChangeDepartment = inferDepartment(input),
  episodes?: Episode[],
): CreativeChangeImpact => {
  const directSceneIds = asStringArray(input.sceneIds);
  const sceneRefs = findSceneRefs(project, directSceneIds, episodes);
  const episodeIds = uniq([
    ...asStringArray(input.episodeIds),
    ...sceneRefs.map((ref) => ref.episodeId),
  ]);
  const sceneIds = uniq([
    ...directSceneIds,
    ...sceneRefs.map((ref) => ref.sceneId),
  ]);
  const shotIds = uniq([
    ...asStringArray(input.shotIds),
    ...sceneRefs.flatMap((ref) => ref.shotIds).filter((shotId) => input.shotIds?.length ? input.shotIds.includes(shotId) : true),
  ]);
  return {
    episodeIds,
    sceneIds,
    shotIds,
    assetIds: asStringArray(input.assetIds),
    artifactKinds: impactedArtifactsForKind(kind),
    stageTypes: impactedStagesForKind(kind),
    departments: uniq([department]) as CreativeChangeDepartment[],
  };
};

export const buildLocalResyncPlan = (
  change: Pick<CreativeChangeRequest, "id" | "projectId" | "kind" | "impact" | "pendingAssets" | "variantRequests">,
  createdAt = Date.now(),
): LocalResyncPlan => {
  const affectedStageTypes = impactedStagesForKind(change.kind);
  const mustResolveBeforeStages = uniq([
    ...change.pendingAssets.flatMap((asset) => asset.requiredBeforeStages),
    ...change.variantRequests.flatMap((variant) => variant.requiredBeforeStages),
    ...requiredBeforeStagesForKind(change.kind),
  ]) as ProductionStageType[];
  const staleTargets = [
    ...change.impact.sceneIds.map((sceneId) => ({
      targetPath: `scenes.${sceneId}`,
      reason: "创作回流影响该场的场景视觉包、分镜页、参考包或视频生成单元。",
    })),
    ...change.impact.shotIds.map((shotId) => ({
      targetPath: `shots.${shotId}`,
      reason: "创作回流影响该镜头的故事板、提示词或视频生成单元。",
    })),
  ];
  return {
    schemaVersion: "local-resync-plan.v1",
    id: nowId("local_resync_plan"),
    sourceChangeRequestId: change.id,
    projectId: change.projectId,
    affectedEpisodeIds: change.impact.episodeIds,
    affectedSceneIds: change.impact.sceneIds,
    affectedShotIds: change.impact.shotIds,
    affectedArtifactKinds: change.impact.artifactKinds,
    affectedStageTypes,
    producerSteps: affectedStageTypes.map((stage) => `linear.${stage}.local_resync`),
    qaChecks: [
      "operator.artifact.creative_change_request.qa",
      "qa.linear.scene_visual_pack",
      "qa.linear.asset_reference_pack",
      "qa.linear.video_generation_unit",
    ],
    staleTargets,
    mustResolveBeforeStages,
    summary: `局部重同步 ${change.impact.sceneIds.length} 场、${change.impact.shotIds.length} 镜头，刷新 ${change.impact.artifactKinds.join(", ")}。`,
    createdAt,
  };
};

export const buildCreativeChangeRequest = (
  project: Project,
  input: BuildCreativeChangeRequestInput,
  episodes?: Episode[],
): CreativeChangeRequest => {
  const createdAt = Number(input.createdAt || Date.now());
  const id = String(input.id || nowId("creative_change_request"));
  const department = inferDepartment(input);
  const kind = inferKind(input);
  const impact = buildCreativeChangeImpact(project, input, kind, department, episodes);
  const base = {
    changeId: id,
    projectId: project.id,
    department,
    episodeIds: impact.episodeIds,
    sceneIds: impact.sceneIds,
    shotIds: impact.shotIds,
    kind,
    createdAt,
  };
  const pendingAssets = [
    ...(input.proposedAsset?.name ? [normalizePendingAsset(input.proposedAsset, base)] : []),
    ...(input.pendingAssets || []).map((asset) => normalizePendingAsset(asset, base)),
  ];
  const variantRequests = (input.variantRequests || []).map((variant) => normalizeVariantRequest(variant, {
    changeId: id,
    projectId: project.id,
    episodeIds: impact.episodeIds,
    sceneIds: impact.sceneIds,
    shotIds: impact.shotIds,
    createdAt,
  }));
  const skeleton: CreativeChangeRequest = {
    schemaVersion: "creative-change-request.v1",
    id,
    projectId: project.id,
    runId: input.runId,
    source: {
      stageType: input.source?.stageType || "storyboard",
      requestedBy: input.source?.requestedBy || "operator",
      operatorRunId: input.source?.operatorRunId,
      page: input.source?.page,
      note: input.source?.note,
    },
    status: input.status || "resync_planned",
    kind,
    title: String(input.title || input.proposedAsset?.name || "创作回流变更").trim(),
    description: String(input.description || input.proposedAsset?.description || "").trim(),
    creativePurpose: String(input.creativePurpose || input.description || "补充后置阶段产生的导演创意。").trim(),
    department,
    impact,
    pendingAssets,
    variantRequests,
    formalDeliveryBlockers: [],
    qaChecklist: [
      "变更来源、创意目的和影响范围已记录。",
      "新增资产或变体先进入 pending/variant request，不直接污染 canonical assets。",
      "local_resync_plan 只刷新受影响场景、镜头和视频故事板产物。",
      "进入 prompt/expensive_generation_planning 前，pending 项必须转正、合并、废弃或豁免。",
    ],
    createdAt,
    updatedAt: input.createdAt ? undefined : createdAt,
  };
  const localResyncPlan = input.localResyncPlan?.id
    ? { ...buildLocalResyncPlan(skeleton, createdAt), ...input.localResyncPlan }
    : buildLocalResyncPlan(skeleton, createdAt);
  const formalDeliveryBlockers = [
    ...pendingAssets.filter((asset) => asset.status === "pending").map((asset) => `pending_asset:${asset.id}`),
    ...variantRequests.filter((variant) => variant.status === "pending").map((variant) => `variant_request:${variant.id}`),
  ];
  return {
    ...skeleton,
    localResyncPlan,
    formalDeliveryBlockers,
  };
};

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  repairInstruction?: string,
): ProductionQAIssue => ({
  id: nowId("creative_change_issue"),
  target,
  message,
  severity,
  repairInstruction,
  issueType: "creative_change_flow",
  retryable: true,
  fingerprint: `creative_change:${target}:${message}`,
});

export const validatePendingAsset = (asset: Partial<PendingAsset> | undefined): ProductionQAIssue[] => {
  if (!asset) return [issue("pendingAsset", "pending_asset artifact 必须包含 data.pendingAsset。", "blocking")];
  const issues: ProductionQAIssue[] = [];
  if (asset.schemaVersion !== "pending-asset.v1") issues.push(issue("pendingAsset.schemaVersion", "pending_asset schemaVersion 必须为 pending-asset.v1。", "blocking"));
  if (!asset.id) issues.push(issue("pendingAsset.id", "pending_asset 必须有 id。", "blocking"));
  if (!asset.tempAssetId) issues.push(issue("pendingAsset.tempAssetId", "pending_asset 必须有 tempAssetId。", "blocking"));
  if (!asset.sourceChangeRequestId) issues.push(issue("pendingAsset.sourceChangeRequestId", "pending_asset 必须关联 creative_change_request。", "blocking"));
  if (!asset.name) issues.push(issue("pendingAsset.name", "pending_asset 必须有可读名称。", "blocking"));
  if (asset.status === "promoted" && !asset.canonicalAssetId) {
    issues.push(issue("pendingAsset.canonicalAssetId", "promoted pending_asset 必须记录 canonicalAssetId。", "blocking"));
  }
  if (asset.status === "merged" && !asset.mergeTargetAssetId) {
    issues.push(issue("pendingAsset.mergeTargetAssetId", "merged pending_asset 必须记录 mergeTargetAssetId。", "blocking"));
  }
  return issues;
};

export const validateVariantRequest = (variant: Partial<VariantRequest> | undefined): ProductionQAIssue[] => {
  if (!variant) return [issue("variantRequest", "variant_request artifact 必须包含 data.variantRequest。", "blocking")];
  const issues: ProductionQAIssue[] = [];
  if (variant.schemaVersion !== "variant-request.v1") issues.push(issue("variantRequest.schemaVersion", "variant_request schemaVersion 必须为 variant-request.v1。", "blocking"));
  if (!variant.id) issues.push(issue("variantRequest.id", "variant_request 必须有 id。", "blocking"));
  if (!variant.sourceChangeRequestId) issues.push(issue("variantRequest.sourceChangeRequestId", "variant_request 必须关联 creative_change_request。", "blocking"));
  if (!variant.assetId) issues.push(issue("variantRequest.assetId", "variant_request 必须指向已有 assetId。", "blocking"));
  if (variant.status === "created" && !variant.variantId) {
    issues.push(issue("variantRequest.variantId", "created variant_request 必须记录 variantId。", "blocking"));
  }
  return issues;
};

export const validateLocalResyncPlan = (plan: Partial<LocalResyncPlan> | undefined): ProductionQAIssue[] => {
  if (!plan) return [issue("localResyncPlan", "local_resync_plan artifact 必须包含 data.localResyncPlan。", "blocking")];
  const issues: ProductionQAIssue[] = [];
  if (plan.schemaVersion !== "local-resync-plan.v1") issues.push(issue("localResyncPlan.schemaVersion", "local_resync_plan schemaVersion 必须为 local-resync-plan.v1。", "blocking"));
  if (!plan.id) issues.push(issue("localResyncPlan.id", "local_resync_plan 必须有 id。", "blocking"));
  if (!plan.sourceChangeRequestId) issues.push(issue("localResyncPlan.sourceChangeRequestId", "local_resync_plan 必须关联 creative_change_request。", "blocking"));
  if (!plan.affectedStageTypes?.length) issues.push(issue("localResyncPlan.affectedStageTypes", "local_resync_plan 必须声明受影响 stage。", "blocking"));
  if (!plan.affectedArtifactKinds?.length) issues.push(issue("localResyncPlan.affectedArtifactKinds", "local_resync_plan 必须声明受影响 artifact kind。", "blocking"));
  if (!plan.qaChecks?.length) issues.push(issue("localResyncPlan.qaChecks", "local_resync_plan 必须声明局部复检 QA。", "blocking"));
  return issues;
};

export const validateCreativeChangeRequest = (
  change: Partial<CreativeChangeRequest> | undefined,
  options: { targetStageType?: ProductionStageType; formalDeliveryCheck?: boolean } = {},
): ProductionQAIssue[] => {
  if (!change) return [issue("creativeChangeRequest", "creative_change_request artifact 必须包含 data.creativeChangeRequest。", "blocking")];
  const issues: ProductionQAIssue[] = [];
  if (change.schemaVersion !== "creative-change-request.v1") issues.push(issue("creativeChangeRequest.schemaVersion", "creative_change_request schemaVersion 必须为 creative-change-request.v1。", "blocking"));
  if (!change.id) issues.push(issue("creativeChangeRequest.id", "creative_change_request 必须有 id。", "blocking"));
  if (!change.projectId) issues.push(issue("creativeChangeRequest.projectId", "creative_change_request 必须有 projectId。", "blocking"));
  if (!change.source?.stageType) issues.push(issue("creativeChangeRequest.source.stageType", "creative_change_request 必须记录来源 stageType。", "blocking"));
  if (!change.title) issues.push(issue("creativeChangeRequest.title", "creative_change_request 必须有标题。", "blocking"));
  if (!change.description) issues.push(issue("creativeChangeRequest.description", "creative_change_request 必须描述创作变化。", "blocking"));
  if (!change.creativePurpose) issues.push(issue("creativeChangeRequest.creativePurpose", "creative_change_request 必须说明创作目的。", "blocking"));
  if (!change.impact?.stageTypes?.length) issues.push(issue("creativeChangeRequest.impact.stageTypes", "creative_change_request 必须声明影响哪些 stage。", "blocking"));
  if (!change.localResyncPlan) {
    issues.push(issue("creativeChangeRequest.localResyncPlan", "creative_change_request 必须生成 local_resync_plan，避免后置灵感变成脏引用。", "blocking"));
  } else {
    issues.push(...validateLocalResyncPlan(change.localResyncPlan));
  }
  for (const pendingAsset of change.pendingAssets || []) issues.push(...validatePendingAsset(pendingAsset));
  for (const variantRequest of change.variantRequests || []) issues.push(...validateVariantRequest(variantRequest));

  const formalCheck = Boolean(options.formalDeliveryCheck || (options.targetStageType && formalDeliveryStages.has(options.targetStageType)));
  if (formalCheck) {
    const unresolvedPendingAssets = (change.pendingAssets || []).filter((asset) => asset.status === "pending");
    const unresolvedVariants = (change.variantRequests || []).filter((variant) => variant.status === "pending");
    if (unresolvedPendingAssets.length) {
      issues.push(issue(
        "creativeChangeRequest.pendingAssets",
        `${unresolvedPendingAssets.length} 个 pending_asset 尚未转正、合并、废弃或豁免，不能进入正式交付。`,
        "blocking",
        "先运行局部 asset_sync，把 pending_asset 转成 canonical asset，或明确合并/废弃/豁免。",
      ));
    }
    if (unresolvedVariants.length) {
      issues.push(issue(
        "creativeChangeRequest.variantRequests",
        `${unresolvedVariants.length} 个 variant_request 尚未创建、合并、废弃或豁免，不能进入正式交付。`,
        "blocking",
        "先补充资产 variants 和 scene.breakdown.assetVariantMap，再进入 prompt 或媒体生成计划。",
      ));
    }
  }
  return issues;
};

export const getCreativeChangeFormalDeliveryBlockers = (
  change: Pick<CreativeChangeRequest, "pendingAssets" | "variantRequests">,
) => [
  ...(change.pendingAssets || []).filter((asset) => asset.status === "pending").map((asset) => `pending_asset:${asset.id}`),
  ...(change.variantRequests || []).filter((variant) => variant.status === "pending").map((variant) => `variant_request:${variant.id}`),
];

export const buildCreativeChangeSystem = () => ({
  status: "creative_change_flow_contract_available_operator_artifact_only",
  artifactKinds: ["creative_change_request", "pending_asset", "variant_request", "local_resync_plan"],
  primaryArtifactKind: "creative_change_request",
  plannerFunction: "buildCreativeChangeRequest",
  impactFunction: "buildCreativeChangeImpact",
  resyncFunction: "buildLocalResyncPlan",
  qaFunctions: [
    "validateCreativeChangeRequest",
    "validatePendingAsset",
    "validateVariantRequest",
    "validateLocalResyncPlan",
  ],
  allowedSourceStages: ["storyboard", "prompt"],
  formalDeliveryStages: Array.from(formalDeliveryStages),
  requiredBehavior: [
    "Storyboard/prompt stage inspiration must enter creative_change_request instead of directly writing unregistered asset ids.",
    "New props, wardrobe, makeupHair, location states, or gag assets stay as pending_asset until local asset_sync promotes, merges, discards, or waives them.",
    "local_resync_plan must list affected scenes, shots, artifact kinds, stage types, stale targets, and QA checks.",
    "prompt and expensive_generation_planning exits must hard-block unresolved pending assets or variant requests.",
  ],
});
