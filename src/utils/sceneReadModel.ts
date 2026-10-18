import { Episode, Project, Scene } from "../types/project";
import { applyInteractiveProjectionSync } from "./interactiveNodeSceneMapper";

export type SceneReadSource =
  | "episode.scenes"
  | "interactive.gameData_projection"
  | "missing_episode";

export interface SceneReadModel {
  scenes: Scene[];
  source: SceneReadSource;
  sourceLabel: string;
  writeTarget: "episode.scenes" | "episode.gameData.nodes";
  mode: "linear" | "interactive";
  projectionSynced: boolean;
  projectionIssueCount: number;
}

export const resolveSceneReadModel = (
  project?: Pick<Project, "projectModel" | "interactiveTemplate"> | null,
  episode?: Episode | null,
): SceneReadModel => {
  if (!episode) {
    return {
      scenes: [],
      source: "missing_episode",
      sourceLabel: "未选择段落",
      writeTarget: "episode.scenes",
      mode: project?.projectModel === "interactive" ? "interactive" : "linear",
      projectionSynced: false,
      projectionIssueCount: 0,
    };
  }

  const isInteractive = project?.projectModel === "interactive" || Boolean(project?.interactiveTemplate);
  if (isInteractive && episode.gameData?.nodes?.length) {
    const projection = applyInteractiveProjectionSync(episode.gameData, episode.scenes || []);
    const projectionIssueCount =
      projection.removedOrphanSceneCount +
      Object.keys(projection.nodeUpdates || {}).length +
      Math.abs((episode.scenes || []).filter((scene) => scene.sourceNodeId || scene.id).length - projection.scenes.length);
    return {
      scenes: projection.scenes,
      source: "interactive.gameData_projection",
      sourceLabel: "gameData 事实源 -> Scene 投影",
      writeTarget: "episode.gameData.nodes",
      mode: "interactive",
      projectionSynced: projectionIssueCount === 0,
      projectionIssueCount,
    };
  }

  return {
    scenes: episode.scenes || [],
    source: "episode.scenes",
    sourceLabel: "episode.scenes",
    writeTarget: "episode.scenes",
    mode: isInteractive ? "interactive" : "linear",
    projectionSynced: true,
    projectionIssueCount: 0,
  };
};
