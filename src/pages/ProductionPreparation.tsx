import { useEffect, useMemo, useState } from "react";
import { Boxes, ChevronLeft, ChevronRight, ClipboardList, FileText, Film, GalleryVerticalEnd, Loader2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { useProjectStore } from "../clients/stateClient";
import type { Project, Scene } from "../clients/domainTypes";
import { useSceneReadModel } from "../hooks/useSceneReadModel";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";
import { ProductionSceneRail } from "../components/production/preparation/ProductionSceneRail";
import { ProductionSourceUnitRail } from "../components/production/preparation/ProductionSourceUnitRail";
import { ProductionSourceOverviewWorkspace } from "../components/production/preparation/ProductionSourceOverviewWorkspace";
import { ProductionSceneBreakdownWorkspace } from "../components/production/preparation/ProductionSceneBreakdownWorkspace";
import { ManualProductionAssetsPanel } from "../components/production/ManualProductionAssetsPanel";
import { buildManualFilmTeamReadModel } from "../clients/productionPreparationWorkflowClient";
import { buildManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";
import {
  preparationStartTab,
  resolveProductionSceneTab,
  breakdownStatus,
  buildProductionPreparationCurrentTask,
  buildProductionPreparationTabStatuses,
  hasProductionSceneSource,
  nextIncompleteProductionSceneId,
  productionPreparationTabs,
  recommendedDepartmentsForScene,
  type PreparationStepSummary,
  type ProductionPreparationTab,
} from "../features/production/preparation/productionPreparationViewModel";
import { useProductionEpisodeAvailability } from "../features/production/preparation/useProductionEpisodeAvailability";
import { cn } from "../lib/utils";

const tabIcons = { overview: FileText, breakdown: ClipboardList, departments: Boxes, assets: GalleryVerticalEnd, review: Film };
const workspaceBreakdownStatus = (scene: Scene) =>
  (scene as Scene & { __workspaceBreakdownStatus?: string }).__workspaceBreakdownStatus
  || breakdownStatus(scene);

export default function ProductionPreparation() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { currentProject, activeEpisode, activeEpisodeId, setActiveEpisodeId, updateProject, updateScene, loadProject, isLoading } = useProjectStore(useShallow((state) => ({
    currentProject: state.currentProject,
    activeEpisode: state.activeEpisode,
    activeEpisodeId: state.activeEpisodeId,
    setActiveEpisodeId: state.setActiveEpisodeId,
    updateProject: state.updateProject,
    updateScene: state.updateScene,
    loadProject: state.loadProject,
    isLoading: state.isLoading,
  })));
  const { episodes: productionEpisodes, fullEpisodes: productionFullEpisodes, isResolving: isResolvingEpisodes } = useProductionEpisodeAvailability(currentProject, activeEpisode);
  const sceneReadModel = useSceneReadModel();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [newScriptUnitRequestKey, setNewScriptUnitRequestKey] = useState(0);
  const scenes = useMemo(
    () => sceneReadModel.scenes.filter(hasProductionSceneSource),
    [sceneReadModel.scenes],
  );
  const querySceneId = params.get("sceneId");
  const queryEpisodeId = params.get("episodeId");
  const queryProjectId = params.get("projectId");
  const queryTab = params.get("tab") as ProductionPreparationTab | null;
  const queryDepartment = params.get("department");
  const returnTo = params.get("returnTo");
  const interactiveReturnTo = returnTo?.startsWith("/interactive/experiences/") ? returnTo : null;
  const isRequestedProjectPending = Boolean(queryProjectId && currentProject?.id !== queryProjectId);
  const hasProductionWorkspaceShell = Boolean(
    (currentProject as (Project & { __productionWorkspaceShell?: boolean }) | null)?.__productionWorkspaceShell,
  );
  useEffect(() => {
    if (!queryProjectId || (currentProject?.id === queryProjectId && hasProductionWorkspaceShell)) return;
    void loadProject(queryProjectId, {
      episodeView: "production-preparation",
      sceneId: querySceneId || undefined,
    });
  }, [currentProject?.id, hasProductionWorkspaceShell, loadProject, queryProjectId, querySceneId]);
  // The URL is the single source of truth for the currently inspected scene and
  // step. Keeping a second local copy caused a stale URL effect to overwrite a
  // later tab/scene click in the same render cycle.
  const requestedScene = scenes.find((scene) => scene.id === querySceneId);
  const activeScene = useMemo(
    () => {
      const selected = scenes.find((scene) => scene.id === querySceneId);
      if (selected && !(selected as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary) {
        return selected;
      }
      return scenes.find((scene) => !(scene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary)
        || scenes[0];
    },
    [querySceneId, scenes],
  );
  const activeSceneId = activeScene?.id || null;
  const activeEpisodeWorkspace = activeEpisode as (typeof activeEpisode & {
    __workspaceView?: string;
    __workspaceSceneScope?: string;
  }) | null;
  const activeEpisodeView = activeEpisodeWorkspace?.__workspaceView;
  const activeEpisodeSceneScope = activeEpisodeWorkspace?.__workspaceSceneScope;
  const isSceneDetailPending = Boolean(
    requestedScene && (requestedScene as Scene & { __workspaceSceneSummary?: boolean }).__workspaceSceneSummary,
  );
  const activeTab = resolveProductionSceneTab(queryTab, activeScene, activeEpisode || undefined);

  useEffect(() => {
    if (!currentProject || !productionEpisodes.length || isRequestedProjectPending) return;
    const requestedEpisodeId = productionEpisodes.some((episode) => episode.id === queryEpisodeId)
      ? queryEpisodeId
      : productionEpisodes.some((episode) => episode.id === activeEpisode?.id)
        ? activeEpisode?.id
        : productionEpisodes[0].id;
    if (
      !activeEpisode
      || activeEpisode.id !== requestedEpisodeId
      || activeEpisodeView !== "production-preparation"
      || (querySceneId && activeEpisodeSceneScope !== querySceneId)
    ) {
      void setActiveEpisodeId(requestedEpisodeId, {
        view: "production-preparation",
        sceneId: querySceneId || undefined,
      });
    }
  }, [
    activeEpisode,
    activeEpisodeSceneScope,
    activeEpisodeView,
    currentProject,
    isRequestedProjectPending,
    productionEpisodes,
    queryEpisodeId,
    querySceneId,
    setActiveEpisodeId,
  ]);

  useEffect(() => {
    // Loading a project updates the project shell before its full episode record
    // is available. Do not normalize the URL with the previous project's active
    // scene in that small window, otherwise a deep link can acquire a stale
    // episodeId/sceneId from the project the author just left.
    if (
      !activeEpisode
      || !scenes.length
      || isRequestedProjectPending
      || isLoading
      || isResolvingEpisodes
      || !productionEpisodes.some((episode) => episode.id === activeEpisode.id)
    ) return;
    const isLoadingRequestedEpisode = Boolean(
      queryEpisodeId
      && queryEpisodeId !== activeEpisode.id
      && productionEpisodes.some((episode) => episode.id === queryEpisodeId),
    );
    if (isLoadingRequestedEpisode) return;
    const selectedScene = scenes.find((scene) => scene.id === querySceneId) || scenes[0];
    const selectedTab = resolveProductionSceneTab(queryTab, selectedScene, activeEpisode);
    if (queryProjectId !== currentProject.id || queryEpisodeId !== activeEpisode.id || querySceneId !== selectedScene.id || queryTab !== selectedTab || queryDepartment) {
      setParams({ projectId: currentProject.id, episodeId: activeEpisode.id, sceneId: selectedScene.id, tab: selectedTab, ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}) }, { replace: true });
    }
  }, [activeEpisode, currentProject, interactiveReturnTo, isRequestedProjectPending, isLoading, isResolvingEpisodes, productionEpisodes, queryDepartment, queryEpisodeId, queryProjectId, querySceneId, queryTab, scenes, setParams]);
  const preparationContext = useMemo(() => {
    if (!currentProject || !activeEpisode || !activeScene) return null;
    const filmTeam = buildManualFilmTeamReadModel({
      project: currentProject,
      episode: activeEpisode,
      requiredDepartments: recommendedDepartmentsForScene(activeScene),
    });
    const assets = buildManualProductionAssetReadModel({
      project: currentProject,
      episode: activeEpisode,
      scene: activeScene,
      episodes: productionFullEpisodes,
      filmTeam,
    });
    return { filmTeam, assets };
  }, [activeEpisode, activeScene, currentProject, productionFullEpisodes]);
  const tabStatuses = useMemo(() => preparationContext && activeScene
    ? buildProductionPreparationTabStatuses({ scene: activeScene, filmTeam: preparationContext.filmTeam, assets: preparationContext.assets })
    : [], [activeScene, preparationContext]);
  const activeSceneStepSummaries = useMemo<PreparationStepSummary[]>(() => tabStatuses
    .filter((status) => status.id !== "overview")
    .map((status) => ({
      id: status.id,
      label: status.id === "breakdown" ? "场" : "资",
      state: status.state,
    })), [tabStatuses]);
  const nextIncompleteBreakdownSceneId = nextIncompleteProductionSceneId(
    scenes,
    querySceneId,
    (scene) => workspaceBreakdownStatus(scene) !== "已确认",
  );
  const nextIncompleteBreakdownScene = scenes.find((scene) => scene.id === nextIncompleteBreakdownSceneId);
  const nextBreakdownHref = nextIncompleteBreakdownScene && currentProject && activeEpisode
    ? `/production/preparation?${new URLSearchParams({
        projectId: currentProject.id,
        episodeId: activeEpisode.id,
        sceneId: nextIncompleteBreakdownScene.id,
        tab: "breakdown",
        ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}),
      })}`
    : undefined;

  const selectScene = (sceneId: string) => {
    const scene = scenes.find((item) => item.id === sceneId);
    const destinationTab = activeTab === "overview" && scene
      ? preparationStartTab(scene, activeEpisode)
      : activeTab;
    setParams({ projectId: currentProject?.id || queryProjectId || "", episodeId: activeEpisode?.id || activeEpisodeId || "", sceneId, tab: destinationTab, ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}) });
  };

  const selectTab = (tab: ProductionPreparationTab) => {
    setParams({ projectId: currentProject?.id || queryProjectId || "", episodeId: activeEpisode?.id || activeEpisodeId || "", ...(activeSceneId ? { sceneId: activeSceneId } : {}), tab, ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}) });
  };
  const selectEpisode = (episodeId: string, destination: ProductionPreparationTab = activeTab === "overview" ? "overview" : "breakdown") => {
    setParams({ projectId: currentProject?.id || queryProjectId || "", episodeId, tab: destination, ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}) });
  };

  const goToNextTodoScene = () => {
    if (!currentProject || !activeEpisode) return;
    const nextSceneId = nextIncompleteProductionSceneId(scenes, activeSceneId, (scene) => {
      const filmTeam = buildManualFilmTeamReadModel({
        project: currentProject,
        episode: activeEpisode,
        requiredDepartments: recommendedDepartmentsForScene(scene),
      });
      const assets = buildManualProductionAssetReadModel({ project: currentProject, episode: activeEpisode, scene, episodes: productionFullEpisodes, filmTeam });
      return buildProductionPreparationCurrentTask({ scene, filmTeam, assets }).state === "attention";
    });
    if (nextSceneId) selectScene(nextSceneId);
  };
  const goToNextIncompleteBreakdown = () => {
    if (nextIncompleteBreakdownScene) selectScene(nextIncompleteBreakdownScene.id);
  };
  const openStoryboard = () => {
    if (!activeEpisode || !activeScene) return;
    navigate(`/production/storyboard?${new URLSearchParams({ projectId: currentProject!.id, episodeId: activeEpisode.id, sceneId: activeScene.id, ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}) })}`);
  };
  const remainingBreakdownCount = scenes.filter((scene) => workspaceBreakdownStatus(scene) !== "已确认").length;
  const allBreakdownsReady = remainingBreakdownCount === 0;

  if (isRequestedProjectPending || (!currentProject && isLoading)) return <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!currentProject) return <EmptyState title="选择制片项目" description="先从导演制片入口导入剧本，查看场次与资产。" actionLabel="返回导演制片" onAction={() => navigate("/production")} />;
  if (!isResolvingEpisodes && !productionEpisodes.length) return <EmptyState title="没有可制片单元" description="当前项目没有可读取的剧本来源。请从导演制片项目库重新导入剧本。" actionLabel="返回导演制片" onAction={() => navigate("/production")} />;
  if (isLoading || isResolvingEpisodes || !activeEpisode || !productionEpisodes.some((episode) => episode.id === activeEpisode.id) || (queryEpisodeId && queryEpisodeId !== activeEpisode.id && productionEpisodes.some((episode) => episode.id === queryEpisodeId))) return <div className="flex h-full items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const filmTeam = preparationContext?.filmTeam;
  const assets = preparationContext?.assets;
  const assetPackConfirmed = activeScene && assets
    ? Boolean(activeScene.productionPreparation?.assetPack)
    : false;
  const assetStateBlocker = assets?.issues.find((issue) => issue.severity === "blocking")?.message;
  const assetPackConfirmBlockedReason = assetStateBlocker;
  const confirmAssetPack = async (confirmedAssetPackHash?: string) => {
    if (assetPackConfirmBlockedReason) throw new Error(assetPackConfirmBlockedReason);
    if (!activeScene || !assets) return;
    await updateScene(activeScene.id, {
      productionPreparation: {
        ...(activeScene.productionPreparation || { schemaVersion: "production-preparation.v1", sceneId: activeScene.id }),
        assetPack: { sourceHash: confirmedAssetPackHash || assets.assetPackHash, confirmedAt: Date.now() },
        updatedAt: Date.now(),
      },
    }, activeEpisode.id);
  };
  return (
    <main className="flex flex-col bg-bg-primary text-text-primary">
      <header className="shrink-0 bg-bg-primary border-b border-border-soft/10 py-4 z-20">
        <div className="mx-auto flex min-h-[48px] w-full max-w-7xl flex-wrap items-center gap-3 px-4 md:px-8">
          {/* Left Column - Fixed Width to guarantee absolute alignment of tabs */}
          <div className="z-10 min-w-0 flex-1 md:w-[260px] md:flex-none">
            <div className="flex items-center gap-2 text-[10px] font-bold text-text-muted uppercase tracking-wider">
              <button type="button" onClick={() => navigate(interactiveReturnTo || "/production")} className="hover:text-gold transition-colors cursor-pointer flex items-center gap-1">
                <ChevronLeft className="h-3 w-3" />
                {interactiveReturnTo ? '互动制片' : '导演制片'}
              </button>
              <ChevronRight className="h-3 w-3" />
              <span>剧本与场次</span>
            </div>
            <h1 className="mt-1 truncate text-base font-bold tracking-tight text-text-primary" title={currentProject.title}>
              {currentProject.title}
            </h1>
          </div>

          {/* Workflow sub-tabs, aligned with right workspace */}
          <div className="order-last z-0 w-full min-w-0 overflow-x-auto md:order-none md:w-auto md:flex-grow">
            <nav aria-label="场次工作区" className="flex h-10 w-max items-center justify-start gap-1 rounded-xl border border-border-soft/20 bg-bg-surface-soft/60 p-1 select-none">
              {productionPreparationTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                const isDisabled = !activeScene && tab.id !== "overview";
                const status = tabStatuses.find((item) => item.id === tab.id);
                const statusDotBg = status?.state === "complete"
                  ? "bg-emerald-500"
                  : status?.state === "attention"
                    ? "bg-amber-500 animate-pulse"
                    : "bg-text-dark/45";
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => selectTab(tab.id)}
                    className={cn(
                      "relative flex items-center gap-2 h-8 px-4 rounded-lg text-xs font-bold transition-all duration-200",
                      isDisabled
                        ? "text-text-muted/40 cursor-not-allowed opacity-50"
                        : isActive
                          ? "bg-bg-surface text-gold border-border-soft/10 shadow-sm cursor-pointer"
                          : "text-text-muted hover:text-text-primary cursor-pointer"
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", statusDotBg)} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Column - Spacer to keep symmetry */}
          <Button disabled={!activeScene} onClick={openStoryboard} className="ml-auto shrink-0">制作分镜</Button>
        </div>
      </header>
      <div className={cn("mx-auto w-full max-w-7xl flex px-4 pb-8 pt-4 md:px-8 items-start", isSidebarCollapsed ? "" : "gap-6")}>
        <div className={cn(
          "transition-all duration-300 ease-in-out shrink-0 sticky top-28 h-[calc(100vh-140px)] overflow-y-auto custom-scrollbar",
          isSidebarCollapsed ? "w-0 opacity-0 pointer-events-none" : "w-72 opacity-100"
        )}>
          {activeTab === "overview"
            ? <ProductionSourceUnitRail project={currentProject} units={productionEpisodes} activeEpisodeId={activeEpisode.id} activeEpisode={activeEpisode} onSelect={(episodeId) => { selectEpisode(episodeId, activeTab); if (window.matchMedia("(max-width: 767px)").matches) setIsSidebarCollapsed(true); }} onAddUnit={activeTab === "overview" ? () => setNewScriptUnitRequestKey((key) => key + 1) : undefined} />
            : <ProductionSceneRail
                episode={activeEpisode}
                scenes={scenes}
                activeSceneId={activeScene.id}
                onSelect={selectScene}
                onNextTodo={activeTab === "breakdown" ? goToNextIncompleteBreakdown : goToNextTodoScene}
                sourceUnits={productionEpisodes}
                activeEpisodeId={activeEpisode.id}
                unitLabel={currentProject.type === "movie" ? "分段" : "分集"}
                onSelectUnit={(episodeId) => selectEpisode(episodeId, activeTab)}
                activeStepSummaries={activeSceneStepSummaries}
              />}
        </div>
        <div className="flex-1 min-w-0 relative">
          {/* Floating Collapsible Toggle Handle - Placed outside to prevent overflow-hidden clipping */}
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="absolute -left-3 top-6 z-30 flex h-6 w-6 items-center justify-center rounded-full bg-bg-surface border border-border-soft/60 hover:border-border-primary text-text-muted hover:text-text-primary shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer active:scale-95"
            title={isSidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          >
            {isSidebarCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-gold" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>

          <section className="flex w-full flex-col bg-bg-surface border border-border-soft/20 rounded-2xl shadow-sm">
            {isSceneDetailPending && (
              <div role="status" className="border-b border-border-soft/15 px-5 py-3 text-xs font-bold text-gold">
                正在加载当前场次…
              </div>
            )}
            <div className="w-full">
              {activeTab === "overview" && <ProductionSourceOverviewWorkspace project={currentProject} episode={activeEpisode} updateProject={updateProject} onOpenScene={selectScene} onOpenSourceUnit={(episodeId) => selectEpisode(episodeId, "overview")} newUnitRequestKey={newScriptUnitRequestKey} />}
              {<>
                {activeTab === "breakdown" && <ProductionSceneBreakdownWorkspace project={currentProject} episode={activeEpisode} scene={activeScene} updateProject={updateProject} updateScene={updateScene} onContinueBreakdown={goToNextIncompleteBreakdown} nextBreakdownHref={nextBreakdownHref} nextBreakdownTitle={nextIncompleteBreakdownScene?.title} allBreakdownsReady={allBreakdownsReady} remainingBreakdownCount={remainingBreakdownCount} onNext={() => selectTab("assets")} />}
                {activeTab === "assets" && (<div className="w-full px-3 py-5 sm:px-8 sm:py-7"><ManualProductionAssetsPanel project={currentProject} episode={activeEpisode} episodes={productionFullEpisodes} scene={activeScene} updateProject={updateProject} updateScene={updateScene} filmTeam={filmTeam} onConfirmAssetPack={confirmAssetPack} assetPackConfirmed={assetPackConfirmed} assetPackConfirmBlockedReason={assetPackConfirmBlockedReason} sceneBindingOnly onOpenProjectAsset={(assetId) => navigate(`/production/assets?${new URLSearchParams({ projectId: currentProject.id, episodeId: activeEpisode.id, sceneId: activeScene.id, ...(assetId ? { assetId } : {}), ...(interactiveReturnTo ? { returnTo: interactiveReturnTo } : {}) })}`)} embedded /></div>)}
              </>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
