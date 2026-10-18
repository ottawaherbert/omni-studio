import { productionClient } from "../../clients/productionClient";
import { GameProjectData } from "../../types/game";
import { Episode, Project } from "../../types/project";
import { ProductionAuthoritySnapshot } from "../../types/production";
import { useGameStore } from "../../store/useGameStore";
import { useProjectStore } from "../../store/useProjectStore";
import { persistProjectSnapshotNow } from "../../utils/saveFailureRecovery";

const cloneSerializable = <T>(value: T): T => {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value)) as T;
};

const episodeFromMetaOrFetch = async (
  projectId: string,
  episode: Episode,
): Promise<Episode | null> => {
  if ((episode as Episode).scenes || (episode as Episode).gameData) {
    return cloneSerializable(episode);
  }
  try {
    return await productionClient.getProjectEpisode(projectId, episode.id);
  } catch {
    return null;
  }
};

const collectFullEpisodes = async (
  project: Project | null,
  activeEpisode: Episode | null,
) => {
  if (!project) return [];
  const byId = new Map<string, Episode>();
  if (activeEpisode?.id) {
    byId.set(activeEpisode.id, cloneSerializable(activeEpisode));
  }
  for (const episodeMeta of project.episodes || []) {
    if (episodeMeta.id && byId.has(episodeMeta.id)) continue;
    const episode = await episodeFromMetaOrFetch(project.id, episodeMeta as Episode);
    if (episode?.id) byId.set(episode.id, episode);
  }
  return Array.from(byId.values());
};

export const captureProductionAuthoritySnapshot = async (): Promise<ProductionAuthoritySnapshot> => {
  const projectState = useProjectStore.getState();
  const gameState = useGameStore.getState();
  const project = cloneSerializable(projectState.currentProject);
  const activeEpisode = cloneSerializable(projectState.activeEpisode);
  return {
    schemaVersion: "production-authority-snapshot.v1",
    capturedAt: Date.now(),
    project,
    activeEpisodeId: projectState.activeEpisodeId || null,
    activeEpisode,
    fullEpisodes: await collectFullEpisodes(project, activeEpisode),
    gameProjectId: gameState.projectId,
    gameEpisodeId: gameState.episodeId,
    gameData: cloneSerializable(gameState.data) as GameProjectData,
  };
};

export const restoreProductionAuthoritySnapshot = async (
  snapshot: ProductionAuthoritySnapshot,
  options: { persist?: boolean } = {},
) => {
  const project = cloneSerializable(snapshot.project);
  const activeEpisode = cloneSerializable(snapshot.activeEpisode);
  const fullEpisodes = cloneSerializable(snapshot.fullEpisodes || []);
  useProjectStore.setState((state) => ({
    currentProject: project,
    activeEpisodeId: snapshot.activeEpisodeId || null,
    activeEpisode,
    projects: project
      ? state.projects.some((item) => item.id === project.id)
        ? state.projects.map((item) => (item.id === project.id ? project : item))
        : [...state.projects, project]
      : state.projects,
  }));
  if (snapshot.gameData) {
    useGameStore.setState({
      projectId: snapshot.gameProjectId || null,
      episodeId: snapshot.gameEpisodeId || null,
      data: cloneSerializable(snapshot.gameData),
    });
  }
  if (options.persist && project?.id) {
    await persistProjectSnapshotNow(project.id, project, fullEpisodes);
  }
};
