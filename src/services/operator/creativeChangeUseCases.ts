import type { Project } from "../../types/project";
import {
  buildCreativeChangeRequest,
  getCreativeChangeFormalDeliveryBlockers,
} from "../production/creativeChange";
import { createOperatorArtifact } from "./artifacts";
import { runOperatorArtifactQA } from "./qa";
import { createOperatorRunRecord } from "./runs";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import type { OperatorArtifactEnvelope, OperatorRun } from "./types";

export class OperatorCreativeChangeUseCaseError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OperatorCreativeChangeUseCaseError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface OperatorCreativeChangeStore {
  getProjectById(id: string): Project | null;
  getOperatorRunById(id: string): OperatorRun | null;
  saveOperatorRun(run: OperatorRun): OperatorRun;
  appendOperatorRunEvent(id: string, event: any): OperatorRun | null;
  listOperatorArtifacts(filters?: { projectId?: string; runId?: string }): OperatorArtifactEnvelope[];
  getOperatorArtifactById(id: string): OperatorArtifactEnvelope | null;
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
  appendOperatorArtifactQA(id: string, verdict: any): OperatorArtifactEnvelope | null;
}

const getAccessibleProject = (
  store: OperatorCreativeChangeStore,
  access: OperatorArtifactAccess,
  projectId: string,
) => {
  access.assertProjectAccess(projectId);
  const project = store.getProjectById(projectId);
  if (!project) {
    throw new OperatorCreativeChangeUseCaseError(404, "project_not_found", "Project not found");
  }
  return project;
};

export const listCreativeChangesForProject = (
  store: OperatorCreativeChangeStore,
  access: OperatorArtifactAccess,
  projectId: string,
) => {
  getAccessibleProject(store, access, projectId);
  const artifacts = store.listOperatorArtifacts({ projectId })
    .filter((artifact) => artifact.kind === "creative_change_request");
  return {
    projectId,
    creativeChanges: artifacts.map((artifact) => ({
      artifactId: artifact.id,
      runId: artifact.runId,
      status: artifact.status,
      targetPath: artifact.targetPath,
      creativeChangeRequest: (artifact.data as any)?.creativeChangeRequest || artifact.data,
      qaVerdicts: artifact.qaVerdicts || [],
      updatedAt: artifact.updatedAt,
    })),
  };
};

export const createCreativeChangeForProject = (
  store: OperatorCreativeChangeStore,
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
  const project = getAccessibleProject(store, access, projectId);
  const requestedRunId = String(input?.runId || "").trim();
  let run = requestedRunId ? store.getOperatorRunById(requestedRunId) : null;
  if (requestedRunId && !run) {
    throw new OperatorCreativeChangeUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }
  if (run && run.projectId !== projectId) {
    throw new OperatorCreativeChangeUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
  }
  if (!run) {
    run = store.saveOperatorRun(createOperatorRunRecord({
      projectId,
      provider: input?.provider || "other",
      mode: "repair",
      userRequest: input?.userRequest || `Create creative change request: ${input?.title || "late-stage inspiration"}`,
      scope: {
        projectId,
        episodeIds: input?.episodeIds,
        sceneIds: input?.sceneIds,
        shotIds: input?.shotIds,
        assetIds: input?.assetIds,
      },
    }, handbookVersion));
  }

  const creativeChangeRequest = buildCreativeChangeRequest(project, {
    ...(input || {}),
    runId: run.id,
    source: {
      ...(input?.source || {}),
      operatorRunId: run.id,
    },
  });
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    runId: run.id,
    kind: "creative_change_request",
    targetPath: `operator.creativeChangeRequests.${creativeChangeRequest.id}`,
    entityIds: [
      projectId,
      ...creativeChangeRequest.impact.episodeIds,
      ...creativeChangeRequest.impact.sceneIds,
      ...creativeChangeRequest.impact.shotIds,
      ...creativeChangeRequest.impact.assetIds,
    ],
    data: { creativeChangeRequest },
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: "Creative change request created with local resync plan.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: {
      artifactId: artifact.id,
      creativeChangeRequestId: creativeChangeRequest.id,
      pendingAssetCount: creativeChangeRequest.pendingAssets.length,
      variantRequestCount: creativeChangeRequest.variantRequests.length,
    },
  });

  let finalArtifact = artifact;
  if (input?.autoQa !== false) {
    const verdict = runOperatorArtifactQA({
      artifact,
      relatedArtifacts: store.listOperatorArtifacts({ projectId: artifact.projectId, runId: artifact.runId }),
    });
    if (verdict) {
      finalArtifact = store.appendOperatorArtifactQA(artifact.id, verdict) || artifact;
      store.appendOperatorRunEvent(run.id, {
        type: finalArtifact.status === "qa_failed" ? "qa_failed" : "qa_passed",
        message: `Creative change request QA ${finalArtifact.status}.`,
        targetPath: finalArtifact.targetPath,
        entityIds: finalArtifact.entityIds,
        data: { artifactId: finalArtifact.id, qaAgentId: verdict.qaAgentId },
      });
    }
  }

  return {
    run,
    artifact: finalArtifact,
    creativeChangeRequest,
  };
};

export const updateCreativeChangeForProject = (
  store: OperatorCreativeChangeStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    artifactId,
    input,
  }: {
    projectId: string;
    artifactId: string;
    input: any;
  },
) => {
  access.assertProjectAccess(projectId);
  const existing = store.getOperatorArtifactById(artifactId);
  if (!existing) {
    throw new OperatorCreativeChangeUseCaseError(404, "creative_change_artifact_not_found", "Creative change artifact not found");
  }
  if (existing.projectId !== projectId || existing.kind !== "creative_change_request") {
    throw new OperatorCreativeChangeUseCaseError(409, "creative_change_project_mismatch", "Artifact is not a creative change request for this project");
  }
  const run = store.getOperatorRunById(existing.runId);
  if (!run) {
    throw new OperatorCreativeChangeUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }

  const current = (existing.data as any)?.creativeChangeRequest || {};
  const incoming = input?.creativeChangeRequest || input || {};
  const creativeChangeRequest = {
    ...current,
    ...incoming,
    pendingAssets: incoming.pendingAssets || current.pendingAssets || [],
    variantRequests: incoming.variantRequests || current.variantRequests || [],
    localResyncPlan: incoming.localResyncPlan || current.localResyncPlan,
    updatedAt: Date.now(),
  };
  creativeChangeRequest.formalDeliveryBlockers = getCreativeChangeFormalDeliveryBlockers(creativeChangeRequest);
  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    ...existing,
    data: { creativeChangeRequest },
    status: "draft",
    qaVerdicts: input?.preserveQa === true ? existing.qaVerdicts : [],
    updatedAt: Date.now(),
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "repair_applied",
    message: "Creative change request updated.",
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: {
      artifactId: artifact.id,
      creativeChangeRequestId: creativeChangeRequest.id,
      formalDeliveryBlockers: creativeChangeRequest.formalDeliveryBlockers,
    },
  });
  return { artifact, creativeChangeRequest };
};
