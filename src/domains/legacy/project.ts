import type { Episode, Project, Scene } from "../../types/project";

export type LegacyProject = Project;
export type LegacyEpisode = Episode;
export type LegacyScene = Scene;

export const LEGACY_PROJECT_NAMESPACE = "legacy.project.v1";

export interface LegacyReadOnlyCompatibleField {
  path: string;
  owner: "legacy" | "writing-import" | "production-import";
  note: string;
}

export const legacyReadOnlyCompatibleFields: LegacyReadOnlyCompatibleField[] = [
  {
    path: "Project.id/title/type/logline/coreConflict/targetEpisodeCount",
    owner: "legacy",
    note: "旧项目列表、打开和迁移报告可读取；新剧本项目 不继承这些字段名。",
  },
  {
    path: "Project.characters/worldBuildingRules/episodes",
    owner: "writing-import",
    note: "只作为导入 Writing 的源数据，导入后落到 characters、lore、units/scenes/blocks。",
  },
  {
    path: "Scene.scriptBlocks/description/title/characters",
    owner: "writing-import",
    note: "只作为剧本文本和场次梗概来源；不把制片拆解字段写回 Writing。",
  },
  {
    path: "Scene.breakdown/shots/audioTracks/assets/visualStyleLock",
    owner: "production-import",
    note: "只作为导入 Production 或迁移报告来源；Writing 域不得读取或保存。",
  },
];

export const legacyNamespaceRules = [
  "Legacy types are read-only compatibility aliases.",
  "New script features use packages/script and scriptClient.",
  "New Production features must use production domain types or import packages.",
  "Legacy Project/Episode/Scene fields may be mapped by adapters but not expanded for new capabilities.",
];
