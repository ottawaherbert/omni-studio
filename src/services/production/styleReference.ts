import type { Project, VisualAppearance, VisualStyleLock, VisualStyleTreatment } from "../../types/project";
import type { ProductionQAIssue, ProductionStageType } from "../../types/production";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";
import {
  normalizeLegacyVisualStyleLock,
  visualStyleContentHash,
} from "../../../packages/production/src/services/production/visualStyleMigration";
import { validateVisualStyleReadiness } from "../../../packages/production/src/services/production/visualMediumProfiles";

export type StyleReferenceSourceType =
  | "uploaded_image"
  | "effect_look"
  | "operator_asset"
  | "external_reference";

export type StyleReferenceUsageIntent =
  | "style_only"
  | "effect_look"
  | "storyboard_reference";

export type StyleReferenceRightsStatus =
  | "unknown"
  | "user_provided"
  | "cleared"
  | "restricted";

export type StyleLockApprovalState = "draft" | "pending_review" | "approved" | "rejected";

export interface StyleReferenceSource {
  id: string;
  sourceType: StyleReferenceSourceType;
  usageIntent: StyleReferenceUsageIntent;
  mediaUrl?: string;
  localPath?: string;
  operatorAssetId?: string;
  rightsStatus?: StyleReferenceRightsStatus;
  notes?: string;
}

export interface ExtractedStyleTraits {
  renderingMode?: string;
  /** Appearance is independent from the implementation medium. */
  appearance?: Partial<VisualAppearance>;
  mediumSurface: string[];
  linework: string[];
  sketchDensity?: string;
  strokeWeight?: string;
  finishLevel?: string;
  colorPalette: string[];
  allowedHex: string[];
  forbiddenColors: string[];
  colorTemperature: string[];
  saturation?: string;
  contrast?: string;
  texture: string[];
  lighting: string[];
  lightSourceLogic: string[];
  conditionalLighting: string[];
  practicalLightRules: string[];
  cameraLanguage?: string;
  lensBias: string[];
  movementBias: string[];
  framingBias: string[];
  depthOfField?: string;
  grain: string[];
  noiseFloor?: string;
  materialRendering: string[];
  compositionRules: string[];
  negativeSpaceRules: string[];
  foregroundRules: string[];
  readabilityRules: string[];
  annotationLegend: NonNullable<VisualStyleLock["annotationLegend"]>;
  boardAnnotationPolicy?: string;
  assetBoardStylePolicy?: string;
  storyboardStylePolicy?: string;
  effectLookPolicy?: string;
  negativeStyleRules: string[];
  noSourceCopyRules: string[];
  driftGuards: string[];
}

export interface StyleReferenceAnalysis {
  schemaVersion: "style-reference-analysis.v1";
  id: string;
  projectId: string;
  sourceImageRefs: StyleReferenceSource[];
  extractedTraits: ExtractedStyleTraits;
  paletteSamples: string[];
  lightingRead: string[];
  cameraRead: string[];
  lineworkRead: string[];
  compositionRead: string[];
  noSourceCopyBoundaries: string[];
  confidence: number;
  createdAt: number;
}

export interface VisualStyleLockCandidate {
  schemaVersion: "visual-style-lock-candidate.v1";
  id: string;
  projectId: string;
  /** Revision observed when this candidate was created. Used to reject stale approvals. */
  baseRevision: number;
  sourceAnalysisIds: string[];
  candidateLock: VisualStyleLock;
  diffFromCurrentLock: string[];
  scope: "project" | "production_block" | "scene_range" | "sample";
  riskNotes: string[];
  fallbackRules: string[];
  approvalState: StyleLockApprovalState;
  createdAt: number;
}

export interface StyleLockChangeOrder {
  schemaVersion: "style-lock-change-order.v1";
  id: string;
  projectId: string;
  sourceCandidateId: string;
  /** Revision the approved candidate was based on. */
  baseRevision: number;
  scope: VisualStyleLockCandidate["scope"];
  approvalState: Exclude<StyleLockApprovalState, "draft">;
  approvedBy?: string;
  targetStyleLock: VisualStyleLock;
  affectedArtifactKinds: string[];
  /** Legacy field name: these are review recommendations, never automatic reruns or invalidations. */
  requiredReruns: string[];
  rollbackPlan: string;
  createdAt: number;
}

export interface StyleReferenceAnalysisInput {
  sourceImageRefs?: StyleReferenceSource[];
  extractedTraits?: Partial<ExtractedStyleTraits>;
  analysisText?: string;
  notes?: string;
  confidence?: number;
}

const clean = (value: unknown) => String(value || "").trim();

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));

const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  options: Partial<ProductionQAIssue> = {},
): ProductionQAIssue => ({
  id: `style_reference_${target.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${severity}`,
  target,
  message,
  severity,
  retryable: severity !== "blocking",
  issueType: "style_reference_contract",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "auto_repairable",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
  ...options,
});

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const clampConfidence = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
};

const textIncludes = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

const inferRenderingMode = (text: string, project?: Pick<Project, "visualStyleLock" | "creativeVision">) => {
  if (textIncludes(text, [/stop[ -]?motion|claymation|定格|黏土动画|木偶动画|纸偶动画/iu])) return "stop_motion";
  if (textIncludes(text, [/mixed[ -]?media|hybrid media|混合媒介|混合媒体|实拍\s*[+＋]\s*(?:2d|3d|动画)/iu])) return "mixed_media";
  if (textIncludes(text, [/3d|三维|三渲二|cg|c4d|blender/iu])) return "3d_animation";
  if (textIncludes(text, [/(?:^|\b)2d(?:\b|$)|二维动画|手绘动画|逐帧动画|anime|二次元|日漫|comic|漫画|美漫/iu])) return "2d_animation";
  if (textIncludes(text, [/live[ -]?action|真人实拍|实景拍摄|摄影机实拍/iu])) return "live_action";
  return clean(project?.visualStyleLock?.visualImplementation?.productionMode || project?.visualStyleLock?.renderingMode);
};

const inferTraitsFromText = (
  text: string,
  project?: Pick<Project, "visualStyleLock" | "creativeVision">,
): Partial<ExtractedStyleTraits> => {
  const normalized = clean(text);
  const hex = Array.from(new Set((normalized.match(/#[0-9a-f]{6}\b/giu) || []).map((item) => item.toUpperCase())));
  const renderingMode = inferRenderingMode(normalized, project);
  const appearance: Partial<VisualAppearance> = {
    ...(textIncludes(normalized, [/photoreal|照片级/iu]) ? { realism: "photoreal" as const } : {}),
    ...(textIncludes(normalized, [/naturalistic|自然主义|自然写实/iu]) ? { realism: "naturalistic" as const } : {}),
    ...(textIncludes(normalized, [/stylized|风格化|二次元/iu]) ? { realism: "stylized" as const } : {}),
    ...(textIncludes(normalized, [/graphic|图形化|漫画/iu]) ? { realism: "graphic" as const, finish: "graphic" as const } : {}),
    ...(textIncludes(normalized, [/abstract|抽象/iu]) ? { realism: "abstract" as const } : {}),
  };
  const mediumSurface = [
    textIncludes(normalized, [/paper|纸|画纸|稿纸/iu]) ? "paper surface" : "",
    textIncludes(normalized, [/film|胶片/iu]) ? "film surface" : "",
    textIncludes(normalized, [/digital|数码|高清/iu]) ? "digital surface" : "",
  ].filter(Boolean);
  const linework = [
    textIncludes(normalized, [/rough|coarse|粗糙|粗线|速写/iu]) ? "rough gesture linework" : "",
    textIncludes(normalized, [/clean|干净|细线|墨线/iu]) ? "clean readable linework" : "",
    textIncludes(normalized, [/pencil|铅笔|草图|线稿/iu]) ? "pencil sketch linework" : "",
  ].filter(Boolean);
  const colorPalette = [
    ...hex,
    textIncludes(normalized, [/black|white|黑白|单色/iu]) ? "black and white" : "",
    textIncludes(normalized, [/red|红/iu]) ? "red accent" : "",
    textIncludes(normalized, [/blue|蓝|青/iu]) ? "blue/cyan tone" : "",
    textIncludes(normalized, [/green|绿/iu]) ? "green tone" : "",
    textIncludes(normalized, [/orange|橙|暖/iu]) ? "warm orange accent" : "",
    textIncludes(normalized, [/purple|紫/iu]) ? "purple accent" : "",
  ].filter(Boolean);
  const lighting = [
    textIncludes(normalized, [/window|窗光|日光|sun|sunlight|阳光/iu]) ? "window/daylight direction" : "",
    textIncludes(normalized, [/backlight|逆光/iu]) ? "backlight" : "",
    textIncludes(normalized, [/top light|顶光/iu]) ? "top light" : "",
    textIncludes(normalized, [/neon|霓虹/iu]) ? "neon practical light" : "",
  ].filter(Boolean);
  const lensBias = (normalized.match(/\b(?:1[68]|2[0458]|35|50|85|100)mm\b/giu) || []).map((item) => item.toLowerCase());
  const movementBias = [
    textIncludes(normalized, [/push|推镜|推近/iu]) ? "push-in" : "",
    textIncludes(normalized, [/pull|拉镜|拉远/iu]) ? "pull-back" : "",
    textIncludes(normalized, [/pan|tilt|摇|俯仰/iu]) ? "pan/tilt" : "",
    textIncludes(normalized, [/handheld|手持/iu]) ? "handheld" : "",
    textIncludes(normalized, [/track|follow|跟拍/iu]) ? "tracking/follow" : "",
  ].filter(Boolean);
  const compositionRules = [
    textIncludes(normalized, [/negative space|留白|负空间/iu]) ? "controlled negative space" : "",
    textIncludes(normalized, [/silhouette|轮廓/iu]) ? "strong silhouette readability" : "",
    textIncludes(normalized, [/dutch|荷兰角|倾斜/iu]) ? "intentional dutch angle when motivated" : "",
    textIncludes(normalized, [/foreground|前景/iu]) ? "foreground depth cue" : "",
  ].filter(Boolean);
  const texture = [
    textIncludes(normalized, [/grain|颗粒|噪点/iu]) ? "visible grain" : "",
    textIncludes(normalized, [/mist|雾|柔雾/iu]) ? "soft mist" : "",
    textIncludes(normalized, [/skin|皮肤纹理/iu]) ? "preserved skin texture" : "",
  ].filter(Boolean);

  return {
    renderingMode,
    appearance,
    mediumSurface,
    linework,
    sketchDensity: textIncludes(normalized, [/minimal|低细节|少细节/iu]) ? "low detail control sketch" : undefined,
    strokeWeight: textIncludes(normalized, [/粗线|thick/iu]) ? "thick primary strokes" : undefined,
    finishLevel: textIncludes(normalized, [/unfinished|未完成|草稿/iu]) ? "unfinished control drawing" : undefined,
    colorPalette,
    allowedHex: hex,
    forbiddenColors: [],
    colorTemperature: [
      textIncludes(normalized, [/warm|暖/iu]) ? "warm" : "",
      textIncludes(normalized, [/cool|冷|青冷/iu]) ? "cool" : "",
    ].filter(Boolean),
    texture,
    lighting,
    lightSourceLogic: lighting.length ? ["mark primary light direction and motivated light changes"] : [],
    conditionalLighting: [],
    practicalLightRules: [],
    cameraLanguage: movementBias.length || lensBias.length
      ? "camera notes must preserve lens and movement intent"
      : clean(project?.visualStyleLock?.treatment?.camera?.join("；") || project?.visualStyleLock?.cameraLanguage),
    lensBias,
    movementBias,
    framingBias: textIncludes(normalized, [/close-up|特写|近景/iu]) ? ["close-up readable emotion and action"] : [],
    grain: texture.includes("visible grain") ? ["visible grain"] : [],
    materialRendering: [],
    compositionRules,
    negativeSpaceRules: compositionRules.includes("controlled negative space") ? ["leave readable negative space for notes"] : [],
    foregroundRules: compositionRules.includes("foreground depth cue") ? ["foreground elements must clarify depth, not hide subject"] : [],
    readabilityRules: ["subject silhouette and annotation text must remain legible"],
    annotationLegend: [],
    negativeStyleRules: [],
    noSourceCopyRules: ["do not copy source character, scene, logo, watermark, unique prop, or exact composition"],
    driftGuards: ["style reference is a style guide, not a new canonical asset"],
  };
};

const mergeTraitArrays = <K extends keyof ExtractedStyleTraits>(
  base: Partial<ExtractedStyleTraits>,
  override: Partial<ExtractedStyleTraits>,
  key: K,
) => {
  const baseValue = base[key];
  const overrideValue = override[key];
  if (Array.isArray(baseValue) || Array.isArray(overrideValue)) {
    return uniq([...(Array.isArray(baseValue) ? baseValue as string[] : []), ...(Array.isArray(overrideValue) ? overrideValue as string[] : [])]);
  }
  return overrideValue !== undefined ? overrideValue : baseValue;
};

const completeTraits = (
  inferred: Partial<ExtractedStyleTraits>,
  override: Partial<ExtractedStyleTraits> = {},
): ExtractedStyleTraits => ({
  renderingMode: clean(override.renderingMode || inferred.renderingMode),
  appearance: { ...(inferred.appearance || {}), ...(override.appearance || {}) },
  mediumSurface: mergeTraitArrays(inferred, override, "mediumSurface") as string[] || [],
  linework: mergeTraitArrays(inferred, override, "linework") as string[] || [],
  sketchDensity: clean(override.sketchDensity || inferred.sketchDensity),
  strokeWeight: clean(override.strokeWeight || inferred.strokeWeight),
  finishLevel: clean(override.finishLevel || inferred.finishLevel),
  colorPalette: mergeTraitArrays(inferred, override, "colorPalette") as string[] || [],
  allowedHex: mergeTraitArrays(inferred, override, "allowedHex") as string[] || [],
  forbiddenColors: mergeTraitArrays(inferred, override, "forbiddenColors") as string[] || [],
  colorTemperature: mergeTraitArrays(inferred, override, "colorTemperature") as string[] || [],
  saturation: clean(override.saturation || inferred.saturation),
  contrast: clean(override.contrast || inferred.contrast),
  texture: mergeTraitArrays(inferred, override, "texture") as string[] || [],
  lighting: mergeTraitArrays(inferred, override, "lighting") as string[] || [],
  lightSourceLogic: mergeTraitArrays(inferred, override, "lightSourceLogic") as string[] || [],
  conditionalLighting: mergeTraitArrays(inferred, override, "conditionalLighting") as string[] || [],
  practicalLightRules: mergeTraitArrays(inferred, override, "practicalLightRules") as string[] || [],
  cameraLanguage: clean(override.cameraLanguage || inferred.cameraLanguage),
  lensBias: mergeTraitArrays(inferred, override, "lensBias") as string[] || [],
  movementBias: mergeTraitArrays(inferred, override, "movementBias") as string[] || [],
  framingBias: mergeTraitArrays(inferred, override, "framingBias") as string[] || [],
  depthOfField: clean(override.depthOfField || inferred.depthOfField),
  grain: mergeTraitArrays(inferred, override, "grain") as string[] || [],
  noiseFloor: clean(override.noiseFloor || inferred.noiseFloor),
  materialRendering: mergeTraitArrays(inferred, override, "materialRendering") as string[] || [],
  compositionRules: mergeTraitArrays(inferred, override, "compositionRules") as string[] || [],
  negativeSpaceRules: mergeTraitArrays(inferred, override, "negativeSpaceRules") as string[] || [],
  foregroundRules: mergeTraitArrays(inferred, override, "foregroundRules") as string[] || [],
  readabilityRules: mergeTraitArrays(inferred, override, "readabilityRules") as string[] || [],
  annotationLegend: Array.isArray(override.annotationLegend) ? override.annotationLegend : Array.isArray(inferred.annotationLegend) ? inferred.annotationLegend : [],
  boardAnnotationPolicy: clean(override.boardAnnotationPolicy || inferred.boardAnnotationPolicy),
  assetBoardStylePolicy: clean(override.assetBoardStylePolicy || inferred.assetBoardStylePolicy),
  storyboardStylePolicy: clean(override.storyboardStylePolicy || inferred.storyboardStylePolicy),
  effectLookPolicy: clean(override.effectLookPolicy || inferred.effectLookPolicy),
  negativeStyleRules: mergeTraitArrays(inferred, override, "negativeStyleRules") as string[] || [],
  noSourceCopyRules: mergeTraitArrays(inferred, override, "noSourceCopyRules") as string[] || [],
  driftGuards: mergeTraitArrays(inferred, override, "driftGuards") as string[] || [],
});

const hasAnyTrait = (traits: Partial<ExtractedStyleTraits> | undefined) => Boolean(
  traits?.renderingMode ||
  Object.values(traits?.appearance || {}).some((value) => Array.isArray(value) ? value.length > 0 : hasText(value)) ||
  hasText(traits?.cameraLanguage) ||
  asArray(traits?.mediumSurface).length ||
  asArray(traits?.linework).length ||
  asArray(traits?.colorPalette).length ||
  asArray(traits?.lighting).length ||
  asArray(traits?.compositionRules).length,
);

const mergeTraitsIntoLock = (
  traits: Partial<ExtractedStyleTraits>,
  sourceIds: string[],
): VisualStyleLock => ({
  renderingMode: clean(traits.renderingMode),
  stylePrompt: [
    clean(traits.renderingMode),
    ...asArray<string>(traits.mediumSurface),
    ...asArray<string>(traits.linework),
    ...asArray<string>(traits.lighting),
    ...asArray<string>(traits.cameraLanguage ? [traits.cameraLanguage] : []),
  ].filter(Boolean).join("；"),
  styleKeywords: uniq([
    ...asArray<string>(traits.mediumSurface),
    ...asArray<string>(traits.linework),
    ...asArray<string>(traits.texture),
    ...asArray<string>(traits.compositionRules),
  ]),
  colorPalette: asArray<string>(traits.colorPalette),
  allowedHex: asArray<string>(traits.allowedHex),
  forbiddenColors: asArray<string>(traits.forbiddenColors),
  colorTemperature: asArray<string>(traits.colorTemperature),
  saturation: clean(traits.saturation),
  contrast: clean(traits.contrast),
  texture: asArray<string>(traits.texture),
  mediumSurface: asArray<string>(traits.mediumSurface),
  linework: asArray<string>(traits.linework),
  sketchDensity: clean(traits.sketchDensity),
  strokeWeight: clean(traits.strokeWeight),
  finishLevel: clean(traits.finishLevel),
  lighting: asArray<string>(traits.lighting),
  lightSourceLogic: asArray<string>(traits.lightSourceLogic),
  conditionalLighting: asArray<string>(traits.conditionalLighting),
  practicalLightRules: asArray<string>(traits.practicalLightRules),
  cameraLanguage: clean(traits.cameraLanguage),
  lensBias: asArray<string>(traits.lensBias),
  movementBias: asArray<string>(traits.movementBias),
  framingBias: asArray<string>(traits.framingBias),
  depthOfField: clean(traits.depthOfField),
  grain: asArray<string>(traits.grain),
  noiseFloor: clean(traits.noiseFloor),
  materialRendering: asArray<string>(traits.materialRendering),
  compositionRules: asArray<string>(traits.compositionRules),
  negativeSpaceRules: asArray<string>(traits.negativeSpaceRules),
  foregroundRules: asArray<string>(traits.foregroundRules),
  readabilityRules: asArray<string>(traits.readabilityRules),
  annotationLegend: asArray<NonNullable<VisualStyleLock["annotationLegend"]>[number]>(traits.annotationLegend),
  boardAnnotationPolicy: clean(traits.boardAnnotationPolicy),
  assetBoardStylePolicy: clean(traits.assetBoardStylePolicy),
  storyboardStylePolicy: clean(traits.storyboardStylePolicy),
  effectLookPolicy: clean(traits.effectLookPolicy),
  negativeStyleRules: asArray<string>(traits.negativeStyleRules),
  noSourceCopyRules: asArray<string>(traits.noSourceCopyRules),
  driftGuards: asArray<string>(traits.driftGuards),
  styleSourceRefs: sourceIds,
  analysisConfidence: undefined,
  humanApprovalState: "draft",
  version: "visual-style-lock.v2",
  source: "style_reference_analysis",
  lockedAt: Date.now(),
});

export const buildVisualStyleLockCandidateFromAnalysis = (
  analysis: StyleReferenceAnalysis,
  currentLock: VisualStyleLock = {},
): VisualStyleLockCandidate => {
  const baseRevision = Math.max(0, Math.floor(Number(currentLock.revision) || 0));
  const legacyCandidate = mergeTraitsIntoLock(analysis.extractedTraits, analysis.sourceImageRefs.map((ref) => ref.id));
  const analyzed = normalizeLegacyVisualStyleLock(legacyCandidate, { detectedAt: analysis.createdAt }).lock;
  const normalizedCurrent = normalizeLegacyVisualStyleLock(currentLock).lock;
  const currentImplementation = normalizedCurrent.visualImplementation;
  const analyzedImplementation = analyzed.visualImplementation;
  const sameMedium = Boolean(
    currentImplementation
    && analyzedImplementation
    && currentImplementation.productionMode === analyzedImplementation.productionMode,
  );
  const visualImplementation = currentImplementation && (!analyzedImplementation || sameMedium)
    ? structuredClone(currentImplementation)
    : analyzedImplementation ? structuredClone(analyzedImplementation) : undefined;
  if (visualImplementation) {
    visualImplementation.appearance = {
      ...visualImplementation.appearance,
      ...(analysis.extractedTraits.appearance || {}),
      descriptors: uniq([
        ...(visualImplementation.appearance.descriptors || []),
        ...(analyzedImplementation?.appearance.descriptors || []),
        ...(analysis.extractedTraits.appearance?.descriptors || []),
      ]),
    };
  }
  const treatment = Object.fromEntries(Object.keys(normalizedCurrent.treatment || analyzed.treatment || {}).map((section) => {
    const key = section as keyof VisualStyleTreatment;
    return [key, uniq([
      ...(normalizedCurrent.treatment?.[key] || []),
      ...(analyzed.treatment?.[key] || []),
    ])];
  })) as unknown as VisualStyleTreatment;
  const candidateLock: VisualStyleLock = {
    ...currentLock,
    ...legacyCandidate,
    schemaVersion: "visual-style-lock.v3",
    visualImplementation,
    treatment,
    mediumAssignments: structuredClone(normalizedCurrent.mediumAssignments || []),
    styleSourceRefs: uniq([
      ...(currentLock.styleSourceRefs || []),
      ...(legacyCandidate.styleSourceRefs || []),
    ]),
    noSourceCopyRules: uniq([
      ...(currentLock.noSourceCopyRules || []),
      ...(legacyCandidate.noSourceCopyRules || []),
    ]),
  };
  candidateLock.revision = baseRevision + 1;
  candidateLock.version = `visual-style-lock.v3.r${candidateLock.revision}`;
  candidateLock.humanApprovalState = "draft";
  candidateLock.sourceReview = {
    status: "current",
    changedFields: [],
    detectedAt: analysis.createdAt,
    basedOnRevision: candidateLock.revision,
  };
  candidateLock.analysisConfidence = analysis.confidence;
  candidateLock.contentHash = visualStyleContentHash(candidateLock);
  return {
    schemaVersion: "visual-style-lock-candidate.v1",
    id: `style_lock_candidate_${analysis.id}`,
    projectId: analysis.projectId,
    baseRevision,
    sourceAnalysisIds: [analysis.id],
    candidateLock,
    scope: "project",
    diffFromCurrentLock: [
      candidateLock.visualImplementation?.productionMode !== normalizedCurrent.visualImplementation?.productionMode
        ? "visualImplementation.productionMode changed or newly inferred"
        : "",
      candidateLock.contentHash !== normalizedCurrent.contentHash ? "canonical visual style content changed" : "",
    ].filter(Boolean),
    riskNotes: [
      "candidate must be approved before mutating project.visualStyleLock",
      "reference sources are style-only and may not be copied as characters, locations, or unique compositions",
    ],
    fallbackRules: ["fallback to current project.visualStyleLock when rejected", "do not change asset identity boards until approved"],
    approvalState: "draft",
    createdAt: Date.now(),
  };
};

export const buildStyleReferenceAnalysis = (
  project: Pick<Project, "id" | "visualStyleLock" | "creativeVision">,
  input: StyleReferenceAnalysisInput = {},
): StyleReferenceAnalysis => {
  const sourceImageRefs = asArray<StyleReferenceSource>(input.sourceImageRefs).map((ref, index) => ({
    ...ref,
    id: clean(ref.id) || `style_ref_${index + 1}`,
    sourceType: ref.sourceType || "uploaded_image",
    usageIntent: ref.usageIntent || "style_only",
    rightsStatus: ref.rightsStatus || "unknown",
  }));
  const notes = [
    input.analysisText,
    input.notes,
    ...sourceImageRefs.map((ref) => ref.notes),
  ].filter(Boolean).join("\n");
  const inferredTraits = inferTraitsFromText(notes, project);
  const extractedTraits = completeTraits(inferredTraits, input.extractedTraits || {});
  const confidence = clampConfidence(input.confidence, hasAnyTrait(input.extractedTraits) ? 0.68 : notes ? 0.45 : 0.25);
  return {
    schemaVersion: "style-reference-analysis.v1",
    id: `style_reference_analysis_${Date.now()}`,
    projectId: project.id,
    sourceImageRefs,
    extractedTraits,
    paletteSamples: extractedTraits.colorPalette.length ? extractedTraits.colorPalette : extractedTraits.allowedHex,
    lightingRead: extractedTraits.lighting,
    cameraRead: uniq([extractedTraits.cameraLanguage, ...extractedTraits.lensBias, ...extractedTraits.movementBias]),
    lineworkRead: extractedTraits.linework,
    compositionRead: extractedTraits.compositionRules,
    noSourceCopyBoundaries: extractedTraits.noSourceCopyRules.length
      ? extractedTraits.noSourceCopyRules
      : ["style-only extraction; do not copy source subject, scene, watermark, logo, unique prop, or exact composition"],
    confidence,
    createdAt: Date.now(),
  };
};

export const buildStyleLockChangeOrderFromCandidate = (
  candidate: VisualStyleLockCandidate,
  options: {
    approvalState?: StyleLockChangeOrder["approvalState"];
    approvedBy?: string;
    affectedArtifactKinds?: string[];
    requiredReruns?: ProductionStageType[];
    rollbackPlan?: string;
  } = {},
): StyleLockChangeOrder => {
  const approvalState = options.approvalState || "pending_review";
  return {
    schemaVersion: "style-lock-change-order.v1",
    id: `style_lock_change_order_${candidate.id}_${Date.now()}`,
    projectId: candidate.projectId,
    sourceCandidateId: candidate.id,
    baseRevision: candidate.baseRevision,
    scope: candidate.scope,
    approvalState,
    approvedBy: options.approvedBy,
    targetStyleLock: {
      ...candidate.candidateLock,
      humanApprovalState: approvalState === "approved" ? "approved" : "pending_review",
      sourceReview: {
        status: "current",
        changedFields: [],
        detectedAt: Date.now(),
        basedOnRevision: candidate.candidateLock.revision,
      },
      lockedAt: Date.now(),
    },
    affectedArtifactKinds: options.affectedArtifactKinds || [
      "asset_identity_board",
      "storyboard_board",
      "asset_reference_pack",
      "video_generation_unit",
    ],
    requiredReruns: options.requiredReruns || [
      "production_asset_detail",
      "asset_sync",
      "storyboard",
      "prompt",
      "expensive_generation_planning",
    ],
    rollbackPlan: options.rollbackPlan || "restore the previous project.visualStyleLock; keep adopted artifacts intact and recommend review before any newly requested generation",
    createdAt: Date.now(),
  };
};

export const validateStyleReferenceAnalysis = (
  analysis: Partial<StyleReferenceAnalysis> | undefined,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!analysis) {
    return normalizeProductionQAIssues([issue("style_reference_analysis", "style_reference_analysis artifact 必须包含结构化分析。", "blocking")]);
  }
  if (analysis.schemaVersion !== "style-reference-analysis.v1") {
    issues.push(issue("style_reference_analysis.schemaVersion", "schemaVersion 必须是 style-reference-analysis.v1。", "blocking"));
  }
  if (!hasText(analysis.id)) issues.push(issue("style_reference_analysis.id", "缺少 id。", "blocking"));
  if (!hasText(analysis.projectId)) issues.push(issue("style_reference_analysis.projectId", "缺少 projectId。", "blocking"));
  if (!Array.isArray(analysis.sourceImageRefs) || analysis.sourceImageRefs.length === 0) {
    issues.push(issue("style_reference_analysis.sourceImageRefs", "必须记录至少一个参考图来源。", "blocking"));
  }
  for (const ref of asArray<StyleReferenceSource>(analysis.sourceImageRefs)) {
    const target = `style_reference_analysis.sourceImageRefs.${ref?.id || "unknown"}`;
    if (!hasText(ref?.id)) issues.push(issue(target, "参考图来源缺少 id。", "blocking"));
    if (!ref?.mediaUrl && !ref?.localPath && !ref?.operatorAssetId) {
      issues.push(issue(target, "参考图来源必须包含 mediaUrl、localPath 或 operatorAssetId。", "blocking"));
    }
    if (ref?.rightsStatus === "restricted") {
      issues.push(issue(target, "restricted 参考图不能进入风格锁候选。", "blocking", { retryable: false }));
    }
    if (ref?.usageIntent !== "style_only" && ref?.usageIntent !== "effect_look" && ref?.usageIntent !== "storyboard_reference") {
      issues.push(issue(target, "usageIntent 必须声明为 style_only、effect_look 或 storyboard_reference。", "blocking"));
    }
  }
  if (!hasAnyTrait(analysis.extractedTraits)) {
    issues.push(issue("style_reference_analysis.extractedTraits", "必须抽取可执行的风格特征，不能只保存原图。", "blocking"));
  }
  if (!Array.isArray(analysis.noSourceCopyBoundaries) || analysis.noSourceCopyBoundaries.length === 0) {
    issues.push(issue("style_reference_analysis.noSourceCopyBoundaries", "必须声明不复制参考图人物、场景、构图或版权元素的边界。", "blocking"));
  }
  if (typeof analysis.confidence !== "number" || analysis.confidence < 0 || analysis.confidence > 1) {
    issues.push(issue("style_reference_analysis.confidence", "confidence 必须是 0-1 之间的数字。", "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

export const validateVisualStyleLockCandidate = (
  candidate: Partial<VisualStyleLockCandidate> | undefined,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!candidate) {
    return normalizeProductionQAIssues([issue("visual_style_lock_candidate", "visual_style_lock_candidate artifact 必须包含结构化候选。", "blocking")]);
  }
  if (candidate.schemaVersion !== "visual-style-lock-candidate.v1") {
    issues.push(issue("visual_style_lock_candidate.schemaVersion", "schemaVersion 必须是 visual-style-lock-candidate.v1。", "blocking"));
  }
  if (!hasText(candidate.id)) issues.push(issue("visual_style_lock_candidate.id", "缺少 id。", "blocking"));
  if (!hasText(candidate.projectId)) issues.push(issue("visual_style_lock_candidate.projectId", "缺少 projectId。", "blocking"));
  if (!Number.isInteger(candidate.baseRevision) || Number(candidate.baseRevision) < 0) {
    issues.push(issue("visual_style_lock_candidate.baseRevision", "baseRevision 必须是必填的非负整数。", "blocking"));
  }
  if (!Array.isArray(candidate.sourceAnalysisIds) || candidate.sourceAnalysisIds.length === 0) {
    issues.push(issue("visual_style_lock_candidate.sourceAnalysisIds", "必须绑定 style_reference_analysis 来源。", "blocking"));
  }
  if (!candidate.candidateLock || typeof candidate.candidateLock !== "object") {
    issues.push(issue("visual_style_lock_candidate.candidateLock", "必须包含 candidateLock。", "blocking"));
  } else {
    issues.push(...validateAdvancedVisualStyleLock(candidate.candidateLock, "visual_style_lock_candidate.candidateLock"));
    if (candidate.candidateLock.humanApprovalState === "approved") {
      issues.push(issue("visual_style_lock_candidate.candidateLock.humanApprovalState", "候选不能直接把 candidateLock 标为 approved；批准必须通过 style_lock_change_order。", "blocking"));
    }
  }
  if (!Array.isArray(candidate.diffFromCurrentLock)) {
    issues.push(issue("visual_style_lock_candidate.diffFromCurrentLock", "必须记录与当前风格锁的差异。", "blocking"));
  }
  if (!Array.isArray(candidate.riskNotes) || candidate.riskNotes.length === 0) {
    issues.push(issue("visual_style_lock_candidate.riskNotes", "必须记录风险说明。", "blocking"));
  }
  if (!Array.isArray(candidate.fallbackRules) || candidate.fallbackRules.length === 0) {
    issues.push(issue("visual_style_lock_candidate.fallbackRules", "必须记录拒绝或失败时的回退规则。", "blocking"));
  }
  if (!["draft", "pending_review", "approved", "rejected"].includes(String(candidate.approvalState))) {
    issues.push(issue("visual_style_lock_candidate.approvalState", "approvalState 无效。", "blocking"));
  }
  if (candidate.approvalState === "approved") {
    issues.push(issue("visual_style_lock_candidate.approvalState", "候选 artifact 不应直接 approved；请创建 style_lock_change_order。", "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

export const validateStyleLockChangeOrder = (
  order: Partial<StyleLockChangeOrder> | undefined,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!order) {
    return normalizeProductionQAIssues([issue("style_lock_change_order", "style_lock_change_order artifact 必须包含结构化变更单。", "blocking")]);
  }
  if (order.schemaVersion !== "style-lock-change-order.v1") {
    issues.push(issue("style_lock_change_order.schemaVersion", "schemaVersion 必须是 style-lock-change-order.v1。", "blocking"));
  }
  if (!hasText(order.id)) issues.push(issue("style_lock_change_order.id", "缺少 id。", "blocking"));
  if (!hasText(order.projectId)) issues.push(issue("style_lock_change_order.projectId", "缺少 projectId。", "blocking"));
  if (!hasText(order.sourceCandidateId)) issues.push(issue("style_lock_change_order.sourceCandidateId", "必须绑定候选风格锁。", "blocking"));
  if (!Number.isInteger(order.baseRevision) || Number(order.baseRevision) < 0) {
    issues.push(issue("style_lock_change_order.baseRevision", "baseRevision 必须是必填的非负整数。", "blocking"));
  }
  if (!["pending_review", "approved", "rejected"].includes(String(order.approvalState))) {
    issues.push(issue("style_lock_change_order.approvalState", "approvalState 必须是 pending_review、approved 或 rejected。", "blocking"));
  }
  if (order.approvalState === "approved" && !hasText(order.approvedBy)) {
    issues.push(issue("style_lock_change_order.approvedBy", "批准风格锁变更必须记录 approvedBy。", "blocking"));
  }
  if (!order.targetStyleLock || typeof order.targetStyleLock !== "object") {
    issues.push(issue("style_lock_change_order.targetStyleLock", "必须包含 targetStyleLock。", "blocking"));
  } else {
    issues.push(...validateAdvancedVisualStyleLock(order.targetStyleLock, "style_lock_change_order.targetStyleLock"));
  }
  if (!Array.isArray(order.affectedArtifactKinds) || order.affectedArtifactKinds.length === 0) {
    issues.push(issue("style_lock_change_order.affectedArtifactKinds", "必须声明会影响的资产板、故事板、提示词或视频单元。", "blocking"));
  }
  if (!Array.isArray(order.requiredReruns) || order.requiredReruns.length === 0) {
    issues.push(issue("style_lock_change_order.requiredReruns", "必须记录建议复核的阶段；该清单不得触发自动重跑或失效。", "blocking"));
  }
  if (!hasText(order.rollbackPlan)) {
    issues.push(issue("style_lock_change_order.rollbackPlan", "必须提供 rollbackPlan。", "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

export const validateAdvancedVisualStyleLock = (
  lock: Partial<VisualStyleLock> | undefined,
  target = "visualStyleLock",
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!lock) {
    return normalizeProductionQAIssues([issue(target, "visualStyleLock 不能为空。", "blocking")]);
  }
  if (!lock.visualImplementation && !hasText(lock.renderingMode) && !hasText(lock.stylePrompt) && !asArray(lock.styleKeywords).length) {
    issues.push(issue(`${target}.styleIdentity`, "风格锁至少需要 visualImplementation 或可迁移的旧版风格身份。", "blocking"));
  }
  if (asArray(lock.styleSourceRefs).length && !asArray(lock.noSourceCopyRules).length && !asArray(lock.treatment?.constraints).length) {
    issues.push(issue(`${target}.noSourceCopyRules`, "基于参考图的风格锁必须声明 noSourceCopyRules。", "warning"));
  }
  if (lock.annotationLegend !== undefined && !Array.isArray(lock.annotationLegend)) {
    issues.push(issue(`${target}.annotationLegend`, "annotationLegend 必须是数组。", "blocking"));
  }
  for (const legend of asArray<NonNullable<VisualStyleLock["annotationLegend"]>[number]>(lock.annotationLegend)) {
    if (!hasText(legend?.id) || !hasText(legend?.marker) || !hasText(legend?.meaning)) {
      issues.push(issue(`${target}.annotationLegend`, "每个 annotationLegend 必须包含 id、marker 和 meaning。", "blocking"));
    }
  }
  if (typeof lock.analysisConfidence === "number" && (lock.analysisConfidence < 0 || lock.analysisConfidence > 1)) {
    issues.push(issue(`${target}.analysisConfidence`, "analysisConfidence 必须是 0-1 之间的数字。", "blocking"));
  }
  if (lock.humanApprovalState && !["draft", "pending_review", "approved", "rejected"].includes(lock.humanApprovalState)) {
    issues.push(issue(`${target}.humanApprovalState`, "humanApprovalState 无效。", "blocking"));
  }
  const readiness = validateVisualStyleReadiness(lock, {
    formal: lock.humanApprovalState === "approved",
  });
  for (const readinessIssue of readiness.issues) {
    issues.push(issue(
      `${target}.${readinessIssue.path}`,
      readinessIssue.message,
      readinessIssue.severity,
      { issueType: "visual_style_readiness" },
    ));
  }
  return normalizeProductionQAIssues(issues);
};

export const buildStyleReferenceSystem = () => ({
  schemaVersion: "style-reference-system.v1",
  status: "artifact_contracts_available_operator_artifact_only",
  purpose: "Allow uploaded or operator-registered reference images to be analyzed into style traits without directly mutating project.visualStyleLock.",
  artifactKinds: ["style_reference_analysis", "visual_style_lock_candidate", "style_lock_change_order"],
  sourceBoundary: [
    "reference images are style-only unless the user explicitly owns and approves their use",
    "the system may extract medium, linework, color, lighting, camera, material, composition, annotation grammar, and mood",
    "the system may not copy reference-image characters, scene layout, unique props, logos, watermarks, or exact compositions into a project",
  ],
  approvalFlow: [
    "style_reference_analysis stores extracted traits and no-source-copy boundaries",
    "visual_style_lock_candidate proposes a scoped VisualStyleLock but cannot mutate the project",
    "style_lock_change_order is required before replacing or widening project.visualStyleLock",
    "approved changes record affected asset boards, storyboard boards, prompts, and video units as review recommendations without invalidating or undoing adopted artifacts",
  ],
  qaFunctions: [
    "validateStyleReferenceAnalysis",
    "validateVisualStyleLockCandidate",
    "validateStyleLockChangeOrder",
    "validateAdvancedVisualStyleLock",
  ],
  operatorApi: {
    uploadReferenceImage: "POST /api/assets/upload",
    createAnalysisAndCandidate: "POST /api/operator/projects/:projectId/style-reference-analysis",
    createChangeOrder: "POST /api/operator/projects/:projectId/style-lock-change-orders",
    commitApprovedChangeOrder: "POST /api/operator/artifacts/:artifactId/commit",
    autoQaDefault: true,
  },
});

export const buildAdvancedVisualStyleLockSystem = () => ({
  schemaVersion: "advanced-visual-style-lock-system.v1",
  status: "extended_visual_style_lock_available",
  sourceOfTruth: "project.visualStyleLock, optionally updated through approved style_lock_change_order",
  lockedDimensions: [
    "mediumSurface",
    "linework",
    "colorPalette/allowedHex/colorTemperature",
    "lighting/lightSourceLogic/practicalLightRules",
    "cameraLanguage/lensBias/movementBias/framingBias",
    "texture/materialRendering/grain/noiseFloor",
    "compositionRules/readabilityRules/negativeSpaceRules",
    "annotationLegend/boardAnnotationPolicy",
    "assetBoardStylePolicy/storyboardStylePolicy/effectLookPolicy",
    "noSourceCopyRules/driftGuards",
  ],
  promptInjectionPolicy: {
    assetBoards: "use layout templates plus assetBoardInstruction; never let a role-board template hardcode rendering style",
    storyboardBoards: "use selected StoryboardPromptStrategy plus storyboardInstruction; storyboard style may be sketch/control oriented while inheriting project style",
    effectLooks: "use effectLookInstruction for final visual mood and rendering detail",
  },
  mutationPolicy: "AI may propose candidates; project mutation requires style_lock_change_order approval. Affected downstream artifacts receive review recommendations only and remain adopted until the user changes them.",
});
