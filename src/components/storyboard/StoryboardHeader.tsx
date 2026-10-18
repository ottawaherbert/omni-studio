import { ProductionCreativeControls } from "../production/ProductionCreativeControls";
import { useProjectStore } from "../../clients/stateClient";
import React from "react";
import { AlertTriangle, ArrowLeft, Clapperboard, Film, Image as ImageIcon, Loader2, Settings2, Video, Wand2 } from "lucide-react";

import type { Scene, VisualStyleLock } from "../../clients/domainTypes";
import type { VideoGenerationMode } from "../../clients/productionStudioWorkflowClient";
import { VisualStyleInheritanceBadge } from "../production/VisualStyleInheritanceBadge";

interface StoryboardHeaderProps {
  activeScene: Scene;
  isGenerating: boolean;
  onPrepareGenerateShots: () => void;
  currentShotPlanComplete?: boolean;
  onPrepareGenerateImagePrompts: () => void;
  onPrepareGenerateVideoPrompts: () => void;
  currentImagePromptComplete?: boolean;
  currentVideoPromptComplete?: boolean;
  currentBoardComplete?: boolean;
  currentBoardApproved?: boolean;
  boardBlockReason?: string;
  estimatedSceneDuration: string;
  videoGenerationMode: VideoGenerationMode;
  onVideoGenerationModeChange: (mode: VideoGenerationMode) => void;
  showVideoModeControl?: boolean;
  onReturnToPreparation?: () => void;
  onReturnToInteractive?: () => void;
  aspectRatio?: string;
  visualStyleLock?: VisualStyleLock;
  fallbackVisualStyle?: string;
  onOpenGenerationParams?: () => void;
  productionGate?: {
    shotPlanningReady: boolean;
    imagePromptReady?: boolean;
    videoPromptReady?: boolean;
    shotPlanningReason: string;
    imagePromptReason?: string;
    videoPromptReason?: string;
  };
}

export const StoryboardHeader: React.FC<StoryboardHeaderProps> = ({
  activeScene,
  isGenerating,
  onPrepareGenerateShots,
  currentShotPlanComplete = Boolean(activeScene.shots?.length),
  onPrepareGenerateImagePrompts,
  onPrepareGenerateVideoPrompts,
  currentImagePromptComplete = false,
  currentVideoPromptComplete = false,
  currentBoardComplete = false,
  currentBoardApproved = false,
  boardBlockReason,
  estimatedSceneDuration,
  videoGenerationMode,
  onVideoGenerationModeChange,
  showVideoModeControl = true,
  onReturnToPreparation,
  onReturnToInteractive,
  aspectRatio = "16:9",
  visualStyleLock,
  fallbackVisualStyle,
  onOpenGenerationParams,
  productionGate,
}) => {
  const { currentProject, activeEpisode } = useProjectStore();
  const totalDuration = activeScene.shots?.reduce((acc, shot) => acc + (shot.duration || 0), 0) || 0;
  const hasStructuredShots = Boolean(activeScene.shots?.length);
  const shotStageComplete = currentShotPlanComplete;
  const promptStagesComplete = shotStageComplete && currentImagePromptComplete && currentVideoPromptComplete;
  const boardStageComplete = videoGenerationMode === "storyboard"
    && currentBoardApproved;
  const isShotModeComplete = videoGenerationMode === "shot" && promptStagesComplete;
  const isModeComplete = isShotModeComplete || boardStageComplete;
  const generationLockReason = isGenerating ? "当前生成任务完成后可操作" : undefined;
  const activeGateBlock = videoGenerationMode === "shot"
    && !shotStageComplete
    && productionGate
    && !productionGate.shotPlanningReady
    ? { label: "分镜规划尚未就绪", reason: productionGate.shotPlanningReason }
    : videoGenerationMode === "storyboard" && !hasStructuredShots
      ? { label: "本场尚无分镜", reason: boardBlockReason || "请先在分镜 Tab 完成本场镜头划分。" }
      : null;

  return (
    <header className="mb-6 border-b border-border-soft/20 pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-lg font-bold text-text-primary">
            <span className="shrink-0 whitespace-nowrap">{videoGenerationMode === "shot" ? "分镜" : "故事板"}</span>
            {activeScene.shots && activeScene.shots.length > 0 && (
              <span className="max-w-full rounded border border-border-soft/20 bg-bg-surface-soft px-2 py-0.5 text-[10px] font-bold leading-4 text-text-muted">
                {activeScene.shots.length} 个分镜 · {totalDuration}s / 预估 {estimatedSceneDuration}s · 平均 {(totalDuration / activeScene.shots.length).toFixed(1)}s
              </span>
            )}
          </h1>
          <p className="mt-1 text-xs text-text-muted">当前场：{activeScene.title}</p>
          <div className="mt-2">
            {currentProject ? <ProductionCreativeControls project={currentProject} episode={activeEpisode} scene={activeScene} compact /> : <VisualStyleInheritanceBadge visualStyleLock={visualStyleLock} fallbackVisualStyle={fallbackVisualStyle} compact />}
          </div>
          {onReturnToInteractive && (
            <button
              type="button"
              onClick={onReturnToInteractive}
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-gold hover:opacity-80"
            >
              <ArrowLeft className="h-3.5 w-3.5" />返回互动制片
            </button>
          )}
        </div>

        <div className="shrink-0 flex items-end gap-3">
          {activeGateBlock && (
            <div 
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-bold text-amber-500 shrink-0 transition"
              title={activeGateBlock.reason}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span className="truncate">{activeGateBlock.label}</span>
              {onReturnToPreparation && (
                <button
                  type="button"
                  onClick={onReturnToPreparation}
                  className="ml-1 rounded px-2 py-0.5 text-[11px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 transition cursor-pointer"
                >
                  场次与资产
                </button>
              )}
            </div>
          )}
          {onOpenGenerationParams && (
            <button
              type="button"
              onClick={onOpenGenerationParams}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border-soft/35 bg-bg-surface px-3 text-xs font-bold text-text-secondary transition-colors hover:border-cyan-500/40 hover:text-cyan-500"
              title="修改整个项目的分镜、故事板和视频生成画幅"
              aria-label="设置项目成片画幅"
            >
              <Settings2 className="h-3.5 w-3.5" />
              项目画幅 {aspectRatio}
            </button>
          )}
          {videoGenerationMode === "shot" && hasStructuredShots && (
            <div className="flex flex-wrap items-center justify-end gap-2" aria-label="分镜生成操作">
              <button
                type="button"
                onClick={onPrepareGenerateShots}
                disabled={isGenerating || Boolean(productionGate && !productionGate.shotPlanningReady)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border-soft/35 bg-bg-surface px-3 text-xs font-bold text-text-secondary transition-colors hover:bg-bg-surface-soft hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                title={generationLockReason || "重新生成本场分镜结构"}
              >
                {isGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                重新生成分镜
              </button>
              <button
                type="button"
                onClick={onPrepareGenerateImagePrompts}
                disabled={isGenerating || !shotStageComplete || Boolean(productionGate && !productionGate.imagePromptReady)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border-soft/35 bg-bg-surface px-3 text-xs font-bold text-text-secondary transition-colors hover:border-cyan-500/40 hover:text-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
                title={generationLockReason || productionGate?.imagePromptReason || "为每个已确认分镜生成图片提示词"}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                {currentImagePromptComplete ? "重新生成图片提示词" : "生成图片提示词"}
              </button>
              <button
                type="button"
                onClick={onPrepareGenerateVideoPrompts}
                disabled={isGenerating || !shotStageComplete || Boolean(productionGate && !productionGate.videoPromptReady)}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border-soft/35 bg-bg-surface px-3 text-xs font-bold text-text-secondary transition-colors hover:border-cyan-500/40 hover:text-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
                title={generationLockReason || productionGate?.videoPromptReason || "为每个已确认分镜生成视频提示词"}
              >
                <Video className="h-3.5 w-3.5" />
                {currentVideoPromptComplete ? "重新生成视频提示词" : "生成视频提示词"}
              </button>
              {isGenerating && (
                <span role="status" className="inline-flex h-9 shrink-0 items-center gap-2 px-2 text-[10px] font-semibold text-amber-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />当前生成任务完成后可继续
                </span>
              )}
            </div>
          )}
          {isModeComplete && (
            <span className="inline-flex h-9 items-center rounded-md bg-emerald-500/10 px-3 text-xs font-bold text-emerald-600 dark:text-emerald-400">
              当前场准备已完成
            </span>
          )}
        </div>
      </div>

      {showVideoModeControl && (
        <div className="mt-5 flex border-b border-border-soft/25" role="tablist" aria-label="分镜与故事板">
              <button
                type="button"
                role="tab"
                aria-selected={videoGenerationMode === "shot"}
                onClick={() => onVideoGenerationModeChange("shot")}
                className={`relative inline-flex h-11 items-center gap-2 px-5 text-sm font-bold transition-colors ${videoGenerationMode === "shot" ? "text-cyan-500 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-cyan-500" : "text-text-muted hover:text-text-primary"}`}
              >
                <Film className="h-4 w-4" />分镜
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={videoGenerationMode === "storyboard"}
                onClick={() => onVideoGenerationModeChange("storyboard")}
                className={`relative inline-flex h-11 items-center gap-2 px-5 text-sm font-bold transition-colors ${videoGenerationMode === "storyboard" ? "text-cyan-500 after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-cyan-500" : "text-text-muted hover:text-text-primary"}`}
              >
                <Clapperboard className="h-4 w-4" />故事板
              </button>
        </div>
      )}

      {videoGenerationMode === "storyboard" && currentBoardComplete && !currentBoardApproved && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-lg bg-amber-500/10 px-3 text-xs font-bold text-amber-600 dark:text-amber-400">
            故事板草案已生成，待正式验收
          </span>
        </div>
      )}

      {videoGenerationMode === "storyboard" && hasStructuredShots && !boardStageComplete && boardBlockReason && (
        <p className="mt-2 max-w-3xl text-[11px] font-semibold leading-5 text-amber-600 dark:text-amber-400">
          {boardBlockReason}
        </p>
      )}
    </header>
  );
};
