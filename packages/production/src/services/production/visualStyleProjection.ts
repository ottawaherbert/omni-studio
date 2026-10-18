import type {
  VisualArtifactIntent,
  VisualArtifactPresentation,
  VisualCompileManifest,
  VisualProjectedCompositingEnvelope,
  VisualProjectedImplementation,
  VisualProjectedMediumAssignment,
  VisualProjectionFieldOrigin,
  VisualProjectionIssue,
  VisualProjectionTarget,
  VisualStyleProjection,
} from "../../../../domain/src/visualArtifact";
import type {
  VisualImplementationMedium,
  VisualMediumAssignment,
  VisualModeSpecification,
  VisualStyleTreatment,
} from "../../../../domain/src/visualStyle";
import type {
  VisualImplementationOverride,
  VisualLocalOverride,
  VisualOverrideValue,
} from "../../../../domain/src/visualOverride";
import type { VisualStyleLock } from "../../../../../src/types/project";
import { createNeutralVisualImplementation, getVisualMediumProfile } from "./visualMediumProfiles";
import { normalizeLegacyVisualStyleLock } from "./visualStyleMigration";
import { getVisualTaskRecipeForIntent } from "./visualTaskRecipes";

export interface VisualStyleProjectionInput {
  styleLock?: VisualStyleLock;
  intent: VisualArtifactIntent;
  presentation?: VisualArtifactPresentation;
  target?: VisualProjectionTarget;
  targets?: VisualProjectionTarget[];
  assetOverride?: VisualLocalOverride;
  shotOverride?: VisualLocalOverride;
  requestOverride?: VisualLocalOverride;
}

const clone = <T>(value: T): T => structuredClone(value);

export const applyVisualOverrideValue = <T>(
  inherited: T | undefined,
  override?: VisualOverrideValue<T>,
): { value: T | undefined; suppressed: boolean } => {
  if (!override || override.mode === "inherit") return { value: inherited === undefined ? undefined : clone(inherited), suppressed: false };
  if (override.mode === "suppress") return { value: undefined, suppressed: true };
  return { value: clone(override.value), suppressed: false };
};

const assignmentMatches = (
  assignment: VisualMediumAssignment,
  targets: VisualProjectionTarget[],
) => {
  const assignmentTarget = assignment.target;
  if (assignmentTarget.scope === "whole") return true;
  if (assignmentTarget.scope === "layer") {
    return targets.some((target) => Boolean(target.layerId && target.layerId === assignmentTarget.layerId));
  }
  return targets.some((target) => Boolean(
    target.entityId
      && target.entityId === assignmentTarget.entityId
      && (!target.entityType || target.entityType === assignmentTarget.entityType),
  ));
};

const assignmentSpecificity = (assignment: VisualMediumAssignment) =>
  assignment.target.scope === "whole" ? 0 : assignment.target.scope === "entity" ? 1 : 2;

const assignmentTargetKey = (assignment: VisualMediumAssignment) => {
  if (assignment.target.scope === "whole") return "whole";
  if (assignment.target.scope === "layer") return `layer:${assignment.target.layerId}`;
  return `entity:${assignment.target.entityType}:${assignment.target.entityId}`;
};

const orderedAssignments = (assignments: VisualMediumAssignment[]) => assignments
  .map((assignment, index) => ({ assignment, index }))
  .sort((left, right) => assignmentSpecificity(left.assignment) - assignmentSpecificity(right.assignment)
    || Number(left.assignment.priority || 0) - Number(right.assignment.priority || 0)
    || left.index - right.index)
  .map(({ assignment }) => assignment);

const specificationFields: Record<"identity" | "control", Partial<Record<VisualImplementationMedium["productionMode"], string[]>>> = {
  identity: {
    live_action: ["productionDesign", "performanceFidelity"],
    "2d_animation": ["lineSystem", "colorApplication", "depthStrategy", "performanceAndCleanup"],
    "3d_animation": ["modelingLanguage", "shadingModel", "riggingSystem"],
    stop_motion: ["fabrication", "setConstructionAndScale", "puppetConstruction", "armatureBehavior"],
    mixed_media: ["compositingModel", "integrationRules"],
  },
  control: {
    live_action: ["lensBehavior", "cameraSupport", "practicalLighting", "effectsBoundary"],
    "2d_animation": ["lineSystem", "depthStrategy", "layoutAndBackground", "performanceAndCleanup", "motionCadence", "effectsAnimation", "compositing"],
    "3d_animation": ["riggingSystem", "animationSystem", "simulationPolicy"],
    stop_motion: ["replacementAnimation", "frameCadence", "captureAndMotionControl", "rigRemovalAndCompositing"],
    mixed_media: ["transitionRules", "contactAndShadowRules"],
  },
};

const projectImplementation = (
  implementation: VisualImplementationMedium | undefined,
  appearancePolicy: "identity" | "control" | "full",
  specificationPolicy: "identity" | "control" | "full",
  suppressedFields: string[],
): VisualProjectedImplementation | undefined => {
  if (!implementation) return undefined;
  const isSuppressed = (field: string) => suppressedFields.includes(`visualImplementation.${field}`);
  if (appearancePolicy === "full" && specificationPolicy === "full") return {
    productionMode: implementation.productionMode,
    ...(!isSuppressed("appearance") ? { appearance: clone(implementation.appearance) } : {}),
    ...(!isSuppressed("techniques") ? { techniques: clone(implementation.techniques) } : {}),
    ...(!isSuppressed("specification") ? { specification: clone(implementation.specification) } : {}),
  };
  const specification = implementation.specification as unknown as Record<string, unknown>;
  const allowedFields = specificationPolicy === "full"
    ? Object.keys(specification).filter((field) => field !== "kind")
    : specificationFields[specificationPolicy][implementation.productionMode] || [];
  const appearance = appearancePolicy === "full"
    ? clone(implementation.appearance)
    : {
      realism: implementation.appearance.realism,
      dimensionality: implementation.appearance.dimensionality,
      descriptors: clone(implementation.appearance.descriptors),
    };
  return {
    productionMode: implementation.productionMode,
    ...(!isSuppressed("appearance") ? { appearance } : {}),
    ...(appearancePolicy === "full" && !isSuppressed("techniques")
      ? { techniques: clone(implementation.techniques) }
      : {}),
    ...(!isSuppressed("specification") ? {
      specification: Object.fromEntries([
        ["kind", implementation.productionMode],
        ...allowedFields
          .filter((field) => specification[field] !== undefined)
          .map((field) => [field, clone(specification[field])]),
      ]) as NonNullable<VisualProjectedImplementation["specification"]>,
    } : {}),
  };
};

const overrideAction = (value: { mode: string } | undefined) =>
  value?.mode === "set" ? "set" as const : value?.mode === "suppress" ? "suppress" as const : undefined;

const setSuppressedState = (fields: string[], path: string, suppressed: boolean) => {
  for (let index = fields.length - 1; index >= 0; index -= 1) {
    if (fields[index] === path) fields.splice(index, 1);
  }
  if (suppressed) fields.push(path);
};

const applyImplementationOverride = ({
  inherited,
  override,
  source,
  origins,
  suppressed,
  issues,
}: {
  inherited?: VisualImplementationMedium;
  override?: VisualImplementationOverride;
  source: VisualProjectionFieldOrigin["source"];
  origins: VisualProjectionFieldOrigin[];
  suppressed: string[];
  issues: VisualProjectionIssue[];
}): VisualImplementationMedium | undefined => {
  let result = inherited ? clone(inherited) : undefined;
  if (override?.productionMode?.mode === "set") {
    result = createNeutralVisualImplementation(override.productionMode.value);
    for (const field of ["appearance", "techniques", "specification"]) {
      setSuppressedState(suppressed, `visualImplementation.${field}`, false);
    }
    origins.push({ path: "visualImplementation.productionMode", source, action: "set" });
  }
  if (!result && (override?.appearance?.mode === "set" || override?.techniques?.mode === "set" || override?.specification?.mode === "set")) {
    issues.push({
      severity: "blocking",
      code: "OVERRIDE_REQUIRES_PRODUCTION_MODE",
      path: "visualImplementation.productionMode",
      message: "A local visual implementation override cannot set appearance, techniques, or a specification without a production mode.",
    });
    return undefined;
  }
  if (!result || !override) return result;

  const fields: Array<"appearance" | "techniques" | "specification"> = ["appearance", "techniques", "specification"];
  for (const field of fields) {
    const value = override[field] as VisualOverrideValue<never> | undefined;
    const action = overrideAction(value);
    if (!action) continue;
    const neutral = createNeutralVisualImplementation(result.productionMode);
    const nextValue = value?.mode === "suppress"
      ? neutral[field]
      : applyVisualOverrideValue(result[field] as never, value).value;
    if (field === "specification" && nextValue
      && (nextValue as VisualModeSpecification).kind !== result.productionMode) {
      issues.push({
        severity: "blocking",
        code: "VISUAL_SPECIFICATION_MODE_MISMATCH",
        path: `visualImplementation.${field}`,
        message: `The ${String((nextValue as VisualModeSpecification).kind)} specification does not match ${result.productionMode}.`,
      });
      continue;
    }
    (result as unknown as Record<string, unknown>)[field] = clone(nextValue);
    setSuppressedState(suppressed, `visualImplementation.${field}`, value?.mode === "suppress");
    origins.push({ path: `visualImplementation.${field}`, source, action });
  }
  return result;
};

const applyAssignmentsOverride = (
  inherited: VisualMediumAssignment[],
  override: VisualLocalOverride | undefined,
  source: VisualProjectionFieldOrigin["source"],
  origins: VisualProjectionFieldOrigin[],
  suppressed: string[],
) => {
  const action = overrideAction(override?.mediumAssignments);
  if (!action) return inherited;
  const applied = applyVisualOverrideValue(inherited, override?.mediumAssignments);
  origins.push({ path: "mediumAssignments", source, action });
  setSuppressedState(suppressed, "mediumAssignments", applied.suppressed);
  return applied.value || [];
};

export const projectVisualStyleForArtifact = (
  input: VisualStyleProjectionInput,
): VisualStyleProjection => {
  const normalized = normalizeLegacyVisualStyleLock(input.styleLock);
  const recipe = getVisualTaskRecipeForIntent(input.intent);
  const origins: VisualProjectionFieldOrigin[] = [];
  const suppressedFields: string[] = [];
  const blockingNormalizationWarnings = new Set([
    "MALFORMED_MEDIUM_ASSIGNMENTS",
    "MALFORMED_MEDIUM_ASSIGNMENT",
  ]);
  const issues: VisualProjectionIssue[] = normalized.warnings.map((warning) => ({
    severity: blockingNormalizationWarnings.has(warning.code) ? "blocking" : "warning",
    code: warning.code,
    path: warning.field,
    message: warning.message,
  }));
  const overrideLayers = [
    { value: input.assetOverride, source: "asset_override" as const },
    { value: input.shotOverride, source: "shot_override" as const },
    { value: input.requestOverride, source: "request_override" as const },
  ];
  const hasExplicitTargets = input.targets !== undefined;
  const requestedTargets = hasExplicitTargets
    ? clone(input.targets || [])
    : input.target
      ? [clone(input.target)]
      : [];
  const targetSelection = {
    mode: hasExplicitTargets || input.target ? "targeted" as const : "full_frame" as const,
    targets: requestedTargets,
  };

  // Let the model interpret the author's style names directly. Do not append a
  // guessed live-action/animation profile that could contradict these words.
  if (input.styleLock?.stylePrompt !== undefined) return {
    schemaVersion: "visual-style-projection.v1",
    stylePrompt: input.styleLock.stylePrompt,
    recipeId: recipe.id, recipeVersion: recipe.version, intent: input.intent,
    presentation: input.presentation || recipe.defaultPresentation, targetSelection,
    treatment: {}, mediumAssignments: [], appliedMediumAssignmentIds: [],
    neutralDirectives: [...recipe.neutralDirectives],
    fieldOrigins: [{ path: "stylePrompt", source: "style_lock", action: "seed" }],
    suppressedFields: [], issues: [],
    sourceStyle: { schemaVersion: input.styleLock.schemaVersion, revision: input.styleLock.revision,
      declaredContentHash: input.styleLock.contentHash, resolvedContentHash: normalized.lock.contentHash || "" },
  };

  let assignments = clone(normalized.lock.mediumAssignments || []);
  for (const layer of overrideLayers) {
    assignments = applyAssignmentsOverride(assignments, layer.value, layer.source, origins, suppressedFields);
  }

  if (normalized.lock.visualImplementation?.productionMode !== "mixed_media" && assignments.length) {
    issues.push({
      severity: "blocking",
      code: "MEDIUM_ASSIGNMENTS_REQUIRE_MIXED_MEDIA",
      path: "mediumAssignments",
      message: "Medium assignments cannot be projected unless the project production mode is mixed_media.",
    });
  }

  const rootImplementation = normalized.lock.visualImplementation
    ? clone(normalized.lock.visualImplementation)
    : undefined;
  const compositingEnvelope = rootImplementation?.productionMode === "mixed_media"
    ? rootImplementation
    : undefined;
  let implementation: VisualImplementationMedium | undefined = rootImplementation?.productionMode === "mixed_media"
    ? undefined
    : rootImplementation;
  if (compositingEnvelope) origins.push({ path: "compositingEnvelope", source: "style_lock", action: "seed" });
  else if (implementation) origins.push({ path: "visualImplementation", source: "style_lock", action: "seed" });
  const participatingAssignments = orderedAssignments(assignments).filter((entry) => (
    targetSelection.mode === "full_frame" || assignmentMatches(entry, requestedTargets)
  ));
  const wholeBaseAssignments = assignments.filter((assignment) => (
    assignment.compositingRole === "base" && assignment.target.scope === "whole"
  ));
  const nonWholeBaseAssignments = assignments.filter((assignment) => (
    assignment.compositingRole === "base" && assignment.target.scope !== "whole"
  ));
  if (compositingEnvelope && assignments.length && wholeBaseAssignments.length !== 1) {
    issues.push({
      severity: "blocking",
      code: "MIXED_MEDIA_BASE_ASSIGNMENT_INVALID",
      path: "mediumAssignments",
      message: "A mixed-media projection requires exactly one whole-composition base assignment.",
    });
  }
  if (compositingEnvelope && nonWholeBaseAssignments.length) {
    issues.push({
      severity: "blocking",
      code: "MIXED_MEDIA_BASE_ASSIGNMENT_MUST_TARGET_WHOLE",
      path: "mediumAssignments",
      message: "A base assignment must target the whole composition; entity and layer assignments refine that base.",
    });
  }
  const implementationAssignments = compositingEnvelope
    ? [
        ...(wholeBaseAssignments.length === 1 ? wholeBaseAssignments : []),
        ...(requestedTargets.length === 1
          ? participatingAssignments.filter((assignment) => assignment.target.scope !== "whole")
          : []),
      ]
    : [];
  const precedenceKeys = new Set<string>();
  const assignmentIds = new Set<string>();
  for (const current of participatingAssignments) {
    if (assignmentIds.has(current.id)) {
      issues.push({
        severity: "blocking",
        code: "DUPLICATE_MEDIUM_ASSIGNMENT_ID",
        path: "mediumAssignments",
        message: `Multiple applicable medium assignments use id ${current.id}.`,
      });
    }
    assignmentIds.add(current.id);
    const precedenceKey = `${assignmentTargetKey(current)}:${Number(current.priority || 0)}`;
    if (precedenceKeys.has(precedenceKey)) {
      issues.push({
        severity: "blocking",
        code: "AMBIGUOUS_MEDIUM_ASSIGNMENT_PRECEDENCE",
        path: "mediumAssignments",
        message: `Multiple assignments claim ${assignmentTargetKey(current)} at the same priority.`,
      });
    }
    precedenceKeys.add(precedenceKey);
  }
  for (const assignment of implementationAssignments) {
    implementation = clone(assignment.implementation);
    origins.push({
      path: "visualImplementation",
      source: "medium_assignment",
      sourceId: assignment.id,
      action: "set",
    });
  }
  for (const layer of overrideLayers) {
    implementation = applyImplementationOverride({
      inherited: implementation,
      override: layer.value?.implementation,
      source: layer.source,
      origins,
      suppressed: suppressedFields,
      issues,
    });
  }

  const treatment = clone(normalized.lock.treatment || {}) as Partial<VisualStyleTreatment>;
  for (const section of Object.keys(treatment) as Array<keyof VisualStyleTreatment>) {
    if (treatment[section]?.length) origins.push({ path: `treatment.${section}`, source: "style_lock", action: "seed" });
  }
  for (const layer of overrideLayers) {
    for (const section of Object.keys(layer.value?.treatment || {}) as Array<keyof VisualStyleTreatment>) {
      const override = layer.value?.treatment?.[section];
      const action = overrideAction(override);
      if (!action) continue;
      const applied = applyVisualOverrideValue(treatment[section], override);
      if (applied.value === undefined) delete treatment[section];
      else treatment[section] = applied.value;
      setSuppressedState(suppressedFields, `treatment.${section}`, applied.suppressed);
      origins.push({ path: `treatment.${section}`, source: layer.source, action });
    }
  }

  const projectedTreatment = Object.fromEntries(recipe.treatmentSections
    .filter((section) => treatment[section] !== undefined)
    .map((section) => [section, treatment[section]])) as Partial<VisualStyleTreatment>;
  origins.push({ path: "presentation", source: "recipe", sourceId: recipe.id, action: "project" });
  if (compositingEnvelope && assignments.length === 0) {
    issues.push({
      severity: "warning",
      code: "MIXED_MEDIA_ASSIGNMENTS_EMPTY",
      path: "mediumAssignments",
      message: "Mixed media is selected but no whole, entity, or layer assignment has been declared.",
    });
  }
  const mediumProfile = implementation ? getVisualMediumProfile(implementation.productionMode) : undefined;
  const envelopeProfile = compositingEnvelope ? getVisualMediumProfile("mixed_media") : undefined;
  const mediumDirectives = Array.from(new Set([
    ...(envelopeProfile?.neutralDirectives || []),
    ...(mediumProfile?.neutralDirectives || []),
  ]));
  const projectedAssignments = participatingAssignments.map((assignment): VisualProjectedMediumAssignment => {
    const assignmentProfile = getVisualMediumProfile(assignment.implementation.productionMode);
    return {
      ...clone(assignment),
      implementation: projectImplementation(
        assignment.implementation,
        recipe.appearanceProjection,
        recipe.specificationProjection,
        [],
      )!,
      mediumProfile: { id: assignmentProfile.id, version: assignmentProfile.version },
    };
  });

  return {
    schemaVersion: "visual-style-projection.v1",
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    intent: input.intent,
    presentation: input.presentation || recipe.defaultPresentation,
    targetSelection,
    ...(compositingEnvelope ? {
      compositingEnvelope: projectImplementation(
        compositingEnvelope,
        recipe.appearanceProjection,
        recipe.specificationProjection,
        [],
      ) as VisualProjectedCompositingEnvelope,
    } : {}),
    implementation: projectImplementation(
      implementation,
      recipe.appearanceProjection,
      recipe.specificationProjection,
      suppressedFields,
    ),
    treatment: projectedTreatment,
    mediumAssignments: projectedAssignments,
    appliedMediumAssignmentIds: participatingAssignments.map((entry) => entry.id),
    neutralDirectives: [...mediumDirectives, ...recipe.neutralDirectives],
    fieldOrigins: origins,
    suppressedFields: Array.from(new Set(suppressedFields)),
    issues,
    sourceStyle: {
      schemaVersion: input.styleLock?.schemaVersion,
      revision: input.styleLock?.revision,
      declaredContentHash: input.styleLock?.contentHash,
      resolvedContentHash: normalized.lock.contentHash || "",
    },
    ...(mediumProfile ? { mediumProfile: { id: mediumProfile.id, version: mediumProfile.version } } : {}),
    ...(envelopeProfile ? {
      compositingEnvelopeProfile: { id: envelopeProfile.id, version: envelopeProfile.version },
    } : {}),
  };
};

export interface RenderedVisualStyleProjectionInstruction {
  schemaVersion: "visual-style-projection-instruction.v1";
  instruction: string;
  blocks: Array<{ id: string; content: string }>;
  manifest: VisualCompileManifest;
}

export interface VisualStyleProjectionRenderOptions {
  /** Human-readable target labels keyed by assignment id. Internal ids never enter prompt text. */
  assignmentTargetLabels?: Record<string, string>;
}

export class VisualStyleProjectionRenderError extends Error {
  readonly issues: VisualProjectionIssue[];

  constructor(issues: VisualProjectionIssue[]) {
    super("Visual style projection contains blocking issues and cannot be rendered.");
    this.name = "VisualStyleProjectionRenderError";
    this.issues = clone(issues);
  }
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [
      key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase(),
      stableValue(entry),
    ]));
};

const renderedBlock = (id: string, label: string, value: unknown) => ({
  id,
  content: `${label}\n${JSON.stringify(stableValue(value))}`,
});

const artifactIntentPromptLabel: Record<VisualArtifactIntent, string> = {
  asset_identity: "canonical asset identity reference",
  asset_state: "single declared asset state reference",
  storyboard_control: "storyboard control drawing",
  direction_preview: "provisional direction preview",
  effect_look: "final-look development image",
  final_frame: "final production frame",
  image_edit: "bounded image edit",
  video_clip: "production video clip",
};

const presentationPromptLabel: Record<VisualArtifactPresentation, string> = {
  final_render: "final render",
  clean_reference: "clean model reference",
  control_drawing: "control drawing",
  annotated_board: "annotated production board",
};

export const renderVisualStyleProjectionInstruction = (
  projection: VisualStyleProjection,
  options: VisualStyleProjectionRenderOptions = {},
): RenderedVisualStyleProjectionInstruction => {
  const blockingIssues = projection.issues.filter((issue) => issue.severity === "blocking");
  if (blockingIssues.length) throw new VisualStyleProjectionRenderError(blockingIssues);
  const appliedIds = new Set(projection.appliedMediumAssignmentIds);
  const appliedAssignments = projection.mediumAssignments.filter((assignment) => appliedIds.has(assignment.id));
  const promptAssignments = appliedAssignments.map((assignment, index) => {
    const fallbackTarget = assignment.target.scope === "whole"
      ? "whole composition"
      : assignment.target.scope === "entity"
        ? `${assignment.target.entityType} element ${index + 1}`
        : `visual layer ${index + 1}`;
    return {
      target: options.assignmentTargetLabels?.[assignment.id]?.trim() || fallbackTarget,
      compositingRole: assignment.compositingRole,
      ...(assignment.priority !== undefined ? { priority: assignment.priority } : {}),
      ...(assignment.notes?.length ? { notes: assignment.notes } : {}),
      implementation: assignment.implementation,
    };
  });
  const blocks = [
    ...(projection.stylePrompt !== undefined ? [{ id: "visual.style_prompt", content: "【风格提示词】\n" + projection.stylePrompt + "\n按此风格呈现既定内容，保留角色身份、动作及镜头要求。" }] : []),
    renderedBlock("visual.artifact", "[Visual artifact]", {
      purpose: artifactIntentPromptLabel[projection.intent],
      presentation: presentationPromptLabel[projection.presentation],
    }),
    ...(projection.compositingEnvelope
      ? [renderedBlock(
          "visual.compositing_envelope",
          "[Mixed-media compositing envelope]",
          projection.compositingEnvelope,
        )]
      : []),
    ...(projection.implementation
      ? [renderedBlock("visual.implementation", "[Projected visual implementation]", projection.implementation)]
      : []),
    ...(promptAssignments.length
      ? [renderedBlock("visual.assignments", "[Applied medium assignments]", promptAssignments)]
      : []),
    ...(Object.keys(projection.treatment).length
      ? [renderedBlock("visual.treatment", "[Projected treatment]", projection.treatment)]
      : []),
    ...(projection.neutralDirectives.length
      ? [renderedBlock("visual.directives", "[Recipe directives]", projection.neutralDirectives)]
      : []),
  ];
  return {
    schemaVersion: "visual-style-projection-instruction.v1",
    instruction: blocks.map((block) => block.content).join("\n\n"),
    blocks,
    manifest: {
      schemaVersion: "visual-compile-manifest.v1",
      recipeId: projection.recipeId,
      recipeVersion: projection.recipeVersion,
      intent: projection.intent,
      presentation: projection.presentation,
      targetSelection: clone(projection.targetSelection),
      sourceStyle: clone(projection.sourceStyle),
      ...(projection.mediumProfile ? { mediumProfile: clone(projection.mediumProfile) } : {}),
      ...(projection.compositingEnvelopeProfile
        ? { compositingEnvelopeProfile: clone(projection.compositingEnvelopeProfile) }
        : {}),
      appliedMediumProfiles: appliedAssignments.map((assignment) => ({
        assignmentId: assignment.id,
        ...clone(assignment.mediumProfile),
      })),
      appliedMediumAssignmentIds: [...projection.appliedMediumAssignmentIds],
      suppressedFields: [...projection.suppressedFields],
      issueCodes: projection.issues.map((issue) => issue.code),
      blockIds: blocks.map((block) => block.id),
    },
  };
};
