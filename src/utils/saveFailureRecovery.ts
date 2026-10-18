import { Episode, Project } from "../types/project";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import { normalizeProjectUniversalSkillRefs, projectUniversalSkillRefs } from "./universalSkillRefs";

export const SAVE_FAILED_PREFIX = "save_failed_";
// A revision may advance here only after this tab receives a successful write
// response. Re-reading the server and replaying an old scene would bypass CAS.
const confirmedEpisodeRevisions = new Map<string, number>();
export const noteSuccessfulProductionEpisodeWrite = (projectId: string, episode: Episode) => {
  if (Number.isSafeInteger(episode.productionRevision)) {
    confirmedEpisodeRevisions.set(`${projectId}:${episode.id}`, episode.productionRevision!);
  }
};

export interface FailedSavePayload {
  projectData: Project;
  episodesToSave: Episode[];
  timestamp: number;
  attempts?: number;
  lastError?: string;
}

export interface SaveRecoveryResult {
  projectId: string;
  recovered: boolean;
  projectData?: Project;
  episodesToSave: Episode[];
  error?: string;
}

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const failedSaveKey = (projectId: string) => `${SAVE_FAILED_PREFIX}${projectId}`;

export const listFailedSaveProjectIds = (storage: BrowserStorage = localStorage) => {
  const ids: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(SAVE_FAILED_PREFIX)) {
      ids.push(key.slice(SAVE_FAILED_PREFIX.length));
    }
  }
  return ids;
};

export const readFailedSavePayload = (
  projectId: string,
  storage: BrowserStorage = localStorage,
): FailedSavePayload | null => {
  const raw = storage.getItem(failedSaveKey(projectId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FailedSavePayload;
    if (!parsed?.projectData?.id || !parsed.timestamp) return null;
    return {
      ...parsed,
      projectData: normalizeProjectUniversalSkillRefs(parsed.projectData) as Project,
      episodesToSave: Array.isArray(parsed.episodesToSave) ? parsed.episodesToSave : [],
    };
  } catch {
    return null;
  }
};

export const writeFailedSavePayload = (
  projectId: string,
  payload: FailedSavePayload,
  storage: BrowserStorage = localStorage,
) => {
  storage.setItem(failedSaveKey(projectId), JSON.stringify({
    ...payload,
    projectData: normalizeProjectUniversalSkillRefs(payload.projectData) as Project,
  }));
};

const mergeById = <T extends { id?: string }>(
  queued: T[] = [],
  current: T[] = [],
  preferQueued: boolean,
) => {
  const merged = new Map<string, T>();
  const fallback: T[] = [];
  const add = (item: T) => {
    if (item?.id) {
      merged.set(item.id, item);
    } else if (item) {
      fallback.push(item);
    }
  };
  if (preferQueued) {
    current.forEach(add);
    queued.forEach(add);
  } else {
    queued.forEach(add);
    current.forEach(add);
  }
  return [...merged.values(), ...fallback];
};

export const mergeFailedProjectData = (
  queuedProject: Project,
  currentProject?: Project | null,
  options: { preferQueuedProjectData?: boolean } = {},
): Project => {
  const normalizedQueuedProject = normalizeProjectUniversalSkillRefs(queuedProject) as Project;
  const normalizedCurrentProject = normalizeProjectUniversalSkillRefs(currentProject) as Project | undefined;
  if (!normalizedCurrentProject || normalizedCurrentProject.id !== normalizedQueuedProject.id) return normalizedQueuedProject;
  const preferQueued = options.preferQueuedProjectData === true;
  const base = preferQueued ? normalizedCurrentProject : normalizedQueuedProject;
  const overlay = preferQueued ? normalizedQueuedProject : normalizedCurrentProject;
  return {
    ...base,
    ...overlay,
    globalGenerationParams: {
      ...(base.globalGenerationParams || {}),
      ...(overlay.globalGenerationParams || {}),
    },
    creativeVision: {
      ...(base.creativeVision || {}),
      ...(overlay.creativeVision || {}),
    } as Project["creativeVision"],
    characters: mergeById(normalizedQueuedProject.characters || [], normalizedCurrentProject.characters || [], preferQueued),
    relationships: mergeById(normalizedQueuedProject.relationships || [], normalizedCurrentProject.relationships || [], preferQueued),
    episodes: mergeById(normalizedQueuedProject.episodes || [], normalizedCurrentProject.episodes || [], preferQueued),
    assets: mergeById(normalizedQueuedProject.assets || [], normalizedCurrentProject.assets || [], preferQueued),
    universalSkillRefs: mergeById(projectUniversalSkillRefs(normalizedQueuedProject), projectUniversalSkillRefs(normalizedCurrentProject), preferQueued),
    customTemplates: mergeById(normalizedQueuedProject.customTemplates || [], normalizedCurrentProject.customTemplates || [], preferQueued),
    extractedDNAs: mergeById(normalizedQueuedProject.extractedDNAs || [], normalizedCurrentProject.extractedDNAs || [], preferQueued),
    worldBuildingRules: mergeById(normalizedQueuedProject.worldBuildingRules || [], normalizedCurrentProject.worldBuildingRules || [], preferQueued),
  };
};

export const mergeFailedEpisodes = (
  queuedEpisodes: Episode[] = [],
  currentEpisodes: Episode[] = [],
  options: { preferQueuedEpisodes?: boolean } = {},
) => mergeById(queuedEpisodes, currentEpisodes, options.preferQueuedEpisodes === true);

export const persistProjectSnapshotNow = async (
  projectId: string,
  projectData: Project,
  episodesToSave: Episode[] = [],
) => {
  const { extractAndSaveAssets } = await import("./storage");
  const optimizedProject = await extractAndSaveAssets(normalizeProjectUniversalSkillRefs(projectData) as Project, projectId);
  const episodesWithConfirmedRevision = episodesToSave.map((episode) => {
    const confirmed = confirmedEpisodeRevisions.get(`${projectId}:${episode.id}`);
    const incoming = episode.productionRevision;
    return {
      ...episode,
      // A later explicit read can be newer than this tab's last write receipt.
      // Still use our receipt for successive edits based on an older local view.
      productionRevision: Number.isSafeInteger(incoming)
        ? Math.max(incoming!, confirmed ?? incoming!)
        : confirmed,
    };
  });
  if (episodesWithConfirmedRevision.some(episode => episode.scenes?.some(scene => scene.shots?.some(shot => shot.appearance)))) {
    const optimizedEpisodes = await Promise.all(episodesWithConfirmedRevision.map(episode => extractAndSaveAssets(episode, projectId)));
    const result = await legacyProjectClient.saveAppearanceSnapshot(projectId, optimizedProject as Project, optimizedEpisodes as Episode[]);
    for (const [episodeId, revision] of Object.entries(result.__savedEpisodeRevisions || {})) {
      noteSuccessfulProductionEpisodeWrite(projectId, { id: episodeId, productionRevision: revision } as Episode);
    }
    return;
  }
  await legacyProjectClient.patchProject(projectId, optimizedProject as Project);

  for (const episode of episodesWithConfirmedRevision) {
    const optimizedEpisode = await extractAndSaveAssets(episode, projectId);
    const savedEpisode = await legacyProjectClient.saveEpisode(projectId, optimizedEpisode as Episode);
    noteSuccessfulProductionEpisodeWrite(projectId, savedEpisode);
  }
};

export const recoverFailedProjectSave = async (
  projectId: string,
  currentProject?: Project | null,
  options: {
    preferQueuedProjectData?: boolean;
    currentEpisodes?: Episode[];
    preferQueuedEpisodes?: boolean;
    storage?: BrowserStorage;
  } = {},
): Promise<SaveRecoveryResult> => {
  const storage = options.storage || localStorage;
  const rawAtStart = storage.getItem(failedSaveKey(projectId));
  const payload = readFailedSavePayload(projectId, storage);
  if (!payload) return { projectId, recovered: false, episodesToSave: [] };

  const projectData = mergeFailedProjectData(payload.projectData, currentProject, {
    preferQueuedProjectData: options.preferQueuedProjectData,
  });
  const episodesToSave = mergeFailedEpisodes(payload.episodesToSave, options.currentEpisodes || [], {
    preferQueuedEpisodes: options.preferQueuedEpisodes,
  });

  try {
    await persistProjectSnapshotNow(projectId, projectData, episodesToSave);
    if (storage.getItem(failedSaveKey(projectId)) !== rawAtStart) {
      return { projectId, recovered: false, projectData, episodesToSave, error: "恢复期间又有新修改，本机草稿继续保留。" };
    }
    storage.removeItem(failedSaveKey(projectId));
    return { projectId, recovered: true, projectData, episodesToSave };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (storage.getItem(failedSaveKey(projectId)) !== rawAtStart) {
      return { projectId, recovered: false, projectData, episodesToSave, error: message };
    }
    writeFailedSavePayload(projectId, {
      ...payload,
      projectData,
      episodesToSave,
      attempts: (payload.attempts || 0) + 1,
      lastError: message,
    }, storage);
    return { projectId, recovered: false, projectData, episodesToSave, error: message };
  }
};
