import type {
  ManualProductionAssetReferenceAudit,
  ManualProductionAssetReferenceCandidate,
  Project,
} from "../../types/project";
import { manualFilmTeamScriptHash } from "./manualFilmTeam";
import { resolveProductionAssetBoardGenerationReference } from "./productionAssetBoardProfile";
import { buildProductionAssetVisualStyleProjection } from "./productionAssetVisualStyle";
import {
  buildVideoStoryboardAssetBoardPlan,
  type VideoStoryboardAssetBoardItem,
} from "./videoStoryboardAssetBoards";

type ProductionAssetBoardCandidateSourceReview = NonNullable<
  ManualProductionAssetReferenceAudit["sourceReview"]
>;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

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

const boardOwner = (project: Project, board: VideoStoryboardAssetBoardItem) => (
  board.assetType === "character"
    ? project.characters.find((item) => item.id === board.assetId)
    : project.assets.find((item) => item.id === board.assetId)
);

/**
 * Fingerprints authored inputs rather than the generated candidate. The selected
 * identity, state parent, board contract, local override and resolved project style
 * all participate so a later edit can recommend review without revoking the image.
 */
export const productionAssetBoardCandidateSourceContentHash = ({
  project,
  boardItemId,
  referenceMode = "production_board",
}: {
  project: Project;
  boardItemId: string;
  referenceMode?: "production_board" | "clean_reference";
}) => {
  const board = allBoardItems(project).find((item) => item.id === boardItemId);
  if (!board) throw new Error("找不到当前资产板，无法计算候选来源指纹。");
  const owner = boardOwner(project, board);
  const variant = board.variantId
    ? owner?.variants?.find((item) => item.id === board.variantId)
    : undefined;
  const inheritedVariant = variant?.referenceVariantId
    ? owner?.variants?.find((item) => item.id === variant.referenceVariantId)
    : undefined;
  const generationReference = resolveProductionAssetBoardGenerationReference(project, board);
  const style = buildProductionAssetVisualStyleProjection({ project, asset: board });
  return manualFilmTeamScriptHash(stableStringify({
    schemaVersion: "production-asset-board-candidate-source.v1",
    referenceMode,
    board: {
      id: board.id,
      assetId: board.assetId,
      assetType: board.assetType,
      assetName: board.assetName,
      variantId: board.variantId,
      variantName: board.variantName,
      boardKind: board.boardKind,
      strategyId: board.strategyId,
      layoutContract: board.layoutContract,
      imageModelProfileId: board.imageModelProfileId,
      executionPrompt: referenceMode === "clean_reference" ? board.cleanPrompt : board.prompt,
      productionReferenceImageUrl: board.productionReferenceImageUrl,
      cleanReferenceImageUrl: board.cleanReferenceImageUrl,
      referenceImageUrl: board.referenceImageUrl,
      continuityRole: board.continuityRole,
      styleLockSummary: board.styleLockSummary,
      productionUse: board.productionUse,
    },
    canonicalIdentity: owner ? {
      id: owner.id,
      name: owner.name,
      ...(board.assetType === "character"
        ? {
            visualIdentity: "visualIdentity" in owner ? owner.visualIdentity : undefined,
            referenceImageUrl: "referenceImageUrl" in owner ? owner.referenceImageUrl : undefined,
            boardPrompt: owner.boardPrompt,
            cleanReferencePrompt: owner.cleanReferencePrompt,
            multiViewPrompt: owner.multiViewPrompt,
            boardImageUrl: owner.boardImageUrl,
            cleanReferenceImageUrl: owner.cleanReferenceImageUrl,
            multiViewUrl: owner.multiViewUrl,
            defaultReferenceUrl: owner.defaultReferenceUrl,
            defaultVariantId: owner.defaultVariantId,
          }
        : {
            type: "type" in owner ? owner.type : undefined,
            description: "description" in owner ? owner.description : undefined,
            prompt: "prompt" in owner ? owner.prompt : undefined,
            imageUrl: "imageUrl" in owner ? owner.imageUrl : undefined,
            boardPrompt: owner.boardPrompt,
            cleanReferencePrompt: owner.cleanReferencePrompt,
            panoramaPrompt: "panoramaPrompt" in owner ? owner.panoramaPrompt : undefined,
            multiViewPrompt: owner.multiViewPrompt,
            boardImageUrl: owner.boardImageUrl,
            cleanReferenceImageUrl: owner.cleanReferenceImageUrl,
            panoramaUrl: "panoramaUrl" in owner ? owner.panoramaUrl : undefined,
            multiViewUrl: owner.multiViewUrl,
            defaultReferenceUrl: owner.defaultReferenceUrl,
            defaultVariantId: owner.defaultVariantId,
          }),
      visualOverride: owner.visualOverride,
    } : undefined,
    variant,
    inheritedVariant,
    generationReference,
    visualStyle: {
      schemaVersion: project.visualStyleLock?.schemaVersion,
      revision: project.visualStyleLock?.revision,
      declaredContentHash: project.visualStyleLock?.contentHash,
      humanApprovalState: project.visualStyleLock?.humanApprovalState,
      resolvedContentHash: style.projection.sourceStyle.resolvedContentHash,
      intent: style.intent,
      target: style.target,
      overrideSource: style.overrideSource,
      appliedMediumAssignmentIds: style.projection.appliedMediumAssignmentIds,
      suppressedFields: style.projection.suppressedFields,
      issueCodes: style.projection.issues.map((issue) => issue.code),
    },
  }));
};

export const reviewProductionAssetBoardCandidateSource = ({
  project,
  candidate,
  detectedAt = Date.now(),
}: {
  project: Project;
  candidate: Pick<ManualProductionAssetReferenceCandidate, "boardItemId" | "referenceMode" | "sourceContentHash">;
  detectedAt?: number;
}): ProductionAssetBoardCandidateSourceReview => {
  const currentSourceContentHash = productionAssetBoardCandidateSourceContentHash({
    project,
    boardItemId: candidate.boardItemId,
    referenceMode: candidate.referenceMode,
  });
  if (!candidate.sourceContentHash) {
    return {
      status: "review_recommended",
      reasons: ["source_fingerprint_missing"],
      currentSourceContentHash,
      detectedAt,
    };
  }
  if (candidate.sourceContentHash !== currentSourceContentHash) {
    return {
      status: "review_recommended",
      reasons: ["source_updated"],
      candidateSourceContentHash: candidate.sourceContentHash,
      currentSourceContentHash,
      detectedAt,
    };
  }
  return {
    status: "current",
    reasons: [],
    candidateSourceContentHash: candidate.sourceContentHash,
    currentSourceContentHash,
    detectedAt,
  };
};
