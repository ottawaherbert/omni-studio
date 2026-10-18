/** Isolated HTTP edit, automatic invalidation and frozen rebuild requests. */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';

const seed = JSON.parse(readFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-frozen-request-v2.json', 'utf8'));
const db = new Database(seed.db);
let externalCalls = 0;
const runtime = createScriptRuntime(db, { transport: { sendOnce: async () => { externalCalls++; throw new Error('no external model in acceptance'); } },
  owner: () => seed.ownerId, resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'acceptance-external' }) });
const app = express(); app.use(express.json({ limit: '5mb' })); runtime.register(app);
const server = await new Promise<import('node:http').Server>((resolve, reject) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing listener address');
const base = `http://127.0.0.1:${address.port}`;
const api = async (path: string, init?: RequestInit) => { const response = await fetch(`${base}${path}`, init), body = await response.json(); if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`); return body; };
try {
  runtime.start();
  const current = (await api(`/api/script-workspaces/${seed.scopeId}`)).workspace;
  assert.equal(current.revision, 1);
  const document = structuredClone(current.document);
  document.units[0].scenes[0].blocks[0].text += '\n[机械校对标记：版本 2，非剧情正文]';
  const saved = (await api(`/api/script-workspaces/${seed.scopeId}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'memory-sol-edit-v2', expectedRevision: current.revision, expectedEpoch: current.writerEpoch, document }) })).workspace;
  assert.equal(saved.revision, 2);
  const memories = await api(`/api/agent/scopes/${seed.scopeId}/memories?branch=${encodeURIComponent(seed.branch)}`);
  assert.equal(memories.items.length, 0);
  assert.equal(memories.excluded.length, 3);
  let work: any[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    work = await api(`/api/script-memory/scopes/${seed.scopeId}/work`);
    if (work.filter(item => item.kind === 'REBUILD' && item.status === 'FROZEN').length === 3) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const frozen = work.filter(item => item.kind === 'REBUILD' && item.status === 'FROZEN');
  assert.equal(frozen.length, 3);
  assert.equal(externalCalls, 0);
  const output = { db: seed.db, ownerId: seed.ownerId, scopeId: seed.scopeId, branch: seed.branch,
    source: 'real runtime HTTP author save + automatic memory invalidation/rebuild schedule',
    requests: frozen.map(item => ({ jobId: item.id, memoryId: item.memoryId, expectedRevision: item.expectedRevision,
      key: item.source.key, requestHash: item.requestHash, request: item.request })) };
  writeFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-rebuild-requests.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ path: 'artifacts/agent-foundation-study-2026-09-26/sol-memory-rebuild-requests.json', status: frozen.map(item => item.status), memoryIds: frozen.map(item => item.memoryId), externalCalls }));
} finally { await runtime.stop(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
