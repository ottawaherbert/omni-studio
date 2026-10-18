import type { Episode, Project } from "../../../../../src/types/project";
import type { GameProjectData } from "../../../../../src/types/game";
import type { ProductionRun, ProductionStageType } from "../../../../../src/types/production";
import type { VideoStoryboardAssetBoardPlan } from "./videoStoryboardAssetBoards";
import type { FormalAssetPackage } from "./productionAssetPackage";
import {
  ContentLockPackage,
  ProductionBlockLock,
  ProductionLockFormat,
  ScriptLockPackage,
} from "./productionLock";
import {
  buildCastingRequirements,
  buildDepartmentPrepPackages,
  buildProductionBreakdownReport,
  type CastingRequirement,
  type DepartmentPrepPackage,
  type ProductionBreakdownReport,
} from "./productionPrep";
import {
  buildCastingDecision,
  buildRoleSlots,
  type CastingDecision,
  type RoleSlot,
} from "./productionCasting";
import { buildContinuityMatrix } from "./productionContinuity";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const latestCheckpointSnapshot = (
  run: ProductionRun,
  stageType: ProductionStageType,
): Record<string, any> | undefined => {
  const stageIds = new Set(run.stages.filter((stage) => stage.stageType === stageType).map((stage) => stage.id));
  return [...(run.checkpoints || [])]
    .reverse()
    .find((checkpoint) => stageIds.has(checkpoint.stageId) && checkpoint.kind === "output" && checkpoint.snapshot && typeof checkpoint.snapshot === "object")
    ?.snapshot as Record<string, any> | undefined;
};

const productionFormatForProject = (project: Project): Exclude<ProductionLockFormat, "interactive"> => {
  if (project.type === "single-work" || project.type === "series-work") return project.type;
  if (project.type === "movie" || project.type === "tv-series" || project.type === "short-drama" || project.type === "micro-short-drama") {
    return project.type;
  }
  return "ai-video-sample";
};

const allSceneIds = (episodes: Episode[]) =>
  unique(episodes.flatMap((episode) => (episode.scenes || []).map((scene) => scene.id)));

export const createScriptLockBundle = (
  project: Project,
  episodes: Episode[],
  createdAt = Date.now(),
): { scriptLockPackage: ScriptLockPackage; productionBlockLock: ProductionBlockLock } => {
  const format = productionFormatForProject(project);
  const episodeIds = unique(episodes.map((episode) => episode.id));
  const sceneIds = allSceneIds(episodes);
  const expectedEpisodeCount = Number((project as any).targetEpisodeCount || episodeIds.length || 1);
  const lockedEpisodeCount = episodeIds.length;
  const isMovie = format === "movie";
  const lockScope: ScriptLockPackage["lockScope"] = isMovie ? "full_script" : "episode_block";
  const coverageRatio = isMovie
    ? (sceneIds.length ? 1 : 0)
    : Math.max(0.01, Math.min(1, lockedEpisodeCount / Math.max(1, expectedEpisodeCount)));
  const blockId = isMovie ? "full-project" : `episodes-${episodeIds[0] || "none"}-${episodeIds.at(-1) || "none"}`;
  const scriptLockPackage: ScriptLockPackage = {
    schemaVersion: "script-lock-package.v1",
    id: `script-lock-${project.id}-${blockId}`,
    projectId: project.id,
    format,
    lockScope,
    episodeIds,
    sceneIds,
    sequenceIds: isMovie ? ["full-script"] : undefined,
    scriptRevision: `script-revision-${project.id}-${sceneIds.length}-${createdAt}`,
    coverageRatio,
    scriptCoverage: {
      expectedEpisodeCount: isMovie ? undefined : expectedEpisodeCount,
      lockedEpisodeCount: isMovie ? undefined : lockedEpisodeCount,
      expectedSceneCount: sceneIds.length,
      lockedSceneCount: sceneIds.length,
      expectedSequenceCount: isMovie ? 1 : undefined,
      lockedSequenceCount: isMovie ? 1 : undefined,
    },
    approvedBy: "autostudio.script_lock",
    approvalState: "approved",
    unlockedRisks: isMovie || coverageRatio >= 1 ? [] : [`目标 ${expectedEpisodeCount} 集中当前只锁定 ${lockedEpisodeCount} 集。`],
    lockedAt: createdAt,
    createdAt,
  };
  const productionBlockLock: ProductionBlockLock = {
    schemaVersion: "production-block-lock.v1",
    id: `production-block-lock-${project.id}-${blockId}`,
    projectId: project.id,
    blockId,
    mode: format,
    lockType: isMovie ? "full_project" : "episode_block",
    episodeIds,
    sceneIds,
    nodeIds: [],
    scriptLockPackageId: scriptLockPackage.id,
    entryCriteria: [
      "script stage completed",
      "script_lock_package approved for this production block",
    ],
    exitCriteria: [
      "production_breakdown_report complete",
      "casting_requirement ready",
      "department_prep_package ready",
      "formal asset_board_plan ready",
    ],
    openDependencies: scriptLockPackage.unlockedRisks,
    status: "locked",
    lockedAt: createdAt,
    createdAt,
  };
  return { scriptLockPackage, productionBlockLock };
};

const findGameDataForLock = (
  project: Project,
  episodes: Episode[],
): { episodeId?: string; gameData?: GameProjectData } => {
  if ((project as any).gameData?.nodes) return { gameData: (project as any).gameData as GameProjectData };
  const episode = episodes.find((item) => item.gameData?.nodes?.length);
  return { episodeId: episode?.id, gameData: episode?.gameData };
};

export const createContentLockBundle = (
  project: Project,
  episodes: Episode[],
  createdAt = Date.now(),
): { contentLockPackage: ContentLockPackage; productionBlockLock: ProductionBlockLock } => {
  const { episodeId, gameData } = findGameDataForLock(project, episodes);
  const nodes = gameData?.nodes || [];
  const nodeIds = unique(nodes.map((node) => node.id));
  const variableStateIds = unique((gameData?.variables || []).map((variable) => variable.id || variable.name));
  const endingNodeIds = unique(nodes.filter((node) => node.isEnding).map((node) => node.id));
  const failurePathNodeIds = unique(nodes
    .filter((node) => /失败|失误|死亡|坏结局|断线|game over|fail|failure|dead|bad ending/i.test([
      node.title,
      node.scriptContent,
      node.detailedScript,
      node.sceneGoal,
      node.cliffhanger,
      node.hook,
    ].join(" ")))
    .map((node) => node.id));
  const blockId = `nodes-${nodeIds[0] || "none"}-${nodeIds.at(-1) || "none"}`;
  const contentLockPackage: ContentLockPackage = {
    schemaVersion: "content-lock-package.v1",
    id: `content-lock-${project.id}-${blockId}`,
    projectId: project.id,
    format: "interactive",
    lockScope: "node_block",
    graphRevision: `graph-revision-${project.id}-${nodeIds.length}-${createdAt}`,
    nodeIds,
    variableStateIds,
    goldenPathNodeIds: nodeIds.slice(0, Math.max(1, Math.min(nodeIds.length, 6))),
    endingNodeIds,
    failurePathNodeIds,
    endingCoverageRatio: endingNodeIds.length ? 1 : 0,
    unreachableNodeIds: [],
    unlockedNodeIds: [],
    variableGaps: variableStateIds.length ? [] : ["互动内容锁定缺少变量状态集合。"],
    approvedBy: "autostudio.content_lock",
    approvalState: "approved",
    lockedAt: createdAt,
    createdAt,
  };
  const productionBlockLock: ProductionBlockLock = {
    schemaVersion: "production-block-lock.v1",
    id: `production-block-lock-${project.id}-${blockId}`,
    projectId: project.id,
    blockId,
    mode: "interactive",
    lockType: "node_block",
    episodeIds: episodeId ? [episodeId] : [],
    sceneIds: [],
    nodeIds,
    contentLockPackageId: contentLockPackage.id,
    entryCriteria: [
      "interactive_script stage completed",
      "content_lock_package approved for this node block",
    ],
    exitCriteria: [
      "production_breakdown_report complete",
      "department_prep_package ready",
      "formal asset_board_plan ready",
    ],
    openDependencies: contentLockPackage.variableGaps,
    status: "locked",
    lockedAt: createdAt,
    createdAt,
  };
  return { contentLockPackage, productionBlockLock };
};

const resolveScriptLockBundle = (
  run: ProductionRun,
  project: Project,
  episodes: Episode[],
) => {
  const snapshot = latestCheckpointSnapshot(run, "script_lock");
  if (snapshot?.scriptLockPackage && snapshot?.productionBlockLock) {
    return {
      scriptLockPackage: snapshot.scriptLockPackage as ScriptLockPackage,
      productionBlockLock: snapshot.productionBlockLock as ProductionBlockLock,
    };
  }
  return createScriptLockBundle(project, episodes);
};

const resolveContentLockBundle = (
  run: ProductionRun,
  project: Project,
  episodes: Episode[],
) => {
  const snapshot = latestCheckpointSnapshot(run, "content_lock");
  if (snapshot?.contentLockPackage && snapshot?.productionBlockLock) {
    return {
      contentLockPackage: snapshot.contentLockPackage as ContentLockPackage,
      productionBlockLock: snapshot.productionBlockLock as ProductionBlockLock,
    };
  }
  return createContentLockBundle(project, episodes);
};

export const buildAutostudioCastingDecisions = ({
  projectId,
  castingRequirements,
  existingDecisions = [],
  scriptLockPackage,
  contentLockPackage,
  productionBlockLock,
  createdAt = Date.now(),
}: {
  projectId: string;
  castingRequirements: CastingRequirement[];
  existingDecisions?: CastingDecision[];
  scriptLockPackage?: ScriptLockPackage;
  contentLockPackage?: ContentLockPackage;
  productionBlockLock?: ProductionBlockLock;
  createdAt?: number;
}): CastingDecision[] => {
  const decidedRequirementIds = new Set(existingDecisions.map((decision) => decision.castingRequirementId).filter(Boolean));
  return castingRequirements
    .filter((requirement) => requirement.characterId && !decidedRequirementIds.has(requirement.id))
    .map((requirement) => buildCastingDecision({
      projectId,
      castingRequirement: requirement,
      decisionType: "assign_existing_character",
      candidate: {
        characterId: requirement.characterId,
        name: requirement.displayName,
        source: "existing_character",
        suitabilityNotes: [
          "AutoStudio director/casting bridge matched the locked role requirement to an existing project character.",
          ...requirement.performanceRange,
        ],
        riskNotes: requirement.costumeConstraints,
      },
      directorNotes: "AutoStudio 选角桥确认该锁定角色需求可复用既有角色身份，并进入正式资产板筹备。",
      scriptLockPackageId: scriptLockPackage?.id,
      contentLockPackageId: contentLockPackage?.id,
      productionBlockLockId: productionBlockLock?.id,
      approvedBy: "autostudio.casting_director",
      createdAt,
    }));
};

export const resolveProductionPrepBundle = (
  run: ProductionRun,
  project: Project,
  episodes: Episode[],
) => {
  const snapshot = latestCheckpointSnapshot(run, "production_breakdown");
  if (snapshot?.productionBreakdownReport) {
    const castingRequirements = (snapshot.castingRequirements || []) as CastingRequirement[];
    const existingCastingDecisions = (snapshot.castingDecisions || []) as CastingDecision[];
    const scriptLockPackage = snapshot.scriptLockPackage as ScriptLockPackage | undefined;
    const contentLockPackage = snapshot.contentLockPackage as ContentLockPackage | undefined;
    const productionBlockLock = snapshot.productionBlockLock as ProductionBlockLock | undefined;
    return {
      productionBreakdownReport: snapshot.productionBreakdownReport as ProductionBreakdownReport,
      continuityMatrix: snapshot.continuityMatrix,
      roleSlots: (snapshot.roleSlots || []) as RoleSlot[],
      castingRequirements,
      castingDecisions: [
        ...existingCastingDecisions,
        ...buildAutostudioCastingDecisions({
          projectId: project.id,
          castingRequirements,
          existingDecisions: existingCastingDecisions,
          scriptLockPackage,
          contentLockPackage,
          productionBlockLock,
        }),
      ],
      departmentPrepPackages: (snapshot.departmentPrepPackages || []) as DepartmentPrepPackage[],
      scriptLockPackage,
      contentLockPackage,
      productionBlockLock,
    };
  }
  const isInteractive = run.mode === "interactive" || project.projectModel === "interactive";
  const lockBundle = isInteractive
    ? resolveContentLockBundle(run, project, episodes)
    : resolveScriptLockBundle(run, project, episodes);
  const productionBreakdownReport = buildProductionBreakdownReport({
    project,
    episodes,
    scriptLockPackage: "scriptLockPackage" in lockBundle ? lockBundle.scriptLockPackage : undefined,
    contentLockPackage: "contentLockPackage" in lockBundle ? lockBundle.contentLockPackage : undefined,
    productionBlockLock: lockBundle.productionBlockLock,
  });
  const castingRequirements = buildCastingRequirements(project, productionBreakdownReport);
  const departmentPrepPackages = buildDepartmentPrepPackages(project, productionBreakdownReport);
  const continuityMatrix = buildContinuityMatrix({
    project,
    episodes,
    productionBreakdownReport,
    departmentPrepPackages,
  });
  const castingDecisions = buildAutostudioCastingDecisions({
    projectId: project.id,
    castingRequirements,
    scriptLockPackage: "scriptLockPackage" in lockBundle ? lockBundle.scriptLockPackage : undefined,
    contentLockPackage: "contentLockPackage" in lockBundle ? lockBundle.contentLockPackage : undefined,
    productionBlockLock: lockBundle.productionBlockLock,
  });
  return {
    ...lockBundle,
    productionBreakdownReport,
    continuityMatrix,
    roleSlots: buildRoleSlots({ project, castingRequirements }),
    castingRequirements,
    castingDecisions,
    departmentPrepPackages,
  };
};

export const latestFormalAssetBoardPlan = (run: ProductionRun): VideoStoryboardAssetBoardPlan | undefined => {
  const snapshot = latestCheckpointSnapshot(run, "production_asset_detail");
  return snapshot?.assetBoardPlan as VideoStoryboardAssetBoardPlan | undefined;
};

export const latestFormalAssetPackage = (run: ProductionRun): FormalAssetPackage | undefined => {
  const snapshot = latestCheckpointSnapshot(run, "production_asset_detail");
  return snapshot?.formalAssetPackage as FormalAssetPackage | undefined;
};
