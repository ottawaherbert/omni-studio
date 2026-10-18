import { productionPreparationHref } from "../utils/productionNavigation";
import { ProductionCreativeControls } from "../components/production/ProductionCreativeControls";
import { DirectorPlanSummary } from "../components/production/DirectorPlanSummary";
import { directorPlanStatus } from "../clients/creativeDirectionClient";
import { flushDebouncedProjectSave } from "../clients/stateClient";
import { ShotAppearanceEditor } from "../components/production/ShotAppearanceEditor";
import { appearanceContentHash, buildManualShotPlanHash, appearanceAssetPatch, reviseShotAppearances, appearanceIssues, appearanceSourceShots } from "../clients/productionStoryboardWorkflowClient";
import { lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAIConfigStore, useProjectStore } from "../clients/stateClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import { motion } from "motion/react";
import { cn } from "../lib/utils";
import {
  Camera,
  Clapperboard,
  Grid3X3,
  LayoutDashboard,
  ChevronDown,
  ChevronLeft,
  Loader2,
  Sparkles,
  Wand2,
  CheckSquare2,
  Square,
  Trash2,
  FileImage,
  Video,
  ListChecks,
  Plus,
} from "lucide-react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Modal } from "../components/ui/Modal";
import { Button } from "../components/ui/Button";
import { ProductionSceneRail } from "../components/production/preparation/ProductionSceneRail";
import { StoryboardHeader } from "../components/storyboard/StoryboardHeader";
import { StoryboardMediaCandidateReview } from "../components/storyboard/StoryboardMediaCandidateReview";
import { useStoryboardAI } from "../hooks/useStoryboardAI";
import { useProductionCockpit } from "../hooks/useProductionCockpit";
import { EmptyState } from "../components/ui/EmptyState";
import { InteractiveSceneContextPanel } from "../components/interactive/InteractiveSceneContextPanel";
import { useProductionEpisodeAvailability } from "../features/production/preparation/useProductionEpisodeAvailability";

import { useSceneReadModel } from "../hooks/useSceneReadModel";
import { buildManualFilmTeamReadModel } from "../clients/productionPreparationWorkflowClient";
import { manualFilmTeamRequiredDepartmentsForScene } from "../clients/productionPreparationWorkflowClient";
import { buildManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";
import {
  buildManualStoryboardReadModel,
  canRebaseManualStoryboardAuthorEdit,
  rebaseManualStoryboardAfterAuthorEdit,
  rebaseManualStoryboardAfterShotDeletion,
} from "../clients/productionStoryboardWorkflowClient";
import { buildProductionPreparationGate } from "../clients/productionPreparationWorkflowClient";
import { StoryboardAgentStatusBar } from "../components/production/StoryboardAgentStatusBar";
import { useStoryboardBoardBatchAgent } from "../hooks/useStoryboardBoardBatchAgent";
import { buildManualVideoStoryboardReadModel } from "../clients/productionStoryboardWorkflowClient";
import type { Project, Scene, Shot } from "../clients/domainTypes";
import type { InteractiveVisualRefinementDraft, StoryboardVisualReferenceMode } from "../clients/domainTypes";
import { interactiveClient } from "../clients/interactiveProductionClient";
import { normalizeVideoGenerationMode } from "../clients/productionStudioWorkflowClient";
import { resolveVideoModelAdapter } from "../clients/productionStudioWorkflowClient";
import {
  listStoryboardCompositeWorkflowAnchors,
  mergeStoryboardUnitWorkflows,
  planStoryboardCompositeVideoUnitGroups,
  splitStoryboardUnitWorkflow,
  storyboardBoardWorkflowIdentity,
} from "../clients/productionStoryboardWorkflowClient";
import {
  buildStoryboardBatchSceneReadModel,
  buildStoryboardAllowedAssetIds,
  buildStoryboardAssetPromptContext,
  buildStoryboardTeamPromptContext,
} from "../clients/productionStoryboardWorkflowClient";

const DepartmentBoardsPanel = lazy(() => import("../components/storyboard/DepartmentBoardsPanel")
  .then((module) => ({ default: module.DepartmentBoardsPanel })));
const ManualStoryboardReviewModal = lazy(() => import("../components/production/ManualStoryboardReviewModal")
  .then((module) => ({ default: module.ManualStoryboardReviewModal })));
const ManualVideoStoryboardPanel = lazy(() => import("../components/production/ManualVideoStoryboardPanel")
  .then((module) => ({ default: module.ManualVideoStoryboardPanel })));
const ShotCard = lazy(() => import("../components/storyboard/ShotCard")
  .then((module) => ({ default: module.ShotCard })));
const PromptEditorModal = lazy(() => import("../components/PromptEditorModal"));
const GlobalGenerationParamsModal = lazy(() => import("../components/GlobalGenerationParamsModal"));

const DeferredPanelFallback = () => (
  <div role="status" className="flex min-h-24 items-center justify-center rounded-lg border border-border-soft/25 bg-bg-surface-soft text-xs font-semibold text-text-muted">
    <Loader2 className="mr-2 h-4 w-4 animate-spin text-gold" />
    正在加载当前内容…
  </div>
);

interface StoryboardProps {
  workspaceMode?: "linear" | "interactive-node";
}

const PendingCompositeStoryboardCard = ({
  shotLabel,
  shotCount,
  durationSeconds,
  shots = [],
  ready = false,
  visualReady = false,
  blockReason,
  visualBlockReason,
  isGenerating = false,
  referenceMode,
  onReferenceModeChange,
  onGenerate,
}: {
  shotLabel: string;
  shotCount: number;
  durationSeconds: number;
  shots?: NonNullable<Scene["shots"]>;
  ready?: boolean;
  visualReady?: boolean;
  blockReason?: string;
  visualBlockReason?: string;
  isGenerating?: boolean;
  referenceMode: StoryboardVisualReferenceMode;
  onReferenceModeChange?: (mode: StoryboardVisualReferenceMode) => void;
  onGenerate?: () => void;
}) => (
  <section className="rounded-lg border border-border-soft/30 bg-bg-surface p-5">
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-500/10 text-violet-500"><Clapperboard className="h-5 w-5" /></span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-text-primary">视频单元待建立 · {shotLabel}</h2>
        <p className="mt-1 text-xs text-text-muted">{shotCount} 个分镜 · {durationSeconds}s · 默认按分镜建立单元，之后可按目标模型能力合并</p>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-border-soft/30 py-3">
      <div>
        <p className="text-xs font-bold text-text-primary">新视频单元默认参考模式</p>
        <p className="mt-1 text-[10px] text-text-muted">建立后仍可在每个视频单元上单独切换。</p>
      </div>
      <div role="group" aria-label="新视频单元故事板参考模式" className="inline-flex h-9 items-center border border-border-soft/40 bg-bg-primary p-1">
        <button type="button" onClick={() => onReferenceModeChange?.("shot_grid")} aria-pressed={referenceMode === "shot_grid"} className={cn("inline-flex h-7 items-center gap-1.5 px-3 text-[11px] font-bold", referenceMode === "shot_grid" ? "bg-bg-surface text-cyan-400 shadow-sm" : "text-text-muted hover:text-text-primary")}>
          <Grid3X3 className="h-3.5 w-3.5" />宫格模式
        </button>
        <button type="button" onClick={() => onReferenceModeChange?.("director_board")} aria-pressed={referenceMode === "director_board"} className={cn("inline-flex h-7 items-center gap-1.5 px-3 text-[11px] font-bold", referenceMode === "director_board" ? "bg-bg-surface text-cyan-400 shadow-sm" : "text-text-muted hover:text-text-primary")}>
          <Clapperboard className="h-3.5 w-3.5" />故事板模式
        </button>
      </div>
    </div>
    <div className="mt-5 rounded-md border border-border-soft/40 bg-bg-surface-soft p-3">
      {ready && shots.length ? (
        <>
          <div
            className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"
            aria-label="镜头故事板草案"
          >
            {shots.map((shot, index) => (
              <article key={shot.id} className="flex min-h-40 min-w-0 flex-col border border-border-soft/35 bg-bg-primary p-3 text-left">
                <div className="flex items-center justify-between gap-2 text-[10px] font-black text-text-muted">
                  <span>镜头 {String(index + 1).padStart(2, "0")}</span>
                  <span>{shot.duration || 0}s</span>
                </div>
                <p className="mt-3 text-xs font-bold leading-5 text-text-primary">{shot.visualAction || shot.motivation || "待补镜头动作"}</p>
                <p className="mt-auto pt-3 text-[10px] leading-4 text-text-muted">
                  {[shot.shotSize, shot.cameraAngle, shot.cameraMovement, shot.focalLength].filter(Boolean).join(" · ")}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-text-secondary">镜头故事板草案已可审阅</p>
            {onGenerate && (
              <button
                type="button"
                onClick={onGenerate}
                disabled={isGenerating || !ready}
                title={visualReady ? "建立视频单元并生成故事板与纯净宫格画面" : "先建立视频单元结构；图片提示词完成后再生成画面"}
                className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {visualReady ? "建立单元并生成画面" : "建立视频单元结构"}
              </button>
            )}
            {!visualReady && visualBlockReason && (
              <p className="w-full text-[10px] leading-4 text-amber-400">{visualBlockReason}</p>
            )}
          </div>
        </>
      ) : (
        <div className="flex aspect-video items-center justify-center px-6 text-center">
          <p className="text-xs font-semibold text-text-muted">{blockReason || "请先为当前场划分镜头"}</p>
        </div>
      )}
    </div>
  </section>
);

const storyboardShotLabel = (shotIds: string[], shots: Scene["shots"]) => {
  const indexes = shotIds
    .map((shotId) => (shots || []).findIndex((shot) => shot.id === shotId))
    .filter((index) => index >= 0)
    .map((index) => String(index + 1).padStart(2, "0"));
  return indexes.length ? `镜头 ${indexes.join(" · ")}` : "待编组镜头";
};

export default function Storyboard({ workspaceMode = "linear" }: StoryboardProps) {
  const { currentProject, activeEpisodeId, activeEpisode, setActiveEpisodeId, updateScene, loadProject, isLoading } = useProjectStore(useShallow((state) => ({
    currentProject: state.currentProject,
    activeEpisodeId: state.activeEpisodeId,
    activeEpisode: state.activeEpisode,
    setActiveEpisodeId: state.setActiveEpisodeId,
    updateScene: state.updateScene,
    loadProject: state.loadProject,
    isLoading: state.isLoading,
  })));
  const [searchParams, setSearchParams] = useSearchParams();
  const videoModels = useAIConfigStore((state) => state.models);
  const videoChannels = useAIConfigStore((state) => state.channels);
  const routedVideoModelConfigId = useAIConfigStore((state) => state.routing.videoGen);
  const location = useLocation();
  const isDirectorProductionRoute = location.pathname.startsWith("/production/");
  const queryProjectId = searchParams.get("projectId");
  const returnTo = searchParams.get("returnTo");
  const interactiveReturnTo = returnTo?.startsWith("/interactive/experiences/") ? returnTo : undefined;
  const isRequestedProjectPending = Boolean(queryProjectId && currentProject?.id !== queryProjectId);
  const { fullEpisodes: productionFullEpisodes } = useProductionEpisodeAvailability(currentProject, activeEpisode);
  const sceneReadModel = useSceneReadModel();
  const { episodeId: routeEpisodeId, nodeId } = useParams<{ episodeId?: string; nodeId?: string }>();
  const isInteractiveNodeWorkspace = workspaceMode === "interactive-node";
  const baseScenes = isInteractiveNodeWorkspace && nodeId
    ? sceneReadModel.scenes.filter((scene) => (scene.sourceNodeId || scene.id) === nodeId)
    : sceneReadModel.scenes;
  const urlSceneId = searchParams.get("sceneId");
  const urlShotId = searchParams.get("shotId");
  const urlEpisodeId = searchParams.get("episodeId");
  const videoGenerationMode = normalizeVideoGenerationMode(searchParams.get("videoMode"));
  const storyboardEpisodeView = "storyboard" as const;
  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    baseScenes[0]?.id || null,
  );
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [isBatchDeleteConfirmOpen, setIsBatchDeleteConfirmOpen] = useState(false);
  const [isDeletingSelectedShots, setIsDeletingSelectedShots] = useState(false);
  const [isAddingShot, setIsAddingShot] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProductionEvidenceOpen, setIsProductionEvidenceOpen] = useState(false);
  const [isVisualRefinementPromptOpen, setIsVisualRefinementPromptOpen] = useState(false);
  const [isGenerationParamsOpen, setIsGenerationParamsOpen] = useState(false);
  const [visualRefinementCandidate, setVisualRefinementCandidate] = useState<InteractiveVisualRefinementDraft | null>(null);
  const [isVisualRefinementBusy, setIsVisualRefinementBusy] = useState(false);
  const [storyboardDefaultModeDraft, setStoryboardDefaultModeDraft] = useState<StoryboardVisualReferenceMode>("shot_grid");
  const hasProductionWorkspaceShell = Boolean(
    (currentProject as (Project & { __productionWorkspaceShell?: boolean }) | null)?.__productionWorkspaceShell,
  );

  useEffect(() => {
    if (
      !queryProjectId
      || (
        currentProject?.id === queryProjectId
        && (!isDirectorProductionRoute || hasProductionWorkspaceShell)
      )
    ) return;
    void loadProject(queryProjectId, {
      episodeView: isDirectorProductionRoute ? storyboardEpisodeView : undefined,
      sceneId: isDirectorProductionRoute ? urlSceneId || undefined : undefined,
      shotId: undefined,
    });
  }, [
    currentProject?.id,
    hasProductionWorkspaceShell,
    isDirectorProductionRoute,
    loadProject,
    queryProjectId,
    storyboardEpisodeView,
    urlSceneId,
  ]);
  
  const deferredActiveSceneId = useDeferredValue(activeSceneId);
  const requestedScene = baseScenes.find((scene) => scene.id === deferredActiveSceneId);
  const activeScene = requestedScene && !(requestedScene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary
    ? requestedScene
    : baseScenes.find((scene) => !(scene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary);
  useEffect(() => {
    setStoryboardDefaultModeDraft(activeScene?.manualStoryboard?.defaultVisualReferenceMode || "shot_grid");
  }, [activeScene?.id]);
  useEffect(() => {
    const availableShotIds = new Set((activeScene?.shots || []).map((shot) => shot.id));
    setSelectedShotIds((current) => current.filter((shotId) => availableShotIds.has(shotId)));
  }, [activeScene?.shots]);
  const isSceneDetailPending = deferredActiveSceneId !== activeSceneId
    || Boolean(requestedScene && (requestedScene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary);
  const activeVisualScenario = activeScene?.interactiveMetadata?.visualScenarios?.find(
    (scenario) => scenario.id === activeScene.interactiveMetadata?.activeVisualScenarioId,
  ) || activeScene?.interactiveMetadata?.visualScenarios?.[0];
  const interactiveExperienceId = currentProject?.interactiveProductionPrepProfile?.experienceId;
  const visualRefinementVariables = useMemo(() => {
    if (!currentProject || !activeScene || !activeVisualScenario) return {};
    const characterById = new Map((currentProject.characters || []).map((character) => [character.id, character]));
    const assetById = new Map((currentProject.assets || []).map((asset) => [asset.id, asset]));
    const canonicalAssetContext = activeVisualScenario.canonicalAssetRefs
      .map((assetId) => {
        const character = characterById.get(assetId);
        if (character) {
          return `${character.name}：${character.visualIdentity || '保持当前已确认造型与身份'}`;
        }
        const asset = assetById.get(assetId);
        return asset ? `${asset.name}：${asset.description || '保持当前已确认外观'}` : '';
      })
      .filter(Boolean)
      .join('\n');
    return {
      sceneContext: [
        `场次：${activeScene.title}`,
        activeScene.description || '',
        activeScene.interactiveMetadata?.incomingContext
          ? `从上一选择承接：${activeScene.interactiveMetadata.incomingContext}`
          : '',
        activeScene.interactiveMetadata?.outgoingContext
          ? `离开场次时：${activeScene.interactiveMetadata.outgoingContext}`
          : '',
      ].filter(Boolean).join('\n'),
      visualStateContext: [
        activeVisualScenario.label,
        activeVisualScenario.shotPromptDelta,
      ].filter(Boolean).join('\n'),
      canonicalAssetContext: canonicalAssetContext || '保持当前场次已经确认的人物、地点与道具，不新增资产。',
      authorRequest: '请检查当前故事状态在画面上应该怎样不同，并给出具体可拍的环境和表演方案。',
    };
  }, [activeScene, activeVisualScenario, currentProject]);

  const createVisualRefinement = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: {
      selectedSkillIds: string[];
      selectedSkillTitles: string[];
      selectedContextIds: string[];
    },
  ) => {
    if (!interactiveExperienceId || !activeScene || !activeVisualScenario) return;
    setIsVisualRefinementBusy(true);
    try {
      const candidate = await interactiveClient.createVisualRefinement(interactiveExperienceId, {
        productionSceneId: activeScene.id,
        visualScenarioId: activeVisualScenario.id,
        finalPrompt,
        selectedSkillIds: metadata?.selectedSkillIds,
        selectedSkillTitles: metadata?.selectedSkillTitles,
        selectedContextIds: metadata?.selectedContextIds,
      });
      setVisualRefinementCandidate(candidate);
      setIsVisualRefinementPromptOpen(false);
      toast.success('AI 画面方案已生成，请审阅后采用');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '生成画面方案失败');
      throw error;
    } finally {
      setIsVisualRefinementBusy(false);
    }
  };

  const rejectVisualRefinement = async () => {
    if (!interactiveExperienceId || !visualRefinementCandidate) return;
    setIsVisualRefinementBusy(true);
    try {
      await interactiveClient.rejectVisualRefinement(
        interactiveExperienceId,
        visualRefinementCandidate.id,
      );
      setVisualRefinementCandidate(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '放弃画面方案失败');
    } finally {
      setIsVisualRefinementBusy(false);
    }
  };

  const adoptVisualRefinement = async () => {
    if (!interactiveExperienceId || !visualRefinementCandidate || !currentProject) return;
    setIsVisualRefinementBusy(true);
    try {
      await interactiveClient.adoptVisualRefinement(
        interactiveExperienceId,
        visualRefinementCandidate.id,
      );
      setVisualRefinementCandidate(null);
      await loadProject(currentProject.id, {
        episodeView: storyboardEpisodeView,
        sceneId: activeScene.id,
        shotId: undefined,
      });
      toast.success('已采用，当前场次会按新方案重新制作画面');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '采用画面方案失败');
    } finally {
      setIsVisualRefinementBusy(false);
    }
  };
  const activeShot = useMemo(() => {
    if (!activeScene?.shots?.length) return null;
    const shot = activeScene.shots.find((item) => item.id === activeShotId) as
      | (Shot & { __workspaceShotSummary?: boolean })
      | undefined;
    return shot && !shot.__workspaceShotSummary ? shot : null;
  }, [activeScene, activeShotId]);
  const storyboardUnitAnchors = useMemo(() => videoGenerationMode === "storyboard" && activeScene?.shots?.length
    ? listStoryboardCompositeWorkflowAnchors({
      workflows: activeScene.manualStoryboard?.boards,
      shots: activeScene.shots,
    })
    : [], [activeScene, videoGenerationMode]);
  const resolveStoryboardUnitAdapter = useCallback((workflows: typeof storyboardUnitAnchors[number]["workflow"][]) => {
    const configIds = Array.from(new Set(workflows.map((workflow) => workflow.targetVideoModelConfigId || routedVideoModelConfigId).filter(Boolean)));
    if (configIds.length !== 1) return undefined;
    const model = videoModels.find((item) => item.id === configIds[0]);
    const channel = videoChannels.find((item) => item.id === model?.channelId);
    return model && channel ? {
      model,
      adapter: resolveVideoModelAdapter({
        channelType: channel.type,
        modelId: model.modelId,
        configuredAdapterId: model.videoAdapterId,
      }),
    } : undefined;
  }, [routedVideoModelConfigId, storyboardUnitAnchors, videoChannels, videoModels]);
  const storyboardGroupingProposals = useMemo(() => {
    const result = new Map<string, { unitIds: string[]; shotCount: number; durationSeconds: number }>();
    if (!activeScene?.shots || !storyboardUnitAnchors.length) return result;
    const resolved = resolveStoryboardUnitAdapter(storyboardUnitAnchors.map((anchor) => anchor.workflow));
    if (!resolved?.adapter.capabilities.multiShot) return result;
    const groups = planStoryboardCompositeVideoUnitGroups({
      workflows: storyboardUnitAnchors.map((anchor) => anchor.workflow),
      shots: activeScene.shots,
      limits: {
        minDurationSeconds: resolved.adapter.limits.minDurationSeconds,
        maxDurationSeconds: resolved.adapter.limits.maxDurationSeconds,
        supportsMultiShotSingleGeneration: true,
      },
    });
    for (const group of groups.filter((items) => items.length > 1)) {
      const unitIds = group.map(storyboardBoardWorkflowIdentity);
      const shotIds = group.flatMap((workflow) => workflow.shotIds || workflow.board?.shotIds || [workflow.shotId]);
      result.set(unitIds[0], {
        unitIds,
        shotCount: shotIds.length,
        durationSeconds: shotIds.reduce((sum, shotId) => sum + Number(activeScene.shots?.find((shot) => shot.id === shotId)?.duration || 0), 0),
      });
    }
    return result;
  }, [activeScene?.shots, resolveStoryboardUnitAdapter, storyboardUnitAnchors]);
  const persistRegroupedStoryboardUnits = useCallback(async ({
    sourceUnitIds,
    replacements,
  }: {
    sourceUnitIds: string[];
    replacements: NonNullable<Scene["manualStoryboard"]>["boards"];
  }) => {
    if (!activeScene?.manualStoryboard || !activeEpisode) return;
    const sourceSet = new Set(sourceUnitIds);
    let inserted = false;
    const boards = (activeScene.manualStoryboard.boards || []).flatMap((workflow) => {
      const identity = storyboardBoardWorkflowIdentity(workflow);
      if (!sourceSet.has(identity)) return [workflow];
      if (inserted) return [];
      inserted = true;
      return replacements || [];
    });
    await updateScene(activeScene.id, {
      manualStoryboard: {
        ...activeScene.manualStoryboard,
        boards,
        updatedAt: Date.now(),
      },
    }, activeEpisode.id);
  }, [activeEpisode, activeScene, updateScene]);
  const mergeStoryboardUnitWithNext = useCallback(async (index: number) => {
    if (!activeScene?.shots) return;
    const current = storyboardUnitAnchors[index];
    const next = storyboardUnitAnchors[index + 1];
    if (!current || !next) return;
    const duration = [...current.shotIds, ...next.shotIds].reduce((sum, shotId) => (
      sum + Number(activeScene.shots?.find((shot) => shot.id === shotId)?.duration || 0)
    ), 0);
    const resolved = resolveStoryboardUnitAdapter([current.workflow, next.workflow]);
    if (!resolved) {
      toast.error("相邻视频单元必须先统一为同一个有效目标视频模型，才能合并。");
      return;
    }
    const { model, adapter } = resolved;
    if (!adapter.capabilities.multiShot) {
      toast.error(`${model.alias} 不支持多 Shot 单次生成，请保持独立视频单元。`);
      return;
    }
    if (adapter.limits.maxDurationSeconds && duration > adapter.limits.maxDurationSeconds) {
      toast.error(`合并后为 ${duration}s，超过 ${model.alias} 的 ${adapter.limits.maxDurationSeconds}s 上限。`);
      return;
    }
    const merged = mergeStoryboardUnitWorkflows({
      workflows: [current.workflow, next.workflow],
      shots: activeScene.shots,
    });
    await persistRegroupedStoryboardUnits({
      sourceUnitIds: [current.id, next.id],
      replacements: [merged],
    });
    toast.success(`已合并为 ${merged.shotIds?.length || 0} 镜头、${duration}s 视频单元；请重新确认结构和参考图。`);
  }, [activeScene?.shots, persistRegroupedStoryboardUnits, resolveStoryboardUnitAdapter, storyboardUnitAnchors]);
  const adoptStoryboardGroupingProposal = useCallback(async (proposalId: string) => {
    if (!activeScene?.shots) return;
    const proposal = storyboardGroupingProposals.get(proposalId);
    if (!proposal) return;
    const anchors = proposal.unitIds
      .map((unitId) => storyboardUnitAnchors.find((anchor) => anchor.id === unitId))
      .filter((anchor): anchor is typeof storyboardUnitAnchors[number] => Boolean(anchor));
    if (anchors.length !== proposal.unitIds.length) return;
    const merged = mergeStoryboardUnitWorkflows({ workflows: anchors.map((anchor) => anchor.workflow), shots: activeScene.shots });
    await persistRegroupedStoryboardUnits({ sourceUnitIds: proposal.unitIds, replacements: [merged] });
    toast.success(`已采用编组建议：${proposal.shotCount} 个镜头，${proposal.durationSeconds}s。`);
  }, [activeScene?.shots, persistRegroupedStoryboardUnits, storyboardGroupingProposals, storyboardUnitAnchors]);
  const splitStoryboardUnit = useCallback(async (index: number) => {
    if (!activeScene?.shots) return;
    const current = storyboardUnitAnchors[index];
    if (!current || current.shotIds.length <= 1) return;
    const replacements = splitStoryboardUnitWorkflow({ workflow: current.workflow, shots: activeScene.shots });
    await persistRegroupedStoryboardUnits({ sourceUnitIds: [current.id], replacements });
    toast.success(`已拆为 ${replacements.length} 个独立视频单元；原 Take 编号保留在来源记录中。`);
  }, [activeScene?.shots, persistRegroupedStoryboardUnits, storyboardUnitAnchors]);
  const setStoryboardDefaultReferenceMode = useCallback(async (mode: StoryboardVisualReferenceMode) => {
    if (!activeScene || !activeEpisode) return;
    const previousMode = storyboardDefaultModeDraft;
    setStoryboardDefaultModeDraft(mode);
    const workspace = activeScene.manualStoryboard || {
      schemaVersion: "manual-storyboard.v1" as const,
      boards: [],
      updatedAt: Date.now(),
    };
    try {
      await updateScene(activeScene.id, {
        manualStoryboard: {
          ...workspace,
          defaultVisualReferenceMode: mode,
          updatedAt: Date.now(),
        },
      }, activeEpisode.id);
      toast.success(mode === "shot_grid" ? "新视频单元将默认使用宫格模式" : "新视频单元将默认使用故事板模式");
    } catch (error) {
      setStoryboardDefaultModeDraft(previousMode);
      toast.error(error instanceof Error ? error.message : "视频参考模式保存失败");
    }
  }, [activeEpisode, activeScene, storyboardDefaultModeDraft, updateScene]);
  const manualFilmTeamReadModel = useMemo(() => {
    if (!isDirectorProductionRoute || !currentProject || !activeEpisode || !activeScene) return null;
    return buildManualFilmTeamReadModel({
      project: currentProject,
      episode: activeEpisode,
      requiredDepartments: manualFilmTeamRequiredDepartmentsForScene(activeScene),
    });
  }, [activeEpisode, activeScene, currentProject, isDirectorProductionRoute]);
  const manualProductionAssetReadModel = useMemo(() => {
    if (!currentProject || !activeEpisode || !activeScene || !manualFilmTeamReadModel) return null;
    return buildManualProductionAssetReadModel({
      project: currentProject,
      episode: activeEpisode,
      scene: activeScene,
      episodes: productionFullEpisodes,
      filmTeam: manualFilmTeamReadModel,
    });
  }, [activeEpisode, activeScene, currentProject, manualFilmTeamReadModel, productionFullEpisodes]);
  const productionPreparationGate = useMemo(() => {
    if (!isDirectorProductionRoute || !activeScene || !manualFilmTeamReadModel || !manualProductionAssetReadModel) return null;
    return buildProductionPreparationGate({ scene: activeScene, filmTeam: manualFilmTeamReadModel, assets: manualProductionAssetReadModel });
  }, [activeScene, isDirectorProductionRoute, manualFilmTeamReadModel, manualProductionAssetReadModel]);
  const manualStoryboardReadModel = useMemo(() => {
    if (!activeScene || !manualFilmTeamReadModel || !manualProductionAssetReadModel) return null;
    return buildManualStoryboardReadModel({
      scene: activeScene,
      filmTeam: manualFilmTeamReadModel,
      assets: manualProductionAssetReadModel,
    });
  }, [activeScene, manualFilmTeamReadModel, manualProductionAssetReadModel]);
  const promptGenerationBlockReason = useMemo(() => {
    if (!manualStoryboardReadModel?.readyForImagePromptGeneration || !manualStoryboardReadModel?.readyForVideoPromptGeneration) {
      return manualStoryboardReadModel?.staleReasons[0]
        || "请先生成并确认当前场分镜，再分别生成图片提示词或视频提示词。";
    }
    return undefined;
  }, [manualStoryboardReadModel]);
  const manualTeamPromptContext = useMemo(() => {
    if (!isDirectorProductionRoute || !activeEpisode || !activeScene) return "";
    return buildStoryboardTeamPromptContext(activeEpisode, activeScene);
  }, [activeEpisode, activeScene, isDirectorProductionRoute]);
  const loadManualTeamPromptContext = useCallback(async () => {
    if (!currentProject || !activeEpisode || !activeScene || !isDirectorProductionRoute) {
      return manualTeamPromptContext;
    }
    const context = await legacyProjectClient.getStoryboardTeamContext(
      currentProject.id,
      activeEpisode.id,
      activeScene.id,
    );
    return context.productionTeamContext;
  }, [
    activeEpisode,
    activeScene,
    currentProject,
    isDirectorProductionRoute,
    manualTeamPromptContext,
  ]);
  const manualAssetPromptContext = useMemo(() => {
    if (!manualProductionAssetReadModel || !currentProject) return "";
    return buildStoryboardAssetPromptContext(currentProject, manualProductionAssetReadModel);
  }, [currentProject, manualProductionAssetReadModel]);
  const manualAllowedAssetIds = useMemo(() => {
    if (!manualProductionAssetReadModel) return { character: [], location: [], prop: [] };
    return buildStoryboardAllowedAssetIds(manualProductionAssetReadModel, currentProject || undefined);
  }, [manualProductionAssetReadModel, currentProject]);
  const currentStoryboardCompletion = useMemo(() => {
    if (!activeScene || !currentProject || !manualStoryboardReadModel || !manualProductionAssetReadModel) return null;
    const boardReadModels = videoGenerationMode === "storyboard"
      ? (activeScene.shots || []).map((shot) => buildManualVideoStoryboardReadModel({
        workflows: activeScene.manualStoryboard?.boards,
        shot,
        storyboardSourceHash: manualStoryboardReadModel.sourceHash,
        project: currentProject,
        assets: manualProductionAssetReadModel,
        scene: activeScene,
      }))
      : [];
    return {
      shotPlanComplete: manualStoryboardReadModel.shotPlanAccepted,
      imagePromptComplete: manualStoryboardReadModel.imagePromptAccepted,
      videoPromptComplete: manualStoryboardReadModel.videoPromptAccepted,
      boardComplete: boardReadModels.length > 0 && boardReadModels.every((readModel) =>
        readModel.visualPageCount > 0
          && (readModel.boardVisualStatus === "ready" || readModel.boardVisualStatus === "needs_review")),
      boardApproved: boardReadModels.length > 0 && boardReadModels.every((readModel) => readModel.readyForStudio),
    };
  }, [activeScene, currentProject, manualProductionAssetReadModel, manualStoryboardReadModel, videoGenerationMode]);
  const currentStoryboardBatchScene = useMemo(() => {
    if (
      !isDirectorProductionRoute
      || !currentProject
      || !activeEpisode
      || !activeScene
    ) return null;
    return buildStoryboardBatchSceneReadModel({
      project: currentProject,
      episode: activeEpisode,
      episodes: productionFullEpisodes,
      scene: activeScene,
    });
  }, [
    activeEpisode,
    activeScene,
    currentProject,
    isDirectorProductionRoute,
    productionFullEpisodes,
  ]);
  const [appearanceHistoryContext, setAppearanceHistoryContext] = useState("");
  useEffect(() => {
    let cancelled = false;
    setAppearanceHistoryContext("");
    if (activeScene?.shots.some(shot => shot.appearance?.states.some(state => state.inheritFromShotId))) {
      void loadManualTeamPromptContext().then(context => { if (!cancelled) setAppearanceHistoryContext(context); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [loadManualTeamPromptContext]);
  const saveAppearanceShot = async (shot: Shot) => {
    if (!currentProject || !activeEpisode || !activeScene) return;
    const previous = appearanceSourceShots(activeEpisode, await loadManualTeamPromptContext());
    const shots = reviseShotAppearances(currentProject, activeScene, (activeScene.shots || []).map(s => s.id === shot.id ? shot : s), previous).map(next => {
      const old = activeScene.shots.find(s => s.id === next.id)!;
      return { ...next, imagePromptAppearanceHash: old.imagePromptAppearanceHash || (old.imagePrompt ? appearanceContentHash(old, 'image') : undefined), videoPromptAppearanceHash: old.videoPromptAppearanceHash || (old.videoPrompt ? appearanceContentHash(old, 'video') : undefined) };
    });
    const prepared = appearanceAssetPatch(currentProject, shots);
    await updateScene(activeScene.id, { shots: prepared.shots, ...(activeScene.manualStoryboard?.shotPlan ? { manualStoryboard: { ...activeScene.manualStoryboard, shotPlan: { ...activeScene.manualStoryboard.shotPlan, outputHash: buildManualShotPlanHash(prepared.shots) } } } : {}) }, activeEpisode.id, { expectedProjectId: currentProject.id, appearanceAssets: { characters: prepared.characters, assets: prepared.assets } });
    try { await flushDebouncedProjectSave(currentProject.id); toast.success('外观状态已保存'); } catch { toast.error('状态保留在本地，保存失败，请重试。'); }
  };
  const storyboardAgentScenes = currentStoryboardBatchScene ? [currentStoryboardBatchScene] : [];
  const {
    cockpit: productionCockpit,
    isLoading: isCockpitLoading,
    error: cockpitError,
    refresh: refreshProductionCockpit,
  } = useProductionCockpit({
    projectId: currentProject?.id,
    episodeId: activeEpisode?.id || activeEpisodeId || undefined,
    stageType: "storyboard",
    scope: "stage_exit",
    environment: "development",
    enabled: Boolean(!isDirectorProductionRoute && currentProject?.id && activeEpisode?.id),
  });
  
  const {
    isGenerating,
    generatingShotImageId,
    generatingShotPrompt,
    shotBatchProgress,
    agentProgress,
    promptModalState,
    setPromptModalState,
    reviewCandidate,
    isReviewCandidateOpen,
    openReviewCandidate,
    closeReviewCandidate,
    adoptReviewCandidate,
    updateReviewShot,
    updateReviewPlan,
    handlePrepareGenerateShots,
    handlePrepareGenerateImagePrompts,
    handlePrepareGenerateVideoPrompts,
    handlePrepareGenerateShotPrompt,
    runShotBatchQueue,
    handleRerollShot,
    handlePrepareGenerateShotSpatial,
  } = useStoryboardAI(
    currentProject,
    activeEpisode,
    activeScene,
    updateScene,
    setActiveShotId,
    {
      manualReview: isDirectorProductionRoute,
      productionReady: productionPreparationGate?.readyForShotPlanning,
      imagePromptReady: Boolean(manualStoryboardReadModel?.readyForImagePromptGeneration),
      videoPromptReady: Boolean(manualStoryboardReadModel?.readyForVideoPromptGeneration),
      sourceHash: manualStoryboardReadModel?.sourceHash,
      manualTeamContext: manualTeamPromptContext,
      loadManualTeamContext: loadManualTeamPromptContext,
      manualAssetContext: manualAssetPromptContext,
      allowedAssetIds: manualAllowedAssetIds,
      manualAssetBoards: manualProductionAssetReadModel?.assetBoards,
      batchScenes: [],
    },
  );
  const boardBatchAgent = useStoryboardBoardBatchAgent({
    project: currentProject,
    episode: activeEpisode,
    scenes: isDirectorProductionRoute ? storyboardAgentScenes : [],
    updateScene,
  });
  const hasActiveStoryboardGeneration = isGenerating
    || Boolean(generatingShotImageId)
    || Boolean(generatingShotPrompt)
    || boardBatchAgent.isRunning
    || isVisualRefinementBusy;
  const isStoryboardMutationBusy = hasActiveStoryboardGeneration || isDeletingSelectedShots || isAddingShot;
  const navigate = useNavigate();

  const selectScene = (sceneId: string) => {
    setActiveSceneId(sceneId);
    setActiveShotId(null);
    setSelectedShotIds([]);
    const next = new URLSearchParams(searchParams);
    next.set("sceneId", sceneId);
    next.delete("shotId");
    if (activeEpisode?.id) next.set("episodeId", activeEpisode.id);
    startTransition(() => setSearchParams(next));
  };

  const selectShot = (shotId: string | null) => {
    setActiveShotId(shotId);
    const next = new URLSearchParams(searchParams);
    if (shotId) next.set("shotId", shotId);
    else next.delete("shotId");
    startTransition(() => setSearchParams(next, { replace: true }));
  };

  const selectedShotIdSet = useMemo(() => new Set(selectedShotIds), [selectedShotIds]);
  const selectableShotIds = useMemo(
    () => (activeScene?.shots || []).map((shot) => shot.id),
    [activeScene?.shots],
  );
  const allShotsSelected = selectableShotIds.length > 0
    && selectableShotIds.every((shotId) => selectedShotIdSet.has(shotId));
  const toggleShotBatchSelection = useCallback((shotId: string) => {
    setSelectedShotIds((current) => current.includes(shotId)
      ? current.filter((item) => item !== shotId)
      : [...current, shotId]);
  }, []);
  const toggleAllShotBatchSelection = useCallback(() => {
    setSelectedShotIds((current) => {
      const currentSet = new Set(current);
      return selectableShotIds.length > 0 && selectableShotIds.every((shotId) => currentSet.has(shotId))
        ? []
        : selectableShotIds;
    });
  }, [selectableShotIds]);

  const addManualShot = async () => {
    if (!activeScene || !activeEpisode || !currentProject || isStoryboardMutationBusy) return;
    setIsAddingShot(true);
    try {
      const live = useProjectStore.getState();
      if (live.currentProject?.id !== currentProject.id || live.activeEpisode?.id !== activeEpisode.id) {
        throw new Error("当前项目或分集已切换，请返回原场景后重试。");
      }
      const scene = live.activeEpisode.scenes.find((item) => item.id === activeScene.id);
      if (!scene) throw new Error("当前场景已不存在，请重新选择场景。");
      const shot: Shot = { id: `shot-${crypto.randomUUID()}`, duration: 5, visualAction: "" };
      const shots = [...(scene.shots || []), shot];
      const sourceHash = manualStoryboardReadModel?.sourceHash;
      const manualStoryboard = sourceHash && canRebaseManualStoryboardAuthorEdit(scene.manualStoryboard, sourceHash)
        ? rebaseManualStoryboardAfterAuthorEdit({
            workspace: scene.manualStoryboard, shots, sourceHash,
            confirmShotPlan: false, confirmImagePrompts: false, confirmVideoPrompts: false,
          })
        : scene.manualStoryboard;
      await updateScene(scene.id, { shots, ...(manualStoryboard ? { manualStoryboard } : {}) }, activeEpisode.id, { expectedProjectId: currentProject.id });
      await flushDebouncedProjectSave(currentProject.id);
      selectShot(shot.id);
      toast.success("已添加空白镜头，可在卡片中编辑。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "添加镜头失败");
    } finally {
      setIsAddingShot(false);
    }
  };

  const deleteSelectedShots = async () => {
    if (!activeScene || !activeEpisode || selectedShotIds.length === 0 || isDeletingSelectedShots) return;
    if (hasActiveStoryboardGeneration) {
      toast.error("当前场仍有生成任务，请等待完成后再删除分镜。");
      return;
    }
    setIsDeletingSelectedShots(true);
    try {
      const deletedIds = new Set(selectedShotIds);
      const shots = activeScene.shots || [];
      const remainingShots = shots.filter((shot) => !deletedIds.has(shot.id));
      let cursor = 0;
      const deletedIntervals = shots.flatMap((shot) => {
        const start = cursor;
        const duration = Number(shot.duration || 0);
        cursor += duration;
        return deletedIds.has(shot.id) ? [{ start, end: cursor, duration }] : [];
      });
      const audioTracks = (activeScene.audioTracks || []).flatMap((track) => {
        if (track.shotId && deletedIds.has(track.shotId)) return [];
        const containingDeletedInterval = deletedIntervals.find((interval) => (
          track.startTime > interval.start && track.startTime < interval.end
        ));
        const removedBefore = deletedIntervals
          .filter((interval) => interval.end <= track.startTime)
          .reduce((sum, interval) => sum + interval.duration, 0);
        const startTime = containingDeletedInterval
          ? Math.max(0, containingDeletedInterval.start - removedBefore)
          : Math.max(0, track.startTime - removedBefore);
        return [{ ...track, startTime }];
      });
      const manualStoryboard = rebaseManualStoryboardAfterShotDeletion({
        workspace: activeScene.manualStoryboard,
        shots: remainingShots,
        sourceHash: manualStoryboardReadModel?.sourceHash,
      });
      await updateScene(activeScene.id, {
        shots: remainingShots,
        audioTracks,
        ...(manualStoryboard ? { manualStoryboard } : {}),
      }, activeEpisode.id);
      if (activeShotId && deletedIds.has(activeShotId)) selectShot(null);
      setSelectedShotIds([]);
      setIsBatchDeleteConfirmOpen(false);
      toast.success(`已删除 ${deletedIds.size} 个分镜。`);
    } finally {
      setIsDeletingSelectedShots(false);
    }
  };

  useEffect(() => {
    if (isRequestedProjectPending || !isDirectorProductionRoute || !urlEpisodeId || !currentProject?.episodes.some((episode) => episode.id === urlEpisodeId) || activeEpisode?.id === urlEpisodeId) return;
    void setActiveEpisodeId(urlEpisodeId, {
      view: storyboardEpisodeView,
      sceneId: urlSceneId || undefined,
      shotId: undefined,
    });
  }, [
    activeEpisode?.id,
    currentProject?.episodes,
    isDirectorProductionRoute,
    isRequestedProjectPending,
    setActiveEpisodeId,
    storyboardEpisodeView,
    urlEpisodeId,
    urlSceneId,
  ]);

  useEffect(() => {
    if (!isDirectorProductionRoute || !activeEpisode || isRequestedProjectPending) return;
    const workspaceEpisode = activeEpisode as typeof activeEpisode & {
      __workspaceView?: string;
      __workspaceSceneScope?: string;
      __workspaceShotSummaryOnly?: boolean;
      __workspaceShotScope?: string;
    };
    const expectedSceneScope = urlSceneId || activeSceneId || undefined;
    if (
      workspaceEpisode.__workspaceView === "storyboard"
      && (!expectedSceneScope || workspaceEpisode.__workspaceSceneScope === expectedSceneScope)
      && !workspaceEpisode.__workspaceShotSummaryOnly
    ) return;
    void setActiveEpisodeId(activeEpisode.id, {
      view: storyboardEpisodeView,
      sceneId: expectedSceneScope,
      shotId: undefined,
    });
  }, [
    activeEpisode,
    activeSceneId,
    isDirectorProductionRoute,
    isRequestedProjectPending,
    setActiveEpisodeId,
    storyboardEpisodeView,
    urlSceneId,
    videoGenerationMode,
  ]);

  useEffect(() => {
    if (isRequestedProjectPending) return;
    const scene = baseScenes.find((item) => item.id === urlSceneId) || baseScenes[0];
    if (!scene) {
      setActiveSceneId(null);
      setActiveShotId(null);
      return;
    }
    setActiveSceneId(scene.id);
    setActiveShotId((currentShotId) => {
      if (scene.shots?.some((shot) => shot.id === currentShotId)) return currentShotId;
      if (scene.shots?.some((shot) => shot.id === urlShotId)) return urlShotId;
      return videoGenerationMode === "shot" ? scene.shots?.[0]?.id || null : null;
    });
  }, [baseScenes, isRequestedProjectPending, urlSceneId, urlShotId, videoGenerationMode]);

  useEffect(() => {
    if (!activeScene?.shots?.length) {
      if (activeShotId) setActiveShotId(null);
      return;
    }
    if (activeShotId && !activeScene.shots.some((shot) => shot.id === activeShotId)) {
      setActiveShotId(videoGenerationMode === "shot" ? activeScene.shots[0]?.id || null : null);
    } else if (videoGenerationMode === "shot" && !activeShotId) {
      setActiveShotId(activeScene.shots[0]?.id || null);
    }
  }, [activeScene, activeShotId, videoGenerationMode]);

  useEffect(() => {
    setIsProductionEvidenceOpen(false);
  }, [activeScene?.id]);

  if (isRequestedProjectPending || (!currentProject && isLoading)) {
    return <div className="flex h-full items-center justify-center bg-bg-primary"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>;
  }

  if (!currentProject) {
    return (
      <EmptyState
        title="选择制片项目"
        description="请先选择制片项目，或导入剧本开始制作。"
        actionLabel={isInteractiveNodeWorkspace ? "返回互动影视" : "前往导演制片"}
        onAction={() => navigate(isInteractiveNodeWorkspace ? "/interactive" : "/production")}
      />
    );
  }

  if (!activeEpisode) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="未选择可制作的场次"
        description="请到剧本与场次选择或拆解场次，再制作分镜。"
        actionLabel={isInteractiveNodeWorkspace ? "返回互动影视" : "前往剧本与场次"}
        onAction={() => navigate(isInteractiveNodeWorkspace ? "/interactive" : productionPreparationHref({ projectId: currentProject.id, returnTo: interactiveReturnTo }))}
      />
    );
  }

  const sceneCount = baseScenes.length || 1;
  const targetDurationMins = activeScene?.targetDuration || (activeEpisode?.targetDuration ? (activeEpisode.targetDuration / sceneCount) : 1);
  const estimatedSceneDuration = (targetDurationMins * 60).toFixed(0); // in seconds
  const activeBatchScene = currentStoryboardBatchScene?.scene.id === activeScene?.id
    ? currentStoryboardBatchScene
    : undefined;

  const isSidebarCollapsed = !isSidebarOpen;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="mx-auto w-full max-w-7xl flex flex-1 min-h-0 overflow-hidden h-full px-3 pb-4 pt-3 md:px-8 md:pb-8 md:pt-4 flex-col md:flex-row relative bg-bg-primary"
    >
      <div className={cn("flex flex-1 min-h-0 overflow-hidden h-full w-full", isSidebarOpen ? "md:gap-6" : "")}>
        {!isInteractiveNodeWorkspace && (
          <div className={cn(
            "hidden transition-all duration-300 ease-in-out shrink-0 overflow-hidden h-full md:block",
            isSidebarOpen ? "w-72 opacity-100" : "w-0 opacity-0 pointer-events-none"
          )}>
            <div className="flex h-full w-full flex-col border border-border-soft/20 bg-bg-surface rounded-2xl shadow-sm overflow-hidden">
              <ProductionSceneRail 
                episode={activeEpisode}
                scenes={baseScenes}
                activeSceneId={activeSceneId}
                onSelect={selectScene}
                flat={true}
                showStoryboardMetrics={true}
              />
              {activeScene && (
                <div className="border-t border-border-soft/10 p-4 bg-bg-surface">
                  <InteractiveSceneContextPanel
                    project={currentProject}
                    episode={activeEpisode}
                    scene={activeScene}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex-grow min-w-0 h-full relative">
          {/* Toggle Button */}
          {!isInteractiveNodeWorkspace && (
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className={cn(
                "absolute top-6 z-30 hidden h-6 w-6 items-center justify-center rounded-full border border-border-soft/60 bg-bg-surface text-text-muted shadow-md transition-all hover:bg-bg-surface-hover hover:text-text-primary active:scale-95 cursor-pointer md:flex",
                isSidebarOpen ? "-left-3" : "-left-3 rotate-180"
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          <div className="h-full w-full bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm overflow-hidden flex flex-col relative text-text-primary">
        {(currentProject.projectModel === 'interactive' || !!currentProject.interactiveTemplate) && (
          <div className="bg-bg-surface border-b border-border-soft/20 px-6 py-2.5 flex items-center justify-between">
            <p className="text-xs text-text-secondary font-medium">
              当前处于互动游戏模式，读取源：{sceneReadModel.sourceLabel}；写入目标：{sceneReadModel.writeTarget}。
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate(isInteractiveNodeWorkspace ? "/interactive" : productionPreparationHref({ projectId: currentProject.id, episodeId: activeEpisode.id, returnTo: interactiveReturnTo }))} className="h-7 px-3 bg-bg-surface-soft border border-border-soft hover:bg-bg-surface-hover text-text-primary rounded-lg text-xs font-bold transition-all cursor-pointer">{isInteractiveNodeWorkspace ? '返回互动影视' : '返回剧本与场次'}</button>
            </div>
          </div>
        )}
        {activeScene ? (
          <div className="flex-1 flex flex-col p-4 md:p-10 w-full overflow-y-auto custom-scrollbar">
            {!isInteractiveNodeWorkspace && (
              <label className="mb-4 block md:hidden">
                <span className="sr-only">切换场次</span>
                <select
                  aria-label="切换场次"
                  value={activeSceneId || activeScene.id}
                  onChange={(event) => selectScene(event.target.value)}
                  className="h-10 w-full rounded-md border border-border-soft/35 bg-bg-surface-soft px-3 text-xs font-bold text-text-primary outline-none focus:border-gold/60"
                >
                  {baseScenes.map((scene, index) => (
                    <option key={scene.id} value={scene.id}>
                      {String(index + 1).padStart(2, "0")} · {scene.title} · {Number((scene as Scene & { shotCount?: number }).shotCount ?? scene.shots?.length ?? 0)} 镜头
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isInteractiveNodeWorkspace && activeScene && <div className="mb-5"><InteractiveSceneContextPanel project={currentProject} episode={activeEpisode} scene={activeScene} /></div>}
            {isSceneDetailPending && (
              <div role="status" className="mb-3 text-xs font-semibold text-gold">
                正在切换场次…
              </div>
            )}
            {activeVisualScenario && interactiveExperienceId && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border-soft/25 bg-bg-surface-soft px-3 py-2">
                {(activeScene.interactiveMetadata?.visualScenarios?.length || 0) > 1 ? (
                  <>
                    <label htmlFor="storyboard-visual-scenario" className="text-xs font-bold text-text-secondary">
                      当前画面状态
                    </label>
                    <select
                      id="storyboard-visual-scenario"
                      value={activeVisualScenario.id}
                      onChange={(event) => {
                        if (!activeEpisode || !activeScene.interactiveMetadata) return;
                        updateScene(activeScene.id, {
                          interactiveMetadata: {
                            ...activeScene.interactiveMetadata,
                            activeVisualScenarioId: event.target.value,
                          },
                        }, activeEpisode.id);
                      }}
                      className="h-8 min-w-52 rounded-md border border-border-soft/35 bg-bg-surface px-2 text-xs font-bold text-text-primary outline-none focus:border-gold/60"
                    >
                      {activeScene.interactiveMetadata?.visualScenarios?.map((scenario) => (
                        <option key={scenario.id} value={scenario.id}>{scenario.label}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span className="text-xs font-bold text-text-secondary">
                    当前故事状态对应的画面
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[11px] text-text-muted">
                  {activeVisualScenario.label}
                </span>
                <button
                  type="button"
                  title="请 AI 完善当前画面差异"
                  aria-label="请 AI 完善当前画面差异"
                  disabled={isVisualRefinementBusy}
                  onClick={() => setIsVisualRefinementPromptOpen(true)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-soft/35 bg-bg-surface text-text-secondary transition-colors hover:border-gold/50 hover:text-gold disabled:opacity-50"
                >
                  {isVisualRefinementBusy
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Sparkles className="h-4 w-4" />}
                </button>
              </div>
            )}
            <DirectorPlanSummary plan={activeScene.manualStoryboard?.directorPlan} shots={activeScene.shots || []}
              status={directorPlanStatus(currentProject, { episode: activeEpisode, scene: activeScene })}
              onChange={async plan => {
                const state = useProjectStore.getState();
                const latest = state.activeEpisode?.scenes.find(item => item.id === activeScene.id);
                if (state.currentProject?.id !== currentProject.id || state.activeEpisode?.id !== activeEpisode!.id || !latest?.manualStoryboard || latest.manualStoryboard.directorPlan?.id !== plan.id) throw new Error("当前方案已变化，请重新打开编辑");
                await updateScene(latest.id, { manualStoryboard: { ...latest.manualStoryboard, directorPlan: plan, updatedAt: Date.now() } }, activeEpisode!.id, { expectedProjectId: currentProject.id, expectedEpisodeId: activeEpisode!.id });
                await flushDebouncedProjectSave(currentProject.id);
              }}
              disabled={isStoryboardMutationBusy} onRedesign={() => void handlePrepareGenerateShots(estimatedSceneDuration, targetDurationMins)} />
            <StoryboardHeader 
              activeScene={activeScene}
              isGenerating={isStoryboardMutationBusy}
              onPrepareGenerateShots={() => handlePrepareGenerateShots(estimatedSceneDuration, targetDurationMins)}
              currentShotPlanComplete={activeBatchScene?.shotPlanComplete ?? currentStoryboardCompletion?.shotPlanComplete}
              onPrepareGenerateImagePrompts={handlePrepareGenerateImagePrompts}
              onPrepareGenerateVideoPrompts={handlePrepareGenerateVideoPrompts}
              currentImagePromptComplete={activeBatchScene?.imagePromptComplete ?? currentStoryboardCompletion?.imagePromptComplete}
              currentVideoPromptComplete={activeBatchScene?.videoPromptComplete ?? currentStoryboardCompletion?.videoPromptComplete}
              currentBoardComplete={activeBatchScene?.boardComplete ?? currentStoryboardCompletion?.boardComplete}
              currentBoardApproved={activeBatchScene?.boardApproved ?? currentStoryboardCompletion?.boardApproved}
              boardBlockReason={activeBatchScene?.boardBlockReason || productionPreparationGate?.storyboardReason}
              estimatedSceneDuration={estimatedSceneDuration}
              videoGenerationMode={videoGenerationMode}
              showVideoModeControl
              onVideoGenerationModeChange={(mode) => {
                const next = new URLSearchParams(searchParams);
                next.set("videoMode", mode);
                if (mode === "storyboard") next.delete("shotId");
                setSearchParams(next, { replace: true });
              }}
              onReturnToPreparation={() => {
                const params = new URLSearchParams({
                  projectId: currentProject.id,
                  episodeId: activeEpisode.id,
                  sceneId: activeScene.id,
                  tab: "assets",
                });
                if (interactiveReturnTo) params.set("returnTo", interactiveReturnTo);
                navigate(`/production/preparation?${params}`);
              }}
              onReturnToInteractive={interactiveReturnTo ? () => navigate(interactiveReturnTo) : undefined}
              aspectRatio={currentProject.aspectRatio || "16:9"}
              visualStyleLock={currentProject.visualStyleLock}
              fallbackVisualStyle={currentProject.creativeVision?.visualStyle}
              onOpenGenerationParams={() => setIsGenerationParamsOpen(true)}
              productionGate={manualProductionAssetReadModel ? {
                shotPlanningReady: productionPreparationGate?.readyForShotPlanning || false,
                imagePromptReady: manualStoryboardReadModel?.readyForImagePromptGeneration,
                videoPromptReady: manualStoryboardReadModel?.readyForVideoPromptGeneration,
                shotPlanningReason: productionPreparationGate?.shotPlanningReason || "请先填写当前场次原文，或手动添加镜头。",
                imagePromptReason: promptGenerationBlockReason,
                videoPromptReason: promptGenerationBlockReason,
              } : undefined}
            />
            <StoryboardMediaCandidateReview
              projectId={currentProject.id}
              sceneId={activeScene.id}
            />

            <StoryboardAgentStatusBar
              progress={agentProgress}
              hasResult={Boolean(reviewCandidate)}
              onViewResult={openReviewCandidate}
            />
            <StoryboardAgentStatusBar
              progress={boardBatchAgent.progress}
              hasResult={false}
              onViewResult={() => undefined}
            />

            {videoGenerationMode === "shot" && !isDirectorProductionRoute && (!manualFilmTeamReadModel || productionPreparationGate?.readyForShotPlanning) && (
              isDirectorProductionRoute ? (
                <section className="mb-5 rounded-lg border border-border-soft/25 bg-bg-surface-soft">
                  <button
                    type="button"
                    aria-expanded={isProductionEvidenceOpen}
                    onClick={() => setIsProductionEvidenceOpen((value) => !value)}
                    className="flex h-11 w-full items-center justify-between gap-3 px-4 text-left text-xs font-bold text-text-secondary transition-colors hover:bg-bg-surface-hover hover:text-text-primary"
                  >
                    <span>筹备依据</span>
                    <span className="flex items-center gap-2 text-[11px] text-text-muted">
                      {activeEpisode.productionTeam?.outputs?.filter((output) => output.status === "confirmed").length || 0} 个部门已确认
                      <ChevronDown className={cn("h-4 w-4 transition-transform", isProductionEvidenceOpen && "rotate-180")} />
                    </span>
                  </button>
                  {isProductionEvidenceOpen && (
                    <div className="border-t border-border-soft/25 p-3">
                      <Suspense fallback={<DeferredPanelFallback />}>
                        <DepartmentBoardsPanel
                          project={currentProject}
                          episode={activeEpisode}
                          scene={activeScene}
                          activeShot={activeShot}
                          cockpit={productionCockpit}
                          manualReadModel={manualFilmTeamReadModel}
                          onRefresh={refreshProductionCockpit}
                        />
                      </Suspense>
                    </div>
                  )}
                </section>
              ) : (
                <Suspense fallback={<DeferredPanelFallback />}>
                  <DepartmentBoardsPanel
                    project={currentProject}
                    episode={activeEpisode}
                    scene={activeScene}
                    activeShot={activeShot}
                    cockpit={productionCockpit}
                    manualReadModel={manualFilmTeamReadModel}
                    onRefresh={refreshProductionCockpit}
                  />
                </Suspense>
              )
            )}

            {videoGenerationMode === "storyboard" && (
              <>
                <div className="mb-4">
                  <h2 className="text-sm font-bold text-text-primary">本场视频单元</h2>
                </div>
                {manualFilmTeamReadModel && manualProductionAssetReadModel && manualStoryboardReadModel ? (
                storyboardUnitAnchors.length ? (
                <div className="space-y-6 pb-12">
                  {storyboardUnitAnchors.map((unit, unitIndex) => unit.persisted ? (
                      <Suspense key={unit.id} fallback={<DeferredPanelFallback />}>
                        <ManualVideoStoryboardPanel
                          project={currentProject}
                          episode={activeEpisode}
                          scene={activeScene}
                          shot={unit.shot}
                          shotIndex={unit.shotIndex}
                          workflowOverride={unit.workflow}
                          storyboardSourceHash={manualStoryboardReadModel.sourceHash}
                          upstreamReady={Boolean(unit.shot)}
                          visualReady={Boolean(productionPreparationGate?.readyForStoryboard && manualStoryboardReadModel.readyForStoryboardFormalAdoption)}
                          videoPromptReady={manualStoryboardReadModel.readyForStudioVideoGeneration}
                          filmTeam={manualFilmTeamReadModel}
                          assets={manualProductionAssetReadModel}
                          updateScene={updateScene}
                          onGenerateVisuals={() => boardBatchAgent.prepareScene(activeScene.id)}
                          groupingProposal={storyboardGroupingProposals.get(unit.id)
                            ? {
                                ...storyboardGroupingProposals.get(unit.id)!,
                                onAdopt: () => void adoptStoryboardGroupingProposal(unit.id),
                              }
                            : undefined}
                          onMergeWithNext={unitIndex < storyboardUnitAnchors.length - 1
                            ? () => void mergeStoryboardUnitWithNext(unitIndex)
                            : undefined}
                          onSplitUnit={unit.shotIds.length > 1
                            ? () => void splitStoryboardUnit(unitIndex)
                            : undefined}
                          onContinueToStudio={() => {
                            const params = new URLSearchParams({
                              projectId: currentProject.id,
                              episodeId: activeEpisode.id,
                              sceneId: activeScene.id,
                              shotId: unit.shot.id,
                              videoUnitId: unit.workflow.videoGenerationUnitId || unit.workflow.board?.videoGenerationUnitId || unit.id,
                              videoMode: "storyboard",
                            });
                            if (interactiveReturnTo) params.set("returnTo", interactiveReturnTo);
                            navigate(`/production/studio?${params}`);
                          }}
                        />
                      </Suspense>
                    ) : (
                      <PendingCompositeStoryboardCard
                        key={unit.id}
                        shotLabel={storyboardShotLabel(unit.shotIds, activeScene.shots)}
                        shotCount={unit.shotIds.length}
                        durationSeconds={unit.shotIds.reduce((sum, shotId) => sum + Number(activeScene.shots?.find((shot) => shot.id === shotId)?.duration || 0), 0)}
                        shots={(activeScene.shots || []).filter((shot) => unit.shotIds.includes(shot.id))}
                        ready={activeBatchScene?.boardDraftReady}
                        visualReady={activeBatchScene?.boardFormalReady}
                        blockReason={activeBatchScene?.boardBlockReason}
                        visualBlockReason={activeBatchScene?.boardVisualBlockReason}
                        isGenerating={boardBatchAgent.isRunning}
                        referenceMode={storyboardDefaultModeDraft}
                        onReferenceModeChange={(mode) => void setStoryboardDefaultReferenceMode(mode)}
                        onGenerate={() => boardBatchAgent.prepareScene(activeScene.id)}
                      />
                    ))}
                </div>
              ) : (
                <PendingCompositeStoryboardCard
                  shotLabel="本场"
                  shotCount={(activeScene.shots || []).length}
                  durationSeconds={(activeScene.shots || []).reduce((sum, shot) => sum + Number(shot.duration || 0), 0)}
                  shots={activeScene.shots || []}
                  ready={activeBatchScene?.boardDraftReady}
                  visualReady={activeBatchScene?.boardFormalReady}
                  blockReason={activeBatchScene?.boardBlockReason}
                  visualBlockReason={activeBatchScene?.boardVisualBlockReason}
                  isGenerating={boardBatchAgent.isRunning}
                  referenceMode={storyboardDefaultModeDraft}
                  onReferenceModeChange={(mode) => void setStoryboardDefaultReferenceMode(mode)}
                  onGenerate={() => boardBatchAgent.prepareScene(activeScene.id)}
                />
                )
              ) : (
                <PendingCompositeStoryboardCard
                  shotLabel="本场"
                  shotCount={(activeScene.shots || []).length}
                  durationSeconds={(activeScene.shots || []).reduce((sum, shot) => sum + Number(shot.duration || 0), 0)}
                  ready={false}
                  blockReason={activeBatchScene?.boardBlockReason || productionPreparationGate?.storyboardReason}
                  referenceMode={storyboardDefaultModeDraft}
                  onReferenceModeChange={(mode) => void setStoryboardDefaultReferenceMode(mode)}
                />
              )}
              </>
            )}

            {videoGenerationMode === "shot" && (activeScene.shots && activeScene.shots.length > 0 ? (
              <div className="pb-12 mt-6 space-y-5">
                {!!activeScene.shotHistory?.length && <details className="text-xs"><summary className="cursor-pointer text-text-muted">历史镜头版本 · {activeScene.shotHistory.length}</summary><div className="mt-2 flex flex-wrap gap-3">{activeScene.shotHistory.map(version => <button type="button" key={version.at} className="text-cyan-600 dark:text-cyan-400" onClick={async () => { await updateScene(activeScene.id, { shots: version.shots, audioTracks: version.audioTracks, manualStoryboard: version.manualStoryboard }, activeEpisode.id, { archiveReplacedShots: true }); await flushDebouncedProjectSave(currentProject.id); }}>恢复 {new Date(version.at).toLocaleString()} · {version.shots.length} 镜头</button>)}</div></details>}
                <div className="flex flex-wrap items-center gap-2 border-y border-border-soft/30 py-3" aria-label="分镜批量操作">
                  <button type="button" onClick={() => void addManualShot()} disabled={isStoryboardMutationBusy}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-soft/40 bg-bg-surface px-3 text-xs font-bold text-text-primary transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">
                    <Plus className="h-4 w-4" /> 手动添加镜头
                  </button>
                  <button
                    type="button"
                    onClick={toggleAllShotBatchSelection}
                    disabled={isStoryboardMutationBusy}
                    aria-pressed={allShotsSelected}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-soft/40 bg-bg-surface px-3 text-xs font-bold text-text-primary transition-colors hover:bg-bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {allShotsSelected ? <CheckSquare2 className="h-4 w-4 text-cyan-400" /> : <Square className="h-4 w-4" />}
                    {allShotsSelected ? "取消全选" : "全选"}
                  </button>
                  {selectedShotIds.length > 0 && activeEpisode && <ProductionCreativeControls project={currentProject} episode={activeEpisode} scene={activeScene} shotIds={selectedShotIds} compact />}
                  <span className="mr-2 text-xs font-semibold text-text-muted">已选 {selectedShotIds.length}/{selectableShotIds.length}</span>
                  <button
                    type="button"
                    onClick={() => void runShotBatchQueue(selectedShotIds, "image_prompt")}
                    disabled={selectedShotIds.length === 0 || isStoryboardMutationBusy}
                    title="按场内顺序逐个调用模型，不会合并为一次请求"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-soft/40 bg-bg-surface px-3 text-xs font-bold text-text-primary transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <FileImage className="h-4 w-4" />
                    依次生成图片提示词
                  </button>
                  <button
                    type="button"
                    onClick={() => void runShotBatchQueue(selectedShotIds, "video_prompt")}
                    disabled={selectedShotIds.length === 0 || isStoryboardMutationBusy}
                    title="按场内顺序逐个调用模型，不会合并为一次请求"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-soft/40 bg-bg-surface px-3 text-xs font-bold text-text-primary transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Video className="h-4 w-4" />
                    依次生成视频提示词
                  </button>
                  <button
                    type="button"
                    onClick={() => void runShotBatchQueue(selectedShotIds, "image")}
                    disabled={selectedShotIds.length === 0 || isStoryboardMutationBusy}
                    title="使用每个分镜自己的图片提示词和参考图，逐张排队生成"
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-soft/40 bg-bg-surface px-3 text-xs font-bold text-text-primary transition-colors hover:border-cyan-500/50 hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ListChecks className="h-4 w-4" />
                    依次生成分镜图片
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsBatchDeleteConfirmOpen(true)}
                    disabled={selectedShotIds.length === 0 || isStoryboardMutationBusy}
                    className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg border border-status-error/35 px-3 text-xs font-bold text-status-error transition-colors hover:bg-status-error/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    批量删除
                  </button>
                  {shotBatchProgress && (
                    <div className="flex w-full items-center gap-2 pt-1 text-xs font-semibold text-text-muted" role="status" aria-live="polite">
                      {shotBatchProgress.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />}
                      <span>
                        {shotBatchProgress.action === "image_prompt" ? "图片提示词" : shotBatchProgress.action === "video_prompt" ? "视频提示词" : "分镜图片"}
                        {shotBatchProgress.status === "running"
                          ? `队列 ${shotBatchProgress.currentIndex}/${shotBatchProgress.total}`
                          : `队列完成：成功 ${shotBatchProgress.completed}，失败 ${shotBatchProgress.failures.length}`}
                      </span>
                    </div>
                  )}
                </div>
                <div
                  className="grid gap-5"
                  style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" }}
                >
                  {activeScene.shots.map((shot, index) => (
                    <div key={shot.id} className="min-w-0">
                      <ShotAppearanceEditor project={currentProject} shot={shot} saved onChange={saveAppearanceShot} issues={appearanceIssues(currentProject, activeScene, shot, appearanceSourceShots(activeEpisode, appearanceHistoryContext || currentStoryboardBatchScene?.manualTeamContext || "")).map(i => i.message)} />
                      <Suspense fallback={<DeferredPanelFallback />}>
                        <ShotCard
                          shot={shot}
                          index={index}
                          activeScene={activeScene}
                          activeEpisodeId={activeEpisode.id}
                          updateScene={updateScene}
                          storyboardSourceHash={manualStoryboardReadModel?.sourceHash}
                          onReroll={handleRerollShot}
                          onGenerateImagePrompt={(shotId) => handlePrepareGenerateShotPrompt(shotId, "image")}
                          onGenerateVideoPrompt={(shotId) => handlePrepareGenerateShotPrompt(shotId, "video")}
                          isGeneratingImage={generatingShotImageId === shot.id}
                          promptGenerationBusy={isStoryboardMutationBusy}
                          generatingPromptKind={generatingShotPrompt?.shotId === shot.id ? generatingShotPrompt.kind : undefined}
                          onGenerateSpatial={handlePrepareGenerateShotSpatial}
                          selected={activeShot?.id === shot.id}
                          onSelect={selectShot}
                          batchSelected={selectedShotIdSet.has(shot.id)}
                          onToggleBatchSelection={toggleShotBatchSelection}
                          aiGenerationBlockedReason={productionPreparationGate && !productionPreparationGate.readyForShotPlanning
                            ? productionPreparationGate.shotPlanningReason
                            : undefined}
                        />
                      </Suspense>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border-soft/35 bg-bg-surface text-text-muted">
                <div className="w-20 h-20 rounded-full bg-gray-50 dark:bg-neutral-950 flex items-center justify-center mb-6">
                  <Camera className="w-10 h-10 opacity-20" />
                </div>
                <p className="mb-5 text-base font-bold text-text-primary">
                  {productionPreparationGate && !productionPreparationGate.readyForShotPlanning ? "分镜规划尚未就绪" : "该场景尚未生成分镜"}
                </p>
                {productionPreparationGate && !productionPreparationGate.readyForShotPlanning ? (
                  <p className="max-w-xl text-center text-xs font-semibold leading-5 text-amber-500">
                    {productionPreparationGate.shotPlanningReason}
                  </p>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void handlePrepareGenerateShots(estimatedSceneDuration, targetDurationMins)}
                    disabled={isStoryboardMutationBusy}
                    className="h-10 px-5"
                  >
                    {isStoryboardMutationBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    生成分镜
                  </Button>
                )}
                <Button type="button" onClick={() => void addManualShot()} disabled={isStoryboardMutationBusy}
                  className="mt-3 h-10 border border-border-soft/40 bg-bg-surface px-5 text-text-primary hover:bg-bg-surface-hover">
                  <Plus className="h-4 w-4" /> 手动添加镜头
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-grow flex flex-col items-center justify-center text-text-muted bg-bg-surface p-10">
            <div className="w-16 h-16 rounded-full bg-bg-surface-soft flex items-center justify-center mb-4">
              <Camera className="w-8 h-8 opacity-40 text-gold" />
            </div>
            <p className="text-xs font-bold text-text-primary uppercase tracking-wider">选择左侧场景开始制作分镜</p>
          </div>
        )}
        </div>
      </div>
      </div>

      {(promptModalState.isOpen || boardBatchAgent.promptRequest || isVisualRefinementPromptOpen) && (
        <Suspense fallback={null}>
          {promptModalState.isOpen && (
            <PromptEditorModal
              isOpen
              onClose={() => setPromptModalState(prev => ({ ...prev, isOpen: false }))}
              templateId={promptModalState.templateId}
              title={promptModalState.templateId === "generateShots"
                ? promptModalState.title || "生成分镜"
                : promptModalState.templateId === "generateImage"
                  ? promptModalState.title || "生成分镜画面"
                  : promptModalState.templateId === "generateImagePrompts"
                    ? promptModalState.title || "生成图片提示词"
                    : promptModalState.templateId === "generateVideoPrompts"
                      ? promptModalState.title || "生成视频提示词"
                      : promptModalState.title}
              variables={promptModalState.variables}
              onConfirm={promptModalState.onConfirm}
              contextOptions={promptModalState.contextOptions}
              defaultSelectedContextIds={promptModalState.defaultSelectedContextIds}
              imageReferences={promptModalState.imageReferences}
              defaultSelectedImageReferenceIds={promptModalState.defaultSelectedImageReferenceIds}
              imageVisualStyleProjection={promptModalState.imageVisualStyleProjection}
              activeSceneId={activeSceneId || undefined}
              activeEpisodeId={activeEpisode?.id}
            />
          )}
          {boardBatchAgent.promptRequest && (
            <PromptEditorModal
              isOpen
              onClose={boardBatchAgent.closePrompt}
              templateId={boardBatchAgent.promptRequest.templateId}
              title={boardBatchAgent.promptRequest.title}
              variables={boardBatchAgent.promptRequest.variables}
              onConfirm={boardBatchAgent.executeBatch}
              contextOptions={boardBatchAgent.promptRequest.contextOptions}
              defaultSelectedContextIds={boardBatchAgent.promptRequest.defaultSelectedContextIds}
              activeSceneId={activeSceneId || undefined}
              activeEpisodeId={activeEpisode?.id}
            />
          )}
          {isVisualRefinementPromptOpen && (
            <PromptEditorModal
              isOpen
              onClose={() => setIsVisualRefinementPromptOpen(false)}
              templateId="interactiveVisualRefinement"
              title="请 AI 完善当前画面差异"
              variables={visualRefinementVariables}
              onConfirm={createVisualRefinement}
              activeSceneId={activeSceneId || undefined}
              activeEpisodeId={activeEpisode?.id}
            />
          )}
        </Suspense>
      )}

      {isGenerationParamsOpen && (
        <Suspense fallback={null}>
          <GlobalGenerationParamsModal
            isOpen
            onClose={() => setIsGenerationParamsOpen(false)}
          />
        </Suspense>
      )}

      <Modal
        isOpen={isBatchDeleteConfirmOpen}
        onClose={() => setIsBatchDeleteConfirmOpen(false)}
        title="删除所选分镜"
        size="sm"
        footer={(
          <>
            <Button type="button" variant="secondary" size="sm" onClick={() => setIsBatchDeleteConfirmOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={isStoryboardMutationBusy}
              onClick={() => void deleteSelectedShots()}
            >
              {isDeletingSelectedShots ? "正在删除…" : `删除 ${selectedShotIds.length} 个分镜`}
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-text-secondary">
          将删除所选分镜及其明确关联的音轨，并自动收拢后续时间位置。此操作不会删除项目资产。
        </p>
      </Modal>

      <Modal
        isOpen={Boolean(visualRefinementCandidate)}
        onClose={() => {
          if (!isVisualRefinementBusy) setVisualRefinementCandidate(null);
        }}
        title="审阅 AI 画面方案"
        size="lg"
        closeOnBackdrop={!isVisualRefinementBusy}
        footer={(
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isVisualRefinementBusy}
              onClick={() => void rejectVisualRefinement()}
            >
              放弃方案
            </Button>
            <Button
              type="button"
              size="sm"
              isLoading={isVisualRefinementBusy}
              onClick={() => void adoptVisualRefinement()}
            >
              采用方案
            </Button>
          </>
        )}
      >
        {visualRefinementCandidate && (
          <div className="space-y-5 text-sm text-text-primary">
            <div>
              <p className="text-xs font-bold text-text-muted">画面状态</p>
              <p className="mt-1 font-bold">{visualRefinementCandidate.proposal.label}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-text-muted">环境会怎样不同</p>
              <ul className="mt-2 space-y-2">
                {visualRefinementCandidate.proposal.environmentChanges.map((change) => (
                  <li key={change} className="border-l-2 border-cyan-400/70 pl-3">{change}</li>
                ))}
                {visualRefinementCandidate.proposal.environmentChanges.length === 0 && (
                  <li className="text-text-muted">环境保持当前方案。</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-text-muted">人物会怎样表演</p>
              <ul className="mt-2 space-y-2">
                {visualRefinementCandidate.proposal.performanceConstraints.map((constraint) => (
                  <li key={constraint} className="border-l-2 border-amber-400/70 pl-3">{constraint}</li>
                ))}
                {visualRefinementCandidate.proposal.performanceConstraints.length === 0 && (
                  <li className="text-text-muted">人物表演保持当前方案。</li>
                )}
              </ul>
            </div>
            {visualRefinementCandidate.proposal.rationale && (
              <div>
                <p className="text-xs font-bold text-text-muted">为什么这样安排</p>
                <p className="mt-2 leading-6 text-text-secondary">
                  {visualRefinementCandidate.proposal.rationale}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {isReviewCandidateOpen && (
        <Suspense fallback={null}>
          <ManualStoryboardReviewModal
            candidate={reviewCandidate}
            project={currentProject}
            previousScene={activeEpisode?.scenes.find(scene => scene.id === reviewCandidate?.sceneId)}
            onChangeShot={updateReviewShot}
            onChangePlan={updateReviewPlan}
            onClose={closeReviewCandidate}
            onAdopt={adoptReviewCandidate}
          />
        </Suspense>
      )}
    </motion.div>
  );
}
