/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Toaster } from "react-hot-toast";
import Layout from "./components/Layout";
import { RETIRED_WORKSPACE_PATHS, retiredWorkspaceHref } from "./utils/retiredWorkspaceRoutes";
import ManualAIRequestHost from "./components/ManualAIRequestHost";

function RetiredWorkspaceRedirect() {
  const location = useLocation();
  const activeProjectId = useProjectStore(state => state.currentProject?.id);
  return <Navigate to={retiredWorkspaceHref(location.pathname, location.search, activeProjectId || readActiveProjectId()) + location.hash} replace />;
}

function LegacyAutoStudioRedirect() {
  const location = useLocation();
  const { projectId } = useParams();
  const params = new URLSearchParams(location.search);
  if (projectId && !params.has("projectId")) params.set("projectId", projectId);
  const query = params.toString();
  return <Navigate to={`/production/preparation${query ? `?${query}` : ""}`} replace />;
}

function LegacyNewProjectRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return <Navigate to={params.get("projectModel") === "interactive" ? "/interactive/new" : "/writing"} replace />;
}
import Login from "./pages/Login";
import { useProjectStore } from "./store/useProjectStore";
import { useSettingsStore } from "./store/useSettingsStore";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DevRouteProfiler } from "./components/DevRouteProfiler";
import { readActiveProjectId, resolveWorkspaceProjectId } from "./utils/activeProjectStorage";

const ImageGen = lazy(() => import("./pages/ImageGen"));
const ShotAnalysis = lazy(() => import("./pages/ShotAnalysis"));
const Assets = lazy(() => import("./pages/Assets"));
const Settings = lazy(() => import("./pages/Settings"));
const Guide = lazy(() => import("./pages/Guide"));
const SkillLibrary = lazy(() => import("./pages/SkillLibrary"));
const ScriptWorkspace = lazy(() => import("../apps/web/src/features/script/ScriptWorkspace"));
const Storyboard = lazy(() => import("./pages/Storyboard"));
const Studio = lazy(() => import("./pages/Studio"));
const ProductionMagicImportPage = lazy(() => import("./components/production/ProductionMagicImportPage").then(module => ({ default: module.ProductionMagicImportPage })));
const DirectorProduction = lazy(() => import("./pages/DirectorProduction"));
const ProductionProjectLibrary = lazy(() => import("./pages/ProductionProjectLibrary"));
const ProductionPreparation = lazy(() => import("./pages/ProductionPreparation"));
const ProductionAssets = lazy(() => import("./pages/ProductionAssets"));
const ProductionAssetProfile = lazy(() => import("./pages/ProductionAssetProfile"));
const InteractiveProduction = lazy(() => import("./pages/InteractiveProduction"));
const NewInteractiveProjectWizard = lazy(() => import("./pages/NewInteractiveProjectWizard"));
const InteractiveProductionWorkspace = lazy(() => import("./pages/InteractiveProductionWorkspace"));
const InteractiveGraphWorkspace = lazy(() => import("./pages/InteractiveGraphWorkspace"));
const InteractivePlaytestPlayer = lazy(() => import("./pages/InteractivePlaytestPlayer"));

const RouteFallback = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-sm font-medium text-text-muted">
    正在打开工作区...
  </div>
);

const PROJECT_WORKSPACE_ROUTES = ["/production"];

const shouldRestoreActiveProject = (path: string) =>
  path !== "/production/library"
  && path !== "/production/import"
  && PROJECT_WORKSPACE_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));

function ProjectCatalogLoader() {
  const location = useLocation();
  const fetchProjects = useProjectStore((state) => state.fetchProjects);
  const projectCount = useProjectStore((state) => state.projects.length);
  const hasRequestedProject = new URLSearchParams(location.search).has("projectId");

  useEffect(() => {
    if (
      projectCount === 0
      && !hasRequestedProject
      && (shouldRestoreActiveProject(location.pathname) || location.pathname === "/image-gen")
    ) {
      void fetchProjects();
    }
  }, [fetchProjects, hasRequestedProject, location.pathname, projectCount]);

  return null;
}

export default function App() {
  const { projects, currentProject, loadProject } = useProjectStore();
  const { theme } = useSettingsStore();
  const restoredProjectIdRef = useRef<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem("isAuthenticated") === "true";
  });

  useEffect(() => {
    if (currentProject) return;
    const params = new URLSearchParams(window.location.search);
    const projectId = resolveWorkspaceProjectId({
      projects,
      requestedProjectId: params.get("projectId"),
      requestedEpisodeId: params.get("episodeId"),
      storedProjectId: readActiveProjectId(),
    });
    if (!projectId || restoredProjectIdRef.current === projectId) return;
    if (!shouldRestoreActiveProject(window.location.pathname)) return;
    restoredProjectIdRef.current = projectId;
    const isStoryboardWorkspace = window.location.pathname === "/production/storyboard"
      || window.location.pathname === "/production/studio";
    const isCompositeStoryboardMode = params.get("videoMode") === "storyboard";
    const episodeView = window.location.pathname === "/production/preparation"
      ? "production-preparation"
      : isStoryboardWorkspace
        ? isCompositeStoryboardMode ? "storyboard" : "storyboard-index"
        : undefined;
    void loadProject(projectId, {
      episodeView,
      sceneId: episodeView ? params.get("sceneId") || undefined : undefined,
      shotId: episodeView === "storyboard-index"
        ? params.get("shotId") || undefined
        : undefined,
    });
  }, [currentProject, loadProject, projects]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  const handleLogin = () => {
    setIsAuthenticated(true);
    localStorage.setItem("isAuthenticated", "true");
  };

  if (!isAuthenticated) {
    return (
      <BrowserRouter>
        <Toaster position="bottom-right" toastOptions={{
          duration: 2500,
          className: 'dark:bg-neutral-900 dark:text-white dark:border-neutral-800 bg-white text-gray-900 border-gray-200 shadow-2xl rounded-2xl font-medium text-sm',
          style: {
            padding: '12px 20px',
          }
        }} />
        <Routes>
          <Route path="*" element={<Login onLogin={handleLogin} />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <ManualAIRequestHost />
      <ProjectCatalogLoader />
      <Toaster position="bottom-right" toastOptions={{
        duration: 2500,
        className: 'dark:bg-neutral-900 dark:text-white dark:border-neutral-800 bg-white text-gray-900 border-gray-200 shadow-2xl rounded-2xl font-medium text-sm',
        style: {
          padding: '12px 20px',
        }
      }} />
      <ErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/writing" replace />} />
            <Route path="projects" element={<Navigate to="/writing" replace />} />
            <Route path="new-project" element={<Navigate to="/writing" replace />} />
            <Route path="legacy/new-project" element={<LegacyNewProjectRedirect />} />
            <Route path="image-gen" element={<ImageGen />} />
            <Route path="shot-analysis" element={<ShotAnalysis />} />
            <Route path="assets" element={<Assets />} />
            <Route path="settings" element={<Settings />} />
            <Route path="guide" element={<Guide />} />
            <Route path="writing" element={<ScriptWorkspace />} />
            <Route path="writing/library" element={<ScriptWorkspace />} />
            <Route path="skills" element={<SkillLibrary />} />
            <Route path="auto-studio" element={<LegacyAutoStudioRedirect />} />
            <Route path="projects/:projectId/auto-studio" element={<LegacyAutoStudioRedirect />} />
            <Route path="projects/:projectId/auto-studio/audit" element={<LegacyAutoStudioRedirect />} />
            {RETIRED_WORKSPACE_PATHS.map(path => <Route key={path} path={path} element={<RetiredWorkspaceRedirect />} />)}
            <Route path="production" element={<DirectorProduction />} />
            <Route path="production/import" element={<ProductionMagicImportPage />} />
            <Route path="production/library" element={<ProductionProjectLibrary />} />
            <Route path="production/preparation" element={<DevRouteProfiler id="production-preparation"><ProductionPreparation /></DevRouteProfiler>} />
            <Route path="production/assets" element={<ProductionAssets />} />
            <Route path="production/assets/character/:characterId" element={<ProductionAssetProfile />} />
            <Route path="production/assets/asset/:assetId" element={<ProductionAssetProfile />} />
            <Route path="production/storyboard" element={<DevRouteProfiler id="storyboard"><Storyboard /></DevRouteProfiler>} />
            <Route path="production/studio" element={<DevRouteProfiler id="studio"><Studio /></DevRouteProfiler>} />
            <Route path="interactive" element={<InteractiveProduction />} />
            <Route path="interactive/new" element={<NewInteractiveProjectWizard />} />
            <Route path="interactive/experiences/:experienceId/graph" element={<InteractiveGraphWorkspace />} />
            <Route path="interactive/experiences/:experienceId/bindings" element={<Navigate to="../graph" replace />} />
            <Route path="interactive/experiences/:experienceId/production" element={<InteractiveProductionWorkspace />} />
            <Route path="interactive/experiences/:experienceId/playtest" element={<InteractivePlaytestPlayer />} />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
