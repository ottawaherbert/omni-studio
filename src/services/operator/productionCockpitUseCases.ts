import type { Project } from "../../types/project";
import type { ProductionCoordinationScope, ProductionStageType } from "../../types/production";
import { buildProductionCockpit } from "../production/productionCockpit";
import type { OperatorArtifactAccess } from "./artifactUseCases";
import type { OperatorArtifactEnvelope, OperatorRun } from "./types";
import {
  normalizeStringArray,
  OperatorUseCaseError,
  requireAccessibleProject,
  resolveEpisodesForRequest,
} from "./useCaseShared";

export interface OperatorProductionCockpitStore {
  getProjectById(id: string): Project | null;
  getOperatorRunById(id: string): OperatorRun | null;
  listProductionRuns(projectId?: string): any[];
  listOperatorArtifacts(filters?: { projectId?: string; runId?: string }): OperatorArtifactEnvelope[];
}

const resolveProductionCockpitScope = (value: unknown): ProductionCoordinationScope => {
  const scope = String(value || "stage_exit").trim();
  if (["stage_exit", "episode_wrap", "phase_wrap", "manual_audit"].includes(scope)) {
    return scope as ProductionCoordinationScope;
  }
  throw new OperatorUseCaseError(400, "production_cockpit_scope_invalid", `Unsupported production cockpit scope: ${scope}`);
};

export const resolveProductionCockpitEnvironment = (value: unknown): "test" | "production" | "development" => {
  const environment = String(value || process.env.NODE_ENV || "production").trim();
  if (["test", "production", "development"].includes(environment)) {
    return environment as "test" | "production" | "development";
  }
  throw new OperatorUseCaseError(400, "production_cockpit_environment_invalid", `Unsupported production cockpit environment: ${environment}`);
};

export const readProductionCockpitForAccess = (
  store: OperatorProductionCockpitStore,
  access: OperatorArtifactAccess,
  {
    projectId,
    input,
  }: {
    projectId: string;
    input: any;
  },
) => {
  const project = requireAccessibleProject(store, access, projectId);
  const requestedEpisodeIds = normalizeStringArray(input?.episodeIds);
  const { episodes } = resolveEpisodesForRequest(project, { episodeIds: requestedEpisodeIds });
  const operatorRunId = typeof input?.operatorRunId === "string" ? input.operatorRunId.trim() : "";
  if (operatorRunId) {
    const run = store.getOperatorRunById(operatorRunId);
    if (!run) {
      throw new OperatorUseCaseError(404, "operator_run_not_found", "Operator run not found");
    }
    if (run.projectId !== projectId) {
      throw new OperatorUseCaseError(409, "operator_run_project_mismatch", "Operator run does not belong to project");
    }
  }
  const productionRunId = typeof input?.productionRunId === "string" ? input.productionRunId.trim() : "";
  const productionRuns = store.listProductionRuns(projectId);
  if (productionRunId && !productionRuns.some((run: any) => run.id === productionRunId)) {
    throw new OperatorUseCaseError(404, "production_run_not_found", "Production run not found");
  }
  const operatorArtifacts = store.listOperatorArtifacts({
    projectId,
    runId: operatorRunId || undefined,
  });
  const stageType = typeof input?.stageType === "string" && input.stageType.trim()
    ? input.stageType.trim() as ProductionStageType
    : undefined;
  return buildProductionCockpit({
    project,
    episodes,
    operatorArtifacts,
    productionRuns,
    productionRunId: productionRunId || undefined,
    operatorRunId: operatorRunId || undefined,
    scope: resolveProductionCockpitScope(input?.scope),
    stageType,
    environment: resolveProductionCockpitEnvironment(input?.environment),
  });
};
