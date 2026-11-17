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
    ...plan.sceneViewBoards,
    ...plan.characterReferenceBoards,
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
  if (board.locationView || board.characterReferenceLayout) referenceMode = 'clean_reference';
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
    locationView: board.locationView,
    characterReferenceLayout: board.characterReferenceLayout,
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
    ...(project.manualProductionAssets?.pendingReferences || []).filter((item) => item.id !== candidate.id),
    candidate,
  ];
  return {
    manualProductionAssets: registryWithPendingReferences(project, pendingReferences, createdAt),
  };
};

export const adoptProductionAssetBoardReferenceCandidate = ({
  project,
  candidateId,
  adoptedBy = 'user',
  review,
  adoptedAt = Date.now(),
}: {
  project: Project;
  candidateId: string;
  adoptedBy?: 'user' | 'external_agent';
  review?: ManualProductionAssetReferenceAudit['review'];
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
    adoptedBy,
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
    review: review || (candidate.locationView || candidate.characterReferenceLayout ? { ...candidate.review, mode: 'manual', status: 'approved', reviewer: adoptedBy === 'external_agent' ? 'external_agent' : 'creator', reviewedAt: adoptedAt } : candidate.review),
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
        .filter((item) => item.id !== candidate.id),
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
      pendingReferences.filter((item) => item.id !== candidate.id),
      discardedAt,
    ),
  };
};

/** Return the current candidate to review without deleting its media or provenance. */
export const returnProductionAssetBoardReferenceCandidateToReview = ({
  project, candidateId, reviewer, notes, reviewedAt = Date.now(),
}: {
  project: Project;
  candidateId: string;
  reviewer: 'creator' | 'external_agent';
  notes: string;
  reviewedAt?: number;
}): Pick<Project, 'characters' | 'assets' | 'manualProductionAssets'> => {
  const registry = project.manualProductionAssets;
  const adopted = registry?.references?.find(item => item.candidateId === candidateId);
  const pending = registry?.pendingReferences?.find(item => item.id === candidateId);
  if (!adopted && !pending) return { characters: project.characters, assets: project.assets, manualProductionAssets: registry };
  const source = adopted || pending!;
  const review = { mode: 'manual' as const, status: 'pending' as const, reviewer, notes, reviewedAt };
  const clearCurrent = <T extends object>(value: T, variant = false): T => {
    const next = { ...value } as Record<string, unknown>;
    if (source.locationView) {
      const views = (value as { locationViews?: import('../../types/project').LocationViews }).locationViews;
      if (views?.[source.locationView]?.imageUrl !== source.imageUrl) return value;
      return { ...value, locationViews: { ...views, [source.locationView]: { ...views[source.locationView], imageUrl: undefined, sourceHash: undefined, reviewedAt: undefined } } };
    }
    if (source.characterReferenceLayout) {
      const layouts = (value as import('../../types/project').CharacterReferenceLayoutFields).characterReferenceLayouts;
      if (layouts?.[source.characterReferenceLayout]?.imageUrl === source.imageUrl) next.characterReferenceLayouts = {...layouts,[source.characterReferenceLayout]:{...layouts[source.characterReferenceLayout],imageUrl:undefined}};
    }
    const field = source.referenceMode === 'clean_reference' ? 'cleanReferenceImageUrl' : 'boardImageUrl';
    if (next[field] !== source.imageUrl) return next as T;
    next[field] = undefined;
    const fallback = next.cleanReferenceImageUrl || next.boardImageUrl;
    for (const key of variant ? ['imageUrl'] : ['multiViewUrl', 'panoramaUrl']) {
      if (next[key] === source.imageUrl) next[key] = fallback;
    }
    return next as T;
  };
  const update = <T extends { id: string; variants?: NonNullable<Project['assets'][number]['variants']> }>(value: T): T => {
    if (!adopted || value.id !== source.assetId) return value;
    return source.variantId
      ? { ...value, variants: value.variants?.map(variant => variant.id === source.variantId ? clearCurrent(variant, true) : variant) }
      : clearCurrent(value);
  };
  const characters = project.characters.map(update);
  let assets = project.assets.map(update);
  if (adopted?.assetType === 'character') {
    const character = characters.find(item => item.id === adopted.assetId);
    if (character) assets = assets.map(asset => asset.id === `char-${adopted.assetId}` ? {
      ...asset, boardImageUrl: character.boardImageUrl, cleanReferenceImageUrl: character.cleanReferenceImageUrl,
      multiViewUrl: character.multiViewUrl, variants: character.variants || [],
    } : asset);
  }
  const candidate: ManualProductionAssetReferenceCandidate = { ...source, id: candidateId, status: 'pending_review', review, updatedAt: reviewedAt };
  return { characters, assets, manualProductionAssets: {
    ...registryWithPendingReferences(project, [...(registry?.pendingReferences || []).filter(item => item.id !== candidateId), candidate], reviewedAt),
    references: (registry?.references || []).filter(item => item.candidateId !== candidateId),
  } };
};
