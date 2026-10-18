/** Acceptance seed only: existing Sol scene fixture, isolated SQLite, no model send. */
import Database from 'better-sqlite3';
import { workspaceSources } from '../apps/api/src/agent/scriptMemory';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createScriptAgentHost } from '../apps/api/src/agent/scriptHost';
import { createScriptProject } from '../packages/script/src/project';
import { createScriptCreationProfile } from '../packages/script/src/creation';

const filename = `/tmp/script-memory-sol-${randomUUID()}.sqlite`;
const db = new Database(filename);
const host = createScriptAgentHost(db, { sendOnce: async () => { throw new Error('isolated external channel only'); } }, 'memory-sol-seed');
const ownerId = 'sol-memory-acceptance';
const thread = host.conversations.open(ownerId, 'script:home', 'sol-memory-acceptance');
const source = JSON.parse(readFileSync('tests/fixtures/agent-sol-scene-result.json', 'utf8'));
const document = createScriptProject('Sol 已生成场正文记忆验收', createScriptCreationProfile('short-film', 1, 5));
document.units[0].scenes[0].blocks = source.blocks.map((block: any, index: number) => ({ id: `block_sol_${index + 1}`, type: block.type, text: block.text, ...(block.speakerName ? { speakerName: block.speakerName } : {}) }));
const workspace = host.workspaces.create({ ownerId, threadId: thread.id, requestId: 'seed-workspace', source: { document } });
// Explicit diagnostic extraction only; production never asks authors to maintain memory.
workspaceSources(workspace,'external','sol-memory-diagnostic').forEach(source=>host.memory.work.enqueue(source));
const frozen = host.memory.work.freezeNext();
if (!frozen || frozen.status !== 'FROZEN') throw new Error('memory request did not freeze');
const out = { db: filename, ownerId, scopeId: workspace.id, branch: `workspace:${workspace.id}`, jobId: frozen.id, requestHash: frozen.requestHash,
  source: 'existing GPT-6 Sol scene fixture agent-sol-scene-result.json', request: frozen.request };
const destination = 'artifacts/agent-foundation-study-2026-09-26/sol-memory-frozen-request-v2.json';
writeFileSync(destination, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ destination, db: filename, jobId: frozen.id, requestHash: frozen.requestHash, sourceHash: frozen.source.ref.contentHash }));
db.close();
