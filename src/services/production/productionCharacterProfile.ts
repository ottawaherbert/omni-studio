import type { Character } from '../../types/project';

export type CharacterProfileTask = 'extract' | 'appearance';
export const characterProductionFields = ['visualIdentity', 'actingStyle', 'vocalQuirk'] as const;

export const characterProfileTaskInstruction = (task: CharacterProfileTask) => task === 'appearance'
  ? '本次仅设计缺失的外观。保留已有可见身份原文与剧本明确锚点，在其后补充未确定的外观设计；新增内容明确标记【外观设计】。只返回 visualIdentity 与 sourceNotes，不生成表演、说话或心理设定。设计不是从剧本提取的事实。'
  : '本次仅从所选来源整理空缺信息。只整理明确的稳定外观、作者明确设定或多处证据支持的日常表演与说话习惯；单次行为不能归纳为长期性格。已有非空内容不改写，未知留空。不得设计缺失外观、推测全剧目标或生成心理画像、人格类型、压力量表。';

/** Keep the production task narrow even when a custom prompt or model returns legacy fields. */
export function characterProfileProposal(raw: Record<string, unknown>, current: Record<string, unknown>, task: CharacterProfileTask) {
  const result: Record<string, string> = {};
  for (const field of task === 'appearance' ? ['visualIdentity'] as const : characterProductionFields) {
    const value = typeof raw[field] === 'string' ? raw[field].trim() : '';
    const existing = typeof current[field] === 'string' ? current[field].trim() : '';
    if (!value || (task === 'extract' && existing)) continue;
    // Appearance suggestions may add to authored identity, never silently replace it.
    result[field] = existing && !value.includes(existing) ? `${existing}\n【外观设计】${value}` : value;
  }
  return result;
}

export function characterProfileChangedSincePreview(character: Character, before: Record<string, unknown>, fields: string[]) {
  const current = character as unknown as Record<string, unknown>;
  return fields.some(field => JSON.stringify(current[field]) !== JSON.stringify(before[field]));
}
