import type { PrevisContactCheck, PrevisContactIssue } from '../../clients/previsClient';

export function ContactCheckPanel({ check, busy, dirty, scopeLabel, onStart, onLocate }: { check?: PrevisContactCheck; busy: boolean; dirty: boolean; scopeLabel: string; onStart: () => void; onLocate: (issue: PrevisContactIssue) => void }) {
  const running = check?.status === 'queued' || check?.status === 'running';
  return <section className="mt-5 space-y-3 border-t border-border-soft/30 pt-4" aria-label="接触与穿模检查">
    <button className="min-h-9 w-full rounded-md border border-border-soft/50 px-3 py-2 text-xs text-text-secondary hover:border-gold disabled:opacity-40" disabled={busy || running} onClick={onStart}>{running ? '正在检查…' : `检查${scopeLabel}接触与穿模`}</button>
    {dirty && <p className="text-xs leading-5 text-text-muted">检查会先保存当前修改，结果只对应保存的版本。</p>}
    {check?.status === 'failed' && <p role="alert" className="text-xs text-red-400">{check.error}</p>}
    {check?.report && <><p className={`text-xs ${check.report.passed && check.sourceCurrent && !dirty ? 'text-green-400' : 'text-amber-400'}`}>{!check.sourceCurrent || dirty ? '内容已变化，需重新检查' : check.report.passed ? '数值检查通过，仍需看图与播放验收' : `${check.report.issues.length}项问题，参考暂不可用于生成`}</p><p className="text-xs text-text-muted">{check.report.sampledFrames}个采样点 · {check.report.checkedObjectIds.length}个物体</p>
      <ul className="max-h-60 space-y-2 overflow-y-auto">{check.report.issues.slice(0, 60).map((issue, i) => <li key={i}><button className="w-full text-left text-xs leading-5 text-text-secondary hover:text-gold" onClick={() => onLocate(issue)}>{issue.shotId ? `${issue.time?.toFixed(2)}秒 · ` : ''}{issue.message}</button></li>)}</ul>
      {!check.report.complete && <p className="text-xs text-amber-400">检查覆盖不足，不能判定通过。</p>}
      <details><summary className="cursor-pointer text-xs text-text-muted">检查范围与限制</summary><p className="mt-2 text-xs leading-5 text-text-muted">{check.report.limitations.join(' ')}</p></details>
    </>}
  </section>;
}
