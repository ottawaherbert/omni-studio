import type {
  NarrativeNode,
  NarrativeGraphVersion,
  StoryArchitecture,
} from '../types/schema.ts';
import { normalizeStoryArchitecture } from '../types/schema.ts';

export interface InteractiveStoryUnit {
  id: string;
  title: string;
  summary: string;
  nodeIds: string[];
  targetDurationRangeSec: [number, number];
  order: number;
  episodeId?: string;
  episodeTitle?: string;
  episodeOrder?: number;
  scriptSceneCount?: number;
}

export const buildInteractiveStoryUnits = (
  architecture: StoryArchitecture | null,
  graph: NarrativeGraphVersion | null,
): InteractiveStoryUnit[] => {
  if (!architecture || !graph) return [];
  const normalized = normalizeStoryArchitecture(architecture);
  const chapters = normalized.storyChapters || [];
  if (!chapters.length) return [];
  const episodeById = new Map((normalized.storyEpisodes || []).map((episode) => [episode.id, episode]));

  const units: InteractiveStoryUnit[] = chapters.map((chapter) => {
    const beatIds = new Set(chapter.storyBeatIds);
    const episode = chapter.episodeId ? episodeById.get(chapter.episodeId) : undefined;
    return {
      id: chapter.id,
      title: chapter.title || '未命名章节',
      summary: chapter.summary || '',
      nodeIds: graph.nodes
        .filter((node) => (node.storyBeatIds || []).some((beatId) => beatIds.has(beatId)))
        .map((node) => node.id),
      targetDurationRangeSec: chapter.targetDurationRangeSec,
      order: chapter.order,
      episodeId: episode?.id,
      episodeTitle: episode?.title,
      episodeOrder: episode?.order,
    };
  })
    .filter((unit) => unit.nodeIds.length > 0)
    .sort((left, right) => (
      (left.episodeOrder || 0) - (right.episodeOrder || 0)
      || left.order - right.order
    ));

  const assigned = new Set(units.flatMap((unit) => unit.nodeIds));
  const unassigned = graph.nodes
    .filter((node) => !assigned.has(node.id))
    .map((node) => node.id);
  if (unassigned.length) {
    units.push({
      id: 'unassigned',
      title: '待归入章节',
      summary: '这些节点尚未归入正式故事章节。',
      nodeIds: unassigned,
      targetDurationRangeSec: [0, 0],
      order: units.length + 1,
    });
  }
  return units;
};

export interface InteractiveStoryPlacement {
  storyChapterId?: string;
  storyChapterTitle?: string;
  storyChapterOrder?: number;
  storyEpisodeId?: string;
  storyEpisodeTitle?: string;
  storyEpisodeOrder?: number;
}

export const storyPlacementForNode = (
  architecture: StoryArchitecture | null | undefined,
  node: Pick<NarrativeNode, 'storyBeatIds'>,
): InteractiveStoryPlacement => {
  if (!architecture) return {};
  const normalized = normalizeStoryArchitecture(architecture);
  const beatIds = new Set(node.storyBeatIds || []);
  const chapter = (normalized.storyChapters || []).find((item) =>
    item.storyBeatIds.some((beatId) => beatIds.has(beatId)),
  );
  if (!chapter) return {};
  const episode = chapter.episodeId
    ? (normalized.storyEpisodes || []).find((item) => item.id === chapter.episodeId)
    : undefined;
  return {
    storyChapterId: chapter.id,
    storyChapterTitle: chapter.title,
    storyChapterOrder: chapter.order,
    storyEpisodeId: episode?.id,
    storyEpisodeTitle: episode?.title,
    storyEpisodeOrder: episode?.order,
  };
};
