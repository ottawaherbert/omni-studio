import type { Project } from "../../types/project";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import { runOperatorQA, type OperatorQACheck } from "./qa";
import type { OperatorRun } from "./types";
import { OperatorUseCaseError, resolveEpisodesForRequest } from "./useCaseShared";

export interface OperatorQAStore {
  getProjectById(id: string): Project | null;
  getOperatorRunById(id: string): OperatorRun | null;
  appendOperatorRunEvent(id: string, event: any): OperatorRun | null;
  patchOperatorRun(id: string, updates: any): OperatorRun | null;
}

const operatorQAChecks: OperatorQACheck[] = [
  "schema",
  "asset-refs",
  "script",
  "storyboard",
  "visual-prompts",
  "full",
];

const resolveOperatorQACheck = (value: unknown): OperatorQACheck => {
  const check = String(value || "full").trim();
  if (!operatorQAChecks.includes(check as OperatorQACheck)) {
    throw new OperatorUseCaseError(400, "operator_qa_check_unsupported", `Unsupported operator QA check: ${check}`);
  }
  return check as OperatorQACheck;
};

const summarizeOperatorQAVerdict = (verdict: ReturnType<typeof runOperatorQA>) => ({
  passed: verdict.status === "passed" ? 1 : 0,
  warnings: verdict.issues.filter((issue) => issue.severity === "warning").length,
  failed: verdict.status === "failed" ? 1 : 0,
  blocked: verdict.blocking ? 1 : 0,
});

export const runOperatorQAForAccess = (
  store: OperatorQAStore,
  access: OperatorArtifactAccess,
  {
    projectIdFromParams,
    input,
    checkFromParams,
  }: {
    projectIdFromParams?: string;
    input: any;
    checkFromParams?: unknown;
  },
) => {
  const projectId = String(projectIdFromParams || input?.projectId || input?.scope?.projectId || "").trim();
  if (!projectId) {
    throw new OperatorUseCaseError(400, "project_id_required", "Missing projectId");
  }
  access.assertProjectAccess(projectId);
  const check = resolveOperatorQACheck(checkFromParams || input?.check);
  const project = store.getProjectById(projectId);
  if (!project) {
    throw new OperatorUseCaseError(404, "project_not_found", "Project not found");
  }
  const { episodes, episodeIds } = resolveEpisodesForRequest(project, input || {});
  const runId = input?.runId ? String(input.runId) : "";
  if (runId) {
    const run = store.getOperatorRunById(runId);
    if (!run) {
      throw new OperatorUseCaseError(404, "operator_run_not_found", "Operator run not found");
    }
    if (run.projectId !== projectId) {
      throw new OperatorUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
    }
    access.assertProjectAccess(run.projectId);
    store.appendOperatorRunEvent(runId, {
      type: "qa_started",
      message: `Operator QA started: ${check}`,
      targetPath: `operator.qa.${check}`,
      entityIds: [projectId, ...episodeIds],
      data: { check, episodeIds },
    });
  }
  const verdict = runOperatorQA({ check, project, episodes });
  if (runId) {
    store.appendOperatorRunEvent(runId, {
      type: verdict.blocking || verdict.status === "failed" ? "qa_failed" : "qa_passed",
      message: `Operator QA ${verdict.status}: ${check}`,
      targetPath: `operator.qa.${check}`,
      entityIds: [projectId, ...episodeIds],
      data: { check, episodeIds, verdict },
    });
    store.patchOperatorRun(runId, { qaSummary: summarizeOperatorQAVerdict(verdict) });
  }
  return {
    projectId,
    check,
    episodeIds,
    verdict,
  };
};
