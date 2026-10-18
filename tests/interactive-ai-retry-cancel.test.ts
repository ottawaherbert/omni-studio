import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('cancelled interactive graph retry cannot persist a late candidate', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'interactive-ai-retry-'));
  const oldPath = process.env.OMNI_DB_PATH;
  process.env.OMNI_DB_PATH = path.join(directory, 'test.sqlite');
  try {
    const { db } = await import('../src/server/db.ts');
    const { interactiveRepository } = await import('../src/server/interactiveRepository.ts');
    const { registerInteractiveRoutes } = await import('../src/server/routes/interactiveRoutes.ts');
    const aggregate = interactiveRepository.createExperience({
      title: '重试取消', genre: '悬疑',
      formatProfile: { format: 'branching_fmv', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 3, targetCompleteMinutes: 5 },
      experienceSpec: { playerRole: '玩家', playerPersona: '谨慎', interactionPromise: '选择改变结果', coreVerbs: ['选择'],
        dramaticContract: { genre: '悬疑', theme: '选择', centralConflict: '是否开门' }, choiceCadence: { targetChoicesPerTenMinutes: 1, maxMinutesWithoutChoice: 3 },
        consequenceHorizon: ['immediate'], failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
        accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true } },
      storyArchitecture: { premise: '门前', protagonistGoal: '开门', thematicQuestion: '是否开门', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 3, maxParallelBranches: 2 } },
      storySource: { mode: 'scratch' },
      productionBoundary: { maxBranchDepth: 3, maxParallelBranches: 2, exclusiveContentPercent: 20, maxAutomaticRepairAttempts: 1 },
    });
    const experienceId = aggregate.experience.id;
    interactiveRepository.addTaskRef(experienceId, {
      owner: 'interactive_graph', taskId: 'failed-graph', purpose: '准备图谱', dependsOn: [],
      inputFingerprint: 'failed-graph', idempotencyKey: 'interactive_graph:failed-graph', status: 'failed',
      retryContext: { kind: 'interactive_graph', action: 'initial', authorIntent: '设计双结局' },
    });
    let answerModel!: (value: Record<string, unknown>) => void;
    const modelPending = new Promise<Record<string, unknown>>((resolve) => { answerModel = resolve; });
    const handlers = new Map<string, (req: any, res: any) => any>();
    const app = Object.fromEntries(['get', 'put', 'post', 'delete'].map((method) =>
      [method, (route: string, handler: any) => handlers.set(`${method} ${route}`, handler)])) as any;
    registerInteractiveRoutes(app, { graphDraftGenerator: () => modelPending });
    const response = () => {
      const outcome: { status: number; body?: any } = { status: 200 };
      return { outcome, res: {
        status(code: number) { outcome.status = code; return this; },
        json(body: unknown) { outcome.body = body; return this; },
      } };
    };
    const staleCreate = response();
    await handlers.get('post /api/interactive/experiences/:experienceId/graph-drafts')!(
      { params: { experienceId }, body: {
        action: 'initial', authorIntent: '过期标签页的请求',
        expectedGraphVersionIndex: aggregate.graph.versionIndex + 1,
      } }, staleCreate.res,
    );
    assert.equal(staleCreate.outcome.status, 409);
    assert.match(staleCreate.outcome.body.error, /白板图谱已更新/);
    assert.equal(interactiveRepository.getTaskCoordination(experienceId).taskRefs.length, 1,
      'Rejected stale request must not register an AI task or call the generator');
    const retry = response();
    const retryPromise = handlers.get('post /api/interactive/experiences/:experienceId/tasks/:taskId/retry')!(
      { params: { experienceId, taskId: 'failed-graph' } }, retry.res,
    );
    const retryTask = interactiveRepository.getTaskCoordination(experienceId).taskRefs.find((task) => task.owner === 'interactive_graph');
    assert.match(retryTask?.taskId || '', /interactive_graph-retry-/);
    const cancel = response();
    handlers.get('post /api/interactive/experiences/:experienceId/tasks/:taskId/cancel')!(
      { params: { experienceId, taskId: retryTask!.taskId } }, cancel.res,
    );
    assert.equal(cancel.outcome.status, 200);
    const targets = [[1, 2], [3], [4], [5, 6], [7], [], [], []];
    answerModel({ summary: '多分支', storyMemory: { variables: [], facts: [] }, nodes: targets.map((next, index) => ({
      title: `节点${index}`, intent: '推动选择', narrativeSummary: '故事继续推进。',
      dramaticFunction: index >= 5 ? 'ending' : 'choice_point', durationRangeSec: [45, 90],
      choices: next.map((targetNodeIndex) => ({ text: `前往${targetNodeIndex}`, intent: '作出选择', targetNodeIndex })),
    })) });
    await retryPromise;
    assert.equal(retry.outcome.status, 409);
    assert.match(retry.outcome.body.error, /重试已取消/);
    assert.equal(interactiveRepository.getLatestGraphDraft(experienceId), null);
    assert.equal(interactiveRepository.getTaskCoordination(experienceId).taskRefs[0].status, 'cancelled');
    db.close();
  } finally {
    if (oldPath === undefined) delete process.env.OMNI_DB_PATH; else process.env.OMNI_DB_PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
