import { useState } from "react";
import { ArrowRight, Clapperboard, FileText, Library, LoaderCircle, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ProductionProjectCard } from "../components/production/ProductionProjectCard";
import { ProductionScriptImportModal } from "../components/production/ProductionScriptImportModal";
import { useProductionProjectActions, useProductionProjectLibrary } from "../features/production/useProductionProjectLibrary";

export default function DirectorProduction() {
  const navigate = useNavigate();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const library = useProductionProjectLibrary();
  const actions = useProductionProjectActions();
  const recentProjects = library.productionProjects.slice(0, 3);

  return (
    <main className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto px-4 py-6 sm:px-8 sm:py-10 bg-bg-primary text-text-primary animate-fade-in">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 pb-7">
        <div className="min-w-0">
          <h1 className="text-page-title tracking-tight text-text-primary">导演制片 <span className="hidden font-light text-gold sm:inline">PRODUCTION</span></h1>
          <p className="mt-2 text-sm font-medium text-text-muted">从剧本与场次开始，准备资产、分镜与故事板，再进入摄影棚</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/production/library")}
          className="h-9 shrink-0 px-4 bg-bg-surface-soft text-text-primary hover:bg-bg-surface-hover rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-1.5 cursor-pointer active:scale-95"
        >
          <Library className="h-4 w-4 text-gold" />
          <span>项目库</span>
        </button>
      </header>

      <div className="flex flex-1 flex-col justify-center">
        <section className="shrink-0">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-text-secondary">开始制片</h2>
            <span className="text-[10px] font-bold text-text-dark uppercase tracking-widest">创作者确认关键流转</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <button
              type="button"
              onClick={() => { setIsImportOpen(true); void library.refreshWritingProjects(); }}
              className="group flex min-h-32 items-center gap-4 rounded-2xl bg-bg-surface p-4 text-left transition-all duration-300 hover:bg-bg-surface-hover hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 cursor-pointer sm:min-h-40 sm:gap-6 sm:p-6"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg-surface-soft text-text-secondary transition-all group-hover:scale-105 group-hover:text-gold"><FileText className="h-6 w-6" /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-card-title text-text-primary group-hover:text-gold transition-colors">导入系统剧本</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted font-medium">选择写作中心已有的剧本副本直接进入剧本与场次</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-text-dark transition-all duration-300 group-hover:translate-x-1 group-hover:text-gold" />
            </button>
            <button
              type="button"
              onClick={actions.openMagicImport}
              className="group flex min-h-32 items-center gap-4 rounded-2xl bg-bg-surface p-4 text-left transition-all duration-300 hover:bg-bg-surface-hover hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 cursor-pointer sm:min-h-40 sm:gap-6 sm:p-6"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg-surface-soft text-text-secondary transition-all group-hover:scale-105 group-hover:text-gold"><Wand2 className="h-6 w-6" /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-card-title text-text-primary group-hover:text-gold transition-colors">魔法导入</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-text-muted font-medium">粘贴剧本或读取 TXT 文件，进入剧本与场次</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-text-dark transition-all duration-300 group-hover:translate-x-1 group-hover:text-gold" />
            </button>
          </div>
        </section>

        <section className="mt-10 min-h-0 shrink-0 pt-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-text-secondary">最近制片项目</h2>
            <button
              type="button"
              onClick={() => navigate("/production/library")}
              className="text-xs font-bold text-gold transition hover:text-gold-light cursor-pointer"
            >
              查看全部
            </button>
          </div>
          {library.isLoading ? (
            <div className="flex h-40 items-center justify-center text-text-muted"><LoaderCircle className="h-6 w-6 animate-spin text-gold" /></div>
          ) : recentProjects.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:gap-6">
              {recentProjects.map((project) => <ProductionProjectCard key={project.id} project={project} compact isBusy={actions.busyProjectId === project.id} onOpen={() => void actions.openProductionProject(project.id)} />)}
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center rounded-2xl bg-bg-surface/50 text-sm font-medium text-text-muted">
              <Clapperboard className="mr-3 h-5 w-5 text-text-dark" />尚未建立制片项目
            </div>
          )}
        </section>
      </div>

      <ProductionScriptImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} projects={library.importableWritingProjects} isLoading={library.isWritingLoading} busyProjectId={actions.busyProjectId} onImport={actions.importWritingProject} />
    </main>
  );
}
