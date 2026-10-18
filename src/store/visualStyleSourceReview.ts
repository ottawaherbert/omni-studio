import type { Project, VisualStyleLock, VisualStyleSourceReview } from "../types/project";

const visualCreativeVisionFields = [
  "visualStyle",
  "referenceWorks",
  "globalLook",
  "globalLookTags",
] as const;

const visualGenerationParameterFields = [
  "qualityPrompt",
  "negativePrompt",
  "globalAppendedPrompt",
] as const;

const comparable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, comparable(entry)]));
};

const changed = (previous: unknown, next: unknown) => (
  JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(next))
);

export const collectVisualStyleSourceChangedFields = ({
  existing,
  updates,
}: {
  existing: Pick<Project, "creativeVision" | "globalGenerationParams" | "originalStyleReference">;
  updates: Partial<Pick<Project, "creativeVision" | "globalGenerationParams" | "originalStyleReference">>;
}) => {
  const fields: string[] = [];
  const creativeVision = updates.creativeVision as Partial<NonNullable<Project["creativeVision"]>> | undefined;
  for (const field of visualCreativeVisionFields) {
    if (!creativeVision || !Object.prototype.hasOwnProperty.call(creativeVision, field)) continue;
    if (changed(existing.creativeVision?.[field], creativeVision[field])) fields.push(`creativeVision.${field}`);
  }

  const generationParams = updates.globalGenerationParams;
  for (const field of visualGenerationParameterFields) {
    if (!generationParams || !Object.prototype.hasOwnProperty.call(generationParams, field)) continue;
    if (changed(existing.globalGenerationParams?.[field], generationParams[field])) {
      fields.push(`globalGenerationParams.${field}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(updates, "originalStyleReference")
    && changed(existing.originalStyleReference, updates.originalStyleReference)) {
    fields.push("originalStyleReference");
  }
  return fields;
};

export const resolveVisualStyleSourceReviewForUpdate = ({
  existing,
  incoming,
  upstreamChangedFields,
  detectedAt,
}: {
  existing?: VisualStyleLock;
  incoming?: Partial<VisualStyleLock>;
  upstreamChangedFields: string[];
  detectedAt: number;
}): VisualStyleSourceReview | undefined => {
  if (incoming?.sourceReview) return structuredClone(incoming.sourceReview);
  if (!existing && !incoming) return undefined;

  const previousFields = existing?.sourceReview?.changedFields || [];
  const changedFields = Array.from(new Set([
    ...previousFields,
    ...upstreamChangedFields,
    ...(incoming && upstreamChangedFields.length === 0 ? ["visualStyleLock"] : []),
  ]));
  if (!incoming && changedFields.length === 0) return existing?.sourceReview;

  return {
    status: "review_recommended",
    changedFields,
    detectedAt,
    basedOnRevision: incoming?.revision ?? existing?.revision,
  };
};
