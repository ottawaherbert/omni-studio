/** Exact Sol simulation returns through the real runtime API after restart. */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';

const bundle = JSON.parse(readFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-rebuild-requests-v2.json', 'utf8'));
const answers = JSON.parse(readFileSync('/tmp/script-memory-sol-rebuild-responses-v2.json', 'utf8'));
assert.equal(answers.responses.length, 3);
const db = new Database(bundle.db);
let externalCalls = 0;
const runtime = createScriptRuntime(db, { transport: { sendOnce: async () => { externalCalls++; throw new Error('no external model'); } },
  owner: () => bundle.ownerId, resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'acceptance-external' }) });
const app = express(); app.use(express.json({ limit: '5mb' })); runtime.register(app);
const server = await new Promise<import('node:http').Server>((resolve, reject) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing listener address');
const base = `http://127.0.0.1:${address.port}`;
const api = async (path: string, init?: RequestInit) => { const response = await fetch(`${base}${path}`, init), body = await response.json(); if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`); return body; };
try {
  runtime.start();
  const receipts: any[] = [];
  for (const request of bundle.requests) {
    const response = answers.responses.find((item: any) => item.jobId === request.jobId && item.requestHash === request.requestHash);
    assert.ok(response, `missing Sol response for ${request.jobId}`);
    const parsed = JSON.parse(response.responseText);
    assert.equal(parsed.items.length, 1);
    assert.match(parsed.items[0].label, /Sol 模拟返回/);
    const path = `/api/script-memory/scopes/${bundle.scopeId}/work/${request.jobId}`;
    const before = await api(path);
    assert.equal(before.status, 'FROZEN'); assert.equal(before.requestHash, request.requestHash);
    assert.deepEqual(before.request, request.request);
    const body = { requestHash: request.requestHash, text: response.responseText, producer: 'gpt-6-sol-labeled-simulation' };
    const result = await api(`${path}/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(result.status, 'DONE');
    const replay = await api(`${path}/return`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.deepEqual(replay, result);
    receipts.push({ jobId: request.jobId, memoryId: request.memoryId, requestHash: request.requestHash, sourceHash: request.request.inputManifest.source.contentHash, status: result.status });
  }
  const memories = await api(`/api/agent/scopes/${bundle.scopeId}/memories?branch=${encodeURIComponent(bundle.branch)}`);
  assert.equal(memories.items.length, 3); assert.equal(memories.excluded.length, 0);
  for (const memory of memories.items) { assert.equal(memory.revision, 3); assert.equal(memory.status, 'ACTIVE'); assert.equal(memory.dependencies[0].ref.contentHash, bundle.requests[0].request.inputManifest.source.contentHash); }
  assert.equal(externalCalls, 0);
  const output = { db: bundle.db, status: 'DONE', receipts, memories: memories.items.map((item: any) => ({ id: item.id, revision: item.revision, key: item.key, status: item.status })), externalCalls,
    evidence: 'real createScriptRuntime HTTP + restarted SQLite + GPT-6 Sol labeled simulated returns' };
  writeFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-rebuild-http-acceptance.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
} finally { await runtime.stop(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
