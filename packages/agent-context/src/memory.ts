import { hashValue } from '../../agent-core/src';
import type { MemoryRecord } from './types';

export function memoryRef(memory: MemoryRecord) {
  return { uri: `resource://memory/${memory.id}`, version: String(memory.revision), contentHash: hashValue(memory), branch: memory.branch };
}
/** Plain text, provenance and review are separate. Memory is advisory context,
 * never an approval or proof that a run/plan/manuscript is complete. */
export function memorySection(memory: MemoryRecord) {
  if (memory.status !== 'ACTIVE' || !memory.content) throw new Error('记忆不可用于上下文');
  return { id: `memory:${memory.id}`, text: `【参考记忆：${memory.content.label}】\n来源：${memory.origin}；审阅：${memory.review}\n${memory.content.value}\n此记忆不代表执行完成、正式剧情事实或新的修改授权。`, required: false, priority: 10,
    dependencies: [{ ref: memoryRef(memory), freshness: 'CURRENT' as const }] };
}
