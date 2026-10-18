import type { Project } from "../../types/project";
import { buildOperatorProjectContext } from "./context";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import type { OperatorRun } from "./types";
import { buildAssetContinuityContext } from "../production/assetContinuity";
import { buildLongFormMemoryContext } from "../production/longFormMemory";
import { OperatorUseCaseError, normalizeStringArray, requireAccessibleProject } from "./useCaseShared";

export interface OperatorProjectContextStore {
  getProjectById(id: string): Project | null;
  listProductionRuns(projectId?: string): any[];
  listOperatorRuns(projectId?: string): OperatorRun[];
}

export const readOperatorProjectContextForAccess = (
  store: OperatorProjectContextStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    handbookVersion,
  }: {
    projectId: string;
    handbookVersion: string;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  return buildOperatorProjectContext({
    project,
    productionRuns: store.listProductionRuns(projectId),
    operatorRuns: store.listOperatorRuns(projectId),
    handbookVersion,
  });
};

export const readLongFormMemoryForAccess = (
  store: Pick<OperatorProjectContextStore, "getProjectById">,
  access: OperatorArtifactAccess,
  {
    projectId,
    episodeIds,
    profile,
    windowSize,
  }: {
    projectId: string;
    episodeIds?: unknown;
    profile?: unknown;
    windowSize?: unknown;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const normalizedWindowSize = typeof windowSize === "string" || typeof windowSize === "number"
    ? Number(windowSize)
    : undefined;
  if (normalizedWindowSize !== undefined && !Number.isFinite(normalizedWindowSize)) {
    throw new OperatorUseCaseError(400, "operator_memory_window_invalid", "windowSize must be a number");
  }
  return buildLongFormMemoryContext(project, {
    episodeIds: normalizeStringArray(episodeIds),
    profile: typeof profile === "string" ? profile : "operator",
    windowSize: normalizedWindowSize,
  });
};

export const readAssetContinuityForAccess = (
  store: Pick<OperatorProjectContextStore, "getProjectById">,
  access: OperatorArtifactAccess,
  {
    projectId,
    profile,
  }: {
    projectId: string;
    profile?: unknown;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  return buildAssetContinuityContext(project, {
    profile: typeof profile === "string" ? profile : "operator",
  });
};
