/**
 * Interactive Graph AI Context Builders
 * Current architecture and boundaries: doc/design.md.
 */

import {
  ExperienceSpec,
  StoryArchitecture,
  NarrativeGraphVersion,
  StateSchema,
  ProductionBoundary,
  NarrativeNode,
  normalizeNarrativeGraph,
  normalizeStoryArchitecture,
  getFactDefinitions,
  getInitialFactIds,
} from '../types/schema';
import { InteractiveWritingPort, InteractiveWritingSceneOption } from '../ports/writingPort';

export interface AuthoringExperienceContext {
  playerRole: string;
  playerPersona: string;
  interactionPromise: string;
  genre: string;
  theme: string;
  centralConflict: string;
  choiceCadence: {
    targetChoicesPerTenMinutes: number;
    maxMinutesWithoutChoice: number;
  };
  failStatePolicy: string;
}

export function buildExperienceContext(spec?: ExperienceSpec): AuthoringExperienceContext {
  return {
    playerRole: spec?.playerRole || 'unknown',
    playerPersona: spec?.playerPersona || 'unknown',
    interactionPromise: spec?.interactionPromise || 'unknown',
    genre: spec?.dramaticContract?.genre || 'unknown',
    theme: spec?.dramaticContract?.theme || 'unknown',
    centralConflict: spec?.dramaticContract?.centralConflict || 'unknown',
    choiceCadence: {
      targetChoicesPerTenMinutes: spec?.choiceCadence?.targetChoicesPerTenMinutes ?? 3,
      maxMinutesWithoutChoice: spec?.choiceCadence?.maxMinutesWithoutChoice ?? 5,
    },
    failStatePolicy: spec?.failStatePolicy || 'retry',
  };
}

export interface AuthoringStoryArchitectureContext {
  premise: string;
  protagonistGoal: string;
  thematicQuestion: string;
  storyEpisodes: Array<{
    id: string;
    title: string;
    order: number;
  }>;
  storyChapters: Array<{
    id: string;
    title: string;
    summary: string;
    order: number;
    episodeId?: string;
  }>;
  storyBeats: Array<{
    id: string;
    title: string;
    dramaticPurpose: string;
    kind: string;
  }>;
  endings: Array<{
    id: string;
    title: string;
    promise: string;
  }>;
  maxDepth: number;
  maxParallelBranches: number;
}

export function buildStoryArchitectureContext(arch?: StoryArchitecture): AuthoringStoryArchitectureContext {
  const normalized = arch ? normalizeStoryArchitecture(arch) : undefined;
  return {
    premise: normalized?.premise || 'unknown',
    protagonistGoal: normalized?.protagonistGoal || 'unknown',
    thematicQuestion: normalized?.thematicQuestion || 'unknown',
    storyEpisodes: (normalized?.storyEpisodes || []).map((episode) => ({
      id: episode.id,
      title: episode.title,
      order: episode.order,
    })),
    storyChapters: (normalized?.storyChapters || []).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      summary: chapter.summary,
      order: chapter.order,
      episodeId: chapter.episodeId,
    })),
    storyBeats: (normalized?.storyBeats || []).map((beat) => ({
      id: beat.id,
      title: beat.title,
      dramaticPurpose: beat.dramaticPurpose,
      kind: beat.kind,
    })),
    endings: (normalized?.endingContracts || normalized?.endings || []).map((e) => ({
      id: e.id,
      title: e.title,
      promise: 'promise' in e ? e.promise : (e as { description: string }).description,
    })),
    maxDepth: normalized?.branchBudget?.maxDepth ?? 5,
    maxParallelBranches: normalized?.branchBudget?.maxParallelBranches ?? 3,
  };
}

export interface AuthoringWritingSummaryContext {
  writingProjectId?: string;
  sceneSummaries: Array<{
    refChecksum: string;
    unitTitle: string;
    sceneTitle: string;
    synopsis: string;
    characters: string[];
    targetDurationSeconds: number;
  }>;
}

export function buildWritingSummaryContext(
  writingProjectId?: string,
  writingPort?: InteractiveWritingPort
): AuthoringWritingSummaryContext {
  if (!writingProjectId || !writingPort) {
    return { sceneSummaries: [] };
  }

  const scenes: InteractiveWritingSceneOption[] = writingPort.listScenes(writingProjectId);
  return {
    writingProjectId,
    sceneSummaries: scenes.map((s) => ({
      refChecksum: s.ref.checksum,
      unitTitle: s.unitTitle,
      sceneTitle: s.sceneTitle,
      synopsis: s.synopsis,
      characters: s.characters,
      targetDurationSeconds: s.targetDurationSeconds ?? 60,
    })),
  };
}

export interface AuthoringSelectedNodePathContext {
  nodeId: string;
  nodeBrief?: { title: string; intent: string; dramaticFunction: string };
  inboundTransitions: Array<{ sourceNodeId: string; choiceText: string }>;
  outboundTransitions: Array<{ targetNodeId: string; choiceText: string }>;
  candidateDownstreamNodes: Array<{ id: string; title: string }>;
}

export function buildSelectedNodePathContext(
  graph: NarrativeGraphVersion,
  selectedNodeId: string
): AuthoringSelectedNodePathContext {
  const norm = normalizeNarrativeGraph(graph);
  const targetNode = norm.nodes.find((n) => n.id === selectedNodeId);

  const inboundTransitions: Array<{ sourceNodeId: string; choiceText: string }> = [];
  const outboundTransitions: Array<{ targetNodeId: string; choiceText: string }> = [];

  const transitions = norm.transitions || [];
  transitions.forEach((t) => {
    if (t.targetNodeId === selectedNodeId) {
      inboundTransitions.push({ sourceNodeId: t.sourceNodeId, choiceText: t.text });
    }
    if (t.sourceNodeId === selectedNodeId) {
      outboundTransitions.push({ targetNodeId: t.targetNodeId, choiceText: t.text });
    }
  });

  norm.nodes.forEach((n) => {
    n.choices.forEach((c) => {
      if (c.targetNodeId === selectedNodeId) {
        inboundTransitions.push({ sourceNodeId: n.id, choiceText: c.text });
      }
      if (n.id === selectedNodeId) {
        outboundTransitions.push({ targetNodeId: c.targetNodeId, choiceText: c.text });
      }
    });
  });

  const candidateDownstreamNodes = norm.nodes
    .filter((n) => n.id !== selectedNodeId)
    .map((n) => ({ id: n.id, title: n.brief.title }));

  return {
    nodeId: selectedNodeId,
    nodeBrief: targetNode
      ? { title: targetNode.brief.title, intent: targetNode.brief.intent, dramaticFunction: targetNode.brief.dramaticFunction }
      : undefined,
    inboundTransitions,
    outboundTransitions,
    candidateDownstreamNodes,
  };
}

export interface AuthoringStateLanguageContext {
  variables: Array<{ key: string; type: string; defaultValue: boolean | number | string }>;
  factDefinitions: string[];
  initialFactIds: string[];
}

export function buildStateLanguageContext(schema?: StateSchema): AuthoringStateLanguageContext {
  return {
    variables: (schema?.variables || []).map((v) => ({ key: v.key, type: v.type, defaultValue: v.defaultValue })),
    factDefinitions: getFactDefinitions(schema),
    initialFactIds: getInitialFactIds(schema),
  };
}

export interface AuthoringCostContext {
  p50CurrentSec: number;
  p90CurrentSec: number;
  uniqueMediaEstimateSec: number;
  maxBranchDepth: number;
  maxParallelBranches: number;
}

export function buildCostContext(
  graph: NarrativeGraphVersion,
  boundary?: ProductionBoundary
): AuthoringCostContext {
  const norm = normalizeNarrativeGraph(graph);
  const nodeCount = norm.nodes.length;
  // Estimate ~45s per node
  const estimatedDuration = nodeCount * 45;

  return {
    p50CurrentSec: estimatedDuration,
    p90CurrentSec: Math.round(estimatedDuration * 1.3),
    uniqueMediaEstimateSec: nodeCount * 30,
    maxBranchDepth: boundary?.maxBranchDepth ?? 5,
    maxParallelBranches: boundary?.maxParallelBranches ?? 3,
  };
}
