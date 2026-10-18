import {
  ProductionGateId,
  ProductionGateVerdict,
  ProductionQAIssue,
  ProductionQAReport,
  ProductionReviewMode,
  ProductionRun,
  ProductionStageExecutionResult,
  ProductionStageRun,
  ProductionStageType,
} from "../../types/production";
import { normalizeProductionQAIssue, normalizeProductionQAIssues } from "./qaIssue";

export interface ProductionGateDefinition {
  id: ProductionGateId;
  label: string;
  stages: ProductionStageType[];
  minReviewMode: ProductionReviewMode;
  blockingByDefault: boolean;
  prompt: string;
}

export interface ProductionGateEvaluationContext {
  result?: ProductionStageExecutionResult;
  qaReports?: ProductionQAReport[];
  stageBlocking?: boolean;
}

const modeRank: Record<ProductionReviewMode, number> = {
  fast: 0,
  lean: 1,
  full: 2,
};

export const shouldRunGate = (
  reviewMode: ProductionReviewMode,
  gate: ProductionGateDefinition,
) => modeRank[reviewMode] >= modeRank[gate.minReviewMode];

export const productionGateRegistry: ProductionGateDefinition[] = [
  {
    id: "CONTRACT",
    label: "结构契约检查",
    stages: [
      "intake",
      "concept",
      "context_planning",
      "bible",
      "asset_detail",
      "structure",
      "scene",
      "script",
      "script_lock",
      "content_lock",
      "production_breakdown",
      "production_asset_detail",
      "asset_sync",
      "storyboard",
      "prompt",
      "expensive_generation_planning",
      "interactive_bible",
      "game_blueprint",
      "graph_generation",
      "interactive_graph_qa",
      "node_to_scene",
      "interactive_script",
      "interactive_storyboard",
      "playtest_simulation",
    ],
    minReviewMode: "fast",
    blockingByDefault: true,
    prompt: "检查阶段数据结构是否满足系统契约，失败时必须阻断自动推进。",
  },
  {
    id: "CREATIVE_QUALITY",
    label: "创作强度门禁",
    stages: ["concept", "structure", "scene", "script", "production_breakdown", "production_asset_detail", "storyboard", "prompt", "interactive_script", "interactive_storyboard"],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查作品是否具备明确 Want/Need/Stakes、场景价值转换、可拍摄行动、镜头信息递进、短剧钩子或互动选择质量。",
  },
  {
    id: "TRANSPARENCY",
    label: "可解释自动化门禁",
    stages: [
      "intake",
      "concept",
      "context_planning",
      "bible",
      "asset_detail",
      "structure",
      "scene",
      "script",
      "script_lock",
      "content_lock",
      "production_breakdown",
      "production_asset_detail",
      "asset_sync",
      "storyboard",
      "prompt",
      "expensive_generation_planning",
      "interactive_bible",
      "game_blueprint",
      "graph_generation",
      "interactive_graph_qa",
      "node_to_scene",
      "interactive_script",
      "interactive_storyboard",
      "playtest_simulation",
    ],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查最终 Prompt、模板 trace、输出 schema、ContextPlan 字段范围和参考源注入是否可追踪，避免作者只能看到黑盒结果。",
  },
  {
    id: "FORMAT_STANDARDS",
    label: "类型标准评分门禁",
    stages: [
      "concept",
      "structure",
      "scene",
      "script",
      "script_lock",
      "content_lock",
      "production_breakdown",
      "production_asset_detail",
      "storyboard",
      "prompt",
      "interactive_bible",
      "game_blueprint",
      "graph_generation",
      "interactive_graph_qa",
      "interactive_script",
      "interactive_storyboard",
      "playtest_simulation",
    ],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "按电影、电视剧、短剧、微短剧、互动游戏的独立标准评分，不把所有类型混进同一个通用创作强度门禁。",
  },
  {
    id: "CONCEPT",
    label: "立项概念门禁",
    stages: ["concept"],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查 logline、核心冲突、人物目标、类型承诺和可拍摄性。",
  },
  {
    id: "CONTEXT",
    label: "上下文污染门禁",
    stages: ["context_planning"],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查 Skill 与拉片 DNA 是否按用途分层，是否存在全量污染上下文风险。",
  },
  {
    id: "BIBLE",
    label: "项目圣经门禁",
    stages: ["bible", "interactive_bible"],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查角色、世界观、地点、道具是否服务剧情且不互相冲突。",
  },
  {
    id: "SCRIPT",
    label: "剧本门禁",
    stages: ["script", "script_lock", "content_lock", "production_breakdown", "production_asset_detail", "interactive_script"],
    minReviewMode: "lean",
    blockingByDefault: true,
    prompt: "检查结构化剧本、breakdown、人物目标连续性、可拍摄动作和对白角色区分。",
  },
  {
    id: "STORYBOARD",
    label: "分镜覆盖门禁",
    stages: ["storyboard", "interactive_storyboard"],
    minReviewMode: "lean",
    blockingByDefault: true,
    prompt: "检查镜头是否覆盖剧本、时长是否合理、角色/地点/道具引用是否可解析。",
  },
  {
    id: "PROMPT",
    label: "提示词可生成性门禁",
    stages: ["prompt", "interactive_storyboard"],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查 image/video prompt 是否视觉化、模型适配、锚点明确且没有全局语言污染。",
  },
  {
    id: "GRAPH",
    label: "互动图谱门禁",
    stages: ["graph_generation", "interactive_graph_qa"],
    minReviewMode: "fast",
    blockingByDefault: true,
    prompt: "检查断边、不可达节点、变量引用、结局数量、悬空节点和可玩路径。",
  },
  {
    id: "PLAYTEST",
    label: "自动 Playtest 门禁",
    stages: ["playtest_simulation"],
    minReviewMode: "lean",
    blockingByDefault: false,
    prompt: "检查 Golden Path、结局覆盖、循环路径和变量边界模拟结果。",
  },
  {
    id: "MEDIA",
    label: "媒体生成就绪检查",
    stages: ["expensive_generation_planning"],
    minReviewMode: "fast",
    blockingByDefault: true,
    prompt: "检查生图、视频和音频队列是否具备完整提示词、参考图依赖和生成参数。",
  },
];

export const getGatesForStage = (
  stageType: ProductionStageType,
  reviewMode: ProductionReviewMode,
) =>
  productionGateRegistry.filter(
    (gate) => gate.stages.includes(stageType) && shouldRunGate(reviewMode, gate),
  );

const makeGateIssue = (
  gateId: ProductionGateId,
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "blocking",
  suggestion?: string,
): ProductionQAIssue => ({
  ...normalizeProductionQAIssue({
    id: `gate-${gateId.toLowerCase()}-${Date.now()}-${crypto.randomUUID()}`,
    target,
    message,
    severity,
    suggestion,
    issueType: gateId.toLowerCase(),
  }),
});

const hasArtifact = (
  result: ProductionStageExecutionResult | undefined,
  artifactType: ProductionStageExecutionResult["artifacts"][number]["artifactType"],
) => result?.artifacts.some((artifact) => artifact.artifactType === artifactType);

const artifactIds = (
  result: ProductionStageExecutionResult | undefined,
  artifactType: ProductionStageExecutionResult["artifacts"][number]["artifactType"],
) =>
  result?.artifacts
    .filter((artifact) => artifact.artifactType === artifactType)
    .flatMap((artifact) => artifact.entityIds || []) || [];

const inheritedBlockingIssues = (
  gateId: ProductionGateId,
  qaReports: ProductionQAReport[] = [],
) =>
  qaReports
    .flatMap((report) => report.issues || [])
    .filter((issue) => issue.severity === "blocking")
    .map((issue) => ({
      ...issue,
      id: `gate-${gateId.toLowerCase()}-inherited-${issue.id}`,
      target: issue.target || "stage.qa",
    }));

const snapshotObject = (result?: ProductionStageExecutionResult) =>
  result?.outputSnapshot && typeof result.outputSnapshot === "object"
    ? result.outputSnapshot as Record<string, any>
    : {};

const scoreFromIssues = (issues: ProductionQAIssue[], fallback = 100) => {
  if (issues.some((issue) => issue.severity === "blocking")) return 0;
  return Math.max(
    0,
    fallback -
      issues.filter((issue) => issue.severity === "error").length * 20 -
      issues.filter((issue) => issue.severity === "warning").length * 8,
  );
};

const evaluateContractGate = (
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] =>
  context.stageBlocking
    ? [makeGateIssue("CONTRACT", "stage.contract", "阶段结构契约检查存在阻断问题。")]
    : [];

const creativeIssueTargets = [
  "creativeVision.conceptContract",
  "coreConflict",
  "valueShift",
  "shortDrama",
  "microShort",
  "showDontTell",
  "dialogueVoice",
  "visualAction",
  "prompt.abstract",
  "choices.fake",
  "choices.impact",
];

const formatIssueTargets = [
  "format.movie",
  "format.tv",
  "format.shortDrama",
  "format.microShort",
  "format.interactive",
];

const evaluateCreativeQualityGate = (
  stage: ProductionStageRun,
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  const issues: ProductionQAIssue[] = (context.qaReports || [])
    .flatMap((report) => report.issues || [])
    .filter((issue) => creativeIssueTargets.some((target) => issue.target.includes(target)))
    .map((issue) => ({
      ...issue,
      id: `gate-creative_quality-inherited-${issue.id}`,
    }));

  const snapshot = snapshotObject(context.result);
  if (stage.stageType === "concept") {
    const creativeVision = snapshot.creativeVision || {};
    const missingConceptFields = [
      "want",
      "need",
      "stakes",
      "oppositionForce",
      "themeQuestion",
      "protagonistArc",
      "emotionalReward",
    ].filter((field) => !String(creativeVision[field] || "").trim());
    if (missingConceptFields.length > 0) {
      issues.push(makeGateIssue(
        "CREATIVE_QUALITY",
        "concept.creativeVision.contract",
        `创作强度门禁缺少 Concept 强约束字段：${missingConceptFields.join(", ")}。`,
        "blocking",
        "Concept 必须输出 want、need、stakes、oppositionForce、themeQuestion、protagonistArc、emotionalReward。",
      ));
    }
  }

  if (stage.stageType === "scene") {
    const episodeOutputs = Array.isArray(context.result?.outputSnapshot) ? context.result?.outputSnapshot as any[] : [];
    const scenes = episodeOutputs.flatMap((episode) => Array.isArray(episode.scenes) ? episode.scenes : []);
    const missingValueShift = scenes.filter((scene) => !scene.valueShift?.from || !scene.valueShift?.to || !scene.valueShift?.reason);
    if (missingValueShift.length > 0) {
      issues.push(makeGateIssue(
        "CREATIVE_QUALITY",
        "scene.valueShift",
        `创作强度门禁发现 ${missingValueShift.length} 个场景缺少价值转换。`,
        "warning",
        "为每个场景补充 valueShift.from/to/reason，证明这场戏不是原地踏步。",
      ));
    }
  }

  return issues;
};

const evaluateFormatStandardsGate = (
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  return (context.qaReports || [])
    .flatMap((report) => report.issues || [])
    .filter((issue) => formatIssueTargets.some((target) => issue.target.includes(target)))
    .map((issue) => ({
      ...issue,
      id: `gate-format_standards-inherited-${issue.id}`,
    }));
};

const contextTraceFromResult = (result?: ProductionStageExecutionResult) => {
  const contextUsed = result?.contextUsed;
  const contextTrace =
    contextUsed && typeof contextUsed === "object" && "contextTrace" in contextUsed
      ? (contextUsed as { contextTrace?: Record<string, unknown> }).contextTrace
      : undefined;
  return {
    fieldScope: Array.isArray(contextTrace?.fieldScope) ? contextTrace.fieldScope : [],
    skillIds: Array.isArray(contextTrace?.skillIds) ? contextTrace.skillIds : [],
    omittedProjectContext: Array.isArray(contextTrace?.omittedProjectContext) ? contextTrace.omittedProjectContext : [],
  };
};

const evaluateTransparencyGate = (
  run: ProductionRun,
  stage: ProductionStageRun,
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  const result = context.result;
  const contextTrace = contextTraceFromResult(result);
  const issues: ProductionQAIssue[] = [];
  if ((result.modelUsed || stage.modelUsed) && !result.promptUsed && !stage.promptUsed) {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.prompt",
      "模型阶段缺少最终 Prompt 记录，作者无法完整复盘生成过程。",
      "warning",
      "把最终 prompt、上下文和模板变量写入阶段记录，超长时至少保留结构化压缩版。",
    ));
  }
  if (!result.templateUsed) {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.template",
      "当前阶段仍由 runner inline prompt 驱动，缺少版本化模板 trace。",
      "warning",
      "迁移到统一 Template Loader，并把模板 ID、版本和来源写入 Production Manifest。",
    ));
  }
  if (result.templateUsed && !result.templateUsed.metadata?.outputSchema.length) {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.outputContract",
      "模板缺少输出 schema，作者无法明确知道本阶段应该生成哪些字段。",
      "warning",
      "为模板补充 outputSchema、qaRules 和 languagePolicy 元数据。",
    ));
  }
  (result.templateUsed?.metadataWarnings || []).forEach((warning) => {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.template.metadataWarnings",
      warning,
      "warning",
    ));
  });
  if (stage.stageType !== "intake" && contextTrace.fieldScope.length === 0) {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.context.fieldScope",
      "缺少 ContextPlan 字段范围 trace，作者看不到本阶段实际用了哪些项目资料。",
      "warning",
      "通过 ContextPlan 渲染器记录 fieldScope、skillIds、dnaIds 和语言策略。",
    ));
  }
  if (run.contextPlan.globalSkills.length > 0 && contextTrace.skillIds.length === 0) {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.references.skillTrace",
      "项目存在 universalSkillRefs，但本阶段没有记录实际 Skill 注入。",
      "warning",
      "如果参考源确实不适用于本阶段，也要在 explainability.notUsed 里说明。",
    ));
  }
  if (contextTrace.omittedProjectContext.length > 0) {
    issues.push(makeGateIssue(
      "TRANSPARENCY",
      "manifest.context.omittedProjectContext",
      `上下文遗漏报告发现 ${contextTrace.omittedProjectContext.join(", ")} 存在于项目中，但没有进入本阶段字段范围。`,
      "warning",
      "若本阶段确实不需要这些资料，应在说明书中解释；若需要，则调整 ContextPlan 字段白名单。",
    ));
  }
  return issues;
};

const requireArtifact = (
  context: ProductionGateEvaluationContext,
  gateId: ProductionGateId,
  artifactType: ProductionStageExecutionResult["artifacts"][number]["artifactType"],
  message: string,
): ProductionQAIssue[] =>
  hasArtifact(context.result, artifactType)
    ? []
    : [makeGateIssue(gateId, `artifacts.${artifactType}`, message)];

const evaluateScriptGate = (
  stage: ProductionStageRun,
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  const issues: ProductionQAIssue[] = [...inheritedBlockingIssues("SCRIPT", context.qaReports)];
  if (stage.stageType === "script" || stage.stageType === "interactive_script") {
    issues.push(
      ...requireArtifact(context, "SCRIPT", "script", "剧本阶段没有产出 script artifact。"),
      ...requireArtifact(context, "SCRIPT", "breakdown", "剧本阶段没有产出 breakdown artifact。"),
    );
  } else if (stage.stageType === "script_lock") {
    issues.push(
      ...requireArtifact(context, "SCRIPT", "script_lock_package", "剧本锁定阶段没有产出 script_lock_package artifact。"),
      ...requireArtifact(context, "SCRIPT", "production_block_lock", "剧本锁定阶段没有产出 production_block_lock artifact。"),
    );
  } else if (stage.stageType === "content_lock") {
    issues.push(
      ...requireArtifact(context, "SCRIPT", "content_lock_package", "内容锁定阶段没有产出 content_lock_package artifact。"),
      ...requireArtifact(context, "SCRIPT", "production_block_lock", "内容锁定阶段没有产出 production_block_lock artifact。"),
    );
  } else if (stage.stageType === "production_breakdown") {
    issues.push(
      ...requireArtifact(context, "SCRIPT", "production_breakdown_report", "生产拆解阶段没有产出 production_breakdown_report artifact。"),
      ...requireArtifact(context, "SCRIPT", "continuity_matrix", "生产拆解阶段没有产出 continuity_matrix artifact。"),
    );
  } else if (stage.stageType === "production_asset_detail") {
    issues.push(
      ...requireArtifact(context, "SCRIPT", "asset_board_plan", "正式资产细化阶段没有产出 asset_board_plan artifact。"),
      ...requireArtifact(context, "SCRIPT", "formal_asset_package", "正式资产细化阶段没有产出 formal_asset_package artifact。"),
    );
  }
  if (hasArtifact(context.result, "script") && artifactIds(context.result, "script").length === 0) {
    issues.push(makeGateIssue("SCRIPT", "artifacts.script.entityIds", "script artifact 没有关联任何场景或节点。", "warning"));
  }
  return issues;
};

const evaluateStoryboardGate = (
  stage: ProductionStageRun,
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  const issues: ProductionQAIssue[] = [...inheritedBlockingIssues("STORYBOARD", context.qaReports)];
  if (!hasArtifact(context.result, "storyboard")) {
    issues.push(makeGateIssue("STORYBOARD", "artifacts.storyboard", "分镜阶段没有产出 storyboard artifact。"));
  }
  if (hasArtifact(context.result, "storyboard") && artifactIds(context.result, "storyboard").length === 0) {
    issues.push(makeGateIssue("STORYBOARD", "artifacts.storyboard.entityIds", "storyboard artifact 没有关联任何场景或节点。", "warning"));
  }
  if (stage.stageType === "storyboard" && !hasArtifact(context.result, "storyboard_board")) {
    issues.push(makeGateIssue("STORYBOARD", "artifacts.storyboard_board", "分镜阶段没有产出 storyboard_board 草案。", "warning"));
  }
  if (stage.stageType === "interactive_storyboard") {
    if (!hasArtifact(context.result, "image_prompt") || !hasArtifact(context.result, "video_prompt")) {
      issues.push(makeGateIssue("STORYBOARD", "artifacts.interactivePrompts", "互动分镜阶段必须同时产出图片和视频提示词 artifact。"));
    }
    const snapshot = snapshotObject(context.result);
    if (Number(snapshot.discardedMediaUrlCount || 0) > 0) {
      issues.push(makeGateIssue("STORYBOARD", "outputSnapshot.discardedMediaUrlCount", "互动分镜丢弃了 LLM 返回的伪媒体 URL。", "warning"));
    }
  }
  return issues;
};

const evaluatePromptGate = (
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  const issues: ProductionQAIssue[] = [...inheritedBlockingIssues("PROMPT", context.qaReports)];
  if (!hasArtifact(context.result, "image_prompt")) {
    issues.push(makeGateIssue("PROMPT", "artifacts.image_prompt", "提示词阶段没有产出 image_prompt artifact。"));
  }
  if (!hasArtifact(context.result, "video_prompt")) {
    issues.push(makeGateIssue("PROMPT", "artifacts.video_prompt", "提示词阶段没有产出 video_prompt artifact。"));
  }
  if (!hasArtifact(context.result, "asset_reference_pack")) {
    issues.push(makeGateIssue("PROMPT", "artifacts.asset_reference_pack", "提示词阶段没有产出 asset_reference_pack 草案。", "warning"));
  }
  const snapshot = snapshotObject(context.result);
  const shotsNeedingPromptIds = Array.isArray(snapshot.shotsNeedingPromptIds) ? snapshot.shotsNeedingPromptIds : [];
  const updatedShotIds = Array.isArray(snapshot.updatedShotIds) ? snapshot.updatedShotIds : [];
  if (shotsNeedingPromptIds.length > 0 && updatedShotIds.length === 0) {
    issues.push(makeGateIssue(
      "PROMPT",
      "outputSnapshot.updatedShotIds",
      `提示词 gate 发现 ${shotsNeedingPromptIds.length} 个镜头需要提示词，但本阶段没有写入任何有效提示词。`,
      "blocking",
      "检查模型返回 JSON 的 shot id 与输入镜头是否一致。",
    ));
  }
  const promptLanguageIssues = (context.qaReports || [])
    .flatMap((report) => report.issues || [])
    .filter((issue) => issue.target.includes("prompt.language"));
  issues.push(...promptLanguageIssues);
  return issues;
};

const evaluatePlaytestGate = (
  context: ProductionGateEvaluationContext,
): { issues: ProductionQAIssue[]; score?: number } => {
  if (!context.result) return { issues: [] };
  const snapshot = snapshotObject(context.result);
  const assemblyReport = snapshot.assemblyReport || {};
  const issues: ProductionQAIssue[] = [...inheritedBlockingIssues("PLAYTEST", context.qaReports)];
  const totalPathCount = Number(assemblyReport.totalPathCount || 0);
  const playablePathCount = Number(assemblyReport.playablePathCount || 0);
  const blockingCount = Number(assemblyReport.blockingCount || 0);
  const warningCount = Number(assemblyReport.warningCount || 0);
  if (totalPathCount > 0 && playablePathCount === 0) {
    issues.push(makeGateIssue("PLAYTEST", "assemblyReport.playablePathCount", "没有任何完整可播放路径。"));
  }
  if (blockingCount > 0) {
    issues.push(makeGateIssue("PLAYTEST", "assemblyReport.blockingCount", `Playtest 发现 ${blockingCount} 个阻断问题。`));
  }
  if (warningCount > 0) {
    issues.push(makeGateIssue("PLAYTEST", "assemblyReport.warningCount", `Playtest 发现 ${warningCount} 个警告问题。`, "warning"));
  }
  return {
    issues,
    score: typeof assemblyReport.score === "number" ? assemblyReport.score : undefined,
  };
};

const evaluateMediaGate = (
  context: ProductionGateEvaluationContext,
): ProductionQAIssue[] => {
  if (!context.result) return [];
  const snapshot = snapshotObject(context.result);
  const issues: ProductionQAIssue[] = [...inheritedBlockingIssues("MEDIA", context.qaReports)];
  if (!hasArtifact(context.result, "generation_plan")) {
    issues.push(makeGateIssue("MEDIA", "artifacts.generation_plan", "媒体生成规划阶段没有产出 generation_plan artifact。"));
  }
  if (!hasArtifact(context.result, "video_generation_unit")) {
    issues.push(makeGateIssue("MEDIA", "artifacts.video_generation_unit", "媒体生成规划阶段没有产出 video_generation_unit 草案。", "warning"));
  }
  const missingImagePromptShotIds = Array.isArray(snapshot.missingImagePromptShotIds) ? snapshot.missingImagePromptShotIds : [];
  const missingVideoPromptShotIds = Array.isArray(snapshot.missingVideoPromptShotIds) ? snapshot.missingVideoPromptShotIds : [];
  if (missingImagePromptShotIds.length > 0 || missingVideoPromptShotIds.length > 0) {
    issues.push(makeGateIssue(
      "MEDIA",
      "outputSnapshot.missingPromptShotIds",
      `媒体生成检查发现提示词不完整：缺图片提示词 ${missingImagePromptShotIds.length} 个，缺视频提示词 ${missingVideoPromptShotIds.length} 个。`,
      "blocking",
      "先补齐 prompt 阶段产物，再进入媒体生成排期。",
    ));
  }
  const imagePromptCount = Number(snapshot.imagePromptCount || 0);
  const videoPromptCount = Number(snapshot.videoPromptCount || 0);
  if (imagePromptCount !== videoPromptCount) {
    issues.push(makeGateIssue("MEDIA", "outputSnapshot.promptCounts", `图片/视频提示词数量不一致：${imagePromptCount}/${videoPromptCount}。`, "warning"));
  }
  const generationQueues = snapshot.generationQueues as any;
  if (!generationQueues?.image || !generationQueues?.video || !generationQueues?.audio) {
    issues.push(makeGateIssue("MEDIA", "outputSnapshot.generationQueues", "媒体生成计划缺少图片、视频、音频拆分队列。", "warning"));
  }
  if (!generationQueues?.videoUnit) {
    issues.push(makeGateIssue("MEDIA", "outputSnapshot.generationQueues.videoUnit", "媒体生成计划缺少视频生成单元队列。", "warning"));
  }
  const estimatedDuration = snapshot.estimatedDurationMinutes as any;
  if (typeof estimatedDuration?.total !== "number") {
    issues.push(makeGateIssue("MEDIA", "outputSnapshot.estimatedDurationMinutes", "媒体生成计划缺少预计耗时汇总。", "warning"));
  }
  const retryLimit = snapshot.retryLimit as any;
  if (typeof retryLimit?.totalRetries !== "number") {
    issues.push(makeGateIssue("MEDIA", "outputSnapshot.retryLimit", "媒体生成计划缺少失败重试上限。", "warning"));
  }
  if (!Array.isArray(snapshot.skippableItems)) {
    issues.push(makeGateIssue("MEDIA", "outputSnapshot.skippableItems", "媒体生成计划缺少可跳过或可延后条目列表。", "warning"));
  }
  return issues;
};

const evaluateGateIssues = (
  gate: ProductionGateDefinition,
  run: ProductionRun,
  stage: ProductionStageRun,
  context: ProductionGateEvaluationContext,
) => {
  switch (gate.id) {
    case "CONTRACT":
      return { issues: evaluateContractGate(context) };
    case "CREATIVE_QUALITY":
      return { issues: evaluateCreativeQualityGate(stage, context) };
    case "TRANSPARENCY":
      return { issues: evaluateTransparencyGate(run, stage, context) };
    case "FORMAT_STANDARDS":
      return { issues: evaluateFormatStandardsGate(context) };
    case "SCRIPT":
      return { issues: evaluateScriptGate(stage, context) };
    case "STORYBOARD":
      return { issues: evaluateStoryboardGate(stage, context) };
    case "PROMPT":
      return { issues: evaluatePromptGate(context) };
    case "PLAYTEST":
      return evaluatePlaytestGate(context);
    case "MEDIA":
      return { issues: evaluateMediaGate(context) };
    default:
      return { issues: context.stageBlocking && gate.blockingByDefault
        ? [makeGateIssue(gate.id, "stage.qa", `${gate.label} 关联阶段存在阻断问题。`)]
        : [] };
  }
};

const verdictStatus = (issues: ProductionQAIssue[]) =>
  issues.some((issue) => issue.severity === "blocking")
    ? "failed" as const
    : issues.length > 0
      ? "warning" as const
      : "passed" as const;

export const createGateVerdictsForStage = (
  run: ProductionRun,
  stage: ProductionStageRun,
  context: ProductionGateEvaluationContext = {},
): ProductionGateVerdict[] => {
  const reviewMode = run.policy.reviewMode || "lean";
  const activeGates = getGatesForStage(stage.stageType, reviewMode);
  const skippedGates = productionGateRegistry.filter(
    (gate) => gate.stages.includes(stage.stageType) && !shouldRunGate(reviewMode, gate),
  );
  const now = Date.now();

  return [
    ...activeGates.map((gate) => {
      const evaluation = evaluateGateIssues(gate, run, stage, context);
      const issues = normalizeProductionQAIssues(evaluation.issues || []);
      const status = verdictStatus(issues);
      const blocking = issues.some((issue) => issue.severity === "blocking");
      const score = evaluation.score ?? scoreFromIssues(issues);
      return {
        gateId: gate.id,
        label: gate.label,
        status,
        blocking,
        score,
        issues,
        summary: blocking
          ? `${gate.label} 发现 ${issues.filter((issue) => issue.severity === "blocking").length} 个阻断问题。`
          : issues.length > 0
            ? `${gate.label} 发现 ${issues.length} 个非阻断问题。`
            : `${gate.label} 已按 ${reviewMode} 模式通过。`,
        modeApplied: reviewMode,
        createdAt: now,
      };
    }),
    ...skippedGates.map((gate) => ({
      gateId: gate.id,
      label: gate.label,
      status: "skipped" as const,
      blocking: false,
      score: undefined,
      issues: [],
      summary: `${gate.label} 在 ${reviewMode} 模式下跳过。`,
      modeApplied: reviewMode,
      createdAt: now,
    })),
  ];
};
