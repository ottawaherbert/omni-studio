/** Resume isolated runtime after memory contract change, preserve old prompts. */
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import { readFileSync, writeFileSync } from 'node:fs';
import { createScriptRuntime } from '../apps/api/src/agent/scriptRuntime';

const seed = JSON.parse(readFileSync('artifacts/agent-foundation-study-2026-09-26/sol-memory-frozen-request-v2.json', 'utf8'));
const db = new Database(seed.db);
let externalCalls = 0;
const runtime = createScriptRuntime(db, { transport: { sendOnce: async () => { externalCalls++; throw new Error('no external model'); } },
  owner: () => seed.ownerId, resolveMethods: async () => [], resolveExecution: () => ({ channel: 'external', routeRef: 'acceptance-external' }) });
const app = express(); app.use(express.json({ limit: '5mb' })); runtime.register(app);
const server = await new Promise<import('node:http').Server>((resolve, reject) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject); });
const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing listener address');
const base = `http://127.0.0.1:${address.port}`;
try {
  runtime.start();
  let work: any[] = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/api/script-memory/scopes/${seed.scopeId}/work`);
    assert.equal(response.status, 200); work = await response.json();
    if (work.filter(item => item.kind === 'REBUILD' && item.status === 'FROZEN' && item.request?.inputManifest?.contractVersion === 2).length === 3) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const frozen = work.filter(item => item.kind === 'REBUILD' && item.status === 'FROZEN' && item.request?.inputManifest?.contractVersion === 2);
  assert.equal(frozen.length, 3);
  assert.equal(work.filter(item => item.kind === 'REBUILD' && item.status === 'CANCELED' && item.error === 'MEMORY_CONTRACT_CHANGED').length, 3);
  assert.equal(externalCalls, 0);
  const output = { db: seed.db, ownerId: seed.ownerId, scopeId: seed.scopeId, branch: seed.branch,
    source: 'real runtime resume; old frozen requests canceled after contract correction',
    requests: frozen.map(item => ({ jobId: item.id, memoryId: item.memoryId, expectedRevision: item.expectedRevision,
      requestHash: item.requestHash, request: item.request })) };
  const path = 'artifacts/agent-foundation-study-2026-09-26/sol-memory-rebuild-requests-v2.json';
  writeFileSync(path, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ path, jobs: frozen.map(item => item.id), canceledOld: 3, externalCalls }));
} finally { await runtime.stop(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
