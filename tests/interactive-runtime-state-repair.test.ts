import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditNarrativeGraph } from '../src/domains/interactive/qa/graphQAEngine.ts';
import { validateNarrativeGraph } from '../src/domains/interactive/validation/domainValidation.ts';
import type { NarrativeGraphVersion, StateSchema } from '../src/domains/interactive/types/schema.ts';

const schema: StateSchema = { variables: [], factDefinitions: [], initialFactIds: [] };
const contract = { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] };
const interaction = (capabilities: Array<'present_choice' | 'terminal'>) => ({
  capabilities, contentPolicy: 'no_new_content' as const, durationRangeSec: [1, 2] as [number, number], playerKnowledgeIn: [], playerKnowledgeOut: [],
});
const choiceInteraction = { playerKnowledge: '已知', immediateFeedback: '反馈', consequenceHorizon: 'immediate' as const,
  thematicMeaning: '意义', convergenceStrategy: 'terminal' as const, estimatedUniqueMediaSec: 0, replayValue: '无' };
const graph = (condition: NarrativeGraphVersion['nodes'][number]['choices'][number]['condition']): NarrativeGraphVersion => ({
  id: 'graph_fixture', experienceId: 'fixture', versionIndex: 2, entryNodeId: 'entry', locked: false,
  semanticContractVersion: 2, createdAt: '2026-10-09T00:00:00.000Z',
  nodes: [
    { id: 'entry', brief: { nodeId: 'entry', title: '入口', intent: '判断路径', dramaticFunction: 'choice_point', narrativeSummary: '机械反例' },
      contract, interaction: interaction(['present_choice']), choices: [
        { id: 'to-end', text: '前进', intent: '前进', targetNodeId: 'end', condition, effects: [], interaction: choiceInteraction },
      ] },
    { id: 'end', brief: { nodeId: 'end', title: '结局', intent: '终止', dramaticFunction: 'ending', narrativeSummary: '终点' },
      contract, interaction: interaction(['terminal']), choices: [] },
  ],
});

test('state-space QA rejects a structurally connected but impossible ending', () => {
  const result = auditNarrativeGraph(graph({ op: 'never' }), schema);
  assert.equal(result.passed, false);
  assert.deepEqual(result.stateSpace?.deadlockNodeIds, ['entry']);
  assert.deepEqual(result.stateSpace?.reachableEndingIds, []);
  assert.equal(result.stateSpace?.complete, true);
});

test('state validation rejects incorrect set and compare types', () => {
  const typedSchema: StateSchema = { variables: [{ key: 'mode', type: 'enum', scope: 'session', defaultValue: 'safe', enumValues: ['safe', 'risk'] }] };
  const invalid = graph({ op: 'compare', variable: 'mode', comparator: 'gt', value: 1 });
  invalid.nodes[0].choices[0].effects = [{ type: 'set', variable: 'mode', value: 'outside' }];
  const issues = validateNarrativeGraph(invalid, typedSchema);
  assert.ok(issues.some((issue) => issue.includes('枚举范围')));
  assert.ok(issues.some((issue) => issue.includes('条件值')));
});

test('legal loop can unlock an ending on second visit', () => {
  const looping = graph({ op: 'visited', nodeId: 'entry', minTimes: 2 });
  looping.nodes[0].choices.unshift({
    id: 'again', text: '再试一次', intent: '等待', targetNodeId: 'entry',
    condition: { op: 'not', predicate: { op: 'visited', nodeId: 'entry', minTimes: 2 } }, effects: [], interaction: choiceInteraction,
  });
  const result = auditNarrativeGraph(looping, schema);
  assert.equal(result.passed, true, JSON.stringify(result.issues));
  assert.deepEqual(result.stateSpace?.reachableEndingIds, ['end']);
});

test('one reachable ending does not hide a separate no-exit cycle', () => {
  const branching = graph({ op: 'always' });
  branching.nodes[0].choices.push({
    id: 'to-trap', text: '走入循环', intent: '测试死循环', targetNodeId: 'trap',
    condition: { op: 'always' }, effects: [], interaction: choiceInteraction,
  });
  branching.nodes.push({
    id: 'trap', brief: { nodeId: 'trap', title: '循环节点', intent: '原地打转', dramaticFunction: 'choice_point', narrativeSummary: '无出口' },
    contract, interaction: interaction(['present_choice']), choices: [{
      id: 'again', text: '继续循环', intent: '原地打转', targetNodeId: 'trap',
      condition: { op: 'always' }, effects: [], interaction: choiceInteraction,
    }],
  });
  const result = auditNarrativeGraph(branching, schema);
  assert.equal(result.stateSpace?.complete, true);
  assert.deepEqual(result.stateSpace?.reachableEndingIds, ['end']);
  assert.ok(result.stateSpace?.deadlockNodeIds.includes('trap'), JSON.stringify(result.stateSpace));
  assert.ok(result.issues.some((issue) => issue.id === 'err_runtime_deadlock_trap'));
  assert.equal(result.passed, false);
});

test('timeout default branch participates in executable deadlock checks', () => {
  const timed = graph({ op: 'always' });
  timed.nodes[0].choices[0].timeoutSeconds = 3;
  timed.nodes[0].choices[0].defaultTimeoutTargetNodeId = 'trap';
  timed.nodes.push({
    id: 'trap', brief: { nodeId: 'trap', title: '超时陷阱', intent: '验证默认去向', dramaticFunction: 'resolution', narrativeSummary: '没有后继' },
    contract, interaction: interaction(['present_choice']), choices: [],
  });
  const result = auditNarrativeGraph(timed, schema);
  assert.equal(result.passed, false);
  assert.ok(result.stateSpace?.deadlockNodeIds.includes('trap'));
  const infiniteTime = auditNarrativeGraph(timed, schema, undefined, false);
  assert.deepEqual(infiniteTime.stateSpace?.deadlockNodeIds, []);
});

test('bounded exploration reports incomplete coverage instead of claiming all paths checked', () => {
  const numeric: StateSchema = { variables: [{ key: 'count', type: 'number', scope: 'session', defaultValue: 0 }] };
  const looping = graph({ op: 'compare', variable: 'count', comparator: 'gte', value: 20_000 });
  looping.nodes[0].choices.unshift({
    id: 'count', text: '继续计数', intent: '继续', targetNodeId: 'entry',
    condition: { op: 'compare', variable: 'count', comparator: 'lt', value: 20_000 },
    effects: [{ type: 'increment', variable: 'count', amount: 1 }], interaction: choiceInteraction,
  });
  const result = auditNarrativeGraph(looping, numeric);
  assert.equal(result.stateSpace?.complete, false);
  assert.ok(result.issues.some((issue) => issue.id === 'warn_state_exploration_incomplete'));
  assert.ok(!result.issues.some((issue) => issue.id === 'err_no_reachable_ending'));
});

test('formal build rejects proven deadlock while draft remains editable', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'interactive-state-repair-'));
  process.env.OMNI_DB_PATH = path.join(directory, 'isolated.sqlite');
  try {
    const [{ interactiveRepository }, { db }] = await Promise.all([
      import('../src/server/interactiveRepository.ts'), import('../src/server/db.ts'),
    ]);
    try {
      const created = interactiveRepository.createExperience({
        title: '机械测试', genre: '测试',
        formatProfile: { format: 'narrative_game', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 1, targetCompleteMinutes: 1 },
        experienceSpec: { playerRole: '玩家', playerPersona: '测试', interactionPromise: '验证分支', coreVerbs: ['选择'],
          dramaticContract: { genre: '测试', theme: '分支', centralConflict: '可达性' }, choiceCadence: { targetChoicesPerTenMinutes: 1, maxMinutesWithoutChoice: 1 },
          consequenceHorizon: ['immediate'], failStatePolicy: 'retry', savePolicy: 'manual_save',
          accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'standard', colorBlindSafe: true } },
        storyArchitecture: { premise: '测试', protagonistGoal: '抵达结局', thematicQuestion: '能否抵达', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 2, maxParallelBranches: 1 } },
        storySource: { mode: 'scratch' }, productionBoundary: { maxBranchDepth: 2, maxParallelBranches: 1, exclusiveContentPercent: 0, maxAutomaticRepairAttempts: 0 },
      });
      const id = created.experience.id;
      const initialSchema = interactiveRepository.saveStateSchema(id, {
        variables: [{ key: 'flag', type: 'boolean', scope: 'session', defaultValue: false }],
        factDefinitions: [], initialFactIds: [],
      }, created.stateSchema.versionIndex);
      assert.equal(initialSchema.stateSchema.data.variables[0].key, 'flag', 'blank draft accepts state definitions before any graph is written');
      const saved = interactiveRepository.saveGraph(id, graph({ op: 'never' }));
      assert.equal(saved.graph.nodes[0].choices[0].condition?.op, 'never');
      assert.throws(() => interactiveRepository.createRuntimeBuild(id), (error: unknown) => (error as { statusCode?: number }).statusCode === 422);
      const repaired = interactiveRepository.saveGraph(id, graph({ op: 'always' }), 'draft', saved.graph.versionIndex);
      const build = interactiveRepository.createRuntimeBuild(id);
      assert.equal(build.status, 'ready_for_player');
      assert.equal(build.experienceSpecSnapshot?.savePolicy, 'manual_save');
      assert.equal(build.graphVersionId, repaired.graph.id);
      const referencedGraph = interactiveRepository.saveGraph(id,
        graph({ op: 'compare', variable: 'flag', comparator: 'eq', value: false }), 'draft', repaired.graph.versionIndex);
      assert.equal(referencedGraph.graph.nodes[0].choices[0].condition?.op, 'compare');
      assert.throws(() => interactiveRepository.saveStateSchema(id, { variables: [], factDefinitions: [], initialFactIds: [] },
        initialSchema.stateSchema.versionIndex), (error: unknown) => (error as { statusCode?: number }).statusCode === 422);
      const current = interactiveRepository.getExperience(id);
      assert.throws(() => interactiveRepository.saveExperienceSpec(id, { ...current.experienceSpec.data, savePolicy: 'invalid' as 'manual_save' },
        current.experienceSpec.versionIndex), (error: unknown) => (error as { statusCode?: number }).statusCode === 422);
      const changedSpec = interactiveRepository.saveExperienceSpec(id, { ...current.experienceSpec.data, savePolicy: 'auto_checkpoint' }, current.experienceSpec.versionIndex);
      assert.equal(changedSpec.experienceSpec.versionIndex, current.experienceSpec.versionIndex + 1);
      assert.throws(() => interactiveRepository.saveExperienceSpec(id, current.experienceSpec.data, current.experienceSpec.versionIndex),
        (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
      const nextBuild = interactiveRepository.createRuntimeBuild(id);
      assert.equal(build.experienceSpecSnapshot?.savePolicy, 'manual_save');
      assert.equal(nextBuild.experienceSpecSnapshot?.savePolicy, 'auto_checkpoint');
      const changedDetails = interactiveRepository.saveExperienceDetails(id, {
        title: '机械测试修订', genre: '测试', formatProfile: current.experience.formatProfile,
        productionBoundary: current.experience.productionBoundary,
      }, changedSpec.experience.updatedAt);
      assert.equal(changedDetails.experience.title, '机械测试修订');
      assert.throws(() => interactiveRepository.saveExperienceDetails(id, {
        title: '无效资料', genre: '测试', formatProfile: { ...current.experience.formatProfile, targetSessionMinutes: -1 },
        productionBoundary: current.experience.productionBoundary,
      }, changedDetails.experience.updatedAt), (error: unknown) => (error as { statusCode?: number }).statusCode === 422);
      assert.throws(() => interactiveRepository.saveExperienceDetails(id, {
        title: '过期覆盖', genre: '测试', formatProfile: current.experience.formatProfile,
        productionBoundary: current.experience.productionBoundary,
      }, changedSpec.experience.updatedAt), (error: unknown) => (error as { statusCode?: number }).statusCode === 409);
    } finally { db.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});


test('nested visited and missing transition targets cannot silently change branch meaning', () => {
  const invalid = graph({ op: 'not', predicate: { op: 'all', predicates: [{ op: 'visited', nodeId: 'deleted' }] } });
  assert.ok(validateNarrativeGraph(invalid, schema).some((issue) => issue.includes('访问条件引用不存在')));
  assert.equal(auditNarrativeGraph(invalid, schema).passed, false);
  invalid.nodes[0].choices[0].targetNodeId = 'missing';
  assert.ok(validateNarrativeGraph(invalid, schema).some((issue) => issue.includes('目标节点不存在')));
});
