import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Episode } from '../src/types/project';

// This acceptance crosses the real script, production and interactive adapters
// while all data stays in a disposable database and no generator is installed.
const directory = mkdtempSync(path.join(tmpdir(), 'a22-module-independence-'));
process.env.OMNI_DB_PATH = path.join(directory, 'acceptance.sqlite');
const { db, dbHelpers } = await import('../src/server/db');
const { createScriptRepository } = await import('../apps/api/src/repositories/scriptStore');
const { createScriptProject } = await import('../packages/script/src/project');
const { createScriptCreationProfile } = await import('../packages/script/src/creation');
const { registerScriptRoutes } = await import('../apps/api/src/routes/scriptRoutes');
const { registerLegacyProjectRoutes } = await import('../src/server/routes/legacyProjectRoutes');
const { createLegacyProductionProjectFromWritingSource } = await import('../src/services/production/writingExportLegacyAdapter');
const { createInteractiveWritingPort } = await import('../src/server/interactiveWritingPort');
const { createInteractiveProductionPrepPort } = await import('../src/server/interactiveProductionPrepPort');
const { interactiveRepository } = await import('../src/server/interactiveRepository');
const scripts = createScriptRepository(db);
scripts.ensureSchema();

test('three modules exchange fixed content without writing back or silently following the author manuscript', async t => {
  const app = express();
  app.use(express.json());
  registerScriptRoutes(app, scripts, async () => []);
  registerLegacyProjectRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', status = 200) => {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  };

  const manuscript = createScriptProject('边界验收', createScriptCreationProfile('short-film', 1, 3));
  manuscript.profile.aspectRatio = '9:16';
  manuscript.brief.constraints = '保持门外人物身份不明';
  manuscript.units[0].targetDurationMs = 90 * 60_000;
  manuscript.units[0].summary = 'UNBOUND_SUMMARY_覆盖整部长片而非单节点';
  manuscript.units[0].scenes[0].blocks[0].text = '门外的人放下一把铜钥匙，始终没有露面。';
  manuscript.units[0].scenes.push({
    ...structuredClone(manuscript.units[0].scenes[0]),
    id: 'unbound-second-scene',
    title: '不在绑定中的场次',
    targetDurationMs: 120_000,
    blocks: [{ ...manuscript.units[0].scenes[0].blocks[0], id: 'unbound-second-block', text: 'UNBOUND_SECOND_SCENE_不得进入互动制片来源' }],
  });
  let author = scripts.saveProject(manuscript, 0);
  const delivered = (await request(`/api/scripts/${author.id}/delivery`)).package;
  const imported = createLegacyProductionProjectFromWritingSource({ package: delivered, productionProjectId: 'independent-production', importId: 'independent-import' });
  const productionEpisode = imported.episodes[0] as Episode;
  productionEpisode.scenes = [{ id: 'production-scene', title: '门外', sceneNumber: '1', description: '', shots: [
    { id: 'production-shot', duration: 4, videoUrl: '/media/old.mp4', visualAction: '钥匙落地' },
  ] }] as Episode['scenes'];
  await request('/api/projects', imported);
  let productionBefore = await request(`/api/projects/${imported.id}`);
  assert.equal(productionBefore.aspectRatio, '9:16');
  assert.equal(productionBefore.productionScriptWorkspace.syncPolicy, 'manual');

  const writing = createInteractiveWritingPort(scripts);
  const fixedScene = writing.listScenes(author.id)[0];
  const secondFixedScene = writing.listScenes(author.id).find(scene => scene.sceneId === 'unbound-second-scene')!;
  const interactive = interactiveRepository.createExperience({
    title: '互动边界验收', genre: '悬疑',
    formatProfile: { format: 'branching_fmv', aspectRatio: '9:16', platforms: ['web'], primaryLanguage: 'zh-CN', targetSessionMinutes: 3, targetCompleteMinutes: 3 },
    experienceSpec: { playerRole: '收信人', playerPersona: '观察者', interactionPromise: '玩家观察来信', coreVerbs: ['观察'],
      dramaticContract: { genre: '悬疑', theme: '未知', centralConflict: '是否开门' }, choiceCadence: { targetChoicesPerTenMinutes: 1, maxMinutesWithoutChoice: 3 },
      consequenceHorizon: ['immediate'], failStatePolicy: 'rollback', savePolicy: 'auto_checkpoint',
      accessibilitySettings: { closedCaptions: true, timedChoiceOption: 'extended', colorBlindSafe: true } },
    storyArchitecture: { premise: '一把钥匙', protagonistGoal: '确认来者', thematicQuestion: '是否信任', mandatoryNodes: [], variableNodes: [], endings: [], branchBudget: { maxDepth: 1, maxParallelBranches: 1 } },
    storySource: { mode: 'bind_writing', writingProjectId: author.id },
    productionBoundary: { maxBranchDepth: 1, maxParallelBranches: 1, exclusiveContentPercent: 0, maxAutomaticRepairAttempts: 0 },
  });
  const experienceId = interactive.experience.id;
  interactiveRepository.saveGraph(experienceId, { entryNodeId: 'ending', nodes: [{ id: 'ending',
    brief: { nodeId: 'ending', title: '门外', intent: '留下悬念', dramaticFunction: 'ending', narrativeSummary: '钥匙留下，身份未知。' },
    contract: { readVariables: [], writeVariables: [], requiredFacts: [], producedFacts: [] }, choices: [],
    interaction: { capabilities: ['play_content'], contentPolicy: 'create_shared_content', durationRangeSec: [10, 20], playerKnowledgeIn: [], playerKnowledgeOut: ['有人来过'] },
  }] });
  interactiveRepository.saveBindings(experienceId, [{ nodeId: 'ending', slot: 'main', status: 'approved', scriptSceneRefs: [fixedScene.ref],
    contentFitReview: { verdict: 'pass', rationale: '正文完整保留人物不露面的悬念', sceneChecksums: [fixedScene.ref.checksum], reviewedAt: new Date().toISOString() } }]);
  const bindingBefore = interactiveRepository.getExperience(experienceId).bindings;
  const prep = createInteractiveProductionPrepPort({ scriptRepository: scripts, writingPort: writing });
  const seed = prep.ensureTarget(experienceId);
  const seedProfile = dbHelpers.getProjectById(seed.productionProjectId)!.interactiveProductionPrepProfile!;
  dbHelpers.saveProject({
    ...dbHelpers.getProjectById(imported.id)!,
    interactiveProductionPrepProfile: { ...seedProfile, sourceHash: imported.productionSourceSnapshot!.sourceHash },
  });
  productionBefore = await request(`/api/projects/${imported.id}`);
  interactiveRepository.saveProductionPrepTarget({
    experienceId,
    productionProjectId: imported.id,
    sourceWritingProjectId: author.id,
    sourceWritingRevision: author.revision,
    sourceHash: imported.productionSourceSnapshot!.sourceHash,
  });
  const staleTarget = prep.getTarget(experienceId);
  assert.equal(staleTarget?.productionProjectId, imported.id);
  assert.equal(staleTarget?.nodeTargets?.[0].isCurrentForNode, false, 'GET target marks old whole-unit scope stale before the UI navigates');
  const target = prep.ensureTarget(experienceId);
  assert.notEqual(target.productionProjectId, imported.id, 'interactive production owns a separate preparation project');
  assert.equal(prep.getTarget(experienceId)?.nodeTargets?.[0].isCurrentForNode, true, 'new exact scope can be reused by the same UI entry');
  assert.deepEqual(dbHelpers.getProjectById(imported.id), productionBefore, 'the old whole-unit target and its user scene remain untouched');
  assert.deepEqual(scripts.getProject(author.id), author, 'preparing interactive production never edits the author manuscript');
  const scopedProject = dbHelpers.getProjectById(target.productionProjectId)!;
  assert.equal(scopedProject.productionSourceSnapshot?.sourceType, 'writing_export');
  assert.equal(scopedProject.productionSourceSnapshot?.package.sourceRevision, author.revision);
  assert.deepEqual(scopedProject.productionSourceSnapshot?.package.units[0].scenes?.map(scene => scene.id), [fixedScene.sceneId]);
  assert.doesNotMatch(scopedProject.productionSourceSnapshot!.package.units[0].summary, /UNBOUND_SUMMARY/);
  assert.equal(scopedProject.productionSourceSnapshot?.sourceHash, target.sourceHash);
  const scopedImportedAt = scopedProject.productionSourceSnapshot!.importedAt;
  assert.equal(scopedProject.productionSourceDocuments?.length, 1);
  assert.match(scopedProject.productionSourceDocuments![0].content, /放下一把铜钥匙/);
  assert.doesNotMatch(scopedProject.productionSourceDocuments![0].content, /UNBOUND_SECOND_SCENE/);
  assert.equal(scopedProject.durationMinutes, 0.25, 'node duration range determines the one-scene work scope, not the 90-minute source unit');
  assert.equal(scopedProject.episodes[0].targetDuration, 0.25);
  const scopedPlan = prep.createPlan(experienceId);
  assert.equal(scopedPlan.impact.productionSceneCount, 1);
  assert.deepEqual(scopedPlan.units[0].scenes[0].interactiveNodeIds, ['ending']);

  const revised = structuredClone(author);
  revised.units[0].scenes[0].blocks[0].text = '作者另行修改当前稿：门外的人拿走了钥匙。';
  author = (await request(`/api/scripts/${author.id}`, { project: revised, expectedRevision: author.revision }, 'PUT')).project;
  assert.deepEqual(await request(`/api/projects/${imported.id}`), productionBefore, 'author changes do not mutate the production copy');
  assert.deepEqual(interactiveRepository.getExperience(experienceId).bindings, bindingBefore, 'author changes do not replace adopted interactive content');
  assert.match(writing.resolveScene(fixedScene.ref)!.scriptBlocks.map(block => block.content).join('\n'), /放下一把铜钥匙/);
  assert.equal(prep.ensureTarget(experienceId).productionProjectId, target.productionProjectId, 'the same fixed interactive source reuses its production project');
  assert.equal(dbHelpers.getProjectById(target.productionProjectId)?.productionSourceSnapshot?.sourceHash, target.sourceHash);
  assert.equal(dbHelpers.getProjectById(target.productionProjectId)?.productionSourceSnapshot?.importedAt, scopedImportedAt, 'reuse does not reimport or rewrite the fixed source');

  const episodePath = `/api/projects/${imported.id}/episodes/${imported.episodes[0].id}`;
  const pageA = await request(episodePath);
  const pageB = structuredClone(pageA);
  pageA.scenes[0].shots[0].videoUrl = '/media/adopted.mp4';
  await request(episodePath, pageA, 'PUT');
  pageB.scenes[0].shots[0].duration = 7;
  await request(episodePath, pageB, 'PUT', 409);
  const current = await request(episodePath);
  assert.equal(current.scenes[0].shots[0].videoUrl, '/media/adopted.mp4');
  assert.equal(current.scenes[0].shots[0].duration, 4);
  await request('/api/projects', productionBefore, 'POST', 409);
  assert.deepEqual(scripts.getProject(author.id), author, 'production writes never write back into the author manuscript');
  assert.deepEqual(interactiveRepository.getExperience(experienceId).bindings, bindingBefore, 'unrelated production writes do not change interactive bindings');

  interactiveRepository.saveBindings(experienceId, [{ nodeId: 'ending', slot: 'main', status: 'approved', versionIndex: bindingBefore[0].versionIndex, scriptSceneRefs: [secondFixedScene.ref],
    contentFitReview: { verdict: 'pass', rationale: '改选有明确源时长的固定场次', sceneChecksums: [secondFixedScene.ref.checksum], reviewedAt: new Date().toISOString() } }]);
  const sourceDurationTarget = prep.ensureTarget(experienceId);
  assert.notEqual(sourceDurationTarget.productionProjectId, target.productionProjectId, 'changed exact scene refs create a fresh scoped target');
  const sourceDurationProject = dbHelpers.getProjectById(sourceDurationTarget.productionProjectId)!;
  assert.equal(sourceDurationProject.durationMinutes, 2, 'source scene duration wins over the node duration range and 90-minute unit');
  assert.equal(prep.createPlan(experienceId).units[0].scenes[0].targetDurationMinutes, 2);
  assert.deepEqual(sourceDurationProject.productionSourceSnapshot?.package.units[0].scenes?.map(scene => scene.id), [secondFixedScene.sceneId]);
  assert.doesNotMatch(sourceDurationProject.productionSourceDocuments![0].content, /放下一把铜钥匙/);
  assert.equal(prep.ensureTarget(experienceId).productionProjectId, sourceDurationTarget.productionProjectId, 'the same scoped source reuses one target');
  assert.equal(dbHelpers.getProjectById(target.productionProjectId)?.productionSourceSnapshot?.sourceHash, target.sourceHash, 'earlier scoped target remains inspectable');
  assert.equal((await request(`/api/projects/${imported.id}`)).episodes[0].scenes[0].shots[0].videoUrl, '/media/adopted.mp4', 'legacy target preserves later user media edits');
});
