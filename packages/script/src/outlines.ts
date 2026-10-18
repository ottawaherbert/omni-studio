import { sha256 } from 'js-sha256';
import type { DeliveryUnit, ScriptProject } from './schema';

export type StoryOutlineKind = 'project' | 'season' | 'story';
export interface ResolvedStoryOutline {
  kind: StoryOutlineKind; scopeId: string; outline: string; sourceField: string; present: boolean; sourceHash: string;
}
export interface PlanningContextOptions { outlineScopeIds?: string[]; includeProjectOutline?: boolean }

/** Scope identity, not a display title or season membership, owns the complete story. */
export function resolveStoryOutline(project: ScriptProject, scopeId: string): ResolvedStoryOutline {
  const season = project.seasons?.find(item => item.id === scopeId);
  const kind: StoryOutlineKind = scopeId === project.id ? 'project' : season ? 'season' : 'story';
  const outline = kind === 'project' ? project.brief.outline : season ? season.arc :
    (project.storyOutlines || []).find(item => item.scopeId === scopeId)?.outline || '';
  const sourceField = kind === 'project' ? 'brief.outline' : kind === 'season' ? `seasons/${scopeId}/arc` : `storyOutlines/${scopeId}/outline`;
  return { kind, scopeId, outline, sourceField, present: Boolean(outline.trim()), sourceHash: sha256(JSON.stringify({scopeId, outline})) };
}

export function sameStoryUnits(project: ScriptProject, unit: DeliveryUnit) {
  return project.units.filter(item => item.scopeId === unit.scopeId);
}

/** No fallback to a mixed project outline and no implicit read of Season.arc via seasonId. */
export function planningContext(project: ScriptProject, unitIds: string[], options: PlanningContextOptions = {}) {
  const selected = project.units.filter(unit => unitIds.includes(unit.id));
  const explicit = new Set(options.outlineScopeIds || []);
  const scopes = new Set([...selected.map(unit => unit.scopeId), ...explicit]);
  const globalStory = project.profile.organization === 'standalone' || project.profile.continuity === 'serialized';
  const includeProject = Boolean(options.includeProjectOutline || explicit.has(project.id) || globalStory && scopes.has(project.id));
  if (options.includeProjectOutline) scopes.add(project.id);
  const outlines = [...scopes].filter(scopeId => scopeId !== project.id || includeProject).map(scopeId => resolveStoryOutline(project, scopeId));
  const units = project.units.filter(unit => scopes.has(unit.scopeId)).map(unit => ({
    id: unit.id, title: unit.title, scopeId: unit.scopeId, ...(unit.seasonId ? {seasonId: unit.seasonId} : {}),
    summary: unit.summary, endingHook: unit.endingHook || '', targetDurationMs: unit.targetDurationMs,
    sourceHash: sha256(JSON.stringify({summary: unit.summary, endingHook: unit.endingHook || '', scopeId: unit.scopeId})),
  }));
  const missing = outlines.filter(item => !item.present && project.units.filter(unit => unit.scopeId === item.scopeId).length > 1)
    .map(item => ({scopeId: item.scopeId, sourceField: item.sourceField, reason: '本故事尚无完整走向；仅使用现有本集安排，不从其他故事或混合全局大纲猜测。'}));
  return { meaning: 'AUTHOR_PLANNING_NOT_OCCURRED_EVENTS', outlines, units, missing,
    projectOutlineIncluded: includeProject,
    guidance: '大纲、分集摘要和结尾方向是规划，不是正文已发生的事实，也不是角色或观众此刻已知的信息。季编排关系本身不授权读取该季完整剧情。' };
}

export function scopedBrief(project: ScriptProject, unitIds: string[], options: PlanningContextOptions = {}) {
  const {concept, theme, audienceExperience, constraints} = project.brief;
  const planning = planningContext(project, unitIds, options);
  return { concept, theme, audienceExperience, constraints, ...(planning.projectOutlineIncluded ? {outline: project.brief.outline} : {}) };
}
