import type { Project } from "../../types/project";
import {
  createOperatorArtifact,
} from "./artifacts";
import { commitOperatorArtifactToProject, type OperatorCommitResult } from "./commit";
import { runOperatorArtifactQA } from "./qa";
import type { OperatorArtifactEnvelope, OperatorRun } from "./types";

export class OperatorArtifactUseCaseError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OperatorArtifactUseCaseError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface OperatorArtifactAccess {
  assertProjectAccess(projectId?: string): void;
  resolveReadableProjectIds(requestedProjectId?: string): Array<string | undefined>;
}

export interface OperatorArtifactStore {
  getProjectById(id: string): Project | null;
  saveProject(project: Project): Project;
  getOperatorRunById(id: string): OperatorRun | null;
  appendOperatorRunEvent(id: string, event: any): OperatorRun | null;
  patchOperatorRun(id: string, updates: any): OperatorRun | null;
  listOperatorArtifacts(filters?: { projectId?: string; runId?: string }): OperatorArtifactEnvelope[];
  getOperatorArtifactById(id: string): OperatorArtifactEnvelope | null;
  saveOperatorArtifact(artifact: OperatorArtifactEnvelope): OperatorArtifactEnvelope;
  appendOperatorArtifactQA(id: string, verdict: any): OperatorArtifactEnvelope | null;
  markOperatorArtifactCommitted(
    id: string,
    commitResult: NonNullable<OperatorArtifactEnvelope["commitResult"]>,
  ): OperatorArtifactEnvelope | null;
}

export const listOperatorArtifactsForAccess = (
  store: OperatorArtifactStore,
  access: OperatorArtifactAccess,
  { projectId, runId }: { projectId?: string; runId?: string },
) => {
  const normalizedRunId = String(runId || "").trim();
  const normalizedProjectId = String(projectId || "").trim();
  if (normalizedRunId) {
    const run = store.getOperatorRunById(normalizedRunId);
    if (!run) {
      throw new OperatorArtifactUseCaseError(404, "operator_run_not_found", "Operator run not found");
    }
    access.assertProjectAccess(run.projectId);
    if (normalizedProjectId && normalizedProjectId !== run.projectId) {
      throw new OperatorArtifactUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
    }
    return store.listOperatorArtifacts({ projectId: run.projectId, runId: normalizedRunId });
  }

  const projectIds = access.resolveReadableProjectIds(normalizedProjectId);
  return projectIds.flatMap((id) => store.listOperatorArtifacts({ projectId: id }));
};

export const readOperatorArtifactForAccess = (
  store: OperatorArtifactStore,
  access: OperatorArtifactAccess,
  artifactId: string,
) => {
  const artifact = store.getOperatorArtifactById(artifactId);
  if (!artifact) {
    throw new OperatorArtifactUseCaseError(404, "operator_artifact_not_found", "Operator artifact not found");
  }
  access.assertProjectAccess(artifact.projectId);
  return artifact;
};

export const createOperatorDraftArtifactForAccess = (
  store: OperatorArtifactStore,
  access: OperatorArtifactAccess,
  input: any,
) => {
  const runId = String(input?.runId || "").trim();
  const run = store.getOperatorRunById(runId);
  if (!run) {
    throw new OperatorArtifactUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }
  access.assertProjectAccess(run.projectId);
  const project = store.getProjectById(run.projectId);
  if (!project) {
    throw new OperatorArtifactUseCaseError(404, "project_not_found", "Project not found");
  }

  const artifact = store.saveOperatorArtifact(createOperatorArtifact({
    ...(input || {}),
    status: "draft",
    qaVerdicts: [],
    commitResult: undefined,
  }, run));
  store.appendOperatorRunEvent(run.id, {
    type: "artifact_generated",
    message: `Operator draft artifact created: ${artifact.kind}`,
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: { artifactId: artifact.id, status: artifact.status },
  });
  return artifact;
};

export const runOperatorArtifactQAForAccess = (
  store: OperatorArtifactStore,
  access: OperatorArtifactAccess,
  artifactId: string,
  input: any,
) => {
  const existing = readOperatorArtifactForAccess(store, access, artifactId);
  const body = input || {};
  const shouldRunAutoQA = body.auto === true || body.mode === "auto" || !body.qaAgentId;
  const verdict = shouldRunAutoQA
    ? runOperatorArtifactQA({
        artifact: existing,
        relatedArtifacts: store.listOperatorArtifacts({
          projectId: existing.projectId,
          runId: existing.runId,
        }),
      })
    : body;
  if (!verdict) {
    throw new OperatorArtifactUseCaseError(
      400,
      "operator_artifact_auto_qa_unavailable",
      "Automatic artifact QA is not available for this artifact kind. Provide an explicit QA verdict or use a supported video storyboard artifact.",
    );
  }

  const artifact = store.appendOperatorArtifactQA(artifactId, verdict);
  if (!artifact) {
    throw new OperatorArtifactUseCaseError(404, "operator_artifact_not_found", "Operator artifact not found");
  }
  store.appendOperatorRunEvent(artifact.runId, {
    type: artifact.status === "qa_failed" ? "qa_failed" : "qa_passed",
    message: `Operator artifact QA ${artifact.status}: ${artifact.kind}`,
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: { artifactId: artifact.id, status: artifact.status, qaAgentId: verdict.qaAgentId },
  });
  return artifact;
};

export const commitOperatorArtifactForAccess = (
  store: OperatorArtifactStore,
  access: OperatorArtifactAccess,
  artifactId: string,
): {
  artifact: OperatorArtifactEnvelope;
  project: Project;
  commitResult: OperatorCommitResult;
} => {
  const artifact = readOperatorArtifactForAccess(store, access, artifactId);
  const project = store.getProjectById(artifact.projectId);
  if (!project) {
    throw new OperatorArtifactUseCaseError(404, "project_not_found", "Project not found");
  }
  const result = commitOperatorArtifactToProject(project, artifact);
  const savedProject = store.saveProject(result.project);
  const committed = store.markOperatorArtifactCommitted(artifact.id, {
    committedAt: Date.now(),
    changedPaths: result.changedPaths,
    summary: result.summary,
  });
  if (!committed) {
    throw new OperatorArtifactUseCaseError(404, "operator_artifact_not_found", "Operator artifact not found");
  }
  store.appendOperatorRunEvent(artifact.runId, {
    type: "db_write",
    message: result.summary,
    targetPath: artifact.targetPath,
    entityIds: artifact.entityIds,
    data: { artifactId: artifact.id, changedPaths: result.changedPaths },
  });
  const run = store.getOperatorRunById(artifact.runId);
  if (run) {
    store.patchOperatorRun(run.id, {
      outputs: [
        ...(run.outputs || []),
        {
          kind: artifact.kind,
          targetPath: artifact.targetPath,
          entityIds: artifact.entityIds,
          artifactId: artifact.id,
        },
      ],
    });
  }

  return { artifact: committed, project: savedProject, commitResult: result };
};
