import { productionClient } from "../../clients/productionClient";
import { ProductionRun } from "../../types/production";

export const PRODUCTION_RUN_STORAGE_KEY = "omni-production-runs-v1";

export interface ProductionRunRepository {
  listRuns: () => ProductionRun[];
  saveRuns: (runs: ProductionRun[]) => void;
}

export interface ProductionRunServerRepository {
  listRuns: (projectId?: string) => Promise<ProductionRun[]>;
  getRun: (runId: string) => Promise<ProductionRun | null>;
  upsertRun: (run: ProductionRun) => Promise<ProductionRun>;
  deleteRun: (runId: string) => Promise<void>;
}

export const createLocalProductionRunRepository = (
  storage: Storage,
  storageKey = PRODUCTION_RUN_STORAGE_KEY,
): ProductionRunRepository => ({
  listRuns: () => {
    const raw = storage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  },
  saveRuns: (runs) => {
    storage.setItem(storageKey, JSON.stringify(runs));
  },
});

export const createHttpProductionRunRepository = (): ProductionRunServerRepository => ({
  listRuns: (projectId) => productionClient.listRuns(projectId),
  getRun: (runId) => productionClient.getRun(runId),
  upsertRun: async (run) => {
    const revision = Number(run.revision || 0);
    const baseRevision = Math.max(0, revision - 1);
    return productionClient.upsertRun(run, baseRevision);
  },
  deleteRun: (runId) => productionClient.deleteRun(runId),
});
