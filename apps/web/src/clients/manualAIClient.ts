import { testModeEnabled, requireTestMode } from './testMode';
import { hasManualAIResult, normalizeManualAIResult, normalizeManualAIPromptReview, type ManualAIKind, type ManualAIRequest, type ManualAIResult, type ManualAIPromptReview } from "../../../../packages/domain/src/manualAI";

type Input = Omit<ManualAIRequest, "id"> & { previewPrompt?: (review: ManualAIPromptReview) => string };
export interface ManualAIPending extends ManualAIRequest {
  manualOnly: boolean;
  initialResult?: ManualAIResult;
  error?: string;
  previewPrompt?: (review: ManualAIPromptReview) => string;
}
type Answer = { result?: ManualAIResult; review: ManualAIPromptReview };
type Resolution = { value?: string; review: ManualAIPromptReview };
type Pending = { ownerId?: string; view: ManualAIPending; resolve: (answer: Answer) => void; reject: (error: Error) => void };
type Session = { id: string; manual: boolean; review?: boolean; prompt: string; seed?: ManualAIResult; stopped: boolean; requests: Set<string>; network: Set<Promise<unknown>>; serverId?: string; serverPromise?: Promise<string> };
let active: Session | undefined;
const pending: Pending[] = [];
const listeners = new Set<() => void>();
const uploadedResults = new Set<string>();
const uploadedAudio = new Map<string, boolean>();
export const manualAIMediaHasAudio = (url: string) => uploadedAudio.get(url) === true;
export const isManualAIMedia = (url: string) => uploadedResults.has(url);
export const rememberManualAIMedia = (url: string) => { uploadedResults.add(url); };
const changed = () => listeners.forEach((listener) => listener());
export const subscribeManualAI = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getManualAIPending = () => pending[0]?.view;
export const isManualAIExecution = () => active?.manual === true;
export const hasAIExecution = () => Boolean(active);
export const manualAIExecutionSource = () => isManualAIExecution() ? "manual_external" : "api";

const ask = (input: Input, manualOnly: boolean, initialResult?: ManualAIResult, error?: string, ownerId?: string) => new Promise<Answer>((resolve, reject) => {
  pending.push({ ownerId, view: { ...input, id: crypto.randomUUID(), manualOnly, initialResult, error }, resolve, reject });
  changed();
});
export const answerManualAI = (id: string, result?: ManualAIResult, promptReview?: ManualAIPromptReview) => {
  const item = pending.find((candidate) => candidate.view.id === id);
  if (!item) return;
  if (hasManualAIResult(result) || item.view.manualOnly) requireTestMode();
  if (!hasManualAIResult(result) && item.view.manualOnly) throw new Error("本任务使用手动返回，请填写本步结果或取消任务。");
  if (hasManualAIResult(result)) normalizeManualAIResult(item.view, result!);
  const review = normalizeManualAIPromptReview(item.view, promptReview);
  item.view.previewPrompt?.(review);
  pending.splice(pending.indexOf(item), 1);
  item.resolve({ result: hasManualAIResult(result) ? { ...result!, sourcePrompt: review.prompt } : undefined, review });
  changed();
};
export const cancelManualAI = (id: string) => {
  const item = pending.find((candidate) => candidate.view.id === id);
  if (!item) return;
  if (active && active.id === item.ownerId) active.stopped = true;
  for (const entry of [...pending]) if (item.ownerId ? entry.ownerId === item.ownerId : entry === item) { pending.splice(pending.indexOf(entry), 1); entry.reject(new Error("已取消手动 AI 任务，未改用接口。")); }
  changed();
};

const resolveInSession = async (session: Session | undefined, input: Input): Promise<Resolution> => {
  if (session?.stopped) throw new Error("手动 AI 任务已结束，请重新打开提示词窗口。");
  if (session?.manual) requireTestMode();
  const originalReview = { prompt: input.prompt, systemInstruction: input.systemInstruction };
  if (!testModeEnabled() || session && !session.manual && !session.review) return { review: originalReview };
  const seed = session?.seed?.kind === input.kind ? session.seed : undefined;
  // A seed belongs to this exact prompt and is consumed once. Different requests need their own answer.
  if (seed && input.prompt.trim() === session!.prompt.trim()) {
    try {
      const value = normalizeManualAIResult(input, seed);
      if (input.kind !== "text") rememberManualAIMedia(value);
      if (seed.embeddedAudio !== undefined) uploadedAudio.set(value, seed.embeddedAudio);
      session!.seed = undefined;
      return { value, review: originalReview };
    } catch (error) {
      session!.seed = undefined;
      const { result, review } = await ask(input, true, seed, (error as Error).message, session?.id);
      const value = normalizeManualAIResult(input, result!);
      if (input.kind !== "text") rememberManualAIMedia(value);
      if (result?.embeddedAudio !== undefined) uploadedAudio.set(value, result.embeddedAudio);
      return { value, review };
    }
  }
  const { result, review } = await ask(input, session?.manual === true, seed, undefined, session?.id);
  if (!result) return { review };
  if (session) { session.manual = true; if (seed) session.seed = undefined; }
  const value = normalizeManualAIResult(input, result);
  if (input.kind !== "text") rememberManualAIMedia(value);
  if (result.embeddedAudio !== undefined) uploadedAudio.set(value, result.embeddedAudio);
  return { value, review };
};

/** Called before model configuration and credentials are required. */
export const resolveManualAIRequest = async (input: Input, onPromptReviewed?: (review: ManualAIPromptReview) => void): Promise<string | undefined> => {
  if (typeof window === "undefined" && !active) return undefined;
  const resolution = await resolveInSession(active, { ...input, promptEditable: Boolean(onPromptReviewed) });
  onPromptReviewed?.(resolution.review);
  return resolution.value;
};

const responseJson = async (response: Response) => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "手动 AI 会话连接失败。");
  return data;
};

const ensureServerSession = (session: Session) => session.serverPromise ||= (async () => {
  const created = await fetch("/api/manual-ai/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manualOnly: session.manual }) }).then(responseJson);
  session.serverId = created.id;
  void pollSession(session).catch(async () => { if (session.stopped) return; session.stopped = true; await fetch(`/api/manual-ai/sessions/${session.serverId}`, { method: "DELETE" }).catch(() => {}); for (const item of [...pending]) if (item.ownerId === session.id) { pending.splice(pending.indexOf(item), 1); item.reject(new Error("手动 AI 连接中断，请重新提交。")); } changed(); });
  return created.id as string;
})();

const pollSession = async (session: Session) => {
  while (!session.stopped) {
    const state = await fetch(`/api/manual-ai/sessions/${session.serverId}`).then(responseJson);
    if (session.stopped) break;
    for (const request of state.requests as ManualAIRequest[]) {
      if (session.requests.has(request.id)) continue;
      session.requests.add(request.id);
      void (async () => {
        try {
          const { value: text, review } = await resolveInSession(session, request);
          await fetch(`/api/manual-ai/sessions/${session.serverId}/results/${request.id}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(text === undefined ? { useApi: true } : { text }), promptReview: review }),
          }).then(responseJson);
        } catch (error) {
          session.stopped = true;
          await fetch(`/api/manual-ai/sessions/${session.serverId}`, { method: "DELETE" }).catch(() => {});
        }
      })();
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
};

/** Explicit task scope. Concurrent modal submissions cannot consume another task's result. */
export const withManualAIResult = async <T>(prompt: string, result: ManualAIResult | undefined, execute: () => T | Promise<T>, review = false, manualOnly = false): Promise<T> => {
  if (manualOnly || hasManualAIResult(result)) requireTestMode();
  if (active) throw new Error("请先完成或取消正在执行的 AI 任务，再开始下一项。");
  const session: Session = { id: crypto.randomUUID(), prompt: result?.sourcePrompt || prompt, seed: hasManualAIResult(result) ? result : undefined, manual: manualOnly || hasManualAIResult(result), review: review && testModeEnabled(), stopped: false, requests: new Set(), network: new Set() };
  active = session;
  try {
    const value = await execute();
    // Some existing UI actions launch a tracked server job without awaiting its response.
    while (session.network.size) await Promise.allSettled([...session.network]);
    // Server batches may outlive their HTTP acknowledgement; keep their response channel open.
    while (session.serverId && !session.stopped) {
      const state = await fetch(`/api/manual-ai/sessions/${session.serverId}`).then(responseJson);
      if (!state.activeTasks && !state.requests?.length) break;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return value;
  } finally {
    session.stopped = true;
    if (session.serverId) await fetch(`/api/manual-ai/sessions/${session.serverId}`, { method: "DELETE" }).catch(() => {});
    if (active === session) active = undefined;
    for (const item of [...pending]) if (item.ownerId === session.id) { pending.splice(pending.indexOf(item), 1); item.reject(new Error("AI 任务已结束。")); }
    changed();
  }
};

/** Only local API clients carry this capability; never forward it to remote providers. */
export const aiAwareFetch = (input: string, init?: RequestInit): Promise<Response> => {
  const session = active;
  const reviewable = /^\/api\/(?:skills\/(?:ai-draft|recommend)$|brain\/|interactive\/|assistant\/|writing\/(?:revision$|projects\/[^/]+\/agent-jobs\/[^/]+\/run$))/u.test(input);
  if (testModeEnabled() && !session && typeof window !== "undefined" && init?.method === "POST" && reviewable) return withManualAIResult("", undefined, () => aiAwareFetch(input, init), true);
  if (!(session?.manual || session?.review) || !input.startsWith("/api/") || !init?.method || init.method === "GET") return fetch(input, init);
  const request = (async () => {
    if (session.stopped) throw new Error("手动 AI 任务已取消。");
    const id = await ensureServerSession(session);
    const headers = new Headers(init.headers);
    headers.set("X-Manual-AI-Session", id);
    return fetch(input, { ...init, headers });
  })();
  session.network.add(request);
  void request.finally(() => session.network.delete(request)).catch(() => {});
  return request;
};
