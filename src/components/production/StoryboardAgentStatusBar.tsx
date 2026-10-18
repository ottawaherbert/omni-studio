import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type { StoryboardAgentProgress } from "../../hooks/useStoryboardAI";

interface StoryboardAgentStatusBarProps {
  progress: StoryboardAgentProgress & {
    shotId?: string;
    panelId?: string;
    panelNumber?: number;
    completedPanels?: number;
    totalPanels?: number;
  };
  hasResult: boolean;
  onViewResult: () => void;
}

const runningPhases = new Set(["generating", "checking", "repairing"]);

export function StoryboardAgentStatusBar({ progress, hasResult, onViewResult }: StoryboardAgentStatusBarProps) {
  if (progress.phase === "idle") return null;

  const running = runningPhases.has(progress.phase);
  const Icon = progress.phase === "completed"
    ? CheckCircle2
    : progress.phase === "needs_decision"
      ? AlertTriangle
      : progress.phase === "failed"
        ? XCircle
        : progress.phase === "repairing"
          ? RefreshCw
          : Loader2;
  const tone = progress.phase === "completed"
    ? "text-emerald-700 dark:text-emerald-300"
    : progress.phase === "needs_decision" || progress.phase === "failed"
      ? "text-amber-700 dark:text-amber-300"
      : "text-violet-700 dark:text-violet-300";
  const automaticRepairCount = Math.max(0, progress.attempt - 1);
  const automaticRepairLimit = Math.max(0, progress.maxAttempts - 1);
  const boundedRepairCount = Math.min(automaticRepairCount, automaticRepairLimit);
  const attemptProgress = automaticRepairCount > 0 && automaticRepairLimit > 0
    ? progress.phase === "checking"
      ? ` · 自动修正 ${boundedRepairCount}/${automaticRepairLimit} 后质检`
      : progress.phase === "completed"
        ? ` · 自动修正 ${boundedRepairCount}/${automaticRepairLimit} 后完成`
        : progress.phase === "needs_decision"
          ? ` · 已自动修正 ${boundedRepairCount}/${automaticRepairLimit}`
          : ` · 自动修正 ${boundedRepairCount}/${automaticRepairLimit}`
    : progress.attempt === 1 && progress.phase === "generating"
      ? " · 首次生成"
      : progress.attempt === 1 && progress.phase === "checking"
        ? " · 首次生成后质检"
        : "";

  return (
    <section className="mb-5 border-y border-border-soft/30 bg-bg-surface-soft/50 px-4 py-3">
      <div className="flex items-center justify-between gap-5">
        <div className="flex min-w-0 items-center gap-3">
          <Icon className={`h-4 w-4 shrink-0 ${tone} ${running ? "animate-spin" : ""}`} />
          <div className="min-w-0">
            <p className={`truncate text-xs font-bold ${tone}`}>{progress.label}</p>
            <p className="mt-1 text-[10px] text-text-muted">
              {progress.sceneTitle ? `当前场：${progress.sceneTitle}` : "正在准备场次"}
              {progress.totalScenes > 1 ? ` · 已完成 ${progress.completedScenes}/${progress.totalScenes} 场` : ""}
              {typeof progress.totalPanels === "number" && progress.totalPanels > 0 ? ` · 画格 ${progress.completedPanels || 0}/${progress.totalPanels}` : ""}
              {progress.panelNumber ? ` · Panel ${progress.panelNumber}` : ""}
              {attemptProgress}
              {typeof progress.score === "number" ? ` · ${progress.score} 分` : ""}
            </p>
          </div>
        </div>
        {hasResult && !running && (
          <button
            type="button"
            onClick={onViewResult}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-soft/40 bg-bg-surface px-3 text-xs font-semibold text-text-primary hover:bg-bg-surface-hover"
          >
            <Eye className="h-3.5 w-3.5" />
            查看结果与审计
          </button>
        )}
      </div>
      {progress.issues?.length ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
          {progress.issues.join("；")}
        </p>
      ) : null}
    </section>
  );
}
