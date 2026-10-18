import { productionClient } from "../../clients/productionClient";
import {
  ProductionQAIssue,
  ProductionStageType,
} from "../../types/production";
import { productionTemplateMetadataRegistry, validateProductionTemplateMetadata } from "./templateMetadata";
import { runAgentGatewayStep } from "./agentGateway";

const STORAGE_KEY = "omni.manual_prompt_gateway_runs";

export interface ManualPromptGatewayInput {
  projectId?: string;
  episodeId?: string;
  sceneId?: string;
  templateId: string;
  workflowStepId?: string;
  stageType?: ProductionStageType;
  finalPrompt: string;
  currentTemplate: string;
  variables: Record<string, string>;
  userIntent?: string;
  selectedContextIds?: string[];
  selectedSkillIds?: string[];
  missingVariables?: string[];
  templateConflicts?: string[];
}

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  suggestion?: string,
): ProductionQAIssue => ({
  id: `manual-gateway-issue-${Date.now()}-${crypto.randomUUID()}`,
  target,
  message,
  severity,
  suggestion,
  issueType: "manual_prompt_preview",
});

export const inferManualWorkflowStepId = (
  templateId: string,
  stageType?: ProductionStageType,
) => {
  if (/studio|image|video|audio|prompt/i.test(templateId)) return "manual.studio.media_generate";
  const resolvedStageType = stageType || productionTemplateMetadataRegistry[templateId]?.stageType;
  if (resolvedStageType === "bible") return "manual.bible.generate";
  if (resolvedStageType === "structure" || resolvedStageType === "scene") return "manual.structure.generate";
  if (resolvedStageType === "script") return "manual.script.rewrite_scene";
  if (resolvedStageType === "storyboard") return "manual.storyboard.generate";
  if (resolvedStageType === "prompt") return "manual.studio.media_generate";
  if (
    resolvedStageType === "game_blueprint" ||
    resolvedStageType === "graph_generation" ||
    resolvedStageType === "interactive_script" ||
    resolvedStageType === "interactive_storyboard"
  ) {
    return "manual.game.editor";
  }
  return "manual.script.rewrite_scene";
};

const buildIssues = (input: ManualPromptGatewayInput) => {
  const metadata = productionTemplateMetadataRegistry[input.templateId];
  const issues: ProductionQAIssue[] = [];
  if (!input.finalPrompt.trim()) {
    issues.push(issue("manualPrompt.finalPrompt", "最终 prompt 为空，不能调用模型。", "blocking", "请先生成或填写 prompt。"));
  }
  (input.missingVariables || []).forEach((variable) => {
    issues.push(issue(`manualPrompt.variables.${variable}`, `模板缺少变量 {{${variable}}}。`, "warning", "请补齐模板变量，避免上下文没有注入。"));
  });
  (input.templateConflicts || []).forEach((conflict, index) => {
    issues.push(issue(`manualPrompt.templateConflicts.${index}`, conflict, "warning", "请确认模板与项目类型、互动/线性模式和 参考输入/视频 DNA 使用边界兼容。"));
  });
  validateProductionTemplateMetadata(metadata).forEach((warning, index) => {
    issues.push(issue(`manualPrompt.metadata.${index}`, warning, "warning", "请给模板补齐生产元数据。"));
  });
  if (input.workflowStepId === "manual.studio.media_generate" && !/image|video|audio|shot|prompt/i.test(input.finalPrompt)) {
    issues.push(issue("manualPrompt.mediaIntent", "Studio 媒体生成 prompt 缺少媒体类型或镜头上下文。", "warning", "请说明 image/video/audio 类型、目标 shot 和生成参数。"));
  }
  return issues;
};

const persistManualGatewayRecord = (record: unknown) => {
  try {
    if (typeof localStorage === "undefined") return;
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const records = Array.isArray(existing) ? existing : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([record, ...records].slice(0, 50)));
  } catch (error) {
    console.warn("Failed to persist manual prompt gateway record:", error);
  }
};

const persistManualGatewayOperatorRecord = async (
  input: ManualPromptGatewayInput,
  workflowStepId: string,
  gateway: Awaited<ReturnType<typeof runAgentGatewayStep>>,
) => {
  if (!input.projectId) return;
  try {
    const run = await productionClient.createOperatorRun({
      projectId: input.projectId,
      provider: "other",
      mode: "qa",
      userRequest: input.userIntent || `Manual prompt preview: ${input.templateId}`,
      scope: {
        projectId: input.projectId,
        episodeIds: input.episodeId ? [input.episodeId] : undefined,
        sceneIds: input.sceneId ? [input.sceneId] : undefined,
      },
    });
    if (!run) return;
    const blocking = gateway.qaVerdicts.some((verdict) => verdict.blocking);
    const warningCount = gateway.qaVerdicts.reduce((sum, verdict) => sum + verdict.issues.length, 0);
    await productionClient.appendOperatorRunEvent(run.id, {
      type: blocking ? "qa_failed" : "qa_passed",
      message: `Manual prompt gateway reviewed ${input.templateId} via ${workflowStepId}.`,
      targetPath: `manual.prompt.${input.templateId}`,
      entityIds: [input.projectId, input.episodeId, input.sceneId].filter(Boolean),
      data: {
        workflowStepId,
        agentRunId: gateway.agentRunId,
        draftStatus: gateway.draft.status,
        verdicts: gateway.qaVerdicts,
      },
    });
    await productionClient.updateOperatorRun(run.id, {
      status: blocking ? "needs_human_review" : "completed",
      qaSummary: {
        passed: gateway.qaVerdicts.filter((verdict) => verdict.status === "passed").length,
        warnings: warningCount,
        failed: gateway.qaVerdicts.filter((verdict) => verdict.status === "failed").length,
        blocked: gateway.qaVerdicts.filter((verdict) => verdict.blocking).length,
      },
    });
  } catch (error) {
    console.warn("Failed to persist manual prompt gateway operator record:", error);
  }
};

export const runManualPromptGatewayReview = async (
  input: ManualPromptGatewayInput,
) => {
  const workflowStepId = input.workflowStepId || inferManualWorkflowStepId(input.templateId, input.stageType);
  const issues = buildIssues({ ...input, workflowStepId });
  const blocking = issues.some((item) => item.severity === "blocking");
  const gateway = await runAgentGatewayStep({
    workflowStepId,
    trigger: "manual",
    input: {
      templateId: input.templateId,
      variables: input.variables,
      userIntent: input.userIntent,
      selectedContextIds: input.selectedContextIds || [],
      selectedSkillIds: input.selectedSkillIds || [],
    },
    producer: () => ({
      finalPrompt: input.finalPrompt,
      currentTemplate: input.currentTemplate,
      templateId: input.templateId,
      stageType: input.stageType,
    }),
    qaHandlers: {
      "qa.manual.prompt_preview": async () => ({
        qaAgentId: "qa.manual.prompt_preview",
        status: blocking ? "failed" : issues.length ? "warning" : "passed",
        blocking,
        score: blocking ? 0 : issues.length ? 78 : 100,
        issues,
        nextAction: blocking ? "blocked" : "commit",
      }),
      "qa.contract.manual.script_rewrite": async () => ({
        qaAgentId: "qa.contract.manual.script_rewrite",
        status: blocking ? "failed" : issues.length ? "warning" : "passed",
        blocking,
        score: blocking ? 0 : issues.length ? 78 : 100,
        issues,
        nextAction: blocking ? "blocked" : "commit",
      }),
      "qa.linear.shot_continuity": async () => ({
        qaAgentId: "qa.linear.shot_continuity",
        status: issues.length ? "warning" : "passed",
        blocking: false,
        score: issues.length ? 82 : 100,
        issues: issues.filter((item) => item.severity !== "blocking"),
        nextAction: "commit",
      }),
      "qa.linear.media_provenance": async () => ({
        qaAgentId: "qa.linear.media_provenance",
        status: issues.length ? "warning" : "passed",
        blocking: false,
        score: issues.length ? 82 : 100,
        issues: issues.filter((item) => item.severity !== "blocking"),
        nextAction: "commit",
      }),
    },
    contextFingerprint: `${input.templateId}:${input.finalPrompt.length}:${Date.now()}`,
    artifactKind: "manual_prompt_preview",
    targetPath: `manual.prompt.${input.templateId}`,
  });
  persistManualGatewayRecord({
    agentRunId: gateway.agentRunId,
    workflowStepId,
    templateId: input.templateId,
    draftStatus: gateway.draft.status,
    verdicts: gateway.qaVerdicts.map((verdict) => ({
      qaAgentId: verdict.qaAgentId,
      status: verdict.status,
      blocking: verdict.blocking,
      score: verdict.score,
      issueCount: verdict.issues.length,
    })),
    createdAt: Date.now(),
  });
  await persistManualGatewayOperatorRecord(input, workflowStepId, gateway);
  return gateway;
};
