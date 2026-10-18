import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { Modal } from "./ui/Modal";
import { skillClient } from "../clients/skillClient";
import { useSkillStore } from "../clients/stateClient";

const field = "min-w-0 flex-1 rounded-lg border border-border-soft bg-bg-surface px-3 py-2 text-sm text-text-primary";
export function SkillCategoryManager({ onClose }: { onClose: () => void }) {
  const { categories, skills, fetchSkills } = useSkillStore();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); await fetchSkills(true); }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  return <Modal isOpen title="管理分类" onClose={() => { if (!busy) onClose(); }} size="md" closeOnBackdrop={false}>
    <div className="space-y-4">
      <p className="text-sm leading-6 text-text-secondary">分类用于整理技能，不限制它能在哪个模块使用。删除分类后，技能保留并移入「未分类」。</p>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { await skillClient.createCategory({ name: name.trim() }); setName(""); }); }}>
        <input aria-label="新分类名称" placeholder="新分类名称" maxLength={40} value={name} disabled={busy} onChange={e => setName(e.target.value)} className={field} />
        <button type="submit" disabled={busy || !name.trim()} className="shrink-0 rounded-lg btn-primary px-3 py-2 text-sm disabled:opacity-40">添加</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <ul className="divide-y divide-border-soft">{categories.map(category => <li key={category.id} className="flex min-w-0 items-center gap-2 py-3">
        {editing === category.id ? <form className="flex min-w-0 flex-1 gap-2" onSubmit={e => { e.preventDefault(); void run(async () => { await skillClient.updateCategory(category.id, { name: editName.trim() }); setEditing(null); }); }}>
          <input aria-label="分类新名称" autoFocus maxLength={40} className={field} value={editName} disabled={busy} onChange={e => setEditName(e.target.value)} />
          <button aria-label="保存分类名称" title="保存" disabled={busy || !editName.trim()}><Check className="h-4 w-4" /></button>
          <button type="button" aria-label="取消重命名" title="取消" disabled={busy} onClick={() => setEditing(null)}><X className="h-4 w-4" /></button>
        </form> : <><span className="min-w-0 flex-1 break-words text-sm">{category.name} <span className="text-xs text-text-muted">({skills.filter(s => s.categoryId === category.id).length})</span></span>
          <button className="p-2 text-text-secondary" aria-label={`重命名分类 ${category.name}`} title="重命名" disabled={busy} onClick={() => { setEditing(category.id); setEditName(category.name); }}><Pencil className="h-4 w-4" /></button>
          <button className="p-2 text-text-muted hover:text-red-500" aria-label={`删除分类 ${category.name}`} title="删除分类，保留技能" disabled={busy} onClick={() => { if (window.confirm(`删除分类「${category.name}」？其中的技能将保留并移入未分类。`)) void run(() => skillClient.deleteCategory(category.id)); }}><Trash2 className="h-4 w-4" /></button></>}
      </li>)}</ul>
    </div>
  </Modal>;
}
