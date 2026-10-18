import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createScriptCreationProfile } from '../packages/script/src/creation';
import { blocksToScreenplayText } from '../packages/script/src/fountainAdapter';

// Two-stage real API acceptance. Capture does not fabricate a model response;
// only the authorized GPT-6 Sol child writes the returned fixture in between.
const mode = process.argv[2];
const origin = process.env.SCRIPT_CONTEXT_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Explicit isolated localhost origin required');
const evidenceRoot = 'artifacts/agent-foundation-study-2026-09-26';
const packetPath = `${evidenceRoot}/sol-context-request.json`;
async function api(path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data;
}
async function waitRun(id: string, target: string) {
  let state: any;
  for (let i = 0; i < 100; i++) {
    state = await api(`/api/agent/runs/${id}`);
    if ([target, 'FAILED', 'NEEDS_REBASE'].includes(state.run.status)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(state.run.status, target, JSON.stringify(state)); return state;
}
if (mode === 'capture') {
  const selected = '林夏很紧张，不知道要不要开门。';
  const initial = await api('/api/scripts', { title: '验收·有记忆与 Skill 的局部改写', profile: createScriptCreationProfile('short-film', 1, 5), initialBrief: { concept: '母女在夜雨中重新开口。', theme: '', outline: '', sceneText: `门把手响了一声。\n\n${selected}\n\n门外，母亲把滴水的伞靠在墙边。` } });
  const method = { id: 'skill:acceptance-observable-action', title: '验收用可见动作', version: '7', content: '把心理说明转成演员可以表演的可见动作。只使用已出现的环境和物件，不添加对白。结尾仍停在门未打开时，不能代替作者解决母女关系。', usage: { operations: ['text_rewrite'], inputs: [], note: '本作品动作应短而克制，避免夸张生理反应。' } };
  const { project } = await api(`/api/scripts/${initial.project.id}`, { project: { ...initial.project, methods: [method] }, expectedRevision: initial.project.revision }, 'PUT');
  const memory = await api(`/api/agent/scopes/${project.id}/memories`, { requestId: 'sol-context-author-preference', memory: { key: 'author.preference', kind: 'AUTHOR_PREFERENCE', content: { label: '作者写法偏好', value: '用小动作和停顿表达犹豫，不用“心如擂鼓”一类套语。' }, dependencies: [] } });
  const source = blocksToScreenplayText(project.units[0].scenes[0].blocks, []), start = source.indexOf(selected);
  assert.ok(start >= 0);
  const instruction = '只改选中的一句，用动作表现她想开门又停住的犹豫，不增加对白或人物。';
  const accepted = await api('/api/agent/runs', { requestId: `sol-context-${project.id}`, scopeId: project.id, kind: 'CAPABILITY', maxInvocations: 2, input: { request: { capabilityId: 'script.rewrite', capabilityVersion: '1', callId: 'rewrite-selection', input: { projectId: project.id, expectedRevision: project.revision, unitId: project.units[0].id, sceneId: project.units[0].scenes[0].id, operation: 'text_rewrite', instruction, methodIds: [method.id], channel: 'external', routeRef: 'simulation:gpt-6-sol', selection: { start, end: start + selected.length, text: selected } } } } });
  const state = await waitRun(accepted.runId, 'WAITING_EXTERNAL');
  const externalRequest = state.externalRequests[0];
  const ref = externalRequest.request.contextRef;
  const context = await api(`/api/agent/scopes/${project.id}/contexts/${ref.id}?digest=${ref.digest}`);
  assert.equal(context.redacted, false); assert.equal(context.bundle.skills[0].version, '7');
  assert.equal(context.bundle.skills[0].content, method.content);
  assert.match(externalRequest.request.prompt, /不能代替作者解决母女关系/);
  assert.match(externalRequest.request.prompt, /不用“心如擂鼓”/);
  assert.match(externalRequest.request.prompt, /避免夸张生理反应/);
  writeFileSync(packetPath, JSON.stringify({ simulation: true, producerRequested: 'GPT-6 Sol subagent', origin, project, selected, source, instruction, memory, accepted, externalRequest, context }, null, 2));
  console.log(JSON.stringify({ packetPath, runId: accepted.runId, inputHash: externalRequest.inputHash }));
} else if (mode === 'submit') {
  const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
  assert.equal(packet.origin, origin);
  const raw = readFileSync('tests/fixtures/agent-sol-context-result.json', 'utf8').trim();
  const external = packet.externalRequest, producer = { name: 'GPT-6 Sol 子 Agent（上下文模拟验收）', model: 'gpt-6-sol' };
  const payload = { inputHash: external.inputHash, text: raw, producer };
  await api(`/api/agent/external/${external.id}/result`, payload);
  await api(`/api/agent/external/${external.id}/result`, payload);
  const state = await waitRun(packet.accepted.runId, 'SUCCEEDED');
  const jobId = state.run.result.data.jobId;
  const before = await api(`/api/scripts/${packet.project.id}`);
  assert.equal(blocksToScreenplayText(before.project.units[0].scenes[0].blocks, []), packet.source);
  const job = (await api(`/api/scripts/${packet.project.id}/jobs/${jobId}`)).job;
  assert.equal(job.rawResult, raw); assert.equal(job.methods[0].version, '7');
  assert.equal(job.methods[0].content, packet.project.methods[0].content);
  const adopted = await api(`/api/scripts/${packet.project.id}/jobs/${jobId}/approve`, {});
  assert.equal((await api(`/api/scripts/${packet.project.id}/jobs/${jobId}/approve`, {})).project.revision, adopted.project.revision);
  const current = (await api(`/api/scripts/${packet.project.id}`)).project;
  const text = blocksToScreenplayText(current.units[0].scenes[0].blocks, []);
  assert.equal(text, packet.source.replace(packet.selected, JSON.parse(raw).replacement));
  const old = (await api(`/api/scripts/${packet.project.id}/jobs/${jobId}/input`)).project;
  assert.equal(blocksToScreenplayText(old.units[0].scenes[0].blocks, []), packet.source);
  const exported = await fetch(`${origin}/api/scripts/${packet.project.id}/export?format=fountain`);
  assert.equal(exported.headers.get('X-Script-Revision'), String(current.revision));
  assert.match(await exported.text(), new RegExp(JSON.parse(raw).replacement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const evidence = { simulation: true, producer, runId: state.run.id, jobId, inputHash: external.inputHash, originalRevision: before.project.revision, adoptedRevision: current.revision, currentTextAtAdoption: text, checks: ['real API + independent worker + SQLite', 'full Skill v7/config/tail in actual prompt', 'author memory in actual prompt', 'raw Sol return preserved', 'duplicate return/adoption idempotent', 'only selection replaced', 'fixed task input retained', 'reopen matches adopted text', 'current Fountain export'] };
  writeFileSync(`${evidenceRoot}/sol-context-acceptance.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
} else throw new Error('Use capture or submit');
