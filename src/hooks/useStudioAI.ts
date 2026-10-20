import { renderProductionCreativeContext, directorDialogueIndex } from "../clients/creativeDirectionClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import { appearanceImageIsAfterChange, appearancePrompt, appearanceBoards, requireAppearanceReady, appearanceSourceShots } from "../clients/productionStoryboardWorkflowClient";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { generateAIImage, generateAIVideo, generateAIVoice } from "../clients/aiClient";
import { isQwenCustomVoice, type VoiceSettings } from '../../packages/domain/src/speech';
import { applyStudioVoiceResult, characterSpeechDirection, resolveTrackVoiceDirection, voiceDirectionOverrides } from '../utils/studioVoiceResult';
import { appendShotTakeCandidate } from "../clients/productionMediaReviewClient";
import { buildShotImageVisualRecipeInputEvidence } from "../clients/productionVisualImageClient";
import {
  buildStudioShotImageVisualStyleProjection,
  buildStudioShotVideoVisualStyleProjection,
  type VideoProviderPromptAudit,
} from "../clients/productionVisualStyleClient";
import { useProjectStore } from "../clients/stateClient";
import { useGameStore } from "../clients/stateClient";
import { useAIConfigStore } from "../clients/stateClient";
import { Shot, AudioTrack, Project, Episode, type ManualStudioTakeAudit } from "../clients/domainTypes";
import { compileGameToLinearScenes } from "../utils/gameCompiler";
import { resolveSceneReadModel } from "../utils/sceneReadModel";
import {
  createAIGeneratedMediaReference,
  createLegacyMediaReference,
} from "../utils/mediaProvenance";
import { summarizeUnknownError } from "../utils/logging";
import { manualStoryboardHash } from "../clients/productionStoryboardWorkflowClient";
import {
  buildVideoContinuityContext,
  createImageGenerationReference,
  type CompiledImageGenerationRequest,
  type ImageGenerationReference,
} from "../clients/productionStudioWorkflowClient";

// === Add compression utility ===
const compressImage = (dataUrl: string, MAX_SIZE = 1024): Promise<string> => {
  return new Promise((resolve) => {
    if (!dataUrl.startsWith("data:image")) return resolve(dataUrl);
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.floor(height * (MAX_SIZE / width));
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.floor(width * (MAX_SIZE / height));
          height = MAX_SIZE;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7)); // Compress as high-speed jpeg
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

const snapshotInteractiveNode = (project: Project | null | undefined, nodeId: string, reason: string) => {
  if (project?.projectModel === "interactive") {
    useGameStore.getState().createNodeSnapshot(nodeId, reason);
  }
};

const resolveStudioScene = (
  activeEpisode: Episode,
  activeSceneId: string,
  currentProject?: Project | null,
) => {
  const readModel = resolveSceneReadModel(currentProject, activeEpisode);
  return readModel.scenes.find((scene) => scene.id === activeSceneId);
};

type StudioAIRequestKind = "image" | "video" | "voice";

type StudioAIRequestScope = {
  projectId: string;
  episodeId: string;
  sceneId: string;
  targetKind: "shot" | "audio_track";
  targetId: string;
  contextEpoch: number;
};

type ActiveStudioAIRequest = StudioAIRequestScope & {
  kind: StudioAIRequestKind;
  requestId: number;
};

const studioAIRequestTargetExists = (
  request: StudioAIRequestScope,
  currentProject: Project | null | undefined,
  activeEpisode: Episode | null | undefined,
) => {
  if (currentProject?.id !== request.projectId || activeEpisode?.id !== request.episodeId) return false;
  const scene = resolveStudioScene(activeEpisode, request.sceneId, currentProject);
  if (!scene) return false;
  return request.targetKind === "shot"
    ? Boolean(scene.shots?.some((shot) => shot.id === request.targetId))
    : Boolean(scene.audioTracks?.some((track) => track.id === request.targetId));
};

const studioShotGenerationSourceFingerprint = ({
  project,
  episode,
  sceneId,
  shot,
  action,
}: {
  project: Project;
  episode: Episode;
  sceneId: string;
  shot: Shot;
  action: "image" | "video";
}) => {
  const scene = resolveStudioScene(episode, sceneId, project);
  const variantMap = scene?.breakdown?.assetVariantMap || {};
  const {
    takes: _takes,
    draftPreview: _draftPreview,
    imageMedia: _imageMedia,
    videoMedia: _videoMedia,
    ...shotWithoutTransientMedia
  } = shot;
  const {
    imageUrl: _imageUrl,
    videoUrl: _videoUrl,
    activeTakeId: _activeTakeId,
    ...imageShotSource
  } = shotWithoutTransientMedia;
  const {
    videoUrl: _currentVideoUrl,
    ...videoShotSource
  } = shotWithoutTransientMedia;
  const assetReferences = [
    ...(shot.propIds || []),
    shot.locationId,
  ].filter((id): id is string => Boolean(id)).map((id) => {
    const asset = project.assets.find((item) => item.id === id);
    if (!asset) return { id, missing: true };
    const role = asset.type === "location" ? "location_design" : "prop_design";
    const overrideUrl = shot.assetOverrides?.[id];
    if (overrideUrl) return { id, label: asset.name, role, source: "override", referenceUrl: overrideUrl };
    const variantId = variantMap[asset.id] || variantMap[`${asset.type}_${asset.id}`];
    const variant = variantId && variantId !== "default"
      ? asset.variants?.find((item) => item.id === variantId)
      : undefined;
    if (variant?.imageUrl) return { id, label: asset.name, role, source: "variant", variantId, variantName: variant.name, referenceUrl: variant.imageUrl };
    if (asset.defaultReferenceUrl) return { id, label: asset.name, role, source: "default", referenceUrl: asset.defaultReferenceUrl };
    return { id, label: asset.name, role, source: "fallback", referenceUrl: asset.imageUrl || asset.multiViewUrl || asset.panoramaUrl };
  });
  const characterReferences = (shot.characterIdsInShot || []).map((id) => {
    const character = project.characters.find((item) => item.id === id);
    if (!character) return { id, missing: true };
    const overrideUrl = shot.assetOverrides?.[id];
    if (overrideUrl) return { id, label: character.name, role: "wardrobe_state", source: "override", referenceUrl: overrideUrl };
    const variantId = variantMap[character.id] || variantMap[`character_${character.id}`];
    const variant = variantId && variantId !== "default"
      ? character.variants?.find((item) => item.id === variantId)
      : undefined;
    if (variant?.imageUrl) return { id, label: character.name, role: "wardrobe_state", source: "variant", variantId, variantName: variant.name, referenceUrl: variant.imageUrl };
    if (character.defaultReferenceUrl) return { id, label: character.name, role: "character_identity", source: "default", referenceUrl: character.defaultReferenceUrl };
    return { id, label: character.name, role: "character_identity", source: "fallback", referenceUrl: character.referenceImageUrl || character.multiViewUrl };
  });
  const shotIndex = scene?.shots?.findIndex((item) => item.id === shot.id) ?? -1;
  const firstParentNodeId = project.projectModel === "interactive" && shotIndex === 0
    ? episode.gameData?.edges?.find((edge) => edge.targetNodeId === sceneId)?.sourceNodeId
    : undefined;
  const parentNode = firstParentNodeId
    ? episode.gameData?.nodes?.find((node) => node.id === firstParentNodeId)
    : undefined;
  const incomingParentFrameUrl = parentNode?.shots?.length
    ? parentNode.shots[parentNode.shots.length - 1].imageUrl
    : parentNode?.imageAssetUrl;
  return manualStoryboardHash({
    projectId: project.id,
    episodeId: episode.id,
    sceneId,
    aspectRatio: project.aspectRatio,
    creativeDirection: renderProductionCreativeContext(project, { episode, scene, shot }, action),
    shot: action === "image" ? imageShotSource : videoShotSource,
    interactiveMetadata: scene?.interactiveMetadata,
    references: action === "image"
      ? {
          compositionUrl: shot.compositionData?.imageUrl,
          incomingParentFrameUrl,
          assets: assetReferences,
          characters: characterReferences,
        }
      : {
          startingImageUrl: shot.imageUrl || incomingParentFrameUrl,
        },
  });
};

export function useStudioAI() {
  const renderedProjectId = useProjectStore((state) => state.currentProject?.id || null);
  const renderedEpisodeId = useProjectStore((state) => state.activeEpisode?.id || null);
  const nextRequestIdRef = useRef(0);
  const activeRequestIdsRef = useRef<Partial<Record<StudioAIRequestKind, number>>>({});
  const activeContextRef = useRef({
    projectId: renderedProjectId,
    episodeId: renderedEpisodeId,
    epoch: 0,
  });
  if (
    activeContextRef.current.projectId !== renderedProjectId
    || activeContextRef.current.episodeId !== renderedEpisodeId
  ) {
    activeContextRef.current = {
      projectId: renderedProjectId,
      episodeId: renderedEpisodeId,
      epoch: activeContextRef.current.epoch + 1,
    };
    activeRequestIdsRef.current = {};
  }
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [promptModalState, setPromptModalState] = useState<{
    isOpen: boolean;
    projectId?: string;
    episodeId?: string;
    sceneId?: string;
    templateId: string;
    variables: Record<string, string>;
    onConfirm: (finalPrompt: string) => void;
    contextOptions?: { id: string; label: string; value: string }[];
    defaultSelectedContextIds?: string[];
  }>({
    isOpen: false,
    templateId: '',
    variables: {},
    onConfirm: () => {},
  });

  const [ttsModalState, setTtsModalState] = useState<{
    isOpen: boolean;
    projectId?: string;
    episodeId?: string;
    sceneId?: string;
    initialText: string;
    onConfirm: (text: string, direction?: Partial<VoiceSettings>) => void | Promise<void>;
    modelId?: string;
    voiceName?: string;
    language?: string;
    instructions?: string;
    speed?: number;
    contextSummary?: string;
    readOnly?: boolean;
  }>({
    isOpen: false,
    initialText: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    activeRequestIdsRef.current = {};
    setIsGeneratingImage(false);
    setIsGeneratingVideo(false);
    setIsGeneratingVoice(false);
    setPromptModalState({
      isOpen: false,
      templateId: "",
      variables: {},
      onConfirm: () => {},
    });
    setTtsModalState({
      isOpen: false,
      initialText: "",
      onConfirm: () => {},
    });
  }, [renderedEpisodeId, renderedProjectId]);

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state) => {
      const projectId = state.currentProject?.id || null;
      const episodeId = state.activeEpisode?.id || null;
      if (
        activeContextRef.current.projectId === projectId
        && activeContextRef.current.episodeId === episodeId
      ) return;
      activeContextRef.current = {
        projectId,
        episodeId,
        epoch: activeContextRef.current.epoch + 1,
      };
      activeRequestIdsRef.current = {};
      setIsGeneratingImage(false);
      setIsGeneratingVideo(false);
      setIsGeneratingVoice(false);
      setPromptModalState({
        isOpen: false,
        templateId: "",
        variables: {},
        onConfirm: () => {},
      });
      setTtsModalState({
        isOpen: false,
        initialText: "",
        onConfirm: () => {},
      });
    });
    return () => {
      unsubscribe();
      activeContextRef.current = {
        ...activeContextRef.current,
        epoch: activeContextRef.current.epoch + 1,
      };
      activeRequestIdsRef.current = {};
    };
  }, []);

  const captureRequestScope = (
    project: Project,
    episode: Episode,
    sceneId: string,
    targetKind: StudioAIRequestScope["targetKind"],
    targetId: string,
  ): StudioAIRequestScope => ({
    projectId: project.id,
    episodeId: episode.id,
    sceneId,
    targetKind,
    targetId,
    contextEpoch: activeContextRef.current.epoch,
  });

  const isRequestScopeCurrent = (request: StudioAIRequestScope) => {
    const context = activeContextRef.current;
    if (
      context.epoch !== request.contextEpoch
      || context.projectId !== request.projectId
      || context.episodeId !== request.episodeId
    ) return false;
    const state = useProjectStore.getState();
    return studioAIRequestTargetExists(request, state.currentProject, state.activeEpisode);
  };

  const beginRequest = (
    kind: StudioAIRequestKind,
    scope: StudioAIRequestScope,
  ): ActiveStudioAIRequest | null => {
    if (!isRequestScopeCurrent(scope) || activeRequestIdsRef.current[kind] !== undefined) return null;
    const request = {
      ...scope,
      kind,
      requestId: ++nextRequestIdRef.current,
    };
    activeRequestIdsRef.current[kind] = request.requestId;
    return request;
  };

  const isRequestCurrent = (request: ActiveStudioAIRequest) => (
    activeRequestIdsRef.current[request.kind] === request.requestId
    && isRequestScopeCurrent(request)
  );

  const finishRequest = (request: ActiveStudioAIRequest) => {
    if (activeRequestIdsRef.current[request.kind] !== request.requestId) return false;
    delete activeRequestIdsRef.current[request.kind];
    return true;
  };

  const awaitPendingSceneWrites = async (request: ActiveStudioAIRequest) => {
    const pendingWrite = useProjectStore.getState()._updateSceneLock;
    if (pendingWrite) await pendingWrite;
    return isRequestCurrent(request);
  };

  const handlePrepareGenerateImage = (
    selectedShot: Shot,
    activeSceneId: string,
    activeEpisode: Episode,
    currentProject: Project
  ) => {
    if (activeRequestIdsRef.current.image !== undefined) return;
    const requestScope = captureRequestScope(
      currentProject,
      activeEpisode,
      activeSceneId,
      "shot",
      selectedShot.id,
    );
    if (!isRequestScopeCurrent(requestScope)) return;

    setPromptModalState({
      isOpen: true,
      projectId: requestScope.projectId,
      episodeId: requestScope.episodeId,
      sceneId: requestScope.sceneId,
      templateId: 'generateImage',
      variables: {
        imagePrompt: [selectedShot.imagePrompt, appearancePrompt(selectedShot, "image")].filter(Boolean).join("\n\n"),
      },
      onConfirm: (finalPrompt) => handleGenerateImage(
        finalPrompt,
        selectedShot,
        activeSceneId,
        activeEpisode,
        currentProject,
        requestScope,
      )
    });
  };

  const handleGenerateImage = async (
    finalPrompt: string,
    selectedShot: Shot,
    activeSceneId: string,
    activeEpisode: Episode,
    currentProject: Project,
    preparedScope?: StudioAIRequestScope,
  ) => {
    const requestScope = preparedScope || captureRequestScope(
      currentProject,
      activeEpisode,
      activeSceneId,
      "shot",
      selectedShot.id,
    );
    const request = beginRequest("image", requestScope);
    if (!request) return;
    const imageModelId = useAIConfigStore.getState().routing.imageGen;
    setIsGeneratingImage(true);
    try {
      if (!isRequestCurrent(request)) return;
      const activeScene = resolveStudioScene(activeEpisode, activeSceneId, currentProject);
      const variantMap = activeScene?.breakdown?.assetVariantMap || {};
      if (activeScene) {
        const context = currentProject.projectModel === 'interactive' ? '' : (await legacyProjectClient.getStoryboardTeamContext(currentProject.id, activeEpisode.id, activeScene.id)).productionTeamContext;
        requireAppearanceReady(currentProject, activeScene, [selectedShot], appearanceSourceShots(activeEpisode, context), 'image');
      }
      const requestedSourceFingerprint = studioShotGenerationSourceFingerprint({
        project: currentProject,
        episode: activeEpisode,
        sceneId: request.sceneId,
        shot: selectedShot,
        action: "image",
      });
      const requestedVisualStyleProjection = buildStudioShotImageVisualStyleProjection({
        project: currentProject,
        shot: selectedShot,
        episode: activeEpisode, scene: activeScene,
      });
      
      const references: ImageGenerationReference[] = [];
      
      // 1. Inject 3D Snapshot as the primary spatial conditioning
      if (selectedShot.compositionData?.imageUrl) {
        references.push(createImageGenerationReference({
          imageUrl: selectedShot.compositionData.imageUrl,
          label: "当前镜头 3D 构图快照",
          role: "composition_anchor",
        }));
      }

      // --- Interactive Anchor Reference ---
      if (currentProject?.projectModel === 'interactive' && activeEpisode?.gameData) {
        const shotIndex = activeScene?.shots?.findIndex(s => s.id === selectedShot.id) ?? -1;
        if (shotIndex === 0) {
          const gameData = activeEpisode.gameData;
          const incomingEdges = gameData.edges?.filter(e => e.targetNodeId === activeSceneId) || [];
          if (incomingEdges.length > 0) {
            const parentNodeId = incomingEdges[0].sourceNodeId;
            const parentNode = gameData.nodes?.find(n => n.id === parentNodeId);
            const parentShots = parentNode?.shots || [];
            const lastShotImg = parentShots.length > 0 ? parentShots[parentShots.length - 1].imageUrl : parentNode?.imageAssetUrl;
            if (lastShotImg) {
              references.push(createImageGenerationReference({
                imageUrl: lastShotImg,
                label: "上级互动节点末帧",
                role: "continuity_frame",
              }));
              toast.success("已自动继承上级节点最后画面的特征", { icon: "🔗" });
            }
          }
        }
      }

      if (currentProject) {
        const assetIds = [
          ...(selectedShot.propIds || []),
          selectedShot.locationId
        ].filter(Boolean) as string[];

        const stateIds = new Set(selectedShot.appearance?.states.filter(s => s.decision === 'accepted').map(s => s.assetId));
        for (const board of appearanceBoards(currentProject, [selectedShot], [], 'image')) if (board.referenceImageUrl) references.push(createImageGenerationReference({ imageUrl: board.referenceImageUrl, label: `${board.assetName} · ${board.variantName}`, role: board.assetType === 'character' ? 'wardrobe_state' : board.assetType === 'location' ? 'location_design' : 'prop_design' }));
        assetIds.filter(id => !stateIds.has(id)).forEach(id => {
          const asset = currentProject.assets.find(a => a.id === id);
          if (asset) {
            const overrideUrl = selectedShot.assetOverrides?.[asset.id];
            if (overrideUrl) {
              references.push(createImageGenerationReference({
                imageUrl: overrideUrl,
                label: `${asset.name} 的镜头指定版本`,
                role: asset.type === "location" ? "location_design" : "prop_design",
              }));
              return;
            }

            const variantId = variantMap[asset.id] || variantMap[`${asset.type}_${asset.id}`];
            const variant = variantId && variantId !== 'default' ? asset.variants?.find(v => v.id === variantId) : null;
            
            if (variant && variant.imageUrl) {
              references.push(createImageGenerationReference({ imageUrl: variant.imageUrl, label: `${asset.name} · ${variant.name}`, role: asset.type === "location" ? "location_design" : "prop_design" }));
            } else if (asset.defaultReferenceUrl) {
              references.push(createImageGenerationReference({ imageUrl: asset.defaultReferenceUrl, label: asset.name, role: asset.type === "location" ? "location_design" : "prop_design" }));
            } else {
              const fallback = asset.imageUrl || asset.multiViewUrl || asset.panoramaUrl;
              if (fallback) references.push(createImageGenerationReference({ imageUrl: fallback, label: asset.name, role: asset.type === "location" ? "location_design" : "prop_design" }));
            }
          }
        });

        const characterIds = selectedShot.characterIdsInShot || [];
        characterIds.filter(id => !stateIds.has(id)).forEach(id => {
          const char = currentProject.characters.find(c => c.id === id);
          if (char) {
            const overrideUrl = selectedShot.assetOverrides?.[char.id];
            if (overrideUrl) {
              references.push(createImageGenerationReference({ imageUrl: overrideUrl, label: `${char.name} 的镜头指定造型`, role: "wardrobe_state" }));
              return;
            }

            const variantId = variantMap[char.id] || variantMap[`character_${char.id}`];
            const variant = variantId && variantId !== 'default' ? char.variants?.find(v => v.id === variantId) : null;
            
            if (variant && variant.imageUrl) {
              references.push(createImageGenerationReference({ imageUrl: variant.imageUrl, label: `${char.name} · ${variant.name}`, role: "wardrobe_state" }));
            } else if (char.defaultReferenceUrl) {
              references.push(createImageGenerationReference({ imageUrl: char.defaultReferenceUrl, label: char.name, role: "character_identity" }));
            } else {
              const fallback = char.referenceImageUrl || char.multiViewUrl;
              if (fallback) references.push(createImageGenerationReference({ imageUrl: fallback, label: char.name, role: "character_identity" }));
            }
          }
        });
      }

      // Compress all reference images to avoid "Payload Too Large" and "Failed to fetch"
      const compressedReferences = references.length > 0
        ? await Promise.all(references.map(async (reference) => ({ ...reference, imageUrl: await compressImage(reference.imageUrl) })))
        : undefined;
      if (!isRequestCurrent(request)) return;

      let compiledImageRequest: CompiledImageGenerationRequest | undefined;
      const imageUrl = await generateAIImage({
        promptCore: finalPrompt,
        aspectRatio: currentProject?.aspectRatio as any || "16:9",
        references: compressedReferences,
        visualStyleProjection: buildStudioShotImageVisualStyleProjection({
          project: currentProject,
          shot: selectedShot,
          episode: activeEpisode, scene: activeScene,
        }),
        visualRecipeInputEvidence: buildShotImageVisualRecipeInputEvidence({
          project: currentProject,
          shots: [selectedShot],
        }),
        onPromptCompiled: (compiled) => {
          compiledImageRequest = compiled;
        },
      });
      if (!isRequestCurrent(request)) return;
      const imageMedia = createAIGeneratedMediaReference(
        "image",
        imageUrl,
        imageModelId,
      );

      if (!await awaitPendingSceneWrites(request)) return;
      const latestProject = useProjectStore.getState().currentProject;
      const latestActiveEpisode = useProjectStore.getState().activeEpisode;
      if (!isRequestCurrent(request) || !latestProject || !latestActiveEpisode) return;
      const latestActiveScene = resolveStudioScene(latestActiveEpisode, request.sceneId, latestProject);
      const latestShot = latestActiveScene?.shots?.find((shot) => shot.id === request.targetId);
      if (!latestActiveScene?.shots || !latestShot) return;
      const sourceReviewReasons: NonNullable<ManualStudioTakeAudit["sourceReview"]>["reasons"] = [];
      if (studioShotGenerationSourceFingerprint({
        project: latestProject,
        episode: latestActiveEpisode,
        sceneId: request.sceneId,
        shot: latestShot,
        action: "image",
      }) !== requestedSourceFingerprint) {
        sourceReviewReasons.push("project_source_updated");
      }
      let visualStyleUpdated = false;
      try {
        const latestVisualStyleProjection = buildStudioShotImageVisualStyleProjection({
          project: latestProject,
          shot: latestShot,
          episode: latestActiveEpisode, scene: latestActiveScene,
        });
        visualStyleUpdated = manualStoryboardHash(latestVisualStyleProjection.compileManifest)
          !== manualStoryboardHash(requestedVisualStyleProjection.compileManifest);
      } catch {
        visualStyleUpdated = true;
      }
      if (visualStyleUpdated) {
        sourceReviewReasons.push("visual_style_updated");
      }

      const createdAt = Date.now();
      const takeId = `take-${createdAt}`;
      const providerPrompt = compiledImageRequest?.providerPrompt || finalPrompt;
      const selectedAssetIds = [
        ...(selectedShot.characterIdsInShot || []),
        selectedShot.locationId,
        ...(selectedShot.propIds || []),
      ].filter((id): id is string => Boolean(id));
      const generationAudit: ManualStudioTakeAudit = {
        action: "generate_image",
        targetKind: "shot",
        shotId: request.targetId,
        sourceHash: requestedSourceFingerprint,
        sourceReview: {
          status: sourceReviewReasons.length ? "review_recommended" : "current",
          reasons: sourceReviewReasons,
          detectedAt: createdAt,
        },
        authorPrompt: finalPrompt,
        finalProviderPrompt: providerPrompt,
        promptHash: manualStoryboardHash(finalPrompt),
        providerPromptHash: manualStoryboardHash(providerPrompt),
        modelId: imageModelId,
        selectedSkillIds: [],
        selectedSkillTitles: [],
        selectedContextIds: [],
        selectedAssetIds,
        selectedAssetBoardItemIds: [],
        referenceImageUrls: compiledImageRequest?.referenceImages || [],
        imageReferenceManifest: compiledImageRequest?.references.map((reference, index) => ({
          index: index + 1,
          imageUrl: reference.imageUrl,
          label: reference.label,
          role: reference.role,
          preserve: reference.preserve,
          allowChange: reference.allowChange,
          exclude: reference.exclude,
        })),
        promptCompositionManifest: compiledImageRequest?.manifest,
        visualStyleCompileManifest: compiledImageRequest?.visualStyleProjection?.compileManifest,
        createdAt,
      };
      const generatedTake = { id: takeId, imageUrl, imageMedia, generationAudit, createdAt };

      if (!isRequestCurrent(request)) return;
      snapshotInteractiveNode(latestProject, request.sceneId, "Studio 生成节点镜头图片前");
      await useProjectStore.getState().updateScene(request.sceneId, {
        shots: latestActiveScene.shots.map((shot) => {
          if (shot.id !== request.targetId) return shot;
          return appendShotTakeCandidate(shot, generatedTake);
        }),
      }, request.episodeId);
      if (!isRequestCurrent(request)) return;
      toast.success(sourceReviewReasons.length
        ? "图片候选已生成，但来源有更新，建议复核后再采用"
        : "图片候选已生成，请预览后人工采用");
      return imageUrl;
    } catch (error) {
      console.error("Studio image generation failed:", summarizeUnknownError(error));
      if (isRequestCurrent(request)) toast.error("生成图片失败，请重试。");
      throw error;
    } finally {
      if (finishRequest(request)) setIsGeneratingImage(false);
    }
  };

  const handlePrepareGenerateVideo = (
    selectedShot: Shot,
    activeSceneId: string,
    activeEpisode: Episode,
    currentProject: Project
  ) => {
    if (!selectedShot?.imageUrl || activeRequestIdsRef.current.video !== undefined) {
      if (!selectedShot?.imageUrl) toast.error("请先生成或上传图片，然后再生成视频！");
      return;
    }
    const requestScope = captureRequestScope(
      currentProject,
      activeEpisode,
      activeSceneId,
      "shot",
      selectedShot.id,
    );
    if (!isRequestScopeCurrent(requestScope)) return;

    setPromptModalState({
      isOpen: true,
      projectId: requestScope.projectId,
      episodeId: requestScope.episodeId,
      sceneId: requestScope.sceneId,
      templateId: 'generateVideo',
      variables: {
        videoPrompt: [selectedShot.videoPrompt, buildVideoContinuityContext({ sceneId: activeSceneId, shots: resolveStudioScene(activeEpisode, activeSceneId, currentProject)?.shots || [], unitShotIds: [selectedShot.id] }), appearancePrompt(selectedShot, "video")].filter(Boolean).join("\n\n"),
      },
      onConfirm: (finalPrompt) => handleGenerateVideo(
        finalPrompt,
        selectedShot,
        activeSceneId,
        activeEpisode,
        currentProject,
        requestScope,
      )
    });
  };

  const handleGenerateVideo = async (
    finalPrompt: string,
    selectedShot: Shot,
    activeSceneId: string,
    activeEpisode: Episode,
    currentProject: Project,
    preparedScope?: StudioAIRequestScope,
  ) => {
    const requestScope = preparedScope || captureRequestScope(
      currentProject,
      activeEpisode,
      activeSceneId,
      "shot",
      selectedShot.id,
    );
    const request = beginRequest("video", requestScope);
    if (!request) return;
    const videoModelId = useAIConfigStore.getState().routing.videoGen;
    setIsGeneratingVideo(true);
    try {
      if (!isRequestCurrent(request)) return;
      let startingImageUrl = selectedShot.imageUrl;
      // --- Interactive Anchor Reference ---
      if (!startingImageUrl && currentProject?.projectModel === 'interactive' && activeEpisode?.gameData) {
        const activeScene = resolveStudioScene(activeEpisode, activeSceneId, currentProject);
        const shotIndex = activeScene?.shots?.findIndex(s => s.id === selectedShot.id) ?? -1;
        if (shotIndex === 0) {
          const gameData = activeEpisode.gameData;
          const incomingEdges = gameData.edges?.filter(e => e.targetNodeId === activeSceneId) || [];
          if (incomingEdges.length > 0) {
            const parentNodeId = incomingEdges[0].sourceNodeId;
            const parentNode = gameData.nodes?.find(n => n.id === parentNodeId);
            const parentShots = parentNode?.shots || [];
            startingImageUrl = parentShots.length > 0 ? parentShots[parentShots.length - 1].imageUrl : parentNode?.imageAssetUrl;
            if (startingImageUrl) {
              toast.success("已自动衔接上级节点尾帧作为视频起点", { icon: "🔗" });
            }
          }
        }
      }

      const stateScene = resolveStudioScene(activeEpisode, activeSceneId, currentProject);
      if (stateScene) {
        const context = currentProject.projectModel === 'interactive' ? '' : (await legacyProjectClient.getStoryboardTeamContext(currentProject.id, activeEpisode.id, stateScene.id)).productionTeamContext;
        requireAppearanceReady(currentProject, stateScene, [selectedShot], appearanceSourceShots(activeEpisode, context), 'video');
      }
      if (appearanceImageIsAfterChange(selectedShot.appearance)) throw new Error('当前图片选择的是变化后状态，请先选择变化前画面作为视频首帧。');
      const requestedSourceFingerprint = studioShotGenerationSourceFingerprint({
        project: currentProject,
        episode: activeEpisode,
        sceneId: request.sceneId,
        shot: selectedShot,
        action: "video",
      });
      const visualStyleProjection = buildStudioShotVideoVisualStyleProjection({
        project: currentProject,
        shot: selectedShot,
        episode: activeEpisode, scene: stateScene,
      });
      const continuityContext = stateScene ? buildVideoContinuityContext({ sceneId: stateScene.id, shots: stateScene.shots || [], unitShotIds: [selectedShot.id] }) : "";
      const providerPrompt = [finalPrompt, continuityContext && !finalPrompt.includes(continuityContext) ? continuityContext : "", visualStyleProjection.rendered.instruction].filter(Boolean).join("\n\n");
      let providerPromptAudit: VideoProviderPromptAudit | undefined;
      const videoUrl = await generateAIVideo({
        prompt: providerPrompt,
        imageUrl: startingImageUrl,
        durationSeconds: Number(selectedShot.duration || 0),
        aspectRatio: currentProject?.aspectRatio as any || "16:9",
        motionContract: {
          cameraMotion: selectedShot.cameraMovement,
          subjectMotion: selectedShot.visualAction || selectedShot.blocking,
          durationSeconds: Number(selectedShot.duration || 0),
          loop: /互动待机|循环待机|loop(?:able|ing)?\s+idle/i.test(selectedShot.videoPrompt || ""),
        },
        visualStyleCompileManifest: visualStyleProjection.rendered.manifest,
        onProviderPromptPrepared: (audit) => {
          providerPromptAudit = audit;
        },
      });
      if (!isRequestCurrent(request)) return;
      const videoMedia = createAIGeneratedMediaReference(
        "video",
        videoUrl,
        videoModelId,
      );

      if (!await awaitPendingSceneWrites(request)) return;
      const latestProject = useProjectStore.getState().currentProject;
      const latestActiveEpisode = useProjectStore.getState().activeEpisode;
      if (!isRequestCurrent(request) || !latestProject || !latestActiveEpisode) return;
      const latestActiveScene = resolveStudioScene(latestActiveEpisode, request.sceneId, latestProject);
      const latestShot = latestActiveScene?.shots?.find((shot) => shot.id === request.targetId);
      if (!latestActiveScene?.shots || !latestShot) return;
      const sourceReviewReasons: NonNullable<ManualStudioTakeAudit["sourceReview"]>["reasons"] = [];
      if (studioShotGenerationSourceFingerprint({
        project: latestProject,
        episode: latestActiveEpisode,
        sceneId: request.sceneId,
        shot: latestShot,
        action: "video",
      }) !== requestedSourceFingerprint) {
        sourceReviewReasons.push("project_source_updated");
      }
      let visualStyleUpdated = false;
      try {
        const latestVisualStyleProjection = buildStudioShotVideoVisualStyleProjection({
          project: latestProject,
          shot: latestShot,
          episode: latestActiveEpisode, scene: latestActiveScene,
        });
        visualStyleUpdated = manualStoryboardHash(latestVisualStyleProjection.rendered.manifest)
          !== manualStoryboardHash(visualStyleProjection.rendered.manifest);
      } catch {
        visualStyleUpdated = true;
      }
      if (visualStyleUpdated) {
        sourceReviewReasons.push("visual_style_updated");
      }

      const createdAt = Date.now();
      const selectedAssetIds = [
        ...(selectedShot.characterIdsInShot || []),
        selectedShot.locationId,
        ...(selectedShot.propIds || []),
      ].filter((id): id is string => Boolean(id));
      const generationAudit: ManualStudioTakeAudit = {
        action: "generate_video",
        targetKind: "shot",
        shotId: request.targetId,
        sourceHash: requestedSourceFingerprint,
        sourceReview: {
          status: sourceReviewReasons.length ? "review_recommended" : "current",
          reasons: sourceReviewReasons,
          detectedAt: createdAt,
        },
        authorPrompt: finalPrompt,
        finalProviderPrompt: providerPromptAudit?.finalProviderPrompt || providerPrompt,
        promptHash: manualStoryboardHash(finalPrompt),
        providerPromptHash: manualStoryboardHash(providerPromptAudit?.finalProviderPrompt || providerPrompt),
        videoMotionContract: {
          cameraMotion: selectedShot.cameraMovement,
          subjectMotion: selectedShot.visualAction || selectedShot.blocking,
          durationSeconds: Number(selectedShot.duration || 0),
          loop: /互动待机|循环待机|loop(?:able|ing)?\s+idle/i.test(selectedShot.videoPrompt || ""),
        },
        modelId: videoModelId,
        selectedSkillIds: [],
        selectedSkillTitles: [],
        selectedContextIds: [],
        selectedAssetIds,
        selectedAssetBoardItemIds: [],
        referenceImageUrls: startingImageUrl ? [startingImageUrl] : [],
        promptCompositionManifest: providerPromptAudit?.manifest,
        visualStyleCompileManifest: providerPromptAudit?.visualStyleCompileManifest
          || visualStyleProjection.rendered.manifest,
        createdAt,
      };
      const generatedTake = {
        id: `take-video-${createdAt}`,
        imageUrl: startingImageUrl,
        imageMedia: startingImageUrl ? createLegacyMediaReference("image", startingImageUrl) : undefined,
        videoUrl,
        videoMedia,
        generationAudit,
        createdAt,
      };
      if (!isRequestCurrent(request)) return;
      snapshotInteractiveNode(latestProject, request.sceneId, "Studio 生成节点镜头视频前");
      await useProjectStore.getState().updateScene(request.sceneId, {
        shots: latestActiveScene.shots.map((shot) => shot.id !== request.targetId
          ? shot
          : appendShotTakeCandidate(shot, generatedTake)),
      }, request.episodeId);
      if (!isRequestCurrent(request)) return;
      toast.success(sourceReviewReasons.length
        ? "视频候选已生成，但来源有更新，建议复核后再采用"
        : "视频候选已生成，请预览后人工采用");
      return videoUrl;
    } catch (error) {
      const summary = summarizeUnknownError(error);
      console.error("Studio video generation failed:", summary);
      if (isRequestCurrent(request)) toast.error(summary.message);
      throw error;
    } finally {
      if (finishRequest(request)) setIsGeneratingVideo(false);
    }
  };

  const handleGenerateVoice = async (
    selectedAudioTrack: AudioTrack,
    activeSceneId: string,
    activeEpisode: Episode,
    currentProject: Project,
    generationContext?: { governed: boolean; sourceHash: string; contextSummary: string },
  ) => {
    if (activeRequestIdsRef.current.voice !== undefined) return;
    if (!selectedAudioTrack.text) {
      toast.error("请先输入配音台词！");
      return;
    }
    const requestScope = captureRequestScope(
      currentProject,
      activeEpisode,
      activeSceneId,
      "audio_track",
      selectedAudioTrack.id,
    );
    if (!isRequestScopeCurrent(requestScope)) return;

    await useAIConfigStore.getState().hydrate();
    const character = currentProject.characters.find(item => item.id === selectedAudioTrack.characterId);
    const voiceSettings = character?.voiceSettings;
    const audioModelId = voiceSettings?.modelConfigId || useAIConfigStore.getState().routing.audioGen;
    const audioModel = useAIConfigStore.getState().models.find(item => item.id === audioModelId);
    const voiceName = voiceSettings?.voice || character?.voiceName || (isQwenCustomVoice(audioModel?.modelId) ? 'Serena' : 'Puck');
    const voiceScene = resolveStudioScene(activeEpisode, activeSceneId, currentProject);
    const voiceShot = voiceScene?.shots?.find(item => item.id === selectedAudioTrack.shotId);
    const directorPerformance = renderProductionCreativeContext(currentProject, { episode: activeEpisode, scene: voiceScene, shot: voiceShot, dialogueLineIndex: directorDialogueIndex(voiceShot, selectedAudioTrack) ?? -1 }, "performance");
    const authoredDirection = resolveTrackVoiceDirection(voiceSettings, selectedAudioTrack);
    const inheritedDirection = { ...authoredDirection };
    inheritedDirection.instructions = characterSpeechDirection(character?.vocalQuirk, [directorPerformance, inheritedDirection.instructions].filter(Boolean).join("\n\n"));

    setTtsModalState({
      isOpen: true,
      projectId: requestScope.projectId,
      episodeId: requestScope.episodeId,
      sceneId: requestScope.sceneId,
      initialText: selectedAudioTrack.text,
      modelId: audioModelId,
      voiceName,
      ...inheritedDirection,
      contextSummary: generationContext?.contextSummary,
      readOnly: generationContext?.governed,
      onConfirm: async (finalText, direction) => {
        const request = beginRequest("voice", requestScope);
        if (!request) return;
        setIsGeneratingVoice(true);
        const finalDirection = { ...inheritedDirection, ...direction };
        try {
          const audioUrl = await generateAIVoice({
            text: finalText,
            voiceName,
            modelConfigId: audioModelId,
            ...finalDirection,
            projectId: currentProject.id,
          });
          if (!isRequestCurrent(request)) return;
          
          const getAudioDuration = (url: string): Promise<number> => {
            return new Promise((resolve) => {
              const audio = new Audio(url);
              const finish = (duration: number) => {
                clearTimeout(timeout);
                audio.onloadedmetadata = null;
                audio.onerror = null;
                resolve(Number.isFinite(duration) ? duration : 0);
              };
              const timeout = setTimeout(() => finish(0), 15000);
              audio.onloadedmetadata = () => finish(audio.duration);
              audio.onerror = () => finish(0);
            });
          };

          const duration = await getAudioDuration(audioUrl);
          if (!isRequestCurrent(request)) return;
          const audioMedia = createAIGeneratedMediaReference("audio", audioUrl, audioModelId);

          if (!await awaitPendingSceneWrites(request)) return;
          const latestProject = useProjectStore.getState().currentProject;
          const latestActiveEpisode = useProjectStore.getState().activeEpisode;
          if (!isRequestCurrent(request) || !latestProject || !latestActiveEpisode) return;
          const latestActiveScene = resolveStudioScene(latestActiveEpisode, request.sceneId, latestProject);
          if (!latestActiveScene?.audioTracks?.some((track) => track.id === request.targetId)) return;
          const latestTrack = latestActiveScene.audioTracks.find(track => track.id === request.targetId)!;
          if (latestTrack.text !== selectedAudioTrack.text || latestTrack.characterId !== selectedAudioTrack.characterId
            || latestTrack.url !== selectedAudioTrack.url || latestTrack.shotId !== selectedAudioTrack.shotId) {
            throw new Error('配音期间台词、角色或录音已更新，本次结果未覆盖你的修改。');
          }

          const result = applyStudioVoiceResult({
            shots: latestActiveScene.shots || [],
            tracks: latestActiveScene.audioTracks,
            trackId: request.targetId,
            url: audioUrl,
            text: finalText,
            duration,
            audioMedia,
            governed: Boolean(generationContext?.governed),
            voiceDirection: voiceDirectionOverrides({
              ...finalDirection,
              // Unedited inherited instructions stay inherited, so later profile edits take effect.
              instructions: finalDirection.instructions === inheritedDirection.instructions ? authoredDirection.instructions : finalDirection.instructions,
            }, voiceSettings),
            audit: {
              action: "generate_voice",
              sourceHash: generationContext?.sourceHash || "legacy",
              textHash: manualStoryboardHash(finalText),
              modelId: audioMedia.source === 'upload' ? 'manual_external' : audioModelId,
              provider: audioMedia.source === 'upload' ? 'manual_external' : 'api',
              voiceName,
              ...finalDirection,
              shotId: selectedAudioTrack.shotId,
              characterId: selectedAudioTrack.characterId,
              createdAt: Date.now(),
            },
          });
          if (!isRequestCurrent(request)) return;
          snapshotInteractiveNode(latestProject, request.sceneId, "Studio 生成节点配音前");
          await useProjectStore.getState().updateScene(request.sceneId, result.sceneUpdates, request.episodeId);
          if (isRequestCurrent(request) && (result.exceedsShot || result.overlapsNextLine)) {
            toast.error(result.exceedsShot
              ? "声音已保存，但超出已确认镜头时间，请回到分镜调整台词或时长。"
              : "声音已保存，但与下一句重叠，请回到分镜调整台词或时间安排。");
          }
          if (!isRequestCurrent(request)) return;
        } catch (error) {
          console.error("Studio voice generation failed:", summarizeUnknownError(error));
          throw error;
        } finally {
          if (finishRequest(request)) setIsGeneratingVoice(false);
        }
      }
    });
  };

  const visiblePromptModalState = promptModalState.isOpen && (
    promptModalState.projectId !== renderedProjectId
    || promptModalState.episodeId !== renderedEpisodeId
  )
    ? { ...promptModalState, isOpen: false }
    : promptModalState;
  const visibleTtsModalState = ttsModalState.isOpen && (
    ttsModalState.projectId !== renderedProjectId
    || ttsModalState.episodeId !== renderedEpisodeId
  )
    ? { ...ttsModalState, isOpen: false }
    : ttsModalState;
  const visibleIsGeneratingImage = isGeneratingImage
    && activeRequestIdsRef.current.image !== undefined;
  const visibleIsGeneratingVideo = isGeneratingVideo
    && activeRequestIdsRef.current.video !== undefined;
  const visibleIsGeneratingVoice = isGeneratingVoice
    && activeRequestIdsRef.current.voice !== undefined;

  return {
    isGeneratingImage: visibleIsGeneratingImage,
    isGeneratingVideo: visibleIsGeneratingVideo,
    isGeneratingVoice: visibleIsGeneratingVoice,
    promptModalState: visiblePromptModalState,
    setPromptModalState,
    ttsModalState: visibleTtsModalState,
    setTtsModalState,
    handlePrepareGenerateImage,
    handlePrepareGenerateVideo,
    handleGenerateImage,
    handleGenerateVideo,
    handleGenerateVoice,
  };
}
