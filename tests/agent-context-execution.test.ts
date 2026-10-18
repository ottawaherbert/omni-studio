import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { AgentError, hashValue, invokeModel, type AccessContext, type ModelTransport } from '../packages/agent-core/src';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProjectFromMaterial, createScriptCreationProfile } from '../packages/script/src/creation';
import { blocksToScreenplayText } from '../packages/script/src/fountainAdapter';
import { compileContext } from '../packages/agent-context/src';

// Replays the exact Sol-generated fixture to exercise consumption boundaries;
// the transport is a protocol fault injector, not a new model generation.
const raw = readFileSync(new URL('./fixtures/agent-sol-rewrite-result.json', import.meta.url), 'utf8').trim();
const provenance = JSON.parse(readFileSync(new URL('./fixtures/agent-sol-rewrite-provenance.json', import.meta.url), 'utf8'));
const result = { text: raw, provenance: { channel: 'provider' as const, producer: 'GPT-6 Sol subagent fixture replay', model: 'gpt-6-sol' } };
const code = (value: string) => (error: unknown) => error instanceof AgentError && error.code === value;
function setup(t: any, transport: ModelTransport) {
  const db = new Database(':memory:'); t.after(() => db.close());
  const host = createScriptAgentHost(db, transport, 'worker', {trustedLegacyProjectOwner:'author'});
  const project = host.scripts.saveProject(createScriptProjectFromMaterial('隔离上下文边界', createScriptCreationProfile('short-film', 1, 5), { concept: '', theme: '', outline: '', sceneText: `门把手响了一声。\n\n${provenance.selectedText}\n\n门外，母亲把滴水的伞靠在墙边。` }), 0);
  const access = { ownerId: 'author', scopeId: project.id, branch: 'author' };
  const memory = host.contexts.createMemory(access, 'author', 'remember', { key: 'author.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '测试记忆', value: '这是一个待撤回的参考偏好' }, dependencies: [] });
  const source = blocksToScreenplayText(project.units[0].scenes[0].blocks, []), start = source.indexOf(provenance.selectedText);
  const request = { capabilityId: 'script.rewrite', capabilityVersion: '1', callId: 'rewrite', input: { projectId: project.id, expectedRevision: 1, unitId: project.units[0].id, sceneId: project.units[0].scenes[0].id, operation: 'text_rewrite', instruction: provenance.instruction, channel: 'api', routeRef: 'simulation:gpt-6-sol', methodIds: [], selection: { start, end: start + provenance.selectedText.length, text: provenance.selectedText } } };
  const accepted = host.store.accept({ ownerId: 'author', scopeId: project.id, requestId: 'rewrite', kind: 'CAPABILITY', input: { request }, policyRevision: 'local-author.v1', maxInvocations: 2 });
  const forget = () => host.contexts.updateMemory(access, 'forget', memory.id, 1, 'DELETE');
  const prepare = async () => {
    const claim = host.store.claim('manual-test-driver', 30000, accepted.runId)!;
    const context: AccessContext = { ownerId: 'author', scopeId: project.id, commandRevision: String(claim.run.generation), policyRevision: claim.run.policyRevision, execution: claim.token, signal: new AbortController().signal };
    const prepared = await host.registry.prepare(request, context);
    const step = host.store.savePrepared(claim.token, prepared, hashValue(request));
    host.store.handoff(claim.token, step.id);
    const child = host.store.claimChild('manual-child-driver', 30000, accepted.runId)!;
    return { prepared, claim: child, context: { ...context, execution: child.token } };
  };
  return { db, host, project, access, request, accepted, forget, prepare };
}

test('forget after preparation but before SENT prevents the physical model call', async t => {
  let sends = 0;
  const h = setup(t, { sendOnce: async () => { sends++; return result; } });
  const { prepared, context } = await h.prepare(); h.forget();
  await assert.rejects(h.host.registry.execute(prepared, context), code('CONTEXT_REVOKED'));
  assert.equal(sends, 0);
  assert.equal((h.db.prepare('SELECT count(*) AS n FROM agent_attempts').get() as any).n, 0);
});

test('forget during an in-flight request saves raw evidence but suspends candidate consumption', async t => {
  let forget!: () => unknown;
  const h = setup(t, { sendOnce: async () => { forget(); return result; } }); forget = h.forget;
  await h.host.worker.runOnce(h.accepted.runId); await h.host.childWorker.runOnce(h.accepted.runId); await h.host.worker.runOnce(h.accepted.runId);
  assert.equal(h.host.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  assert.equal(h.host.scripts.listJobs(h.project.id).length, 0);
  assert.equal(JSON.parse((h.db.prepare('SELECT result_json FROM agent_invocations').get() as any).result_json).text, raw);
});

test('forget after result validation but before domain commit rolls back candidate/link/receipt together', async t => {
  const h = setup(t, { sendOnce: async () => result });
  const original = h.host.journal.assertInput.bind(h.host.journal); let checks = 0;
  h.host.journal.assertInput = (token, request) => { original(token, request); if (++checks === 2) queueMicrotask(h.forget); };
  await h.host.worker.runOnce(h.accepted.runId); await h.host.childWorker.runOnce(h.accepted.runId); await h.host.worker.runOnce(h.accepted.runId);
  assert.equal(checks, 2);
  assert.equal(h.host.store.readRun(h.accepted.runId).status, 'NEEDS_REBASE');
  for (const table of ['script_jobs', 'script_job_inputs', 'agent_context_artifacts']) assert.equal((h.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n, 0);
  assert.equal((h.db.prepare("SELECT count(*) AS n FROM agent_steps WHERE status='COMMITTED'").get() as any).n, 0);
  assert.equal((h.db.prepare("SELECT status FROM agent_invocations").get() as any).status, 'RECEIVED');
});

test('exact RECEIVED replay still requires current context authority; no second physical send', async t => {
  let sends = 0;
  const transport = { sendOnce: async () => { sends++; return result; } };
  const h = setup(t, transport);
  const { prepared, context } = await h.prepare();
  const request = (prepared.request.input as any).frozen.model;
  await invokeModel(h.host.journal, transport, context.execution, request, context.signal);
  h.forget();
  await assert.rejects(invokeModel(h.host.journal, transport, context.execution, request, context.signal), code('CONTEXT_REVOKED'));
  assert.equal(sends, 1);
});

test('committed Step replay cannot spread a withdrawn summary after lease recovery', async t => {
  let sends = 0;
  const h = setup(t, { sendOnce: async () => { sends++; return result; } });
  const { prepared, context, claim } = await h.prepare();
  const observation = await h.host.registry.execute(prepared, context);
  assert.equal(observation.status, 'SUCCEEDED'); h.forget();
  h.db.prepare('UPDATE agent_step_leases SET lease_until=0 WHERE step_id=?').run(claim.token.stepId!);
  await h.host.childWorker.runOnce(claim.run.id);
  assert.equal(h.host.store.readRun(claim.run.id).status, 'NEEDS_REBASE');
  assert.equal(sends, 1);
  assert.throws(() => h.host.scripts.transition(h.project.id, (observation.data as any).jobId, 'approve'), code('CONTEXT_REVOKED'));
  assert.throws(() => h.host.scripts.getJobInput(h.project.id, (observation.data as any).jobId), code('CONTEXT_REVOKED'));
});

test('another legacy repository cannot expose or adopt a context-bound candidate without its guard', async t => {
  const { createScriptRepository } = await import('../apps/api/src/repositories/scriptStore');
  const h = setup(t, { sendOnce: async () => result });
  await h.host.worker.runOnce(h.accepted.runId); await h.host.childWorker.runOnce(h.accepted.runId); await h.host.worker.runOnce(h.accepted.runId);
  const job = h.host.scripts.listJobs(h.project.id)[0];
  h.forget();
  const legacy = createScriptRepository(h.db);
  for (const operation of [() => legacy.getJob(h.project.id, job.id), () => legacy.getJobInput(h.project.id, job.id), () => legacy.listJobs(h.project.id), () => legacy.transition(h.project.id, job.id, 'approve'), () => legacy.submitJob(h.project.id, job.id, raw, { channel: 'external' }), () => legacy.failJob(h.project.id, job.id, 'old-path')]) {
    assert.throws(operation, (error: any) => error.code === 'CONTEXT_GUARD_MISSING');
  }
  assert.equal(h.host.scripts.getProject(h.project.id)!.revision, 1);
});

test('explicit task input survives an author update while CURRENT, forged hashes and revoked sources remain guarded',async t=>{
  const h=setup(t,{sendOnce:async()=>result}),{prepared}=await h.prepare();
  const model=(prepared.request.input as any).frozen.model;
  const original=prepared.sources[0];
  const current=h.host.contexts.capture(h.access,compileContext({systemInstruction:'机械当前稿依赖',skills:[],sections:[{id:'current',text:'机械协议测试',required:true,priority:1,dependencies:[{ref:original,freshness:'CURRENT'}]}]}));
  const next=h.host.scripts.saveProject({...h.project,title:'已更新的当前作者稿'},h.project.revision);
  assert.deepEqual(h.host.scripts.readProjectInput(h.project.id,h.project.revision),h.project);
  assert.equal(h.host.scripts.getProject(h.project.id)!.revision,next.revision);
  assert.doesNotThrow(()=>h.host.contexts.assertAllowed(model.contextRef,h.access));
  assert.throws(()=>h.host.contexts.assertAllowed(current,h.access),code('CONTEXT_SOURCE_INVALID'));
  assert.throws(()=>h.host.contexts.capture(h.access,compileContext({systemInstruction:'机械摘要篡改',skills:[],sections:[{id:'forged',text:'机械协议测试',required:true,priority:1,dependencies:[{ref:{...original,contentHash:'0'.repeat(64)},freshness:'EXACT'}]}]})),code('CONTEXT_SOURCE_INVALID'));
  h.host.scripts.deleteProject(h.project.id);
  assert.equal(h.host.scripts.readProjectInput(h.project.id,h.project.revision),null);
  assert.throws(()=>h.host.contexts.assertAllowed(model.contextRef,h.access),code('CONTEXT_SOURCE_INVALID'));
});
