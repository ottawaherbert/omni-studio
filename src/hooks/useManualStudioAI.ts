import { appearanceImageIsAfterChange, appearanceBoards, appearancePrompt, appearanceSourceShots, requireAppearanceReady } from "../clients/productionStoryboardWorkflowClient";
import { resolveManualAIRequest, manualAIMediaHasAudio } from "../clients/manualAIClient";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  generateAIImage,
  generateAIContent,
  generateAIVideo,
  generateVideoFromIntent,
  queryVideoGenerationTask,
} from "../clients/aiClient";
import { assetClient } from "../clients/assetClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import { appendShotTakeCandidate, reviseShotTakeAudio } from "../clients/productionMediaReviewClient";
import {
  buildImageVisualStyleProjection,
  buildShotImageVisualRecipeInputEvidence,
  resolveImageVisualStyleProjectionContext,
  resolveManualStudioImageVisualArtifactIntent,
  resolveManualStudioTargetShotOverride,
} from "../clients/productionVisualImageClient";
import { flushDebouncedProjectSave, useAIConfigStore, useProjectStore } from "../clients/stateClient";
import { noteSuccessfulProductionEpisodeWrite } from "../utils/saveFailureRecovery";
import type {
  PromptEditorConfirmMetadata,
  PromptEditorImageReference,
  VideoGenerationPromptConfiguration,
  VideoGenerationPromptDetail,
} from "../components/PromptEditorModal";
import type { Episode, ManualStudioTakeAudit, Project, Scene, Shot, VisualCompileManifest } from "../clients/domainTypes";
import type { ManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";
import { manualStoryboardHash } from "../clients/productionStoryboardWorkflowClient";
import { createAIGeneratedMediaReference, createLegacyMediaReference, createMediaAssetReference } from "../utils/mediaProvenance";
import { summarizeUnknownError } from "../utils/logging";
import { resolveSceneReadModel } from "../utils/sceneReadModel";
import {
  externalVideoPrompt,
  applyShotDraftPreview,
  buildManualStudioProjectVisualStyleProjection,
  buildManualStudioVideoIntent,
  buildMiniMaxH3PromptAuthoringRequest,
  createImageGenerationReference,
  evaluateStandaloneShotDuration,
  evaluateVideoUnitDuration,
  isMiniMaxH3AdapterId,
  listCompatibleVideoModelAdapters,
  miniMaxH3AdapterForGenerationMode,
  miniMaxH3GenerationModeForAdapter,
  MINIMAX_H3_REF2VA_ADAPTER_ID,
  parseMiniMaxH3PromptAuthoringResult,
  prepareComfyUIH3Intent,
  resolveShotDraftPreviewReference,
  resolveManualStudioStoryboardReferenceUrl,
  resolveManualStudioInteractiveContext,
  resolveVideoModelAdapter,
  selectMiniMaxH3GenerationWay,
  videoBeatDialogueLines,
  videoAudioModeOptionsForCapabilities,
  type CompiledImageGenerationRequest,
  type ImageVisualStyleProjection,
  type ManualStudioVideoTimelineInput,
  type ShotDraftPreviewReference,
  type VideoGenerationAdapterPlan,
  type VideoGenerationIntent,
  type VideoGenerationTask,
  VideoMotionContract,
  VideoProviderPromptAudit,
} from "../clients/productionStudioWorkflowClient";
import {
  KIE_GROK_VIDEO_MAX_DURATION_SECONDS,
  MINIMAX_H3_MODEL_ID,
  isKieGrokVideoModelId,
} from "../config/aiConfigDefaults";

const appendDistinctStudioTake = <T extends { id: string }>(takes: T[] | undefined, take: T): T[] => [
  ...(takes || []).filter((item) => item.id !== take.id),
  take,
];

const manualStudioTargetSourceFingerprint = (
  scene: Scene,
  target: ManualStudioGenerationTarget,
) => {
  const shot = scene.shots?.find((item) => item.id === target.shotId);
  const { takes: _shotTakes, draftPreview: _draftPreview, ...shotSource } = shot || {};
  const workflow = target.kind === "storyboard_board"
    ? scene.manualStoryboard?.boards?.find((item) => (
        item.unitSchema === "storyboard_unit.v1"
        && (item.videoGenerationUnitId === target.videoGenerationUnitId
          || item.board?.videoGenerationUnitId === target.videoGenerationUnitId
          || item.boardId === target.boardId
          || item.board?.id === target.boardId)
      ))
    : undefined;
  const { takes: _unitTakes, updatedAt: _unitUpdatedAt, ...workflowSource } = workflow || {};
  return manualStoryboardHash({
    shot: shotSource,
    workflow: workflowSource,
    interactiveMetadata: scene.interactiveMetadata,
    target: {
      kind: target.kind,
      shotId: target.shotId,
      shotIds: target.shotIds,
      boardId: target.boardId,
      panelId: target.panelId,
      pageId: target.pageId,
      videoGenerationUnitId: target.videoGenerationUnitId,
      upstreamPromptHash: target.upstreamPromptHash,
    },
  });
};

export interface ManualStudioGenerationTarget {
  kind: "shot" | "storyboard_panel" | "storyboard_board";
  shotId: string;
  label: string;
  imagePrompt: string;
  videoPrompt: string;
  durationSeconds: number;
  assetIds: string[];
  assetBoardItemIds: string[];
  boardId?: string;
  panelId?: string;
  pageId?: string;
  storyboardImageUrl?: string;
  videoReferenceImageUrl?: string;
  storyboardReferenceMode?: "shot_grid" | "director_board";
  includeStoryboardReference?: boolean;
  selectedReferenceImages?: Array<{ takeId: string; shotId: string; mediaUrl: string; displayName: string }>;
  selectedReferenceVideos?: Array<{ takeId: string; shotId: string; mediaUrl: string; displayName: string; durationSeconds: number }>;
  selectedDialogueTrackIds?: string[];
  selectedVoiceReferenceIds?: string[];
  storyboardVisualTakeId?: string;
  videoGenerationUnitId?: string;
  shotIds?: string[];
  startState?: string;
  endState?: string;
  timeline?: ManualStudioVideoTimelineInput[];
  targetVideoModelConfigId?: string;
  interactiveContentSlot?: "entry" | "main" | "choice_hold" | "exit";
  interactiveNodeId?: string;
  upstreamPromptSourceKind?: "shot" | "storyboard_unit";
  upstreamPromptSourceId?: string;
  upstreamPromptHash?: string;
}

export interface ManualStudioVideoPreparation {
  externalOnly?: boolean;
  generationWayId?: string;
  startFrameTakeId?: string;
  startFrameUrl?: string;
  endFrameTakeId?: string;
  endFrameUrl?: string;
}

interface ManualStudioPromptRequest {
  externalOnly?: boolean;
  externalIntent?: VideoGenerationIntent;
  externalReferences?: { url: string; label: string }[];
  action: "image" | "video";
  target: ManualStudioGenerationTarget;
  sourceHash: string;
  templateId: "generateImage" | "generateVideo";
  variables: Record<string, string>;
  contextOptions: { id: string; label: string; value: string }[];
  defaultSelectedContextIds: string[];
  referenceImageUrls: string[];
  imageReferences: PromptEditorImageReference[];
  appearanceHash?: string;
  imageVisualStyleProjection?: ImageVisualStyleProjection;
  visualStyleCompileManifest?: VisualCompileManifest;
  startFrameTakeId?: string;
  startFrameUrl?: string;
  endFrameTakeId?: string;
  endFrameUrl?: string;
  videoGeneration?: VideoGenerationPromptConfiguration;
  draftPreview?: boolean;
  draftPreviewReference?: ShotDraftPreviewReference;
}

const videoTaskTerminal = (status: VideoGenerationTask["status"]) => ["succeeded", "failed", "cancelled"].includes(status);

const needsComfyUIArchiveRefresh = (
  provider: VideoGenerationTask["provider"],
  status: VideoGenerationTask["status"],
  videoUrl?: string,
) => provider === "comfyui_h3" && status === "succeeded" && !String(videoUrl || "").startsWith("/media/");

const timeLabel = (seconds: number) => {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
};

const videoPromptDetail = (
  plan: VideoGenerationAdapterPlan,
  project: Project,
): VideoGenerationPromptDetail => {
  const assetNames = new Map([
    ...project.characters.map((character) => [character.id, character.name] as const),
    ...project.assets.map((asset) => [asset.id, asset.name] as const),
  ]);
  return {
    modelPrompt: plan.adapterPrompt,
    references: plan.referenceManifest.map((entry, index) => ({
      id: entry.bindingId,
      label: entry.mediaKind === "image" ? `图片 ${index + 1}` : entry.mediaKind === "audio" ? `声音 ${index + 1}` : `视频 ${index + 1}`,
      providerLabel: entry.providerLabel,
      name: entry.displayName || assetNames.get(entry.semanticEntityId || entry.sourceAssetId) || "引用素材",
      relationship: entry.mediaKind === "audio"
        ? `这段声音属于${assetNames.get(entry.semanticEntityId || "") || entry.displayName || "当前说话人物"}`
        : entry.sourceType === "storyboard_board" || entry.sourceType === "storyboard_panel"
          ? "负责当前镜头的构图、站位、动作顺序和摄影机参考"
          : `负责保持${entry.semanticEntityId
            ? assetNames.get(entry.semanticEntityId) || entry.displayName || "当前对象"
            : entry.displayName || assetNames.get(entry.sourceAssetId) || "当前对象"}的外观与状态`,
      mediaKind: entry.mediaKind,
      thumbnailUrl: entry.mediaKind === "image" ? entry.mediaUrl : undefined,
    })),
    timeline: plan.timelinePlan.map((beat, index) => ({
      id: beat.id,
      label: beat.panelId ? `画格 ${index + 1}` : `镜头 ${index + 1}`,
      time: `${timeLabel(beat.startSeconds)} - ${timeLabel(beat.endSeconds)}`,
      action: [beat.visibleAction, beat.performance].filter(Boolean).join(" "),
      camera: beat.camera || undefined,
      dialogue: videoBeatDialogueLines(beat).map((line) => `${assetNames.get(line.characterId || "") || line.speakerName || "对白"}：${line.text}`).join("\n") || undefined,
      sound: beat.soundCues.join("；") || undefined,
    })),
    issues: plan.issues.map((issue) => ({ severity: issue.severity === "blocking" ? "blocking" as const : "warning" as const, message: issue.message })),
    requestSummary: `${plan.requestPreview.durationSeconds} 秒 · ${plan.requestPreview.imageCount} 张图片 · ${plan.requestPreview.videoCount} 段视频 · ${plan.requestPreview.audioCount} 段声音${plan.requestPreview.nativeAudioExpected ? " · 模型生成原生声音" : ""}`,
    nativeAudioExpected: plan.requestPreview.nativeAudioExpected,
  };
};

const audioProvenanceFor = (
  intent: VideoGenerationIntent,
  embeddedAudio: boolean,
): NonNullable<ManualStudioTakeAudit["audioProvenance"]> => {
  if (intent.audioPolicy.mode === "reuse_final_dialogue_audio") return {
    source: "full_dialogue_master",
    embeddedAudio,
    masterAudioAssetIds: intent.audioPolicy.dialogueAudioAssetIds,
    mustNotAutoDub: true,
  };
  if (intent.audioPolicy.mode === "generate_with_voice_reference") return {
    source: "reference_voice",
    embeddedAudio,
    masterAudioAssetIds: intent.audioPolicy.speakerBindings.map((binding) => binding.voiceReferenceAssetId),
    mustNotAutoDub: embeddedAudio,
  };
  if (intent.audioPolicy.mode === "post_dub") return {
    source: "post_dub",
    embeddedAudio,
    masterAudioAssetIds: [],
    mustNotAutoDub: false,
  };
  return { source: "provider_native", embeddedAudio, masterAudioAssetIds: [], mustNotAutoDub: embeddedAudio };
};

interface UseManualStudioAIOptions {
  project: Project | null;
  episode: Episode | null;
  scene?: Scene;
  assets: ManualProductionAssetReadModel | null;
  generationReady: boolean;
  sourceHash: string;
}

const compressReferenceImage = (url: string, maxSize = 1024): Promise<string> => new Promise((resolve) => {
  if (!url.startsWith("data:image")) return resolve(url);
  const image = new Image();
  image.onload = () => {
    const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return resolve(url);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL("image/jpeg", 0.75));
  };
  image.onerror = () => resolve(url);
  image.src = url;
});

export function useManualStudioAI({ project, episode, scene, assets, generationReady, sourceHash }: UseManualStudioAIOptions) {
  const [promptRequest, setPromptRequest] = useState<ManualStudioPromptRequest | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [isGeneratingDraftImage, setIsGeneratingDraftImage] = useState(false);
  const [isImportingMedia, setIsImportingMedia] = useState(false);
  const [isEditingVideoAudio, setIsEditingVideoAudio] = useState(false);
  const taskQueriesInFlight = useRef(new Set<string>());
  const requestEpochRef = useRef(0);
  const nextAsyncRequestIdRef = useRef(0);
  const activeImportRequestIdRef = useRef<number | undefined>(undefined);
  const activeAudioRewriteRequestIdRef = useRef<number | undefined>(undefined);
  const activeContextRef = useRef({
    projectId: project?.id ?? null,
    episodeId: episode?.id ?? null,
    sceneId: scene?.id ?? null,
    epoch: 0,
  });
  const renderedContext = {
    projectId: project?.id ?? null,
    episodeId: episode?.id ?? null,
    sceneId: scene?.id ?? null,
  };
  if (
    activeContextRef.current.projectId !== renderedContext.projectId
    || activeContextRef.current.episodeId !== renderedContext.episodeId
    || activeContextRef.current.sceneId !== renderedContext.sceneId
  ) {
    activeContextRef.current = {
      ...renderedContext,
      epoch: activeContextRef.current.epoch + 1,
    };
    requestEpochRef.current += 1;
    activeImportRequestIdRef.current = undefined;
    activeAudioRewriteRequestIdRef.current = undefined;
  }

  useEffect(() => {
    setPromptRequest(null);
    setIsGeneratingImage(false);
    setIsGeneratingVideo(false);
    setIsGeneratingDraftImage(false);
    setIsImportingMedia(false);
    setIsEditingVideoAudio(false);
  }, [episode?.id, project?.id, scene?.id]);

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state) => {
      const projectId = state.currentProject?.id ?? null;
      const episodeId = state.activeEpisode?.id ?? null;
      if (
        activeContextRef.current.projectId === projectId
        && activeContextRef.current.episodeId === episodeId
      ) return;
      activeContextRef.current = {
        projectId,
        episodeId,
        sceneId: null,
        epoch: activeContextRef.current.epoch + 1,
      };
      requestEpochRef.current += 1;
      activeImportRequestIdRef.current = undefined;
      activeAudioRewriteRequestIdRef.current = undefined;
      setPromptRequest(null);
      setIsGeneratingImage(false);
      setIsGeneratingVideo(false);
      setIsGeneratingDraftImage(false);
      setIsImportingMedia(false);
      setIsEditingVideoAudio(false);
    });
    return unsubscribe;
  }, []);

  const captureAsyncContext = (projectId: string, episodeId: string, sceneId: string) => ({
    projectId,
    episodeId,
    sceneId,
    contextEpoch: activeContextRef.current.epoch,
  });

  const isAsyncContextCurrent = (request: ReturnType<typeof captureAsyncContext>) => {
    const context = activeContextRef.current;
    if (
      context.epoch !== request.contextEpoch
      || context.projectId !== request.projectId
      || context.episodeId !== request.episodeId
      || context.sceneId !== request.sceneId
    ) return false;
    const state = useProjectStore.getState();
    if (state.currentProject?.id !== request.projectId || state.activeEpisode?.id !== request.episodeId) return false;
    return resolveSceneReadModel(state.currentProject, state.activeEpisode).scenes
      .some((candidate) => candidate.id === request.sceneId);
  };

  const awaitPendingSceneWrites = async (request: ReturnType<typeof captureAsyncContext>) => {
    while (isAsyncContextCurrent(request)) {
      const pendingWrite = useProjectStore.getState()._updateSceneLock;
      if (pendingWrite) await pendingWrite;
      if (!isAsyncContextCurrent(request)) return false;
      if (useProjectStore.getState()._updateSceneLock === pendingWrite) return true;
    }
    return false;
  };
  const resumableShotVideoTasks = (scene?.shots || []).flatMap((shot) => (shot.takes || []).flatMap((take) => {
    const taskId = take.generationAudit?.videoTaskId;
    const status = take.generationAudit?.videoTaskStatus;
    const provider = take.generationAudit?.videoTaskProvider || "minimax_h3" as const;
    const requiresRefresh = status && (
      !videoTaskTerminal(status)
      || needsComfyUIArchiveRefresh(provider, status, take.videoUrl || take.videoMedia?.url)
    );
    return taskId && status && requiresRefresh ? [{
      shotId: shot.id,
      owner: "shot" as const,
      takeId: take.id,
      taskId,
      status,
      provider,
    }] : [];
  }));
  const resumableUnitVideoTasks = (scene?.manualStoryboard?.boards || [])
    .filter((workflow) => workflow.unitSchema === "storyboard_unit.v1")
    .flatMap((workflow) => (workflow.takes || []).flatMap((take) => {
      const taskId = take.generationAudit?.videoTaskId;
      const status = take.generationAudit?.videoTaskStatus;
      const provider = take.generationAudit?.videoTaskProvider || "minimax_h3" as const;
      const requiresRefresh = status && (
        !videoTaskTerminal(status)
        || needsComfyUIArchiveRefresh(provider, status, take.videoUrl || take.videoMedia?.url)
      );
      const videoGenerationUnitId = workflow.videoGenerationUnitId || workflow.board?.videoGenerationUnitId;
      return taskId && status && requiresRefresh && videoGenerationUnitId ? [{
        shotId: workflow.shotIds?.[0] || workflow.board?.shotIds?.[0] || workflow.shotId,
        owner: "unit" as const,
        videoGenerationUnitId,
        takeId: take.id,
        taskId,
        status,
        provider,
      }] : [];
    }));
  const resumableVideoTasks = [...resumableShotVideoTasks, ...resumableUnitVideoTasks];
  const resumableVideoTaskSignature = resumableVideoTasks
    .map((item) => `${item.owner}:${"videoGenerationUnitId" in item ? item.videoGenerationUnitId : item.shotId}:${item.takeId}:${item.taskId}:${item.status}:${item.provider}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!project || !episode || !scene || !resumableVideoTaskSignature) return;
    let disposed = false;
    const pollingContext = captureAsyncContext(project.id, episode.id, scene.id);
    const poll = async () => {
      for (const pending of resumableVideoTasks) {
        if (disposed || taskQueriesInFlight.current.has(pending.taskId)) continue;
        taskQueriesInFlight.current.add(pending.taskId);
        try {
          const task = await queryVideoGenerationTask(pending.taskId, pending.provider);
          if (disposed || !isAsyncContextCurrent(pollingContext)) return;
          if (!await awaitPendingSceneWrites(pollingContext)) return;
          if (disposed || !isAsyncContextCurrent(pollingContext)) return;
          const latestProject = useProjectStore.getState().currentProject;
          const latestEpisode = useProjectStore.getState().activeEpisode;
          if (latestProject?.id !== pollingContext.projectId || latestEpisode?.id !== pollingContext.episodeId) return;
          const latestScene = resolveSceneReadModel(latestProject, latestEpisode).scenes.find((item) => item.id === pollingContext.sceneId);
          const latestShot = latestScene?.shots?.find((item) => item.id === pending.shotId);
          const latestUnit = pending.owner === "unit"
            ? latestScene?.manualStoryboard?.boards?.find((workflow) => (
                workflow.unitSchema === "storyboard_unit.v1"
                && (workflow.videoGenerationUnitId === pending.videoGenerationUnitId
                  || workflow.board?.videoGenerationUnitId === pending.videoGenerationUnitId)
              ))
            : undefined;
          const latestTake = pending.owner === "unit"
            ? latestUnit?.takes?.find((item) => item.id === pending.takeId)
            : latestShot?.takes?.find((item) => item.id === pending.takeId);
          if (!latestScene?.shots || !latestShot || !latestTake?.generationAudit) continue;
          const succeeded = task.status === "succeeded" && Boolean(task.videoUrl);
          const failed = task.status === "failed" || task.status === "cancelled";
          const updatedAt = Date.now();
          const videoMedia = createMediaAssetReference({
            url: succeeded ? task.videoUrl : latestTake.videoMedia?.url,
            kind: "video",
            source: "ai_generation",
            status: succeeded ? "ready" : failed ? "failed" : "pending",
            generationJobId: task.id,
            modelId: latestTake.generationAudit.modelId,
            createdAt: latestTake.videoMedia?.createdAt || latestTake.createdAt,
            errorMessage: failed ? task.error || "视频生成失败。" : task.error,
            note: succeeded ? "原视频任务已完成。" : "继续查询原视频任务，不会自动重新提交。",
          });
          const nextTake = {
            ...latestTake,
            videoUrl: succeeded ? task.videoUrl : latestTake.videoUrl,
            videoMedia,
            generationAudit: {
              ...latestTake.generationAudit,
              videoProviderTaskId: task.providerTaskId || latestTake.generationAudit.videoProviderTaskId,
              videoTaskStatus: task.status,
              ...(succeeded && task.videoUrl ? {
                videoSegments: [{
                  url: task.videoUrl,
                  durationSeconds: latestTake.generationAudit.videoMotionContract?.durationSeconds
                    || latestTake.generationAudit.videoSegments?.[0]?.durationSeconds
                    || (pending.owner === "unit"
                      ? (latestUnit?.shotIds || latestUnit?.board?.shotIds || [latestUnit?.shotId])
                          .reduce((sum, shotId) => sum + Number(latestScene.shots?.find((shot) => shot.id === shotId)?.duration || 0), 0)
                      : Number(latestShot.duration || 0)),
                  startFrameUrl: latestTake.generationAudit.startFrameUrl,
                  endFrameUrl: latestTake.generationAudit.endFrameUrl,
                }],
              } : {}),
            },
          };
          if (pending.owner === "unit" && latestScene.manualStoryboard && latestUnit) {
            await useProjectStore.getState().updateScene(pollingContext.sceneId, {
              manualStoryboard: {
                ...latestScene.manualStoryboard,
                boards: (latestScene.manualStoryboard.boards || []).map((workflow) => workflow === latestUnit ? {
                  ...workflow,
                  takes: (workflow.takes || []).map((take) => take.id === pending.takeId ? nextTake : take),
                  updatedAt,
                } : workflow),
                updatedAt,
              },
            }, pollingContext.episodeId, {
              expectedProjectId: pollingContext.projectId,
              expectedEpisodeId: pollingContext.episodeId,
            });
          } else {
            await useProjectStore.getState().updateScene(pollingContext.sceneId, {
              shots: latestScene.shots.map((item) => item.id === latestShot.id ? {
                ...item,
                takes: (item.takes || []).map((take) => take.id === pending.takeId ? nextTake : take),
              } : item),
            }, pollingContext.episodeId, {
              expectedProjectId: pollingContext.projectId,
              expectedEpisodeId: pollingContext.episodeId,
            });
          }
          if (isAsyncContextCurrent(pollingContext)) {
            if (succeeded) toast.success("候选视频已生成完成");
            if (failed) toast.error(task.error || "候选视频生成失败，系统没有自动重提。");
          }
        } catch (error) {
          console.warn("Video task refresh failed:", summarizeUnknownError(error));
        } finally {
          taskQueriesInFlight.current.delete(pending.taskId);
        }
      }
    };
    void poll();
    const intervalId = window.setInterval(() => void poll(), 8000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [episode?.id, project?.id, resumableVideoTaskSignature, scene?.id]);

  const prepare = async (
    action: "image" | "video",
    target: ManualStudioGenerationTarget,
    videoPreparation?: ManualStudioVideoPreparation,
    draftPreview = false,
  ) => {
    if (!project || !episode || !scene || !assets) return;
    if (draftPreview && (action !== "image" || target.kind !== "shot")) {
      toast.error("方向预览只支持当前单个镜头。");
      return;
    }
    if (!draftPreview && !videoPreparation?.externalOnly && !generationReady) {
      toast.error(target.kind === "shot"
        ? "请先确认当前 Shot、视觉提示词与分镜 QA。"
        : "请先确认当前视频单元的完整故事板与 QA。");
      return;
    }
    const shot = scene.shots?.find((item) => item.id === target.shotId);
    if (!shot) return;
    const availableTargetAssetIds = new Set([
      ...(shot.characterIdsInShot || []),
      shot.locationId,
      ...(shot.propIds || []),
    ].filter(Boolean) as string[]);
    if (action === "image" && !draftPreview && availableTargetAssetIds.size > 0 && target.assetIds.length === 0) {
      toast.error("当前生成对象至少需要选择一个正式参考资产。");
      return;
    }
    const activeTake = shot.takes?.find((item) => item.id === shot.activeTakeId);
    const activeAudit = activeTake?.generationAudit;
    const activeTakeMatchesTarget = activeAudit?.targetKind === target.kind
      && activeAudit.shotId === target.shotId
      && (target.kind === "shot"
        ? true
        : target.kind === "storyboard_board"
          ? activeAudit.pageId === target.pageId
          : activeAudit.panelId === target.panelId)
      && [...(activeAudit.selectedAssetBoardItemIds || [])].sort().join("|") === [...(target.assetBoardItemIds || [])].sort().join("|");
    const automaticStartIsEnd = appearanceImageIsAfterChange(activeTake?.appearanceSnapshot || shot.appearance);
    if (action === 'video' && videoPreparation?.startFrameUrl && scene.shots.some(s => s.takes?.some(t => t.imageUrl === videoPreparation.startFrameUrl && appearanceImageIsAfterChange(t.appearanceSnapshot)))) {
      toast.error('所选首帧是状态变化后的画面，请改选变化前画面，或只将它用作尾帧。'); return;
    }
    const startingImageUrl = videoPreparation?.startFrameUrl
      || (activeTakeMatchesTarget && !automaticStartIsEnd ? activeTake?.imageUrl : undefined);
    const endFrameUrl = videoPreparation?.endFrameUrl;
    if (action === "video" && !videoPreparation?.externalOnly) {
      const durationPolicy = target.kind === "shot"
        ? evaluateStandaloneShotDuration(shot)
        : evaluateVideoUnitDuration(target.durationSeconds);
      if (!durationPolicy.valid) {
        toast.error(durationPolicy.reason || "当前生成对象时长不适合独立视频生成。");
        return;
      }
      if (endFrameUrl && endFrameUrl === startingImageUrl) {
        toast.error("首帧和尾帧不能使用同一张图片。");
        return;
      }
    }
    const draftPreviewReference = !draftPreview && action === "image"
      ? resolveShotDraftPreviewReference(shot, sourceHash)
      : null;
    const targetIds = new Set(target.assetIds);
    const targetBoardItemIds = new Set(target.assetBoardItemIds || []);
    const targetShots = (scene.shots || []).filter(item => (target.shotIds?.length ? target.shotIds : [shot.id]).includes(item.id));
    try {
      const context = await legacyProjectClient.getStoryboardTeamContext(project.id, episode.id, scene.id);
      requireAppearanceReady(project, scene, targetShots, appearanceSourceShots(episode, context.productionTeamContext), action);
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法读取外观状态'); return; }
    const boards = appearanceBoards(project, targetShots, assets.assetBoards.filter((item) => targetBoardItemIds.size
      ? targetBoardItemIds.has(item.boardItemId)
      : targetIds.has(item.assetId)), action);
    const projectionShotIds = new Set(target.shotIds?.length ? target.shotIds : [shot.id]);
    const projectionShots = (scene.shots || []).filter((item) => projectionShotIds.has(item.id));
    const visualProjectionContext = resolveImageVisualStyleProjectionContext({
      project,
      shots: projectionShots.length ? projectionShots : [shot],
      assetIds: target.assetIds,
    });
    let imageVisualStyleProjection: ImageVisualStyleProjection | undefined;
    let visualStyleCompileManifest: VisualCompileManifest | undefined;
    try {
      if (action === "image") {
        imageVisualStyleProjection = buildImageVisualStyleProjection({
          project,
          intent: resolveManualStudioImageVisualArtifactIntent(draftPreview),
          ...visualProjectionContext,
          shotOverride: resolveManualStudioTargetShotOverride(shot.visualOverride, target.shotIds),
          creativeScope: { episode, scene: { ...scene, shots: projectionShots.length ? projectionShots : [shot] }, shot: !target.shotIds || target.shotIds.length <= 1 ? shot : undefined },
        });
        visualStyleCompileManifest = imageVisualStyleProjection.compileManifest;
      } else {
        visualStyleCompileManifest = buildManualStudioProjectVisualStyleProjection(project, {
          targets: visualProjectionContext.targets,
          shotOverride: resolveManualStudioTargetShotOverride(shot.visualOverride, target.shotIds),
          creativeScope: { episode, scene: { ...scene, shots: projectionShots.length ? projectionShots : [shot] }, shot: !target.shotIds || target.shotIds.length <= 1 ? shot : undefined },
        }).rendered.manifest;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "项目视觉规范尚未达到正式生成条件。");
      return;
    }
    const storyboardReferenceUrl = resolveManualStudioStoryboardReferenceUrl(target);
    const imageReferences: PromptEditorImageReference[] = [
      ...(storyboardReferenceUrl ? [createImageGenerationReference({
        imageUrl: storyboardReferenceUrl,
        label: `${target.label} 的已确认故事板构图`,
        role: "composition_anchor",
      })] : []),
      ...boards.filter((item) => item.referenceImageUrl).map((item) => createImageGenerationReference({
        imageUrl: item.referenceImageUrl!,
        label: `${item.assetName}${item.variantName ? ` · ${item.variantName}` : ""}`,
        role: item.assetType === "character"
          ? item.variantId ? "wardrobe_state" : "character_identity"
          : item.assetType === "location" ? "location_design" : "prop_design",
      })),
      ...(draftPreviewReference?.imageUrl ? [createImageGenerationReference({
        imageUrl: draftPreviewReference.imageUrl,
        label: "同一镜头的方向预览",
        role: "composition_anchor",
      })] : []),
    ].map((reference, index) => ({
      ...reference,
      id: `manual-studio-ref-${index + 1}`,
    }));
    const duplicateReference = imageReferences.find((reference, index) =>
      imageReferences.findIndex((candidate) => candidate.imageUrl === reference.imageUrl) !== index);
    if (duplicateReference) {
      toast.error(`参考图“${duplicateReference.label}”与另一项资产共用同一图片，无法可靠声明两种职责。请先为各资产确认独立参考图。`);
      return;
    }
    const referenceImageUrls = imageReferences.map((reference) => reference.imageUrl);
    const config = useAIConfigStore.getState();
    const configuredRouteId = action === "image" ? config.routing.imageGen : config.routing.videoGen;
    const configuredModel = config.models.find((item) => item.id === configuredRouteId);
    const supportedVideoModels = action === "video" && !videoPreparation?.externalOnly ? config.models.filter((model) => {
      if (!model.capabilities.includes("video")) return false;
      return config.channels.some((item) => item.id === model.channelId);
    }) : [];
    const modelOptions: VideoGenerationPromptConfiguration["modelOptions"] = supportedVideoModels.map((model) => {
      const channel = config.channels.find((item) => item.id === model.channelId)!;
      const localH3 = channel.type === "comfyui"
        && model.modelId.toLowerCase() === MINIMAX_H3_MODEL_ID.toLowerCase();
      const h3 = localH3;
      const localWorkflow = localH3
        ? config.comfyWorkflows.find((workflow) => workflow.id === model.comfyWorkflowId)
        : undefined;
      const resolvedAdapter = resolveVideoModelAdapter({
        channelType: channel.type,
        modelId: model.modelId,
        configuredAdapterId: model.videoAdapterId,
      });
      const inferredH3Way = localH3 ? MINIMAX_H3_REF2VA_ADAPTER_ID : selectMiniMaxH3GenerationWay({
        startFrameUrl: startingImageUrl,
        endFrameUrl,
      });
      const configuredH3Way = h3 && model.minimaxH3Video
        ? miniMaxH3AdapterForGenerationMode(model.minimaxH3Video.defaultMode)
        : undefined;
      const compatibleAdapters = localH3
        ? [resolvedAdapter]
        : listCompatibleVideoModelAdapters({ channelType: channel.type, modelId: model.modelId });
      const generationWayAdapters = compatibleAdapters.length ? compatibleAdapters : [resolvedAdapter];
      const resolutionOptions = localH3
        ? []
        : Array.from(new Set(generationWayAdapters.flatMap((adapter) => adapter.limits.resolutions)));
      const capabilityAudioModeOptions = videoAudioModeOptionsForCapabilities({
        nativeAudio: generationWayAdapters.some(adapter => adapter.capabilities.nativeAudio),
        referenceAudios: generationWayAdapters.some(adapter => adapter.capabilities.referenceAudios),
      });
      const audioModeOptions = localH3
        ? videoAudioModeOptionsForCapabilities(resolvedAdapter.capabilities, false)
        : capabilityAudioModeOptions;
      const configuredResolution = model.videoGenerationDefaults?.resolution
        || model.minimaxH3Video?.resolution
        || model.kieGrokVideo?.resolution;
      const configuredAudioMode = model.videoGenerationDefaults?.audioMode
        || model.minimaxH3Video?.audioMode
        || "post_dub";
      return {
        id: model.id,
        label: model.alias,
        generationWays: generationWayAdapters.map((adapter) => ({
          id: adapter.id,
          label: adapter.modes[0]?.displayName || adapter.displayName,
          audioModeOptions: videoAudioModeOptionsForCapabilities(adapter.capabilities, !localH3),
        })),
        resolutionOptions,
        sizeLabel: localH3 ? `画面大小 ${localWorkflow?.minimaxH3Reference?.megapixels || 0.5} MP` : undefined,
        audioModeOptions,
        defaultGenerationWayId: h3
          ? generationWayAdapters.some((adapter) => adapter.id === configuredH3Way)
            ? configuredH3Way
            : generationWayAdapters.some((adapter) => adapter.id === inferredH3Way)
              ? inferredH3Way
              : generationWayAdapters[0]?.id
          : resolvedAdapter.id,
        defaultResolution: configuredResolution && resolutionOptions.includes(configuredResolution)
          ? configuredResolution
          : resolutionOptions[0],
        defaultAudioMode: audioModeOptions.some((option) => option.id === configuredAudioMode)
          ? configuredAudioMode
          : audioModeOptions[0]?.id || "post_dub",
        supportsModelPromptOptimization: h3,
      };
    });
    const preferredVideoModelId = [target.targetVideoModelConfigId, config.routing.videoGen, modelOptions[0]?.id]
      .find((id) => id && modelOptions.some((option) => option.id === id)) || "";
    const preferredVideoOption = modelOptions.find((option) => option.id === preferredVideoModelId);
    const compileVideoSelection = (input: {
      modelConfigId: string;
      generationWayId: string;
      resolution?: string;
      audioMode: "provider_native" | "reuse_dialogue" | "post_dub";
      creativePrompt: string;
    }) => {
      const selectedModel = config.models.find((model) => model.id === input.modelConfigId);
      const selectedChannel = config.channels.find((channel) => channel.id === selectedModel?.channelId);
      if (!selectedModel || !selectedChannel) return undefined;
      const adapter = resolveVideoModelAdapter({
        channelType: selectedChannel.type,
        modelId: selectedModel.modelId,
        configuredAdapterId: input.generationWayId,
      });
      if (!videoAudioModeOptionsForCapabilities(adapter.capabilities, selectedChannel.type !== 'comfyui').some(option => option.id === input.audioMode)) {
        throw new Error('当前生成方式不支持所选声音策略。参考音频需选择支持该能力的模型；已有录音可以保留用于后期配音。');
      }
      const intent = buildManualStudioVideoIntent({
        project,
        episode,
        scene,
        shot,
        target,
        boards,
        adapterId: adapter.id,
        generationMode: adapter.modes[0]?.id,
        referenceCapabilities: {
          images: adapter.capabilities.referenceImages,
          videos: adapter.capabilities.referenceVideos,
          audios: adapter.capabilities.referenceAudios,
        },
        audioMode: input.audioMode,
        startFrameUrl: startingImageUrl,
        endFrameUrl,
        directorIntent: input.creativePrompt,
        sourceHash,
        visualProjectionTargets: visualProjectionContext.targets,
      });
      const previewIntent = selectedChannel.type === "comfyui" ? prepareComfyUIH3Intent(intent) : intent;
      const plan = adapter.compile({
        intent: previewIntent,
        modelConfigId: selectedModel.id,
        mode: isMiniMaxH3AdapterId(adapter.id) ? undefined : selectedModel.videoGenerationDefaults?.mode,
        resolution: input.resolution,
      });
      return {
        selectedModel,
        selectedChannel,
        adapter,
        intent: previewIntent,
        plan,
        detail: {
          ...videoPromptDetail(plan, project),
          visualStyleCompileManifest: previewIntent.visualStyleCompileManifest,
        },
      };
    };
    const videoGeneration: VideoGenerationPromptConfiguration | undefined = action === "video" && preferredVideoOption ? {
      selectionLocked: true,
      modelOptions,
      selectedModelConfigId: preferredVideoOption.id,
      selectedGenerationWayId: preferredVideoOption.generationWays.some((way) => way.id === videoPreparation?.generationWayId)
        ? videoPreparation!.generationWayId!
        : preferredVideoOption.defaultGenerationWayId || preferredVideoOption.generationWays[0]?.id || "",
      selectedResolution: preferredVideoOption.defaultResolution || preferredVideoOption.resolutionOptions[0],
      selectedAudioMode: preferredVideoOption.defaultAudioMode || "provider_native",
      buildPreview: (input) => {
        const compiled = compileVideoSelection(input);
        if (!compiled) {
          return {
            modelPrompt: "",
            references: [],
            timeline: [],
            issues: [{ severity: "blocking", message: "没有找到本次选择的视频模型。" }],
            requestSummary: "视频模型不可用",
            nativeAudioExpected: false,
          };
        }
        const detail = compiled.detail;
        if (compiled.adapter.id === MINIMAX_H3_REF2VA_ADAPTER_ID && endFrameUrl) {
          detail.issues.push({ severity: "warning", message: "参考多份素材方式不会发送所选尾帧；如需严格落在尾帧，请改用严格首帧/首尾画面。" });
        }
        return detail;
      },
      optimizeModelPrompt: async (input) => {
        const compiled = compileVideoSelection(input);
        if (!compiled || !isMiniMaxH3AdapterId(compiled.adapter.id)) {
          throw new Error("当前视频模型不使用 MiniMax H3 提示词整理规则。");
        }
        const liveConfig = useAIConfigStore.getState();
        const authoringModel = liveConfig.models.find((model) => model.id === liveConfig.routing.storyboardGen);
        if (!authoringModel || !authoringModel.capabilities.includes("text")) {
          throw new Error("请先在设置页的任务路由中，为“分镜生成”选择一个文本模型。");
        }
        const request = buildMiniMaxH3PromptAuthoringRequest({
          baselinePrompt: compiled.plan.adapterPrompt,
          currentPrompt: input.currentModelPrompt,
          creativePrompt: input.creativePrompt,
          userIntent: input.userIntent,
          references: input.preview.references,
          timeline: input.preview.timeline,
        });
        let raw: string;
        try {
          raw = await generateAIContent({
            ...request,
            taskType: "storyboardGen",
            requireJson: true,
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`大模型未能整理 H3 提示词：${detail}`);
        }
        const result = parseMiniMaxH3PromptAuthoringResult(raw, compiled.plan);
        return {
          ...result,
          modelLabel: authoringModel.alias,
        };
      },
    } : undefined;
    const externalIntent = videoPreparation?.externalOnly ? buildManualStudioVideoIntent({
      project, episode, scene, shot, target, boards, adapterId: "external", generationMode: "multimodal_reference",
      referenceCapabilities: { images: true, videos: true, audios: true }, audioMode: "provider_native",
      startFrameUrl: startingImageUrl, endFrameUrl, directorIntent: target.videoPrompt, sourceHash,
      visualProjectionTargets: visualProjectionContext.targets,
    }) : undefined;
    if (action === "video" && !videoGeneration && !videoPreparation?.externalOnly) {
      if (!startingImageUrl) {
        toast.error("当前默认视频模型仍使用旧首帧流程，请先生成并采用当前视频单元的首帧图片。");
        return;
      }
      if (endFrameUrl && (!configuredModel || !/(?:^|\/)veo-3\.1(?:-|$)/i.test(configuredModel.modelId))) {
        toast.error("当前默认视频模型不支持首尾帧，请取消尾帧后再生成。");
        return;
      }
    }
    setPromptRequest({
      action,
      target,
      appearanceHash: manualStoryboardHash(targetShots.map(s => s.appearance)),
      externalOnly: videoPreparation?.externalOnly,
      externalIntent,
      externalReferences: externalIntent?.referenceBindings.map(binding => ({ url: binding.mediaUrl, label: binding.displayName || binding.id })),
      sourceHash,
      templateId: action === "image" ? "generateImage" : "generateVideo",
      variables: action === "image" ? {
        imagePrompt: [target.imagePrompt, ...targetShots.map(s => appearancePrompt(s, "image"))].filter(Boolean).join("\n\n"),
      } : {
        videoPrompt: [externalIntent ? externalVideoPrompt(externalIntent, scene.script || "") : target.videoPrompt, ...targetShots.map(s => appearancePrompt(s, "video"))].filter(Boolean).join("\n\n"),
      },
      contextOptions: [],
      defaultSelectedContextIds: [],
      referenceImageUrls,
      imageReferences,
      imageVisualStyleProjection,
      visualStyleCompileManifest,
      startFrameTakeId: videoPreparation?.startFrameTakeId,
      startFrameUrl: startingImageUrl,
      endFrameTakeId: videoPreparation?.endFrameTakeId,
      endFrameUrl,
      videoGeneration,
      draftPreview,
      draftPreviewReference: draftPreviewReference || undefined,
    });
  };

  const execute = async (finalPrompt: string, userIntent?: string, metadata?: PromptEditorConfirmMetadata) => {
    if (!promptRequest) return;
    if (!project || !episode || !scene || !assets) throw new Error("当前制作上下文已不存在，请重新打开生成面板。");
    if ((!promptRequest.draftPreview && !promptRequest.externalOnly && !generationReady) || (!promptRequest.draftPreview && promptRequest.sourceHash !== sourceHash)) {
      throw new Error("故事板或正式资产来源有更新，请重新复核后再生成。");
    }
    const request = promptRequest;
    const requestEpoch = ++requestEpochRef.current;
    const requestedProjectId = project.id;
    const requestedEpisodeId = episode.id;
    const requestedSceneId = scene.id;
    const requestContext = captureAsyncContext(requestedProjectId, requestedEpisodeId, requestedSceneId);
    if (!isAsyncContextCurrent(requestContext)) return;
    const isImage = request.action === "image";
    let latestProject = useProjectStore.getState().currentProject;
    let latestEpisode = useProjectStore.getState().activeEpisode;
    let latestScene = resolveSceneReadModel(latestProject, latestEpisode).scenes.find((item) => item.id === requestedSceneId);
    let latestShot = latestScene?.shots?.find((item) => item.id === request.target.shotId);
    if (!latestProject || !latestEpisode || !latestScene?.shots || !latestShot) {
      throw new Error("当前 Shot 已不存在，请重新选择生成对象。");
    }
    const requestedSourceFingerprint = manualStudioTargetSourceFingerprint(latestScene, request.target);
    const projectionShotIds = new Set(request.target.shotIds?.length
      ? request.target.shotIds
      : [latestShot.id]);
    const projectionShots = latestScene.shots.filter((item) => projectionShotIds.has(item.id));
    const visualProjectionContext = resolveImageVisualStyleProjectionContext({
      project: latestProject,
      shots: projectionShots.length ? projectionShots : [latestShot],
      assetIds: request.target.assetIds,
    });
    if (request.appearanceHash && request.appearanceHash !== manualStoryboardHash(projectionShots.map(s => s.appearance))) throw new Error("外观状态已修改，请重新打开生成面板核对提示词和参考图。");
    const appearanceContext = await legacyProjectClient.getStoryboardTeamContext(latestProject.id, latestEpisode.id, latestScene.id);
    try { requireAppearanceReady(latestProject, latestScene, projectionShots, appearanceSourceShots(latestEpisode, appearanceContext.productionTeamContext), isImage ? 'image' : 'video'); }
    catch (error) { throw error; }
    const visualProjectionTargets = visualProjectionContext.targets;
    const currentImageVisualStyleProjection = isImage
      ? buildImageVisualStyleProjection({
          project: latestProject,
          intent: resolveManualStudioImageVisualArtifactIntent(request.draftPreview),
          ...visualProjectionContext,
          shotOverride: resolveManualStudioTargetShotOverride(latestShot.visualOverride, request.target.shotIds),
          creativeScope: { episode: latestEpisode, scene: { ...latestScene, shots: projectionShots.length ? projectionShots : [latestShot] }, shot: !request.target.shotIds || request.target.shotIds.length <= 1 ? latestShot : undefined },
        })
      : undefined;
    const currentVisualStyleCompileManifest = isImage
      ? currentImageVisualStyleProjection?.compileManifest
      : buildManualStudioProjectVisualStyleProjection(latestProject, {
          targets: visualProjectionTargets,
          shotOverride: resolveManualStudioTargetShotOverride(latestShot.visualOverride, request.target.shotIds),
          creativeScope: { episode: latestEpisode, scene: { ...latestScene, shots: projectionShots.length ? projectionShots : [latestShot] }, shot: !request.target.shotIds || request.target.shotIds.length <= 1 ? latestShot : undefined },
        }).rendered.manifest;
    const confirmedVisualStyleCompileManifest = isImage
      ? metadata?.visualStyleProjection?.compileManifest || request.visualStyleCompileManifest
      : metadata?.videoGeneration?.visualStyleCompileManifest || request.visualStyleCompileManifest;
    if (!currentVisualStyleCompileManifest
      || !confirmedVisualStyleCompileManifest
      || manualStoryboardHash(confirmedVisualStyleCompileManifest) !== manualStoryboardHash(currentVisualStyleCompileManifest)) {
      throw new Error("项目视觉规范来源有更新，本次不会按未复核的新规范生成；请关闭后重新打开提示词确认。");
    }
    if (request.draftPreview) setIsGeneratingDraftImage(true);
    else if (isImage) setIsGeneratingImage(true);
    else setIsGeneratingVideo(true);
    try {
      const now = Date.now();
      let activeTake = latestShot.takes?.find((item) => item.id === latestShot.activeTakeId);
      const visualScenario = latestScene.interactiveMetadata?.visualScenarios?.find(
        (scenario) => scenario.id === latestScene.interactiveMetadata?.activeVisualScenarioId,
      ) || latestScene.interactiveMetadata?.visualScenarios?.[0];
      const activeAudit = activeTake?.generationAudit;
      const activeTakeMatchesTarget = activeAudit?.targetKind === request.target.kind
        && activeAudit.shotId === request.target.shotId
        && (request.target.kind === "shot"
          ? true
          : request.target.kind === "storyboard_board"
            ? activeAudit.pageId === request.target.pageId
            : activeAudit.panelId === request.target.panelId)
        && [...(activeAudit.selectedAssetBoardItemIds || [])].sort().join("|") === [...(request.target.assetBoardItemIds || [])].sort().join("|")
        && (!visualScenario || activeAudit.visualReuseFingerprint === visualScenario.reuseFingerprint);
      const startingImageUrl = isImage
        ? latestShot.imageUrl
        : request.startFrameUrl || (activeTakeMatchesTarget ? activeTake?.imageUrl : undefined);
      const selectedImageReferences = isImage && metadata?.selectedImageReferenceIds
        ? request.imageReferences.filter((reference) => metadata.selectedImageReferenceIds?.includes(reference.id))
        : request.imageReferences;
      const compressedReferences = isImage && selectedImageReferences.length
        ? await Promise.all(selectedImageReferences.map(async (reference) => ({
            ...reference,
            imageUrl: await compressReferenceImage(reference.imageUrl),
          })))
        : undefined;
      if (requestEpochRef.current !== requestEpoch || !isAsyncContextCurrent(requestContext)) return;
      let providerPromptAudit: VideoProviderPromptAudit | undefined;
      const providerPromptAudits: VideoProviderPromptAudit[] = [];
      const videoMotionContract: VideoMotionContract | undefined = isImage ? undefined : {
        cameraMotion: latestShot.cameraMovement,
        subjectMotion: latestShot.visualAction || latestShot.blocking,
        durationSeconds: request.target.durationSeconds,
        loop: /互动待机|循环待机|loop(?:able|ing)?\s+idle/i.test(request.target.videoPrompt),
      };
      let generatedUrl: string | undefined;
      let videoSegments: ManualStudioTakeAudit["videoSegments"];
      let adapterPlan: VideoGenerationAdapterPlan | undefined;
      let videoIntent: VideoGenerationIntent | undefined;
      let videoVisualStyleCompileManifest: ManualStudioTakeAudit["visualStyleCompileManifest"];
      let videoTask: VideoGenerationTask | undefined;
      let videoCandidateIndex: number | undefined;
      let videoIdempotencyKey: string | undefined;
      let compiledImageRequest: CompiledImageGenerationRequest | undefined;
      const configState = useAIConfigStore.getState();
      const selectedVideo = !isImage && request.videoGeneration ? metadata?.videoGeneration : undefined;
      const modelId = isImage ? configState.routing.imageGen : selectedVideo?.modelConfigId || configState.routing.videoGen;
      if (request.externalOnly) {
        generatedUrl = await resolveManualAIRequest({ kind: "video", prompt: finalPrompt, references: request.externalReferences }, review => { finalPrompt = [review.systemInstruction, review.prompt].filter(Boolean).join("\n\n").trim(); });
        if (!generatedUrl) throw new Error("请上传外部生成的视频；外部制作不会调用模型接口。");
        videoIntent = request.externalIntent ? { ...request.externalIntent, directorIntent: finalPrompt } : undefined;
      } else if (isImage) {
        generatedUrl = await generateAIImage({
          promptCore: finalPrompt,
          aspectRatio: latestProject.aspectRatio as any || "16:9",
          references: compressedReferences,
          visualStyleProjection: currentImageVisualStyleProjection,
          visualRecipeInputEvidence: buildShotImageVisualRecipeInputEvidence({
            project: latestProject,
            shots: [latestShot],
          }),
          onPromptCompiled: (compiled) => {
            compiledImageRequest = compiled;
          },
        });
      } else if (selectedVideo) {
        const configuredModel = configState.models.find((item) => item.id === selectedVideo.modelConfigId);
        const configuredChannel = configState.channels.find((item) => item.id === configuredModel?.channelId);
        if (!configuredModel || !configuredChannel) throw new Error("本次选择的视频模型已经不存在，请重新选择。");
        const adapter = resolveVideoModelAdapter({
          channelType: configuredChannel.type,
          modelId: configuredModel.modelId,
          configuredAdapterId: selectedVideo.generationWayId,
        });
        if (!videoAudioModeOptionsForCapabilities(adapter.capabilities, configuredChannel.type !== 'comfyui').some(option => option.id === selectedVideo.audioMode)) {
          throw new Error('当前视频生成方式不支持所选声音策略，请重新选择；已有录音可用于后期配音。');
        }
        const modeContract = adapter.modes[0];
        if (modeContract?.requiresStartFrame && !startingImageUrl) {
          throw new Error("当前生成方式需要先生成并采用这个视频单元的首帧图片。");
        }
        if (modeContract?.requiresEndFrame && !request.endFrameUrl) {
          throw new Error("当前生成方式需要选择一张已采用的尾帧图片。");
        }
        const targetBoardItemIds = new Set(request.target.assetBoardItemIds || []);
        const targetAssetIds = new Set(request.target.assetIds || []);
        const intentBoards = appearanceBoards(latestProject, projectionShots, assets.assetBoards.filter((board) => targetBoardItemIds.size
          ? targetBoardItemIds.has(board.boardItemId)
          : targetAssetIds.has(board.assetId)), 'video');
        const builtVideoIntent = buildManualStudioVideoIntent({
          project: latestProject,
          episode: latestEpisode,
          scene: latestScene,
          shot: latestShot,
          target: request.target,
          boards: intentBoards,
          adapterId: adapter.id,
          generationMode: adapter.modes[0]?.id,
          referenceCapabilities: {
            images: adapter.capabilities.referenceImages,
            videos: adapter.capabilities.referenceVideos,
            audios: adapter.capabilities.referenceAudios,
          },
          audioMode: selectedVideo.audioMode,
          startFrameUrl: startingImageUrl,
          endFrameUrl: request.endFrameUrl,
          directorIntent: finalPrompt,
          sourceHash: request.sourceHash,
          visualProjectionTargets,
        });
        videoIntent = configuredChannel.type === "comfyui"
          ? prepareComfyUIH3Intent(builtVideoIntent)
          : builtVideoIntent;
        const latestUnit = request.target.kind === "storyboard_board"
          ? latestScene.manualStoryboard?.boards?.find((workflow) => (
              workflow.unitSchema === "storyboard_unit.v1"
              && (workflow.videoGenerationUnitId === request.target.videoGenerationUnitId
                || workflow.board?.videoGenerationUnitId === request.target.videoGenerationUnitId
                || workflow.boardId === request.target.boardId
                || workflow.board?.id === request.target.boardId)
            ))
          : undefined;
        if (request.target.kind === "storyboard_board" && !latestUnit) {
          throw new Error("当前持久化故事板单元已不存在。");
        }
        const priorCandidates = (latestUnit?.takes || latestShot.takes || []).filter((take) => (
          take.generationAudit?.action === "generate_video"
          && take.generationAudit.sourceHash === request.sourceHash
          && take.generationAudit.modelId === configuredModel.id
          && take.generationAudit.videoAdapterId === adapter.id
        ));
        videoCandidateIndex = Math.max(0, ...priorCandidates.map((take) => take.generationAudit?.videoCandidateIndex || 0)) + 1;
        videoIdempotencyKey = `studio-video-${manualStoryboardHash({
          projectId: latestProject.id,
          episodeId: latestEpisode.id,
          sceneId: latestScene.id,
          videoGenerationUnitId: videoIntent.videoGenerationUnitId,
          sourceHash: videoIntent.sourceHash,
          modelConfigId: configuredModel.id,
          adapterId: adapter.id,
          adapterVersion: adapter.version,
          finalPromptHash: manualStoryboardHash(selectedVideo.finalModelPrompt),
          references: videoIntent.referenceBindings.map((binding) => [
            binding.id,
            binding.sourceType,
            binding.sourceAssetId,
            binding.contentHash,
            binding.mediaUrl,
          ]),
          durationSeconds: videoIntent.durationSeconds,
          aspectRatio: videoIntent.aspectRatio,
          resolution: selectedVideo.resolution,
          audioPolicy: videoIntent.audioPolicy,
          interactiveContext: videoIntent.interactiveContext,
          attemptKind: priorCandidates.length > 0 ? "new_candidate" : "initial",
          candidateIndex: videoCandidateIndex,
        })}`;
        const result = await generateVideoFromIntent({
          intent: videoIntent,
          modelConfigId: configuredModel.id,
          adapterId: adapter.id,
          mode: miniMaxH3GenerationModeForAdapter(adapter.id),
          resolution: selectedVideo.resolution,
          finalConfirmedPrompt: selectedVideo.finalModelPrompt,
          idempotencyKey: videoIdempotencyKey,
          audit: { candidateIndex: videoCandidateIndex },
        });
        adapterPlan = result.adapterPlan;
        if (result.kind === "completed") {
          generatedUrl = result.videoUrl;
          videoSegments = [{
            url: result.videoUrl,
            durationSeconds: request.target.durationSeconds,
            startFrameUrl: startingImageUrl,
            endFrameUrl: request.endFrameUrl,
          }];
        } else {
          videoTask = result.task;
          generatedUrl = result.task.status === "succeeded" ? result.task.videoUrl : undefined;
          if (generatedUrl) videoSegments = [{
            url: generatedUrl,
            durationSeconds: request.target.durationSeconds,
            startFrameUrl: startingImageUrl,
            endFrameUrl: request.endFrameUrl,
          }];
        }
      } else {
        if (!startingImageUrl) throw new Error("当前生成对象缺少已选择的首帧图片。");
        const visualStyle = buildManualStudioProjectVisualStyleProjection(latestProject, {
          targets: visualProjectionTargets,
          shotOverride: resolveManualStudioTargetShotOverride(latestShot.visualOverride, request.target.shotIds),
          creativeScope: { episode: latestEpisode, scene: { ...latestScene, shots: projectionShots.length ? projectionShots : [latestShot] }, shot: !request.target.shotIds || request.target.shotIds.length <= 1 ? latestShot : undefined },
        });
        videoVisualStyleCompileManifest = visualStyle.rendered.manifest;
        const providerVideoPrompt = [
          request.target.videoPrompt.trim(),
          userIntent?.trim() ? `【作者补充要求】${userIntent.trim()}` : "",
          visualStyle.rendered.instruction,
        ].filter(Boolean).join("\n");
        const configuredModel = configState.models.find((item) => item.id === configState.routing.videoGen);
        const configuredChannel = configState.channels.find((item) => item.id === configuredModel?.channelId);
        const providerMaximum = configuredChannel?.type === "kie" && configuredModel && isKieGrokVideoModelId(configuredModel.modelId)
          ? KIE_GROK_VIDEO_MAX_DURATION_SECONDS
          : request.target.durationSeconds;
        if (request.target.durationSeconds > providerMaximum) {
          const requiredShots = Math.ceil(request.target.durationSeconds / providerMaximum);
          throw new Error(`当前镜头需要先拆成 ${requiredShots} 个内容不同的短镜头，已阻止自动重复付费生成。`);
        }
        const providerAspectRatio = project.aspectRatio === "9:16" ? "9:16" : "16:9";
        generatedUrl = await generateAIVideo({
          prompt: providerVideoPrompt,
          imageUrl: startingImageUrl!,
          durationSeconds: request.target.durationSeconds,
          endImageUrl: request.endFrameUrl,
          aspectRatio: providerAspectRatio,
          motionContract: videoMotionContract,
          visualStyleCompileManifest: visualStyle.rendered.manifest,
          onProviderPromptPrepared: (audit) => {
            providerPromptAudit = audit;
            providerPromptAudits.push(audit);
          },
        });
        videoSegments = [{
          url: generatedUrl,
          durationSeconds: request.target.durationSeconds,
          startFrameUrl: startingImageUrl!,
          endFrameUrl: request.endFrameUrl,
        }];
      }
      if (isAsyncContextCurrent(requestContext)) await awaitPendingSceneWrites(requestContext);
      const currentProject = useProjectStore.getState().currentProject?.id === requestedProjectId
        ? useProjectStore.getState().currentProject! : latestProject;
      const currentEpisode = await legacyProjectClient.getEpisode(requestedProjectId, requestedEpisodeId);
      if (!currentEpisode) throw new Error("原剧集已删除，生成素材仍保留在磁盘中");
      const currentScene = resolveSceneReadModel(currentProject, currentEpisode).scenes.find((item) => item.id === requestedSceneId);
      const currentShot = currentScene?.shots?.find((item) => item.id === request.target.shotId);
      if (!currentScene?.shots || !currentShot) {
        throw new Error("生成期间目标 Shot 已被删除，结果未写入其他对象。");
      }
      const sourceReviewReasons: NonNullable<ManualStudioTakeAudit["sourceReview"]>["reasons"] = [];
      if (manualStudioTargetSourceFingerprint(currentScene, request.target) !== requestedSourceFingerprint) {
        sourceReviewReasons.push("project_source_updated");
      }
      const refreshedProjectionShotIds = new Set(request.target.shotIds?.length
        ? request.target.shotIds
        : [currentShot.id]);
      const refreshedProjectionShots = currentScene.shots.filter((item) => refreshedProjectionShotIds.has(item.id));
      const refreshedProjectionContext = resolveImageVisualStyleProjectionContext({
        project: currentProject,
        shots: refreshedProjectionShots.length ? refreshedProjectionShots : [currentShot],
        assetIds: request.target.assetIds,
      });
      const refreshedVisualStyleCompileManifest = isImage
        ? buildImageVisualStyleProjection({
            project: currentProject,
            intent: resolveManualStudioImageVisualArtifactIntent(request.draftPreview),
            ...refreshedProjectionContext,
            shotOverride: resolveManualStudioTargetShotOverride(currentShot.visualOverride, request.target.shotIds),
            creativeScope: { episode: currentEpisode, scene: { ...currentScene, shots: refreshedProjectionShots.length ? refreshedProjectionShots : [currentShot] }, shot: !request.target.shotIds || request.target.shotIds.length <= 1 ? currentShot : undefined },
          }).compileManifest
        : buildManualStudioProjectVisualStyleProjection(currentProject, {
            targets: refreshedProjectionContext.targets,
            shotOverride: resolveManualStudioTargetShotOverride(currentShot.visualOverride, request.target.shotIds),
            creativeScope: { episode: currentEpisode, scene: { ...currentScene, shots: refreshedProjectionShots.length ? refreshedProjectionShots : [currentShot] }, shot: !request.target.shotIds || request.target.shotIds.length <= 1 ? currentShot : undefined },
          }).rendered.manifest;
      if (manualStoryboardHash(refreshedVisualStyleCompileManifest) !== manualStoryboardHash(confirmedVisualStyleCompileManifest)) {
        sourceReviewReasons.push("visual_style_updated");
      }
      latestProject = currentProject;
      latestEpisode = currentEpisode;
      latestScene = currentScene;
      latestShot = currentShot;
      activeTake = latestShot.takes?.find((item) => item.id === latestShot.activeTakeId);
      const audit: ManualStudioTakeAudit = {
        action: isImage ? "generate_image" : "generate_video",
        timeline: !isImage ? videoIntent?.timelineBeats.map(({ shotId, startSeconds, endSeconds }) => ({ shotId, startSeconds, endSeconds })) : undefined,
        targetKind: request.target.kind,
        shotId: request.target.shotId,
        boardId: request.target.boardId,
        panelId: request.target.panelId,
        pageId: request.target.pageId,
        storyboardVisualTakeId: request.target.storyboardVisualTakeId,
        sourceHash: request.sourceHash,
        sourceReview: {
          status: sourceReviewReasons.length ? "review_recommended" : "current",
          reasons: sourceReviewReasons,
          detectedAt: Date.now(),
        },
        authorPrompt: finalPrompt,
        upstreamPromptSourceKind: request.target.upstreamPromptSourceKind,
        upstreamPromptSourceId: request.target.upstreamPromptSourceId,
        upstreamPromptHash: request.target.upstreamPromptHash,
        finalProviderPrompt: compiledImageRequest?.providerPrompt || adapterPlan?.finalConfirmedPrompt || (providerPromptAudits.length > 1
          ? providerPromptAudits.map((item, index) => `【片段 ${index + 1}】${item.finalProviderPrompt}`).join("\n\n")
          : providerPromptAudit?.finalProviderPrompt || finalPrompt),
        promptHash: manualStoryboardHash(finalPrompt),
        providerPromptHash: manualStoryboardHash(compiledImageRequest?.providerPrompt || adapterPlan?.finalConfirmedPrompt || providerPromptAudit?.finalProviderPrompt || finalPrompt),
        modelPromptSource: selectedVideo?.modelPromptSource,
        promptAuthoringModelLabel: selectedVideo?.promptAuthoringModelLabel,
        draftPreviewReference: request.draftPreviewReference,
        providerType: providerPromptAudit?.providerType,
        visualPromptLanguagePolicy: providerPromptAudit?.profile.policy,
        videoMotionContract,
        providerNativeVideoOptions: providerPromptAudit?.nativeOptions,
        videoAdapterId: adapterPlan?.adapterId,
        videoAdapterVersion: adapterPlan?.adapterVersion,
        videoGenerationMode: adapterPlan?.mode,
        videoResolution: adapterPlan?.resolution,
        videoTaskId: videoTask?.id,
        videoTaskProvider: videoTask?.provider,
        videoProviderTaskId: videoTask?.providerTaskId,
        videoTaskStatus: videoTask?.status,
        videoIdempotencyKey,
        videoCandidateIndex,
        referenceManifest: adapterPlan?.referenceManifest.map((entry) => ({
          bindingId: entry.bindingId,
          providerLabel: entry.providerLabel,
          mediaKind: entry.mediaKind,
          sourceAssetId: entry.sourceAssetId,
          semanticEntityId: entry.semanticEntityId,
          displayName: entry.displayName,
          purpose: entry.purpose,
          mediaUrl: entry.mediaUrl,
          mediaDurationSeconds: entry.mediaDurationSeconds,
        })),
        imageReferenceManifest: compiledImageRequest?.references.map((reference, index) => ({
          index: index + 1,
          imageUrl: reference.imageUrl,
          label: reference.label,
          role: reference.role,
          preserve: reference.preserve,
          allowChange: reference.allowChange,
          exclude: reference.exclude,
        })),
        promptCompositionManifest: compiledImageRequest?.manifest || providerPromptAudit?.manifest,
        visualStyleCompileManifest: isImage
          ? compiledImageRequest?.visualStyleProjection?.compileManifest
          : adapterPlan?.visualStyleCompileManifest
            || providerPromptAudit?.visualStyleCompileManifest
            || videoIntent?.visualStyleCompileManifest
            || videoVisualStyleCompileManifest,
        audioProvenance: videoIntent
          ? audioProvenanceFor(
              videoIntent,
              request.externalOnly ? manualAIMediaHasAudio(generatedUrl!) : videoTask?.embeddedAudio ?? Boolean(adapterPlan?.requestPreview.nativeAudioExpected),
            )
          : undefined,
        interactiveVideoContext: videoIntent?.interactiveContext ? {
          graphVersionId: videoIntent.interactiveContext.graphVersionId,
          nodeId: videoIntent.interactiveContext.nodeId,
          contentSlot: videoIntent.interactiveContext.contentSlot,
          visualScenarioId: videoIntent.interactiveContext.visualScenarioId,
          visualStateFingerprint: videoIntent.interactiveContext.visualStateFingerprint,
          visualReuseFingerprint: videoIntent.interactiveContext.visualReuseFingerprint,
        } : undefined,
        videoSegments,
        modelId,
        selectedSkillIds: metadata?.selectedSkillIds || [],
        selectedSkillTitles: metadata?.selectedSkillTitles || [],
        selectedContextIds: metadata?.selectedContextIds || [],
        selectedAssetIds: isImage
          ? request.target.assetIds
          : Array.from(new Set(adapterPlan?.referenceManifest
            .filter((entry) => entry.bindingId.startsWith("board-"))
            .map((entry) => entry.sourceAssetId) || [])),
        selectedAssetBoardItemIds: isImage
          ? request.target.assetBoardItemIds
          : adapterPlan?.referenceManifest
            .filter((entry) => entry.bindingId.startsWith("board-"))
            .map((entry) => entry.bindingId.slice("board-".length)) || [],
        referenceImageUrls: isImage
          ? compiledImageRequest?.referenceImages || request.referenceImageUrls
          : adapterPlan?.referenceManifest.filter((entry) => entry.mediaKind === "image").map((entry) => entry.mediaUrl)
            || [startingImageUrl, ...request.referenceImageUrls].filter(Boolean) as string[],
        startFrameUrl: isImage
          ? undefined
          : adapterPlan
            ? adapterPlan.referenceManifest.find((entry) => entry.sourceType === "start_frame")?.mediaUrl
            : startingImageUrl,
        endFrameUrl: isImage
          ? undefined
          : adapterPlan
            ? adapterPlan.referenceManifest.find((entry) => entry.sourceType === "end_frame")?.mediaUrl
            : request.endFrameUrl,
        startFrameTakeId: !isImage && adapterPlan?.referenceManifest.some((entry) => entry.sourceType === "start_frame")
          ? request.startFrameTakeId
          : undefined,
        endFrameTakeId: !isImage && adapterPlan?.referenceManifest.some((entry) => entry.sourceType === "end_frame")
          ? request.endFrameTakeId
          : undefined,
        visualScenarioId: visualScenario?.id,
        visualStateFingerprint: visualScenario?.stateFingerprint,
        visualReuseFingerprint: visualScenario?.reuseFingerprint,
        createdAt: now,
      };
      const takeId = `take-${request.action}-${now}`;
      const media = isImage
        ? createAIGeneratedMediaReference("image", generatedUrl!, modelId)
        : videoTask
          ? createMediaAssetReference({
              url: generatedUrl,
              kind: "video",
              source: "ai_generation",
              status: generatedUrl ? "ready" : videoTask.status === "failed" || videoTask.status === "cancelled" ? "failed" : "pending",
              generationJobId: videoTask.id,
              modelId,
              createdAt: now,
              errorMessage: videoTask.error,
              note: generatedUrl ? "视频任务已完成。" : "原视频任务已保存，页面会继续查询，不会自动重新提交。",
            })
          : createAIGeneratedMediaReference("video", generatedUrl!, modelId);
      if (request.draftPreview) {
        const nextShot = applyShotDraftPreview(latestShot, {
          imageUrl: generatedUrl!,
          imageMedia: media,
          sourceHash: request.sourceHash,
          promptHash: manualStoryboardHash(finalPrompt),
          modelId,
          referenceImageUrls: compiledImageRequest?.referenceImages || [],
          visualStyleCompileManifest: compiledImageRequest?.visualStyleProjection?.compileManifest,
          createdAt: now,
        });
        await flushDebouncedProjectSave(requestedProjectId);
        const episodeBeforeCandidate = useProjectStore.getState().activeEpisode;
        const result = await legacyProjectClient.appendStudioCandidate(requestedProjectId, requestedEpisodeId, requestedSceneId, {
          shotId: latestShot.id, draftPreview: nextShot.draftPreview,
        });
        if (isAsyncContextCurrent(requestContext) && useProjectStore.getState().activeEpisode === episodeBeforeCandidate) {
          noteSuccessfulProductionEpisodeWrite(requestedProjectId, result.episode);
          useProjectStore.setState({ activeEpisode: result.episode });
        }
        if (isAsyncContextCurrent(requestContext)) toast.success("镜头方向预览已生成，不会进入正式成片");
        return;
      }
      const storyboardReferenceImageUrl = resolveManualStudioStoryboardReferenceUrl(request.target);
      const startingImageMedia = startingImageUrl
        ? [activeTake?.imageMedia, latestShot.imageMedia]
            .find((candidate) => candidate?.url === startingImageUrl)
          || createLegacyMediaReference("image", startingImageUrl)
        : undefined;
      const take = isImage ? {
        appearanceSnapshot: latestShot.appearance,
        id: takeId,
          imageUrl: generatedUrl!,
        imageMedia: media,
        generationAudit: audit,
        createdAt: now,
      } : {
        id: takeId,
        imageUrl: startingImageUrl || storyboardReferenceImageUrl,
        imageMedia: startingImageUrl
          ? startingImageMedia
          : storyboardReferenceImageUrl
            ? createLegacyMediaReference("image", storyboardReferenceImageUrl)
            : undefined,
        videoUrl: generatedUrl,
        videoMedia: media,
        generationAudit: audit,
        createdAt: now,
      };
      await flushDebouncedProjectSave(requestedProjectId);
      const episodeBeforeCandidate = useProjectStore.getState().activeEpisode;
      const result = await legacyProjectClient.appendStudioCandidate(requestedProjectId, requestedEpisodeId, requestedSceneId, {
        shotId: latestShot.id,
        boardId: !isImage && request.target.kind === "storyboard_board" ? request.target.boardId : undefined,
        take,
      });
      if (!isAsyncContextCurrent(requestContext)) {
        toast.success(`《${latestProject.title}》的候选已保存到原镜头`);
        return;
      }
      if (useProjectStore.getState().activeEpisode === episodeBeforeCandidate) {
        noteSuccessfulProductionEpisodeWrite(requestedProjectId, result.episode);
        useProjectStore.setState({ activeEpisode: result.episode });
      }
      if (!isImage && (videoTask?.status === "failed" || videoTask?.status === "cancelled")) {
        toast.error(videoTask.error || "视频任务失败，系统没有自动重提");
      } else {
        toast.success(sourceReviewReasons.length
          ? "候选已生成，但来源有更新，建议复核后再采用"
          : isImage
            ? "图片候选已生成，请预览后人工采用"
            : generatedUrl
              ? "视频候选已生成，请预览后人工采用"
              : "视频任务已提交，刷新页面也会继续查询原任务；完成后仍需人工采用");
      }
    } catch (error) {
      console.error("Manual Studio generation failed:", JSON.stringify(summarizeUnknownError(error)));
      toast.error(error instanceof Error ? error.message : "摄影棚生成失败。");
      throw error;
    } finally {
      if (requestEpochRef.current === requestEpoch) {
        if (request.draftPreview) setIsGeneratingDraftImage(false);
        else if (isImage) setIsGeneratingImage(false);
        else setIsGeneratingVideo(false);
      }
    }
  };

  const importMedia = async (
    file: File,
    kind: "image" | "video",
    target: ManualStudioGenerationTarget,
  ) => {
    if (!project || !episode || !scene || isImportingMedia) return;
    if (kind === "image" && !file.type.startsWith("image/")) {
      toast.error("请选择图片文件。");
      return;
    }
    if (kind === "video" && !file.type.startsWith("video/")) {
      toast.error("请选择视频文件。");
      return;
    }
    const requestedProjectId = project.id;
    const requestedEpisodeId = episode.id;
    const requestedSceneId = scene.id;
    const requestContext = captureAsyncContext(requestedProjectId, requestedEpisodeId, requestedSceneId);
    if (!isAsyncContextCurrent(requestContext)) return;
    const importRequestId = ++nextAsyncRequestIdRef.current;
    activeImportRequestIdRef.current = importRequestId;
    const isImportRequestCurrent = () => (
      activeImportRequestIdRef.current === importRequestId
      && isAsyncContextCurrent(requestContext)
    );
    setIsImportingMedia(true);
    try {
      if (!await awaitPendingSceneWrites(requestContext) || !isImportRequestCurrent()) return;
      let latestProject = useProjectStore.getState().currentProject;
      let latestEpisode = useProjectStore.getState().activeEpisode;
      let latestScene = resolveSceneReadModel(latestProject, latestEpisode).scenes.find((item) => item.id === requestedSceneId);
      let latestShot = latestScene?.shots?.find((item) => item.id === target.shotId);
      if (!latestProject || !latestEpisode || !latestScene?.shots || !latestShot) throw new Error("当前 Shot 已不存在。");

      const activeTake = latestShot.takes?.find((item) => item.id === latestShot.activeTakeId);
      const activeAudit = activeTake?.generationAudit;
      const activeTakeMatchesTarget = activeAudit?.targetKind === target.kind
        && activeAudit.shotId === target.shotId
        && [...(activeAudit.selectedAssetBoardItemIds || [])].sort().join("|") === [...(target.assetBoardItemIds || [])].sort().join("|");
      const requestedStartFrameUrl = kind === "video" && target.kind !== "storyboard_board" && activeTakeMatchesTarget
        ? activeTake?.imageUrl
        : undefined;
      const requestedStartFrameMedia = requestedStartFrameUrl
        ? activeTake?.imageMedia || createLegacyMediaReference("image", requestedStartFrameUrl)
        : undefined;
      const requestedSourceFingerprint = manualStudioTargetSourceFingerprint(latestScene, target);

      if (!isImportRequestCurrent()) return;
      const uploaded = await assetClient.uploadFile(file, requestedProjectId);
      if (!isImportRequestCurrent()) return;
      if (!uploaded.url) throw new Error(uploaded.error || "媒体文件写入项目失败。");

      if (!await awaitPendingSceneWrites(requestContext) || !isImportRequestCurrent()) return;
      latestProject = useProjectStore.getState().currentProject;
      latestEpisode = useProjectStore.getState().activeEpisode;
      if (latestProject?.id !== requestedProjectId || latestEpisode?.id !== requestedEpisodeId) {
        throw new Error("项目或分集已切换，导入结果未写入当前页面。");
      }
      latestScene = resolveSceneReadModel(latestProject, latestEpisode).scenes.find((item) => item.id === requestedSceneId);
      latestShot = latestScene?.shots?.find((item) => item.id === target.shotId);
      if (!latestScene?.shots || !latestShot) throw new Error("当前 Shot 已不存在。");
      const importSourceUpdated = manualStudioTargetSourceFingerprint(latestScene, target) !== requestedSourceFingerprint;

      const now = Date.now();
      const prompt = kind === "image" ? target.imagePrompt : target.videoPrompt;
      const interactiveContext = resolveManualStudioInteractiveContext(latestProject, latestScene, target);
      const audit: ManualStudioTakeAudit = {
        action: kind === "image" ? "import_image" : "import_video",
        timeline: kind === "video" ? target.timeline?.map(({ shotId, startSeconds, endSeconds }) => ({ shotId, startSeconds, endSeconds })) : undefined,
        targetKind: target.kind,
        shotId: target.shotId,
        boardId: target.boardId,
        panelId: target.panelId,
        pageId: target.pageId,
        storyboardVisualTakeId: target.storyboardVisualTakeId,
        sourceHash,
        sourceReview: {
          status: importSourceUpdated ? "review_recommended" : "current",
          reasons: importSourceUpdated ? ["project_source_updated"] : [],
          detectedAt: Date.now(),
        },
        authorPrompt: prompt,
        finalProviderPrompt: prompt,
        promptHash: manualStoryboardHash(prompt),
        providerPromptHash: manualStoryboardHash(prompt),
        providerType: "manual_upload",
        modelId: "manual-upload",
        selectedSkillIds: [],
        selectedSkillTitles: [],
        selectedContextIds: [],
        selectedAssetIds: target.assetIds,
        selectedAssetBoardItemIds: target.assetBoardItemIds,
        referenceImageUrls: kind === "video"
          ? [target.kind === "storyboard_board" ? resolveManualStudioStoryboardReferenceUrl(target) : requestedStartFrameUrl].filter((url): url is string => Boolean(url))
          : [],
        startFrameUrl: requestedStartFrameUrl,
        audioProvenance: kind === "video" && uploaded.videoMetadata ? {
          source: uploaded.videoMetadata.hasAudio ? "imported" : "none",
          embeddedAudio: uploaded.videoMetadata.hasAudio,
          masterAudioAssetIds: [],
          mustNotAutoDub: uploaded.videoMetadata.hasAudio,
        } : undefined,
        interactiveVideoContext: interactiveContext ? {
          graphVersionId: interactiveContext.graphVersionId,
          nodeId: interactiveContext.nodeId,
          contentSlot: interactiveContext.contentSlot,
          visualScenarioId: interactiveContext.visualScenarioId,
          visualStateFingerprint: interactiveContext.visualStateFingerprint,
          visualReuseFingerprint: interactiveContext.visualReuseFingerprint,
        } : undefined,
        createdAt: now,
      };
      const media = createMediaAssetReference({
        url: uploaded.url,
        kind,
        source: "upload",
        status: "ready",
        createdAt: now,
        note: `作者通过摄影棚页面导入：${file.name}`,
      });
      const takeId = `take-import-${kind}-${now}`;
      const storyboardReferenceImageUrl = target.kind === "storyboard_board"
        ? resolveManualStudioStoryboardReferenceUrl(target)
        : undefined;
      const take = kind === "image" ? {
        id: takeId,
        imageUrl: uploaded.url,
        imageMedia: media,
        generationAudit: audit,
        createdAt: now,
      } : {
        id: takeId,
        imageUrl: target.kind === "storyboard_board" ? storyboardReferenceImageUrl : requestedStartFrameUrl,
        imageMedia: target.kind === "storyboard_board"
          ? storyboardReferenceImageUrl ? createLegacyMediaReference("image", storyboardReferenceImageUrl) : undefined
          : requestedStartFrameMedia,
        videoUrl: uploaded.url,
        videoMedia: media,
        generationAudit: audit,
        createdAt: now,
      };
      if (kind === "video" && target.kind === "storyboard_board") {
        const boards = latestScene.manualStoryboard?.boards || [];
        const unitIndex = boards.findIndex((workflow) => (
          workflow.unitSchema === "storyboard_unit.v1"
          && (workflow.videoGenerationUnitId === target.videoGenerationUnitId
            || workflow.board?.videoGenerationUnitId === target.videoGenerationUnitId
            || workflow.boardId === target.boardId
            || workflow.board?.id === target.boardId)
        ));
        if (unitIndex < 0 || !latestScene.manualStoryboard) throw new Error("当前持久化故事板单元已不存在。");
        await useProjectStore.getState().updateScene(requestContext.sceneId, {
          manualStoryboard: {
            ...latestScene.manualStoryboard,
            boards: boards.map((workflow, index) => index === unitIndex ? {
              ...workflow,
              takes: appendDistinctStudioTake(workflow.takes, take),
              updatedAt: now,
            } : workflow),
            updatedAt: now,
          },
        }, requestContext.episodeId, {
          expectedProjectId: requestContext.projectId,
          expectedEpisodeId: requestContext.episodeId,
        });
      } else {
        const shotWithCandidate = appendShotTakeCandidate(latestShot, take);
        await useProjectStore.getState().updateScene(requestContext.sceneId, {
          shots: latestScene.shots.map((shot) => shot.id === latestShot.id ? {
            ...shotWithCandidate,
          } : shot),
        }, requestContext.episodeId, {
          expectedProjectId: requestContext.projectId,
          expectedEpisodeId: requestContext.episodeId,
        });
      }
      if (isImportRequestCurrent()) {
        toast.success(importSourceUpdated
          ? "候选已导入，但来源有更新，建议复核后再采用"
          : kind === "image" ? "图片候选已导入，请预览后采用" : "视频候选已导入，请预览后采用");
      }
    } catch (error) {
      if (isImportRequestCurrent()) {
        toast.error(error instanceof Error ? error.message : "媒体导入失败。");
      }
    } finally {
      if (activeImportRequestIdRef.current === importRequestId) {
        activeImportRequestIdRef.current = undefined;
        setIsImportingMedia(false);
      }
    }
  };

  const rewriteTakeAudio = async ({
    shotId,
    takeId,
    mode,
    replacementAudio,
  }: {
    shotId: string;
    takeId: string;
    mode: "strip" | "replace";
    replacementAudio?: File;
  }) => {
    if (!project || !episode || !scene || isEditingVideoAudio) return;
    if (mode === "replace" && (!replacementAudio || !replacementAudio.type.startsWith("audio/"))) {
      toast.error("请选择声音文件。");
      return;
    }
    const requestContext = captureAsyncContext(project.id, episode.id, scene.id);
    if (!isAsyncContextCurrent(requestContext)) return;
    const rewriteRequestId = ++nextAsyncRequestIdRef.current;
    activeAudioRewriteRequestIdRef.current = rewriteRequestId;
    const isRewriteRequestCurrent = () => (
      activeAudioRewriteRequestIdRef.current === rewriteRequestId
      && isAsyncContextCurrent(requestContext)
    );
    setIsEditingVideoAudio(true);
    try {
      if (!await awaitPendingSceneWrites(requestContext) || !isRewriteRequestCurrent()) return;
      let latestProject = useProjectStore.getState().currentProject;
      let latestEpisode = useProjectStore.getState().activeEpisode;
      let latestScene = resolveSceneReadModel(latestProject, latestEpisode).scenes.find((item) => item.id === requestContext.sceneId);
      let latestShot = latestScene?.shots?.find((item) => item.id === shotId);
      let latestTake = latestShot?.takes?.find((item) => item.id === takeId);
      if (!latestScene?.shots || !latestShot || !latestTake?.videoUrl || !latestTake.generationAudit) {
        throw new Error("当前候选视频已不存在。");
      }
      const sourceVideoUrl = latestTake.videoUrl;
      let replacementAudioUrl: string | undefined;
      if (mode === "replace" && replacementAudio) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("读取声音文件失败。"));
          reader.readAsDataURL(replacementAudio);
        });
        if (!isRewriteRequestCurrent()) return;
        const uploaded = await assetClient.uploadAsset({ dataUrl, projectId: requestContext.projectId });
        if (!isRewriteRequestCurrent()) return;
        if (!uploaded.url) throw new Error(uploaded.error || "声音文件写入项目失败。");
        replacementAudioUrl = uploaded.url;
      }
      const rewritten = await assetClient.rewriteVideoAudio({
        videoUrl: sourceVideoUrl,
        projectId: requestContext.projectId,
        mode,
        replacementAudioUrl,
      });
      if (!isRewriteRequestCurrent()) return;
      if (!rewritten.url) throw new Error(rewritten.error || "视频声音处理失败。");

      if (!await awaitPendingSceneWrites(requestContext) || !isRewriteRequestCurrent()) return;
      latestProject = useProjectStore.getState().currentProject;
      latestEpisode = useProjectStore.getState().activeEpisode;
      latestScene = resolveSceneReadModel(latestProject, latestEpisode).scenes.find((item) => item.id === requestContext.sceneId);
      latestShot = latestScene?.shots?.find((item) => item.id === shotId);
      latestTake = latestShot?.takes?.find((item) => item.id === takeId);
      if (!latestScene?.shots || !latestShot || !latestTake?.videoUrl || !latestTake.generationAudit) {
        throw new Error("当前候选视频已不存在。");
      }
      if (latestTake.videoUrl !== sourceVideoUrl) {
        throw new Error("候选视频在声音处理期间已更新，本次结果未覆盖新版本。");
      }
      const now = Date.now();
      const revisedShot = reviseShotTakeAudio(latestShot, takeId, {
        takeId: `take-audio-${crypto.randomUUID()}`, videoUrl: rewritten.url, mode, replacementAudioUrl, createdAt: now,
      });
      await useProjectStore.getState().updateScene(requestContext.sceneId, {
        shots: latestScene.shots.map((shot) => shot.id === latestShot.id ? revisedShot : shot),
      }, requestContext.episodeId, {
        expectedProjectId: requestContext.projectId,
        expectedEpisodeId: requestContext.episodeId,
      });
      if (isRewriteRequestCurrent()) {
        toast.success(mode === "replace" ? "已生成替换声音版本，原版保留" : "已生成无声版本，原版保留");
      }
    } catch (error) {
      if (isRewriteRequestCurrent()) {
        toast.error(error instanceof Error ? error.message : "视频声音处理失败。");
      }
    } finally {
      if (activeAudioRewriteRequestIdRef.current === rewriteRequestId) {
        activeAudioRewriteRequestIdRef.current = undefined;
        setIsEditingVideoAudio(false);
      }
    }
  };

  return {
    promptRequest,
    setPromptRequest,
    isGeneratingImage,
    isGeneratingVideo,
    isGeneratingDraftImage,
    isImportingMedia,
    isEditingVideoAudio,
    prepareImage: (target: ManualStudioGenerationTarget) => prepare("image", target),
    prepareDraftImage: (target: ManualStudioGenerationTarget) => prepare("image", target, undefined, true),
    prepareVideo: (target: ManualStudioGenerationTarget, videoPreparation?: ManualStudioVideoPreparation) => prepare("video", target, videoPreparation),
    importImage: (file: File, target: ManualStudioGenerationTarget) => importMedia(file, "image", target),
    importVideo: (file: File, target: ManualStudioGenerationTarget) => importMedia(file, "video", target),
    rewriteTakeAudio,
    execute,
  };
}
