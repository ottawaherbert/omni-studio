import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { StateSchema, StateVariableSchema } from '../../../domains/interactive/types/schema.ts';
import { getFactDefinitions } from '../../../domains/interactive/types/schema.ts';

const input = 'w-full rounded-xl border border-border-soft/40 bg-bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:border-gold/60';
const action = 'rounded-xl border border-border-soft/40 px-3 py-2 text-xs font-bold text-text-secondary hover:border-gold/50';
const split = (value: string) => value.split('\n').map((item) => item.trim()).filter(Boolean);

export function InteractiveStateSchemaInspector({ schema, onSave, onClose }: {
  schema: StateSchema;
  onSave: (next: StateSchema) => void;
  onClose: () => void;
}) {
  const [variables, setVariables] = useState<StateVariableSchema[]>(() => structuredClone(schema.variables));
  const [facts, setFacts] = useState(getFactDefinitions(schema).join('\n'));
  const [initialFacts, setInitialFacts] = useState((schema.initialFactIds || []).join('\n'));
  const [error, setError] = useState('');
  const update = (index: number, patch: Partial<StateVariableSchema>) => setVariables((current) => current.map((item, at) => at === index ? { ...item, ...patch } : item));
  const handleSave = () => {
    const factDefinitions = split(facts);
    const initialFactIds = split(initialFacts);
    const keys = variables.map((item) => item.key.trim());
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return setError('变量名不能为空或重复');
    if (new Set(factDefinitions).size !== factDefinitions.length) return setError('事实名称不能重复');
    if (initialFactIds.some((fact) => !factDefinitions.includes(fact))) return setError('初始事实必须先在事实定义中登记');
    if (variables.some((item) => item.type === 'enum' && !(item.enumValues || []).length)) return setError('枚举变量需要至少一个可选值');
    onSave({ variables: variables.map((item) => ({ ...item, key: item.key.trim() })), factDefinitions, initialFactIds });
  };
  return <aside className="fixed top-14 bottom-0 right-0 z-40 flex w-full flex-col border-l border-border-soft/30 bg-bg-surface/95 text-text-primary shadow-2xl backdrop-blur-xl sm:w-[390px]">
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft/30 px-4"><h2 className="text-base font-extrabold">故事状态</h2><button type="button" aria-label="关闭故事状态" onClick={onClose}><X className="h-5 w-5" /></button></header>
    <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
      <p className="text-text-muted">变量和事实供分支条件与效果使用。已有引用不会随名称自动改写。</p>
      <section className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-bold">状态变量</h3><button type="button" className={action} onClick={() => setVariables([...variables, { key: '', type: 'boolean', scope: 'global', defaultValue: false }])}>添加变量</button></div>
        {variables.map((item, index) => <div key={index} className="space-y-2 rounded-xl border border-border-soft/30 bg-bg-surface-soft/40 p-3">
          <div className="flex gap-2"><input aria-label={`变量 ${index + 1} 名称`} value={item.key} onChange={(event) => update(index, { key: event.target.value })} placeholder="变量名，如 trust" className={input} /><button type="button" className={action} onClick={() => setVariables(variables.filter((_, at) => at !== index))}>删除</button></div>
          <div className="grid grid-cols-2 gap-2"><label>类型<select aria-label={`变量 ${index + 1} 类型`} value={item.type} className={input} onChange={(event) => { const type = event.target.value as StateVariableSchema['type']; update(index, { type, defaultValue: type === 'boolean' ? false : type === 'number' ? 0 : '', enumValues: type === 'enum' ? ['选项一'] : undefined, min: undefined, max: undefined }); }}><option value="boolean">是 / 否</option><option value="number">数字</option><option value="string">文字</option><option value="enum">枚举</option></select></label><label>作用范围<select aria-label={`变量 ${index + 1} 范围`} value={item.scope} className={input} onChange={(event) => update(index, { scope: event.target.value as StateVariableSchema['scope'] })}><option value="global">全作品</option><option value="chapter">本章</option><option value="session">本次游玩</option></select></label></div>
          {item.type === 'enum' && <label>可选值（每行一项）<textarea aria-label={`变量 ${index + 1} 可选值`} value={(item.enumValues || []).join('\n')} onChange={(event) => update(index, { enumValues: split(event.target.value) })} rows={3} className={input} /></label>}
          <label>初始值{item.type === 'boolean' ? <select aria-label={`变量 ${index + 1} 初始值`} value={String(item.defaultValue)} className={input} onChange={(event) => update(index, { defaultValue: event.target.value === 'true' })}><option value="false">否</option><option value="true">是</option></select> : item.type === 'enum' ? <select aria-label={`变量 ${index + 1} 初始值`} value={String(item.defaultValue)} className={input} onChange={(event) => update(index, { defaultValue: event.target.value })}>{!item.enumValues?.includes(String(item.defaultValue)) && <option value={String(item.defaultValue)}>{String(item.defaultValue) || '请选择'}</option>}{item.enumValues?.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input aria-label={`变量 ${index + 1} 初始值`} type={item.type === 'number' ? 'number' : 'text'} value={String(item.defaultValue)} className={input} onChange={(event) => update(index, { defaultValue: item.type === 'number' ? Number(event.target.value) : event.target.value })} />}</label>
          {item.type === 'number' && <div className="grid grid-cols-2 gap-2"><label>最小值<input aria-label={`变量 ${index + 1} 最小值`} type="number" value={item.min ?? ''} className={input} onChange={(event) => update(index, { min: event.target.value === '' ? undefined : Number(event.target.value) })} /></label><label>最大值<input aria-label={`变量 ${index + 1} 最大值`} type="number" value={item.max ?? ''} className={input} onChange={(event) => update(index, { max: event.target.value === '' ? undefined : Number(event.target.value) })} /></label></div>}
        </div>)}
      </section>
      <label className="block font-bold">事实定义（每行一项）<textarea aria-label="事实定义" rows={4} value={facts} onChange={(event) => setFacts(event.target.value)} className={`mt-1 ${input}`} /></label>
      <label className="block font-bold">开局已拥有的事实（每行一项）<textarea aria-label="初始事实" rows={3} value={initialFacts} onChange={(event) => setInitialFacts(event.target.value)} className={`mt-1 ${input}`} /></label>
      {error && <p role="alert" className="text-rose-500">{error}</p>}
    </div>
    <footer className="border-t border-border-soft/30 p-4"><button type="button" onClick={handleSave} className="w-full rounded-xl bg-gold px-4 py-2.5 text-xs font-bold text-bg-primary hover:bg-gold-light">保存故事状态</button></footer>
  </aside>;
}
