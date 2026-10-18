import type {
  VisualImplementationMedium,
  VisualProductionMode,
} from "../../clients/domainTypes";
import { createNeutralVisualImplementation } from "../../clients/productionVisualStyleClient";

export type ProjectVisualSeedDrafts = Partial<Record<VisualProductionMode, VisualImplementationMedium>>;

export const rememberProjectVisualSeedDraft = (
  drafts: ProjectVisualSeedDrafts,
  implementation: VisualImplementationMedium,
): ProjectVisualSeedDrafts => ({
  ...drafts,
  [implementation.productionMode]: structuredClone(implementation),
});

export const resolveProjectVisualSeedDraft = (
  drafts: ProjectVisualSeedDrafts,
  productionMode: VisualProductionMode,
): VisualImplementationMedium => structuredClone(
  drafts[productionMode] || createNeutralVisualImplementation(productionMode),
);
