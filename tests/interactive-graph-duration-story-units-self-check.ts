import assert from 'node:assert/strict';

import { summarizeInteractiveGraphDuration } from '../src/domains/interactive/analysis/graphDurationSummary.ts';
import { buildInteractiveStoryUnits } from '../src/domains/interactive/structure/storyUnits.ts';
import type {
  NarrativeGraphVersion,
  NarrativeNode,
  StoryArchitecture,
} from '../src/domains/interactive/types/schema.ts';

const node = (
  id: string,
  durationRangeSec: [number, number],
  targets: string[],
  storyBeatId: string,
  ending = false,
): NarrativeNode => ({
  id,
  brief: {
    nodeId: id,
    title: id,
    intent: id,
    dramaticFunction: ending ? 'ending' : targets.length > 1 ? 'choice_point' : 'exposition',
    narrativeSummary: id,
  },
  contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
  storyBeatIds: [storyBeatId],
  interaction: {
    capabilities: ending ? ['play_content', 'terminal'] : ['play_content', 'present_choice'],
    contentPolicy: 'create_shared_content',
    durationRangeSec,
    playerKnowledgeIn: [],
    playerKnowledgeOut: [],
  },
  choices: targets.map((targetNodeId, index) => ({
    id: `${id}_${index}`,
    text: targetNodeId,
    intent: targetNodeId,
    targetNodeId,
    effects: [],
  })),
});

const graph = {
  id: 'graph',
  experienceId: 'experience',
  versionIndex: 1,
  entryNodeId: 'start',
  locked: false,
  nodes: [
    node('start', [120, 180], ['left', 'right'], 'beat_start'),
    node('left', [240, 300], ['ending'], 'beat_left'),
    node('right', [360, 420], ['ending'], 'beat_right'),
    node('ending', [60, 90], [], 'beat_ending', true),
  ],
  createdAt: new Date(0).toISOString(),
} satisfies NarrativeGraphVersion;

const summary = summarizeInteractiveGraphDuration(graph);
assert.equal(summary.completedPaths.length, 2);
assert.deepEqual(summary.shortestPath?.durationRangeSec, [420, 570]);
assert.deepEqual(summary.longestPath?.durationRangeSec, [540, 690]);
assert.deepEqual(summary.reachableUniqueRangeSec, [780, 990]);
assert.equal(summary.typicalPath?.choicePointCount, 1);
const contentDurationSummary = summarizeInteractiveGraphDuration(graph, (currentNode) => ({
  start: [400, 400],
  left: [400, 400],
  right: [120, 120],
  ending: [400, 400],
}[currentNode.id] as [number, number] | undefined));
assert.deepEqual(
  contentDurationSummary.shortestPath?.durationRangeSec,
  [920, 920],
  "bound story-scene durations must override early graph estimates",
);
assert.deepEqual(contentDurationSummary.longestPath?.durationRangeSec, [1200, 1200]);
assert.deepEqual(contentDurationSummary.reachableUniqueRangeSec, [1320, 1320]);

const architecture = {
  premise: 'test',
  protagonistGoal: '',
  thematicQuestion: '',
  mandatoryNodes: [],
  variableNodes: [],
  endings: [],
  branchBudget: { maxDepth: 4, maxParallelBranches: 2 },
  storyBeats: [],
  endingContracts: [],
  storyChapters: [
    {
      id: 'story-chapter-one',
      title: '第一章',
      summary: '入口与左侧路径',
      storyBeatIds: ['beat_start', 'beat_left'],
      targetDurationRangeSec: [360, 480],
      order: 1,
    },
    {
      id: 'story-chapter-two',
      title: '第二章',
      summary: '右侧路径与结局',
      storyBeatIds: ['beat_right', 'beat_ending'],
      targetDurationRangeSec: [420, 510],
      order: 2,
    },
  ],
  productionBlocks: [
    {
      id: 'production-a',
      title: '夜景集中制作',
      storyBeatIds: ['beat_start', 'beat_right'],
      targetDurationRangeSec: [480, 600],
      status: 'draft',
    },
    {
      id: 'production-b',
      title: '结局与补拍',
      storyBeatIds: ['beat_left', 'beat_ending'],
      targetDurationRangeSec: [300, 390],
      status: 'draft',
    },
  ],
} satisfies StoryArchitecture;

const units = buildInteractiveStoryUnits(architecture, graph);
assert.deepEqual(units.map((unit) => unit.title), ['第一章', '第二章']);
assert.deepEqual(units[0].nodeIds, ['start', 'left']);
assert.deepEqual(units[1].nodeIds, ['right', 'ending']);
assert.equal(units.some((unit) => unit.title === '夜景集中制作'), false);

console.log('Interactive graph duration and story unit self-check passed.');
