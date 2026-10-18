import type { Project } from "../../types/project";
import {
  buildStyleLockChangeOrderFromCandidate,
  buildStyleReferenceAnalysis,
  buildVisualStyleLockCandidateFromAnalysis,
} from "../production/styleReference";
import { createOperatorArtifact, isOperatorArtifactApproved } from "./artifacts";
import { commitOperatorArtifactToProject } from "./commit";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import type { OperatorArtifactEnvelope } from "./types";
import {
  appendAutoQAToArtifact,
  getOrCreateOperatorRun,
  OperatorUseCaseError,
  requireAccessibleProject,
  type OperatorRunArtifactStore,
} from "./useCaseShared";

export interface OperatorStyleReferenceStore extends OperatorRunArtifactStore {
  getOperatorArtifactById(id: string): OperatorArtifactEnvelope | null;
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
  saveProject(project: Project): Project;
  markOperatorArtifactCommitted(
    id: string,
    commitResult: NonNullable<OperatorArtifactEnvelope["commitResult"]>,
  ): OperatorArtifactEnvelope | null;
}

export const createStyleReferenceAnalysisForProject = (
  store: OperatorStyleReferenceStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
    handbookVersion,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const run = getOrCreateOperatorRun(store, {
    projectId,
    input,
    handbookVersion,
    mode: "asset_generation",
    defaultUserRequest: "Register style-only reference sources and derive a visual-style candidate from supplied notes or structured traits.",
  });

  const sourceImageRefs = [
    ...(Array.isArray(input?.sourceImageRefs) ? input.sourceImageRefs : []),
    ...(Array.isArray(input?.references) ? input.references : []),
  ];
  const styleReferenceAnalysis = buildStyleReferenceAnalysis(project, {
    sourceImageRefs,
    extractedTraits: input?.extractedTraits,
    analysisText: input?.analysisText || input?.styleNotes,
    notes: input?.notes,
    confidence: input?.confidence,
  });
  const analysisArtifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "style_reference_analysis",
    targetPath: `operator.styleReferences.${styleReferenceAnalysis.id}`,
    entityIds: [
      projectId,
      ...styleReferenceAnalysis.sourceImageRefs.map((ref) => ref.operatorAssetId || ref.id).filter(Boolean),
    ],
    data: { styleReferenceAnalysis },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Style reference analysis created.",
    targetPath: analysisArtifact.targetPath,
    entityIds: analysisArtifact.entityIds,
    data: {
      artifactId: analysisArtifact.id,
      analysisId: styleReferenceAnalysis.id,
      sourceCount: styleReferenceAnalysis.sourceImageRefs.length,
      confidence: styleReferenceAnalysis.confidence,
    },
  });

  const finalAnalysisArtifact = appendAutoQAToArtifact(store, analysisArtifact, {
    enabled: input?.autoQa !== false,
    messagePrefix: "Style reference analysis",
  });

  let visualStyleLockCandidate: ReturnType<typeof buildVisualStyleLockCandidateFromAnalysis> | undefined;
  let candidateArtifact: OperatorArtifactEnvelope | undefined;
  if (input?.createCandidate !== false && finalAnalysisArtifact.status !== "qa_failed") {
    visualStyleLockCandidate = buildVisualStyleLockCandidateFromAnalysis(styleReferenceAnalysis, project.visualStyleLock || {});
    const draftCandidateArtifact = store.saveOperatorArtifact(createOperatorArtifact({
      runId: run.id,
      kind: "visual_style_lock_candidate",
      targetPath: `operator.visualStyleLockCandidates.${visualStyleLockCandidate.id}`,
      entityIds: [projectId, ...visualStyleLockCandidate.sourceAnalysisIds],
      data: { visualStyleLockCandidate },
    }, run));
    store.appendOperatorRunEvent(run.id, {
      type: "artifact_generated",
      message: "Visual style lock candidate created from approved style reference analysis.",
      targetPath: draftCandidateArtifact.targetPath,
      entityIds: draftCandidateArtifact.entityIds,
      data: {
        artifactId: draftCandidateArtifact.id,
        candidateId: visualStyleLockCandidate.id,
        diffCount: visualStyleLockCandidate.diffFromCurrentLock.length,
      },
    });
    candidateArtifact = appendAutoQAToArtifact(store, draftCandidateArtifact, {
      enabled: input?.autoQa !== false,
      messagePrefix: "Visual style lock candidate",
    });
  }

  return {
    run,
    analysisArtifact: finalAnalysisArtifact,
    candidateArtifact,
    styleReferenceAnalysis,
    visualStyleLockCandidate,
  };
};

export const createStyleLockChangeOrderForProject = (
  store: OperatorStyleReferenceStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
    handbookVersion,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const candidateArtifactId = String(input?.candidateArtifactId || "").trim();
  const candidateArtifact = candidateArtifactId ? store.getOperatorArtifactById(candidateArtifactId) : null;
  if (candidateArtifactId && !candidateArtifact) {
    throw new OperatorUseCaseError(404, "visual_style_lock_candidate_not_found", "Visual style lock candidate artifact not found");
  }
  if (candidateArtifact && (candidateArtifact.projectId !== projectId || candidateArtifact.kind !== "visual_style_lock_candidate")) {
    throw new OperatorUseCaseError(409, "visual_style_lock_candidate_project_mismatch", "Artifact is not a visual style lock candidate for this project");
  }
  const visualStyleLockCandidate = input?.visualStyleLockCandidate ||
    (candidateArtifact?.data as any)?.visualStyleLockCandidate ||
    (candidateArtifact?.data as any)?.candidate;
  if (!visualStyleLockCandidate) {
    throw new OperatorUseCaseError(400, "visual_style_lock_candidate_required", "Missing visualStyleLockCandidate or candidateArtifactId");
  }

  const run = getOrCreateOperatorRun(store, {
    projectId,
    input,
    handbookVersion,
    mode: "repair",
    defaultUserRequest: `Create style lock change order from candidate ${visualStyleLockCandidate.id || candidateArtifactId}.`,
  });

  const styleLockChangeOrder = buildStyleLockChangeOrderFromCandidate(visualStyleLockCandidate, {
    approvalState: input?.approvalState || (input?.approve === true ? "approved" : "pending_review"),
    approvedBy: input?.approvedBy,
    affectedArtifactKinds: input?.affectedArtifactKinds,
    requiredReruns: input?.requiredReruns,
    rollbackPlan: input?.rollbackPlan,
  });
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "style_lock_change_order",
    targetPath: `operator.styleLockChangeOrders.${styleLockChangeOrder.id}`,
    entityIds: [projectId, styleLockChangeOrder.sourceCandidateId].filter(Boolean),
    data: { styleLockChangeOrder },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Style lock change order created.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: {
      artifactId: artifact.id,
      changeOrderId: styleLockChangeOrder.id,
      approvalState: styleLockChangeOrder.approvalState,
      requiredReruns: styleLockChangeOrder.requiredReruns,
    },
  });

  const finalArtifact = appendAutoQAToArtifact(store, artifact, {
    enabled: input?.autoQa !== false,
    messagePrefix: "Style lock change order",
  });

  if (input?.commit === true) {
    if (!isOperatorArtifactApproved(finalArtifact)) {
      throw new OperatorUseCaseError(
        422,
        "style_lock_change_order_not_approved",
        "style_lock_change_order must pass non-blocking QA before commit",
        { run, artifact: finalArtifact, styleLockChangeOrder },
      );
    }
    const result = commitOperatorArtifactToProject(project, finalArtifact);
    const savedProject = store.saveProject(result.project);
    const committed = store.markOperatorArtifactCommitted(finalArtifact.id, {
      committedAt: Date.now(),
      changedPaths: result.changedPaths,
      summary: result.summary,
    });
    store.appendOperatorRunEvent(run.id, {
      type: "db_write",
      message: result.summary,
      targetPath: finalArtifact.targetPath,
      entityIds: finalArtifact.entityIds,
      data: { artifactId: finalArtifact.id, changedPaths: result.changedPaths },
    });
    return {
      run,
      artifact: committed,
      styleLockChangeOrder,
      project: savedProject,
      commitResult: result,
    };
  }

  return {
    run,
    artifact: finalArtifact,
    styleLockChangeOrder,
  };
};
