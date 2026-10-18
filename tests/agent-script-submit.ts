import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { blocksToScreenplayText } from '../packages/script/src/fountainAdapter';

const packet = JSON.parse(readFileSync('artifacts/agent-foundation-study-2026-09-26/sol-rewrite-request.json', 'utf8'));
const raw = readFileSync('tests/fixtures/agent-sol-rewrite-result.json', 'utf8').trim();
const producer = { name: 'GPT-6 Sol 子 Agent（模拟验收）', model: 'gpt-6-sol' };
async function api(path: string, body?: unknown) {
  const response = await fetch(`${packet.origin}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw new Error(JSON.stringify(data)); return data;
}
const external = packet.externalRequest;
await api(`/api/agent/external/${external.id}/result`, { inputHash: external.inputHash, text: raw, producer });
// Retransmitted submission must resolve to the same request and candidate.
await api(`/api/agent/external/${external.id}/result`, { inputHash: external.inputHash, text: raw, producer });
let state: any;
for (let i = 0; i < 100; i++) {
  state = await api(`/api/agent/runs/${packet.accepted.runId}`);
  if (['SUCCEEDED', 'FAILED'].includes(state.run.status)) break;
  await new Promise(resolve => setTimeout(resolve, 100));
}
assert.equal(state.run.status, 'SUCCEEDED', JSON.stringify(state));
const { jobId } = state.run.result.data;
const { project: before } = await api(`/api/scripts/${packet.project.id}`);
assert.equal(blocksToScreenplayText(before.units[0].scenes[0].blocks, []), packet.source);
const { job } = await api(`/api/scripts/${packet.project.id}/jobs/${jobId}`);
assert.equal(job.rawResult, raw);
assert.equal(job.provenance.modelId, 'gpt-6-sol');
const adopted = await api(`/api/scripts/${packet.project.id}/jobs/${jobId}/approve`, {});
const repeated = await api(`/api/scripts/${packet.project.id}/jobs/${jobId}/approve`, {});
assert.equal(repeated.project.revision, adopted.project.revision);
const { project: reopened } = await api(`/api/scripts/${packet.project.id}`);
const text = blocksToScreenplayText(reopened.units[0].scenes[0].blocks, []);
assert.equal(text, packet.source.replace(external.request.inputManifest.operation === 'text_rewrite' ? '林夏很紧张，不知道要不要开门。' : 'INVALID', JSON.parse(raw).replacement));
const original = await api(`/api/scripts/${packet.project.id}/jobs/${jobId}/input`);
assert.equal(blocksToScreenplayText(original.project.units[0].scenes[0].blocks, []), packet.source);
const { events } = await api(`/api/agent/threads/${packet.accepted.threadId}/events`);
assert.equal(events.filter((event: any) => event.type === 'step.committed').length, 1);
const evidence = { simulation: true, producer, runId: state.run.id, jobId, originalRevision: before.revision, adoptedRevision: adopted.project.revision, currentText: text, checks: ['real HTTP + independent worker + SQLite', 'duplicate return idempotent', 'current manuscript unchanged before adoption', 'only selected text replaced', 'duplicate adoption idempotent', 'reopen matches adopted text', 'fixed task input retained', 'one committed step'] };
writeFileSync('artifacts/agent-foundation-study-2026-09-26/sol-rewrite-acceptance.json', JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
