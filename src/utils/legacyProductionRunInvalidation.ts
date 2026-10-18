import {
  applyLegacyProductionRunInvalidation,
  type LegacyProductionRunChange,
} from "../services/production/legacyProductionRunInvalidation";
import {
  createHttpProductionRunRepository,
  createLocalProductionRunRepository,
} from "../services/production/persistence";

export const markPersistedLegacyProductionRunsStale = async (
  projectId: string,
  change: LegacyProductionRunChange,
) => {
  if (typeof localStorage === "undefined") return 0;
  const localRepository = createLocalProductionRunRepository(localStorage);
  const currentRuns = localRepository.listRuns();
  const result = applyLegacyProductionRunInvalidation(currentRuns, projectId, change);
  if (!result.changedRunIds.length) return 0;

  localRepository.saveRuns(result.runs);
  if (typeof fetch === "function") {
    const changedIds = new Set(result.changedRunIds);
    const serverRepository = createHttpProductionRunRepository();
    await Promise.all(
      result.runs
        .filter((run) => changedIds.has(run.id))
        .map((run) => serverRepository.upsertRun(run)),
    ).catch((error) => {
      console.error("Failed to sync invalidated historical production runs:", error);
    });
  }
  return result.changedRunIds.length;
};
