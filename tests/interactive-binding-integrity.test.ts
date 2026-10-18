import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('whiteboard script remap keeps media and rejects stale or unversioned writes', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'interactive-binding-integrity-'));
  const oldPath = process.env.OMNI_DB_PATH;
  process.env.OMNI_DB_PATH = path.join(directory, 'test.sqlite');
  try {
    const { db } = await import('../src/server/db');
    const { interactiveRepository } = await import('../src/server/interactiveRepository');
    const { registerInteractiveRoutes } = await import('../src/server/routes/interactiveRoutes');
    const ref = { kind: 'script_scene' as const, artifactId: 'scene:fixed', versionId: 'script-revision:1', checksum: 'fixed-content' };
    const media = { kind: 'media_take' as const, artifactId: 'take:fixed', versionId: 'take:1', checksum: 'fixed-media' };
    const scene = { ref, writingProjectId: 'script-test', writingProjectTitle: 'Test', writingProjectRevision: 1,
      unitId: 'unit-1', unitIndex: 1, unitTitle: 'Unit', sceneId: 'scene-1', sceneIndex: 1,
      sceneTitle: 'Fixed', synopsis: 'Original', characters: [], scriptBlocks: [{ type: 'action' as const, content: 'Fixed' }] };
    const experience = interactiveRepository.createExperience({
      title: '绑定完整性', genre: '悬疑',
      formatProfile: { format: 'branching_fmv', aspectRatio: '16:9', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 3, targetCompleteMinutes: 3 },
      experienceSpec: { playerRole: '玩家', playerPersona: '谨慎', interactionPromise: '选择改变结果', coreVerbs: ['选择'],
        dramaticContract: { genre: '悬疑', theme: '选择', centralConflict: '开门' }, choiceCadence: { targetChoicesPerTenMinutes: 1, maxMinutesWithoutChoice: 3 },
        consequenceHorizon: ['immediate'], failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
        accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true } },
      storyArchitecture: { premise: '门前', protagonistGoal: '开门', thematicQuestion: '是否开门', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 1, maxParallelBranches: 1 } },
      storySource: { mode: 'bind_writing', writingProjectId: 'script-test' },
      productionBoundary: { maxBranchDepth: 1, maxParallelBranches: 1, exclusiveContentPercent: 0, maxAutomaticRepairAttempts: 1 },
    });
    const id = experience.experience.id;
    interactiveRepository.saveGraph(id, { entryNodeId: 'node-1', nodes: [{ id: 'node-1',
      brief: { nodeId: 'node-1', title: '门前', intent: '开门', dramaticFunction: 'ending', narrativeSummary: '门前选择' },
      contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [],
      interaction: { capabilities: ['play_content', 'terminal'], contentPolicy: 'create_shared_content', durationRangeSec: [1, 60], playerKnowledgeIn: [], playerKnowledgeOut: [] },
    }] });
    const original = interactiveRepository.saveBinding(id, { nodeId: 'node-1', slot: 'main', status: 'approved', scriptSceneRefs: [ref],
      mediaTakeRefs: [media], mediaScenarios: [{ scenarioId: 'state-1', reuseFingerprint: 'visual-1', mediaTakeRefs: [media] }],
      contentFitReview: { verdict: 'pass', rationale: '作者确认', reviewedAt: new Date().toISOString(), sceneChecksums: [ref.checksum] },
      mediaFitReview: { verdict: 'pass', rationale: '作者确认', reviewedAt: new Date().toISOString(), mediaChecksums: [media.checksum] } }).bindings[0];
    const handlers = new Map<string, (req: any, res: any) => any>();
    const app = Object.fromEntries(['get', 'put', 'post', 'delete'].map((method) => [method, (route: string, handler: any) => handlers.set(`${method} ${route}`, handler)])) as any;
    registerInteractiveRoutes(app, { writingPort: { listProjects: () => [], hasProject: () => true, listScenes: () => [scene],
      getGenerationStatus: () => ({ state: 'ready' }), resolveScene: (candidate: typeof ref) => candidate.checksum === ref.checksum ? scene : null } });
    const call = (method: string, route: string, body?: unknown, query: Record<string, string> = {}) => {
      let result: any; let status = 200;
      const response = { status(code: number) { status = code; return this; }, json(value: unknown) { result = value; return this; } };
      handlers.get(`${method} ${route}`)!({ params: { experienceId: id }, query, body }, response);
      return { status, result };
    };
    const whiteboard = call('get', '/api/interactive/experiences/:experienceId', undefined, { view: 'whiteboard' }).result.bindings[0];
    assert.equal(whiteboard.versionIndex, original.versionIndex);
    assert.deepEqual(whiteboard.mediaScenarios, original.mediaScenarios);
    const body = { bindings: [{ nodeId: 'node-1', slot: 'main', versionIndex: whiteboard.versionIndex, scriptSceneRefs: [ref],
      contentFitReview: { verdict: 'pass', rationale: '再次确认同一场景', reviewedAt: new Date().toISOString(), sceneChecksums: [ref.checksum] }, status: 'approved' }] };
    const updated = call('put', '/api/interactive/experiences/:experienceId/bindings/script', body);
    assert.equal(updated.status, 200);
    const binding = updated.result.bindings[0];
    assert.deepEqual(binding.mediaScenarios, original.mediaScenarios);
    assert.deepEqual(binding.mediaFitReview, original.mediaFitReview);
    assert.equal(binding.versionIndex, original.versionIndex! + 1);
    assert.equal(call('put', '/api/interactive/experiences/:experienceId/bindings/script', body).status, 409);
    assert.equal(call('put', '/api/interactive/experiences/:experienceId/bindings', { ...binding, versionIndex: undefined }).status, 409);
    db.close();
  } finally {
    if (oldPath === undefined) delete process.env.OMNI_DB_PATH; else process.env.OMNI_DB_PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
