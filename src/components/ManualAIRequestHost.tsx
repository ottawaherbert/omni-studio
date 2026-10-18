import { useSettingsStore } from '../clients/stateClient';
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { answerManualAI, cancelManualAI, getManualAIPending, subscribeManualAI, type ManualAIPending } from "../../apps/web/src/clients/manualAIClient";
import { hasManualAIResult, manualAIPromptText, type ManualAIResult } from "../../packages/domain/src/manualAI";
import { ManualAIResultField } from "./ManualAIResultField";

export default function ManualAIRequestHost() {
  const isTestMode = useSettingsStore(state => state.isTestMode);
  const request = useSyncExternalStore(subscribeManualAI, getManualAIPending, () => undefined);
  useEffect(() => { if (!isTestMode && request) cancelManualAI(request.id); }, [isTestMode, request?.id]);
  if (!isTestMode || !request || typeof document === "undefined") return null;
  return createPortal(<ManualAIRequestForm key={request.id} request={request} />, document.body);
}

function ManualAIRequestForm({ request }: { request: ManualAIPending }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelManualAI(request.id);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [request.id]);
  const [result, setResult] = useState<ManualAIResult | undefined>(request.initialResult);
  const [error, setError] = useState(request.error || "");
  const [uploading, setUploading] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState(request.prompt);
  const [systemInstruction, setSystemInstruction] = useState(request.systemInstruction || "");
  const promptReview = { prompt: taskPrompt, systemInstruction };
  let prompt = manualAIPromptText({ ...request, ...promptReview });
  let previewError = "";
  if (request.previewPrompt) {
    try { prompt = request.previewPrompt(promptReview); }
    catch (error) { previewError = (error as Error).message; }
  }
  const contract = manualAIPromptText({ ...request, prompt: "", systemInstruction: "", context: "" });
  return (<div className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/60 p-5">
    <section role="dialog" aria-modal="true" aria-label="AI 请求与手动返回" className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-text-primary shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-neutral-800"><div><h2 className="font-semibold">{request.manualOnly ? "填写这一步的 AI 返回" : "AI 请求与手动返回"}</h2><p className="mt-1 text-xs text-text-muted">{request.manualOnly ? "本任务使用手动结果。后续生成、质检和修复也会在这里逐次等待返回。" : "复制提示词到你使用的 AI，填入回答或上传结果；留空则使用已配置的接口。"}</p></div><button type="button" aria-label="关闭并取消 AI 任务" title="关闭并取消 AI 任务" onClick={() => cancelManualAI(request.id)} className="shrink-0 rounded p-1 text-text-muted hover:bg-black/5 dark:hover:bg-white/10"><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 overflow-y-auto px-5 py-3">
        {request.context && <pre className="mb-3 whitespace-pre-wrap text-xs text-text-muted">{request.context}</pre>}
        {(request.systemInstruction || request.promptEditable) && <details open={Boolean(request.systemInstruction)} className="mb-3 text-xs text-text-muted"><summary className="cursor-pointer py-1">系统要求（可选）</summary><textarea aria-label="本步系统要求" readOnly={!request.promptEditable} value={systemInstruction} onChange={event => setSystemInstruction(event.target.value)} className="mt-1 h-24 w-full resize-y rounded border border-gray-200 bg-transparent p-2 font-mono text-xs leading-6 text-text-primary dark:border-neutral-700" /></details>}
        <label className="block text-xs text-text-muted">本步提示词{request.promptEditable ? "（修改后用于本次生成与记录）" : ""}<textarea aria-label="本步完整提示词" readOnly={!request.promptEditable} value={taskPrompt} onChange={event => setTaskPrompt(event.target.value)} className="mt-1 h-[28vh] w-full resize-y bg-transparent font-mono text-xs leading-6 text-text-primary outline-none" /></label>
        {contract && <details className="py-2 text-xs text-text-muted"><summary>返回结构与参考要求（复制时包含）</summary><pre className="mt-2 whitespace-pre-wrap font-mono">{contract}</pre></details>}
        {request.previewPrompt && <details className="py-2 text-xs text-text-muted"><summary>完整请求预览（含生成约束）</summary><pre className="mt-2 whitespace-pre-wrap font-mono">{prompt}</pre></details>}
        {!!request.references?.length && <div className="flex flex-wrap gap-3 py-2">{request.references.map((reference, index) => <a key={index} href={reference.url} target="_blank" rel="noreferrer" className="text-xs underline">{reference.label}</a>)}</div>}
      </div>
      <ManualAIResultField key={request.id} prompt={prompt} sourcePrompt={taskPrompt} value={result} onChange={setResult} kind={request.kind} manualOnly={request.manualOnly} onBusyChange={setUploading} />
      {error && <p role="alert" className="px-5 py-2 text-sm text-red-600">{error}</p>}
      {previewError && <p role="alert" className="px-5 py-2 text-sm text-red-600">{previewError}</p>}
      <footer className="flex shrink-0 justify-end gap-3 border-t border-gray-200 p-4 dark:border-neutral-800">
        <button type="button" onClick={() => cancelManualAI(request.id)} className="px-4 py-2 text-sm">取消任务</button>
        <button type="button" disabled={uploading || Boolean(previewError) || !taskPrompt.trim() || (request.manualOnly && !hasManualAIResult(result))} onClick={() => { try { answerManualAI(request.id, result, promptReview); } catch (error) { setError((error as Error).message); } }} className="rounded-md bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40">{hasManualAIResult(result) ? "确认使用此返回" : request.manualOnly ? "填写结果后继续" : "调用接口生成"}</button>
      </footer>
    </section>
  </div>);
}
