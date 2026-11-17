import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';

// No UI, provider or production database: exercise the instructions with their actual JSON examples.
const directory = mkdtempSync(path.join(tmpdir(), 'a22-agent-guide-'));
process.env.OMNI_DB_PATH = path.join(directory, 'acceptance.sqlite');
const { db } = await import('../src/server/db');
assert.equal(db.name, process.env.OMNI_DB_PATH, 'Acceptance must never use the real workspace database');
const { createScriptRepository } = await import('../apps/api/src/repositories/scriptStore');
const { registerScriptRoutes } = await import('../apps/api/src/routes/scriptRoutes');
const { registerLegacyProjectRoutes } = await import('../src/server/routes/legacyProjectRoutes');
const { registerInteractiveRoutes } = await import('../src/server/routes/interactiveRoutes');
const { createInteractiveWritingPort } = await import('../src/server/interactiveWritingPort');
const { createInteractiveProductionPrepPort } = await import('../src/server/interactiveProductionPrepPort');
const { createLegacyProductionProjectFromWritingSource } = await import('../src/services/production/writingExportLegacyAdapter');
const guide = readFileSync('doc/agent-guide.md', 'utf8');
const example = (name: string) => JSON.parse(guide.split(`<!-- example:${name} -->`)[1].split('```json')[1].split('```')[0]);
const scripts = createScriptRepository(db);
scripts.ensureSchema();

test('published guide creates and persists script, production and interactive content through HTTP', async t => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  registerScriptRoutes(app, scripts, async () => []);
  registerLegacyProjectRoutes(app);
  const writingPort = createInteractiveWritingPort(scripts);
  registerInteractiveRoutes(app, { writingPort, productionPrepPort: createInteractiveProductionPrepPort({ scriptRepository: scripts, writingPort }), mediaAssetsDir: directory });
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    try { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (route: string, method = 'GET', body?: unknown, status = 200) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  };
  let author = (await call('/api/scripts', 'POST', example('script-create'), 201)).project;
  const A = `/api/scripts/${author.id}`;
  const originalRevision = author.revision;
  author.units[0].scenes[0].title = '归还钥匙';
  author.units[0].scenes[0].blocks[0].text = '来访者把捡到的钥匙放在柜台上。店主点头致谢。';
  author = (await call(A, 'PUT', { project: author, expectedRevision: originalRevision })).project;
  await call(A, 'PUT', { project: author, expectedRevision: originalRevision }, 409);
  assert.equal((await call(A)).project.units[0].scenes[0].blocks[0].text, author.units[0].scenes[0].blocks[0].text);
  const delivered = (await call(`${A}/delivery`)).package;
  const production = createLegacyProductionProjectFromWritingSource({ package: delivered, productionProjectId: 'agent-guide-production', importId: 'agent-guide-import' });
  await call('/api/projects', 'POST', production);
  await call('/api/projects', 'POST', production, 409);
  const P = `/api/projects/${production.id}`;
  const savedProduction = await call(P);
  assert.equal(savedProduction.productionSourceSnapshot.sourceWritingProjectId, author.id);
  const E = `${P}/episodes/${savedProduction.episodes[0].id}`;
  // Use the published PATCH, not a DB helper: a new session must recover the agreement.
  const beforeAgreement = await call(P);
  assert.equal(beforeAgreement.productionWorkingAgreement, undefined);
  const agreement = '作者约定：每单元三条候选，粗审一轮，重大问题最多返工一轮；精审由作者完成。';
  await call(P, 'PATCH', { productionWorkingAgreement: agreement });
  const afterAgreement = await call(P);
  assert.equal(afterAgreement.productionWorkingAgreement, agreement);
  assert.deepEqual(afterAgreement.episodes, beforeAgreement.episodes, 'agreement metadata must not rewrite scenes or media');
  assert.deepEqual(afterAgreement.productionSourceSnapshot, beforeAgreement.productionSourceSnapshot);
  await call(P, 'PATCH', { title: '制片接口验收作品' });
  assert.equal((await call(P)).productionWorkingAgreement, agreement, 'unrelated partial updates retain the agreement');
  const episode = await call(E);
  episode.title = '经接口修订的制片副本';
  await call(E, 'PUT', episode);
  await call(E, 'PUT', episode, 409);
  assert.equal((await call(E)).title, episode.title);

  let interactive = await call('/api/interactive/experiences', 'POST', example('interactive-create'), 201);
  const I = `/api/interactive/experiences/${interactive.experience.id}`;
  await call(`${I}/story-source`, 'PUT', { mode: 'bind_writing', writingProjectId: author.id });
  const scenes = await call(`${I}/writing-scenes`);
  assert.equal(scenes[0].ref.kind, 'script_scene');
  const state = { variables: [{ key: 'returned', type: 'boolean', scope: 'session', defaultValue: false }], factDefinitions: [], initialFactIds: [], expectedVersionIndex: interactive.stateSchema.versionIndex };
  await call(`${I}/state-schema`, 'PUT', state);
  await call(`${I}/state-schema`, 'PUT', state, 409);
  const node = (id: string) => ({ id, brief: { nodeId: id, title: '归还钥匙', intent: '归还物品', dramaticFunction: id === 'end' ? 'ending' : 'choice_point', narrativeSummary: '来访者交还钥匙，店主致谢。' },
    contract: { readVariables: [], writeVariables: id === 'start' ? ['returned'] : [], requiredFacts: [], producedFacts: [] },
    interaction: { capabilities: id === 'end' ? ['play_content', 'terminal'] : ['play_content', 'present_choice'], contentPolicy: 'create_shared_content', durationRangeSec: [5, 20], playerKnowledgeIn: [], playerKnowledgeOut: [] }, choices: [] });
  const graph = { entryNodeId: 'start', semanticContractVersion: 2, nodes: [node('start'), node('end')], transitions: [{ id: 'return', sourceNodeId: 'start', targetNodeId: 'end', text: '交还钥匙', intent: '归还失物', condition: { op: 'always' }, effects: [{ type: 'set', variable: 'returned', value: true }], interaction: { playerKnowledge: '这把钥匙属于店主', immediateFeedback: '店主收回钥匙', consequenceHorizon: 'immediate', thematicMeaning: '信任', convergenceStrategy: 'terminal', estimatedUniqueMediaSec: 5, replayValue: '无额外分支' } }] };
  // Writes use node choices; transitions are the persistence/read contract, not the editing payload.
  const graphInput = { entryNodeId: graph.entryNodeId, semanticContractVersion: 2, nodes: graph.nodes.map(item => ({ ...item,
    choices: graph.transitions.filter(edge => edge.sourceNodeId === item.id).map(({ sourceNodeId: _source, ...choice }) => choice),
  })) };
  await call(`${I}/graph`, 'PUT', { graph: graphInput, status: 'draft', expectedVersionIndex: interactive.graph.versionIndex });
  await call(`${I}/graph`, 'PUT', { graph: graphInput, status: 'draft', expectedVersionIndex: interactive.graph.versionIndex }, 409);
  const bindings = ['start', 'end'].map(nodeId => ({ nodeId, slot: 'main', scriptSceneRefs: [scenes[0].ref], status: 'approved', contentFitReview: { verdict: 'pass', rationale: '接口样例的正文确实描写归还钥匙和店主致谢；仅作测试，不是正式创作验收。', sceneChecksums: [scenes[0].ref.checksum], reviewedAt: new Date().toISOString() } }));
  interactive = await call(`${I}/bindings/script`, 'PUT', { bindings });
  assert.equal(interactive.bindings.length, 2);
  await call(`${I}/production-preparation`, 'POST', {});
  const prep = await call(`${I}/production-prep`, 'POST', {}, 201);
  assert.ok(prep.productionProjectId);
  const plan = await call(`${I}/production-plan`, 'POST', {}, 201);
  assert.equal(plan.experienceId, interactive.experience.id);
  await call(`${I}/production-plan/${plan.id}/adopt`, 'POST', {});
  const media = await call(`${I}/production-media?nodeId=start`);
  assert.ok(Array.isArray(media));
  const preview = await call(`${I}/structure-preview-build`, 'POST', {}, 201);
  assert.equal(preview.kind, 'structure_preview');
  assert.equal(preview.status, 'ready_for_preview');
  const exported = await fetch(`${base}${I}/runtime-export?runtimeBuildId=${encodeURIComponent(preview.id)}`);
  assert.equal(exported.status, 200);
  assert.match(await exported.text(), /<!doctype html/i);
  const current = await call(I);
  assert.equal(current.graph.transitions[0].effects[0].value, true);
  assert.deepEqual(current.bindings[0].scriptSceneRefs, [scenes[0].ref]);
  assert.equal((await call(A)).project.revision, author.revision, 'Downstream operations must not alter the author manuscript');
});
