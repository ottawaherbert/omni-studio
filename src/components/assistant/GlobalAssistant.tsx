import { ManualAIResultField } from "../ManualAIResultField";
import { withManualAIResult } from "../../../apps/web/src/clients/manualAIClient";
import type { ManualAIResult } from "../../../packages/domain/src/manualAI";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  History,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import type {
  AssistantChangeSet,
  AssistantMessage,
  AssistantPageFocus,
  AssistantPlan,
  AssistantProjectRef,
  AssistantPromptExecutionPreview,
  AssistantRun,
  AssistantRunStatus,
  AssistantThread,
  ProductionPreparationBatchRun,
} from "../../clients/domainTypes";
import { assistantClient } from "../../clients/assistantClient";
import { skillClient } from "../../clients/skillClient";
import { cn } from "../../lib/utils";
import { useProjectStore } from "../../clients/stateClient";
import type { GlobalAssistantCommand } from "./assistantEvents";
import { requestAppNavigation } from "../../utils/navigationGuard";

interface GlobalAssistantProps {
  projectRef?: AssistantProjectRef;
  projectTitle?: string;
  pageFocus: AssistantPageFocus;
  launchRequest?: {
    id: number;
    command?: GlobalAssistantCommand;
  };
}

type SkillOption = { id: string; title: string; content: string };

const terminalRunStatuses: AssistantRunStatus[] = ["completed", "failed", "cancelled", "rolled_back"];
const activeRunStatuses: AssistantRunStatus[] = ["queued", "running", "qa", "repairing", "needs_decision", "ready_to_adopt", "committing"];

const statusCopy: Record<AssistantRunStatus, string> = {
  understanding: "正在理解",
  planning: "正在规划",
  waiting_approval: "等待确认",
  queued: "等待执行",
  running: "生成中",
  qa: "质检中",
  repairing: "自动修改中",
  needs_decision: "需要决定",
  ready_to_adopt: "结果待采用",
  committing: "正在写入",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  rolled_back: "已撤销",
};

const departmentStatusCopy: Record<string, string> = {
  queued: "排队",
  generating: "生成",
  qa: "质检",
  repairing: "修改",
  rechecking: "复检",
  passed: "通过",
  needs_decision: "待决定",
  failed: "失败",
  cancelled: "取消",
  not_required: "无需执行",
};

const focusLabel = (focus: AssistantPageFocus) => {
  const module = focus.module === "production" ? "导演制片" : focus.module === "writing" ? "剧本" : focus.module === "interactive" ? "互动影视" : "全站";
  const detail = focus.shotId ? "当前镜头" : focus.sceneId ? "当前场次" : focus.episodeId ? "当前分集/分段" : "当前页面";
  return `${module} · ${detail}`;
};

const messageText = (message: AssistantMessage) => message.blocks
  .filter((block): block is Extract<AssistantMessage["blocks"][number], { type: "text" }> => block.type === "text")
  .map((block) => block.text)
  .join("\n\n");

const progressFromBatch = (run: AssistantRun, batch?: ProductionPreparationBatchRun) => {
  if (!batch) return run.progress;
  const breakdownTotal = batch.sceneIds.length;
  const breakdownDone = Object.values(batch.breakdownCandidates).filter((item) => item.status === "passed").length;
  const departmentDone = batch.departmentSteps.filter((step) => step.status === "passed").length;
  const total = Math.max(1, breakdownTotal + batch.departmentSteps.length);
  return Math.max(run.progress, Math.round((breakdownDone + departmentDone) / total * 94));
};

const runTone = (status: AssistantRunStatus) => {
  if (status === "completed" || status === "ready_to_adopt") return "text-emerald-500";
  if (status === "needs_decision") return "text-amber-500";
  if (status === "failed" || status === "cancelled") return "text-red-500";
  return "text-gold";
};

type AssistantDecisionItem = {
  id: string;
  department: string;
  text: string;
  suggestion?: string;
};

const decisionItemsFromBatch = (batch?: ProductionPreparationBatchRun): AssistantDecisionItem[] => {
  if (!batch) return [];
  const items: AssistantDecisionItem[] = [];
  const seen = new Set<string>();
  const add = (item: AssistantDecisionItem) => {
    const key = `${item.department}\n${item.text}\n${item.suggestion || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push(item);
    }
  };

  batch.departmentSteps.forEach((step) => {
    const candidate = step.candidate as {
      openQuestions?: unknown[];
      qa?: { issues?: Array<{ severity?: string; description?: string; suggestion?: string }> };
    } | undefined;
    (candidate?.openQuestions || [])
      .filter((question): question is string => typeof question === "string" && Boolean(question.trim()))
      .forEach((question, index) => add({
        id: `${step.id}-question-${index}`,
        department: step.departmentName,
        text: question.trim(),
      }));

    if (step.status !== "needs_decision" && step.status !== "failed") return;
    const stepQa = step.qa as { issues?: Array<{ severity?: string; description?: string; suggestion?: string }> } | undefined;
    const issues = candidate?.qa?.issues || stepQa?.issues || [];
    issues
      .filter((issue) => (issue.severity === "blocking" || issue.severity === "warning") && Boolean(issue.description?.trim()))
      .forEach((issue, index) => add({
        id: `${step.id}-issue-${index}`,
        department: step.departmentName,
        text: issue.description!.trim(),
        suggestion: issue.suggestion?.trim(),
      }));
  });

  (batch.qualityGate?.blockingIssues || []).forEach((issue, index) => add({
    id: `quality-gate-${index}`,
    department: "综合质量门",
    text: issue,
  }));
  return items;
};

export function GlobalAssistant({ projectRef, projectTitle, pageFocus, launchRequest }: GlobalAssistantProps) {
  const navigate = useNavigate();
  const loadProject = useProjectStore((state) => state.loadProject);
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<AssistantThread | null>(null);
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [run, setRun] = useState<AssistantRun | null>(null);
  const [batch, setBatch] = useState<ProductionPreparationBatchRun | undefined>();
  const [changeSet, setChangeSet] = useState<AssistantChangeSet | null>(null);
  const [draft, setDraft] = useState("");
  const [decision, setDecision] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadMenuOpen, setThreadMenuOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skills, setSkills] = useState<SkillOption[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [promptPreviews, setPromptPreviews] = useState<AssistantPromptExecutionPreview[]>([]);
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  useEffect(() => setManualResult(undefined), [plan?.id]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<AssistantThread | null>(null);
  const pendingCommandRef = useRef<GlobalAssistantCommand | null>(null);

  const namespaceKey = projectRef ? `${projectRef.namespace}:${projectRef.projectId}` : "global";
  const selectedSkills = useMemo(
    () => skills.filter((skill) => selectedSkillIds.includes(skill.id)),
    [selectedSkillIds, skills],
  );
  const decisionItems = useMemo(() => decisionItemsFromBatch(batch), [batch]);
  const activePrompt = promptPreviews.find((item) => item.id === activePromptId) || promptPreviews[0];
  const latestEvent = run?.events[run.events.length - 1];
  const runProgress = run ? progressFromBatch(run, batch) : 0;
  const runWroteProject = Boolean(changeSet || run?.output?.changeSetId);
  const activeDepartmentNames = batch?.departmentSteps
    .filter((step) => ["generating", "qa", "repairing", "rechecking"].includes(step.status))
    .map((step) => step.departmentName) || [];
  const liveRunDetail = activeDepartmentNames.length > 1
    ? `${activeDepartmentNames.join("、")}正在并行处理`
    : latestEvent?.detail || latestEvent?.title || (batch ? `${batch.sceneIds.length} 个场次 · ${batch.departmentSteps.length} 个专业部门` : "任务状态已保存");

  const loadMessages = useCallback(async (nextThread: AssistantThread) => {
    const response = await assistantClient.listMessages(nextThread.id);
    setMessages(response.messages);
    const latestPlanId = [...response.messages].reverse().flatMap((message) => message.blocks)
      .find((block): block is Extract<AssistantMessage["blocks"][number], { type: "plan" }> => block.type === "plan")?.planId;
    if (latestPlanId) {
      const planResponse = await assistantClient.getPlan(latestPlanId).catch(() => null);
      if (planResponse?.plan.status === "draft") {
        setPlan(planResponse.plan);
        setPromptPreviews(planResponse.plan.promptPreviews);
        setActivePromptId(planResponse.plan.promptPreviews[0]?.id || null);
      }
    }
    const latestRunId = [...response.messages].reverse().flatMap((message) => message.runIds).find(Boolean);
    if (latestRunId) {
      const runResponse = await assistantClient.getRun(latestRunId).catch(() => null);
      if (runResponse) {
        setRun(runResponse.run);
        setBatch(runResponse.batch);
        const changeSetId = String(runResponse.run.output?.changeSetId || "");
        if (changeSetId) {
          const response = await assistantClient.getChangeSet(changeSetId).catch(() => null);
          if (response) setChangeSet(response.changeSet);
        }
      }
    }
  }, []);

  const ensureThread = useCallback(async () => {
    if (threadRef.current) return threadRef.current;
    const response = await assistantClient.openDefaultThread(projectRef, pageFocus);
    threadRef.current = response.thread;
    setThread(response.thread);
    await loadMessages(response.thread);
    return response.thread;
  }, [loadMessages, pageFocus, projectRef]);

  const refreshThreads = useCallback(async () => {
    const response = await assistantClient.listThreads(projectRef);
    setThreads(response.threads);
  }, [projectRef]);

  useEffect(() => {
    threadRef.current = null;
    setThread(null);
    setThreads([]);
    setMessages([]);
    setPlan(null);
    setRun(null);
    setBatch(undefined);
    setChangeSet(null);
    setSelectedSkillIds([]);
  }, [namespaceKey]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([
      ensureThread(),
      refreshThreads(),
      skillClient.listSkills().then((items) => setSkills(items.map((item) => ({ id: item.id, title: item.title, content: item.content })))).catch(() => undefined),
    ]).finally(() => setLoading(false));
  }, [ensureThread, open, refreshThreads]);

  useEffect(() => {
    if (!open || !run || terminalRunStatuses.includes(run.status)) return;
    const timer = window.setInterval(() => {
      void assistantClient.getRun(run.id).then((response) => {
        setRun(response.run);
        setBatch(response.batch);
      }).catch(() => undefined);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [open, run?.id, run?.status]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open, plan, run?.status, run?.events.length]);

  const send = useCallback(async (command?: GlobalAssistantCommand) => {
    const goal = command?.goal || draft.trim();
    if (!goal || loading) return;
    setLoading(true);
    setDraft("");
    setPlan(null);
    setChangeSet(null);
    try {
      const activeThread = await ensureThread();
      const response = await assistantClient.sendMessage(activeThread.id, {
        goal,
        pageFocus,
        capabilityId: command?.capabilityId,
        input: command?.input,
        selectedSkills,
      });
      setMessages((current) => [...current, response.userMessage, response.assistantMessage]);
      if (response.plan) {
        setPlan(response.plan);
        setPromptPreviews(response.plan.promptPreviews);
        setActivePromptId(response.plan.promptPreviews[0]?.id || null);
      }
      await refreshThreads();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "助手暂时无法处理这项任务");
    } finally {
      setLoading(false);
    }
  }, [draft, ensureThread, loading, pageFocus, refreshThreads, selectedSkills]);

  useEffect(() => {
    if (!launchRequest) return;
    setOpen(true);
    if (launchRequest.command?.goal) pendingCommandRef.current = launchRequest.command;
  }, [launchRequest?.id]);

  useEffect(() => {
    if (!open || !pendingCommandRef.current || loading) return;
    const command = pendingCommandRef.current;
    pendingCommandRef.current = null;
    void send(command);
  }, [launchRequest?.id, loading, open, send]);

  const createThread = async () => {
    setLoading(true);
    try {
      const response = await assistantClient.createThread(projectRef, pageFocus);
      threadRef.current = response.thread;
      setThread(response.thread);
      setMessages([]);
      setPlan(null);
      setRun(null);
      setBatch(undefined);
      setChangeSet(null);
      setThreadMenuOpen(false);
      await refreshThreads();
    } finally {
      setLoading(false);
    }
  };

  const switchThread = async (nextThread: AssistantThread) => {
    setLoading(true);
    try {
      threadRef.current = nextThread;
      setThread(nextThread);
      setPlan(null);
      setRun(null);
      setBatch(undefined);
      setChangeSet(null);
      setThreadMenuOpen(false);
      await loadMessages(nextThread);
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    if (!plan) return;
    setLoading(true);
    try {
      const response = await withManualAIResult(activePrompt?.prompt || "", manualResult, () => assistantClient.approvePlan(plan.id, { promptPreviews, repairLimit: 2 }));
      setPlan(null);
      setRun(response.run);
      setBatch(response.batch);
      setChangeSet(response.changeSet || null);
      setMessages((current) => [...current, {
        id: `local-approved-${response.run.id}`,
        threadId: response.run.threadId,
        projectRef: response.run.projectRef,
        role: "system",
        blocks: [{ type: "system_event", title: "方案已确认", detail: "系统将严格按刚才展示的提示词连续执行生成、质检、自动修改与复检。" }],
        runIds: [response.run.id],
        createdAt: Date.now(),
      }]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "计划确认失败");
    } finally {
      setLoading(false);
    }
  };

  const cancelPlan = async () => {
    if (!plan) return;
    setLoading(true);
    try {
      await assistantClient.cancelPlan(plan.id);
      setPlan(null);
      setPromptPreviews([]);
      setActivePromptId(null);
      if (thread) await loadMessages(thread);
    } finally {
      setLoading(false);
    }
  };

  const cancelRun = async () => {
    if (!run) return;
    const response = await assistantClient.cancelRun(run.id);
    setRun(response.run);
  };

  const resumeRun = async () => {
    if (!run || !decision.trim()) return;
    setLoading(true);
    try {
      const response = await assistantClient.resumeRun(run.id, decision.trim());
      setRun(response.run);
      setBatch(response.batch);
      setDecision("");
    } finally {
      setLoading(false);
    }
  };

  const retryRun = async () => {
    if (!run) return;
    setLoading(true);
    try {
      const response = await assistantClient.resumeRun(run.id, "");
      setRun(response.run);
      setBatch(response.batch);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重试失败");
    } finally {
      setLoading(false);
    }
  };

  const adopt = async () => {
    if (!batch) return;
    setLoading(true);
    try {
      const response = await assistantClient.adoptPreparationBatch(batch.id);
      setBatch(response.batch);
      setChangeSet(response.changeSet);
      const refreshed = run ? await assistantClient.getRun(run.id) : null;
      if (refreshed) setRun(refreshed.run);
      toast.success("整集筹备结果已写入正式项目");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "采用失败");
    } finally {
      setLoading(false);
    }
  };

  const rollback = async () => {
    if (!changeSet) return;
    setLoading(true);
    try {
      const response = await assistantClient.rollbackChangeSet(changeSet.id);
      setChangeSet(response.changeSet);
      if (run) setRun({ ...run, status: "rolled_back", summary: `已撤销：${changeSet.summary}` });
      toast.success("本次写入已撤销");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "撤销失败");
    } finally {
      setLoading(false);
    }
  };

  const openResult = async () => {
    const productionProjectId = String(run?.output?.productionProjectId || "");
    const navigateTo = String(run?.output?.navigateTo || "");
    if (productionProjectId) await loadProject(productionProjectId);
    if (navigateTo) {
      if (!requestAppNavigation()) return;
      navigate(navigateTo);
    }
    setOpen(false);
  };

  const updateActivePrompt = (value: string) => {
    if (!activePrompt) return;
    setPromptPreviews((current) => current.map((item) => item.id === activePrompt.id ? { ...item, prompt: value } : item));
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: 620 }}
            animate={{ x: 0 }}
            exit={{ x: 620 }}
            transition={{ type: "spring", stiffness: 360, damping: 38 }}
            className="fixed inset-y-0 right-0 z-[80] flex h-screen w-[min(620px,calc(100vw-96px))] shrink-0 flex-col border-l border-border-soft/20 bg-bg-primary shadow-2xl min-[1800px]:static min-[1800px]:inset-auto"
            aria-label="全站助手"
          >
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-soft/15 px-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold text-bg-primary">
                  <Bot className="h-[18px] w-[18px]" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-text-primary">{projectTitle || (projectRef ? "当前项目" : "全站助手")}</p>
                  <div className="relative">
                    <button type="button" onClick={() => setThreadMenuOpen((value) => !value)} className="flex max-w-[360px] items-center gap-1 text-[11px] font-semibold text-text-muted hover:text-text-primary">
                      <span className="truncate">{thread?.title || "项目主会话"}</span>
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    </button>
                    {threadMenuOpen && (
                      <div className="absolute left-0 top-6 z-20 w-72 border border-border-soft/20 bg-bg-surface p-1.5 shadow-xl">
                        {threads.map((item) => (
                          <button key={item.id} type="button" onClick={() => void switchThread(item)} className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold hover:bg-bg-surface-soft", item.id === thread?.id && "text-gold")}>
                            <span className="truncate">{item.title}</span>
                            {item.id === thread?.id && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                        <button type="button" onClick={() => void createThread()} className="mt-1 flex w-full items-center gap-2 border-t border-border-soft/15 px-3 py-2.5 text-xs font-bold text-text-primary hover:bg-bg-surface-soft">
                          <MessageSquarePlus className="h-3.5 w-3.5 text-gold" />新建对话
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => void createThread()} title="新建对话" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-bg-surface-soft hover:text-text-primary"><MessageSquarePlus className="h-4 w-4" /></button>
                <button type="button" onClick={() => setOpen(false)} title="关闭助手" className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-bg-surface-soft hover:text-text-primary"><X className="h-4 w-4" /></button>
              </div>
            </header>

            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border-soft/10 px-5 text-[11px]">
              <span className="truncate font-semibold text-text-secondary">{batch ? "导演制片 · 当前分集/分段" : focusLabel(pageFocus)}</span>
              {run && activeRunStatuses.includes(run.status) && <span className={cn("shrink-0 font-bold", runTone(run.status))}>{statusCopy[run.status]}</span>}
            </div>

            <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {!messages.length && !loading && (
                <div className="mx-auto flex min-h-[280px] max-w-md flex-col items-center justify-center text-center">
                  <Sparkles className="mb-4 h-6 w-6 text-gold" />
                  <h2 className="text-lg font-black text-text-primary">告诉我你想完成什么</h2>
                  <p className="mt-2 text-xs leading-5 text-text-muted">我会结合当前项目和页面理解任务。执行前先给你看计划；确认一次后，后台 Agent 会自动完成生成、质检和修改。</p>
                </div>
              )}

              <div className="space-y-4">
                {messages.map((message) => {
                  const text = messageText(message);
                  const event = message.blocks.find((block) => block.type === "system_event");
                  if (!text && !event) return null;
                  if (event && event.type === "system_event") return (
                    <div key={message.id} className="flex items-start gap-2 border-l-2 border-gold/50 py-1 pl-3 text-[11px] leading-5 text-text-muted">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                      <span><strong className="text-text-secondary">{event.title}</strong>{event.detail ? `：${event.detail}` : ""}</span>
                    </div>
                  );
                  return (
                    <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                      <div className={cn("max-w-[88%] whitespace-pre-wrap px-4 py-3 text-xs leading-5", message.role === "user" ? "rounded-lg bg-gold text-bg-primary font-semibold" : "border-l-2 border-border-soft/60 pl-4 text-text-secondary")}>
                        {text}
                      </div>
                    </div>
                  );
                })}
              </div>

              {plan && (
                <section className="mt-5 border-y border-border-soft/15 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-black uppercase text-gold">执行前确认</p>
                      <h3 className="mt-1 text-base font-black text-text-primary">{plan.summary}</h3>
                    </div>
                    <span className="shrink-0 text-[10px] font-bold text-text-muted">提示词确认</span>
                  </div>
                  <ol className="mt-4 space-y-2">
                    {plan.steps.map((step, index) => (
                      <li key={step.id} className="flex items-start gap-3 text-xs leading-5 text-text-secondary">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-surface-soft text-[10px] font-black text-gold">{index + 1}</span>
                        {step.title}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-4 flex items-start gap-2 bg-bg-surface-soft/60 px-3 py-2.5 text-[11px] leading-5 text-text-muted">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    确认后，生成、质检、最多两轮自动修改和复检连续执行。只有剧本歧义、创作方向分歧或多次修正仍未达标时才会暂停。
                  </div>

                  {promptPreviews.length > 0 && (
                    <details className="mt-4 border-t border-border-soft/10 pt-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-text-secondary">
                        <span className="flex items-center gap-2"><Settings2 className="h-3.5 w-3.5" />提示词、Skill 与审计范围</span>
                        <span className="text-[10px] text-text-muted">{promptPreviews.length} 项提示词</span>
                      </summary>
                      <div className="mt-3 grid grid-cols-[190px_minmax(0,1fr)] border border-border-soft/15 bg-bg-surface">
                        <div className="max-h-72 overflow-y-auto border-r border-border-soft/15 p-1.5 custom-scrollbar">
                          {promptPreviews.map((item) => (
                            <button key={item.id} type="button" onClick={() => setActivePromptId(item.id)} className={cn("block w-full px-2.5 py-2 text-left text-[11px] font-semibold hover:bg-bg-surface-soft", item.id === activePrompt?.id ? "bg-bg-surface-soft text-gold" : "text-text-muted")}>
                              {item.title}
                            </button>
                          ))}
                        </div>
                        <div className="min-w-0 p-3">
                          <p className="truncate text-[11px] font-black text-text-primary">{activePrompt?.title}</p>
                          <textarea value={activePrompt?.prompt || ""} onChange={(event) => updateActivePrompt(event.target.value)} className="mt-2 h-56 w-full resize-none border border-border-soft/15 bg-bg-primary p-3 font-mono text-[10px] leading-4 text-text-secondary outline-none focus:border-gold/50" />
                          <p className="mt-2 text-[10px] text-text-muted">上下文来源：{activePrompt?.contextSources.map((source) => source.label).join(" · ") || "无"}</p>
                        </div>
                      </div>
                    </details>
                  )}

                  {activePrompt && <ManualAIResultField prompt={activePrompt.prompt} value={manualResult} onChange={setManualResult} kind="text" disabled={loading} />}
                  <div className="mt-5 flex items-center justify-end gap-2">
                    <button type="button" onClick={() => void cancelPlan()} className="h-9 rounded-lg px-4 text-xs font-bold text-text-muted hover:bg-bg-surface-soft hover:text-text-primary">取消</button>
                    <button type="button" onClick={() => void approve()} disabled={loading} className="btn-primary inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-black disabled:opacity-50">
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}确认并开始
                    </button>
                  </div>
                </section>
              )}

              {run && (
                <section className="mt-5 border-y border-border-soft/15 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className={cn("text-[10px] font-black uppercase", runTone(run.status))}>{statusCopy[run.status]}</p>
                      <h3 className="mt-1 truncate text-base font-black text-text-primary">{run.summary || run.goal}</h3>
                      <p className="mt-1 text-[11px] leading-5 text-text-muted">{run.status === "cancelled"
                        ? "已产生的候选、质检和调用记录仍然保留。"
                        : liveRunDetail}</p>
                    </div>
                    <span className="text-lg font-black text-text-primary">{runProgress}%</span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-surface-soft">
                    <motion.div className="h-full bg-gold" animate={{ width: `${Math.max(2, runProgress)}%` }} />
                  </div>

                  {batch && (
                    <div className="mt-4 space-y-3">
                      <details>
                        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-text-secondary">
                          <span>场次拆解进度</span>
                          <span className="text-[10px] text-text-muted">{Object.values(batch.breakdownCandidates).filter((item) => item.status === "passed").length}/{batch.sceneIds.length} 完成</span>
                        </summary>
                        <div className="mt-3 space-y-2 border-t border-border-soft/10 pt-3">
                          {batch.sceneIds.map((sceneId) => {
                            const state = batch.breakdownCandidates[sceneId]?.status;
                            return (
                              <div key={sceneId} className="flex items-center justify-between gap-3 text-[11px]">
                                <span className="truncate font-semibold text-text-secondary">{batch.sceneLabels?.[sceneId] || sceneId}</span>
                                <span className={cn("shrink-0 font-bold", state === "passed" ? "text-emerald-500" : state === "needs_decision" ? "text-amber-500" : "text-text-muted")}>{state === "passed" ? "拆解完成" : state === "needs_decision" ? "需要决定" : "等待拆解"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </details>
                      <details>
                        <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-text-secondary">
                          <span>专业部门进度</span>
                          <span className="text-[10px] text-text-muted">{batch.departmentSteps.filter((step) => step.status === "passed").length}/{batch.departmentSteps.length} 通过</span>
                        </summary>
                        <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-border-soft/10 pt-3">
                          {batch.departmentSteps.map((step) => (
                            <div key={step.id} className="flex min-w-0 items-center justify-between gap-2 text-[11px]">
                              <span className="truncate font-semibold text-text-secondary">{step.departmentName}</span>
                              <span className={cn("shrink-0 font-bold", step.status === "passed" ? "text-emerald-500" : step.status === "needs_decision" || step.status === "failed" ? "text-amber-500" : "text-text-muted")}>{departmentStatusCopy[step.status]}</span>
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}

                  {batch?.qualityGate && (
                    <details className="mt-4 border-t border-border-soft/10 pt-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-text-secondary">
                        <span className="flex items-center gap-2"><ClipboardCheck className="h-3.5 w-3.5" />综合质量与资产连续性</span>
                        <span className="text-sm font-black text-gold">{batch.qualityGate.score}</span>
                      </summary>
                      <div className="mt-3 space-y-2">
                        {batch.qualityGate.dimensions.map((dimension) => (
                          <div key={dimension.id} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-3 text-[11px]">
                            <div>
                              <div className="flex justify-between"><span className="font-semibold text-text-secondary">{dimension.label}</span><span className="text-text-muted">{dimension.score}</span></div>
                              <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-surface-soft"><div className="h-full bg-emerald-500" style={{ width: `${dimension.score}%` }} /></div>
                            </div>
                            <span className={cn("text-right font-bold", dimension.issues.length ? "text-amber-500" : "text-emerald-500")}>{dimension.issues.length ? `${dimension.issues.length} 项` : "通过"}</span>
                          </div>
                        ))}
                        <p className="pt-2 text-[11px] leading-5 text-text-muted">{batch.qualityGate.assetContinuity.summary}</p>
                      </div>
                    </details>
                  )}

                  {batch && batch.departmentSteps.some((step) => step.candidate) && (
                    <details className="mt-4 border-t border-border-soft/10 pt-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-text-secondary">
                        <span>部门候选结果与质检</span>
                        <span className="text-[10px] text-text-muted">专业审阅</span>
                      </summary>
                      <div className="mt-3 divide-y divide-border-soft/10 border border-border-soft/15">
                        {batch.departmentSteps.filter((step) => step.candidate).map((step) => {
                          const candidate = step.candidate as { taskSummary?: string; content?: string; scenePlans?: Array<{ sceneTitle?: string; summary?: string }>; qa?: { score?: number; summary?: string } };
                          const stepQa = step.qa as { score?: number } | undefined;
                          return (
                            <details key={step.id} className="px-3 py-2.5">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px]">
                                <span className="font-bold text-text-secondary">{step.departmentName}</span>
                                <span className="font-black text-gold">{candidate.qa?.score ?? stepQa?.score ?? "-"}</span>
                              </summary>
                              <div className="mt-3 space-y-3 text-[11px] leading-5 text-text-muted">
                                <p className="font-semibold text-text-secondary">{candidate.taskSummary}</p>
                                <p className="whitespace-pre-wrap">{candidate.content}</p>
                                {candidate.qa?.summary && <p className="border-l-2 border-emerald-500 pl-2">质检：{candidate.qa.summary}</p>}
                                {(candidate.scenePlans || []).map((scenePlan, index) => <p key={`${step.id}-scene-${index}`}><strong className="text-text-secondary">{scenePlan.sceneTitle}</strong> · {scenePlan.summary}</p>)}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {batch && batch.promptExecutions.length > 0 && (
                    <details className="mt-4 border-t border-border-soft/10 pt-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-text-secondary">
                        <span>模型调用与 Prompt 审计</span>
                        <span className="text-[10px] text-text-muted">{batch.promptExecutions.length} 次</span>
                      </summary>
                      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto custom-scrollbar">
                        {batch.promptExecutions.map((execution) => (
                          <details key={execution.id} className="border border-border-soft/15 px-3 py-2">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] font-semibold text-text-secondary">
                              <span className="truncate">{execution.title}</span>
                              <span className={execution.status === "succeeded" ? "text-emerald-500" : execution.status === "failed" ? "text-red-500" : "text-gold"}>{execution.status === "succeeded" ? "成功" : execution.status === "failed" ? "失败" : "运行中"}</span>
                            </summary>
                            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-bg-primary p-2 text-[9px] leading-4 text-text-muted custom-scrollbar">{execution.prompt}</pre>
                            {(execution.modelId || execution.provider) && (
                              <p className="mt-2 text-[9px] leading-4 text-text-muted">
                                {[execution.provider, execution.modelId].filter(Boolean).join(" · ") || "模型信息未返回"}
                              </p>
                            )}
                          </details>
                        ))}
                      </div>
                    </details>
                  )}

                  {run.status === "needs_decision" && (
                    <div className="mt-4 border-l-2 border-amber-500 pl-3">
                      <div className="flex items-start gap-2 text-xs leading-5 text-amber-500"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{batch?.error || run.error || "这里需要你的创作或制作决定，Agent 才能继续。"}</div>
                      {decisionItems.length > 0 && (
                        <div className="mt-3 border-y border-border-soft/15 py-3">
                          <p className="text-[10px] font-black text-text-secondary">待处理事项 · {decisionItems.length}</p>
                          <ol className="mt-2 space-y-2">
                            {decisionItems.map((item) => (
                              <li key={item.id} className="text-[11px] leading-5 text-text-muted">
                                <span className="font-bold text-text-secondary">{item.department}</span>
                                <span> · {item.text}</span>
                                {item.suggestion && <span className="block pl-3 text-text-muted">建议：{item.suggestion}</span>}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <textarea value={decision} onChange={(event) => setDecision(event.target.value)} placeholder="告诉助手你的决定，它会从未通过的步骤继续" className="mt-3 h-20 w-full resize-none border border-border-soft/15 bg-bg-surface p-3 text-xs leading-5 text-text-primary outline-none focus:border-gold/50" />
                      <button type="button" onClick={() => void resumeRun()} disabled={!decision.trim() || loading} className="btn-primary mt-2 inline-flex h-9 items-center gap-2 rounded-lg px-4 text-xs font-black disabled:opacity-50"><ChevronRight className="h-4 w-4" />按决定继续</button>
                    </div>
                  )}

                  {run.status === "failed" && batch && (
                    <div className="mt-4 flex items-start justify-between gap-4 border-l-2 border-red-500 pl-3">
                      <p className="text-xs leading-5 text-red-500">{batch.error || run.error || "任务遇到技术错误，已完成的候选和审计记录仍然保留。"}</p>
                      <button type="button" onClick={() => void retryRun()} disabled={loading} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-black text-text-primary hover:bg-bg-surface-soft disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />重试未完成步骤</button>
                    </div>
                  )}

                  {run.status === "ready_to_adopt" && batch && (
                    <div className="mt-5 flex items-center justify-between gap-4 border-t border-border-soft/10 pt-4">
                      <p className="text-[11px] leading-5 text-text-muted">采用后才会写入正式项目，并生成可撤销记录。</p>
                      <button type="button" onClick={() => void adopt()} disabled={loading} className="btn-primary inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-4 text-xs font-black disabled:opacity-50"><Check className="h-4 w-4" />采用整集结果</button>
                    </div>
                  )}

                  {run.status === "completed" && (
                    <div className="mt-4 flex items-center justify-between gap-4 border-t border-border-soft/10 pt-4">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-500"><Check className="h-4 w-4" />{runWroteProject ? "结果已写入正式项目" : "任务已完成"}</div>
                      <div className="flex items-center gap-1">
                        {run.output?.navigateTo && <button type="button" onClick={() => void openResult()} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-bold text-gold hover:bg-bg-surface-soft">打开结果<ChevronRight className="h-3.5 w-3.5" /></button>}
                        {changeSet?.status === "committed" && <button type="button" onClick={() => void rollback()} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-bold text-text-muted hover:bg-bg-surface-soft hover:text-text-primary"><RotateCcw className="h-3.5 w-3.5" />撤销本次操作</button>}
                      </div>
                    </div>
                  )}

                  {!terminalRunStatuses.includes(run.status) && run.status !== "ready_to_adopt" && run.status !== "needs_decision" && (
                    <div className="mt-4 flex justify-end">
                      <button type="button" onClick={() => void cancelRun()} className="inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-bold text-text-muted hover:bg-bg-surface-soft hover:text-red-500"><Square className="h-3 w-3" />停止任务</button>
                    </div>
                  )}
                </section>
              )}

              {loading && !plan && !run && (
                <div className="flex items-center justify-center gap-2 py-8 text-xs font-semibold text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-gold" />正在理解并准备计划</div>
              )}
            </div>

            <footer className="shrink-0 border-t border-border-soft/15 bg-bg-primary px-5 py-4">
              {selectedSkills.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {selectedSkills.map((skill) => <span key={skill.id} className="bg-bg-surface-soft px-2 py-1 text-[10px] font-bold text-text-secondary">Skill · {skill.title}</span>)}
                </div>
              )}
              <div className="border border-border-soft/20 bg-bg-surface focus-within:border-gold/45">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="描述目标，例如：检查这一集的资产一致性并修正"
                  className="h-20 w-full resize-none bg-transparent px-4 pt-3 text-xs leading-5 text-text-primary outline-none placeholder:text-text-muted"
                />
                <div className="flex h-10 items-center justify-between px-2">
                  <div className="relative flex items-center gap-1">
                    <button type="button" onClick={() => setSkillsOpen((value) => !value)} title="选择 Skill" className={cn("flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold hover:bg-bg-surface-soft", selectedSkillIds.length ? "text-gold" : "text-text-muted")}><Sparkles className="h-3.5 w-3.5" />Skill{selectedSkillIds.length ? ` ${selectedSkillIds.length}` : ""}</button>
                    {skillsOpen && (
                      <div className="absolute bottom-10 left-0 z-20 max-h-72 w-80 overflow-y-auto border border-border-soft/20 bg-bg-surface p-2 shadow-xl custom-scrollbar">
                        <p className="px-2 py-1 text-[10px] font-black uppercase text-text-muted">本次任务使用</p>
                        {skills.map((skill) => (
                          <label key={skill.id} className="flex cursor-pointer items-start gap-2 px-2 py-2 hover:bg-bg-surface-soft">
                            <input type="checkbox" checked={selectedSkillIds.includes(skill.id)} onChange={() => setSelectedSkillIds((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])} className="mt-0.5" />
                            <span className="text-xs font-semibold text-text-secondary">{skill.title}</span>
                          </label>
                        ))}
                        {!skills.length && <p className="px-2 py-3 text-xs text-text-muted">Skill 库暂无可用内容</p>}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => void send()} disabled={!draft.trim() || loading} title="发送" className="flex h-8 w-8 items-center justify-center rounded-lg bg-gold text-bg-primary disabled:opacity-35"><Send className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-text-muted">
                <span>对话按项目隔离，任务关闭面板后继续</span>
                <span className="flex items-center gap-1"><History className="h-3 w-3" />完整记录可追溯</span>
              </div>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
