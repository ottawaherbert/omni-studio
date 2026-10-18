import type { KeyboardEvent } from "react";
import { ArrowRight, Clapperboard, Film, Loader2, LoaderCircle, Smartphone, Trash2, Tv } from "lucide-react";

import type { Project, ProjectType } from "../../clients/domainTypes";

const typeLabels: Record<ProjectType, string> = {
  "single-work": "单部作品",
  "series-work": "系列作品",
  movie: "电影",
  "tv-series": "电视剧",
  "short-drama": "短剧",
  "micro-short-drama": "超短剧",
};

const formatIcon = (type: ProjectType) => {
  if (type === "tv-series") return Tv;
  if (type === "short-drama" || type === "micro-short-drama") return Smartphone;
  return Film;
};

const formatDate = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(value) : "近期创建";

export const ProductionProjectCard = ({
  project,
  isBusy,
  onOpen,
  onMoveToTrash,
  compact = false,
}: {
  project: Project;
  isBusy: boolean;
  onOpen: () => void;
  onMoveToTrash?: (project: Project) => void;
  compact?: boolean;
}) => {
  const Icon = formatIcon(project.type);
  const sourceLabel = project.productionSourceSnapshot?.sourceType === "writing_export" ? "系统剧本" : "魔法导入";
  const unitCount = Array.isArray(project.episodes) ? project.episodes.length : project.targetEpisodeCount || 0;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="group flex h-full cursor-pointer flex-col rounded-2xl bg-bg-surface p-6 text-left transition-all duration-300 hover:bg-bg-surface-hover hover:scale-[1.01] focus:outline-none focus:ring-4 focus:ring-gold/10"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-bg-surface-soft p-2.5 text-text-secondary transition-all group-hover:scale-105 group-hover:text-gold"><Icon className="h-4 w-4" /></div>
          <span className="text-xs font-black text-text-secondary">{project.workType || typeLabels[project.type]}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-bg-surface-soft text-text-secondary px-2.5 py-0.5 text-[10px] font-bold">
            {sourceLabel}
          </span>
          {onMoveToTrash && !compact && (
            <button
              type="button"
              aria-label={`删除制片项目 ${project.title}`}
              title="移入垃圾箱"
              disabled={isBusy}
              className="rounded-full p-2 text-text-dark opacity-100 transition hover:bg-accent-red/10 hover:text-accent-red focus:opacity-100 disabled:cursor-not-allowed md:opacity-0 md:group-hover:opacity-100 cursor-pointer"
              onClick={(event) => {
                event.stopPropagation();
                onMoveToTrash(project);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <h3 className="truncate text-base font-black text-text-primary transition-colors group-hover:text-gold">{project.title}</h3>
      {!compact && <p className="mt-2 line-clamp-2 flex-1 text-xs leading-relaxed text-text-muted font-medium">{project.logline || "已建立导演制片工作区"}</p>}
      <div className={`${compact ? "mt-4" : "mt-5"} flex items-center justify-between pt-4`}>
        <span className="text-[10px] font-bold text-text-muted">{unitCount} 个单元 · {formatDate(project.productionSourceSnapshot?.importedAt)}</span>
        {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin text-gold" /> : compact ? <Clapperboard className="h-4 w-4 text-text-dark group-hover:text-gold" /> : <ArrowRight className="h-4 w-4 text-text-dark transition-all duration-300 group-hover:translate-x-1 group-hover:text-gold" />}
      </div>
    </div>
  );
};
