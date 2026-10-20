import { ProductionPreparationAdvisories } from "../components/production/ProductionPreparationAdvisories";
import { productionPreparationHref } from "../utils/productionNavigation";
import { appearanceImageIsAfterChange, appearanceBoards } from "../clients/productionStoryboardWorkflowClient";
import { sceneVideoClips } from '../utils/sceneVideoClips';
import { filmPreviewOpacity } from '../../packages/domain/src/filmTimeline';
import React, { lazy, Suspense, useState, useEffect, useRef, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAIConfigStore, useGlobalStore, useProjectStore } from "../clients/stateClient";
import { motion, AnimatePresence } from "motion/react";
import {
  SlidersHorizontal,
  Settings2,
  ChevronDown,
  ChevronUp,
  Clock
} from "lucide-react";
import { useLocation, useParams, useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { Asset, AudioTrack, Scene, Shot } from "../clients/domainTypes";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
  adoptShotTake,
  isShotTakeReadyForAdoption,
  shotTakeHasVideoIntent,
} from "../clients/productionMediaReviewClient";
import type { Episode } from "../clients/domainTypes";
import { useStudioAI } from "../hooks/useStudioAI";
import { StudioAssetList } from "../components/StudioAssetList";
import { StudioPreview } from "../components/StudioPreview";
import { EmptyState } from "../components/ui/EmptyState";
import { summarizeUnknownError } from "../utils/logging";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { InteractiveSceneContextPanel } from "../components/interactive/InteractiveSceneContextPanel";

import { usePlayback } from "../hooks/usePlayback";

import { useSceneReadModel } from "../hooks/useSceneReadModel";
import { buildManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";
import {
  buildManualFilmTeamReadModel,
  buildProductionPreparationGate,
  manualFilmTeamRequiredDepartmentsForScene,
} from "../clients/productionPreparationWorkflowClient";
import {
  buildManualStoryboardReadModel,
  manualStoryboardHash,
  buildManualVideoStoryboardReadModel,
  buildStoryboardCompositeVisualPages,
  getActiveStoryboardBoardVisualTake,
  getActiveStoryboardShotGridTake,
  resolveReadyStoryboardShotGridImage,
  buildShotUpstreamPromptHash,
  buildStoryboardUnitUpstreamPromptHash,
  resolveStoryboardUnitVideoPrompt,
} from "../clients/productionStoryboardWorkflowClient";
import { useManualStudioAI, type ManualStudioGenerationTarget } from "../hooks/useManualStudioAI";
import { useEpisodeFilmExport } from "../hooks/useEpisodeFilmExport";
import { EpisodeFilmExportModal } from "../components/EpisodeFilmExportModal";
import type { StudioGenerationTargetSelection } from "../components/StudioGenerationTargetPicker";
import { useProductionEpisodeAvailability } from "../features/production/preparation/useProductionEpisodeAvailability";
import {
  buildManualStudioFrameReferenceCandidates,
  buildManualStudioStoryboardTimeline,
  buildManualStudioGenerationDraftKey,
  filterManualStudioDistinctEndFrameCandidates,
  listManualStudioEligiblePriorVideoReferences,
  listCompatibleVideoModelAdapters,
  normalizeVideoGenerationMode,
  resolveVideoModelAdapter,
  resolveManualStudioStoryboardReferenceUrl,
  resolveManualStudioUnitPlaybackRange,
  type ManualStudioPriorVideoReferenceCandidate,
} from "../clients/productionStudioWorkflowClient";

const Timeline = lazy(() => import("../components/Timeline"));
const GlobalGenerationParamsModal = lazy(() => import("../components/GlobalGenerationParamsModal"));
const PromptEditorModal = lazy(() => import("../components/PromptEditorModal"));
const TTSConfigModal = lazy(() => import("../components/TTSConfigModal"));
const StudioShotControls = lazy(() => import("../components/StudioShotControls")
  .then((module) => ({ default: module.StudioShotControls })));
const StudioAudioControls = lazy(() => import("../components/StudioAudioControls")
  .then((module) => ({ default: module.StudioAudioControls })));
const StudioGenerationTargetPicker = lazy(() => import("../components/StudioGenerationTargetPicker")
  .then((module) => ({ default: module.StudioGenerationTargetPicker })));
const StudioReferenceControlPanel = lazy(() => import("../components/StudioReferenceControlPanel")
  .then((module) => ({ default: module.StudioReferenceControlPanel })));

const DeferredStudioPanelFallback = () => (
  <div className="flex min-h-32 items-center justify-center text-xs font-bold text-text-muted">
    正在打开所选工具…
  </div>
);

interface StudioProps {
  workspaceMode?: "linear" | "interactive-node";
}

interface StudioReferenceSelectionDraft {
  selectedBoardItemIds: string[];
  includeStoryboardReference: boolean;
  selectedImageTakeIds: string[];
  selectedVideoCandidateIds: string[];
  selectedDialogueTrackIds: string[];
  selectedVoiceReferenceIds: string[];
  startFrameTakeId: string;
  endFrameTakeId: string;
}

const EMPTY_STUDIO_REFERENCE_SELECTION: StudioReferenceSelectionDraft = {
  selectedBoardItemIds: [],
  includeStoryboardReference: false,
  selectedImageTakeIds: [],
  selectedVideoCandidateIds: [],
  selectedDialogueTrackIds: [],
  selectedVoiceReferenceIds: [],
  startFrameTakeId: "",
  endFrameTakeId: "",
};

export default function Studio({ workspaceMode = "linear" }: StudioProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDirectorProductionRoute = location.pathname.startsWith("/production/");
  const isInteractiveNodeWorkspace = workspaceMode === "interactive-node";
  const { episodeId: routeEpisodeId, nodeId } = useParams<{ episodeId?: string; nodeId?: string }>();
  const { currentProject, activeEpisodeId, activeEpisode, setActiveEpisodeId, updateScene, loadProject, isLoading } = useProjectStore(useShallow((state) => ({
    currentProject: state.currentProject,
    activeEpisodeId: state.activeEpisodeId,
    activeEpisode: state.activeEpisode,
    setActiveEpisodeId: state.setActiveEpisodeId,
    updateScene: state.updateScene,
    loadProject: state.loadProject,
    isLoading: state.isLoading,
  })));
  const { fullEpisodes: productionFullEpisodes } = useProductionEpisodeAvailability(currentProject, activeEpisode);
  const { globalAssets } = useGlobalStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isFilmExportOpen, setIsFilmExportOpen] = useState(false);
  const urlSceneId = searchParams.get("sceneId");
  const urlShotId = searchParams.get("shotId");
  const urlPanelId = searchParams.get("panelId");
  const urlVideoUnitId = searchParams.get("videoUnitId");
  const urlEpisodeId = searchParams.get("episodeId");
  const queryProjectId = searchParams.get("projectId");
  const returnTo = searchParams.get("returnTo");
  const interactiveReturnTo = returnTo?.startsWith("/interactive/experiences/") ? returnTo : undefined;
  const isRequestedProjectPending = Boolean(queryProjectId && currentProject?.id !== queryProjectId);
  const requestedVideoGenerationMode = searchParams.get("videoMode");
  const urlVideoGenerationMode = normalizeVideoGenerationMode(
    isDirectorProductionRoute && !requestedVideoGenerationMode
      ? "storyboard"
      : requestedVideoGenerationMode,
  );

  const sceneReadModel = useSceneReadModel();
  const baseScenes = isInteractiveNodeWorkspace && nodeId
    ? sceneReadModel.scenes.filter((scene) => (scene.sourceNodeId || scene.id) === nodeId)
    : sceneReadModel.scenes;

  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    urlSceneId || baseScenes[0]?.id || null,
  );
  const [selectedShotId, setSelectedShotId] = useState<string | null>(
    urlShotId || null,
  );
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [generationTargetSelection, setGenerationTargetSelection] = useState<StudioGenerationTargetSelection>({ kind: "shot" });
  const [selectedVideoAdapterId, setSelectedVideoAdapterId] = useState("");
  const [studioVideoPromptDrafts, setStudioVideoPromptDrafts] = useState<Record<string, { text: string; dirty: boolean }>>({});
  const [studioReferenceDrafts, setStudioReferenceDrafts] = useState<Record<string, StudioReferenceSelectionDraft>>({});
  const [manualStudioReferenceCatalog, setManualStudioReferenceCatalog] = useState<{
    projectId: string;
    candidates: ManualStudioPriorVideoReferenceCandidate[];
  }>({ projectId: "", candidates: [] });

  // Keep the scene list light, but load the selected scene in full before
  // evaluating storyboard QA or generating media for a specific Shot.
  const studioEpisodeView = urlVideoGenerationMode === "storyboard" || Boolean(urlShotId)
    ? "storyboard"
    : "storyboard-index";

  const [previewMode, setPreviewMode] = useState<"video" | "image">("video");
  const [previewTakeId, setPreviewTakeId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      setIsFullscreen(true);
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => undefined);
      }
    } else {
      setIsFullscreen(false);
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => undefined);
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  
  const [showMediaPool, setShowMediaPool] = useState(() => window.innerWidth >= 1200);
  const [showInspector, setShowInspector] = useState(() => window.innerWidth >= 1024);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({});
  const positionedVideoUnitRef = useRef<string | null>(null);

  const requestedScene = baseScenes.find((scene) => scene.id === activeSceneId);
  const activeScene = requestedScene && !(requestedScene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary
    ? requestedScene
    : baseScenes.find((scene) => !(scene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary);
  const isSceneDetailPending = Boolean(
    requestedScene && (requestedScene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary,
  );
  const activeVisualScenario = activeScene?.interactiveMetadata?.visualScenarios?.find(
    (scenario) => scenario.id === activeScene.interactiveMetadata?.activeVisualScenarioId,
  ) || activeScene?.interactiveMetadata?.visualScenarios?.[0];
  const selectedShotCandidate = activeScene?.shots?.find((s) => s.id === selectedShotId) as
    | (NonNullable<Scene["shots"]>[number] & { __workspaceShotSummary?: boolean })
    | undefined;
  const selectedShot = selectedShotCandidate && !selectedShotCandidate.__workspaceShotSummary
    ? selectedShotCandidate
    : undefined;
  const selectedAudioTrack = activeScene?.audioTracks?.find((a) => a.id === selectedAudioTrackId);
  const manualFilmTeamReadModel = useMemo(() => {
    if (!isDirectorProductionRoute || !currentProject || !activeEpisode || !activeScene) return null;
    return buildManualFilmTeamReadModel({
      project: currentProject,
      episode: activeEpisode,
      requiredDepartments: manualFilmTeamRequiredDepartmentsForScene(activeScene),
    });
  }, [activeEpisode, activeScene, currentProject, isDirectorProductionRoute]);
  const manualProductionAssetReadModel = useMemo(() => {
    if (!isDirectorProductionRoute || !currentProject || !activeEpisode || !activeScene || !manualFilmTeamReadModel) return null;
    return buildManualProductionAssetReadModel({ project: currentProject, episode: activeEpisode, scene: activeScene, episodes: productionFullEpisodes, filmTeam: manualFilmTeamReadModel });
  }, [activeEpisode, activeScene, currentProject, isDirectorProductionRoute, manualFilmTeamReadModel, productionFullEpisodes]);
  const manualStoryboardReadModel = useMemo(() => {
    if (!activeScene || !manualFilmTeamReadModel || !manualProductionAssetReadModel) return null;
    return buildManualStoryboardReadModel({ scene: activeScene, filmTeam: manualFilmTeamReadModel, assets: manualProductionAssetReadModel });
  }, [activeScene, manualFilmTeamReadModel, manualProductionAssetReadModel]);
  const productionPreparationGate = useMemo(() => {
    if (!isDirectorProductionRoute || !activeScene || !manualFilmTeamReadModel || !manualProductionAssetReadModel) return null;
    return buildProductionPreparationGate({ scene: activeScene, filmTeam: manualFilmTeamReadModel, assets: manualProductionAssetReadModel });
  }, [activeScene, isDirectorProductionRoute, manualFilmTeamReadModel, manualProductionAssetReadModel]);
  const manualVideoStoryboardReadModel = useMemo(() => {
    if (!selectedShot || !manualStoryboardReadModel) return null;
    return buildManualVideoStoryboardReadModel({ workflows: activeScene?.manualStoryboard?.boards, shot: selectedShot, storyboardSourceHash: manualStoryboardReadModel.sourceHash, project: currentProject || undefined, assets: manualProductionAssetReadModel || undefined, scene: activeScene || undefined });
  }, [activeScene, currentProject, manualProductionAssetReadModel, manualStoryboardReadModel, selectedShot]);
  const videoModels = useAIConfigStore((state) => state.models);
  const videoChannels = useAIConfigStore((state) => state.channels);
  const routedVideoModelConfigId = useAIConfigStore((state) => state.routing.videoGen);
  const preferredVideoModelConfigId = manualVideoStoryboardReadModel?.workflow?.targetVideoModelConfigId
    || routedVideoModelConfigId;
  const configuredVideoModel = videoModels.find((model) => model.id === preferredVideoModelConfigId)
    || videoModels.find((model) => model.id === routedVideoModelConfigId);
  const configuredVideoChannel = videoChannels.find((channel) => channel.id === configuredVideoModel?.channelId);
  const configuredVideoAdapter = useMemo(() => configuredVideoModel && configuredVideoChannel
    ? resolveVideoModelAdapter({
        channelType: configuredVideoChannel.type,
        modelId: configuredVideoModel.modelId,
        configuredAdapterId: configuredVideoModel.videoAdapterId,
      })
    : undefined, [configuredVideoChannel, configuredVideoModel]);
  const configuredVideoAdapters = useMemo(() => {
    if (!configuredVideoModel || !configuredVideoChannel || !configuredVideoAdapter) return [];
    const compatible = listCompatibleVideoModelAdapters({
      channelType: configuredVideoChannel.type,
      modelId: configuredVideoModel.modelId,
    });
    return compatible.length ? compatible : [configuredVideoAdapter];
  }, [configuredVideoAdapter, configuredVideoChannel, configuredVideoModel]);
  useEffect(() => {
    if (!configuredVideoAdapters.length) {
      setSelectedVideoAdapterId("");
      return;
    }
    if (!configuredVideoAdapters.some((adapter) => adapter.id === selectedVideoAdapterId)) {
      setSelectedVideoAdapterId(configuredVideoAdapters.some((adapter) => adapter.id === configuredVideoAdapter?.id)
        ? configuredVideoAdapter!.id
        : configuredVideoAdapters[0].id);
    }
  }, [configuredVideoAdapter, configuredVideoAdapters, selectedVideoAdapterId]);
  const selectedVideoAdapter = configuredVideoAdapters.find((adapter) => adapter.id === selectedVideoAdapterId)
    || configuredVideoAdapters[0];
  const configuredModelAcceptsPriorVideos = configuredVideoAdapters.some((adapter) => (
    adapter.capabilities.referenceVideos
  ));
  useEffect(() => {
    let cancelled = false;
    const projectId = currentProject?.id;
    if (!projectId || !configuredModelAcceptsPriorVideos) {
      setManualStudioReferenceCatalog({ projectId: "", candidates: [] });
      return () => { cancelled = true; };
    }
    void legacyProjectClient.getManualStudioPriorVideoReferences(projectId).then((candidates) => {
      if (cancelled) return;
      setManualStudioReferenceCatalog({ projectId, candidates });
    }).catch(() => {
      if (!cancelled) setManualStudioReferenceCatalog({ projectId, candidates: [] });
    });
    return () => { cancelled = true; };
  }, [configuredModelAcceptsPriorVideos, currentProject?.id]);
  const localMiniMaxH3 = Boolean(
    configuredVideoChannel?.type === "comfyui"
    && configuredVideoAdapter?.id.startsWith("video.minimax.h3."),
  );
  const persistedStudioWorkflow = useMemo(() => urlVideoUnitId
    ? activeScene?.manualStoryboard?.boards?.find((workflow) => (
        workflow.unitSchema === "storyboard_unit.v1"
        && (workflow.videoGenerationUnitId === urlVideoUnitId
          || workflow.board?.videoGenerationUnitId === urlVideoUnitId)
      ))
    : undefined, [activeScene?.manualStoryboard?.boards, urlVideoUnitId]);
  const manualStudioWorkflow = persistedStudioWorkflow
    || (manualVideoStoryboardReadModel?.workflow?.unitSchema === "storyboard_unit.v1"
      ? manualVideoStoryboardReadModel.workflow
      : undefined);
  const persistedUnitShotIds = manualStudioWorkflow
    ? manualStudioWorkflow.shotIds || manualStudioWorkflow.board?.shotIds || [manualStudioWorkflow.shotId]
    : [];
  const persistedUnitDuration = persistedUnitShotIds.reduce((sum, shotId) => (
    sum + Number(activeScene?.shots?.find((shot) => shot.id === shotId)?.duration || 0)
  ), 0);
  const manualStudioStructuralUnitIssue = manualStudioWorkflow
    ? !manualStudioWorkflow.board?.panels.length
      ? { message: "当前视频单元没有可用的分镜结构。" }
      : undefined
    : undefined;
  const persistedUnitList = (activeScene?.manualStoryboard?.boards || [])
    .filter((workflow) => workflow.unitSchema === "storyboard_unit.v1");
  const manualStudioVideoUnitIndex = Math.max(0, persistedUnitList.findIndex((workflow) => (
    workflow.id === manualStudioWorkflow?.id
  )));
  const manualStudioVideoUnitCount = persistedUnitList.length;
  const manualStudioBaseTarget = useMemo<ManualStudioGenerationTarget | null>(() => {
    if (!selectedShot) return null;
    const sourceWorkflow = manualVideoStoryboardReadModel?.workflow;
    const workflow = manualStudioWorkflow;
    const pages = workflow?.board
      ? (workflow.board.visualPages?.length ? workflow.board.visualPages : buildStoryboardCompositeVisualPages(workflow.board))
      : [];
    const page = generationTargetSelection.kind === "storyboard_board"
      ? pages.find((item) => item.id === generationTargetSelection.pageId)
      : undefined;
    const selectedBoardPanelId = generationTargetSelection.kind === "storyboard_board"
      ? generationTargetSelection.panelId
      : undefined;
    if (page && workflow?.board) {
      const boardVisualTake = getActiveStoryboardBoardVisualTake(page);
      const unitShotIds = workflow.board.shotIds.length ? workflow.board.shotIds : [selectedShot.id];
      const unitShots = unitShotIds
        .map((shotId) => activeScene?.shots?.find((candidate) => candidate.id === shotId))
        .filter((candidate): candidate is Shot => Boolean(candidate));
      const targetShot = unitShots[0] || selectedShot;
      const panel = selectedBoardPanelId
        ? workflow.board.panels.find((item) => item.id === selectedBoardPanelId)
        : workflow.board.panels.find((item) => item.shotId === targetShot.id);
      const boardAssetIds = Array.from(new Set(workflow.board.panels.flatMap((item) => item.assetRefs || [])));
      const timeline = buildManualStudioStoryboardTimeline(workflow.board, unitShots);
      const unitPerformanceBeats = workflow.performanceBeats?.length ? workflow.performanceBeats : workflow.performanceBeat ? [workflow.performanceBeat] : [];
      const selectedShotIndex = activeScene?.shots?.findIndex((item) => item.id === targetShot.id) ?? -1;
      const interactiveContentSlot = unitPerformanceBeats.some((beat) => beat.beatType === "interactive_idle")
        ? "choice_hold" as const
        : activeScene?.interactiveMetadata?.incomingContext && selectedShotIndex === 0
          ? "entry" as const
          : activeScene?.interactiveMetadata?.isEnding && selectedShotIndex === (activeScene.shots?.length || 1) - 1
            ? "exit" as const
            : "main" as const;
      const durationSeconds = unitShots.reduce((sum, item) => sum + Number(item.duration || 0), 0);
      const resolvedUnitPrompt = resolveStoryboardUnitVideoPrompt({ workflow, shots: unitShots });
      const videoGenerationUnitId = workflow.videoGenerationUnitId || workflow.board.videoGenerationUnitId || workflow.board.id;
      return {
        kind: "storyboard_board",
        shotId: targetShot.id,
        boardId: workflow.board.id,
        pageId: page.id,
        panelId: panel?.id,
        storyboardImageUrl: boardVisualTake?.imageUrl,
        videoReferenceImageUrl: resolveReadyStoryboardShotGridImage({ board: workflow.board, page, shots: unitShots }),
        storyboardReferenceMode: workflow.board.visualReferenceMode || "shot_grid",
        storyboardVisualTakeId: workflow.board.visualReferenceMode !== "director_board" ? getActiveStoryboardShotGridTake(page)?.id || boardVisualTake?.id : boardVisualTake?.id,
        label: `当前片段 ${manualStudioVideoUnitIndex + 1}/${manualStudioVideoUnitCount} · ${unitShotIds.length} 个镜头 · ${durationSeconds}s`,
        durationSeconds,
        imagePrompt: [targetShot.imagePrompt, panel?.visualBeat, panel?.framing, panel?.lens, panel?.angle, panel?.lightingCue, panel?.compositionNote].filter(Boolean).join("\n"),
        videoPrompt: resolvedUnitPrompt.text,
        assetIds: boardAssetIds.length
          ? boardAssetIds
          : [...(targetShot.characterIdsInShot || []), targetShot.locationId, ...(targetShot.propIds || [])].filter(Boolean) as string[],
        assetBoardItemIds: [],
        videoGenerationUnitId,
        shotIds: unitShotIds,
        startState: workflow.board.startState,
        endState: workflow.board.endState,
        timeline,
        targetVideoModelConfigId: workflow.targetVideoModelConfigId,
        interactiveContentSlot,
        interactiveNodeId: activeScene?.interactiveMetadata?.nodeIds?.[0],
        upstreamPromptSourceKind: "storyboard_unit",
        upstreamPromptSourceId: videoGenerationUnitId,
        upstreamPromptHash: buildStoryboardUnitUpstreamPromptHash({ workflow, shots: unitShots }),
      };
    }
    if (generationTargetSelection.kind === "storyboard_board") return null;
    return {
      kind: "shot",
      shotId: selectedShot.id,
      label: `当前镜头 · ${Number(selectedShot.duration || 0)}s`,
      durationSeconds: Number(selectedShot.duration || 0),
      imagePrompt: selectedShot.imagePrompt || "",
      videoPrompt: selectedShot.videoPrompt || "",
      assetIds: [...(selectedShot.characterIdsInShot || []), selectedShot.locationId, ...(selectedShot.propIds || [])].filter(Boolean) as string[],
      assetBoardItemIds: [],
      videoGenerationUnitId: selectedShot.id,
      shotIds: [selectedShot.id],
      startState: sourceWorkflow?.board?.panels.find((panel) => panel.shotId === selectedShot.id)?.continuityIn,
      endState: [...(sourceWorkflow?.board?.panels || [])].reverse().find((panel) => panel.shotId === selectedShot.id)?.continuityOut,
      targetVideoModelConfigId: sourceWorkflow?.targetVideoModelConfigId,
      interactiveContentSlot: sourceWorkflow?.performanceBeats?.find((beat) => beat.shotId === selectedShot.id)?.beatType === "interactive_idle" ? "choice_hold" : "main",
      interactiveNodeId: activeScene?.interactiveMetadata?.nodeIds?.[0],
      upstreamPromptSourceKind: "shot",
      upstreamPromptSourceId: selectedShot.id,
      upstreamPromptHash: buildShotUpstreamPromptHash(selectedShot),
    };
  }, [activeScene, generationTargetSelection, manualStudioVideoUnitCount, manualStudioVideoUnitIndex, manualStudioWorkflow, manualVideoStoryboardReadModel?.workflow, selectedShot]);
  const manualStudioAssetBoards = useMemo(() => {
    if (!manualStudioBaseTarget || !manualProductionAssetReadModel || !currentProject) return [];
    const targetIds = new Set(manualStudioBaseTarget.assetIds);
    return appearanceBoards(currentProject, (activeScene?.shots || []).filter(s => (manualStudioBaseTarget.shotIds || [manualStudioBaseTarget.shotId]).includes(s.id)), manualProductionAssetReadModel.assetBoards.filter((board) => targetIds.has(board.assetId)), "video");
  }, [currentProject, activeScene?.shots, manualProductionAssetReadModel, manualStudioBaseTarget]);
  const studioPromptSourceKey = manualStudioBaseTarget
    ? `${manualStudioBaseTarget.upstreamPromptSourceKind || manualStudioBaseTarget.kind}:${manualStudioBaseTarget.upstreamPromptSourceId || manualStudioBaseTarget.shotId}:${manualStudioBaseTarget.upstreamPromptHash || ""}`
    : "";
  const manualStudioReferenceShots = useMemo(() => (manualStudioBaseTarget?.shotIds || [manualStudioBaseTarget?.shotId])
    .map((shotId) => activeScene?.shots?.find((shot) => shot.id === shotId))
    .filter((shot): shot is Shot => Boolean(shot)), [activeScene?.shots, manualStudioBaseTarget?.shotId, manualStudioBaseTarget?.shotIds]);
  const manualStudioAdoptedImageOptions = useMemo(() => manualStudioReferenceShots.flatMap((shot) => {
    const take = shot.takes?.find((item) => item.id === shot.activeTakeId && Boolean(item.imageUrl));
    const sceneIndex = activeScene?.shots?.findIndex((item) => item.id === shot.id) ?? -1;
    const label = sceneIndex >= 0 ? `分镜 ${sceneIndex + 1}` : "当前分镜";
    return take?.imageUrl ? [{ id: take.id, shotId: shot.id, mediaUrl: take.imageUrl, label: `${label} · ${appearanceImageIsAfterChange(take.appearanceSnapshot || shot.appearance) ? "变化后画面（尾帧）" : "已采用画面"}` }] : [];
  }), [activeScene?.shots, manualStudioReferenceShots]);
  const manualStudioReferenceEpisodes = useMemo(() => {
    const episodes = new Map<string, Episode>();
    for (const episode of productionFullEpisodes) episodes.set(episode.id, episode);
    if (activeEpisode) episodes.set(activeEpisode.id, activeEpisode);
    return [...episodes.values()];
  }, [activeEpisode, productionFullEpisodes]);
  const manualStudioPriorVideoOptions = useMemo(() => {
    const candidates = new Map<string, ManualStudioPriorVideoReferenceCandidate>();
    if (manualStudioReferenceCatalog.projectId === currentProject?.id) {
      for (const candidate of manualStudioReferenceCatalog.candidates) candidates.set(candidate.id, candidate);
    }
    for (const candidate of listManualStudioEligiblePriorVideoReferences(manualStudioReferenceEpisodes)) {
      candidates.set(candidate.id, candidate);
    }
    return [...candidates.values()];
  }, [currentProject?.id, manualStudioReferenceCatalog, manualStudioReferenceEpisodes]);
  const manualStudioDialogueOptions = useMemo(() => {
    const shotIds = new Set(manualStudioReferenceShots.map((shot) => shot.id));
    return (activeScene?.audioTracks || [])
      .filter((track) => track.type === "dialogue" && Boolean(track.url) && (!track.shotId || shotIds.has(track.shotId)))
      .map((track) => ({ id: track.id, label: track.text || "完整配音", mediaUrl: track.url! }));
  }, [activeScene?.audioTracks, manualStudioReferenceShots]);
  const manualStudioVoiceOptions = useMemo(() => {
    const characterIds = new Set(manualStudioReferenceShots.flatMap((shot) => [...(shot.characterIdsInShot || []), ...(shot.dialogueLines || []).map(line => line.characterId).filter((id): id is string => Boolean(id))]));
    return (currentProject?.characters || []).filter((character) => characterIds.has(character.id)).flatMap((character) => (
      character.voiceReferences || []
    ).filter((reference) => reference.usage === "voice_timbre" && Boolean(reference.url)).map((reference) => ({
      id: reference.id,
      label: `${character.name} · ${reference.description || "音色参考"}`,
      mediaUrl: reference.url!,
    })));
  }, [currentProject?.characters, manualStudioReferenceShots]);
  const studioGenerationDraftKey = buildManualStudioGenerationDraftKey({
    sourceKey: studioPromptSourceKey,
    modelConfigId: configuredVideoModel?.id || manualStudioBaseTarget?.targetVideoModelConfigId || routedVideoModelConfigId,
    modeId: selectedVideoAdapter?.id,
  });
  const studioVideoPromptDraftKey = studioGenerationDraftKey;
  const studioReferenceDraftKey = studioGenerationDraftKey;
  const studioReferenceDraft = studioReferenceDraftKey
    ? studioReferenceDrafts[studioReferenceDraftKey] || EMPTY_STUDIO_REFERENCE_SELECTION
    : EMPTY_STUDIO_REFERENCE_SELECTION;
  const {
    selectedBoardItemIds: selectedManualReferenceBoardItemIds,
    includeStoryboardReference,
    selectedImageTakeIds: selectedReferenceImageTakeIds,
    selectedVideoCandidateIds: selectedReferenceVideoTakeIds,
    selectedDialogueTrackIds,
    selectedVoiceReferenceIds,
    startFrameTakeId,
    endFrameTakeId,
  } = studioReferenceDraft;
  const updateStudioReferenceDraft = (
    updater: (current: StudioReferenceSelectionDraft) => StudioReferenceSelectionDraft,
  ) => {
    if (!studioReferenceDraftKey) return;
    setStudioReferenceDrafts((current) => ({
      ...current,
      [studioReferenceDraftKey]: updater(current[studioReferenceDraftKey] || EMPTY_STUDIO_REFERENCE_SELECTION),
    }));
  };
  const studioVideoPromptDraftRecord = studioVideoPromptDraftKey ? studioVideoPromptDrafts[studioVideoPromptDraftKey] : undefined;
  const studioVideoPromptDraft = studioVideoPromptDraftRecord?.text ?? manualStudioBaseTarget?.videoPrompt ?? "";
  const studioVideoPromptDirty = Boolean(studioVideoPromptDraftRecord?.dirty);
  useEffect(() => {
    if (!manualStudioBaseTarget || !studioVideoPromptDraftKey || studioVideoPromptDraftRecord) return;
    setStudioVideoPromptDrafts((current) => ({
      ...current,
      [studioVideoPromptDraftKey]: { text: manualStudioBaseTarget.videoPrompt, dirty: false },
    }));
  }, [manualStudioBaseTarget, studioVideoPromptDraftKey, studioVideoPromptDraftRecord]);
  const manualStudioTarget = useMemo<ManualStudioGenerationTarget | null>(() => {
    if (!manualStudioBaseTarget) return null;
    const selectedBoards = manualStudioAssetBoards.filter((board) => selectedManualReferenceBoardItemIds.includes(board.boardItemId));
    return {
      ...manualStudioBaseTarget,
      videoPrompt: studioVideoPromptDraft,
      assetIds: Array.from(new Set(selectedBoards.map((board) => board.assetId))),
      assetBoardItemIds: selectedBoards.map((board) => board.boardItemId),
      includeStoryboardReference: generationTargetSelection.kind === "storyboard_board" && includeStoryboardReference,
      selectedReferenceImages: manualStudioAdoptedImageOptions
        .filter((option) => selectedReferenceImageTakeIds.includes(option.id))
        .map((option) => ({ takeId: option.id, shotId: option.shotId, mediaUrl: option.mediaUrl, displayName: option.label })),
      selectedReferenceVideos: manualStudioPriorVideoOptions
        .filter((option) => selectedReferenceVideoTakeIds.includes(option.id))
        .map((option) => ({ takeId: option.takeId, shotId: option.shotId, mediaUrl: option.mediaUrl, displayName: option.label, durationSeconds: option.durationSeconds })),
      selectedDialogueTrackIds,
      selectedVoiceReferenceIds,
    };
  }, [generationTargetSelection.kind, includeStoryboardReference, manualStudioAdoptedImageOptions, manualStudioAssetBoards, manualStudioBaseTarget, manualStudioPriorVideoOptions, selectedDialogueTrackIds, selectedManualReferenceBoardItemIds, selectedReferenceImageTakeIds, selectedReferenceVideoTakeIds, selectedVoiceReferenceIds, studioVideoPromptDraft]);
  const manualStudioVideoUnitIssue = manualStudioStructuralUnitIssue || (manualStudioWorkflow && selectedVideoAdapter
    ? persistedUnitShotIds.length > 1 && !selectedVideoAdapter.capabilities.multiShot
      ? { message: "当前生成方式不支持一个视频单元包含多个分镜；请返回故事板拆分视频单元，系统不会在摄影棚生成隐藏单元。" }
      : persistedUnitDuration < Math.max(selectedVideoAdapter.limits.minDurationSeconds || 0, localMiniMaxH3 ? 5 : 0)
        ? { message: `当前视频单元为 ${persistedUnitDuration}s，低于所选生成方式最短时长。` }
        : selectedVideoAdapter.limits.maxDurationSeconds && persistedUnitDuration > selectedVideoAdapter.limits.maxDurationSeconds
          ? { message: `当前视频单元为 ${persistedUnitDuration}s，超过所选生成方式最长 ${selectedVideoAdapter.limits.maxDurationSeconds}s；请返回故事板拆分视频单元或分镜。` }
          : undefined
    : undefined);
  const supportsVideoStartFrame = Boolean(selectedVideoAdapter?.capabilities.firstFrame);
  const supportsVideoEndFrame = Boolean(selectedVideoAdapter?.capabilities.lastFrame);
  const selectedModeContract = selectedVideoAdapter?.modes[0];
  const videoModelLabel = configuredVideoModel
    ? `${configuredVideoModel.alias} (${configuredVideoModel.modelId})`
    : "当前视频模型";
  const manualStudioTargetShot = activeScene?.shots?.find((shot) => shot.id === manualStudioBaseTarget?.shotId)
    || selectedShot;
  const manualStudioFrameCandidates = useMemo(
    () => buildManualStudioFrameReferenceCandidates(manualStudioReferenceShots),
    [manualStudioReferenceShots],
  );
  const selectedStartFrameCandidate = manualStudioFrameCandidates.start.find((candidate) => candidate.id === startFrameTakeId);
  const effectiveStartFrameCandidate = selectedStartFrameCandidate
    || (selectedModeContract?.requiresStartFrame ? manualStudioFrameCandidates.start[0] : undefined);
  const effectiveStartFrameTakeId = effectiveStartFrameCandidate?.id || "";
  const manualStudioAvailableEndFrameCandidates = filterManualStudioDistinctEndFrameCandidates(
    effectiveStartFrameCandidate,
    manualStudioFrameCandidates.end,
  );
  const selectedEndFrameCandidate = manualStudioAvailableEndFrameCandidates.find((candidate) => (
    candidate.id === endFrameTakeId
  ));
  const fallbackEndFrameCandidate = selectedModeContract?.requiresEndFrame
    ? manualStudioAvailableEndFrameCandidates.find((candidate) => candidate.adopted)
      || manualStudioAvailableEndFrameCandidates[0]
    : undefined;
  const effectiveEndFrameCandidate = selectedEndFrameCandidate || fallbackEndFrameCandidate;
  const effectiveEndFrameTakeId = effectiveEndFrameCandidate?.id || "";
  const selectedStartFrameUrl = effectiveStartFrameCandidate?.mediaUrl;
  const selectedEndFrameUrl = effectiveEndFrameCandidate?.mediaUrl;
  const selectedStoryboardReferenceAvailable = Boolean(manualStudioBaseTarget && (
    manualStudioBaseTarget.storyboardReferenceMode === "director_board"
      ? manualStudioBaseTarget.storyboardImageUrl
      : manualStudioBaseTarget.videoReferenceImageUrl
  ));
  const manualStudioReferenceIssue = selectedModeContract?.requiresStartFrame && !selectedStartFrameUrl
    ? { message: "当前生成方式需要选择一张已采用的首帧画面。" }
    : selectedModeContract?.requiresEndFrame && !selectedEndFrameUrl
      ? { message: "当前生成方式需要选择一张与首帧不同的尾帧画面。" }
      : effectiveStartFrameCandidate?.mediaIdentity && effectiveStartFrameCandidate.mediaIdentity === effectiveEndFrameCandidate?.mediaIdentity
        ? { message: "首帧和尾帧必须选择不同画面。" }
      : (selectedVideoAdapter?.capabilities.referenceImages || selectedVideoAdapter?.capabilities.referenceVideos) && !(
        (selectedVideoAdapter.capabilities.referenceImages && (
          selectedManualReferenceBoardItemIds.length
          || selectedReferenceImageTakeIds.length
          || (includeStoryboardReference && selectedStoryboardReferenceAvailable)
        ))
        || (selectedVideoAdapter.capabilities.referenceVideos && selectedReferenceVideoTakeIds.length)
      )
        ? { message: "多素材参考方式至少需要手动选择一张图片或一段历史视频；声音不能单独作为视觉参考。" }
        : undefined;
  const manualStudioGenerationReady = Boolean(
    manualStudioTargetShot && !manualStudioVideoUnitIssue,
  );
  const manualStudioVideoGenerationIssue = !selectedVideoAdapter
    ? "尚未配置视频接口，可使用“复制提示词 / 外部视频”或导入已有视频；接口生成需先配置模型。"
    : manualStudioReferenceIssue?.message || manualStudioVideoUnitIssue?.message;
  const manualStudioSourceHash = generationTargetSelection.kind === "shot"
    ? manualStoryboardReadModel?.videoPromptHash || ""
    : manualVideoStoryboardReadModel?.studioSourceHash || manualVideoStoryboardReadModel?.qaSourceHash || "";
  const manualTargetImageReady = useMemo(() => {
    if (!manualStudioTargetShot || !manualStudioTarget) return false;
    const take = manualStudioTargetShot.takes?.find((item) => item.id === manualStudioTargetShot.activeTakeId);
    const audit = take?.generationAudit;
    return Boolean(manualStudioTarget.storyboardImageUrl || (take?.imageUrl
      && audit?.targetKind === manualStudioTarget.kind
      && audit.shotId === manualStudioTarget.shotId
      && (manualStudioTarget.kind === "shot"
        ? true
        : manualStudioTarget.kind === "storyboard_board"
          ? audit.pageId === manualStudioTarget.pageId
          : audit.panelId === manualStudioTarget.panelId)
      && [...(audit.selectedAssetBoardItemIds || [])].sort().join("|") === [...manualStudioTarget.assetBoardItemIds].sort().join("|")
      && (!activeVisualScenario || audit.visualReuseFingerprint === activeVisualScenario.reuseFingerprint)));
  }, [activeVisualScenario, manualStudioTarget, manualStudioTargetShot]);
  const manualStudioUnitActiveTake = manualStudioWorkflow?.takes?.find((take) => take.id === manualStudioWorkflow.activeTakeId);
  const manualVideoCandidateExists = useMemo(() => Boolean((
    manualStudioTarget?.kind === "storyboard_board"
      ? manualStudioWorkflow?.takes
      : manualStudioTargetShot?.takes
  )?.some((take) => {
    const audit = take.generationAudit;
    if (!audit || audit.action !== "generate_video" || !manualStudioTarget) return false;
    return audit.targetKind === manualStudioTarget.kind
      && audit.shotId === manualStudioTarget.shotId
      && (manualStudioTarget.kind !== "storyboard_board" || audit.pageId === manualStudioTarget.pageId);
  })), [manualStudioTarget, manualStudioTargetShot?.takes, manualStudioWorkflow?.takes]);
  const manualStudioAI = useManualStudioAI({
    project: currentProject,
    episode: activeEpisode,
    scene: activeScene,
    assets: manualProductionAssetReadModel,
    generationReady: manualStudioGenerationReady,
    sourceHash: manualStudioSourceHash,
  });
  const manualAudioStoryboardReadModel = useMemo(() => {
    if (!isDirectorProductionRoute || !selectedAudioTrack?.shotId || !activeScene || !manualStoryboardReadModel) return null;
    const shot = activeScene.shots?.find((item) => item.id === selectedAudioTrack.shotId);
    if (!shot) return null;
    return buildManualVideoStoryboardReadModel({
      workflows: activeScene.manualStoryboard?.boards,
      shot,
      storyboardSourceHash: manualStoryboardReadModel.sourceHash,
      project: currentProject || undefined,
      assets: manualProductionAssetReadModel || undefined,
      scene: activeScene,
    });
  }, [activeScene, currentProject, isDirectorProductionRoute, manualProductionAssetReadModel, manualStoryboardReadModel, selectedAudioTrack?.shotId]);
  const manualAudioGenerationReady = Boolean(activeScene && selectedAudioTrackId);
  const selectedAudioShot = selectedAudioTrack?.shotId
    ? activeScene?.shots?.find((shot) => shot.id === selectedAudioTrack.shotId)
    : undefined;

  // Resolve audio track URLs from global assets if linkedAssetId is present
  const resolvedAudioTracks = useMemo(() => {
    if (!activeScene?.audioTracks) return [];
    return activeScene.audioTracks.map(track => {
      if (track.linkedAssetId && !track.url) {
        const globalAsset = globalAssets.find(a => a.id === track.linkedAssetId);
        const projectAsset = currentProject?.assets.find(a => a.id === track.linkedAssetId);
        
        if (globalAsset) {
          const resolvedUrl = globalAsset.url || globalAsset.imageUrls?.[0];
          if (resolvedUrl) {
            return { ...track, url: resolvedUrl };
          }
        } else if (projectAsset) {
          const resolvedUrl = projectAsset.imageUrl; // For project assets, the URL might be stored in imageUrl
          if (resolvedUrl) {
            return { ...track, url: resolvedUrl };
          }
        }
      }
      return track;
    });
  }, [activeScene?.audioTracks, globalAssets, currentProject?.assets]);

  const resolvedSelectedAudioTrack = useMemo(() => 
    resolvedAudioTracks.find(t => t.id === selectedAudioTrackId),
    [resolvedAudioTracks, selectedAudioTrackId]
  );

  const {
    isGeneratingImage,
    isGeneratingVideo,
    isGeneratingVoice,
    promptModalState,
    setPromptModalState,
    ttsModalState,
    setTtsModalState,
    handlePrepareGenerateImage: aiPrepareGenerateImage,
    handlePrepareGenerateVideo: aiPrepareGenerateVideo,
    handleGenerateVoice: aiGenerateVoice
  } = useStudioAI();
  const episodeFilmExport = useEpisodeFilmExport({ project: currentProject, episode: activeEpisode });

  const handleGenerateImage = () => {
    if (!selectedShot || !activeSceneId || !activeEpisode || !currentProject) return;
    if (isDirectorProductionRoute && manualStudioTarget) {
      manualStudioAI.prepareImage(manualStudioTarget);
      return;
    }
    aiPrepareGenerateImage(selectedShot, activeSceneId, activeEpisode, currentProject);
  };

  const handleGenerateVideo = () => {
    if (!selectedShot || !activeSceneId || !activeEpisode || !currentProject) return;
    if (isDirectorProductionRoute && manualStudioTarget) {
      if (manualStudioVideoGenerationIssue) {
        toast.error(manualStudioVideoGenerationIssue);
        return;
      }
      manualStudioAI.prepareVideo(manualStudioTarget, {
        generationWayId: selectedVideoAdapter?.id,
        startFrameTakeId: effectiveStartFrameTakeId || undefined,
        startFrameUrl: selectedStartFrameUrl,
        endFrameTakeId: effectiveEndFrameTakeId || undefined,
        endFrameUrl: selectedEndFrameUrl,
      });
      return;
    }
    aiPrepareGenerateVideo(selectedShot, activeSceneId, activeEpisode, currentProject);
  };

  const handleGenerateVoice = async () => {
    if (!selectedAudioTrack || !activeSceneId || !activeEpisode || !currentProject) return;
    if (isDirectorProductionRoute) {
      const audioShot = activeScene?.shots?.find((shot) => shot.id === selectedAudioTrack.shotId);
      if (!audioShot) {
        toast.error("当前音轨没有可追溯的 Shot。");
        return;
      }
      await aiGenerateVoice(selectedAudioTrack, activeSceneId, activeEpisode, currentProject, {
        governed: true,
        sourceHash: manualStoryboardReadModel?.sourceHash || manualStoryboardHash({ shotId: audioShot.id, dialogue: selectedAudioTrack.text }),
        contextSummary: `${activeScene?.title || "当前场景"} / ${audioShot.visualAction || "当前 Shot"} / ${currentProject.characters.find((character) => character.id === selectedAudioTrack.characterId)?.name || selectedAudioTrack.speakerName || selectedAudioTrack.characterId || "旁白"}`,
      });
      return;
    }
    await aiGenerateVoice(selectedAudioTrack, activeSceneId, activeEpisode, currentProject);
  };

  const handleSynthesize = async () => {
    try {
      await episodeFilmExport.refreshCoverage();
      setIsFilmExportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法检查整集导出状态。");
    }
  };

  const handleAdoptTake = (takeId: string) => {
    if (!selectedShot || !activeScene || !activeEpisode) return;
    if (manualStudioTarget?.kind === "storyboard_board" && manualStudioWorkflow && activeScene.manualStoryboard) {
      const take = manualStudioWorkflow.takes?.find((item) => item.id === takeId);
      if (!take) return;
      if (!isShotTakeReadyForAdoption(take)) {
        toast.error("候选尚未生成完成，不能采用。");
        return;
      }
      const currentUnitId = manualStudioWorkflow.videoGenerationUnitId
        || manualStudioWorkflow.board?.videoGenerationUnitId
        || manualStudioWorkflow.id;
      updateScene(activeScene.id, {
        manualStoryboard: {
          ...activeScene.manualStoryboard,
          boards: (activeScene.manualStoryboard.boards || []).map((workflow) => workflow.unitSchema === "storyboard_unit.v1" && (
            workflow.videoGenerationUnitId || workflow.board?.videoGenerationUnitId || workflow.id
          ) === currentUnitId ? { ...workflow, activeTakeId: takeId, updatedAt: Date.now() } : workflow),
          updatedAt: Date.now(),
        },
      }, activeEpisode.id);
      setPreviewTakeId(takeId);
      return;
    }
    const take = selectedShot.takes?.find((item) => item.id === takeId);
    if (!take) return;
    const scope = shotTakeHasVideoIntent(take) ? "video" as const : "image" as const;
    if (!isShotTakeReadyForAdoption(take, scope)) {
      toast.error("候选尚未生成完成，不能采用。");
      return;
    }
    updateScene(activeScene.id, {
      shots: activeScene.shots?.map((shot) => shot.id === selectedShot.id
        ? adoptShotTake(shot, take.id, scope)
        : shot),
    }, activeEpisode.id);
    setPreviewTakeId(takeId);
  };

  const handleToggleManualReferenceBoard = (boardItemId: string) => {
    updateStudioReferenceDraft((current) => ({
      ...current,
      selectedBoardItemIds: current.selectedBoardItemIds.includes(boardItemId)
        ? current.selectedBoardItemIds.filter((item) => item !== boardItemId)
        : [...current.selectedBoardItemIds, boardItemId],
    }));
  };

  const handleGenerationWayChange = (adapterId: string) => {
    if (adapterId === selectedVideoAdapter?.id) return;
    const hasReferenceChoices = Boolean(
      selectedManualReferenceBoardItemIds.length
      || includeStoryboardReference
      || selectedReferenceImageTakeIds.length
      || selectedReferenceVideoTakeIds.length
      || selectedDialogueTrackIds.length
      || selectedVoiceReferenceIds.length
      || startFrameTakeId
      || endFrameTakeId,
    );
    if (hasReferenceChoices) {
      toast("当前生成方式的参考选择已保留，不会提交给新方式；切换回来会自动恢复。");
    }
    setSelectedVideoAdapterId(adapterId);
  };

  const [isParamsModalOpen, setIsParamsModalOpen] = useState(false);
  const [localAudioText, setLocalAudioText] = useState("");
  const [isTimelineOpen, setIsTimelineOpen] = useState(false);

  useEffect(() => {
    if (selectedAudioTrack) {
      setLocalAudioText(selectedAudioTrack.text || "");
    }
  }, [selectedAudioTrack]);

  const handleAudioTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalAudioText(e.target.value);
    if (selectedAudioTrack && activeSceneId && activeEpisode) {
      const updatedTracks = activeScene.audioTracks?.map(t => 
        t.id === selectedAudioTrack.id ? { ...t, text: e.target.value } : t
      );
      updateScene(activeSceneId, { audioTracks: updatedTracks }, activeEpisode.id);
    }
  };

  const handleUpdateCharacter = (characterId: string) => {
    if (selectedAudioTrack && activeSceneId && activeEpisode) {
      const updatedTracks = activeScene.audioTracks?.map(t => 
        t.id === selectedAudioTrack.id ? { ...t, characterId } : t
      );
      updateScene(activeSceneId, { audioTracks: updatedTracks }, activeEpisode.id);
    }
  };

  const handleUpdateAudioTrack = (updates: Partial<AudioTrack>) => {
    if (selectedAudioTrack && activeSceneId && activeEpisode) {
      const updatedTracks = activeScene.audioTracks?.map(t => 
        t.id === selectedAudioTrack.id ? { ...t, ...updates } : t
      );
      updateScene(activeSceneId, { audioTracks: updatedTracks }, activeEpisode.id);
    }
  };

  const boundAssets = useMemo(() => {
    if (!selectedShot || !currentProject) return [];
    const governedTargetIds = isDirectorProductionRoute && manualStudioTarget ? new Set(manualStudioTarget.assetIds) : null;
    const assetIds = governedTargetIds
      ? Array.from(governedTargetIds)
      : [...(selectedShot.propIds || []), selectedShot.locationId].filter(Boolean) as string[];
    const characterIds = governedTargetIds ? Array.from(governedTargetIds) : selectedShot.characterIdsInShot || [];
    
    return [
      ...currentProject.assets.filter(a => assetIds.includes(a.id)),
      ...currentProject.characters.filter(c => characterIds.includes(c.id))
    ];
  }, [selectedShot, currentProject, isDirectorProductionRoute, manualStudioTarget]);

  // Calculate shot positions and total duration
  const { shotPositions, totalDuration } = useMemo(() => {
    if (!activeScene || !activeScene.shots) return { shotPositions: [], totalDuration: 0 };
    let currentStart = 0;
    const positions = sceneVideoClips(activeScene).map(shot => {
      const start = currentStart;
      const duration = shot.duration || 5;
      currentStart += duration;
      return { ...shot, start, duration };
    });
    return { shotPositions: positions, totalDuration: currentStart };
  }, [activeScene]);

  const {
    isPlaying,
    currentTime,
    toggle: togglePlay,
    setCurrentTime,
    stop: stopPlayback,
  } = usePlayback({
    totalDuration,
    onEnded: () => {
      if (videoRef.current) videoRef.current.pause();
      Object.values(audioRefs.current).forEach(audio => audio && audio.pause());
    }
  });

  // Determine which shot is currently playing based on currentTime
  const playingShot = useMemo(() => {
    if (shotPositions.length === 0) return null;
    return shotPositions.find(s => currentTime >= s.start && currentTime < s.start + s.duration) || shotPositions[shotPositions.length - 1];
  }, [currentTime, shotPositions]);
  const manualStudioTakeOwnerShot = manualStudioTarget?.kind === "storyboard_board" && selectedShot
    ? {
        ...selectedShot,
        takes: manualStudioWorkflow?.takes || [],
        activeTakeId: manualStudioWorkflow?.activeTakeId,
        imageUrl: manualStudioUnitActiveTake?.imageUrl,
        imageMedia: manualStudioUnitActiveTake?.imageMedia,
        videoUrl: manualStudioUnitActiveTake?.videoUrl,
        videoMedia: manualStudioUnitActiveTake?.videoMedia,
    }
    : selectedShot;
  useEffect(() => {
    setPreviewTakeId(null);
  }, [activeEpisode?.id, activeSceneId, currentProject?.id, manualStudioTarget?.kind, manualStudioTarget?.videoGenerationUnitId, selectedShotId]);
  const previewTake = manualStudioTakeOwnerShot?.takes?.find((take) => take.id === previewTakeId);
  const manualStudioUnitPlaybackRange = useMemo(() => {
    if (manualStudioTarget?.kind !== "storyboard_board") return null;
    return resolveManualStudioUnitPlaybackRange({
      shotPositions,
      shotIds: manualStudioTarget.shotIds || [manualStudioTarget.shotId],
    });
  }, [manualStudioTarget, shotPositions]);
  const unitVideoCoversCurrentTime = Boolean(
    manualStudioUnitPlaybackRange
    && currentTime >= manualStudioUnitPlaybackRange.start
    && currentTime < manualStudioUnitPlaybackRange.end,
  );
  const timelineStudioPreviewShot = playingShot;
  const studioPreviewPlayingShot = previewTake && manualStudioTakeOwnerShot
    ? {
        ...(timelineStudioPreviewShot || manualStudioTakeOwnerShot),
        imageUrl: previewTake.imageUrl,
        imageMedia: previewTake.imageMedia,
        videoUrl: previewTake.videoUrl,
        videoMedia: previewTake.videoMedia,
      }
    : timelineStudioPreviewShot;
  const previewClipIndex = shotPositions.findIndex(item => item.id === studioPreviewPlayingShot?.id);
  const previewOpacity = studioPreviewPlayingShot ? filmPreviewOpacity(
    currentTime - ("start" in studioPreviewPlayingShot ? Number(studioPreviewPlayingShot.start || 0) : 0),
    studioPreviewPlayingShot.duration, studioPreviewPlayingShot.transition, shotPositions[previewClipIndex + 1]?.transition,
  ) : 1;

  const selectStudioScene = (sceneId: string) => {
    setActiveSceneId(sceneId);
    setSelectedShotId(null);
    setSelectedAudioTrackId(null);
    setCurrentTime(0);
    const next = new URLSearchParams(searchParams);
    next.set("sceneId", sceneId);
    next.delete("shotId");
    if (activeEpisode?.id) next.set("episodeId", activeEpisode.id);
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (!queryProjectId || currentProject?.id === queryProjectId) return;
    void loadProject(queryProjectId, {
      episodeView: isDirectorProductionRoute ? studioEpisodeView : undefined,
      sceneId: isDirectorProductionRoute ? urlSceneId || undefined : undefined,
      shotId: isDirectorProductionRoute && studioEpisodeView === "storyboard-index"
        ? urlShotId || undefined
        : undefined,
    });
  }, [
    currentProject?.id,
    isDirectorProductionRoute,
    loadProject,
    queryProjectId,
    studioEpisodeView,
    urlSceneId,
    urlShotId,
  ]);

  useEffect(() => {
    if (!isDirectorProductionRoute || !urlEpisodeId || !currentProject?.episodes.some((episode) => episode.id === urlEpisodeId) || activeEpisode?.id === urlEpisodeId) return;
    void setActiveEpisodeId(urlEpisodeId, {
      view: studioEpisodeView,
      sceneId: urlSceneId || undefined,
      shotId: studioEpisodeView === "storyboard-index" ? urlShotId || undefined : undefined,
    });
  }, [
    activeEpisode?.id,
    currentProject?.episodes,
    isDirectorProductionRoute,
    setActiveEpisodeId,
    studioEpisodeView,
    urlEpisodeId,
    urlSceneId,
    urlShotId,
  ]);

  useEffect(() => {
    if (!isDirectorProductionRoute || !activeEpisode) return;
    const workspaceEpisode = activeEpisode as typeof activeEpisode & {
      __workspaceView?: string;
      __workspaceSceneScope?: string;
      __workspaceShotSummaryOnly?: boolean;
      __workspaceShotScope?: string;
    };
    const expectedSceneScope = urlSceneId || activeSceneId || undefined;
    const expectsShotSummaries = studioEpisodeView === "storyboard-index";
    const expectedShotScope = expectsShotSummaries
      ? selectedShotId || undefined
      : undefined;
    if (
      workspaceEpisode.__workspaceView === "storyboard"
      && (!expectedSceneScope || workspaceEpisode.__workspaceSceneScope === expectedSceneScope)
      && Boolean(workspaceEpisode.__workspaceShotSummaryOnly) === expectsShotSummaries
      && (!expectsShotSummaries || workspaceEpisode.__workspaceShotScope === expectedShotScope)
    ) return;
    void setActiveEpisodeId(activeEpisode.id, {
      view: studioEpisodeView,
      sceneId: expectedSceneScope,
      shotId: expectedShotScope,
    });
  }, [
    activeEpisode,
    activeSceneId,
    isDirectorProductionRoute,
    selectedShotId,
    setActiveEpisodeId,
    studioEpisodeView,
    urlSceneId,
  ]);

  useEffect(() => {
    const nextScene = baseScenes.find((scene) => scene.id === urlSceneId) || baseScenes[0];
    if (nextScene && nextScene.id !== activeSceneId) setActiveSceneId(nextScene.id);
    const requestedUnit = urlVideoUnitId
      ? nextScene?.manualStoryboard?.boards?.find((workflow) => (
          workflow.unitSchema === "storyboard_unit.v1"
          && (workflow.videoGenerationUnitId === urlVideoUnitId
            || workflow.board?.videoGenerationUnitId === urlVideoUnitId)
        ))
      : undefined;
    const requestedUnitFirstShotId = requestedUnit?.shotIds?.[0]
      || requestedUnit?.board?.shotIds?.[0]
      || requestedUnit?.shotId;
    const nextShotId = urlShotId || requestedUnitFirstShotId;
    const nextShot = nextShotId ? nextScene?.shots?.find((shot) => shot.id === nextShotId) : undefined;
    const requestedUnitKey = requestedUnit && nextScene && urlVideoUnitId
      ? `${nextScene.id}:${urlVideoUnitId}`
      : null;
    if (requestedUnitKey && positionedVideoUnitRef.current !== requestedUnitKey && requestedUnitFirstShotId) {
      const firstShotIndex = nextScene?.shots?.findIndex((shot) => shot.id === requestedUnitFirstShotId) ?? -1;
      if (firstShotIndex >= 0) {
        const unitStart = (nextScene?.shots || [])
          .slice(0, firstShotIndex)
          .reduce((sum, shot) => sum + Number(shot.duration || 5), 0);
        setCurrentTime(unitStart);
        positionedVideoUnitRef.current = requestedUnitKey;
      }
    } else if (!urlVideoUnitId) {
      positionedVideoUnitRef.current = null;
    }
    if (nextShot && nextShot.id !== selectedShotId) {
      setSelectedShotId(nextShot.id);
    } else if (!nextShotId && selectedShotId) {
      setSelectedShotId(null);
    }
  }, [activeSceneId, baseScenes, selectedShotId, setCurrentTime, urlSceneId, urlShotId, urlVideoUnitId]);

  useEffect(() => {
    if (!activeSceneId && baseScenes.length > 0) {
      setActiveSceneId(baseScenes[0].id);
    }
  }, [activeSceneId, baseScenes]);

  useEffect(() => {
    if (!activeScene?.shots?.length) {
      if (selectedShotId) setSelectedShotId(null);
      return;
    }
    if (selectedShotId && !activeScene.shots.some((shot) => shot.id === selectedShotId)) {
      setSelectedShotId(null);
    }
  }, [activeScene, selectedShotId]);

  const selectStudioShot = (shotId: string | null, start?: number) => {
    setSelectedShotId(shotId);
    setSelectedAudioTrackId(null);
    if (typeof start === "number") setCurrentTime(start);
    const next = new URLSearchParams(searchParams);
    if (shotId) next.set("shotId", shotId);
    else next.delete("shotId");
    if (activeSceneId) next.set("sceneId", activeSceneId);
    if (activeEpisode?.id) next.set("episodeId", activeEpisode.id);
    setSearchParams(next, { replace: true });
  };

  const selectStudioAudioTrack = (trackId: string | null, start?: number) => {
    setSelectedAudioTrackId(trackId);
    setSelectedShotId(null);
    if (typeof start === "number") setCurrentTime(start);
    const next = new URLSearchParams(searchParams);
    next.delete("shotId");
    setSearchParams(next, { replace: true });
  };

  const selectGenerationTarget = (selection: StudioGenerationTargetSelection) => {
    if (studioVideoPromptDirty && selection.kind !== generationTargetSelection.kind) {
      const confirmed = window.confirm("当前摄影棚视频提示词有未提交到 Take 的修改。切换生成对象会放弃这份草稿，是否继续？");
      if (!confirmed) return;
    }
    if (studioVideoPromptDirty && studioVideoPromptDraftKey) {
      setStudioVideoPromptDrafts((current) => {
        const next = { ...current };
        delete next[studioVideoPromptDraftKey];
        return next;
      });
    }
    setGenerationTargetSelection(selection);
    const next = new URLSearchParams(searchParams);
    next.set("videoMode", selection.kind === "shot" ? "shot" : "storyboard");
    if (selection.kind === "storyboard_board" && selection.panelId) next.set("panelId", selection.panelId);
    else next.delete("panelId");
    setSearchParams(next, { replace: true });
  };

  const setStudioStoryboardReferenceMode = async (mode: "shot_grid" | "director_board") => {
    if (!activeScene?.manualStoryboard || !manualStudioWorkflow?.board || !activeEpisode?.id) return;
    const workflowId = manualStudioWorkflow.id;
    const now = Date.now();
    await updateScene(activeScene.id, {
      manualStoryboard: {
        ...activeScene.manualStoryboard,
        boards: (activeScene.manualStoryboard.boards || []).map((workflow) => (
          workflow.unitSchema === "storyboard_unit.v1" && workflow.id === workflowId
            ? { ...workflow, board: workflow.board ? { ...workflow.board, visualReferenceMode: mode } : workflow.board, updatedAt: now }
            : workflow
        )),
        updatedAt: now,
      },
    }, activeEpisode.id);
    toast.success(mode === "shot_grid" ? "已同步选择宫格模式" : "已同步选择故事板模式");
  };

  useEffect(() => {
    if (urlVideoGenerationMode === "shot" && !urlVideoUnitId) {
      setGenerationTargetSelection({ kind: "shot" });
      return;
    }
    const board = manualStudioWorkflow?.board;
    const firstPage = board
      ? (board.visualPages?.length ? board.visualPages : buildStoryboardCompositeVisualPages(board))[0]
      : undefined;
    if (firstPage) setGenerationTargetSelection({ kind: "storyboard_board", pageId: firstPage.id });
  }, [manualStudioWorkflow?.board, selectedShotId, urlVideoGenerationMode, urlVideoUnitId]);

  useEffect(() => {
    const board = manualStudioWorkflow?.board;
    if (!urlPanelId || !board?.panels.some((panel) => panel.id === urlPanelId)) return;
    const page = (board.visualPages?.length ? board.visualPages : buildStoryboardCompositeVisualPages(board))
      .find((item) => item.panelIds.includes(urlPanelId));
    if (!page) return;
    setGenerationTargetSelection((current) => current.kind === "storyboard_board" && current.pageId === page.id && current.panelId === urlPanelId
      ? current
      : { kind: "storyboard_board", pageId: page.id, panelId: urlPanelId });
  }, [
    manualStudioWorkflow?.board?.panels,
    manualStudioWorkflow?.board?.visualPages,
    urlPanelId,
  ]);

  useEffect(() => {
    if (videoRef.current && studioPreviewPlayingShot) {
      const previewStart = "start" in studioPreviewPlayingShot
        ? Number(studioPreviewPlayingShot.start || 0)
        : 0;
      const localTime = Math.max(0, currentTime - previewStart) + (studioPreviewPlayingShot.sourceStartSeconds || 0);

      if (videoRef.current.getAttribute("src") !== studioPreviewPlayingShot.videoUrl && studioPreviewPlayingShot.videoUrl) {
        videoRef.current.src = studioPreviewPlayingShot.videoUrl;
      }

      if (studioPreviewPlayingShot.videoUrl) {
        if (Math.abs(videoRef.current.currentTime - localTime) > 0.5) {
          videoRef.current.currentTime = localTime;
        }
        if (isPlaying && videoRef.current.paused) {
          videoRef.current.play().catch(e => console.error("Video play error:", summarizeUnknownError(e)));
        } else if (!isPlaying && !videoRef.current.paused) {
          videoRef.current.pause();
        }
      }

    }

    if (resolvedAudioTracks.length > 0) {
      resolvedAudioTracks.forEach(track => {
        const audioEl = audioRefs.current[track.id];
        if (!audioEl || !track.url) return;
        audioEl.volume = Math.max(0, Math.min(1, track.volume ?? 1));
        audioEl.muted = isMuted || Boolean(track.muted);

        const trackLocalTime = currentTime - track.startTime + (track.sourceStartSeconds || 0);
        const isWithinTrack = currentTime >= track.startTime && currentTime < track.startTime + (track.duration || 5);

        if (isWithinTrack) {
          if (Math.abs(audioEl.currentTime - trackLocalTime) > 0.5) {
            audioEl.currentTime = trackLocalTime;
          }
          if (isPlaying && audioEl.paused) {
            audioEl.play().catch(e => console.error("Audio play error:", summarizeUnknownError(e)));
          } else if (!isPlaying && !audioEl.paused) {
            audioEl.pause();
          }
        } else {
          if (!audioEl.paused) {
            audioEl.pause();
          }
        }
      });
    }
  }, [currentTime, studioPreviewPlayingShot, isPlaying, isMuted, resolvedAudioTracks, shotPositions]);

  const handleSeek = (time: number) => {
    setCurrentTime(time);
  };

  if (isRequestedProjectPending || isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-bg-primary text-sm font-semibold text-text-muted">
        正在加载指定制片项目…
      </div>
    );
  }

  if (!currentProject || !activeEpisode || !activeScene) {
    const preparationHref = productionPreparationHref({ projectId: currentProject?.id, episodeId: activeEpisode?.id, returnTo: interactiveReturnTo });
    return (
      <div className="flex-1 bg-white dark:bg-neutral-950 flex flex-col items-center justify-center">
        <EmptyState
          icon={Settings2}
          title={currentProject ? "未选择可制作的场次" : "选择制片项目"}
          description={currentProject ? "请到剧本与场次选择或拆解场次，再进入摄影棚制作。" : "请先选择制片项目，或导入剧本开始制作。"}
          actionLabel={isInteractiveNodeWorkspace ? "返回互动影视" : currentProject ? "前往剧本与场次" : "前往导演制片"}
          onAction={() => {
            navigate(isInteractiveNodeWorkspace ? interactiveReturnTo || "/interactive" : preparationHref);
          }}
        />
      </div>
    );
  }

  return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={`flex flex-col h-full overflow-hidden bg-bg-primary text-text-primary ${
          isFullscreen ? "fixed inset-0 z-[100] w-screen h-screen" : ""
        }`}
      >
        {isInteractiveNodeWorkspace && (
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-soft/20 bg-bg-surface-soft px-5 text-xs font-bold text-gold">
            <span>旧互动节点摄影棚已退役 · 当前内容仅供只读核对：{activeScene?.title || nodeId}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => navigate('/interactive')} className="rounded-lg bg-bg-surface border border-border-soft/20 px-3 py-1 text-text-secondary hover:text-text-primary">返回互动影视</button>
            </div>
          </div>
        )}
        {interactiveReturnTo && !isInteractiveNodeWorkspace && (
          <div className="flex h-10 shrink-0 items-center border-b border-border-soft/20 bg-bg-surface-soft px-5">
            <button
              type="button"
              onClick={() => navigate(interactiveReturnTo)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gold hover:opacity-80"
            >
              返回互动制片
            </button>
          </div>
        )}
        {isDirectorProductionRoute && productionPreparationGate && !productionPreparationGate.readyForStoryboard && (
          <div className="flex shrink-0 items-center justify-between gap-5 border-b border-border-soft/20 bg-bg-surface px-5 py-2.5 text-amber-400">
            <p className="text-xs font-bold">
              {productionPreparationGate.readyForShotPlanning
                && productionPreparationGate.assetPackConfirmed
                && productionPreparationGate.coordinationConfirmed
                ? "媒体生成暂不可用"
                : "摄影棚筹备尚未完成"}
              ：{productionPreparationGate.reason}
            </p>
            <button type="button" onClick={() => {
              const params = new URLSearchParams({
                projectId: currentProject.id,
                episodeId: activeEpisode.id,
                sceneId: activeScene.id,
                tab: "review",
              });
              if (interactiveReturnTo) params.set("returnTo", interactiveReturnTo);
              navigate(`/production/preparation?${params.toString()}`);
            }} className="h-7 shrink-0 border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-bold text-amber-400 hover:bg-amber-500/20 rounded-lg transition-all cursor-pointer">返回剧本与场次</button>
          </div>
        )}
        <ProductionPreparationAdvisories gate={productionPreparationGate} sceneTitle={activeScene?.title} />
        {/* Top Half */}
        <div
          aria-busy={isSceneDetailPending}
          className="relative flex-1 min-h-0 overflow-y-auto md:flex md:flex-row md:overflow-hidden"
        >
          {isSceneDetailPending && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg-primary/70 backdrop-blur-[1px]">
              <div role="status" className="rounded-lg border border-border-soft/20 bg-bg-surface px-4 py-2 text-xs font-bold text-gold shadow-lg">
                正在加载当前场次…
              </div>
            </div>
          )}
          {/* Left Column: Media Pool & Scene Selector */}
          {showMediaPool && <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-border-soft/10 bg-bg-surface flex flex-col shrink-0 transition-colors duration-200 min-h-0">
            {/* Scene / Node Selector */}
            <div className="p-3 border-b border-border-soft/10 bg-bg-surface-soft/50">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                {currentProject?.projectModel === 'interactive' ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse"></span>
                    所属父节点 (Node)
                  </>
                ) : '当前场景 (SCENE)'}
              </label>
              {currentProject?.projectModel === 'interactive' && (
                <p className="mb-1.5 text-[10px] font-medium text-gold">
                  读取源：{sceneReadModel.sourceLabel}；写入目标：{sceneReadModel.writeTarget}
                </p>
              )}
              <select 
                aria-label="当前场景"
                value={activeSceneId || ''} 
                onChange={(event) => selectStudioScene(event.target.value)}
                className="w-full bg-bg-surface-soft border border-border-soft/20 rounded-xl p-2 text-xs font-bold text-text-primary focus:border-gold/40 outline-none appearance-none cursor-pointer"
              >
                {baseScenes.map((scene, idx) => (
                  <option key={scene.id} value={scene.id}>
                    {currentProject?.projectModel === 'interactive' 
                      ? `${activeEpisode?.gameData?.nodes?.find(n => n.id === scene.id)?.isEnding ? '🏁' : '⚪'} [${idx + 1}] ${scene.title}` 
                      : `${idx + 1}. ${scene.title || '未命名场景'}`}
                  </option>
                ))}
              </select>
              {isSceneDetailPending && (
                <p role="status" className="mt-2 text-[10px] font-bold text-gold">
                  正在加载当前场次…
                </p>
              )}
              {(activeScene.interactiveMetadata?.visualScenarios?.length || 0) > 1 && (
                <div className="mt-2">
                  <label className="mb-1 block text-[10px] font-bold text-text-muted">
                    当前画面状态
                  </label>
                  <select
                    value={activeVisualScenario?.id || ""}
                    onChange={(event) => {
                      if (!activeEpisode || !activeScene.interactiveMetadata) return;
                      updateScene(activeScene.id, {
                        interactiveMetadata: {
                          ...activeScene.interactiveMetadata,
                          activeVisualScenarioId: event.target.value,
                        },
                      }, activeEpisode.id);
                    }}
                    className="w-full rounded-lg border border-border-soft/20 bg-bg-surface-soft p-2 text-xs font-bold text-text-primary outline-none focus:border-gold/40"
                  >
                    {activeScene.interactiveMetadata.visualScenarios?.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>{scenario.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] leading-4 text-text-muted">
                    AI 会按此状态生成独立画面，不会误用其他状态的视频。
                  </p>
                </div>
              )}
            </div>

            <StudioAssetList
            shotPositions={shotPositions}
            audioTracks={resolvedAudioTracks}
            selectedShotId={selectedShotId}
            selectedAudioTrackId={selectedAudioTrackId}
            onSelectShot={(id, start) => {
              selectStudioShot(id, start);
            }}
            onSelectAudioTrack={(id, start) => {
              selectStudioAudioTrack(id, start);
            }}
          />
          </div>}

          {/* Center Column: Viewer */}
          <StudioPreview
            showMediaPool={showMediaPool}
            showInspector={showInspector}
            onToggleMediaPool={() => setShowMediaPool(value => !value)}
            onToggleInspector={() => setShowInspector(value => !value)}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
            isPlaying={isPlaying}
            togglePlay={togglePlay}
            isMuted={isMuted}
            playingShot={studioPreviewPlayingShot}
            previewOpacity={previewOpacity}
            audioTracks={resolvedAudioTracks}
            videoRef={videoRef}
            audioRefs={audioRefs}
            onSynthesize={handleSynthesize}
            isSynthesizing={episodeFilmExport.isExporting}
            takeShot={manualStudioTakeOwnerShot}
            previewTakeId={previewTakeId || undefined}
            onPreviewTake={setPreviewTakeId}
            onAdoptTake={handleAdoptTake}
            onStripTakeAudio={isDirectorProductionRoute && selectedShot && manualStudioTarget?.kind !== "storyboard_board" ? (takeId) => {
              void manualStudioAI.rewriteTakeAudio({ shotId: selectedShot.id, takeId, mode: "strip" });
            } : undefined}
            onReplaceTakeAudio={isDirectorProductionRoute && selectedShot && manualStudioTarget?.kind !== "storyboard_board" ? (takeId, file) => {
              void manualStudioAI.rewriteTakeAudio({ shotId: selectedShot.id, takeId, mode: "replace", replacementAudio: file });
            } : undefined}
            isEditingVideoAudio={manualStudioAI.isEditingVideoAudio}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />

          {/* Right Column: Inspector */}
          {showInspector && <div className="w-full md:w-80 border-t md:border-t-0 md:border-l border-border-soft/10 bg-bg-surface flex flex-col shrink-0 overflow-y-auto transition-colors duration-200">
            <div className="px-4 border-b border-border-soft/10 flex items-center justify-between sticky top-0 bg-bg-surface/90 backdrop-blur-md z-10 h-14">
              <h2 className="text-xs font-bold text-text-primary flex items-center gap-2">
                <div className="w-7 h-7 bg-bg-surface-soft rounded-lg flex items-center justify-center border border-border-soft/20">
                  <Settings2 className="w-3.5 h-3.5 text-gold" />
                </div>
                检查器
              </h2>
              <button
                onClick={() => setIsParamsModalOpen(true)}
                className="p-1.5 hover:bg-bg-surface-soft rounded-lg text-text-muted transition-all hover:text-gold cursor-pointer"
                title="项目生成设置（修改后对整个项目生效）"
                aria-label="打开项目生成设置"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              <InteractiveSceneContextPanel
                project={currentProject}
                episode={activeEpisode}
                scene={activeScene}
              />

              <Suspense fallback={<DeferredStudioPanelFallback />}>
                {selectedShot ? (
                  <>
                    {isDirectorProductionRoute && manualVideoStoryboardReadModel && (
                      <StudioGenerationTargetPicker
                      shot={manualStudioTargetShot || selectedShot}
                      shots={activeScene?.shots || []}
                      workflow={manualStudioWorkflow || manualVideoStoryboardReadModel.workflow}
                      selection={generationTargetSelection}
                      onChange={selectGenerationTarget}
                      readyForStudio={manualStudioGenerationReady}
                      generationWays={configuredVideoAdapters.map((adapter) => ({
                        id: adapter.id,
                        label: adapter.modes[0]?.displayName || adapter.displayName,
                        description: adapter.displayName,
                      }))}
                      selectedGenerationWayId={selectedVideoAdapter?.id || ""}
                      onGenerationWayChange={handleGenerationWayChange}
                      referenceMode={manualStudioWorkflow?.board?.visualReferenceMode || "shot_grid"}
                      onReferenceModeChange={(mode) => void setStudioStoryboardReferenceMode(mode)}
                      videoModelLabel={videoModelLabel}
                    />
                    )}
                    {isDirectorProductionRoute && manualStudioTarget && selectedVideoAdapter && (
                      <StudioReferenceControlPanel
                      target={manualStudioTarget}
                      assetBoards={manualStudioAssetBoards}
                      sceneStates={manualProductionAssetReadModel?.sceneStates || []}
                      selectedBoardItemIds={manualStudioTarget.assetBoardItemIds}
                      onToggleBoardItem={handleToggleManualReferenceBoard}
                      startFrameOptions={manualStudioFrameCandidates.start}
                      endFrameOptions={manualStudioAvailableEndFrameCandidates}
                      startFrameTakeId={effectiveStartFrameTakeId}
                      onSelectStartTake={(takeId) => updateStudioReferenceDraft((current) => ({ ...current, startFrameTakeId: takeId }))}
                      endFrameTakeId={effectiveEndFrameTakeId}
                      onSelectEndTake={(takeId) => updateStudioReferenceDraft((current) => ({ ...current, endFrameTakeId: takeId }))}
                      supportsStartFrame={supportsVideoStartFrame}
                      supportsEndFrame={supportsVideoEndFrame}
                      videoModelLabel={videoModelLabel}
                      generationModeLabel={selectedVideoAdapter?.modes[0]?.displayName || selectedVideoAdapter?.displayName || "当前方式"}
                      requiresStartFrame={Boolean(selectedVideoAdapter?.modes[0]?.requiresStartFrame)}
                      requiresEndFrame={Boolean(selectedVideoAdapter?.modes[0]?.requiresEndFrame)}
                      acceptsReferenceImages={Boolean(selectedVideoAdapter?.capabilities.referenceImages)}
                      acceptsReferenceVideos={Boolean(selectedVideoAdapter?.capabilities.referenceVideos)}
                      acceptsReferenceAudios={Boolean(selectedVideoAdapter?.capabilities.referenceAudios)}
                      includeStoryboardReference={includeStoryboardReference}
                      storyboardReferenceAvailable={Boolean(manualStudioBaseTarget && (
                        manualStudioBaseTarget.storyboardReferenceMode === "director_board"
                          ? manualStudioBaseTarget.storyboardImageUrl
                          : manualStudioBaseTarget.videoReferenceImageUrl
                      ))}
                      onToggleStoryboardReference={() => updateStudioReferenceDraft((current) => ({ ...current, includeStoryboardReference: !current.includeStoryboardReference }))}
                      adoptedImageOptions={manualStudioAdoptedImageOptions}
                      selectedReferenceImageTakeIds={selectedReferenceImageTakeIds}
                      onToggleReferenceImageTake={(takeId) => updateStudioReferenceDraft((current) => ({
                        ...current,
                        selectedImageTakeIds: current.selectedImageTakeIds.includes(takeId)
                          ? current.selectedImageTakeIds.filter((id) => id !== takeId)
                          : [...current.selectedImageTakeIds, takeId],
                      }))}
                      priorVideoOptions={manualStudioPriorVideoOptions}
                      selectedReferenceVideoTakeIds={selectedReferenceVideoTakeIds}
                      onToggleReferenceVideoTake={(takeId) => updateStudioReferenceDraft((current) => ({
                        ...current,
                        selectedVideoCandidateIds: current.selectedVideoCandidateIds.includes(takeId)
                          ? current.selectedVideoCandidateIds.filter((id) => id !== takeId)
                          : [...current.selectedVideoCandidateIds, takeId],
                      }))}
                      dialogueOptions={manualStudioDialogueOptions}
                      selectedDialogueTrackIds={selectedDialogueTrackIds}
                      onToggleDialogueTrack={(trackId) => updateStudioReferenceDraft((current) => ({
                        ...current,
                        selectedDialogueTrackIds: current.selectedDialogueTrackIds.includes(trackId)
                          ? current.selectedDialogueTrackIds.filter((id) => id !== trackId)
                          : [...current.selectedDialogueTrackIds, trackId],
                      }))}
                      voiceOptions={manualStudioVoiceOptions}
                      selectedVoiceReferenceIds={selectedVoiceReferenceIds}
                      onToggleVoiceReference={(referenceId) => updateStudioReferenceDraft((current) => ({
                        ...current,
                        selectedVoiceReferenceIds: current.selectedVoiceReferenceIds.includes(referenceId)
                          ? current.selectedVoiceReferenceIds.filter((id) => id !== referenceId)
                          : [...current.selectedVoiceReferenceIds, referenceId],
                      }))}
                    />
                    )}
                    <StudioShotControls
                    selectedShot={isDirectorProductionRoute && manualStudioTarget ? {
                      ...(manualStudioTargetShot || selectedShot),
                      ...(manualStudioTarget.kind === "storyboard_board" ? {
                        takes: manualStudioWorkflow?.takes || [],
                        activeTakeId: manualStudioWorkflow?.activeTakeId,
                        videoUrl: manualStudioUnitActiveTake?.videoUrl,
                        videoMedia: manualStudioUnitActiveTake?.videoMedia,
                      } : {}),
                      imageUrl: manualTargetImageReady ? (resolveManualStudioStoryboardReferenceUrl(manualStudioTarget) || manualStudioTargetShot?.imageUrl || selectedShot.imageUrl) : undefined,
                      imagePrompt: manualStudioTarget.imagePrompt,
                      videoPrompt: manualStudioTarget.videoPrompt,
                    } : selectedShot}
                    currentProject={currentProject}
                    boundAssets={boundAssets}
                    manualProductionAssetReadModel={manualProductionAssetReadModel}
                    videoGenerationIssue={isDirectorProductionRoute ? manualStudioVideoGenerationIssue : undefined}
                    generationGate={isDirectorProductionRoute ? {
                      ready: manualStudioGenerationReady,
                      label: manualStudioReferenceIssue?.message || (manualStudioGenerationReady ? "可生成，也可导入已有素材" : "请选择镜头或故事板"),
                      reason: manualStudioReferenceIssue?.message
                        || (generationTargetSelection.kind === "storyboard_board" ? manualStudioVideoUnitIssue?.message : undefined)
                        || "请选择镜头或故事板。",
                    } : undefined}
                    promptReadOnly={isDirectorProductionRoute}
                    videoPromptValue={isDirectorProductionRoute ? studioVideoPromptDraft : undefined}
                    videoPromptSourceLabel={isDirectorProductionRoute ? generationTargetSelection.kind === "shot" ? "来源：分镜提示词" : "来源：视频单元提示词" : undefined}
                    videoPromptDirty={isDirectorProductionRoute ? studioVideoPromptDirty : false}
                    onVideoPromptChange={isDirectorProductionRoute ? (value) => {
                      if (!studioVideoPromptDraftKey) return;
                      setStudioVideoPromptDrafts((current) => ({
                        ...current,
                        [studioVideoPromptDraftKey]: {
                          text: value,
                          dirty: value !== (manualStudioBaseTarget?.videoPrompt || ""),
                        },
                      }));
                    } : undefined}
                    onResetVideoPrompt={isDirectorProductionRoute ? () => {
                      if (!studioVideoPromptDraftKey) return;
                      setStudioVideoPromptDrafts((current) => ({
                        ...current,
                        [studioVideoPromptDraftKey]: { text: manualStudioBaseTarget?.videoPrompt || "", dirty: false },
                      }));
                    } : undefined}
                    generationTargetLabel={isDirectorProductionRoute ? manualStudioTarget?.label : undefined}
                    isGeneratingImage={isDirectorProductionRoute ? manualStudioAI.isGeneratingImage : isGeneratingImage}
                    isGeneratingVideo={isDirectorProductionRoute ? manualStudioAI.isGeneratingVideo : isGeneratingVideo}
                    isGeneratingDraftImage={isDirectorProductionRoute ? manualStudioAI.isGeneratingDraftImage : false}
                    isImportingMedia={isDirectorProductionRoute ? manualStudioAI.isImportingMedia : false}
                    hasVideoCandidate={isDirectorProductionRoute ? manualVideoCandidateExists : false}
                    draftPreviewUsable={isDirectorProductionRoute
                      && Boolean(selectedShot.draftPreview?.sourceHash)
                      && selectedShot.draftPreview?.sourceHash === manualStudioSourceHash}
                    onGenerateImage={handleGenerateImage}
                    onGenerateVideo={handleGenerateVideo}
                    onExternalVideo={isDirectorProductionRoute && manualStudioTarget ? () => manualStudioAI.prepareVideo(manualStudioTarget, { externalOnly: true, startFrameUrl: selectedStartFrameUrl || selectedShot?.imageUrl, endFrameUrl: selectedEndFrameUrl }) : undefined}
                    onGenerateDraftImage={isDirectorProductionRoute && manualStudioTarget?.kind === "shot"
                      ? () => manualStudioAI.prepareDraftImage(manualStudioTarget)
                      : undefined}
                    onImportImage={isDirectorProductionRoute && manualStudioTarget
                      ? (file) => void manualStudioAI.importImage(file, manualStudioTarget)
                      : undefined}
                    onImportVideo={isDirectorProductionRoute && manualStudioTarget
                      ? (file) => void manualStudioAI.importVideo(file, manualStudioTarget)
                      : undefined}
                    />
                  </>
                ) : selectedShotId ? (
                  <div className="flex min-h-48 items-center justify-center rounded-lg border border-border-soft/20 bg-bg-surface-soft px-5 text-center">
                    <p role="status" className="text-xs font-bold text-text-muted">
                      正在加载所选镜头…
                    </p>
                  </div>
                ) : resolvedSelectedAudioTrack ? (
                  <StudioAudioControls
                  selectedAudioTrack={resolvedSelectedAudioTrack}
                  localAudioText={localAudioText}
                  onAudioTextChange={handleAudioTextChange}
                  currentProject={currentProject}
                  isGeneratingVoice={isGeneratingVoice}
                  onGenerateVoice={handleGenerateVoice}
                  onUpdateCharacter={handleUpdateCharacter}
                  onUpdateAudioTrack={handleUpdateAudioTrack}
                  generationGate={isDirectorProductionRoute ? {
                    ready: manualAudioGenerationReady,
                    reason: "请先选择音轨。",
                  } : undefined}
                  promptReadOnly={false}
                  bgmGovernedContext={isDirectorProductionRoute && resolvedSelectedAudioTrack.type === "bgm" ? {
                    sourceHash: manualStoryboardHash({ storyboard: manualAudioStoryboardReadModel?.qaSourceHash || "", track: { id: resolvedSelectedAudioTrack.id, text: resolvedSelectedAudioTrack.text, startTime: resolvedSelectedAudioTrack.startTime, duration: resolvedSelectedAudioTrack.duration, url: resolvedSelectedAudioTrack.url, linkedAssetId: resolvedSelectedAudioTrack.linkedAssetId } }),
                    trackId: resolvedSelectedAudioTrack.id,
                    shotId: resolvedSelectedAudioTrack.shotId,
                    contextSummary: `${activeScene.title || "当前场景"} / ${selectedAudioShot?.visualAction || "当前 Shot"} / ${resolvedSelectedAudioTrack.text || "背景音乐轨"}`,
                    generationAllowed: manualAudioGenerationReady,
                    blockedReason: manualAudioGenerationReady ? undefined : "请先选择音轨。",
                  } : undefined}
                  />
                ) : (
                  <div className="text-center py-24 px-4 bg-gray-50 dark:bg-neutral-950 border border-gray-100 dark:border-neutral-800 rounded-[2rem] shadow-inner">
                    <div className="w-20 h-20 bg-white dark:bg-neutral-900 rounded-[1.5rem] flex items-center justify-center mx-auto mb-8 border border-gray-100 dark:border-neutral-800 shadow-sm">
                      <Settings2 className="w-10 h-10 text-gray-200 dark:text-neutral-800" />
                    </div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-3 uppercase tracking-widest">未选择对象</h4>
                    <p className="text-xs text-gray-400 dark:text-neutral-500 leading-relaxed font-medium">
                      在左侧列表或下方时间轴中<br />选择一个镜头或音频轨道进行编辑
                    </p>
                  </div>
                )}
              </Suspense>
            </div>
          </div>}
        </div>

        {/* Bottom Half: Timeline */}
        <div className="shrink-0 flex flex-col border-t border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 transition-all duration-300 shadow-[0_-4px_20px_rgba(0,0,0,0.03)]">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-neutral-800 flex items-center justify-between bg-gray-50/50 dark:bg-neutral-900/50">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-violet-500" />
              <span className="text-xs font-medium text-gray-500">
                时间轴
                {activeScene?.title && <span className="ml-2 px-2 py-0.5 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-md text-violet-600 dark:text-violet-400">[{activeScene.title}]</span>}
              </span>
            </div>
            <button
              onClick={() => setIsTimelineOpen(!isTimelineOpen)}
              aria-label={isTimelineOpen ? "收起时间轴" : "展开时间轴"}
              title={isTimelineOpen ? "收起时间轴" : "展开时间轴"}
              aria-expanded={isTimelineOpen}
              className="p-1 hover:bg-gray-200 dark:hover:bg-neutral-800 rounded-md text-gray-400 transition-all"
            >
              {isTimelineOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
          
          <AnimatePresence initial={false}>
            {isTimelineOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="h-72">
                  <ErrorBoundary className="min-h-full h-full m-0 p-4 rounded-none shadow-none border-none">
                    <Suspense fallback={<DeferredStudioPanelFallback />}>
                      <Timeline
                        scene={{ ...activeScene, audioTracks: resolvedAudioTracks }}
                        currentTime={currentTime}
                        isPlaying={isPlaying}
                        onSeek={handleSeek}
                        onTogglePlay={togglePlay}
                        onUpdateScene={(updates) => {
                          updateScene(activeSceneId, updates, activeEpisode.id);
                        }}
                        activeShotId={selectedShotId}
                        onSelectShot={(id) => {
                          selectStudioShot(id);
                        }}
                        activeAudioTrackId={selectedAudioTrackId}
                        onSelectAudioTrack={(id) => {
                          selectStudioAudioTrack(id);
                        }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      <Suspense fallback={null}>
        {isParamsModalOpen && (
          <GlobalGenerationParamsModal
            isOpen
            onClose={() => setIsParamsModalOpen(false)}
          />
        )}

        {!isDirectorProductionRoute && promptModalState.isOpen && (
          <PromptEditorModal
              presentation="workspace"
            isOpen
            onClose={() => setPromptModalState(prev => ({ ...prev, isOpen: false }))}
            templateId={promptModalState.templateId}
            variables={promptModalState.variables}
            onConfirm={promptModalState.onConfirm}
            contextOptions={promptModalState.contextOptions}
            defaultSelectedContextIds={promptModalState.defaultSelectedContextIds}
            activeSceneId={activeSceneId || undefined}
            activeEpisodeId={activeEpisode?.id}
          />
        )}

        {isDirectorProductionRoute && manualStudioAI.promptRequest && (
          <PromptEditorModal
              presentation="workspace"
            isOpen
            onClose={() => manualStudioAI.setPromptRequest(null)}
            templateId={manualStudioAI.promptRequest.templateId || "generateImage"}
            variables={manualStudioAI.promptRequest.variables || {}}
            onConfirm={manualStudioAI.execute}
            contextOptions={manualStudioAI.promptRequest.contextOptions}
            defaultSelectedContextIds={manualStudioAI.promptRequest.defaultSelectedContextIds}
            activeSceneId={activeSceneId || undefined}
            activeEpisodeId={activeEpisode?.id}
            title={`${manualStudioAI.promptRequest.target.label || "当前对象"} - 生成提示词确认`}
            manualResultKind={manualStudioAI.promptRequest.action}
            requireManualResult={manualStudioAI.promptRequest.externalOnly}
            externalReferences={manualStudioAI.promptRequest.externalReferences}
            videoGeneration={manualStudioAI.promptRequest.videoGeneration}
            imageReferences={manualStudioAI.promptRequest.action === "image"
              ? manualStudioAI.promptRequest.imageReferences
              : undefined}
            defaultSelectedImageReferenceIds={manualStudioAI.promptRequest.action === "image"
              ? manualStudioAI.promptRequest.imageReferences.map((reference) => reference.id)
              : undefined}
            imageVisualStyleProjection={manualStudioAI.promptRequest.imageVisualStyleProjection}
          />
        )}

        {ttsModalState.isOpen && (
          <TTSConfigModal
            isOpen
            onClose={() => setTtsModalState(prev => ({ ...prev, isOpen: false }))}
            initialText={ttsModalState.initialText}
            onConfirm={ttsModalState.onConfirm}
            modelId={ttsModalState.modelId}
            projectId={ttsModalState.projectId}
            voiceName={ttsModalState.voiceName}
            language={ttsModalState.language}
            instructions={ttsModalState.instructions}
            speed={ttsModalState.speed}
            contextSummary={ttsModalState.contextSummary}
            readOnly={ttsModalState.readOnly}
          />
        )}
      </Suspense>
      <EpisodeFilmExportModal
        isOpen={isFilmExportOpen}
        onClose={() => { if (!episodeFilmExport.isExporting) setIsFilmExportOpen(false); }}
        readyShotCount={episodeFilmExport.readyShotCount}
        imageShotCount={episodeFilmExport.imageShotCount}
        totalShotCount={episodeFilmExport.totalShotCount}
        completedSceneCount={episodeFilmExport.completedSceneCount}
        completedShotCount={episodeFilmExport.completedShotCount}
        totalSceneCount={episodeFilmExport.totalSceneCount}
        isExporting={episodeFilmExport.isExporting}
        onExport={episodeFilmExport.exportEpisode}
      />
    </motion.div>
  );
}
