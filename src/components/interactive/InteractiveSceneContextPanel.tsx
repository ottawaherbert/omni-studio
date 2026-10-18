import React from "react";
import { Film, Flag } from "lucide-react";

import type { Episode, Project, Scene } from "../../clients/domainTypes";

interface InteractiveSceneContextPanelProps {
  project: Project;
  episode: Episode;
  scene: Scene;
  compact?: boolean;
}

/**
 * Read-only compatibility label for the shared production workspace.
 * The whiteboard remains the authoring source; production only needs to tell
 * the author which story segment is currently being produced.
 */
export const InteractiveSceneContextPanel: React.FC<InteractiveSceneContextPanelProps> = ({
  project,
  episode,
  scene,
  compact = false,
}) => {
  const gameData = episode.gameData;
  if (project.projectModel !== "interactive" || !gameData) return null;

  const nodeId = scene.sourceNodeId || scene.id;
  const node = gameData.nodes.find((item) => item.id === nodeId);
  if (!node) return null;

  return (
    <div className="border border-gold/20 bg-gold/5 px-3 py-2.5 text-text-secondary">
      <div className="flex min-w-0 items-center gap-2">
        {node.isEnding
          ? <Flag className="h-4 w-4 shrink-0 text-gold" />
          : <Film className="h-4 w-4 shrink-0 text-gold" />}
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-gold">{node.isEnding ? "正在制作结局" : "正在制作故事片段"}</p>
          <p className="truncate text-xs font-semibold text-text-primary">{node.title || scene.title}</p>
          {!compact && node.sceneGoal && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-text-muted">{node.sceneGoal}</p>
          )}
        </div>
      </div>
    </div>
  );
};
