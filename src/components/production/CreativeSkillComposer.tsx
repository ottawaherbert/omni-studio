import { SKILL_PURPOSE_LABELS, SKILL_TASK_LABELS, SKILL_FORMAT_LABELS } from "../../clients/skillMetadataClient";
import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, Wand2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { skillClient } from "../../clients/skillClient";
import { generateAIContent } from "../../clients/aiClient";
import { useSkillStore } from "../../clients/stateClient";
import { buildCreativeSkillDraftPrompt, creativeSkillDraftTitle, directorProfileText, emptyDirectorProfile, isDirectorProfileV2, parseDirectorProfile, validateDirectorProfile, directorFields, directorFieldValues, setDirectorField } from "../../clients/creativeDirectionClient";
import type { DirectorProfileV2 } from "../../clients/creativeDirectionClient";
import type { SkillDTO, SkillReferenceWork } from "../../clients/domainTypes";
import { SkillDraftAssistant } from "../SkillDraftAssistant";
import { useSettingsStore } from "../../clients/stateClient";
import { DirectorMethodsEditor } from "./DirectorMethodsEditor";

const fieldClass = "w-full rounded-md border border-border-soft bg-bg-primary px-3 py-2 text-sm text-text-primary";
const cleanLines = (lines: string[]) => lines.map(line => line.trim()).filter(Boolean);
function cleanProfile(value: DirectorProfileV2): DirectorProfileV2 {
  return { ...value, principles: cleanLines(value.principles), unclassified: value.unclassified ? cleanLines(value.unclassified) : undefined,
    methods: value.methods.map(method => ({ ...method, title: method.title.trim(), when: method.when.trim(), purpose: method.purpose.trim(), exceptions: cleanLines(method.exceptions), checks: cleanLines(method.checks),
      directions: directorFields.reduce((directions, path) => setDirectorField(directions, path, cleanLines(directorFieldValues(method.directions, path))), {}) })) };
}
const referenceKey = (work: SkillReferenceWork) => JSON.stringify([work.title.trim(), work.version?.trim() || "", work.director?.trim() || "", work.focus?.trim() || ""]);
export function CreativeSkillComposer({ kind: initialKind, initial, initialCategoryId, onClose, onSaved }: {
  kind: "director" | "general"; initial?: SkillDTO; initialCategoryId?: string; onClose: () => void; onSaved: (skill: SkillDTO) => void;
}) {
  const [kind, setKind] = useState<"director" | "general">(initial?.kind === "director" ? "director" : initialKind);
  const [title, setTitle] = useState(initial?.title || "");
  const [referenceWork, setReferenceWork] = useState<SkillReferenceWork>(initial?.referenceWork || { title: "" });
  const [purposes, setPurposes] = useState(initial?.purposes || []);
  const [applicability, setApplicability] = useState(initial?.applicability || {});
  const [content, setContent] = useState(initial?.content || "");
  const [analysisNotes, setAnalysisNotes] = useState(initial?.analysisNotes || "");
  const [analysisReference, setAnalysisReference] = useState(referenceKey(initial?.referenceWork || { title: "" }));
  const [analysisBasis, setAnalysisBasis] = useState<SkillDTO["analysisBasis"]>(initial?.analysisBasis || "author");
  const [draftSource, setDraftSource] = useState<SkillDTO["source"]>(initial?.source || "manual");
  const [profile, setProfile] = useState<DirectorProfileV2>(() => isDirectorProfileV2(initial?.profile?.director) ? structuredClone(initial.profile.director) : emptyDirectorProfile());
  const [acceptedReference, setAcceptedReference] = useState(referenceKey(initial?.referenceWork || { title: "" }));
  const [candidate, setCandidate] = useState<{ profile: DirectorProfileV2; reference: string }>();
  const [manualJson, setManualJson] = useState("");
  const [promptPreview, setPromptPreview] = useState("");
  const categories = useSkillStore(state => state.categories);
  const [categoryId, setCategoryId] = useState(initial?.categoryId || initialCategoryId || "");
  const [busy, setBusy] = useState("");
  const isTestMode = useSettingsStore(state => state.isTestMode);
  const [generalPending, setGeneralPending] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const legacy = kind === "director" && !!initial && !isDirectorProfileV2(initial.profile?.director);
  const referenceChanged = Boolean(profile.methods.length || initial?.referenceWork?.title.trim()) && acceptedReference !== referenceKey(referenceWork);
  const activeAnalysisNotes = analysisReference === referenceKey(referenceWork) ? analysisNotes : "";
  const formSnapshot = JSON.stringify({ purposes, applicability, kind, title, categoryId, content, referenceWork, profile, analysisNotes, candidate, generalPending });
  const originalSnapshot = useRef(formSnapshot);
  const close = () => {
    if (busy) return;
    if (formSnapshot !== originalSnapshot.current && !window.confirm("放弃尚未保存的技能修改？")) return;
    mounted.current = false; onClose();
  };
  const prompt = () => buildCreativeSkillDraftPrompt({ kind, content: referenceChanged ? "" : kind === "director" && profile.methods.length ? directorProfileText(cleanProfile(profile)) : content, referenceWork: referenceWork.title.trim() ? referenceWork : undefined, references: [], analysisNotes: activeAnalysisNotes });
  const acceptCandidate = () => {
    if (!candidate) return;
    setProfile(candidate.profile); setAcceptedReference(candidate.reference); setCandidate(undefined);
    setTitle(current => current.trim() || creativeSkillDraftTitle(kind, referenceWork));
    setDraftSource("ai"); setError("");
    setAnalysisBasis(activeAnalysisNotes.trim() ? "provided_analysis" : referenceWork.title.trim() ? "work_knowledge" : "author");
  };
  const receive = (raw: string) => {
    const next = parseDirectorProfile(raw);
    setCandidate({ profile: { ...next, ...(legacy ? { legacySource: [initial!.content, initial?.profile?.director ? JSON.stringify(initial.profile.director, null, 2) : ""].filter(Boolean).join("\n\n") } : profile.legacySource ? { legacySource: profile.legacySource } : {}) }, reference: referenceKey(referenceWork) });
  };
  const draft = async () => {
    setBusy("生成候选中"); setError("");
    try {
      const request = prompt(); setPromptPreview(request);
      const raw = await generateAIContent({ prompt: request, requireJson: true, taskType: "scriptGen" });
      if (!mounted.current) return;
      setManualJson(raw); receive(raw);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };
  const save = async () => {
    if (busy) return;
    setError("");
    if (!title.trim()) { setError("请填写技能名称。"); return; }
    if (candidate || generalPending) { setError("请先采用或放弃下方候选，再保存当前方法。"); return; }
    if (kind === "director" && referenceChanged) { setError("参考作品已修改，请重新生成并采用方法，或恢复原参考信息。"); return; }
    setBusy("保存中");
    try {
      const director = kind === "director" && (!legacy || profile.methods.length > 0) ? cleanProfile(profile) : undefined;
      if (director) validateDirectorProfile(director);
      const text = director ? directorProfileText(director) : content.trim();
      if (!text) throw new Error("请先填写规则。");
      const payload: Partial<SkillDTO> = { purposes, applicability, title: title.trim() || creativeSkillDraftTitle(kind, referenceWork), content: text, kind, categoryId: categoryId || "", analysisNotes: activeAnalysisNotes, analysisBasis, profile: director ? { director } : legacy && content === initial?.content ? initial?.profile || {} : {}, references: initial?.references || [], referenceWork: kind === "director" && referenceWork.title.trim() ? { ...referenceWork, title: referenceWork.title.trim() } : null, source: draftSource };
      const saved = initial && !initial.builtin ? await skillClient.updateSkill(initial.id, payload) : await skillClient.createSkill(payload);
      useSkillStore.setState(state => ({ skills: [...state.skills.filter(skill => skill.id !== saved.id), saved] }));
      onSaved(saved);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); } catch { setError("复制失败，请从下方文本中手动复制。"); } };
  return <Modal isOpen onClose={close} title={initial?.builtin ? "创建技能副本" : initial ? "编辑技能" : "新建技能"} size="xl" closeOnBackdrop={false}
    footer={<div className="w-full space-y-2">{error && <p role="alert" className="text-sm text-red-500">{error}</p>}<div className="flex w-full flex-wrap items-center justify-between gap-3"><span className="text-xs text-text-muted">{candidate ? "先采用候选，再保存到 Skill 库。" : kind === "director" ? "保存后可在项目中选择；不选也能正常制片。" : "保存可复用的创作要求"}</span><div className="flex gap-2">{candidate ? <><button className="px-3 py-2 text-sm" onClick={() => setCandidate(undefined)} disabled={!!busy}>放弃候选</button><button className="rounded-md bg-gold px-4 py-2 text-sm font-bold text-black" onClick={() => { try { validateDirectorProfile(cleanProfile(candidate.profile)); acceptCandidate(); } catch (e) { setError(String(e)); } }}>采用这份方法</button></> : <><button className="px-3 py-2 text-sm" onClick={close} disabled={!!busy}>取消</button><button className="rounded-md bg-gold px-4 py-2 text-sm font-bold text-black disabled:opacity-50" disabled={!!busy || generalPending} onClick={() => void save()}>{busy === "保存中" ? "保存中…" : "保存技能"}</button></>}</div></div></div>}>
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr]">
        <select aria-label="Skill 类型" className={fieldClass} value={kind} disabled={!!busy || !!initial || !!candidate || generalPending} onChange={e => setKind(e.target.value as "director" | "general")}><option value="general">通用指令</option><option value="director">制作导演方法</option></select>
        <input className={fieldClass} aria-label="Skill 名称" placeholder="技能名称" value={title} onChange={e => setTitle(e.target.value)} disabled={!!busy} />
      </div>
      <p className="text-sm leading-6 text-text-secondary">{kind === "general" ? "通用指令可在各模块的 AI 任务中按需选用。分类只用于整理，不限定使用范围。" : "制作导演方法按表演、摄影、美术、声音等工作分类，供制作流程分别使用。"}</p>
      <label className="block text-xs text-text-secondary">分类<select aria-label="Skill 分类" className={fieldClass + " mt-1"} value={categoryId} disabled={!!busy} onChange={e => setCategoryId(e.target.value)}><option value="">未分类</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <fieldset className="space-y-2"><legend className="text-xs text-text-secondary">用途（选填，可多选）</legend><div className="flex flex-wrap gap-3">{[...new Set([...Object.keys(SKILL_PURPOSE_LABELS), ...purposes])].map(value => <label key={value} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={purposes.includes(value)} disabled={!!busy} onChange={() => setPurposes(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value])} />{SKILL_PURPOSE_LABELS[value] || value}</label>)}</div></fieldset>
      <fieldset className="space-y-2"><legend className="text-xs text-text-secondary">适用任务（选填，未选表示未限定）</legend><div className="flex flex-wrap gap-3">{[...new Set([...Object.keys(SKILL_TASK_LABELS), ...(applicability.tasks || [])])].map(value => <label key={value} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={applicability.tasks?.includes(value) || false} disabled={!!busy} onChange={() => setApplicability(current => ({ ...current, tasks: current.tasks?.includes(value) ? current.tasks.filter(item => item !== value) : [...(current.tasks || []), value] }))} />{SKILL_TASK_LABELS[value] || value}</label>)}</div></fieldset>
      <fieldset className="space-y-2"><legend className="text-xs text-text-secondary">适用作品形态（选填，未选表示未限定）</legend><div className="flex flex-wrap gap-3">{[...new Set([...Object.keys(SKILL_FORMAT_LABELS), ...(applicability.projectFormats || [])])].map(value => <label key={value} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={applicability.projectFormats?.includes(value) || false} disabled={!!busy} onChange={() => setApplicability(current => ({ ...current, projectFormats: current.projectFormats?.includes(value) ? current.projectFormats.filter(item => item !== value) : [...(current.projectFormats || []), value] }))} />{SKILL_FORMAT_LABELS[value] || value}</label>)}</div></fieldset>
      <label className="block text-xs text-text-secondary">适用说明（选填）<input aria-label="Skill 适用说明" className={fieldClass + " mt-1"} value={applicability.note || ''} onChange={e => setApplicability(current => ({ ...current, note: e.target.value }))} disabled={!!busy} /></label>
      {kind === "general" ? <>
        <label className="block text-xs text-text-secondary">规则与要求<textarea aria-label="Skill 规则与要求" placeholder="写清适用情况、具体做法和需要避免的问题。" className={fieldClass + " mt-1 min-h-56"} value={content} onChange={e => setContent(e.target.value)} disabled={!!busy} /></label>
        <SkillDraftAssistant disabled={!!busy} content={content} categoryName={categories.find(category => category.id === categoryId)?.name || ""} onBusyChange={value => setBusy(value ? "生成草稿中" : "")} onPendingChange={setGeneralPending} onApply={draft => {
          setTitle(draft.title); setContent(draft.content); setDraftSource("ai");
          const category = categories.find(category => category.name === draft.categoryName);
          if (category) setCategoryId(category.id);
        }} />
      </> : <>
        {!candidate && <section className="space-y-3" aria-label="参考与生成">
          <h4 className="text-sm font-semibold">1. 提供参考或要求</h4>
          <label className="block text-xs text-text-secondary">参考作品<input aria-label="参考作品名称" className={fieldClass + " mt-1"} placeholder="例如：复仇者联盟。无需提供待拍剧本" value={referenceWork.title} onChange={e => setReferenceWork(current => ({ ...current, title: e.target.value }))} disabled={!!busy || !!candidate} /></label>
          <details className="text-xs text-text-muted"><summary className="cursor-pointer">版本、重点与分析依据（选填）</summary><div className="mt-2 space-y-2">
            {([['version', '年份或版本'], ['director', '导演（辅助辨认）'], ['focus', '参考片段或重点']] as const).map(([key, label]) => <label key={key} className="block">{label}<input aria-label={label} className={fieldClass + " mt-1"} value={referenceWork[key] || ""} onChange={e => setReferenceWork(current => ({ ...current, [key]: e.target.value }))} disabled={!!busy || !!candidate} /></label>)}
            <label className="block">拉片记录或参考分析<textarea aria-label="导演参考依据" className={fieldClass + " mt-1 min-h-24"} value={analysisNotes} disabled={!!busy || !!candidate} onChange={e => { setAnalysisNotes(e.target.value); setAnalysisReference(referenceKey(referenceWork)); }} /></label>
            {analysisNotes.trim() && !activeAnalysisNotes && <p className="text-amber-600 dark:text-amber-400">参考作品已变更，这份旧分析暂不用于生成。请改为当前作品的分析；原文仍保留在此供核对。</p>}
          </div></details>
          {!profile.methods.length && <label className="block text-xs text-text-secondary">{legacy ? "旧版规则原文（转换后仍保留）" : "补充要求或已有规则（选填）"}<textarea aria-label="Skill 规则与要求" className={fieldClass + " mt-1 min-h-24"} value={content} onChange={e => setContent(e.target.value)} disabled={!!busy || !!candidate} /></label>}
          {legacy && !profile.methods.length && <p className="text-xs leading-5 text-amber-600 dark:text-amber-400">旧版正文只用于完整分镜规划。转换为分类方法后，相关要求才会分发到资产设计等任务；未转换不影响正常制片。</p>}
          {referenceChanged && <p className="text-xs text-amber-600 dark:text-amber-400">参考信息已修改，原方法仍保留。重新生成并采用后，才能保存为新参考的方法。</p>}
          <div className="flex flex-wrap gap-3">
            <button className="inline-flex items-center gap-2 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-black disabled:opacity-50" disabled={!!busy || !!candidate} onClick={() => void draft()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{busy || (legacy && !profile.methods.length ? "转换为分类方法" : profile.methods.length ? "重新生成候选" : "生成导演方法")}</button>
            <button className="text-xs text-text-secondary" onClick={() => { try { setPromptPreview(prompt()); } catch (e) { setError(String(e)); } }}>查看生成提示词</button>
          </div>
          {promptPreview && <details open className="text-xs text-text-muted"><summary className="cursor-pointer">生成提示词</summary><button className="mt-2 inline-flex items-center gap-1 text-gold" onClick={() => void copy(promptPreview)}><Copy className="h-3 w-3" />复制</button><textarea className={fieldClass + " mt-2 h-40"} value={promptPreview} readOnly /></details>}
          {isTestMode && <details className="text-xs text-text-muted"><summary className="cursor-pointer">粘贴 AI 返回 / 导入 JSON</summary><p className="mt-2">导入后先检查候选，再采用；不会覆盖当前方法。</p><textarea aria-label="导演方法 JSON" className={fieldClass + " mt-2 h-32 font-mono"} value={manualJson} onChange={e => setManualJson(e.target.value)} disabled={!!busy} /><button className="mt-2 text-gold" disabled={!!busy} onClick={() => { try { receive(manualJson); setError(""); } catch (e) { setError(String(e)); } }}>校验并预览候选</button></details>}
        </section>}
        {candidate ? <section className="space-y-3 border-t border-gold/40 pt-4" aria-label="导演方法候选">
          <h4 className="text-sm font-semibold">2. 检查并编辑候选 · 尚未替换当前方法</h4>
          <DirectorMethodsEditor value={candidate.profile} onChange={next => setCandidate({ ...candidate, profile: next })} disabled={!!busy} />

        </section> : <section className="space-y-3 border-t border-border-soft/40 pt-4">
          <h4 className="text-sm font-semibold">2. 编辑方法与适用工作</h4>
          <DirectorMethodsEditor value={profile} onChange={next => { if (!profile.methods.length) setAcceptedReference(referenceKey(referenceWork)); setProfile(next); }} disabled={!!busy} />
          {!!profile.methods.length && <details className="text-xs text-text-muted"><summary className="cursor-pointer">查看保存数据 / 导出 JSON</summary><button className="mt-2 text-gold" onClick={() => void copy(JSON.stringify(cleanProfile(profile), null, 2))}>复制 JSON</button><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{JSON.stringify(cleanProfile(profile), null, 2)}</pre></details>}
        </section>}
        <p className="text-xs text-text-muted">{analysisBasis === "work_knowledge" ? "依据作品知识提炼，尚未逐镜核对原片。" : analysisBasis === "provided_analysis" ? "依据提供的分析提炼。" : "可手动编写，也可由 AI 生成候选。"} 具体情境是否适用，在制片时结合剧本决定。</p>
      </>}
    </div>
  </Modal>;
}
