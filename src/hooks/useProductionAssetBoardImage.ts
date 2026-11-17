import { useLayoutEffect,useMemo,useRef,useState } from "react";
import toast from "react-hot-toast";
import type { AIExecutionProvenance } from "../clients/domainTypes";

import type { ImageGenerationReferenceAudit,ManualProductionAssetReferenceAudit,ManualStoryboardAgentQuality,Project,PromptCompositionManifestAudit,VisualCompileManifest } from "../clients/domainTypes";
import { legacyProjectClient } from "../clients/legacyProjectClient";
import {
productionAssetBoardCandidateSourceContentHash,
reviewProductionAssetBoardCandidateSource
} from "../clients/productionVisualImageClient";
import { replaceCurrentProjectSnapshot } from "../clients/stateClient";

import type { VideoStoryboardAssetBoardItem } from "../clients/productionAssetWorkflowClient";
import {
resolveProductionAssetReferenceModeSpec,
type ProductionAssetReferenceMode,
} from "../clients/productionAssetWorkflowClient";
import { persistProjectMediaUrl } from "../clients/projectMediaClient";

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
  selection?: Pick<ManualProductionAssetReferenceAudit, "selectedSkillIds" | "selectedSkillTitles" | "selectedContextIds">;
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
    setIsGenerating(false);
    setIsAdopting(false);
  }, [operationScopeKey]);
  const stageUpload = async (imageUrl: string, source: "upload" | "existing" = "upload") => {
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
        source,
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
        source,
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
    isGenerating,
    candidate,
    isAdopting,
    stageUpload,
    adoptCandidate,
    discardCandidate,
  };
};
