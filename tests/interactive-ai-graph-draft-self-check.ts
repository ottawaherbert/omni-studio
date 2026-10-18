/**
 * Interactive AI Graph Draft Self-Check
 * Current architecture and boundaries: doc/design.md.
 */

import assert from 'assert';
import { NarrativeGraphVersion } from '../src/domains/interactive/types/schema';
import { applyGraphPatch, GraphPatchError } from '../src/domains/interactive/authoring/graphDraftPatch';
import { diffNarrativeGraphs } from '../src/domains/interactive/authoring/graphDraftDiff';
import { validateDraftCas, canAdoptDraft } from '../src/domains/interactive/authoring/graphDraftValidation';
import { InteractiveGraphDraft } from '../src/domains/interactive/authoring/graphDraft';
import { adoptGraphDraft } from '../src/domains/interactive/authoring/graphDraftAdoption';
import { auditNarrativeGraph } from '../src/domains/interactive/qa/graphQAEngine';
import { InteractiveGraphAuthoringService } from '../src/services/interactive/interactiveGraphAuthoringService';

const createBaseGraph = (): NarrativeGraphVersion => ({
  id: 'graph-v1',
  experienceId: 'exp-1',
  versionIndex: 1,
  entryNodeId: 'node-start',
  locked: false,
  semanticContractVersion: 2,
  createdAt: '2026-07-25T00:00:00Z',
  nodes: [
    {
      id: 'node-start',
      brief: {
        nodeId: 'node-start',
        title: 'Start',
        intent: 'Beginning of story',
        dramaticFunction: 'exposition',
        narrativeSummary: 'The story starts here',
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      choices: [
        {
          id: 'choice-1',
          text: 'Go forward',
          intent: 'Move forward',
          targetNodeId: 'node-end',
          effects: [],
        },
      ],
    },
    {
      id: 'node-end',
      brief: {
        nodeId: 'node-end',
        title: 'End',
        intent: 'Ending of story',
        dramaticFunction: 'ending',
        narrativeSummary: 'The story ends',
      },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
      choices: [],
    },
  ],
  transitions: [
    {
      id: 'choice-1',
      sourceNodeId: 'node-start',
      targetNodeId: 'node-end',
      text: 'Go forward',
      intent: 'Move forward',
      effects: [],
    },
  ],
});

async function runTests() {
  console.log('[Interactive AI Graph Draft Self-Check] Starting tests...');

  // DRAFT-TEST-001: Patch add/update/remove operations
  const base = createBaseGraph();
  const preservedBase: NarrativeGraphVersion = {
    ...base, semanticContractVersion: undefined,
    nodes: base.nodes.map((node) => ({ ...node, storyBeatIds: [`beat-${node.id}`] })),
  };
  let patchPrompt = '';
  const briefPatchService = new InteractiveGraphAuthoringService(async (request) => {
    patchPrompt = request.prompt;
    return { summary: '仅润色开场', operations: [{ type: 'update_node_brief', nodeId: 'node-start', brief: { narrativeSummary: '广播催促上船，周淮的拇指停在发送键上。' } }] };
  });
  const briefDraft = await briefPatchService.generateDraft({
    action: 'revise', experienceId: 'exp-1', baseGraph: preservedBase,
    authorIntent: '只润色开场，保留所有结构和状态',
    stateSchema: { variables: [], factDefinitions: [], initialFactIds: [] },
    architecture: { premise: '码头', protagonistGoal: '作出选择', thematicQuestion: '是否公开', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 2, maxParallelBranches: 2 } },
  });
  assert.match(patchPrompt, /baseGraph/);
  assert.match(patchPrompt, /currentStateSchema/);
  assert.match(patchPrompt, /currentStoryArchitecture/);
  assert.deepStrictEqual(briefDraft.operations.map((operation) => operation.type), ['update_node_brief']);
  const patched = applyGraphPatch(preservedBase, briefDraft.operations);
  assert.deepStrictEqual(patched.nodes.map((node) => node.id), preservedBase.nodes.map((node) => node.id));
  assert.deepStrictEqual(patched.transitions, preservedBase.transitions);
  assert.deepStrictEqual(patched.nodes.map((node) => node.contract), preservedBase.nodes.map((node) => node.contract));
  assert.deepStrictEqual(patched.nodes.map((node) => node.storyBeatIds), preservedBase.nodes.map((node) => node.storyBeatIds));
  assert.equal(patched.nodes[0].brief.narrativeSummary, '广播催促上船，周淮的拇指停在发送键上。');
  assert.equal(briefDraft.proposedStateSchema?.variables.length, 0);
  assert.equal(briefDraft.proposedStoryArchitecture?.premise, '码头');
  let invalidPatchAttempts = 0;
  const invalidPatchService = new InteractiveGraphAuthoringService(async () => {
    invalidPatchAttempts += 1;
    return { summary: '非法操作', operations: [{ type: 'update_node_brief', nodeId: 'node-start', brief: { narrativeSummary: '恶意修改', storyBeatIds: ['wrong'] } }] };
  });
  await assert.rejects(invalidPatchService.generateDraft({
    action: 'revise', experienceId: 'exp-1', baseGraph: preservedBase, authorIntent: '润色开场',
  }), /不允许的字段 storyBeatIds/);
  assert.equal(invalidPatchAttempts, 3);
  const updated = applyGraphPatch(base, [
    {
      type: 'add_node',
      node: {
        id: 'node-middle',
        brief: {
          nodeId: 'node-middle',
          title: 'Middle',
          intent: 'Middle scene',
          dramaticFunction: 'choice_point',
          narrativeSummary: 'Middle decision',
        },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [],
      },
    },
    {
      type: 'add_transition',
      transition: {
        id: 'choice-2',
        sourceNodeId: 'node-start',
        targetNodeId: 'node-middle',
        text: 'Go to middle',
        intent: 'Side path',
        effects: [],
      },
    },
  ]);

  assert.strictEqual(updated.nodes.length, 3);
  assert.strictEqual(updated.nodes.some((n) => n.id === 'node-middle'), true);
  assert.strictEqual(updated.transitions?.some((t) => t.id === 'choice-2'), true);

  // DRAFT-TEST-002: Invalid target node blocks patch execution
  assert.throws(() => {
    applyGraphPatch(base, [
      {
        type: 'add_transition',
        transition: {
          id: 'choice-invalid',
          sourceNodeId: 'node-start',
          targetNodeId: 'non-existent-node',
          text: 'Invalid link',
          intent: 'Break graph',
          effects: [],
        },
      },
    ]);
  }, GraphPatchError);

  // DRAFT-TEST-003: ID stability
  const updatedBrief = applyGraphPatch(base, [
    {
      type: 'update_node_brief',
      nodeId: 'node-start',
      brief: {
        nodeId: 'node-start',
        title: 'Start (Updated)',
        intent: 'Updated intent',
        dramaticFunction: 'exposition',
        narrativeSummary: 'Updated summary',
      },
    },
  ]);
  assert.strictEqual(updatedBrief.nodes[0].id, 'node-start');
  assert.strictEqual(updatedBrief.nodes[0].brief.title, 'Start (Updated)');
  assert.strictEqual(updatedBrief.nodes[1].id, 'node-end');

  // DRAFT-TEST-004: Layout does not pollute Graph Version
  const candidate = applyGraphPatch(base, [
    {
      type: 'add_node',
      node: {
        id: 'node-new',
        brief: {
          nodeId: 'node-new',
          title: 'New Node',
          intent: 'New Intent',
          dramaticFunction: 'exposition',
          narrativeSummary: 'New Summary',
        },
        contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
        choices: [],
      },
    },
  ]);
  const diff = diffNarrativeGraphs(base, candidate);
  assert.deepStrictEqual(diff.addedNodeIds, ['node-new']);
  assert.deepStrictEqual(diff.removedNodeIds, []);
  assert.deepStrictEqual(diff.updatedNodeIds, []);

  // DRAFT-TEST-005: Stale draft CAS detection
  const mockDraft: InteractiveGraphDraft = {
    id: 'draft-1',
    experienceId: 'exp-1',
    baseGraphVersionId: 'graph-v1',
    baseGraphVersionIndex: 1,
    scope: { type: 'whole_graph' },
    authorIntent: 'Expand story',
    summary: 'Add middle node',
    operations: [],
    impact: {
      addedNodeIds: [],
      updatedNodeIds: [],
      removedNodeIds: [],
      addedChoiceIds: [],
      updatedChoiceIds: [],
      removedChoiceIds: [],
      p50DurationDeltaSec: 0,
      p90DurationDeltaSec: 0,
      uniqueMediaDeltaSec: 0,
    },
    qa: { blocking: [], warnings: [], coverageIncomplete: false },
    audit: {
      promptTemplate: 'interactive-graph-draft/v1',
      inputGraphVersionId: 'graph-v1',
      inputGraphVersionIndex: 1,
      events: [{ type: 'generated', at: '2026-07-25T00:00:00Z' }],
    },
    status: 'candidate',
    createdAt: '2026-07-25T00:00:00Z',
  };

  assert.strictEqual(validateDraftCas(mockDraft, base).valid, true);

  const newerGraph: NarrativeGraphVersion = {
    ...base,
    id: 'graph-v2',
    versionIndex: 2,
  };

  const casResult = validateDraftCas(mockDraft, newerGraph);
  assert.strictEqual(casResult.valid, false);
  assert.strictEqual(casResult.reason, 'BASE_GRAPH_VERSION_MISMATCH');

  const adoptResult = canAdoptDraft(mockDraft, newerGraph);
  assert.strictEqual(adoptResult.canAdopt, false);

  // DRAFT-TEST-007: Initial candidate graph generation
  let generatedCalls = 0;
  const authoringService = new InteractiveGraphAuthoringService(async () => {
    generatedCalls += 1;
    return ({
    summary: '测试模型草案',
    storyMemory: {
      variables: [{ key: '信任', type: 'number', defaultValue: 0, min: -100, max: 100 }],
      facts: ['已经找到线索'],
    },
    nodes: [
      {
        title: '开场', intent: '让玩家理解危机', narrativeSummary: '危机发生。', dramaticFunction: 'exposition',
        durationRangeSec: [45, 60], capabilities: ['play_content', 'present_choice'], contentPolicy: 'create_shared_content',
        choices: [
          { text: '调查', intent: '追查线索', targetNodeIndex: 1, condition: { type: 'variable', variable: '信任', comparator: 'gte', value: 0 }, effects: [{ type: 'increment', variable: '信任', amount: 1 }, { type: 'add_fact', fact: '已经找到线索' }], playerKnowledge: '危机已发生', immediateFeedback: '发现线索', thematicMeaning: '选择承担责任', consequenceHorizon: 'immediate', convergenceStrategy: 'diverge', estimatedUniqueMediaSec: 30, replayValue: '进入不同结局' },
          { text: '撤离', intent: '保护同伴', targetNodeIndex: 2, condition: { type: 'always' }, effects: [], playerKnowledge: '危险正在逼近', immediateFeedback: '队伍开始撤离', thematicMeaning: '选择保护身边的人', consequenceHorizon: 'ending', convergenceStrategy: 'terminal', estimatedUniqueMediaSec: 20, replayValue: '看到另一个结局' },
        ],
      },
      {
        title: '结局一', intent: '兑现选择', narrativeSummary: '危机被解决。', dramaticFunction: 'resolution',
        durationRangeSec: [60, 75], capabilities: ['play_content', 'terminal'], choices: [],
      },
      {
        title: '结局二', intent: '承担代价', narrativeSummary: '众人安全撤离，但真相仍未揭开。', dramaticFunction: 'resolution',
        durationRangeSec: [50, 70], capabilities: ['play_content', 'terminal'], choices: [],
      },
    ],
    });
  });
  const emptyGraph: NarrativeGraphVersion = {
    id: 'graph-empty-v1',
    experienceId: 'exp-empty',
    versionIndex: 1,
    nodes: [],
    entryNodeId: '',
    locked: false,
    createdAt: '2026-07-25T00:00:00Z',
  };

  const initialDraft = await authoringService.generateDraft({
    action: 'initial',
    experienceId: 'exp-empty',
    baseGraph: emptyGraph,
    authorIntent: '从零搭建互动科幻开局',
  });

  assert.strictEqual(initialDraft.operations.length > 0, true);
  assert.strictEqual(generatedCalls, 1, 'Draft generation must call the configured AI provider exactly once');
  assert.strictEqual(initialDraft.status, 'candidate');
  assert.strictEqual(initialDraft.impact.addedNodeIds.length >= 2, true);
  assert.strictEqual(initialDraft.audit.promptTemplate, 'interactive-graph-draft/v1');
  assert.strictEqual(initialDraft.audit.inputGraphVersionId, emptyGraph.id);
  assert.strictEqual(initialDraft.proposedStateSchema?.variables[0]?.key, '信任');
  assert.deepStrictEqual(initialDraft.qa.blocking, [], 'Initial AI blueprint must align its hidden duration budget to the proposed playable structure');
  assert.strictEqual(
    initialDraft.operations.some((operation) => operation.type === 'add_node' && operation.node.interaction?.contentPolicy === 'create_shared_content'),
    true,
    'Missing optional model policy must fall back to the normal shared-content path',
  );
  assert.strictEqual((initialDraft.proposedStoryArchitecture?.storyBeats?.length || 0) >= 2, true);
  assert.strictEqual((initialDraft.proposedStoryArchitecture?.endingContracts?.length || 0) >= 1, true);
  assert.strictEqual(initialDraft.operations.some((operation) => operation.type === 'add_transition' && operation.transition.effects.some((effect) => effect.type === 'increment')), true);
  assert.ok(initialDraft.impact.p50DurationDeltaSec > 0, 'Candidate impact must reflect the actual playable path estimate');
  let revisionPrompt = '';
  const revisionService = new InteractiveGraphAuthoringService(async (request) => {
    revisionPrompt = request.prompt;
    return {
      summary: '根据上一候选修改',
      premise: '修订故事', protagonistGoal: '抵达不同结局', thematicQuestion: '如何选择',
      storyMemory: { variables: [], facts: [] },
      nodes: [
        { title: '修改后的开场', intent: '作出选择', narrativeSummary: '变化后的危机。', dramaticFunction: 'choice_point', durationRangeSec: [60, 90], choices: [
          { text: '调查', intent: '追查线索', targetNodeIndex: 1 },
          { text: '离开', intent: '保全自己', targetNodeIndex: 2 },
        ] },
        { title: '修订结局一', intent: '兑现结果', narrativeSummary: '线索揭晓。', dramaticFunction: 'ending', durationRangeSec: [60, 90], choices: [] },
        { title: '修订结局二', intent: '承担代价', narrativeSummary: '主角离开。', dramaticFunction: 'ending', durationRangeSec: [60, 90], choices: [] },
      ],
    };
  });
  const revisedDraft = await revisionService.generateDraft({
    action: 'initial', experienceId: 'exp-empty', baseGraph: emptyGraph,
    authorIntent: '保留第一版的调查动机，但让开场更紧张', revisionOfDraft: initialDraft,
  });
  assert.equal(revisedDraft.revisionOfDraftId, initialDraft.id);
  assert.match(revisionPrompt, /revisionOfCandidate/);
  assert.match(revisionPrompt, /危机发生/);
  assert.equal(revisedDraft.baseGraphVersionId, emptyGraph.id);
  assert.deepEqual(applyGraphPatch(emptyGraph, revisedDraft.operations).nodes.map((node) => node.brief.title),
    ['修改后的开场', '修订结局一', '修订结局二']);
  await assert.rejects(revisionService.generateDraft({
    action: 'initial', experienceId: 'exp-empty', baseGraph: { ...emptyGraph, id: 'newer-base' },
    authorIntent: '继续修改', revisionOfDraft: initialDraft,
  }), /原候选已过期/);

  let invalidTargetAttempts = 0;
  const invalidTargetService = new InteractiveGraphAuthoringService(async () => {
    invalidTargetAttempts += 1;
    return {
      summary: '包含无效选择目标', storyMemory: { variables: [], facts: [] },
      nodes: [
        { title: '入口', intent: '选择', narrativeSummary: '做出选择。', dramaticFunction: 'choice_point', choices: [
          { text: '错误目标', targetNodeIndex: 99 }, { text: '有效目标', targetNodeIndex: 2 },
        ] },
        { title: '结局甲', intent: '结果', narrativeSummary: '第一种结果。', dramaticFunction: 'ending', choices: [] },
        { title: '结局乙', intent: '结果', narrativeSummary: '第二种结果。', dramaticFunction: 'ending', choices: [] },
      ],
    };
  });
  await assert.rejects(invalidTargetService.generateDraft({
    action: 'initial', experienceId: 'exp-empty', baseGraph: emptyGraph, authorIntent: '生成双结局',
  }), /选择目标“99”无效/);
  assert.equal(invalidTargetAttempts, 3, 'Invalid model output may retry but must never become an adoptable candidate');
  assert.strictEqual(initialDraft.operations.filter((operation) =>
    operation.type === 'add_node' && operation.node.brief.dramaticFunction === 'ending',
  ).every((operation) => (
    operation.type === 'add_node'
    && operation.node.interaction.capabilities.includes('play_content')
    && operation.node.interaction.capabilities.includes('terminal')
  )), true, 'AI endings must remain playable story nodes instead of becoming routing-only cards');

  let durationPrompt = '';
  const durationContractService = new InteractiveGraphAuthoringService(async (input) => {
    durationPrompt = `${input.systemInstruction || ''}\n${input.prompt}`;
    const node = (index: number, ending = false) => ({
      title: ending ? `结局${index - 4}` : `故事节点${index + 1}`,
      intent: ending ? '兑现玩家选择' : '推进危机与选择',
      narrativeSummary: ending ? '玩家承担这一条路径的结局。' : '故事继续推进。',
      dramaticFunction: ending ? 'ending' : index === 0 ? 'inciting_incident' : 'choice_point',
      durationRangeSec: [45, 90],
      capabilities: ending ? ['play_content', 'terminal'] : ['play_content', 'present_choice'],
      contentPolicy: 'exclusive_branch_content',
      choices: [] as Array<{ text: string; intent: string; targetNodeIndex: number }>,
    });
    const nodes = Array.from({ length: 8 }, (_, index) => node(index, index >= 5));
    nodes[0].choices = [
      { text: '沿左线调查', intent: '进入左线', targetNodeIndex: 1 },
      { text: '沿右线调查', intent: '进入右线', targetNodeIndex: 2 },
    ];
    nodes[1].choices = [{ text: '继续', intent: '进入汇流选择', targetNodeIndex: 3 }];
    nodes[2].choices = [{ text: '继续', intent: '进入另一选择', targetNodeIndex: 4 }];
    nodes[3].choices = [
      { text: '结局一', intent: '承担第一种结果', targetNodeIndex: 5 },
      { text: '结局二', intent: '承担第二种结果', targetNodeIndex: 6 },
    ];
    nodes[4].choices = [
      { text: '结局二', intent: '承担第二种结果', targetNodeIndex: 6 },
      { text: '结局三', intent: '承担第三种结果', targetNodeIndex: 7 },
    ];
    return {
      summary: '完整短篇蓝图',
      premise: '一场需要二十分钟完成的调查。',
      protagonistGoal: '在时间耗尽前完成选择。',
      thematicQuestion: '真相是否值得代价？',
      storyMemory: { variables: [], facts: [] },
      nodes,
    };
  });
  const durationArchitecture = {
    premise: '一场需要二十分钟完成的调查。',
    protagonistGoal: '',
    thematicQuestion: '',
    mandatoryNodes: [],
    variableNodes: [],
    endings: [],
    branchBudget: { maxDepth: 10, maxParallelBranches: 5 },
    durationBudget: {
      p50TargetSec: 1200,
      p90TargetSec: 3600,
      maxSecondsWithoutChoice: 360,
      tolerancePercent: 20,
    },
  };
  const durationDraft = await durationContractService.generateDraft({
    action: 'initial',
    experienceId: 'exp-duration-contract',
    baseGraph: { ...emptyGraph, experienceId: 'exp-duration-contract' },
    authorIntent: '生成完整短篇互动影视',
    architecture: durationArchitecture,
    formatProfile: {
      format: 'branching_fmv',
      aspectRatio: '16:9',
      platforms: ['web'],
      primaryLanguage: 'zh-CN',
      targetSessionMinutes: 20,
      targetCompleteMinutes: 60,
    },
  });
  assert.equal(durationDraft.proposedStoryArchitecture?.durationBudget?.p50TargetSec, 1200);
  assert.equal(durationDraft.proposedStoryArchitecture?.durationBudget?.p90TargetSec, 3600);
  assert.match(durationPrompt, /不可缩短的合同/);
  const calibratedGraph = applyGraphPatch(
    { ...emptyGraph, experienceId: 'exp-duration-contract' },
    durationDraft.operations,
  );
  const durationQa = auditNarrativeGraph(
    calibratedGraph,
    durationDraft.proposedStateSchema,
    durationDraft.proposedStoryArchitecture?.durationBudget,
  );
  assert.deepEqual(
    durationQa.issues.filter((issue) => issue.severity === 'error'),
    [],
    'Initial graph duration estimates must be calibrated to the author-selected 20/60 minute contract instead of shrinking that contract to the generated demo',
  );
  assert.deepEqual(durationDraft.qa.blocking, []);

  let featureInputKeys: string[] = [];
  const featureScaleService = new InteractiveGraphAuthoringService(async (input) => {
    featureInputKeys = Object.keys(input);
    const nodes = Array.from({ length: 32 }, (_, index) => {
      const ending = index >= 29;
      return {
        title: ending ? `长片结局 ${index - 28}` : `长片节点 ${index + 1}`,
        intent: ending ? '兑现玩家一路累积的选择' : '推进长片主线并建立下一次抉择',
        narrativeSummary: ending ? '玩家抵达一个完整且不同的结局。' : '主角继续调查并承担上一选择的后果。',
        dramaticFunction: ending ? 'ending' : index === 0 ? 'inciting_incident' : 'choice_point',
        durationRangeSec: [60, 120],
        capabilities: ending ? ['play_content', 'terminal'] : ['play_content', 'present_choice'],
        contentPolicy: ending ? 'exclusive_branch_content' : 'create_shared_content',
        choices: ending
          ? []
          : index === 28
            ? [29, 30, 31].map((target, choiceIndex) => ({
                text: `走向结局 ${choiceIndex + 1}`,
                intent: '作出最终选择',
                targetNodeIndex: target,
              }))
            : [{
                text: '继续调查',
                intent: '推进下一段故事',
                targetNodeIndex: index + 1,
              }],
      };
    });
    return {
      summary: '九十分钟互动长片蓝图',
      premise: '一次横跨整夜的调查。',
      protagonistGoal: '在天亮前阻止灾难。',
      thematicQuestion: '真相和保护是否能够同时成立？',
      storyMemory: { variables: [], facts: [] },
      nodes,
    };
  });
  const featureDraft = await featureScaleService.generateDraft({
    action: 'initial',
    experienceId: 'exp-feature-duration-contract',
    baseGraph: { ...emptyGraph, experienceId: 'exp-feature-duration-contract' },
    authorIntent: '生成九十分钟单次、二百四十分钟完整探索的互动长片',
    architecture: {
      ...durationArchitecture,
      durationBudget: {
        ...durationArchitecture.durationBudget,
        p50TargetSec: 5400,
        p90TargetSec: 14400,
      },
    },
    formatProfile: {
      format: 'branching_fmv',
      aspectRatio: '16:9',
      platforms: ['web'],
      primaryLanguage: 'zh-CN',
      targetSessionMinutes: 90,
      targetCompleteMinutes: 240,
    },
  });
  assert.equal(
    featureDraft.operations.filter((operation) => operation.type === 'add_node').length,
    32,
    'A feature-scale project must request enough nodes to satisfy its duration and choice-gap contracts',
  );
  assert.equal(featureInputKeys.includes('maxOutputTokens'), false);
  assert.deepEqual(featureDraft.qa.blocking, []);

  // DRAFT-TEST-008: Extension from selected node carries path context
  const extDraft = await authoringService.generateDraft({
    action: 'extend',
    experienceId: 'exp-1',
    baseGraph: base,
    selectedNodeId: 'node-start',
    authorIntent: '增加悬疑支线',
  });
  assert.strictEqual(extDraft.scope.type, 'from_node');
  assert.strictEqual((extDraft.scope as { nodeId: string }).nodeId, 'node-start');

  // A golden path from an existing graph must be reachable from its entry node.
  const goldenPathDraft = await authoringService.generateDraft({
    action: 'golden_path',
    experienceId: 'exp-1',
    baseGraph: base,
    authorIntent: '延展主线但不创建孤岛',
  });
  assert.deepStrictEqual(goldenPathDraft.scope, { type: 'from_node', nodeId: 'node-start' });
  assert.strictEqual(goldenPathDraft.operations.some((operation) =>
    operation.type === 'add_transition' && operation.transition.sourceNodeId === 'node-start',
  ), true);

  // A whole-story revision replaces the reviewed graph instead of appending a
  // second copy whose choices still point at the old node IDs.
  const revisionDraft = await authoringService.generateDraft({
    action: 'revise',
    experienceId: 'exp-1',
    baseGraph: base,
    authorIntent: '保留两个结局，重做整张白板',
  });
  assert.deepStrictEqual(revisionDraft.scope, { type: 'whole_graph' });
  assert.deepStrictEqual(
    revisionDraft.operations.filter((operation) => operation.type === 'remove_node').map((operation) => operation.nodeId),
    ['node-start', 'node-end'],
  );
  assert.strictEqual(revisionDraft.operations.some((operation) =>
    operation.type === 'set_entry' && operation.nodeId !== 'node-start',
  ), true);
  assert.deepStrictEqual(revisionDraft.qa.blocking, []);
  assert.strictEqual(revisionDraft.operations.some((operation) =>
    operation.type === 'add_transition'
    && (operation.transition.targetNodeId === 'node-start' || operation.transition.targetNodeId === 'node-end'),
  ), false);

  const shortLegacyGraph: NarrativeGraphVersion = {
    ...calibratedGraph,
    id: 'graph-duration-legacy',
    versionIndex: 7,
    nodes: calibratedGraph.nodes.map((node) => ({
      ...node,
      interaction: node.interaction ? {
        ...node.interaction,
        durationRangeSec: [45, 90],
      } : undefined,
    })),
  };
  const durationRepairDraft = await durationContractService.generateDraft({
    action: 'repair',
    experienceId: 'exp-duration-contract',
    baseGraph: shortLegacyGraph,
    authorIntent: '恢复作者原先选择的二十分钟单次、六十分钟完整探索合同',
    issueIds: ['err_duration_no_p50_path', 'err_duration_no_p90_content'],
    architecture: {
      ...durationArchitecture,
      durationBudget: {
        ...durationArchitecture.durationBudget,
        p50TargetSec: 515,
        p90TargetSec: 1260,
      },
    },
    formatProfile: {
      format: 'branching_fmv',
      aspectRatio: '16:9',
      platforms: ['web'],
      primaryLanguage: 'zh-CN',
      targetSessionMinutes: 20,
      targetCompleteMinutes: 60,
    },
  });
  assert.equal(
    durationRepairDraft.operations.filter((operation) => operation.type === 'remove_node').length,
    shortLegacyGraph.nodes.length,
    'A duration-contract repair must replace the undersized legacy graph instead of appending a disconnected island',
  );
  assert.equal(durationRepairDraft.proposedStoryArchitecture?.durationBudget?.p50TargetSec, 1200);
  assert.equal(durationRepairDraft.proposedStoryArchitecture?.durationBudget?.p90TargetSec, 3600);
  assert.deepEqual(durationRepairDraft.qa.blocking, []);

  // DRAFT-TEST-009: Targeted repair draft
  const repairDraft = await authoringService.generateDraft({
    action: 'repair',
    experienceId: 'exp-1',
    baseGraph: base,
    authorIntent: '修复入口问题',
    issueIds: ['err_missing_entry'],
  });
  assert.strictEqual(repairDraft.scope.type, 'repair');
  assert.deepStrictEqual(repairDraft.operations.map((operation) => operation.type), ['set_entry']);
  await assert.rejects(
    authoringService.generateDraft({
      action: 'repair',
      experienceId: 'exp-1',
      baseGraph: base,
      authorIntent: '没有指定问题的修复不应执行',
    }),
    /需要修复的图谱检查项/,
  );

  // DRAFT-TEST-010: Adoption required before graph is modified
  assert.strictEqual(emptyGraph.versionIndex, 1);
  const adoptOutcome = adoptGraphDraft(emptyGraph, initialDraft);
  assert.strictEqual(adoptOutcome.success, true);
  assert.strictEqual(adoptOutcome.newGraph?.versionIndex, 2);
  assert.strictEqual(initialDraft.status, 'adopted');

  console.log('[Interactive AI Graph Draft Self-Check] PASSED.');
}

await runTests();
