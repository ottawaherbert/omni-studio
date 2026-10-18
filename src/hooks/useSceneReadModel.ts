import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectStore } from "../clients/stateClient";
import { resolveSceneReadModel } from "../utils/sceneReadModel";

export function useSceneReadModel() {
  const { currentProject, activeEpisode } = useProjectStore(useShallow((state) => ({
    currentProject: state.currentProject,
    activeEpisode: state.activeEpisode,
  })));

  return useMemo(
    () => resolveSceneReadModel(currentProject, activeEpisode),
    [
      currentProject?.projectModel,
      currentProject?.interactiveTemplate,
      activeEpisode?.id,
      activeEpisode?.gameData,
      activeEpisode?.scenes,
    ],
  );
}
