import type { ProductionQAIssue } from "../../../../../src/types/production";
import { normalizeProductionQAIssues, QA_SEVERITY_POLICY_ID } from "./qaIssue";
import {
  getStoryboardPromptStrategyById,
  STORYBOARD_ARROW_LEGEND,
  StoryboardBoardMode,
  StoryboardPromptStrategy,
} from "./videoStoryboardSystem";

export type StoryboardStrategyDraftScope =
  | "project_local"
  | "production_block_local"
  | "scene_range_local"
  | "global_candidate";

export type StoryboardStrategyDraftStatus =
  | "draft"
  | "qa_failed"
  | "approved"
  | "rejected"
  | "promoted";

export interface StoryboardStrategyDraft {
  schemaVersion: "storyboard-strategy-draft.v1";
  id: string;
  projectId: string;
  scope: StoryboardStrategyDraftScope;
  status: StoryboardStrategyDraftStatus;
  name: string;
  boardMode: StoryboardBoardMode;
  promptTemplateId: string;
  inheritsFromStrategyIds: string[];
  gapStatement: string;
  requiredCapabilityIds: string[];
  coveredCapabilityIds: string[];
  recommendedWhen: string[];
  avoidWhen: string[];
  requiredInputs: string[];
  outputContract: string[];
  panelContractFields: string[];
  annotationLegendIds: string[];
  qaChecklist: string[];
  modelCompatibilityTags: string[];
  fallbackStrategyId: string;
  sampleSceneIds: string[];
  promotionNotes?: string;
  createdAt: number;
}

const clean = (value: unknown) => String(value || "").trim();
const asArray = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

const issue = (
  target: string,
  message: string,
  severity: ProductionQAIssue["severity"] = "warning",
  options: Partial<ProductionQAIssue> = {},
): ProductionQAIssue => ({
  id: `storyboard_strategy_draft_${target.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${severity}`,
  target,
  message,
  severity,
  retryable: severity !== "blocking",
  issueType: "storyboard_strategy_draft_contract",
  resolutionClass: severity === "blocking" ? "hard_blocking" : "auto_repairable",
  severityPolicyId: QA_SEVERITY_POLICY_ID,
  ...options,
});

const activeLegendIds = () => new Set(STORYBOARD_ARROW_LEGEND.map((legend) => legend.id));

export const createStoryboardPromptStrategyFromDraft = (
  draft: StoryboardStrategyDraft,
): StoryboardPromptStrategy => ({
  id: draft.id,
  version: "draft",
  name: draft.name,
  status: draft.status === "promoted" || draft.status === "approved" ? "experimental" : "experimental",
  boardMode: draft.boardMode,
  recommendedWhen: draft.recommendedWhen,
  avoidWhen: draft.avoidWhen,
  requiredInputs: draft.requiredInputs,
  outputContract: draft.outputContract,
  promptTemplateId: draft.promptTemplateId,
  qaChecklist: draft.qaChecklist,
  modelCompatibilityTags: draft.modelCompatibilityTags,
});

export const validateStoryboardStrategyDraft = (
  draft: Partial<StoryboardStrategyDraft> | undefined,
): ProductionQAIssue[] => {
  const issues: ProductionQAIssue[] = [];
  const legendIds = activeLegendIds();
  if (!draft) {
    return normalizeProductionQAIssues([issue("storyboard_strategy_draft", "storyboard_strategy_draft artifact 必须包含结构化草案。", "blocking")]);
  }
  if (draft.schemaVersion !== "storyboard-strategy-draft.v1") {
    issues.push(issue("storyboard_strategy_draft.schemaVersion", "schemaVersion 必须是 storyboard-strategy-draft.v1。", "blocking"));
  }
  if (!hasText(draft.id)) issues.push(issue("storyboard_strategy_draft.id", "缺少 id。", "blocking"));
  if (!hasText(draft.projectId)) issues.push(issue("storyboard_strategy_draft.projectId", "缺少 projectId。", "blocking"));
  if (!hasText(draft.name)) issues.push(issue("storyboard_strategy_draft.name", "缺少策略名称。", "blocking"));
  if (!hasText(draft.gapStatement) || clean(draft.gapStatement).length < 24) {
    issues.push(issue("storyboard_strategy_draft.gapStatement", "必须说明现有内置故事板为什么不够用，且理由不能太短。", "blocking"));
  }
  if (!Array.isArray(draft.requiredCapabilityIds) || draft.requiredCapabilityIds.length === 0) {
    issues.push(issue("storyboard_strategy_draft.requiredCapabilityIds", "草案必须保存触发它的结构化能力需求。", "blocking"));
  }
  if (!Array.isArray(draft.coveredCapabilityIds) || draft.coveredCapabilityIds.length === 0) {
    issues.push(issue("storyboard_strategy_draft.coveredCapabilityIds", "草案必须声明试图覆盖的能力，不能只靠自然语言承诺。", "blocking"));
  } else {
    const covered = new Set(draft.coveredCapabilityIds);
    const stillUncovered = asArray<string>(draft.requiredCapabilityIds).filter((capabilityId) => !covered.has(capabilityId));
    if (stillUncovered.length) {
      issues.push(issue(
        "storyboard_strategy_draft.coveredCapabilityIds",
        `草案仍未覆盖能力：${stillUncovered.join("、")}。不能进入试跑。`,
        "blocking",
      ));
    }
  }
  if (!Array.isArray(draft.inheritsFromStrategyIds) || draft.inheritsFromStrategyIds.length === 0) {
    issues.push(issue("storyboard_strategy_draft.inheritsFromStrategyIds", "草案必须学习至少一个内置故事板策略，不能只写“创建故事板”。", "blocking"));
  } else {
    for (const strategyId of draft.inheritsFromStrategyIds) {
      if (!getStoryboardPromptStrategyById(strategyId)) {
        issues.push(issue("storyboard_strategy_draft.inheritsFromStrategyIds", `继承的内置策略不存在：${strategyId}`, "blocking"));
      }
    }
  }
  if (!draft.fallbackStrategyId || !getStoryboardPromptStrategyById(draft.fallbackStrategyId)) {
    issues.push(issue("storyboard_strategy_draft.fallbackStrategyId", "必须绑定一个已存在的 fallbackStrategyId。", "blocking"));
  }
  if (draft.fallbackStrategyId && draft.id && draft.fallbackStrategyId === draft.id) {
    issues.push(issue("storyboard_strategy_draft.fallbackStrategyId", "fallbackStrategyId 不能指向自己。", "blocking"));
  }
  for (const field of ["recommendedWhen", "avoidWhen", "requiredInputs", "outputContract", "panelContractFields", "qaChecklist", "modelCompatibilityTags"] as const) {
    if (!Array.isArray(draft[field]) || draft[field]!.length === 0) {
      issues.push(issue(`storyboard_strategy_draft.${field}`, `${field} 必须是非空数组。`, "blocking"));
    }
  }
  const panelFields = new Set(asArray<string>(draft.panelContractFields));
  for (const requiredField of ["panelNumber", "framePurpose", "subjectAction", "cameraMove", "continuityIn", "continuityOut"]) {
    if (!panelFields.has(requiredField)) {
      issues.push(issue("storyboard_strategy_draft.panelContractFields", `panelContractFields 必须包含 ${requiredField}。`, "blocking"));
    }
  }
  if (!Array.isArray(draft.annotationLegendIds) || draft.annotationLegendIds.length === 0) {
    issues.push(issue("storyboard_strategy_draft.annotationLegendIds", "必须声明使用哪些标注 legend。", "blocking"));
  } else {
    for (const legendId of draft.annotationLegendIds) {
      if (!legendIds.has(legendId)) {
        issues.push(issue("storyboard_strategy_draft.annotationLegendIds", `未知 annotation legend：${legendId}`, "blocking"));
      }
    }
    if (!draft.annotationLegendIds.includes("subject_action_red") || !draft.annotationLegendIds.includes("camera_motion_blue")) {
      issues.push(issue("storyboard_strategy_draft.annotationLegendIds", "草案至少要继承红色动作箭头和蓝色镜头箭头。", "blocking"));
    }
  }
  if (draft.scope === "global_candidate" && draft.status !== "promoted" && draft.status !== "approved") {
    issues.push(issue("storyboard_strategy_draft.scope", "global_candidate 不能停留在未批准草案状态；先作为 project_local 试用。", "blocking"));
  }
  if (draft.status === "approved" && (!Array.isArray(draft.sampleSceneIds) || draft.sampleSceneIds.length === 0)) {
    issues.push(issue("storyboard_strategy_draft.sampleSceneIds", "批准故事板草案前必须绑定样本场景或样本镜头。", "blocking"));
  }
  return normalizeProductionQAIssues(issues);
};

export const buildStoryboardStrategyDraftSystem = () => ({
  schemaVersion: "storyboard-strategy-draft-system.v1",
  status: "project_local_strategy_drafts_available_operator_artifact_only",
  purpose: "Allow AI producers to propose a new storyboard strategy only when built-in strategies do not fit the production need.",
  artifactKind: "storyboard_strategy_draft",
  creationPolicy: [
    "AI must first inspect built-in STORYBOARD_PROMPT_STRATEGIES, resolve capability coverage, and state the specific uncovered capability ids.",
    "AI must try one primary preset plus at most two modifier strategies before proposing a draft.",
    "A draft must inherit from at least one built-in strategy and bind a built-in fallback strategy.",
    "A draft must persist requiredCapabilityIds and prove coveredCapabilityIds before a sample trial.",
    "A draft may be project-local or production-block-local by default; global promotion needs approval and sample coverage.",
    "A draft must define panel fields, annotation legend ids, QA checklist, required inputs, output contract, and model compatibility tags.",
    "An approved or promoted draft must have sampleSceneIds and a passed storyboard_strategy_draft_trial before wider production use.",
    "A draft cannot bypass visualStyleLock, department prep refs, asset reference packs, or video generation approval.",
    "Automatic draft revision and trial are each limited to one attempt; failure returns to fallbackStrategyId or creator decision instead of another automatic loop.",
  ],
  builtInStudyFields: [
    "recommendedWhen",
    "avoidWhen",
    "requiredInputs",
    "outputContract",
    "promptTemplateId",
    "qaChecklist",
    "modelCompatibilityTags",
    "annotationLegendIds",
    "requiredCapabilityIds",
    "coveredCapabilityIds",
  ],
  qaFunction: "validateStoryboardStrategyDraft",
  trialArtifactKind: "storyboard_strategy_draft_trial",
  trialFunction: "buildStoryboardStrategyDraftTrial",
  maxAutomaticDraftRevisionAttempts: 1,
  maxAutomaticTrialAttempts: 1,
  fallbackBehavior: "If draft QA fails, use fallbackStrategyId and record the gap as a production note instead of blocking the whole show.",
});
