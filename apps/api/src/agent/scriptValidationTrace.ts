import type Database from 'better-sqlite3';

type Target = { name: string; object: object; methods: string[] };
type Stat = { calls: number; totalMs: number; selfMs: number };
type Span = { name: string; started: number; childMs: number };

/** Opt-in synchronous diagnostics. No proof, payload, or authority is retained.
 * Methods keep their exact return/throw behavior, including Promise identity;
 * an asynchronous method would measure only its synchronous prefix. */
export function installScriptValidationTrace(db: Pick<InstanceType<typeof Database>, 'inTransaction' | 'prepare'>,
  targets: Target[], options: { enabled?: boolean; minimumMs?: number; emit?: (record: unknown) => void } = {}) {
  if (!(options.enabled ?? process.env.SCRIPT_VALIDATION_TRACE === '1')) return () => {};
  const emit = options.emit ?? (record => console.error('[script-validation]', JSON.stringify(record)));
  const minimumMs = options.minimumMs ?? 100;
  const stack: Span[] = [], restore: Array<() => void> = [];
  let stats: Record<string, Stat> = {};
  let sequence = 0;
  for (const target of targets) for (const method of target.methods) {
    const object = target.object as Record<string, any>, original = object[method];
    if (typeof original !== 'function') continue;
    object[method] = function (this: unknown, ...args: unknown[]) {
      const outer = stack.length === 0, name = `${target.name}.${method}`;
      if (outer) stats = {};
      const span: Span = { name, started: performance.now(), childMs: 0 };
      const inTransaction = outer ? db.inTransaction : undefined;
      // Diagnostics may fail independently of execution (e.g. during shutdown).
      const changes = () => { try { return (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n; } catch { return null; } };
      const changesBefore = outer ? changes() : null;
      const caller = outer ? new Error().stack?.split('\n').slice(2, 9).map(line => line.trim()) : undefined;
      stack.push(span);
      let failed = false;
      try { return original.apply(this, args); }
      catch (error) { failed = true; throw error; }
      finally {
        const elapsed = performance.now() - span.started;
        stack.pop();
        const stat = stats[name] ??= { calls: 0, totalMs: 0, selfMs: 0 };
        stat.calls++; stat.totalMs += elapsed; stat.selfMs += elapsed - span.childMs;
        if (stack.length) stack[stack.length - 1].childMs += elapsed;
        if (outer) {
          if (elapsed >= minimumMs) {
            const record = { sequence: ++sequence, at: new Date().toISOString(), name, elapsedMs: Math.round(elapsed),
              failed, inTransaction, changesBefore, changesAfter: changes(), caller,
              methods: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, {
                calls: value.calls, totalMs: Math.round(value.totalMs), selfMs: Math.round(value.selfMs),
              }])) };
            try { emit(record); } catch { /* Observability must not change execution. */ }
          }
          stats = {};
        }
      }
    };
    restore.push(() => { object[method] = original; });
  }
  return () => { restore.forEach(action => action()); };
}
