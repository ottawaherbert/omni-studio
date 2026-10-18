import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Search, Trash2, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { ProductionProjectCard } from "../components/production/ProductionProjectCard";
import { ProductionScriptImportModal } from "../components/production/ProductionScriptImportModal";
import { ProductionTrashModal } from "../components/production/ProductionTrashModal";
import { Modal } from "../components/ui/Modal";
import { useProductionProjectActions, useProductionProjectLibrary } from "../features/production/useProductionProjectLibrary";
import type { Project } from "../clients/domainTypes";

export default function ProductionProjectLibrary() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [projectPendingTrash, setProjectPendingTrash] = useState<Project | null>(null);
  const library = useProductionProjectLibrary();
  const actions = useProductionProjectActions();
  const visibleProjects = useMemo(
    () => library.productionProjects.filter((project) => project.title.toLowerCase().includes(search.trim().toLowerCase())),
    [library.productionProjects, search],
  );

  return (
    <main className="mx-auto flex h-full w-full max-w-7xl flex-col p-6 md:p-12 bg-bg-primary text-text-primary">
      <header className="mb-8 flex shrink-0 flex-wrap items-center justify-between gap-4 md:mb-12">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate("/production")} leftIcon={<ArrowLeft className="h-4 w-4" />}>返回</Button>
          <div>
            <h1 className="mb-2 text-2xl font-black uppercase tracking-tighter text-text-primary md:text-3xl">导演制片 <span className="font-light text-gold">项目库</span></h1>
            <p className="text-sm font-mono uppercase tracking-widest text-text-muted">专业制片工作区</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" title="刷新项目" onClick={() => void library.refresh()} className="rounded-full p-2 text-text-muted transition hover:text-text-primary hover:bg-bg-surface-soft"><RefreshCw className="h-4 w-4 text-gold" /></button>
          <Button variant="secondary" size="sm" onClick={() => setIsTrashOpen(true)} leftIcon={<Trash2 className="h-4 w-4" />}>垃圾箱{library.trashedProductionProjects.length > 0 ? ` (${library.trashedProductionProjects.length})` : ""}</Button>
          <Button variant="secondary" size="sm" onClick={actions.openMagicImport} leftIcon={<Wand2 className="h-4 w-4" />}>魔法导入</Button>
          <Button size="sm" onClick={() => { setIsImportOpen(true); void library.refreshWritingProjects(); }}>导入系统剧本</Button>
        </div>
      </header>

      <div className="mb-4 flex shrink-0 items-center justify-between gap-4">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索制片项目..." className="h-9 w-full rounded-xl bg-bg-surface-soft py-2 pl-9 pr-3 text-xs text-text-primary outline-none transition focus:bg-bg-surface-hover" />
        </div>
        <span className="text-xs font-bold text-text-muted">共 {visibleProjects.length} 个制片项目</span>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto pb-8 custom-scrollbar">
        {library.isLoading ? (
          <div className="flex h-full min-h-64 items-center justify-center text-text-muted"><Loader2 className="h-6 w-6 animate-spin text-gold" /></div>
        ) : visibleProjects.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 md:gap-8 animate-fade-in">
            {visibleProjects.map((project) => <ProductionProjectCard key={project.id} project={project} isBusy={actions.busyProjectId === project.id} onOpen={() => void actions.openProductionProject(project.id)} onMoveToTrash={setProjectPendingTrash} />)}
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl bg-bg-surface/50 text-text-muted">
            <p className="mb-4 text-sm font-medium">暂无匹配的制片项目</p>
            <Button size="sm" variant="outline" onClick={() => { setIsImportOpen(true); void library.refreshWritingProjects(); }}>导入第一个剧本</Button>
          </div>
        )}
      </section>

      <ProductionScriptImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} projects={library.importableWritingProjects} isLoading={library.isWritingLoading} loadFailed={library.writingLoadFailed} onRetry={library.refreshWritingProjects} busyProjectId={actions.busyProjectId} onImport={actions.importWritingProject} />
      <ProductionTrashModal
        isOpen={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
        projects={library.trashedProductionProjects}
        busyProjectId={actions.busyProjectId}
        onRestore={actions.restoreProductionProject}
        onDelete={actions.deleteProductionProjectPermanently}
        onEmpty={actions.emptyProductionTrash}
      />
      <Modal
        isOpen={Boolean(projectPendingTrash)}
        onClose={() => setProjectPendingTrash(null)}
        title="移入垃圾箱"
        size="sm"
        footer={(
          <>
            <Button variant="secondary" size="sm" onClick={() => setProjectPendingTrash(null)}>取消</Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={Boolean(projectPendingTrash && actions.busyProjectId === projectPendingTrash.id)}
              onClick={() => {
                if (!projectPendingTrash) return;
                void actions.moveProductionProjectToTrash(projectPendingTrash).then((moved) => {
                  if (moved) setProjectPendingTrash(null);
                });
              }}
            >
              移入垃圾箱
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-text-secondary">确定将《{projectPendingTrash?.title}》移入垃圾箱吗？项目内容会保留，可随时恢复。</p>
      </Modal>
    </main>
  );
}
