import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, Search, Plus, RefreshCw, Trash2, Play, 
  Film, Tv, PlaySquare, Clock, BookOpen, Sparkles
} from 'lucide-react';
import { Button } from '../../../../../src/components/ui/Button';
import { Modal } from '../../../../../src/components/ui/Modal';
import type { ScriptProjectSummary } from '../../../../../packages/domain/src/scriptDelivery';

interface Props {
  projects: ScriptProjectSummary[];
  isLoading?: boolean;
  onOpen: (id: string) => void;
  onDeleteProject?: (id: string) => Promise<void> | void;
  onBackToHero: () => void;
  onRefresh: () => void;
}

const getFormatLabel=(project:ScriptProjectSummary)=>project.workType||(project.format==='single-work'?'单部作品':project.format==='series-work'?'分集作品':'剧本');

export function ScriptProjectLibraryPage({
  projects,
  isLoading = false,
  onOpen,
  onDeleteProject,
  onBackToHero,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState('');
  const [filterFormat, setFilterFormat] = useState<string|null>(null);
  const [projectPendingDelete, setProjectPendingDelete] = useState<ScriptProjectSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const visibleProjects = useMemo(() => {
    return projects.filter((p) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        p.title.toLowerCase().includes(q) ||
        (p.genre && p.genre.toLowerCase().includes(q)) ||
        (p.concept && p.concept.toLowerCase().includes(q));

      if (!matchSearch) return false;
      return filterFormat===null||getFormatLabel(p)===filterFormat;
    });
  }, [projects, search, filterFormat]);

  const handleDeleteConfirm = async () => {
    if (!projectPendingDelete || !onDeleteProject) return;
    setIsDeleting(true);
    try {
      await onDeleteProject(projectPendingDelete.id);
      setProjectPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const getFormatIcon = (p: ScriptProjectSummary) => {
    if (p.workType?.includes('短剧') || p.format === 'series-work') {
      return <PlaySquare className="h-4 w-4 text-text-secondary" />;
    }
    if (p.workType?.includes('电影') || p.format === 'single-work') {
      return <Film className="h-4 w-4 text-text-secondary" />;
    }
    return <Tv className="h-4 w-4 text-text-secondary" />;
  };


  return (
    <main className="mx-auto flex h-full w-full max-w-7xl flex-col p-6 md:p-12 bg-bg-primary text-text-primary overflow-y-auto custom-scrollbar select-none">
      {/* 1. Header (Aliged with ProductionProjectLibrary) */}
      <header className="mb-8 flex shrink-0 flex-wrap items-center justify-between gap-4 md:mb-10">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={onBackToHero}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            返回起笔
          </Button>
          <div>
            <h1 className="mb-1 text-2xl font-black uppercase tracking-tight text-text-primary md:text-3xl">
              剧本工坊 <span className="font-light text-text-secondary">作品库</span>
            </h1>
            <p className="text-xs font-mono tracking-wider text-text-muted">
              所有剧本工程与故事蓝图 · 随时继续起笔
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="刷新作品列表"
            onClick={onRefresh}
            className="rounded-full p-2 text-text-muted transition hover:text-text-primary hover:bg-bg-surface-soft cursor-pointer"
          >
            <RefreshCw className="h-4 w-4 text-text-secondary" />
          </button>
          <Button
            size="sm"
            onClick={onBackToHero}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            新建剧本
          </Button>
        </div>
      </header>

      {/* 2. Search & Format Filter Tabs */}
      <div className="mb-6 flex shrink-0 flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Search Bar */}
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索剧本名称、题材、关键词..."
            className="h-9 w-full rounded-xl bg-bg-surface-soft py-2 pl-9 pr-3 text-xs text-text-primary outline-none transition focus:bg-bg-surface-hover placeholder:text-text-muted"
          />
        </div>

        {/* Filter Tabs & Count */}
        <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-bg-surface-soft text-text-secondary">
            {[{id:null,label:'全部'},...[...new Set(projects.map(getFormatLabel))].sort().map(label=>({id:label,label}))].map((tab) => (
              <button
                key={tab.id||'all'}
                type="button"
                onClick={() => setFilterFormat(tab.id)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer ${
                  filterFormat === tab.id
                    ? 'bg-bg-surface text-text-primary shadow-sm font-semibold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-xs font-bold text-text-muted">
            共 {visibleProjects.length} 部剧本
          </span>
        </div>
      </div>

      {/* 3. Projects Grid List (Borderless card aesthetic) */}
      <section className="min-h-0 flex-1 overflow-y-auto pb-8">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-text-muted gap-2 text-xs">
            <Sparkles size={16} className="animate-spin text-text-secondary" />
            <span>正在载入作品库...</span>
          </div>
        ) : visibleProjects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 animate-fade-in">
            {visibleProjects.map((project) => {
              const genreLabel = project.genre || '剧情';
              const statusLabel = project.writtenUnitCount > 0 ? '创作中' : '已建立蓝图';
              const conceptText = project.concept || '已建立剧本蓝图，点击进入工坊起笔创作。';

              return (
                <div
                  key={project.id}
                  onClick={() => onOpen(project.id)}
                  className="group flex flex-col justify-between rounded-2xl bg-bg-surface p-6 text-left transition-all duration-300 hover:bg-bg-surface-hover hover:scale-[1.01] shadow-sm hover:shadow-md cursor-pointer"
                >
                  {/* Top Bar: Icon + Genre + Revision + Delete */}
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-bg-surface-soft p-2 text-text-secondary transition-all group-hover:scale-105">
                          {getFormatIcon(project)}
                        </div>
                        <span className="text-xs font-bold text-text-secondary">
                          {getFormatLabel(project)}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-bg-surface-soft text-text-muted">
                          {genreLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-bg-surface-soft text-text-secondary border border-border-primary/20">
                          {statusLabel}
                        </span>

                        {onDeleteProject && (
                          <button
                            type="button"
                            title="删除剧本"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectPendingDelete(project);
                            }}
                            className="p-1.5 rounded-xl text-text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors opacity-70 group-hover:opacity-100"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Title */}
                    <h3 className="truncate text-base font-bold text-text-primary group-hover:text-text-primary transition-colors">
                      {project.title}
                    </h3>

                    {/* Concept Snippet */}
                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-text-muted font-normal">
                      {conceptText}
                    </p>
                  </div>

                  {/* Bottom: Stats & Action Button */}
                  <div className="mt-5 pt-4 border-t border-border-soft/10 space-y-3">
                    <div className="flex items-center justify-between text-[11px] text-text-muted font-mono">
                      <span>
                        {project.format==='single-work'?(project.writtenUnitCount?'已有正文':'尚未写正文'):`已写 ${project.writtenUnitCount} / 计划 ${project.plannedUnitCount} 集`} · {project.sceneCount || 0} 场 · {(project.totalCharacters || 0).toLocaleString()} 字
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        <span>{new Date(project.updatedAt).toLocaleDateString('zh-CN')}</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(project.id);
                      }}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-bold bg-gray-900 text-white hover:bg-black dark:bg-white dark:text-black dark:hover:bg-gray-200 transition-all shadow-sm cursor-pointer"
                    >
                      <span>继续写作</span>
                      <Play size={11} className="fill-current" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl bg-bg-surface/50 text-text-muted space-y-3">
            <BookOpen size={36} className="text-text-muted/40" />
            <p className="text-sm font-medium text-text-secondary">
              {search ? '没有找到匹配的剧本' : '暂无剧本作品'}
            </p>
            <p className="text-xs text-text-muted">
              {search ? '换个搜索关键词试试。' : '现在就开启你的第一个长篇剧本创作吧！'}
            </p>
            <Button size="sm" onClick={onBackToHero} leftIcon={<Plus className="h-4 w-4" />}>
              前往起笔创作
            </Button>
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(projectPendingDelete)}
        onClose={() => setProjectPendingDelete(null)}
        title="删除剧本作品"
        size="sm"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setProjectPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isDeleting}
              onClick={handleDeleteConfirm}
            >
              彻底删除
            </Button>
          </>
        )}
      >
        <div className="text-xs text-text-muted leading-relaxed space-y-2">
          <p>
            确定彻底删除剧本《<span className="font-bold text-text-primary">{projectPendingDelete?.title}</span>》？
          </p>
          <p className="text-accent-red font-medium">
            此操作将永久移除该剧本的所有分集、场次、任务记录以及恢复缓存，且不可恢复。
          </p>
        </div>
      </Modal>
    </main>
  );
}
