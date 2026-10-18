import { sha256 } from 'js-sha256';
import { AgentError } from './errors';

// Adapted from duilang bookAgent/idempotency.ts; see migration/manifest.json.
// Only JSON values cross the persistent command boundary. Preserve __proto__
// as data, and reject cycles/non-JSON objects rather than silently hash aliases.
export function stableJson(value: unknown): string {
  const ancestors = new Set<object>();
  function normalize(item: unknown): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object' || !item) throw new AgentError('INVALID_JSON', '执行数据必须是有限的 JSON 值', 400);
    if (ancestors.has(item)) throw new AgentError('INVALID_JSON', '执行数据不能循环引用', 400);
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        return Array.from(item, normalize);
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new AgentError('INVALID_JSON', '执行数据必须是普通 JSON 对象', 400);
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        const child = (item as Record<string, unknown>)[key];
        if (child !== undefined) result[key] = normalize(child);
      }
      return result;
    } finally { ancestors.delete(item); }
  }
  return JSON.stringify(normalize(value));
}

export const hashValue = (value: unknown) => sha256(stableJson(value));
export const hashCommand = (kind: string, payload: unknown) => hashValue({ kind, payload });
export const jsonCopy = <T>(value: T): T => JSON.parse(stableJson(value));
export function assertSamePayload(actual: string, expected: string) {
  if (actual !== expected) throw new AgentError('IDEMPOTENCY_CONFLICT', '同一请求标识不能用于不同内容');
}
