import { AgentError, assertResourceRef, hashValue, jsonCopy } from '../../agent-core/src';
import { renderSkill } from './skills';
import type { ContextBundle, ContextSection, Dependency, FrozenSkill, SkillTrace } from './types';

export function validateDependencies(dependencies: Dependency[]) {
  if (!Array.isArray(dependencies) || dependencies.length > 2000) throw new AgentError('INVALID_DEPENDENCIES', '上下文来源依赖无效', 400);
  for (const item of dependencies) { assertResourceRef(item.ref); if (!['EXACT', 'CURRENT', 'COLLECTION'].includes(item.freshness)) throw new AgentError('INVALID_DEPENDENCY_FRESHNESS', '来源缺少版本读取语义', 400); }
  return jsonCopy(dependencies);
}

export function compileContext(input: { systemInstruction: string; sections: ContextSection[]; skills: FrozenSkill[]; outputSchema?: Record<string, unknown>; tools?: unknown[] }): ContextBundle {
  const sections = jsonCopy(input.sections), skills = jsonCopy(input.skills);
  if (typeof input.systemInstruction !== 'string' || !Array.isArray(sections) || new Set(sections.map(s => s.id)).size !== sections.length) throw new AgentError('INVALID_CONTEXT', '上下文分段标识无效', 400);
  for (const item of sections) {
    if (!item.id || typeof item.text !== 'string' || typeof item.required !== 'boolean' || !Number.isFinite(item.priority)) throw new AgentError('INVALID_CONTEXT_SECTION', '上下文分段无效', 400);
    validateDependencies(item.dependencies);
  }
  const traces: SkillTrace[] = skills.map(renderSkill);
  // Preserve all supplied source text. Priority controls order, never omission.
  const selected = [...sections.filter(section => section.required),
    ...sections.filter(section => !section.required).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))];
  const applied = traces.filter(trace => trace.status === 'APPLIED');
  const actual = { systemInstruction: input.systemInstruction,
    prompt: [...selected.map(section => section.text), ...applied.map(trace => trace.renderedText)].join('\n\n'),
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}), ...(input.tools ? { tools: input.tools } : {}) };
  const dependencies = [...new Map(selected.flatMap(section => section.dependencies).map(dep => [hashValue(dep), dep])).values()];
  return { schemaVersion: 1, ...actual, sections: selected, dependencies, skills, skillTrace: traces, payloadHash: hashValue(actual) };
}
