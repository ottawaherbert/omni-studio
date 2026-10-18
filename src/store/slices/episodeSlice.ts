import { StateCreator } from "zustand";
import { produce } from "immer";
import { Episode, EpisodeMeta, Scene, Project } from "../../types/project";
import { debouncedSaveProjectState, type ProjectWriteGuard } from "./projectSlice";
import { applyInteractiveProjectionSync } from "../../utils/interactiveNodeSceneMapper";
import { clearActiveEpisodeId, writeActiveEpisodeId } from "../../utils/activeProjectStorage";
import { legacyProjectClient, type LegacyEpisodeView } from "../../clients/legacyProjectClient";

export interface EpisodeSlice {
  activeEpisodeId: string | null;
  activeEpisode: Episode | null;
  _updateSceneLock?: Promise<void>;
  setActiveEpisodeId: (
    id: string | null,
    options?: { view?: LegacyEpisodeView; sceneId?: string; shotId?: string; scope?: "episode" },
  ) => Promise<void>;
  addEpisode: (episode: Episode) => Promise<void>;
  updateEpisode: (
    episodeId: string,
    updates: Partial<Episode>,
    options?: EpisodeWriteGuard,
  ) => Promise<void>;
  deleteEpisode: (episodeId: string) => Promise<void>;
  reorderEpisodes: (startIndex: number, endIndex: number) => Promise<void>;
  reorderScenes: (
    episodeId: string,
    startIndex: number,
    endIndex: number,
  ) => Promise<void>;
  updateScene: (
    sceneId: string,
    updates: Partial<Scene>,
    episodeId?: string,
    options?: EpisodeWriteGuard,
  ) => Promise<void>;
  removeVariantReferences: (
    variantId: string,
    variantImageUrl?: string,
  ) => Promise<void>;
  removeAssetReferences: (assetId: string, assetType: string) => Promise<void>;
}

export interface EpisodeWriteGuard extends ProjectWriteGuard {
  expectedEpisodeId?: string;
  appearanceAssets?: Pick<Project, "characters" | "assets">;
  archiveReplacedShots?: boolean;
}

type WorkspaceEpisode = Episode & {
  __workspaceView?: string;
  __workspaceSceneScope?: string;
  __workspaceShotSummaryOnly?: boolean;
  __workspaceShotScope?: string;
};

export const projectUpdatedSceneIntoActiveWorkspace = (
  activeEpisode: Episode,
  updatedEpisode: Episode,
  sceneId: string,
): Episode => {
  const workspaceEpisode = activeEpisode as WorkspaceEpisode;
  if (!workspaceEpisode.__workspaceView && !workspaceEpisode.__workspaceSceneScope) {
    return updatedEpisode;
  }

  const updatedScene = updatedEpisode.scenes?.find((scene) => scene.id === sceneId);
  if (!updatedScene) return activeEpisode;

  return produce(workspaceEpisode, (draft) => {
    const sceneIndex = draft.scenes?.findIndex((scene) => scene.id === sceneId) ?? -1;
    if (sceneIndex < 0) return;
    const currentScene = draft.scenes[sceneIndex] as Scene & {
      __workspaceSceneSummary?: boolean;
      shotCount?: number;
    };
    if (currentScene.__workspaceSceneSummary) {
      currentScene.shotCount = updatedScene.shots?.length || 0;
      return;
    }

    draft.scenes[sceneIndex] = updatedScene;
    if (workspaceEpisode.__workspaceSceneScope === sceneId) {
      delete (draft as WorkspaceEpisode).__workspaceShotSummaryOnly;
      delete (draft as WorkspaceEpisode).__workspaceShotScope;
    }
  }) as Episode;
};

export const createEpisodeSlice: StateCreator<
  EpisodeSlice & any,
  [],
  [],
  EpisodeSlice
> = (set, get) => {
  let loadSequence = 0;
  return ({
  activeEpisodeId: null,
  activeEpisode: null,

  setActiveEpisodeId: async (id, options) => {
    const request = ++loadSequence;
    const { currentProject } = get();
    if (!currentProject || !id) {
      if (currentProject?.id) clearActiveEpisodeId(currentProject.id);
      set({ activeEpisodeId: id, activeEpisode: null });
      return;
    }

    try {
      const episode = await legacyProjectClient.getEpisode(
        currentProject.id,
        id,
        options?.view,
        { sceneId: options?.sceneId, shotId: options?.shotId, scope: options?.scope },
      );
      if (request !== loadSequence || get().currentProject?.id !== currentProject.id) return;
      if (episode) {
        if (episode && !episode.scenes) {
          episode.scenes = [];
        }
        writeActiveEpisodeId(currentProject.id, id);
        set({ activeEpisodeId: id, activeEpisode: episode as Episode });
      } else {
        console.error("Failed to fetch episode", id);
      }
    } catch (e) {
      console.error("Failed to load episode:", e);
    }
  },

  updateScene: async (sceneId, updates, episodeId?: string, options?: EpisodeWriteGuard) => {
    const expectedProjectId = options?.expectedProjectId || get().currentProject?.id;
    const targetEpisodeId = episodeId || get().activeEpisode?.id;
    const expectedEpisodeId = options?.expectedEpisodeId;
    if (
      !expectedProjectId
      || !targetEpisodeId
      || (expectedEpisodeId && targetEpisodeId !== expectedEpisodeId)
    ) return;
    const isExpectedWriteContextCurrent = () => {
      const state = get();
      return state.currentProject?.id === expectedProjectId
        && (!expectedEpisodeId || state.activeEpisode?.id === expectedEpisodeId);
    };
    if (!get()._updateSceneLock) {
      set({ _updateSceneLock: Promise.resolve() });
    }

    const lock = get()._updateSceneLock;
    const nextLock = lock.then(async () => {
      const { activeEpisode, updateEpisode, currentProject } = get();
      if (!currentProject || !isExpectedWriteContextCurrent()) return;

      try {
        let finalScenes = [];

        // --- Intercept for Interactive Mode (Dual Truth Fix) ---
        if (currentProject.projectModel === "interactive") {
          const { useGameStore } = await import("../useGameStore");
          if (!isExpectedWriteContextCurrent()) return;
          const gameStoreState = useGameStore.getState();
          // In interactive mode, sceneId usually matches nodeId directly
          const targetNodeId = sceneId;

          if (gameStoreState && targetNodeId) {
            const updatesForNode: any = {};

            if (updates.script !== undefined) {
              updatesForNode.detailedScript = updates.script;
            }
            if (updates.title !== undefined) {
              updatesForNode.title = updates.title;
            }
            if (updates.description !== undefined) {
              updatesForNode.scriptContent = updates.description;
            }
            if (updates.scriptBlocks !== undefined) {
              updatesForNode.scriptBlocks = updates.scriptBlocks;
            }
            if (updates.breakdown !== undefined) {
              updatesForNode.breakdown = updates.breakdown;
            }
            if (updates.valueCharge !== undefined) {
              updatesForNode.valueCharge = updates.valueCharge;
            }
            if (updates.valueShift !== undefined) {
              updatesForNode.valueShift = updates.valueShift;
            }
            if (updates.hook !== undefined) {
              updatesForNode.hook = updates.hook;
            }
            if (updates.cliffhanger !== undefined) {
              updatesForNode.cliffhanger = updates.cliffhanger;
            }
            if (updates.targetDuration !== undefined) {
              updatesForNode.targetDuration = updates.targetDuration;
            }
            if (updates.sceneGoal !== undefined) {
              updatesForNode.sceneGoal = updates.sceneGoal;
            }
            if (updates.sceneAssets !== undefined) {
              updatesForNode.sceneAssets = updates.sceneAssets;
            }
            if (updates.environment !== undefined) {
              updatesForNode.environment = updates.environment;
            }
            if (updates.timeOfDay !== undefined) {
              updatesForNode.timeOfDay = updates.timeOfDay;
            }

            if (updates.shots !== undefined) {
              updatesForNode.shots = updates.shots;
              // Legacy support
              if (updates.shots.length > 0) {
                const shot = updates.shots[0];
                if (shot.imageUrl !== undefined)
                  updatesForNode.imageAssetUrl = shot.imageUrl;
                if (shot.videoUrl !== undefined)
                  updatesForNode.videoAssetUrl = shot.videoUrl;
                if (shot.imageMedia !== undefined)
                  updatesForNode.imageAssetMedia = shot.imageMedia;
                if (shot.videoMedia !== undefined)
                  updatesForNode.videoAssetMedia = shot.videoMedia;
              }
            }

            if (updates.multiGrid !== undefined) {
              updatesForNode.multiGrid = updates.multiGrid;
            }
            if (updates.overrideSkills !== undefined) {
              updatesForNode.overrideSkills = updates.overrideSkills;
            }
            if (updates.generationMetadata !== undefined) {
              updatesForNode.generationMetadata = updates.generationMetadata;
            }

            if (updates.audioTracks !== undefined) {
              updatesForNode.audioTracks = updates.audioTracks;
              // Legacy support
              if (updates.audioTracks.length > 0) {
                const audioUrl =
                  updates.audioTracks.find((t: any) => t.type === "dialogue")
                    ?.url || updates.audioTracks[0].url;
                if (audioUrl !== undefined)
                  updatesForNode.audioAssetUrl = audioUrl;
              }
            }

            if (Object.keys(updatesForNode).length > 0) {
              gameStoreState.updateNode(targetNodeId, updatesForNode);

              const updatedGameData = useGameStore.getState().data;
              const existingScenes =
                activeEpisode?.id === targetEpisodeId
                  ? activeEpisode.scenes || []
                  : [];
              const projection = applyInteractiveProjectionSync(updatedGameData, existingScenes);
              await updateEpisode(targetEpisodeId, {
                gameData: projection.gameData,
                scenes: projection.scenes,
              }, { ...options, expectedProjectId, expectedEpisodeId });
            }
          }
          return; // Short-circuit, do not touch episode.scenes
        }

        if (activeEpisode && activeEpisode.id === targetEpisodeId) {
          const localScene = activeEpisode.scenes?.find((scene) => scene.id === sceneId) as
            | (Scene & { __workspaceSceneSummary?: boolean })
            | undefined;
          const shotSummaryOnly = Boolean(
            (activeEpisode as Episode & { __workspaceShotSummaryOnly?: boolean })
              .__workspaceShotSummaryOnly,
          );
          const sceneScopedWorkspace = Boolean(
            (activeEpisode as Episode & { __workspaceSceneScope?: string })
              .__workspaceSceneScope,
          );
          const writableEpisode = localScene?.__workspaceSceneSummary || shotSummaryOnly || sceneScopedWorkspace
            ? await legacyProjectClient.getEpisode(currentProject.id, targetEpisodeId)
            : activeEpisode;
          if (!writableEpisode || !isExpectedWriteContextCurrent()) return;
          const updatedEp = produce(writableEpisode as Episode, (draft) => {
            const scene = draft.scenes?.find((s) => s.id === sceneId);
            if (scene) {
              if (options?.archiveReplacedShots && scene.shots?.length) scene.shotHistory = [...(scene.shotHistory || []), { at: Date.now(), shots: scene.shots, audioTracks: scene.audioTracks, manualStoryboard: scene.manualStoryboard }];
              const incomingShots = updates.shots;
              const existingShots = new Map((scene.shots || []).map((shot) => [shot.id, shot]));
              const incomingManualStoryboard = updates.manualStoryboard as
                | (NonNullable<Scene["manualStoryboard"]> & {
                    boards?: Array<{ id?: string; boardId?: string; __workspaceStoryboardSummary?: boolean }>;
                  })
                | undefined;
              const mergedManualStoryboard = incomingManualStoryboard
                ? {
                    ...(scene.manualStoryboard || {}),
                    ...incomingManualStoryboard,
                    boards: incomingManualStoryboard.boards?.map((workflow) => {
                      const workspaceWorkflow = workflow as typeof workflow & {
                        __workspaceStoryboardSummary?: boolean;
                      };
                      if (!workspaceWorkflow.__workspaceStoryboardSummary) return workflow;
                      return scene.manualStoryboard?.boards?.find((existingWorkflow) =>
                        existingWorkflow.id === workflow.id
                        || existingWorkflow.boardId === workflow.boardId)
                        || workflow;
                    }) || scene.manualStoryboard?.boards,
                  }
                : undefined;
              Object.assign(scene, {
                ...updates,
                shots: undefined,
                ...(mergedManualStoryboard ? { manualStoryboard: mergedManualStoryboard } : {}),
              });
              if (incomingShots) {
                scene.shots = incomingShots.map((shot) => {
                  const {
                    __workspaceShotSummary: _workspaceShotSummary,
                    ...incoming
                  } = shot as typeof shot & { __workspaceShotSummary?: boolean };
                  return {
                    ...(existingShots.get(shot.id) || {}),
                    ...incoming,
                  };
                });
              } else {
                scene.shots = Array.from(existingShots.values());
              }
            }
          });
          finalScenes = updatedEp.scenes || [];
          if (!isExpectedWriteContextCurrent()) return;
          const visibleEpisode = get().activeEpisode as Episode | null;
          if (visibleEpisode?.id === targetEpisodeId) {
            set({
              activeEpisode: projectUpdatedSceneIntoActiveWorkspace(visibleEpisode, updatedEp, sceneId),
            });
          }

          try {
            if (options?.appearanceAssets) set({ currentProject: { ...get().currentProject, ...options.appearanceAssets } });
            debouncedSaveProjectState(currentProject.id, get().currentProject, [
              updatedEp,
            ]);
          } catch (e) {
            console.error("Failed to persist scene update:", e);
          }
        } else {
          const ep = await legacyProjectClient.getEpisode(currentProject.id, targetEpisodeId);
          if (!ep || !isExpectedWriteContextCurrent()) return;

          const updatedEp = produce(ep as Episode, (draft: any) => {
            const scene = draft.scenes?.find((s: any) => s.id === sceneId);
            if (scene) {
              if (options?.archiveReplacedShots && scene.shots?.length) scene.shotHistory = [...(scene.shotHistory || []), { at: Date.now(), shots: scene.shots, audioTracks: scene.audioTracks, manualStoryboard: scene.manualStoryboard }];
              Object.assign(scene, updates);
            }
          });
          finalScenes = updatedEp.scenes || [];

          await updateEpisode(targetEpisodeId, { scenes: finalScenes }, {
            ...options,
            expectedProjectId,
            expectedEpisodeId,
          });
        }
      } catch (e) {
        console.error("Failed to update scene:", e);
      }
    });

    set({ _updateSceneLock: nextLock });
    await nextLock;
  },

  addEpisode: async (episode) => {
    const { currentProject, updateProject } = get();
    if (!currentProject) return;

    const episodeMeta: EpisodeMeta = {
      id: episode.id,
      title: episode.title,
      inspiration: episode.inspiration,
      arcId: episode.arcId,
      targetDuration: episode.targetDuration,
      sceneCount: episode.scenes?.length || 0,
    };

    const newEpisodes = [...currentProject.episodes, episodeMeta];

    // Save to backend immediately
    await legacyProjectClient.saveEpisode(currentProject.id, episode);

    await updateProject({ episodes: newEpisodes });
    await get().setActiveEpisodeId(episode.id);
  },

  updateEpisode: async (episodeId, updates, options) => {
    const expectedProjectId = options?.expectedProjectId || get().currentProject?.id;
    if (
      !expectedProjectId
      || (options?.expectedEpisodeId && options.expectedEpisodeId !== episodeId)
    ) return;
    const isExpectedWriteContextCurrent = () => {
      const state = get();
      return state.currentProject?.id === expectedProjectId
        && (!options?.expectedEpisodeId || state.activeEpisode?.id === options.expectedEpisodeId);
    };
    const { currentProject, activeEpisode, updateProject } = get();
    if (!currentProject || !isExpectedWriteContextCurrent()) return;

    let updatedEp: Episode | null = null;
    if (activeEpisode?.id === episodeId) {
      updatedEp = { ...activeEpisode, ...updates };
      set({ activeEpisode: updatedEp });
    }

    try {
      let existingEp: Episode | null = activeEpisode?.id === episodeId
        ? activeEpisode
        : await legacyProjectClient.getEpisode(currentProject.id, episodeId);
      if (!isExpectedWriteContextCurrent()) return;

      if (!existingEp && updatedEp) {
        existingEp = updatedEp;
      }

      if (existingEp) {
        if (!updatedEp) {
          updatedEp = { ...existingEp, ...updates };
        } else {
          updatedEp = { ...existingEp, ...updatedEp };
        }

        if (options?.appearanceAssets) set({ currentProject: { ...get().currentProject, ...options.appearanceAssets } });
        debouncedSaveProjectState(currentProject.id, get().currentProject, [
          updatedEp,
        ]);

        const metaChanged = [
          "title",
          "inspiration",
          "arcId",
          "targetDuration",
          "creativeDirection",
          "scenes",
        ].some((k) => k in updates);
        if (metaChanged) {
          const newEpisodes = currentProject.episodes.map((ep) => {
            if (ep.id === episodeId) {
              const metaUpdates: Partial<EpisodeMeta> = {};
              if ("creativeDirection" in updates) metaUpdates.creativeDirection = updates.creativeDirection;
              if ("title" in updates) metaUpdates.title = updates.title;
              if ("inspiration" in updates)
                metaUpdates.inspiration = updates.inspiration;
              if ("arcId" in updates) metaUpdates.arcId = updates.arcId;
              if ("targetDuration" in updates)
                metaUpdates.targetDuration = updates.targetDuration;
              if ("scenes" in updates)
                metaUpdates.sceneCount = updates.scenes?.length || 0;
              return { ...ep, ...metaUpdates };
            }
            return ep;
          });
          await updateProject({ episodes: newEpisodes }, { expectedProjectId });
        }
      }
    } catch (e) {
      console.error("Failed to update episode:", e);
    }
  },

  deleteEpisode: async (episodeId) => {
    const { currentProject, activeEpisodeId, updateProject } = get();
    if (!currentProject) return;

    // Actually delete it from the backend Database
    try {
      await legacyProjectClient.deleteEpisode(currentProject.id, episodeId);
    } catch (e) {
      console.error("Failed to delete episode from DB", e);
    }

    const newEpisodes = currentProject.episodes.filter(
      (ep) => ep.id !== episodeId,
    );
    await updateProject({ episodes: newEpisodes });

    if (activeEpisodeId === episodeId) {
      if (newEpisodes.length > 0) {
        await get().setActiveEpisodeId(newEpisodes[0].id);
      } else {
        set({ activeEpisodeId: null, activeEpisode: null });
      }
    }
  },

  reorderEpisodes: async (startIndex, endIndex) => {
    const { currentProject, updateProject } = get();
    if (!currentProject) return;

    const newEpisodes = Array.from(currentProject.episodes);
    const [removed] = newEpisodes.splice(startIndex, 1);
    newEpisodes.splice(endIndex, 0, removed);

    await updateProject({ episodes: newEpisodes });
  },

  reorderScenes: async (episodeId, startIndex, endIndex) => {
    const { currentProject, activeEpisode, updateEpisode } = get();
    if (!currentProject) return;

    let targetEpisode = activeEpisode?.id === episodeId ? activeEpisode : null;

    if (!targetEpisode) {
      try {
        targetEpisode = await legacyProjectClient.getEpisode(currentProject.id, episodeId);
      } catch (e) {
        console.error("Failed to load episode for reordering scenes:", e);
      }
    }

    if (!targetEpisode) return;

    const scenes = targetEpisode.scenes || [];
    const newScenes = Array.from(scenes);
    const [removed] = newScenes.splice(startIndex, 1);
    newScenes.splice(endIndex, 0, removed);

    await updateEpisode(episodeId, { scenes: newScenes });
  },

  removeVariantReferences: async (
    variantId: string,
    variantImageUrl?: string,
  ) => {
    const { currentProject, activeEpisodeId, activeEpisode } = get();
    if (!currentProject) return;

    for (const epMeta of currentProject.episodes) {
      try {
        const episode = await legacyProjectClient.getEpisode(currentProject.id, epMeta.id);
        if (!episode) continue;

        if (episode && episode.scenes) {
          let episodeChanged = false;
          const newScenes = episode.scenes.map((scene: any) => {
            let updatedScene = { ...scene };
            let sceneChanged = false;

            if (updatedScene.breakdown?.assetVariantMap) {
              const newMap = { ...updatedScene.breakdown.assetVariantMap };
              let mapChanged = false;
              for (const [assetId, vId] of Object.entries(newMap)) {
                if (vId === variantId) {
                  delete newMap[assetId];
                  mapChanged = true;
                  episodeChanged = true;
                  sceneChanged = true;
                }
              }
              if (mapChanged) {
                updatedScene.breakdown = {
                  ...updatedScene.breakdown,
                  assetVariantMap: newMap,
                };
              }
            }

            if (variantImageUrl && updatedScene.shots) {
              const newShots = updatedScene.shots.map((shot: any) => {
                if (shot.assetOverrides) {
                  const newOverrides = { ...shot.assetOverrides };
                  let overridesChanged = false;
                  for (const [assetId, url] of Object.entries(newOverrides)) {
                    if (url === variantImageUrl) {
                      delete newOverrides[assetId];
                      overridesChanged = true;
                      episodeChanged = true;
                      sceneChanged = true;
                    }
                  }
                  if (overridesChanged)
                    return { ...shot, assetOverrides: newOverrides };
                }
                return shot;
              });
              if (sceneChanged) updatedScene.shots = newShots;
            }

            return sceneChanged ? updatedScene : scene;
          });

          if (episodeChanged) {
            const newEpisode = { ...episode, scenes: newScenes };
            const savedEpisode = await legacyProjectClient.saveEpisode(currentProject.id, newEpisode);

            if (activeEpisodeId === epMeta.id) {
              set({ activeEpisode: { ...newEpisode, productionRevision: savedEpisode.productionRevision } });
            }
          }
        }
      } catch (e) {
        console.error(
          `Failed to clean up variant references in episode ${epMeta.id}:`,
          e,
        );
      }
    }
  },

  removeAssetReferences: async (assetId: string, assetType: string) => {
    const { currentProject, activeEpisodeId } = get();
    if (!currentProject) return;

    let assetName = "";
    if (assetType === "character") {
      const char = (currentProject.characters || []).find((c: any) => c.id === assetId);
      if (char) assetName = char.name;
    } else {
      const asset = (currentProject.assets || []).find((a: any) => a.id === assetId);
      if (asset) assetName = asset.name;
    }

    if (assetType === "character") {
      set(produce((state: any) => {
        if (state.currentProject) {
          state.currentProject.characters = (state.currentProject.characters || []).filter((c: any) => c.id !== assetId);
          state.currentProject.assets = (state.currentProject.assets || []).filter((a: any) => a.id !== `char-${assetId}`);
        }
      }));
    } else {
      set(produce((state: any) => {
        if (state.currentProject) {
          state.currentProject.assets = (state.currentProject.assets || []).filter((a: any) => a.id !== assetId);
        }
      }));
    }

    const updatedProject = get().currentProject;
    if (!updatedProject) return;

    for (const epMeta of updatedProject.episodes) {
      try {
        const episode = await legacyProjectClient.getEpisode(updatedProject.id, epMeta.id);
        if (!episode) continue;

        if (episode && episode.scenes) {
          let episodeChanged = false;
          let currentEpisode = { ...episode };

          if (assetType === "character" && currentEpisode.characterIds) {
            currentEpisode.characterIds = currentEpisode.characterIds.filter(
              (id: string) => id !== assetId,
            );
            episodeChanged = true;
          }

          const newScenes = currentEpisode.scenes.map((scene: Scene) => {
            let newScene = { ...scene };
            let sceneChanged = false;

            if (newScene.breakdown) {
              const newBreakdown = { ...newScene.breakdown };
              if (assetType === "character" && newBreakdown.characterIds) {
                newBreakdown.characterIds = newBreakdown.characterIds.filter(
                  (id: string) => id !== assetId,
                );
                sceneChanged = true;
              }
              if (
                assetType === "location" &&
                newBreakdown.locationId === assetId
              ) {
                newBreakdown.locationId = undefined;
                sceneChanged = true;
              }
              if (assetType === "prop" && newBreakdown.propIds) {
                newBreakdown.propIds = newBreakdown.propIds.filter(
                  (id: string) => id !== assetId,
                );
                sceneChanged = true;
              }
              if (assetType === "bgm" && newBreakdown.bgm) {
                const oldLen = newBreakdown.bgm.length;
                newBreakdown.bgm = newBreakdown.bgm.filter(
                  (item: any) => item.linkedAssetId !== assetId,
                );
                if (newBreakdown.bgm.length !== oldLen) {
                  sceneChanged = true;
                }
              }

              // Textual cleanups (AUDIT-0007)
              if (assetName) {
                if (assetType === "character" && Array.isArray(newBreakdown.characters)) {
                  const oldLen = newBreakdown.characters.length;
                  newBreakdown.characters = newBreakdown.characters.filter((item: any) => {
                    if (typeof item === 'string') {
                      return item !== assetName;
                    } else if (item && typeof item === 'object') {
                      return item.name !== assetName;
                    }
                    return true;
                  });
                  if (newBreakdown.characters.length !== oldLen) {
                    sceneChanged = true;
                  }
                }
                if (assetType === "location" && newBreakdown.location === assetName) {
                  newBreakdown.location = "";
                  sceneChanged = true;
                }
                if (assetType === "prop" && Array.isArray(newBreakdown.props)) {
                  const oldLen = newBreakdown.props.length;
                  newBreakdown.props = newBreakdown.props.filter((item: any) => {
                    if (typeof item === 'string') {
                      return item !== assetName;
                    } else if (item && typeof item === 'object') {
                      return item.name !== assetName;
                    }
                    return true;
                  });
                  if (newBreakdown.props.length !== oldLen) {
                    sceneChanged = true;
                  }
                }
              }
              
              if (newBreakdown.assetVariantMap && newBreakdown.assetVariantMap[assetId]) {
                const newMap = { ...newBreakdown.assetVariantMap };
                delete newMap[assetId];
                newBreakdown.assetVariantMap = newMap;
                sceneChanged = true;
              }
              // Also clean up any legacy keys
              if (newBreakdown.assetVariantMap && newBreakdown.assetVariantMap[`${assetType}_${assetId}`]) {
                const newMap = { ...newBreakdown.assetVariantMap };
                delete newMap[`${assetType}_${assetId}`];
                newBreakdown.assetVariantMap = newMap;
                sceneChanged = true;
              }

              if (sceneChanged) newScene.breakdown = newBreakdown;
            }

            if (newScene.audioTracks) {
              const oldLength = newScene.audioTracks.length;
              newScene.audioTracks = newScene.audioTracks.filter(
                (track) =>
                  track.characterId !== assetId &&
                  track.linkedAssetId !== assetId,
              );
              if (newScene.audioTracks.length !== oldLength)
                sceneChanged = true;
            }

            if (newScene.scriptBlocks) {
              newScene.scriptBlocks = newScene.scriptBlocks.map((block) => {
                let newBlock = { ...block };
                let blockChanged = false;
                if (newBlock.linkedAssetId === assetId) {
                  blockChanged = true;
                  newBlock.linkedAssetId = undefined;
                }
                if (assetType === 'location' && newBlock.locationId === assetId) {
                  blockChanged = true;
                  newBlock.locationId = undefined;
                }
                if (assetType === 'prop' && newBlock.propIds?.includes(assetId)) {
                  blockChanged = true;
                  newBlock.propIds = newBlock.propIds.filter(id => id !== assetId);
                }
                if (blockChanged) sceneChanged = true;
                return blockChanged ? newBlock : block;
              });
            }

            if (newScene.shots) {
              newScene.shots = newScene.shots.map((shot) => {
                let newShot = { ...shot };
                let shotChanged = false;
                if (assetType === "character" && newShot.characterIdsInShot?.includes(assetId)) {
                  newShot.characterIdsInShot = newShot.characterIdsInShot.filter(
                    (id: string) => id !== assetId,
                  );
                  shotChanged = true;
                }
                if (assetType === 'location' && newShot.locationId === assetId) {
                  newShot.locationId = undefined;
                  shotChanged = true;
                }
                if (assetType === 'prop' && newShot.propIds?.includes(assetId)) {
                  newShot.propIds = newShot.propIds.filter(id => id !== assetId);
                  shotChanged = true;
                }
                if (newShot.assetOverrides && newShot.assetOverrides[assetId]) {
                  const newOverrides = { ...newShot.assetOverrides };
                  delete newOverrides[assetId];
                  newShot.assetOverrides = newOverrides;
                  shotChanged = true;
                }
                if (shotChanged) sceneChanged = true;
                return shotChanged ? newShot : shot;
              });
            }

            if (sceneChanged) {
              episodeChanged = true;
              return newScene;
            }
            return scene;
          });

          if (episodeChanged) {
            const newEpisode = { ...currentEpisode, scenes: newScenes };
            const savedEpisode = await legacyProjectClient.saveEpisode(currentProject.id, newEpisode);

            if (activeEpisodeId === epMeta.id) {
              set({ activeEpisode: { ...newEpisode, productionRevision: savedEpisode.productionRevision } });
            }
          }
        }
      } catch (e) {
        console.error(
          `Failed to clean up asset references in episode ${epMeta.id}:`,
          e,
        );
      }
    }
    try {
      const { markPersistedLegacyProductionRunsStale } = await import(
        "../../utils/legacyProductionRunInvalidation"
      );
      await markPersistedLegacyProductionRunsStale(updatedProject.id, {
        changeType: "asset_deleted",
        entityId: assetId,
        entityName: assetName,
        assetType,
        reason: `资产「${assetName || assetId}」已删除并清理引用，相关自动制片产物需要复核。`,
      });
    } catch (e) {
      console.error("Failed to mark production runs stale after asset deletion:", e);
    }
  },
  });
};
