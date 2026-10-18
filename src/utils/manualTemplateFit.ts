import type { BeatTemplate } from "../types/project";
import type { FormatProductionProfile } from "../config/formatProductionProfiles";

export type ManualTemplateKind = "skeleton" | "beat" | "scene";
export type ManualTemplateSource = "builtIn" | "custom" | "videoAnalysis";

export interface ManualTemplateFit {
  sourceLabel: string;
  applicableFormat: string;
  recommendation: string;
  conflictRisk: string;
  riskTone: "low" | "medium" | "high";
}

const kindLabel: Record<ManualTemplateKind, string> = {
  skeleton: "结构骨架",
  beat: "内部节拍",
  scene: "场景/段落拆分",
};

export const inferManualTemplateKind = (template: BeatTemplate): ManualTemplateKind | undefined => {
  if (template.id.startsWith("custom-skel") || template.id.startsWith("custom-skeleton-")) return "skeleton";
  if (template.id.startsWith("custom-beat-")) return "beat";
  if (template.id.startsWith("custom-doctor-")) return "scene";
  if (template.id.startsWith("custom-")) return "scene";
  return undefined;
};

export const normalizeLegacyManualTemplateScopes = (
  templates: BeatTemplate[],
  profile: FormatProductionProfile,
  fallbackKind?: ManualTemplateKind,
): { templates: BeatTemplate[]; changed: boolean } => {
  let changed = false;
  const normalized = templates.map((template) => {
    if (!template.id.startsWith("custom-")) return template;
    const inferredKind = inferManualTemplateKind(template) || fallbackKind;
    if (!inferredKind) return template;
    const applicableFormats = template.applicableFormats?.length ? template.applicableFormats : [profile.id];
    const applicableStages = template.applicableStages?.length ? template.applicableStages : [inferredKind];
    const next: BeatTemplate = {
      ...template,
      applicableFormats,
      applicableStages,
      createdForProjectType: template.createdForProjectType || profile.id,
      createdForProjectModel: template.createdForProjectModel || (profile.mode === "interactive" ? "interactive" : "linear"),
      referenceDnaRelation: template.referenceDnaRelation || "unspecified",
      outputSchemaSummary: template.outputSchemaSummary || "Legacy BeatTemplate: name, description, instruction",
      variables: template.variables || [],
    };
    const didChange =
      next.applicableFormats !== template.applicableFormats ||
      next.applicableStages !== template.applicableStages ||
      next.createdForProjectType !== template.createdForProjectType ||
      next.createdForProjectModel !== template.createdForProjectModel ||
      next.referenceDnaRelation !== template.referenceDnaRelation ||
      next.outputSchemaSummary !== template.outputSchemaSummary ||
      next.variables !== template.variables;
    changed = changed || didChange;
    return next;
  });
  return { templates: normalized, changed };
};

const templateReferenceText = (template: BeatTemplate) => [
  template.id,
  template.name,
  template.description,
  template.instruction,
  template.referenceWork,
  ...(template.applicableFormats || []),
  ...(template.applicableStages || []),
].filter(Boolean).join(" ");

const normalizeEvidenceText = (value?: string) =>
  (value || "").trim().toLowerCase().replace(/\s+/g, "");

const splitReferenceWorks = (value?: string) =>
  (value || "")
    .split(/[,\n，、;；/]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const evidenceList = (items: string[], fallback: string) =>
  items.length > 0 ? items.join("、") : fallback;

const buildDurationEvidence = (
  profile: FormatProductionProfile,
  durationMinutes?: number,
) => {
  if (!durationMinutes || durationMinutes <= 0) {
    return `时长：项目未设置 durationMinutes，按 ${profile.label} 默认 ${profile.defaultTargetCount} 个${profile.unitName}判断。`;
  }
  const unitMinutes = Math.max(1, Math.round(durationMinutes / Math.max(1, profile.defaultTargetCount)));
  return `时长：项目约 ${durationMinutes} 分钟，按 ${profile.defaultTargetCount} 个${profile.unitName}估算单元约 ${unitMinutes} 分钟。`;
};

const buildGenreEvidence = (template: BeatTemplate, genres: string[] = [], projectTopicText = "") => {
  const text = normalizeEvidenceText(templateReferenceText(template));
  const topicText = normalizeEvidenceText(projectTopicText);
  const matchedKeywords = (template.topicKeywords || []).filter((keyword) => topicText.includes(normalizeEvidenceText(keyword)));
  if (genres.length === 0 && matchedKeywords.length === 0) return "题材：项目未填写 genre，暂按作品类型 Profile 判断。";
  const matched = genres.filter((genre) => text.includes(normalizeEvidenceText(genre)));
  const unmatched = genres.filter((genre) => !matched.includes(genre));
  return `题材：genre 命中 ${evidenceList(matched, "无显式命中")}；模板关键词命中 ${evidenceList(matchedKeywords, "无显式命中")}；未显式命中 ${evidenceList(unmatched, "无")}。`;
};

const buildReferenceEvidence = ({
  template,
  referenceWorks,
}: {
  template: BeatTemplate;
  referenceWorks?: string;
}) => {
  const text = normalizeEvidenceText(templateReferenceText(template));
  const works = splitReferenceWorks(referenceWorks);
  const matchedWorks = works.filter((work) => text.includes(normalizeEvidenceText(work)));
  const declaredReference =
    template.referenceWork
      ? `模板声明参考 ${template.referenceWork}`
      : `模板未声明具体参考作品`;
  return `参考：${declaredReference}；作品命中 ${evidenceList(matchedWorks, "无显式命中")}。`;
};

const buildReferenceDnaEvidence = ({
  template,
}: {
  template: BeatTemplate;
}) => {
  const relation = template.referenceDnaRelation || "unspecified";
  return `参考 DNA：模板关系 ${relation}。`;
};

const buildFitEvidence = ({
  template,
  profile,
  durationMinutes,
  projectGenres = [],
  referenceWorks,
  projectTopicText,
}: {
  template: BeatTemplate;
  profile: FormatProductionProfile;
  durationMinutes?: number;
  projectGenres?: string[];
  referenceWorks?: string;
  universalSkillRefs?: unknown[];
  projectTopicText?: string;
}) => [
  buildDurationEvidence(profile, durationMinutes),
  buildGenreEvidence(template, projectGenres, projectTopicText),
  buildReferenceEvidence({ template, referenceWorks }),
  buildReferenceDnaEvidence({ template }),
].join(" ");

export const buildManualTemplateConflictWarnings = ({
  profile,
  templates,
}: {
  profile: FormatProductionProfile;
  templates: BeatTemplate[];
  skills?: unknown[];
}): string[] => {
  const warnings: string[] = [];
  const templateText = templates.map(templateReferenceText).join("\n");
  const combined = templateText;
  const selectedIds = templates.map((template) => template.id).filter(Boolean).join(" + ");
  const shortDramaCue = /短剧|微短剧|打脸|爽点|付费点|3秒|三翻四抖|cliffhanger|爽文|逆袭/i.test(combined);
  const slowCinemaCue = /慢热|生活流|克制|留白|静观|长镜头|slow burn|minimalist|meditative/i.test(combined);
  const interactiveCue = /互动|选择|变量|分支|结局|状态反馈|foldback|branch|choice|variable|ending/i.test(combined);

  templates.forEach((template) => {
    const declaredFormats = template.applicableFormats || [];
    if (declaredFormats.length > 0 && !declaredFormats.includes(profile.id)) {
      warnings.push(`模板 ${template.id} 声明适用类型为 ${declaredFormats.join("、")}，当前类型是 ${profile.id}。`);
    }
  });

  if (profile.id === "movie" && shortDramaCue) {
    warnings.push(`模板组合 ${selectedIds || "未命名模板"} 或参考 DNA 含短剧/爽点信号，可能压过电影长片的角色弧线、留白和因果闭环。`);
  }
  if ((profile.id === "short-drama" || profile.id === "micro-short-drama") && slowCinemaCue) {
    warnings.push(`模板组合 ${selectedIds || "未命名模板"} 或参考 DNA 含慢热/克制/长镜头信号，可能削弱短剧前 3 秒钩子、反转密度和低理解成本。`);
  }
  if (profile.id === "interactive" && templates.length > 0 && !interactiveCue) {
    warnings.push(`模板组合 ${selectedIds || "未命名模板"} 缺少选择、变量、分支、结局或状态反馈信号，可能把互动项目写成线性剧情。`);
  }

  return Array.from(new Set(warnings));
};

export const getManualTemplateFit = ({
  template,
  profile,
  kind,
  source,
  referenceCount = 0,
  durationMinutes,
  projectGenres = [],
  referenceWorks,
  projectTopicText,
}: {
  template: BeatTemplate;
  profile: FormatProductionProfile;
  kind: ManualTemplateKind;
  source: ManualTemplateSource;
  referenceCount?: number;
  durationMinutes?: number;
  projectGenres?: string[];
  referenceWorks?: string;
  universalSkillRefs?: unknown[];
  projectTopicText?: string;
}): ManualTemplateFit => {
  const stage = kindLabel[kind];
  const defaultId =
    kind === "skeleton"
      ? profile.defaultSkeletonId
      : kind === "beat"
        ? profile.defaultBeatId
        : profile.defaultSceneTemplateId;
  const referenceNote =
    referenceCount > 0
      ? `当前项目有 ${referenceCount} 个参考 DNA，需要确认它们和这个模板的节奏/类型兼容。`
      : "当前项目没有可见参考 DNA，主要按类型 Profile 与模板说明判断。";
  const fitEvidence = buildFitEvidence({
    template,
    profile,
    durationMinutes,
    projectGenres,
    referenceWorks,
    projectTopicText,
  });

  if (source === "builtIn") {
    const isProfileDefault = template.id === defaultId;
    return {
      sourceLabel: "系统内置模板",
      applicableFormat: `${profile.label} / ${stage}`,
      recommendation: isProfileDefault
        ? `推荐理由：这是当前类型 Profile 的默认${stage}，会优先匹配 ${profile.unitName}、QA gate 与成本策略。${referenceNote} 逐项依据：${fitEvidence}`
        : `推荐理由：它来自当前 ${profile.label} 模板矩阵，适合在作者明确需要该结构动作时替换默认模板。${referenceNote} 逐项依据：${fitEvidence}`,
      conflictRisk: `冲突风险：低。它已经按当前作品类型路由；仍需检查题材、时长、参考 DNA 是否要求更慢热、更强反转或更强互动变量。`,
      riskTone: "low",
    };
  }

  if (source === "videoAnalysis") {
    return {
      sourceLabel: "拉片 DNA 模板",
      applicableFormat: `来源作品模板 / 当前使用于 ${profile.label} 的${stage}`,
      recommendation: `推荐理由：可复用拉片提取出的结构或节奏特征，但它不是当前类型 Profile 的内置模板。${referenceNote} 逐项依据：${fitEvidence}`,
      conflictRisk: `冲突风险：中。必须确认拉片来源的作品类型、时长、叙事密度与当前 ${profile.label} 不冲突，尤其避免把电影慢热骨架套进短剧，或把短剧高频爽点套进严肃电影/剧集。`,
      riskTone: "medium",
    };
  }

  const declaredFormats = template.applicableFormats || [];
  const declaredStages = template.applicableStages || [];
  const hasDeclaredScope = declaredFormats.length > 0 && declaredStages.length > 0;
  const matchesCurrentScope =
    declaredFormats.includes(profile.id) && declaredStages.includes(kind);

  if (hasDeclaredScope) {
    return {
      sourceLabel: "自定义模板（已声明适用范围）",
      applicableFormat: `声明适用类型：${declaredFormats.join("、")}；声明阶段：${declaredStages.join("、")}；当前用于 ${profile.label} 的${stage}`,
      recommendation: matchesCurrentScope
        ? `推荐理由：这个自定义模板已绑定当前作品类型和阶段，可作为作者明确选择的扩展模板。${referenceNote} 逐项依据：${fitEvidence}`
        : `推荐理由：这个自定义模板有适用范围记录，但当前 ${profile.label}/${stage} 不在声明范围内，只适合作者明确覆盖时使用。${referenceNote} 逐项依据：${fitEvidence}`,
      conflictRisk: matchesCurrentScope
        ? "冲突风险：中。已声明类型/阶段，但仍需检查输出 schema、变量缺失和参考 DNA 关系是否完整。"
        : "冲突风险：高。模板声明范围与当前类型或阶段不一致，生成前必须人工确认是否覆盖。",
      riskTone: matchesCurrentScope ? "medium" : "high",
    };
  }

  return {
    sourceLabel: "自定义模板",
    applicableFormat: `未声明适用类型 / 未声明阶段，当前临时用于 ${profile.label} 的${stage}`,
    recommendation: `推荐理由：这是作者自定义或 AI 提取模板，可用于特殊段落实验；使用前应人工确认它服务当前 ${profile.unitName}。${referenceNote} 逐项依据：${fitEvidence}`,
    conflictRisk: `冲突风险：高。当前模板数据尚未保存适用类型、阶段、输出 schema、变量清单和参考 DNA 关系，不能当作已兼容模板；生成前应检查是否污染当前类型节奏。`,
    riskTone: "high",
  };
};
