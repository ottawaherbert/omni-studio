import { db } from '../src/server/db.ts';
import { interactiveRepository } from '../src/server/interactiveRepository.ts';
import {
  auditStoryArchitectureBudgetFit,
  summarizeStoryArchitectureBudget,
  validateStoryArchitecture,
  validateStoryArchitectureDraft,
} from '../src/domains/interactive/validation/storyArchitectureValidation.ts';
import type { NarrativeNode, StoryArchitecture } from '../src/domains/interactive/types/schema.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const makeArchitecture = (): StoryArchitecture => ({
  premise: '玩家在封锁的车站追查一段被掩盖的广播。',
  protagonistGoal: '在列车离站前确认真相，并决定是否公开它。',
  thematicQuestion: '当真相会伤害无辜者时，公开是否仍是勇敢？',
  mandatoryNodes: [],
  variableNodes: [],
  endings: [],
  branchBudget: { maxDepth: 3, maxParallelBranches: 2 },
  durationBudget: {
    p50TargetSec: 600,
    p90TargetSec: 600,
    maxSecondsWithoutChoice: 240,
    tolerancePercent: 15,
  },
  endingContracts: [{
    id: 'ending_truth',
    title: '公开真相',
    promise: '玩家亲手承担公开真相后造成的关系代价。',
    requiredBeatIds: ['beat_reveal'],
  }],
  productionBlocks: [{
    id: 'block_station',
    title: '车站调查段',
    storyBeatIds: ['beat_arrival', 'beat_reveal'],
    targetDurationRangeSec: [600, 900],
    status: 'approved',
  }],
  storyBeats: [
    {
      id: 'beat_arrival',
      title: '抵达封锁车站',
      dramaticPurpose: '让玩家理解时间压力与调查对象的敌意。',
      kind: 'mandatory',
      durationRangeSec: [240, 360],
      productionBlockId: 'block_station',
    },
    {
      id: 'beat_reveal',
      title: '频率揭露',
      dramaticPurpose: '让玩家选择公开真相或保护证人。',
      kind: 'ending',
      durationRangeSec: [360, 540],
      productionBlockId: 'block_station',
      endingContractId: 'ending_truth',
    },
  ],
});

function runStoryArchitectureSelfCheck() {
  console.log('[Interactive Story Architecture Self-Check] Verifying architecture, target duration and Production Block contracts...');
  const architecture = makeArchitecture();
  assert(JSON.stringify(validateStoryArchitecture(architecture)) === '[]', 'A complete architecture should pass structural validation');
  const summary = summarizeStoryArchitectureBudget(architecture);
  assert(JSON.stringify(summary.mandatoryDurationRangeSec) === JSON.stringify([240, 360]), 'Mandatory duration must be calculated from beats, not node counts');
  assert(JSON.stringify(summary.plannedDurationRangeSec) === JSON.stringify([600, 900]), 'Planned duration must include mandatory, variable and ending beats rather than only the mandatory spine');
  assert(auditStoryArchitectureBudgetFit(architecture).blocking.length === 0, 'A feasible architecture must satisfy P50 and local Production Block duration feasibility');

  const impossibleDuration = structuredClone(architecture);
  impossibleDuration.durationBudget!.p50TargetSec = 1800;
  assert(
    validateStoryArchitecture(impossibleDuration).some((issue) => issue.includes('无法覆盖 P50 目标下限')),
    'Architecture approval must reject a P50 promise that all planned story beats cannot possibly satisfy',
  );

  const invalid = structuredClone(architecture);
  invalid.storyBeats![0].productionBlockId = 'missing_block';
  assert(
    validateStoryArchitecture(invalid).some((issue) => issue.includes('不存在的 Production Block')),
    'A beat cannot silently point at a non-existent Production Block',
  );

  const incompleteDraft: StoryArchitecture = {
    ...architecture,
    storyBeats: [{
      id: 'beat_incomplete',
      title: '',
      dramaticPurpose: '',
      kind: 'mandatory',
      durationRangeSec: [60, 120],
    }],
    endingContracts: [],
    productionBlocks: [],
  };
  assert(
    validateStoryArchitectureDraft(incompleteDraft).length === 0,
    'A creative draft may be incomplete while retaining stable identities and references',
  );
  assert(
    validateStoryArchitecture(incompleteDraft).some((issue) => issue.includes('每个 StoryBeat 都必须')),
    'Approval validation must still reject an incomplete creative draft',
  );

  const aggregate = interactiveRepository.createExperience({
    title: '架构目标时长测试',
    genre: '悬疑',
    formatProfile: { format: 'branching_fmv', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 30, targetCompleteMinutes: 50 },
    experienceSpec: {
      playerRole: '调查者', playerPersona: '谨慎的旁观者', interactionPromise: '选择会改变真相的公开方式。', coreVerbs: ['调查'],
      dramaticContract: { genre: '悬疑', theme: '真相', centralConflict: '公开或保护' },
      choiceCadence: { targetChoicesPerTenMinutes: 3, maxMinutesWithoutChoice: 4 }, consequenceHorizon: ['immediate'], failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
      accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true },
    },
    storyArchitecture: { ...architecture, productionBlocks: architecture.productionBlocks!.map((block) => ({ ...block, status: 'draft' })) },
    storySource: { mode: 'scratch' },
    productionBoundary: { maxBranchDepth: 3, maxParallelBranches: 2, exclusiveContentPercent: 30, maxAutomaticRepairAttempts: 2 },
  });
  try {
    const incompleteSaved = interactiveRepository.saveStoryArchitecture(aggregate.experience.id, incompleteDraft, 'draft');
    assert(incompleteSaved.storyArchitecture.status === 'draft', 'Incomplete architecture must be saveable as a draft');
    let incompleteApprovalRejected = false;
    try {
      interactiveRepository.saveStoryArchitecture(aggregate.experience.id, incompleteDraft, 'approved');
    } catch (error: any) {
      incompleteApprovalRejected = error?.statusCode === 422;
    }
    assert(incompleteApprovalRejected, 'Incomplete architecture must not be approvable');
    const saved = interactiveRepository.saveStoryArchitecture(aggregate.experience.id, architecture, 'approved');
    assert(saved.storyArchitecture.versionIndex === 3, 'Saving architecture creates an immutable version after the draft');
    assert(saved.storyArchitecture.status === 'approved', 'Approved architecture version must retain approval state');
    assert(saved.storyArchitecture.data.productionBlocks?.[0].status === 'approved', 'Production Block approval is persisted with its architecture version');
    assert(interactiveRepository.listStoryArchitectureVersions(aggregate.experience.id).length === 3, 'Architecture history must expose every version for review and diff');
    const entryId = 'node_entry';
    const endingId = 'node_ending';
    const graphNodes: NarrativeNode[] = [
      {
        id: entryId,
        brief: { nodeId: entryId, title: '抵达', intent: '进入封锁车站', dramaticFunction: 'exposition' as const, narrativeSummary: '调查开始。' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        interaction: {
          capabilities: ['play_content', 'present_choice'],
          contentPolicy: 'create_shared_content',
          durationRangeSec: [240, 240],
          playerKnowledgeIn: [],
          playerKnowledgeOut: [],
        },
        bindings: [],
        choices: [{ id: 'choice_continue', text: '进入车站', intent: '开始调查', effects: [], targetNodeId: endingId }],
      },
      {
        id: endingId,
        brief: { nodeId: endingId, title: '公开', intent: '公开广播', dramaticFunction: 'ending' as const, narrativeSummary: '承担公开后果。' },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        interaction: {
          capabilities: ['play_content', 'terminal'],
          contentPolicy: 'exclusive_branch_content',
          durationRangeSec: [360, 360],
          playerKnowledgeIn: [],
          playerKnowledgeOut: [],
        },
        bindings: [],
        choices: [],
      },
    ];
    const mappedGraph = interactiveRepository.saveGraph(aggregate.experience.id, {
      entryNodeId: entryId,
      nodes: [
        { ...graphNodes[0], storyBeatIds: ['beat_arrival'] },
        { ...graphNodes[1], storyBeatIds: ['beat_reveal'] },
      ],
    }, 'draft');
    assert(!mappedGraph.graph.locked, 'Graph edits stay as revisions even after StoryBeat mapping is complete');
  } finally {
    interactiveRepository.deleteExperience(aggregate.experience.id);
  }
  console.log('[Interactive Story Architecture Self-Check] PASSED.');
}

runStoryArchitectureSelfCheck();
