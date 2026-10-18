import { generateAIContent } from "../ai";
import type {
  ProductionModelTaskType,
  ProductionStageExecutionResult,
  ProductionStageRun,
  PromptReview,
} from "../../types/production";
import {
  estimateTokens,
} from "./promptUtils";

const textTaskTypes = new Set<ProductionModelTaskType>([
  "scriptGen",
  "storyboardGen",
  "qcAnalyzer",
]);

const taskTypeForStage = (stage: ProductionStageRun): ProductionModelTaskType => {
  if (textTaskTypes.has(stage.modelUsed as ProductionModelTaskType)) {
    return stage.modelUsed as ProductionModelTaskType;
  }
  if (["storyboard", "prompt", "interactive_storyboard"].includes(stage.stageType)) {
    return "storyboardGen";
  }
  if (stage.stageType.includes("qa") || stage.stageType === "playtest_simulation") {
    return "qcAnalyzer";
  }
  return "scriptGen";
};

export class PromptApprovalRequiredError extends Error {
  public promptReview: PromptReview;
  constructor(promptReview: PromptReview) {
    super("Awaiting prompt approval from the author.");
    this.name = "PromptApprovalRequiredError";
    this.promptReview = promptReview;
  }
}

const TEXT_LLM_STAGES: string[] = [
  "concept",
  "bible",
  "asset_detail",
  "structure",
  "scene",
  "script",
  "storyboard",
  "prompt",
  "interactive_bible",
  "interactive_script",
  "interactive_storyboard",
  "game_blueprint",
  "graph_generation",
];

const computeFingerprint = (prompt: string, stageType: string, revisionInstructions?: string, runtimeParams?: string) => {
  const content = `${prompt}::${stageType}::${revisionInstructions || ""}::${runtimeParams || ""}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
};

const approvedStageExecutions = new Set<string>();
const activeApprovedStageExecutionSessions = new Set<string>();

const promptApprovalExecutionKey = (stageId: string, fingerprint: string) =>
  `${stageId}:${fingerprint}`;

const approvedPromptForReview = (review: PromptReview, finalPrompt: string) =>
  review.status === "edited" && review.editedPrompt?.trim()
    ? review.editedPrompt
    : finalPrompt;

export const generateStageAIContent = (
  stage: ProductionStageRun,
  options: Parameters<typeof generateAIContent>[0],
) => {
  const finalPrompt = options.prompt;
  const recordPromptComposition = (audit: Parameters<NonNullable<Parameters<typeof generateAIContent>[0]["onPromptComposed"]>>[0]) => {
    const currentContext = stage.contextUsed && typeof stage.contextUsed === "object"
      ? stage.contextUsed as Record<string, unknown>
      : {};
    const existing = Array.isArray(currentContext.promptCompositionManifests)
      ? currentContext.promptCompositionManifests
      : [];
    stage.contextUsed = {
      ...currentContext,
      promptCompositionManifests: [...existing, audit.manifest],
    };
    options.onPromptComposed?.(audit);
  };

  if (TEXT_LLM_STAGES.includes(stage.stageType)) {
    const runtimeParams = stage.runtimeControlOverrides
      ? JSON.stringify(stage.runtimeControlOverrides)
      : "";
    const currentFingerprint = computeFingerprint(finalPrompt, stage.stageType, stage.revisionInstructions, runtimeParams);
    const existing = stage.promptReview;
    const approvalKey = promptApprovalExecutionKey(stage.id, currentFingerprint);

    const approvedStatus = existing?.status === "approved"
      || existing?.status === "edited"
      || (existing?.status === "stale" && Boolean(existing.approvedAt));
    const hasActiveStageSession = activeApprovedStageExecutionSessions.has(stage.id);

    if (!existing) {
      const newReview: PromptReview = {
        id: `pr-${stage.id}-${Date.now()}`,
        status: "pending",
        originalPrompt: finalPrompt,
        templateId: `template.${stage.stageType}`,
        templateVersion: "v1.0",
        contextFingerprint: currentFingerprint,
        tokenEstimate: estimateTokens(finalPrompt),
        createdAt: Date.now(),
      };
      throw new PromptApprovalRequiredError(newReview);
    }

    if (existing.status === "pending" || existing.status === "rejected") {
      throw new PromptApprovalRequiredError(existing);
    }

    if (!approvedStatus) {
      throw new PromptApprovalRequiredError(existing);
    }
    if (existing.contextFingerprint !== currentFingerprint && !hasActiveStageSession) {
      stage.inputConflictWarning = "提示词上下文已有更新；已保留原批准并使用当前上下文继续，可按需重新检查。";
    }

    const alreadyApproved = approvedStageExecutions.has(approvalKey);
    if (!alreadyApproved) {
      approvedStageExecutions.add(approvalKey);
      const expiryTimer = setTimeout(() => approvedStageExecutions.delete(approvalKey), 30000);
      // Expiring this in-memory cache must not keep Node test or CLI processes alive.
      if (typeof expiryTimer === "object" && "unref" in expiryTimer) {
        expiryTimer.unref();
      }
    }
    if (existing.contextFingerprint === currentFingerprint) {
      activeApprovedStageExecutionSessions.add(stage.id);
    }

    const promptToUse = existing.contextFingerprint === currentFingerprint
      ? approvedPromptForReview(existing, finalPrompt)
      : finalPrompt;

    return generateAIContent({
      ...options,
      prompt: promptToUse,
      taskType: options.taskType || taskTypeForStage(stage),
      onPromptComposed: recordPromptComposition,
    });
  }

  return generateAIContent({
    ...options,
    prompt: finalPrompt,
    taskType: options.taskType || taskTypeForStage(stage),
    onPromptComposed: recordPromptComposition,
  });
};

export const aiTrace = (
  stage: ProductionStageRun,
  promptUsed?: string,
  rawOutput?: string,
  templateUsed?: ProductionStageExecutionResult["templateUsed"],
) => ({
  promptUsed,
  rawOutput,
  modelUsed: taskTypeForStage(stage),
  templateUsed: templateUsed || {
    id: `runner.${stage.stageType}`,
    name: `${stage.title} inline runner prompt`,
    source: "runner.inline" as const,
    version: "unversioned",
  },
  contextUsed: {
    stageType: stage.stageType,
    revisionInstructions: stage.revisionInstructions,
    contextTrace: (stage.contextUsed as { contextTrace?: unknown } | undefined)?.contextTrace,
    promptCompositionManifests: (stage.contextUsed as { promptCompositionManifests?: unknown } | undefined)?.promptCompositionManifests,
  },
});

export const clearActiveApprovedStageExecutionSession = (stageId: string) => {
  activeApprovedStageExecutionSessions.delete(stageId);
};
