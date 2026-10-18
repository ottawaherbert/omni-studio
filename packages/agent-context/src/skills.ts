import { AgentError, hashValue, jsonCopy } from '../../agent-core/src';
import type { FrozenSkill, SkillTrace } from './types';

export function freezeSkills(input: Array<Omit<FrozenSkill, 'contentHash' | 'snapshotHash'>>) : FrozenSkill[] {
  if (!Array.isArray(input) || input.length > 100 || new Set(input.map(item => item.id)).size !== input.length) throw new AgentError('INVALID_SKILLS', 'Skill 必须是不重复的有限列表', 400);
  return input.map(item => {
    if (![item.id, item.title, item.version, item.content].every(value => typeof value === 'string' && value.trim()) || !['ERROR', 'SKIP'].includes(item.overflow)
      || !item.variables || Array.isArray(item.variables) || typeof item.variables !== 'object' || Object.values(item.variables).some(value => typeof value !== 'string')
      || !item.configuration || typeof item.configuration !== 'object' || Array.isArray(item.configuration)) throw new AgentError('INVALID_SKILL', 'Skill 缺少全文、版本或有效使用配置', 400);
    const frozen = { ...jsonCopy(item), contentHash: hashValue(item.content) };
    return { ...frozen, snapshotHash: hashValue(frozen) };
  });
}

/** Entire rule or explicit skip. A missing variable must never silently erase
 * a rule's subject, and truncation must never be recorded as APPLIED. */
export function renderSkill(skill: FrozenSkill): SkillTrace {
  const { snapshotHash, ...payload } = skill;
  if (hashValue(payload) !== snapshotHash || hashValue(skill.content) !== skill.contentHash) throw new AgentError('SKILL_SNAPSHOT_CHANGED', '冻结的 Skill 内容或配置已变化');
  const missing = new Set<string>();
  const rendered = skill.content.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(skill.variables, key)) { missing.add(key); return ''; }
    return skill.variables[key];
  });
  const base = { id: skill.id, version: skill.version, snapshotHash, contentHash: skill.contentHash };
  if (missing.size) {
    if (skill.overflow !== 'SKIP') throw new AgentError('SKILL_VARIABLE_MISSING', `Skill「${skill.title}」缺少变量：${[...missing].join('、')}`, 422);
    return { ...base, status: 'SKIPPED', reason: 'SKILL_VARIABLE_MISSING', renderedText: '' };
  }
  return { ...base, status: 'APPLIED', reason: null, renderedText: `【Skill：${skill.title} · ${skill.version}】\n${rendered}\n【实际使用配置】\n${JSON.stringify(skill.configuration)}` };
}
