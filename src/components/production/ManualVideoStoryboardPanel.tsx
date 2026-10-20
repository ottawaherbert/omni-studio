import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clapperboard, Combine, Grid3X3, Loader2, RefreshCw, Save, Scissors, ShieldCheck, SlidersHorizontal, Sparkles } from "lucide-react";
import PromptEditorModal from "../PromptEditorModal";
import type { Episode, ManualStoryboardBoardWorkflow, Project, Scene, Shot } from "../../clients/domainTypes";
import type { ManualFilmTeamReadModel } from "../../clients/productionPreparationWorkflowClient";
import type { ManualProductionAssetReadModel } from "../../clients/productionAssetWorkflowClient";
import { useManualVideoStoryboard } from "../../hooks/useManualVideoStoryboard";
import { ManualVideoStoryboardReviewModal } from "./ManualVideoStoryboardReviewModal";
import {
  buildStoryboardCompositeVisualPages,
  buildStoryboardShotCellManifest,
  getActiveStoryboardBoardVisualTake,
  getLatestStoryboardBoardVisualCandidate,
  listStoryboardShotRepresentativePanels,
  resolveStoryboardShotGridImage,
  scopeStoryboardCompositeBoardToPage,
  storyboardShotGridStatus,
} from "../../clients/productionStoryboardWorkflowClient";
import { getStoryboardPromptStrategyById } from "../../clients/productionStoryboardWorkflowClient";
import { useAIConfigStore } from "../../clients/stateClient";

interface ManualVideoStoryboardPanelProps {
  project: Project;
  episode: Episode;
  scene: Scene;
  shot: Shot | null;
  workflowOverride?: ManualStoryboardBoardWorkflow;
  shotIndex: number;
  storyboardSourceHash?: string;
  /** Ready Shot structure; strategy, board structure and board QA depend only on this layer. */
  upstreamReady: boolean;
  /** Ready confirmed image prompts and formal asset references; only visual rendering depends on this layer. */
  visualReady: boolean;
  /** Ready confirmed video prompts; only the video-unit prompt and Studio depend on this layer. */
  videoPromptReady: boolean;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => void | Promise<void>;
  onGenerateVisuals?: () => void;
  onContinueToStudio?: () => void;
  onMergeWithNext?: () => void;
  onSplitUnit?: () => void;
  groupingProposal?: {
    shotCount: number;
    durationSeconds: number;
    onAdopt: () => void;
  };
  batchManaged?: boolean;
}

const statusLabel = {
  missing: "待生成",
  ready: "已采用",
  stale: "来源有更新",
  needs_review: "待看图",
  needs_revision: "需修改",
  confirmed: "已确认",
};

const statusClass = (status: keyof typeof statusLabel) => status === "confirmed" || status === "ready"
  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
  : status === "stale" || status === "needs_review" || status === "needs_revision"
    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
    : "bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-neutral-300";

type StoryboardPrimaryAction = "strategy" | "board" | "qa" | "video_prompt" | "visuals" | "review_visuals" | "confirm" | null;
const primaryActionFor = (readModel: NonNullable<ReturnType<typeof useManualVideoStoryboard>["readModel"]>): StoryboardPrimaryAction => {
  if (["missing", "needs_revision"].includes(readModel.strategyStatus)) return "strategy";
  if (["missing", "needs_revision"].includes(readModel.boardStatus)) return "board";
  if (["missing", "needs_review", "needs_revision"].includes(readModel.qaStatus)) return "qa";
  if (readModel.panelVisualStatus === "needs_review") return "review_visuals";
  if (readModel.panelVisualStatus === "missing" || readModel.panelVisualStatus === "needs_revision") return "visuals";
  if (readModel.unitVideoPromptStatus === "missing") return "video_prompt";
  if (readModel.qaStatus === "ready" || (readModel.qaStatus === "stale" && !readModel.workflow?.confirmedAt)) return "confirm";
  return null;
};

export function ManualVideoStoryboardPanel(props: ManualVideoStoryboardPanelProps) {
  const {
    readModel,
    promptRequest,
    setPromptRequest,
    candidate,
    setCandidate,
    runningAction,
    prepareAction,
    executePrompt,
    adoptCandidate,
    approveBoardVisual,
    confirmBoard,
    setTargetVideoModel,
    setStoryboardReferenceMode,
    saveUnitVideoPrompt,
    rebuildUnitVideoPrompt,
    composeShotGrid,
    composingGridPageId,
  } = useManualVideoStoryboard(props);
  const videoModels = useAIConfigStore((state) => state.models);
  const videoChannels = useAIConfigStore((state) => state.channels);
  const defaultVideoModelConfigId = useAIConfigStore((state) => state.routing.videoGen);
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [expertOpen, setExpertOpen] = useState(false);
  const [previewModeOverride, setPreviewModeOverride] = useState<"shot_grid" | "director_board" | null>(null);
  const [unitVideoPromptDraft, setUnitVideoPromptDraft] = useState("");
  const board = readModel?.workflow?.board;
  const representativePanels = board ? listStoryboardShotRepresentativePanels(board) : [];
  const previewMode = previewModeOverride || board?.visualReferenceMode || "shot_grid";

  useEffect(() => {
    setSelectedPanelId(representativePanels[0]?.id || null);
    setPreviewModeOverride(null);
  }, [board?.id]);

  useEffect(() => {
    setUnitVideoPromptDraft(readModel?.effectiveUnitVideoPrompt || "");
  }, [readModel?.effectiveUnitVideoPrompt, readModel?.workflow?.id]);

  if (!props.shot || !readModel) {
    return (
      <section className="mb-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-gray-500">当前视频生成单元尚未建立。</p>
      </section>
    );
  }

  const workflow = readModel.workflow;
  const availableVideoModels = videoModels.filter((model) => {
    if (!model.capabilities.includes("video")) return false;
    return videoChannels.some((item) => item.id === model.channelId);
  });
  const qa = workflow?.qa;
  const selectedPanel = board?.panels.find((panel) => panel.id === selectedPanelId);
  const visualPages = board ? (board.visualPages?.length ? board.visualPages : buildStoryboardCompositeVisualPages(board)) : [];
  const selectedPage = visualPages.find((page) => selectedPanelId && page.panelIds.includes(selectedPanelId)) || visualPages[0];
  const selectedActiveVisualTake = selectedPage ? getActiveStoryboardBoardVisualTake(selectedPage) : undefined;
  const selectedPendingVisualTake = selectedPage ? getLatestStoryboardBoardVisualCandidate(selectedPage) : undefined;
  const selectedVisualTake = selectedActiveVisualTake || selectedPendingVisualTake;
  const unitShotIds = Array.from(new Set([
    ...(workflow?.shotIds || []),
    ...(board?.shotIds || []),
    workflow?.shotId,
    props.shot.id,
  ].filter((id): id is string => Boolean(id))));
  const unitShots = unitShotIds
    .map((shotId) => props.scene.shots?.find((shot) => shot.id === shotId))
    .filter((shot): shot is Shot => Boolean(shot));
  const unitDurationSeconds = unitShots.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  const selectedGridCells = board && selectedPage ? buildStoryboardShotCellManifest({ board: scopeStoryboardCompositeBoardToPage(board, selectedPage), shots: unitShots }) : [];
  const missingGridImages = selectedGridCells.filter((cell) => cell.status !== "ready").length;
  const canComposeGrid = selectedGridCells.length > 0 && missingGridImages === 0;
  const unitActionSummary = unitShots.map((shot) => shot.visualAction).filter(Boolean).join(" -> ");
  const compactActionSummary = unitActionSummary.length > 240
    ? `${unitActionSummary.slice(0, 240)}…`
    : unitActionSummary;
  const selectedStrategy = workflow?.strategyDecision
    ? getStoryboardPromptStrategyById(workflow.strategyDecision.selectedStrategyId)
    : undefined;
  const modifierStrategyNames = (workflow?.strategyDecision?.strategyResolution?.modifierStrategyIds || [])
    .map((strategyId) => getStoryboardPromptStrategyById(strategyId)?.name || strategyId);
  const showDetails = !props.batchManaged || expertOpen;
  const primaryAction = primaryActionFor(readModel);
  const batchPlanningManaged = Boolean(
    props.batchManaged
    && unitShotIds.length > 1
    && primaryAction
    && ["strategy", "board", "qa"].includes(primaryAction),
  );
  const primaryActionLabel = primaryAction === "strategy" || primaryAction === "board" || primaryAction === "qa"
    ? "继续准备视频参考"
    : primaryAction === "video_prompt" ? (props.videoPromptReady ? "整理视频单元提示词" : "先生成视频提示词")
      : primaryAction === "visuals" ? (props.visualReady ? "生成视频参考图" : "先生成图片提示词")
      : primaryAction === "review_visuals" ? "查看并采用参考图"
        : primaryAction === "confirm" ? "确认视频参考"
          : "等待上游确认";
  const currentStepLabel = primaryAction === "strategy" || primaryAction === "board" || primaryAction === "qa"
    ? "正在准备镜头方案"
    : primaryAction === "video_prompt" ? (props.videoPromptReady ? "下一步：整理视频提示词" : "等待视频提示词")
      : primaryAction === "visuals" ? (props.visualReady ? "下一步：生成参考图" : "等待图片提示词")
      : primaryAction === "review_visuals" ? "下一步：确认参考图"
        : primaryAction === "confirm" ? "下一步：确认视频参考"
          : "可以进入摄影棚";
  const runPrimaryAction = () => {
    if (primaryAction === "strategy" || primaryAction === "board" || primaryAction === "qa") prepareAction(primaryAction);
    if (primaryAction === "video_prompt") void rebuildUnitVideoPrompt();
    if (primaryAction === "visuals") props.onGenerateVisuals?.();
    if (primaryAction === "review_visuals") {
      const pendingPage = visualPages.find((page) => getLatestStoryboardBoardVisualCandidate(page)?.review?.status === "pending");
      if (pendingPage) {
        setSelectedPanelId(pendingPage.panelIds[0] || null);
        setExpertOpen(true);
      }
    }
    if (primaryAction === "confirm") void confirmBoard();
  };
  const primaryDisabled = Boolean(runningAction)
    || (["strategy", "board", "qa"].includes(primaryAction || "") && !props.upstreamReady)
    || (primaryAction === "video_prompt" && !props.videoPromptReady)
    || (["visuals", "review_visuals", "confirm"].includes(primaryAction || "") && !props.visualReady)
    || (primaryAction === "board" && !readModel.readyForBoardGeneration)
    || (primaryAction === "qa" && !readModel.readyForBoardQA)
    || (primaryAction === "visuals" && !props.onGenerateVisuals)
    || (primaryAction === "review_visuals" && !visualPages.some((page) => getLatestStoryboardBoardVisualCandidate(page)?.review?.status === "pending"));
  const chooseReferenceMode = async (mode: "shot_grid" | "director_board") => {
    const previousMode = previewMode;
    setPreviewModeOverride(mode);
    try {
      await setStoryboardReferenceMode(mode);
    } catch {
      setPreviewModeOverride(previousMode);
    }
  };
  const canEnterStudio = readModel.strategyStatus === "ready"
    && readModel.boardStatus === "ready"
    && (readModel.qaStatus === "ready" || readModel.qaStatus === "confirmed")
    && readModel.unitVideoPromptStatus === "ready";
  return (
    <>
      <section className="mb-6 rounded-lg border border-gray-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-5 py-4 dark:border-neutral-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><Clapperboard className="h-5 w-5 shrink-0 text-violet-600" /><h3 className="font-bold text-gray-900 dark:text-white">视频单元 · {unitShotIds.length} 个分镜 · {unitDurationSeconds || Number(props.shot.duration || 0)}s</h3></div>
            <p className="mt-1 max-w-3xl line-clamp-2 text-xs text-gray-500">{compactActionSummary || props.shot.visualAction}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {board && <div className="flex h-9 items-center gap-1 border border-gray-200 bg-gray-50 p-1 dark:border-neutral-700 dark:bg-neutral-950">
              <span className="px-2 text-[10px] font-bold text-gray-500 dark:text-neutral-400">视频参考模式</span>
              <div role="group" aria-label="故事板参考模式" className="contents">
                <button type="button" onClick={() => void chooseReferenceMode("shot_grid")} aria-pressed={previewMode === "shot_grid"} title="纯净宫格：每个分镜一格，仅保留右上角数字编号" className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-bold ${previewMode === "shot_grid" ? "bg-white text-violet-700 shadow-sm dark:bg-neutral-800 dark:text-violet-300" : "text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200"}`}>
                  <Grid3X3 className="h-3.5 w-3.5" />宫格模式
                </button>
                <button type="button" onClick={() => void chooseReferenceMode("director_board")} aria-pressed={previewMode === "director_board"} title="导演故事板：保留镜头调度与导演注释" className={`inline-flex h-7 items-center gap-1.5 px-2.5 text-[10px] font-bold ${previewMode === "director_board" ? "bg-white text-violet-700 shadow-sm dark:bg-neutral-800 dark:text-violet-300" : "text-gray-500 hover:text-gray-800 dark:text-neutral-400 dark:hover:text-neutral-200"}`}>
                  <Clapperboard className="h-3.5 w-3.5" />故事板模式
                </button>
              </div>
            </div>}
            {selectedPage && <button type="button" onClick={async () => { await composeShotGrid(selectedPage.id); setPreviewModeOverride("shot_grid"); setExpertOpen(true); }} disabled={!canComposeGrid || Boolean(composingGridPageId) || Boolean(runningAction)} title={missingGridImages ? `本页还有 ${missingGridImages} 个分镜缺少已采用图片，请先回分镜页上传或生成` : "使用已采用分镜图直接排版，不调用模型，不重绘故事板"} className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-bold text-violet-700 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
              {composingGridPageId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Grid3X3 className="h-4 w-4" />}
              {composingGridPageId ? "正在合成…" : resolveStoryboardShotGridImage(selectedPage) ? "更新宫格图" : "合成宫格图"}
            </button>}
            {props.groupingProposal && <button type="button" onClick={props.groupingProposal.onAdopt} title="采用模型能力计算出的相邻镜头编组建议" className="inline-flex h-9 items-center gap-2 bg-violet-50 px-3 text-xs font-bold text-violet-700 hover:bg-violet-100 dark:bg-violet-950/30 dark:text-violet-300"><Sparkles className="h-4 w-4" />采用建议：{props.groupingProposal.shotCount} 镜头 · {props.groupingProposal.durationSeconds}s</button>}
            {props.onMergeWithNext && <button type="button" onClick={props.onMergeWithNext} title="与下一个相邻单元合并" className="inline-flex h-9 items-center gap-2 border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:border-violet-400 hover:text-violet-600 dark:border-neutral-700 dark:text-neutral-200"><Combine className="h-4 w-4" />合并下一个</button>}
            {props.onSplitUnit && <button type="button" onClick={props.onSplitUnit} title="按 Shot 拆为独立视频单元" className="inline-flex h-9 items-center gap-2 border border-gray-200 px-3 text-xs font-bold text-gray-700 hover:border-violet-400 hover:text-violet-600 dark:border-neutral-700 dark:text-neutral-200"><Scissors className="h-4 w-4" />拆分单元</button>}
            <span className={`inline-flex h-9 items-center px-3 text-xs font-bold ${primaryAction ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"}`}>{currentStepLabel}</span>
            {batchPlanningManaged ? (
              <span className="inline-flex h-9 items-center bg-violet-50 px-3 text-xs font-bold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">批量准备中</span>
            ) : primaryAction ? (
              <button type="button" onClick={runPrimaryAction} disabled={primaryDisabled} className="inline-flex h-9 items-center gap-2 bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
                {primaryAction === "strategy" ? <Sparkles className="h-4 w-4" /> : primaryAction === "board" || primaryAction === "visuals" || primaryAction === "review_visuals" ? <Clapperboard className="h-4 w-4" /> : primaryAction === "qa" ? <ShieldCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{primaryActionLabel}
              </button>
            ) : null}
            {props.onContinueToStudio && canEnterStudio ? (
              <button type="button" onClick={props.onContinueToStudio} className="inline-flex h-9 items-center gap-2 bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-500">进入摄影棚<ArrowRight className="h-4 w-4" /></button>
            ) : null}
            {props.batchManaged && <button type="button" onClick={() => setExpertOpen((value) => !value)} title={expertOpen ? "收起详情" : "查看详情"} aria-label={expertOpen ? "收起详情" : "查看详情"} className="inline-flex h-9 w-9 items-center justify-center border border-gray-200 text-gray-600 hover:border-violet-400 hover:text-violet-600 dark:border-neutral-700 dark:text-neutral-300"><SlidersHorizontal className="h-4 w-4" /></button>}
          </div>
        </header>
        {selectedPage && missingGridImages > 0 && <p className="px-5 py-3 text-xs leading-5 text-gray-500 dark:text-neutral-400">本页宫格还需 {missingGridImages} 张分镜图。先在“分镜”页上传或采用画面，再回这里一键排版。</p>}
        {showDetails && <div className="p-5">
          <div className="mb-4 flex flex-wrap gap-2 text-[10px] font-bold">
            <span className={`border px-2 py-1 ${statusClass(readModel.strategyStatus)}`}>策略 {statusLabel[readModel.strategyStatus]}</span>
            <span className={`border px-2 py-1 ${statusClass(readModel.boardStatus)}`}>分镜结构 {statusLabel[readModel.boardStatus]}</span>
            <span className={`border px-2 py-1 ${statusClass(readModel.qaStatus)}`}>质检 {statusLabel[readModel.qaStatus]}</span>
            <span className={`border px-2 py-1 ${statusClass(readModel.boardVisualStatus)}`}>参考图 {readModel.readyVisualPageCount}/{readModel.visualPageCount}</span>
            <span className={`border px-2 py-1 ${statusClass(readModel.assetReferencePackStatus)}`}>资产参考 {statusLabel[readModel.assetReferencePackStatus]}</span>
            <span className={`border px-2 py-1 ${statusClass(readModel.videoGenerationUnitStatus)}`}>视频 {statusLabel[readModel.videoGenerationUnitStatus]}</span>
          </div>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 pb-4 dark:border-neutral-800">
            <div>
              <label htmlFor={`target-video-model-${workflow?.id || props.shot.id}`} className="text-[10px] font-bold text-gray-500">目标视频模型</label>
              <p className="mt-1 text-[10px] text-gray-400">只影响后续生成资料的整理方式，不会修改剧本、资产板或故事板。</p>
            </div>
            <select
              id={`target-video-model-${workflow?.id || props.shot.id}`}
              value={workflow?.targetVideoModelConfigId || ""}
              onChange={(event) => void setTargetVideoModel(event.target.value || undefined)}
              className="h-9 min-w-[220px] border border-gray-200 bg-white px-3 text-xs text-gray-700 focus:border-violet-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
            >
              <option value="">跟随设置页默认{defaultVideoModelConfigId ? "" : "（尚未设置）"}</option>
              {availableVideoModels.map((model) => <option key={model.id} value={model.id}>{model.alias}</option>)}
            </select>
          </div>
          {workflow?.board && (
            <section className="mb-4 border-b border-gray-100 pb-4 dark:border-neutral-800" aria-label="视频单元提示词">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-gray-800 dark:text-neutral-200">视频单元提示词</p>
                    <span className={`px-2 py-0.5 text-[9px] font-bold ${statusClass(readModel.unitVideoPromptStatus)}`}>{statusLabel[readModel.unitVideoPromptStatus]}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">由本单元内分镜的动作、摄影机、对白、声音和连续性整理；摄影棚默认读取此版本。</p>
                  {!props.videoPromptReady && <p className="mt-1 text-[10px] font-semibold text-amber-600">请先回到“分镜”页签生成并确认视频提示词；这不会阻止故事板和宫格画面生成。</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void rebuildUnitVideoPrompt()} disabled={!props.videoPromptReady} className="inline-flex h-8 items-center gap-1.5 border border-gray-200 px-2.5 text-[10px] font-bold text-gray-600 hover:border-violet-400 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"><RefreshCw className="h-3.5 w-3.5" />根据视频提示词重建</button>
                  <button type="button" onClick={() => void saveUnitVideoPrompt(unitVideoPromptDraft)} disabled={!props.videoPromptReady || !unitVideoPromptDraft.trim() || unitVideoPromptDraft.trim() === readModel.effectiveUnitVideoPrompt.trim()} className="inline-flex h-8 items-center gap-1.5 bg-violet-600 px-2.5 text-[10px] font-bold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-3.5 w-3.5" />保存上游版本</button>
                </div>
              </div>
              <textarea
                value={unitVideoPromptDraft}
                onChange={(event) => setUnitVideoPromptDraft(event.target.value)}
                disabled={!props.videoPromptReady}
                rows={7}
                className="w-full resize-y border border-gray-200 bg-gray-50 p-3 text-xs leading-5 text-gray-700 outline-none focus:border-violet-500 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200"
                aria-label="视频单元提示词"
              />
            </section>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {batchPlanningManaged ? (
              <span className="inline-flex h-9 items-center gap-2 bg-violet-50 px-3 text-xs font-bold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                <Clapperboard className="h-4 w-4" />复合视频单元批处理待完成
              </span>
            ) : primaryAction ? (
              <button type="button" onClick={runPrimaryAction} disabled={primaryDisabled} className={`inline-flex h-9 items-center gap-2 px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40 ${primaryAction === "confirm" ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-violet-600 text-white hover:bg-violet-500"}`}>
                {primaryAction === "strategy" ? <Sparkles className="h-4 w-4" /> : primaryAction === "board" || primaryAction === "visuals" || primaryAction === "review_visuals" ? <Clapperboard className="h-4 w-4" /> : primaryAction === "qa" ? <ShieldCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{primaryActionLabel}
              </button>
            ) : (
              <span className="inline-flex h-9 items-center gap-2 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />故事板已确认
              </span>
            )}
            {workflow?.strategyDecision && primaryAction !== "strategy" && (!props.batchManaged || unitShotIds.length === 1) && <button type="button" onClick={() => prepareAction("strategy")} title="重新选择故事板策略" disabled={Boolean(runningAction) || !props.upstreamReady} className="inline-flex h-9 w-9 items-center justify-center border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"><RefreshCw className="h-4 w-4" /></button>}
          </div>

          {workflow?.strategyDecision && (
            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 text-xs md:grid-cols-[220px_1fr] dark:border-neutral-800">
              <div>
                <p className="text-gray-400">已采用策略</p>
                <p className="mt-1 font-bold text-gray-900 dark:text-white">{selectedStrategy?.name || workflow.strategyDecision.selectedStrategyId}</p>
                <p className="mt-1 text-gray-500">{workflow.strategyDecision.expectedBoardShape}</p>
                {modifierStrategyNames.length ? <p className="mt-2 text-[10px] leading-4 text-violet-600">组合控制：{modifierStrategyNames.join(" + ")}</p> : null}
              </div>
              <div>
                <p className="leading-5 text-gray-600 dark:text-neutral-300">{workflow.strategyDecision.rationale}</p>
                {workflow.strategyDecision.strategyResolution?.uncoveredCapabilityIds.length ? <p className="mt-2 bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">尚未覆盖：{workflow.strategyDecision.strategyResolution.uncoveredCapabilityIds.join("、")}。当前整板生成已暂停，需小样策略或创作者选择回退。</p> : null}
              </div>
            </div>
          )}

          {board && (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-bold text-gray-700 dark:text-neutral-200">{unitShotIds.length} 个分镜 · {unitDurationSeconds}s · {visualPages.length} 张故事板页</p>
              </div>
              <div className="space-y-4">
                {visualPages.map((page) => {
                  const activeTake = getActiveStoryboardBoardVisualTake(page);
                  const pendingTake = getLatestStoryboardBoardVisualCandidate(page);
                  const displayTake = activeTake || pendingTake;
                  const displayImageUrl = previewMode === "shot_grid" ? resolveStoryboardShotGridImage(page) || displayTake?.videoReferenceImageUrl : displayTake?.imageUrl;
                  const gridStatus = storyboardShotGridStatus({ board, page, shots: unitShots });
                  const selected = selectedPage?.id === page.id;
                  return (
                    <button key={page.id} type="button" onClick={() => setSelectedPanelId(page.panelIds[0] || null)} className={`relative block w-full overflow-hidden rounded-md border p-3 text-left ${selected ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20" : "border-gray-200 dark:border-neutral-800"}`}>
                      {displayImageUrl ? (
                        <img src={displayImageUrl} alt={`${previewMode === "shot_grid" ? "分镜宫格图" : "故事板"}第 ${page.pageIndex + 1} 页`} className="aspect-video w-full bg-white object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center bg-gray-100 px-6 text-center text-xs font-semibold text-gray-400 dark:bg-neutral-800">{previewMode === "shot_grid" ? "为本页分镜准备图片后，点击“合成宫格图”即可直接排版" : `等待生成完整 ${page.layout} 故事板页`}</div>
                      )}
                      {previewMode === "shot_grid" && (page.activeShotGridTakeId || resolveStoryboardShotGridImage(page)) ? <span className={`absolute right-6 top-6 rounded px-2 py-1 text-[9px] font-bold text-white ${gridStatus !== "ready" ? "bg-amber-600" : "bg-emerald-700"}`}>{gridStatus === "stale" ? "来源待更新，请重新合成" : gridStatus === "missing" ? "宫格图缺失，请重新合成" : "已采用分镜图合成"}</span> : !activeTake && pendingTake?.review?.status === "pending" && <span className="absolute right-6 top-6 bg-amber-500 px-2 py-1 text-[9px] font-bold text-white">整板待人工验收</span>}
                      <div className="mt-2 flex items-center justify-between text-[10px] font-bold"><span>PAGE {page.pageIndex + 1}/{page.pageCount} · {page.layout}</span><span>{page.panelIds.length} 格 · {previewMode === "shot_grid" ? "仅分镜序号" : "导演注释"}</span></div>
                      {previewMode === "shot_grid" && Boolean(page.shotGridTakes?.length) && <p className="mt-2 text-[10px] leading-4 text-gray-500 dark:text-neutral-400">按已采用画面排版，保留原构图 · {page.shotGridTakes!.length} 个宫格版本 · 故事板质检记录独立保留</p>}
                    </button>
                  );
                })}
              </div>
              {previewMode === "shot_grid" && selectedPage && Boolean(selectedPage.shotGridTakes?.length) && <details className="mt-3 text-xs text-gray-500 dark:text-neutral-400"><summary className="cursor-pointer">历史宫格 · {selectedPage.shotGridTakes!.length} 个版本</summary><div className="mt-2 flex flex-wrap gap-3">{selectedPage.shotGridTakes!.map((take, index) => <a key={take.id} href={take.imageUrl} target="_blank" rel="noreferrer" className="rounded border border-gray-200 px-3 py-2 text-violet-700 hover:border-violet-400 dark:border-neutral-700 dark:text-violet-300">查看 V{index + 1}{take.id === selectedPage.activeShotGridTakeId ? " · 当前" : ""}</a>)}</div></details>}
              <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                {representativePanels.map((panel, index) => (
                  <button key={panel.id} type="button" onClick={() => setSelectedPanelId(panel.id)} className={`min-h-[126px] rounded-md border p-3 text-left transition-colors ${selectedPanelId === panel.id ? "border-violet-500 bg-violet-50 dark:bg-violet-950/20" : "border-gray-200 hover:border-gray-300 dark:border-neutral-800"}`}>
                    <div className="flex justify-between text-[10px] font-bold"><span>SHOT {index + 1}</span><span>{unitShots.find((shot) => shot.id === panel.shotId)?.duration || panel.durationSeconds || 0}s</span></div>
                    <p className="mt-2 text-xs font-bold text-gray-900 dark:text-white">{panel.framePurpose}</p>
                    <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-gray-500">{panel.visualBeat || panel.subjectAction}</p>
                    <p className="mt-2 line-clamp-2 text-[10px] text-blue-600">{panel.cameraNote || panel.cameraMove}</p>
                  </button>
                ))}
              </div>
              <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-600 dark:bg-neutral-950 dark:text-neutral-300">{board.lineArtPrompt}</p>
              {selectedPanel && (
                <div className="mt-3 border-t border-gray-100 pt-3 text-xs dark:border-neutral-800">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-bold text-gray-900 dark:text-white">PANEL {selectedPanel.panelNumber} · {selectedPanel.framePurpose}</p>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-3 text-[10px] text-gray-500">
                        <span>{selectedVisualTake?.quality ? `整板 ${selectedVisualTake.quality.score} 分` : selectedPendingVisualTake ? "整板人工待审" : "整板待生成"}</span>
                        <span>{selectedPage?.visualTakes?.length || 0} 个整板候选</span>
                        {selectedVisualTake && <span>{selectedVisualTake.modelId}</span>}
                      </div>
                      {selectedPage && selectedPendingVisualTake?.review?.status === "pending" && (
                        <button type="button" onClick={() => void approveBoardVisual(selectedPage.id, selectedPendingVisualTake.id)} disabled={Boolean(runningAction) || !props.visualReady} className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 px-2.5 text-[10px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
                          <CheckCircle2 className="h-3.5 w-3.5" />整板采用
                        </button>
                      )}
                      {props.onGenerateVisuals && (
                        <button type="button" onClick={props.onGenerateVisuals} disabled={Boolean(runningAction) || !props.visualReady} className="inline-flex h-8 items-center gap-1.5 border border-gray-200 px-2.5 text-[10px] font-bold text-gray-700 hover:border-violet-400 hover:text-violet-600 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200">
                          <RefreshCw className="h-3.5 w-3.5" />重新生成双版本
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedVisualTake && (
                    <>
                      <p className="mt-2 leading-5 text-gray-600 dark:text-neutral-300">{selectedVisualTake.quality?.summary
                        || selectedPendingVisualTake?.review?.notes
                        || (selectedPendingVisualTake ? "请按整板格数、顺序、人物身份、资产状态、动作和连续性看图采用。" : "整板视觉质检记录缺失")}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] font-bold text-violet-600">查看完整故事板页 Prompt 与审计</summary>
                        <p className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 leading-5 text-gray-600 dark:bg-neutral-950 dark:text-neutral-300">{selectedVisualTake.prompt}</p>
                        <p className="mt-2 text-[10px] text-gray-500">参考图 {selectedVisualTake.referenceImageUrls.length} 张 · Skill {selectedVisualTake.selectedSkillIds.length} 个 · 上下文 {selectedVisualTake.selectedContextIds.length} 项 · 执行记录 {selectedVisualTake.executions.length} 条</p>
                      </details>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {qa && (
            <div className={`mt-4 flex items-start gap-4 rounded-md px-4 py-3 ${qa.verdict === "pass" ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-amber-50 dark:bg-amber-950/20"}`}>
              <strong className="text-2xl">{qa.score}</strong><div><p className="text-xs font-bold uppercase">{qa.verdict}</p><p className="mt-1 text-xs leading-5 text-gray-600 dark:text-neutral-300">{qa.summary}</p></div>
            </div>
          )}
          {readModel.staleReasons.map((reason) => <p key={reason} className="mt-3 flex items-center gap-2 text-xs text-amber-700"><RefreshCw className="h-3.5 w-3.5" />{reason}</p>)}
          {readModel.staleScopes.length > 0 && <p className="mt-2 text-[10px] font-bold text-amber-600">更新提示：{readModel.staleScopes.join(" / ")}</p>}
        </div>}
      </section>

      <PromptEditorModal
              presentation="workspace"
        isOpen={Boolean(promptRequest)}
        onClose={() => setPromptRequest(null)}
        templateId={promptRequest?.templateId || "storyboard.strategy.select"}
        title={promptRequest?.title}
        variables={promptRequest?.variables || {}}
        activeSceneId={props.scene.id}
        activeEpisodeId={props.episode.id}
        onConfirm={executePrompt}
      />
      <ManualVideoStoryboardReviewModal candidate={candidate} onClose={() => setCandidate(null)} onAdopt={adoptCandidate} />
    </>
  );
}
