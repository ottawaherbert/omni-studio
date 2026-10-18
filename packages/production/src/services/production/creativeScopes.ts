import type { Episode, EpisodeMeta, Project, Scene, Shot } from "../../../../../src/types/project";
import type { CreativeDirectionBindings, CreativeScope } from "../../../../domain/src/creativeDirection";

export interface ProductionCreativeScope {
  episode?: Episode | EpisodeMeta;
  scene?: Scene;
  shot?: Shot;
  request?: CreativeDirectionBindings;
  dialogueLineIndex?: number;
}

export function productionCreativeScopes(project: Partial<Project>, scope: ProductionCreativeScope = {}): CreativeScope[] {
  return [
    { label: "全剧", bindings: project.creativeDirection },
    { label: "本集", bindings: scope.episode?.creativeDirection },
    { label: "本场", bindings: scope.scene?.creativeDirection },
    { label: "本镜", bindings: scope.shot?.creativeDirection },
    { label: "本次", bindings: scope.request },
  ];
}
