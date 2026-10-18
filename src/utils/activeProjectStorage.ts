const ACTIVE_PROJECT_ID_STORAGE_KEY = "omni.activeProjectId";
const ACTIVE_EPISODE_ID_STORAGE_PREFIX = "omni.activeEpisodeId.";

interface WorkspaceProjectReference {
  id: string;
  episodes?: Array<{ id: string }>;
}

export const resolveWorkspaceProjectId = ({
  projects,
  requestedProjectId,
  requestedEpisodeId,
  storedProjectId,
}: {
  projects: WorkspaceProjectReference[];
  requestedProjectId?: string | null;
  requestedEpisodeId?: string | null;
  storedProjectId?: string | null;
}) => requestedProjectId
  || projects.find((project) => project.episodes?.some((episode) => episode.id === requestedEpisodeId))?.id
  || storedProjectId
  || null;

export const readActiveProjectId = () => {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
};

export const writeActiveProjectId = (projectId: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(ACTIVE_PROJECT_ID_STORAGE_KEY, projectId);
};

export const clearActiveProjectId = (projectId?: string) => {
  if (typeof localStorage === "undefined") return;
  if (!projectId || localStorage.getItem(ACTIVE_PROJECT_ID_STORAGE_KEY) === projectId) {
    localStorage.removeItem(ACTIVE_PROJECT_ID_STORAGE_KEY);
  }
};

export const readActiveEpisodeId = (projectId: string) => {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(`${ACTIVE_EPISODE_ID_STORAGE_PREFIX}${projectId}`);
};

export const writeActiveEpisodeId = (projectId: string, episodeId: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(`${ACTIVE_EPISODE_ID_STORAGE_PREFIX}${projectId}`, episodeId);
};

export const clearActiveEpisodeId = (projectId: string) => {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(`${ACTIVE_EPISODE_ID_STORAGE_PREFIX}${projectId}`);
};
