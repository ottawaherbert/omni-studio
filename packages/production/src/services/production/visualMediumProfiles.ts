import type {
  VisualImplementationMedium,
  VisualMediumAssignment,
  VisualMediumProfileDefinition,
  VisualProductionMode,
  VisualStyleTreatmentSection,
  VisualStyleLockV3Fields,
} from "../../../../domain/src/visualStyle";
import { isVisualEntityType } from "../../../../domain/src/visualStyle";
import type { VisualArtifactIntent } from "../../../../domain/src/visualArtifact";

const specificationLabels: Record<string, string> = {
  captureProcess: "拍摄载体",
  lensBehavior: "镜头行为",
  cameraSupport: "机位支撑",
  practicalLighting: "现场光线",
  productionDesign: "实景美术",
  performanceFidelity: "表演呈现",
  effectsBoundary: "现场特效与视效边界",
  finishing: "后期完成",
  animationMethod: "动画方法",
  lineSystem: "线条系统",
  colorApplication: "上色方法",
  depthStrategy: "纵深策略",
  layoutAndBackground: "Layout 与背景制作",
  performanceAndCleanup: "角色表演与清稿一致性",
  motionCadence: "运动节奏",
  effectsAnimation: "特效动画",
  compositing: "合成方法",
  modelingLanguage: "建模语言",
  shadingModel: "着色模型",
  lightingPipeline: "灯光流程",
  riggingSystem: "绑定系统",
  animationSystem: "动画系统",
  simulationPolicy: "模拟策略",
  renderCharacter: "渲染特征",
  fabrication: "制作材料",
  setConstructionAndScale: "微缩景制作与比例管理",
  puppetConstruction: "偶形结构",
  armatureBehavior: "骨架表现",
  replacementAnimation: "替换动画",
  frameCadence: "逐格节奏",
  captureAndMotionControl: "摄影、曝光与运动控制",
  stageLighting: "棚内灯光",
  materialImperfections: "材料手作痕迹",
  rigRemovalAndCompositing: "支架清除与合成",
  compositingModel: "媒介合成模型",
  integrationRules: "媒介融合规则",
  transitionRules: "媒介转换规则",
  contactAndShadowRules: "接触与阴影规则",
};

const editorSections = (
  fields: string[],
): VisualMediumProfileDefinition["editorSections"] => [{
  id: "appearance",
  label: "外观与技法",
  fields: [
    { path: "visualImplementation.appearance.realism", label: "真实感", kind: "enum", required: true, options: ["photoreal", "naturalistic", "stylized", "graphic", "abstract"] },
    { path: "visualImplementation.appearance.dimensionality", label: "空间维度", kind: "enum", required: true, options: ["physical_capture", "flat_2d", "layered_2d", "volumetric_3d", "physical_miniature", "hybrid"] },
    { path: "visualImplementation.appearance.finish", label: "完成质感", kind: "enum", required: true, options: ["raw", "clean", "painterly", "graphic", "polished"] },
    { path: "visualImplementation.appearance.descriptors", label: "外观描述", kind: "list", required: true },
    { path: "visualImplementation.techniques", label: "制作技法", kind: "list", required: true },
  ],
}, {
  id: "medium-specification",
  label: "媒介专属规范",
  fields: fields.map((field) => ({
    path: `visualImplementation.specification.${field}`,
    label: specificationLabels[field] || field,
    kind: field === "captureProcess" || field === "animationMethod" ? "enum" : "list",
    required: true,
    ...(field === "captureProcess" ? { options: ["digital", "film", "hybrid"] } : {}),
    ...(field === "animationMethod" ? { options: ["hand_drawn", "rigged", "hybrid"] } : {}),
  })),
}];

const sharedTreatmentRequirements: VisualStyleTreatmentSection[] = [
  "directives", "color", "lighting", "movement", "composition", "readability", "constraints",
];

const treatmentRequirements = (
  ...additional: VisualStyleTreatmentSection[]
): VisualStyleTreatmentSection[] => Array.from(new Set([...sharedTreatmentRequirements, ...additional]));

const profileSeeds: Array<Omit<VisualMediumProfileDefinition, "editorSections">> = [
  {
    id: "visual-medium.live-action",
    version: "1.1.0",
    productionMode: "live_action",
    seed: {
      productionMode: "live_action",
      appearance: { realism: "unspecified", dimensionality: "physical_capture", finish: "unspecified", descriptors: [] },
      techniques: ["practical_capture"],
      specification: {
        kind: "live_action",
        captureProcess: "unspecified",
        lensBehavior: [],
        cameraSupport: [],
        practicalLighting: [],
        productionDesign: [],
        performanceFidelity: [],
        effectsBoundary: [],
        finishing: [],
      },
    },
    requiredSpecificationFields: [
      "captureProcess", "lensBehavior", "cameraSupport", "practicalLighting",
      "productionDesign", "performanceFidelity", "effectsBoundary", "finishing",
    ],
    requiredTreatmentSections: treatmentRequirements("camera", "materials"),
    neutralDirectives: ["Preserve physically coherent capture, lighting, materials, performance, and the declared practical-effects/VFX boundary."],
  },
  {
    id: "visual-medium.2d-animation",
    version: "1.2.0",
    productionMode: "2d_animation",
    seed: {
      productionMode: "2d_animation",
      appearance: { realism: "unspecified", dimensionality: "flat_2d", finish: "unspecified", descriptors: [] },
      techniques: ["drawn_2d"],
      specification: {
        kind: "2d_animation",
        animationMethod: "unspecified",
        lineSystem: [],
        colorApplication: [],
        depthStrategy: [],
        layoutAndBackground: [],
        performanceAndCleanup: [],
        motionCadence: [],
        effectsAnimation: [],
        compositing: [],
      },
    },
    requiredSpecificationFields: [
      "animationMethod", "lineSystem", "colorApplication", "depthStrategy", "layoutAndBackground",
      "performanceAndCleanup", "motionCadence", "effectsAnimation", "compositing",
    ],
    requiredTreatmentSections: treatmentRequirements("palette", "linework"),
    neutralDirectives: ["Keep drawing, color application, layout/background production, character performance, deformation/off-model limits, key/in-between/cleanup consistency, effects animation, depth treatment, and motion cadence internally consistent."],
  },
  {
    id: "visual-medium.3d-animation",
    version: "1.1.0",
    productionMode: "3d_animation",
    seed: {
      productionMode: "3d_animation",
      appearance: { realism: "unspecified", dimensionality: "volumetric_3d", finish: "unspecified", descriptors: [] },
      techniques: ["modeled_3d"],
      specification: {
        kind: "3d_animation",
        modelingLanguage: [],
        shadingModel: [],
        lightingPipeline: [],
        riggingSystem: [],
        animationSystem: [],
        simulationPolicy: [],
        renderCharacter: [],
        compositing: [],
      },
    },
    requiredSpecificationFields: [
      "modelingLanguage", "shadingModel", "lightingPipeline", "riggingSystem", "animationSystem",
      "simulationPolicy", "renderCharacter", "compositing",
    ],
    requiredTreatmentSections: treatmentRequirements("camera", "materials"),
    neutralDirectives: ["Keep modeling, rigging, animation, shading, lighting, simulation, and compositing decisions internally consistent."],
  },
  {
    id: "visual-medium.stop-motion",
    version: "1.2.0",
    productionMode: "stop_motion",
    seed: {
      productionMode: "stop_motion",
      appearance: { realism: "unspecified", dimensionality: "physical_miniature", finish: "unspecified", descriptors: [] },
      techniques: ["frame_by_frame_capture"],
      specification: {
        kind: "stop_motion",
        fabrication: [],
        setConstructionAndScale: [],
        puppetConstruction: [],
        armatureBehavior: [],
        replacementAnimation: [],
        frameCadence: [],
        captureAndMotionControl: [],
        stageLighting: [],
        materialImperfections: [],
        rigRemovalAndCompositing: [],
      },
    },
    requiredSpecificationFields: [
      "fabrication", "setConstructionAndScale", "puppetConstruction", "armatureBehavior", "replacementAnimation",
      "frameCadence", "captureAndMotionControl", "stageLighting", "materialImperfections", "rigRemovalAndCompositing",
    ],
    requiredTreatmentSections: treatmentRequirements("camera", "materials", "surface"),
    neutralDirectives: ["Preserve fabrication and scale, frame cadence, camera/exposure/motion control, stage lighting, intentional material behavior, and the declared rig-removal/compositing approach."],
  },
  {
    id: "visual-medium.mixed-media",
    version: "1.0.0",
    productionMode: "mixed_media",
    seed: {
      productionMode: "mixed_media",
      appearance: { realism: "unspecified", dimensionality: "hybrid", finish: "unspecified", descriptors: [] },
      techniques: ["layered_compositing"],
      specification: {
        kind: "mixed_media",
        compositingModel: [],
        integrationRules: [],
        transitionRules: [],
        contactAndShadowRules: [],
      },
    },
    requiredSpecificationFields: ["compositingModel", "integrationRules", "transitionRules", "contactAndShadowRules"],
    requiredTreatmentSections: treatmentRequirements("readability"),
    neutralDirectives: ["Resolve each declared medium assignment before applying shared compositing and contact rules."],
  },
];

const profiles: VisualMediumProfileDefinition[] = profileSeeds.map((profile) => ({
  ...profile,
  editorSections: editorSections(profile.requiredSpecificationFields),
}));

const clone = <T>(value: T): T => structuredClone(value);

export const listVisualMediumProfiles = (): VisualMediumProfileDefinition[] => clone(profiles);

export const getVisualMediumProfile = (
  productionMode: VisualProductionMode,
): VisualMediumProfileDefinition => {
  const profile = profiles.find((entry) => entry.productionMode === productionMode);
  if (!profile) throw new Error(`Unknown visual production mode: ${productionMode}`);
  return clone(profile);
};

export const createNeutralVisualImplementation = <Mode extends VisualProductionMode>(
  productionMode: Mode,
): Extract<VisualImplementationMedium, { productionMode: Mode }> => (
  getVisualMediumProfile(productionMode).seed as Extract<VisualImplementationMedium, { productionMode: Mode }>
);

export const visualSpecificationMatchesMode = (
  implementation: VisualImplementationMedium,
) => implementation.specification.kind === implementation.productionMode;

export interface VisualStyleReadinessIssue {
  severity: "warning" | "blocking";
  code: string;
  path: string;
  label: string;
  message: string;
}

const meaningful = (value: unknown) => {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" && Boolean(item.trim()));
  if (typeof value === "string") return Boolean(value.trim() && value !== "unspecified");
  return value !== undefined && value !== null;
};

const meaningfulTextList = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => typeof item === "string" && item.trim().length > 0);

const profileField = (profile: VisualMediumProfileDefinition, path: string) => profile.editorSections
  .flatMap((section) => section.fields)
  .find((field) => field.path === path);

const recordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const assignmentModes = new Set<VisualProductionMode>([
  "live_action", "2d_animation", "3d_animation", "stop_motion", "mixed_media",
]);

const isReadinessSafeAssignment = (value: unknown): value is VisualMediumAssignment => {
  if (!recordValue(value) || typeof value.id !== "string") return false;
  if (!["base", "embedded", "overlay", "effect"].includes(String(value.compositingRole))) return false;
  const target = value.target;
  if (!recordValue(target)) return false;
  if (target.scope === "entity") {
    if (!isVisualEntityType(target.entityType)) return false;
    if (typeof target.entityId !== "string") return false;
  } else if (target.scope === "layer") {
    if (typeof target.layerId !== "string") return false;
    if (typeof target.label !== "string" || typeof target.description !== "string") return false;
  } else if (target.scope !== "whole") {
    return false;
  }
  const implementation = value.implementation;
  if (!recordValue(implementation) || !assignmentModes.has(implementation.productionMode as VisualProductionMode)) return false;
  if (implementation.appearance !== undefined && !recordValue(implementation.appearance)) return false;
  if (implementation.techniques !== undefined && !Array.isArray(implementation.techniques)) return false;
  if (implementation.specification !== undefined && !recordValue(implementation.specification)) return false;
  return true;
};

export const validateVisualImplementationReadiness = (
  implementation: VisualImplementationMedium | undefined,
  options: { formal?: boolean } = {},
): VisualStyleReadinessIssue[] => {
  const severity = options.formal ? "blocking" as const : "warning" as const;
  if (!implementation) return [{
    severity,
    code: "VISUAL_IMPLEMENTATION_MISSING",
    path: "visualImplementation",
    label: "视觉实现媒介",
    message: "Choose a visual production medium before formal visual generation.",
  }];
  const issues: VisualStyleReadinessIssue[] = [];
  const rawImplementation = implementation as unknown as Record<string, unknown>;
  if (!assignmentModes.has(rawImplementation.productionMode as VisualProductionMode)) return [{
    severity: "blocking",
    code: "VISUAL_PRODUCTION_MODE_INVALID",
    path: "visualImplementation.productionMode",
    label: "视觉实现媒介",
    message: "Visual implementation productionMode is not supported.",
  }];
  const productionMode = rawImplementation.productionMode as VisualProductionMode;
  const profile = getVisualMediumProfile(productionMode);
  const shapeChecks = [
    { field: "appearance", valid: recordValue(rawImplementation.appearance) },
    { field: "techniques", valid: Array.isArray(rawImplementation.techniques) },
    { field: "specification", valid: recordValue(rawImplementation.specification) },
  ] as const;
  if (shapeChecks.some((check) => !check.valid)) {
    for (const check of shapeChecks) {
      if (!check.valid) issues.push({
        severity,
        code: "VISUAL_IMPLEMENTATION_FIELD_MISSING",
        path: `visualImplementation.${check.field}`,
        label: check.field,
        message: `Visual implementation is missing or has an invalid required field ${check.field}.`,
      });
    }
    return issues;
  }
  if (!visualSpecificationMatchesMode(implementation)) issues.push({
    severity: "blocking",
    code: "VISUAL_SPECIFICATION_MODE_MISMATCH",
    path: "visualImplementation.specification.kind",
    label: "媒介专属规范",
    message: "The medium-specific specification does not match productionMode.",
  });
  if (options.formal) {
    for (const field of ["realism", "dimensionality", "finish"] as const) {
      const value = implementation.appearance[field];
      const definition = profileField(profile, `visualImplementation.appearance.${field}`);
      if (!meaningful(value)) issues.push({
        severity,
        code: "VISUAL_APPEARANCE_VALUE_MISSING",
        path: `visualImplementation.appearance.${field}`,
        label: field,
        message: `Approved visual style requires a concrete appearance value for ${field}.`,
      });
      else if (definition?.options && !definition.options.includes(value)) issues.push({
        severity: "blocking",
        code: "VISUAL_APPEARANCE_VALUE_INVALID",
        path: `visualImplementation.appearance.${field}`,
        label: field,
        message: `Approved visual style contains an unsupported appearance value for ${field}.`,
      });
    }
    if (!meaningfulTextList(implementation.appearance.descriptors)) issues.push({
      severity,
      code: "VISUAL_APPEARANCE_VALUE_MISSING",
      path: "visualImplementation.appearance.descriptors",
      label: "descriptors",
      message: "Approved visual style requires at least one non-empty appearance descriptor.",
    });
    if (!meaningfulTextList(implementation.techniques)) issues.push({
      severity,
      code: "VISUAL_TECHNIQUES_MISSING",
      path: "visualImplementation.techniques",
      label: "制作技法",
      message: "Approved visual style requires at least one non-empty declared technique.",
    });
    const specification = implementation.specification as unknown as Record<string, unknown>;
    for (const field of profile.requiredSpecificationFields) {
      const value = specification[field];
      const definition = profileField(profile, `visualImplementation.specification.${field}`);
      const missing = definition?.kind === "list" ? !meaningfulTextList(value) : !meaningful(value);
      if (missing) issues.push({
        severity,
        code: "VISUAL_SPECIFICATION_VALUE_MISSING",
        path: `visualImplementation.specification.${field}`,
        label: specificationLabels[field] || field,
        message: `Approved ${implementation.productionMode} style requires ${field}.`,
      });
      else if (definition?.kind === "enum" && definition.options && (
        typeof value !== "string" || !definition.options.includes(value)
      )) issues.push({
        severity: "blocking",
        code: "VISUAL_SPECIFICATION_VALUE_INVALID",
        path: `visualImplementation.specification.${field}`,
        label: specificationLabels[field] || field,
        message: `Approved ${implementation.productionMode} style contains an unsupported value for ${field}.`,
      });
      else if (definition?.kind === "list" && !Array.isArray(value)) issues.push({
        severity: "blocking",
        code: "VISUAL_SPECIFICATION_VALUE_INVALID",
        path: `visualImplementation.specification.${field}`,
        label: specificationLabels[field] || field,
        message: `Approved ${implementation.productionMode} style requires ${field} to be a list.`,
      });
    }
  }
  return issues;
};

export const validateVisualStyleLockReadiness = (
  lock: VisualStyleLockV3Fields & { humanApprovalState?: string },
  options: { formal?: boolean } = {},
): VisualStyleReadinessIssue[] => {
  const formal = options.formal ?? lock.humanApprovalState === "approved";
  const issues = validateVisualImplementationReadiness(lock.visualImplementation, { formal });
  const rawAssignments = lock.mediumAssignments as unknown;
  const assignments: VisualMediumAssignment[] = [];
  if (rawAssignments !== undefined && !Array.isArray(rawAssignments)) {
    issues.push({
      severity: "blocking",
      code: "MALFORMED_MEDIUM_ASSIGNMENTS",
      path: "mediumAssignments",
      label: "媒介分配",
      message: "mediumAssignments must be an array before the visual style can be used.",
    });
  } else if (Array.isArray(rawAssignments)) {
    rawAssignments.forEach((assignment, index) => {
      if (isReadinessSafeAssignment(assignment)) assignments.push(assignment);
      else issues.push({
        severity: "blocking",
        code: "MALFORMED_MEDIUM_ASSIGNMENT",
        path: `mediumAssignments.${index}`,
        label: "媒介分配",
        message: `Mixed-media assignment ${index + 1} is structurally invalid and cannot be used.`,
      });
    });
  }
  if (formal && lock.visualImplementation?.productionMode !== "mixed_media" && assignments.length) {
    issues.push({
      severity: "blocking",
      code: "MEDIUM_ASSIGNMENTS_REQUIRE_MIXED_MEDIA",
      path: "mediumAssignments",
      label: "媒介分配",
      message: "Whole, entity, and layer medium assignments are only valid when the project production mode is mixed_media.",
    });
  }
  if (formal && lock.visualImplementation?.productionMode === "mixed_media" && !assignments.length) {
    issues.push({
      severity: "blocking",
      code: "MIXED_MEDIA_ASSIGNMENTS_MISSING",
      path: "mediumAssignments",
      label: "混合媒介分配",
      message: "Approved mixed-media style requires at least one explicit whole, entity, or layer assignment.",
    });
  }
  if (formal && lock.visualImplementation?.productionMode === "mixed_media" && assignments.length) {
    const seenIds = new Set<string>();
    const seenPrecedence = new Set<string>();
    const baseAssignments = assignments.filter((assignment) => assignment.compositingRole === "base");
    if (baseAssignments.length !== 1) issues.push({
      severity: "blocking",
      code: "MIXED_MEDIA_BASE_ASSIGNMENT_INVALID",
      path: "mediumAssignments",
      label: "混合媒介基础层",
      message: "Approved mixed-media style requires exactly one base assignment.",
    });
    if (baseAssignments.length === 1 && baseAssignments[0].target.scope !== "whole") issues.push({
      severity: "blocking",
      code: "MIXED_MEDIA_BASE_ASSIGNMENT_MUST_TARGET_WHOLE",
      path: "mediumAssignments",
      label: "混合媒介基础层",
      message: "The single base assignment must target the whole composition so every artifact resolves to a concrete medium.",
    });
    for (const [index, assignment] of assignments.entries()) {
      const assignmentId = typeof assignment.id === "string" ? assignment.id.trim() : "";
      const assignmentPath = `mediumAssignments.${assignmentId || index}`;
      if (!assignmentId) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_ID_MISSING",
        path: `${assignmentPath}.id`,
        label: "媒介分配 ID",
        message: "Each mixed-media assignment requires a non-empty id.",
      });
      if (assignmentId && seenIds.has(assignmentId)) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_ID_DUPLICATE",
        path: assignmentPath,
        label: "媒介分配 ID",
        message: `Mixed-media assignment id ${assignmentId} is duplicated.`,
      });
      if (assignmentId) seenIds.add(assignmentId);
      if (assignment.target.scope === "entity" && !assignment.target.entityId.trim()) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_ENTITY_ID_MISSING",
        path: `${assignmentPath}.target.entityId`,
        label: "实体目标",
        message: "An entity assignment requires a non-empty entityId.",
      });
      if (assignment.target.scope === "layer" && !assignment.target.layerId.trim()) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_LAYER_ID_MISSING",
        path: `${assignmentPath}.target.layerId`,
        label: "图层目标",
        message: "A layer assignment requires a non-empty layerId.",
      });
      if (assignment.target.scope === "layer" && !assignment.target.label.trim()) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_LAYER_LABEL_MISSING",
        path: `${assignmentPath}.target.label`,
        label: "图层名称",
        message: "A layer assignment requires a human-readable label.",
      });
      if (assignment.target.scope === "layer" && !assignment.target.description.trim()) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_LAYER_DESCRIPTION_MISSING",
        path: `${assignmentPath}.target.description`,
        label: "图层职责",
        message: "A layer assignment requires a description of the visible content it owns.",
      });
      if (assignment.priority !== undefined && !Number.isFinite(assignment.priority)) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_PRIORITY_INVALID",
        path: `${assignmentPath}.priority`,
        label: "媒介分配优先级",
        message: "Mixed-media assignment priority must be a finite number.",
      });
      const targetKey = assignment.target.scope === "whole"
        ? "whole"
        : assignment.target.scope === "layer"
          ? `layer:${assignment.target.layerId}`
          : `entity:${assignment.target.entityType}:${assignment.target.entityId}`;
      const precedenceKey = `${targetKey}:priority:${assignment.priority ?? 0}`;
      if (seenPrecedence.has(precedenceKey)) issues.push({
        severity: "blocking",
        code: "MIXED_MEDIA_ASSIGNMENT_TARGET_CONFLICT",
        path: `${assignmentPath}.target`,
        label: "媒介分配目标",
        message: `Multiple mixed-media assignments claim ${targetKey} at the same priority.`,
      });
      seenPrecedence.add(precedenceKey);
      const assignmentImplementation = assignment.implementation as VisualImplementationMedium;
      if (assignmentImplementation.productionMode === "mixed_media") {
        issues.push({
          severity: "blocking",
          code: "MIXED_MEDIA_ASSIGNMENT_NESTED_MIXED",
          path: `${assignmentPath}.implementation.productionMode`,
          label: "媒介分配实现",
          message: "A mixed-media assignment must resolve to one concrete production medium.",
        });
      } else {
        issues.push(...validateVisualImplementationReadiness(assignmentImplementation, { formal: true }).map((issue) => ({
          ...issue,
          path: `${assignmentPath}.${issue.path}`,
          label: `${assignmentId || index}: ${issue.label}`,
        })));
      }
    }
  }
  if (formal && lock.sourceReview?.status === "review_recommended") issues.push({
    severity: "warning",
    code: "VISUAL_SOURCE_REVIEW_PENDING",
    path: "sourceReview",
    label: "上游来源复核",
    message: "Upstream visual source changes require review before this lock is considered current.",
  });
  if (formal && lock.visualImplementation) {
    const profile = getVisualMediumProfile(lock.visualImplementation.productionMode);
    for (const section of profile.requiredTreatmentSections) {
      if (!meaningful(lock.treatment?.[section])) issues.push({
        severity: "blocking",
        code: "VISUAL_TREATMENT_SECTION_MISSING",
        path: `treatment.${section}`,
        label: specificationLabels[section] || section,
        message: `Approved ${lock.visualImplementation.productionMode} style requires a concrete ${section} treatment rule.`,
      });
    }
  }
  return issues;
};

export interface VisualStyleReadinessResult {
  ready: boolean;
  missingFields: Array<{ path: string; label: string }>;
  issues: VisualStyleReadinessIssue[];
}

export const validateVisualStyleReadiness = (
  lock: VisualStyleLockV3Fields & { humanApprovalState?: string },
  options: { formal?: boolean } = {},
): VisualStyleReadinessResult => {
  const formal = options.formal ?? lock.humanApprovalState === "approved";
  const issues = validateVisualStyleLockReadiness(lock, { formal });
  if (formal) {
    const requiredLockFields: Array<{ path: string; label: string; value: unknown }> = [
      { path: "schemaVersion", label: "风格锁结构版本", value: lock.schemaVersion },
      { path: "revision", label: "风格锁修订号", value: lock.revision },
      { path: "contentHash", label: "风格锁内容哈希", value: lock.contentHash },
      { path: "treatment", label: "视觉处理规范", value: lock.treatment },
      { path: "mediumAssignments", label: "媒介分配", value: lock.mediumAssignments },
      { path: "sourceReview", label: "上游来源复核", value: lock.sourceReview },
    ];
    for (const field of requiredLockFields) {
      if (!field.value) issues.push({
        severity: "blocking",
        code: "VISUAL_STYLE_LOCK_FIELD_MISSING",
        path: field.path,
        label: field.label,
        message: `Approved visual style lock is missing ${field.path}.`,
      });
    }
  }
  const missingFields = Array.from(new Map(issues
    .filter((issue) => issue.code.includes("MISSING"))
    .map((issue) => [issue.path, { path: issue.path, label: issue.label }])).values());
  return {
    ready: !issues.some((issue) => issue.severity === "blocking"),
    missingFields,
    issues,
  };
};

const formalVisualArtifactIntents = new Set<VisualArtifactIntent>([
  "asset_identity",
  "asset_state",
  "final_frame",
  "image_edit",
  "video_clip",
]);

export const visualArtifactRequiresApprovedStyle = (intent: VisualArtifactIntent) => (
  formalVisualArtifactIntents.has(intent)
);

export const assertVisualStyleReadyForExecution = (
  lock: (VisualStyleLockV3Fields & { humanApprovalState?: string }) | undefined,
  intent: VisualArtifactIntent,
) => {
  if (!visualArtifactRequiresApprovedStyle(intent)) return;
  if (!lock || lock.humanApprovalState === "rejected") return;
  const readiness = validateVisualStyleReadiness(lock, { formal: false });
  if (readiness.ready) return;
  const labels = Array.from(new Set(readiness.issues
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => issue.label)
    .filter(Boolean)))
    .slice(0, 6);
  throw new Error(`当前视觉设定包含无法使用的数据${labels.length ? `：${labels.join("、")}` : ""}，请修改这些字段后重试。`);
};
