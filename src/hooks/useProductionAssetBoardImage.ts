import { assetNeedsVisualDesign } from "../clients/productionAssetWorkflowClient";
import type { AIExecutionProvenance } from "../clients/domainTypes";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import type { ImageGenerationReferenceAudit, ManualProductionAssetReferenceAudit, ManualStoryboardAgentQuality, Project, PromptCompositionManifestAudit, VisualCompileManifest } from "../clients/domainTypes";
import { generateAIContent, generateAIImage } from "../clients/aiClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
  buildProductionAssetImageVisualStyleProjection,
  buildProductionAssetVisualRecipeInputEvidence,
  productionAssetBoardCandidateSourceContentHash,
  reviewProductionAssetBoardCandidateSource,
} from "../clients/productionVisualImageClient";
import { replaceCurrentProjectSnapshot, useAIConfigStore } from "../clients/stateClient";
import type { ImagePromptSelection } from "../components/ImagePromptModal";
import type { VideoStoryboardAssetBoardItem } from "../clients/productionAssetWorkflowClient";
import {
  buildProductionAssetBoardVisualQAPrompt,
  productionAssetBoardPromptCore,
  buildProductionAssetBoardVisualRepairPrompt,
  buildProductionAssetBoardCanonicalReference,
  buildProductionAssetBoardPreviousOutputRepairOperation,
  isProductionAssetBoardVisualQualityPassing,
  PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS,
} from "../clients/productionAssetWorkflowClient";
import {
  normalizeStoryboardAgentQuality,
  storyboardShotQualitySchema,
} from "../clients/productionStoryboardWorkflowClient";
import { persistProjectMediaUrl } from "../clients/projectMediaClient";
import { safeParseAIResponse } from "../utils/aiParser";
import { imageUrlToMediaData, inspectImageTechnicalMetadata } from "../utils/imageMediaData";
import { summarizeUnknownError } from "../utils/logging";
import {
  createImageGenerationReference,
  type CompiledImageGenerationRequest,
} from "../clients/productionStudioWorkflowClient";
import {
  buildAssetBoardOverlaySpec,
  renderAssetBoardOverlay,
} from "../clients/productionAssetWorkflowClient";
import {
  resolveProductionAssetReferenceModeSpec,
  type ProductionAssetReferenceMode,
} from "../clients/productionAssetWorkflowClient";

export interface ProductionAssetBoardCandidate {
  candidateId?: string;
  board: VideoStoryboardAssetBoardItem;
  imageUrl: string;
  finalPrompt: string;
  source: "ai_generation" | "upload" | "existing";
  modelId?: string;
  executionProvenance?: AIExecutionProvenance;
  inputReferenceUrl?: string;
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  promptCompositionManifest?: PromptCompositionManifestAudit;
  visualStyleCompileManifest?: VisualCompileManifest;
  sourceContentHash?: string;
  sourceReview?: ManualProductionAssetReferenceAudit["sourceReview"];
  selection?: ImagePromptSelection;
  quality?: ManualStoryboardAgentQuality;
  referenceMode: ProductionAssetReferenceMode;
  layoutContractId: string;
  review: {
    executionProvenance?: AIExecutionProvenance;
    mode: "automatic" | "manual";
    status: "approved" | "pending";
    reviewedAt?: number;
  };
}

interface AssetBoardOperationToken {
  projectId: string;
  scopeKey: string;
  epoch: number;
}

export const useProductionAssetBoardImage = ({
  project,
  board,
  referenceMode,
  updateProject,
}: {
  project: Project | null;
  board?: VideoStoryboardAssetBoardItem;
  referenceMode: ProductionAssetReferenceMode;
  updateProject: (updates: Partial<Project>) => Promise<void>;
}) => {
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transientCandidate, setTransientCandidate] = useState<ProductionAssetBoardCandidate | null>(null);
  const [isAdopting, setIsAdopting] = useState(false);
  const operationScopeKey = `${project?.id || "no-project"}:${board?.id || "no-board"}:${referenceMode}`;
  const activeProjectIdRef = useRef(project?.id);
  const activeScopeKeyRef = useRef(operationScopeKey);
  const generationEpochRef = useRef(0);
  const reviewEpochRef = useRef(0);
  const inFlightGenerationScopesRef = useRef(new Set<string>());
  const inFlightReviewScopesRef = useRef(new Set<string>());
  const beginGenerationOperation = (projectId: string): AssetBoardOperationToken | null => {
    if (inFlightGenerationScopesRef.current.has(operationScopeKey)) return null;
    const operation = { projectId, scopeKey: operationScopeKey, epoch: generationEpochRef.current + 1 };
    generationEpochRef.current = operation.epoch;
    inFlightGenerationScopesRef.current.add(operation.scopeKey);
    return operation;
  };
  const isGenerationOperationCurrent = (operation: AssetBoardOperationToken) => (
    activeScopeKeyRef.current === operation.scopeKey
    && activeProjectIdRef.current === operation.projectId
    && generationEpochRef.current === operation.epoch
  );
  const finishGenerationOperation = (operation: AssetBoardOperationToken) => {
    inFlightGenerationScopesRef.current.delete(operation.scopeKey);
    if (isGenerationOperationCurrent(operation)) setIsGenerating(false);
  };
  const beginReviewOperation = (projectId: string): AssetBoardOperationToken | null => {
    if (inFlightReviewScopesRef.current.has(operationScopeKey)) return null;
    const operation = { projectId, scopeKey: operationScopeKey, epoch: reviewEpochRef.current + 1 };
    reviewEpochRef.current = operation.epoch;
    inFlightReviewScopesRef.current.add(operation.scopeKey);
    return operation;
  };
  const isReviewOperationCurrent = (operation: AssetBoardOperationToken) => (
    activeScopeKeyRef.current === operation.scopeKey
    && activeProjectIdRef.current === operation.projectId
    && reviewEpochRef.current === operation.epoch
  );
  const finishReviewOperation = (operation: AssetBoardOperationToken) => {
    inFlightReviewScopesRef.current.delete(operation.scopeKey);
    if (isReviewOperationCurrent(operation)) setIsAdopting(false);
  };
  const persistedCandidate = useMemo<ProductionAssetBoardCandidate | null>(() => {
    if (!project || !board) return null;
    const pending = [...(project.manualProductionAssets?.pendingReferences || [])]
      .filter((item) => item.boardItemId === board.id
        && (item.referenceMode || "production_board") === referenceMode)
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!pending) return null;
    return {
      candidateId: pending.id,
      board,
      imageUrl: pending.imageUrl,
      finalPrompt: pending.finalPrompt || "",
      source: pending.source,
      modelId: pending.modelId,
      executionProvenance: pending.executionProvenance,
      inputReferenceUrl: pending.inputReferenceUrl,
      imageReferenceManifest: pending.imageReferenceManifest,
      promptCompositionManifest: pending.promptCompositionManifest,
      visualStyleCompileManifest: pending.visualStyleCompileManifest,
      sourceContentHash: pending.sourceContentHash,
      sourceReview: reviewProductionAssetBoardCandidateSource({
        project,
        candidate: pending,
        detectedAt: pending.updatedAt,
      }),
      selection: {
        selectedSkillIds: pending.selectedSkillIds,
        selectedSkillTitles: pending.selectedSkillTitles || [],
        selectedContextIds: pending.selectedContextIds,
      },
      quality: pending.quality,
      referenceMode,
      layoutContractId: pending.layoutContractId || board.layoutContract.contractId,
      review: pending.review || { mode: "manual", status: "pending" },
    };
  }, [board, project, referenceMode]);
  const rawCandidate = transientCandidate || persistedCandidate;
  const candidate = useMemo<ProductionAssetBoardCandidate | null>(() => {
    if (!project || !rawCandidate) return rawCandidate;
    return {
      ...rawCandidate,
      sourceReview: reviewProductionAssetBoardCandidateSource({
        project,
        candidate: {
          boardItemId: rawCandidate.board.id,
          referenceMode: rawCandidate.referenceMode,
          sourceContentHash: rawCandidate.sourceContentHash,
        },
      }),
    };
  }, [project, rawCandidate]);
  useLayoutEffect(() => {
    activeProjectIdRef.current = project?.id;
    activeScopeKeyRef.current = operationScopeKey;
    generationEpochRef.current += 1;
    reviewEpochRef.current += 1;
    setTransientCandidate(null);
    setIsPromptOpen(false);
    setIsGenerating(false);
    setIsAdopting(false);
  }, [operationScopeKey]);
  const openPrompt = () => {
    if (!project || !board) {
      toast.error("当前资产类型没有可生成的角色板、场景板或道具板。");
      return;
    }
    setIsPromptOpen(true);
  };

  const generateCandidate = async (
    finalPrompt: string,
    inputReferenceUrl?: string,
    selection?: ImagePromptSelection,
  ) => {
    if (!project || !board || isGenerating) return;
    if (!inputReferenceUrl && assetNeedsVisualDesign(project, board.assetId)) { toast.error("请先完成资产形象设计或提供身份参考图"); return; }
    const operation = beginGenerationOperation(project.id);
    if (!operation) return;
    const modeSpec = resolveProductionAssetReferenceModeSpec(board, referenceMode);
    setIsGenerating(true);
    try {
      const sourceContentHash = productionAssetBoardCandidateSourceContentHash({
        project,
        boardItemId: board.id,
        referenceMode,
      });
      const visualStyleProjection = buildProductionAssetImageVisualStyleProjection({
        project,
        asset: board,
      });
      let imageUrl = "";
      let quality: ManualStoryboardAgentQuality | undefined;
      let reviewExecution: AIExecutionProvenance | undefined;
      const promptCore = productionAssetBoardPromptCore(finalPrompt, project, board);
      let adoptedPrompt = promptCore;
      let repairIssues: string[] = [];
      let review: ProductionAssetBoardCandidate["review"] | undefined;
      let compiledRequest: CompiledImageGenerationRequest | undefined;
      let executionProvenance: AIExecutionProvenance | undefined;
      let previousOutputReferenceUrl: string | undefined;
      const visualQcEnabled = useAIConfigStore.getState().visualQcEnabled;
      for (let attempt = 0; attempt <= PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS; attempt += 1) {
        if (!isGenerationOperationCurrent(operation)) return;
        adoptedPrompt = buildProductionAssetBoardVisualRepairPrompt(promptCore, repairIssues);
        const references = previousOutputReferenceUrl
          ? [createImageGenerationReference({
              imageUrl: previousOutputReferenceUrl,
              label: "待修改的参考图",
              role: "previous_output_repair",
            })]
          : inputReferenceUrl
            ? [buildProductionAssetBoardCanonicalReference({ board, imageUrl: inputReferenceUrl })]
            : undefined;
        const generatedImageUrl = await generateAIImage({
          promptCore: adoptedPrompt,
          aspectRatio: "16:9",
          visualStyleProjection,
          visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({ project, asset: board }),
          references,
          operation: previousOutputReferenceUrl
            ? buildProductionAssetBoardPreviousOutputRepairOperation({ board, issues: repairIssues })
            : { kind: "generate" },
          onExecutionProvenance: audit => { executionProvenance = audit; },
          onPromptCompiled: (compiled) => {
            compiledRequest = compiled;
          },
        });
        if (!isGenerationOperationCurrent(operation)) return;
        const rawImageUrl = await persistProjectMediaUrl(generatedImageUrl, project.id);
        if (!isGenerationOperationCurrent(operation)) return;
        previousOutputReferenceUrl = rawImageUrl;
        if (referenceMode === "production_board") {
          const overlaidImageUrl = await renderAssetBoardOverlay(
            rawImageUrl,
            buildAssetBoardOverlaySpec({ project, board }),
          );
          if (!isGenerationOperationCurrent(operation)) return;
          imageUrl = await persistProjectMediaUrl(overlaidImageUrl, project.id);
          if (!isGenerationOperationCurrent(operation)) return;
        } else {
          imageUrl = rawImageUrl;
        }
        const technical = await inspectImageTechnicalMetadata(imageUrl);
        if (!isGenerationOperationCurrent(operation)) return;
        if (technical.width > 0 && technical.height > 0 && technical.width <= technical.height) {
          repairIssues = [`资产板输出方向与本次结构化画幅不一致，实际返回 ${technical.width}x${technical.height}。`];
          imageUrl = "";
          if (attempt < PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS) continue;
          throw new Error(repairIssues[0]);
        }
        if (!visualQcEnabled) break;
        const mediaDataList = await Promise.all(
          [imageUrl, inputReferenceUrl].filter(Boolean).map((url) => imageUrlToMediaData(url!)),
        );
        if (!isGenerationOperationCurrent(operation)) return;
        const response = await generateAIContent({
          taskType: "visualQc",
          onExecutionProvenance: audit => { reviewExecution = audit; },
          prompt: buildProductionAssetBoardVisualQAPrompt({ project, board, referenceMode }),
          requireJson: true,
          schema: storyboardShotQualitySchema,
          mediaDataList,
        });
        if (!isGenerationOperationCurrent(operation)) return;
        quality = normalizeStoryboardAgentQuality(safeParseAIResponse<unknown>(response, {}));
        if (isProductionAssetBoardVisualQualityPassing(quality)) break;
        repairIssues = quality.issues
          .filter((item) => item.severity !== "advisory")
          .map((item) => `${item.description}；${item.suggestion}`);
        if (attempt >= PRODUCTION_ASSET_BOARD_VISUAL_MAX_REPAIRS) {
          review = { mode: "automatic", executionProvenance: reviewExecution, status: "pending", reviewedAt: Date.now() };
          break;
        }
        imageUrl = "";
      }
      if (!imageUrl) throw new Error("资产板图片生成未返回可采用的整板结果。");
      const candidateId = `asset-board-${window.crypto.randomUUID()}`;
      const stagedCandidate: ProductionAssetBoardCandidate = {
        candidateId,
        board,
        imageUrl,
        finalPrompt: compiledRequest?.providerPrompt || adoptedPrompt,
        source: executionProvenance?.source === "manual_external" ? "upload" : "ai_generation",
        modelId: executionProvenance?.modelId,
        executionProvenance,
        inputReferenceUrl,
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
        sourceContentHash,
        selection,
        quality,
        referenceMode,
        layoutContractId: modeSpec.contractId,
        review: review || (visualQcEnabled
          ? { mode: "automatic", executionProvenance: reviewExecution, status: "approved", reviewedAt: Date.now() }
          : { mode: "manual", status: "pending" }),
      };
      if (!isGenerationOperationCurrent(operation)) return;
      const savedProject = await legacyProjectClient.stageProductionAssetBoardCandidate(project.id, {
        candidateId,
        boardItemId: board.id,
        imageUrl,
        source: stagedCandidate.source,
        finalPrompt: stagedCandidate.finalPrompt,
        modelId: stagedCandidate.modelId,
        executionProvenance: stagedCandidate.executionProvenance,
        inputReferenceUrl: stagedCandidate.inputReferenceUrl,
        imageReferenceManifest: stagedCandidate.imageReferenceManifest,
        promptCompositionManifest: stagedCandidate.promptCompositionManifest,
        visualStyleCompileManifest: stagedCandidate.visualStyleCompileManifest,
        sourceContentHash,
        selectedSkillIds: stagedCandidate.selection?.selectedSkillIds,
        selectedSkillTitles: stagedCandidate.selection?.selectedSkillTitles,
        selectedContextIds: stagedCandidate.selection?.selectedContextIds,
        quality: stagedCandidate.quality,
        review: stagedCandidate.review,
        referenceMode: stagedCandidate.referenceMode,
      });
      if (!isGenerationOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      const persisted = savedProject.manualProductionAssets?.pendingReferences?.find((item) => item.id === candidateId);
      setTransientCandidate({
        ...stagedCandidate,
        sourceContentHash: persisted?.sourceContentHash || sourceContentHash,
        sourceReview: reviewProductionAssetBoardCandidateSource({
          project: savedProject,
          candidate: persisted || {
            boardItemId: board.id,
            referenceMode,
            sourceContentHash,
          },
        }),
      });
      if (quality && !isProductionAssetBoardVisualQualityPassing(quality)) {
        toast.error(`${modeSpec.label}候选未通过自动质检，已保留供人工预览`);
      } else {
        toast.success(`${modeSpec.label}候选已生成，请预览后采用`);
      }
    } catch (error) {
      if (!isGenerationOperationCurrent(operation)) return;
      const summary = summarizeUnknownError(error);
      console.error("Production asset board generation failed:", summary.message);
      toast.error(summary.message || "资产板生成失败");
      throw new Error(summary.message || "资产板生成失败");
    } finally {
      finishGenerationOperation(operation);
    }
  };

  const stageUpload = async (imageUrl: string) => {
    if (!project || !board || isGenerating) return;
    const operation = beginGenerationOperation(project.id);
    if (!operation) return;
    setIsGenerating(true);
    try {
      const modeSpec = resolveProductionAssetReferenceModeSpec(board, referenceMode);
      const sourceContentHash = productionAssetBoardCandidateSourceContentHash({
        project,
        boardItemId: board.id,
        referenceMode,
      });
      const persistedImageUrl = await persistProjectMediaUrl(imageUrl, project.id);
      if (!isGenerationOperationCurrent(operation)) return;
      const candidateId = `asset-board-${window.crypto.randomUUID()}`;
      const stagedCandidate: ProductionAssetBoardCandidate = {
        candidateId,
        board,
        imageUrl: persistedImageUrl,
        finalPrompt: referenceMode === "clean_reference" ? board.cleanPrompt || "" : board.prompt || "",
        source: "upload",
        sourceContentHash,
        referenceMode,
        layoutContractId: modeSpec.contractId,
        review: { mode: "manual", status: "pending" },
      };
      if (!isGenerationOperationCurrent(operation)) return;
      const savedProject = await legacyProjectClient.stageProductionAssetBoardCandidate(project.id, {
        candidateId,
        boardItemId: board.id,
        imageUrl: persistedImageUrl,
        source: "upload",
        finalPrompt: stagedCandidate.finalPrompt,
        sourceContentHash,
        referenceMode,
        review: stagedCandidate.review,
      });
      if (!isGenerationOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      const persisted = savedProject.manualProductionAssets?.pendingReferences?.find((item) => item.id === candidateId);
      setTransientCandidate({
        ...stagedCandidate,
        sourceContentHash: persisted?.sourceContentHash || sourceContentHash,
        sourceReview: reviewProductionAssetBoardCandidateSource({
          project: savedProject,
          candidate: persisted || {
            boardItemId: board.id,
            referenceMode,
            sourceContentHash,
          },
        }),
      });
    } catch (error) {
      if (!isGenerationOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "资产板导入失败");
    } finally {
      finishGenerationOperation(operation);
    }
  };

  const adoptCandidate = async () => {
    if (!project || !candidate || isAdopting) return;
    const operation = beginReviewOperation(project.id);
    if (!operation) return;
    setIsAdopting(true);
    try {
      if (!candidate.candidateId) throw new Error("资产板候选缺少持久化 ID，不能采用。");
      const savedProject = await legacyProjectClient.adoptProductionAssetBoardCandidate(project.id, candidate.candidateId);
      if (!isReviewOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      setTransientCandidate(null);
      const modeSpec = resolveProductionAssetReferenceModeSpec(candidate.board, candidate.referenceMode);
      const adoptedAudit = savedProject.manualProductionAssets?.references?.find((item) => item.candidateId === candidate.candidateId);
      toast.success(adoptedAudit?.sourceReview?.status === "review_recommended"
        ? `已按你的明确操作采用为${modeSpec.label}；来源有更新，建议复核`
        : `已采用为${modeSpec.label}${candidate.referenceMode === "clean_reference" ? "，后续模型优先引用此图" : ""}`);
    } catch (error) {
      if (!isReviewOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "采用资产板失败");
    } finally {
      finishReviewOperation(operation);
    }
  };

  const discardCandidate = async () => {
    if (!project || !candidate?.candidateId || isAdopting) {
      if (!project || !candidate?.candidateId) setTransientCandidate(null);
      return;
    }
    const operation = beginReviewOperation(project.id);
    if (!operation) return;
    setIsAdopting(true);
    try {
      const savedProject = await legacyProjectClient.discardProductionAssetBoardCandidate(project.id, candidate.candidateId);
      if (!isReviewOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      setTransientCandidate(null);
    } catch (error) {
      if (!isReviewOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "放弃资产板候选失败");
    } finally {
      finishReviewOperation(operation);
    }
  };

  return {
    isPromptOpen,
    isGenerating,
    candidate,
    isAdopting,
    openPrompt,
    closePrompt: () => setIsPromptOpen(false),
    generateCandidate,
    stageUpload,
    adoptCandidate,
    discardCandidate,
  };
};
