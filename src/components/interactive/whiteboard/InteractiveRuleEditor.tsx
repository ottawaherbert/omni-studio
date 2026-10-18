import type { NarrativeNode, PredicateAST, StateEffectAST, StateSchema } from '../../../domains/interactive/types/schema.ts';

const field = 'w-full rounded-xl border border-border-soft/40 bg-bg-surface px-3 py-2 text-xs text-text-primary outline-none focus:border-gold/60';
const smallButton = 'rounded-lg border border-border-soft/40 px-2 py-1 text-[11px] text-text-secondary hover:border-gold/50';

const variableValue = (schema: StateSchema, key: string) => schema.variables.find((item) => item.key === key)?.defaultValue ?? '';
const readValue = (value: string, schema: StateSchema, key: string): string | number | boolean => {
  const variable = schema.variables.find((item) => item.key === key);
  if (variable?.type === 'boolean') return value === 'true';
  if (variable?.type === 'number') return Number(value);
  return value;
};
const valueEditor = (
  value: string | number | boolean,
  variableKey: string,
  schema: StateSchema,
  onChange: (value: string | number | boolean) => void,
) => {
  const variable = schema.variables.find((item) => item.key === variableKey);
  if (variable?.type === 'boolean') return <select aria-label="比较值" className={field} value={String(value)} onChange={(event) => onChange(event.target.value === 'true')}><option value="true">是</option><option value="false">否</option></select>;
  if (variable?.type === 'enum') return <select aria-label="比较值" className={field} value={String(value)} onChange={(event) => onChange(event.target.value)}>{!variable.enumValues?.includes(String(value)) && <option value={String(value)}>{String(value)}</option>}{variable.enumValues?.map((item) => <option key={item} value={item}>{item}</option>)}</select>;
  return <input aria-label="比较值" type={variable?.type === 'number' ? 'number' : 'text'} className={field} value={String(value)} onChange={(event) => onChange(readValue(event.target.value, schema, variableKey))} />;
};

export function InteractivePredicateEditor({ value, onChange, schema, nodes, depth = 0 }: {
  value?: PredicateAST;
  onChange: (next?: PredicateAST) => void;
  schema: StateSchema;
  nodes: NarrativeNode[];
  depth?: number;
}) {
  const op = value?.op || 'none';
  const changeOp = (next: string) => {
    if (next === 'none') return onChange(undefined);
    const defaults: Record<string, PredicateAST> = {
      always: { op: 'always' }, never: { op: 'never' },
      all: { op: 'all', predicates: [] }, any: { op: 'any', predicates: [] },
      not: { op: 'not', predicate: { op: 'always' } },
      has_fact: { op: 'has_fact', fact: schema.factDefinitions?.[0] || '' },
      visited: { op: 'visited', nodeId: nodes[0]?.id || '', minTimes: 1 },
      compare: { op: 'compare', variable: schema.variables[0]?.key || '', comparator: 'eq', value: schema.variables[0]?.defaultValue ?? '' },
    };
    onChange(defaults[next]);
  };
  return <div className="space-y-2 rounded-xl border border-border-soft/30 bg-bg-surface-soft/40 p-2.5">
    <select aria-label="成立条件" className={field} value={op} onChange={(event) => changeOp(event.target.value)}>
      <option value="none">不设置条件</option><option value="always">始终可选</option><option value="never">暂不可选</option>
      <option value="has_fact">拥有事实</option><option value="visited">到访过节点</option><option value="compare">变量比较</option>
      <option value="all">同时满足全部</option><option value="any">满足其中之一</option><option value="not">条件不成立</option>
    </select>
    {value?.op === 'has_fact' && <select aria-label="所需事实" className={field} value={value.fact} onChange={(event) => onChange({ ...value, fact: event.target.value })}>{!schema.factDefinitions?.includes(value.fact) && <option value={value.fact}>{value.fact || '选择事实'}</option>}{schema.factDefinitions?.map((fact) => <option key={fact} value={fact}>{fact}</option>)}</select>}
    {value?.op === 'visited' && <div className="grid grid-cols-[1fr_88px] gap-2"><select aria-label="到访节点" className={field} value={value.nodeId} onChange={(event) => onChange({ ...value, nodeId: event.target.value })}>{!nodes.some((node) => node.id === value.nodeId) && <option value={value.nodeId}>{value.nodeId || '选择节点'}</option>}{nodes.map((node) => <option key={node.id} value={node.id}>{node.brief.title}</option>)}</select><input aria-label="至少到访次数" className={field} type="number" min={1} value={value.minTimes ?? 1} onChange={(event) => onChange({ ...value, minTimes: Number(event.target.value) })} /></div>}
    {value?.op === 'compare' && <div className="grid grid-cols-1 gap-2"><select aria-label="比较变量" className={field} value={value.variable} onChange={(event) => onChange({ ...value, variable: event.target.value, value: variableValue(schema, event.target.value) })}>{!schema.variables.some((item) => item.key === value.variable) && <option value={value.variable}>{value.variable || '选择变量'}</option>}{schema.variables.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}</select><div className="grid grid-cols-2 gap-2"><select aria-label="比较方式" className={field} value={value.comparator} onChange={(event) => onChange({ ...value, comparator: event.target.value as typeof value.comparator })}><option value="eq">等于</option><option value="neq">不等于</option><option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option></select>{valueEditor(value.value, value.variable, schema, (next) => onChange({ ...value, value: next }))}</div></div>}
    {value?.op === 'not' && <InteractivePredicateEditor value={value.predicate} onChange={(predicate) => onChange({ ...value, predicate: predicate || { op: 'always' } })} schema={schema} nodes={nodes} depth={depth + 1} />}
    {(value?.op === 'all' || value?.op === 'any') && <div className="space-y-2">{value.predicates.map((child, index) => <div key={index} className="flex items-start gap-1"><div className="min-w-0 flex-1"><InteractivePredicateEditor value={child} onChange={(next) => onChange({ ...value, predicates: value.predicates.map((item, at) => at === index ? next || { op: 'always' } : item) })} schema={schema} nodes={nodes} depth={depth + 1} /></div><button type="button" aria-label={`删除条件 ${index + 1}`} className={smallButton} onClick={() => onChange({ ...value, predicates: value.predicates.filter((_, at) => at !== index) })}>删除</button></div>)}<button type="button" className={smallButton} onClick={() => onChange({ ...value, predicates: [...value.predicates, { op: 'always' }] })}>添加子条件</button></div>}
  </div>;
}

export function InteractiveEffectsEditor({ value, onChange, schema }: {
  value: StateEffectAST[];
  onChange: (next: StateEffectAST[]) => void;
  schema: StateSchema;
}) {
  const change = (index: number, next: StateEffectAST) => onChange(value.map((item, at) => at === index ? next : item));
  return <div className="space-y-2">{value.map((effect, index) => <div key={index} className="space-y-2 rounded-xl border border-border-soft/30 bg-bg-surface-soft/40 p-2.5"><div className="flex gap-2"><select aria-label={`效果 ${index + 1} 类型`} className={field} value={effect.type} onChange={(event) => { const type = event.target.value as StateEffectAST['type']; change(index, type === 'add_fact' || type === 'remove_fact' ? { type, fact: schema.factDefinitions?.[0] || '' } : type === 'set' ? { type, variable: schema.variables[0]?.key || '', value: schema.variables[0]?.defaultValue ?? '' } : { type, variable: schema.variables[0]?.key || '', amount: 1 }); }}><option value="set">设置变量</option><option value="increment">增加数值</option><option value="decrement">减少数值</option><option value="add_fact">获得事实</option><option value="remove_fact">移除事实</option></select><button type="button" className={smallButton} aria-label={`删除效果 ${index + 1}`} onClick={() => onChange(value.filter((_, at) => at !== index))}>删除</button></div>{'fact' in effect ? <select aria-label="效果事实" className={field} value={effect.fact} onChange={(event) => change(index, { ...effect, fact: event.target.value })}>{!schema.factDefinitions?.includes(effect.fact) && <option value={effect.fact}>{effect.fact || '选择事实'}</option>}{schema.factDefinitions?.map((fact) => <option key={fact} value={fact}>{fact}</option>)}</select> : <div className="grid grid-cols-2 gap-2"><select aria-label="效果变量" className={field} value={effect.variable} onChange={(event) => change(index, effect.type === 'set' ? { ...effect, variable: event.target.value, value: variableValue(schema, event.target.value) } : { ...effect, variable: event.target.value })}>{!schema.variables.some((item) => item.key === effect.variable) && <option value={effect.variable}>{effect.variable || '选择变量'}</option>}{schema.variables.map((item) => <option key={item.key} value={item.key}>{item.key}</option>)}</select>{effect.type === 'set' ? valueEditor(effect.value, effect.variable, schema, (next) => change(index, { ...effect, value: next })) : <input aria-label="变化量" type="number" min={0} className={field} value={effect.amount} onChange={(event) => change(index, { ...effect, amount: Number(event.target.value) })} />}</div>}</div>)}<button type="button" className={smallButton} onClick={() => onChange([...value, { type: 'set', variable: schema.variables[0]?.key || '', value: schema.variables[0]?.defaultValue ?? '' }])}>添加状态效果</button></div>;
}
