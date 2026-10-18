import type { Episode, Project, Scene, Shot } from "../../../../../src/types/project";
import type { VisualProjectionTarget } from "../../../../domain/src/visualArtifact";
import {
  AssetReferencePack,
  PerformanceBeat,
  SceneVisualPack,
  StoryboardBoard,
  StoryboardDepartmentRefDepartment,
  StoryboardDepartmentPrepRef,
  VideoGenerationUnit,
  VideoStoryboardArtifactIssue,
  validateVideoStoryboardPlan,
} from "./videoStoryboardArtifacts";
import { buildProductionAssetReferencePackDrafts } from "./videoStoryboardPromptPacks";
import { buildProductionSceneVisualPackDrafts } from "./videoStoryboardSceneVisualPacks";
import { buildProductionStoryboardBoardDrafts } from "./videoStoryboardStageBoards";
import type { DepartmentPrepPackage } from "./productionPrep";
import {
  StoryboardDepartmentPrepRefSet,
  missingStoryboardDepartmentPrepRefs,
  renderStoryboardDepartmentPrepRefNotes,
  sceneNeedsPerformancePrep,
  storyboardDepartmentLabel,
} from "./videoStoryboardDepartmentRefs";
import { resolveVisualStyleLock } from "./visualStyleLock";
import {
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
} from "./visualStyleProjection";

export interface ProductionVideoGenerationUnitDrafts {
  performanceBeats: PerformanceBeat[];
  storyboardBoards: StoryboardBoard[];
  sceneVisualPacks: SceneVisualPack[];
  assetReferencePacks: AssetReferencePack[];
  videoGenerationUnits: VideoGenerationUnit[];
  issues: VideoStoryboardArtifactIssue[];
}

export interface ProductionVideoGenerationUnitDraftOptions {
  departmentPrepPackages?: DepartmentPrepPackage[];
  requireDepartmentPrepRefs?: boolean;
}

const clean = (value: unknown) => String(value || "").trim();

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

const uniqueIssues = (issues: VideoStoryboardArtifactIssue[]) => {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.severity}:${issue.code}:${issue.target}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const shotByIdMap = (episodes: Episode[]) => {
  const map = new Map<string, { episode: Episode; scene: Scene; shot: Shot }>();
  for (const episode of episodes) {
    for (const scene of episode.scenes || []) {
      for (const shot of scene.shots || []) {
        if (shot.id) map.set(shot.id, { episode, scene, shot });
      }
    }
  }
  return map;
};

const sceneByIdMap = (episodes: Episode[]) => {
  const map = new Map<string, Scene>();
  for (const episode of episodes) {
    for (const scene of episode.scenes || []) {
      if (scene.id) map.set(scene.id, scene);
    }
  }
  return map;
};

const packBySceneIdMap = (packs: AssetReferencePack[]) => {
  const map = new Map<string, AssetReferencePack>();
  for (const pack of packs) {
    if (pack.sceneId) map.set(pack.sceneId, pack);
  }
  return map;
};

const unitDepartmentRefSet = (
  refs: {
    cameraRefs?: StoryboardDepartmentPrepRef[];
    lightingRefs?: StoryboardDepartmentPrepRef[];
    performanceRefs?: StoryboardDepartmentPrepRef[];
    actionRefs?: StoryboardDepartmentPrepRef[];
  },
): StoryboardDepartmentPrepRefSet => ({
  cinematographyRefs: refs.cameraRefs || [],
  lightingRefs: refs.lightingRefs || [],
  performanceRefs: refs.performanceRefs || [],
  actionRefs: refs.actionRefs || [],
});

const sceneNeedsActionPrep = (
  scene: Scene | undefined,
  shotRefs: Array<{ shot: Shot }>,
) => /fight|combat|duel|attack|strike|slash|weapon|sword|blade|battle|impact|stunt|chase|run|rush|fall|jump|throw|打斗|交锋|攻击|反击|斩|刺|剑|刀|兵器|战斗|冲击|爆发|法术|仙术|追逐|奔跑|冲入|冲出|冲向|冲刺|跑向|跑出|跑过|跌倒|跌落|跳下|跃起|摔倒|危险|特技/iu.test([
  scene?.title,
  scene?.description,
  ...shotRefs.flatMap(({ shot }) => [shot.visualAction, shot.blocking, shot.cameraMovement, shot.motivation]),
].filter(Boolean).join(" "));

const requiredDepartmentsForUnit = (
  scene: Scene | undefined,
  shotRefs: Array<{ shot: Shot }>,
): StoryboardDepartmentRefDepartment[] => [
  "cinematography",
  "lighting",
  ...(sceneNeedsPerformancePrep(scene, shotRefs.map(({ shot }) => shot)) ? ["performance_directing" as const] : []),
  ...(sceneNeedsActionPrep(scene, shotRefs) ? ["action_choreography" as const] : []),
];

const mergeRefs = (
  primary: StoryboardDepartmentPrepRef[] | undefined,
  fallback: StoryboardDepartmentPrepRef[] | undefined,
) => {
  const seen = new Set<string>();
  return [...(primary || []), ...(fallback || [])].filter((ref) => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
};

const videoProjectionTargets = (
  project: Project,
  shotRefs: Array<{ shot: Shot }>,
): VisualProjectionTarget[] => {
  const assetIds = unique(shotRefs.flatMap(({ shot }) => [
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
  ]));
  const entityTargets = assetIds.flatMap<VisualProjectionTarget>((assetId) => {
    if (project.characters.some((character) => character.id === assetId)) {
      return [{ entityType: "character" as const, entityId: assetId }];
    }
    const asset = project.assets.find((entry) => entry.id === assetId);
    if (!asset) return [];
    return [{
      entityType: asset.type === "location" ? "location" as const : asset.type === "vfx" ? "vfx" as const : "prop" as const,
      entityId: assetId,
    }];
  });
  const layerTargets = unique(shotRefs.flatMap(({ shot }) => shot.activeVisualLayerIds || []))
    .map((layerId) => ({ layerId }));
  return [...entityTargets, ...layerTargets];
};

const videoStyleProjectionForUnit = (
  project: Project,
  shotRefs: Array<{ shot: Shot }>,
) => {
  const projection = projectVisualStyleForArtifact({
    styleLock: project.visualStyleLock?.humanApprovalState === "rejected"
      ? undefined
      : project.visualStyleLock,
    intent: "video_clip",
    targets: videoProjectionTargets(project, shotRefs),
    shotOverride: shotRefs.length === 1 ? shotRefs[0].shot.visualOverride : undefined,
  });
  const assignmentTargetLabels = Object.fromEntries(projection.mediumAssignments.map((assignment) => {
    const target = assignment.target;
    if (target.scope === "whole") return [assignment.id, "整个视频画面"];
    if (target.scope === "layer") return [assignment.id, `图层“${target.label}”：${target.description}`];
    const targetName = target.entityType === "character"
      ? project.characters.find((entry) => entry.id === target.entityId)?.name
      : project.assets.find((entry) => entry.id === target.entityId)?.name;
    return [assignment.id, targetName || "当前视频主体"];
  }));
  return renderVisualStyleProjectionInstruction(projection, { assignmentTargetLabels });
};

const framePromptForBoard = (
  project: Project,
  board: StoryboardBoard,
  scene: Scene | undefined,
  shotRefs: Array<{ shot: Shot }>,
  departmentRefs?: StoryboardDepartmentPrepRefSet,
) => {
  const styleLock = resolveVisualStyleLock(project);
  const shotPrompts = shotRefs
    .map(({ shot }, index) => clean(shot.videoPrompt || shot.visualAction || shot.blocking) ? `${index + 1}. ${clean(shot.videoPrompt || shot.visualAction || shot.blocking)}` : "")
    .filter(Boolean);
  return [
    `视频生成单元：${scene?.title || board.sceneId}`,
    `时长：${board.strategyDecision.expectedVideoUnitDurationSeconds}s；画幅和模型能力以 ${board.strategyDecision.selectedModelProfileId} 为准。`,
    `首帧：${board.startState}`,
    `尾帧：${board.endState}`,
    `故事板：参考 ${board.id}，${board.layout}，箭头 legend=${board.arrowLegendIds.join(", ")}。`,
    `项目风格锁版本：${board.styleLockVersion || styleLock.version || "unversioned"}。`,
    departmentRefs && renderStoryboardDepartmentPrepRefNotes(departmentRefs)
      ? `专业部门约束：\n${renderStoryboardDepartmentPrepRefNotes(departmentRefs)}`
      : "",
    `镜头/动作：${shotPrompts.join("；") || board.panels.map((panel) => panel.visualBeat).join("；")}`,
    "保持角色身份、服装/变体、场景空间、道具归属、轴线、视线和动作方向连续。",
  ].filter(Boolean).join("\n");
};

const buildUnits = (
  project: Project,
  episodes: Episode[],
  boards: StoryboardBoard[],
  packs: AssetReferencePack[],
): VideoGenerationUnit[] => {
  const shotMap = shotByIdMap(episodes);
  const sceneMap = sceneByIdMap(episodes);
  const packMap = packBySceneIdMap(packs);

  const units = boards.flatMap((board) => {
    const pack = packMap.get(board.sceneId);
    if (!pack) return [];
    const shotRefs = board.shotIds
      .map((shotId) => shotMap.get(shotId))
      .filter((ref): ref is { episode: Episode; scene: Scene; shot: Shot } => Boolean(ref));
    const scene = sceneMap.get(board.sceneId);
    const departmentRefs = unitDepartmentRefSet({
      cameraRefs: mergeRefs(board.cinematographyRefs, pack.cameraRefs),
      lightingRefs: mergeRefs(board.lightingRefs, pack.lightingRefs),
      performanceRefs: mergeRefs(board.performanceRefs, pack.performanceRefs),
      actionRefs: mergeRefs(board.actionRefs, pack.actionRefs),
    });
    const visualStyleProjection = videoStyleProjectionForUnit(project, shotRefs);
    const unit: VideoGenerationUnit = {
      id: `${board.id}.video_unit`,
      episodeId: board.episodeId,
      sceneId: board.sceneId,
      modelProfileId: board.strategyDecision.selectedModelProfileId,
      durationSeconds: board.strategyDecision.expectedVideoUnitDurationSeconds,
      performanceBeatIds: board.performanceBeatIds,
      storyboardBoardId: board.id,
      assetReferencePackId: pack.id,
      shotIds: board.shotIds,
      startState: board.startState,
      endState: board.endState,
      promptTemplateId: "storyboard.videoGenerationUnit.plan",
      videoPrompt: framePromptForBoard(project, board, scene, shotRefs, departmentRefs),
      audioPlan: "当前仅规划视频单元，不生成音频；若后续模型支持对白音频，再由音频/配音阶段绑定。",
      styleLockVersion: board.styleLockVersion || pack.styleLockVersion,
      visualStyleLockRefs: unique([...(board.visualStyleLockRefs || []), ...(pack.visualStyleLockRefs || [])]),
      visualStyleCompileManifest: visualStyleProjection.manifest,
      storyboardStrategyId: board.strategyDraftId || board.strategyDecision.selectedStrategyId,
      storyboardStrategyVersion: board.strategyDraftId ? "draft" : board.strategyDecision.selectedStrategyVersion,
      storyboardStrategyOrigin: board.strategyOrigin || pack.storyboardStrategyOrigin || "built_in",
      annotationLegendIds: board.arrowLegendIds,
      annotationLegendVersion: board.annotationLegendVersion || pack.annotationLegendVersion,
      cameraRefs: departmentRefs.cinematographyRefs,
      lightingRefs: departmentRefs.lightingRefs,
      performanceRefs: departmentRefs.performanceRefs,
      actionRefs: departmentRefs.actionRefs,
    };
    return [unit];
  });

  return units.map((unit, index) => ({
    ...unit,
    previousUnitId: units[index - 1]?.id,
    nextUnitId: units[index + 1]?.id,
  }));
};

export const buildProductionVideoGenerationUnitDrafts = (
  project: Project,
  episodes: Episode[],
  options: ProductionVideoGenerationUnitDraftOptions = {},
): ProductionVideoGenerationUnitDrafts => {
  const storyboardDrafts = buildProductionStoryboardBoardDrafts(project, episodes, options);
  const sceneVisualPackDrafts = buildProductionSceneVisualPackDrafts(project, episodes);
  const packDrafts = buildProductionAssetReferencePackDrafts(project, episodes, sceneVisualPackDrafts.sceneVisualPacks, options);
  const boardsBySceneId = new Map<string, StoryboardBoard[]>();
  for (const board of storyboardDrafts.storyboardBoards) {
    boardsBySceneId.set(board.sceneId, [...(boardsBySceneId.get(board.sceneId) || []), board]);
  }
  const assetReferencePacks = packDrafts.assetReferencePacks.map((pack) => {
    const sceneBoards = pack.sceneId ? boardsBySceneId.get(pack.sceneId) || [] : [];
    const strategyOrigins = unique(sceneBoards.map((board) => board.strategyOrigin || "built_in"));
    return {
      ...pack,
      storyboardStrategyIds: unique(sceneBoards.flatMap((board) => [
        board.strategyDraftId,
        board.strategyDecision.selectedStrategyId,
      ])),
      storyboardStrategyOrigin: strategyOrigins.length === 1
        ? strategyOrigins[0] as StoryboardBoard["strategyOrigin"]
        : undefined,
    };
  });
  const videoGenerationUnits = buildUnits(project, episodes, storyboardDrafts.storyboardBoards, assetReferencePacks);
  const shotMap = shotByIdMap(episodes);
  const sceneMap = sceneByIdMap(episodes);
  const includeDepartmentRefIssues = Boolean(options.departmentPrepPackages?.length) || options.requireDepartmentPrepRefs;
  const departmentRefIssues: VideoStoryboardArtifactIssue[] = includeDepartmentRefIssues
    ? videoGenerationUnits.flatMap((unit) => {
        const scene = sceneMap.get(unit.sceneId);
        const shotRefs = unit.shotIds
          .map((shotId) => shotMap.get(shotId))
          .filter((ref): ref is { episode: Episode; scene: Scene; shot: Shot } => Boolean(ref));
        return missingStoryboardDepartmentPrepRefs(
          unitDepartmentRefSet(unit),
          requiredDepartmentsForUnit(scene, shotRefs),
        ).map((department) => ({
          severity: options.requireDepartmentPrepRefs ? "blocking" : "warning",
          code: "VIDEO_UNIT_DEPARTMENT_REFS_MISSING",
          target: `videoGenerationUnit.${unit.id}.${department}`,
          message: `${scene?.title || unit.sceneId} 的视频生成单元缺少${storyboardDepartmentLabel(department)}部门 prep 引用，媒体生成计划不能确认已继承正式制片约束。`,
        }));
      })
    : [];
  const planIssues = validateVideoStoryboardPlan({
    performanceBeats: storyboardDrafts.performanceBeats,
    storyboardBoards: storyboardDrafts.storyboardBoards,
    sceneVisualPacks: sceneVisualPackDrafts.sceneVisualPacks,
    assetReferencePacks,
    videoGenerationUnits,
  });

  return {
    performanceBeats: storyboardDrafts.performanceBeats,
    storyboardBoards: storyboardDrafts.storyboardBoards,
    sceneVisualPacks: sceneVisualPackDrafts.sceneVisualPacks,
    assetReferencePacks,
    videoGenerationUnits,
    issues: uniqueIssues([
      ...storyboardDrafts.issues,
      ...sceneVisualPackDrafts.issues,
      ...packDrafts.issues,
      ...departmentRefIssues,
      ...planIssues,
    ]),
  };
};
