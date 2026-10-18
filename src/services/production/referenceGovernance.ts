import { ExtractedBeatTemplate, Project, UniversalSkillReference } from "../../types/project";
import type {
  GlobalAssets,
  Beat,
  SourceType,
  TargetFormat,
} from "../../types/adaptation";
import {
  AnalysisSegment,
  VideoAnalysisSkill,
  VideoAnalysisProject,
} from "../../types/videoAnalysis";
import {
  QAVerdict,
  QAStatus,
} from "../../types/production";
import {
  GovernedDraft,
  ReferenceGovernanceMetadata,
  ReferenceQAStatus,
  ReferenceTargetStage,
  SourceArtifact,
  SourceArtifactKind,
  SourceAuthorizationStatus,
} from "../../types/referenceGovernance";
import { runAgentGatewayStep } from "./agentGateway";
import { normalizeProductionQAIssue } from "./qaIssue";
import { skillBodyText, skillTitleText } from "../../utils/universalSkillText";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";

const MAX_SOURCE_PREVIEW_CHARS = 6000;

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const compactText = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const textOf = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const verdictStatus = (issues: ReturnType<typeof normalizeProductionQAIssue>[]): QAStatus =>
  issues.some((issue) => issue.severity === "blocking")
    ? "failed"
    : issues.length
      ? "warning"
      : "passed";

const governanceStatus = (verdicts: QAVerdict[]): ReferenceQAStatus =>
  verdicts.some((verdict) => verdict.status === "failed" || verdict.blocking)
    ? "failed"
    : verdicts.some((verdict) => verdict.status === "warning")
      ? "warning"
      : "passed";

const createVerdict = (
  qaAgentId: string,
  rawIssues: Array<{
    target: string;
    message: string;
    severity?: "info" | "warning" | "error" | "blocking";
    suggestion?: string;
    issueType?: string;
    retryable?: boolean;
  }> = [],
  score = rawIssues.length ? 72 : 100,
): QAVerdict => {
  const issues = rawIssues.map((issue, index) => normalizeProductionQAIssue({
    id: `${qaAgentId}-issue-${Date.now()}-${index}-${crypto.randomUUID()}`,
    severity: issue.severity || "warning",
    target: issue.target,
    message: issue.message,
    suggestion: issue.suggestion,
    issueType: issue.issueType,
    retryable: issue.retryable,
  }));
  const status = verdictStatus(issues);
  return {
    qaAgentId,
    status,
    blocking: issues.some((issue) => issue.severity === "blocking"),
    score: status === "failed" ? Math.min(score, 45) : score,
    issues,
    nextAction: status === "failed" ? "human_review" : "commit",
    createdAt: Date.now(),
  };
};

export const createSourceArtifact = (input: {
  kind: SourceArtifactKind;
  sourceType: string;
  sourceText: string;
  title?: string;
  authorizationStatus?: SourceAuthorizationStatus;
  rightsBoundary?: string;
  adaptationBoundary?: string;
  abstractionStrategy?: string;
}): SourceArtifact => {
  const sourceText = input.sourceText || "";
  const sourceHash = `src.${stableHash(`${input.kind}|${input.sourceType}|${sourceText}`)}`;
  return {
    id: `source-artifact-${Date.now()}-${crypto.randomUUID()}`,
    kind: input.kind,
    sourceType: input.sourceType,
    title: input.title,
    sourceHash,
    textPreview: sourceText.slice(0, MAX_SOURCE_PREVIEW_CHARS),
    textCharCount: sourceText.length,
    truncated: sourceText.length > MAX_SOURCE_PREVIEW_CHARS,
    truncationStrategy: sourceText.length > MAX_SOURCE_PREVIEW_CHARS
      ? `stored first ${MAX_SOURCE_PREVIEW_CHARS} chars; full text remains in local author draft only`
      : "not_truncated",
    authorizationStatus: input.authorizationStatus || "analysis_only",
    rightsBoundary: input.rightsBoundary || "仅作为作者提供的分析/改编输入；提交前需要作者确认拥有改编、分析或合理使用边界。",
    adaptationBoundary: input.adaptationBoundary || "只抽取结构、人物功能、冲突机制和视听策略；不得复制原作台词、专名场景或可识别桥段。",
    abstractionStrategy: input.abstractionStrategy || "abstract_only",
    createdAt: Date.now(),
  };
};

const sourceClearanceVerdict = (source: SourceArtifact) => createVerdict(
  "rights.source_clearance",
  [
    !source.sourceHash ? {
      target: "source.sourceHash",
      message: "SourceArtifact 缺少 hash，无法追踪来源。",
      severity: "blocking" as const,
      issueType: "contract",
    } : undefined,
    !source.textCharCount ? {
      target: "source.text",
      message: "来源文本为空，不能进入上游生产线。",
      severity: "blocking" as const,
      issueType: "input_missing",
      retryable: false,
    } : undefined,
    source.authorizationStatus === "unknown" ? {
      target: "source.authorizationStatus",
      message: "来源授权状态未知，进入正式项目前需要作者确认权利边界。",
      severity: "warning" as const,
      issueType: "rights",
    } : undefined,
    !source.adaptationBoundary ? {
      target: "source.adaptationBoundary",
      message: "缺少改编/抽象边界说明。",
      severity: "blocking" as const,
      issueType: "contract",
    } : undefined,
  ].filter(Boolean) as any[],
);

const noSourceCopyVerdict = (
  qaAgentId: string,
  source: SourceArtifact,
  value: unknown,
) => {
  const text = compactText(textOf(value));
  const sourceText = compactText(source.textPreview);
  const sourceTokens = sourceText
    .split(/[，。！？,.!?\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 12)
    .slice(0, 80);
  const copiedLongPhrases = sourceTokens.filter((token) => text.includes(token)).slice(0, 5);
  const concreteCopyCue = /原片|原作台词|逐字|照搬|复刻|同名角色|同名地点|直接引用|copy/i.test(text);
  return createVerdict(
    qaAgentId,
    [
      copiedLongPhrases.length ? {
        target: "draft.noSourceCopy",
        message: `草稿疑似保留来源长句：${copiedLongPhrases.join(" / ")}`,
        severity: "blocking" as const,
        suggestion: "改为抽象描述情绪、结构、节奏、镜头技法，不保留原文长句。",
        issueType: "policy_violation",
        retryable: false,
      } : undefined,
      concreteCopyCue ? {
        target: "draft.abstractionBoundary",
        message: "草稿包含直接复制或复刻来源的风险提示词。",
        severity: "warning" as const,
        suggestion: "改写为抽象技巧或功能，不描述原片人物、场景和台词。",
        issueType: "reference_copy_risk",
      } : undefined,
    ].filter(Boolean) as any[],
  );
};

const sourceArtifactVerdict = (source: SourceArtifact) => createVerdict(
  "qa.import.source_contract",
  [
    !source.sourceType ? {
      target: "source.sourceType",
      message: "SourceArtifact 缺少 sourceType。",
      severity: "blocking" as const,
      issueType: "contract",
    } : undefined,
    source.truncated && source.textPreview.length > MAX_SOURCE_PREVIEW_CHARS ? {
      target: "source.truncation",
      message: "SourceArtifact 截断策略不一致。",
      severity: "blocking" as const,
      issueType: "contract",
    } : undefined,
  ].filter(Boolean) as any[],
);

const defaultStagesForSkill = (_skill: UniversalSkillReference): ReferenceTargetStage[] => {
  return ["concept", "bible", "structure", "script", "storyboard", "prompt"];
};

const routingForSkill = (skill: UniversalSkillReference) => {
  const allowedStages = defaultStagesForSkill(skill);
  const allStages: ReferenceTargetStage[] = [
    "concept",
    "context_planning",
    "bible",
    "asset_detail",
    "structure",
    "scene",
    "script",
    "storyboard",
    "prompt",
    "interactive_bible",
    "game_blueprint",
    "graph_generation",
    "interactive_script",
    "interactive_storyboard",
  ];
  return {
    allowedStages,
    blockedStages: allStages.filter((stage) => !allowedStages.includes(stage)),
  };
};

const createGovernance = (
  source: SourceArtifact,
  verdicts: QAVerdict[],
  allowedStages: ReferenceTargetStage[],
  blockedStages: ReferenceTargetStage[],
  agentRunIds: string[] = [],
): ReferenceGovernanceMetadata => ({
  sourceArtifactId: source.id,
  sourceHash: source.sourceHash,
  sourceType: source.sourceType,
  authorizationStatus: source.authorizationStatus,
  rightsBoundary: source.rightsBoundary,
  adaptationBoundary: source.adaptationBoundary,
  abstractionStrategy: source.abstractionStrategy,
  noSourceCopyQaStatus: governanceStatus(verdicts.filter((verdict) => /copy|clearance|rights|source/.test(verdict.qaAgentId))),
  structureQaStatus: governanceStatus(verdicts.filter((verdict) => /structure|schema|contract|skill|import|analysis/.test(verdict.qaAgentId))),
  formatConflictQaStatus: governanceStatus(verdicts.filter((verdict) => /format|compatibility|conflict/.test(verdict.qaAgentId))),
  routingQaStatus: governanceStatus(verdicts.filter((verdict) => /routing|reference|contamination|compatibility/.test(verdict.qaAgentId))),
  allowedStages,
  blockedStages,
  contaminationBoundary: allowedStages.length
    ? `只允许注入：${allowedStages.join(", ")}。不允许作为全局事实覆盖项目设定。`
    : "未通过 routing QA，不允许进入 ContextPlan。",
  qaIssueFingerprints: Array.from(new Set(verdicts.flatMap((verdict) => verdict.issues.map((issue) => issue.fingerprint).filter(Boolean) as string[]))),
  provenanceAgentRunIds: agentRunIds,
  createdAt: Date.now(),
});

const attachGovernance = <T extends Record<string, any>>(
  value: T,
  governance: ReferenceGovernanceMetadata,
) => ({
  ...value,
  referenceGovernance: governance,
});

export const createSourceGovernanceDraft = async (input: {
  kind: SourceArtifactKind;
  sourceType: SourceType | string;
  sourceText: string;
  title?: string;
  authorizationStatus?: SourceAuthorizationStatus;
}) => {
  const sourceArtifact = createSourceArtifact({
    kind: input.kind,
    sourceType: input.sourceType,
    sourceText: input.sourceText,
    title: input.title,
    authorizationStatus: input.authorizationStatus,
  });
  const gateway = await runAgentGatewayStep({
    workflowStepId: "import.source_intake",
    input,
    artifactKind: "source_artifact",
    targetPath: "adaptation.sourceArtifact",
    producer: () => sourceArtifact,
    qaHandlers: {
      "rights.source_clearance": () => sourceClearanceVerdict(sourceArtifact),
      "qa.import.source_contract": () => sourceArtifactVerdict(sourceArtifact),
    },
  });
  const governance = createGovernance(
    sourceArtifact,
    gateway.qaVerdicts,
    ["concept", "bible", "structure", "script"],
    ["prompt"],
    [gateway.agentRunId],
  );
  return {
    sourceArtifact,
    envelope: gateway.draft,
    qaVerdicts: gateway.qaVerdicts,
    governance,
  } satisfies GovernedDraft<SourceArtifact>;
};

export const validateAdaptationAssets = (
  assets: GlobalAssets,
  existing: { characterNames?: string[]; locationNames?: string[] } = {},
) => {
  const characterNames = new Set((existing.characterNames || []).map((name) => name.trim().toLowerCase()));
  const locationNames = new Set((existing.locationNames || []).map((name) => name.trim().toLowerCase()));
  const seenCharacters = new Set<string>();
  const seenLocations = new Set<string>();
  const dedupedCharacters = (assets.characters || []).filter((character) => {
    const key = character.name.trim().toLowerCase();
    if (!key || characterNames.has(key) || seenCharacters.has(key)) return false;
    seenCharacters.add(key);
    return true;
  });
  const dedupedLocations = (assets.locations || []).filter((location) => {
    const key = location.name.trim().toLowerCase();
    if (!key || locationNames.has(key) || seenLocations.has(key)) return false;
    seenLocations.add(key);
    return true;
  });
  const verdict = createVerdict("qa.import.asset_dedup_and_conflict", [
    dedupedCharacters.length < (assets.characters || []).length ? {
      target: "globalAssets.characters",
      message: "魔法导入资产存在重复角色，已从 draft 中排除重复项。",
      severity: "warning" as const,
      suggestion: "人工确认同名角色是否应该合并或改名。",
      issueType: "data_conflict",
    } : undefined,
    dedupedLocations.length < (assets.locations || []).length ? {
      target: "globalAssets.locations",
      message: "魔法导入资产存在重复地点，已从 draft 中排除重复项。",
      severity: "warning" as const,
      suggestion: "人工确认同名地点是否应该合并或改名。",
      issueType: "data_conflict",
    } : undefined,
    !assets.logline ? {
      target: "globalAssets.logline",
      message: "资产草稿缺少 logline。",
      severity: "warning" as const,
      suggestion: "补充一句带主角、目标、阻力和代价的 logline。",
      issueType: "schema",
    } : undefined,
  ].filter(Boolean) as any[]);
  return {
    assets: {
      ...assets,
      characters: dedupedCharacters,
      locations: dedupedLocations,
    },
    verdict,
  };
};

export const validateAdaptationBeatDraft = (
  beats: Beat[],
  targetFormat: TargetFormat,
) => {
  const count = beats.length;
  const expected = targetFormat === "movie"
    ? { min: 8, max: 12 }
    : targetFormat === "tv-series"
      ? { min: 4, max: 8 }
      : { min: 4, max: 6 };
  return createVerdict("qa.import.format_and_fidelity", [
    count < expected.min || count > expected.max ? {
      target: "beatSheet.length",
      message: `${targetFormat} 节拍数量应为 ${expected.min}-${expected.max}，当前为 ${count}。`,
      severity: "warning" as const,
      suggestion: "按目标格式重排 beat 数量。",
      issueType: "format",
    } : undefined,
    targetFormat === "short-drama" && beats.some((beat) => !beat.isCliffhanger) ? {
      target: "beatSheet.cliffhanger",
      message: "短剧导入节拍存在未标记 cliffhanger 的集。",
      severity: "warning" as const,
      suggestion: "给每集加入明确钩子或改为非短剧格式。",
      issueType: "format",
    } : undefined,
  ].filter(Boolean) as any[]);
};

export const validateAdaptationScriptDraft = (beats: Beat[]) => createVerdict(
  "qa.import.scene_script_contract",
  [
    beats.length === 0 ? {
      target: "beatSheet",
      message: "剧本投影缺少 beatSheet。",
      severity: "blocking" as const,
      issueType: "input_missing",
      retryable: false,
    } : undefined,
    beats.some((beat) => beat.status === "completed" && (!beat.generatedScript || beat.generatedScript.length === 0)) ? {
      target: "beatSheet.generatedScript",
      message: "存在已完成 beat 但 generatedScript 为空。",
      severity: "blocking" as const,
      issueType: "schema",
    } : undefined,
  ].filter(Boolean) as any[],
);

const governSkillForIntake = <T extends Record<string, any>>(skill: T): T => {
  const title = skillTitleText(skill);
  const body = skillBodyText(skill);
  const sourceType = skill.source || skill.sourceType || "manual";
  const source = createSourceArtifact({
    kind: "skill_source",
    sourceType,
    sourceText: [title, body].join("\n"),
    title,
    authorizationStatus: sourceType === "manual" || sourceType === "ai" || sourceType === "custom"
      ? "owned_or_licensed"
      : "analysis_only",
  });
  const structureVerdict = createVerdict("qa.skill.content_presence", [
    !body ? { target: "skill.content", message: "Skill 缺少正文内容。", severity: "warning" as const, issueType: "schema" } : undefined,
  ].filter(Boolean) as any[]);
  const { allowedStages, blockedStages } = routingForSkill({
    id: skill.id,
    title,
    content: body,
    source: sourceType,
  } as UniversalSkillReference);
  const compatibilityVerdict = createVerdict("qa.skill.format_conflict", []);
  const routingVerdict = createVerdict("qa.reference.contamination", [
    allowedStages.length === 0 ? {
      target: "skill.routing",
      message: "Skill 没有可注入阶段，不能进入 ContextPlan。",
      severity: "blocking" as const,
      issueType: "routing",
    } : undefined,
  ].filter(Boolean) as any[]);
  const governance = createGovernance(
    source,
    [sourceClearanceVerdict(source), structureVerdict, compatibilityVerdict, routingVerdict],
    allowedStages,
    blockedStages,
  );
  return attachGovernance(skill, governance);
};

export const governUniversalSkillForIntake = (skill: UniversalSkillReference): UniversalSkillReference =>
  governSkillForIntake(skill);

const videoAnalysisSkillAsUniversalReference = (skill: VideoAnalysisSkill): UniversalSkillReference => ({
  id: skill.id,
  title: skill.name || "未命名拉片参考",
  content: [
    skill.description,
    skill.narrative?.themeFocus?.length ? `主题焦点：${skill.narrative.themeFocus.join("、")}` : "",
    skill.narrative?.characterArchetypes ? `人物方法：${skill.narrative.characterArchetypes}` : "",
    skill.narrative?.conflictMechanics ? `冲突机制：${skill.narrative.conflictMechanics}` : "",
    skill.narrative?.dialogueStyle ? `对白方式：${skill.narrative.dialogueStyle}` : "",
    skill.narrative?.pacingAndStructure ? `节奏结构：${skill.narrative.pacingAndStructure}` : "",
    skill.directing?.colorPalette ? `色彩倾向：${skill.directing.colorPalette}` : "",
    skill.directing?.cameraMovement ? `镜头运动：${skill.directing.cameraMovement}` : "",
    skill.directing?.shotSizePreference ? `景别偏好：${skill.directing.shotSizePreference}` : "",
    skill.directing?.lightingStyle ? `光线方式：${skill.directing.lightingStyle}` : "",
    skill.audioEditorial?.editingRhythm ? `剪辑节奏：${skill.audioEditorial.editingRhythm}` : "",
  ].filter(Boolean).join("\n"),
  source: "video-analysis",
  sourceProjectId: skill.sourceProjectId,
  createdAt: skill.createdAt,
  updatedAt: skill.updatedAt,
});

export const governVideoAnalysisSkillForIntake = (skill: VideoAnalysisSkill): VideoAnalysisSkill => {
  const governedReference = governUniversalSkillForIntake(videoAnalysisSkillAsUniversalReference(skill));
  return attachGovernance(skill, governedReference.referenceGovernance!);
};

export const governExtractedBeatTemplate = (
  dna: ExtractedBeatTemplate,
  sourceText: string,
) => {
  const source = createSourceArtifact({
    kind: "video_dna_source",
    sourceType: "video_dna",
    sourceText,
    title: dna.sourceVideoName,
    authorizationStatus: "analysis_only",
  });
  const schemaVerdict = createVerdict("qa.dna.no_source_copying", [
    !dna.beats?.length ? {
      target: "dna.beats",
      message: "ExtractedBeatTemplate 缺少 beats。",
      severity: "blocking" as const,
      issueType: "schema",
    } : undefined,
  ].filter(Boolean) as any[]);
  const noCopy = noSourceCopyVerdict("qa.dna.no_source_copying", source, dna);
  const governance = createGovernance(
    source,
    [sourceClearanceVerdict(source), schemaVerdict, noCopy],
    ["structure", "scene", "script", "storyboard", "interactive_storyboard"],
    ["bible", "asset_detail"],
  );
  return attachGovernance(dna, governance);
};

export const governAnalysisSegmentResult = (
  project: VideoAnalysisProject,
  segment: AnalysisSegment,
  analysisResult: NonNullable<AnalysisSegment["analysisResult"]>,
) => {
  const source = createSourceArtifact({
    kind: "video_analysis_segment",
    sourceType: segment.mediaType,
    sourceText: segment.sourceContent || segment.title,
    title: `${project.title} / ${segment.title}`,
    authorizationStatus: "analysis_only",
  });
  const schemaVerdict = createVerdict("qa.analysis.segment_schema", [
    !analysisResult.overview ? { target: "analysisResult.overview", message: "片段分析缺少 overview。", severity: "warning" as const, issueType: "schema" } : undefined,
    !analysisResult.rhythmWaves ? { target: "analysisResult.rhythmWaves", message: "片段分析缺少 rhythmWaves。", severity: "warning" as const, issueType: "schema" } : undefined,
    !analysisResult.sceneLogic ? { target: "analysisResult.sceneLogic", message: "片段分析缺少 sceneLogic。", severity: "warning" as const, issueType: "schema" } : undefined,
  ].filter(Boolean) as any[]);
  const noCopy = noSourceCopyVerdict("qa.analysis.segment_schema", source, analysisResult);
  const governance = createGovernance(
    source,
    [sourceClearanceVerdict(source), schemaVerdict, noCopy],
    ["structure", "scene", "script", "storyboard", "prompt"],
    ["bible", "asset_detail"],
  );
  return {
    ...analysisResult,
    sourceArtifact: source,
    qaVerdicts: [schemaVerdict, noCopy],
    referenceGovernance: governance,
  };
};

export const governMacroDNA = (
  project: VideoAnalysisProject,
  macroDNA: NonNullable<VideoAnalysisProject["macroDNA"]>,
  segments: AnalysisSegment[],
) => {
  const sourceArtifacts = segments
    .map((segment) => segment.analysisResult?.sourceArtifact)
    .filter(Boolean) as SourceArtifact[];
  const source = createSourceArtifact({
    kind: "video_analysis_segment",
    sourceType: "macro_dna",
    sourceText: segments.map((segment) => `${segment.title}\n${textOf(segment.analysisResult)}`).join("\n\n"),
    title: `${project.title} / macroDNA`,
    authorizationStatus: "analysis_only",
  });
  const evidenceIds = segments.filter((segment) => segment.analysisResult).map((segment) => segment.id);
  const verdict = createVerdict("qa.analysis.macro_dna_abstraction", [
    evidenceIds.length < 2 ? {
      target: "macroDNA.evidenceSegmentIds",
      message: "macroDNA 少于 2 个片段证据，容易变成自由发挥。",
      severity: "warning" as const,
      suggestion: "至少完成两个 segment 分析后再作为强参考使用。",
      issueType: "evidence",
    } : undefined,
    !macroDNA.overview || !macroDNA.structureSkeleton || !macroDNA.commonBeats ? {
      target: "macroDNA.schema",
      message: "macroDNA 缺少 overview/structureSkeleton/commonBeats 的最小字段。",
      severity: "blocking" as const,
      issueType: "schema",
    } : undefined,
  ].filter(Boolean) as any[]);
  const noCopy = noSourceCopyVerdict("qa.analysis.macro_dna_abstraction", source, macroDNA);
  const governance = createGovernance(
    source,
    [verdict, noCopy],
    ["structure", "scene", "script", "storyboard", "prompt"],
    ["bible", "asset_detail"],
  );
  return {
    ...macroDNA,
    evidenceSegmentIds: evidenceIds,
    sourceArtifacts,
    qaVerdicts: [verdict, noCopy],
    referenceGovernance: governance,
  };
};

export const isReferenceAllowedForContext = (item: { referenceGovernance?: ReferenceGovernanceMetadata }) => {
  const governance = item.referenceGovernance;
  if (!governance) return true;
  return governance.routingQaStatus !== "failed" && governance.noSourceCopyQaStatus !== "failed";
};

export const ensureSkillReferenceRouting = (skill: UniversalSkillReference): UniversalSkillReference => {
  if (skill.referenceGovernance) return skill;
  return governUniversalSkillForIntake(skill);
};

export const routeProjectReferencesForContext = (project: Pick<Project, "universalSkillRefs" | "extractedDNAs">) => ({
  universalSkillRefs: projectUniversalSkillRefs(project).map(ensureSkillReferenceRouting).filter(isReferenceAllowedForContext),
  extractedDNAs: (project.extractedDNAs || []).filter(isReferenceAllowedForContext),
});

export const buildAdaptationDraftPackage = async (input: {
  sourceText: string;
  sourceType: SourceType;
  targetFormat: TargetFormat;
  globalAssets: GlobalAssets;
  beatSheet: Beat[];
}) => {
  const sourceDraft = await createSourceGovernanceDraft({
    kind: "adaptation_source",
    sourceType: input.sourceType,
    sourceText: input.sourceText,
    title: "magic-import-source",
  });
  const assetVerdict = validateAdaptationAssets(input.globalAssets).verdict;
  const beatVerdict = validateAdaptationBeatDraft(input.beatSheet, input.targetFormat);
  const scriptVerdict = validateAdaptationScriptDraft(input.beatSheet);
  return {
    sourceArtifact: sourceDraft.sourceArtifact,
    sourceEnvelope: sourceDraft.envelope,
    sourceGovernance: sourceDraft.governance,
    assetDraft: {
      status: assetVerdict.blocking ? "qa_failed" : "approved",
      data: input.globalAssets,
      qaVerdicts: [assetVerdict],
    },
    beatDraft: {
      status: beatVerdict.blocking ? "qa_failed" : "approved",
      data: input.beatSheet,
      qaVerdicts: [beatVerdict],
    },
    scriptDraft: {
      status: scriptVerdict.blocking ? "qa_failed" : "approved",
      data: input.beatSheet.map((beat) => ({ beatId: beat.id, generatedScript: beat.generatedScript || [] })),
      qaVerdicts: [scriptVerdict],
    },
  };
};
