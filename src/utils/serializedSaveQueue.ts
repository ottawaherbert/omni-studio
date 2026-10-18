export interface SerializedSaveBatch<ProjectData, EpisodeData> {
  projectData: ProjectData;
  episodesToSave: EpisodeData[];
}

export interface SerializedSaveQueueOptions<ProjectData, EpisodeData extends { id: string }> {
  persist: (projectId: string, projectData: ProjectData, episodesToSave: EpisodeData[]) => Promise<void>;
  onSaving?: (projectId: string) => void;
  onFailure?: (
    projectId: string,
    batch: SerializedSaveBatch<ProjectData, EpisodeData>,
    error: unknown,
  ) => void;
  onPendingAfterFailure?: (
    projectId: string,
    batch: SerializedSaveBatch<ProjectData, EpisodeData>,
    error: unknown,
  ) => void;
  onIdle?: (projectId: string) => void;
}

interface ProjectSaveState<ProjectData, EpisodeData> {
  projectData?: ProjectData;
  episodes: Map<string, EpisodeData>;
  timer?: ReturnType<typeof setTimeout>;
  chain?: Promise<void>;
  failedError?: unknown;
}

export const createSerializedSaveQueue = <ProjectData, EpisodeData extends { id: string }>(
  options: SerializedSaveQueueOptions<ProjectData, EpisodeData>,
) => {
  const states = new Map<string, ProjectSaveState<ProjectData, EpisodeData>>();
  const stateFor = (projectId: string) => {
    const existing = states.get(projectId);
    if (existing) return existing;
    const created: ProjectSaveState<ProjectData, EpisodeData> = { episodes: new Map<string, EpisodeData>() };
    states.set(projectId, created);
    return created;
  };

  const takePendingBatch = (state: ProjectSaveState<ProjectData, EpisodeData>) => {
    if (state.projectData === undefined) return null;
    const batch = {
      projectData: state.projectData,
      episodesToSave: Array.from(state.episodes.values()),
    };
    state.projectData = undefined;
    state.episodes.clear();
    return batch;
  };

  const restoreFailedBatch = (
    state: ProjectSaveState<ProjectData, EpisodeData>,
    batch: SerializedSaveBatch<ProjectData, EpisodeData>,
  ) => {
    if (state.projectData === undefined) state.projectData = batch.projectData;
    for (const episode of batch.episodesToSave) {
      if (!state.episodes.has(episode.id)) state.episodes.set(episode.id, episode);
    }
    return {
      projectData: state.projectData,
      episodesToSave: Array.from(state.episodes.values()),
    };
  };

  const runPending = async (projectId: string, state: ProjectSaveState<ProjectData, EpisodeData>) => {
    const batch = takePendingBatch(state);
    if (!batch) return;
    try {
      await options.persist(projectId, batch.projectData, batch.episodesToSave);
    } catch (error) {
      state.failedError = error;
      options.onFailure?.(projectId, restoreFailedBatch(state, batch), error);
      throw error;
    }
  };

  const enqueue = (projectId: string, state: ProjectSaveState<ProjectData, EpisodeData>) => {
    if (state.failedError) return Promise.reject(state.failedError);
    const previous = state.chain || Promise.resolve();
    const run = previous.catch(() => undefined).then(() => runPending(projectId, state));
    let tracked: Promise<void>;
    tracked = run.finally(() => {
      if (state.chain !== tracked) return;
      state.chain = undefined;
      if (!state.timer && state.projectData === undefined) options.onIdle?.(projectId);
    });
    state.chain = tracked;
    return tracked;
  };

  const schedule = (projectId: string, projectData: ProjectData, episodes: EpisodeData[], delay = 500) => {
    const state = stateFor(projectId);
    state.projectData = projectData;
    for (const episode of episodes) {
      if (episode) state.episodes.set(episode.id, episode);
    }
    if (state.failedError) {
      options.onPendingAfterFailure?.(projectId, {
        projectData,
        episodesToSave: Array.from(state.episodes.values()),
      }, state.failedError);
      return;
    }
    if (state.timer) clearTimeout(state.timer);
    const timer = setTimeout(() => {
      if (state.timer !== timer) return;
      state.timer = undefined;
      void enqueue(projectId, state).catch(() => undefined);
    }, delay);
    state.timer = timer;
    options.onSaving?.(projectId);
  };

  const flush = async (projectId: string) => {
    const state = states.get(projectId);
    if (!state) return;
    if (state.failedError) throw state.failedError;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    if (state.projectData !== undefined) {
      await enqueue(projectId, state);
    } else if (state.chain) {
      await state.chain;
    }
  };

  const clearFailure = (projectId: string) => {
    const state = states.get(projectId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    state.projectData = undefined;
    state.episodes.clear();
    state.failedError = undefined;
  };

  return { schedule, flush, clearFailure };
};
