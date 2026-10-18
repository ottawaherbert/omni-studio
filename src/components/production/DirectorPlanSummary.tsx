import { useState } from "react";
import { Modal } from "../ui/Modal";
import type { SceneDirectorPlan, Shot } from "../../clients/domainTypes";

export function DirectorPlanSummary({ plan, shots, status, candidate = false, onRedesign, onChange, disabled = false }: {
  plan?: SceneDirectorPlan; shots: Shot[]; status?: string; candidate?: boolean; onRedesign?: () => void; onChange?: (plan: SceneDirectorPlan) => void | Promise<void>; disabled?: boolean;
}) {
  const [draft, setDraft] = useState<SceneDirectorPlan>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  if (!plan && !shots.length) return null;
  const shotNumber = (id: string) => { const index = shots.findIndex(shot => shot.id === id); return index < 0 ? "已移除" : String(index + 1); };
  return <section className="my-3 min-w-0 border-b border-border-soft/30 pb-3 text-xs" aria-label="本场导演方案">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-semibold text-text-primary">本场拍法{plan ? ` · ${plan.skillTitle}${plan.skillRevision ? ` v${plan.skillRevision}` : ""}` : " · 当前镜头"}{candidate ? " · 候选" : ""}</span>
      <div className="flex flex-wrap gap-3">{plan && onChange && <button type="button" className="text-gold hover:underline" disabled={disabled} onClick={() => { setDraft(structuredClone(plan)); setError(""); }}>编辑本场方案</button>}{onRedesign && <button type="button" disabled={disabled} onClick={onRedesign} className="text-gold hover:underline disabled:opacity-50">重新设计本场</button>}</div>
    </div>
    {status === "director_changed" && <p className="mt-2 leading-5 text-amber-600 dark:text-amber-400">导演选择已更新，现有镜头继续采用原拍法。重新设计并采用候选后使用新导演。</p>}
    {status === "source_changed" && <p className="mt-2 leading-5 text-amber-600 dark:text-amber-400">剧本、形象或画风依据有变化，请核对本场拍法。</p>}
    {plan ? <details className="mt-2" open={candidate}>
      <summary className="cursor-pointer text-text-secondary">查看观看重点、节奏与镜头落点</summary>
      <div className="mt-2 space-y-3 break-words leading-5 text-text-secondary">
        <p>{plan.intent}</p>
        {plan.rhythm && <p><span className="font-semibold">节奏与承接：</span>{plan.rhythm}</p>}
        {plan.applications.map((item, index) => <div key={index}>
          <p className="font-semibold text-text-primary">{item.method}</p>
          <p>{item.decision}</p>
          <p className="text-text-muted">镜头 {item.shotIds.map(shotNumber).join("、")} · 原文依据：{item.evidence || "待核对"}</p>
        </div>)}
        {plan.exceptions.length > 0 && <p>取舍：{plan.exceptions.join("；")}</p>}
        {shots.filter(shot => shot.directing?.dialogue.length || shot.directing?.soundCues.length).map(shot => <div key={shot.id}>
          <p className="font-semibold">镜头 {shotNumber(shot.id)} · 台词与声音</p>
          {shot.directing?.dialogue.map(line => <p key={line.lineIndex}>第 {line.lineIndex + 1} 句：{line.instruction || "沿用当前表演"}{line.startSeconds !== undefined ? `；相对本镜 ${line.startSeconds} 秒进入` : ""}</p>)}
          {shot.directing?.soundCues.map(cue => <p key={cue.id}>{cue.type === "bgm" ? "音乐" : "音效"}：{cue.description}；相对本镜 {cue.startSeconds} 秒进入，持续 {cue.durationSeconds} 秒</p>)}
        </div>)}
        <p className="text-text-muted">方案说明拍摄意图。声音事件随分镜排入待制作音轨；画面、声音和剪辑效果以实际素材为准。</p>
      </div>
    </details> : <p className="mt-2 leading-5 text-text-muted">现有镜头可直接编辑和继续制作，不需要选择导演 Skill。</p>}
    {draft && <Modal isOpen title="编辑本场方案" size="lg" onClose={() => { if (!saving) setDraft(undefined); }} closeOnBackdrop={false} footer={<div className="flex gap-3"><button disabled={saving} onClick={() => setDraft(undefined)}>取消</button><button className="rounded-md bg-gold px-3 py-2 font-bold text-black disabled:opacity-50" disabled={saving || !draft.intent.trim()} onClick={async () => { setSaving(true); try { await onChange?.(draft); setDraft(undefined); } catch (e) { setError(String(e)); } finally { setSaving(false); } }}>保存方案</button></div>}>
      <div className="space-y-3 text-xs text-text-secondary">
        <p>这里修改本场表达意图和方法取舍；具体拍法请在各镜头中编辑。已有素材保留。</p>
        <label className="block">观看重点<textarea className="mt-1 min-h-20 w-full rounded-md border border-border-soft bg-bg-primary p-2" value={draft.intent} onChange={e => setDraft({ ...draft, intent: e.target.value })} /></label>
        <label className="block">节奏与承接<textarea className="mt-1 min-h-20 w-full rounded-md border border-border-soft bg-bg-primary p-2" value={draft.rhythm} onChange={e => setDraft({ ...draft, rhythm: e.target.value })} /></label>
        {draft.applications.map((item, index) => <label key={index} className="block">{item.method}<textarea aria-label={`方法 ${index + 1} 的本场拍法`} className="mt-1 min-h-20 w-full rounded-md border border-border-soft bg-bg-primary p-2" value={item.decision} onChange={e => setDraft({ ...draft, applications: draft.applications.map((entry, i) => i === index ? { ...entry, decision: e.target.value } : entry) })} /></label>)}
        <label className="block">例外与取舍（一行一条）<textarea className="mt-1 min-h-20 w-full rounded-md border border-border-soft bg-bg-primary p-2" value={draft.exceptions.join("\n")} onChange={e => setDraft({ ...draft, exceptions: e.target.value.split("\n") })} /></label>
        {error && <p role="alert" className="text-red-500">{error}</p>}
      </div>
    </Modal>}
  </section>;
}
