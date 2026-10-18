import type { Episode, Project } from "../../types/project";
import type { GameProjectData } from "../../types/game";
import { applyInteractiveProjectionSync } from "../../utils/interactiveNodeSceneMapper";
import type { CastingDecision } from "./productionCasting";
import { getProductionRepository } from "./productionRepositoryRuntime";

export const getProject = () => getProductionRepository().getProject();

export const updateProject = async (updates: Partial<Project>) => {
  await getProductionRepository().updateProject(updates);
};

export const addEpisode = async (episode: Episode) => {
  await getProductionRepository().addEpisode(episode);
};

export const loadFullEpisodes = (project: Project): Promise<Episode[]> =>
  getProductionRepository().listEpisodes(project);

export const loadEpisodeOrFallback = async (
  project: Project,
  episodeMeta: Project["episodes"][number],
): Promise<Episode> => {
  const episode = await getProductionRepository().getEpisode(project, episodeMeta.id);
  return episode || { ...episodeMeta, scenes: [] } as Episode;
};

export const updateEpisode = async (episodeId: string, updates: Partial<Episode>) => {
  await getProductionRepository().updateEpisode(episodeId, updates);
};

export const ensurePrimaryEpisode = async (
  project: Project,
  title = "自动制片阶段",
): Promise<Episode> => {
  const episodes = await loadFullEpisodes(project);
  if (episodes[0]) return episodes[0];
  const episode: Episode = {
    id: `episode-${Date.now()}-${crypto.randomUUID()}`,
    title,
    inspiration: project.logline || project.originalInspiration || "",
    scenes: [],
  };
  await addEpisode(episode);
  return episode;
};

export const saveInteractiveEpisode = async (
  episode: Episode,
  gameData: GameProjectData,
) => {
  const syncResult = applyInteractiveProjectionSync(gameData, episode.scenes || []);
  await updateEpisode(episode.id, {
    gameData: syncResult.gameData,
    scenes: syncResult.scenes,
  });
  return {
    gameData: syncResult.gameData,
    scenes: syncResult.scenes,
    removedOrphanSceneCount: syncResult.removedOrphanSceneCount,
  };
};

export const loadInteractiveEpisodes = async (project: Project) => {
  const episodes = await loadFullEpisodes(project);
  return episodes.filter((episode) => episode.gameData?.nodes?.length);
};

const unwrapCastingDecisionArtifact = (artifact: any): CastingDecision | undefined => {
  const data = artifact?.data;
  const decision = data?.castingDecision || data?.decision || (artifact?.kind === "casting_decision" ? data : undefined);
  return decision?.schemaVersion === "casting-decision.v1" ? decision as CastingDecision : undefined;
};

export const mergeCastingDecisions = (...groups: Array<Array<CastingDecision | undefined>>) => {
  const map = new Map<string, CastingDecision>();
  groups.flat().forEach((decision) => {
    if (decision?.id) map.set(decision.id, decision);
  });
  return Array.from(map.values());
};

export const fetchApprovedCastingDecisionsForPrep = async (
  projectId: string,
  productionBreakdownReportId?: string,
  castingRequirementIds: string[] = [],
): Promise<CastingDecision[]> => {
  try {
    const artifacts = await getProductionRepository().listOperatorArtifacts({ projectId });
    const requirementIds = new Set(castingRequirementIds.filter(Boolean));
    return (Array.isArray(artifacts) ? artifacts : [])
      .map(unwrapCastingDecisionArtifact)
      .filter((decision): decision is CastingDecision => {
        if (!decision || decision.status !== "approved") return false;
        const sameBreakdown = productionBreakdownReportId && decision.productionBreakdownReportId === productionBreakdownReportId;
        const sameRequirement = requirementIds.size > 0 && requirementIds.has(decision.castingRequirementId);
        return Boolean(sameBreakdown || sameRequirement || (!productionBreakdownReportId && requirementIds.size === 0));
      });
  } catch (error) {
    console.warn("Failed to load operator casting decisions for production_asset_detail:", error);
    return [];
  }
};
