import type {
  ManualProductionAssetReferenceAudit,
  ManualProductionAssetReferenceCandidate,
  Project,
} from "../../types/project";
import { manualFilmTeamScriptHash } from "./manualFilmTeam";
import {
  buildProductionAssetBoardReferenceUpdate,
  projectSceneIdsForBoard,
} from "./productionAssetBoardProfile";
import {
  productionAssetBoardCandidateSourceContentHash,
  reviewProductionAssetBoardCandidateSource,
} from "./productionAssetBoardCandidateSource";
import { resolveProductionAssetReferenceModeSpec } from "./productionAssetReferenceMode";
import { buildVideoStoryboardAssetBoardPlan } from "./videoStoryboardAssetBoards";

export {
  productionAssetBoardCandidateSourceContentHash,
  reviewProductionAssetBoardCandidateSource,
} from "./productionAssetBoardCandidateSource";

const allBoardItems = (project: Project) => {
  const plan = buildVideoStoryboardAssetBoardPlan(project);
  return [
    ...plan.characterBoards,
    ...plan.sceneBoards,
    ...plan.propBoards,
    ...plan.vehicleBoards,
    ...plan.variantBoards,
  ];
};

const registryWithPendingReferences = (
  project: Project,
  pendingReferences: ManualProductionAssetReferenceCandidate[],
  updatedAt: number,
) => ({
  schemaVersion: "manual-production-assets.v1" as const,
  approvals: project.manualProductionAssets?.approvals || [],
  references: project.manualProductionAssets?.references || [],
  pendingReferences,
  variants: project.manualProductionAssets?.variants || [],
  profileRevisions: project.manualProductionAssets?.profileRevisions || [],
  preparationBatches: project.manualProductionAssets?.preparationBatches || [],
  updatedAt,
});

export const stageProductionAssetBoardReferenceCandidate = ({
  project,
  candidateId,
  boardItemId,
  imageUrl,
  source,
  finalPrompt,
  modelId,
  executionProvenance,
  inputReferenceUrl,
  imageReferenceManifest,
  promptCompositionManifest,
  visualStyleCompileManifest,
  sourceContentHash: generatedFromSourceContentHash,
  selectedSkillIds = [],
  selectedSkillTitles = [],
  selectedContextIds = [],
  quality,
  review = { mode: "manual", status: "pending" },
  referenceMode = "production_board",
  sourceRunId,
  createdAt = Date.now(),
}: {
  project: Project;
  candidateId: string;
  boardItemId: string;
  imageUrl: string;
  source: ManualProductionAssetReferenceAudit["source"];
  finalPrompt: string;
  modelId?: string;
  executionProvenance?: ManualProductionAssetReferenceAudit["executionProvenance"];
  inputReferenceUrl?: string;
  imageReferenceManifest?: ManualProductionAssetReferenceAudit["imageReferenceManifest"];
  promptCompositionManifest?: ManualProductionAssetReferenceAudit["promptCompositionManifest"];
  visualStyleCompileManifest?: ManualProductionAssetReferenceAudit["visualStyleCompileManifest"];
  /** Client/worker fingerprint captured before generation; omitted callers are fingerprinted at staging time. */
  sourceContentHash?: string;
  selectedSkillIds?: string[];
  selectedSkillTitles?: string[];
  selectedContextIds?: string[];
  quality?: ManualProductionAssetReferenceAudit["quality"];
  review?: ManualProductionAssetReferenceAudit["review"];
  referenceMode?: "production_board" | "clean_reference";
  sourceRunId?: string;
  createdAt?: number;
}): Pick<Project, "manualProductionAssets"> => {
  const board = allBoardItems(project).find((item) => item.id === boardItemId);
  if (!board) throw new Error("找不到当前资产板，无法登记待审候选。");
  if (!candidateId.trim()) throw new Error("资产板候选缺少稳定 ID，无法登记。");
  if (!imageUrl.trim()) throw new Error("资产板候选图片为空，无法登记。");
  const modeSpec = resolveProductionAssetReferenceModeSpec(board, referenceMode);
  if (generatedFromSourceContentHash && !/^[a-f0-9]{64}$/u.test(generatedFromSourceContentHash)) {
    throw new Error("资产板候选来源指纹格式无效，无法登记。");
  }
  const sourceContentHash = generatedFromSourceContentHash || productionAssetBoardCandidateSourceContentHash({
    project,
    boardItemId: board.id,
    referenceMode,
  });
  const candidate: ManualProductionAssetReferenceCandidate = {
    id: candidateId,
    status: "pending_review",
    boardItemId: board.id,
    assetId: board.assetId,
    assetType: board.assetType,
    variantId: board.variantId,
    imageUrl,
    source,
    promptHash: finalPrompt ? manualFilmTeamScriptHash(finalPrompt) : undefined,
    finalPrompt: finalPrompt || undefined,
    modelId,
    executionProvenance,
    inputReferenceUrl,
    imageReferenceManifest,
    promptCompositionManifest,
    visualStyleCompileManifest,
    sourceContentHash,
    selectedSkillIds,
    selectedSkillTitles,
    selectedContextIds,
    layoutContractId: modeSpec.contractId,
    referenceMode,
    quality,
    review,
    sourceSceneIds: projectSceneIdsForBoard(project, board),
    sourceRunId,
    createdAt,
    updatedAt: createdAt,
  };
  const pendingReferences = [
    ...(project.manualProductionAssets?.pendingReferences || []).filter((item) => (
      item.id !== candidate.id
      && (
        item.boardItemId !== candidate.boardItemId
        || (item.referenceMode || "production_board") !== (candidate.referenceMode || "production_board")
      )
    )),
    candidate,
  ];
  return {
    manualProductionAssets: registryWithPendingReferences(project, pendingReferences, createdAt),
  };
};

export const adoptProductionAssetBoardReferenceCandidate = ({
  project,
  candidateId,
  adoptedAt = Date.now(),
}: {
  project: Project;
  candidateId: string;
  adoptedAt?: number;
}): Pick<Project, "characters" | "assets" | "manualProductionAssets"> => {
  const candidate = project.manualProductionAssets?.pendingReferences?.find((item) => item.id === candidateId);
  if (!candidate) throw new Error("找不到待审资产板候选，无法采用。");
  const sourceReview = reviewProductionAssetBoardCandidateSource({
    project,
    candidate,
    detectedAt: adoptedAt,
  });
  const updates = buildProductionAssetBoardReferenceUpdate({
    project,
    boardItemId: candidate.boardItemId,
    imageUrl: candidate.imageUrl,
    source: candidate.source,
    sourceRunId: candidate.sourceRunId,
    finalPrompt: candidate.finalPrompt || "",
    modelId: candidate.modelId,
    executionProvenance: candidate.executionProvenance,
    inputReferenceUrl: candidate.inputReferenceUrl,
    imageReferenceManifest: candidate.imageReferenceManifest,
    promptCompositionManifest: candidate.promptCompositionManifest,
    visualStyleCompileManifest: candidate.visualStyleCompileManifest,
    sourceContentHash: candidate.sourceContentHash,
    sourceReview,
    selectedSkillIds: candidate.selectedSkillIds,
    selectedSkillTitles: candidate.selectedSkillTitles,
    selectedContextIds: candidate.selectedContextIds,
    quality: candidate.quality,
    review: candidate.review,
    referenceMode: candidate.referenceMode,
    candidateId: candidate.id,
    generatedAt: candidate.createdAt,
    createdAt: adoptedAt,
  });
  return {
    ...updates,
    manualProductionAssets: {
      ...updates.manualProductionAssets,
      pendingReferences: (project.manualProductionAssets?.pendingReferences || [])
        .filter((item) => item.boardItemId !== candidate.boardItemId
          || (item.referenceMode || "production_board") !== (candidate.referenceMode || "production_board")),
      updatedAt: adoptedAt,
    },
  };
};

export const discardProductionAssetBoardReferenceCandidate = ({
  project,
  candidateId,
  discardedAt = Date.now(),
}: {
  project: Project;
  candidateId: string;
  discardedAt?: number;
}): Pick<Project, "manualProductionAssets"> => {
  const pendingReferences = project.manualProductionAssets?.pendingReferences || [];
  const candidate = pendingReferences.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error("找不到待审资产板候选，无法放弃。");
  }
  return {
    manualProductionAssets: registryWithPendingReferences(
      project,
      pendingReferences.filter((item) => item.boardItemId !== candidate.boardItemId
        || (item.referenceMode || "production_board") !== (candidate.referenceMode || "production_board")),
      discardedAt,
    ),
  };
};
