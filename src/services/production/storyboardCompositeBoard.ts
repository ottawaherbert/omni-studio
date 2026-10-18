import type {
  ManualStoryboardAgentQuality,
  ManualStoryboardBoard,
  ManualStoryboardBoardWorkflow,
  ManualStoryboardBoardVisualPage,
  ManualStoryboardBoardVisualTake,
  ManualStoryboardShotCell,
  ManualStoryboardShotGridTake,
  Project,
  Scene,
  Shot,
} from "../../types/project";
import type {
  ManualProductionAssetBoard,
  ManualProductionAssetReadModel,
} from "./manualProductionAssets";
import { manualStoryboardHash } from "./manualStoryboard";
import type { StoryboardBoard as ProductionStoryboardBoard } from "./videoStoryboardArtifacts";
import { renderStoryboardBoardPrompt } from "./videoStoryboardTemplateRenderer";
import { STORYBOARD_VIDEO_REFERENCE_SANITIZER_VERSION } from "./productionBoardImageOverlay";
import {
  getStoryboardPromptStrategyById,
  getVideoModelProfileById,
  resolveStoryboardStrategyCoverage,
} from "./videoStoryboardSystem";
import { buildStoryboardUnitVideoPromptRecord } from "./storyboardUnitVideoPrompt";
import { appearanceBoards, appearancePrompt, appearanceVisibleIds } from "./productionAppearance";

export const STORYBOARD_COMPOSITE_BOARD_CONTRACT_VERSION = "storyboard-composite-board.v2";
export const STORYBOARD_COMPOSITE_BOARD_MAX_PANELS_PER_PAGE = 24;
export const STORYBOARD_COMPOSITE_BOARD_MAX_VISUAL_PANELS_PER_PAGE = 24;
export const STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS = 2;
export const STORYBOARD_COMPOSITE_BOARD_QUALITY_THRESHOLD = 90;

const uniqueValues = <T>(values: T[]) => Array.from(new Set(values));

const storyboardPanelFrameShape = (aspectRatio: string) => {
  if (aspectRatio === "9:16" || aspectRatio === "3:4") return "每格使用高大于宽的竖直矩形取景框";
  if (aspectRatio === "1:1") return "每格使用等宽等高的方形取景框";
  return "每格使用宽大于高的横向矩形取景框";
};

export const scopeStoryboardCompositeBoardToPage = (
  board: ManualStoryboardBoard,
  page: ManualStoryboardBoardVisualPage,
): ManualStoryboardBoard => {
  const panelIds = new Set(page.panelIds);
  const panels = board.panels.filter((panel) => panelIds.has(panel.id));
  const shotIds = new Set(panels.map((panel) => panel.shotId));
  return {
    ...board,
    layout: page.layout,
    shotIds: board.shotIds.filter((shotId) => shotIds.has(shotId)),
    panels,
  };
};

const workflowShotIds = (workflow: ManualStoryboardBoardWorkflow) =>
  unique([...(workflow.shotIds || []), ...(workflow.board?.shotIds || []), workflow.shotId]);

const workflowDuration = (workflow: ManualStoryboardBoardWorkflow, shots: Shot[]) => {
  const panelDuration = (workflow.board?.panels || []).reduce(
    (sum, panel) => sum + Number(panel.durationSeconds || 0),
    0,
  );
  const ids = new Set(workflowShotIds(workflow));
  const shotDuration = shots
    .filter((shot) => ids.has(shot.id))
    .reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  return Math.max(panelDuration, shotDuration);
};

const standaloneBoardModes = new Set(["fight_choreography", "dance_choreography", "rhythm_sheet"]);

export const planStoryboardCompositeVideoUnitGroups = ({
  workflows,
  shots,
  limits,
}: {
  workflows: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
  limits?: {
    minDurationSeconds?: number;
    maxDurationSeconds: number;
    supportsMultiShotSingleGeneration: boolean;
  };
}): ManualStoryboardBoardWorkflow[][] => {
  const ordered = shots.flatMap((shot) => {
    const workflow = workflows.find((item) => workflowShotIds(item).includes(shot.id));
    return workflow && workflowShotIds(workflow)[0] === shot.id ? [workflow] : [];
  });
  const groups: ManualStoryboardBoardWorkflow[][] = [];
  for (const workflow of ordered) {
    const profile = getVideoModelProfileById(workflow.strategyDecision?.selectedModelProfileId || "");
    const maxDuration = Number(limits?.maxDurationSeconds || profile?.maxDurationSeconds || 0);
    const mode = workflow.board?.boardMode || getStoryboardPromptStrategyById(workflow.strategyDecision?.selectedStrategyId || "")?.boardMode || "";
    const currentDuration = workflowDuration(workflow, shots);
    const currentPanels = workflow.board?.panels.length || 0;
    const previous = groups[groups.length - 1];
    const previousWorkflow = previous?.[0];
    const previousProfileId = previousWorkflow?.strategyDecision?.selectedModelProfileId;
    const previousDuration = previous?.reduce((sum, item) => sum + workflowDuration(item, shots), 0) || 0;
    const previousPanels = previous?.reduce((sum, item) => sum + (item.board?.panels.length || 0), 0) || 0;
    const sameModelProfile = limits
      ? true
      : Boolean(profile && previousProfileId === profile.id);
    const mayJoin = Boolean(
      previous?.length
      && (limits ? limits.supportsMultiShotSingleGeneration : profile?.supportsMultiShotSingleGeneration)
      && sameModelProfile
      && workflowShotIds(workflow).length === 1
      && previous.every((item) => workflowShotIds(item).length === 1)
      && !standaloneBoardModes.has(mode)
      && previous.every((item) => !standaloneBoardModes.has(item.board?.boardMode || ""))
      && maxDuration > 0
      && previousDuration + currentDuration <= maxDuration
      && previousPanels + currentPanels <= STORYBOARD_COMPOSITE_BOARD_MAX_PANELS_PER_PAGE
    );
    if (mayJoin) previous.push(workflow);
    else groups.push([workflow]);
  }
  const minDuration = Number(limits?.minDurationSeconds || 0);
  const maxDuration = Number(limits?.maxDurationSeconds || 0);
  if (minDuration > 0 && maxDuration > 0) {
    for (let index = groups.length - 1; index > 0; index -= 1) {
      const group = groups[index];
      const previous = groups[index - 1];
      let duration = group.reduce((sum, workflow) => sum + workflowDuration(workflow, shots), 0);
      while (duration < minDuration && previous.length > 1) {
        const candidate = previous[previous.length - 1];
        const candidateDuration = workflowDuration(candidate, shots);
        const previousDuration = previous.reduce((sum, workflow) => sum + workflowDuration(workflow, shots), 0);
        if (duration + candidateDuration > maxDuration || previousDuration - candidateDuration < minDuration) break;
        previous.pop();
        group.unshift(candidate);
        duration += candidateDuration;
      }
    }
  }
  return groups;
};

const beatPriority = ["combat", "action", "reveal", "emotion", "dialogue", "transition", "interactive_idle"] as const;

export const composeStoryboardCompositeWorkflowGroup = ({
  workflows,
  shots,
}: {
  workflows: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
}): ManualStoryboardBoardWorkflow => {
  if (workflows.length === 1) {
    const workflow = workflows[0];
    return workflow.board ? {
      ...workflow,
      board: {
        ...workflow.board,
        shotCellManifest: buildStoryboardShotCellManifest({ board: workflow.board, shots }),
      },
    } : workflow;
  }
  const shotIds = workflows.flatMap(workflowShotIds);
  const groupShots = shotIds.map((id) => shots.find((shot) => shot.id === id)).filter((shot): shot is Shot => Boolean(shot));
  const beats = workflows.flatMap((workflow) => workflow.performanceBeats?.length
    ? workflow.performanceBeats
    : workflow.performanceBeat ? [workflow.performanceBeat] : []);
  const sourceDecisions = workflows.map((workflow) => workflow.strategyDecision).filter(Boolean) as NonNullable<ManualStoryboardBoardWorkflow["strategyDecision"]>[];
  const panels = workflows.flatMap((workflow) => workflow.board?.panels || []).map((panel, index) => ({
    ...panel,
    panelNumber: index + 1,
  }));
  const layout = resolveStoryboardCompositeLayout(panels.length);
  const firstDecision = sourceDecisions[0];
  const durationSeconds = workflows.reduce((sum, workflow) => sum + workflowDuration(workflow, shots), 0);
  const requiredCapabilityIds = uniqueValues(sourceDecisions.flatMap((item) => item.strategyResolution?.requiredCapabilityIds || []));
  const dialogueLineCount = beats.filter((beat) => beat.beatType === "dialogue").length;
  const actionBeatCount = beats.filter((beat) => beat.beatType === "action").length;
  const combatBeatCount = beats.filter((beat) => beat.beatType === "combat").length;
  const emotionalBeatCount = beats.filter((beat) => beat.beatType === "emotion").length;
  const requiresTransitionBridge = sourceDecisions.some((decision) =>
    decision.selectedStrategyId === "storyboard.transition_bridge.v1"
    || decision.strategyResolution?.requiredCapabilityIds.includes("narrative:transition"));
  const aggregateStrategyResolution = resolveStoryboardStrategyCoverage({
    beatSummary: beats.map((beat) => beat.summary).filter(Boolean).join(" -> "),
    dialogueLineCount,
    actionBeatCount,
    combatBeatCount,
    emotionalBeatCount,
    revealOrTwist: beats.some((beat) => beat.beatType === "reveal"),
    // A transition beat can simply establish the opening geography of a scene.
    // Only require the dedicated bridge grammar when a source decision asked
    // for it; otherwise a valid spatial opening becomes impossible to render.
    transitionBridge: requiresTransitionBridge,
    interactiveNode: beats.some((beat) => beat.beatType === "interactive_idle"),
    requiresDialogueBlocking: dialogueLineCount >= 2
      && uniqueValues(beats.flatMap((beat) => beat.characterIds || [])).length >= 2,
    requiresMultiShot: groupShots.length > 1,
    expectedVideoUnitDurationSeconds: durationSeconds,
    expectedReferenceImageCount: Math.max(...sourceDecisions.map((item) => item.expectedReferenceImageCount || 0), 0),
    expectedReferenceVideoCount: Math.max(...sourceDecisions.map((item) => item.expectedReferenceVideoCount || 0), 0),
    modelProfileId: firstDecision?.selectedModelProfileId,
    requiredCapabilityIds,
  });
  const strategy = getStoryboardPromptStrategyById(aggregateStrategyResolution.primaryStrategyId)
    || getStoryboardPromptStrategyById("storyboard.multi_shot_narrative.v1")!;
  const strategyDecision = {
    ...firstDecision,
    selectedStrategyId: strategy.id,
    selectedStrategyVersion: strategy.version,
    rationale: `将 ${shotIds.length} 个连续短 Shot 编组为一个 ${durationSeconds}s 视频生成单元；使用一张 ${layout} 复合故事板统一控制动作因果、轴线、资产状态和首尾连续性。`,
    rejectedStrategyIds: uniqueValues(sourceDecisions.flatMap((item) => item.rejectedStrategyIds || []).filter((id) => id !== strategy.id)),
    riskNotes: uniqueValues(sourceDecisions.flatMap((item) => item.riskNotes || [])),
    expectedBoardShape: `${layout} ${panels.length}格复合视频单元故事板`,
    expectedVideoUnitDurationSeconds: durationSeconds,
    expectedReferenceImageCount: Math.max(...sourceDecisions.map((item) => item.expectedReferenceImageCount || 0), 0),
    expectedReferenceVideoCount: Math.max(...sourceDecisions.map((item) => item.expectedReferenceVideoCount || 0), 0),
    arrowLegendIds: uniqueValues(sourceDecisions.flatMap((item) => item.arrowLegendIds || [])),
    qaChecklist: uniqueValues([...strategy.qaChecklist, ...sourceDecisions.flatMap((item) => item.qaChecklist || [])]),
    strategyResolution: aggregateStrategyResolution,
  };
  const primary = workflows[0];
  const unitId = `manual-video-unit-${shotIds.join("-")}`;
  const boardId = `manual-board-${shotIds.join("-")}`;
  const beatType = beatPriority.find((type) => beats.some((beat) => beat.beatType === type)) || "action";
  const performanceBeat = beats.length ? {
    ...beats[0],
    id: `manual-performance-beat-${shotIds.join("-")}`,
    shotId: shotIds[0],
    scriptBlockIds: uniqueValues(beats.flatMap((beat) => beat.scriptBlockIds || [])),
    beatType,
    summary: beats.map((beat) => beat.summary).filter(Boolean).join(" -> "),
    visibleChange: beats.map((beat) => beat.visibleChange).filter(Boolean).join(" -> "),
    startState: beats[0].startState,
    endState: beats[beats.length - 1].endState,
    durationSeconds,
    characterIds: uniqueValues(beats.flatMap((beat) => beat.characterIds || [])),
    locationId: beats.find((beat) => beat.locationId)?.locationId,
    propIds: uniqueValues(beats.flatMap((beat) => beat.propIds || [])),
    soundCues: uniqueValues(beats.flatMap((beat) => beat.soundCues || [])),
    continuityIn: beats[0].continuityIn,
    continuityOut: beats[beats.length - 1].continuityOut,
  } : undefined;
  const board: ManualStoryboardBoard = {
    ...primary.board!,
    id: boardId,
    shotId: shotIds[0],
    shotIds,
    videoGenerationUnitId: unitId,
    visualReferenceMode: primary.board?.visualReferenceMode || "shot_grid",
    shotCellManifest: [],
    strategyDecision,
    boardMode: strategy.boardMode,
    layout,
    lineArtPrompt: `生成一张 ${layout}、共 ${panels.length} 格的完整复合故事板页，按顺序覆盖 Shot：${shotIds.join("、")}。`,
    arrowLegendIds: strategyDecision.arrowLegendIds,
    performanceBeatIds: beats.map((beat) => beat.id),
    scriptBlockIds: uniqueValues(beats.flatMap((beat) => beat.scriptBlockIds || [])),
    panels,
    startState: workflows[0].board?.startState || beats[0]?.startState || "",
    endState: workflows[workflows.length - 1].board?.endState || beats[beats.length - 1]?.endState || "",
  };
  board.shotCellManifest = buildStoryboardShotCellManifest({ board, shots });
  board.visualPages = buildStoryboardCompositeVisualPages(board);
  return {
    ...primary,
    unitSchema: "storyboard_unit.v1",
    id: `manual-board-workflow-${shotIds.join("-")}`,
    boardId,
    videoGenerationUnitId: unitId,
    shotId: shotIds[0],
    shotIds,
    strategyDecision,
    performanceBeat,
    performanceBeats: beats,
    board,
    qa: undefined,
    confirmedAt: undefined,
    updatedAt: Date.now(),
  };
};

export const composeStoryboardCompositeVideoUnits = ({
  workflows,
  shots,
  limits,
}: {
  workflows: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
  limits?: {
    minDurationSeconds?: number;
    maxDurationSeconds: number;
    supportsMultiShotSingleGeneration: boolean;
  };
}) => planStoryboardCompositeVideoUnitGroups({ workflows, shots, limits })
  .map((group) => composeStoryboardCompositeWorkflowGroup({ workflows: group, shots }));

export interface StoryboardStudioVideoUnitIssue {
  severity: "blocking";
  code: "STUDIO_VIDEO_UNIT_BELOW_MODEL_MIN" | "STUDIO_VIDEO_UNIT_ABOVE_MODEL_MAX" | "STUDIO_VIDEO_UNIT_PANELS_MISSING";
  message: string;
  videoGenerationUnitId: string;
  shotIds: string[];
}

export interface StoryboardStudioVideoUnitPlan {
  units: ManualStoryboardBoardWorkflow[];
  issues: StoryboardStudioVideoUnitIssue[];
}

const sliceStoryboardSceneWorkflowForShot = ({
  workflow,
  shot,
}: {
  workflow: ManualStoryboardBoardWorkflow;
  shot: Shot;
}): ManualStoryboardBoardWorkflow | undefined => {
  const board = workflow.board;
  const strategyDecision = workflow.strategyDecision || board?.strategyDecision;
  if (!board || !strategyDecision) return undefined;
  const panels = board.panels
    .filter((panel) => panel.shotId === shot.id)
    .map((panel, index) => ({ ...panel, panelNumber: index + 1 }));
  if (!panels.length) return undefined;
  const durationSeconds = panels.reduce((sum, panel) => sum + Number(panel.durationSeconds || 0), 0)
    || Number(shot.duration || 0);
  const panelIds = new Set(panels.map((panel) => panel.id));
  const sourcePages = board.visualPages?.length ? board.visualPages : buildStoryboardCompositeVisualPages(board);
  const visualPages = sourcePages
    .map((page) => ({ ...page, panelIds: page.panelIds.filter((panelId) => panelIds.has(panelId)) }))
    .filter((page) => page.panelIds.length > 0);
  const performanceBeats = (workflow.performanceBeats?.length
    ? workflow.performanceBeats
    : workflow.performanceBeat ? [workflow.performanceBeat] : [])
    .filter((beat) => beat.shotId === shot.id);
  const firstPanel = panels[0];
  const lastPanel = panels[panels.length - 1];
  const videoGenerationUnitId = `${workflow.videoGenerationUnitId || board.videoGenerationUnitId || board.id}.shot.${shot.id}`;
  const slicedBoard: ManualStoryboardBoard = {
    ...board,
    id: `${board.id}.shot.${shot.id}`,
    shotId: shot.id,
    shotIds: [shot.id],
    videoGenerationUnitId,
    strategyDecision: {
      ...strategyDecision,
      expectedVideoUnitDurationSeconds: durationSeconds,
    },
    layout: resolveStoryboardCompositeLayout(panels.length),
    performanceBeatIds: performanceBeats.map((beat) => beat.id),
    panels,
    visualPages,
    startState: firstPanel.continuityIn || workflow.board?.startState || "",
    endState: lastPanel.continuityOut || workflow.board?.endState || "",
  };
  return {
    ...workflow,
    unitSchema: "storyboard_unit.v1",
    id: `${workflow.id}.shot.${shot.id}`,
    boardId: slicedBoard.id,
    videoGenerationUnitId,
    shotId: shot.id,
    shotIds: [shot.id],
    strategyDecision: slicedBoard.strategyDecision,
    performanceBeat: performanceBeats[0],
    performanceBeats,
    board: slicedBoard,
    strategyRecord: undefined,
    boardRecord: undefined,
    qa: undefined,
  };
};

const opaqueStoryboardUnitId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `unit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const reidentifyStoryboardUnitWorkflow = ({
  workflow,
  sourceWorkflows,
  shots,
}: {
  workflow: ManualStoryboardBoardWorkflow;
  sourceWorkflows: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
}): ManualStoryboardBoardWorkflow => {
  const unitKey = opaqueStoryboardUnitId();
  const workflowId = `manual-board-workflow-${unitKey}`;
  const boardId = `manual-board-${unitKey}`;
  const videoGenerationUnitId = `manual-video-unit-${unitKey}`;
  const sourceUnitIds = unique(sourceWorkflows.flatMap((source) => [
    source.videoGenerationUnitId || source.board?.videoGenerationUnitId || source.id,
    ...(source.unitLineage?.sourceUnitIds || []),
  ]));
  const sourceTakeIds = unique(sourceWorkflows.flatMap((source) => [
    ...(source.takes || []).map((take) => take.id),
    ...(source.unitLineage?.sourceTakeIds || []),
  ]));
  const board = workflow.board ? {
    ...workflow.board,
    id: boardId,
    videoGenerationUnitId,
  } : undefined;
  if (board) {
    board.shotCellManifest = buildStoryboardShotCellManifest({ board, shots });
    board.visualPages = buildStoryboardCompositeVisualPages(board);
  }
  const nextWorkflow: ManualStoryboardBoardWorkflow = {
    ...workflow,
    unitSchema: "storyboard_unit.v1",
    id: workflowId,
    boardId,
    videoGenerationUnitId,
    board,
    strategyRecord: undefined,
    boardRecord: undefined,
    qa: undefined,
    takes: undefined,
    activeTakeId: undefined,
    unitLineage: { sourceUnitIds, sourceTakeIds },
    confirmedAt: undefined,
    updatedAt: Date.now(),
  };
  nextWorkflow.unitVideoPrompt = buildStoryboardUnitVideoPromptRecord({
    workflow: nextWorkflow,
    shots,
    now: nextWorkflow.updatedAt,
  });
  return nextWorkflow;
};

export const mergeStoryboardUnitWorkflows = ({
  workflows,
  shots,
}: {
  workflows: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
}) => reidentifyStoryboardUnitWorkflow({
  workflow: composeStoryboardCompositeWorkflowGroup({ workflows, shots }),
  sourceWorkflows: workflows,
  shots,
});

export const splitStoryboardUnitWorkflow = ({
  workflow,
  shots,
}: {
  workflow: ManualStoryboardBoardWorkflow;
  shots: Shot[];
}) => workflowShotIds(workflow)
  .map((shotId) => shots.find((shot) => shot.id === shotId))
  .filter((shot): shot is Shot => Boolean(shot))
  .map((shot) => sliceStoryboardSceneWorkflowForShot({ workflow, shot }))
  .filter((item): item is ManualStoryboardBoardWorkflow => Boolean(item))
  .map((item) => reidentifyStoryboardUnitWorkflow({ workflow: item, sourceWorkflows: [workflow], shots }));

/**
 * Projects an adopted scene-level board into provider-sized execution units.
 * The persisted storyboard is never rewritten: model switching only changes
 * this read model, while each derived unit keeps the adopted board image and
 * only the panels/assets belonging to its own consecutive shots.
 */
export const planStoryboardStudioVideoUnits = ({
  workflow,
  shots,
  minDurationSeconds,
  maxDurationSeconds,
  supportsMultiShotSingleGeneration,
}: {
  workflow?: ManualStoryboardBoardWorkflow;
  shots: Shot[];
  minDurationSeconds: number;
  maxDurationSeconds: number;
  supportsMultiShotSingleGeneration: boolean;
}): StoryboardStudioVideoUnitPlan => {
  if (!workflow?.board) return { units: [], issues: [] };
  const sourceShotIds = workflowShotIds(workflow).filter((id) => shots.some((shot) => shot.id === id));
  const sourceDuration = workflowDuration(workflow, shots);
  const missingPanelShotIds = sourceShotIds.filter((shotId) => !workflow.board!.panels.some((panel) => panel.shotId === shotId));
  if (
    sourceShotIds.length > 0
    && missingPanelShotIds.length === 0
    && (sourceShotIds.length === 1 || supportsMultiShotSingleGeneration)
    && sourceDuration >= minDurationSeconds
    && sourceDuration <= maxDurationSeconds
  ) {
    return { units: [workflow], issues: [] };
  }
  const orderedShotSlices = shots
    .filter((shot) => sourceShotIds.includes(shot.id))
    .map((shot) => sliceStoryboardSceneWorkflowForShot({ workflow, shot }))
    .filter((item): item is ManualStoryboardBoardWorkflow => Boolean(item));
  const pageKeyFor = (item: ManualStoryboardBoardWorkflow) => item.board?.visualPages?.[0]?.id || "no-page";
  const pageSegments: ManualStoryboardBoardWorkflow[][] = [];
  for (const item of orderedShotSlices) {
    const previous = pageSegments[pageSegments.length - 1];
    if (previous?.length && pageKeyFor(previous[0]) === pageKeyFor(item)) previous.push(item);
    else pageSegments.push([item]);
  }
  const units = pageSegments.flatMap((segment) => composeStoryboardCompositeVideoUnits({
    workflows: segment,
    shots,
    limits: { minDurationSeconds, maxDurationSeconds, supportsMultiShotSingleGeneration },
  })).map((unit) => {
    const unitPanelIds = new Set(unit.board?.panels.map((panel) => panel.id) || []);
    const sourcePages = workflow.board!.visualPages?.length
      ? workflow.board!.visualPages
      : buildStoryboardCompositeVisualPages(workflow.board!);
    const visualPages = sourcePages
      .map((page) => ({ ...page, panelIds: page.panelIds.filter((panelId) => unitPanelIds.has(panelId)) }))
      .filter((page) => page.panelIds.length > 0);
    return unit.board ? {
      ...unit,
      targetVideoModelConfigId: workflow.targetVideoModelConfigId,
      board: { ...unit.board, visualPages },
    } : unit;
  });
  const issues: StoryboardStudioVideoUnitIssue[] = [
    ...missingPanelShotIds.map((shotId): StoryboardStudioVideoUnitIssue => ({
      severity: "blocking",
      code: "STUDIO_VIDEO_UNIT_PANELS_MISSING",
      message: `镜头 ${shotId} 没有对应的故事板镜头格，系统没有跳过它或伪造视频单元。`,
      videoGenerationUnitId: `${workflow.videoGenerationUnitId || workflow.board!.videoGenerationUnitId || workflow.id}.shot.${shotId}`,
      shotIds: [shotId],
    })),
    ...units.flatMap((unit): StoryboardStudioVideoUnitIssue[] => {
      const id = unit.videoGenerationUnitId || unit.board?.videoGenerationUnitId || unit.id;
      const shotIds = workflowShotIds(unit);
      const durationSeconds = workflowDuration(unit, shots);
      if (!unit.board?.panels.length) return [{ severity: "blocking", code: "STUDIO_VIDEO_UNIT_PANELS_MISSING", message: "当前视频单元没有可用的故事板镜头格。", videoGenerationUnitId: id, shotIds }];
      if (durationSeconds < minDurationSeconds) return [{ severity: "blocking", code: "STUDIO_VIDEO_UNIT_BELOW_MODEL_MIN", message: `当前连续视频单元为 ${durationSeconds}s，低于所选模型最短 ${minDurationSeconds}s；请调整相邻镜头时长后再生成。`, videoGenerationUnitId: id, shotIds }];
      if (durationSeconds > maxDurationSeconds) return [{ severity: "blocking", code: "STUDIO_VIDEO_UNIT_ABOVE_MODEL_MAX", message: `当前连续视频单元为 ${durationSeconds}s，超过所选模型最长 ${maxDurationSeconds}s；请先拆分这个长镜头。`, videoGenerationUnitId: id, shotIds }];
      return [];
    }),
  ];
  return { units, issues };
};

/**
 * A story-board is a scene planning artifact, not a video-duration constraint.
 * The downstream video planner can still split a long scene into model-sized
 * clips, while authors review one coherent multi-panel board for the scene.
 */
export const composeStoryboardSceneBoardWorkflow = ({
  workflows,
  shots,
}: {
  workflows: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
}): ManualStoryboardBoardWorkflow | undefined => {
  const shotIndexById = new Map(shots.map((shot, index) => [shot.id, index]));
  const ordered = workflows
    .filter((workflow) => workflow.unitSchema === "storyboard_unit.v1")
    .filter((workflow) => workflow.board && workflowShotIds(workflow).some((id) => shotIndexById.has(id)))
    .sort((left, right) => {
      const leftIndex = Math.min(...workflowShotIds(left).map((id) => shotIndexById.get(id) ?? Number.MAX_SAFE_INTEGER));
      const rightIndex = Math.min(...workflowShotIds(right).map((id) => shotIndexById.get(id) ?? Number.MAX_SAFE_INTEGER));
      return leftIndex - rightIndex;
    });
  if (!ordered.length) return undefined;
  return composeStoryboardCompositeWorkflowGroup({ workflows: ordered, shots });
};

export interface StoryboardCompositeBoardReferenceSelection {
  selected: ManualProductionAssetBoard[];
  omitted: ManualProductionAssetBoard[];
  missingAssetIds: string[];
}

export interface StoryboardCompositeBoardIssue {
  severity: "blocking" | "warning";
  code: string;
  message: string;
  targetPanelId?: string;
}

export const storyboardBoardWorkflowIdentity = (workflow: ManualStoryboardBoardWorkflow) =>
  workflow.videoGenerationUnitId
  || workflow.boardId
  || workflow.board?.videoGenerationUnitId
  || workflow.board?.id
  || workflow.id
  || workflow.shotId;

export interface StoryboardCompositeWorkflowAnchor {
  id: string;
  workflow: ManualStoryboardBoardWorkflow;
  shot: Shot;
  shotIndex: number;
  shotIds: string[];
  persisted: boolean;
}

export const listStoryboardCompositeWorkflowAnchors = ({
  workflows,
  shots,
}: {
  workflows?: ManualStoryboardBoardWorkflow[];
  shots: Shot[];
}): StoryboardCompositeWorkflowAnchor[] => {
  const sourceWorkflows = workflows || [];
  const shotIndexById = new Map(shots.map((shot, index) => [shot.id, index]));
  return sourceWorkflows
    .filter((workflow) => workflow.unitSchema === "storyboard_unit.v1")
    .flatMap((workflow): StoryboardCompositeWorkflowAnchor[] => {
      const shotIds = workflowShotIds(workflow).filter((id) => shotIndexById.has(id));
      if (!shotIds.length) return [];
      const shotIndex = Math.min(...shotIds.map((id) => shotIndexById.get(id) ?? Number.MAX_SAFE_INTEGER));
      const shot = shots[shotIndex];
      if (!shot) return [];
      return [{
        id: storyboardBoardWorkflowIdentity(workflow),
        workflow,
        shot,
        shotIndex,
        shotIds,
        persisted: true,
      }];
    })
    .sort((left, right) => left.shotIndex - right.shotIndex);
};

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));

const parseLayout = (layout: string) => {
  const parts = String(layout || "").toLowerCase().replace("×", "x").split("x").map(Number);
  if (parts.length !== 2 || parts.some((value) => !Number.isInteger(value) || value <= 0)) return undefined;
  return { columns: parts[0], rows: parts[1], capacity: parts[0] * parts[1] };
};

export const resolveStoryboardCompositeLayout = (panelCount: number) => {
  const safeCount = Math.max(1, Math.min(STORYBOARD_COMPOSITE_BOARD_MAX_PANELS_PER_PAGE, Math.floor(panelCount)));
  if (safeCount === 1) return "1x1";
  if (safeCount === 2) return "2x1";
  if (safeCount <= 4) return "2x2";
  if (safeCount <= 6) return "3x2";
  if (safeCount <= 9) return "3x3";
  if (safeCount <= 12) return "4x3";
  if (safeCount <= 16) return "4x4";
  if (safeCount <= 20) return "5x4";
  return "6x4";
};

const representativeFramePriority = (framePurpose: string) => {
  const value = String(framePurpose || "").toLowerCase();
  if (/key|impact|reveal|climax|关键|冲击|揭示|高潮/.test(value)) return 4;
  if (/action|performance|动作|表演/.test(value)) return 3;
  if (/establish|entry|建立|进入/.test(value)) return 2;
  if (/exit|end|离开|结束/.test(value)) return 1;
  return 0;
};

export const listStoryboardShotRepresentativePanels = (board: ManualStoryboardBoard) =>
  board.shotIds.flatMap((shotId) => {
    const candidates = board.panels.filter((panel) => panel.shotId === shotId);
    if (!candidates.length) return [];
    return [[...candidates].sort((left, right) => (
      representativeFramePriority(right.framePurpose) - representativeFramePriority(left.framePurpose)
      || Number(right.durationSeconds || 0) - Number(left.durationSeconds || 0)
      || left.panelNumber - right.panelNumber
    ))[0]];
  });

export const buildStoryboardShotCellManifest = ({
  board,
  shots,
}: {
  board: ManualStoryboardBoard;
  shots: Shot[];
}): ManualStoryboardShotCell[] => board.shotIds.map((shotId, index) => {
  const shot = shots.find((item) => item.id === shotId);
  const activeTake = shot?.takes?.find((take) => take.id === shot.activeTakeId && Boolean(take.imageUrl));
  const imageUrl = activeTake?.imageUrl || shot?.imageUrl;
  const imageTakeId = activeTake?.id || (imageUrl ? shot?.activeTakeId : undefined);
  return {
    shotId,
    order: index + 1,
    imageUrl,
    imageTakeId,
    contentHash: imageUrl ? manualStoryboardHash({ shotId, imageTakeId: imageTakeId || "legacy", imageUrl }) : undefined,
    status: imageUrl ? "ready" : "missing",
  };
});

export const buildStoryboardCompositeVisualPages = (
  board: ManualStoryboardBoard,
  annotationMode: ManualStoryboardBoardVisualPage["annotationMode"] = "director_annotated_sheet",
): ManualStoryboardBoardVisualPage[] => {
  const shotPanels = listStoryboardShotRepresentativePanels(board);
  const pagePanels = shotPanels.reduce<Array<typeof board.panels>>((pages, panel) => {
    const previous = pages[pages.length - 1];
    if (previous?.length && previous.length < STORYBOARD_COMPOSITE_BOARD_MAX_VISUAL_PANELS_PER_PAGE) {
      previous.push(panel);
    } else {
      pages.push([panel]);
    }
    return pages;
  }, []);
  if (!pagePanels.length) pagePanels.push([]);
  const pageCount = pagePanels.length;
  return pagePanels.map((panels, pageIndex) => {
    return {
      id: `${board.id}.page.${pageIndex + 1}`,
      pageIndex,
      pageCount,
      layout: pageCount === 1 && parseLayout(board.layout)?.capacity === panels.length
        ? board.layout
        : resolveStoryboardCompositeLayout(panels.length),
      annotationMode,
      panelIds: panels.map((panel) => panel.id),
    };
  });
};

export const reconcileStoryboardCompositeVisualPages = (
  board: ManualStoryboardBoard,
): ManualStoryboardBoardVisualPage[] => {
  const planned = buildStoryboardCompositeVisualPages(board);
  const current = board.visualPages || [];
  const samePlan = current.length === planned.length && current.every((page, index) => (
    page.id === planned[index].id
    && page.layout === planned[index].layout
    && page.panelIds.length === planned[index].panelIds.length
    && page.panelIds.every((panelId, panelIndex) => panelId === planned[index].panelIds[panelIndex])
  ));
  if (samePlan) return current;
  const hasPersistedVisual = current.some((page) => Boolean(
    page.activeVisualTakeId || page.visualTakes?.length || page.activeShotGridTakeId || page.shotGridTakes?.length,
  ));
  return hasPersistedVisual ? current : planned;
};

const boardAssetIds = (board: ManualStoryboardBoard, shots: Shot[]) => unique([
  ...board.panels.flatMap((panel) => panel.assetRefs || []),
  ...shots.flatMap((shot) => [
    ...(shot.characterIdsInShot || []),
    shot.locationId,
    ...(shot.propIds || []),
    ...(shot.vehicleIds || []),
  ]),
]);

export const selectStoryboardCompositeBoardReferences = ({
  project,
  board,
  shots,
  assets,
  maxReferences = Number.MAX_SAFE_INTEGER,
}: {
  project?: Project;
  board: ManualStoryboardBoard;
  shots: Shot[];
  assets: ManualProductionAssetReadModel;
  maxReferences?: number;
}): StoryboardCompositeBoardReferenceSelection => {
  const referenceLimit = Math.max(0, Math.floor(maxReferences));
  const requestedAssetIds = boardAssetIds(board, shots);
  // Resolve each Shot independently: the same character may wear different
  // clothes in adjacent cells, and a legacy Shot still retains its own references.
  const resolvedBoards = project && shots.some((shot) => shot.appearance?.states.some((state) => state.decision === "accepted"))
    ? shots.flatMap((shot) => {
        const shotAssetIds = new Set([
          ...appearanceVisibleIds(shot),
          ...(shot.vehicleIds || []),
          ...board.panels.filter((panel) => panel.shotId === shot.id).flatMap((panel) => panel.assetRefs || []),
        ]);
        return [
          ...appearanceBoards(project, [shot], assets.assetBoards, "image"),
          ...assets.assetBoards.filter((item) => item.assetType === "vehicles"),
        ].filter((item) => shotAssetIds.has(item.assetId));
      })
    : assets.assetBoards;
  const groups: ManualProductionAssetBoard[][] = [];
  const missingAssetIds: string[] = [];
  for (const assetId of requestedAssetIds) {
    const matches = resolvedBoards
      .filter((item) => item.assetId === assetId && item.referenceImageUrl)
      .sort((left, right) => Number(Boolean(right.variantId)) - Number(Boolean(left.variantId)));
    if (!matches.length) missingAssetIds.push(assetId);
    else groups.push(matches);
  }
  const coverageFirst = [
    ...groups.map((matches) => matches[0]),
    ...groups.flatMap((matches) => matches.slice(1)),
  ];
  const deduped = coverageFirst.filter((item, index, list) =>
    list.findIndex((candidate) => candidate.referenceImageUrl === item.referenceImageUrl) === index,
  );
  return {
    selected: deduped.slice(0, referenceLimit),
    omitted: deduped.slice(referenceLimit),
    missingAssetIds,
  };
};

const boardStructure = (board: ManualStoryboardBoard) => ({
  id: board.id,
  episodeId: board.episodeId,
  sceneId: board.sceneId,
  videoGenerationUnitId: board.videoGenerationUnitId || "",
  boardMode: board.boardMode,
  layout: board.layout,
  shotIds: board.shotIds,
  shotCellManifest: (board.shotCellManifest || []).map((cell) => ({
    shotId: cell.shotId,
    order: cell.order,
    imageTakeId: cell.imageTakeId || "",
    contentHash: cell.contentHash || "",
    status: cell.status,
  })),
  performanceBeatIds: board.performanceBeatIds,
  scriptBlockIds: board.scriptBlockIds,
  panels: board.panels.map((panel) => ({
    id: panel.id,
    panelNumber: panel.panelNumber,
    shotId: panel.shotId,
    durationSeconds: panel.durationSeconds || 0,
    framePurpose: panel.framePurpose,
    shotType: panel.shotType || "",
    visualBeat: panel.visualBeat || "",
    cameraNote: panel.cameraNote || "",
    subjectAction: panel.subjectAction || "",
    blocking: panel.blocking || "",
    continuityIn: panel.continuityIn || "",
    continuityOut: panel.continuityOut || "",
    assetRefs: panel.assetRefs,
    annotationLegendIds: panel.annotationLegendIds,
    actionArrowLegendIds: panel.actionArrowLegendIds,
  })),
  startState: board.startState,
  endState: board.endState,
});

export const buildStoryboardCompositeBoardSourceHash = ({
  project,
  board,
  page,
  references,
  shots = [],
}: {
  project: Project;
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  references: ManualProductionAssetBoard[];
  shots?: Shot[];
}) => manualStoryboardHash({
  contractVersion: STORYBOARD_COMPOSITE_BOARD_CONTRACT_VERSION,
  videoReferenceSanitizerVersion: STORYBOARD_VIDEO_REFERENCE_SANITIZER_VERSION,
  project: {
    id: project.id,
    aspectRatio: project.aspectRatio || "16:9",
    visualStyleLock: project.visualStyleLock || null,
    creativeVisualStyle: project.creativeVision?.visualStyle || "",
  },
  // Generation, read models, and adoption must compare the current adopted
  // Shot pictures even when the board structure was created before the pictures.
  board: boardStructure(shots.length ? {
    ...board,
    shotCellManifest: buildStoryboardShotCellManifest({ board: scopeStoryboardCompositeBoardToPage(board, page), shots }),
  } : board),
  imagePrompts: shots.map((shot) => ({ id: shot.id, imagePrompt: shot.imagePrompt || "", ...(shot.appearance ? { appearance: appearancePrompt(shot, "image") } : {}) })),
  page: {
    id: page.id,
    pageIndex: page.pageIndex,
    pageCount: page.pageCount,
    layout: page.layout,
    annotationMode: page.annotationMode,
    panelIds: page.panelIds,
  },
  references: references.map((item) => ({
    boardItemId: item.boardItemId,
    assetId: item.assetId,
    variantId: item.variantId || "",
    promptHash: item.promptHash,
    referenceImageUrl: item.referenceImageUrl || "",
  })),
});

const panelLine = (board: ManualStoryboardBoard, panelId: string) => {
  const panel = board.panels.find((item) => item.id === panelId);
  if (!panel) return "";
  return [
    `P${panel.panelNumber}`,
    panel.shotType || "",
    panel.framePurpose,
    panel.visualBeat || panel.subjectAction || "",
    panel.cameraNote || panel.cameraMove || "",
    panel.continuityOut || "",
  ].filter(Boolean).join(" | ");
};

const panelAppearancePlan = (board: ManualStoryboardBoard, page: ManualStoryboardBoardVisualPage, shots: Shot[]) =>
  page.panelIds.flatMap((panelId) => {
    const panel = board.panels.find((item) => item.id === panelId);
    const shot = shots.find((item) => item.id === panel?.shotId);
    const appearance = shot ? appearancePrompt(shot, "image") : "";
    return panel && appearance ? [`P${panel.panelNumber} · Shot ${shot!.id}\n${appearance}`] : [];
  }).join("\n\n");

export const buildStoryboardCompositeBoardPrompt = ({
  project,
  scene,
  board,
  page,
  shots,
  references,
  repairIssues = [],
}: {
  project: Project;
  scene: Scene;
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  shots: Shot[];
  references: ManualProductionAssetBoard[];
  repairIssues?: string[];
}) => {
  const pagePanelIds = new Set(page.panelIds);
  const pageBoard = {
    ...board,
    layout: page.layout,
    panels: board.panels.filter((panel) => pagePanelIds.has(panel.id)),
  } as unknown as ProductionStoryboardBoard;
  const resolution = board.strategyDecision.strategyResolution;
  if (resolution?.uncoveredCapabilityIds.length) {
    throw new Error(
      `当前视频单元仍缺少故事板能力：${resolution.uncoveredCapabilityIds.join(", ")}。请先完成一次项目局部策略草案试跑，或由创作者选择 fallbackStrategyId。`,
    );
  }
  const strategyRender = renderStoryboardBoardPrompt({ project, scene, board: pageBoard });
  if (strategyRender.warnings.length) {
    throw new Error(`故事板策略模板不可正式渲染：${strategyRender.warnings.join("；")}`);
  }
  const strategyNames = [
    getStoryboardPromptStrategyById(board.strategyDecision.selectedStrategyId)?.name,
    ...(board.strategyDecision.strategyResolution?.modifierStrategyIds || [])
      .map((strategyId) => getStoryboardPromptStrategyById(strategyId)?.name),
  ].filter(Boolean);
  return [
  strategyNames.length ? `【故事板方法】\n${strategyNames.join("；")}` : "",
  strategyRender.promptSections.departments ? `【当前页专业约束】\n${strategyRender.promptSections.departments}` : "",
  "【最终复合画布合同】",
  "生成一张完整的专业电影制作故事板控制图，不是单格画面，不是剧照，也不是多张独立图片。",
  `整张画布采用复合版式，严格为 ${page.layout}，共 ${page.panelIds.length} 格，按从左到右、从上到下的自然视觉阅读顺序排列；原始画面不写编号。`,
  `${storyboardPanelFrameShape(project.aspectRatio || "16:9")}；每个 panel 都保持与已确认 Shot 相同的构图、屏幕方向和视觉信息层级；故事板成品必须便于一次查看全部格子。`,
  scene.title ? `场次：${scene.title}；首状态：${board.startState}；尾状态：${board.endState}。` : `首状态：${board.startState}；尾状态：${board.endState}。`,
  "全部 panel 保持人物身份、场景空间、线条、灰度底色和标注语言一致。服装、污损、伤势与道具状态逐格服从对应镜头已采用的时刻；剧情明确的换装或受伤必须保留，不能为了整板一致而抹去变化。",
  references.some((item) => item.assetType === "vehicles") ? `【交通工具连续性】${references.filter((item) => item.assetType === "vehicles").map((item) => `${item.assetName}：保持轮廓、比例、左右方位、出入口和已声明状态与正式参考图一致；仅在对应画格出现时描绘，不把参考板版式画入分镜。`).join("；")}` : "",
  "红色箭头表达人物/武器/道具动作，蓝色箭头表达摄影机/画框运动，绿色表达视线/注意力，橙色表达冲击/能量，紫色表达声音/情绪节拍；静态格不要滥画箭头。",
  "画面必须清楚表现镜头景别、机位、动作因果、空间距离和首尾连续性。不得把多个 panel 融成一张蒙太奇，不得漏格、重复格、错序或把同一动作机械复制。",
  "模型原始输出将作为视频模型的多宫格分镜参考图：不要添加标题、页眉、页脚、镜头参数、时长、制作说明、工具 logo 或水印。只保留画面、细分格线和必要的动作/运镜箭头；剧本或作者要求的招牌、信件、屏幕数字、字幕等作品内容必须保留原文及位置，不得按说明文字删除。",
  page.annotationMode === "director_annotated_sheet"
    ? "不要在原始画面中生成编号或镜头注释；供作者查看的编号、页眉、legend 和技术说明由系统在另一张展示图上确定性叠加。"
    : "面向视频模型的控制版只保留无文字运动标记，不生成编号、字幕、UI 或水印。",
  `本页 panel：\n${page.panelIds.map((panelId) => panelLine(board, panelId)).join("\n")}`,
  panelAppearancePlan(board, page, shots) ? `【逐格外观与参考时刻】\n每格沿用该 Shot 图片提示词选择的代表时刻；以下已采用状态优先于旧故事板文字或其他画格的服装。不得把变化后的伤势提前画到变化前。\n${panelAppearancePlan(board, page, shots)}` : "",
  references.some((item) => item.boardItemId.startsWith("appearance:")) ? `【状态参考职责】\n${references.filter((item) => item.boardItemId.startsWith("appearance:")).map((item) => `${item.assetName} · ${item.variantName || "基础身份"}：只用于逐格外观要求中匹配此状态的格子，不能覆盖同一资产的其他时刻。`).join("\n")}` : "",
  `来源镜头与已确认图片提示词：\n${shots.map((shot, index) => `S${index + 1} | ${shot.shotSize || ""} | ${shot.cameraAngle || ""} | ${shot.imagePrompt || shot.visualAction || shot.blocking || ""}`).join("\n")}`,
  repairIssues.length ? `本轮必须修复：${repairIssues.join("；")}` : "",
].filter(Boolean).join("\n\n");
};

export const buildStoryboardCompositeBoardQAPrompt = ({
  project,
  scene,
  board,
  page,
  shots,
  references,
}: {
  project: Project;
  scene: Scene;
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  shots: Shot[];
  references: ManualProductionAssetBoard[];
}) => {
  const pagePanelIds = new Set(page.panelIds);
  const pageBoard = {
    ...board,
    layout: page.layout,
    panels: board.panels.filter((panel) => pagePanelIds.has(panel.id)),
  } as unknown as ProductionStoryboardBoard;
  const strategyRender = renderStoryboardBoardPrompt({
    project,
    scene,
    board: pageBoard,
  });
  return [
  "你是独立的电影故事板整板视觉质检总监。只做质检，不生成内容。",
  "【输入图1职责】待验收的完整多格故事板页，只检查其结果，不把它当成正式身份来源。",
  ...references.map((item, index) => `【输入图${index + 2}职责】${item.assetName}${item.variantName ? `（${item.variantName}）` : ""}的${item.assetType === "character" ? "角色身份与服装状态" : item.assetType === "location" ? "场景布局、固定陈设与材质" : item.assetType === "vehicles" ? "交通工具轮廓、结构与方位" : "道具几何、比例与材质"}参考；必须用于核对对应资产，但不得复制参考板排版、文字、背景或无关构图。`),
  `必须确认第一张图是一张 ${page.layout} 的完整故事板控制图，共 ${page.panelIds.length} 格，而不是单格分镜、剧照、角色板或多张散图。`,
  `项目：${project.title || ""}；场次：${scene.title || ""}；${storyboardPanelFrameShape(project.aspectRatio || "16:9")}。`,
  "检查：格数与顺序；每格内容是否与 panel 计划对应；镜头景别/机位/运动是否可读；动作因果、屏幕方向、轴线、视线、道具归属与首尾状态是否连续；人物、服装、场景、道具与正式参考板是否一致；当前策略要求的动作/对白/情绪/揭示节拍是否真正可见；整板是否能与视频提示词和资产参考图共同指导一个视频生成单元。",
  "以下问题必须 blocking：漏格、重复格、错序、把多个格融合、人物或资产身份错误、动作方向矛盾、关键道具跳变、首尾状态断裂、完全不是故事板整板。可定向重绘的问题用 warning；纯审美偏好只能 advisory。",
  "不得因为图片没有大段中文技术文字而扣分；长文字由系统确定性叠加。不得要求把 panel 拆成多张独立图片。",
  `当前策略与组合规则：\n${strategyRender.promptSections.strategy}\n${strategyRender.promptSections.renderRules}`,
  `本页 panel 计划：\n${page.panelIds.map((panelId) => panelLine(board, panelId)).join("\n")}`,
  panelAppearancePlan(board, page, shots) ? `【逐格已采用外观】\n${panelAppearancePlan(board, page, shots)}\n按各格指定时刻核对状态；明确的换装或伤势变化不属于不一致，提前出现伤势或误用另一格服装才是问题。` : "",
  `来源 Shot：\n${shots.map((shot) => `${shot.id} | ${shot.shotSize || ""} | ${shot.cameraAngle || ""} | ${shot.visualAction || shot.blocking || ""}`).join("\n")}`,
  references.length ? `正式参考顺序：${references.map((item, index) => `输入图${index + 2}=${item.assetName}${item.variantName ? `(${item.variantName})` : ""}`).join("；")}` : "",
  "严格返回 JSON：score(0-100)、verdict(pass/revise)、summary、strengths[]、issues[]。每条 issue 包含 severity(blocking/warning/advisory)、targetShotId、description、suggestion。",
].filter(Boolean).join("\n\n");
};

export const validateStoryboardCompositeBoardContract = ({
  board,
  pages,
  shots,
}: {
  board: ManualStoryboardBoard;
  pages: ManualStoryboardBoardVisualPage[];
  shots: Shot[];
}): StoryboardCompositeBoardIssue[] => {
  const issues: StoryboardCompositeBoardIssue[] = [];
  const knownShotIds = new Set(shots.map((shot) => shot.id));
  const boardShotIds = unique(board.shotIds);
  if (!boardShotIds.length) {
    issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_SHOTS_MISSING", message: "复合 StoryboardBoard 必须绑定至少一个 Shot。" });
  }
  for (const shotId of boardShotIds) {
    if (!knownShotIds.has(shotId)) issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_SHOT_UNKNOWN", message: `故事板引用了未知 Shot：${shotId}` });
  }
  if (!board.panels.length) {
    issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PANELS_MISSING", message: "复合 StoryboardBoard 没有 panel。" });
  }
  const panelIds = new Set<string>();
  board.panels.forEach((panel, index) => {
    if (panelIds.has(panel.id)) issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PANEL_DUPLICATE", message: `故事板 panel ID 重复：${panel.id}`, targetPanelId: panel.id });
    panelIds.add(panel.id);
    if (panel.panelNumber !== index + 1) issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PANEL_ORDER", message: `Panel ${panel.id} 编号应为 ${index + 1}。`, targetPanelId: panel.id });
    if (!boardShotIds.includes(panel.shotId)) issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PANEL_SHOT_MISMATCH", message: `Panel ${panel.id} 的 Shot 不属于当前视频单元。`, targetPanelId: panel.id });
  });
  const pagePanelIds = pages.flatMap((page) => page.panelIds);
  if (new Set(pagePanelIds).size !== pagePanelIds.length) {
    issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PAGE_PANEL_DUPLICATE", message: "同一 panel 被分配到了多个故事板页面。" });
  }
  for (const page of pages) {
    const layout = parseLayout(page.layout);
    if (!layout || layout.capacity < page.panelIds.length) {
      issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_LAYOUT_MISMATCH", message: `故事板页面 ${page.id} 的 ${page.layout} 布局无法容纳 ${page.panelIds.length} 个 panel。` });
    }
    if (page.panelIds.some((panelId) => !panelIds.has(panelId))) {
      issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PAGE_PANEL_UNKNOWN", message: `故事板页面 ${page.id} 包含未知 panel。` });
    }
  }
  const representativePanelIds = listStoryboardShotRepresentativePanels(board).map((panel) => panel.id);
  if (
    pagePanelIds.length !== representativePanelIds.length
    || representativePanelIds.some((panelId) => !pagePanelIds.includes(panelId))
  ) {
    issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_PAGE_COVERAGE", message: "视频参考页没有做到每个 Shot 恰好一个代表格。" });
  }
  const panelDuration = board.panels.reduce((sum, panel) => sum + Number(panel.durationSeconds || 0), 0);
  const expectedDuration = Number(board.strategyDecision.expectedVideoUnitDurationSeconds || 0);
  if (expectedDuration > 0 && Math.abs(panelDuration - expectedDuration) > 0.2) {
    issues.push({ severity: "blocking", code: "COMPOSITE_BOARD_DURATION_MISMATCH", message: `Panel 合计 ${panelDuration}s 与视频单元 ${expectedDuration}s 不一致。` });
  }
  return issues;
};

export const getActiveStoryboardBoardVisualTake = (page: ManualStoryboardBoardVisualPage) =>
  page.visualTakes?.find((take) => take.id === page.activeVisualTakeId);

export const getActiveStoryboardShotGridTake = (page: ManualStoryboardBoardVisualPage) =>
  page.shotGridTakes?.find((take) => take.id === page.activeShotGridTakeId);

export const resolveStoryboardShotGridImage = (page: ManualStoryboardBoardVisualPage) =>
  page.activeShotGridTakeId
    ? getActiveStoryboardShotGridTake(page)?.imageUrl
    : getActiveStoryboardBoardVisualTake(page)?.videoReferenceImageUrl;

export const buildStoryboardShotGridSourceHash = ({ board, page, shots }: {
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  shots: Shot[];
}) => {
  const pageBoard = scopeStoryboardCompositeBoardToPage(board, page);
  const cells = buildStoryboardShotCellManifest({ board: pageBoard, shots });
  return manualStoryboardHash({
    version: "adopted-shot-grid.v1", layout: page.layout,
    cells: cells.map(({ shotId, order, contentHash, status }) => ({ shotId, order, contentHash, status })),
    appearances: cells.map((cell) => ({ shotId: cell.shotId, value: appearancePrompt(shots.find((shot) => shot.id === cell.shotId) || { id: cell.shotId } as Shot, "image") })),
  });
};

export const storyboardShotGridStatus = ({ board, page, shots }: {
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  shots: Shot[];
}): "ready" | "stale" | "missing" => {
  const take = getActiveStoryboardShotGridTake(page);
  if (page.activeShotGridTakeId) {
    if (!take?.imageUrl) return "missing";
    return take.sourceHash === buildStoryboardShotGridSourceHash({ board, page, shots }) ? "ready" : "stale";
  }
  const legacyTake = getActiveStoryboardBoardVisualTake(page);
  if (!legacyTake?.videoReferenceImageUrl) return "missing";
  // Older combined takes have no grid-specific source evidence. Keep their
  // media, but require a cheap recomposition before reusing them downstream.
  return legacyTake.status === "adopted" && isStoryboardBoardVisualTakeApproved(legacyTake)
    && legacyTake.videoReferenceSourceHash === buildStoryboardShotGridSourceHash({ board, page, shots })
    ? "ready" : "stale";
};

export const resolveReadyStoryboardShotGridImage = (input: Parameters<typeof storyboardShotGridStatus>[0]) =>
  storyboardShotGridStatus(input) === "ready" ? resolveStoryboardShotGridImage(input.page) : undefined;

/** Compose a new grid version without generating or approving a director board. */
export const composeStoryboardShotGridPage = async ({ board, page, shots, render, persist, now = Date.now() }: {
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  shots: Shot[];
  render: (input: { cells: Array<{ imageUrl: string; order: number }>; layout: string }) => Promise<string>;
  persist: (imageUrl: string) => Promise<string>;
  now?: number;
}): Promise<ManualStoryboardBoardVisualPage> => {
  const cells = buildStoryboardShotCellManifest({ board: scopeStoryboardCompositeBoardToPage(board, page), shots });
  const missing = cells.filter((cell) => cell.status !== "ready" || !cell.imageUrl);
  if (!cells.length || missing.length) throw new Error(missing.length ? `请先为本页 ${missing.length} 个分镜上传或采用图片，再合成宫格。` : "当前页没有可用于宫格的分镜。");
  const sourceHash = buildStoryboardShotGridSourceHash({ board, page, shots });
  if (getActiveStoryboardShotGridTake(page)?.imageUrl && getActiveStoryboardShotGridTake(page)?.sourceHash === sourceHash) return page;
  const imageUrl = await persist(await render({ cells: cells.map((cell) => ({ imageUrl: cell.imageUrl!, order: cell.order })), layout: page.layout }));
  if (!imageUrl) throw new Error("宫格图未保存，请重试。");
  const take: ManualStoryboardShotGridTake = {
    id: `shot-grid-${page.id}-${now}-${crypto.randomUUID()}`, imageUrl, sourceHash, layout: page.layout, cells, source: "adopted_shot_composition", createdAt: now,
    imageMedia: { url: imageUrl, kind: "image", source: "manual", status: "ready", createdAt: now, updatedAt: now, note: "作者将已采用分镜图合成为宫格；未调用生成模型，不代表故事板视觉质检。" },
  };
  return { ...page, shotGridTakes: [...(page.shotGridTakes || []), take], activeShotGridTakeId: take.id };
};

/** Rebase an async composition onto the latest page without erasing other takes. */
export const mergeStoryboardShotGridPageResult = ({ board, page, shots, result }: {
  board: ManualStoryboardBoard;
  page: ManualStoryboardBoardVisualPage;
  shots: Shot[];
  result: ManualStoryboardBoardVisualPage;
}): ManualStoryboardBoardVisualPage => {
  const take = getActiveStoryboardShotGridTake(result);
  if (result.id !== page.id || !take?.imageUrl
    || take.sourceHash !== buildStoryboardShotGridSourceHash({ board, page, shots })) {
    throw new Error("分镜图在合成过程中有更新，请重新合成宫格。");
  }
  if (getActiveStoryboardShotGridTake(page)?.imageUrl && getActiveStoryboardShotGridTake(page)?.sourceHash === take.sourceHash) return page;
  return {
    ...page,
    shotGridTakes: [...(page.shotGridTakes || []).filter(item => item.id !== take.id), take],
    activeShotGridTakeId: take.id,
  };
};

/** Media persistence changes locations, not pictures. Rebase only grid evidence
 * that matched before serialization; never make an already stale take current. */
export const rebaseStoryboardGridMediaSources = (before: Scene, saved: Scene): Scene => {
  if (!before.shots?.length || !saved.shots?.length || !saved.manualStoryboard?.boards) return saved;
  return {
    ...saved,
    manualStoryboard: {
      ...saved.manualStoryboard,
      boards: saved.manualStoryboard.boards.map(workflow => {
        const oldBoard = before.manualStoryboard?.boards?.find(item => item.id === workflow.id)?.board;
        const board = workflow.board;
        if (!oldBoard || !board?.visualPages) return workflow;
        return { ...workflow, board: { ...board, visualPages: board.visualPages.map(page => {
          const oldPage = oldBoard.visualPages?.find(item => item.id === page.id);
          if (!oldPage) return page;
          const oldHash = buildStoryboardShotGridSourceHash({ board: oldBoard, page: oldPage, shots: before.shots! });
          const newHash = buildStoryboardShotGridSourceHash({ board, page, shots: saved.shots! });
          if (oldHash === newHash) return page;
          const cells = buildStoryboardShotCellManifest({ board: scopeStoryboardCompositeBoardToPage(board, page), shots: saved.shots! });
          return {
            ...page,
            shotGridTakes: page.shotGridTakes?.map(take => oldPage.shotGridTakes?.some(old => old.id === take.id && old.sourceHash === oldHash)
              ? { ...take, sourceHash: newHash, cells } : take),
            visualTakes: page.visualTakes?.map(take => oldPage.visualTakes?.some(old => old.id === take.id && old.videoReferenceSourceHash === oldHash)
              ? { ...take, videoReferenceSourceHash: newHash } : take),
          };
        }) } };
      }),
    },
  };
};

export const getLatestStoryboardBoardVisualCandidate = (
  page: ManualStoryboardBoardVisualPage,
  sourceHash?: string,
) => [...(page.visualTakes || [])].reverse().find((take) =>
  take.status === "candidate" && (!sourceHash || take.sourceHash === sourceHash),
);

export const appendStoryboardBoardVisualTake = ({
  page,
  take,
  maxTakes = 8,
}: {
  page: ManualStoryboardBoardVisualPage;
  take: ManualStoryboardBoardVisualTake;
  maxTakes?: number;
}): ManualStoryboardBoardVisualPage => {
  const allTakes = [
    ...(page.visualTakes || []).filter((item) => item.id !== take.id),
    take,
  ];
  const retainedCount = Math.max(0, Math.floor(maxTakes));
  const protectedIds = new Set([page.activeVisualTakeId, take.id].filter(Boolean));
  const protectedTakes = allTakes.filter((item) => protectedIds.has(item.id));
  const availableSlots = Math.max(0, retainedCount - protectedTakes.length);
  const latestOtherIds = new Set(allTakes
    .filter((item) => !protectedIds.has(item.id))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, availableSlots)
    .map((item) => item.id));
  const visualTakes = allTakes.filter((item) => protectedIds.has(item.id) || latestOtherIds.has(item.id));
  return { ...page, visualTakes };
};

export const stageStoryboardBoardVisualTakeForCreatorReview = ({
  page,
  take,
  notes,
}: {
  page: ManualStoryboardBoardVisualPage;
  take: ManualStoryboardBoardVisualTake;
  notes?: string;
}): ManualStoryboardBoardVisualPage => {
  const stagedTake: ManualStoryboardBoardVisualTake = {
    ...take,
    status: "candidate",
    adoptedAt: undefined,
    review: { mode: "manual", status: "pending", notes },
  };
  return appendStoryboardBoardVisualTake({ page, take: stagedTake });
};

export const isStoryboardBoardVisualTakeApproved = (take?: ManualStoryboardBoardVisualTake) => Boolean(
  take && (
    take.review?.mode === "automatic"
      ? take.review.status === "approved"
      : take.review?.mode === "manual" && take.review.status === "approved"
  ),
);

export const isStoryboardBoardVisualQualityPassing = (quality?: ManualStoryboardAgentQuality) => Boolean(
  quality
  && quality.verdict === "pass"
  && quality.score >= STORYBOARD_COMPOSITE_BOARD_QUALITY_THRESHOLD
  && quality.issues.every((issue) => issue.severity === "advisory"),
);

export const isStoryboardBoardVisualReady = ({
  page,
  sourceHash,
}: {
  page: ManualStoryboardBoardVisualPage;
  sourceHash: string;
}) => {
  const take = getActiveStoryboardBoardVisualTake(page);
  return Boolean(take?.sourceHash === sourceHash && take.status === "adopted" && isStoryboardBoardVisualTakeApproved(take));
};

export const adoptStoryboardBoardVisualTake = ({
  page,
  take,
  adoptedAt = Date.now(),
}: {
  page: ManualStoryboardBoardVisualPage;
  take: ManualStoryboardBoardVisualTake;
  adoptedAt?: number;
}): ManualStoryboardBoardVisualPage => ({
  ...page,
  visualTakes: [
    ...(page.visualTakes || [])
      .filter((item) => item.id !== take.id)
      .map((item) => item.status === "adopted" ? { ...item, status: "rejected" as const } : item),
    { ...take, status: "adopted" as const, adoptedAt },
  ],
  activeVisualTakeId: take.id,
});
