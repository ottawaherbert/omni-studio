import { sha256 } from "js-sha256";

import type {
  ConcreteVisualProductionMode,
  VisualAppearance,
  VisualImplementationMedium,
  VisualMediumAssignment,
  VisualProductionMode,
  VisualStyleLockV3,
  VisualStyleTreatment,
} from "../../../../domain/src/visualStyle";
import { isVisualEntityType, VISUAL_PRODUCTION_MODES } from "../../../../domain/src/visualStyle";
import type { VisualStyleLock } from "../../../../../src/types/project";
import { createNeutralVisualImplementation } from "./visualMediumProfiles";

export interface VisualStyleMigrationWarning {
  code: "AMBIGUOUS_LEGACY_RENDERING_MODE" | "MISSING_VISUAL_IMPLEMENTATION" | "SOURCE_REVIEW_REQUIRED" | "CONTENT_HASH_MISSING" | "CONTENT_HASH_MISMATCH" | "INCOMPLETE_V3_LOCK" | "MALFORMED_MEDIUM_ASSIGNMENTS" | "MALFORMED_MEDIUM_ASSIGNMENT";
  field: string;
  message: string;
}

export interface VisualStyleNormalizationResult {
  lock: VisualStyleLock;
  migrated: boolean;
  warnings: VisualStyleMigrationWarning[];
}

const treatmentSections: Array<keyof VisualStyleTreatment> = [
  "palette", "color", "surface", "linework", "lighting", "camera", "movement",
  "composition", "materials", "finish", "readability", "constraints", "directives",
];

const clean = (value: unknown) => String(value ?? "").trim();

const list = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : clean(value) ? [value] : [];
  return Array.from(new Set(values.map(clean).filter(Boolean)));
};

export const createEmptyVisualStyleTreatment = (): VisualStyleTreatment => ({
  palette: [],
  color: [],
  surface: [],
  linework: [],
  lighting: [],
  camera: [],
  movement: [],
  composition: [],
  materials: [],
  finish: [],
  readability: [],
  constraints: [],
  directives: [],
});

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonicalize(entry)]));
};

export const visualStyleContentHash = (lock: Pick<VisualStyleLock,
  "visualImplementation" | "treatment" | "mediumAssignments" | "stylePrompt"
>) => `sha256-${sha256(JSON.stringify(canonicalize({
  ...(lock.stylePrompt !== undefined ? { stylePrompt: lock.stylePrompt } : {}),
  visualImplementation: lock.visualImplementation,
  treatment: lock.treatment,
  mediumAssignments: lock.mediumAssignments || [],
})))}`;

export const createVisualStyleLockDraft = (input: {
  productionMode?: VisualProductionMode;
  detectedAt?: number;
  changedFields?: string[];
} = {}): VisualStyleLockV3 => {
  const draft: VisualStyleLockV3 = {
    schemaVersion: "visual-style-lock.v3",
    revision: 1,
    contentHash: "",
    ...(input.productionMode ? { visualImplementation: createNeutralVisualImplementation(input.productionMode) } : {}),
    treatment: createEmptyVisualStyleTreatment(),
    mediumAssignments: [],
    sourceReview: {
      status: "review_recommended",
      changedFields: input.changedFields || (input.productionMode ? [] : ["visualImplementation"]),
      detectedAt: input.detectedAt ?? 0,
      basedOnRevision: 1,
    },
  };
  draft.contentHash = visualStyleContentHash(draft);
  return draft;
};

const legacyProductionMode = (value: unknown): VisualProductionMode | undefined => {
  const normalized = clean(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["live_action", "liveaction", "实拍", "真人实拍"].includes(normalized)) return "live_action";
  if (["2d", "2d_animation", "anime", "comic", "二维动画", "二次元"].includes(normalized)) return "2d_animation";
  if (["3d", "3d_animation", "cg_animation", "三维动画"].includes(normalized)) return "3d_animation";
  if (["stop_motion", "stopmotion", "定格", "定格动画"].includes(normalized)) return "stop_motion";
  if (["mixed_media", "mixedmedia", "hybrid", "混合媒介", "混合媒体"].includes(normalized)) return "mixed_media";
  return undefined;
};

const isVisualProductionMode = (value: unknown): value is VisualProductionMode =>
  VISUAL_PRODUCTION_MODES.includes(value as VisualProductionMode);

const concreteModes = new Set<ConcreteVisualProductionMode>([
  "live_action",
  "2d_animation",
  "3d_animation",
  "stop_motion",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isStructurallySafeMediumAssignment = (value: unknown): value is VisualMediumAssignment => {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) return false;
  if (!["base", "embedded", "overlay", "effect"].includes(String(value.compositingRole))) return false;
  if (value.priority !== undefined && (typeof value.priority !== "number" || !Number.isFinite(value.priority))) return false;
  if (value.notes !== undefined && !isStringArray(value.notes)) return false;

  const target = value.target;
  if (!isRecord(target)) return false;
  if (target.scope === "entity") {
    if (!isVisualEntityType(target.entityType)) return false;
    if (typeof target.entityId !== "string" || !target.entityId.trim()) return false;
  } else if (target.scope === "layer") {
    if (typeof target.layerId !== "string" || !target.layerId.trim()) return false;
    if (typeof target.label !== "string" || typeof target.description !== "string") return false;
  } else if (target.scope !== "whole") {
    return false;
  }

  const implementation = value.implementation;
  if (!isRecord(implementation) || !concreteModes.has(implementation.productionMode as ConcreteVisualProductionMode)) return false;
  if (!isRecord(implementation.appearance) || !isStringArray(implementation.techniques)) return false;
  if (!isRecord(implementation.specification) || implementation.specification.kind !== implementation.productionMode) return false;
  return true;
};

const normalizeMediumAssignments = (
  value: unknown,
  warnings: VisualStyleMigrationWarning[],
): VisualMediumAssignment[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push({
      code: "MALFORMED_MEDIUM_ASSIGNMENTS",
      field: "mediumAssignments",
      message: "mediumAssignments must be an array. The malformed value was quarantined instead of being executed.",
    });
    return [];
  }
  const valid: VisualMediumAssignment[] = [];
  value.forEach((entry, index) => {
    const normalizedEntry = isRecord(entry) && isRecord(entry.target) && entry.target.scope === "layer"
      ? {
          ...entry,
          target: {
            ...entry.target,
            label: typeof entry.target.label === "string" ? entry.target.label : clean(entry.target.layerId),
            description: typeof entry.target.description === "string"
              ? entry.target.description
              : `视觉图层 ${clean(entry.target.label) || clean(entry.target.layerId)}`,
          },
        }
      : entry;
    if (!isStructurallySafeMediumAssignment(normalizedEntry)) {
      warnings.push({
        code: "MALFORMED_MEDIUM_ASSIGNMENT",
        field: `mediumAssignments.${index}`,
        message: `Mixed-media assignment ${index + 1} is structurally invalid and was quarantined instead of being executed.`,
      });
      return;
    }
    valid.push(structuredClone(normalizedEntry));
  });
  return valid;
};

const normalizeImplementation = (
  value: VisualImplementationMedium | undefined,
  fallbackMode?: VisualProductionMode,
): VisualImplementationMedium | undefined => {
  const mode = isVisualProductionMode(value?.productionMode) ? value.productionMode : fallbackMode;
  if (!mode) return undefined;
  const seed = createNeutralVisualImplementation(mode);
  const candidate = value as unknown as Record<string, unknown> | undefined;
  const candidateAppearance = candidate?.appearance as Partial<VisualAppearance> | undefined;
  const candidateSpecification = candidate?.specification as Record<string, unknown> | undefined;
  return {
    ...seed,
    appearance: {
      ...seed.appearance,
      ...(candidateAppearance || {}),
      descriptors: list(candidateAppearance?.descriptors || seed.appearance.descriptors),
    },
    techniques: Array.isArray(candidate?.techniques) ? list(candidate.techniques) : seed.techniques,
    specification: candidateSpecification?.kind === mode
      ? { ...seed.specification, ...candidateSpecification }
      : seed.specification,
  } as VisualImplementationMedium;
};

const legacyAppearance = (value: unknown): Partial<VisualAppearance> => {
  const normalized = clean(value).toLowerCase();
  if (/photoreal|照片级|写实/.test(normalized)) return { realism: "photoreal" };
  if (/anime|二次元|stylized|风格化/.test(normalized)) return { realism: "stylized" };
  if (/comic|漫画|graphic/.test(normalized)) return { realism: "graphic", finish: "graphic" };
  if (/abstract|抽象/.test(normalized)) return { realism: "abstract" };
  return {};
};

const legacyTreatment = (lock: VisualStyleLock): VisualStyleTreatment => ({
  palette: list([...(lock.colorPalette || []), ...(lock.allowedHex || [])]),
  color: list([...(lock.colorTemperature || []), lock.saturation, lock.contrast]),
  surface: list([...(lock.mediumSurface || []), ...(lock.texture || []), ...(lock.grain || []), lock.noiseFloor]),
  linework: list([...(lock.linework || []), lock.sketchDensity, lock.strokeWeight]),
  lighting: list([...(lock.lighting || []), ...(lock.lightSourceLogic || []), ...(lock.conditionalLighting || []), ...(lock.practicalLightRules || [])]),
  camera: list([lock.cameraLanguage, ...(lock.lensBias || []), ...(lock.framingBias || []), lock.depthOfField]),
  movement: list(lock.movementBias),
  composition: list([...(lock.compositionRules || []), ...(lock.negativeSpaceRules || []), ...(lock.foregroundRules || [])]),
  materials: list(lock.materialRendering),
  finish: list([lock.finalRenderIntent, lock.finishLevel]),
  readability: list(lock.readabilityRules),
  constraints: list([
    ...(lock.forbiddenColors || []).map((color) => `forbidden color: ${color}`),
    ...(lock.negativeStyleRules || []),
    ...(lock.noSourceCopyRules || []),
    ...(lock.driftGuards || []),
  ]),
  directives: list([lock.stylePrompt, ...(lock.styleKeywords || [])]),
});

const mergeTreatment = (
  legacy: VisualStyleTreatment,
  structured?: VisualStyleTreatment,
): VisualStyleTreatment => Object.fromEntries(treatmentSections.map((section) => [
  section,
  list([...(legacy[section] || []), ...(structured?.[section] || [])]),
])) as unknown as VisualStyleTreatment;

const normalizeTreatment = (structured?: VisualStyleTreatment): VisualStyleTreatment =>
  Object.fromEntries(treatmentSections.map((section) => [
    section,
    list(structured?.[section]),
  ])) as unknown as VisualStyleTreatment;

export const normalizeLegacyVisualStyleLock = (
  input: VisualStyleLock | undefined,
  options: { detectedAt?: number } = {},
): VisualStyleNormalizationResult => {
  const source = structuredClone(input || {});
  const legacyMigration = source.schemaVersion !== "visual-style-lock.v3";
  const warnings: VisualStyleMigrationWarning[] = [];
  const mediumAssignments = normalizeMediumAssignments(source.mediumAssignments as unknown, warnings);
  const mode = isVisualProductionMode(source.visualImplementation?.productionMode)
    ? source.visualImplementation.productionMode
    : legacyProductionMode(source.renderingMode);
  let visualImplementation = normalizeImplementation(source.visualImplementation, mode);

  if (legacyMigration && visualImplementation) {
    const appearance = legacyAppearance(source.renderingMode);
    visualImplementation.appearance = {
      ...visualImplementation.appearance,
      ...appearance,
      descriptors: list([
        ...(visualImplementation.appearance?.descriptors || []),
        ...(source.styleKeywords || []),
        source.stylePrompt,
      ]),
    };
  }

  if (!mode && clean(source.renderingMode)) {
    warnings.push({
      code: "AMBIGUOUS_LEGACY_RENDERING_MODE",
      field: "renderingMode",
      message: `Legacy renderingMode '${clean(source.renderingMode)}' was preserved but not guessed as a production medium.`,
    });
  }
  if (!visualImplementation) {
    warnings.push({
      code: "MISSING_VISUAL_IMPLEMENTATION",
      field: "visualImplementation",
      message: "No explicit visual production medium is available; author review is required.",
    });
  }
  if (!legacyMigration) {
    const incompleteFields = [
      !Number.isFinite(source.revision) || Number(source.revision) < 1 ? "revision" : "",
      !source.treatment ? "treatment" : "",
      !Array.isArray(source.mediumAssignments) ? "mediumAssignments" : "",
      !source.sourceReview ? "sourceReview" : "",
    ].filter(Boolean);
    for (const field of incompleteFields) warnings.push({
      code: "INCOMPLETE_V3_LOCK",
      field,
      message: `Visual style lock v3 is missing required field ${field}; normalization supplied a reviewable compatibility value.`,
    });
  }

  const changedFields = Array.from(new Set([
    ...(legacyMigration ? ["schemaVersion"] : []),
    ...warnings.map((warning) => warning.field),
  ]));
  const reviewRecommended = legacyMigration
    || source.sourceReview?.status === "review_recommended"
    || !source.sourceReview
    || warnings.length > 0;
  if (reviewRecommended) {
    warnings.push({
      code: "SOURCE_REVIEW_REQUIRED",
      field: "sourceReview",
      message: "The normalized style remains reviewable and was not automatically approved.",
    });
  }
  const lock: VisualStyleLock = {
    ...source,
    schemaVersion: "visual-style-lock.v3",
    revision: Math.max(1, Math.floor(Number(source.revision) || 1)),
    visualImplementation,
    treatment: legacyMigration
      ? mergeTreatment(legacyTreatment(source), source.treatment)
      : normalizeTreatment(source.treatment),
    mediumAssignments,
    sourceReview: {
      ...(source.sourceReview || {}),
      status: reviewRecommended ? "review_recommended" : source.sourceReview?.status || "current",
      changedFields: Array.from(new Set([
        ...(source.sourceReview?.changedFields || []),
        ...changedFields,
      ])),
      detectedAt: reviewRecommended
        ? options.detectedAt ?? source.lockedAt ?? source.sourceReview?.detectedAt ?? 0
        : source.sourceReview?.detectedAt ?? options.detectedAt ?? source.lockedAt ?? 0,
      basedOnRevision: source.sourceReview?.basedOnRevision ?? source.revision,
    },
  };
  const resolvedContentHash = visualStyleContentHash(lock);
  if (!legacyMigration && !source.contentHash) {
    warnings.push({
      code: "CONTENT_HASH_MISSING",
      field: "contentHash",
      message: "Visual style lock v3 is missing its canonical content hash.",
    });
    lock.sourceReview = {
      ...lock.sourceReview!,
      status: "review_recommended",
      changedFields: Array.from(new Set([...(lock.sourceReview?.changedFields || []), "contentHash"])),
      detectedAt: options.detectedAt ?? source.lockedAt ?? lock.sourceReview?.detectedAt ?? 0,
      basedOnRevision: source.revision,
    };
  } else if (!legacyMigration && source.contentHash !== resolvedContentHash) {
    warnings.push({
      code: "CONTENT_HASH_MISMATCH",
      field: "contentHash",
      message: "The declared visual style hash does not match its canonical structured content.",
    });
    lock.sourceReview = {
      ...lock.sourceReview!,
      status: "review_recommended",
      changedFields: Array.from(new Set([...(lock.sourceReview?.changedFields || []), "contentHash"])),
      detectedAt: options.detectedAt ?? source.lockedAt ?? lock.sourceReview?.detectedAt ?? 0,
      basedOnRevision: source.revision,
    };
  }
  lock.contentHash = resolvedContentHash;
  return {
    lock,
    migrated: legacyMigration || warnings.length > 0 || source.contentHash !== lock.contentHash,
    warnings,
  };
};
