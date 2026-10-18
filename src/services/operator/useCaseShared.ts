import type { Project } from "../../types/project";
import type { OperatorArtifactEnvelope, OperatorRun, OperatorRunMode } from "./types";
import { createOperatorRunRecord } from "./runs";
import { runOperatorArtifactQA } from "./qa";
import type { OperatorArtifactAccess } from "./artifactUseCases";

export class OperatorUseCaseError extends Error {
  statusCode: number;
  code: string;
  payload?: unknown;

  constructor(statusCode: number, code: string, message: string, payload?: unknown) {
    super(message);
    this.name = "OperatorUseCaseError";
    this.statusCode = statusCode;
    this.code = code;
    this.payload = payload;
  }
}

export interface OperatorRunArtifactStore {
  getProjectById(id: string): Project | null;
  getOperatorRunById(id: string): OperatorRun | null;
  saveOperatorRun(run: OperatorRun): OperatorRun;
  appendOperatorRunEvent(id: string, event: any): OperatorRun | null;
  listOperatorArtifacts(filters?: { projectId?: string; runId?: string }): OperatorArtifactEnvelope[];
  appendOperatorArtifactQA(id: string, verdict: any): OperatorArtifactEnvelope | null;
}

export const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

export const requireAccessibleProject = (
  store: Pick<OperatorRunArtifactStore, "getProjectById">,
  access: OperatorArtifactAccess,
  projectId: string,
) => {
  access.assertProjectAccess(projectId);
  const project = store.getProjectById(projectId);
  if (!project) {
    throw new OperatorUseCaseError(404, "project_not_found", "Project not found");
  }
  return project;
};

export const getOrCreateOperatorRun = (
  store: Pick<OperatorRunArtifactStore, "getOperatorRunById" | "saveOperatorRun">,
  {
    projectId,
    input,
    handbookVersion,
    mode,
    defaultUserRequest,
  }: {
    projectId: string;
    input: any;
    handbookVersion: string;
    mode: OperatorRunMode;
    defaultUserRequest: string;
  },
) => {
  const requestedRunId = String(input?.runId || "").trim();
  const existingRun = requestedRunId ? store.getOperatorRunById(requestedRunId) : null;
  if (requestedRunId && !existingRun) {
    throw new OperatorUseCaseError(404, "operator_run_not_found", "Operator run not found");
  }
  if (existingRun && existingRun.projectId !== projectId) {
    throw new OperatorUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
  }
  if (existingRun) return existingRun;

  return store.saveOperatorRun(createOperatorRunRecord({
    projectId,
    provider: input?.provider || "other",
    mode,
    userRequest: input?.userRequest || defaultUserRequest,
    scope: {
      projectId,
      episodeIds: input?.episodeIds,
      sceneIds: input?.sceneIds || input?.sampleSceneIds,
      shotIds: input?.shotIds,
      assetIds: input?.assetIds,
    },
  }, handbookVersion));
};

export const appendAutoQAToArtifact = (
  store: Pick<OperatorRunArtifactStore, "listOperatorArtifacts" | "appendOperatorArtifactQA" | "appendOperatorRunEvent">,
  artifact: OperatorArtifactEnvelope,
  {
    runId = artifact.runId,
    enabled = true,
    emitRunEvent = true,
    messagePrefix,
  }: {
    runId?: string;
    enabled?: boolean;
    emitRunEvent?: boolean;
    messagePrefix: string;
  },
) => {
  if (!enabled) return artifact;
  const verdict = runOperatorArtifactQA({
    artifact,
    relatedArtifacts: store.listOperatorArtifacts({ projectId: artifact.projectId, runId: artifact.runId }),
  });
  if (!verdict) return artifact;
  const finalArtifact = store.appendOperatorArtifactQA(artifact.id, verdict) || artifact;
  if (emitRunEvent) {
    store.appendOperatorRunEvent(runId, {
      type: finalArtifact.status === "qa_failed" ? "qa_failed" : "qa_passed",
      message: `${messagePrefix} QA ${finalArtifact.status}.`,
      targetPath: finalArtifact.targetPath,
      entityIds: finalArtifact.entityIds,
      data: { artifactId: finalArtifact.id, qaAgentId: verdict.qaAgentId },
    });
  }
  return finalArtifact;
};

export const resolveEpisodesForRequest = (project: Project, body: any) => {
  const allEpisodes = Array.isArray((project as any)?.episodes) ? (project as any).episodes : [];
  const episodeIds = normalizeStringArray(body?.episodeIds || body?.scope?.episodeIds);
  if (episodeIds.length === 0) {
    return { episodes: allEpisodes, episodeIds: allEpisodes.map((episode: any) => episode.id).filter(Boolean) };
  }
  const wanted = new Set(episodeIds);
  const episodes = allEpisodes.filter((episode: any) => wanted.has(String(episode.id)));
  const found = new Set(episodes.map((episode: any) => String(episode.id)));
  const missingEpisodeIds = episodeIds.filter((id) => !found.has(id));
  if (missingEpisodeIds.length > 0) {
    throw new OperatorUseCaseError(404, "operator_episode_not_found", `Episode not found for operator QA: ${missingEpisodeIds.join(", ")}`);
  }
  return { episodes, episodeIds };
};
