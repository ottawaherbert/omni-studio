import { Plus, Trash2 } from "lucide-react";
import { DIRECTOR_FIELDS, directorFields, directorFieldValues, setDirectorField } from "../../clients/creativeDirectionClient";
import type { DirectorProfileV2, DirectorMethod, DirectorField } from "../../clients/creativeDirectionClient";

const input = "w-full rounded-md border border-border-soft bg-bg-primary px-3 py-2 text-sm text-text-primary";
const lines = (value: string) => value.split("\n");
export function DirectorMethodsEditor({ value, onChange, disabled = false }: {
  value: DirectorProfileV2; onChange: (value: DirectorProfileV2) => void; disabled?: boolean;
}) {
  const changeMethod = (id: string, patch: Partial<DirectorMethod>) => onChange({ ...value, methods: value.methods.map(method => method.id === id ? { ...method, ...patch } : method) });
  return <div className="space-y-4" aria-label="导演方法编辑器">
    <p className="text-xs leading-5 text-text-muted">按方法编辑适用情境与拍法，再选择它指导的工作。没有填写的工作不受此方法影响；资产设计只使用对应的外观字段，分镜采用后再指导图像、视频和声音。</p>
    <label className="block text-xs text-text-secondary">整体原则（选填，一行一条，仅用于分镜规划）<textarea className={input + " mt-1"} aria-label="导演整体原则" value={value.principles.join("\n")} onChange={e => onChange({ ...value, principles: lines(e.target.value) })} disabled={disabled} /></label>
    {value.methods.map((method, index) => <details key={method.id} open className="border-t border-border-soft/40 pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-text-primary">{index + 1}. {method.title || "新方法"} <span className="font-normal text-text-muted">· {directorFields.filter(path => directorFieldValues(method.directions, path).length).length} 项指导</span></summary>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px_auto]">
          <label className="text-xs text-text-secondary">方法名称<input className={input + " mt-1"} value={method.title} onChange={e => changeMethod(method.id, { title: e.target.value })} disabled={disabled} /></label>
          <label className="text-xs text-text-secondary">主次<select className={input + " mt-1"} value={method.priority} onChange={e => changeMethod(method.id, { priority: e.target.value as DirectorMethod["priority"] })} disabled={disabled}><option value="core">核心方法</option><option value="supporting">辅助方法</option></select></label>
          <button type="button" className="self-end p-2 text-text-muted hover:text-red-500" aria-label={`移除方法 ${index + 1}`} disabled={disabled} onClick={() => onChange({ ...value, methods: value.methods.filter(item => item.id !== method.id) })}><Trash2 className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-text-secondary">什么情境下使用<textarea className={input + " mt-1 min-h-20"} placeholder="例如：多人对话中，人物对同一消息有不同判断" value={method.when} onChange={e => changeMethod(method.id, { when: e.target.value })} disabled={disabled} /></label>
          <label className="text-xs text-text-secondary">希望观众关注或感受到什么<textarea className={input + " mt-1 min-h-20"} value={method.purpose} onChange={e => changeMethod(method.id, { purpose: e.target.value })} disabled={disabled} /></label>
        </div>
        {directorFields.filter(path => directorFieldValues(method.directions, path).length).map(path => <div key={path}>
          <div className="flex items-center justify-between gap-2"><label htmlFor={`${method.id}-${path}`} className="text-xs font-semibold text-text-secondary">{DIRECTOR_FIELDS[path].label}</label><button type="button" className="text-xs text-text-muted" aria-label={`移除${DIRECTOR_FIELDS[path].label}`} disabled={disabled} onClick={() => changeMethod(method.id, { directions: setDirectorField(method.directions, path, []) })}>移除</button></div>
          <textarea id={`${method.id}-${path}`} className={input + " mt-1 min-h-20"} placeholder="具体做法，一行一条" value={directorFieldValues(method.directions, path).join("\n")} onChange={e => changeMethod(method.id, { directions: setDirectorField(method.directions, path, lines(e.target.value)) })} disabled={disabled} />
        </div>)}
        <select aria-label={`为方法 ${index + 1} 添加指导方面`} className={input} value="" disabled={disabled} onChange={e => { if (e.target.value) changeMethod(method.id, { directions: setDirectorField(method.directions, e.target.value as DirectorField, [""]) }); }}>
          <option value="">添加要指导的工作…</option>
          {[...new Set(directorFields.map(path => DIRECTOR_FIELDS[path].group))].map(group => <optgroup label={group} key={group}>{directorFields.filter(path => DIRECTOR_FIELDS[path].group === group && !directorFieldValues(method.directions, path).length).map(path => <option key={path} value={path}>{DIRECTOR_FIELDS[path].label}</option>)}</optgroup>)}
        </select>
        <details className="text-xs text-text-muted"><summary className="cursor-pointer">例外与检查点（选填）</summary><div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label>何时停止或让位<textarea className={input + " mt-1"} value={method.exceptions.join("\n")} onChange={e => changeMethod(method.id, { exceptions: lines(e.target.value) })} disabled={disabled} /></label>
          <label>如何检查拍法<textarea className={input + " mt-1"} value={method.checks.join("\n")} onChange={e => changeMethod(method.id, { checks: lines(e.target.value) })} disabled={disabled} /></label>
        </div></details>
      </div>
    </details>)}
    <button type="button" className="inline-flex items-center gap-2 rounded-md border border-border-soft px-3 py-2 text-sm" disabled={disabled} onClick={() => onChange({ ...value, methods: [...value.methods, { id: "method-" + crypto.randomUUID().slice(0, 8), title: "", priority: "supporting", when: "", purpose: "", directions: {}, exceptions: [], checks: [] }] })}><Plus className="h-4 w-4" />添加方法</button>
    {!!value.unclassified?.length && <label className="block text-xs text-amber-600 dark:text-amber-400">待整理原文 · 不参与制片指令<textarea className={input + " mt-1"} value={value.unclassified.join("\n")} onChange={e => onChange({ ...value, unclassified: lines(e.target.value) })} disabled={disabled} /><span className="mt-1 block">可将可用内容移入上方的具体指导，保留其余记录。</span></label>}
    {value.legacySource && <details className="text-xs text-text-muted"><summary className="cursor-pointer">转换前原文（保留备查）</summary><p className="mt-2 whitespace-pre-wrap">{value.legacySource}</p></details>}
  </div>;
}
