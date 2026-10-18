import {
  composePromptBlocks,
  type PromptCompositionManifest,
} from "./promptComposition";
import type {
  VisualArtifactIntent,
  VisualCompileManifest,
  VisualProjectionTargetSelection,
  VisualRecipeRequiredInput,
  VisualRecipeRuntimeContract,
  VisualRecipeRuntimeEnforcement,
  VisualRecipeRuntimeEvidence,
} from "../../../packages/domain/src/visualArtifact";
import {
  assertVisualRecipeRuntimeContractReady,
  attachVisualRecipeContractToManifest,
  evaluateVisualRecipeRuntimeContract,
  getVisualTaskRecipeForIntent,
  type VisualRecipeRuntimeEvidenceMap,
} from "../../../packages/production/src/services/production/visualTaskRecipes";

export type ImageReferenceRole =
  | "character_identity"
  | "wardrobe_state"
  | "location_design"
  | "prop_design"
  | "vehicle_design"
  | "composition_anchor"
  | "continuity_frame"
  | "style_reference"
  | "source_edit"
  | "previous_output_repair";

export interface ImageGenerationReference {
  imageUrl: string;
  label: string;
  role: ImageReferenceRole;
  preserve: string[];
  allowChange: string[];
  exclude: string[];
}

export type ImageGenerationOperation =
  | { kind: "generate" }
  | {
      kind: "edit";
      goal: string;
      change: string[];
      preserve?: string[];
      fill?: string[];
      exclude?: string[];
    }
  | {
      kind: "texture_repair";
      goal: string;
      surfaces: string[];
      preserve?: string[];
      exclude?: string[];
    }
  | {
      kind: "location_view_change";
      goal: string;
      newArrangement: string[];
      preserve?: string[];
      exclude?: string[];
    };

export interface PreviousOutputRepairOperationInput {
  goal: string;
  issues: string[];
  preserve: string[];
  exclude: string[];
  fill?: string[];
}

export const createPreviousOutputRepairOperation = ({
  goal,
  issues,
  preserve,
  exclude,
  fill,
}: PreviousOutputRepairOperationInput): Extract<ImageGenerationOperation, { kind: "edit" }> => {
  const cleanItems = (items: string[], field: string) => {
    if (!Array.isArray(items) || items.some((item) => typeof item !== "string")) {
      throw new Error(`上一版图片返修的 ${field} 必须是字符串数组。`);
    }
    return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
  };
  const resolvedGoal = goal.trim();
  const change = cleanItems(issues, "issues");
  const resolvedPreserve = cleanItems(preserve, "preserve");
  const resolvedExclude = cleanItems(exclude, "exclude");
  const resolvedFill = cleanItems(fill || [], "fill");
  if (!resolvedGoal) throw new Error("上一版图片返修必须声明 goal。");
  if (!change.length) throw new Error("上一版图片返修必须提供明确的 repair issues。");
  if (!resolvedPreserve.length || !resolvedExclude.length) {
    throw new Error("上一版图片返修必须同时声明完整的 preserve 与 exclude 合同。");
  }
  return {
    kind: "edit",
    goal: resolvedGoal,
    change,
    preserve: resolvedPreserve,
    exclude: resolvedExclude,
    ...(resolvedFill.length ? { fill: resolvedFill } : {}),
  };
};

export interface ImageVisualStyleProjection {
  styleReferences?: ImageGenerationReference[];
  artifactIntent: VisualArtifactIntent;
  recipeId: string;
  recipeVersion: string;
  instruction: string;
  sourceRevision?: string;
  sourceHash?: string;
  includedPaths?: string[];
  suppressedPaths?: string[];
  /** Structured audit only; target ids are never rendered into the provider prompt. */
  targetSelection?: VisualProjectionTargetSelection;
  compileManifest?: VisualCompileManifest;
}

export interface ImageVisibleTextDirective {
  /** The exact glyph sequence that may appear in the generated image. */
  text: string;
  placement: string;
  treatment?: string;
  language?: string;
}

export type ImageGenerationAspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";

export interface ImageGenerationRequest {
  promptCore: string;
  aspectRatio?: ImageGenerationAspectRatio;
  references?: ImageGenerationReference[];
  outputConstraints?: string[];
  operation?: ImageGenerationOperation;
  visualStyleProjection?: ImageVisualStyleProjection;
  /** Optional richer evidence supplied by an artifact-specific builder. */
  visualRecipeInputEvidence?: Partial<Record<VisualRecipeRequiredInput, VisualRecipeRuntimeEvidence[]>>;
  visibleText?: ImageVisibleTextDirective[];
}

export interface CompileImageGenerationRequestOptions {
  /** Draft compilation reports gaps; the provider boundary uses formal. */
  enforcement?: VisualRecipeRuntimeEnforcement;
}

export interface CompiledImageGenerationRequest {
  providerPrompt: string;
  aspectRatio: ImageGenerationAspectRatio;
  referenceImages: string[];
  references: ImageGenerationReference[];
  outputConstraints: string[];
  operation: ImageGenerationOperation;
  visualStyleProjection?: ImageVisualStyleProjection;
  visualRecipeContract?: VisualRecipeRuntimeContract;
  visibleText: ImageVisibleTextDirective[];
  manifest: PromptCompositionManifest;
}

export const openAIImageSizeForAspectRatio = (
  aspectRatio: ImageGenerationAspectRatio,
): "1024x1024" | "1024x1536" | "1536x1024" => {
  if (aspectRatio === "1:1") return "1024x1024";
  if (aspectRatio === "3:4" || aspectRatio === "9:16") return "1024x1536";
  return "1536x1024";
};

export const doubaoImageSizeForAspectRatio = (
  aspectRatio: ImageGenerationAspectRatio,
): string => {
  if (aspectRatio === "1:1") return "2048x2048";
  if (aspectRatio === "3:4") return "1536x2048";
  if (aspectRatio === "4:3") return "2048x1536";
  if (aspectRatio === "9:16") return "1152x2048";
  return "2048x1152";
};

export const comfyUIImageDimensionsForAspectRatio = (
  aspectRatio: ImageGenerationAspectRatio,
): { width: number; height: number } => {
  if (aspectRatio === "1:1") return { width: 1024, height: 1024 };
  if (aspectRatio === "3:4") return { width: 768, height: 1024 };
  if (aspectRatio === "4:3") return { width: 1024, height: 768 };
  if (aspectRatio === "9:16") return { width: 576, height: 1024 };
  return { width: 1024, height: 576 };
};

const roleLabels: Record<ImageReferenceRole, string> = {
  character_identity: "角色身份",
  wardrobe_state: "服装与造型状态",
  location_design: "场景空间与材质",
  prop_design: "道具几何与材质",
  vehicle_design: "交通工具结构与方位",
  composition_anchor: "构图与空间锚点",
  continuity_frame: "连续性承接画面",
  style_reference: "视觉风格参考",
  source_edit: "待编辑源图",
  previous_output_repair: "上一版待修复结果",
};

const roleDefaults: Record<ImageReferenceRole, Pick<ImageGenerationReference, "preserve" | "allowChange" | "exclude">> = {
  character_identity: {
    preserve: ["可识别的脸型、五官比例、发型和人物身份", "参考图中已确认的服装颜色与关键配饰"],
    allowChange: ["符合本镜头的姿态、表情、视线、构图和光照"],
    exclude: ["参考图背景、文字、排版和与本镜头无关的姿态"],
  },
  wardrobe_state: {
    preserve: ["服装款式、颜色、纹理、层次和关键配饰", "人物可识别身份"],
    allowChange: ["姿态、表情、镜头角度和光照"],
    exclude: ["其他服装版本、错误颜色和参考图背景"],
  },
  location_design: {
    preserve: ["场景布局、建筑结构、固定陈设、主材质和色彩关系"],
    allowChange: ["符合镜头的机位、景别、人物调度、天气和光照"],
    exclude: ["参考图中的临时人物、文字、标注和无关物体"],
  },
  prop_design: {
    preserve: ["道具轮廓、比例、结构、材质、颜色和可识别细节"],
    allowChange: ["持握方式、朝向、透视、磨损状态和光照"],
    exclude: ["参考图背景、展示支架、文字和额外道具"],
  },
  vehicle_design: {
    preserve: ["交通工具轮廓、结构、比例、左右方位、出入口和资产描述指定的专有构造"],
    allowChange: ["符合镜头的机位、天气、光照和损坏状态"],
    exclude: ["参考板文字、排版、额外交通工具及无依据的新结构"],
  },
  composition_anchor: {
    preserve: ["主体数量、相对位置、镜头轴线、景别和空间层次"],
    allowChange: ["用正式资产替换占位外观，并按任务调整表情、材质和光照"],
    exclude: ["占位人物身份、辅助线、坐标、UI、文字和标注"],
  },
  continuity_frame: {
    preserve: ["承接所需的人物位置、朝向、视线、动作阶段和环境连续性"],
    allowChange: ["推进到本镜头规定的新动作、机位和表情"],
    exclude: ["上一镜头独有且本镜头未要求的构图和瞬时动作"],
  },
  style_reference: {
    preserve: ["媒介质感、色彩逻辑、对比度、材质表现和光影语言"],
    allowChange: ["主体、场景、构图和叙事内容"],
    exclude: ["原图人物身份、具体物件、文字和可复制构图"],
  },
  source_edit: {
    preserve: ["未被任务明确要求修改的主体身份、结构、材质、精确颜色和关键细节"],
    allowChange: ["仅修改提示词明确要求变化的内容"],
    exclude: ["新增文字、UI、水印和任务未要求的新主体"],
  },
  previous_output_repair: {
    preserve: ["上一版已经正确的主体身份、布局、材质、精确颜色和连续性"],
    allowChange: ["仅修复提示词点名的问题"],
    exclude: ["重复上一版已识别的错误、文字、UI和水印"],
  },
};

export const createImageGenerationReference = (
  input: Pick<ImageGenerationReference, "imageUrl" | "label" | "role"> & Partial<Pick<ImageGenerationReference, "preserve" | "allowChange" | "exclude">>,
): ImageGenerationReference => {
  const defaults = roleDefaults[input.role];
  return {
    imageUrl: input.imageUrl.trim(),
    label: input.label.trim(),
    role: input.role,
    preserve: (input.preserve?.length ? input.preserve : defaults.preserve).map((item) => item.trim()).filter(Boolean),
    allowChange: (input.allowChange?.length ? input.allowChange : defaults.allowChange).map((item) => item.trim()).filter(Boolean),
    exclude: (input.exclude?.length ? input.exclude : defaults.exclude).map((item) => item.trim()).filter(Boolean),
  };
};

export const createCanonicalAssetGenerationReference = ({
  imageUrl,
  label,
  assetType,
  stateChange = false,
}: {
  imageUrl: string;
  label: string;
  assetType: "character" | "location" | "prop" | "vehicles";
  stateChange?: boolean;
}): ImageGenerationReference => createImageGenerationReference({
  imageUrl,
  label,
  role: assetType === "character"
    ? "character_identity"
    : assetType === "location"
      ? "location_design"
      : assetType === "vehicles"
        ? "vehicle_design"
      : "prop_design",
  preserve: [
    "主体可识别身份、基础结构、比例、关键材质与目标状态未声明改变的细节",
    "已确认的空间拓扑或物件构造关系",
  ],
  allowChange: [
    stateChange
      ? "只按本次目标声明改变状态、服化、损耗、视角与展示姿态"
      : "按本次生成任务改变视角、展示姿态、构图与照明",
  ],
  exclude: [
    "参考图背景、排版、文字、UI、水印与无关主体",
    "本次任务未要求继承的旧状态或临时展示内容",
  ],
});

const platformParameterPattern = /(^|\s)--(?:ar|aspect|v|q|quality|stylize|style|seed|chaos)(?:\s|=|$)/i;
const irrelevantImageMetadataPattern = /(?:\bMBTI\b|九型人格|心理画像|psychological\s+profile|数据库\s*(?:ID|编号)|\bDB\s*ID\b|\b(?:prompt|source|state)?hash\b|审计清单|生产状态)/i;
const opaqueIdentifierPattern = /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\bc[a-z0-9]{20,}\b|\b(?:shot|scene|asset|character|char|location|prop)[_-][a-z0-9_-]{8,}\b)/i;
const embeddedMediaLocationPattern = /(?:https?:\/\/|data:image\/|blob:)/i;
const embeddedAspectRatioPattern = /(?:^|[^\d])(?:1:1|2:3|3:2|3:4|4:3|9:16|16:9|21:9)(?:[^\d]|$)/i;
const portraitFramingPattern = /(?:竖屏|竖幅|纵向构图|portrait\s+(?:orientation|framing)|vertical\s+(?:orientation|frame|framing))/i;
const landscapeFramingPattern = /(?:横屏|横幅|横向构图|landscape\s+(?:orientation|framing)|horizontal\s+(?:orientation|frame|framing))/i;
const supportedAspectRatios = new Set<ImageGenerationAspectRatio>(["1:1", "3:4", "4:3", "9:16", "16:9"]);

export const imagePromptHasEmbeddedAspectRatio = (value: string) => embeddedAspectRatioPattern.test(value);

const assertPromptCoreRelevant = (promptCore: string, aspectRatio: ImageGenerationAspectRatio) => {
  if (irrelevantImageMetadataPattern.test(promptCore)) {
    throw new Error("图片执行提示词含有心理档案、数据库/哈希、审计或生产状态等非画面元数据；请在发送前投影为可见动作与视觉事实。");
  }
  if (opaqueIdentifierPattern.test(promptCore)) {
    throw new Error("图片执行提示词含有数据库实体 ID；请改用人物、场景或道具的可读名称。");
  }
  if (embeddedMediaLocationPattern.test(promptCore)) {
    throw new Error("图片执行提示词含有媒体 URL；请通过结构化 references 传递参考图，不要把地址写进提示词。");
  }
  if (imagePromptHasEmbeddedAspectRatio(promptCore)) {
    throw new Error("图片执行提示词含有画幅比例文本；请删除该描述，并只通过结构化 aspectRatio 传递画幅。");
  }
  const portrait = aspectRatio === "3:4" || aspectRatio === "9:16";
  if ((portrait && landscapeFramingPattern.test(promptCore)) || (!portrait && aspectRatio !== "1:1" && portraitFramingPattern.test(promptCore))) {
    throw new Error(`图片提示词中的横竖构图描述与结构化画幅 ${aspectRatio} 冲突；请只保留结构化 aspectRatio。`);
  }
};

const assertReference = (reference: ImageGenerationReference, index: number) => {
  if (!reference.imageUrl.trim()) throw new Error(`参考图 ${index + 1} 缺少 imageUrl。`);
  if (!reference.label.trim()) throw new Error(`参考图 ${index + 1} 缺少可审计标签。`);
  if (!roleLabels[reference.role]) throw new Error(`参考图 ${index + 1} 的 role 无效。`);
  if (!reference.preserve.length) throw new Error(`参考图 ${index + 1} 缺少 preserve 约束。`);
  if (!reference.allowChange.length) throw new Error(`参考图 ${index + 1} 缺少 allowChange 约束。`);
  if (!reference.exclude.length) throw new Error(`参考图 ${index + 1} 缺少 exclude 约束。`);
  assertPromptCoreRelevant([
    reference.label,
    ...reference.preserve,
    ...reference.allowChange,
    ...reference.exclude,
  ].join("\n"), "1:1");
};

const referenceBlock = (references: ImageGenerationReference[]) => references.length
  ? [
      "【多参考图映射】",
      "按以下编号使用输入参考图：",
      ...references.flatMap((reference, index) => [
        `Image ${index + 1}（参考图 ${index + 1}）：${reference.label}`,
        `- 职责：${roleLabels[reference.role]}`,
        `- 必须保留：${reference.preserve.join("；")}`,
        `- 允许改变：${reference.allowChange.join("；")}`,
        `- 禁止复制或引入：${reference.exclude.join("；")}`,
      ]),
      "【多参考图组合关系】",
      "- 只从每张 Image N 提取其已声明职责与必须保留项，并将这些内容组合到同一张最终画面中。",
      "- 参考图之间出现冲突时，必须保留项优先；除明确保留项外，最终构图、动作、视线与光照以生成任务为准。",
    ].join("\n")
  : "";

const editSourceRoles = new Set<ImageReferenceRole>(["source_edit", "previous_output_repair"]);

type ImageEditContractSection = "CHANGE" | "FILL" | "PRESERVE" | "EXCLUDE";

const cleanContractList = (value: unknown, label: ImageEditContractSection): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`图片编辑 ${label} 必须是字符串数组。`);
  }
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
};

const canonicalContractTerm = (value: string) => value
  .normalize("NFKC")
  .trim()
  .replace(/^[\s\-*•]+/, "")
  .replace(/[\s,，.。!！?？;；:：]+$/g, "")
  .replace(/\s+/g, " ")
  .toLocaleLowerCase();

const assertNoEditContractConflicts = (
  sections: Record<ImageEditContractSection, string[]>,
) => {
  const indexed = Object.fromEntries(Object.entries(sections).map(([section, items]) => {
    const entries = items
      .map((item): [string, string] => [canonicalContractTerm(item), item])
      .filter(([key]) => Boolean(key));
    return [section, new Map(entries)];
  })) as Record<ImageEditContractSection, Map<string, string>>;
  const incompatiblePairs: Array<[ImageEditContractSection, ImageEditContractSection]> = [
    ["CHANGE", "PRESERVE"],
    ["CHANGE", "EXCLUDE"],
    ["FILL", "PRESERVE"],
    ["FILL", "EXCLUDE"],
    ["PRESERVE", "EXCLUDE"],
  ];
  for (const [left, right] of incompatiblePairs) {
    for (const [term, original] of indexed[left]) {
      if (!indexed[right].has(term)) continue;
      throw new Error(`图片编辑合同冲突：${left} 与 ${right} 同时声明“${original}”。请明确该内容究竟要修改、重建、保留还是排除。`);
    }
  }
};

const operationGoal = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim();
};

const operationBlock = (
  operation: ImageGenerationOperation | undefined,
  references: ImageGenerationReference[],
) => {
  if (!operation || operation.kind === "generate") return "";
  const sourceReferences = references.filter((reference) => editSourceRoles.has(reference.role));
  if (!sourceReferences.length) {
    throw new Error("图片编辑必须通过结构化 references 提供 source_edit 或 previous_output_repair 源图；系统不会把重绘冒充局部编辑。");
  }
  const inheritedPreserve = sourceReferences.flatMap((reference) => reference.preserve);
  const inheritedExclude = sourceReferences.flatMap((reference) => reference.exclude);
  const preserve = cleanContractList([
    ...cleanContractList(operation.preserve, "PRESERVE"),
    ...inheritedPreserve,
  ], "PRESERVE");
  const exclude = cleanContractList([
    ...cleanContractList(operation.exclude, "EXCLUDE"),
    ...inheritedExclude,
  ], "EXCLUDE");
  if (!preserve.length) throw new Error("图片编辑缺少 PRESERVE EXACTLY 约束，不能安全执行局部修改。");
  const goal = operationGoal(operation.goal);

  if (operation.kind === "edit") {
    const change = cleanContractList(operation.change, "CHANGE");
    const fill = cleanContractList(operation.fill, "FILL");
    if (!goal || !change.length) throw new Error("图片编辑必须声明 goal 和至少一项 CHANGE。");
    assertNoEditContractConflicts({ CHANGE: change, FILL: fill, PRESERVE: preserve, EXCLUDE: exclude });
    return [
      `Edit the source image: ${goal}`,
      "CHANGE:",
      ...change.map((item) => `- ${item}`),
      ...(fill.length ? ["FILL / RECONSTRUCT:", ...fill.map((item) => `- ${item}`)] : []),
      "PRESERVE EXACTLY:",
      ...preserve.map((item) => `- ${item}`),
      ...(exclude.length ? ["EXCLUDE:", ...exclude.map((item) => `- ${item}`)] : []),
      "Only perform the declared change. Keep everything else identical.",
    ].join("\n");
  }

  if (operation.kind === "texture_repair") {
    const surfaces = cleanContractList(operation.surfaces, "CHANGE");
    if (!goal || !surfaces.length) throw new Error("纹理修复必须声明 goal 和至少一个待修复表面。");
    assertNoEditContractConflicts({ CHANGE: surfaces, FILL: [], PRESERVE: preserve, EXCLUDE: exclude });
    return [
      `Repair surface texture fidelity in the source image: ${goal}`,
      "CHANGE:",
      ...surfaces.map((item) => `- Restore believable surface structure for ${item}`),
      "PRESERVE EXACTLY:",
      ...preserve.map((item) => `- ${item}`),
      ...(exclude.length ? ["EXCLUDE:", ...exclude.map((item) => `- ${item}`)] : []),
      "Do not redesign, relight, reframe, or change identity while repairing texture.",
    ].join("\n");
  }

  const arrangement = cleanContractList(operation.newArrangement, "CHANGE");
  if (!goal || !arrangement.length) throw new Error("场景换机位必须声明 goal 和新机位下的物件空间关系。");
  assertNoEditContractConflicts({ CHANGE: arrangement, FILL: [], PRESERVE: preserve, EXCLUDE: exclude });
  return [
    `Create a new view of the same location: ${goal}`,
    "NEW VIEW ARRANGEMENT:",
    ...arrangement.map((item) => `- ${item}`),
    "PRESERVE EXACTLY:",
    ...preserve.map((item) => `- ${item}`),
    ...(exclude.length ? ["EXCLUDE:", ...exclude.map((item) => `- ${item}`)] : []),
    "Maintain one coherent space; do not mirror or scramble fixed architecture unless explicitly declared.",
  ].join("\n");
};

const visibleTextBlock = (directives: ImageVisibleTextDirective[]) => directives.length
  ? [
      "TEXT TO RENDER EXACTLY:",
      ...directives.flatMap((directive, index) => [
        `Text ${index + 1}: ${JSON.stringify(directive.text)}`,
        `- Placement: ${directive.placement}`,
        directive.treatment ? `- Treatment: ${directive.treatment}` : "",
        directive.language ? `- Language: ${directive.language}` : "",
      ].filter(Boolean)),
      "Render the quoted text exactly once with identical characters and punctuation. Do not translate, paraphrase, autocorrect, or add any other readable text.",
    ].join("\n")
  : "";

const evidence = (source: string, summary?: string): VisualRecipeRuntimeEvidence => ({
  source,
  ...(summary ? { summary } : {}),
});

const hasRecipeEvidenceValue = (value: unknown): boolean => {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(hasRecipeEvidenceValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(hasRecipeEvidenceValue);
};

/** Create evidence only when the named domain field contains a real value. */
export const createVisualRecipeInputEvidence = (
  source: string,
  value: unknown,
  summary?: string,
): VisualRecipeRuntimeEvidence[] => hasRecipeEvidenceValue(value)
  ? [evidence(source, summary)]
  : [];

const inferImageVisualRecipeEvidence = ({
  intent,
  promptCore,
  references,
  operation,
  explicitEvidence,
}: {
  intent: VisualArtifactIntent;
  promptCore: string;
  references: ImageGenerationReference[];
  operation: ImageGenerationOperation;
  explicitEvidence?: ImageGenerationRequest["visualRecipeInputEvidence"];
}): VisualRecipeRuntimeEvidenceMap<VisualRecipeRequiredInput> => {
  const continuityReferences = references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => reference.role === "continuity_frame")
    .map(({ reference, index }) => evidence(`ImageGenerationRequest.references[${index}]`, reference.role));
  const editReferences = references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => editSourceRoles.has(reference.role))
    .map(({ reference, index }) => evidence(`ImageGenerationRequest.references[${index}]`, reference.role));
  const operationEvidence = operation.kind === "generate"
    ? []
    : [evidence("ImageGenerationRequest.operation", operation.kind)];
  const inferred: VisualRecipeRuntimeEvidenceMap<VisualRecipeRequiredInput> = {};
  const identityReferences = references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => [
      "character_identity",
      "wardrobe_state",
      "location_design",
      "prop_design",
      "vehicle_design",
    ].includes(reference.role))
    .map(({ reference, index }) => evidence(`ImageGenerationRequest.references[${index}]`, reference.role));
  if (["asset_identity", "effect_look", "final_frame"].includes(intent) && identityReferences.length) {
    inferred.identity_facts = identityReferences;
  }
  if (intent === "asset_state") {
    inferred.base_identity = identityReferences;
    if (operationEvidence.length) inferred.state_delta = operationEvidence;
  }
  if (["storyboard_control", "direction_preview", "final_frame"].includes(intent) && continuityReferences.length) {
    inferred.continuity = continuityReferences;
  }
  if (intent === "image_edit") {
    inferred.source_edit = editReferences;
    inferred.requested_changes = operationEvidence;
    inferred.preserve_constraints = operationEvidence.length && editReferences.length
      ? [...operationEvidence, ...editReferences]
      : [];
  }
  for (const [input, entries] of Object.entries(explicitEvidence || {}) as Array<[
    VisualRecipeRequiredInput,
    VisualRecipeRuntimeEvidence[] | undefined,
  ]>) {
    inferred[input] = [...(inferred[input] || []), ...(entries || [])];
  }
  return inferred;
};

export const compileImageGenerationRequest = (
  request: ImageGenerationRequest,
  options: CompileImageGenerationRequestOptions = {},
): CompiledImageGenerationRequest => {
  const promptCore = request.promptCore.trim();
  if (!promptCore) throw new Error("图片生成 promptCore 不能为空。");
  const aspectRatio = request.aspectRatio || "16:9";
  if (!supportedAspectRatios.has(aspectRatio)) {
    throw new Error(`图片生成不支持画幅 ${String(aspectRatio)}；请选择 1:1、3:4、4:3、9:16 或 16:9。`);
  }
  const requestedOutputConstraints = (request.outputConstraints || []).map((item) => item.trim()).filter(Boolean);
  if (platformParameterPattern.test([promptCore, ...requestedOutputConstraints].join("\n"))) {
    throw new Error("图片提示词含有 --ar/--v/--q 等平台参数。请删除该参数；画幅必须通过结构化 aspectRatio 传递。");
  }
  assertPromptCoreRelevant([promptCore, ...requestedOutputConstraints].join("\n"), aspectRatio);
  const explicitReferences = (request.references || []).map(ref => {
    const sameStyle = request.visualStyleProjection?.styleReferences?.find(style => style.imageUrl === ref.imageUrl);
    return sameStyle ? { ...ref, preserve: Array.from(new Set([...ref.preserve, ...sameStyle.preserve])), exclude: Array.from(new Set([...ref.exclude, ...sameStyle.exclude])) } : ref;
  });
  const styleReferences = (request.visualStyleProjection?.styleReferences || []).filter(ref => !explicitReferences.some(existing => existing.imageUrl === ref.imageUrl));
  const references = [...explicitReferences, ...styleReferences].map((reference) => createImageGenerationReference(reference));
  references.forEach(assertReference);
  const resolvedOperation = request.operation || { kind: "generate" as const };
  if (resolvedOperation.kind === "generate" && references.some((reference) => editSourceRoles.has(reference.role))) {
    throw new Error("普通图片生成不能把参考图标记为 source_edit 或 previous_output_repair；请使用明确的 identity/style/continuity 职责，或同时提供结构化 edit operation。");
  }
  const duplicateReference = references.find((reference, index) =>
    references.findIndex((candidate) => candidate.imageUrl === reference.imageUrl) !== index);
  if (duplicateReference) {
    throw new Error(`参考图“${duplicateReference.label}”与另一职责重复使用同一 imageUrl；请合并为一个明确职责，避免供应商编号歧义。`);
  }
  const visibleText = (request.visibleText || []).map((directive) => ({
    text: directive.text.trim(),
    placement: directive.placement.trim(),
    treatment: directive.treatment?.trim() || undefined,
    language: directive.language?.trim() || undefined,
  }));
  visibleText.forEach((directive, index) => {
    if (!directive.text) throw new Error(`精确文字 ${index + 1} 缺少 text。`);
    if (!directive.placement) throw new Error(`精确文字 ${index + 1} 缺少 placement。`);
    if (embeddedMediaLocationPattern.test([directive.placement, directive.treatment, directive.language].filter(Boolean).join("\n"))) {
      throw new Error(`精确文字 ${index + 1} 的布局或样式含有媒体 URL；请通过结构化 references 传递媒体。`);
    }
  });
  const outputConstraints = Array.from(new Set([
    visibleText.length
      ? "只生成一张最终图像文件；只允许渲染精确文字合同中声明的文字，不添加其他可读文字、字幕、水印、UI 或说明性排版"
      : "只生成一张图片；保留明确指定的画内文字、招牌、信件和屏幕内容，保持原文与位置。除指定的分格、分区或控制线外，不添加装饰边框、界面元素、水印或说明文字",
    "严格遵循描述中的主体外观、可见动作、构图和光照，只输出图片",
    ...requestedOutputConstraints,
  ]));
  const visualStyleInstruction = request.visualStyleProjection?.instruction.trim() || "";
  const operationInstruction = operationBlock(resolvedOperation, references);
  const textInstruction = visibleTextBlock(visibleText);
  if (platformParameterPattern.test([visualStyleInstruction, operationInstruction].join("\n"))) {
    throw new Error("视觉规范或编辑合同含有 --ar/--v/--q 等平台参数；平台参数必须通过结构化执行字段传递。");
  }
  assertPromptCoreRelevant([visualStyleInstruction, operationInstruction].filter(Boolean).join("\n"), aspectRatio);
  const enforcement = options.enforcement || "draft";
  let visualRecipeContract: VisualRecipeRuntimeContract | undefined;
  let resolvedVisualStyleProjection = request.visualStyleProjection;
  if (request.visualStyleProjection) {
    const expectedRecipe = getVisualTaskRecipeForIntent(request.visualStyleProjection.artifactIntent);
    const projectionRecipeMatches = request.visualStyleProjection.recipeId === expectedRecipe.id
      && request.visualStyleProjection.recipeVersion === expectedRecipe.version;
    const compileManifestMatches = !request.visualStyleProjection.compileManifest || (
      request.visualStyleProjection.compileManifest.intent === expectedRecipe.intent
      && request.visualStyleProjection.compileManifest.recipeId === expectedRecipe.id
      && request.visualStyleProjection.compileManifest.recipeVersion === expectedRecipe.version
    );
    const recipeHeaderForEvaluation = projectionRecipeMatches && compileManifestMatches
      ? request.visualStyleProjection.compileManifest || {
          intent: request.visualStyleProjection.artifactIntent,
          recipeId: request.visualStyleProjection.recipeId,
          recipeVersion: request.visualStyleProjection.recipeVersion,
        }
      : {
          intent: request.visualStyleProjection.artifactIntent,
          recipeId: projectionRecipeMatches
            ? request.visualStyleProjection.compileManifest?.recipeId || "mismatched-recipe"
            : request.visualStyleProjection.recipeId,
          recipeVersion: projectionRecipeMatches
            ? request.visualStyleProjection.compileManifest?.recipeVersion || "mismatched-version"
            : request.visualStyleProjection.recipeVersion,
        };
    const recipeInputEvidence = inferImageVisualRecipeEvidence({
      intent: request.visualStyleProjection.artifactIntent,
      promptCore,
      references,
      operation: resolvedOperation,
      explicitEvidence: request.visualRecipeInputEvidence,
    });
    visualRecipeContract = evaluateVisualRecipeRuntimeContract({
      intent: request.visualStyleProjection.artifactIntent,
      enforcement,
      inputEvidence: recipeInputEvidence,
      stageEvidence: {
        deconstruct: [evidence("ImageGenerationCompiler.structuredInputs")],
        diagnose: [evidence("ImageGenerationCompiler.contractValidation")],
        develop: [evidence("ImageGenerationCompiler.promptComposition")],
        ...(enforcement === "formal"
          ? { deliver: [evidence("ImageGenerationProviderBoundary.outboundRequest")] }
          : {}),
      },
      manifest: recipeHeaderForEvaluation,
    });
    if (enforcement === "formal") {
      if (!request.visualStyleProjection.compileManifest) {
        throw new Error("正式图片生成缺少视觉风格编译清单，不能审计当前 Recipe。");
      }
      assertVisualRecipeRuntimeContractReady(visualRecipeContract);
    }
    resolvedVisualStyleProjection = {
      ...request.visualStyleProjection,
      ...(request.visualStyleProjection.compileManifest && projectionRecipeMatches && compileManifestMatches ? {
        compileManifest: attachVisualRecipeContractToManifest({
          manifest: request.visualStyleProjection.compileManifest,
          contract: visualRecipeContract,
          blockId: "image.recipe_contract",
        }),
      } : {}),
    };
  }
  const composed = composePromptBlocks([
    { blockId: "image.task", source: "ImageGenerationRequest.promptCore", purpose: "图片生成任务与镜头画面", content: `【生成任务】\n${promptCore}`, required: true },
    {
      blockId: "image.visual_style",
      source: request.visualStyleProjection
        ? `VisualStyleProjection.${request.visualStyleProjection.recipeId}@${request.visualStyleProjection.recipeVersion}`
        : "ImageGenerationRequest.visualStyleProjection",
      purpose: "项目视觉规范经当前产物 Recipe 投影后的有效字段",
      content: visualStyleInstruction ? `【视觉风格】\n${visualStyleInstruction}` : "",
      required: false,
      omissionReason: visualStyleInstruction ? undefined : "not_provided",
    },
    {
      blockId: "image.recipe_contract",
      source: visualRecipeContract
        ? `VisualTaskRecipe.${visualRecipeContract.recipeId}@${visualRecipeContract.recipeVersion}`
        : "ImageGenerationRequest.visualStyleProjection",
      purpose: "当前视觉产物的输入、工作步骤与待复核验收合同",
      content: "",
      required: false,
      omissionReason: "application_validation_only",
    },
    {
      blockId: "image.operation",
      source: "ImageGenerationRequest.operation",
      purpose: "局部编辑、纹理修复或换机位的 CHANGE/PRESERVE 合同",
      content: operationInstruction ? `【执行操作】\n${operationInstruction}` : "",
      required: false,
      omissionReason: operationInstruction ? undefined : "plain_generation",
    },
    {
      blockId: "image.visible_text",
      source: "ImageGenerationRequest.visibleText",
      purpose: "画面内文字的逐字内容、位置和样式合同",
      content: textInstruction ? `【精确文字合同】\n${textInstruction}` : "",
      required: false,
      omissionReason: textInstruction ? undefined : "no_visible_text_requested",
    },
    { blockId: "image.references", source: "ImageGenerationRequest.references", purpose: "逐图职责、保留与可变规则", content: referenceBlock(references), required: false },
    { blockId: "image.output", source: "ImageGenerationRequest.outputConstraints", purpose: "图片输出边界", content: `【输出约束】\n${outputConstraints.map((item) => `- ${item}`).join("\n")}`, required: true },
  ]);
  return {
    providerPrompt: composed.prompt,
    aspectRatio,
    referenceImages: references.map((reference) => reference.imageUrl),
    references,
    outputConstraints,
    operation: resolvedOperation,
    visualStyleProjection: resolvedVisualStyleProjection,
    visualRecipeContract,
    visibleText,
    manifest: composed.manifest,
  };
};
