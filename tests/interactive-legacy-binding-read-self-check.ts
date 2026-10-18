import assert from 'node:assert/strict';

import { db } from '../src/server/db.ts';
import { ensureInteractiveSchema, interactiveRepository } from '../src/server/interactiveRepository.ts';

ensureInteractiveSchema();

const aggregate = interactiveRepository.createExperience({
  title: '旧单场绑定读取验收',
  genre: '悬疑',
  formatProfile: {
    format: 'branching_fmv',
    aspectRatio: '16:9',
    platforms: ['web'],
    primaryLanguage: 'zh-CN',
    targetSessionMinutes: 5,
    targetCompleteMinutes: 10,
  },
  experienceSpec: {
    playerRole: '调查者',
    playerPersona: '见证者',
    interactionPromise: '选择改变线索。',
    coreVerbs: ['调查'],
    dramaticContract: { genre: '悬疑', theme: '真相', centralConflict: '公开与保护' },
    choiceCadence: { targetChoicesPerTenMinutes: 2, maxMinutesWithoutChoice: 5 },
    consequenceHorizon: ['immediate'],
    failStatePolicy: 'rollback',
    savePolicy: 'auto_checkpoint',
    accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true },
  },
  storyArchitecture: {
    premise: '旧项目迁移',
    protagonistGoal: '找到证词',
    thematicQuestion: '是否公开',
    mandatoryNodes: [],
    variableNodes: [],
    endings: [],
    branchBudget: { maxDepth: 2, maxParallelBranches: 2 },
  },
  storySource: { mode: 'import' },
  productionBoundary: {
    maxBranchDepth: 2,
    maxParallelBranches: 2,
    exclusiveContentPercent: 10,
    maxAutomaticRepairAttempts: 2,
  },
});

try {
  const nodeId = aggregate.graph.entryNodeId;
  const legacyRef = {
    artifactId: 'legacy-writing-scene',
    versionId: 'writing-project-revision:1',
    kind: 'script_scene',
    checksum: 'legacy-scene-checksum',
  };
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO interactive_node_content_bindings
      (id, experience_id, node_id, slot, status, created_at, updated_at, current_version_id, data)
    VALUES (?, ?, ?, 'main', 'approved', ?, ?, NULL, ?)
  `).run(
    'legacy-single-binding',
    aggregate.experience.id,
    nodeId,
    timestamp,
    timestamp,
    JSON.stringify({
      nodeId,
      slot: 'main',
      status: 'approved',
      scriptSceneRef: legacyRef,
    }),
  );

  ensureInteractiveSchema();
  const migrated = interactiveRepository.getExperience(aggregate.experience.id)
    .bindings.find((binding) => binding.nodeId === nodeId && binding.slot === 'main');
  assert.deepEqual(migrated?.scriptSceneRefs, [legacyRef]);
  assert.equal(migrated?.versionIndex, 1);
  assert.equal(
    interactiveRepository.listBindingVersions(aggregate.experience.id, nodeId, 'main').length,
    1,
    'A legacy singular binding must migrate to exactly one immutable binding version',
  );
} finally {
  interactiveRepository.deleteExperience(aggregate.experience.id);
}

console.log('Interactive legacy singular binding read self-check passed.');
