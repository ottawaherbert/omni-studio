import type { AIExecutionProvenance } from "../clients/domainTypes";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Episode, ImageGenerationReferenceAudit, ManualProductionAssetReferenceAudit, Project, PromptCompositionManifestAudit, Scene, VisualCompileManifest } from "../clients/domainTypes";
import { generateAIImage } from "../clients/aiClient";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
  buildProductionAssetImageVisualStyleProjection,
  buildProductionAssetVisualRecipeInputEvidence,
  productionAssetBoardCandidateSourceContentHash,
  reviewProductionAssetBoardCandidateSource,
} from "../clients/productionVisualImageClient";
import { replaceCurrentProjectSnapshot } from "../clients/stateClient";
import type { ImagePromptSelection } from "../components/ImagePromptModal";
import {
  buildManualProductionAssetReadModel,
  type ManualProductionAssetBoard,
} from "../clients/productionAssetWorkflowClient";
import { summarizeUnknownError } from "../utils/logging";
import { persistProjectMediaUrl } from "../clients/projectMediaClient";
import {
  createCanonicalAssetGenerationReference,
  type CompiledImageGenerationRequest,
} from "../clients/productionStudioWorkflowClient";

export interface ManualProductionReferenceImageCandidate {
  candidateId: string;
  board: ManualProductionAssetBoard;
  imageUrl: string;
  source: ManualProductionAssetReferenceAudit["source"];
  finalPrompt: string;
  modelId?: string;
  executionProvenance?: AIExecutionProvenance;
  inputReferenceUrl?: string;
  imageReferenceManifest?: ImageGenerationReferenceAudit[];
  promptCompositionManifest?: PromptCompositionManifestAudit;
  visualStyleCompileManifest?: VisualCompileManifest;
  sourceContentHash?: string;
  sourceReview?: ManualProductionAssetReferenceAudit["sourceReview"];
  selection?: ImagePromptSelection;
}

interface ManualAssetImageOperationToken {
  projectId: string;
  scopeKey: string;
  epoch: number;
}

export const useManualProductionAssetImages = ({
  project,
  episode,
  scene,
}: {
  project: Project;
  episode: Episode;
  scene: Scene;
  updateProject: (updates: Partial<Project>) => Promise<void>;
}) => {
  const [promptBoard, setPromptBoard] = useState<ManualProductionAssetBoard | null>(null);
  const [generatingBoardId, setGeneratingBoardId] = useState<string | null>(null);
  const [transientCandidate, setTransientCandidate] = useState<ManualProductionReferenceImageCandidate | null>(null);
  const [isAdoptingCandidate, setIsAdoptingCandidate] = useState(false);
  const operationScopeKey = `${project.id}:${episode.id}:${scene.id}`;
  const activeProjectIdRef = useRef(project.id);
  const activeScopeKeyRef = useRef(operationScopeKey);
  const generationEpochRef = useRef(0);
  const reviewEpochRef = useRef(0);
  const inFlightGenerationScopesRef = useRef(new Set<string>());
  const inFlightReviewScopesRef = useRef(new Set<string>());
  const beginGenerationOperation = (): ManualAssetImageOperationToken | null => {
    if (inFlightGenerationScopesRef.current.has(operationScopeKey)) return null;
    const operation = { projectId: project.id, scopeKey: operationScopeKey, epoch: generationEpochRef.current + 1 };
    generationEpochRef.current = operation.epoch;
    inFlightGenerationScopesRef.current.add(operation.scopeKey);
    return operation;
  };
  const isGenerationOperationCurrent = (operation: ManualAssetImageOperationToken) => (
    activeProjectIdRef.current === operation.projectId
    && activeScopeKeyRef.current === operation.scopeKey
    && generationEpochRef.current === operation.epoch
  );
  const finishGenerationOperation = (operation: ManualAssetImageOperationToken) => {
    inFlightGenerationScopesRef.current.delete(operation.scopeKey);
    if (!isGenerationOperationCurrent(operation)) return;
    setGeneratingBoardId(null);
  };
  const beginReviewOperation = (): ManualAssetImageOperationToken | null => {
    if (inFlightReviewScopesRef.current.has(operationScopeKey)) return null;
    const operation = { projectId: project.id, scopeKey: operationScopeKey, epoch: reviewEpochRef.current + 1 };
    reviewEpochRef.current = operation.epoch;
    inFlightReviewScopesRef.current.add(operation.scopeKey);
    return operation;
  };
  const isReviewOperationCurrent = (operation: ManualAssetImageOperationToken) => (
    activeProjectIdRef.current === operation.projectId
    && activeScopeKeyRef.current === operation.scopeKey
    && reviewEpochRef.current === operation.epoch
  );
  const finishReviewOperation = (operation: ManualAssetImageOperationToken) => {
    inFlightReviewScopesRef.current.delete(operation.scopeKey);
    if (isReviewOperationCurrent(operation)) setIsAdoptingCandidate(false);
  };
  const sceneAssetBoards = useMemo(
    () => buildManualProductionAssetReadModel({ project, episode, scene }).assetBoards,
    [episode, project, scene],
  );
  const persistedCandidate = useMemo<ManualProductionReferenceImageCandidate | null>(() => {
    const boardById = new Map(sceneAssetBoards.map((board) => [board.boardItemId, board]));
    const pending = [...(project.manualProductionAssets?.pendingReferences || [])]
      .filter((item) => boardById.has(item.boardItemId) && (item.referenceMode || "production_board") === "production_board")
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const board = pending ? boardById.get(pending.boardItemId) : undefined;
    if (!pending || !board) return null;
    return {
      candidateId: pending.id,
      board,
      imageUrl: pending.imageUrl,
      source: pending.source,
      finalPrompt: pending.finalPrompt || "",
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
        selectedSkillIds: pending.selectedSkillIds || [],
        selectedSkillTitles: pending.selectedSkillTitles || [],
        selectedContextIds: pending.selectedContextIds || [],
      },
    };
  }, [project.manualProductionAssets?.pendingReferences, sceneAssetBoards]);
  const rawCandidate = transientCandidate || persistedCandidate;
  const candidate = useMemo<ManualProductionReferenceImageCandidate | null>(() => {
    if (!rawCandidate) return null;
    return {
      ...rawCandidate,
      sourceReview: reviewProductionAssetBoardCandidateSource({
        project,
        candidate: {
          boardItemId: rawCandidate.board.boardItemId,
          referenceMode: "production_board",
          sourceContentHash: rawCandidate.sourceContentHash,
        },
      }),
    };
  }, [project, rawCandidate]);

  useLayoutEffect(() => {
    activeProjectIdRef.current = project.id;
    activeScopeKeyRef.current = operationScopeKey;
    generationEpochRef.current += 1;
    reviewEpochRef.current += 1;
    setPromptBoard(null);
    setTransientCandidate(null);
    setGeneratingBoardId(null);
    setIsAdoptingCandidate(false);
  }, [operationScopeKey]);
  const openPrompt = (board: ManualProductionAssetBoard) => {
    setPromptBoard(board);
  };

  const generateReferenceImage = async (
    finalPrompt: string,
    inputReferenceUrl?: string,
    selection?: ImagePromptSelection,
  ) => {
    const board = promptBoard;
    if (!board || generatingBoardId) return;
    const operation = beginGenerationOperation();
    if (!operation) return;
    setGeneratingBoardId(board.boardItemId);
    try {
      const sourceContentHash = productionAssetBoardCandidateSourceContentHash({
        project,
        boardItemId: board.boardItemId,
        referenceMode: "production_board",
      });
      const aspectRatio = board.assetType === "character" ? "3:4" : board.assetType === "prop" ? "1:1" : "16:9";
      let compiledRequest: CompiledImageGenerationRequest | undefined;
      let executionProvenance: AIExecutionProvenance | undefined;
      const visualStyleProjection = buildProductionAssetImageVisualStyleProjection({
        project,
        asset: {
          assetId: board.assetId,
          assetType: board.assetType,
          assetName: board.assetName,
          variantId: board.variantId,
          variantName: board.variantName,
        },
      });
      const generatedImageUrl = await generateAIImage({
        promptCore: finalPrompt,
        aspectRatio,
        visualStyleProjection,
        visualRecipeInputEvidence: buildProductionAssetVisualRecipeInputEvidence({ project, asset: {
          assetId: board.assetId,
          assetType: board.assetType,
          assetName: board.assetName,
          variantId: board.variantId,
          variantName: board.variantName,
        } }),
        references: inputReferenceUrl ? [createCanonicalAssetGenerationReference({
          imageUrl: inputReferenceUrl,
          label: `${board.assetName}${board.variantName ? ` · ${board.variantName}` : ""} 的 canonical 身份与上游状态参考`,
          assetType: board.assetType,
          stateChange: Boolean(board.variantId),
        })] : undefined,
        operation: { kind: "generate" },
        onExecutionProvenance: audit => { executionProvenance = audit; },
        onPromptCompiled: (compiled) => {
          compiledRequest = compiled;
        },
      });
      if (!isGenerationOperationCurrent(operation)) return;
      const imageUrl = await persistProjectMediaUrl(generatedImageUrl, project.id);
      if (!isGenerationOperationCurrent(operation)) return;
      const candidateId = `asset-board-${window.crypto.randomUUID()}`;
      const nextCandidate: ManualProductionReferenceImageCandidate = {
        candidateId,
        board,
        imageUrl,
        source: executionProvenance?.source === "manual_external" ? "upload" : "ai_generation",
        finalPrompt: compiledRequest?.providerPrompt || finalPrompt,
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
      };
      const savedProject = await legacyProjectClient.stageProductionAssetBoardCandidate(project.id, {
        candidateId,
        boardItemId: board.boardItemId,
        imageUrl,
        source: nextCandidate.source,
        finalPrompt: compiledRequest?.providerPrompt || finalPrompt,
        modelId: nextCandidate.modelId,
        executionProvenance: nextCandidate.executionProvenance,
        inputReferenceUrl,
        imageReferenceManifest: nextCandidate.imageReferenceManifest,
        promptCompositionManifest: nextCandidate.promptCompositionManifest,
        visualStyleCompileManifest: nextCandidate.visualStyleCompileManifest,
        sourceContentHash,
        selectedSkillIds: selection?.selectedSkillIds || [],
        selectedSkillTitles: selection?.selectedSkillTitles || [],
        selectedContextIds: selection?.selectedContextIds || [],
      });
      if (!isGenerationOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      const persisted = savedProject.manualProductionAssets?.pendingReferences?.find((item) => item.id === candidateId);
      setTransientCandidate({
        ...nextCandidate,
        sourceContentHash: persisted?.sourceContentHash || sourceContentHash,
        sourceReview: reviewProductionAssetBoardCandidateSource({
          project: savedProject,
          candidate: persisted || {
            boardItemId: board.boardItemId,
            referenceMode: "production_board",
            sourceContentHash,
          },
        }),
      });
      toast.success("参考图候选已生成，请预览后采用");
    } catch (error) {
      if (!isGenerationOperationCurrent(operation)) return;
      console.error("Manual production asset image generation failed:", summarizeUnknownError(error));
      toast.error(error instanceof Error ? error.message : "参考图生成失败");
    } finally {
      if (isGenerationOperationCurrent(operation)) setPromptBoard(null);
      finishGenerationOperation(operation);
    }
  };

  const importReferenceImage = async (board: ManualProductionAssetBoard, file: File) => {
    if (generatingBoardId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件。");
      return;
    }
    const operation = beginGenerationOperation();
    if (!operation) return;
    setGeneratingBoardId(board.boardItemId);
    try {
      const sourceContentHash = productionAssetBoardCandidateSourceContentHash({
        project,
        boardItemId: board.boardItemId,
        referenceMode: "production_board",
      });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败。"));
        reader.readAsDataURL(file);
      });
      if (!isGenerationOperationCurrent(operation)) return;
      const imageUrl = await persistProjectMediaUrl(dataUrl, project.id);
      if (!isGenerationOperationCurrent(operation)) return;
      const candidateId = `asset-board-${window.crypto.randomUUID()}`;
      const nextCandidate: ManualProductionReferenceImageCandidate = {
        candidateId,
        board,
        imageUrl,
        source: "upload",
        finalPrompt: "",
        sourceContentHash,
      };
      const savedProject = await legacyProjectClient.stageProductionAssetBoardCandidate(project.id, {
        candidateId,
        boardItemId: board.boardItemId,
        imageUrl,
        source: "upload",
        finalPrompt: "",
        sourceContentHash,
      });
      if (!isGenerationOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      const persisted = savedProject.manualProductionAssets?.pendingReferences?.find((item) => item.id === candidateId);
      setTransientCandidate({
        ...nextCandidate,
        sourceContentHash: persisted?.sourceContentHash || sourceContentHash,
        sourceReview: reviewProductionAssetBoardCandidateSource({
          project: savedProject,
          candidate: persisted || {
            boardItemId: board.boardItemId,
            referenceMode: "production_board",
            sourceContentHash,
          },
        }),
      });
      toast.success("图片已导入，请预览后采用");
    } catch (error) {
      if (!isGenerationOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "导入资产图片失败");
    } finally {
      finishGenerationOperation(operation);
    }
  };

  const adoptCandidate = async () => {
    if (!candidate || isAdoptingCandidate) return;
    const operation = beginReviewOperation();
    if (!operation) return;
    setIsAdoptingCandidate(true);
    try {
      const savedProject = await legacyProjectClient.adoptProductionAssetBoardCandidate(project.id, candidate.candidateId);
      if (!isReviewOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      const adoptedAudit = savedProject.manualProductionAssets?.references?.find((item) => item.candidateId === candidate.candidateId);
      toast.success(adoptedAudit?.sourceReview?.status === "review_recommended"
        ? "参考图已按你的明确操作采用；来源有更新，建议复核。"
        : candidate.board.referenceImageUrl ? "新参考图已采用，请重新确认资产身份" : "参考图已采用，请确认资产身份");
      setTransientCandidate(null);
    } catch (error) {
      if (!isReviewOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "采用参考图失败");
    } finally {
      finishReviewOperation(operation);
    }
  };

  const discardCandidate = async () => {
    if (!candidate || isAdoptingCandidate) return;
    const operation = beginReviewOperation();
    if (!operation) return;
    setIsAdoptingCandidate(true);
    try {
      const savedProject = await legacyProjectClient.discardProductionAssetBoardCandidate(project.id, candidate.candidateId);
      if (!isReviewOperationCurrent(operation) || !replaceCurrentProjectSnapshot(savedProject)) return;
      setTransientCandidate(null);
      toast.success("候选已放弃，正式参考图保持不变");
    } catch (error) {
      if (!isReviewOperationCurrent(operation)) return;
      toast.error(error instanceof Error ? error.message : "放弃候选失败");
    } finally {
      finishReviewOperation(operation);
    }
  };

  return {
    promptBoard,
    generatingBoardId,
    candidate,
    isAdoptingCandidate,
    openPrompt,
    closePrompt: () => setPromptBoard(null),
    generateReferenceImage,
    importReferenceImage,
    adoptCandidate,
    discardCandidate: () => void discardCandidate(),
  };
};
