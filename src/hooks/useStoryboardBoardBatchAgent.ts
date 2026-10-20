import { isManualAIExecution } from "../../apps/web/src/clients/manualAIClient";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { ensureAIProviderTaskReady, generateAIContent, generateAIImage } from "../clients/aiClient";
import {
  buildImageVisualStyleProjection,
  buildShotImageVisualRecipeInputEvidence,
  resolveImageVisualStyleProjectionContext,
} from "../clients/productionVisualImageClient";
import { useAIConfigStore } from "../clients/stateClient";
import type { Episode, ManualStoryboardAgentExecutionAudit, ManualStoryboardAgentQuality, ManualStoryboardBoardVisualPage, ManualStoryboardBoardVisualTake, ManualStoryboardBoardWorkflow, ManualStoryboardPromptAudit, Project, Scene, Shot } from "../clients/domainTypes";
import type { PromptEditorConfirmMetadata } from "../components/PromptEditorModal";
import {
  createImageGenerationReference,
  createPreviousOutputRepairOperation,
  type CompiledImageGenerationRequest,
} from "../clients/productionStudioWorkflowClient";
import {
  buildManualBoardOutputHash,
  buildManualBoardQASourceHash,
  buildManualBoardSourceHash,
  buildManualBoardStrategySourceHash,
  buildManualBoardWorkflowStrategySourceHash,
  buildManualStoryboardModelCatalog,
  buildManualStoryboardStrategyCatalog,
  normalizeManualStoryboardBoard,
  normalizeManualStoryboardStrategy,
  projectShotForManualStoryboardPrompt,
} from "../clients/productionStoryboardWorkflowClient";
import { manualStoryboardHash } from "../clients/productionStoryboardWorkflowClient";
import { appearanceSourceShots, requireAppearanceReady } from "../clients/productionStoryboardWorkflowClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
  buildStoryboardBoardBatchPrompt,
  buildStoryboardBoardBatchQualityPrompt,
  buildStoryboardBoardBatchRepairPrompt,
  getActionableStoryboardBoardIssues,
  getIncompleteStoryboardBoardShotIds,
  mergeStoryboardBoardBatchValues,
  normalizeStoryboardBoardQualityWithEvidence,
  normalizeStoryboardBoardBatch,
  scoreStoryboardBoardCandidateCompleteness,
  shouldStopStoryboardRepairCycle,
  splitStoryboardBoardShots,
  STORYBOARD_BOARD_AGENT_MAX_REPAIRS,
  STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES,
  storyboardBoardBatchSchema,
  storyboardBoardQualitySchema,
  validateStoryboardBoardBatch,
  type StoryboardBoardBatchIssue,
  type StoryboardBoardBatchValue,
} from "../clients/productionStoryboardWorkflowClient";
import {
  isStoryboardAgentQualityPassing,
  normalizeStoryboardAgentQuality,
  resolveStoryboardQualityTargetShotId,
  storyboardShotQualitySchema,
} from "../clients/productionStoryboardWorkflowClient";
import type { ManualFilmTeamReadModel } from "../clients/productionPreparationWorkflowClient";
import type { ManualProductionAssetReadModel } from "../clients/productionAssetWorkflowClient";
import {
  appendStoryboardBoardVisualTake,
  buildStoryboardCompositeBoardPrompt,
  buildStoryboardCompositeBoardQAPrompt,
  buildStoryboardCompositeBoardSourceHash,
  buildStoryboardShotCellManifest,
  buildStoryboardShotGridSourceHash,
  buildStoryboardCompositeVisualPages,
  composeStoryboardCompositeWorkflowGroup,
  getLatestStoryboardBoardVisualCandidate,
  isStoryboardBoardVisualQualityPassing,
  isStoryboardBoardVisualReady,
  reconcileStoryboardCompositeVisualPages,
  scopeStoryboardCompositeBoardToPage,
  selectStoryboardCompositeBoardReferences,
  stageStoryboardBoardVisualTakeForCreatorReview,
  STORYBOARD_COMPOSITE_BOARD_CONTRACT_VERSION,
  STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS,
  validateStoryboardCompositeBoardContract,
} from "../clients/productionStoryboardWorkflowClient";
import { gatherContextOptions } from "../utils/contextMapper";
import { imageUrlToMediaData, inspectImageTechnicalMetadata } from "../utils/imageMediaData";
import { createAIGeneratedMediaReference } from "../utils/mediaProvenance";
import { safeParseAIResponse } from "../utils/aiParser";
import { summarizeUnknownError } from "../utils/logging";
import { persistProjectMediaUrl } from "../clients/projectMediaClient";
import {
  buildStoryboardBoardOverlaySpec,
  renderStoryboardBoardOverlay,
  renderStoryboardShotGrid,
} from "../clients/productionAssetWorkflowClient";
import { buildStoryboardUnitVideoPromptRecord } from "../clients/productionStoryboardWorkflowClient";
import { resolveImageModelCapabilities } from "../clients/productionStudioWorkflowClient";

export interface StoryboardBoardBatchSceneContext {
  scene: Scene;
  boardDraftReady: boolean;
  boardFormalReady: boolean;
  boardVisualBlockReason?: string;
  boardComplete: boolean;
  storyboardSourceHash: string;
  filmTeam: ManualFilmTeamReadModel;
  assets: ManualProductionAssetReadModel;
  filmTeamContext: string;
  assetContext: string;
  boardAllowedAssetIds: string[];
}

export interface StoryboardBoardBatchPromptRequest {
  templateId: "storyboard.board.plan";
  title: string;
  scope: { kind: "segment" | "scene"; sceneIds: string[] };
  variables: Record<string, string>;
  contextOptions: { id: string; label: string; value: string }[];
  defaultSelectedContextIds: string[];
}

export interface StoryboardBoardBatchProgress {
  phase: "idle" | "generating" | "checking" | "repairing" | "completed" | "needs_decision" | "failed";
  label: string;
  sceneId?: string;
  sceneTitle?: string;
  attempt: number;
  maxAttempts: number;
  completedScenes: number;
  totalScenes: number;
  score?: number;
  issues?: string[];
  shotId?: string;
  panelId?: string;
  panelNumber?: number;
  completedPanels?: number;
  totalPanels?: number;
}

const initialProgress: StoryboardBoardBatchProgress = {
  phase: "idle",
  label: "",
  attempt: 0,
  maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1,
  completedScenes: 0,
  totalScenes: 0,
};

const sceneSummary = (context: StoryboardBoardBatchSceneContext) => ({
  sceneId: context.scene.id,
  title: context.scene.title,
  shotCount: context.scene.shots?.length || 0,
  ready: context.boardDraftReady,
  formalReady: context.boardFormalReady,
  completed: context.boardComplete,
  missingReferenceBoards: context.assets.missingReferenceCount,
});

const executionAudit = ({
  action,
  prompt,
  modelId,
  startedAt,
  result,
  error,
}: {
  action: ManualStoryboardAgentExecutionAudit["action"];
  prompt: string;
  modelId: string;
  startedAt: number;
  result?: unknown;
  error?: unknown;
}): ManualStoryboardAgentExecutionAudit => ({
  action,
  prompt,
  promptHash: manualStoryboardHash(prompt),
  modelId,
  status: error ? "failed" : "succeeded",
  resultHash: result === undefined ? undefined : manualStoryboardHash(result),
  startedAt,
  completedAt: Date.now(),
  error: error ? summarizeUnknownError(error).message : undefined,
});

const compactStoryboardStepAudit = (audit: ManualStoryboardPromptAudit): ManualStoryboardPromptAudit => ({
  ...audit,
  promptExecutions: undefined,
});

export const getStoryboardBoardRequestShots = (
  chunkShots: Shot[],
  receivedValues: StoryboardBoardBatchValue[],
  manualExecution: boolean,
) => {
  if (!manualExecution) return chunkShots;
  const incompleteIds = new Set(getIncompleteStoryboardBoardShotIds(receivedValues, chunkShots));
  return chunkShots.filter((shot) => incompleteIds.has(shot.id));
};

export const normalizeStoryboardBoardExecutionResponse = ({
  value, episodeId, sceneId, sceneShots, requestedShots, manualExecution,
}: {
  value: unknown;
  episodeId: string;
  sceneId: string;
  sceneShots: Shot[];
  requestedShots: Shot[];
  manualExecution: boolean;
}) => normalizeStoryboardBoardBatch({
  value, episodeId, sceneId,
  // Manual returns may cover this entire scene. The normalizer rejects IDs outside this scope.
  shots: manualExecution ? sceneShots : requestedShots,
});

const combineStoryboardBatchQualities = (qualities: ManualStoryboardAgentQuality[]): ManualStoryboardAgentQuality => {
  const issues = Array.from(new Map(
    qualities.flatMap((quality) => quality.issues).map((issue) => [
      `${issue.targetShotId || "scene"}:${issue.severity}:${issue.description}`,
      issue,
    ]),
  ).values());
  const score = qualities.length ? Math.min(...qualities.map((quality) => quality.score)) : 0;
  return {
    score,
    verdict: score >= 90 && issues.every((issue) => issue.severity === "advisory") ? "pass" : "revise",
    summary: Array.from(new Set(qualities.map((quality) => quality.summary).filter(Boolean))).join("；"),
    strengths: Array.from(new Set(qualities.flatMap((quality) => quality.strengths))),
    issues,
  };
};

interface StoryboardCompositeVisualRunResult {
  page: ManualStoryboardBoardVisualPage;
  status: "passed" | "manual_review_required" | "qa_unavailable" | "quality_failed";
  issues: string[];
  score?: number;
}

const runStoryboardCompositeVisualAgent = async ({
  project,
  episodeId,
  context,
  workflow,
  initialPage,
  metadata,
  visualQcEnabled,
  visualQaModelId,
  completedScenes,
  totalScenes,
  completedPages,
  totalPages,
  onProgress,
  onPageChange,
}: {
  project: Project;
  context: StoryboardBoardBatchSceneContext;
  episodeId: string;
  workflow: ManualStoryboardBoardWorkflow;
  initialPage: ManualStoryboardBoardVisualPage;
  metadata?: PromptEditorConfirmMetadata;
  visualQcEnabled: boolean;
  visualQaModelId: string;
  completedScenes: number;
  totalScenes: number;
  completedPages: number;
  totalPages: number;
  onProgress: (progress: StoryboardBoardBatchProgress) => void;
  onPageChange: (page: ManualStoryboardBoardVisualPage) => Promise<void>;
}): Promise<StoryboardCompositeVisualRunResult> => {
  if (!workflow.board) {
    return { page: initialPage, status: "quality_failed", issues: ["当前视频单元没有完整故事板结构。"] };
  }
  const pageBoard = scopeStoryboardCompositeBoardToPage(workflow.board, initialPage);
  const pageShotIds = new Set(pageBoard.shotIds);
  const shots = (context.scene.shots || []).filter((shot) => pageShotIds.has(shot.id));
  const imageConfig = useAIConfigStore.getState();
  const imageModelId = imageConfig.routing.imageGen;
  const imageModel = imageConfig.models.find((item) => item.id === imageModelId);
  const imageChannel = imageConfig.channels.find((item) => item.id === imageModel?.channelId);
  if ((!imageModel || !imageChannel) && !isManualAIExecution()) {
    throw new Error("图像生成路由尚未配置，无法生成故事板参考图。");
  }
  const imageCapabilities = isManualAIExecution() ? { imageToImage: true, maxReferenceImages: Number.MAX_SAFE_INTEGER, familyLabel: "外部 AI / 手动上传" } : resolveImageModelCapabilities({ model: imageModel, channel: imageChannel });
  const referenceSelection = selectStoryboardCompositeBoardReferences({
    project,
    board: pageBoard,
    shots,
    assets: context.assets,
    maxReferences: imageCapabilities.imageToImage ? imageCapabilities.maxReferenceImages : 0,
  });
  if (referenceSelection.omitted.length) {
    throw new Error(`${imageCapabilities.familyLabel} 最多接受 ${imageCapabilities.maxReferenceImages} 张参考图，但当前故事板需要 ${referenceSelection.selected.length + referenceSelection.omitted.length} 张。系统不会静默丢弃资产，请在“图像生成”路由选择支持更多参考图的模型。`);
  }
  const missingReferenceIssues = referenceSelection.missingAssetIds
    .map((id) => `资产 ${id} 缺少当前场正式参考板`);
  const requiresManualReview = missingReferenceIssues.length > 0;
  let page = initialPage;
  const currentShotCellManifest = buildStoryboardShotCellManifest({ board: pageBoard, shots });
  const workflowBoardWithCurrentShotCells = {
    ...workflow.board,
    shotCellManifest: currentShotCellManifest,
  };
  const visualSourceHash = buildStoryboardCompositeBoardSourceHash({
    project,
    board: workflowBoardWithCurrentShotCells,
    page,
    references: referenceSelection.selected,
    shots,
  });
  if (isStoryboardBoardVisualReady({ page, sourceHash: visualSourceHash })) {
    return { page, status: "passed", issues: [] };
  }
  const existingCandidate = getLatestStoryboardBoardVisualCandidate(page, visualSourceHash);
  if ((!visualQcEnabled || requiresManualReview) && existingCandidate?.review?.status === "pending") {
    return { page, status: "manual_review_required", issues: missingReferenceIssues };
  }
  const projectionContext = resolveImageVisualStyleProjectionContext({ project, shots });

  let repairIssues: string[] = [];
  let previousRepairIssueFingerprint = "";
  for (let attempt = 0; attempt <= STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS; attempt += 1) {
    const previousBoardTake = attempt > 0
      ? [...(page.visualTakes || [])].reverse().find((take) => Boolean(take.imageUrl))
      : undefined;
    const generationReferences = [
      ...(previousBoardTake?.sourceImageUrl || previousBoardTake?.imageUrl ? [createImageGenerationReference({
        imageUrl: previousBoardTake.sourceImageUrl || previousBoardTake.imageUrl,
        label: "上一版故事板整页",
        role: "previous_output_repair",
        preserve: ["已通过的全部画格、格数、顺序、版式、人物身份、空间、材质与首尾状态"],
        allowChange: ["只定向修复本轮质检点名的问题，并仍然输出完整故事板页"],
        exclude: ["局部裁切、漏格、错序、重复上一版错误、文字、UI和水印"],
      })] : []),
      ...referenceSelection.selected.map((item) => createImageGenerationReference({
        imageUrl: item.referenceImageUrl!,
        label: `${item.assetName}${item.variantName ? ` · ${item.variantName}` : ""}`,
        role: item.assetType === "character"
          ? item.variantId ? "wardrobe_state" : "character_identity"
          : item.assetType === "location" ? "location_design" : item.assetType === "vehicles" ? "vehicle_design" : "prop_design",
      })),
    ];
    if (generationReferences.length > imageCapabilities.maxReferenceImages) {
      throw new Error(`${imageCapabilities.familyLabel} 最多接受 ${imageCapabilities.maxReferenceImages} 张参考图；定向重绘还需要上一版故事板作为额外参考，请减少资产引用或改用支持更多参考图的模型。`);
    }
    const visualPrompt = buildStoryboardCompositeBoardPrompt({
      project,
      scene: context.scene,
      board: workflow.board,
      page,
      shots,
      references: referenceSelection.selected,
      repairIssues,
    });
    onProgress({
      phase: attempt ? "repairing" : "generating",
      label: attempt ? "整板视觉质检未通过，Agent 正在定向重绘完整故事板页" : "正在一次生成完整多格故事板页",
      sceneId: context.scene.id,
      sceneTitle: context.scene.title,
      shotId: workflow.shotId,
      panelId: page.id,
      attempt: attempt + 1,
      maxAttempts: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
      completedScenes,
      totalScenes,
      completedPanels: completedPages,
      totalPanels: totalPages,
      issues: repairIssues,
    });
    const generationStartedAt = Date.now();
    let compiledRequest: CompiledImageGenerationRequest | undefined;
    const visualStyleProjection = buildImageVisualStyleProjection({
      project,
      intent: "storyboard_control",
      creativeScope: { episode: project.episodes.find(ep => ep.id === episodeId), scene: { ...context.scene, shots } },
      ...projectionContext,
    });
    const generatedImageUrl = await generateAIImage({
      promptCore: visualPrompt,
      aspectRatio: "16:9",
      references: generationReferences,
      visualStyleProjection,
      visualRecipeInputEvidence: buildShotImageVisualRecipeInputEvidence({ project, shots }),
      operation: previousBoardTake?.imageUrl
        ? createPreviousOutputRepairOperation({
            goal: "只修复上一版完整故事板页中本轮质检明确指出的问题",
            issues: repairIssues,
            preserve: [
              "上一版已通过的画格内容、格数、顺序、版式与镜头边界",
              "未被质检点名的人物身份、空间拓扑、道具结构、材质、光向与动作连续性",
            ],
            exclude: [
              "质检问题之外的重新设计、重新构图、身份变化或镜头增删",
              "局部裁切、漏格、错序、额外主体、可读文字、UI、水印与说明排版",
            ],
          })
        : { kind: "generate" },
      onPromptCompiled: (compiled) => {
        compiledRequest = compiled;
      },
    });
    const sourceImageUrl = await persistProjectMediaUrl(generatedImageUrl, project.id);
    const overlaySpec = buildStoryboardBoardOverlaySpec({
      project,
      scene: context.scene,
      board: workflow.board,
      page,
    });
    const shotCellManifest = currentShotCellManifest;
    const videoReferenceImageUrl = shotCellManifest.every((cell) => cell.status === "ready" && cell.imageUrl)
      ? await persistProjectMediaUrl(
          await renderStoryboardShotGrid({
            cells: shotCellManifest.map((cell) => ({ imageUrl: cell.imageUrl!, order: cell.order })),
            layout: page.layout,
          }),
          project.id,
        )
      : undefined;
    const imageUrl = await persistProjectMediaUrl(
      await renderStoryboardBoardOverlay(
        sourceImageUrl,
        overlaySpec,
      ),
      project.id,
    );
    const generationExecution = executionAudit({
      action: attempt ? "repair" : "generate",
      prompt: visualPrompt,
      modelId: imageModelId,
      startedAt: generationStartedAt,
      result: { sourceImageUrl, videoReferenceImageUrl, imageUrl },
    });
    const technical = await inspectImageTechnicalMetadata(imageUrl);
    const takeBase: ManualStoryboardBoardVisualTake = {
      id: `storyboard-board-take-${page.id}-${Date.now()}`,
      sourceImageUrl,
      sourceImageMedia: createAIGeneratedMediaReference("image", sourceImageUrl, imageModelId),
      videoReferenceImageUrl,
      videoReferenceSourceHash: videoReferenceImageUrl ? buildStoryboardShotGridSourceHash({ board: workflow.board, page, shots }) : undefined,
      videoReferenceImageMedia: videoReferenceImageUrl
        ? createAIGeneratedMediaReference("image", videoReferenceImageUrl, "deterministic-shot-grid")
        : undefined,
      imageUrl,
      imageMedia: createAIGeneratedMediaReference("image", imageUrl, imageModelId),
      sourceHash: visualSourceHash,
      prompt: visualPrompt,
      promptHash: manualStoryboardHash(visualPrompt),
      modelId: imageModelId,
      selectedSkillIds: metadata?.selectedSkillIds || [],
      selectedSkillTitles: metadata?.selectedSkillTitles || [],
      selectedContextIds: metadata?.selectedContextIds || [],
      selectedAssetBoardItemIds: referenceSelection.selected.map((item) => item.boardItemId),
      referenceImageUrls: compiledRequest?.referenceImages || generationReferences.map((reference) => reference.imageUrl),
      imageReferenceManifest: compiledRequest?.references.map((reference, index) => ({
        index: index + 1,
        imageUrl: reference.imageUrl,
        label: reference.label,
        role: reference.role,
        preserve: reference.preserve,
        allowChange: reference.allowChange,
        exclude: reference.exclude,
      })),
      promptCompositionManifest: compiledRequest?.manifest,
      visualStyleCompileManifest: compiledRequest?.visualStyleProjection?.compileManifest,
      panelIds: page.panelIds,
      attempt: attempt + 1,
      status: "candidate",
      executions: [generationExecution],
      createdAt: Date.now(),
    };

    if (technical.width > 0 && technical.height > 0 && technical.width <= technical.height) {
      const issue = `完整故事板页输出方向与本次结构化画幅不一致，实际返回 ${technical.width}x${technical.height}。`;
      page = appendStoryboardBoardVisualTake({
        page,
        take: {
          ...takeBase,
          status: "rejected" as const,
          review: { mode: visualQcEnabled ? "automatic" as const : "manual" as const, status: "rejected" as const, notes: issue, reviewedAt: Date.now() },
        },
      });
      await onPageChange(page);
      repairIssues = [issue];
      const cycle = shouldStopStoryboardRepairCycle({
        repairCount: attempt,
        maxRepairs: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS,
        previousIssueFingerprint: previousRepairIssueFingerprint,
        currentIssues: repairIssues,
      });
      previousRepairIssueFingerprint = cycle.currentIssueFingerprint;
      if (cycle.stop) {
        return { page, status: "quality_failed", issues: [...repairIssues, `自动修复已停止：${cycle.reason}。`] };
      }
      continue;
    }

    if (!visualQcEnabled || requiresManualReview) {
      const candidate: ManualStoryboardBoardVisualTake = {
        ...takeBase,
        review: {
          mode: "manual",
          status: "pending",
          notes: missingReferenceIssues.length
            ? `${missingReferenceIssues.join("；")}。候选整板可用于构图审阅，补齐正式参考后需重新生成或复核，不能进入摄影棚。`
            : undefined,
        },
      };
      page = appendStoryboardBoardVisualTake({ page, take: candidate });
      await onPageChange(page);
      return { page, status: "manual_review_required", issues: missingReferenceIssues };
    }

    onProgress({
      phase: "checking",
      label: "多模态质检 Agent 正在检查完整故事板页的格数、顺序、身份和动作连续性",
      sceneId: context.scene.id,
      sceneTitle: context.scene.title,
      shotId: workflow.shotId,
      panelId: page.id,
      attempt: attempt + 1,
      maxAttempts: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
      completedScenes,
      totalScenes,
      completedPanels: completedPages,
      totalPanels: totalPages,
    });
    const qaPrompt = buildStoryboardCompositeBoardQAPrompt({
      project,
      scene: context.scene,
      board: workflow.board,
      page,
      shots,
      references: referenceSelection.selected,
    });
    const qaStartedAt = Date.now();
    let visualQuality: ManualStoryboardAgentQuality;
    let qaExecution: ManualStoryboardAgentExecutionAudit;
    try {
      const mediaDataList = await Promise.all(
        [imageUrl, ...referenceSelection.selected.map((item) => item.referenceImageUrl!)].filter(Boolean).map((url) => imageUrlToMediaData(url!)),
      );
      const response = await generateAIContent({
        taskType: "visualQc",
        prompt: qaPrompt,
        requireJson: true,
        schema: storyboardShotQualitySchema,
        mediaDataList,
      });
      visualQuality = normalizeStoryboardAgentQuality(safeParseAIResponse<unknown>(response, {}));
      qaExecution = executionAudit({ action: "qa", prompt: qaPrompt, modelId: visualQaModelId, startedAt: qaStartedAt, result: visualQuality });
      qaExecution.score = visualQuality.score;
      qaExecution.verdict = visualQuality.verdict;
      qaExecution.issueSummary = visualQuality.issues.map((item) => item.description);
    } catch (error) {
      qaExecution = executionAudit({ action: "qa", prompt: qaPrompt, modelId: visualQaModelId, startedAt: qaStartedAt, error });
      page = appendStoryboardBoardVisualTake({
        page,
        take: { ...takeBase, executions: [...takeBase.executions, qaExecution] },
      });
      await onPageChange(page);
      return { page, status: "qa_unavailable", issues: [summarizeUnknownError(error).message] };
    }

    const reviewedAt = Date.now();
    const qualityPassed = isStoryboardBoardVisualQualityPassing(visualQuality);
    const take: ManualStoryboardBoardVisualTake = {
      ...takeBase,
      quality: visualQuality,
      review: qualityPassed
        ? {
            mode: "manual",
            status: "pending",
            notes: `自动视觉质检已通过（${visualQuality.score} 分），仍需创作者看图采用。`,
          }
        : { mode: "automatic", status: "rejected", reviewedAt },
      executions: [...takeBase.executions, qaExecution],
    };
    if (qualityPassed) {
      page = stageStoryboardBoardVisualTakeForCreatorReview({
        page,
        take,
        notes: `自动视觉质检已通过（${visualQuality.score} 分），仍需创作者看图采用。`,
      });
      await onPageChange(page);
      return { page, status: "manual_review_required", score: visualQuality.score, issues: [] };
    }
    page = appendStoryboardBoardVisualTake({ page, take: { ...take, status: "rejected" as const } });
    repairIssues = visualQuality.issues
      .filter((item) => item.severity !== "advisory")
      .map((item) => `${item.description}；${item.suggestion}`);
    await onPageChange(page);
    const cycle = shouldStopStoryboardRepairCycle({
      repairCount: attempt,
      maxRepairs: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS,
      previousIssueFingerprint: previousRepairIssueFingerprint,
      currentIssues: repairIssues,
    });
    previousRepairIssueFingerprint = cycle.currentIssueFingerprint;
    if (cycle.stop) {
      return { page, status: "quality_failed", score: visualQuality.score, issues: [...repairIssues, `自动修复已停止：${cycle.reason}。`] };
    }
  }

  const latestTake = page.visualTakes?.[page.visualTakes.length - 1];
  return { page, status: "quality_failed", score: latestTake?.quality?.score, issues: repairIssues };
};

interface StoryboardSceneVisualRunResult {
  completed: boolean;
  completedPages: number;
  totalPages: number;
  manualReviewPageCount: number;
  workflows: ManualStoryboardBoardWorkflow[];
}

const runStoryboardSceneVisualPages = async ({
  project,
  episodeId,
  context,
  workspace,
  initialWorkflows,
  batchAudits,
  targetShotIds,
  metadata,
  visualQcEnabled,
  visualQaModelId,
  completedScenes,
  totalScenes,
  onProgress,
  updateScene,
}: {
  project: Project;
  episodeId: string;
  context: StoryboardBoardBatchSceneContext;
  workspace: NonNullable<Scene["manualStoryboard"]>;
  initialWorkflows: ManualStoryboardBoardWorkflow[];
  batchAudits: ManualStoryboardPromptAudit[];
  targetShotIds: Set<string>;
  metadata?: PromptEditorConfirmMetadata;
  visualQcEnabled: boolean;
  visualQaModelId: string;
  completedScenes: number;
  totalScenes: number;
  onProgress: (progress: StoryboardBoardBatchProgress) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => void | Promise<void>;
}): Promise<StoryboardSceneVisualRunResult> => {
  const sceneShots = context.scene.shots || [];
  if (sceneShots.some((shot) => shot.appearance?.states.some((state) => state.decision === "accepted"))) {
    const sourceContext = sceneShots.some((shot) => shot.appearance?.states.some((state) => state.decision === "accepted" && state.inheritFromShotId))
      ? (await legacyProjectClient.getStoryboardTeamContext(project.id, episodeId, context.scene.id)).productionTeamContext
      : context.filmTeamContext;
    const history = appearanceSourceShots({ scenes: [context.scene] } as Episode, sourceContext);
    // These are still-image cells; only their selected representative moments
    // need references. Video-prompt readiness is not a requirement here.
    requireAppearanceReady(project, context.scene, sceneShots, history, "image");
  }
  let workflows = initialWorkflows.map((workflow) => {
    if (!workflow.board) return workflow;
    const visualPages = reconcileStoryboardCompositeVisualPages(workflow.board);
    const pagePlanChanged = visualPages !== workflow.board.visualPages;
    if (!pagePlanChanged) return workflow;
    const board = { ...workflow.board, visualPages };
    const boardOutputHash = buildManualBoardOutputHash({ ...workflow, board });
    return {
      ...workflow,
      board,
      boardRecord: workflow.boardRecord ? { ...workflow.boardRecord, outputHash: boardOutputHash } : workflow.boardRecord,
      qa: workflow.qa ? { ...workflow.qa, sourceHash: buildManualBoardQASourceHash(boardOutputHash) } : workflow.qa,
      confirmedAt: undefined,
      updatedAt: Date.now(),
    };
  });
  const persistWorkflows = async (updatedAt = Date.now()) => Promise.resolve(updateScene(context.scene.id, {
    manualStoryboard: {
      ...workspace,
      boards: [
        ...(workspace.boards || []).filter((item) => !(item.shotIds || item.board?.shotIds || [item.shotId]).some((shotId) => targetShotIds.has(shotId))),
        ...workflows,
      ],
      batchAudits,
      updatedAt,
    },
  }, episodeId));
  const replacePage = (workflowIndex: number, pageId: string, page: ManualStoryboardBoardVisualPage) => {
    workflows = workflows.map((workflow, index) => index !== workflowIndex || !workflow.board ? workflow : {
      ...workflow,
      board: {
        ...workflow.board,
        visualPages: reconcileStoryboardCompositeVisualPages(workflow.board)
          .map((item) => item.id === pageId ? page : item),
      },
      updatedAt: Date.now(),
    });
  };
  await persistWorkflows();

  const workflowsAwaitingManualReview = new Set<string>();
  let manualReviewPageCount = 0;
  const totalPages = workflows.reduce((sum, workflow) => (
    sum + (workflow.board ? reconcileStoryboardCompositeVisualPages(workflow.board).length : 0)
  ), 0);
  let completedPages = 0;
  for (let workflowIndex = 0; workflowIndex < workflows.length; workflowIndex += 1) {
    if (!workflows[workflowIndex].board) continue;
    const pages = reconcileStoryboardCompositeVisualPages(workflows[workflowIndex].board!);
    for (const originalPage of pages) {
      let page = reconcileStoryboardCompositeVisualPages(workflows[workflowIndex].board!)
        .find((item) => item.id === originalPage.id)!;
      const result = await runStoryboardCompositeVisualAgent({
        project,
        episodeId,
        context,
        workflow: workflows[workflowIndex],
        initialPage: page,
        metadata,
        visualQcEnabled,
        visualQaModelId,
        completedScenes,
        totalScenes,
        completedPages,
        totalPages,
        onProgress,
        onPageChange: async (nextPage) => {
          page = nextPage;
          replacePage(workflowIndex, nextPage.id, nextPage);
          await persistWorkflows();
        },
      });
      if (result.status === "manual_review_required") {
        completedPages += 1;
        manualReviewPageCount += 1;
        workflowsAwaitingManualReview.add(workflows[workflowIndex].id);
        continue;
      }
      if (result.status !== "passed") {
        onProgress({
          phase: "needs_decision",
          label: result.status === "qa_unavailable"
            ? "完整故事板页已生成，但当前质检模型未能完成整板检查"
            : "完整故事板页多轮重绘后仍未达标，需要专业接管",
          sceneId: context.scene.id,
          sceneTitle: context.scene.title,
          shotId: workflows[workflowIndex].shotId,
          panelId: page.id,
          attempt: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
          maxAttempts: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
          completedScenes,
          totalScenes,
          completedPanels: completedPages,
          totalPanels: totalPages,
          score: result.score,
          issues: result.issues,
        });
        return { completed: false, completedPages, totalPages, manualReviewPageCount, workflows };
      }
      completedPages += 1;
    }
  }

  const completedAt = Date.now();
  workflows = workflows.map((workflow) => ({
    ...workflow,
    confirmedAt: visualQcEnabled && !workflowsAwaitingManualReview.has(workflow.id)
      ? completedAt
      : undefined,
    updatedAt: completedAt,
  }));
  await persistWorkflows(completedAt);
  return {
    completed: true,
    completedPages,
    totalPages,
    manualReviewPageCount,
    workflows,
  };
};

export const useStoryboardBoardBatchAgent = ({
  project,
  episode,
  scenes,
  updateScene,
}: {
  project: Project | null;
  episode: Episode | null;
  scenes: StoryboardBoardBatchSceneContext[];
  updateScene: (sceneId: string, updates: Partial<Scene>, episodeId?: string) => void | Promise<void>;
}) => {
  const [promptRequest, setPromptRequest] = useState<StoryboardBoardBatchPromptRequest | null>(null);
  const [progress, setProgress] = useState<StoryboardBoardBatchProgress>(initialProgress);
  const pendingScenes = useMemo(() => scenes.filter((item) => !item.boardComplete), [scenes]);
  const blockedScenes = useMemo(() => pendingScenes.filter((item) => !item.boardDraftReady), [pendingScenes]);
  const isRunning = ["generating", "checking", "repairing"].includes(progress.phase);

  const prepareTargets = (
    targets: StoryboardBoardBatchSceneContext[],
    kind: "segment" | "scene",
  ) => {
    if (!project || !episode || !targets.length) return;
    const blockedTargets = targets.filter((item) => !item.boardDraftReady);
    if (blockedTargets.length) {
      toast.error("请先确认本场分镜，再建立故事板视频单元。图片提示词只在生成画面时需要。");
      return;
    }
    const targetAssetIds = Array.from(new Set(targets.flatMap((item) => item.boardAllowedAssetIds)));
    const projectCharacterIds = new Set((project.characters || []).map((character) => character.id));
    const context = gatherContextOptions(project, "generateShots", {
      episodeIds: [episode.id],
      characterIds: targetAssetIds.filter((id) => projectCharacterIds.has(id)),
      assetIds: targetAssetIds.filter((id) => !projectCharacterIds.has(id)),
      restrictEntityDefaults: true,
    });
    // Current-scene continuity and formal asset identities are already embedded
    // in the task variables below. Re-injecting them as generic project context
    // duplicates data and can make the model choose assets from the wrong scene.
    const defaultSelectedContextIds: string[] = [];
    const aiConfig = useAIConfigStore.getState();
    const willRenderVisuals = targets.some((item) => item.boardFormalReady);
    const modelLabel = (task: keyof typeof aiConfig.routing) => {
      const model = aiConfig.models.find((item) => item.id === aiConfig.routing[task]);
      return model ? `${model.alias} (${model.modelId})` : `未配置：${task}`;
    };
    setPromptRequest({
      templateId: "storyboard.board.plan",
      title: kind === "scene"
        ? `${willRenderVisuals ? "生成当前场故事板画面" : "建立当前场视频单元结构"} · ${targets[0].scene.title}`
        : `${willRenderVisuals ? "生成本段故事板画面" : "建立本段视频单元结构"}（${targets.length} 场）`,
      scope: { kind, sceneIds: targets.map((item) => item.scene.id) },
      variables: {
        strategyDecision: JSON.stringify({
          mode: kind === "scene" ? "scene_agent" : "scene_batch_agent",
          policy: willRenderVisuals
            ? "按视频生成单元选择故事板策略；保存结构后，用已确认图片提示词生成故事板或宫格画面并独立质检。"
            : "只按已确认分镜建立视频单元与故事板结构；本次不生成图片，等待独立图片提示词完成后再渲染。",
          scenes: targets.map(sceneSummary),
        }, null, 2),
        strategyDefinition: JSON.stringify({
          strategies: buildManualStoryboardStrategyCatalog(),
          modelProfiles: buildManualStoryboardModelCatalog(),
        }, null, 2),
        shotContext: JSON.stringify(targets.map((item) => ({
          sceneId: item.scene.id,
          title: item.scene.title,
          description: item.scene.description || "",
          script: item.scene.script || "",
          shots: (item.scene.shots || []).map(projectShotForManualStoryboardPrompt),
        })), null, 2),
        filmTeamContext: JSON.stringify(targets.map((item) => ({ sceneId: item.scene.id, context: item.filmTeamContext }))),
        assetContext: JSON.stringify(targets.map((item) => ({ sceneId: item.scene.id, context: item.assetContext }))),
        qaContext: "",
        visualPanelContract: JSON.stringify({
          version: STORYBOARD_COMPOSITE_BOARD_CONTRACT_VERSION,
          mode: "一张图片内包含多格镜头的完整故事板页",
          referencePolicy: "优先使用当前视频单元已有的正式角色板、场景板、道具板和状态变体板锁定身份；缺失时仍可生成构图草案，但必须标记待补参考，不能正式采用或进入摄影棚。",
          renderPolicy: willRenderVisuals
            ? "一次调用生成整张故事板页；panel 是结构化镜头元数据，不逐格生成独立正式图片。无字幕、水印、界面和额外人物道具。"
            : "本次只持久化视频单元和 panel 结构，不调用图片模型。",
          qualityPolicy: aiConfig.visualQcEnabled
            ? `实际读取完整故事板页并进行多模态视觉质检；通过阈值 90；最多自动修复 ${STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS} 轮。`
            : "自动视觉质检已关闭；系统只做文件与横向画布技术检查，生成候选整板后等待创作者看图采用，不生成或伪造视觉分数。",
          delivery: aiConfig.visualQcEnabled
            ? "每次整板生成保留候选 visual take；仅采用整板视觉 QA 通过的最佳结果。"
            : "每次整板生成保留候选 visual take；人工采用前不进入摄影棚。",
          executionModels: {
            structure: modelLabel("storyboardGen"),
            structureQa: modelLabel("qcAnalyzer"),
            compositeBoardImage: willRenderVisuals ? modelLabel("imageGen") : "本次不执行",
            compositeBoardVisualQa: willRenderVisuals
              ? aiConfig.visualQcEnabled ? modelLabel("visualQc") : "已关闭，改为人工整板看图采用"
              : "本次不执行",
          },
        }, null, 2),
      },
      contextOptions: context.options,
      defaultSelectedContextIds,
    });
  };
  const prepareBatch = () => prepareTargets(pendingScenes, "segment");
  const prepareScene = (sceneId: string) => prepareTargets(
    scenes.filter((item) => item.scene.id === sceneId),
    "scene",
  );

  const executeBatch = async (
    finalPrompt: string,
    _userIntent?: string,
    metadata?: PromptEditorConfirmMetadata,
  ) => {
    if (!project || !episode || !promptRequest || isRunning) return;
    const requestKind = promptRequest.scope.kind;
    const requestedSceneIds = new Set(promptRequest.scope.sceneIds);
    const sourceScenes = requestKind === "scene" ? scenes : pendingScenes;
    const targets = sourceScenes.filter((item) => requestedSceneIds.has(item.scene.id) && item.boardDraftReady);
    const totalScenes = targets.length;
    let completedScenes = 0;
    let structureOnlySceneCount = 0;
    let manualReviewBoardPageCount = 0;
    const visualQcEnabled = useAIConfigStore.getState().visualQcEnabled;

    setProgress({ phase: "checking", label: visualQcEnabled ? "正在检查故事板结构、画格生成与多模态视觉质检模型" : "正在检查故事板结构与画格生成模型；视觉画格改为人工验收", attempt: 0, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes });
    try {
      const shouldGenerateVisuals = targets.some((item) => item.boardFormalReady);
      const requiredTasks = [
        ensureAIProviderTaskReady("storyboardGen", "故事板结构生成"),
        ensureAIProviderTaskReady("qcAnalyzer", "故事板结构质检"),
        ...(shouldGenerateVisuals ? [ensureAIProviderTaskReady("imageGen", "完整复合故事板页生成")] : []),
        ...(shouldGenerateVisuals && visualQcEnabled ? [ensureAIProviderTaskReady("visualQc", "完整复合故事板页视觉质检")] : []),
      ];
      await Promise.all(requiredTasks);
    } catch (error) {
      setProgress({ phase: "needs_decision", label: "故事板 Agent 尚不能安全执行，未开始生成图片", attempt: 0, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes, issues: [summarizeUnknownError(error).message] });
      throw error;
    }

    for (const context of targets) {
      const shots = context.scene.shots || [];
      const generationModelId = useAIConfigStore.getState().routing.storyboardGen;
      const qaModelId = useAIConfigStore.getState().routing.qcAnalyzer;
      const visualQaModelId = visualQcEnabled ? useAIConfigStore.getState().routing.visualQc : "manual-review";
      const executions: ManualStoryboardAgentExecutionAudit[] = [];
      const runModel = async <T,>(action: ManualStoryboardAgentExecutionAudit["action"], prompt: string, schema: unknown, modelId: string) => {
        const startedAt = Date.now();
        try {
          const response = await generateAIContent({ taskType: action === "qa" ? "qcAnalyzer" : "storyboardGen", prompt, requireJson: true, schema });
          const parsed = safeParseAIResponse<T>(response, [] as T);
          const audit = executionAudit({ action, prompt, modelId, startedAt, result: parsed });
          executions.push(audit);
          return { parsed, audit };
        } catch (error) {
          executions.push(executionAudit({ action, prompt, modelId, startedAt, error }));
          throw error;
        }
      };

      try {
        const sceneContext = {
          id: context.scene.id,
          title: context.scene.title,
          script: context.scene.script,
          description: context.scene.description,
        };
        const workspace = context.scene.manualStoryboard!;
        let batchAudits = [...(workspace.batchAudits || [])];
        const targetShotIds = new Set(shots.map((item) => item.id));
        const existingCompositeWorkflow = (workspace.boards || []).find((workflow) => {
          if (workflow.unitSchema !== "storyboard_unit.v1") return false;
          const workflowShotIds = Array.from(new Set([
            ...(workflow.shotIds || []),
            ...(workflow.board?.shotIds || []),
            workflow.shotId,
          ].filter((value): value is string => Boolean(value))));
          return workflowShotIds.length === targetShotIds.size
            && workflowShotIds.every((shotId) => targetShotIds.has(shotId));
        });
        const existingCompositeQuality: ManualStoryboardAgentQuality | undefined = existingCompositeWorkflow?.qa ? {
          score: existingCompositeWorkflow.qa.score,
          verdict: existingCompositeWorkflow.qa.verdict,
          summary: existingCompositeWorkflow.qa.summary,
          strengths: existingCompositeWorkflow.qa.strengths,
          issues: existingCompositeWorkflow.qa.issues,
        } : undefined;
        const reusableCompositeWorkflow = (() => {
          const workflow = existingCompositeWorkflow;
          if (!workflow?.board || !workflow.strategyDecision || !workflow.strategyRecord || !workflow.boardRecord || !workflow.qa) return undefined;
          if (!existingCompositeQuality || !isStoryboardAgentQualityPassing(existingCompositeQuality)) return undefined;
          const strategySourceHash = buildManualBoardWorkflowStrategySourceHash(context.storyboardSourceHash, shots);
          const boardSourceHash = buildManualBoardSourceHash(strategySourceHash, workflow.strategyDecision);
          const boardOutputHash = buildManualBoardOutputHash(workflow);
          if (
            workflow.strategyRecord.sourceHash !== strategySourceHash
            || workflow.strategyRecord.outputHash !== manualStoryboardHash(workflow.strategyDecision)
            || workflow.boardRecord.sourceHash !== boardSourceHash
            || workflow.boardRecord.outputHash !== boardOutputHash
            || workflow.qa.sourceHash !== buildManualBoardQASourceHash(boardOutputHash)
          ) return undefined;
          const pages = workflow.board.visualPages?.length
            ? workflow.board.visualPages
            : buildStoryboardCompositeVisualPages(workflow.board);
          const blockingIssues = validateStoryboardCompositeBoardContract({
            board: workflow.board,
            pages,
            shots,
          }).filter((issue) => issue.severity === "blocking");
          return blockingIssues.length ? undefined : workflow;
        })();
        if (reusableCompositeWorkflow && existingCompositeQuality) {
          if (!context.boardFormalReady) {
            completedScenes += 1;
            structureOnlySceneCount += 1;
            setProgress({
              phase: "completed",
              label: `${context.scene.title} 的视频单元结构已就绪，等待图片提示词后生成画面`,
              sceneId: context.scene.id,
              sceneTitle: context.scene.title,
              attempt: 1,
              maxAttempts: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
              completedScenes,
              totalScenes,
              score: existingCompositeQuality.score,
            });
            continue;
          }
          setProgress({
            phase: "checking",
            label: `${context.scene.title} 已恢复上次完成的故事板结构，继续未完成的整板图片`,
            sceneId: context.scene.id,
            sceneTitle: context.scene.title,
            attempt: 1,
            maxAttempts: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
            completedScenes,
            totalScenes,
          });
          const visualRun = await runStoryboardSceneVisualPages({
            project,
            episodeId: episode.id,
            context,
            workspace,
            initialWorkflows: [reusableCompositeWorkflow],
            batchAudits,
            targetShotIds,
            metadata,
            visualQcEnabled,
            visualQaModelId,
            completedScenes,
            totalScenes,
            onProgress: setProgress,
            updateScene,
          });
          if (!visualRun.completed) return;
          completedScenes += 1;
          manualReviewBoardPageCount += visualRun.manualReviewPageCount;
          const requiresManualReview = visualRun.manualReviewPageCount > 0 || !visualQcEnabled;
          setProgress({
            phase: requiresManualReview ? "checking" : "completed",
            label: requiresManualReview
              ? `${context.scene.title} 的 ${visualRun.completedPages} 张候选故事板整页已恢复，等待人工采用`
              : `${context.scene.title} 已从保存进度继续，${visualRun.completedPages} 张故事板页均已通过质检`,
            sceneId: context.scene.id,
            sceneTitle: context.scene.title,
            attempt: 1,
            maxAttempts: STORYBOARD_COMPOSITE_BOARD_MAX_REPAIRS + 1,
            completedScenes,
            totalScenes,
            completedPanels: visualRun.completedPages,
            totalPanels: visualRun.totalPages,
            score: existingCompositeQuality.score,
          });
          continue;
        }
        const reusableValues: StoryboardBoardBatchValue[] = shots.flatMap((shot) => {
          const workflow = workspace.boards?.find((item) => item.unitSchema === "storyboard_unit.v1"
            && (item.shotIds || item.board?.shotIds || [item.shotId]).includes(shot.id));
          if ((workflow?.shotIds || workflow?.board?.shotIds || [workflow?.shotId]).filter(Boolean).length !== 1) return [];
          if (!workflow?.strategyDecision || !workflow.performanceBeat || !workflow.board || !workflow.strategyRecord || !workflow.boardRecord) return [];
          if (!workflow.strategyDecision.rejectedStrategyIds?.length) return [];
          const strategySourceHash = buildManualBoardStrategySourceHash(context.storyboardSourceHash, shot);
          const boardSourceHash = buildManualBoardSourceHash(strategySourceHash, workflow.strategyDecision);
          const boardOutputHash = buildManualBoardOutputHash(workflow);
          if (
            workflow.strategyRecord.sourceHash !== strategySourceHash
            || workflow.boardRecord.sourceHash !== boardSourceHash
            || workflow.boardRecord.outputHash !== boardOutputHash
          ) return [];
          const strategyDecision = normalizeManualStoryboardStrategy(workflow.strategyDecision);
          return [{
            shotId: shot.id,
            strategyDecision,
            workflow: normalizeManualStoryboardBoard({
              value: { performanceBeat: workflow.performanceBeat, board: workflow.board },
              episodeId: episode.id,
              sceneId: context.scene.id,
              shot,
              decision: strategyDecision,
            }),
          }];
        });
        const reusableQualityParts = shots.flatMap((shot) => {
          const workflow = workspace.boards?.find((item) => item.unitSchema === "storyboard_unit.v1"
            && (item.shotIds || item.board?.shotIds || [item.shotId]).includes(shot.id));
          if ((workflow?.shotIds || workflow?.board?.shotIds || [workflow?.shotId]).filter(Boolean).length !== 1) return [];
          if (!workflow?.qa || workflow.qa.verdict !== "pass" || !workflow.board) return [];
          const boardOutputHash = buildManualBoardOutputHash(workflow);
          if (workflow.qa.sourceHash !== buildManualBoardQASourceHash(boardOutputHash)) return [];
          const quality: ManualStoryboardAgentQuality = {
            score: workflow.qa.score,
            verdict: workflow.qa.verdict,
            summary: workflow.qa.summary,
            strengths: workflow.qa.strengths,
            issues: workflow.qa.issues.map((issue) => ({ ...issue, targetShotId: shot.id })),
          };
          return isStoryboardAgentQualityPassing(quality) ? [quality] : [];
        });
        const reusableSceneQuality = reusableValues.length === shots.length && reusableQualityParts.length === shots.length
          ? combineStoryboardBatchQualities(reusableQualityParts)
          : undefined;
        let values: StoryboardBoardBatchValue[] = reusableValues;
        const scoreStructureCandidate = (candidate: StoryboardBoardBatchValue) =>
          scoreStoryboardBoardCandidateCompleteness(candidate);
        const shotsNeedingStructure = shots.filter((shot) => !reusableValues.some((value) => value.shotId === shot.id));
        const shotChunks = splitStoryboardBoardShots(shotsNeedingStructure);
        const buildStructureWorkflows = (audit: ManualStoryboardPromptAudit) => values.map((value) => {
          const shot = shots.find((item) => item.id === value.shotId)!;
          const strategySourceHash = buildManualBoardStrategySourceHash(context.storyboardSourceHash, shot);
          const boardSourceHash = buildManualBoardSourceHash(strategySourceHash, value.strategyDecision);
          const boardOutputHash = buildManualBoardOutputHash(value.workflow);
          const previousWorkflow = workspace.boards?.find((item) => item.unitSchema === "storyboard_unit.v1" && item.shotId === shot.id);
          const previousStructureStillMatches = previousWorkflow?.boardRecord?.sourceHash === boardSourceHash
            && previousWorkflow.boardRecord.outputHash === boardOutputHash;
          const board = value.workflow.board ? {
            ...value.workflow.board,
            visualPages: (value.workflow.board.visualPages?.length
              ? value.workflow.board.visualPages
              : buildStoryboardCompositeVisualPages(value.workflow.board)
            ).map((page) => {
              const previousPage = previousWorkflow?.board?.visualPages?.find((item) => item.id === page.id);
              return previousStructureStillMatches && previousPage ? {
                ...page,
                visualTakes: previousPage.visualTakes,
                activeVisualTakeId: previousPage.activeVisualTakeId,
              } : page;
            }),
            panels: value.workflow.board.panels.map((panel) => {
              const previousPanel = previousWorkflow?.board?.panels.find((item) => item.id === panel.id);
              return previousPanel ? {
                ...panel,
                visualTakes: previousPanel.visualTakes,
                activeVisualTakeId: previousPanel.activeVisualTakeId,
              } : panel;
            }),
          } : value.workflow.board;
          return {
            id: `manual-board-workflow-${shot.id}`,
            boardId: board?.id,
            videoGenerationUnitId: board?.videoGenerationUnitId || `manual-video-unit-${shot.id}`,
            shotIds: board?.shotIds || [shot.id],
            shotId: shot.id,
            strategyDecision: value.strategyDecision,
            strategyRecord: { sourceHash: strategySourceHash, outputHash: manualStoryboardHash(value.strategyDecision), audit, adoptedAt: Date.now() },
            ...value.workflow,
            board,
            boardRecord: { sourceHash: boardSourceHash, outputHash: boardOutputHash, audit, adoptedAt: Date.now() },
            qa: previousStructureStillMatches ? previousWorkflow?.qa : undefined,
            confirmedAt: previousStructureStillMatches ? previousWorkflow?.confirmedAt : undefined,
            updatedAt: Date.now(),
          } satisfies ManualStoryboardBoardWorkflow;
        });
        const persistStructureCheckpoint = async (audit: ManualStoryboardPromptAudit) => {
          const checkpointAt = Date.now();
          const checkpointWorkflows = buildStructureWorkflows(compactStoryboardStepAudit(audit));
          batchAudits = [...batchAudits.filter((item) => item.id !== audit.id), audit].slice(-24);
          await Promise.resolve(updateScene(context.scene.id, {
            manualStoryboard: {
              ...workspace,
              boards: [...(workspace.boards || []).filter((item) => !(item.shotIds || item.board?.shotIds || [item.shotId]).some((shotId) => targetShotIds.has(shotId))), ...checkpointWorkflows],
              batchAudits,
              updatedAt: checkpointAt,
            },
          }, episode.id));
        };
        for (let chunkIndex = 0; chunkIndex < shotChunks.length; chunkIndex += 1) {
          const chunkShots = getStoryboardBoardRequestShots(shotChunks[chunkIndex], values, isManualAIExecution());
          if (!chunkShots.length) continue;
          setProgress({ phase: "generating", label: `故事板 Agent 正在编排当前场第 ${chunkIndex + 1}/${shotChunks.length} 批 Shot`, sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes });
          const initialPrompt = buildStoryboardBoardBatchPrompt({
            confirmedPrompt: finalPrompt,
            sceneContext,
            shots: chunkShots,
            filmTeamContext: context.filmTeamContext,
            assetContext: context.assetContext,
          });
          const initial = await runModel<unknown>("generate", initialPrompt, storyboardBoardBatchSchema, generationModelId);
          const chunkValues = normalizeStoryboardBoardExecutionResponse({ value: initial.parsed, episodeId: episode.id, sceneId: context.scene.id, sceneShots: shots, requestedShots: chunkShots, manualExecution: isManualAIExecution() });
          values = mergeStoryboardBoardBatchValues(values, chunkValues, scoreStructureCandidate);
          initial.audit.issueSummary = validateStoryboardBoardBatch({ values: chunkValues, shots: chunkShots, projectFormat: project.type, aspectRatio: project.aspectRatio, referenceImageCount: context.assets.assetBoards.filter((item) => item.referenceImageUrl).length, allowedAssetIds: context.boardAllowedAssetIds }).map((item) => item.message);
          const checkpointAudit: ManualStoryboardPromptAudit = { id: `storyboard-board-checkpoint-${context.scene.id}-${chunkIndex + 1}-${Date.now()}`, action: "generate_board", templateId: metadata?.templateId || "storyboard.board.plan", promptHash: manualStoryboardHash(finalPrompt), modelId: generationModelId, selectedSkillIds: metadata?.selectedSkillIds || [], selectedSkillTitles: metadata?.selectedSkillTitles || [], selectedContextIds: metadata?.selectedContextIds || [], createdAt: Date.now(), confirmedPrompt: finalPrompt, promptExecutions: [initial.audit] };
          await persistStructureCheckpoint(checkpointAudit);
        }
        if (shotChunks.length === 0 && reusableValues.length > 0) {
          await persistStructureCheckpoint({
            id: `storyboard-board-resume-${context.scene.id}-${Date.now()}`,
            action: "generate_board",
            templateId: metadata?.templateId || "storyboard.board.plan",
            promptHash: manualStoryboardHash(finalPrompt),
            modelId: generationModelId,
            selectedSkillIds: metadata?.selectedSkillIds || [],
            selectedSkillTitles: metadata?.selectedSkillTitles || [],
            selectedContextIds: metadata?.selectedContextIds || [],
            createdAt: Date.now(),
            confirmedPrompt: finalPrompt,
            promptExecutions: [],
          });
        }
        let contractIssues = validateStoryboardBoardBatch({ values, shots, projectFormat: project.type, aspectRatio: project.aspectRatio, referenceImageCount: context.assets.assetBoards.filter((item) => item.referenceImageUrl).length, allowedAssetIds: context.boardAllowedAssetIds });
        let quality: ManualStoryboardAgentQuality | undefined = reusableSceneQuality;
        let best: { values: StoryboardBoardBatchValue[]; contractIssues: StoryboardBoardBatchIssue[]; quality: ManualStoryboardAgentQuality } | undefined = reusableSceneQuality
          ? { values, contractIssues, quality: reusableSceneQuality }
          : undefined;
        let repairCount = 0;
        let previousRepairIssueFingerprint = "";

        while (true) {
          const actionableContractIssues = getActionableStoryboardBoardIssues(contractIssues);
          if (!actionableContractIssues.length && quality && isStoryboardAgentQualityPassing(quality)) break;
          if (!actionableContractIssues.length) {
            const qaChunks = splitStoryboardBoardShots(shots);
            const chunkQualities: ManualStoryboardAgentQuality[] = [];
            for (let chunkIndex = 0; chunkIndex < qaChunks.length; chunkIndex += 1) {
              const reviewShots = qaChunks[chunkIndex];
              const reviewStart = shots.findIndex((shot) => shot.id === reviewShots[0]?.id);
              const surroundingShots = [
                ...(reviewStart > 0 ? [shots[reviewStart - 1]] : []),
                ...reviewShots,
                ...(reviewStart + reviewShots.length < shots.length ? [shots[reviewStart + reviewShots.length]] : []),
              ];
              const surroundingShotIds = new Set(surroundingShots.map((shot) => shot.id));
              setProgress({ phase: "checking", label: `独立质检 Agent 正在检查第 ${chunkIndex + 1}/${qaChunks.length} 批 Shot 的 panel、表演、资产与边界连续性`, sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: repairCount + 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes });
              const qaPrompt = buildStoryboardBoardBatchQualityPrompt({
                sceneContext,
                shots: surroundingShots,
                values: values.filter((value) => surroundingShotIds.has(value.shotId)),
                reviewShotIds: reviewShots.map((shot) => shot.id),
                filmTeamContext: context.filmTeamContext,
                assetContext: context.assetContext,
              });
              let checked: { parsed: unknown; audit: ManualStoryboardAgentExecutionAudit } | undefined;
              for (let qaRecovery = 0; qaRecovery <= STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES && !checked; qaRecovery += 1) {
                const recoveryPrompt = qaRecovery === 0
                  ? qaPrompt
                  : `${qaPrompt}\n\n【输出恢复】上一轮 JSON 格式无效。本轮必须只返回符合 schema 的单个 JSON 对象；每条 issue 都要完整包含 severity、targetShotId、description、suggestion、evidence，禁止 Markdown、解释文字或省略字段。`;
                try {
                  checked = await runModel<unknown>("qa", recoveryPrompt, storyboardBoardQualitySchema, qaModelId);
                } catch (error) {
                  if (qaRecovery >= STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES) throw error;
                  setProgress({ phase: "checking", label: `第 ${chunkIndex + 1}/${qaChunks.length} 批质检输出格式无效，Agent 正在恢复（${qaRecovery + 1}/${STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES}）`, sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: repairCount + 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes });
                }
              }
              if (!checked) throw new Error("故事板质检未返回可解析结果。");
              const chunkQuality = normalizeStoryboardBoardQualityWithEvidence({
                value: checked.parsed,
                values: values.filter((value) => surroundingShotIds.has(value.shotId)),
                shots,
              });
              checked.audit.score = chunkQuality.score;
              checked.audit.verdict = chunkQuality.verdict;
              checked.audit.issueSummary = chunkQuality.issues.map((item) => item.description);
              chunkQualities.push(chunkQuality);
            }
            quality = combineStoryboardBatchQualities(chunkQualities);
            if (!best || quality.score > best.quality.score) best = { values, contractIssues, quality };
            if (isStoryboardAgentQualityPassing(quality)) break;
          }
          if (quality && best && best.quality.score > quality.score) ({ values, contractIssues, quality } = best);
          const qualityIssues = (quality?.issues || []).filter((item) => item.severity !== "advisory");
          const currentRepairIssues = [
            ...actionableContractIssues.map((item) => item.message),
            ...qualityIssues.map((item) => item.description),
          ];
          const cycle = shouldStopStoryboardRepairCycle({
            repairCount,
            maxRepairs: STORYBOARD_BOARD_AGENT_MAX_REPAIRS,
            previousIssueFingerprint: previousRepairIssueFingerprint,
            currentIssues: currentRepairIssues,
          });
          previousRepairIssueFingerprint = cycle.currentIssueFingerprint;
          if (cycle.stop) break;
          repairCount += 1;
          setProgress({ phase: "repairing", label: quality ? `故事板质检 ${quality.score} 分，Agent 正在自动修订` : "故事板结构未通过，Agent 正在自动修订", sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: repairCount + 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes, score: quality?.score, issues: [...actionableContractIssues.map((item) => item.message), ...qualityIssues.map((item) => item.description)] });
          const targetShotIds = new Set([
            ...actionableContractIssues.map((item) => item.targetShotId).filter(Boolean),
            ...qualityIssues.map((item) => resolveStoryboardQualityTargetShotId(item.targetShotId, shots)).filter(Boolean),
          ] as string[]);
          const hasSceneWideIssue = actionableContractIssues.some((item) => !item.targetShotId)
            || qualityIssues.some((item) => !item.targetShotId);
          const repairShots = hasSceneWideIssue || targetShotIds.size === 0
            ? shots
            : shots.filter((shot) => targetShotIds.has(shot.id));
          const repairChunks = qualityIssues.length
            ? repairShots.map((shot) => [shot])
            : splitStoryboardBoardShots(repairShots);
          // Only returns received during this repair round can satisfy another repair chunk.
          // An older complete candidate may still contain the issue that QA asked us to repair.
          let receivedRepairValues: StoryboardBoardBatchValue[] = [];
          for (let chunkIndex = 0; chunkIndex < repairChunks.length; chunkIndex += 1) {
            const chunkShots = getStoryboardBoardRequestShots(repairChunks[chunkIndex], receivedRepairValues, isManualAIExecution());
            if (!chunkShots.length) continue;
            setProgress({
              phase: "repairing",
              label: `${quality ? `故事板质检 ${quality.score} 分，` : "故事板结构未通过，"}Agent 正在修订第 ${chunkIndex + 1}/${repairChunks.length} 批 Shot`,
              sceneId: context.scene.id,
              sceneTitle: context.scene.title,
              attempt: repairCount + 1,
              maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1,
              completedScenes,
              totalScenes,
              score: quality?.score,
              issues: [...actionableContractIssues.map((item) => item.message), ...qualityIssues.map((item) => item.description)],
            });
            let recoveredChunkValues: StoryboardBoardBatchValue[] = [];
            const recoveryAudits: ManualStoryboardAgentExecutionAudit[] = [];
            let pendingRepairShots = chunkShots;
            for (let recoveryAttempt = 0; recoveryAttempt <= STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES && pendingRepairShots.length; recoveryAttempt += 1) {
              const pendingShotIds = new Set(pendingRepairShots.map((shot) => shot.id));
              const chunkContractIssues = actionableContractIssues.filter((item) => !item.targetShotId || pendingShotIds.has(item.targetShotId));
              const chunkQuality = quality ? {
                ...quality,
                issues: quality.issues.filter((item) => {
                  if (!item.targetShotId) return true;
                  return pendingShotIds.has(resolveStoryboardQualityTargetShotId(item.targetShotId, shots));
                }),
              } : undefined;
              const baseRepairPrompt = buildStoryboardBoardBatchRepairPrompt({ sceneContext, shots: pendingRepairShots, values: values.filter((item) => pendingShotIds.has(item.shotId)), contractIssues: chunkContractIssues, quality: chunkQuality, filmTeamContext: context.filmTeamContext, assetContext: context.assetContext });
              const repairPrompt = recoveryAttempt === 0
                ? baseRepairPrompt
                : `${baseRepairPrompt}\n\n【输出恢复】上一轮没有返回上述全部 Shot 的完整 performanceBeat、strategyDecision 和 board.panels。本轮只恢复仍缺失的 Shot，必须逐个返回完整结构，不得返回空对象或省略字段。`;
              if (recoveryAttempt > 0) {
                setProgress({
                  phase: "repairing",
                  label: `第 ${chunkIndex + 1}/${repairChunks.length} 批修订输出不完整，Agent 正在恢复 ${pendingRepairShots.length} 个 Shot（${recoveryAttempt}/${STORYBOARD_BOARD_AGENT_MAX_OUTPUT_RECOVERIES}）`,
                  sceneId: context.scene.id,
                  sceneTitle: context.scene.title,
                  attempt: repairCount + 1,
                  maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1,
                  completedScenes,
                  totalScenes,
                  score: quality?.score,
                });
              }
              const repaired = await runModel<unknown>("repair", repairPrompt, storyboardBoardBatchSchema, generationModelId);
              const repairedValues = normalizeStoryboardBoardExecutionResponse({ value: repaired.parsed, episodeId: episode.id, sceneId: context.scene.id, sceneShots: shots, requestedShots: pendingRepairShots, manualExecution: isManualAIExecution() });
              recoveredChunkValues = mergeStoryboardBoardBatchValues(recoveredChunkValues, repairedValues, scoreStructureCandidate);
              receivedRepairValues = mergeStoryboardBoardBatchValues(receivedRepairValues, repairedValues, scoreStructureCandidate);
              repaired.audit.issueSummary = validateStoryboardBoardBatch({ values: repairedValues, shots: pendingRepairShots, projectFormat: project.type, aspectRatio: project.aspectRatio, referenceImageCount: context.assets.assetBoards.filter((item) => item.referenceImageUrl).length, allowedAssetIds: context.boardAllowedAssetIds }).map((item) => item.message);
              recoveryAudits.push(repaired.audit);
              const incompleteIds = new Set(getIncompleteStoryboardBoardShotIds(recoveredChunkValues, chunkShots));
              pendingRepairShots = chunkShots.filter((shot) => incompleteIds.has(shot.id));
            }
            values = mergeStoryboardBoardBatchValues(values, recoveredChunkValues, scoreStructureCandidate);
            await persistStructureCheckpoint({
              id: `storyboard-board-repair-${context.scene.id}-${repairCount}-${chunkIndex + 1}-${Date.now()}`,
              action: "generate_board",
              templateId: metadata?.templateId || "storyboard.board.plan",
              promptHash: manualStoryboardHash(finalPrompt),
              modelId: generationModelId,
              selectedSkillIds: metadata?.selectedSkillIds || [],
              selectedSkillTitles: metadata?.selectedSkillTitles || [],
              selectedContextIds: metadata?.selectedContextIds || [],
              createdAt: Date.now(),
              confirmedPrompt: finalPrompt,
              promptExecutions: recoveryAudits,
            });
          }
          contractIssues = validateStoryboardBoardBatch({ values, shots, projectFormat: project.type, aspectRatio: project.aspectRatio, referenceImageCount: context.assets.assetBoards.filter((item) => item.referenceImageUrl).length, allowedAssetIds: context.boardAllowedAssetIds });
          quality = undefined;
        }

        if ((!quality || !isStoryboardAgentQualityPassing(quality)) && best && (!quality || best.quality.score > quality.score)) ({ values, contractIssues, quality } = best);
        const remainingContractIssues = getActionableStoryboardBoardIssues(contractIssues);
        if (!quality || !isStoryboardAgentQualityPassing(quality) || remainingContractIssues.length) {
          setProgress({ phase: "needs_decision", label: "故事板 Agent 多轮修订后仍未达标，需要创作者决策", sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: repairCount + 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes, score: quality?.score, issues: [...remainingContractIssues.map((item) => item.message), ...(quality?.issues || []).filter((item) => item.severity !== "advisory").map((item) => item.description)] });
          return;
        }

        const now = Date.now();
        const generationAudit: ManualStoryboardPromptAudit = { id: `storyboard-board-run-${context.scene.id}-${now}`, action: "generate_board", templateId: metadata?.templateId || "storyboard.board.plan", promptHash: manualStoryboardHash(finalPrompt), modelId: generationModelId, selectedSkillIds: metadata?.selectedSkillIds || [], selectedSkillTitles: metadata?.selectedSkillTitles || [], selectedContextIds: metadata?.selectedContextIds || [], createdAt: now, confirmedPrompt: finalPrompt, promptExecutions: executions, agentQuality: quality };
        batchAudits = [...batchAudits.filter((item) => item.id !== generationAudit.id), generationAudit].slice(-24);
        const generationStepAudit = compactStoryboardStepAudit(generationAudit);
        const qaAudit: ManualStoryboardPromptAudit = {
          ...generationStepAudit,
          action: "qa_board",
          templateId: "storyboard.board.qa",
          modelId: qaModelId,
        };
        const perShotWorkflows = buildStructureWorkflows(generationStepAudit);
        if (!perShotWorkflows.length) throw new Error("故事板 Agent 未能建立当前场的视频单元结构。");
        const workflowByShotId = new Map(perShotWorkflows.map((workflow) => [workflow.shotId, workflow]));
        const existingGroupsByFirstShot = new Map(
          (workspace.boards || [])
            .filter((workflow) => workflow.unitSchema === "storyboard_unit.v1")
            .map((workflow) => {
              const shotIds = workflow.shotIds || workflow.board?.shotIds || [workflow.shotId];
              return [shotIds[0], shotIds] as const;
            })
            .sort((left, right) => left[1].length - right[1].length),
        );
        const plannedWorkflows: ManualStoryboardBoardWorkflow[] = [];
        for (let shotIndex = 0; shotIndex < shots.length;) {
          const shot = shots[shotIndex];
          const existingGroup = existingGroupsByFirstShot.get(shot.id) || [shot.id];
          const consecutiveIds = shots.slice(shotIndex, shotIndex + existingGroup.length).map((item) => item.id);
          const preservesExistingGroup = existingGroup.length === consecutiveIds.length
            && existingGroup.every((shotId, index) => shotId === consecutiveIds[index])
            && existingGroup.every((shotId) => workflowByShotId.has(shotId));
          const groupIds = preservesExistingGroup ? existingGroup : [shot.id];
          const group = groupIds.map((shotId) => workflowByShotId.get(shotId)!).filter(Boolean);
          plannedWorkflows.push(group.length === 1
            ? group[0]
            : composeStoryboardCompositeWorkflowGroup({ workflows: group, shots }));
          shotIndex += groupIds.length;
        }
        let workflows: ManualStoryboardBoardWorkflow[] = plannedWorkflows.map((workflow) => {
          const unitShotIds = workflow.shotIds || workflow.board?.shotIds || [workflow.shotId];
          const existingUnit = (workspace.boards || []).find((candidate) => {
            if (candidate.unitSchema !== "storyboard_unit.v1") return false;
            const candidateShotIds = candidate.shotIds || candidate.board?.shotIds || [candidate.shotId];
            return candidateShotIds.length === unitShotIds.length
              && candidateShotIds.every((shotId, index) => shotId === unitShotIds[index]);
          });
          const unitId = existingUnit?.videoGenerationUnitId
            || existingUnit?.board?.videoGenerationUnitId
            || `storyboard-unit-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
          const boardId = existingUnit?.boardId || existingUnit?.board?.id || `storyboard-board-${unitId}`;
          const normalizedBoard = workflow.board ? {
            ...workflow.board,
            id: boardId,
            videoGenerationUnitId: unitId,
            shotIds: unitShotIds,
            visualReferenceMode: existingUnit?.board?.visualReferenceMode
              || workspace.defaultVisualReferenceMode
              || workflow.board.visualReferenceMode
              || "shot_grid",
          } : undefined;
          if (normalizedBoard) {
            normalizedBoard.shotCellManifest = buildStoryboardShotCellManifest({ board: normalizedBoard, shots });
            normalizedBoard.visualPages = buildStoryboardCompositeVisualPages(normalizedBoard);
          }
          const normalizedWorkflow: ManualStoryboardBoardWorkflow = {
            ...workflow,
            unitSchema: "storyboard_unit.v1",
            id: existingUnit?.id || `storyboard-workflow-${unitId}`,
            boardId,
            videoGenerationUnitId: unitId,
            targetVideoModelConfigId: existingUnit?.targetVideoModelConfigId || workflow.targetVideoModelConfigId,
            shotIds: unitShotIds,
            board: normalizedBoard,
            takes: existingUnit?.takes,
            activeTakeId: existingUnit?.activeTakeId,
            unitLineage: existingUnit?.unitLineage,
          };
          const unitShots = unitShotIds
            .map((shotId) => shots.find((shot) => shot.id === shotId))
            .filter((shot): shot is Shot => Boolean(shot));
          normalizedWorkflow.unitVideoPrompt = buildStoryboardUnitVideoPromptRecord({
            workflow: normalizedWorkflow,
            shots: unitShots,
            previous: existingUnit?.unitVideoPrompt,
            now,
          });
          const strategySourceHash = buildManualBoardWorkflowStrategySourceHash(context.storyboardSourceHash, unitShots);
          const boardSourceHash = buildManualBoardSourceHash(strategySourceHash, normalizedWorkflow.strategyDecision!);
          const boardOutputHash = buildManualBoardOutputHash(normalizedWorkflow);
          return {
            ...normalizedWorkflow,
            strategyRecord: { sourceHash: strategySourceHash, outputHash: manualStoryboardHash(workflow.strategyDecision), audit: generationStepAudit, adoptedAt: now },
            boardRecord: { sourceHash: boardSourceHash, outputHash: boardOutputHash, audit: generationStepAudit, adoptedAt: now },
            qa: { score: quality!.score, verdict: "pass", summary: quality!.summary, strengths: quality!.strengths, issues: quality!.issues.filter((item) => !item.targetShotId || unitShotIds.includes(item.targetShotId)).map(({ severity, description, suggestion }) => ({ severity, description, suggestion })), sourceHash: buildManualBoardQASourceHash(boardOutputHash), audit: qaAudit, reviewedAt: now },
            confirmedAt: undefined,
            updatedAt: now,
          };
        });
        if (!context.boardFormalReady) {
          const structureCompletedAt = Date.now();
          await Promise.resolve(updateScene(context.scene.id, {
            manualStoryboard: {
              ...workspace,
              boards: [
                ...(workspace.boards || []).filter((item) => !(item.shotIds || item.board?.shotIds || [item.shotId]).some((shotId) => targetShotIds.has(shotId))),
                ...workflows,
              ],
              batchAudits,
              updatedAt: structureCompletedAt,
            },
          }, episode.id));
          completedScenes += 1;
          structureOnlySceneCount += 1;
          setProgress({
            phase: "completed",
            label: `${context.scene.title} 的视频单元结构已建立，生成图片提示词后即可生成宫格或故事板画面`,
            sceneId: context.scene.id,
            sceneTitle: context.scene.title,
            attempt: repairCount + 1,
            maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1,
            completedScenes,
            totalScenes,
            score: quality.score,
          });
          continue;
        }
        const visualRun = await runStoryboardSceneVisualPages({
          project,
          episodeId: episode.id,
          context,
          workspace,
          initialWorkflows: workflows,
          batchAudits,
          targetShotIds,
          metadata,
          visualQcEnabled,
          visualQaModelId,
          completedScenes,
          totalScenes,
          onProgress: setProgress,
          updateScene,
        });
        if (!visualRun.completed) return;
        completedScenes += 1;
        manualReviewBoardPageCount += visualRun.manualReviewPageCount;
        const requiresManualReview = visualRun.manualReviewPageCount > 0 || !visualQcEnabled;
        setProgress({ phase: requiresManualReview ? "checking" : "completed", label: requiresManualReview ? `${context.scene.title} 的 ${visualRun.completedPages} 张候选故事板整页已生成，等待补齐参考或人工采用` : `${context.scene.title} 结构与 ${visualRun.completedPages} 张完整故事板页均已通过质检`, sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: repairCount + 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes, completedPanels: visualRun.completedPages, totalPanels: visualRun.totalPages, score: quality.score });
      } catch (error) {
        console.error("Storyboard board batch agent failed:", summarizeUnknownError(error));
        setProgress({ phase: "failed", label: "故事板 Agent 执行失败，已保留之前完成的场次", sceneId: context.scene.id, sceneTitle: context.scene.title, attempt: 1, maxAttempts: STORYBOARD_BOARD_AGENT_MAX_REPAIRS + 1, completedScenes, totalScenes, issues: [summarizeUnknownError(error).message] });
        throw error;
      }
    }
    if (manualReviewBoardPageCount > 0) {
      setProgress((current) => ({
        ...current,
        phase: "needs_decision",
        label: `本段结构已通过，${manualReviewBoardPageCount} 张候选故事板整页等待人工看图采用`,
        completedScenes,
        totalScenes,
        issues: [visualQcEnabled
          ? "部分候选整板缺少正式资产参考；可审阅构图，但补齐参考并复核前不能正式采用或进入摄影棚。"
          : "自动视觉质检已关闭；人工采用整板前不会进入摄影棚，也不会显示虚假的视觉质检分数。"],
      }));
      toast.success(`已生成 ${manualReviewBoardPageCount} 张候选故事板整页，请整板看图采用。`);
      return;
    }
    if (structureOnlySceneCount > 0) {
      setProgress((current) => ({
        ...current,
        phase: "completed",
        label: structureOnlySceneCount === completedScenes
          ? `本段 ${structureOnlySceneCount} 场视频单元结构已建立，等待图片提示词后生成画面`
          : `本段 ${completedScenes} 场已处理，其中 ${structureOnlySceneCount} 场已建立结构并等待图片提示词`,
        completedScenes,
        totalScenes,
      }));
      toast.success(structureOnlySceneCount === completedScenes
        ? "视频单元结构已建立；图片提示词完成后可继续生成故事板或宫格画面。"
        : `已处理 ${completedScenes} 场，其中 ${structureOnlySceneCount} 场等待图片提示词。`);
      return;
    }
    setProgress((current) => ({ ...current, phase: "completed", label: `本段 ${completedScenes} 场视频故事板已全部完成`, completedScenes, totalScenes }));
    toast.success(requestKind === "scene"
      ? "当前场视频故事板已生成、质检并确认。"
      : `本段 ${completedScenes} 场视频故事板已自动生成、质检并确认。`
    );
  };

  return { promptRequest, progress, pendingCount: pendingScenes.length, blockedCount: blockedScenes.length, isRunning, prepareBatch, prepareScene, closePrompt: () => setPromptRequest(null), executeBatch };
};
