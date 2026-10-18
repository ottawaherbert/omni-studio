import {
  ContextPlan,
  CreateProductionRunOptions,
  ProductionCheckpoint,
  ProductionModelTaskType,
  ProductionMode,
  ProductionPolicy,
  ProductionRun,
  ProductionRunProjectInput,
  ProductionArtifact,
  ProductionManifest,
  ProductionQAReport,
  ProductionGateVerdict,
  ProductionStageExecutionResult,
  ProductionStageRun,
  ProductionRuntimeControls,
} from "../../types/production";
import {
  createStageRuns,
  defaultProductionPolicy,
  getNextRunnableStage,
} from "./stages";
import { validateStageRunContract } from "./qa";
import { createInitialContextPlan } from "./contextPlanner";
import { createGateVerdictsForStage } from "./gates";
import { markDownstreamImpacts } from "./impact";
import { estimateTokens, summarizeForCheckpoint, truncateForStorage } from "./promptUtils";
import { normalizeProductionQAReport } from "./qaIssue";
import { projectUniversalSkillRefs } from "../../utils/universalSkillRefs";
import {
  createArtifactDependencyEdges,
  createInterventionTasksForStage,
  expireWaiversForStaleArtifacts,
  initializeArtifactLifecycle,
  lockArtifactsForStage,
} from "./artifactLifecycle";
import { getFormatProductionProfile } from "../../config/formatProductionProfiles";
import { TaskRouting, useAIConfigStore } from "../../store/useAIConfigStore";
import { logRuntimeEvent } from "../runtimeLogger";

const mergePolicy = (policy?: Partial<ProductionPolicy>): ProductionPolicy => ({
  ...defaultProductionPolicy,
  ...policy,
  reviewMode: policy?.reviewMode || defaultProductionPolicy.reviewMode,
  manualGates: policy?.manualGates || defaultProductionPolicy.manualGates,
  modelFallbackOrder: policy?.modelFallbackOrder || defaultProductionPolicy.modelFallbackOrder,
  maxStoredTextChars: policy?.maxStoredTextChars || defaultProductionPolicy.maxStoredTextChars,
  runtimeControls: {
    ...defaultProductionPolicy.runtimeControls,
    ...(policy?.runtimeControls || {}),
  },
});

const failureRecoverySuggestions: Record<NonNullable<ProductionStageRun["failureType"]>, string[]> = {
  model: ["检查模型配置与 API Key。", "使用不同模型重试。", "降低上下文长度后重试。"],
  json: ["运行 JSON repair 或直接重试。", "切换到结构化输出更稳定的模型。", "减少 prompt 中的长上下文。"],
  qa: ["查看 QA issue 与修复建议。", "填写修改意见后重做当前阶段。", "必要时人工接管并继续。"],
  data: ["检查项目数据是否缺少前置产物。", "从上一个通过阶段重跑。", "人工补齐数据后继续。"],
  user: ["确认当前阶段是否允许跳过。", "人工修改后继续。"],
  unknown: ["复制失败报告排查。", "从当前阶段重试。", "若连续失败，切换模型或人工接管。"],
};

const nextFallbackModel = (
  run: ProductionRun,
  currentModel?: string,
): ProductionModelTaskType => {
  const order = run.policy.modelFallbackOrder.length
    ? run.policy.modelFallbackOrder
    : defaultProductionPolicy.modelFallbackOrder;
  const currentIndex = currentModel
    ? order.findIndex((item) => item === currentModel)
    : -1;
  return order[(currentIndex + 1 + order.length) % order.length];
};

const emptyMetrics = () => ({
  modelCallCount: 0,
  modelFailureCount: 0,
  qaFailureTypes: {},
  gateRevisionRequests: {},
  stageRetryCount: {},
});

const incrementMetric = <T extends string>(
  values: Partial<Record<T, number>> | undefined,
  key: T,
) => ({
  ...(values || {}),
  [key]: (values?.[key] || 0) + 1,
});

const defaultTemplateTrace = (
  stage: ProductionStageRun,
): ProductionManifest["template"] => ({
  id: `runner.${stage.stageType}`,
  name: `${stage.title} inline runner prompt`,
  source: "runner.inline",
  version: "unversioned",
});

const buildFormatProfileSnapshot = (
  project: ProductionRunProjectInput,
): NonNullable<ProductionRun["formatProfile"]> => {
  const profile = getFormatProductionProfile(project);
  return {
    id: profile.id,
    label: profile.label,
    mode: profile.mode,
    unitName: profile.unitName,
    defaultSkeletonId: profile.defaultSkeletonId,
    defaultBeatId: profile.defaultBeatId,
    defaultSceneTemplateId: profile.defaultSceneTemplateId,
    qaGates: profile.qaGates,
    generationPolicy: profile.generationPolicy,
  };
};

const manifestContextTrace = (contextUsed: unknown) => {
  const contextTrace =
    contextUsed && typeof contextUsed === "object" && "contextTrace" in contextUsed
      ? (contextUsed as { contextTrace?: any }).contextTrace
      : undefined;
  return {
    fieldScope: Array.isArray(contextTrace?.fieldScope) ? contextTrace.fieldScope : [],
    skillIds: Array.isArray(contextTrace?.skillIds) ? contextTrace.skillIds : [],
    dnaIds: Array.isArray(contextTrace?.dnaIds) ? contextTrace.dnaIds : [],
    forbiddenSkillIds: Array.isArray(contextTrace?.forbiddenSkillIds) ? contextTrace.forbiddenSkillIds : [],
    omittedProjectContext: Array.isArray(contextTrace?.omittedProjectContext) ? contextTrace.omittedProjectContext : [],
    contextInventory: contextTrace?.contextInventory && typeof contextTrace.contextInventory === "object"
      ? contextTrace.contextInventory as ProductionManifest["context"]["contextInventory"]
      : {},
    tokenBudget: typeof contextTrace?.tokenBudget === "number" ? contextTrace.tokenBudget : undefined,
    languagePolicy: contextTrace?.fieldLanguagePolicy,
    referenceInfluence: Array.isArray(contextTrace?.referenceInfluence) ? contextTrace.referenceInfluence : [],
  };
};

const buildManifestExplainability = (
  run: ProductionRun,
  stage: ProductionStageRun,
  result: ProductionStageExecutionResult,
  promptStored: boolean,
  artifacts: ProductionArtifact[],
  context: ReturnType<typeof manifestContextTrace>,
): ProductionManifest["explainability"] => {
  const template = result.templateUsed || defaultTemplateTrace(stage);
  const used = [
    `阶段目标: ${stage.title}`,
    `模板: ${template.name || template.id}`,
    run.formatProfile ? `类型 Profile: ${run.formatProfile.label}` : "",
    context.fieldScope.length ? `上下文字段: ${context.fieldScope.join(", ")}` : "",
    context.skillIds.length ? `Skill: ${context.skillIds.join(", ")}` : "",
    context.dnaIds.length ? `DNA: ${context.dnaIds.join(", ")}` : "",
    context.omittedProjectContext.length ? `未注入关键上下文: ${context.omittedProjectContext.join(", ")}` : "",
    context.referenceInfluence.length
      ? `参考影响轴: ${context.referenceInfluence.map((item) => `${item.sourceName}(${item.influenceAxes.join("/")})`).join("; ")}`
      : "",
    result.templateUsed?.metadata?.qaRules.length
      ? `模板 QA: ${result.templateUsed.metadata.qaRules.join(", ")}`
      : "",
    artifacts.length
      ? `写入产物: ${artifacts.map((artifact) => artifact.targetPath).join(", ")}`
      : "",
  ].filter(Boolean);
  const notUsed = [
    promptStored ? "" : "最终 Prompt 未保留可读版本。",
    context.fieldScope.length ? "" : "未记录 ContextPlan 字段范围。",
    context.omittedProjectContext.length ? `项目存在但本阶段未注入: ${context.omittedProjectContext.join(", ")}。` : "",
    context.skillIds.length ? "" : "本阶段没有记录 Skill 注入。",
    context.referenceInfluence.length ? "" : "本阶段没有可追踪参考源影响记录。",
    result.templateUsed?.metadata?.outputSchema.length ? "" : "模板没有声明输出 schema。",
    artifacts.length ? "" : "本阶段没有写入产物 diff。",
  ].filter(Boolean);

  return {
    summary: [
      `${stage.title} 使用 ${template.name || template.id} 生成。`,
      run.formatProfile ? `当前按 ${run.formatProfile.label} 的默认结构/节拍/场景模板与 QA 重点运行。` : "",
      context.fieldScope.length ? `主要上下文来自 ${context.fieldScope.join(", ")}。` : "当前缺少上下文字段 trace，需要作者复核。",
      context.referenceInfluence.length
        ? "参考导演/作品以拆解后的影响轴进入本阶段，而不是只作为名字写进 prompt。"
        : "当前没有可见的参考源影响记录。",
    ].filter(Boolean).join(" "),
    used,
    notUsed,
  };
};

const buildPilotPlanSnapshot = (
  run: ProductionRun,
): ProductionManifest["parameters"]["pilotPlan"] => {
  const generationPolicy = run.formatProfile?.generationPolicy;
  const enabled = Boolean(generationPolicy?.pilotFirst);
  const firstBatchLimit = Math.max(1, generationPolicy?.maxGeneratedEpisodesPerBatch || 1);
  const pilotUnitName = run.mode === "interactive" ? "Golden Path" : run.formatProfile?.unitName || "生产单元";
  const pilotQuantity = run.mode === "interactive"
    ? `${firstBatchLimit} 条 ${pilotUnitName}`
    : `${firstBatchLimit} 个${pilotUnitName}`;
  const scope = enabled
    ? `先生成 ${pilotQuantity} 作为试制批次，质量通过后再扩大批量。`
    : `按当前类型 Profile 的批量策略生成，单批上限为 ${pilotQuantity}。`;

  return {
    enabled,
    batchPolicy: enabled ? "pilot_then_expand" : "profile_batch",
    pilotUnitName,
    firstBatchLimit,
    scope,
    expansionGate: "当前试制批次通过 CONTRACT、CREATIVE_QUALITY、FORMAT_STANDARDS、MEDIA 等 gate 后，再扩大批量。",
    nextBatchCondition: "无 blocking gate、无未处理人工门禁；自动模式继续，逐步模式等待作者确认。",
  };
};

const runtimeControlOverridesForStage = (
  stage: ProductionStageRun,
): Partial<ProductionRuntimeControls> => stage.runtimeControlOverrides || {};

const effectiveRuntimeControlsForStage = (
  run: ProductionRun,
  stage: ProductionStageRun,
): ProductionRuntimeControls => ({
  ...run.policy.runtimeControls,
  ...runtimeControlOverridesForStage(stage),
});

const buildProductionTemplateConflictWarnings = (
  template: ProductionManifest["template"],
  stage: ProductionStageRun,
  context: ReturnType<typeof manifestContextTrace>,
) => {
  const warnings: string[] = [];
  const metadata = template.metadata;
  if (!metadata) return warnings;
  if (metadata.stageType !== stage.stageType) {
    warnings.push(`自动制片模板 ${template.id} 声明阶段为 ${metadata.stageType}，但当前执行阶段是 ${stage.stageType}。`);
  }

  const allowedReferenceInputs = metadata.allowedReferenceInputs.join("\n");
  const axisRequirements: Array<{ axis: string; required: string[]; appliedCue: RegExp }> = [
    { axis: "通用 Skill 原文", required: ["universalSkill.content"], appliedCue: /创作|参考|结构|节奏|人物|角色|对白|表演|镜头|视觉|提示词|类型|分支|成本/ },
  ];

  context.referenceInfluence.forEach((influence) => {
    const appliedText = influence.appliedAs.join("、");
    influence.influenceAxes.forEach((axis) => {
      const requirement = axisRequirements.find((item) => item.axis === axis);
      if (!requirement) return;
      if (!requirement.appliedCue.test(appliedText)) return;
      const supported = requirement.required.some((item) => allowedReferenceInputs.includes(item));
      if (!supported) {
        warnings.push(`参考源 ${influence.sourceName} 的影响轴「${axis}」没有被模板 ${template.id} 的 allowedReferenceInputs 明确允许。`);
      }
    });
  });

  return Array.from(new Set(warnings));
};

const resolveProviderTrace = (
  routingTask?: string,
): ProductionManifest["provider"] => {
  if (!routingTask) {
    return {
      providerLabel: "not-used",
      resolutionStatus: "not-used",
      apiKeySource: "not-applicable",
      apiKeyConfigured: false,
      disclosure: "本阶段没有模型调用记录。",
    };
  }

  const state = useAIConfigStore.getState();
  const routedModelRegistryId = state.routing[routingTask as keyof TaskRouting];
  if (!routedModelRegistryId) {
    return {
      routingTask,
      providerLabel: "unresolved",
      resolutionStatus: "missing-route",
      apiKeySource: "missing",
      apiKeyConfigured: false,
      disclosure: `路由任务 ${routingTask} 没有配置模型，作者需要在设置页补齐任务路由。`,
    };
  }

  const model = state.models.find((item) => item.id === routedModelRegistryId);
  if (!model) {
    return {
      routingTask,
      modelRegistryId: routedModelRegistryId,
      modelLabel: routedModelRegistryId,
      providerLabel: "unresolved",
      resolutionStatus: "missing-model",
      apiKeySource: "missing",
      apiKeyConfigured: false,
      disclosure: `路由任务 ${routingTask} 指向模型 ${routedModelRegistryId}，但模型注册表里找不到它。`,
    };
  }

  const channel = state.channels.find((item) => item.id === model.channelId);
  if (!channel) {
    return {
      routingTask,
      modelRegistryId: model.id,
      modelLabel: model.alias,
      modelId: model.modelId,
      channelId: model.channelId,
      providerLabel: "unresolved",
      resolutionStatus: "missing-channel",
      apiKeySource: "missing",
      apiKeyConfigured: false,
      disclosure: `模型 ${model.alias} 指向渠道 ${model.channelId}，但渠道注册表里找不到它。`,
    };
  }

  const hasModelOverride = Boolean(model.apiKeyOverride?.trim());
  const hasChannelKey = Boolean(channel.apiKey?.trim());
  const apiKeySource = hasModelOverride
    ? "modelOverride"
    : hasChannelKey
      ? "channel"
      : "serverEnv";

  return {
    routingTask,
    modelRegistryId: model.id,
    modelLabel: model.alias,
    modelId: model.modelId,
    channelId: channel.id,
    channelName: channel.name,
    channelType: channel.type,
    baseUrl: channel.baseUrl,
    providerLabel: channel.type,
    resolutionStatus: "resolved",
    apiKeySource,
    apiKeyConfigured: true,
    disclosure: [
      `路由任务 ${routingTask} 当前解析为 ${model.alias} (${model.modelId})。`,
      `渠道 ${channel.name} / ${channel.type}${channel.baseUrl ? ` / ${channel.baseUrl}` : ""}。`,
      `密钥状态: 已配置路径(${apiKeySource})；Manifest 不记录密钥内容。`,
    ].join(" "),
  };
};

const summarizeDiffValue = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return truncateForStorage(value, 160) || "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === "object") return `Object(${Object.keys(value as Record<string, unknown>).slice(0, 8).join(", ")})`;
  return String(value);
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const flattenSnapshotForDiff = (
  value: unknown,
  path = "output",
  depth = 0,
  maxEntries = 80,
): Record<string, string> => {
  const entries: Record<string, string> = {};
  const visit = (current: unknown, currentPath: string, currentDepth: number) => {
    if (Object.keys(entries).length >= maxEntries) return;
    if (currentDepth >= 5 || current === null || typeof current !== "object") {
      entries[currentPath] = summarizeDiffValue(current);
      return;
    }
    if (Array.isArray(current)) {
      entries[`${currentPath}.length`] = String(current.length);
      current.slice(0, 20).forEach((item, index) => {
        const itemId = isPlainRecord(item) && typeof item.id === "string" ? item.id : String(index);
        visit(item, `${currentPath}[${itemId}]`, currentDepth + 1);
      });
      return;
    }
    const record = current as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    entries[`${currentPath}.__keys`] = keys.slice(0, 30).join(",");
    keys.slice(0, 30).forEach((key) => visit(record[key], `${currentPath}.${key}`, currentDepth + 1));
  };
  visit(value, path, depth);
  return entries;
};

const extractEntitySnapshots = (value: unknown): Record<string, string> => {
  const entities: Record<string, string> = {};
  const visit = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    const record = current as Record<string, unknown>;
    if (typeof record.id === "string") {
      entities[record.id] = summarizeDiffValue(record);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return entities;
};

const findPreviousOutputSnapshot = (
  run: ProductionRun,
  artifact: ProductionArtifact,
): unknown => {
  const checkpoints = [...run.checkpoints].reverse();
  return checkpoints.find((checkpoint) =>
    checkpoint.kind === "output" &&
    checkpoint.productionManifest?.artifacts.some((existing) =>
      existing.artifactType === artifact.artifactType &&
      existing.targetPath === artifact.targetPath &&
      existing.entityIds.join("|") === artifact.entityIds.join("|"),
    ),
  )?.snapshot;
};

const buildStructuredDiff = (
  previousSnapshot: unknown,
  currentSnapshot: unknown,
): Pick<ProductionManifest["diff"][number], "structuredChanges" | "entityChangeSummary"> => {
  if (currentSnapshot === undefined) {
    return {
      structuredChanges: [{
        path: "output",
        changeType: "unknown",
        after: "当前阶段未记录结构化 outputSnapshot。",
      }],
    };
  }

  const before = previousSnapshot === undefined ? {} : flattenSnapshotForDiff(previousSnapshot);
  const after = flattenSnapshotForDiff(currentSnapshot);
  const allPaths = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  const structuredChanges = allPaths
    .map((path) => {
      const hasBefore = path in before;
      const hasAfter = path in after;
      const beforeValue = before[path];
      const afterValue = after[path];
      const changeType: NonNullable<ProductionManifest["diff"][number]["structuredChanges"]>[number]["changeType"] = !hasBefore
        ? "added"
        : !hasAfter
          ? "removed"
          : beforeValue === afterValue
            ? "unchanged"
            : "changed";
      return {
        path,
        changeType,
        before: hasBefore ? beforeValue : undefined,
        after: hasAfter ? afterValue : undefined,
      };
    })
    .filter((change) => change.changeType !== "unchanged")
    .slice(0, 40);

  const beforeEntities = previousSnapshot === undefined ? {} : extractEntitySnapshots(previousSnapshot);
  const afterEntities = extractEntitySnapshots(currentSnapshot);
  const entityIds = Array.from(new Set([...Object.keys(beforeEntities), ...Object.keys(afterEntities)])).sort();
  const entityChangeSummary = entityIds.reduce(
    (summary, id) => {
      const hasBefore = id in beforeEntities;
      const hasAfter = id in afterEntities;
      if (!hasBefore && hasAfter) summary.added += 1;
      else if (hasBefore && !hasAfter) summary.removed += 1;
      else if (beforeEntities[id] !== afterEntities[id]) summary.changed += 1;
      else summary.unchanged += 1;
      if (summary.sampledEntityIds.length < 12) summary.sampledEntityIds.push(id);
      return summary;
    },
    { added: 0, removed: 0, changed: 0, unchanged: 0, sampledEntityIds: [] as string[] },
  );

  return {
    structuredChanges: structuredChanges.length ? structuredChanges : [{
      path: "output",
      changeType: previousSnapshot === undefined ? "added" : "unchanged",
      before: previousSnapshot === undefined ? undefined : summarizeDiffValue(previousSnapshot),
      after: summarizeDiffValue(currentSnapshot),
    }],
    entityChangeSummary,
  };
};

const buildProductionManifest = (
  run: ProductionRun,
  stage: ProductionStageRun,
  result: ProductionStageExecutionResult,
  promptUsed: string | undefined,
  artifacts: ProductionArtifact[],
  qaReports: ProductionQAReport[],
  gateVerdicts: ProductionGateVerdict[],
  outputSnapshot: unknown,
  now: number,
): ProductionManifest => {
  const context = manifestContextTrace(result.contextUsed || stage.contextUsed);
  const activeDnaIds = Array.from(new Set([...context.dnaIds, ...run.contextPlan.pacingDNAs, ...run.contextPlan.shotDNAs]));
  const promptWasProvided = Boolean(result.promptUsed);
  const promptStored = Boolean(promptUsed);
  const promptPreviewText = truncateForStorage(result.promptUsed, 1800) || "";
  const template = result.templateUsed || defaultTemplateTrace(stage);
  const routedTask = result.modelUsed || stage.modelUsed;
  const provider = resolveProviderTrace(routedTask);
  const runtimeControlOverrides = runtimeControlOverridesForStage(stage);
  const effectiveRuntimeControls = effectiveRuntimeControlsForStage(run, stage);
  const templateConflictWarnings = buildProductionTemplateConflictWarnings(template, stage, context);
  const outputContract = {
    schemaFields: template.metadata?.outputSchema || [],
    qaRules: template.metadata?.qaRules || [],
    languagePolicy: template.metadata?.languagePolicy,
    metadataWarnings: [...(template.metadataWarnings || []), ...templateConflictWarnings],
  };
  const transparencyWarnings = [
    !promptStored && promptWasProvided ? "Prompt 超出存储限制后未能保留可读版本。" : "",
    !promptStored && !promptWasProvided && result.modelUsed ? "模型阶段缺少最终 Prompt 记录，作者无法完整复盘生成过程。" : "",
    !context.fieldScope.length && stage.stageType !== "intake" ? "缺少 ContextPlan 字段范围 trace。" : "",
    context.omittedProjectContext.length
      ? `上下文遗漏报告: ${context.omittedProjectContext.join(", ")} 存在于项目中，但未进入本阶段 ContextPlan 字段范围。`
      : "",
    result.templateUsed ? "" : "未使用版本化模板，当前阶段仍由 runner inline prompt 驱动。",
    ...(result.templateUsed?.metadataWarnings || []),
    ...templateConflictWarnings,
    !outputContract.schemaFields.length ? "模板缺少输出 schema 声明，作者难以判断生成结果应该长什么样。" : "",
    run.contextPlan.globalSkills.length > 0 && context.skillIds.length === 0 ? "项目存在 universalSkillRefs，但本阶段没有记录实际 Skill 注入。" : "",
  ].filter(Boolean);
  const explainability = buildManifestExplainability(
    run,
    stage,
    result,
    promptStored,
    artifacts,
    context,
  );
  const diff = artifacts.map((artifact) => {
    const previousVersion = artifact.previousArtifactId
      ? run.artifacts.find((existing) => existing.id === artifact.previousArtifactId)?.version
      : undefined;
    const structuredDiff = buildStructuredDiff(findPreviousOutputSnapshot(run, artifact), outputSnapshot);
    return {
      targetPath: artifact.targetPath,
      artifactType: artifact.artifactType,
      entityIds: artifact.entityIds,
      version: artifact.version,
      previousVersion,
      changeSummary: artifact.changeSummary,
      previousArtifactId: artifact.previousArtifactId,
      fieldLevelSummary: [
        `${artifact.targetPath} 写入 ${artifact.artifactType}`,
        artifact.entityIds.length ? `实体: ${artifact.entityIds.join(", ")}` : "未关联实体",
        artifact.previousArtifactId ? "覆盖/重生成已有目标" : "首次写入目标",
        `版本: v${artifact.version}`,
        structuredDiff.structuredChanges?.length ? `结构化字段变化 ${structuredDiff.structuredChanges.length} 项` : "",
      ].filter(Boolean).join("；"),
      ...structuredDiff,
    };
  });
  const referenceFieldEvidence: ProductionManifest["references"]["fieldEvidence"] = context.referenceInfluence.map((influence) => {
    const fieldPaths = Array.from(new Set(diff
      .flatMap((entry) => entry.structuredChanges || [])
      .filter((change) => change.changeType !== "unchanged")
      .map((change) => change.path)
      .slice(0, 12)));
    const targetPaths = Array.from(new Set(diff.map((entry) => entry.targetPath))).slice(0, 8);
    return {
      sourceId: influence.sourceId,
      sourceName: influence.sourceName,
      influenceAxes: influence.influenceAxes,
      targetPaths,
      fieldPaths,
      evidenceSummary: fieldPaths.length
        ? `${influence.sourceName} 在本阶段以 ${influence.appliedAs.join("、")} 参与生成；可追踪到 ${fieldPaths.length} 个输出字段变化。`
        : `${influence.sourceName} 已进入本阶段参考 trace，但当前没有结构化字段 diff 证明其具体落点。`,
    };
  });

  return {
    schemaVersion: "production-manifest.v1",
    createdAt: now,
    runId: run.id,
    projectId: run.projectId,
    projectTitle: run.projectTitle,
    mode: run.mode,
    stageId: stage.id,
    stageType: stage.stageType,
    stageTitle: stage.title,
    modelUsed: routedTask,
    provider,
    template,
    prompt: {
      stored: promptStored,
      charCount: promptUsed?.length || 0,
      tokenEstimate: promptUsed ? estimateTokens(promptUsed) : undefined,
      truncatedForStorage: Boolean(result.promptUsed && promptUsed && result.promptUsed !== promptUsed),
      preview: {
        available: Boolean(promptPreviewText),
        text: promptPreviewText,
        charCount: promptPreviewText.length,
        truncated: Boolean(result.promptUsed && promptPreviewText && result.promptUsed !== promptPreviewText),
        reviewStatus: promptPreviewText
          ? stage.requiresHumanReview
            ? "manual_review_required"
            : "auto_recorded"
          : "missing",
      },
      originalPrompt: stage.promptReview?.originalPrompt,
      editedPrompt: stage.promptReview?.editedPrompt,
      reviewStatus: stage.promptReview?.status,
      authorNote: stage.promptReview?.authorNote,
    },
    outputContract,
    context,
    parameters: {
      reviewMode: run.policy.reviewMode,
      autoApproveLowRisk: run.policy.autoApproveLowRisk,
      maxRetriesPerStage: run.policy.maxRetriesPerStage,
      requiresHumanReview: stage.requiresHumanReview,
      revisionInstructions: stage.revisionInstructions,
      modelFallbackOrder: run.policy.modelFallbackOrder,
      maxStoredTextChars: run.policy.maxStoredTextChars,
      runtimeControls: {
        ...effectiveRuntimeControls,
        pilotFirst: run.formatProfile?.generationPolicy.pilotFirst ?? false,
        maxGeneratedEpisodesPerBatch: run.formatProfile?.generationPolicy.maxGeneratedEpisodesPerBatch ?? 0,
      },
      runtimeControlSource: Object.keys(runtimeControlOverrides).length > 0 ? "stage_override" : "run_default",
      runtimeControlOverrides,
      pilotPlan: buildPilotPlanSnapshot(run),
      formatProfile: run.formatProfile,
    },
    references: {
      activeSkillIds: context.skillIds,
      activeDnaIds,
      influences: context.referenceInfluence,
      fieldEvidence: referenceFieldEvidence,
      missingReferenceTraceWarning: run.contextPlan.globalSkills.length > 0 && context.skillIds.length === 0,
    },
    artifacts: artifacts.map((artifact) => ({
      artifactType: artifact.artifactType,
      targetPath: artifact.targetPath,
      entityIds: artifact.entityIds,
      version: artifact.version,
      summary: artifact.summary,
    })),
    qa: {
      reportCount: qaReports.length,
      blocking: qaReports.some((report) => report.blocking),
      gateCount: gateVerdicts.length,
      blockingGateCount: gateVerdicts.filter((verdict) => verdict.blocking).length,
    },
    diff,
    authorControl: {
      promptVisible: promptStored,
      contextVisible: Boolean(result.contextUsed || stage.contextUsed),
      parametersVisible: true,
      referencesVisible: true,
      diffVisible: artifacts.length > 0,
    },
    explainability,
    transparencyWarnings,
  };
};

export const inferProductionMode = (
  project: ProductionRunProjectInput,
): ProductionMode => (project.projectModel === "interactive" ? "interactive" : "linear");

export const createProductionRun = (
  project: ProductionRunProjectInput,
  options: CreateProductionRunOptions = {},
): ProductionRun => {
  const now = Date.now();
  const mode = inferProductionMode(project);
  const id = `production-run-${now}-${crypto.randomUUID()}`;
  const policy = mergePolicy(options.policy);
  const formatProfile = buildFormatProfileSnapshot(project);
  const baseContextPlan = createInitialContextPlan(project);
  const contextPlan: ContextPlan = {
    ...baseContextPlan,
    ...options.contextPlan,
    fieldLanguagePolicy: {
      ...baseContextPlan.fieldLanguagePolicy,
      ...(options.contextPlan?.fieldLanguagePolicy || {}),
    },
    tokenBudgetEstimate: {
      ...baseContextPlan.tokenBudgetEstimate,
      ...(options.contextPlan?.tokenBudgetEstimate || {}),
    },
  };
  const stages = createStageRuns(id, mode, policy);
  const currentStage = stages[0];

  const intakeSnapshot = {
    projectId: project.id,
    projectTitle: project.title,
    mode,
    projectType: project.type,
    originalInspiration: project.originalInspiration,
    refinedInspiration: project.refinedInspiration,
    interactiveTemplate: project.interactiveTemplate,
    interactiveConfig: project.interactiveConfig,
    appliedVADnaProjectId: project.appliedVADnaProjectId,
    activeSkillIds: projectUniversalSkillRefs(project).map((skill) => skill.id),
  };

  const stageRuns: ProductionStageRun[] = stages.map((stage, index) =>
    index === 0
      ? {
          ...stage,
          inputSnapshot: intakeSnapshot,
          contextUsed: contextPlan,
          nextAction: "检查创建页输入并生成初始 checkpoint。",
        }
      : stage,
  );

  const checkpoint: ProductionCheckpoint = {
    id: `checkpoint-${now}-${crypto.randomUUID()}`,
    stageId: currentStage.id,
    kind: "input",
    snapshot: intakeSnapshot,
    note: "自动制片任务已创建，项目输入已归档。",
    createdAt: now,
  };

  const run: ProductionRun = {
    id,
    revision: 0,
    name: options.name || `${project.title || "未命名项目"} 自动制片`,
    projectId: project.id,
    projectTitle: project.title,
    mode,
    status: "draft",
    currentStageId: currentStage.id,
    stages: stageRuns,
    artifacts: [],
    artifactDependencies: [],
    artifactApprovals: [],
    qaWaivers: [],
    rollbackRecords: [],
    interventionTasks: [],
    checkpoints: [checkpoint],
    policy,
    contextPlan,
    formatProfile,
    metrics: emptyMetrics(),
    createdAt: now,
    updatedAt: now,
  };
  logRuntimeEvent({
    source: "production",
    event: "production.run.created",
    runId: run.id,
    projectId: run.projectId,
    status: run.status,
    message: `Production run created: ${run.projectTitle}`,
    details: {
      mode,
      stageCount: run.stages.length,
      firstStage: currentStage.stageType,
    },
  });
  return run;
};

export const getCurrentStage = (run: ProductionRun) =>
  run.stages.find((stage) => stage.id === run.currentStageId) || run.stages[0];

export const runContractQAForCurrentStage = (run: ProductionRun): ProductionRun => {
  const currentStage = getCurrentStage(run);
  logRuntimeEvent({
    source: "qa",
    event: "production.stage.contract_qa.start",
    runId: run.id,
    projectId: run.projectId,
    stageId: currentStage.id,
    stageType: currentStage.stageType,
    status: currentStage.status,
  });
  const report = validateStageRunContract(currentStage);
  const gateVerdicts = createGateVerdictsForStage(run, currentStage, {
    qaReports: [report],
    stageBlocking: report.blocking,
  });
  const blocking = report.blocking || gateVerdicts.some((verdict) => verdict.blocking);
  const updatedStages = run.stages.map((stage) =>
    stage.id === currentStage.id
      ? {
          ...stage,
          qaReports: [...stage.qaReports, report],
          gateVerdicts: [...(stage.gateVerdicts || []), ...gateVerdicts],
          status: blocking ? "failed" as const : stage.status,
          errorMessage: blocking ? report.fixInstructions : stage.errorMessage,
          nextAction: blocking
            ? "修复阶段结构后重试。"
            : "阶段结构检查通过，可继续执行生产 agent。",
        }
      : stage,
  );

  const nextRun: ProductionRun = {
    ...run,
    status: blocking ? "failed" : run.status,
    stages: updatedStages,
    updatedAt: Date.now(),
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${Date.now()}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "qa",
        snapshot: report,
        note: "已完成阶段结构 contract QA。",
        createdAt: Date.now(),
      },
    ],
  };
  logRuntimeEvent({
    source: "qa",
    event: "production.stage.contract_qa.finish",
    level: blocking ? "warn" : "info",
    runId: run.id,
    projectId: run.projectId,
    stageId: currentStage.id,
    stageType: currentStage.stageType,
    status: blocking ? "failed" : "passed",
    details: {
      score: report.score,
      issueCount: report.issues.length,
      blocking,
    },
  });
  return nextRun;
};

export const approveCurrentStage = (run: ProductionRun): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  const updatedStages = run.stages.map((stage) =>
    stage.id === currentStage.id
      ? {
          ...stage,
          status: "completed" as const,
          finishedAt: now,
          nextAction: "阶段已批准并完成。",
        }
      : stage,
  );
  const nextStage = getNextRunnableStage(updatedStages, currentStage.id);
  const nextStages = nextStage
    ? updatedStages.map((stage) =>
        stage.id === nextStage.id
          ? {
              ...stage,
              status: "running" as const,
              startedAt: stage.startedAt || now,
              nextAction: "等待 Orchestrator 执行本阶段。",
            }
          : stage,
      )
    : updatedStages;

  const nextRun: ProductionRun = {
    ...run,
    currentStageId: nextStage?.id || currentStage.id,
    status: nextStage ? "running" : "completed",
    completedAt: nextStage ? undefined : now,
    stages: nextStages,
    updatedAt: now,
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "human_review",
        snapshot: { approved: true },
        note: "用户或策略批准当前阶段。",
        createdAt: now,
      },
    ],
  };
  const lockedRun = lockArtifactsForStage(nextRun, currentStage.id);
  logRuntimeEvent({
    source: "production",
    event: "production.stage.approved",
    runId: run.id,
    projectId: run.projectId,
    stageId: currentStage.id,
    stageType: currentStage.stageType,
    status: lockedRun.status,
    details: {
      nextStageId: nextStage?.id,
      nextStageType: nextStage?.stageType,
    },
  });
  return lockedRun;
};

export const failCurrentStage = (
  run: ProductionRun,
  message: string,
  failureType: ProductionStageRun["failureType"] = "unknown",
): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  return {
    ...run,
    status: "failed",
    metrics: {
      ...(run.metrics || emptyMetrics()),
      modelFailureCount: failureType === "model" ? (run.metrics?.modelFailureCount || 0) + 1 : (run.metrics?.modelFailureCount || 0),
      qaFailureTypes: incrementMetric(run.metrics?.qaFailureTypes, failureType || "unknown"),
    },
    stages: run.stages.map((stage) =>
      stage.id === currentStage.id
        ? {
            ...stage,
          status: "failed" as const,
          errorMessage: message,
          failureType,
          recoverySuggestions: failureRecoverySuggestions[failureType],
          finishedAt: now,
            nextAction: "可从失败阶段重试、修改上下文后重试，或人工接管后继续。",
          }
        : stage,
    ),
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "error",
        snapshot: { message, failureType },
        note: "阶段执行失败。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const retryCurrentStage = (run: ProductionRun): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  const latestFixInstructions = [...currentStage.qaReports]
    .reverse()
    .find((report) => report.fixInstructions)?.fixInstructions;
  return {
    ...run,
    status: "running",
    metrics: {
      ...(run.metrics || emptyMetrics()),
      stageRetryCount: incrementMetric(run.metrics?.stageRetryCount, currentStage.stageType),
    },
    stages: run.stages.map((stage) =>
      stage.id === currentStage.id
        ? {
            ...stage,
            status: "retrying" as const,
            retryCount: stage.retryCount + 1,
            errorMessage: undefined,
            failureType: undefined,
            revisionInstructions: stage.revisionInstructions || latestFixInstructions,
            startedAt: now,
            finishedAt: undefined,
            nextAction: "已进入重试队列，下一步将重新执行当前阶段。",
          }
        : stage,
    ),
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "input",
        snapshot: currentStage.inputSnapshot || {},
        note: "从当前阶段重试。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const retryCurrentStageWithDifferentModel = (run: ProductionRun): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  const modelUsed = nextFallbackModel(run, currentStage.modelUsed);
  return {
    ...run,
    status: "running",
    metrics: {
      ...(run.metrics || emptyMetrics()),
      stageRetryCount: incrementMetric(run.metrics?.stageRetryCount, currentStage.stageType),
    },
    stages: run.stages.map((stage) =>
      stage.id === currentStage.id
        ? {
            ...stage,
            status: "retrying" as const,
            retryCount: stage.retryCount + 1,
            modelUsed,
            errorMessage: undefined,
            failureType: undefined,
            recoverySuggestions: [],
            startedAt: now,
            finishedAt: undefined,
            nextAction: `已切换到 ${modelUsed} 路由重试当前阶段。`,
          }
        : stage,
    ),
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "input",
        snapshot: {
          retryWithDifferentModel: true,
          modelUsed,
          previousModel: currentStage.modelUsed,
        },
        note: "使用不同模型路由重试当前阶段。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const requestRevisionForCurrentStage = (
  run: ProductionRun,
  revisionInstructions: string,
): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  return {
    ...run,
    status: "running",
    metrics: {
      ...(run.metrics || emptyMetrics()),
      gateRevisionRequests: incrementMetric(run.metrics?.gateRevisionRequests, currentStage.stageType),
      stageRetryCount: incrementMetric(run.metrics?.stageRetryCount, currentStage.stageType),
    },
    stages: run.stages.map((stage) =>
      stage.id === currentStage.id
        ? {
            ...stage,
            status: "retrying" as const,
            retryCount: stage.retryCount + 1,
            revisionInstructions,
            errorMessage: undefined,
          failureType: undefined,
          recoverySuggestions: [],
          startedAt: now,
            finishedAt: undefined,
            nextAction: "已收到人工修改意见，下一次执行会带入修订要求。",
          }
        : stage,
    ),
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "revision",
        snapshot: { revisionInstructions },
        note: "用户请求当前阶段按修改意见重做。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

const skippableStages = new Set([
  "context_planning",
  "asset_sync",
  "playtest_simulation",
  "expensive_generation_planning",
]);

export const canSkipCurrentStage = (run: ProductionRun) =>
  skippableStages.has(getCurrentStage(run).stageType);

export const skipCurrentStage = (run: ProductionRun): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  if (!canSkipCurrentStage(run)) {
    return failCurrentStage(
      run,
      `阶段「${currentStage.title}」是关键阶段，不能跳过。`,
      "user",
    );
  }
  const skippedStages = run.stages.map((stage) =>
    stage.id === currentStage.id
      ? {
          ...stage,
          status: "skipped" as const,
          finishedAt: now,
          nextAction: "非关键阶段已跳过。",
        }
      : stage,
  );
  const nextStage = getNextRunnableStage(skippedStages, currentStage.id);
  const stages = nextStage
    ? skippedStages.map((stage) =>
        stage.id === nextStage.id
          ? {
              ...stage,
              status: "running" as const,
              startedAt: stage.startedAt || now,
              nextAction: "等待 Orchestrator 执行本阶段。",
            }
          : stage,
      )
    : skippedStages;
  return {
    ...run,
    currentStageId: nextStage?.id || currentStage.id,
    status: nextStage ? "running" : "completed",
    completedAt: nextStage ? run.completedAt : now,
    stages,
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "skip",
        snapshot: { skipped: true, stageType: currentStage.stageType },
        note: "用户跳过非关键阶段。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const continueAfterManualEdit = (
  run: ProductionRun,
  inputConflictWarning?: string,
): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  const completedStages = run.stages.map((stage) =>
    stage.id === currentStage.id
      ? {
          ...stage,
          status: "completed" as const,
          errorMessage: undefined,
          failureType: undefined,
          recoverySuggestions: [],
          finishedAt: now,
          nextAction: "已采用人工修改后的项目数据继续。",
          inputConflictWarning: inputConflictWarning || (stage.stale
            ? stage.staleReason || "当前阶段存在上游变更标记，已由用户确认采用人工版本继续。"
            : undefined),
        }
      : stage,
  );
  const nextStage = getNextRunnableStage(completedStages, currentStage.id);
  const stages = nextStage
    ? completedStages.map((stage) =>
        stage.id === nextStage.id
          ? {
              ...stage,
              status: "running" as const,
              startedAt: stage.startedAt || now,
              nextAction: "等待 Orchestrator 执行本阶段。",
            }
          : stage,
      )
    : completedStages;
  return {
    ...run,
    currentStageId: nextStage?.id || currentStage.id,
    status: nextStage ? "running" : "completed",
    completedAt: nextStage ? run.completedAt : now,
    stages,
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "human_review",
        snapshot: { usedManualEdits: true, inputConflictWarning },
        note: "人工修改后继续自动制片。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const rerunFromPreviousApprovedStage = (run: ProductionRun): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  const currentIndex = run.stages.findIndex((stage) => stage.id === currentStage.id);
  const previousStage = run.stages
    .slice(0, Math.max(currentIndex, 0))
    .reverse()
    .find((stage) => ["completed", "needs_human_review", "failed"].includes(stage.status));
  if (!previousStage) {
    return retryCurrentStage(run);
  }
  return {
    ...run,
    status: "running",
    currentStageId: previousStage.id,
    stages: run.stages.map((stage) => {
      if (stage.id === previousStage.id) {
        return {
          ...stage,
          status: "retrying" as const,
          retryCount: stage.retryCount + 1,
          startedAt: now,
          finishedAt: undefined,
          errorMessage: undefined,
          failureType: undefined,
          recoverySuggestions: [],
          nextAction: "已回退到上一通过/可审查阶段重跑。",
        };
      }
      const stageIndex = run.stages.findIndex((item) => item.id === stage.id);
      if (stageIndex > run.stages.findIndex((item) => item.id === previousStage.id)) {
        return {
          ...stage,
          stale: true,
          staleReason: "上游阶段被要求重跑；已保留本阶段现有结果，可按需重新生成或复核。",
          nextAction: "现有结果继续可用；按需重新生成或复核。",
        };
      }
      return stage;
    }),
    metrics: {
      ...(run.metrics || emptyMetrics()),
      stageRetryCount: incrementMetric(run.metrics?.stageRetryCount, previousStage.stageType),
    },
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: previousStage.id,
        kind: "revision",
        snapshot: { rerunFromPreviousApprovedStage: true, fromStageId: currentStage.id },
        note: "从上一通过/可审查阶段重跑。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const rerunFromStage = (
  run: ProductionRun,
  stageId: string,
  revisionInstructions?: string,
): ProductionRun => {
  const now = Date.now();
  const targetIndex = run.stages.findIndex((stage) => stage.id === stageId);
  if (targetIndex === -1) return run;
  const targetStage = run.stages[targetIndex];
  return {
    ...run,
    status: "running",
    currentStageId: targetStage.id,
    stages: run.stages.map((stage, index) => {
      if (index < targetIndex) return stage;
      if (index === targetIndex) {
        return {
          ...stage,
          status: "retrying" as const,
          retryCount: stage.retryCount + 1,
          revisionInstructions: revisionInstructions || stage.revisionInstructions,
          startedAt: now,
          finishedAt: undefined,
          errorMessage: undefined,
          failureType: undefined,
          recoverySuggestions: [],
          nextAction: revisionInstructions
            ? "已按新的用户目标从指定阶段重跑。"
            : "已从指定阶段重跑。",
        };
      }
      return {
        ...stage,
        stale: true,
        staleReason: `指定阶段「${targetStage.title}」被重跑；已保留本阶段现有结果，可按需重新生成或复核。`,
        nextAction: "现有结果继续可用；按需重新生成或复核。",
      };
    }),
    metrics: {
      ...(run.metrics || emptyMetrics()),
      gateRevisionRequests: revisionInstructions
        ? incrementMetric(run.metrics?.gateRevisionRequests, targetStage.stageType)
        : run.metrics?.gateRevisionRequests || {},
      stageRetryCount: incrementMetric(run.metrics?.stageRetryCount, targetStage.stageType),
    },
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: targetStage.id,
        kind: "revision",
        snapshot: { rerunFromStage: true, stageId, revisionInstructions },
        note: revisionInstructions ? "修改用户目标后从指定阶段重跑。" : "从指定阶段重跑。",
        createdAt: now,
      },
    ],
    updatedAt: now,
  };
};

export const applyStageExecutionResult = (
  run: ProductionRun,
  result: ProductionStageExecutionResult,
): ProductionRun => {
  const now = Date.now();
  const currentStage = getCurrentStage(run);
  const storedTextLimit = run.policy.maxStoredTextChars || defaultProductionPolicy.maxStoredTextChars;
  const promptUsed = result.promptUsed;
  const rawOutput = truncateForStorage(result.rawOutput, storedTextLimit);
  const outputSnapshot = summarizeForCheckpoint(result.outputSnapshot || result.summary, storedTextLimit);
  const qaReports: ProductionQAReport[] = result.qaReports.map((report) => normalizeProductionQAReport({
    ...report,
    rawOutput: truncateForStorage(report.rawOutput, storedTextLimit),
    id: `qa-${now}-${crypto.randomUUID()}`,
    stageId: currentStage.id,
    createdAt: now,
  }));
  const qaBlocking = qaReports.some((report) => report.blocking);
  const gateVerdicts = createGateVerdictsForStage(run, currentStage, {
    result,
    qaReports,
    stageBlocking: qaBlocking,
  });
  const gateBlockingIssues = gateVerdicts
    .filter((verdict) => verdict.blocking)
    .flatMap((verdict) => verdict.issues || []);
  const blocking = qaBlocking || gateBlockingIssues.length > 0;
  const getNextArtifactVersion = (
    artifact: ProductionStageExecutionResult["artifacts"][number],
  ) => {
    const currentMax = run.artifacts
      .filter((existing) =>
        existing.artifactType === artifact.artifactType &&
        existing.targetPath === artifact.targetPath &&
        existing.entityIds.join("|") === artifact.entityIds.join("|"),
      )
      .reduce((max, existing) => Math.max(max, existing.version), 0);
    return currentMax + 1;
  };
  const baseArtifacts: ProductionArtifact[] = result.artifacts.map((artifact) => {
    const previous = run.artifacts
      .filter((existing) =>
        existing.artifactType === artifact.artifactType &&
        existing.targetPath === artifact.targetPath &&
        existing.entityIds.join("|") === artifact.entityIds.join("|"),
      )
      .sort((a, b) => b.version - a.version)[0];
    const version = getNextArtifactVersion(artifact);
    return {
      ...artifact,
      id: `artifact-${now}-${crypto.randomUUID()}`,
      projectId: run.projectId,
      runId: run.id,
      stageId: currentStage.id,
      version,
      previousArtifactId: previous?.id,
      changeSummary: previous
        ? `v${previous.version} -> v${version}: ${previous.summary === artifact.summary ? "同一路径产物重生成，内容需人工抽查差异。" : `摘要从「${previous.summary}」更新为「${artifact.summary}」。`}`
        : "首次生成该产物。",
      createdAt: now,
    };
  });
  const artifacts: ProductionArtifact[] = baseArtifacts.map((artifact) => initializeArtifactLifecycle({
    artifact,
    stage: currentStage,
    qaReports,
    gateVerdicts,
    blocking,
    requiresHumanReview: currentStage.requiresHumanReview,
    now,
  }));
  const artifactDependencies = createArtifactDependencyEdges(run, artifacts, now);
  const interventionTasks = createInterventionTasksForStage({
    run,
    stage: currentStage,
    artifacts,
    qaReports,
    gateVerdicts,
    now,
  });
  const nextStage = blocking ? undefined : getNextRunnableStage(run.stages, currentStage.id);
  const shouldPauseForHuman = !blocking && currentStage.requiresHumanReview;
  const productionManifest = buildProductionManifest(
    run,
    currentStage,
    result,
    promptUsed,
    artifacts,
    qaReports,
    gateVerdicts,
    outputSnapshot,
    now,
  );

  const updatedStages = run.stages.map((stage) => {
    if (stage.id === currentStage.id) {
      return {
        ...stage,
        status: blocking
          ? "failed" as const
          : shouldPauseForHuman
            ? "needs_human_review" as const
            : "completed" as const,
        outputArtifactIds: [
          ...stage.outputArtifactIds,
          ...artifacts.map((artifact) => artifact.id),
        ],
        qaReports: [...stage.qaReports, ...qaReports],
        gateVerdicts: [...(stage.gateVerdicts || []), ...gateVerdicts],
        promptUsed,
        rawOutput,
        modelUsed: result.modelUsed || stage.modelUsed,
        productionManifest,
        contextUsed: result.contextUsed || stage.contextUsed,
        tokenEstimate: promptUsed ? estimateTokens(promptUsed) : stage.tokenEstimate,
        recoverySuggestions: blocking ? failureRecoverySuggestions.qa : [],
        finishedAt: blocking || shouldPauseForHuman ? now : stage.finishedAt || now,
        errorMessage: blocking
          ? [
              ...qaReports.flatMap((report) => report.issues),
              ...gateBlockingIssues,
            ].map((issue) => issue.message).join("\n")
          : undefined,
        failureType: blocking ? "qa" as const : undefined,
        nextAction: blocking
          ? "QA 存在阻断问题，请修复后重试。"
          : shouldPauseForHuman
            ? "等待用户确认当前阶段产物。"
            : "阶段执行完成，已自动推进。",
      };
    }
    if (!shouldPauseForHuman && !blocking && nextStage && stage.id === nextStage.id) {
      return {
        ...stage,
        status: "running" as const,
        startedAt: stage.startedAt || now,
        nextAction: "等待 Orchestrator 执行本阶段。",
      };
    }
    return stage;
  });

  const impacted = markDownstreamImpacts(
    { ...run, stages: updatedStages, artifacts: [...run.artifacts, ...artifacts] },
    currentStage,
    artifacts,
  );
  const lifecycleRun = expireWaiversForStaleArtifacts({
    ...run,
    stages: impacted.stages,
    artifacts: impacted.artifacts,
    artifactDependencies: [...(run.artifactDependencies || []), ...artifactDependencies],
    artifactApprovals: [
      ...(run.artifactApprovals || []),
      ...artifacts.flatMap((artifact) => artifact.approvalRecords || []),
    ],
    interventionTasks: [...(run.interventionTasks || []), ...interventionTasks],
  });

  const nextRun: ProductionRun = {
    ...lifecycleRun,
    status: blocking ? "failed" : shouldPauseForHuman ? "needs_human_review" : nextStage ? "running" : "completed",
    metrics: {
      ...(run.metrics || emptyMetrics()),
      modelCallCount: result.modelUsed ? (run.metrics?.modelCallCount || 0) + 1 : (run.metrics?.modelCallCount || 0),
      qaFailureTypes: blocking
        ? incrementMetric(run.metrics?.qaFailureTypes, currentStage.stageType)
        : run.metrics?.qaFailureTypes || {},
    },
    currentStageId: !blocking && !shouldPauseForHuman && nextStage ? nextStage.id : currentStage.id,
    stages: lifecycleRun.stages,
    artifacts: lifecycleRun.artifacts,
    artifactDependencies: lifecycleRun.artifactDependencies,
    artifactApprovals: lifecycleRun.artifactApprovals,
    qaWaivers: lifecycleRun.qaWaivers,
    interventionTasks: lifecycleRun.interventionTasks,
    checkpoints: [
      ...run.checkpoints,
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "output",
        snapshot: outputSnapshot,
        productionManifest,
        note: result.summary,
        createdAt: now,
      },
      {
        id: `checkpoint-${now}-${crypto.randomUUID()}`,
        stageId: currentStage.id,
        kind: "qa",
        snapshot: qaReports,
        note: "阶段执行后的 QA 报告已记录。",
        createdAt: now,
      },
    ],
    contextPlan: result.contextPlan || run.contextPlan,
    completedAt: !blocking && !shouldPauseForHuman && !nextStage ? now : undefined,
    updatedAt: now,
  };
  logRuntimeEvent({
    source: "production",
    event: "production.stage.result_applied",
    level: blocking ? "warn" : "info",
    runId: run.id,
    projectId: run.projectId,
    stageId: currentStage.id,
    stageType: currentStage.stageType,
    status: nextRun.status,
    message: result.summary,
    details: {
      artifactCount: artifacts.length,
      qaReportCount: qaReports.length,
      gateVerdictCount: gateVerdicts.length,
      blocking,
      requiresHumanReview: shouldPauseForHuman,
      nextStageType: nextStage?.stageType,
    },
  });
  return nextRun;
};
