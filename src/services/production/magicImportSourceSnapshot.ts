import { sha256 } from "js-sha256";

import type {
  DeepReadonly,
  ProductionMagicImportSourcePayload,
  ProductionMagicImportSourceSnapshot,
} from "../../types/project";

export interface CreateMagicImportSourceSnapshotInput extends ProductionMagicImportSourcePayload {
  importId: string;
  importedAt?: number;
}

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const deepFreeze = <T,>(value: T): DeepReadonly<T> => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item));
  }
  return value as DeepReadonly<T>;
};

export const createMagicImportSourceSnapshot = (
  input: CreateMagicImportSourceSnapshotInput,
): ProductionMagicImportSourceSnapshot => {
  const payload = cloneJson<ProductionMagicImportSourcePayload>({
    sourceText: input.sourceText,
    sourceFormat: input.sourceFormat,
    targetFormat: input.targetFormat,
    aspectRatio: input.aspectRatio,
    adaptationTone: input.adaptationTone,
    sourceArtifact: input.sourceArtifact,
    sourceGovernance: input.sourceGovernance,
    sourceEnvelope: input.sourceEnvelope,
  });
  return deepFreeze({
    schemaVersion: "production-script-source-snapshot.v1",
    sourceType: "magic_import",
    importId: input.importId,
    importedAt: input.importedAt ?? Date.now(),
    sourceHash: sha256(JSON.stringify(payload)),
    payload,
  });
};
