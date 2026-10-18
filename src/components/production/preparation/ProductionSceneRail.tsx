import type { Episode, EpisodeMeta, Scene } from "../../../clients/domainTypes";
import { AlertTriangle, ArrowRight, Check, ChevronRight, FileWarning } from "lucide-react";

import {
  breakdownStatus,
  preparationStepSummaries,
  type PreparationStepSummary,
} from "../../../features/production/preparation/productionPreparationViewModel";

function formatSceneDurationInSeconds(durationInMinutes?: number): string {
  if (!durationInMinutes || durationInMinutes <= 0) return '';
  const seconds = durationInMinutes > 120 ? durationInMinutes : durationInMinutes * 60;
  return `${Math.round(seconds)}秒`;
}

export function ProductionSceneRail({
  episode,
  scenes,
  activeSceneId,
  onSelect,
  onNextTodo,
  flat = false,
  showStoryboardMetrics = false,
  sourceUnits,
  activeEpisodeId,
  unitLabel = "分集",
  onSelectUnit,
  activeStepSummaries,
}: {
  episode?: Episode;
  scenes: Scene[];
  activeSceneId: string | null;
  onSelect: (sceneId: string) => void;
  onNextTodo?: () => void;
  flat?: boolean;
  showStoryboardMetrics?: boolean;
  sourceUnits?: EpisodeMeta[];
  activeEpisodeId?: string | null;
  unitLabel?: string;
  onSelectUnit?: (episodeId: string) => void;
  activeStepSummaries?: PreparationStepSummary[];
}) {
  const activeUnitIndex = sourceUnits?.findIndex((unit) => unit.id === activeEpisodeId) ?? -1;
  const sceneBreakdownStatus = (scene: Scene) =>
    (scene as Scene & { __workspaceBreakdownStatus?: string }).__workspaceBreakdownStatus
      || breakdownStatus(scene);
  const sceneShotCount = (scene: Scene) =>
    Number((scene as Scene & { shotCount?: number }).shotCount ?? scene.shots?.length ?? 0);
  return (
    <aside className={flat ? "flex h-full w-full flex-col bg-transparent" : "flex h-full w-full flex-col border border-border-soft/20 bg-bg-surface rounded-2xl shadow-sm overflow-hidden"}>
      {sourceUnits && sourceUnits.length > 1 && onSelectUnit && (
        <div className="border-b border-border-soft/10 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold text-text-muted">
            <span>当前{unitLabel}</span>
            <span>{Math.max(1, activeUnitIndex + 1)}/{sourceUnits.length}</span>
          </div>
          <select
            aria-label={`切换制片${unitLabel}`}
            value={activeEpisodeId || ""}
            onChange={(event) => onSelectUnit(event.target.value)}
            className="h-10 w-full rounded-xl border border-border-soft/20 bg-bg-surface-soft px-3 text-xs font-bold text-text-primary outline-none transition focus:border-gold/50 focus:ring-2 focus:ring-gold/10"
          >
            {sourceUnits.map((unit, index) => (
              <option key={unit.id} value={unit.id}>
                {String(index + 1).padStart(2, "0")} · {unit.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="px-5 py-4 flex items-center justify-between border-b border-border-soft/10 select-none">
        <div>
          <h2 className="text-sm font-bold text-text-primary">场次</h2>
          <p className="mt-1 text-[10px] text-text-muted font-medium">共 {scenes.length} 个可制片场次</p>
        </div>
        <span className="rounded-lg bg-bg-surface-soft border border-border-soft/10 px-2 py-0.5 text-[10px] font-bold text-text-secondary">
          已拆解 {scenes.filter((scene) => sceneBreakdownStatus(scene) === "已确认").length}/{scenes.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 custom-scrollbar">
        {scenes.map((scene, index) => {
          const isActive = scene.id === activeSceneId;
          const confirmedCount = episode?.productionTeam?.outputs.filter((item) => item.status === "confirmed").length
            || scene.productionTeam?.outputs.filter((item) => item.status === "confirmed").length
            || 0;
          const issueCount = episode?.productionTeam?.outputs.reduce((count, item) => count + (item.qa?.issues.length || 0), 0)
            || scene.productionTeam?.outputs.reduce((count, item) => count + (item.qa?.issues.length || 0), 0)
            || 0;
          const steps = showStoryboardMetrics
            ? []
            : isActive && activeStepSummaries ? activeStepSummaries : preparationStepSummaries(scene, episode);
          return (
            <button
              key={scene.id}
              type="button"
              onClick={() => onSelect(scene.id)}
              className={`w-full rounded-xl px-4 py-3 text-left transition-all cursor-pointer ${isActive ? "bg-bg-surface-soft text-gold font-bold" : "hover:bg-bg-surface-hover text-text-secondary"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`min-w-0 truncate text-xs font-black ${isActive ? "text-gold" : "text-text-primary"}`}>{String(index + 1).padStart(2, "0")} · {scene.title}</span>
                {showStoryboardMetrics && scene.targetDuration ? (
                  <span className="text-[9px] font-bold text-text-muted bg-bg-surface-soft px-1.5 py-0.5 rounded border border-border-soft/10 shrink-0">
                    {formatSceneDurationInSeconds(scene.targetDuration)}
                  </span>
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50 text-text-dark" />
                )}
              </div>
              {showStoryboardMetrics ? (
                <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-text-muted">
                  <span className="rounded bg-bg-surface-soft px-1.5 py-0.5">{sceneShotCount(scene)} 镜头</span>
                  {issueCount > 0 && <span className="ml-auto flex items-center gap-1 text-accent-amber"><AlertTriangle className="h-3 w-3" />{issueCount} 个问题</span>}
                </div>
              ) : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold text-text-muted">
                    {scene.breakdown ? <Check className="h-3 w-3 text-gold" /> : <FileWarning className="h-3 w-3 text-accent-amber" />}
                    <span>{sceneBreakdownStatus(scene)}</span>
                    {confirmedCount > 0 && <span className="rounded bg-bg-surface-soft px-1.5 py-0.5 text-text-muted">单元 {confirmedCount} 部门</span>}
                    {issueCount > 0 && <span className="ml-auto flex items-center gap-1 text-accent-amber"><AlertTriangle className="h-3 w-3" />{issueCount}</span>}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5" aria-label="场次信息进度">
                    {steps.map((step) => (
                      <span
                        key={step.id}
                        title={`${step.id === "breakdown" ? "场次信息" : "本场资产"}：${step.state === "complete" ? "已确认" : step.state === "attention" ? "待处理" : "未开始"}`}
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold transition-all ${
                          step.state === "complete"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : step.state === "attention"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-bg-surface-soft/60 text-text-muted"
                        }`}
                      >
                        {step.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </button>
          );
        })}
        {scenes.length === 0 && <p className="px-3 py-8 text-center text-xs text-text-muted">当前集/段没有可制片场次</p>}
      </div>
      {onNextTodo && (
        <div className="border-t border-border-soft/20 p-3">
          <button
            type="button"
            onClick={onNextTodo}
            className="flex h-10 w-full items-center justify-between bg-bg-surface-soft rounded-xl px-4 text-xs font-bold text-text-primary hover:bg-bg-surface-hover transition-all active:scale-95 cursor-pointer"
          >
            <span>下一个待办场次</span>
            <ArrowRight className="h-3.5 w-3.5 text-gold" />
          </button>
        </div>
      )}
    </aside>
  );
}
