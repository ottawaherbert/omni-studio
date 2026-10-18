import type { Project } from "../../types/project";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import { createOperatorRunRecord } from "./runs";
import type { OperatorRun } from "./types";
import { OperatorUseCaseError } from "./useCaseShared";

export interface OperatorRunStore {
  getProjectById(id: string): Project | null;
  getOperatorRunById(id: string): OperatorRun | null;
  listOperatorRuns(projectId?: string): OperatorRun[];
  saveOperatorRun(run: OperatorRun): OperatorRun;
  patchOperatorRun(id: string, updates: any): OperatorRun | null;
  appendOperatorRunEvent(id: string, event: any): OperatorRun | null;
}

export const listOperatorRunsForAccess = (
  store: Pick<OperatorRunStore, "listOperatorRuns">,
  access: OperatorArtifactAccess,
  projectId?: string,
) => {
  const projectIds = access.resolveReadableProjectIds(projectId);
  return projectIds.flatMap((id) => store.listOperatorRuns(id));
};

export const readOperatorRunForAccess = (
  store: Pick<OperatorRunStore, "getOperatorRunById">,
  access: OperatorArtifactAccess,
  runId: string,
) => {
  const run = store.getOperatorRunById(runId);
  if (!run) {
    throw new OperatorUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }
  access.assertProjectAccess(run.projectId);
  return run;
};

export const createOperatorRunForAccess = (
  store: Pick<OperatorRunStore, "getProjectById" | "saveOperatorRun">,
  access: OperatorArtifactAccess,
  input: any,
  handbookVersion: string,
) => {
  const projectId = String(input?.projectId || input?.scope?.projectId || "").trim();
  if (!projectId) {
    throw new OperatorUseCaseError(400, "project_id_required", "Missing projectId");
  }
  access.assertProjectAccess(projectId);
  const project = store.getProjectById(projectId);
  if (!project) {
    throw new OperatorUseCaseError(404, "project_not_found", "Project not found");
  }
  return store.saveOperatorRun(createOperatorRunRecord(input, handbookVersion));
};

export const updateOperatorRunForAccess = (
  store: Pick<OperatorRunStore, "getOperatorRunById" | "patchOperatorRun">,
  access: OperatorArtifactAccess,
  runId: string,
  input: any,
) => {
  const existing = readOperatorRunForAccess(store, access, runId);
  const run = store.patchOperatorRun(existing.id, input || {});
  if (!run) {
    throw new OperatorUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }
  return run;
};

export const appendOperatorRunEventForAccess = (
  store: Pick<OperatorRunStore, "getOperatorRunById" | "appendOperatorRunEvent">,
  access: OperatorArtifactAccess,
  runId: string,
  input: any,
) => {
  const existing = readOperatorRunForAccess(store, access, runId);
  const run = store.appendOperatorRunEvent(existing.id, input || {});
  if (!run) {
    throw new OperatorUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }
  return run;
};
