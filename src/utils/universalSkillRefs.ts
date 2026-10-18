import type { Project, UniversalSkillReference } from "../types/project";

type LegacySkillRefProject = Partial<Project> & {
  activeSkills?: UniversalSkillReference[];
};

export const projectUniversalSkillRefs = (
  project?: Partial<Project> | null,
): UniversalSkillReference[] => {
  const record = (project || {}) as LegacySkillRefProject;
  if (Array.isArray(record.universalSkillRefs)) return record.universalSkillRefs;
  if (Array.isArray(record.activeSkills)) return record.activeSkills;
  return [];
};

export const normalizeProjectUniversalSkillRefs = <T extends Partial<Project> | null | undefined>(
  project: T,
): T => {
  if (!project) return project;
  const record = project as LegacySkillRefProject;
  const { activeSkills: _activeSkills, ...rest } = record as LegacySkillRefProject & Record<string, unknown>;
  const hasUniversalSkillRefs = "universalSkillRefs" in record;
  const hasLegacyActiveSkills = "activeSkills" in record;
  if (!hasUniversalSkillRefs && !hasLegacyActiveSkills) return rest as T;
  return {
    ...rest,
    universalSkillRefs: projectUniversalSkillRefs(record),
  } as T;
};
