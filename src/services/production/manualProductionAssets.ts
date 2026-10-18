import type {
  Episode,
  AssetVariant,
  ManualFilmTeamDepartment,
  ManualProductionAssetApproval,
  ManualProductionAssetReferenceAudit,
  ManualProductionAssetVariantAudit,
  ManualProductionAssetRegistry,
  Project,
  Scene,
} from "../../types/project";
import type { AssetReferencePack, SceneVisualPack } from "./videoStoryboardArtifacts";
import {
  buildVideoStoryboardAssetBoardPlan,
  type VideoStoryboardAssetBoardItem,
} from "./videoStoryboardAssetBoards";
import { buildProductionSceneVisualPackDrafts } from "./videoStoryboardSceneVisualPacks";
import { buildProductionAssetReferencePackDrafts } from "./videoStoryboardPromptPacks";
import { manualFilmTeamScriptHash } from "./manualFilmTeam";
import { buildProductionAssetPreparationContext } from "./productionAssetPreparation";
import {
  buildManualFilmTeamReadModel,
  type ManualFilmTeamReadModel,
} from "./manualFilmTeamReadModel";

export type ManualProductionAssetReadiness = "ready" | "needs_review" | "blocked";
export type ManualProductionAssetApprovalState = "confirmed" | "needs_confirmation" | "stale" | "blocked_by_team";

export interface ManualProductionAssetUsageRef {
  episodeId: string;
  sceneId: string;
  shotIds: string[];
  title: string;
}

export interface ManualProductionAssetBoard {
  boardItemId: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  assetName: string;
  variantId?: string;
  variantName?: string;
  boardKind: VideoStoryboardAssetBoardItem["boardKind"];
  prompt: string;
  promptHash: string;
  referenceImageUrl?: string;
  referenceSource: "variant" | "canonical" | "missing";
  referenceOrigin: ManualProductionAssetReferenceAudit["source"] | "missing";
  requiredDepartments: ManualFilmTeamDepartment[];
  sourceDepartmentPackageIds: string[];
  departmentBlockers: string[];
  approvalState: ManualProductionAssetApprovalState;
  approvalConfirmedAt?: number;
  usageRefs: ManualProductionAssetUsageRef[];
}

export interface ManualProductionSceneState {
  id: string;
  assetId: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  assetName: string;
  variantId?: string;
  stateSummary: string;
}

export interface ManualProductionAssetReadModel {
  schemaVersion: "manual-production-asset-read-model.v1";
  projectId: string;
  episodeId: string;
  sceneId: string;
  /** Hashes the exact confirmed asset context that may enter the next workflow step. */
  assetPackHash: string;
  readiness: ManualProductionAssetReadiness;
  readyForShotPlanning: boolean;
  readyForStoryboardGeneration: boolean;
  assetBoards: ManualProductionAssetBoard[];
  sceneStates: ManualProductionSceneState[];
  sceneVisualPack?: SceneVisualPack;
  assetReferencePack?: AssetReferencePack;
  reusedSceneIds: string[];
  confirmedBoardCount: number;
  missingReferenceCount: number;
  blockedBoardCount: number;
  staleBoardCount: number;
  issues: Array<{
    severity: "blocking" | "warning";
    code: string;
    message: string;
  }>;
}

const REQUIRED_DEPARTMENTS: Record<ManualProductionAssetBoard["assetType"], ManualFilmTeamDepartment[]> = {
  character: ["directing", "wardrobe", "makeup_hair", "performance_directing"],
  location: ["production_design", "lighting", "continuity"],
  prop: ["props", "continuity"],
  vehicles: ["production_design", "continuity"],
};

const allBoardItems = (plan: ReturnType<typeof buildVideoStoryboardAssetBoardPlan>) => [
  ...plan.characterBoards,
  ...plan.sceneBoards,
  ...plan.propBoards,
  ...plan.vehicleBoards,
  ...plan.variantBoards,
];

const upstreamAssetScene = (scene: Scene): Scene => ({
  ...scene,
  // Older scenes may keep explicit vehicle bindings only on their shots. Retain
  // those identities without feeding downstream shot staging into asset design.
  shots: (scene.shots || []).filter((shot) => shot.vehicleIds?.length).map((shot) => ({
    id: shot.id,
    vehicleIds: shot.vehicleIds,
  })),
});

const boardPromptHash = (
  board: VideoStoryboardAssetBoardItem,
  canonicalBoard: VideoStoryboardAssetBoardItem = board,
) => manualFilmTeamScriptHash(JSON.stringify({
  id: board.id,
  prompt: board.prompt || "",
  referenceImageUrl: board.referenceImageUrl || "",
  styleLockSummary: board.styleLockSummary || "",
  canonicalIdentity: {
    prompt: canonicalBoard.prompt || "",
    referenceImageUrl: canonicalBoard.referenceImageUrl || "",
    styleLockSummary: canonicalBoard.styleLockSummary || "",
  },
}));

const approvalFor = (
  registry: ManualProductionAssetRegistry | undefined,
  boardItemId: string,
) => registry?.approvals.find((item) => item.boardItemId === boardItemId);

const boardReferenceSource = (
  board: VideoStoryboardAssetBoardItem,
): ManualProductionAssetBoard["referenceSource"] => {
  if (!board.referenceImageUrl) return "missing";
  return board.variantId ? "variant" : "canonical";
};

const boardReferenceOrigin = (
  project: Project,
  board: VideoStoryboardAssetBoardItem,
): ManualProductionAssetBoard["referenceOrigin"] => {
  if (!board.referenceImageUrl) return "missing";
  return project.manualProductionAssets?.references?.find((item) =>
    item.boardItemId === board.id && item.imageUrl === board.referenceImageUrl
  )?.source || "existing";
};

const boardUsageRefs = (
  episode: Episode,
  scene: Scene,
  board: VideoStoryboardAssetBoardItem,
): ManualProductionAssetUsageRef[] => {
  const matchingShotIds = (scene.shots || []).filter((shot) => {
    if (board.assetType === "character") return shot.characterIdsInShot?.includes(board.assetId);
    if (board.assetType === "location") return shot.locationId === board.assetId;
    if (board.assetType === "vehicles") return shot.vehicleIds?.includes(board.assetId);
    return shot.propIds?.includes(board.assetId);
  }).map((shot) => shot.id);
  return [{
    episodeId: episode.id,
    sceneId: scene.id,
    shotIds: matchingShotIds.length ? matchingShotIds : (scene.shots || []).map((shot) => shot.id),
    title: scene.title,
  }];
};

const currentBoardItems = (
  plan: ReturnType<typeof buildVideoStoryboardAssetBoardPlan>,
  sceneVisualPack: SceneVisualPack | undefined,
) => {
  if (!sceneVisualPack) return [];
  const items = allBoardItems(plan);
  const scoped: VideoStoryboardAssetBoardItem[] = [];
  for (const slot of sceneVisualPack.referenceSlots) {
    const baseBoard = items.find((item) => item.assetId === slot.assetId && !item.variantId);
    const variantBoard = slot.variantId
      ? items.find((item) => item.assetId === slot.assetId && item.variantId === slot.variantId)
      : undefined;
    if (baseBoard) scoped.push(baseBoard);
    if (variantBoard) scoped.push(variantBoard);
  }
  return Array.from(new Map(scoped.map((item) => [item.id, item])).values());
};

const packageIdsForDepartments = (
  filmTeam: ManualFilmTeamReadModel,
  departments: ManualFilmTeamDepartment[],
) => departments.flatMap((department) => {
  const coverage = filmTeam.coverage.find((item) => item.department === department);
  if (!coverage) return [];
  const prep = filmTeam.departmentPrepPackages.find((item) => item.department === coverage.canonicalDepartment);
  return prep ? [prep.id] : [];
});

const assetName = (project: Project, assetType: ManualProductionAssetBoard["assetType"], assetId: string) => {
  if (assetType === "character") return project.characters.find((item) => item.id === assetId)?.name || assetId;
  return project.assets.find((item) => item.id === assetId)?.name || assetId;
};

const sceneStates = (project: Project, pack: SceneVisualPack | undefined): ManualProductionSceneState[] => {
  if (!pack) return [];
  return [
    ...(pack.location.assetId ? [{
      id: `location-${pack.location.assetId}`,
      assetId: pack.location.assetId,
      assetType: "location" as const,
      assetName: assetName(project, "location", pack.location.assetId),
      variantId: pack.location.variantId,
      stateSummary: [pack.location.setDressingState, pack.location.timeOfDay, pack.location.lightingState, pack.location.damageState].filter(Boolean).join(" / "),
    }] : []),
    ...pack.characters.map((item) => ({
      id: `character-${item.characterId}`,
      assetId: item.characterId,
      assetType: "character" as const,
      assetName: assetName(project, "character", item.characterId),
      variantId: item.variantId,
      stateSummary: [item.continuityState, item.costumeState, item.makeupState, item.hairState, item.injuryState, item.emotionalBaseline].filter(Boolean).join(" / "),
    })),
    ...pack.props.map((item) => ({
      id: `prop-${item.assetId}`,
      assetId: item.assetId,
      assetType: "prop" as const,
      assetName: assetName(project, "prop", item.assetId),
      variantId: item.variantId,
      stateSummary: [item.usageState, item.continuityState].filter(Boolean).join(" / "),
    })),
    ...(pack.vehicles || []).map((vehicle) => ({
      id: `vehicle-${vehicle.assetId}`,
      assetId: vehicle.assetId,
      assetType: "vehicles" as const,
      assetName: assetName(project, "vehicles", vehicle.assetId),
      variantId: vehicle.variantId,
      stateSummary: vehicle.continuityState,
    })),
  ];
};

const visualStateSignature = (
  pack: SceneVisualPack,
  assetType: ManualProductionSceneState["assetType"],
  assetId: string,
) => {
  if (assetType === "location" && pack.location.assetId === assetId) {
    return [pack.location.setDressingState, pack.location.timeOfDay, pack.location.lightingState, pack.location.damageState].filter(Boolean).join(" / ");
  }
  if (assetType === "character") {
    const state = pack.characters.find((item) => item.characterId === assetId);
    return state ? [state.continuityState, state.costumeState, state.makeupState, state.hairState, state.injuryState].filter(Boolean).join(" / ") : "";
  }
  if (assetType === "vehicles") {
    return pack.vehicles?.find((item) => item.assetId === assetId)?.continuityState || "";
  }
  const state = pack.props.find((item) => item.assetId === assetId);
  return state ? [state.usageState, state.continuityState].filter(Boolean).join(" / ") : "";
};

interface ManualProductionStaticProjection {
  assetBoardPlan: ReturnType<typeof buildVideoStoryboardAssetBoardPlan>;
  episodeSceneRefs: Episode["scenes"][];
  perSceneVisualPacks: SceneVisualPack[];
  assetPreparationContext: ReturnType<typeof buildProductionAssetPreparationContext>;
  reusableSceneVisualDraftsByEpisode: Map<string, {
    scenes: Episode["scenes"];
    drafts: ReturnType<typeof buildProductionSceneVisualPackDrafts>;
  }>;
}

const manualProductionStaticProjectionCache = new WeakMap<Project, ManualProductionStaticProjection>();

const staticProjectionFor = (
  project: Project,
  orderedEpisodes: Episode[],
): ManualProductionStaticProjection => {
  const episodeSceneRefs = orderedEpisodes.map((item) => item.scenes);
  const cached = manualProductionStaticProjectionCache.get(project);
  if (
    cached
    && cached.episodeSceneRefs.length === episodeSceneRefs.length
    && cached.episodeSceneRefs.every((scenes, index) => scenes === episodeSceneRefs[index])
  ) {
    return cached;
  }

  const assetBoardPlan = buildVideoStoryboardAssetBoardPlan(project);
  const perSceneVisualPacks = orderedEpisodes.flatMap((continuityEpisode) =>
    (continuityEpisode.scenes || []).flatMap((episodeScene) =>
      buildProductionSceneVisualPackDrafts(
        project,
        [{ ...continuityEpisode, scenes: [upstreamAssetScene(episodeScene)] }],
        assetBoardPlan,
      ).sceneVisualPacks),
  );
  const projection: ManualProductionStaticProjection = {
    assetBoardPlan,
    episodeSceneRefs,
    perSceneVisualPacks,
    assetPreparationContext: buildProductionAssetPreparationContext(project, orderedEpisodes),
    reusableSceneVisualDraftsByEpisode: new Map(),
  };
  manualProductionStaticProjectionCache.set(project, projection);
  return projection;
};

export const buildManualProductionAssetReadModel = ({
  project,
  episode,
  scene,
  episodes = [episode],
  filmTeam = buildManualFilmTeamReadModel({ project, episode }),
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  episodes?: Episode[];
  filmTeam?: ManualFilmTeamReadModel;
}): ManualProductionAssetReadModel => {
  const sourceScene = upstreamAssetScene(scene);
  const scopedEpisode = { ...episode, scenes: [sourceScene] };
  const continuityEpisodes = episodes.some((item) => item.id === episode.id) ? episodes : [...episodes, episode];
  const orderedEpisodes = project.episodes.length
    ? [
        ...project.episodes.flatMap((meta) => continuityEpisodes.filter((item) => item.id === meta.id)),
        ...continuityEpisodes.filter((item) => !project.episodes.some((meta) => meta.id === item.id)),
      ]
    : continuityEpisodes;
  const staticProjection = staticProjectionFor(project, orderedEpisodes);
  const { assetBoardPlan, perSceneVisualPacks, assetPreparationContext } = staticProjection;
  const reusableCache = staticProjection.reusableSceneVisualDraftsByEpisode.get(episode.id);
  const reusableSceneVisualDrafts = reusableCache?.scenes === episode.scenes
    ? reusableCache.drafts
    : buildProductionSceneVisualPackDrafts(
        project,
        [{ ...episode, scenes: episode.scenes.map(upstreamAssetScene) }],
        assetBoardPlan,
      );
  if (reusableCache?.scenes !== episode.scenes) {
    staticProjection.reusableSceneVisualDraftsByEpisode.set(episode.id, {
      scenes: episode.scenes,
      drafts: reusableSceneVisualDrafts,
    });
  }
  const reusableSceneVisualPack = reusableSceneVisualDrafts.sceneVisualPacks.find((item) => item.linkedSceneIds.includes(scene.id));
  const sceneVisualDrafts = buildProductionSceneVisualPackDrafts(
    project,
    [scopedEpisode],
    assetBoardPlan,
    {
      productionBreakdownReport: filmTeam.productionBreakdownReport,
      departmentPrepPackages: filmTeam.departmentPrepPackages.filter(item => item.specialistPayload?.manualOutput),
      requireProductionPrep: false,
    },
  );
  const scopedSceneVisualPack = sceneVisualDrafts.sceneVisualPacks.find((item) => item.linkedSceneIds.includes(scene.id));
  const currentSceneVisualPack = scopedSceneVisualPack ? {
    ...scopedSceneVisualPack,
    linkedSceneIds: reusableSceneVisualPack?.linkedSceneIds || scopedSceneVisualPack.linkedSceneIds,
  } : undefined;
  const referenceDrafts = buildProductionAssetReferencePackDrafts(
    project,
    [{ ...episode, scenes: [scene] }],
    currentSceneVisualPack ? [currentSceneVisualPack] : [],
    {
      departmentPrepPackages: filmTeam.departmentPrepPackages.filter(item => item.specialistPayload?.manualOutput),
      requireDepartmentPrepRefs: false,
    },
  );
  const currentReferencePack = referenceDrafts.assetReferencePacks.find((item) => item.sceneId === scene.id);

  const plannedBoardItems = allBoardItems(assetBoardPlan);
  const assetBoards = currentBoardItems(assetBoardPlan, currentSceneVisualPack).map((board): ManualProductionAssetBoard => {
    const requiredDepartments = REQUIRED_DEPARTMENTS[board.assetType];
    const departmentBlockers: string[] = []; // Historical reports are optional reference, not asset prerequisites.
    const canonicalBoard = board.variantId
      ? plannedBoardItems.find((item) => item.assetId === board.assetId && !item.variantId)
      : board;
    const promptHash = boardPromptHash(board, canonicalBoard);
    const approval = approvalFor(project.manualProductionAssets, board.id);
    const approvalState: ManualProductionAssetApprovalState = !approval
      ? "needs_confirmation"
      : approval.promptHash === promptHash ? "confirmed" : "stale";
    return {
      boardItemId: board.id,
      assetId: board.assetId,
      assetType: board.assetType,
      assetName: board.assetName,
      variantId: board.variantId,
      variantName: board.variantName,
      boardKind: board.boardKind,
      prompt: board.prompt || "",
      promptHash,
      referenceImageUrl: board.referenceImageUrl,
      referenceSource: boardReferenceSource(board),
      referenceOrigin: boardReferenceOrigin(project, board),
      requiredDepartments,
      sourceDepartmentPackageIds: packageIdsForDepartments(filmTeam, requiredDepartments),
      departmentBlockers,
      approvalState,
      approvalConfirmedAt: approval?.confirmedAt,
      usageRefs: boardUsageRefs(episode, scene, board),
    };
  });

  const normalizedIssues = [
    ...sceneVisualDrafts.issues,
    ...referenceDrafts.issues,
  ].map((item) => ({
    severity: item.severity,
    code: item.code,
    message: item.code === "SCENE_VISUAL_PACK_LOCATION_MISSING" ? "尚未绑定本场场景；可从项目资产库选择，也可先制作分镜。" : item.message,
  }));
  const semanticBatch = (project.manualProductionAssets?.preparationBatches || [])
    .filter((audit) => audit.sourceHash === assetPreparationContext.sourceHash)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (currentSceneVisualPack) {
    const currentStates = sceneStates(project, currentSceneVisualPack);
    if (semanticBatch) {
      for (const state of currentStates) {
        const decision = semanticBatch.decisions.find((item) => item.sceneId === scene.id && item.assetId === state.assetId);
        if (!decision) {
          normalizedIssues.push({
            severity: "warning",
            code: "MANUAL_ASSET_STATE_DECISION_MISSING",
            message: `${state.assetName} 缺少本场 base/variant 语义判断；已保留现有资产选择，可按需复核。`,
          });
        } else if (decision.use === "variant" && state.variantId !== decision.variantId) {
          normalizedIssues.push({
            severity: "warning",
            code: "MANUAL_ASSET_REQUIRED_VARIANT_NOT_BOUND",
            message: `${state.assetName} 的资产治理结论与当前变体绑定不同；已保留当前选择，可按需复核。`,
          });
        } else if (decision.use === "base" && state.variantId) {
          normalizedIssues.push({
            severity: "warning",
            code: "MANUAL_ASSET_BASE_DECISION_VARIANT_CONFLICT",
            message: `${state.assetName} 的资产治理结论是使用基础身份，但当前场已绑定变体；已保留当前选择，可按需复核。`,
          });
        }
      }
    } else {
      const baselineStateByAsset = new Map<string, string>();
      for (const pack of perSceneVisualPacks) {
        for (const state of sceneStates(project, pack)) {
          const key = `${state.assetType}:${state.assetId}`;
          if (!baselineStateByAsset.has(key)) baselineStateByAsset.set(key, visualStateSignature(pack, state.assetType, state.assetId));
        }
      }
      for (const state of currentStates) {
        const baseline = baselineStateByAsset.get(`${state.assetType}:${state.assetId}`);
        const current = visualStateSignature(currentSceneVisualPack, state.assetType, state.assetId);
        const confirmedBaseBoard = assetBoards.some((board) =>
          board.assetId === state.assetId
          && !board.variantId
          && (board.approvalState === "confirmed" || board.approvalState === "stale"));
        if (baseline && current && baseline !== current && !state.variantId && !confirmedBaseBoard) {
          normalizedIssues.push({
            severity: "warning",
            code: "MANUAL_ASSET_STATE_CHANGE_NEEDS_SEMANTIC_REVIEW",
            message: `${state.assetName} 的本场状态与其他场次不同；已保留基础身份，可按需建立状态变体。`,
          });
        }
      }
    }
  }
  const confirmedBoardCount = assetBoards.filter((item) =>
    item.approvalState === "confirmed" || item.approvalState === "stale").length;
  const blockedBoardCount = assetBoards.filter((item) => item.approvalState === "blocked_by_team").length;
  const staleBoardCount = assetBoards.filter((item) => item.approvalState === "stale").length;
  if (staleBoardCount) {
    normalizedIssues.push({
      severity: "warning",
      code: "MANUAL_ASSET_CONFIRMATION_SOURCE_CHANGED",
      message: `${staleBoardCount} 个资产身份内容有更新；已保留原确认，可按需复核。`,
    });
  }
  const missingReferenceCount = assetBoards.filter((item) => item.referenceSource === "missing").length;
  const hasBlockingIssue = normalizedIssues.some((item) => item.severity === "blocking");
  // A dialogue-only or abstract scene can legitimately have no scene-specific assets.
  // Its author still explicitly confirms the empty asset pack in the preparation workspace.
  const allConfirmed = assetBoards.length === 0 || confirmedBoardCount === assetBoards.length;
  const readyForShotPlanning = !hasBlockingIssue;
  const readyForStoryboardGeneration = readyForShotPlanning && missingReferenceCount === 0;
  const readiness: ManualProductionAssetReadiness = blockedBoardCount || hasBlockingIssue
    ? "blocked"
    : readyForStoryboardGeneration && allConfirmed ? "ready" : "needs_review";

  return {
    schemaVersion: "manual-production-asset-read-model.v1",
    projectId: project.id,
    episodeId: episode.id,
    sceneId: scene.id,
    assetPackHash: manualFilmTeamScriptHash(JSON.stringify({
      sourceScriptHash: filmTeam.sourceScriptHash,
      assetBoards: assetBoards.map((board) => ({
        id: board.boardItemId,
        promptHash: board.promptHash,
        referenceImageUrl: board.referenceImageUrl || "",
        approvalState: board.approvalState,
        departmentBlockers: board.departmentBlockers,
      })),
      departmentCoverage: filmTeam.coverage.map((coverage) => ({
        department: coverage.department,
        readiness: coverage.readiness,
        outputStatus: coverage.outputStatus,
        qaScore: coverage.qaScore,
      })),
      blockingIssues: normalizedIssues
        .filter((issue) => issue.severity === "blocking")
        .map((issue) => ({ code: issue.code, message: issue.message })),
    })),
    readiness,
    readyForShotPlanning,
    readyForStoryboardGeneration,
    assetBoards,
    sceneStates: sceneStates(project, currentSceneVisualPack),
    sceneVisualPack: currentSceneVisualPack,
    assetReferencePack: currentReferencePack,
    reusedSceneIds: (currentSceneVisualPack?.linkedSceneIds || []).filter((sceneId) => sceneId !== scene.id),
    confirmedBoardCount,
    missingReferenceCount,
    blockedBoardCount,
    staleBoardCount,
    issues: normalizedIssues,
  };
};

export const confirmManualProductionAssetBoard = ({
  project,
  episode,
  scene,
  boardItemId,
  confirmedAt = Date.now(),
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  boardItemId: string;
  confirmedAt?: number;
}): ManualProductionAssetRegistry => {
  const readModel = buildManualProductionAssetReadModel({ project, episode, scene });
  const board = readModel.assetBoards.find((item) => item.boardItemId === boardItemId);
  if (!board) throw new Error("当前场景找不到该资产身份板，不能确认。");
  const approval: ManualProductionAssetApproval = {
    boardItemId: board.boardItemId,
    assetId: board.assetId,
    assetType: board.assetType,
    variantId: board.variantId,
    promptHash: board.promptHash,
    status: "confirmed",
    sourceSceneIds: board.usageRefs.map((item) => item.sceneId),
    sourceDepartmentPackageIds: board.sourceDepartmentPackageIds,
    confirmedAt,
    updatedAt: confirmedAt,
  };
  return {
    schemaVersion: "manual-production-assets.v1",
    approvals: [
      ...(project.manualProductionAssets?.approvals || []).filter((item) => item.boardItemId !== board.boardItemId),
      approval,
    ],
    references: project.manualProductionAssets?.references || [],
    variants: project.manualProductionAssets?.variants || [],
    profileRevisions: project.manualProductionAssets?.profileRevisions || [],
    preparationBatches: project.manualProductionAssets?.preparationBatches || [],
    updatedAt: confirmedAt,
  };
};

export const confirmManualProductionAssetBoards = ({
  project,
  episode,
  scene,
  boardItemIds,
  confirmedAt = Date.now(),
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  boardItemIds: string[];
  confirmedAt?: number;
}): ManualProductionAssetRegistry => {
  let registry = project.manualProductionAssets;
  for (const boardItemId of Array.from(new Set(boardItemIds))) {
    registry = confirmManualProductionAssetBoard({
      project: { ...project, manualProductionAssets: registry },
      episode,
      scene,
      boardItemId,
      confirmedAt,
    });
  }
  return registry || {
    schemaVersion: "manual-production-assets.v1",
    approvals: [],
    references: [],
    variants: [],
    profileRevisions: [],
    preparationBatches: [],
    updatedAt: confirmedAt,
  };
};

export const revokeManualProductionAssetBoard = (
  registry: ManualProductionAssetRegistry | undefined,
  boardItemId: string,
  updatedAt = Date.now(),
): ManualProductionAssetRegistry => ({
  schemaVersion: "manual-production-assets.v1",
  approvals: (registry?.approvals || []).filter((item) => item.boardItemId !== boardItemId),
  references: registry?.references || [],
  variants: registry?.variants || [],
  profileRevisions: registry?.profileRevisions || [],
  preparationBatches: registry?.preparationBatches || [],
  updatedAt,
});

export const buildManualProductionReferenceImageUpdate = ({
  project,
  episode,
  scene,
  boardItemId,
  imageUrl,
  source = "ai_generation",
  finalPrompt,
  modelId,
  inputReferenceUrl,
  imageReferenceManifest,
  promptCompositionManifest,
  visualStyleCompileManifest,
  selectedSkillIds = [],
  selectedContextIds = [],
  createdAt = Date.now(),
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  boardItemId: string;
  imageUrl: string;
  source?: ManualProductionAssetReferenceAudit["source"];
  finalPrompt?: string;
  modelId?: string;
  inputReferenceUrl?: string;
  imageReferenceManifest?: ManualProductionAssetReferenceAudit["imageReferenceManifest"];
  promptCompositionManifest?: ManualProductionAssetReferenceAudit["promptCompositionManifest"];
  visualStyleCompileManifest?: ManualProductionAssetReferenceAudit["visualStyleCompileManifest"];
  selectedSkillIds?: string[];
  selectedContextIds?: string[];
  createdAt?: number;
}): Pick<Project, "characters" | "assets" | "manualProductionAssets"> => {
  const readModel = buildManualProductionAssetReadModel({ project, episode, scene });
  const board = readModel.assetBoards.find((item) => item.boardItemId === boardItemId);
  if (!board) throw new Error("当前场景找不到该资产身份板，不能写入参考图。");
  if (!imageUrl.trim()) throw new Error("参考图地址为空，不能写入正式资产。");

  let characters = project.characters;
  let assets = project.assets;
  if (board.assetType === "character") {
    const owner = project.characters.find((item) => item.id === board.assetId);
    if (!owner) throw new Error("角色资产不存在，不能写入参考图。");
    characters = project.characters.map((item) => item.id !== board.assetId ? item : board.variantId
      ? { ...item, variants: (item.variants || []).map((variant) => variant.id === board.variantId ? { ...variant, boardImageUrl: imageUrl, imageUrl } : variant) }
      : { ...item, boardImageUrl: imageUrl, multiViewUrl: imageUrl });
  } else {
    const owner = project.assets.find((item) => item.id === board.assetId);
    if (!owner) throw new Error("场景或道具资产不存在，不能写入参考图。");
    assets = project.assets.map((item) => item.id !== board.assetId ? item : board.variantId
      ? { ...item, variants: (item.variants || []).map((variant) => variant.id === board.variantId ? { ...variant, boardImageUrl: imageUrl, imageUrl } : variant) }
      : {
          ...item,
          boardImageUrl: imageUrl,
          ...(board.assetType === "location" ? { panoramaUrl: imageUrl } : { multiViewUrl: imageUrl }),
        });
  }

  const referenceAudit: ManualProductionAssetReferenceAudit = {
    boardItemId: board.boardItemId,
    assetId: board.assetId,
    assetType: board.assetType,
    variantId: board.variantId,
    imageUrl,
    source,
    promptHash: finalPrompt ? manualFilmTeamScriptHash(finalPrompt) : undefined,
    finalPrompt: finalPrompt || undefined,
    modelId,
    inputReferenceUrl,
    imageReferenceManifest,
    promptCompositionManifest,
    visualStyleCompileManifest,
    selectedSkillIds,
    selectedContextIds,
    sourceSceneIds: board.usageRefs.map((item) => item.sceneId),
    createdAt,
    updatedAt: createdAt,
  };
  return {
    characters,
    assets,
    manualProductionAssets: {
      schemaVersion: "manual-production-assets.v1",
      approvals: project.manualProductionAssets?.approvals || [],
      references: [
        ...(project.manualProductionAssets?.references || []).filter((item) => item.boardItemId !== board.boardItemId),
        referenceAudit,
      ],
      pendingReferences: project.manualProductionAssets?.pendingReferences || [],
      variants: project.manualProductionAssets?.variants || [],
      profileRevisions: project.manualProductionAssets?.profileRevisions || [],
      preparationBatches: project.manualProductionAssets?.preparationBatches || [],
      updatedAt: createdAt,
    },
  };
};

export interface ManualProductionVariantDraft {
  name: string;
  description: string;
  promptModifiers: string;
}

export const buildManualProductionVariantUpdate = ({
  project,
  episode,
  scene,
  assetId,
  draft,
  finalPrompt,
  selectedSkillIds = [],
  selectedContextIds = [],
  createdAt = Date.now(),
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  assetId: string;
  draft: ManualProductionVariantDraft;
  finalPrompt: string;
  selectedSkillIds?: string[];
  selectedContextIds?: string[];
  createdAt?: number;
}): {
  projectUpdates: Pick<Project, "characters" | "assets" | "manualProductionAssets">;
  sceneUpdates: Pick<Scene, "breakdown">;
  variantId: string;
} => {
  const readModel = buildManualProductionAssetReadModel({ project, episode, scene });
  if (!scene.breakdown) throw new Error("当前场景没有结构化制片拆解，不能创建状态变体。");
  const state = readModel.sceneStates.find((item) => item.assetId === assetId);
  if (!state) throw new Error("当前场景没有该资产的结构化状态，不能创建变体。");
  const baseBoard = readModel.assetBoards.find((item) => item.assetId === assetId && !item.variantId);
  if (!baseBoard) throw new Error("当前场景没有该资产的基础身份板，不能创建变体。");

  const normalizedDraft: ManualProductionVariantDraft = {
    name: String(draft.name || "").trim(),
    description: String(draft.description || "").trim(),
    promptModifiers: String(draft.promptModifiers || "").trim(),
  };
  if (!normalizedDraft.name || !normalizedDraft.description) throw new Error("状态变体缺少名称或可见差异描述。");
  const stateSummaryHash = manualFilmTeamScriptHash(state.stateSummary);
  const variantId = `manual-variant-${assetId}-${crypto.randomUUID()}`;
  const variant: AssetVariant = { id: variantId, ...normalizedDraft };
  const mergeVariant = (variants: AssetVariant[] | undefined) => [
    ...(variants || []),
    variant,
  ];
  let characters = project.characters;
  let assets = project.assets;
  if (state.assetType === "character") {
    if (!project.characters.some((item) => item.id === assetId)) throw new Error("角色资产不存在，不能创建变体。");
    characters = project.characters.map((item) => item.id === assetId ? { ...item, variants: mergeVariant(item.variants) } : item);
  } else {
    if (!project.assets.some((item) => item.id === assetId)) throw new Error("场景或道具资产不存在，不能创建变体。");
    assets = project.assets.map((item) => item.id === assetId ? { ...item, variants: mergeVariant(item.variants) } : item);
  }
  const variantAudit: ManualProductionAssetVariantAudit = {
    variantId,
    assetId,
    assetType: state.assetType,
    sourceSceneId: scene.id,
    stateSummaryHash,
    promptHash: manualFilmTeamScriptHash(finalPrompt),
    selectedSkillIds,
    selectedContextIds,
    createdAt,
    updatedAt: createdAt,
  };
  return {
    projectUpdates: {
      characters,
      assets,
      manualProductionAssets: {
        schemaVersion: "manual-production-assets.v1",
        approvals: project.manualProductionAssets?.approvals || [],
        references: project.manualProductionAssets?.references || [],
        pendingReferences: project.manualProductionAssets?.pendingReferences || [],
        variants: [
          ...(project.manualProductionAssets?.variants || []).filter((item) => item.variantId !== variantId),
          variantAudit,
        ],
        profileRevisions: project.manualProductionAssets?.profileRevisions || [],
        preparationBatches: project.manualProductionAssets?.preparationBatches || [],
        updatedAt: createdAt,
      },
    },
    sceneUpdates: {
      breakdown: {
        ...scene.breakdown,
        assetVariantMap: {
          ...(scene.breakdown?.assetVariantMap || {}),
          [assetId]: variantId,
        },
      },
    },
    variantId,
  };
};
