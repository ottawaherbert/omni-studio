import type { Project } from "../../../../src/types/project";
import { useProjectStore } from "../../../../src/store/useProjectStore";

export { flushDebouncedProjectSave } from "../../../../src/store/slices/projectSlice";

export const replaceCurrentProjectSnapshot = (project: Project) => {
  const state = useProjectStore.getState();
  if (state.currentProject?.id !== project.id) return false;
  // Asset candidate endpoints return updated project metadata without episodes.
  // Keep the already loaded episode index so adopting an image does not erase
  // scene usage from the UI. An explicitly returned empty list is authoritative.
  const snapshot = { ...project, episodes: project.episodes ?? state.currentProject.episodes };
  useProjectStore.setState({
    currentProject: snapshot,
    projects: state.projects.map((item) => item.id === project.id ? snapshot : item),
  });
  return true;
};

export * from "../../../../src/features/legacy/legacyStores";
export * from "../../../../src/store/useAIConfigStore";
export * from "../../../../src/store/useGameStore";
export * from "../../../../src/store/useGlobalStore";
export * from "../../../../src/store/usePromptStore";
export * from "../../../../src/store/useSettingsStore";
export * from "../../../../src/store/useSkillStore";
export * from "../../../../src/store/useSpatialStore";
export * from "../../../../src/store/useVideoAnalysisStore";
