import { useMemo, useState } from "react";
import { FileText, Film, Loader2, LoaderCircle, Search, Smartphone, Tv } from "lucide-react";

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { ScriptProjectSummary } from "../../../packages/domain/src/scriptDelivery";

const formatLabel = {
  movie: "电影",
  "tv-series": "电视剧",
  "short-drama": "短剧",
  "micro-short-drama": "超短剧",
} as const;

const formatIcon = (format: ScriptProjectSummary["format"]) => {
  if (format === "tv-series") return Tv;
  if (format === "short-drama" || format === "micro-short-drama") return Smartphone;
  return Film;
};

export const ProductionScriptImportModal = ({
  isOpen,
  onClose,
  projects,
  isLoading,
  loadFailed,
  onRetry,
  busyProjectId,
  onImport,
}: {
  isOpen: boolean;
  onClose: () => void;
  projects: ScriptProjectSummary[];
  isLoading: boolean;
  loadFailed?: boolean;
  onRetry?: () => Promise<void>;
  busyProjectId: string | null;
  onImport: (projectId: string) => Promise<boolean>;
}) => {
  const [search, setSearch] = useState("");
  const visibleProjects = useMemo(
    () => projects.filter((project) => project.title.toLowerCase().includes(search.trim().toLowerCase())),
    [projects, search],
  );

  const handleImport = async (projectId: string) => {
    const imported = await onImport(projectId);
    if (imported) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="导入系统剧本" size="xl" className="max-w-5xl bg-bg-surface text-text-primary">
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索剧本标题..."
              className="h-10 w-full rounded-xl bg-bg-surface-soft py-2 pl-9 pr-3 text-sm text-text-primary outline-none transition focus:bg-bg-surface-hover"
            />
          </div>
          <span className="shrink-0 text-xs font-bold text-text-muted">{visibleProjects.length} 个可导入剧本</span>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-text-muted"><LoaderCircle className="h-6 w-6 animate-spin text-gold" /></div>
        ) : loadFailed ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-text-muted">
            <span className="text-sm">剧本列表加载失败，制片项目仍可正常使用。</span>
            <Button size="sm" variant="secondary" onClick={() => void onRetry?.()}>重试加载剧本</Button>
          </div>
        ) : visibleProjects.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => {
              const Icon = formatIcon(project.format);
              const isBusy = busyProjectId === project.id;
              return (
                <div key={project.id} className="flex min-h-44 flex-col rounded-2xl bg-bg-surface p-6 transition-all hover:bg-bg-surface-hover hover:scale-[1.01]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="rounded-xl bg-bg-surface-soft p-2.5 text-text-secondary transition-all"><Icon className="h-4 w-4" /></div>
                      <span className="text-xs font-black text-text-secondary">{formatLabel[project.format]}</span>
                    </div>
                    <span className="rounded-full bg-bg-surface-soft text-text-secondary px-2.5 py-0.5 text-[10px] font-bold">正文 {project.writtenUnitCount || 0}</span>
                  </div>
                  <h3 className="truncate text-base font-black text-text-primary" title={project.title}>{project.title}</h3>
                  <p className="mt-2 flex-1 text-xs leading-relaxed text-text-muted font-medium">导入后建立独立制片副本</p>
                  <Button
                    size="sm"
                    className="mt-4 w-full rounded-xl btn-primary text-xs font-bold py-2 active:scale-95"
                    disabled={busyProjectId !== null}
                    isLoading={isBusy}
                    onClick={() => void handleImport(project.id)}
                  >
                    导入剧本
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center rounded-2xl text-text-muted">
            <FileText className="mb-3 h-7 w-7 text-text-dark" />
            <span className="text-sm font-medium">没有可导入的系统剧本</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
