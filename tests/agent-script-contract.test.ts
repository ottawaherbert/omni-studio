import test from 'node:test';
import assert from 'node:assert/strict';
import { hashValue } from '../packages/agent-core/src';
import { scriptImplementationManifest } from '../apps/api/src/agent/scriptCapabilities';

test('frozen script implementation includes parser, planning and continuity dependency changes', () => {
  const manifest = scriptImplementationManifest();
  const original = hashValue(manifest);
  for (const helper of ['packages/script/src/schema.ts', 'packages/script/src/project.ts', 'packages/script/src/continuity.ts', 'packages/script/src/planning.ts', 'packages/agent-context/src/context.ts', 'packages/agent-sqlite/src/contextStore.ts', 'packages/agent-core/src/model.ts', 'scriptHost.ts']) {
    const found = manifest.find(entry => entry.file === helper);
    assert.ok(found, `runtime dependency absent: ${helper}`);
    const replacement = manifest.map(entry => entry === found ? { ...entry, source: entry.source + '\n// simulated new helper implementation' } : entry);
    assert.notEqual(hashValue(replacement), original, `helper change must invalidate pending provider: ${helper}`);
  }
});
