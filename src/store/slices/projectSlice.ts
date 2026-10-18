import { StateCreator } from 'zustand';
import toast from 'react-hot-toast';
import { produce } from 'immer';
import { Project, Episode, EpisodeMeta, Asset, Character } from '../../types/project';
import {
  failedSaveKey,
  listFailedSaveProjectIds,
  persistProjectSnapshotNow,
  recoverFailedProjectSave,
  writeFailedSavePayload,
  readFailedSavePayload,
} from '../../utils/saveFailureRecovery';
import { normalizeProjectUniversalSkillRefs, projectUniversalSkillRefs } from '../../utils/universalSkillRefs';
import {
  clearActiveEpisodeId,
  clearActiveProjectId,
  readActiveEpisodeId,
  writeActiveProjectId,
} from '../../utils/activeProjectStorage';
import {
  collectVisualStyleSourceChangedFields,
  resolveVisualStyleSourceReviewForUpdate,
} from '../visualStyleSourceReview';
import {
  createDefaultStyleVariantPolicy,
  createDefaultTargetScale,
  resolveProductionLockStrategy,
  resolveProductionMode,
} from '../../services/production/productionMode';
import { legacyProjectClient, type LegacyEpisodeView } from '../../clients/legacyProjectClient';
import { createSerializedSaveQueue } from '../../utils/serializedSaveQueue';

export interface ProjectSlice {
  projects: Project[];
  currentProject: Project | null;
  _updateProjectLock?: Promise<void>;
  isLoading: boolean;
  syncStatus: 'idle' | 'saving' | 'saved' | 'failed' | 'retrying';
  lastAssetOrphanWarning: any | null;
  clearAssetOrphanWarning: () => void;
  lastAssetLifecycleImpactReports: any[] | null;
  clearAssetLifecycleImpactReports: () => void;
  applyAssetLifecycleRepairs: (
    repairPlans: any[],
    freeTextReplacements: { path: string; oldName: string; newName: string }[]
  ) => Promise<void>;
  saveConflict: {
    isOpen: boolean;
    projectId: string;
    dbVersion: Project | null;
    localVersion: Project | null;
    memoryVersion: Project | null;
    resolvePromise?: (choice: 'db' | 'local' | 'memory' | 'merge') => void;
  } | null;
  showSaveConflict: (projectId: string, dbVersion: Project, localVersion: Project, memoryVersion: Project) => Promise<'db' | 'local' | 'memory' | 'merge'>;
  setSyncStatus: (status: 'idle' | 'saving' | 'saved' | 'failed' | 'retrying') => void;
  fetchProjects: () => Promise<void>;
  createProject: (project: Partial<Project>) => Promise<Project>;
  loadProject: (
    id: string,
    options?: { episodeView?: LegacyEpisodeView; sceneId?: string; shotId?: string },
  ) => Promise<void>;
  updateProject: (
    updates: Partial<Project>,
    options?: ProjectWriteGuard,
  ) => Promise<void>;
  setProjectTrashState: (id: string, trashedAt: number | null) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  recoverFailedSaves: (projectId?: string, options?: { preferQueuedProjectData?: boolean }) => Promise<number>;
}

export interface ProjectWriteGuard {
  expectedProjectId?: string;
}

// Helper for debounced persistence
let _globalSetSyncStatus: ((status: any) => void) | null = null;
let projectListRequest: Promise<Project[]> | null = null;

type LegacyProjectPayload = Omit<Project, "episodes"> & {
  episodes?: any[];
  scenes?: any[];
};

const containsCjk = (value?: string) => /[\u3400-\u9fff]/.test(value || "");

const characterVisualPrompt = (character: Character, existingPrompt?: string) => {
  if (character.multiViewPrompt && containsCjk(character.multiViewPrompt)) return character.multiViewPrompt;
  if (existingPrompt && containsCjk(existingPrompt)) return existingPrompt;
  const identity = [
    character.name,
    (character as any).roleType,
    character.visualIdentity,
  ].filter(Boolean).join("，");
  return `${identity || "角色"}，中文多视图角色设定图，正面、侧面、背面，服装材质和面部特征清晰，统一光线，干净背景，适合后续分镜和图片生成`;
};

export const syncCharactersFromCharacterAssets = (
  characters: Character[],
  assets: Asset[],
): Character[] => characters.map((character) => {
  const correspondingAsset = assets.find((asset) => asset.id === `char-${character.id}`);
  if (!correspondingAsset) return character;

  return {
    ...character,
    referenceImageUrl: correspondingAsset.imageUrl,
    defaultReferenceUrl: correspondingAsset.defaultReferenceUrl,
    defaultVariantId: correspondingAsset.defaultVariantId,
    ...(correspondingAsset.variants ? { variants: correspondingAsset.variants } : {}),
    ...(correspondingAsset.prompt && !containsCjk(correspondingAsset.prompt) && correspondingAsset.prompt !== character.multiViewPrompt
      ? { multiViewPrompt: correspondingAsset.prompt }
      : {}),
  };
});

const ensureProductionMetadata = (project: Project): Project => {
  const next = { ...project };
  next.productionMode = next.productionMode || resolveProductionMode(next);
  next.lockStrategy = next.lockStrategy || resolveProductionLockStrategy(next);
  next.targetScale = next.targetScale || createDefaultTargetScale(next);
  next.styleVariantPolicy = next.styleVariantPolicy || createDefaultStyleVariantPolicy(next);
  return next;
};

const projectSaveQueue = createSerializedSaveQueue<Project, Episode>({
  persist: persistProjectSnapshotNow,
  onSaving: () => _globalSetSyncStatus?.('saving'),
  onFailure: (projectId, batch, error) => {
    console.error(`Failed to persist project ${projectId}:`, error);
    _globalSetSyncStatus?.('failed');
    writeFailedSavePayload(projectId, {
      ...batch,
      timestamp: Date.now(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    toast.error(error instanceof Error ? error.message : "保存失败。本机修改已保留，请检查后手动处理。");
  },
  onPendingAfterFailure: (projectId, batch, error) => {
    writeFailedSavePayload(projectId, {
      ...batch,
      timestamp: Date.now(),
      lastError: error instanceof Error ? error.message : String(error),
    });
  },
  onIdle: (projectId) => {
    if (typeof localStorage !== "undefined") localStorage.removeItem(failedSaveKey(projectId));
    _globalSetSyncStatus?.('saved');
    setTimeout(() => _globalSetSyncStatus?.('idle'), 2000);
  },
});

export const debouncedSaveProjectState = (projectId: string, projectData: any, episodesToSave: any[], delay: number = 500) => {
  projectSaveQueue.schedule(projectId, projectData, episodesToSave, delay);
};

export const flushDebouncedProjectSave = async (projectId: string) => {
  await projectSaveQueue.flush(projectId);
  if (typeof localStorage !== "undefined" && readFailedSavePayload(projectId)) {
    throw new Error("本机仍有未保存的制片修改。请处理保存错误后再导出。");
  }
};

export const createProjectSlice: StateCreator<ProjectSlice & any, [], [], ProjectSlice> = (set, get) => {
  // Initialize the global sync status setter so debounced state can grab it
  _globalSetSyncStatus = (status) => set({ syncStatus: status });

  return {
    projects: [],
    currentProject: null,
    isLoading: false,
    syncStatus: 'idle' as const,
    lastAssetOrphanWarning: null,
    clearAssetOrphanWarning: () => set({ lastAssetOrphanWarning: null }),
    lastAssetLifecycleImpactReports: null,
    clearAssetLifecycleImpactReports: () => set({ lastAssetLifecycleImpactReports: null }),
    saveConflict: null,
    showSaveConflict: (projectId, dbVersion, localVersion, memoryVersion) => {
      return new Promise((resolve) => {
        set({
          saveConflict: {
            isOpen: true,
            projectId,
            dbVersion,
            localVersion,
            memoryVersion,
            resolvePromise: (choice) => {
              set({ saveConflict: null });
              resolve(choice);
            }
          }
        });
      });
    },
    setSyncStatus: (status: 'idle' | 'saving' | 'saved' | 'failed' | 'retrying') => {
      set({ syncStatus: status });
    },

    recoverFailedSaves: async (projectId?: string, options: { preferQueuedProjectData?: boolean } = {}) => {
      const ids = projectId ? [projectId] : listFailedSaveProjectIds();
      if (ids.length === 0) return 0;
      let recoveredCount = 0;
      let failedCount = 0;
      set({ syncStatus: 'retrying' });
      for (const id of ids) {
        const state = get();
        const currentProject =
          state.currentProject?.id === id
            ? state.currentProject
            : state.projects.find((project: Project) => project.id === id);
        const activeEpisode =
          state.currentProject?.id === id && state.activeEpisode
            ? [state.activeEpisode]
            : [];
        const result = await recoverFailedProjectSave(id, currentProject, {
          currentEpisodes: activeEpisode,
          preferQueuedProjectData: options.preferQueuedProjectData === true,
          preferQueuedEpisodes: options.preferQueuedProjectData === true,
        });
        if (result.recovered && result.projectData) {
          projectSaveQueue.clearFailure(id);
          recoveredCount += 1;
          set((latestState: any) => ({
            projects: latestState.projects.map((project: Project) =>
              project.id === id ? result.projectData : project,
            ),
            currentProject:
              latestState.currentProject?.id === id
                ? result.projectData
                : latestState.currentProject,
          }));
        } else if (result.error) {
          failedCount += 1;
        }
      }
      set({ syncStatus: failedCount > 0 ? 'failed' : recoveredCount > 0 ? 'saved' : 'idle' });
      if (recoveredCount > 0) {
        toast.success(`已恢复 ${recoveredCount} 个失败保存队列。`);
        setTimeout(() => {
          if (get().syncStatus === 'saved') set({ syncStatus: 'idle' });
        }, 2000);
      }
      if (failedCount > 0) {
        toast.error(`仍有 ${failedCount} 个失败保存队列未恢复，已保留等待下次重试。`);
      }
      return recoveredCount;
    },

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      if (!projectListRequest) {
        const request = legacyProjectClient.listProjects();
        projectListRequest = request;
        void request.then(
          () => { if (projectListRequest === request) projectListRequest = null; },
          () => { if (projectListRequest === request) projectListRequest = null; },
        );
      }
      const projects = await projectListRequest;
      const validProjects = projects
        .filter(Boolean)
        .map((project) => normalizeProjectUniversalSkillRefs(project as Project)) as Project[];
      validProjects.sort((a, b) => Number(b.id) - Number(a.id));
      set({ projects: validProjects, isLoading: false });
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
    }
  },

  createProject: async (project) => {
    set({ isLoading: true });
    try {
      const initialCharacters = project.characters || [];
      const initialAssets = project.assets || [];
      
      const charAssets = initialCharacters.map(c => ({
        id: `char-${c.id}`,
        type: "character" as const,
        name: c.name,
        description: c.visualIdentity || '',
        prompt: `Production identity reference for ${c.name}; preserve the project's declared visual medium, appearance, proportions, materials, and recognizable character traits.`,
        imageUrl: c.referenceImageUrl,
        tags: c.externalGoal ? c.externalGoal.split(', ') : [],
      }));
      
      const nonCharAssets = initialAssets.filter(a => a.type !== "character");
      const mergedAssets = [...nonCharAssets, ...charAssets];

      const id = project.id || Date.now().toString();
      
      const fullEpisodes: Episode[] = ((project.episodes as any) || []).map((ep: any) => ({
        ...ep,
        id: ep.id || crypto.randomUUID()
      }));
      const episodeMetas: EpisodeMeta[] = fullEpisodes.map(ep => ({
        id: ep.id,
        sourceDocumentId: ep.sourceDocumentId,
        title: ep.title,
        inspiration: ep.inspiration,
        arcId: ep.arcId,
        targetDuration: ep.targetDuration,
        creativeDirection: ep.creativeDirection,
      }));

      const newProject: Project = {
        id,
        title: project.title || "Untitled Project",
        type: project.type || "movie",
        durationMinutes: project.durationMinutes,
        projectModel: project.projectModel || "linear",
        productionMode: project.productionMode,
        targetScale: project.targetScale,
        lockStrategy: project.lockStrategy,
        styleVariantPolicy: project.styleVariantPolicy,
        interactiveTemplate: project.interactiveTemplate,
        interactiveConfig: project.interactiveConfig,
        aspectRatio: project.aspectRatio || "16:9",
        originalInspiration: project.originalInspiration,
        refinedInspiration: project.refinedInspiration,
        originalStyleReference: project.originalStyleReference,
        globalGenerationParams: project.globalGenerationParams || {
          qualityPrompt: "",
          negativePrompt: ""
        },
        logline: project.logline || "",
        coreConflict: project.coreConflict || "",
        seasonArc: project.seasonArc,
        targetEpisodeCount: project.targetEpisodeCount,
        creativeVision: project.creativeVision || {
          genre: [],
          visualStyle: "",
          narrativeStyle: "",
          referenceWorks: ""
        },
        visualStyleLock: project.visualStyleLock,
        creativeDirection: project.creativeDirection,
        characters: initialCharacters,
        episodes: episodeMetas,
        assets: mergedAssets,
        universalSkillRefs: projectUniversalSkillRefs(project),
        manualProductionAssets: project.manualProductionAssets,
        productionSourceSnapshot: project.productionSourceSnapshot,
        productionSourceDocuments: project.productionSourceDocuments,
        productionScriptWorkspace: project.productionScriptWorkspace,
        productionScenePlans: project.productionScenePlans,
        isFromAdaptation: project.isFromAdaptation || false,
        adaptationData: project.adaptationData,
      };
      Object.assign(newProject, ensureProductionMetadata(newProject));

      try {
        const { extractAndSaveAssets } = await import("../../utils/storage");
        const optimizedProject = await extractAndSaveAssets({ ...newProject, episodes: fullEpisodes }, id);
        await legacyProjectClient.createProject(optimizedProject as Project);
      } catch (e) {
        console.error("Initial POST to DB failed:", e);
      }

      set((state) => ({
        projects: [...state.projects, newProject],
        currentProject: newProject,
        isLoading: false,
      }));
      writeActiveProjectId(newProject.id);
      
      if (fullEpisodes.length > 0) {
        await get().setActiveEpisodeId(fullEpisodes[0].id);
      }
      return newProject;
    } catch (e) {
      console.error("Failed to create project:", e);
      toast.error("创建项目失败，请检查服务器连接");
      set({ isLoading: false });
      throw e;
    }
  },

  loadProject: async (id, options) => {
    set({ isLoading: true });
    try {
      const projectView = options?.episodeView === "production-preparation"
        || options?.episodeView === "storyboard"
        || options?.episodeView === "storyboard-index"
        ? "production-workspace"
        : "shell";
      const apiData = await legacyProjectClient.getProject(id, projectView) as LegacyProjectPayload | null;
      if (apiData) {
        const fullEpisodes: Episode[] = apiData.episodes || [];
        if (apiData.scenes && apiData.scenes.length > 0 && fullEpisodes.length === 0) {
          fullEpisodes.push({
            id: "default-episode",
            title: apiData.type === "movie" ? "第一幕" : "第1集",
            inspiration: "",
            scenes: [...apiData.scenes],
          });
          delete apiData.scenes;
        }
        
        const episodeMetas = fullEpisodes.map((ep: any) => ({
          id: ep.id,
          sourceDocumentId: ep.sourceDocumentId,
          title: ep.title,
          inspiration: ep.inspiration,
          arcId: ep.arcId,
          targetDuration: ep.targetDuration,
          creativeDirection: ep.creativeDirection,
        }));
        
        let data = normalizeProjectUniversalSkillRefs({ ...apiData, episodes: episodeMetas } as Project) as Project;
        
        // --- Save Conflict Detection & Trilateral Resolution ---
        const payload = readFailedSavePayload(id);
        if (payload) {
          const localData = payload.projectData;
          const memoryData = get().currentProject;
          const hasConflict = JSON.stringify(localData) !== JSON.stringify(data) && 
                              memoryData && JSON.stringify(localData) !== JSON.stringify(memoryData);
          
          if (hasConflict) {
            const choice = await get().showSaveConflict(id, data, localData, memoryData);
            if (choice === 'db') {
              localStorage.removeItem(failedSaveKey(id));
            } else if (choice === 'local') {
              data = normalizeProjectUniversalSkillRefs(localData) as Project;
              await recoverFailedProjectSave(id, data, {
                preferQueuedProjectData: true,
                preferQueuedEpisodes: true,
              });
              toast.success("已恢复本地挂起修改并覆盖云端。");
            } else if (choice === 'memory') {
              data = normalizeProjectUniversalSkillRefs(memoryData) as Project;
              localStorage.removeItem(failedSaveKey(id));
              await persistProjectSnapshotNow(id, memoryData, get().activeEpisode ? [get().activeEpisode!] : []);
              toast.success("已保留当前活动内存并同步云端。");
            } else if (choice === 'merge') {
              const recovery = await recoverFailedProjectSave(id, data, {
                currentEpisodes: fullEpisodes,
                preferQueuedProjectData: true,
                preferQueuedEpisodes: true,
              });
              if (recovery.recovered && recovery.projectData) {
                data = normalizeProjectUniversalSkillRefs(recovery.projectData) as Project;
                toast.success("已自动合并本地与云端修改。");
              }
            }
          } else {
            const recovery = await recoverFailedProjectSave(id, data, {
              currentEpisodes: fullEpisodes,
              preferQueuedProjectData: true,
              preferQueuedEpisodes: true,
            });
            if (recovery.recovered && recovery.projectData) {
              data = normalizeProjectUniversalSkillRefs(recovery.projectData) as Project;
              toast.success("已恢复该项目上次失败的本地保存。");
            } else if (recovery.error) {
              toast.error("检测到失败保存队列，但自动恢复失败，已保留队列等待下次重试。");
            }
          }
        } else {
          // If no failure queue payload exists, use loaded data directly
          set({ currentProject: data });
        }
        
        data = ensureProductionMetadata(data);
        set({ currentProject: data, isLoading: false });
        writeActiveProjectId(data.id);
        if (data.episodes && data.episodes.length > 0) {
          const storedEpisodeId = readActiveEpisodeId(data.id);
          const episodeToRestore = data.episodes.find((episode) => episode.id === storedEpisodeId)
            || data.episodes[0];
          await get().setActiveEpisodeId(episodeToRestore.id, {
            view: options?.episodeView,
            sceneId: options?.sceneId,
            shotId: options?.shotId,
          });
        } else {
          set({ activeEpisodeId: null, activeEpisode: null });
        }
      } else {
        clearActiveProjectId();
        set({ isLoading: false });
      }
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
    }
  },

  updateProject: async (updates, options) => {
    const expectedProjectId = options?.expectedProjectId || get().currentProject?.id;
    if (!expectedProjectId) return;
    if (!get()._updateProjectLock) {
      set({ _updateProjectLock: Promise.resolve() });
    }

    const lock = get()._updateProjectLock;
    const nextLock = lock.then(async () => {
      const { currentProject } = get();
      if (!currentProject || currentProject.id !== expectedProjectId) return;
      const isExpectedProjectCurrent = () => get().currentProject?.id === expectedProjectId;
      const normalizedUpdates = normalizeProjectUniversalSkillRefs(updates) as Partial<Project>;

      const deletedAssets: { id: string; name: string; type: string }[] = [];
      if (updates.characters) {
        const updatedIds = new Set(updates.characters.map((c: any) => c.id));
        currentProject.characters?.forEach((c: any) => {
          if (!updatedIds.has(c.id)) {
            deletedAssets.push({ id: c.id, name: c.name, type: "character" });
          }
        });
      }
      if (updates.assets) {
        const updatedIds = new Set(updates.assets.map((a: any) => a.id));
        currentProject.assets?.forEach((a: any) => {
          if (a.type !== "character" && !updatedIds.has(a.id)) {
            deletedAssets.push({ id: a.id, name: a.name, type: a.type });
          }
        });
      }

      const visualSourceChangedFields = collectVisualStyleSourceChangedFields({
        existing: currentProject,
        updates: normalizedUpdates,
      });
      const visualStyleReviewDetectedAt = Date.now();

      const updatedProject = produce(currentProject as Project, (draft: any) => {

        // Apply shallow updates
        for (const key of Object.keys(normalizedUpdates) as Array<keyof Project>) {
          if (key === 'assets' || key === 'characters' || key === 'episodes' || key === 'globalGenerationParams' || key === 'creativeVision' || key === 'visualStyleLock') {
            continue; // Handle these separately Below
          }
          draft[key] = (normalizedUpdates as any)[key];
        }

        if (normalizedUpdates.globalGenerationParams) {
          draft.globalGenerationParams = {
            ...draft.globalGenerationParams,
            ...normalizedUpdates.globalGenerationParams
          };
        }

        if (normalizedUpdates.creativeVision) {
          draft.creativeVision = {
            ...draft.creativeVision,
            ...normalizedUpdates.creativeVision
          };
        }

        if (normalizedUpdates.visualStyleLock) {
          const sourceReview = resolveVisualStyleSourceReviewForUpdate({
            existing: draft.visualStyleLock,
            incoming: normalizedUpdates.visualStyleLock,
            upstreamChangedFields: visualSourceChangedFields,
            detectedAt: visualStyleReviewDetectedAt,
          });
          draft.visualStyleLock = {
            ...draft.visualStyleLock,
            ...normalizedUpdates.visualStyleLock,
            lockedAt: normalizedUpdates.visualStyleLock.lockedAt || Date.now(),
            sourceReview,
          };
        } else if (draft.visualStyleLock && visualSourceChangedFields.length) {
          draft.visualStyleLock.sourceReview = resolveVisualStyleSourceReviewForUpdate({
            existing: draft.visualStyleLock,
            upstreamChangedFields: visualSourceChangedFields,
            detectedAt: visualStyleReviewDetectedAt,
          });
        }

        let newAssets = normalizedUpdates.assets || draft.assets || [];
        let newCharacters = normalizedUpdates.characters || draft.characters || [];

        if (normalizedUpdates.characters) {
          const updatedCharIds = new Set(normalizedUpdates.characters.map(c => `char-${c.id}`));
          
          const retainedAssets = newAssets.filter((a: any) => 
            a.type !== "character" || !updatedCharIds.has(a.id)
          );

          const charAssets = normalizedUpdates.characters.map(c => {
            const existingAsset = draft.assets?.find((a: any) => a.id === `char-${c.id}`);
            return {
              ...existingAsset,
              id: `char-${c.id}`,
              type: "character" as const,
              name: c.name,
              description: c.visualIdentity || '',
              prompt: characterVisualPrompt(c, existingAsset?.prompt),
              imageUrl: c.referenceImageUrl,
              tags: c.externalGoal ? c.externalGoal.split(', ') : (existingAsset?.tags || []),
              defaultReferenceUrl: c.defaultReferenceUrl,
              defaultVariantId: c.defaultVariantId,
              variants: c.variants || [],
            };
          });
          
          newAssets = [...retainedAssets, ...charAssets];
          draft.assets = newAssets;
        } else if (normalizedUpdates.assets) {
          const existingAssetMap = new Map((draft.assets || []).map((a: any) => [a.id, a]));
          normalizedUpdates.assets.forEach((a: any) => {
            existingAssetMap.set(a.id, { ...((existingAssetMap.get(a.id) || {}) as any), ...a });
          });
          draft.assets = Array.from(existingAssetMap.values());
        }

        if (normalizedUpdates.assets) {
          newCharacters = syncCharactersFromCharacterAssets(newCharacters, draft.assets || []);
          const existingCharMap = new Map((draft.characters || []).map((c: any) => [c.id, c]));
          newCharacters.forEach((c: any) => {
            existingCharMap.set(c.id, { ...((existingCharMap.get(c.id) || {}) as any), ...c });
          });
          draft.characters = Array.from(existingCharMap.values());
        } else if (normalizedUpdates.characters) {
          const existingCharMap = new Map((draft.characters || []).map((c: any) => [c.id, c]));
          normalizedUpdates.characters.forEach((c: any) => {
            existingCharMap.set(c.id, { ...((existingCharMap.get(c.id) || {}) as any), ...c });
          });
          draft.characters = Array.from(existingCharMap.values());
        }

        if (normalizedUpdates.episodes) {
          draft.episodes = normalizedUpdates.episodes;
        }

        // Cleanup orphaned relationships
        if (draft.characters && draft.relationships) {
          draft.relationships = draft.relationships.filter((r: any) => 
            draft.characters.some((c: any) => c.id === r.sourceId) && 
            draft.characters.some((c: any) => c.id === r.targetId)
          );
        }
      });

      if (!isExpectedProjectCurrent()) return;
      set({ currentProject: updatedProject });

      // Asset-reference auditing is expensive because it hydrates every
      // episode. A screenplay, scope, comment, or sync update cannot alter the
      // asset registry, so never turn those common saves into an N+1 full
      // episode read across a long project.
      if (normalizedUpdates.assets || normalizedUpdates.characters) {
        try {
          const { auditAssetLifecycleImpact } = await import("../../utils/assetRefs");
          const episodes = await Promise.all((updatedProject.episodes || []).map(async (episodeMeta: Episode) => {
            if ((episodeMeta as Episode).scenes?.length || (episodeMeta as Episode).gameData) {
              return episodeMeta as Episode;
            }
            try {
              const fullEpisode = await legacyProjectClient.getEpisode(updatedProject.id, episodeMeta.id);
              if (fullEpisode) return { ...fullEpisode, scenes: fullEpisode.scenes || [] } as Episode;
            } catch (err) {
              console.warn(`Failed to load full episode ${episodeMeta.id} for asset lifecycle audit:`, err);
            }
            return { ...(episodeMeta as Episode), scenes: [] } as Episode;
          }));
          const reports = auditAssetLifecycleImpact(currentProject, updatedProject, episodes as Episode[]);
          if (reports.length > 0 && isExpectedProjectCurrent()) {
            set({ lastAssetLifecycleImpactReports: reports });
            try {
              const { markPersistedLegacyProductionRunsStale } = await import(
                "../../utils/legacyProductionRunInvalidation"
              );
              for (const report of reports as any[]) {
                await markPersistedLegacyProductionRunsStale(updatedProject.id, {
                  changeType: report.eventType === "renamed"
                    ? "asset_renamed"
                    : report.eventType === "reference_changed"
                      ? "asset_reference_changed"
                      : "asset_deleted",
                  entityId: report.assetId,
                  entityName: report.newName || report.oldName,
                  assetType: report.assetType,
                  reason: `资产生命周期变更：${report.assetType || "asset"} ${report.newName || report.oldName || report.assetId} ${report.eventType}，相关自动制片产物需要复核。`,
                });
              }
            } catch (err) {
              console.error("Failed to mark production runs stale after asset lifecycle audit:", err);
            }
            const totalAlerts = reports.reduce((sum, r) => sum + r.structuredRefs.length + r.freeTextRefs.length, 0);
            if (totalAlerts > 0 && isExpectedProjectCurrent()) {
              toast.error(`资产变更警告：发现 ${totalAlerts} 处残留引用或受影响镜头！已生成审计与修复面板。`, { duration: 5000 });
            }
          }
        } catch (err) {
          console.error("Failed to run asset lifecycle impact audit:", err);
        }
      }

      try {
        // Formal screenplay revisions are committed through the dedicated
        // revision-checked endpoint. Do not let this general debounced full
        // project save race it and overwrite a newer screenplay from another
        // editor tab.
        const projectForGeneralPersistence = normalizedUpdates.productionScriptWorkspace
          ? (() => {
              const { productionScriptWorkspace: _workspace, ...withoutScriptWorkspace } = updatedProject;
              return withoutScriptWorkspace;
            })()
          : updatedProject;
        debouncedSaveProjectState(updatedProject.id, projectForGeneralPersistence, []);
        
        set((state: any) => ({
          projects: state.projects.map((p: any) => p.id === updatedProject.id ? updatedProject : p)
        }));
      } catch (e) {
        console.error(e);
      }
    });

    set({ _updateProjectLock: nextLock });
    await nextLock;
  },

  setProjectTrashState: async (id, trashedAt) => {
    const project = get().projects.find((item) => item.id === id);
    if (!project) throw new Error("项目不存在或已被移除");

    await flushDebouncedProjectSave(id);
    await legacyProjectClient.patchProject(id, { productionTrashedAt: trashedAt });

    const isTrashed = Boolean(trashedAt);
    if (isTrashed) {
      clearActiveProjectId(id);
      clearActiveEpisodeId(id);
    }

    set((state) => ({
      projects: state.projects.map((item) =>
        item.id === id ? { ...item, productionTrashedAt: trashedAt } : item,
      ),
      currentProject: isTrashed && state.currentProject?.id === id ? null : state.currentProject,
      activeEpisodeId: isTrashed && state.currentProject?.id === id ? null : state.activeEpisodeId,
      activeEpisode: isTrashed && state.currentProject?.id === id ? null : state.activeEpisode,
    }));
  },

  deleteProject: async (id) => {
    try {
      // Delete from backend DB SQLite
      try {
        await legacyProjectClient.deleteProject(id);
      } catch (err) {
        console.error("Failed to delete project from DB:", err);
      }
      clearActiveProjectId(id);
      clearActiveEpisodeId(id);

      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
        activeEpisodeId: state.currentProject?.id === id ? null : state.activeEpisodeId,
        activeEpisode: state.currentProject?.id === id ? null : state.activeEpisode,
      }));
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  },

  applyAssetLifecycleRepairs: async (repairPlans, freeTextReplacements) => {
    const { currentProject } = get();
    if (!currentProject) return;

    const { replaceFreeTextName } = await import("../../utils/assetRefs");

    const getPathValue = (obj: any, path: string): any => {
      const parts = path.replace(/^project\./, "").split(/[\.\[\]]+/);
      let current = obj;
      for (const part of parts) {
        if (!part) continue;
        if (current && typeof current === "object" && part in current) {
          current = current[part];
        } else {
          return undefined;
        }
      }
      return current;
    };

    const setPathValue = (obj: any, path: string, action: string, value: any) => {
      const parts = path.replace(/^project\./, "").split(/[\.\[\]]+/);
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!part) continue;
        if (current && typeof current === "object") {
          const nextPart = parts[i + 1];
          if (nextPart === "") continue;
          if (!current[part]) {
            current[part] = /^\d+$/.test(nextPart) ? [] : {};
          }
          current = current[part];
        }
      }
      const lastPart = parts[parts.length - 1] || parts[parts.length - 2];
      if (current && typeof current === "object" && lastPart !== undefined) {
        if (action === "delete_reference" || action === "needs_author_decision") {
          if (Array.isArray(current)) {
            const lastPartIsIndex = /^\d+$/.test(lastPart);
            if (lastPartIsIndex) {
              current.splice(Number(lastPart), 1);
            } else {
              delete current[lastPart];
            }
          } else {
            if (typeof current[lastPart] === "string") {
              current[lastPart] = "";
            } else if (Array.isArray(current[lastPart])) {
              current[lastPart] = [];
            } else {
              delete current[lastPart];
            }
          }
        } else {
          current[lastPart] = value;
        }
      }
    };

    const updatedProject = produce(currentProject as Project, (draft: any) => {
      repairPlans.forEach((plan) => {
        setPathValue(draft, plan.path, plan.action, plan.replacementValue);
      });

      freeTextReplacements.forEach((rep) => {
        const currentText = getPathValue(draft, rep.path);
        if (typeof currentText === "string") {
          const updatedText = replaceFreeTextName(currentText, rep.oldName, rep.newName);
          setPathValue(draft, rep.path, "set_value", updatedText);
        }
      });
    });

    await get().updateProject(updatedProject);
    set({ lastAssetLifecycleImpactReports: null });
  },
};
};
