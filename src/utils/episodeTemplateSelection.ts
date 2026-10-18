import type { Project } from "../types/project";
import type { BeatTemplate } from "../config/templates";
import type { FormatProductionProfile } from "../config/formatProductionProfiles";

const normalizeText = (value: string): string => value.toLowerCase().replace(/\s+/g, "");

export const buildEpisodeTemplateProjectText = (project: Project | null): string => {
  if (!project) return "";
  return normalizeText(
    [
      project.title,
      project.originalInspiration,
      project.refinedInspiration,
      project.logline,
      project.coreConflict,
      project.creativeVision?.narrativeStyle,
      project.creativeVision?.referenceWorks,
      ...(project.creativeVision?.genre || []),
      ...(project.plannedCharacters || []).map((item) => item.name),
      ...(project.plannedLocations || []).map((item) => item.name),
      ...(project.plannedProps || []).map((item) => item.name),
    ]
      .filter(Boolean)
      .join(" "),
  );
};

const templateTopicText = (template: BeatTemplate): string =>
  normalizeText(
    [
      template.id,
      template.name,
      template.description,
      template.instruction,
      template.referenceWork,
      ...(template.topicKeywords || []),
    ]
      .filter(Boolean)
      .join(" "),
  );

const scoreTemplateTopicFit = (projectText: string, template: BeatTemplate): number => {
  const keywordHits = (template.topicKeywords || []).filter((keyword) =>
    projectText.includes(normalizeText(keyword)),
  ).length;

  if (keywordHits > 0) return keywordHits * 10;

  const templateText = templateTopicText(template);
  const projectTokens = Array.from(new Set(projectText.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9-]{3,}/g) || []));
  return projectTokens.filter((token) => templateText.includes(token)).length;
};

export const selectDefaultEpisodeTemplateIds = ({
  project,
  skeletons,
  beats,
  profile,
}: {
  project: Project | null;
  skeletons: BeatTemplate[];
  beats: BeatTemplate[];
  profile: FormatProductionProfile;
}): { skeletonId?: string; beatId?: string } => {
  const fallbackSkeletonId = skeletons.find((item) => item.id === profile.defaultSkeletonId)?.id || skeletons[0]?.id;
  const fallbackBeatId = beats.find((item) => item.id === profile.defaultBeatId)?.id || beats[0]?.id;
  const projectText = buildEpisodeTemplateProjectText(project);

  if (!projectText) {
    return { skeletonId: fallbackSkeletonId, beatId: fallbackBeatId };
  }

  const rankedSkeletons = skeletons
    .map((template) => ({ template, score: scoreTemplateTopicFit(projectText, template) }))
    .sort((a, b) => b.score - a.score);
  const bestSkeleton = rankedSkeletons[0];

  return {
    skeletonId: bestSkeleton && bestSkeleton.score >= 10 ? bestSkeleton.template.id : fallbackSkeletonId,
    beatId: fallbackBeatId,
  };
};
