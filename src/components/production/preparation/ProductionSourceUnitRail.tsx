import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronRight, FileText, FileWarning, Plus } from "lucide-react";

import type { Episode, EpisodeMeta, Project } from "../../../clients/domainTypes";
import { productionSourceDocumentForEpisode } from "../../../clients/productionPreparationWorkflowClient";

type SourcePlanState = "complete" | "attention" | "pending";

const stepClassName = (state: SourcePlanState) => state === "complete"
  ? "bg-bg-surface-soft text-gold"
  : state === "attention"
    ? "bg-bg-surface-soft text-accent-amber"
    : "bg-bg-surface-soft text-text-dark";

export function ProductionSourceUnitRail({
  project,
  units,
  activeEpisodeId,
  onSelect,
  onAddUnit,
  activeEpisode,
}: {
  project: Project;
  units: EpisodeMeta[];
  activeEpisodeId: string | null;
  onSelect: (episodeId: string) => void;
  onAddUnit?: () => void;
  activeEpisode?: Episode;
}) {
  const [filter, setFilter] = useState<"all" | "needs_review" | "unplanned" | "ready">("all");
  const unitLabel = project.type === "movie" ? "分段" : "分集";
  const plannedCount = useMemo(() => {
    return units.filter((unit) => {
      const doc = productionSourceDocumentForEpisode(project, unit);
      return doc && project.productionScenePlans?.some((p) => p.sourceDocumentId === doc.id && p.status === "adopted");
    }).length;
  }, [project, units]);

  const visibleUnits = useMemo(() => units.filter((unit) => {
    if (filter === "all") return true;
    const sourceDocument = productionSourceDocumentForEpisode(project, unit);
    const plan = project.productionScenePlans
      ?.filter((item) => item.sourceDocumentId === sourceDocument?.id && item.status === "adopted")
      .sort((left, right) => right.adoptedAt - left.adoptedAt)[0];
    const needsReview = plan?.sourceStatus === "needs_review" || plan?.sourceStatus === "stale";
    return filter === "needs_review" ? needsReview : filter === "unplanned" ? !plan : Boolean(plan && !needsReview);
  }), [filter, project, units]);

  return (
    <aside className="flex h-full w-full flex-col border border-border-soft/20 bg-bg-surface rounded-2xl shadow-sm overflow-hidden">
      <div className="px-4 py-3.5 flex items-center justify-between gap-2 border-b border-border-soft/10 select-none">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-text-primary truncate">
            {unitLabel}
          </h2>
          <p className="mt-0.5 text-[11px] text-text-muted font-medium whitespace-nowrap">
            {`已规划 ${plannedCount}/${units.length}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {(
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
              className="h-7 rounded-lg border border-border-soft/20 bg-bg-surface-soft px-1.5 text-[11px] font-bold text-text-secondary outline-none cursor-pointer hover:border-border-soft/40 transition-colors"
            >
              <option value="all">全部</option>
              <option value="needs_review">待复核</option>
              <option value="unplanned">待规划</option>
              <option value="ready">已就绪</option>
            </select>
          )}
          {onAddUnit && (
            <button
              type="button"
              onClick={onAddUnit}
              title={`新增${project.type === "movie" ? "段落" : "一集"}`}
              aria-label={`新增${project.type === "movie" ? "段落" : "一集"}`}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-bg-surface-soft text-text-primary hover:bg-gold/15 hover:text-gold hover:border-gold/30 transition-all cursor-pointer shrink-0 border border-border-soft/20"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 custom-scrollbar">
        {visibleUnits.map((unit) => {
          const sourceDocument = productionSourceDocumentForEpisode(project, unit);
          const storyScopes = Array.from(new Set(
            (project.interactiveProductionPrepProfile?.nodes || [])
              .filter((node) => node.sourceDocumentId === sourceDocument?.id)
              .map((node) => [node.storyEpisodeTitle, node.storyChapterTitle].filter(Boolean).join(" · "))
              .filter(Boolean),
          ));
          const plan = project.productionScenePlans
            ?.filter((item) => item.sourceDocumentId === sourceDocument?.id && item.status === "adopted")
            .sort((left, right) => right.adoptedAt - left.adoptedAt)[0];
          const isActive = unit.id === activeEpisodeId;
          const sourceState: SourcePlanState = sourceDocument ? "complete" : "attention";
          const planNeedsReview = plan?.sourceStatus === "needs_review" || plan?.sourceStatus === "stale";
          const planState: SourcePlanState = plan ? (planNeedsReview ? "attention" : "complete") : "attention";
          const qaState: SourcePlanState = plan?.qa?.verdict === "pass"
            ? "complete"
            : plan?.qa?.verdict === "revise"
              ? "attention"
              : "pending";
          const statusLabel = !sourceDocument
            ? "缺少剧本来源"
            : planNeedsReview
              ? "剧本已修改，原场次仍可用"
            : plan?.qa?.verdict === "revise"
              ? "场次方案需优化"
              : plan
                ? `已采用 ${plan.adoptedSceneSnapshot.length} 场`
                : "待规划场次方案";
          return (
            <button
              key={unit.id}
              type="button"
              onClick={() => onSelect(unit.id)}
              className={`w-full rounded-xl px-4 py-3 text-left transition-all cursor-pointer ${isActive ? "bg-bg-surface-soft text-gold font-bold" : "hover:bg-bg-surface-hover text-text-secondary"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`min-w-0 truncate text-xs font-black ${isActive ? "text-gold" : "text-text-primary"}`}>{String(units.findIndex((item) => item.id === unit.id) + 1).padStart(2, "0")} · {unit.title}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50 text-text-dark" />
              </div>
              {storyScopes.length > 0 && (
                <div className="mt-1 truncate text-[10px] font-semibold text-cyan-500" title={storyScopes.join("、")}>
                  故事范围：{storyScopes.join("、")}
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-text-muted">
                {plan ? <Check className="h-3 w-3 text-gold" /> : <FileWarning className="h-3 w-3 text-accent-amber" />}
                <span>{statusLabel}</span>
                {plan?.qa?.verdict === "revise" && <AlertTriangle className="ml-auto h-3 w-3 text-accent-amber" />}
              </div>
              <div className="mt-2.5 flex items-center gap-1.5" aria-label={`${unitLabel}场次进度`}>
                {([
                  { label: "文", title: "剧本来源", state: sourceState },
                  { label: "场", title: "场次方案", state: planState },
                  { label: "检", title: "场次方案质检", state: qaState },
                ]).map((step) => (
                  <span key={step.label} title={`${step.title}：${step.state === "complete" ? "已确认" : step.state === "attention" ? "待处理" : "未开始"}`} className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-black transition-all ${stepClassName(step.state)}`}>{step.label}</span>
                ))}
                {sourceDocument && <FileText className="ml-auto h-3.5 w-3.5 text-text-dark" />}
              </div>
            </button>
          );
        })}
        {!visibleUnits.length && <p className="px-3 py-8 text-center text-xs font-semibold text-text-muted">没有符合当前筛选的{unitLabel}</p>}
      </div>
    </aside>
  );
}
