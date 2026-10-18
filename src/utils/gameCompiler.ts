import { GameProjectData } from "../types/game";
import { Scene } from "../types/project";
import { compileGameToInteractiveScenes } from "./interactiveNodeSceneMapper";

/**
 * Backward-compatible name used by existing pages.
 * Interactive projects are no longer flattened into a single path: every node
 * is projected as a Node Scene, ordered by graph traversal.
 */
export function compileGameToLinearScenes(
  data: GameProjectData,
  _episodeId: string,
  existingScenes: Scene[] = [],
): Scene[] {
  return compileGameToInteractiveScenes(data, existingScenes);
}
