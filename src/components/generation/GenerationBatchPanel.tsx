import { useState } from 'react';
import { generationClient } from '../../clients/generationClient';
import { type GenerationWorkspace, type GenerationTaskDraft, type GenerationPlanRevision } from '../../../packages/domain/src/generation';

const button = 'rounded-md border border-border-soft/50 px-3 py-2 text-xs disabled:opacity-40 hover:border-gold';
export function GenerationBatchPanel({ workspace, tasks, onRefresh, onError, beforeAction }: { workspace: GenerationWorkspace; tasks: GenerationTaskDraft[]; onRefresh: () => Promise<unknown>; onError: (text: string) => void; beforeAction: () => Promise<unknown> }) {
  const [selected, setSelected] = useState<string[]>([]), [plans, setPlans] = useState<GenerationPlanRevision[]>([]), [failures, setFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<{ keys: Record<string, string> }>();
  async function run(action: () => Promise<void>) { setBusy(true); onError(''); try { await action(); } catch (error) { onError(error instanceof Error ? error.message : '批次操作失败，未提交项保留。'); } finally { setBusy(false); } }
  return <details className="mb-4 border-y border-border-soft/30 py-3" onToggle={() => {}}><summary className="cursor-pointer text-xs text-text-secondary">批量制作 · {tasks.length} 个任务</summary>
    <p className="my-3 text-xs leading-5 text-text-muted">先检查选中的任务，再查看本次实际执行清单。任务生成后进入候选；采用由作者另行决定。</p>
    <div className="grid gap-2 sm:grid-cols-2">{tasks.map(task => <label key={task.id} className="flex min-w-0 items-start gap-2 text-xs"><input type="checkbox" checked={selected.includes(task.id)} disabled={busy} onChange={e => { setSelected(old => e.target.checked ? [...old, task.id] : old.filter(id => id !== task.id)); setPlans([]); setTicket(undefined); }} /><span>{task.label}{workspace.scheduled?.find(s => s.taskId === task.id && s.status === 'waiting') ? ' · 正在等待依赖' : ''}</span></label>)}</div>
    <button className={`${button} mt-3`} disabled={!selected.length || busy} onClick={() => void run(async () => { await beforeAction(); const fresh = await generationClient.workspace(workspace.target), next: GenerationPlanRevision[] = [], errors: string[] = []; for (const id of selected) { const task = fresh.tasks.find(t => t.id === id); if (!task) { errors.push('有任务已变化'); continue; } const result = await generationClient.preflight(task); if (result.plan) next.push(result.plan); else errors.push(`${task.label}：${result.issues.map(i => i.message).join('；')}`); } setPlans(next); setFailures(errors); setTicket(undefined); })}>{busy ? '正在处理…' : '检查所选任务'}</button>
    {failures.map((f, i) => <p key={i} className="mt-2 text-xs text-amber-600">{f}</p>)}
    {!!plans.length && <div className="mt-3 space-y-3 border-l-2 border-gold pl-3 text-xs leading-5"><p>本次可执行 {plans.length} 项：{plans.map(p => `${tasks.find(t => t.id === p.taskId)?.label}（${p.references.length} 份参考${p.expectedSeconds ? `，约 ${p.expectedSeconds.toFixed(2)} 秒` : ''}）`).join('；')}。{failures.length ? '有问题的任务不会包含在下面的提交中。' : ''}</p>
      <button className={button} disabled={busy} onClick={() => void run(async () => {
        let current = ticket;
        if (!current) { current = { keys: Object.fromEntries(plans.map(p => [p.id, crypto.randomUUID()])) }; setTicket(current); }
        await generationClient.batch(plans, current.keys); await onRefresh();
      })}>提交这 {plans.length} 项{ticket ? '（沿用原提交标识）' : ''}</button>
    </div>}
    {!!selected.length && <div className="mt-3 border-t border-border-soft/30 pt-3">
      <button className={button} disabled={busy} onClick={() => void run(async () => {
        await beforeAction(); await generationClient.schedule(selected, crypto.randomUUID()); await onRefresh();
      })}>等待所选任务依赖后执行</button>
      <p className="mt-2 text-xs text-text-muted">只处理本次加入的任务；依赖就绪后重新检查再提交。任务被修改或项目暂停时停止推进。</p>
    </div>}
  </details>;
}
