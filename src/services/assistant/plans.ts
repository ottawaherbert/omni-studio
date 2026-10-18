import { validateModelSchema } from '../../../packages/model-output/src';
import { createHash } from "node:crypto";

import type {
  AssistantMessage,
  AssistantPageFocus,
  AssistantPlan,
  AssistantProjectRef,
  AssistantPromptExecutionPreview,
  AssistantRun,
  AssistantThread,
} from "../../../packages/domain/src/assistant";
import { assistantRepository, type AssistantRepository } from "../../server/assistantRepository";
import { assistantCapabilitiesForNamespace, findAssistantCapability } from "./capabilities";
import { buildAssistantContextSnapshot, compactAssistantConversation, getAssistantProjectSummary, type AssistantCheckpointGenerator } from "./context";
import { buildProductionPreparationPromptPreviews, type SelectedAssistantSkill } from "./productionPreparationBatch";

const id = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const textBlock = (text: string): AssistantMessage["blocks"][number] => ({ type: "text", text });

export interface AssistantPlannerGenerator extends AssistantCheckpointGenerator {}

interface PlannerResult {
  responseType: "answer" | "plan" | "clarify";
  message: string;
  capabilityId?: string;
  summary?: string;
  steps?: string[];
  input?: Record<string, unknown>;
}

const plannerPrompt = (
  goal: string,
  thread: AssistantThread,
  snapshot: ReturnType<typeof buildAssistantContextSnapshot>,
) => [
  "你是 O.M.N.I. 全站统一助手的意图规划器。你只能从提供的 capability 清单选择能力，不能编造工具、调用源码、Shell、raw SQL 或模拟浏览器点击。",
  "当前页面只是理解代词的焦点，执行前必须使用项目事实中的稳定 ID。Writing、Production 和 Interactive 相互隔离；跨模块导入必须走正式导出包和来源快照。",
  "如果用户只是咨询或读取状态，responseType=answer。需要修改、导入、生成、质检或 Agent 编排时，responseType=plan。目标或实体不唯一时，responseType=clarify。",
  "不要用关键词正则式思维猜测意图。基于目标、项目事实、页面焦点和 capability 语义整体判断。",
  "返回 JSON：",
  JSON.stringify({
    responseType: "answer | plan | clarify",
    message: "直接给创作者看的回答或澄清问题",
    capabilityId: "plan 时必须是清单中的 id",
    summary: "用创作者语言说明将完成什么",
    steps: ["最多 6 个创作者能理解的步骤"],
    input: { episodeId: "需要时填写稳定 ID", sceneId: "需要时填写稳定 ID", workUnitKind: "episode 或 segment", sourceWritingProjectId: "跨模块导入时填写唯一 Writing 项目 ID" },
  }, null, 2),
  "当前会话：",
  JSON.stringify({ id: thread.id, title: thread.title, projectRef: thread.projectRef, latestCheckpoint: snapshot.latestCheckpoint }, null, 2),
  "当前页面焦点：",
  JSON.stringify(snapshot.pageFocus || {}, null, 2),
  "当前项目事实摘要：",
  JSON.stringify(snapshot.projectSummary, null, 2),
  "正在运行的任务：",
  JSON.stringify(snapshot.activeRuns.map((run) => ({ id: run.id, goal: run.goal, status: run.status, summary: run.summary })), null, 2),
  "可用 capability：",
  JSON.stringify(assistantCapabilitiesForNamespace(thread.projectRef?.namespace).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    kind: item.kind,
    risk: item.risk,
    preconditions: item.preconditions,
  })), null, 2),
  "用户目标：",
  goal,
].join("\n\n");

export const assistantPlannerOutputSchema = {
  type: 'object', additionalProperties: false, required: ['responseType', 'message'],
  properties: {
    responseType: { enum: ['answer', 'plan', 'clarify'] }, message: { type: 'string', minLength: 1 },
    capabilityId: { type: 'string' }, summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' }, maxItems: 8 }, input: { type: 'object' },
  },
};

const normalizePlannerResult = (value: Record<string, unknown>): PlannerResult => {
  validateModelSchema(value, assistantPlannerOutputSchema);
  const responseType = value.responseType as PlannerResult["responseType"];
  return {
    responseType,
    message: String(value.message || "").trim(),
    capabilityId: typeof value.capabilityId === "string" ? value.capabilityId : undefined,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    steps: Array.isArray(value.steps) ? value.steps.map(String).filter(Boolean).slice(0, 8) : [],
    input: value.input && typeof value.input === "object" ? value.input as Record<string, unknown> : {},
  };
};

const planHash = (plan: Omit<AssistantPlan, "planHash">) => hash({
  threadId: plan.threadId,
  projectRef: plan.projectRef,
  goal: plan.goal,
  capabilityId: plan.capabilityId,
  steps: plan.steps,
  promptPreviews: plan.promptPreviews.map((prompt) => ({ id: prompt.id, promptHash: prompt.promptHash, selectedSkillIds: prompt.selectedSkillIds })),
  input: plan.input,
});

const createMessage = (
  thread: AssistantThread,
  role: AssistantMessage["role"],
  blocks: AssistantMessage["blocks"],
  contextSnapshotId?: string,
  runIds: string[] = [],
): AssistantMessage => ({
  id: id("assistant-message"),
  threadId: thread.id,
  projectRef: thread.projectRef,
  role,
  blocks,
  contextSnapshotId,
  runIds,
  createdAt: Date.now(),
});

const inputForExplicitCapability = (
  capabilityId: string,
  pageFocus: AssistantPageFocus | undefined,
  input: Record<string, unknown>,
) => {
  if (capabilityId !== "production.auto_prepare_unit") return input;
  return {
    ...input,
    episodeId: input.episodeId || pageFocus?.episodeId,
    workUnitKind: input.workUnitKind || "episode",
  };
};

const buildPlan = (
  thread: AssistantThread,
  goal: string,
  capabilityId: string,
  summary: string,
  stepTitles: string[],
  input: Record<string, unknown>,
  promptPreviews: AssistantPromptExecutionPreview[],
  plannerAudit: Record<string, unknown>,
): AssistantPlan => {
  const capability = findAssistantCapability(capabilityId);
  if (!capability || capability.risk === "forbidden") throw new Error("助手规划了未注册或禁止的能力。");
  if (capability.projectScope === "required" && !thread.projectRef) throw new Error("该操作需要先进入一个项目。");
  if (capability.module !== "shared" && thread.projectRef && capability.module !== thread.projectRef.namespace) throw new Error("该能力不属于当前项目模块。");
  const now = Date.now();
  const base: Omit<AssistantPlan, "planHash"> = {
    id: id("assistant-plan"),
    threadId: thread.id,
    projectRef: thread.projectRef,
    goal,
    summary: summary || capability.description,
    capabilityId,
    risk: capability.risk,
    steps: (stepTitles.length ? stepTitles : [capability.title]).map((title, index) => ({
      id: `plan-step-${index + 1}`,
      title,
      capabilityId,
      dependsOn: index ? [`plan-step-${index}`] : [],
    })),
    promptPreviews,
    input: { ...input, __plannerAudit: plannerAudit },
    requiresConfirmation: capability.risk !== "read",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
  return { ...base, planHash: planHash(base) };
};

export interface CreateAssistantTurnInput {
  threadId: string;
  goal: string;
  pageFocus?: AssistantPageFocus;
  capabilityId?: string;
  input?: Record<string, unknown>;
  selectedSkills?: SelectedAssistantSkill[];
}

export const createAssistantTurn = async (
  input: CreateAssistantTurnInput,
  generator: AssistantPlannerGenerator,
  repository: AssistantRepository = assistantRepository,
): Promise<{ userMessage: AssistantMessage; assistantMessage: AssistantMessage; plan?: AssistantPlan }> => {
  const thread = repository.getThread(input.threadId);
  if (!thread) throw new Error("助手会话不存在。");
  const goal = input.goal.trim();
  if (!goal) throw new Error("请输入你希望助手完成的目标。");
  const shouldNameThread = thread.title === "新对话" || thread.title === "项目主会话" || thread.title === "全局会话";
  const updatedThread = repository.saveThread({
    ...thread,
    title: shouldNameThread ? goal.slice(0, 28) : thread.title,
    lastPageFocus: input.pageFocus || thread.lastPageFocus,
    updatedAt: Date.now(),
    lastOpenedAt: Date.now(),
  });
  const snapshot = buildAssistantContextSnapshot(updatedThread, input.pageFocus, repository);
  const userMessage = repository.saveMessage(createMessage(updatedThread, "user", [textBlock(goal)], snapshot.id));
  let result: PlannerResult;
  let prompt = "";
  if (input.capabilityId) {
    const capability = findAssistantCapability(input.capabilityId);
    if (!capability) throw new Error("指定的系统能力不存在。");
    const explicitSteps = capability.id === "production.auto_prepare_unit"
      ? ["核对完整剧本来源与正式场次", "按顺序完成全部场次拆解", "调度十二个专业部门生成、质检和自动修改", "检查跨部门交接与资产连续性", "交付整集结果和综合质量结论"]
      : ["确认当前工作范围", "执行专业能力", "完成质检并交付结果"];
    result = {
      responseType: capability.risk === "read" ? "answer" : "plan",
      message: capability.risk === "read" ? "我已读取当前项目状态。" : "已按当前项目和页面范围准备执行计划。",
      capabilityId: capability.id,
      summary: capability.description,
      steps: explicitSteps,
      input: inputForExplicitCapability(capability.id, input.pageFocus || updatedThread.lastPageFocus, input.input || {}),
    };
  } else {
    prompt = plannerPrompt(goal, updatedThread, snapshot);
    result = normalizePlannerResult(await generator({
      systemInstruction: "你是全站助手规划器。只负责规划，不执行项目修改。",
      prompt, responseSchema: assistantPlannerOutputSchema,
    }));
  }
  const plannerAudit = { prompt, promptHash: prompt ? hash(prompt) : undefined, contextSnapshotId: snapshot.id, capabilityVersion: "2026-07-14.v1" };
  if (result.responseType !== "plan") {
    const answer = result.responseType === "answer" && result.capabilityId === "assistant.read_project_status"
      ? `${result.message}\n\n${JSON.stringify(getAssistantProjectSummary(updatedThread.projectRef), null, 2)}`
      : result.message || (result.responseType === "clarify" ? "请补充需要处理的项目范围或目标对象。" : "我已读取当前上下文。");
    const assistantMessage = repository.saveMessage(createMessage(updatedThread, "assistant", [textBlock(answer)], snapshot.id));
    void compactAssistantConversation(updatedThread, generator, repository).catch(() => undefined);
    return { userMessage, assistantMessage };
  }
  const capabilityId = result.capabilityId || "";
  const capability = findAssistantCapability(capabilityId);
  if (!capability) throw new Error("助手无法把目标映射到已注册能力，请换一种说法或从快捷操作开始。");
  const planInput = inputForExplicitCapability(capabilityId, input.pageFocus || updatedThread.lastPageFocus, { ...(result.input || {}), ...(input.input || {}) });
  let promptPreviews: AssistantPromptExecutionPreview[] = [];
  if (capabilityId === "production.auto_prepare_unit") {
    const projectId = updatedThread.projectRef?.projectId;
    const episodeId = String(planInput.episodeId || "");
    if (!projectId || !episodeId) {
      const assistantMessage = repository.saveMessage(createMessage(updatedThread, "assistant", [textBlock("请选择要自动筹备的分集或电影分段，我会据此生成整批 Agent 计划。")], snapshot.id));
      return { userMessage, assistantMessage };
    }
    const preparationPreview = buildProductionPreparationPromptPreviews(projectId, episodeId, input.selectedSkills || []);
    promptPreviews = preparationPreview.prompts;
    result.summary = `自动完成《${preparationPreview.episode.title}》的场次拆解、十二部门专业筹备与整集质量检查。`;
  }
  const plan = repository.savePlan(buildPlan(
    updatedThread,
    goal,
    capabilityId,
    result.summary || capability.description,
    result.steps || [],
    planInput,
    promptPreviews,
    plannerAudit,
  ));
  const assistantMessage = repository.saveMessage(createMessage(updatedThread, "assistant", [
    textBlock(result.message || "我已经整理好执行计划。确认后会在授权范围内自动完成，只有真正需要创作者决定时才暂停。"),
    { type: "plan", planId: plan.id, summary: plan.summary, steps: plan.steps.map((step) => step.title), risk: plan.risk },
  ], snapshot.id));
  void compactAssistantConversation(updatedThread, generator, repository).catch(() => undefined);
  return { userMessage, assistantMessage, plan };
};

export const updateAssistantPlanPrompts = (
  plan: AssistantPlan,
  promptPreviews: AssistantPromptExecutionPreview[],
): AssistantPlan => {
  const originalIds = new Set(plan.promptPreviews.map((item) => item.id));
  if (promptPreviews.length !== plan.promptPreviews.length || promptPreviews.some((item) => !originalIds.has(item.id))) {
    throw new Error("Prompt 清单与已预览计划不一致，不能授权执行。");
  }
  const updated = {
    ...plan,
    promptPreviews: promptPreviews.map((item) => ({ ...item, promptHash: hash(item.prompt) })),
    updatedAt: Date.now(),
  };
  const { planHash: _, ...base } = updated;
  return { ...updated, planHash: planHash(base) };
};

export const createAssistantRunForPlan = (
  plan: AssistantPlan,
  repository: AssistantRepository = assistantRepository,
): AssistantRun => {
  const now = Date.now();
  return repository.saveRun({
    id: id("assistant-run"),
    threadId: plan.threadId,
    projectRef: plan.projectRef,
    goal: plan.goal,
    mode: plan.risk === "high" ? "high_risk" : plan.promptPreviews.length ? "agent_batch" : plan.risk === "read" ? "read" : "deterministic_write",
    capabilityId: plan.capabilityId,
    status: "waiting_approval",
    planId: plan.id,
    planVersion: 1,
    progress: 0,
    events: [],
    createdAt: now,
    updatedAt: now,
  });
};

export const assistantPlanHash = planHash;
