import { productionClient } from "../../clients/productionClient";
import { useProjectStore } from "../../store/useProjectStore";
import type { Episode, Project } from "../../types/project";
import type { ProductionRepository } from "./repositories";

const loadEpisodeFromApi = async (project: Project, episodeId: string): Promise<Episode | null> => {
  return productionClient.getProjectEpisode(project.id, episodeId);
};

export const createStoreProductionRepository = (): ProductionRepository => ({
  getProject: () => {
    const project = useProjectStore.getState().currentProject;
    if (!project) throw new Error("未加载项目，无法执行自动制片阶段。");
    return project;
  },
  updateProject: async (updates) => {
    await useProjectStore.getState().updateProject(updates);
  },
  addEpisode: async (episode) => {
    await useProjectStore.getState().addEpisode(episode);
  },
  listEpisodes: async (project) => {
    const episodes: Episode[] = [];
    for (const meta of project.episodes || []) {
      const episode = await loadEpisodeFromApi(project, meta.id);
      if (!episode) {
        throw new Error(`无法加载完整分集 ${meta.id}，不能把缺失分集当作空 scenes 继续自动制片。`);
      }
      episodes.push(episode);
    }
    return episodes;
  },
  getEpisode: (project, episodeId) => loadEpisodeFromApi(project, episodeId),
  updateEpisode: async (episodeId, updates) => {
    await useProjectStore.getState().updateEpisode(episodeId, updates);
  },
  listOperatorArtifacts: async ({ projectId, runId }) => {
    return productionClient.listOperatorArtifacts({ projectId, runId });
  },
});
