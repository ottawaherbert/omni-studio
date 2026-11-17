import type { Project } from '../../types/project';

/** Interactive preparation owns an independent production target, even for the same author draft. */
export const isInteractiveProductionProject = (project: Project) => Boolean(
  project.interactiveProductionPrepProfile?.experienceId
  || project.interactiveExperienceId
  || project.domain === 'interactive',
);

export const productionProjectSourceKey = (project: Project) => {
  if (isInteractiveProductionProject(project)) return `interactive-project:${project.id}`;
  const snapshot = project.productionSourceSnapshot;
  return snapshot?.sourceType === 'writing_export'
    ? `writing:${snapshot.sourceWritingProjectId}`
    : `project:${project.id}`;
};
