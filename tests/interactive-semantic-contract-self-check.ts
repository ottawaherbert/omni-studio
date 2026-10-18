import { validateNarrativeGraph } from '../src/domains/interactive/validation/domainValidation.ts';
import { graphForPersistence } from '../src/domains/interactive/types/schema.ts';
import { interactiveRepository } from '../src/server/interactiveRepository.ts';
import type { NarrativeGraphVersion, StateSchema, StoryArchitecture } from '../src/domains/interactive/types/schema.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const schema: StateSchema = { variables: [], factDefinitions: [], initialFactIds: [] };

const graph: Pick<NarrativeGraphVersion, 'semanticContractVersion' | 'entryNodeId' | 'nodes'> = {
  semanticContractVersion: 2,
  entryNodeId: 'entry',
  nodes: [
    {
      id: 'entry',
      brief: { nodeId: 'entry', title: '调查入口', intent: '进入封锁车站追查广播', dramaticFunction: 'choice_point', narrativeSummary: '广播仍在播放。' },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      bindings: [],
      storyBeatIds: ['beat_entry'],
      interaction: {
        capabilities: ['play_content', 'present_choice'],
        contentPolicy: 'create_shared_content',
        durationRangeSec: [45, 75],
        playerKnowledgeIn: ['广播仍在播放'],
        playerKnowledgeOut: ['站台有人删除录音'],
      },
      choices: [{
        id: 'enter', text: '进入站台', intent: '冒险靠近广播源', effects: [], targetNodeId: 'ending',
        interaction: {
          playerKnowledge: '广播从站台方向传来，门还没有锁上。',
          immediateFeedback: '门锁响起，广播忽然切换成主角的童年录音。',
          consequenceHorizon: 'ending', thematicMeaning: '选择真相而不是自我保护。',
          convergenceStrategy: 'terminal', estimatedUniqueMediaSec: 12,
          replayValue: '解锁主角童年录音的另一段证词。',
        },
      }],
    },
    {
      id: 'ending',
      brief: { nodeId: 'ending', title: '公开录音', intent: '将录音向所有乘客公开', dramaticFunction: 'ending', narrativeSummary: '列车在公开广播中离站。' },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      bindings: [],
      storyBeatIds: ['beat_ending'],
      interaction: {
        capabilities: ['play_content', 'terminal'],
        contentPolicy: 'exclusive_branch_content',
        durationRangeSec: [30, 45],
        playerKnowledgeIn: ['站台有人删除录音'],
        playerKnowledgeOut: ['真相被公开'],
      },
      choices: [],
    },
  ],
};

console.log('[Interactive Semantic Contract Self-Check] Validating node and choice contracts...');
assert(validateNarrativeGraph(graph, schema).length === 0, 'A complete semantic graph should pass validation');
const persistedGraph = graphForPersistence(graph);
assert(persistedGraph.transitions?.length === 1, 'Semantic graph persistence must promote choices into canonical transitions');
assert(persistedGraph.nodes[0].choices.length === 0, 'Semantic graph persistence must not retain a second writable node-choice copy');
assert(!('bindings' in persistedGraph.nodes[0]), 'Semantic graph persistence must strip legacy node-local bindings; aggregate bindings are the only owner');

const missingChoiceContract = structuredClone(graph);
delete missingChoiceContract.nodes[0].choices[0].interaction;
assert(
  validateNarrativeGraph(missingChoiceContract, schema).some((issue) => issue.includes('玩家知情与后果合同')),
  'Version 2 graphs must reject choices without a player-facing contract',
);

const invalidEnding = structuredClone(graph);
invalidEnding.nodes[1].interaction!.capabilities = ['play_content'];
assert(
  validateNarrativeGraph(invalidEnding, schema).some((issue) => issue.includes('terminal')),
  'Ending nodes must declare terminal runtime capability',
);

const legacyGraph = structuredClone(graph);
delete legacyGraph.semanticContractVersion;
delete legacyGraph.nodes[0].interaction;
delete legacyGraph.nodes[0].choices[0].interaction;
delete legacyGraph.nodes[1].interaction;
assert(validateNarrativeGraph(legacyGraph, schema).length === 0, 'Legacy graph revisions remain readable without silent rewriting');

const aggregate = interactiveRepository.createExperience({
  title: '节点合同持久化测试',
  genre: '悬疑',
  formatProfile: { format: 'branching_fmv', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 20, targetCompleteMinutes: 30 },
  experienceSpec: {
    playerRole: '调查者', playerPersona: '谨慎的记者', interactionPromise: '选择影响真相公开方式。', coreVerbs: ['调查'],
    dramaticContract: { genre: '悬疑', theme: '真相', centralConflict: '公开或保护' },
    choiceCadence: { targetChoicesPerTenMinutes: 3, maxMinutesWithoutChoice: 4 }, consequenceHorizon: ['immediate', 'ending'], failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
    accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true },
  },
  storyArchitecture: { premise: '一段广播', protagonistGoal: '公开真相', thematicQuestion: '是否公开', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 2, maxParallelBranches: 2 } },
  storySource: { mode: 'scratch' },
  productionBoundary: { maxBranchDepth: 2, maxParallelBranches: 2, exclusiveContentPercent: 30, maxAutomaticRepairAttempts: 2 },
});
try {
  assert(aggregate.graph.semanticContractVersion === 2, 'New experiences must begin on the semantic contract graph revision');
  const approvedArchitecture: StoryArchitecture = {
    premise: '一段广播',
    protagonistGoal: '公开真相',
    thematicQuestion: '是否公开',
    mandatoryNodes: [],
    variableNodes: [],
    endings: [],
    branchBudget: { maxDepth: 2, maxParallelBranches: 2 },
    durationBudget: { p50TargetSec: 75, p90TargetSec: 75, maxSecondsWithoutChoice: 240, tolerancePercent: 15 },
    endingContracts: [{ id: 'ending_public', title: '公开录音', promise: '玩家承担公开录音的后果。', requiredBeatIds: ['beat_ending'] }],
    productionBlocks: [{ id: 'block_station', title: '车站公开段', storyBeatIds: ['beat_entry', 'beat_ending'], targetDurationRangeSec: [75, 75], status: 'draft' }],
    storyBeats: [
      { id: 'beat_entry', title: '进入站台', dramaticPurpose: '让玩家决定靠近广播源。', kind: 'mandatory', durationRangeSec: [45, 45], productionBlockId: 'block_station' },
      { id: 'beat_ending', title: '公开录音', dramaticPurpose: '兑现公开的代价。', kind: 'ending', durationRangeSec: [30, 30], productionBlockId: 'block_station', endingContractId: 'ending_public' },
    ],
  };
  interactiveRepository.saveStoryArchitecture(aggregate.experience.id, approvedArchitecture, 'approved');
  const saved = interactiveRepository.saveGraph(aggregate.experience.id, graph, 'draft');
  assert(!saved.graph.locked && saved.graph.semanticContractVersion === 2, 'A saved graph revision must preserve its semantic contract without a lock step');
  assert(saved.graph.transitions?.[0]?.sourceNodeId === 'entry', 'Returned graph must expose the canonical transition owner');
  assert(saved.graph.nodes[0].choices.length === 1, 'Runtime/UI graph must receive derived node choices from canonical transitions');
  assert(!('bindings' in saved.graph.nodes[0]), 'Read graph must not revive a second node-local binding owner');
  let rejectedStaleSave = false;
  try {
    interactiveRepository.saveGraph(aggregate.experience.id, graph, 'draft', aggregate.graph.versionIndex);
  } catch (error) {
    rejectedStaleSave = (error as { statusCode?: number }).statusCode === 409;
  }
  assert(rejectedStaleSave, 'A stale graph revision must be rejected instead of silently overwriting a newer graph');
} finally {
  interactiveRepository.deleteExperience(aggregate.experience.id);
}
console.log('[Interactive Semantic Contract Self-Check] PASSED.');
