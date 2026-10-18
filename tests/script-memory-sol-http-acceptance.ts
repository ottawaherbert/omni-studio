/** Isolated, real runtime HTTP acceptance using Sol's labeled simulation. */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';

const frozen = JSON.parse(readFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-frozen-request-v2.json', 'utf8'));
const simulated = JSON.parse(readFileSync('/tmp/script-memory-sol-response-v2.json', 'utf8'));
assert.equal(simulated.items.length, 3);
assert.match(simulated.items[0].label, /Sol 模拟返回/);
const db = new Database(frozen.db);
const runtime = createScriptRuntime(db, { transport: { sendOnce: async () => { throw new Error('acceptance forbids external model'); } },
  owner: () => frozen.ownerId, resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'acceptance-external' }) });
const app = express(); app.use(express.json({ limit: '5mb' })); runtime.register(app);
const server = await new Promise<import('node:http').Server>((resolve, reject) => {
  const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject);
});
const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing listener address');
const base = `http://127.0.0.1:${address.port}`;
const path = `/api/script-memory/scopes/${encodeURIComponent(frozen.scopeId)}/work/${encodeURIComponent(frozen.jobId)}`;
const api = async (url: string, init?: RequestInit) => {
  const response = await fetch(`${base}${url}`, init), body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
};
try {
  runtime.start();
  const before = await api(path);
  assert.equal(before.requestHash, frozen.requestHash);
  assert.deepEqual(before.request, frozen.request);
  assert.equal(before.status, 'FROZEN');
  const posted = await api(`${path}/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestHash: frozen.requestHash, text: JSON.stringify(simulated), producer: 'gpt-6-sol-labeled-simulation' }) });
  assert.equal(posted.status, 'DONE');
  const duplicate = await api(`${path}/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestHash: frozen.requestHash, text: JSON.stringify(simulated), producer: 'gpt-6-sol-labeled-simulation' }) });
  assert.deepEqual(duplicate, posted);
  const memory = await api(`/api/agent/scopes/${encodeURIComponent(frozen.scopeId)}/memories?branch=${encodeURIComponent(frozen.branch)}`);
  assert.equal(memory.items.length, 3);
  for (const item of memory.items) {
    assert.equal(item.origin, 'MODEL_DERIVED'); assert.equal(item.review, 'AUTO_ACCEPTED'); assert.equal(item.status, 'ACTIVE');
    assert.equal(item.dependencies[0].ref.contentHash, frozen.request.inputManifest.source.contentHash);
  }
  const receipt = { db: frozen.db, base, jobId: frozen.jobId, requestHash: frozen.requestHash, status: posted.status,
    memories: memory.items.map((item: any) => ({ id: item.id, key: item.key, revision: item.revision, sourceHash: item.dependencies[0].ref.contentHash })),
    externalCalls: 0, route: path, evidence: 'real createScriptRuntime HTTP; Sol labeled simulated return' };
  writeFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-http-acceptance.json', JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally {
  await runtime.stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
}
