import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { skillClient } from "../clients/skillClient";
import { ManualAIResultField } from "./ManualAIResultField";
import { withManualAIResult } from "../../apps/web/src/clients/manualAIClient";
import { hasManualAIResult, type ManualAIResult } from "../../packages/domain/src/manualAI";
import { buildSkillAIDraftPrompt } from "../../packages/domain/src/skillPrompt";
import type { SkillAIDraftDTO } from "../../packages/domain/src/skill";

const field = "w-full rounded-md border border-border-soft bg-bg-primary px-3 py-2 text-sm text-text-primary";
export function SkillDraftAssistant({ content, categoryName, disabled, onApply, onBusyChange, onPendingChange }: {
  content: string; categoryName: string; disabled?: boolean; onApply: (draft: SkillAIDraftDTO) => void;
  onBusyChange: (busy: boolean) => void; onPendingChange: (pending: boolean) => void;
}) {
  const [idea, setIdea] = useState("");
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const [manualResult, setManualResult] = useState<ManualAIResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<SkillAIDraftDTO | null>(null);
  const userIdea = [idea.trim(), content.trim() ? `已有指令，请按要求修改：\n${content.trim()}` : ""].filter(Boolean).join("\n\n");
  const prompt = customPrompt ?? buildSkillAIDraftPrompt({ userIdea, categoryHint: categoryName });
  useEffect(() => { onPendingChange(Boolean(candidate)); }, [candidate, onPendingChange]);
  useEffect(() => { return () => { onPendingChange(false); }; }, [onPendingChange]);
  const generate = async () => {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await withManualAIResult(prompt, manualResult, () => skillClient.draftSkillWithAI({ userIdea, categoryHint: categoryName, prompt }));
      if (!result.content?.trim()) throw new Error("AI 返回的指令为空，请调整要求后重试。");
      setCandidate(result);
    } catch (err) { setError(err instanceof Error ? err.message : "生成失败，原内容已保留"); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <details className="border-t border-border-soft pt-4">
    <summary className="cursor-pointer text-sm font-semibold">AI 帮我起草或修改</summary>
    <div className="mt-4 space-y-3">
      <label className="block text-xs text-text-secondary">希望这个技能解决什么问题？<textarea aria-label="AI 起草要求" className={field + " mt-1 min-h-24"} disabled={disabled || busy} value={idea} placeholder="例如：让镜头画面中的人物位置前后一致；整理声音设计的检查方法。" onChange={e => { setIdea(e.target.value); setCustomPrompt(null); setManualResult(undefined); }} /></label>
      <details className="text-xs text-text-secondary"><summary className="cursor-pointer">查看或调整生成提示词</summary><textarea aria-label="技能生成提示词" className={field + " mt-2 min-h-48"} value={prompt} disabled={disabled || busy} onChange={e => { setCustomPrompt(e.target.value); setManualResult(undefined); }} /><button type="button" className="mt-2 underline" disabled={disabled || busy} onClick={() => setCustomPrompt(null)}>恢复自动提示词</button></details>
      <ManualAIResultField prompt={prompt} value={manualResult} onChange={setManualResult} kind="text" disabled={disabled || busy} />
      <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-border-soft px-3 py-2 text-sm disabled:opacity-40" disabled={disabled || busy || !idea.trim() || Boolean(candidate)} onClick={() => void generate()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{busy ? "生成草稿中…" : hasManualAIResult(manualResult) ? "读取测试返回" : "生成草稿"}</button>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {candidate && <section aria-label="AI 技能草稿" className="space-y-3 border-t border-border-soft pt-3">
        <p className="text-sm font-semibold">检查草稿 · 尚未保存</p>
        <input aria-label="AI 草稿名称" className={field} value={candidate.title} onChange={e => setCandidate({ ...candidate, title: e.target.value })} />
        <textarea aria-label="AI 草稿指令" className={field + " min-h-48"} value={candidate.content} onChange={e => setCandidate({ ...candidate, content: e.target.value })} />
        <p className="text-xs text-text-secondary">建议分类：{candidate.categoryName || "未分类"}。已有同名分类会被选中；新分类可在技能库中管理。</p>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={!candidate.title.trim() || !candidate.content.trim()} className="rounded-lg btn-primary px-3 py-2 text-sm disabled:opacity-40" onClick={() => { onApply(candidate); setCandidate(null); }}>采用到编辑区</button><button type="button" className="text-sm text-text-secondary" onClick={() => setCandidate(null)}>放弃草稿</button></div>
      </section>}
    </div>
  </details>;
}
