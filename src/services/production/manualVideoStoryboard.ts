import type {
  ManualStoryboardBoard,
  ManualStoryboardBoardQA,
  ManualStoryboardBoardWorkflow,
  ManualStoryboardPerformanceBeat,
  ManualStoryboardStrategyDecision,
  Project,
  Scene,
  Shot,
} from "../../types/project";
import type { ManualProductionAssetReadModel } from "./manualProductionAssets";
import {
  STORYBOARD_ARROW_LEGEND,
  STORYBOARD_PROMPT_STRATEGIES,
  VIDEO_MODEL_PROFILES,
  getStoryboardPromptStrategyById,
  getStoryboardStrategyCapabilityIds,
  getStoryboardStrategyCompositionRole,
  validateStoryboardStrategyDecision,
  type StoryboardStrategySelectionContext,
} from "./videoStoryboardSystem";
import {
  validatePerformanceBeats,
  validateStoryboardBoard,
  type StoryboardBoard,
} from "./videoStoryboardArtifacts";
import { getManualVideoPromptLayerStatus, manualStoryboardHash } from "./manualStoryboard";
import {
  buildStoryboardPanelVisualSourceHash,
  getActiveStoryboardPanelVisualTake,
  getLatestStoryboardPanelVisualCandidate,
  isStoryboardPanelVisualTakeApproved,
  selectStoryboardPanelVisualReferences,
} from "./storyboardPanelVisual";
import {
  buildStoryboardCompositeBoardSourceHash,
  buildStoryboardCompositeVisualPages,
  buildStoryboardShotCellManifest,
  getActiveStoryboardBoardVisualTake,
  getActiveStoryboardShotGridTake,
  resolveStoryboardShotGridImage,
  storyboardShotGridStatus,
  getLatestStoryboardBoardVisualCandidate,
  isStoryboardBoardVisualTakeApproved,
  scopeStoryboardCompositeBoardToPage,
  selectStoryboardCompositeBoardReferences,
  storyboardBoardWorkflowIdentity,
} from "./storyboardCompositeBoard";
import { resolveStoryboardUnitVideoPrompt } from "./storyboardUnitVideoPrompt";

export type ManualVideoStoryboardStatus = "missing" | "ready" | "stale" | "needs_review" | "needs_revision" | "confirmed";

export interface ManualVideoStoryboardIssue {
  severity: "blocking" | "warning" | "advisory";
  code: string;
  message: string;
}

export interface ManualVideoStoryboardReadModel {
  schemaVersion: "manual-video-storyboard-read-model.v1";
  workflow?: ManualStoryboardBoardWorkflow;
  strategySourceHash: string;
  boardSourceHash?: string;
  qaSourceHash?: string;
  studioSourceHash?: string;
  unitVideoPromptSourceHash?: string;
  unitVideoPromptHash?: string;
  unitVideoPromptStatus: ManualVideoStoryboardStatus;
  effectiveUnitVideoPrompt: string;
  strategyStatus: ManualVideoStoryboardStatus;
  boardStatus: ManualVideoStoryboardStatus;
  qaStatus: ManualVideoStoryboardStatus;
  panelVisualStatus: ManualVideoStoryboardStatus;
  boardVisualStatus: ManualVideoStoryboardStatus;
  visualPanelCount: number;
  readyVisualPanelCount: number;
  visualPageCount: number;
  readyVisualPageCount: number;
  assetReferencePackStatus: ManualVideoStoryboardStatus;
  videoGenerationUnitStatus: ManualVideoStoryboardStatus;
  staleScopes: Array<"StoryboardBoard" | "AssetReferencePack" | "VideoGenerationUnit">;
  readyForBoardGeneration: boolean;
  readyForBoardQA: boolean;
  readyForStudio: boolean;
  staleReasons: string[];
}

export const isManualVideoStoryboardReadyForConfirmation = (
  readModel: Pick<ManualVideoStoryboardReadModel, "strategyStatus" | "boardStatus" | "qaStatus" | "panelVisualStatus">,
) => readModel.boardStatus !== "missing";

const text = (value: unknown) => String(value || "").trim();
const strings = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const object = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const unique = (value: string[]) => Array.from(new Set(value));
const knownStoryboardLegendIds = new Set(STORYBOARD_ARROW_LEGEND.map((entry) => entry.id));
const coreStoryboardLegendIds = ["subject_action_red", "camera_motion_blue"];

const normalizeLegendIds = (value: unknown, fallback: string[] = []) => {
  const normalized = unique(strings(value).filter((id) => knownStoryboardLegendIds.has(id)));
  return normalized.length ? normalized : unique(fallback.filter((id) => knownStoryboardLegendIds.has(id)));
};

const resolveStoryboardStrategyId = (value: unknown) => {
  const candidate = text(value);
  if (!candidate) return "";
  if (STORYBOARD_PROMPT_STRATEGIES.some((strategy) => strategy.id === candidate)) return candidate;
  const aliases = STORYBOARD_PROMPT_STRATEGIES.filter((strategy) => strategy.id.startsWith(`${candidate}.`));
  if (aliases.length === 1) return aliases[0].id;
  const candidateTokens = candidate.replace(/^storyboard\./, "").split(/[._-]+/).filter(Boolean);
  const tokenMatches = STORYBOARD_PROMPT_STRATEGIES.filter((strategy) => {
    const strategyTokens = new Set(strategy.id.replace(/^storyboard\./, "").split(/[._-]+/).filter((token) => token && !/^v\d+$/.test(token)));
    return candidateTokens.length > 0 && candidateTokens.every((token) => strategyTokens.has(token));
  });
  return tokenMatches.length === 1 ? tokenMatches[0].id : candidate;
};

const normalizeStoryboardLayout = (value: unknown, panelCount: number) => {
  const candidate = text(value).toLowerCase().replace("×", "x");
  const dimensions = candidate.split("x").map((item) => Number(item.trim()));
  if (dimensions.length === 2 && dimensions.every((item) => Number.isInteger(item) && item > 0) && dimensions[0] * dimensions[1] === panelCount) {
    return `${dimensions[0]}x${dimensions[1]}`;
  }
  const safeCount = Math.max(1, panelCount);
  let columns = Math.max(1, Math.floor(Math.sqrt(safeCount)));
  while (columns > 1 && safeCount % columns !== 0) columns -= 1;
  return `${columns}x${safeCount / columns}`;
};

const normalizeStoryboardPanelDurations = (
  panels: ManualStoryboardBoard["panels"],
  targetDurationSeconds: number,
) => {
  if (!panels.length || !(targetDurationSeconds > 0)) return panels;
  const weights = panels.map((panel) => panel.durationSeconds && panel.durationSeconds > 0 ? panel.durationSeconds : 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let assigned = 0;
  return panels.map((panel, index) => {
    const durationSeconds = index === panels.length - 1
      ? Math.max(0.1, Math.round((targetDurationSeconds - assigned) * 10) / 10)
      : Math.max(0.1, Math.round((targetDurationSeconds * weights[index] / totalWeight) * 10) / 10);
    assigned += durationSeconds;
    return { ...panel, durationSeconds };
  });
};

const buildCanonicalStoryboardLineArtPrompt = ({
  layout,
  panels,
  legendIds,
}: {
  layout: string;
  panels: ManualStoryboardBoard["panels"];
  legendIds: string[];
}) => {
  const panelPlan = panels.map((panel, index) => [
    `第${index + 1}格`,
    panel.framePurpose,
    panel.visualBeat,
    panel.subjectAction,
    panel.cameraNote,
    panel.continuityOut,
  ].filter(Boolean).join("：")).join("；");
  return `电影故事板控制图，共${panels.length}格，严格采用${layout}布局并按从左到右、从上到下编号。${panelPlan}。使用 legend：${legendIds.join("、")}。保持人物站位、视线、屏幕方向、道具持有和首尾状态连续；黑白线稿为主，只用 legend 规定的颜色表达动作与摄影标注；无字幕、无水印、无额外人物道具。`;
};

const strategyValue = (decision: ManualStoryboardStrategyDecision) => ({ ...decision });
const boardStructureValue = (board?: ManualStoryboardBoard) => {
  if (!board) return null;
  const {
    visualReferenceMode: _visualReferenceMode,
    shotCellManifest: _shotCellManifest,
    ...structure
  } = board;
  return {
    ...structure,
    visualPages: board.visualPages?.map(({ visualTakes: _visualTakes, activeVisualTakeId: _activeVisualTakeId, shotGridTakes: _shotGridTakes, activeShotGridTakeId: _activeShotGridTakeId, ...page }) => page),
    panels: board.panels.map((panel) => Object.fromEntries(
      Object.entries(panel).filter(([key]) => key !== "visualTakes" && key !== "activeVisualTakeId"),
    )),
  };
};

const boardValue = (workflow: Pick<ManualStoryboardBoardWorkflow, "performanceBeat" | "board">) => ({
  performanceBeat: workflow.performanceBeat || null,
  board: boardStructureValue(workflow.board),
});

export const projectShotForManualStoryboardPrompt = (shot: Shot) => ({
  ...(shot.directing ? { directing: shot.directing } : {}),
      id: shot.id,
  ...(shot.appearance ? { appearance: shot.appearance } : {}),
      duration: shot.duration || 0,
      motivation: shot.motivation || "",
      visualAction: shot.visualAction || "",
      microExpression: shot.microExpression || "",
      ...(shot.soundDesign ? { soundDesign: shot.soundDesign } : {}),
      ...(shot.editingNote ? { editingNote: shot.editingNote } : {}),
      ...(shot.transition ? { transition: shot.transition } : {}),
      shotSize: shot.shotSize || "",
      cameraAngle: shot.cameraAngle || "",
      cameraMovement: shot.cameraMovement || "",
      focalLength: shot.focalLength || "",
      composition: shot.composition || "",
      blocking: shot.blocking || "",
      continuityNote: shot.continuityNote || "",
      lightingAtmo: shot.lightingAtmo || "",
      characterIdsInShot: shot.characterIdsInShot || [],
      locationId: shot.locationId || "",
      propIds: shot.propIds || [],
      vehicleIds: shot.vehicleIds || [],
      dialogueLines: shot.dialogueLines || [],
});

export const buildManualBoardStrategySourceHash = (storyboardSourceHash: string, shot: Shot) =>
  manualStoryboardHash({ storyboardSourceHash, shot: projectShotForManualStoryboardPrompt(shot) });

export const buildManualBoardWorkflowStrategySourceHash = (
  storyboardSourceHash: string,
  shots: Shot[],
) => shots.length <= 1
  ? buildManualBoardStrategySourceHash(storyboardSourceHash, shots[0])
  : manualStoryboardHash({
      storyboardSourceHash,
      videoUnitShots: shots.map(projectShotForManualStoryboardPrompt),
    });

export const buildManualBoardSourceHash = (
  strategySourceHash: string,
  decision: ManualStoryboardStrategyDecision,
) => manualStoryboardHash({ strategySourceHash, strategy: strategyValue(decision) });

export const buildManualBoardOutputHash = (workflow: Pick<ManualStoryboardBoardWorkflow, "performanceBeat" | "board">) =>
  manualStoryboardHash(boardValue(workflow));

export const buildManualBoardQASourceHash = (boardOutputHash: string) =>
  manualStoryboardHash({ boardOutputHash });

export const buildManualVideoStoryboardReadModel = ({
  workflows,
  workflowOverride,
  shot,
  storyboardSourceHash,
  project,
  assets,
  scene,
}: {
  workflows?: ManualStoryboardBoardWorkflow[];
  workflowOverride?: ManualStoryboardBoardWorkflow;
  shot: Shot;
  storyboardSourceHash: string;
  project?: Project;
  assets?: ManualProductionAssetReadModel;
  scene?: Scene;
}): ManualVideoStoryboardReadModel => {
  const workflow = workflowOverride?.unitSchema === "storyboard_unit.v1"
    ? workflowOverride
    : workflows?.find((item) => item.unitSchema === "storyboard_unit.v1" && (
      item.shotIds || item.board?.shotIds || [item.shotId]
    ).includes(shot.id));
  const workflowShotIds = workflow
    ? unique([...(workflow.shotIds || []), ...(workflow.board?.shotIds || []), workflow.shotId])
    : [shot.id];
  const workflowShots = workflowShotIds
    .map((id) => (scene?.shots || [shot]).find((candidate) => candidate.id === id))
    .filter((candidate): candidate is Shot => Boolean(candidate));
  const strategySourceHash = buildManualBoardWorkflowStrategySourceHash(
    storyboardSourceHash,
    workflowShots.length ? workflowShots : [shot],
  );
  const strategyOutputHash = workflow?.strategyDecision ? manualStoryboardHash(strategyValue(workflow.strategyDecision)) : "";
  const strategyStale = Boolean(workflow?.strategyRecord && (
    workflow.strategyRecord.sourceHash !== strategySourceHash ||
    workflow.strategyRecord.outputHash !== strategyOutputHash
  ));
  const strategyStatus: ManualVideoStoryboardStatus = !workflow?.strategyDecision || !workflow.strategyRecord
    ? "missing"
    : strategyStale ? "stale" : "ready";

  const boardSourceHash = workflow?.strategyDecision
    ? buildManualBoardSourceHash(strategySourceHash, workflow.strategyDecision)
    : undefined;
  const boardOutputHash = workflow?.board ? buildManualBoardOutputHash(workflow) : "";
  const boardStale = Boolean(workflow?.boardRecord && (
    workflow.boardRecord.sourceHash !== boardSourceHash ||
    workflow.boardRecord.outputHash !== boardOutputHash
  ));
  const boardStatus: ManualVideoStoryboardStatus = !workflow?.board || !workflow.boardRecord
    ? "missing"
    : boardStale ? "stale" : "ready";

  const qaSourceHash = boardOutputHash ? buildManualBoardQASourceHash(boardOutputHash) : undefined;
  const qaStale = Boolean(workflow?.qa && (strategyStale || boardStale || workflow.qa.sourceHash !== qaSourceHash));
  let qaStatus: ManualVideoStoryboardStatus = !workflow?.qa
    ? "missing"
    : qaStale ? "stale"
      : workflow.qa.verdict === "pass" ? (workflow.confirmedAt ? "confirmed" : "ready") : "needs_revision";
  const resolvedUnitVideoPrompt = workflow
    ? resolveStoryboardUnitVideoPrompt({ workflow, shots: workflowShots.length ? workflowShots : [shot] })
    : { text: "", sourceHash: "", promptHash: "", status: "missing" as const };
  const videoPromptLayerStatus = getManualVideoPromptLayerStatus({ scene, sourceHash: storyboardSourceHash });
  const videoPromptLayerConfirmed = videoPromptLayerStatus === "ready";
  const unitVideoPromptStatus: ManualVideoStoryboardStatus = videoPromptLayerConfirmed
    ? resolvedUnitVideoPrompt.status
    : videoPromptLayerStatus;
  const panels = workflow?.board?.panels || [];
  const visualPanelCount = panels.length;
  const legacyPanelVisualStates = panels.map((panel) => {
    const referenceSelection = assets ? selectStoryboardPanelVisualReferences({ panel, shot, assets, scene }) : undefined;
    const sourceHash = buildStoryboardPanelVisualSourceHash({
      storyboardSourceHash,
      boardOutputHash,
      panel,
      project,
      references: referenceSelection?.selected,
      styleAnchor: referenceSelection?.styleAnchor,
      imagePrompt: shot.imagePrompt,
    });
    const take = getActiveStoryboardPanelVisualTake(panel);
    if (take?.sourceHash === sourceHash && take.status === "adopted") {
      return isStoryboardPanelVisualTakeApproved(take) ? "ready" as const : "needs_revision" as const;
    }
    const candidate = getLatestStoryboardPanelVisualCandidate(panel, sourceHash);
    if (candidate?.review?.mode === "manual" && candidate.review.status === "pending") return "needs_review" as const;
    if (take && (take.sourceHash !== sourceHash || take.status === "stale")) return "stale" as const;
    return "missing" as const;
  });
  const legacyReadyVisualPanelCount = legacyPanelVisualStates.filter((status) => status === "ready").length;
  const legacyPanelVisualStatus: ManualVideoStoryboardStatus = !visualPanelCount || legacyPanelVisualStates.includes("missing")
    ? "missing"
    : legacyPanelVisualStates.includes("stale")
      ? "stale"
      : legacyPanelVisualStates.includes("needs_revision")
        ? "needs_revision"
        : legacyPanelVisualStates.includes("needs_review")
          ? "needs_review"
          : "ready";
  const visualPages = workflow?.board
    ? (workflow.board.visualPages?.length ? workflow.board.visualPages : buildStoryboardCompositeVisualPages(workflow.board))
    : [];
  const pageVisualStates = visualPages.map((page) => {
    if (!workflow?.board || !project) return "missing" as const;
    const pageBoard = scopeStoryboardCompositeBoardToPage(workflow.board, page);
    const pageShotIds = new Set(pageBoard.shotIds);
    const pageShots = (scene?.shots || [shot]).filter((candidate) => pageShotIds.has(candidate.id));
    const pageReferenceSelection = assets
      ? selectStoryboardCompositeBoardReferences({ project, board: pageBoard, shots: pageShots, assets })
      : undefined;
    const sourceHash = buildStoryboardCompositeBoardSourceHash({
      project,
      board: {
        ...workflow.board,
        shotCellManifest: buildStoryboardShotCellManifest({ board: pageBoard, shots: pageShots }),
      },
      page,
      references: pageReferenceSelection?.selected || [],
      shots: pageShots,
    });
    const take = getActiveStoryboardBoardVisualTake(page);
    if (take?.sourceHash === sourceHash && take.status === "adopted") {
      return isStoryboardBoardVisualTakeApproved(take) ? "ready" as const : "needs_revision" as const;
    }
    const candidate = getLatestStoryboardBoardVisualCandidate(page, sourceHash);
    if (candidate?.review?.mode === "manual" && candidate.review.status === "pending") return "needs_review" as const;
    if (take && (take.sourceHash !== sourceHash || take.status === "stale")) return "stale" as const;
    return "missing" as const;
  });
  const visualPageCount = visualPages.length;
  const boardVisualStatus: ManualVideoStoryboardStatus = !visualPageCount || pageVisualStates.includes("missing")
    ? "missing"
    : pageVisualStates.includes("stale")
      ? "stale"
      : pageVisualStates.includes("needs_revision")
        ? "needs_revision"
        : pageVisualStates.includes("needs_review")
          ? "needs_review"
          : "ready";
  const usesCompositeVisual = visualPages.some((page) => (page.visualTakes?.length || 0) > 0 || Boolean(page.activeShotGridTakeId))
    || Boolean(project && assets && visualPageCount > 0);
  const usesIndependentGrid = workflow?.board?.visualReferenceMode !== "director_board" && visualPages.some((page) => Boolean(page.activeShotGridTakeId || resolveStoryboardShotGridImage(page)));
  const gridStates = workflow?.board ? visualPages.map((page) => storyboardShotGridStatus({ board: workflow.board!, page, shots: scene?.shots || [shot] })) : [];
  const gridStatus: ManualVideoStoryboardStatus = !gridStates.length || gridStates.includes("missing") ? "missing" : gridStates.includes("stale") ? "stale" : "ready";
  const panelVisualStatus = usesIndependentGrid ? gridStatus : usesCompositeVisual ? boardVisualStatus : legacyPanelVisualStatus;
  const readyVisualPageCount = (usesIndependentGrid ? gridStates : pageVisualStates).filter((status) => status === "ready").length;
  const creatorConfirmedByVisualAdoption = usesCompositeVisual
    ? boardVisualStatus === "ready" && visualPages.every((page) => {
        const take = getActiveStoryboardBoardVisualTake(page);
        return take?.review?.mode === "manual" && take.review.status === "approved";
      })
    : legacyPanelVisualStatus === "ready" && panels.every((panel) => {
        const take = getActiveStoryboardPanelVisualTake(panel);
        return take?.review?.mode === "manual" && take.review.status === "approved";
      });
  if (qaStatus === "ready" && creatorConfirmedByVisualAdoption) qaStatus = "confirmed";
  // A visual reference page has one representative cell per Shot; internal
  // micro-beat panels remain part of directing structure but are not cells.
  const readyVisualPanelCount = usesCompositeVisual
    ? (panelVisualStatus === "ready" ? visualPages.reduce((sum, page) => sum + page.panelIds.length, 0) : 0)
    : legacyReadyVisualPanelCount;
  const studioSourceHash = qaSourceHash
    ? manualStoryboardHash({
        qaSourceHash,
        unitVideoPromptSourceHash: resolvedUnitVideoPrompt.sourceHash,
        unitVideoPromptHash: resolvedUnitVideoPrompt.promptHash,
        visualReferenceMode: workflow?.board?.visualReferenceMode || "shot_grid",
        ...(usesCompositeVisual ? {
          compositeBoardVisuals: visualPages.map((page) => {
            const take = getActiveStoryboardBoardVisualTake(page);
            return {
              pageId: page.id,
              takeId: take?.id || "",
              sourceHash: take?.sourceHash || "",
              imageUrl: take?.imageUrl || "",
              videoReferenceImageUrl: resolveStoryboardShotGridImage(page) || "",
              ...(getActiveStoryboardShotGridTake(page) ? { shotGridSourceHash: getActiveStoryboardShotGridTake(page)!.sourceHash } : {}),
            };
          }),
        } : {
          legacyPanelVisuals: panels.map((panel) => {
            const take = getActiveStoryboardPanelVisualTake(panel);
            return { panelId: panel.id, takeId: take?.id || "", sourceHash: take?.sourceHash || "", imageUrl: take?.imageUrl || "" };
          }),
        }),
      })
    : undefined;
  const staleReasons: string[] = [];
  if (strategyStale) staleReasons.push("Shot、视觉提示词或上游正式资产有更新；已保留故事板策略，可按需重选。");
  if (boardStale) staleReasons.push("策略或 Shot 有更新；已保留故事板结构和提示词，可按需重建。");
  if (qaStale) staleReasons.push("故事板内容有更新；已保留原确认，可按需复核。");
  if (!videoPromptLayerConfirmed) staleReasons.push("本场视频提示词尚未独立生成并确认，不能进入摄影棚。");
  else if (unitVideoPromptStatus === "missing") staleReasons.push("视频单元提示词尚未建立，请根据当前分镜重建后再进入摄影棚。");
  if (unitVideoPromptStatus === "stale") staleReasons.push("分镜顺序、时长、对白或声音有更新；已保留视频单元提示词，可按需整理。");
  if (panelVisualStatus === "missing") staleReasons.push(usesIndependentGrid ? "本单元仍有宫格页未合成。" : "完整多格故事板页尚未生成并采用。");
  if (panelVisualStatus === "stale") staleReasons.push(usesIndependentGrid ? "宫格来源待更新或核对；已保留旧宫格，可直接更新宫格图。" : "Shot、故事板结构或正式资产有更新；已保留原整板图，可按需重绘。");
  if (panelVisualStatus === "needs_review") staleReasons.push("完整故事板候选页已生成，等待创作者整板看图采用；系统没有伪造自动质检分数。");
  if (panelVisualStatus === "needs_revision") staleReasons.push("完整故事板页视觉质检尚未通过，需要整板重绘或专业接管。");
  const assetReferencePackStatus: ManualVideoStoryboardStatus = strategyStatus === "missing"
    ? "missing"
    : strategyStatus === "stale" ? "stale" : "ready";
  const videoGenerationUnitStatus: ManualVideoStoryboardStatus = strategyStale || boardStale || qaStale || panelVisualStatus === "stale" || unitVideoPromptStatus === "stale"
    ? "stale"
    : qaStatus === "confirmed" && unitVideoPromptStatus === "ready" ? "ready" : "missing";
  const staleScopes = new Set<"StoryboardBoard" | "AssetReferencePack" | "VideoGenerationUnit">();
  if (strategyStale) {
    staleScopes.add("StoryboardBoard");
    staleScopes.add("AssetReferencePack");
    staleScopes.add("VideoGenerationUnit");
  }
  if (boardStale) {
    staleScopes.add("StoryboardBoard");
    staleScopes.add("VideoGenerationUnit");
  }
  if (qaStale) staleScopes.add("VideoGenerationUnit");
  if (unitVideoPromptStatus === "stale") staleScopes.add("VideoGenerationUnit");
  if (panelVisualStatus === "stale" || panelVisualStatus === "needs_revision") staleScopes.add("VideoGenerationUnit");
  const strategyAccepted = Boolean(
    workflow?.strategyDecision
    && workflow.strategyRecord?.adoptedAt
    && workflow.strategyRecord.outputHash === strategyOutputHash,
  );
  const boardAccepted = Boolean(
    workflow?.board
    && workflow.boardRecord?.adoptedAt
    && workflow.boardRecord.outputHash === boardOutputHash,
  );
  const qaAccepted = Boolean(
    workflow?.qa
    && workflow.qa.verdict === "pass"
    && workflow.qa.sourceHash === qaSourceHash
    && (workflow.confirmedAt || creatorConfirmedByVisualAdoption),
  );
  const unitVideoPromptAccepted = unitVideoPromptStatus === "ready";

  return {
    schemaVersion: "manual-video-storyboard-read-model.v1",
    workflow,
    strategySourceHash,
    boardSourceHash,
    qaSourceHash,
    studioSourceHash,
    unitVideoPromptSourceHash: resolvedUnitVideoPrompt.sourceHash || undefined,
    unitVideoPromptHash: resolvedUnitVideoPrompt.promptHash || undefined,
    unitVideoPromptStatus,
    effectiveUnitVideoPrompt: resolvedUnitVideoPrompt.text,
    strategyStatus,
    boardStatus,
    qaStatus,
    panelVisualStatus,
    boardVisualStatus,
    visualPanelCount,
    readyVisualPanelCount,
    visualPageCount,
    readyVisualPageCount,
    assetReferencePackStatus,
    videoGenerationUnitStatus,
    staleScopes: Array.from(staleScopes),
    readyForBoardGeneration: strategyAccepted,
    readyForBoardQA: strategyAccepted && boardAccepted,
    readyForStudio: boardAccepted,
    staleReasons,
  };
};

export const normalizeManualStoryboardStrategy = (value: unknown): ManualStoryboardStrategyDecision => {
  const source = object(value);
  const resolution = object(source.strategyResolution);
  const selectedStrategyId = resolveStoryboardStrategyId(source.selectedStrategyId);
  const selectedStrategy = getStoryboardPromptStrategyById(selectedStrategyId);
  const arrowLegendIds = unique([
    ...normalizeLegendIds(source.arrowLegendIds),
    ...coreStoryboardLegendIds,
  ]);
  return {
    selectedStrategyId,
    selectedStrategyVersion: selectedStrategy?.version || text(source.selectedStrategyVersion),
    selectedModelProfileId: text(source.selectedModelProfileId),
    rationale: text(source.rationale),
    rejectedStrategyIds: strings(source.rejectedStrategyIds),
    riskNotes: strings(source.riskNotes),
    expectedBoardShape: text(source.expectedBoardShape),
    expectedVideoUnitDurationSeconds: number(source.expectedVideoUnitDurationSeconds),
    expectedReferenceImageCount: number(source.expectedReferenceImageCount),
    expectedReferenceVideoCount: number(source.expectedReferenceVideoCount),
    arrowLegendIds,
    qaChecklist: strings(source.qaChecklist),
    strategyResolution: Object.keys(resolution).length ? {
      mode: ["built_in_preset", "composed_recipe", "project_local_draft_required"].includes(text(resolution.mode))
        ? text(resolution.mode) as "built_in_preset" | "composed_recipe" | "project_local_draft_required"
        : "built_in_preset",
      primaryStrategyId: resolveStoryboardStrategyId(resolution.primaryStrategyId || selectedStrategyId),
      modifierStrategyIds: strings(resolution.modifierStrategyIds).map(resolveStoryboardStrategyId),
      requiredCapabilityIds: strings(resolution.requiredCapabilityIds),
      coveredCapabilityIds: strings(resolution.coveredCapabilityIds),
      uncoveredCapabilityIds: strings(resolution.uncoveredCapabilityIds),
      fallbackStrategyId: resolveStoryboardStrategyId(resolution.fallbackStrategyId || selectedStrategyId),
      confidence: number(resolution.confidence),
      requiresHumanApproval: Boolean(resolution.requiresHumanApproval),
      maxAutomaticRevisionAttempts: 1,
    } : undefined,
  };
};

export const validateManualStoryboardStrategy = (
  decision: ManualStoryboardStrategyDecision,
  context: StoryboardStrategySelectionContext,
): ManualVideoStoryboardIssue[] => validateStoryboardStrategyDecision(decision, context).map((item) => ({
  severity: item.severity,
  code: item.code,
  message: item.message,
}));

export const buildManualStoryboardStrategyCatalog = () => STORYBOARD_PROMPT_STRATEGIES
  .filter((strategy) => strategy.status === "active")
  .map((strategy) => ({
    id: strategy.id,
    version: strategy.version,
    name: strategy.name,
    boardMode: strategy.boardMode,
    recommendedWhen: strategy.recommendedWhen,
    avoidWhen: strategy.avoidWhen,
    outputContract: strategy.outputContract,
    qaChecklist: strategy.qaChecklist,
    capabilityIds: getStoryboardStrategyCapabilityIds(strategy.id),
    compositionRole: getStoryboardStrategyCompositionRole(strategy.id),
  }));

export const buildManualStoryboardModelCatalog = () => VIDEO_MODEL_PROFILES.map((profile) => ({
  id: profile.id,
  provider: profile.provider,
  model: profile.model,
  minDurationSeconds: profile.minDurationSeconds,
  maxDurationSeconds: profile.maxDurationSeconds,
  preferredDurationsSeconds: profile.preferredDurationsSeconds,
  supportsReferenceImages: profile.supportsReferenceImages,
  maxReferenceImages: profile.maxReferenceImages,
  supportsReferenceVideos: profile.supportsReferenceVideos,
  maxReferenceVideos: profile.maxReferenceVideos,
  supportsStartEndFrames: profile.supportsStartEndFrames,
  aspectRatios: profile.aspectRatios,
}));

export const buildManualStoryboardStrategyContext = ({
  shot,
  projectFormat,
  aspectRatio,
  referenceImageCount,
}: {
  shot: Shot;
  projectFormat: string;
  aspectRatio: string;
  referenceImageCount: number;
}): StoryboardStrategySelectionContext => ({
  projectFormat,
  dialogueLineCount: shot.dialogueLines?.length || 0,
  expectedVideoUnitDurationSeconds: shot.duration || 0,
  expectedReferenceImageCount: referenceImageCount,
  expectedReferenceVideoCount: 0,
  targetAspectRatio: aspectRatio,
  availableStrategyIds: STORYBOARD_PROMPT_STRATEGIES.filter((item) => item.status === "active").map((item) => item.id),
});

export const normalizeManualStoryboardBoard = ({
  value,
  episodeId,
  sceneId,
  shot,
  decision,
}: {
  value: unknown;
  episodeId: string;
  sceneId: string;
  shot: Shot;
  decision: ManualStoryboardStrategyDecision;
}): Pick<ManualStoryboardBoardWorkflow, "performanceBeat" | "board"> => {
  const source = object(value);
  const beatSource = object(source.performanceBeat);
  const boardSource = object(source.board);
  const panels = Array.isArray(boardSource.panels) ? boardSource.panels : [];
  const beatId = `manual-beat-${shot.id}`;
  const strategy = getStoryboardPromptStrategyById(decision.selectedStrategyId);
  const expectedCharacterIds = unique(shot.characterIdsInShot || []);
  const expectedPropIds = unique(shot.propIds || []);
  const expectedVehicleIds = unique(shot.vehicleIds || []);
  const expectedLocationId = text(shot.locationId) || undefined;
  const expectedAssetIds = unique([
    ...expectedCharacterIds,
    ...(expectedLocationId ? [expectedLocationId] : []),
    ...expectedPropIds,
    ...expectedVehicleIds,
  ]);
  const expectedAssetIdSet = new Set(expectedAssetIds);
  const beatCharacterIds = strings(beatSource.characterIds).filter((id) => expectedCharacterIds.includes(id));
  const beatPropIds = strings(beatSource.propIds).filter((id) => expectedPropIds.includes(id));
  const beatLocationId = text(beatSource.locationId);
  const performanceBeat: ManualStoryboardPerformanceBeat = {
    id: beatId,
    episodeId,
    sceneId,
    shotId: shot.id,
    scriptBlockIds: strings(beatSource.scriptBlockIds),
    beatType: ["dialogue", "action", "combat", "emotion", "reveal", "transition", "interactive_idle"].includes(text(beatSource.beatType))
      ? text(beatSource.beatType) as ManualStoryboardPerformanceBeat["beatType"]
      : "action",
    summary: text(beatSource.summary),
    visibleChange: text(beatSource.visibleChange),
    startState: text(beatSource.startState),
    endState: text(beatSource.endState),
    durationSeconds: Number(shot.duration || 0) || number(beatSource.durationSeconds),
    characterIds: beatCharacterIds.length ? beatCharacterIds : expectedCharacterIds,
    locationId: beatLocationId === expectedLocationId ? beatLocationId : expectedLocationId,
    propIds: beatPropIds.length ? beatPropIds : expectedPropIds,
    soundCues: strings(beatSource.soundCues),
    continuityIn: text(beatSource.continuityIn),
    continuityOut: text(beatSource.continuityOut),
  };
  const normalizedPanels: ManualStoryboardBoard["panels"] = panels.map((item, index) => {
    const panel = object(item);
    const assetRefs = unique(strings(panel.assetRefs).filter((id) => expectedAssetIdSet.has(id)));
    const actionArrowLegendIds = normalizeLegendIds(panel.actionArrowLegendIds, decision.arrowLegendIds);
    const annotationLegendIds = normalizeLegendIds(panel.annotationLegendIds, actionArrowLegendIds);
    return {
      id: `manual-panel-${shot.id}-${index + 1}`,
      panelNumber: index + 1,
      shotId: shot.id,
      durationSeconds: number(panel.durationSeconds) || undefined,
      framePurpose: text(panel.framePurpose),
      shotType: text(panel.shotType) || undefined,
      visualBeat: text(panel.visualBeat) || undefined,
      cameraNote: text(panel.cameraNote) || undefined,
      framing: text(panel.framing) || undefined,
      lens: text(panel.lens) || undefined,
      angle: text(panel.angle) || undefined,
      cameraMove: text(panel.cameraMove) || undefined,
      subjectAction: text(panel.subjectAction) || undefined,
      blocking: text(panel.blocking) || undefined,
      lightingCue: text(panel.lightingCue) || undefined,
      soundCue: text(panel.soundCue) || undefined,
      emotionCue: text(panel.emotionCue) || undefined,
      compositionNote: text(panel.compositionNote) || undefined,
      continuityIn: text(panel.continuityIn) || undefined,
      continuityOut: text(panel.continuityOut) || undefined,
      assetRefs: assetRefs.length ? assetRefs : expectedAssetIds,
      annotationLegendIds,
      actionArrowLegendIds,
      dialogueOrSoundCue: text(panel.dialogueOrSoundCue) || undefined,
      renderInstruction: text(panel.renderInstruction) || undefined,
    };
  });
  const durationNormalizedPanels = normalizeStoryboardPanelDurations(normalizedPanels, Number(shot.duration || 0));
  const layout = normalizeStoryboardLayout(boardSource.layout, durationNormalizedPanels.length);
  const board: ManualStoryboardBoard = {
    id: `manual-board-${shot.id}`,
    episodeId,
    sceneId,
    shotId: shot.id,
    strategyDecision: decision,
    boardMode: strategy?.boardMode || "",
    layout,
    lineArtPrompt: buildCanonicalStoryboardLineArtPrompt({ layout, panels: durationNormalizedPanels, legendIds: decision.arrowLegendIds }),
    arrowLegendIds: decision.arrowLegendIds,
    performanceBeatIds: [beatId],
    scriptBlockIds: performanceBeat.scriptBlockIds,
    shotIds: [shot.id],
    videoGenerationUnitId: `manual-video-unit-${shot.id}`,
    visualReferenceMode: "shot_grid",
    strategyOrigin: "built_in",
    panels: durationNormalizedPanels,
    startState: text(boardSource.startState) || performanceBeat.startState,
    endState: text(boardSource.endState) || performanceBeat.endState,
  };
  board.visualPages = buildStoryboardCompositeVisualPages(board);
  return { performanceBeat, board };
};

export const validateManualStoryboardBoard = ({
  workflow,
  strategyContext,
  allowedAssetIds,
  shot,
}: {
  workflow: Pick<ManualStoryboardBoardWorkflow, "performanceBeat" | "board">;
  strategyContext: StoryboardStrategySelectionContext;
  allowedAssetIds: string[];
  shot: Shot;
}): ManualVideoStoryboardIssue[] => {
  if (!workflow.performanceBeat || !workflow.board) {
    return [{ severity: "blocking", code: "BOARD_DRAFT_EMPTY", message: "模型没有返回完整表演节拍和故事板。" }];
  }
  const issues: ManualVideoStoryboardIssue[] = [
    ...validatePerformanceBeats([workflow.performanceBeat]).map((item) => ({
      severity: item.code === "PERFORMANCE_BEAT_SCRIPT_LINK_WEAK" ? "advisory" as const : item.severity,
      code: item.code,
      message: item.message,
    })),
    ...validateStoryboardBoard(workflow.board as unknown as StoryboardBoard, strategyContext).map((item) => ({ severity: item.severity, code: item.code, message: item.message })),
  ];
  const allowed = new Set(allowedAssetIds);
  const expected = new Set([...(shot.characterIdsInShot || []), shot.locationId, ...(shot.propIds || []), ...(shot.vehicleIds || [])].filter(Boolean));
  for (const assetId of [
    ...workflow.performanceBeat.characterIds,
    workflow.performanceBeat.locationId,
    ...workflow.performanceBeat.propIds,
    ...workflow.board.panels.flatMap((panel) => panel.assetRefs),
  ].filter(Boolean) as string[]) {
    if (!allowed.has(assetId)) issues.push({ severity: "blocking", code: "BOARD_ASSET_OUTSIDE_SCENE_PACK", message: `故事板引用了当前场景正式资产包之外的资产：${assetId}` });
    if (!expected.has(assetId)) issues.push({ severity: "warning", code: "BOARD_ASSET_OUTSIDE_SHOT", message: `故事板引用了当前视频单元未声明的资产：${assetId}` });
  }
  return Array.from(new Map(issues.map((item) => [`${item.code}:${item.message}`, item])).values());
};

export const normalizeManualStoryboardQA = (
  value: unknown,
  sourceHash: string,
  audit: ManualStoryboardBoardQA["audit"],
  reviewedAt: number,
): ManualStoryboardBoardQA => {
  const source = object(value);
  const rawIssues = Array.isArray(source.issues) ? source.issues : [];
  return {
    score: Math.max(0, Math.min(100, number(source.score))),
    verdict: source.verdict === "pass" ? "pass" : "revise",
    summary: text(source.summary),
    strengths: strings(source.strengths),
    issues: rawIssues.map((item) => {
      const entry = object(item);
      const severity: "blocking" | "warning" | "advisory" = entry.severity === "blocking" || entry.severity === "advisory" ? entry.severity : "warning";
      return { severity, description: text(entry.description), suggestion: text(entry.suggestion) };
    }).filter((item) => item.description),
    sourceHash,
    audit,
    reviewedAt,
  };
};

export const upsertManualStoryboardBoardWorkflow = (
  workflows: ManualStoryboardBoardWorkflow[] | undefined,
  workflow: ManualStoryboardBoardWorkflow,
) => {
  const identity = storyboardBoardWorkflowIdentity(workflow);
  return [
    ...(workflows || []).filter((item) => storyboardBoardWorkflowIdentity(item) !== identity),
    workflow,
  ];
};

export const manualStoryboardLegendCatalog = STORYBOARD_ARROW_LEGEND;
