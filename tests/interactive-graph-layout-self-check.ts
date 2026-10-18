import { interactiveRepository } from '../src/server/interactiveRepository.ts';
import { db } from '../src/server/db.ts';
import { buildStoryFlowPositions } from '../src/domains/interactive/layout/graphAutoLayout.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

console.log('[Interactive Graph Layout Self-Check] Verifying layout/version separation...');
const aggregate = interactiveRepository.createExperience({
  title: '画布布局版本测试',
  genre: '悬疑',
  formatProfile: {
    format: 'branching_fmv', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN',
    targetSessionMinutes: 20, targetCompleteMinutes: 30,
  },
  experienceSpec: {
    playerRole: '调查者', playerPersona: '观察者', interactionPromise: '选择改变调查方向。', coreVerbs: ['调查'],
    dramaticContract: { genre: '悬疑', theme: '真相', centralConflict: '公开或隐瞒' },
    choiceCadence: { targetChoicesPerTenMinutes: 3, maxMinutesWithoutChoice: 4 },
    consequenceHorizon: ['immediate'], failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
    accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true },
  },
  storyArchitecture: {
    premise: '一段录音', protagonistGoal: '找到真相', thematicQuestion: '何时公开真相',
    mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 2, maxParallelBranches: 2 },
  },
  storySource: { mode: 'scratch' },
  productionBoundary: { maxBranchDepth: 2, maxParallelBranches: 2, exclusiveContentPercent: 30, maxAutomaticRepairAttempts: 2 },
});

try {
  const initial = interactiveRepository.getGraphLayout(aggregate.experience.id);
  assert(initial.versionIndex === 1 && Object.keys(initial.nodes).length === 0, 'New experiences must initialize an empty layout revision');
  const graphVersionBeforeMove = interactiveRepository.getExperience(aggregate.experience.id).graph.versionIndex;
  const saved = interactiveRepository.saveGraphLayout(
    aggregate.experience.id,
    { ...initial, nodes: { entry: { x: 320, y: 180 } }, viewport: { x: 0, y: 0, zoom: 1 } },
    initial.versionIndex,
  );
  assert(saved.versionIndex === 2 && saved.nodes.entry.x === 320, 'Canvas movement must create an independently versioned layout');
  const reloadedSecond = interactiveRepository.getGraphLayout(aggregate.experience.id);
  assert(reloadedSecond.versionIndex === 2 && reloadedSecond.id === saved.id,
    'A full revision payload must reload at the new authoritative version');
  const fullRevision = interactiveRepository.saveGraphLayout(
    aggregate.experience.id,
    { ...reloadedSecond, nodes: { ...reloadedSecond.nodes, second: { x: 500, y: 220 } } },
    reloadedSecond.versionIndex,
  );
  assert(fullRevision.versionIndex === 3, 'A full revision payload must not override the new row version');
  const reloadedRevision = interactiveRepository.getGraphLayout(aggregate.experience.id);
  assert(reloadedRevision.versionIndex === 3 && reloadedRevision.nodes.second.x === 500,
    'Reload must use the authoritative row version after a full revision payload');
  const currentRow = db.prepare('SELECT data FROM interactive_graph_layout_versions WHERE id = ?')
    .get(reloadedRevision.id) as { data: string };
  db.prepare('UPDATE interactive_graph_layout_versions SET data = ? WHERE id = ?').run(
    JSON.stringify({ ...JSON.parse(currentRow.data), id: 'stale-id', versionIndex: 1, experienceId: 'other-experience' }),
    reloadedRevision.id,
  );
  const formerlyPolluted = interactiveRepository.getGraphLayout(aggregate.experience.id);
  assert(formerlyPolluted.id === reloadedRevision.id && formerlyPolluted.versionIndex === 3
    && formerlyPolluted.experienceId === aggregate.experience.id,
  'Legacy polluted JSON metadata must never override the layout row identity or version');
  const afterPollution = interactiveRepository.saveGraphLayout(
    aggregate.experience.id,
    { ...formerlyPolluted, nodes: { ...formerlyPolluted.nodes, third: { x: 800, y: 260 } } },
    formerlyPolluted.versionIndex,
  );
  assert(afterPollution.versionIndex === 4 && interactiveRepository.getGraphLayout(aggregate.experience.id).versionIndex === 4,
    'Reloaded revision must remain usable for the next CAS write');
  assert(
    interactiveRepository.getExperience(aggregate.experience.id).graph.versionIndex === graphVersionBeforeMove,
    'Canvas movement must not create a semantic graph revision or stale runtime work',
  );
  let staleWriteRejected = false;
  try {
    interactiveRepository.saveGraphLayout(aggregate.experience.id, { nodes: {} }, initial.versionIndex);
  } catch (error) {
    staleWriteRejected = (error as { statusCode?: number }).statusCode === 409;
  }
  assert(staleWriteRejected, 'Concurrent layout writes must use compare-and-swap rather than silently overwrite');
  const positions = buildStoryFlowPositions({
    ...aggregate.graph,
    entryNodeId: 'start',
    nodes: [
      { id: 'start', brief: { nodeId: 'start', title: 'Start', intent: 'Start', dramaticFunction: 'choice_point', narrativeSummary: 'Start' }, contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [] },
      { id: 'left', brief: { nodeId: 'left', title: 'Left', intent: 'Left', dramaticFunction: 'ending', narrativeSummary: 'Left' }, contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [] },
      { id: 'right', brief: { nodeId: 'right', title: 'Right', intent: 'Right', dramaticFunction: 'ending', narrativeSummary: 'Right' }, contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [] },
    ],
    transitions: [
      { id: 'to-left', sourceNodeId: 'start', targetNodeId: 'left', text: 'Left', intent: 'Left', effects: [] },
      { id: 'to-right', sourceNodeId: 'start', targetNodeId: 'right', text: 'Right', intent: 'Right', effects: [] },
    ],
  });
  assert(positions.start.x < positions.left.x && positions.left.x === positions.right.x, 'Auto layout must place choices in story-flow layers');
  assert(positions.left.y !== positions.right.y, 'Sibling branches must not overlap vertically');
  const legacyChoicePositions = buildStoryFlowPositions({
    ...aggregate.graph,
    entryNodeId: 'legacy-start',
    transitions: [],
    nodes: [
      {
        id: 'legacy-start',
        brief: { nodeId: 'legacy-start', title: 'Start', intent: 'Start', dramaticFunction: 'choice_point', narrativeSummary: 'Start' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [{ id: 'legacy-choice', text: 'Continue', intent: 'Continue', targetNodeId: 'legacy-end', effects: [] }],
      },
      {
        id: 'legacy-end',
        brief: { nodeId: 'legacy-end', title: 'End', intent: 'End', dramaticFunction: 'ending', narrativeSummary: 'End' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [],
      },
    ],
  });
  assert(
    legacyChoicePositions['legacy-start'].x < legacyChoicePositions['legacy-end'].x,
    'Saved graphs that still store choices on nodes must retain forward auto-layout',
  );
} finally {
  interactiveRepository.deleteExperience(aggregate.experience.id);
}

console.log('[Interactive Graph Layout Self-Check] PASSED.');
