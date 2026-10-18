import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { normalizeManualAIResult, normalizeManualAIPromptReview, type ManualAIRequest, type ManualAIPromptReview } from "../../packages/domain/src/manualAI";

type RequestEntry = { request: ManualAIRequest; resolve: (text: string | undefined, review: ManualAIPromptReview) => void; reject: (error: Error) => void };
type Session = { id: string; requests: Map<string, RequestEntry>; work: Set<Promise<unknown>>; closed: boolean; manualOnly: boolean; touchedAt: number; timer?: ReturnType<typeof setTimeout> };
const sessions = new Map<string, Session>();
const context = new AsyncLocalStorage<Session>();
export const currentManualAISessionId = () => context.getStore()?.id;
export const trackManualAIWork = <T>(work: Promise<T>): Promise<T> => {
  const session = context.getStore();
  if (session) { session.work.add(work); void work.finally(() => session.work.delete(work)).catch(() => {}); }
  return work;
};
const close = (session: Session) => {
  session.closed = true;
  if (session.timer) clearTimeout(session.timer);
  for (const item of session.requests.values()) item.reject(new Error("手动 AI 会话已关闭，未调用模型接口。"));
  session.requests.clear();
  sessions.delete(session.id);
};

export const requestManualAIText = (input: Omit<ManualAIRequest, "id" | "kind">, onPromptReviewed?: (review: ManualAIPromptReview) => void): Promise<string | undefined> | undefined => {
  const session = context.getStore();
  if (!session) return undefined;
  if (session.closed) return Promise.reject(new Error("手动 AI 会话已结束，不能改用接口。"));
  const request: ManualAIRequest = { ...input, id: randomUUID(), kind: "text", promptEditable: Boolean(onPromptReviewed) };
  return new Promise((resolve, reject) => session.requests.set(request.id, { request, resolve: (text, review) => { onPromptReviewed?.(review); resolve(text); }, reject }));
};

export const registerManualAIRoutes = (app: Express) => {
  app.post("/api/manual-ai/sessions", (req, res) => {
    for (const session of sessions.values()) if (Date.now() - session.touchedAt > 30 * 60_000) close(session);
    const session: Session = { id: randomUUID(), requests: new Map(), work: new Set(), closed: false, manualOnly: req.body?.manualOnly !== false, touchedAt: Date.now() };
    sessions.set(session.id, session);
    session.timer = setTimeout(() => close(session), 30 * 60_000);
    session.timer.unref?.();
    res.status(201).json({ id: session.id });
  });
  app.get("/api/manual-ai/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(410).json({ error: "手动 AI 会话不存在或已结束。" });
    session.touchedAt = Date.now();
    session.timer?.refresh();
    res.json({ requests: [...session.requests.values()].map((item) => item.request), activeTasks: session.work.size });
  });
  app.post("/api/manual-ai/sessions/:id/results/:requestId", (req, res) => {
    const session = sessions.get(req.params.id);
    const entry = session?.requests.get(req.params.requestId);
    if (!session || !entry) return res.status(409).json({ error: "该步骤已处理或已取消，请勿重复提交。" });
    try {
      const review = normalizeManualAIPromptReview(entry.request, req.body?.promptReview);
      if (req.body?.useApi === true) {
        if (session.manualOnly) return res.status(409).json({ error: "本会话使用手动返回，不能改走接口。" });
        entry.resolve(undefined, review); session.requests.delete(entry.request.id); return res.json({ success: true });
      }
      const text = normalizeManualAIResult(entry.request, { kind: "text", text: req.body?.text });
      session.manualOnly = true;
      entry.resolve(text, review);
      session.requests.delete(entry.request.id);
      res.json({ success: true });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.delete("/api/manual-ai/sessions/:id", (req, res) => {
    const session = sessions.get(req.params.id);
    if (session) close(session);
    res.json({ success: true });
  });
  app.use("/api", (req, res, next) => {
    const id = req.get("X-Manual-AI-Session");
    if (!id) return next();
    const session = sessions.get(id);
    if (!session || session.closed) return res.status(410).json({ error: "手动 AI 会话已结束，请重新提交；未调用接口。" });
    // Any overlooked direct proxy path fails closed rather than spending API credits.
    if (req.path.startsWith("/proxy/")) return res.status(409).json({ error: "手动返回任务不能调用模型代理。" });
    context.run(session, next);
  });
};
