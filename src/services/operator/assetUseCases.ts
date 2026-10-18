import crypto from "node:crypto";

import type { Project } from "../../types/project";
import { selectStoryboardReferenceItems } from "../production/mediaProductionWorker";
import { buildStoryboardMediaCandidateSourceHash } from "../production/storyboardMediaCandidateSource";
import type { AssetReferencePack, StoryboardBoard } from "../production/videoStoryboardArtifacts";
import type { OperatorArtifactEnvelope, OperatorRegisteredAsset, OperatorRun } from "./types";
import type { OperatorArtifactAccess } from "./artifactUseCases";

export class OperatorAssetUseCaseError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OperatorAssetUseCaseError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface OperatorAssetStore {
  transaction?<T>(operation: () => T): T;
  getProjectById(id: string): Project | null;
  getOperatorRunById(id: string): OperatorRun | null;
  getOperatorArtifactById(id: string): OperatorArtifactEnvelope | null;
  listOperatorArtifacts(filters?: { projectId?: string; runId?: string }): OperatorArtifactEnvelope[];
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
  listOperatorAssets(filters?: { projectId?: string; runId?: string; artifactId?: string }): OperatorRegisteredAsset[];
  saveOperatorAsset(asset: OperatorRegisteredAsset): OperatorRegisteredAsset;
  appendOperatorRunEvent(id: string, event: any): OperatorRun | null;
}

const storyboardBoardId = (artifact: OperatorArtifactEnvelope) => String(
  (artifact.data as { storyboardBoard?: { id?: string } } | undefined)?.storyboardBoard?.id || "",
);

const legacyStoryboardSourceContentHash = (artifact?: OperatorArtifactEnvelope) => {
  const board = (artifact?.data as { storyboardBoard?: StoryboardBoard } | undefined)?.storyboardBoard;
  if (!board) return "";
  const { generatedImageUrl: _generatedImageUrl, visualReview: _visualReview, ...contract } = board;
  return crypto.createHash("sha256").update(JSON.stringify(contract)).digest("hex");
};

const currentStoryboardSourceContentHash = (
  project: Project,
  storyboardArtifact: OperatorArtifactEnvelope,
  artifacts: OperatorArtifactEnvelope[],
) => {
  const board = (storyboardArtifact.data as { storyboardBoard?: StoryboardBoard } | undefined)?.storyboardBoard;
  if (!board) return "";
  const unit = [...artifacts]
    .filter((artifact) => artifact.kind === "video_generation_unit")
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((artifact) => (artifact.data as {
      videoGenerationUnit?: { storyboardBoardId?: string; assetReferencePackId?: string };
    }).videoGenerationUnit)
    .find((candidate) => candidate?.storyboardBoardId === board.id);
  const pack = unit?.assetReferencePackId
    ? [...artifacts]
      .filter((artifact) => artifact.kind === "asset_reference_pack")
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((artifact) => (artifact.data as { assetReferencePack?: AssetReferencePack }).assetReferencePack)
      .find((candidate) => candidate?.id === unit.assetReferencePackId)
    : undefined;
  return buildStoryboardMediaCandidateSourceHash({
    project,
    board,
    referenceItems: selectStoryboardReferenceItems(board, pack?.items),
  });
};

const storyboardSourceChanged = ({
  store,
  asset,
  currentArtifact,
}: {
  store: OperatorAssetStore;
  asset: OperatorRegisteredAsset;
  currentArtifact?: OperatorArtifactEnvelope;
}) => {
  if (!currentArtifact) return true;
  const generatedSourceHash = String(asset.metadata?.sourceContentHash || "");
  if (!generatedSourceHash) return currentArtifact.id !== asset.artifactId;
  if (!generatedSourceHash.startsWith("sha256-")) {
    return legacyStoryboardSourceContentHash(currentArtifact) !== generatedSourceHash;
  }
  const project = store.getProjectById(asset.projectId);
  if (!project) return true;
  return currentStoryboardSourceContentHash(
    project,
    currentArtifact,
    store.listOperatorArtifacts({ projectId: asset.projectId }),
  ) !== generatedSourceHash;
};

const decorateStoryboardCandidateFreshness = (
  store: OperatorAssetStore,
  assets: OperatorRegisteredAsset[],
) => {
  const latestByProjectAndBoard = new Map<string, OperatorArtifactEnvelope>();
  for (const projectId of new Set(assets.map((asset) => asset.projectId))) {
    for (const artifact of store.listOperatorArtifacts({ projectId }).sort((left, right) => right.updatedAt - left.updatedAt)) {
      if (artifact.kind !== "storyboard_board") continue;
      const boardId = storyboardBoardId(artifact);
      const key = `${projectId}:${boardId}`;
      if (!boardId || latestByProjectAndBoard.has(key)) continue;
      latestByProjectAndBoard.set(key, artifact);
    }
  }
  return assets.map((asset) => {
    if (asset.metadata?.phase !== "storyboards" || asset.metadata?.adoptionStatus !== "awaiting_review") return asset;
    const sourceId = String(asset.metadata?.sourceId || "");
    const latest = latestByProjectAndBoard.get(`${asset.projectId}:${sourceId}`);
    const sourceReviewRecommended = storyboardSourceChanged({ store, asset, currentArtifact: latest });
    return {
      ...asset,
      metadata: { ...asset.metadata, sourceReviewRecommended },
    };
  });
};

export const listOperatorAssetsForAccess = (
  store: OperatorAssetStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    runId,
    artifactId,
  }: {
    projectId?: string;
    runId?: string;
    artifactId?: string;
  },
) => {
  const normalizedProjectId = String(projectId || "").trim();
  const normalizedRunId = String(runId || "").trim();
  const normalizedArtifactId = String(artifactId || "").trim();

  if (normalizedRunId) {
    const run = store.getOperatorRunById(normalizedRunId);
    if (!run) {
      throw new OperatorAssetUseCaseError(404, "operator_run_not_found", "Operator run not found");
    }
    access.assertProjectAccess(run.projectId);
    if (normalizedProjectId && normalizedProjectId !== run.projectId) {
      throw new OperatorAssetUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
    }
    return decorateStoryboardCandidateFreshness(store, store.listOperatorAssets({
      projectId: run.projectId,
      runId: normalizedRunId,
      artifactId: normalizedArtifactId || undefined,
    }));
  }

  if (normalizedArtifactId) {
    const artifact = store.getOperatorArtifactById(normalizedArtifactId);
    if (!artifact) {
      throw new OperatorAssetUseCaseError(404, "operator_artifact_not_found", "Operator artifact not found");
    }
    access.assertProjectAccess(artifact.projectId);
    if (normalizedProjectId && normalizedProjectId !== artifact.projectId) {
      throw new OperatorAssetUseCaseError(409, "operator_artifact_project_mismatch", "Operator artifact does not belong to project");
    }
    return decorateStoryboardCandidateFreshness(store, store.listOperatorAssets({
      projectId: artifact.projectId,
      artifactId: normalizedArtifactId,
    }));
  }

  const projectIds = access.resolveReadableProjectIds(normalizedProjectId);
  return decorateStoryboardCandidateFreshness(
    store,
    projectIds.flatMap((id) => store.listOperatorAssets({ projectId: id })),
  );
};

export const registerOperatorAssetForAccess = (
  store: OperatorAssetStore,
  access: OperatorArtifactAccess,
  input: any,
) => {
  const projectId = String(input?.projectId || "").trim();
  if (!projectId) {
    throw new OperatorAssetUseCaseError(400, "operator_asset_project_required", "Missing projectId");
  }
  access.assertProjectAccess(projectId);
  const project = store.getProjectById(projectId);
  if (!project) {
    throw new OperatorAssetUseCaseError(404, "project_not_found", "Project not found");
  }

  if (input?.runId) {
    const run = store.getOperatorRunById(String(input.runId));
    if (!run) {
      throw new OperatorAssetUseCaseError(404, "operator_run_not_found", "Operator run not found");
    }
    if (run.projectId !== projectId) {
      throw new OperatorAssetUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
    }
  }

  if (input?.artifactId) {
    const artifact = store.getOperatorArtifactById(String(input.artifactId));
    if (!artifact) {
      throw new OperatorAssetUseCaseError(404, "operator_artifact_not_found", "Operator artifact not found");
    }
    if (artifact.projectId !== projectId) {
      throw new OperatorAssetUseCaseError(409, "operator_artifact_project_mismatch", "Operator artifact does not belong to project");
    }
  }

  const asset = store.saveOperatorAsset(input || {});
  if (asset.runId) {
    store.appendOperatorRunEvent(asset.runId, {
      type: "asset_generated",
      message: `Operator asset registered: ${asset.kind}`,
      targetPath: asset.targetEntity?.field || asset.targetEntity?.type,
      entityIds: [asset.targetEntity?.id || asset.projectId].filter(Boolean),
      data: { assetId: asset.id, mediaUrl: asset.mediaUrl, localPath: asset.localPath },
    });
  }
  return asset;
};

export const reviewOperatorStoryboardAssetForAccess = (
  store: OperatorAssetStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    assetId,
    decision,
  }: {
    projectId: string;
    assetId: string;
    decision: "adopt" | "discard";
  },
) => {
  const normalizedProjectId = String(projectId || "").trim();
  const normalizedAssetId = String(assetId || "").trim();
  if (!normalizedProjectId || !normalizedAssetId) {
    throw new OperatorAssetUseCaseError(400, "operator_asset_review_target_required", "Missing projectId or assetId");
  }
  access.assertProjectAccess(normalizedProjectId);
  const persistReview = () => {
    if (!store.getProjectById(normalizedProjectId)) {
      throw new OperatorAssetUseCaseError(404, "project_not_found", "Project not found");
    }
    const assets = store.listOperatorAssets({ projectId: normalizedProjectId });
    const candidate = assets.find((asset) => asset.id === normalizedAssetId);
    if (!candidate) {
      throw new OperatorAssetUseCaseError(404, "operator_asset_not_found", "Operator asset not found");
    }
    if (candidate.metadata?.phase !== "storyboards" || candidate.metadata?.adoptionStatus !== "awaiting_review") {
      throw new OperatorAssetUseCaseError(409, "operator_storyboard_candidate_not_pending", "Storyboard media candidate is not awaiting review");
    }
    const now = Date.now();
    const sourceId = String(candidate.metadata?.sourceId || "");
    const promptHash = String(candidate.metadata?.promptHash || "");
    const adoptionStatus = decision === "adopt" ? "adopted" : "discarded";
    const storyboardArtifacts = store.listOperatorArtifacts({ projectId: normalizedProjectId })
      .filter((artifact) => artifact.kind === "storyboard_board" && storyboardBoardId(artifact) === sourceId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const currentStoryboardArtifact = storyboardArtifacts[0];
    const sourceReviewRecommended = storyboardSourceChanged({
      store,
      asset: candidate,
      currentArtifact: currentStoryboardArtifact,
    });
    if (decision === "adopt") {
      if (!currentStoryboardArtifact) {
        throw new OperatorAssetUseCaseError(409, "operator_storyboard_source_missing", "Storyboard source artifact no longer exists");
      }
      const data = currentStoryboardArtifact.data as Record<string, unknown> & {
        storyboardBoard?: Record<string, unknown>;
      };
      if (!data.storyboardBoard || !candidate.mediaUrl) {
        throw new OperatorAssetUseCaseError(409, "operator_storyboard_candidate_invalid", "Storyboard candidate has no source board or media URL");
      }
      store.saveOperatorArtifact({
        ...currentStoryboardArtifact,
        id: `operator_storyboard_media_${candidate.id}`,
        targetPath: `${currentStoryboardArtifact.targetPath}.visual.${candidate.id}`,
        status: "draft",
        data: {
          ...data,
          storyboardBoard: {
            ...data.storyboardBoard,
            generatedImageUrl: candidate.mediaUrl,
            visualReview: {
              mode: "manual",
              status: "approved",
              technicalQA: "passed",
              warningCodes: Array.isArray(candidate.metadata?.warningCodes) ? candidate.metadata.warningCodes : [],
              modelConfigId: candidate.metadata?.modelConfigId,
              generatedAt: candidate.createdAt,
              reviewedAt: now,
              reviewedBy: "user",
            },
          },
          sourceReview: sourceReviewRecommended ? {
            status: "review_recommended",
            reason: "storyboard_source_updated_after_candidate_generation",
            sourceArtifactId: candidate.artifactId,
            currentArtifactId: currentStoryboardArtifact.id,
            detectedAt: now,
          } : {
            status: "current",
            sourceArtifactId: currentStoryboardArtifact.id,
            detectedAt: now,
          },
        },
        qaVerdicts: [],
        provenance: {
          ...currentStoryboardArtifact.provenance,
          inputContextHash: promptHash || currentStoryboardArtifact.provenance.inputContextHash,
          generatedAt: now,
        },
        commitResult: undefined,
        createdAt: now,
        updatedAt: now,
      });
    }
    const reviewed = store.saveOperatorAsset({
      ...candidate,
      qaStatus: decision === "adopt" ? "passed" : candidate.qaStatus,
      metadata: {
        ...candidate.metadata,
        adoptionStatus,
        visualQA: decision === "adopt" ? "manual_approved" : "manual_discarded",
        reviewedBy: "user",
        reviewedAt: now,
        sourceReviewRecommended,
        ...(decision === "adopt" ? { adoptedAt: now } : { discardedAt: now }),
      },
      updatedAt: now,
    });
    if (decision === "adopt") {
      for (const other of assets) {
        if (
          other.id === candidate.id
          || other.metadata?.phase !== "storyboards"
          || String(other.metadata?.sourceId || "") !== sourceId
          || !["awaiting_review", "adopted"].includes(String(other.metadata?.adoptionStatus || ""))
        ) continue;
        const wasAdopted = other.metadata?.adoptionStatus === "adopted";
        store.saveOperatorAsset({
          ...other,
          metadata: {
            ...other.metadata,
            adoptionStatus: wasAdopted ? "superseded" : "discarded",
            visualQA: wasAdopted ? "superseded_by_manual_adoption" : "discarded_after_manual_adoption",
            reviewedBy: "user",
            reviewedAt: now,
            discardedAt: now,
          },
          updatedAt: now,
        });
      }
    }
    if (candidate.runId) {
      store.appendOperatorRunEvent(candidate.runId, {
        type: "db_write",
        message: decision === "adopt"
          ? `用户已采用复合故事板候选：${sourceId}`
          : `用户已放弃复合故事板候选：${sourceId}`,
        entityIds: [sourceId, candidate.targetEntity?.sceneId].filter(Boolean),
        data: { assetId: candidate.id, candidateId: candidate.metadata?.candidateId, adoptionStatus },
      });
    }
    return reviewed;
  };
  return store.transaction ? store.transaction(persistReview) : persistReview();
};
