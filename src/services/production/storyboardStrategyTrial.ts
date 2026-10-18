import type { Episode, Project, Scene } from "../../types/project";
import type { ProductionQAIssue } from "../../types/production";
import { QA_SEVERITY_POLICY_ID } from "./qaIssue";
import {
  validateStoryboardStrategyDraft,
  type StoryboardStrategyDraft,
} from "./storyboardStrategyDraft";
import {
  type StoryboardBoard,
  type VideoStoryboardArtifactIssue,
  validateStoryboardBoard,
} from "./videoStoryboardArtifacts";
import { buildProductionStoryboardBoardDrafts } from "./videoStoryboardStageBoards";
import {
  getStoryboardPromptStrategyById,
  type StoryboardStrategyDecision,
} from "./videoStoryboardSystem";
import {
  renderStoryboardBoardPrompt,
  validateStoryboardTemplateRender,
} from "./videoStoryboardTemplateRenderer";

export type StoryboardStrategyDraftTrialStatus =
  | "passed"
  | "failed"
  | "fallback_required";

export interface StoryboardStrategyDraftTrialBoard {
  boardId: string;
  sceneId: string;
  fallbackStrategyId: string;
  renderedStrategyId: string;
  templateId: string;
  promptPreview: string;
  warnings: string[];
}

export interface StoryboardStrategyDraftTrial {
  schemaVersion: "storyboard-strategy-draft-trial.v1";
  id: string;
  projectId: string;
  draftId: string;
  status: StoryboardStrategyDraftTrialStatus;
  sampleSceneIds: string[];
  fallbackStrategyId: string;
  renderedBoards: StoryboardStrategyDraftTrialBoard[];
  blockingIssueCount: number;
  issueCount: number;
  issues: ProductionQAIssue[];
  createdAt: number;
}

const clean = (value: unknown) => String(value || "").trim();
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const unique = (items: Array<string | undefined>) =>
  Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  options: Partial<ProductionQAIssue> = {},
): ProductionQAIssue => ({
  id: `storyboard_strategy_trial_${target.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${severity}`,
  target,
  message,
  severity,
  retryable: severity !== "blocking",
  issueType: "storyboard_strategy_draft_trial",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "auto_repairable",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
  ...options,
});

const boardIssueToProductionIssue = (
  item: VideoStoryboardArtifactIssue,
  boardId: string,
): ProductionQAIssue => issue(
  `storyboardStrategyTrial.${boardId}.${item.target}`,
  item.message,
  item.severity,
  {
    retryable: item.severity !== "blocking",
    issueType: "storyboard_strategy_draft_trial",
    resolutionClass: item.severity === "blocking" ? "hard_blocking" : "auto_repairable",
  },
);

const sceneById = (episodes: Episode[]) => {
  const map = new Map<string, Scene>();
  for (const episode of episodes) {
    for (const scene of episode.scenes || []) {
      if (scene.id) map.set(scene.id, scene);
    }
  }
  return map;
};

const applyDraftToBoard = (
  board: StoryboardBoard,
  draft: StoryboardStrategyDraft,
): StoryboardBoard => {
  const fallback = getStoryboardPromptStrategyById(draft.fallbackStrategyId) ||
    getStoryboardPromptStrategyById("storyboard.multi_shot_narrative.v1");
  const fallbackDecision: StoryboardStrategyDecision = {
    ...board.strategyDecision,
    selectedStrategyId: fallback?.id || board.strategyDecision.selectedStrategyId,
    selectedStrategyVersion: fallback?.version || board.strategyDecision.selectedStrategyVersion,
    rationale: [
      board.strategyDecision.rationale,
      `项目级草案试跑：${draft.name}。草案只作为 project-local 渲染合同，正式 QA 仍保留 fallback=${draft.fallbackStrategyId}。`,
    ].filter(Boolean).join(" "),
    arrowLegendIds: unique([...draft.annotationLegendIds, ...board.strategyDecision.arrowLegendIds]),
    qaChecklist: unique([...draft.qaChecklist, ...board.strategyDecision.qaChecklist]),
    // The trial is rendered by the project-local draft while the built-in
    // fallback remains the formal selection. The source board's capability
    // recipe belongs to a different strategy and must not leak into this QA.
    strategyResolution: undefined,
  };
  const legendIds = unique([...draft.annotationLegendIds, ...board.arrowLegendIds]);
  return {
    ...board,
    id: `${board.id}.trial.${draft.id}`,
    boardMode: draft.boardMode,
    strategyDecision: fallbackDecision,
    strategyOrigin: draft.scope,
    templateScope: draft.scope,
    strategyDraftId: draft.id,
    arrowLegendIds: legendIds,
    panels: board.panels.map((panel) => ({
      ...panel,
      annotationLegendIds: unique([...(panel.annotationLegendIds || []), ...draft.annotationLegendIds]),
      actionArrowLegendIds: unique([...(panel.actionArrowLegendIds || []), ...draft.annotationLegendIds]),
      renderInstruction: [
        panel.renderInstruction,
        `Project-local storyboard strategy draft trial: ${draft.name}. Use draft panel fields: ${draft.panelContractFields.join(", ")}.`,
      ].filter(Boolean).join(" "),
    })),
  };
};

export const buildStoryboardStrategyDraftTrial = ({
  project,
  episodes,
  draft,
  maxBoards = 1,
  createdAt = Date.now(),
}: {
  project: Project;
  episodes: Episode[];
  draft: StoryboardStrategyDraft;
  maxBoards?: number;
  createdAt?: number;
}): StoryboardStrategyDraftTrial => {
  const issues: ProductionQAIssue[] = [...validateStoryboardStrategyDraft(draft)];
  const scenes = sceneById(episodes);
  const draftSampleSceneIds = unique(draft.sampleSceneIds);
  const generated = buildProductionStoryboardBoardDrafts(project, episodes);
  let candidateBoards = generated.storyboardBoards;
  if (draftSampleSceneIds.length > 0) {
    candidateBoards = candidateBoards.filter((board) => draftSampleSceneIds.includes(board.sceneId));
  }
  if (candidateBoards.length === 0) {
    issues.push(issue(
      "storyboardStrategyTrial.sampleSceneIds",
      draftSampleSceneIds.length
        ? `草案样本场景没有可试跑的 storyboard_board：${draftSampleSceneIds.join(", ")}。`
        : "草案试跑至少需要一个含 shots 的样本场景。",
      "blocking",
    ));
  }
  const renderedBoards = candidateBoards.slice(0, Math.max(1, maxBoards)).flatMap((board) => {
    const scene = scenes.get(board.sceneId);
    if (!scene) {
      issues.push(issue(`storyboardStrategyTrial.${board.id}.scene`, `找不到样本场景：${board.sceneId}。`, "blocking"));
      return [];
    }
    const trialBoard = applyDraftToBoard(board, draft);
    const render = renderStoryboardBoardPrompt({ project, scene, board: trialBoard, strategyDraft: draft });
    trialBoard.lineArtPrompt = render.prompt;
    issues.push(...validateStoryboardTemplateRender(render).map((message) =>
      issue(`storyboardStrategyTrial.${trialBoard.id}.render`, message, "blocking"),
    ));
    issues.push(...validateStoryboardBoard(trialBoard).map((item) => boardIssueToProductionIssue(item, trialBoard.id)));
    return [{
      boardId: trialBoard.id,
      sceneId: trialBoard.sceneId,
      fallbackStrategyId: draft.fallbackStrategyId,
      renderedStrategyId: render.strategyId,
      templateId: render.templateId,
      promptPreview: render.prompt.slice(0, 1000),
      warnings: render.warnings,
    }];
  });
  const blockingIssueCount = issues.filter((item) => item.severity === "blocking").length;
  const status: StoryboardStrategyDraftTrialStatus = blockingIssueCount > 0
    ? "failed"
    : draft.status === "approved" || draft.status === "promoted"
      ? "passed"
      : "fallback_required";
  return {
    schemaVersion: "storyboard-strategy-draft-trial.v1",
    id: `storyboard_strategy_trial_${draft.id}_${createdAt}`,
    projectId: project.id,
    draftId: draft.id,
    status,
    sampleSceneIds: draftSampleSceneIds.length ? draftSampleSceneIds : unique(renderedBoards.map((board) => board.sceneId)),
    fallbackStrategyId: draft.fallbackStrategyId,
    renderedBoards,
    blockingIssueCount,
    issueCount: issues.length,
    issues,
    createdAt,
  };
};

export const validateStoryboardStrategyDraftTrial = (
  trial: Partial<StoryboardStrategyDraftTrial> | undefined,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  if (!trial || typeof trial !== "object") {
    return [issue("storyboardStrategyTrial", "storyboard_strategy_draft_trial 必须是结构化对象。", "blocking")];
  }
  if (trial.schemaVersion !== "storyboard-strategy-draft-trial.v1") {
    issues.push(issue("storyboardStrategyTrial.schemaVersion", "schemaVersion 必须是 storyboard-strategy-draft-trial.v1。", "blocking"));
  }
  if (!clean(trial.id)) issues.push(issue("storyboardStrategyTrial.id", "缺少 id。", "blocking"));
  if (!clean(trial.projectId)) issues.push(issue("storyboardStrategyTrial.projectId", "缺少 projectId。", "blocking"));
  if (!clean(trial.draftId)) issues.push(issue("storyboardStrategyTrial.draftId", "缺少 draftId。", "blocking"));
  if (!["passed", "failed", "fallback_required"].includes(clean(trial.status))) {
    issues.push(issue("storyboardStrategyTrial.status", "status 必须是 passed/failed/fallback_required。", "blocking"));
  }
  if (!Array.isArray(trial.renderedBoards) || trial.renderedBoards.length === 0) {
    issues.push(issue("storyboardStrategyTrial.renderedBoards", "草案试跑必须至少渲染一个样本 board。", "blocking"));
  }
  if (Number(trial.blockingIssueCount || 0) > 0 && trial.status === "passed") {
    issues.push(issue("storyboardStrategyTrial.status", "存在 blocking issue 的试跑不能标记 passed。", "blocking"));
  }
  for (const board of asArray<StoryboardStrategyDraftTrialBoard>(trial.renderedBoards)) {
    if (!clean(board.boardId) || !clean(board.sceneId) || !clean(board.templateId) || !clean(board.promptPreview)) {
      issues.push(issue(`storyboardStrategyTrial.renderedBoards.${board.boardId || "unknown"}`, "renderedBoard 必须包含 boardId、sceneId、templateId 和 promptPreview。", "blocking"));
    }
  }
  return issues;
};

export const buildStoryboardStrategyTrialSystem = () => ({
  schemaVersion: "storyboard-strategy-trial-system.v1",
  status: "available_operator_builder",
  artifactSchema: "storyboard-strategy-draft-trial.v1",
  builderFunction: "buildStoryboardStrategyDraftTrial",
  qaFunction: "validateStoryboardStrategyDraftTrial",
  operatorApi: {
    createTrial: "POST /api/operator/projects/:projectId/storyboard-strategy-trials",
    createGlobalCandidate: "POST /api/operator/projects/:projectId/storyboard-strategy-promotions",
  },
  purpose: "Run a project-local storyboard_strategy_draft against real scene/shot data before allowing wider project use.",
  requiredBehavior: [
    "A draft trial must render at least one sample StoryboardBoard through the template renderer.",
    "The trial keeps fallbackStrategyId active; failed drafts fall back instead of blocking the whole production.",
    "Approved/promoted drafts must have sampleSceneIds and pass validation before being used beyond the test scope.",
    "Global promotion is not automatic; it requires separate human approval and multi-scene regression.",
  ],
});
