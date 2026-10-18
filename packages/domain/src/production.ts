import type { Episode } from "../../../src/types/project";
import type { ProductionRun } from "../../../src/types/production";

export type * from "../../../src/types/production";

export type ProductionRunDTO = ProductionRun;
export type ProductionEpisodeDTO = Episode;

export interface ProductionRunQuery {
  projectId?: string;
}

export interface ProductionOperatorArtifactQuery {
  projectId?: string;
  runId?: string;
}

export interface CreateProductionOperatorRunRequest {
  projectId: string;
  provider: string;
  mode: string;
  userRequest: string;
  scope?: {
    projectId?: string;
    episodeIds?: string[];
    sceneIds?: string[];
  };
}

export interface ProductionOperatorRunDTO {
  id: string;
  [key: string]: unknown;
}

export interface AppendProductionOperatorRunEventRequest {
  type: string;
  message: string;
  targetPath?: string;
  entityIds?: Array<string | undefined>;
  data?: unknown;
}

export interface UpdateProductionOperatorRunRequest {
  status?: string;
  qaSummary?: {
    passed: number;
    warnings: number;
    failed: number;
    blocked: number;
  };
}
