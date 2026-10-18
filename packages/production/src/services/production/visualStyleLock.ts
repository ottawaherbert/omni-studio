import type { Project, VisualStyleLock } from "../../../../../src/types/project";
import { formatPromptValue } from "../../../../../src/utils/projectUtils";
import type { VisualArtifactIntent } from "../../../../domain/src/visualArtifact";
import {
  normalizeLegacyVisualStyleLock,
  visualStyleContentHash,
} from "./visualStyleMigration";
import {
  projectVisualStyleForArtifact,
  renderVisualStyleProjectionInstruction,
  type RenderedVisualStyleProjectionInstruction,
} from "./visualStyleProjection";

const clean = (value: unknown) => formatPromptValue(value);

const uniq = (items: Array<string | undefined | null>) =>
  Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));

const splitList = (value: unknown): string[] => {
  if (Array.isArray(value)) return uniq(value.map((item) => clean(item)));
  return uniq(clean(value).split(/[,\n，、；;]/).map((item) => item.trim()));
};

export interface ResolvedVisualStyleLock {
  sourceFields: string[];
  renderingMode?: string;
  stylePrompt?: string;
  styleKeywords: string[];
  referenceWorks?: string;
  colorPalette: string[];
  allowedHex: string[];
  forbiddenColors: string[];
  colorTemperature: string[];
  saturation?: string;
  contrast?: string;
  texture: string[];
  mediumSurface: string[];
  finalRenderIntent?: string;
  linework: string[];
  sketchDensity?: string;
  strokeWeight?: string;
  finishLevel?: string;
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
  noSourceCopyRules: string[];
  driftGuards: string[];
  styleSourceRefs: string[];
  analysisConfidence?: number;
  humanApprovalState?: VisualStyleLock["humanApprovalState"];
  version?: string;
  negativeStyleRules: string[];
  summary: string;
  assetBoardInstruction: string;
  storyboardInstruction: string;
  effectLookInstruction: string;
  artifactProjectionManifests: Partial<Record<VisualArtifactIntent, RenderedVisualStyleProjectionInstruction["manifest"]>>;
}

const projectionInstruction = (
  styleLock: VisualStyleLock | undefined,
  intent: VisualArtifactIntent,
) => renderVisualStyleProjectionInstruction(projectVisualStyleForArtifact({ styleLock, intent }));

const canonicalOrLegacy = (
  canonical: string[] | undefined,
  legacy: unknown,
  allowLegacy: boolean,
) => canonical?.length ? uniq(canonical) : allowLegacy ? splitList(legacy) : [];

export const resolveVisualStyleLock = (project: Pick<Project, "visualStyleLock"> | undefined): ResolvedVisualStyleLock => {
  const input = project?.visualStyleLock;
  const normalized = normalizeLegacyVisualStyleLock(input);
  const lock = normalized.lock;
  const implementation = lock.visualImplementation;
  const treatment = lock.treatment;
  const allowLegacy = input?.schemaVersion !== "visual-style-lock.v3";

  const renderingMode = clean(implementation?.productionMode || (allowLegacy ? lock.renderingMode : ""));
  const stylePrompt = clean(treatment?.directives?.join("；") || (allowLegacy ? lock.stylePrompt : ""));
  const styleKeywords = uniq([
    ...(implementation?.appearance.descriptors || []),
    ...(implementation?.techniques || []),
    ...canonicalOrLegacy(treatment?.directives, lock.styleKeywords, allowLegacy),
  ]);
  const colorPalette = canonicalOrLegacy(treatment?.palette, lock.colorPalette, allowLegacy);
  const allowedHex = uniq([
    ...colorPalette.filter((value) => /^#[0-9a-f]{6}$/iu.test(value)),
    ...(allowLegacy ? splitList(lock.allowedHex) : []),
  ]);
  const forbiddenColors = allowLegacy ? splitList(lock.forbiddenColors) : [];
  const colorTemperature = canonicalOrLegacy(treatment?.color, lock.colorTemperature, allowLegacy);
  const texture = canonicalOrLegacy(treatment?.surface, lock.texture, allowLegacy);
  const mediumSurface = canonicalOrLegacy(treatment?.surface, lock.mediumSurface, allowLegacy);
  const linework = canonicalOrLegacy(treatment?.linework, lock.linework, allowLegacy);
  const lighting = canonicalOrLegacy(treatment?.lighting, lock.lighting, allowLegacy);
  const camera = canonicalOrLegacy(treatment?.camera, lock.lensBias, allowLegacy);
  const movement = canonicalOrLegacy(treatment?.movement, lock.movementBias, allowLegacy);
  const composition = canonicalOrLegacy(treatment?.composition, lock.compositionRules, allowLegacy);
  const materials = canonicalOrLegacy(treatment?.materials, lock.materialRendering, allowLegacy);
  const finish = canonicalOrLegacy(treatment?.finish, lock.finishLevel, allowLegacy);
  const readability = canonicalOrLegacy(treatment?.readability, lock.readabilityRules, allowLegacy);
  const constraints = canonicalOrLegacy(treatment?.constraints, lock.negativeStyleRules, allowLegacy);
  const noSourceCopyRules = uniq([
    ...splitList(lock.noSourceCopyRules),
    ...constraints.filter((value) => /copy|source|reference|复制|来源|参考/iu.test(value)),
  ]);
  const styleSourceRefs = splitList(lock.styleSourceRefs);

  const summaryParts = [
    renderingMode ? `影像实现方式：${renderingMode}` : "",
    implementation?.appearance
      ? `外观：${[
          implementation.appearance.realism,
          implementation.appearance.dimensionality,
          implementation.appearance.finish,
          ...implementation.appearance.descriptors,
        ].filter((value) => value && value !== "unspecified").join("，")}`
      : "",
    implementation?.techniques.length ? `制作技法：${implementation.techniques.join("，")}` : "",
    stylePrompt ? `画面目标：${stylePrompt}` : "",
    colorPalette.length ? `色板：${colorPalette.join("，")}` : "",
    lighting.length ? `灯光：${lighting.join("，")}` : "",
    camera.length ? `摄影机：${camera.join("，")}` : "",
    composition.length ? `构图：${composition.join("，")}` : "",
  ].filter(Boolean);
  const summary = summaryParts.length
    ? summaryParts.join("\n")
    : "未设置显式项目视觉规范；不得从资产板、故事板模板或供应商默认值自行发明媒介与画风。";

  const assetProjection = projectionInstruction(input, "asset_identity");
  const storyboardProjection = projectionInstruction(input, "storyboard_control");
  const effectProjection = projectionInstruction(input, "effect_look");
  const assetBoardInstruction = [
    "【项目视觉规范 · 资产身份投影】",
    assetProjection.instruction,
    "【资产板执行边界】",
    "资产板用于锁定身份、结构、比例、空间和可见状态；版式本身不得发明最终成片画风。",
    "资产自身的材质事实来自 canonical 资产数据；项目成片材质、颗粒、景深和最终精修只在该产物 Recipe 明确投影时使用。",
    "参考图只按已声明职责提取信息，不复制来源人物、地点、独有道具、标志或构图。",
  ].join("\n");
  const storyboardInstruction = [
    "【项目视觉规范 · 故事板控制投影】",
    storyboardProjection.instruction,
    "【故事板执行边界】",
    "故事板优先表达镜头、动作、调度、光向、声音和连续性，不冒充最终成片渲染。",
    "未被 storyboard_control Recipe 投影的成片材质、着色、精修和材料瑕疵不得回流进控制图。",
    lock.boardAnnotationPolicy ? `【标注策略】\n${lock.boardAnnotationPolicy}` : "",
  ].filter(Boolean).join("\n");
  const effectLookInstruction = [
    "【项目视觉规范 · 效果图投影】",
    effectProjection.instruction,
    "【效果图执行边界】",
    "效果图表达成片观感方向，但仍必须保持 canonical 身份、空间事实与参考图职责边界。",
  ].join("\n");

  return {
    sourceFields: input ? ["project.visualStyleLock"] : [],
    renderingMode,
    stylePrompt,
    styleKeywords,
    referenceWorks: clean(allowLegacy ? lock.referenceWorks : ""),
    colorPalette,
    allowedHex,
    forbiddenColors,
    colorTemperature,
    saturation: clean(allowLegacy ? lock.saturation : ""),
    contrast: clean(allowLegacy ? lock.contrast : ""),
    texture,
    mediumSurface,
    finalRenderIntent: clean(finish.join("；")),
    linework,
    sketchDensity: clean(allowLegacy ? lock.sketchDensity : ""),
    strokeWeight: clean(allowLegacy ? lock.strokeWeight : ""),
    finishLevel: clean(finish.join("；")),
    lighting,
    lightSourceLogic: allowLegacy ? splitList(lock.lightSourceLogic) : lighting,
    conditionalLighting: allowLegacy ? splitList(lock.conditionalLighting) : [],
    practicalLightRules: allowLegacy ? splitList(lock.practicalLightRules) : [],
    cameraLanguage: clean(camera.join("；")),
    lensBias: camera,
    movementBias: movement,
    framingBias: allowLegacy ? splitList(lock.framingBias) : composition,
    depthOfField: clean(allowLegacy ? lock.depthOfField : ""),
    grain: allowLegacy ? splitList(lock.grain) : [],
    noiseFloor: clean(allowLegacy ? lock.noiseFloor : ""),
    materialRendering: materials,
    compositionRules: composition,
    negativeSpaceRules: allowLegacy ? splitList(lock.negativeSpaceRules) : [],
    foregroundRules: allowLegacy ? splitList(lock.foregroundRules) : [],
    readabilityRules: readability,
    annotationLegend: Array.isArray(lock.annotationLegend) ? lock.annotationLegend : [],
    boardAnnotationPolicy: clean(lock.boardAnnotationPolicy),
    assetBoardStylePolicy: clean(lock.assetBoardStylePolicy),
    storyboardStylePolicy: clean(lock.storyboardStylePolicy),
    effectLookPolicy: clean(lock.effectLookPolicy),
    noSourceCopyRules,
    driftGuards: allowLegacy ? splitList(lock.driftGuards) : constraints,
    styleSourceRefs,
    analysisConfidence: typeof lock.analysisConfidence === "number" ? lock.analysisConfidence : undefined,
    humanApprovalState: lock.humanApprovalState,
    version: clean(lock.version || (lock.schemaVersion === "visual-style-lock.v3" ? `visual-style-lock.v3.r${lock.revision || 1}` : "")),
    negativeStyleRules: constraints,
    summary,
    assetBoardInstruction,
    storyboardInstruction,
    effectLookInstruction,
    artifactProjectionManifests: {
      asset_identity: assetProjection.manifest,
      storyboard_control: storyboardProjection.manifest,
      effect_look: effectProjection.manifest,
    },
  };
};

/**
 * Explicit compatibility helper. It normalizes only the stored lock and never adopts
 * creativeVision, provider settings, or Skill text as an approved visual standard.
 */
export const createVisualStyleLockFromProject = (project: Project): VisualStyleLock => {
  const normalized = normalizeLegacyVisualStyleLock(project.visualStyleLock);
  const revision = Math.max(1, normalized.lock.revision || 1);
  const lock: VisualStyleLock = {
    ...normalized.lock,
    schemaVersion: "visual-style-lock.v3",
    revision,
    version: `visual-style-lock.v3.r${revision}`,
    humanApprovalState: project.visualStyleLock?.humanApprovalState || "draft",
    source: project.visualStyleLock?.source || "manual",
    lockedAt: project.visualStyleLock?.lockedAt || Date.now(),
  };
  lock.contentHash = visualStyleContentHash(lock);
  return lock;
};
