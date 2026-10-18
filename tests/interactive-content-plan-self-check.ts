import assert from 'node:assert/strict';

import type { InteractiveWritingSceneOption } from '../src/domains/interactive/ports/writingPort.ts';
import type { NarrativeNode } from '../src/domains/interactive/types/schema.ts';
import {
  bindingsForContentPlanAdoption,
  contentPlanAdoptable,
  contentPlanMatchesWritingSource,
  validateInteractiveContentPlan,
} from '../src/domains/interactive/contentPlanning/contentPlan.ts';
import {
  fallbackContentPlanItems,
  InteractiveContentPlanningService,
} from '../src/services/interactive/interactiveContentPlanningService.ts';
import { ensureInteractiveSchema, interactiveRepository } from '../src/server/interactiveRepository.ts';

const contentNode = (id: string, title: string): NarrativeNode => ({
  id,
  brief: {
    nodeId: id,
    title,
    intent: `推进${title}`,
    dramaticFunction: 'choice_point',
    narrativeSummary: `${title}的故事内容`,
  },
  contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
  interaction: {
    capabilities: ['play_content'],
    contentPolicy: 'create_shared_content',
    durationRangeSec: [30, 150],
    playerKnowledgeIn: ['共同线索'],
    playerKnowledgeOut: [],
  },
  choices: [],
  bindings: [],
});

const controlNode = (): NarrativeNode => ({
  id: 'checkpoint',
  brief: {
    nodeId: 'checkpoint',
    title: '自动存档',
    intent: '记录故事进度',
    dramaticFunction: 'resolution',
    narrativeSummary: '不播放内容',
  },
  contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] },
  interaction: {
    capabilities: ['checkpoint'],
    contentPolicy: 'no_new_content',
    durationRangeSec: [1, 5],
    playerKnowledgeIn: [],
    playerKnowledgeOut: [],
  },
  choices: [],
  bindings: [],
});

const scene = (id: string, index: number): InteractiveWritingSceneOption => ({
  ref: {
    artifactId: `writing-scene:writing-content-plan:unit-1:${id}`,
    versionId: 'writing-project-revision:3',
    kind: 'script_scene',
    checksum: `checksum-${id}`,
  },
  writingProjectId: 'writing-content-plan',
  writingProjectTitle: '内容编排验收剧本',
  writingProjectRevision: 3,
  unitId: 'unit-1',
  unitIndex: 1,
  unitTitle: '第一集',
  sceneId: id,
  sceneIndex: index,
  sceneTitle: `场次 ${index}`,
  synopsis: `第 ${index} 场的故事内容`,
  characters: ['林默'],
  targetDurationSeconds: 45,
});

const run = async () => {
  console.log('[Interactive Content Plan] Verifying full-graph 0/1/N/N:1 planning and atomic adoption...');
  ensureInteractiveSchema();
  const created = interactiveRepository.createExperience({
    title: '全图内容编排验收',
    genre: '悬疑',
    formatProfile: {
      format: 'branching_fmv',
      aspectRatio: '16:9',
      platforms: ['web'],
      primaryLanguage: 'zh-CN',
      targetSessionMinutes: 8,
      targetCompleteMinutes: 15,
    },
    experienceSpec: {
      playerRole: '调查者',
      playerPersona: '见证者',
      interactionPromise: '选择改变调查结果',
      coreVerbs: ['调查'],
      dramaticContract: { genre: '悬疑', theme: '信任', centralConflict: '公开与保护' },
      choiceCadence: { targetChoicesPerTenMinutes: 2, maxMinutesWithoutChoice: 5 },
      consequenceHorizon: ['immediate'],
      failStatePolicy: 'rollback',
      savePolicy: 'auto_checkpoint',
      accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true },
    },
    storyArchitecture: {
      premise: '雨夜调查',
      protagonistGoal: '找到证词',
      thematicQuestion: '相信谁',
      mandatoryNodes: [],
      variableNodes: [],
      endings: [],
      branchBudget: { maxDepth: 3, maxParallelBranches: 2 },
    },
    storySource: { mode: 'bind_writing', writingProjectId: 'writing-content-plan' },
    productionBoundary: {
      maxBranchDepth: 3,
      maxParallelBranches: 2,
      exclusiveContentPercent: 30,
      maxAutomaticRepairAttempts: 2,
    },
  });

  try {
    const nodes = [
      contentNode('entry', '进入车站'),
      contentNode('reuse-branch', '从另一条路进入车站'),
      contentNode('two-scenes', '连续调查'),
      controlNode(),
    ];
    const aggregate = interactiveRepository.saveGraph(created.experience.id, {
      entryNodeId: 'entry',
      nodes,
    });
    const scenes = [scene('scene-1', 1), scene('scene-2', 2), scene('scene-3', 3)];
    const generator = async () => ({
      items: [
        {
          nodeId: 'entry',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[0].ref.artifactId],
          reuseGroupId: 'station-entry',
          compatibilityRationale: '两条路径在进入车站前拥有完全相同的公开线索，可以安全复用入口场。',
          fitRationale: '入口场建立调查目标。',
        },
        {
          nodeId: 'reuse-branch',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[0].ref.artifactId],
          reuseGroupId: 'station-entry',
          compatibilityRationale: '两条路径在进入车站前拥有完全相同的公开线索，可以安全复用入口场。',
          fitRationale: '复用入口场不会泄露其他分支结果。',
        },
        {
          nodeId: 'two-scenes',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[2].ref.artifactId, scenes[1].ref.artifactId],
          fitRationale: '先发现证据，再回看现场，按故事要求保持这个播放顺序。',
        },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    });
    const service = new InteractiveContentPlanningService(generator);
    const draft = await service.generateDraft({
      aggregate,
      scenes,
      authorIntent: '为整张白板安排内容',
    });

    assert.deepEqual(draft.qa.blocking, [], 'A valid full-graph plan must pass blocking QA');
    assert.equal(draft.items.length, nodes.length, 'The plan must cover every graph node exactly once');
    assert.deepEqual(
      draft.items.find((item) => item.nodeId === 'two-scenes')?.slots[0].orderedSceneRefs.map((ref) => ref.artifactId),
      [scenes[2].ref.artifactId, scenes[1].ref.artifactId],
      'A one-node/multi-scene plan must preserve the AI-proposed explicit order',
    );
    assert.equal(draft.items.find((item) => item.nodeId === 'checkpoint')?.mode, 'no_content');
    assert.equal(contentPlanAdoptable(draft), true);
    assert.equal(contentPlanMatchesWritingSource(draft, scenes), true);
    assert.equal(
      contentPlanMatchesWritingSource(draft, [{ ...scenes[0], writingProjectRevision: 4 }]),
      false,
      'A Content Plan based on an older Writing revision must not be adopted over the new script',
    );
    const tooLongScene: InteractiveWritingSceneOption = {
      ...scenes[0],
      ref: {
        ...scenes[0].ref,
        artifactId: 'writing-scene:writing-content-plan:unit-1:scene-too-long',
        checksum: 'checksum-too-long',
      },
      sceneId: 'scene-too-long',
      targetDurationSeconds: 360,
    };
    const severeDurationDraft = structuredClone(draft);
    severeDurationDraft.items = severeDurationDraft.items.map((item) => item.nodeId === 'entry'
      ? {
          ...item,
          slots: item.slots.map((slot) => ({
            ...slot,
            orderedSceneRefs: [tooLongScene.ref],
          })),
        }
      : item);
    const severeDurationQa = validateInteractiveContentPlan({
      draft: severeDurationDraft,
      graph: aggregate.graph,
      scenes: [...scenes, tooLongScene],
    });
    assert.ok(
      severeDurationQa.blocking.some((issue) => issue.includes('播放合同')),
      'A scene that is several times longer than its node contract must block automatic adoption instead of becoming a hidden warning',
    );
    const durationRepairService = new InteractiveContentPlanningService(async () => ({
      items: [
        {
          nodeId: 'entry',
          mode: 'reuse_existing',
          sceneArtifactIds: [tooLongScene.ref.artifactId],
          fitRationale: '现有场次讲述了入口事件，但尚未按互动节点时长拆分。',
        },
        {
          nodeId: 'reuse-branch',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[0].ref.artifactId],
          fitRationale: '现有短场次符合该节点目标。',
        },
        {
          nodeId: 'two-scenes',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[1].ref.artifactId, scenes[2].ref.artifactId],
          fitRationale: '两场连续内容共同完成调查。',
        },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const durationRepairDraft = await durationRepairService.generateDraft({
      aggregate,
      scenes: [...scenes, tooLongScene],
      authorIntent: '过长场次必须先交给 Writing 拆分',
    });
    const durationRepairItem = durationRepairDraft.items.find((item) => item.nodeId === 'entry');
    assert.equal(durationRepairItem?.mode, 'create_or_revise');
    assert.deepEqual(durationRepairItem?.slots[0].orderedSceneRefs, []);
    assert.equal(durationRepairItem?.slots[0].writingRequest?.kind, 'split_scene');
    assert.deepEqual(
      durationRepairItem?.slots[0].writingRequest?.sourceSceneArtifactIds,
      [tooLongScene.ref.artifactId],
    );
    assert.equal(
      contentPlanAdoptable(durationRepairDraft),
      false,
      'A severe generated duration mismatch must become an actionable Writing request rather than a disabled dead end',
    );
    const fallbackNodes: NarrativeNode[] = [
      {
        ...contentNode('fallback-entry', '码头相遇'),
        choices: [{ id: 'fallback-choice-1', text: '继续', intent: '进入冲突', targetNodeId: 'fallback-branch', effects: [] }],
      },
      {
        ...contentNode('fallback-branch', '废弃宿舍遭遇'),
        choices: [{ id: 'fallback-choice-2', text: '继续', intent: '进入结局', targetNodeId: 'fallback-ending', effects: [] }],
      },
      {
        ...contentNode('fallback-ending', '冷库结局'),
        brief: {
          ...contentNode('fallback-ending', '冷库结局').brief,
          dramaticFunction: 'ending' as const,
        },
        interaction: {
          ...contentNode('fallback-ending', '冷库结局').interaction,
          capabilities: ['play_content', 'terminal'],
        },
      },
    ];
    const fallback = fallbackContentPlanItems({
      ...aggregate.graph,
      entryNodeId: 'fallback-entry',
      nodes: fallbackNodes,
      transitions: [
        { id: 'fallback-choice-1', sourceNodeId: 'fallback-entry', targetNodeId: 'fallback-branch', text: '继续', intent: '进入冲突', effects: [] },
        { id: 'fallback-choice-2', sourceNodeId: 'fallback-branch', targetNodeId: 'fallback-ending', text: '继续', intent: '进入结局', effects: [] },
      ],
    }, scenes);
    assert.ok(
      fallback.every((item) => (
        item.mode === 'create_or_revise'
        && Array.isArray(item.sceneArtifactIds)
        && item.sceneArtifactIds.length === 0
      )),
      'A timeout fallback must request Writing work instead of guessing that unrelated sequential scenes fit the graph',
    );

    const leakAggregate = {
      ...aggregate,
      graph: {
        ...aggregate.graph,
        nodes: aggregate.graph.nodes.map((node) => node.id === 'two-scenes'
          ? {
              ...node,
              interaction: {
                ...node.interaction,
                playerKnowledgeOut: [...node.interaction.playerKnowledgeOut, '幕后真相'],
              },
            }
          : node),
      },
    };
    const leakService = new InteractiveContentPlanningService(async () => {
      const generated = await generator();
      return {
        items: generated.items.map((item) => item.nodeId === 'entry'
          ? { ...item, revealedFactIds: ['幕后真相'] }
          : item),
      };
    });
    const leakDraft = await leakService.generateDraft({
      aggregate: leakAggregate,
      scenes,
      authorIntent: '入口不能提前泄露结局信息',
    });
    assert.ok(
      leakDraft.qa.blocking.some((issue) => issue.includes('提前泄露')),
      'Content QA must block facts that the selected scene reveals before the node contract allows them',
    );

    const orderedGraphAggregate = {
      ...aggregate,
      graph: {
        ...aggregate.graph,
        nodes: aggregate.graph.nodes.map((node) => node.id === 'entry'
          ? {
              ...node,
              choices: [{
                id: 'choice-regressive-order',
                text: '继续调查',
                intent: '推进故事',
                effects: [],
                targetNodeId: 'two-scenes',
              }],
            }
          : node),
      },
    };
    const regressiveOrderService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: [scenes[2].ref.artifactId], fitRationale: '先播放第三场。' },
        { nodeId: 'reuse-branch', mode: 'reuse_existing', sceneArtifactIds: [scenes[0].ref.artifactId], fitRationale: '另一条独立路径播放第一场。' },
        { nodeId: 'two-scenes', mode: 'reuse_existing', sceneArtifactIds: [scenes[1].ref.artifactId], fitRationale: '后续却倒退到第二场。' },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const regressiveOrderDraft = await regressiveOrderService.generateDraft({
      aggregate: orderedGraphAggregate,
      scenes,
      authorIntent: '后续节点不能倒退播放更早场次',
    });
    assert.ok(
      regressiveOrderDraft.qa.blocking.some((issue) => issue.includes('顺序发生倒退或重复')),
      'A later graph node must not replay an earlier Writing scene',
    );

    const semanticScenes = scenes.map((item, index) => ({
      ...item,
      sceneIndex: [10, 5, 12][index],
      sceneTitle: ['场景1-4：补写的第一章场次', '场景2-2：已存在的第二章场次', '场景3-1：第三章高潮'][index],
    }));
    const semanticOrderService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: [semanticScenes[0].ref.artifactId], fitRationale: '第一章补写场次。' },
        { nodeId: 'reuse-branch', mode: 'reuse_existing', sceneArtifactIds: [semanticScenes[2].ref.artifactId], fitRationale: '另一条独立路径。' },
        { nodeId: 'two-scenes', mode: 'reuse_existing', sceneArtifactIds: [semanticScenes[1].ref.artifactId], fitRationale: '第二章既有场次。' },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const semanticOrderDraft = await semanticOrderService.generateDraft({
      aggregate: orderedGraphAggregate,
      scenes: semanticScenes,
      authorIntent: '补写场次的存储顺序不能覆盖故事编号顺序',
    });
    assert.equal(
      semanticOrderDraft.qa.blocking.some((issue) => issue.includes('顺序发生倒退或重复')),
      false,
      'A later chapter scene must remain forward even when a newly written earlier scene was appended after it in storage',
    );

    const exactMatchScenes = scenes.map((item, index) => ({
      ...item,
      sceneTitle: ['场景1-1：进入车站', '场景1-2：从另一条路进入车站', '场景1-3：连续调查'][index],
    }));
    const exactMatchRecoveryService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'create_or_revise', sceneArtifactIds: [] },
        { nodeId: 'reuse-branch', mode: 'create_or_revise', sceneArtifactIds: [] },
        { nodeId: 'two-scenes', mode: 'create_or_revise', sceneArtifactIds: [] },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const exactMatchDraft = await exactMatchRecoveryService.generateDraft({
      aggregate,
      scenes: exactMatchScenes,
      authorIntent: '已有精确匹配场次时不要重复补写',
    });
    assert.equal(
      exactMatchDraft.impact.newWritingSceneCount,
      0,
      'An exact title match must recover an existing scene instead of sending Writing into an endless supplement loop',
    );
    const exactMatchFallbackService = new InteractiveContentPlanningService(async () => ({ items: [] }));
    const exactMatchFallbackDraft = await exactMatchFallbackService.generateDraft({
      aggregate,
      scenes: exactMatchScenes,
      authorIntent: '模型结果不完整时，安全方案也应复用精确匹配场次',
    });
    assert.equal(
      exactMatchFallbackDraft.impact.newWritingSceneCount,
      0,
      'The deterministic fallback must also recover exact existing scene matches',
    );

    const persisted = interactiveRepository.saveContentPlanDraft(draft);
    assert.equal(interactiveRepository.getLatestContentPlanDraft(created.experience.id)?.id, persisted.id);
    assert.equal(
      interactiveRepository.getExperience(created.experience.id).bindings.length,
      0,
      'A candidate content plan must not modify formal bindings before adoption',
    );

    const bindings = bindingsForContentPlanAdoption(persisted, aggregate, '2026-07-26T00:00:00.000Z');
    const adopted = interactiveRepository.adoptContentPlan(created.experience.id, persisted.id, bindings);
    assert.equal(adopted.draft.status, 'adopted');
    assert.equal(adopted.aggregate.bindings.length, 3, 'Pure control nodes must not receive fabricated content bindings');
    assert.equal(
      adopted.aggregate.bindings.find((binding) => binding.nodeId === 'two-scenes')?.scriptSceneRefs?.length,
      2,
    );
    assert.equal(
      adopted.aggregate.bindings.find((binding) => binding.nodeId === 'entry')?.scriptSceneRefs?.[0].checksum,
      adopted.aggregate.bindings.find((binding) => binding.nodeId === 'reuse-branch')?.scriptSceneRefs?.[0].checksum,
      'N:1 scene reuse must remain explicit in formal bindings',
    );
    const adoptedAgain = interactiveRepository.adoptContentPlan(created.experience.id, persisted.id, bindings);
    assert.equal(adoptedAgain.aggregate.bindings.length, 3, 'Repeated adoption must be idempotent');
    assert.equal(
      interactiveRepository.listBindingVersions(created.experience.id, 'entry', 'main').length,
      1,
      'Repeated adoption must not create duplicate binding versions',
    );

    const conflictDraft = interactiveRepository.saveContentPlanDraft(await service.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '验证并发内容修改不会被旧方案覆盖',
    }));
    const currentEntry = adopted.aggregate.bindings.find((binding) => binding.nodeId === 'entry')!;
    interactiveRepository.saveBinding(created.experience.id, {
      ...currentEntry,
      contentFitReview: {
        ...currentEntry.contentFitReview!,
        rationale: '作者刚刚单独复核了入口内容，旧的整套方案不能覆盖这个决定。',
        reviewedAt: '2026-07-26T00:01:00.000Z',
      },
    });
    assert.throws(
      () => interactiveRepository.adoptContentPlan(
        created.experience.id,
        conflictDraft.id,
        bindingsForContentPlanAdoption(conflictDraft, adopted.aggregate),
      ),
      /内容已变化/,
      'A plan based on older binding versions must not overwrite a newer author decision',
    );
    assert.equal(
      interactiveRepository.getContentPlanDraft(created.experience.id, conflictDraft.id).status,
      'stale',
      'A binding-version conflict must persist the plan as stale for refresh recovery',
    );

    const duplicateGenerator = new InteractiveContentPlanningService(async () => ({
      items: [
        {
          nodeId: 'entry',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[0].ref.artifactId, scenes[0].ref.artifactId],
        },
        { nodeId: 'reuse-branch', mode: 'reuse_existing', sceneArtifactIds: [scenes[1].ref.artifactId] },
        { nodeId: 'two-scenes', mode: 'reuse_existing', sceneArtifactIds: [scenes[2].ref.artifactId] },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const duplicateDraft = await duplicateGenerator.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '重复场次应被拒绝',
    });
    assert.ok(duplicateDraft.qa.blocking.some((issue) => issue.includes('重复安排')));

    const unitTwoScene: InteractiveWritingSceneOption = {
      ...scenes[1],
      ref: { ...scenes[1].ref, artifactId: `${scenes[1].ref.artifactId}-unit-2`, checksum: 'checksum-unit-2' },
      unitId: 'unit-2',
      unitIndex: 2,
    };
    const crossUnitService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: [scenes[0].ref.artifactId] },
        { nodeId: 'reuse-branch', mode: 'reuse_existing', sceneArtifactIds: [scenes[1].ref.artifactId] },
        {
          nodeId: 'two-scenes',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[2].ref.artifactId, unitTwoScene.ref.artifactId],
        },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const crossUnitDraft = await crossUnitService.generateDraft({
      aggregate: adopted.aggregate,
      scenes: [...scenes, unitTwoScene],
      authorIntent: '跨单元内容应要求拆节点',
    });
    assert.ok(crossUnitDraft.qa.blocking.some((issue) => issue.includes('跨越了剧本单元')));

    const revisionFourScene: InteractiveWritingSceneOption = {
      ...scenes[1],
      ref: {
        ...scenes[1].ref,
        artifactId: `${scenes[1].ref.artifactId}-revision-4`,
        versionId: 'writing-project-revision:4',
        checksum: 'checksum-revision-4',
      },
      writingProjectRevision: 4,
    };
    const crossRevisionService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: [scenes[0].ref.artifactId] },
        { nodeId: 'reuse-branch', mode: 'reuse_existing', sceneArtifactIds: [scenes[1].ref.artifactId] },
        {
          nodeId: 'two-scenes',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[2].ref.artifactId, revisionFourScene.ref.artifactId],
        },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const crossRevisionDraft = await crossRevisionService.generateDraft({
      aggregate: adopted.aggregate,
      scenes: [...scenes, revisionFourScene],
      authorIntent: '跨版本内容必须阻断',
    });
    assert.ok(crossRevisionDraft.qa.blocking.some((issue) => issue.includes('同一版剧本')));

    const unsafeReuseService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: [scenes[0].ref.artifactId] },
        { nodeId: 'reuse-branch', mode: 'reuse_existing', sceneArtifactIds: [scenes[0].ref.artifactId] },
        { nodeId: 'two-scenes', mode: 'reuse_existing', sceneArtifactIds: [scenes[2].ref.artifactId] },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const unsafeReuseDraft = await unsafeReuseService.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '复用必须解释状态兼容',
    });
    assert.ok(unsafeReuseDraft.qa.blocking.some((issue) => issue.includes('状态兼容说明')));

    const distinctEndingsAggregate = {
      ...adopted.aggregate,
      graph: {
        ...adopted.aggregate.graph,
        nodes: adopted.aggregate.graph.nodes.map((node) => (
          node.id === 'reuse-branch' || node.id === 'two-scenes'
            ? { ...node, brief: { ...node.brief, dramaticFunction: 'ending' as const } }
            : node
        )),
      },
    };
    const distinctEndingsService = new InteractiveContentPlanningService(async () => ({
      items: [
        { nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: [scenes[0].ref.artifactId], fitRationale: '入口内容。' },
        {
          nodeId: 'reuse-branch',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[2].ref.artifactId],
          reuseGroupId: 'shared-ending',
          compatibilityRationale: '两个节点进入时拥有相同信息。',
          fitRationale: '结局内容。',
        },
        {
          nodeId: 'two-scenes',
          mode: 'reuse_existing',
          sceneArtifactIds: [scenes[2].ref.artifactId],
          reuseGroupId: 'shared-ending',
          compatibilityRationale: '两个节点进入时拥有相同信息。',
          fitRationale: '结局内容。',
        },
        { nodeId: 'checkpoint', mode: 'no_content', sceneArtifactIds: [] },
      ],
    }));
    const distinctEndingsDraft = await distinctEndingsService.generateDraft({
      aggregate: distinctEndingsAggregate,
      scenes,
      authorIntent: '不同结局必须有各自的兑现内容',
    });
    assert.ok(
      distinctEndingsDraft.qa.blocking.some((issue) => issue.includes('不同结局不能复用')),
      'Two different endings must not silently reuse the same script scene',
    );

    const unknownSceneService = new InteractiveContentPlanningService(async () => ({
      items: [{ nodeId: 'entry', mode: 'reuse_existing', sceneArtifactIds: ['unknown-scene'] }],
    }));
    const repairedUnknownSceneDraft = await unknownSceneService.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '未知引用',
    });
    assert.ok(
      repairedUnknownSceneDraft.qa.warnings.some((warning) => warning.includes('已拒绝')),
      'An unknown AI scene reference must be rejected rather than persisted',
    );
    assert.equal(
      repairedUnknownSceneDraft.items.some((item) => item.slots.some((slot) => (
        slot.orderedSceneRefs.some((ref) => ref.artifactId === 'unknown-scene')
      ))),
      false,
    );

    let automaticRepairAttempts = 0;
    const automaticallyRepairedService = new InteractiveContentPlanningService(async () => {
      automaticRepairAttempts += 1;
      if (automaticRepairAttempts < 3) {
        return { items: [{ nodeId: 'unknown-node', mode: 'no_content', sceneArtifactIds: [] }] };
      }
      return generator();
    });
    const automaticallyRepairedDraft = await automaticallyRepairedService.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '同一输入最多自动返修两次',
    });
    assert.equal(automaticRepairAttempts, 3, 'Content planning may retry the first attempt at most twice');
    assert.ok(
      automaticallyRepairedDraft.qa.warnings.some((warning) => warning.includes('自动修正')),
      'A recovered content plan should retain creator-facing repair evidence',
    );

    const unknownNodeService = new InteractiveContentPlanningService(async () => ({
      items: [{ nodeId: 'unknown-node', mode: 'no_content', sceneArtifactIds: [] }],
    }));
    const repairedUnknownNodeDraft = await unknownNodeService.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '未知节点',
    });
    assert.ok(repairedUnknownNodeDraft.qa.warnings.some((warning) => warning.includes('已拒绝')));
    assert.equal(repairedUnknownNodeDraft.items.some((item) => item.nodeId === 'unknown-node'), false);

    const writingRequestService = new InteractiveContentPlanningService(async () => {
      throw new Error('provider unavailable');
    });
    const writingRequestDraft = await writingRequestService.generateDraft({
      aggregate: adopted.aggregate,
      scenes: [],
      authorIntent: '没有场次时提出补写请求',
    });
    assert.equal(writingRequestDraft.impact.newWritingSceneCount, 3);
    assert.equal(contentPlanAdoptable(writingRequestDraft), false, 'Writing requests must not fabricate adoptable scene refs');

    const splitRequestService = new InteractiveContentPlanningService(async () => ({
      items: adopted.aggregate.graph.nodes.map((node) => node.id === 'entry'
        ? {
            nodeId: node.id,
            mode: 'create_or_revise',
            sceneArtifactIds: [],
            writingRequest: {
              kind: 'split_scene',
              dramaticPurpose: '把进入仓库和作出选择拆成两个稳定场次',
              requiredFacts: node.contract.requiredFacts,
              prohibitedRevelations: [],
              desiredDurationSec: 90,
              sourceSceneArtifactIds: [scenes[0].ref.artifactId],
            },
          }
        : node.id === 'checkpoint'
          ? { nodeId: node.id, mode: 'no_content', sceneArtifactIds: [] }
          : {
              nodeId: node.id,
              mode: 'reuse_existing',
              sceneArtifactIds: [scenes[1].ref.artifactId],
              fitRationale: '现有场次符合节点目标。',
            }),
    }));
    const splitRequestDraft = await splitRequestService.generateDraft({
      aggregate: adopted.aggregate,
      scenes,
      authorIntent: '半场内容必须先拆分',
    });
    const splitRequest = splitRequestDraft.items.find((item) => item.nodeId === 'entry')
      ?.slots[0]?.writingRequest;
    assert.equal(splitRequest?.kind, 'split_scene');
    assert.deepEqual(splitRequest?.sourceSceneArtifactIds, [scenes[0].ref.artifactId]);
    assert.equal(contentPlanAdoptable(splitRequestDraft), false);

    const beforeAtomicFailure = interactiveRepository.getExperience(created.experience.id);
    const atomicFailureDraft = interactiveRepository.saveContentPlanDraft(await service.generateDraft({
      aggregate: beforeAtomicFailure,
      scenes,
      authorIntent: '批量采用必须原子化',
    }));
    const invalidBatch = bindingsForContentPlanAdoption(atomicFailureDraft, beforeAtomicFailure);
    invalidBatch[1] = {
      ...invalidBatch[1],
      scriptSceneRefs: [
        invalidBatch[1].scriptSceneRefs![0],
        invalidBatch[1].scriptSceneRefs![0],
      ],
    };
    const entryVersionCountBeforeFailure = interactiveRepository
      .listBindingVersions(created.experience.id, 'entry', 'main').length;
    assert.throws(
      () => interactiveRepository.adoptContentPlan(created.experience.id, atomicFailureDraft.id, invalidBatch),
      /duplicate/,
    );
    assert.equal(
      interactiveRepository.listBindingVersions(created.experience.id, 'entry', 'main').length,
      entryVersionCountBeforeFailure,
      'A later invalid item must roll back bindings written earlier in the same batch',
    );
    assert.equal(
      interactiveRepository.getContentPlanDraft(created.experience.id, atomicFailureDraft.id).status,
      'candidate',
      'A failed atomic adoption must keep the candidate reviewable',
    );

    const beforeGraphChange = interactiveRepository.getExperience(created.experience.id);
    const graphSensitiveDraft = interactiveRepository.saveContentPlanDraft(await service.generateDraft({
      aggregate: beforeGraphChange,
      scenes,
      authorIntent: '图谱变化后候选应失效',
    }));
    interactiveRepository.saveGraph(created.experience.id, {
      entryNodeId: beforeGraphChange.graph.entryNodeId,
      nodes: beforeGraphChange.graph.nodes.map((node) => (
        node.id === 'entry'
          ? { ...node, brief: { ...node.brief, narrativeSummary: '入口故事目标已经改变。' } }
          : node
      )),
    });
    assert.equal(
      interactiveRepository.getContentPlanDraft(created.experience.id, graphSensitiveDraft.id).status,
      'stale',
      'A semantic graph change must make persisted candidate plans stale',
    );
  } finally {
    interactiveRepository.deleteExperience(created.experience.id);
  }

  console.log('[Interactive Content Plan] PASSED.');
};

void run();
