import { SKILL_PURPOSE_LABELS, SKILL_TASK_LABELS } from "../clients/skillMetadataClient";
import { useEffect, useMemo, useState } from "react";
import { Copy, FolderCog, Loader2, Pencil, Plus, Search, Trash2, Wand2 } from "lucide-react";
import toast from "react-hot-toast";
import { useSkillStore } from "../clients/stateClient";
import type { SkillDTO } from "../clients/domainTypes";
import { snapshotCreativeSkill } from "../clients/creativeDirectionClient";
import { CreativeSkillComposer } from "../components/production/CreativeSkillComposer";
import { DirectorUsagePreview } from "../components/production/DirectorUsagePreview";
import { SkillCategoryManager } from "../components/SkillCategoryManager";
import { Modal } from "../components/ui/Modal";

const control = "min-w-0 rounded-lg border border-border-soft bg-bg-surface px-3 py-2.5 text-sm text-text-primary";
const kindLabel = (skill: SkillDTO) => skill.kind === "director" ? "制作导演方法" : "通用指令";

export default function SkillLibrary() {
  const { skills, categories, isLoading, error, fetchSkills, deleteSkill } = useSkillStore();
  const [purpose, setPurpose] = useState("all");
  const [taskScope, setTaskScope] = useState("all");
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<SkillDTO | null>(null);
  const [composer, setComposer] = useState<{ kind: "general" | "director"; initial?: SkillDTO; initialCategoryId?: string } | null>(null);
  const [manageCategories, setManageCategories] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { void fetchSkills(true); }, [fetchSkills]);
  useEffect(() => {
    const refresh = () => { void fetchSkills(true); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [fetchSkills]);
  const categoryNames = useMemo(() => new Map(categories.map(item => [item.id, item.name])), [categories]);
  const available = skills.filter(skill => skill.kind !== "visual_style");
  const filtered = available.filter(skill =>
    (purpose === "all" || (purpose === "unmarked" ? !skill.purposes?.length : skill.purposes?.includes(purpose)))
    && (taskScope === "all" || (taskScope === "unmarked" ? !skill.applicability?.tasks?.length : skill.applicability?.tasks?.includes(taskScope)))
    && (kind === "all" || (skill.kind || "general") === kind)
    && (category === "all" || (category === "uncategorized" ? !categoryNames.has(skill.categoryId || "") : skill.categoryId === category))
    && `${skill.title}\n${skill.content}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ).sort((a, b) => b.updatedAt - a.updatedAt);
  const reset = () => { setPurpose("all"); setTaskScope("all"); setKind("all"); setCategory("all"); setQuery(""); };
  const remove = async (skill: SkillDTO) => {
    if (!window.confirm(`删除「${skill.title}」？已有任务和作品中保存的 Skill 快照会保留。`)) return;
    setDeleting(true);
    try { await deleteSkill(skill.id); setPreview(null); toast.success("技能已删除"); }
    catch (err) { toast.error(err instanceof Error ? err.message : "删除失败，请重试"); }
    finally { setDeleting(false); }
  };
  const copy = async (skill: SkillDTO) => {
    try { await navigator.clipboard.writeText(skill.content); toast.success("技能指令已复制"); }
    catch { toast.error("复制失败，请选中正文手动复制"); }
  };

  return <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 text-text-primary sm:px-8 sm:py-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <h1 className="text-2xl font-bold">技能库</h1>
        <p className="max-w-2xl text-sm leading-6 text-text-secondary">集中管理可复用的创作方法，在写作、制作、互动和拉片等任务中按需选用。</p>
      </div>
      <button className="inline-flex shrink-0 items-center gap-2 rounded-lg btn-primary px-4 py-2.5 text-sm font-semibold" onClick={() => setComposer({ kind: "general", initialCategoryId: categoryNames.has(category) ? category : undefined })}><Plus className="h-4 w-4" />新建技能</button>
    </header>

    <section aria-label="筛选技能" className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_160px_180px_auto]">
        <label className="col-span-3 min-w-0 space-y-1.5 text-xs text-text-secondary sm:col-span-1"><span>搜索</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-text-muted" /><input aria-label="搜索技能" placeholder="搜索名称或指令内容" className={control + " w-full pl-9"} value={query} onChange={e => setQuery(e.target.value)} /></div></label>
        <label className="min-w-0 space-y-1.5 text-xs text-text-secondary"><span>类型</span><select aria-label="筛选技能类型" className={control + " w-full"} value={kind} onChange={e => setKind(e.target.value)}><option value="all">全部类型</option><option value="general">通用指令</option><option value="director">制作导演方法</option></select></label>
        <label className="min-w-0 space-y-1.5 text-xs text-text-secondary"><span>分类</span><select aria-label="筛选技能分类" className={control + " w-full"} value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部分类</option><option value="uncategorized">未分类</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button aria-label="管理分类" title="管理分类" className={control + " justify-self-start hover:bg-bg-surface-hover"} onClick={() => setManageCategories(true)}><FolderCog className="h-5 w-5" /></button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-text-secondary">用途<select aria-label="筛选技能用途" className={control + " ml-2"} value={purpose} onChange={e => setPurpose(e.target.value)}><option value="all">全部用途</option><option value="unmarked">未标注用途</option>{[...new Set([...Object.keys(SKILL_PURPOSE_LABELS), ...available.flatMap(skill => skill.purposes || [])])].map(value => <option key={value} value={value}>{SKILL_PURPOSE_LABELS[value] || value}</option>)}</select></label>
        <label className="text-xs text-text-secondary">适用任务<select aria-label="筛选技能适用任务" className={control + " ml-2"} value={taskScope} onChange={e => setTaskScope(e.target.value)}><option value="all">全部任务</option><option value="unmarked">未限定任务</option>{[...new Set([...Object.keys(SKILL_TASK_LABELS), ...available.flatMap(skill => skill.applicability?.tasks || [])])].map(value => <option key={value} value={value}>{SKILL_TASK_LABELS[value] || value}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary"><span aria-live="polite">{filtered.length} / {available.length} 个技能 · 最近更新优先</span>{(purpose !== "all" || taskScope !== "all" || kind !== "all" || category !== "all" || query) && <button onClick={reset} className="underline underline-offset-4">清除筛选</button>}</div>
    </section>

    {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-red-400/40 p-3 text-sm text-red-500"><span>{error}</span><button className="underline" onClick={() => void fetchSkills(true)}>重试</button></div>}
    {isLoading && !available.length ? <p role="status" className="flex items-center gap-2 py-12 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" />正在加载技能…</p> : filtered.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {filtered.map(skill => <button key={skill.id} aria-label={`查看技能：${skill.title}`} onClick={() => setPreview(skill)} className="group flex min-w-0 flex-col gap-3 rounded-lg border border-border-soft bg-bg-surface p-5 text-left transition-colors hover:border-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
        <div className="flex w-full items-start justify-between gap-3"><h2 className="break-words text-base font-semibold">{skill.title}</h2><Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" /></div>
        <p className="text-xs text-text-secondary">{kindLabel(skill)} · {categoryNames.get(skill.categoryId || "") || "未分类"}</p>
        <p className="text-xs text-text-muted">用途：{skill.purposes?.map(value => SKILL_PURPOSE_LABELS[value] || value).join('、') || '未标注'} · 任务：{skill.applicability?.tasks?.map(value => SKILL_TASK_LABELS[value] || value).join('、') || '未限定'}</p>
        <p className="line-clamp-3 break-words text-sm leading-6 text-text-secondary">{skill.content}</p>
        <p className="mt-auto pt-1 text-xs text-text-muted">{skill.source === "ai" ? "AI 辅助创建" : "人工创建"}{skill.builtin ? " · 内置" : ""}</p>
      </button>)}
    </div> : !error && <div className="py-16 text-center text-sm text-text-secondary"><p>{available.length ? "没有符合条件的技能" : "还没有技能，可以手动编写或让 AI 起草。"}</p>{available.length > 0 && <button className="mt-3 underline" onClick={reset}>清除筛选</button>}</div>}

    {preview && <Modal isOpen onClose={() => { if (!deleting) setPreview(null); }} title={preview.title} size="xl" footer={<div className="flex w-full flex-wrap items-center justify-between gap-3">
      <button aria-label="删除技能" title={preview.builtin ? "内置技能不能删除" : "删除技能"} disabled={deleting || preview.builtin} onClick={() => void remove(preview)} className="rounded-lg p-2 text-text-muted hover:text-red-500 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
      <div className="flex flex-wrap gap-2"><button className={control + " inline-flex items-center gap-2"} onClick={() => void copy(preview)}><Copy className="h-4 w-4" />复制指令</button><button disabled={deleting} className="inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm" onClick={() => { setComposer({ kind: preview.kind === "director" ? "director" : "general", initial: preview }); setPreview(null); }}><Pencil className="h-4 w-4" />{preview.builtin ? "创建副本" : "编辑技能"}</button></div>
    </div>}>
      <div className="space-y-5"><p className="text-sm text-text-secondary">{kindLabel(preview)} · {categoryNames.get(preview.categoryId || "") || "未分类"} · {preview.source === "ai" ? "AI 辅助创建" : "人工创建"}</p>
        <p className="text-sm leading-6 text-text-secondary">{preview.kind === "director" ? "在制作页面选用，按任务提供表演、摄影、美术、声音等指导。" : "在各模块的 AI 任务中选用，作为本次任务的补充要求。"}</p>
        <div className="whitespace-pre-wrap break-words text-sm leading-7">{preview.content}</div>
        {preview.kind === "director" && <DirectorUsagePreview role={{ enabled: true, skill: snapshotCreativeSkill(preview), notes: [], source: "技能库" }} />}
      </div>
    </Modal>}
    {composer && <CreativeSkillComposer {...composer} onClose={() => setComposer(null)} onSaved={() => { setComposer(null); reset(); toast.success("已保存到技能库，可在相应任务中选用"); }} />}
    {manageCategories && <SkillCategoryManager onClose={() => { setManageCategories(false); setCategory("all"); }} />}
  </main>;
}
