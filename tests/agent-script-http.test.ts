import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { blocksToScreenplayText } from '../packages/script/src/fountainAdapter';

const raw = readFileSync(new URL('./fixtures/agent-sol-rewrite-result.json', import.meta.url), 'utf8').trim();
const provenance = JSON.parse(readFileSync(new URL('./fixtures/agent-sol-rewrite-provenance.json', import.meta.url), 'utf8'));
const producer = { name: 'GPT-6 Sol 子 Agent 返回回放（模拟验收）', model: provenance.model };
const original = `门把手响了一声。\n\n${provenance.selectedText}\n\n门外，母亲把滴水的伞靠在墙边。`;
function launch(entry: string, filename: string, role = 'both') {
  const proc = fork(path.resolve(entry), [], { execArgv: ['--import', 'tsx'], env: { ...process.env, SCRIPT_AGENT_DB: filename, SCRIPT_AGENT_PORT: '0', SCRIPT_AGENT_ROLE: role,
    SCRIPT_AGENT_TRUSTED_LEGACY_OWNER:'isolated-author' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = ''; proc.stderr?.on('data', chunk => { errors += chunk; });
  const ready = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error(`Process startup timeout: ${errors}`)); }, 10000);
    proc.once('message', message => { clearTimeout(timer); resolve(message); });
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Process exit ${code}: ${errors}`)); });
  });
  return { proc, ready };
}
async function stop(proc: ChildProcess, force = false) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const ended = once(proc, 'exit'); proc.kill(force ? 'SIGKILL' : 'SIGTERM'); await ended;
}
async function setup(t: any, memoryText?: string) {
  const filename = `/tmp/agent-script-http-${randomUUID()}.sqlite`;
  const children: ChildProcess[] = [];
  let origin = '';
  const startApi = async () => {
    const child = launch('tests/agent-script-harness.ts', filename); children.push(child.proc);
    const ready = await child.ready; origin = `http://127.0.0.1:${ready.port}`; return child.proc;
  };
  const startWorker = async () => {
    const child = launch('apps/worker/src/script-agent-worker.ts', filename, 'child'); children.push(child.proc); await child.ready; return child.proc;
  };
  const startCoordinator = async () => {
    const child = launch('apps/worker/src/script-agent-worker.ts', filename, 'coordinator'); children.push(child.proc); await child.ready; return child.proc;
  };
  t.after(async () => { await Promise.all(children.map(child => stop(child))); for (const suffix of ['', '-wal', '-shm']) rmSync(filename + suffix, { force: true }); });
  const api = async (route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', expected = 200) => {
    const response = await fetch(origin + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : await response.text();
    assert.equal(response.status, expected, JSON.stringify(value)); return value as any;
  };
  const waitRun = async (id: string, target: string) => {
    for (let count = 0; count < 150; count++) {
      const state = await api(`/api/agent/runs/${id}`);
      if (state.run.status === target) return state;
      assert.notEqual(state.run.status, 'FAILED', JSON.stringify(state));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Run did not reach ${target}: ${JSON.stringify(await api(`/api/agent/runs/${id}`))}`);
  };
  const server = await startApi();
  const coordinator = await startCoordinator();
  const worker = await startWorker();
  const { project } = await api('/api/scripts', { title: 'Sol 模拟返回·隔离回归', profile: createScriptCreationProfile('short-film', 1, 5), initialBrief: { concept: '母女在一次夜雨中重新开口。', theme: '', outline: '', sceneText: original } }, 'POST', 201);
  const source = blocksToScreenplayText(project.units[0].scenes[0].blocks, []);
  const memory = memoryText ? await api(`/api/agent/scopes/${project.id}/memories`, { requestId: 'remember', memory: { key: 'author.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '模拟作者偏好', value: memoryText }, dependencies: [] } }, 'POST', 201) : undefined;
  const start = source.indexOf(provenance.selectedText);
  const command = { requestId: 'stable-rewrite', scopeId: project.id, kind: 'CAPABILITY', maxInvocations: 2, input: { request: { capabilityId: 'script.rewrite', capabilityVersion: '1', callId: 'selection', input: { projectId: project.id, expectedRevision: project.revision, unitId: project.units[0].id, sceneId: project.units[0].scenes[0].id, operation: 'text_rewrite', instruction: provenance.instruction, methodIds: [], channel: 'external', routeRef: 'simulation:gpt-6-sol', selection: { start, end: start + provenance.selectedText.length, text: provenance.selectedText } } } } };
  const accepted = await api('/api/agent/runs', command, 'POST', 202);
  const waiting = await waitRun(accepted.runId, 'WAITING_EXTERNAL');
  const external = waiting.externalRequests[0];
  const submit = () => api(`/api/agent/external/${external.id}/result`, { inputHash: external.inputHash, text: raw, producer });
  return { api, waitRun, server, worker, coordinator, startApi, startWorker, startCoordinator, project, source, command, accepted, external, submit, memory, filename };
}

test('real HTTP + worker restart: durable Sol return, duplicate command/result/adoption, fixed job input and current export', async t => {
  const h = await setup(t);
  assert.deepEqual(await h.api('/api/agent/runs', h.command, 'POST', 202), h.accepted);
  await h.api('/api/agent/runs', { ...h.command, maxInvocations: 3 }, 'POST', 409);
  assert.equal(h.external.request.inputManifest.operation, 'text_rewrite');
  assert.match(h.external.request.prompt, new RegExp(provenance.selectedText));
  await stop(h.server, true); await stop(h.worker, true); await stop(h.coordinator, true);
  await h.startApi();
  assert.deepEqual((await h.api(`/api/agent/external/${h.external.id}`)).request, h.external);
  await h.api(`/api/agent/external/${h.external.id}/result`, { inputHash: 'wrong', text: raw, producer }, 'POST', 409);
  await h.submit(); await h.submit();
  await h.startCoordinator(); await h.startWorker();
  const completed = await h.waitRun(h.accepted.runId, 'SUCCEEDED');
  const jobId = completed.run.result.data.jobId;
  const before = (await h.api(`/api/scripts/${h.project.id}`)).project;
  assert.equal(blocksToScreenplayText(before.units[0].scenes[0].blocks, []), h.source);
  const job = (await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}`)).job;
  assert.equal(job.rawResult, raw); assert.equal(job.provenance.modelId, 'gpt-6-sol');
  const adopted = await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}/approve`, {});
  assert.equal(adopted.project.revision, 2);
  assert.equal((await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}/approve`, {})).project.revision, 2);
  const reopened = (await h.api(`/api/scripts/${h.project.id}`)).project;
  assert.equal(blocksToScreenplayText(reopened.units[0].scenes[0].blocks, []), h.source.replace(provenance.selectedText, JSON.parse(raw).replacement));
  const baseline = (await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}/input`)).project;
  assert.equal(blocksToScreenplayText(baseline.units[0].scenes[0].blocks, []), h.source);
  const exported = await h.api(`/api/scripts/${h.project.id}/export?format=json`);
  assert.deepEqual(exported,reopened);
  await h.api(`/api/scripts/${h.project.id}/export?format=json&revision=1`,undefined,'GET',400);
  const { events } = await h.api(`/api/agent/threads/${h.accepted.threadId}/events`);
  assert.equal(events.filter((e: any) => e.type === 'step.committed').length, 1);
  assert.equal(events.filter((e: any) => e.type === 'step.handed_off').length, 1);
  assert.equal(events.filter((e: any) => e.type === 'step.completed').length, 1);
  assert.equal(events.filter((e: any) => e.type === 'model.prepared').length, 1);
  assert.equal(events.filter((e: any) => e.type === 'model.sent').length, 0);
});

test('author edits during model wait: preserve both candidate and new manuscript, reject stale adoption', async t => {
  const h = await setup(t);
  const changed = structuredClone(h.project);
  changed.units[0].scenes[0].blocks[0].text = '作者新写：门把手没有再响。';
  const saved = (await h.api(`/api/scripts/${h.project.id}`, { project: changed, expectedRevision: 1 }, 'PUT')).project;
  await h.submit();
  const completed = await h.waitRun(h.accepted.runId, 'SUCCEEDED');
  const jobId = completed.run.result.data.jobId;
  await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}/approve`, {}, 'POST', 409);
  assert.deepEqual((await h.api(`/api/scripts/${h.project.id}`)).project, saved);
  const job = (await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}`)).job;
  assert.equal(job.rawResult, raw); assert.equal(job.status, 'ready'); assert.equal(job.baseRevision, 1);
});

test('real worker respects pause and cancellation after a durable return', async t => {
  const h = await setup(t);
  let state = await h.api(`/api/agent/runs/${h.accepted.runId}`);
  const paused = (await h.api(`/api/agent/runs/${h.accepted.runId}/control`, { requestId: 'pause', expectedVersion: state.run.version, action: 'pause' })).run;
  await h.submit();
  await stop(h.worker); await h.startWorker();
  state = await h.api(`/api/agent/runs/${h.accepted.runId}`);
  assert.equal(state.run.status, 'PAUSED');
  assert.equal((await h.api(`/api/scripts/${h.project.id}/jobs`)).jobs.length, 0);
  await h.api(`/api/agent/runs/${h.accepted.runId}/control`, { requestId: 'resume', expectedVersion: paused.version, action: 'resume' });
  await h.waitRun(h.accepted.runId, 'SUCCEEDED');
  const second = await h.api('/api/agent/runs', { ...h.command, requestId: 'canceled-request' }, 'POST', 202);
  const waiting = await h.waitRun(second.runId, 'WAITING_EXTERNAL');
  await h.api(`/api/agent/runs/${second.runId}/control`, { requestId: 'cancel', expectedVersion: waiting.run.version, action: 'cancel' });
  const external = waiting.externalRequests[0];
  await h.api(`/api/agent/external/${external.id}/result`, { inputHash: external.inputHash, text: raw, producer });
  assert.equal((await h.api(`/api/agent/runs/${second.runId}`)).run.status, 'CANCELED');
  assert.equal((await h.api(`/api/scripts/${h.project.id}/jobs`)).jobs.length, 1);
  assert.equal((await h.api(`/api/scripts/${h.project.id}`)).project.revision, 1);
});

test('forget after candidate commit: redact old prompt/results/events and reject adoption without changing author manuscript', async t => {
  const secret = '仅作撤回验收的记忆标记，不属于剧本正文：灯芯甲';
  const h = await setup(t, secret);
  assert.ok(h.external.request.prompt.includes(secret));
  assert.equal(h.external.request.inputManifest.budget, undefined);
  await h.submit();
  const completed = await h.waitRun(h.accepted.runId, 'SUCCEEDED');
  const jobId = completed.run.result.data.jobId;
  const before = await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}`);
  assert.ok(before.job.prompt.includes(secret));
  await h.api(`/api/agent/scopes/${h.project.id}/memories/${h.memory.id}`, { requestId: 'forget', expectedRevision: 1, action: 'DELETE' });
  const external = await h.api(`/api/agent/external/${h.external.id}`);
  assert.equal(external.request.redacted, true); assert.equal(JSON.stringify(external).includes(secret), false);
  for (const route of [`/api/agent/runs/${h.accepted.runId}`, `/api/agent/threads/${h.accepted.threadId}/events`, `/api/scripts/${h.project.id}/jobs`, `/api/scripts/${h.project.id}/jobs/${jobId}`]) {
    const visible = await h.api(route); assert.equal(JSON.stringify(visible).includes(secret), false, route);
  }
  await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}/approve`, {}, 'POST', 409);
  await h.api(`/api/scripts/${h.project.id}/jobs/${jobId}/result`, { rawResult: raw, provenance: { source: 'manual_external', provider: producer.name, modelId: producer.model } }, 'POST', 409);
  assert.equal((await h.api(`/api/scripts/${h.project.id}`)).project.revision, 1);
});

test('forget while waiting: late Sol fixture remains restricted evidence and never creates a candidate', async t => {
  const h = await setup(t, '发送后才撤回的记忆标记：窗沿乙');
  await h.api(`/api/agent/scopes/${h.project.id}/memories/${h.memory.id}`, { requestId: 'forget', expectedRevision: 1, action: 'DELETE' });
  await h.submit(); await h.submit();
  const state = await h.waitRun(h.accepted.runId, 'NEEDS_REBASE');
  assert.equal(state.run.reason, 'CONTEXT_REVOKED');
  assert.equal(state.externalRequests[0].redacted, true);
  assert.equal((await h.api(`/api/scripts/${h.project.id}/jobs`)).jobs.length, 0);
  const db = new Database(h.filename, { readonly: true });
  try { assert.equal(JSON.parse((db.prepare('SELECT result_json FROM agent_invocations WHERE run_id=?').get(h.accepted.runId) as any).result_json).text, raw); }
  finally { db.close(); }
});

test('an empty memory query is a dependency: adding a matching preference invalidates the pending request', async t => {
  const h = await setup(t);
  await h.api(`/api/agent/scopes/${h.project.id}/memories`, { requestId: 'new-preference', memory: { key: 'author.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '新增偏好', value: '后续改写不要加入对白' }, dependencies: [] } }, 'POST', 201);
  await h.submit();
  const state = await h.waitRun(h.accepted.runId, 'NEEDS_REBASE');
  assert.equal(state.run.reason, 'MEMORY_COLLECTION_CHANGED');
  // No forgotten/private input: the old frozen request stays inspectable.
  assert.equal(state.externalRequests[0].redacted, undefined);
  assert.equal((await h.api(`/api/scripts/${h.project.id}/jobs`)).jobs.length, 0);
});
