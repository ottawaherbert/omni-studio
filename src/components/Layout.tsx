import { ProductionWorkflowGuide } from "./production/ProductionWorkflowGuide";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  Clapperboard,
  LayoutDashboard,
  Type,
  Image as ImageIcon,
  Settings,
  Library,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  MonitorPlay,
  Edit2,
  BookOpen,
  ArrowLeft,
  ChevronDown,
  MessageSquare,
  Bell,
  Sun,
  Moon,
  Wand2,
  Lock,
  Film,
  Loader2,
  Cloud,
  CloudOff,
  Bot,
  FileText,
  GitBranch,
  Sparkles,
  UserRound,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useProjectStore, useSettingsStore } from "../clients/stateClient";
import { lazy, Suspense, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import SaveConflictModal from "./SaveConflictModal";
import type { AssistantPageFocus, AssistantProjectRef } from "../clients/domainTypes";
import {
  GLOBAL_ASSISTANT_COMMAND_EVENT,
  openGlobalAssistant,
  type GlobalAssistantCommand,
} from "./assistant/assistantEvents";

const GlobalAssistant = lazy(() => import("./assistant/GlobalAssistant")
  .then((module) => ({ default: module.GlobalAssistant })));
const GlobalGenerationParamsModal = lazy(() => import("./GlobalGenerationParamsModal"));

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentProject, activeEpisodeId, updateProject, syncStatus, saveConflict } = useProjectStore();
  const { theme, setTheme } = useSettingsStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isProjectGenerationSettingsOpen, setIsProjectGenerationSettingsOpen] = useState(false);
  const [assistantLaunchRequest, setAssistantLaunchRequest] = useState<{
    id: number;
    command?: GlobalAssistantCommand;
  } | null>(null);
  const assistantLaunchIdRef = useRef(0);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation();
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setIsSettingsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleAssistantCommand = (event: Event) => {
      assistantLaunchIdRef.current += 1;
      setAssistantLaunchRequest({
        id: assistantLaunchIdRef.current,
        command: (event as CustomEvent<GlobalAssistantCommand | undefined>).detail,
      });
    };
    window.addEventListener(GLOBAL_ASSISTANT_COMMAND_EVENT, handleAssistantCommand);
    return () => window.removeEventListener(GLOBAL_ASSISTANT_COMMAND_EVENT, handleAssistantCommand);
  }, []);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditingTitle]);

  const handleEditTitleStart = () => {
    if (currentProject) {
      setEditTitleValue(currentProject.title);
      setIsEditingTitle(true);
    }
  };

  const handleEditTitleSave = async () => {
    if (currentProject && editTitleValue.trim() !== "") {
      await updateProject({ title: editTitleValue.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleEditTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditTitleSave();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  };

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh");
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const mainNavItems = [
    { name: "写作中心", path: "/writing", icon: Type },
    { name: "导演制片", path: "/production", icon: Clapperboard },
    { name: "互动影视", path: "/interactive", icon: GitBranch },
    { 
      name: "内容生成", 
      icon: Wand2,
      isDropdown: true,
      children: [
        { name: t("nav.imageGen"), path: "/image-gen", icon: ImageIcon },
      ]
    },
    { name: "视频拉片", path: "/shot-analysis", icon: Film },
    { name: t("nav.assets"), path: "/assets", icon: Library },
    { name: "Skill 库", path: "/skills", icon: Wand2 },
  ];

  const isDirectorProductionRoute = location.pathname.startsWith("/production");
  const isInteractiveProductionRoute = location.pathname.startsWith("/interactive");
  const productionWorkspaceContext = new URLSearchParams(location.search);
  const productionWorkspaceHref = (path: string) => {
    if (!isDirectorProductionRoute) return path;
    const params = new URLSearchParams();
    for (const key of ["projectId", "episodeId", "sceneId", "returnTo"]) {
      const value = productionWorkspaceContext.get(key);
      if (value) params.set(key, value);
    }
    if (path === "/production/storyboard") {
      const videoMode = productionWorkspaceContext.get("videoMode");
      if (videoMode) params.set("videoMode", videoMode);
    }
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  const directorProductionNavItems = [
    { name: "导入剧本", path: "/production", to: productionWorkspaceHref("/production"), icon: FileText },
    { name: "剧本与场次", path: "/production/preparation", to: productionWorkspaceHref("/production/preparation"), icon: Bot },
    { name: "项目资产", path: "/production/assets", to: productionWorkspaceHref("/production/assets"), icon: Library },
    { name: "分镜与故事板", path: "/production/storyboard", to: productionWorkspaceHref("/production/storyboard"), icon: ImageIcon },
    { name: "摄影棚", path: "/production/studio", to: productionWorkspaceHref("/production/studio"), icon: MonitorPlay },
  ];
  const isProductionLibraryRoute = location.pathname === "/production/library";
  const isProductionImportRoute = location.pathname === "/production/import";
  const interactiveProductionNavItems = [
    { name: "互动项目", path: "/interactive", icon: GitBranch },
  ];
  const projectNavItems = isProductionLibraryRoute || isProductionImportRoute
    ? []
    : isDirectorProductionRoute
    ? directorProductionNavItems
    : isInteractiveProductionRoute ? interactiveProductionNavItems : [];
  const matchesProjectNavItem = (path: string) => location.pathname === path
    || (path !== "/" && location.pathname.startsWith(`${path}/`));
  const activeProjectNavPath = projectNavItems
    .filter((item) => matchesProjectNavItem(item.path))
    .sort((left, right) => right.path.length - left.path.length)[0]?.path;
  const isProjectRoute = !isProductionLibraryRoute && !isProductionImportRoute && [
    "/production",
    "/interactive",
  ].some(route => location.pathname.startsWith(route));
  const isWritingActive =
    location.pathname.startsWith("/writing") &&
    new URLSearchParams(location.search).has("projectId");
  const assistantSearch = new URLSearchParams(location.search);
  const writingProjectId = location.pathname.startsWith("/writing") ? assistantSearch.get("projectId") : null;
  const isDirectorProjectWorkspace = location.pathname.startsWith("/production/preparation")
    || location.pathname.startsWith("/production/assets")
    || location.pathname.startsWith("/production/storyboard")
    || location.pathname.startsWith("/production/studio");
  const interactiveExperienceId = location.pathname.match(/\/interactive\/experiences\/([^/]+)/)?.[1];
  const assistantProjectRef: AssistantProjectRef | undefined = writingProjectId
    ? { namespace: "writing", projectId: writingProjectId }
    : isDirectorProjectWorkspace && currentProject
      ? { namespace: "production", projectId: currentProject.id }
      : isInteractiveProductionRoute && interactiveExperienceId
        ? { namespace: "interactive", projectId: interactiveExperienceId }
        : undefined;
  const assistantEpisodeId = assistantSearch.get("episodeId")
    || location.pathname.match(/\/(?:episodes|episode)\/([^/]+)/)?.[1]
    || (assistantProjectRef && assistantProjectRef.namespace !== "writing" ? activeEpisodeId : undefined)
    || undefined;
  const assistantPageFocus: AssistantPageFocus = {
    module: assistantProjectRef?.namespace || "shared",
    route: `${location.pathname}${location.search}`,
    projectRef: assistantProjectRef,
    episodeId: assistantEpisodeId,
    sceneId: assistantSearch.get("sceneId") || undefined,
    shotId: assistantSearch.get("shotId") || undefined,
    nodeId: assistantSearch.get("nodeId") || undefined,
    capturedAt: Date.now(),
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <div className="flex h-screen overflow-hidden bg-bg-primary text-text-primary font-sans select-none">
      {/* Global Left Sidebar Navigation */}
      <aside className="flex h-screen w-14 shrink-0 flex-col items-center justify-between overflow-visible border-r border-border-soft/10 bg-bg-primary py-3 select-none z-50 md:w-20 md:py-5">
        <div className="flex w-full flex-col items-center gap-5 md:gap-8">
          {/* Logo Brand Mark */}
          <Link to="/" className="group flex items-center justify-center">
            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_30%_20%,#80f7ff_0%,#00cae0_38%,#3358ff_72%,#111318_100%)] transition-transform duration-300 group-hover:scale-105 md:h-8 md:w-8">
              <Sparkles className="w-[18px] h-[18px] text-white" />
            </div>
          </Link>

          <nav className="w-full flex flex-col gap-1.5">
            {[
              { path: "/writing", label: "写作", icon: Type },
              { path: "/production", label: "制片", icon: Clapperboard },
              { path: "/interactive", label: "互动", icon: GitBranch },
              { path: "/shot-analysis", label: "拉片", icon: Film },
              { path: "/assets", label: "资产", icon: Library },
              { path: "/skills", label: "技能", icon: Bot },
              {
                label: "生成",
                icon: Wand2,
                isDropdown: true,
                children: [
                  { path: "/image-gen", label: "图片" },
                ]
              }
            ].map((item) => {
              if (item.isDropdown) {
                const childActive = item.children?.some(child => location.pathname === child.path);
                const Icon = item.icon;
                return (
                  <div key={item.label} className="group relative w-full h-11 flex flex-col items-center justify-center gap-0.5 select-none cursor-pointer">
                    {childActive && (
                      <div className="absolute inset-x-2.5 inset-y-0.5 rounded-xl bg-[rgba(255,255,255,0.07)]" />
                    )}
                    <Icon className={`relative w-[18px] h-[18px] text-text-muted transition-transform duration-300 group-hover:-translate-y-0.5 ${childActive ? "text-gold" : ""}`} />
                    <span className={`relative hidden text-[10px] leading-none font-medium tracking-wide md:block ${childActive ? "text-text-primary font-bold" : "text-text-muted group-hover:text-text-primary"}`}>{item.label}</span>
                    
                    {/* Hover Flyout Dropdown */}
                    <div className="absolute top-0 left-full ml-1 pl-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 z-50">
                      <div className="w-20 bg-bg-surface border border-border-soft/20 rounded-xl p-1 shadow-xl flex flex-col gap-0.5">
                        {item.children?.map(child => {
                          const isChildActive = location.pathname === child.path;
                          return (
                            <Link
                              key={child.path}
                              to={child.path}
                              className={`flex items-center justify-center py-2 text-[10px] font-bold rounded-lg transition-all ${
                                isChildActive
                                  ? "bg-[rgba(255,255,255,0.07)] text-gold"
                                  : "text-text-muted hover:text-text-primary hover:bg-bg-surface-soft"
                              }`}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              const isActive = location.pathname === item.path || (item.path !== "/" && location.pathname.startsWith(item.path + "/"));
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`group relative w-full h-11 flex flex-col items-center justify-center gap-0.5 transition-all duration-300 ${
                    isActive 
                      ? "text-text-primary font-bold" 
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {isActive && (
                    <div className="absolute inset-x-2.5 inset-y-0.5 rounded-xl bg-[rgba(255,255,255,0.07)]" />
                  )}
                  <Icon className={`relative w-[18px] h-[18px] transition-transform duration-300 group-hover:-translate-y-0.5 ${isActive ? "text-gold" : ""}`} />
                  <span className="relative hidden text-[10px] leading-none font-medium tracking-wide md:block">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom Menu Navigation */}
        <div className="w-full flex flex-col items-center gap-4 pb-2">
          <button
            type="button"
            onClick={() => openGlobalAssistant()}
            className="group relative flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-bg-primary shadow-lg shadow-black/10 transition-transform hover:scale-105"
            title="全站助手"
          >
            <Bot className="h-[18px] w-[18px]" />
            <span className="pointer-events-none absolute right-full mr-3 whitespace-nowrap border border-border-soft/20 bg-bg-surface px-2.5 py-1.5 text-[10px] font-bold text-text-primary opacity-0 shadow-lg transition-opacity group-hover:opacity-100">全站助手</span>
          </button>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface-soft transition-all cursor-pointer"
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-text-muted hover:text-text-primary" /> : <Moon className="w-4 h-4 text-text-muted hover:text-text-primary" />}
          </button>

          {/* Settings Button */}
          <Link
            to="/settings"
            className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
              location.pathname === "/settings"
                ? "bg-[rgba(255,255,255,0.07)] text-text-primary"
                : "text-text-muted hover:text-text-primary hover:bg-bg-surface-soft"
            }`}
            title="系统设置"
          >
            <Settings className="w-[19px] h-[19px]" />
          </Link>
        </div>
      </aside>

      {/* Main Container Area */}
      <div className="flex-1 h-screen flex flex-col min-w-0 overflow-hidden bg-bg-primary text-text-primary">
        {/* Inner Header for Project Context (only when isProjectRoute is true and we have currentProject) */}
        {isProjectRoute && !location.pathname.startsWith("/interactive") && projectNavItems.length > 0 && (currentProject || isInteractiveProductionRoute) && (
          <header className="h-16 bg-bg-primary border-b border-border-soft/10 flex items-center shrink-0 z-40">
            <div className="mx-auto w-full max-w-7xl flex items-center justify-between gap-3 px-4 h-full">
              {/* Left: Project Title & Breadcrumb */}
              <div className="flex items-center gap-4 min-w-0 shrink">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-text-muted font-medium truncate max-w-[120px]">
                    {isInteractiveProductionRoute ? "互动影视" : currentProject?.title}
                  </span>
                </div>
              </div>

              {/* Workspace views are independent, not completion steps. */}
              <div className="hidden md:flex items-center justify-center flex-1 min-w-0">
                {projectNavItems.length > 0 && (
                  <nav aria-label="制片工作区" className="flex items-center justify-center gap-1">
                    {projectNavItems.map((item) => {
                      const isActive = item.path === activeProjectNavPath;
                      const Icon = item.icon;
                      
                      return (
                          <Link
                            key={item.path}
                            to={"to" in item ? item.to : item.path}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                              "flex h-9 items-center gap-1.5 px-2 rounded-md transition-colors shrink-0 text-xs font-medium",
                              isActive 
                                ? "bg-bg-surface-soft text-gold"
                                : "text-text-muted hover:bg-bg-surface-soft hover:text-text-primary"
                            )}
                          >
                            <Icon className="w-3.5 h-3.5 shrink-0" />
                            <span>{item.name}</span>
                          </Link>
                      );
                    })}
                  </nav>
                )}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-3 justify-end shrink-0">
                {isDirectorProjectWorkspace && currentProject && (
                  <button
                    type="button"
                    onClick={() => setIsProjectGenerationSettingsOpen(true)}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border-soft/25 bg-bg-surface px-2.5 text-[11px] font-bold text-text-secondary transition-colors hover:border-gold/40 hover:text-gold"
                    title="修改整个项目的分镜、故事板和视频生成画幅"
                    aria-label="打开项目生成设置"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    项目画幅 {currentProject.aspectRatio || "16:9"}
                  </button>
                )}
                {syncStatus && (
                  <div className="flex items-center gap-2 px-1 hidden sm:flex" title={
                    syncStatus === 'saving' ? "保存中..." :
                    syncStatus === 'saved' ? "已保存" :
                    syncStatus === 'failed' ? "保存失败，本机修改已保留。请检查冲突后手动处理。" : ""
                  }>
                      {syncStatus === 'saving' && <Loader2 className="w-3.5 h-3.5 text-gold animate-spin" />}
                      {syncStatus === 'saved' && <Cloud className="w-3.5 h-3.5 text-gold/80" />}
                      {syncStatus === 'failed' && <CloudOff className="w-3.5 h-3.5 text-accent-red" />}
                  </div>
                )}
              </div>
            </div>
          </header>
        )}

        {isDirectorProductionRoute && currentProject && <ProductionWorkflowGuide pathname={location.pathname} href={productionWorkspaceHref} />}

        {/* Content Page Window */}
        <main data-production-canvas className={`flex-1 overflow-y-auto min-w-0 bg-bg-primary text-text-primary custom-scrollbar ${isDirectorProductionRoute ? "[scrollbar-gutter:stable]" : ""}`}>
          <Outlet />
        </main>
      </div>

      {/* Save Conflict Modal */}
      <SaveConflictModal
        isOpen={Boolean(saveConflict?.isOpen)}
        projectId={saveConflict?.projectId || ""}
        dbVersion={saveConflict?.dbVersion || null}
        localVersion={saveConflict?.localVersion || null}
        memoryVersion={saveConflict?.memoryVersion || null}
        onResolve={(choice) => saveConflict?.resolvePromise?.(choice)}
        onClose={() => saveConflict?.resolvePromise?.('db')}
      />
      {isProjectGenerationSettingsOpen && (
        <Suspense fallback={null}>
          <GlobalGenerationParamsModal
            isOpen
            onClose={() => setIsProjectGenerationSettingsOpen(false)}
          />
        </Suspense>
      )}
      {assistantLaunchRequest && (
        <Suspense fallback={null}>
          <GlobalAssistant
            projectRef={assistantProjectRef}
            projectTitle={assistantProjectRef ? (assistantProjectRef.namespace === "writing" ? "剧本项目" : currentProject?.title) : undefined}
            pageFocus={assistantPageFocus}
            launchRequest={assistantLaunchRequest}
          />
        </Suspense>
      )}
    </div>
  );
}
