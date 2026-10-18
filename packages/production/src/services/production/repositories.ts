import type { Episode, Project } from "../../../../../src/types/project";

export interface ProjectRepository {
  getProject: () => Project;
  updateProject: (updates: Partial<Project>) => Promise<void>;
}

export interface EpisodeRepository {
  addEpisode: (episode: Episode) => Promise<void>;
  listEpisodes: (project: Project) => Promise<Episode[]>;
  getEpisode: (project: Project, episodeId: string) => Promise<Episode | null>;
  updateEpisode: (episodeId: string, updates: Partial<Episode>) => Promise<void>;
}

export interface OperatorArtifactRepository {
  listOperatorArtifacts: (filters: { projectId?: string; runId?: string }) => Promise<unknown[]>;
}

export type ProductionRepository =
  & ProjectRepository
  & EpisodeRepository
  & OperatorArtifactRepository;
