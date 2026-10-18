import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { useProjectStore } from "../../clients/stateClient";
import { scriptClient } from "../../../apps/web/src/clients/scriptClient";
import type { ScriptProjectSummary } from "../../../packages/domain/src/scriptDelivery";
import { createLegacyProductionProjectFromWritingSource } from "../../services/production/writingExportLegacyAdapter";
import type { Project } from "../../types/project";

const projectUpdatedAt = (project: Project) => {
  const dynamicUpdatedAt = (project as { updatedAt?: string | number }).updatedAt;
  return project.productionSourceSnapshot?.importedAt
    || (dynamicUpdatedAt ? new Date(dynamicUpdatedAt).getTime() : 0)
    || Number(project.id)
    || 0;
};

const projectSourceKey = (project: Project) => {
  const snapshot = project.productionSourceSnapshot;
  return snapshot?.sourceType === "writing_export"
    ? `writing:${snapshot.sourceWritingProjectId}`
    : `project:${project.id}`;
};

const isProductionProject = (project: Project) =>
  project.projectModel !== "interactive" && Boolean(project.productionSourceSnapshot || project.isFromAdaptation);

const productionProjectContentScore = (project: Project) => {
  const episodes = project.episodes || [];
  const sceneCount = episodes.reduce((count, episode: any) => (
    count + (episode.sceneCount ?? episode.scenes?.length ?? 0)
  ), 0);
  return sceneCount > 0 ? 2 : episodes.length > 0 ? 1 : 0;
};

const compareProductionProjects = (left: Project, right: Project) =>
  projectUpdatedAt(right) - projectUpdatedAt(left)
  || productionProjectContentScore(right) - productionProjectContentScore(left);

const uniqueProductionProjectsBySource = (projects: Project[]) => {
  const seenSourceKeys = new Set<string>();
  return projects.filter((project) => {
      const key = projectSourceKey(project);
      if (seenSourceKeys.has(key)) return false;
      seenSourceKeys.add(key);
      return true;
    });
};

export const useProductionProjectLibrary = () => {
  const { projects, fetchProjects, isLoading: isLegacyLoading } = useProjectStore();
  const [writingProjects, setWritingProjects] = useState<ScriptProjectSummary[]>([]);
  const [isWritingLoading, setIsWritingLoading] = useState(false);
  const [writingLoadFailed, setWritingLoadFailed] = useState(false);

  const refresh = useCallback(async () => {
    await fetchProjects();
  }, [fetchProjects]);

  const refreshWritingProjects = useCallback(async () => {
    setIsWritingLoading(true);
    setWritingLoadFailed(false);
    try {
      const result = await scriptClient.listProjects();
      setWritingProjects(result.projects);
    } catch (error) {
      console.error("Failed to load Writing projects:", error);
      setWritingLoadFailed(true);
      setWritingProjects([]);
    } finally {
      setIsWritingLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const productionProjects = useMemo(() => {
    const trashedSourceKeys = new Set(
      projects
        .filter((project) => isProductionProject(project) && Boolean(project.productionTrashedAt))
        .map(projectSourceKey),
    );
    return uniqueProductionProjectsBySource(
      projects
        .filter((project) =>
          isProductionProject(project) && !project.productionTrashedAt && !trashedSourceKeys.has(projectSourceKey(project)),
        )
        .sort(compareProductionProjects),
    );
  }, [projects]);
  const trashedProductionProjects = useMemo(
    () => uniqueProductionProjectsBySource(
      projects
        .filter((project) => isProductionProject(project) && Boolean(project.productionTrashedAt))
        .sort((left, right) => Number(right.productionTrashedAt) - Number(left.productionTrashedAt) || compareProductionProjects(left, right)),
    ),
    [projects],
  );
  const importableWritingProjects = useMemo(
    () => writingProjects.filter((project) => (project.writtenUnitCount || 0) > 0),
    [writingProjects],
  );

  return {
    productionProjects,
    trashedProductionProjects,
    importableWritingProjects,
    isLoading: isLegacyLoading,
    isWritingLoading,
    writingLoadFailed,
    refresh,
    refreshWritingProjects,
  };
};

export const useProductionProjectActions = () => {
  const navigate = useNavigate();
  const { projects, createProject, setProjectTrashState, deleteProject } = useProjectStore();
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);

  const importWritingProject = async (writingProjectId: string) => {
    setBusyProjectId(writingProjectId);
    try {
      const existingProject = projects
        .filter(isProductionProject)
        .sort(compareProductionProjects)
        .find((project) => project.productionSourceSnapshot?.sourceType === "writing_export"
          && project.productionSourceSnapshot.sourceWritingProjectId === writingProjectId);
      if (existingProject) {
        const matchingSourceProjects = projects.filter((project) =>
          isProductionProject(project) && projectSourceKey(project) === projectSourceKey(existingProject),
        );
        if (matchingSourceProjects.some((project) => project.productionTrashedAt)) {
          await Promise.all(matchingSourceProjects.map((project) => setProjectTrashState(project.id, null)));
          toast.success("已从垃圾箱恢复该制片项目");
        }
        navigate(`/production/preparation?projectId=${encodeURIComponent(existingProject.id)}`);
        return true;
      }
      const result = await scriptClient.exportPackage(writingProjectId);
      const productionProject = createLegacyProductionProjectFromWritingSource({
        package: result.package,
        productionProjectId: Date.now().toString(),
        importId: crypto.randomUUID(),
      });
      if (productionProject.productionSourceDocuments?.length === 0) {
        toast.error("该剧本还没有可导入的正文单元");
        return false;
      }
      await createProject(productionProject);
      navigate("/production/preparation");
      return true;
    } catch (error) {
      console.error("Failed to import Writing project into Production:", error);
      toast.error(error instanceof Error ? error.message : "导入系统剧本失败");
      return false;
    } finally {
      setBusyProjectId(null);
    }
  };

  const openProductionProject = async (projectId: string) => {
    setBusyProjectId(projectId);
    try {
      navigate(`/production/preparation?projectId=${encodeURIComponent(projectId)}`);
    } finally {
      setBusyProjectId(null);
    }
  };

  const moveProductionProjectToTrash = async (project: Project) => {
    setBusyProjectId(project.id);
    try {
      const matchingSourceProjects = projects.filter((item) =>
        isProductionProject(item) && projectSourceKey(item) === projectSourceKey(project) && !item.productionTrashedAt,
      );
      await Promise.all(matchingSourceProjects.map((item) => setProjectTrashState(item.id, Date.now())));
      toast.success(`《${project.title}》已移入垃圾箱`);
      return true;
    } catch (error) {
      console.error("Failed to move Production project to trash:", error);
      toast.error(error instanceof Error ? error.message : "移入垃圾箱失败");
      return false;
    } finally {
      setBusyProjectId(null);
    }
  };

  const restoreProductionProject = async (project: Project) => {
    setBusyProjectId(project.id);
    try {
      const matchingSourceProjects = projects.filter((item) =>
        isProductionProject(item) && projectSourceKey(item) === projectSourceKey(project) && Boolean(item.productionTrashedAt),
      );
      await Promise.all(matchingSourceProjects.map((item) => setProjectTrashState(item.id, null)));
      toast.success(`《${project.title}》已恢复到项目库`);
      return true;
    } catch (error) {
      console.error("Failed to restore Production project:", error);
      toast.error(error instanceof Error ? error.message : "恢复项目失败");
      return false;
    } finally {
      setBusyProjectId(null);
    }
  };

  const deleteProductionProjectPermanently = async (project: Project) => {
    setBusyProjectId(project.id);
    try {
      const matchingTrashedProjects = projects.filter((item) =>
        isProductionProject(item) && projectSourceKey(item) === projectSourceKey(project) && Boolean(item.productionTrashedAt),
      );
      await Promise.all(matchingTrashedProjects.map((item) => deleteProject(item.id)));
      toast.success(`《${project.title}》已永久删除`);
      return true;
    } catch (error) {
      console.error("Failed to permanently delete Production project:", error);
      toast.error(error instanceof Error ? error.message : "永久删除项目失败");
      return false;
    } finally {
      setBusyProjectId(null);
    }
  };

  const emptyProductionTrash = async () => {
    setBusyProjectId("production-trash-empty");
    try {
      const trashedProjects = projects.filter((project) =>
        isProductionProject(project) && Boolean(project.productionTrashedAt),
      );
      await Promise.all(trashedProjects.map((project) => deleteProject(project.id)));
      toast.success("垃圾箱已清空");
      return true;
    } catch (error) {
      console.error("Failed to empty Production trash:", error);
      toast.error(error instanceof Error ? error.message : "清空垃圾箱失败");
      return false;
    } finally {
      setBusyProjectId(null);
    }
  };

  const openMagicImport = () => {
    navigate("/production/import");
  };

  return {
    busyProjectId,
    importWritingProject,
    openProductionProject,
    moveProductionProjectToTrash,
    restoreProductionProject,
    deleteProductionProjectPermanently,
    emptyProductionTrash,
    openMagicImport,
  };
};
